/* Urbify — 음영분석의 조도분석: 태양 궤적도, 일조시간 지도, 가로등 조도 지도
 * 학습용 어림 계산이다. 일조시간은 건물(계획 건물과 실제 지역의 현황 건물) 그림자만 세고 수목·지형은 빼며,
 * 가로등 조도는 점광원의 수평면 조도(E = I·cos³θ / h²)를 더한 값으로 반사와 배광은 무시한다. */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U;
  const Ana = (UDS.Ana = {});
  const SEASONS = [['winter', '동지'], ['equinox', '춘분·추분'], ['summer', '하지']];
  const DIR16 = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
  Ana.SEASONS = SEASONS;

  /* 지금 해의 고도·방위(도, 방위는 북=0 시계방향)와 16방위 이름 */
  Ana.sunNow = function (S) {
    const v = UDS.sunVector(S);
    const az = (((v.az * 180) / Math.PI) % 360 + 360) % 360;
    return { alt: (v.alt * 180) / Math.PI, az, dir: DIR16[Math.round(az / 22.5) % 16] };
  };
  /* 해의 길: 동지·춘추분·하지(+ 지금 날짜가 그 밖이면 그날). 일출~일몰을 0.1시간 간격으로. hours는 정시 표시점 */
  const SEASON_DAY = { winter: 356, equinox: 80, summer: 172 };
  Ana.sunPath = function (S) {
    const d = UDS.dayOf(S);
    const list = SEASONS.map(([season, name]) => ({ season, name, doy: SEASON_DAY[season], cur: season === 'equinox' ? d === 80 || d === 266 : d === SEASON_DAY[season] }));
    if (!list.some((x) => x.cur)) list.push({ season: 'date', name: UDS.fmtDate(d), doy: d, cur: true });
    return list.map(({ season, name, doy, cur }) => {
      const S2 = { lat: S.lat, doy };
      const t = UDS.sunTimes(S2);
      const pts = [], hours = [];
      const at = (h) => { const v = UDS.sunVector({ ...S2, hour: h }); return { h, az: v.az, alt: Math.max(0, v.alt) }; };
      pts.push(at(t[0]));
      for (let h = Math.ceil(t[0] * 10) / 10; h < t[1]; h += 0.1) pts.push(at(h));
      pts.push(at(t[1]));
      for (let h = Math.ceil(t[0]); h <= Math.floor(t[1]); h++) { const p = at(h); if (p.alt > 0.01) hours.push(p); }
      return { season, name, doy, pts, hours, cur, rise: t[0], set: t[1] };
    });
  };

  /* ---------- 격자 ---------- */
  function grid(site, target) {
    const cell = U.clamp(Math.round(Math.sqrt((site.w * site.h) / target) * 2) / 2, 1.5, 8);
    return { cell, nx: Math.ceil(site.w / cell), ny: Math.ceil(site.h / cell), x0: 0, y0: 0 };
  }
  /* 다각형 안에 중심이 든 칸마다 cb(index). 홀짝 규칙(오목·구멍 있는 고리도 됨) */
  function scan(rings, g, cb) {
    let y0 = Infinity, y1 = -Infinity;
    rings.forEach((r) => r.forEach((p) => { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }));
    const j0 = Math.max(0, Math.ceil((y0 - g.y0) / g.cell - 0.5)), j1 = Math.min(g.ny - 1, Math.floor((y1 - g.y0) / g.cell - 0.5));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const yc = g.y0 + (j + 0.5) * g.cell;
      xs.length = 0;
      rings.forEach((r) => {
        for (let k = 0, n = r.length; k < n; k++) {
          const a = r[k], b = r[(k + 1) % n];
          if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      });
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cell - 0.5)), i1 = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / g.cell - 0.5));
        for (let i = i0; i <= i1; i++) cb(j * g.nx + i);
      }
    }
  }
  function hull(pts) {
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (P.length < 3) return P;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    P.forEach((p) => { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  /* 그림자를 드리우는 매스: 계획 건물과 보이는 현황 건물 [{ o: 바닥 다각형, h }] */
  function casters(app) {
    const D = app.D, out = [];
    if (app.state.layers.buildings !== false) D.buildings.forEach((b) => out.push({ o: b.fp, h: b.h }));
    const cx = app.ctxData ? app.ctxData() : null;
    if (cx && app.state.layers.ctx !== false && D.ctxV && UDS.Ctx) cx.bld.forEach((b) => { if (UDS.Ctx.shown(D.ctxV, b.id)) b.parts.forEach((pt) => out.push({ o: pt.o, h: pt.h || b.h })); });
    return out;
  }
  /* 건물 바닥(그림을 얹지 않는 칸) */
  function footMask(app, g) {
    const m = new Uint8Array(g.nx * g.ny);
    casters(app).forEach((c) => scan([c.o], g, (k) => { m[k] = 1; }));
    return m;
  }
  /* 잦은 변경(끌기 중)에는 잠깐 묵은 결과를 쓰고 조금 뒤 다시 계산한다 */
  const cache = {};
  function memo(app, slot, key, fn) {
    const c = cache[slot];
    if (c && c.key === key) return c;
    const now = performance.now();
    const hard = `${app.P.site.w}x${app.P.site.h}:${app.P.meta.uid}`; // 다른 대상지로 바뀌었으면 바로 다시 센다
    if (c && now - c.t < 400 && c.hard === hard) {
      if (!c.timer) c.timer = setTimeout(() => { c.timer = 0; c.t = 0; app.invalidate(7); if (UDS.ui && UDS.ui.xRefresh) UDS.ui.xRefresh(); app.r3 && app.r3.ok && (app.r3.ovKey = null); }, 450);
      return c;
    }
    if (c && c.timer) { clearTimeout(c.timer); }
    const r = fn();
    r.key = key; r.t = performance.now(); r.v = (c ? c.v : 0) + 1; r.timer = 0; r.hard = hard;
    cache[slot] = r;
    return r;
  }
  const geoKey = (app) => `${app.dver || 0}|${app.state.layers.buildings !== false}|${app.state.layers.ctx !== false}`;

  /* ---------- 일조시간 ----------
     8~16시를 15분 간격으로 보며 칸마다 해가 드는 시간을 더한다. 9~15시 사이에서는 가장 길게 이어진 시간도 잰다(판례의 수인한도: 동지 기준 연속 2시간 또는 총 4시간) */
  Ana.sunHours = function (app) {
    const P = app.P, S = P.settings;
    const doy = UDS.dayOf(S);
    const key = `${geoKey(app)}|${doy}|${S.lat}`;
    return memo(app, 'sun', key, () => {
      const g = grid(P.site, 15000), N = g.nx * g.ny;
      const mask = footMask(app, g), tot = new Float32Array(N), run = new Float32Array(N), best = new Float32Array(N), shade = new Uint8Array(N);
      const cs = casters(app), dt = 0.25;
      for (let h = 8 + dt / 2; h < 16; h += dt) {
        const v = UDS.sunVector({ lat: S.lat, doy, hour: h });
        shade.fill(0);
        if (v.alt <= 0.6 * Math.PI / 180) shade.fill(1);
        else {
          const k = Math.min(60, 1 / Math.tan(v.alt)), sx = -Math.sin(v.az) * k, sy = -Math.cos(v.az) * k;
          cs.forEach((c) => {
            const pts = c.o.concat(c.o.map((p) => [p[0] + sx * c.h, p[1] + sy * c.h]));
            scan([hull(pts)], g, (i) => { shade[i] = 1; });
          });
        }
        const inCore = h > 9 && h < 15;
        for (let i = 0; i < N; i++) {
          if (!shade[i]) { tot[i] += dt; if (inCore) { run[i] += dt; if (run[i] > best[i]) best[i] = run[i]; } }
          else run[i] = 0;
        }
      }
      let n = 0, ok4 = 0, ok2 = 0, bad = 0;
      for (let i = 0; i < N; i++) {
        if (mask[i]) continue;
        n++;
        if (tot[i] >= 4 - 1e-6) ok4++;
        if (best[i] >= 2 - 1e-6) ok2++;
        if (tot[i] < 4 - 1e-6 && best[i] < 2 - 1e-6) bad++;
      }
      return { kind: 'sun', ...g, mask, val: tot, best, doy, stats: { n, ok4: n ? ok4 / n : 0, ok2: n ? ok2 / n : 0, bad: n ? bad / n : 0 } };
    });
  };

  /* ---------- 가로등 조도 ---------- */
  function lamps(app) {
    const D = app.D, out = [];
    if (app.state.layers.furniture === false) return out;
    // 광도(cd)는 학습용 어림: 도로 가로등 아래 약 28lx, 보행등 아래 약 15lx
    D.lights.forEach((l) => { const a = l.ang + (l.dir < 0 ? -Math.PI / 2 : Math.PI / 2); out.push({ x: l.x + Math.cos(a) * 1.4, y: l.y + Math.sin(a) * 1.4, h: 8.4, I: 2000 }); });
    D.furniture.forEach((f) => {
      if (f.type === 'light') out.push({ x: f.x, y: f.y, h: 4.4, I: 290 });
      else if (f.type === 'smartpole') out.push({ x: f.x, y: f.y, h: 9, I: 2000 });
      else if (f.type === 'busstop') out.push({ x: f.x, y: f.y, h: 2.6, I: 60 });
    });
    return out;
  }
  Ana.lux = function (app) {
    const P = app.P, D = app.D;
    const key = `${geoKey(app)}|${app.state.layers.furniture !== false}`;
    return memo(app, 'lux', key, () => {
      const g = grid(P.site, 24000), N = g.nx * g.ny;
      const mask = footMask(app, g), E = new Float32Array(N), Ls = lamps(app);
      const R = 42;
      Ls.forEach((L) => {
        const i0 = Math.max(0, Math.floor((L.x - R) / g.cell)), i1 = Math.min(g.nx - 1, Math.ceil((L.x + R) / g.cell));
        const j0 = Math.max(0, Math.floor((L.y - R) / g.cell)), j1 = Math.min(g.ny - 1, Math.ceil((L.y + R) / g.cell));
        const h2 = L.h * L.h;
        for (let j = j0; j <= j1; j++) {
          const dy = g.y0 + (j + 0.5) * g.cell - L.y;
          for (let i = i0; i <= i1; i++) {
            const dx = g.x0 + (i + 0.5) * g.cell - L.x, d2 = dx * dx + dy * dy;
            if (d2 > R * R) continue;
            const q = h2 + d2;
            E[j * g.nx + i] += (L.I * L.h) / (q * Math.sqrt(q));
          }
        }
      });
      // 도로·보도(가구 밖) 칸만 따로 모아 평균·최소·어두운 비율
      const inBlk = new Uint8Array(N);
      D.blocks.forEach((b) => scan([b.poly], g, (k) => { inBlk[k] = 1; }));
      let n = 0, sum = 0, mn = Infinity, dark = 0;
      for (let i = 0; i < N; i++) { if (mask[i] || inBlk[i]) continue; n++; sum += E[i]; if (E[i] < mn) mn = E[i]; if (E[i] < 3) dark++; }
      return { kind: 'lux', ...g, mask, val: E, stats: { n: Ls.length, avg: n ? sum / n : 0, min: n ? mn : 0, dark: n ? dark / n : 0 } };
    });
  };

  /* ---------- 색 ---------- */
  const RAMP = {
    sun: [[0, '#2f3375'], [1, '#4c4a9e'], [2, '#8661b3'], [3, '#c97aa8'], [4, '#ef9f78'], [5, '#f6c065'], [6.5, '#f9de76'], [8, '#fcf3b2']],
    lux: [[0, '#101329'], [1, '#232766'], [3, '#43398f'], [5, '#7244a8'], [10, '#b65e9b'], [20, '#ee9a5c'], [30, '#f9d272'], [50, '#fff6cf']],
  };
  const rgbCache = {};
  const rgb = (h) => rgbCache[h] || (rgbCache[h] = U.hexToRgb(h));
  Ana.color = function (kind, v) {
    const R = RAMP[kind];
    if (v <= R[0][0]) return rgb(R[0][1]);
    for (let i = 1; i < R.length; i++) {
      if (v <= R[i][0]) { const t = (v - R[i - 1][0]) / (R[i][0] - R[i - 1][0]), a = rgb(R[i - 1][1]), b = rgb(R[i][1]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    }
    return rgb(R[R.length - 1][1]);
  };
  Ana.legendHTML = function (kind) {
    const R = RAMP[kind], max = R[R.length - 1][0], n = 16;
    let bar = '';
    for (let i = 0; i < n; i++) { const c = Ana.color(kind, ((i + 0.5) / n) * max); bar += `<i style="background:rgb(${c.map((x) => Math.round(x * 255)).join(',')})"></i>`; }
    const ticks = kind === 'sun' ? ['0', '2', '4', '6', '8시간'] : ['0', '10', '20', '30', '40', '50lx'];
    return `<div class="aleg">${bar}</div><div class="alegt">${ticks.map((t) => `<span>${t}</span>`).join('')}</div>`;
  };
  /* 평면용 그림: 칸 하나가 화소 하나인 캔버스(건물 바닥은 비움). 화면에 늘려 그리면 부드럽게 이어진다 */
  Ana.canvas = function (r) {
    if (r.cv && r.cvV === r.v) return r.cv;
    const cv = r.cv || document.createElement('canvas');
    cv.width = r.nx; cv.height = r.ny;
    const g = cv.getContext('2d'), img = g.createImageData(r.nx, r.ny), d = img.data;
    for (let j = 0; j < r.ny; j++) for (let i = 0; i < r.nx; i++) {
      const k = j * r.nx + i, o = ((r.ny - 1 - j) * r.nx + i) * 4;
      if (r.mask[k]) { d[o + 3] = 0; continue; }
      const c = Ana.color(r.kind, r.val[k]);
      d[o] = c[0] * 255; d[o + 1] = c[1] * 255; d[o + 2] = c[2] * 255; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    r.cv = cv; r.cvV = r.v;
    return cv;
  };
  /* ---------- 입지 분석 ----------
     고른 건물(획지)에서 도로 중심선을 따라 잰 보행 거리로 둘레 시설을 본다. 5분 400m · 10분 800m.
     획지·시설은 접한 도로(없으면 가장 가까운 도로) 위의 한 점으로 대신하고, 도로에서 건물까지의 거리를 더한다 */
  function armIndex(D) {
    return D.arms.filter((a) => a.pts && a.pts.length > 1 && a.len > 0).map((a) => {
      const cum = [0]; for (let i = 1; i < a.pts.length; i++) cum.push(cum[i - 1] + U.dist(a.pts[i - 1], a.pts[i]));
      return { a, cum };
    });
  }
  /* 점 p에서 가장 가까운 팔 위의 자리. roadIds가 있으면 그 길들 가운데서 */
  function attach(AX, p, roadIds) {
    let best = null;
    const tryA = (o) => {
      const pts = o.a.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const q = U.distPointSeg(p, pts[i], pts[i + 1]);
        if (!best || q.d < best.d) best = { arm: o.a, s: o.cum[i] + q.t * (o.cum[i + 1] - o.cum[i]), d: q.d };
      }
    };
    if (roadIds && roadIds.length) AX.forEach((o) => { if (roadIds.includes(o.a.road.id)) tryA(o); });
    if (!best) AX.forEach(tryA);
    return best;
  }
  function dijkstra(D, src) { // src: [[node, d0], ...] → Map(node → 거리)
    const adj = new Map();
    D.arms.forEach((a) => {
      if (!(a.len > 0)) return;
      [[a.startNode, a.endNode], [a.endNode, a.startNode]].forEach(([u, v]) => { if (!adj.has(u)) adj.set(u, []); adj.get(u).push([v, a.len]); });
    });
    const dist = new Map(), done = new Set();
    src.forEach(([n, d]) => { if (!dist.has(n) || d < dist.get(n)) dist.set(n, d); });
    for (;;) {
      let u = null, du = Infinity;
      dist.forEach((d, n) => { if (!done.has(n) && d < du) { du = d; u = n; } });
      if (u === null) break;
      done.add(u);
      (adj.get(u) || []).forEach(([v, w]) => { const nd = du + w; if (!dist.has(v) || nd < dist.get(v)) dist.set(v, nd); });
    }
    return dist;
  }
  const lotRoads = (lot) => (lot.frontage || []).filter((f) => f.roadId).map((f) => f.roadId);
  Ana.location = function (app, lotId) {
    const P = app.P, D = app.D, C = UDS.C;
    const key = `${app.dver || 0}|${lotId}`;
    if (cache.loc && cache.loc.key === key) return cache.loc;
    const lot = D.lots.find((l) => l.id === lotId); if (!lot) return null;
    const AX = armIndex(D);
    const cOf = (poly) => U.polyCentroid(poly);
    const o = attach(AX, lot.building ? cOf(lot.building.fp) : cOf(lot.poly), lotRoads(lot));
    if (!o) return null;
    const dist = dijkstra(D, [[o.arm.startNode, o.s], [o.arm.endNode, o.arm.len - o.s]]);
    const netTo = (t) => {
      if (!t) return Infinity;
      let d = Infinity;
      if (t.arm === o.arm) d = Math.abs(t.s - o.s);
      const a = dist.get(t.arm.startNode), b = dist.get(t.arm.endNode);
      if (a !== undefined) d = Math.min(d, a + t.s);
      if (b !== undefined) d = Math.min(d, b + t.arm.len - t.s);
      return d + t.d + o.d;
    };
    // 접한 도로
    const front = [];
    (lot.frontage || []).forEach((f) => {
      if (!f.roadId) return;
      const info = D.roadInfo.get(f.roadId); if (!info) return;
      const ex = front.find((x) => x.id === f.roadId);
      if (ex) { ex.len += f.len; return; }
      const types = new Set(info.lay.bands.map((b) => b.seg.type));
      front.push({ id: f.roadId, name: info.road.name, cls: info.cls, W: info.lay.W, len: f.len, walk: types.has('sidewalk') || types.has('pedestrian') || types.has('shared'), bike: types.has('biketrack') || types.has('bikelane'), bus: types.has('bus') });
    });
    // 시설: 획지 용도·건물, 가로시설물, 실제 지역의 현황 건물
    const groups = [
      { k: 'park', name: '공원·녹지', test: (l) => l.use === 'park' || l.use === 'green' },
      { k: 'plaza', name: '광장', test: (l) => l.use === 'plaza' },
      { k: 'pub', name: '공공시설', test: (l) => l.use === 'pub' && l.building },
      { k: 'com', name: '상업·근린생활', test: (l) => (l.use === 'com' || l.use === 'mixed' || l.use === 'market') && l.building },
      { k: 'off', name: '업무', test: (l) => l.use === 'off' && l.building },
      { k: 'parking', name: '주차장', test: (l) => l.use === 'parking' },
    ];
    const rows = groups.map((g) => ({ k: g.k, name: g.name, near: Infinity, n4: 0, n8: 0 }));
    let pop4 = 0;
    const m2 = (P.settings && P.settings.m2PerPerson) || 35;
    D.lots.forEach((l) => {
      if (l.id === lot.id) return;
      const gi = groups.findIndex((g) => g.test(l));
      const isRes = (l.use === 'res' || l.use === 'mixed') && l.building;
      if (gi < 0 && !isRes) return;
      const t = attach(AX, l.building ? cOf(l.building.fp) : cOf(l.poly), lotRoads(l));
      const d = netTo(t);
      if (isRes && d <= 400) pop4 += ((l.cx ? l.cx.gfa : l.building.gfa) * (l.use === 'mixed' ? 0.6 : 1)) / m2; // 단지는 모든 동
      if (gi < 0) return;
      const r = rows[gi];
      r.near = Math.min(r.near, d); if (d <= 400) r.n4++; if (d <= 800) r.n8++;
    });
    const objs = [{ k: 'bus', name: '버스정류장', types: ['busstop'] }, { k: 'bike', name: '자전거 거치대·PM 주차', types: ['bikerack', 'pm'] }];
    objs.forEach((g) => {
      const r = { k: g.k, name: g.name, near: Infinity, n4: 0, n8: 0 };
      P.objects.forEach((ob) => { if (!g.types.includes(ob.type)) return; const d = netTo(attach(AX, [ob.x, ob.y])); r.near = Math.min(r.near, d); if (d <= 400) r.n4++; if (d <= 800) r.n8++; });
      rows.push(r);
    });
    // 실제 지역: 현황 건물의 용도 분류
    const cx = app.ctxData ? app.ctxData() : null;
    if (cx && cx.bld && cx.bld.length && D.ctxV && UDS.Ctx) {
      const X = UDS.Ctx, cats = ['res', 'com', 'off', 'pub'];
      const cr = cats.map((c) => ({ k: 'ctx-' + c, name: `현황 ${X.CATS[c].name}`, near: Infinity, n4: 0, n8: 0, ctx: true }));
      cx.bld.forEach((b) => {
        if (!X.shown(D.ctxV, b.id)) return;
        const i = cats.indexOf(b.cat); if (i < 0) return;
        const dd = U.dist(b.c, o.arm.pts[0]) > 1600 ? Infinity : netTo(attach(AX, b.c));
        const r = cr[i]; r.near = Math.min(r.near, dd); if (dd <= 400) r.n4++; if (dd <= 800) r.n8++;
      });
      cr.forEach((r) => rows.push(r));
    }
    const res = { key, lotId, front, corner: front.length >= 2, rows, pop4: Math.round(pop4), road: o.arm.road.name, dRoad: o.d };
    cache.loc = res;
    return res;
  };

  /* 지금 켜진 지도(일조시간이 먼저). 둘 다 켜졌으면 밤이면 조도를, 낮이면 일조시간을 보인다 */
  Ana.active = function (app) {
    const A = app.state.ana;
    if (!A || (!A.sunhours && !A.lux)) return null;
    if (A.sunhours && A.lux) return UDS.sky(app.P.settings).day < 0.5 ? Ana.lux(app) : Ana.sunHours(app);
    return A.sunhours ? Ana.sunHours(app) : Ana.lux(app);
  };

  /* ---------- 건물 하나의 태양궤적도(스테레오 투영) ----------
     관측점: 고른 방향(남·동·서·북)에 가장 가까운 입면의 가운데, 지상 1.5m 높이(옥상이면 지붕 가운데에서 0.5m 위).
     방위 2°마다 둘레 건물이 하늘을 가리는 고도각을 구해 궤적도에 겹친다. 입면 뒤쪽 하늘은 건물 자신이 가린다(따로 칠함).
     수목은 세지 않는다(일조시간 지도와 같음) */
  const FACE_DIR = { S: [0, -1], E: [1, 0], W: [-1, 0], N: [0, 1] };
  Ana.FACES = [['S', '남'], ['E', '동'], ['W', '서'], ['N', '북'], ['R', '옥상']];
  function bldPoint(b, face) {
    const fp = b.fp, n = fp.length;
    const c = U.polyCentroid(fp);
    if (face === 'R') return { p: c, z: b.h + 0.5, nrm: null };
    const t = FACE_DIR[face] || FACE_DIR.S;
    let best = null, bs = -Infinity;
    for (let k = 0; k < n; k++) {
      const a = fp[k], e = fp[(k + 1) % n], L = U.dist(a, e); if (L < 1.5) continue;
      const d = U.norm(U.sub(e, a)), m = U.mid(a, e);
      let nn = [d[1], -d[0]];
      if (U.pointInPoly(U.add(m, U.mul(nn, 0.05)), fp)) nn = [-nn[0], -nn[1]];
      const sc = nn[0] * t[0] + nn[1] * t[1] + Math.min(L, 40) * 0.004; // 방향이 비슷하면 긴 면
      if (sc > bs) { bs = sc; best = { p: U.add(m, U.mul(nn, 0.3)), nrm: nn, len: L }; }
    }
    return best ? { p: best.p, z: Math.min(1.5, b.h * 0.5), nrm: best.nrm, len: best.len } : { p: c, z: b.h + 0.5, nrm: null };
  }
  /* 점 o에서 (dx,dy) 쪽으로 쏜 반직선이 다각형 변과 처음 만나는 거리(없으면 -1) */
  function rayPoly(o, dx, dy, poly) {
    let tm = -1;
    for (let k = 0, n = poly.length; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1];
      const den = dx * ey - dy * ex; if (Math.abs(den) < 1e-12) continue;
      const ax = a[0] - o[0], ay = a[1] - o[1];
      const t = (ax * ey - ay * ex) / den, s = (ax * dy - ay * dx) / den;
      if (t > 0.02 && s >= 0 && s <= 1 && (tm < 0 || t < tm)) tm = t;
    }
    return tm;
  }
  Ana.bldSky = function (app, lotId, face) {
    const b = app.D.buildings.find((x) => x.lotId === lotId); if (!b) return null;
    const key = `${geoKey(app)}|${lotId}|${face}`;
    if (cache.sky && cache.sky.key === key) return cache.sky;
    const pt = bldPoint(b, face), cs = casters(app), N = 180;
    const other = new Float32Array(N), own = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const az = (i * 2 * Math.PI) / 180, dx = Math.sin(az), dy = Math.cos(az);
      let e1 = 0;
      cs.forEach((c) => { if (c.h <= pt.z || c.o === b.fp) return; const t = rayPoly(pt.p, dx, dy, c.o); if (t > 0) { const e = (Math.atan2(c.h - pt.z, t) * 180) / Math.PI; if (e > e1) e1 = e; } });
      other[i] = e1;
      if (pt.nrm) own[i] = dx * pt.nrm[0] + dy * pt.nrm[1] < -1e-6 ? 90 : 0; // 입면 뒤쪽은 벽이 모두 가림
      else { const t = rayPoly(pt.p, dx, dy, b.fp); own[i] = t > 0 && b.h > pt.z ? (Math.atan2(b.h - pt.z, t) * 180) / Math.PI : 0; }
    }
    cache.sky = { key, b, face, pt, other, own };
    return cache.sky;
  };
  const maskAt = (m, azDeg) => { const f = (((azDeg % 360) + 360) % 360) / 2, i = Math.floor(f) % 180, j = (i + 1) % 180, k = f - Math.floor(f); return m[i] * (1 - k) + m[j] * k; };
  /* 그날 관측점에 해가 드는 시간: 하루 전체, 8~16시 합계, 9~15시 가장 길게 이어진 시간(판례의 수인한도 견줌) */
  Ana.pointSun = function (sky, lat, doy) {
    const t = UDS.sunTimes({ lat, doy }), dt = 0.05;
    let all = 0, tot = 0, run = 0, best = 0;
    for (let h = t[0] + dt / 2; h < t[1]; h += dt) {
      const v = UDS.sunVector({ lat, doy, hour: h });
      const alt = (v.alt * 180) / Math.PI, az = (v.az * 180) / Math.PI;
      const lit = alt > 0.5 && alt > maskAt(sky.other, az) && alt > maskAt(sky.own, az);
      if (lit) { all += dt; if (h >= 8 && h <= 16) tot += dt; }
      if (h > 9 && h < 15) { if (lit) { run += dt; if (run > best) best = run; } else run = 0; }
    }
    return { all, tot, best, ok: tot >= 4 - 1e-6 || best >= 2 - 1e-6 };
  };
  /* 궤적도 SVG(북쪽이 위, 동쪽이 오른쪽인 평면 투영). 지평선 반지름 R, 고도 a의 반지름 R·tan((90°−a)/2) */
  Ana.stereoSVG = function (S, sky, o) {
    o = o || {};
    const W = 300, cx = 150, cy = 150, R = 124, rad = Math.PI / 180, doy = UDS.dayOf(S);
    const pr = (az, alt) => { const r = R * Math.tan(((90 - alt) / 2) * rad); return [cx + r * Math.sin(az * rad), cy - r * Math.cos(az * rad)]; };
    const f1 = (v) => Math.round(v * 10) / 10;
    const pth = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1])).join('');
    const ink = '#B5651D', grid = '#c9c3bb', txt = '#6b655f';
    let h = `<svg viewBox="0 0 ${W} ${W}" class="stereo" role="img" aria-label="태양궤적도(스테레오 투영)">`;
    h += '<defs><pattern id="sthatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#d9d4cd"/><line x1="0" y1="0" x2="0" y2="5" stroke="#9c958d" stroke-width="1.4"/></pattern></defs>';
    h += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#fdfcfa" stroke="${grid}" stroke-width="1"/>`;
    // 가림: 둘레 건물(회색), 건물 자신(빗금). 지평선 원과 가림선 사이를 칠한다
    const band = (m, fill, op) => {
      if (!m.some((v) => v > 0.2)) return '';
      const inner = [], outer = [];
      for (let i = 0; i <= 180; i++) { const az = i * 2, a = Math.min(89.5, m[i % 180]); inner.push(pr(az, a)); outer.push(pr(az, 0)); }
      return `<path d="${pth(outer)}Z${pth(inner.reverse())}Z" fill="${fill}" fill-opacity="${op}" fill-rule="evenodd" stroke="none"/>`;
    };
    // 가림선(둘레 건물) 위에 건물 자신의 빗금을 덮는다
    const edge = (m, col) => { if (!m.some((v) => v > 0.2)) return ''; const pts = []; for (let i = 0; i <= 180; i++) pts.push(pr(i * 2, Math.min(89.5, m[i % 180]))); return `<path d="${pth(pts)}" fill="none" stroke="${col}" stroke-width="0.9"/>`; };
    h += band(sky.other, '#7d7770', 0.42) + edge(sky.other, '#5f5953');
    h += band(sky.own, 'url(#sthatch)', 1);
    // 고도 원(10°마다)과 방위선(30°마다)
    for (let a = 10; a < 90; a += 10) { const r = R * Math.tan(((90 - a) / 2) * rad); h += `<circle cx="${cx}" cy="${cy}" r="${f1(r)}" fill="none" stroke="${grid}" stroke-width="${a % 30 ? 0.5 : 0.8}"${a % 30 ? ' stroke-dasharray="2 3"' : ''}/>`; }
    for (let az = 0; az < 360; az += 30) { const p0 = pr(az, 80), p1 = pr(az, 0); h += `<line x1="${f1(p0[0])}" y1="${f1(p0[1])}" x2="${f1(p1[0])}" y2="${f1(p1[1])}" stroke="${grid}" stroke-width="0.6"/>`; }
    [30, 60].forEach((a) => { const p = pr(180, a); h += `<text x="${f1(p[0] + 3)}" y="${f1(p[1] - 2)}" class="st-s" fill="${txt}">${a}°</text>`; });
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([n, az]) => { const p = pr(az, -9); h += `<text x="${f1(p[0])}" y="${f1(p[1] + 4)}" class="st-c" fill="#3a3632" text-anchor="middle">${n}</text>`; });
    // 시간선: 동지~하지 사이 같은 시각을 잇는다
    const lat = S.lat || 36.6, sample = [356, 10, 30, 50, 65, 80, 95, 110, 125, 140, 156, 172];
    for (let hr = 5; hr <= 19; hr++) {
      const pts = [];
      sample.forEach((d) => { const v = UDS.sunVector({ lat, doy: d, hour: hr }); const alt = v.alt / rad; if (alt > 0) pts.push(pr(v.az / rad, alt)); else if (pts.length) pts.push(null); });
      const segs = []; let cur = [];
      pts.forEach((p) => { if (p) cur.push(p); else { if (cur.length > 1) segs.push(cur); cur = []; } }); if (cur.length > 1) segs.push(cur);
      segs.forEach((sg) => { h += `<path d="${pth(sg)}" fill="none" stroke="${ink}" stroke-width="0.5" stroke-opacity="0.55"/>`; });
      const vw = UDS.sunVector({ lat, doy: 356, hour: hr }), vs = UDS.sunVector({ lat, doy: 172, hour: hr });
      const lab = vw.alt > 2 * rad ? pr(vw.az / rad, vw.alt / rad - 4.5) : vs.alt > 2 * rad ? pr(vs.az / rad, vs.alt / rad + 4.5) : null;
      if (lab && hr % 2 === 0) h += `<text x="${f1(lab[0])}" y="${f1(lab[1] + 3)}" class="st-s" fill="${ink}" text-anchor="middle">${hr}</text>`;
    }
    // 해의 길: 동지·춘추분·하지(점선) + 지금 날짜(굵게)
    Ana.sunPath(S).forEach((sp) => {
      const pts = sp.pts.filter((q) => q.alt > 0).map((q) => pr(q.az / rad, q.alt / rad));
      if (pts.length < 2) return;
      h += `<path d="${pth(pts)}" fill="none" stroke="${ink}" stroke-width="${sp.cur ? 2 : 0.9}"${sp.cur ? '' : ' stroke-dasharray="4 3"'}/>`;
      const q = sp.pts[Math.round(sp.pts.length * 0.5)];
      if (q && !sp.cur) { const p = pr(q.az / rad, q.alt / rad); h += `<text x="${f1(p[0])}" y="${f1(p[1] - 4)}" class="st-s" fill="${ink}" text-anchor="middle">${sp.name}</text>`; }
    });
    // 지금 해
    const v = UDS.sunVector(S), alt = v.alt / rad, az = v.az / rad;
    if (alt > 0) {
      const p = pr(az, alt), hid = alt <= maskAt(sky.other, az) || alt <= maskAt(sky.own, az);
      h += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="6" fill="${hid ? '#fff' : '#F6B93B'}" stroke="${ink}" stroke-width="1.6"/>`;
    }
    h += '</svg>';
    return h;
  };
})(typeof window !== 'undefined' ? window : globalThis);
