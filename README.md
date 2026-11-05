# 게임 뉴스 데스크 · 1단계 기반 구축

국내 게임업계 뉴스 자동화 관리자 PWA 프로젝트입니다. **현재 제공되는 기능은 1단계 기반 구축에 한정됩니다.** 뉴스 수집, Gemini 초안 생성, 예약 실행, 실제 푸시는 아직 구현되지 않았습니다. 화면의 통계 기호(—)는 실제 데이터가 연결되지 않았다는 뜻입니다.

## 1. 환경 준비

- Node.js 22 이상, npm, Git, VS Code
- GitHub 공개 저장소 `game-news-pwa` (사용자가 직접 생성)
- Supabase 단일 프로젝트 (사용자가 직접 생성)

```bash
npm install
cp .env.example .env
```

Windows PowerShell이면 `Copy-Item .env.example .env`를 사용합니다.

`.env`의 다음 **공개 가능 키만** 설정합니다.

```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable_or_anon_key>
```

`VITE_` 환경변수는 웹사이트 JS에 포함됩니다. **Supabase service_role/secret 키 또는 Gemini 키는 절대 넣지 마세요.** `.env`는 Git에 포함되지 않습니다. 공개용 Supabase 키는 RLS가 올바르게 설정된 경우에만 안전한 범위로 사용됩니다.

## 2. Supabase DB 초기화 (1회)

1. Supabase Dashboard → SQL Editor에서 `supabase/migrations/202610300001_initial.sql` 파일 내용을 실행합니다.
2. Authentication → Users에서 관리자 계정(이메일/비밀번호)을 직접 생성합니다.
3. 해당 사용자의 UUID를 확인하여 아래 SQL을 **SQL Editor**에서 실행합니다. 아래 UUID는 직접 확인한 값으로 교체하세요.

```sql
insert into public.admin_profiles (user_id, role)
values ('PUT_REAL_AUTH_USER_UUID_HERE', 'admin');
```

4. Authentication 설정에서 **일반 사용자의 신규 회원가입을 비활성화**합니다. 정확한 메뉴명은 Supabase UI 버전에 따라 다를 수 있습니다.
5. 로그인 후 대시보드 접근을 확인합니다. 미등록 계정은 로그인에 성공하더라도 관리자 화면에 진입할 수 없습니다.

**주의:** 마이그레이션에는 관리자 등록을 위한 브라우저 쓰기 정책이 없습니다. 관리자 생성은 SQL Editor를 통해서만 진행해야 합니다. 데이터 테이블은 1단계에서 관리자 읽기만 허용하며, 향후 쓰기·삭제 작업은 권한을 검사하는 서버 함수에서 구현합니다.

## 3. 로컬 실행

```bash
npm run dev
```

터미널에 표시된 로컬 주소로 접속하세요. 화면은 `.env`가 없을 때 설정 안내를 표시하며, 테스트 계정이나 가짜 뉴스를 생성하지 않습니다.

```bash
npm run typecheck
npm run build
npm run preview
```

## 4. GitHub Pages 배포

1. GitHub에 **Public** 저장소 `game-news-pwa`를 생성합니다.
2. 프로젝트 파일을 커밋한 후 `main` 브랜치로 push합니다.
3. GitHub 저장소 → **Settings → Secrets and variables → Actions**에서 아래 Repository secrets를 등록합니다.
   - `VITE_SUPABASE_URL`: Supabase 프로젝트 URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable/anon key
4. **Settings → Pages → Build and deployment → Source: GitHub Actions**로 설정합니다.
5. Actions의 `Deploy GitHub Pages` 성공 후 `https://diphanlee.github.io/game-news-pwa/`에 접속합니다.

개발 환경에서 `npm install`을 실행하면 `package-lock.json`이 생성됩니다. **재현 가능한 배포를 위해 lockfile을 함께 커밋하는 것을 권장**합니다. 현재 워크플로는 lockfile이 없을 때 `npm install`로 처음 빌드하고, 이후 lockfile이 있으면 `npm ci`를 사용합니다.

`vite.config.ts`의 `base`와 `public/manifest.webmanifest`의 경로는 `/game-news-pwa/`로 맞춰져 있습니다. 단일 저장소·단일 Supabase 프로젝트 기준입니다.

## 5. 단계 범위 / 보안

- 포함: React/TS/Vite 골격, Supabase Auth 로그인·세션 유지, 관리자 DB 검증, 관리자 전용 읽기 RLS, 반응형 메뉴, GitHub Pages 배포 워크플로, PWA 기본 manifest.
- 이후 단계: 네이버 API·RSS 수집, 중복 제거/토픽화, AI 생성, 편집, 작업 큐, 정기 실행, 웹 푸시.
- 미포함: 자동·수동 백업(최종 요구사항에 따라 제외), 공개 회원가입.
- **1단계 PWA는 manifest만 포함**하며 Service Worker 및 오프라인 지원/웹 푸시는 5단계에서 구현합니다. 아이폰에서의 설치·푸시 동작은 해당 단계에서 실제 기기로 검증해야 합니다.

## 6. 초기 검증 체크리스트

- [ ] `.env` 없이 실행 시 연결 설정 안내 화면 표시
- [ ] Supabase URL/공개용 키 연결 후 비로그인 시 로그인 화면 표시
- [ ] 잘못된 비밀번호 시 일반 오류 메시지 표시
- [ ] Auth 계정만 있고 `admin_profiles` 권한이 없으면 접근 차단
- [ ] 관리자 계정 로그인 시 대시보드 표시
- [ ] 새로고침 후 로그인 세션 유지
- [ ] 로그아웃 시 보호 화면 차단
- [ ] 비로그인 REST 호출 시 `articles` 조회 불가
- [ ] 일반 로그인 계정도 `articles` 조회 불가
- [ ] 모바일 화면에서 사이드바 열기·닫기 동작
- [ ] `.env`와 비밀키가 Git 커밋 대상에 없는지 확인
- [ ] Pages 빌드 후 HTML, CSS, JS, manifest, 아이콘 경로 정상

## 7. 알려진 제약

이 환경에서는 npm 패키지를 설치하지 못했을 경우 빌드 검증을 완료했다고 주장할 수 없습니다. 배포는 실제 GitHub 계정 및 Supabase 프로젝트를 준비한 뒤 진행해야 합니다. 무료 Supabase 프로젝트의 일시정지, API 무료 한도는 후속 단계에서 별도 대비합니다.
