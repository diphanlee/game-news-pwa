import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.0';
import { groupArticles, parseFeedXml, validateFeedUrl, type RawArticle, type StoredArticle } from './news.ts';

type Db = SupabaseClient;
type TopicRow = { id: string; title: string; summary: string | null; topic_articles: Array<{ articles: StoredArticle | null }> };

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || 'https://diphanlee.github.io,http://localhost:5173,http://127.0.0.1:5173').split(',').map(x => x.trim());
function cors(req: Request) { const origin = req.headers.get('origin') || ''; return { 'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0], 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }; }
function json(req: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } }); }
function kstDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return 'UNKNOWN'; }
}
function namedKey(variable: string) {
  try { return JSON.parse(Deno.env.get(variable) || '{}').default || ''; } catch { return ''; }
}
async function createUserClient(req: Request) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!token) throw new Error('UNAUTHORIZED');
  const url = Deno.env.get('SUPABASE_URL');
  const publishable = namedKey('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!url || !publishable) throw new Error('SUPABASE_PUBLIC_KEY_MISSING');
  const client = createClient(url, publishable, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await client.auth.getUser(token);
  if (verified.error || !verified.data.user) throw new Error('UNAUTHORIZED');
  return client;
}
function createAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const secret = namedKey('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !secret) throw new Error('SUPABASE_ADMIN_KEY_MISSING');
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireAdmin(userDb: Db) {
  const profile = await userDb.from('admin_profiles').select('user_id').eq('role', 'admin').maybeSingle();
  if (profile.error) throw new Error(`ADMIN_PROFILE_LOOKUP_FAILED: ${profile.error.message}`);
  if (!profile.data) throw new Error('FORBIDDEN');
}

async function fetchRss(source: { id: string; name: string; feed_url: string }): Promise<RawArticle[]> {
  const feedUrl = validateFeedUrl(source.feed_url); const response = await fetch(feedUrl, { headers: { 'User-Agent': 'GameNewsDesk/1.0 RSS Reader' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`RSS_${response.status}`);
  return parseFeedXml(await response.text(), source);
}

async function collectNews(admin: Db) {
  const run = await admin.from('collection_runs').insert({ status: 'running' }).select('id').single(); if (run.error) throw new Error(`COLLECTION_RUN_INSERT: ${run.error.message}`); const runId = run.data.id;
  try {
    const sourceQuery = await admin.from('news_sources').select('id,name,feed_url').eq('source_type', 'rss').eq('enabled', true); if (sourceQuery.error) throw new Error(`SOURCE_QUERY: ${sourceQuery.error.message}`);
    const rssResults = await Promise.allSettled((sourceQuery.data ?? []).filter(x => x.feed_url).map(x => fetchRss(x as { id: string; name: string; feed_url: string })));
    const raw = rssResults.flatMap(item => item.status === 'fulfilled' ? item.value : []); const unique = [...new Map(raw.map(item => [item.url, item])).values()];
    if (!unique.length) throw new Error('NO_SOURCES_OR_RESULTS');
    const upsert = await admin.from('articles').upsert(unique.map(item => ({ source_id: item.sourceId ?? null, title: item.title, canonical_url: item.url, publisher: item.publisher, published_at: item.publishedAt, excerpt: item.excerpt })), { onConflict: 'canonical_url' }).select('id,title,canonical_url,publisher,published_at,excerpt'); if (upsert.error) throw new Error(`ARTICLE_UPSERT: ${upsert.error.message}`);
    const stored: StoredArticle[] = upsert.data.map(item => ({ id: item.id, title: item.title, url: item.canonical_url, publisher: item.publisher || '출처 미상', publishedAt: item.published_at, excerpt: item.excerpt || '' })); const groups = groupArticles(stored); const date = kstDate(); let topicCount = 0;
    for (const group of groups) { const score = Math.min(100, 35 + group.articles.length * 12 + group.publishers * 8); const topic = await admin.from('topics').upsert({ title: group.title, category: '게임', origin: 'ai', summary: group.articles.slice(0, 3).map(a => a.title).join(' · '), importance_score: score, coverage_score: group.publishers * 10, final_score: score, recommendation_date: date }, { onConflict: 'recommendation_date,title' }).select('id').single(); if (topic.error) throw new Error(`TOPIC_UPSERT: ${topic.error.message}`); const links = await admin.from('topic_articles').upsert(group.articles.map(article => ({ topic_id: topic.data.id, article_id: article.id, is_selected: true })), { onConflict: 'topic_id,article_id' }); if (links.error) throw new Error(`TOPIC_ARTICLE_UPSERT: ${links.error.message}`); const stats = await admin.from('topic_daily_stats').upsert({ topic_id: topic.data.id, stat_date: date, article_count: group.articles.length, publisher_count: group.publishers }, { onConflict: 'topic_id,stat_date' }); if (stats.error) throw new Error(`TOPIC_STATS_UPSERT: ${stats.error.message}`); topicCount++; }
    const completed = await admin.from('collection_runs').update({ status: 'completed', finished_at: new Date().toISOString() }).eq('id', runId); if (completed.error) throw new Error(`COLLECTION_RUN_COMPLETE: ${completed.error.message}`); return { collected: unique.length, topics: topicCount, warnings: rssResults.filter(x => x.status === 'rejected').length };
  } catch (error) { const message = errorMessage(error); await admin.from('collection_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_code: message.slice(0, 200) }).eq('id', runId); console.error(message); throw new Error(message); }
}

async function geminiDraft(topic: TopicRow) {
  const key = Deno.env.get('GEMINI_API_KEY'); if (!key) throw new Error('GEMINI_API_KEY_MISSING'); const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite'; const sources = topic.topic_articles.map((row, index) => row.articles ? `[${index + 1}] ${row.articles.publisher} | ${row.articles.title} | ${row.articles.url} | ${row.articles.excerpt}` : '').filter(Boolean).join('\n');
  const prompt = `다음 자료만 근거로 한국어 게임 뉴스 블로그 초안을 작성하세요. 확인되지 않은 사실을 만들지 마세요. 약 1,000자, 객관적인 뉴스 문체로 제목과 본문을 작성하고 사실 문장 끝에 [1] 형식으로 출처 번호를 표시하세요. 마지막 출처 목록은 시스템이 별도 추가하므로 작성하지 마세요.\n\n토픽: ${topic.title}\n자료:\n${sources}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: .35, maxOutputTokens: 1800 } }) }); if (!response.ok) { let detail = ''; try { const body = await response.json(); detail = String(body?.error?.message || body?.message || ''); } catch { detail = await response.text().catch(() => ''); } throw new Error(`GEMINI_${response.status}_${model}${detail ? `: ${detail.slice(0, 240)}` : ''}`); } const data = await response.json(); const text = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('').trim(); if (!text) throw new Error('GEMINI_EMPTY'); return { text, model };
}

async function generateDrafts(admin: Db, topicIds: string[]) {
  if (!Array.isArray(topicIds) || !topicIds.length || topicIds.length > 10) throw new Error('INVALID_TOPIC_SELECTION'); const query = await admin.from('topics').select('id,title,summary,topic_articles(articles(id,title,canonical_url,publisher,published_at,excerpt))').in('id', topicIds); if (query.error) throw new Error(`TOPIC_QUERY: ${query.error.message}`); let drafts = 0; const failures: Array<{ id: string; message: string }> = [];
  for (const raw of query.data ?? []) {
    const topicArticles = raw.topic_articles.map(row => {
      const value = Array.isArray(row.articles) ? row.articles[0] : row.articles;
      return { articles: value ? {
        id: String(value.id), title: String(value.title), url: String(value.canonical_url),
        publisher: String(value.publisher || '출처 미상'), publishedAt: value.published_at ? String(value.published_at) : null,
        excerpt: String(value.excerpt || ''),
      } : null };
    });
    const topic: TopicRow = { id: raw.id, title: raw.title, summary: raw.summary, topic_articles: topicArticles };
    try {
      const generated = await geminiDraft(topic);
      const inserted = await admin.from('drafts').insert({ topic_id: topic.id, status: 'draft', title: topic.title, content: { markdown: generated.text, plain_text: generated.text, model: generated.model }, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }).select('id').single();
      if (inserted.error) throw new Error(`DRAFT_INSERT: ${inserted.error.message}`);
      const citations = topic.topic_articles.map(x => x.articles).filter(Boolean) as StoredArticle[];
      if (citations.length) {
        const citationInsert = await admin.from('draft_citations').insert(citations.map((article, index) => ({ draft_id: inserted.data.id, citation_no: index + 1, article_id: article.id, source_snapshot: { title: article.title, url: article.url, publisher: article.publisher, published_at: article.publishedAt } })));
        if (citationInsert.error) throw new Error(`CITATION_INSERT: ${citationInsert.error.message}`);
      }
      drafts++;
    } catch (error) { failures.push({ id: topic.id, message: errorMessage(error) }); }
  }
  return { drafts, failures };
}

export default { fetch: async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) }); if (req.method !== 'POST') return json(req, { ok: false, message: 'POST 요청만 허용됩니다.' }, 405);
  try { const userDb = await createUserClient(req); const admin = createAdminClient(); await requireAdmin(userDb); const body = await req.json(); if (body.action === 'collect-news') { const result = await collectNews(admin); return json(req, { ok: true, ...result, message: `기사 ${result.collected}건을 수집하고 토픽 ${result.topics}개를 추천했습니다.${result.warnings ? ` RSS ${result.warnings}개는 실패했습니다.` : ''}` }); } if (body.action === 'generate-drafts') { const result = await generateDrafts(admin, body.topicIds); const reasons = [...new Set(result.failures.map(item => item.message))]; return json(req, { ok: result.drafts > 0, ...result, message: `초안 ${result.drafts}개를 생성했습니다.${result.failures.length ? ` ${result.failures.length}개는 실패했습니다.${reasons.length ? ` 원인: ${reasons.join(', ')}` : ''}` : ''}` }, result.drafts ? 200 : 502); } if (body.action === 'save-rss-source') { const feedUrl = validateFeedUrl(String(body.feedUrl || '')); const name = String(body.name || '').trim().slice(0, 100); if (!name) throw new Error('RSS_NAME_REQUIRED'); const saved = await admin.from('news_sources').insert({ name, source_type: 'rss', feed_url: feedUrl, enabled: true }); if (saved.error) throw new Error(`SOURCE_INSERT: ${saved.error.message}`); return json(req, { ok: true, message: 'RSS 출처를 추가했습니다.' }); } return json(req, { ok: false, message: '지원하지 않는 작업입니다.' }, 400); }
  catch (error) { const message = errorMessage(error); console.error(message); const status = message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : message.includes('_KEY_MISSING') ? 500 : 400; return json(req, { ok: false, message }, status); }
} };
