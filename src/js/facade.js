/* Urbify — 현황 건물 입면 추정
 * 받은 자료에는 외관 정보가 거의 없다(공개 지도 자료의 외장 재료·지붕 모양 속성은 조치원 일대에서 거의 비어 있음).
 * 그래서 층수·건축면적·평면 모양·주용도·접한 도로로 건물 유형(7가지)을 정하고, 유형마다 흔한 재료·색·창·1층·간판·지붕 가운데서
 * 건물 식별자의 해시로 하나씩 고른다(같은 자료면 언제나 같은 결과). 유형과 변주 번호는 건물마다 고칠 수 있다(P.ctx.fa: 식별자 → {t, v}).
 * 길에 면했는지는 받을 때의 도로망(현황 자료의 rd)으로 판단한다. 계획 도로를 고쳐도 현황 건물의 얼굴이 바뀌지 않게 */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U;
  const F = (UDS.Fac = {});

  /* 유형: 이름과 평면에 칠하는 색(채도를 낮춰 계획 건물의 용도 색과 섞이지 않게) */
  F.TYPES = {
    house: { name: '단독주택', color: '#E6D9C6' },
    multi: { name: '다세대·다가구', color: '#D5B8AA' },
    shop: { name: '근린상가', color: '#E5C7A2' },
    apt: { name: '아파트·연립', color: '#C9D3DB' },
    office: { name: '업무·상업 빌딩', color: '#A9BCCB' },
    pub: { name: '공공·교육', color: '#BCD0BF' },
    shed: { name: '창고·공장', color: '#C8C3BA' },
  };
  F.ORDER = ['house', 'multi', 'shop', 'apt', 'office', 'pub', 'shed'];

  // 재료별 벽 색: 밝기·색조를 조금씩 달리한 것
  const PAL = {
    brick: ['#b0634b', '#a0563f', '#995c4a', '#bd7a5d', '#8b4f3d', '#b6796a'],
    tile: ['#ddd3bf', '#cdc1a8', '#e5dbca', '#d5c9b4', '#c7b9a0', '#e0d5c4', '#d9cdb9'],
    stucco: ['#f1eee8', '#ebe4d5', '#e7e1d7', '#f0e9d8', '#e0dbd1', '#eee5db', '#e4e7e2'],
    stone: ['#d8d3c8', '#cac3b5', '#e0dace', '#c8c2ba', '#d3cbbd'],
    concrete: ['#c5c5c7', '#bdbcb8', '#cfceca', '#b8babc'],
    metal: ['#a3a8af', '#b8b5ad', '#99a3aa', '#c3c0b7', '#8e99a2', '#aeb6a9'],
    glass: ['#9cb6c8', '#8da8bb', '#a8becc', '#92a7b4'],
  };
  const PITCH_COL = ['#5c6167', '#4e6377', '#7c4939', '#6a6e5d', '#895943', '#58606a', '#3f5a6e']; // 경사지붕(기와·슬레이트·금속 기와)
  const FLAT_COL = ['#cfcecb', '#c8c7c3', '#d7d5d0', '#c4c6c4']; // 평지붕(시멘트·방수 시트)
  const FLAT_GREEN = ['#8fad94', '#86a68f', '#9ab59c']; // 녹색 방수 도장(오래된 주택·상가 옥상에 흔함)

  /* 유형별로 고르는 몫(가중치): 재료 · 창 · 창 면적비 범위 · 길에 면한 1층 · 간판 · 창 칸 너비 범위(m) · 경사지붕 비율 · 녹색 방수 옥상 비율 · 차양 비율 */
  const RC = {
    house: { mat: { stucco: 4, brick: 3, tile: 3 }, win: { punched: 1 }, wwr: [0.18, 0.3], gr: { residential: 1 }, sign: { none: 1 }, bay: [2.8, 3.6], pitch: 0.7, green: 0.45 },
    multi: { mat: { brick: 5, tile: 3, stucco: 2 }, win: { punched: 1 }, wwr: [0.2, 0.32], gr: { pilotis: 5, residential: 4 }, sign: { none: 1 }, bay: [3.0, 3.6], green: 0.4 },
    shop: { mat: { tile: 4, stucco: 3, brick: 2, metal: 1 }, win: { punched: 4, ribbon: 1 }, wwr: [0.25, 0.45], gr: { shop: 1 }, sign: { cluttered: 7, regulated: 2, none: 1 }, bay: [3.0, 3.8], green: 0.35, canopy: 0.25 },
    apt: { mat: { stucco: 6, tile: 2, concrete: 1 }, win: { ribbon: 4, punched: 3 }, wwr: [0.35, 0.5], gr: { residential: 3, pilotis: 1 }, sign: { none: 1 }, bay: [3.2, 3.8] },
    office: { mat: { glass: 3, stone: 3, metal: 2, tile: 2 }, win: { curtain: 3, vertical: 2, ribbon: 3 }, wwr: [0.45, 0.75], gr: { shop: 3, lobby: 2 }, sign: { regulated: 2, none: 1, cluttered: 1 }, bay: [2.6, 3.4], canopy: 0.3 },
    pub: { mat: { concrete: 3, stone: 3, brick: 2, tile: 1 }, win: { ribbon: 3, punched: 2, vertical: 1 }, wwr: [0.35, 0.5], gr: { lobby: 1 }, sign: { none: 1 }, bay: [3.2, 4.0] },
    shed: { mat: { metal: 6, concrete: 3, stucco: 1 }, win: { ribbon: 2, punched: 1 }, wwr: [0.08, 0.16], gr: { closed: 1 }, sign: { none: 1 }, bay: [4.0, 6.0], pitch: 0.35 },
  };
  F.RC = RC;

  const pickW = (rnd, w) => {
    const ks = Object.keys(w).filter((k) => w[k] > 0), tot = ks.reduce((s, k) => s + w[k], 0);
    let x = rnd() * tot;
    for (const k of ks) { x -= w[k]; if (x <= 0) return k; }
    return ks[ks.length - 1];
  };
  const pick = (rnd, a) => a[Math.floor(rnd() * a.length) % a.length];

  /* 평면 모양: 가장 큰 부분의 바깥 고리로 최소 외접 사각형(긴 변·짧은 변), 사각형을 채운 비율 */
  F.shape = function (b) {
    let big = b.parts[0], bigA = -1;
    b.parts.forEach((pt) => { const a = Math.abs(U.polyArea(pt.o)); if (a > bigA) { bigA = a; big = pt; } });
    const mr = U.minRect(big.o);
    return { pt: big, area: bigA, mr, long: mr ? mr.a : 0, short: mr ? mr.b : 0, el: mr && mr.b > 0.1 ? mr.a / mr.b : 1, fill: mr && mr.area > 0 ? bigA / mr.area : 1 };
  };

  /* 건물 찾기 격자(가림 판단용) */
  function gridOf(bld) {
    const S = 25, g = new Map(), X = UDS.Ctx;
    bld.forEach((b) => {
      const bb = X.bb(b);
      for (let i = Math.floor(bb.minx / S); i <= Math.floor(bb.maxx / S); i++) for (let j = Math.floor(bb.miny / S); j <= Math.floor(bb.maxy / S); j++) {
        const k = i + ',' + j; let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(b);
      }
    });
    return { hit: (p, self) => { const a = g.get(Math.floor(p[0] / S) + ',' + Math.floor(p[1] / S)); return !!a && a.some((o) => o !== self && X.hit(o, p)); } };
  }

  /* 길에 면한 변: 바깥 고리의 변 가운데에서 바깥쪽으로 10m 안에 도로 가장자리가 있고, 변과 도로가 대략 나란하며,
     그 사이를 다른 건물이 가리지 않을 때. 돌려주는 것 [{pi(부분), k(변), W(도로 폭), gap(도로 가장자리까지)}] */
  F.frontage = function (b, roads, idx) {
    const out = [];
    b.parts.forEach((pt, pi) => {
      const R = pt.o, n = R.length;
      for (let k = 0; k < n; k++) {
        const a = R[k], c = R[(k + 1) % n], L = U.dist(a, c);
        if (L < 1.5) continue;
        const d = [(c[0] - a[0]) / L, (c[1] - a[1]) / L], no = [d[1], -d[0]]; // 바깥쪽(반시계 고리의 오른쪽)
        const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        let best = null;
        for (const r of roads) {
          const lim = r.W / 2 + 10;
          if (m[0] < r.bb.minx - lim || m[0] > r.bb.maxx + lim || m[1] < r.bb.miny - lim || m[1] > r.bb.maxy + lim) continue;
          for (let i = 0; i + 1 < r.pts.length; i++) {
            const p = r.pts[i], q = r.pts[i + 1];
            const ds = U.distPointSeg(m, p, q), gap = ds.d - r.W / 2;
            if (gap > 10 || (best && gap >= best.gap)) continue;
            const v = [ds.q[0] - m[0], ds.q[1] - m[1]], lv = Math.hypot(v[0], v[1]);
            if (lv < 0.05 || (v[0] * no[0] + v[1] * no[1]) / lv < 0.6) continue;
            const sl = U.dist(p, q);
            if (sl < 0.05 || Math.abs(((q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1]) / sl) < 0.5) continue;
            best = { gap, W: r.W };
          }
        }
        if (!best) continue;
        const g = Math.max(0, best.gap);
        if (idx && (idx.hit([m[0] + no[0] * 0.8, m[1] + no[1] * 0.8], b) || (g > 2 && idx.hit([m[0] + no[0] * (0.8 + g / 2), m[1] + no[1] * (0.8 + g / 2)], b)))) continue;
        out.push({ pi, k, W: U.round(best.W, 1), gap: U.round(g, 1) });
      }
    });
    return out;
  };

  /* 유형 정하기: 주용도가 있으면 그것과 층수로, 없으면 층수·건축면적·모양·접한 도로 폭으로. 근거(why)를 함께 돌려준다 */
  F.classify = function (b, fr, sh) {
    const X = UDS.Ctx, fl = Math.max(1, b.fl || 1), a = b.a > 0 ? b.a : sh.area, pc = String(b.pc || ''), cat = b.cat || 'none';
    const W = fr.reduce((m, f) => Math.max(m, f.W), 0);
    const coin = (U.hashStr(b.id + '#t') % 1000) / 1000;
    const why = [];
    let t;
    if (cat !== 'none') why.push(X.useOf(pc).name);
    if (/^02001/.test(pc)) t = fl >= 5 ? 'apt' : 'multi';
    else if (/^02/.test(pc)) t = fl >= 6 ? 'apt' : 'multi';
    else if (/^01/.test(pc)) t = fl <= 2 && !/^01003/.test(pc) ? 'house' : 'multi';
    else if (cat === 'res') t = fl >= 6 ? 'apt' : fl >= 3 ? 'multi' : 'house';
    else if (cat === 'com') t = fl >= 6 ? 'office' : 'shop';
    else if (cat === 'off') t = fl >= 4 || a >= 600 ? 'office' : 'shop';
    else if (cat === 'pub') t = 'pub';
    else if (cat === 'ind') t = 'shed';
    else {
      why.push('용도 정보 없음');
      if (fl >= 6) { t = sh.el >= 2.2 && a >= 250 ? 'apt' : 'office'; if (t === 'apt') why.push('길쭉한 판상형'); }
      else if (fl >= 3) {
        if (a >= 1000) { t = sh.el >= 2.5 ? 'pub' : 'office'; why.push(t === 'pub' ? '큰 판상형' : '큰 건물'); }
        else t = W >= 12 ? 'shop' : W >= 8 ? (coin < 0.35 ? 'shop' : 'multi') : 'multi';
      } else if (a < 18) t = 'shed';
      else if (a >= 500) t = W >= 12 && a < 1500 ? 'shop' : 'shed';
      else t = W >= 12 ? 'shop' : W >= 8 && a >= 70 ? (coin < 0.2 ? 'shop' : 'house') : 'house';
    }
    why.push(`${fl}층${b.est && !b.fix ? '(어림)' : ''}`, `건축면적 ${U.fmt0 ? U.fmt0(a) : Math.round(a)}㎡`);
    why.push(W ? `폭 ${Math.round(W)}m 길에 면함` : '길에 면하지 않음');
    return { t, why };
  };

  /* 경사지붕을 얹을 사각형: 꼭짓점 넷이면 그대로, 아니면 최소 외접 사각형(반시계). 짧은 변 i0·i0+2에 박공 */
  function rectOf(sh) {
    let R;
    if (sh.pt.o.length === 4) R = sh.pt.o.map((p) => [p[0], p[1]]);
    else {
      const Fm = sh.mr.F;
      R = [[Fm.umin, Fm.vmin], [Fm.umax, Fm.vmin], [Fm.umax, Fm.vmax], [Fm.umin, Fm.vmax]].map(([u, v]) => U.fromFrame(Fm, u, v));
      if (U.polyArea(R) < 0) R.reverse();
    }
    const L = (i) => U.dist(R[i], R[(i + 1) % 4]);
    const i0 = L(0) + L(2) < L(1) + L(3) ? 0 : 1;
    return { R, i0, halfD: Math.min(L(i0 + 1), L((i0 + 3) % 4)) / 2, len: Math.min(L(i0), L(i0 + 2)) };
  }

  /* 입면 하나 만들기: 유형 t, 변주 v. sh: 모양, fr: 길에 면한 변 */
  F.style = function (b, t, v, sh, fr) {
    const rc = RC[t] || RC.house, X = UDS.Ctx;
    const rnd = U.rng(U.hashStr(b.id + '#f' + (v || 0)));
    // 아파트는 이웃 동끼리 같은 재료·색(120m 칸마다 같은 씨앗): 단지가 한 벌로 보이게
    const rcol = t === 'apt' ? U.rng(U.hashStr('apt#' + Math.round(b.c[0] / 120) + ',' + Math.round(b.c[1] / 120) + '#' + (v || 0))) : rnd;
    const age = X.ageOf(b);
    const mw = { ...rc.mat }, sw = { ...rc.sign };
    if (age !== null && age >= 30) { ['brick', 'tile'].forEach((k) => { if (mw[k]) mw[k] *= 1.6; }); ['glass', 'metal', 'stone'].forEach((k) => { if (mw[k]) mw[k] *= 0.5; }); }
    if (age !== null && age < 12) { ['stucco', 'stone', 'metal', 'glass'].forEach((k) => { if (mw[k]) mw[k] *= 1.5; }); ['brick', 'tile'].forEach((k) => { if (mw[k]) mw[k] *= 0.5; }); if (sw.regulated) sw.regulated *= 2.5; }
    let material = pickW(rcol, mw);
    let win = pickW(rnd, rc.win);
    if (win === 'curtain') material = 'glass';
    if (material === 'glass') win = 'curtain';
    const wallColor = pick(rcol, PAL[material]);
    const wwr = win === 'curtain' ? 0.85 : U.round(rc.wwr[0] + rnd() * (rc.wwr[1] - rc.wwr[0]), 2);
    const ground = pickW(rnd, rc.gr);
    const sign = pickW(rnd, sw);
    const canopy = rnd() < (rc.canopy || 0);
    const bay = win === 'curtain' ? 1.5 : win === 'vertical' ? 1.8 : U.round(rc.bay[0] + rnd() * (rc.bay[1] - rc.bay[0]), 2);
    const fl = Math.max(1, b.fl || 1), H = Math.max(2.4, b.h || 3);
    // 지붕: 낮고 작은 집·창고는 경사지붕(사각형에 가까운 평면만), 나머지는 평지붕과 난간벽
    let pitch = null;
    const pr = rnd(), pk = rnd(), pc = rnd(), gc = rnd();
    if (rc.pitch && fl <= 2 && b.parts.length === 1 && !b.parts[0].h.length && sh.mr && sh.area >= 20 && sh.area <= 260 && sh.short >= 3.5 && sh.short <= 14 && (sh.pt.o.length === 4 || sh.fill >= 0.9) && pr < rc.pitch) {
      const r = rectOf(sh);
      if (r.halfD >= 1.6 && r.len >= 3) {
        const rise = Math.min(r.halfD * Math.tan((26 * Math.PI) / 180), 3.2);
        pitch = { kind: t === 'shed' || pk < 0.55 ? 'gable' : 'hip', R: r.R, i0: r.i0, halfD: r.halfD, rise: U.round(rise, 2), col: PITCH_COL[Math.floor(pc * PITCH_COL.length) % PITCH_COL.length] };
      }
    }
    const par = pitch ? 0 : H < 4.5 ? 0.45 : 0.9;
    const top = pitch ? Math.max(2.5, H - pitch.rise / 2) : Math.max(2.2, H - par); // 벽 꼭대기(처마 또는 옥상 바닥)
    // 1층·기준층 높이: 상가·로비는 1층을 높게
    let gH = fl === 1 ? top : ground === 'shop' || ground === 'lobby' ? 4.0 : ground === 'pilotis' ? 2.7 : 3.0;
    let fH = fl > 1 ? (top - gH) / (fl - 1) : top;
    if (fl > 1 && fH < 2.5) { fH = 2.5; gH = Math.max(2.3, top - fH * (fl - 1)); }
    if (fl > 1 && fH > 4.5) { fH = 4.5; gH = Math.min(8, top - fH * (fl - 1)); }
    // 길에 면한 변(부분:변). 상가·업무·공공인데 길에 면한 변이 없으면 가장 긴 변을 앞으로
    const front = new Set(fr.map((f) => f.pi + ':' + f.k));
    if (!front.size && (t === 'shop' || t === 'office' || t === 'pub')) {
      let best = null;
      b.parts.forEach((pt, pi) => pt.o.forEach((p, k) => { const L = U.dist(p, pt.o[(k + 1) % pt.o.length]); if (!best || L > best.L) best = { L, key: pi + ':' + k }; }));
      if (best) front.add(best.key);
    }
    // 경사지붕 사각형의 변 가운데 길에 면한 것: 원래 변과 바깥 방향이 같고 가까운 것
    if (pitch) {
      const ring = b.parts[0].o, pf = new Set();
      for (let i = 0; i < 4; i++) {
        const a = pitch.R[i], c = pitch.R[(i + 1) % 4], na = U.perpR(U.norm(U.sub(c, a))), m = U.mid(a, c);
        front.forEach((key) => {
          const k = +key.split(':')[1], p = ring[k], q = ring[(k + 1) % ring.length];
          if (!p || !q) return;
          const nb = U.perpR(U.norm(U.sub(q, p)));
          if (U.dot(na, nb) > 0.9 && Math.abs(U.dot(U.sub(U.mid(p, q), m), na)) < 2.5) pf.add(i);
        });
      }
      pitch.front = pf;
    }
    const greenOK = rc.green && (age === null || age >= 15);
    const roofColor = pitch ? pitch.col : greenOK && gc < rc.green ? pick(rnd, FLAT_GREEN) : pick(rnd, FLAT_COL);
    return {
      t, v: v || 0, H: U.round(H, 2), top: U.round(top, 2), par, groundH: U.round(gH, 2), floorH: U.round(fH, 2), floors: fl, bay, front, pitch,
      st: { material, wallColor, wwr, win, ground, sign, canopy, roof: pitch ? 'gable' : 'flat', roofColor },
    };
  };

  /* 현황 건물 전체: 식별자 → 입면. roads: [{pts, W}] (받을 때의 도로망), fa: 건물마다 고친 유형·변주 */
  F.compute = function (cx, roads, fa) {
    const R2 = (roads || []).filter((r) => r.pts && r.pts.length > 1).map((r) => ({ pts: r.pts, W: r.W || 8, bb: U.polyBounds(r.pts) }));
    const idx = gridOf(cx.bld), out = new Map();
    cx.bld.forEach((b) => {
      const sh = F.shape(b), fr = F.frontage(b, R2, idx), auto = F.classify(b, fr, sh);
      const o = (fa && fa[b.id]) || {};
      const t = F.TYPES[o.t] ? o.t : auto.t;
      const d = F.style(b, t, o.v || 0, sh, fr);
      d.auto = auto.t; d.why = auto.why; d.fixed = !!F.TYPES[o.t]; d.fr = fr;
      out.set(b.id, d);
    });
    return out;
  };

  /* 한 줄 요약: 재료 · 창 · 1층 · 간판 · 지붕 */
  F.summary = function (d) {
    const C = UDS.C, st = d.st;
    const roof = d.pitch ? (d.pitch.kind === 'hip' ? '모임지붕' : '박공지붕') : st.roofColor && FLAT_GREEN.includes(st.roofColor) ? '평지붕(녹색 방수)' : '평지붕';
    const gr = d.front.size || st.ground === 'pilotis' ? `1층 ${C.GROUND[st.ground] || ''}` : '';
    return [C.MATERIALS[st.material] ? C.MATERIALS[st.material].name : st.material, C.WIN[st.win], gr, st.sign !== 'none' && d.front.size ? C.SIGN[st.sign] : '', roof].filter(Boolean).join(' · ');
  };
})(typeof window !== 'undefined' ? window : globalThis);
