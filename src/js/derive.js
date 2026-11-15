/* Urbify — 위계 연동 형상 계산
 * 도로망(중심선+단면) → 교차점·가구(가구=도로로 둘러싸인 면) → 획지 → 건축물,
 * 그리고 교차로 연석·횡단보도·가로수·전주·지하시설·지표·법규검토 */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C;
  const Dv = (UDS.Derive = {});

  Dv.roadWidth = (r) => r.segs.reduce((s, g) => s + g.w, 0);
  Dv.treeKey = (x, y) => 't' + Math.round(x * 2) + '_' + Math.round(y * 2); // 만들어진 수목의 이름(0.5m 자리)

  /* 단면 배치: 왼쪽 경계(+W/2)에서 오른쪽(-W/2)으로 */
  Dv.layout = function (r) {
    const W = Dv.roadWidth(r);
    let o = W / 2;
    const bands = [];
    r.segs.forEach((g, i) => {
      const oL = o, oR = o - g.w;
      bands.push({ seg: g, i, oL, oR, oC: (oL + oR) / 2, def: C.SEG[g.type] || C.SEG.sidewalk });
      o = oR;
    });
    const car = bands.filter((b) => b.def.carriage);
    return {
      W, bands,
      hasCar: car.length > 0,
      curbL: car.length ? car[0].oL : null,
      curbR: car.length ? car[car.length - 1].oR : null,
    };
  };

  /* 대상지 경계를 따라 놓인 도로가 모서리에서 끝나면, 경계 밖으로 조금 이어 그려 모서리 교차로가 반쪽으로 끊겨 보이지 않게 한다
     (계획 자료는 그대로 두고 형상 계산에만 쓰는 점열) */
  function cornerPts(P) {
    const W = P.site.w, H = P.site.h, E = 26, map = new Map();
    const corners = [[0, 0], [W, 0], [W, H], [0, H]];
    const along = (a, b) => (Math.abs(a[1] - b[1]) < 0.3 && (Math.abs(a[1]) < 0.3 || Math.abs(a[1] - H) < 0.3)) || (Math.abs(a[0] - b[0]) < 0.3 && (Math.abs(a[0]) < 0.3 || Math.abs(a[0] - W) < 0.3));
    P.roads.forEach((r) => {
      const pts = r.pts, n = pts.length;
      if (n < 2) return;
      const atC = (p) => corners.some((c) => Math.abs(p[0] - c[0]) < 0.5 && Math.abs(p[1] - c[1]) < 0.5);
      let out = null;
      if (atC(pts[0]) && along(pts[0], pts[1])) { const d = U.norm(U.sub(pts[0], pts[1])); out = [U.add(pts[0], U.mul(d, E))].concat(pts); }
      if (atC(pts[n - 1]) && along(pts[n - 1], pts[n - 2])) { const d = U.norm(U.sub(pts[n - 1], pts[n - 2])); out = (out || pts.slice()).concat([U.add(pts[n - 1], U.mul(d, E))]); }
      if (out) map.set(r.id, out);
    });
    return (r) => map.get(r.id) || r.pts;
  }
  /* ---------- 평면 그래프 ---------- */
  function buildGraph(P, ptsOf) {
    const W = P.site.w, H = P.site.h;
    const raw = [];
    P.roads.forEach((r) => { const pts = ptsOf(r); for (let i = 0; i + 1 < pts.length; i++) raw.push({ a: pts[i], b: pts[i + 1], road: r, k: i }); });
    const B = [[0, 0], [W, 0], [W, H], [0, H]];
    for (let i = 0; i < 4; i++) raw.push({ a: B[i], b: B[(i + 1) % 4], road: null, k: i });
    const TOL = 0.3;
    const cuts = raw.map(() => [0, 1]);
    for (let i = 0; i < raw.length; i++) {
      for (let j = i + 1; j < raw.length; j++) {
        const s1 = raw[i], s2 = raw[j];
        const X = U.segIntersect(s1.a, s1.b, s2.a, s2.b, 1e-7);
        if (X) { cuts[i].push(X.t); cuts[j].push(X.u); }
        [s2.a, s2.b].forEach((p) => { const r = U.distPointSeg(p, s1.a, s1.b); if (r.d < TOL) cuts[i].push(r.t); });
        [s1.a, s1.b].forEach((p) => { const r = U.distPointSeg(p, s2.a, s2.b); if (r.d < TOL) cuts[j].push(r.t); });
      }
    }
    const nodes = [];
    const findNode = (p) => {
      for (const n of nodes) if (Math.abs(n.p[0] - p[0]) < TOL && Math.abs(n.p[1] - p[1]) < TOL) return n;
      const n = { id: nodes.length, p: [p[0], p[1]] };
      nodes.push(n);
      return n;
    };
    // 도로 끝점 우선 등록
    P.roads.forEach((r) => ptsOf(r).forEach((p) => findNode(p)));
    const edgeMap = new Map();
    const addEdge = (n1, n2, s) => {
      // 단지 안 길은 같은 두 점을 잇는 다른 변(대상지 경계·도로)과 따로 둔다(가구를 만들 때는 빼고, 도로 팔에는 넣는다)
      const key = (n1.id < n2.id ? n1.id + '_' + n2.id : n2.id + '_' + n1.id) + (s.road && s.road.inner ? 'i' : '');
      const ex = edgeMap.get(key);
      const e = { u: n1.id, v: n2.id, road: s.road, k: s.k };
      if (!ex) edgeMap.set(key, e);
      else if (!ex.road && s.road) edgeMap.set(key, e);
      else if (ex.road && s.road && Dv.roadWidth(s.road) > Dv.roadWidth(ex.road)) edgeMap.set(key, e);
    };
    raw.forEach((s, i) => {
      const ts = Array.from(new Set(cuts[i].map((t) => Math.round(U.clamp(t, 0, 1) * 1e6) / 1e6))).sort((a, b) => a - b);
      let prev = null;
      ts.forEach((t) => {
        const p = [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
        const n = findNode(p);
        if (prev && prev !== n) addEdge(prev, n, s);
        prev = n;
      });
    });
    return { nodes, edges: Array.from(edgeMap.values()) };
  }

  function extractFaces(nodes, edges) {
    let alive = edges.slice();
    for (let guard = 0; guard < 1000; guard++) {
      const deg = new Map();
      alive.forEach((e) => { deg.set(e.u, (deg.get(e.u) || 0) + 1); deg.set(e.v, (deg.get(e.v) || 0) + 1); });
      const next = alive.filter((e) => deg.get(e.u) > 1 && deg.get(e.v) > 1);
      if (next.length === alive.length) break;
      alive = next;
    }
    const out = new Map();
    const push = (n, h) => { if (!out.has(n)) out.set(n, []); out.get(n).push(h); };
    alive.forEach((e) => {
      const pu = nodes[e.u].p, pv = nodes[e.v].p;
      push(e.u, { from: e.u, to: e.v, e, ang: Math.atan2(pv[1] - pu[1], pv[0] - pu[0]) });
      push(e.v, { from: e.v, to: e.u, e, ang: Math.atan2(pu[1] - pv[1], pu[0] - pv[0]) });
    });
    out.forEach((l) => l.sort((a, b) => a.ang - b.ang));
    const visited = new Set();
    const faces = [];
    out.forEach((list) => list.forEach((he) => {
      if (visited.has(he.from + '>' + he.to)) return;
      const loop = [];
      let cur = he;
      for (let g = 0; g < 5000; g++) {
        const k = cur.from + '>' + cur.to;
        if (visited.has(k)) break;
        visited.add(k);
        loop.push(cur);
        const lst = out.get(cur.to);
        const idx = lst.findIndex((h) => h.to === cur.from && h.e === cur.e);
        cur = lst[(idx - 1 + lst.length) % lst.length];
      }
      const pts = loop.map((h) => nodes[h.from].p);
      const area = U.polyArea(pts);
      if (area > 1) faces.push({ hes: loop, pts, area });
    }));
    return { faces, alive };
  }

  /* ---------- 도로 팔(arm): 교차점 사이 도로 구간 ---------- */
  function buildArms(P, graph, ptsOf) {
    const { nodes, edges } = graph;
    const roadEdges = new Map();
    edges.forEach((e) => { if (e.road) { if (!roadEdges.has(e.road.id)) roadEdges.set(e.road.id, []); roadEdges.get(e.road.id).push(e); } });
    // 노드별 도로 목록
    const nodeRoads = new Map();
    edges.forEach((e) => {
      if (!e.road) return;
      [e.u, e.v].forEach((n) => { if (!nodeRoads.has(n)) nodeRoads.set(n, new Set()); nodeRoads.get(n).add(e.road.id); });
    });
    // 회전교차로를 둔 꼭짓점에서도 팔을 나눈다(도로 중간에 둔 회전교차로)
    const rabNode = new Set();
    // (곡선으로 그린 단지 안 길은 꼭짓점이 촘촘해 모양을 고치면 자리가 조금 비켜나므로 2.5m 안의 가장 가까운 꼭짓점)
    (P.rabouts || []).forEach((sp) => {
      if (!sp || !sp.p) return;
      let n = null, bd = 2.5;
      nodes.forEach((q) => { const d = U.dist(q.p, sp.p); if (d < bd) { bd = d; n = q; } });
      if (n) rabNode.add(n.id);
    });
    const arms = [];
    P.roads.forEach((r) => {
      const es = roadEdges.get(r.id) || [];
      if (!es.length) return;
      // 도로 진행 순서로 정렬: (세그먼트 번호, 시작점까지의 거리)
      const rp = ptsOf(r);
      const key = (e) => e.k * 1e6 + U.dist(rp[e.k], nodes[e.u].p);
      es.sort((a, b) => key(a) - key(b));
      let cur = null;
      es.forEach((e) => {
        if (!cur || cur.endNode !== e.u) {
          if (cur) arms.push(cur);
          cur = { road: r, nodes: [e.u, e.v], startNode: e.u, endNode: e.v };
        } else {
          cur.nodes.push(e.v);
          cur.endNode = e.v;
        }
        const split = (nodeRoads.get(e.v) || new Set()).size > 1 || rabNode.has(e.v);
        if (split) { arms.push(cur); cur = null; }
      });
      if (cur) arms.push(cur);
    });
    // 같은 도로에서 교차점을 사이에 두고 이어지는 앞뒤 팔을 서로 알게 해 둔다(꺾인 곳도 끊김 없이 잇고, 교차점 판단에서 한 길로 다룸)
    const byRoad = new Map();
    arms.forEach((a) => { if (!byRoad.has(a.road.id)) byRoad.set(a.road.id, []); byRoad.get(a.road.id).push(a); });
    byRoad.forEach((list) => { for (let i = 0; i + 1 < list.length; i++) if (list[i].endNode === list[i + 1].startNode) { list[i].next = list[i + 1]; list[i + 1].prev = list[i]; } });
    arms.forEach((a, i) => {
      a.id = i;
      a.pts = a.nodes.map((n) => nodes[n].p);
      a.lay = Dv.layout(a.road);
      a.len = U.polylineLength(a.pts);
      a.trim = { start: { L: null, R: null, box: 0, curbL: 0, curbR: 0 }, end: { L: null, R: null, box: 0, curbL: 0, curbR: 0 } };
    });
    return arms;
  }

  /* 교차점 모서리: 연석 모깎기, 비차도 구간 절단선, 교차 박스 */
  function computeCorners(graph, arms, rabSpecs, site) {
    const { nodes } = graph;
    const at = new Map();
    arms.forEach((a) => {
      if (a.pts.length < 2) return;
      const dS = U.norm(U.sub(a.pts[1], a.pts[0]));
      const k = a.pts.length - 1;
      const dE = U.norm(U.sub(a.pts[k - 1], a.pts[k]));
      const add = (n, o) => { if (!at.has(n)) at.set(n, []); at.get(n).push(o); };
      add(a.startNode, { arm: a, end: 'start', d: dS, sgn: 1 });
      add(a.endNode, { arm: a, end: 'end', d: dE, sgn: -1 });
    });
    const fillets = [];
    const nodeInfo = [];
    // 같은 도로의 앞뒤 팔이 이 점에서 이어지는가(꺾여 있어도 한 길)
    const joined = (o, q) => o.arm.road === q.arm.road && ((o.end === 'end' && q.end === 'start' && o.arm.next === q.arm) || (o.end === 'start' && q.end === 'end' && o.arm.prev === q.arm));
    /* 회전교차로를 둘 수 있는 교차점: 셋 이상이 만나거나 서로 다른 두 길이 끝과 끝으로 만나고, 차도가 있는 길이 둘 이상 */
    const inSite = (p) => !site || (p[0] > 1 && p[1] > 1 && p[0] < site.w - 1 && p[1] < site.h - 1); // 대상지 경계 위의 교차점은 원이 밖으로 나가므로 빼낸다
    // 저장된 회전교차로는 길이 닿는 교차점이면 어디든(교차로·막다른 끝·도로 중간의 꼭짓점, 소로·보행로 포함).
    // 가까운 교차점이 없으면(빈터·획지 안) 길과 이어지지 않은 회전교차로로 둔다. 표시하는 후보는 교차로와 막다른 끝만
    const rabOK = (list, nid) => inSite(nodes[nid].p);
    const rabShow = (list) => list.length >= 3 || list.length === 1 || (list.length === 2 && !joined(list[0], list[1]));
    const rabAt = new Map(), rabCand = [], rabs = [], alone = [];
    (rabSpecs || []).forEach((sp) => {
      if (!sp || !sp.p) return;
      // 가까운 교차점에 붙되, 같은 길의 꺾인 점(도로 중간)보다 교차로·도로 끝을 앞세운다(도로를 옮겨 교차점이 비켜났을 때 교차점을 따라가게)
      let best = null, bd = 9, bs = Infinity;
      at.forEach((list, nid) => {
        if (!rabOK(list, nid)) return;
        const d = U.dist(nodes[nid].p, sp.p); if (d >= 9) return;
        const sc = d + (list.length === 2 && joined(list[0], list[1]) ? 6 : 0);
        if (sc < bs) { bs = sc; bd = d; best = nid; }
      });
      if (best === null) { if (inSite(sp.p)) alone.push(sp); return; }
      const ex = rabAt.get(best);
      if (ex && ex.dd <= bd) return;
      rabAt.set(best, { sp, dd: bd });
    });
    at.forEach((list, nid) => { if (!rabAt.has(nid) && rabOK(list, nid) && rabShow(list)) rabCand.push({ node: nid, p: nodes[nid].p, deg: list.length, end: list.length === 1, W: Math.max(...list.map((o) => o.arm.lay.W)), inner: list.every((o) => o.arm.road.inner) }); });
    // 횡단보도 판단에 쓰는 길의 급: 대로 3 · 중로 2 · 소로 1 · 그보다 좁은 길 0
    const rank = (W) => (W >= 25 - 1e-6 ? 3 : W >= 12 - 1e-6 ? 2 : W >= 8 - 1e-6 ? 1 : 0);
    at.forEach((list, nid) => {
      const N = nodes[nid].p;
      list.forEach((o) => { o.ang = Math.atan2(o.d[1], o.d[0]); });
      list.sort((a, b) => a.ang - b.ang);
      // 팔 기준 왼쪽/오른쪽 연석 거리(양수)
      list.forEach((o) => {
        const L = o.arm.lay;
        o.cL = L.hasCar ? (o.sgn === 1 ? L.curbL : -L.curbR) : null;
        o.cR = L.hasCar ? (o.sgn === 1 ? -L.curbR : L.curbL) : null;
        o.hw = L.W / 2;
        o.nl = U.perpL(o.d);
        o.nr = U.perpR(o.d);
      });
      nodeInfo.push({ id: nid, p: N, deg: list.length });
      const rb = rabAt.get(nid);
      if (rb) { rabs.push(makeRab(rb.sp, nid, N, list)); return; }
      if (list.length < 2) return;
      // 서로 다른 단지 안 길 둘이 끝과 끝으로 꺾여 만나는 곳: 이웃 길 쪽으로 이어 그려 바깥 모서리가 비지 않게(같은 길의 꺾인 곳처럼)
      if (list.length === 2 && !joined(list[0], list[1]) && list.every((o) => o.arm.road.inner) && U.dot(list[0].d, list[1].d) > -0.8) {
        list.forEach((o, i) => { const q = list[1 - i], P2 = q.arm.pts; o.arm.trim[o.end].pairPt = q.end === 'start' ? P2[1] : P2[P2.length - 2]; });
      }
      /* 단지 안 길이 큰길에 닿는 끝(진출입로): 차도 포장은 큰길의 연석선에서, 오솔길 같은 비차도는 큰길 가장자리(보도 바깥)에서 끊는다 */
      list.forEach((o) => {
        if (!o.arm.road.inner) return;
        const t = o.arm.trim[o.end];
        list.forEach((q) => {
          if (q === o || q.arm.road.inner) return;
          const cr = Math.abs(U.cross(q.d, o.d)); if (cr < 0.2) return;
          const curb = q.arm.lay.hasCar ? (U.dot(o.d, q.nl) >= 0 ? q.cL : q.cR) : null;
          if (curb !== null) t.icar = Math.max(t.icar || 0, curb / cr);
          t.iedge = Math.max(t.iedge || 0, q.hw / cr);
        });
      });
      // 교차 박스 깊이: 다른 팔의 연석선까지 거리
      list.forEach((o) => {
        let box = 0;
        list.forEach((q) => {
          if (q === o || joined(o, q) || q.arm.road === o.arm.road && Math.abs(U.dot(q.d, o.d) + 1) < 0.02) return;
          if (q.arm.road.inner && !o.arm.road.inner) return; // 단지 안 길이 닿는 곳은 진출입로: 큰길의 차선·가로수를 끊지 않는다
          if (list.length === 2 && U.dot(q.d, o.d) < -0.8) return; // 두 도로가 끝과 끝으로 거의 곧게 이어짐
          if (!q.arm.lay.hasCar && !o.arm.lay.hasCar) return;
          const w = q.arm.lay.hasCar ? Math.max(q.cL, q.cR) : q.hw;
          const s = Math.abs(U.cross(q.d, o.d)) > 0.2 ? w / Math.abs(U.cross(q.d, o.d)) : 0;
          if (s < 60) box = Math.max(box, s);
        });
        o.arm.trim[o.end].box = box;
      });
      // 횡단보도를 둘 만한 끝인가: 셋 이상이 만나는 교차점에서, 엇갈려 만나는 다른 길이 차도를 가졌고 급이 한 단계 아래까지일 때.
      // (골목·보행로가 큰길에 닿는 곳마다 큰길을 건너는 횡단보도를 두지 않는다. 그런 곳은 아래 spaceCrosswalks가 간격을 보고 고른다)
      list.forEach((o) => {
        const t = o.arm.trim[o.end];
        const real = o.arm.road.inner ? list : list.filter((q) => !q.arm.road.inner); // 큰길에서는 단지 안 길을 교차로로 세지 않는다
        t.junction = real.length >= 3 && t.box > 0;
        t.cw = false;
        t.minor = o.arm.lay.hasCar && !real.some((q) => q !== o && !joined(o, q) && q.arm.lay.hasCar); // 차도 있는 다른 길이 없는 점(골목·보행로·단지 안 길만 닿음)
        if (!t.junction || !o.arm.lay.hasCar || !o.arm.road.crosswalk) return;
        const ro = rank(o.arm.lay.W);
        t.cw = real.some((q) => q !== o && q.arm.road !== o.arm.road && q.arm.lay.hasCar && Math.abs(U.cross(q.d, o.d)) > 0.3 && rank(q.arm.lay.W) >= ro - 1);
      });
      for (let i = 0; i < list.length; i++) {
        const A = list[i], B = list[(i + 1) % list.length];
        let gap = B.ang - A.ang;
        if (list.length === 1) continue;
        while (gap <= 0) gap += Math.PI * 2;
        if (gap >= Math.PI - 0.06) continue; // 직진 또는 바깥쪽: 연속
        if (joined(A, B)) continue;          // 같은 도로가 꺾이며 이어지는 안쪽: 모서리가 아니라 한 길
        if (list.length === 2 && U.dot(A.d, B.d) < -0.8) continue; // 두 도로가 끝과 끝으로 거의 곧게 이어지는 곳도 모서리로 보지 않음
        const tA = A.arm.trim[A.end], tB = B.arm.trim[B.end];
        // A의 왼쪽 비차도 구간은 B의 오른쪽 연석선(차도 가장자리)에서 끊는다
        if (B.cR !== null) {
          const p0 = U.add(N, U.mul(B.nr, B.cR));
          tA.L = clipLine(p0, B.d, U.add(N, U.mul(A.d, 500)));
        }
        if (A.cL !== null) {
          const p0 = U.add(N, U.mul(A.nl, A.cL));
          tB.R = clipLine(p0, A.d, U.add(N, U.mul(B.d, 500)));
        }
        if (A.cL !== null && B.cR !== null) {
          const pa = U.add(N, U.mul(A.nl, A.cL));
          const pb = U.add(N, U.mul(B.nr, B.cR));
          const Q = U.lineIntersect(pa, A.d, pb, B.d);
          if (!Q || U.dist(Q, N) > 80) continue;
          const r = Math.max(0.5, Math.min(A.arm.road.curbR || 5, B.arm.road.curbR || 5));
          const phi = gap;
          let t = r / Math.tan(phi / 2);
          t = Math.min(t, 0.45 * Math.min(A.arm.len, B.arm.len));
          const rr = t * Math.tan(phi / 2);
          const Ti = U.add(Q, U.mul(A.d, t));
          const Tj = U.add(Q, U.mul(B.d, t));
          const bis = U.norm(U.add(A.d, B.d));
          const Cc = U.add(Q, U.mul(bis, rr / Math.sin(phi / 2)));
          const a0 = Math.atan2(Ti[1] - Cc[1], Ti[0] - Cc[0]);
          const a1 = Math.atan2(Tj[1] - Cc[1], Tj[0] - Cc[0]);
          const arc = U.arcPoints(Cc, rr, a0, a1, 10);
          fillets.push({ node: nid, Q, Ti, Tj, arc, poly: [Q, ...arc], inner: !!(A.arm.road.inner || B.arm.road.inner) });
          tA.curbL = Math.max(tA.curbL, U.dot(U.sub(Ti, pa), A.d));
          tB.curbR = Math.max(tB.curbR, U.dot(U.sub(Tj, pb), B.d));
        }
      }
    });
    // 길과 이어지지 않은 회전교차로(단지 안 도로의 시작점 등): 둘레 보도까지 갖춘 둥근 회전차로만
    alone.forEach((sp) => rabs.push(makeRab(sp, null, sp.p.slice(), [])));
    // 이미 있는 회전교차로와 겹칠 교차점은 표시만 하고 막는다(새로 둘 크기는 자동값으로 어림)
    rabCand.forEach((c) => {
      const est = (c.inner ? Dv.rabAutoInner(c.W) : Dv.rabAuto(c.W, c.W >= 20 ? 2 : 1)) / 2 + 3.8;
      const hit = rabs.find((rb) => U.dist(rb.c, c.p) < est + rb.R2 - 1);
      if (hit) { c.blocked = true; c.gap = Math.ceil(est + hit.R2 - 1); c.dist = U.dist(hit.c, c.p); }
    });
    return { fillets, nodeInfo, at, rabs, rabCand };
  }

  /* ---------- 회전교차로 ----------
     sp: 저장된 설정 {id, p, d(내접원 지름, 비우면 자동), lanes(회전차로 수, 비우면 자동)}.
     R: 내접원 반지름(회전차로 바깥 연석), Ri: 회전차로 안쪽 가장자리, Ra: 중앙섬(화물차 턱 Ri−Ra 안쪽), R2: 둘레 보도 바깥(가구는 여기서 끊는다).
     진입·진출부는 팔의 연석선과 원을 반지름 rf의 곡선으로 잇는다. 차량은 반시계 방향으로 돈다(우측통행) */
  const ang = (v) => Math.atan2(v[1], v[0]);
  function arcCCW(c, r, a0, a1, step) {
    let da = a1 - a0;
    while (da <= 0) da += Math.PI * 2;
    const n = Math.max(2, Math.ceil((da * r) / (step || 1.2)));
    const out = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (da * i) / n; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
    return out;
  }
  Dv.circle = (c, r, step) => { const n = U.clamp(Math.ceil((Math.PI * 2 * r) / (step || 1.0)), 24, 180), out = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } return out; };
  Dv.rabAuto = function (Wmax, lanes) { return U.clamp(Math.round((Wmax * 1.3 + 14) / 5) * 5, lanes === 2 ? 45 : 20, 60); };
  /* 단지 안 길의 소형 회전교차로(미니 로터리): 단지내도로 4m면 지름 16m */
  Dv.rabAutoInner = function (Wmax) { return U.clamp(Math.round(Wmax * 2 + 8), 12, 24); };
  function makeRab(sp, nid, N, list) {
    const car = list.filter((o) => o.arm.lay.hasCar);
    const inner = list.length ? list.every((o) => o.arm.road.inner) : !!sp.inner; // 단지 안 길만 만나는 곳(또는 단지 안에 둔 회전교차로)
    const Wmax = list.length ? Math.max(...list.map((o) => o.arm.lay.W)) : inner ? 4 : 10; // 이어진 길이 없으면 소로(단지 안이면 단지내도로) 폭으로 어림
    const cmax = Math.max(0, ...car.map((o) => Math.max(o.cL, o.cR)));
    const hwMax = list.length ? Math.max(...list.map((o) => o.hw)) : 0;
    const lanes = inner ? 1 : sp.lanes === 1 || sp.lanes === 2 ? sp.lanes : Wmax >= 20 ? 2 : 1;
    const wc = inner ? U.clamp(Wmax, 3.5, 5) : lanes === 2 ? 9.0 : 5.5; // 회전차로 폭
    const dAuto = inner ? Dv.rabAutoInner(Wmax) : Dv.rabAuto(Wmax, lanes);
    const D0 = sp.d > 0 ? sp.d : dAuto;
    const apron = inner ? 0.6 : D0 >= 26 ? 1.5 : 1.0;  // 화물차 턱(대형차가 밟고 도는 낮은 포장)
    const Rmin = Math.max(wc + apron + 2.0, hwMax + 1.0, cmax + 2.5);
    const R = Math.max(D0 / 2, Rmin), Ri = R - wc, Ra = Ri - apron;
    const sw = list.length ? U.clamp(Math.max(...list.map((o) => (o.arm.lay.hasCar ? Math.max(o.hw - o.cL, o.hw - o.cR) : 2.5))), 2, 5) : 2.5;
    const R2 = R + sw + 0.8;
    const rf = U.clamp(R * 0.33, 3.5, 9);
    sp.p = [U.round(N[0], 2), U.round(N[1], 2)]; // 도로를 옮겨도 교차점을 따라간다
    const rab = { id: sp.id, node: nid, c: N, R, Ri, Ra, R2, rf, lanes, wc, apron, d: 2 * R, dAuto, auto: !(sp.d > 0), autoLanes: !(sp.lanes === 1 || sp.lanes === 2), fillets: [], curbArcs: [], throats: [], arms: list.length, entries: car.length, inner };
    const sAt = (rr, c) => Math.sqrt(Math.max(0, rr * rr - c * c));
    const opens = [];
    list.forEach((o) => {
      const t = o.arm.trim[o.end], d = o.d, L = o.arm.lay;
      t.rab = rab; t.junction = true; t.minor = false;
      t.box = R + 4.5;           // 횡단보도·차선·가로수가 원에서 물러나는 거리
      t.isl = R + 1.0;           // 중앙분리대 끝(분리섬)
      t.cw = L.hasCar && !!o.arm.road.crosswalk;
      const sSide = sAt(R2, o.hw);
      t.L = { p0: U.add(N, U.mul(d, sSide)), n: d };
      t.R = { p0: U.add(N, U.mul(d, sSide)), n: d };
      if (!L.hasCar) return;
      const cm = Math.max(o.cL, o.cR);
      t.cut = Math.max(0, sAt(R, cm) - 0.05);
      // 원 둘레로 들어서는 목: 차도 전체 폭을 원 안쪽에서 분리섬 끝까지 덮는다
      const s0 = t.cut, s1 = t.isl;
      const P0 = U.add(N, U.mul(d, s0)), P1 = U.add(N, U.mul(d, s1));
      rab.throats.push([U.add(P0, U.mul(o.nl, o.cL)), U.add(P1, U.mul(o.nl, o.cL)), U.add(P1, U.mul(o.nr, o.cR)), U.add(P0, U.mul(o.nr, o.cR))]);
      const op = { ang: o.ang };
      [['L', o.cL, o.nl], ['R', o.cR, o.nr]].forEach(([k, c, n]) => {
        const sf = sAt(R + rf, c + rf);
        const Cf = U.add(N, U.add(U.mul(d, sf), U.mul(n, c + rf)));
        const Tl = U.add(N, U.add(U.mul(d, sf), U.mul(n, c)));
        const Tc = U.add(N, U.mul(U.sub(Cf, N), R / (R + rf)));
        const X = U.add(N, U.add(U.mul(d, sAt(R, c)), U.mul(n, c)));
        const arc = U.arcPoints(Cf, rf, ang(U.sub(Tl, Cf)), ang(U.sub(Tc, Cf)), 8);
        const ra = U.arcPoints(N, R, ang(U.sub(Tc, N)), ang(U.sub(X, N)), 3);
        rab.fillets.push({ poly: [Tl, ...arc.slice(1), ...ra.slice(1)], arc });
        t['curb' + k] = sf;
        op[k] = ang(U.sub(Tc, N));
      });
      opens.push(op);
    });
    // 원의 바깥 연석: 진입부 사이의 호(반시계 방향으로 왼쪽 곡선 끝 → 다음 팔의 오른쪽 곡선 끝)
    opens.sort((a, b) => a.ang - b.ang);
    if (opens.length) opens.forEach((op, i) => { const nx = opens[(i + 1) % opens.length]; rab.curbArcs.push(arcCCW(N, R, op.L, nx.R, 1.0)); });
    else rab.curbArcs.push(Dv.circle(N, R).concat([Dv.circle(N, R)[0]]));
    return rab;
  }
  /* 회전교차로를 마주한 건물 면은 곡선 대신 곧게. 건물 윤곽에서 원(둘레 보도 R2 + 건축선 후퇴)을 따라 굽은 꼭짓점들을 찾아,
     그 가운데 방향의 접선 하나로 바꾼다. 앞뒤 변이 접선과 만나면 모서리를 비스듬히 자르고(교차로 모퉁이),
     나란하면(도로 중간의 회전교차로) 접선까지 물러난 곧은 면을 만든다 */
  function straightToRabs(fp, rabs, front) {
    let out = fp;
    rabs.forEach((rb) => {
      if (!out || out.length < 3) return;
      const n0 = out.length, rr = rb.R2 + Math.max(0, front || 0);
      const near = out.map((p) => U.dist(p, rb.c) < rr + 0.8);
      if (!near.some(Boolean) || near.every(Boolean)) return;
      // 가장 긴 연속 구간(원형으로 이어 본다)
      let best = null;
      for (let i = 0; i < n0; i++) {
        if (!near[i] || near[(i - 1 + n0) % n0]) continue;
        let j = i, len = 1;
        while (near[(j + 1) % n0] && len < n0) { j = (j + 1) % n0; len++; }
        if (!best || len > best.len) best = { i, j, len };
      }
      if (!best) return;
      const { i, j } = best;
      const A = out[(i - 1 + n0) % n0], vi = out[i], vj = out[j], B = out[(j + 1) % n0];
      // 접선 방향: 구간에서 원 중심에 가장 가까운 점 쪽
      let cl = vi, cd = Infinity;
      for (let k = i, c = 0; c < best.len; k = (k + 1) % n0, c++) { const d = U.dist(out[k], rb.c); if (d < cd) { cd = d; cl = out[k]; } }
      const n = U.norm(U.sub(cl, rb.c)), r = rr + 0.3;
      const onL = (p) => U.add(p, U.mul(n, r - U.dot(U.sub(p, rb.c), n))); // 접선 위로 옮긴 점
      const hit = (P0, P1) => { // P0→P1 직선이 접선과 만나는 점(P0 쪽에서 앞으로, 너무 멀지 않게)
        const d = U.sub(P1, P0), den = U.dot(d, n);
        if (Math.abs(den) < 1e-6) return null;
        const t = (r - U.dot(U.sub(P0, rb.c), n)) / den;
        return t > -0.01 && t < 3 ? U.add(P0, U.mul(d, t)) : null;
      };
      const X1 = hit(A, vi), X2 = hit(B, vj);
      const mid = [].concat(X1 ? [X1] : [vi, onL(vi)], X2 ? [X2] : [onL(vj), vj]);
      const res = [];
      for (let k = (j + 1) % n0, c = 0; c < n0 - best.len; k = (k + 1) % n0, c++) res.push(out[k]);
      const poly = res.concat(mid);
      out = poly.length >= 3 && Math.abs(U.polyArea(poly)) > 12 ? poly : out;
    });
    return out;
  }
  /* 건물 윤곽이 회전교차로(둘레 보도 + 건축선 후퇴)를 침범하지 않게: 원 쪽 면을 곧게 물리고,
     원이 건물 안에 들거나 물려도 겹치면 그 건물은 세우지 않는다(획지 안에 둔 회전교차로) */
  function avoidRabs(fp, rabs, front) {
    let out = fp;
    for (let q = 0; q < rabs.length && out; q++) {
      const rb = rabs[q], rr = rb.R2 + Math.max(0, front || 0);
      const dmin = (P) => P.reduce((m, p, i) => Math.min(m, U.distPointSeg(rb.c, p, P[(i + 1) % P.length]).d), Infinity);
      if (dmin(out) > rr - 0.05 && !U.pointInPoly(rb.c, out)) continue; // 둘레(보도 바깥 + 건축선 후퇴)를 실제로 침범할 때만 고친다
      if (U.pointInPoly(rb.c, out)) return null;
      if (!out.some((p) => U.dist(p, rb.c) < rr + 0.8)) { // 원 가까이에 꼭짓점이 없으면(긴 면 한가운데) 면 위에 점을 촘촘히 넣어 둔다
        const dn = [];
        out.forEach((p, i) => {
          const b = out[(i + 1) % out.length]; dn.push(p);
          if (U.distPointSeg(rb.c, p, b).d > rr + 0.8) return;
          const L = U.dist(p, b), n = Math.floor(L / 1.5);
          for (let k = 1; k < n; k++) dn.push(U.lerp2 ? U.lerp2(p, b, k / n) : [p[0] + ((b[0] - p[0]) * k) / n, p[1] + ((b[1] - p[1]) * k) / n]);
        });
        out = dn;
      }
      out = straightToRabs(out, [rb], front);
      out = out ? U.cleanPoly(out) : null;
      if (!out || out.length < 3 || dmin(out) < rr - 1.0 || Math.abs(U.polyArea(out)) < 20) return null;
    }
    return out;
  }
  /* 가구(edges: 다각형 변)에서 원(c, r) 안을 덜어 낸다. 덜어 낸 자리는 원호로 잇고, 호의 앞뒤 절반은 각각 들어오고 나가는 변의 도로에 면한다.
     가구가 통째로 원 안이면 null */
  function cutDisc(edges, c, r) {
    const n = edges.length;
    const inside = (p) => U.dist(p, c) < r - 1e-6;
    const hits = (A, B) => { // 선분 A→B가 원과 만나는 t(0<t<1)
      const d = U.sub(B, A), f = U.sub(A, c);
      const a = U.dot(d, d), b = 2 * U.dot(f, d), q = U.dot(f, f) - r * r;
      const disc = b * b - 4 * a * q;
      if (a < 1e-12 || disc <= 1e-12) return [];
      const sq = Math.sqrt(disc);
      return [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].filter((t) => t > 1e-9 && t < 1 - 1e-9);
    };
    if (!edges.some((e) => inside(e.a) || hits(e.a, e.b).length)) return edges;
    const k0 = edges.findIndex((e) => !inside(e.a));
    if (k0 < 0) return null;
    const cw = U.polyArea(edges.map((e) => e.a)) > 0; // 가구가 반시계면 원호는 시계 방향으로
    const out = [];
    let entry = null;
    const exitAt = (X, e) => {
      const a0 = ang(U.sub(entry.X, c)), a1 = ang(U.sub(X, c));
      const pts = cw ? arcCCW(c, r, a1, a0, 1.5).reverse() : arcCCW(c, r, a0, a1, 1.5);
      pts[0] = entry.X; pts[pts.length - 1] = X;
      pts.forEach((q, k) => { const src = k < (pts.length - 1) / 2 ? entry.e : e; out.push({ p: q, roadId: src.roadId, road: src.road }); });
      entry = null;
    };
    for (let i = 0; i < n; i++) {
      const e = edges[(k0 + i) % n];
      const inA = inside(e.a), inB = inside(e.b), hs = hits(e.a, e.b);
      if (!inA && !entry) out.push({ p: e.a, roadId: e.roadId, road: e.road });
      let cur = inA;
      if (!hs.length) { // 원 위의 꼭짓점을 지나 드나드는 경우
        if (!inA && inB && !entry) entry = { X: e.a, e };
        else if (inA && !inB && entry) exitAt(e.b, e);
        continue;
      }
      hs.forEach((t) => {
        const X = U.add(e.a, U.mul(U.sub(e.b, e.a), t));
        if (!cur) { entry = { X, e }; cur = true; return; }
        if (entry) exitAt(X, e);
        cur = false;
      });
    }
    if (out.length < 3) return null;
    const res = out.map((v, k) => ({ a: v.p, b: out[(k + 1) % out.length].p, roadId: v.roadId, road: v.road })).filter((e) => U.dist(e.a, e.b) > 1e-3);
    return res.length >= 3 ? res : null;
  }
  /* 골목·보행로만 닿아 횡단보도를 두지 않은 교차점이 길게 이어지면 건널 곳이 없어진다.
     도로를 따라가며 앞 횡단보도에서 일정 거리(대로 240m · 중로 150m · 소로 100m) 넘게 떨어진 교차점에 하나씩 둔다 */
  function spaceCrosswalks(arms) {
    const byRoad = new Map();
    arms.forEach((a) => { if (!byRoad.has(a.road.id)) byRoad.set(a.road.id, []); byRoad.get(a.road.id).push(a); });
    byRoad.forEach((list) => {
      const road = list[0].road, lay = list[0].lay;
      if (!road.crosswalk || !lay.hasCar) return;
      const G = lay.W >= 25 - 1e-6 ? 240 : lay.W >= 12 - 1e-6 ? 150 : 100;
      // 도로를 따라 놓인 교차점들: s(시작점부터의 거리), 이미 횡단보도가 있는지, 둘 수 있는 팔 끝
      const js = [];
      let s = 0;
      list.forEach((a, i) => {
        if (i === 0 && a.trim.start.junction) js.push({ s, has: a.trim.start.cw, t: a.trim.start, ok: a.len > a.trim.start.box + 8 });
        s += a.len;
        const nx = a.next === list[i + 1] ? list[i + 1] : null;
        if (a.trim.end.junction || (nx && nx.trim.start.junction)) js.push({ s, has: a.trim.end.cw || !!(nx && nx.trim.start.cw), t: a.trim.end, ok: a.trim.end.junction && a.len > a.trim.end.box + 8 });
      });
      let last = -G / 2;
      js.forEach((j, k) => {
        if (j.has) { last = j.s; return; }
        let nextHas = s + G / 2;
        for (let m = k + 1; m < js.length; m++) if (js[m].has) { nextHas = js[m].s; break; }
        if (j.ok && j.s - last >= G && nextHas - j.s >= G * 0.6) { j.t.cw = true; last = j.s; }
      });
    });
  }
  function clipLine(p0, dir, keepPt) {
    let n = U.perpL(dir);
    if (U.dot(U.sub(keepPt, p0), n) < 0) n = U.mul(n, -1);
    return { p0, n };
  }

  /* 팔의 구간 다각형(밴드), 연석선, 노면표시, 횡단보도 */
  function buildArmGeometry(arm) {
    const L = arm.lay;
    const out = { bands: [], curbs: [], marks: [], cross: [], stops: [], stalls: [], yields: [], splits: [] };
    const pts = arm.pts;
    const tS = arm.trim.start, tE = arm.trim.end;
    // 끝에서 거리 d인 점과 교차점에서 멀어지는 방향(회전교차로 원에서 자를 때)
    const fromEnd = (end, d) => { const q = U.pointAlong(pts, end === 'start' ? d : arm.len - d); return { p: q.p, n: end === 'start' ? q.dir : U.mul(q.dir, -1), dir: q.dir }; };
    // 같은 도로의 앞뒤 팔과 만나는 끝: 이웃 팔 쪽으로 한 점 늘려 띠를 만든 뒤 두 방향의 이등분선에서 잘라, 꺾인 곳에서도 틈·겹침 없이 맞붙인다
    const k = pts.length - 1;
    const bend = (a, n, b) => U.dot(U.norm(U.sub(n, a)), U.norm(U.sub(b, n)));
    const pre = arm.prev && arm.prev.pts.length > 1 ? arm.prev.pts[arm.prev.pts.length - 2] : tS.pairPt || null;
    const post = arm.next && arm.next.pts.length > 1 ? arm.next.pts[1] : tE.pairPt || null;
    const lim = (t) => (t.pairPt ? -0.75 : 0.2); // 단지 안 길 둘이 만나는 곳은 더 크게 꺾여도 잇는다
    const jS = pre && !tS.rab && bend(pre, pts[0], pts[1]) > lim(tS) ? { p: pts[0], n: U.norm(U.add(U.norm(U.sub(pts[0], pre)), U.norm(U.sub(pts[1], pts[0])))) } : null;
    const jE = post && !tE.rab && bend(pts[k - 1], pts[k], post) > lim(tE) ? { p: pts[k], n: U.mul(U.norm(U.add(U.norm(U.sub(pts[k], pts[k - 1])), U.norm(U.sub(post, pts[k])))), -1) } : null;
    const ext = (jS ? [pre] : []).concat(pts, jE ? [post] : []);
    L.bands.forEach((b) => {
      const left = U.offsetPolyline(ext, b.oL);
      const right = U.offsetPolyline(ext, b.oR);
      let poly = left.concat(right.slice().reverse());
      if (U.polyArea(poly) < 0) poly = poly.reverse();
      if (jS) poly = U.clipHalfPlane(poly, jS.p, jS.n);
      if (jE) poly = U.clipHalfPlane(poly, jE.p, jE.n);
      if (b.def.carriage) {
        // 회전교차로: 차도 구간은 원 안쪽(목)에서 자르고 나머지는 원의 회전차로가 덮는다. 단지 안 길의 진출입로는 큰길 연석선에서
        [[tS, 'start'], [tE, 'end']].forEach(([t, end]) => {
          const c = t.rab ? t.cut : t.icar;
          if (c > 0) { const q = fromEnd(end, c); poly = U.clipHalfPlane(poly, q.p, q.n); }
        });
      } else {
        [[tS, 'start'], [tE, 'end']].forEach(([t, end]) => { if (!t.rab && t.iedge > 0) { const q = fromEnd(end, t.iedge); poly = U.clipHalfPlane(poly, q.p, q.n); } });
        // 비차도 구간: 왼쪽 밴드는 L 절단선, 오른쪽 밴드는 R 절단선, 걸친 밴드는 둘 다
        const isL = b.oR >= -1e-6, isR = b.oL <= 1e-6;
        [[tS, 'start'], [tE, 'end']].forEach(([t, end]) => {
          const sideL = end === 'start' ? 'L' : 'R';
          const sideR = end === 'start' ? 'R' : 'L';
          // 끝점에서는 팔 방향이 반대이므로 좌우가 바뀐다
          const keepIsl = t.rab && b.def.island; // 회전교차로의 중앙분리대는 분리섬으로 원 가까이까지
          if (!keepIsl && (isL || (!isL && !isR)) && t[sideL]) poly = U.clipHalfPlane(poly, t[sideL].p0, t[sideL].n);
          if (!keepIsl && (isR || (!isL && !isR)) && t[sideR]) poly = U.clipHalfPlane(poly, t[sideR].p0, t[sideR].n);
          if (b.def.island) {
            const d = t.isl || t.box + 1.5;
            const P0 = end === 'start' ? U.pointAlong(pts, d) : U.pointAlong(pts, arm.len - d);
            const n = end === 'start' ? P0.dir : U.mul(P0.dir, -1);
            poly = U.clipHalfPlane(poly, P0.p, n);
          }
        });
      }
      if (poly.length >= 3) out.bands.push({ band: b, poly });
    });
    // 연석선(차도 바깥 가장자리)
    if (L.hasCar) {
      const cut = (line, s0, s1) => cutPolyline(line, s0, s1);
      const lineL = U.offsetPolyline(pts, L.curbL);
      const lineR = U.offsetPolyline(pts, L.curbR);
      out.curbs.push(cut(lineL, tS.curbL, tE.curbR));
      out.curbs.push(cut(lineR, tS.curbR, tE.curbL));
      // 중앙분리대 양측
      L.bands.forEach((b) => {
        if (!b.def.island) return;
        const s0 = tS.isl || tS.box + 1.5, s1 = tE.isl || tE.box + 1.5;
        out.curbs.push(cut(U.offsetPolyline(pts, b.oL), s0, s1));
        out.curbs.push(cut(U.offsetPolyline(pts, b.oR), s0, s1));
      });
      // 노면표시
      const cw = arm.road.crosswalk ? 4 : 0; // 횡단보도 폭. 실제로 두는지는 끝마다 다르다(trim.cw)
      // 차선은 교차 박스 앞에서 끊는다. 골목·보행로만 닿는 곳(minor)은 끊지 않고 지나가되, 횡단보도를 둔 곳에서는 그 앞에서 끊는다
      const mk = (t, joint) => (cw && t.cw ? t.box + 1 + cw + 1.5 : t.minor && joint ? 0 : t.box + 1);
      const s0 = mk(tS, !!arm.prev), s1 = mk(tE, !!arm.next);
      const car = L.bands.filter((b) => b.def.carriage || b.def.island);
      for (let i = 0; i + 1 < car.length; i++) {
        const a = car[i], b = car[i + 1];
        if (a.def.island || b.def.island) continue;
        const ta = a.seg.type, tb = b.seg.type;
        const line = cut(U.offsetPolyline(pts, a.oR), s0, s1);
        if (line.length < 2) continue;
        if ((ta === 'lane' || ta === 'bus') && (tb === 'lane' || tb === 'bus') && (a.seg.dir || 1) !== (b.seg.dir || 1)) {
          out.marks.push({ kind: 'center', pts: cut(U.offsetPolyline(pts, a.oR + 0.12), s0, s1) });
          out.marks.push({ kind: 'center', pts: cut(U.offsetPolyline(pts, a.oR - 0.12), s0, s1) });
        } else if (ta === 'lane' && tb === 'lane') out.marks.push({ kind: 'dash', pts: line });
        else if (ta === 'bus' || tb === 'bus') out.marks.push({ kind: 'bus', pts: line });
        else out.marks.push({ kind: 'edge', pts: line });
      }
      // 횡단보도·정지선
      if (cw) {
        [['start', tS], ['end', tE]].forEach(([end, t]) => {
          if (!t.box || !t.cw) return;
          const d0 = t.box + 1, d1 = t.box + 1 + cw;
          const sA = end === 'start' ? d0 : arm.len - d1;
          const sB = end === 'start' ? d1 : arm.len - d0;
          const pA = U.pointAlong(pts, sA), pB = U.pointAlong(pts, sB);
          const n = U.perpL(pA.dir);
          const stripes = [];
          for (let o = L.curbL - 0.3; o > L.curbR + 0.3; o -= 1.0) {
            const o2 = Math.max(o - 0.5, L.curbR + 0.3);
            stripes.push([U.add(pA.p, U.mul(n, o)), U.add(pB.p, U.mul(n, o)), U.add(pB.p, U.mul(n, o2)), U.add(pA.p, U.mul(n, o2))]);
          }
          out.cross.push({ end, stripes, a: pA.p, b: pB.p, n });
          // 정지선: 교차로로 향하는 차로(회전교차로는 정지선 대신 양보선)
          if (t.rab) return;
          const sS = end === 'start' ? d1 + 1.0 : arm.len - d1 - 1.0;
          const pS = U.pointAlong(pts, sS);
          L.bands.forEach((b) => {
            if (b.seg.type !== 'lane' && b.seg.type !== 'bus') return;
            const inbound = end === 'end' ? (b.seg.dir || 1) > 0 : (b.seg.dir || 1) < 0;
            if (!inbound) return;
            out.stops.push([U.add(pS.p, U.mul(n, b.oL)), U.add(pS.p, U.mul(n, b.oR))]);
          });
        });
      }
      // 회전교차로 진입부: 원 앞의 양보선(점선)과 진입·진출을 나누는 분리섬
      [['start', tS], ['end', tE]].forEach(([end, t]) => {
        const rb = t.rab;
        if (!rb) return;
        const inb = (b) => (b.seg.type === 'lane' || b.seg.type === 'bus') && (end === 'end' ? (b.seg.dir || 1) > 0 : (b.seg.dir || 1) < 0);
        const lanes = L.bands.filter((b) => b.seg.type === 'lane' || b.seg.type === 'bus');
        const q = fromEnd(end, rb.R + 0.5), n = U.perpL(q.dir);
        lanes.filter(inb).forEach((b) => out.yields.push([U.add(q.p, U.mul(n, b.oL - 0.15)), U.add(q.p, U.mul(n, b.oR + 0.15))]));
        if (L.bands.some((b) => b.def.island)) return;
        // 방향이 바뀌는 경계(중앙선)가 있는 양방향 길에만
        const car = L.bands.filter((b) => b.def.carriage);
        let oc = null;
        for (let i = 0; i + 1 < car.length; i++) {
          const a = car[i], b2 = car[i + 1];
          if ((a.seg.type === 'lane' || a.seg.type === 'bus') && (b2.seg.type === 'lane' || b2.seg.type === 'bus') && (a.seg.dir || 1) !== (b2.seg.dir || 1)) { oc = a.oR; break; }
        }
        if (oc === null) return;
        const sA = rb.R + 0.9, sB = rb.R + (cw && t.cw ? 12 : 8);
        const w = (s) => U.lerp(0.85, 0.25, (s - sA) / (sB - sA));
        const piece = (s0, s1) => {
          if (s1 - s0 < 0.8) return;
          const a = fromEnd(end, s0), b2 = fromEnd(end, s1), na = U.perpL(a.dir), nb = U.perpL(b2.dir);
          out.splits.push([U.add(a.p, U.mul(na, oc + w(s0))), U.add(b2.p, U.mul(nb, oc + w(s1))), U.add(b2.p, U.mul(nb, oc - w(s1))), U.add(a.p, U.mul(na, oc - w(s0)))]);
        };
        // 횡단보도 자리는 비워 둔다(보행자 대기 공간)
        if (cw && t.cw) { piece(sA, t.box + 0.6); piece(t.box + 1 + cw + 0.4, sB); } else piece(sA, sB);
      });
      // 노상주차 구획선(평행주차 6.0m)
      L.bands.forEach((b) => {
        if (b.seg.type !== 'parking') return;
        const sa = tS.box + 8, sb = arm.len - tE.box - 8;
        for (let s = sa; s <= sb; s += 6.0) {
          const q = U.pointAlong(pts, s);
          const n = U.perpL(q.dir);
          out.stalls.push([U.add(q.p, U.mul(n, b.oL)), U.add(q.p, U.mul(n, b.oR))]);
        }
      });
    }
    return out;
  }
  function cutPolyline(line, s0, s1) {
    const L = U.polylineLength(line);
    if (s0 + s1 >= L - 0.05) return [];
    const out = [U.pointAlong(line, s0).p];
    let acc = 0;
    for (let i = 1; i < line.length; i++) {
      acc += U.dist(line[i - 1], line[i]);
      if (acc > s0 && acc < L - s1) out.push(line[i]);
    }
    out.push(U.pointAlong(line, L - s1).p);
    return out;
  }

  /* ---------- 가구 ---------- */
  function buildBlocks(P, faces) {
    const blocks = [];
    faces.forEach((f) => {
      const d = f.hes.map((h) => (h.e.road ? Dv.roadWidth(h.e.road) / 2 : 0));
      const off = U.offsetPoly(f.pts, d);
      if (!off) return;
      const n = off.pts.length;
      let edges = off.pts.map((p, k) => {
        const s = off.src[k];
        const road = s >= 0 ? f.hes[s].e.road : null;
        return { a: p, b: off.pts[(k + 1) % n], roadId: road ? road.id : null, road };
      });
      edges = mergeCollinear(edges);
      if (edges.length < 3) return;
      const area = U.polyArea(edges.map((e) => e.a));
      if (area < 30) return;
      blocks.push({ edges, face: f });
    });
    return blocks;
  }
  function mergeCollinear(edges) {
    let changed = true;
    let E = edges.filter((e) => U.dist(e.a, e.b) > 1e-4);
    while (changed && E.length > 3) {
      changed = false;
      for (let i = 0; i < E.length; i++) {
        const e1 = E[i], e2 = E[(i + 1) % E.length];
        const d1 = U.sub(e1.b, e1.a), d2 = U.sub(e2.b, e2.a);
        const cr = Math.abs(U.cross(U.norm(d1), U.norm(d2)));
        if (cr < 1e-4 && U.dot(d1, d2) > 0 && e1.roadId === e2.roadId) {
          e1.b = e2.b;
          E.splice((i + 1) % E.length, 1);
          changed = true;
          break;
        }
      }
    }
    return E;
  }
  function chamferBlock(edges, settings) {
    const out = [];
    const n = edges.length;
    for (let i = 0; i < n; i++) {
      const e0 = edges[(i - 1 + n) % n], e1 = edges[i];
      const d0 = U.norm(U.sub(e0.b, e0.a)), d1 = U.norm(U.sub(e1.b, e1.a));
      const cr = U.cross(d0, d1);
      let c = 0;
      if (e0.road && e1.road && cr > 0.5) {
        const auto = U.clamp(Math.min(e0.road.curbR || 4, e1.road.curbR || 4) * 0.5, 1.5, 5);
        c = settings.chamfer === null || settings.chamfer === undefined ? auto : settings.chamfer;
        c = Math.min(c, 0.3 * U.dist(e0.a, e0.b), 0.3 * U.dist(e1.a, e1.b));
      }
      if (c > 0.05) {
        const pA = U.sub(e1.a, U.mul(d0, c));
        const pB = U.add(e1.a, U.mul(d1, c));
        out.push({ p: pA, roadIdNext: null, roadNext: null, corner: true }); // 가각(모퉁이를 깎은 변): 교차로에 면한다
        out.push({ p: pB, roadIdNext: e1.roadId, roadNext: e1.road });
      } else out.push({ p: e1.a, roadIdNext: e1.roadId, roadNext: e1.road });
    }
    return out.map((v, k) => ({ a: v.p, b: out[(k + 1) % out.length].p, roadId: v.roadIdNext, road: v.roadNext, corner: !!v.corner }));
  }

  /* ---------- 획지·건축물 ---------- */
  function subdivide(block) {
    const S = block.settings;
    const poly = block.poly;
    const use = S.use;
    if (C.USES[use] && C.USES[use].open && (S.lotsAlong || 1) <= 1 && !(S.splits && S.splits['0:0'])) return [{ key: '0:0', r: 0, i: 0, poly, cell: { r0: 0, r1: 0, i0: 0, i1: 0 } }];
    // 주 방향: 도로에 접한 가장 긴 변
    let best = null;
    block.edges.forEach((e) => {
      const L = U.dist(e.a, e.b);
      const score = L * (e.roadId ? 1 : 0.2);
      if (!best || score > best.score) best = { e, score };
    });
    const F = U.frameFromEdge(poly, best.e.a, best.e.b);
    const rows = U.clamp(S.lotRows || 1, 1, 3);
    const nAlong = U.clamp(Math.round(S.lotsAlong || 1), 1, 40);
    const lots = [];
    const du = (F.umax - F.umin) / nAlong;
    const dv = (F.vmax - F.vmin) / rows;
    // 격자 칸 범위(열 i0~i1, 줄 r0~r1)만큼 가구를 잘라 낸 다각형. 한 칸이면 획지 하나, 여러 칸이면 합친 획지
    const cut = (r0, r1, i0, i1) => {
      let p = poly;
      const u0 = F.umin + du * i0, u1 = F.umin + du * (i1 + 1);
      const v0 = F.vmin + dv * r0, v1 = F.vmin + dv * (r1 + 1);
      if (i0 > 0) p = U.clipHalfPlane(p, U.fromFrame(F, u0, 0), F.u);
      if (i1 < nAlong - 1) p = U.clipHalfPlane(p, U.fromFrame(F, u1, 0), U.mul(F.u, -1));
      if (r0 > 0) p = U.clipHalfPlane(p, U.fromFrame(F, 0, v0), F.v);
      if (r1 < rows - 1) p = U.clipHalfPlane(p, U.fromFrame(F, 0, v1), U.mul(F.v, -1));
      if (p.length < 3 || Math.abs(U.polyArea(p)) <= 20) return null;
      return U.polyArea(p) < 0 ? p.slice().reverse() : p;
    };
    /* 나눈 획지(S.splits[key] = { n, dir }): 획지 하나를 n개로 나눈다. dir 'u'는 도로를 따라 나란히(폭을 나눔), 'v'는 앞뒤로(깊이를 나눔).
       조각의 이름은 key.0, key.1 … 조각 가운데 하나라도 너무 작으면(20㎡ 이하) 나누지 않는다 */
    const push = (key, r, i, p, cell) => {
      const sp = S.splits && S.splits[key];
      const n = sp ? U.clamp(Math.round(sp.n || 2), 2, 6) : 0;
      if (n) {
        const ax = sp.dir === 'v' ? F.v : F.u;
        let a = Infinity, b = -Infinity;
        p.forEach((q) => { const t = U.dot(U.sub(q, F.o), ax); a = Math.min(a, t); b = Math.max(b, t); });
        const at = (t) => [F.o[0] + ax[0] * t, F.o[1] + ax[1] * t];
        const parts = [];
        for (let k = 0; k < n; k++) {
          let q = p;
          if (k > 0) q = U.clipHalfPlane(q, at(a + ((b - a) * k) / n), ax);
          if (k < n - 1) q = U.clipHalfPlane(q, at(a + ((b - a) * (k + 1)) / n), U.mul(ax, -1));
          if (q.length < 3 || Math.abs(U.polyArea(q)) <= 20) { parts.length = 0; break; }
          parts.push(U.polyArea(q) < 0 ? q.slice().reverse() : q);
        }
        if (parts.length === n) { parts.forEach((q, k) => lots.push({ key: key + '.' + k, r, i, poly: q, cell, sub: { of: key, k, n, dir: sp.dir === 'v' ? 'v' : 'u' } })); return; }
      }
      lots.push({ key, r, i, poly: p, cell });
    };
    // 합친 획지(S.merges): 붙어 있는 칸들의 직사각형 범위. 이름(key)은 범위의 첫 칸을 따른다
    const taken = new Set();
    (S.merges || []).forEach((m) => {
      const r0 = Math.max(0, Math.min(m.r0, m.r1)), r1 = Math.min(rows - 1, Math.max(m.r0, m.r1));
      const i0 = Math.max(0, Math.min(m.i0, m.i1)), i1 = Math.min(nAlong - 1, Math.max(m.i0, m.i1));
      if (!(r1 >= r0 && i1 >= i0) || (r0 === r1 && i0 === i1)) return;
      for (let r = r0; r <= r1; r++) for (let i = i0; i <= i1; i++) if (taken.has(r + ':' + i)) return;
      const p = cut(r0, r1, i0, i1);
      if (!p) return;
      for (let r = r0; r <= r1; r++) for (let i = i0; i <= i1; i++) taken.add(r + ':' + i);
      push(r0 + ':' + i0, r0, i0, p, { r0, r1, i0, i1 });
    });
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < nAlong; i++) {
        if (taken.has(r + ':' + i)) continue;
        const p = cut(r, r, i, i);
        if (p) push(r + ':' + i, r, i, p, { r0: r, r1: r, i0: i, i1: i });
      }
    }
    return lots;
  }

  /* 획지 변 가운데 가구의 가각(모퉁이를 깎은 변)에 놓인 것: 도로(교차로)에 면하므로 건축선 후퇴를 두고, 정북방향 일조의 인접 대지경계선으로 보지 않는다 */
  function lotCorners(lot, block) {
    const out = [], n = lot.poly.length;
    if (!block.edges.some((e) => e.corner)) return out;
    for (let k = 0; k < n; k++) {
      const a = lot.poly[k], b = lot.poly[(k + 1) % n];
      if (U.dist(a, b) < 0.05) continue;
      const m = U.mid(a, b);
      if (block.edges.some((e) => e.corner && U.distPointSeg(m, e.a, e.b).d < 0.05)) out.push(k);
    }
    return out;
  }
  /* 도로 쪽 변(접도 변 + 가각)의 번호 */
  const frontSet = (lot) => { const s = new Set(lot.frontage.map((f) => f.k)); (lot.cornerK || []).forEach((k) => s.add(k)); return s; };
  function lotFrontage(lot, block) {
    const fr = [];
    const n = lot.poly.length;
    for (let k = 0; k < n; k++) {
      const a = lot.poly[k], b = lot.poly[(k + 1) % n];
      const m = U.mid(a, b);
      if (U.dist(a, b) < 0.3) continue;
      for (const e of block.edges) {
        if (!e.roadId) continue;
        if (U.distPointSeg(m, e.a, e.b).d < 0.05) { fr.push({ k, roadId: e.roadId, len: U.dist(a, b) }); break; }
      }
    }
    return fr;
  }

  const OLD_PALETTE = [
    ['tile', '#d9cdb5'], ['stucco', '#e7dccb'], ['brick', '#a65a43'], ['tile', '#cbbfa6'], ['stucco', '#d8d2c5'],
    ['brick', '#8e4c3a'], ['stucco', '#efe6d1'], ['tile', '#c9b89a'], ['concrete', '#bdb8ad'], ['stucco', '#e2c9a9'],
  ];

  function resolveBuilding(lot, block, P) {
    const S = block.settings;
    const ov = (S.lots && S.lots[lot.key]) || {};
    const use = ov.use || S.use;
    lot.use = use;
    lot.parkType = ov.parkType || S.parkType || 'neighborhood';
    if (C.USES[use] && C.USES[use].open) return null;
    if (ov.bld === null) return null;
    const base = C.BLD_DEFAULT[use] || C.BLD_DEFAULT.res;
    const b = { ...base, ...(S.bld || {}), ...(ov.bld || {}) };
    // 획지에서 사용자가 직접 정한 층수(용적률 상한으로 낮추지 않고 법규검토에 알린다). floorsAuto는 도구가 정해 준 층수
    b.explicitFloors = !!(ov.bld && ov.bld.floors && !ov.bld.floorsAuto);
    delete b.floorsAuto;
    // 지우고 새로 지은 건물은 맞벽 불가: 옆·뒤 이격을 C.PARTY_MIN 이상으로
    if (b.noParty && !(b.side >= C.PARTY_MIN)) b.side = C.PARTY_MIN;
    // 깊이·길이를 직접(가구·획지에서) 정했는가: 용적률 맞춤이 그 값을 넘어 깊이를 늘리지 않게
    const set = (o) => !!(o && (o.depth != null || o.len > 0));
    b.shapeSet = set(ov.bld) || set(S.bld);
    const rnd = U.rng(U.hashStr(block.settings.id + lot.key));
    if (!(ov.bld && ov.bld.floors) && S.vary) {
      const f = b.floors;
      b.floors = Math.max(1, Math.round(f + (rnd() - 0.5) * 2 * S.vary * f));
    }
    const sp = C.STYLE_PRESETS[b.style] || C.STYLE_PRESETS.res_multi;
    const st = { ...sp };
    ['material', 'wallColor', 'wwr', 'win', 'ground', 'sign', 'canopy', 'roof'].forEach((k) => { if (b[k] !== undefined) st[k] = b[k]; });
    if (S.styleVary && !(ov.bld && (ov.bld.wallColor || ov.bld.material || ov.bld.style)) && !(S.bld && S.bld.wallColor)) {
      const pick = OLD_PALETTE[Math.floor(rnd() * OLD_PALETTE.length)];
      if (!(S.bld && S.bld.material)) st.material = pick[0];
      st.wallColor = pick[1];
    }
    // 이미지로 만든 재료: 계획에 정의가 있으면 그 차례(3D 텍스처의 층 번호)를, 없으면(지운 재료) 도장·스타코로
    if (typeof st.material === 'string' && st.material.indexOf('cm_') === 0) {
      const k = (P.mats || []).findIndex((m) => m.id === st.material);
      if (k < 0 || k >= C.CMAT_MAX) st.material = 'stucco'; else st.cm = k;
    }
    b.st = st;
    return b;
  }

  /* 건물 바닥을 직사각형으로: 모양 안에 드는 가장 큰 직사각형(축 u)이 넓이의 keep 이상을 지키면 그것으로 바꾼다.
     가각·회전교차로·정북방향 일조 이격·단지 안 길·물가에 비스듬히 잘린 모서리를 한쪽 변을 곧게 물려 없앤다(맞벽 건물은 획지 모양 그대로) */
  const SQC = new Map(); // 같은 모양을 여러 번(층수 고르기·건폐율 맞춤) 다듬지 않게
  function squareUp(fp, u, keep, anchor) {
    if (!fp || fp.length < 3) return fp;
    const g = U.cleanPoly(fp);
    if (g.length < 3) return fp;
    if (U.isRect(g, 0.004)) return g;
    const kp = keep || 0.75;
    const key = u[0].toFixed(4) + ',' + u[1].toFixed(4) + '|' + kp + (anchor ? 'a' : '') + '|' + g.map((q) => q[0].toFixed(3) + ',' + q[1].toFixed(3)).join(';');
    let res = SQC.get(key);
    if (res === undefined) {
      const A = Math.abs(U.polyArea(g));
      let r = anchor ? U.maxRectIn(g, u, 16, true) : null; // 도로 쪽 건축선(앞면)을 지키는 직사각형부터
      if (!r || r.area < kp * A || Math.min(r.w, r.h) < 3) r = U.maxRectIn(g, u);
      res = !r || r.area < kp * A || Math.min(r.w, r.h) < 3 ? null : r.pts;
      if (SQC.size > 6000) SQC.clear();
      SQC.set(key, res);
    }
    return res ? res.map((q) => q.slice()) : fp;
  }
  const rotU = (u, deg) => { if (!deg) return u; const a = (deg * Math.PI) / 180, c = Math.cos(a), s2 = Math.sin(a); return [u[0] * c - u[1] * s2, u[0] * s2 + u[1] * c]; };
  /* 건축 가능 범위: 접도 변과 가각은 건축선 후퇴, 나머지(인접 대지경계선)는 이격만큼 물린 모양. 맞벽이 아니면 가각 등에 깎인 모서리를
     곧게 다듬은 직사각형(도로 쪽 건축선을 지킴). 획지마다 한 번 셈 */
  function buildArea(lot, b) {
    const sqOn = !(b.side < 0.3), key = b.front + '|' + b.side + '|' + (sqOn ? 1 : 0);
    if (lot._fpKey !== key) {
      const n = lot.poly.length, frontK = frontSet(lot), d = [];
      for (let k = 0; k < n; k++) d.push(frontK.has(k) ? b.front : b.side);
      const off = U.offsetPoly(lot.poly, d);
      let fp = off ? U.cleanPoly(off.pts) : null;
      if (fp && fp.length >= 3) {
        if (U.polyArea(fp) < 0) fp = fp.slice().reverse();
        if (sqOn) fp = squareUp(fp, lotFrame(lot).u, 0.75, true);
      } else fp = null;
      lot._fpKey = key; lot._fp = fp;
    }
    return lot._fp ? lot._fp.map((q) => q.slice()) : null;
  }
  function buildFootprint(lot, b) {
    const n = lot.poly.length;
    let fp = buildArea(lot, b);
    if (!fp) return null;
    const main = lot.frontage.length ? lot.frontage.slice().sort((x, y) => y.len - x.len)[0] : null; // 가장 긴 접도 변
    if (b.depth > 0 && main) {
      const a = lot.poly[main.k], c = lot.poly[(main.k + 1) % n];
      const v = U.perpL(U.norm(U.sub(c, a)));
      const p0 = U.add(a, U.mul(v, b.front + b.depth));
      fp = U.clipHalfPlane(fp, p0, U.mul(v, -1));
    }
    /* 건물 길이(b.len): 도로를 따라 잰 길이. 획지 폭(후퇴·이격 뒤)보다 짧으면 가운데를 기준으로 양옆을 줄인다(b.align 'l'·'r'이면 그쪽 끝에 붙임) */
    if (b.len > 0 && main && fp.length >= 3) {
      const a = lot.poly[main.k], u = U.norm(U.sub(lot.poly[(main.k + 1) % n], a));
      let t0 = Infinity, t1 = -Infinity;
      fp.forEach((q) => { const t = U.dot(U.sub(q, a), u); t0 = Math.min(t0, t); t1 = Math.max(t1, t); });
      if (t1 - t0 > b.len + 0.05) {
        const s0 = b.align === 'l' ? t0 : b.align === 'r' ? t1 - b.len : (t0 + t1 - b.len) / 2;
        fp = U.clipHalfPlane(fp, U.add(a, U.mul(u, s0)), u);
        if (fp.length >= 3) fp = U.clipHalfPlane(fp, U.add(a, U.mul(u, s0 + b.len)), U.mul(u, -1));
      }
    }
    if (fp.length < 3 || Math.abs(U.polyArea(fp)) < 12) return null;
    if (U.polyArea(fp) < 0) fp = fp.slice().reverse();
    return fp;
  }

  /* 획지 안에서 건물 배치를 바꾼다: 좌우·앞뒤 뒤집기(건축 가능 범위의 가운데 축 기준), 제자리 회전(°), 옮김(획지 기준 [도로를 따라, 안쪽으로] m).
     돌려서 건축선 후퇴·이격 범위를 벗어나면 모양을 지킨 채 줄여 맞추고, 옮김은 범위 끝에서 멈춘다 */
  function lotFrame(lot) {
    const n = lot.poly.length, main = lot.frontage.length ? lot.frontage.slice().sort((x, y) => y.len - x.len)[0] : null;
    const a = main ? lot.poly[main.k] : lot.poly[0], c = main ? lot.poly[(main.k + 1) % n] : lot.poly[1 % n];
    const u = U.norm(U.sub(c, a));
    return { a, u, v: U.perpL(u) };
  }
  /* 획지 기준 좌표 ↔ 세계 좌표 */
  const toFrame = (fr, p) => { const d = U.sub(p, fr.a); return [U.dot(d, fr.u), U.dot(d, fr.v)]; };
  const fromFrame = (fr, q) => [fr.a[0] + fr.u[0] * q[0] + fr.v[0] * q[1], fr.a[1] + fr.u[1] * q[0] + fr.v[1] * q[1]];
  /* 다각형 P가 범위 area 안에 들어 있는지(변이 범위 경계를 가로지르지 않음) */
  function insideArea(P, area) {
    return P.every((q) => U.pointInPoly(q, area)) && !P.some((q, i) => { const q2 = P[(i + 1) % P.length]; return area.some((r, j) => U.segIntersect(q, q2, r, area[(j + 1) % area.length], 1e-7)); });
  }
  /* 범위를 벗어나면 모양을 지킨 채 줄여 넣는다. 범위 가운데 쪽으로 조금 옮기면 덜 줄어드는 자리를 고른다 */
  function fitInside(pts, area) {
    if (insideArea(pts, area)) return pts;
    const c = U.polyCentroid(pts), ca = U.polyCentroid(area);
    const at = (t, k) => { const o = [c[0] + (ca[0] - c[0]) * t, c[1] + (ca[1] - c[1]) * t]; return pts.map((q) => [o[0] + (q[0] - c[0]) * k, o[1] + (q[1] - c[1]) * k]); };
    let best = null, bk = -1;
    [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
      let lo = 0.2, hi = 1;
      if (insideArea(at(t, hi), area)) lo = hi;
      else for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (insideArea(at(t, m), area)) lo = m; else hi = m; }
      if (lo > bk + 0.01) { bk = lo; best = at(t, lo); }
    });
    return best || pts;
  }
  /* 용적률 맞춤의 목표(비율): b.fit이 'far'면 용도지역 상한 그대로(신도시 자동), {bcr, far, fmax}(%, 층)면 그 값을 용도지역 상한 안에서(가구 채우기) */
  function fitTargets(b, Z, use) {
    const fmax0 = C.fitFmax(b.style, use);
    if (b.fit === 'far') return { bcr: Z.bcr / 100, far: Z.far / 100, fmax: fmax0 };
    const o = b.fit;
    if (!o || typeof o !== 'object') return null;
    return { bcr: U.clamp(Math.min(+o.bcr || Z.bcr, Z.bcr), 5, 100) / 100, far: Math.max(10, Math.min(+o.far || Z.far, Z.far)) / 100, fmax: U.clamp(Math.round(+o.fmax || fmax0), 1, 80) };
  }
  /* 건폐율 상한에 맞춘 모양: 도로 쪽 건축선은 두고 안쪽(뒤)부터 깊이를 줄인다. 접도 변이 없으면 모양을 지킨 채 줄인다 */
  function fitBcr(lot, b, target, post) {
    const fr = lotFrame(lot), base = buildFootprint(lot, b);
    if (!base) return null;
    const fin = post || ((f) => xformBuilding(f, lot, b)); // 돌림·옮김(과 회전교차로·단지 안 길·일조 이격)까지 한 모양
    const mk = (d) => { const f = buildFootprint(lot, { ...b, depth: d }); return f ? fin(f) : null; };
    if (lot.frontage.length) {
      const D0 = Math.max(...base.map((q) => U.dot(U.sub(q, fr.a), fr.v))) - b.front;
      let lo = 0, hi = Math.max(0.5, D0), best = null;
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2, f = mk(m), A = f ? Math.abs(U.polyArea(f)) : 0; if (f && A <= target) { lo = m; best = f; } else hi = m; }
      if (best) return { fp: best, depth: lo }; // depth: 줄인 깊이(변 끌기가 보이는 모양에서 시작하도록)
    }
    const f = fin(base); if (!f) return null;
    const A = Math.abs(U.polyArea(f)), k = Math.sqrt(target / Math.max(A, 1e-6)), c = U.polyCentroid(f);
    return { fp: f.map((q) => [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k]), depth: null };
  }
  /* 정북방향 일조(건축법 시행령 제86조, 단순화): 전용·일반주거지역에서 높이 10m 이하는 1.5m, 넘으면 높이의 1/2 이상을
     북쪽을 향한 인접 대지경계선(도로에 접한 변이 아닌 변)에서 띄운다 */
  const SUN_ZONES = new Set(['r1x', 'r2x', 'r1', 'r2', 'r3']);
  const sunNeed = (h) => (h <= C.RULES.sun.h ? C.RULES.sun.near : h / 2);
  function northEdges(lot) {
    const n = lot.poly.length, frontK = frontSet(lot), out = []; // 도로 쪽(접도 변·가각)은 인접 대지경계선이 아니다
    for (let k = 0; k < n; k++) {
      if (frontK.has(k)) continue;
      const a = lot.poly[k], c = lot.poly[(k + 1) % n];
      if (U.dist(a, c) < 0.3) continue;
      const o = U.perpR(U.norm(U.sub(c, a)));
      if (o[1] >= 0.7) out.push({ a, c, o });
    }
    return out;
  }
  function northClip(fp, lot, d) {
    let g = fp;
    northEdges(lot).forEach((e) => { if (g && g.length >= 3) g = U.clipHalfPlane(g, U.add(e.a, U.mul(e.o, -d)), U.mul(e.o, -1)); });
    return g && g.length >= 3 && Math.abs(U.polyArea(g)) >= 12 ? g : null;
  }
  function northDist(fp, lot) {
    let worst = Infinity;
    northEdges(lot).forEach((e) => fp.forEach((p) => { worst = Math.min(worst, U.distPointSeg(p, e.a, e.c).d); }));
    return worst;
  }
  /* ---------- 단지 안 길과 건물 ----------
     길마다 중심선 조각과 피할 반폭(길 폭/2 + 띄울 거리). 건물 바닥이 띠에 걸리면 그 조각과 나란한 선에서 잘라 넓은 쪽을 남긴다(곡선은 조각마다) */
  function innerSegments(arms) {
    const out = [];
    arms.forEach((a) => {
      if (!a.road.inner || a.pts.length < 2) return;
      const hw = a.lay.W / 2 + C.innerGap(a.lay.hasCar);
      for (let i = 0; i + 1 < a.pts.length; i++) {
        const p = a.pts[i], q = a.pts[i + 1];
        if (U.dist(p, q) < 1e-3) continue;
        out.push({ a: p, b: q, hw, w2: a.lay.W / 2, x0: Math.min(p[0], q[0]) - hw, x1: Math.max(p[0], q[0]) + hw, y0: Math.min(p[1], q[1]) - hw, y1: Math.max(p[1], q[1]) + hw });
      }
    });
    return out;
  }
  function innerNear(segs, poly) {
    if (!segs.length) return segs;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    poly.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    return segs.filter((g) => g.x1 >= x0 && g.x0 <= x1 && g.y1 >= y0 && g.y0 <= y1);
  }
  /* ---------- 수공간 ----------
     대상지 안으로 잘라 낸 모양(poly), 하천은 둑(left·right)과 중심선 조각(건물이 피할 띠) */
  const WATER_GAP = 1.5; // 물가에서 건물까지(학습용 값)
  function polyDist(p, poly) { let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, U.distPointSeg(p, poly[i], poly[(i + 1) % poly.length]).d); return d; }
  /* 선을 다각형 안쪽 조각들로(다리 난간·대상지 안의 둑) */
  function clipLineIn(line, poly) {
    const out = []; let cur = null;
    const inside = (p) => U.pointInPoly(p, poly);
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], ts = [0, 1];
      for (let j = 0; j < poly.length; j++) { const X = U.segIntersect(a, b, poly[j], poly[(j + 1) % poly.length], 1e-9); if (X) ts.push(X.t); }
      ts.sort((x, y) => x - y);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k], t1 = ts[k + 1]; if (t1 - t0 < 1e-6) continue;
        const p0 = U.add(a, U.mul(U.sub(b, a), t0)), p1 = U.add(a, U.mul(U.sub(b, a), t1)), m = U.mid(p0, p1);
        if (inside(m)) { if (!cur) { cur = [p0]; out.push(cur); } cur.push(p1); } else cur = null;
      }
    }
    return out.filter((l) => U.polylineLength(l) > 0.3);
  }
  /* 수공간은 대상지 밖까지 그려도 된다(하천이 대상지 옆이나 바깥을 지나는 경우). 모양은 자르지 않고, 건물·나무가 피하는 것은 대상지 안에서만 의미가 있다.
     하천: depth(지면에서 수면까지, m) · park(천변공원 한쪽 폭, m. 0이면 없음) */
  Dv.RIVER_DEPTH = 2.5;
  function waterShapes(P) {
    const M = UDS.Model;
    return (P.waters || []).map((w) => {
      const g = M.waterShape(w); if (!g || !g.poly || g.poly.length < 3) return null;
      let poly = g.poly; if (U.polyArea(poly) < 0) poly = poly.slice().reverse();
      if (Math.abs(U.polyArea(poly)) < 1) return null;
      const out = { id: w.id, kind: w.kind, poly, area: Math.abs(U.polyArea(poly)), src: w };
      let pad = 0;
      if (w.kind === 'river') {
        out.banks = [g.left, g.right];
        out.center = g.center; out.hw = Math.max(0.5, (+w.w || 12) / 2);
        out.depth = w.depth === undefined || w.depth === null ? Dv.RIVER_DEPTH : U.clamp(+w.depth || 0, 0, 20);
        const park = U.clamp(+w.park || 0, 0, 80);
        out.park = park;
        if (park > 0) {
          // 천변공원: 양쪽 둑에서 park만큼의 녹지, 물가 가까이 산책로, 바깥 가장자리에 가로수 한 줄
          const side = (sg) => { const a = U.offsetPolyline(g.center, sg * out.hw), b = U.offsetPolyline(g.center, sg * (out.hw + park)); let q = a.concat(b.slice().reverse()); if (U.polyArea(q) < 0) q = q.reverse(); return q; };
          const pw = U.clamp(park * 0.25, 2, 4), po = Math.min(park / 2, 1.5 + pw / 2);
          out.parkStrips = [side(1), side(-1)];
          out.parkPaths = [U.offsetPolyline(g.center, out.hw + po), U.offsetPolyline(g.center, -(out.hw + po))];
          out.parkPathW = pw;
          out.parkTreeLines = park >= 6 ? [U.offsetPolyline(g.center, out.hw + park - 1.8), U.offsetPolyline(g.center, -(out.hw + park - 1.8))] : [];
        }
        pad = park;
        out.segs = [];
        for (let i = 0; i + 1 < g.center.length; i++) {
          const a = g.center[i], b = g.center[i + 1], hw = out.hw + park + WATER_GAP;
          if (U.dist(a, b) > 1e-3) out.segs.push({ a, b, hw, x0: Math.min(a[0], b[0]) - hw, x1: Math.max(a[0], b[0]) + hw, y0: Math.min(a[1], b[1]) - hw, y1: Math.max(a[1], b[1]) + hw });
        }
      }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      poly.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
      Object.assign(out, { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad, c: [(x0 + x1) / 2, (y0 + y1) / 2] });
      return out;
    }).filter(Boolean);
  }
  /* 다리: 도로·길의 양쪽 가장자리가 물 위를 지나는 구간(난간). 물 위를 지나는 길이도 함께 */
  function bridgesOver(arms, waters) {
    const out = [];
    if (!waters.length) return out;
    arms.forEach((a) => {
      if (a.pts.length < 2) return;
      const hw = a.lay.W / 2;
      waters.forEach((w) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        a.pts.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
        if (x1 + hw < w.x0 || x0 - hw > w.x1 || y1 + hw < w.y0 || y0 - hw > w.y1) return;
        const ext = (l) => { // 다리 끝을 물가 너머로 조금(교대) 늘린다
          if (l.length < 2) return l;
          const d0 = U.norm(U.sub(l[0], l[1])), d1 = U.norm(U.sub(l[l.length - 1], l[l.length - 2]));
          return [U.add(l[0], U.mul(d0, 1.5))].concat(l, [U.add(l[l.length - 1], U.mul(d1, 1.5))]);
        };
        const rails = [U.offsetPolyline(a.pts, hw), U.offsetPolyline(a.pts, -hw)].map((l) => clipLineIn(l, w.poly)).reduce((p, q) => p.concat(q), []).map(ext);
        if (!rails.length) return;
        const span = clipLineIn(a.pts, w.poly).reduce((s2, l) => s2 + U.polylineLength(l), 0);
        out.push({ roadId: a.road.id, waterId: w.id, rails, span, W: a.lay.W, inner: !!a.road.inner });
      });
    });
    return out;
  }
  function waterNear(waters, poly) {
    if (!waters.length) return waters;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    poly.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    const m = WATER_GAP + 0.5;
    return waters.filter((w) => w.x1 + m >= x0 && w.x0 - m <= x1 && w.y1 + m >= y0 && w.y0 - m <= y1);
  }
  /* 건물이 물(물가 WATER_GAP 포함)을 피하게: 하천은 중심선 조각마다(단지 안 길과 같은 방식), 연못은 물과 건물을 가르는 직선 하나로 잘라 건물 쪽을 남긴다 */
  function avoidWater(fp, waters, lot) {
    let g = fp;
    for (const w of waters) {
      if (!g) return null;
      if (w.kind === 'river') { g = avoidInner(g, w.segs); continue; }
      const touch = g.some((p) => U.pointInPoly(p, w.poly) || polyDist(p, w.poly) < WATER_GAP) || w.poly.some((p) => U.pointInPoly(p, g)) ||
        g.some((p, i) => { const q = g[(i + 1) % g.length]; return w.poly.some((r, j) => U.segIntersect(p, q, r, w.poly[(j + 1) % w.poly.length], 1e-9)); });
      if (!touch) continue;
      const cg = U.polyCentroid(g), cw = U.polyCentroid(w.poly);
      let n = U.sub(cg, cw);
      if (U.len(n) < 0.5) { const fr = lotFrame(lot); n = U.mul(fr.v, -1); } // 물이 건물 한가운데면 도로 쪽을 남긴다
      n = U.norm(n);
      const s0 = Math.max(...w.poly.map((p) => U.dot(p, n))) + WATER_GAP;
      g = U.clipHalfPlane(g, U.mul(n, s0), n);
      if (!g || g.length < 3) return null;
    }
    return g && g.length >= 3 && Math.abs(U.polyArea(g)) >= 20 ? g : null;
  }
  function avoidInner(fp, segs) {
    let g = fp, bx = null;
    const box = () => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; g.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); return [x0, y0, x1, y1]; };
    for (const s of segs) {
      if (!g || g.length < 3) return null;
      if (!bx) bx = box();
      if (s.x1 < bx[0] || s.x0 > bx[2] || s.y1 < bx[1] || s.y0 > bx[3]) continue; // 띠의 둘레 상자가 건물과 떨어져 있으면 건너뛴다
      // 띠(조각에서 hw 안)에 바닥이 걸리는가: 꼭짓점이 띠 안이거나, 조각이 바닥 변과 만나거나 바닥 안을 지남
      const hit = g.some((p) => U.distPointSeg(p, s.a, s.b).d < s.hw - 1e-6) || U.pointInPoly(s.a, g) || U.pointInPoly(s.b, g) ||
        g.some((p, i) => { const q = g[(i + 1) % g.length]; return U.segIntersect(p, q, s.a, s.b, 1e-9) || U.distPointSeg(s.a, p, q).d < s.hw - 1e-6 || U.distPointSeg(s.b, p, q).d < s.hw - 1e-6; });
      if (!hit) continue;
      const d = U.norm(U.sub(s.b, s.a)), n = U.perpL(d);
      const L = U.clipHalfPlane(g, U.add(s.a, U.mul(n, s.hw)), n), R = U.clipHalfPlane(g, U.sub(s.a, U.mul(n, s.hw)), U.mul(n, -1));
      const aL = L && L.length >= 3 ? Math.abs(U.polyArea(L)) : 0, aR = R && R.length >= 3 ? Math.abs(U.polyArea(R)) : 0;
      g = aL >= aR ? (aL > 0 ? L : null) : R;
      bx = null;
    }
    return g && g.length >= 3 && Math.abs(U.polyArea(g)) >= 20 ? g : null;
  }
  /* 획지 꼭짓점(반시계 방향)과 변마다 띄울 거리: 접도 변은 0, 나머지(인접 대지경계선)는 gap */
  function lotGaps(lot, gap) {
    let lp = lot.poly; const n = lp.length, rev = U.polyArea(lp) < 0;
    const frontK = new Set(Array.from(frontSet(lot)).map((k) => (rev ? (2 * n - 2 - k) % n : k)));
    if (rev) lp = lp.slice().reverse();
    return { lp, d: lp.map((q, k) => (frontK.has(k) ? 0 : gap || 0)) };
  }
  /* 직접 그린 건물이 들어갈 범위: 획지(경계에 붙여 그린 변이 걸리지 않게 5cm 넉넉히). gap이면 인접 대지경계선에서 그만큼 띄운 범위(맞벽 불가) */
  function lotRoom(lot, gap) {
    const { lp, d } = lotGaps(lot, gap);
    const off = U.offsetPoly(lp, d.map((x) => (x > 0 ? x : 0) - 0.05));
    return off ? U.cleanPoly(off.pts) : lp;
  }
  /* 직접 그린 건물: b.poly는 획지 기준 좌표([도로를 따라, 안쪽으로] m). 획지를 넘는 부분은 잘라 내고,
     새로 그린 건물(b.noParty)은 인접 대지경계선에서 C.PARTY_MIN 안쪽도 잘라 낸다 */
  function customFootprint(lot, b) {
    const fr = lotFrame(lot);
    let fp = b.poly.map((q) => fromFrame(fr, q));
    if (U.polyArea(fp) < 0) fp = fp.slice().reverse();
    const gap = b.noParty ? C.PARTY_MIN : 0, { lp, d: gaps } = lotGaps(lot, gap);
    if (!insideArea(fp, lotRoom(lot, gap))) {
      for (let i = 0; i < lp.length && fp.length >= 3; i++) {
        const a = lp[i], c = lp[(i + 1) % lp.length], d = U.sub(c, a), L = U.len(d);
        if (L > 1e-9) { const nIn = U.perpL(U.mul(d, 1 / L)); fp = U.clipHalfPlane(fp, U.add(a, U.mul(nIn, gaps[i])), nIn); }
      }
    }
    fp = U.cleanPoly(fp);
    if (fp.length < 3 || Math.abs(U.polyArea(fp)) < 4) return null;
    if (U.polyArea(fp) < 0) fp = fp.slice().reverse();
    return fp;
  }
  function xformBuilding(fp, lot, b) {
    const rot = +b.rot || 0, fu = !!b.flipU, fv = !!b.flipV, sh = Array.isArray(b.shift) ? b.shift : null;
    if (!rot && !fu && !fv && !(sh && (sh[0] || sh[1]))) return fp;
    const n = lot.poly.length, frontK = frontSet(lot);
    const off = U.offsetPoly(lot.poly, lot.poly.map((q, k) => (frontK.has(k) ? b.front : b.side) - 0.06)); // 건축 가능 범위(조금 넉넉히)
    const area = off ? U.cleanPoly(off.pts) : lot.poly;
    const { u, v } = lotFrame(lot);
    const inside = (P) => P.every((q) => U.pointInPoly(q, area)) && !P.some((q, i) => { const q2 = P[(i + 1) % P.length]; return area.some((r, j) => U.segIntersect(q, q2, r, area[(j + 1) % area.length], 1e-7)); });
    let pts = fp.map((q) => q.slice());
    if (fu || fv) {
      const ca = U.polyCentroid(area);
      pts = pts.map((q) => { let du = U.dot(U.sub(q, ca), u), dv = U.dot(U.sub(q, ca), v); if (fu) du = -du; if (fv) dv = -dv; return U.add(ca, U.add(U.mul(u, du), U.mul(v, dv))); });
      if (fu !== fv) pts.reverse();
      if (!inside(pts)) { const c0 = U.polyCentroid(fp), c1 = U.polyCentroid(pts); pts = fp.map((q) => U.add(q, U.sub(c1, c0))); if (fu !== fv) { pts = pts.map((q) => { const d = U.sub(q, c1); let du = U.dot(d, u), dv = U.dot(d, v); if (fu) du = -du; if (fv) dv = -dv; return U.add(c1, U.add(U.mul(u, du), U.mul(v, dv))); }).reverse(); } }
    }
    if (rot) {
      const c = U.polyCentroid(pts), a = (rot * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
      pts = pts.map((q) => { const x = q[0] - c[0], y = q[1] - c[1]; return [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]; });
      if (!inside(pts)) { // 모양을 지킨 채 줄여 맞춘다. 범위 가운데 쪽으로 조금 옮기면 덜 줄어드는 자리를 고른다
        const ca = U.polyCentroid(area), rp = pts;
        const at = (t, k) => { const o = [c[0] + (ca[0] - c[0]) * t, c[1] + (ca[1] - c[1]) * t]; return rp.map((q) => [o[0] + (q[0] - c[0]) * k, o[1] + (q[1] - c[1]) * k]); };
        let best = null, bk = -1;
        [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
          let lo = 0.2, hi = 1;
          if (inside(at(t, hi))) lo = hi;
          else for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (inside(at(t, m))) lo = m; else hi = m; }
          if (lo > bk + 0.01) { bk = lo; best = at(t, lo); }
        });
        pts = best;
      }
    }
    if (sh && (sh[0] || sh[1])) { // 도로를 따라 먼저, 그다음 안쪽으로: 범위 끝에 닿으면 그 축만 멈춘다(벽을 따라 미끄러지듯)
      const mv = (P, d, k) => P.map((q) => [q[0] + d[0] * k, q[1] + d[1] * k]);
      const slide = (P, d) => {
        if (!(Math.abs(d[0]) + Math.abs(d[1]) > 1e-6)) return P;
        if (inside(mv(P, d, 1))) return mv(P, d, 1);
        let lo = 0, hi = 1; for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (inside(mv(P, d, m))) lo = m; else hi = m; }
        return mv(P, d, lo);
      };
      pts = slide(pts, U.mul(u, +sh[0] || 0));
      pts = slide(pts, U.mul(v, +sh[1] || 0));
    }
    pts = pts.map((q) => [U.round(q[0], 3), U.round(q[1], 3)]);
    if (U.polyArea(pts) < 0) pts.reverse();
    return pts;
  }
  Dv.lotFrame = lotFrame;
  Dv.buildFootprint = buildFootprint;
  Dv.xformBuilding = xformBuilding;
  Dv.customFootprint = customFootprint;
  Dv.insideArea = insideArea;
  Dv.fitInside = fitInside;
  Dv.lotRoom = lotRoom;
  Dv.toFrame = toFrame;
  Dv.fromFrame = fromFrame;

  /* ---------- 단지(한 획지에 여러 동) ----------
     공동주택 단지는 판상형 주동을 동서로 길게(남향) 줄지어, 캠퍼스는 가운데 마당 둘레에 동을 앉힌다(C.CX).
     용적률 목표(용도지역 상한)를 채우는 가장 적은 층수를 고르고, 동 길이를 같은 비율로 줄여 건폐율·용적률을 넘지 않게 맞춘다.
     주거지역은 정북방향 일조 이격까지 지키고, 회전교차로·단지 안 길·수공간은 동마다 피한다(post) */
  function complexLayout(lot, b, Z, post) {
    const kind = b.cx === 'campus' ? 'campus' : 'apt', K = C.CX[kind];
    const mr = U.minRect(lot.poly);
    if (!(lot.area >= C.CX_MIN.area) || !mr || mr.b < C.CX_MIN.side) return null;
    const area0 = buildArea(lot, { ...b, side: Math.max(0.3, b.side || 0) });
    if (!area0) return null;
    const fr = lotFrame(lot);
    // 동의 긴 축: 공동주택은 동서(남향 배치), 캠퍼스는 획지 축(가장 긴 접도 변)
    const ax = kind === 'apt' ? [fr.u, fr.v, U.mul(fr.u, -1), U.mul(fr.v, -1)].reduce((m, c) => (c[0] > m[0] ? c : m)) : fr.u, ay = U.perpL(ax);
    const sunZ = !!lot.zone && SUN_ZONES.has(lot.zone), pil = b.st.ground === 'pilotis';
    const hOf = (nf) => b.groundH + Math.max(0, nf - 1) * b.floorH;
    const regionOf = (nf) => { let A = area0; if (sunZ) A = northClip(A, lot, sunNeed(hOf(nf))); return A ? U.maxRectIn(A, ax) : null; };
    const dep = U.clamp(b.depth > 0 ? b.depth : K.depth, 8, 30);
    // 배치는 R(ax·ay 방향 m) 위의 사각형 [x, y, 가로, 세로, 긴 축]
    const layApt = (R, nf) => {
      const D = Math.max(K.rowMin, K.rowK * hOf(nf)); // 마주 보는 두 동 사이
      if (R.h < dep || R.w < 20) return null;
      const m = Math.max(1, Math.floor((R.h + D) / (dep + D)));
      let k = Math.max(1, Math.round((R.w + K.gapSide) / (K.slab + K.gapSide)));
      while ((R.w - (k - 1) * K.gapSide) / k > K.slabMax) k++;
      const L = (R.w - (k - 1) * K.gapSide) / k;
      if (L < 15) return null;
      const gy = m > 1 ? (R.h - m * dep) / (m - 1) : 0, rects = [];
      for (let i = 0; i < m; i++) { const y0 = m > 1 ? i * (dep + gy) : (R.h - dep) / 2; for (let j = 0; j < k; j++) rects.push([j * (L + K.gapSide), y0, L, dep, 'x']); }
      return { rects, rows: m, perRow: k, D, gy: m > 1 ? gy : null };
    };
    const layCampus = (R) => {
      const rects = [];
      const barX = (y0) => { if (R.w > 120) { const L = (R.w - K.gate) / 2; rects.push([0, y0, L, dep, 'x'], [L + K.gate, y0, L, dep, 'x']); } else rects.push([0, y0, R.w, dep, 'x']); };
      const barY = (x0) => { if (R.h > 120) { const L = (R.h - K.gate) / 2; rects.push([x0, 0, dep, L, 'y'], [x0, L + K.gate, dep, L, 'y']); } else rects.push([x0, 0, dep, R.h, 'y']); };
      if (R.w >= 2 * dep + 20 && R.h >= 2 * dep + 20) { // 마당 둘레: 남·북 동과 동·서 날개(모서리는 통로)
        barX(0); barX(R.h - dep);
        const sl = R.h - 2 * dep - 2 * K.gap;
        if (sl >= 15) rects.push([0, dep + K.gap, dep, sl, 'y'], [R.w - dep, dep + K.gap, dep, sl, 'y']);
        return { rects, rows: null, perRow: null, D: null, gy: R.h - 2 * dep };
      }
      // 좁으면 마주 보는 두 줄 사이를 마당으로
      if (R.h >= 2 * dep + 12 && R.w >= 30) { barX(0); barX(R.h - dep); return { rects, rows: null, perRow: null, D: null, gy: R.h - 2 * dep }; }
      if (R.w >= 2 * dep + 12 && R.h >= 30) { barY(0); barY(R.w - dep); return { rects, rows: null, perRow: null, D: null, gy: R.w - 2 * dep }; }
      return null;
    };
    const F = Z ? (b.fit && !b.explicitFloors ? fitTargets(b, Z, lot.use) : null) || { bcr: Z.bcr / 100, far: Z.far / 100, fmax: C.fitFmax(b.style, lot.use) } : null;
    const G = F ? F.far * lot.area : Infinity, cap = F ? F.bcr * lot.area : Infinity;
    const evalN = (n) => { // n: 바닥면적에 드는 층수(필로티면 한 층 더 높음)
      const nf = n + (pil ? 1 : 0), R = regionOf(nf);
      if (!R) return null;
      const lay = kind === 'apt' ? layApt(R, nf) : layCampus(R);
      if (!lay) return null;
      const A0 = lay.rects.reduce((a, r) => a + r[2] * r[3], 0), A = Math.min(A0, cap);
      return { n, nf, R, lay, A0, A, v: n * A };
    };
    let ch = null;
    if (b.explicitFloors || !F) ch = evalN(Math.max(1, b.floors - (pil ? 1 : 0)));
    else {
      let best = null;
      for (let n = Math.max(1, K.minF - (pil ? 1 : 0)); n <= F.fmax; n++) {
        const e = evalN(n); if (!e) continue;
        if (!best || e.v > best.v + 1e-6) best = e;
        if (e.v >= G * 0.9995) { ch = e; ch.hit = true; break; }
      }
      if (!ch) ch = best;
    }
    if (!ch) return null;
    const s = Math.min(1, (ch.hit ? Math.min(ch.A, G / ch.n) : ch.A) / ch.A0) * (1 - 1e-6); // 동 길이를 같은 비율로(상한을 조금도 넘지 않게)
    const o = ch.R.pts[0], W = (x, y) => [o[0] + ax[0] * x + ay[0] * y, o[1] + ax[1] * x + ay[1] * y];
    const list = [];
    ch.lay.rects.forEach(([x, y, w, h, lg]) => {
      let x0 = x, y0 = y, ww = w, hh = h;
      if (s < 1) { if (lg === 'x') { x0 = x + (w * (1 - s)) / 2; ww = w * s; } else { y0 = y + (h * (1 - s)) / 2; hh = h * s; } }
      if (ww < 6 || hh < 6) return;
      const g = post([W(x0, y0), W(x0 + ww, y0), W(x0 + ww, y0 + hh), W(x0, y0 + hh)]);
      if (g) list.push(g);
    });
    if (list.length < 2) return null;
    return { kind, list, floors: ch.nf, rows: ch.lay.rows, perRow: ch.lay.perRow, D: ch.lay.D, gy: ch.lay.gy, F, capped: !!F && !b.explicitFloors && !ch.hit };
  }
  function gableInfo(fp) {
    if (fp.length !== 4) return null;
    const L = (i) => U.dist(fp[i], fp[(i + 1) % 4]);
    // 짧은 변 쌍
    const shortPair = L(0) + L(2) < L(1) + L(3) ? [0, 2] : [1, 3];
    const i0 = shortPair[0], i1 = shortPair[1];
    const R1 = U.mid(fp[i0], fp[(i0 + 1) % 4]);
    const R2 = U.mid(fp[i1], fp[(i1 + 1) % 4]);
    const halfD = Math.min(L(i0), L(i1)) / 2;
    if (U.dist(R1, R2) < 2 || halfD < 1.5) return null;
    return { i0, i1, R1, R2, rise: Math.min(halfD * Math.tan((28 * Math.PI) / 180), 4.5) };
  }

  /* ---------- 공원 내부 ---------- */
  function parkContents(lot, D, seedStr) {
    const rnd = U.rng(U.hashStr(seedStr));
    const poly = lot.poly;
    const area = Math.abs(U.polyArea(poly));
    const type = lot.use === 'park' ? lot.parkType : lot.use;
    const inner = (d) => { const o = U.offsetPoly(poly, poly.map(() => d)); return o ? o.pts : null; };
    const avoid = [];
    const addTree = (p, sp, kind) => D.trees.push({ x: p[0], y: p[1], species: sp, kind: kind || 'park' });
    const bb = U.polyBounds(poly);
    const scatter = (spacing, keepOut, sp, prob) => {
      for (let x = bb.minx + spacing / 2; x < bb.maxx; x += spacing) {
        for (let y = bb.miny + spacing / 2; y < bb.maxy; y += spacing) {
          const p = [x + (rnd() - 0.5) * spacing * 0.6, y + (rnd() - 0.5) * spacing * 0.6];
          if (!U.pointInPoly(p, poly)) continue;
          if (keepOut && keepOut(p)) continue;
          if (rnd() > (prob || 1)) continue;
          addTree(p, sp[Math.floor(rnd() * sp.length)]);
        }
      }
    };
    if (lot.use === 'parking') {
      const fr = lot.frontage[0];
      const k = fr ? fr.k : 0;
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const F = U.frameFromEdge(poly, a, b);
      for (let v = F.vmin + 5.5; v < F.vmax - 0.5; v += 11) {
        for (let u = F.umin + 1; u + 2.5 < F.umax - 1; u += 2.5) {
          const p = U.fromFrame(F, u, v), q = U.fromFrame(F, u, v + 5);
          if (U.pointInPoly(p, poly) && U.pointInPoly(q, poly)) D.parkFeat.push({ type: 'stall', pts: [p, q] });
        }
      }
      return;
    }
    if (lot.use === 'vacant') { D.parkFeat.push({ type: 'vacant', poly }); return; }
    if (lot.use === 'green') { scatter(6, null, ['zelkova', 'pine', 'chionanthus'], 0.9); return; }
    if (lot.use === 'plaza') {
      D.parkFeat.push({ type: 'plaza', poly });
      const ring = inner(3);
      if (ring) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const L = U.dist(a, b);
        for (let s = 4; s < L - 2; s += 8) addTree(U.add(a, U.mul(U.norm(U.sub(b, a)), s)), 'zelkova');
      }
      return;
    }
    // 공원
    if (type === 'children') {
      const c = U.interiorPoint(poly);
      const r = Math.max(4, Math.min(Math.sqrt(area) * 0.22, 12));
      const play = U.arcPoints(c, r, 0, Math.PI * 2 - 0.01, 28);
      D.parkFeat.push({ type: 'play', poly: play });
      const ring = inner(3);
      if (ring) {
        D.parkFeat.push({ type: 'path', pts: ring.concat([ring[0]]), w: 2.0 });
        const r2 = inner(1.4);
        if (r2) for (let i = 0; i < r2.length; i++) {
          const a = r2[i], b = r2[(i + 1) % r2.length];
          const L = U.dist(a, b);
          for (let s = 3; s < L - 2; s += 7) addTree(U.add(a, U.mul(U.norm(U.sub(b, a)), s)), 'chionanthus');
        }
      }
      D.furniture.push({ id: 'auto', type: 'bench', x: c[0] + r + 2.5, y: c[1], rot: Math.PI / 2, auto: true });
      return;
    }
    if (type === 'pocket') {
      D.parkFeat.push({ type: 'plaza', poly });
      scatter(9, null, ['cherry', 'chionanthus'], 0.7);
      const c = U.interiorPoint(poly);
      D.furniture.push({ id: 'auto', type: 'bench', x: c[0], y: c[1], rot: 0, auto: true });
      return;
    }
    // 근린공원: 순환 산책로 + 중앙 잔디 + 수목
    const ring = inner(Math.min(8, Math.sqrt(area) * 0.08));
    if (ring) D.parkFeat.push({ type: 'path', pts: ring.concat([ring[0]]), w: 3.0 });
    const c = U.interiorPoint(poly);
    const lawnR = Math.min(Math.sqrt(area) * 0.18, 26);
    const lawn = U.arcPoints(c, lawnR, 0, Math.PI * 2 - 0.01, 36);
    D.parkFeat.push({ type: 'lawn', poly: lawn });
    // 십자 산책로
    const bbx = U.polyBounds(poly);
    const cross1 = [[bbx.minx, c[1]], [bbx.maxx, c[1]]], cross2 = [[c[0], bbx.miny], [c[0], bbx.maxy]];
    [cross1, cross2].forEach((ln) => {
      const pts = [];
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const p = [U.lerp(ln[0][0], ln[1][0], t), U.lerp(ln[0][1], ln[1][1], t)];
        if (U.pointInPoly(p, poly) && U.dist(p, c) > lawnR) pts.push(p);
        else if (pts.length) { D.parkFeat.push({ type: 'path', pts: pts.splice(0), w: 2.5 }); }
      }
      if (pts.length > 1) D.parkFeat.push({ type: 'path', pts, w: 2.5 });
    });
    const nearPath = (p) => {
      if (U.dist(p, c) < lawnR + 3) return true;
      if (Math.abs(p[0] - c[0]) < 3.5 || Math.abs(p[1] - c[1]) < 3.5) return true;
      if (ring) { for (let i = 0; i < ring.length; i++) if (U.distPointSeg(p, ring[i], ring[(i + 1) % ring.length]).d < 3.5) return true; }
      return false;
    };
    scatter(9, nearPath, ['zelkova', 'pine', 'cherry', 'chionanthus'], 0.85);
    if (ring) {
      let acc = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const L = U.dist(a, b), dir = U.norm(U.sub(b, a));
        for (let s = 12; s < L - 6; s += 28) {
          const p = U.add(U.add(a, U.mul(dir, s)), U.mul(U.perpL(dir), 2.4));
          D.furniture.push({ id: 'auto', type: 'bench', x: p[0], y: p[1], rot: Math.atan2(dir[1], dir[0]), auto: true });
        }
        acc += L;
      }
    }
  }

  function addObs(D, roadId, side, what, w) {
    if (D.obstructions.some((o) => o.roadId === roadId && o.side === side && o.what === what)) return;
    D.obstructions.push({ roadId, side, what, w });
  }

  /* ---------- 가로수·가로등·전주 ---------- */
  function streetObjects(arm, D) {
    const r = arm.road, L = arm.lay;
    const pts = arm.pts;
    const s0 = arm.trim.start.box + 6, s1 = arm.len - arm.trim.end.box - 6;
    if (s1 - s0 < 2) return;
    const sides = [
      { name: 'L', bands: L.bands.filter((b) => b.oR >= -1e-6) },
      { name: 'R', bands: L.bands.filter((b) => b.oL <= 1e-6) },
    ];
    sides.forEach((side, si) => {
      // 연석에 가장 가까운 식재 구간
      const zones = side.bands.filter((b) => b.def.treeZone);
      let zone = null;
      if (zones.length) zone = si === 0 ? zones[zones.length - 1] : zones[0];
      const walk = side.bands.filter((b) => b.seg.type === 'sidewalk');
      const sw = walk.length ? (si === 0 ? walk[walk.length - 1] : walk[0]) : null;
      let treeOff = null, obstruct = false;
      if (zone) treeOff = zone.oC;
      else if (sw && L.hasCar) { treeOff = si === 0 ? sw.oR + 0.7 : sw.oL - 0.7; obstruct = true; }
      if (r.trees && r.trees.on && treeOff !== null) {
        const sp = Math.max(4, r.trees.spacing || 8);
        for (let s = s0; s <= s1; s += sp) {
          const q = U.pointAlong(pts, s);
          const p = U.add(q.p, U.mul(U.perpL(q.dir), treeOff));
          D.trees.push({ x: p[0], y: p[1], species: r.trees.species || 'zelkova', kind: 'street', roadId: r.id });
        }
        if (obstruct) addObs(D, r.id, side.name, '가로수', 1.2);
      }
      if (r.lights && r.lights.on && L.hasCar) {
        const sp = Math.max(10, r.lights.spacing || 25);
        const off = zone ? zone.oC : sw ? (si === 0 ? sw.oR + 0.4 : sw.oL - 0.4) : null;
        if (off !== null) {
          const ph = si === 0 ? 0 : sp / 2;
          for (let s = s0 + ph + 3; s <= s1; s += sp) {
            const q = U.pointAlong(pts, s);
            const p = U.add(q.p, U.mul(U.perpL(q.dir), off));
            D.lights.push({ x: p[0], y: p[1], h: 9, roadId: r.id, dir: si === 0 ? -1 : 1, ang: Math.atan2(q.dir[1], q.dir[0]) });
          }
        }
      }
    });
    if (r.overhead && L.hasCar) {
      const swR = L.bands.filter((b) => b.seg.type === 'sidewalk' && b.oL <= 1e-6);
      const off = swR.length ? swR[0].oL - 0.35 : L.curbR - 0.35;
      const list = [];
      for (let s = arm.trim.start.box + 3; s <= arm.len - arm.trim.end.box - 3 + 0.01; s += 32) {
        const q = U.pointAlong(pts, s);
        const p = U.add(q.p, U.mul(U.perpL(q.dir), off));
        D.poles.push({ x: p[0], y: p[1], roadId: r.id });
        list.push(p);
      }
      for (let i = 1; i < list.length; i++) D.wires.push([list[i - 1], list[i]]);
      const zR = L.bands.filter((b) => b.oL <= 1e-6 && b.def.treeZone);
      if (!zR.length) addObs(D, r.id, 'R', '전주', 0.5);
    }
  }

  /* ---------- 메인 ---------- */
  /* 획지 lot(poly·frontage)에 설정 b(front·side·depth·len)로 세운 건물의 바닥 모양. 자동 채우기가 건폐율을 맞출 때 쓴다 */
  Dv.footprint = function (lot, b) { return buildFootprint(lot, { front: 0, side: 0, depth: 0, len: 0, ...b }); };

  Dv.derive = function (P, prevD) {
    const D = {
      site: P.site, arms: [], nodes: [], fillets: [], rabs: [], rabCand: [], blocks: [], lots: [], buildings: [],
      trees: [], lights: [], poles: [], wires: [], furniture: [], utils: [], parkFeat: [],
      obstructions: [], checks: [], metrics: {}, roadInfo: new Map(), deadEnds: [],
    };
    const ptsOf = cornerPts(P);
    const graph = buildGraph(P, ptsOf);
    const { faces } = extractFaces(graph.nodes, graph.edges.filter((e) => !(e.road && e.road.inner))); // 단지 안 길은 가구를 나누지 않는다
    const arms = buildArms(P, graph, ptsOf);
    const corners = computeCorners(graph, arms, P.rabouts, P.site);
    spaceCrosswalks(arms);
    D.fillets = corners.fillets;
    D.nodes = corners.nodeInfo;
    D.rabs = corners.rabs;
    D.rabCand = corners.rabCand;
    arms.forEach((a) => { a.geo = buildArmGeometry(a); });
    D.arms = arms;

    P.roads.forEach((r) => {
      const lay = Dv.layout(r);
      D.roadInfo.set(r.id, { road: r, lay, cls: r.inner ? (C.FN[r.fn] || { name: '단지 안 길' }).name : C.classify(lay.W), len: U.polylineLength(r.pts), arms: arms.filter((a) => a.road === r) }); // 단지 안 길은 도시계획시설 규모 대신 종류
    });

    // 막다른 도로 끝(대상지 경계가 아닌 차수 1 노드). 회전교차로(회차 공간)를 둔 끝은 빼낸다
    corners.at.forEach((list, nid) => {
      if (list.length !== 1 || D.rabs.some((r) => r.node === nid)) return;
      const p = graph.nodes[nid].p;
      const onB = p[0] < 0.5 || p[1] < 0.5 || p[0] > P.site.w - 0.5 || p[1] > P.site.h - 0.5;
      if (!onB && !list[0].arm.road.inner) D.deadEnds.push({ p, roadId: list[0].arm.road.id }); // 단지 안 길은 다른 길과 만나지 않아도 된다
    });

    // 가구
    const rawBlocks = buildBlocks(P, faces);
    const used = new Set();
    const matched = rawBlocks.map((rb) => {
      const poly0 = rb.edges.map((e) => e.a);
      const S = P.blocks.find((s) => !used.has(s.id) && U.pointInPoly(s.seed, poly0));
      if (S) used.add(S.id);
      return { rb, poly0, S };
    });
    matched.forEach((m) => {
      if (m.S) return;
      const c = U.interiorPoint(m.poly0);
      // 가구가 새로 나뉘었으면 원래 가구의 설정을 물려받는다
      let S = P.blocks.find((s) => !used.has(s.id) && U.pointInPoly(s.seed, m.rb.face.pts));
      if (!S && prevD && prevD.blocks) {
        const pb = prevD.blocks.find((b) => U.pointInPoly(c, b.poly));
        if (pb) { S = U.clone(pb.settings); S.id = U.uid('b'); S.lots = {}; S.merges = []; S.splits = {}; P.blocks.push(S); }
      }
      if (!S) { S = UDS.Model.newBlock(c, { use: P.meta.defaultUse || 'res' }); if (S.use === 'vacant') S.auto = true; P.blocks.push(S); }
      used.add(S.id);
      m.S = S;
    });
    matched.forEach(({ rb, S }) => {
      let edges = chamferBlock(rb.edges, S);
      // 회전교차로 둘레(보도 바깥 원)에 걸친 가구 모서리는 원호로 덜어 낸다
      D.rabs.forEach((rab) => { if (edges) edges = cutDisc(edges, rab.c, rab.R2); });
      if (!edges || edges.length < 3 || Math.abs(U.polyArea(edges.map((e) => e.a))) < 30) return;
      const poly = edges.map((e) => e.a);
      S.seed = U.interiorPoint(poly).map((v) => U.round(v, 2));
      const mr = U.minRect(poly);
      /* 획지 수 자동(S.auto): 빈 대상지에서 도로를 그려 생긴 가구는 크기에 맞춰 획지 수를 정한다(도로변 약 24m 간격, 깊이 44m 이상이면 2열).
         획지에 손을 댔으면(용도·건물·합치기·나누기) 그때의 수로 굳힌다 */
      if (S.auto) {
        if (Object.keys(S.lots || {}).length || (S.merges && S.merges.length) || (S.splits && Object.keys(S.splits).length)) delete S.auto;
        else if (!edges.some((e) => e.roadId)) { S.lotsAlong = 1; S.lotRows = 1; } // 도로가 하나도 닿지 않은 터(빈 대상지 전체)는 통째로 한 획지
        else if (mr) { S.lotsAlong = U.clamp(Math.round(mr.a / 24), 1, 12); S.lotRows = mr.b >= 44 ? 2 : 1; }
      }
      D.blocks.push({ id: S.id, settings: S, edges, poly, area: U.polyArea(poly), dims: mr ? { long: mr.a, short: mr.b } : null, roads: Array.from(new Set(edges.filter((e) => e.roadId).map((e) => e.roadId))) });
    });
    P.blocks = P.blocks.filter((s) => used.has(s.id));

    // 수공간(조경): 모양(대상지 밖은 잘라 냄)과 건물이 피할 장애물
    D.waters = waterShapes(P);
    D.bridges = bridgesOver(arms, D.waters);
    // 획지·건축물
    const innerSegs = innerSegments(arms);
    D.innerSegs = innerSegs;
    D.blocks.forEach((blk) => {
      const lots = subdivide(blk);
      lots.forEach((l) => {
        const lot = { id: blk.id + ':' + l.key, key: l.key, blockId: blk.id, poly: l.poly, area: U.polyArea(l.poly), cell: l.cell };
        if (l.sub) lot.sub = l.sub;
        lot.frontage = lotFrontage(lot, blk);
        lot.cornerK = lotCorners(lot, blk);
        const b = resolveBuilding(lot, blk, P);
        D.lots.push(lot);
        if (C.USES[lot.use] && C.USES[lot.use].open) parkContents(lot, D, lot.id);
        if (!b) return;
        const custom = Array.isArray(b.poly) && b.poly.length >= 3; // 직접 그린 건물(돌림·뒤집기·옮김은 모양에 이미 들어 있음)
        // 바닥 모양을 다듬는 차례: 돌림·옮김 → 회전교차로 피하기 → 단지 안 길 피하기(이 획지 가까이 지나는 길만)
        const near = innerNear(innerSegs, lot.poly), wNear = waterNear(D.waters, lot.poly);
        const sq = !custom && !(b.side < 0.3), bu = sq ? rotU(lotFrame(lot).u, +b.rot || 0) : null; // 직사각형으로 다듬을 축(돌린 건물은 돈 축)
        const sqr = (g) => (g && sq ? squareUp(g, bu, 0.7) : g);
        const post = (f) => {
          if (!f) return null;
          let g = custom ? f : xformBuilding(f, lot, b);
          g = avoidRabs(g, D.rabs, b.front);
          const n0 = g ? g.length : 0, a0 = g ? Math.abs(U.polyArea(g)) : 0;
          if (g && near.length) g = avoidInner(g, near);
          if (g && wNear.length) g = avoidWater(g, wNear, lot);
          if (!g || g.length < 3 || Math.abs(U.polyArea(g)) < 12) return null;
          g = sqr(g);
          // 길·물을 피해 잘린 건물이 가는 띠만 남으면(폭 4m 미만) 세우지 않는다
          if ((near.length || wNear.length) && (g.length !== n0 || Math.abs(Math.abs(U.polyArea(g)) - a0) > 0.01)) { const mr = U.minRect(g); if (mr && mr.b < 4) return null; }
          return g;
        };
        // 건물 하나를 D.buildings에 올린다(단지는 동마다). 건폐율·용적률은 o.bcr·o.far(단지 전체)가 있으면 그 값
        const addB = (fp, area, o) => {
          const pil0 = b.st.ground === 'pilotis', Z = o.Z;
          const H = b.groundH + Math.max(0, b.floors - 1) * b.floorH;
          const st = b.st, gable = st.roof === 'gable' ? gableInfo(fp) : null, gfaFloors = pil0 ? Math.max(0, b.floors - 1) : b.floors;
          // 실제 건축선 후퇴(옮기거나 돌린 건물은 기본값과 다를 수 있음): 가장 긴 접도 변에서 건물까지
          const fr = lotFrame(lot), frontEff = lot.frontage.length ? Math.max(0, Math.min(...fp.map((q) => U.dot(U.sub(q, fr.a), fr.v)))) : b.front;
          const frontEdges = [];
          for (let k = 0; k < fp.length; k++) {
            const a = fp[k], c = fp[(k + 1) % fp.length];
            const m = U.mid(a, c), nOut = U.perpR(U.norm(U.sub(c, a)));
            const probe = U.add(m, U.mul(nOut, frontEff + 0.6));
            if (lot.frontage.some((f) => U.distPointSeg(probe, lot.poly[f.k], lot.poly[(f.k + 1) % lot.poly.length]).d < 0.9 || !U.pointInPoly(probe, lot.poly) && U.distPointSeg(m, lot.poly[f.k], lot.poly[(f.k + 1) % lot.poly.length]).d < frontEff + 0.8)) frontEdges.push(k);
          }
          const nb = {
            frontEdges,
            id: o.id || lot.id, lotId: lot.id, blockId: blk.id, fp, area, floors: b.floors, groundH: b.groundH, floorH: b.floorH,
            h: H, st, gable, front: b.front, frontEff: U.round(frontEff, 2), side: b.side, use: lot.use, cfg: b,
            xf: !custom && !!(b.rot || b.flipU || b.flipV || (Array.isArray(b.shift) && (b.shift[0] || b.shift[1]))), custom,
            gfa: area * gfaFloors, bcr: o.bcr != null ? o.bcr : area / lot.area, far: o.far != null ? o.far : (area * gfaFloors) / lot.area,
            zone: o.zk, bcrMax: Z ? Z.bcr / 100 : null, farMax: Z ? Z.far / 100 : null, bcrFit: !!o.bcrFit, bcrDepth: o.bcrDepth != null ? o.bcrDepth : null, floorsSet: o.floorsSet || null, fitFar: o.fitFar || null,
          };
          if (o.cx) nb.cx = o.cx;
          nb.over = { bcr: !!Z && nb.bcr > nb.bcrMax + 0.0005, far: !!Z && nb.far > nb.farMax + 0.0005 };
          D.buildings.push(nb);
          return nb;
        };
        // 단지(한 획지에 여러 동): 넓은 획지면 동을 줄지어 앉히고, 좁으면 아래에서 한 동으로 짓는다
        if (b.cx && !custom) {
          const zk = C.zoneOf(lot.use, blk.settings.zone), Z = zk ? C.ZONES[zk] : null;
          lot.zone = zk;
          const cx = complexLayout(lot, b, Z, post);
          if (cx) {
            b.floors = cx.floors;
            const pil0 = b.st.ground === 'pilotis', gfaF = pil0 ? Math.max(0, b.floors - 1) : b.floors;
            const tot = cx.list.reduce((a, f) => a + U.polyArea(f), 0), bcr = tot / lot.area, far = (tot * gfaF) / lot.area;
            const fitFar = cx.F ? { far: cx.F.far, bcr: cx.F.bcr, fmax: cx.F.fmax, capped: cx.capped, mode: b.fit === 'far' || !b.fit ? 'zone' : 'fill' } : null;
            const info = { kind: cx.kind, n: cx.list.length, rows: cx.rows, perRow: cx.perRow, D: cx.D, gy: cx.gy };
            lot.buildings = cx.list.map((g, k) => addB(g, U.polyArea(g), { zk, Z, bcr, far, fitFar, cx: { ...info, k }, id: k ? lot.id + '#' + k : lot.id }));
            lot.building = lot.buildings[0];
            lot.cx = { ...info, area: tot, gfa: tot * gfaF, bcr, far, floors: b.floors, h: lot.building.h };
            return;
          }
        }
        const raw = custom ? customFootprint(lot, b) : buildFootprint(lot, b);
        let fp = post(raw);
        if (!fp) return;
        let area = U.polyArea(fp);
        // 용도지역의 건폐율·용적률 상한(서울특별시 도시계획 조례 제54·55조, 용적률은 800%까지). 매개변수로 지은 건물은 안쪽부터 깊이를 줄여 건폐율을 맞추고,
        // 도구가 정한 층수는 용적률 상한까지 낮춘다. 직접 그린 모양·직접 정한 층수는 그대로 두고 법규검토에 알린다
        const zk = C.zoneOf(lot.use, blk.settings.zone), Z = zk ? C.ZONES[zk] : null;
        lot.zone = zk;
        let bcrFit = false, bcrDepth = null, fitFar = null;
        const pil = b.st.ground === 'pilotis';
        const F = Z && b.fit && !b.explicitFloors ? fitTargets(b, Z, lot.use) : null;
        if (F) {
          /* 용적률 맞춤(신도시 자동 · 가구 채우기): 층수 n마다 지을 수 있는 가장 큰 바닥(건폐율 상한·후퇴·이격·깊이, 주거지역은 정북방향 일조 이격까지)을 구해
             목표 연면적을 채우는 가장 적은 n을 고르고, 그 층수에서 목표 연면적만큼(=건폐율이 가장 큰 바닥) 안쪽부터 깊이를 줄인다.
             채울 수 없으면(최고 층수·일조) 연면적이 가장 큰 층수와 바닥으로 짓는다 */
          const G = F.far * lot.area, cap = F.bcr * lot.area, sunZ = SUN_ZONES.has(zk);
          const hOf = (nf) => b.groundH + Math.max(0, nf - 1) * b.floorH;
          const postN = (nf) => (sunZ ? (f) => { const g = post(f); return g ? sqr(northClip(g, lot, sunNeed(hOf(nf)))) : null; } : post);
          if (!custom) {
            const scan = (bb, rw) => {
              const g1 = post(rw);
              let pick = null, best = null;
              for (let n = 1; n <= F.fmax; n++) {
                const g = sunZ ? postN(n + (pil ? 1 : 0))(rw) : g1, A = g ? Math.abs(U.polyArea(g)) : 0, Fc = Math.min(cap, A);
                if (!best || n * Fc > best.v + 1e-6) best = { n, v: n * Fc, Fc };
                if (Fc > 0 && n * Fc >= G * 0.9995) { pick = { n, Fc }; break; }
                if (!sunZ && n >= Math.ceil(G / Math.max(Fc, 1e-6))) break; // 일조 제한이 없으면 바닥이 층수와 상관없으니 더 볼 것 없음
              }
              return { bb, rw, pick, best };
            };
            let sc = scan(b, raw);
            // 유형의 기본 깊이로는 목표를 채우지 못하면(최고 층수에 걸림) 깊이를 획지 끝까지 열어 건폐율을 더 확보한다
            if (!sc.pick && b.depth > 0 && !b.shapeSet) { const b2 = { ...b, depth: 0 }, s2 = scan(b2, buildFootprint(lot, b2)); if (s2.pick || (s2.best && (!sc.best || s2.best.v > sc.best.v + 1))) sc = s2; }
            const ch = sc.pick || sc.best;
            if (!ch || !(ch.Fc > 0)) return;
            const bb = sc.bb, nf = ch.n + (pil ? 1 : 0), pf = postN(nf), target = Math.min(sc.pick ? G / ch.n : ch.Fc, ch.Fc); // 상한을 조금도 넘지 않게
            const g0 = pf(sc.rw);
            if (!g0) return;
            fp = g0; area = U.polyArea(fp);
            if (area > target * (1 + 1e-6)) {
              const r2 = fitBcr(lot, bb, target, pf);
              if (r2 && r2.fp && r2.fp.length >= 3) { fp = r2.fp; area = U.polyArea(fp); bcrFit = true; bcrDepth = r2.depth; }
            }
            b.floors = nf;
            fitFar = { far: F.far, bcr: F.bcr, fmax: F.fmax, capped: !sc.pick, sun: sunZ && !sc.pick && ch.n < F.fmax, mode: b.fit === 'far' ? 'zone' : 'fill' };
          } else {
            // 직접 그린 모양은 그대로 두고 층수만: 용적률을 넘지 않는 가장 높은 층수(주거지역은 정북방향 일조 이격이 허락하는 높이까지)
            let n = U.clamp(Math.floor(G / Math.max(area, 1) + 1e-6), 1, F.fmax);
            if (sunZ) { const dN = northDist(fp, lot); while (n > 1 && sunNeed(hOf(n + (pil ? 1 : 0))) > dN + 1e-6) n--; }
            b.floors = n + (pil ? 1 : 0);
            fitFar = { far: F.far, bcr: F.bcr, fmax: F.fmax, capped: n * area < G * 0.995, mode: b.fit === 'far' ? 'zone' : 'fill' };
          }
        } else {
          if (Z && !custom && area > (Z.bcr / 100) * lot.area * 1.0005) {
            const r2 = fitBcr(lot, b, (Z.bcr / 100) * lot.area, post);
            if (r2 && r2.fp && r2.fp.length >= 3) { fp = r2.fp; area = U.polyArea(fp); bcrFit = true; bcrDepth = r2.depth; }
          }
        }
        let floorsSet = null;
        if (Z && !F && !b.explicitFloors && area > 1) {
          const maxF = Math.max(1, Math.floor(((Z.far / 100) * lot.area) / area + 1e-6) + (pil ? 1 : 0));
          if (b.floors > maxF) { floorsSet = b.floors; b.floors = maxF; }
        }
        lot.building = addB(fp, area, { zk, Z, bcrFit, bcrDepth, floorsSet, fitFar });
      });
    });

    arms.forEach((a) => streetObjects(a, D));
    // 회전교차로: 중앙섬 수목과 둘레 가로등
    D.rabs.forEach((rab) => {
      const c = rab.c;
      if (rab.Ra >= 2.2) D.trees.push({ x: c[0], y: c[1], species: rab.Ra >= 6 ? 'zelkova' : 'chionanthus', kind: 'rab', rabId: rab.id });
      if (rab.Ra >= 8) {
        const rr = rab.Ra * 0.66, n = Math.max(5, Math.floor((Math.PI * 2 * rr) / 7));
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + 0.3; D.trees.push({ x: c[0] + Math.cos(a) * rr, y: c[1] + Math.sin(a) * rr, species: 'cherry', kind: 'rab', rabId: rab.id }); }
      }
      const lit = rab.arms;
      const ends = [];
      arms.forEach((a) => ['start', 'end'].forEach((e) => { if (a.trim[e].rab === rab) { const k = a.pts.length - 1; const d = e === 'start' ? U.sub(a.pts[1], a.pts[0]) : U.sub(a.pts[k - 1], a.pts[k]); ends.push(ang(d)); } }));
      ends.sort((x, y) => x - y);
      ends.forEach((a0, i) => {
        let a1 = ends[(i + 1) % ends.length]; while (a1 <= a0) a1 += Math.PI * 2;
        if (lit < 2 || a1 - a0 < 0.6) return;
        const am = (a0 + a1) / 2, rr = rab.R + 0.7;
        D.lights.push({ x: c[0] + Math.cos(am) * rr, y: c[1] + Math.sin(am) * rr, h: 9, roadId: null, rabId: rab.id, dir: 1, ang: am + Math.PI / 2 });
      });
    });

    // 천변공원 가로수: 녹지 바깥 가장자리를 따라 9m 간격(도로·단지 안 길 위는 아래에서 빠진다)
    D.waters.forEach((w) => (w.parkTreeLines || []).forEach((ln) => {
      const L = U.polylineLength(ln);
      for (let s2 = 4; s2 < L - 2; s2 += 9) {
        const q = U.pointAlong(ln, s2).p;
        if (D.arms.some((a) => a.geo.bands.some((bp) => U.pointInPoly(q, bp.poly)))) continue; // 다리·도로 위(대상지 밖 하천에도 심는다)
        D.trees.push({ x: q[0], y: q[1], species: 'zelkova', kind: 'park' });
      }
    }));
    // 만들어진 수목(가로수·공원·회전교차로)은 자리로 이름을 붙여 하나씩 고르고 지우거나 수종을 바꿀 수 있게 한다
    const off = new Set(P.treeOff || []), sp = P.treeSp || {};
    // 단지 안 길 위에 걸린 가로수·공원 나무·가로등은 빼낸다(길 폭/2 + 0.6m 안)
    const onInner = (x, y) => innerSegs.some((g) => x >= g.x0 - 1 && x <= g.x1 + 1 && y >= g.y0 - 1 && y <= g.y1 + 1 && U.distPointSeg([x, y], g.a, g.b).d < g.w2 + 1.2);
    if (innerSegs.length) D.lights = D.lights.filter((l) => !onInner(l.x, l.y));
    // 물 위의 가로수·공원 나무·가로등도 빼낸다(다리 위 가로등은 둔다)
    const inWater = (x, y) => D.waters.some((w) => x >= w.x0 - 1 && x <= w.x1 + 1 && y >= w.y0 - 1 && y <= w.y1 + 1 && (U.pointInPoly([x, y], w.poly) || polyDist([x, y], w.poly) < 0.8));
    if (D.waters.length) {
      D.lights = D.lights.filter((l) => !inWater(l.x, l.y) || D.bridges.some((g) => g.roadId === l.roadId));
      D.furniture = D.furniture.filter((f) => !f.auto || !inWater(f.x, f.y)); // 공원 벤치 같은 자동 시설물
    }
    if (innerSegs.length) D.furniture = D.furniture.filter((f) => !f.auto || !onInner(f.x, f.y));
    D.trees = D.trees.filter((t) => {
      if (innerSegs.length && t.kind !== 'rab' && onInner(t.x, t.y)) return false;
      if (D.waters.length && t.kind !== 'free' && inWater(t.x, t.y)) return false;
      if (t.kind !== 'rab' && D.rabs.some((rb) => (t.x - rb.c[0]) ** 2 + (t.y - rb.c[1]) ** 2 < (rb.R2 + 0.6) ** 2)) return false; // 회전교차로 자리에 걸린 나무
      t.key = Dv.treeKey(t.x, t.y);
      if (off.has(t.key)) return false;
      if (sp[t.key] && C.TREES[sp[t.key]]) { t.species0 = t.species; t.species = sp[t.key]; }
      return true;
    });
    // 자유 배치 요소
    P.objects.forEach((o) => {
      if (o.type === 'tree') D.trees.push({ x: o.x, y: o.y, species: o.species || 'zelkova', kind: 'free', id: o.id });
      else D.furniture.push({ ...o });
    });

    // 지하시설
    P.roads.forEach((r) => {
      (r.utils || []).forEach((u) => {
        const pts = U.offsetPolyline(r.pts, u.off);
        const mh = [];
        if (['sewer', 'storm', 'combined'].includes(u.type)) {
          const L = U.polylineLength(pts);
          for (let s = 15; s < L - 5; s += 40) mh.push(U.pointAlong(pts, s).p);
        }
        D.utils.push({ roadId: r.id, id: u.id, type: u.type, pts, depth: u.depth, dia: u.dia, mh });
      });
    });

    computeMetrics(P, D);
    computeChecks(P, D);
    return D;
  };

  /* 가로 단면 위치(도로 r의 거리 s)에서 좌·우 인접 획지와 건물 */
  Dv.sectionContext = function (P, D, roadId, s) {
    const info = D.roadInfo.get(roadId);
    if (!info) return null;
    const r = info.road;
    const len = info.len;
    const q = U.pointAlong(r.pts, U.clamp(s, 0, len));
    const n = U.perpL(q.dir);
    const out = { p: q.p, dir: q.dir, n, W: info.lay.W, sides: { L: null, R: null } };
    const best = { L: Infinity, R: Infinity };
    D.lots.forEach((lot) => {
      lot.frontage.forEach((f) => {
        if (f.roadId !== roadId) return;
        const a = lot.poly[f.k], b = lot.poly[(f.k + 1) % lot.poly.length];
        const ps = U.distPointSeg(q.p, a, b);
        const side = U.dot(U.sub(ps.q, q.p), n) >= 0 ? 'L' : 'R';
        const along = Math.abs(U.dot(U.sub(ps.q, q.p), q.dir));
        const score = along * 4 + ps.d;
        if (score < best[side]) {
          best[side] = score;
          // 단지(여러 동)는 단면선에 가장 가까운 동, 후퇴는 그 동에서 이 접도 변까지
          const many = lot.buildings && lot.buildings.length > 1;
          const bld = many ? lot.buildings.reduce((m, x) => { const d = polyDist(q.p, x.fp); return !m || d < m.d ? { b: x, d } : m; }, null).b : lot.building || null;
          const sb = !bld ? 0 : many ? Math.max(0, Math.min(...bld.fp.map((v) => U.distPointSeg(v, a, b).d))) : bld.frontEff !== undefined ? bld.frontEff : bld.front;
          out.sides[side] = { lot, use: lot.use, parkType: lot.parkType, building: bld, setback: sb, h: bld ? bld.h : 0, direct: along < 0.5 };
        }
      });
    });
    // 단지 안 길: 접도한 획지가 없으므로 단면선을 양쪽으로 뻗어 처음 만나는 건물과 그 자리의 획지를 쓴다
    if (r.inner) ['L', 'R'].forEach((side) => {
      if (out.sides[side]) return;
      const dir = side === 'L' ? n : U.mul(n, -1), far = 60, p1 = U.add(q.p, U.mul(dir, far));
      const p0 = U.add(q.p, U.mul(dir, info.lay.W / 2 + 0.3));
      let bld = null, bt = Infinity;
      D.buildings.forEach((b) => { for (let i = 0; i < b.fp.length; i++) { const X = U.segIntersect(q.p, p1, b.fp[i], b.fp[(i + 1) % b.fp.length], 1e-9); if (X && X.t < bt) { bt = X.t; bld = b; } } });
      const lot = D.lots.find((l) => U.pointInPoly(p0, l.poly)) || (bld ? D.lots.find((l) => l.id === bld.lotId) : null);
      if (!lot && !bld) return;
      out.sides[side] = { lot, use: lot ? lot.use : bld.use, parkType: lot ? lot.parkType : null, building: bld, setback: bld ? Math.max(0, bt * far - info.lay.W / 2) : 0, h: bld ? bld.h : 0, direct: true };
    });
    if (D.ctxData && D.ctxV && UDS.Ctx) UDS.Ctx.sectionSides(out, D.ctxData, D.ctxV); // 실제 지역: 빈 획지 쪽의 현황 건물
    const hs = ['L', 'R'].map((k) => out.sides[k] && out.sides[k].building ? out.sides[k].h : null).filter((v) => v !== null);
    out.Dist = out.W + ['L', 'R'].reduce((a, k) => a + (out.sides[k] && out.sides[k].building ? out.sides[k].setback : 0), 0);
    out.Hmean = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;
    out.DH = out.Hmean ? out.Dist / out.Hmean : null;
    return out;
  };

  function computeMetrics(P, D) {
    const site = P.site.w * P.site.h;
    const blockArea = D.blocks.reduce((s, b) => s + b.area, 0);
    const lotArea = D.lots.reduce((s, l) => s + l.area, 0);
    const bldLots = D.lots.filter((l) => !(C.USES[l.use] && C.USES[l.use].open));
    const bldLotArea = bldLots.reduce((s, l) => s + l.area, 0);
    const fpArea = D.buildings.reduce((s, b) => s + b.area, 0);
    const gfa = D.buildings.reduce((s, b) => s + b.gfa, 0);
    const parkArea = D.lots.filter((l) => ['park', 'plaza', 'green'].includes(l.use)).reduce((s, l) => s + l.area, 0);
    const resGfa = D.buildings.reduce((s, b) => {
      if (b.use === 'res') return s + b.gfa;
      if (b.use === 'mixed') return s + b.gfa * Math.max(0, (b.floors - 1) / b.floors);
      return s;
    }, 0);
    const pop = resGfa / (P.settings.m2PerPerson || 35);
    const byUse = {};
    D.lots.forEach((l) => { byUse[l.use] = (byUse[l.use] || 0) + l.area; });
    D.metrics = {
      site, roadArea: site - blockArea, roadRatio: (site - blockArea) / site,
      blocks: D.blocks.length, lots: D.lots.length, buildings: D.buildings.length,
      lotArea, bldLotArea, fpArea, gfa,
      bcr: bldLotArea ? fpArea / bldLotArea : 0, far: bldLotArea ? gfa / bldLotArea : 0,
      grossFar: gfa / site, parkArea, parkRatio: parkArea / site, pop, parkPerCap: pop > 0 ? parkArea / pop : null,
      trees: D.trees.filter((t) => t.x >= 0 && t.y >= 0 && t.x <= P.site.w && t.y <= P.site.h).length, streetTrees: D.trees.filter((t) => t.kind === 'street').length, byUse, // 대상지 안 나무만 센다
      maxH: D.buildings.reduce((m, b) => Math.max(m, b.h), 0),
    };
  }

  function computeChecks(P, D) {
    const ck = D.checks;
    // 같은 종류의 항목을 패널에서 묶어 보여 주기 위한 분류 이름
    const KIND = [
      [/^정북방향 이격/, '정북방향 일조 이격 부족'], [/^보도 유효폭/, '보도 유효폭 부족'], [/^차로폭/, '차로폭 부족'],
      [/^자전거도로 폭/, '자전거도로 폭 부족'], [/^노상주차 폭/, '노상주차 폭 부족'], [/^보행자전용도로 폭/, '보행자전용도로 폭 부족'],
      [/가로수 생육 공간이 좁음$/, '가로수 생육 공간 협소'], [/^연석 높이/, '연석 높이 초과'], [/^전주·가공선/, '전주·가공선(지중화 검토)'],
      [/도로 폭 밖에 놓임$/, '도로 폭 밖에 놓인 관로'], [/관로 간 여유 부족/, '관로 간 이격 부족'], [/가로수 뿌리 공간과 겹침/, '관로와 가로수 뿌리 공간 겹침'],
      [/^합류식 하수관/, '합류식 하수관(분류식 정비 검토)'], [/^막다른 도로 끝/, '막다른 도로'], [/^가구 .*보다 큼$/, '가구 규모 초과'],
      [/맹지/, '도로에 접하지 않은 획지'], [/^공원 접도/, '공원 접도 부족'], [/규모 기준/, '공원 규모 미달'],
      [/^회전교차로가 이웃/, '회전교차로 겹침'], [/^건폐율 .*초과/, '건폐율 초과'], [/^용적률 .*초과/, '용적률 초과'], [/용적률 상한에 맞춰/, '용적률 상한에 맞춰 층수 조정'],
    ];
    const add = (level, target, msg, ref) => { const k = KIND.find((q) => q[0].test(msg)); ck.push({ level, target, msg, ref, kind: k ? k[1] : null }); };
    P.roads.forEach((r) => {
      const info = D.roadInfo.get(r.id);
      const L = info.lay;
      const local = r.fn === 'local';
      const laneMin = C.RULES.lane(r.speed || 50);
      L.bands.forEach((b) => {
        const t = b.seg.type, w = b.seg.w;
        if (t === 'sidewalk') {
          const side = b.oR >= -1e-6 ? 'L' : 'R';
          const obs = D.obstructions.filter((o) => o.roadId === r.id && o.side === side).reduce((s, o) => s + o.w, 0);
          const eff = w - obs;
          const obsTxt = obs ? ` (장애물 ${U.fmt(obs, 1)}m 제외 유효폭)` : '';
          if (eff < C.RULES.sidewalk.minEx - 1e-6) add('error', { type: 'road', id: r.id, seg: b.seg.id }, `보도 유효폭 ${U.fmt(eff, 2)}m${obsTxt} — 최소 2.0m(예외 1.5m)에 못 미침`, C.RULES.sidewalk.ref);
          else if (eff < C.RULES.sidewalk.min - 1e-6) add(local ? 'info' : 'warn', { type: 'road', id: r.id, seg: b.seg.id }, `보도 유효폭 ${U.fmt(eff, 2)}m${obsTxt} — 2.0m 미만(국지도로 불가피 시 1.5m)`, C.RULES.sidewalk.ref);
        } else if (t === 'lane' || t === 'bus') {
          if (w < laneMin - 1e-6) add('warn', { type: 'road', id: r.id, seg: b.seg.id }, `차로폭 ${U.fmt(w, 2)}m — 설계속도 ${r.speed}km/h 기준 ${U.fmt(laneMin, 2)}m 이상`, C.RULES.laneRef);
        } else if (t === 'biketrack' || t === 'bikelane') {
          if (w < C.RULES.bike.minEx - 1e-6) add('error', { type: 'road', id: r.id, seg: b.seg.id }, `자전거도로 폭 ${U.fmt(w, 2)}m — 1.5m(부득이 1.2m) 이상`, C.RULES.bike.ref);
          else if (w < C.RULES.bike.min - 1e-6) add('warn', { type: 'road', id: r.id, seg: b.seg.id }, `자전거도로 폭 ${U.fmt(w, 2)}m — 1.5m 미만(부득이한 경우만 1.2m)`, C.RULES.bike.ref);
        } else if (t === 'parking') {
          if (w < C.RULES.parking.min - 1e-6) add('warn', { type: 'road', id: r.id, seg: b.seg.id }, `노상주차 폭 ${U.fmt(w, 2)}m — 평행주차 2.0m 이상`, C.RULES.parking.ref);
        } else if (t === 'pedestrian') {
          if (w < C.RULES.ped.min - 1e-6) add('warn', { type: 'road', id: r.id, seg: b.seg.id }, `보행자전용도로 폭 ${U.fmt(w, 2)}m — 1.5m 이상`, C.RULES.ped.ref);
        } else if (b.def.treeZone && r.trees && r.trees.on && w < 1.0 - 1e-6) {
          add('info', { type: 'road', id: r.id, seg: b.seg.id }, `${b.def.name} 폭 ${U.fmt(w, 2)}m — 가로수 생육 공간이 좁음`, '체크리스트 8');
        }
      });
      if (L.hasCar && r.curbH > C.RULES.curbH.max + 1e-6) add('warn', { type: 'road', id: r.id }, `연석 높이 ${U.fmt(r.curbH * 100, 0)}cm — 25cm 이하`, C.RULES.curbH.ref);
      if (r.overhead) add('info', { type: 'road', id: r.id }, '전주·가공선 — 지중화하면 보도 유효폭과 가로 경관을 확보할 수 있음([지중화하기])', '체크리스트 5');
    });
    // 회전교차로끼리 겹침(둘레 보도 기준)
    (D.rabs || []).forEach((a, i) => D.rabs.slice(i + 1).forEach((b) => {
      const d = U.dist(a.c, b.c);
      if (d < a.R2 + b.R2 - 0.5) add('warn', { type: 'rab', id: a.id }, `회전교차로가 이웃 회전교차로와 겹침 — 중심 간 ${U.fmt(d, 0)}m, ${U.fmt(a.R2 + b.R2, 0)}m 이상 띄우거나 지름을 줄이세요`, '회전교차로 설계지침');
    }));
    // 지하시설(학습용 간이 기준 — 법정 수치 아님)
    P.roads.forEach((r) => {
      const info = D.roadInfo.get(r.id);
      const L = info.lay;
      const us = r.utils || [];
      for (let i = 0; i < us.length; i++) {
        const a = us[i];
        if (Math.abs(a.off) > L.W / 2 + 1e-6) add('warn', { type: 'road', id: r.id, util: a.id }, `${C.UTIL[a.type].name}이 도로 폭 밖에 놓임`, '체크리스트 5');
        for (let j = i + 1; j < us.length; j++) {
          const b = us[j];
          const gap = Math.hypot(a.off - b.off, a.depth - b.depth) - (a.dia + b.dia) / 2;
          if (gap < 0.3) add('info', { type: 'road', id: r.id, util: a.id }, `${C.UTIL[a.type].name}–${C.UTIL[b.type].name} 이격 ${U.fmt(Math.max(0, gap), 2)}m — 관로 간 여유 부족(학습용 기준 0.3m)`, '체크리스트 5');
        }
      }
      if (r.trees && r.trees.on) {
        L.bands.filter((b) => b.def.treeZone).forEach((b) => {
          us.forEach((u) => {
            if (Math.abs(u.off - b.oC) < 1.0 && u.depth < 1.5) add('info', { type: 'road', id: r.id, util: u.id }, `${C.UTIL[u.type].name}이 가로수 뿌리 공간과 겹침(식재대 중심에서 1m 이내·깊이 1.5m 미만, 학습용 기준)`, '체크리스트 5·8');
          });
        });
      }
      if (us.some((u) => u.type === 'combined')) add('info', { type: 'road', id: r.id }, '합류식 하수관 — 오수·우수를 분리하는 분류식 정비 검토', '체크리스트 5');
    });
    D.deadEnds.forEach((d) => add('warn', { type: 'road', id: d.roadId }, '막다른 도로 끝 — 가구가 만들어지지 않음. 다른 도로에 연결', '체크리스트 2·3'));
    D.blocks.forEach((b) => {
      if (!b.dims || (C.USES[b.settings.use] && C.USES[b.settings.use].open)) return;
      const R = C.RULES.block;
      const locals = b.roads.map((id) => P.roads.find((r) => r.id === id)).filter((r) => r && (r.fn === 'local' || r.fn === 'shared'));
      if (!locals.length) return;
      if (b.dims.long > R.longMax * 1.15 || b.dims.short > R.shortMax * 1.25)
        add('info', { type: 'block', id: b.id }, `가구 ${U.fmt0(b.dims.long)}×${U.fmt0(b.dims.short)}m — 국지도로 가구 기준(90~150×25~60m 내외)보다 큼`, R.ref);
    });
    D.lots.forEach((l) => {
      if (!l.frontage.length && !(C.USES[l.use] && C.USES[l.use].open)) add('warn', { type: 'lot', id: l.id }, '도로에 접하지 않은 획지(맹지)', '건축법 제44조(대지와 도로의 관계)');
      if (l.use === 'park') {
        const roads = new Set(l.frontage.map((f) => f.k));
        if (roads.size < 3) add('info', { type: 'lot', id: l.id }, `공원 접도 ${roads.size}면 — 원칙적으로 3면 이상 도로에 접하도록`, C.RULES.parkRoads.ref);
        const pt = C.PARK_TYPES[l.parkType];
        if (pt && pt.min && l.area < pt.min) add('info', { type: 'lot', id: l.id }, `${pt.name} ${U.fmt0(l.area)}㎡ — 규모 기준 ${U.fmt0(pt.min)}㎡ 이상`, '공원녹지법 시행규칙 별표 3');
      }
    });
    // 용도지역의 건폐율·용적률 상한(서울특별시 도시계획 조례 제54·55조, 용적률은 800%까지)
    // 단지(한 획지에 여러 동)는 획지 단위로 한 번만 알린다(건폐율·용적률은 단지 전체 값)
    D.buildings.forEach((b) => {
      if (b.cx && b.cx.k > 0) return;
      const Z = b.zone && C.ZONES[b.zone]; if (!Z) return;
      const pc = (v) => U.fmt(v * 100, 1) + '%', tg = { type: 'building', id: b.lotId };
      if (b.over && b.over.bcr) add('error', tg, `건폐율 ${pc(b.bcr)} — ${Z.name} 상한 ${Z.bcr}% 초과`, C.ZONE_REF.bcr);
      if (b.over && b.over.far) add('error', tg, `용적률 ${pc(b.far)} — ${Z.name} 상한 ${Z.far}% 초과`, C.ZONE_REF.far);
      if (b.floorsSet) add('info', tg, `${b.floorsSet}층으로 정한 건물을 ${b.floors}층으로 지음 — ${Z.name} 용적률 상한에 맞춰 낮춤`, C.ZONE_REF.far);
    });
    // 정북방향 일조(단순화: 최고 높이 기준). 인접 대지경계선만(도로에 면한 변·가각은 빼냄)
    const sunWorst = new Map();
    D.buildings.forEach((b) => {
      if (!SUN_ZONES.has(b.zone)) return; // 전용·일반주거지역의 건축물
      const lot = D.lots.find((l) => l.id === b.lotId);
      if (!lot) return;
      const need = b.h <= C.RULES.sun.h ? C.RULES.sun.near : b.h / 2;
      let worst = Infinity;
      northEdges(lot).forEach((e) => b.fp.forEach((p) => { worst = Math.min(worst, U.distPointSeg(p, e.a, e.c).d); }));
      if (worst < need - 0.05) { const o = sunWorst.get(b.lotId); if (!o || need - worst > o.need - o.worst) sunWorst.set(b.lotId, { b, worst, need }); }
    });
    sunWorst.forEach(({ b, worst, need }) => add('warn', { type: 'building', id: b.lotId }, `정북방향 이격 ${U.fmt(worst, 1)}m — 높이 ${U.fmt(b.h, 1)}m 기준 ${U.fmt(need, 1)}m 필요(단순화 계산)`, C.RULES.sun.ref));
    const M = D.metrics;
    if (M.pop > 50 && M.parkPerCap !== null) {
      const need = P.settings.urbanPark ? C.RULES.park.perCapitaUrban : C.RULES.park.perCapita;
      if (M.parkPerCap < need) add('info', { type: 'site' }, `1인당 공원면적 ${U.fmt(M.parkPerCap, 1)}㎡ — 도시지역 기준 ${need}㎡ 이상(지구 단위 참고치)`, C.RULES.park.ref);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
