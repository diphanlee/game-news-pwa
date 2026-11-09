-- Game News Desk: phase 1 schema. Execute once in Supabase SQL editor.
-- Security boundary: all user-facing tables have RLS and admin-only policies.
create extension if not exists pgcrypto;

create table public.admin_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null default 'admin' check (role = 'admin'),
 created_at timestamptz not null default now()
);
alter table public.admin_profiles enable row level security;
-- Admin identity can be read ONLY by the matching authenticated user.
create policy admin_profile_self on public.admin_profiles
 for select to authenticated using ((select auth.uid()) = user_id);
-- No client INSERT/UPDATE/DELETE grants or policies for admin_profiles.
revoke all on public.admin_profiles from anon, authenticated;
grant select on public.admin_profiles to authenticated;

create or replace function public.is_admin() returns boolean language sql stable security definer
 set search_path = '' as $$
  select exists(select 1 from public.admin_profiles p where p.user_id = (select auth.uid()) and p.role = 'admin');
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table public.app_settings (
 key text primary key,
 value jsonb not null,
 updated_at timestamptz not null default now()
);
create table public.news_sources (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 source_type text not null check(source_type in ('naver','rss')),
 feed_url text,
 enabled boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.articles (
 id uuid primary key default gen_random_uuid(),
 source_id uuid references public.news_sources(id) on delete set null,
 title text not null,
 canonical_url text not null unique,
 publisher text,
 published_at timestamptz,
 collected_at timestamptz not null default now(),
 excerpt text,
 excluded boolean not null default false,
 excluded_reason text
);
create index articles_published_idx on public.articles(published_at desc);
create table public.topics (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 category text,
 origin text not null check(origin in ('ai','article_manual','manual')),
 summary text,
 analysis text,
 importance_score numeric,
 coverage_score numeric,
 final_score numeric,
 recommendation_date date,
 created_at timestamptz not null default now()
);
create index topics_recommendation_idx on public.topics(recommendation_date desc, final_score desc);
create table public.topic_articles (
 topic_id uuid not null references public.topics(id) on delete cascade,
 article_id uuid not null references public.articles(id) on delete cascade,
 is_selected boolean not null default true,
 primary key(topic_id,article_id)
);
create table public.topic_daily_stats (
 topic_id uuid not null references public.topics(id) on delete cascade,
 stat_date date not null,
 article_count integer not null default 0 check(article_count>=0),
 publisher_count integer not null default 0 check(publisher_count>=0),
 primary key(topic_id,stat_date)
);
create table public.topic_relations (
 topic_id uuid not null references public.topics(id) on delete cascade,
 related_topic_id uuid not null references public.topics(id) on delete cascade,
 relation_type text not null check(relation_type in ('duplicate_candidate','followup')),
 primary key(topic_id,related_topic_id),
 check(topic_id<>related_topic_id)
);
create table public.drafts (
 id uuid primary key default gen_random_uuid(),
 topic_id uuid references public.topics(id) on delete set null,
 status text not null default 'draft' check(status in ('draft','editing','ready','published','on_hold')),
 title text,
 content jsonb,
 style_settings jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 expires_at timestamptz
);
create index drafts_status_idx on public.drafts(status,updated_at desc);
create table public.draft_versions (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.drafts(id) on delete cascade,
 version integer not null check(version>0),
 content jsonb not null,
 created_at timestamptz not null default now(),
 unique(draft_id,version)
);
create table public.draft_citations (
 draft_id uuid not null references public.drafts(id) on delete cascade,
 citation_no integer not null check(citation_no>0),
 article_id uuid references public.articles(id) on delete set null,
 source_snapshot jsonb not null default '{}'::jsonb,
 primary key(draft_id,citation_no)
);
create table public.publication_records (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid unique references public.drafts(id) on delete set null,
 topic_id uuid references public.topics(id) on delete set null,
 topic_title_snapshot text not null,
 published_at timestamptz not null,
 blog_url text not null,
 created_at timestamptz not null default now()
);
create table public.job_batches (
 id uuid primary key default gen_random_uuid(),
 job_type text not null,
 status text not null default 'queued' check(status in ('queued','running','completed','partial_failure','failed')),
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create table public.jobs (
 id uuid primary key default gen_random_uuid(),
 batch_id uuid references public.job_batches(id) on delete set null,
 job_type text not null,
 status text not null default 'queued' check(status in ('queued','running','completed','failed','waiting_quota','waiting_sources')),
 idempotency_key text not null unique,
 attempts integer not null default 0 check(attempts>=0),
 lease_until timestamptz,
 retry_after timestamptz,
 payload jsonb not null default '{}'::jsonb,
 result jsonb,
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index jobs_lease_idx on public.jobs(status,retry_after,lease_until);
create table public.collection_runs (
 id uuid primary key default gen_random_uuid(),
 source_id uuid references public.news_sources(id) on delete set null,
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 status text not null,
 cursor_value text,
 error_code text
);
create table public.api_usage (
 provider text not null,
 model text not null,
 usage_date date not null,
 request_count integer not null default 0 check(request_count>=0),
 token_count bigint not null default 0 check(token_count>=0),
 primary key(provider,model,usage_date)
);
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 public_keys jsonb not null,
 enabled boolean not null default true,
 created_at timestamptz not null default now()
);
-- Per-table RLS: no unauthenticated access, client-side admin read access only.
-- Writes will be mediated by phase 2+ backend functions with explicit authorization.
do $$
declare t text;
begin
 foreach t in array array['app_settings','news_sources','articles','topics','topic_articles','topic_daily_stats',
 'topic_relations','drafts','draft_versions','draft_citations','publication_records',
 'job_batches','jobs','collection_runs','api_usage','push_subscriptions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for select to authenticated using ((select public.is_admin()))', 'admin_read_'||t,t);
  execute format('revoke all on table public.%I from anon, authenticated',t);
  execute format('grant select on table public.%I to authenticated',t);
 end loop;
end $$;
-- Limit the server-only Edge Function role to the phase-1 workflow tables.
grant usage on schema public to service_role;
grant select, insert, update, delete on table
 public.collection_runs, public.news_sources, public.articles, public.topics,
 public.topic_articles, public.topic_daily_stats, public.drafts, public.draft_citations
to service_role;
-- Restrict sensitive subscription data to its owning admin user.
drop policy admin_read_push_subscriptions on public.push_subscriptions;
create policy admin_read_push_subscriptions on public.push_subscriptions
 for select to authenticated using ((select public.is_admin()) and user_id = (select auth.uid()));
-- Initial fixed settings: no fake articles or drafts are seeded.
insert into public.app_settings(key,value) values
 ('recommended_topics_count','10'::jsonb),
 ('article_retention_days','7'::jsonb),
 ('draft_retention_days','30'::jsonb),
 ('default_draft_length','1000'::jsonb),
 ('draft_length_presets','{"short":500,"medium":1000,"long":1800}'::jsonb),
 ('default_writing_style','"objective_news"'::jsonb),
 ('daily_collect_time','"12:00 Asia/Seoul"'::jsonb),
 ('backup_enabled','false'::jsonb)
 on conflict(key) do nothing;
