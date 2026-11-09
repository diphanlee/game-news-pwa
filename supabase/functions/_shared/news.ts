export type RawArticle = { title: string; url: string; publisher: string; publishedAt: string | null; excerpt: string; sourceId?: string };
export type StoredArticle = RawArticle & { id: string };

export function clean(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ').trim();
}

export function canonical(value: string) {
  const url = new URL(value);
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'].forEach(key => url.searchParams.delete(key));
  url.hash = '';
  return url.toString();
}

export function publisher(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '출처 미상'; }
}

function tag(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return clean(match?.[1] || '');
}

function attr(xml: string, name: string, attrName: string) {
  const match = xml.match(new RegExp(`<${name}[^>]*\\s${attrName}=["']([^"']+)["'][^>]*>`, 'i'));
  return clean(match?.[1] || '');
}

export function validateFeedUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('RSS 주소는 HTTPS만 허용됩니다.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '::1') {
    throw new Error('내부망 RSS 주소는 허용되지 않습니다.');
  }
  return url.toString();
}

export function parseFeedXml(xml: string, source: { id: string; name: string }) {
  const entries = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(0, 50);
  return entries.flatMap(match => {
    const block = match[2]; const link = tag(block, 'link') || attr(block, 'link', 'href'); const title = tag(block, 'title');
    if (!link || !title) return [];
    let url: string; try { url = canonical(link); } catch { return []; }
    const date = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    return [{ title, url, publisher: source.name, publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null, excerpt: tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'), sourceId: source.id } satisfies RawArticle];
  });
}

const stopWords = new Set(['게임', '관련', '대한', '통해', '위한', '에서', '으로', '출시', '공개', '진행', '업데이트']);
export function tokens(title: string) {
  return new Set(clean(title).toLowerCase().replace(/[^0-9a-z가-힣 ]/g, ' ').split(/\s+/).filter(word => word.length > 1 && !stopWords.has(word)));
}

export function similarity(a: string, b: string) {
  const aa = tokens(a), bb = tokens(b); if (!aa.size || !bb.size) return 0;
  let shared = 0; for (const word of aa) if (bb.has(word)) shared++;
  return shared / Math.min(aa.size, bb.size);
}

export function groupArticles(items: StoredArticle[]) {
  const groups: StoredArticle[][] = [];
  for (const article of items) {
    let best: StoredArticle[] | undefined; let score = 0;
    for (const group of groups) { const candidate = similarity(article.title, group[0].title); if (candidate > score) { score = candidate; best = group; } }
    if (best && score >= .34) best.push(article); else groups.push([article]);
  }
  return groups.map(group => ({ articles: group, title: group[0].title, publishers: new Set(group.map(x => x.publisher)).size }))
    .sort((a, b) => (b.articles.length * 4 + b.publishers * 2) - (a.articles.length * 4 + a.publishers * 2)).slice(0, 10);
}
