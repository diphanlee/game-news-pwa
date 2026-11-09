import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.0';

type Db = SupabaseClient;
type RawArticle = { title: string; url: string; publisher: string; publishedAt: string | null; excerpt: string; sourceId?: string };
type StoredArticle = RawArticle & { id: string };
type TopicRow = { id: string; title: string; summary: string | null; topic_articles: Array<{ articles: StoredArticle | null }> };

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || 'https://diphanlee.github.io,http://localhost:5173,http://127.0.0.1:5173').split(',').map(x => x.trim());
function cors(req: Request) { const origin = req.headers.get('origin') || ''; return { 'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0], 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }; }
function json(req: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } }); }
function clean(value = '') { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim(); }
function canonical(value: string) { const url = new URL(value); ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'].forEach(key => url.searchParams.delete(key)); url.hash = ''; return url.toString(); }
function kstDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function publisher(url: string) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '출처 미상'; } }
function tag(xml: string, name: string) { const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')); return clean(match?.[1] || ''); }
function attr(xml: string, name: string, attrName: string) { const match = xml.match(new RegExp(`<${name}[^>]*\\s${attrName}=["']([^"']+)["'][^>]*>`, 'i')); return clean(match?.[1] || ''); }

function validateFeedUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('RSS 주소는 HTTPS만 허용됩니다.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '::1') throw new Error('내부망 RSS 주소는 허용되지 않습니다.');
  return url.toString();
}

async function requireAdmin(req: Request, admin: Db) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('UNAUTHORIZED');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHORIZED');
  const profile = await admin.from('admin_profiles').select('user_id').eq('user_id', data.user.id).eq('role', 'admin').maybeSingle();
  if (profile.error || !profile.data) throw new Error('FORBIDDEN');
  return data.user;
}

async function fetchNaver(): Promise<RawArticle[]> {
  const clientId = Deno.env.get('NAVER_CLIENT_ID'); const clientSecret = Deno.env.get('NAVER_CLIENT_SECRET');
  if (!clientId || !clientSecret) return [];
  const queries = ['게임 신작', '게임 업데이트', '게임 업계', '이스포츠']; const result: RawArticle[] = [];
  for (const query of queries) {
    const response = await fetch(`https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=30&sort=date`, { headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret } });
    if (!response.ok) throw new Error(`NAVER_${response.status}`);
    const data = await response.json();
    for (const item of data.items ?? []) { const link = item.originallink || item.link; if (!link) continue; result.push({ title: clean(item.title), url: canonical(link), publisher: publisher(link), publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : null, excerpt: clean(item.description) }); }
  }
  return result;
}

async function fetchRss(source: { id: string; name: string; feed_url: string }): Promise<RawArticle[]> {
  const feedUrl = validateFeedUrl(source.feed_url); const response = await fetch(feedUrl, { headers: { 'User-Agent': 'GameNewsDesk/1.0 RSS Reader' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`RSS_${response.status}`); const xml = await response.text(); const entries = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(0, 50);
  return entries.flatMap(match => { const block = match[2]; const link = tag(block, 'link') || attr(block, 'link', 'href'); const title = tag(block, 'title'); if (!link || !title) return []; let url: string; try { url = canonical(link); } catch { return []; } const date = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated'); return [{ title, url, publisher: source.name, publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null, excerpt: tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'), sourceId: source.id }]; });
}

const stopWords = new Set(['게임', '관련', '대한', '통해', '위한', '에서', '으로', '출시', '공개', '진행', '업데이트']);
function tokens(title: string) { return new Set(clean(title).toLowerCase().replace(/[^0-9a-z가-힣 ]/g, ' ').split(/\s+/).filter(word => word.length > 1 && !stopWords.has(word))); }
function similarity(a: string, b: string) { const aa = tokens(a), bb = tokens(b); if (!aa.size || !bb.size) return 0; let shared = 0; for (const word of aa) if (bb.has(word)) shared++; return shared / Math.min(aa.size, bb.size); }
function groupArticles(items: StoredArticle[]) { const groups: StoredArticle[][] = []; for (const article of items) { let best: StoredArticle[] | undefined; let score = 0; for (const group of groups) { const candidate = similarity(article.title, group[0].title); if (candidate > score) { score = candidate; best = group; } } if (best && score >= .34) best.push(article); else groups.push([article]); } return groups.map(group => ({ articles: group, title: group[0].title, publishers: new Set(group.map(x => x.publisher)).size })).sort((a, b) => (b.articles.length * 4 + b.publishers * 2) - (a.articles.length * 4 + a.publishers * 2)).slice(0, 10); }

async function collectNews(admin: Db) {
  const run = await admin.from('collection_runs').insert({ status: 'running' }).select('id').single(); if (run.error) throw run.error; const runId = run.data.id;
  try {
    const sourceQuery = await admin.from('news_sources').select('id,name,feed_url').eq('source_type', 'rss').eq('enabled', true); if (sourceQuery.error) throw sourceQuery.error;
    const rssResults = await Promise.allSettled((sourceQuery.data ?? []).filter(x => x.feed_url).map(x => fetchRss(x as { id: string; name: string; feed_url: string })));
    const raw = [...await fetchNaver(), ...rssResults.flatMap(item => item.status === 'fulfilled' ? item.value : [])]; const unique = [...new Map(raw.map(item => [item.url, item])).values()];
    if (!unique.length) throw new Error('NO_SOURCES_OR_RESULTS');
    const upsert = await admin.from('articles').upsert(unique.map(item => ({ source_id: item.sourceId ?? null, title: item.title, canonical_url: item.url, publisher: item.publisher, published_at: item.publishedAt, excerpt: item.excerpt })), { onConflict: 'canonical_url' }).select('id,title,canonical_url,publisher,published_at,excerpt'); if (upsert.error) throw upsert.error;
    const stored: StoredArticle[] = upsert.data.map(item => ({ id: item.id, title: item.title, url: item.canonical_url, publisher: item.publisher || '출처 미상', publishedAt: item.published_at, excerpt: item.excerpt || '' })); const groups = groupArticles(stored); const date = kstDate(); let topicCount = 0;
    for (const group of groups) { const score = Math.min(100, 35 + group.articles.length * 12 + group.publishers * 8); const topic = await admin.from('topics').upsert({ title: group.title, category: '게임', origin: 'ai', summary: group.articles.slice(0, 3).map(a => a.title).join(' · '), importance_score: score, coverage_score: group.publishers * 10, final_score: score, recommendation_date: date }, { onConflict: 'recommendation_date,title' }).select('id').single(); if (topic.error) throw topic.error; await admin.from('topic_articles').upsert(group.articles.map(article => ({ topic_id: topic.data.id, article_id: article.id, is_selected: true })), { onConflict: 'topic_id,article_id' }); await admin.from('topic_daily_stats').upsert({ topic_id: topic.data.id, stat_date: date, article_count: group.articles.length, publisher_count: group.publishers }, { onConflict: 'topic_id,stat_date' }); topicCount++; }
    await admin.from('collection_runs').update({ status: 'completed', finished_at: new Date().toISOString() }).eq('id', runId); return { collected: unique.length, topics: topicCount, warnings: rssResults.filter(x => x.status === 'rejected').length };
  } catch (error) { await admin.from('collection_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_code: error instanceof Error ? error.message.slice(0, 200) : 'UNKNOWN' }).eq('id', runId); throw error; }
}

async function geminiDraft(topic: TopicRow) {
  const key = Deno.env.get('GEMINI_API_KEY'); if (!key) throw new Error('GEMINI_API_KEY_MISSING'); const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash-lite'; const sources = topic.topic_articles.map((row, index) => row.articles ? `[${index + 1}] ${row.articles.publisher} | ${row.articles.title} | ${row.articles.url} | ${row.articles.excerpt}` : '').filter(Boolean).join('\n');
  const prompt = `다음 자료만 근거로 한국어 게임 뉴스 블로그 초안을 작성하세요. 확인되지 않은 사실을 만들지 마세요. 약 1,000자, 객관적인 뉴스 문체로 제목과 본문을 작성하고 사실 문장 끝에 [1] 형식으로 출처 번호를 표시하세요. 마지막 출처 목록은 시스템이 별도 추가하므로 작성하지 마세요.\n\n토픽: ${topic.title}\n자료:\n${sources}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: .35, maxOutputTokens: 1800 } }) }); if (!response.ok) throw new Error(`GEMINI_${response.status}`); const data = await response.json(); const text = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('').trim(); if (!text) throw new Error('GEMINI_EMPTY'); return { text, model };
}

async function generateDrafts(admin: Db, topicIds: string[]) {
  if (!Array.isArray(topicIds) || !topicIds.length || topicIds.length > 10) throw new Error('INVALID_TOPIC_SELECTION'); const query = await admin.from('topics').select('id,title,summary,topic_articles(articles(id,title,canonical_url,publisher,published_at,excerpt))').in('id', topicIds); if (query.error) throw query.error; let drafts = 0; const failures: Array<{ id: string; message: string }> = [];
  for (const raw of query.data ?? []) { const topic = { ...raw, topic_articles: raw.topic_articles.map((row: { articles: Record<string, unknown> | null }) => ({ articles: row.articles ? { id: row.articles.id, title: row.articles.title, url: row.articles.canonical_url, publisher: row.articles.publisher, publishedAt: row.articles.published_at, excerpt: row.articles.excerpt } : null })) } as TopicRow; try { const generated = await geminiDraft(topic); const inserted = await admin.from('drafts').insert({ topic_id: topic.id, status: 'draft', title: topic.title, content: { markdown: generated.text, plain_text: generated.text, model: generated.model }, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }).select('id').single(); if (inserted.error) throw inserted.error; const citations = topic.topic_articles.map(x => x.articles).filter(Boolean) as StoredArticle[]; if (citations.length) { const citationInsert = await admin.from('draft_citations').insert(citations.map((article, index) => ({ draft_id: inserted.data.id, citation_no: index + 1, article_id: article.id, source_snapshot: { title: article.title, url: article.url, publisher: article.publisher, published_at: article.publishedAt } }))); if (citationInsert.error) throw citationInsert.error; } drafts++; } catch (error) { failures.push({ id: topic.id, message: error instanceof Error ? error.message : 'UNKNOWN' }); } }
  return { drafts, failures };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) }); if (req.method !== 'POST') return json(req, { ok: false, message: 'POST 요청만 허용됩니다.' }, 405);
  const url = Deno.env.get('SUPABASE_URL'); const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); if (!url || !serviceKey) return json(req, { ok: false, message: '서버 설정이 누락되었습니다.' }, 500); const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  try { await requireAdmin(req, admin); const body = await req.json(); if (body.action === 'collect-news') { const result = await collectNews(admin); return json(req, { ok: true, ...result, message: `기사 ${result.collected}건을 수집하고 토픽 ${result.topics}개를 추천했습니다.${result.warnings ? ` RSS ${result.warnings}개는 실패했습니다.` : ''}` }); } if (body.action === 'generate-drafts') { const result = await generateDrafts(admin, body.topicIds); return json(req, { ok: result.drafts > 0, ...result, message: `초안 ${result.drafts}개를 생성했습니다.${result.failures.length ? ` ${result.failures.length}개는 실패했습니다.` : ''}` }, result.drafts ? 200 : 502); } if (body.action === 'save-rss-source') { const feedUrl = validateFeedUrl(String(body.feedUrl || '')); const name = String(body.name || '').trim().slice(0, 100); if (!name) throw new Error('RSS_NAME_REQUIRED'); const saved = await admin.from('news_sources').insert({ name, source_type: 'rss', feed_url: feedUrl, enabled: true }); if (saved.error) throw saved.error; return json(req, { ok: true, message: 'RSS 출처를 추가했습니다.' }); } return json(req, { ok: false, message: '지원하지 않는 작업입니다.' }, 400); }
  catch (error) { const message = error instanceof Error ? error.message : 'UNKNOWN'; const status = message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 400; return json(req, { ok: false, message }, status); }
});
