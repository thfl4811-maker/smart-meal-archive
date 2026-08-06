import './style.css';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

/* ══ Firebase (AISORI — 급식소리함 공용 계정) ══ */
const fbApp = initializeApp({
  apiKey:"AIzaSyBEagv2iP4sSJuDsjBB24A3FHFfAiiS8wA",
  authDomain:"aisori.firebaseapp.com", projectId:"aisori",
  storageBucket:"aisori.firebasestorage.app",
  messagingSenderId:"829702954282",
  appId:"1:829702954282:web:7f38d1ca0e591d238d9253"
});
const auth=getAuth(fbApp), db=getFirestore(fbApp), gprov=new GoogleAuthProvider();
let user=null;

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const state={
  mine:JSON.parse(localStorage.getItem('archive_my_school')||'null'),
  comparisons:JSON.parse(localStorage.getItem('archive_compare_schools')||'[]'),
  tab:'mine',
  similar:true,
  loaded:[],
  favorites:new Set(JSON.parse(localStorage.getItem('archive_favorites')||'[]')),
  scraps:JSON.parse(localStorage.getItem('archive_scraps')||'[]'),   // [{id,folder,title,menus,memo,date,school,stars}]
  ratings:JSON.parse(localStorage.getItem('archive_ratings')||'{}'), // {'YYYY-MM-DD':{stars,memo}}
  folders:JSON.parse(localStorage.getItem('archive_folders')||'["기본"]'),
  menuMemos:JSON.parse(localStorage.getItem('archive_menu_memos')||'{}'),   // {정규화메뉴명: 메모}
  reportNote:localStorage.getItem('archive_report_note')||'',
  baseFolder:localStorage.getItem('archive_base_folder')||'기본 폴더',
};

/* ══ 클라우드 동기화 ══ */
function persistLocal(){
  localStorage.setItem('archive_my_school',JSON.stringify(state.mine));
  localStorage.setItem('archive_compare_schools',JSON.stringify(state.comparisons));
  localStorage.setItem('archive_favorites',JSON.stringify([...state.favorites]));
  localStorage.setItem('archive_scraps',JSON.stringify(state.scraps));
  localStorage.setItem('archive_ratings',JSON.stringify(state.ratings));
  localStorage.setItem('archive_folders',JSON.stringify(state.folders));
  localStorage.setItem('archive_menu_memos',JSON.stringify(state.menuMemos||{}));
  localStorage.setItem('archive_report_note',state.reportNote||'');
  localStorage.setItem('archive_base_folder',state.baseFolder||'기본 폴더');
}
async function syncCloud(){
  persistLocal();
  if(!user)return;
  try{await setDoc(doc(db,'users',user.uid,'apps','archive'),{
    mine:state.mine||null,comparisons:state.comparisons||[],
    favorites:[...state.favorites],scraps:state.scraps||[],
    ratings:state.ratings||{},folders:state.folders||[],
    menuMemos:state.menuMemos||{},reportNote:state.reportNote||'',
    baseFolder:state.baseFolder||'기본 폴더',
    updatedAt:new Date().toISOString()
  },{merge:false})}catch(e){console.error('sync 실패',e)}
}
async function loadCloud(){
  if(!user)return;
  try{const s=await getDoc(doc(db,'users',user.uid,'apps','archive'));
  if(!s.exists())return;
  const d=s.data();
  if(d.mine)state.mine=d.mine;
  if(d.comparisons)state.comparisons=d.comparisons;
  if(d.favorites)state.favorites=new Set(d.favorites);
  if(d.scraps)state.scraps=d.scraps;
  if(d.ratings)state.ratings=d.ratings;
  if(d.folders)state.folders=d.folders;
  if(d.menuMemos)state.menuMemos=d.menuMemos;
  if(typeof d.reportNote==='string')state.reportNote=d.reportNote;
  if(d.baseFolder)state.baseFolder=d.baseFolder;
  persistLocal()}catch(e){console.error('load 실패',e)}
}

/* ══════════════════════════════════════════════════════
   메뉴 정규화 · 5분류 규칙
   ▶ 분류가 틀린 메뉴가 있으면 이 블록의 키워드만 고치면
     리포트·트렌드·조합검색 전체에 반영됩니다.
   ▶ 판정 순서: 예외 → 밥 → 국·찌개 → 김치 → 주찬(재료) → 후식 → 부찬(폴백)
══════════════════════════════════════════════════════ */
const CLASS_RULES={
  /* 정확히 이 단어가 들어가면 무조건 해당 분류 (최우선) */
  exception:{
    rice:['비빔밥','볶음밥','덮밥','국밥','카레라이스','오므라이스','짜장밥','컵밥','주먹밥','김밥','영양밥'],
    main:['탕수육','닭볶음탕','떡갈비'],
    dessert:['식혜','수정과','미숫가루']
  },
  /* 밥·죽·면 등 주식류 */
  rice:['밥','죽','리조또','리소토','필라프','국수','칼국수','우동','스파게티','파스타','짜장면','비빔면','냉면','쫄면','라면','짬뽕'],
  /* 국·찌개 (단, soupExclude 단어가 있으면 제외) */
  soup:['국','탕','찌개','전골','스프','수프','수제비','장국','짬뽕국','개장'],
  soupExclude:['탕수','볶음탕','국수','국물떡'],
  /* 김치류 */
  kimchi:['김치','깍두기','총각','석박지','동치미','겉절이','나박','백김치'],
  /* 주찬 판정 재료·요리 (고기·생선·해물 중심) */
  mainIng:['갈비','불고기','제육','돈까스','돈가스','생선까스','생선가스','치즈까스','왕돈까스','치킨','닭','오리','스테이크','장조림','탕수','강정','고등어','삼치','조기','갈치','꽁치','동태','코다리','임연수','가자미','연어','참치','메로','굴비','장어','생선','미트볼','함박','너비아니','산적','폭찹','깐풍','유린기','오징어','쭈꾸미','주꾸미','낙지','문어','새우','돼지','소고기','쇠고기','한우','우육','돈육','계육','목살','삼겹','햄','소시지','소세지','비엔나','마라','불백','훈제'],
  /* 후식류 */
  dessert:['과일','주스','음료','요구르트','요거트','아이스크림','케이크','쿠키','빵','푸딩','젤리','우유','수박','참외','멜론','메론','포도','사과','바나나','파인애플','딸기','오렌지','키위','자두','복숭아','천도','귤','한라봉','망고','에이드','스무디','약과','화채','샤베트','셔벗','라떼'],
  /* 부찬 판정 (여기 없어도 최종 폴백은 부찬) */
  side:['무침','나물','샐러드','잡채','전','말이','조림','볶음','튀김','피클','장아찌','묵','두부','계란','달걀','떡볶이','구이','찜','쌈']
};
const _normCache=new Map();
function normalize(s=''){
  const key=String(s);
  if(_normCache.has(key))return _normCache.get(key);
  const n=key
    .replace(/\([^)]*\)/g,'')
    .replace(/\[[^\]]*\]/g,'')
    .replace(/[*#@♥▶►◆■※&]/g,'')
    .replace(/자율선택|자율메뉴|자율/g,'')
    .replace(/국내산|국산|친환경|무농약|유기농|저염|저당|Non-GMO|HACCP/gi,'')
    .replace(/\s+/g,'')
    .trim();
  _normCache.set(key,n);
  return n;
}
const _catCache=new Map();
function classify(name){
  const n=normalize(name);
  if(_catCache.has(n))return _catCache.get(n);
  let cat='side';
  const R=CLASS_RULES;
  outer:{
    for(const [c,words] of Object.entries(R.exception))
      if(words.some(w=>n.includes(w))){cat=c;break outer}
    if(R.rice.some(w=>n.includes(w))){cat='rice';break outer}
    if(R.soup.some(w=>n.includes(w))&&!R.soupExclude.some(w=>n.includes(w))){cat='soup';break outer}
    if(R.kimchi.some(w=>n.includes(w))){cat='kimchi';break outer}
    if(R.mainIng.some(w=>n.includes(w))){cat='main';break outer}
    if(R.dessert.some(w=>n.includes(w))){cat='dessert';break outer}
    cat='side';
  }
  _catCache.set(n,cat);
  return cat;
}
const CAT_LABEL={rice:'밥',soup:'국·찌개',main:'주찬',side:'부찬',kimchi:'김치',dessert:'후식'};
const CAT_ORDER=['rice','soup','kimchi','main','side'];

/* ══ 스크랩북 기본 폴더 (초기 세팅 — 이후 사용자가 자유롭게 수정) ══ */
const DEFAULT_FOLDERS=['다음 달 식단 후보','계절 식단','특식·행사식','학생 반응 우수','자율선택급식','다른 학교 참고 식단','수다날 식단','다시 활용할 식단','보완이 필요한 식단','기본 폴더'];
function splitMenus(menus){
  const g={rice:[],soup:[],kimchi:[],main:[],side:[],dessert:[]};
  (menus||[]).forEach(m=>{const c=classify(m);(g[c]||g.side).push(m)});
  return g;
}
/* 기존 스크랩 데이터 → 새 구조 마이그레이션 (데이터 손실 없음) */
function migrateScraps(){
  let changed=false;
  if(!Array.isArray(state.folders))state.folders=[];
  if(!state.baseFolder)state.baseFolder='기본 폴더';
  if(state.folders.length===0||(state.folders.length===1&&state.folders[0]==='기본')){
    state.folders=[...DEFAULT_FOLDERS];changed=true;
  }else{
    DEFAULT_FOLDERS.forEach(f=>{if(!state.folders.includes(f)){state.folders.push(f);changed=true}});
    const gi=state.folders.indexOf('기본');
    if(gi>-1){state.folders.splice(gi,1);changed=true}
  }
  if(!state.folders.includes(state.baseFolder)){state.folders.push(state.baseFolder);changed=true}
  state.scraps=(state.scraps||[]).map(sc=>{
    if(sc&&sc.schemaV===2)return sc;
    changed=true;
    const menus=Array.isArray(sc.menus)?sc.menus:[];
    const isAnalysis=menus.some(m=>/^주찬:|^부찬:/.test(String(m)))||sc.school==='분석 결과';
    const base={
      schemaV:2,
      id:sc.id||Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      type:isAnalysis?'idea':'meal',
      folder:(sc.folder==='기본'||!sc.folder)?state.baseFolder:sc.folder,
      title:sc.title||'제목 없음',
      school:sc.school||'',servedDate:sc.date||'',
      menus,calories:sc.calories||'',stars:sc.stars||0,memo:sc.memo||'',
      savedAt:sc.savedAt||dateISO(new Date()),
      sourceType:isAnalysis?'조합 분석':'식단 카드',sourcePeriod:'',snapshot:null
    };
    if(base.type==='meal')Object.assign(base,splitMenus(menus));
    return base;
  });
  if(changed)persist();
}

function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function dateISO(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function oneYearAgo(){const d=new Date();d.setFullYear(d.getFullYear()-1);d.setDate(d.getDate()+1);return dateISO(d)}
function monthAgo(){const d=new Date();d.setDate(d.getDate()-30);return dateISO(d)}
function parseDishes(raw=''){
  return String(raw).split(/<br\s*\/?>|\n/gi).map(v=>v.trim()).filter(Boolean).map(line=>{
    const nums=[...line.matchAll(/\(([\d.]+)\)/g)].flatMap(m=>m[1].split('.').filter(Boolean));
    return {name:line.replace(/\([^)]*\)/g,'').trim(),allergy:[...new Set(nums)]};
  }).filter(x=>x.name);
}
function menuMatches(name,keyword,similar){
  const n=normalize(name),k=normalize(keyword);
  if(!k)return false;
  return similar?n.includes(k)||k.includes(n):n===k;
}
function schoolKey(s){return `${s.officeCode}:${s.schoolCode}`}
function koreanDate(v){return `${v.slice(0,4)}년 ${Number(v.slice(4,6))}월 ${Number(v.slice(6,8))}일`}
function persist(){syncCloud()}

/* ══ 로그인 UI ══ */
async function doSignIn(){
  try{await signInWithPopup(auth,gprov)}
  catch(e){
    console.error(e);
    const code=e&&e.code||'';
    if(code==='auth/popup-blocked')alert('브라우저가 팝업을 차단했어요.\n주소창 오른쪽의 팝업 차단 아이콘을 눌러 허용한 뒤 다시 시도해주세요.');
    else if(code==='auth/unauthorized-domain')alert('이 주소는 Firebase 승인 도메인에 등록되어 있지 않아요.\nFirebase 콘솔 → Authentication → Settings → 승인된 도메인에 localhost를 추가해주세요.');
    else if(code==='auth/popup-closed-by-user'||code==='auth/cancelled-popup-request'){/* 사용자가 창을 닫음 — 무시 */}
    else alert('로그인에 실패했어요.\n오류 코드: '+(code||e.message||'알 수 없음')+'\n\n로그인하지 않아도 스크랩·별점은 이 브라우저에 저장돼요.');
  }
}
async function doSignOut(){await signOut(auth)}

function shell(){
  $('#app').innerHTML=`
  <header class="top"><div class="topin">
    <div class="brand">나의 <span>식단 아카이브</span></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
      <span class="soon-badge">🗓 특일 캘린더 · 초안 식단 보드 업데이트 예정</span>
      <div class="school-pill">${state.mine?`${esc(state.mine.schoolName)} · ${esc(state.mine.level)}`:'내 학교 미등록'}</div>
      ${user
        ?`<span class="cloud-tag">☁ ${esc(user.displayName||'')}</span><button class="btn ghost small" id="logoutBtn">로그아웃</button>`
        :`<button class="btn small" id="loginBtn">🔑 Google 로그인</button>`}
    </div>
  </div></header>
  <main class="wrap">
    <section class="hero"><h1>내 식단과 다른 학교의<br>실제 메뉴 조합을 검색하세요</h1>
      <p>나이스 급식 데이터를 불러와 기준 메뉴와 함께 편성한 주찬·부찬을 분석하고, 실제 급식 날짜의 전체 식단을 카드로 확인합니다.</p>
      ${user?'':'<p class="help" style="margin-top:6px">💡 Google 로그인하면 스크랩·별점·설정이 클라우드에 저장되어 어느 기기에서든 이어서 쓸 수 있어요.</p>'}
    </section>
    <div class="tabs">
      <button class="tab ${state.tab==='mine'?'active':''}" data-tab="mine">내 식단 아카이브</button>
      <button class="tab ${state.tab==='compare'?'active':''}" data-tab="compare">같은 학교급 3개교 비교</button>
      <button class="tab ${state.tab==='trend'?'active':''}" data-tab="trend">🔥 요즘 뜨는 메뉴</button>
      <button class="tab ${state.tab==='report'?'active':''}" data-tab="report">📊 내 식단 리포트</button>
      <button class="tab ${state.tab==='scrap'?'active':''}" data-tab="scrap">📌 스크랩북</button>
    </div>
    <section id="controls"></section>
    <section id="status"></section>
    <section id="results"></section>
  </main>
  <p style="text-align:center;font-size:10px;color:#fff;padding:24px 0;user-select:none">영양교사 김소리</p>
  <div id="modal"></div>`;
  if(user){$('#logoutBtn').onclick=doSignOut}else{$('#loginBtn').onclick=doSignIn}
  $$('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;shell()});
  renderControls();
  if(!state.mine&&['mine','trend','report'].includes(state.tab)) openSchoolModal('mine');
}

function commonFields(){
  return `
  <div class="grid">
    <div class="field"><label>시작일</label><input id="from" type="date" value="${oneYearAgo()}"></div>
    <div class="field"><label>종료일</label><input id="to" type="date" value="${dateISO(new Date())}"></div>
    <div class="field"><label>기준 메뉴</label><input id="keyword" value="미역국" placeholder="예: 미역국"></div>
    <div class="field"><label>분석 방식</label><select id="mode"><option value="all">주찬·부찬 모두</option><option value="main">주찬 중심</option><option value="side">부찬 중심</option></select></div>
  </div>
  <div class="toggleline"><button class="toggle ${state.similar?'on':''}" id="similar"></button><span>비슷한 메뉴 포함</span></div>`;
}

function renderControls(){
  const c=$('#controls');$('#status').innerHTML='';$('#results').innerHTML='';
  if(state.tab==='mine'){
    c.innerHTML=`<section class="panel">
      <div class="row" style="justify-content:space-between"><h2>내 학교 식단 검색</h2><button class="btn ghost small" id="changeMine">학교 변경</button></div>
      ${commonFields()}
      <div class="searchrow"><input disabled value="${state.mine?esc(state.mine.schoolName):'먼저 내 학교를 등록하세요.'}"><button class="btn" id="analyze">실제 식단 분석</button></div>
      <div class="help">조회 기간은 최대 1년입니다. 나이스에 등록된 중식 자료를 검색합니다.</div>
    </section>`;
    $('#changeMine').onclick=()=>openSchoolModal('mine');
    bindCommon();$('#analyze').onclick=analyze;
  }else if(state.tab==='compare'){
    c.innerHTML=`<section class="panel">
      <div class="row" style="justify-content:space-between"><h2>경기도 내 같은 학교급 비교</h2><button class="btn ghost small" id="addSchool">비교학교 찾기</button></div>
      <div class="school-layout">
        <div class="box"><h3>내 학교</h3><div class="chips">${state.mine?schoolChip(state.mine,false):'<span class="help">내 학교 미등록</span>'}</div></div>
        <div class="box"><h3>선택 비교학교 <span class="help">최대 3개</span></h3><div class="chips" id="selectedChips">${state.comparisons.length?state.comparisons.map(s=>schoolChip(s,true)).join(''):'<span class="help">비교학교를 선택하세요.</span>'}</div></div>
      </div>
      ${commonFields()}
      <div class="searchrow"><input disabled value="내 학교와 비교학교의 실제 식단을 함께 분석합니다."><button class="btn" id="analyze">비교 분석</button></div>
      <div class="warn">분석 대상은 내 학교 1개와 비교학교 최대 3개입니다.</div>
    </section>`;
    $('#addSchool').onclick=()=>openSchoolModal('compare');
    $$('[data-remove-school]').forEach(b=>b.onclick=()=>{
      state.comparisons=state.comparisons.filter(s=>schoolKey(s)!==b.dataset.removeSchool);persist();renderControls();
    });
    bindCommon();$('#analyze').onclick=analyze;
  }else if(state.tab==='trend'){
    c.innerHTML=`<section class="panel">
      <h2>🔥 요즘 뜨는 메뉴 (최근 30일)</h2>
      <p class="help" style="margin:6px 0 12px">내 학교와 비교학교의 최근 한 달 식단을 분석해 카테고리별 인기 메뉴를 보여줍니다. 내 학교에 없는 메뉴는 ✨NEW로 표시돼요.</p>
      <div class="chips" style="margin-bottom:12px">${[state.mine,...state.comparisons].filter(Boolean).map(s=>`<span class="chip">${esc(s.schoolName)}</span>`).join('')||'<span class="help">학교를 등록하세요</span>'}</div>
      <button class="btn" id="trendGo">트렌드 분석</button>
    </section>`;
    $('#trendGo').onclick=analyzeTrend;
  }else if(state.tab==='report'){
    c.innerHTML=`<section class="panel">
      <h2>📊 내 식단 리포트</h2>
      <p class="help" style="margin:6px 0 12px">기간과 키워드를 정해 내 학교 식단을 분석합니다. 이 리포트는 나에게만 보여요. 비교학교를 등록해두면 최근 90일 인기 메뉴 참고 섹션이 함께 나와요.</p>
      <div class="grid">
        <div class="field"><label>시작일</label><input id="rFrom" type="date" value="${oneYearAgo()}"></div>
        <div class="field"><label>종료일</label><input id="rTo" type="date" value="${dateISO(new Date())}"></div>
        <div class="field"><label>키워드 분석 (선택)</label><input id="rKeyword" placeholder="예: 미역국 — 비우면 전체만"></div>
        <div class="field"><label>빠른 기간</label>
          <div class="row" style="gap:6px;flex-wrap:wrap">
            <button class="btn ghost small" data-quick="30">30일</button>
            <button class="btn ghost small" data-quick="90">90일</button>
            <button class="btn ghost small" data-quick="180">6개월</button>
            <button class="btn ghost small" data-quick="365">1년</button>
          </div>
        </div>
      </div>
      <div class="row" style="margin-top:13px"><button class="btn" id="reportGo">리포트 생성</button></div>
    </section>`;
    $$('[data-quick]').forEach(b=>b.onclick=()=>{
      const d=new Date();d.setDate(d.getDate()-(+b.dataset.quick-1));
      $('#rFrom').value=dateISO(d);$('#rTo').value=dateISO(new Date());
    });
    $('#reportGo').onclick=analyzeReport;
  }else if(state.tab==='scrap'){
    renderScrapbook();
  }
}
function bindCommon(){
  $('#similar').onclick=()=>{state.similar=!state.similar;$('#similar').classList.toggle('on',state.similar)};
}

function schoolChip(s,removable){
  return `<span class="chip">${esc(s.schoolName)}${removable?`<button data-remove-school="${schoolKey(s)}">×</button>`:''}</span>`;
}

function openSchoolModal(type){
  const m=$('#modal');
  const title=type==='mine'?'내 학교 검색':'같은 학교급 비교학교 검색';
  const levelHint=state.mine?`현재 학교급: ${esc(state.mine.level)}`:'내 학교를 먼저 등록합니다.';
  m.innerHTML=`<div class="modal"><div class="modal-card">
    <h2>${title}</h2><p>경기도 학교만 검색됩니다. ${levelHint}</p>
    <div class="searchrow"><input id="schoolQuery" placeholder="학교명을 2글자 이상 입력"><button class="btn" id="schoolSearch">학교 검색</button></div>
    <div id="schoolSearchStatus" class="help"></div><div id="schoolList" class="school-results"></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" id="closeModal">닫기</button></div>
  </div></div>`;
  $('#closeModal').onclick=()=>m.innerHTML='';
  $('#schoolSearch').onclick=()=>searchSchools(type);
  $('#schoolQuery').onkeydown=e=>{if(e.key==='Enter')searchSchools(type)};
  setTimeout(()=>$('#schoolQuery').focus(),20);
}

async function searchSchools(type){
  const q=$('#schoolQuery').value.trim(),st=$('#schoolSearchStatus'),list=$('#schoolList');
  if(q.length<2){st.textContent='학교명을 2글자 이상 입력하세요.';return}
  st.innerHTML='<span class="loading"></span>학교를 검색하고 있습니다.';list.innerHTML='';
  try{
    const r=await fetch(`/api/schools?q=${encodeURIComponent(q)}`);
    const data=await r.json();
    if(!r.ok)throw Error(data.error||'학교 검색 실패');
    const filtered=type==='compare'&&state.mine?data.filter(s=>s.level===state.mine.level):data;
    st.textContent=`${filtered.length}개 학교를 찾았습니다.`;
    list.innerHTML=filtered.map(s=>`<button class="school-item" data-school='${esc(JSON.stringify(s))}'><b>${esc(s.schoolName)}</b><small>${esc(s.address||'경기도')} · ${esc(s.level)}</small></button>`).join('')||'<div class="empty">조건에 맞는 학교가 없습니다.</div>';
    $$('.school-item').forEach(b=>b.onclick=()=>selectSchool(JSON.parse(b.dataset.school),type));
  }catch(e){st.textContent=e.message}
}

function selectSchool(s,type){
  if(type==='mine'){
    state.mine=s;
    state.comparisons=state.comparisons.filter(x=>x.level===s.level&&schoolKey(x)!==schoolKey(s)).slice(0,3);
  }else{
    if(!state.mine)return;
    if(s.level!==state.mine.level){alert('내 학교와 같은 학교급만 선택할 수 있습니다.');return}
    if(schoolKey(s)===schoolKey(state.mine)){alert('내 학교는 비교학교에서 제외됩니다.');return}
    if(state.comparisons.some(x=>schoolKey(x)===schoolKey(s))){alert('이미 선택한 학교입니다.');return}
    if(state.comparisons.length>=3){alert('비교학교는 최대 3개까지 선택할 수 있습니다.');return}
    state.comparisons.push(s);
  }
  persist();$('#modal').innerHTML='';shell();
}

async function fetchMeals(school,from,to){
  const url=`/api/meals-range?office=${encodeURIComponent(school.officeCode)}&school=${encodeURIComponent(school.schoolCode)}&from=${from}&to=${to}`;
  const r=await fetch(url);const rows=await r.json();
  if(!r.ok)throw Error(`${school.schoolName}: ${rows.error||'식단 조회 실패'}`);
  return rows.map(row=>({...row,school}));
}

/* ══ 조합 검색 (핵심 기능) ══ */
async function analyze(){
  if(!state.mine){openSchoolModal('mine');return}
  const from=$('#from').value,to=$('#to').value,keyword=$('#keyword').value.trim();
  if(!from||!to||!keyword){setStatus('기간과 기준 메뉴를 입력하세요.',true);return}
  const days=(new Date(to)-new Date(from))/86400000;
  if(days<0||days>370){setStatus('조회 기간은 최대 1년이며 종료일이 시작일보다 늦어야 합니다.',true);return}
  const targets=state.tab==='mine'?[state.mine]:[state.mine,...state.comparisons];
  if(state.tab==='compare'&&!state.comparisons.length){setStatus('비교학교를 한 곳 이상 선택하세요.',true);return}
  $('#results').innerHTML='';
  setStatus(`<span class="loading"></span>${targets.length}개 학교의 실제 식단을 불러오고 있습니다.`);
  try{
    const results=await Promise.all(targets.map(s=>fetchMeals(s,from,to)));
    state.loaded=results.flat();
    const matches=analyzeMeals(state.loaded,keyword,state.similar);
    setStatus(`${targets.length}개교의 실제 급식 ${state.loaded.length}일을 불러왔고, '${esc(keyword)}'가 포함된 ${matches.meals.length}일을 찾았습니다.`);
    renderResults(matches,keyword,from,to,targets);
  }catch(e){setStatus(e.message,true)}
}

function analyzeMeals(rows,keyword,similar){
  const mainMap=new Map(),sideMap=new Map(),matched=[];
  for(const row of rows){
    const dishes=parseDishes(row.dishes);
    const hit=dishes.some(d=>menuMatches(d.name,keyword,similar));
    if(!hit)continue;
    const enriched={...row,dishes};
    matched.push(enriched);
    for(const dish of dishes){
      if(menuMatches(dish.name,keyword,similar))continue;
      const type=classify(dish.name);
      if(type==='main')addCount(mainMap,dish,row.school,row.date);
      else if(type==='side')addCount(sideMap,dish,row.school,row.date);
    }
  }
  return {meals:matched.sort((a,b)=>b.date.localeCompare(a.date)),main:rank(mainMap),side:rank(sideMap)};
}
function addCount(map,dish,school,date){
  const key=normalize(dish.name);
  if(!key)return;
  const v=map.get(key)||{name:dish.name,count:0,schools:new Set(),latest:''};
  v.count++;v.schools.add(school.schoolName);if(date>v.latest)v.latest=date;map.set(key,v);
}
function rank(map){return [...map.values()].sort((a,b)=>b.count-a.count||b.schools.size-a.schools.size).slice(0,15)}

function renderResults(a,keyword,from,to,targets){
  $('#results').innerHTML=`
    <div class="section-title"><div><h2>'${esc(keyword)}' 실제 식단 분석</h2><p>${from} ~ ${to} · ${targets.map(s=>esc(s.schoolName)).join(', ')}</p></div>
    <div class="row" style="gap:6px"><button class="btn ghost small" id="scrapResult">📌 결과 스크랩</button><button class="btn ghost small" id="copyResult">결과 복사</button></div></div>
    <div class="summary">
      <div class="stat"><span>분석 학교</span><b>${targets.length}개교</b></div>
      <div class="stat"><span>전체 급식일</span><b>${state.loaded.length}일</b></div>
      <div class="stat"><span>기준 메뉴 편성</span><b>${a.meals.length}회</b></div>
    </div>
    <div class="analysis">
      ${rankCard('함께 편성한 주찬',a.main)}
      ${rankCard('함께 편성한 부찬',a.side)}
    </div>
    <div class="section-title"><div><h2>실제 식단 카드</h2><p>나이스 API에서 검색된 학교별 실제 편성 식단입니다. 내 학교가 맨 왼쪽, 각 학교는 최신 날짜순입니다.</p></div></div>
    ${renderMealsBySchool(a.meals,targets,keyword)}`;
  $('#copyResult').onclick=()=>copySummary(a,keyword);
  $('#scrapResult').onclick=()=>scrapAnalysis(a,keyword);
  bindMealCards();
}
function renderMealsBySchool(meals,targets,keyword){
  if(!meals.length)return '<div class="empty">검색 메뉴가 포함된 실제 식단이 없습니다.</div>';
  if(targets.length<2)return `<div class="meals">${meals.map(m=>mealCard(m,keyword)).join('')}</div>`;
  const bySchool=new Map();
  targets.forEach(t=>bySchool.set(schoolKey(t),[]));
  meals.forEach(m=>{const k=schoolKey(m.school);if(!bySchool.has(k))bySchool.set(k,[]);bySchool.get(k).push(m)});
  return `<div class="school-cols" style="--cols:${targets.length}">
    ${targets.map(t=>{
      const items=(bySchool.get(schoolKey(t))||[]).sort((a,b)=>b.date.localeCompare(a.date));
      const isMine=state.mine&&t.schoolCode===state.mine.schoolCode;
      return `<div class="school-col">
        <h3 class="school-col-title">${esc(t.schoolName)} ${isMine?'<span class="mine-tag">내 학교</span>':''}<small class="help" style="margin-left:6px">${items.length}일</small></h3>
        ${items.length?items.map(m=>mealCard(m,keyword)).join(''):'<div class="empty">해당 기간 편성 없음</div>'}
      </div>`;
    }).join('')}
  </div>`;
}
function rankCard(title,items){
  return `<div class="card rank-card"><h3>${title}</h3>${items.length?items.map((x,i)=>`<div class="rank"><span class="num">${i+1}</span><div><b>${esc(x.name)}</b><small>${x.schools.size}개교 · 최근 ${x.latest?formatDate(x.latest):'-'}</small></div><strong>${x.count}회</strong></div>`).join(''):'<div class="empty">분류된 메뉴가 없습니다.</div>'}</div>`;
}
function mealCard(m,keyword){
  const isMine=state.mine&&m.school.schoolCode===state.mine.schoolCode;
  const dkey=`${m.date.slice(0,4)}-${m.date.slice(4,6)}-${m.date.slice(6,8)}`;
  const rating=state.ratings[dkey];
  return `<article class="card meal"><div class="date">${koreanDate(m.date)}</div><div class="school">${esc(m.school.schoolName)}</div>
    ${m.dishes.map(d=>`<div class="dish ${keyword&&menuMatches(d.name,keyword,state.similar)?'hit':''}">${esc(d.name)} ${d.allergy.length?`<span class="allergy">(${d.allergy.join('·')})</span>`:''}</div>`).join('')}
    <footer>${esc(m.calories||'열량 정보 없음')}</footer>
    ${isMine?`<div class="stars" data-stars="${dkey}">${[1,2,3,4,5].map(n=>`<button class="star ${rating&&rating.stars>=n?'on':''}" data-star="${n}">★</button>`).join('')}<small class="help" style="margin-left:6px">${rating?'내 별점':'내 별점 (나만 보여요)'}</small></div>`:''}
    <div class="row" style="margin-top:11px;gap:6px">
      <button class="btn ghost small" data-scrap-meal='${esc(JSON.stringify({type:'meal',title:m.dishes.map(d=>d.name).slice(0,3).join('·'),menus:m.dishes.map(d=>d.name),date:dkey,school:m.school.schoolName,calories:m.calories||'',sourceType:'식단 카드'}))}'>📌 스크랩</button>
      <button class="btn ghost small" data-copy-meal="${esc(m.dishes.map(d=>d.name).join(' / '))}">복사</button>
    </div>
  </article>`;
}
function bindMealCards(){
  $$('[data-copy-meal]').forEach(b=>b.onclick=()=>{navigator.clipboard.writeText(b.dataset.copyMeal);alert('복사했습니다.')});
  $$('[data-scrap-meal]').forEach(b=>b.onclick=()=>openScrapModal(JSON.parse(b.dataset.scrapMeal)));
  $$('[data-stars]').forEach(box=>{
    const dkey=box.dataset.stars;
    box.querySelectorAll('.star').forEach(st=>st.onclick=()=>{
      const n=+st.dataset.star;
      const cur=state.ratings[dkey];
      if(cur&&cur.stars===n)delete state.ratings[dkey];
      else state.ratings[dkey]={...(cur||{}),stars:n};
      persist();
      box.querySelectorAll('.star').forEach(s2=>s2.classList.toggle('on',state.ratings[dkey]&&state.ratings[dkey].stars>=+s2.dataset.star));
    });
  });
}
function copySummary(a,keyword){
  const text=[`[${keyword} 식단 조합 분석]`,`주찬: ${a.main.slice(0,10).map(x=>`${x.name} ${x.count}회`).join(', ')}`,`부찬: ${a.side.slice(0,10).map(x=>`${x.name} ${x.count}회`).join(', ')}`,`실제 식단 ${a.meals.length}건`].join('\n');
  navigator.clipboard.writeText(text);alert('분석 결과를 복사했습니다.');
}
function scrapAnalysis(a,keyword){
  const from=$('#from')?.value||'',to=$('#to')?.value||'';
  openScrapModal({
    type:'idea',
    title:`'${keyword}' 조합 분석`,
    menus:[`주찬: ${a.main.slice(0,5).map(x=>x.name).join(', ')}`,`부찬: ${a.side.slice(0,5).map(x=>x.name).join(', ')}`],
    date:dateISO(new Date()),school:'분석 결과',
    sourceType:'조합 분석',sourcePeriod:from&&to?`${from}~${to}`:''
  });
}

/* ══ 스크랩 모달 ══ */
function openScrapModal(item){
  const m=$('#modal');
  const type=item.type||'meal';
  m.innerHTML=`<div class="modal"><div class="modal-card">
    <h2>📌 스크랩 저장</h2>
    <p class="help">${esc(item.school||'')} ${item.date?'· '+esc(item.date):''}</p>
    <div class="field" style="margin:10px 0"><label>유형</label>
      <div class="row" style="gap:6px">
        <button class="btn ${type==='meal'?'':'ghost'} small" id="typeMeal">🍱 전체 식단</button>
        <button class="btn ${type==='idea'?'':'ghost'} small" id="typeIdea">💡 메뉴 아이디어</button>
      </div>
    </div>
    <div class="field" style="margin:10px 0"><label>제목</label><input id="scrapTitle" value="${esc(item.title||'')}"></div>
    <div class="field" style="margin-bottom:10px"><label>폴더</label>
      <div class="row" style="gap:6px">
        <select id="scrapFolder" style="flex:1">${state.folders.map(f=>`<option>${esc(f)}</option>`).join('')}</select>
        <button class="btn ghost small" id="newFolder">+ 새 폴더</button>
      </div>
    </div>
    <div class="field" style="margin-bottom:10px"><label>별점 (선택)</label>
      <div class="stars" id="scrapStars">${[1,2,3,4,5].map(n=>`<button class="star" data-star="${n}">★</button>`).join('')}</div>
    </div>
    <div class="field"><label>메모 (선택)</label><textarea id="scrapMemo" placeholder="예: 학생 반응 좋았음, 배식 편했음" style="width:100%;min-height:70px"></textarea></div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px">
      <button class="btn ghost" id="scrapCancel">취소</button>
      <button class="btn" id="scrapSave">저장</button>
    </div>
  </div></div>`;
  let curType=type,curStars=0;
  const paint=()=>{
    $('#typeMeal').className=`btn ${curType==='meal'?'':'ghost'} small`;
    $('#typeIdea').className=`btn ${curType==='idea'?'':'ghost'} small`;
    $$('#scrapStars .star').forEach(b=>b.classList.toggle('on',+b.dataset.star<=curStars));
  };
  $('#typeMeal').onclick=()=>{curType='meal';paint()};
  $('#typeIdea').onclick=()=>{curType='idea';paint()};
  $$('#scrapStars .star').forEach(b=>b.onclick=()=>{curStars=curStars===+b.dataset.star?0:+b.dataset.star;paint()});
  $('#scrapCancel').onclick=()=>m.innerHTML='';
  $('#newFolder').onclick=()=>{
    const name=prompt('새 폴더 이름');
    if(name&&!state.folders.includes(name)){state.folders.push(name);persist();
      $('#scrapFolder').innerHTML=state.folders.map(f=>`<option ${f===name?'selected':''}>${esc(f)}</option>`).join('')}
  };
  $('#scrapSave').onclick=()=>{
    const menus=Array.isArray(item.menus)?item.menus:[];
    const scrap={
      schemaV:2,
      id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      type:curType,
      folder:$('#scrapFolder').value,
      title:$('#scrapTitle').value.trim()||item.title||'제목 없음',
      school:item.school||'',servedDate:item.date||'',
      menus,calories:item.calories||'',stars:curStars,memo:$('#scrapMemo').value.trim(),
      savedAt:dateISO(new Date()),
      sourceType:item.sourceType||'식단 카드',sourcePeriod:item.sourcePeriod||'',
      snapshot:item.snapshot||null
    };
    if(curType==='meal')Object.assign(scrap,splitMenus(menus));
    state.scraps.unshift(scrap);
    persist();m.innerHTML='';alert('📌 스크랩했습니다!');
    if(state.tab==='scrap')renderScrapbook();
  };
}
function bindIdeaScraps(){
  $$('[data-scrap-idea]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    openScrapModal(JSON.parse(b.dataset.scrapIdea));
  });
}

/* ══ 스크랩북 탭 ══ */
const scrapView={q:'',scope:'all',folder:'전체',type:'all',stars:0,from:'',to:'',sort:'savedAt',selected:new Set()};
function scrapText(sc,scope){
  const j=a=>(a||[]).join(' ');
  switch(scope){
    case 'rice':return j(sc.rice);case 'soup':return j(sc.soup);case 'kimchi':return j(sc.kimchi);
    case 'main':return j(sc.main);case 'side':return j(sc.side);case 'dessert':return j(sc.dessert);
    case 'school':return sc.school||'';
    default:return [sc.title,j(sc.menus),sc.school,sc.memo].join(' ');
  }
}
function filteredScraps(){
  const v=scrapView,q=v.q.trim();
  let list=state.scraps.filter(sc=>{
    if(v.folder!=='전체'&&sc.folder!==v.folder)return false;
    if(v.type!=='all'&&sc.type!==v.type)return false;
    if(v.stars&&(sc.stars||0)<v.stars)return false;
    if(v.from&&(!sc.servedDate||sc.servedDate<v.from))return false;
    if(v.to&&(!sc.servedDate||sc.servedDate>v.to))return false;
    if(q&&!scrapText(sc,v.scope).replace(/\s+/g,'').includes(q.replace(/\s+/g,'')))return false;
    return true;
  });
  const dir={savedAt:(a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)),
    servedDate:(a,b)=>String(b.servedDate).localeCompare(String(a.servedDate)),
    stars:(a,b)=>(b.stars||0)-(a.stars||0),
    title:(a,b)=>String(a.title).localeCompare(String(b.title),'ko')};
  return list.sort(dir[v.sort]||dir.savedAt);
}
function renderScrapbook(){
  const c=$('#controls');
  scrapView.selected=new Set([...scrapView.selected].filter(id=>state.scraps.some(sc=>sc.id===id)));
  const list=filteredScraps();
  const counts={};state.scraps.forEach(sc=>counts[sc.folder]=(counts[sc.folder]||0)+1);
  c.innerHTML=`<section class="panel">
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <h2 style="margin:0">📌 내 스크랩북</h2>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <span class="help" style="margin:0">${state.scraps.length}개 저장 · ${user?'☁ 클라우드 동기화 중':'⚠ 로그인하면 클라우드에 저장돼요'}</span>
        <button class="btn ghost small" id="folderManage">📁 폴더 관리</button>
        <button class="btn ghost small" id="jsonBackup">JSON 백업</button>
        <button class="btn ghost small" id="jsonRestore">JSON 복원</button>
      </div>
    </div>
    <div class="chips" style="margin:12px 0 4px">
      <button class="chip folder-chip ${scrapView.folder==='전체'?'chip-on':''}" data-fchip="전체">전체 ${state.scraps.length}</button>
      ${state.folders.map(f=>`<button class="chip folder-chip ${scrapView.folder===f?'chip-on':''}" data-fchip="${esc(f)}">${esc(f)} ${counts[f]||0}</button>`).join('')}
    </div>
    <div class="grid scrap-filter">
      <div class="field"><label>검색</label>
        <div class="row" style="gap:6px">
          <select id="svScope" style="width:96px">${[['all','전체'],['rice','밥'],['soup','국·찌개'],['kimchi','김치'],['main','주찬'],['side','부찬'],['dessert','후식'],['school','학교명']].map(([v,l])=>`<option value="${v}" ${scrapView.scope===v?'selected':''}>${l}</option>`).join('')}</select>
          <input id="svQ" placeholder="메뉴·제목·메모 검색" value="${esc(scrapView.q)}" style="flex:1;min-width:0">
        </div>
      </div>
      <div class="field"><label>유형 / 별점</label>
        <div class="row" style="gap:6px">
          <select id="svType" style="flex:1"><option value="all" ${scrapView.type==='all'?'selected':''}>모든 유형</option><option value="meal" ${scrapView.type==='meal'?'selected':''}>🍱 전체 식단</option><option value="idea" ${scrapView.type==='idea'?'selected':''}>💡 메뉴 아이디어</option></select>
          <select id="svStars" style="flex:1">${[0,1,2,3,4,5].map(n=>`<option value="${n}" ${scrapView.stars===n?'selected':''}>${n?'★'.repeat(n)+' 이상':'별점 전체'}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field"><label>제공일 범위</label>
        <div class="row" style="gap:6px">
          <input id="svFrom" type="date" value="${scrapView.from}" style="flex:1;min-width:0">
          <input id="svTo" type="date" value="${scrapView.to}" style="flex:1;min-width:0">
        </div>
      </div>
      <div class="field"><label>정렬</label>
        <select id="svSort">${[['savedAt','저장일순'],['servedDate','제공일순'],['stars','별점순'],['title','제목순']].map(([v,l])=>`<option value="${v}" ${scrapView.sort===v?'selected':''}>${l}</option>`).join('')}</select>
      </div>
    </div>
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:12px">
      <label class="help" style="margin:0;display:flex;align-items:center;gap:6px"><input type="checkbox" id="svAll" ${list.length&&list.every(sc=>scrapView.selected.has(sc.id))?'checked':''}> 현재 목록 전체 선택 (${list.length}개)</label>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        ${scrapView.selected.size?`<span class="help" style="margin:0;font-weight:900;color:#4047bd">${scrapView.selected.size}개 선택</span>
        <button class="btn ghost small" id="selMove">폴더 이동</button>
        <button class="btn danger small" id="selDel">삭제</button>`:''}
        <button class="btn ghost small" id="csvExport">CSV 내보내기 (${scrapView.selected.size?'선택':'현재 목록'})</button>
        <button class="btn ghost small" id="printScraps">🖨 인쇄·PDF (${scrapView.selected.size?'선택':'현재 목록'})</button>
      </div>
    </div>
    ${list.length?renderScrapList(list)
      :`<div class="empty" style="margin-top:14px">${state.scraps.length?'조건에 맞는 스크랩이 없어요. 필터를 조정해보세요.':'아직 스크랩이 없어요. 식단 카드의 📌 스크랩 버튼을 눌러보세요!'}</div>`}
  </section>`;
  bindScrapbook(list);
}
function renderScrapList(list){
  if(scrapView.folder!=='전체')return `<div class="meals" style="margin-top:14px">${list.map(scrapCard).join('')}</div>`;
  const known=new Set(state.folders);
  const groups=state.folders.map(f=>[f,list.filter(sc=>sc.folder===f)]).filter(([,a])=>a.length);
  const orphan=list.filter(sc=>!known.has(sc.folder));
  if(orphan.length)groups.push(['기타',orphan]);
  return groups.map(([f,arr])=>`
    <h3 class="scrap-folder-head">📁 ${esc(f)} <small class="help">${arr.length}개</small></h3>
    <div class="meals">${arr.map(scrapCard).join('')}</div>`).join('');
}
function scrapCard(sc){
  const sel=scrapView.selected.has(sc.id);
  const catRow=(label,arr)=>arr&&arr.length?`<div class="scrap-cat"><span>${label}</span><b>${esc(arr.join(', '))}</b></div>`:'';
  return `<article class="card meal scrap-item ${sel?'scrap-sel':''}">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" data-sel="${sc.id}" ${sel?'checked':''}>
        <span class="type-badge ${sc.type==='meal'?'tb-meal':'tb-idea'}">${sc.type==='meal'?'🍱 전체 식단':'💡 아이디어'}</span>
      </label>
      <span class="help" style="margin:0">📁 ${esc(sc.folder)}</span>
    </div>
    <b style="display:block;margin:7px 0 2px;font-size:15px">${esc(sc.title)}</b>
    <div class="school">${esc(sc.school||'')} ${sc.servedDate?'· '+esc(sc.servedDate):''} ${sc.calories?'· '+esc(sc.calories):''}</div>
    ${sc.type==='meal'?`
      ${catRow('밥',sc.rice)}${catRow('국·찌개',sc.soup)}${catRow('김치',sc.kimchi)}${catRow('주찬',sc.main)}${catRow('부찬',sc.side)}${catRow('후식',sc.dessert)}`
    :`${(sc.menus||[]).map(mn=>`<div class="dish">${esc(mn)}</div>`).join('')}
      ${sc.snapshot?`<div class="help" style="margin-top:6px">${sc.snapshot.count?esc(String(sc.snapshot.count))+'회':''} ${sc.snapshot.schools?'· '+esc(sc.snapshot.schools.slice(0,3).join(', '))+(sc.snapshot.schools.length>3?' 외 '+(sc.snapshot.schools.length-3)+'개교':''):''} ${sc.snapshot.asOf?'· '+esc(sc.snapshot.asOf)+' 기준':''}</div>`:''}`}
    <div class="stars" data-scrap-stars="${sc.id}">${[1,2,3,4,5].map(n=>`<button class="star ${(sc.stars||0)>=n?'on':''}" data-star="${n}">★</button>`).join('')}</div>
    ${sc.memo?`<div class="memo">📝 ${esc(sc.memo)}</div>`:''}
    <div class="help" style="margin-top:6px">저장 ${esc(sc.savedAt)} · ${esc(sc.sourceType||'')}${sc.sourcePeriod?' · '+esc(sc.sourcePeriod):''}</div>
    <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
      <button class="btn ghost small" data-edit-memo="${sc.id}">메모</button>
      <button class="btn ghost small" data-move-scrap="${sc.id}">폴더 이동</button>
      <button class="btn ghost small" data-del-scrap="${sc.id}">삭제</button>
    </div>
  </article>`;
}
function bindScrapbook(list){
  $$('[data-fchip]').forEach(b=>b.onclick=()=>{scrapView.folder=b.dataset.fchip;renderScrapbook()});
  const upd=()=>renderScrapbook();
  $('#svQ').oninput=e=>{scrapView.q=e.target.value;clearTimeout(window._svT);window._svT=setTimeout(upd,350)};
  $('#svScope').onchange=e=>{scrapView.scope=e.target.value;upd()};
  $('#svType').onchange=e=>{scrapView.type=e.target.value;upd()};
  $('#svStars').onchange=e=>{scrapView.stars=+e.target.value;upd()};
  $('#svFrom').onchange=e=>{scrapView.from=e.target.value;upd()};
  $('#svTo').onchange=e=>{scrapView.to=e.target.value;upd()};
  $('#svSort').onchange=e=>{scrapView.sort=e.target.value;upd()};
  $('#svAll').onchange=e=>{
    if(e.target.checked)list.forEach(sc=>scrapView.selected.add(sc.id));
    else list.forEach(sc=>scrapView.selected.delete(sc.id));
    upd();
  };
  $$('[data-sel]').forEach(cb=>cb.onchange=()=>{
    cb.checked?scrapView.selected.add(cb.dataset.sel):scrapView.selected.delete(cb.dataset.sel);
    renderScrapbook();
  });
  $$('[data-scrap-stars]').forEach(box=>{
    const id=box.dataset.scrapStars;
    box.querySelectorAll('.star').forEach(st=>st.onclick=()=>{
      const sc=state.scraps.find(x=>x.id===id);if(!sc)return;
      const n=+st.dataset.star;
      sc.stars=sc.stars===n?0:n;
      persist();renderScrapbook();
    });
  });
  $$('[data-del-scrap]').forEach(b=>b.onclick=()=>{
    if(!confirm('이 스크랩을 삭제할까요?'))return;
    state.scraps=state.scraps.filter(sc=>sc.id!==b.dataset.delScrap);persist();renderScrapbook();
  });
  $$('[data-edit-memo]').forEach(b=>b.onclick=()=>{
    const sc=state.scraps.find(x=>x.id===b.dataset.editMemo);
    const memo=prompt('메모 수정',sc.memo||'');
    if(memo!==null){sc.memo=memo.trim();persist();renderScrapbook()}
  });
  $$('[data-move-scrap]').forEach(b=>b.onclick=()=>moveScraps([b.dataset.moveScrap]));
  const selBtn=$('#selMove');if(selBtn)selBtn.onclick=()=>moveScraps([...scrapView.selected]);
  const selDel=$('#selDel');if(selDel)selDel.onclick=()=>{
    if(!confirm(`선택한 ${scrapView.selected.size}개 스크랩을 삭제할까요?`))return;
    state.scraps=state.scraps.filter(sc=>!scrapView.selected.has(sc.id));
    scrapView.selected.clear();persist();renderScrapbook();
  };
  $('#folderManage').onclick=openFolderModal;
  $('#csvExport').onclick=()=>exportCSV(scrapView.selected.size?state.scraps.filter(sc=>scrapView.selected.has(sc.id)):list);
  $('#printScraps').onclick=()=>printScraps(scrapView.selected.size?state.scraps.filter(sc=>scrapView.selected.has(sc.id)):list);
  $('#jsonBackup').onclick=backupJSON;
  $('#jsonRestore').onclick=openRestoreModal;
}
function moveScraps(ids){
  const name=prompt('이동할 폴더 이름을 그대로 입력하세요:\n'+state.folders.join(' / '));
  if(name===null)return;
  const f=name.trim();
  if(!state.folders.includes(f)){alert('없는 폴더예요. 폴더 관리에서 먼저 만들어주세요.');return}
  state.scraps.forEach(sc=>{if(ids.includes(sc.id))sc.folder=f});
  persist();renderScrapbook();
}
/* ══ 폴더 관리 ══ */
function openFolderModal(){
  const m=$('#modal');
  const counts={};state.scraps.forEach(sc=>counts[sc.folder]=(counts[sc.folder]||0)+1);
  m.innerHTML=`<div class="modal"><div class="modal-card">
    <h2>📁 폴더 관리</h2>
    <p class="help">순서 변경(↑↓), 이름 변경(✏), 삭제(🗑)가 가능해요. <b>${esc(state.baseFolder)}</b>는 삭제된 폴더의 스크랩을 받는 기본 폴더라 삭제할 수 없어요(이름 변경은 가능).</p>
    <div id="folderList" class="school-results" style="max-height:320px">
      ${state.folders.map((f,i)=>`<div class="folder-row">
        <b style="flex:1">${esc(f)} <small class="help">${counts[f]||0}개</small> ${f===state.baseFolder?'<span class="mine-tag">기본</span>':''}</b>
        <button class="btn ghost small" data-fup="${i}" ${i===0?'disabled':''}>↑</button>
        <button class="btn ghost small" data-fdown="${i}" ${i===state.folders.length-1?'disabled':''}>↓</button>
        <button class="btn ghost small" data-fren="${i}">✏</button>
        <button class="btn ghost small" data-fdel="${i}" ${f===state.baseFolder?'disabled':''}>🗑</button>
      </div>`).join('')}
    </div>
    <div class="searchrow"><input id="newFolderName" placeholder="새 폴더 이름"><button class="btn" id="addFolder">추가</button></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" id="closeModal">닫기</button></div>
  </div></div>`;
  $('#closeModal').onclick=()=>{m.innerHTML='';renderScrapbook()};
  $('#addFolder').onclick=()=>{
    const name=$('#newFolderName').value.trim();
    if(!name)return;
    if(state.folders.includes(name)){alert('이미 있는 폴더예요.');return}
    state.folders.push(name);persist();openFolderModal();
  };
  $$('[data-fup]').forEach(b=>b.onclick=()=>{const i=+b.dataset.fup;[state.folders[i-1],state.folders[i]]=[state.folders[i],state.folders[i-1]];persist();openFolderModal()});
  $$('[data-fdown]').forEach(b=>b.onclick=()=>{const i=+b.dataset.fdown;[state.folders[i+1],state.folders[i]]=[state.folders[i],state.folders[i+1]];persist();openFolderModal()});
  $$('[data-fren]').forEach(b=>b.onclick=()=>{
    const i=+b.dataset.fren,old=state.folders[i];
    const name=prompt('새 이름',old);
    if(!name||name.trim()===old)return;
    const nn=name.trim();
    if(state.folders.includes(nn)){alert('이미 있는 폴더예요.');return}
    state.folders[i]=nn;
    state.scraps.forEach(sc=>{if(sc.folder===old)sc.folder=nn});
    if(state.baseFolder===old)state.baseFolder=nn;
    persist();openFolderModal();
  });
  $$('[data-fdel]').forEach(b=>b.onclick=()=>{
    const i=+b.dataset.fdel,f=state.folders[i];
    if(f===state.baseFolder)return;
    const inside=state.scraps.filter(sc=>sc.folder===f);
    if(inside.length){
      if(confirm(`'${f}' 폴더에 스크랩 ${inside.length}개가 있어요.\n\n[확인] = 스크랩을 '${state.baseFolder}'(으)로 옮기고 폴더만 삭제\n[취소] = 다음 단계에서 함께 삭제 여부 선택`)){
        inside.forEach(sc=>sc.folder=state.baseFolder);
      }else if(confirm(`정말 스크랩 ${inside.length}개를 폴더와 함께 삭제할까요? 되돌릴 수 없어요.`)){
        state.scraps=state.scraps.filter(sc=>sc.folder!==f);
      }else return;
    }else if(!confirm(`'${f}' 폴더를 삭제할까요?`))return;
    state.folders.splice(i,1);
    if(scrapView.folder===f)scrapView.folder='전체';
    persist();openFolderModal();
  });
}
/* ══ CSV 내보내기 (엑셀에서 바로 열려요) ══ */
function csvCell(v){v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function exportCSV(items){
  if(!items.length){alert('내보낼 스크랩이 없어요.');return}
  const head=['폴더','유형','식단 제목','학교명','제공일','밥','국·찌개','김치','주찬','부찬','후식','전체 식단','열량','별점','메모','저장일','원본 유형','분석 기간'];
  const j=a=>(a||[]).join(' / ');
  const rows=items.map(sc=>[
    sc.folder,sc.type==='meal'?'전체 식단':'메뉴 아이디어',sc.title,sc.school,sc.servedDate,
    j(sc.rice),j(sc.soup),j(sc.kimchi),j(sc.main),j(sc.side),j(sc.dessert),
    j(sc.menus),sc.calories,sc.stars||'',sc.memo,sc.savedAt,sc.sourceType,sc.sourcePeriod
  ].map(csvCell).join(','));
  const csv='\uFEFF'+head.map(csvCell).join(',')+'\n'+rows.join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download=`나의식단스크랩_${dateISO(new Date())}.csv`;
  a.click();URL.revokeObjectURL(a.href);
}
/* ══ 인쇄 · PDF ══ */
function printScraps(items){
  if(!items.length){alert('인쇄할 스크랩이 없어요.');return}
  let area=$('#printArea');
  if(!area){area=document.createElement('div');area.id='printArea';document.body.appendChild(area)}
  const byFolder={};
  items.forEach(sc=>{(byFolder[sc.folder]=byFolder[sc.folder]||[]).push(sc)});
  const j=a=>(a||[]).join(', ');
  area.innerHTML=`<h1>나의 식단 스크랩</h1><p class="p-meta">출력일 ${dateISO(new Date())} · ${items.length}개</p>
  ${Object.entries(byFolder).map(([f,arr])=>`<h2>📁 ${esc(f)} (${arr.length})</h2>
    ${arr.map(sc=>`<div class="p-card">
      <div class="p-title">${esc(sc.title)} <span class="p-type">${sc.type==='meal'?'전체 식단':'메뉴 아이디어'}</span>${sc.stars?` <span class="p-stars">${'★'.repeat(sc.stars)}</span>`:''}</div>
      <div class="p-sub">${esc(sc.school||'')} ${sc.servedDate?'· '+esc(sc.servedDate):''} ${sc.calories?'· '+esc(sc.calories):''} · 저장 ${esc(sc.savedAt)} · ${esc(sc.sourceType||'')}</div>
      ${sc.type==='meal'
        ?['rice','soup','kimchi','main','side','dessert'].filter(k=>sc[k]&&sc[k].length).map(k=>`<div class="p-row"><span>${CAT_LABEL[k]}</span>${esc(j(sc[k]))}</div>`).join('')
        :`<div class="p-row"><span>메뉴</span>${esc(j(sc.menus))}</div>`}
      ${sc.memo?`<div class="p-memo">📝 ${esc(sc.memo)}</div>`:''}
    </div>`).join('')}`).join('')}`;
  window.print();
}
/* ══ JSON 백업 · 복원 ══ */
function backupJSON(){
  const data={app:'meal-archive-scraps',version:2,exportedAt:new Date().toISOString(),
    folders:state.folders,baseFolder:state.baseFolder,scraps:state.scraps};
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download=`나의식단스크랩_백업_${dateISO(new Date())}.json`;
  a.click();URL.revokeObjectURL(a.href);
}
function openRestoreModal(){
  const m=$('#modal');
  m.innerHTML=`<div class="modal"><div class="modal-card">
    <h2>JSON 복원</h2>
    <p class="help">이 앱에서 백업한 JSON 파일만 복원할 수 있어요.</p>
    <input type="file" id="restoreFile" accept=".json,application/json" style="margin:12px 0">
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
      <button class="btn" id="restoreMerge">기존 자료와 합치기</button>
      <button class="btn danger" id="restoreReplace">전체 교체</button>
      <button class="btn ghost" id="closeModal">닫기</button>
    </div>
    <div class="help" style="margin-top:10px">합치기: 같은 스크랩(id 기준)은 건너뛰어 중복을 막아요.<br>전체 교체: 현재 스크랩·폴더를 백업 파일 내용으로 완전히 바꿔요.</div>
  </div></div>`;
  $('#closeModal').onclick=()=>m.innerHTML='';
  const readFile=()=>new Promise((res,rej)=>{
    const f=$('#restoreFile').files[0];
    if(!f)return rej(new Error('파일을 먼저 선택해주세요.'));
    const r=new FileReader();
    r.onload=()=>{try{res(JSON.parse(r.result))}catch{rej(new Error('JSON 형식이 아니에요. 올바른 백업 파일인지 확인해주세요.'))}};
    r.onerror=()=>rej(new Error('파일을 읽지 못했어요.'));
    r.readAsText(f);
  });
  const validate=d=>{
    if(!d||d.app!=='meal-archive-scraps'||!Array.isArray(d.scraps))throw new Error('이 앱의 백업 파일이 아니에요.');
    return d;
  };
  $('#restoreMerge').onclick=async()=>{
    try{
      const d=validate(await readFile());
      const existing=new Set(state.scraps.map(sc=>sc.id));
      let added=0;
      d.scraps.forEach(sc=>{if(sc&&sc.id&&!existing.has(sc.id)){state.scraps.push(sc);added++}});
      (d.folders||[]).forEach(f=>{if(!state.folders.includes(f))state.folders.push(f)});
      migrateScraps();persist();m.innerHTML='';
      alert(`복원 완료! ${added}개를 추가했어요. (중복 ${d.scraps.length-added}개 건너뜀)`);
      renderScrapbook();
    }catch(e){alert(e.message)}
  };
  $('#restoreReplace').onclick=async()=>{
    try{
      const d=validate(await readFile());
      if(!confirm(`현재 스크랩 ${state.scraps.length}개를 모두 지우고 백업의 ${d.scraps.length}개로 교체할까요?`))return;
      state.scraps=d.scraps;
      state.folders=Array.isArray(d.folders)&&d.folders.length?d.folders:[...DEFAULT_FOLDERS];
      if(d.baseFolder)state.baseFolder=d.baseFolder;
      migrateScraps();persist();m.innerHTML='';
      alert('전체 교체 완료!');renderScrapbook();
    }catch(e){alert(e.message)}
  };
}

/* ══ 트렌드 탭 ══ */
async function analyzeTrend(){
  const targets=[state.mine,...state.comparisons].filter(Boolean);
  if(!targets.length){openSchoolModal('mine');return}
  setStatus(`<span class="loading"></span>${targets.length}개 학교의 최근 30일 식단을 분석하고 있습니다.`);
  try{
    const results=await Promise.all(targets.map(s=>fetchMeals(s,monthAgo(),dateISO(new Date()))));
    const rows=results.flat();
    const myMenus=new Set();
    rows.filter(r=>state.mine&&r.school.schoolCode===state.mine.schoolCode)
        .forEach(r=>parseDishes(r.dishes).forEach(d=>myMenus.add(normalize(d.name))));
    const cats={rice:new Map(),soup:new Map(),kimchi:new Map(),main:new Map(),side:new Map(),dessert:new Map()};
    rows.forEach(r=>parseDishes(r.dishes).forEach(d=>{
      const cat=classify(d.name);
      if(!cats[cat])return;
      addCount(cats[cat],d,r.school,r.date);
    }));
    setStatus(`${targets.length}개교 · 최근 30일 급식 ${rows.length}일 분석 완료`);
    $('#results').innerHTML=`
      <div class="section-title"><div><h2>🔥 최근 30일 인기 메뉴</h2><p>기준일 ${dateISO(new Date())} · 최근 30일 자동 반영 · ${targets.map(s=>esc(s.schoolName)).join(', ')}</p></div></div>
      <div class="trend-grid">
      ${['rice','soup','kimchi','main','side','dessert'].map(cat=>{
        const map=cats[cat];
        const items=[...map.values()].sort((a,b)=>b.count-a.count||b.schools.size-a.schools.size).slice(0,30);
        return `<div class="card rank-card trend-col"><h3>${CAT_LABEL[cat]} TOP 30</h3>
        ${items.length?items.map((x,i)=>{
          const isNew=!myMenus.has(normalize(x.name));
          const idea=esc(JSON.stringify({type:'idea',title:x.name,menus:[x.name],date:dateISO(new Date()),school:[...x.schools].slice(0,3).join(', '),sourceType:'요즘 뜨는 메뉴',sourcePeriod:`${monthAgo()}~${dateISO(new Date())}`,snapshot:{count:x.count,schools:[...x.schools],asOf:dateISO(new Date())}}));
          return `<div class="rank"><span class="num">${i+1}</span><div><b>${esc(x.name)} ${isNew?'<span class="new-badge">✨NEW</span>':''}</b><small>${x.schools.size}개교 · ${x.count}회</small></div><button class="memo-btn" data-scrap-idea='${idea}' title="메뉴 아이디어로 스크랩">📌</button></div>`
        }).join(''):'<div class="empty">데이터 없음</div>'}</div>`;
      }).join('')}
      </div>
      <p class="help" style="margin-top:10px">✨NEW = 최근 30일 내 학교 식단에 없었던 메뉴예요. 새 아이디어로 참고해보세요!</p>`;
    bindIdeaScraps();
  }catch(e){setStatus(e.message,true)}
}

/* ══ 리포트 탭 ══ */
let _report=null; // 마지막 리포트 데이터 (메모 수정 시 재렌더용)
async function analyzeReport(){
  if(!state.mine){openSchoolModal('mine');return}
  const from=$('#rFrom').value,to=$('#rTo').value,keyword=($('#rKeyword')?.value||'').trim();
  if(!from||!to){setStatus('기간을 입력하세요.',true);return}
  const days=(new Date(to)-new Date(from))/86400000;
  if(days<0||days>370){setStatus('조회 기간은 최대 1년이며 종료일이 시작일보다 늦어야 합니다.',true);return}
  const today=dateISO(new Date());
  const d90=(()=>{const d=new Date();d.setDate(d.getDate()-89);return dateISO(d)})();
  setStatus('<span class="loading"></span>내 학교와 비교학교 식단을 불러오고 있습니다.');
  const tasks=[
    fetchMeals(state.mine,from,to),
    fetchMeals(state.mine,d90,today),
    ...state.comparisons.map(s=>fetchMeals(s,d90,today))
  ];
  const settled=await Promise.allSettled(tasks);
  if(settled[0].status==='rejected'){setStatus(settled[0].reason.message,true);return}
  const rows=settled[0].value;
  const my90=settled[1].status==='fulfilled'?settled[1].value:[];
  const compRows=[],failedSchools=[];
  settled.slice(2).forEach((r,i)=>{
    if(r.status==='fulfilled')compRows.push(...r.value);
    else failedSchools.push(state.comparisons[i].schoolName);
  });
  if(!rows.length){setStatus(`${from} ~ ${to} 기간에 나이스에 등록된 내 학교 식단이 없어 분석할 수 없습니다.`,true);return}
  _report={rows,my90,compRows,failedSchools,from,to,keyword,today,d90};
  renderReport();
}

function renderReport(){
  const {rows,my90,compRows,failedSchools,from,to,keyword,today,d90}=_report;
  /* 분류별 집계 */
  const cats={rice:new Map(),soup:new Map(),kimchi:new Map(),main:new Map(),side:new Map(),dessert:new Map()};
  const menuMap=new Map();
  rows.forEach(r=>parseDishes(r.dishes).forEach(d=>{
    const key=normalize(d.name);if(!key)return;
    const v=menuMap.get(key)||{name:d.name,count:0,latest:'',cat:classify(d.name)};
    v.count++;if(r.date>v.latest)v.latest=r.date;menuMap.set(key,v);
    addCount(cats[v.cat],d,r.school,r.date);
  }));
  const all=[...menuMap.values()];
  /* 오래 안 쓴 메뉴 (종료일 기준 3개월) */
  const staleLine=(()=>{const d=new Date(to);d.setMonth(d.getMonth()-3);return dateISO(d).replace(/-/g,'')})();
  const stale=all.filter(x=>x.latest<staleLine&&x.count>=2).sort((a,b)=>a.latest.localeCompare(b.latest)).slice(0,15);
  /* 별점 */
  const ratedDays=Object.entries(state.ratings).filter(([k,v])=>v.stars&&k>=from&&k<=to);
  /* 90일 인기 (내 학교 + 비교학교) */
  const my90Set=new Set();
  my90.forEach(r=>parseDishes(r.dishes).forEach(d=>my90Set.add(normalize(d.name))));
  const all90=[...my90,...compRows];
  const cats90={rice:new Map(),soup:new Map(),kimchi:new Map(),main:new Map(),side:new Map(),dessert:new Map()};
  all90.forEach(r=>parseDishes(r.dishes).forEach(d=>{
    const cat=classify(d.name);if(!cats90[cat])return;
    addCount(cats90[cat],d,r.school,r.date);
  }));
  let refCount=0;
  Object.values(cats90).forEach(map=>[...map.values()].forEach(x=>{if(!my90Set.has(normalize(x.name))&&x.count>=2)refCount++}));
  /* 키워드 분석 */
  let kwHTML='';
  if(keyword){
    const hitDays=rows.filter(r=>parseDishes(r.dishes).some(d=>menuMatches(d.name,keyword,true)))
      .sort((a,b)=>b.date.localeCompare(a.date));
    const combos=analyzeMeals(rows,keyword,true);
    /* 월별 추이 */
    const months=[];{
      const cur=new Date(+from.slice(0,4),+from.slice(5,7)-1,1),endM=to.slice(0,7);
      while(dateISO(cur).slice(0,7)<=endM){months.push(dateISO(cur).slice(0,7));cur.setMonth(cur.getMonth()+1)}
    }
    const perMonth=Object.fromEntries(months.map(m=>[m,0]));
    hitDays.forEach(r=>{const m=`${r.date.slice(0,4)}-${r.date.slice(4,6)}`;if(m in perMonth)perMonth[m]++});
    const maxM=Math.max(1,...Object.values(perMonth));
    kwHTML=`
    <div class="section-title"><div><h2>🔍 '${esc(keyword)}' 상세 분석</h2><p>${from} ~ ${to} · 총 ${hitDays.length}회 편성</p></div></div>
    ${hitDays.length?`
    <div class="card rank-card" style="margin-bottom:14px"><h3>월별 편성 추이</h3>
      <div class="bar-chart">${months.map(m=>`<div class="bar-row"><span class="bar-label">${m.slice(2)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(perMonth[m]/maxM*100)}%"></div></div><span class="bar-val">${perMonth[m]}</span></div>`).join('')}</div>
    </div>
    <div class="analysis">
      <div class="card rank-card"><h3>편성한 날짜 (${hitDays.length}일)</h3>
        <div class="kw-days">${hitDays.map(r=>{
          const dkey=`${r.date.slice(0,4)}-${r.date.slice(4,6)}-${r.date.slice(6,8)}`;
          const rt=state.ratings[dkey];
          return `<div class="kw-day"><b>${formatDate(r.date)}</b>${rt?`<span class="kw-stars">${'★'.repeat(rt.stars)}</span>`:''}</div>`
        }).join('')}</div>
      </div>
      <div class="card rank-card"><h3>함께 낸 조합 TOP</h3>
        ${[...combos.main.slice(0,7).map(x=>({...x,t:'주찬'})),...combos.side.slice(0,7).map(x=>({...x,t:'부찬'}))]
          .sort((a,b)=>b.count-a.count).slice(0,12)
          .map((x,i)=>`<div class="rank"><span class="num">${i+1}</span><div><b>${esc(x.name)}</b><small>${x.t} · 최근 ${formatDate(x.latest)}</small></div><strong>${x.count}회</strong></div>`).join('')||'<div class="empty">함께 낸 메뉴가 없습니다.</div>'}
      </div>
    </div>`:`<div class="empty">이 기간에 '${esc(keyword)}'를 편성한 날이 없습니다.</div>`}`;
  }
  /* 학교명 표시 (처음 3개 + 외 N개교 펼치기) */
  const schoolsHTML=(set,idx)=>{
    const arr=[...set];
    if(arr.length<=3)return esc(arr.join(', '));
    return `<span class="sch-short" data-sch="${idx}">${esc(arr.slice(0,3).join(', '))} <button class="sch-more" data-sch-btn="${idx}">외 ${arr.length-3}개교</button></span><span class="sch-full hidden" data-sch-full="${idx}">${esc(arr.join(', '))}</span>`;
  };
  let schIdx=0;
  /* 분류별 TOP 30 (메모 포함) */
  const catCols=['rice','soup','kimchi','main','side','dessert'].map(cat=>{
    const items=[...cats[cat].values()].sort((a,b)=>b.count-a.count).slice(0,30);
    return `<div class="card rank-card trend-col"><h3>${CAT_LABEL[cat]} TOP 30</h3>
      ${items.length?items.map((x,i)=>{
        const key=normalize(x.name);
        const memo=state.menuMemos[key];
        return `<div class="rank"><span class="num">${i+1}</span>
          <div><b>${esc(x.name)}</b><small>${x.count}회 · 최근 ${formatDate(x.latest)}</small>${memo?`<div class="menu-memo">📝 ${esc(memo)}</div>`:''}</div>
          <button class="memo-btn" data-menu-memo="${esc(key)}" data-menu-name="${esc(x.name)}" title="메뉴 메모">📝</button></div>`
      }).join(''):'<div class="empty">데이터 없음</div>'}</div>`;
  }).join('');
  /* 90일 인기 (비교 참고) */
  const popCols=['rice','soup','kimchi','main','side','dessert'].map(cat=>{
    const items=[...cats90[cat].values()].sort((a,b)=>b.count-a.count||b.schools.size-a.schools.size).slice(0,15);
    return `<div class="card rank-card trend-col"><h3>${CAT_LABEL[cat]}</h3>
      ${items.length?items.map((x,i)=>{
        const isNew=!my90Set.has(normalize(x.name));
        const s=schoolsHTML(x.schools,schIdx++);
        const idea=esc(JSON.stringify({type:'idea',title:x.name,menus:[x.name],date:today,school:[...x.schools].slice(0,3).join(', '),sourceType:'90일 인기 메뉴',sourcePeriod:`${d90}~${today}`,snapshot:{count:x.count,schools:[...x.schools],asOf:today}}));
        return `<div class="rank"><span class="num">${i+1}</span><div><b>${esc(x.name)} ${isNew?'<span class="new-badge">✨ 신메뉴 참고</span>':''}</b><small>${x.count}회 · ${x.schools.size}개교 · ${s}</small></div><button class="memo-btn" data-scrap-idea='${idea}' title="메뉴 아이디어로 스크랩">📌</button></div>`
      }).join(''):'<div class="empty">데이터 없음</div>'}</div>`;
  }).join('');
  $('#results').innerHTML=`
    <div class="section-title"><div><h2>📊 ${esc(state.mine.schoolName)} 식단 리포트</h2><p>분석 기간 ${from} ~ ${to} · 기준일 ${today} · 나에게만 보이는 분석입니다</p></div></div>
    <div class="summary">
      <div class="stat"><span>급식일</span><b>${rows.length}일</b></div>
      <div class="stat"><span>고유 메뉴</span><b>${all.length}개</b></div>
      <div class="stat"><span>별점 기록일</span><b>${ratedDays.length}일</b></div>
      <div class="stat"><span>비교학교 참고 메뉴</span><b>${refCount}개</b></div>
    </div>
    ${failedSchools.length?`<div class="warn">⚠ ${esc(failedSchools.join(', '))} 데이터를 불러오지 못해 해당 학교는 제외하고 분석했어요.</div>`:''}
    ${kwHTML}
    <div class="section-title"><div><h2>분류별 자주 낸 메뉴</h2><p>${from} ~ ${to} · 메뉴 옆 📝로 나만의 메모를 남길 수 있어요</p></div></div>
    <div class="trend-grid">${catCols}</div>
    ${state.comparisons.length||compRows.length?`
    <div class="section-title"><div><h2>🔥 최근 90일 인기 메뉴 (비교 참고)</h2><p>${d90} ~ ${today} · 내 학교 + ${state.comparisons.map(s=>esc(s.schoolName)).join(', ')||'비교학교'} · ✨ = 내 학교 최근 90일에 없던 메뉴</p></div></div>
    <div class="trend-grid">${popCols}</div>`:`
    <div class="warn" style="margin-top:14px">비교학교를 등록하면 다른 학교 인기 메뉴와 ✨신메뉴 참고를 함께 볼 수 있어요.</div>`}
    <div class="section-title"><div><h2>3개월 넘게 안 쓴 메뉴</h2><p>종료일(${to}) 기준</p></div></div>
    <div class="card rank-card">
      ${stale.length?stale.map((x,i)=>`<div class="rank"><span class="num">${i+1}</span><div><b>${esc(x.name)}</b><small>${CAT_LABEL[x.cat]} · 마지막 ${formatDate(x.latest)} · 총 ${x.count}회</small></div></div>`).join(''):'<div class="empty">모든 메뉴를 골고루 쓰고 있어요! 👏</div>'}
    </div>
    <div class="section-title"><div><h2>⭐ 별점 · 📝 메모 모아보기</h2><p>내가 남긴 기록만 모았어요 · 나에게만 보여요</p></div></div>
    <div class="analysis">
      <div class="card rank-card"><h3>⭐ 별점 기록 (${ratedDays.length}일)</h3>
        ${ratedDays.length?`<div class="kw-days">${ratedDays.sort((a,b)=>b[0].localeCompare(a[0])).map(([dk,v])=>`<div class="kw-day"><b>${dk}</b><span class="kw-stars">${'★'.repeat(v.stars)}</span></div>`).join('')}</div>`
          :'<div class="empty">아직 별점이 없어요.<br>내 식단 아카이브 탭에서 내 학교 식단 카드에 별점을 남기면 여기에 모여요.</div>'}
      </div>
      <div class="card rank-card"><h3>📝 메뉴 메모 (${Object.keys(state.menuMemos).length}개)</h3>
        ${Object.keys(state.menuMemos).length?Object.entries(state.menuMemos).map(([k,memo])=>`
          <div class="rank"><span style="width:4px"></span><div><b>${esc(k)}</b><div class="menu-memo">📝 ${esc(memo)}</div></div>
          <button class="memo-btn" data-menu-memo="${esc(k)}" data-menu-name="${esc(k)}" title="수정">✏</button></div>`).join('')
          :'<div class="empty">아직 메뉴 메모가 없어요.<br>위 TOP 30에서 메뉴 옆 📝를 눌러 남겨보세요.</div>'}
      </div>
    </div>
    <div class="section-title"><div><h2>📝 내 분석 노트</h2><p>자동 저장 · 나에게만 보여요</p></div></div>
    <div class="card" style="padding:16px">
      <textarea id="reportNote" placeholder="예: 8월 주찬 반복이 많음. 다음 달엔 생선 메뉴 늘리기." style="width:100%;min-height:100px">${esc(state.reportNote||'')}</textarea>
      <div class="help" id="noteSaved" style="text-align:right"></div>
    </div>`;
  setStatus(`분석 완료 · 급식 ${rows.length}일 · 고유 메뉴 ${all.length}개${keyword?` · '${esc(keyword)}' ${kwHTML.includes('상세 분석')?'분석 포함':''}`:''}`);
  bindReportEvents();
  bindIdeaScraps();
}
function bindReportEvents(){
  $$('[data-menu-memo]').forEach(b=>b.onclick=()=>{
    const key=b.dataset.menuMemo,name=b.dataset.menuName;
    const cur=state.menuMemos[key]||'';
    const memo=prompt(`'${name}' 메뉴 메모`,cur);
    if(memo===null)return;
    if(memo.trim())state.menuMemos[key]=memo.trim();
    else delete state.menuMemos[key];
    persist();renderReport();
  });
  $$('[data-sch-btn]').forEach(b=>b.onclick=()=>{
    const i=b.dataset.schBtn;
    document.querySelector(`[data-sch="${i}"]`).classList.add('hidden');
    document.querySelector(`[data-sch-full="${i}"]`).classList.remove('hidden');
  });
  const ta=$('#reportNote');
  if(ta){let t;ta.oninput=()=>{clearTimeout(t);t=setTimeout(()=>{
    state.reportNote=ta.value;persist();
    const s=$('#noteSaved');if(s){s.textContent='저장됨 ✓';setTimeout(()=>s.textContent='',1500)}
  },600)}}
}

function formatDate(v){return v?`${v.slice(0,4)}.${v.slice(4,6)}.${v.slice(6,8)}`:'-'}
function setStatus(msg,error=false){$('#status').innerHTML=`<div class="status ${error?'error':''}">${msg}</div>`}

/* ══ 시작 ══ */
onAuthStateChanged(auth,async u=>{
  user=u;
  if(u)await loadCloud();
  migrateScraps();
  shell();
});
