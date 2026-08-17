import './style.css';
import { initializeApp } from 'firebase/app';
import * as XLSX from 'xlsx';
import {
  SPECIAL_DAYS,
  SPECIAL_CATS,
  SPECIAL_RANGE
} from './special-days.js';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from 'firebase/firestore';

/* ══ Firebase ══ */
const fbApp = initializeApp({
  apiKey: 'AIzaSyBEagv2iP4sSJuDsjBB24A3FHFfAiiS8wA',
  authDomain: 'aisori.firebaseapp.com',
  projectId: 'aisori',
  storageBucket: 'aisori.firebasestorage.app',
  messagingSenderId: '829702954282',
  appId: '1:829702954282:web:7f38d1ca0e591d238d9253'
});

const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const gprov = new GoogleAuthProvider();

let user = null;
let cloudReady = false;
let _report = null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  mine: JSON.parse(
    localStorage.getItem('archive_my_school') || 'null'
  ),

  comparisons: JSON.parse(
    localStorage.getItem('archive_compare_schools') || '[]'
  ),

  uploads: JSON.parse(
    localStorage.getItem('archive_uploads') || '{}'
  ),

  mineChangedAt:
    localStorage.getItem('archive_mine_changed_at') || null,

  lastNeisKey:
    localStorage.getItem('archive_last_neis_key') || null,

  mealCode:
    localStorage.getItem('archive_meal_code') || '2',

  tab: 'mine',
  similar: true,
  loaded: [],

  favorites: new Set(
    JSON.parse(
      localStorage.getItem('archive_favorites') || '[]'
    )
  ),

  scraps: JSON.parse(
    localStorage.getItem('archive_scraps') || '[]'
  ),

  ratings: JSON.parse(
    localStorage.getItem('archive_ratings') || '{}'
  ),

  folders: JSON.parse(
    localStorage.getItem('archive_folders') || '["기본"]'
  ),

  menuMemos: JSON.parse(
    localStorage.getItem('archive_menu_memos') || '{}'
  ),

  reportNote:
    localStorage.getItem('archive_report_note') || '',

  baseFolder:
    localStorage.getItem('archive_base_folder') || '기본 폴더',

  /* ⭐ 추천식단: 초안 캘린더 */
  draftCal: normalizeDraftCal(
    parseDraftCal(
      localStorage.getItem('archive_draft_cal')
    )
  )
};

/* ═════════════════════════════
   클라우드 동기화
═════════════════════════════ */
/* ═════════════════════════════
   로그인 필수 안내 · 로컬 병합 헬퍼
═════════════════════════════ */
function requireLogin(actionName) {
  if (user) {
    return true;
  }

  alert(
    actionName +
    ' 기능은 구글 로그인 후 이용할 수 있어요.\n\n' +
    '로그인하면 기록이 내 계정에 안전하게 저장되고,\n' +
    '학교를 옮기거나 다른 컴퓨터에서도 그대로 유지됩니다.'
  );

  return false;
}

function readLocalPrivate() {
  const g = (k, fb) => {
    try {
      return JSON.parse(
        localStorage.getItem(k) ?? fb
      );
    } catch {
      return JSON.parse(fb);
    }
  };

  return {
    scraps: g('archive_scraps', '[]'),
    ratings: g('archive_ratings', '{}'),
    favorites: g('archive_favorites', '[]'),
    folders: g('archive_folders', '[]'),
    menuMemos: g('archive_menu_memos', '{}'),
    reportNote:
      localStorage.getItem('archive_report_note') || '',
    baseFolder:
      localStorage.getItem('archive_base_folder') || '',
    mine: g('archive_my_school', 'null'),
    comparisons: g('archive_compare_schools', '[]'),
    draftCal: g('archive_draft_cal', 'null')
  };
}

function mergeCloudWithLocal(cloud, local) {
  const c = cloud || {};
  const l = local || {};

  const merged = { ...c };

  const cScraps =
    Array.isArray(c.scraps) ? c.scraps : [];

  const ids =
    new Set(
      cScraps.map(s => s && s.id)
    );

  const extra =
    (Array.isArray(l.scraps) ? l.scraps : [])
      .filter(
        s => s && s.id && !ids.has(s.id)
      );

  merged.scraps = [...cScraps, ...extra];

  merged.ratings = {
    ...(l.ratings || {}),
    ...(c.ratings || {})
  };

  merged.menuMemos = {
    ...(l.menuMemos || {}),
    ...(c.menuMemos || {})
  };

  merged.favorites = [
    ...new Set([
      ...(Array.isArray(c.favorites) ? c.favorites : []),
      ...(Array.isArray(l.favorites) ? l.favorites : [])
    ])
  ];

  const cf =
    Array.isArray(c.folders) ? c.folders : [];

  merged.folders = [
    ...cf,
    ...(Array.isArray(l.folders) ? l.folders : [])
      .filter(f => !cf.includes(f))
  ];

  merged.reportNote =
    (typeof c.reportNote === 'string' && c.reportNote)
      ? c.reportNote
      : (l.reportNote || '');

  merged.baseFolder =
    c.baseFolder || l.baseFolder || '기본 폴더';

  merged.mine =
    c.mine || l.mine || null;

  merged.comparisons =
    (Array.isArray(c.comparisons) && c.comparisons.length)
      ? c.comparisons
      : (Array.isArray(l.comparisons) ? l.comparisons : []);

  merged.draftCal = JSON.stringify(
    mergeDraftCal(
      parseDraftCal(c.draftCal),
      parseDraftCal(l.draftCal)
    )
  );

  return merged;
}

function persistLocal() {
  localStorage.setItem(
    'archive_my_school',
    JSON.stringify(state.mine)
  );

  localStorage.setItem(
    'archive_compare_schools',
    JSON.stringify(state.comparisons)
  );

  localStorage.setItem(
    'archive_uploads',
    JSON.stringify(state.uploads || {})
  );

  if (state.mineChangedAt) {
    localStorage.setItem('archive_mine_changed_at', state.mineChangedAt);
  }
  if (state.lastNeisKey) {
    localStorage.setItem('archive_last_neis_key', state.lastNeisKey);
  }

  /* 개인 기록(스크랩·별점·메모 등)은
     로그인 중일 때만 이 브라우저에 저장 —
     비로그인 상태에서 과거 기록을 덮어쓰지 않기 위함 */
  if (!user) {
    return;
  }

  localStorage.setItem(
    'archive_favorites',
    JSON.stringify([...state.favorites])
  );

  localStorage.setItem(
    'archive_scraps',
    JSON.stringify(state.scraps)
  );

  localStorage.setItem(
    'archive_ratings',
    JSON.stringify(state.ratings)
  );

  localStorage.setItem(
    'archive_folders',
    JSON.stringify(state.folders)
  );

  localStorage.setItem(
    'archive_menu_memos',
    JSON.stringify(state.menuMemos || {})
  );

  localStorage.setItem(
    'archive_report_note',
    state.reportNote || ''
  );

  localStorage.setItem(
    'archive_base_folder',
    state.baseFolder || '기본 폴더'
  );

  localStorage.setItem(
    'archive_draft_cal',
    JSON.stringify(
      state.draftCal || normalizeDraftCal(null)
    )
  );
}

function cloudPayload() {
  return {
    mine: state.mine || null,
    comparisons: state.comparisons || [],
    uploads: JSON.stringify(state.uploads || {}),
    mineChangedAt: state.mineChangedAt || null,
    lastNeisKey: state.lastNeisKey || null,
    favorites: [...state.favorites],
    scraps: state.scraps || [],
    ratings: state.ratings || {},
    folders: state.folders || [],
    menuMemos: state.menuMemos || {},
    reportNote: state.reportNote || '',
    baseFolder: state.baseFolder || '기본 폴더',
    draftCal: JSON.stringify(
      state.draftCal || normalizeDraftCal(null)
    ),
    updatedAt: new Date().toISOString()
  };
}

async function syncCloud() {
  persistLocal();

  if (!user || !cloudReady) {
    return;
  }

  try {
    await setDoc(
      doc(
        db,
        'users',
        user.uid,
        'apps',
        'archive'
      ),
      cloudPayload(),
      {
        merge: false
      }
    );

  } catch (e) {
    console.error(
      '클라우드 저장 실패',
      e
    );
  }
}

function applyCloudData(d) {
  state.mine =
    d.mine || null;

  try {
    state.uploads =
      typeof d.uploads === 'string'
        ? JSON.parse(d.uploads || '{}')
        : (d.uploads || {});
  } catch {
    state.uploads = {};
  }

  state.mineChangedAt = d.mineChangedAt || null;
  state.lastNeisKey = d.lastNeisKey || null;

  state.comparisons =
    Array.isArray(d.comparisons)
      ? d.comparisons
      : [];

  state.favorites =
    new Set(
      Array.isArray(d.favorites)
        ? d.favorites
        : []
    );

  state.scraps =
    Array.isArray(d.scraps)
      ? d.scraps
      : [];

  state.ratings =
    d.ratings || {};

  state.folders =
    Array.isArray(d.folders)
      ? d.folders
      : [];

  state.menuMemos =
    d.menuMemos || {};

  state.reportNote =
    typeof d.reportNote === 'string'
      ? d.reportNote
      : '';

  state.baseFolder =
    d.baseFolder || '기본 폴더';

  state.draftCal =
    normalizeDraftCal(
      parseDraftCal(d.draftCal)
    );

  persistLocal();
}

async function initializeCloudForUser() {
  if (!user) {
    return;
  }

  cloudReady = false;

  const ref = doc(
    db,
    'users',
    user.uid,
    'apps',
    'archive'
  );

  try {
    const snap =
      await getDoc(ref);

    /* 이 브라우저에 남아있던(로그인 전) 기록을
       클라우드와 병합해 계정으로 흡수 */
    const local =
      readLocalPrivate();

    const hasLocal =
      (local.scraps || []).length ||
      Object.keys(local.ratings || {}).length ||
      Object.keys(local.menuMemos || {}).length ||
      (local.favorites || []).length;

    if (snap.exists()) {
      const merged =
        mergeCloudWithLocal(
          snap.data(),
          local
        );

      if (hasLocal) {
        await setDoc(
          ref,
          {
            ...merged,
            updatedAt:
              new Date().toISOString()
          },
          {
            merge: false
          }
        );
      }

      applyCloudData(merged);

    } else {
      const merged =
        mergeCloudWithLocal(
          cloudPayload(),
          local
        );

      await setDoc(
        ref,
        {
          ...merged,
          migrationVersion: 1,
          migratedFromLocal: true,
          createdAt:
            new Date().toISOString()
        },
        {
          merge: false
        }
      );

      applyCloudData(merged);
    }

    cloudReady = true;

  } catch (e) {
    cloudReady = false;

    console.error(
      '초기 클라우드 동기화 실패',
      e
    );
  }
}

/* ═════════════════════════════
   메뉴 분류
═════════════════════════════ */
const CLASS_RULES = {
  exception: {
    rice: [
      '비빔밥',
      '볶음밥',
      '덮밥',
      '국밥',
      '카레라이스',
      '오므라이스',
      '짜장밥',
      '컵밥',
      '주먹밥',
      '김밥',
      '영양밥'
    ],

    main: [
      '탕수육',
      '닭볶음탕',
      '떡갈비'
    ],

    dessert: [
      '식혜',
      '수정과',
      '미숫가루'
    ]
  },

  rice: [
    '밥',
    '죽',
    '리조또',
    '리소토',
    '필라프',
    '국수',
    '칼국수',
    '우동',
    '스파게티',
    '파스타',
    '짜장면',
    '비빔면',
    '냉면',
    '쫄면',
    '라면',
    '짬뽕'
  ],

  soup: [
    '국',
    '탕',
    '찌개',
    '전골',
    '스프',
    '수프',
    '수제비',
    '장국',
    '짬뽕국',
    '개장'
  ],

  soupExclude: [
    '탕수',
    '볶음탕',
    '국수',
    '국물떡'
  ],

  kimchi: [
    '김치',
    '깍두기',
    '총각',
    '석박지',
    '동치미',
    '겉절이',
    '나박',
    '백김치'
  ],

  mainIng: [
    '갈비',
    '불고기',
    '제육',
    '돈까스',
    '돈가스',
    '생선까스',
    '생선가스',
    '치즈까스',
    '왕돈까스',
    '치킨',
    '닭',
    '오리',
    '스테이크',
    '장조림',
    '탕수',
    '강정',
    '고등어',
    '삼치',
    '조기',
    '갈치',
    '꽁치',
    '동태',
    '코다리',
    '임연수',
    '가자미',
    '연어',
    '참치',
    '메로',
    '굴비',
    '장어',
    '생선',
    '미트볼',
    '함박',
    '너비아니',
    '산적',
    '폭찹',
    '깐풍',
    '유린기',
    '오징어',
    '쭈꾸미',
    '주꾸미',
    '낙지',
    '문어',
    '새우',
    '돼지',
    '소고기',
    '쇠고기',
    '한우',
    '우육',
    '돈육',
    '계육',
    '목살',
    '삼겹',
    '햄',
    '소시지',
    '소세지',
    '비엔나',
    '마라',
    '불백',
    '훈제'
  ],

  dessert: [
    '과일',
    '주스',
    '음료',
    '요구르트',
    '요거트',
    '아이스크림',
    '케이크',
    '쿠키',
    '빵',
    '푸딩',
    '젤리',
    '우유',
    '수박',
    '참외',
    '멜론',
    '메론',
    '포도',
    '사과',
    '바나나',
    '파인애플',
    '딸기',
    '오렌지',
    '키위',
    '자두',
    '복숭아',
    '천도',
    '귤',
    '한라봉',
    '망고',
    '에이드',
    '스무디',
    '약과',
    '화채',
    '샤베트',
    '셔벗',
    '라떼'
  ],

  side: [
    '무침',
    '나물',
    '샐러드',
    '잡채',
    '전',
    '말이',
    '조림',
    '볶음',
    '튀김',
    '피클',
    '장아찌',
    '묵',
    '두부',
    '계란',
    '달걀',
    '떡볶이',
    '구이',
    '찜',
    '쌈'
  ]
};

const _normCache =
  new Map();

const _catCache =
  new Map();

function normalize(s = '') {
  const key =
    String(s);

  if (
    _normCache.has(key)
  ) {
    return _normCache.get(key);
  }

  const n =
    key
      .replace(/\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]/g, '$1')
      .replace(/[*#@♥▶►◆■※&]/g, '')
      .replace(
        /자율선택|자율메뉴|자율/g,
        ''
      )
      .replace(
        /국내산|국산|친환경|무농약|유기농|저염|저당|Non-GMO|HACCP/gi,
        ''
      )
      .replace(/\s+/g, '')
      .trim();

  _normCache.set(
    key,
    n
  );

  return n;
}

function classify(name) {
  const n =
    normalize(name);

  if (
    _catCache.has(n)
  ) {
    return _catCache.get(n);
  }

  let cat =
    'side';

  const R =
    CLASS_RULES;

  outer: {
    for (
      const [c, words]
      of Object.entries(R.exception)
    ) {
      if (
        words.some(
          w => n.includes(w)
        )
      ) {
        cat = c;
        break outer;
      }
    }

    if (
      R.rice.some(
        w => n.includes(w)
      )
    ) {
      cat = 'rice';
      break outer;
    }

    if (
      R.soup.some(
        w => n.includes(w)
      ) &&
      !R.soupExclude.some(
        w => n.includes(w)
      )
    ) {
      cat = 'soup';
      break outer;
    }

    if (
      R.kimchi.some(
        w => n.includes(w)
      )
    ) {
      cat = 'kimchi';
      break outer;
    }

    if (
      R.mainIng.some(
        w => n.includes(w)
      )
    ) {
      cat = 'main';
      break outer;
    }

    if (
      R.dessert.some(
        w => n.includes(w)
      )
    ) {
      cat = 'dessert';
      break outer;
    }
  }

  _catCache.set(
    n,
    cat
  );

  return cat;
}

const CAT_LABEL = {
  rice: '밥',
  soup: '국·찌개',
  main: '주찬',
  side: '부찬',
  kimchi: '김치',
  dessert: '후식'
};

/* ═════════════════════════════
   스크랩북
═════════════════════════════ */
const DEFAULT_FOLDERS = [
  '다음 달 식단 후보',
  '계절 식단',
  '특식·행사식',
  '학생 반응 우수',
  '자율선택급식',
  '다른 학교 참고 식단',
  '수다날 식단',
  '다시 활용할 식단',
  '보완이 필요한 식단',
  '리포트 분석',
  '기본 폴더'
];

function splitMenus(menus) {
  const g = {
    rice: [],
    soup: [],
    kimchi: [],
    main: [],
    side: [],
    dessert: []
  };

  (menus || [])
    .forEach(
      m => {
        const c =
          classify(m);

        (g[c] || g.side)
          .push(m);
      }
    );

  return g;
}

function migrateScraps() {
  let changed =
    false;

  if (
    !Array.isArray(
      state.folders
    )
  ) {
    state.folders = [];
  }

  if (
    !state.baseFolder
  ) {
    state.baseFolder =
      '기본 폴더';
  }

  if (
    state.folders.length === 0 ||
    (
      state.folders.length === 1 &&
      state.folders[0] === '기본'
    )
  ) {
    state.folders =
      [...DEFAULT_FOLDERS];

    changed = true;

  } else {
    DEFAULT_FOLDERS
      .forEach(
        f => {
          if (
            !state.folders.includes(f)
          ) {
            state.folders.push(f);
            changed = true;
          }
        }
      );

    const gi =
      state.folders.indexOf(
        '기본'
      );

    if (
      gi > -1
    ) {
      state.folders.splice(
        gi,
        1
      );

      changed = true;
    }
  }

  if (
    !state.folders.includes(
      state.baseFolder
    )
  ) {
    state.folders.push(
      state.baseFolder
    );

    changed = true;
  }

  state.scraps =
    (state.scraps || [])
      .map(
        sc => {
          if (
            sc &&
            sc.schemaV === 2
          ) {
            return sc;
          }

          changed = true;

          const menus =
            Array.isArray(sc?.menus)
              ? sc.menus
              : [];

          const isAnalysis =
            menus.some(
              m =>
                /^주찬:|^부찬:/
                  .test(
                    String(m)
                  )
            ) ||
            sc?.school ===
              '분석 결과';

          const base = {
            schemaV: 2,

            id:
              sc?.id ||
              Date.now().toString(36) +
              Math.random()
                .toString(36)
                .slice(2, 6),

            type:
              isAnalysis
                ? 'idea'
                : 'meal',

            folder:
              (
                sc?.folder === '기본' ||
                !sc?.folder
              )
                ? state.baseFolder
                : sc.folder,

            title:
              sc?.title ||
              '제목 없음',

            school:
              sc?.school ||
              '',

            servedDate:
              sc?.date ||
              sc?.servedDate ||
              '',

            menus,

            calories:
              sc?.calories ||
              '',

            stars:
              sc?.stars ||
              0,

            memo:
              sc?.memo ||
              '',

            savedAt:
              sc?.savedAt ||
              dateISO(
                new Date()
              ),

            sourceType:
              isAnalysis
                ? '조합 분석'
                : '식단 카드',

            sourcePeriod:
              sc?.sourcePeriod ||
              '',

            snapshot:
              sc?.snapshot ||
              null
          };

          if (
            base.type === 'meal'
          ) {
            Object.assign(
              base,
              splitMenus(menus)
            );
          }

          return base;
        }
      );

  if (
    changed
  ) {
    persist();
  }
}

/* ═════════════════════════════
   공통
═════════════════════════════ */
function esc(v = '') {
  return String(v)
    .replace(
      /[&<>"']/g,
      m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[m])
    );
}

function dateISO(d) {
  return (
    `${d.getFullYear()}-` +
    `${String(
      d.getMonth() + 1
    ).padStart(2, '0')}-` +
    `${String(
      d.getDate()
    ).padStart(2, '0')}`
  );
}

const MAX_RANGE_YEARS =
  3;

function yearsAgo(
  years,
  base = new Date()
) {
  const d =
    new Date(base);

  d.setFullYear(
    d.getFullYear() -
    years
  );

  d.setDate(
    d.getDate() + 1
  );

  return dateISO(d);
}

function threeYearsAgo() {
  return yearsAgo(3);
}

function daysAgo(days) {
  const d =
    new Date();

  d.setDate(
    d.getDate() -
    (days - 1)
  );

  return dateISO(d);
}

function validateRange(
  from,
  to
) {
  if (
    !from ||
    !to
  ) {
    return '시작일과 종료일을 입력하세요.';
  }

  const start =
    new Date(
      `${from}T00:00:00`
    );

  const end =
    new Date(
      `${to}T00:00:00`
    );

  if (
    Number.isNaN(
      start.getTime()
    ) ||
    Number.isNaN(
      end.getTime()
    )
  ) {
    return '기간 값이 올바르지 않습니다.';
  }

  if (
    end < start
  ) {
    return '종료일은 시작일보다 빠를 수 없습니다.';
  }

  const min =
    new Date(end);

  min.setFullYear(
    min.getFullYear() -
    MAX_RANGE_YEARS
  );

  if (
    start < min
  ) {
    return '조회 기간은 최대 3년입니다.';
  }

  return '';
}

function quickRangeButtons(
  fromId,
  toId
) {
  return `
    <div
      class="row"
      style="
        gap:6px;
        flex-wrap:wrap
      "
    >

      <button
        class="btn ghost small"
        data-range-days="30"
        data-from="${fromId}"
        data-to="${toId}"
      >
        30일
      </button>

      <button
        class="btn ghost small"
        data-range-days="90"
        data-from="${fromId}"
        data-to="${toId}"
      >
        90일
      </button>

      <button
        class="btn ghost small"
        data-range-days="180"
        data-from="${fromId}"
        data-to="${toId}"
      >
        6개월
      </button>

      <button
        class="btn ghost small"
        data-range-years="1"
        data-from="${fromId}"
        data-to="${toId}"
      >
        1년
      </button>

      <button
        class="btn ghost small"
        data-range-years="2"
        data-from="${fromId}"
        data-to="${toId}"
      >
        2년
      </button>

      <button
        class="btn ghost small"
        data-range-years="3"
        data-from="${fromId}"
        data-to="${toId}"
      >
        3년
      </button>

    </div>
  `;
}

function bindQuickRanges(
  onChanged
) {
  $$('[data-range-days]')
    .forEach(
      b => {
        b.onclick =
          () => {
            const f =
              document.getElementById(
                b.dataset.from
              );

            const t =
              document.getElementById(
                b.dataset.to
              );

            if (
              !f ||
              !t
            ) {
              return;
            }

            f.value =
              daysAgo(
                +b.dataset.rangeDays
              );

            t.value =
              dateISO(
                new Date()
              );

            onChanged?.(
              f.value,
              t.value
            );
          };
      }
    );

  $$('[data-range-years]')
    .forEach(
      b => {
        b.onclick =
          () => {
            const f =
              document.getElementById(
                b.dataset.from
              );

            const t =
              document.getElementById(
                b.dataset.to
              );

            if (
              !f ||
              !t
            ) {
              return;
            }

            f.value =
              yearsAgo(
                +b.dataset.rangeYears
              );

            t.value =
              dateISO(
                new Date()
              );

            onChanged?.(
              f.value,
              t.value
            );
          };
      }
    );
}

function parseDishes(
  raw = ''
) {
  return String(raw)
    .split(
      /<br\s*\/?>|\n/gi
    )
    .map(
      v => v.trim()
    )
    .filter(Boolean)
    .map(
      line => {
        const nums =
          [
            ...line.matchAll(
              /\(([\d.]+)\)/g
            )
          ]
            .flatMap(
              m =>
                m[1]
                  .split('.')
                  .filter(Boolean)
            );

        return {
          name:
            line
              .replace(
                /\([^)]*\)/g,
                ''
              )
              .trim(),

          allergy:
            [...new Set(nums)]
        };
      }
    )
    .filter(
      x => x.name
    );
}

function menuMatches(
  name,
  keyword,
  similar
) {
  const n =
    normalize(name);

  const k =
    normalize(keyword);

  if (
    !k ||
    !n
  ) {
    return false;
  }

  return similar
    ? n.includes(k) ||
      k.includes(n)
    : n === k;
}

function schoolKey(s) {
  return (
    `${s.officeCode}:` +
    `${s.schoolCode}`
  );
}

function koreanDate(v) {
  return (
    `${v.slice(0, 4)}년 ` +
    `${Number(v.slice(4, 6))}월 ` +
    `${Number(v.slice(6, 8))}일`
  );
}

function formatDate(v) {
  return v
    ? `${v.slice(0,4)}.${v.slice(4,6)}.${v.slice(6,8)}`
    : '-';
}

function setStatus(
  msg,
  error = false
) {
  $('#status').innerHTML = `
    <div
      class="status ${
        error
          ? 'error'
          : ''
      }"
    >
      ${msg}
    </div>
  `;
}

function persist() {
  syncCloud();
}

/* ═════════════════════════════
   📌 핀 메뉴
═════════════════════════════ */
function isPinnedMenu(name) {
  const key =
    normalize(name);

  return [
    ...state.favorites
  ]
    .some(
      v =>
        normalize(v) === key
    );
}

function togglePinnedMenu(name) {
  if (
    !requireLogin('메뉴 핀')
  ) {
    return;
  }

  const key =
    normalize(name);

  const old =
    [
      ...state.favorites
    ]
      .find(
        v =>
          normalize(v) === key
      );

  if (
    old
  ) {
    state.favorites.delete(
      old
    );

  } else {
    state.favorites.add(
      name
    );
  }

  persist();

  if (
    state.tab === 'report' &&
    _report
  ) {
    renderReport();
  }
}

/* ═════════════════════════════
   📊 리포트 → 스크랩북 저장
═════════════════════════════ */
function saveCurrentReportToScrapbook() {
  if (
    !_report ||
    !state.mine
  ) {
    alert(
      '먼저 식단 리포트를 생성해주세요.'
    );

    return;
  }

  const {
    rows,
    from,
    to,
    keyword,
    today
  } = _report;

  const menuMap =
    new Map();

  const cats = {
    rice: new Map(),
    soup: new Map(),
    kimchi: new Map(),
    main: new Map(),
    side: new Map(),
    dessert: new Map()
  };

  rows
    .forEach(
      r => {
        parseDishes(
          r.dishes
        )
          .forEach(
            d => {
              const key =
                normalize(
                  d.name
                );

              if (
                !key
              ) {
                return;
              }

              const v =
                menuMap.get(key) ||
                {
                  name:
                    d.name,

                  count:
                    0,

                  latest:
                    '',

                  cat:
                    classify(
                      d.name
                    )
                };

              v.count++;

              if (
                r.date >
                v.latest
              ) {
                v.latest =
                  r.date;
              }

              menuMap.set(
                key,
                v
              );

              addCount(
                cats[v.cat],
                d,
                r.school,
                r.date
              );
            }
          );
      }
    );

  const topNames =
    cat =>
      [
        ...cats[cat].values()
      ]
        .sort(
          (a, b) =>
            b.count -
            a.count
        )
        .slice(
          0,
          5
        )
        .map(
          x => x.name
        );

  const topMain =
    topNames('main');

  const topSide =
    topNames('side');

  const pinned =
    [
      ...state.favorites
    ];

  if (
    !state.folders.includes(
      '리포트 분석'
    )
  ) {
    state.folders.push(
      '리포트 분석'
    );
  }

  const summaryMenus = [
    `분석기간: ${from} ~ ${to}`,
    `급식일: ${rows.length}일`,
    `고유 메뉴: ${menuMap.size}개`,

    ...(
      keyword
        ? [
            `분석 키워드: ${keyword}`
          ]
        : []
    ),

    ...(
      topMain.length
        ? [
            `주찬 TOP: ${topMain.join(', ')}`
          ]
        : []
    ),

    ...(
      topSide.length
        ? [
            `부찬 TOP: ${topSide.join(', ')}`
          ]
        : []
    ),

    ...(
      pinned.length
        ? [
            `핀 메뉴: ${pinned.join(', ')}`
          ]
        : []
    )
  ];

  const same =
    state.scraps.find(
      sc =>
        sc.type === 'report' &&
        sc.school ===
          state.mine.schoolName &&
        sc.sourcePeriod ===
          `${from}~${to}` &&
        (
          sc.snapshot?.keyword ||
          ''
        ) ===
        (
          keyword ||
          ''
        )
    );

  const report = {
    schemaV: 2,

    id:
      same?.id ||
      Date.now()
        .toString(36) +
      Math.random()
        .toString(36)
        .slice(2, 6),

    type:
      'report',

    folder:
      '리포트 분석',

    title:
      `${today} ${state.mine.schoolName} 식단 리포트`,

    school:
      state.mine.schoolName,

    servedDate:
      today,

    menus:
      summaryMenus,

    calories:
      '',

    stars:
      0,

    memo:
      state.reportNote ||
      '',

    savedAt:
      today,

    sourceType:
      '식단 리포트',

    sourcePeriod:
      `${from}~${to}`,

    snapshot: {
      reportDate:
        today,

      from,
      to,

      keyword:
        keyword ||
        '',

      mealDays:
        rows.length,

      uniqueMenus:
        menuMap.size,

      topMain,
      topSide,

      pinnedMenus:
        pinned
    }
  };

  if (
    same
  ) {
    const i =
      state.scraps
        .findIndex(
          sc =>
            sc.id ===
            same.id
        );

    state.scraps[i] =
      report;

  } else {
    state.scraps
      .unshift(
        report
      );
  }

  persist();

  alert(
    same
      ? `📊 ${today} 리포트를 최신 내용으로 업데이트했습니다.`
      : `📊 ${today} 리포트를 스크랩북의 '리포트 분석' 폴더에 저장했습니다.`
  );
}

/* ═════════════════════════════
   로그인 / 로그아웃
═════════════════════════════ */
async function doSignIn() {
  try {
    await signInWithPopup(
      auth,
      gprov
    );

  } catch (e) {
    console.error(e);

    const code =
      e?.code ||
      '';

    if (
      code ===
      'auth/popup-blocked'
    ) {
      alert(
        '브라우저가 팝업을 차단했어요.\n' +
        '주소창 오른쪽의 팝업 차단 아이콘을 눌러 허용한 뒤 다시 시도해주세요.'
      );

    } else if (
      code ===
      'auth/unauthorized-domain'
    ) {
      alert(
        '이 주소는 Firebase 승인 도메인에 등록되어 있지 않아요.\n' +
        'Firebase 콘솔 → Authentication → Settings → 승인된 도메인에 smart-meal-archive.vercel.app 을 추가해주세요.'
      );

    } else if (
      code !==
        'auth/popup-closed-by-user' &&
      code !==
        'auth/cancelled-popup-request'
    ) {
      alert(
        `로그인에 실패했어요.\n` +
        `오류 코드: ${
          code ||
          e.message ||
          '알 수 없음'
        }`
      );
    }
  }
}

/* 로그아웃 시 이 브라우저에 남은 개인 데이터 삭제 */
function clearPrivateBrowserData() {
  [
    'archive_my_school',
    'archive_compare_schools',
    'archive_uploads',
    'archive_mine_changed_at',
    'archive_last_neis_key',
    'archive_favorites',
    'archive_scraps',
    'archive_ratings',
    'archive_folders',
    'archive_menu_memos',
    'archive_report_note',
    'archive_base_folder'
  ]
    .forEach(
      key =>
        localStorage.removeItem(
          key
        )
    );
}

/* 화면의 개인 상태 초기화 */
function resetPrivateState() {
  state.mine =
    null;

  state.comparisons =
    [];

  state.uploads =
    {};

  state.mineChangedAt = null;
  state.lastNeisKey = null;

  state.favorites =
    new Set();

  state.scraps =
    [];

  state.ratings =
    {};

  state.folders =
    [...DEFAULT_FOLDERS];

  state.menuMemos =
    {};

  state.reportNote =
    '';

  state.baseFolder =
    '기본 폴더';

  state.loaded =
    [];

  state.tab =
    'mine';

  state.similar =
    true;

  _report =
    null;
}

async function doSignOut() {
  try {
    await signOut(auth);

    /* Firebase 자료는 삭제하지 않고
       현재 PC에 남은 자료만 지움 */
    clearPrivateBrowserData();

    resetPrivateState();

    user =
      null;

    cloudReady =
      false;

    shell();

  } catch (e) {
    console.error(
      '로그아웃 실패',
      e
    );
  }
}

/* ═════════════════════════════
   기본 화면
═════════════════════════════ */
function shell() {
  $('#app').innerHTML = `
    <header class="top">
      <div class="topin">

        <div class="brand">
          나의
          <span>
            식단 아카이브
          </span>
        </div>

        <div
          style="
            display:flex;
            gap:8px;
            align-items:center;
            flex-wrap:wrap;
            justify-content:flex-end
          "
        >

          <span class="soon-badge ${soriBetaOn() ? '' : 'hidden'}">
            ✨ NEW: ⭐ 추천식단 탭에 특일·학사일정 초안 식단 캘린더 오픈!
          </span>

          <div class="school-pill">
            ${
              state.mine
                ? `${esc(state.mine.schoolName)} · ${esc(state.mine.level)}`
                : '내 학교 미등록'
            }
          </div>

          ${
            user
              ? `
                <span class="cloud-tag">
                  ☁ ${esc(user.displayName || '')}
                </span>

                <button
                  class="btn ghost small"
                  id="logoutBtn"
                >
                  로그아웃
                </button>
              `
              : `
                <button
                  class="btn small"
                  id="loginBtn"
                >
                  🔑 Google 로그인
                </button>
              `
          }

        </div>
      </div>
    </header>

    <main class="wrap">

      <section class="hero">

        <h1>
          내 식단과 다른 학교의<br>
          실제 메뉴 조합을 검색하세요
        </h1>

        <p>
          나이스 급식 데이터를 불러와 기준 메뉴와 함께 편성한
          주찬·부찬을 분석하고, 실제 급식 날짜의 전체 식단을
          카드로 확인합니다.
        </p>

        ${
          user
            ? ''
            : `
              <p
                class="help"
                style="margin-top:6px"
              >
                🔐 로그인하면 내 학교·스크랩·핀·리포트를 불러옵니다.
                로그아웃하면 이 기기에서는 개인자료가 보이지 않아요.
              </p>
            `
        }

      </section>

      <div class="tabs">

        <button
          class="tab ${
            state.tab === 'mine'
              ? 'active'
              : ''
          }"
          data-tab="mine"
        >
          내 식단 아카이브
        </button>

        <button
          class="tab ${
            state.tab === 'compare'
              ? 'active'
              : ''
          }"
          data-tab="compare"
        >
          같은 학교급 3개교 비교
        </button>

        <button
          class="tab ${
            state.tab === 'trend'
              ? 'active'
              : ''
          }"
          data-tab="trend"
        >
          🔥 요즘 뜨는 메뉴
        </button>

        <button
          class="tab ${
            state.tab === 'report'
              ? 'active'
              : ''
          }"
          data-tab="report"
        >
          📊 내 식단 리포트
        </button>

        <button
          class="tab ${
            state.tab === 'scrap'
              ? 'active'
              : ''
          }"
          data-tab="scrap"
        >
          ${soriBetaOn() ? '⭐ 추천식단' : '📌 스크랩북'}
        </button>

      </div>

      <section id="controls"></section>
      <section id="status"></section>
      <section id="results"></section>

    </main>

    <p
      style="
        text-align:center;
        font-size:10px;
        color:#fff;
        padding:24px 0;
        user-select:none
      "
    >
      영양교사 김소리
    </p>

    <div id="modal"></div>
  `;

  if (
    user
  ) {
    $('#logoutBtn').onclick =
      doSignOut;

  } else {
    $('#loginBtn').onclick =
      doSignIn;
  }

  $$('[data-tab]')
    .forEach(
      b => {
        b.onclick =
          () => {
            state.tab =
              b.dataset.tab;

            shell();
          };
      }
    );

  renderControls();

  if (
    user &&
    !state.mine &&
    [
      'mine',
      'trend',
      'report'
    ].includes(state.tab)
  ) {
    openSchoolModal(
      'mine'
    );
  }
}

function commonFields() {
  const mc = state.mealCode || '2';
  const ur =
    state.mine && state.mine.officeCode === 'UPLOAD'
      ? uploadRange(state.mine.schoolName)
      : null;
  return `
    <div class="grid">

      <div class="field">
        <label>
          시작일
        </label>

        <input
          id="from"
          type="date"
          value="${ur ? ur.from : threeYearsAgo()}"
        >
      </div>

      <div class="field">
        <label>
          종료일
        </label>

        <input
          id="to"
          type="date"
          value="${ur ? ur.to : dateISO(new Date())}"
        >
      </div>

      <div class="field">
        <label>
          기준 메뉴
        </label>

        <input
          id="keyword"
          value="미역국"
          placeholder="예: 미역국"
        >
      </div>

      <div class="field">
        <label>
          식사 구분
        </label>
        <select id="mealCode" title="조식·석식은 해당 급식을 운영하는 학교만 데이터가 있어요">
          <option value="2" ${mc === '2' ? 'selected' : ''}>중식</option>
          <option value="1" ${mc === '1' ? 'selected' : ''}>조식</option>
          <option value="3" ${mc === '3' ? 'selected' : ''}>석식</option>
        </select>
      </div>

      <div class="field">

        <label>
          분석 방식
        </label>

        <select id="mode">

          <option value="all">
            주찬·부찬 모두
          </option>

          <option value="main">
            주찬 중심
          </option>

          <option value="side">
            부찬 중심
          </option>

        </select>

      </div>

    </div>

    <div
      class="field"
      style="margin-top:10px"
    >

      <label>
        빠른 기간
      </label>

      ${
        quickRangeButtons(
          'from',
          'to'
        )
      }

    </div>

    <div class="toggleline">

      <button
        class="toggle ${
          state.similar
            ? 'on'
            : ''
        }"
        id="similar"
      ></button>

      <span>
        비슷한 메뉴 포함
      </span>

    </div>
  `;
}

function renderControls() {
  const c =
    $('#controls');

  $('#status').innerHTML =
    '';

  $('#results').innerHTML =
    '';

  /* 로그아웃 상태 */
  if (
    !user
  ) {
    c.innerHTML = `
      <section class="panel">

        <h2>
          🔐 개인 식단 아카이브
        </h2>

        <div
          class="empty"
          style="margin-top:12px"
        >
          Google 로그인하면 내 학교 설정과
          스크랩·핀·리포트를 불러옵니다.
          <br>
          로그아웃 상태에서는 개인 저장자료를 표시하지 않습니다.
        </div>

      </section>
    `;

    return;
  }

  if (
    state.tab === 'mine'
  ) {
    c.innerHTML = `
      <section class="panel">

        <div
          class="row"
          style="justify-content:space-between"
        >

          <h2>
            내 학교 식단 검색
          </h2>

          <button
            class="btn"
            id="changeMine"
            style="font-size:15px;padding:12px 22px"
          >
            학교변경 / 🧒 유치원선생님 전용
          </button>

        </div>

        ${commonFields()}

        <div class="searchrow">

          <input
            disabled
            value="${
              state.mine
                ? esc(state.mine.schoolName)
                : '먼저 내 학교를 등록하세요.'
            }"
          >

          <button
            class="btn"
            id="analyze"
          >
            실제 식단 분석
          </button>

        </div>

        <div class="help">
          조회 기간은 최대 3년입니다.
          원하는 기간의 나이스 중식 자료를 검색합니다.
        </div>

      </section>
    `;

    $('#changeMine').onclick =
      () =>
        openSchoolModal(
          'mine'
        );

    bindCommon();

    $('#analyze').onclick =
      analyze;

  } else if (
    state.tab === 'compare'
  ) {
    c.innerHTML = `
      <section class="panel">

        <div
          class="row"
          style="justify-content:space-between"
        >

          <h2>
            경기도 내 같은 학교급 비교
          </h2>

          <button
            class="btn ghost small"
            id="addSchool"
          >
            비교학교 찾기
          </button>

        </div>

        <div class="school-layout">

          <div class="box">

            <h3>
              내 학교
            </h3>

            <div class="chips">
              ${
                state.mine
                  ? schoolChip(
                      state.mine,
                      false
                    )
                  : '<span class="help">내 학교 미등록</span>'
              }
            </div>

          </div>

          <div class="box">

            <h3>
              선택 비교학교
              <span class="help">
                최대 3개
              </span>
            </h3>

            <div
              class="chips"
              id="selectedChips"
            >
              ${
                state.comparisons.length
                  ? state.comparisons
                      .map(
                        s =>
                          schoolChip(
                            s,
                            true
                          )
                      )
                      .join('')
                  : '<span class="help">비교학교를 선택하세요.</span>'
              }
            </div>

          </div>

        </div>

        ${commonFields()}

        <div class="searchrow">

          <input
            disabled
            value="내 학교와 비교학교의 실제 식단을 함께 분석합니다."
          >

          <button
            class="btn"
            id="analyze"
          >
            비교 분석
          </button>

        </div>

        <div class="warn">
          내 학교 1개 +
          같은 학교급 비교학교 최대 3개
          · 조회 기간 최대 3년
        </div>

      </section>
    `;

    $('#addSchool').onclick =
      () =>
        openSchoolModal(
          'compare'
        );

    $$('[data-remove-school]')
      .forEach(
        b => {
          b.onclick =
            () => {
              state.comparisons =
                state.comparisons
                  .filter(
                    s =>
                      schoolKey(s) !==
                      b.dataset.removeSchool
                  );

              persist();
              renderControls();
            };
        }
      );

    bindCommon();

    $('#analyze').onclick =
      analyze;

  } else if (
    state.tab === 'trend'
  ) {
    c.innerHTML = `
      <section class="panel">

        <h2>
          🔥 요즘 뜨는 메뉴
        </h2>

        <p
          class="help"
          style="margin:6px 0 12px"
        >
          내 학교와 비교학교의 실제 식단을
          선택한 기간 동안 분석합니다.
          최대 3년까지 볼 수 있고,
          같은 기간 내 학교에 없었던 메뉴는
          ✨NEW로 표시해요.
        </p>

        <div
          class="chips"
          style="margin-bottom:12px"
        >
          ${
            [
              state.mine,
              ...state.comparisons
            ]
              .filter(Boolean)
              .map(
                s =>
                  `<span class="chip">${esc(s.schoolName)}</span>`
              )
              .join('') ||
            '<span class="help">학교를 등록하세요</span>'
          }
        </div>

        <div class="grid">

          <div class="field">
            <label>
              시작일
            </label>

            <input
              id="tFrom"
              type="date"
              value="${threeYearsAgo()}"
            >
          </div>

          <div class="field">
            <label>
              종료일
            </label>

            <input
              id="tTo"
              type="date"
              value="${dateISO(new Date())}"
            >
          </div>

          <div class="field">
            <label>
              빠른 기간
            </label>

            ${
              quickRangeButtons(
                'tFrom',
                'tTo'
              )
            }
          </div>

        </div>

        <div
          class="row"
          style="margin-top:13px"
        >

          <button
            class="btn"
            id="trendGo"
          >
            트렌드 분석
          </button>

        </div>

      </section>
    `;

    bindQuickRanges();

    $('#trendGo').onclick =
      analyzeTrend;

  } else if (
    state.tab === 'report'
  ) {
    c.innerHTML = `
      <section class="panel">

        <h2>
          📊 내 식단 리포트
        </h2>

        <p
          class="help"
          style="margin:6px 0 12px"
        >
          기간과 키워드를 정해
          내 학교 식단을 분석합니다.
          최대 3년까지 조회할 수 있으며,
          비교학교 참고 메뉴도 같은 선택 기간을
          기준으로 분석합니다.
        </p>

        <div class="grid">

          <div class="field">

            <label>
              시작일
            </label>

            <input
              id="rFrom"
              type="date"
              value="${threeYearsAgo()}"
            >

          </div>

          <div class="field">

            <label>
              종료일
            </label>

            <input
              id="rTo"
              type="date"
              value="${dateISO(new Date())}"
            >

          </div>

          <div class="field">

            <label>
              키워드 분석 (선택)
            </label>

            <input
              id="rKeyword"
              placeholder="예: 미역국 — 비우면 전체만"
            >

          </div>

          <div class="field">

            <label>
              빠른 기간
            </label>

            ${
              quickRangeButtons(
                'rFrom',
                'rTo'
              )
            }

          </div>

        </div>

        <div
          class="row"
          style="margin-top:13px"
        >

          <button
            class="btn"
            id="reportGo"
          >
            리포트 생성
          </button>

        </div>

      </section>
    `;

    bindQuickRanges();

    $('#reportGo').onclick =
      analyzeReport;

  } else if (
    state.tab === 'scrap'
  ) {
    renderScrapbook();
  }
}

function bindCommon() {
  const mcEl = $('#mealCode');
  if (mcEl) {
    mcEl.onchange = () => {
      state.mealCode = mcEl.value;
      localStorage.setItem('archive_meal_code', state.mealCode);
    };
  }
  $('#similar').onclick =
    () => {
      state.similar =
        !state.similar;

      $('#similar')
        .classList
        .toggle(
          'on',
          state.similar
        );
    };

  bindQuickRanges();
}

function schoolChip(
  s,
  removable
) {
  return `
    <span class="chip">

      ${esc(s.schoolName)}

      ${
        removable
          ? `
            <button
              data-remove-school="${schoolKey(s)}"
            >
              ×
            </button>
          `
          : ''
      }

    </span>
  `;
}

/* ═════════════════════════════
   학교 검색
═════════════════════════════ */
/* ── 나이스 월간식단표 엑셀 해석 (유치원 등 검색 불가 기관용) ── */
function parseMonthlyExcelArchive(book) {
  const ws = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  let year = '', mon = '', orgName = '';
  for (const row of rows) {
    for (const cell of row) {
      const t = String(cell || '').trim();
      const ym = t.match(/조회년월\s*:\s*(\d{4})년\s*(\d{1,2})월/);
      if (ym) { year = ym[1]; mon = String(ym[2]).padStart(2, '0'); }
      if (!orgName && /(학교|유치원)$/.test(t) && !/조회|월간|식단/.test(t)) orgName = t;
    }
  }
  if (!year || !mon) throw new Error('조회 연월을 찾지 못했어요. 나이스 월간식단표 엑셀인지 확인해 주세요.');
  const days = {};
  for (let r = 0; r < rows.length - 1; r++) {
    const dr = rows[r] || [], mr = rows[r + 1] || [];
    const nd = [];
    for (let c = 0; c < dr.length; c++) {
      const v = String(dr[c] ?? '').trim().replace(/\.0$/, '');
      if (/^\d{1,2}$/.test(v)) { const day = +v; if (day >= 1 && day <= 31) nd.push({ c, day }); }
    }
    if (!nd.length) continue;
    const looks = mr.some(cell => { const t = String(cell || ''); return /\n/.test(t) || /중식/.test(t) || /에너지/.test(t); });
    if (!looks) continue;
    for (const { c, day } of nd) {
      const raw = String(mr[c] || '').replace(/\r/g, '').trim();
      if (!raw || raw === '0') continue;
      const lines = raw.split('\n').map(x => x.trim()).filter(Boolean);
      const ei = lines.findIndex(x => /^\*?\s*에너지/.test(x));
      const menu = (ei >= 0 ? lines.slice(0, ei) : lines.slice()).filter(x => x !== '[식단]' && x !== '중식' && x !== '0');
      if (!menu.length) continue;
      days[`${year}${mon}${String(day).padStart(2, '0')}`] = menu.join('<br/>');
    }
  }
  if (!Object.keys(days).length) throw new Error('날짜별 식단을 찾지 못했어요.');
  return { orgName, year, mon, days };
}

/* ── 나이스 조리방법조회(레시피) 엑셀 해석 — 기간 지정 파일 한 개로 여러 날 등록 ── */
function parseRecipeExcelArchive(book) {
  const ws = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  let orgName = '';
  const days = {};
  let cur = '';
  let curMealOk = true;
  for (const row of rows) {
    const joined = row.map(c => String(c || '')).join(' ');
    if (!orgName) {
      for (const cell of row) {
        const t = String(cell || '').trim();
        if (/(학교|유치원)$/.test(t) && !/조회|조리|급식일/.test(t)) { orgName = t; break; }
      }
    }
    const dm = joined.match(/급식일\s*:\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (dm) {
      cur = `${dm[1]}${String(dm[2]).padStart(2, '0')}${String(dm[3]).padStart(2, '0')}`;
      curMealOk = true;
      continue;
    }
    if (!cur) continue;
    const c0 = String(row[0] || '').replace(/\s+/g, '');
    if (c0) {
      if (/조식|석식/.test(c0)) curMealOk = false;
      else if (/중식|간식/.test(c0)) curMealOk = true;
    }
    if (!curMealOk) continue;
    const name = String(row[1] || '').trim();
    if (!name) continue;
    if (/^구\s*분$/.test(name) || /요리방법|사용재료/.test(name)) continue;
    days[cur] = days[cur] || [];
    if (!days[cur].includes(name)) days[cur].push(name);
  }
  const out = {};
  for (const d of Object.keys(days)) {
    if (days[d].length) out[d] = days[d].join('<br/>');
  }
  if (!Object.keys(out).length) throw new Error('조리방법 파일에서 날짜별 메뉴를 찾지 못했어요.');
  return { orgName, days: out };
}

/* 파일 형식 자동 구분: 조리방법조회(급식일 블록) vs 월간식단표(조회년월) */
function parseAnyMealExcel(book) {
  const ws = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const text = rows.slice(0, 8).flat().map(c => String(c || '')).join(' ');
  if (/조리방법|급식일\s*:/.test(text)) {
    const r = parseRecipeExcelArchive(book);
    return { orgName: r.orgName, days: r.days, kind: '조리방법조회' };
  }
  const m = parseMonthlyExcelArchive(book);
  return { orgName: m.orgName, days: m.days, kind: `${Number(m.mon)}월 월간식단표` };
}

function uploadSchoolObj(name) {
  const baseName = name.replace(/\s*\(업로드\)\s*$/, '');
  const level =
    /초등학교$/.test(baseName) ? '초등학교'
    : /중학교$/.test(baseName) ? '중학교'
    : /고등학교$/.test(baseName) ? '고등학교'
    : '유치원';
  return {
    officeCode: 'UPLOAD',
    schoolCode: 'UP-' + name,
    schoolName: name,
    level,
    address: '엑셀 업로드 기관',
    region: '업로드'
  };
}

function uploadRange(name) {
  const days = Object.keys(((state.uploads || {})[name] || {}).days || {}).sort();
  if (!days.length) return null;
  const fmt = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  let from = fmt(days[0]);
  const to = fmt(days[days.length - 1]);
  /* 조회기간 3년 제한에 맞춰 시작일을 조정 */
  const min = new Date(to + 'T00:00:00');
  min.setFullYear(min.getFullYear() - 3);
  min.setDate(min.getDate() + 1);
  const minISO = dateISO(min);
  if (from < minISO) from = minISO;
  return { from, to, count: days.length };
}

function renderUploadSaved(type) {
  const box = $('#uploadSavedList');
  if (!box) return;
  const names = Object.keys(state.uploads || {}).filter(
    n => Object.keys((state.uploads[n] || {}).days || {}).length
  );
  if (!names.length) { box.innerHTML = ''; return; }
  box.innerHTML =
    '<p style="font-weight:800;margin:12px 0 6px">💾 저장된 업로드 기관 <span class="help" style="font-weight:400">— 파일을 다시 올릴 필요 없이 클릭 한 번으로 사용해요</span></p>' +
    names.map(n => {
      const r = uploadRange(n);
      return `<div class="row" style="justify-content:space-between;align-items:center;border:1px solid #e2e2e6;border-radius:10px;padding:8px 12px;margin-bottom:6px">
        <span style="font-size:13.5px"><b>${esc(n)}</b> · ${r.from} ~ ${r.to} (${r.count}일치)</span>
        <span>
          <button class="btn small" data-use-upload="${esc(n)}">이 기관으로 분석</button>
          <button class="btn ghost small" data-del-upload="${esc(n)}">삭제</button>
        </span>
      </div>`;
    }).join('');
  $$('[data-use-upload]').forEach(b => {
    b.onclick = () => selectSchool(uploadSchoolObj(b.dataset.useUpload), type);
  });
  $$('[data-del-upload]').forEach(b => {
    b.onclick = () => {
      if (!confirm(`${b.dataset.delUpload}의 업로드 식단을 모두 삭제할까요?`)) return;
      delete state.uploads[b.dataset.delUpload];
      syncCloud();
      renderUploadSaved(type);
    };
  });
}

async function registerUploadInstitution(type) {
  const nameInput = $('#uploadInstName');
  const fileInput = $('#uploadExcelFiles');
  const st = $('#uploadStatus');
  const files = [...(fileInput.files || [])];
  if (!files.length) return;
  try {
    let name = nameInput.value.trim();
    let merged = null;
    const months = [];
    for (const f of files) {
      const parsed = parseAnyMealExcel(XLSX.read(await f.arrayBuffer(), { type: 'array' }));
      if (!name && parsed.orgName) name = parsed.orgName;
      months.push(parsed.kind);
      merged = merged || {};
      Object.assign(merged, parsed.days);
    }
    if (!name) throw new Error('기관명을 입력해 주세요.');
    /* 학교급은 원래 이름으로 판정한 뒤, 나이스 연동 학교와 구분되도록 "(업로드)" 표시를 붙임 */
    const baseName = name.replace(/\s*\(업로드\)\s*$/, '');
    name = baseName + '(업로드)';
    state.uploads = state.uploads || {};
    /* 예전 방식(표시 없음)으로 저장된 데이터가 있으면 새 이름으로 합침 */
    if (state.uploads[baseName]) {
      state.uploads[name] = state.uploads[name] || { name, days: {} };
      Object.assign(state.uploads[name].days, state.uploads[baseName].days || {});
      delete state.uploads[baseName];
    }
    const prev = (state.uploads[name] && state.uploads[name].days) || {};
    state.uploads[name] = { name, days: { ...prev, ...merged } };
    const total = Object.keys(state.uploads[name].days).length;
    const schoolObj = uploadSchoolObj(name);
    st.textContent = `✅ ${name}: 이번에 ${files.length}개 파일(${months.join(', ')})을 읽어 총 ${total}일치가 쌓였어요.`;
    syncCloud();
    selectSchool(schoolObj, type);
  } catch (e) {
    st.textContent = '업로드 실패: ' + e.message;
  } finally {
    fileInput.value = '';
  }
}

function openSchoolModal(type) {
  const m =
    $('#modal');

  const title =
    type === 'mine'
      ? '내 학교 검색'
      : '같은 학교급 비교학교 검색';

  const levelHint =
    state.mine
      ? `현재 학교급: ${esc(state.mine.level)}`
      : '내 학교를 먼저 등록합니다.';
  const mineNote =
    type === 'mine'
      ? '<br><b>내 학교는 본인 근무교만 설정해 주세요. 학교 변경은 전근 시 연 1회만 가능하며, 추가 변경은 개발자 김소리 선생님께 문의해 주세요.</b>'
      : '';

  m.innerHTML = `
    <div class="modal">

      <div class="modal-card">

        <h2>
          ${title}
        </h2>

        <p>
          경기도 학교만 검색됩니다.
          ${levelHint}
          ${mineNote}
        </p>

        <div class="searchrow">

          <input
            id="schoolQuery"
            placeholder="학교명을 2글자 이상 입력"
          >

          <button
            class="btn"
            id="schoolSearch"
          >
            학교 검색
          </button>

        </div>

        <div
          id="schoolSearchStatus"
          class="help"
        ></div>

        <div
          id="schoolList"
          class="school-results"
        ></div>

        <div style="border-top:1px dashed #d9d9de;margin:16px 0 10px"></div>

        <p style="font-weight:800;margin:0 0 4px">
          🧒 유치원 등 검색이 안 되는 기관 — 엑셀로 등록
        </p>

        <p class="help" style="margin-top:0">
          나이스에서 받은 <b>월간식단표</b> 또는 <b>조리방법조회(레시피)</b> 엑셀을 올리면
          이 기관의 식단으로 분석·비교할 수 있어요. 파일 형식은 자동으로 구분됩니다.
          <b>조리방법조회는 기간을 지정해 한 파일로 여러 날을 등록</b>할 수 있어 편하고,
          월간식단표는 여러 달 파일을 한 번에 선택해 올리면 돼요.
          (추가로 올리면 계속 쌓입니다. 비교기관은 같은 급 선생님께 파일을 받아 올리면 되고,
          구글 로그인 중이면 계정에도 저장됩니다.)
        </p>

        <div class="searchrow">

          <input
            id="uploadInstName"
            placeholder="기관명 (비우면 엑셀에서 자동 인식)"
          >

          <button
            class="btn"
            id="uploadExcelBtn"
          >
            📄 엑셀 업로드
          </button>

          <input
            type="file"
            id="uploadExcelFiles"
            accept=".xlsx,.xls"
            multiple
            style="display:none"
          >

        </div>

        <div
          id="uploadStatus"
          class="help"
        ></div>

        <div id="uploadSavedList"></div>

        <details style="margin-top:10px;border:1px solid #e2e2e6;border-radius:10px;overflow:hidden;background:#fff">
          <summary style="cursor:pointer;padding:10px 14px;font-weight:800;font-size:13.5px;color:#047857">
            📖 유치원 선생님 이용 안내 (누르면 펼쳐져요)
          </summary>
          <div style="padding:4px 16px 14px;font-size:13px;line-height:1.8;color:#3f3f46">
            <p style="margin:8px 0">
              교육부의 공개 자료(나이스 개방포털)에 유치원 급식 정보가 포함되어 있지 않아,
              유치원은 학교 이름 검색이 되지 않습니다. 이는 프로그램 오류가 아닌 교육부 정책에 따른 것입니다.
              대신 아래 방법으로 초·중·고와 동일하게 분석·비교에 참여할 수 있습니다.
            </p>
            <p style="margin:8px 0;font-weight:800;color:#111113">이용 방법</p>
            <p style="margin:6px 0">
              ① 유치원 나이스(급식 메뉴)에서 <b>조리방법조회를 기간 지정으로 엑셀 저장</b>합니다.
              한 파일로 그 기간 전체가 등록되니 가장 편해요. (월간식단표 엑셀도 사용 가능 — 여러 달 파일을 한 번에 선택)
            </p>
            <p style="margin:6px 0">
              ② 위 칸에 기관명을 쓰고(비우면 자동 인식) <b>「📄 엑셀 업로드」</b>로 파일을 선택하면
              형식이 자동 구분되어 등록됩니다. 추가로 올릴수록 데이터가 계속 쌓여요.
            </p>
            <p style="margin:6px 0">
              ③ <b>비교기관</b>은 같은 급(유치원) 선생님께 파일을 받아, 비교학교 검색 창의 같은 업로드 칸에
              그 기관명으로 올리면 됩니다. (최대 3곳)
            </p>
            <p style="margin:6px 0">
              ④ 등록 후에는 기준 메뉴 검색, 주찬·부찬 빈도 분석 등 <b>모든 기능이 초·중·고와 동일</b>하게 작동하고,
              구글 로그인 중이면 업로드한 식단이 계정에 저장되어 다른 기기에서도 그대로 불러와집니다.
            </p>
          </div>
        </details>

        <div
          class="row"
          style="
            justify-content:flex-end;
            margin-top:14px
          "
        >

          <button
            class="btn ghost"
            id="closeModal"
          >
            닫기
          </button>

        </div>

      </div>

    </div>
  `;

  $('#closeModal').onclick =
    () =>
      m.innerHTML = '';

  $('#uploadExcelBtn').onclick =
    () =>
      $('#uploadExcelFiles').click();

  $('#uploadExcelFiles').onchange =
    () =>
      registerUploadInstitution(type);

  renderUploadSaved(type);

  $('#schoolSearch').onclick =
    () =>
      searchSchools(type);

  $('#schoolQuery').onkeydown =
    e => {
      if (
        e.key === 'Enter'
      ) {
        searchSchools(type);
      }
    };

  setTimeout(
    () =>
      $('#schoolQuery').focus(),
    20
  );
}

async function searchSchools(type) {
  const q =
    $('#schoolQuery')
      .value
      .trim();

  const st =
    $('#schoolSearchStatus');

  const list =
    $('#schoolList');

  if (
    q.length < 2
  ) {
    st.textContent =
      '학교명을 2글자 이상 입력하세요.';

    return;
  }

  st.innerHTML =
    '<span class="loading"></span>학교를 검색하고 있습니다.';

  list.innerHTML =
    '';

  try {
    const r =
      await fetch(
        `/api/schools?q=${encodeURIComponent(q)}`
      );

    const data =
      await r.json();

    if (
      !r.ok
    ) {
      throw Error(
        data.error ||
        '학교 검색 실패'
      );
    }

    const filtered =
      type === 'compare' &&
      state.mine
        ? data.filter(
            s =>
              s.level ===
              state.mine.level
          )
        : data;

    if (
      !filtered.length &&
      q.includes('유치원')
    ) {
      st.innerHTML =
        '🧒 유치원은 나이스 개방 API에서 제공되지 않아 검색이 안 돼요. 아래 <b>엑셀로 등록</b>을 이용하면 분석·비교에 똑같이 참여할 수 있어요.';

      return;
    }

    st.textContent =
      `${filtered.length}개 학교를 찾았습니다.`;

    list.innerHTML =
      filtered
        .map(
          s => `
            <button
              class="school-item"
              data-school='${esc(JSON.stringify(s))}'
            >

              <b>
                ${esc(s.schoolName)}
              </b>

              <small>
                ${esc(s.address || '경기도')}
                ·
                ${esc(s.level)}
              </small>

            </button>
          `
        )
        .join('') ||
      '<div class="empty">조건에 맞는 학교가 없습니다.</div>';

    $$('.school-item')
      .forEach(
        b => {
          b.onclick =
            () =>
              selectSchool(
                JSON.parse(
                  b.dataset.school
                ),
                type
              );
        }
      );

  } catch (e) {
    st.textContent =
      e.message;
  }
}

function selectSchool(
  s,
  type
) {
  if (
    type === 'mine' &&
    s.officeCode !== 'UPLOAD'
  ) {
    const key = schoolKey(s);
    const returning =
      state.lastNeisKey && key === state.lastNeisKey;
    if (!returning) {
      const changedAt =
        state.mineChangedAt ? new Date(state.mineChangedAt) : null;
      const within24h =
        changedAt && Date.now() - changedAt.getTime() < 86400000;
      const withinYear =
        changedAt && Date.now() - changedAt.getTime() < 365 * 86400000;
      if (state.lastNeisKey && withinYear && !within24h) {
        alert(
          '학교 변경은 전근 시 연 1회만 가능합니다.\n' +
          `(최근 설정일: ${String(state.mineChangedAt).slice(0, 10)})\n\n` +
          '추가 변경이 필요하면 개발자 김소리 선생님께 따로 문의해 주세요.'
        );
        const code = prompt(
          '개발자에게 받은 해제 코드가 있으면 입력하세요.\n없으면 취소를 눌러 주세요.'
        );
        if (String(code || '').trim().toUpperCase() !== 'SORI-OK') return;
      }
      const msg =
        state.mine
          ? `"내 학교"는 본인이 근무하는 학교만 설정하는 기능이에요.\n타 학교를 내 학교로 설정해 식단 리포트를 보는 것은 예의에 어긋날 수 있어요.\n\n${s.schoolName}(으)로 내 학교를 변경할까요?\n(학교 변경은 전근 시 연 1회만 가능합니다)`
          : `${s.schoolName}이(가) 본인이 근무하는 학교가 맞나요?\n(내 학교는 본인 근무교만 설정하며, 이후 변경은 전근 시 연 1회만 가능합니다. 잘못 골랐다면 24시간 안에는 자유롭게 정정할 수 있어요.)`;
      if (!confirm(msg)) return;
      state.lastNeisKey = key;
      state.mineChangedAt = new Date().toISOString();
    }
  }
  if (
    type === 'mine'
  ) {
    state.mine =
      s;

    state.comparisons =
      state.comparisons
        .filter(
          x =>
            x.level ===
              s.level &&
            schoolKey(x) !==
              schoolKey(s)
        )
        .slice(
          0,
          3
        );

  } else {
    if (
      !state.mine
    ) {
      return;
    }

    if (
      s.level !==
      state.mine.level
    ) {
      alert(
        '내 학교와 같은 학교급만 선택할 수 있습니다.'
      );

      return;
    }

    if (
      schoolKey(s) ===
      schoolKey(state.mine)
    ) {
      alert(
        '내 학교는 비교학교에서 제외됩니다.'
      );

      return;
    }

    if (
      state.comparisons
        .some(
          x =>
            schoolKey(x) ===
            schoolKey(s)
        )
    ) {
      alert(
        '이미 선택한 학교입니다.'
      );

      return;
    }

    if (
      state.comparisons.length >=
      3
    ) {
      alert(
        '비교학교는 최대 3개까지 선택할 수 있습니다.'
      );

      return;
    }

    state.comparisons.push(
      s
    );
  }

  persist();

  $('#modal').innerHTML =
    '';

  shell();
}

/* ═════════════════════════════
   식단 API
═════════════════════════════ */
async function fetchMeals(
  school,
  from,
  to
) {
  /* 엑셀로 등록한 기관(유치원 등)은 업로드된 식단에서 조회 */
  if (school.officeCode === 'UPLOAD') {
    const store =
      (state.uploads || {})[school.schoolName];
    if (!store || !store.days) {
      throw Error(
        `${school.schoolName}: 업로드된 식단이 없습니다. 학교 검색 창에서 엑셀을 다시 올려주세요.`
      );
    }
    const f = String(from).replaceAll('-', '');
    const t = String(to).replaceAll('-', '');
    return Object.keys(store.days)
      .filter(d => d >= f && d <= t)
      .sort()
      .map(d => ({
        date: d,
        mealName: '중식',
        dishes: store.days[d],
        calories: '',
        nutrients: '',
        school
      }));
  }

  const url =
    `/api/meals-range?` +
    `office=${encodeURIComponent(school.officeCode)}` +
    `&school=${encodeURIComponent(school.schoolCode)}` +
    `&from=${from}` +
    `&to=${to}` +
    `&meal=${state.mealCode || '2'}`;

  const r =
    await fetch(url);

  const rows =
    await r.json();

  if (
    !r.ok
  ) {
    throw Error(
      `${school.schoolName}: ${
        rows.error ||
        '식단 조회 실패'
      }`
    );
  }

  return rows.map(
    row => ({
      ...row,
      school
    })
  );
}

/* ═════════════════════════════
   조합 검색
═════════════════════════════ */
async function analyze() {
  if (
    !state.mine
  ) {
    openSchoolModal(
      'mine'
    );

    return;
  }

  const from =
    $('#from').value;

  const to =
    $('#to').value;

  const keyword =
    $('#keyword')
      .value
      .trim();

  if (
    !from ||
    !to ||
    !keyword
  ) {
    setStatus(
      '기간과 기준 메뉴를 입력하세요.',
      true
    );

    return;
  }

  const err =
    validateRange(
      from,
      to
    );

  if (
    err
  ) {
    setStatus(
      err,
      true
    );

    return;
  }

  const targets =
    state.tab === 'mine'
      ? [
          state.mine
        ]
      : [
          state.mine,
          ...state.comparisons
        ];

  if (
    state.tab === 'compare' &&
    !state.comparisons.length
  ) {
    setStatus(
      '비교학교를 한 곳 이상 선택하세요.',
      true
    );

    return;
  }

  $('#results').innerHTML =
    '';

  setStatus(
    `<span class="loading"></span>${targets.length}개 학교의 실제 식단을 불러오고 있습니다.`
  );

  try {
    const results =
      await Promise.all(
        targets.map(
          s =>
            fetchMeals(
              s,
              from,
              to
            )
        )
      );

    state.loaded =
      results.flat();

    const matches =
      analyzeMeals(
        state.loaded,
        keyword,
        state.similar
      );

    setStatus(
      `${targets.length}개교의 실제 급식 ${state.loaded.length}일을 불러왔고, ` +
      `'${esc(keyword)}'가 포함된 ${matches.meals.length}일을 찾았습니다.` +
      (
        state.loaded.length === 0 &&
        (state.mealCode === '1' || state.mealCode === '3')
          ? `<br>⚠️ 지금 <b>식사 구분</b>이 ` +
            `<b>${state.mealCode === '1' ? '조식' : '석식'}</b>으로 되어 있어요. ` +
            `조식·석식은 나이스에 공개하지 않는 학교가 많으니, ` +
            `<b>'중식'</b>으로 바꿔 다시 조회해보세요.`
          : ''
      )
    );

    renderResults(
      matches,
      keyword,
      from,
      to,
      targets
    );

  } catch (e) {
    setStatus(
      e.message,
      true
    );
  }
}

function analyzeMeals(
  rows,
  keyword,
  similar
) {
  const mainMap =
    new Map();

  const sideMap =
    new Map();

  const matched =
    [];

  for (
    const row
    of rows
  ) {
    const dishes =
      parseDishes(
        row.dishes
      );

    const hit =
      dishes.some(
        d =>
          menuMatches(
            d.name,
            keyword,
            similar
          )
      );

    if (
      !hit
    ) {
      continue;
    }

    matched.push({
      ...row,
      dishes
    });

    for (
      const dish
      of dishes
    ) {
      if (
        menuMatches(
          dish.name,
          keyword,
          similar
        )
      ) {
        continue;
      }

      const type =
        classify(
          dish.name
        );

      if (
        type === 'main'
      ) {
        addCount(
          mainMap,
          dish,
          row.school,
          row.date
        );

      } else if (
        type === 'side'
      ) {
        addCount(
          sideMap,
          dish,
          row.school,
          row.date
        );
      }
    }
  }

  return {
    meals:
      matched
        .sort(
          (a, b) =>
            b.date.localeCompare(
              a.date
            )
        ),

    main:
      rank(mainMap),

    side:
      rank(sideMap)
  };
}

function addCount(
  map,
  dish,
  school,
  date
) {
  const key =
    normalize(
      dish.name
    );

  if (
    !key
  ) {
    return;
  }

  const v =
    map.get(key) ||
    {
      name:
        dish.name,

      count:
        0,

      schools:
        new Set(),

      latest:
        ''
    };

  v.count++;

  v.schools.add(
    school.schoolName
  );

  if (
    date > v.latest
  ) {
    v.latest =
      date;
  }

  map.set(
    key,
    v
  );
}

function rank(map) {
  return [
    ...map.values()
  ]
    .sort(
      (a, b) =>
        b.count -
        a.count ||
        b.schools.size -
        a.schools.size
    )
    .slice(
      0,
      15
    );
}

function renderResults(
  a,
  keyword,
  from,
  to,
  targets
) {
  $('#results').innerHTML = `
    <div class="section-title">

      <div>

        <h2>
          '${esc(keyword)}'
          실제 식단 분석
        </h2>

        <p>
          ${from} ~ ${to}
          ·
          ${
            targets
              .map(
                s =>
                  esc(
                    s.schoolName
                  )
              )
              .join(', ')
          }
        </p>

      </div>

      <div
        class="row"
        style="gap:6px"
      >

        <button
          class="btn ghost small"
          id="scrapResult"
        >
          📌 결과 스크랩
        </button>

        <button
          class="btn ghost small"
          id="copyResult"
        >
          결과 복사
        </button>

      </div>

    </div>

    <div class="summary">

      <div class="stat">
        <span>
          분석 학교
        </span>
        <b>
          ${targets.length}개교
        </b>
      </div>

      <div class="stat">
        <span>
          전체 급식일
        </span>
        <b>
          ${state.loaded.length}일
        </b>
      </div>

      <div class="stat">
        <span>
          기준 메뉴 편성
        </span>
        <b>
          ${a.meals.length}회
        </b>
      </div>

    </div>

    <div class="analysis">

      ${
        rankCard(
          '함께 편성한 주찬',
          a.main
        )
      }

      ${
        rankCard(
          '함께 편성한 부찬',
          a.side
        )
      }

    </div>

    <div class="section-title">

      <div>

        <h2>
          실제 식단 카드
        </h2>

        <p>
          나이스 API에서 검색된 학교별 실제 편성 식단입니다.
          내 학교가 맨 왼쪽,
          각 학교는 최신 날짜순입니다.
        </p>

      </div>

    </div>

    ${
      renderMealsBySchool(
        a.meals,
        targets,
        keyword
      )
    }
  `;

  $('#copyResult').onclick =
    () =>
      copySummary(
        a,
        keyword
      );

  $('#scrapResult').onclick =
    () =>
      scrapAnalysis(
        a,
        keyword
      );

  bindMealCards();
}

function renderMealsBySchool(
  meals,
  targets,
  keyword
) {
  if (
    !meals.length
  ) {
    return `
      <div class="empty">
        검색 메뉴가 포함된 실제 식단이 없습니다.
      </div>
    `;
  }

  if (
    targets.length < 2
  ) {
    return `
      <div class="meals">
        ${
          meals
            .map(
              m =>
                mealCard(
                  m,
                  keyword
                )
            )
            .join('')
        }
      </div>
    `;
  }

  const bySchool =
    new Map();

  targets.forEach(
    t =>
      bySchool.set(
        schoolKey(t),
        []
      )
  );

  meals.forEach(
    m => {
      const k =
        schoolKey(
          m.school
        );

      if (
        !bySchool.has(k)
      ) {
        bySchool.set(
          k,
          []
        );
      }

      bySchool
        .get(k)
        .push(m);
    }
  );

  return `
    <div
      class="school-cols"
      style="--cols:${targets.length}"
    >
      ${
        targets
          .map(
            t => {
              const items =
                (
                  bySchool.get(
                    schoolKey(t)
                  ) ||
                  []
                )
                  .sort(
                    (a, b) =>
                      b.date.localeCompare(
                        a.date
                      )
                  );

              const isMine =
                state.mine &&
                t.schoolCode ===
                  state.mine.schoolCode;

              return `
                <div class="school-col">

                  <h3 class="school-col-title">

                    ${esc(t.schoolName)}

                    ${
                      isMine
                        ? '<span class="mine-tag">내 학교</span>'
                        : ''
                    }

                    <small
                      class="help"
                      style="margin-left:6px"
                    >
                      ${items.length}일
                    </small>

                  </h3>

                  ${
                    items.length
                      ? items
                          .map(
                            m =>
                              mealCard(
                                m,
                                keyword
                              )
                          )
                          .join('')
                      : '<div class="empty">해당 기간 편성 없음</div>'
                  }

                </div>
              `;
            }
          )
          .join('')
      }
    </div>
  `;
}

function rankCard(
  title,
  items
) {
  return `
    <div class="card rank-card">

      <h3>
        ${title}
      </h3>

      ${
        items.length
          ? items
              .map(
                (x, i) => `
                  <div class="rank">

                    <span class="num">
                      ${i + 1}
                    </span>

                    <div>

                      <b>
                        ${esc(x.name)}
                      </b>

                      <small>
                        ${x.schools.size}개교
                        · 최근
                        ${
                          x.latest
                            ? formatDate(
                                x.latest
                              )
                            : '-'
                        }
                      </small>

                    </div>

                    <strong>
                      ${x.count}회
                    </strong>

                  </div>
                `
              )
              .join('')
          : '<div class="empty">분류된 메뉴가 없습니다.</div>'
      }

    </div>
  `;
}

function mealCard(
  m,
  keyword
) {
  const isMine =
    state.mine &&
    m.school.schoolCode ===
      state.mine.schoolCode;

  const dkey =
    `${m.date.slice(0,4)}-` +
    `${m.date.slice(4,6)}-` +
    `${m.date.slice(6,8)}`;

  const rating =
    state.ratings[dkey];

  return `
    <article class="card meal">

      <div class="date">
        ${koreanDate(m.date)}
      </div>

      <div class="school">
        ${esc(m.school.schoolName)}
      </div>

      ${
        m.dishes
          .map(
            d => `
              <div
                class="dish ${
                  keyword &&
                  menuMatches(
                    d.name,
                    keyword,
                    state.similar
                  )
                    ? 'hit'
                    : ''
                }"
              >
                ${esc(d.name)}

                ${
                  d.allergy.length
                    ? `
                      <span class="allergy">
                        (${d.allergy.join('·')})
                      </span>
                    `
                    : ''
                }

              </div>
            `
          )
          .join('')
      }

      <footer>
        ${esc(m.calories || '열량 정보 없음')}
      </footer>

      ${
        isMine
          ? `
            <div
              class="stars"
              data-stars="${dkey}"
            >

              ${
                [1,2,3,4,5]
                  .map(
                    n => `
                      <button
                        class="star ${
                          rating &&
                          rating.stars >= n
                            ? 'on'
                            : ''
                        }"
                        data-star="${n}"
                      >
                        ★
                      </button>
                    `
                  )
                  .join('')
              }

              <small
                class="help"
                style="margin-left:6px"
              >
                ${
                  rating
                    ? '내 별점'
                    : '내 별점 (나만 보여요)'
                }
              </small>

            </div>
          `
          : ''
      }

      <div
        class="row"
        style="
          margin-top:11px;
          gap:6px
        "
      >

        <button
          class="btn ghost small"
          data-scrap-meal='${
            esc(
              JSON.stringify({
                type:
                  'meal',

                title:
                  m.dishes
                    .map(
                      d => d.name
                    )
                    .slice(0, 3)
                    .join('·'),

                menus:
                  m.dishes
                    .map(
                      d => d.name
                    ),

                date:
                  dkey,

                school:
                  m.school.schoolName,

                calories:
                  m.calories ||
                  '',

                sourceType:
                  '식단 카드'
              })
            )
          }'
        >
          📌 스크랩
        </button>

        <button
          class="btn ghost small"
          data-copy-meal="${
            esc(
              m.dishes
                .map(
                  d => d.name
                )
                .join(' / ') +
              '\n※ ' +
              dkey +
              ' · ' +
              m.school.schoolName +
              (m.mealName ? ' · ' + m.mealName : '')
            )
          }"
        >
          복사
        </button>

      </div>

    </article>
  `;
}

function bindMealCards() {
  $$('[data-copy-meal]')
    .forEach(
      b => {
        b.onclick =
          () => {
            navigator.clipboard
              .writeText(
                b.dataset.copyMeal
              );

            alert(
              '복사했습니다.'
            );
          };
      }
    );

  $$('[data-scrap-meal]')
    .forEach(
      b => {
        b.onclick =
          () =>
            openScrapModal(
              JSON.parse(
                b.dataset.scrapMeal
              )
            );
      }
    );

  $$('[data-stars]')
    .forEach(
      box => {
        const dkey =
          box.dataset.stars;

        box
          .querySelectorAll(
            '.star'
          )
          .forEach(
            st => {
              st.onclick =
                () => {
                  if (
                    !requireLogin('별점')
                  ) {
                    return;
                  }

                  const n =
                    +st.dataset.star;

                  const cur =
                    state.ratings[dkey];

                  if (
                    cur &&
                    cur.stars === n
                  ) {
                    delete state.ratings[dkey];

                  } else {
                    state.ratings[dkey] = {
                      ...(cur || {}),
                      stars: n
                    };
                  }

                  persist();

                  box
                    .querySelectorAll(
                      '.star'
                    )
                    .forEach(
                      s2 => {
                        s2.classList.toggle(
                          'on',
                          state.ratings[dkey] &&
                          state.ratings[dkey].stars >=
                            +s2.dataset.star
                        );
                      }
                    );
                };
            }
          );
      }
    );
}

function copySummary(
  a,
  keyword
) {
  const text = [
    `[${keyword} 식단 조합 분석]`,

    `주찬: ${
      a.main
        .slice(0, 10)
        .map(
          x =>
            `${x.name} ${x.count}회`
        )
        .join(', ')
    }`,

    `부찬: ${
      a.side
        .slice(0, 10)
        .map(
          x =>
            `${x.name} ${x.count}회`
        )
        .join(', ')
    }`,

    `실제 식단 ${a.meals.length}건`
  ]
    .join('\n');

  navigator.clipboard
    .writeText(text);

  alert(
    '분석 결과를 복사했습니다.'
  );
}

function scrapAnalysis(
  a,
  keyword
) {
  const from =
    $('#from')?.value ||
    '';

  const to =
    $('#to')?.value ||
    '';

  openScrapModal({
    type:
      'idea',

    title:
      `'${keyword}' 조합 분석`,

    menus: [
      `주찬: ${
        a.main
          .slice(0,5)
          .map(
            x => x.name
          )
          .join(', ')
      }`,

      `부찬: ${
        a.side
          .slice(0,5)
          .map(
            x => x.name
          )
          .join(', ')
      }`
    ],

    date:
      dateISO(
        new Date()
      ),

    school:
      '분석 결과',

    sourceType:
      '조합 분석',

    sourcePeriod:
      from &&
      to
        ? `${from}~${to}`
        : ''
  });
}

/* ═════════════════════════════
   스크랩 모달
═════════════════════════════ */
function openScrapModal(item) {
  if (
    !requireLogin('스크랩 저장')
  ) {
    return;
  }

  const m =
    $('#modal');

  const type =
    item.type ||
    'meal';

  m.innerHTML = `
    <div class="modal">

      <div class="modal-card">

        <h2>
          📌 스크랩 저장
        </h2>

        <p class="help">
          ${esc(item.school || '')}
          ${
            item.date
              ? '· ' +
                esc(item.date)
              : ''
          }
        </p>

        <div
          class="field"
          style="margin:10px 0"
        >

          <label>
            유형
          </label>

          <div
            class="row"
            style="gap:6px"
          >

            <button
              class="btn ${
                type === 'meal'
                  ? ''
                  : 'ghost'
              } small"
              id="typeMeal"
            >
              🍱 전체 식단
            </button>

            <button
              class="btn ${
                type === 'idea'
                  ? ''
                  : 'ghost'
              } small"
              id="typeIdea"
            >
              💡 메뉴 아이디어
            </button>

          </div>

        </div>

        <div
          class="field"
          style="margin:10px 0"
        >

          <label>
            제목
          </label>

          <input
            id="scrapTitle"
            value="${esc(item.title || '')}"
          >

        </div>

        <div
          class="field"
          style="margin-bottom:10px"
        >

          <label>
            폴더
          </label>

          <div
            class="row"
            style="gap:6px"
          >

            <select
              id="scrapFolder"
              style="flex:1"
            >
              ${
                state.folders
                  .map(
                    f =>
                      `<option>${esc(f)}</option>`
                  )
                  .join('')
              }
            </select>

            <button
              class="btn ghost small"
              id="newFolder"
            >
              + 새 폴더
            </button>

          </div>

        </div>

        <div
          class="field"
          style="margin-bottom:10px"
        >

          <label>
            별점 (선택)
          </label>

          <div
            class="stars"
            id="scrapStars"
          >

            ${
              [1,2,3,4,5]
                .map(
                  n => `
                    <button
                      class="star"
                      data-star="${n}"
                    >
                      ★
                    </button>
                  `
                )
                .join('')
            }

          </div>

        </div>

        <div class="field">

          <label>
            메모 (선택)
          </label>

          <textarea
            id="scrapMemo"
            placeholder="예: 학생 반응 좋았음, 배식 편했음"
            style="
              width:100%;
              min-height:70px
            "
          ></textarea>

        </div>

        <div
          class="row"
          style="
            justify-content:flex-end;
            gap:8px;
            margin-top:14px
          "
        >

          <button
            class="btn ghost"
            id="scrapCancel"
          >
            취소
          </button>

          <button
            class="btn"
            id="scrapSave"
          >
            저장
          </button>

        </div>

      </div>

    </div>
  `;

  let curType =
    type;

  let curStars =
    0;

  const paint =
    () => {
      $('#typeMeal').className =
        `btn ${
          curType === 'meal'
            ? ''
            : 'ghost'
        } small`;

      $('#typeIdea').className =
        `btn ${
          curType === 'idea'
            ? ''
            : 'ghost'
        } small`;

      $$('#scrapStars .star')
        .forEach(
          b => {
            b.classList.toggle(
              'on',
              +b.dataset.star <=
                curStars
            );
          }
        );
    };

  $('#typeMeal').onclick =
    () => {
      curType =
        'meal';

      paint();
    };

  $('#typeIdea').onclick =
    () => {
      curType =
        'idea';

      paint();
    };

  $$('#scrapStars .star')
    .forEach(
      b => {
        b.onclick =
          () => {
            curStars =
              curStars ===
                +b.dataset.star
                ? 0
                : +b.dataset.star;

            paint();
          };
      }
    );

  $('#scrapCancel').onclick =
    () =>
      m.innerHTML = '';

  $('#newFolder').onclick =
    () => {
      const name =
        prompt(
          '새 폴더 이름'
        );

      if (
        name &&
        !state.folders.includes(
          name
        )
      ) {
        state.folders.push(
          name
        );

        persist();

        $('#scrapFolder').innerHTML =
          state.folders
            .map(
              f => `
                <option ${
                  f === name
                    ? 'selected'
                    : ''
                }>
                  ${esc(f)}
                </option>
              `
            )
            .join('');
      }
    };

  $('#scrapSave').onclick =
    () => {
      const menus =
        Array.isArray(
          item.menus
        )
          ? item.menus
          : [];

      const scrap = {
        schemaV: 2,

        id:
          Date.now()
            .toString(36) +
          Math.random()
            .toString(36)
            .slice(2, 6),

        type:
          curType,

        folder:
          $('#scrapFolder')
            .value,

        title:
          $('#scrapTitle')
            .value
            .trim() ||
          item.title ||
          '제목 없음',

        school:
          item.school ||
          '',

        servedDate:
          item.date ||
          '',

        menus,

        calories:
          item.calories ||
          '',

        stars:
          curStars,

        memo:
          $('#scrapMemo')
            .value
            .trim(),

        savedAt:
          dateISO(
            new Date()
          ),

        sourceType:
          item.sourceType ||
          '식단 카드',

        sourcePeriod:
          item.sourcePeriod ||
          '',

        snapshot:
          item.snapshot ||
          null
      };

      if (
        curType === 'meal'
      ) {
        Object.assign(
          scrap,
          splitMenus(menus)
        );
      }

      state.scraps.unshift(
        scrap
      );

      persist();

      m.innerHTML =
        '';

      alert(
        '📌 스크랩했습니다!'
      );

      if (
        state.tab === 'scrap'
      ) {
        renderScrapbook();
      }
    };
}

function bindIdeaScraps() {
  $$('[data-scrap-idea]')
    .forEach(
      b => {
        b.onclick =
          e => {
            e.stopPropagation();

            openScrapModal(
              JSON.parse(
                b.dataset.scrapIdea
              )
            );
          };
      }
    );
}

/* ═════════════════════════════
   스크랩북 탭
═════════════════════════════ */
const scrapView = {
  q: '',
  scope: 'all',
  folder: '전체',
  type: 'all',
  stars: 0,
  from: threeYearsAgo(),
  to: dateISO(new Date()),
  sort: 'savedAt',
  selected: new Set()
};

function scrapText(
  sc,
  scope
) {
  const j =
    a =>
      (a || [])
        .join(' ');

  switch (scope) {
    case 'rice':
      return j(sc.rice);

    case 'soup':
      return j(sc.soup);

    case 'kimchi':
      return j(sc.kimchi);

    case 'main':
      return j(sc.main);

    case 'side':
      return j(sc.side);

    case 'dessert':
      return j(sc.dessert);

    case 'school':
      return sc.school ||
      '';

    default:
      return [
        sc.title,
        j(sc.menus),
        sc.school,
        sc.memo,
        sc.sourcePeriod
      ]
        .join(' ');
  }
}

function filteredScraps() {
  const v =
    scrapView;

  const q =
    v.q.trim();

  let list =
    state.scraps
      .filter(
        sc => {
          if (
            v.folder !== '전체' &&
            sc.folder !== v.folder
          ) {
            return false;
          }

          if (
            v.type !== 'all' &&
            sc.type !== v.type
          ) {
            return false;
          }

          if (
            v.stars &&
            (sc.stars || 0) <
              v.stars
          ) {
            return false;
          }

          if (
            v.from &&
            (
              !sc.servedDate ||
              sc.servedDate <
                v.from
            )
          ) {
            return false;
          }

          if (
            v.to &&
            (
              !sc.servedDate ||
              sc.servedDate >
                v.to
            )
          ) {
            return false;
          }

          if (
            q &&
            !scrapText(
              sc,
              v.scope
            )
              .replace(
                /\s+/g,
                ''
              )
              .includes(
                q.replace(
                  /\s+/g,
                  ''
                )
              )
          ) {
            return false;
          }

          return true;
        }
      );

  const dir = {
    savedAt:
      (a, b) =>
        String(b.savedAt)
          .localeCompare(
            String(a.savedAt)
          ),

    servedDate:
      (a, b) =>
        String(b.servedDate)
          .localeCompare(
            String(a.servedDate)
          ),

    stars:
      (a, b) =>
        (b.stars || 0) -
        (a.stars || 0),

    title:
      (a, b) =>
        String(a.title)
          .localeCompare(
            String(b.title),
            'ko'
          )
  };

  return list.sort(
    dir[v.sort] ||
    dir.savedAt
  );
}

function renderScrapbook() {
  const c =
    $('#controls');

  scrapView.selected =
    new Set(
      [
        ...scrapView.selected
      ]
        .filter(
          id =>
            state.scraps
              .some(
                sc =>
                  sc.id === id
              )
        )
    );

  const list =
    filteredScraps();

  const counts =
    {};

  state.scraps
    .forEach(
      sc => {
        counts[sc.folder] =
          (
            counts[sc.folder] ||
            0
          ) +
          1;
      }
    );

  c.innerHTML = `
    <section class="panel">

      <div
        class="row"
        style="
          justify-content:space-between;
          flex-wrap:wrap;
          gap:8px
        "
      >

        <h2 style="margin:0">
          📌 내 스크랩북
        </h2>

        <div
          class="row"
          style="
            gap:6px;
            flex-wrap:wrap
          "
        >

          <span
            class="help"
            style="margin:0"
          >
            ${state.scraps.length}개 저장
            · ☁ 클라우드 동기화
          </span>

          <button
            class="btn ghost small"
            id="folderManage"
          >
            📁 폴더 관리
          </button>

          <button
            class="btn ghost small"
            id="jsonBackup"
          >
            JSON 백업
          </button>

          <button
            class="btn ghost small"
            id="jsonRestore"
          >
            JSON 복원
          </button>

        </div>

      </div>

      <div
        class="chips"
        style="margin:12px 0 4px"
      >

        <button
          class="chip folder-chip ${
            scrapView.folder ===
              '전체'
              ? 'chip-on'
              : ''
          }"
          data-fchip="전체"
        >
          전체
          ${state.scraps.length}
        </button>

        ${
          state.folders
            .map(
              f => `
                <button
                  class="chip folder-chip ${
                    scrapView.folder ===
                      f
                      ? 'chip-on'
                      : ''
                  }"
                  data-fchip="${esc(f)}"
                >
                  ${esc(f)}
                  ${counts[f] || 0}
                </button>
              `
            )
            .join('')
        }

      </div>

      <div class="grid scrap-filter">

        <div class="field">

          <label>
            검색
          </label>

          <div
            class="row"
            style="gap:6px"
          >

            <select
              id="svScope"
              style="width:96px"
            >

              ${
                [
                  ['all','전체'],
                  ['rice','밥'],
                  ['soup','국·찌개'],
                  ['main','주찬'],
                  ['side','부찬'],
                  ['kimchi','김치'],
                  ['dessert','후식'],
                  ['school','학교명']
                ]
                  .map(
                    ([v,l]) => `
                      <option
                        value="${v}"
                        ${
                          scrapView.scope === v
                            ? 'selected'
                            : ''
                        }
                      >
                        ${l}
                      </option>
                    `
                  )
                  .join('')
              }

            </select>

            <input
              id="svQ"
              placeholder="메뉴·제목·메모 검색"
              value="${esc(scrapView.q)}"
              style="
                flex:1;
                min-width:0
              "
            >

          </div>

        </div>

        <div class="field">

          <label>
            유형 / 별점
          </label>

          <div
            class="row"
            style="gap:6px"
          >

            <select
              id="svType"
              style="flex:1"
            >

              <option
                value="all"
                ${
                  scrapView.type === 'all'
                    ? 'selected'
                    : ''
                }
              >
                모든 유형
              </option>

              <option
                value="meal"
                ${
                  scrapView.type === 'meal'
                    ? 'selected'
                    : ''
                }
              >
                🍱 전체 식단
              </option>

              <option
                value="idea"
                ${
                  scrapView.type === 'idea'
                    ? 'selected'
                    : ''
                }
              >
                💡 메뉴 아이디어
              </option>

              <option
                value="report"
                ${
                  scrapView.type === 'report'
                    ? 'selected'
                    : ''
                }
              >
                📊 리포트
              </option>

            </select>

            <select
              id="svStars"
              style="flex:1"
            >

              ${
                [0,1,2,3,4,5]
                  .map(
                    n => `
                      <option
                        value="${n}"
                        ${
                          scrapView.stars === n
                            ? 'selected'
                            : ''
                        }
                      >
                        ${
                          n
                            ? '★'.repeat(n) +
                              ' 이상'
                            : '별점 전체'
                        }
                      </option>
                    `
                  )
                  .join('')
              }

            </select>

          </div>

        </div>

        <div class="field">

          <label>
            제공일 범위
          </label>

          <div
            class="row"
            style="gap:6px"
          >

            <input
              id="svFrom"
              type="date"
              value="${scrapView.from}"
              style="
                flex:1;
                min-width:0
              "
            >

            <input
              id="svTo"
              type="date"
              value="${scrapView.to}"
              style="
                flex:1;
                min-width:0
              "
            >

          </div>

        </div>

        <div class="field">

          <label>
            빠른 기간
          </label>

          ${
            quickRangeButtons(
              'svFrom',
              'svTo'
            )
          }

        </div>

        <div class="field">

          <label>
            정렬
          </label>

          <select id="svSort">

            ${
              [
                ['savedAt','저장일순'],
                ['servedDate','제공일순'],
                ['stars','별점순'],
                ['title','제목순']
              ]
                .map(
                  ([v,l]) => `
                    <option
                      value="${v}"
                      ${
                        scrapView.sort === v
                          ? 'selected'
                          : ''
                      }
                    >
                      ${l}
                    </option>
                  `
                )
                .join('')
            }

          </select>

        </div>

      </div>

      <div
        class="row"
        style="
          justify-content:space-between;
          flex-wrap:wrap;
          gap:8px;
          margin-top:12px
        "
      >

        <label
          class="help"
          style="
            margin:0;
            display:flex;
            align-items:center;
            gap:6px
          "
        >

          <input
            type="checkbox"
            id="svAll"
            ${
              list.length &&
              list.every(
                sc =>
                  scrapView.selected
                    .has(sc.id)
              )
                ? 'checked'
                : ''
            }
          >

          현재 목록 전체 선택
          (${list.length}개)

        </label>

        <div
          class="row"
          style="
            gap:6px;
            flex-wrap:wrap
          "
        >

          ${
            scrapView.selected.size
              ? `
                <span
                  class="help"
                  style="
                    margin:0;
                    font-weight:900;
                    color:#4047bd
                  "
                >
                  ${scrapView.selected.size}개 선택
                </span>

                <button
                  class="btn ghost small"
                  id="selMove"
                >
                  폴더 이동
                </button>

                <button
                  class="btn danger small"
                  id="selDel"
                >
                  삭제
                </button>
              `
              : ''
          }

          <button
            class="btn ghost small"
            id="csvExport"
          >
            CSV 내보내기
            (${
              scrapView.selected.size
                ? '선택'
                : '현재 목록'
            })
          </button>

          <button
            class="btn ghost small"
            id="printScraps"
          >
            🖨 인쇄·PDF
            (${
              scrapView.selected.size
                ? '선택'
                : '현재 목록'
            })
          </button>

        </div>

      </div>

      ${
        list.length
          ? renderScrapList(
              list
            )
          : `
            <div
              class="empty"
              style="margin-top:14px"
            >
              ${
                state.scraps.length
                  ? '조건에 맞는 스크랩이 없어요. 필터를 조정해보세요.'
                  : '아직 스크랩이 없어요. 식단 카드의 📌 스크랩 버튼을 눌러보세요!'
              }
            </div>
          `
      }

    </section>
  `;

  bindScrapbook(
    list
  );
}

function renderScrapList(list) {
  if (
    scrapView.folder !==
    '전체'
  ) {
    return `
      <div
        class="meals"
        style="margin-top:14px"
      >
        ${
          list
            .map(
              scrapCard
            )
            .join('')
        }
      </div>
    `;
  }

  const known =
    new Set(
      state.folders
    );

  const groups =
    state.folders
      .map(
        f => [
          f,
          list.filter(
            sc =>
              sc.folder === f
          )
        ]
      )
      .filter(
        ([,a]) =>
          a.length
      );

  const orphan =
    list.filter(
      sc =>
        !known.has(
          sc.folder
        )
    );

  if (
    orphan.length
  ) {
    groups.push([
      '기타',
      orphan
    ]);
  }

  return groups
    .map(
      ([f,arr]) => `
        <h3 class="scrap-folder-head">
          📁 ${esc(f)}
          <small class="help">
            ${arr.length}개
          </small>
        </h3>

        <div class="meals">
          ${
            arr
              .map(
                scrapCard
              )
              .join('')
          }
        </div>
      `
    )
    .join('');
}

function scrapTypeLabel(type) {
  return type === 'report'
    ? '📊 리포트'
    : type === 'meal'
      ? '🍱 전체 식단'
      : '💡 아이디어';
}

function scrapCard(sc) {
  const sel =
    scrapView.selected
      .has(
        sc.id
      );

  const catRow =
    (label, arr) =>
      arr &&
      arr.length
        ? `
          <div class="scrap-cat">

            <span>
              ${label}
            </span>

            <b>
              ${esc(arr.join(', '))}
            </b>

          </div>
        `
        : '';

  const badgeClass =
    sc.type === 'meal'
      ? 'tb-meal'
      : 'tb-idea';

  return `
    <article
      class="card meal scrap-item ${
        sel
          ? 'scrap-sel'
          : ''
      }"
    >

      <div
        class="row"
        style="
          justify-content:space-between;
          align-items:flex-start
        "
      >

        <label
          style="
            display:flex;
            gap:8px;
            align-items:center;
            cursor:pointer
          "
        >

          <input
            type="checkbox"
            data-sel="${sc.id}"
            ${
              sel
                ? 'checked'
                : ''
            }
          >

          <span
            class="type-badge ${badgeClass}"
          >
            ${
              scrapTypeLabel(
                sc.type
              )
            }
          </span>

        </label>

        <span
          class="help"
          style="margin:0"
        >
          📁 ${esc(sc.folder)}
        </span>

      </div>

      <b
        style="
          display:block;
          margin:7px 0 2px;
          font-size:15px
        "
      >
        ${esc(sc.title)}
      </b>

      <div class="school">

        ${esc(sc.school || '')}

        ${
          sc.servedDate
            ? '· ' +
              esc(sc.servedDate)
            : ''
        }

        ${
          sc.calories
            ? '· ' +
              esc(sc.calories)
            : ''
        }

      </div>

      ${
        sc.type === 'meal'
          ? `
            ${catRow('밥', sc.rice)}
            ${catRow('국·찌개', sc.soup)}
            ${catRow('주찬', sc.main)}
            ${catRow('부찬', sc.side)}
            ${catRow('김치', sc.kimchi)}
            ${catRow('후식', sc.dessert)}
          `
          : `
            ${
              (sc.menus || [])
                .map(
                  mn => `
                    <div class="dish">
                      ${esc(mn)}
                    </div>
                  `
                )
                .join('')
            }

            ${
              sc.snapshot &&
              sc.type !== 'report'
                ? `
                  <div
                    class="help"
                    style="margin-top:6px"
                  >

                    ${
                      sc.snapshot.count
                        ? esc(
                            String(
                              sc.snapshot.count
                            )
                          ) +
                          '회'
                        : ''
                    }

                    ${
                      sc.snapshot.schools
                        ? '· ' +
                          esc(
                            sc.snapshot.schools
                              .slice(0,3)
                              .join(', ')
                          ) +
                          (
                            sc.snapshot.schools.length > 3
                              ? ' 외 ' +
                                (
                                  sc.snapshot.schools.length -
                                  3
                                ) +
                                '개교'
                              : ''
                          )
                        : ''
                    }

                  </div>
                `
                : ''
            }
          `
      }

      ${
        sc.type === 'report'
          ? ''
          : `
            <div
              class="stars"
              data-scrap-stars="${sc.id}"
            >

              ${
                [1,2,3,4,5]
                  .map(
                    n => `
                      <button
                        class="star ${
                          (sc.stars || 0) >= n
                            ? 'on'
                            : ''
                        }"
                        data-star="${n}"
                      >
                        ★
                      </button>
                    `
                  )
                  .join('')
              }

            </div>
          `
      }

      ${
        sc.memo
          ? `
            <div class="memo">
              📝 ${esc(sc.memo)}
            </div>
          `
          : ''
      }

      <div
        class="help"
        style="margin-top:6px"
      >
        저장 ${esc(sc.savedAt)}
        · ${esc(sc.sourceType || '')}

        ${
          sc.sourcePeriod
            ? ' · ' +
              esc(sc.sourcePeriod)
            : ''
        }
      </div>

      <div
        class="row"
        style="
          margin-top:10px;
          gap:6px;
          flex-wrap:wrap
        "
      >

        <button
          class="btn ghost small"
          data-copy-scrap="${sc.id}"
        >
          복사
        </button>

        <button
          class="btn ghost small"
          data-edit-memo="${sc.id}"
        >
          메모
        </button>

        <button
          class="btn ghost small"
          data-move-scrap="${sc.id}"
        >
          폴더 이동
        </button>

        <button
          class="btn ghost small"
          data-del-scrap="${sc.id}"
        >
          삭제
        </button>

      </div>

    </article>
  `;
}

function bindScrapbook(list) {
  $$('[data-fchip]')
    .forEach(
      b => {
        b.onclick =
          () => {
            scrapView.folder =
              b.dataset.fchip;

            renderScrapbook();
          };
      }
    );

  const upd =
    () =>
      renderScrapbook();

  $('#svQ').oninput =
    e => {
      scrapView.q =
        e.target.value;

      clearTimeout(
        window._svT
      );

      window._svT =
        setTimeout(
          upd,
          350
        );
    };

  $('#svScope').onchange =
    e => {
      scrapView.scope =
        e.target.value;

      upd();
    };

  $('#svType').onchange =
    e => {
      scrapView.type =
        e.target.value;

      upd();
    };

  $('#svStars').onchange =
    e => {
      scrapView.stars =
        +e.target.value;

      upd();
    };

  $('#svFrom').onchange =
    e => {
      const err =
        validateRange(
          e.target.value,
          $('#svTo').value
        );

      if (
        err
      ) {
        alert(err);

        e.target.value =
          scrapView.from;

        return;
      }

      scrapView.from =
        e.target.value;

      upd();
    };

  $('#svTo').onchange =
    e => {
      const err =
        validateRange(
          $('#svFrom').value,
          e.target.value
        );

      if (
        err
      ) {
        alert(err);

        e.target.value =
          scrapView.to;

        return;
      }

      scrapView.to =
        e.target.value;

      upd();
    };

  $('#svSort').onchange =
    e => {
      scrapView.sort =
        e.target.value;

      upd();
    };

  $('#svAll').onchange =
    e => {
      if (
        e.target.checked
      ) {
        list.forEach(
          sc =>
            scrapView.selected
              .add(
                sc.id
              )
        );

      } else {
        list.forEach(
          sc =>
            scrapView.selected
              .delete(
                sc.id
              )
        );
      }

      upd();
    };

  $$('[data-sel]')
    .forEach(
      cb => {
        cb.onchange =
          () => {
            cb.checked
              ? scrapView.selected
                  .add(
                    cb.dataset.sel
                  )
              : scrapView.selected
                  .delete(
                    cb.dataset.sel
                  );

            renderScrapbook();
          };
      }
    );

  $$('[data-scrap-stars]')
    .forEach(
      box => {
        const id =
          box.dataset.scrapStars;

        box
          .querySelectorAll(
            '.star'
          )
          .forEach(
            st => {
              st.onclick =
                () => {
                  const sc =
                    state.scraps
                      .find(
                        x =>
                          x.id === id
                      );

                  if (
                    !sc
                  ) {
                    return;
                  }

                  const n =
                    +st.dataset.star;

                  sc.stars =
                    sc.stars === n
                      ? 0
                      : n;

                  persist();

                  renderScrapbook();
                };
            }
          );
      }
    );

  $$('[data-copy-scrap]')
    .forEach(
      b => {
        b.onclick =
          () => {
            const sc =
              state.scraps.find(
                x => x.id === b.dataset.copyScrap
              );
            if (!sc) return;

            /* 밥·국·주찬·부찬·김치·후식 순으로 복사 */
            const ordered =
              ['rice','soup','main','side','kimchi','dessert']
                .flatMap(k => sc[k] || []);

            const menus =
              ordered.length
                ? ordered
                : (sc.menus || []);

            if (!menus.length) {
              alert('복사할 메뉴가 없어요.');
              return;
            }

            const src = [
              sc.servedDate || sc.date || '',
              sc.school || ''
            ].filter(Boolean).join(' · ');

            navigator.clipboard.writeText(
              menus.join(' / ') +
              (src ? '\n※ ' + src : '')
            );

            alert('복사했습니다.');
          };
      }
    );

  $$('[data-del-scrap]')
    .forEach(
      b => {
        b.onclick =
          () => {
            if (
              !confirm(
                '이 스크랩을 삭제할까요?'
              )
            ) {
              return;
            }

            state.scraps =
              state.scraps
                .filter(
                  sc =>
                    sc.id !==
                    b.dataset.delScrap
                );

            persist();

            renderScrapbook();
          };
      }
    );

  $$('[data-edit-memo]')
    .forEach(
      b => {
        b.onclick =
          () => {
            const sc =
              state.scraps
                .find(
                  x =>
                    x.id ===
                    b.dataset.editMemo
                );

            const memo =
              prompt(
                '메모 수정',
                sc?.memo ||
                ''
              );

            if (
              memo !== null &&
              sc
            ) {
              sc.memo =
                memo.trim();

              persist();

              renderScrapbook();
            }
          };
      }
    );

  $$('[data-move-scrap]')
    .forEach(
      b => {
        b.onclick =
          () =>
            moveScraps([
              b.dataset.moveScrap
            ]);
      }
    );

  const selBtn =
    $('#selMove');

  if (
    selBtn
  ) {
    selBtn.onclick =
      () =>
        moveScraps(
          [
            ...scrapView.selected
          ]
        );
  }

  const selDel =
    $('#selDel');

  if (
    selDel
  ) {
    selDel.onclick =
      () => {
        if (
          !confirm(
            `선택한 ${scrapView.selected.size}개 스크랩을 삭제할까요?`
          )
        ) {
          return;
        }

        state.scraps =
          state.scraps
            .filter(
              sc =>
                !scrapView.selected
                  .has(sc.id)
            );

        scrapView.selected.clear();

        persist();

        renderScrapbook();
      };
  }

  $('#folderManage').onclick =
    openFolderModal;

  $('#csvExport').onclick =
    () =>
      exportCSV(
        scrapView.selected.size
          ? state.scraps
              .filter(
                sc =>
                  scrapView.selected
                    .has(sc.id)
              )
          : list
      );

  $('#printScraps').onclick =
    () =>
      printScraps(
        scrapView.selected.size
          ? state.scraps
              .filter(
                sc =>
                  scrapView.selected
                    .has(sc.id)
              )
          : list
      );

  $('#jsonBackup').onclick =
    backupJSON;

  $('#jsonRestore').onclick =
    openRestoreModal;

  bindQuickRanges(
    (from, to) => {
      scrapView.from =
        from;

      scrapView.to =
        to;

      renderScrapbook();
    }
  );
}

function moveScraps(ids) {
  const m =
    $('#modal');

  const counts =
    {};

  state.scraps
    .forEach(
      sc => {
        counts[sc.folder] =
          (
            counts[sc.folder] ||
            0
          ) +
          1;
      }
    );

  m.innerHTML = `
    <div class="modal">

      <div class="modal-card">

        <h2>
          📁 폴더 이동
        </h2>

        <p class="help">
          스크랩 ${ids.length}개를 옮길 폴더를 선택하세요.
        </p>

        <div
          class="school-results"
          style="max-height:320px"
        >

          ${
            state.folders
              .map(
                f => `
                  <button
                    class="school-item"
                    data-move-to="${esc(f)}"
                  >

                    <b>
                      📁 ${esc(f)}
                    </b>

                    <small>
                      ${counts[f] || 0}개 저장됨
                    </small>

                  </button>
                `
              )
              .join('')
          }

        </div>

        <div
          class="row"
          style="
            justify-content:flex-end;
            margin-top:14px
          "
        >

          <button
            class="btn ghost"
            id="closeModal"
          >
            취소
          </button>

        </div>

      </div>

    </div>
  `;

  $('#closeModal').onclick =
    () =>
      m.innerHTML = '';

  $$('[data-move-to]')
    .forEach(
      b => {
        b.onclick =
          () => {
            const f =
              b.dataset.moveTo;

            state.scraps
              .forEach(
                sc => {
                  if (
                    ids.includes(
                      sc.id
                    )
                  ) {
                    sc.folder =
                      f;
                  }
                }
              );

            scrapView.selected.clear();

            persist();

            m.innerHTML =
              '';

            renderScrapbook();
          };
      }
    );
}

/* ═════════════════════════════
   폴더 관리
═════════════════════════════ */
function openFolderModal() {
  const m =
    $('#modal');

  const counts =
    {};

  state.scraps
    .forEach(
      sc => {
        counts[sc.folder] =
          (
            counts[sc.folder] ||
            0
          ) +
          1;
      }
    );

  m.innerHTML = `
    <div class="modal">

      <div class="modal-card">

        <h2>
          📁 폴더 관리
        </h2>

        <p class="help">
          순서 변경(↑↓),
          이름 변경(✏),
          삭제(🗑)가 가능해요.
          <b>${esc(state.baseFolder)}</b>는
          삭제된 폴더의 스크랩을 받는 기본 폴더라
          삭제할 수 없어요
          (이름 변경은 가능).
        </p>

        <div
          id="folderList"
          class="school-results"
          style="max-height:320px"
        >

          ${
            state.folders
              .map(
                (f, i) => `
                  <div class="folder-row">

                    <b style="flex:1">

                      ${esc(f)}

                      <small class="help">
                        ${counts[f] || 0}개
                      </small>

                      ${
                        f === state.baseFolder
                          ? '<span class="mine-tag">기본</span>'
                          : ''
                      }

                    </b>

                    <button
                      class="btn ghost small"
                      data-fup="${i}"
                      ${
                        i === 0
                          ? 'disabled'
                          : ''
                      }
                    >
                      ↑
                    </button>

                    <button
                      class="btn ghost small"
                      data-fdown="${i}"
                      ${
                        i ===
                        state.folders.length -
                        1
                          ? 'disabled'
                          : ''
                      }
                    >
                      ↓
                    </button>

                    <button
                      class="btn ghost small"
                      data-fren="${i}"
                    >
                      ✏
                    </button>

                    <button
                      class="btn ghost small"
                      data-fdel="${i}"
                      ${
                        f === state.baseFolder
                          ? 'disabled'
                          : ''
                      }
                    >
                      🗑
                    </button>

                  </div>
                `
              )
              .join('')
          }

        </div>

        <div class="searchrow">

          <input
            id="newFolderName"
            placeholder="새 폴더 이름"
          >

          <button
            class="btn"
            id="addFolder"
          >
            추가
          </button>

        </div>

        <div
          class="row"
          style="
            justify-content:flex-end;
            margin-top:14px
          "
        >

          <button
            class="btn ghost"
            id="closeModal"
          >
            닫기
          </button>

        </div>

      </div>

    </div>
  `;

  $('#closeModal').onclick =
    () => {
      m.innerHTML =
        '';

      renderScrapbook();
    };

  $('#addFolder').onclick =
    () => {
      const name =
        $('#newFolderName')
          .value
          .trim();

      if (
        !name
      ) {
        return;
      }

      if (
        state.folders.includes(
          name
        )
      ) {
        alert(
          '이미 있는 폴더예요.'
        );

        return;
      }

      state.folders.push(
        name
      );

      persist();

      openFolderModal();
    };

  $$('[data-fup]')
    .forEach(
      b => {
        b.onclick =
          () => {
            const i =
              +b.dataset.fup;

            [
              state.folders[i - 1],
              state.folders[i]
            ] = [
              state.folders[i],
              state.folders[i - 1]
            ];

            persist();

            openFolderModal();
          };
      }
    );

  $$('[data-fdown]')
    .forEach(
      b => {
        b.onclick =
          () => {
            const i =
              +b.dataset.fdown;

            [
              state.folders[i + 1],
              state.folders[i]
            ] = [
              state.folders[i],
              state.folders[i + 1]
            ];

            persist();

            openFolderModal();
          };
      }
    );

  $$('[data-fren]')
    .forEach(
      b => {
        b.onclick =
          () => {
            const i =
              +b.dataset.fren;

            const old =
              state.folders[i];

            const name =
              prompt(
                '새 이름',
                old
              );

            if (
              !name ||
              name.trim() === old
            ) {
              return;
            }

            const nn =
              name.trim();

            if (
              state.folders.includes(
                nn
              )
            ) {
              alert(
                '이미 있는 폴더예요.'
              );

              return;
            }

            state.folders[i] =
              nn;

            state.scraps
              .forEach(
                sc => {
                  if (
                    sc.folder === old
                  ) {
                    sc.folder =
                      nn;
                  }
                }
              );

            if (
              state.baseFolder ===
              old
            ) {
              state.baseFolder =
                nn;
            }

            persist();

            openFolderModal();
          };
      }
    );

  $$('[data-fdel]')
    .forEach(
      b => {
        b.onclick =
          () => {
            const i =
              +b.dataset.fdel;

            const f =
              state.folders[i];

            if (
              f ===
              state.baseFolder
            ) {
              return;
            }

            const inside =
              state.scraps
                .filter(
                  sc =>
                    sc.folder === f
                );

            if (
              inside.length
            ) {
              if (
                confirm(
                  `'${f}' 폴더에 스크랩 ${inside.length}개가 있어요.\n\n` +
                  `[확인] = 스크랩을 '${state.baseFolder}'(으)로 옮기고 폴더만 삭제\n` +
                  `[취소] = 다음 단계에서 함께 삭제 여부 선택`
                )
              ) {
                inside.forEach(
                  sc =>
                    sc.folder =
                      state.baseFolder
                );

              } else if (
                confirm(
                  `정말 스크랩 ${inside.length}개를 폴더와 함께 삭제할까요? 되돌릴 수 없어요.`
                )
              ) {
                state.scraps =
                  state.scraps
                    .filter(
                      sc =>
                        sc.folder !== f
                    );

              } else {
                return;
              }

            } else if (
              !confirm(
                `'${f}' 폴더를 삭제할까요?`
              )
            ) {
              return;
            }

            state.folders.splice(
              i,
              1
            );

            if (
              scrapView.folder === f
            ) {
              scrapView.folder =
                '전체';
            }

            persist();

            openFolderModal();
          };
      }
    );
}

/* ═════════════════════════════
   CSV / 인쇄 / JSON
═════════════════════════════ */
function csvCell(v) {
  v =
    String(
      v ??
      ''
    );

  return /[",\n]/.test(v)
    ? '"' +
      v.replace(
        /"/g,
        '""'
      ) +
      '"'
    : v;
}

function exportCSV(items) {
  if (
    !items.length
  ) {
    alert(
      '내보낼 스크랩이 없어요.'
    );

    return;
  }

  const head = [
    '폴더',
    '유형',
    '식단 제목',
    '학교명',
    '제공일',
    '밥',
    '국·찌개',
    '주찬',
    '부찬',
    '김치',
    '후식',
    '전체 내용',
    '열량',
    '별점',
    '메모',
    '저장일',
    '원본 유형',
    '분석 기간'
  ];

  const j =
    a =>
      (a || [])
        .join(' / ');

  const rows =
    items
      .map(
        sc => [
          sc.folder,

          sc.type === 'report'
            ? '리포트'
            : sc.type === 'meal'
              ? '전체 식단'
              : '메뉴 아이디어',

          sc.title,
          sc.school,
          sc.servedDate,

          j(sc.rice),
          j(sc.soup),
          j(sc.main),
          j(sc.side),
          j(sc.kimchi),
          j(sc.dessert),

          j(sc.menus),

          sc.calories,

          sc.stars ||
          '',

          sc.memo,
          sc.savedAt,
          sc.sourceType,
          sc.sourcePeriod
        ]
          .map(
            csvCell
          )
          .join(',')
      );

  const csv =
    '\uFEFF' +
    head
      .map(
        csvCell
      )
      .join(',') +
    '\n' +
    rows.join('\n');

  const a =
    document.createElement(
      'a'
    );

  a.href =
    URL.createObjectURL(
      new Blob(
        [csv],
        {
          type:
            'text/csv;charset=utf-8'
        }
      )
    );

  a.download =
    `나의식단스크랩_${dateISO(new Date())}.csv`;

  a.click();

  URL.revokeObjectURL(
    a.href
  );
}

function printScraps(items) {
  if (
    !items.length
  ) {
    alert(
      '인쇄할 스크랩이 없어요.'
    );

    return;
  }

  let area =
    $('#printArea');

  if (
    !area
  ) {
    area =
      document.createElement(
        'div'
      );

    area.id =
      'printArea';

    document.body
      .appendChild(
        area
      );
  }

  const byFolder =
    {};

  const j =
    a =>
      (a || [])
        .join(', ');

  items
    .forEach(
      sc =>
        (
          byFolder[sc.folder] =
            byFolder[sc.folder] ||
            []
        )
          .push(sc)
    );

  area.innerHTML = `
    <h1>
      나의 식단 스크랩
    </h1>

    <p class="p-meta">
      출력일
      ${dateISO(new Date())}
      ·
      ${items.length}개
    </p>

    ${
      Object.entries(
        byFolder
      )
        .map(
          ([f,arr]) => `
            <h2>
              📁 ${esc(f)}
              (${arr.length})
            </h2>

            ${
              arr
                .map(
                  sc => `
                    <div class="p-card">

                      <div class="p-title">

                        ${esc(sc.title)}

                        <span class="p-type">
                          ${
                            sc.type === 'report'
                              ? '리포트'
                              : sc.type === 'meal'
                                ? '전체 식단'
                                : '메뉴 아이디어'
                          }
                        </span>

                        ${
                          sc.stars
                            ? `
                              <span class="p-stars">
                                ${'★'.repeat(sc.stars)}
                              </span>
                            `
                            : ''
                        }

                      </div>

                      <div class="p-sub">

                        ${esc(sc.school || '')}

                        ${
                          sc.servedDate
                            ? '· ' +
                              esc(sc.servedDate)
                            : ''
                        }

                        ${
                          sc.calories
                            ? '· ' +
                              esc(sc.calories)
                            : ''
                        }

                        · 저장
                        ${esc(sc.savedAt)}

                        ·
                        ${esc(sc.sourceType || '')}

                      </div>

                      ${
                        sc.type === 'meal'
                          ? [
                              'rice',
                              'soup',
                              'main',
                              'side',
                              'kimchi',
                              'dessert'
                            ]
                              .filter(
                                k =>
                                  sc[k] &&
                                  sc[k].length
                              )
                              .map(
                                k => `
                                  <div class="p-row">

                                    <span>
                                      ${CAT_LABEL[k]}
                                    </span>

                                    ${esc(j(sc[k]))}

                                  </div>
                                `
                              )
                              .join('')
                          : `
                            <div class="p-row">

                              <span>
                                ${
                                  sc.type === 'report'
                                    ? '리포트'
                                    : '메뉴'
                                }
                              </span>

                              ${esc(j(sc.menus))}

                            </div>
                          `
                      }

                      ${
                        sc.memo
                          ? `
                            <div class="p-memo">
                              📝 ${esc(sc.memo)}
                            </div>
                          `
                          : ''
                      }

                    </div>
                  `
                )
                .join('')
            }
          `
        )
        .join('')
    }
  `;

  window.print();
}

function backupJSON() {
  const data = {
    app:
      'meal-archive-scraps',

    version:
      2,

    exportedAt:
      new Date()
        .toISOString(),

    folders:
      state.folders,

    baseFolder:
      state.baseFolder,

    scraps:
      state.scraps
  };

  const a =
    document.createElement(
      'a'
    );

  a.href =
    URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            data,
            null,
            2
          )
        ],
        {
          type:
            'application/json'
        }
      )
    );

  a.download =
    `나의식단스크랩_백업_${dateISO(new Date())}.json`;

  a.click();

  URL.revokeObjectURL(
    a.href
  );
}

function openRestoreModal() {
  const m =
    $('#modal');

  m.innerHTML = `
    <div class="modal">

      <div class="modal-card">

        <h2>
          JSON 복원
        </h2>

        <p class="help">
          이 앱에서 백업한 JSON 파일만 복원할 수 있어요.
        </p>

        <input
          type="file"
          id="restoreFile"
          accept=".json,application/json"
          style="margin:12px 0"
        >

        <div
          class="row"
          style="
            gap:8px;
            margin-top:8px;
            flex-wrap:wrap
          "
        >

          <button
            class="btn"
            id="restoreMerge"
          >
            기존 자료와 합치기
          </button>

          <button
            class="btn danger"
            id="restoreReplace"
          >
            전체 교체
          </button>

          <button
            class="btn ghost"
            id="closeModal"
          >
            닫기
          </button>

        </div>

        <div
          class="help"
          style="margin-top:10px"
        >
          합치기: 같은 스크랩(id 기준)은 건너뛰어 중복을 막아요.
          <br>
          전체 교체: 현재 스크랩·폴더를 백업 파일 내용으로 완전히 바꿔요.
        </div>

      </div>

    </div>
  `;

  $('#closeModal').onclick =
    () =>
      m.innerHTML = '';

  const readFile =
    () =>
      new Promise(
        (res, rej) => {
          const f =
            $('#restoreFile')
              .files[0];

          if (
            !f
          ) {
            return rej(
              new Error(
                '파일을 먼저 선택해주세요.'
              )
            );
          }

          const r =
            new FileReader();

          r.onload =
            () => {
              try {
                res(
                  JSON.parse(
                    r.result
                  )
                );

              } catch {
                rej(
                  new Error(
                    'JSON 형식이 아니에요. 올바른 백업 파일인지 확인해주세요.'
                  )
                );
              }
            };

          r.onerror =
            () =>
              rej(
                new Error(
                  '파일을 읽지 못했어요.'
                )
              );

          r.readAsText(f);
        }
      );

  const validate =
    d => {
      if (
        !d ||
        d.app !==
          'meal-archive-scraps' ||
        !Array.isArray(
          d.scraps
        )
      ) {
        throw new Error(
          '이 앱의 백업 파일이 아니에요.'
        );
      }

      return d;
    };

  $('#restoreMerge').onclick =
    async () => {
      if (
        !requireLogin('JSON 복원')
      ) {
        return;
      }

      try {
        const d =
          validate(
            await readFile()
          );

        const existing =
          new Set(
            state.scraps
              .map(
                sc =>
                  sc.id
              )
          );

        let added =
          0;

        d.scraps
          .forEach(
            sc => {
              if (
                sc &&
                sc.id &&
                !existing.has(
                  sc.id
                )
              ) {
                state.scraps.push(
                  sc
                );

                added++;
              }
            }
          );

        (d.folders || [])
          .forEach(
            f => {
              if (
                !state.folders.includes(
                  f
                )
              ) {
                state.folders.push(
                  f
                );
              }
            }
          );

        migrateScraps();

        persist();

        m.innerHTML =
          '';

        alert(
          `복원 완료! ${added}개를 추가했어요. ` +
          `(중복 ${d.scraps.length - added}개 건너뜀)`
        );

        renderScrapbook();

      } catch (e) {
        alert(
          e.message
        );
      }
    };

  $('#restoreReplace').onclick =
    async () => {
      if (
        !requireLogin('JSON 복원')
      ) {
        return;
      }

      try {
        const d =
          validate(
            await readFile()
          );

        if (
          !confirm(
            `현재 스크랩 ${state.scraps.length}개를 모두 지우고 ` +
            `백업의 ${d.scraps.length}개로 교체할까요?`
          )
        ) {
          return;
        }

        state.scraps =
          d.scraps;

        state.folders =
          Array.isArray(
            d.folders
          ) &&
          d.folders.length
            ? d.folders
            : [...DEFAULT_FOLDERS];

        if (
          d.baseFolder
        ) {
          state.baseFolder =
            d.baseFolder;
        }

        migrateScraps();

        persist();

        m.innerHTML =
          '';

        alert(
          '전체 교체 완료!'
        );

        renderScrapbook();

      } catch (e) {
        alert(
          e.message
        );
      }
    };
}

/* ═════════════════════════════
   🔥 트렌드
═════════════════════════════ */
async function analyzeTrend() {
  const targets =
    [
      state.mine,
      ...state.comparisons
    ]
      .filter(Boolean);

  if (
    !targets.length
  ) {
    openSchoolModal(
      'mine'
    );

    return;
  }

  const from =
    $('#tFrom').value;

  const to =
    $('#tTo').value;

  const err =
    validateRange(
      from,
      to
    );

  if (
    err
  ) {
    setStatus(
      err,
      true
    );

    return;
  }

  setStatus(
    `<span class="loading"></span>${targets.length}개 학교의 ${from} ~ ${to} 식단을 분석하고 있습니다.`
  );

  try {
    const results =
      await Promise.all(
        targets.map(
          s =>
            fetchMeals(
              s,
              from,
              to
            )
        )
      );

    const rows =
      results.flat();

    const myMenus =
      new Set();

    rows
      .filter(
        r =>
          state.mine &&
          r.school.schoolCode ===
            state.mine.schoolCode
      )
      .forEach(
        r => {
          parseDishes(
            r.dishes
          )
            .forEach(
              d =>
                myMenus.add(
                  normalize(
                    d.name
                  )
                )
            );
        }
      );

    const cats = {
      rice: new Map(),
      soup: new Map(),
      kimchi: new Map(),
      main: new Map(),
      side: new Map(),
      dessert: new Map()
    };

    rows
      .forEach(
        r => {
          parseDishes(
            r.dishes
          )
            .forEach(
              d => {
                const cat =
                  classify(
                    d.name
                  );

                if (
                  cats[cat]
                ) {
                  addCount(
                    cats[cat],
                    d,
                    r.school,
                    r.date
                  );
                }
              }
            );
        }
      );

    setStatus(
      `${targets.length}개교 · ${from} ~ ${to} · 급식 ${rows.length}일 분석 완료`
    );

    $('#results').innerHTML = `
      <div class="section-title">

        <div>

          <h2>
            🔥 요즘 뜨는 메뉴
          </h2>

          <p>
            ${from} ~ ${to}
            ·
            ${
              targets
                .map(
                  s =>
                    esc(
                      s.schoolName
                    )
                )
                .join(', ')
            }
          </p>

        </div>

      </div>

      <div class="trend-grid">

        ${
          [
            'rice',
            'soup',
            'main',
            'side',
            'kimchi',
            'dessert'
          ]
            .map(
              cat => {
                const items =
                  [
                    ...cats[cat].values()
                  ]
                    .sort(
                      (a, b) =>
                        b.count -
                        a.count ||
                        b.schools.size -
                        a.schools.size
                    )
                    .slice(
                      0,
                      30
                    );

                return `
                  <div
                    class="card rank-card trend-col"
                  >

                    <h3>
                      ${CAT_LABEL[cat]}
                      TOP 30
                    </h3>

                    ${
                      items.length
                        ? items
                            .map(
                              (x, i) => {
                                const isNew =
                                  !myMenus.has(
                                    normalize(
                                      x.name
                                    )
                                  );

                                const idea =
                                  esc(
                                    JSON.stringify({
                                      type:
                                        'idea',

                                      title:
                                        x.name,

                                      menus:
                                        [x.name],

                                      date:
                                        dateISO(
                                          new Date()
                                        ),

                                      school:
                                        [
                                          ...x.schools
                                        ]
                                          .slice(
                                            0,
                                            3
                                          )
                                          .join(', '),

                                      sourceType:
                                        '요즘 뜨는 메뉴',

                                      sourcePeriod:
                                        `${from}~${to}`,

                                      snapshot: {
                                        count:
                                          x.count,

                                        schools:
                                          [
                                            ...x.schools
                                          ],

                                        from,
                                        to
                                      }
                                    })
                                  );

                                return `
                                  <div class="rank">

                                    <span class="num">
                                      ${i + 1}
                                    </span>

                                    <div>

                                      <b>
                                        ${esc(x.name)}

                                        ${
                                          isNew
                                            ? '<span class="new-badge">✨NEW</span>'
                                            : ''
                                        }
                                      </b>

                                      <small>
                                        ${x.schools.size}개교
                                        ·
                                        ${x.count}회
                                      </small>

                                    </div>

                                    <button
                                      class="memo-btn"
                                      data-scrap-idea='${idea}'
                                      title="메뉴 아이디어로 스크랩"
                                    >
                                      📌
                                    </button>

                                  </div>
                                `;
                              }
                            )
                            .join('')
                        : '<div class="empty">데이터 없음</div>'
                    }

                  </div>
                `;
              }
            )
            .join('')
        }

      </div>

      <p
        class="help"
        style="margin-top:10px"
      >
        ✨NEW =
        선택한 기간 동안
        내 학교 식단에는 없었던 메뉴예요.
      </p>
    `;

    bindIdeaScraps();

  } catch (e) {
    setStatus(
      e.message,
      true
    );
  }
}

/* ═════════════════════════════
   📊 리포트
═════════════════════════════ */
async function analyzeReport() {
  if (
    !state.mine
  ) {
    openSchoolModal(
      'mine'
    );

    return;
  }

  const from =
    $('#rFrom').value;

  const to =
    $('#rTo').value;

  const keyword =
    (
      $('#rKeyword')?.value ||
      ''
    )
      .trim();

  const err =
    validateRange(
      from,
      to
    );

  if (
    err
  ) {
    setStatus(
      err,
      true
    );

    return;
  }

  setStatus(
    '<span class="loading"></span>내 학교와 비교학교 식단을 불러오고 있습니다.'
  );

  const tasks = [
    fetchMeals(
      state.mine,
      from,
      to
    ),

    ...state.comparisons
      .map(
        s =>
          fetchMeals(
            s,
            from,
            to
          )
      )
  ];

  const settled =
    await Promise.allSettled(
      tasks
    );

  if (
    settled[0].status ===
    'rejected'
  ) {
    setStatus(
      settled[0].reason.message,
      true
    );

    return;
  }

  const rows =
    settled[0].value;

  const compRows =
    [];

  const failedSchools =
    [];

  settled
    .slice(1)
    .forEach(
      (r, i) => {
        if (
          r.status ===
          'fulfilled'
        ) {
          compRows.push(
            ...r.value
          );

        } else {
          failedSchools.push(
            state.comparisons[i]
              .schoolName
          );
        }
      }
    );

  if (
    !rows.length
  ) {
    setStatus(
      `${from} ~ ${to} 기간에 나이스에 등록된 내 학교 식단이 없어 분석할 수 없습니다.`,
      true
    );

    return;
  }

  _report = {
    rows,
    compRows,
    failedSchools,
    from,
    to,
    keyword,

    today:
      dateISO(
        new Date()
      )
  };

  renderReport();
}

function renderReport() {
  const {
    rows,
    compRows,
    failedSchools,
    from,
    to,
    keyword,
    today
  } = _report;

  const cats = {
    rice: new Map(),
    soup: new Map(),
    kimchi: new Map(),
    main: new Map(),
    side: new Map(),
    dessert: new Map()
  };

  const menuMap =
    new Map();

  rows.forEach(
    r => {
      parseDishes(
        r.dishes
      )
        .forEach(
          d => {
            const key =
              normalize(
                d.name
              );

            if (
              !key
            ) {
              return;
            }

            const v =
              menuMap.get(key) ||
              {
                name:
                  d.name,

                count:
                  0,

                latest:
                  '',

                cat:
                  classify(
                    d.name
                  )
              };

            v.count++;

            if (
              r.date >
              v.latest
            ) {
              v.latest =
                r.date;
            }

            menuMap.set(
              key,
              v
            );

            addCount(
              cats[v.cat],
              d,
              r.school,
              r.date
            );
          }
        );
    }
  );

  const all =
    [
      ...menuMap.values()
    ];

  const staleLine =
    (() => {
      const d =
        new Date(to);

      d.setMonth(
        d.getMonth() -
        3
      );

      return dateISO(d)
        .replace(
          /-/g,
          ''
        );
    })();

  const stale =
    all
      .filter(
        x =>
          x.latest <
            staleLine &&
          x.count >=
            2
      )
      .sort(
        (a, b) =>
          a.latest.localeCompare(
            b.latest
          )
      )
      .slice(
        0,
        15
      );

  const myPeriodSet =
    new Set();

  rows.forEach(
    r => {
      parseDishes(
        r.dishes
      )
        .forEach(
          d =>
            myPeriodSet.add(
              normalize(
                d.name
              )
            )
        );
    }
  );

  const allPeriod = [
    ...rows,
    ...compRows
  ];

  const catsPeriod = {
    rice: new Map(),
    soup: new Map(),
    kimchi: new Map(),
    main: new Map(),
    side: new Map(),
    dessert: new Map()
  };

  allPeriod.forEach(
    r => {
      parseDishes(
        r.dishes
      )
        .forEach(
          d => {
            const cat =
              classify(
                d.name
              );

            if (
              catsPeriod[cat]
            ) {
              addCount(
                catsPeriod[cat],
                d,
                r.school,
                r.date
              );
            }
          }
        );
    }
  );

  let refCount =
    0;

  Object.values(
    catsPeriod
  )
    .forEach(
      map => {
        [
          ...map.values()
        ]
          .forEach(
            x => {
              if (
                !myPeriodSet.has(
                  normalize(
                    x.name
                  )
                ) &&
                x.count >= 2
              ) {
                refCount++;
              }
            }
          );
      }
    );

  let kwHTML =
    '';

  if (
    keyword
  ) {
    const hitDays =
      rows
        .filter(
          r =>
            parseDishes(
              r.dishes
            )
              .some(
                d =>
                  menuMatches(
                    d.name,
                    keyword,
                    true
                  )
              )
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(
              a.date
            )
        );

    const combos =
      analyzeMeals(
        rows,
        keyword,
        true
      );

    const months =
      [];

    {
      const cur =
        new Date(
          +from.slice(0,4),
          +from.slice(5,7) - 1,
          1
        );

      const endM =
        to.slice(
          0,
          7
        );

      while (
        dateISO(cur)
          .slice(0,7) <=
        endM
      ) {
        months.push(
          dateISO(cur)
            .slice(0,7)
        );

        cur.setMonth(
          cur.getMonth() +
          1
        );
      }
    }

    const perMonth =
      Object.fromEntries(
        months.map(
          m => [
            m,
            0
          ]
        )
      );

    hitDays.forEach(
      r => {
        const m =
          `${r.date.slice(0,4)}-${r.date.slice(4,6)}`;

        if (
          m in perMonth
        ) {
          perMonth[m]++;
        }
      }
    );

    const maxM =
      Math.max(
        1,
        ...Object.values(
          perMonth
        )
      );

    kwHTML = `
      <div class="section-title">

        <div>

          <h2>
            🔍 '${esc(keyword)}'
            상세 분석
          </h2>

          <p>
            ${from} ~ ${to}
            · 총
            ${hitDays.length}회 편성
          </p>

        </div>

      </div>

      ${
        hitDays.length
          ? `
            <div
              class="card rank-card"
              style="margin-bottom:14px"
            >

              <h3>
                월별 편성 추이
              </h3>

              <div class="bar-chart">

                ${
                  months
                    .map(
                      m => `
                        <div class="bar-row">

                          <span class="bar-label">
                            ${m.slice(2)}
                          </span>

                          <div class="bar-track">

                            <div
                              class="bar-fill"
                              style="
                                width:${
                                  Math.round(
                                    perMonth[m] /
                                    maxM *
                                    100
                                  )
                                }%
                              "
                            ></div>

                          </div>

                          <span class="bar-val">
                            ${perMonth[m]}
                          </span>

                        </div>
                      `
                    )
                    .join('')
                }

              </div>

            </div>

            <div class="analysis">

              <div class="card rank-card">

                <h3>
                  편성한 날짜
                  (${hitDays.length}일)
                </h3>

                <div class="kw-days">

                  ${
                    hitDays
                      .map(
                        r => {
                          const dkey =
                            `${r.date.slice(0,4)}-` +
                            `${r.date.slice(4,6)}-` +
                            `${r.date.slice(6,8)}`;

                          const rt =
                            state.ratings[dkey];

                          return `
                            <div class="kw-day">

                              <b>
                                ${formatDate(r.date)}
                              </b>

                              ${
                                rt
                                  ? `
                                    <span class="kw-stars">
                                      ${'★'.repeat(rt.stars)}
                                    </span>
                                  `
                                  : ''
                              }

                            </div>
                          `;
                        }
                      )
                      .join('')
                  }

                </div>

              </div>

              <div class="card rank-card">

                <h3>
                  함께 낸 조합 TOP
                </h3>

                ${
                  [
                    ...combos.main
                      .slice(0,7)
                      .map(
                        x => ({
                          ...x,
                          t: '주찬'
                        })
                      ),

                    ...combos.side
                      .slice(0,7)
                      .map(
                        x => ({
                          ...x,
                          t: '부찬'
                        })
                      )
                  ]
                    .sort(
                      (a,b) =>
                        b.count -
                        a.count
                    )
                    .slice(
                      0,
                      12
                    )
                    .map(
                      (x,i) => `
                        <div class="rank">

                          <span class="num">
                            ${i + 1}
                          </span>

                          <div>

                            <b>
                              ${esc(x.name)}
                            </b>

                            <small>
                              ${x.t}
                              · 최근
                              ${formatDate(x.latest)}
                            </small>

                          </div>

                          <strong>
                            ${x.count}회
                          </strong>

                        </div>
                      `
                    )
                    .join('') ||
                  '<div class="empty">함께 낸 메뉴가 없습니다.</div>'
                }

              </div>

            </div>
          `
          : `
            <div class="empty">
              이 기간에
              '${esc(keyword)}'를
              편성한 날이 없습니다.
            </div>
          `
      }
    `;
  }

  const schoolsHTML =
    (set, idx) => {
      const arr =
        [
          ...set
        ];

      if (
        arr.length <= 3
      ) {
        return esc(
          arr.join(', ')
        );
      }

      return `
        <span
          class="sch-short"
          data-sch="${idx}"
        >

          ${esc(arr.slice(0,3).join(', '))}

          <button
            class="sch-more"
            data-sch-btn="${idx}"
          >
            외 ${arr.length - 3}개교
          </button>

        </span>

        <span
          class="sch-full hidden"
          data-sch-full="${idx}"
        >
          ${esc(arr.join(', '))}
        </span>
      `;
    };

  let schIdx =
    0;

  const catCols =
    [
      'rice',
      'soup',
      'main',
      'side',
      'kimchi',
      'dessert'
    ]
      .map(
        cat => {
          const items =
            [
              ...cats[cat].values()
            ]
              .sort(
                (a,b) =>
                  b.count -
                  a.count
              )
              .slice(
                0,
                30
              );

          return `
            <div
              class="card rank-card trend-col"
            >

              <h3>
                ${CAT_LABEL[cat]}
                TOP 30
              </h3>

              ${
                items.length
                  ? items
                      .map(
                        (x,i) => {
                          const key =
                            normalize(
                              x.name
                            );

                          const memo =
                            state.menuMemos[key];

                          const pinned =
                            isPinnedMenu(
                              x.name
                            );

                          return `
                            <div class="rank">

                              <span class="num">
                                ${i + 1}
                              </span>

                              <div>

                                <b>

                                  ${esc(x.name)}

                                  ${
                                    pinned
                                      ? '<span class="mine-tag">📌 핀</span>'
                                      : ''
                                  }

                                </b>

                                <small>
                                  ${x.count}회
                                  · 최근
                                  ${formatDate(x.latest)}
                                </small>

                                ${
                                  memo
                                    ? `
                                      <div class="menu-memo">
                                        📝 ${esc(memo)}
                                      </div>
                                    `
                                    : ''
                                }

                              </div>

                              <div
                                class="row"
                                style="gap:4px"
                              >

                                <button
                                  class="memo-btn"
                                  data-pin-menu="${esc(x.name)}"
                                  title="${pinned ? '핀 해제' : '핀 메뉴로 저장'}"
                                >
                                  ${
                                    pinned
                                      ? '📌'
                                      : '📍'
                                  }
                                </button>

                                <button
                                  class="memo-btn"
                                  data-menu-memo="${esc(key)}"
                                  data-menu-name="${esc(x.name)}"
                                  title="메뉴 메모"
                                >
                                  📝
                                </button>

                              </div>

                            </div>
                          `;
                        }
                      )
                      .join('')
                  : '<div class="empty">데이터 없음</div>'
              }

            </div>
          `;
        }
      )
      .join('');

  const popCols =
    [
      'rice',
      'soup',
      'main',
      'side',
      'kimchi',
      'dessert'
    ]
      .map(
        cat => {
          const items =
            [
              ...catsPeriod[cat].values()
            ]
              .sort(
                (a,b) =>
                  b.count -
                  a.count ||
                  b.schools.size -
                  a.schools.size
              )
              .slice(
                0,
                15
              );

          return `
            <div
              class="card rank-card trend-col"
            >

              <h3>
                ${CAT_LABEL[cat]}
              </h3>

              ${
                items.length
                  ? items
                      .map(
                        (x,i) => {
                          const isNew =
                            !myPeriodSet.has(
                              normalize(
                                x.name
                              )
                            );

                          const pinned =
                            isPinnedMenu(
                              x.name
                            );

                          const s =
                            schoolsHTML(
                              x.schools,
                              schIdx++
                            );

                          const idea =
                            esc(
                              JSON.stringify({
                                type:
                                  'idea',

                                title:
                                  x.name,

                                menus:
                                  [x.name],

                                date:
                                  today,

                                school:
                                  [
                                    ...x.schools
                                  ]
                                    .slice(
                                      0,
                                      3
                                    )
                                    .join(', '),

                                sourceType:
                                  '선택 기간 인기 메뉴',

                                sourcePeriod:
                                  `${from}~${to}`,

                                snapshot: {
                                  count:
                                    x.count,

                                  schools:
                                    [
                                      ...x.schools
                                    ],

                                  from,
                                  to
                                }
                              })
                            );

                          return `
                            <div class="rank">

                              <span class="num">
                                ${i + 1}
                              </span>

                              <div>

                                <b>

                                  ${esc(x.name)}

                                  ${
                                    isNew
                                      ? '<span class="new-badge">✨ 신메뉴 참고</span>'
                                      : ''
                                  }

                                  ${
                                    pinned
                                      ? '<span class="mine-tag">📌 핀</span>'
                                      : ''
                                  }

                                </b>

                                <small>
                                  ${x.count}회
                                  ·
                                  ${x.schools.size}개교
                                  ·
                                  ${s}
                                </small>

                              </div>

                              <div
                                class="row"
                                style="gap:4px"
                              >

                                <button
                                  class="memo-btn"
                                  data-pin-menu="${esc(x.name)}"
                                  title="${pinned ? '핀 해제' : '핀 메뉴로 저장'}"
                                >
                                  ${
                                    pinned
                                      ? '📌'
                                      : '📍'
                                  }
                                </button>

                                <button
                                  class="memo-btn"
                                  data-scrap-idea='${idea}'
                                  title="메뉴 아이디어로 스크랩"
                                >
                                  📌
                                </button>

                              </div>

                            </div>
                          `;
                        }
                      )
                      .join('')
                  : '<div class="empty">데이터 없음</div>'
              }

            </div>
          `;
        }
      )
      .join('');

  $('#results').innerHTML = `
    <div class="section-title">

      <div>

        <h2>
          📊
          ${esc(state.mine.schoolName)}
          식단 리포트
        </h2>

        <p>
          분석 기간
          ${from} ~ ${to}
          · 기준일
          ${today}
          · 나에게만 보이는 분석입니다
        </p>

      </div>

    </div>

    <div class="summary">

      <div class="stat">
        <span>
          급식일
        </span>
        <b>
          ${rows.length}일
        </b>
      </div>

      <div class="stat">
        <span>
          고유 메뉴
        </span>
        <b>
          ${all.length}개
        </b>
      </div>

      <div class="stat">
        <span>
          핀 메뉴
        </span>
        <b>
          ${state.favorites.size}개
        </b>
      </div>

      <div class="stat">
        <span>
          비교학교 참고 메뉴
        </span>
        <b>
          ${refCount}개
        </b>
      </div>

    </div>

    ${
      failedSchools.length
        ? `
          <div class="warn">
            ⚠
            ${esc(failedSchools.join(', '))}
            데이터를 불러오지 못해
            해당 학교는 제외하고 분석했어요.
          </div>
        `
        : ''
    }

    ${kwHTML}

    <div class="section-title">

      <div>

        <h2>
          분류별 자주 낸 메뉴
        </h2>

        <p>
          ${from} ~ ${to}
          · 📍를 눌러 다음 식단에 쓸 메뉴를 핀해두세요.
        </p>

      </div>

    </div>

    <div class="trend-grid">
      ${catCols}
    </div>

    ${
      state.comparisons.length ||
      compRows.length
        ? `
          <div class="section-title">

            <div>

              <h2>
                🔥 선택 기간 인기 메뉴
                (비교 참고)
              </h2>

              <p>
                ${from} ~ ${to}
                · 내 학교 +
                ${
                  state.comparisons
                    .map(
                      s =>
                        esc(
                          s.schoolName
                        )
                    )
                    .join(', ') ||
                  '비교학교'
                }
                · ✨ = 같은 기간 내 학교에 없던 메뉴
              </p>

            </div>

          </div>

          <div class="trend-grid">
            ${popCols}
          </div>
        `
        : `
          <div
            class="warn"
            style="margin-top:14px"
          >
            비교학교를 등록하면
            다른 학교 인기 메뉴와
            ✨신메뉴 참고를 함께 볼 수 있어요.
          </div>
        `
    }

    <div class="section-title">

      <div>

        <h2>
          3개월 넘게 안 쓴 메뉴
        </h2>

        <p>
          종료일(${to}) 기준
        </p>

      </div>

    </div>

    <div class="card rank-card">

      ${
        stale.length
          ? stale
              .map(
                (x,i) => `
                  <div class="rank">

                    <span class="num">
                      ${i + 1}
                    </span>

                    <div>

                      <b>
                        ${esc(x.name)}
                      </b>

                      <small>
                        ${CAT_LABEL[x.cat]}
                        · 마지막
                        ${formatDate(x.latest)}
                        · 총
                        ${x.count}회
                      </small>

                    </div>

                  </div>
                `
              )
              .join('')
          : `
            <div class="empty">
              모든 메뉴를 골고루 쓰고 있어요! 👏
            </div>
          `
      }

    </div>

    <!-- 리포트 저장 버튼을 이 위치로 이동 -->
    <div class="section-title">

      <div>

        <h2>
          📌 핀 메뉴 · 📝 메모 모아보기
        </h2>

        <p>
          다음 식단에 활용하고 싶은 메뉴를 모아둘 수 있어요.
        </p>

      </div>

      <button
        class="btn"
        id="saveReport"
      >
        📌 리포트 저장
      </button>

    </div>

    <div class="analysis">

      <div class="card rank-card">

        <h3>
          📌 핀 메뉴
          (${state.favorites.size}개)
        </h3>

        ${
          state.favorites.size
            ? [
                ...state.favorites
              ]
                .map(
                  name => `
                    <div class="rank">

                      <span
                        style="width:4px"
                      ></span>

                      <div style="flex:1">

                        <b>
                          ${esc(name)}
                        </b>

                        <small>
                          ${
                            CAT_LABEL[classify(name)] ||
                            '메뉴'
                          }
                        </small>

                      </div>

                      <button
                        class="memo-btn"
                        data-pin-menu="${esc(name)}"
                        title="핀 해제"
                      >
                        ✕
                      </button>

                    </div>
                  `
                )
                .join('')
            : `
              <div class="empty">
                아직 핀한 메뉴가 없어요.
                <br>
                위 메뉴 옆의 📍 버튼을 누르면
                여기에 바로 모여요.
              </div>
            `
        }

      </div>

      <div class="card rank-card">

        <h3>
          📝 메뉴 메모
          (${Object.keys(state.menuMemos).length}개)
        </h3>

        ${
          Object.keys(
            state.menuMemos
          ).length
            ? Object.entries(
                state.menuMemos
              )
                .map(
                  ([k,memo]) => `
                    <div class="rank">

                      <span
                        style="width:4px"
                      ></span>

                      <div>

                        <b>
                          ${esc(k)}
                        </b>

                        <div class="menu-memo">
                          📝 ${esc(memo)}
                        </div>

                      </div>

                      <button
                        class="memo-btn"
                        data-menu-memo="${esc(k)}"
                        data-menu-name="${esc(k)}"
                        title="수정"
                      >
                        ✏
                      </button>

                    </div>
                  `
                )
                .join('')
            : `
              <div class="empty">
                아직 메뉴 메모가 없어요.
                <br>
                위 TOP 30 메뉴 옆
                📝를 눌러 남겨보세요.
              </div>
            `
        }

      </div>

    </div>

    <div class="section-title">

      <div>

        <h2>
          📝 내 분석 노트
        </h2>

        <p>
          자동 저장 ·
          리포트 저장 시 함께 보관됩니다.
        </p>

      </div>

    </div>

    <div
      class="card"
      style="padding:16px"
    >

      <textarea
        id="reportNote"
        placeholder="예: 8월 주찬 반복이 많음. 다음 달엔 생선 메뉴 늘리기."
        style="
          width:100%;
          min-height:100px
        "
      >${esc(state.reportNote || '')}</textarea>

      <div
        class="help"
        id="noteSaved"
        style="text-align:right"
      ></div>

    </div>
  `;

  setStatus(
    `분석 완료 · 급식 ${rows.length}일 · 고유 메뉴 ${all.length}개` +
    (
      keyword
        ? ` · '${esc(keyword)}' 분석 포함`
        : ''
    )
  );

  bindReportEvents();

  bindIdeaScraps();
}

function bindReportEvents() {
  /* 핀 */
  $$('[data-pin-menu]')
    .forEach(
      b => {
        b.onclick =
          () => {
            togglePinnedMenu(
              b.dataset.pinMenu
            );
          };
      }
    );

  /* 리포트 저장 */
  const saveBtn =
    $('#saveReport');

  if (
    saveBtn
  ) {
    saveBtn.onclick =
      saveCurrentReportToScrapbook;
  }

  /* 메뉴 메모 */
  $$('[data-menu-memo]')
    .forEach(
      b => {
        b.onclick =
          () => {
            if (
              !requireLogin('메뉴 메모')
            ) {
              return;
            }

            const key =
              b.dataset.menuMemo;

            const name =
              b.dataset.menuName;

            const cur =
              state.menuMemos[key] ||
              '';

            const memo =
              prompt(
                `'${name}' 메뉴 메모`,
                cur
              );

            if (
              memo === null
            ) {
              return;
            }

            if (
              memo.trim()
            ) {
              state.menuMemos[key] =
                memo.trim();

            } else {
              delete state.menuMemos[key];
            }

            persist();

            renderReport();
          };
      }
    );

  /* 학교명 펼치기 */
  $$('[data-sch-btn]')
    .forEach(
      b => {
        b.onclick =
          () => {
            const i =
              b.dataset.schBtn;

            document
              .querySelector(
                `[data-sch="${i}"]`
              )
              ?.classList
              .add(
                'hidden'
              );

            document
              .querySelector(
                `[data-sch-full="${i}"]`
              )
              ?.classList
              .remove(
                'hidden'
              );
          };
      }
    );

  /* 분석 노트 자동저장 */
  const ta =
    $('#reportNote');

  if (
    ta
  ) {
    let t;

    ta.oninput =
      () => {
        clearTimeout(t);

        t =
          setTimeout(
            () => {
              state.reportNote =
                ta.value;

              persist();

              const s =
                $('#noteSaved');

              if (
                s
              ) {
                s.textContent =
                  '저장됨 ✓';

                setTimeout(
                  () =>
                    s.textContent = '',
                  1500
                );
              }
            },
            600
          );
      };
  }
}

/* ═════════════════════════════
   시작
═════════════════════════════ */
onAuthStateChanged(
  auth,
  async u => {
    cloudReady =
      false;

    user =
      u;

    /* 비로그인 상태: 화면의 개인 기록만 숨김.
       브라우저 저장분은 지우지 않음 —
       첫 로그인 때 계정으로 병합·구제하기 위해 보존.
       (로그아웃 버튼을 직접 누르면 doSignOut에서 삭제) */
    if (
      !u
    ) {
      resetPrivateState();

      shell();

      return;
    }

    /* 로그인하면 Firebase에서 개인자료 복원 */
    await initializeCloudForUser();

    migrateScraps();

    shell();
  }
);


/* ── 급식소리함 프로필 내 학교 자동 연동 (포털이 학교정보의 기준) ── */
function applySoriProfileMine(p){try{
  if(!p||!p.schoolCode)return;
  if(state.mine&&state.mine.officeCode==='UPLOAD')return; /* 유치원 업로드 기관은 유지 */
  const key=`${p.officeCode}:${p.schoolCode}`;
  if(state.mine&&schoolKey(state.mine)===key)return;
  const lv=p.schoolLevel||(/초등학교/.test(p.school)?'초등학교':/중학교/.test(p.school)?'중학교':/고등학교/.test(p.school)?'고등학교':'');
  state.mine={officeCode:p.officeCode,officeName:p.officeName||'',schoolCode:p.schoolCode,schoolName:p.school,level:lv,address:p.schoolAddress||'',region:''};
  state.lastNeisKey=key;
  state.comparisons=(state.comparisons||[]).filter(x=>x.level===lv&&schoolKey(x)!==key).slice(0,3);
  persistLocal();
  try{shell();}catch(_){}
}catch(_){}}
window.addEventListener('sori-ready',e=>applySoriProfileMine(e.detail&&e.detail.profile));
if(window.SORI)applySoriProfileMine(window.SORI.profile);

/* ═════════════════════════════════════════════
   ⭐ 추천식단: 초안 식단 캘린더
   (특일·학사일정 + 스크랩·복붙 식단 배치)
═════════════════════════════════════════════ */

/* ── 2차 연수 공개 전 베타 게이트 ──
   · 관리자(김소리) 계정은 항상 해제
   · 수강생은 ?beta=SORI-2ND 링크로 접속하면 이 브라우저에서 해제 */
const BETA2_CODE = 'SORI-2ND';
const BETA2_ADMIN = 'thfl4811@gmail.com';

function soriBetaOn() {
  if (user && user.email === BETA2_ADMIN) return true;
  return localStorage.getItem('archive_beta2') === BETA2_CODE;
}

try {
  const _q = new URLSearchParams(location.search);
  if (_q.get('beta') === BETA2_CODE) {
    localStorage.setItem('archive_beta2', BETA2_CODE);
  }
} catch (_) {}

/* ── 데이터 정규화·병합 ── */
function normalizeDraftCal(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    meals: (o.meals && typeof o.meals === 'object') ? o.meals : {},
    custom: Array.isArray(o.custom) ? o.custom : [],
    neis: (o.neis && typeof o.neis === 'object') ? o.neis : {},
    offOverride: (o.offOverride && typeof o.offOverride === 'object') ? o.offOverride : {},
    layers: {
      학사일정: true, 세시풍속: true, 삼복: true,
      법정기념일: true, 세계기념일: true, 절기: true,
      ...(o.layers || {})
    }
  };
}

function parseDraftCal(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

function mergeDraftCal(c, l) {
  const C = normalizeDraftCal(c);
  const Lc = normalizeDraftCal(l);
  return {
    meals: { ...Lc.meals, ...C.meals },
    custom: [
      ...C.custom,
      ...Lc.custom.filter(
        x => x && x.id && !C.custom.some(y => y && y.id === x.id)
      )
    ],
    neis: { ...Lc.neis, ...C.neis },
    offOverride: { ...Lc.offOverride, ...C.offOverride },
    layers: { ...Lc.layers, ...C.layers }
  };
}

/* ── 보기 모드 (스크랩북 ↔ 캘린더) ── */
let recViewMode =
  localStorage.getItem('archive_rec_view') || 'cal';

try {
  if (
    new URLSearchParams(location.search).get('view') === 'recommend'
  ) {
    state.tab = 'scrap';
    recViewMode = 'cal';
  }
} catch (_) {}

function setRecView(mode) {
  recViewMode = mode;
  localStorage.setItem('archive_rec_view', mode);
  renderScrapbook();
}

function recToggleHTML() {
  return `
    <div class="row" style="gap:6px;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn ${recViewMode === 'cal' ? '' : 'ghost'}" data-rec-view="cal">
        🗓️ 초안 식단 캘린더
      </button>
      <button class="btn ${recViewMode === 'scrap' ? '' : 'ghost'}" data-rec-view="scrap">
        📌 스크랩북
      </button>
    </div>
  `;
}

function bindRecToggle() {
  $$('[data-rec-view]').forEach(b => {
    b.onclick = () => setRecView(b.dataset.recView);
  });
}

/* renderScrapbook을 감싸서 보기 모드 분기 + 토글 유지 */
const _origRenderScrapbook = renderScrapbook;
renderScrapbook = function () {
  if (!soriBetaOn()) {
    _origRenderScrapbook();
    return;
  }
  if (recViewMode === 'cal') {
    renderDraftCal();
    return;
  }
  _origRenderScrapbook();
  const c = $('#controls');
  if (c) {
    c.insertAdjacentHTML('afterbegin', recToggleHTML());
    bindRecToggle();
  }
};

/* ── 캘린더 상태 ── */
const calView = {
  ym: (() => {
    const saved = localStorage.getItem('archive_cal_ym');
    if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1); /* 기본: 다음 달 */
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })()
};

function calSetYM(ym) {
  calView.ym = ym;
  localStorage.setItem('archive_cal_ym', ym);
  renderDraftCal();
}

function calShiftMonth(delta) {
  const [y, m] = calView.ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  calSetYM(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  );
}

/* ── 특정 날짜의 일정 목록 ── */
const WEEK_KR = ['일', '월', '화', '수', '목', '금', '토'];

/* 이 달의 예상 급식일 수 계산:
   평일 − 공휴일 − 학사일정 휴업일(나이스 offDay·방학류 직접 일정) */
const CAL_OFF_RE = /방학|휴업|재량|휴교|개교기념/;

/* 자동 판정: 주말·공휴일·휴업일 */
function calAutoOffDay(dateStr) {
  const dc = state.draftCal;
  const [y, mo, dd] = dateStr.split('-').map(Number);
  const dow = new Date(y, mo - 1, dd).getDay();
  if (dow === 0 || dow === 6) return true;
  if ((SPECIAL_DAYS[dateStr] || []).some(e => e.off)) return true;
  const ym = dateStr.slice(0, 7);
  if ((dc.neis[ym] || []).some(e => e.date === dateStr && e.offDay)) return true;
  if (dc.custom.some(e => e && e.date === dateStr && CAL_OFF_RE.test(e.name))) return true;
  return false;
}

/* 최종 판정: 수동 체크(offOverride)가 자동 판정보다 우선 */
function calIsOffDay(dateStr) {
  const ov = (state.draftCal.offOverride || {})[dateStr];
  if (ov === true) return true;
  if (ov === false) return false;
  return calAutoOffDay(dateStr);
}

function calMealDayCount(ym) {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const dc = state.draftCal;
  const offRe = CAL_OFF_RE;
  let count = 0;
  let neisApplied = !!(dc.neis[ym] && dc.neis[ym].length);

  for (let day = 1; day <= lastDay; day++) {
    const ds = `${ym}-${String(day).padStart(2, '0')}`;
    if (calIsOffDay(ds)) continue;
    count++;
  }

  return { count, neisApplied };
}

/* 식단 초안 칸 순서: 밥 → 국 → 주찬 → 부찬 → 김치 → 후식 */
const CAL_CAT_ORDER = ['rice', 'soup', 'main', 'side', 'kimchi', 'dessert'];

const CAL_CAT_SHORT = {
  rice: '밥', soup: '국', main: '주찬',
  side: '부찬', kimchi: '김치', dessert: '후식'
};

function calMealCats(meal) {
  if (!meal) return {};
  if (meal.cats && typeof meal.cats === 'object') return meal.cats;
  return splitMenus(meal.menus || []);
}

function calEventsFor(dateStr) {
  const dc = state.draftCal;
  const out = [];

  (SPECIAL_DAYS[dateStr] || []).forEach(e => {
    if (dc.layers[e.cat]) {
      out.push({ name: e.name, cat: e.cat, src: 'built' });
    }
  });

  if (dc.layers['학사일정']) {
    const ym = dateStr.slice(0, 7);
    (dc.neis[ym] || []).forEach(e => {
      if (e.date === dateStr) {
        out.push({
          name: e.name, cat: '학사일정',
          src: 'neis', offDay: !!e.offDay
        });
      }
    });
    dc.custom.forEach(e => {
      if (e && e.date === dateStr) {
        out.push({
          name: e.name, cat: '학사일정',
          src: 'custom', id: e.id
        });
      }
    });
  }

  return out;
}

function calBadge(ev, small = true) {
  const meta = SPECIAL_CATS[ev.cat] || SPECIAL_CATS['학사일정'];
  return `
    <span
      class="cal-ev ${small ? 'small' : ''}"
      style="background:${meta.bg};color:${meta.color}"
      title="${esc(ev.cat)}${ev.src === 'neis' ? ' · 나이스' : ev.src === 'custom' ? ' · 직접 등록' : ''}"
    >${ev.offDay ? '🏖 ' : ''}${esc(ev.name)}</span>
  `;
}

/* ── 캘린더 렌더 ── */
function renderDraftCal() {
  const c = $('#controls');
  if (!c) return;

  $('#results').innerHTML = '';
  $('#status').innerHTML = '';

  const [y, m] = calView.ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay();
  const todayStr = dateISO(new Date());
  const dc = state.draftCal;

  const layerChips = Object.keys(SPECIAL_CATS).map(cat => {
    const on = dc.layers[cat];
    const meta = SPECIAL_CATS[cat];
    return `
      <button
        class="chip folder-chip ${on ? '' : 'cal-layer-off'}"
        data-cal-layer="${esc(cat)}"
        style="${on ? `background:${meta.bg};color:${meta.color};border-color:${meta.color}44` : ''}"
      >${on ? '✔' : '－'} ${esc(cat)}</button>
    `;
  }).join('');

  let cells = '';
  for (let i = 0; i < firstDow; i++) {
    cells += `<div class="cal-cell empty"></div>`;
  }

  for (let day = 1; day <= lastDay; day++) {
    const ds = `${calView.ym}-${String(day).padStart(2, '0')}`;
    const dow = new Date(y, m - 1, day).getDay();
    const evs = calEventsFor(ds);
    const shown = evs.slice(0, 3);
    const more = evs.length - shown.length;
    const meal = dc.meals[ds];

    const offDay = calIsOffDay(ds);

    cells += `
      <div
        class="cal-cell ${ds === todayStr ? 'today' : ''} ${offDay ? 'cal-off' : ''}"
        data-cal-day="${ds}"
        ${offDay ? 'title="미급식일 (주말·공휴일·휴업일)"' : ''}
      >
        <div class="cal-daynum ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}">
          ${day}
        </div>
        <div class="cal-evs">
          ${shown.map(e => calBadge(e)).join('')}
          ${more > 0 ? `<span class="cal-ev small cal-more">+${more}</span>` : ''}
        </div>
        ${
          meal && meal.menus && meal.menus.length
            ? `<div class="cal-meal2">${
                CAL_CAT_ORDER.map(k => {
                  const arr = calMealCats(meal)[k] || [];
                  return arr.length
                    ? `<div class="cmr"><b>${CAL_CAT_SHORT[k]}</b><span>${esc(arr.join(', '))}</span></div>`
                    : '';
                }).join('')
              }</div>`
            : ''
        }
      </div>
    `;
  }

  const mineOk =
    state.mine && state.mine.officeCode !== 'UPLOAD';

  const mdc = calMealDayCount(calView.ym);

  c.innerHTML = `
    ${recToggleHTML()}
    <section class="panel">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div class="row" style="gap:6px">
          <button class="btn ghost small" id="calPrev">◀</button>
          <h2 style="margin:0;min-width:130px;text-align:center">
            ${y}년 ${m}월
          </h2>
          <button class="btn ghost small" id="calNext">▶</button>
          <button class="btn ghost small" id="calNextMonth">다음 달</button>
        </div>
        <span
          class="cal-count"
          title="주말·공휴일·학사일정 휴업일(방학·재량휴업 등)을 뺀 예상 급식일이에요.${mdc.neisApplied ? '' : ' 나이스 학사일정을 불러오면 방학·재량휴업일까지 반영돼요.'}"
        >
          🍚 급식"소리"함이 분석한 이번 달 급식일은 <b>${mdc.count}일</b>이에요!${mdc.neisApplied ? '' : ' <small>(학사일정 반영 전)</small>'}
        </span>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn ghost small" id="calNeisLoad" ${mineOk ? '' : 'disabled'}>
            🏫 나이스 학사일정 불러오기
          </button>
          <button class="btn ghost small" id="calSchedPaste">
            📋 학사일정 붙여넣기
          </button>
          <button class="btn ghost small" id="calCopyMonth">
            📄 월 식단 전체 복사
          </button>
          <a
            class="btn ghost small"
            href="?view=recommend"
            target="_blank"
            style="text-decoration:none"
            title="캘린더만 새 창으로 열어 아카이브 조회 창과 나란히 작업할 수 있어요"
          >↗ 새 창</a>
        </div>
      </div>

      <div class="chips" style="margin-top:12px">
        ${layerChips}
      </div>

      <p class="help" style="margin-top:10px">
        날짜 칸을 클릭하면 <b>식단 초안</b>과 <b>일정</b>을 편집할 수 있어요.
        절기·명절·기념일은 월력요항(한국천문연구원) 기준으로 내장되어 있고(${SPECIAL_RANGE.from.slice(0, 4)}~${SPECIAL_RANGE.to.slice(0, 4)}년),
        학사일정은 나이스에서 불러오거나 직접 등록·수정할 수 있어요.
        ${mineOk ? '' : '⚠️ 나이스 학사일정은 나이스 연동 학교에서만 불러올 수 있어요.'}
      </p>

      <div class="cal-grid" style="margin-top:12px">
        ${WEEK_KR.map((w, i) => `
          <div class="cal-head ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>
        `).join('')}
        ${cells}
      </div>
    </section>
  `;

  bindRecToggle();

  $('#calPrev').onclick = () => calShiftMonth(-1);
  $('#calNext').onclick = () => calShiftMonth(1);

  $('#calNextMonth').onclick = () => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    calSetYM(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  };

  $$('[data-cal-layer]').forEach(b => {
    b.onclick = () => {
      const cat = b.dataset.calLayer;
      state.draftCal.layers[cat] = !state.draftCal.layers[cat];
      persist();
      renderDraftCal();
    };
  });

  $$('[data-cal-day]').forEach(cell => {
    cell.onclick = () => openCalDayModal(cell.dataset.calDay);
  });

  $('#calNeisLoad').onclick = loadNeisSchedule;
  $('#calSchedPaste').onclick = openSchedPasteModal;
  $('#calCopyMonth').onclick = copyCalMonth;
}

/* ── 나이스 학사일정 불러오기 ── */
async function loadNeisSchedule() {
  const s = state.mine;
  if (!s || s.officeCode === 'UPLOAD') {
    alert('나이스 연동 학교가 설정된 경우에만 학사일정을 불러올 수 있어요.');
    return;
  }

  const ym = calView.ym;
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`;
  const to = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  const btn = $('#calNeisLoad');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span>불러오는 중';
  }

  try {
    const r = await fetch(
      `/api/schedule?office=${encodeURIComponent(s.officeCode)}` +
      `&school=${encodeURIComponent(s.schoolCode)}` +
      `&from=${from}&to=${to}`
    );
    const rows = await r.json();

    if (!r.ok) {
      throw Error(rows.error || '학사일정 조회 실패');
    }

    state.draftCal.neis[ym] = rows.map(x => ({
      date:
        `${String(x.date).slice(0, 4)}-` +
        `${String(x.date).slice(4, 6)}-` +
        `${String(x.date).slice(6, 8)}`,
      name: x.name,
      offDay: !!x.offDay
    }));

    persist();
    renderDraftCal();

    alert(
      rows.length
        ? `🏫 ${m}월 학사일정 ${rows.length}건을 불러왔어요.\n` +
          `(나이스에 등록된 일정 기준이라 실제와 다를 수 있어요. ` +
          `틀린 일정은 날짜를 클릭해 직접 추가로 보완해주세요.)`
        : `${m}월에 나이스에 등록된 학사일정이 없어요.\n` +
          `날짜를 클릭해 직접 추가하거나 '학사일정 붙여넣기'를 이용해보세요.`
    );

  } catch (e) {
    alert(e.message);
    renderDraftCal();
  }
}

/* ── 월 식단 전체 복사 ── */
function copyCalMonth() {
  const [y, m] = calView.ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const lines = [];

  for (let day = 1; day <= lastDay; day++) {
    const ds = `${calView.ym}-${String(day).padStart(2, '0')}`;
    const meal = state.draftCal.meals[ds];
    if (meal && meal.menus && meal.menus.length) {
      const dow = WEEK_KR[new Date(y, m - 1, day).getDay()];
      lines.push(`${m}/${day}(${dow}) ${meal.menus.join(' / ')}`);
    }
  }

  if (!lines.length) {
    alert('이 달에 배치된 식단 초안이 아직 없어요.');
    return;
  }

  navigator.clipboard.writeText(lines.join('\n'));
  alert(`📄 ${lines.length}일치 식단 초안을 복사했어요.`);
}

/* ── ' / ' 형식 텍스트 ↔ 메뉴 배열 ── */
function parseMenuText(text) {
  return String(text || '')
    .split(/\n+/)
    /* 복사 시 붙는 출처 줄("※ 2026-09-12 · 학교명")은 메뉴로 취급하지 않음 */
    .filter(line => {
      const t = line.trim();
      if (!t) return false;
      if (t.startsWith('※')) return false;
      if (/^\d{4}-\d{2}-\d{2}/.test(t) && t.includes('·')) return false;
      return true;
    })
    .join(' / ')
    .split(/\s*\/\s*/)
    .map(x => x.trim())
    .filter(Boolean);
}

/* ── 날짜 상세 모달 ── */
function openCalDayModal(dateStr) {
  const m = $('#modal');
  const [y, mo, day] = dateStr.split('-').map(Number);
  const dow = WEEK_KR[new Date(y, mo - 1, day).getDay()];
  const evs = calEventsFor(dateStr);
  const meal = state.draftCal.meals[dateStr];

  const mealScraps = state.scraps.filter(
    sc => sc && Array.isArray(sc.menus) && sc.menus.length
  );

  const refSchools = [
    ...(state.mine ? [state.mine] : []),
    ...(state.comparisons || [])
  ];

  m.innerHTML = `
    <div class="modal" id="calDayModal">
      <div class="modal-card">
        <div class="row" style="justify-content:space-between">
          <h2>🗓️ ${mo}월 ${day}일 (${dow})</h2>
          <button class="btn ghost small" id="calDayClose">닫기 ✕</button>
        </div>

        <div class="field" style="margin:12px 0 0">
          <label>이 날의 일정</label>
          <div class="chips" id="calDayEvs">
            ${
              evs.length
                ? evs.map((e, i) => `
                    <span class="row" style="gap:3px">
                      ${calBadge(e, false)}
                      ${
                        e.src === 'custom'
                          ? `<button class="btn ghost small" data-del-ev="${esc(e.id)}" title="삭제">✕</button>`
                          : ''
                      }
                    </span>
                  `).join('')
                : `<span class="help" style="margin:0">등록된 일정이 없어요.</span>`
            }
          </div>
          <div class="row" style="margin-top:8px;gap:6px">
            <input
              id="calNewEv"
              placeholder="학사일정 직접 추가 (예: 중간고사, 현장체험학습)"
              style="flex:1;padding:10px 12px;border:1px solid var(--line);border-radius:11px"
            >
            <button class="btn small" id="calAddEv">＋ 추가</button>
          </div>
        </div>

        <label
          class="row"
          style="gap:8px;margin:14px 0 0;cursor:pointer;align-items:flex-start"
        >
          <input
            type="checkbox"
            id="calOffChk"
            style="margin-top:2px"
            ${calIsOffDay(dateStr) ? 'checked' : ''}
          >
          <span>
            <b style="color:#b91c1c">🚫 미급식일로 표시</b>
            <span class="help" style="display:block;margin-top:2px">
              주말·공휴일·휴업일은 자동으로 표시돼요.
              학교 상황(단축수업·행사 등)에 맞게 직접 켜고 끌 수 있어요.
            </span>
          </span>
        </label>

        <div class="field" style="margin:16px 0 0">
          <label>🍱 식단 초안 — 밥 · 국 · 주찬 · 부찬 · 김치 · 후식 순</label>
          <textarea
            id="calPaste"
            rows="2"
            style="width:100%"
            placeholder="여기에 복사한 식단을 붙여넣으면 아래 칸에 자동 분류돼요 (※ 날짜 출처 줄은 자동 무시)"
          ></textarea>
          <div class="cal-cats">
            ${CAL_CAT_ORDER.map(k => `
              <div class="cal-cat-row">
                <span>${CAT_LABEL[k]}</span>
                <input
                  id="calCat_${k}"
                  value="${esc((calMealCats(meal)[k] || []).join(' / '))}"
                  placeholder="－"
                >
              </div>
            `).join('')}
          </div>
          <p class="help">
            한 칸에 여러 개면 <b>/</b> 로 구분해요. 자동 분류가 틀리면
            칸 사이에서 직접 옮겨 적으면 돼요.
          </p>
          <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
            <button class="btn small" id="calMealSave">💾 저장</button>
            <button class="btn ghost small" id="calMealCopy">📋 복사</button>
            <button class="btn ghost small" id="calMealClear">🗑 비우기</button>
          </div>
        </div>

        ${
          mealScraps.length
            ? `
              <div class="field" style="margin:16px 0 0">
                <label>📌 스크랩에서 가져오기</label>
                <div class="row" style="gap:6px">
                  <select id="calScrapSel" style="flex:1;padding:10px;border:1px solid var(--line);border-radius:11px">
                    ${mealScraps.map(sc => `
                      <option value="${esc(sc.id)}">
                        ${esc(sc.title || sc.menus.slice(0, 3).join('·'))}
                        ${sc.school ? ` — ${esc(sc.school)}` : ''}
                        ${sc.date ? ` (${esc(sc.date)})` : ''}
                      </option>
                    `).join('')}
                  </select>
                  <button class="btn small" id="calScrapUse">넣기</button>
                </div>
              </div>
            `
            : ''
        }

        ${
          refSchools.length
            ? `
              <details style="margin:16px 0 0">
                <summary style="cursor:pointer;font-weight:900">
                  📖 참고 조회 — 내 학교·비교학교 실제 식단 보기
                </summary>
                <div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">
                  <select id="calRefSchool" style="padding:10px;border:1px solid var(--line);border-radius:11px">
                    ${refSchools.map((s, i) => `
                      <option value="${i}">
                        ${esc(s.schoolName)}${i === 0 && state.mine ? ' (내 학교)' : ''}
                      </option>
                    `).join('')}
                  </select>
                  <input
                    type="month"
                    id="calRefMonth"
                    value="${(() => {
                      const d = new Date(y - 1, mo - 1, 1);
                      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    })()}"
                    style="padding:9px;border:1px solid var(--line);border-radius:11px"
                  >
                  <button class="btn ghost small" id="calRefGo">불러오기</button>
                </div>
                <p class="help">
                  기본으로 작년 같은 달이 선택돼요. 식사 구분은 조회 화면 설정
                  (${state.mealCode === '1' ? '조식' : state.mealCode === '3' ? '석식' : '중식'})을 따라요.
                </p>
                <div id="calRefList" style="margin-top:8px;max-height:260px;overflow:auto"></div>
              </details>
            `
            : ''
        }

      </div>
    </div>
  `;

  const close = () => { m.innerHTML = ''; };

  $('#calDayClose').onclick = close;
  $('#calDayModal').onclick = e => {
    if (e.target.id === 'calDayModal') close();
  };

  /* 일정 삭제 (직접 등록만) */
  $$('[data-del-ev]').forEach(b => {
    b.onclick = () => {
      state.draftCal.custom =
        state.draftCal.custom.filter(x => x.id !== b.dataset.delEv);
      persist();
      renderDraftCal();
      openCalDayModal(dateStr);
    };
  });

  /* 일정 직접 추가 */
  const addEv = () => {
    const name = $('#calNewEv').value.trim();
    if (!name) return;
    state.draftCal.custom.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: dateStr,
      name
    });
    persist();
    renderDraftCal();
    openCalDayModal(dateStr);
  };
  $('#calAddEv').onclick = addEv;
  $('#calNewEv').onkeydown = e => {
    if (e.key === 'Enter') addEv();
  };

  /* 미급식일 수동 체크 */
  const offChk = $('#calOffChk');
  if (offChk) {
    offChk.onchange = () => {
      const auto = calAutoOffDay(dateStr);
      if (!state.draftCal.offOverride) state.draftCal.offOverride = {};
      if (offChk.checked === auto) {
        delete state.draftCal.offOverride[dateStr];
      } else {
        state.draftCal.offOverride[dateStr] = offChk.checked;
      }
      persist();
      renderDraftCal();
    };
  }

  /* 붙여넣기 → 6칸 자동 분류 */
  const fillCats = menus => {
    const g = splitMenus(menus);
    CAL_CAT_ORDER.forEach(k => {
      const el = $('#calCat_' + k);
      if (el) el.value = (g[k] || []).join(' / ');
    });
  };

  const readCats = () => {
    const cats = {};
    const menus = [];
    CAL_CAT_ORDER.forEach(k => {
      const el = $('#calCat_' + k);
      const arr = el ? parseMenuText(el.value) : [];
      cats[k] = arr;
      menus.push(...arr);
    });
    return { menus, cats };
  };

  $('#calPaste').addEventListener('paste', () => {
    setTimeout(() => {
      const menus = parseMenuText($('#calPaste').value);
      if (menus.length) {
        fillCats(menus);
        $('#calPaste').value = '';
      }
    }, 60);
  });

  /* 식단 초안 저장·복사·비우기 */
  $('#calMealSave').onclick = () => {
    const { menus, cats } = readCats();
    if (menus.length) {
      state.draftCal.meals[dateStr] = { menus, cats };
    } else {
      delete state.draftCal.meals[dateStr];
    }
    persist();
    renderDraftCal();
    close();
  };

  $('#calMealCopy').onclick = () => {
    const { menus } = readCats();
    if (!menus.length) {
      alert('복사할 메뉴가 없어요.');
      return;
    }
    navigator.clipboard.writeText(menus.join(' / '));
    alert('복사했습니다.');
  };

  $('#calMealClear').onclick = () => {
    CAL_CAT_ORDER.forEach(k => {
      const el = $('#calCat_' + k);
      if (el) el.value = '';
    });
    $('#calPaste').value = '';
  };

  /* 스크랩에서 가져오기 */
  const scrapUse = $('#calScrapUse');
  if (scrapUse) {
    scrapUse.onclick = () => {
      const sc = mealScraps.find(
        x => x.id === $('#calScrapSel').value
      );
      if (sc) fillCats(sc.menus);
    };
  }

  /* 참고 조회 */
  const refGo = $('#calRefGo');
  if (refGo) {
    refGo.onclick = async () => {
      const s = refSchools[+$('#calRefSchool').value];
      const rym = $('#calRefMonth').value;
      if (!s || !rym) return;

      const [ry, rm] = rym.split('-').map(Number);
      const from = `${rym}-01`;
      const to = `${rym}-${String(new Date(ry, rm, 0).getDate()).padStart(2, '0')}`;

      const list = $('#calRefList');
      list.innerHTML =
        `<div class="help"><span class="loading"></span>불러오는 중...</div>`;

      try {
        const rows = await fetchMeals(s, from, to);
        if (!rows.length) {
          list.innerHTML =
            `<div class="help">이 달에는 급식 자료가 없어요.</div>`;
          return;
        }

        list.innerHTML = rows.map(r => {
          const menus = (r.dishes || '')
            .split(/<br\s*\/?>/i)
            .map(x =>
              x.replace(/\([^)]*\)/g, '')
                .replace(/[\d.]+$/g, '')
                .trim()
            )
            .filter(Boolean);
          const dd = String(r.date);
          const rday = +dd.slice(6, 8);
          const rdow = WEEK_KR[
            new Date(+dd.slice(0, 4), +dd.slice(4, 6) - 1, rday).getDay()
          ];
          const joined = menus.join(' / ');
          const src =
            `${dd.slice(0, 4)}-${dd.slice(4, 6)}-${dd.slice(6, 8)}` +
            ` · ${s.schoolName}`;
          return `
            <div class="kw-day" style="gap:8px">
              <span style="flex:1;min-width:0">
                <b>${rm}/${rday}(${rdow})</b> ${esc(joined)}
              </span>
              <span class="row" style="gap:4px;flex:none">
                <button class="btn small" data-ref-use="${esc(joined)}">넣기</button>
                <button class="btn ghost small" data-ref-copy="${esc(joined + '\n※ ' + src)}">복사</button>
              </span>
            </div>
          `;
        }).join('');

        $$('[data-ref-use]').forEach(b => {
          b.onclick = () => {
            fillCats(parseMenuText(b.dataset.refUse));
            const first = $('#calCat_rice');
            if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
          };
        });
        $$('[data-ref-copy]').forEach(b => {
          b.onclick = () => {
            navigator.clipboard.writeText(b.dataset.refCopy);
            alert('복사했습니다.');
          };
        });

      } catch (e) {
        list.innerHTML =
          `<div class="help">⚠️ ${esc(e.message)}</div>`;
      }
    };
  }
}

/* ── 학사일정 텍스트 붙여넣기 인식 ── */
function parseSchedText(text, baseYear) {
  const out = [];

  String(text || '').split(/\n+/).forEach(line => {
    const t = line.trim();
    if (!t) return;

    const re =
      /(?:(\d{4})\s*[.\-\/년]\s*)?(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})\s*일?\s*(?:[~\-–]\s*(?:(\d{4})\s*[.\-\/년]\s*)?(?:(\d{1,2})\s*[.\-\/월]\s*)?(\d{1,2})\s*일?)?/;

    const mt = t.match(re);
    if (!mt) return;

    const name = t
      .replace(mt[0], ' ')
      .replace(/^[\s:·.\-–~,()]+|[\s:·.\-–~,()]+$/g, '')
      .trim();
    if (!name) return;

    const y1 = mt[1] ? +mt[1] : baseYear;
    const mo1 = +mt[2];
    const d1 = +mt[3];

    const y2 = mt[4] ? +mt[4] : y1;
    const mo2 = mt[5] ? +mt[5] : mo1;
    const d2 = mt[6] ? +mt[6] : d1;

    if (mo1 < 1 || mo1 > 12 || d1 < 1 || d1 > 31) return;

    const s = new Date(y1, mo1 - 1, d1);
    const e = new Date(y2, mo2 - 1, d2);
    if (isNaN(s) || isNaN(e) || e < s) return;
    if ((e - s) / 86400000 > 60) return;

    for (let dd = new Date(s); dd <= e; dd.setDate(dd.getDate() + 1)) {
      out.push({ date: dateISO(dd), name });
    }
  });

  return out;
}

function openSchedPasteModal() {
  const m = $('#modal');
  const baseYear = +calView.ym.slice(0, 4);

  m.innerHTML = `
    <div class="modal" id="schedPasteModal">
      <div class="modal-card">
        <div class="row" style="justify-content:space-between">
          <h2>📋 학사일정 붙여넣기</h2>
          <button class="btn ghost small" id="spClose">닫기 ✕</button>
        </div>
        <p class="help">
          학사일정 PDF·한글 문서에서 복사한 텍스트를 붙여넣으면 날짜와 일정을
          자동으로 인식해요. 한 줄에 일정 하나씩이면 가장 잘 인식돼요.<br>
          지원 예시: <b>9/12 중간고사</b> · <b>10월 20일 ~ 10월 23일 수학여행</b> ·
          <b>2026-11-05 개교기념일</b><br>
          연도가 없는 날짜는 지금 보고 있는 달력의 연도(<b>${baseYear}년</b>)로 등록돼요.
        </p>
        <textarea id="spText" rows="8" style="width:100%;margin-top:8px"
          placeholder="9/12 중간고사&#10;10월 20일 ~ 10월 23일 수학여행"></textarea>
        <div class="row" style="gap:6px;margin-top:10px">
          <button class="btn small" id="spParse">인식하기</button>
        </div>
        <div id="spPreview" style="margin-top:12px"></div>
      </div>
    </div>
  `;

  const close = () => { m.innerHTML = ''; };
  $('#spClose').onclick = close;
  $('#schedPasteModal').onclick = e => {
    if (e.target.id === 'schedPasteModal') close();
  };

  $('#spParse').onclick = () => {
    const items = parseSchedText($('#spText').value, baseYear);
    const pv = $('#spPreview');

    if (!items.length) {
      pv.innerHTML =
        `<div class="warn">날짜를 인식하지 못했어요. 한 줄에 "날짜 + 일정 이름" 형식으로 정리해서 다시 붙여넣어 보세요.</div>`;
      return;
    }

    pv.innerHTML = `
      <p class="help" style="margin:0 0 6px">
        ${items.length}건을 인식했어요. 등록할 일정만 체크하세요.
      </p>
      <div style="max-height:240px;overflow:auto">
        ${items.map((it, i) => `
          <label class="kw-day" style="cursor:pointer;gap:8px">
            <input type="checkbox" data-sp-item="${i}" checked>
            <span style="flex:1"><b>${esc(it.date)}</b> ${esc(it.name)}</span>
          </label>
        `).join('')}
      </div>
      <button class="btn" id="spRegister" style="margin-top:10px">
        ✅ 선택한 일정 등록
      </button>
    `;

    $('#spRegister').onclick = () => {
      const picked = $$('[data-sp-item]')
        .filter(cb => cb.checked)
        .map(cb => items[+cb.dataset.spItem]);

      if (!picked.length) {
        alert('선택된 일정이 없어요.');
        return;
      }

      picked.forEach(it => {
        const dup = state.draftCal.custom.some(
          x => x.date === it.date && x.name === it.name
        );
        if (!dup) {
          state.draftCal.custom.push({
            id:
              Date.now().toString(36) +
              Math.random().toString(36).slice(2, 6),
            date: it.date,
            name: it.name
          });
        }
      });

      persist();
      close();
      renderDraftCal();
      alert(`✅ 학사일정 ${picked.length}건을 등록했어요.`);
    };
  };
}
