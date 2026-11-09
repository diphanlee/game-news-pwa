import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { canonical, clean, groupArticles, parseFeedXml, validateFeedUrl, type StoredArticle } from '../news-desk/news.ts';

Deno.test('HTML 정리와 추적 파라미터 제거', () => {
  assertEquals(clean('<b>신작</b> &amp; 업데이트'), '신작 & 업데이트');
  assertEquals(canonical('https://example.com/news?id=1&utm_source=test#top'), 'https://example.com/news?id=1');
});

Deno.test('RSS 주소는 HTTPS 공개 호스트만 허용', () => {
  assertEquals(validateFeedUrl('https://news.example.com/feed.xml'), 'https://news.example.com/feed.xml');
  assertThrows(() => validateFeedUrl('http://news.example.com/feed.xml'));
  assertThrows(() => validateFeedUrl('https://127.0.0.1/feed.xml'));
  assertThrows(() => validateFeedUrl('https://192.168.0.10/feed.xml'));
});

Deno.test('RSS와 Atom 항목 파싱', () => {
  const xml = `<rss><channel><item><title><![CDATA[게임 <b>소식</b>]]></title><link>https://example.com/a?utm_campaign=x</link><pubDate>Sun, 09 Nov 2026 03:00:00 GMT</pubDate><description>새 소식</description></item></channel></rss>`;
  const items = parseFeedXml(xml, { id: 'source-1', name: '테스트 매체' });
  assertEquals(items.length, 1); assertEquals(items[0].title, '게임 소식'); assertEquals(items[0].url, 'https://example.com/a');
});

Deno.test('유사 제목을 묶고 추천 결과를 10개로 제한', () => {
  const make = (id: string, title: string, publisher: string): StoredArticle => ({ id, title, publisher, url: `https://example.com/${id}`, publishedAt: null, excerpt: '' });
  const items = [
    make('a', '오로라 모바일 사전예약 시작', 'A'),
    make('b', '오로라 모바일 글로벌 사전예약', 'B'),
    ...Array.from({ length: 12 }, (_, i) => {
      const suffix = String.fromCharCode(97 + i).repeat(2);
      return make(`x${i}`, `topic${suffix} detail${suffix}`, 'C');
    }),
  ];
  const groups = groupArticles(items);
  assertEquals(groups.length, 10); assertEquals(groups[0].articles.length, 2); assertEquals(groups[0].publishers, 2);
});
