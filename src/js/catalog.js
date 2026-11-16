/* Urbify — 요소 카탈로그(단면 구간, 도로 위계, 입면 스타일, 수목, 시설물, 지하시설) */
(function (G) {
  'use strict';
  const UDS = G.UDS;
  const C = (UDS.C = {});

  /* 색의 출발점은 다섯 가지: 코랄 F28076 · 연분홍 FFB6AF · 크림 FAE0C7 · 살구 FBC193 · 청록 4EB09B.
     강조는 청록 하나, 경고·삭제는 코랄, 주의는 살구. 글자와 가는 선에는 같은 색상의 진한 단계를 씀 */
  C.THEME = {
    coral: '#F28076', pink: '#FFB6AF', cream: '#FAE0C7', apricot: '#FBC193', teal: '#4EB09B',
    tealPic: '#43A590', tealDeep: '#2B7F6E', tealInk: '#1F6F5F', tealLight: '#9AD3C5', tealSoft: '#E0F1EC',
    coralDeep: '#D9584C', coralInk: '#C4473C', apricotDeep: '#EE9A45', apricotInk: '#A85B14',
    ink: '#262422', mute: '#756F69',
  };
  const T = C.THEME;
  /* 도면 공용 색. 평면은 채도를 낮춘 따뜻한 회색 바탕에 용도색을 옅게 얹는다 */
  C.PAL = {
    outside: '#F7F4F0', site: '#EFEBE5', siteEdge: '#A49D95', lotEdge: '#D9D3CB', blockEdge: '#B5AEA6',
    asphalt: '#8A8581', curb: '#DFDAD3', white: '#FBF9F5', yellow: '#EFC65C', blue: '#7FA6C2',
    sel: T.tealDeep, hover: T.teal, erase: '#E5645A', snap: T.apricotDeep, cut: T.coralDeep,
    lawn: '#C6E2D2', path: '#F5EFE4', play: T.apricot, plaza: '#EAE4DA', grass: '#BBDAC8',
    sidewalk: '#E3DED7', lamp: '#F2D08A', wire: '#4A4744', pole: '#7A7672', text: T.ink,
    soil0: '#B7A590', soil1: '#9C8975', base: '#C9C3BA', curbFace: '#EFECE7',
    water: '#A9D3E5', waterEdge: '#6FA6C2', water3: '#8DC0D8', rail: '#6E6A66',
  };

  /* 가로 단면 구간 유형. carriage: 차도부(연석 안쪽) 여부 */
  C.SEG = {
    sidewalk: { name: '보도', en: 'Sidewalk', color: '#E3DED7', line: '#8a8378', carriage: false, defW: 2.5 },
    furniture: { name: '시설대', en: 'Furniture zone', color: '#D4CEC6', carriage: false, defW: 1.5, treeZone: true },
    planting: { name: '띠녹지', en: 'Planting strip', color: '#BBDAC8', carriage: false, defW: 1.5, treeZone: true, green: true },
    biketrack: { name: '자전거 전용도로', en: 'Bike track', color: '#93CBBB', carriage: false, defW: 1.5, bike: true },
    bikelane: { name: '자전거 전용차로', en: 'Bike lane', color: '#93CBBB', carriage: true, defW: 1.5, bike: true },
    parking: { name: '노상주차', en: 'Parking', color: '#A9A49E', carriage: true, defW: 2.0 },
    lane: { name: '차로', en: 'Drive lane', color: '#8A8581', carriage: true, defW: 3.25, dir: 1 },
    bus: { name: '버스전용차로', en: 'Bus lane', color: '#CC9085', carriage: true, defW: 3.25, dir: 1 },
    median: { name: '중앙분리대', en: 'Median', color: '#BBDAC8', carriage: false, defW: 2.0, island: true, green: true },
    shared: { name: '보행자우선(보차혼용)', en: 'Shared street', color: '#A39E98', carriage: false, defW: 6.0, shared: true }, // 회색 포장(차로보다 밝게)
    pedestrian: { name: '보행자전용', en: 'Pedestrian way', color: '#EFE7D7', carriage: false, defW: 8.0, ped: true },
    // 단지 안 길(획지 안에 그리며 가구를 나누지 않는다): 단지내도로(차가 드나드는 포장) · 오솔길(마사토 산책로)
    estate: { name: '단지내도로', en: 'Estate road', color: '#A29B93', carriage: true, defW: 4.0, inner: true },
    trail: { name: '오솔길', en: 'Trail', color: '#E9DCC2', edge: '#CDBD9C', carriage: false, defW: 2.0, inner: true, trail: true },
  };
  C.SEG_ORDER = ['sidewalk', 'furniture', 'planting', 'biketrack', 'bikelane', 'parking', 'lane', 'bus', 'median', 'shared', 'pedestrian', 'estate', 'trail'];

  C.FN = {
    arterial: { name: '주간선도로', en: 'Arterial' },
    subarterial: { name: '보조간선도로', en: 'Sub-arterial' },
    collector: { name: '집산도로', en: 'Collector' },
    local: { name: '국지도로', en: 'Local' },
    pedestrian: { name: '보행자전용도로', en: 'Pedestrian' },
    shared: { name: '보행자우선도로', en: 'Shared street' },
    estate: { name: '단지내도로', en: 'Estate road' },
    trail: { name: '오솔길', en: 'Trail' },
  };

  /* 도시·군계획시설규칙 제9조 규모별 구분 */
  C.classify = (w) => {
    const TB = [[70, '광로1류'], [50, '광로2류'], [40, '광로3류'], [35, '대로1류'], [30, '대로2류'], [25, '대로3류'],
      [20, '중로1류'], [15, '중로2류'], [12, '중로3류'], [10, '소로1류'], [8, '소로2류']];
    for (const [min, name] of TB) if (w >= min - 1e-6) return name;
    return '소로3류';
  };

  const S = (type, w, dir) => ({ type, w, ...(dir ? { dir } : {}) });
  /* 도로 위계 프리셋 — 구간은 진행 방향 기준 왼쪽→오른쪽 */
  C.PRESETS = {
    'dae3': { name: '대로3류 25m', fn: 'arterial', speed: 60, curbR: 10, segs: [S('sidewalk', 3.0), S('furniture', 1.5), S('biketrack', 1.5), S('lane', 3.25, -1), S('lane', 3.25, -1), S('lane', 3.25, 1), S('lane', 3.25, 1), S('biketrack', 1.5), S('furniture', 1.5), S('sidewalk', 3.0)] },
    'jung1': { name: '중로1류 20m', fn: 'subarterial', speed: 50, curbR: 8, segs: [S('sidewalk', 2.5), S('furniture', 1.5), S('lane', 3.0, -1), S('lane', 3.0, -1), S('lane', 3.0, 1), S('lane', 3.0, 1), S('furniture', 1.5), S('sidewalk', 2.5)] },
    'jung2': { name: '중로2류 15m', fn: 'collector', speed: 50, curbR: 6, segs: [S('sidewalk', 2.0), S('furniture', 1.0), S('bikelane', 1.5), S('lane', 3.0, -1), S('lane', 3.0, 1), S('bikelane', 1.5), S('furniture', 1.0), S('sidewalk', 2.0)] },
    'jung3': { name: '중로3류 12m', fn: 'collector', speed: 40, curbR: 6, segs: [S('sidewalk', 2.0), S('furniture', 1.0), S('lane', 3.0, -1), S('lane', 3.0, 1), S('furniture', 1.0), S('sidewalk', 2.0)] },
    'so1': { name: '소로1류 10m', fn: 'local', speed: 30, curbR: 5, segs: [S('sidewalk', 2.0), S('lane', 3.0, -1), S('lane', 3.0, 1), S('sidewalk', 2.0)] },
    'shared8': { name: '보행자우선 8m', fn: 'shared', speed: 20, curbR: 3, segs: [S('shared', 8.0)] },
    'shared6': { name: '보행자우선 6m', fn: 'shared', speed: 20, curbR: 3, segs: [S('shared', 6.0)] },
    'ped8': { name: '보행자전용 8m', fn: 'pedestrian', speed: 0, curbR: 0, segs: [S('pedestrian', 8.0)] },
    // 단지 안 길: 획지 안에 그린다(가구를 나누지 않음). 기존 도로에 이으면 진출입로가 된다. shape: 'line' 꺾은선 · 'round' 모서리 둥글게(cornerR) · 'curve' 곡선(베지에)
    'estate4': { name: '단지내도로 4m', fn: 'estate', speed: 20, curbR: 3, inner: true, shape: 'round', cornerR: 6, segs: [S('estate', 4.0)] },
    'trail2': { name: '오솔길 2m', fn: 'trail', speed: 0, curbR: 0, inner: true, shape: 'curve', cornerR: 4, segs: [S('trail', 2.0)] },
  };
  C.PRESET_ORDER = ['dae3', 'jung1', 'jung2', 'jung3', 'so1', 'shared8', 'shared6', 'ped8'];
  C.INNER_ORDER = ['estate4', 'trail2'];
  C.SHAPES = { line: '꺾은선', round: '모서리 둥글게', curve: '곡선(베지에)' };
  /* 단지 안 길과 건물 사이(길 가장자리에서): 단지내도로 1m · 오솔길 0.5m(학습용 값) */
  C.innerGap = (hasCar) => (hasCar ? 1.0 : 0.5);

  /* 토지 용도 */
  C.USES = {
    res: { name: '주거', color: '#F2DDA9' },
    mixed: { name: '주상복합', color: '#F3C79B' },
    com: { name: '상업', color: '#EDA9A0' },
    off: { name: '업무', color: '#B5C4D0' },
    pub: { name: '공공', color: '#CDBBD8' },
    market: { name: '전통시장', color: '#DDBB96' },
    park: { name: '공원', color: '#A9D5C2', open: true },
    plaza: { name: '광장', color: '#E9E2D6', open: true },
    green: { name: '녹지', color: '#CBE4D7', open: true },
    parking: { name: '주차장', color: '#D0CCC6', open: true },
    vacant: { name: '나대지', color: '#E7E3DD', open: true },
  };
  C.USE_ORDER = ['res', 'mixed', 'com', 'off', 'pub', 'market', 'park', 'plaza', 'green', 'parking', 'vacant'];

  C.PARK_TYPES = {
    pocket: { name: '소공원', min: 0, reach: null },
    children: { name: '어린이공원', min: 1500, reach: 250 },
    neighborhood: { name: '근린생활권 근린공원', min: 10000, reach: 500 },
    walk: { name: '도보권 근린공원', min: 30000, reach: 1000 },
  };

  /* 입면 */
  C.MATERIALS = {
    brick: { name: '적벽돌', color: '#b5654c' },
    stone: { name: '석재', color: '#d9d4c9' },
    concrete: { name: '노출콘크리트', color: '#c6c6c8' },
    metal: { name: '금속패널', color: '#a4a9b0' },
    glass: { name: '유리 커튼월', color: '#9DB7C9' },
    stucco: { name: '도장·스타코', color: '#f2efe9' },
    tile: { name: '외장 타일', color: '#ddd3bf' },
  };
  C.MAT_ORDER = ['brick', 'stone', 'concrete', 'metal', 'glass', 'stucco', 'tile'];
  C.CMAT_MAX = 12; // 이미지로 만드는 벽 재료(프로젝트마다)
  C.CMAT_PX = 512; // 재료 그림을 줄이는 크기(정사각형, 3D 텍스처 한 장)
  C.WIN = { punched: '개별창', ribbon: '띠창', vertical: '세로창', curtain: '커튼월' };
  C.GROUND = { shop: '상가(쇼윈도)', lobby: '로비', residential: '주거 현관', pilotis: '필로티', arcade: '아케이드', closed: '막힌 벽' };
  C.SIGN = { none: '간판 없음', cluttered: '간판 정비 전', regulated: '간판 정비 후' };
  C.ROOF = { flat: '평지붕', gable: '박공지붕', green: '옥상녹화' };

  C.STYLE_PRESETS = {
    shop_old: { name: '근린상가(정비 전)', material: 'tile', wallColor: '#ddd1ba', wwr: 0.3, win: 'punched', ground: 'shop', sign: 'cluttered', canopy: false, roof: 'flat' },
    shop_new: { name: '근린상가(정비 후)', material: 'stucco', wallColor: '#f0ece4', wwr: 0.45, win: 'punched', ground: 'shop', sign: 'regulated', canopy: true, roof: 'flat' },
    res_multi: { name: '다세대주택', material: 'brick', wallColor: '#b5654c', wwr: 0.25, win: 'punched', ground: 'pilotis', sign: 'none', canopy: false, roof: 'flat' },
    apt: { name: '공동주택', material: 'stucco', wallColor: '#f4f1ea', wwr: 0.4, win: 'ribbon', ground: 'residential', sign: 'none', canopy: false, roof: 'flat' },
    office: { name: '업무(커튼월)', material: 'glass', wallColor: '#9DB7C9', wwr: 0.85, win: 'curtain', ground: 'lobby', sign: 'none', canopy: false, roof: 'flat' },
    mixed: { name: '주상복합', material: 'stone', wallColor: '#d9d2c5', wwr: 0.5, win: 'vertical', ground: 'shop', sign: 'regulated', canopy: true, roof: 'flat' },
    public: { name: '공공건축', material: 'concrete', wallColor: '#c9c9cb', wwr: 0.5, win: 'ribbon', ground: 'lobby', sign: 'none', canopy: false, roof: 'green' },
    modern_brick: { name: '근대건축(적벽돌)', material: 'brick', wallColor: '#a8563f', wwr: 0.3, win: 'vertical', ground: 'shop', sign: 'none', canopy: false, roof: 'gable' },
    house: { name: '단독주택(박공)', material: 'stucco', wallColor: '#ece5d6', wwr: 0.25, win: 'punched', ground: 'residential', sign: 'none', canopy: false, roof: 'gable' },
    market: { name: '시장 점포', material: 'metal', wallColor: '#b9b6ae', wwr: 0.2, win: 'punched', ground: 'shop', sign: 'cluttered', canopy: true, roof: 'gable' },
  };
  C.STYLE_ORDER = ['shop_old', 'shop_new', 'res_multi', 'apt', 'office', 'mixed', 'public', 'modern_brick', 'house', 'market'];

  /* 용도별 건축물 기본값 */
  C.BLD_DEFAULT = {
    res: { floors: 4, groundH: 3.0, floorH: 2.9, front: 2.0, side: 1.5, depth: 18, style: 'res_multi' },
    mixed: { floors: 6, groundH: 4.5, floorH: 3.0, front: 2.0, side: 1.0, depth: 20, style: 'mixed' },
    com: { floors: 5, groundH: 4.5, floorH: 3.6, front: 2.0, side: 1.0, depth: 22, style: 'shop_new' },
    off: { floors: 9, groundH: 5.0, floorH: 3.8, front: 3.0, side: 2.0, depth: 22, style: 'office' },
    pub: { floors: 3, groundH: 4.5, floorH: 4.0, front: 4.0, side: 3.0, depth: 0, style: 'public' },
    market: { floors: 1, groundH: 4.0, floorH: 3.0, front: 0.5, side: 0, depth: 0, style: 'market' },
  };
  /* 용도지역별 건폐율·용적률 상한: 서울특별시 도시계획 조례 제54조(건폐율)·제55조(용적률)의 값.
     용적률은 이 도구에서 800%를 넘지 않게 묶는다(중심상업지역 1,000% → 800%). 역사도심·지구단위계획 등 따로 정한 곳은 다를 수 있다 */
  C.FAR_CAP = 800;
  C.ZONES = {
    r1x: { name: '제1종 전용주거지역', bcr: 50, far: 100 },
    r2x: { name: '제2종 전용주거지역', bcr: 40, far: 120 },
    r1: { name: '제1종 일반주거지역', bcr: 60, far: 150 },
    r2: { name: '제2종 일반주거지역', bcr: 60, far: 200 },
    r3: { name: '제3종 일반주거지역', bcr: 50, far: 250 },
    rq: { name: '준주거지역', bcr: 60, far: 400 },
    cc: { name: '중심상업지역', bcr: 60, far: 800, far0: 1000 },
    cg: { name: '일반상업지역', bcr: 60, far: 800 },
    cn: { name: '근린상업지역', bcr: 60, far: 600 },
    cd: { name: '유통상업지역', bcr: 60, far: 600 },
    ix: { name: '전용공업지역', bcr: 60, far: 200 },
    ig: { name: '일반공업지역', bcr: 60, far: 200 },
    iq: { name: '준공업지역', bcr: 60, far: 400 },
    gc: { name: '보전녹지지역', bcr: 20, far: 50 },
    gp: { name: '생산녹지지역', bcr: 20, far: 50 },
    gn: { name: '자연녹지지역', bcr: 20, far: 50 },
  };
  C.ZONE_ORDER = ['r1x', 'r2x', 'r1', 'r2', 'r3', 'rq', 'cc', 'cg', 'cn', 'cd', 'ix', 'ig', 'iq', 'gc', 'gp', 'gn'];
  C.ZONE_REF = { bcr: '서울특별시 도시계획 조례 제54조', far: '서울특별시 도시계획 조례 제55조' };
  /* 블록에 용도지역을 따로 정하지 않았을 때 획지 용도로 가정하는 용도지역 */
  C.USE_ZONE = { res: 'r2', mixed: 'rq', com: 'cg', off: 'cg', pub: 'r2', market: 'cn' };
  C.zoneOf = (use, blockZone) => (blockZone && C.ZONES[blockZone] ? blockZone : C.USE_ZONE[use] || null);

  /* 맞벽: 구도심을 처음 만들 때는 양옆 벽이 붙은 맞벽 건물(옆·뒤 이격 0)도 두지만, 지우고 새로 짓는 건물은
     인접 대지경계선에서 이만큼 띄운다(학습용 값 · 민법 제242조, 건축법 제58조 대지 안의 공지 참고) */
  C.PARTY_MIN = 1.0;
  /* 용적률 맞춤에서 쓰는 유형별 최고 층수(학습용): 단독주택 3층, 다세대주택은 주택으로 쓰는 층수 4개 층 이하(건축법 시행령 별표1),
     공동주택 25층, 시장 점포 3층. 나머지 유형은 용도별 채우기 기본값의 최고 층수 */
  C.STYLE_FMAX = { house: 3, res_multi: 4, apt: 25, market: 3 };
  /* 단지: 넓은 획지 하나에 여러 동(공동주택 단지·캠퍼스). 이만큼 넓어야 고를 수 있다(학습용 값) */
  C.CX_MIN = { area: 3000, side: 45 };
  C.CX = {
    // 판상형 주동을 동서로 길게(남향) 줄지어: 동 깊이 14m, 같은 줄의 측벽 사이 8m(건축법 시행령 제86조제3항제2호마목은 4m 이상),
    // 줄 사이는 높이의 0.5배(서울특별시 건축 조례 제35조, 2022 개정)이면서 10m 이상(같은 호 나목), 주택으로 쓰는 층수 5개 층 이상(아파트, 건축법 시행령 별표 1)
    apt: { name: '공동주택 단지', depth: 14, slab: 54, slabMax: 70, gapSide: 8, rowK: 0.5, rowMin: 10, minF: 5 },
    // 가운데 마당을 두고 둘레에 동: 동 깊이 16m, 모서리는 10m 통로로 비우고, 긴 변(120m 넘음)은 가운데 12m 문을 둔다
    campus: { name: '캠퍼스', depth: 16, gap: 10, gate: 12, minF: 1 },
  };
  C.CX_ORDER = ['apt', 'campus'];
  C.fitFmax = (style, use) => C.STYLE_FMAX[style] || (C.FILL_DEFAULT[use] || { fmax: 20 }).fmax;

  /* 가구 자동 채우기의 학습용 기본값: 건폐율 상한(%) · 용적률 목표(%) · 최고 층수.
     서울특별시 도시계획 조례의 용도지역별 값에 맞춘다(용도지역 상한을 넘으면 그 상한으로 줄인다) */
  C.FILL_DEFAULT = {
    res: { bcr: 60, far: 200, fmax: 7 },     // 제2종 일반주거지역
    mixed: { bcr: 60, far: 400, fmax: 15 },  // 준주거지역
    com: { bcr: 60, far: 800, fmax: 20 },    // 일반상업지역
    off: { bcr: 60, far: 800, fmax: 20 },
    pub: { bcr: 50, far: 200, fmax: 5 },
    market: { bcr: 60, far: 200, fmax: 3 },
  };

  /* 수목. 수관폭·높이는 가로수로 자리 잡은 중간 크기 기준(처음 값의 0.8배) */
  C.TREES = {
    // 수관 폭·수고는 한 번 더 15% 줄인 값(2026-11). 지하고는 보행 높이 때문에 그대로 두되, 수고의 42%를 넘지 않게(소나무)
    zelkova: { name: '느티나무', crown: 5.4, height: 8.2, clear: 3.0, color: '#7FB392', shape: 'round', form: 'vase' },
    ginkgo: { name: '은행나무', crown: 3.4, height: 8.2, clear: 2.5, color: '#B3C48B', shape: 'cone', form: 'column' },
    chionanthus: { name: '이팝나무', crown: 3.7, height: 5.4, clear: 2.3, color: '#9CC7A6', shape: 'round', form: 'oval' },
    cherry: { name: '왕벚나무', crown: 4.4, height: 5.4, clear: 2.2, color: '#B8CFA6', shape: 'round', form: 'spread' },
    pine: { name: '소나무', crown: 3.4, height: 6.1, clear: 2.5, color: '#5C917A', shape: 'pine', form: 'pine' },
  };
  C.TREE_ORDER = ['zelkova', 'ginkgo', 'chionanthus', 'cherry', 'pine'];

  /* 가로시설물·자유 배치 요소 */
  C.OBJECTS = {
    tree: { name: '교목', group: 'green', icon: 'tree' },
    shrub: { name: '관목 군식', group: 'green', icon: 'shrub', r: 1.6 },
    light: { name: '가로등', group: 'furn', icon: 'light' },
    bench: { name: '벤치', group: 'furn', icon: 'bench' },
    busstop: { name: '버스정류장', group: 'furn', icon: 'bus' },
    bollard: { name: '볼라드', group: 'furn', icon: 'bollard' },
    bikerack: { name: '자전거 거치대', group: 'furn', icon: 'bike' },
    pm: { name: '공유 PM 주차구역', group: 'furn', icon: 'pm' },
    smartpole: { name: '스마트폴', group: 'furn', icon: 'smart' },
    transformer: { name: '지상기기(변압기)', group: 'furn', icon: 'box' },
    hydrant: { name: '소화전', group: 'furn', icon: 'hydrant' },
  };

  /* 지하시설 */
  C.UTIL = {
    water: { name: '상수관', color: '#4E8FC0', dia: 0.3, depth: 1.2 },
    sewer: { name: '오수관', color: '#a2845e', dia: 0.45, depth: 2.2 },
    storm: { name: '우수관', color: '#5FB2CC', dia: 0.8, depth: 1.8 },
    combined: { name: '합류식 하수관', color: '#8a6a45', dia: 0.9, depth: 2.0 },
    power: { name: '전력 관로', color: '#E0564A', dia: 0.4, depth: 1.0 },
    telecom: { name: '통신 관로', color: '#EE9A45', dia: 0.3, depth: 0.9 },
    gas: { name: '도시가스관', color: '#E3BC3A', dia: 0.2, depth: 1.2 },
    heat: { name: '지역난방관', color: '#A878C9', dia: 0.5, depth: 1.5 },
    tunnel: { name: '공동구', color: '#96918B', dia: 2.5, depth: 3.0, box: true },
  };
  C.UTIL_ORDER = ['water', 'sewer', 'storm', 'combined', 'power', 'telecom', 'gas', 'heat', 'tunnel'];

  /* 법정 기준(체크리스트 12장) */
  C.RULES = {
    sidewalk: { min: 2.0, minEx: 1.5, ref: '도로구조규칙 제16조' },
    curbH: { max: 0.25, ref: '도로구조규칙 제16조' },
    lane: (speed) => (speed >= 70 ? 3.25 : speed <= 40 ? 2.75 : 3.0),
    laneRef: '도로구조규칙 제10조',
    bike: { min: 1.5, minEx: 1.2, ref: '자전거이용시설 규칙 제5조' },
    parking: { min: 2.0, ref: '주차장법 시행규칙 제3조(평행주차 2.0×6.0m)' },
    ped: { min: 1.5, ref: '도시·군계획시설규칙 제9조' },
    block: { longMin: 90, longMax: 150, shortMin: 25, shortMax: 60, ref: '도시·군계획시설규칙 제10조' },
    park: { perCapita: 6, perCapitaUrban: 3, ref: '공원녹지법 시행규칙 제4조' },
    parkRoads: { min: 3, ref: '공원녹지법 시행규칙 제6조' },
    sun: { h: 10, near: 1.5, ref: '건축법 시행령 제86조' },
  };
})(typeof window !== 'undefined' ? window : globalThis);
