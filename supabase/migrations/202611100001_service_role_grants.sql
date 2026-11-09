-- Grant the server-only Edge Function role access only to the tables used by
-- the phase-1 collection, RSS management, topic, and draft workflows.
grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.collection_runs,
  public.news_sources,
  public.articles,
  public.topics,
  public.topic_articles,
  public.topic_daily_stats,
  public.drafts,
  public.draft_citations
to service_role;
