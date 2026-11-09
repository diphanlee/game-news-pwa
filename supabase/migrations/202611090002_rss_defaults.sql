-- Default public game-news RSS sources. Safe to run after the MVP migration.
create unique index if not exists news_sources_feed_url_unique
  on public.news_sources(feed_url) where feed_url is not null;

insert into public.news_sources (name, source_type, feed_url, enabled) values
  ('인벤', 'rss', 'https://www.inven.co.kr/webzine/news/rss.php', true),
  ('게임메카', 'rss', 'https://www.gamemeca.com/rss.php', true),
  ('게임동아', 'rss', 'https://game.donga.com/feeds/rss/news/', true)
on conflict (feed_url) where feed_url is not null do update
set name = excluded.name,
    enabled = true;
