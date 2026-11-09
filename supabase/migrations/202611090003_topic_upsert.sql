-- Replace the partial index created by the earlier MVP migration.
-- PostgREST upsert with onConflict=title,recommendation_date requires a
-- non-partial unique index that PostgreSQL can infer as its conflict target.
drop index if exists public.topics_daily_title_unique;

create unique index topics_daily_title_unique
  on public.topics(recommendation_date, title);
