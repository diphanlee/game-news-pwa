import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Archive, BarChart3, Bell, BookOpen, ChevronRight, CircleAlert, CircleCheck, Clock3, FilePenLine, Home, ListChecks, LogOut, Menu, Newspaper, RefreshCw, Settings2, ShieldCheck, X } from 'lucide-react';
import { configured, supabase } from './supabase';

type Route = 'home'|'articles'|'topics'|'drafts'|'stats'|'logs'|'settings';
type Profile = 'loading'|'authorized'|'denied';
const menus: Array<{id:Route;label:string;icon:typeof Home;phase:string}> = [
  {id:'home',label:'대시보드',icon:Home,phase:'1단계'},
  {id:'articles',label:'뉴스 관리',icon:Newspaper,phase:'2단계'},
  {id:'topics',label:'토픽 추천',icon:ListChecks,phase:'2단계'},
  {id:'drafts',label:'포스팅 초안',icon:FilePenLine,phase:'3·4단계'},
  {id:'stats',label:'이슈 통계',icon:BarChart3,phase:'2단계 이후'},
  {id:'logs',label:'실행 기록',icon:Clock3,phase:'3·5단계'},
  {id:'settings',label:'설정',icon:Settings2,phase:'단계별'},
];

function Login({onAuthenticated}:{onAuthenticated:(s:Session)=>void}) {
 const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
 async function submit(e:FormEvent) { e.preventDefault(); if(!supabase)return; setLoading(true);setError('');
  try { const {data,error}=await supabase.auth.signInWithPassword({email:email.trim(),password}); if(error)throw error; if(data.session)onAuthenticated(data.session); }
  catch { setError('로그인에 실패했습니다. 이메일·비밀번호 또는 계정 설정을 확인해 주세요.'); }
  finally {setLoading(false);} }
 return <div className="auth-layout"><div className="auth-card"><div className="mark"><Newspaper size={25}/></div><div className="eyebrow">PRIVATE NEWS WORKSPACE</div><h1>게임 뉴스 데스크</h1><p className="muted">국내 게임업계 뉴스 관리자를 위한 로그인</p><form onSubmit={submit} className="login-form"><label htmlFor="email">이메일</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/><label htmlFor="password">비밀번호</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="비밀번호 입력"/>{error&&<p className="error" role="alert">{error}</p>}<button className="primary" disabled={loading}>{loading?'확인 중…':'로그인'}<ChevronRight size={16}/></button></form><div className="footnote"><ShieldCheck size={15}/> 가입은 제공하지 않는 관리자 전용 서비스입니다.</div></div></div>;
}

function App() {
 const [session,setSession]=useState<Session|null>(null); const [checking,setChecking]=useState(true); const [profile,setProfile]=useState<Profile>('loading'); const [route,setRoute]=useState<Route>('home'); const [drawer,setDrawer]=useState(false);
 useEffect(()=>{ if(!supabase){setChecking(false);return;} const client=supabase; let active=true;
  client.auth.getSession().then(({data,error})=>{if(active){setSession(error?null:data.session);setChecking(false);}}).catch(()=>{if(active){setSession(null);setChecking(false);}});
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,next)=>{if(active){setSession(next);setChecking(false);}});
  return()=>{active=false;subscription.unsubscribe();};
 },[]);
 useEffect(()=>{ if(!supabase||!session){setProfile('loading');return;} let active=true; const client=supabase;
  const verify=async()=>{setProfile('loading'); const {data,error}=await client.from('admin_profiles').select('user_id').eq('user_id',session.user.id).eq('role','admin').maybeSingle(); if(active)setProfile(!error&&data?'authorized':'denied');}; void verify();return()=>{active=false};
 },[session?.user.id]);
 async function logout(){ await supabase?.auth.signOut();setSession(null);setProfile('loading');setRoute('home');}
 if(!configured)return <div className="auth-layout"><div className="auth-card"><div className="mark"><Settings2/></div><h1>초기 연결 설정이 필요합니다</h1><p className="muted">Supabase 프로젝트 주소와 공개용 키가 아직 설정되지 않았습니다. <code>.env.example</code>을 참고해 로컬 <code>.env</code> 파일 또는 GitHub Actions Secrets에 값을 등록해 주세요.</p><div className="notice"><CircleAlert size={19}/> 비밀키(service_role, secret, Gemini API 키)는 VITE_ 환경변수에 입력하지 마세요.</div></div></div>;
 if(checking)return <div className="center" role="status"><RefreshCw className="spin"/> 로그인 상태 확인 중…</div>;
 if(!session)return <Login onAuthenticated={setSession}/>;
 if(profile==='loading')return <div className="center" role="status"><RefreshCw className="spin"/> 관리자 권한 확인 중…</div>;
 if(profile==='denied')return <div className="auth-layout"><div className="auth-card"><div className="mark"><ShieldCheck/></div><h1>관리자 접근 권한이 없습니다</h1><p className="muted">로그인한 계정에 관리자 권한이 없거나 DB 설정을 확인할 수 없습니다. Supabase의 <code>admin_profiles</code> 관리자 등록 및 RLS 정책을 확인해 주세요.</p><button className="primary" onClick={logout}>로그아웃</button></div></div>;
 const section=menus.find(x=>x.id===route)!;
 return <div className="app-shell"><aside className={'sidebar '+(drawer?'open':'')} aria-label="기본 메뉴"><div className="brand"><div className="mark small"><Newspaper size={21}/></div><div><strong>게임 뉴스 데스크</strong><small>GAME NEWS DESK</small></div><button className="close-menu" onClick={()=>setDrawer(false)} aria-label="메뉴 닫기"><X size={19}/></button></div><nav>{menus.map(({id,label,icon:Icon,phase})=><button className={'navitem '+(route===id?'selected':'')} key={id} onClick={()=>{setRoute(id);setDrawer(false)}}><Icon size={19}/><span>{label}</span>{id!=='home'&&<span className="nav-dot" title={phase}/>}</button>)}</nav><div className="side-bottom"><span className="private-label"><ShieldCheck size={14}/> PRIVATE WORKSPACE</span><button className="logout" onClick={logout}><LogOut size={17}/> 로그아웃</button></div></aside>{drawer&&<button className="backdrop" aria-label="메뉴 닫기" onClick={()=>setDrawer(false)}/>}<div className="main"><header className="topbar"><button className="menu-button" aria-label="메뉴 열기" onClick={()=>setDrawer(true)}><Menu size={23}/></button><div className="crumb">게임 뉴스 데스크 <ChevronRight size={15}/><strong>{section.label}</strong></div><div className="top-right"><span className="private-pill"><ShieldCheck size={14}/> 관리자 전용</span><span className="avatar" aria-label="관리자">A</span></div></header><main className="content">{route==='home'?<Dashboard/>:<Placeholder section={section.label} phase={section.phase} route={route}/>}</main><footer className="app-footer">게임 뉴스 데스크 · 1단계 기반 구축 · 기능별 단계적 개발</footer></div></div>;
}
function Dashboard(){return <><div className="heading"><div><p className="eyebrow">OVERVIEW</p><h1>대시보드</h1><p className="muted">뉴스 자동화 운영을 위한 관리자 공간입니다.</p></div><div className="phase"><CircleCheck size={16}/> 1단계 · 기본 구조</div></div><div className="metrics">{[{t:'수집된 기사',icon:Newspaper},{t:'추천 토픽',icon:ListChecks},{t:'생성된 초안',icon:FilePenLine},{t:'미완료 작업',icon:Clock3}].map(({t,icon:Icon})=><div className="metric" key={t}><div className="metric-label">{t}<Icon size={18}/></div><div className="metric-value">—</div><p>2~5단계 연동 예정</p></div>)}</div><div className="cols"><section className="panel"><div className="panel-head"><h2>개발 진행 상황</h2><span className="subtle">Phase 01 / 05</span></div><div className="timeline"><div className="timeline-item active"><CircleCheck size={19}/><div><strong>기본 프로젝트·로그인·보안</strong><p>현재 단계: Supabase 연결 및 관리자 계정 설정</p></div></div><div className="timeline-item"><Newspaper size={19}/><div><strong>뉴스 수집·토픽 추천</strong><p>다음 단계에서 구현합니다.</p></div></div><div className="timeline-item"><BookOpen size={19}/><div><strong>AI 초안 생성·편집</strong><p>선택한 토픽에 대해서만 실행합니다.</p></div></div><div className="timeline-item"><Bell size={19}/><div><strong>예약 실행·PWA 알림</strong><p>마지막 안정화 단계에서 연결합니다.</p></div></div></div></section><section className="panel"><div className="panel-head"><h2>확정된 운영 정책</h2><Archive size={19}/></div><dl className="policies"><div><dt>뉴스 수집</dt><dd>매일 12:00 KST</dd></div><div><dt>추천 토픽 기본 개수</dt><dd>10개</dd></div><div><dt>AI 제공업체</dt><dd>Gemini 무료 API</dd></div><div><dt>글 기본 분량</dt><dd>1,000자</dd></div><div><dt>기사 / 초안 보존</dt><dd>7일 / 30일 (예외 보호)</dd></div><div><dt>발행 방식</dt><dd>네이버 블로그 수동 게시</dd></div><div><dt>백업</dt><dd>사용 안 함</dd></div></dl><div className="tip"><ShieldCheck size={17}/> 현재 표시된 값은 확정된 설정입니다. 실제 뉴스 수집·AI 실행은 아직 연결되지 않았습니다.</div></section></div></>}
function Placeholder({section,phase,route}:{section:string;phase:string;route:Route}){return <><div className="heading"><div><p className="eyebrow">WORKSPACE</p><h1>{section}</h1><p className="muted">게임 뉴스 데스크의 {section} 영역입니다.</p></div><div className="phase"><Clock3 size={16}/> {phase} 구현 예정</div></div><section className="panel placeholder"><div className="placeholder-icon">{route==='settings'?<Settings2 size={29}/>:route==='stats'?<BarChart3 size={29}/>:route==='drafts'?<FilePenLine size={29}/>:<Newspaper size={29}/>}</div><h2>{section} 기능은 다음 단계에서 연결됩니다.</h2><p>실제 데이터가 없는 상태에서 가짜 기사나 통계를 표시하지 않습니다.<br/>현재 완료된 범위는 인증, 접근 제어, 화면 골격, DB 마이그레이션 및 배포 준비입니다.</p></section></>}
export default App;
