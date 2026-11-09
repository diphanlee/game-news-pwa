export type Route = 'home' | 'articles' | 'topics' | 'drafts' | 'logs' | 'settings';

export interface Article {
  id: string;
  title: string;
  canonical_url: string;
  publisher: string | null;
  published_at: string | null;
  excerpt: string | null;
  collected_at: string;
}

export interface TopicArticleRow {
  is_selected: boolean;
  articles: Article | null;
}

export interface Topic {
  id: string;
  title: string;
  category: string | null;
  summary: string | null;
  final_score: number | null;
  recommendation_date: string | null;
  created_at: string;
  topic_articles?: TopicArticleRow[];
}

export interface DraftContent {
  markdown: string;
  plain_text: string;
  model?: string;
}

export interface Draft {
  id: string;
  topic_id: string | null;
  status: 'draft' | 'editing' | 'ready' | 'published' | 'on_hold';
  title: string | null;
  content: DraftContent | null;
  created_at: string;
  updated_at: string;
  topics?: { title: string } | null;
  draft_citations?: Array<{
    citation_no: number;
    source_snapshot: { title?: string; url?: string; publisher?: string; published_at?: string };
  }>;
}

export interface CollectionRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  error_code: string | null;
}

export interface NewsSource {
  id: string;
  name: string;
  source_type: 'naver' | 'rss';
  feed_url: string | null;
  enabled: boolean;
}

export interface DashboardCounts {
  articles: number;
  topics: number;
  drafts: number;
  failures: number;
}
