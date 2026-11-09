import { supabase } from './supabase';

export interface FunctionResult {
  ok: boolean;
  message: string;
  collected?: number;
  topics?: number;
  drafts?: number;
  failures?: Array<{ id: string; message: string }>;
}

export async function runServerAction(action: string, payload: Record<string, unknown> = {}) {
  if (!supabase) throw new Error('Supabase 연결 정보가 없습니다.');
  const { data, error } = await supabase.functions.invoke<FunctionResult>('news-desk', {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message || '서버 작업을 실행하지 못했습니다.');
  if (!data?.ok) throw new Error(data?.message || '서버 작업이 실패했습니다.');
  return data;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '날짜 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

export function todayKst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
