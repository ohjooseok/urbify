/* Urbify — 상태·도구·편집 동작 */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C, M = UDS.Model, Dv = UDS.Derive;
  const LS_KEY = 'uds.sandbox.v1';
  const LS_INIT = LS_KEY + '.init'; // 이 프로젝트를 처음 열었을 때의 모습('처음 상태로 되돌리기'가 돌아갈 자리)
  const LS_CTX = LS_KEY + '.ctx'; // 실제 지역의 현황 자료(건물·필지). 계획과 따로 둔다
  const LS_MAT = LS_KEY + '.mat'; // 이미지로 만든 벽 재료의 그림(데이터 URL). 되돌리기 기록에 넣지 않으려고 계획과 따로 둔다

  const app = (UDS.app = {
    P: null, D: null, hist: [], hi: -1,
    ctx: null, // 실제 지역의 현황 자료 { id, lat, lon, W, H, date, src, bld: [...], par: [...] }. 계획의 P.ctx.id와 같을 때만 쓴다
    state: {
      mode: 'color', modes: { '2d': 'color', '3d': 'color', sec: 'color' }, lineW: 1, tool: 'select', placeType: null, roadPreset: 'jung3', treeSpecies: 'ginkgo', buildUse: 'res',
      // 건물 놓기: scope 'lot'(획지 하나) · 'block'(가구 전체). floors 0·depth null이면 고른 용도의 기본값, len 0이면 획지 폭에 맞춤
      buildOpt: { scope: 'lot', floors: 0, len: 0, depth: null },
      fillT: {}, // 가구 채우기 기준(용도별 건폐율·용적률·최고 층수)
      innerShape: { estate4: 'round', trail2: 'curve' }, // 단지 안 길을 그릴 모양: 'line' 꺾은선 · 'round' 모서리 둥글게 · 'curve' 곡선(베지에)
      waterKind: 'circle', // 수공간 그리기: 'circle' 원형 · 'rect' 둥근 사각형 · 'free' 자유형(곡선) · 'river' 하천
      hideL: false, hideR: false, // 넓은 화면에서 왼쪽·오른쪽 패널 접기
      sel: null, multi: [], hover: null, selSeg: null, selUtil: null, secRoadId: null, secS: null,
      // multi: Shift+누름으로 함께 고른 요소들(둘 이상일 때만 채움). sel은 그중 마지막에 고른 것
      secShow: { text: true, dim: true, util: true }, // 가로 단면에 얹는 정보: 텍스트(모든 글자) · 치수 · 지하시설물
      max: null, // 크게 보는 화면: '2d' | '3d' | 'sec' | null
      layers: { buildings: true, trees: true, furniture: true, utilities: false, shadows: false, labels: true, underlay: true, ctx: true, parcels: true },
      ctxMode: 'fac', // 현황 건물 표현: 'fac' 입면(추정) · 'gray' 단색 · 'use' 용도 · 'floor' 층수 · 'age' 건축 연도 · 'est' 높이 근거
      under3d: true, drawRoad: null, snap: null, tab: 'props', view: 'split', mview: '2d', sheet: false,
      traffic: { on: false, ped: 0.4, car: 0.4, pm: true, pmd: 0.4 }, // 3D의 사람·차량(처음에는 꺼짐)과 밀도. pm: 자전거도로의 자전거·킥보드(개인형 이동장치)
      ana: { sunpath: false, sunhours: false, lux: false }, // 음영분석의 조도분석: 태양 궤적도 · 일조시간 · 가로등 조도
    },
    _dirty: 0, _raf: 0, _liveRaf: 0,
  });

  /* ---------- 조회 ---------- */
  app.road = function (id) { return this.P.roads.find((r) => r.id === id) || null; };
  app.water = function (id) { return (this.P.waters || []).find((w) => w.id === id) || null; };
  /* 화면별 표현: '2d' 평면 · '3d' · 'sec' 가로 단면 → 'color' | 'line' */
  app.modeOf = function (k) { const m = this.state.modes; return (m && m[k]) || 'color'; };
  app.secRoad = function () { const id = this.state.secRoadId; return id && this.P ? this.road(id) : null; };
  app.block = function (id) { return this.P.blocks.find((b) => b.id === id) || null; };
  app.lotInfo = function (lotId) {
    const lot = this.D.lots.find((l) => l.id === lotId); if (!lot) return null;
    const S = this.block(lot.blockId); if (!S) return null;
    return { lot, S, key: lot.key, ov: (S.lots && S.lots[lot.key]) || null };
  };
  app.lotOv = function (lotId) {
    const li = this.lotInfo(lotId); if (!li) return null;
    if (!li.S.lots) li.S.lots = {};
    if (!li.S.lots[li.key]) li.S.lots[li.key] = {};
    return li.S.lots[li.key];
  };
  /* 그 자리에서 tol(m) 안에 경계선이 지나는 가구. 도로 가장자리(가구 경계선)를 눌러 가구를 고를 때 쓴다 */
  app.blockEdgeAt = function (w, tol) {
    if (!w || !this.D) return null;
    let best = null, bd = tol;
    this.D.blocks.forEach((b) => {
      const n = b.poly.length;
      for (let k = 0; k < n; k++) { const d = U.distPointSeg(w, b.poly[k], b.poly[(k + 1) % n]).d; if (d < bd) { bd = d; best = b; } }
    });
    return best;
  };
  /* 그 자리(평면 좌표)를 품은 획지. 수목·시설물이 위에 있어도 획지를 찾는다 */
  app.lotAt = function (w) { return (w && this.D && this.D.lots.find((l) => U.pointInPoly(w, l.poly))) || null; };
  /* 실제 지역의 현황 자료(지금 계획의 것일 때만) */
  app.ctxData = function () {
    const P = this.P, cx = this.ctx;
    if (!(P && P.ctx && cx && cx.id === P.ctx.id)) return null;
    // 대상지를 서·남쪽으로 넓히면 계획 좌표가 통째로 밀린다(P.shift). 현황 자료는 받은 그대로 두고 밀린 사본을 쓴다.
    // 층수를 고친 현황 건물(P.ctx.fl: 식별자 → 지상 층수)도 사본에 담는다(고친 것은 계획에 남아 되돌리기를 따른다)
    const sh = P.shift, hasSh = !!(sh && (sh[0] || sh[1]));
    const fx = P.ctx.fl, hasFx = !!(fx && typeof fx === 'object' && Object.keys(fx).length);
    if (!hasSh && !hasFx) return cx;
    const k = hasSh ? sh[0] + ',' + sh[1] : '';
    if (this._ctxSh && this._ctxSh.src === cx && this._ctxSh.k === k && this._ctxSh.fx === fx) return this._ctxSh.data;
    const mv = (p) => [U.round(p[0] + sh[0], 2), U.round(p[1] + sh[1], 2)];
    const parts = (ps) => ps.map((pt) => ({ o: pt.o.map(mv), h: (pt.h || []).map((r) => r.map(mv)) }));
    const X = UDS.Ctx;
    const data = {
      ...cx,
      bld: cx.bld.map((b) => {
        let o = hasSh ? { ...b, parts: parts(b.parts), c: mv(b.c) } : b;
        const f = hasFx ? +fx[b.id] : 0;
        if (f > 0) { if (o === b) o = { ...b }; o.fl = f; o.h = X.hOf(b.cat, f); o.fix = 1; }
        return o;
      }),
      par: hasSh ? (cx.par || []).map((q) => ({ ...q, parts: parts(q.parts) })) : cx.par,
    };
    if (hasSh && cx.rd) data.rd = cx.rd.map((r) => ({ ...r, p: r.p.map(mv) }));
    this._ctxSh = { src: cx, k, fx, data };
    return data;
  };
  /* 현황 건물의 지상 층수 고치기(n이 0이면 받은 값으로 되돌림) */
  app.ctxSetFloors = function (id, n) {
    const P = this.P; if (!P.ctx || !this.ctx || !this.ctx.bld.some((b) => b.id === id)) return false;
    const fx = { ...(P.ctx.fl || {}) };
    if (n > 0) fx[id] = U.clamp(Math.round(n), 1, 90); else delete fx[id];
    P.ctx.fl = fx;
    this.commit();
    return true;
  };
  /* 현황 건물의 추정 입면(식별자 → 입면). 길에 면했는지는 받을 때의 도로망(cx.rd)으로, 없으면(v24까지 만든 대상지) 지금 도로로 본다.
     건물마다 고친 유형·변주(P.ctx.fa)를 따른다. 자료·도로·고친 값이 같으면 다시 셈하지 않는다 */
  app.ctxFac = function () {
    const cx = this.ctxData(), Fc = UDS.Fac; if (!cx || !Fc) return null;
    const P = this.P, D = this.D;
    let roads = null, sig = '';
    if (cx.rd) roads = cx.rd.map((r) => ({ pts: r.p, W: r.w }));
    else if (D && D.roadInfo) {
      roads = [];
      P.roads.forEach((r) => { const inf = D.roadInfo.get(r.id); if (!inf || r.pts.length < 2) return; roads.push({ pts: r.pts, W: inf.lay.W }); sig += inf.lay.W + ':' + r.pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ') + '|'; });
    } else return null;
    const fa = (P.ctx && P.ctx.fa) || null, fk = fa ? JSON.stringify(fa) : '';
    const m = this._facM;
    if (m && m.cx === cx && m.sig === sig && m.fk === fk) return m.map;
    const map = Fc.compute(cx, roads, fa);
    this._facM = { cx, sig, fk, map };
    return map;
  };
  /* 현황 건물의 입면 유형·변주 고치기(t: 유형 키 또는 ''(자동), v: 변주 번호) */
  app.ctxSetFac = function (id, o) {
    const P = this.P; if (!P.ctx || !this.ctxBld(id)) return false;
    const fa = { ...(P.ctx.fa || {}) }, cur = { ...(fa[id] || {}) };
    if ('t' in o) { if (o.t && UDS.Fac && UDS.Fac.TYPES[o.t]) cur.t = o.t; else delete cur.t; }
    if ('v' in o) { if (o.v > 0) cur.v = Math.round(o.v); else delete cur.v; }
    if (Object.keys(cur).length) fa[id] = cur; else delete fa[id];
    P.ctx.fa = fa;
    this.commit();
    return true;
  };
  app.ctxBld = function (id) {
    const cx = this.ctxData(); if (!cx) return null;
    if (!this._ctxIdx || this._ctxIdx.src !== cx) this._ctxIdx = { src: cx, map: new Map(cx.bld.map((b) => [b.id, b])) };
    return this._ctxIdx.map.get(id) || null;
  };
  /* 지금 보이는(지우거나 계획으로 철거되지 않은) 현황 건물인가 */
  app.ctxShown = function (id) { const V = this.D && this.D.ctxV; return !!V && UDS.Ctx.shown(V, id); };
  /* 큰 자료(현황 건물·필지)는 브라우저의 IndexedDB에 둔다. localStorage는 5MB 안팎이라 실제 지역 자료가 크면 계획 저장까지 막을 수 있다 */
  const IDB = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('no idb');
        const r = indexedDB.open('urbify', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('kv'); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
      } catch (e) { rej(e); }
    }));
    const tx = (mode, fn) => open().then((db) => new Promise((res, rej) => {
      const t = db.transaction('kv', mode), q = fn(t.objectStore('kv'));
      t.oncomplete = () => res(q ? q.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    }));
    return { ok: typeof indexedDB !== 'undefined', get: (k) => tx('readonly', (st) => st.get(k)), put: (k, v) => tx('readwrite', (st) => st.put(v, k)), del: (k) => tx('readwrite', (st) => st.delete(k)) };
  })();
  app.idb = IDB;
  app.saveCtx = function () {
    const cx = this.ctx;
    let ok = false;
    try {
      const raw = cx ? JSON.stringify(cx) : '';
      if (cx && (raw.length < 1.5e6 || !IDB.ok)) { localStorage.setItem(LS_CTX, raw); ok = true; } else localStorage.removeItem(LS_CTX);
    } catch (e) { try { localStorage.removeItem(LS_CTX); } catch (e2) { /* 무시 */ } }
    if (IDB.ok) { (cx ? IDB.put('ctx', cx) : IDB.del('ctx')).catch(() => { if (cx && !ok) this._ctxSaved = false; }); return true; }
    return ok || !cx;
  };
  app.restoreCtx = function (id) {
    try { const raw = localStorage.getItem(LS_CTX); if (!raw) return null; const cx = JSON.parse(raw); return cx && cx.id === id && Array.isArray(cx.bld) ? cx : null; } catch (e) { return null; }
  };
  /* 저장·내보내기용 계획: 현황 자료와 벽 재료 그림을 함께 담는다 */
  app.exportProject = function () {
    const cx = this.ctxData() && this.ctx, md = this.matData();
    return cx || md ? { ...this.P, ...(cx ? { ctxData: cx } : {}), ...(md ? { matData: md } : {}) } : this.P;
  };

  /* ---------- 이미지로 만든 벽 재료 ----------
     정의(이름·무늬 크기·거울 반복·평균색)는 계획(P.mats)에 두어 되돌리기를 따르고, 그림(512×512 JPEG 데이터 URL)은 app.matImg에 따로 둔다.
     작업 파일에는 matData로 함께 담고, 브라우저 자동 저장은 LS_MAT에 */
  app.matImg = {};
  app._matEl = {};
  app.mats = function () { return (this.P && this.P.mats) || []; };
  app.matDef = function (id) { return this.mats().find((m) => m.id === id) || null; };
  app.isCustomMat = (id) => typeof id === 'string' && id.indexOf('cm_') === 0;
  app.matData = function () {
    const out = {}; let n = 0;
    this.mats().forEach((m) => { if (this.matImg[m.id]) { out[m.id] = this.matImg[m.id]; n++; } });
    return n ? out : null;
  };
  app.saveMat = function () { try { const md = this.matData(); if (md) localStorage.setItem(LS_MAT, JSON.stringify(md)); else localStorage.removeItem(LS_MAT); return true; } catch (e) { return false; } };
  app.restoreMat = function () { try { const raw = localStorage.getItem(LS_MAT); const o = raw ? JSON.parse(raw) : null; return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
  /* 읽어 둔 그림(HTMLImageElement). 아직 읽는 중이면 null을 돌려주고, 다 읽으면 다시 그린다 */
  app.matEl = function (id) {
    const url = this.matImg[id]; if (!url) return null;
    let e = this._matEl[id];
    if (!e || e.url !== url) {
      e = this._matEl[id] = { url, img: new Image(), ok: false, mir: null };
      e.img.onload = () => { e.ok = true; if (this.r3) this.r3.cmDirty = true; this.invalidate(7); };
      e.img.src = url;
    }
    return e.ok ? e.img : null;
  };
  /* 거울 반복용 2×2 그림: 왼쪽 아래가 원래 그림, 오른쪽은 좌우로, 위는 위아래로 뒤집은 것(땅에서 위로 원래 → 뒤집힌 차례가 3D와 같게).
     단면 무늬와 OBJ·DAE 내보내기(거울 반복을 모르는 형식)에 쓴다 */
  app.matMirror = function (id) {
    const img = this.matEl(id); if (!img) return null;
    const e = this._matEl[id];
    if (!e.mir) {
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, c = document.createElement('canvas');
      c.width = w * 2; c.height = h * 2;
      const g = c.getContext('2d');
      [[1, 1, 0, h], [-1, 1, 2 * w, h], [1, -1, 0, h], [-1, -1, 2 * w, h]].forEach(([sx, sy, tx, ty]) => { g.setTransform(sx, 0, 0, sy, tx, ty); g.drawImage(img, 0, 0, w, h); });
      e.mir = c;
    }
    return e.mir;
  };
  app.addMat = function (def, url) {
    const P = this.P; if (!P.mats) P.mats = [];
    if (P.mats.length >= C.CMAT_MAX) return null;
    const id = 'cm_' + Math.random().toString(36).slice(2, 9);
    P.mats.push({ id, name: def.name || '이미지 재료', tile: [U.round(def.tile[0], 2), U.round(def.tile[1], 2)], mirror: !!def.mirror, color: def.color || '#cccccc' });
    this.matImg[id] = url;
    return id;
  };
  app.updateMat = function (id, patch) {
    const m = this.matDef(id); if (!m) return;
    Object.assign(m, patch);
    if (patch.tile) m.tile = [U.clamp(U.round(patch.tile[0], 2), 0.05, 50), U.clamp(U.round(patch.tile[1], 2), 0.05, 50)];
    this.commit();
  };
  /* 재료 지우기: 그 재료를 쓰던 건물·가구는 도장·스타코로 돌아간다(벽 색은 그대로) */
  app.deleteMat = function (id) {
    const P = this.P; if (!P.mats) return;
    P.mats = P.mats.filter((m) => m.id !== id);
    const fix = (o) => { if (o && o.material === id) o.material = 'stucco'; };
    (P.blocks || []).forEach((S) => { fix(S.bld); Object.values(S.lots || {}).forEach((ov) => ov && fix(ov.bld)); });
    this.commit(); // 그림은 지우지 않는다(되돌리기로 살릴 수 있게). 자동 저장에서는 빠진다
  };
  app.roadParam = function (road, w) {
    let best = Infinity, acc = 0, s = 0;
    for (let i = 0; i + 1 < road.pts.length; i++) {
      const a = road.pts[i], b = road.pts[i + 1], L = U.dist(a, b);
      const r = U.distPointSeg(w, a, b);
      if (r.d < best) { best = r.d; s = acc + r.t * L; }
      acc += L;
    }
    return s;
  };

  /* ---------- 계산·그리기 ---------- */
  app.derive = function (noPrev) {
    this.D = Dv.derive(this.P, noPrev ? null : this.D);
    this.dver = (this.dver || 0) + 1; // 형상이 바뀐 횟수(분석 결과를 다시 셀지 정할 때)
    const st = this.state, P = this.P, D = this.D;
    D.ctxData = this.ctxData();
    D.ctxV = UDS.Ctx ? UDS.Ctx.vis(P, D, D.ctxData) : null;
    if (st.secRoadId && !P.roads.some((r) => r.id === st.secRoadId)) { st.secRoadId = P.roads[0] ? P.roads[0].id : null; st.secS = null; st.selSeg = null; st.selUtil = null; }
    if (!st.secRoadId && P.roads[0]) st.secRoadId = P.roads[0].id;
    const alive = (t) => !!t && (t.type === 'road' ? P.roads.some((r) => r.id === t.id)
      : t.type === 'block' ? D.blocks.some((b) => b.id === t.id)
      : t.type === 'object' ? P.objects.some((o) => o.id === t.id)
      : t.type === 'ctx' ? !!this.ctxBld(t.id) && this.ctxShown(t.id)
      : t.type === 'rab' ? D.rabs.some((r) => r.id === t.id)
      : t.type === 'tree' ? D.trees.some((x) => x.key === t.id && x.kind !== 'free')
      : t.type === 'water' ? (P.waters || []).some((w) => w.id === t.id)
      : D.lots.some((l) => l.id === t.id));
    const fixType = (t) => { if (t.type === 'building' || t.type === 'lot') t.type = D.lots.find((l) => l.id === t.id).building ? 'building' : 'lot'; };
    // 함께 고른 요소: 사라진 것은 빼고, 다른 곳에서 선택이 바뀌었으면(묶음 밖의 것을 새로 골랐으면) 묶음을 푼다
    let m = (st.multi || []).filter(alive);
    if (m.length) {
      if (alive(st.sel)) { if (!m.some((t) => t.id === st.sel.id)) m = []; }
      else st.sel = { type: m[m.length - 1].type, id: m[m.length - 1].id };
    }
    m.forEach(fixType);
    st.multi = m.length > 1 ? m : [];
    const t = st.sel;
    if (t) { if (!alive(t)) st.sel = null; else fixType(t); }
    const road = this.secRoad();
    if (road) {
      if (st.selSeg && !road.segs.some((s) => s.id === st.selSeg)) st.selSeg = null;
      if (st.selUtil && !(road.utils || []).some((u) => u.id === st.selUtil)) st.selUtil = null;
    }
    if (st.hover) st.hover = null;
  };
  app.invalidate = function (f) {
    this._dirty |= f;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const d = this._dirty; this._dirty = 0;
      // 크게 보기로 가려진 화면은 그리지 않는다(돌아올 때 한꺼번에 다시 그림)
      const mx = this.state.max;
      const vis = (cv, k) => cv && cv.clientWidth > 4 && cv.clientHeight > 4 && (!mx || mx === k);
      if ((d & 1) && vis(this.r2.cv, '2d')) this.r2.draw();
      if ((d & 2) && this.r3.ok && vis(this.r3.cv, '3d') && !this._tk) this.r3.draw(); // 사람·차량이 움직이는 중에는 그쪽에서 매 장면 그린다
      if ((d & 4) && vis(this.sec.cv, 'sec')) this.sec.draw();
      if (this.state.traffic.on && !this._tk) this.trafficKick();
    });
  };
  app.rebuild3d = function () {
    clearTimeout(this._r3t); this._r3t = 0;
    if (!this.r3.ok) return;
    this.r3.rebuild();
    if (this.traffic) { if (this.state.traffic.on) this.traffic.build(this.P, this.D); else this.traffic.stale = true; }
    this.invalidate(2);
  };

  /* ---------- 사람·차량(3D) ---------- */
  app.setTraffic = function (on) {
    const st = this.state.traffic, tr = this.traffic;
    st.on = !!on && !!(this.r3 && this.r3.ok && this.r3.aprog);
    if (st.on) {
      tr.pedDen = st.ped; tr.carDen = st.car; tr.pmDen = st.pmd === undefined ? 0.4 : st.pmd; tr.pmOn = st.pm = tr.pmDen > 0;
      if (!tr.ready || tr.stale) tr.build(this.P, this.D); else tr.populate();
      this.trafficKick();
    }
    this.invalidate(2);
  };
  app.setTrafficDensity = function (ped, car) {
    const st = this.state.traffic;
    if (ped !== null && ped !== undefined) st.ped = ped;
    if (car !== null && car !== undefined) st.car = car;
    if (st.on && this.traffic.ready) this.traffic.setDensity(st.ped, st.car);
  };
  /* 켜져 있고 3D가 보이는 동안만 매 장면 움직인다. 가려지거나 꺼지면 스스로 멈추고, 다시 그릴 일이 생기면 깨어난다 */
  app.trafficKick = function () {
    if (this._tk || !this.state.traffic.on || !this.r3 || !this.r3.ok) return;
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
    let last = 0, odd = false, slow = 0;
    const loop = (ts) => {
      this._tk = 0;
      const cv = this.r3.cv;
      const mx = this.state.max;
      if (!this.state.traffic.on || document.hidden || !(cv.clientWidth > 4 && cv.clientHeight > 4) || (mx && mx !== '3d')) return;
      this._tk = requestAnimationFrame(loop);
      if (coarse) { odd = !odd; if (odd) return; } // 휴대 기기에서는 초당 30장면으로 전력을 아낀다
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0.016;
      // 장면이 계속 느리면(초당 12장면 아래) 3D 해상도를 낮춰 부담을 줄인다
      if (last && !this.r3.lowRes) { slow = ts - last > 85 ? slow + 1 : 0; if (slow > 24) this.r3.lowRes = true; }
      last = ts;
      this.traffic.step(dt);
      this.r3.draw();
      if (this.onTrafficFrame) this.onTrafficFrame(ts);
    };
    this._tk = requestAnimationFrame(loop);
  };
  app.rebuild3dSoon = function () { if (this._r3t) return; this._r3t = setTimeout(() => { this._r3t = 0; this.rebuild3d(); }, 110); };

  /* 끌기 중: 가볍게 다시 계산 */
  app.liveChange = function () {
    if (this._liveRaf) return;
    this._liveRaf = requestAnimationFrame(() => {
      this._liveRaf = 0;
      this.derive();
      UDS.ui.secHead();
      this.invalidate(1 | 4);
      this.rebuild3dSoon();
    });
  };
  /* 변경 확정: 되돌리기 기록 + 화면 전체 갱신 */
  /* 대상지가 모든 도로를 품도록 넓힌다(도로를 대상지 밖까지 그리거나 끌었을 때). 서·남쪽으로 넓히면 좌표를 통째로 민다 */
  const SITE_MAX = 2000;
  app.fitSite = function () {
    const P = this.P; if (!P || !P.site) return null;
    let x0 = 0, y0 = 0, x1 = P.site.w, y1 = P.site.h;
    P.roads.forEach((r) => r.pts.forEach((p) => { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }));
    x0 = Math.floor(x0 + 1e-6); y0 = Math.floor(y0 + 1e-6); x1 = Math.ceil(x1 - 1e-6); y1 = Math.ceil(y1 - 1e-6);
    if (x0 >= 0 && y0 >= 0 && x1 <= P.site.w && y1 <= P.site.h) return null;
    if (x1 - x0 > SITE_MAX || y1 - y0 > SITE_MAX) return 'big';
    const old = { w: P.site.w, h: P.site.h };
    if (x0 < 0 || y0 < 0) this.shiftWorld(-Math.min(0, x0), -Math.min(0, y0));
    P.site.w = Math.max(x1, P.site.w) - Math.min(0, x0); P.site.h = Math.max(y1, P.site.h) - Math.min(0, y0);
    return { old, w: P.site.w, h: P.site.h };
  };
  /* 계획 좌표를 통째로 민다(대상지를 서·남쪽으로 넓힐 때 원점을 다시 남서쪽 모서리에 두려고). 화면은 그대로 보이게 시점도 함께 민다 */
  app.shiftWorld = function (dx, dy) {
    if (!dx && !dy) return;
    const P = this.P, mv = (p) => [U.round(p[0] + dx, 2), U.round(p[1] + dy, 2)];
    P.roads.forEach((r) => { r.pts = r.pts.map(mv); if (r.ctrl) r.ctrl = r.ctrl.map(mv); });
    P.blocks.forEach((b) => { if (b.seed) b.seed = mv(b.seed); });
    P.objects.forEach((o) => { o.x = U.round(o.x + dx, 2); o.y = U.round(o.y + dy, 2); });
    (P.rabouts || []).forEach((r) => { if (r.p) r.p = mv(r.p); });
    (P.waters || []).forEach((w) => M.waterMove(w, [dx, dy]));
    const rk = (k) => { const m = /^t(-?\d+)_(-?\d+)$/.exec(k); return m ? 't' + (+m[1] + Math.round(dx * 2)) + '_' + (+m[2] + Math.round(dy * 2)) : k; };
    if (P.treeOff) P.treeOff = P.treeOff.map(rk);
    if (P.treeSp) { const o = {}; Object.keys(P.treeSp).forEach((k) => { o[rk(k)] = P.treeSp[k]; }); P.treeSp = o; }
    const sh = P.shift || [0, 0]; P.shift = [U.round(sh[0] + dx, 2), U.round(sh[1] + dy, 2)];
    const v = this.r2 && this.r2.view; if (v) { v.cx += dx; v.cy += dy; }
    if (this.r3 && this.r3.cam) { this.r3.cam.tx += dx; this.r3.cam.tz -= dy; }
  };
  app.commit = function () {
    if (this._liveRaf) { cancelAnimationFrame(this._liveRaf); this._liveRaf = 0; }
    const fx = this.fitSite();
    if (fx === 'big') { // 너무 넓어지면 이번 고침을 물린다
      try { this.P = JSON.parse(this.hist[this.hi]); } catch (e) { /* 무시 */ }
      this.derive(); this.refresh();
      UDS.ui.toast(`대상지는 한 변 ${SITE_MAX / 1000}km까지 넓힐 수 있습니다.`);
      return false;
    }
    this.derive();
    if (fx) UDS.ui.toast(`대상지를 넓혔습니다: ${U.fmt(fx.old.w, 0)}×${U.fmt(fx.old.h, 0)}m → ${U.fmt(fx.w, 0)}×${U.fmt(fx.h, 0)}m (되돌리기 Ctrl+Z)`);
    const json = JSON.stringify(this.P);
    if (json !== this.hist[this.hi]) {
      this.hist = this.hist.slice(0, this.hi + 1);
      this.hist.push(json);
      if (this.hist.length > 80) this.hist.shift();
      this.hi = this.hist.length - 1;
      this.saveSoon();
    }
    this.refresh();
    return true;
  };
  app.changed = function () { this.commit(); };
  app.refresh = function () {
    const ui = UDS.ui;
    ui.top(); ui.palette(); ui.secHead(); ui.pane(); ui.hint(); ui.sheetPeek(); ui.selPop();
    this.rebuild3d();
    this.invalidate(7);
  };
  app.undo = function () { if (this.hi <= 0) return; this.hi--; this.P = JSON.parse(this.hist[this.hi]); this.derive(true); this.saveSoon(); this.refresh(); };
  app.redo = function () { if (this.hi >= this.hist.length - 1) return; this.hi++; this.P = JSON.parse(this.hist[this.hi]); this.derive(true); this.saveSoon(); this.refresh(); };

  /* ---------- 저장 ---------- */
  app.saveSoon = function () {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.saveNow(), 500);
  };
  /* 미뤄 둔 저장을 바로 한다(창을 닫거나 다른 탭으로 갈 때 마지막 변경을 놓치지 않게) */
  app.saveNow = function () {
    if (!this._saveT) return;
    clearTimeout(this._saveT); this._saveT = 0;
    try { localStorage.setItem(LS_KEY, this.hist[this.hi]); } catch (e) { /* 저장 공간을 쓸 수 없는 환경 */ }
    const ms = this.mats().map((m) => m.id).join(',');
    if (ms !== this._matSig) { this._matSig = ms; if (!this.saveMat() && ms) UDS.ui.toast('브라우저 저장 공간이 모자라 재료 그림을 자동 저장하지 못했습니다. 작업 파일로 저장해 두세요.'); }
  };
  app.restore = function () {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const P = JSON.parse(raw);
      return app.validProject(P) ? P : null;
    } catch (e) { return null; }
  };
  app.validProject = function (P) { return !!(P && P.site && P.site.w > 0 && Array.isArray(P.roads) && Array.isArray(P.blocks) && P.meta); };
  /* 이어서 여는 작업(saved)의 처음 상태. 같은 프로젝트의 것일 때만 쓴다(프로젝트마다 meta.uid가 다름) */
  app.restoreInitial = function (saved) {
    try {
      const raw = localStorage.getItem(LS_INIT);
      if (!raw) return '';
      const P0 = JSON.parse(raw);
      return app.validProject(P0) && P0.meta.uid && saved && saved.meta && P0.meta.uid === saved.meta.uid ? raw : '';
    } catch (e) { return ''; }
  };

  /* 계획 P를 화면에 올릴 채비: 빠진 설정을 채우고, 선택·도구를 비우고, 처음 보여 줄 단면 도로를 고른다 */
  app.adopt = function (P) {
    const st = this.state;
    this.P = P;
    if (!P.meta.uid) P.meta.uid = U.uid('p');
    if (!P.objects) P.objects = [];
    if (P.mats !== undefined) { // 이미지 재료 정의: 모양이 맞는 것만
      P.mats = Array.isArray(P.mats) ? P.mats.filter((m) => m && this.isCustomMat(m.id) && Array.isArray(m.tile) && m.tile[0] > 0 && m.tile[1] > 0).slice(0, C.CMAT_MAX) : [];
      if (!P.mats.length) delete P.mats;
    }
    if (!P.settings) P.settings = { m2PerPerson: 35, season: 'winter', doy: 356, hour: 12, lat: 36.6 };
    if (!(P.settings.doy >= 1 && P.settings.doy <= 365)) P.settings.doy = UDS.dayOf(P.settings); // 예전 파일: 계절 → 그 계절의 대표 날
    if (!P.settings.lights) P.settings.lights = 'auto';
    if (P.settings.hour === undefined) P.settings.hour = 12;
    st.sel = null; st.multi = []; st.selSeg = null; st.selUtil = null; st.hover = null; st.drawRoad = null; st.snap = null; st.tool = 'select';
    this.D = null;
    this.derive(true);
    const r = P.roads.find((x) => /^(역전로|중앙 집산도로|중심 가로)/.test(x.name || '')) || P.roads[0];
    st.secRoadId = r ? r.id : null; st.secS = null;
    this.r2.cv.style.cursor = 'default'; if (this.r3.ok) this.r3.cv.style.cursor = 'grab';
  };
  /* 새 프로젝트로 연다(되돌리기 기록을 새로 시작). o.initial: 이어서 여는 작업의 '처음 상태'(없으면 지금 모습이 처음 상태) */
  app.load = function (P, o) {
    o = o || {};
    if (!o.keepUnderlay) this.underlay = null;
    if (P.ctxData) { if (o.ctx === undefined) o = { ...o, ctx: P.ctxData }; delete P.ctxData; } // 작업 파일에 담긴 현황 자료
    if (P.matData) { Object.assign(this.matImg, P.matData); delete P.matData; } // 작업 파일에 담긴 벽 재료 그림
    if (o.ctx !== undefined) this.ctx = o.ctx;
    else if (!(P.ctx && this.ctx && this.ctx.id === P.ctx.id)) this.ctx = null;
    this._ctxIdx = null;
    if (o.save !== false) this._ctxSaved = this.saveCtx();
    this.adopt(P);
    if (o.save !== false) this.saveMat();
    this.hist = [JSON.stringify(P)]; this.hi = 0;
    if (o.initial !== undefined) this.initial = o.initial || '';
    else {
      this.initial = this.hist[0];
      // 처음 상태와 지금 상태를 함께 적어 둔다(둘이 서로 다른 프로젝트의 것이 되지 않게)
      try { localStorage.setItem(LS_INIT, this.initial); if (o.save !== false) localStorage.setItem(LS_KEY, this.initial); } catch (e) { /* 저장 공간을 쓸 수 없는 환경 */ }
    }
    this.fitAll();
    this.refresh();
  };
  /* 계획을 통째로 바꾸되 되돌리기 기록은 잇는다(초기화·전체 지우기를 되돌리기로 복구할 수 있게) */
  app.swap = function (P) {
    if (this.P && this.P.meta.uid) P.meta.uid = this.P.meta.uid; // 같은 프로젝트로 이어 간다
    this.adopt(P);
    this.commit();
    this.fitAll();
    this.invalidate(7);
  };
  /* 이 프로젝트의 처음 상태. 저장해 둔 것이 없으면 대상지 종류에 따라 다시 만든다(지도에서 만든 대상지는 다시 만들 수 없음) */
  app.initialProject = function () {
    if (this.initial) { try { const P = JSON.parse(this.initial); if (this.validProject(P)) return P; } catch (e) { /* 아래에서 다시 만든다 */ } }
    const m = this.P.meta, k = m.scene;
    if (k === 'random') return M.sceneRandom(m.seed, m.family);
    if (k === 'blank') return M.sceneBlank(this.P.site.w, this.P.site.h);
    if (k !== 'import' && M.scenes[k]) return M.scenes[k].make();
    return null;
  };
  app.isInitial = function () { return !!this.initial && this.hist[this.hi] === this.initial; };
  /* 처음 상태에서 달라진 것이 있는가(대상지를 바꾸기 전에 물어볼지 정한다). 지난번에 하던 작업을 이어 연 경우도 '바뀐 것'으로 본다 */
  app.isEdited = function () { return !this.isInitial(); };
  app.resetProject = function () {
    const P0 = this.initialProject();
    if (!P0) return false;
    this.swap(P0);
    return true;
  };
  /* 전체 지우기: 도로·건물·시설물을 모두 지우고 같은 크기의 빈 터로. 지도 밑그림은 남는다 */
  app.clearAll = function () {
    const P = U.clone(this.P);
    P.roads = []; P.blocks = []; P.objects = [];
    P.meta.defaultUse = 'vacant';
    if (P.ctx) P.ctx.off = []; // 실제 지역: 현황 건물은 모두 되살린다
    this.swap(P);
  };
  app.isEmpty = function () { const P = this.P; return !P.roads.length && !P.objects.length && !this.D.buildings.length && !(P.ctx && P.ctx.off && P.ctx.off.length); };
  app.fitAll = function () {
    this.stopTween('2d'); this.stopTween('3d'); this._pend2 = null;
    this.r2.resize(); this.r2.fit(this.P.site, 1.14);
    if (this.r3.ok) { this.r3.resize(); this.r3.fit(this.P.site); }
    this.sec.resize();
  };
  /* 대상지 종류 k로 새 프로젝트를 연다. arg: 빈 대상지의 크기 { w, h } */
  app.setScene = function (k, arg) {
    const P = k === 'blank' && arg ? M.sceneBlank(arg.w, arg.h) : k === 'random' ? M.sceneRandom(undefined, arg && arg.family) : M.scenes[k].make();
    this.load(P);
    const ui = UDS.ui;
    if (k === 'blank') ui.toast(`빈 대상지 ${P.site.w}×${P.site.h}m를 열었습니다. 왼쪽 메뉴의 [도로 그리기]에서 도로를 골라 그리기 시작하세요.`);
    else if (k === 'random') ui.toast(`임의로 만든 대상지입니다(${{ grid: '격자형', organic: '변형 격자형', old: '구도심형' }[P.meta.pattern] || ''} · ${P.site.w}×${P.site.h}m). 왼쪽 [대상지]의 주사위를 다시 누르면 새로 만듭니다.`);
    else ui.toast(`새로 열었습니다: ${M.scenes[k].name}`);
  };

  /* ---------- 요소 쪽으로 다가가기 ---------- */
  /* 값을 부드럽게 옮긴다. key별로 하나만 움직이고, 새로 시작하거나 stopTween을 부르면 앞의 것은 멈춘다. 축척·거리는 배율로 보간한다 */
  app._tw = {};
  app.stopTween = function (key) { this._tw[key] = (this._tw[key] || 0) + 1; };
  app.tween = function (key, obj, to, ms, flag) {
    const id = (this._tw[key] = (this._tw[key] || 0) + 1);
    const still = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = {}; Object.keys(to).forEach((k) => { from[k] = obj[k]; });
    const set = (e) => { Object.keys(to).forEach((k) => { obj[k] = (k === 's' || k === 'dist') && from[k] > 0 && to[k] > 0 ? from[k] * Math.pow(to[k] / from[k], e) : from[k] + (to[k] - from[k]) * e; }); this.invalidate(flag); };
    if (!ms || still) { set(1); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (this._tw[key] !== id) return;
      const k = Math.min(1, (now - t0) / ms);
      set(1 - Math.pow(1 - k, 3));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  /* 고른 요소가 차지한 자리: 중심 c, 반지름 r, 높이 h(m). 도로는 길기 때문에 누른 자리 둘레만 본다 */
  app.focusBox = function (t, w) {
    const D = this.D, P = this.P;
    if (!t || !D) return null;
    const box = (poly, h) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      poly.forEach((q) => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
      return { c: [(x0 + x1) / 2, (y0 + y1) / 2], r: Math.max(6, Math.hypot(x1 - x0, y1 - y0) / 2), h: h || 0 };
    };
    if (t.type === 'building' || t.type === 'lot') {
      const l = D.lots.find((x) => x.id === t.id); if (!l) return null;
      return t.type === 'building' && l.building ? box(l.buildings ? [].concat(...l.buildings.map((b) => b.fp)) : l.building.fp, l.building.h) : box(l.poly, l.building ? l.building.h : 0); // 단지는 모든 동
    }
    if (t.type === 'block') {
      const b = D.blocks.find((x) => x.id === t.id); if (!b) return null;
      return box(b.poly, D.buildings.reduce((m, x) => (x.blockId === b.id ? Math.max(m, x.h) : m), 0));
    }
    if (t.type === 'road') {
      const r = this.road(t.id), info = D.roadInfo.get(t.id); if (!r || !info) return null;
      const s = w ? this.roadParam(r, w) : info.len / 2;
      return { c: U.pointAlong(r.pts, U.clamp(s, 0, info.len)).p, r: Math.max(16, info.lay.W * 1.4), h: 0 };
    }
    if (t.type === 'object') { const o = P.objects.find((x) => x.id === t.id); return o ? { c: [o.x, o.y], r: 7, h: 4 } : null; }
    if (t.type === 'ctx') { const b = this.ctxBld(t.id); return b ? box([].concat(...b.parts.map((pt) => pt.o)), b.h) : null; }
    if (t.type === 'rab') { const rb = D.rabs.find((x) => x.id === t.id); return rb ? { c: rb.c, r: rb.R2 * 1.25, h: 8 } : null; }
    if (t.type === 'tree') { const tr = this.treeOf(t.id); return tr ? { c: [tr.x, tr.y], r: 8, h: ((C.TREES[tr.species] || {}).height || 8) } : null; }
    return null;
  };
  app.flyPlan = function (fb, ms) {
    const r2 = this.r2;
    if (!(r2.W > 20 && r2.H > 20)) { this._pend2 = fb; return; } // 평면이 가려져 있으면 다시 보일 때 맞춘다
    this.tween('2d', r2.view, { cx: fb.c[0], cy: fb.c[1], s: U.clamp((Math.min(r2.W, r2.H) * 0.5) / (2 * fb.r), 0.15, 60) }, ms, 1);
  };
  app.fly3D = function (fb, ms) {
    const r3 = this.r3; if (!r3.ok) return;
    const c = r3.cam;
    const asp = r3.cssW > 20 && r3.cssH > 20 ? r3.cssW / r3.cssH : 1.4;
    const R = Math.hypot(fb.r, (fb.h || 0) / 2);
    const to = { tx: fb.c[0], tz: -fb.c[1], ty: Math.min((fb.h || 0) * 0.4, 40), dist: U.clamp(((R * 1.55) / Math.sin(c.fov / 2)) * Math.max(1, 0.9 / asp), 26, 4000) };
    if (c.pitch < 0.3) to.pitch = 0.5; // 눈높이로 보고 있었으면 조금 위에서 내려다본다
    this.tween('3d', c, to, ms, 2);
  };
  /* 요소를 더블클릭했을 때: 옆 화면(평면에서 눌렀으면 3D, 3D에서 눌렀으면 평면)이 그 요소로 다가간다.
     옆 화면이 가려져 있으면(한 화면만 볼 때) 지금 화면이 다가가고, 가려진 화면도 같은 곳을 보도록 맞춰 둔다 */
  app.focusFrom = function (from, t, w) {
    const fb = this.focusBox(t, w);
    if (!fb) return false;
    const ui = UDS.ui, other = from === '2d' ? '3d' : '2d';
    const shown = ui.viewShown(other);
    (shown ? [other] : [other, from]).forEach((k) => { const ms = ui.viewShown(k) ? 460 : 0; if (k === '2d') this.flyPlan(fb, ms); else this.fly3D(fb, ms); });
    return true;
  };

  /* ---------- 선택 ---------- */
  /* 지금 고른 요소 전부. 하나만 골랐으면 그 하나, Shift+누름으로 여럿을 골랐으면 그 묶음 */
  app.selList = function () {
    const st = this.state, m = st.multi;
    if (m && m.length > 1 && st.sel && m.some((t) => t.id === st.sel.id)) return m;
    return st.sel ? [st.sel] : [];
  };
  /* o.add: Shift+누름. 고른 묶음에 더하고, 이미 들어 있으면 뺀다 */
  app.select = function (t, o) {
    o = o || {};
    const st = this.state;
    st.back = null; // 다른 것을 고르면 '돌아가기'는 지운다(블록 정보 단추가 다시 정함)
    if (o.add) {
      if (!t) return;
      const list = this.selList().map((x) => ({ type: x.type, id: x.id }));
      const i = list.findIndex((x) => x.id === t.id);
      if (i >= 0) { list.splice(i, 1); o = { ...o, s: undefined }; } else list.push({ type: t.type, id: t.id });
      st.multi = list.length > 1 ? list : [];
      t = list.length ? list[list.length - 1] : null;
    } else st.multi = [];
    st.sel = t ? { type: t.type, id: t.id } : null;
    if (t && t.type === 'road') {
      if (st.secRoadId !== t.id) st.secS = null;
      st.secRoadId = t.id;
      if (o.s !== undefined) st.secS = o.s;
      // 도로를 누르면 도로 자체가 선택 대상이 된다(단면에서 골라 둔 구간·관은 푼다). Delete가 무엇을 지울지 헷갈리지 않게 함
      st.selSeg = t.seg || null; st.selUtil = t.seg ? null : t.util || null;
      if (st.selUtil) st.secShow.util = true;
    } else if (!o.keepSection) { st.selSeg = null; st.selUtil = null; }
    // 지표 탭을 보던 중에 건물·획지를 고르면 지표(입지 분석)를 그대로 보여 준다
    if (t) st.tab = st.tab === 'metrics' && (t.type === 'building' || t.type === 'lot') ? 'metrics' : 'props';
    const ui = UDS.ui;
    ui.secHead(); ui.pane(); ui.sheetPeek(); ui.top(); ui.selPop();
    this.invalidate(7);
  };
  app.selectSeg = function (id) {
    const st = this.state;
    st.selSeg = id; st.selUtil = null; st.sel = { type: 'road', id: st.secRoadId }; st.multi = []; st.tab = 'props';
    UDS.ui.secHead(); UDS.ui.pane(); UDS.ui.sheetPeek(); this.invalidate(7);
  };
  app.selectUtil = function (id) {
    const st = this.state;
    st.selUtil = id; st.selSeg = null; st.sel = { type: 'road', id: st.secRoadId }; st.multi = []; st.tab = 'props';
    st.secShow.util = true;
    UDS.ui.secHead(); UDS.ui.pane(); UDS.ui.sheetPeek(); this.invalidate(7);
  };

  /* ---------- 도구 ---------- */
  app.setTool = function (tool, arg) {
    const st = this.state;
    st.tool = tool; st.drawRoad = null; st.snap = null; st.hover = null; st.bldDrag = null; st.drawBld = null; st.drawWater = null; st.lenBuf = ''; st.bldHover = null; st.bldOp = null;
    if (tool === 'water' && arg && M.WATER[arg]) st.waterKind = arg;
    if (tool !== 'bldpaste') st.bldClip = null;
    if (tool === 'road' && arg) st.roadPreset = arg;
    if (tool === 'place') st.placeType = arg || st.placeType || 'tree';
    if (tool === 'build') {
      const u = (arg && C.BLD_DEFAULT[arg] ? arg : st.buildUse) || 'res';
      if (u !== st.buildUse) { st.buildOpt.floors = 0; st.buildOpt.depth = null; } // 용도를 바꾸면 층수·깊이는 그 용도의 기본값부터
      st.buildUse = u;
    }
    const pick = tool === 'select' || tool === 'move';
    this.r2.cv.style.cursor = pick ? 'default' : 'crosshair'; if (this.r3.ok) this.r3.cv.style.cursor = pick ? 'grab' : 'crosshair';
    UDS.ui.palReveal(tool, st.placeType); UDS.ui.palette(); UDS.ui.hint(); UDS.ui.selPop();
    this.invalidate(1);
  };

  /* 선택 도구: 화면 점 q 가까이(tol px)에 있는, 고른 도로의 끝 손잡이 */
  app.roadEndAt = function (q, tol) {
    const sel = this.state.sel; if (!sel || sel.type !== 'road' || this.state.multi.length) return null;
    const r = this.road(sel.id); if (!r) return null;
    const V = M.verts(r), r2 = this.r2;
    for (const i of [0, V.length - 1]) { const s = r2.w2s(V[i]); if (Math.hypot(s[0] - q[0], s[1] - q[1]) < (tol || 11)) return { road: r, i }; }
    return null;
  };
  /* 끌어 놓은 도로 끝(i: 0 또는 마지막)이 다른 도로 하나의 끝에만 닿았으면 잇는다.
     단면(구간 구성)이 같으면 한 도로로 합치고(이름은 실제 이름 쪽), 다르면 두 도로로 둔 채 끝만 맞춘다.
     다른 도로 위(T자)나 셋 이상 모이는 곳은 끝을 놓은 것만으로 이미 교차로가 된다 */
  const GENERIC_NAME = /^(새 |대로|중로|소로|이면도로|골목길|국지도로|집산도로|보조간선도로|주간선도로|간선도로|생활도로|보행자도로|보행자우선도로|단지내도로)/;
  app.joinRoadEnd = function (road, i) {
    const P = this.P, V = M.verts(road); if (!road || road.ctrl || road.inner) return null;
    const p = V[i === 0 ? 0 : V.length - 1], near = (q) => U.dist(q, p) < 0.05;
    if ((P.rabouts || []).some((rb) => rb.c && U.dist(rb.c, p) < 0.5)) return null;
    let other = null, cnt = 0;
    for (const r of P.roads) {
      if (r.id === road.id) continue;
      const W = M.verts(r), atEnd = near(W[0]) || near(W[W.length - 1]);
      let onLine = false;
      if (!atEnd) for (let k = 0; k + 1 < r.pts.length; k++) if (U.distPointSeg(p, r.pts[k], r.pts[k + 1]).d < 0.05) { onLine = true; break; }
      if (atEnd || onLine) { cnt++; if (atEnd && !r.ctrl && !r.inner) other = r; }
    }
    if (cnt !== 1 || !other) return null;
    // 단면 비교: 이 도로가 달리는 방향으로 맞춘 다른 도로의 구간(뒤집으면 좌우 차례와 차로 방향도 뒤집힘)
    const tail = i !== 0, oStart = near(other.pts[0]);
    const revB = tail ? !oStart : oStart; // 이 도로 끝 뒤로 이어 붙이려면 그 도로가 p에서 시작해야, 앞에 붙이려면 p에서 끝나야
    const segKey = (segs, rev) => JSON.stringify((rev ? segs.slice().reverse() : segs).map((g) => [g.type, U.round(g.w, 2), g.dir ? (rev ? -g.dir : g.dir) : 0]));
    if (segKey(road.segs || [], false) !== segKey(other.segs || [], revB)) return { connected: true, diff: true };
    const Bo = revB ? other.pts.slice().reverse() : other.pts.slice();
    road.pts = (tail ? road.pts.concat(Bo.slice(1)) : Bo.concat(road.pts.slice(1))).map((q) => [U.round(q[0], 2), U.round(q[1], 2)]);
    const gen = (n) => GENERIC_NAME.test(n || '');
    if (gen(road.name) && !gen(other.name)) road.name = other.name;
    P.roads = P.roads.filter((r) => r.id !== other.id);
    const st = this.state;
    if (st.secRoadId === other.id) st.secRoadId = road.id;
    st.sel = { type: 'road', id: road.id }; st.multi = [];
    return { merged: true, name: road.name, removed: other.id };
  };
  app.snapPoint = function (w, prev, excludeRoadId) {
    const P = this.P, D = this.D;
    const tol = 10 / this.r2.view.s;
    const clampSite = (p) => p; // 대상지 밖으로도 그린다(마칠 때 대상지가 도로를 품도록 넓어짐)
    let best = null, bd = tol;
    const tryPt = (p) => { const d = U.dist(w, p); if (d < bd) { bd = d; best = p; } };
    P.roads.forEach((r) => { if (r.id !== excludeRoadId) r.pts.forEach(tryPt); });
    D.nodes.forEach((n) => tryPt(n.p));
    (D.rabs || []).forEach((rb) => { if (!rb.arms) tryPt(rb.c); }); // 길과 이어지지 않은 회전교차로의 가운데
    [[0, 0], [P.site.w, 0], [P.site.w, P.site.h], [0, P.site.h]].forEach(tryPt);
    if (best) return { p: [best[0], best[1]], kind: 'node' };
    const segs = [];
    P.roads.forEach((r) => { if (r.id === excludeRoadId) return; for (let i = 0; i + 1 < r.pts.length; i++) segs.push([r.pts[i], r.pts[i + 1]]); });
    const Bd = [[0, 0], [P.site.w, 0], [P.site.w, P.site.h], [0, P.site.h]];
    for (let i = 0; i < 4; i++) segs.push([Bd[i], Bd[(i + 1) % 4]]);
    let bl = null; bd = tol;
    segs.forEach(([a, b]) => { const r = U.distPointSeg(w, a, b); if (r.d < bd) { bd = r.d; bl = { q: r.q, a, b }; } });
    if (bl) {
      let p = bl.q;
      if (prev) {
        const d = U.sub(p, prev), ang = Math.atan2(d[1], d[0]), a2 = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        if (Math.abs(ang - a2) < 0.14) {
          const X = U.lineIntersect(prev, [Math.cos(a2), Math.sin(a2)], bl.a, U.sub(bl.b, bl.a));
          if (X && U.distPointSeg(X, bl.a, bl.b).d < 0.02) p = X;
        }
      } else {
        // 선 위에서 1m 단위로
        const L = U.dist(bl.a, bl.b), t = U.dot(U.sub(p, bl.a), U.norm(U.sub(bl.b, bl.a)));
        const t2 = U.clamp(Math.round(t), 0, L);
        p = U.add(bl.a, U.mul(U.norm(U.sub(bl.b, bl.a)), t2));
      }
      return { p: [U.round(p[0], 2), U.round(p[1], 2)], kind: 'line' };
    }
    if (prev) {
      const d = U.sub(w, prev), len = U.len(d);
      const ang = Math.atan2(d[1], d[0]), a2 = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      if (len > 1 && Math.abs(ang - a2) < 0.1) {
        const L = Math.round(len);
        return { p: clampSite([U.round(prev[0] + Math.cos(a2) * L, 2), U.round(prev[1] + Math.sin(a2) * L, 2)]), kind: 'angle' };
      }
    }
    return { p: clampSite([Math.round(w[0]), Math.round(w[1])]), kind: 'grid' };
  };

  /* o.shift: Shift를 누른 채 누름(선택·이동 도구에서 여럿 고르기) */
  app.clickWorld = function (w, hit, o) {
    const st = this.state;
    if (st.tool === 'select' || st.tool === 'move') {
      const add = !!(o && o.shift);
      if (add && !hit) return; // 빈 곳을 Shift+누름: 골라 둔 것을 그대로 둔다
      if (hit && hit.type === 'road' && w) this.select(hit, { add, s: this.roadParam(this.road(hit.id), w) });
      else this.select(hit || null, { add });
    } else if (st.tool === 'erase') this.eraseAt(hit);
    else if (st.tool === 'road') { if (w) this.roadClick(w); }
    else if (st.tool === 'place') { if (w) this.placeAt(w); }
    else if (st.tool === 'build') {
      if (st.buildOpt.scope !== 'draw') this.buildAt(w, hit);
      else if (o && o.src === '3d') UDS.ui.toast('건물 모양은 평면에서 점을 찍어 그립니다.');
      else if (w) { const sp = this.bldDrawSnap(w, !!(o && o.shift)); this.bldDrawAdd(sp.p, sp.kind); }
    } else if (st.tool === 'rabout') this.raboutAt(w, hit);
    else if (st.tool === 'water') { if (o && o.src === '3d' && (st.waterKind === 'free' || st.waterKind === 'river')) UDS.ui.toast('자유형 연못·하천은 평면에서 점을 찍어 그립니다.'); else if (w) this.waterClick(w); }
    else if (st.tool === 'bldpaste') this.bldPasteAt(w, hit);
  };

  /* 회전교차로 놓기: 도로가 만나는 교차점을 누르면 그 자리에 만든다(이미 있으면 고른다). 크기·차로 수는 처음에 만나는 길의 폭에 맞춰 자동 */
  app.rabAtPoint = function (w) {
    const D = this.D; if (!w || !D) return null;
    return D.rabs.find((r) => U.dist(r.c, w) <= r.R + 1.5) || null;
  };
  app.rabCandAt = function (w, tolM) {
    const D = this.D; if (!w || !D) return null;
    let best = null, bd = tolM || 14;
    D.rabCand.forEach((c) => { const d = U.dist(c.p, w); if (d < bd) { bd = d; best = c; } });
    return best;
  };
  /* 만들어진 수목(가로수·공원·회전교차로) */
  app.treeOf = function (key) { return (this.D.trees || []).find((t) => t.key === key && t.kind !== 'free') || null; };
  app.treeRestore = function (roadId) {
    const P = this.P; if (!(P.treeOff || []).length) return 0;
    const n0 = P.treeOff.length;
    P.treeOff = [];
    this.commit();
    return n0;
  };
  /* 회전교차로 자리의 도로들에 꼭짓점을 넣어 둔다(교차점을 끌어 옮길 수 있게. 도로 모양은 그대로) */
  app.pinPoint = function (p) {
    this.P.roads.forEach((r) => {
      if (r.ctrl) { // 단지 안 길: 꺾은선이면 찍은 점에 넣고, 곡선·둥근 모서리는 중심선이 촘촘해 따로 넣지 않는다
        if (r.shape !== 'line' || r.ctrl.some((q) => U.dist(q, p) < 0.3)) return;
        for (let i = 0; i + 1 < r.ctrl.length; i++) { const q = U.distPointSeg(p, r.ctrl[i], r.ctrl[i + 1]); if (q.d < 0.3 && q.t > 0.001 && q.t < 0.999) { r.ctrl.splice(i + 1, 0, [U.round(p[0], 2), U.round(p[1], 2)]); M.reshape(r); return; } }
        return;
      }
      if (r.pts.some((q) => U.dist(q, p) < 0.3)) return;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const q = U.distPointSeg(p, r.pts[i], r.pts[i + 1]);
        if (q.d < 0.3 && q.t > 0.001 && q.t < 0.999) { r.pts.splice(i + 1, 0, [U.round(p[0], 2), U.round(p[1], 2)]); return; }
      }
    });
  };
  /* 도로 위 한 점(교차점이 아닌 곳): 가장 가까운 도로 중심선 위의 점과 그 도로 */
  app.roadPointAt = function (w) {
    let best = null, bd = Infinity;
    this.P.roads.forEach((r) => {
      const info = this.D.roadInfo.get(r.id); if (!info) return;
      for (let i = 0; i + 1 < r.pts.length; i++) { const q = U.distPointSeg(w, r.pts[i], r.pts[i + 1]); if (q.d < info.lay.W / 2 && q.d < bd) { bd = q.d; best = { r, p: q.q, W: info.lay.W, hasCar: info.lay.hasCar }; } }
    });
    return best;
  };
  app.raboutAt = function (w, hit) {
    const P = this.P, st = this.state, D = this.D;
    if (hit && hit.type === 'rab') { this.select(hit); return; }
    const ex = this.rabAtPoint(w);
    if (ex) { this.select({ type: 'rab', id: ex.id }); return; }
    let c = this.rabCandAt(w, Math.max(14, 18 / this.r2.view.s));
    if (!c && w) { // 교차점이 아닌 도로 위: 그 자리에 꼭짓점을 넣고 회전교차로를 둔다(소로·보행로도)
      const rp = this.roadPointAt(w);
      if (rp) {
        const est = (rp.r.inner ? Dv.rabAutoInner(rp.W) : Dv.rabAuto(rp.W, rp.W >= 20 ? 2 : 1)) / 2 + 3.8;
        let p = [U.round(rp.p[0], 1), U.round(rp.p[1], 1)];
        if (rp.r.ctrl && rp.r.shape !== 'line') { let bd = Infinity; rp.r.pts.forEach((q) => { const d = U.dist(q, rp.p); if (d < bd) { bd = d; p = q.slice(); } }); } // 곡선 길: 가장 가까운 중심선 꼭짓점
        const inside = p[0] > est * 0.5 && p[1] > est * 0.5 && p[0] < P.site.w - est * 0.5 && p[1] < P.site.h - est * 0.5;
        const nearJ = D.nodes.find((nd) => nd.deg >= 3 && U.dist(nd.p, p) < est);
        const hitR = D.rabs.find((rb) => U.dist(rb.c, p) < est + rb.R2 - 1);
        if (!inside) { UDS.ui.toast('대상지 경계에 너무 가깝습니다. 조금 안쪽의 도로를 눌러 주세요.'); return; }
        if (hitR) { UDS.ui.toast(`이웃 회전교차로와 너무 가깝습니다. 둘레 보도까지 겹치지 않으려면 중심 사이가 ${Math.ceil(est + hitR.R2 - 1)}m 이상이어야 합니다.`); return; }
        if (nearJ) { UDS.ui.toast('교차로에 너무 가깝습니다. 교차로에 두려면 동그라미로 표시된 교차점을 누르세요.'); return; }
        c = { p, W: rp.W, mid: true };
      }
    }
    if (!c && w) { // 길이 없는 곳(빈터·획지 안): 길과 이어지지 않은 회전교차로. 나중에 가운데로 도로를 그려 잇는다
      const est = Dv.rabAutoInner(4) / 2 + 3.3, p = [Math.round(w[0] * 2) / 2, Math.round(w[1] * 2) / 2]; // 획지 안에 두는 것은 단지 안 길의 소형 회전교차로
      if (!(p[0] > est && p[1] > est && p[0] < P.site.w - est && p[1] < P.site.h - est)) { UDS.ui.toast('대상지 경계에 너무 가깝습니다. 조금 안쪽을 눌러 주세요.'); return; }
      const hitR = D.rabs.find((rb) => U.dist(rb.c, p) < est + rb.R2 - 1);
      if (hitR) { UDS.ui.toast(`이웃 회전교차로와 너무 가깝습니다. 중심 사이가 ${Math.ceil(est + hitR.R2 - 1)}m 이상이어야 합니다.`); return; }
      c = { p, W: 4, alone: true };
    }
    if (!c) return;
    if (c.blocked) { UDS.ui.toast(`이웃 회전교차로와 너무 가깝습니다. 중심 사이가 ${U.fmt(c.dist, 0)}m인데, 둘레 보도까지 겹치지 않으려면 ${c.gap}m 이상 떨어져야 합니다.`); return; }
    const id = U.uid('rb');
    this.pinPoint(c.p);
    (P.rabouts = P.rabouts || []).push({ id, p: [U.round(c.p[0], 2), U.round(c.p[1], 2)], d: null, lanes: null, ...(c.alone ? { inner: true } : {}) });
    st.sel = { type: 'rab', id }; st.multi = []; st.tab = 'props';
    this.commit();
    const rb = this.D.rabs.find((r) => r.id === id);
    if (rb) UDS.ui.toast(rb.arms ? `회전교차로를 만들었습니다. 내접원 지름 ${U.fmt(rb.d, 0)}m · 회전차로 ${rb.lanes}개. 크기와 차로 수는 [속성]에서 바꿉니다.` : `길과 이어지지 않은 회전교차로를 만들었습니다(지름 ${U.fmt(rb.d, 0)}m). 가운데로 도로를 그리면 이어집니다.`);
  };

  /* 건물 놓기: 고른 용도의 건물을 누른 획지에 세운다. 건물은 획지 모양과 건축선 후퇴·이격에 맞춰 앉는다.
     hit는 3D에서 집은 요소(건물·획지면 그 획지), 그 밖에는 누른 자리의 획지를 쓴다 */
  /* ---------- 건물 옮기기·복사·제자리 회전·뒤집기 ---------- */
  const extentAlong = (P, A) => { let a = Infinity, b = -Infinity; P.forEach((q) => { const t = q[0] * A[0] + q[1] * A[1]; if (t < a) a = t; if (t > b) b = t; }); return [a, b]; };
  const rotV = (v, deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };
  const toF = (fr, P) => P.map((q) => Dv.toFrame(fr, q).map((x) => U.round(x, 2))); // 세계 좌표 → 획지 기준 좌표
  const BLD_KEYS = ['floors', 'groundH', 'floorH', 'front', 'side', 'depth', 'len', 'align', 'style', 'material', 'wallColor', 'wwr', 'win', 'ground', 'sign', 'canopy', 'roof', 'rot', 'flipU', 'flipV', 'poly'];
  /* 건물의 지금 설정(가구 기본값·층수 변화·입면 무작위까지 풀어 쓴 것)을 그대로 옮겨 적을 수 있게 */
  app.bldSnapshot = function (lotId) {
    const b = this.D.buildings.find((x) => x.lotId === lotId); if (!b || !b.cfg) return null;
    const cfg = b.cfg, out = {};
    BLD_KEYS.forEach((k) => { if (cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== '') out[k] = Array.isArray(cfg[k]) ? JSON.parse(JSON.stringify(cfg[k])) : cfg[k]; });
    out.floors = b.floorsSet || b.floors; // 용적률 상한으로 낮춘 층수는 원래 값으로(새 획지에서 다시 맞춤)
    if (!cfg.explicitFloors) out.floorsAuto = true;
    ['material', 'wallColor'].forEach((k) => { if (b.st && b.st[k] !== undefined) out[k] = b.st[k]; });
    return { use: b.use, bld: out };
  };
  /* 건물을 다른 획지로: move면 옛 자리를 비우고, 아니면 복사. 새 자리에서는 그 획지에 맞춰 다시 앉는다(옮긴 거리는 버림) */
  app.bldCopyTo = function (fromLot, toLot, move, snap, fpWorld, at) { // at: 놓은 자리(매개변수로 짓는 건물은 그 가까이로 옮겨 앉힘)
    if (!toLot || fromLot === toLot) return false;
    const sn = snap || this.bldSnapshot(fromLot); if (!sn) return false;
    const dst = this.lotOv(toLot); if (!dst) return false;
    const lot = this.D.lots.find((l) => l.id === toLot);
    let poly = null;
    if (sn.bld.poly && lot) { // 직접 그린 건물: 놓은 자리(없으면 새 획지 가운데)에 같은 모양으로, 획지에 맞춰
      let P = fpWorld;
      if (!P) { const src = this.D.buildings.find((x) => x.lotId === fromLot); const P0 = src ? src.fp : null; if (P0) { const c0 = U.polyCentroid(P0), c1 = U.interiorPoint(lot.poly); P = P0.map((q) => U.add(q, U.sub(c1, c0))); } }
      if (P) poly = toF(Dv.lotFrame(lot), Dv.fitInside(P, Dv.lotRoom(lot, C.PARTY_MIN)));
    }
    dst.use = sn.use; dst.bld = JSON.parse(JSON.stringify(sn.bld)); delete dst.bld.shift;
    dst.bld.noParty = true; if (!(dst.bld.side >= C.PARTY_MIN)) dst.bld.side = C.PARTY_MIN; // 새 자리에 짓는 건물은 맞벽 불가
    if (poly) dst.bld.poly = poly;
    if (move) { const src = this.lotOv(fromLot); if (src) src.bld = null; }
    if (at && !poly) { // 새 획지에 앉힌 모습에서 놓은 자리 쪽으로 옮긴다(건축선 후퇴·이격 안에서 멈춤)
      this.derive();
      const nb = this.D.buildings.find((x) => x.lotId === toLot), nl = this.D.lots.find((l) => l.id === toLot);
      if (nb && nl && !nb.cx) {
        const fr = Dv.lotFrame(nl), d = U.sub(at, U.polyCentroid(nb.fp)), sh = [U.round(U.dot(d, fr.u), 1), U.round(U.dot(d, fr.v), 1)];
        if (Math.abs(sh[0]) + Math.abs(sh[1]) > 0.2) dst.bld.shift = sh;
      }
    }
    const st = this.state;
    st.sel = { type: 'building', id: toLot }; st.multi = []; st.selSeg = null; st.selUtil = null; st.tab = 'props';
    this.commit();
    return true;
  };
  /* 제자리 회전(°, 누적)·좌우/앞뒤 뒤집기·처음대로 */
  app.bldXform = function (lotId, op, val) {
    const ov = this.lotOv(lotId); if (!ov) return;
    const sn = !ov.bld ? this.bldSnapshot(lotId) : null;
    if (!ov.bld) ov.bld = sn ? sn.bld : {};
    const B = ov.bld;
    if (B.poly) { // 직접 그린 건물: 모양을 바로 돌리거나 뒤집는다(획지를 벗어나면 줄여 맞춤)
      const lot = this.D.lots.find((l) => l.id === lotId), b = this.D.buildings.find((x) => x.lotId === lotId);
      if (!lot || !b || !(op === 'rot' || op === 'flipU' || op === 'flipV')) return;
      const fr = Dv.lotFrame(lot), ax = this.bldAxes(b, lot), c = U.polyCentroid(b.fp);
      let P = b.fp;
      if (op === 'rot') P = P.map((q) => U.add(c, rotV(U.sub(q, c), val)));
      else { const A = op === 'flipU' ? ax.u : ax.v; P = P.map((q) => U.sub(q, U.mul(A, 2 * U.dot(U.sub(q, c), A)))).reverse(); }
      B.poly = toF(fr, Dv.fitInside(P, Dv.lotRoom(lot, B.noParty ? C.PARTY_MIN : 0)));
      this.commit();
      return;
    }
    if (op === 'rot') { let r = ((+B.rot || 0) + val) % 360; if (r > 180) r -= 360; if (r <= -180) r += 360; B.rot = U.round(r, 1); if (!B.rot) delete B.rot; }
    else if (op === 'rotset') { let r = (+val || 0) % 360; if (r > 180) r -= 360; if (r <= -180) r += 360; B.rot = U.round(r, 1); if (!B.rot) delete B.rot; }
    else if (op === 'flipU' || op === 'flipV') { B[op] = !B[op]; if (!B[op]) delete B[op]; }
    else if (op === 'center') delete B.shift;
    else if (op === 'reset') { delete B.rot; delete B.flipU; delete B.flipV; delete B.shift; }
    this.commit();
  };
  /* 이동 도구로 건물을 끌 때: 같은 획지 안이면 그 안에서 옮기고(범위 끝에서 멈춤), 다른 획지에 놓으면 그리로 옮긴다(Alt·Ctrl을 누르고 놓으면 복사) */
  app.bldDragStart = function (lotId, w) {
    const b = this.D.buildings.find((x) => x.lotId === lotId), lot = this.D.lots.find((l) => l.id === lotId);
    if (!b || !lot) return null;
    if (b.cx) { if (!this._cxTold) { this._cxTold = true; UDS.ui.toast('단지(여러 동)는 끌어 옮기지 않습니다. 동 배치는 오른쪽 속성의 단지 배치·층수·동 깊이로 바꿉니다.'); } return null; }
    const ov = this.lotOv(lotId), sh0 = ov && ov.bld && Array.isArray(ov.bld.shift) ? ov.bld.shift.slice() : [0, 0];
    return { lotId, w0: w, fp0: b.fp.map((q) => q.slice()), fr: Dv.lotFrame(lot), sh0, snap: this.bldSnapshot(lotId), custom: !!b.custom, room: b.custom ? Dv.lotRoom(lot, b.cfg && b.cfg.noParty ? C.PARTY_MIN : 0) : null };
  };
  app.bldDragMove = function (g, w, copy) {
    const st = this.state, d = U.sub(w, g.w0), lot = this.lotAt(w);
    const same = lot && lot.id === g.lotId;
    if (same || !lot) {
      // 획지 안에서 옮김(획지 밖이면 원래 획지 안에서 끝까지)
      const ov = this.lotOv(g.lotId); if (!ov) return;
      if (!ov.bld) ov.bld = g.snap ? JSON.parse(JSON.stringify(g.snap.bld)) : {};
      if (g.custom) { // 직접 그린 건물: 모양을 옮긴다(획지 끝에 닿으면 그 축만 멈춤)
        const slide = (P, v) => {
          if (!(Math.abs(v[0]) + Math.abs(v[1]) > 1e-6)) return P;
          const mv = (k) => P.map((q) => [q[0] + v[0] * k, q[1] + v[1] * k]);
          if (Dv.insideArea(mv(1), g.room)) return mv(1);
          let lo = 0, hi = 1; for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (Dv.insideArea(mv(m), g.room)) lo = m; else hi = m; }
          return mv(lo);
        };
        let P = slide(g.fp0, U.mul(g.fr.u, U.dot(d, g.fr.u)));
        P = slide(P, U.mul(g.fr.v, U.dot(d, g.fr.v)));
        ov.bld.poly = toF(g.fr, P);
      } else ov.bld.shift = [U.round(g.sh0[0] + U.dot(d, g.fr.u), 1), U.round(g.sh0[1] + U.dot(d, g.fr.v), 1)];
      st.bldDrag = null;
      g.target = null;
      this.liveChange();
      return;
    }
    // 다른 획지 위: 원래 자리는 그대로 두고 옮겨 갈 모습만 보인다
    const ov = this.lotOv(g.lotId);
    if (ov && ov.bld && !g.restored) {
      if (g.custom) { if (g.snap && g.snap.bld.poly) ov.bld.poly = JSON.parse(JSON.stringify(g.snap.bld.poly)); }
      else if (g.sh0[0] || g.sh0[1]) ov.bld.shift = g.sh0.slice(); else delete ov.bld.shift;
      g.restored = true; this.liveChange();
    }
    g.target = lot.id;
    g.ghost = g.fp0.map((q) => [q[0] + d[0], q[1] + d[1]]);
    st.bldDrag = { fp: g.ghost, target: lot.id, copy: !!copy };
    this.invalidate(1);
  };
  app.bldDragEnd = function (g, copy) {
    const st = this.state; st.bldDrag = null;
    if (g.target) {
      const ok = this.bldCopyTo(g.lotId, g.target, !copy, g.snap, g.custom ? g.ghost : null, g.ghost ? U.polyCentroid(g.ghost) : null);
      if (ok) UDS.ui.toast(copy ? '건물을 복사했습니다. 새 획지에 맞춰 앉혔습니다.' : '건물을 옮겼습니다. 새 획지에 맞춰 앉혔고, 원래 획지는 비었습니다.');
      return;
    }
    this.commit();
  };
  /* 복사·옮기기 단추 → 놓을 획지를 누른다 */
  app.bldClipStart = function (lotId, mode) {
    const sn = this.bldSnapshot(lotId); if (!sn) return;
    const st = this.state;
    const b = this.D.buildings.find((x) => x.lotId === lotId);
    st.tool = 'bldpaste'; st.bldClip = { from: lotId, mode, snap: sn, n: 0, fp: b ? b.fp.map((q) => q.slice()) : null }; st.hover = null;
    if (this.r2 && this.r2.cv) this.r2.cv.style.cursor = 'copy';
    UDS.ui.hint(); UDS.ui.palette && UDS.ui.palette(); this.invalidate(7);
  };
  app.bldPasteAt = function (w, hit) {
    const st = this.state, cl = st.bldClip; if (!cl) return;
    let lot = null;
    if (hit && (hit.type === 'lot' || hit.type === 'building')) lot = this.D.lots.find((l) => l.id === hit.id) || null;
    else lot = this.lotAt(w);
    if (!lot) { UDS.ui.toast('건물은 획지 안에 놓습니다. 획지를 눌러 주세요.'); return; }
    const move = cl.mode === 'move';
    const done = (msg) => { st.tool = 'select'; st.bldClip = null; st.bldDrag = null; if (this.r2 && this.r2.cv) this.r2.cv.style.cursor = 'default'; UDS.ui.toast(msg); UDS.ui.hint(); UDS.ui.palette && UDS.ui.palette(); };
    if (lot.id === cl.from) {
      if (!move) { UDS.ui.toast('원래 건물이 있는 획지입니다. 복사할 다른 획지를 눌러 주세요.'); return; }
      // 같은 획지 안: 누른 자리로 건물 가운데를 옮긴다(건축선 후퇴·이격 범위 끝에서 멈춤)
      const b = this.D.buildings.find((x) => x.lotId === cl.from), g = b ? this.bldDragStart(cl.from, U.polyCentroid(b.fp)) : null;
      if (g) { this.bldDragMove(g, w, false); this.commit(); }
      done('건물을 옮겼습니다(같은 획지 안, 건축선 후퇴·이격 범위 안에서).');
      return;
    }
    let fpW = null;
    if (cl.snap.bld.poly && cl.fp) { const c0 = U.polyCentroid(cl.fp), at = U.pointInPoly(w, lot.poly) ? w : U.interiorPoint(lot.poly); fpW = cl.fp.map((q) => U.add(q, U.sub(at, c0))); }
    this.bldCopyTo(cl.from, lot.id, move, cl.snap, fpW, w);
    cl.n++;
    if (move) { done('건물을 옮겼습니다. 새 획지에서 누른 자리 가까이에 앉혔습니다.'); return; }
    else UDS.ui.toast(`건물을 복사했습니다(${cl.n}곳). 다른 획지를 더 누르거나 Esc로 마칩니다.`);
    UDS.ui.hint(); UDS.ui.palette && UDS.ui.palette();
  };

  /* ---------- 평면에서 건물 바로 다루기 ----------
     변 가까이에 마우스를 대면 그 변이 굵어지고, 끌면 깊이(도로 쪽·안쪽 변)나 길이(옆 변)가 바뀐다. 맞은편 변은 제자리에 둔다.
     직접 그린 건물은 그 변을 밀고 당긴다. 고른 건물 뒤쪽의 동그란 손잡이를 끌면 돈다(5° 단위, Shift 15°) */
  /* 건물의 축: u는 도로를 따라, v는 안쪽(뒤)으로. 돌린 건물은 그만큼 돈 축, 직접 그린 건물은 긴 변 가운데 획지 축에 가까운 쪽 */
  app.bldAxes = function (b, lot) {
    const fr = Dv.lotFrame(lot);
    if (!b.custom) { const r = +((b.cfg && b.cfg.rot) || 0); return { u: rotV(fr.u, r), v: rotV(fr.v, r), fr }; }
    const fp = b.fp; let li = 0, lm = -1;
    for (let i = 0; i < fp.length; i++) { const L = U.dist(fp[i], fp[(i + 1) % fp.length]); if (L > lm) { lm = L; li = i; } }
    let u = U.norm(U.sub(fp[(li + 1) % fp.length], fp[li]));
    if (Math.abs(U.dot(u, fr.u)) < Math.abs(U.dot(u, fr.v))) u = U.perpL(u);
    if (U.dot(u, fr.u) < 0) u = U.mul(u, -1);
    return { u, v: U.perpL(u), fr };
  };
  /* 변 하나의 갈래(깊이·길이)와 지금 크기 */
  app.bldEdgeInfo = function (b, n) {
    const lot = this.D.lots.find((l) => l.id === b.lotId); if (!lot) return null;
    const ax = this.bldAxes(b, lot);
    const isDepth = Math.abs(U.dot(n, ax.v)) >= Math.abs(U.dot(n, ax.u));
    const A = isDepth ? ax.v : ax.u, e = extentAlong(b.fp, A);
    return { isDepth, A, size: e[1] - e[0] };
  };
  /* 돌리기 손잡이: 건물 뒤쪽(안쪽) 변 가운데에서 화면으로 26px 떨어진 자리 */
  app.bldRotHandle = function (b) {
    const lot = this.D.lots.find((l) => l.id === b.lotId); if (!lot) return null;
    const ax = this.bldAxes(b, lot), c = U.polyCentroid(b.fp), s = this.r2.view.s;
    let m = 0; b.fp.forEach((q) => { m = Math.max(m, U.dot(U.sub(q, c), ax.v)); });
    return { c, base: U.add(c, U.mul(ax.v, m)), p: U.add(c, U.mul(ax.v, m + 26 / s)), dir: ax.v };
  };
  /* 화면 점 q에서 잡히는 건물 손잡이: 고른 건물의 돌리기 손잡이, 그다음 건물 변. o.selOnly면 고른 건물만(손가락) */
  app.bldHandleAt = function (q, tolPx, o) {
    const st = this.state, D = this.D, r2 = this.r2;
    if (!D || !r2 || !(st.tool === 'select' || st.tool === 'move')) return null;
    const s = r2.view.s, w = r2.s2w(q);
    const sel = st.sel && st.sel.type === 'building' && this.selList().length <= 1 ? D.buildings.find((x) => x.lotId === st.sel.id && !x.cx) : null;
    if (sel) { const h = this.bldRotHandle(sel); if (h && U.dist(w, h.p) * s <= tolPx + 5) return { kind: 'rot', id: sel.lotId }; }
    let best = null, bd = tolPx / s;
    const tryB = (b) => {
      if (b.cx) return; // 단지(여러 동)는 변을 끌어 크기를 바꾸지 않는다(동 배치는 속성에서)
      const fp = b.fp, bb = U.polyBounds(fp);
      if (Math.min(bb.maxx - bb.minx, bb.maxy - bb.miny) * s < 22) return; // 화면에서 작은 건물은 변을 잡지 않는다(끌면 건물째 옮겨지게)
      for (let k = 0; k < fp.length; k++) {
        const a = fp[k], c = fp[(k + 1) % fp.length];
        if (U.dist(a, c) * s < 14) continue;
        const r = U.distPointSeg(w, a, c);
        if (r.d < bd) { bd = r.d; best = { kind: 'edge', id: b.lotId, k, a, c, n: U.perpR(U.norm(U.sub(c, a))) }; }
      }
    };
    if (sel) tryB(sel);
    if (!best && !(o && o.selOnly)) D.buildings.forEach((b) => { if (b !== sel) tryB(b); });
    return best;
  };
  app.bldOpStart = function (hd, w) {
    const D = this.D, b = D.buildings.find((x) => x.lotId === hd.id), lot = D.lots.find((l) => l.id === hd.id);
    if (!b || !lot) return null;
    const ov = this.lotOv(hd.id); if (!ov) return null;
    if (!ov.bld) { const sn = this.bldSnapshot(hd.id); ov.bld = sn ? sn.bld : {}; }
    const fr = Dv.lotFrame(lot);
    const op = { kind: hd.kind, id: hd.id, w0: w, fr, lot, custom: !!b.custom, fp0: b.fp.map((q) => q.slice()) };
    if (b.custom) op.room = Dv.lotRoom(lot, b.cfg && b.cfg.noParty ? C.PARTY_MIN : 0);
    if (hd.kind === 'rot') {
      const h = this.bldRotHandle(b);
      op.c = U.polyCentroid(b.fp); op.a0 = Math.atan2(w[1] - op.c[1], w[0] - op.c[0]); op.rot0 = +ov.bld.rot || 0; op.deg = 0;
      op.ha0 = h ? Math.atan2(h.p[1] - op.c[1], h.p[0] - op.c[0]) : op.a0; op.hR = h ? U.dist(h.p, op.c) : 10;
    } else {
      const inf = this.bldEdgeInfo(b, hd.n); if (!inf) return null;
      op.n = hd.n; op.k = hd.k; op.isDepth = inf.isDepth;
      if (b.custom) { op.nf = [U.dot(hd.n, fr.u), U.dot(hd.n, fr.v)]; const e = extentAlong(b.fp, hd.n); op.size0 = e[1] - e[0]; }
      else {
        const A = inf.A, sgn = U.dot(hd.n, A) >= 0 ? 1 : -1, ext = extentAlong(b.fp, A);
        const cfg = { ...b.cfg }, axF = inf.isDepth ? fr.v : fr.u;
        // 건폐율 상한 때문에 안쪽을 줄여 지은 건물: 보이는 깊이에서 시작한다(끄는 동안 그 깊이를 값으로 적음)
        if (b.bcrFit && b.bcrDepth > 0) { op.fitDepth = Math.max(2, Math.floor(b.bcrDepth * 10) / 10); cfg.depth = op.fitDepth; }
        const base = Dv.buildFootprint(lot, cfg), full = Dv.buildFootprint(lot, { ...cfg, depth: 0, len: 0 });
        const eb = base ? extentAlong(base, axF) : ext, ef = full ? extentAlong(full, axF) : eb;
        // 잘리기 전 모양(정북 일조·단지 안 길·물에 잘린 쪽은 보이는 변과 다르다): 끄는 동안 맞은편 끝은 이 모양의 끝을 지킨다
        const xb = base ? Dv.xformBuilding(base, lot, cfg) : null, er = xb ? extentAlong(xb, A) : ext;
        Object.assign(op, { A, sgn, ext0: ext, raw0: er, size0: ext[1] - ext[0], cfg, sh0: Array.isArray(ov.bld.shift) ? ov.bld.shift.slice() : [0, 0] });
        op.k2 = eb[1] - eb[0] > 0.01 ? (er[1] - er[0]) / (eb[1] - eb[0]) : 1; // 돌려서 줄어든 비율
        op.max = ef[1] - ef[0];
        op.cap = b.bcrMax ? b.bcrMax * lot.area : Infinity; // 건폐율 상한(건축면적)
      }
    }
    this.state.bldOp = op; this.state.bldHover = null;
    return op;
  };
  app.bldOpMove = function (op, w, mods) {
    const ov = this.lotOv(op.id); if (!ov || !ov.bld) return;
    const B = ov.bld, fr = op.fr, d = U.sub(w, op.w0);
    if (op.kind === 'rot') {
      let deg = ((Math.atan2(w[1] - op.c[1], w[0] - op.c[0]) - op.a0) * 180) / Math.PI;
      while (deg > 180) deg -= 360; while (deg <= -180) deg += 360;
      const stp = mods && mods.shift ? 15 : 5; deg = Math.round(deg / stp) * stp;
      if (deg === op.deg && op.began) return;
      op.deg = deg; op.began = true;
      if (op.custom) B.poly = toF(fr, Dv.fitInside(op.fp0.map((q) => U.add(op.c, rotV(U.sub(q, op.c), deg))), op.room));
      else { let r = op.rot0 + deg; while (r > 180) r -= 360; while (r <= -180) r += 360; B.rot = U.round(r, 1); if (!B.rot) delete B.rot; }
      this.liveChange();
      return;
    }
    if (op.custom) { // 직접 그린 건물: 잡은 변을 바깥(+)·안쪽(-)으로 밀고 당긴다. 1m보다 얇아지지 않고 획지를 넘지 않는다
      let t = Math.round(U.dot(d, op.n) * 10) / 10;
      t = Math.max(t, -(op.size0 - 1));
      const k = op.k, n = op.fp0.length, mk = (tt) => op.fp0.map((q, i) => (i === k || i === (k + 1) % n ? [q[0] + op.n[0] * tt, q[1] + op.n[1] * tt] : q));
      if (!Dv.insideArea(mk(t), op.room)) { let lo = 0, hi = 1; for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (Dv.insideArea(mk(t * m), op.room)) lo = m; else hi = m; } t *= lo; }
      if (op.t === t && op.began) return;
      op.t = t; op.began = true;
      B.poly = toF(fr, mk(t));
      this.liveChange();
      return;
    }
    // 깊이·길이: 잡은 변이 따라오고, 맞은편 변은 제자리(옮김 값으로 맞춤)
    const key = op.isDepth ? 'depth' : 'len';
    // 잡은 변(보이는 끝)이 마우스를 따라가고, 맞은편은 잘리기 전 모양의 끝을 지킨다
    const raw = op.raw0 || op.ext0, moved = (op.sgn > 0 ? op.ext0[1] : op.ext0[0]) + U.dot(d, op.A);
    const size = Math.max(2, op.sgn > 0 ? moved - raw[0] : raw[1] - moved);
    let val = U.clamp(Math.round((size / op.k2) * 2) / 2, 2, op.max);
    if (val >= op.max - 0.25) val = 0; // 끝까지 늘리면 '획지에 맞춤'(0)
    const sim = (v) => { const cf = { ...op.cfg, depth: key === 'depth' ? v : op.cfg.depth, len: key === 'len' ? v : op.cfg.len, shift: op.sh0 }; const f = Dv.buildFootprint(op.lot, cf); return f ? Dv.xformBuilding(f, op.lot, cf) : null; };
    let fpN = sim(val);
    op.atCap = false;
    if (fpN && Math.abs(U.polyArea(fpN)) > op.cap * 1.0005) { // 건폐율 상한에 닿으면 거기서 멈춘다
      let lo = 2, hi = val || op.max;
      for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2, f = sim(m); if (f && Math.abs(U.polyArea(f)) <= op.cap) lo = m; else hi = m; }
      val = Math.floor(lo * 2) / 2; fpN = sim(val); op.atCap = true;
    }
    if (val === op.val && op.began) return;
    op.val = val; op.began = true;
    B[key] = val;
    if (op.fitDepth && key === 'len') B.depth = op.fitDepth;
    if (fpN) {
      const e = extentAlong(fpN, op.A), corr = op.sgn > 0 ? raw[0] - e[0] : raw[1] - e[1];
      const sh = [op.sh0[0] + corr * U.dot(op.A, fr.u), op.sh0[1] + corr * U.dot(op.A, fr.v)];
      if (Math.abs(sh[0]) + Math.abs(sh[1]) > 0.01) B.shift = [U.round(sh[0], 2), U.round(sh[1], 2)]; else delete B.shift;
    }
    this.liveChange();
  };
  app.bldOpEnd = function (op) {
    this.state.bldOp = null;
    if (!op.began) { this.invalidate(1); return; }
    this.commit();
  };
  /* 끄는 중인 변(지금 모양에서): 잡은 쪽을 가장 많이 향하고 그쪽 끝에 있는 변 */
  app.bldOpEdge = function (op, b) {
    const dir = op.custom ? op.n : U.mul(op.A, op.sgn), fp = b.fp;
    let best = null, bv = -Infinity;
    for (let k = 0; k < fp.length; k++) {
      const a = fp[k], c = fp[(k + 1) % fp.length]; if (U.dist(a, c) < 0.05) continue;
      const n = U.perpR(U.norm(U.sub(c, a))); if (U.dot(n, dir) < 0.9) continue;
      const m = U.dot(U.mid(a, c), dir); if (m > bv) { bv = m; best = { a, c, n }; }
    }
    return best;
  };

  /* ---------- 건물 직접 그리기: 점을 찍어 닫으면 그 모양의 건물(획지마다 하나) ---------- */
  app.bldDrawSnap = function (w, shift) {
    const st = this.state, D = this.D, s = this.r2.view.s, tol = 10 / s;
    const pts = (st.drawBld && st.drawBld.pts) || [], last = pts[pts.length - 1];
    if (pts.length >= 3 && U.dist(w, pts[0]) < tol) return { p: pts[0].slice(), kind: 'close' };
    let best = null, bd = tol * 0.8;
    const tryP = (p) => { const dd = U.dist(w, p); if (dd < bd) { bd = dd; best = p; } };
    D.lots.forEach((l) => l.poly.forEach(tryP));
    D.buildings.forEach((b) => b.fp.forEach(tryP));
    pts.slice(1).forEach(tryP);
    if (best) return { p: [U.round(best[0], 2), U.round(best[1], 2)], kind: 'vertex' };
    let p = w, kind = 'free';
    const lotEdgeNear = (pt, tl) => { let bl = null, be = tl; D.lots.forEach((l) => { for (let i = 0; i < l.poly.length; i++) { const a = l.poly[i], c = l.poly[(i + 1) % l.poly.length], r = U.distPointSeg(pt, a, c); if (r.d < be) { be = r.d; bl = { q: r.q, a, c }; } } }); return bl; };
    if (last) {
      const lot = this.lotAt(pts[0]) || this.lotAt(w), ax = lot ? Dv.lotFrame(lot).u : [1, 0], d = U.sub(w, last);
      if (U.len(d) > 1e-3) {
        const a0 = Math.atan2(ax[1], ax[0]), a = Math.atan2(d[1], d[0]), stp = shift ? Math.PI / 12 : Math.PI / 2;
        const sa = a0 + Math.round((a - a0) / stp) * stp, dev = Math.abs(Math.atan2(Math.sin(a - sa), Math.cos(a - sa)));
        if (shift || dev < 0.1) { // 획지 축(도로 방향·직각)에 맞춘다. Shift는 15° 단위
          const dir = [Math.cos(sa), Math.sin(sa)];
          p = U.add(last, U.mul(dir, Math.max(0, U.dot(d, dir)))); kind = 'axis';
          if (pts.length >= 2) { const X = U.lineIntersect(last, dir, pts[0], U.perpL(dir)); if (X && U.dist(X, p) < tol) { p = X; kind = 'square'; } } // 첫 점과 직각으로 닫히는 자리
          if (kind === 'axis') { const e = lotEdgeNear(p, tol * 0.7); if (e) { const X = U.lineIntersect(last, dir, e.a, U.sub(e.c, e.a)); if (X && U.dist(X, p) < tol) { p = X; kind = 'edge'; } } }
        }
      }
    }
    if (kind === 'free') { const e = lotEdgeNear(w, tol * 0.6); if (e) { p = e.q; kind = 'edge'; } }
    return { p: [U.round(p[0], 2), U.round(p[1], 2)], kind };
  };
  app.bldDrawAdd = function (p, kind) {
    const st = this.state, dr = st.drawBld || (st.drawBld = { pts: [], cursor: null });
    const pts = dr.pts;
    if (pts.length >= 3 && (kind === 'close' || U.dist(p, pts[0]) < 0.05)) { this.bldDrawFinish(); return; }
    if (pts.length && U.dist(p, pts[pts.length - 1]) < 0.05) { if (pts.length >= 3) this.bldDrawFinish(); return; } // 같은 자리를 다시 누르면 닫는다
    pts.push([U.round(p[0], 2), U.round(p[1], 2)]); dr.cursor = null; this.state.lenBuf = '';
    UDS.ui.hint(); this.invalidate(1);
  };
  app.bldDrawFinish = function () {
    const st = this.state, dr = st.drawBld;
    st.drawBld = null; st.lenBuf = '';
    UDS.ui.hint(); this.invalidate(1);
    if (!dr || dr.pts.length < 3) { if (dr && dr.pts.length) UDS.ui.toast('점을 셋 이상 찍어야 건물이 됩니다.'); return; }
    let pts = U.cleanPoly(dr.pts.map((q) => q.slice()));
    const n = pts.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (U.segIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n], -1e-7)) { UDS.ui.toast('변이 서로 엇갈렸습니다. 꺾이는 점을 차례로 찍어 다시 그려 주세요.'); return; }
    }
    if (n < 3 || Math.abs(U.polyArea(pts)) < 10) { UDS.ui.toast('건물이 너무 작습니다. 바닥 넓이 10㎡ 이상으로 그려 주세요.'); return; }
    if (U.polyArea(pts) < 0) pts = pts.reverse();
    let lot = this.lotAt(U.interiorPoint(pts));
    if (!lot) { let bn = 0; this.D.lots.forEach((l) => { const k = pts.filter((q) => U.pointInPoly(q, l.poly)).length; if (k > bn) { bn = k; lot = l; } }); }
    if (!lot) { UDS.ui.toast('건물은 획지 안에 그립니다. 도로가 아닌 가구 안에 그려 주세요.'); return; }
    const use = st.buildUse, def = C.BLD_DEFAULT[use] || C.BLD_DEFAULT.res, bo = st.buildOpt;
    const ov = this.lotOv(lot.id); if (!ov) return;
    const same = !!lot.building && lot.use === use, replaced = lot.building && !same ? (C.USES[lot.use] || {}).name : '';
    const floors = bo.floors > 0 ? bo.floors : same ? lot.building.floors : def.floors, fAuto = !(bo.floors > 0) && !(same && lot.building.cfg && lot.building.cfg.explicitFloors);
    const keep = same ? { ...(ov.bld || {}) } : { groundH: def.groundH, floorH: def.floorH, front: def.front, side: Math.max(def.side, C.PARTY_MIN), style: def.style };
    ['depth', 'len', 'align', 'rot', 'flipU', 'flipV', 'shift'].forEach((k) => delete keep[k]);
    const room = Dv.lotRoom(lot, C.PARTY_MIN), inside = Dv.insideArea(pts, room); // 새로 그린 건물은 맞벽 불가: 인접 대지경계선에서 띄운 범위
    ov.use = use;
    ov.bld = { ...keep, floors, poly: toF(Dv.lotFrame(lot), pts), noParty: true };
    if (fAuto) ov.bld.floorsAuto = true; else delete ov.bld.floorsAuto;
    st.sel = { type: 'building', id: lot.id }; st.multi = []; st.selSeg = null; st.selUtil = null; st.tab = 'props';
    this.commit();
    const b = this.D.buildings.find((x) => x.lotId === lot.id);
    if (!b) { UDS.ui.toast('획지 안에 들어가는 부분이 너무 작아 건물이 생기지 않았습니다.'); return; }
    UDS.ui.toast(`${C.USES[use].name} 건물을 그렸습니다(바닥 ${U.fmt(b.area, 0)}㎡ · ${b.floors}층)${inside ? '' : `. 획지를 넘거나 인접 대지경계선에서 ${C.PARTY_MIN}m 안에 든 부분은 잘랐습니다(새 건물은 맞벽 불가)`}${replaced ? `. 있던 ${replaced} 건물을 바꿨습니다` : ''}. ${UDS.ui.undoTip()}`);
  };

  /* ---------- 그리는 중인 도로·건물: 숫자를 치면 지금 방향으로 그 길이만큼 정확히 놓는다 ---------- */
  app.activeDraw = function () {
    const st = this.state;
    if (st.tool === 'road' && st.drawRoad && st.drawRoad.pts && st.drawRoad.pts.length) return st.drawRoad;
    if (st.tool === 'build' && st.buildOpt.scope === 'draw' && st.drawBld && st.drawBld.pts.length) return st.drawBld;
    return null;
  };
  /* 다음 점의 방향: 마우스 쪽, 마우스가 마지막 점 위면 앞 변의 방향 */
  app.drawDir = function (dr) {
    const last = dr.pts[dr.pts.length - 1], cur = dr.cursor;
    if (cur && U.dist(cur, last) > 1e-6) return U.norm(U.sub(cur, last));
    if (dr.pts.length >= 2) return U.norm(U.sub(last, dr.pts[dr.pts.length - 2]));
    return null;
  };
  /* 미리보기의 끝점: 길이를 치고 있으면 그 길이로 */
  app.drawCursor = function (dr) {
    if (!dr) return null;
    const L = parseFloat(this.state.lenBuf), last = dr.pts[dr.pts.length - 1];
    if (!(L > 0) || !last) return dr.cursor;
    const dir = this.drawDir(dr); if (!dir) return dr.cursor;
    return [last[0] + dir[0] * L, last[1] + dir[1] * L];
  };
  app.drawTyped = function () {
    const st = this.state, L = parseFloat(st.lenBuf), dr = this.activeDraw();
    st.lenBuf = '';
    if (!dr || !(L > 0)) { UDS.ui.hint(); this.invalidate(1); return; }
    const dir = this.drawDir(dr);
    if (!dir) { UDS.ui.toast('마우스로 방향을 먼저 정한 뒤 길이를 치세요.'); UDS.ui.hint(); return; }
    const last = dr.pts[dr.pts.length - 1], p = [U.round(last[0] + dir[0] * L, 3), U.round(last[1] + dir[1] * L, 3)];
    if (dr === st.drawRoad) {
      // 다른 도로·대상지 경계에 딱 닿으면 거기서 마친다
      const sp = this.snapPoint(p, last), on = (sp.kind === 'node' || sp.kind === 'line') && U.dist(sp.p, p) < 0.05;
      dr.pts.push(on ? sp.p : p); dr.cursor = null; st.snap = null;
      if (on) { this.finishRoad(); return; }
      UDS.ui.hint(); this.invalidate(1);
    } else this.bldDrawAdd(p, null);
  };

  app.buildAt = function (w, hit) {
    const st = this.state, use = st.buildUse, def = C.BLD_DEFAULT[use];
    if (!def) return;
    let lot = null;
    if (hit && hit.type === 'ctx') { const b = this.ctxBld(hit.id); if (b) w = b.c; hit = null; } // 현황 건물을 누르면 그 건물이 선 획지
    if (hit && (hit.type === 'lot' || hit.type === 'building')) lot = this.D.lots.find((l) => l.id === hit.id) || null;
    else if (!(hit && hit.type === 'road')) lot = this.lotAt(w);
    if (!lot) { UDS.ui.toast('건물은 획지 안에 놓습니다. 가구 안의 획지를 눌러 주세요.'); return; }
    const name = C.USES[use].name;
    const bo = st.buildOpt; // 왼쪽 메뉴에서 정한 층수·길이·깊이(비어 있으면 용도 기본값)
    const custom = bo.floors > 0 || bo.len > 0 || bo.depth != null;
    if (lot.building && lot.use === use && !custom) { // 같은 용도의 건물이 이미 있고 크기를 따로 정하지 않았으면 고르기만 한다(바꿔 둔 층수·입면을 덮어쓰지 않음)
      this.select({ type: 'building', id: lot.id });
      UDS.ui.toast(`이 획지에는 이미 ${name} 건물이 있습니다. 층수와 입면은 오른쪽 속성에서 바꿉니다.`);
      return;
    }
    if (st.buildOpt.scope === 'block') { this.fillBlockAt(lot.blockId, use); return; }
    const ov = this.lotOv(lot.id); if (!ov) return;
    const prev = C.USES[lot.use] || {};
    const replaced = lot.building ? prev.name : '';
    const opened = !lot.building && prev.open && lot.use !== 'vacant' ? prev.name : ''; // 공원·광장·주차장 자리에 세우는 경우
    // 고른 용도의 기본값을 획지에 직접 적어, 가구 기본값(층수·입면)과 상관없이 고른 유형 그대로 서게 한다
    ov.use = use;
    const same = lot.building && lot.use === use;
    const size = { floors: bo.floors > 0 ? bo.floors : def.floors, depth: bo.depth != null ? bo.depth : def.depth, len: bo.len > 0 ? bo.len : 0 };
    // 같은 용도의 건물이면 입면·높이 설정은 두고 크기만 바꾸고, 다른 용도면 고른 용도의 기본값으로 새로 세운다
    // 새로 세우는 건물은 맞벽 불가(옆·뒤 이격 C.PARTY_MIN 이상). 같은 용도의 크기만 바꾸는 건물은 있던 이격 그대로
    ov.bld = same ? { ...(ov.bld || {}), ...size } : { floors: size.floors, groundH: def.groundH, floorH: def.floorH, front: def.front, side: Math.max(def.side, C.PARTY_MIN), depth: size.depth, len: size.len, style: def.style, noParty: true };
    if (!ov.bld.len) delete ov.bld.len;
    if (bo.floors > 0) delete ov.bld.floorsAuto; else ov.bld.floorsAuto = true; // 기본 층수는 용도지역 용적률 상한까지만
    st.sel = { type: 'building', id: lot.id }; st.multi = []; st.selSeg = null; st.selUtil = null; st.tab = 'props';
    const demo0 = this.ctxDemo();
    this.commit();
    const demoNote = this.ctxDemoNote(demo0);
    const now = this.D.lots.find((l) => l.id === lot.id);
    if (now && !now.building) UDS.ui.toast('획지가 좁아 건물이 들어가지 않습니다. 오른쪽 속성에서 건축선 후퇴·이격을 줄이거나 획지를 넓혀 주세요.');
    else if (same) UDS.ui.toast(`${name} 건물의 크기를 바꿨습니다(${size.floors}층${size.len ? ` · 길이 ${size.len}m` : ''}${size.depth ? ` · 깊이 ${size.depth}m` : ''}). ${UDS.ui.undoTip()}`);
    else if (replaced) UDS.ui.toast(`${replaced} 건물을 ${name} 건물로 바꿨습니다. ${UDS.ui.undoTip()}`);
    else if (opened) UDS.ui.toast(`${opened} 획지를 ${name} 용도로 바꾸고 건물을 세웠습니다. ${UDS.ui.undoTip()}`);
    else if (demoNote) UDS.ui.toast(`${name} 건물을 세웠습니다.${demoNote} ${UDS.ui.undoTip()}`);
  };
  /* 실제 지역: 새 계획으로 철거되는 현황 건물 수와, 늘어난 만큼의 안내 문구 */
  app.ctxDemo = function () { return this.D && this.D.ctxV ? this.D.ctxV.demo.size : 0; };
  app.ctxDemoNote = function (before) { const d = this.ctxDemo() - (before || 0); return d > 0 ? ` 그 자리의 현황 건물 ${d}동은 철거된 것으로 보고 점선 윤곽만 남깁니다.` : ''; };

  /* ---------- 가구 자동 채우기 ----------
     가구 안의 획지마다 용도 기본값의 건축선 후퇴·이격을 지켜 건물을 세우고, 건폐율 상한을 넘으면 건물 깊이를 줄이며,
     용적률 목표에 맞춰 층수를 정한다(최고 층수 이하). 공원·광장·주차장으로 바꿔 둔 획지는 그대로 둔다(o.all이면 그것까지 채움) */
  app.fillTargets = function (use) {
    const st = this.state;
    if (!st.fillT[use]) st.fillT[use] = { ...(C.FILL_DEFAULT[use] || C.FILL_DEFAULT.res) };
    return st.fillT[use];
  };
  app.fillBlock = function (blockId, use, o) {
    o = o || {};
    const D = this.D, blk = D.blocks.find((b) => b.id === blockId), def = C.BLD_DEFAULT[use];
    if (!blk || !def) return null;
    const S = blk.settings, T = o.T || this.fillTargets(use);
    const Zf = C.ZONES[C.zoneOf(use, S.zone)] || { bcr: 100, far: 9999 }; // 용도지역 상한을 넘지 않게
    const bcr = U.clamp(Math.min(+T.bcr || 60, Zf.bcr), 5, 100) / 100, far = Math.max(0.1, Math.min(+T.far || 200, Zf.far) / 100), fmax = U.clamp(Math.round(+T.fmax || 7), 1, 80);
    const side = Math.max(def.side, C.PARTY_MIN); // 새로 짓는 건물이라 맞벽 불가
    const lots = D.lots.filter((l) => l.blockId === blockId);
    const next = {};
    const r = { n: lots.length, built: 0, kept: 0, small: 0 };
    lots.forEach((l) => {
      const ov = (S.lots && S.lots[l.key]) || {};
      if (!o.all && ov.use && ov.use !== 'vacant' && C.USES[ov.use] && C.USES[ov.use].open) { next[l.key] = ov; r.kept++; return; }
      // 건물이 들어가지 않는 작은 획지는 빈 터로(건폐율 상한까지 줄인 바닥이 20㎡ 미만)
      const fp = Dv.footprint(l, { front: def.front, side, depth: def.depth || 0 }), A = fp ? Math.min(Math.abs(U.polyArea(fp)), bcr * l.area) : 0;
      if (!fp || A < 20) { next[l.key] = { use: 'vacant' }; r.small++; return; }
      r.built++;
    });
    /* 층수·깊이는 획지마다 계산(Dv: 용적률 맞춤) — 용적률 목표를 채우는 가장 적은 층수에서 건폐율이 가장 크게. 도로를 고쳐 획지가 바뀌어도 다시 맞춘다 */
    S.use = use; S.bld = { fit: { bcr: Math.round(bcr * 100), far: Math.round(far * 100), fmax }, side, noParty: true }; S.lots = next;
    S.fill = { use, bcr: Math.round(bcr * 100), far: Math.round(far * 100), fmax };
    delete S.auto; // 획지 수는 지금 모습으로 굳힌다
    return r;
  };
  /* 건물 놓기 도구가 '가구 전체'일 때: 누른 획지가 든 가구를 채운다 */
  app.fillBlockAt = function (blockId, use) {
    const r = this.fillBlock(blockId, use);
    if (!r) return;
    const st = this.state;
    st.sel = { type: 'block', id: blockId }; st.multi = []; st.selSeg = null; st.selUtil = null; st.tab = 'props';
    const demo0 = this.ctxDemo();
    this.commit();
    UDS.ui.toast(this.fillMsg(r, use, this.ctxDemoNote(demo0)));
  };
  app.fillMsg = function (r, use, extra) {
    const T = this.fillTargets(use), nm = C.USES[use].name;
    return `${nm} 건물 ${r.built}동으로 채웠습니다(건폐율 ${T.bcr}% · 용적률 ${T.far}% 이하 · 최고 ${T.fmax}층).` +
      (r.kept ? ` 공원·광장 등 ${r.kept}곳은 그대로 두었습니다.` : '') + (r.small ? ` 작은 획지 ${r.small}곳은 빈 터로 남겼습니다.` : '') + (extra || '') + ` ${UDS.ui.undoTip()}`;
  };
  /* 실제 지역: 가구들 안에 서 있는 (보이는) 현황 건물 수 */
  app.ctxInBlocks = function (ids) {
    const cx = this.ctxData(), V = this.D && this.D.ctxV; if (!cx || !V) return 0;
    const polys = this.D.blocks.filter((b) => ids.includes(b.id)).map((b) => b.poly);
    return cx.bld.filter((b) => UDS.Ctx.shown(V, b.id) && polys.some((p) => U.pointInPoly(b.c, p))).length;
  };
  /* 빈 가구: 건물이 하나도 없고 빈 터(나대지)인 가구. 도로에 닿지 않은 터(빈 대상지를 통째로 덮은 가구)는 뺀다 */
  app.vacantBlocks = function () {
    const D = this.D;
    return D.blocks.filter((b) => b.settings.use === 'vacant' && b.roads.length && !D.buildings.some((x) => x.blockId === b.id));
  };
  app.fillVacant = function (use) {
    const list = this.vacantBlocks().map((b) => b.id);
    let built = 0;
    list.forEach((id) => { const r = this.fillBlock(id, use); if (r) built += r.built; });
    if (!list.length) return { blocks: 0, built: 0 };
    this.state.sel = null; this.state.multi = [];
    const demo0 = this.ctxDemo();
    this.commit();
    return { blocks: list.length, built, demo: this.ctxDemo() - demo0 };
  };

  app.roadClick = function (w) {
    const st = this.state;
    const dr = st.drawRoad && st.drawRoad.pts ? st.drawRoad : (st.drawRoad = { pts: [], cursor: null });
    const last = dr.pts[dr.pts.length - 1];
    const sp = this.snapPoint(w, last || null);
    if (last && U.dist(last, sp.p) < 0.6) { this.finishRoad(); return; }
    dr.pts.push(sp.p); dr.cursor = null; st.snap = null;
    if (dr.pts.length >= 2 && (sp.kind === 'node' || sp.kind === 'line')) { this.finishRoad(); return; }
    UDS.ui.hint();
    this.invalidate(1);
  };
  app.finishRoad = function () {
    const st = this.state, dr = st.drawRoad;
    st.drawRoad = null; st.snap = null;
    if (!dr || !dr.pts || dr.pts.length < 2 || U.polylineLength(dr.pts) < 3) { UDS.ui.hint(); this.invalidate(1); return; }
    const key = st.roadPreset;
    const fn = C.PRESETS[key].fn;
    // 이어 그리기: 같은 유형 도로의 끝에서 그 도로가 나아가던 쪽(60° 안)으로 그리면 새 도로 대신 그 도로를 늘린다
    const p0 = dr.pts[0], d0 = U.norm(U.sub(dr.pts[1], p0));
    let ext = null, bc = 0.5;
    const inner = !!C.PRESETS[key].inner, shape = inner ? st.innerShape[key] || C.PRESETS[key].shape : null;
    this.P.roads.forEach((r) => {
      const V = M.verts(r);
      if (r.preset !== key || V.length < 2 || (inner && r.shape !== shape)) return;
      const m = V.length;
      [[0, 1], [m - 1, m - 2]].forEach(([i, j]) => {
        if (U.dist(V[i], p0) > 0.35) return;
        const c = U.dot(U.norm(U.sub(V[i], V[j])), d0);
        if (c > bc) { bc = c; ext = { r, atStart: i === 0 }; }
      });
    });
    let road;
    if (ext) {
      road = ext.r;
      const add = dr.pts.slice(1).map((p) => [p[0], p[1]]);
      const V0 = M.verts(road), V = ext.atStart ? add.reverse().concat(V0) : V0.concat(add);
      // 곧게 이어진 꼭짓점은 없앤다(한 줄 도로)
      for (let i = V.length - 2; i >= 1; i--) {
        const a = U.norm(U.sub(V[i], V[i - 1])), b = U.norm(U.sub(V[i + 1], V[i]));
        if (U.dot(a, b) > 0.99985) V.splice(i, 1);
      }
      if (road.ctrl) { road.ctrl = V; M.reshape(road); } else road.pts = V;
    } else {
      const n = this.P.roads.filter((r) => r.fn === fn).length + 1;
      road = M.makeRoad(key, dr.pts, inner ? { name: `${C.FN[fn].name} ${n}`, shape } : { name: `새 ${C.FN[fn].name} ${n}`, scheme: 'separate', trees: { on: fn !== 'local' && fn !== 'shared' } });
      this.P.roads.push(road);
    }
    st.tool = 'select';
    this.r2.cv.style.cursor = 'default';
    st.sel = { type: 'road', id: road.id }; st.multi = []; st.secRoadId = road.id; st.secS = null; st.selSeg = null; st.selUtil = null; st.tab = 'props';
    const w0 = this.P.site.w, h0 = this.P.site.h;
    if (this.commit() === false) { // 대상지가 너무 넓어져 물렸다
      if (!this.road(road.id)) { st.sel = null; st.secRoadId = null; this.refresh(); }
      UDS.ui.palette();
      return;
    }
    UDS.ui.palette();
    const grew = this.P.site.w !== w0 || this.P.site.h !== h0;
    if (ext && !grew) UDS.ui.toast(`${road.name}을(를) 이어 그렸습니다. 길이 ${U.fmt(U.polylineLength(road.pts), 0)}m`);
    else if (!grew && this.D.deadEnds.some((d) => d.roadId === road.id)) UDS.ui.toast('도로 끝이 다른 도로나 대상지 경계에 닿지 않았습니다. 도로를 골라 끝 손잡이를 끌어 이어 주세요.');
    else if (inner && !grew) UDS.ui.toast(`${road.name}을(를) 그렸습니다(${C.SHAPES[road.shape] || ''} · 폭 ${U.fmt(Dv.roadWidth(road), 1)}m · 길이 ${U.fmt(U.polylineLength(road.pts), 0)}m). 가구는 나누지 않고, 지나는 자리의 건물은 길에서 물러납니다. 모양·폭은 오른쪽 [속성]에서 바꿉니다.`);
  };
  app.cancelDraw = function () { const st = this.state; st.drawRoad = null; st.snap = null; UDS.ui.hint(); this.invalidate(1); };

  /* ---------- 수공간(조경) ----------
     원형·둥근 사각 연못은 누른 자리에 기본 크기로 놓고([속성]에서 크기), 자유형 연못·하천은 점을 차례로 찍어 그린다(찍은 점을 지나는 곡선) */
  app.waterClick = function (w) {
    const st = this.state, P = this.P, kind = st.waterKind || 'circle';
    const p = [Math.round(w[0] * 2) / 2, Math.round(w[1] * 2) / 2];
    if (kind === 'circle' || kind === 'rect') {
      const o = kind === 'circle' ? { id: U.uid('w'), kind, c: p, r: 6 } : { id: U.uid('w'), kind, c: p, w: 18, h: 10, rot: 0, cr: 2.5 };
      (P.waters = P.waters || []).push(o);
      st.sel = { type: 'water', id: o.id }; st.multi = []; st.tab = 'props';
      this.commit();
      UDS.ui.toast(`${M.WATER[kind]}을 놓았습니다(${kind === 'circle' ? '지름 12m' : '18×10m · 모서리 반지름 2.5m'}). 크기는 오른쪽 [속성]에서, 자리는 [이동] 도구로 끌어 바꿉니다. ${UDS.ui.undoTip()}`);
      return;
    }
    const dr = st.drawWater && st.drawWater.pts ? st.drawWater : (st.drawWater = { kind, pts: [], cursor: null });
    dr.kind = kind;
    if (kind === 'free' && dr.pts.length >= 3 && U.dist(p, dr.pts[0]) < Math.max(1.5, 12 / this.r2.view.s)) { this.waterFinish(); return; } // 첫 점을 누르면 닫는다
    if (dr.pts.length && U.dist(p, dr.pts[dr.pts.length - 1]) < 0.4) { this.waterFinish(); return; } // 같은 자리를 다시 누르면 마친다
    dr.pts.push(p); dr.cursor = null;
    UDS.ui.hint(); this.invalidate(1);
  };
  app.waterFinish = function () {
    const st = this.state, dr = st.drawWater, P = this.P;
    st.drawWater = null;
    if (!dr || !dr.pts) { UDS.ui.hint(); this.invalidate(1); return; }
    const need = dr.kind === 'free' ? 3 : 2;
    if (dr.pts.length < need) { UDS.ui.toast(dr.kind === 'free' ? '점을 셋 이상 찍어야 연못이 됩니다.' : '점을 둘 이상 찍어야 하천이 됩니다.'); UDS.ui.hint(); this.invalidate(1); return; }
    const o = { id: U.uid('w'), kind: dr.kind, ctrl: dr.pts.map((q) => q.slice()) };
    if (dr.kind === 'river') { o.w = 12; o.depth = Dv.RIVER_DEPTH; }
    (P.waters = P.waters || []).push(o);
    st.sel = { type: 'water', id: o.id }; st.multi = []; st.tab = 'props';
    this.commit();
    const nb = (this.D.bridges || []).filter((g) => g.waterId === o.id).length;
    UDS.ui.toast(dr.kind === 'river'
      ? `하천(폭 12m · 깊이 ${Dv.RIVER_DEPTH}m)을 그렸습니다.${nb ? ` 도로·길이 건너는 ${nb}곳은 다리로 그렸습니다.` : ''} 폭·깊이·천변공원은 [속성]에서, 모양은 [이동] 도구로 점을 끌어 고칩니다. ${UDS.ui.undoTip()}`
      : `자유형 연못을 그렸습니다(찍은 점을 지나는 곡선). 모양은 [이동] 도구로 점을 끌어 고칩니다. ${UDS.ui.undoTip()}`);
  };
  app.waterCancel = function () { this.state.drawWater = null; UDS.ui.hint(); this.invalidate(1); };

  app.placeAt = function (w) {
    const st = this.state, P = this.P;
    const type = st.placeType || 'tree';
    let rot = 0, bd = Infinity;
    P.roads.forEach((r) => { for (let i = 0; i + 1 < r.pts.length; i++) { const q = U.distPointSeg(w, r.pts[i], r.pts[i + 1]); if (q.d < bd) { bd = q.d; const to = U.sub(q.q, w); rot = U.len(to) > 0.01 ? Math.atan2(to[1], to[0]) + Math.PI / 2 : Math.atan2(r.pts[i + 1][1] - r.pts[i][1], r.pts[i + 1][0] - r.pts[i][0]); } } });
    const o = { id: U.uid('o'), type, x: U.round(w[0], 2), y: U.round(w[1], 2), rot: U.round(rot, 3) };
    if (type === 'tree') { o.species = st.treeSpecies; o.rot = 0; }
    if (type === 'shrub') { o.r = 1.6; o.rot = 0; }
    P.objects.push(o);
    st.sel = { type: 'object', id: o.id }; st.multi = []; st.tab = 'props';
    this.commit();
  };

  app.eraseAt = function (hit) {
    if (!hit) return;
    const P = this.P;
    if (hit.type === 'object') P.objects = P.objects.filter((o) => o.id !== hit.id);
    else if (hit.type === 'road') P.roads = P.roads.filter((r) => r.id !== hit.id);
    else if (hit.type === 'building') { const ov = this.lotOv(hit.id); if (ov) ov.bld = null; }
    else if (hit.type === 'lot') { const ov = this.lotOv(hit.id); if (ov) { ov.use = 'vacant'; } }
    else if (hit.type === 'ctx') { if (!P.ctx) return; P.ctx.off = (P.ctx.off || []).filter((x) => x !== hit.id).concat([hit.id]); }
    else if (hit.type === 'rab') P.rabouts = (P.rabouts || []).filter((r) => r.id !== hit.id);
    else if (hit.type === 'water') P.waters = (P.waters || []).filter((w) => w.id !== hit.id);
    else if (hit.type === 'tree') { P.treeOff = (P.treeOff || []).filter((k) => k !== hit.id).concat([hit.id]); }
    else return;
    if (this.state.sel && this.state.sel.id === hit.id) this.state.sel = null;
    this.commit();
  };
  /* 지운 현황 건물을 모두 되살린다 */
  app.ctxRestoreAll = function () {
    const P = this.P; if (!P.ctx || !(P.ctx.off || []).length) return 0;
    const n = P.ctx.off.length; P.ctx.off = []; this.commit(); return n;
  };
  /* Delete: 고른 것을 바로 지운다. 여럿을 골랐으면 한꺼번에(되돌리기 한 번으로 복구) */
  app.deleteSelected = function () {
    const list = this.selList();
    if (list.length > 1) { this.eraseMany(list); return; }
    const t = this.state.sel; if (!t) return;
    if (t.type === 'road' && this.state.selSeg) { this.removeSeg(this.state.selSeg); return; }
    if (t.type === 'road' && this.state.selUtil) { this.removeUtil(this.state.selUtil); return; }
    if (t.type === 'block') { UDS.ui.toast('가구는 둘레의 도로로 정해집니다. 도로를 지우거나 옮기면 가구가 바뀝니다.'); return; }
    this.eraseAt(t);
  };
  app.eraseMany = function (list) {
    const P = this.P, st = this.state;
    const n = { road: 0, bld: 0, lot: 0, obj: 0, ctx: 0, rab: 0 };
    const roads = new Set(), objs = new Set();
    list.forEach((t) => {
      if (t.type === 'ctx') { if (P.ctx && !(P.ctx.off || []).includes(t.id)) { P.ctx.off = (P.ctx.off || []).concat([t.id]); n.ctx++; } return; }
      if (t.type === 'rab') { const k = (P.rabouts || []).length; P.rabouts = (P.rabouts || []).filter((r) => r.id !== t.id); if (P.rabouts.length < k) n.rab++; return; }
      if (t.type === 'water') { const k = (P.waters || []).length; P.waters = (P.waters || []).filter((w) => w.id !== t.id); if (P.waters.length < k) n.rab++; return; }
      if (t.type === 'tree') { if (!(P.treeOff || []).includes(t.id)) { P.treeOff = (P.treeOff || []).concat([t.id]); n.tree = (n.tree || 0) + 1; } return; }
      if (t.type === 'object') { objs.add(t.id); n.obj++; }
      else if (t.type === 'road') { roads.add(t.id); n.road++; }
      else if (t.type === 'building') { const ov = this.lotOv(t.id); if (ov) { ov.bld = null; n.bld++; } }
      else if (t.type === 'lot') { const ov = this.lotOv(t.id); if (ov) { ov.use = 'vacant'; n.lot++; } }
    });
    if (!(n.road + n.bld + n.lot + n.obj + n.ctx + n.rab + (n.tree || 0))) return;
    if (objs.size) P.objects = P.objects.filter((o) => !objs.has(o.id));
    if (roads.size) P.roads = P.roads.filter((r) => !roads.has(r.id));
    st.sel = null; st.multi = []; st.selSeg = null; st.selUtil = null;
    this.commit();
    const parts = [];
    if (n.road) parts.push(`도로 ${n.road}개`);
    if (n.bld) parts.push(`건물 ${n.bld}동`);
    if (n.lot) parts.push(`획지 ${n.lot}곳(빈 터로)`);
    if (n.obj) parts.push(`요소 ${n.obj}개`);
    if (n.ctx) parts.push(`현황 건물 ${n.ctx}동`);
    if (n.rab) parts.push(`회전교차로 ${n.rab}곳`);
    if (n.tree) parts.push(`수목 ${n.tree}그루`);
    UDS.ui.toast(`${parts.join(' · ')}를 지웠습니다. ${UDS.ui.undoTip()}`);
  };

  /* ---------- 획지 합치기 ----------
     획지는 가구를 격자로 나눈 칸이다. 같은 가구 안에서 서로 붙어 직사각형을 이루는 칸들을 하나의 획지로 합친다(가구 설정의 merges).
     합친 획지는 대표 획지(마지막에 고른 것)의 용도와 건물 설정을 이어받고, 건물은 넓어진 획지에 맞춰 다시 앉는다 */
  app.mergeCheck = function (list) {
    const D = this.D;
    if (!D || !list || list.length < 2) return { ok: false, n: 0 };
    const lots = list.map((t) => (t.type === 'lot' || t.type === 'building' ? D.lots.find((l) => l.id === t.id) : null));
    if (lots.some((l) => !l || !l.cell)) return { ok: false, n: 0 }; // 획지가 아닌 것이 섞여 있으면 합치기를 권하지 않는다
    const n = lots.length, bid = lots[0].blockId;
    if (lots.some((l) => l.blockId !== bid)) return { ok: false, n, reason: '같은 가구 안의 획지만 합칠 수 있습니다.' };
    let r0 = Infinity, r1 = -Infinity, i0 = Infinity, i1 = -Infinity;
    lots.forEach((l) => { r0 = Math.min(r0, l.cell.r0); r1 = Math.max(r1, l.cell.r1); i0 = Math.min(i0, l.cell.i0); i1 = Math.max(i1, l.cell.i1); });
    const ids = new Set(lots.map((l) => l.id));
    // 나눈 획지는 조각을 모두 골라야 합칠 수 있다(조각 일부만 다른 획지와 합치면 네모꼴이 되지 않음)
    if (lots.some((l) => l.sub && D.lots.some((x) => x.blockId === bid && x.sub && x.sub.of === l.sub.of && !ids.has(x.id)))) return { ok: false, n, reason: '나눈 획지는 조각을 모두 골라야 합칠 수 있습니다. 나머지 조각도 함께 골라 주세요.' };
    // 고른 획지를 감싸는 칸 범위에 걸친 획지가 모두 골라져 있어야 한다(= 빈틈 없이 붙어 직사각형을 이룸)
    const gap = D.lots.some((l) => l.blockId === bid && l.cell && !ids.has(l.id) && !(l.cell.r1 < r0 || l.cell.r0 > r1 || l.cell.i1 < i0 || l.cell.i0 > i1));
    if (gap) return { ok: false, n, reason: '서로 붙어 네모꼴을 이루는 획지만 합칠 수 있습니다. 사이에 낀 획지도 함께 골라 주세요.' };
    return { ok: true, n, blockId: bid, range: { r0, r1, i0, i1 }, lots };
  };
  app.mergeLots = function () {
    const st = this.state;
    const c = this.mergeCheck(this.selList());
    if (!c.ok) { if (c.reason) UDS.ui.toast(c.reason); return; }
    const S = this.block(c.blockId); if (!S) return;
    const { r0, r1, i0, i1 } = c.range;
    const prim = (st.sel && c.lots.find((l) => l.id === st.sel.id)) || c.lots[c.lots.length - 1];
    const keep = S.lots && S.lots[prim.key] ? JSON.parse(JSON.stringify(S.lots[prim.key])) : null;
    const inR = (key) => { const q = key.split('.')[0].split(':'); return +q[0] >= r0 && +q[0] <= r1 && +q[1] >= i0 && +q[1] <= i1; };
    // 조각만 골랐으면(나눈 획지 하나의 조각 전부) 나눔을 풀 뿐이고, 원래 합쳐 둔 범위는 그대로 둔다
    const only = c.lots.every((l) => l.sub && l.sub.of === c.lots[0].sub.of);
    if (!only) {
      S.merges = (S.merges || []).filter((m) => m.r1 < r0 || m.r0 > r1 || m.i1 < i0 || m.i0 > i1); // 범위에 든 예전 합침은 새 범위에 흡수
      S.merges.push({ r0, r1, i0, i1 });
    }
    if (!S.lots) S.lots = {};
    Object.keys(S.lots).forEach((k) => { if (inR(k)) delete S.lots[k]; });
    if (S.splits) Object.keys(S.splits).forEach((k) => { if (inR(k)) delete S.splits[k]; }); // 범위 안의 나눔은 푼다
    if (keep) S.lots[r0 + ':' + i0] = keep;
    st.sel = { type: 'lot', id: S.id + ':' + r0 + ':' + i0 }; st.multi = []; st.selSeg = null; st.selUtil = null; st.tab = 'props';
    this.commit(); // 다시 계산하면서 건물 유무에 맞춰 선택 유형(건물·획지)이 정해진다
    UDS.ui.toast(`획지 ${c.n}개를 하나로 합쳤습니다. ${UDS.ui.undoTip()}`);
  };
  app.unmergeLot = function (lotId) {
    const li = this.lotInfo(lotId);
    if (!li || !li.lot.cell) return;
    const c = li.lot.cell;
    li.S.merges = (li.S.merges || []).filter((m) => !(m.r0 === c.r0 && m.r1 === c.r1 && m.i0 === c.i0 && m.i1 === c.i1));
    this.commit();
    UDS.ui.toast('합친 획지를 다시 나눴습니다. 첫 획지만 바꿔 둔 용도·건물 설정을 이어 갑니다.');
  };

  /* ---------- 획지 나누기 ----------
     획지 하나(합친 획지 포함)를 n개로 나눈다. dir 'u': 도로를 따라 나란히(폭을 나눔), 'v': 앞뒤로(깊이를 나눔).
     나눈 조각을 고른 채 다시 부르면 원래 획지를 새 수·방향으로 다시 나눈다. 조각은 원래 획지의 용도·건물 설정을 이어받는다 */
  app.splitLot = function (lotId, n, dir) {
    const li = this.lotInfo(lotId); if (!li) return;
    const S = li.S, lot = li.lot, st = this.state;
    const key = lot.sub ? lot.sub.of : lot.key;
    n = U.clamp(Math.round(n || 2), 2, 6); dir = dir === 'v' ? 'v' : 'u';
    const before = JSON.stringify([S.splits || {}, S.lots || {}]);
    if (!S.splits) S.splits = {};
    if (!S.lots) S.lots = {};
    const base = S.lots[lot.key] ? JSON.stringify(S.lots[lot.key]) : null; // 지금 고른 획지(조각)의 설정을 새 조각들이 이어받는다
    Object.keys(S.lots).forEach((k) => { if (k.startsWith(key + '.')) delete S.lots[k]; });
    S.splits[key] = { n, dir };
    if (base) for (let k = 0; k < n; k++) S.lots[key + '.' + k] = JSON.parse(base);
    this.derive();
    const first = S.id + ':' + key + '.0';
    if (!this.D.lots.some((l) => l.id === first)) { // 조각이 너무 작아 나뉘지 않았으면 없던 일로
      const [sp, lo] = JSON.parse(before); S.splits = sp; S.lots = lo;
      this.derive(); this.refresh();
      UDS.ui.toast('획지가 작아 그렇게 나눌 수 없습니다. 조각 하나가 20㎡보다 커야 합니다.');
      return;
    }
    st.sel = { type: 'lot', id: first }; st.multi = []; st.selSeg = null; st.selUtil = null; st.tab = 'props';
    this.commit();
    UDS.ui.toast(`획지를 ${dir === 'v' ? '앞뒤로' : '나란히'} ${n}개로 나눴습니다. ${UDS.ui.undoTip()}`);
  };
  app.unsplitLot = function (lotId) {
    const li = this.lotInfo(lotId);
    if (!li || !li.lot.sub) return;
    const S = li.S, key = li.lot.sub.of;
    const keep = S.lots && S.lots[li.lot.key] ? JSON.stringify(S.lots[li.lot.key]) : null; // 고른 조각의 설정을 되합친 획지가 이어받는다
    if (S.splits) delete S.splits[key];
    Object.keys(S.lots || {}).forEach((k) => { if (k.startsWith(key + '.')) delete S.lots[k]; });
    if (keep) S.lots[key] = JSON.parse(keep);
    this.state.sel = { type: 'lot', id: S.id + ':' + key }; this.state.multi = [];
    this.commit();
    UDS.ui.toast('나눈 획지를 다시 하나로 합쳤습니다.');
  };

  /* ---------- 단면 구간·지하시설 ---------- */
  app.addSeg = function (type) {
    const road = this.secRoad(); if (!road) return;
    const def = C.SEG[type];
    const seg = { id: U.uid('s'), type, w: def.defW };
    let i = road.segs.findIndex((s) => s.id === this.state.selSeg);
    if (type === 'lane' || type === 'bus') {
      const ref = i >= 0 ? road.segs[i] : null;
      seg.dir = ref && ref.dir ? ref.dir : (i >= 0 && i < road.segs.length / 2 ? -1 : 1);
    }
    if (i < 0) {
      // 선택이 없으면: 차도 유형은 차도 가운데, 그 밖은 오른쪽 보도 안쪽
      const car = road.segs.map((s, k) => (C.SEG[s.type].carriage ? k : -1)).filter((k) => k >= 0);
      i = def.carriage && car.length ? car[car.length - 1] : road.segs.length - 2;
      if (i < 0) i = road.segs.length - 1;
    }
    road.segs.splice(i + 1, 0, seg);
    this.state.selSeg = seg.id; this.state.selUtil = null;
    this.state.sel = { type: 'road', id: road.id };
    this.commit();
  };
  app.removeSeg = function (id) {
    const road = this.secRoad(); if (!road) return;
    if (road.segs.length <= 1) { UDS.ui.toast('구간이 하나뿐이면 지울 수 없습니다. 도로 자체를 지우려면 도로를 선택해 삭제하세요.'); return; }
    const i = road.segs.findIndex((s) => s.id === id); if (i < 0) return;
    road.segs.splice(i, 1);
    this.state.selSeg = road.segs[Math.min(i, road.segs.length - 1)].id;
    this.commit();
  };
  app.moveSeg = function (id, d) {
    const road = this.secRoad(); if (!road) return;
    const i = road.segs.findIndex((s) => s.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= road.segs.length) return;
    const t = road.segs[i]; road.segs[i] = road.segs[j]; road.segs[j] = t;
    this.commit();
  };
  app.addUtil = function (type) {
    const road = this.secRoad(); if (!road) return;
    const def = C.UTIL[type];
    const W = Dv.roadWidth(road);
    const used = (road.utils || []).map((u) => u.off);
    let off = 0;
    for (let k = 0; k < 40; k++) { const c = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.8; if (Math.abs(c) < W / 2 - 0.4 && !used.some((x) => Math.abs(x - c) < 0.7)) { off = c; break; } }
    const u = { id: U.uid('u'), type, off: U.round(off, 2), depth: def.depth, dia: def.dia };
    if (!road.utils) road.utils = [];
    road.utils.push(u);
    // 전주·가공선이 있는 도로에 전력·통신 관로를 넣으면 지중화: 전주와 가공선을 걷어 내고(나머지 관로도 함께 넣음) 보도 유효폭을 되찾는다
    const ug = (type === 'power' || type === 'telecom') && road.overhead && Dv.layout(road).hasCar;
    const poles0 = ug ? this.D.poles.filter((p) => p.roadId === road.id).length : 0;
    if (ug) this.undergroundWires(road);
    this.state.selUtil = u.id; this.state.selSeg = null; this.state.sel = { type: 'road', id: road.id };
    this.state.secShow.util = true; // 숨겨 둔 채로 넣으면 보이지 않으므로 다시 켠다
    this.commit();
    if (ug) UDS.ui.toast(`${C.UTIL[type].name}을 넣어 ${road.name}의 전선을 땅속으로 옮겼습니다(지중화). 전주 ${poles0}개와 가공선을 걷어 내 보도 유효폭이 넓어졌습니다. ${UDS.ui.undoTip()}`);
  };
  /* 전선 지중화: 고른 도로(없으면 전주·가공선이 있는 모든 도로)의 전주를 걷어 내고 전력·통신선을 보도 밑 관로로 옮긴다 */
  app.undergroundRoads = function (ids) {
    const P = this.P, list = P.roads.filter((r) => r.overhead && (!ids || ids.includes(r.id)) && Dv.layout(r).hasCar);
    if (!list.length) { UDS.ui.toast('전주·가공선이 있는 도로가 없습니다.'); return 0; }
    const poles0 = this.D.poles.filter((p) => list.some((r) => r.id === p.roadId)).length, err0 = this.D.checks.filter((c) => c.level === 'error').length;
    list.forEach((r) => this.undergroundWires(r));
    this.commit();
    const err1 = this.D.checks.filter((c) => c.level === 'error').length;
    UDS.ui.toast(`${list.length === 1 ? list[0].name : `도로 ${list.length}곳`}의 전선을 지중화했습니다. 전주 ${poles0}개와 가공선을 걷어 내고 전력·통신 관로를 보도 밑에 넣었습니다${err0 > err1 ? `(법규검토 기준 미달 ${err0 - err1}건 줄어듦)` : ''}. ${UDS.ui.undoTip()}`);
    return list.length;
  };
  app.removeUtil = function (id) {
    const road = this.secRoad(); if (!road) return;
    road.utils = (road.utils || []).filter((u) => u.id !== id);
    this.state.selUtil = null;
    this.commit();
  };
  app.undergroundWires = function (road) {
    road.overhead = false;
    const W = Dv.roadWidth(road), h = W / 2;
    if (!road.utils) road.utils = [];
    const has = (t) => road.utils.some((u) => u.type === t);
    if (!has('power')) road.utils.push({ id: U.uid('u'), type: 'power', off: U.round(Math.max(0.5, h - 0.6), 2), depth: C.UTIL.power.depth, dia: C.UTIL.power.dia });
    if (!has('telecom')) road.utils.push({ id: U.uid('u'), type: 'telecom', off: -U.round(Math.max(0.5, h - 0.6), 2), depth: C.UTIL.telecom.depth, dia: C.UTIL.telecom.dia });
  };
  app.applyPreset = function (road, key) {
    const p = C.PRESETS[key]; if (!p) return;
    road.preset = key; road.fn = p.fn; road.speed = p.speed; road.curbR = p.curbR;
    road.segs = p.segs.map((s) => ({ id: U.uid('s'), type: s.type, w: s.w, ...(s.dir ? { dir: s.dir } : {}) }));
    road.crosswalk = p.fn !== 'pedestrian' && p.fn !== 'shared';
    const W = Dv.roadWidth(road);
    (road.utils || []).forEach((u) => { if (Math.abs(u.off) > W / 2 - 0.4) u.off = U.round(Math.sign(u.off) * Math.max(0, W / 2 - 0.6), 2); });
    this.state.selSeg = null;
  };

  /* ---------- 캔버스 조작 ---------- */
  /* 단면 위치선 양 끝(A·A′ 동그라미)의 자리. 누르면 단면을 보는 방향이 바뀐다 */
  app.secMarks = function () {
    const sr = this.secRoad && this.secRoad(); if (!sr || !this.D) return null;
    const info = this.D.roadInfo.get(sr.id); if (!info) return null;
    const st = this.state, s = st.secS === null || st.secS === undefined ? info.len / 2 : U.clamp(st.secS, 0, info.len);
    const q = U.pointAlong(sr.pts, s), n = U.perpL(q.dir), half = info.lay.W / 2 + Math.max(5, 16 / this.r2.view.s);
    return [U.add(q.p, U.mul(n, half)), U.add(q.p, U.mul(n, -half))];
  };
  app.secMarkAt = function (q) {
    const m = this.secMarks(); if (!m) return false;
    return m.some((p) => { const s = this.r2.w2s(p); return Math.hypot(s[0] - q[0], s[1] - q[1]) <= 11; });
  };
  /* 평면에서 도로 하나를 크게 본다(단면에서 도로를 고를 때). 도로 전체와 양옆 보도가 들어오게 */
  app.zoomToRoad = function (id) {
    const r = this.road(id), info = r && this.D && this.D.roadInfo.get(id);
    if (!r) return;
    const hw = (info && info.lay ? info.lay.W / 2 : 10) + 6;
    const xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]);
    const bx = [Math.min(...xs) - hw, Math.min(...ys) - hw, Math.max(...xs) + hw, Math.max(...ys) + hw];
    const r2 = this.r2;
    if (!(r2.W > 20 && r2.H > 20) || !UDS.ui.viewShown('2d')) { this._pend2 = { c: [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2], r: Math.max(16, 0.3 * Math.max(bx[2] - bx[0], bx[3] - bx[1])) }; return; }
    this.tween('2d', r2.view, r2.viewFor(bx, 1.18, 50), 460, 1);
  };
  app.secFlipToggle = function () {
    const st = this.state; st.secFlip = !st.secFlip;
    this.invalidate(7); if (this.sec) this.sec.draw();
    UDS.ui.toast(st.secFlip ? '단면을 반대쪽에서 봅니다(A·A′를 다시 누르면 처음 방향).' : '단면을 처음 방향에서 봅니다.');
  };
  /* 변의 바깥 방향(세계 좌표)에 맞는 크기 바꾸기 화살표 */
  const resizeCursor = (n) => {
    let a = (Math.atan2(-n[1], n[0]) * 180) / Math.PI; a = ((a % 180) + 180) % 180;
    return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize';
  };
  app.hover2D = function (q, e) {
    const st = this.state, r2 = this.r2;
    if (st.tool === 'build' && st.buildOpt.scope === 'draw') { // 건물 그리기: 맞춘 자리를 미리 보인다
      const sp = this.bldDrawSnap(r2.s2w(q), !!(e && e.shiftKey));
      const dr = st.drawBld || (st.drawBld = { pts: [], cursor: null });
      dr.cursor = sp.p; dr.kind = sp.kind;
      r2.cv.style.cursor = 'crosshair';
      this.invalidate(1);
      return;
    }
    if (st.tool === 'select' || st.tool === 'move') { // 단면 표시(A·A′): 누르면 보는 방향이 바뀐다
      const hot = this.secMarkAt(q);
      if (!!st.secHot !== hot) { st.secHot = hot; this.invalidate(1); }
      if (hot) { r2.cv.style.cursor = 'pointer'; this._hovH = true; return; }
    }
    if (st.tool === 'select' && this.roadEndAt(q, 11)) { r2.cv.style.cursor = 'grab'; this._hovH = true; return; } // 고른 도로의 끝: 끌어 잇기
    if (st.tool === 'select' || st.tool === 'move') { // 건물 변·돌리기 손잡이
      const ht = r2.hitTest(q);
      const hd = ht && (ht.type === 'object' || ht.type === 'tree') ? null : this.bldHandleAt(q, 7);
      const key = (h) => (h ? h.kind + h.id + (h.k !== undefined ? ':' + h.k : '') : '');
      if (key(hd) !== key(st.bldHover)) { st.bldHover = hd; this.invalidate(1); }
      if (hd) {
        if (!st.hover || st.hover.type !== 'building' || st.hover.id !== hd.id) { st.hover = { type: 'building', id: hd.id }; this.invalidate(1); }
        r2.cv.style.cursor = hd.kind === 'rot' ? 'grab' : resizeCursor(hd.n);
        this._hovH = true;
        return;
      }
      if (this._hovH) { this._hovH = false; st.hover = { type: '-', id: '' }; } // 손잡이에서 벗어나면 커서를 다시 정한다
    }
    if (st.tool === 'road') {
      const dr = st.drawRoad;
      const sp = this.snapPoint(r2.s2w(q), dr && dr.pts.length ? dr.pts[dr.pts.length - 1] : null);
      st.snap = sp.kind === 'node' || sp.kind === 'line' ? sp.p : null;
      if (dr) dr.cursor = sp.p; else st.drawRoad = { pts: [], cursor: sp.p };
      this.invalidate(1);
      return;
    }
    if (st.tool === 'place') return;
    if (st.tool === 'water') { // 자유형 연못·하천: 다음 점 미리 보기
      const k = st.waterKind;
      if (k === 'free' || k === 'river') { const w = r2.s2w(q), dr = st.drawWater || (st.drawWater = { kind: k, pts: [], cursor: null }); dr.kind = k; dr.cursor = [Math.round(w[0] * 2) / 2, Math.round(w[1] * 2) / 2]; this.invalidate(1); }
      r2.cv.style.cursor = 'crosshair';
      return;
    }
    if (st.tool === 'rabout') { // 회전교차로 도구: 둘 수 있는 교차점·있는 회전교차로를 가리킨다
      const w = r2.s2w(q), ex = this.rabAtPoint(w), c = ex ? null : this.rabCandAt(w, Math.max(14, 18 / r2.view.s));
      const h = ex ? { type: 'rab', id: ex.id } : c ? { type: 'rabcand', id: 'n' + c.node, p: c.p, W: c.W, blocked: !!c.blocked } : null;
      const k = h ? h.type + h.id : '', pk = st.hover ? st.hover.type + st.hover.id : '';
      if (k !== pk) { st.hover = h; r2.cv.style.cursor = h ? 'pointer' : 'crosshair'; this.invalidate(1); }
      return;
    }
    let h;
    if (st.tool === 'bldpaste' && st.bldClip && st.bldClip.fp) { // 옮기기·복사: 놓을 자리에 건물 모습을 띄운다(같은 획지 안이면 그 안에서 옮김)
      const cl = st.bldClip, w = r2.s2w(q), l = this.lotAt(w), c0 = U.polyCentroid(cl.fp);
      st.bldDrag = { fp: cl.fp.map((p) => U.add(p, U.sub(w, c0))), target: l ? l.id : null, copy: cl.mode !== 'move', same: !!l && l.id === cl.from };
      this.invalidate(1);
    }
    if (st.tool === 'build' || st.tool === 'bldpaste') { const l = this.lotAt(r2.s2w(q)); h = l ? { type: l.building ? 'building' : 'lot', id: l.id } : null; }
    else h = r2.hitTest(q);
    const k = h ? h.type + h.id : '', pk = st.hover ? st.hover.type + st.hover.id : '';
    if (k !== pk) {
      st.hover = h;
      let cur = h ? 'pointer' : 'default';
      if (st.tool === 'erase' || st.tool === 'build') cur = 'crosshair';
      else if (st.tool === 'bldpaste') cur = 'copy';
      else if (st.tool === 'move') cur = h && (h.type === 'object' || h.type === 'road' || h.type === 'rab' || h.type === 'building' || h.type === 'water') ? 'move' : 'default';
      r2.cv.style.cursor = cur;
      this.invalidate(1);
    }
  };

  /* 같은 자리를 두 번 누름(더블클릭) 알아채기. 마우스는 브라우저의 더블클릭 판정을 따르고, 손가락·펜은 두드린 간격으로 판정한다.
     돌려주는 함수는 '끌지 않고 뗀 누름'마다 부른다. ok가 false인 누름(도로 그리기·요소 놓기·Shift 선택, 끌기)이 끼면 두 번 누름으로 치지 않는다 */
  function dblWatch(cv, onDouble) {
    let pair = [false, false], mouse = true, t = 0, x = 0, y = 0;
    cv.addEventListener('dblclick', () => { if (mouse && pair[0] && pair[1]) { pair = [false, false]; onDouble(); } });
    return (e, ok) => {
      ok = ok !== false;
      pair = [pair[1], ok];
      mouse = e.pointerType === 'mouse' || !e.pointerType;
      if (mouse) return;
      const now = e.timeStamp || performance.now();
      const hit = ok && now - t < 400 && Math.hypot(e.clientX - x, e.clientY - y) < 28;
      t = hit || !ok ? 0 : now; x = e.clientX; y = e.clientY;
      if (hit) { pair = [false, false]; onDouble(); }
    };
  }
  UDS.dblWatch = dblWatch;

  /* 이동 도구: 도로를 통째로 옮길 때 그 도로에 붙어 있던 다른 도로의 끝점도 같이 움직여 교차로가 떨어지지 않게 한다 */
  function roadMoveStart(road) {
    const P = app.P, tied = [];
    P.roads.forEach((r) => {
      if (r.id === road.id) return;
      const V = M.verts(r); // 단지 안 길은 찍은 점(끝점은 중심선 끝점과 같다)
      [0, V.length - 1].forEach((i) => {
        const q = V[i];
        for (let k = 0; k + 1 < road.pts.length; k++) if (U.distPointSeg(q, road.pts[k], road.pts[k + 1]).d < 0.3) { tied.push({ r, i, p0: q.slice() }); break; }
      });
    });
    return { pts0: M.verts(road).map((q) => q.slice()), tied, dead0: app.D.deadEnds.length };
  }
  function roadMoveBy(g, d) {
    const P = app.P, road = g.road, n = g.pts0.length;
    const inSite = (q) => [U.round(q[0], 2), U.round(q[1], 2)]; // 밖으로 끌면 놓을 때 대상지가 넓어진다
    const pts = g.pts0.map((q) => inSite([q[0] + d[0], q[1] + d[1]]));
    // 두 끝은 가까운 도로·대상지 경계에 붙인다
    [0, n - 1].forEach((i) => { const sp = app.snapPoint(pts[i], null, road.id); if (sp.kind === 'node' || sp.kind === 'line') pts[i] = sp.p; });
    if (road.ctrl) { road.ctrl = pts; M.reshape(road); } else road.pts = pts;
    g.tied.forEach((t) => { M.verts(t.r)[t.i] = inSite([t.p0[0] + d[0], t.p0[1] + d[1]]); if (t.r.ctrl) M.reshape(t.r); });
  }

  /* 회전교차로 옮기기: 그 자리의 도로 꼭짓점(필요하면 새로 넣음)을 함께 옮긴다 */
  function rabMoveStart(id) {
    const P = app.P, sp = (P.rabouts || []).find((r) => r.id === id);
    if (!sp) return { ties: null };
    app.pinPoint(sp.p);
    const ties = [];
    P.roads.forEach((r) => M.verts(r).forEach((q, i) => { if (U.dist(q, sp.p) < 0.35) ties.push({ r, i }); }));
    return { sp, p0: sp.p.slice(), ties };
  }
  function rabMoveBy(g, d) {
    const P = app.P;
    const p = [U.clamp(U.round(g.p0[0] + d[0], 2), 1.5, P.site.w - 1.5), U.clamp(U.round(g.p0[1] + d[1], 2), 1.5, P.site.h - 1.5)];
    g.ties.forEach((t) => { M.verts(t.r)[t.i] = p.slice(); if (t.r.ctrl) M.reshape(t.r); });
    g.sp.p = p.slice();
  }

  function bind2D(cv) {
    const r2 = app.r2;
    const ptrs = new Map();
    let g = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      app.stopTween('2d');
      const q = pos(e);
      ptrs.set(e.pointerId, q);
      if (ptrs.size === 2) {
        const [a, b] = Array.from(ptrs.values());
        const c = U.mid(a, b);
        g = { kind: 'pinch', d0: Math.max(8, U.dist(a, b)), s0: r2.view.s, w0: r2.s2w(c) };
        return;
      }
      const st = app.state;
      g = { kind: 'tap', sx: q[0], sy: q[1], moved: false, cx0: r2.view.cx, cy0: r2.view.cy, btn: e.button || 0, shift: !!e.shiftKey };
      // 끌어 옮기기는 이동 도구에서만(선택 도구에서는 끌면 화면이 움직인다). Shift는 여럿 고르기라 옮기지 않는다
      if (st.tool === 'select' && !e.button && !e.shiftKey) { // 고른 도로의 끝을 끌어 다른 도로에 잇기
        const hd = app.roadEndAt(q, e.pointerType === 'mouse' ? 11 : 16);
        if (hd) { g.kind = 'vertex'; g.road = hd.road; g.i = hd.i; g.join = true; }
      }
      if (st.tool === 'move' && !e.button && !e.shiftKey) {
        const sel = st.sel;
        if (sel && sel.type === 'water') { // 자유형 연못·하천: 찍은 점을 끌어 모양을 고친다
          const wt = app.water(sel.id);
          if (wt && wt.ctrl) for (let i = 0; i < wt.ctrl.length; i++) { const s = r2.w2s(wt.ctrl[i]); if (Math.hypot(s[0] - q[0], s[1] - q[1]) < 11) { g.kind = 'wvertex'; g.water = wt; g.i = i; break; } }
        }
        if (g.kind === 'tap' && sel && sel.type === 'road') {
          const r = app.road(sel.id);
          const V = r ? M.verts(r) : []; // 단지 안 길은 찍은 점을 끈다
          for (let i = 0; i < V.length; i++) { const s = r2.w2s(V[i]); if (Math.hypot(s[0] - q[0], s[1] - q[1]) < 11) { g.kind = 'vertex'; g.road = r; g.i = i; break; } }
        }
        if (g.kind === 'tap') {
          const hit = r2.hitTest(q);
          if (hit && hit.type === 'object') {
            // 여럿을 골라 둔 요소 가운데 하나를 잡으면 고른 요소가 함께 움직인다
            const list = app.selList();
            const ids = list.length > 1 && list.some((t) => t.id === hit.id) ? list.filter((t) => t.type === 'object').map((t) => t.id) : [hit.id];
            g.kind = 'object'; g.hit = hit; g.w0 = r2.s2w(q);
            g.objs = app.P.objects.filter((x) => ids.includes(x.id)).map((o) => ({ o, x0: o.x, y0: o.y }));
          } else if (hit && hit.type === 'road') {
            const r = app.road(hit.id);
            if (r) { g.kind = 'road'; g.hit = hit; g.road = r; g.w0 = r2.s2w(q); }
          } else if (hit && hit.type === 'rab') { g.kind = 'rab'; g.hit = hit; g.w0 = r2.s2w(q); }
          else if (hit && hit.type === 'water') { const wt = app.water(hit.id); if (wt) { g.kind = 'water'; g.hit = hit; g.water = wt; g.w0 = r2.s2w(q); g.snap0 = JSON.parse(JSON.stringify(wt)); } }
          else if (hit && hit.type === 'building') { g.kind = 'bld'; g.hit = hit; g.w0 = r2.s2w(q); g.copy = !!(e.altKey || e.ctrlKey || e.metaKey); }
          else if (hit && hit.type === 'lot') g.fixed = true;
        }
      }
      // 건물 변(깊이·길이)과 돌리기 손잡이: 선택·이동 도구 모두. 손가락은 고른 건물만
      if ((st.tool === 'select' || st.tool === 'move') && !e.button && !e.shiftKey && (g.kind === 'tap' || g.kind === 'bld')) {
        const touch = !!e.pointerType && e.pointerType !== 'mouse';
        const ht = r2.hitTest(q);
        const hd = ht && (ht.type === 'object' || ht.type === 'tree') ? null : app.bldHandleAt(q, touch ? 14 : 7, { selOnly: touch });
        if (hd) { g.kind = 'bldh'; g.hd = hd; g.w0 = r2.s2w(q); g.fixed = false; }
      }
      // 손가락·펜에는 Shift가 없으므로, 선택 도구에서 길게 누르면 여럿 고르기에 더한다(다시 길게 누르면 뺀다)
      if (e.pointerType && e.pointerType !== 'mouse' && st.tool === 'select' && g.kind === 'tap') {
        const gl = g, at = [e.clientX, e.clientY];
        gl.lt = setTimeout(() => {
          if (g !== gl || gl.moved || ptrs.size !== 1) return;
          const hit = r2.hitTest(q);
          if (!hit) return;
          gl.long = true;
          UDS.ui._pt = at;
          app.clickWorld(r2.s2w(q), hit, { shift: true });
          try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* 무시 */ }
        }, 480);
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const q = pos(e);
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, q);
      const st = app.state;
      if (g && g.kind === 'pinch' && ptrs.size >= 2) {
        const [a, b] = Array.from(ptrs.values());
        const d = U.dist(a, b), c = U.mid(a, b);
        r2.view.s = U.clamp(g.s0 * (d / g.d0), 0.15, 60);
        r2.view.cx = g.w0[0] - (c[0] - r2.W / 2) / r2.view.s;
        r2.view.cy = g.w0[1] + (c[1] - r2.H / 2) / r2.view.s;
        app.invalidate(1);
        return;
      }
      if (g && ptrs.has(e.pointerId)) {
        const dx = q[0] - g.sx, dy = q[1] - g.sy;
        if (g.long) return; // 길게 눌러 고른 뒤에는 손을 뗄 때까지 화면을 움직이지 않는다
        if (!g.moved && Math.hypot(dx, dy) < (e.pointerType === 'mouse' ? 5 : 8)) return;
        g.moved = true; clearTimeout(g.lt);
        if (g.kind === 'vertex') {
          if (!g.p0) { // 끌기 시작: 처음 자리와 그때 끊긴 끝이었는지(끄는 동안에는 장면을 새로 셈하므로 지금 기억)
            const V0 = M.verts(g.road); g.p0 = V0[g.i].slice();
            g.wasDead = (g.i === 0 || g.i === V0.length - 1) && app.D.deadEnds.some((d) => d.roadId === g.road.id && U.dist(d.p, g.p0) < 0.5);
            if (g.join && !(st.sel && st.sel.type === 'road' && st.sel.id === g.road.id)) { st.sel = { type: 'road', id: g.road.id }; st.multi = []; }
          }
          const sp = app.snapPoint(r2.s2w(q), null, g.road.id);
          M.verts(g.road)[g.i] = sp.p;
          if (g.road.ctrl) M.reshape(g.road);
          st.snap = sp.kind === 'node' || sp.kind === 'line' ? sp.p : null;
          app.liveChange();
        } else if (g.kind === 'wvertex') {
          const w = r2.s2w(q);
          g.water.ctrl[g.i] = [Math.round(w[0] * 2) / 2, Math.round(w[1] * 2) / 2];
          app.liveChange();
        } else if (g.kind === 'water') { // 수공간 통째로 옮기기(0.5m 단위)
          const w = r2.s2w(q), d = [Math.round((w[0] - g.w0[0]) * 2) / 2, Math.round((w[1] - g.w0[1]) * 2) / 2];
          if (!g.began) { g.began = true; st.sel = { type: 'water', id: g.water.id }; st.multi = []; r2.cv.style.cursor = 'move'; }
          if (g.snap0.c) g.water.c = g.snap0.c.slice();
          if (g.snap0.ctrl) g.water.ctrl = g.snap0.ctrl.map((p2) => p2.slice());
          M.waterMove(g.water, d);
          app.liveChange();
        } else if (g.kind === 'object') {
          const w = r2.s2w(q);
          if (!g.began) { g.began = true; if (!app.selList().some((t) => t.id === g.hit.id)) { st.sel = { type: 'object', id: g.hit.id }; st.multi = []; } }
          g.objs.forEach((it) => { it.o.x = U.round(it.x0 + (w[0] - g.w0[0]), 2); it.o.y = U.round(it.y0 + (w[1] - g.w0[1]), 2); });
          app.liveChange();
        } else if (g.kind === 'rab') { // 회전교차로(교차점)를 끌면 거기 모인 도로 꼭짓점이 함께 움직인다
          const w = r2.s2w(q);
          if (!g.began) { g.began = true; Object.assign(g, rabMoveStart(g.hit.id)); st.sel = { type: 'rab', id: g.hit.id }; st.multi = []; r2.cv.style.cursor = 'move'; }
          if (g.ties) rabMoveBy(g, [Math.round(w[0] - g.w0[0]), Math.round(w[1] - g.w0[1])]);
          app.liveChange();
        } else if (g.kind === 'bld') { // 건물 끌기: 획지 안에서 옮기거나 다른 획지로(Alt·Ctrl: 복사)
          const w = r2.s2w(q);
          if (!g.began) { g.began = true; g.bd = app.bldDragStart(g.hit.id, g.w0); st.sel = { type: 'building', id: g.hit.id }; st.multi = []; r2.cv.style.cursor = 'move'; }
          g.copy = !!(e.altKey || e.ctrlKey || e.metaKey);
          if (g.bd) app.bldDragMove(g.bd, w, g.copy);
        } else if (g.kind === 'bldh') { // 건물 변 끌기(깊이·길이) 또는 돌리기
          const w = r2.s2w(q);
          if (!g.began) {
            g.began = true; g.op = app.bldOpStart(g.hd, g.w0); st.bldBusy = true;
            if (!(st.sel && st.sel.type === 'building' && st.sel.id === g.hd.id)) { st.sel = { type: 'building', id: g.hd.id }; st.multi = []; st.tab = 'props'; }
            if (g.hd.kind === 'rot') r2.cv.style.cursor = 'grabbing';
          }
          if (g.op) app.bldOpMove(g.op, w, { shift: e.shiftKey });
        } else if (g.kind === 'road') {
          const w = r2.s2w(q);
          if (!g.began) { g.began = true; Object.assign(g, roadMoveStart(g.road)); if (!app.selList().some((t) => t.id === g.road.id)) { st.sel = { type: 'road', id: g.road.id }; st.multi = []; st.secRoadId = g.road.id; st.secS = null; st.selSeg = null; st.selUtil = null; } r2.cv.style.cursor = 'move'; }
          roadMoveBy(g, [Math.round(w[0] - g.w0[0]), Math.round(w[1] - g.w0[1])]); // 1m 단위
          app.liveChange();
        } else {
          // 이동 도구로 건물·획지를 끌려 했을 때 한 번 알려 준다(화면은 평소처럼 움직인다)
          if (g.fixed && !app._fixedTold) { app._fixedTold = true; UDS.ui.toast('획지는 끌어 옮길 수 없습니다. 건물을 끌면 옮겨지고(Alt·Ctrl: 복사), 도로를 옮기면 획지가 달라집니다.'); }
          r2.view.cx = g.cx0 - dx / r2.view.s; r2.view.cy = g.cy0 + dy / r2.view.s;
          app.invalidate(1);
        }
        return;
      }
      if (e.pointerType === 'mouse') app.hover2D(q, e);
    });
    const up = (e) => {
      const q = pos(e);
      const had = ptrs.has(e.pointerId);
      ptrs.delete(e.pointerId);
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      if (!g || !had) return;
      if (g.kind === 'pinch') {
        if (ptrs.size === 1) { const p = Array.from(ptrs.values())[0]; g = { kind: 'tap', sx: p[0], sy: p[1], moved: true, cx0: r2.view.cx, cy0: r2.view.cy, btn: 0 }; }
        else g = null;
        return;
      }
      const gg = g; g = null;
      clearTimeout(gg.lt);
      if (gg.long) { tap(e, false); return; }
      if (gg.moved) {
        tap(e, false);
        if (gg.kind === 'bld') { app.state.bldBusy = false; if (gg.bd) app.bldDragEnd(gg.bd, !!(e.altKey || e.ctrlKey || e.metaKey || gg.copy)); return; }
        if (gg.kind === 'bldh') { app.state.bldBusy = false; if (gg.op) app.bldOpEnd(gg.op); else app.state.bldOp = null; if (gg.hd.kind === 'rot') r2.cv.style.cursor = 'grab'; return; }
        if (gg.kind === 'vertex' || gg.kind === 'object' || gg.kind === 'road' || gg.kind === 'rab' || gg.kind === 'wvertex' || gg.kind === 'water') {
          const V0 = gg.kind === 'vertex' ? M.verts(gg.road) : null, isEnd = V0 && (gg.i === 0 || gg.i === V0.length - 1);
          const wasDead = isEnd && !!gg.wasDead;
          const jn = isEnd ? app.joinRoadEnd(gg.road, gg.i) : null;
          app.state.snap = null; app.commit();
          if (jn && jn.merged) UDS.ui.toast(`두 도로를 한 도로(${jn.name})로 이었습니다. ${UDS.ui.undoTip()}`);
          else if (isEnd && wasDead && !app.D.deadEnds.some((d) => d.roadId === gg.road.id && U.dist(d.p, M.verts(gg.road)[gg.i === 0 ? 0 : M.verts(gg.road).length - 1]) < 0.5)) UDS.ui.toast(jn && jn.diff ? '도로를 이었습니다. 단면이 달라 두 도로로 둡니다.' : '도로를 이었습니다.');
          if (gg.kind === 'road' && app.D.deadEnds.length > gg.dead0) UDS.ui.toast('도로 끝이 다른 도로나 대상지 경계에서 떨어졌습니다. 끝 손잡이를 끌어 다시 이어 주세요.');
        }
        return;
      }
      if (gg.btn) return;
      const pick = app.state.tool === 'select' || app.state.tool === 'move';
      if (pick && !gg.shift && app.secMarkAt(q)) { tap(e, false); app.secFlipToggle(); return; } // A·A′를 누르면 단면 방향 바꾸기
      UDS.ui._pt = [e.clientX, e.clientY]; // 합치기 창을 누른 자리 옆에 띄우기 위해 기억해 둠
      const w = r2.s2w(q), hit = gg.kind === 'bldh' ? { type: 'building', id: gg.hd.id } : r2.hitTest(q);
      app.clickWorld(w, hit, { shift: gg.shift });
      last = { hit, w };
      tap(e, pick && !gg.shift && !!hit);
    };
    // 선택·이동 도구에서 요소를 더블클릭하면 옆의 3D가 그 요소로 다가간다(화면 크게 보기는 위의 [평면] 단추로만 바꾼다)
    let last = null;
    const tap = dblWatch(cv, () => { if (last && last.hit) app.focusFrom('2d', last.hit, last.w); });
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => {
      ptrs.delete(e.pointerId); if (g) clearTimeout(g.lt);
      if (g && g.kind === 'bldh' && g.op) app.bldOpEnd(g.op);
      app.state.bldBusy = false; g = null;
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); app.stopTween('2d'); r2.zoomAt(pos(e), Math.exp(-e.deltaY * 0.0016)); app.invalidate(1); }, { passive: false });
    // 화면 축척 칸: 1:N의 N을 치면 화면 가운데를 그대로 두고 그 축척으로 맞춘다
    const sIn = document.getElementById('sclIn');
    if (sIn) {
      const sMin = 0.15, sMax = 60;
      const back = () => { sIn.value = r2.scaleDenom().toLocaleString('ko-KR'); };
      let fresh = false; // 눌러서 들어왔을 때 뗀 자리에 커서가 놓여 고른 글자가 풀리지 않게
      sIn.addEventListener('focus', () => { sIn.select(); fresh = true; });
      sIn.addEventListener('mouseup', (e) => { if (fresh) { e.preventDefault(); fresh = false; } });
      sIn.addEventListener('input', () => { fresh = false; });
      sIn.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); sIn.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); back(); sIn.dataset.skip = '1'; sIn.blur(); }
      });
      sIn.addEventListener('change', () => {
        if (sIn.dataset.skip) { delete sIn.dataset.skip; back(); return; }
        const t = String(sIn.value).split(':').pop().replace(/[^\d.]/g, ''), n = parseFloat(t);
        if (!(n > 0)) { back(); UDS.ui.toast('축척은 1:500처럼 숫자로 넣어 주세요.'); return; }
        const s1 = 1000 / (n * 0.2646), s2 = U.clamp(s1, sMin, sMax);
        if (s2 !== s1) UDS.ui.toast(`화면 축척은 1:${r2.scaleDenom(sMax).toLocaleString('ko-KR')}에서 1:${r2.scaleDenom(sMin).toLocaleString('ko-KR')} 사이로 맞춥니다.`);
        app.tween('2d', r2.view, { s: s2 }, 280, 1);
        sIn.value = r2.scaleDenom(s2).toLocaleString('ko-KR');
      });
      sIn.addEventListener('blur', () => { delete sIn.dataset.skip; setTimeout(() => { if (document.activeElement !== sIn) back(); }, 320); });
    }
    cv.addEventListener('dblclick', () => { if (app.state.tool === 'road') app.finishRoad(); else if (app.state.tool === 'build' && app.state.drawBld && app.state.drawBld.pts.length >= 3) app.bldDrawFinish(); else if (app.state.tool === 'water' && app.state.drawWater && app.state.drawWater.pts.length) app.waterFinish(); });
    cv.addEventListener('pointerleave', () => { if (app.state.hover) { app.state.hover = null; app.invalidate(1); } });
  }

  function bind3D(cv) {
    const r3 = app.r3;
    const ptrs = new Map();
    let g = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      app.stopTween('3d');
      const q = pos(e);
      ptrs.set(e.pointerId, q);
      if (ptrs.size === 2) { if (g) clearTimeout(g.lt); const [a, b] = Array.from(ptrs.values()); g = { kind: 'pinch', d: Math.max(8, U.dist(a, b)), c: U.mid(a, b), moved: true }; return; }
      g = { kind: e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'orbit', lx: q[0], ly: q[1], sx: q[0], sy: q[1], moved: false, btn: e.button || 0, shift: !!e.shiftKey };
      // 손가락·펜: 선택 도구에서 길게 누르면 여럿 고르기에 더한다
      if (e.pointerType && e.pointerType !== 'mouse' && app.state.tool === 'select') {
        const gl = g, at = [e.clientX, e.clientY];
        gl.lt = setTimeout(() => {
          if (g !== gl || gl.moved || ptrs.size !== 1) return;
          const pk = pick3(q);
          if (!pk.hit) return;
          gl.long = true;
          UDS.ui._pt = at;
          app.clickWorld(pk.w, pk.hit, { shift: true });
          try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* 무시 */ }
        }, 480);
      }
    });
    /* 누른 자리에서 집히는 것. 가구 경계선(도로 가장자리) 가까이의 바닥이면 가구를 돌려준다 */
    const pick3 = (q) => {
      const st = app.state;
      const pickTool = st.tool === 'select' || st.tool === 'move';
      const w = r3.rayGround(q[0], q[1]);
      let hit = pickTool || st.tool === 'erase' || st.tool === 'build' ? r3.pickAt(q[0], q[1]) : null;
      if (pickTool && w && (!hit || hit.type === 'road' || hit.type === 'lot')) {
        const c = r3.cam, mpp = (c.dist * Math.tan(c.fov / 2) * 2) / Math.max(1, r3.cssH || 600); // 화면 1픽셀이 바닥에서 몇 m쯤인지
        const blk = app.blockEdgeAt(w, U.clamp(5 * mpp, 0.6, 4));
        if (blk) hit = { type: 'block', id: blk.id };
      }
      return { w, hit, pickTool };
    };
    cv.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId) || !g) return;
      const q = pos(e);
      ptrs.set(e.pointerId, q);
      if (g.kind === 'pinch' && ptrs.size >= 2) {
        const [a, b] = Array.from(ptrs.values());
        const d = Math.max(8, U.dist(a, b)), c = U.mid(a, b);
        r3.zoom(g.d / d); r3.pan(c[0] - g.c[0], c[1] - g.c[1]);
        g.d = d; g.c = c;
        app.invalidate(2);
        return;
      }
      if (g.long) return;
      if (!g.moved && Math.hypot(q[0] - g.sx, q[1] - g.sy) < (e.pointerType === 'mouse' ? 5 : 8)) return;
      g.moved = true; clearTimeout(g.lt);
      const dx = q[0] - g.lx, dy = q[1] - g.ly;
      g.lx = q[0]; g.ly = q[1];
      if (g.kind === 'pan') r3.pan(dx, dy); else r3.orbit(dx, dy);
      app.invalidate(2);
    });
    const up = (e) => {
      const q = pos(e);
      const had = ptrs.has(e.pointerId);
      ptrs.delete(e.pointerId);
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      if (!g || !had) return;
      if (g.kind === 'pinch') { if (ptrs.size === 1) { const p = Array.from(ptrs.values())[0]; g = { kind: 'orbit', lx: p[0], ly: p[1], sx: p[0], sy: p[1], moved: true, btn: 0 }; } else g = null; return; }
      const gg = g; g = null;
      clearTimeout(gg.lt);
      if (gg.moved || gg.btn || gg.long) { tap(e, false); return; }
      const pk = pick3(q);
      UDS.ui._pt = [e.clientX, e.clientY];
      app.clickWorld(pk.w, pk.hit, { shift: gg.shift, src: '3d' }); // Shift+끌기는 화면 이동, Shift+누름은 여럿 고르기
      last = pk;
      tap(e, pk.pickTool && !gg.shift && !!pk.hit);
    };
    // 요소를 더블클릭하면 옆의 평면이 그 요소로 다가간다
    let last = null;
    const tap = dblWatch(cv, () => { if (last && last.hit) app.focusFrom('3d', last.hit, last.w); });
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); if (g) clearTimeout(g.lt); g = null; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); app.stopTween('3d'); r3.zoom(Math.exp(e.deltaY * 0.0013)); app.invalidate(2); }, { passive: false });
  }

  app.camPreset = function (k) {
    const r3 = this.r3; if (!r3.ok) return;
    this.stopTween('3d');
    if (k === 'eye') {
      const road = this.secRoad();
      if (road) {
        const info = this.D.roadInfo.get(road.id);
        const s = this.state.secS === null || this.state.secS === undefined ? info.len / 2 : this.state.secS;
        const q = U.pointAlong(road.pts, U.clamp(s, 0, info.len));
        r3.lookAlong(q.p, q.dir, Math.min(34, Math.max(16, info.len * 0.18)), 0.045);
      }
    } else r3.preset(k);
    this.invalidate(2);
  };

  /* ---------- 시작 ---------- */
  app.start = function () {
    const $ = (s) => document.querySelector(s);
    this.r2 = new UDS.Render2D($('#cv2d'), this);
    this.r3 = new UDS.Render3D($('#cv3d'), this);
    this.traffic = new UDS.Traffic();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.trafficKick(); else this.saveNow(); });
    window.addEventListener('pagehide', () => this.saveNow());
    this.sec = new UDS.Section($('#cvsec'), this);
    if (!this.r3.ok) { const m = $('#no3d'); if (m) m.hidden = false; const cp = $('#compass3'); if (cp) cp.hidden = true; }
    bind2D(this.r2.cv);
    if (this.r3.ok) bind3D(this.r3.cv);
    UDS.ui.init();
    const saved = this.restore();
    const savedCtx = saved && saved.ctx ? this.restoreCtx(saved.ctx.id) : null;
    this.matImg = this.restoreMat();
    this.load(saved || M.scenes.standard.make(), saved ? { save: false, initial: this.restoreInitial(saved), ctx: savedCtx } : { save: false });
    const lost = '이전 작업을 이어서 엽니다. 현황 건물 자료는 이 브라우저에 남아 있지 않아 보이지 않습니다(작업 파일로 저장해 두면 함께 열립니다).';
    if (saved && saved.ctx && !savedCtx && IDB.ok) { // 큰 현황 자료는 IndexedDB에서 꺼낸다(비동기)
      UDS.ui.toast('이 브라우저에 저장된 이전 작업을 이어서 엽니다. 현황 건물 자료를 읽는 중…');
      IDB.get('ctx').then((cx) => {
        if (cx && Array.isArray(cx.bld) && this.P && this.P.ctx && cx.id === this.P.ctx.id && !this.ctx) {
          this.ctx = cx; this._ctxIdx = null; this._ctxSh = null;
          this.derive(true); this.refresh();
          UDS.ui.toast('이 브라우저에 저장된 이전 작업을 이어서 엽니다.');
        } else if (!this.ctx) UDS.ui.toast(lost);
      }).catch(() => { if (!this.ctx) UDS.ui.toast(lost); });
    } else if (saved) UDS.ui.toast(saved.ctx && !savedCtx ? lost : '이 브라우저에 저장된 이전 작업을 이어서 엽니다.');
    // 크기 변화
    const onSize = () => {
      const r2 = this.r2;
      const first = !this._sized;
      r2.resize(); this.sec.resize();
      if (first && r2.W > 20) { this._sized = true; r2.fit(this.P.site, 1.14); }
      if (this._pend2 && r2.W > 20 && r2.H > 20) { const fb = this._pend2; this._pend2 = null; this.flyPlan(fb, 0); }
      this.invalidate(7);
    };
    if (window.ResizeObserver) { const ro = new ResizeObserver(onSize); ['#v2d', '#v3d', '#secwrap'].forEach((s) => { const el = $(s); if (el) ro.observe(el); }); }
    window.addEventListener('resize', onSize);
    onSize();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.invalidate(7));
    window.addEventListener('keydown', (e) => {
      const el = e.target || {}, tag = el.tagName || '';
      // 글자를 치는 칸(글·숫자 입력, 글상자)에서는 단축키를 받지 않는다. 체크·슬라이더·색 고르기는 글자를 치는 칸이 아니다
      const texty = tag === 'TEXTAREA' || (tag === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'button', 'file'].includes(el.type));
      const typing = texty || tag === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); this.redo(); return; }
      // 작업 파일 저장·열기, 사용법(브라우저의 '페이지 저장'·'열기' 대신)
      if (mod && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); UDS.ui.run('savefile'); return; }
      if (mod && !e.shiftKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); UDS.ui.run('openfile'); return; }
      if (e.key === 'F1') { e.preventDefault(); UDS.ui.run('help'); return; }
      if (e.key === 'Escape') {
        if (UDS.ui.closeOverlays()) return;
        if (this.state.lenBuf) { this.state.lenBuf = ''; UDS.ui.hint(); this.invalidate(1); return; } // 치던 길이만 지운다
        if (this.state.drawBld && this.state.drawBld.pts.length) { this.state.drawBld = null; UDS.ui.hint(); this.invalidate(1); return; }
        if (this.state.drawWater && this.state.drawWater.pts.length) { this.waterCancel(); return; }
        if (this.state.drawRoad && this.state.drawRoad.pts.length) this.cancelDraw();
        else if (this.state.max) UDS.ui.setMax(null);
        else if (this.state.tool !== 'select') this.setTool('select');
        else if (this.state.sel) this.select(null);
        return;
      }
      if (mod || e.altKey) return;
      if (e.target === this.sec.cv) return;
      const dlg = document.getElementById('dialog');
      if (dlg && !dlg.hidden) return;
      // 그리는 중(도로·건물): 숫자를 치면 지금 마우스 방향으로 그 길이(m)만큼 정확히 놓는다. Backspace는 한 글자(없으면 마지막 점), Enter는 놓기(없으면 마치기)
      const drw = !typing && this.activeDraw();
      if (drw) {
        const k = e.key, buf = this.state.lenBuf || '';
        if (/^[0-9]$/.test(k) || ((k === '.' || k === ',' || k === 'Decimal') && !buf.includes('.'))) {
          if (buf.length < 7) this.state.lenBuf = buf + (/^[0-9]$/.test(k) ? k : '.');
          e.preventDefault(); UDS.ui.hint(); this.invalidate(1); return;
        }
        if (k === 'Backspace') {
          e.preventDefault();
          if (buf) this.state.lenBuf = buf.slice(0, -1);
          else { drw.pts.pop(); if (!drw.pts.length && drw === this.state.drawRoad) this.cancelDraw(); }
          UDS.ui.hint(); this.invalidate(1); return;
        }
        if (k === 'Enter') {
          e.preventDefault();
          if (buf) this.drawTyped();
          else if (drw === this.state.drawBld) this.bldDrawFinish();
          else this.finishRoad();
          return;
        }
      }
      // 수공간 그리는 중: Enter는 마치기, Backspace는 마지막 점 지우기
      const dw = !typing && this.state.tool === 'water' && this.state.drawWater && this.state.drawWater.pts.length ? this.state.drawWater : null;
      if (dw && e.key === 'Enter') { e.preventDefault(); this.waterFinish(); return; }
      if (dw && e.key === 'Backspace') { e.preventDefault(); dw.pts.pop(); UDS.ui.hint(); this.invalidate(1); return; }
      // Delete는 글자를 치는 칸만 아니면 언제나 고른 것을 지운다(목록 상자에 초점이 남아 있어도)
      if (e.key === 'Delete' || (e.key === 'Backspace' && !typing)) { if (texty) return; if (this.selList().length) { this.deleteSelected(); e.preventDefault(); } return; }
      if (typing) return;
      if (e.key === 'Enter' && this.state.tool === 'road') this.finishRoad();
      else if (e.key === 'v' || e.key === 'V') this.setTool('select');
      else if (e.key === 'm' || e.key === 'M') this.setTool('move');
      else if (e.key === 'e' || e.key === 'E') this.setTool('erase');
      else if (e.key === 'r' || e.key === 'R') this.setTool('road', this.state.roadPreset);
      else if (e.key === 'b' || e.key === 'B') this.setTool('build', this.state.buildUse);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
