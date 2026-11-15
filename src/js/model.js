/* Urbify — 프로젝트 데이터 모델과 기본 대상지(도시 / 구도심 / 임의생성 / 빈 대상지) */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C;
  const M = (UDS.Model = {});

  M.VERSION = 1;

  M.defaultUtils = function (road, scheme) {
    const W = road.segs.reduce((s, g) => s + g.w, 0);
    const h = W / 2;
    const out = [];
    const add = (type, off, extra) => out.push({ id: U.uid('u'), type, off: U.round(off, 2), depth: C.UTIL[type].depth, dia: C.UTIL[type].dia, ...(extra || {}) });
    if (road.fn === 'pedestrian' || road.fn === 'shared') {
      // 관로 사이 0.3m 이상(학습용 기준)이 지켜지도록 벌려 놓음
      add('water', Math.min(2.2, h - 0.8));
      if (scheme === 'combined') add('combined', 0); else { add('sewer', -Math.min(1.2, h - 0.7)); add('storm', 0); }
      if (!road.overhead) add('power', -Math.min(2.4, h - 0.5));
      return out;
    }
    add('water', h - 1.3);
    add('gas', -(h - 1.4));
    if (scheme === 'combined') add('combined', 0.0);
    else { add('sewer', -1.0); add('storm', 1.5); }
    if (!road.overhead) { add('power', h - 0.6); add('telecom', -(h - 0.6)); }
    return out;
  };

  /* ---------- 단지 안 길의 모양: 사용자가 찍은 점(ctrl) → 중심선(pts) ----------
     'round': 꼭짓점마다 반지름 R의 원호(이웃 변 길이의 절반까지) · 'curve': 찍은 점을 지나는 곡선(구심 캣멀-롬을 3차 베지에로 바꿔 그림) */
  function roundPts(c, R) {
    const out = [c[0].slice()], n = c.length;
    for (let i = 1; i < n - 1; i++) {
      const p0 = c[i - 1], p = c[i], p1 = c[i + 1], L0 = U.dist(p0, p), L1 = U.dist(p, p1);
      if (L0 < 1e-6 || L1 < 1e-6) continue;
      const d0 = U.mul(U.sub(p, p0), 1 / L0), d1 = U.mul(U.sub(p1, p), 1 / L1);
      const th = Math.acos(U.clamp(U.dot(d0, d1), -1, 1)); // 꺾인 각
      if (th < 0.02 || th > Math.PI - 0.05) { out.push(p.slice()); continue; }
      const tan = Math.tan(th / 2);
      const t = Math.min(R * tan, i === 1 ? L0 * 0.9 : L0 * 0.5, i === n - 2 ? L1 * 0.9 : L1 * 0.5), r = t / tan;
      const T0 = U.sub(p, U.mul(d0, t)), T1 = U.add(p, U.mul(d1, t));
      const nrm = U.cross(d0, d1) > 0 ? U.perpL(d0) : U.perpR(d0), cc = U.add(T0, U.mul(nrm, r));
      U.arcPoints(cc, r, Math.atan2(T0[1] - cc[1], T0[0] - cc[0]), Math.atan2(T1[1] - cc[1], T1[0] - cc[0]), Math.max(2, Math.ceil(th / (Math.PI / 16)))).forEach((q) => out.push(q));
    }
    out.push(c[n - 1].slice());
    return out;
  }
  function curvePts(c) {
    const n = c.length, out = [c[0].slice()];
    const P = (i) => (i < 0 ? U.sub(U.mul(c[0], 2), c[1]) : i >= n ? U.sub(U.mul(c[n - 1], 2), c[n - 2]) : c[i]);
    for (let i = 0; i < n - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const d1 = Math.max(1e-4, Math.sqrt(U.dist(p0, p1))), d2 = Math.max(1e-4, Math.sqrt(U.dist(p1, p2))), d3 = Math.max(1e-4, Math.sqrt(U.dist(p2, p3)));
      const b1 = U.mul(U.add(U.sub(U.mul(p2, d1 * d1), U.mul(p0, d2 * d2)), U.mul(p1, 2 * d1 * d1 + 3 * d1 * d2 + d2 * d2)), 1 / (3 * d1 * (d1 + d2)));
      const b2 = U.mul(U.add(U.sub(U.mul(p1, d3 * d3), U.mul(p3, d2 * d2)), U.mul(p2, 2 * d3 * d3 + 3 * d3 * d2 + d2 * d2)), 1 / (3 * d3 * (d3 + d2)));
      const m = U.clamp(Math.ceil(U.dist(p1, p2) / 2.5), 3, 28);
      for (let k = 1; k <= m; k++) {
        const t = k / m, u = 1 - t;
        out.push([u * u * u * p1[0] + 3 * u * u * t * b1[0] + 3 * u * t * t * b2[0] + t * t * t * p2[0], u * u * u * p1[1] + 3 * u * u * t * b1[1] + 3 * u * t * t * b2[1] + t * t * t * p2[1]]);
      }
    }
    return out;
  }
  M.shapePts = function (r) {
    const c = r.ctrl;
    if (!c || c.length < 2) return r.pts;
    const pts = c.length < 3 || !r.shape || r.shape === 'line' ? c.map((p) => p.slice()) : r.shape === 'curve' ? curvePts(c) : roundPts(c, Math.max(0.5, +r.cornerR || 6));
    return pts.map((p) => [U.round(p[0], 3), U.round(p[1], 3)]);
  };
  /* 찍은 점이나 모양을 바꾼 뒤: 중심선을 다시 만든다(끝점은 찍은 점 그대로라 다른 길과 이어진 자리는 변하지 않는다) */
  M.reshape = function (r) { if (r && r.ctrl && r.ctrl.length >= 2) r.pts = M.shapePts(r); return r; };
  /* 편집할 꼭짓점: 단지 안 길은 찍은 점, 그 밖의 도로는 중심선 꼭짓점 */
  M.verts = (r) => (r.ctrl && r.ctrl.length >= 2 ? r.ctrl : r.pts);

  /* ---------- 수공간(조경) ----------
     circle {c, r} 원형 연못 · rect {c, w, h, rot(°), cr} 모서리가 둥근 사각 연못 · free {ctrl} 찍은 점을 지나는 닫힌 곡선(베지에)의 자유형 연못 ·
     river {ctrl, w} 찍은 점을 지나는 곡선을 중심선으로 한 폭 w의 하천(도로·길이 건너는 곳은 다리) */
  M.WATER = { circle: '원형 연못', rect: '둥근 사각 연못', free: '자유형 연못', river: '하천' };
  function closedCurve(c) {
    const n = c.length, out = [];
    const P = (i) => c[((i % n) + n) % n];
    for (let i = 0; i < n; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const d1 = Math.max(1e-4, Math.sqrt(U.dist(p0, p1))), d2 = Math.max(1e-4, Math.sqrt(U.dist(p1, p2))), d3 = Math.max(1e-4, Math.sqrt(U.dist(p2, p3)));
      const b1 = U.mul(U.add(U.sub(U.mul(p2, d1 * d1), U.mul(p0, d2 * d2)), U.mul(p1, 2 * d1 * d1 + 3 * d1 * d2 + d2 * d2)), 1 / (3 * d1 * (d1 + d2)));
      const b2 = U.mul(U.add(U.sub(U.mul(p1, d3 * d3), U.mul(p3, d2 * d2)), U.mul(p2, 2 * d3 * d3 + 3 * d3 * d2 + d2 * d2)), 1 / (3 * d3 * (d3 + d2)));
      const m = U.clamp(Math.ceil(U.dist(p1, p2) / 1.5), 4, 30);
      for (let k = 0; k < m; k++) {
        const t = k / m, u = 1 - t;
        out.push([u * u * u * p1[0] + 3 * u * u * t * b1[0] + 3 * u * t * t * b2[0] + t * t * t * p2[0], u * u * u * p1[1] + 3 * u * u * t * b1[1] + 3 * u * t * t * b2[1] + t * t * t * p2[1]]);
      }
    }
    return out;
  }
  /* 모양: {poly} (하천은 {poly, center, left, right}) */
  M.waterShape = function (w) {
    if (!w) return null;
    if (w.kind === 'circle') {
      const r = Math.max(0.5, +w.r || 5), n = U.clamp(Math.ceil((Math.PI * 2 * r) / 1.0), 24, 140), poly = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; poly.push([w.c[0] + Math.cos(a) * r, w.c[1] + Math.sin(a) * r]); }
      return { poly };
    }
    if (w.kind === 'rect') {
      const hx = Math.max(0.5, (+w.w || 16) / 2), hy = Math.max(0.5, (+w.h || 10) / 2), cr = U.clamp(+w.cr || 0, 0, Math.min(hx, hy) - 0.01);
      const a = ((+w.rot || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), poly = [];
      [[hx - cr, hy - cr, 0], [-hx + cr, hy - cr, 1], [-hx + cr, -hy + cr, 2], [hx - cr, -hy + cr, 3]].forEach(([x, y, k]) => {
        const m = cr > 0.05 ? 6 : 0;
        for (let i = 0; i <= m; i++) { const t = ((k + i / Math.max(1, m)) * Math.PI) / 2; poly.push([x + Math.cos(t) * cr, y + Math.sin(t) * cr]); }
      });
      return { poly: poly.map(([x, y]) => [w.c[0] + x * ca - y * sa, w.c[1] + x * sa + y * ca]) };
    }
    const c = (w.ctrl || []).filter((p, i, A) => i === 0 || U.dist(p, A[i - 1]) > 0.05);
    if (w.kind === 'free') return c.length >= 3 ? { poly: closedCurve(c) } : null;
    if (w.kind === 'river' && c.length >= 2) {
      const center = c.length >= 3 ? curvePts(c) : c.map((p) => p.slice()), hw = Math.max(0.5, (+w.w || 12) / 2);
      const left = U.offsetPolyline(center, hw), right = U.offsetPolyline(center, -hw);
      return { poly: left.concat(right.slice().reverse()), center, left, right };
    }
    return null;
  };
  /* 수공간의 기준점(옮기기·고르기): 원·사각형은 가운데, 곡선은 찍은 점들 */
  M.waterMove = function (w, d) {
    if (w.c) w.c = [U.round(w.c[0] + d[0], 2), U.round(w.c[1] + d[1], 2)];
    if (w.ctrl) w.ctrl = w.ctrl.map((p) => [U.round(p[0] + d[0], 2), U.round(p[1] + d[1], 2)]);
  };

  M.makeRoad = function (presetKey, pts, o) {
    const P = C.PRESETS[presetKey];
    const r = {
      id: U.uid('r'),
      name: (o && o.name) || P.name,
      preset: presetKey,
      fn: P.fn,
      pts: pts.map((p) => [p[0], p[1]]),
      segs: ((o && o.segs) || P.segs).map((s) => ({ id: U.uid('s'), type: s.type, w: s.w, ...(s.dir ? { dir: s.dir } : {}) })),
      speed: P.speed,
      curbH: 0.15,
      curbR: P.curbR,
      crosswalk: P.fn !== 'pedestrian' && P.fn !== 'shared',
      trees: { on: true, species: 'zelkova', spacing: 8 },
      lights: { on: true, spacing: 25 },
      overhead: false,
      utils: [],
    };
    if (o) {
      ['fn', 'speed', 'curbH', 'curbR', 'crosswalk', 'overhead'].forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; });
      if (o.trees) r.trees = { ...r.trees, ...o.trees };
      if (o.lights) r.lights = { ...r.lights, ...o.lights };
    }
    if (P.inner) {
      // 단지 안 길: 횡단보도·가로수·가로등·전주·지하시설 없음. 찍은 점(ctrl)으로 모양을 만든다
      r.inner = true; r.crosswalk = false; r.trees.on = false; r.lights.on = false; r.overhead = false;
      r.shape = (o && o.shape) || P.shape || 'line'; r.cornerR = (o && o.cornerR) || P.cornerR || 6;
      r.ctrl = r.pts.map((p) => p.slice());
      M.reshape(r);
      r.utils = [];
      return r;
    }
    r.utils = M.defaultUtils(r, (o && o.scheme) || 'separate');
    return r;
  };

  M.newBlock = function (seed, o) {
    return {
      id: U.uid('b'),
      seed: [seed[0], seed[1]],
      use: 'res',
      lotsAlong: 4,
      lotRows: 2,
      chamfer: null,
      parkType: 'neighborhood',
      vary: 0.25,
      styleVary: false,
      bld: {},
      lots: {},
      ...(o || {}),
    };
  };

  M.newProject = function (scene) {
    return {
      meta: { title: '새 계획', scene, version: M.VERSION, defaultUse: 'res', scheme: 'separate' },
      site: { w: 400, h: 300 },
      settings: { m2PerPerson: 35, season: 'winter', doy: 356, hour: 12, lat: 36.6, urbanPark: false },
      roads: [],
      blocks: [],
      objects: [],
      waters: [],
    };
  };

  /* 맞벽 건축(구도심을 처음 만들 때만): 한 줄에서 이웃한 획지 i0~i1의 옆·뒤 이격을 0으로 두어 양옆 벽이 붙게 한다.
     용도를 따로 정해 둔 획지(빈 터·주차장)는 건너뛴다. 지우고 새로 짓는 건물은 맞벽이 되지 않는다(C.PARTY_MIN) */
  function partyRun(lots, row, i0, i1) {
    for (let i = i0; i <= i1; i++) { const k = row + ':' + i; if (!lots[k]) lots[k] = { bld: { side: 0 } }; }
    return lots;
  }

  /* ① 가상 표준 지구(신시가지형) */
  /* 기본 장면은 열 때마다 같은 모습이 되도록 식별자를 고정(건물 층수 변화·입면 무작위가 식별자를 씨앗으로 씀) */
  function fixIds(P, tag) {
    P.roads.forEach((r, i) => { r.id = `r_${tag}${i}`; r.segs.forEach((g, j) => { g.id = `s_${tag}${i}_${j}`; }); (r.utils || []).forEach((u, j) => { u.id = `u_${tag}${i}_${j}`; }); });
    P.blocks.forEach((b, i) => { b.id = `b_${tag}${i}`; });
    P.objects.forEach((o, i) => { o.id = `o_${tag}${i}`; });
    return P;
  }

  M.sceneStandard = function () {
    const P = M.newProject('standard');
    P.meta.title = '도시(가상)';
    P.meta.scheme = 'separate';
    P.settings.lat = 37.5; // 도시는 서울 위도
    P.site = { w: 420, h: 300 };
    const R = (k, pts, o) => P.roads.push(M.makeRoad(k, pts, o));
    R('dae3', [[0, 0], [420, 0]], { name: '남측 간선도로', trees: { species: 'zelkova', spacing: 9 } });
    R('jung3', [[0, 300], [420, 300]], {
      name: '북측 보조간선도로', fn: 'subarterial', speed: 50,
      segs: [{ type: 'sidewalk', w: 3.0 }, { type: 'furniture', w: 1.5 }, { type: 'lane', w: 3.0, dir: -1 }, { type: 'lane', w: 3.0, dir: 1 }, { type: 'furniture', w: 1.5 }, { type: 'sidewalk', w: 3.0 }],
      trees: { species: 'ginkgo', spacing: 8 },
    });
    R('jung3', [[0, 0], [0, 300]], { name: '서측 집산도로', trees: { species: 'chionanthus' } });
    R('jung3', [[420, 0], [420, 300]], { name: '동측 집산도로', trees: { species: 'chionanthus' } });
    R('jung2', [[210, 0], [210, 300]], { name: '중앙 집산도로(자전거)', trees: { species: 'zelkova', spacing: 8 } });
    R('so1', [[0, 75], [420, 75]], { name: '국지도로 1', trees: { on: false } });
    R('so1', [[0, 150], [105, 150]], { name: '국지도로 2', trees: { on: false } });
    R('ped8', [[210, 150], [315, 150]], { name: '보행자전용도로', trees: { species: 'cherry', spacing: 7 } });
    R('so1', [[315, 150], [420, 150]], { name: '국지도로 3', trees: { on: false } });
    R('so1', [[0, 225], [420, 225]], { name: '국지도로 4', trees: { on: false } });
    R('so1', [[105, 0], [105, 300]], { name: '국지도로 5', trees: { on: false } });
    R('so1', [[315, 0], [315, 300]], { name: '국지도로 6', trees: { on: false } });

    const B = (seed, o) => P.blocks.push(M.newBlock(seed, o));
    // 신도시: 획지마다 용도지역(서울시 조례)의 용적률을 채우는 층수로, 그 층수에서 건폐율이 가장 크게 짓는다(fit: 'far')
    const FIT = { fit: 'far' };
    B([52.5, 37.5], { use: 'com', lotsAlong: 3, lotRows: 2, bld: { ...FIT } });
    B([157.5, 37.5], { use: 'off', lotsAlong: 2, lotRows: 2, bld: { ...FIT } });
    B([262.5, 37.5], { use: 'off', lotsAlong: 2, lotRows: 2, bld: { ...FIT } });
    B([367.5, 37.5], { use: 'com', lotsAlong: 3, lotRows: 2, bld: { ...FIT } });
    B([52.5, 112.5], { use: 'res', lotsAlong: 4, lotRows: 2, vary: 0, bld: { ...FIT } });
    B([157.5, 150], { use: 'park', parkType: 'neighborhood', lotsAlong: 1, lotRows: 1, bld: { ...FIT } }); // 획지 용도를 바꿔 건물을 세워도 용적률 최대로
    B([262.5, 112.5], { use: 'mixed', lotsAlong: 3, lotRows: 2, bld: { ...FIT } });
    B([367.5, 112.5], { use: 'res', lotsAlong: 4, lotRows: 2, vary: 0, bld: { ...FIT } });
    B([52.5, 187.5], { use: 'res', zone: 'r3', lotsAlong: 1, lotRows: 1, vary: 0, bld: { style: 'apt', side: 7.5, front: 4, depth: 14, cx: 'apt', ...FIT } }); // 공동주택 단지: 한 획지에 판상형 여러 동
    B([262.5, 187.5], { use: 'res', lotsAlong: 2, lotRows: 1, vary: 0, bld: { style: 'apt', side: 7.5, front: 4, depth: 14, ...FIT } });
    B([367.5, 187.5], { use: 'res', lotsAlong: 4, lotRows: 2, vary: 0, bld: { ...FIT } });
    B([52.5, 262.5], { use: 'res', lotsAlong: 4, lotRows: 2, vary: 0, bld: { ...FIT } });
    B([157.5, 262.5], { use: 'pub', lotsAlong: 2, lotRows: 1, bld: { ...FIT } });
    B([262.5, 262.5], { use: 'mixed', lotsAlong: 3, lotRows: 2, bld: { ...FIT } });
    B([367.5, 262.5], { use: 'res', lotsAlong: 3, lotRows: 1, vary: 0, bld: { ...FIT }, lots: { '0:2': { use: 'park', parkType: 'children' } } });

    const O = (type, x, y, o) => P.objects.push({ id: U.uid('o'), type, x, y, rot: 0, ...(o || {}) });
    O('busstop', 70, 9.6, { rot: 0 });
    O('busstop', 350, -9.6, { rot: Math.PI });
    O('bikerack', 214.8, 120, { rot: Math.PI / 2 });
    O('pm', 205.2, 186, { rot: Math.PI / 2 });
    return fixIds(P, 'st');
  };

  /* ② 지방 구도심(정비형) */
  M.sceneOldtown = function () {
    const P = M.newProject('oldtown');
    P.meta.title = '구도심(가상)';
    P.meta.scheme = 'combined';
    P.site = { w: 360, h: 260 };
    const old = { overhead: true, trees: { on: false }, scheme: 'combined' };
    const R = (k, pts, o) => P.roads.push(M.makeRoad(k, pts, { ...old, ...(o || {}) }));
    const s10 = [{ type: 'sidewalk', w: 1.5 }, { type: 'lane', w: 3.5, dir: -1 }, { type: 'lane', w: 3.5, dir: 1 }, { type: 'sidewalk', w: 1.5 }];
    const s12 = [{ type: 'sidewalk', w: 2.0 }, { type: 'lane', w: 3.0, dir: -1 }, { type: 'lane', w: 3.0, dir: 1 }, { type: 'parking', w: 2.0 }, { type: 'sidewalk', w: 2.0 }];
    R('so1', [[0, 0], [360, 0]], { name: '남측 도로', segs: s10 });
    R('so1', [[0, 260], [360, 260]], { name: '북측 도로', segs: s10 });
    R('jung3', [[0, 0], [0, 260]], { name: '서측 도로', segs: s12 });
    R('so1', [[360, 0], [360, 260]], { name: '동측 도로', segs: s10 });
    R('jung3', [[0, 130], [360, 130]], {
      name: '역전로(중심 상가가로)',
      segs: [{ type: 'sidewalk', w: 1.8 }, { type: 'parking', w: 2.0 }, { type: 'lane', w: 3.2, dir: -1 }, { type: 'lane', w: 3.2, dir: 1 }, { type: 'sidewalk', w: 1.8 }],
    });
    R('jung3', [[150, 0], [150, 260]], { name: '시장길', segs: s12 });
    const A = (pts, name) => R('shared6', pts, { name, overhead: false });
    A([[70, 0], [70, 130]], '골목길 1');
    A([[95, 130], [95, 260]], '골목길 2');
    A([[230, 0], [230, 130]], '골목길 3');
    A([[290, 130], [290, 260]], '골목길 4');
    A([[0, 70], [150, 70]], '골목길 5');
    A([[150, 195], [360, 195]], '골목길 6');
    A([[230, 60], [360, 95]], '옛길(사선)');
    A([[0, 195], [95, 195]], '골목길 7');

    const B = (seed, o) => P.blocks.push(M.newBlock(seed, { vary: 0.35, ...o }));
    const shop = { use: 'mixed', styleVary: true, bld: { style: 'shop_old', floors: 3, groundH: 4.0, floorH: 3.0, front: 0, side: 0, depth: 14 } };
    const house = { use: 'res', styleVary: true, bld: { style: 'house', floors: 2, groundH: 3.0, floorH: 2.8, front: 1.5, side: 1.0, depth: 12 } };
    const multi = { use: 'res', styleVary: true, bld: { style: 'res_multi', floors: 4, groundH: 3.0, floorH: 2.8, front: 1.0, side: 0.8 } };
    const wall = (o) => ({ ...o, bld: { ...o.bld, side: 0 } }); // 가구 전체 맞벽(상가·시장은 처음부터 맞벽)
    B([35, 35], { ...house, lotsAlong: 4, lots: partyRun(partyRun({}, 0, 1, 3), 1, 0, 1) });
    B([35, 100], { ...shop, lotsAlong: 4 });
    B([110, 35], { ...wall(multi), lotsAlong: 5, lots: { '0:1': { use: 'vacant' }, '1:3': { use: 'parking' } } });
    B([110, 100], { ...shop, lotsAlong: 5 });
    B([190, 65], { use: 'market', styleVary: true, lotsAlong: 6, lotRows: 2, bld: { style: 'market', floors: 1, groundH: 4.0, front: 0, side: 0 } });
    B([300, 25], { ...multi, lotsAlong: 6, lots: partyRun(partyRun({}, 0, 2, 4), 1, 0, 2) });
    B([300, 110], { ...shop, lotsAlong: 6 });
    B([47, 162], { ...shop, lotsAlong: 5 });
    B([47, 228], { ...wall(house), lotsAlong: 4 });
    B([122, 195], { use: 'pub', lotsAlong: 3, lotRows: 1, bld: { style: 'modern_brick', floors: 2, groundH: 4.2, floorH: 3.8, front: 4, side: 2 }, lots: { '0:0': { use: 'park', parkType: 'pocket' } } });
    B([220, 162], { ...shop, lotsAlong: 6 });
    B([220, 228], { ...multi, lotsAlong: 6, lots: partyRun(partyRun({}, 0, 0, 2), 1, 3, 5) });
    B([325, 162], { ...shop, lotsAlong: 3 });
    B([325, 228], { ...house, lotsAlong: 3 });

    const O = (type, x, y, o) => P.objects.push({ id: U.uid('o'), type, x, y, rot: 0, ...(o || {}) });
    O('busstop', 200, 136.5, { rot: 0 });
    O('transformer', 120, 123.6, { rot: 0 });
    O('transformer', 265, 136.4, { rot: 0 });
    return fixIds(P, 'ot');
  };

  /* ③ 임의생성(가상): 씨앗(seed) 하나로 도로망·가구 용도·건물 유형을 만든다. 같은 씨앗이면 언제나 같은 대상지가 나온다.
     가로줄·세로줄을 흔들어 놓은 격자에서 출발해 ① 안쪽 구간 몇 개를 지워 큰 가구(공원·학교 자리)를 만들고
     ② 둘레 한 변에 간선, 가운데에 집산도로를 두고 ③ 간선·집산도로와의 거리로 용도를 나눈다. 유형은 격자형·변형 격자형·구도심형 */
  /* family: 'new' 도시(격자형·변형 격자형) · 'old' 구도심형 · 그 밖은 셋 가운데 하나 */
  M.sceneRandom = function (seed, family) {
    seed = seed === undefined || seed === null ? (((Date.now() % 2147483647) ^ Math.floor(Math.random() * 2147483647)) >>> 0) : seed >>> 0;
    const rnd = U.rng(seed);
    const rr = (a, b) => a + (b - a) * rnd();
    const ri = (a, b) => Math.min(b, Math.floor(rr(a, b + 1)));
    const pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];
    const chance = (q) => rnd() < q;
    let kind = pick(['grid', 'grid', 'organic', 'organic', 'old']);
    if (family === 'old') kind = 'old'; else if (family === 'new' && kind === 'old') kind = 'organic';
    const old = kind === 'old';
    const P = M.newProject('random');
    P.meta.title = family === 'old' ? '구도심(임의생성)' : family === 'new' ? '도시(임의생성)' : '임의생성(가상)'; P.meta.seed = seed; P.meta.pattern = kind;
    if (family) P.meta.family = family;
    P.settings.lat = old ? 36.6 : 37.5; // 도시형은 서울, 구도심형은 충청 위도
    P.meta.scheme = old ? 'combined' : 'separate';
    const W = Math.round(rr(old ? 320 : 380, old ? 400 : 480) / 10) * 10, H = Math.round(rr(old ? 240 : 270, old ? 300 : 340) / 10) * 10;
    P.site = { w: W, h: H };
    const nx = U.clamp(Math.round(W / (old ? rr(62, 84) : rr(88, 118))), 3, 6), ny = U.clamp(Math.round(H / (old ? rr(56, 72) : rr(68, 92))), 3, 5);
    // 줄의 양 끝 위치: 균등 간격에서 조금 흔들고(jit), 변형 격자·구도심은 양 끝을 서로 다르게 틀어(skew) 길이 평행하지 않게 한다
    const jit = kind === 'grid' ? 0.1 : 0.15, skew = kind === 'grid' ? 0 : old ? 9 : 7;
    const lines = (n, L) => { const a = [0], b = [0]; for (let i = 1; i < n; i++) { const base = (L * i) / n + rr(-jit, jit) * (L / n), sk = skew ? rr(-skew, skew) : 0; a.push(base - sk); b.push(base + sk); } a.push(L); b.push(L); return [a, b]; };
    const [xb, xt] = lines(nx, W), [yl, yr] = lines(ny, H);
    const X = []; // X[i][j] = 세로줄 i와 가로줄 j가 만나는 점
    for (let i = 0; i <= nx; i++) {
      X.push([]);
      for (let j = 0; j <= ny; j++) { const q = U.lineIntersect([xb[i], 0], [xt[i] - xb[i], H], [0, yl[j]], [W, yr[j] - yl[j]]); X[i].push([U.round(U.clamp(q[0], 0, W), 2), U.round(U.clamp(q[1], 0, H), 2)]); }
    }
    // 위계: 둘레 한 변은 간선, 가운데 세로줄·가로줄은 집산, 나머지는 국지·보행자우선
    const vK = [], hK = [];
    const mv = old ? ri(1, nx - 1) : Math.round(nx / 2), mh = old ? ri(1, ny - 1) : Math.round(ny / 2);
    const art = old ? 'W' : pick(['S', 'S', 'N', 'W', 'E']);
    if (old) {
      hK[0] = 'so1'; hK[ny] = 'so1'; vK[0] = 'jung3'; vK[nx] = 'so1';
      for (let i = 1; i < nx; i++) vK[i] = i === mv ? 'jung3' : 'shared6';
      for (let j = 1; j < ny; j++) hK[j] = j === mh ? 'jung3' : pick(['shared6', 'shared6', 'so1']);
    } else {
      const per = (side) => (side === art ? pick(['dae3', 'dae3', 'jung1']) : pick(['jung3', 'jung3', 'jung2', 'jung1']));
      hK[0] = per('S'); hK[ny] = per('N'); vK[0] = per('W'); vK[nx] = per('E');
      for (let i = 1; i < nx; i++) vK[i] = i === mv ? pick(['jung2', 'jung2', 'jung3']) : pick(['so1', 'so1', 'so1', 'shared8']);
      for (let j = 1; j < ny; j++) hK[j] = j === mh ? pick(['jung3', 'so1', 'jung2']) : pick(['so1', 'so1', 'so1', 'shared8']);
    }
    // 구간별 유형. vS[i][j] = 세로줄 i의 j~j+1 구간, hS[j][i] = 가로줄 j의 i~i+1 구간 (null = 지운 구간)
    const vS = vK.map((k) => Array.from({ length: ny }, () => k)), hS = hK.map((k) => Array.from({ length: nx }, () => k));
    // 안쪽 구간을 지워 두 칸을 하나의 큰 가구로. 한 교차점에서 두 구간을 지우지 않고, 중심축은 끊지 않는다
    const busy = new Set(), cellUsed = new Set(), big = [];
    const want = old ? ri(0, 1) : ri(1, 3);
    for (let t = 0; t < 60 && big.length < want; t++) {
      if (chance(0.5)) {
        const i = ri(1, nx - 1), j = ri(0, ny - 1), a = i + ':' + j, b = i + ':' + (j + 1), c1 = (i - 1) + ':' + j, c2 = i + ':' + j;
        if (i === mv || busy.has(a) || busy.has(b) || cellUsed.has(c1) || cellUsed.has(c2)) continue;
        vS[i][j] = null; busy.add(a); busy.add(b); cellUsed.add(c1); cellUsed.add(c2);
        big.push({ cells: [[i - 1, j], [i, j]], seed: U.mid(X[i][j], X[i][j + 1]), dir: 'x' });
      } else {
        const j = ri(1, ny - 1), i = ri(0, nx - 1), a = i + ':' + j, b = (i + 1) + ':' + j, c1 = i + ':' + (j - 1), c2 = i + ':' + j;
        if (j === mh || busy.has(a) || busy.has(b) || cellUsed.has(c1) || cellUsed.has(c2)) continue;
        hS[j][i] = null; busy.add(a); busy.add(b); cellUsed.add(c1); cellUsed.add(c2);
        big.push({ cells: [[i, j - 1], [i, j]], seed: U.mid(X[i][j], X[i + 1][j]), dir: 'y' });
      }
    }
    // 신시가지형은 안쪽 국지도로 한 구간을 보행자전용도로로(큰 가구 옆이면 더 좋다)
    if (!old && chance(0.7)) {
      for (let t = 0; t < 30; t++) {
        const i = ri(1, nx - 1), j = ri(0, ny - 1);
        if (i !== mv && (vS[i][j] === 'so1' || vS[i][j] === 'shared8')) { vS[i][j] = 'ped8'; break; }
      }
    }
    // 도로 만들기: 같은 유형이 이어지는 구간을 한 도로로
    const oldO = { overhead: true, trees: { on: false }, scheme: 'combined' };
    const s10 = [{ type: 'sidewalk', w: 1.5 }, { type: 'lane', w: 3.5, dir: -1 }, { type: 'lane', w: 3.5, dir: 1 }, { type: 'sidewalk', w: 1.5 }];
    const s12 = [{ type: 'sidewalk', w: 2.0 }, { type: 'lane', w: 3.0, dir: -1 }, { type: 'lane', w: 3.0, dir: 1 }, { type: 'parking', w: 2.0 }, { type: 'sidewalk', w: 2.0 }];
    const cnt = {};
    const nm = (base) => { cnt[base] = (cnt[base] || 0) + 1; return base + ' ' + cnt[base]; };
    const addRoad = (k, a, b, where) => {
      const o = {};
      const side = where.per ? { S: '남측', N: '북측', W: '서측', E: '동측' }[where.per] + ' ' : '';
      if (old) {
        Object.assign(o, oldO);
        if (k === 'so1') { o.segs = s10; o.name = side ? side + '도로' : nm('이면도로'); }
        else if (k === 'jung3') { o.segs = s12; o.name = side ? side + '도로' : where.main === 'v' ? '중심 가로(상가)' : '시장길'; }
        else { o.overhead = false; o.name = nm('골목길'); }
      } else if (k === 'dae3') { o.name = side + '간선도로'; o.trees = { species: 'zelkova', spacing: 9 }; }
      else if (k === 'jung1') { o.name = side ? side + '보조간선도로' : nm('보조간선도로'); o.trees = { species: 'ginkgo', spacing: 8 }; }
      else if (k === 'jung2' || k === 'jung3') { o.name = side ? side + '집산도로' : where.main === 'v' ? '중앙 집산도로' : nm('집산도로'); o.trees = { species: pick(['zelkova', 'chionanthus', 'ginkgo']), spacing: 8 }; }
      else if (k === 'so1') { o.name = nm('국지도로'); o.trees = chance(0.3) ? { species: pick(['cherry', 'chionanthus']), spacing: 8 } : { on: false }; }
      else if (k === 'ped8') { o.name = '보행자전용도로'; o.trees = { species: 'cherry', spacing: 7 }; }
      else { o.name = nm('보행자우선도로'); o.trees = { on: false }; }
      P.roads.push(M.makeRoad(k, [a, b], o));
    };
    const runs = (segs, at, where) => {
      let j0 = 0;
      for (let j = 1; j <= segs.length; j++) {
        if (j < segs.length && segs[j] === segs[j0]) continue;
        if (segs[j0]) addRoad(segs[j0], at(j0), at(j), where);
        j0 = j;
      }
    };
    for (let j = 0; j <= ny; j++) runs(hS[j], (i) => X[i][j], { per: j === 0 ? 'S' : j === ny ? 'N' : '', main: j === mh ? 'h' : '' });
    for (let i = 0; i <= nx; i++) runs(vS[i], (j) => X[i][j], { per: i === 0 ? 'W' : i === nx ? 'E' : '', main: i === mv ? 'v' : '' });

    // 가구: 칸마다(합친 칸은 한 번) 둘레 도로의 위계로 용도를 정한다
    const cen = (i, j) => { const q = [X[i][j], X[i + 1][j], X[i + 1][j + 1], X[i][j + 1]]; return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4]; };
    const dim = (i, j) => [(U.dist(X[i][j], X[i + 1][j]) + U.dist(X[i][j + 1], X[i + 1][j + 1])) / 2, (U.dist(X[i][j], X[i][j + 1]) + U.dist(X[i + 1][j], X[i + 1][j + 1])) / 2];
    const rank = (k) => (k === 'dae3' || k === 'jung1' ? 3 : k === 'jung2' || k === 'jung3' ? 2 : k === 'so1' ? 1 : 0);
    const blocks = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if (cellUsed.has(i + ':' + j)) continue;
      const [w, h] = dim(i, j);
      blocks.push({ seed: cen(i, j), long: Math.max(w, h) - 12, short: Math.min(w, h) - 12, top: Math.max(rank(hK[j]), rank(hK[j + 1]), rank(vK[i]), rank(vK[i + 1])), main: (i === mv - 1 || i === mv) || (!old && (j === mh - 1 || j === mh)), art: (art === 'S' && j === 0) || (art === 'N' && j === ny - 1) || (art === 'W' && i === 0) || (art === 'E' && i === nx - 1) });
    }
    big.forEach((g) => {
      const [a, b] = g.cells, d1 = dim(a[0], a[1]), d2 = dim(b[0], b[1]);
      const w = g.dir === 'x' ? d1[0] + d2[0] : (d1[0] + d2[0]) / 2, h = g.dir === 'x' ? (d1[1] + d2[1]) / 2 : d1[1] + d2[1];
      blocks.push({ seed: g.seed, long: Math.max(w, h) - 12, short: Math.min(w, h) - 12, big: true, top: 0, main: false, art: false });
    });
    const B = (bk, o) => P.blocks.push(M.newBlock(bk.seed, o));
    const along = (bk, per, min) => U.clamp(Math.round(bk.long / per), min || 1, 12);
    const rows = (bk) => (bk.short >= 44 ? 2 : 1);
    const mid = [W / 2, H / 2];
    const bigs = blocks.filter((b) => b.big).sort((a, b) => U.dist(a.seed, mid) - U.dist(b.seed, mid));
    const rest = blocks.filter((b) => !b.big);
    if (old) {
      const shop = { use: 'mixed', styleVary: true, vary: 0.35, bld: { style: 'shop_old', floors: 3, groundH: 4.0, floorH: 3.0, front: 0, side: 0, depth: 14 } };
      const house = { use: 'res', styleVary: true, vary: 0.35, bld: { style: 'house', floors: 2, groundH: 3.0, floorH: 2.8, front: 1.5, side: 1.0, depth: 12 } };
      const multi = { use: 'res', styleVary: true, vary: 0.35, bld: { style: 'res_multi', floors: 4, groundH: 3.0, floorH: 2.8, front: 1.0, side: 0.8 } };
      // 맞벽 건축: 주거 가구의 약 30%는 가구 전체, 40%는 한 줄에 2~4획지씩 이어서(도로망·용도 배치와 다른 난수열을 써서 같은 씨앗의 배치는 그대로)
      const rp = U.rng((seed ^ 0x5bd1e995) >>> 0), pri = (a, b) => a + Math.floor(rp() * (b - a + 1));
      const party = (o, n, nr, lots) => {
        const q = rp();
        if (q < 0.3) return { ...o, bld: { ...o.bld, side: 0 }, lots };
        if (q < 0.7) for (let r = 0; r < nr; r++) { const k = Math.min(n, pri(2, 4)), i0 = pri(0, n - k); partyRun(lots, r, i0, i0 + k - 1); }
        return { ...o, lots };
      };
      bigs.forEach((bk, n) => {
        if (n === 0) B(bk, { use: 'pub', lotsAlong: 3, lotRows: 1, bld: { style: 'modern_brick', floors: 2, groundH: 4.2, floorH: 3.8, front: 4, side: 2 }, lots: { '0:0': { use: 'park', parkType: 'pocket' } } });
        else { const na = along(bk, 16, 3); B(bk, { ...party(multi, na, rows(bk), {}), lotsAlong: na, lotRows: rows(bk) }); }
      });
      const mains = rest.filter((b) => b.main).sort((a, b) => U.dist(a.seed, mid) - U.dist(b.seed, mid));
      let market = false, pub = bigs.length > 0;
      rest.forEach((bk) => {
        const n = along(bk, 15, 3);
        if (bk === mains[0] && !market) { market = true; B(bk, { use: 'market', styleVary: true, vary: 0.35, lotsAlong: along(bk, 12, 4), lotRows: 2, bld: { style: 'market', floors: 1, groundH: 4.0, front: 0, side: 0 } }); return; }
        if (bk.main) { B(bk, { ...shop, lotsAlong: along(bk, 13, 3), lotRows: rows(bk) }); return; }
        if (!pub && chance(0.25)) { pub = true; B(bk, { use: 'pub', vary: 0.35, lotsAlong: Math.min(3, n), lotRows: 1, bld: { style: 'modern_brick', floors: 2, groundH: 4.2, floorH: 3.8, front: 4, side: 2 }, lots: { '0:0': { use: 'park', parkType: 'pocket' } } }); return; }
        const o = chance(0.55) ? house : multi, lots = {};
        if (chance(0.45)) lots['0:' + ri(0, n - 1)] = { use: pick(['vacant', 'parking']) };
        if (rows(bk) > 1 && chance(0.3)) lots['1:' + ri(0, n - 1)] = { use: pick(['vacant', 'parking']) };
        B(bk, { ...party(o, n, rows(bk), lots), lotsAlong: n, lotRows: rows(bk) });
      });
    } else {
      const FIT = { fit: 'far' }; // 신도시: 용적률을 채우는 층수, 그 층수에서 가장 큰 건폐율
      // 단지 하나(한 획지에 여러 동): 큰 가구의 아파트 자리가 있으면 공동주택 단지로, 공공 큰 가구는 가끔 캠퍼스로, 둘 다 없으면 넉넉한 주거 가구 하나를.
      // 다른 배치와 다른 난수열을 써서 같은 씨앗의 도로망·용도 배치는 그대로
      const rc = U.rng((seed ^ 0x2c1b3c6d) >>> 0);
      const CXAPT = { use: 'res', zone: 'r3', lotsAlong: 1, lotRows: 1, vary: 0, bld: { style: 'apt', side: 7.5, front: 4, depth: 14, cx: 'apt', ...FIT } };
      let cxDone = false;
      bigs.forEach((bk, n) => {
        if (n === 0) B(bk, { use: 'park', parkType: bk.long * bk.short >= 10000 ? 'neighborhood' : 'children', lotsAlong: 1, lotRows: 1, bld: { ...FIT } });
        else if (n === 1) {
          if (bigs.length < 3 && rc() < 0.4) { cxDone = true; B(bk, { use: 'pub', lotsAlong: 1, lotRows: 1, bld: { cx: 'campus', ...FIT } }); } // 캠퍼스: 가운데 마당 둘레에 여러 동
          else B(bk, { use: 'pub', lotsAlong: 2, lotRows: 1, bld: { ...FIT } });
        } else if (!cxDone) { cxDone = true; B(bk, CXAPT); }
        else B(bk, { use: 'res', zone: 'r3', lotsAlong: along(bk, 60, 2), lotRows: 1, vary: 0, bld: { style: 'apt', side: 7.5, front: 4, depth: 14, ...FIT } }); // 판상형 고층 아파트(제3종 일반주거)
      });
      let pub = bigs.length > 1, park = bigs.length > 0;
      const order = rest.slice().sort((a, b) => U.dist(a.seed, mid) - U.dist(b.seed, mid));
      const cxBk = cxDone ? null : rest.filter((bk) => !bk.art && !bk.main && (park || bk !== order[0]) && bk.long >= 70 && bk.short >= 50).sort((a, b) => b.long * b.short - a.long * a.short)[0] || null;
      rest.forEach((bk) => {
        if (bk === cxBk) { B(bk, CXAPT); return; }
        if (bk.art) { const off = chance(0.5); B(bk, off ? { use: 'off', lotsAlong: along(bk, 46, 2), lotRows: rows(bk), bld: { ...FIT } } : { use: 'com', lotsAlong: along(bk, 32, 2), lotRows: rows(bk), bld: { ...FIT } }); return; }
        if (!park && bk === order[0]) { park = true; B(bk, { use: 'park', parkType: bk.long * bk.short >= 10000 ? 'neighborhood' : 'children', lotsAlong: 1, lotRows: 1, bld: { ...FIT } }); return; }
        if (!pub && !bk.main && chance(0.22)) { pub = true; B(bk, { use: 'pub', lotsAlong: 2, lotRows: 1, bld: { ...FIT } }); return; }
        if (bk.main && chance(0.6)) { B(bk, { use: 'mixed', lotsAlong: along(bk, 32, 2), lotRows: rows(bk), bld: { ...FIT } }); return; }
        if (chance(0.3)) { B(bk, { use: 'res', zone: 'r3', lotsAlong: along(bk, 48, 2), lotRows: 1, vary: 0, bld: { style: 'apt', side: 7.5, front: 4, depth: 14, ...FIT } }); return; }
        const n = along(bk, 24, 3), lots = {};
        if (chance(0.18)) lots['0:' + ri(0, n - 1)] = { use: 'park', parkType: 'children' };
        B(bk, { use: 'res', lotsAlong: n, lotRows: rows(bk), vary: chance(0.5) ? 0 : 0.2, bld: { ...FIT }, lots });
      });
    }
    // 가로시설물: 가장 위계가 높은 둘레 도로에 버스정류장 둘(서로 맞은편), 구도심형은 지상 변압기 하나
    const O = (type, x, y, o) => P.objects.push({ id: U.uid('o'), type, x: U.round(x, 2), y: U.round(y, 2), rot: 0, ...(o || {}) });
    const sideLine = { S: [X[0][0], X[nx][0]], N: [X[0][ny], X[nx][ny]], W: [X[0][0], X[0][ny]], E: [X[nx][0], X[nx][ny]] }[art];
    const artK = { S: hK[0], N: hK[ny], W: vK[0], E: vK[nx] }[art];
    const halfW = C.PRESETS[artK].segs.reduce((a, g) => a + g.w, 0) / 2;
    const stop = (t, sgn) => {
      const a = sideLine[0], b = sideLine[1], d = U.norm(U.sub(b, a)), n = [-d[1] * sgn, d[0] * sgn];
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], off = Math.max(2.4, halfW - 2.9);
      O('busstop', q[0] + n[0] * off, q[1] + n[1] * off, { rot: U.round(Math.atan2(-n[1], -n[0]) + Math.PI / 2, 3) });
    };
    if (rank(artK) >= 2) { stop(rr(0.22, 0.32), 1); stop(rr(0.66, 0.78), -1); }
    return fixIds(P, 'rn' + seed.toString(36) + '_');
  };

  /* ④ 빈 대상지: 크기만 정해 두고 도로부터 직접 그린다. 도로를 그려 생기는 가구는 빈 터(나대지)로 시작한다 */
  M.sceneBlank = function (w, h) {
    const P = M.newProject('blank');
    P.meta.title = '빈 대상지';
    P.meta.defaultUse = 'vacant';
    P.site = { w: U.clamp(Math.round(w || 400), 100, 1200), h: U.clamp(Math.round(h || 300), 100, 1200) };
    return P;
  };

  M.scenes = {
    standard: { name: '도시(가상)', desc: '격자형 가구·위계별 도로·근린공원을 갖춘 신시가지', make: M.sceneStandard },
    oldtown: { name: '구도심(가상)', desc: '좁은 보도·전주·골목길·노후 상가가 남은 지방 구도심', make: M.sceneOldtown },
    random: { name: '임의생성(가상)', desc: '누를 때마다 도로망과 용도 배치를 새로 만듦', make: () => M.sceneRandom() },
    blank: { name: '빈 대상지', desc: '크기만 정하고 도로부터 직접 그리기', make: () => M.sceneBlank(400, 300) },
  };
})(typeof window !== 'undefined' ? window : globalThis);
