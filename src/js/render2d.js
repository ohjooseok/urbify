/* Urbify — 2D 평면(채색/선 도면) 렌더러, 선택 판정, SVG 내보내기 */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C;

  const TH = C.THEME;
  const COL = { ...C.PAL, shadow: '#2a2622' };

  /* ---------- 펜: 캔버스 ---------- */
  function CanvasPen(r) {
    const ctx = r.ctx;
    const tr = (p) => r.w2s(p);
    const px = (st, k) => (st[k + 'W'] !== undefined ? st[k + 'W'] * r.view.s : st[k] !== undefined ? st[k] : 1);
    const path = (pts, close) => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) { const q = tr(pts[i]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
      if (close) ctx.closePath();
    };
    const strokeIt = (st) => {
      if (!st.stroke) return;
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = Math.max(0.2, px(st, 'lw'));
      ctx.setLineDash(st.dash ? st.dash.map((d) => (st.dashW ? d * r.view.s : d)) : []);
      ctx.lineCap = st.cap || 'butt';
      ctx.lineJoin = st.join || 'miter';
      ctx.globalAlpha = st.salpha !== undefined ? st.salpha : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    };
    return {
      kind: 'canvas',
      layer() {},
      poly(pts, st) {
        if (!pts || pts.length < 3) return;
        path(pts, true);
        if (st.fill) { ctx.fillStyle = st.fill; ctx.globalAlpha = st.alpha !== undefined ? st.alpha : 1; ctx.fill(); ctx.globalAlpha = 1; }
        if (st.hatch) { ctx.save(); ctx.clip(); ctx.fillStyle = r.hatchPattern(st.hatch); ctx.fillRect(0, 0, r.cv.width, r.cv.height); ctx.restore(); }
        strokeIt(st);
      },
      line(pts, st) { if (!pts || pts.length < 2) return; path(pts, false); strokeIt(st); },
      /* 구멍이 있는 다각형(고리 여럿): 홀짝 규칙으로 채움 */
      rings(rings, st) {
        if (!rings.length) return;
        ctx.beginPath();
        rings.forEach((pts) => { for (let i = 0; i < pts.length; i++) { const q = tr(pts[i]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } ctx.closePath(); });
        if (st.fill) { ctx.fillStyle = st.fill; ctx.globalAlpha = st.alpha !== undefined ? st.alpha : 1; ctx.fill('evenodd'); ctx.globalAlpha = 1; }
        strokeIt(st);
      },
      /* 여러 다각형을 한 번에 채움: 겹친 곳이 덧칠되어 진해지지 않음 */
      multi(polys, st) {
        if (!polys.length) return;
        ctx.beginPath();
        polys.forEach((pts) => { for (let i = 0; i < pts.length; i++) { const q = tr(pts[i]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } ctx.closePath(); });
        ctx.fillStyle = st.fill; ctx.globalAlpha = st.alpha !== undefined ? st.alpha : 1; ctx.fill('nonzero'); ctx.globalAlpha = 1;
      },
      circle(c, rad, st) {
        const q = tr(c);
        const rr = st.rpx ? rad : rad * r.view.s;
        ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(0.5, rr), 0, Math.PI * 2);
        if (st.fill) { ctx.fillStyle = st.fill; ctx.globalAlpha = st.alpha !== undefined ? st.alpha : 1; ctx.fill(); ctx.globalAlpha = 1; }
        strokeIt(st);
      },
      text(p, s, st) {
        const q = tr(p);
        ctx.save();
        ctx.translate(q[0], q[1]);
        if (st.rot) ctx.rotate(-st.rot);
        ctx.font = `${st.weight || 500} ${st.size || 11}px ${UDS.FONT}`;
        ctx.textAlign = st.align || 'center';
        ctx.textBaseline = 'middle';
        if (st.halo) { ctx.lineWidth = 3; ctx.strokeStyle = st.halo; ctx.lineJoin = 'round'; ctx.strokeText(s, 0, 0); }
        ctx.fillStyle = st.color || COL.text;
        ctx.fillText(s, 0, 0);
        ctx.restore();
      },
    };
  }

  /* ---------- 펜: SVG ---------- */
  function SvgPen(pxToM) {
    const out = [];
    let open = -1; // 열려 있는 레이어의 여는 태그 자리(-1이면 없음)
    const ids = new Set();
    const closeLayer = () => {
      if (open < 0) return;
      if (open === out.length - 1) out.pop(); else out.push('</g>'); // 빈 레이어는 적지 않는다
      open = -1;
    };
    const f = (v) => (Math.round(v * 100) / 100).toString();
    const P = (p) => f(p[0]) + ',' + f(-p[1]);
    const w = (st, k) => (st[k + 'W'] !== undefined ? st[k + 'W'] : (st[k] !== undefined ? st[k] : 1) * pxToM);
    const strokeAttr = (st) => {
      if (!st.stroke) return ' stroke="none"';
      let a = ` stroke="${st.stroke}" stroke-width="${f(Math.max(0.02, w(st, 'lw')))}"`;
      if (st.dash) a += ` stroke-dasharray="${st.dash.map((d) => f(st.dashW ? d : d * pxToM)).join(' ')}"`;
      if (st.cap) a += ` stroke-linecap="${st.cap}"`;
      if (st.salpha !== undefined) a += ` stroke-opacity="${st.salpha}"`;
      return a;
    };
    return {
      kind: 'svg', out,
      /* 레이어(편집 프로그램에서 따로 고를 수 있는 묶음). id는 영문, label은 보이는 이름 */
      layer(id, label) {
        closeLayer();
        if (!id) return;
        let k = id, n = 2; while (ids.has(k)) k = `${id}-${n++}`;
        ids.add(k);
        out.push(`<g id="${k}" inkscape:groupmode="layer" inkscape:label="${U.esc(label || id)}" data-name="${U.esc(label || id)}">`);
        open = out.length - 1;
      },
      end() { closeLayer(); },
      poly(pts, st) {
        if (!pts || pts.length < 3) return;
        let fill = st.fill || 'none';
        if (st.hatch) fill = 'url(#hatch)';
        out.push(`<polygon points="${pts.map(P).join(' ')}" fill="${fill}"${st.alpha !== undefined && st.fill ? ` fill-opacity="${st.alpha}"` : ''}${strokeAttr(st)}/>`);
        if (st.hatch && st.fill) out.splice(out.length - 1, 0, `<polygon points="${pts.map(P).join(' ')}" fill="${st.fill}" stroke="none"/>`);
      },
      line(pts, st) { if (!pts || pts.length < 2) return; out.push(`<polyline points="${pts.map(P).join(' ')}" fill="none"${strokeAttr(st)}/>`); },
      rings(rings, st) { if (!rings.length) return; out.push(`<path d="${rings.map((pts) => 'M' + pts.map(P).join(' L') + ' Z').join(' ')}" fill="${st.fill || 'none'}" fill-rule="evenodd"${st.alpha !== undefined && st.fill ? ` fill-opacity="${st.alpha}"` : ''}${strokeAttr(st)}/>`); },
      multi(polys, st) { if (!polys.length) return; out.push(`<path d="${polys.map((pts) => 'M' + pts.map(P).join(' L') + ' Z').join(' ')}" fill="${st.fill}" fill-rule="nonzero"${st.alpha !== undefined ? ` fill-opacity="${st.alpha}"` : ''} stroke="none"/>`); },
      circle(c, r, st) {
        const rr = st.rpx ? r * pxToM : r;
        out.push(`<circle cx="${f(c[0])}" cy="${f(-c[1])}" r="${f(rr)}" fill="${st.fill || 'none'}"${st.alpha !== undefined && st.fill ? ` fill-opacity="${st.alpha}"` : ''}${strokeAttr(st)}/>`);
      },
      text(p, s, st) {
        const size = (st.size || 11) * pxToM;
        const rot = st.rot ? ` transform="rotate(${f((-st.rot * 180) / Math.PI)} ${f(p[0])} ${f(-p[1])})"` : '';
        out.push(`<text x="${f(p[0])}" y="${f(-p[1])}" font-size="${f(size)}" text-anchor="${st.align === 'left' ? 'start' : st.align === 'right' ? 'end' : 'middle'}" dominant-baseline="middle" fill="${st.color || '#222'}" font-family="Noto Sans KR, sans-serif"${rot}>${U.esc(s)}</text>`);
      },
    };
  }

  /* ---------- 렌더러 ---------- */
  function Render2D(canvas, app) {
    this.cv = canvas;
    this.ctx = UDS.TH ? UDS.TH.wrap(canvas.getContext('2d')) : canvas.getContext('2d'); // 다크 테마: 그리는 색을 바꿔 줌
    this.app = app;
    this.view = { cx: 200, cy: 150, s: 2 };
    this.dpr = 1;
    this.W = 10; this.H = 10;
    this._hatch = {};
  }
  const R = Render2D.prototype;

  R.resize = function () {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(10, r.width); this.H = Math.max(10, r.height);
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
  };
  R.fit = function (site, pad = 1.12) {
    this.view.s = Math.min(this.W / (site.w * pad), this.H / (site.h * pad));
    this.view.cx = site.w / 2; this.view.cy = site.h / 2;
  };
  /* 상자 [x0, y0, x1, y1](세계 좌표, m)가 화면에 들어오는 보기. 너무 작은 상자는 minM(m)만큼으로 본다 */
  R.viewFor = function (bx, pad = 1.25, minM = 40) {
    const w = Math.max(minM, bx[2] - bx[0]), h = Math.max(minM, bx[3] - bx[1]);
    return { cx: (bx[0] + bx[2]) / 2, cy: (bx[1] + bx[3]) / 2, s: U.clamp(Math.min(this.W / (w * pad), this.H / (h * pad)), 0.15, 60) };
  };
  R.w2s = function (p) { return [(p[0] - this.view.cx) * this.view.s + this.W / 2, this.H / 2 - (p[1] - this.view.cy) * this.view.s]; };
  R.s2w = function (q) { return [(q[0] - this.W / 2) / this.view.s + this.view.cx, (this.H / 2 - q[1]) / this.view.s + this.view.cy]; };
  R.zoomAt = function (q, k) {
    const before = this.s2w(q);
    this.view.s = U.clamp(this.view.s * k, 0.15, 60);
    const after = this.s2w(q);
    this.view.cx += before[0] - after[0];
    this.view.cy += before[1] - after[1];
  };
  R.hatchPattern = function (kind) {
    if (this._hatch[kind]) return this._hatch[kind];
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d');
    g.strokeStyle = kind === 'light' ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.55)';
    g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
    this._hatch[kind] = this.ctx.createPattern(c, 'repeat');
    return this._hatch[kind];
  };

  R.draw = function () {
    const app = this.app, ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const line = app.modeOf('2d') === 'line';
    ctx.fillStyle = line ? '#ffffff' : COL.outside;
    ctx.fillRect(0, 0, this.W, this.H);
    if (!app.D) return;
    if (!line) this.drawGrid();
    const pen = CanvasPen(this);
    const sky = UDS.sky(app.P.settings);
    const o = { line, s: this.view.s, layers: app.state.layers, sel: app.state.sel, hover: app.state.hover, app, sky, noLabels: true, dark: !line && sky.dark, sec: app.state.secRoadId ? { id: app.state.secRoadId, s: app.state.secS } : null, anaLayer: () => this.drawAna(line) };
    drawScene(pen, app.P, app.D, o);
    if (app.underlay && app.state.layers.underlay) this.drawUnderlay();
    if (!line) this.drawNight(sky);
    drawLabels(pen, app.P, app.D, o);
    this.drawOverlay(pen, line);
    this.drawHud(line);
    if (UDS.ui && UDS.ui.bldBar) UDS.ui.bldBar('2d');
  };
  /* 건물(과 돌리기 손잡이)이 화면에 차지하는 상자. 화면 밖이면 null */
  R.bldScreenBox = function (b) {
    const pts = b.fp.slice(), h = this.app.bldRotHandle && this.app.bldRotHandle(b);
    if (h) pts.push(h.p);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p) => { const q = this.w2s(p); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
    if (x1 < 0 || y1 < 0 || x0 > this.W || y0 > this.H) return null;
    return { x0, y0, x1, y1 };
  };

  /* 조도분석 지도: 칸 하나가 화소 하나인 그림을 대상지 크기로 늘려 반투명하게 얹는다 */
  R.drawAna = function (line) {
    const app = this.app, X = UDS.Ana;
    if (!X) return;
    const r = X.active(app);
    if (!r) return;
    const cv = X.canvas(r), ctx = this.ctx;
    const a = this.w2s([r.x0, r.y0 + r.ny * r.cell]), b = this.w2s([r.x0 + r.nx * r.cell, r.y0]);
    ctx.save();
    ctx.globalAlpha = line ? 0.55 : 0.8; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cv, a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.restore();
  };
  /* 태양 궤적도(평면): 대상지 가운데를 중심으로 한 등거리 방위도. 바깥 원이 지평선(고도 0°), 가운데가 천정 */
  R.drawSunPath = function (pen, line) {
    const app = this.app, P = app.P, S = P.settings, X = UDS.Ana, s = this.view.s;
    const c = [P.site.w / 2, P.site.h / 2], R0 = Math.min(P.site.w, P.site.h) * 0.42;
    const ink = line ? '#000' : '#B5651D', soft = line ? '#555' : '#C98A4B';
    const at = (az, alt) => { const r = (R0 * (Math.PI / 2 - alt)) / (Math.PI / 2); return [c[0] + r * Math.sin(az), c[1] + r * Math.cos(az)]; };
    const circ = (r) => { const out = []; for (let i = 0; i <= 96; i++) { const t = (i / 96) * Math.PI * 2; out.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]); } return out; };
    pen.poly(circ(R0), { stroke: '#fff', lw: 3.2, salpha: 0.7 });
    pen.poly(circ(R0), { stroke: soft, lw: 1.3 });
    [1 / 3, 2 / 3].forEach((f) => pen.poly(circ(R0 * f), { stroke: soft, lw: 0.8, dash: [4, 4] }));
    for (let k = 0; k < 12; k++) { const t = (k / 12) * Math.PI * 2; pen.line([at(t, Math.PI / 2 - 0.0001), at(t, 0)], { stroke: soft, lw: 0.6, dash: [2, 5], salpha: 0.8 }); }
    const halo = 'rgba(255,255,255,0.92)';
    [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', Math.PI * 1.5]].forEach(([n, t]) => pen.text([c[0] + Math.sin(t) * (R0 + 11 / s), c[1] + Math.cos(t) * (R0 + 11 / s)], n, { size: 11, weight: 800, color: ink, halo }));
    [[30, 2 / 3], [60, 1 / 3]].forEach(([d, f]) => pen.text([c[0] + 4 / s, c[1] + R0 * f + 6 / s], `${d}°`, { size: 9.5, color: soft, halo, align: 'left' }));
    // 바깥쪽(중심에서 먼 쪽)으로 d픽셀 떨어진 자리
    const outward = (p, d) => { const v = U.sub(p, c), L = U.len(v) || 1; return U.add(p, U.mul(v, d / s / L)); };
    X.sunPath(S).forEach((sp) => {
      const pts = sp.pts.map((q) => at(q.az, q.alt));
      if (sp.cur) pen.line(pts, { stroke: '#fff', lw: 4.4, salpha: 0.8 });
      pen.line(pts, { stroke: ink, lw: sp.cur ? 2.2 : 1.1, dash: sp.cur ? null : [6, 4] });
      // 계절 이름: 해 질 녘(서쪽) 끝 가까이
      const lp = sp.pts[Math.max(0, sp.pts.length - 1 - Math.round(sp.pts.length * 0.12))];
      if (lp) pen.text(outward(at(lp.az, lp.alt), -13), sp.name, { size: 9.5, weight: sp.cur ? 800 : 500, color: ink, halo });
      if (sp.cur) sp.hours.forEach((q) => { const p = at(q.az, q.alt); pen.circle(p, 3.2, { rpx: true, fill: '#fff', stroke: ink, lw: 1.4 }); if (q.h % 3 === 0) pen.text(outward(p, 13), `${q.h}시`, { size: 9, color: ink, halo }); });
    });
    const v = UDS.sunVector(S);
    if (v.alt > 0) {
      const p = at(v.az, v.alt);
      pen.line([c, p], { stroke: ink, lw: 1, dash: [3, 3] });
      pen.circle(p, 7.5, { rpx: true, fill: line ? '#fff' : '#F6B93B', stroke: ink, lw: 1.6 });
      const n = X.sunNow(S);
      pen.text(outward(p, -22), `${UDS.fmtTime(S.hour)} · 고도 ${U.fmt(n.alt, 0)}°`, { size: 10, weight: 700, color: ink, halo });
    }
  };

  /* 가져온 지도 그림을 평면 위에 반투명하게 겹쳐 인식 결과와 견줘 본다 */
  R.drawUnderlay = function () {
    const u = this.app.underlay, ctx = this.ctx, sh = this.app.P.shift || [0, 0]; // 대상지를 서·남쪽으로 넓혔으면 밑그림도 함께 민다
    const a = this.w2s([sh[0], u.h + sh[1]]), b = this.w2s([u.w + sh[0], sh[1]]);
    ctx.globalAlpha = 0.5; ctx.imageSmoothingQuality = 'high';
    try { ctx.drawImage(u.img, a[0], a[1], b[0] - a[0], b[1] - a[1]); } catch (e) { /* 그림을 쓸 수 없으면 건너뜀 */ }
    ctx.globalAlpha = 1;
  };

  /* 어두운 시각: 전체를 남색으로 가라앉히고 켜진 가로등 둘레만 밝힘 */
  R.drawNight = function (sky) {
    const ctx = this.ctx, app = this.app, D = app.D;
    if (sky.night > 0.02) { ctx.fillStyle = `rgba(8,13,34,${0.6 * sky.night})`; ctx.fillRect(0, 0, this.W, this.H); }
    if (sky.glow <= 0.02 || !app.state.layers.furniture) return;
    const s = this.view.s;
    ctx.globalCompositeOperation = 'lighter';
    const pool = (x, y, r, a) => {
      const q = this.w2s([x, y]), pr = r * s;
      if (q[0] < -pr || q[1] < -pr || q[0] > this.W + pr || q[1] > this.H + pr) return;
      const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], pr);
      g.addColorStop(0, `rgba(255,214,150,${a})`); g.addColorStop(0.35, `rgba(255,200,130,${a * 0.42})`); g.addColorStop(1, 'rgba(255,200,130,0)');
      ctx.fillStyle = g; ctx.fillRect(q[0] - pr, q[1] - pr, pr * 2, pr * 2);
    };
    const a0 = 0.5 * sky.glow * (0.35 + 0.65 * sky.night);
    D.lights.forEach((l) => { const ang = l.ang + (l.dir < 0 ? -Math.PI / 2 : Math.PI / 2); pool(l.x + Math.cos(ang) * 1.4, l.y + Math.sin(ang) * 1.4, 15, a0); });
    D.furniture.forEach((f) => { if (f.type === 'light') pool(f.x, f.y, 8, a0); else if (f.type === 'smartpole') pool(f.x, f.y, 13, a0); else if (f.type === 'busstop') pool(f.x, f.y, 5, a0 * 0.8); });
    ctx.globalCompositeOperation = 'source-over';
  };

  /* 바깥 제도 격자: 10m 가는 선, 50m 굵은 선 */
  R.drawGrid = function () {
    const ctx = this.ctx, s = this.view.s;
    const a = this.s2w([0, this.H]), b = this.s2w([this.W, 0]);
    const draw = (step, color) => {
      if (step * s < 7) return;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = Math.floor(a[0] / step) * step; x <= b[0]; x += step) { const q = this.w2s([x, 0]); ctx.moveTo(Math.round(q[0]) + 0.5, 0); ctx.lineTo(Math.round(q[0]) + 0.5, this.H); }
      for (let y = Math.floor(a[1] / step) * step; y <= b[1]; y += step) { const q = this.w2s([0, y]); ctx.moveTo(0, Math.round(q[1]) + 0.5); ctx.lineTo(this.W, Math.round(q[1]) + 0.5); }
      ctx.stroke();
    };
    draw(10, 'rgba(60,60,67,0.05)');
    draw(50, 'rgba(60,60,67,0.1)');
  };

  /* 선택·도구 미리보기 */
  R.drawOverlay = function (pen, line) {
    const app = this.app, st = app.state, P = app.P, D = app.D;
    const sel = st.sel;
    const sels = app.selList();
    const picked = (t) => sels.some((x) => x.id === t.id);
    const hl = (target, color, w) => {
      if (!target) return;
      if (target.type === 'road') {
        const info = D.roadInfo.get(target.id);
        if (!info) return;
        const W = info.lay.W;
        const L = U.offsetPolyline(info.road.pts, W / 2), Rr = U.offsetPolyline(info.road.pts, -W / 2);
        pen.poly(L.concat(Rr.slice().reverse()), { fill: color, alpha: 0.12, stroke: color, lw: w });
        pen.line(info.road.pts, { stroke: color, lw: 1.2, dash: [6, 4] });
        // 꼭짓점 손잡이는 끌어 옮길 수 있을 때(이동 도구)만 보인다. 단지 안 길(곡선·둥근 모서리)은 찍은 점과 그 점을 잇는 가는 선
        if (target === sel && info.road.ctrl && info.road.shape !== 'line') pen.line(info.road.ctrl, { stroke: color, lw: 1, dash: [2, 3], salpha: 0.8 });
        if (target === sel && st.tool === 'move') UDS.Model.verts(info.road).forEach((p, i) => pen.circle(p, 5.5, { rpx: true, fill: '#fff', stroke: color, lw: 2 }));
      } else if (target.type === 'lot' || target.type === 'building') {
        const lot = D.lots.find((l) => l.id === target.id);
        if (!lot) return;
        pen.poly(lot.poly, { stroke: color, lw: w });
        (lot.buildings || (lot.building ? [lot.building] : [])).forEach((bd) => pen.poly(bd.fp, { stroke: color, lw: w + 0.5, fill: color, alpha: 0.1 })); // 단지는 모든 동
        const blk = D.blocks.find((b) => b.id === lot.blockId);
        if (blk && target === sel) pen.poly(blk.poly, { stroke: color, lw: 1, dash: [5, 4] });
      } else if (target.type === 'water') {
        const dw = (D.waters || []).find((x) => x.id === target.id), wt = app.water ? app.water(target.id) : null;
        if (dw) pen.poly(dw.poly, { stroke: color, lw: w + 0.5, fill: color, alpha: 0.1 });
        if (wt && wt.ctrl && target === sel) {
          pen.line(wt.kind === 'free' ? wt.ctrl.concat([wt.ctrl[0]]) : wt.ctrl, { stroke: color, lw: 1, dash: [2, 3], salpha: 0.8 });
          if (st.tool === 'move') wt.ctrl.forEach((p) => pen.circle(p, 5.5, { rpx: true, fill: '#fff', stroke: color, lw: 2 }));
        }
      } else if (target.type === 'block') {
        const blk = D.blocks.find((b) => b.id === target.id);
        if (blk) pen.poly(blk.poly, { stroke: color, lw: w, fill: color, alpha: 0.08 });
      } else if (target.type === 'object') {
        const o = P.objects.find((x) => x.id === target.id);
        if (o) pen.circle([o.x, o.y], 12, { rpx: true, stroke: color, lw: 2 });
      } else if (target.type === 'ctx') {
        const b = app.ctxBld(target.id);
        if (b) pen.rings([].concat(...b.parts.map((pt) => [pt.o].concat(pt.h))), { stroke: color, lw: w + 0.3, fill: color, alpha: 0.16 });
      } else if (target.type === 'rab') {
        const rb = (D.rabs || []).find((x) => x.id === target.id);
        if (rb) {
          pen.circle(rb.c, rb.R, { stroke: color, lw: w, fill: color, alpha: 0.1 }); pen.circle(rb.c, rb.R2, { stroke: color, lw: 1, dash: [5, 4] });
          if (target === sel && st.tool === 'move') pen.circle(rb.c, 6.5, { rpx: true, fill: '#fff', stroke: color, lw: 2.2 }); // 끌어 옮기는 손잡이
        }
      } else if (target.type === 'tree') {
        const t = app.treeOf(target.id);
        if (t) { const sp = C.TREES[t.species] || C.TREES.zelkova; pen.circle([t.x, t.y], sp.crown / 2, { stroke: color, lw: w, fill: color, alpha: 0.12 }); pen.circle([t.x, t.y], 3, { rpx: true, fill: color }); }
      } else if (target.type === 'rabcand') { // 회전교차로 도구: 놓일 크기 미리보기(겹쳐서 둘 수 없으면 빨간 점선)
        const W = target.W || 12, d = UDS.Derive.rabAuto(W, W >= 20 ? 2 : 1);
        const bad = target.blocked, col = bad ? COL.erase : color;
        pen.circle(target.p, d / 2, { stroke: col, lw: 1.6, dash: [6, 4], fill: col, alpha: bad ? 0.06 : 0.1 });
      }
    };
    if (st.hover && !picked(st.hover)) hl(st.hover, st.tool === 'erase' ? COL.erase : COL.hover, st.tool === 'erase' ? 2 : 1.2);
    sels.forEach((t) => { if (!sel || t.id !== sel.id) hl(t, COL.sel, 2.2); }); // 함께 고른 요소
    if (sel) hl(sel, COL.sel, 2.2);
    // 건물을 다른 획지로 끄는 중: 놓을 획지와 옮겨 갈 모습
    if (st.bldDrag) {
      const bd = st.bldDrag, lot = D.lots.find((l) => l.id === bd.target), ink = line ? '#000' : COL.sel;
      if (lot) pen.poly(lot.poly, { fill: ink, alpha: 0.12, stroke: ink, lw: 2 });
      pen.poly(bd.fp, { fill: '#fff', alpha: 0.55, stroke: ink, lw: 1.6, dash: [5, 4] });
      const lb = bd.copy ? (bd.same ? '다른 획지를 누르세요' : '여기에 복사') : bd.same ? '이 자리로 옮기기(같은 획지 안)' : '여기로 옮기기';
      if (lot) pen.text(bd.same ? U.polyCentroid(bd.fp) : U.polyCentroid(lot.poly), lb, { size: 12, color: ink, halo: '#fff', weight: 700 });
    }
    // 건물 바로 다루기: 마우스를 댄(또는 끄는) 변과 그 크기, 고른 건물의 돌리기 손잡이
    if ((st.tool === 'select' || st.tool === 'move') && !st.bldDrag) {
      const ink = line ? '#000' : COL.sel, s = this.view.s;
      const op = st.bldOp, hv = st.bldHover;
      const lbl = (b, n) => { const inf = app.bldEdgeInfo(b, n); return inf ? `${inf.isDepth ? '깊이' : '길이'} ${U.fmt(inf.size, 1)}m` : ''; };
      const edgeMark = (a, c, n, txt) => {
        pen.line([a, c], { stroke: '#fff', lw: 6.5, cap: 'round' });
        pen.line([a, c], { stroke: ink, lw: 3.4, cap: 'round' });
        const m = U.mid(a, c), side = U.perpL(n);
        const t1 = U.add(m, U.mul(n, 10 / s)), t2 = U.add(m, U.mul(n, -10 / s));
        const head = (tip, dir) => pen.poly([tip, U.add(U.sub(tip, U.mul(dir, 5 / s)), U.mul(side, 3.6 / s)), U.sub(U.sub(tip, U.mul(dir, 5 / s)), U.mul(side, 3.6 / s))], { fill: ink, stroke: '#fff', lw: 0.8 });
        pen.line([t2, t1], { stroke: '#fff', lw: 3.2 }); pen.line([t2, t1], { stroke: ink, lw: 1.5 });
        head(t1, n); head(t2, U.mul(n, -1));
        if (txt) pen.text(U.add(m, U.mul(n, -30 / s)), txt, { size: 11.5, color: ink, halo: 'rgba(255,255,255,0.96)', weight: 800 }); // 건물 안쪽에(바깥에는 돌리기 손잡이)
      };
      if (op && op.kind === 'edge') {
        const b = D.buildings.find((x) => x.lotId === op.id), e = b && app.bldOpEdge(op, b);
        if (e) edgeMark(e.a, e.c, e.n, lbl(b, e.n));
      } else if (hv && hv.kind === 'edge' && !op) {
        const b = D.buildings.find((x) => x.lotId === hv.id);
        if (b) edgeMark(hv.a, hv.c, hv.n, lbl(b, hv.n));
      }
      const selB0 = sel && sel.type === 'building' && sels.length <= 1 ? D.buildings.find((x) => x.lotId === sel.id) : null, selB = selB0 && !selB0.cx ? selB0 : null; // 단지는 손잡이 없음
      if (selB && !(op && op.kind === 'edge')) {
        let h = app.bldRotHandle(selB);
        const rotating = op && op.kind === 'rot' && op.id === selB.lotId;
        if (rotating) {
          const a = op.ha0 + (op.deg * Math.PI) / 180;
          h = { p: [op.c[0] + Math.cos(a) * op.hR, op.c[1] + Math.sin(a) * op.hR] };
          pen.circle(op.c, op.hR, { stroke: ink, lw: 1, dash: [4, 4] });
          pen.line([op.c, h.p], { stroke: ink, lw: 1.1, dash: [3, 3] });
          const rotNow = +((selB.cfg && selB.cfg.rot) || 0);
          pen.text(U.add(h.p, U.mul(U.norm(U.sub(h.p, op.c)), 22 / s)), op.custom ? `${op.deg > 0 ? '+' : ''}${op.deg}°` : `회전 ${U.fmt(rotNow, 0)}°`, { size: 11.5, color: ink, halo: 'rgba(255,255,255,0.96)', weight: 800 });
        } else if (h) pen.line([h.base, h.p], { stroke: ink, lw: 1.3 });
        if (h) {
          const hot = (hv && hv.kind === 'rot') || rotating;
          pen.circle(h.p, 9.5, { rpx: true, fill: hot ? ink : '#fff', stroke: ink, lw: 2 });
          const gc = hot ? '#fff' : ink, r = 4.4 / s, a0 = 0.3 * Math.PI, a1 = 1.8 * Math.PI, arc = [];
          for (let i = 0; i <= 16; i++) { const t = a0 + ((a1 - a0) * i) / 16; arc.push([h.p[0] + Math.cos(t) * r, h.p[1] + Math.sin(t) * r]); }
          pen.line(arc, { stroke: gc, lw: 1.6 });
          const E = arc[arc.length - 1], tg = [-Math.sin(a1), Math.cos(a1)], nr = [Math.cos(a1), Math.sin(a1)];
          pen.poly([U.add(E, U.mul(tg, 3.2 / s)), U.add(U.sub(E, U.mul(tg, 0.6 / s)), U.mul(nr, 2.6 / s)), U.sub(U.sub(E, U.mul(tg, 0.6 / s)), U.mul(nr, 2.6 / s))], { fill: gc });
        }
      }
    }
    // 건물 직접 그리기 미리보기
    const db = st.drawBld;
    if (st.tool === 'build' && st.buildOpt.scope === 'draw' && db) {
      const ink = line ? '#000' : COL.sel, s = this.view.s;
      const cur = app.drawCursor(db) || db.cursor, pts = db.pts.concat(cur ? [cur] : []);
      if (pts.length >= 3) pen.poly(pts, { fill: ink, alpha: 0.14 });
      if (pts.length >= 2) pen.line(pts, { stroke: ink, lw: 1.8 });
      if (pts.length >= 3) pen.line([pts[pts.length - 1], pts[0]], { stroke: ink, lw: 1.2, dash: [5, 4] });
      const closing = db.kind === 'close' && db.pts.length >= 3 && !st.lenBuf;
      db.pts.forEach((p, i) => pen.circle(p, i === 0 && closing ? 8 : 4, { rpx: true, fill: i === 0 && closing ? ink : '#fff', stroke: ink, lw: 2 }));
      if (cur && db.pts.length) {
        const last = db.pts[db.pts.length - 1], L = U.dist(last, cur);
        if (L > 0.05) pen.text(U.mid(last, cur), `${U.fmt(L, 1)}m`, { size: 11, color: ink, halo: '#fff', weight: 700 });
      }
      if (pts.length >= 3) { const A = Math.abs(U.polyArea(pts)); if (A > 1) pen.text(U.polyCentroid(pts), `${U.fmt(A, 0)}㎡`, { size: 11.5, color: ink, halo: 'rgba(255,255,255,0.9)', weight: 800 }); }
      if (cur && !db.pts.length) pen.circle(cur, 4, { rpx: true, stroke: ink, lw: 1.6 });
      if (db.kind === 'axis' || db.kind === 'square' || db.kind === 'edge' || db.kind === 'vertex') { if (cur && !st.lenBuf) pen.circle(cur, 6, { rpx: true, stroke: COL.snap, lw: 1.8 }); }
      if (st.lenBuf && cur) pen.text(U.add(cur, [0, 16 / s]), `길이 ${st.lenBuf}m`, { size: 12, color: '#fff', halo: ink, weight: 800 });
    }
    // 선택한 가구·획지의 변 길이
    if (sel && (sel.type === 'block' || sel.type === 'lot' || sel.type === 'building')) {
      const poly = sel.type === 'block' ? (D.blocks.find((b) => b.id === sel.id) || {}).poly : (D.lots.find((l) => l.id === sel.id) || {}).poly;
      if (poly) {
        const c = U.polyCentroid(poly);
        // 고른 건물의 돌리기 손잡이와 겹치는 길이 글자는 건너뛴다
        const selB = sel.type === 'building' && (st.tool === 'select' || st.tool === 'move') ? D.buildings.find((x) => x.lotId === sel.id && !x.cx) : null;
        const hp = selB && app.bldRotHandle ? (app.bldRotHandle(selB) || {}).p : null;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          const L = U.dist(a, b);
          if (L * this.view.s < 34) continue;
          const m = U.mid(a, b);
          let n = U.perpR(U.norm(U.sub(b, a)));
          if (U.dot(U.sub(m, c), n) < 0) n = U.mul(n, -1);
          let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
          const tp = U.add(m, U.mul(n, 9 / this.view.s));
          if (hp && U.dist(tp, hp) * this.view.s < 24) continue;
          pen.text(tp, U.fmt(L, 1), { size: 10.5, rot: ang, color: COL.sel, halo: 'rgba(255,255,255,0.92)', weight: 700 });
        }
      }
    }
    // 건물 태양궤적도의 관측점(속성에서 고른 입면)
    if (sel && (sel.type === 'lot' || sel.type === 'building') && st.tab === 'props' && UDS.Ana && UDS.Ana.bldSky && sels.length <= 1) {
      const sky = UDS.Ana.bldSky(app, sel.id, st.spFace || 'S');
      if (sky) {
        const ink = line ? '#000' : '#B5651D';
        if (sky.pt.nrm) pen.line([sky.pt.p, U.add(sky.pt.p, U.mul(sky.pt.nrm, 22 / this.view.s))], { stroke: ink, lw: 1.6 });
        pen.circle(sky.pt.p, 5, { rpx: true, fill: line ? '#fff' : '#F6B93B', stroke: ink, lw: 1.6 });
      }
    }
    // 단면 위치선 A–A′
    const sr = app.secRoad && app.secRoad();
    if (sr) {
      const info = D.roadInfo.get(sr.id);
      if (info) {
        const sPos = st.secS === null || st.secS === undefined ? info.len / 2 : U.clamp(st.secS, 0, info.len);
        const q = U.pointAlong(sr.pts, sPos);
        const n = U.perpL(q.dir);
        const half = info.lay.W / 2 + Math.max(5, 16 / this.view.s);
        const pa = U.add(q.p, U.mul(n, half)), pb = U.add(q.p, U.mul(n, -half));
        const ink = line ? '#000' : COL.cut;
        pen.line([pa, pb], { stroke: '#fff', lw: 3.4 });
        pen.line([pa, pb], { stroke: ink, lw: 1.3, dash: [9, 3, 2, 3] });
        // 보는 방향(단면 표시의 화살표): 기본은 도로가 나아가는 쪽, 바꾸면 반대쪽
        const vd = st.secFlip ? U.mul(q.dir, -1) : q.dir, s2 = this.view.s, hot = st.secHot;
        [pa, pb].forEach((p) => {
          const tip = U.add(p, U.mul(vd, 17 / s2)), side = U.perpL(vd);
          pen.poly([tip, U.add(U.sub(tip, U.mul(vd, 7 / s2)), U.mul(side, 4.5 / s2)), U.sub(U.sub(tip, U.mul(vd, 7 / s2)), U.mul(side, 4.5 / s2))], { fill: ink });
          pen.line([p, U.sub(tip, U.mul(vd, 5 / s2))], { stroke: ink, lw: 1.4 });
        });
        (st.secFlip ? [[pb, 'A'], [pa, 'A′']] : [[pa, 'A'], [pb, 'A′']]).forEach(([p, t]) => {
          pen.circle(p, hot ? 9.5 : 8, { rpx: true, fill: hot ? ink : '#fff', stroke: ink, lw: 1.3 });
          pen.text(p, t, { size: 9.5, color: hot ? '#fff' : ink, weight: 800 });
        });
      }
    }
    // 태양 궤적도
    if (st.ana && st.ana.sunpath) this.drawSunPath(pen, line);
    // 막다른 도로 표시
    D.deadEnds.forEach((d) => pen.circle(d.p, 7, { rpx: true, stroke: COL.erase, lw: 2 }));
    // 회전교차로 도구: 둘 수 있는 교차점
    if (st.tool === 'rabout') (D.rabCand || []).forEach((c) => {
      if (c.blocked) { pen.circle(c.p, 7, { rpx: true, stroke: line ? '#777' : '#A49D95', lw: 1.5, dash: [3, 3] }); return; } // 이웃 회전교차로와 겹쳐 둘 수 없는 곳
      pen.circle(c.p, 9, { rpx: true, fill: '#fff', alpha: 0.85, stroke: line ? '#000' : COL.sel, lw: 2 }); pen.circle(c.p, 3, { rpx: true, fill: line ? '#000' : COL.sel });
    });
    // 수공간 그리기 미리보기(자유형 연못·하천): 찍은 점과 마우스 자리를 지나는 곡선
    const dwt = st.drawWater;
    if (st.tool === 'water' && dwt && (dwt.pts.length || dwt.cursor)) {
      const pts = dwt.pts.concat(dwt.cursor ? [dwt.cursor] : []);
      const M2 = UDS.Model;
      if (dwt.kind === 'free' && pts.length >= 3) { const g = M2.waterShape({ kind: 'free', ctrl: pts }); if (g) pen.poly(g.poly, { fill: COL.water, alpha: 0.45, stroke: COL.sel, lw: 1.2, dash: [4, 3] }); }
      else if (dwt.kind === 'river' && pts.length >= 2) { const g = M2.waterShape({ kind: 'river', ctrl: pts, w: 12 }); if (g) pen.poly(g.poly, { fill: COL.water, alpha: 0.45, stroke: COL.sel, lw: 1.2, dash: [4, 3] }); }
      if (pts.length >= 2) pen.line(dwt.kind === 'free' && pts.length >= 3 ? pts.concat([pts[0]]) : pts, { stroke: COL.sel, lw: 1, dash: [2, 3] });
      dwt.pts.forEach((p) => pen.circle(p, 4, { rpx: true, fill: '#fff', stroke: COL.sel, lw: 2 }));
    }
    // 도로 그리기 미리보기
    const dr = st.drawRoad;
    if (st.tool === 'road' && dr && dr.pts.length) {
      const preset = C.PRESETS[st.roadPreset];
      const W = preset.segs.reduce((s, g) => s + g.w, 0);
      const cur = app.drawCursor(dr) || dr.cursor;
      const pts = dr.pts.concat(cur ? [cur] : []);
      if (pts.length >= 2) {
        // 단지 안 길: 고른 모양(모서리 둥글게·곡선)으로 미리 보이고, 찍은 점을 잇는 선은 가늘게
        const shp = preset.inner ? st.innerShape[st.roadPreset] || preset.shape : 'line';
        const cl = shp !== 'line' && pts.length >= 3 ? UDS.Model.shapePts({ ctrl: pts, shape: shp, cornerR: preset.cornerR }) : pts;
        const L = U.offsetPolyline(cl, W / 2), Rr = U.offsetPolyline(cl, -W / 2);
        pen.poly(L.concat(Rr.slice().reverse()), { fill: COL.sel, alpha: 0.15, stroke: COL.sel, lw: 1, dash: [4, 3] });
        if (cl !== pts) pen.line(pts, { stroke: COL.sel, lw: 1, dash: [2, 3] });
        pen.line(cl, { stroke: COL.sel, lw: 1.5 });
        const last = pts[pts.length - 1], prev = pts[pts.length - 2];
        pen.text(U.mid(last, prev), `${U.fmt(U.dist(last, prev), 1)}m`, { size: 11, color: COL.sel, halo: '#fff', weight: 700 });
      }
      dr.pts.forEach((p) => pen.circle(p, 4, { rpx: true, fill: '#fff', stroke: COL.sel, lw: 2 }));
      if (st.lenBuf && cur) pen.text(U.add(cur, [0, 18 / this.view.s]), `길이 ${st.lenBuf}m`, { size: 12, color: '#fff', halo: line ? '#000' : COL.sel, weight: 800 });
      // 대상지 밖까지 그리면 넓어질 대상지를 점선으로 미리 보인다
      let x0 = 0, y0 = 0, x1 = P.site.w, y1 = P.site.h;
      pts.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
      if (x0 < -0.5 || y0 < -0.5 || x1 > P.site.w + 0.5 || y1 > P.site.h + 0.5) {
        x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
        pen.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { stroke: line ? '#000' : COL.sel, lw: 1.5, dash: [8, 5] });
        pen.text([(x0 + x1) / 2, y1 + 12 / this.view.s], `대상지 ${U.fmt(x1 - x0, 0)} × ${U.fmt(y1 - y0, 0)}m로 넓어짐`, { size: 11, color: line ? '#000' : COL.sel, halo: '#fff', weight: 700 });
      }
    }
    if (st.snap) pen.circle(st.snap, 7, { rpx: true, stroke: COL.snap, lw: 2 });
  };

  /* 화면 축척: 1:N(N은 고쳐 칠 수 있음)과 축척 막대. 글자 칸이라 HTML로 그린다 */
  R.scaleDenom = function (s) { return Math.round(1000 / ((s || this.view.s) * 0.2646) / 10) * 10; };
  R.drawHud = function (line) {
    const ctx = this.ctx;
    const s = this.view.s;
    const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500];
    let m = nice[0];
    for (const n of nice) if (n * s < 110) m = n;
    const ink = line ? '#000' : TH.ink;
    const el = this._scl || (this._scl = { box: document.getElementById('scl2'), inp: document.getElementById('sclIn'), bar: document.getElementById('sclBar'), m: document.getElementById('sclM') });
    if (el.box) {
      el.box.classList.toggle('ln', !!line);
      const w = `${Math.round(m * s)}px`; if (el.bar.style.width !== w) el.bar.style.width = w;
      const mt = `${m}m`; if (el.m.textContent !== mt) el.m.textContent = mt;
      const dv = this.scaleDenom(s).toLocaleString('ko-KR');
      if (document.activeElement !== el.inp && el.inp.value !== dv) el.inp.value = dv;
    }
    // 방위표
    const nx = this.W - 24, ny = 66;
    ctx.beginPath(); ctx.arc(nx, ny, 13, 0, Math.PI * 2); ctx.fillStyle = line ? '#fff' : 'rgba(255,255,255,0.86)'; ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nx, ny - 10); ctx.lineTo(nx + 5, ny + 6); ctx.lineTo(nx, ny + 2.5); ctx.lineTo(nx - 5, ny + 6); ctx.closePath();
    ctx.fillStyle = ink; ctx.fill();
    ctx.font = `700 9.5px ${UDS.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('N', nx, ny - 14);
  };

  /* ---------- 장면 그리기(캔버스·SVG 공용) ---------- */
  function drawScene(pen, P, D, o) {
    const line = o.line, s = o.s, layers = o.layers || {};
    const site = [[0, 0], [P.site.w, 0], [P.site.w, P.site.h], [0, P.site.h]];
    pen.layer('SITE', '대상지');
    pen.poly(site, { fill: line ? '#fff' : COL.site, stroke: line ? '#000' : COL.siteEdge, lw: 1, dash: [8, 5] });

    // 획지
    pen.layer('LOT', '획지');
    D.lots.forEach((l) => {
      const u = C.USES[l.use] || C.USES.res;
      const fill = line ? '#fff' : U.shade(u.color, u.open ? 0.15 : 0.66);
      pen.poly(l.poly, { fill, stroke: line ? '#9b9b9b' : COL.lotEdge, lw: 0.6 });
    });
    // 공원 내부
    pen.layer('PARK', '공원 시설');
    D.parkFeat.forEach((f) => {
      if (f.type === 'lawn') pen.poly(f.poly, { fill: line ? '#fff' : COL.lawn, stroke: line ? '#777' : null, lw: 0.6, dash: line ? [2, 2] : null });
      else if (f.type === 'play') pen.poly(f.poly, { fill: line ? '#fff' : COL.play, stroke: line ? '#333' : '#E3A26B', lw: 0.8 });
      else if (f.type === 'plaza') pen.poly(f.poly, { fill: line ? '#fff' : COL.plaza, stroke: null, hatch: line ? 'light' : null });
      else if (f.type === 'path') {
        pen.line(f.pts, { stroke: line ? '#555' : '#DDD5C7', lwW: f.w + 0.4, cap: 'round', join: 'round' });
        pen.line(f.pts, { stroke: line ? '#fff' : COL.path, lwW: f.w, cap: 'round', join: 'round' });
      } else if (f.type === 'stall') pen.line(f.pts, { stroke: line ? '#555' : '#fafafa', lw: 0.8 });
      else if (f.type === 'vacant') pen.poly(f.poly, { stroke: line ? '#888' : COL.blockEdge, lw: 0.6, dash: [2, 3] });
    });
    // 가구 외곽
    pen.layer('BLOCK', '가구');
    D.blocks.forEach((b) => pen.poly(b.poly, { stroke: line ? '#111' : COL.blockEdge, lw: line ? 1.3 : 1 }));
    // 수공간: 연못은 물가 선까지, 하천은 양쪽 둑만 선으로(대상지 경계에서 잘린 끝은 긋지 않음)
    if ((D.waters || []).length) {
      pen.layer('WATER', '수공간');
      // 천변공원: 둑 바깥 녹지와 물가 산책로(물보다 먼저)
      D.waters.forEach((w) => {
        (w.parkStrips || []).forEach((q) => pen.poly(q, { fill: line ? '#fff' : COL.lawn, stroke: line ? '#777' : '#A9CDB9', lw: 0.6, dash: line ? [2, 2] : null }));
        (w.parkPaths || []).forEach((l) => { pen.line(l, { stroke: line ? '#555' : '#DDD5C7', lwW: w.parkPathW + 0.4, cap: 'round', join: 'round' }); pen.line(l, { stroke: line ? '#fff' : COL.path, lwW: w.parkPathW, cap: 'round', join: 'round' }); });
      });
      D.waters.forEach((w) => {
        const river = w.kind === 'river';
        pen.poly(w.poly, { fill: line ? '#fff' : COL.water, stroke: river ? null : line ? '#000' : COL.waterEdge, lw: line ? 1.1 : 1.2, hatch: line ? 'light' : null });
        if (river) w.banks.forEach((bk) => pen.line(bk, { stroke: line ? '#000' : COL.waterEdge, lw: line ? 1.1 : 1.4 }));
        if (!line && s > 1.2) { // 잔물결 몇 줄
          const n = U.clamp(Math.round(w.area / 260), 1, 14), rnd = U.rng(U.hashStr(w.id));
          for (let i = 0; i < n * 4 && i < 60; i++) {
            const p = [w.x0 + rnd() * (w.x1 - w.x0), w.y0 + rnd() * (w.y1 - w.y0)], L = 1.6 + rnd() * 1.6;
            if (!U.pointInPoly(p, w.poly) || !U.pointInPoly([p[0] + L, p[1]], w.poly)) continue;
            pen.line([[p[0], p[1]], [p[0] + L / 2, p[1] + 0.25], [p[0] + L, p[1]]], { stroke: '#fff', lw: 0.9, salpha: 0.7 });
          }
        }
      });
    }
    // 실제 지역: 지적(필지 경계와 지목별 바탕)
    const cx = o.app && o.app.ctxData ? o.app.ctxData() : null, X = UDS.Ctx;
    if (cx && cx.par.length && layers.parcels !== false) {
      pen.layer('PARCEL', '지적');
      if (!line) cx.par.forEach((q) => { const f = X.PAR_FILL[X.jimokCls(q.jm)]; if (f) q.parts.forEach((pt) => pen.rings([pt.o].concat(pt.h), { fill: f })); });
      const pst = line ? { stroke: '#a8a8a8', lw: 0.45 } : { stroke: '#A39B90', lw: 0.5, salpha: 0.85 };
      cx.par.forEach((q) => q.parts.forEach((pt) => { pen.poly(pt.o, pst); pt.h.forEach((h) => pen.poly(h, pst)); }));
    }

    // 회전교차로 둘레 보도(팔의 보도 끝이 이 위로 이어진다)
    pen.layer('ROAD-SIDE', '도로 - 보도·녹지·자전거');
    const circ = (c, r) => UDS.Derive.circle(c, r, 0.8);
    (D.rabs || []).forEach((rb) => pen.rings([circ(rb.c, rb.R2), circ(rb.c, rb.R)], { fill: line ? '#fff' : C.SEG.sidewalk.color, stroke: line ? '#8a8a8a' : null, lw: 0.5 }));
    // 도로: 비차도 구간
    D.arms.forEach((a) => a.geo.bands.forEach((bp) => {
      const def = bp.band.def;
      if (def.carriage) return;
      let fill = def.color, stroke = def.edge || null, hatch = null; // 오솔길은 가장자리 선(마사토 경계)
      if (line) { fill = '#fff'; stroke = '#8a8a8a'; if (def.green) hatch = 'light'; }
      pen.poly(bp.poly, { fill, stroke, lw: 0.5, hatch });
    }));
    // 차도 구간 + 모서리
    pen.layer('ROAD-CARRIAGE', '도로 - 차도');
    D.arms.forEach((a) => a.geo.bands.forEach((bp) => {
      const def = bp.band.def;
      if (!def.carriage) return;
      pen.poly(bp.poly, { fill: line ? '#fff' : def.color });
    }));
    D.fillets.forEach((f) => pen.poly(f.poly, { fill: line ? '#fff' : f.inner ? C.SEG.estate.color : COL.asphalt })); // 단지 안 길 어귀는 그 길의 포장색
    // 회전교차로: 진입부 곡선·목·회전차로, 화물차 턱, 중앙섬, 분리섬
    (D.rabs || []).forEach((rb) => {
      const asp = line ? '#fff' : COL.asphalt;
      rb.fillets.forEach((f) => pen.poly(f.poly, { fill: asp }));
      rb.throats.forEach((q) => pen.poly(q, { fill: asp }));
      pen.poly(circ(rb.c, rb.R), { fill: asp });
      pen.poly(circ(rb.c, rb.Ri), { fill: line ? '#fff' : '#C9BDAA', stroke: line ? '#555' : '#B4A894', lw: 0.6, hatch: line ? 'light' : null });
      pen.poly(circ(rb.c, rb.Ra), { fill: line ? '#fff' : COL.lawn, hatch: line ? 'light' : null });
    });
    // 노면 표시
    if (s > 0.7) {
      pen.layer('ROAD-MARKING', '도로 - 노면 표시');
      D.arms.forEach((a) => {
        const g = a.geo;
        g.marks.forEach((m) => {
          if (m.kind === 'center') pen.line(m.pts, { stroke: line ? '#333' : COL.yellow, lwW: line ? undefined : 0.15, lw: 0.6 });
          else if (m.kind === 'dash') pen.line(m.pts, { stroke: line ? '#444' : COL.white, lwW: line ? undefined : 0.15, lw: 0.6, dash: [3, 5], dashW: true });
          else if (m.kind === 'bus') pen.line(m.pts, { stroke: line ? '#333' : COL.blue, lwW: line ? undefined : 0.2, lw: 0.8 });
          else pen.line(m.pts, { stroke: line ? '#444' : COL.white, lwW: line ? undefined : 0.15, lw: 0.6 });
        });
        g.stops.forEach((sl) => pen.line(sl, { stroke: line ? '#333' : COL.white, lwW: line ? undefined : 0.4, lw: 1 }));
        g.stalls.forEach((sl) => pen.line(sl, { stroke: line ? '#555' : COL.white, lwW: line ? undefined : 0.12, lw: 0.6 }));
        g.cross.forEach((c) => c.stripes.forEach((q) => pen.poly(q, { fill: line ? '#fff' : COL.white, stroke: line ? '#333' : null, lw: 0.5 })));
        g.yields.forEach((yl) => pen.line(yl, { stroke: line ? '#333' : COL.white, lwW: line ? undefined : 0.3, lw: 0.9, dash: [0.6, 0.45], dashW: true }));
      });
      // 2차로형 회전차로의 차선
      (D.rabs || []).forEach((rb) => { if (rb.lanes === 2) pen.poly(circ(rb.c, (rb.R + rb.Ri) / 2), { stroke: line ? '#444' : COL.white, lwW: line ? undefined : 0.15, lw: 0.6, dash: [3, 4], dashW: true }); });
    }
    // 연석
    pen.layer('ROAD-CURB', '도로 - 연석·분리대');
    D.arms.forEach((a) => a.geo.curbs.forEach((c) => {
      if (c.length < 2) return;
      pen.line(c, { stroke: line ? '#111' : COL.curb, lwW: line ? undefined : 0.3, lw: 1.1 });
    }));
    D.fillets.forEach((f) => pen.line(f.arc, { stroke: line ? '#111' : COL.curb, lwW: line ? undefined : 0.3, lw: 1.1 }));
    (D.rabs || []).forEach((rb) => {
      const cst = { stroke: line ? '#111' : COL.curb, lwW: line ? undefined : 0.3, lw: 1.1 };
      rb.fillets.forEach((f) => pen.line(f.arc, cst));
      rb.curbArcs.forEach((a) => pen.line(a, cst));
      pen.poly(circ(rb.c, rb.Ra), { stroke: line ? '#111' : COL.curb, lwW: line ? undefined : 0.35, lw: 1.2 });
    });
    D.arms.forEach((a) => a.geo.splits.forEach((q) => pen.poly(q, { fill: line ? '#fff' : C.SEG.median.color, stroke: line ? '#111' : COL.curb, lwW: line ? undefined : 0.25, lw: 1 })));
    // 다리: 물 위를 지나는 구간의 난간(바깥에 한 줄 더 그어 다리 가장자리를 보인다)
    if ((D.bridges || []).length) {
      pen.layer('BRIDGE', '다리');
      D.bridges.forEach((g) => g.rails.forEach((l) => pen.line(l, { stroke: line ? '#000' : COL.rail, lwW: line ? undefined : g.inner ? 0.22 : 0.35, lw: line ? 1.6 : 1.4 })));
    }

    // 지하시설
    if (layers.utilities) {
      pen.layer('UTILITY', '지하시설');
      D.utils.forEach((u) => {
        const def = C.UTIL[u.type];
        pen.line(u.pts, { stroke: def.color, lwW: Math.max(0.35, u.dia * 0.8), dash: u.type === 'tunnel' ? null : [2.5, 1.5], dashW: true, salpha: 0.9 });
        u.mh.forEach((p) => pen.circle(p, 0.6, { fill: '#fff', stroke: def.color, lw: 1 }));
      });
    }

    // 조도분석 지도(일조시간·가로등 조도): 건물 바닥은 비워 두고 땅 위에만 얹는다(캔버스에서만)
    if (o.anaLayer) { pen.layer(null); o.anaLayer(); }
    // 그림자: 건물과 수목. 한 번에 채워 겹친 곳이 얼룩지지 않게 함
    const sky = o.sky || UDS.sky(P.settings);
    if (!line && layers.shadows && sky.shadows) {
      pen.layer('SHADOW', '그림자');
      const sun = sky.sun;
      const k = Math.min(7, 1 / Math.tan(sun.alt));
      const sx = -Math.sin(sun.az) * k, sy = -Math.cos(sun.az) * k;
      const polys = [];
      if (layers.buildings) D.buildings.forEach((b) => {
        const top = b.fp.map((p) => [p[0] + sx * b.h, p[1] + sy * b.h]);
        polys.push(convexHull(b.fp.concat(top))); // 바닥과 투영 꼭짓점의 볼록껍질로 근사
      });
      if (cx && layers.ctx !== false && D.ctxV) cx.bld.forEach((b) => {
        if (!X.shown(D.ctxV, b.id)) return;
        b.parts.forEach((pt) => { polys.push(convexHull(pt.o.concat(pt.o.map((p) => [p[0] + sx * b.h, p[1] + sy * b.h])))); });
      });
      if (layers.trees) D.trees.forEach((t) => {
        const sp = C.TREES[t.species] || C.TREES.zelkova, r = (sp.crown / 2) * 0.92;
        const pts = [];
        [sp.clear + 0.6, sp.height * 0.92].forEach((hh) => { for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; pts.push([t.x + sx * hh + Math.cos(a) * r, t.y + sy * hh + Math.sin(a) * r]); } });
        polys.push(convexHull(pts));
      });
      pen.multi(polys, { fill: COL.shadow, alpha: 0.3 * sky.day });
    }
    // 실제 지역: 현황 건물(지운 것은 빼고, 새 계획으로 철거되는 것은 점선 윤곽만)
    if (cx && layers.ctx !== false && D.ctxV) {
      pen.layer('EXISTING', '현황 건물');
      const mode = (o.app.state && o.app.state.ctxMode) || 'gray';
      const fac = mode === 'fac' && o.app.ctxFac ? o.app.ctxFac() : null;
      cx.bld.forEach((b) => {
        if (D.ctxV.off.has(b.id)) return;
        const rings = [].concat(...b.parts.map((pt) => [pt.o].concat(pt.h)));
        if (D.ctxV.demo.has(b.id)) { pen.rings(rings, { stroke: line ? '#777' : '#8F887E', lw: 0.7, dash: [3, 2.5] }); return; }
        if (line) { pen.rings(rings, { fill: '#ececec', stroke: '#4a4a4a', lw: 0.75 }); return; }
        const col = mode === 'gray' ? X.GRAY.fill : X.classOf(b, mode)[2];
        pen.rings(rings, { fill: col, stroke: mode === 'gray' ? X.GRAY.edge : U.shade(col, -0.35), lw: 0.75 });
        // 입면: 경사지붕의 용마루(모임지붕은 추녀마루까지)
        const f = fac && fac.get(b.id), Pt = f && f.pitch;
        if (Pt) {
          const v = (i) => Pt.R[((i % 4) + 4) % 4], R1 = U.mid(v(Pt.i0), v(Pt.i0 + 1)), R2 = U.mid(v(Pt.i0 + 2), v(Pt.i0 + 3)), u = U.norm(U.sub(R2, R1)), sc = U.shade(col, -0.38);
          if (Pt.kind === 'hip') {
            const k = Math.min(Pt.halfD, U.dist(R1, R2) / 2), A1 = U.add(R1, U.mul(u, k)), A2 = U.sub(R2, U.mul(u, k));
            pen.line([A1, A2], { stroke: sc, lw: 0.7 });
            [[v(Pt.i0), A1], [v(Pt.i0 + 1), A1], [v(Pt.i0 + 2), A2], [v(Pt.i0 + 3), A2]].forEach((sg) => pen.line(sg, { stroke: sc, lw: 0.5 }));
          } else pen.line([R1, R2], { stroke: sc, lw: 0.7 });
        }
      });
    }
    // 건물
    if (layers.buildings) {
      pen.layer('BUILDING', '건물');
      D.buildings.forEach((b) => {
        const u = C.USES[b.use] || C.USES.res;
        if (line) pen.poly(b.fp, { fill: '#fff', hatch: 'dark', stroke: '#000', lw: 1.6 });
        else {
          const roof = b.st.roof === 'green' ? '#A9D5C2' : u.color;
          pen.poly(b.fp, { fill: roof, stroke: U.shade(u.color, -0.42), lw: 1 });
        }
        if (b.gable) pen.line([b.gable.R1, b.gable.R2], { stroke: line ? '#000' : U.shade(u.color, -0.42), lw: 0.8 });
      });
    }
    // 수목
    if (layers.trees) {
      pen.layer('TREE', '수목');
      D.trees.forEach((t) => {
        const sp = C.TREES[t.species] || C.TREES.zelkova;
        const r = sp.crown / 2;
        if (line) { pen.circle([t.x, t.y], r, { fill: '#fff', alpha: 0.6, stroke: '#222', lw: 0.7 }); pen.circle([t.x, t.y], 0.25, { fill: '#222' }); }
        else { pen.circle([t.x, t.y], r, { fill: sp.color, alpha: 0.78, stroke: U.shade(sp.color, -0.3), lw: 0.8 }); }
      });
    }
    // 시설물
    if (layers.furniture) {
      pen.layer('STREETLIGHT', '가로등');
      if (s > 0.9) D.lights.forEach((l) => pen.circle([l.x, l.y], 2.2, { rpx: true, fill: line ? '#fff' : COL.lamp, stroke: line ? '#000' : '#A8894A', lw: 0.7 }));
      pen.layer('POLE', '전주·가공선');
      D.wires.forEach((w) => pen.line(w, { stroke: line ? '#000' : COL.wire, lw: 0.6, dash: [5, 3] }));
      D.poles.forEach((p) => pen.circle([p.x, p.y], 0.35, { fill: line ? '#000' : COL.pole, stroke: null }));
      pen.layer('FURNITURE', '가로시설물');
      D.furniture.forEach((f) => drawFurniture(pen, f, line, s, layers.labels === false));
    }
    pen.layer(null);
    if (!o.noLabels) drawLabels(pen, P, D, o);
  }

  /* 도로·가구 이름(밤 화면에서도 읽히도록 장면과 따로 그림) */
  function drawLabels(pen, P, D, o) {
    const line = o.line, s = o.s, layers = o.layers || {}, dark = !!o.dark;
    if (layers.labels && s > 0.8) {
      pen.layer('LABEL', '이름');
      P.roads.forEach((r) => {
        const info = D.roadInfo.get(r.id);
        if (!info || info.len < 30) return;
        if (s < 1.25 && info.lay.W < 12) return;
        const wTxt = `${U.fmt(info.lay.W, 1).replace(/\.0$/, '')}m`;
        const label = s < 1.25 ? r.name : s < 1.9 || r.inner ? `${r.name} ${wTxt}` : `${r.name} · ${info.cls} ${wTxt}`; // 단지 안 길은 도시계획시설 규모(소로 등)가 아니므로 폭만
        if (label.length * 6.2 > info.len * s * 0.9) return;
        // 단면 위치선(A–A′)이 지나는 자리는 비켜서 적는다
        let at = info.len * 0.5;
        if (o.sec && o.sec.id === r.id) {
          const lw = (label.length * 6.2) / s, gap = lw / 2 + 16 / s;
          const sp = o.sec.s === null || o.sec.s === undefined ? info.len / 2 : U.clamp(o.sec.s, 0, info.len);
          if (Math.abs(sp - at) < gap) {
            if (sp + gap + lw / 2 < info.len - 4) at = sp + gap;
            else if (sp - gap - lw / 2 > 4) at = sp - gap;
          }
        }
        // 회전교차로 원 안에 걸리면 원 밖의 가까운 자리로 옮긴다
        const rbs = D.rabs || [];
        if (rbs.length) {
          const lw = (label.length * 6.2) / s;
          const clear = (t) => { const p0 = U.pointAlong(r.pts, t).p; return rbs.every((rb) => U.dist(p0, rb.c) > rb.R2 + lw / 2 + 2); };
          if (!clear(at)) {
            let best = null;
            for (let k = 1; k <= 40 && best === null; k++) [at + k * 6, at - k * 6].forEach((t) => { if (best === null && t > lw / 2 + 2 && t < info.len - lw / 2 - 2 && clear(t)) best = t; });
            if (best === null) return;
            at = best;
          }
        }
        const q = U.pointAlong(r.pts, at);
        let ang = Math.atan2(q.dir[1], q.dir[0]);
        if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
        pen.text(q.p, label, { size: 10, rot: ang, color: line ? '#000' : dark ? '#f7f4f0' : TH.ink, halo: line ? '#fff' : dark ? 'rgba(8,12,30,0.8)' : 'rgba(255,255,255,0.88)', weight: 500 });
      });
      // 하천: 폭·깊이(지면에서 수면까지)를 물길을 따라 적는다(대상지 안쪽 자리를 고름)
      (D.waters || []).forEach((w) => {
        if (w.kind !== 'river' || !w.center || w.center.length < 2) return;
        const L = U.polylineLength(w.center), txt = `하천 · 폭 ${U.fmt(w.hw * 2, 1).replace(/\.0$/, '')}m · 깊이 ${U.fmt(w.depth, 1).replace(/\.0$/, '')}m${w.park ? ` · 천변공원 ${U.fmt(w.park, 0)}m` : ''}`;
        if (txt.length * 6.2 > L * s * 0.8) return;
        let at = null;
        for (let k = 0; k <= 10 && at === null; k++) for (const f of [0.5 + k * 0.04, 0.5 - k * 0.04]) { const q = U.pointAlong(w.center, L * f).p; if (q[0] > 4 && q[1] > 4 && q[0] < P.site.w - 4 && q[1] < P.site.h - 4) { at = L * f; break; } }
        if (at === null) at = L / 2;
        const q = U.pointAlong(w.center, at);
        let ang = Math.atan2(q.dir[1], q.dir[0]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
        pen.text(q.p, txt, { size: 10, rot: ang, color: line ? '#000' : dark ? '#e8f2f8' : '#2F6E8E', halo: line ? '#fff' : dark ? 'rgba(8,12,30,0.8)' : 'rgba(255,255,255,0.85)', weight: 700 });
      });
      // 용도 이름: 획지의 실제 용도를 따른다(획지 용도를 바꾸면 이름도 바뀜). 가구 안에서 가장 넓은 용도는 한 번, 다른 용도의 획지는 그 획지에
      if (s > 1.4) useLabels(D).forEach((t) => {
        if (t.minor && t.w * s < 34) return; // 작은 획지는 넉넉히 확대했을 때만
        pen.text(t.p, t.name, { size: t.minor ? 9.5 : 10, color: line ? '#000' : dark ? 'rgba(245,245,250,0.9)' : 'rgba(28,28,30,0.72)', halo: line ? '#fff' : dark ? 'rgba(8,12,30,0.7)' : 'rgba(255,255,255,0.7)', weight: 700 });
      });
    }
  }

  /* 용도 이름표 자리(한 번 계산해 D에 둔다): 가구마다 획지 용도별 면적을 모아 가장 넓은 용도는 가구 한가운데(그 용도의 획지 안)에,
     나머지 용도의 획지는 획지마다. w는 이름을 적을 만한 폭(m) */
  function useLabels(D) {
    if (D._useLabels) return D._useLabels;
    const out = [], by = new Map();
    D.lots.forEach((l) => { if (!by.has(l.blockId)) by.set(l.blockId, []); by.get(l.blockId).push(l); });
    D.blocks.forEach((b) => {
      const lots = by.get(b.id) || [];
      if (!lots.length) return;
      const area = {};
      lots.forEach((l) => { area[l.use] = (area[l.use] || 0) + l.area; });
      const major = Object.keys(area).sort((x, y) => area[y] - area[x])[0];
      const nm = (u) => (C.USES[u] ? C.USES[u].name : '');
      const c = U.interiorPoint(b.poly);
      const inMajor = lots.some((l) => l.use === major && U.pointInPoly(c, l.poly));
      const big = lots.filter((l) => l.use === major).sort((x, y) => y.area - x.area)[0];
      out.push({ p: inMajor ? c : U.interiorPoint(big.poly), name: nm(major), w: 999 });
      lots.forEach((l) => {
        if (l.use === major) return;
        const mr = U.minRect(l.poly);
        out.push({ p: U.interiorPoint(l.poly), name: nm(l.use), minor: true, w: mr ? Math.min(mr.a, mr.b) * 1.6 : 0 });
      });
    });
    D._useLabels = out;
    return out;
  }

  function drawFurniture(pen, f, line, s, noText) {
    const ink = line ? '#000' : '#3f3f3f';
    const c = Math.cos(f.rot || 0), sn = Math.sin(f.rot || 0);
    const rect = (w, h, dx = 0, dy = 0) => {
      const pts = [[-w / 2 + dx, -h / 2 + dy], [w / 2 + dx, -h / 2 + dy], [w / 2 + dx, h / 2 + dy], [-w / 2 + dx, h / 2 + dy]];
      return pts.map((p) => [f.x + p[0] * c - p[1] * sn, f.y + p[0] * sn + p[1] * c]);
    };
    switch (f.type) {
      case 'bench': pen.poly(rect(1.8, 0.6), { fill: line ? '#fff' : '#a2845e', stroke: ink, lw: 0.6 }); break;
      case 'busstop':
        pen.poly(rect(4.2, 1.6), { fill: line ? '#fff' : '#DCE9E5', alpha: 0.9, stroke: ink, lw: 0.9 });
        pen.line(rect(4.2, 0.1, 0, 0.75).slice(0, 2), { stroke: ink, lw: 1.2 });
        if (s > 1.2 && !noText) pen.text([f.x, f.y], 'BUS', { size: 8, color: line ? '#000' : TH.tealInk, weight: 800 });
        break;
      case 'bollard': pen.circle([f.x, f.y], 0.15, { fill: ink }); break;
      case 'bikerack': [-0.6, 0, 0.6].forEach((d) => pen.line(rect(0.06, 0.9, d, 0).slice(1, 3), { stroke: ink, lw: 1 })); pen.poly(rect(2.0, 1.8), { stroke: ink, lw: 0.4, dash: [2, 2] }); break;
      case 'pm': pen.poly(rect(4.0, 2.0), { fill: line ? '#fff' : '#9AD3C5', alpha: 0.55, stroke: line ? '#000' : TH.tealDeep, lw: 0.8, dash: [3, 2] }); if (s > 1.4 && !noText) pen.text([f.x, f.y], 'PM', { size: 8, color: line ? '#000' : '#1a6b46', weight: 800 }); break;
      case 'smartpole': pen.circle([f.x, f.y], 0.3, { fill: line ? '#fff' : TH.teal, stroke: ink, lw: 0.8 }); break;
      case 'transformer': pen.poly(rect(1.2, 0.7), { fill: line ? '#fff' : '#9aa69a', stroke: ink, lw: 0.8 }); break;
      case 'hydrant': pen.circle([f.x, f.y], 0.25, { fill: line ? '#fff' : TH.coral, stroke: ink, lw: 0.8 }); break;
      case 'light': pen.circle([f.x, f.y], 2.6, { rpx: true, fill: line ? '#fff' : COL.lamp, stroke: ink, lw: 0.8 }); break;
      case 'shrub': pen.circle([f.x, f.y], f.r || 1.6, { fill: line ? '#fff' : '#9CCBB4', alpha: 0.85, stroke: line ? '#222' : '#5E9C86', lw: 0.6, dash: line ? [1.5, 1.5] : null }); break;
      default: pen.circle([f.x, f.y], 0.4, { fill: ink });
    }
  }

  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }
  UDS.convexHull = convexHull;

  /* ---------- 선택 판정 ---------- */
  R.hitTest = function (q) {
    const app = this.app, P = app.P, D = app.D;
    if (!D) return null;
    const p = this.s2w(q);
    const tolM = 8 / this.view.s;
    let best = null, bd = Infinity;
    P.objects.forEach((o) => { const d = U.dist(p, [o.x, o.y]); if (d < Math.max(tolM, 1.5) && d < bd) { bd = d; best = { type: 'object', id: o.id }; } });
    if (best) return best;
    // 이동 도구에서는 회전교차로(교차점)를 먼저 잡는다(중앙섬 나무보다)
    if (app.state.tool === 'move') for (const rb of D.rabs || []) if (U.dist(p, rb.c) <= rb.R) return { type: 'rab', id: rb.id };
    // 만들어진 수목(가로수·공원·회전교차로): 줄기 가까이를 누르면 그 나무
    if (app.state.layers.trees !== false) {
      const rT = Math.max(tolM * 0.9, 1.1);
      D.trees.forEach((t) => { if (t.kind === 'free') return; const sp = C.TREES[t.species] || C.TREES.zelkova, d = U.dist(p, [t.x, t.y]); if (d < Math.max(rT, Math.min(2.2, sp.crown * 0.28)) && d < bd) { bd = d; best = { type: 'tree', id: t.key }; } });
      if (best) return best;
    }
    for (const b of D.buildings) if (U.pointInPoly(p, b.fp)) return { type: 'building', id: b.lotId };
    // 실제 지역의 현황 건물(보이는 것만)
    const cx = app.ctxData();
    if (cx && app.state.layers.ctx !== false && D.ctxV) for (const b of cx.bld) if (UDS.Ctx.shown(D.ctxV, b.id) && UDS.Ctx.hit(b, p)) return { type: 'ctx', id: b.id };
    // 회전교차로(원 안)
    for (const rb of D.rabs || []) if (U.dist(p, rb.c) <= rb.R) return { type: 'rab', id: rb.id };
    // 가구 경계선(도로 가장자리) 가까이를 누르면 가구. 지우개에서는 가구를 지울 수 없으므로 건너뛴다
    if (app.state.tool !== 'erase') { const blk = app.blockEdgeAt(p, 4.5 / this.view.s); if (blk) return { type: 'block', id: blk.id }; }
    for (const r of P.roads) {
      const info = D.roadInfo.get(r.id);
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const d = U.distPointSeg(p, r.pts[i], r.pts[i + 1]).d;
        if (d < info.lay.W / 2) { if (d < bd) { bd = d; best = { type: 'road', id: r.id }; } }
      }
    }
    if (best) return best;
    // 수공간(물 위를 지나는 도로·다리는 위에서 먼저 잡힌다)
    for (const w of D.waters || []) if (U.pointInPoly(p, w.poly)) return { type: 'water', id: w.id };
    for (const l of D.lots) if (U.pointInPoly(p, l.poly)) return { type: 'lot', id: l.id };
    for (const b of D.blocks) if (U.pointInPoly(p, b.poly)) return { type: 'block', id: b.id };
    return null;
  };

  /* ---------- SVG 내보내기 ---------- */
  R.exportSVG = function () {
    const app = this.app, P = app.P, D = app.D;
    const pen = SvgPen(0.12);
    const line = app.modeOf('2d') === 'line';
    drawScene(pen, P, D, { line, s: 3, layers: app.state.layers, app });
    // 축척 막대·방위표·제목(대상지 아래 여백). 좌표 단위는 m이고 인쇄 1:1000이면 1m = 1mm
    const sw = P.site.w, f = (v) => String(Math.round(v * 100) / 100);
    const nice = [[10, 5], [20, 4], [25, 5], [50, 5], [100, 4], [200, 4]];
    let pick = nice[0];
    for (const q of nice) if (q[0] <= Math.max(10, sw * 0.28)) pick = q;
    // 그린 것(도로 가장자리·수관)이 대상지 아래로 나간 만큼 더 내려서 둔다
    let minY = 0;
    D.arms.forEach((a) => a.geo.bands.forEach((bp) => bp.poly.forEach((q) => { if (q[1] < minY) minY = q[1]; })));
    (D.rabs || []).forEach((rb) => { minY = Math.min(minY, rb.c[1] - rb.R2); });
    D.trees.forEach((t) => { const sp = C.TREES[t.species] || C.TREES.zelkova; minY = Math.min(minY, t.y - sp.crown / 2); });
    minY = Math.max(minY, -40);
    const [L, n] = pick, x0 = 0, yb = Math.round(8 - minY), hb = 1.6, seg = L / n, fs = 2.6;
    const sh = [];
    for (let i = 0; i < n; i++) sh.push(`<rect x="${f(x0 + i * seg)}" y="${yb}" width="${f(seg)}" height="${hb}" fill="${i % 2 ? '#fff' : '#1c1c1e'}"/>`);
    sh.push(`<rect x="${x0}" y="${yb}" width="${f(L)}" height="${hb}" fill="none" stroke="#1c1c1e" stroke-width="0.25"/>`);
    for (let i = 0; i <= n; i++) sh.push(`<text x="${f(x0 + i * seg)}" y="${f(yb + hb + 3.2)}" font-size="${fs}" text-anchor="middle" fill="#1c1c1e" font-family="Noto Sans KR, sans-serif">${i === n ? `${L}m` : f(seg * i)}</text>`);
    // 방위표: 막대 오른쪽
    const nx = x0 + L + 12, ny = yb + 1;
    sh.push(`<circle cx="${f(nx)}" cy="${f(ny)}" r="4" fill="#fff" stroke="#1c1c1e" stroke-width="0.25"/>`);
    sh.push(`<path d="M${f(nx)} ${f(ny - 3.2)} L${f(nx + 1.7)} ${f(ny + 2)} L${f(nx)} ${f(ny + 0.9)} L${f(nx - 1.7)} ${f(ny + 2)} Z" fill="#1c1c1e"/>`);
    sh.push(`<text x="${f(nx)}" y="${f(ny - 5)}" font-size="${fs}" font-weight="700" text-anchor="middle" fill="#1c1c1e" font-family="Noto Sans KR, sans-serif">N</text>`);
    const title = (P.meta && P.meta.title) || '평면도';
    sh.push(`<text x="${f(sw)}" y="${f(yb + 1.2)}" font-size="3.4" font-weight="700" text-anchor="end" fill="#1c1c1e" font-family="Noto Sans KR, sans-serif">${U.esc(title)} · 평면도</text>`);
    sh.push(`<text x="${f(sw)}" y="${f(yb + 5.6)}" font-size="${fs}" text-anchor="end" fill="#6b6b70" font-family="Noto Sans KR, sans-serif">축척 1:1000 (인쇄 기준 1m = 1mm) · 대상지 ${f(sw)}×${f(P.site.h)}m</text>`);
    pen.layer('SHEET', '축척·방위·제목');
    pen.out.push(...sh);
    pen.end();
    const pad = 20;
    const vb = [-pad - 15, -P.site.h - pad - 15, P.site.w + 2 * pad + 30, P.site.h + pad + 15 + Math.max(pad + 15, yb + 12)];
    const defs = '<defs><pattern id="hatch" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.2" stroke="#000" stroke-width="0.12" stroke-opacity="0.5"/></pattern></defs>';
    const ttl = `<title>${U.esc(title)} · 평면도 · 축척 1:1000</title><desc>Urbify에서 내보낸 평면도. 좌표 단위 m, 인쇄 치수 기준 1:1000. 요소마다 레이어(건물·도로·수목 등)로 나뉘어 있습니다.</desc>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="${vb.join(' ')}" width="${vb[2]}mm" height="${vb[3]}mm">${ttl}${defs}<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>\n${pen.out.join('\n')}\n</svg>`;
  };

  UDS.Render2D = Render2D;
  UDS.COL2D = COL;
})(typeof window !== 'undefined' ? window : globalThis);
