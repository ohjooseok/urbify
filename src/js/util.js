/* Urbify — 공용 수학·기하 유틸리티 */
(function (G) {
  'use strict';
  const UDS = (G.UDS = G.UDS || {});
  UDS.VERSION = 'v__UDS_VERSION__'; // build.py가 VERSION 파일 값과 빌드 날짜로 채운다
  UDS.BUILD = '__UDS_BUILD__';
  const U = (UDS.U = {});

  U.EPS = 1e-9;
  U.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);
  U.clone = (o) => JSON.parse(JSON.stringify(o));
  U.round = (v, d = 2) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  U.fmt = (v, d = 1) => {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  U.fmt0 = (v) => U.fmt(v, 0);

  // 시드 난수 (mulberry32)
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.hashStr = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  // 2D 벡터
  U.add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  U.sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  U.mul = (a, s) => [a[0] * s, a[1] * s];
  U.dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  U.cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  U.len = (a) => Math.hypot(a[0], a[1]);
  U.dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  U.norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
  U.perpL = (a) => [-a[1], a[0]];
  U.perpR = (a) => [a[1], -a[0]];
  U.mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  U.dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  U.angle = (a) => Math.atan2(a[1], a[0]);
  U.rot = (a, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [a[0] * c - a[1] * s, a[0] * s + a[1] * c]; };

  U.polyArea = (P) => {
    let s = 0;
    for (let i = 0, n = P.length; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
    return s / 2;
  };
  U.polyCentroid = (P) => {
    let cx = 0, cy = 0, A = 0;
    for (let i = 0, n = P.length; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const c = a[0] * b[1] - b[0] * a[1];
      A += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
    }
    if (Math.abs(A) < 1e-9) {
      let sx = 0, sy = 0; P.forEach((p) => { sx += p[0]; sy += p[1]; });
      return [sx / P.length, sy / P.length];
    }
    return [cx / (3 * A), cy / (3 * A)];
  };
  U.polyBounds = (P) => {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    P.forEach((p) => { if (p[0] < minx) minx = p[0]; if (p[1] < miny) miny = p[1]; if (p[0] > maxx) maxx = p[0]; if (p[1] > maxy) maxy = p[1]; });
    return { minx, miny, maxx, maxy };
  };
  U.pointInPoly = (p, P) => {
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-300) + xi) inside = !inside;
    }
    return inside;
  };
  U.lineIntersect = (p1, d1, p2, d2) => {
    const c = U.cross(d1, d2);
    if (Math.abs(c) < 1e-9 * (U.len(d1) * U.len(d2) + 1e-12)) return null;
    const t = U.cross(U.sub(p2, p1), d2) / c;
    return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
  };
  U.distPointSeg = (p, a, b) => {
    const ab = U.sub(b, a); const l2 = U.dot(ab, ab);
    let t = l2 > 0 ? U.dot(U.sub(p, a), ab) / l2 : 0;
    t = U.clamp(t, 0, 1);
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    return { d: U.dist(p, q), t, q };
  };
  // 선분 교차: 교차 시 {t,u,p}
  U.segIntersect = (a, b, c, d, tol = 1e-7) => {
    const r = U.sub(b, a), s = U.sub(d, c);
    const den = U.cross(r, s);
    if (Math.abs(den) < 1e-12) return null;
    const t = U.cross(U.sub(c, a), s) / den;
    const u = U.cross(U.sub(c, a), r) / den;
    if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
    return { t: U.clamp(t, 0, 1), u: U.clamp(u, 0, 1), p: [a[0] + r[0] * t, a[1] + r[1] * t] };
  };

  // 반평면 클리핑: dot(x - p0, n) >= 0 인 부분 유지
  U.clipHalfPlane = (P, p0, n) => {
    const out = [];
    const f = (p) => (p[0] - p0[0]) * n[0] + (p[1] - p0[1]) * n[1];
    for (let i = 0, m = P.length; i < m; i++) {
      const a = P[i], b = P[(i + 1) % m];
      const fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {
        const t = fa / (fa - fb);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return U.cleanPoly(out);
  };

  U.cleanPoly = (P, eps = 1e-4) => {
    const out = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (out.length && U.dist(out[out.length - 1], p) < eps) continue;
      out.push(p);
    }
    if (out.length > 1 && U.dist(out[0], out[out.length - 1]) < eps) out.pop();
    // 일직선 위의 점 제거
    let changed = true;
    while (changed && out.length > 3) {
      changed = false;
      for (let i = 0; i < out.length; i++) {
        const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
        const cr = U.cross(U.sub(b, a), U.sub(c, b));
        if (Math.abs(cr) < 1e-6 * (U.dist(a, b) + U.dist(b, c) + 1e-9)) { out.splice(i, 1); changed = true; break; }
      }
    }
    return out;
  };

  /**
   * 변별 거리 내부 오프셋 (CCW 다각형). dists[i]: 변 i(P[i]→P[i+1])의 오프셋 거리.
   * 반환: {pts, src} — src[k]: 결과 변 k의 원본 변 번호(-1은 단차 연결변). 실패 시 null.
   */
  U.offsetPoly = (P, dists) => {
    const n = P.length;
    if (n < 3) return null;
    let lines = [];
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const dir = U.sub(b, a);
      const L = U.len(dir);
      if (L < 1e-6) continue;
      const nrm = U.perpL(U.mul(dir, 1 / L));
      const d = dists[i] || 0;
      lines.push({ p: [a[0] + nrm[0] * d, a[1] + nrm[1] * d], dir, nrm, d, src: i, a, b });
    }
    for (let iter = 0; iter < 64 && lines.length >= 3; iter++) {
      const m = lines.length;
      const pts = [], src = [], owner = [];
      for (let k = 0; k < m; k++) {
        const L0 = lines[(k - 1 + m) % m], L1 = lines[k];
        const X = U.lineIntersect(L0.p, L0.dir, L1.p, L1.dir);
        const par = !X || U.dist(X, L1.a) > 50 * (Math.abs(L0.d) + Math.abs(L1.d) + 1);
        if (par) {
          const pa = [L1.a[0] + L0.nrm[0] * L0.d, L1.a[1] + L0.nrm[1] * L0.d];
          const pb = [L1.a[0] + L1.nrm[0] * L1.d, L1.a[1] + L1.nrm[1] * L1.d];
          if (U.dist(pa, pb) < 1e-6) { pts.push(pb); src.push(L1.src); owner.push(k); }
          else { pts.push(pa); src.push(-1); owner.push(-1); pts.push(pb); src.push(L1.src); owner.push(k); }
        } else { pts.push(X); src.push(L1.src); owner.push(k); }
      }
      // 뒤집힌 변 찾기
      let worst = -1, worstVal = 0;
      for (let q = 0; q < pts.length; q++) {
        const k = owner[q];
        if (k < 0) continue;
        const s = pts[q], e = pts[(q + 1) % pts.length];
        const v = U.dot(U.sub(e, s), lines[k].dir) / (U.len(lines[k].dir) || 1);
        if (v < -1e-6 && v < worstVal) { worstVal = v; worst = k; }
      }
      if (worst < 0) {
        const A = U.polyArea(pts);
        if (A <= 1e-3) return null;
        return { pts, src };
      }
      lines.splice(worst, 1);
    }
    return null;
  };

  // 다각형의 주방향 프레임: 지정 변(또는 최장 변) 방향 u, 내부 방향 v
  U.frameFromEdge = (P, a, b) => {
    const u = U.norm(U.sub(b, a));
    const v = U.perpL(u);
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    P.forEach((p) => {
      const du = U.dot(U.sub(p, a), u), dv = U.dot(U.sub(p, a), v);
      umin = Math.min(umin, du); umax = Math.max(umax, du); vmin = Math.min(vmin, dv); vmax = Math.max(vmax, dv);
    });
    return { o: a, u, v, umin, umax, vmin, vmax };
  };
  U.fromFrame = (F, du, dv) => [F.o[0] + F.u[0] * du + F.v[0] * dv, F.o[1] + F.u[1] * du + F.v[1] * dv];

  // 최소 면적 외접 사각형(변 방향 후보) → {len, wid, angle}
  U.minRect = (P) => {
    let best = null;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if (U.dist(a, b) < 1e-6) continue;
      const F = U.frameFromEdge(P, a, b);
      const L = F.umax - F.umin, W = F.vmax - F.vmin;
      const area = L * W;
      if (!best || area < best.area) best = { area, a: Math.max(L, W), b: Math.min(L, W), F };
    }
    return best;
  };

  /* 다각형 P 안에 들어가는 가장 큰 직사각형(변이 u축·v축에 나란함). v를 꼭짓점 높이와 고른 간격(nStep)으로 띠로 나누고,
     띠마다 들어가는 u 구간을 겹쳐 가며 넓이가 가장 큰 것을 고른다(띠 안에서는 경계가 직선이라 양 끝의 구간을 겹치면 됨).
     돌려주는 꼭짓점은 반시계 방향: {pts, area, w(u 방향), h(v 방향)} */
  U.maxRectIn = (P, u, nStep, anchor) => { // anchor: 아래 변(v가 가장 작은 쪽)을 다각형의 맨 아래에 붙인 것만
    if (!P || P.length < 3) return null;
    u = U.norm(u);
    const v = U.perpL(u), o = P[0];
    const Q = P.map((p) => { const dx = p[0] - o[0], dy = p[1] - o[1]; return [dx * u[0] + dy * u[1], dx * v[0] + dy * v[1]]; });
    let y0 = Infinity, y1 = -Infinity;
    Q.forEach((q) => { if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; });
    if (!(y1 - y0 > 1e-3)) return null;
    const N = nStep || 16, ys = Q.map((q) => q[1]);
    for (let i = 1; i < N; i++) ys.push(y0 + ((y1 - y0) * i) / N);
    ys.sort((a, b) => a - b);
    const Y = [];
    ys.forEach((y) => { if (!Y.length || y - Y[Y.length - 1] > 1e-3) Y.push(y); });
    const slice = (y) => {
      const xs = [];
      for (let i = 0, m = Q.length; i < m; i++) {
        const a = Q[i], b = Q[(i + 1) % m];
        if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      const out = [];
      for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([xs[i], xs[i + 1]]);
      return out;
    };
    const inter = (A, B) => {
      const out = [];
      let i = 0, j = 0;
      while (i < A.length && j < B.length) {
        const lo = Math.max(A[i][0], B[j][0]), hi = Math.min(A[i][1], B[j][1]);
        if (hi > lo + 1e-6) out.push([lo, hi]);
        if (A[i][1] < B[j][1]) i++; else j++;
      }
      return out;
    };
    const strips = [];
    for (let k = 0; k + 1 < Y.length; k++) { const a = Y[k], b = Y[k + 1], e = Math.min(1e-4, (b - a) / 4); strips.push(inter(slice(a + e), slice(b - e))); }
    let best = null;
    for (let k = 0; k < (anchor ? Math.min(1, strips.length) : strips.length); k++) {
      let cur = strips[k];
      for (let m = k; m < strips.length; m++) {
        if (m > k) cur = inter(cur, strips[m]);
        if (!cur.length) break;
        const hgt = Y[m + 1] - Y[k];
        for (let t = 0; t < cur.length; t++) { const A = (cur[t][1] - cur[t][0]) * hgt; if (!best || A > best.A) best = { A, x0: cur[t][0], x1: cur[t][1], y0: Y[k], y1: Y[m + 1] }; }
      }
    }
    if (!best) return null;
    const W = (x, y) => [o[0] + u[0] * x + v[0] * y, o[1] + u[1] * x + v[1] * y];
    return { pts: [W(best.x0, best.y0), W(best.x1, best.y0), W(best.x1, best.y1), W(best.x0, best.y1)], area: best.A, w: best.x1 - best.x0, h: best.y1 - best.y0 };
  };
  /* 네 꼭짓점이 모두 직각인 사각형인가(방향은 묻지 않음) */
  U.isRect = (P, tol) => {
    if (!P || P.length !== 4) return false;
    const t = tol || 0.01;
    for (let i = 0; i < 4; i++) {
      const a = P[(i + 3) % 4], b = P[i], c = P[(i + 1) % 4];
      const d1 = U.norm(U.sub(a, b)), d2 = U.norm(U.sub(c, b));
      if (Math.abs(U.dot(d1, d2)) > t) return false;
    }
    return true;
  };

  U.interiorPoint = (P) => {
    const c = U.polyCentroid(P);
    if (U.pointInPoly(c, P)) return c;
    const bb = U.polyBounds(P);
    // 수평 스캔라인 중간점
    for (let k = 1; k < 20; k++) {
      const y = bb.miny + ((bb.maxy - bb.miny) * k) / 20;
      const xs = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let j = 0; j + 1 < xs.length; j += 2) if (xs[j + 1] - xs[j] > 0.5) return [(xs[j] + xs[j + 1]) / 2, y];
    }
    return c;
  };

  // 폴리라인 오프셋(왼쪽 +)
  U.offsetPolyline = (pts, off) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let n;
      if (i === 0) n = U.perpL(U.norm(U.sub(pts[1], pts[0])));
      else if (i === pts.length - 1) n = U.perpL(U.norm(U.sub(pts[i], pts[i - 1])));
      else {
        const n0 = U.perpL(U.norm(U.sub(pts[i], pts[i - 1])));
        const n1 = U.perpL(U.norm(U.sub(pts[i + 1], pts[i])));
        let m = U.norm(U.add(n0, n1));
        const c = U.dot(m, n1);
        n = U.mul(m, 1 / Math.max(c, 0.3));
      }
      out.push([p[0] + n[0] * off, p[1] + n[1] * off]);
    }
    return out;
  };
  U.polylineLength = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += U.dist(pts[i - 1], pts[i]); return L; };
  // 폴리라인 위의 거리 s 지점: {p, dir}
  U.pointAlong = (pts, s) => {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = U.dist(pts[i - 1], pts[i]);
      if (acc + L >= s || i === pts.length - 1) {
        const t = L > 0 ? U.clamp((s - acc) / L, 0, 1) : 0;
        const dir = U.norm(U.sub(pts[i], pts[i - 1]));
        return { p: [U.lerp(pts[i - 1][0], pts[i][0], t), U.lerp(pts[i - 1][1], pts[i][1], t)], dir };
      }
      acc += L;
    }
    return { p: pts[0], dir: [1, 0] };
  };

  U.arcPoints = (c, r, a0, a1, segs) => {
    const out = [];
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const n = segs || Math.max(4, Math.ceil(Math.abs(da) / (Math.PI / 16)));
    for (let i = 0; i <= n; i++) { const a = a0 + (da * i) / n; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
    return out;
  };

  U.hexToRgb = (h) => {
    const s = h.replace('#', '');
    const v = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  };
  U.rgbToHex = (r) => '#' + r.map((x) => Math.round(U.clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  U.shade = (h, k) => { const c = U.hexToRgb(h); return U.rgbToHex(c.map((x) => (k >= 0 ? x + (1 - x) * k : x * (1 + k)))); };

  U.mix = (a, b, t) => { const A = U.hexToRgb(a), B = U.hexToRgb(b); return U.rgbToHex(A.map((x, i) => x + (B[i] - x) * t)); };
  U.debounce = (fn, ms) => { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
})(typeof window !== 'undefined' ? window : globalThis);

/* 공용 상수·태양 위치 */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U;
  UDS.FONT = "'Noto Sans KR', 'Noto Sans CJK KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
  /* 날짜: 1월 1일부터 센 날(1~365, 평년). 예전 파일의 계절(season)은 그 계절의 대표 날로 읽는다.
     춘분·하지·추분·동지 날은 교과서 값(적위 0°, ±23.44°), 그 밖의 날은 Spencer(1971) 식 */
  UDS.KEY_DAYS = [[80, '춘분'], [172, '하지'], [266, '추분'], [356, '동지']];
  const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  UDS.dayOf = function (S) {
    const d = S ? +S.doy : NaN;
    if (d >= 1 && d <= 365) return Math.round(d);
    const s = (S && S.season) || 'winter';
    return s === 'summer' ? 172 : s === 'equinox' ? 80 : 356;
  };
  UDS.snapDay = function (d) { for (const [k] of UDS.KEY_DAYS) if (Math.abs(d - k) <= 2) return k; return Math.round(d); }; // 막대를 끌 때 춘분·하지·추분·동지에 붙는다
  UDS.keyDay = function (d) { const k = UDS.KEY_DAYS.find((x) => x[0] === d); return k ? k[1] : ''; };
  UDS.monthDay = function (d) { let m = 0; while (m < 11 && d > MDAYS[m]) { d -= MDAYS[m]; m++; } return [m + 1, d]; };
  UDS.monthStart = (m) => { let d = 1; for (let i = 0; i < m - 1; i++) d += MDAYS[i]; return d; };
  UDS.fmtDate = function (d, short) { const [m, dd] = UDS.monthDay(d); return short ? `${m}/${dd}` : `${m}월 ${dd}일`; };
  UDS.declDeg = function (S) {
    const d = UDS.dayOf(S);
    if (d === 172) return 23.44;
    if (d === 356) return -23.44;
    if (d === 80 || d === 266) return 0;
    const g = (2 * Math.PI * (d - 1)) / 365;
    return (0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)) * 180 / Math.PI;
  };
  /* 위도·날짜·시각(태양시)으로 태양 방위각(북=0, 시계방향)과 고도(rad) */
  UDS.sunVector = function (S) {
    const lat = ((S && S.lat) || 36.6) * Math.PI / 180;
    const decl = UDS.declDeg(S) * Math.PI / 180;
    const hour = S && S.hour !== undefined ? S.hour : 12;
    const H = (15 * (hour - 12)) * Math.PI / 180;
    const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
    const az = azS + Math.PI;
    return { az, alt, dir: [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)] };
  };
  /* 일출·일몰 시각(태양시). 극야·백야가 아니면 [일출, 일몰] */
  UDS.sunTimes = function (S) {
    const lat = ((S && S.lat) || 36.6) * Math.PI / 180;
    const decl = UDS.declDeg(S) * Math.PI / 180;
    const c = U.clamp(-Math.tan(lat) * Math.tan(decl), -1, 1);
    const h0 = Math.acos(c) * 180 / Math.PI / 15;
    return [12 - h0, 12 + h0];
  };
  UDS.fmtTime = function (h) { h = ((h % 24) + 24) % 24; const hh = Math.floor(h + 1e-6), mm = Math.round((h - hh) * 60); return `${hh}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`; };
  /* 시각에 따른 하늘·빛 상태. 평면·3D·단면이 같은 값을 쓴다.
     day: 0(밤)~1(낮), gold: 해가 낮게 걸린 정도, glow: 조명이 켜진 정도(0이면 꺼짐) */
  UDS.sky = function (S) {
    const sun = UDS.sunVector(S);
    const altD = sun.alt * 180 / Math.PI;
    const ss = (a, b, x) => { const t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const day = ss(-6, 9, altD);
    const gold = U.clamp(1 - Math.abs(altD - 3) / 11, 0, 1);
    const mode = (S && S.lights) || 'auto';
    const on = mode === 'on' || (mode === 'auto' && day < 0.72);
    const glow = on ? Math.max(0.3, 1 - day) : 0;
    const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    // 직사광(해 또는 달)
    const sunI = ss(-1, 12, altD);
    let lightCol = mix3([1.0, 0.62, 0.34], [1.0, 0.965, 0.9], ss(2, 22, altD)).map((v) => v * 0.68 * sunI);
    let dir = sun.dir, moon = false;
    if (altD < -1) { // 달빛: 해 반대편, 고도 35° 이상
      moon = true;
      const az = sun.az + Math.PI, alt = Math.max(35 * Math.PI / 180, -sun.alt);
      dir = [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
      lightCol = [0.5, 0.62, 0.95].map((v) => v * 0.13 * ss(-1, -9, altD));
    } else if (sun.alt < 0.03) { const alt = 0.03; dir = [Math.sin(sun.az) * Math.cos(alt), Math.cos(sun.az) * Math.cos(alt), Math.sin(alt)]; }
    let ambSky = mix3([0.085, 0.115, 0.2], [0.6, 0.645, 0.7], day);
    let ambGnd = mix3([0.05, 0.06, 0.1], [0.44, 0.44, 0.45], day);
    ambSky = mix3(ambSky, [0.56, 0.47, 0.52], gold * 0.45 * day);
    // 하늘색(위·지평선)
    let top = mix3([0.03, 0.05, 0.13], [0.80, 0.885, 0.895], day);
    let hor = mix3([0.09, 0.13, 0.26], [0.985, 0.968, 0.945], day);
    top = mix3(top, [0.47, 0.52, 0.68], gold * 0.6);
    hor = mix3(hor, [0.985, 0.74, 0.56], gold * 0.8);
    const hex = (c) => U.rgbToHex(c);
    return {
      sun, altD, day, night: 1 - day, gold, glow, on, mode, moon, dir, lightCol, ambSky, ambGnd,
      top, hor, topHex: hex(top), horHex: hex(hor),
      shadows: !moon && sun.alt > 0.035,
      dark: (top[0] + top[1] + top[2]) / 3 < 0.5,
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
