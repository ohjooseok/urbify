/* Urbify — 지도 캡처에서 도로망 읽기
 * 그림의 색으로 도로 화소를 고르고(흰색·노랑 계열 또는 직접 찍은 색), 가늘게 깎아 중심선을 얻은 뒤
 * 교차점·구간 그래프 → 이어지는 길(노선) → 폭 추정 → 도로·가구·건물 배치 순으로 만든다.
 * 그림에서 읽은 폭은 지도 표현상의 굵기라 실제와 다를 수 있으므로 위계는 대략값이다. */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C, M = UDS.Model, Dv = UDS.Derive;
  const MI = (UDS.MapImport = {});

  const hueOf = (r, g, b, mx, mn) => {
    const d = mx - mn; if (d <= 0) return 0;
    let h;
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; return h < 0 ? h + 360 : h;
  };

  /* ---------- 1. 화소 분류 ---------- */
  /* img: {data(RGBA), width, height}. o: {sens 0~1, picks [[r,g,b]], tol} */
  MI.classify = function (img, o) {
    o = o || {};
    const w = img.width, h = img.height, d = img.data, n = w * h;
    const road = new Uint8Array(n), major = new Uint8Array(n), green = new Uint8Array(n), water = new Uint8Array(n);
    const sens = o.sens === undefined ? 0.5 : o.sens;
    // 바탕(대지) 색: 가장 흔한 색
    const hist = new Uint32Array(32768);
    for (let i = 0, p = 0; i < n; i += 3, p += 12) hist[((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3)]++;
    let best = 0, bi = 0, best2 = 0, bi2 = 0;
    const WH = (31 << 10) | (31 << 5) | 31;
    for (let i = 0; i < 32768; i++) { if (hist[i] > best) { best = hist[i]; bi = i; } if (i !== WH && hist[i] > best2) { best2 = hist[i]; bi2 = i; } }
    if (bi === WH && best2 > (n / 3) * 0.12) bi = bi2;
    const land = [((bi >> 10) & 31) * 8 + 4, ((bi >> 5) & 31) * 8 + 4, (bi & 31) * 8 + 4];
    const landMin = Math.min(land[0], land[1], land[2]);
    const landWhite = landMin >= 250;
    let wt = Math.round(252 - sens * 10);
    if (!landWhite) wt = Math.max(wt, Math.min(253, landMin + 4)); else wt = 256; // 바탕이 흰색이면 흰색 기준은 쓰지 않음
    const ySat = 0.22 - (sens - 0.5) * 0.1;
    const picks = o.picks || [], tol = o.tol || 14;
    let nRoad = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      let isRoad = mn >= wt;
      if (!isRoad && mx >= 150) {
        const sat = (mx - mn) / mx;
        if (sat >= 0.1) {
          const hu = hueOf(r, g, b, mx, mn);
          if (mx >= 215 && sat >= ySat && hu >= 16 && hu <= 62) { isRoad = true; major[i] = 1; }
          else if (hu >= 70 && hu <= 170 && sat >= 0.12) green[i] = 1;
          else if (hu >= 185 && hu <= 245 && sat >= 0.12 && mx >= 170) water[i] = 1;
        }
      }
      if (!isRoad && picks.length) {
        for (let k = 0; k < picks.length; k++) { const q = picks[k]; if (Math.abs(r - q[0]) <= tol && Math.abs(g - q[1]) <= tol && Math.abs(b - q[2]) <= tol) { isRoad = true; break; } }
      }
      if (isRoad) { road[i] = 1; nRoad++; }
    }
    return { w, h, road, major, green, water, land, landWhite, ratio: nRoad / n };
  };

  /* 화면 캡처의 흰 여백(검색창·단추 줄)을 뺀 지도 부분 추정. 반환: 비율 [x0,y0,x1,y1] */
  MI.autoCrop = function (img) {
    const w = img.width, h = img.height, d = img.data;
    const white = (x, y) => { const p = (y * w + x) * 4; return d[p] >= 250 && d[p + 1] >= 250 && d[p + 2] >= 250; };
    // 가장자리에서 안쪽으로: 거의 흰 줄이 이어지는 동안 잘라 냄(검색창 테두리 같은 짧은 끊김은 건너뜀)
    const trim = (n, frac) => {
      const gap = Math.max(3, Math.round(n * 0.025)), minBand = Math.max(8, Math.round(n * 0.04));
      const scan = (dir) => {
        let last = -1, miss = 0;
        for (let k = 0; k < n * 0.6; k++) { const i = dir > 0 ? k : n - 1 - k; if (frac(i) > 0.72) { last = k; miss = 0; } else if (++miss > gap) break; }
        return last + 1 >= minBand ? last + 1 : 0;
      };
      return [scan(1), n - scan(-1)];
    };
    const ry = trim(h, (y) => { let c = 0; for (let x = 0; x < w; x++) if (white(x, y)) c++; return c / w; });
    const rx = trim(w, (x) => { let c = 0; for (let y = ry[0]; y < ry[1]; y++) if (white(x, y)) c++; return c / Math.max(1, ry[1] - ry[0]); });
    if (ry[1] - ry[0] < h * 0.3 || rx[1] - rx[0] < w * 0.3) return [0, 0, 1, 1];
    return [rx[0] / w, ry[0] / h, rx[1] / w, ry[1] / h];
  };

  /* ---------- 2. 마스크 다듬기 ---------- */
  function dilate(m, w, h, r) {
    let a = m;
    for (let k = 0; k < r; k++) {
      const o = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (a[i] || (x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w])) o[i] = 1;
      }
      a = o;
    }
    return a;
  }
  function erode(m, w, h, r) {
    let a = m;
    for (let k = 0; k < r; k++) {
      const o = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // 그림 가장자리는 도로가 이어진다고 보고 깎지 않음
        if (a[i] && (x === 0 || a[i - 1]) && (x === w - 1 || a[i + 1]) && (y === 0 || a[i - w]) && (y === h - 1 || a[i + w])) o[i] = 1;
      }
      a = o;
    }
    return a;
  }
  /* 3-4 모따기 거리 변환: 도로 화소에서 가장 가까운 비도로까지의 거리(화소) */
  function distance(m, w, h, edgeIsRoad) {
    const INF = 1e6, dt = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) dt[i] = m[i] ? INF : 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? (edgeIsRoad ? INF : 0) : dt[y * w + x]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!dt[i]) continue;
      let v = dt[i];
      v = Math.min(v, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
      dt[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; if (!dt[i]) continue;
      let v = dt[i];
      v = Math.min(v, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
      dt[i] = v;
    }
    for (let i = 0; i < w * h; i++) dt[i] /= 3;
    return dt;
  }
  MI.clean = function (cls, o) {
    const w = cls.w, h = cls.h, mpp = o.mpp;
    // 글자·점선 틈 메우기
    const cr = o.closeR !== undefined ? o.closeR : Math.max(1, Math.min(3, Math.round(1.6 / mpp + 0.6)));
    let m = cr > 0 ? erode(dilate(cls.road, w, h, cr), w, h, cr) : new Uint8Array(cls.road);
    // 도로 안에 뚫린 작은 구멍(도로 이름 글자, 노면 기호)을 메움. 가구처럼 큰 빈 곳은 그대로 둠(지적도처럼 깨끗한 자료는 o.keepHoles로 건너뜀)
    if (!o.keepHoles) {
      const lab0 = new Uint8Array(w * h), st0 = new Int32Array(w * h);
      const aMax = (16 / mpp) * (90 / mpp), tMax = 16 / mpp, lMax = 130 / mpp; // 글자 줄은 길어도 높이가 낮다
      for (let s = 0; s < w * h; s++) {
        if (m[s] || lab0[s]) continue;
        let top = 0, n2 = 0, border = false, x0 = w, x1 = 0, y0 = h, y1 = 0;
        const cells = [];
        st0[top++] = s; lab0[s] = 1;
        while (top) {
          const i = st0[--top]; n2++;
          if (cells.length <= aMax) cells.push(i);
          const x = i % w, y = (i - x) / w;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (x > 0 && !m[i - 1] && !lab0[i - 1]) { lab0[i - 1] = 1; st0[top++] = i - 1; }
          if (x < w - 1 && !m[i + 1] && !lab0[i + 1]) { lab0[i + 1] = 1; st0[top++] = i + 1; }
          if (y > 0 && !m[i - w] && !lab0[i - w]) { lab0[i - w] = 1; st0[top++] = i - w; }
          if (y < h - 1 && !m[i + w] && !lab0[i + w]) { lab0[i + w] = 1; st0[top++] = i + w; }
        }
        if (!border && n2 <= aMax && Math.min(x1 - x0, y1 - y0) <= tMax && Math.max(x1 - x0, y1 - y0) <= lMax && n2 <= cells.length) cells.forEach((i) => { m[i] = 1; });
      }
    }
    // 너무 넓은 흰 덩어리(광장·주차장·화면 단추 등)는 도로가 아님
    const rMax = Math.max(8, (o.maxWidth || 46) / mpp / 2);
    let dt = distance(m, w, h, true);
    let hasCore = false;
    const core = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (dt[i] > rMax) { core[i] = 1; hasCore = true; }
    if (hasCore) {
      const inv = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) inv[i] = core[i] ? 0 : 1;
      const dc = distance(inv, w, h, true);
      for (let i = 0; i < w * h; i++) if (m[i] && dc[i] <= rMax + 2.5) m[i] = 0;
    }
    // 작은 조각(글자 테두리·기호) 지우기: 가장 큰 덩어리, 가장자리에 닿는 덩어리, 충분히 큰 덩어리만 남김
    const lab = new Int32Array(w * h);
    const comps = [];
    const stack = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (!m[s] || lab[s]) continue;
      const id = comps.length + 1;
      let top = 0, area = 0, border = false, x0 = w, x1 = 0, y0 = h, y1 = 0;
      stack[top++] = s; lab[s] = id;
      while (top) {
        const i = stack[--top]; area++;
        const x = i % w, y = (i - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (m[j] && !lab[j]) { lab[j] = id; stack[top++] = j; }
        }
      }
      comps.push({ id, area, border, span: Math.hypot(x1 - x0, y1 - y0) });
    }
    const big = comps.reduce((a, c) => Math.max(a, c.area), 0);
    const minSpan = 45 / mpp, minArea = (10 / mpp) * (30 / mpp);
    const keep = new Uint8Array(comps.length + 1);
    comps.forEach((c) => { if (c.area === big || (c.border && c.span >= minSpan * 0.6 && c.area >= minArea * 0.5) || (c.area >= big * 0.06 && c.span >= minSpan)) keep[c.id] = 1; });
    for (let i = 0; i < w * h; i++) if (m[i] && !keep[lab[i]]) m[i] = 0;
    dt = distance(m, w, h, true);
    return { mask: m, dt };
  };

  /* ---------- 3. 가늘게 깎기(Zhang–Suen) ---------- */
  MI.thin = function (mask, w, h) {
    const m = new Uint8Array(mask);
    const idx = [];
    for (let i = 0; i < w * h; i++) if (m[i]) idx.push(i);
    let list = idx;
    const g = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
    for (let iter = 0; iter < 200; iter++) {
      let changed = false;
      for (let step = 0; step < 2; step++) {
        const del = [];
        for (let k = 0; k < list.length; k++) {
          const i = list[k]; if (!m[i]) continue;
          const x = i % w, y = (i - x) / w;
          const p2 = g(x, y - 1), p3 = g(x + 1, y - 1), p4 = g(x + 1, y), p5 = g(x + 1, y + 1), p6 = g(x, y + 1), p7 = g(x - 1, y + 1), p8 = g(x - 1, y), p9 = g(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (A !== 1) continue;
          if (step === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue; } else if (p2 * p4 * p8 || p2 * p6 * p8) continue;
          del.push(i);
        }
        if (del.length) { changed = true; for (let k = 0; k < del.length; k++) m[del[k]] = 0; }
      }
      if (!changed) break;
      list = list.filter((i) => m[i]);
    }
    return m;
  };

  /* ---------- 4. 중심선 그래프 ---------- */
  const NB = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  MI.graph = function (sk, w, h, dt, major, o) {
    const mpp = o.mpp;
    const g = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : sk[y * w + x]);
    const cn = (x, y) => { let c = 0; for (let k = 0; k < 8; k++) { const a = g(x + NB[k][0], y + NB[k][1]), b = g(x + NB[(k + 1) % 8][0], y + NB[(k + 1) % 8][1]); if (!a && b) c++; } return c; };
    const kind = new Uint8Array(w * h); // 1 선, 2 끝, 3 갈림
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!sk[y * w + x]) continue;
      const c = cn(x, y);
      let nb = 0; for (let k = 0; k < 8; k++) nb += g(x + NB[k][0], y + NB[k][1]);
      kind[y * w + x] = nb <= 1 ? 2 : c >= 3 || nb >= 4 ? 3 : 1;
    }
    // 갈림 화소 묶기
    const nodeOf = new Int32Array(w * h).fill(-1);
    const nodes = [];
    for (let s = 0; s < w * h; s++) {
      if (kind[s] < 2 || nodeOf[s] >= 0) continue;
      const id = nodes.length, px = [];
      const st = [s]; nodeOf[s] = id;
      while (st.length) {
        const i = st.pop(); px.push(i);
        if (kind[i] !== 3) continue;
        const x = i % w, y = (i - x) / w;
        for (let k = 0; k < 8; k++) { const xx = x + NB[k][0], yy = y + NB[k][1]; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (kind[j] === 3 && nodeOf[j] < 0) { nodeOf[j] = id; st.push(j); } }
      }
      let sx = 0, sy = 0; px.forEach((i) => { sx += i % w; sy += Math.floor(i / w); });
      nodes.push({ id, x: sx / px.length, y: sy / px.length, px, end: kind[s] === 2, edges: [] });
    }
    // 구간 따라가기
    const seen = new Uint8Array(w * h);
    const edges = [];
    nodes.forEach((nd) => {
      nd.px.forEach((i0) => {
        const x0 = i0 % w, y0 = (i0 - x0) / w;
        for (let k = 0; k < 8; k++) {
          let x = x0 + NB[k][0], y = y0 + NB[k][1];
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          let i = y * w + x;
          if (!sk[i] || nodeOf[i] === nd.id || seen[i]) continue;
          if (nodeOf[i] >= 0) { // 갈림끼리 바로 붙은 경우
            if (nodeOf[i] > nd.id) edges.push({ a: nd.id, b: nodeOf[i], chain: [] });
            continue;
          }
          const chain = [];
          let px = x0, py = y0, endNode = -1;
          for (let guard = 0; guard < w * h; guard++) {
            seen[i] = 1; chain.push(i);
            let nxt = -1, nNode = -1;
            for (let t = 0; t < 8; t++) {
              const kk = [2, 4, 6, 0, 1, 3, 5, 7][t]; // 가로세로 이웃 먼저
              const xx = x + NB[kk][0], yy = y + NB[kk][1];
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              const j = yy * w + xx;
              if (!sk[j] || (xx === px && yy === py)) continue;
              if (nodeOf[j] >= 0) { if (nodeOf[j] !== nd.id || chain.length > 2) { nNode = nodeOf[j]; } continue; }
              if (!seen[j] && nxt < 0) nxt = j;
            }
            if (nNode >= 0 && (nxt < 0 || chain.length > 1 || nNode !== nd.id)) { endNode = nNode; break; }
            if (nxt < 0) break;
            px = x; py = y; i = nxt; x = i % w; y = (i - x) / w;
          }
          if (endNode < 0) { // 끝이 표시되지 않은 채 끊긴 경우: 끝점으로 등록
            const j = chain[chain.length - 1];
            const id = nodes.length; nodes.push({ id, x: j % w, y: Math.floor(j / w), px: [j], end: true, edges: [] }); nodeOf[j] = id; endNode = id;
          }
          edges.push({ a: nd.id, b: endNode, chain });
        }
      });
    });
    // 구간 속성: 점열·길이·폭·주요도로 여부
    const med = (a) => { if (!a.length) return 0; const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    const out = [];
    edges.forEach((e) => {
      if (e.a === e.b && e.chain.length < 12) return;
      const A = nodes[e.a], B = nodes[e.b];
      const pts = [[A.x, A.y]].concat(e.chain.map((i) => [i % w, Math.floor(i / w)])).concat([[B.x, B.y]]);
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const skip = Math.min(Math.floor(e.chain.length / 4), 8);
      const ws = [], mj = [];
      for (let i = skip; i < e.chain.length - skip; i++) { ws.push(dt[e.chain[i]] * 2); mj.push(major[e.chain[i]]); }
      if (!ws.length) e.chain.forEach((i) => { ws.push(dt[i] * 2); mj.push(major[i]); });
      const wpx = ws.length ? med(ws) : Math.max(dt[Math.round(A.y) * w + Math.round(A.x)] || 2, 2) * 2;
      // 가장자리의 흐린 화소와 테두리선만큼 좁게 재어지므로 1.2화소를 더함
      out.push({ a: e.a, b: e.b, pts, len, w: Math.max(2, wpx + 1.2), major: mj.length ? mj.reduce((s, v) => s + v, 0) / mj.length : 0 });
    });
    return tidyGraph(nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })), out, w, h, mpp, o);
  };

  function tidyGraph(nodes, edges, w, h, mpp, o) {
    // o.inner: 대상지 사각형(화소). 그 밖(여유 띠)의 끝점은 자료가 잘려 생긴 것이므로 잔가지로 치지 않는다
    const ext = (n) => !!o.inner && (n.x < o.inner[0] || n.y < o.inner[1] || n.x > o.inner[2] || n.y > o.inner[3]);
    const deg = () => { const d = new Map(); edges.forEach((e) => { d.set(e.a, (d.get(e.a) || 0) + 1); d.set(e.b, (d.get(e.b) || 0) + 1); }); return d; };
    const onBorder = (n, m) => n.x <= m || n.y <= m || n.x >= w - 1 - m || n.y >= h - 1 - m;
    const dirAt = (e, nid, reach) => { // 노드에서 구간 안쪽을 향한 방향
      const pts = e.a === nid ? e.pts : e.pts.slice().reverse();
      let acc = 0, k = 1;
      for (; k < pts.length - 1; k++) { acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); if (acc >= reach) break; }
      const dx = pts[k][0] - pts[0][0], dy = pts[k][1] - pts[0][1], l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    };
    // 가장자리 근처에서 끝난 중심선은 그림 가장자리까지 늘림(깎기 과정에서 반폭만큼 짧아짐)
    const extend = () => {
      const d = deg();
      edges.forEach((e) => {
        [e.a, e.b].forEach((nid) => {
          if (d.get(nid) !== 1) return;
          const n = nodes[nid]; if (n.fixed) return;
          const reachPx = e.w * 0.9 + 4;
          const dist = Math.min(n.x, n.y, w - 1 - n.x, h - 1 - n.y);
          if (dist > reachPx) return;
          const v = dirAt(e, nid, Math.max(8, e.w));
          const ox = -v[0], oy = -v[1]; // 바깥 방향
          let t = Infinity;
          if (ox < -1e-6) t = Math.min(t, (0 - n.x) / ox); if (ox > 1e-6) t = Math.min(t, (w - 1 - n.x) / ox);
          if (oy < -1e-6) t = Math.min(t, (0 - n.y) / oy); if (oy > 1e-6) t = Math.min(t, (h - 1 - n.y) / oy);
          if (!isFinite(t) || t > reachPx * 1.8) { // 비스듬하면 가장 가까운 변으로
            if (dist === n.x) n.x = 0; else if (dist === n.y) n.y = 0; else if (dist === w - 1 - n.x) n.x = w - 1; else n.y = h - 1;
          } else { n.x = U.clamp(n.x + ox * t, 0, w - 1); n.y = U.clamp(n.y + oy * t, 0, h - 1); }
          n.fixed = true; n.border = true;
          const pts = e.a === nid ? e.pts : null;
          if (pts) pts[0] = [n.x, n.y]; else e.pts[e.pts.length - 1] = [n.x, n.y];
        });
      });
    };
    extend();
    // 잔가지 치기
    const spurMin = (o.spur || 13) / mpp;
    for (let pass = 0; pass < 4; pass++) {
      const d = deg();
      const before = edges.length;
      edges = edges.filter((e) => {
        const da = d.get(e.a), db = d.get(e.b);
        if (e.a === e.b) return e.len > 40 / mpp;
        const endA = da === 1 && !nodes[e.a].border && !ext(nodes[e.a]), endB = db === 1 && !nodes[e.b].border && !ext(nodes[e.b]);
        if (endA && endB) return e.len > 60 / mpp; // 어디에도 붙지 않은 조각
        if (endA || endB) return e.len > Math.max(spurMin, e.w * 1.5);
        return true;
      });
      // 차수 2 노드 합치기
      let merged = true;
      while (merged) {
        merged = false;
        const dd = deg();
        const inc = new Map();
        edges.forEach((e, i) => { [e.a, e.b].forEach((n) => { if (!inc.has(n)) inc.set(n, []); inc.get(n).push(i); }); });
        for (const [nid, list] of inc) {
          if (dd.get(nid) !== 2 || list.length !== 2 || nodes[nid].border) continue;
          const e1 = edges[list[0]], e2 = edges[list[1]];
          if (e1 === e2 || e1.a === e1.b || e2.a === e2.b) continue;
          if (o.linkWR) { const r = e1.w / e2.w; if (r >= o.linkWR || r <= 1 / o.linkWR) continue; } // 폭이 크게 다른 두 길은 잇지 않음
          const p1 = e1.b === nid ? e1.pts : e1.pts.slice().reverse();
          const p2 = e2.a === nid ? e2.pts : e2.pts.slice().reverse();
          const na = e1.b === nid ? e1.a : e1.b, nb = e2.a === nid ? e2.b : e2.a;
          const ne = { a: na, b: nb, pts: p1.concat(p2.slice(1)), len: e1.len + e2.len, w: (e1.w * e1.len + e2.w * e2.len) / (e1.len + e2.len || 1), major: (e1.major * e1.len + e2.major * e2.len) / (e1.len + e2.len || 1) };
          edges = edges.filter((e) => e !== e1 && e !== e2); edges.push(ne);
          merged = true; break;
        }
      }
      if (edges.length === before) break;
    }
    // 끊긴 곳 잇기: 마주 보는 끝점끼리, 또는 끝점이 향하는 가까운 구간으로
    const gapMax = (o.gap || 34) / mpp;
    {
      const d = deg();
      const ends = [];
      edges.forEach((e) => [e.a, e.b].forEach((nid) => { if (d.get(nid) === 1 && !nodes[nid].border && !ext(nodes[nid])) ends.push({ nid, e, out: dirAt(e, nid, Math.max(10, e.w * 1.5)).map((v) => -v) }); }));
      const used = new Set();
      ends.forEach((E) => {
        if (used.has(E.nid)) return;
        const n = nodes[E.nid];
        let bestK = null, bd = gapMax;
        ends.forEach((F) => {
          if (F === E || used.has(F.nid) || F.e === E.e) return;
          const m = nodes[F.nid];
          const dx = m.x - n.x, dy = m.y - n.y, l = Math.hypot(dx, dy);
          if (l > bd || l < 1e-6) return;
          const cos1 = (dx * E.out[0] + dy * E.out[1]) / l, cos2 = (-dx * F.out[0] - dy * F.out[1]) / l;
          if (cos1 > 0.88 && cos2 > 0.88) { bd = l; bestK = F; }
        });
        if (bestK) {
          used.add(E.nid); used.add(bestK.nid);
          edges.push({ a: E.nid, b: bestK.nid, pts: [[n.x, n.y], [nodes[bestK.nid].x, nodes[bestK.nid].y]], len: bd, w: (E.e.w + bestK.e.w) / 2, major: (E.e.major + bestK.e.major) / 2, bridge: true });
          return;
        }
        // 끝점 앞쪽의 다른 구간 위 점
        let hit = null; bd = gapMax * 0.7;
        edges.forEach((e2) => {
          if (e2 === E.e) return;
          for (let i = 0; i < e2.pts.length; i += 2) {
            const q = e2.pts[i], dx = q[0] - n.x, dy = q[1] - n.y, l = Math.hypot(dx, dy);
            if (l < bd && l > 1e-6 && (dx * E.out[0] + dy * E.out[1]) / l > 0.9) { bd = l; hit = { e2, i }; }
          }
        });
        if (hit) {
          used.add(E.nid);
          const e2 = hit.e2, q = e2.pts[hit.i];
          if (hit.i === 0 || hit.i >= e2.pts.length - 1) { const tn = hit.i === 0 ? e2.a : e2.b; edges.push({ a: E.nid, b: tn, pts: [[n.x, n.y], [nodes[tn].x, nodes[tn].y]], len: bd, w: E.e.w, major: E.e.major, bridge: true }); return; }
          const id = nodes.length; nodes.push({ id, x: q[0], y: q[1] });
          const pA = e2.pts.slice(0, hit.i + 1), pB = e2.pts.slice(hit.i);
          const lenOf = (p) => { let s = 0; for (let k = 1; k < p.length; k++) s += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); return s; };
          edges = edges.filter((x) => x !== e2);
          edges.push({ a: e2.a, b: id, pts: pA, len: lenOf(pA), w: e2.w, major: e2.major });
          edges.push({ a: id, b: e2.b, pts: pB, len: lenOf(pB), w: e2.w, major: e2.major });
          edges.push({ a: E.nid, b: id, pts: [[n.x, n.y], [q[0], q[1]]], len: bd, w: E.e.w, major: E.e.major, bridge: true });
        }
      });
    }
    // 아주 짧은 교차점 사이 구간은 한 교차점으로 합침
    const tiny = (o.tiny || 7) / mpp;
    for (let guard = 0; guard < 400; guard++) {
      const d = deg();
      // o.tinyW: 넓은 길 위에서 갈라진 두 교차점(넓은 길과 좁은 길이 만나는 곳)은 넓은 길 폭의 그 비율 안이면 하나로 본다
      let wAt = null;
      if (o.tinyW) { wAt = new Map(); edges.forEach((x) => [x.a, x.b].forEach((n) => wAt.set(n, Math.max(wAt.get(n) || 0, x.w)))); }
      const near = (x) => wAt && Math.hypot(nodes[x.a].x - nodes[x.b].x, nodes[x.a].y - nodes[x.b].y) < o.tinyW * Math.min(wAt.get(x.a) || 0, wAt.get(x.b) || 0);
      const e = edges.find((x) => x.a !== x.b && (x.len < Math.max(tiny, x.w * 0.55) || near(x)) && d.get(x.a) >= 2 && d.get(x.b) >= 2 && !(nodes[x.a].border && nodes[x.b].border));
      if (!e) break;
      const A = nodes[e.a], B = nodes[e.b];
      const keepN = B.border ? B : A, dropN = B.border ? A : B;
      if (!keepN.border) { keepN.x = (A.x + B.x) / 2; keepN.y = (A.y + B.y) / 2; }
      edges = edges.filter((x) => x !== e);
      edges.forEach((x) => {
        if (x.a === dropN.id) { x.a = keepN.id; } if (x.b === dropN.id) { x.b = keepN.id; }
        if (x.a === keepN.id) x.pts[0] = [keepN.x, keepN.y];
        if (x.b === keepN.id) x.pts[x.pts.length - 1] = [keepN.x, keepN.y];
      });
      edges = edges.filter((x) => !(x.a === x.b && x.len < 40 / mpp));
    }
    // 같은 두 교차점을 잇는 겹친 구간 정리(짧은 쪽을 남김)
    const seenPair = new Map();
    edges.forEach((e) => { const k = e.a < e.b ? e.a + '_' + e.b : e.b + '_' + e.a; const p = seenPair.get(k); if (!p || e.len < p.len) seenPair.set(k, e); });
    edges = edges.filter((e) => { const k = e.a < e.b ? e.a + '_' + e.b : e.b + '_' + e.a; const p = seenPair.get(k); return p === e || Math.abs(e.len - p.len) > Math.max(20 / mpp, p.len * 0.25); });
    return { nodes, edges };
  }

  /* 점열 단순화(Douglas–Peucker) */
  function simplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop();
      let md = 0, mi = -1;
      const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1], l = Math.hypot(bx - ax, by - ay) || 1;
      for (let i = a + 1; i < b; i++) { const dd = Math.abs((pts[i][0] - ax) * (by - ay) - (pts[i][1] - ay) * (bx - ax)) / l; if (dd > md) { md = dd; mi = i; } }
      if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return pts.filter((p, i) => keep[i]);
  }

  /* ---------- 5. 그래프 → 미터 좌표의 노선 ---------- */
  /* o: {mpp, widthK, grid(직각 정리), W, H(화소)} → {streets:[{pts, w, major, len}], nodes, site} */
  MI.streets = function (graph, o) {
    const mpp = o.mpp, Hpx = o.H, Wm = (o.W - 1) * mpp, Hm = (o.H - 1) * mpp;
    const toM = (p) => [p[0] * mpp, (Hpx - 1 - p[1]) * mpp];
    const N = graph.nodes.map((n) => ({ id: n.id, p: toM([n.x, n.y]), border: !!n.border }));
    let E = graph.edges.map((e) => {
      const raw = simplify(e.pts, Math.max(1.3, 2.6 / mpp, e.w * 0.22)).map(toM); // 넓은 길일수록 잔굴곡을 더 편다
      const pts = raw.map((p) => ({ p }));
      pts[0] = N[e.a]; pts[pts.length - 1] = N[e.b];
      return { a: e.a, b: e.b, pts, w: e.w * mpp * (o.widthK || 1), major: e.major, len: e.len * mpp };
    });
    // 가장자리 점은 경계 위에 정확히
    N.forEach((n) => { if (!n.border) return; const d = [n.p[0], n.p[1], Wm - n.p[0], Hm - n.p[1]]; const k = d.indexOf(Math.min(...d)); if (k === 0) n.p[0] = 0; else if (k === 1) n.p[1] = 0; else if (k === 2) n.p[0] = Wm; else n.p[1] = Hm; n.lock = k % 2 === 0 ? 'x' : 'y'; });
    // 직각 격자에 가깝게 정리: 주 방향과 거의 나란한 구간의 양 끝을 같은 줄에 맞춤
    let theta = 0;
    if (o.grid) {
      const bins = new Float64Array(90);
      E.forEach((e) => { for (let i = 1; i < e.pts.length; i++) { const a = e.pts[i - 1].p, b = e.pts[i].p; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; ang = ((ang % 90) + 90) % 90; bins[Math.floor(ang) % 90] += l; } });
      let bestV = -1, bestI = 0;
      for (let i = 0; i < 90; i++) { const v = bins[i] + 0.7 * (bins[(i + 1) % 90] + bins[(i + 89) % 90]) + 0.3 * (bins[(i + 2) % 90] + bins[(i + 88) % 90]); if (v > bestV) { bestV = v; bestI = i; } }
      theta = ((bestI + 0.5) * Math.PI) / 180;
      const tot = bins.reduce((s, v) => s + v, 0);
      const aligned = bestV / (tot * 2.4 || 1);
      if (Math.abs(bestI - 0) <= 2 || Math.abs(bestI - 89) <= 2) theta = 0;
      if (aligned > 0.18) {
        const cu = Math.cos(theta), su = Math.sin(theta);
        const P = []; const idOf = new Map();
        const pid = (pt) => { if (!idOf.has(pt)) { idOf.set(pt, P.length); P.push(pt); } return idOf.get(pt); };
        const par = { u: [], v: [] };
        const find = (a, i) => { while (a[i] !== i) { a[i] = a[a[i]]; i = a[i]; } return i; };
        E.forEach((e) => e.pts.forEach((pt) => { const i = pid(pt); par.u[i] = i; par.v[i] = i; }));
        const tol = ((o.gridTol || 8) * Math.PI) / 180;
        E.forEach((e) => { for (let i = 1; i < e.pts.length; i++) { const a = e.pts[i - 1], b = e.pts[i]; let ang = Math.atan2(b.p[1] - a.p[1], b.p[0] - a.p[0]) - theta; ang = ((ang % Math.PI) + Math.PI) % Math.PI; const ia = pid(a), ib = pid(b); if (ang < tol || ang > Math.PI - tol) par.v[find(par.v, ia)] = find(par.v, ib); else if (Math.abs(ang - Math.PI / 2) < tol) par.u[find(par.u, ia)] = find(par.u, ib); } });
        const U2 = P.map((pt) => pt.p[0] * cu + pt.p[1] * su), V2 = P.map((pt) => -pt.p[0] * su + pt.p[1] * cu);
        ['u', 'v'].forEach((ax) => {
          const groups = new Map();
          P.forEach((pt, i) => { const r = find(par[ax], i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
          groups.forEach((list) => { if (list.length < 2) return; const arr = ax === 'u' ? U2 : V2; const m = list.reduce((s, i) => s + arr[i], 0) / list.length; list.forEach((i) => { arr[i] = m; }); });
        });
        P.forEach((pt, i) => { const x = U2[i] * cu - V2[i] * su, y = U2[i] * su + V2[i] * cu; if (pt.lock === 'x') pt.p[1] = U.clamp(y, 0, Hm); else if (pt.lock === 'y') pt.p[0] = U.clamp(x, 0, Wm); else { pt.p[0] = U.clamp(x, 0, Wm); pt.p[1] = U.clamp(y, 0, Hm); } });
      }
    }
    // 정리: 좌표 반올림, 겹친 점 제거
    const rd = (v) => Math.round(v * 10) / 10;
    N.forEach((n) => { n.p[0] = rd(n.p[0]); n.p[1] = rd(n.p[1]); });
    E.forEach((e) => {
      e.pts.forEach((pt) => { pt.p[0] = rd(pt.p[0]); pt.p[1] = rd(pt.p[1]); });
      const out = [e.pts[0]];
      for (let i = 1; i < e.pts.length; i++) { const q = out[out.length - 1]; if (Math.hypot(e.pts[i].p[0] - q.p[0], e.pts[i].p[1] - q.p[1]) > 1.5 || i === e.pts.length - 1) out.push(e.pts[i]); }
      // 거의 일직선인 중간 점 제거
      const s2 = [out[0]];
      for (let i = 1; i < out.length - 1; i++) { const a = s2[s2.length - 1].p, b = out[i].p, c = out[i + 1].p; const cr = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1); if (cr > 0.6) s2.push(out[i]); }
      s2.push(out[out.length - 1]);
      e.pts = s2;
      e.len = 0; for (let i = 1; i < s2.length; i++) e.len += Math.hypot(s2[i].p[0] - s2[i - 1].p[0], s2[i].p[1] - s2[i - 1].p[1]);
    });
    // 아주 짧은 구간은 지우되 양 끝 교차점을 하나로 합쳐 틈(막다른 끝)이 생기지 않게 함
    for (let guard = 0; guard < 300; guard++) {
      const k = E.findIndex((e) => e.a !== e.b && e.len <= Math.max(4, e.w * 0.3));
      if (k < 0) break;
      const e = E[k]; E.splice(k, 1);
      const A = N[e.a], B = N[e.b];
      const keep = B.border && !A.border ? B : A, drop = keep === A ? B : A;
      E.forEach((x) => {
        if (x.a === drop.id) { x.a = keep.id; x.pts[0] = keep; }
        if (x.b === drop.id) { x.b = keep.id; x.pts[x.pts.length - 1] = keep; }
        x.len = 0; for (let i = 1; i < x.pts.length; i++) x.len += Math.hypot(x.pts[i].p[0] - x.pts[i - 1].p[0], x.pts[i].p[1] - x.pts[i - 1].p[1]);
      });
    }
    E = E.filter((e) => !(e.a === e.b && e.len < 30) && e.pts.length >= 2 && e.len > 0.5);
    const degN = new Map();
    E.forEach((e) => { degN.set(e.a, (degN.get(e.a) || 0) + 1); degN.set(e.b, (degN.get(e.b) || 0) + 1); });
    // 교차점마다 가장 곧게 이어지는 두 구간을 한 노선으로 묶음. 두 구간만 만나는 점(굽은 곳·폭이 바뀌는 곳)은 늘 한 노선으로 잇는다
    const inc = new Map();
    E.forEach((e, i) => { [e.a, e.b].forEach((n) => { if (!inc.has(n)) inc.set(n, []); inc.get(n).push(i); }); });
    const dirFrom = (e, nid) => { const pts = e.a === nid ? e.pts : e.pts.slice().reverse(); let k = 1, acc = 0; for (; k < pts.length - 1; k++) { acc += Math.hypot(pts[k].p[0] - pts[k - 1].p[0], pts[k].p[1] - pts[k - 1].p[1]); if (acc > 14) break; } const dx = pts[k].p[0] - pts[0].p[0], dy = pts[k].p[1] - pts[0].p[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    const link = new Map(); // "edge:node" → 이어지는 edge
    inc.forEach((list, nid) => {
      if (list.length < 2) return;
      const LW = o.linkWR || 2.5; // 한 노선으로 잇는 두 구간의 폭 비 상한(지적처럼 폭이 정확한 자료는 작게 잡아 폭이 다른 길을 따로 둔다)
      if (list.length === 2 && list[0] !== list[1]) {
        const wr2 = E[list[0]].w / E[list[1]].w;
        if (!o.linkWR || (wr2 < LW && wr2 > 1 / LW)) { link.set(list[0] + ':' + nid, list[1]); link.set(list[1] + ':' + nid, list[0]); }
        return;
      }
      const dirs = list.map((i) => dirFrom(E[i], nid));
      const pairs = [];
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        if (list[a] === list[b]) continue;
        const dot = dirs[a][0] * dirs[b][0] + dirs[a][1] * dirs[b][1];
        const wr = E[list[a]].w / E[list[b]].w;
        if (dot < -0.8 && wr > 1 / LW && wr < LW) pairs.push([dot + Math.abs(Math.log(wr)) * 0.08, a, b]); // 곧을수록, 폭이 비슷할수록 먼저
      }
      pairs.sort((p, q) => p[0] - q[0]);
      const used = new Set();
      pairs.forEach(([, a, b]) => { if (used.has(a) || used.has(b)) return; used.add(a); used.add(b); link.set(list[a] + ':' + nid, list[b]); link.set(list[b] + ':' + nid, list[a]); });
    });
    const done = new Uint8Array(E.length);
    const chains = [];
    E.forEach((e0, i0) => {
      if (done[i0]) return;
      // 한쪽 끝까지 거슬러 올라간 뒤 반대쪽으로 따라감
      let cur = i0, node = e0.a;
      const visited = new Set([i0]);
      for (let guard = 0; guard < E.length; guard++) { const nx = link.get(cur + ':' + node); if (nx === undefined || visited.has(nx) || done[nx]) break; visited.add(nx); node = E[nx].a === node ? E[nx].b : E[nx].a; cur = nx; }
      const chain = []; const nodesSeen = new Set([node]); const startNode = node;
      for (let guard = 0; guard < E.length + 1; guard++) {
        const e = E[cur]; done[cur] = 1;
        const fwd = e.a === node;
        chain.push({ e, fwd });
        node = fwd ? e.b : e.a;
        if (nodesSeen.has(node)) break; nodesSeen.add(node);
        const nx = link.get(cur + ':' + node);
        if (nx === undefined || done[nx]) break;
        cur = nx;
      }
      const objs = [];
      let len = 0, wsum = 0, msum = 0;
      chain.forEach(({ e, fwd }) => { const pp = fwd ? e.pts : e.pts.slice().reverse(); pp.forEach((pt, i) => { if (objs.length && i === 0) return; objs.push(pt); }); len += e.len; wsum += e.w * e.len; msum += e.major * e.len; });
      if (len < 9 && (degN.get(startNode) === 1 || degN.get(node) === 1)) return; // 짧은 잔가지만 버림(교차점을 잇는 짧은 길은 남김)
      if (objs.length < 2) return;
      chains.push({ objs, len, w: wsum / (len || 1), major: msum / (len || 1) > 0.5 });
    });
    // 노선 펴기: 그림에서 읽은 중심선은 교차점마다 조금씩 흔들린다. 넓고 긴 노선부터 허용 오차 안의 잔굴곡을 펴고,
    // 그 위에 놓인 교차점은 펴진 선 위로 옮겨 다른 노선의 끝이 정확히 닿게 한다(이미 자리가 정해진 교차점은 꺾이는 점으로 남긴다)
    chains.sort((a, b) => b.w - a.w || b.len - a.len);
    const isNode = (o) => o.id !== undefined;
    const fixed = new Set();
    const segDist = (p, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1; const t = U.clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2, 0, 1); const q = [a[0] + vx * t, a[1] + vy * t]; return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q }; };
    chains.forEach((c) => {
      const tol = U.clamp(1.2 + 0.18 * c.w, 2, 4.5);
      const o = c.objs, keep = new Uint8Array(o.length);
      keep[0] = keep[o.length - 1] = 1;
      o.forEach((q, i) => { if (isNode(q) && (fixed.has(q) || q.border)) keep[i] = 1; });
      const dp = (i, j) => { // i, j는 남기는 점. 그 사이에서 선분에서 가장 먼 점이 허용 오차를 넘으면 그 점도 남김
        let far = -1, fd = tol;
        for (let m = i + 1; m < j; m++) { const d = segDist(o[m].p, o[i].p, o[j].p).d; if (d > fd) { fd = d; far = m; } }
        if (far < 0) return;
        keep[far] = 1; dp(i, far); dp(far, j);
      };
      let a = 0;
      for (let b = 1; b < o.length; b++) if (keep[b]) { dp(a, b); a = b; }
      const out = [];
      a = 0;
      for (let i = 0; i < o.length; i++) {
        if (keep[i]) { out.push(o[i]); a = i; continue; }
        if (!isNode(o[i])) continue; // 교차점이 아닌 잔점은 버림
        let b = i + 1; while (!keep[b]) b++;
        const q = segDist(o[i].p, o[a].p, o[b].p).q; // 펴진 선 위로 옮김
        o[i].p[0] = Math.round(q[0] * 100) / 100; o[i].p[1] = Math.round(q[1] * 100) / 100;
        out.push(o[i]);
      }
      out.forEach((q) => { if (isNode(q)) fixed.add(q); });
      c.objs = out;
    });
    const streets = [];
    chains.forEach((c) => {
      const pts = [];
      c.objs.forEach((q) => { const l = pts[pts.length - 1]; if (!l || Math.hypot(l[0] - q.p[0], l[1] - q.p[1]) > 0.3) pts.push([q.p[0], q.p[1]]); });
      if (pts.length < 2) return;
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      streets.push({ pts, len, w: c.w, major: c.major });
    });
    streets.sort((a, b) => b.w - a.w || b.len - a.len);
    return { streets, site: { w: rd(Wm), h: rd(Hm) }, theta };
  };

  /* ---------- 6. 한 번에: 그림 → 노선 ---------- */
  MI.run = function (img, o) {
    const cls = MI.classify(img, o);
    const cl = MI.clean(cls, o);
    const sk = MI.thin(cl.mask, cls.w, cls.h);
    const gr = MI.graph(sk, cls.w, cls.h, cl.dt, cls.major, o);
    const st = MI.streets(gr, { ...o, W: cls.w, H: cls.h });
    return { cls, mask: cl.mask, skeleton: sk, graph: gr, ...st };
  };

  /* ---------- 7. 노선 → 대상지(도로·가구·건물) ---------- */
  MI.TYPES = {
    newtown: { name: '신시가지형', desc: '보도·가로수·지중화가 갖춰진 계획 시가지. 큰길가 상업·업무, 안쪽 주거' },
    oldtown: { name: '구도심형', desc: '좁은 보도와 전주, 합류식 하수관, 큰길가 노후 상가와 안쪽 저층 주거' },
    lowrise: { name: '저층 주거지형', desc: '단독·다세대 위주의 주거지. 골목은 보행자우선도로로 둠' },
  };
  const S10 = [{ type: 'sidewalk', w: 1.5 }, { type: 'lane', w: 3.5, dir: -1 }, { type: 'lane', w: 3.5, dir: 1 }, { type: 'sidewalk', w: 1.5 }];
  const S12 = [{ type: 'sidewalk', w: 2.0 }, { type: 'lane', w: 3.0, dir: -1 }, { type: 'lane', w: 3.0, dir: 1 }, { type: 'parking', w: 2.0 }, { type: 'sidewalk', w: 2.0 }];
  const S15 = [{ type: 'sidewalk', w: 2.5 }, { type: 'parking', w: 2.0 }, { type: 'lane', w: 3.0, dir: -1 }, { type: 'lane', w: 3.0, dir: 1 }, { type: 'parking', w: 2.0 }, { type: 'sidewalk', w: 2.5 }];
  function roadSpec(Wm, major, type) {
    let W = U.clamp(Wm, 4, 40);
    if (major) W = Math.max(W, 18);
    const old = type !== 'newtown';
    const base = old ? { overhead: W < 20, trees: { on: W >= 15 }, scheme: 'combined' } : { scheme: 'separate' };
    if (W < 5.2) return { k: 'shared6', o: { ...base, segs: [{ type: 'shared', w: 4 }], overhead: false, trees: { on: false } }, cls: '골목길' };
    if (W < 7.4) return { k: 'shared6', o: { ...base, overhead: false, trees: { on: false } }, cls: '골목길' };
    if (W < 9.2) return { k: 'shared8', o: { ...base, overhead: false, trees: { on: !old } }, cls: '이면도로' };
    if (W < 11.2) return { k: 'so1', o: { ...base, ...(type === 'oldtown' ? { segs: S10 } : {}), trees: { on: false } }, cls: '소로' };
    if (W < 13.6) return { k: 'jung3', o: { ...base, ...(old ? { segs: S12 } : {}) }, cls: '중로' };
    if (W < 17.6) return { k: 'jung2', o: { ...base, ...(old ? { segs: S15 } : {}) }, cls: '중로' };
    if (W < 22.6) return { k: 'jung1', o: base, cls: '중로' };
    return { k: 'dae3', o: base, cls: '대로' };
  }
  MI.roadSpec = roadSpec;
  MI.widthClass = (Wm, major) => { const sp = roadSpec(Wm, major, 'newtown'); return C.PRESETS[sp.k].segs.reduce((s, g) => s + g.w, 0); };

  /* res: MI.run 결과, o: {type, lat, title} */
  MI.build = function (res, o) {
    o = o || {};
    const type = MI.TYPES[o.type] ? o.type : 'newtown';
    const P = M.newProject('import');
    P.meta.title = o.title || '가져온 지도';
    P.meta.scheme = type === 'newtown' ? 'separate' : 'combined';
    P.meta.importType = type;
    P.meta.defaultUse = 'res';
    P.site = { w: res.site.w, h: res.site.h };
    P.settings.lat = o.lat || 36.6;
    const cnt = {};
    res.streets.forEach((s) => {
      if (s.pts.length < 2) return;
      const sp = roadSpec(s.w, s.major, type);
      cnt[sp.cls] = (cnt[sp.cls] || 0) + 1;
      P.roads.push(M.makeRoad(sp.k, s.pts, { ...sp.o, name: `${sp.cls} ${cnt[sp.cls]}` }));
    });
    let D = Dv.derive(P, null);
    // 가구별 용도·획지 수
    const cls = res.cls, mpp = res.site.w / Math.max(1, cls.w - 1);
    const frac = (poly, arr) => {
      let xs = Infinity, xe = -Infinity, ys = Infinity, ye = -Infinity;
      poly.forEach((p) => { xs = Math.min(xs, p[0]); xe = Math.max(xe, p[0]); ys = Math.min(ys, p[1]); ye = Math.max(ye, p[1]); });
      let n = 0, hit = 0;
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
        const p = [xs + ((i + 0.5) / 9) * (xe - xs), ys + ((j + 0.5) / 9) * (ye - ys)];
        if (!U.pointInPoly(p, poly)) continue;
        n++;
        const px = Math.round(p[0] / mpp), py = Math.round(cls.h - 1 - p[1] / mpp);
        if (px >= 0 && py >= 0 && px < cls.w && py < cls.h && arr[py * cls.w + px]) hit++;
      }
      return n ? hit / n : 0;
    };
    const rw = new Map(P.roads.map((r) => [r.id, Dv.roadWidth(r)]));
    const apply = (kLot) => {
      D.blocks.forEach((blk) => {
        const S = blk.settings;
        const dims = blk.dims || { long: Math.sqrt(blk.area), short: Math.sqrt(blk.area) };
        const maxW = Math.max(0, ...blk.roads.map((id) => rw.get(id) || 0));
        const hsh = U.hashStr(blk.poly.length + ':' + Math.round(blk.area) + ':' + Math.round(dims.long));
        const gf = frac(blk.poly, cls.green), wf = frac(blk.poly, cls.water);
        const set = (use, lw, rows, bld, more) => { S.use = use; S.bld = bld || {}; S.lots = {}; S.lotsAlong = U.clamp(Math.round(dims.long / (lw * kLot)), 1, 12); S.lotRows = rows; Object.assign(S, more || {}); };
        const rows = dims.short >= 38 ? 2 : 1;
        if (gf > 0.42) { set('park', 999, 1, {}, { parkType: blk.area < 1500 ? 'pocket' : blk.area < 10000 ? 'children' : blk.area < 30000 ? 'neighborhood' : 'walk' }); return; }
        if (wf > 0.42) { set('green', 999, 1); return; }
        if (blk.area < 220 || dims.short < 9) { set(blk.area < 120 ? 'green' : 'plaza', 999, 1); return; }
        if (type === 'newtown') {
          if (maxW >= 22) { if (blk.area > 9000 && hsh % 2) set('off', 46, rows, { floors: 10 }, { vary: 0.2 }); else set('com', 32, rows, { floors: 6 }, { vary: 0.2 }); }
          else if (maxW >= 14) set('mixed', 30, rows, {}, { vary: 0.2 });
          else if (blk.area > 13000) set('res', 62, dims.short > 95 ? 2 : 1, { style: 'apt', floors: 7, side: 8, front: 5 }, { vary: 0 });
          else set('res', 22, rows, { floors: 3 }, { vary: 0.15 });
        } else if (type === 'oldtown') {
          if (maxW >= 10.5) set('mixed', 13, rows, { style: 'shop_old', floors: 3, groundH: 4.0, floorH: 3.0, front: 0, side: 0, depth: 14 }, { vary: 0.35, styleVary: true });
          else if (hsh % 3 === 0) set('res', 12, rows, { style: 'house', floors: 2, groundH: 3.0, floorH: 2.8, front: 1.5, side: 1.0, depth: 12 }, { vary: 0.35, styleVary: true });
          else set('res', 14, rows, { style: 'res_multi', floors: 4, groundH: 3.0, floorH: 2.8, front: 1.0, side: 0.8 }, { vary: 0.35, styleVary: true });
        } else {
          if (maxW >= 14) set('mixed', 16, rows, { style: 'shop_new', floors: 3, front: 1, side: 0.5, depth: 16 }, { vary: 0.3 });
          else if (hsh % 10 < 7) set('res', 13, rows, { style: 'house', floors: 2, groundH: 3.0, floorH: 2.8, front: 1.5, side: 1.0, depth: 12 }, { vary: 0.3, styleVary: true });
          else set('res', 15, rows, { style: 'res_multi', floors: 3, front: 1.2, side: 1.0 }, { vary: 0.3 });
        }
      });
      D = Dv.derive(P, null);
    };
    apply(1);
    for (let k = 1.4; D.lots.length > 520 && k < 4; k *= 1.4) apply(k); // 획지가 너무 많으면 크게 나눔
    return { P, D };
  };
})(typeof window !== 'undefined' ? window : globalThis);
