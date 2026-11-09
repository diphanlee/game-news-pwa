# 게임 뉴스 데스크 — 1차 MVP

관리자 로그인 후 공개 RSS에서 게임 뉴스를 수집하고, 매일 최대 10개 토픽으로 묶어 선택한 토픽의 블로그 초안을 Gemini로 생성하는 개인용 PWA입니다. 생성된 글은 원문 출처와 함께 네이버 블로그 편집기로 복사할 수 있습니다.

## 구현 범위

- Supabase 이메일/비밀번호 관리자 로그인 및 RLS 읽기 보호
- 검증된 기본 게임 매체와 관리자 등록 RSS/Atom 수집
- URL 정규화/중복 제거, 제목 키워드 유사도 기반 기사 그룹화
- 날짜별 추천 토픽 최대 10개와 관련 기사 표시
- 토픽 다중 선택 및 Gemini 초안 순차 생성(부분 실패 보고)
- 초안별 출처 스냅샷 저장, 본문+출처 클립보드 복사
- 수집 기록, 실제 DB 통계, 모바일 반응형 UI, 설치형 PWA 기본 캐시
- GitHub Pages 자동 빌드·배포

## 보안 구조

GitHub Pages 브라우저에는 공개 가능한 Supabase URL과 publishable 키만 포함됩니다. `GEMINI_API_KEY`와 Supabase secret 키는 브라우저 코드나 GitHub 저장소에 넣지 않습니다. 수집·생성·DB 쓰기는 관리자 JWT와 `admin_profiles` 권한을 확인하는 Supabase Edge Function에서만 수행합니다.

RSS 등록은 HTTPS만 허용하며 localhost, 사설 IP 등 명백한 내부망 주소를 차단합니다. 모든 브라우저 DB 쓰기 권한은 회수되어 있습니다.

## 로컬 준비와 검증

Node.js 22 이상과 pnpm 11을 사용합니다.

```bash
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm run typecheck
pnpm run build
pnpm run dev
```

`.env`에는 아래 공개값만 입력합니다.

```env
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=PUBLIC_PUBLISHABLE_OR_ANON_KEY
```

## Supabase 최초 설정

1. SQL Editor에서 아래 파일을 순서대로 한 번씩 실행합니다.
   - `supabase/migrations/202610300001_initial.sql`
   - `supabase/migrations/202611090001_mvp.sql`
   - `supabase/migrations/202611090002_rss_defaults.sql`
   - `supabase/migrations/202611090003_topic_upsert.sql`
2. Authentication → Users에서 관리자 이메일/비밀번호 계정을 직접 만듭니다.
3. 생성된 사용자의 UUID로 아래 SQL을 실행합니다.

```sql
insert into public.admin_profiles (user_id, role)
values ('실제_AUTH_USER_UUID', 'admin');
```

4. 공개 회원가입을 비활성화합니다.
5. Supabase CLI 로그인과 프로젝트 연결 후 서버 비밀값과 함수를 배포합니다. 키는 명령 기록에 직접 남기지 말고 안전한 로컬 환경변수 또는 대시보드 입력을 사용하세요.

```bash
supabase login
supabase link --project-ref PROJECT_REF
supabase secrets set GEMINI_API_KEY
supabase functions deploy news-desk
```

CLI 대신 Dashboard Editor를 사용할 때는 `news-desk` 함수에
`supabase/functions/news-desk/index.ts`와 `news.ts` 두 파일을 같은 위치로 추가합니다.
배포 후 Function Settings의 JWT 검증을 켜 둡니다.

선택 비밀값:

- `GEMINI_MODEL`: 기본값 `gemini-2.5-flash-lite`
- `ALLOWED_ORIGINS`: 쉼표로 구분한 허용 Origin. 기본값에 GitHub Pages 주소와 로컬 개발 주소가 포함됩니다.

Supabase가 함수에 자동 제공하는 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_JWKS`는 별도 저장하지 않습니다. 함수는 `@supabase/server`의 사용자 인증 컨텍스트를 사용하며 JWT 검증을 켭니다. 함수 배포 후 로그인 → 수집 설정 → RSS 추가/뉴스 수집 → 추천 토픽 선택 → 초안 생성 순서로 실제 연동을 확인합니다.

## 외부 API 및 RSS 준비

- Google AI Studio에서 Gemini API 키를 발급합니다. 무료 등급에는 요청량 제한이 있으므로 여러 토픽 생성은 순차 처리되며 실패 토픽 수를 별도로 표시합니다.
- 기본 수집원으로 인벤, 게임메카, 게임동아의 공개 RSS를 등록합니다. 관리자는 수집 설정에서 다른 HTTPS RSS/Atom 피드를 추가할 수 있습니다.

## GitHub Pages 배포

Repository Secrets에 아래 두 값만 등록합니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Settings → Pages → Source를 **GitHub Actions**로 설정합니다. `main` push 시 `.github/workflows/deploy.yml`이 잠금 파일 기준 설치, 타입 검사, 빌드, Pages 배포를 수행합니다.

## 검증 체크리스트

- [ ] `.env` 없음: 설정 안내 화면
- [ ] 잘못된 로그인: 일반 오류, 상세 인증 정보 미노출
- [ ] `admin_profiles` 미등록 사용자: 관리자 화면 차단
- [ ] 등록 관리자: 모든 읽기 화면 및 로그아웃 정상
- [ ] 공개 RSS 추가, 수집 성공, 같은 URL 재수집 시 중복 없음
- [ ] 오늘 추천 토픽 최대 10개, 기사 묶음/출처 표시
- [ ] 토픽 다중 선택 후 Gemini 초안과 출처 레코드 생성
- [ ] 본문+출처 복사 후 네이버 블로그 편집기에 붙여넣기
- [ ] PC/모바일 반응형, iOS 홈 화면 추가 및 재접속
- [ ] 비로그인/일반 사용자의 테이블 조회·쓰기 차단
- [ ] 저장소와 빌드 산출물에 비밀키 없음

## 의도적으로 제외한 범위

- 네이버 블로그 자동 게시(수동 복사만 제공)
- 백업 기능
- 정오 예약 실행, 웹 푸시, 실패 자동 재시도는 2차 목표
- 기사 본문 전문 크롤링. MVP는 API/RSS가 제공한 제목·요약·원문 링크만 사용합니다.
