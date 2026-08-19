/* ═══════════════════════════════════════════════
   한글(.hwpx) 월간 식단표 채우기

   학교마다 쓰는 식단계획표 한글 양식을 그대로 받아서,
   캘린더에 짜 둔 식단을 요일 칸에 넣고 다시 .hwpx로 돌려준다.
   서식·표·색은 원본 그대로 두고 글자만 갈아끼운다.

   ※ 왜 "복사→붙여넣기"가 아니라 파일을 직접 고치는가
     식단 셀 안에서 메뉴 한 줄이 각각 별개 문단(<hp:p>)이다.
     탭 구분 텍스트를 붙여넣으면 한글이 줄바꿈을 '다음 행'으로 읽어 표가 밀린다.

   ※ linesegarray
     원본 편집기가 저장해 둔 줄 배치 캐시. 글자를 바꾸면 무효가 되어
     글자가 겹쳐 보이므로 손댄 문단에서는 반드시 지운다.
     지우면 한컴오피스가 열 때 다시 계산한다.
═══════════════════════════════════════════════ */

import JSZip from 'jszip';

const ln = e => e.localName || String(e.nodeName).split(':').pop();
const childrenOf = (e, name) => [...e.children].filter(c => ln(c) === name);
const descendants = (root, name) =>
  [...root.getElementsByTagName('*')].filter(e => ln(e) === name);

/* 셀 안 글자 모으기 */
function tcText(tc) {
  return descendants(tc, 't').map(t => t.textContent || '').join('').trim();
}

/* 문단에서 줄 배치 캐시 제거 (필수) */
function dropLineSeg(p) {
  childrenOf(p, 'linesegarray').forEach(x => p.removeChild(x));
}

const HP_NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph';

/* 글자를 담을 <hp:t>를 확보한다.

   아무것도 안 채운 빈 양식의 셀은 문단이 이렇게 생겼다.
       <hp:p><hp:run charPrIDRef="32"/><hp:linesegarray .../></hp:p>
   글자칸(<hp:t>)이 아예 없다. 예전 코드는 t를 찾지 못하면 그냥 넘어가서
   빈 문단만 잔뜩 넣었고, 그래서 표가 통째로 빈칸으로 나왔다.
   여기서는 run 안에 t를 만들어 준다. charPrIDRef는 건드리지 않으므로
   원본 양식의 글꼴·크기가 그대로 유지된다. */
function ensureTextNodes(p) {
  const ts = descendants(p, 't');
  if (ts.length) return ts;

  const doc = p.ownerDocument;
  const nameFor = (node, local) => (node.prefix ? node.prefix + ':' : '') + local;

  let run = descendants(p, 'run')[0];
  if (!run) {
    run = doc.createElementNS(p.namespaceURI || HP_NS, nameFor(p, 'run'));
    p.appendChild(run);
  }
  const t = doc.createElementNS(run.namespaceURI || HP_NS, nameFor(run, 't'));
  run.appendChild(t);
  return [t];
}

/* 템플릿 문단을 복제해 글자만 갈아끼움 */
function makePara(tplP, text) {
  const p = tplP.cloneNode(true);
  dropLineSeg(p);
  const ts = ensureTextNodes(p);
  ts[0].textContent = text;
  /* run이 여러 개면 첫 run만 남긴다 */
  ts.slice(1).forEach(t => {
    const run = t.parentNode;
    if (run && run.parentNode === p) p.removeChild(run);
  });
  return p;
}

function subListOf(tc) {
  return childrenOf(tc, 'subList')[0] || null;
}

/* 셀 내용을 여러 줄로 교체 */
function setCellLines(tc, lines, tplP) {
  const sub = subListOf(tc);
  if (!sub) return false;
  const olds = childrenOf(sub, 'p');
  const tpl = tplP || olds[0];
  if (!tpl) return false;
  olds.forEach(p => sub.removeChild(p));
  (lines.length ? lines : ['']).forEach(txt => sub.appendChild(makePara(tpl, txt)));
  return true;
}

const WEEK5 = ['월', '화', '수', '목', '금'];

/* 월~금 요일 머리행을 가진 표를 찾는다 */
function findMealTable(doc) {
  const tbls = descendants(doc, 'tbl');
  for (const tbl of tbls) {
    const rows = descendants(tbl, 'tr');
    for (let i = 0; i < rows.length; i++) {
      const cells = childrenOf(rows[i], 'tc');
      if (cells.length < 5) continue;
      const txt = cells.slice(0, 5).map(tcText);
      if (WEEK5.every((w, k) => txt[k] === w)) {
        return { tbl, rows, headIdx: i };
      }
    }
  }
  return null;
}

/* 머리행 아래로 (날짜행, 식단행) 짝을 모은다 */
function weekRowPairs(rows, headIdx) {
  const pairs = [];
  for (let i = headIdx + 1; i + 1 < rows.length; i++) {
    const a = childrenOf(rows[i], 'tc');
    const b = childrenOf(rows[i + 1], 'tc');
    /* 식단표는 월~금 정확히 5칸. 뒤에 붙은 원산지 표(15칸) 같은 다른 표를 건드리지 않도록
       5칸이 아닌 행을 만나면 거기서 멈춘다. */
    if (a.length !== 5 || b.length !== 5) break;
    pairs.push({ dateCells: a, mealCells: b });
    i++; /* 짝으로 소비 */
  }
  return pairs;
}

/**
 * @param {ArrayBuffer} buf   학교 식단계획표 .hwpx
 * @param {Array} weeks       [{ days:[{label:'9/1 개학식', menus:['밥','국',...]} x5] }, ...]
 * @returns {{blob:Blob, filledWeeks:number, formWeeks:number, filledDays:number}}
 */
export async function fillMealHwpx(buf, weeks) {
  const zip = await JSZip.loadAsync(buf);

  const secPath = Object.keys(zip.files)
    .filter(f => /^Contents\/section\d+\.xml$/i.test(f))
    .sort()[0];
  if (!secPath) throw Error('한글 파일 안에서 본문(section)을 찾지 못했어요.');

  const xmlText = await zip.file(secPath).async('string');
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw Error('한글 파일을 읽지 못했어요. 다른 이름으로 저장한 뒤 다시 시도해 주세요.');
  }

  const found = findMealTable(doc);
  if (!found) {
    throw Error(
      '이 파일에서 월~금 식단표를 찾지 못했어요.\n' +
      '요일(월·화·수·목·금)이 한 줄에 들어 있는 표가 있어야 합니다.'
    );
  }

  const pairs = weekRowPairs(found.rows, found.headIdx);
  if (!pairs.length) throw Error('식단표의 날짜·식단 행을 찾지 못했어요.');

  /* 식단 문단 템플릿 — 원본에서 글자가 들어 있는 셀의 첫 문단을 쓴다 */
  let mealTpl = null, dateTpl = null;
  for (const pr of pairs) {
    for (const tc of pr.mealCells) {
      const sub = subListOf(tc);
      const p = sub && childrenOf(sub, 'p')[0];
      if (p && !mealTpl && tcText(tc)) mealTpl = p.cloneNode(true);
    }
    for (const tc of pr.dateCells) {
      const sub = subListOf(tc);
      const p = sub && childrenOf(sub, 'p')[0];
      if (p && !dateTpl) dateTpl = p.cloneNode(true);
    }
  }

  let filledDays = 0;
  const n = Math.min(pairs.length, weeks.length);

  let touchedWeeks = 0;
  const touchedCells = [];
  for (let w = 0; w < n; w++) {
    const pr = pairs[w];
    const days = weeks[w].days || [];
    /* 그 주에 넣을 식단이 하나도 없으면 아예 손대지 않는다.
       빈 값으로 덮어써서 원본 표를 지워버리는 사고를 막는다. */
    if (!days.some(d => d && (d.menus || []).length)) continue;
    touchedWeeks++;
    for (let d = 0; d < 5; d++) {
      const day = days[d];
      setCellLines(pr.dateCells[d], day && day.label ? [day.label] : [''], dateTpl);
      const menus = (day && day.menus) || [];
      setCellLines(pr.mealCells[d], menus, mealTpl);
      if (menus.length) {
        filledDays++;
        touchedCells.push(pr.mealCells[d]);
      }
    }
  }

  /* 넣었다고 생각한 글자가 실제로 표 안에 들어갔는지 되읽어 확인한다.
     빈 파일을 조용히 내려주는 것보다 이유를 말해 주는 편이 낫다. */
  const writtenChars = touchedCells.reduce((s, tc) => s + tcText(tc).length, 0);
  if (touchedCells.length && !writtenChars) {
    throw Error(
      '식단을 표에 넣었는데 글자가 들어가지 않았어요.\n' +
      '이 양식은 제가 아직 다루지 못하는 구조인 것 같습니다.\n' +
      '양식 파일을 개발자(thfl4811@gmail.com)에게 보내주시면 맞춰서 고치겠습니다.'
    );
  }

  /* 넣을 게 하나도 없으면 파일을 아예 만들지 않는다 (빈 표가 나오는 사고 방지) */
  if (!filledDays) {
    throw Error(
      '이 달에 넣을 식단이 없어요.\n\n' +
      '· 「내가 짠 식단 초안」을 골랐다면 → 캘린더에 초안이 있는지 확인해 주세요\n' +
      '· 「나이스 실제 급식」을 골랐다면 → 툴바의 🍚 나이스 우리학교 식단 불러오기를 먼저 눌러주세요\n' +
      '· 지금 보고 있는 달이 채워집니다. 달을 잘못 고르지 않았는지도 확인해 주세요.'
    );
  }

  const outXml = new XMLSerializer().serializeToString(doc);

  /* 재포장 — mimetype이 압축 없이 맨 앞에 와야 한글이 연다 */
  const out = new JSZip();
  if (zip.file('mimetype')) {
    out.file('mimetype', await zip.file('mimetype').async('string'), { compression: 'STORE' });
  }
  for (const name of Object.keys(zip.files)) {
    if (name === 'mimetype') continue;
    const f = zip.files[name];
    if (f.dir) continue;
    const data = name === secPath ? outXml : await f.async('uint8array');
    out.file(name, data, { compression: 'DEFLATE' });
  }

  const blob = await out.generateAsync({
    type: 'blob',
    mimeType: 'application/hwp+zip'
  });

  return { blob, filledWeeks: touchedWeeks, formWeeks: pairs.length, filledDays };
}
