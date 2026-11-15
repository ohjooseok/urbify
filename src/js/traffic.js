/* Urbify — 3D 장면의 사람과 차량(움직이는 표시)
 * 차량은 도로 팔(arm)의 차로 중심선을, 사람은 보도 중심선을 따라 다닌다.
 * 교차로는 방향별로 번갈아 여는 신호로 정리하고, 사람은 횡단보도가 있는 곳에서만 길을 건넌다.
 * 분위기를 보여 주는 표시이지 교통 시뮬레이션이 아니다. 용량·지체 계산에는 쓰지 않는다. */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U;
  const N16 = 16; // 인스턴스 하나의 실수 개수

  const CAR_KM = [5, 40];   // 차로 1km당 차량 수(밀도 0 → 1)
  const PED_KM = [6, 110];  // 보도 1km당 사람 수(가로 활기에 따라 가중)
  const MAX_CARS = 420, MAX_PEDS = 900, MAX_PMS = 220;
  const PM_KM = [3, 34];    // 자전거도로 1km당 자전거·킥보드 수
  const BIKE_COL = ['#2f3a4a', '#c8cbd0', '#8e2f2b', '#1f5c8a', '#e8e4da', '#3c6e4f'];
  const KICK_COL = ['#2ec4a6', '#8bc34a', '#f28c28', '#2b2d31'];
  const KIND = {
    sedan: { len: 4.5, wid: 1.8 }, suv: { len: 4.6, wid: 1.86 }, compact: { len: 3.7, wid: 1.66 },
    van: { len: 5.0, wid: 1.9 }, bus: { len: 10.9, wid: 2.5 },
  };
  const BUS_COL = ['#3F69AE', '#4F9A6B'];
  const VAN_COL = ['#F1EFEA', '#E9E6DF', '#C9CCD0', '#F1EFEA'];
  const COAT = ['#2f3238', '#3b4a63', '#b39468', '#5b6048', '#70323c', '#8b8e93', '#d0c6b3', '#4e6a8c', '#1f2124', '#e9e8e4', '#7a5c46', '#3f5d54', '#c98378', '#4e9c86', '#f3f1ec', '#c9c2b4', '#a43a32', '#2d4a3e'];
  const PANTS = ['#26282c', '#3a465c', '#5f574d', '#1c1d20', '#6f7379', '#2f3b4f', '#3e5a82', '#4a6a96', '#b7aa92', '#2a3140'];
  const SKIRT = ['#1f2124', '#3b4a63', '#8a6d58', '#6f7379', '#7d2f3a', '#c7b9a2'];
  const SKIN = ['#f0d2b6', '#e3bd98', '#cfa27c', '#a5714f'];
  const HAIR = ['#1b1918', '#2c211b', '#4a3628', '#6d6d6f', '#1b1918', '#2c211b'];
  const SHOE = ['#f2f1ee', '#1d1e20', '#3b2d24', '#7a7d82', '#f2f1ee', '#1d1e20'];
  const BAG = ['#24262b', '#2f3b4f', '#6b5844', '#7c2f2f', '#3e4b3f', '#bfb39d'];
  const rgb = (h) => U.hexToRgb(h);
  const GLASS = rgb('#232a31'), TYRE = rgb('#1c1c1e'), LAMP = rgb('#f4efe0'), TAIL = rgb('#8f2a25'), ROOFBOX = rgb('#b9bcc0');

  /* ---------- 경로 ---------- */
  function mkPath(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + U.dist(pts[i - 1], pts[i]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  /* 경로 위 거리 s의 점과 방향 → out [x, y, dx, dy]. 범위를 벗어나면 끝 구간을 곧게 이어 쓴다 */
  function at(path, s, out) {
    const pts = path.pts, cum = path.cum, n = pts.length;
    let i = 1;
    if (s >= path.len) i = n - 1; else if (s > 0) { while (i < n - 1 && cum[i] < s) i++; }
    const a = pts[i - 1], b = pts[i];
    const L = cum[i] - cum[i - 1] || 1e-6;
    const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L, u = s - cum[i - 1];
    out[0] = a[0] + dx * u; out[1] = a[1] + dy * u; out[2] = dx; out[3] = dy;
    return out;
  }
  const TMP = [0, 0, 0, 0], TMP2 = [0, 0, 0, 0];
  /* 꺾은선의 앞 s0, 뒤 s1을 잘라낸 나머지 */
  function cutLine(pts, s0, s1) {
    const P = mkPath(pts);
    const a = Math.max(0, s0), b = P.len - Math.max(0, s1);
    if (b - a < 0.4) { // 교차로 사이가 아주 짧은 구간: 가운데 한 점에 가깝게
      const m = U.clamp((a + b) / 2, 0, P.len);
      at(P, m - 0.2, TMP); const p0 = [TMP[0], TMP[1]]; at(P, m + 0.2, TMP);
      return [p0, [TMP[0], TMP[1]]];
    }
    const out = [];
    at(P, a, TMP); out.push([TMP[0], TMP[1]]);
    for (let i = 1; i < pts.length - 1; i++) if (P.cum[i] > a + 0.05 && P.cum[i] < b - 0.05) out.push(pts[i]);
    at(P, b, TMP); out.push([TMP[0], TMP[1]]);
    return out;
  }
  const dirStart = (path) => U.norm(U.sub(path.pts[1], path.pts[0]));
  const dirEnd = (path) => { const k = path.pts.length - 1; return U.norm(U.sub(path.pts[k], path.pts[k - 1])); };

  /* ---------- 신호 ---------- */
  let SG_go = true, SG_left = 99;
  /* 교차점 n에서 grp 방향의 신호. SG_go: 갈 수 있는지, SG_left: 초록이 끝날(또는 켜질) 때까지 남은 초 */
  function sig(n, grp, t) {
    const s = n.sig;
    if (!s) { SG_go = true; SG_left = 99; return; }
    const u = (t + s.off) % s.cyc, a = s.g[0], t0 = a + s.red, b = s.g[1];
    if (grp === 0) { SG_go = u < a; SG_left = SG_go ? a - u : s.cyc - u; }
    else { SG_go = u >= t0 && u < t0 + b; SG_left = SG_go ? t0 + b - u : (u < t0 ? t0 - u : s.cyc - u + t0); }
  }

  function Traffic() {
    this.lanes = []; this.walks = []; this.nodes = new Map(); this.stalls = []; this.entries = []; this.pedEntries = [];
    this.cars = []; this.peds = []; this.pms = []; this.bikes = []; this.bikeAt = new Map();
    this.t = 0; this.ready = false; this.stale = true;
    this.carDen = 0.4; this.pedDen = 0.4; this.pmOn = true; this.pmDen = 0.4;
    this.rnd = U.rng(20261112);
    this.uid = 1;
    this.buf = { box: new Float32Array(N16 * 512), cyl: new Float32Array(N16 * 1024), sph: new Float32Array(N16 * 512), nBox: 0, nCyl: 0, nSph: 0 };
  }
  const Tp = Traffic.prototype;

  /* ---------- 길 그물 만들기 ---------- */
  Tp.build = function (P, D) {
    const prev = this.ready ? { cars: this.cars, peds: this.peds, pms: this.pms } : null;
    const site = P.site;
    const onEdge = (p) => p[0] < 0.6 || p[1] < 0.6 || p[0] > site.w - 0.6 || p[1] > site.h - 0.6;
    const nodes = new Map(), lanes = [], walks = [], stalls = [];
    const rabAt = new Map((D.rabs || []).map((r) => [r.node, r]));
    const node = (id, p) => { let n = nodes.get(id); if (!n) { n = { id, p, ends: [], sig: null, edge: onEdge(p), rab: rabAt.get(id) || null, ring: [] }; nodes.set(id, n); } return n; };
    const armIdx = new Map();
    const rnd = U.rng(977);

    D.arms.forEach((a) => {
      if (!a.pts || a.pts.length < 2 || !(a.len > 0.6)) return;
      const k = a.pts.length - 1, road = a.road, lay = a.lay;
      const ai = armIdx.get(road.id) || 0; armIdx.set(road.id, ai + 1);
      const mkEnd = (end, d, box) => ({ arm: a, end, d, ang: Math.atan2(d[1], d[0]), box: box || 0, lanesOut: [], lanesIn: [], walkL: null, walkR: null, cw: null, grp: 0, node: null });
      const eS = mkEnd('start', U.norm(U.sub(a.pts[1], a.pts[0])), a.trim.start.box);
      const eE = mkEnd('end', U.norm(U.sub(a.pts[k - 1], a.pts[k])), a.trim.end.box);
      eS.node = node(a.startNode, a.pts[0]); eE.node = node(a.endNode, a.pts[k]);
      eS.node.ends.push(eS); eE.node.ends.push(eE);
      // 횡단보도(차도가 있고 교차로에 닿는 끝)
      if (road.crosswalk && lay.hasCar) [eS, eE].forEach((e) => { if (e.box > 0 && a.trim[e.end].cw) e.cw = { end: e, occ: 0, w: Math.abs(lay.curbL - lay.curbR), ok: false, off: rnd() * 28 }; });

      // 차로
      const v0 = (Math.max(12, road.speed || 30) / 3.6) * 0.62;
      const mkLane = (band, off, dir, type, wgt, tag) => {
        let pts = cutLine(U.offsetPolyline(a.pts, off), eS.box, eE.box);
        if (dir < 0) pts = pts.slice().reverse();
        const path = mkPath(pts);
        const from = dir > 0 ? eS : eE, to = dir > 0 ? eE : eS;
        const L = {
          id: lanes.length, key: road.id + '|' + band.seg.id + '|' + ai + '|' + tag, arm: a, band, dir, type, path, len: path.len,
          v0: type === 'shared' ? Math.min(v0, 4.2) : v0, from, to, wgt, roadW: lay.W,
          cars: [], inc: [], out: [], conns: new Map(), stopS: path.len - (to.cw ? 6.6 : 0.8), spawnT: -9,
        };
        from.lanesOut.push(L); to.lanesIn.push(L); lanes.push(L);
      };
      lay.bands.forEach((b) => {
        const t = b.seg.type;
        if (t === 'lane' || t === 'bus') mkLane(b, b.oC, b.seg.dir || 1, t, 1, '');
        else if (t === 'shared' && b.seg.w >= 5) { mkLane(b, b.oC - b.seg.w / 4, 1, 'shared', 0.3, 'a'); mkLane(b, b.oC + b.seg.w / 4, -1, 'shared', 0.3, 'b'); }
        else if (t === 'shared') mkLane(b, b.oC, 1, 'shared', 0.25, 'a');
        else if (t === 'estate') { const o2 = Math.min(1.2, b.seg.w / 4); mkLane(b, b.oC - o2, 1, 'shared', 0.12, 'a'); mkLane(b, b.oC + o2, -1, 'shared', 0.12, 'b'); } // 단지내도로: 천천히 오가는 차
        else if (t === 'parking') { // 노상주차: 6m 구획마다 한 자리
          const line = mkPath(U.offsetPolyline(a.pts, b.oC));
          for (let s = eS.box + 11; s <= line.len - eE.box - 11 + 0.01; s += 6.0) stalls.push({ path: line, s, dir: b.oC > 0 ? -1 : 1, r: rnd(), r2: rnd(), r3: rnd() });
        }
      });

      // 보행선: 보도 가운데. 보행자전용·보행자우선도로는 폭 안에서 양쪽으로 나눔
      const mkWalk = (side) => {
        let best = null;
        lay.bands.forEach((b) => {
          if (b.seg.type !== 'sidewalk') return;
          const onSide = side > 0 ? b.oR >= -1e-6 : b.oL <= 1e-6;
          if (onSide && (!best || b.seg.w > best.seg.w)) best = b;
        });
        let off, hw, mul = 1;
        if (best) { off = best.oC; hw = Math.max(0.12, best.seg.w / 2 - 0.4); }
        else {
          const wide = lay.bands.find((b) => b.seg.type === 'pedestrian' || b.seg.type === 'shared' || b.seg.type === 'estate' || b.seg.type === 'trail');
          if (!wide) return null;
          if (wide.seg.type === 'trail') { off = wide.oC + side * Math.min(0.45, wide.seg.w / 4); hw = 0.15; mul = 0.8; } // 오솔길: 산책하는 사람
          else if (wide.seg.type === 'shared' || wide.seg.type === 'estate') { off = wide.oC + side * Math.max(0.5, wide.seg.w / 2 - 0.8); hw = 0.3; mul = wide.seg.type === 'estate' ? 0.6 : 1.3; }
          else { off = wide.oC + side * wide.seg.w / 4; hw = Math.max(0.2, wide.seg.w / 4 - 0.4); mul = 1.8; }
        }
        const path = mkPath(U.offsetPolyline(a.pts, off));
        const W = { id: walks.length, key: road.id + '|' + side + '|' + ai, arm: a, path, L: path.len, hw, sA: 0, sB: path.len, endA: null, endB: null, x: [], wgt: mul, roadId: road.id };
        walks.push(W);
        return W;
      };
      const wL = mkWalk(1), wR = mkWalk(-1);
      // 교차점에서 바깥을 바라볼 때의 왼쪽·오른쪽
      eS.walkL = wL; eS.walkR = wR; eE.walkL = wR; eE.walkR = wL;
    });

    // 자전거도로(전용도로·전용차로): 개인형 이동장치가 다니는 선. 오른쪽 통행이라 도로 오른쪽 구간은 도로 방향으로, 왼쪽 구간은 반대로 간다
    const bikes = [], bikeAt = new Map();
    D.arms.forEach((a) => {
      if (!a.pts || a.pts.length < 2 || !(a.len > 6)) return;
      const tS = a.trim.start, tE = a.trim.end;
      a.lay.bands.forEach((b) => {
        if (b.seg.type !== 'biketrack' && b.seg.type !== 'bikelane') return;
        const pts = cutLine(U.offsetPolyline(a.pts, b.oC), (tS.box || 0) + 1.5, (tE.box || 0) + 1.5);
        const path = mkPath(pts);
        if (path.len < 4) return;
        const sg = { id: bikes.length, path, w: b.seg.w, two: b.seg.w >= 2.4, dir0: b.oC < 0 ? 1 : -1, nS: a.startNode, nE: a.endNode, arm: a };
        bikes.push(sg);
        [[a.startNode, true], [a.endNode, false]].forEach(([n, st]) => { if (!bikeAt.has(n)) bikeAt.set(n, []); bikeAt.get(n).push({ sg, st }); });
      });
    });
    this.bikes = bikes; this.bikeAt = bikeAt;
    this.bikeLen = bikes.reduce((s, b) => s + b.path.len, 0);
    // 교차점: 신호 묶음, 보행선 잇기
    const endOf = (W, e) => {
      const pts = W.path.pts, k = pts.length - 1;
      return e.end === 'start' ? { p: pts[0], d: U.norm(U.sub(pts[1], pts[0])) } : { p: pts[k], d: U.norm(U.sub(pts[k - 1], pts[k])) };
    };
    const setEnd = (W, e, t, extra) => {
      const start = e.end === 'start';
      const rec = Object.assign({ s: start ? t : W.L - t, link: null, exit: false }, extra || {});
      if (start) { W.endA = rec; W.sA = rec.s; } else { W.endB = rec; W.sB = rec.s; }
      return rec;
    };
    /* 회전교차로: 이웃한 팔의 보행선을 둘레 보도의 호로 잇는다(원 안으로 가로지르지 않음) */
    const ringWalks = (n) => {
      const rb = n.rab, c = rb.c, rw = (rb.R + rb.R2) / 2, m = n.ends.length;
      const meet = (W, e) => { // 노드 쪽 끝에서 원(rw)에 닿는 거리
        const start = e.end === 'start';
        for (let t = 0; t < W.L * 0.6; t += 0.25) { at(W.path, start ? t : W.L - t, TMP); if (Math.hypot(TMP[0] - c[0], TMP[1] - c[1]) >= rw) return t; }
        return Math.min(e.box, W.L * 0.4);
      };
      const ptAt = (W, s) => { at(W.path, s, TMP); return [TMP[0], TMP[1]]; };
      for (let i = 0; i < m; i++) {
        const A = n.ends[i], B = n.ends[(i + 1) % m];
        const WA = A.walkL, WB = B.walkR;
        if (!WA && !WB) continue;
        if (!WA || !WB) { const W = WA || WB, e = WA ? A : B; setEnd(W, e, meet(W, e)); continue; }
        const rA = setEnd(WA, A, meet(WA, A)), rB = setEnd(WB, B, meet(WB, B));
        const pa = ptAt(WA, rA.s), pb = ptAt(WB, rB.s);
        let a0 = Math.atan2(pa[1] - c[1], pa[0] - c[0]), a1 = Math.atan2(pb[1] - c[1], pb[0] - c[0]);
        while (a1 <= a0) a1 += Math.PI * 2;
        if (a1 - a0 > Math.PI * 1.6 && m > 1) continue;
        const k = Math.max(2, Math.ceil(((a1 - a0) * rw) / 1.5)), pts = [pa];
        for (let j = 1; j < k; j++) { const a = a0 + ((a1 - a0) * j) / k; pts.push([c[0] + Math.cos(a) * rw, c[1] + Math.sin(a) * rw]); }
        pts.push(pb);
        const path = mkPath(pts);
        const Wc = { id: walks.length, key: 'rab|' + rb.id + '|' + i, arm: null, path, L: path.len, hw: Math.max(0.3, (rb.R2 - rb.R) / 2 - 0.6), sA: 0, sB: path.len, endA: null, endB: null, x: [], wgt: 0.7, roadId: null };
        Wc.endA = { s: 0, link: { W: WA, s: rA.s, dir: A.end === 'start' ? 1 : -1 }, exit: false };
        Wc.endB = { s: path.len, link: { W: WB, s: rB.s, dir: B.end === 'start' ? 1 : -1 }, exit: false };
        rA.link = { W: Wc, s: 0, dir: 1 };
        rB.link = { W: Wc, s: path.len, dir: -1 };
        walks.push(Wc);
      }
    };
    nodes.forEach((n) => {
      n.ends.sort((p, q) => p.ang - q.ang);
      const m = n.ends.length;
      const armed = n.ends.filter((e) => e.lanesIn.length || e.lanesOut.length);
      if (armed.length >= 3 && !n.rab) { // 회전교차로에는 신호가 없다
        const ref = armed.reduce((p, q) => (q.arm.lay.W > p.arm.lay.W ? q : p));
        let w0 = 0, w1 = 0, in1 = 0;
        n.ends.forEach((e) => {
          e.grp = Math.abs(Math.sin(e.ang - ref.ang)) < 0.7071 ? 0 : 1;
          if (e.grp) { w1 = Math.max(w1, e.arm.lay.W); if (e.lanesIn.length) in1++; } else w0 = Math.max(w0, e.arm.lay.W);
        });
        if (in1 > 0) {
          const g0 = U.clamp(9 + w0 * 0.5, 12, 24), g1 = U.clamp(9 + w1 * 0.5, 12, 24), red = 3.2;
          n.sig = { g: [g0, g1], red, cyc: g0 + g1 + red * 2, off: rnd() * 60 };
        }
      }
      if (n.rab) { ringWalks(n); return; }
      for (let i = 0; i < m; i++) {
        const A = n.ends[i], B = n.ends[(i + 1) % m];
        const WA = A.walkL, WB = B.walkR;
        if (!WA && !WB) continue;
        if (!WA || !WB) { // 한쪽에만 보도가 있음: 교차로 앞에서 끝
          const W = WA || WB, e = WA ? A : B;
          setEnd(W, e, Math.min(e.box, W.L * 0.4), { exit: n.edge && m === 1 });
          continue;
        }
        let tA = 0, tB = 0;
        if (m > 1) {
          const eA = endOf(WA, A), eB = endOf(WB, B);
          const Q = U.lineIntersect(eA.p, eA.d, eB.p, eB.d);
          if (Q && Math.abs(U.cross(eA.d, eB.d)) > 0.05) {
            tA = U.dot(U.sub(Q, eA.p), eA.d); tB = U.dot(U.sub(Q, eB.p), eB.d);
            if (!(tA > -40 && tA < WA.L * 0.6 && tB > -40 && tB < WB.L * 0.6)) { tA = Math.min(A.box, WA.L * 0.4); tB = Math.min(B.box, WB.L * 0.4); }
          }
        }
        const rA = setEnd(WA, A, tA), rB = setEnd(WB, B, tB);
        if (m === 1 && n.edge) { rA.exit = true; rB.exit = true; continue; } // 대상지 밖으로 나가는 끝
        rA.link = { W: WB, s: rB.s, dir: B.end === 'start' ? 1 : -1 };
        rB.link = { W: WA, s: rA.s, dir: A.end === 'start' ? 1 : -1 };
      }
    });
    // 횡단보도: 같은 팔의 양쪽 보행선을 잇는다
    nodes.forEach((n) => n.ends.forEach((e) => {
      if (!e.cw || !e.walkL || !e.walkR) return;
      const t = e.box + 3;
      const sOf = (W) => (e.end === 'start' ? t : W.L - t);
      const W1 = e.walkL, W2 = e.walkR, s1 = sOf(W1), s2 = sOf(W2);
      if (s1 <= W1.sA + 0.5 || s1 >= W1.sB - 0.5 || s2 <= W2.sA + 0.5 || s2 >= W2.sB - 0.5) return;
      W1.x.push({ s: s1, cw: e.cw, W: W2, s2 }); W2.x.push({ s: s2, cw: e.cw, W: W1, s2: s1 });
      e.cw.ok = true;
    }));
    // 가로의 활기: 상업·주상복합·시장에 면한 길에 사람이 더 많다
    const act = new Map();
    const USE_W = { com: 1, mixed: 1, market: 1.3, off: 0.5, pub: 0.5, park: 0.5, plaza: 0.8 };
    (D.lots || []).forEach((lot) => (lot.frontage || []).forEach((f) => {
      if (!f.roadId) return;
      const r = act.get(f.roadId) || [0, 0];
      r[0]++; r[1] += USE_W[lot.use] === undefined ? 0.15 : USE_W[lot.use];
      act.set(f.roadId, r);
    }));
    walks.forEach((W) => { const r = act.get(W.roadId); W.wgt *= 0.6 + (r && r[0] ? (2.2 * r[1]) / r[0] : 0.3); });
    // 공원 산책로
    (D.parkFeat || []).forEach((f, i) => {
      if (f.type !== 'path' || !f.pts || f.pts.length < 2) return;
      const path = mkPath(f.pts);
      if (path.len < 12) return;
      walks.push({ id: walks.length, key: 'park|' + i, arm: null, path, L: path.len, hw: Math.max(0.2, (f.w || 2) / 2 - 0.45), sA: 0.4, sB: path.len - 0.4, endA: null, endB: null, x: [], wgt: 0.55, roadId: null });
    });
    walks.forEach((W) => { if (W.sB - W.sA < 0.5) { const m2 = (W.sA + W.sB) / 2; W.sA = m2 - 0.25; W.sB = m2 + 0.25; } });

    // 차로의 다음 갈 곳
    lanes.forEach((L) => {
      const n = L.to.node, d0 = dirEnd(L.path);
      const add = (M, uturn) => {
        const d1 = dirStart(M.path), c = U.dot(d0, d1), turn = U.cross(d0, d1);
        L.out.push({ M, w: (uturn ? 0.2 : c > 0.75 ? 3.0 : turn < 0 ? 1.3 : 1.0) * (M.type === 'shared' && L.type !== 'shared' ? 0.25 : 1) });
      };
      n.ends.forEach((e) => { if (e !== L.to) e.lanesOut.forEach((M) => add(M, false)); });
      if (!L.out.length && !(n.edge && n.ends.length === 1)) L.to.lanesOut.forEach((M) => add(M, true)); // 막다른 길: 되돌아 나옴
    });

    this.nodes = nodes; this.lanes = lanes; this.walks = walks; this.stalls = stalls; this.rabNodes = null;
    this.entries = lanes.filter((L) => L.from.node.edge && L.from.node.ends.length === 1);
    this.pedEntries = [];
    walks.forEach((W) => {
      if (W.endA && W.endA.exit) this.pedEntries.push({ W, s: W.sA + 0.2, dir: 1 });
      if (W.endB && W.endB.exit) this.pedEntries.push({ W, s: W.sB - 0.2, dir: -1 });
    });
    this.laneLen = lanes.reduce((s, L) => s + L.len * L.wgt, 0);
    this.walkLen = walks.reduce((s, W) => s + Math.max(0, W.sB - W.sA) * W.wgt, 0);

    // 다니던 사람과 차는 같은 길 위에 그대로 둔다(편집할 때마다 흩어지지 않게)
    this.cars = []; this.peds = [];
    if (prev) {
      const lk = new Map(lanes.map((L) => [L.key, L])), wk = new Map(walks.map((W) => [W.key, W]));
      prev.cars.forEach((c) => {
        const L = c.lane && lk.get(c.lane.key);
        if (!L || c.wait) return;
        c.lane = L; c.s = U.clamp(c.s, 0, Math.max(0, L.len - 0.3)); c.conn = null; c.from = null; c.next = this._pick(c, L);
        this.cars.push(c);
      });
      prev.peds.forEach((p) => {
        const W = p.W && wk.get(p.W.key);
        if (!W) return;
        p.W = W; p.s = U.clamp(p.s, W.sA, W.sB); p.mode = 0; p.x = null; p.lat = Math.sign(p.lat || 1) * Math.min(Math.abs(p.lat), W.hw); p.ox = 0; p.oy = 0;
        this.peds.push(p);
      });
    }
    this.pms = [];
    if (prev && prev.pms) prev.pms.forEach((m) => { const sg = m.seg && this.bikes[m.seg.id]; if (!sg || sg.arm.road.id !== m.seg.arm.road.id) return; m.seg = sg; m.s = U.clamp(m.s, 0, sg.path.len); m.conn = null; this.pms.push(m); });
    this.ready = true; this.stale = false;
    this.populate();
  };

  /* ---------- 사람·차량 수 맞추기 ---------- */
  Tp.targets = function () {
    const f = (d, r) => (d <= 0.001 ? 0 : U.lerp(r[0], r[1], Math.pow(d, 1.5)));
    return {
      cars: Math.min(MAX_CARS, Math.round((this.laneLen / 1000) * f(this.carDen, CAR_KM))),
      peds: Math.min(MAX_PEDS, Math.round((this.walkLen / 1000) * f(this.pedDen, PED_KM))),
      pms: this.pmOn ? Math.min(MAX_PMS, Math.round(((this.bikeLen || 0) / 1000) * f(this.pmDen, PM_KM))) : 0,
    };
  };
  Tp.setDensity = function (ped, car) {
    if (ped !== null && ped !== undefined) this.pedDen = U.clamp(ped, 0, 1);
    if (car !== null && car !== undefined) this.carDen = U.clamp(car, 0, 1);
    if (this.ready) this.populate();
  };
  Tp.populate = function () {
    const rnd = this.rnd, tg = this.targets();
    const drop = (arr, n) => { while (arr.length > n) { const i = (rnd() * arr.length) | 0; arr[i] = arr[arr.length - 1]; arr.pop(); } };
    drop(this.cars, tg.cars); drop(this.peds, tg.peds); drop(this.pms, tg.pms);
    // 자전거·킥보드
    if (this.bikes.length && this.bikeLen > 1) {
      let guard = tg.pms * 4;
      while (this.pms.length < tg.pms && guard-- > 0) {
        const sg = this._byWeight(this.bikes, this.bikeLen, (b) => b.path.len);
        if (!sg) continue;
        this.pms.push(this._newPM(sg, rnd() * sg.path.len));
      }
    }
    // 차량
    const lanes = this.lanes;
    if (lanes.length && this.laneLen > 1) {
      lanes.forEach((L) => { L.cars.length = 0; });
      this.cars.forEach((c) => { if (!c.conn && !c.wait && c.lane) c.lane.cars.push(c); });
      let guard = tg.cars * 8;
      while (this.cars.length < tg.cars && guard-- > 0) {
        const L = this._byWeight(lanes, this.laneLen, (M) => M.len * M.wgt);
        if (!L || L.len < 6) continue;
        const c = this._newCar(L);
        const s = c.len / 2 + rnd() * Math.max(0, L.len - c.len);
        if (L.cars.some((o) => Math.abs(o.s - s) < (o.len + c.len) / 2 + 2.5)) continue;
        c.lane = L; c.s = s; c.v = L.v0 * (0.4 + rnd() * 0.5); c.next = this._pick(c, L);
        L.cars.push(c); this.cars.push(c);
      }
    } else this.cars.length = 0;
    // 사람
    const walks = this.walks;
    if (walks.length && this.walkLen > 1) {
      let guard = tg.peds * 4;
      while (this.peds.length < tg.peds && guard-- > 0) {
        const W = this._byWeight(walks, this.walkLen, (M) => Math.max(0, M.sB - M.sA) * M.wgt);
        if (!W) continue;
        const p = this._newPed();
        p.W = W; p.s = W.sA + rnd() * (W.sB - W.sA); p.dir = rnd() < 0.5 ? 1 : -1; p.lat = -p.dir * (0.1 + rnd() * 0.9) * W.hw;
        this.peds.push(p);
      }
    } else this.peds.length = 0;
  };
  Tp.setPM = function (on, den) {
    this.pmOn = !!on; if (den !== null && den !== undefined) this.pmDen = U.clamp(den, 0, 1);
    if (this.ready) this.populate();
  };
  Tp._newPM = function (sg, s) {
    const rnd = this.rnd, kick = rnd() < 0.42;
    const dir = sg.two && rnd() < 0.5 ? -sg.dir0 : sg.dir0;
    const m = {
      type: kick ? 'kick' : 'bike', seg: sg, s, dir, conn: null, cs: 0,
      v0: kick ? 4.6 + rnd() * 1.4 : 3.8 + rnd() * 1.8, v: 3, ph: rnd() * 6.28,
      col: rgb(kick ? KICK_COL[(rnd() * KICK_COL.length) | 0] : BIKE_COL[(rnd() * BIKE_COL.length) | 0]),
      coat: rgb(COAT[(rnd() * COAT.length) | 0]), legs: rgb(PANTS[(rnd() * PANTS.length) | 0]), skin: rgb(SKIN[(rnd() * SKIN.length) | 0]),
      hair: rgb(HAIR[(rnd() * HAIR.length) | 0]), helmet: rnd() < 0.45 ? rgb(['#f2f2ee', '#2b2d31', '#e4572e', '#3d7ea6'][(rnd() * 4) | 0]) : null, h: 1.55 + rnd() * 0.3,
      shoe: rgb(SHOE[(rnd() * SHOE.length) | 0]), sleeve: null,
    };
    m.sleeve = m.coat.map((v) => v * 0.93);
    return m;
  };
  /* 자전거도로 위 위치: 양방향(넓은) 길에서는 진행 방향의 오른쪽 절반으로 */
  Tp._pmPos = function (m, out) {
    if (m.conn) { at(m.conn.path, m.cs, out); return out; }
    const sg = m.seg;
    at(sg.path, m.s, out);
    const dx = out[2], dy = out[3];
    const lat = sg.two ? (m.dir > 0 ? -1 : 1) * sg.w / 4 : 0;
    out[0] += -dy * lat; out[1] += dx * lat;
    out[2] = dx * m.dir; out[3] = dy * m.dir;
    return out;
  };
  Tp._pm = function (m, dt) {
    if (m.conn) {
      m.cs += m.v * dt;
      if (m.cs >= m.conn.len) { const nx = m.conn.next; m.seg = nx.sg; m.dir = nx.dir; m.s = nx.dir > 0 ? 0 : nx.sg.path.len; m.conn = null; }
      m.ph += m.v * dt * 2.1;
      return;
    }
    // 같은 길을 같은 쪽으로 앞서 가는 것에 맞춰 속도를 줄인다
    let gap = 1e9;
    const list = m.seg.pmList;
    if (list) for (let k = 0; k < list.length; k++) { const o = list[k]; if (o === m || o.dir !== m.dir || o.conn) continue; const d = (o.s - m.s) * m.dir; if (d > 0 && d < gap) gap = d; }
    const vt = gap < 2.6 ? 0 : gap < 7 ? m.v0 * (gap - 2.6) / 4.4 : m.v0;
    m.v = vt > m.v ? Math.min(vt, m.v + 1.6 * dt) : Math.max(vt, m.v - 4 * dt);
    m.s += m.dir * m.v * dt;
    m.ph += m.v * dt * 2.1;
    const L = m.seg.path.len;
    if (m.dir > 0 ? m.s < L : m.s > 0) return;
    // 끝에 닿음: 같은 교차점에서 이어지는 다른 자전거도로로(없으면 돌아섬)
    const node = m.dir > 0 ? m.seg.nE : m.seg.nS;
    const cand = (this.bikeAt.get(node) || []).filter((c) => c.sg !== m.seg);
    this._pmPos(m, TMP);
    const a = [TMP[0], TMP[1]], da = [TMP[2], TMP[3]];
    let nx;
    if (cand.length) { const c = cand[(this.rnd() * cand.length) | 0]; nx = { sg: c.sg, dir: c.st ? 1 : -1 }; }
    else nx = { sg: m.seg, dir: -m.dir };
    const m2 = { seg: nx.sg, s: nx.dir > 0 ? 0 : nx.sg.path.len, dir: nx.dir, conn: null };
    this._pmPos(m2, TMP2);
    const b = [TMP2[0], TMP2[1]], db = [TMP2[2], TMP2[3]];
    const k = Math.max(2, U.dist(a, b) * 0.45), pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, u = 1 - t;
      const c1 = [a[0] + da[0] * k, a[1] + da[1] * k], c2 = [b[0] - db[0] * k, b[1] - db[1] * k];
      pts.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
    }
    const path = mkPath(pts);
    m.conn = { path, len: Math.max(0.1, path.len), next: nx }; m.cs = 0;
  };
  Tp._byWeight = function (arr, total, wf) {
    let r = this.rnd() * total;
    for (let i = 0; i < arr.length; i++) { r -= wf(arr[i]); if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  };
  Tp._newCar = function (L) {
    const rnd = this.rnd, r = rnd();
    const type = L.type === 'bus' ? 'bus' : (r < 0.05 && L.roadW >= 15 && L.type === 'lane') ? 'bus' : r < 0.13 ? 'van' : r < 0.4 ? 'suv' : r < 0.52 ? 'compact' : 'sedan';
    const k = KIND[type];
    const pal = type === 'bus' ? BUS_COL : type === 'van' ? VAN_COL : (UDS.Fig && UDS.Fig.CAR_COLORS) || ['#d9dbde', '#3a3d42'];
    return { id: this.uid++, type, len: k.len, wid: k.wid, col: rgb(pal[(rnd() * pal.length) | 0]), lane: null, s: 0, v: 0, vf: 0.82 + rnd() * 0.32, next: null, conn: null, cs: 0, from: null, wait: false, idx: 0, still: 0 };
  };
  Tp._newPed = function () {
    const rnd = this.rnd, kid = rnd() < 0.06;
    const h = kid ? 1.08 + rnd() * 0.3 : 1.52 + rnd() * 0.34;
    const coat = rgb(COAT[(rnd() * COAT.length) | 0]), skin = rgb(SKIN[(rnd() * SKIN.length) | 0]);
    const short = rnd() < 0.3, skirt = !kid && rnd() < 0.16, r = rnd();
    const p = {
      W: null, s: 0, dir: 1, lat: 0, v: (kid ? 0.9 : 1.05) + rnd() * 0.45, h, ph: rnd() * 6.28,
      coat, arm: short ? skin : coat.map((v) => v * 0.93), legs: rgb(PANTS[(rnd() * PANTS.length) | 0]), skin, hair: rgb(HAIR[(rnd() * HAIR.length) | 0]),
      skirt: skirt ? rgb(SKIRT[(rnd() * SKIRT.length) | 0]) : null, shoe: rgb(SHOE[(rnd() * SHOE.length) | 0]), sleeve: coat.map((v) => v * 0.95), legC: null,
      long: !kid && rnd() < 0.3, cap: rnd() < 0.06 ? rgb(['#1f2124', '#e9e8e4', '#3b4a63', '#a43a32'][(rnd() * 4) | 0]) : null,
      bag: kid ? 1 : r < 0.24 ? 1 : r < 0.38 ? 2 : 0, bagc: rgb(BAG[(rnd() * BAG.length) | 0]), sw: 0.9 + rnd() * 0.2,
      mode: 0, x: null, ct: 0, cT: 1, fx: 0, fy: 0, tx: 0, ty: 0, ox: 0, oy: 0, cool: rnd() * 12, waitT: 0, hx: 1, hy: 0, lat2: 0,
    };
    p.legC = p.skirt ? (rnd() < 0.4 ? rgb('#2a2a2e') : skin.map((v) => v * 0.94)) : p.legs; // 치마 아래: 맨다리 또는 검은 스타킹
    return p;
  };
  /* 다음에 들어설 차로 고르기 */
  Tp._pick = function (c, L) {
    const out = L.out;
    if (!out.length) return null;
    let tot = 0;
    for (let i = 0; i < out.length; i++) { const o = out[i]; if (this._fits(c, o.M)) tot += o.w; }
    if (tot <= 0) return out[(this.rnd() * out.length) | 0].M;
    let r = this.rnd() * tot;
    for (let i = 0; i < out.length; i++) { const o = out[i]; if (!this._fits(c, o.M)) continue; r -= o.w; if (r <= 0) return o.M; }
    return out[out.length - 1].M;
  };
  Tp._fits = function (c, M) { return M.type === 'bus' ? c.type === 'bus' : M.type === 'shared' ? c.type !== 'bus' : true; };
  /* 교차로를 지나는 곡선(차로 끝 → 다음 차로 처음) */
  Tp._conn = function (L, M) {
    let cn = L.conns.get(M.id);
    if (cn) return cn;
    if (L.to.node.rab) { cn = this._ringConn(L, M, L.to.node); L.conns.set(M.id, cn); return cn; }
    const a = L.path.pts[L.path.pts.length - 1], b = M.path.pts[0];
    const d0 = dirEnd(L.path), d1 = dirStart(M.path);
    const dist = U.dist(a, b), uturn = L.arm === M.arm;
    const k = uturn ? Math.max(4.5, dist * 0.9) : dist * 0.42;
    const c1 = [a[0] + d0[0] * k, a[1] + d0[1] * k], c2 = [b[0] - d1[0] * k, b[1] - d1[1] * k];
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      pts.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
    }
    const path = mkPath(pts);
    cn = { path, len: Math.max(path.len, 0.05), v0: uturn ? 3 : U.dot(d0, d1) > 0.85 ? Math.min(L.v0, M.v0) : 4.6, to: M };
    L.conns.set(M.id, cn);
    return cn;
  };

  /* 회전교차로를 지나는 길: 진입 차로 끝 → 원(반시계 방향, 우측통행) → 진출 차로 처음.
     2차로형은 짧게 도는(우회전) 차가 바깥 차로, 길게 도는 차가 안쪽 차로를 쓴다 */
  Tp._ringConn = function (L, M, n) {
    const rb = n.rab, c = rb.c;
    const a = L.path.pts[L.path.pts.length - 1], b = M.path.pts[0];
    const d0 = dirEnd(L.path), d1 = dirStart(M.path);
    const angOf = (p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
    let th0 = angOf(a), th1 = angOf(b);
    let sweep = th1 - th0; while (sweep <= 0.25) sweep += Math.PI * 2;
    const inner = rb.lanes === 2 && sweep > Math.PI * 0.75;
    const rr = rb.lanes === 2 ? (inner ? rb.Ri + rb.wc * 0.28 : rb.R - rb.wc * 0.28) : (rb.R + rb.Ri) / 2;
    const da = Math.min(0.42, sweep * 0.22); // 원에 붙고 떨어지는 데 쓰는 각
    const e0 = th0 + da, e1 = th0 + sweep - da;
    const P = (t) => [c[0] + Math.cos(t) * rr, c[1] + Math.sin(t) * rr];
    const T = (t) => [-Math.sin(t), Math.cos(t)]; // 반시계 방향 접선
    const pts = [];
    const bez = (p0, t0, p3, t3, k) => { // 삼차 곡선(양 끝 방향 t0, t3)
      const L2 = U.dist(p0, p3) * 0.45;
      const c1 = [p0[0] + t0[0] * L2, p0[1] + t0[1] * L2], c2 = [p3[0] - t3[0] * L2, p3[1] - t3[1] * L2];
      for (let i = 0; i <= k; i++) { const t = i / k, u = 1 - t; pts.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]]); }
    };
    bez(a, d0, P(e0), T(e0), 8);
    const na = Math.max(2, Math.ceil(((e1 - e0) * rr) / 2));
    for (let i = 1; i < na; i++) pts.push(P(e0 + ((e1 - e0) * i) / na));
    const tail = [];
    { const keep = pts.length; bez(P(e1), T(e1), b, d1, 8); tail.push(...pts.splice(keep)); }
    pts.push(...tail);
    const path = mkPath(pts);
    return { path, len: Math.max(path.len, 0.05), v0: 5.2, to: M, rab: rb, node: n, th0, sweep, rr };
  };

  /* ---------- 한 걸음 ---------- */
  Tp.step = function (dt) {
    if (!this.ready) return;
    this.t += dt;
    const t = this.t, lanes = this.lanes, cars = this.cars, peds = this.peds;
    let i, j;
    for (i = 0; i < lanes.length; i++) { lanes[i].cars.length = 0; lanes[i].inc.length = 0; }
    const rn = this.rabNodes || (this.rabNodes = Array.from(this.nodes.values()).filter((n) => n.rab));
    for (i = 0; i < rn.length; i++) rn[i].ring.length = 0;
    for (i = 0; i < cars.length; i++) { const c = cars[i]; if (c.wait) continue; if (c.conn) { c.conn.to.inc.push(c); if (c.conn.rab) c.conn.node.ring.push(c); } else c.lane.cars.push(c); }
    for (i = 0; i < lanes.length; i++) {
      const a = lanes[i].cars;
      if (a.length > 1) a.sort((p, q) => p.s - q.s);
      for (j = 0; j < a.length; j++) a[j].idx = j;
    }
    for (i = 0; i < cars.length; i++) this._car(cars[i], dt, t);
    for (i = 0; i < peds.length; i++) this._ped(peds[i], dt, t);
    const pms = this.pms;
    if (pms.length) {
      for (i = 0; i < this.bikes.length; i++) this.bikes[i].pmList = null;
      for (i = 0; i < pms.length; i++) { const sg = pms[i].seg; if (!sg.pmList) sg.pmList = []; sg.pmList.push(pms[i]); }
      for (i = 0; i < pms.length; i++) this._pm(pms[i], dt);
    }
  };

  Tp._car = function (c, dt, t) {
    if (c.wait) { this._respawn(c); return; }
    const hl = c.len / 2;
    let gap = 1e9, v0, k, o, po;
    if (c.conn) {
      const cn = c.conn, T = cn.to;
      v0 = cn.v0;
      const own = c.cs - cn.len; // 들어설 차로 기준 위치(음수)
      if (T.cars.length) { o = T.cars[0]; if (o.lane === T && !o.conn) gap = o.s - o.len / 2 - (own + hl); }
      for (k = 0; k < T.inc.length; k++) {
        o = T.inc[k]; if (o === c) continue;
        po = relPos(o, T); if (po !== po) continue;
        if (po > own || (po === own && o.id < c.id)) gap = Math.min(gap, po - o.len / 2 - (own + hl));
      }
      // 들어설 길의 횡단보도에 사람이 있으면 그 앞에서 기다린다
      if (T.from.cw && T.from.cw.occ > 0 && own + hl < -0.2) gap = Math.min(gap, -own - hl - 0.4);
      // 회전교차로 안: 같은 원을 앞서 도는 차를 따라간다
      if (cn.rab) gap = Math.min(gap, this._ringGap(c, cn.node));
    } else {
      const L = c.lane, i = c.idx;
      v0 = L.v0;
      if (i + 1 < L.cars.length) { o = L.cars[i + 1]; if (o.lane === L && !o.conn) gap = o.s - o.len / 2 - (c.s + hl); }
      const dStop = L.stopS - (c.s + hl);
      const T = c.next;
      if (dStop > -1.2) {
        let hold = false;
        const n = L.to.node;
        if (n.sig) { sig(n, L.to.grp, t); if (!SG_go) hold = true; else if (dStop > 1.5 && SG_left < dStop / Math.max(c.v, 2.5) - 0.3) hold = true; }
        if (!hold && L.to.cw && L.to.cw.occ > 0) hold = true;
        // 건너편에 들어설 자리가 없으면 교차로를 막지 않는다
        if (!hold && T && T.cars.length) { o = T.cars[0]; if (o.lane === T && !o.conn && o.s - o.len / 2 < c.len + 2.2 && o.v < 1.2) hold = true; }
        if (hold) gap = Math.min(gap, dStop + 1.6);
      }
      // 회전교차로 진입: 원을 돌아 다가오는 차가 있으면 원 앞 양보선에서 기다린다
      if (T && i + 1 >= L.cars.length && L.to.node.rab) { const dY = L.len - 0.4 - (c.s + hl); if (dY > -1.0 && dY < 30 && this._ringBusy(c, L, L.to.node)) gap = Math.min(gap, dY + 1.2); }
      if (T && i + 1 >= L.cars.length) { // 맨 앞 차: 다음 차로와 그리로 드는 차들을 본다
        const cn = this._conn(L, T), rest = L.len - c.s;
        const own = -rest - cn.len;
        if (T.cars.length) { o = T.cars[0]; if (o.lane === T && !o.conn) gap = Math.min(gap, o.s - o.len / 2 - (own + hl)); }
        for (k = 0; k < T.inc.length; k++) { o = T.inc[k]; po = relPos(o, T); if (po === po && po > own) gap = Math.min(gap, po - o.len / 2 - (own + hl)); }
        if (cn.v0 < v0) v0 = Math.min(v0, Math.sqrt(cn.v0 * cn.v0 + 3.6 * Math.max(0, rest))); // 모퉁이를 돌기 전에 속도를 줄인다
      }
    }
    v0 *= c.vf;
    const vs = gap > 1.6 ? Math.sqrt(5.2 * (gap - 1.6)) : 0;
    const vt = Math.min(v0, vs);
    c.v = vt > c.v ? Math.min(vt, c.v + 1.9 * dt) : Math.max(vt, c.v - 5.5 * dt);
    if (gap < 0.4) c.v = 0;
    // 오래 꼼짝 못 하는 차는 다른 곳에서 다시 나타나게 해 길이 통째로 막히지 않게 한다
    if (c.v < 0.05) { c.still += dt; if (c.still > 75) { c.still = 0; c.wait = true; c.conn = null; c.from = null; return; } } else c.still = 0;
    const ds = c.v * dt;
    if (c.conn) {
      c.cs += ds;
      if (c.cs >= c.conn.len) { const T = c.conn.to; c.from = null; c.lane = T; c.s = c.cs - c.conn.len; c.conn = null; c.next = this._pick(c, T); }
    } else {
      c.s += ds;
      const L = c.lane;
      if (c.s >= L.len) {
        if (!c.next) { c.wait = true; c.v = 0; } // 대상지 밖으로 나감 → 다른 입구에서 다시 들어온다
        else { c.conn = this._conn(L, c.next); c.cs = c.s - L.len; c.from = L; }
      }
    }
  };
  Tp._respawn = function (c) {
    const rnd = this.rnd, E = this.entries;
    let L = null;
    if (E.length) {
      for (let k = 0; k < 4 && !L; k++) {
        const M = E[(rnd() * E.length) | 0];
        if (!this._fits(c, M) || this.t - M.spawnT < 1.4 || M.inc.length) continue;
        if (M.cars.length && M.cars[0].s - M.cars[0].len / 2 < c.len + 5) continue;
        L = M;
      }
      if (!L) return;
      c.s = hlOf(c) + 0.2; c.v = L.v0 * 0.7;
    } else {
      for (let k = 0; k < 6 && !L; k++) {
        const M = this._byWeight(this.lanes, this.laneLen, (q) => q.len * q.wgt);
        if (!M || M.len < 8 || !this._fits(c, M)) continue;
        const s = c.len / 2 + rnd() * (M.len - c.len);
        if (M.cars.some((o) => Math.abs(o.s - s) < (o.len + c.len) / 2 + 4)) continue;
        L = M; c.s = s; c.v = 0;
      }
      if (!L) return;
    }
    L.spawnT = this.t;
    c.lane = L; c.conn = null; c.from = null; c.wait = false; c.next = this._pick(c, L);
  };
  const hlOf = (c) => c.len / 2;
  /* 회전교차로: 차의 원 위 각도(원을 도는 중이 아니면 NaN) */
  Tp._ringAng = function (o, n) {
    if (!o.conn || !o.conn.rab || o.conn.node !== n) return NaN;
    at(o.conn.path, o.cs, TMP2);
    const c = n.rab.c, d = Math.hypot(TMP2[0] - c[0], TMP2[1] - c[1]);
    if (d > n.rab.R + 1.5) return NaN; // 아직 원에 닿기 전이거나 빠져나간 뒤
    return Math.atan2(TMP2[1] - c[1], TMP2[0] - c[0]);
  };
  Tp._ringGap = function (c, n) {
    const me = this._ringAng(c, n);
    if (me !== me) return 1e9;
    const rr = c.conn.rr;
    let g = 1e9;
    for (let k = 0; k < n.ring.length; k++) {
      const o = n.ring[k]; if (o === c) continue;
      const th = this._ringAng(o, n); if (th !== th) continue;
      let dth = th - me; while (dth <= 0) dth += Math.PI * 2; while (dth > Math.PI * 2) dth -= Math.PI * 2;
      if (dth > 1.3 || Math.abs(o.conn.rr - rr) > 2.2) continue;
      g = Math.min(g, dth * rr - (o.len + c.len) / 2);
    }
    return g;
  };
  /* 진입하려는 차 c 앞으로 원을 돌아 다가오는 차가 있는가 */
  Tp._ringBusy = function (c, L, n) {
    const rb = n.rab, p = L.path.pts[L.path.pts.length - 1];
    const th0 = Math.atan2(p[1] - rb.c[1], p[0] - rb.c[0]);
    for (let k = 0; k < n.ring.length; k++) {
      const o = n.ring[k];
      const th = this._ringAng(o, n);
      if (th !== th) { if (o.conn && o.conn.rab && o.conn.node === n && o.cs < 3 && o.conn.th0 !== undefined && Math.abs(Math.atan2(Math.sin(o.conn.th0 - th0), Math.cos(o.conn.th0 - th0))) < 0.5) return true; continue; }
      let dth = th0 - th; while (dth < -0.15) dth += Math.PI * 2; while (dth > Math.PI * 2 - 0.15) dth -= Math.PI * 2;
      if (dth < 1.25) return true; // 위쪽에서 다가오는 중(약 70° 안)이거나 진입 지점을 지나는 중
    }
    return false;
  };
  /* 차 o가 차로 T를 기준으로 어디 있는지(들어오는 중이면 음수). 이번 장면에 이미 다른 곳으로 넘어갔으면 NaN */
  function relPos(o, T) {
    if (o.conn) return o.conn.to === T ? o.cs - o.conn.len : NaN;
    return o.lane === T ? o.s : NaN;
  }

  /* 차의 가는 길 위에서 중심으로부터 d만큼 떨어진 점 → out [x, y] */
  Tp._route = function (c, d, out) {
    if (c.conn) {
      const u = c.cs + d, cn = c.conn;
      if (u < 0 && c.from) return at(c.from.path, c.from.len + u, out);
      if (u > cn.len) return at(cn.to.path, u - cn.len, out);
      return at(cn.path, u, out);
    }
    const L = c.lane, u = c.s + d;
    if (u > L.len && c.next) {
      const cn = this._conn(L, c.next), w = u - L.len;
      return w > cn.len ? at(cn.to.path, w - cn.len, out) : at(cn.path, w, out);
    }
    return at(L.path, u, out);
  };

  Tp._ped = function (p, dt, t) {
    const rnd = this.rnd;
    const kf = Math.exp(-dt * 3.2);
    p.ox *= kf; p.oy *= kf;
    if (p.mode === 0) {
      const W = p.W, s0 = p.s;
      let s1 = s0 + p.dir * p.v * dt;
      p.cool -= dt;
      if (p.cool <= 0 && W.x.length) {
        for (let i = 0; i < W.x.length; i++) {
          const x = W.x[i];
          if ((s0 - x.s) * (s1 - x.s) > 0) continue;
          if (rnd() < 0.34) { p.mode = 1; p.x = x; p.waitT = 0; s1 = x.s; } else p.cool = 3;
          break;
        }
      }
      p.s = s1; p.ph += p.v * dt * 4.5;
      if (p.mode === 0) {
        if (p.dir > 0 && s1 > W.sB) this._pedEnd(p, W.endB);
        else if (p.dir < 0 && s1 < W.sA) this._pedEnd(p, W.endA);
      }
    } else if (p.mode === 1) { // 횡단보도 앞에서 기다림
      const x = p.x, cw = x.cw, n = cw.end.node;
      p.waitT += dt;
      let ok = p.waitT > 0.5;
      if (ok && n.sig) {
        // 그 길의 차량 신호가 빨강으로 바뀐 직후에만 건너기 시작한다(뒤쪽 시간은 회전 차량에게 내준다)
        sig(n, cw.end.grp, t);
        const red = n.sig.cyc - n.sig.g[cw.end.grp];
        ok = !SG_go && SG_left > cw.w / p.v + 2.0 && red - SG_left < Math.max(5, red * 0.4);
      } else if (ok) ok = (t + cw.off) % 28 < 7; // 신호가 없는 곳: 사람이 몰려 차가 못 가는 일이 없게 틈을 둔다
      if (ok) {
        this._pedPos(p, TMP); p.fx = TMP[0]; p.fy = TMP[1];
        const W2 = x.W, lat2 = (rnd() < 0.5 ? 1 : -1) * rnd() * W2.hw;
        at(W2.path, x.s2, TMP2); p.tx = TMP2[0] - TMP2[3] * lat2; p.ty = TMP2[1] + TMP2[2] * lat2; p.lat2 = lat2;
        const d = Math.hypot(p.tx - p.fx, p.ty - p.fy) || 1;
        p.hx = (p.tx - p.fx) / d; p.hy = (p.ty - p.fy) / d;
        p.ct = 0; p.cT = d / p.v; p.mode = 2; cw.occ++; p.ox = 0; p.oy = 0;
      }
    } else { // 건너는 중
      p.ct += dt; p.ph += p.v * dt * 4.5;
      if (p.ct >= p.cT) {
        const x = p.x;
        x.cw.occ = Math.max(0, x.cw.occ - 1);
        p.W = x.W; p.s = x.s2; p.dir = rnd() < 0.5 ? 1 : -1; p.lat = p.lat2; p.mode = 0; p.x = null; p.cool = 22 + rnd() * 20;
      }
    }
  };
  Tp._pedEnd = function (p, end) {
    if (!end) { p.dir = -p.dir; p.lat = -p.lat; p.s = U.clamp(p.s, p.W.sA, p.W.sB); return; } // 산책로 끝: 되돌아감
    if (end.link) {
      this._pedPos(p, TMP);
      const x0 = TMP[0], y0 = TMP[1];
      const W = end.link.W;
      p.W = W; p.s = end.link.s; p.dir = end.link.dir; p.lat = -p.dir * Math.min(Math.abs(p.lat), W.hw);
      this._pedPos(p, TMP);
      p.ox += x0 - TMP[0]; p.oy += y0 - TMP[1]; // 모퉁이에서 튀지 않게 차이를 서서히 줄인다
      const m = Math.hypot(p.ox, p.oy); if (m > 6) { p.ox *= 6 / m; p.oy *= 6 / m; }
      return;
    }
    if (end.exit && this.pedEntries.length > 1) { // 대상지 밖으로 나감 → 다른 끝에서 들어온다
      const e = this.pedEntries[(this.rnd() * this.pedEntries.length) | 0];
      p.W = e.W; p.s = e.s; p.dir = e.dir; p.lat = -p.dir * (0.1 + this.rnd() * 0.9) * e.W.hw; p.ox = 0; p.oy = 0;
      return;
    }
    p.dir = -p.dir; p.lat = -p.lat; p.s = U.clamp(p.s, p.W.sA, p.W.sB);
  };
  /* 사람의 자리와 바라보는 방향 → out [x, y, hx, hy] */
  Tp._pedPos = function (p, out) {
    if (p.mode === 2) {
      const k = U.clamp(p.ct / p.cT, 0, 1);
      out[0] = p.fx + (p.tx - p.fx) * k; out[1] = p.fy + (p.ty - p.fy) * k; out[2] = p.hx; out[3] = p.hy;
      return out;
    }
    at(p.W.path, p.s, out);
    const dx = out[2], dy = out[3];
    out[0] += -dy * p.lat + p.ox; out[1] += dx * p.lat + p.oy;
    out[2] = dx * p.dir; out[3] = dy * p.dir;
    return out;
  };

  /* ---------- 그릴 인스턴스 채우기 ---------- */
  function put(B, key, nKey, x, y0, yp, sx, sy, sz, dx, dy, c, tx, tz, shx, em, axis) {
    let a = B[key];
    const n = B[nKey], o = n * N16;
    if (o + N16 > a.length) { const na = new Float32Array(a.length * 2); na.set(a); a = B[key] = na; }
    a[o] = x; a[o + 1] = y0; a[o + 2] = -yp;
    a[o + 3] = sx; a[o + 4] = sy; a[o + 5] = sz;
    a[o + 6] = dx; a[o + 7] = dy;
    a[o + 8] = c[0]; a[o + 9] = c[1]; a[o + 10] = c[2];
    a[o + 11] = tx; a[o + 12] = tz; a[o + 13] = shx; a[o + 14] = em;
    a[o + 15] = axis;
    B[nKey] = n + 1;
  }
  /* 차 한 대. (x, y): 중심, (dx, dy): 진행 방향. 앞 fx, 오른쪽 fz만큼 떨어진 자리에 부품을 놓는다 */
  function carInst(B, type, x, y, dx, dy, col, len, wid) {
    if (!(dx * dx + dy * dy > 0.5)) { dx = 1; dy = 0; }
    const box = (fx, y0, sx, sy, sz, c, tx, tz, shx, em) => put(B, 'box', 'nBox', x + dx * fx, y0, y + dy * fx, sx, sy, sz, dx, dy, c, tx, tz, shx, em, 0);
    const axle = (fx, r) => put(B, 'cyl', 'nCyl', x + dx * fx, 0, y + dy * fx, r * 2, r * 2, wid + 0.03, dx, dy, TYRE, 1, 1, 0, 0, 1);
    const dark = [col[0] * 0.86, col[1] * 0.86, col[2] * 0.86];
    const rx = dy, ry = -dx; // 오른쪽
    // 앞뒤 등: 좌우에 하나씩. fx: 앞 끝 자리, y0: 높이, h: 등 높이, sp: 좌우 간격(너비 비율), w: 등 너비(너비 비율)
    const lights = (fx, y0, h, sp, w) => {
      for (let sg = -1; sg <= 1; sg += 2) {
        const oz = sg * wid * sp / 2;
        put(B, 'box', 'nBox', x + dx * fx + rx * oz, y0, y + dy * fx + ry * oz, 0.06, h, wid * w, dx, dy, LAMP, 1, 1, 0, 1, 0);
        put(B, 'box', 'nBox', x - dx * fx + rx * oz, y0 + 0.06, y - dy * fx + ry * oz, 0.06, h * 0.9, wid * w, dx, dy, TAIL, 1, 1, 0, 2, 0);
      }
    };
    if (type === 'bus') {
      box(0, 0.34, len, 1.0, wid, col, 1, 1, 0, 0);
      box(0, 1.34, len * 0.985, 0.95, wid + 0.02, GLASS, 1, 1, 0, 3);
      box(0, 2.29, len, 0.5, wid, col, 0.985, 0.97, 0, 0);
      box(-len * 0.12, 2.79, len * 0.3, 0.2, wid * 0.6, ROOFBOX, 0.94, 0.9, 0, 0);
      axle(len * 0.31, 0.48); axle(-len * 0.27, 0.48);
      lights(len / 2 - 0.02, 0.62, 0.18, 0.7, 0.22);
      return;
    }
    if (type === 'van') {
      box(0, 0.3, len, 0.78, wid, col, 0.99, 1, 0, 0);
      box(-len * 0.04, 1.08, len * 0.9, 0.86, wid * 0.98, col, 0.93, 0.95, -0.02, 0);
      box(len * 0.27, 1.12, len * 0.34, 0.6, wid * 0.985, GLASS, 0.78, 0.94, -0.06, 3);
      axle(len * 0.3, 0.33); axle(-len * 0.3, 0.33);
      lights(len / 2 - 0.02, 0.62, 0.15, 0.68, 0.26);
      return;
    }
    const suv = type === 'suv', cmp = type === 'compact';
    const by = suv ? 0.32 : 0.27, bh = suv ? 0.72 : cmp ? 0.62 : 0.6;
    const cl = len * (suv ? 0.62 : cmp ? 0.62 : 0.52), ch = suv ? 0.5 : cmp ? 0.48 : 0.44, cx = -len * (suv ? 0.09 : cmp ? 0.04 : 0.06), tp = suv ? 0.8 : cmp ? 0.72 : 0.66;
    box(0, by, len, bh, wid, col, 0.97, 0.98, 0, 0);
    box(cx, by + bh, cl, ch, wid * 0.9, GLASS, tp, 0.86, -0.03, 3);
    box(cx - cl * 0.03, by + bh + ch, cl * tp, 0.05, wid * 0.9 * 0.86, dark, 0.96, 0.96, 0, 0);
    axle(len * 0.3, 0.32); axle(-len * 0.3, 0.32);
    lights(len / 2 - 0.02, by + bh * 0.55, 0.13, 0.66, 0.3);
  }
  /* ---------- 사람 ----------
     다리는 허벅지·정강이·신발, 팔은 위팔·아래팔·손으로 나눈다. 발 자리는 걸음 위상으로 정하고(디딘 동안은 몸에 대해 고르게 뒤로, 나머지 동안 들려서 앞으로)
     엉덩이 높이는 두 발이 닿는 높이에서 정해진다(걸음마다 자연스럽게 오르내림). 무릎·팔꿈치는 두 마디 IK로 푼다.
     마디 하나는 아래 끝에서 위 끝으로 기울인(밀림 변형) 기둥 하나로 그린다. 멀리 있는(화면에서 작은) 사람은 다섯 부품만 쓴다 */
  const TMPK = [0, 0], FT = [0, 0, 0, 0];
  const STANCE = 0.62; // 걸음 한 주기 가운데 발이 땅에 붙어 있는 몫
  /* 두 마디 IK: 뿌리(hx, hy)에서 끝(ax, ay)까지 L1·L2 두 마디로 이을 때 가운데 마디 자리. bend 1: 앞으로 굽힘(무릎), -1: 아래로(팔꿈치) */
  function joint(hx, hy, ax, ay, L1, L2, bend, out) {
    let ex = ax - hx, ey = ay - hy, d = Math.hypot(ex, ey);
    const dm = (L1 + L2) * 0.999;
    if (d > dm) { ex *= dm / d; ey *= dm / d; d = dm; }
    const a = d < 1e-5 ? 0 : Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
    const b = Math.atan2(ey, ex) + bend * a;
    out[0] = hx + Math.cos(b) * L1; out[1] = hy + Math.sin(b) * L1;
    return out;
  }
  // 걸음 위상 u(0~1)에서 발의 앞뒤 자리(-1~1)와 들린 정도(0~1)
  function footAt(u, out, o) {
    if (u < STANCE) { out[o] = 1 - (2 * u) / STANCE; out[o + 1] = 0; }
    else { const s = (u - STANCE) / (1 - STANCE); out[o] = -Math.cos(Math.PI * s); out[o + 1] = Math.sin(Math.PI * s); }
  }
  function pedInst(B, p, x, y, dx, dy, stand, far) {
    const k = p.h / 1.72;
    const rx = dy, ry = -dx; // 오른쪽
    // 아래 끝(fxB, yB) → 위 끝(fxT, yT)으로 기울인 기둥. fz: 옆으로 떨어진 자리, tx·tz: 위쪽 굵기 비율(앞뒤·옆)
    const seg = (fxB, yB, fxT, yT, fz, sx, sz, c, tx, tz) => put(B, 'cyl', 'nCyl', x + dx * fxB + rx * fz, yB, y + dy * fxB + ry * fz, sx, Math.max(0.01, yT - yB), sz, dx, dy, c, tx, tz === undefined ? tx : tz, (fxT - fxB) / sx, 0, 0);
    const blob = (fx, fz, y0, sx, sy, sz, c) => put(B, 'sph', 'nSph', x + dx * fx + rx * fz, y0, y + dy * fx + ry * fz, sx, sy, sz, dx, dy, c, 1, 1, 0, 0, 0);
    const box = (fx, fz, y0, sx, sy, sz, c, shx) => put(B, 'box', 'nBox', x + dx * fx + rx * fz, y0, y + dy * fx + ry * fz, sx, sy, sz, dx, dy, c, 1, 1, shx || 0, 0, 0);
    const L1 = 0.445 * k, L2 = 0.425 * k, ank = 0.075 * k, R = 0.985 * (L1 + L2);
    const u = stand ? 0 : (((p.ph / 6.2832) % 1) + 1) % 1;
    if (stand) { FT[0] = 0.03 * k; FT[1] = 0; FT[2] = -0.03 * k; FT[3] = 0; }
    else {
      const A = 0.3 * k * p.sw;
      footAt(u, FT, 0); footAt((u + 0.5) % 1, FT, 2);
      FT[0] *= A; FT[2] *= A; FT[1] *= 0.11 * k; FT[3] *= 0.11 * k;
    }
    const hipY = Math.min(ank + FT[1] + Math.sqrt(Math.max(0, R * R - FT[0] * FT[0])), ank + FT[3] + Math.sqrt(Math.max(0, R * R - FT[2] * FT[2])));
    const shY = hipY + 0.51 * k;
    if (far) { // 멀리 있는 사람: 다리 둘·몸통·머리·머리카락
      for (let i = 0; i < 2; i++) seg(FT[i * 2], FT[i * 2 + 1], 0, hipY, (i ? -1 : 1) * 0.085 * k, 0.13 * k, 0.13 * k, p.legC, 1.25);
      seg(0, hipY - 0.06 * k, 0.012 * k, shY + 0.03 * k, 0, 0.23 * k, 0.36 * k, p.coat, 1.0, 1.12);
      blob(0.022 * k, 0, shY + 0.06 * k, 0.2 * k, 0.24 * k, 0.17 * k, p.skin);
      blob(-0.008 * k, 0, shY + 0.15 * k, 0.215 * k, 0.17 * k, 0.185 * k, p.cap || p.hair);
      return;
    }
    for (let i = 0; i < 2; i++) {
      const sgn = i ? -1 : 1, f = FT[i * 2], l = FT[i * 2 + 1], fz = sgn * 0.085 * k, aY = ank + l;
      joint(0, hipY, f, aY, L1, L2, 1, TMPK);
      const kx = TMPK[0], ky = TMPK[1];
      seg(kx, ky, 0, hipY, fz, 0.15 * k, 0.15 * k, p.legC, 1.12);               // 허벅지
      seg(f, aY - 0.03 * k, kx, ky, fz, 0.105 * k, 0.105 * k, p.legC, 1.3);     // 정강이(위가 굵다)
      box(f + 0.06 * k, fz, l, 0.27 * k, 0.085 * k, 0.105 * k, p.shoe);         // 신발
      // 팔: 같은 쪽 다리와 반대로 흔들고, 앞으로 갈 때 팔꿈치를 더 굽힌다
      const ua = i ? (u + 0.5) % 1 : u;
      const a1 = stand ? 0.04 : -0.36 * p.sw * Math.cos(6.2832 * ua), a2 = a1 + 0.16 + Math.max(0, a1) * 0.7;
      const ex = Math.sin(a1) * 0.3 * k, ey = shY - Math.cos(a1) * 0.3 * k;
      const wx = ex + Math.sin(a2) * 0.26 * k, wy = ey - Math.cos(a2) * 0.26 * k, az = sgn * 0.215 * k;
      seg(ex, ey, 0, shY, az, 0.1 * k, 0.1 * k, p.sleeve, 1.1);                // 위팔
      seg(wx, wy, ex, ey, az, 0.08 * k, 0.08 * k, p.arm, 1.15);                 // 아래팔
      const hl = 0.13 * k, hs = Math.sin(a2) * hl, hc = Math.cos(a2) * hl;
      box(wx + hs, az, wy - hc, 0.085 * k, hc, 0.04 * k, p.skin, -hs / (0.085 * k)); // 손
    }
    if (p.skirt) seg(0, hipY - 0.37 * k, 0, hipY + 0.08 * k, 0, 0.34 * k, 0.44 * k, p.skirt, 0.68, 0.78); // 치마
    else seg(0, hipY - 0.08 * k, 0, hipY + 0.08 * k, 0, 0.23 * k, 0.35 * k, p.legs, 1.0);             // 골반
    seg(0, hipY + 0.06 * k, 0.012 * k, shY + 0.03 * k, 0, 0.215 * k, 0.33 * k, p.coat, 1.05, 1.13);    // 몸통(가슴·어깨 쪽이 넓다)
    seg(0.015 * k, shY, 0.022 * k, shY + 0.1 * k, 0, 0.085 * k, 0.09 * k, p.skin, 1.0);              // 목
    blob(0.022 * k, 0, shY + 0.065 * k, 0.2 * k, 0.235 * k, 0.165 * k, p.skin);                       // 머리
    if (p.cap) { blob(0.0, 0, shY + 0.205 * k, 0.21 * k, 0.12 * k, 0.185 * k, p.cap); box(0.13 * k, 0, shY + 0.235 * k, 0.12 * k, 0.018 * k, 0.15 * k, p.cap); } // 모자와 챙
    else blob(-0.008 * k, 0, shY + 0.15 * k, 0.215 * k, 0.17 * k, 0.18 * k, p.hair);               // 머리카락
    if (p.long) seg(-0.07 * k, shY - 0.1 * k, -0.055 * k, shY + 0.2 * k, 0, 0.1 * k, 0.17 * k, p.hair, 1.0); // 긴 머리
    if (p.bag === 1) box(-0.165 * k, 0, hipY + 0.1 * k, 0.13 * k, 0.4 * k, 0.29 * k, p.bagc);              // 배낭
    else if (p.bag === 2) box(0.01 * k, -0.27 * k, hipY - 0.07 * k, 0.24 * k, 0.21 * k, 0.065 * k, p.bagc);   // 어깨에 멘 가방
  }
  function bikeInst(B, m, x, y, dx, dy) {
    const rx = dy, ry = -dx, k = m.h / 1.72;
    const at2 = (fx, fz) => [x + dx * fx + rx * fz, y + dy * fx + ry * fz];
    const box = (fx, fz, y0, sx, sy, sz, c, shx) => { const p = at2(fx, fz); put(B, 'box', 'nBox', p[0], y0, p[1], sx, sy, sz, dx, dy, c, 1, 1, shx || 0, 0, 0); };
    const cyl = (fx, fz, y0, sx, sy, sz, c, shx) => { const p = at2(fx, fz); put(B, 'cyl', 'nCyl', p[0], y0, p[1], sx, sy, sz, dx, dy, c, 1, 1, shx || 0, 0, 0); };
    const wheel = (fx, d) => { const p = at2(fx, 0); put(B, 'cyl', 'nCyl', p[0], 0, p[1], d, d, 0.05, dx, dy, TYRE, 1, 1, 0, 0, 1); };
    const blob = (fx, y0, sx, sy, sz, c) => { const p = at2(fx, 0); put(B, 'sph', 'nSph', p[0], y0, p[1], sx, sy, sz, dx, dy, c, 1, 1, 0, 0, 0); };
    const seg = (fxB, yB, fxT, yT, fz, sx, sz, c, tx, tz) => { const p = at2(fxB, fz); put(B, 'cyl', 'nCyl', p[0], yB, p[1], sx, Math.max(0.01, yT - yB), sz, dx, dy, c, tx, tz === undefined ? tx : tz, (fxT - fxB) / sx, 0, 0); };
    const L1 = 0.445 * k, L2 = 0.425 * k;
    // 다리: 엉덩이(hx, hy) → 발목(ax, ay), 신발은 (sx0, sy0)에
    const leg = (hx, hy, ax, ay, fz, sx0, sy0) => {
      joint(hx, hy, ax, ay, L1, L2, 1, TMPK);
      const kx = TMPK[0], ky = TMPK[1];
      seg(kx, ky, hx, hy, fz, 0.15 * k, 0.15 * k, m.legs, 1.12);
      seg(ax, ay - 0.03 * k, kx, ky, fz, 0.105 * k, 0.105 * k, m.legs, 1.3);
      box(sx0, fz, sy0, 0.26 * k, 0.08 * k, 0.1 * k, m.shoe, 0);
    };
    // 팔: 어깨에서 손잡이까지 팔꿈치를 아래로 굽혀 잇는다
    const arms = (sF, sY, gx, gy) => {
      for (let sg = -1; sg <= 1; sg += 2) {
        const az = sg * 0.2 * k, gz = sg * 0.21;
        joint(sF, sY, gx, gy, 0.3 * k, 0.29 * k, -1, TMPK);
        const ex = TMPK[0], ey = TMPK[1];
        seg(ex, ey, sF, sY, (az + gz) / 2, 0.1 * k, 0.1 * k, m.coat, 1.1);
        seg(gx, gy, ex, ey, gz, 0.08 * k, 0.08 * k, m.sleeve, 1.15);
        box(gx, gz, gy - 0.035, 0.09 * k, 0.07 * k, 0.05 * k, m.skin, 0);
      }
    };
    const head = (sF, sY, lean) => {
      seg(sF + 0.01 * k, sY, sF + lean * 0.5, sY + 0.1 * k, 0, 0.085 * k, 0.09 * k, m.skin, 1.0);
      blob(sF + lean, sY + 0.065 * k, 0.2 * k, 0.235 * k, 0.165 * k, m.skin);
      if (m.helmet) blob(sF + lean - 0.015 * k, sY + 0.17 * k, 0.25 * k, 0.17 * k, 0.21 * k, m.helmet);
      else blob(sF + lean - 0.03 * k, sY + 0.15 * k, 0.215 * k, 0.17 * k, 0.18 * k, m.hair);
    };
    const F = m.col, dk = [0.16, 0.16, 0.17];
    if (m.type === 'bike') {
      wheel(0.52, 0.66); wheel(-0.52, 0.66);
      box(0, 0, 0.32, 0.04, 0.38, 0.04, F, 0.45 / 0.04);                   // 아래 관(크랭크 → 앞)
      box(0.115, 0, 0.73, 0.67, 0.035, 0.04, F, 0);                         // 윗관
      box(0, 0, 0.32, 0.04, 0.5, 0.04, F, -0.22 / 0.04);                   // 안장 기둥
      box(-0.26, 0, 0.31, 0.52, 0.03, 0.04, F, 0);                          // 뒤 체인 받침
      box(0.52, 0, 0.33, 0.03, 0.7, 0.035, dk, -0.06 / 0.03);              // 앞 포크·핸들 기둥
      box(0.44, 0, 1.02, 0.05, 0.03, 0.5, dk, 0);                           // 핸들
      box(-0.24, 0, 0.82, 0.24, 0.05, 0.12, dk, 0);                         // 안장
      const hipF = -0.22, hipY = 0.9 * k + 0.02, shF = hipF + 0.33 * k, shY = hipY + 0.47 * k;
      for (let sg = -1; sg <= 1; sg += 2) { // 페달을 밟는 다리: 엉덩이에서 페달까지 무릎을 굽혀 잇는다
        const a = m.ph + (sg > 0 ? 0 : Math.PI), px = Math.cos(a) * 0.17, py = 0.3 + Math.sin(a) * 0.17, fz = sg * 0.1;
        leg(hipF, hipY, px - 0.05, py + 0.07, fz, px + 0.02, py - 0.035);
      }
      seg(hipF, hipY - 0.05 * k, shF, shY + 0.03 * k, 0, 0.23 * k, 0.34 * k, m.coat, 1.05, 1.12);     // 앞으로 숙인 몸통
      arms(shF, shY, 0.42, 1.04);
      head(shF, shY, 0.08 * k);
    } else {
      wheel(0.4, 0.2); wheel(-0.4, 0.2);
      box(0, 0, 0.1, 0.9, 0.05, 0.16, dk, 0);                               // 발판
      box(0.42, 0, 0.12, 0.04, 0.95, 0.04, F, -0.07 / 0.04);               // 기둥
      box(0.35, 0, 1.06, 0.05, 0.035, 0.46, dk, 0);                         // 핸들
      box(0.05, 0, 0.12, 0.6, 0.02, 0.17, F, 0);                            // 발판 덮개(색)
      const base = 0.15, hipF = -0.04, hipY = base + 0.9 * k, shF = hipF + 0.06 * k, shY = hipY + 0.51 * k;
      leg(hipF, hipY, 0.1, base + 0.075 * k, 0.08, 0.15, base);            // 앞발
      leg(hipF, hipY, -0.2, base + 0.075 * k, -0.08, -0.15, base);         // 뒷발
      seg(hipF, hipY - 0.06 * k, shF, shY + 0.03 * k, 0, 0.215 * k, 0.33 * k, m.coat, 1.05, 1.13);
      arms(shF, shY, 0.33, 1.08);
      head(shF, shY, 0.03 * k);
    }
  }
  /* eye: 눈 자리(3D 좌표), pxk: 1m가 거리 1m에서 화면에 차지하는 픽셀 수. 화면에서 작게 보이는 사람은 간단히 그린다 */
  Tp.fill = function (eye, pxk) {
    const B = this.buf;
    B.nBox = 0; B.nCyl = 0; B.nSph = 0;
    if (!this.ready) return B;
    const cars = this.cars, peds = this.peds;
    let i;
    for (i = 0; i < cars.length; i++) {
      const c = cars[i]; if (c.wait) continue;
      const wb = c.len * 0.3;
      this._route(c, wb, TMP); const fx = TMP[0], fy = TMP[1];
      this._route(c, -wb, TMP2);
      let dx = fx - TMP2[0], dy = fy - TMP2[1];
      const m = Math.hypot(dx, dy);
      if (m < 1e-4) { this._route(c, 0, TMP); dx = TMP[2]; dy = TMP[3]; } else { dx /= m; dy /= m; }
      carInst(B, c.type, (fx + TMP2[0]) / 2, (fy + TMP2[1]) / 2, dx, dy, c.col, c.len, c.wid);
    }
    // 노상주차: 차량 밀도가 높을수록 빈자리가 적다
    const occ = this.carDen <= 0.001 ? 0 : 0.3 + 0.55 * this.carDen;
    const pal = (UDS.Fig && UDS.Fig.CAR_COLORS) || ['#d9dbde'];
    for (i = 0; i < this.stalls.length; i++) {
      const s = this.stalls[i]; if (s.r >= occ) continue;
      at(s.path, s.s, TMP);
      if (!s.col) s.col = rgb(pal[(s.r2 * pal.length) | 0]);
      const type = s.r3 < 0.3 ? 'suv' : s.r3 < 0.45 ? 'compact' : 'sedan', kd = KIND[type];
      carInst(B, type, TMP[0], TMP[1], TMP[2] * s.dir, TMP[3] * s.dir, s.col, kd.len, kd.wid);
    }
    for (i = 0; i < peds.length; i++) {
      const p = peds[i];
      this._pedPos(p, TMP);
      let hx = TMP[2], hy = TMP[3];
      if (p.mode === 1) { // 건널 쪽을 바라보고 선다
        at(p.x.W.path, p.x.s2, TMP2);
        const ex = TMP2[0] - TMP[0], ey = TMP2[1] - TMP[1], m = Math.hypot(ex, ey) || 1;
        hx = ex / m; hy = ey / m;
      }
      let far = false;
      if (eye && pxk) { const ex = TMP[0] - eye[0], ey = eye[1] - 1, ez = -TMP[1] - eye[2]; far = p.h * pxk < 30 * Math.sqrt(ex * ex + ey * ey + ez * ez); }
      pedInst(B, p, TMP[0], TMP[1], hx, hy, p.mode === 1, far);
    }
    for (i = 0; i < this.pms.length; i++) { const m = this.pms[i]; this._pmPos(m, TMP); bikeInst(B, m, TMP[0], TMP[1], TMP[2], TMP[3]); }
    return B;
  };
  Tp.counts = function () { return { cars: this.cars.length, peds: this.peds.length, pms: this.pms.length }; };

  UDS.Traffic = Traffic;
})(typeof window !== 'undefined' ? window : globalThis);
