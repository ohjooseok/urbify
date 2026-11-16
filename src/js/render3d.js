/* Urbify — WebGL2 3D 렌더러(입면 스타일 셰이더, 그림자, 선 도면, 지하 투시, 선택) */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C;

  /* ---------- 행렬 ---------- */
  const M4 = {
    persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2), nf = 1 / (n - f); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]; },
    ortho(l, r, b, t, n, f) { return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]; },
    lookAt(e, c, up) {
      let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; let l = Math.hypot(...z); z = z.map((v) => v / l);
      let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]; l = Math.hypot(...x) || 1; x = x.map((v) => v / l);
      const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
    },
    mul(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
    inv(m) {
      const a = m, o = new Array(16);
      const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
      const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!det) return null; det = 1 / det;
      o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
      o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
      o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
      o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
      return o;
    },
    xf(m, v) { const x = v[0], y = v[1], z = v[2], w = v[3] === undefined ? 1 : v[3]; return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w]; },
  };

  /* ---------- 다각형 삼각분할(귀 자르기) ---------- */
  function earcut(pts) {
    const n = pts.length;
    if (n < 3) return [];
    const ccw = U.polyArea(pts) > 0;
    const idx = []; for (let i = 0; i < n; i++) idx.push(i);
    const tris = [];
    const cr = (a, b, c) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
    const inTri = (p, a, b, c) => {
      const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
      const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
      const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
      const neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12, pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
      return !(neg && pos);
    };
    for (let guard = 0; idx.length > 3 && guard < 4 * n * n; guard++) {
      let ear = false;
      for (let i = 0; i < idx.length; i++) {
        const a = idx[(i - 1 + idx.length) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
        const k = cr(a, b, c);
        if (ccw ? k <= 1e-12 : k >= -1e-12) continue;
        let ok = true;
        for (const j of idx) { if (j === a || j === b || j === c) continue; if (inTri(pts[j], pts[a], pts[b], pts[c])) { ok = false; break; } }
        if (!ok) continue;
        tris.push(a, b, c); idx.splice(i, 1); ear = true; break;
      }
      if (!ear) { for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]); return tris; }
    }
    if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
    return tris;
  }
  UDS.earcut = earcut;

  /* ---------- 지오메트리 빌더 ---------- */
  function Builder() { this.P = []; this.N = []; this.Cl = []; this.UV = []; this.S1 = []; this.S2 = []; this.K = []; this.I = []; this.n = 0; }
  const B = Builder.prototype;
  B.v = function (p, n, c, uv, s1, s2, k) {
    this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.Cl.push(c[0], c[1], c[2]);
    this.UV.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
    if (s1) this.S1.push(s1[0], s1[1], s1[2], s1[3]); else this.S1.push(0, 0, 0, 0);
    if (s2) this.S2.push(s2[0], s2[1], s2[2], s2[3]); else this.S2.push(0, 0, 0, 0);
    k = k || [0, 0, 0]; this.K.push(k[0], k[1], k[2]);
    return this.n++;
  };
  const W3 = (p, y) => [p[0], y, -p[1]];
  /* 이 뒤로 쌓는 삼각형의 갈래 이름(3D 모델 내보내기에서 묶음으로 씀) */
  B.tag = function (t) { const T = this.tags || (this.tags = []); if (!T.length || T[T.length - 1][1] !== t) T.push([this.I.length, t]); return this; };
  B.flat = function (pts, y, col, k, kind) {
    if (!pts || pts.length < 3) return;
    const t = earcut(pts);
    const base = this.n;
    const c = typeof col === 'string' ? U.hexToRgb(col) : col;
    pts.forEach((p) => this.v(W3(p, y), [0, 1, 0], c, null, null, [0, 0, 0, kind || 0], k));
    for (let i = 0; i < t.length; i += 3) this.I.push(base + t[i], base + t[i + 1], base + t[i + 2]);
  };
  B.quad = function (a, b, c, d, nrm, col, uvs, s1, s2, k) {
    const cc = typeof col === 'string' ? U.hexToRgb(col) : col;
    const i0 = this.v(a, nrm, cc, uvs && uvs[0], s1, s2, k), i1 = this.v(b, nrm, cc, uvs && uvs[1], s1, s2, k);
    const i2 = this.v(c, nrm, cc, uvs && uvs[2], s1, s2, k), i3 = this.v(d, nrm, cc, uvs && uvs[3], s1, s2, k);
    this.I.push(i0, i1, i2, i0, i2, i3);
  };
  B.tri = function (a, b, c, nrm, col, s2, k) {
    const cc = typeof col === 'string' ? U.hexToRgb(col) : col;
    const i0 = this.v(a, nrm, cc, null, null, s2, k), i1 = this.v(b, nrm, cc, null, null, s2, k), i2 = this.v(c, nrm, cc, null, null, s2, k);
    this.I.push(i0, i1, i2);
  };
  B.box = function (cx, cy, w, d, y0, h, rot, col, k, kind) {
    const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    const P2 = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map((p) => [cx + p[0] * c - p[1] * s, cy + p[0] * s + p[1] * c]);
    this.prism(P2, y0, y0 + h, col, k, kind);
    return P2;
  };
  B.prism = function (P2, y0, y1, col, k, kind) {
    const cc = typeof col === 'string' ? U.hexToRgb(col) : col;
    let pts = P2;
    if (U.polyArea(pts) < 0) pts = pts.slice().reverse();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const n2 = U.perpR(U.norm(U.sub(b, a)));
      this.quad(W3(a, y0), W3(b, y0), W3(b, y1), W3(a, y1), [n2[0], 0, -n2[1]], cc, null, null, [0, 0, 0, kind || 0], k);
    }
    this.flat(pts, y1, cc, k, kind);
  };
  /* 고리(원판 r0 < r < r1)를 바닥 높이 y에. r0가 0이면 원판 */
  B.annulus = function (c, r0, r1, y, col, k) {
    const cc = typeof col === 'string' ? U.hexToRgb(col) : col;
    const n = U.clamp(Math.ceil((Math.PI * 2 * r1) / 1.0), 24, 180);
    const P0 = (a, r) => W3([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r], y);
    if (r0 <= 0.01) {
      const ic = this.v(W3(c, y), [0, 1, 0], cc, null, null, null, k);
      const ring = [];
      for (let i = 0; i < n; i++) ring.push(this.v(P0((i / n) * Math.PI * 2, r1), [0, 1, 0], cc, null, null, null, k));
      for (let i = 0; i < n; i++) this.I.push(ic, ring[i], ring[(i + 1) % n]);
      return;
    }
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      this.quad(P0(a0, r1), P0(a1, r1), P0(a1, r0), P0(a0, r0), [0, 1, 0], cc, null, null, null, k);
    }
  };
  /* 둥근 연석 띠(반지름 r, 높이 y0~y1, 두께 t) */
  B.ringWall = function (c, r, t, y0, y1, col, k) {
    const cc = typeof col === 'string' ? U.hexToRgb(col) : col;
    const n = U.clamp(Math.ceil((Math.PI * 2 * r) / 1.2), 24, 160);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
      const p = (a, rr, y) => W3([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr], y);
      this.quad(p(a0, r + t / 2, y0), p(a1, r + t / 2, y0), p(a1, r + t / 2, y1), p(a0, r + t / 2, y1), [Math.cos(am), 0, -Math.sin(am)], cc, null, null, null, k);
      this.quad(p(a0, r - t / 2, y1), p(a1, r - t / 2, y1), p(a1, r - t / 2, y0), p(a0, r - t / 2, y0), [-Math.cos(am), 0, Math.sin(am)], cc, null, null, null, k);
      this.quad(p(a0, r + t / 2, y1), p(a1, r + t / 2, y1), p(a1, r - t / 2, y1), p(a0, r - t / 2, y1), [0, 1, 0], cc, null, null, null, k);
    }
  };
  B.cyl = function (cx, cy, r, y0, y1, col, sides, k, kind) {
    const cc = typeof col === 'string' ? U.hexToRgb(col) : col;
    const n = sides || 6;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
      const am = (a0 + a1) / 2;
      this.quad(W3(p0, y0), W3(p1, y0), W3(p1, y1), W3(p0, y1), [Math.cos(am), 0, -Math.sin(am)], cc, null, null, [0, 0, 0, kind || 0], k);
    }
  };
  B.ellipsoid = function (cx, cy, yc, rx, ry, col, seg, k, kind) {
    const cc = typeof col === 'string' ? U.hexToRgb(col) : col;
    const nu = seg || 10, nv = Math.max(4, Math.round((seg || 10) * 0.6));
    const base = this.n;
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * Math.PI, sv = Math.sin(v), cv = Math.cos(v);
      for (let i = 0; i <= nu; i++) {
        const u = (i / nu) * Math.PI * 2;
        const nx = Math.cos(u) * sv, nz = Math.sin(u) * sv, ny = cv;
        this.v([cx + nx * rx, yc + ny * ry, -cy + nz * rx], [nx, ny, nz], cc, null, null, [0, 0, 0, kind || 0], k);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + nu + 1;
      this.I.push(a, b, a + 1, b, b + 1, a + 1);
    }
  };
  B.cone = function (cx, cy, y0, r, h, col, sides, k, kind) {
    const cc = typeof col === 'string' ? U.hexToRgb(col) : col;
    const n = sides || 10;
    const tip = [cx, y0 + h, -cy];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
      const p0 = [cx + Math.cos(a0) * r, y0, -(cy + Math.sin(a0) * r)], p1 = [cx + Math.cos(a1) * r, y0, -(cy + Math.sin(a1) * r)];
      const sl = r / Math.hypot(r, h);
      this.tri(p0, p1, tip, [Math.cos(am) * (1 - sl), sl + 0.3, -Math.sin(am) * (1 - sl)], cc, [0, 0, 0, kind || 0], k);
    }
  };
  B.strip = function (pts, w, y, col, k, kind) {
    if (pts.length < 2) return;
    const L = U.offsetPolyline(pts, w / 2), R = U.offsetPolyline(pts, -w / 2);
    for (let i = 0; i + 1 < pts.length; i++) this.flat([R[i], R[i + 1], L[i + 1], L[i]], y, col, k, kind);
  };

  function LineSet() { this.P = []; this.Cl = []; }
  LineSet.prototype.seg = function (a, b, col) { this.P.push(a[0], a[1], a[2], b[0], b[1], b[2]); const c = col || [0, 0, 0]; this.Cl.push(c[0], c[1], c[2], c[0], c[1], c[2]); };
  LineSet.prototype.poly2 = function (pts, y, close, col) { for (let i = 0; i + 1 < pts.length; i++) this.seg(W3(pts[i], y), W3(pts[i + 1], y), col); if (close && pts.length > 2) this.seg(W3(pts[pts.length - 1], y), W3(pts[0], y), col); };
  LineSet.prototype.boxEdges = function (P2, y0, y1) { this.poly2(P2, y0, true); this.poly2(P2, y1, true); P2.forEach((p) => this.seg(W3(p, y0), W3(p, y1))); };

  /* ---------- 셰이더 ---------- */
  const VS = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm; layout(location=2) in vec3 a_col;
layout(location=3) in vec2 a_uv; layout(location=4) in vec4 a_st1; layout(location=5) in vec4 a_st2; layout(location=6) in vec3 a_pick;
uniform mat4 u_vp; uniform mat4 u_lvp;
out vec3 v_pos; out vec3 v_nrm; out vec3 v_col; out vec2 v_uv; flat out vec4 v_st1; flat out vec4 v_st2; out vec4 v_lpos; flat out vec3 v_pick; // 면마다 같은 값은 보간하지 않는다(flat)
void main(){ v_pos=a_pos; v_nrm=a_nrm; v_col=a_col; v_uv=a_uv; v_st1=a_st1; v_st2=a_st2; v_pick=a_pick; v_lpos=u_lvp*vec4(a_pos,1.0); gl_Position=u_vp*vec4(a_pos,1.0); }`;

  const FS = `#version 300 es
precision highp float; precision highp sampler2DShadow; precision mediump sampler2DArray;
in vec3 v_pos; in vec3 v_nrm; in vec3 v_col; in vec2 v_uv; flat in vec4 v_st1; flat in vec4 v_st2; in vec4 v_lpos; flat in vec3 v_pick;
uniform vec3 u_sun; uniform float u_line; uniform float u_shadowOn; uniform sampler2DShadow u_shadow; uniform float u_alpha; uniform vec3 u_eye; uniform float u_pickMode;
uniform sampler2DArray u_cmTex; uniform vec4 u_cm[12]; uniform vec3 u_cmA[12]; // 이미지 재료: 층마다 (무늬 가로·세로 m, 거울 반복, 그림 있음), 평균색
uniform vec3 u_sels[48]; uniform int u_nsel; uniform float u_fade; uniform vec3 u_fog; uniform vec4 u_center;
uniform vec3 u_sunCol; uniform vec3 u_ambSky; uniform vec3 u_ambGnd; uniform float u_glow; uniform float u_lit; uniform sampler2D u_lamp; uniform vec4 u_lampRect;
out vec4 o;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float rectM(vec2 p, vec4 r){ vec2 w=max(fwidth(p),vec2(1e-4)); vec2 a=smoothstep(r.xy-w,r.xy+w,p)*(1.0-smoothstep(r.zw-w,r.zw+w,p)); return a.x*a.y; }
float rectE(vec2 p, vec4 r){ vec2 w=max(fwidth(p),vec2(1e-4))*1.3; float i=rectM(p,r); float j=rectM(p,r+vec4(w,-w)); return clamp(i-j,0.0,1.0); }
float hline(float y, float c){ float w=max(fwidth(y),1e-4); return 1.0-smoothstep(0.0, w*1.2, abs(y-c)); }
vec3 SIGNC(float t){ t=fract(t)*6.0; return t<1.0?vec3(0.85,0.18,0.15):t<2.0?vec3(0.98,0.78,0.15):t<3.0?vec3(0.15,0.45,0.85):t<4.0?vec3(0.2,0.65,0.3):t<5.0?vec3(0.92,0.45,0.1):vec3(0.95,0.95,0.92); }
vec3 facade(out float glass, out float ln, out vec3 em){
  glass=0.0; ln=0.0; em=vec3(0.0);
  vec3 WARM=vec3(1.0,0.80,0.50);
  float fh=max(v_st1.x,2.4), gh=max(v_st1.y,2.4), bw=max(v_st1.z,1.0), wwr=clamp(v_st1.w,0.05,0.95);
  // 정수 부호(창 종류·칸 수·1층·재료·간판)는 반올림해 읽는다: 그래픽 카드마다 보간 오차로 30.0이 29.9999가 되면 창 종류가 바뀌어 벽에 유리 얼룩이 생긴다
  vec3 sc2=floor(v_st2.xyz+0.5);
  int win=int(mod(sc2.x,10.0)+0.5); float nbc=floor(sc2.x/10.0+0.01); int gr=int(sc2.y+0.5); float mp=sc2.z; float mat=mod(mp,10.0); float sg=floor(mp/10.0+0.01);
  // 이미지 재료: 1000 + 층×10 + 간판
  int cmi=-1; if(mp>999.5){ float q=mp-1000.0; float cl=floor(q/10.0+0.01); sg=q-cl*10.0; cmi=int(cl+0.5); mat=5.0; }
  float x=v_uv.x, y=v_uv.y;
  vec3 wall=v_col; vec3 c=wall;
  vec3 gls=vec3(0.30,0.38,0.46); vec3 fr=vec3(0.18,0.19,0.2);
  // 재료 질감(약하게)
  // 줄눈·이음매는 화면에서 촘촘해지면(멀리서 보면) 흐리게 지워 얼룩(무아레)이 생기지 않게 한다
  float fwy=fwidth(y), fwx=fwidth(x);
  if(mat<0.5){ float row=floor(y/0.075); float br=fract((x+mod(row,2.0)*0.105)/0.21); float jt=max(hline(fract(y/0.075),0.0), 1.0-smoothstep(0.0,0.06,br)); float fd=1.0-smoothstep(0.006,0.02,fwy); c=mix(c, c*0.82, jt*0.35*fd); c*=1.0+(0.12*h21(vec2(floor((x+mod(row,2.0)*0.105)/0.21),row))-0.06)*fd; c*=1.0-0.04*(1.0-fd); }
  else if(mat<1.5){ float jt=max(hline(fract(y/0.6),0.0),hline(fract(x/1.2),0.0)); c=mix(c,c*0.85,jt*0.6*(1.0-smoothstep(0.05,0.15,max(fwy,fwx*0.5)))); c*=0.97+0.06*h21(vec2(floor(x/1.2),floor(y/0.6)))*(1.0-smoothstep(0.05,0.15,fwy)); }
  else if(mat<2.5){ float jt=max(hline(fract(y/0.9),0.0),hline(fract(x/1.8),0.0)); c=mix(c,c*0.9,jt*0.5*(1.0-smoothstep(0.08,0.22,max(fwy,fwx*0.5)))); }
  else if(mat<3.5){ float jt=hline(fract(x/1.0),0.0); c=mix(c,c*0.78,jt*0.7*(1.0-smoothstep(0.08,0.25,fwx))); }
  else if(mat<5.5){ }
  else { float jt=max(hline(fract(y/0.3),0.0),hline(fract(x/0.3),0.0)); c=mix(c,c*0.9,jt*0.4*(1.0-smoothstep(0.02,0.07,max(fwy,fwx)))); }
  if(cmi>=0&&cmi<12){
    // 그림 한 장이 무늬 크기(m)만큼 덮도록 되풀이. 거울 반복은 한 장 건너 뒤집는다. 벽 색을 평균색에서 바꾸면 그 비율로 물든다
    vec4 cm=u_cm[cmi];
    if(cm.w>0.5){
      vec2 t=vec2(x,y)/max(cm.xy,vec2(0.01));
      vec2 tt=cm.z>0.5?1.0-abs(mod(t,2.0)-1.0):t;
      vec3 tx=textureGrad(u_cmTex,vec3(tt,float(cmi)),dFdx(t),dFdy(t)).rgb;
      c=tx*clamp(wall/max(u_cmA[cmi],vec3(0.03)),0.0,3.0); wall=c;
    }
  }
  float bay=floor(x/bw); float bx=fract(x/bw);
  // 벽 양 끝의 기둥(모서리)에는 창을 내지 않는다: nbc = 칸 수 + 1(0이면 제한 없음)
  bool noWin = (nbc>0.5 && (x<0.0 || bay>nbc-1.5)) || v_st1.w<0.0; // st1.w<0: 난간벽처럼 창이 없는 벽
  if(noWin){ if(!(gr<6 && y<gh)){ float yy0 = gr<6 ? y-gh : y; ln=max(ln,hline(fract(yy0/fh),0.0)*0.35); } }
  else if(gr<6 && y<gh){
    float fy=y/gh; vec2 q=vec2(bx,fy);
    float signTop=(gh-0.15)/gh, signBot=(gh-1.05)/gh;
    if(gr==0){ // 상가
      vec4 R=vec4(0.04,0.03,0.96,signBot-0.02);
      float m=rectM(q,R); c=mix(c,gls,m); glass=m; ln=max(ln,rectE(q,R));
      float mull=1.0-smoothstep(0.0,max(fwidth(bx),1e-4)*1.5,abs(bx-0.5)); c=mix(c,fr,mull*m*0.8);
      em=m*(1.0-mull*0.7)*vec3(1.0,0.86,0.62)*(0.75+0.25*h21(vec2(bay,mp+1.0)));
      vec4 S=vec4(0.03,signBot,0.97,signTop);
      if(sg>0.5&&sg<1.5){ float ms=rectM(q,S); vec3 sc=SIGNC(h21(vec2(bay,mp))+bay*0.37); c=mix(c,sc,ms); em=mix(em,sc*0.75,ms); ln=max(ln,rectE(q,S)); }
      else if(sg>1.5){ vec4 S2=vec4(0.25,signBot+0.25*(signTop-signBot),0.75,signTop-0.25*(signTop-signBot)); float ms=rectM(q,S2); c=mix(c,vec3(0.22,0.24,0.26),ms); em=mix(em,vec3(0.95,0.92,0.84)*0.7,ms); ln=max(ln,rectE(q,S2)); }
    } else if(gr==1){ vec4 R=vec4(0.03,0.0,0.97,0.9); float m=rectM(q,R); c=mix(c,gls*1.1,m); glass=m; em=m*vec3(1.0,0.88,0.68)*0.8; ln=max(ln,rectE(q,R)); }
    else if(gr==2){ vec4 R=vec4(0.3,0.35,0.7,0.8); float m=rectM(q,R); c=mix(c,gls,m); glass=m*0.6; em=m*WARM*0.45*step(0.4,h21(vec2(bay,mp+5.0))); ln=max(ln,rectE(q,R)); if(mod(bay,3.0)<0.5){ vec4 D=vec4(0.35,0.0,0.65,0.75); float md=rectM(q,D); c=mix(c,vec3(0.35,0.28,0.22),md); em*=1.0-md; ln=max(ln,rectE(q,D)); } }
    else if(gr==3){ float col=1.0-rectM(q,vec4(0.1,0.0,0.9,1.0)); c=mix(vec3(0.16,0.16,0.17),wall*0.9,col); em=(1.0-col)*WARM*0.12; ln=max(ln,rectE(q,vec4(0.1,0.0,0.9,1.0))); }
    else if(gr==4){ float col=1.0-rectM(q,vec4(0.12,0.0,0.88,0.82)); vec3 inner=mix(gls*0.6,vec3(0.25),0.5); c=mix(inner,wall,col); em=(1.0-col)*WARM*0.55; ln=max(ln,rectE(q,vec4(0.12,0.0,0.88,0.82))); }
    else { }
  } else {
    float yy = gr<6 ? y-gh : y; float fl=floor(yy/fh); float fy=fract(yy/fh); vec2 q=vec2(bx,fy);
    vec4 R;
    if(win==0){ float a=sqrt(wwr); float hw=clamp(a*0.55,0.12,0.42); R=vec4(0.5-hw,0.3,0.5+hw,min(0.3+a*0.85,0.92)); }
    else if(win==1){ R=vec4(0.0,0.32,1.0,min(0.32+wwr*0.75,0.95)); }
    else if(win==2){ R=vec4(0.36,0.12,0.64,0.92); }
    else { R=vec4(0.0,0.0,1.0,1.0); }
    float m=rectM(q,R);
    // 불 켜진 방: 층·칸마다 다르게, 일부는 흰빛
    float on=step(h21(vec2(bay*1.7+mp,fl*3.1+7.0)),u_lit);
    vec3 lc=mix(WARM,vec3(0.86,0.92,1.0),step(0.82,h21(vec2(fl+3.0,bay+mp*0.7))))*(0.7+0.3*h21(vec2(bay+9.0,fl)));
    if(win==3){ c=mix(gls*1.05,vec3(0.5,0.6,0.7),0.25*h21(vec2(bay,fl))); glass=1.0; float mull=max(1.0-smoothstep(0.0,max(fwidth(bx),1e-4)*1.2,min(bx,1.0-bx)), hline(fy,0.0)); c=mix(c,fr,mull*0.7); em=on*lc*0.8*(1.0-mull); ln=max(ln,mull); }
    else { c=mix(c,gls*(0.9+0.2*h21(vec2(bay,fl))),m); glass=m; em=m*on*lc; ln=max(ln,rectE(q,R)); if(win==1){ float pier=1.0-smoothstep(0.0,max(fwidth(bx),1e-4)*1.5,abs(bx-0.5)); c=mix(c,fr,pier*m*0.7); em*=1.0-pier*0.7; } }
    if(win!=3){
      // 가까이 볼 때만 그리는 잔 요소: 창틀, 창 안쪽 그늘(인방·옆벽), 창턱, 층 슬래브 띠
      float pm=max(fwidth(x),fwidth(y)); float fd=1.0-smoothstep(0.035,0.11,pm);
      float sb=1.0-smoothstep(0.0,max(fwidth(fy),1e-4)*1.2,fy-0.16/fh);
      c*=1.0-0.06*sb*(1.0-m)*(1.0-smoothstep(0.08,0.25,pm));
      if(fd>0.0){
        vec2 fw=vec2(0.06/bw,0.06/fh);
        float inner=rectM(q,R+vec4(fw,-fw));
        float frm=clamp(m-inner,0.0,1.0);
        vec3 fcol=mix(vec3(0.2,0.21,0.22),vec3(0.88,0.88,0.86),step(0.45,h21(v_pick.xy*91.7+3.1)));
        float top=smoothstep(R.w-0.16/fh,R.w-0.02/fh,fy);
        float side=1.0-smoothstep(R.x+0.02/bw,R.x+0.12/bw,bx);
        c*=1.0-inner*fd*(0.38*top+0.2*side);
        c=mix(c,fcol,frm*fd);
        if(win==0 && (R.z-R.x)*bw>1.3){ float mu=1.0-smoothstep(0.03/bw,0.03/bw+max(fwidth(bx),1e-4),abs(bx-0.5)); c=mix(c,fcol,mu*inner*fd); em*=1.0-mu*inner*fd; }
        if(R.y>0.02){
          vec4 S=vec4(R.x-0.05/bw,R.y-0.06/fh,R.z+0.05/bw,R.y);
          float ms=rectM(q,S), msh=rectM(q,vec4(S.x,S.y-0.08/fh,S.z,S.y));
          c=mix(c,mix(wall,vec3(0.93),0.55),ms*fd); c*=1.0-msh*fd*0.22;
        }
        em*=1.0-frm*fd;
      }
    }
    if(sg>0.5&&sg<1.5&&gr<6&&fl<1.0&&h21(vec2(bay,mp+3.0))>0.55){ vec4 S=vec4(0.08,0.1,0.92,0.8); float ms=rectM(q,S); vec3 sc=SIGNC(h21(vec2(bay,mp+7.0))); c=mix(c,sc,ms); em=mix(em,sc*0.75,ms); ln=max(ln,rectE(q,S)); }
    ln=max(ln,hline(fy,0.0)*0.35);
  }
  return c;
}
/* 수관의 불투명도: 기본값(u_alpha)에서, 눈에 가까운 수관일수록 더 옅게 해 시야를 가리지 않게 한다 */
float leafA(){ if(u_alpha>0.999) return 1.0; return u_alpha*mix(0.72,1.0,smoothstep(6.0,30.0,distance(u_eye,v_pos))); }
void main(){
  if(u_pickMode>0.5){ o=vec4(v_pick,1.0); return; }
  vec3 n=normalize(v_nrm);
  float kind=v_st2.w; float glass=0.0, ln=0.0; vec3 em=vec3(0.0);
  if(kind>7.5&&kind<8.5){ o=vec4(v_col,u_alpha); return; } // 분석·표시용 덧그림(빛과 그림자를 받지 않음)
  vec3 base=v_col;
  if(kind>0.5&&kind<1.5) base=facade(glass,ln,em);
  vec3 V=normalize(u_eye-v_pos);
  bool sel=false; for(int i=0;i<48;i++){ if(i>=u_nsel) break; if(distance(v_pick,u_sels[i])<0.0015){ sel=true; break; } }
  if(u_line>0.5){
    vec3 c=vec3(1.0);
    if(sel) c=vec3(0.82,0.94,0.91);
    if(kind>0.5&&kind<1.5) c=mix(c,vec3(0.0),clamp(ln,0.0,1.0)*0.85);
    if(kind>3.5&&kind<4.5){ float rim=1.0-abs(dot(n,V)); c=mix(c,vec3(0.0),smoothstep(0.62,0.8,rim)); o=vec4(c,max(leafA(),smoothstep(0.62,0.8,rim))); return; }
    o=vec4(c,u_alpha); return;
  }
  float ndl=max(dot(n,u_sun),0.0);
  float sh=1.0;
  if(u_shadowOn>0.5){ vec3 lp=v_lpos.xyz/v_lpos.w*0.5+0.5; if(lp.x>0.0&&lp.x<1.0&&lp.y>0.0&&lp.y<1.0&&lp.z<1.0){ vec2 ts=1.0/vec2(textureSize(u_shadow,0)); float s=0.0; for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++) s+=texture(u_shadow,vec3(lp.xy+vec2(i,j)*ts*1.2,lp.z-0.0012)); sh=s/9.0; } }
  // 하늘빛(위쪽 면일수록 밝게)과 직사광. 그늘에서는 하늘빛도 조금 줄여 그림자를 또렷하게
  vec3 amb=mix(u_ambGnd,u_ambSky,clamp(n.y*0.5+0.5,0.0,1.0));
  vec3 col=base*(amb*mix(0.84,1.0,sh)+u_sunCol*ndl*sh);
  if(kind>3.5&&kind<4.5){ col*=0.93+0.14*h21(floor(v_pos.xz*1.5)); }
  if(glass>0.0){ // 유리: 하늘(위)·땅(아래)을 비추고, 비스듬히 볼수록 더 비친다. 해가 비치는 곳엔 반짝임
    vec3 r=reflect(-V,n);
    vec3 skyR=r.y>0.0 ? mix(u_fog*1.02,u_ambSky*1.25+u_fog*0.2,smoothstep(0.0,0.7,r.y)) : mix(u_fog*0.88,u_ambGnd*0.8,smoothstep(0.0,-0.3,r.y));
    float fz=pow(1.0-max(dot(n,V),0.0),3.0);
    col=mix(col,skyR,(0.2+fz*0.55)*glass);
    col+=u_sunCol*pow(max(dot(r,u_sun),0.0),160.0)*sh*0.9*glass;
  }
  if(kind>0.5&&kind<1.5) col*=mix(0.74,1.0,smoothstep(0.0,1.8,v_pos.y)); // 벽 아래쪽(땅에 닿는 곳)을 조금 어둡게
  if(u_glow>0.001){
    // 가로등 빛(위에서 내려다본 밝기 지도), 켜진 창·간판, 등기구
    vec2 luv=(v_pos.xz-u_lampRect.xy)*u_lampRect.zw;
    if(luv.x>0.0&&luv.x<1.0&&luv.y>0.0&&luv.y<1.0){ float lm=texture(u_lamp,luv).r; float lf=clamp(1.0-v_pos.y/11.0,0.0,1.0); col+=base*vec3(1.0,0.80,0.52)*lm*lf*lf*mix(0.5,1.0,clamp(n.y,0.0,1.0))*1.35*u_glow; }
    col+=em*u_glow*1.05;
    if(kind>6.5&&kind<7.5) col=mix(col,vec3(1.0,0.95,0.80)*1.1,u_glow);
  }
  if(sel) col=mix(col,vec3(0.17,0.60,0.51),0.36);
  if(kind>5.5&&kind<6.5){ float d=distance(v_pos.xz,u_center.xy); col=mix(col,u_fog,smoothstep(u_center.z,u_center.w,d)); }
  col=mix(col,vec3(1.0),u_fade);
  o=vec4(col,(kind>3.5&&kind<4.5)?leafA():u_alpha);
}`;

  const LVS = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=2) in vec3 a_col; uniform mat4 u_vp; out vec3 v_col;
void main(){ v_col=a_col; gl_Position=u_vp*vec4(a_pos,1.0); }`;
  const LFS = `#version 300 es
precision highp float; in vec3 v_col; uniform float u_black; out vec4 o; void main(){ o=vec4(u_black>0.5?vec3(0.0):v_col,1.0); }`;
  const DVS = `#version 300 es
layout(location=0) in vec3 a_pos; uniform mat4 u_lvp; void main(){ gl_Position=u_lvp*vec4(a_pos,1.0); }`;
  const DFS = `#version 300 es
precision highp float; out vec4 o; void main(){ o=vec4(1.0); }`;
  /* 하천 구멍: 깊이만 가장 멀게 쓴다 */
  const PVS = `#version 300 es
layout(location=0) in vec3 a_pos; uniform mat4 u_vp; void main(){ gl_Position=u_vp*vec4(a_pos,1.0); }`;
  const PFS = `#version 300 es
precision highp float; out vec4 o; void main(){ o=vec4(0.0); gl_FragDepth=1.0; }`;

  /* 수목: 스케치업의 face-me 나무처럼 납작한 그림 한 장이 늘 카메라 쪽으로(세로축으로만) 돈다.
     a_ofs: (가로 오프셋, 세로 오프셋, 그림 u, v)  a_col: (색, 높이 비율)  a_kb: (0 세운 그림 · 1 위에서 본 수관, 그림자 치우침 m)
     거의 바로 위에서 내려다보면 세운 그림 대신 수관 높이에 눕힌 둥근 수관을 보인다(납작한 그림이 선처럼 보이지 않게) */
  const BVS = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec4 a_ofs; layout(location=2) in vec4 a_col; layout(location=3) in vec3 a_pick; layout(location=4) in vec2 a_kb;
uniform mat4 u_vp; uniform mat4 u_lvp; uniform vec3 u_eye;
out vec2 v_uv; out vec3 v_col; out vec3 v_pick; out vec3 v_pos; out vec4 v_lpos; out float v_h; out float v_bias; out float v_kind;
void main(){
  vec3 p; bool show=true;
  vec3 v=u_eye-a_pos; float el=v.y/max(length(v),1e-3);
  if(a_kb.x<0.5){
    vec2 d=u_eye.xz-a_pos.xz; float L=length(d); vec2 n=L>1e-4?d/L:vec2(0.0,1.0);
    p=a_pos+vec3(n.y*a_ofs.x,a_ofs.y,-n.x*a_ofs.x);
    if(el>0.985) show=false;
  } else {
    p=a_pos+vec3(a_ofs.x,0.0,a_ofs.y);
    if(el<0.86) show=false;
  }
  if(!show) p=a_pos;
  v_uv=a_ofs.zw; v_col=a_col.rgb; v_h=a_col.a; v_pick=a_pick; v_pos=p; v_bias=a_kb.y; v_kind=a_kb.x;
  v_lpos=u_lvp*vec4(p,1.0); gl_Position=u_vp*vec4(p,1.0);
}`;
  const BFS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec2 v_uv; in vec3 v_col; in vec3 v_pick; in vec3 v_pos; in vec4 v_lpos; in float v_h; in float v_bias; in float v_kind;
uniform sampler2D u_tex; uniform sampler2DShadow u_shadow; uniform sampler2D u_lamp; uniform vec4 u_lampRect;
uniform float u_line; uniform float u_shadowOn; uniform float u_pickMode; uniform float u_glow; uniform float u_lzs; uniform float u_a2c;
uniform vec3 u_sun; uniform vec3 u_sunCol; uniform vec3 u_ambSky; uniform vec3 u_ambGnd; uniform vec3 u_eye;
uniform vec3 u_sels[48]; uniform int u_nsel;
out vec4 o;
void main(){
  vec4 t=texture(u_tex,v_uv);
  float a=t.a;
  if(u_a2c>0.5){ a=clamp((a-0.5)/max(fwidth(a),1e-4)+0.5,0.0,1.0); if(a<0.02) discard; }
  else { if(a<0.5) discard; a=1.0; }
  if(u_pickMode>0.5){ o=vec4(v_pick,1.0); return; }
  bool sel=false; for(int i=0;i<48;i++){ if(i>=u_nsel) break; if(distance(v_pick,u_sels[i])<0.0015){ sel=true; break; } }
  if(u_line>0.5){ vec3 c=vec3(t.r); if(sel) c*=vec3(0.82,0.94,0.91); o=vec4(c,a); return; }
  vec3 base=mix(v_col,vec3(0.47,0.38,0.30),t.g);
  float edge=mix(0.4,1.0,t.r);
  float sh=1.0;
  if(u_shadowOn>0.5){ vec3 lp=v_lpos.xyz/v_lpos.w*0.5+0.5; if(lp.x>0.0&&lp.x<1.0&&lp.y>0.0&&lp.y<1.0&&lp.z<1.0){ vec2 ts=1.0/vec2(textureSize(u_shadow,0)); float s=0.0; for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++) s+=texture(u_shadow,vec3(lp.xy+vec2(i,j)*ts*1.5,lp.z-v_bias*u_lzs)); sh=s/9.0; } }
  // 해가 보는 사람 쪽에 있으면 밝은 면, 나무 뒤에 있으면 그늘진 면이 보인다
  float face=v_kind>0.5?clamp(u_sun.y,0.0,1.0):0.5+0.5*dot(normalize(u_eye.xz-v_pos.xz+vec2(1e-4)),normalize(u_sun.xz+vec2(1e-4)));
  vec3 amb=mix(u_ambGnd,u_ambSky,0.68+0.32*v_h)*1.08;
  vec3 col=base*edge*(amb*mix(0.9,1.0,sh)+u_sunCol*sh*mix(0.3,0.78,face)*smoothstep(-0.02,0.12,u_sun.y));
  if(u_glow>0.001){ vec2 luv=(v_pos.xz-u_lampRect.xy)*u_lampRect.zw; if(luv.x>0.0&&luv.x<1.0&&luv.y>0.0&&luv.y<1.0){ float lm=texture(u_lamp,luv).r; float lf=clamp(1.0-v_pos.y/11.0,0.0,1.0); col+=base*edge*vec3(1.0,0.80,0.52)*lm*lf*lf*1.1*u_glow; } }
  if(sel) col=mix(col,vec3(0.17,0.60,0.51),0.36);
  o=vec4(col,a);
}`;
  function BB() { this.P = []; this.O = []; this.Cl = []; this.K = []; this.KB = []; this.I = []; this.n = 0; }
  BB.prototype.v = function (p, o, c, h, k, kind, bias) { this.P.push(p[0], p[1], p[2]); this.O.push(o[0], o[1], o[2], o[3]); this.Cl.push(c[0], c[1], c[2], h); this.K.push(k[0], k[1], k[2]); this.KB.push(kind, bias); return this.n++; };
  BB.prototype.quad = function (p, os, c, hs, k, kind, bias) { const i = os.map((o, j) => this.v(p, o, c, hs[j], k || [0, 0, 0], kind, bias)); this.I.push(i[0], i[1], i[2], i[0], i[2], i[3]); };

  /* 사람·차량: 단위 도형(상자·팔각기둥·구)을 인스턴스로 찍는다.
     인스턴스: 자리, 크기(길이·높이·너비), 진행 방향, 색, (윗면 길이 비율, 윗면 너비 비율, 윗면 앞뒤 밀림, 발광 종류), 눕힘 */
  const AHEAD = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm; layout(location=2) in vec2 a_uv;
layout(location=3) in vec3 i_pos; layout(location=4) in vec3 i_size; layout(location=5) in vec2 i_rot;
layout(location=6) in vec3 i_col; layout(location=7) in vec4 i_par; layout(location=8) in float i_axis;
vec3 g_n;
vec3 place(){
  vec3 p=a_pos, n=a_nrm;
  if(i_axis>0.5){ p=vec3(p.x,p.z+0.5,p.y-0.5); n=vec3(n.x,n.z,n.y); }
  float t=p.y;
  p.x=p.x*mix(1.0,i_par.x,t)+i_par.z*t;
  p.z=p.z*mix(1.0,i_par.y,t);
  vec3 f=vec3(i_rot.x,0.0,-i_rot.y), r=vec3(i_rot.y,0.0,i_rot.x);
  g_n=normalize(f*(n.x/max(i_size.x,0.001))+vec3(0.0,n.y/max(i_size.y,0.001),0.0)+r*(n.z/max(i_size.z,0.001)));
  return i_pos+f*(p.x*i_size.x)+vec3(0.0,p.y*i_size.y,0.0)+r*(p.z*i_size.z);
}`;
  const AVS = AHEAD + `
uniform mat4 u_vp; uniform mat4 u_lvp;
out vec3 v_pos; out vec3 v_nrm; out vec3 v_col; out vec2 v_uv; out vec4 v_lpos; out float v_em;
void main(){ vec3 w=place(); v_pos=w; v_nrm=g_n; v_col=i_col; v_uv=a_uv; v_em=i_par.w; v_lpos=u_lvp*vec4(w,1.0); gl_Position=u_vp*vec4(w,1.0); }`;
  const ADVS = AHEAD + `
uniform mat4 u_lvp; void main(){ gl_Position=u_lvp*vec4(place(),1.0); }`;
  const AFS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 v_pos; in vec3 v_nrm; in vec3 v_col; in vec2 v_uv; in vec4 v_lpos; in float v_em;
uniform vec3 u_sun; uniform vec3 u_sunCol; uniform vec3 u_ambSky; uniform vec3 u_ambGnd; uniform vec3 u_eye; uniform vec3 u_fog;
uniform float u_line; uniform float u_shadowOn; uniform float u_glow; uniform float u_round;
uniform sampler2DShadow u_shadow; uniform sampler2D u_lamp; uniform vec4 u_lampRect;
out vec4 o;
void main(){
  vec3 n=normalize(v_nrm);
  vec3 V=normalize(u_eye-v_pos);
  if(u_line>0.5){
    float k=0.0;
    if(u_round>0.5){ float rim=1.0-abs(dot(n,V)); k=smoothstep(0.6,0.82,rim); }
    else { float e=min(min(v_uv.x,1.0-v_uv.x),min(v_uv.y,1.0-v_uv.y)); k=1.0-smoothstep(0.0,fwidth(e)*1.5,e); }
    o=vec4(vec3(1.0-k),1.0); return;
  }
  float ndl=max(dot(n,u_sun),0.0);
  float sh=1.0;
  if(u_shadowOn>0.5){ vec3 lp=v_lpos.xyz/v_lpos.w*0.5+0.5; if(lp.x>0.0&&lp.x<1.0&&lp.y>0.0&&lp.y<1.0&&lp.z<1.0){ vec2 ts=1.0/vec2(textureSize(u_shadow,0)); float s=0.0; for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++) s+=texture(u_shadow,vec3(lp.xy+vec2(i,j)*ts*1.2,lp.z-0.0016)); sh=s/9.0; } }
  vec3 amb=mix(u_ambGnd,u_ambSky,clamp(n.y*0.5+0.5,0.0,1.0));
  vec3 col=v_col*(amb*mix(0.84,1.0,sh)+u_sunCol*ndl*sh);
  if(v_em>2.5){ float fz=pow(1.0-max(dot(n,V),0.0),3.0); col=mix(col,u_fog*0.92,0.2+fz*0.45); }
  if(u_glow>0.001){
    vec2 luv=(v_pos.xz-u_lampRect.xy)*u_lampRect.zw;
    if(luv.x>0.0&&luv.x<1.0&&luv.y>0.0&&luv.y<1.0){ float lm=texture(u_lamp,luv).r; col+=v_col*vec3(1.0,0.80,0.52)*lm*mix(0.5,1.0,clamp(n.y,0.0,1.0))*1.2*u_glow; }
    if(v_em>0.5&&v_em<1.5) col=mix(col,vec3(1.0,0.96,0.84)*1.15,u_glow);
    else if(v_em>1.5&&v_em<2.5) col=mix(col,vec3(1.0,0.2,0.14),u_glow*0.9);
  }
  o=vec4(col,1.0);
}`;

  function compile(gl, vs, fs) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const cache = {};
    const u = new Proxy(cache, { get: (t, k) => (k in t ? t[k] : (t[k] = gl.getUniformLocation(p, k))) });
    return { p, u };
  }

  function upload(gl, b) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bufs = [];
    const attr = (arr, loc, size) => { const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); bufs.push(buf); };
    attr(b.P, 0, 3); attr(b.N, 1, 3); attr(b.Cl, 2, 3); attr(b.UV, 3, 2); attr(b.S1, 4, 4); attr(b.S2, 5, 4); attr(b.K, 6, 3);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(b.I), gl.STATIC_DRAW); bufs.push(ib);
    gl.bindVertexArray(null);
    return { vao, bufs, count: b.I.length };
  }
  function uploadLines(gl, L) {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const bufs = [];
    [[L.P, 0], [L.Cl, 2]].forEach(([arr, loc]) => { const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); bufs.push(buf); });
    gl.bindVertexArray(null);
    return { vao, bufs, count: L.P.length / 3 };
  }
  function uploadBB(gl, b) {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const bufs = [];
    const attr = (arr, loc, size) => { const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); bufs.push(buf); };
    attr(b.P, 0, 3); attr(b.O, 1, 4); attr(b.Cl, 2, 4); attr(b.K, 3, 3); attr(b.KB, 4, 2);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(b.I), gl.STATIC_DRAW); bufs.push(ib);
    gl.bindVertexArray(null);
    return { vao, bufs, count: b.I.length };
  }
  function free(gl, m) { if (!m) return; m.bufs.forEach((b) => gl.deleteBuffer(b)); gl.deleteVertexArray(m.vao); }

  /* face-me 나무 그림 모음(텍스처 한 장): 수종마다 두 가지 + 위에서 본 수관.
     R: 선 그림(면 1 · 외곽선 0 · 안쪽 가지 선 0.55)  G: 보이는 줄기·가지  A: 덮는 범위 */
  const ATL = { cw: 400, ch: 480, cols: 4, pad: 14 };
  function treeAtlas(gl) {
    const Fg = UDS.Fig;
    if (!Fg || !Fg.treeModel || typeof document === 'undefined') return null;
    const keys = C.TREE_ORDER, nCell = keys.length * 2 + 1, cols = ATL.cols, rows = Math.ceil(nCell / cols);
    const W = cols * ATL.cw, H = rows * ATL.ch;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const cA = mk(), cB = mk(), tA = cA.getContext('2d', { willReadFrequently: true }), tB = cB.getContext('2d', { willReadFrequently: true });
    const LINE = { fill: '#ffffff', edge: '#000000', wood: '#ffffff', inner: '#b8b8b8' };
    const MASK = { fill: '#000000', edge: '#000000', wood: '#ffffff', inner: '#000000' };
    const cellXY = (i) => [(i % cols) * ATL.cw, Math.floor(i / cols) * ATL.ch];
    const paint = (M, cx, cy, pxm, sc) => {
      [[tA, LINE], [tB, MASK]].forEach(([t, pal]) => {
        t.save(); t.beginPath(); t.rect(cx, cy, ATL.cw, ATL.ch); t.clip();
        t.setTransform(pxm, 0, 0, -pxm, cx + ATL.pad - M.bx0 * pxm, cy + ATL.pad + M.by1 * pxm);
        t.lineCap = 'round'; t.lineJoin = 'round';
        Fg.paintTree(t, M, sc, false, pal);
        t.restore();
      });
    };
    const info = {};
    let ci = 0;
    keys.forEach((k) => {
      const sp = C.TREES[k];
      info[k] = [1, 2].map((seed) => {
        const [cx, cy] = cellXY(ci++);
        const M = Fg.treeModel(sp, 1, seed, 99, 48, { coarse: true });
        const wm = M.bx1 - M.bx0, hm = M.by1;
        const pxm = Math.min((ATL.cw - ATL.pad * 2) / wm, (ATL.ch - ATL.pad * 2) / hm);
        paint(M, cx, cy, pxm, pxm / 2.1);
        return { x0: M.bx0, x1: M.bx1, y1: M.by1, u0: (cx + ATL.pad) / W, u1: (cx + ATL.pad + wm * pxm) / W, vT: (cy + ATL.pad) / H, vB: (cy + ATL.pad + hm * pxm) / H };
      });
    });
    let top;
    {
      const [cx, cy] = cellXY(ci++);
      const M = Fg.crownTopModel(3);
      const pxm = (Math.min(ATL.cw, ATL.ch) - ATL.pad * 2) / (M.bx1 - M.bx0);
      paint(M, cx, cy, pxm, pxm / 3.2);
      top = { r: M.bx1, u0: (cx + ATL.pad) / W, u1: (cx + ATL.pad + (M.bx1 - M.bx0) * pxm) / W, vT: (cy + ATL.pad) / H, vB: (cy + ATL.pad + (M.by1 - M.bx0) * pxm) / H };
    }
    const da = tA.getImageData(0, 0, W, H).data, db = tB.getImageData(0, 0, W, H).data;
    const out = new Uint8Array(W * H * 4);
    for (let i = 0, n = W * H; i < n; i++) { const j = i * 4; out[j] = da[j]; out[j + 1] = db[j]; out[j + 3] = da[j + 3]; }
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 4);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const an = gl.getExtension('EXT_texture_filter_anisotropic');
    if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    gl.activeTexture(gl.TEXTURE0);
    return { tex, info, top, W, H };
  }

  const LEAF_ALPHA = 0.8;  // 수관의 불투명도(나머지만큼 뒤가 비친다). 가까이 다가가면 조금 더 비친다
  const MAX_SEL = 48;     // 3D에서 한꺼번에 강조하는 선택 요소 수(셰이더의 u_sels 크기와 같아야 함)

  /* ---------- 렌더러 ---------- */
  function Render3D(canvas, app) {
    this.cv = canvas; this.app = app; this.ok = false;
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) return;
    this.gl = gl;
    try {
      this.prog = compile(gl, VS, FS);
      this.lprog = compile(gl, LVS, LFS);
      this.dprog = compile(gl, DVS, DFS);
      try { this.pprog = compile(gl, PVS, PFS); } catch (e) { this.pprog = null; } // 없으면 하천은 지면에 그대로
    } catch (e) { console.error(e); this.err = String(e); return; }
    try { this.aprog = compile(gl, AVS, AFS); this.adprog = compile(gl, ADVS, DFS); this._initAgents(); } catch (e) { console.error(e); this.aprog = null; }
    try { this.bprog = compile(gl, BVS, BFS); } catch (e) { console.error(e); this.bprog = null; }
    this.ok = true;
    this.cam = { tx: 200, ty: 0, tz: -150, yaw: -0.65, pitch: 0.62, dist: 520, fov: 45 * Math.PI / 180 };
    this.meshes = {};
    this.pickTable = [null];
    this.shadowSize = 2048;
    this._initShadow();
    this.lampTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lampTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    this.lampRect = [0, 0, 1, 1];
    this.cmTex = null; this._cmSig = null; this._cmU = new Float32Array(48); this._cmA = new Float32Array(36);
    this._cmSync();
    gl.useProgram(this.prog.p); gl.uniform1i(this.prog.u.u_cmTex, CM_UNIT); // 그림자(0)와 다른 칸: 같은 칸에 종류가 다른 텍스처를 두면 그리지 못한다
    this.dirty = true;
  }
  const Rr = Render3D.prototype;
  const CM_UNIT = 5; // 이미지 재료 텍스처 배열을 두는 칸

  /* 이미지 재료를 텍스처 배열(512×512×재료 수, 밉맵)에 올린다. 재료 차례나 읽어 둔 그림이 바뀔 때만 새로 올리고,
     무늬 크기·거울 반복·평균색은 그릴 때마다 uniform으로 넘긴다. 그림은 위아래를 뒤집어 올린다(벽의 v는 위로 커짐) */
  Rr._cmBind = function (pr) {
    const gl = this.gl;
    this._cmSync();
    gl.activeTexture(gl.TEXTURE0 + CM_UNIT); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.cmTex);
    gl.uniform1i(pr.u.u_cmTex, CM_UNIT);
    gl.uniform4fv(pr.u['u_cm[0]'], this._cmU); gl.uniform3fv(pr.u['u_cmA[0]'], this._cmA);
    gl.activeTexture(gl.TEXTURE1);
  };
  Rr._cmSync = function () {
    const gl = this.gl, app = this.app;
    const mats = (app && app.mats ? app.mats() : []).slice(0, C.CMAT_MAX);
    const imgs = mats.map((m) => (app.matEl ? app.matEl(m.id) : null));
    const sig = mats.map((m, i) => m.id + (imgs[i] ? '+' : '-')).join(',');
    if (sig !== this._cmSig) {
      this._cmSig = sig;
      if (this.cmTex) gl.deleteTexture(this.cmTex);
      const tex = (this.cmTex = gl.createTexture());
      gl.activeTexture(gl.TEXTURE0 + CM_UNIT);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      const any = imgs.some(Boolean), S = any ? C.CMAT_PX : 1, L = Math.max(1, mats.length);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, any ? Math.log2(S) + 1 : 1, gl.RGBA8, S, S, L);
      if (any) {
        const cv = this._cmCv || (this._cmCv = document.createElement('canvas'));
        cv.width = cv.height = S;
        const g = cv.getContext('2d');
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        imgs.forEach((img, i) => {
          if (!img) return;
          g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
          g.setTransform(1, 0, 0, -1, 0, S); g.drawImage(img, 0, 0, S, S);
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, S, S, 1, gl.RGBA, gl.UNSIGNED_BYTE, cv);
        });
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        const an = gl.getExtension('EXT_texture_filter_anisotropic');
        if (an) gl.texParameterf(gl.TEXTURE_2D_ARRAY, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      } else gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.activeTexture(gl.TEXTURE0);
    }
    const u = this._cmU, a = this._cmA;
    u.fill(0); a.fill(0.5);
    mats.forEach((m, i) => {
      u[i * 4] = m.tile[0]; u[i * 4 + 1] = m.tile[1]; u[i * 4 + 2] = m.mirror ? 1 : 0; u[i * 4 + 3] = imgs[i] ? 1 : 0;
      const c = U.hexToRgb(m.color || '#808080'); a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2];
    });
  };

  Rr._initShadow = function () {
    const gl = this.gl, S = this.shadowSize;
    const mk = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, S, S);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return [tex, fbo];
    };
    // shTex: 고정 장면(건물·수목)의 그림자. 장면이나 해가 바뀔 때만 다시 그린다
    // shTexD: 거기에 사람·차량을 더한 것. 움직이는 동안 매 장면 복사해 덧그린다
    [this.shTex, this.shFbo] = mk();
    [this.shTexD, this.shFboD] = mk();
    this._shKey = '';
  };

  /* 사람·차량용 단위 도형과 인스턴스 버퍼 */
  Rr._initAgents = function () {
    const gl = this.gl;
    const mesh = (V, I) => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, 64, gl.DYNAMIC_DRAW);
      [[3, 3, 0], [4, 3, 12], [5, 2, 24], [6, 3, 32], [7, 4, 44], [8, 1, 60]].forEach(([loc, size, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 64, off); gl.vertexAttribDivisor(loc, 1); });
      const eb = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, ib, count: I.length, n: 0 };
    };
    // 상자: x·z는 -0.5~0.5, y는 0~1. 바닥면은 뺀다
    let V = [], I = [];
    const face = (pts, n) => { const b = V.length / 8; pts.forEach((p, k) => V.push(p[0], p[1], p[2], n[0], n[1], n[2], k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0)); I.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    const h = 0.5;
    face([[h, 0, -h], [h, 0, h], [h, 1, h], [h, 1, -h]], [1, 0, 0]);
    face([[-h, 0, h], [-h, 0, -h], [-h, 1, -h], [-h, 1, h]], [-1, 0, 0]);
    face([[h, 0, h], [-h, 0, h], [-h, 1, h], [h, 1, h]], [0, 0, 1]);
    face([[-h, 0, -h], [h, 0, -h], [h, 1, -h], [-h, 1, -h]], [0, 0, -1]);
    face([[-h, 1, -h], [h, 1, -h], [h, 1, h], [-h, 1, h]], [0, 1, 0]);
    const box = mesh(V, I);
    // 팔각기둥(옆면은 둥글게 보이도록 법선을 바깥으로) + 위아래 뚜껑
    V = []; I = [];
    const NS = 10;
    for (let i = 0; i <= NS; i++) { const a = (i / NS) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); V.push(c * h, 0, sn * h, c, 0, sn, 0.5, 0.5, c * h, 1, sn * h, c, 0, sn, 0.5, 0.5); }
    for (let i = 0; i < NS; i++) { const b = i * 2; I.push(b, b + 1, b + 3, b, b + 3, b + 2); }
    [[1, 1], [0, -1]].forEach(([y, ny]) => {
      const b = V.length / 8;
      V.push(0, y, 0, 0, ny, 0, 0.5, 0.5);
      for (let i = 0; i <= NS; i++) { const a = (i / NS) * Math.PI * 2; V.push(Math.cos(a) * h, y, Math.sin(a) * h, 0, ny, 0, 0.5, 0.5); }
      for (let i = 0; i < NS; i++) I.push(b, b + 1 + i, b + 2 + i);
    });
    const cyl = mesh(V, I);
    // 구(지름 1, 바닥이 y=0)
    V = []; I = [];
    const NU = 10, NV = 6;
    for (let j = 0; j <= NV; j++) {
      const v = (j / NV) * Math.PI, sv = Math.sin(v), cv = Math.cos(v);
      for (let i = 0; i <= NU; i++) { const u = (i / NU) * Math.PI * 2, nx = Math.cos(u) * sv, nz = Math.sin(u) * sv; V.push(nx * h, 0.5 + cv * h, nz * h, nx, cv, nz, 0.5, 0.5); }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + NU + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
    const sph = mesh(V, I);
    this.agents = { box, cyl, sph };
  };
  Rr._uploadAgents = function (B) {
    const gl = this.gl, A = this.agents;
    [['box', B.box, B.nBox], ['cyl', B.cyl, B.nCyl], ['sph', B.sph, B.nSph]].forEach(([k, arr, n]) => {
      A[k].n = n;
      if (!n) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, A[k].ib);
      gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, n * 16), gl.DYNAMIC_DRAW);
    });
  };
  Rr._drawAgents = function (pr) {
    const gl = this.gl, A = this.agents;
    ['box', 'cyl', 'sph'].forEach((k) => {
      const m = A[k]; if (!m.n) return;
      if (pr.u.u_round) gl.uniform1f(pr.u.u_round, k === 'box' ? 0 : 1);
      gl.bindVertexArray(m.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, m.n);
    });
    gl.bindVertexArray(null);
  };

  Rr.resize = function () {
    const r = this.cv.getBoundingClientRect();
    const line = this.app.modeOf('3d') === 'line';
    const dpr = Math.min(window.devicePixelRatio || 1, this.lowRes ? 1 : line ? 1.25 : 1.75); // lowRes: 움직임이 버거운 기기에서 해상도를 낮춤
    let w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
    if (this.forceSize) { w = this.forceSize.w; h = this.forceSize.h; } // 그림으로 내보낼 때 잠깐 크게(같은 비율)
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.cssW = r.width; this.cssH = r.height;
  };

  Rr.fit = function (site) {
    this.cam.tx = site.w / 2; this.cam.tz = -site.h / 2; this.cam.ty = 0;
    this.cam.dist = Math.max(site.w, site.h) * 1.25;
    this.cam.pitch = 0.66; this.cam.yaw = -0.6;
  };
  Rr.preset = function (k) {
    const c = this.cam, site = this.app.P.site;
    if (k === 'aerial') { this.fit(site); }
    else if (k === 'persp') { c.ty = 0; c.pitch = 0.3; c.dist = Math.max(site.w, site.h) * 0.7; }
    else if (k === 'top') { c.tx = site.w / 2; c.tz = -site.h / 2; c.pitch = 1.55; c.yaw = 0; c.dist = Math.max(site.w, site.h) * 1.25; c.ty = 0; }
  };
  Rr.orbit = function (dx, dy) { const c = this.cam; c.yaw -= dx * 0.006; c.pitch = U.clamp(c.pitch + dy * 0.005, 0.02, 1.55); };
  Rr.pan = function (dx, dy) {
    const c = this.cam;
    const k = (c.dist * Math.tan(c.fov / 2) * 2) / Math.max(1, this.cssH || 600);
    const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const kf = k / Math.max(0.25, Math.sin(c.pitch));
    c.tx += -rx * dx * k + fx * dy * kf;
    c.tz += -rz * dx * k + fz * dy * kf;
  };
  Rr.zoom = function (k) { this.cam.dist = U.clamp(this.cam.dist * k, 6, 4000); };
  Rr.lookAlong = function (p, dir, dist, pitch) {
    const c = this.cam;
    c.tx = p[0]; c.tz = -p[1]; c.ty = 1.6;
    c.yaw = Math.atan2(-dir[0], dir[1]);
    c.dist = dist || 30; c.pitch = pitch === undefined ? 0.05 : pitch;
  };
  Rr.focus = function (p, dist) { const c = this.cam; c.tx = p[0]; c.tz = -p[1]; c.ty = 0; if (dist) c.dist = dist; };
  Rr.eye = function () {
    const c = this.cam;
    return [c.tx + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.ty + c.dist * Math.sin(c.pitch), c.tz + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
  };
  Rr.matrices = function () {
    const c = this.cam;
    const e = this.eye();
    const V = M4.lookAt(e, [c.tx, c.ty, c.tz], [0, 1, 0]);
    const asp = this.cv.width / Math.max(1, this.cv.height);
    const near = Math.max(0.25, c.dist * 0.004), far = c.dist * 6 + 3000;
    const Pm = M4.persp(c.fov, asp, near, far);
    return { V, Pm, VP: M4.mul(Pm, V), e };
  };
  Rr.rayGround = function (sx, sy) {
    const { VP } = this.matrices();
    const inv = M4.inv(VP);
    if (!inv) return null;
    const x = (sx / this.cssW) * 2 - 1, y = 1 - (sy / this.cssH) * 2;
    const a = M4.xf(inv, [x, y, -1, 1]), b = M4.xf(inv, [x, y, 1, 1]);
    const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const dy = p1[1] - p0[1];
    if (Math.abs(dy) < 1e-9) return null;
    const t = (0 - p0[1]) / dy;
    if (t < 0) return null;
    return [p0[0] + (p1[0] - p0[0]) * t, -(p0[2] + (p1[2] - p0[2]) * t)];
  };

  /* 장면 메시 생성 */
  Rr.rebuild = function () {
    if (!this.ok) return;
    const gl = this.gl;
    if (!this.app.D) return;
    Object.values(this.meshes).forEach((m) => free(gl, m));
    this.meshes = {};
    if (this.bprog && this.atlas === undefined) { try { this.atlas = treeAtlas(gl); } catch (e) { console.error(e); this.atlas = null; } }
    const S = this.buildScene({ atlas: this.bprog ? this.atlas : null });
    this.pickTable = S.pickTable; this.pickMap = S.pickMap;
    this._lampMap(S.lampPts);
    this.meshes.ground = upload(gl, S.ground);
    this.meshes.ground2 = upload(gl, S.ground2);
    this.meshes.punch = upload(gl, S.punch);
    this.meshes.solid = upload(gl, S.solid);
    this.meshes.pipes = upload(gl, S.pipes);
    this.meshes.leaf = upload(gl, S.leaf);
    this.meshes.treeSh = upload(gl, S.treeSh);
    this.meshes.bb = uploadBB(gl, S.bb);
    this.meshes.edges = uploadLines(gl, S.edges);
    this.meshes.wires = uploadLines(gl, S.wires);
    this.meshVer = (this.meshVer || 0) + 1;
    this.ovKey = null; // 덧그림(분석 지도·태양 궤적·단면선)도 다시
    this.dirty = true;
  };
  /* 장면의 도형을 쌓는다(GPU에 올리기 전). o.exp: 3D 모델 내보내기 — 둘레의 넓은 바닥을 빼고, 수목은 부피 모형으로, 레이어는 o.layers를 따른다 */
  Rr.buildScene = function (o) {
    o = o || {};
    const app = this.app, P = app.P, D = app.D;
    const pickTable = [null], pickMap = new Map();
    const pick = (t) => {
      const key = t.type + ':' + t.id;
      if (pickMap.has(key)) return pickMap.get(key);
      pickTable.push(t);
      const id = pickTable.length - 1;
      const c = [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255];
      pickMap.set(key, c);
      return c;
    };
    let ground = new Builder(); // 바닥(그리는 순서가 곧 위아래). 하천 앞까지가 ground, 도로부터는 ground2(하천 구멍을 뚫은 뒤에 그림)
    const solid = new Builder(), pipes = new Builder(), leaf = new Builder(); // leaf: 수관(face-me 그림을 못 쓸 때만 반투명으로)
    const punch = new Builder(); // 하천의 열린 물길(지면 높이): 바닥을 그린 뒤 이 자리의 깊이를 비워 땅속 물길이 보이게 한다
    const treeSh = new Builder(), bb = new BB(); // treeSh: 그림자만 드리우는 수목 부피(보이지 않음), bb: face-me 나무 그림
    const atlas = o.exp ? null : o.atlas || null;
    const lampPts = [];
    const edges = new LineSet(), wires = new LineSet();
    const layers = o.layers || app.state.layers;
    const line = !o.exp && app.modeOf('3d') === 'line';

    // 바닥(그리는 순서가 곧 위아래 순서)
    const ext = 6000;
    if (!o.exp) ground.flat([[-ext, -ext], [P.site.w + ext, -ext], [P.site.w + ext, P.site.h + ext], [-ext, P.site.h + ext]], -0.02, '#EDE9E3', null, 6);
    ground.tag('site');
    ground.flat([[0, 0], [P.site.w, 0], [P.site.w, P.site.h], [0, P.site.h]], 0.0, C.PAL.site, null);
    ground.tag('lot');
    D.lots.forEach((l) => {
      const u = C.USES[l.use] || C.USES.res;
      const col = u.open ? (l.use === 'park' || l.use === 'green' ? C.PAL.grass : l.use === 'parking' ? '#C4BFB8' : U.shade(u.color, 0.1)) : U.shade(u.color, 0.7);
      ground.flat(l.poly, 0.03, col, pick({ type: 'lot', id: l.id }));
      edges.poly2(l.poly, 0.3, true);
    });
    ground.tag('park');
    D.parkFeat.forEach((f) => {
      if (f.type === 'lawn') ground.flat(f.poly, 0.06, C.PAL.lawn);
      else if (f.type === 'play') ground.flat(f.poly, 0.07, C.PAL.play);
      else if (f.type === 'plaza') ground.flat(f.poly, 0.06, C.PAL.plaza);
      else if (f.type === 'path') ground.strip(f.pts, f.w, 0.08, C.PAL.path);
      else if (f.type === 'stall') edges.poly2(f.pts, 0.3, false);
    });
    D.blocks.forEach((b) => edges.poly2(b.poly, 0.32, true));
    // 수공간(획지·공원 위, 도로 아래: 도로가 지나면 다리). 하천은 깊이만큼 땅속으로(호안 벽과 수면), 연못과 내보내기는 지면에
    ground.tag('water');
    const sink = !o.exp;
    (D.waters || []).forEach((w) => {
      (w.parkStrips || []).forEach((q) => ground.flat(q, 0.07, C.PAL.lawn)); // 천변공원 녹지와 산책로
      (w.parkPaths || []).forEach((l) => ground.strip(l, w.parkPathW, 0.08, C.PAL.path));
      const d = w.kind === 'river' && sink ? w.depth || 0 : 0;
      if (d < 0.05) {
        ground.flat(w.poly, 0.085, C.PAL.water3, pick({ type: 'water', id: w.id }));
        if (w.kind === 'river') w.banks.forEach((bk) => edges.poly2(bk, 0.3, false)); else edges.poly2(w.poly, 0.3, true);
        return;
      }
      const pk = pick({ type: 'water', id: w.id }), wall = '#B8B1A5';
      punch.flat(w.poly, 0.0, '#000');
      solid.tag('water');
      solid.flat(w.poly, -d, '#7FB3CC', pk); // 수면
      const side = (ln, sg) => { // 호안 벽: 둑 선을 따라 지면에서 수면 아래까지, 물길 안쪽을 향함
        for (let i = 0; i + 1 < ln.length; i++) {
          const a = ln[i], b = ln[i + 1]; if (U.dist(a, b) < 0.02) continue;
          const t = U.norm(U.sub(b, a)), n = sg > 0 ? U.perpR(t) : U.perpL(t);
          solid.quad(W3(a, 0.02), W3(b, 0.02), W3(b, -d - 0.3), W3(a, -d - 0.3), [n[0], 0, -n[1]], wall, null, null, null, pk);
        }
        edges.poly2(ln, 0.3, false); edges.poly2(ln, -d + 0.02, false);
      };
      side(w.banks[0], 1); side(w.banks[1], -1);
      [[w.banks[0][0], w.banks[1][0]], [w.banks[0][w.banks[0].length - 1], w.banks[1][w.banks[1].length - 1]]].forEach(([a, b]) => { // 물길 양 끝
        solid.quad(W3(a, 0.02), W3(b, 0.02), W3(b, -d - 0.3), W3(a, -d - 0.3), [0, 1, 0], wall, null, null, null, pk);
      });
    });
    // 여기부터(도로·노면 표시·현황 지적·시설물 바닥)는 하천 구멍을 뚫은 뒤에 그린다: 하천을 건너는 도로는 다리 상판처럼 물길을 덮는다
    const groundA = ground;
    ground = new Builder();
    // 회전교차로 둘레 보도(팔의 보도보다 먼저: 같은 높이에서 팔 쪽이 위로)
    ground.tag('road'); solid.tag('road');
    (D.rabs || []).forEach((rb) => { ground.annulus(rb.c, rb.R, rb.R2, 0.095, C.SEG.sidewalk.color, pick({ type: 'rab', id: rb.id })); edges.poly2(UDS.Derive.circle(rb.c, rb.R2, 1.2), 0.33, true); });
    D.arms.forEach((a) => {
      const pk = pick({ type: 'road', id: a.road.id });
      a.geo.bands.forEach((bp) => {
        if (bp.band.def.carriage) return;
        const col = bp.band.def.color;
        ground.flat(bp.poly, 0.1, col, pk);
        edges.poly2(bp.poly, 0.33, true);
      });
    });
    D.arms.forEach((a) => {
      const pk = pick({ type: 'road', id: a.road.id });
      a.geo.bands.forEach((bp) => { if (bp.band.def.carriage) ground.flat(bp.poly, 0.14, bp.band.def.color, pk); });
    });
    D.fillets.forEach((f) => ground.flat(f.poly, 0.14, f.inner ? C.SEG.estate.color : C.SEG.lane.color));
    // 회전교차로: 진입부·목·회전차로(아스팔트), 화물차 턱, 중앙섬(돋운 녹지)
    (D.rabs || []).forEach((rb) => {
      const pk = pick({ type: 'rab', id: rb.id });
      rb.fillets.forEach((f) => ground.flat(f.poly, 0.14, C.SEG.lane.color, pk));
      rb.throats.forEach((q) => ground.flat(q, 0.141, C.SEG.lane.color, pk));
      ground.annulus(rb.c, rb.Ri, rb.R, 0.142, C.SEG.lane.color, pk);
      ground.annulus(rb.c, rb.Ra, rb.Ri, 0.19, '#C9BDAA', pk);
      solid.ringWall(rb.c, rb.Ra, 0.25, 0.12, 0.36, C.PAL.curb, pk);
      ground.annulus(rb.c, 0, rb.Ra - 0.12, 0.34, C.PAL.lawn, pk);
      edges.poly2(UDS.Derive.circle(rb.c, rb.Ra + 0.12, 1.2), 0.36, true);
      edges.poly2(UDS.Derive.circle(rb.c, rb.Ri, 1.2), 0.2, true);
      if (rb.lanes === 2) { const rr = (rb.R + rb.Ri) / 2, n = Math.ceil((Math.PI * 2 * rr) / 7); for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 2, a1 = a0 + 3 / rr; ground.strip([[rb.c[0] + Math.cos(a0) * rr, rb.c[1] + Math.sin(a0) * rr], [rb.c[0] + Math.cos(a1) * rr, rb.c[1] + Math.sin(a1) * rr]], 0.15, 0.18, C.PAL.white); } }
    });
    // 노면 표시
    ground.tag('mark');
    D.arms.forEach((a) => {
      const g = a.geo;
      g.marks.forEach((m) => {
        const col = m.kind === 'center' ? C.PAL.yellow : m.kind === 'bus' ? C.PAL.blue : C.PAL.white;
        if (m.kind === 'dash') {
          const L = U.polylineLength(m.pts);
          for (let s = 0; s < L; s += 8) { const p0 = U.pointAlong(m.pts, s).p, p1 = U.pointAlong(m.pts, Math.min(L, s + 3)).p; ground.strip([p0, p1], 0.15, 0.18, col); }
        } else ground.strip(m.pts, 0.15, 0.18, col);
        edges.poly2(m.pts, 0.34, false);
      });
      g.cross.forEach((c) => c.stripes.forEach((q) => { ground.flat(q, 0.18, '#f2f2ee'); edges.poly2(q, 0.34, true); }));
      g.stops.forEach((sl) => ground.strip(sl, 0.4, 0.18, '#f2f2ee'));
      g.stalls.forEach((sl) => { ground.strip(sl, 0.12, 0.18, '#f2f2ee'); edges.poly2(sl, 0.34, false); });
      g.yields.forEach((yl) => { const L = U.dist(yl[0], yl[1]), d = U.norm(U.sub(yl[1], yl[0])); for (let t = 0; t < L - 0.1; t += 1.05) ground.strip([U.add(yl[0], U.mul(d, t)), U.add(yl[0], U.mul(d, Math.min(L, t + 0.6)))], 0.3, 0.18, '#f2f2ee'); });
      g.splits.forEach((q) => { solid.prism(q, 0.12, 0.3, C.SEG.median.color, pick({ type: 'road', id: a.road.id })); edges.poly2(q, 0.3, true); });
    });
    // 연석(낮은 띠)
    solid.tag('curb');
    const curbCol = C.PAL.curb;
    const curbLine = (pts, h) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const L = U.dist(a, b); if (L < 0.05) continue;
        const d = U.norm(U.sub(b, a)), n = U.perpL(d);
        const P2 = [U.add(a, U.mul(n, 0.1)), U.add(b, U.mul(n, 0.1)), U.sub(b, U.mul(n, 0.1)), U.sub(a, U.mul(n, 0.1))];
        solid.prism(P2, 0.12, 0.12 + h, curbCol);
      }
      edges.poly2(pts, 0.12 + h, false);
    };
    D.arms.forEach((a) => a.geo.curbs.forEach((c) => { if (c.length > 1) curbLine(c, a.road.curbH || 0.15); }));
    D.fillets.forEach((f) => curbLine(f.arc, 0.15));
    (D.rabs || []).forEach((rb) => { rb.fillets.forEach((f) => curbLine(f.arc, 0.15)); rb.curbArcs.forEach((a) => curbLine(a, 0.15)); });
    // 다리 난간: 물 위를 지나는 도로·길의 양쪽 가장자리에 낮은 벽(오솔길은 가는 나무 난간)
    solid.tag('road');
    (D.bridges || []).forEach((g) => g.rails.forEach((pts) => {
      const t = g.inner ? 0.12 : 0.25, hh = g.inner ? 1.0 : 1.1, col = g.inner ? '#B49A7A' : '#CFCAC3';
      const wt = (D.waters || []).find((x) => x.id === g.waterId), sunk = !o.exp && wt && wt.kind === 'river' && wt.depth > 0.05;
      if (sunk) for (let i = 0; i + 1 < pts.length; i++) { // 땅속 물길 위 다리: 상판 옆면(거더)
        const a = pts[i], b = pts[i + 1], L = U.dist(a, b); if (L < 0.05) continue;
        const n = U.perpL(U.norm(U.sub(b, a)));
        solid.prism([U.add(a, U.mul(n, 0.2)), U.add(b, U.mul(n, 0.2)), U.sub(b, U.mul(n, 0.2)), U.sub(a, U.mul(n, 0.2))], g.inner ? -0.45 : -0.9, 0.12, g.inner ? '#9C8466' : '#BDB7AE');
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], L = U.dist(a, b); if (L < 0.05) continue;
        const n = U.perpL(U.norm(U.sub(b, a)));
        solid.prism([U.add(a, U.mul(n, t / 2)), U.add(b, U.mul(n, t / 2)), U.sub(b, U.mul(n, t / 2)), U.sub(a, U.mul(n, t / 2))], 0.12, hh, col);
      }
      edges.poly2(pts, hh, false);
    }));

    // 건물
    solid.tag('building');
    if (layers.buildings) D.buildings.forEach((b) => this._building(b, solid, edges, pick({ type: 'building', id: b.lotId })));
    ground.tag('parcel'); solid.tag('ctx');
    // 실제 지역: 지목별 바닥(도로·하천·공원 필지)과 현황 건물 매스(지운 것·새 계획으로 철거되는 것은 세우지 않음)
    const cx = app.ctxData ? app.ctxData() : null, V = D.ctxV, X = UDS.Ctx;
    if (cx && V) {
      if (cx.par.length && layers.parcels !== false && !line) {
        cx.par.forEach((q) => {
          const f = X.PAR_FILL[X.jimokCls(q.jm)]; if (!f) return;
          const col = U.hexToRgb(f);
          q.parts.forEach((pt, k) => this._flatH(ground, this._ctxTri('p:' + q.id, k, pt), 0.045, col, null));
        });
      }
      if (layers.ctx !== false) {
        const mode = app.state.ctxMode || 'gray';
        cx.bld.forEach((b) => { if (X.shown(V, b.id)) this._ctxBuilding(b, solid, edges, pick({ type: 'ctx', id: b.id }), mode); });
      }
    }
    // 수목
    treeSh.tag('tree'); solid.tag('tree'); leaf.tag('tree');
    if (layers.trees) D.trees.forEach((t, i) => {
      const sp = C.TREES[t.species] || C.TREES.zelkova;
      const pk = t.kind === 'free' ? pick({ type: 'object', id: t.id }) : t.key ? pick({ type: 'tree', id: t.key }) : [0, 0, 0];
      const rnd = U.rng(Math.floor(t.x * 13 + t.y * 7));
      const sc = 0.85 + rnd() * 0.3;
      const h = sp.height * sc, cr = (sp.crown / 2) * sc, clear = sp.clear;
      const tint = 0.9 + rnd() * 0.2, col = U.hexToRgb(sp.color).map((v) => (o.exp ? v : v * tint)); // 내보낼 때는 수종 색 그대로(재질 수를 줄인다)
      // 그림자는 둥근 수관 부피로 드리운다(해의 높이와 상관없이 수관만 한 그림자). face-me 그림을 못 쓰면 이것을 반투명하게 그린다
      const body = atlas || o.exp ? treeSh : leaf, trunk = atlas || o.exp ? treeSh : solid;
      trunk.cyl(t.x, t.y, 0.18 * sc, 0, clear + 0.6, '#6b5440', 5, pk, 0);
      if (sp.shape === 'cone') body.cone(t.x, t.y, clear, cr, h - clear, col, 10, pk, 4);
      else if (sp.shape === 'pine') { body.ellipsoid(t.x, t.y, clear + (h - clear) * 0.45, cr, (h - clear) * 0.32, col, 9, pk, 4); body.ellipsoid(t.x + 0.8, t.y - 0.5, clear + (h - clear) * 0.82, cr * 0.7, (h - clear) * 0.2, col, 8, pk, 4); }
      else body.ellipsoid(t.x, t.y, clear + (h - clear) / 2, cr, (h - clear) / 2, col, 10, pk, 4);
      if (!atlas) return;
      // face-me 그림: 수종마다 두 가지 중 하나, 절반은 좌우를 뒤집는다. 크기는 수종 규격 × 나무마다의 배율
      const cells = atlas.info[t.species] || atlas.info.zelkova, cell = cells[rnd() < 0.5 ? 0 : 1], flip = rnd() < 0.5;
      const x0 = cell.x0 * sc, x1 = cell.x1 * sc, y1 = cell.y1 * sc;
      const uL = flip ? cell.u1 : cell.u0, uR = flip ? cell.u0 : cell.u1, oL = flip ? -x1 : x0, oR = flip ? -x0 : x1;
      const bias = cr * 1.7 + 0.8;
      bb.quad([t.x, 0, -t.y], [[oL, 0, uL, cell.vB], [oR, 0, uR, cell.vB], [oR, y1, uR, cell.vT], [oL, y1, uL, cell.vT]], col, [0, 0, 1, 1], pk, 0, bias);
      // 위에서 본 수관(내려다볼 때만): 수관 높이에, 나무마다 조금씩 돌려 놓는다
      const T = atlas.top, rr = cr * 1.02, th = rnd() * Math.PI * 2, c0 = Math.cos(th), s0 = Math.sin(th);
      const corner = (mx, my, u, v) => { const wx = (mx * c0 - my * s0) * rr, wy = (mx * s0 + my * c0) * rr; return [wx, -wy, u, v]; };
      const yd = clear + (h - clear) * 0.62;
      bb.quad([t.x, yd, -t.y], [corner(-T.r, -T.r, T.u0, T.vB), corner(T.r, -T.r, T.u1, T.vB), corner(T.r, T.r, T.u1, T.vT), corner(-T.r, T.r, T.u0, T.vT)], col, [0.85, 0.85, 0.85, 0.85], pk, 1, bias);
    });
    // 시설물·전주
    solid.tag('furn'); ground.tag('furn');
    if (layers.furniture) {
      D.lights.forEach((l) => {
        solid.cyl(l.x, l.y, 0.09, 0, 8.5, '#55595e', 5);
        const ang = l.ang + (l.dir < 0 ? -Math.PI / 2 : Math.PI / 2);
        const hx = l.x + Math.cos(ang) * 1.4, hy = l.y + Math.sin(ang) * 1.4;
        solid.box((l.x + hx) / 2, (l.y + hy) / 2, 1.5, 0.12, 8.4, 0.12, ang, '#55595e');
        solid.box(hx, hy, 0.7, 0.3, 8.25, 0.2, ang, '#f4ecd2', null, 7);
        lampPts.push([hx, hy, 15]);
        edges.seg(W3([l.x, l.y], 0), W3([l.x, l.y], 8.5));
      });
      D.poles.forEach((p) => {
        solid.cyl(p.x, p.y, 0.18, 0, 10.5, '#9a978f', 6);
        solid.box(p.x, p.y, 1.8, 0.12, 9.3, 0.12, 0, '#7d7a72');
        edges.seg(W3([p.x, p.y], 0), W3([p.x, p.y], 10.5));
      });
      D.wires.forEach((w) => {
        [8.9, 9.4, 9.9].forEach((h, k) => {
          const off = (k - 1) * 0.5;
          const a = [w[0][0] + off * 0.3, w[0][1]], b = [w[1][0] + off * 0.3, w[1][1]];
          let prev = null;
          for (let i = 0; i <= 6; i++) {
            const t = i / 6, sag = 0.5 * 4 * t * (1 - t);
            const p = W3([U.lerp(a[0], b[0], t), U.lerp(a[1], b[1], t)], h - sag);
            if (prev) wires.seg(prev, p, [0.18, 0.18, 0.18]);
            prev = p;
          }
        });
      });
      D.furniture.forEach((f) => { this._furniture(f, solid, ground, edges, f.auto ? [0, 0, 0] : pick({ type: 'object', id: f.id })); if (f.type === 'light') lampPts.push([f.x, f.y, 8]); else if (f.type === 'smartpole') lampPts.push([f.x, f.y, 13]); else if (f.type === 'busstop') lampPts.push([f.x, f.y, 5]); });
    }
    // 지하시설
    pipes.tag('util'); ground.tag('util');
    if (layers.utilities !== false || !o.exp) D.utils.forEach((u) => {
      const def = C.UTIL[u.type];
      const r = Math.max(0.14, u.dia / 2);
      for (let i = 0; i + 1 < u.pts.length; i++) {
        const a = u.pts[i], b = u.pts[i + 1];
        const L = U.dist(a, b); if (L < 0.1) continue;
        const d = U.norm(U.sub(b, a)), n = U.perpL(d);
        const y = -u.depth;
        if (def.box) { pipes.prism([U.add(a, U.mul(n, r)), U.add(b, U.mul(n, r)), U.sub(b, U.mul(n, r)), U.sub(a, U.mul(n, r))], y - r, y + r, def.color); continue; }
        const k = 8;
        for (let j = 0; j < k; j++) {
          const t0 = (j / k) * Math.PI * 2, t1 = ((j + 1) / k) * Math.PI * 2;
          const o0 = [Math.cos(t0) * r, Math.sin(t0) * r], o1 = [Math.cos(t1) * r, Math.sin(t1) * r];
          const P0 = (p, o) => [p[0] + n[0] * o[0], y + o[1], -(p[1] + n[1] * o[0])];
          const tm = (t0 + t1) / 2;
          pipes.quad(P0(a, o0), P0(b, o0), P0(b, o1), P0(a, o1), [n[0] * Math.cos(tm), Math.sin(tm), -n[1] * Math.cos(tm)], def.color);
        }
      }
      u.mh.forEach((p) => { ground.flat(U.arcPoints(p, 0.6, 0, Math.PI * 2 - 0.01, 12), 0.2, '#4b4b4b'); pipes.cyl(p[0], p[1], 0.55, -u.depth, 0, '#6d6a65', 8); });
    });
    return { ground: groundA, ground2: ground, punch, solid, pipes, leaf, treeSh, bb, edges, wires, lampPts, pickTable, pickMap };
  };

  /* ---------- 덧그림: 조도분석 지도(바닥), 태양 궤적도(하늘의 반구), 단면 위치선 A–A′ ---------- */
  Rr._ovKeyNow = function () {
    const app = this.app, st = app.state, S = app.P.settings, A = st.ana || {};
    const X = UDS.Ana, r = X ? X.active(app) : null;
    const sr = app.secRoad ? app.secRoad() : null;
    return [this.meshVer, A.sunpath ? 1 : 0, r ? r.kind + r.v : '', UDS.dayOf(S), S.lat, A.sunpath ? S.hour : '', sr ? sr.id + ':' + (st.secS === null || st.secS === undefined ? 'm' : st.secS.toFixed(2)) + (st.secFlip ? 'f' : '') : '', st.max || ''].join('|');
  };
  Rr._buildOverlay = function () {
    const gl = this.gl, app = this.app, P = app.P, D = app.D, st = app.state, X = UDS.Ana;
    ['ovG', 'ov3', 'ovL'].forEach((k) => { if (this.meshes[k]) { free(gl, this.meshes[k]); delete this.meshes[k]; } });
    const og = new Builder(), o3 = new Builder(), ol = new LineSet();
    const UP = [0, 1, 0], K8 = [0, 0, 0, 8];
    // 조도분석 지도: 칸마다 사각형(건물 바닥은 비움)
    const r = X ? X.active(app) : null;
    if (r) {
      const y = 0.46;
      for (let j = 0; j < r.ny; j++) for (let i = 0; i < r.nx; i++) {
        const k = j * r.nx + i; if (r.mask[k]) continue;
        const x0 = r.x0 + i * r.cell, y0 = r.y0 + j * r.cell, x1 = x0 + r.cell, y1 = y0 + r.cell, c = X.color(r.kind, r.val[k]);
        og.quad(W3([x0, y0], y), W3([x1, y0], y), W3([x1, y1], y), W3([x0, y1], y), UP, c, null, null, K8);
      }
    }
    // 단면 위치선: 바닥 띠, 양 끝 기둥, 단면을 자르는 면의 윤곽(점선)
    const sr = app.secRoad ? app.secRoad() : null;
    this.secEnds = null;
    if (sr && D.roadInfo.get(sr.id)) {
      const info = D.roadInfo.get(sr.id);
      const s = st.secS === null || st.secS === undefined ? info.len / 2 : U.clamp(st.secS, 0, info.len);
      const q = U.pointAlong(sr.pts, s), n = U.perpL(q.dir), half = info.lay.W / 2 + 6;
      const pa = U.add(q.p, U.mul(n, half)), pb = U.add(q.p, U.mul(n, -half));
      let H = 12;
      D.buildings.forEach((b) => { if (b.fp.some((p) => U.distPointSeg(p, pa, pb).d < 18)) H = Math.max(H, b.h + 3); });
      H = Math.min(H, 60);
      const col = U.hexToRgb('#E0533F');
      og.strip([pa, pb], 0.55, 0.5, col, null, 8);
      [pa, pb].forEach((p) => { o3.cyl(p[0], p[1], 0.22, 0, 6.5, col, 8, null, 8); o3.ellipsoid(p[0], p[1], 6.9, 0.6, 0.6, col, 8, null, 8); });
      const cl = [0.88, 0.33, 0.25];
      const dash = (a, b) => { const L = U.dist3(a, b); const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L]; for (let t = 0; t < L; t += 2.6) { const u = Math.min(L, t + 1.6); ol.seg([a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], [a[0] + d[0] * u, a[1] + d[1] * u, a[2] + d[2] * u], cl); } };
      const A0 = W3(pa, 0), A1 = W3(pa, H), B0 = W3(pb, 0), B1 = W3(pb, H);
      dash(A1, B1); dash(A0, A1); dash(B0, B1);
      this.secEnds = st.secFlip ? [W3(pb, 7.8), W3(pa, 7.8)] : [W3(pa, 7.8), W3(pb, 7.8)]; // 방향을 바꾸면 A·A′가 서로 자리를 바꾼다
    }
    // 태양 궤적도: 대상지 가운데를 중심으로 한 반구 위의 해의 길(지금 계절은 진하게)과 정시 표시, 지금 해
    if (st.ana && st.ana.sunpath && X) {
      const S = P.settings, c = [P.site.w / 2, P.site.h / 2], R = Math.min(P.site.w, P.site.h) * 0.42;
      const at = (az, alt) => [c[0] + R * Math.cos(alt) * Math.sin(az), R * Math.sin(alt) + 0.6, -(c[1] + R * Math.cos(alt) * Math.cos(az))];
      const ring = []; for (let i = 0; i <= 96; i++) ring.push(at((i / 96) * Math.PI * 2, 0));
      for (let i = 0; i + 1 < ring.length; i++) ol.seg(ring[i], ring[i + 1], [0.72, 0.52, 0.3]);
      for (let k = 0; k < 4; k++) { const t = (k * Math.PI) / 2; ol.seg(at(t, 0), [c[0] + (R + 8) * Math.sin(t), 0.6, -(c[1] + (R + 8) * Math.cos(t))], [0.6, 0.38, 0.2]); }
      X.sunPath(S).forEach((sp) => {
        const colA = sp.cur ? [0.86, 0.45, 0.12] : [0.84, 0.66, 0.46];
        for (let i = 0; i + 1 < sp.pts.length; i++) ol.seg(at(sp.pts[i].az, sp.pts[i].alt), at(sp.pts[i + 1].az, sp.pts[i + 1].alt), colA);
        // 선만으로는 가늘어 잘 안 보이므로 작은 구슬을 줄지어 놓는다(지금 계절은 촘촘하고 크게)
        const step = sp.cur ? 2 : 4, rr = sp.cur ? 0.75 : 0.5;
        for (let i = 0; i < sp.pts.length; i += step) { const p = at(sp.pts[i].az, sp.pts[i].alt); o3.ellipsoid(p[0], -p[2], p[1], rr, rr, colA, 6, null, 8); }
        if (sp.cur) sp.hours.forEach((q) => { const p = at(q.az, q.alt); o3.ellipsoid(p[0], -p[2], p[1], q.h % 3 === 0 ? 2.0 : 1.4, q.h % 3 === 0 ? 2.0 : 1.4, [0.95, 0.62, 0.25], 8, null, 8); });
      });
      const v = UDS.sunVector(S);
      if (v.alt > 0) { const p = at(v.az, v.alt); o3.ellipsoid(p[0], -p[2], p[1], 4.2, 4.2, [1.0, 0.8, 0.25], 12, null, 8); ol.seg([c[0], 0.6, -c[1]], p, [0.95, 0.65, 0.2]); }
    }
    this.meshes.ovG = upload(gl, og);
    this.meshes.ov3 = upload(gl, o3);
    this.meshes.ovL = uploadLines(gl, ol);
  };
  /* 단면 위치 A·A′ 글자를 3D 화면 위 제자리에 */
  Rr._secLabels = function (VP) {
    const host = this.cv.parentNode; if (!host) return;
    let la = this._secLa;
    if (!la) {
      la = this._secLa = ['A', 'A′'].map((t) => {
        const d = document.createElement('div'); d.className = 'sec3d'; d.textContent = t; d.title = '누르면 단면을 보는 방향이 바뀝니다';
        d.addEventListener('click', (e) => { e.stopPropagation(); this.app.secFlipToggle(); });
        host.appendChild(d); return d;
      });
    }
    const E = this.secEnds, w = this.cv.clientWidth, h = this.cv.clientHeight;
    la.forEach((d, i) => {
      if (!E) { d.hidden = true; return; }
      const p = E[i], x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13], ww = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
      if (ww <= 0.1) { d.hidden = true; return; }
      const sx = (x / ww * 0.5 + 0.5) * w, sy = (1 - (y / ww * 0.5 + 0.5)) * h;
      if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) { d.hidden = true; return; }
      d.hidden = false; d.style.transform = `translate(${Math.round(sx)}px,${Math.round(sy)}px)`;
    });
  };

  /* 가로등 빛 지도: 위에서 내려다본 밝기를 한 장의 텍스처로 만들어 모든 면이 함께 참조한다 */
  Rr._lampMap = function (pts) {
    const gl = this.gl, site = this.app.P.site, m = 26;
    const rw = site.w + m * 2, rh = site.h + m * 2;
    const k = Math.min(3, 1024 / Math.max(rw, rh));
    const cw = Math.max(8, Math.round(rw * k)), ch = Math.max(8, Math.round(rh * k));
    const cv = this._lampCv || (this._lampCv = document.createElement('canvas'));
    cv.width = cw; cv.height = ch;
    const c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, cw, ch);
    c.globalCompositeOperation = 'lighter';
    pts.forEach(([x, y, r]) => {
      const px = (x + m) * k, py = (site.h + m - y) * k, pr = r * k;
      const g = c.createRadialGradient(px, py, 0, px, py, pr);
      g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(0.3, 'rgba(255,255,255,0.38)'); g.addColorStop(0.65, 'rgba(255,255,255,0.1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    });
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lampTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.activeTexture(gl.TEXTURE0);
    this.lampRect = [-m, -(site.h + m), 1 / rw, 1 / rh];
  };

  Rr._building = function (b, solid, edges, pk) {
    const st = b.st;
    const fp = b.fp;
    const H = b.h, y0 = 0.03;
    const matIdx = C.MAT_ORDER.indexOf(st.material);
    const cmSlot = st.cm >= 0 ? st.cm : -1; // 이미지 재료의 텍스처 층
    const winIdx = ['punched', 'ribbon', 'vertical', 'curtain'].indexOf(st.win);
    const grIdx = ['shop', 'lobby', 'residential', 'pilotis', 'arcade', 'closed'].indexOf(st.ground);
    const sgIdx = { none: 0, cluttered: 1, regulated: 2 }[st.sign] || 0;
    const col = U.hexToRgb(st.wallColor || '#dddddd');
    const bay = st.win === 'curtain' ? 1.5 : st.win === 'vertical' ? 1.8 : st.ground === 'shop' ? 4.0 : 3.3;
    const rnd = U.rng(U.hashStr(b.id));
    rnd(); // (예전 무늬 시작점 자리: 간판 무작위가 같은 순서로 나오게 남겨 둠)
    const front = new Set(b.frontEdges || []);
    const par = b.gable ? 0 : H < 4.5 ? 0.45 : 0.9, Hp = H + par; // 평지붕 둘레의 난간벽(파라펫)
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], c = fp[(i + 1) % fp.length];
      const L = U.dist(a, c);
      if (L < 0.05) continue;
      const n2 = U.perpR(U.norm(U.sub(c, a)));
      const isFront = front.has(i) || front.size === 0;
      const gcode = isFront ? Math.max(0, grIdx) : (st.ground === 'pilotis' ? 3 : 6);
      // 벽마다 양 끝에 기둥을 두고 그 사이를 같은 너비의 칸으로 나눈다(모서리에 창이 걸리지 않게). 아주 짧은 벽은 막힌 벽
      const pier = st.win === 'curtain' ? 0.35 : 0.6, span = L - 2 * pier;
      const nb = span > bay * 0.55 ? Math.max(1, Math.round(span / bay)) : 0;
      const bwE = nb ? span / nb : bay;
      const s1 = [b.floorH, b.groundH, bwE, st.wwr];
      const s2 = [Math.max(0, winIdx) + 10 * (nb + 1), gcode, cmSlot >= 0 ? 1000 + cmSlot * 10 + (isFront ? sgIdx : 0) : Math.max(0, matIdx) + (isFront ? sgIdx * 10 : 0), 1];
      solid.quad(W3(a, y0), W3(c, y0), W3(c, H), W3(a, H), [n2[0], 0, -n2[1]], col, [[-pier, 0], [L - pier, 0], [L - pier, H], [-pier, H]], s1, s2, pk);
      // 난간벽 바깥 면: 같은 재료, 창 없음(st1.w < 0)
      if (par) solid.quad(W3(a, H), W3(c, H), W3(c, Hp), W3(a, Hp), [n2[0], 0, -n2[1]], col, [[-pier, H], [L - pier, H], [L - pier, Hp], [-pier, Hp]], [b.floorH, b.groundH, bwE, -1], s2, pk);
      edges.seg(W3(a, y0), W3(a, Hp));
      if (isFront && st.canopy && L > 2) {
        const d = U.norm(U.sub(c, a));
        const P2 = [U.add(a, U.mul(d, 0.3)), U.sub(c, U.mul(d, 0.3)), U.add(U.sub(c, U.mul(d, 0.3)), U.mul(n2, 1.4)), U.add(U.add(a, U.mul(d, 0.3)), U.mul(n2, 1.4))];
        solid.prism(P2, b.groundH - 0.75, b.groundH - 0.6, '#3d4247', pk);
        edges.poly2(P2, b.groundH - 0.6, true);
      }
      if (isFront && st.sign === 'cluttered' && L > 3) {
        const d = U.norm(U.sub(c, a));
        for (let s = 1.5; s < L - 1; s += 5 + rnd() * 3) {
          const p = U.add(U.add(a, U.mul(d, s)), U.mul(n2, 0.55));
          const sc = [[0.85, 0.2, 0.15], [0.98, 0.78, 0.15], [0.15, 0.45, 0.85], [0.2, 0.62, 0.3], [0.92, 0.45, 0.1]][Math.floor(rnd() * 5)];
          const P2 = solid.box(p[0], p[1], 0.12, 0.9, b.groundH + 0.3, Math.min(2.6, H - b.groundH - 0.3), Math.atan2(d[1], d[0]), sc, pk);
          edges.boxEdges(P2, b.groundH + 0.3, b.groundH + 0.3 + Math.min(2.6, H - b.groundH - 0.3));
        }
      }
    }
    edges.poly2(fp, y0, true);
    edges.poly2(fp, Hp, true);
    const roofCol = st.roof === 'green' ? '#A9D5C2' : U.mix(st.wallColor || '#dddddd', '#efeff2', 0.62);
    if (par) this._roofKit(b, fp, H, Hp, col, solid, edges, pk);
    if (b.gable) {
      const g = b.gable;
      const v = (i) => fp[i % 4];
      const R1 = W3(g.R1, H + g.rise), R2 = W3(g.R2, H + g.rise);
      const i0 = g.i0, i1 = g.i1;
      const longA = [(i0 + 1) % 4, (i0 + 2) % 4], longB = [(i1 + 1) % 4, (i1 + 2) % 4];
      const rc = U.hexToRgb(st.material === 'metal' ? '#7f95a6' : '#a0624c');
      const plane = (pa, pb, ra, rb) => {
        const A = W3(pa, H), Bp = W3(pb, H);
        const e1 = [Bp[0] - A[0], Bp[1] - A[1], Bp[2] - A[2]], e2 = [ra[0] - A[0], ra[1] - A[1], ra[2] - A[2]];
        let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const l = Math.hypot(...nn) || 1; nn = nn.map((x) => x / l); if (nn[1] < 0) nn = nn.map((x) => -x);
        solid.quad(A, Bp, rb, ra, nn, rc, null, null, [0, 0, 0, 2], pk);
      };
      plane(v(longA[0]), v(longA[1]), R1, R2);
      plane(v(longB[0]), v(longB[1]), R2, R1);
      const gt = (p1, p2, R) => solid.tri(W3(p1, H), W3(p2, H), R, [0, 0, 1], col, [0, 0, 0, 0], pk);
      gt(v(i0), v(i0 + 1), R1); gt(v(i1), v(i1 + 1), R2);
      edges.seg(R1, R2);
      [v(i0), v(i0 + 1)].forEach((p) => edges.seg(W3(p, H), R1));
      [v(i1), v(i1 + 1)].forEach((p) => edges.seg(W3(p, H), R2));
    } else {
      solid.flat(fp, H, roofCol, pk, 2);
    }
  };

  /* 안쪽으로 t만큼 들인 고리(꼭짓점마다 두 변의 안쪽 선이 만나는 자리. 뾰족한 모서리는 약 3t까지만). P는 반시계 */
  function insetRing(P, t) {
    const n = P.length, out = [];
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n];
      const e0 = U.sub(p1, p0), e1 = U.sub(p2, p1), l0 = U.len(e0), l1 = U.len(e1);
      if (l0 < 1e-6 || l1 < 1e-6) { out.push([p1[0], p1[1]]); continue; }
      const n0 = U.perpL(U.mul(e0, 1 / l0)), n1 = U.perpL(U.mul(e1, 1 / l1));
      const dd = Math.max(0.25, 1 + U.dot(n0, n1));
      out.push([p1[0] + ((n0[0] + n1[0]) * t) / dd, p1[1] + ((n0[1] + n1[1]) * t) / dd]);
    }
    return out;
  }
  /* 평지붕: 난간벽 안쪽 면·두겁(윗면), 옥탑(계단·승강기실)과 실외기 */
  Rr._roofKit = function (b, fp, H, Hp, col, solid, edges, pk) {
    const n = fp.length, th = Hp - H < 0.6 ? 0.18 : 0.25;
    const ring = insetRing(fp, U.polyArea(fp) < 0 ? -th : th);
    const inner = col.map((v) => v * 0.86), cap = U.hexToRgb(U.mix(U.rgbToHex(col), '#d9dadc', 0.55));
    for (let i = 0; i < n; i++) {
      const a = fp[i], c = fp[(i + 1) % n], a2 = ring[i], c2 = ring[(i + 1) % n];
      if (U.dist(a, c) < 0.05) continue;
      const nin = U.perpL(U.norm(U.sub(c, a)));
      solid.quad(W3(a2, H), W3(c2, H), W3(c2, Hp), W3(a2, Hp), [nin[0], 0, -nin[1]], inner, null, null, [0, 0, 0, 0], pk); // 안쪽 면
      solid.quad(W3(a, Hp), W3(c, Hp), W3(c2, Hp), W3(a2, Hp), [0, 1, 0], cap, null, null, [0, 0, 0, 0], pk);             // 두겁
    }
    edges.poly2(ring, Hp, true);
    edges.poly2(ring, H, true);
    if (b.st.roof === 'green' && (b.floors || 1) < 4) return;
    const area = Math.abs(U.polyArea(ring));
    if (area < 45) return;
    // 지붕 위 물건은 가장 긴 변의 방향에 맞춰 놓는다
    let li = 0, lm = 0;
    for (let i = 0; i < n; i++) { const L = U.dist(fp[i], fp[(i + 1) % n]); if (L > lm) { lm = L; li = i; } }
    const ux = U.norm(U.sub(fp[(li + 1) % n], fp[li])), rot = Math.atan2(ux[1], ux[0]);
    const R = U.rng(U.hashStr(b.id + '#roof'));
    const placed = [];
    const fits = (P2, gap) => {
      const ok = P2.every((q) => U.pointInPoly(q, ring)) && ring.every((q) => !U.pointInPoly(q, P2));
      if (!ok) return false;
      for (let i = 0; i < 4; i++) for (let j = 0; j < ring.length; j++) if (U.segIntersect(P2[i], P2[(i + 1) % 4], ring[j], ring[(j + 1) % ring.length])) return false;
      const cc = U.polyCentroid(P2);
      return placed.every((o) => U.dist(o.c, cc) > o.r + gap);
    };
    const rect = (cx, cy, w, d) => { const c = Math.cos(rot), s = Math.sin(rot); return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map((p) => [cx + p[0] * c - p[1] * s, cy + p[0] * s + p[1] * c]); };
    const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const put = (w, d, h, colr, tries, near) => {
      for (let t = 0; t < tries; t++) {
        let p;
        if (near && t < 6) { const c0 = U.polyCentroid(ring); p = [c0[0] + (R() - 0.5) * t * 2.2, c0[1] + (R() - 0.5) * t * 2.2]; }
        else p = [x0 + R() * (x1 - x0), y0 + R() * (y1 - y0)];
        const P2 = rect(p[0], p[1], w, d);
        if (!fits(P2, 1.2)) continue;
        solid.prism(P2, H, H + h, colr, pk);
        edges.boxEdges(P2, H, H + h);
        placed.push({ c: p, r: Math.hypot(w, d) / 2 });
        return P2;
      }
      return null;
    };
    // 옥탑: 4층 이상, 지붕이 넉넉할 때
    if ((b.floors || 1) >= 4 && area > 120) put(Math.min(6.5, Math.sqrt(area) * 0.4), 3.6, 3.0, col.map((v) => v * 0.94), 24, true);
    if (b.st.roof === 'green') return;
    // 실외기: 지붕 넓이에 따라 1~6개
    const nU = Math.max(1, Math.min(6, Math.round(area / 220)));
    const unit = [0.72, 0.74, 0.76];
    for (let k = 0; k < nU; k++) {
      const big = R() < 0.35;
      put(big ? 2.4 : 1.3, big ? 1.6 : 0.9, big ? 1.4 : 1.0, unit, 14, false);
    }
  };

  /* 구멍 있는 다각형의 삼각분할(자료가 바뀌기 전까지 기억) */
  Rr._ctxTri = function (key, k, pt) {
    const cx = this.app.ctxData();
    if (!this._triC || this._triC.src !== cx) this._triC = { src: cx, m: new Map() }; // 자료가 바뀌거나 밀리면 다시
    const kk = key + '#' + k;
    let t = this._triC.m.get(kk);
    if (!t) { t = UDS.Ctx.tri(pt.o, pt.h); this._triC.m.set(kk, t); }
    return t;
  };
  Rr._flatH = function (bld, t, y, col, pk, kind) {
    const base = bld.n;
    t.pts.forEach((p) => bld.v(W3(p, y), [0, 1, 0], col, null, null, [0, 0, 0, kind || 0], pk));
    for (let i = 0; i < t.idx.length; i += 3) bld.I.push(base + t.idx[i], base + t.idx[i + 1], base + t.idx[i + 2]);
  };
  /* 현황 건물: 바닥 윤곽을 높이만큼 올린 매스(LoD1). 표현 방식에 따라 단색·용도·층수·건축 연도로 칠한다 */
  Rr._ctxBuilding = function (b, solid, edges, pk, mode) {
    const X = UDS.Ctx;
    let wall, roof;
    if (mode === 'gray') { wall = U.hexToRgb(X.GRAY.wall); roof = U.hexToRgb(X.GRAY.roof); }
    else { const c = X.classOf(b, mode)[2]; wall = U.hexToRgb(U.mix(c, '#ffffff', 0.28)); roof = U.hexToRgb(c); }
    const y0 = 0.03, H = Math.max(2.4, b.h);
    b.parts.forEach((pt, k) => {
      [pt.o].concat(pt.h).forEach((ring) => {
        const n = ring.length;
        for (let i = 0; i < n; i++) {
          const a = ring[i], c = ring[(i + 1) % n];
          if (U.dist(a, c) < 0.02) continue;
          const n2 = U.perpR(U.norm(U.sub(c, a)));
          solid.quad(W3(a, y0), W3(c, y0), W3(c, H), W3(a, H), [n2[0], 0, -n2[1]], wall, null, null, [0, 0, 0, 0], pk);
          // 모서리 선: 실제로 꺾이는 곳만(곡면을 이루는 잔꼭짓점은 건너뜀)
          const z = ring[(i - 1 + n) % n], d1 = U.norm(U.sub(a, z)), d2 = U.norm(U.sub(c, a));
          if (Math.abs(U.cross(d1, d2)) > 0.34 || U.dot(d1, d2) < 0) edges.seg(W3(a, y0), W3(a, H));
        }
        edges.poly2(ring, H, true); edges.poly2(ring, y0, true);
      });
      this._flatH(solid, this._ctxTri('b:' + b.id, k, pt), H, roof, pk, 2);
    });
  };

  Rr._furniture = function (f, solid, ground, edges, pk) {
    const rot = f.rot || 0;
    switch (f.type) {
      case 'bench': { const P2 = solid.box(f.x, f.y, 1.8, 0.5, 0.42, 0.06, rot, '#8a6a46', pk); solid.box(f.x, f.y, 1.6, 0.4, 0, 0.42, rot, '#4f4f4f', pk); edges.boxEdges(P2, 0.42, 0.48); break; }
      case 'busstop': {
        const c = Math.cos(rot), s = Math.sin(rot);
        const off = (dx, dy) => [f.x + dx * c - dy * s, f.y + dx * s + dy * c];
        [[-1.9, 0.6], [1.9, 0.6]].forEach(([dx, dy]) => { const p = off(dx, dy); solid.cyl(p[0], p[1], 0.06, 0, 2.6, '#4c5157', 5, pk); });
        const roof = solid.box(f.x, f.y, 4.2, 1.6, 2.6, 0.12, rot, '#4c5157', pk);
        const back = off(0, 0.7);
        const P2 = solid.box(back[0], back[1], 4.0, 0.05, 0.1, 2.4, rot, '#9fb8cc', pk, 5);
        const bench = off(0, 0.35);
        solid.box(bench[0], bench[1], 2.2, 0.35, 0.45, 0.06, rot, '#8a6a46', pk);
        edges.boxEdges(roof, 2.6, 2.72); edges.boxEdges(P2, 0.1, 2.5);
        break;
      }
      case 'bollard': solid.cyl(f.x, f.y, 0.1, 0, 0.9, '#5a5e63', 6, pk); break;
      case 'bikerack': { const c = Math.cos(rot), s = Math.sin(rot); [-0.6, 0, 0.6].forEach((d) => solid.box(f.x + d * c, f.y + d * s, 0.06, 0.8, 0, 0.8, rot + Math.PI / 2, '#5a5e63', pk)); break; }
      case 'pm': { const c = Math.cos(rot), s = Math.sin(rot); const P2 = [[-2, -1], [2, -1], [2, 1], [-2, 1]].map((p) => [f.x + p[0] * c - p[1] * s, f.y + p[0] * s + p[1] * c]); ground.flat(P2, 0.21, '#9AD3C5', pk); edges.poly2(P2, 0.35, true); break; }
      case 'smartpole': solid.cyl(f.x, f.y, 0.16, 0, 9.5, '#4a8f80', 8, pk); solid.box(f.x, f.y, 0.5, 0.35, 3.0, 0.8, rot, '#2b7f6e', pk); break;
      case 'transformer': { const P2 = solid.box(f.x, f.y, 1.2, 0.7, 0, 1.4, rot, '#8c9b8a', pk); edges.boxEdges(P2, 0, 1.4); break; }
      case 'hydrant': solid.cyl(f.x, f.y, 0.15, 0, 0.8, '#d23c2c', 8, pk); break;
      case 'light': solid.cyl(f.x, f.y, 0.08, 0, 4.5, '#55595e', 5, pk); solid.box(f.x, f.y, 0.4, 0.4, 4.4, 0.25, 0, '#f4ecd2', pk, 7); break;
      case 'shrub': solid.ellipsoid(f.x, f.y, 0.6, f.r || 1.6, 0.7, '#7FB39B', 9, pk, 4); break;
      default: solid.box(f.x, f.y, 0.5, 0.5, 0, 0.5, rot, '#777', pk);
    }
  };

  /* 그리기 */
  Rr.draw = function () {
    if (!this.ok || !this.meshes.ground) return;
    const gl = this.gl, app = this.app, P = app.P;
    this.resize();
    const line = app.modeOf('3d') === 'line';
    const under = !!app.state.layers.utilities && !!app.state.under3d;
    const sky = UDS.sky(P.settings);
    const sunDir = [sky.dir[0], sky.dir[2], -sky.dir[1]];
    const { VP, e } = this.matrices();
    // 그림자 행렬
    const site = P.site;
    const cx = site.w / 2, cz = -site.h / 2, R = Math.hypot(site.w, site.h) * 0.62 + 30;
    const le = [cx + sunDir[0] * 600, sunDir[1] * 600, cz + sunDir[2] * 600];
    const LV = M4.lookAt(le, [cx, 0, cz], Math.abs(sunDir[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
    const LP = M4.ortho(-R, R, -R, R, 1, 1400);
    const LVP = M4.mul(LP, LV);
    const shadows = !line && app.state.layers.shadows && sky.shadows;
    // 사람·차량(켜져 있을 때만)
    const tr = this.aprog && app.traffic && app.state.traffic && app.state.traffic.on && app.traffic.ready ? app.traffic : null;
    const hasAgents = !!tr;
    if (tr) this._uploadAgents(tr.fill(e, (this.cssH || 600) / (2 * Math.tan(this.cam.fov / 2))));
    let shadowTex = this.shTex;
    if (shadows) {
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      gl.colorMask(false, false, false, false);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.0, 4.0);
      const key = this.meshVer + '|' + sunDir.map((v) => v.toFixed(4)).join(',') + '|' + site.w + 'x' + site.h;
      if (key !== this._shKey) { // 고정 장면의 그림자는 장면이나 해가 바뀔 때만 다시 그린다
        this._shKey = key;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFbo);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.dprog.p);
        gl.uniformMatrix4fv(this.dprog.u.u_lvp, false, LVP);
        [this.meshes.solid, this.meshes.leaf, this.meshes.treeSh].forEach((m) => { if (m && m.count) { gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); } });
      }
      if (hasAgents) { // 고정 그림자를 복사한 뒤 사람·차량의 그림자를 덧그린다
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.shFbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.shFboD);
        gl.blitFramebuffer(0, 0, this.shadowSize, this.shadowSize, 0, 0, this.shadowSize, this.shadowSize, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFboD);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.useProgram(this.adprog.p);
        gl.uniformMatrix4fv(this.adprog.u.u_lvp, false, LVP);
        this._drawAgents(this.adprog);
        shadowTex = this.shTexD;
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, this.cv.width, this.cv.height);
    let bg = line ? [1, 1, 1] : sky.hor.map((v, i) => v + (sky.top[i] - v) * 0.38);
    const TH = UDS.TH;
    if (TH && TH.inkOn()) bg = line ? [0.105, 0.12, 0.14] : bg.map((v, i) => v * 0.32 + [0.075, 0.088, 0.105][i] * 0.68); // 다크: 하늘·먼 땅을 어둡게(건물 빛은 그대로)
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const pr = this.prog;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.u_vp, false, VP);
    gl.uniformMatrix4fv(pr.u.u_lvp, false, LVP);
    gl.uniform3fv(pr.u.u_sun, sunDir);
    gl.uniform3fv(pr.u.u_sunCol, sky.lightCol);
    gl.uniform3fv(pr.u.u_ambSky, sky.ambSky);
    gl.uniform3fv(pr.u.u_ambGnd, sky.ambGnd);
    gl.uniform1f(pr.u.u_glow, line ? 0 : sky.glow);
    gl.uniform1f(pr.u.u_lit, 0.22 + 0.38 * sky.night);
    gl.uniform4f(pr.u.u_lampRect, this.lampRect[0], this.lampRect[1], this.lampRect[2], this.lampRect[3]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lampTex);
    gl.uniform1i(pr.u.u_lamp, 1);
    this._cmBind(pr);
    gl.uniform1f(pr.u.u_line, line ? 1 : 0);
    gl.uniform1f(pr.u.u_shadowOn, shadows ? 1 : 0);
    gl.uniform1f(pr.u.u_pickMode, 0);
    gl.uniform3fv(pr.u.u_eye, e);
    gl.uniform3fv(pr.u.u_fog, bg);
    const diag = Math.hypot(site.w, site.h);
    gl.uniform4f(pr.u.u_center, cx, cz, diag * 0.75, diag * 2.4);
    // 고른 요소 강조(여럿이면 뒤에 고른 것부터 MAX_SEL개까지)
    const selBuf = this._selBuf || (this._selBuf = new Float32Array(MAX_SEL * 3));
    let nsel = 0;
    if (this.pickMap) {
      const list = app.selList();
      const put = (key) => { const c = this.pickMap.get(key); if (c && nsel < MAX_SEL) { selBuf.set(c, nsel * 3); nsel++; } };
      for (let i = list.length - 1; i >= 0 && nsel < MAX_SEL; i--) {
        const t = list[i];
        if (t.type === 'block') app.D.lots.forEach((l) => { if (l.blockId === t.id) put('lot:' + l.id); }); // 가구: 그 안의 획지 바닥
        else put(t.type + ':' + t.id);
      }
    }
    gl.uniform3fv(pr.u['u_sels[0]'], selBuf);
    gl.uniform1i(pr.u.u_nsel, nsel);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(pr.u.u_shadow, 0);
    const drawM = (m) => { if (!m.count) return; gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); };
    if (line) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.0, 1.0); }
    gl.uniform1f(pr.u.u_alpha, 1);
    gl.depthFunc(gl.ALWAYS); gl.depthMask(true);
    gl.uniform1f(pr.u.u_fade, under && !line ? 0.5 : 0);
    drawM(this.meshes.ground);
    this._punch(VP); // 하천 물길 자리의 깊이를 비운다(땅속 수면·호안이 보이게)
    drawM(this.meshes.ground2);
    gl.uniform1f(pr.u.u_fade, 0);
    const ovk = this._ovKeyNow();
    if (ovk !== this.ovKey) { this.ovKey = ovk; this._buildOverlay(); }
    if (this.meshes.ovG && this.meshes.ovG.count) { // 바닥 덧그림: 바닥 위에 반투명하게
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.uniform1f(pr.u.u_alpha, 0.82);
      drawM(this.meshes.ovG);
      gl.uniform1f(pr.u.u_alpha, 1);
      gl.disable(gl.BLEND);
    }
    gl.depthFunc(gl.LESS);
    if (under) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(pr.u.u_shadowOn, 0);
      gl.uniform1f(pr.u.u_line, 0);
      drawM(this.meshes.pipes);
      gl.uniform1f(pr.u.u_line, line ? 1 : 0);
      gl.uniform1f(pr.u.u_shadowOn, shadows ? 1 : 0);
    }
    drawM(this.meshes.solid);
    if (this.meshes.ov3) drawM(this.meshes.ov3);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (this.meshes.bb && this.meshes.bb.count && this.bprog && this.atlas) {
      this._drawTrees({ VP, LVP, e, sky, sunDir, line, shadows, selBuf, nsel });
      gl.useProgram(pr.p);
    }
    if (hasAgents) {
      const ap = this.aprog;
      gl.useProgram(ap.p);
      gl.uniformMatrix4fv(ap.u.u_vp, false, VP);
      gl.uniformMatrix4fv(ap.u.u_lvp, false, LVP);
      gl.uniform3fv(ap.u.u_sun, sunDir);
      gl.uniform3fv(ap.u.u_sunCol, sky.lightCol);
      gl.uniform3fv(ap.u.u_ambSky, sky.ambSky);
      gl.uniform3fv(ap.u.u_ambGnd, sky.ambGnd);
      gl.uniform3fv(ap.u.u_eye, e);
      gl.uniform3fv(ap.u.u_fog, bg);
      gl.uniform1f(ap.u.u_glow, line ? 0 : sky.glow);
      gl.uniform1f(ap.u.u_line, line ? 1 : 0);
      gl.uniform1f(ap.u.u_shadowOn, shadows ? 1 : 0);
      gl.uniform4f(ap.u.u_lampRect, this.lampRect[0], this.lampRect[1], this.lampRect[2], this.lampRect[3]);
      gl.uniform1i(ap.u.u_shadow, 0); gl.uniform1i(ap.u.u_lamp, 1);
      this._drawAgents(ap);
    }
    // 선
    const lp = this.lprog;
    gl.useProgram(lp.p);
    gl.uniformMatrix4fv(lp.u.u_vp, false, VP);
    gl.depthFunc(gl.LEQUAL);
    gl.uniform1f(lp.u.u_black, line ? 1 : 0);
    if (this.meshes.wires.count) { gl.bindVertexArray(this.meshes.wires.vao); gl.drawArrays(gl.LINES, 0, this.meshes.wires.count); }
    if (line && this.meshes.edges.count) { gl.uniform1f(lp.u.u_black, 1); gl.bindVertexArray(this.meshes.edges.vao); gl.drawArrays(gl.LINES, 0, this.meshes.edges.count); }
    if (this.meshes.ovL && this.meshes.ovL.count) { gl.uniform1f(lp.u.u_black, 0); gl.bindVertexArray(this.meshes.ovL.vao); gl.drawArrays(gl.LINES, 0, this.meshes.ovL.count); }
    this._secLabels(VP);
    // 수관: 반투명. 먼저 깊이만 써서 맨 앞 면을 정한 뒤, 그 면만 뒤 장면 위에 섞는다(나무를 거리순으로 정렬하지 않아도 됨)
    const lf = this.meshes.leaf;
    if (lf && lf.count) {
      gl.useProgram(pr.p);
      gl.bindVertexArray(lf.vao);
      gl.depthFunc(gl.LESS); gl.depthMask(true);
      gl.colorMask(false, false, false, false);
      gl.uniform1f(pr.u.u_alpha, 1);
      gl.drawElements(gl.TRIANGLES, lf.count, gl.UNSIGNED_INT, 0);
      gl.colorMask(true, true, true, true);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
      gl.uniform1f(pr.u.u_alpha, line ? 0.7 : LEAF_ALPHA);
      gl.drawElements(gl.TRIANGLES, lf.count, gl.UNSIGNED_INT, 0);
      gl.disable(gl.BLEND); gl.depthMask(true); gl.depthFunc(gl.LESS);
      gl.uniform1f(pr.u.u_alpha, 1);
    }
    gl.bindVertexArray(null);
    this.dirty = false;
    if (UDS.ui && UDS.ui.bldBar) UDS.ui.bldBar('3d');
    this.compass();
  };
  /* 방위표: 카메라가 바라보는 방위에 맞춰 바늘과 N·E·S·W 글자를 돌린다(글자는 똑바로) */
  Rr.compass = function () {
    const el = this._cmp || (this._cmp = document.getElementById('compass3'));
    if (!el) return;
    const a = this.cam.yaw; // 화면에서 북쪽이 위(시계 방향 +)에서 돌아간 각
    const R = (el.clientWidth || 46) * 0.36, key = a + '|' + R;
    if (this._cmpA === key) return;
    this._cmpA = key;
    const nd = el.querySelector('.cn'); if (nd) nd.style.transform = `rotate(${a.toFixed(4)}rad)`;
    el.querySelectorAll('b').forEach((b) => {
      const t = a + (+b.dataset.c * Math.PI) / 2;
      b.style.transform = `translate(${(Math.sin(t) * R).toFixed(2)}px,${(-Math.cos(t) * R).toFixed(2)}px)`;
    });
  };
  /* 북쪽이 위로 오게 부드럽게 돌린다 */
  Rr.turnNorth = function () {
    const c = this.cam, app = this.app;
    let y0 = c.yaw % (Math.PI * 2); if (y0 > Math.PI) y0 -= Math.PI * 2; if (y0 < -Math.PI) y0 += Math.PI * 2;
    c.yaw = y0;
    cancelAnimationFrame(this._turn);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || Math.abs(y0) < 1e-3) { c.yaw = 0; app.invalidate(2); return; }
    const t0 = performance.now(), ms = 420;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      c.yaw = y0 * (1 - e);
      app.invalidate(2);
      if (k < 1) this._turn = requestAnimationFrame(step);
    };
    this._turn = requestAnimationFrame(step);
  };
  /* 건물이 화면에 차지하는 상자(CSS 픽셀). 카메라 뒤에 있거나 화면 밖이면 null */
  Rr.bldScreenBox = function (b) {
    if (!this.ok) return null;
    const { VP } = this.matrices(), W = this.cssW || 1, H = this.cssH || 1;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    const top = b.h + (b.gable ? b.gable.rise || 0 : 0.9);
    b.fp.forEach((p) => [0, top].forEach((y) => {
      const q = M4.xf(VP, [p[0], y, -p[1], 1]); if (q[3] <= 0.05) return;
      const sx = (q[0] / q[3] * 0.5 + 0.5) * W, sy = (1 - (q[1] / q[3] * 0.5 + 0.5)) * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); n++;
    }));
    if (!n || x1 < 0 || y1 < 0 || x0 > W || y0 > H) return null;
    return { x0, y0, x1, y1 };
  };

  /* face-me 나무 그리기. 가장자리는 알파 → 표본 덮개(MSAA)로 매끄럽게 하되 화면의 알파는 건드리지 않는다. 선택 그림에서는 딱 잘라 그린다 */
  Rr._drawTrees = function (o) {
    const gl = this.gl, bp = this.bprog, m = this.meshes.bb;
    gl.useProgram(bp.p);
    gl.uniformMatrix4fv(bp.u.u_vp, false, o.VP);
    gl.uniform3fv(bp.u.u_eye, o.e);
    gl.uniform1f(bp.u.u_pickMode, o.pick ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.atlas.tex);
    gl.uniform1i(bp.u.u_tex, 2); gl.uniform1i(bp.u.u_shadow, 0); gl.uniform1i(bp.u.u_lamp, 1);
    gl.activeTexture(gl.TEXTURE0);
    if (!o.pick) {
      const sky = o.sky;
      gl.uniformMatrix4fv(bp.u.u_lvp, false, o.LVP);
      gl.uniform3fv(bp.u.u_sun, o.sunDir); gl.uniform3fv(bp.u.u_sunCol, sky.lightCol); gl.uniform3fv(bp.u.u_ambSky, sky.ambSky); gl.uniform3fv(bp.u.u_ambGnd, sky.ambGnd);
      gl.uniform1f(bp.u.u_glow, o.line ? 0 : sky.glow);
      gl.uniform1f(bp.u.u_line, o.line ? 1 : 0);
      gl.uniform1f(bp.u.u_shadowOn, o.shadows ? 1 : 0);
      gl.uniform1f(bp.u.u_lzs, 1 / 1399);
      gl.uniform4f(bp.u.u_lampRect, this.lampRect[0], this.lampRect[1], this.lampRect[2], this.lampRect[3]);
      gl.uniform3fv(bp.u['u_sels[0]'], o.selBuf); gl.uniform1i(bp.u.u_nsel, o.nsel);
    } else { gl.uniform1i(bp.u.u_nsel, 0); gl.uniform1f(bp.u.u_line, 0); }
    const a2c = !o.pick;
    gl.uniform1f(bp.u.u_a2c, a2c ? 1 : 0);
    if (a2c) { gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.colorMask(true, true, true, false); }
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    if (a2c) { gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.colorMask(true, true, true, true); }
    gl.bindVertexArray(null);
  };

  /* 선택: 색상 ID 렌더 */
  /* 하천 물길: 바닥(지면)을 그린 뒤 물길 자리의 깊이를 가장 멀게 되돌린다(색은 그대로). 이어 그리는 수면·호안 벽이 그 자리에서만 보인다 */
  Rr._punch = function (VP) {
    const gl = this.gl, m = this.meshes.punch;
    if (!m || !m.count || !this.pprog) return;
    const prev = gl.getParameter(gl.CURRENT_PROGRAM), df = gl.getParameter(gl.DEPTH_FUNC);
    gl.useProgram(this.pprog.p);
    gl.uniformMatrix4fv(this.pprog.u.u_vp, false, VP);
    gl.colorMask(false, false, false, false); gl.depthFunc(gl.ALWAYS); gl.depthMask(true);
    gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    gl.colorMask(true, true, true, true); gl.depthFunc(df);
    gl.useProgram(prev);
  };
  Rr.pickAt = function (sx, sy) {
    if (!this.ok || !this.meshes.ground) return null;
    const gl = this.gl;
    const w = this.cv.width, h = this.cv.height;
    if (!this.pFbo || this.pW !== w || this.pH !== h) {
      if (this.pFbo) { gl.deleteFramebuffer(this.pFbo); gl.deleteRenderbuffer(this.pCol); gl.deleteRenderbuffer(this.pDep); }
      this.pFbo = gl.createFramebuffer(); this.pCol = gl.createRenderbuffer(); this.pDep = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.pCol); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.pDep); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pFbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.pCol);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pDep);
      this.pW = w; this.pH = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pFbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const pr = this.prog;
    gl.useProgram(pr.p);
    const { VP } = this.matrices();
    gl.uniformMatrix4fv(pr.u.u_vp, false, VP);
    gl.uniform1i(pr.u.u_shadow, 0); gl.uniform1i(pr.u.u_lamp, 1);
    this._cmBind(pr);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lampTex);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shTex);
    gl.uniform1f(pr.u.u_pickMode, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.bindVertexArray(this.meshes.ground.vao); gl.drawElements(gl.TRIANGLES, this.meshes.ground.count, gl.UNSIGNED_INT, 0);
    this._punch(VP);
    if (this.meshes.ground2 && this.meshes.ground2.count) { gl.bindVertexArray(this.meshes.ground2.vao); gl.drawElements(gl.TRIANGLES, this.meshes.ground2.count, gl.UNSIGNED_INT, 0); }
    gl.depthFunc(gl.LESS);
    gl.bindVertexArray(this.meshes.solid.vao); gl.drawElements(gl.TRIANGLES, this.meshes.solid.count, gl.UNSIGNED_INT, 0);
    if (this.meshes.leaf && this.meshes.leaf.count) { gl.bindVertexArray(this.meshes.leaf.vao); gl.drawElements(gl.TRIANGLES, this.meshes.leaf.count, gl.UNSIGNED_INT, 0); }
    if (this.meshes.bb && this.meshes.bb.count && this.bprog && this.atlas) { this._drawTrees({ VP, e: this.eye(), pick: true }); gl.useProgram(pr.p); }
    const px = new Uint8Array(4);
    const rx = Math.round((sx / this.cssW) * w), ry = Math.round(h - (sy / this.cssH) * h);
    gl.readPixels(U.clamp(rx, 0, w - 1), U.clamp(ry, 0, h - 1), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.uniform1f(pr.u.u_pickMode, 0);
    const id = px[0] + (px[1] << 8) + (px[2] << 16);
    return this.pickTable[id] || null;
  };

  UDS.Render3D = Render3D;
})(typeof window !== 'undefined' ? window : globalThis);
