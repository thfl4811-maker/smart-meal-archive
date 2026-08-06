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
};

/* ══ 클라우드 동기화 ══ */
function persistLocal(){
  localStorage.setItem('archive_my_school',JSON.stringify(state.mine));
  localStorage.setItem('archive_compare_schools',JSON.stringify(state.comparisons));
  localStorage.setItem('archive_favorites',JSON.stringify([...state.favorites]));
  localStorage.setItem('archive_scraps',JSON.stringify(state.scraps));
  localStorage.setItem('archive_ratings',JSON.stringify(state.ratings));
  localStorage.setItem('archive_folders',JSON.stringify(state.folders));
}
async function syncCloud(){
  persistLocal();
  if(!user)return;
  try{await setDoc(doc(db,'users',user.uid,'apps','archive'),{
    mine:state.mine,comparisons:state.comparisons,
    favorites:[...state.favorites],scraps:state.scraps,
    ratings:state.ratings,folders:state.folders,
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
async function doSignIn(){try{await signInWithPopup(auth,gprov)}catch(e){console.error(e)}}
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
      <p class="help" style="margin:6px 0 12px">최근 1년 내 학교 식단을 분석해 다양성과 활용 패턴을 보여줍니다. 이 리포트는 나에게만 보여요.</p>
      <button class="btn" id="reportGo">리포트 생성</button>
    </section>`;
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
    <div class="section-title"><div><h2>실제 식단 카드</h2><p>나이스 API에서 검색된 학교별 실제 편성 식단입니다.</p></div></div>
    <div class="meals">${a.meals.length?a.meals.map(m=>mealCard(m,keyword)).join(''):'<div class="empty">검색 메뉴가 포함된 실제 식단이 없습니다.</div>'}</div>`;
  $('#copyResult').onclick=()=>copySummary(a,keyword);
  $('#scrapResult').onclick=()=>scrapAnalysis(a,keyword);
  bindMealCards();
}
function rankCard(title,items){
  return `<div class="card rank-card"><h3>${title}</h3>${items.length?items.map((x,i)=>`<div class="rank"><span class="num">${i+1}</span><div><b>${esc(x.name)}</b><small>${x.schools.size}개교 · 최근 ${x.latest?formatDate(x.latest):'-'}</small></div><strong>${x.count}회</strong></div>`).join(''):'<div class="empty">분류된 메뉴가 없습니다.</div>'}</div>`;
}
function mealCard(m,keyword){
  const id=`${m.school.schoolCode}-${m.date}`;
  const fav=state.favorites.has(id);
  const isMine=state.mine&&m.school.schoolCode===state.mine.schoolCode;
  const dkey=`${m.date.slice(0,4)}-${m.date.slice(4,6)}-${m.date.slice(6,8)}`;
  const rating=state.ratings[dkey];
  return `<article class="card meal"><div class="date">${koreanDate(m.date)}</div><div class="school">${esc(m.school.schoolName)}</div>
    ${m.dishes.map(d=>`<div class="dish ${keyword&&menuMatches(d.name,keyword,state.similar)?'hit':''}">${esc(d.name)} ${d.allergy.length?`<span class="allergy">(${d.allergy.join('·')})</span>`:''}</div>`).join('')}
    <footer>${esc(m.calories||'열량 정보 없음')}</footer>
    ${isMine?`<div class="stars" data-stars="${dkey}">${[1,2,3,4,5].map(n=>`<button class="star ${rating&&rating.stars>=n?'on':''}" data-star="${n}">★</button>`).join('')}<small class="help" style="margin-left:6px">${rating?'내 별점':'내 별점 (나만 보여요)'}</small></div>`:''}
    <div class="row" style="margin-top:11px;gap:6px">
      <button class="btn ghost small" data-favorite="${id}">${fav?'★ 즐겨찾기':'☆ 즐겨찾기'}</button>
      <button class="btn ghost small" data-scrap-meal='${esc(JSON.stringify({title:m.dishes.map(d=>d.name).slice(0,3).join('·'),menus:m.dishes.map(d=>d.name),date:dkey,school:m.school.schoolName}))}'>📌 스크랩</button>
      <button class="btn ghost small" data-copy-meal="${esc(m.dishes.map(d=>d.name).join(' / '))}">복사</button>
    </div>
  </article>`;
}
function bindMealCards(){
  $$('[data-favorite]').forEach(b=>b.onclick=()=>toggleFavorite(b.dataset.favorite,b));
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
function toggleFavorite(id,b){
  state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);
  persist();
  b.textContent=state.favorites.has(id)?'★ 즐겨찾기':'☆ 즐겨찾기';
}
function copySummary(a,keyword){
  const text=[`[${keyword} 식단 조합 분석]`,`주찬: ${a.main.slice(0,10).map(x=>`${x.name} ${x.count}회`).join(', ')}`,`부찬: ${a.side.slice(0,10).map(x=>`${x.name} ${x.count}회`).join(', ')}`,`실제 식단 ${a.meals.length}건`].join('\n');
  navigator.clipboard.writeText(text);alert('분석 결과를 복사했습니다.');
}
function scrapAnalysis(a,keyword){
  openScrapModal({
    title:`'${keyword}' 조합 분석`,
    menus:[`주찬: ${a.main.slice(0,5).map(x=>x.name).join(', ')}`,`부찬: ${a.side.slice(0,5).map(x=>x.name).join(', ')}`],
    date:dateISO(new Date()),school:'분석 결과'
  });
}

/* ══ 스크랩 모달 ══ */
function openScrapModal(item){
  const m=$('#modal');
  m.innerHTML=`<div class="modal"><div class="modal-card">
    <h2>📌 스크랩 저장</h2>
    <p class="help">${esc(item.school)} · ${esc(item.date)}</p>
    <div class="field" style="margin:10px 0"><label>제목</label><input id="scrapTitle" value="${esc(item.title)}"></div>
    <div class="field" style="margin-bottom:10px"><label>폴더</label>
      <div class="row" style="gap:6px">
        <select id="scrapFolder" style="flex:1">${state.folders.map(f=>`<option>${esc(f)}</option>`).join('')}</select>
        <button class="btn ghost small" id="newFolder">+ 새 폴더</button>
      </div>
    </div>
    <div class="field"><label>메모 (선택)</label><textarea id="scrapMemo" placeholder="예: 학생 반응 좋았음, 배식 편했음" style="width:100%;min-height:70px"></textarea></div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px">
      <button class="btn ghost" id="scrapCancel">취소</button>
      <button class="btn" id="scrapSave">저장</button>
    </div>
  </div></div>`;
  $('#scrapCancel').onclick=()=>m.innerHTML='';
  $('#newFolder').onclick=()=>{
    const name=prompt('새 폴더 이름');
    if(name&&!state.folders.includes(name)){state.folders.push(name);persist();
      $('#scrapFolder').innerHTML=state.folders.map(f=>`<option ${f===name?'selected':''}>${esc(f)}</option>`).join('')}
  };
  $('#scrapSave').onclick=()=>{
    state.scraps.unshift({
      id:Date.now().toString(36),
      folder:$('#scrapFolder').value,
      title:$('#scrapTitle').value.trim()||item.title,
      menus:item.menus,memo:$('#scrapMemo').value.trim(),
      date:item.date,school:item.school,savedAt:dateISO(new Date())
    });
    persist();m.innerHTML='';alert('📌 스크랩했습니다!');
  };
}

/* ══ 스크랩북 탭 ══ */
function renderScrapbook(){
  const c=$('#controls');
  const byFolder={};
  state.folders.forEach(f=>byFolder[f]=[]);
  state.scraps.forEach(s=>{(byFolder[s.folder]=byFolder[s.folder]||[]).push(s)});
  c.innerHTML=`<section class="panel">
    <div class="row" style="justify-content:space-between"><h2>📌 내 스크랩북</h2><span class="help">${state.scraps.length}개 저장 · ${user?'☁ 클라우드 동기화 중':'⚠ 로그인하면 클라우드에 저장돼요'}</span></div>
    ${state.scraps.length?Object.entries(byFolder).filter(([,v])=>v.length).map(([folder,items])=>`
      <h3 style="margin:16px 0 8px">📁 ${esc(folder)} <small class="help">${items.length}개</small></h3>
      <div class="meals">${items.map(s=>`
        <article class="card meal">
          <div class="date">${esc(s.date)}</div><div class="school">${esc(s.school)}</div>
          <b style="display:block;margin:4px 0">${esc(s.title)}</b>
          ${s.menus.map(mn=>`<div class="dish">${esc(mn)}</div>`).join('')}
          ${s.memo?`<div class="memo">📝 ${esc(s.memo)}</div>`:''}
          <div class="row" style="margin-top:10px;gap:6px">
            <button class="btn ghost small" data-edit-memo="${s.id}">메모 수정</button>
            <button class="btn ghost small" data-del-scrap="${s.id}">삭제</button>
          </div>
        </article>`).join('')}</div>
    `).join(''):'<div class="empty" style="margin-top:14px">아직 스크랩이 없어요. 식단 검색 결과에서 📌 스크랩 버튼을 눌러보세요!</div>'}
  </section>`;
  $$('[data-del-scrap]').forEach(b=>b.onclick=()=>{
    if(!confirm('이 스크랩을 삭제할까요?'))return;
    state.scraps=state.scraps.filter(s=>s.id!==b.dataset.delScrap);persist();renderScrapbook();
  });
  $$('[data-edit-memo]').forEach(b=>b.onclick=()=>{
    const s=state.scraps.find(x=>x.id===b.dataset.editMemo);
    const memo=prompt('메모 수정',s.memo||'');
    if(memo!==null){s.memo=memo;persist();renderScrapbook()}
  });
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
          return `<div class="rank"><span class="num">${i+1}</span><div><b>${esc(x.name)} ${isNew?'<span class="new-badge">✨NEW</span>':''}</b><small>${x.schools.size}개교 · ${x.count}회</small></div></div>`
        }).join(''):'<div class="empty">데이터 없음</div>'}</div>`;
      }).join('')}
      </div>
      <p class="help" style="margin-top:10px">✨NEW = 최근 30일 내 학교 식단에 없었던 메뉴예요. 새 아이디어로 참고해보세요!</p>`;
  }catch(e){setStatus(e.message,true)}
}

/* ══ 리포트 탭 ══ */
async function analyzeReport(){
  if(!state.mine){openSchoolModal('mine');return}
  setStatus('<span class="loading"></span>최근 1년 내 학교 식단을 분석하고 있습니다.');
  try{
    const rows=await fetchMeals(state.mine,oneYearAgo(),dateISO(new Date()));
    const menuMap=new Map();
    rows.forEach(r=>parseDishes(r.dishes).forEach(d=>{
      const key=normalize(d.name);if(!key)return;
      const v=menuMap.get(key)||{name:d.name,count:0,latest:'',cat:classify(d.name)};
      v.count++;if(r.date>v.latest)v.latest=r.date;menuMap.set(key,v);
    }));
    const all=[...menuMap.values()];
    const top=all.slice().sort((a,b)=>b.count-a.count).slice(0,10);
    const threeMonthsAgo=(()=>{const d=new Date();d.setMonth(d.getMonth()-3);return d.toISOString().slice(0,10).replace(/-/g,'')})();
    const stale=all.filter(x=>x.latest<threeMonthsAgo&&x.count>=2).sort((a,b)=>a.latest.localeCompare(b.latest)).slice(0,10);
    const ratedDays=Object.entries(state.ratings).filter(([,v])=>v.stars);
    const highRated=ratedDays.filter(([,v])=>v.stars>=4).length;
    setStatus(`최근 1년 급식 ${rows.length}일 · 고유 메뉴 ${all.length}개 분석 완료`);
    $('#results').innerHTML=`
      <div class="section-title"><div><h2>📊 ${esc(state.mine.schoolName)} 식단 리포트</h2><p>최근 1년 · 나에게만 보이는 분석입니다</p></div></div>
      <div class="summary">
        <div class="stat"><span>급식일</span><b>${rows.length}일</b></div>
        <div class="stat"><span>고유 메뉴</span><b>${all.length}개</b></div>
        <div class="stat"><span>내가 별점 남긴 날</span><b>${ratedDays.length}일</b></div>
        <div class="stat"><span>⭐4점 이상</span><b>${highRated}일</b></div>
      </div>
      <div class="analysis">
        <div class="card rank-card"><h3>가장 자주 낸 메뉴 TOP 10</h3>
          ${top.map((x,i)=>`<div class="rank"><span class="num">${i+1}</span><div><b>${esc(x.name)}</b><small>${CAT_LABEL[x.cat]||''} · 최근 ${formatDate(x.latest)}</small></div><strong>${x.count}회</strong></div>`).join('')}
        </div>
        <div class="card rank-card"><h3>3개월 넘게 안 쓴 메뉴</h3>
          ${stale.length?stale.map((x,i)=>`<div class="rank"><span class="num">${i+1}</span><div><b>${esc(x.name)}</b><small>마지막 ${formatDate(x.latest)} · 총 ${x.count}회</small></div></div>`).join(''):'<div class="empty">모든 메뉴를 골고루 쓰고 있어요! 👏</div>'}
        </div>
      </div>
      <p class="help" style="margin-top:10px">💡 오래 안 쓴 메뉴는 다음 달 식단에 다시 넣어볼까요? 메뉴 다양성 관리에 활용하세요.</p>`;
  }catch(e){setStatus(e.message,true)}
}

function formatDate(v){return v?`${v.slice(0,4)}.${v.slice(4,6)}.${v.slice(6,8)}`:'-'}
function setStatus(msg,error=false){$('#status').innerHTML=`<div class="status ${error?'error':''}">${msg}</div>`}

/* ══ 시작 ══ */
onAuthStateChanged(auth,async u=>{
  user=u;
  if(u)await loadCloud();
  shell();
});
