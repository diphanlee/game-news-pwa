-- Phase 1 MVP hardening. Safe to run after 202610300001_initial.sql.
create unique index if not exists topics_daily_title_unique
  on public.topics(recommendation_date, title);

create index if not exists articles_collected_idx on public.articles(collected_at desc);
create index if not exists topic_articles_article_idx on public.topic_articles(article_id);
create index if not exists draft_citations_article_idx on public.draft_citations(article_id);

-- Edge Functions use service_role for writes. Browser clients remain read-only.
-- Explicitly keep all mutations unavailable to anon/authenticated roles.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

insert into public.app_settings(key, value) values
 ('naver_search_queries', '["게임 신작","게임 업데이트","게임 업계","이스포츠"]'::jsonb),
 ('gemini_model', '"gemini-3.5-flash-lite"'::jsonb)
on conflict (key) do nothing;
