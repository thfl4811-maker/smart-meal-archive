
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const state={
  mine:JSON.parse(localStorage.getItem('archive_my_school')||'null'),
  comparisons:JSON.parse(localStorage.getItem('archive_compare_schools')||'[]'),
  tab:'mine',
  similar:true,
  loaded:[],
  favorites:new Set(JSON.parse(localStorage.getItem('archive_favorites')||'[]'))
};

const mainKeywords={
  soup:['국','탕','찌개','전골','스프'],
  rice:['밥','라이스','죽'],
  kimchi:['김치','깍두기','총각','석박지'],
  dessert:['과일','주스','음료','요구르트','요거트','아이스크림','케이크','쿠키','빵','푸딩','젤리','우유'],
  main:['갈비','불고기','제육','돈까스','돈가스','닭','치킨','오리','스테이크','장조림','찜','구이','볶음','탕수','강정','생선','고등어','삼치','조기','미트볼','떡갈비','함박','오징어','쭈꾸미','낙지','새우'],
  side:['무침','나물','샐러드','잡채','전','말이','조림','볶음','튀김','피클','장아찌','묵','두부','계란','달걀','떡볶이']
};

function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function dateISO(d){return d.toISOString().slice(0,10)}
function oneYearAgo(){const d=new Date();d.setFullYear(d.getFullYear()-1);d.setDate(d.getDate()+1);return dateISO(d)}
function normalize(s=''){return String(s).replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'').replace(/[*#]/g,'').replace(/\s+/g,'').replace(/(국산|친환경|무농약)/g,'').trim()}
function parseDishes(raw=''){
  return String(raw).split(/<br\s*\/?>|\n/gi).map(v=>v.trim()).filter(Boolean).map(line=>{
    const nums=[...line.matchAll(/\(([\d.]+)\)/g)].flatMap(m=>m[1].split('.').filter(Boolean));
    return {name:line.replace(/\([^)]*\)/g,'').trim(),allergy:[...new Set(nums)]};
  }).filter(x=>x.name);
}
function classify(name){
  const n=normalize(name);
  for(const k of ['rice','soup','kimchi','dessert']) if(mainKeywords[k].some(w=>n.includes(w))) return k;
  if(mainKeywords.main.some(w=>n.includes(w))) return 'main';
  if(mainKeywords.side.some(w=>n.includes(w))) return 'side';
  return 'side';
}
function menuMatches(name,keyword,similar){
  const n=normalize(name),k=normalize(keyword);
  if(!k)return false;
  return similar?n.includes(k)||k.includes(n):n===k;
}
function schoolKey(s){return `${s.officeCode}:${s.schoolCode}`}
function koreanDate(v){return `${v.slice(0,4)}년 ${Number(v.slice(4,6))}월 ${Number(v.slice(6,8))}일`}
function persist(){
  localStorage.setItem('archive_my_school',JSON.stringify(state.mine));
  localStorage.setItem('archive_compare_schools',JSON.stringify(state.comparisons));
}

function shell(){
  $('#app').innerHTML=`
  <header class="top"><div class="topin">
    <div class="brand">나의 <span>식단 아카이브</span></div>
    <div class="school-pill">${state.mine?`${esc(state.mine.schoolName)} · ${esc(state.mine.level)}`:'내 학교 미등록'}</div>
  </div></header>
  <main class="wrap">
    <section class="hero"><h1>내 식단과 다른 학교의<br>실제 메뉴 조합을 검색하세요</h1>
      <p>나이스 급식 데이터를 불러와 기준 메뉴와 함께 편성한 주찬·부찬을 분석하고, 실제 급식 날짜의 전체 식단을 카드로 확인합니다.</p>
    </section>
    <div class="tabs">
      <button class="tab ${state.tab==='mine'?'active':''}" data-tab="mine">내 식단 아카이브</button>
      <button class="tab ${state.tab==='compare'?'active':''}" data-tab="compare">같은 학교급 3개교 비교</button>
    </div>
    <section id="controls"></section>
    <section id="status"></section>
    <section id="results"></section>
  </main>
  <div id="modal"></div>`;
  $$('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;shell();renderControls()});
  renderControls();
  if(!state.mine) openSchoolModal('mine');
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
  const c=$('#controls');
  if(state.tab==='mine'){
    c.innerHTML=`<section class="panel">
      <div class="row" style="justify-content:space-between"><h2>내 학교 식단 검색</h2><button class="btn ghost small" id="changeMine">학교 변경</button></div>
      ${commonFields()}
      <div class="searchrow"><input disabled value="${state.mine?esc(state.mine.schoolName):'먼저 내 학교를 등록하세요.'}"><button class="btn" id="analyze">실제 식단 분석</button></div>
      <div class="help">조회 기간은 최대 1년입니다. 나이스에 등록된 중식 자료를 검색합니다.</div>
    </section>`;
    $('#changeMine').onclick=()=>openSchoolModal('mine');
  }else{
    c.innerHTML=`<section class="panel">
      <div class="row" style="justify-content:space-between"><h2>경기도 내 같은 학교급 비교</h2><button class="btn ghost small" id="addSchool">비교학교 찾기</button></div>
      <div class="school-layout">
        <div class="box"><h3>내 학교</h3><div class="chips">${state.mine?schoolChip(state.mine,false):'<span class="help">내 학교 미등록</span>'}</div></div>
        <div class="box"><h3>선택 비교학교 <span class="help">최대 3개</span></h3><div class="chips" id="selectedChips">${state.comparisons.length?state.comparisons.map(s=>schoolChip(s,true)).join(''):'<span class="help">비교학교를 선택하세요.</span>'}</div></div>
      </div>
      ${commonFields()}
      <div class="searchrow"><input disabled value="내 학교와 비교학교의 실제 식단을 함께 분석합니다."><button class="btn" id="analyze">비교 분석</button></div>
      <div class="warn">분석 대상은 내 학교 1개와 비교학교 최대 3개입니다. 각 학교의 기간별 실제 식단을 나이스 API에서 불러옵니다.</div>
    </section>`;
    $('#addSchool').onclick=()=>openSchoolModal('compare');
    $$('[data-remove-school]').forEach(b=>b.onclick=()=>{
      state.comparisons=state.comparisons.filter(s=>schoolKey(s)!==b.dataset.removeSchool);persist();renderControls();
    });
  }
  $('#similar').onclick=()=>{state.similar=!state.similar;$('#similar').classList.toggle('on',state.similar)};
  $('#analyze').onclick=analyze;
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
    const results=await Promise.all(targets.map(async school=>{
      const url=`/api/meals-range?office=${encodeURIComponent(school.officeCode)}&school=${encodeURIComponent(school.schoolCode)}&from=${from}&to=${to}`;
      const r=await fetch(url);const rows=await r.json();
      if(!r.ok)throw Error(`${school.schoolName}: ${rows.error||'식단 조회 실패'}`);
      return rows.map(row=>({...row,school}));
    }));
    state.loaded=results.flat();
    const matches=analyzeMeals(state.loaded,keyword,state.similar);
    setStatus(`${targets.length}개교의 실제 급식 ${state.loaded.length}일을 불러왔고, ‘${esc(keyword)}’가 포함된 ${matches.meals.length}일을 찾았습니다.`);
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
    <div class="section-title"><div><h2>‘${esc(keyword)}’ 실제 식단 분석</h2><p>${from} ~ ${to} · ${targets.map(s=>esc(s.schoolName)).join(', ')}</p></div><button class="btn ghost small" id="copyResult">결과 복사</button></div>
    <div class="summary">
      <div class="stat"><span>분석 학교</span><b>${targets.length}개교</b></div>
      <div class="stat"><span>전체 급식일</span><b>${state.loaded.length}일</b></div>
      <div class="stat"><span>기준 메뉴 편성</span><b>${a.meals.length}회</b></div>
      <div class="stat"><span>실제 식단 카드</span><b>${a.meals.length}개</b></div>
    </div>
    <div class="analysis">
      ${rankCard('함께 편성한 주찬',a.main)}
      ${rankCard('함께 편성한 부찬',a.side)}
    </div>
    <div class="section-title"><div><h2>실제 식단 카드</h2><p>나이스 API에서 검색된 학교별 실제 편성 식단입니다.</p></div></div>
    <div class="meals">${a.meals.length?a.meals.map(m=>mealCard(m,keyword)).join(''):'<div class="empty">검색 메뉴가 포함된 실제 식단이 없습니다.</div>'}</div>`;
  $('#copyResult').onclick=()=>copySummary(a,keyword);
  $$('[data-favorite]').forEach(b=>b.onclick=()=>toggleFavorite(b.dataset.favorite,b));
}
function rankCard(title,items){
  return `<div class="card rank-card"><h3>${title}</h3>${items.length?items.map((x,i)=>`<div class="rank"><span class="num">${i+1}</span><div><b>${esc(x.name)}</b><small>${x.schools.size}개교 · 최근 ${x.latest?formatDate(x.latest):'-'}</small></div><strong>${x.count}회</strong></div>`).join(''):'<div class="empty">분류된 메뉴가 없습니다.</div>'}</div>`;
}
function mealCard(m,keyword){
  const id=`${m.school.schoolCode}-${m.date}`;
  const fav=state.favorites.has(id);
  return `<article class="card meal"><div class="date">${koreanDate(m.date)}</div><div class="school">${esc(m.school.schoolName)}</div>
    ${m.dishes.map(d=>`<div class="dish ${menuMatches(d.name,keyword,state.similar)?'hit':''}">${esc(d.name)} ${d.allergy.length?`<span class="allergy">(${d.allergy.join('·')})</span>`:''}</div>`).join('')}
    <footer>${esc(m.calories||'열량 정보 없음')}<br>${esc(m.nutrients||'')}</footer>
    <div class="row" style="margin-top:11px"><button class="btn ghost small" data-favorite="${id}">${fav?'★ 즐겨찾기':'☆ 즐겨찾기'}</button><button class="btn ghost small" onclick="navigator.clipboard.writeText('${esc(m.dishes.map(d=>d.name).join(' / '))}')">식단 복사</button></div>
  </article>`;
}
function toggleFavorite(id,b){
  state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);
  localStorage.setItem('archive_favorites',JSON.stringify([...state.favorites]));
  b.textContent=state.favorites.has(id)?'★ 즐겨찾기':'☆ 즐겨찾기';
}
function copySummary(a,keyword){
  const text=[`[${keyword} 식단 조합 분석]`,`주찬: ${a.main.slice(0,10).map(x=>`${x.name} ${x.count}회`).join(', ')}`,`부찬: ${a.side.slice(0,10).map(x=>`${x.name} ${x.count}회`).join(', ')}`,`실제 식단 ${a.meals.length}건`].join('\n');
  navigator.clipboard.writeText(text);alert('분석 결과를 복사했습니다.');
}
function formatDate(v){return `${v.slice(0,4)}.${v.slice(4,6)}.${v.slice(6,8)}`}
function setStatus(msg,error=false){$('#status').innerHTML=`<div class="status ${error?'error':''}">${msg}</div>`}

shell();
