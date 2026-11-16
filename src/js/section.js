/* Urbify — 가로 단면 편집기
 * 선택한 도로의 횡단구성을 그림으로 보여 주고, 경계선을 끌어 폭을 나누며, 지하 관로를 옮긴다.
 * 지상 풍경(건물·수목·사람·차량)은 따로 한 겹에 그려 시각에 맞춰 어둡게 한 뒤, 켜진 조명을 그 위에 얹는다. */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C, Dv = UDS.Derive, F = UDS.Fig;

  const SHORT = { sidewalk: '보도', furniture: '시설대', planting: '띠녹지', biketrack: '자전거도로', bikelane: '자전거차로', parking: '주차', lane: '차로', bus: '버스차로', median: '분리대', shared: '보차혼용', pedestrian: '보행로', estate: '단지내도로', trail: '오솔길' };
  const UTIL_SHORT = { water: '상수', sewer: '오수', storm: '우수', combined: '합류', power: '전력', telecom: '통신', gas: '가스', heat: '난방', tunnel: '공동구' };
  const SIGN_COLORS = ['#C9564B', '#5F87B5', '#E0AE4A', '#8A949C', '#EFECE4', '#4E9C86'];
  const ABOVE = 9.2, BELOW = 3.4;
  const ABBR = { sidewalk: '보도', furniture: '시설', planting: '녹지', biketrack: '자전거', bikelane: '자전거', parking: '주차', lane: '차로', bus: '버스', median: '분리', shared: '혼용', pedestrian: '보행', estate: '단지', trail: '오솔' };
  /* 공간 배분 띠: 누구를 위한 폭인지 */
  const ZONE = { sidewalk: 'ped', pedestrian: 'ped', furniture: 'green', planting: 'green', median: 'green', biketrack: 'bike', bikelane: 'bike', lane: 'car', bus: 'car', parking: 'park', shared: 'mix', estate: 'mix', trail: 'ped' };
  const TH = C.THEME;
  const ZONE_COL = { ped: TH.apricot, green: TH.teal, bike: TH.tealLight, car: TH.coral, park: '#B9B2AA', mix: TH.pink };
  const ZONE_LINE = { ped: '#fff', green: '#d9d9d9', bike: '#9a9a9a', car: '#000', park: '#555', mix: '#bbb' };
  const ZONE_NAME = { ped: '보행', green: '시설·녹지', bike: '자전거', car: '차량', park: '주차', mix: '보차혼용' };
  UDS.SEG_ZONE = ZONE;

  function Section(canvas, app) {
    this.cv = canvas;
    this.ctx = UDS.TH ? UDS.TH.wrap(canvas.getContext('2d')) : canvas.getContext('2d'); // 다크 테마: 그리는 색을 바꿔 줌
    this.app = app;
    this.W = 10; this.H = 10; this.dpr = 1;
    this.geo = null;
    this.hover = null;
    this.drag = null;
    this.layer = document.createElement('canvas');
    this._bind();
  }
  const S = Section.prototype;

  /* 이미지로 만든 재료: 그림 한 장이 무늬 크기(m)만큼 덮도록 되풀이해 칠한다. 땅(yG)과 건물 앞면(o.xFace)에 이음매를 맞추고,
     거울 반복은 2×2로 뒤집어 붙인 그림을 쓴다. 벽 색을 평균색보다 어둡게 바꿨으면 그만큼 곱해 물들이고, 3D처럼 안쪽으로 어둡게 */
  function cmTex(g, id, x0, y0, w, h, sc, yG, o) {
    const app = UDS.app, m = app && app.matDef ? app.matDef(id) : null; if (!m) return;
    const img = m.mirror ? app.matMirror(id) : app.matEl(id); if (!img) return;
    const k = m.mirror ? 2 : 1, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const tw = m.tile[0] * k * sc, th = m.tile[1] * k * sc;
    if (!(tw >= 1.5 && th >= 1.5)) return; // 화면에서 너무 잘면 평균색(벽 색)으로 둔다
    const pat = g.createPattern(img, 'repeat'); if (!pat) return;
    const ax = o.xFace === undefined ? x0 : o.xFace, M = [tw / iw, 0, 0, th / ih, ax, yG];
    pat.setTransform(g.isSVG ? { a: M[0], b: 0, c: 0, d: M[3], e: M[4], f: M[5] } : new DOMMatrix(M));
    g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    g.fillStyle = pat; g.fillRect(x0, y0, w, h);
    if (o.wall && m.color) {
      const W = U.hexToRgb(o.wall), A = U.hexToRgb(m.color), r = W.map((v, i) => U.clamp(v / Math.max(A[i], 0.03), 0, 1));
      if (r.some((v) => v < 0.97)) { g.globalCompositeOperation = 'multiply'; g.fillStyle = U.rgbToHex(r); g.fillRect(x0, y0, w, h); g.globalCompositeOperation = 'source-over'; }
    }
    if (o.xEnd !== undefined && Math.abs(o.xEnd - ax) > 1) {
      const sg = g.createLinearGradient(ax, 0, o.xEnd, 0); sg.addColorStop(0, 'rgba(255,255,255,0.05)'); sg.addColorStop(1, 'rgba(0,0,0,0.14)');
      g.fillStyle = sg; g.fillRect(x0, y0, w, h);
    }
    g.restore();
  }

  /* 단면 입면의 재료 질감: 줄눈·이음매·얼룩을 축척(sc, px/m)에 맞춰 그린다(창은 그 위에 그린다).
     같은 색의 선은 한 경로로 모아 한 번에 긋고, 벡터로 내보낼 때(vec)는 낱장마다 다른 톤처럼
     요소 수만 늘리는 것은 빼고 줄눈만 남긴다 */
  function facadeTex(g, mat, x0, y0, w, h, sc, seed, vec, yG, o) {
    if (!(w > 2 && h > 2)) return;
    if (typeof mat === 'string' && mat.indexOf('cm_') === 0) { cmTex(g, mat, x0, y0, w, h, sc, yG, o || {}); return; }
    const rnd = U.rng(seed);
    const dark = (a) => `rgba(0,0,0,${a})`, light = (a) => `rgba(255,255,255,${a})`;
    const x1 = x0 + w;
    g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    const lines = (segs, col, lw) => {
      if (!segs.length) return;
      g.beginPath(); for (const q of segs) { g.moveTo(q[0], q[1]); g.lineTo(q[2], q[3]); }
      g.strokeStyle = col; g.lineWidth = lw; g.stroke();
    };
    const tone = (x, y, ww, hh, k) => { if (vec) return; const t = rnd(); if (t < 0.4) return; g.fillStyle = t < 0.72 ? dark(k * (0.5 + rnd())) : light(k * (0.6 + rnd())); g.fillRect(x, y, ww, hh); };
    const band = (yy, hh, a) => { g.fillStyle = dark(a); g.fillRect(x0, yy, w, hh); };
    const H = [], V = [], V2 = [], H2 = [];
    if (mat === 'brick') {
      // 벽돌 쌓기(켜 0.075m): 화면에서 너무 촘촘하면 두 켜·네 켜씩 묶어 그린다
      let k = 1; while (0.075 * sc * k < 3.4 && k < 16) k *= 2;
      const ch = 0.075 * sc * k, bl = 0.21 * sc * Math.min(4, k);
      let row = 0;
      for (let yy = yG; yy > y0 - ch; yy -= ch, row++) {
        if (bl >= 5) { const off = (row % 2) * bl / 2; for (let xx = x0 - off; xx < x1; xx += bl) { tone(xx + 0.6, yy - ch + 0.6, bl - 1.2, ch - 1.2, 0.06); V.push([xx, yy, xx, yy - ch]); } }
        H.push([x0, yy, x1, yy]);
      }
      lines(V, dark(0.13), 0.7); lines(H, dark(0.17), 0.8);
      band(yG - 0.35 * sc, 0.35 * sc, 0.1); // 걸레받이
    } else if (mat === 'stone') {
      // 석재 판(1.2×0.6m): 판마다 조금 다른 톤, 그늘진 줄눈과 밝은 모서리, 아래 굽돌
      const pw = 1.2 * sc, ph = 0.6 * sc;
      if (ph >= 3) {
        let row = 0;
        for (let yy = yG; yy > y0 - ph; yy -= ph, row++) {
          const off = (row % 2) * pw / 2;
          for (let xx = x0 - off; xx < x1; xx += pw) { tone(xx, yy - ph, pw, ph, 0.045); V.push([xx, yy, xx, yy - ph]); V2.push([xx + 1, yy, xx + 1, yy - ph]); }
          H.push([x0, yy, x1, yy]); H2.push([x0, yy - 1, x1, yy - 1]);
        }
        lines(V, dark(0.15), 0.8); lines(H, dark(0.17), 0.8); lines(V2, light(0.25), 0.6); lines(H2, light(0.22), 0.6);
      }
      band(yG - 0.45 * sc, 0.45 * sc, 0.12);
    } else if (mat === 'concrete') {
      // 노출콘크리트: 위에서 흘러내린 얼룩, 거푸집 판(1.8×0.9m) 이음매, 폼타이 구멍
      if (!vec) for (let i = 0; i < Math.max(2, Math.round(w / 16)); i++) {
        const xx = x0 + rnd() * w, ww = (0.3 + rnd() * 1.4) * sc;
        const gr = g.createLinearGradient(0, y0, 0, y0 + h * (0.2 + rnd() * 0.45)); gr.addColorStop(0, dark(0.06 + 0.04 * rnd())); gr.addColorStop(1, dark(0));
        g.fillStyle = gr; g.fillRect(xx, y0, ww, h);
      }
      const pw = 1.8 * sc, ph = 0.9 * sc;
      if (ph >= 4) {
        const holes = [];
        for (let yy = yG; yy > y0 - ph; yy -= ph) {
          H.push([x0, yy, x1, yy]);
          for (let xx = x0; xx < x1; xx += pw) { V.push([xx, yy, xx, yy - ph]); if (sc > 12) [0.17, 0.5, 0.83].forEach((fx) => [0.25, 0.75].forEach((fy) => holes.push([xx + fx * pw, yy - fy * ph]))); }
        }
        lines(H, dark(0.14), 0.8); lines(V, dark(0.1), 0.7);
        if (holes.length) { const r = Math.max(0.7, 0.014 * sc); g.beginPath(); for (const q of holes) { g.moveTo(q[0] + r, q[1]); g.arc(q[0], q[1], r, 0, 6.2832); } g.fillStyle = dark(0.3); g.fill(); }
      }
    } else if (mat === 'metal') {
      // 금속 패널: 세로 이음매(0.6m)마다 그늘과 밝은 모서리, 위아래로 번지는 반사
      const pw = 0.6 * sc;
      if (!vec) { const gr = g.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, light(0.14)); gr.addColorStop(0.45, light(0)); gr.addColorStop(1, dark(0.08)); g.fillStyle = gr; g.fillRect(x0, y0, w, h); }
      if (pw >= 3) { for (let xx = x0; xx < x1; xx += pw) { V.push([xx, y0, xx, y0 + h]); V2.push([xx + 1.3, y0, xx + 1.3, y0 + h]); } lines(V, dark(0.2), 0.9); lines(V2, light(0.3), 0.7); }
      if (3 * sc >= 12) { for (let yy = yG; yy > y0; yy -= 3 * sc) H.push([x0, yy, x1, yy]); lines(H, dark(0.12), 0.7); }
    } else if (mat === 'tile') {
      // 외장 타일: 0.3m 격자 줄눈(작으면 0.6m), 장마다 조금 다른 톤
      const t = 0.3 * sc * (0.3 * sc < 3 ? 2 : 1);
      if (t >= 3) {
        if (t >= 6) for (let yy = yG; yy > y0 - t; yy -= t) for (let xx = x0; xx < x1; xx += t) tone(xx, yy - t, t, t, 0.04);
        for (let yy = yG; yy > y0; yy -= t) H.push([x0, yy, x1, yy]);
        for (let xx = x0; xx < x1; xx += t) V.push([xx, y0, xx, y0 + h]);
        lines(H, dark(0.11), 0.6); lines(V, dark(0.09), 0.6);
      }
      band(yG - 0.3 * sc, 0.3 * sc, 0.08);
    } else if (mat === 'stucco') {
      // 도장·스타코: 고운 반점, 아래쪽 물때, 위쪽 빗물 자국
      if (!vec) {
        const n = Math.min(1400, Math.round((w * h) / 30));
        g.fillStyle = dark(0.07); for (let i = 0; i < n; i++) if (rnd() < 0.5) g.fillRect(x0 + rnd() * w, y0 + rnd() * h, 1.2, 1.2);
        g.fillStyle = light(0.11); for (let i = 0; i < n; i++) if (rnd() < 0.5) g.fillRect(x0 + rnd() * w, y0 + rnd() * h, 1.2, 1.2);
        const gr = g.createLinearGradient(0, yG - 0.9 * sc, 0, yG); gr.addColorStop(0, dark(0)); gr.addColorStop(1, dark(0.1)); g.fillStyle = gr; g.fillRect(x0, yG - 0.9 * sc, w, 0.9 * sc);
        for (let i = 0; i < Math.max(1, Math.round(w / 40)); i++) { const xx = x0 + rnd() * w; const g2 = g.createLinearGradient(0, y0, 0, y0 + h * 0.3); g2.addColorStop(0, dark(0.06)); g2.addColorStop(1, dark(0)); g.fillStyle = g2; g.fillRect(xx, y0, (0.2 + rnd() * 0.5) * sc, h * 0.3); }
      }
    } else if (mat === 'glass') {
      // 유리 커튼월: 비친 하늘의 사선 띠와 1.5m 간격 멀리언
      if (!vec) { const gr = g.createLinearGradient(x0, y0, x0 + w * 0.7, y0 + h); gr.addColorStop(0, light(0.2)); gr.addColorStop(0.3, light(0.02)); gr.addColorStop(0.52, light(0.14)); gr.addColorStop(0.62, light(0.02)); gr.addColorStop(1, light(0)); g.fillStyle = gr; g.fillRect(x0, y0, w, h); }
      const pw = 1.5 * sc;
      if (pw >= 6) { for (let xx = x0 + pw; xx < x1; xx += pw) { V.push([xx, y0, xx, y0 + h]); V2.push([xx + 1, y0, xx + 1, y0 + h]); } lines(V, dark(0.16), 0.8); lines(V2, light(0.3), 0.6); }
    }
    g.restore();
  }

  S.resize = function () {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(10, r.width); this.H = Math.max(10, r.height);
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
  };

  /* ---------- 그리기 ---------- */
  /* svg: 벡터로 내보낼 때 넘기는 기록용 문맥(UDS.SvgCtx). 화면에 그릴 때는 비워 둔다 */
  /* 거울에 비친 그림 위에서도 글자는 바로 읽히게: 글자를 그 자리에서 다시 한 번 뒤집고, 왼쪽·오른쪽 맞춤을 바꾼다 */
  function mirrorText(c) {
    const wrap = (orig) => function (str, x, y, mw) {
      const al = this.textAlign;
      this.save(); this.translate(x, y); this.scale(-1, 1);
      this.textAlign = al === 'left' || al === 'start' ? 'right' : al === 'right' || al === 'end' ? 'left' : al;
      if (mw === undefined) orig.call(this, str, 0, 0); else orig.call(this, str, 0, 0, mw);
      this.textAlign = al; this.restore();
    };
    const f = c.fillText, k = c.strokeText;
    c.fillText = wrap(f); c.strokeText = wrap(k);
    return () => { delete c.fillText; delete c.strokeText; if (c.fillText !== f) { c.fillText = f; c.strokeText = k; } };
  }
  S.draw = function (svg) {
    const app = this.app, flip = !!(app.state && app.state.secFlip && app.secRoad && app.secRoad());
    this.flip = flip;
    if (!flip) return this._draw(svg);
    // 반대쪽에서 본 단면: 그림 전체를 좌우로 뒤집어 그리고(글자는 바로), 누른 자리도 뒤집어 판정한다
    const sv = svg && svg.isSVG ? svg : null, ctx = sv || this.ctx, g = sv || this.lctx();
    const un = [mirrorText(ctx)]; if (g !== ctx) un.push(mirrorText(g));
    try { return this._draw(svg); } finally { un.forEach((f) => f()); }
  };
  S._draw = function (svg) {
    svg = svg && svg.isSVG ? svg : null;
    const app = this.app, ctx = svg || this.ctx, st = app.state;
    const dpr = svg ? 1 : this.dpr;
    const W = svg ? svg.W : this.W, H = svg ? svg.H : this.H;
    const fx = this.flip ? -dpr : dpr, fo = this.flip ? W * dpr : 0;
    ctx.setTransform(fx, 0, 0, dpr, fo, 0);
    const grp = (id, label, subs) => { if (svg) svg.group(id, label, subs); };
    const sub = (id) => { if (svg) svg.sub(id); }; // 내보낼 때 같은 갈래(레이어)끼리 모은다
    const line = app.modeOf('sec') === 'line';
    const sky = UDS.sky(app.P ? app.P.settings : null);
    const night = line ? 0 : sky.night, glow = line ? 0 : sky.glow, dark = !line && sky.dark;
    const INK = line ? '#000' : TH.ink;
    const MUTE = line ? '#333' : TH.mute;
    const ACC = TH.tealDeep;
    // 하늘 위에 놓이는 글자·선의 색(밤에는 밝게)
    const TOPINK = dark ? '#f7f4f0' : INK;
    const TOPMUTE = dark ? 'rgba(235,235,245,0.82)' : MUTE;
    const TOPHALO = line ? '#fff' : `rgba(${sky.top.map((v) => Math.round(v * 255 * (dark ? 0.55 : 1.04))).map((v) => Math.min(255, v)).join(',')},0.9)`;
    ctx.clearRect(0, 0, W, H);
    if (W < 150 || H < 110) { this.geo = null; return; }
    const road = app.secRoad();
    if (!road || !app.D) {
      ctx.fillStyle = line ? '#fff' : C.PAL.outside; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = MUTE; ctx.font = `500 13px ${UDS.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('평면이나 3D에서 도로를 누르면 그 자리의 가로 단면이 열립니다.', W / 2, H / 2);
      this.geo = null;
      return;
    }
    const lay = Dv.layout(road);
    const info = app.D.roadInfo.get(road.id);
    const sctx = Dv.sectionContext(app.P, app.D, road.id, st.secS === null || st.secS === undefined ? (info ? info.len / 2 : 0) : st.secS) || { sides: { L: null, R: null }, W: lay.W };
    const compact = H < 215;
    // 표시 항목: 텍스트(이름표·구간 이름·연석·관 이름 등 모든 글자) · 치수(구간 폭 치수 열, 도로 폭, 도로경계선, 후퇴 거리) · 지하시설물.
    // 끈 항목의 자리는 그림에 돌려준다
    const show = st.secShow || {};
    const sT = show.text !== false, sD = show.dim !== false, sU = show.util !== false;
    const padT = sT ? (compact ? 22 : 30) : 10, padB = sD ? (compact ? 42 : 60) : 0;
    const A0 = compact ? 6.4 : ABOVE, B0 = sU ? (compact ? 2.6 : BELOW) : 1.25;
    const minSide = W < 560 ? 2.2 : 5;
    const sc = Math.max(2, Math.min((H - padT - padB) / (A0 + B0), W / (lay.W + 2 * minSide)));
    const cx = W / 2;
    // 세로로 남는 높이는 하늘(건물 높이)과 땅속에 나눠 써서 빈 띠가 생기지 않게 함. 기반시설을 끄면 땅속은 포장 단면만큼만 둔다
    const spare = Math.max(0, H - padT - padB - (A0 + B0) * sc);
    const below = sU ? Math.min(B0 + (spare * 0.22) / sc, 4.6) : B0;
    const above = Math.max(A0, (H - padT - padB) / sc - below);
    if (!svg) { this.above = above; this.below = below; } else svg.sc = sc;
    const gy = padT + above * sc;
    const X = (o) => cx - o * sc;
    const Y = (h) => gy - h * sc;
    const xL = X(lay.W / 2), xR = X(-lay.W / 2);
    const yBot = H - padB;
    const segChecks = {};
    (app.D.checks || []).forEach((c) => { if (c.target && c.target.type === 'road' && c.target.id === road.id && c.target.seg) { const cur = segChecks[c.target.seg]; if (!cur || (c.level === 'error') || (c.level === 'warn' && cur === 'info')) segChecks[c.target.seg] = c.level; } });

    // 지상 풍경을 그릴 겹
    const L = this.layer;
    if (!svg && (L.width !== this.cv.width || L.height !== this.cv.height)) { L.width = this.cv.width; L.height = this.cv.height; }
    const g = svg || this.lctx(); // 벡터로 내보낼 때는 겹을 따로 두지 않고 차례대로 적는다
    if (!svg) { g.setTransform(fx, 0, 0, dpr, fo, 0); g.clearRect(0, 0, W, H); }

    const mkPaint = (c) => (fill, lw) => {
      if (line) { c.fillStyle = '#fff'; c.fill(); c.strokeStyle = INK; c.lineWidth = lw || 1; c.stroke(); }
      else { c.fillStyle = fill; c.fill(); }
    };
    const paint = mkPaint(ctx), gpaint = mkPaint(g);
    const rr = (c, x, y, w, h, r) => { c.beginPath(); const q = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2); c.moveTo(x + q, y); c.lineTo(x + w - q, y); c.quadraticCurveTo(x + w, y, x + w, y + q); c.lineTo(x + w, y + h - q); c.quadraticCurveTo(x + w, y + h, x + w - q, y + h); c.lineTo(x + q, y + h); c.quadraticCurveTo(x, y + h, x, y + h - q); c.lineTo(x, y + q); c.quadraticCurveTo(x, y, x + q, y); c.closePath(); };
    const rect = (x, y, w, h) => { ctx.beginPath(); ctx.rect(x, y, w, h); };
    const grect = (x, y, w, h) => { g.beginPath(); g.rect(x, y, w, h); };
    const notes = []; // 풍경 위에 얹는 이름표·치수(어두워지지 않게 나중에 그림)
    const plateBoxes = [];
    const plate = (lines, x, y) => notes.push(() => {
      ctx.font = `700 11px ${UDS.FONT}`;
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14, h = lines.length * 14 + 8;
      rr(ctx, x - w / 2, y - 11, w, h, 6); ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.fill();
      if (line) { ctx.strokeStyle = '#000'; ctx.lineWidth = 0.8; ctx.stroke(); }
      lines.forEach((l, i) => { ctx.font = `${i ? 500 : 700} ${i ? 10.5 : 11}px ${UDS.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = i ? MUTE : INK; ctx.fillText(l, x, y + i * 14); });
    });
    const text = (s, x, y, o) => {
      o = o || {};
      ctx.font = `${o.w || 500} ${o.size || 11}px ${UDS.FONT}`;
      ctx.textAlign = o.align || 'center'; ctx.textBaseline = o.base || 'middle';
      if (o.halo) { ctx.lineWidth = 3; ctx.strokeStyle = o.halo; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
      ctx.fillStyle = o.color || INK; ctx.fillText(s, x, y);
    };
    const wins = [];   // 불 켜질 창: [x, y, w, h, 밝기, 종류]
    const lamps = [];  // 가로등 등기구
    const ems = [];    // 차량·자전거 등화

    /* 1. 하늘 */
    grp('BASE', '바탕(하늘·땅)');
    if (line) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
    else {
      const gr = ctx.createLinearGradient(0, 0, 0, gy);
      gr.addColorStop(0, sky.topHex); gr.addColorStop(1, sky.horHex);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, gy + 2);
      if (sky.night > 0.55) { // 별
        const r3 = U.rng(29); ctx.fillStyle = '#fff';
        for (let i = 0; i < Math.round(W * 0.09); i++) { const sx = r3() * W, sy = r3() * (gy - 30), a = (0.25 + r3() * 0.6) * (sky.night - 0.55) / 0.45; ctx.globalAlpha = a * (1 - sy / gy); ctx.fillRect(sx, sy, r3() < 0.15 ? 1.6 : 1, r3() < 0.15 ? 1.6 : 1); }
        ctx.globalAlpha = 1;
      }
      if (!compact && sky.day > 0.3) {
        ctx.fillStyle = `rgba(255,255,255,${0.78 * sky.day})`;
        [[0.16, 0.34, 1], [0.58, 0.22, 1.3], [0.86, 0.42, 0.8]].forEach(([fx, fy, k]) => {
          const x = W * fx, y = padT + (gy - padT) * fy * 0.5, u = 15 * k;
          ctx.beginPath(); ctx.arc(x, y, u, 0, 7); ctx.arc(x + u * 1.2, y + u * 0.15, u * 0.8, 0, 7); ctx.arc(x - u * 1.2, y + u * 0.25, u * 0.7, 0, 7); ctx.arc(x + u * 0.3, y - u * 0.5, u * 0.75, 0, 7); ctx.fill();
        });
      }
    }

    /* 2. 땅 */
    if (line) {
      ctx.strokeStyle = '#000'; ctx.lineWidth = 0.6;
      ctx.save(); ctx.beginPath(); ctx.rect(0, gy, W, yBot - gy); ctx.clip();
      ctx.beginPath();
      for (let x = -40; x < W + 40; x += 9) { ctx.moveTo(x, gy + 26); ctx.lineTo(x + 26, gy); }
      ctx.globalAlpha = 0.28; ctx.stroke(); ctx.globalAlpha = 1; ctx.restore();
    } else {
      const gr = ctx.createLinearGradient(0, gy, 0, yBot);
      gr.addColorStop(0, C.PAL.soil0); gr.addColorStop(1, C.PAL.soil1);
      ctx.fillStyle = gr; ctx.fillRect(0, gy - 1, W, yBot - gy + 1);
      ctx.fillStyle = 'rgba(60,40,20,0.13)';
      const r2 = U.rng(7);
      for (let i = 0; i < Math.round(W * 0.18); i++) ctx.fillRect(r2() * W, gy + 6 + r2() * (yBot - gy - 8), 1.6, 1.6);
    }
    ctx.fillStyle = line ? '#fff' : '#FAF8F5'; ctx.fillRect(0, yBot, W, H - yBot);

    /* 3. 좌우 대지(건물·공원 등) */
    grp('SIDE', '대지', [['SIDE-GROUND', '대지 지표'], ['SIDE-BUILDING', '건물'], ['SIDE-TREE', '대지 수목'], ['SIDE-CAR', '대지 차량'], ['SIDE-FENCE', '울타리']]);
    const sideGeo = {};
    const seedBase = U.hashStr(road.id);
    ['L', 'R'].forEach((k) => {
      const sd = sctx.sides[k];
      const dir = k === 'L' ? -1 : 1;
      const xRow = k === 'L' ? xL : xR;
      const xEnd = k === 'L' ? -4 : W + 4;
      const lvl = lay.hasCar ? road.curbH : 0;
      const yG = Y(lvl);
      const span = Math.abs(xEnd - xRow);
      const sg = (sideGeo[k] = { xRow, xEnd, sd, xFace: xRow });
      if (span < 3) return;
      if (!sd) {
        rect(Math.min(xRow, xEnd), yG, span, yBot - yG); ctx.fillStyle = line ? '#fff' : '#b5b3ad'; ctx.fill();
        if (span > 74 && sT) plate(['대상지 밖'], (xRow + xEnd) / 2, 44);
        if (line) { ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(xRow, yG); ctx.lineTo(xEnd, yG); ctx.stroke(); }
        return;
      }
      const use = sd.use;
      const b = sd.building;
      // 지표면
      sub('SIDE-GROUND');
      const surf = b ? '#E0DBD4' : use === 'park' || use === 'green' ? C.PAL.grass : use === 'parking' ? C.SEG.parking.color : use === 'plaza' ? C.PAL.plaza : '#d5d0c5';
      rect(Math.min(xRow, xEnd), yG, span, Math.max(2, 0.12 * sc)); paint(surf, 1);
      if (line) { ctx.beginPath(); ctx.moveTo(xRow, yG); ctx.lineTo(xEnd, yG); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke(); }
      if (b) {
        sub('SIDE-BUILDING');
        const st2 = b.st;
        const xFace = xRow + dir * sd.setback * sc;
        sg.xFace = xFace;
        const visH = Math.min(b.h, above + 1.2);
        const cut = b.h > above - 0.2; // 화면보다 높은 건물: 생략선을 긋지 않고 위 가장자리 밖으로 이어 그린다
        const TOPY = -2;
        const yTop = cut ? TOPY : Y(lvl + b.h);
        const bx0 = Math.min(xFace, xEnd), bw = Math.abs(xEnd - xFace);
        const wr = U.rng(U.hashStr(b.id || k) + 5);
        // 지하층(기초) 암시
        rect(bx0, yG, bw, 0.9 * sc); paint('#c4c1ba', 1);
        // 벽: 도로 쪽이 조금 밝고 안쪽으로 갈수록 어둡게
        const wall = st2.wallColor || '#dcd6ca';
        grect(bx0, yTop, bw, yG - yTop);
        if (line) gpaint(wall, 1.3);
        else { const wg = g.createLinearGradient(xFace, 0, xEnd, 0); wg.addColorStop(0, U.shade(wall, 0.05)); wg.addColorStop(1, U.shade(wall, -0.14)); g.fillStyle = wg; g.fill(); }
        if (!line) facadeTex(g, st2.material, bx0, yTop, bw, yG - yTop, sc, U.hashStr(String(b.id || k)) + 11, !!svg, yG, { xFace, xEnd, wall });
        const frame = line ? '#000' : 'rgba(28,32,40,0.6)';
        const glassFill = (x, y, w, h) => {
          if (line) return '#fff';
          const gg = g.createLinearGradient(0, y, 0, y + h);
          const base = st2.material === 'glass' ? '#C4D8E6' : '#B7CBDA'; // 밝은 유리(하늘이 비침)
          gg.addColorStop(0, U.shade(base, 0.24)); gg.addColorStop(1, U.shade(base, -0.12));
          return gg;
        };
        const win = (x, y, w, h, kind) => {
          const cutTop = y < TOPY;
          if (cutTop) { h -= TOPY - y; y = TOPY; } // 위 가장자리에 걸친 창은 가장자리까지만
          if (w < 1 || h < 1) return;
          grect(x, y, w, h); g.fillStyle = glassFill(x, y, w, h); g.fill(); g.strokeStyle = frame; g.lineWidth = line ? 0.8 : 0.7; g.stroke();
          if (!kind && st2.win !== 'curtain' && h > 6 && w > 4) {
            // 창의 깊이: 위쪽 그늘(창틀 들임), 가운데 창살, 아래 창대
            if (!line && !cutTop) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x + 0.5, y + 0.5, w - 1, Math.max(1, Math.min(h * 0.09, 0.12 * sc))); }
            if (w > 14) { g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.strokeStyle = frame; g.lineWidth = 0.7; g.stroke(); }
            if (!line) { g.fillStyle = 'rgba(255,255,255,0.78)'; g.fillRect(x - 1.5, y + h, w + 3, Math.max(1.5, 0.07 * sc)); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x - 1.5, y + h + Math.max(1.5, 0.07 * sc), w + 3, 1); }
          }
          if (y + h > 2) wins.push([x, y, w, h, wr(), kind || 0]);
        };
        const bay = (st2.win === 'curtain' ? 1.5 : st2.win === 'vertical' ? 1.8 : st2.ground === 'shop' ? 4.0 : 3.3) * sc;
        const nb = Math.max(1, Math.floor((bw - 0.3 * sc) / bay));
        const bx = (i) => xFace + dir * (0.3 * sc + i * bay);
        const gh = b.groundH * sc;
        // 기준층 창
        const nf = Math.ceil((visH - b.groundH) / b.floorH);
        for (let f = 0; f < nf; f++) {
          const y0 = yG - gh - (f + 1) * b.floorH * sc, fh = b.floorH * sc;
          if (y0 + fh < -2) break;
          if (!line) { g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1; g.beginPath(); g.moveTo(bx0, y0 + fh); g.lineTo(bx0 + bw, y0 + fh); g.stroke(); }
          for (let i = 0; i < nb; i++) {
            const a = bx(i), c = bx(i + 1);
            const wx0 = Math.min(a, c), bwid = Math.abs(c - a);
            let r;
            if (st2.win === 'curtain') r = [wx0 + 1, y0 + 1.5, bwid - 2, fh - 3];
            else if (st2.win === 'ribbon') r = [wx0, y0 + fh * (0.95 - Math.min(0.75, st2.wwr * 0.75) - 0.2), bwid, fh * Math.min(0.62, st2.wwr * 0.75 + 0.1)];
            else if (st2.win === 'vertical') r = [wx0 + bwid * 0.34, y0 + fh * 0.1, bwid * 0.32, fh * 0.78];
            else { const k2 = Math.sqrt(st2.wwr); const hw = U.clamp(k2 * 0.55, 0.14, 0.42); r = [wx0 + bwid * (0.5 - hw), y0 + fh * (1 - Math.min(0.3 + k2 * 0.85, 0.92)), bwid * hw * 2, fh * (Math.min(0.3 + k2 * 0.85, 0.92) - 0.3)]; }
            win(r[0], r[1], r[2], r[3], 0);
          }
        }
        // 1층
        const y1 = yG - gh;
        for (let i = 0; i < nb; i++) {
          const a = bx(i), c = bx(i + 1);
          const wx0 = Math.min(a, c), bwid = Math.abs(c - a);
          const gt = st2.ground;
          if (gt === 'shop') {
            const signH = Math.min(0.9 * sc, gh * 0.24);
            win(wx0 + 2, y1 + signH + 3, bwid - 4, gh - signH - 4, 1);
            g.beginPath(); g.moveTo(wx0 + bwid / 2, y1 + signH + 3); g.lineTo(wx0 + bwid / 2, yG - 1); g.strokeStyle = frame; g.lineWidth = 0.8; g.stroke();
            if (st2.sign === 'cluttered') { const sc2 = SIGN_COLORS[(i * 2 + (k === 'L' ? 1 : 0)) % SIGN_COLORS.length]; grect(wx0 + 1, y1 + 1, bwid - 2, signH + 1); gpaint(sc2, 0.8); wins.push([wx0 + 1, y1 + 1, bwid - 2, signH + 1, 0, 2, sc2]); }
            else if (st2.sign === 'regulated') { grect(wx0 + bwid * 0.25, y1 + signH * 0.25, bwid * 0.5, signH * 0.6); gpaint('#3a3a3c', 0.8); wins.push([wx0 + bwid * 0.25, y1 + signH * 0.25, bwid * 0.5, signH * 0.6, 0, 2, '#f2efe6']); }
          } else if (gt === 'lobby') win(wx0 + 1.5, y1 + gh * 0.1, bwid - 3, gh * 0.9 - 1, 1);
          else if (gt === 'residential') {
            win(wx0 + bwid * 0.3, y1 + gh * 0.22, bwid * 0.4, gh * 0.42, 0);
            if (i === 0) { grect(wx0 + bwid * 0.36, yG - gh * 0.72, bwid * 0.28, gh * 0.72); gpaint('#6f5644', 0.8); }
          } else if (gt === 'pilotis') { grect(wx0 + bwid * 0.1, y1 + 2, bwid * 0.8, gh - 2); g.fillStyle = line ? '#fff' : '#33353a'; g.fill(); if (line) { g.strokeStyle = '#000'; g.lineWidth = 0.8; g.stroke(); } }
          else if (gt === 'arcade') { grect(wx0 + bwid * 0.12, y1 + gh * 0.16, bwid * 0.76, gh * 0.84); g.fillStyle = line ? '#fff' : '#4c5866'; g.fill(); g.strokeStyle = frame; g.lineWidth = 0.8; g.stroke(); wins.push([wx0 + bwid * 0.12, y1 + gh * 0.16, bwid * 0.76, gh * 0.84, 0, 1]); }
        }
        if (!line) { g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 1; g.beginPath(); g.moveTo(bx0, y1); g.lineTo(bx0 + bw, y1); g.stroke(); }
        // 차양·돌출 간판
        if (st2.canopy) { grect(Math.min(xFace, xFace - dir * 1.4 * sc), y1 + 0.55 * sc, 1.4 * sc, Math.max(2, 0.14 * sc)); gpaint('#3a3a3c', 1); }
        if (st2.sign === 'cluttered') {
          for (let i = 0; i < 2; i++) { const yy = y1 - (0.4 + i * 3.1) * sc - 2.4 * sc; if (yy < 8) break; const sc2 = SIGN_COLORS[(i + (k === 'L' ? 0 : 2)) % 5]; grect(Math.min(xFace, xFace - dir * 0.75 * sc), yy, 0.75 * sc, 2.3 * sc); gpaint(sc2, 0.8); wins.push([Math.min(xFace, xFace - dir * 0.75 * sc), yy, 0.75 * sc, 2.3 * sc, 0, 2, sc2]); }
        }
        // 지붕·절단
        if (!cut) {
          if (st2.roof === 'green') { grect(bx0, yTop - 0.28 * sc, bw, 0.28 * sc); gpaint('#9CCBB4', 1); }
          else if (st2.roof === 'gable') {
            const roofPath = () => { g.beginPath(); g.moveTo(xFace - dir * 0.4 * sc, yTop); g.lineTo(xFace + dir * 4.6 * sc, yTop - 2.3 * sc); g.lineTo(xEnd, yTop - 2.3 * sc); g.lineTo(xEnd, yTop); g.closePath(); };
            roofPath(); gpaint(st2.roofColor || (st2.material === 'metal' ? '#8799ab' : '#a5614b'), 1.2);
            if (!line) { // 기와(골판) 줄과 처마 그늘
              g.save(); roofPath(); g.clip();
              const step = (st2.material === 'metal' ? 0.45 : 0.3) * sc;
              if (step >= 3) { g.beginPath(); const xa = Math.min(xFace, xEnd) - sc, xb = Math.max(xFace, xEnd) + sc; for (let xx = xFace; dir > 0 ? xx < xb : xx > xa; xx += dir * step) { g.moveTo(xx, yTop - 2.4 * sc); g.lineTo(xx, yTop); } g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 0.8; g.stroke(); }
              const eg = g.createLinearGradient(0, yTop - 0.5 * sc, 0, yTop); eg.addColorStop(0, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(0,0,0,0.22)'); g.fillStyle = eg; g.fillRect(Math.min(xFace, xEnd) - sc, yTop - 0.5 * sc, Math.abs(xEnd - xFace) + 2 * sc, 0.5 * sc);
              g.restore();
            }
            // 처마 밑 그늘
            if (!line) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(bx0, yTop, bw, Math.max(1.5, 0.3 * sc)); }
          } else { grect(bx0, yTop - 0.5 * sc, bw, 0.5 * sc); gpaint(U.shade(wall, -0.14), 1); }
        }
        // 건물 라벨
        const uName = b.label || (C.USES[use] || {}).name || '';
        const lx = (xFace + xEnd) / 2;
        if (bw > 74 && !compact && sT) { const py = Math.max(cut ? 44 : yTop + 18, 44); plate([`${uName} ${b.floors}층`, `높이 ${U.fmt(b.h, 1)}m`], lx, py); plateBoxes.push({ x: lx, y: py + 7, hw: 50, hh: 20 }); }
        // 전면공지 표시
        if (sd.setback * sc > 3 && sD) notes.push(() => { ctx.setLineDash([4, 3]); ctx.strokeStyle = line ? '#000' : dark ? '#ffd9a8' : '#a2845e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xFace, padT - 6); ctx.lineTo(xFace, yG); ctx.stroke(); ctx.setLineDash([]); });
      } else if (use === 'park' || use === 'green' || use === 'plaza') {
        sub('SIDE-TREE');
        const n = Math.max(1, Math.floor(span / (5.5 * sc)));
        for (let i = 0; i < n; i++) {
          const tx = xRow + dir * (2.2 + i * 5.5 + (i % 2) * 0.8) * sc;
          const spk = ['zelkova', 'cherry', 'pine', 'chionanthus'][(i + (k === 'L' ? 0 : 1)) % 4];
          F.tree(g, tx, yG, sc, C.TREES[spk], { line, k: 0.82 + (i % 3) * 0.08, seed: seedBase % 97 + i * 3 + (k === 'L' ? 1 : 11), maxH: above - 0.6 });
        }
        if (use !== 'plaza') F.shrubs(g, Math.min(xRow, xRow + dir * 1.6 * sc) + 2, Math.max(xRow, xRow + dir * 1.6 * sc) - 2, yG, sc, { line, seed: 5 });
        if (span > 74 && !compact && sT) plate([use === 'park' ? (C.PARK_TYPES[sd.parkType] || {}).name || '공원' : C.USES[use].name], (xRow + xEnd) / 2, 44);
      } else if (use === 'parking') {
        sub('SIDE-CAR');
        const n = Math.max(1, Math.floor((span - sc) / (2.6 * sc)));
        const cr = U.rng(seedBase + 17);
        for (let i = 0; i < Math.min(n, 5); i++) F.car(g, xRow + dir * (1.7 + i * 2.6) * sc, yG, sc, { line, color: F.CAR_COLORS[Math.floor(cr() * F.CAR_COLORS.length)], type: F.CAR_TYPES[Math.floor(cr() * 4)], rear: cr() < 0.5 });
        if (span > 74 && !compact && sT) plate(['주차장'], (xRow + xEnd) / 2, 44);
      } else {
        sub('SIDE-FENCE');
        g.strokeStyle = line ? '#000' : '#7b7466'; g.lineWidth = 1;
        for (let x = xRow + dir * 0.6 * sc; dir > 0 ? x < xEnd : x > xEnd; x += dir * 2.4 * sc) { g.beginPath(); g.moveTo(x, yG); g.lineTo(x, yG - 1.5 * sc); g.stroke(); }
        g.beginPath(); g.moveTo(xRow, yG - 1.4 * sc); g.lineTo(xEnd, yG - 1.4 * sc); g.moveTo(xRow, yG - 0.8 * sc); g.lineTo(xEnd, yG - 0.8 * sc); g.globalAlpha = 0.55; g.stroke(); g.globalAlpha = 1;
        if (span > 74 && C.USES[use] && !compact && sT) plate([C.USES[use].name], (xRow + xEnd) / 2, 44);
      }
    });

    /* 4. 포장 단면 */
    grp('PAVEMENT', '포장 단면');
    const bands = lay.bands.map((b) => {
      const lvl = lay.hasCar && !b.def.carriage ? road.curbH : 0;
      return { b, x0: X(b.oL), x1: X(b.oR), lvl, yS: Y(lvl), cxm: (X(b.oL) + X(b.oR)) / 2, wpx: b.seg.w * sc };
    });
    bands.forEach((q) => {
      const t = q.b.seg.type, def = q.b.def;
      const soilBand = def.green;
      const thick = soilBand ? 0.9 : 0.36;
      if (soilBand) {
        rect(q.x0, q.yS, q.wpx, thick * sc); paint('#6a5440', 1);
        rect(q.x0, q.yS, q.wpx, Math.max(2, 0.1 * sc)); paint('#9CCBB4', 1);
      } else {
        rect(q.x0, q.yS + 0.1 * sc, q.wpx, (thick - 0.1) * sc + (q.lvl ? q.lvl * sc : 0)); paint(C.PAL.base, 1);
        rect(q.x0, q.yS, q.wpx, Math.max(2.2, 0.1 * sc)); paint(def.color, 1);
        if (!line && (t === 'sidewalk' || t === 'shared' || t === 'pedestrian')) { ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 1; ctx.beginPath(); for (let x = q.x0 + 0.3 * sc; x < q.x1 - 1; x += 0.3 * sc) { ctx.moveTo(x, q.yS); ctx.lineTo(x, q.yS + Math.max(2.2, 0.1 * sc)); } ctx.stroke(); }
      }
    });
    // 연석
    for (let i = 0; i <= bands.length; i++) {
      const a = bands[i - 1], c = bands[i];
      const la = a ? a.lvl : (lay.hasCar ? road.curbH : 0), lc = c ? c.lvl : (lay.hasCar ? road.curbH : 0);
      if (!a || !c || Math.abs(la - lc) < 1e-6) continue;
      const xb = c.x0;
      const cw = Math.max(3, 0.2 * sc);
      const up = la > lc ? -1 : 1; // 높은 쪽으로 연석
      rect(up < 0 ? xb - cw : xb, Y(Math.max(la, lc)), cw, (Math.max(la, lc) + 0.3) * sc); paint(C.PAL.curbFace, 1);
      if (!line) { ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.7; ctx.stroke(); }
    }
    if (night > 0.02) { ctx.fillStyle = `rgba(8,12,30,${0.26 * night})`; ctx.fillRect(0, gy - road.curbH * sc - 1, W, yBot - gy + road.curbH * sc + 1); }

    /* 5. 지상 요소(겹 g에 그림) */
    grp('STREET', '지상 요소', [['TREE', '수목'], ['LIGHT', '가로등'], ['FURNITURE', '가로시설물'], ['PEOPLE', '사람'], ['VEHICLE', '차량'], ['POLE', '전주·가공선']]);
    const figs = [];
    const fig = (id, fn) => figs.push(() => { sub(id); fn(); });
    const hasTree = road.trees && road.trees.on;
    const hasLight = road.lights && road.lights.on;
    const sp = C.TREES[road.trees && road.trees.species] || C.TREES.zelkova;
    const maxH = above - 0.6;
    const person = (fx, yS, r, o) => fig('PEOPLE', () => F.person(g, fx, yS, sc, F.randomPerson(r, { line, ...(o || {}) })));
    const treeAt = (tx, yS, k, seed) => { sub('TREE'); F.tree(g, tx, yS, sc, sp, { line, k, seed: seedBase % 89 + seed, maxH }); };
    bands.forEach((q, bi) => {
      const seg = q.b.seg, t = seg.type, w = seg.w;
      const r = U.rng(U.hashStr(seg.id));
      const toCenter = q.b.oC > 0 ? 1 : -1;
      const away = q.b.oC < 0; // 우측통행: 진행 방향 오른쪽은 멀어지는 쪽(뒷모습)
      if (t === 'sidewalk') {
        const n = w < 0.7 ? 0 : U.clamp(Math.round(w / 1.3), 1, 3);
        let used = -1;
        if (w >= 2.4 && r() < 0.55) { used = 0; const fx = q.x0 + (0.5 / n) * q.wpx; const a = F.randomPerson(r, { line, back: away, bag: 'cross' }), c = { line, h: 1.08 + r() * 0.12, sex: r() < 0.5 ? 'm' : 'f', style: 'tee', shorts: true, top: ['#e9e8e4', '#d9a441', '#6f9fc9', '#c96a6a'][Math.floor(r() * 4)], bottom: '#3a465c', hat: r() < 0.6 ? '#e3b93f' : undefined, back: away, skin: a.skin, hair: a.hair }; fig('PEOPLE', () => F.pair(g, fx, q.yS, sc, a, c)); }
        for (let i = 0; i < n; i++) {
          if (i === used) continue;
          const fx = q.x0 + ((i + 0.5) / n) * q.wpx + (r() - 0.5) * 0.15 * sc;
          if (i === 1 && w >= 2.0 && r() < 0.5) { const o = F.randomPerson(r, { line, back: away }); fig('PEOPLE', () => F.wheelchair(g, fx, q.yS, sc, o)); }
          else person(fx, q.yS, r, r() < 0.12 ? { cane: true, hair: '#8a8a8c', style: 'coat', bag: 'none' } : null);
        }
        const noZone = lay.hasCar && !bands.some((z) => z.b.def.treeZone && (z.b.oC > 0) === (q.b.oC > 0));
        const leftSide = q.b.oR >= -1e-6;
        if (hasTree && noZone) treeAt(leftSide ? q.x1 - 0.7 * sc : q.x0 + 0.7 * sc, q.yS, 0.86, bi * 3 + 1);
        // 시설대가 없으면 가로등은 보도의 차도 쪽 가장자리에 선다
        if (hasLight && noZone) fig('LIGHT', () => lamps.push({ ...F.lamp(g, leftSide ? q.x1 - 0.35 * sc : q.x0 + 0.35 * sc, q.yS, sc, 8.4, toCenter, { line, lights: glow }), gy: Y(0) }));
      } else if (t === 'furniture' || t === 'planting') {
        if (t === 'planting') { sub('TREE'); F.shrubs(g, q.x0 + 2, q.x1 - 2, q.yS, sc, { line, seed: bi + 2 }); }
        if (hasTree) treeAt(q.cxm, q.yS, 0.88, bi * 3 + 2);
        if (hasLight && lay.hasCar) fig('LIGHT', () => lamps.push({ ...F.lamp(g, q.cxm + toCenter * Math.min(q.wpx * 0.3, 0.4 * sc), q.yS, sc, 8.4, toCenter, { line, lights: glow }), gy: Y(0) }));
        else if (hasLight) fig('LIGHT', () => lamps.push({ ...F.lamp(g, q.cxm, q.yS, sc, 4.4, 0, { line, lights: glow }), gy: q.yS }));
        if (t === 'furniture' && w >= 1.8 && !hasTree) fig('FURNITURE', () => F.bench(g, q.cxm - toCenter * 0.4 * sc, q.yS, sc, { line }));
      } else if (t === 'biketrack' || t === 'bikelane') {
        if (w >= 0.9) { const o = F.randomPerson(r, { line }); fig('PEOPLE', () => ems.push(...(F.cyclist(g, q.cxm, q.yS, sc, { line, back: away, top: o.top, bottom: o.bottom, skin: o.skin, hair: o.hair, lights: glow }) || []))); }
      } else if (t === 'parking') {
        if (w >= 1.7) { const col = F.CAR_COLORS[Math.floor(r() * F.CAR_COLORS.length)], ty = F.CAR_TYPES[Math.floor(r() * 4)]; fig('VEHICLE', () => F.car(g, q.cxm, q.yS, sc, { line, color: col, type: ty, rear: away })); }
        if (sc > 10 && sT) notes.push(() => text('P', q.cxm, q.yS - 2.2 * sc, { size: 10, w: 800, color: line ? '#000' : dark ? TH.tealLight : TH.tealInk, halo: TOPHALO }));
      } else if (t === 'lane') {
        const col = F.CAR_COLORS[Math.floor(r() * F.CAR_COLORS.length)], ty = F.CAR_TYPES[Math.floor(r() * 4)], taxi = r() < 0.12;
        const back = (seg.dir || 1) > 0;
        if (w >= 1.9) fig('VEHICLE', () => ems.push(...F.car(g, q.cxm, q.yS, sc, { line, color: taxi ? '#d9dbde' : col, type: taxi ? 'sedan' : ty, rear: back, lights: glow, taxi })));
        if (sT) notes.push(() => this._arrow(ctx, q.cxm, q.yS - 2.35 * sc, back, line, dark));
      } else if (t === 'bus') {
        const back = (seg.dir || 1) > 0;
        const col = F.BUS_COLORS[Math.floor(r() * F.BUS_COLORS.length)];
        if (w >= 2.6) fig('VEHICLE', () => ems.push(...F.bus(g, q.cxm, q.yS, sc, { line, rear: back, color: col, lights: glow })));
        if (sT) notes.push(() => this._arrow(ctx, q.cxm, q.yS - 3.85 * sc, back, line, dark));
      } else if (t === 'median') {
        sub('TREE'); F.shrubs(g, q.x0 + 2, q.x1 - 2, q.yS, sc, { line, seed: bi + 4 });
        if (hasTree && w >= 1.8) treeAt(q.cxm, q.yS, 0.8, bi * 3 + 3);
      } else if (t === 'shared' || t === 'pedestrian' || t === 'estate' || t === 'trail') {
        const n = U.clamp(Math.floor(w / 1.7), 1, 5);
        const carSlot = (t === 'shared' && w >= 4.5) || (t === 'estate' && w >= 3) ? Math.floor(n / 2) : -1; // 단지내도로: 차 한 대와 걷는 사람
        for (let i = 0; i < n; i++) {
          const fx = q.x0 + ((i + 0.5) / n) * q.wpx;
          if (i === carSlot) { const col = F.CAR_COLORS[Math.floor(r() * F.CAR_COLORS.length)], ty = F.CAR_TYPES[Math.floor(r() * 4)], back = r() < 0.5; fig('VEHICLE', () => ems.push(...F.car(g, fx, q.yS, sc, { line, color: col, type: ty, rear: back, lights: glow }))); continue; }
          if (t === 'pedestrian' && hasTree && w >= 6 && (i === 0 || i === n - 1)) { treeAt(fx, q.yS, 0.72, bi * 3 + i); continue; }
          person(fx + (r() - 0.5) * 0.3 * sc, q.yS, r);
        }
        if (hasLight) fig('LIGHT', () => lamps.push({ ...F.lamp(g, q.x0 + 0.5 * sc, q.yS, sc, 4.4, 0, { line, lights: glow }), gy: q.yS }));
      }
    });
    /* 직접 놓은 수목·시설물: 단면선 앞뒤 8m 안에 있으면 그 자리(도로 중심에서 떨어진 거리)에 그린다. 먼 것부터 */
    const placed = [];
    {
      const len = info ? info.len : U.polylineLength(road.pts);
      const cq = U.pointAlong(road.pts, U.clamp(st.secS === null || st.secS === undefined ? len / 2 : st.secS, 0, len));
      const cn = U.perpL(cq.dir);
      const gL = sideGeo.L, gR = sideGeo.R;
      const xMin = gL && gL.sd && gL.sd.building ? Math.min(gL.xFace, gL.xRow) : 0;
      const xMax = gR && gR.sd && gR.sd.building ? Math.max(gR.xFace, gR.xRow) : W;
      const lvl0 = lay.hasCar ? road.curbH : 0;
      (app.P.objects || []).forEach((o) => {
        const d = [o.x - cq.p[0], o.y - cq.p[1]];
        const t = d[0] * cq.dir[0] + d[1] * cq.dir[1], off = d[0] * cn[0] + d[1] * cn[1];
        if (Math.abs(t) > 8 || o.type === 'pm') return;
        const x = X(off); if (x < xMin - 2 || x > xMax + 2) return;
        const q = bands.find((z) => x >= Math.min(z.x0, z.x1) - 0.5 && x <= Math.max(z.x0, z.x1) + 0.5);
        placed.push({ o, x, y: q ? q.yS : Y(lvl0), t, off });
      });
      placed.sort((a2, b2) => b2.t - a2.t);
      if (!svg) this.placedIds = placed.map((it) => it.o.id); // 단면에 그린 요소(시험·안내용)
    }
    placed.forEach(({ o, x, y, off }) => {
      const seed = U.hashStr(o.id || 'o') % 97;
      const sideDir = off > 0 ? 1 : -1;
      const box = (x0, y0, w, h, col, a) => { g.beginPath(); g.rect(x0, y0, w, h); if (line) { g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 0.9; g.stroke(); } else { g.globalAlpha = a || 1; g.fillStyle = col; g.fill(); g.globalAlpha = 1; } };
      switch (o.type) {
        case 'tree': fig('TREE', () => F.tree(g, x, y, sc, C.TREES[o.species] || C.TREES.zelkova, { line, k: 0.92, seed, maxH })); break;
        case 'shrub': fig('TREE', () => F.shrubs(g, x - (o.r || 1.6) * sc, x + (o.r || 1.6) * sc, y, sc, { line, seed })); break;
        case 'light': fig('LIGHT', () => lamps.push({ ...F.lamp(g, x, y, sc, 4.4, 0, { line, lights: glow }), gy: y })); break;
        case 'smartpole': fig('LIGHT', () => { lamps.push({ ...F.lamp(g, x, y, sc, 9.2, sideDir, { line, lights: glow }), gy: Y(0) }); box(x - 0.25 * sc, y - 3.8 * sc, 0.5 * sc, 0.8 * sc, '#2b7f6e'); }); break;
        case 'bench': fig('FURNITURE', () => F.bench(g, x, y, sc, { line })); break;
        case 'bollard': fig('FURNITURE', () => box(x - 0.1 * sc, y - 0.9 * sc, 0.2 * sc, 0.9 * sc, '#5a5e63')); break;
        case 'hydrant': fig('FURNITURE', () => { box(x - 0.15 * sc, y - 0.8 * sc, 0.3 * sc, 0.8 * sc, '#d23c2c'); box(x - 0.22 * sc, y - 0.55 * sc, 0.44 * sc, 0.1 * sc, '#b02a1e'); }); break;
        case 'transformer': fig('FURNITURE', () => box(x - 0.6 * sc, y - 1.4 * sc, 1.2 * sc, 1.4 * sc, '#8c9b8a')); break;
        case 'bikerack': fig('FURNITURE', () => { g.beginPath(); g.moveTo(x - 0.4 * sc, y); g.lineTo(x - 0.4 * sc, y - 0.6 * sc); g.quadraticCurveTo(x - 0.4 * sc, y - 0.8 * sc, x - 0.2 * sc, y - 0.8 * sc); g.lineTo(x + 0.2 * sc, y - 0.8 * sc); g.quadraticCurveTo(x + 0.4 * sc, y - 0.8 * sc, x + 0.4 * sc, y - 0.6 * sc); g.lineTo(x + 0.4 * sc, y); g.strokeStyle = line ? '#000' : '#5a5e63'; g.lineWidth = Math.max(1, 0.06 * sc); g.stroke(); }); break;
        case 'busstop': fig('FURNITURE', () => {
          box(x - 2.1 * sc, y - 2.72 * sc, 4.2 * sc, 0.12 * sc, '#4c5157');
          box(x - 1.95 * sc, y - 2.6 * sc, 0.1 * sc, 2.6 * sc, '#4c5157'); box(x + 1.85 * sc, y - 2.6 * sc, 0.1 * sc, 2.6 * sc, '#4c5157');
          box(x - 1.8 * sc, y - 2.5 * sc, 3.6 * sc, 2.4 * sc, '#9fb8cc', 0.45);
          box(x - 1.1 * sc, y - 0.51 * sc, 2.2 * sc, 0.06 * sc, '#8a6a46');
          lamps.push({ x, y: y - 2.5 * sc, gy: y, post: true });
        }); break;
        default: fig('FURNITURE', () => box(x - 0.25 * sc, y - 0.5 * sc, 0.5 * sc, 0.5 * sc, '#777'));
      }
    });
    figs.forEach((f) => f());
    // 전주·가공선
    if (road.overhead && lay.hasCar) {
      const swR = lay.bands.filter((b) => b.seg.type === 'sidewalk' && b.oL <= 1e-6);
      const off = swR.length ? swR[0].oL - 0.35 : lay.curbR - 0.35;
      const px = X(off), yS = Y(road.curbH);
      sub('POLE');
      const pp = F.pole(g, px, yS, sc, { line });
      g.strokeStyle = line ? '#000' : 'rgba(28,28,30,0.78)'; g.lineWidth = 0.8;
      ['L', 'R'].forEach((k) => { const sg = sideGeo[k]; if (sg && sg.sd && sg.sd.building) { g.beginPath(); g.moveTo(px, pp.top); g.quadraticCurveTo((px + sg.xFace) / 2, pp.top + 2.8 * sc, sg.xFace, Math.max(pp.top + 1.1 * sc, yS - Math.min(sg.sd.building.h - 0.5, 6.5) * sc)); g.stroke(); } });
      if (sc > 9 && !compact && sT && sU) notes.push(() => {
        const o2 = { size: 9.5, color: line ? '#000' : dark ? TH.pink : TH.coralInk, w: 700, halo: TOPHALO };
        const yTopLab = yS - 9.6 * sc - 8;
        if (yTopLab >= padT + 4) { text('전주·가공선', px, yTopLab, o2); return; }
        ctx.font = `700 9.5px ${UDS.FONT}`;
        const tw = ctx.measureText('전주·가공선').width;
        const out = px >= cx ? 1 : -1;
        let lx = px + out * (0.95 * sc + 5);
        lx = out > 0 ? Math.min(lx, W - 4 - tw) : Math.max(lx, 4 + tw);
        const mid = lx + out * tw / 2;
        const hit = (y) => plateBoxes.some((b) => Math.abs(b.x - mid) < b.hw + tw / 2 + 4 && Math.abs(b.y - y) < b.hh + 8);
        const cands = [8.65, 7.3, 5.9, 4.5, 3.1].map((m) => Math.max(yS - m * sc, padT + 2));
        const ly = cands.find((y) => !hit(y));
        text('전주·가공선', lx, ly === undefined ? cands[0] : ly, { ...o2, align: out > 0 ? 'left' : 'right' });
      });
    }

    /* 5-2. 겹을 시각에 맞춰 어둡게 하고 본 화면에 얹은 뒤, 켜진 조명을 더함 */
    if (svg) { // 벡터에서는 겹만 골라 어둡게 할 수 없어, 지상 전체에 어둠을 한 장 덮는다
      if (night > 0.02 || glow > 0.02) grp('NIGHT', '밤 조명');
      if (night > 0.02) { ctx.fillStyle = `rgba(10,15,38,${0.6 * night})`; ctx.fillRect(0, 0, W, gy); }
    } else {
      if (night > 0.02) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(10,15,38,${0.68 * night})`; g.fillRect(0, 0, L.width, L.height); g.restore(); }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(L, 0, 0); ctx.restore();
    }
    if (glow > 0.02) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, gy + 1); ctx.clip();
      // 창과 간판
      const litRatio = 0.25 + 0.4 * sky.night;
      wins.forEach(([x, y, w, h, rv, kind, col]) => {
        if (kind === 2) { ctx.globalAlpha = 0.55 * glow; ctx.fillStyle = col || '#fff'; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; return; }
        if (kind === 0 && rv > litRatio) return;
        const warm = rv * 7 % 1 < 0.78;
        ctx.fillStyle = warm ? `rgba(255,214,140,${(kind ? 0.9 : 0.82) * glow})` : `rgba(226,238,255,${0.8 * glow})`;
        ctx.fillRect(x + 0.4, y + 0.4, w - 0.8, h - 0.8);
        if (kind === 0 && h > 6) { ctx.fillStyle = `rgba(60,40,20,${0.35 * glow})`; ctx.fillRect(x + 0.4, y + h * 0.62, w - 0.8, h * 0.38 - 0.4); }
      });
      ctx.globalCompositeOperation = 'lighter';
      wins.forEach(([x, y, w, h, rv, kind]) => { if (kind === 1) F.glow(ctx, x + w / 2, y + h * 0.8, Math.max(w, h) * 1.1, '255,205,130', 0.28 * glow); });
      lamps.forEach((l) => {
        F.cone(ctx, l.x, l.y, l.gy, (l.post ? 3.2 : 6.2) * sc, glow);
        F.glow(ctx, l.x, l.y, (l.post ? 1.1 : 1.5) * sc, '255,232,180', 0.85 * glow);
        F.glow(ctx, l.x, l.y, 0.3 * sc, '255,255,255', 0.95 * glow);
      });
      ems.forEach((e) => { F.glow(ctx, e.x, e.y, e.r, e.c, e.a * 0.62); if (e.core) F.glow(ctx, e.x, e.y, e.core * 2.6, '255,255,255', 0.95); });
      ctx.restore();
    }

    /* 6. 지하시설 */
    grp('UTILITY', '지하시설');
    // 연석 이름표(첫 번째 단차 아래)
    let curbBox = null;
    const pipes = [];
    const treeXs = [];
    bands.forEach((q) => { if (q.b.def.treeZone && hasTree) treeXs.push({ x: q.cxm, y: q.yS }); });
    if (hasTree && lay.hasCar && !treeXs.length) {
      bands.forEach((q) => { if (q.b.seg.type === 'sidewalk') { const leftSide = q.b.oR >= -1e-6; treeXs.push({ x: leftSide ? q.x1 - 0.7 * sc : q.x0 + 0.7 * sc, y: q.yS, pit: true }); } });
    }
    // 직접 놓은 수목(도로 안)의 뿌리분
    placed.forEach((it) => { if (it.o.type === 'tree' && it.x >= xL && it.x <= xR && !treeXs.some((t) => Math.abs(t.x - it.x) < 1.2 * sc)) treeXs.push({ x: it.x, y: it.y, pit: true }); });
    if (sU) treeXs.forEach((t) => {
      ctx.beginPath(); ctx.ellipse(t.x, t.y + 0.75 * sc, 1.25 * sc, 0.8 * sc, 0, 0, 7);
      if (line) { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#000'; ctx.lineWidth = 0.8; ctx.stroke(); ctx.setLineDash([]); }
      else { ctx.fillStyle = 'rgba(70,130,70,0.32)'; ctx.fill(); ctx.strokeStyle = 'rgba(40,100,50,0.55)'; ctx.lineWidth = 0.8; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]); }
    });
    const utils = sU ? road.utils || [] : [];
    // 빗물받이와 연결관
    const drain = utils.find((u) => u.type === 'storm') || utils.find((u) => u.type === 'combined');
    if (lay.hasCar && drain) {
      const gutters = [];
      for (let i = 1; i < bands.length; i++) { const a = bands[i - 1], c = bands[i]; if (a.b.def.carriage !== c.b.def.carriage && !a.b.def.island && !c.b.def.island) gutters.push({ x: c.x0, dirIn: a.b.def.carriage ? -1 : 1 }); }
      gutters.forEach((gt) => {
        const bxx = gt.x + gt.dirIn * 0.28 * sc;
        const bw = 0.45 * sc, bh = 0.55 * sc;
        const px = X(drain.off), py = gy + drain.depth * sc;
        ctx.strokeStyle = line ? '#000' : C.UTIL[drain.type].color; ctx.lineWidth = Math.max(1.2, 0.12 * sc); ctx.globalAlpha = line ? 1 : 0.85;
        ctx.beginPath(); ctx.moveTo(bxx, gy + bh); ctx.lineTo(px, py); ctx.stroke(); ctx.globalAlpha = 1;
        rect(bxx - bw / 2, gy + 0.05 * sc, bw, bh); paint(C.PAL.curb, 1);
        if (!line) { ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.7; ctx.stroke(); }
        ctx.fillStyle = line ? '#000' : '#2c2c2e'; ctx.fillRect(bxx - bw / 2, gy - 1, bw, 2);
      });
    }
    utils.forEach((u) => {
      const def = C.UTIL[u.type]; if (!def) return;
      const px = X(u.off), py = gy + u.depth * sc;
      const r = Math.max(3.4, (u.dia / 2) * sc);
      if (['sewer', 'storm', 'combined'].includes(u.type)) {
        const mw = Math.max(5, 0.6 * sc);
        ctx.setLineDash([3, 2]); ctx.strokeStyle = line ? '#000' : 'rgba(40,40,40,0.55)'; ctx.lineWidth = 0.8;
        ctx.strokeRect(px - mw / 2, gy + 2, mw, Math.max(0, py - r - gy - 2)); ctx.setLineDash([]);
      }
      const selU = st.selUtil === u.id;
      if (def.box) { rect(px - r, py - r * 0.8, r * 2, r * 1.6); paint(C.PAL.curb, 1.2); ctx.strokeStyle = line ? '#000' : def.color; ctx.lineWidth = 1.6; ctx.stroke();
        [[C.UTIL.power.color, -0.5, -0.3], [C.UTIL.telecom.color, -0.5, 0.3], [C.UTIL.water.color, 0.45, 0.2]].forEach(([cl, dx, dy]) => { ctx.beginPath(); ctx.arc(px + dx * r, py + dy * r, Math.max(1.6, r * 0.16), 0, 7); ctx.fillStyle = line ? '#000' : cl; ctx.fill(); });
      } else {
        ctx.beginPath(); ctx.arc(px, py, r, 0, 7);
        if (line) { ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.beginPath(); ctx.arc(px, py, Math.max(1, r * 0.35), 0, 7); ctx.fillStyle = '#000'; ctx.fill(); }
        else { ctx.fillStyle = def.color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.stroke(); ctx.beginPath(); ctx.arc(px, py, r * 0.42, 0, 7); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill(); }
      }
      if (selU) { ctx.beginPath(); ctx.arc(px, py, r + 4, 0, 7); ctx.strokeStyle = line ? '#000' : '#fff'; ctx.lineWidth = 3.4; ctx.stroke(); ctx.strokeStyle = ACC; ctx.lineWidth = 2; ctx.stroke(); }
      pipes.push({ u, x: px, y: py, r });
    });
    if (sc > 9 && !compact && sT) {
      const steps = [];
      for (let i = 1; i < bands.length; i++) if (Math.abs(bands[i].lvl - bands[i - 1].lvl) > 1e-6) steps.push({ x: bands[i].x0, hiLeft: bands[i - 1].lvl > bands[i].lvl });
      if (steps.length) {
        const label = `연석 ${Math.round(road.curbH * 100)}cm`;
        ctx.font = `700 9.5px ${UDS.FONT}`;
        const hw = ctx.measureText(label).width / 2 + 2;
        const ly = gy + 0.62 * sc + 5;
        const cands = [];
        // 높은 쪽(보도 아래) 먼저, 그다음 차도 아래. 왼쪽 연석부터.
        steps.forEach((sp) => { cands.push({ x: sp.x + (sp.hiLeft ? -1 : 1) * (hw + 2), y: ly }); });
        steps.forEach((sp) => { cands.push({ x: sp.x + (sp.hiLeft ? 1 : -1) * (hw + 2), y: ly }); });
        const free = (c) => c.x - hw > 4 && c.x + hw < W - 4 && !pipes.some((q) => Math.abs(q.x - c.x) < hw + q.r + 3 && Math.abs(q.y - c.y) < q.r + 8);
        const c = cands.find(free);
        if (c) {
          text(label, c.x, c.y, { size: 9.5, w: 700, color: line ? '#000' : '#fff', halo: line ? '#fff' : 'rgba(60,45,30,0.8)' });
          curbBox = { x: c.x, y: c.y, w: hw };
        }
      }
    }
    if (sc > 8 && !compact && sT) {
      // 관 이름표: 아래 → 위 → 옆 순서로, 다른 관·이름표와 겹치지 않는 첫 자리
      const boxes = pipes.map((q) => ({ x0: q.x - q.r - 1, x1: q.x + q.r + 1, y0: q.y - q.r - 1, y1: q.y + q.r + 1 }));
      if (curbBox) boxes.push({ x0: curbBox.x - curbBox.w, x1: curbBox.x + curbBox.w, y0: curbBox.y - 6, y1: curbBox.y + 6 });
      const hitBox = (b) => b.x0 < 2 || b.x1 > W - 2 || b.y0 < gy + 2 || b.y1 > yBot - 1 || boxes.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
      ctx.font = `700 9.5px ${UDS.FONT}`;
      pipes.slice().sort((a, b) => a.x - b.x).forEach((p) => {
        const t = UTIL_SHORT[p.u.type] || ''; if (!t) return;
        const hw = ctx.measureText(t).width / 2 + 1.5, hh = 5.5;
        const cands = [[p.x, p.y + p.r + 8], [p.x, p.y - p.r - 8], [p.x - p.r - 3 - hw, p.y], [p.x + p.r + 3 + hw, p.y], [p.x, p.y + p.r + 19], [p.x - p.r - 3 - hw, p.y + 9], [p.x + p.r + 3 + hw, p.y + 9]];
        const box = (c) => ({ x0: c[0] - hw, x1: c[0] + hw, y0: c[1] - hh, y1: c[1] + hh });
        const c = cands.find((q) => !hitBox(box(q))) || cands[0];
        boxes.push(box(c));
        text(t, c[0], c[1], { size: 9.5, w: 700, color: line ? '#000' : '#fff', halo: line ? '#fff' : 'rgba(60,45,30,0.8)' });
      });
    }
    // 깊이 눈금
    if (sU) for (let d = 1; d <= 4; d++) {
      const yy = gy + d * sc;
      if (yy > yBot - 4 || (compact && d > 2)) break;
      ctx.strokeStyle = line ? '#000' : 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(6, yy); ctx.stroke();
      if (sT) text(`-${d}m`, 9, yy, { size: 9, align: 'left', color: line ? '#000' : 'rgba(255,255,255,0.92)' });
    }

    /* 7. 이름표·경계선·치수 */
    grp('ANNO', '이름표와 치수', [['LABEL', '이름표'], ['DIM', '치수']]);
    notes.forEach((f) => { sub('LABEL'); f(); });
    const dy = H - padB + (compact ? 17 : 18); // 구간 폭 치수 열
    const dy2 = H - (compact ? 10 : 15);       // 도로 폭 전체 치수
    const gL = sideGeo.L, gR = sideGeo.R;
    // 구간 경계(얇은 세로선)와 구간 이름(텍스트)
    if (sT) {
      ctx.strokeStyle = line ? 'rgba(0,0,0,0.35)' : dark ? 'rgba(255,255,255,0.2)' : 'rgba(28,28,30,0.16)'; ctx.lineWidth = 1;
      bands.forEach((q, i) => { if (i === 0) return; ctx.beginPath(); ctx.moveTo(q.x0, padT - 14); ctx.lineTo(q.x0, q.yS); ctx.stroke(); });
      // 구간 이름: 전체 이름 → 줄임말 → 세로쓰기 순으로 맞춤
      if (!compact) bands.forEach((q) => {
        const full = SHORT[q.b.seg.type] || q.b.def.name, ab = ABBR[q.b.seg.type] || full;
        const isSel = st.selSeg === q.b.seg.id;
        const o = { size: 10.5, w: isSel ? 700 : 500, color: isSel ? (dark ? TH.tealLight : TH.tealInk) : TOPMUTE, halo: TOPHALO };
        ctx.font = `${o.w} 10.5px ${UDS.FONT}`;
        const fits = (t) => ctx.measureText(t).width + 4 <= q.wpx;
        if (fits(full)) text(full, q.cxm, padT - 12, o);
        else if (fits(ab)) text(ab, q.cxm, padT - 12, o);
        else if (q.wpx >= 11 && !compact) for (let i = 0; i < ab.length; i++) text(ab[i], q.cxm, padT - 12 + i * 11.5, { ...o, size: 10 });
      });
    }
    if (sD) { // 치수: 도로경계선, 구간 폭 치수 열(건축선 후퇴 포함), 공간 배분 띠, 도로 폭 전체 치수
    sub('DIM');
    // 도로경계선
    ctx.setLineDash([8, 3, 2, 3]); ctx.strokeStyle = line ? '#000' : dark ? TH.coral : C.PAL.cut; ctx.lineWidth = 1;
    [xL, xR].forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, dy2); ctx.stroke(); });
    ctx.setLineDash([]);
    // 구간 폭 치수 열
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    const dStart = gL && gL.sd && gL.sd.building && gL.sd.setback > 0 ? gL.xFace : xL;
    const dEnd = gR && gR.sd && gR.sd.building && gR.sd.setback > 0 ? gR.xFace : xR;
    ctx.beginPath(); ctx.moveTo(dStart, dy); ctx.lineTo(dEnd, dy); ctx.stroke();
    const tick = (x, yy) => { const y0 = yy === undefined ? dy : yy; ctx.beginPath(); ctx.moveTo(x - 3, y0 + 3); ctx.lineTo(x + 3, y0 - 3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y0 - 5); ctx.lineTo(x, y0 + 3); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1; };
    tick(xL); bands.forEach((q) => tick(q.x1));
    bands.forEach((q) => {
      const lv = segChecks[q.b.seg.id];
      const isSel = st.selSeg === q.b.seg.id;
      const col = line ? '#000' : lv === 'error' ? TH.coralInk : lv === 'warn' ? TH.apricotInk : isSel ? TH.tealInk : INK;
      let s2 = U.fmt(q.b.seg.w, 2).replace(/0$/, '');
      if (s2.endsWith('.0') && q.wpx < 26) s2 = s2.slice(0, -2);
      ctx.font = `700 11px ${UDS.FONT}`;
      const fit = ctx.measureText(s2).width + 3 <= q.wpx;
      text(s2, q.cxm, dy - 9, { size: fit ? 11 : 9, w: 700, color: col });
      if (line && (lv === 'error' || lv === 'warn')) { ctx.beginPath(); ctx.moveTo(q.cxm - 8, dy - 2.5); ctx.lineTo(q.cxm + 8, dy - 2.5); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.lineWidth = 1; }
    });
    [['L', gL], ['R', gR]].forEach(([k, sg]) => {
      if (!(sg && sg.sd && sg.sd.building && sg.sd.setback > 0)) return;
      tick(sg.xFace);
      const mx = (sg.xRow + sg.xFace) / 2, wpx = Math.abs(sg.xFace - sg.xRow);
      const s2 = wpx > 44 && sT ? `후퇴 ${U.fmt(sg.sd.setback, 1)}` : U.fmt(sg.sd.setback, 1);
      if (wpx > 16) text(s2, mx, dy - 9, { size: 9.5, w: 500, color: line ? '#000' : '#8a6a45' });
    });
    // 공간 배분 띠: 보행·녹지·자전거·차량·주차에 폭이 얼마나 돌아갔는지
    if (!compact) {
      const zy = dy + 6, zh = 5;
      bands.forEach((q) => {
        const z = ZONE[q.b.seg.type] || 'ped';
        ctx.fillStyle = line ? ZONE_LINE[z] : ZONE_COL[z];
        ctx.fillRect(q.x0 + 0.5, zy, Math.max(0.5, q.wpx - 1), zh);
        if (line) { ctx.strokeStyle = '#000'; ctx.lineWidth = 0.7; ctx.strokeRect(q.x0 + 0.5, zy, Math.max(0.5, q.wpx - 1), zh); }
      });
      // 범례(왼쪽 여백이 넉넉할 때, 텍스트를 켰을 때)
      const zs = Array.from(new Set(bands.map((q) => ZONE[q.b.seg.type] || 'ped')));
      ctx.font = `500 9.5px ${UDS.FONT}`;
      const need = zs.reduce((s3, z) => s3 + ctx.measureText(ZONE_NAME[z]).width + 20, 0);
      if (sT && xL - 16 > need) {
        // 반대쪽에서 볼 때도 화면 왼쪽에서 [색 칸][이름] 차례로 읽히게 화면 좌표로 놓는다(그림 좌표 = W - 화면 좌표)
        let lx = 8;
        const fl = this.flip;
        zs.forEach((z) => {
          const rx = fl ? W - lx - 8 : lx;
          ctx.fillStyle = line ? ZONE_LINE[z] : ZONE_COL[z]; ctx.fillRect(rx, zy, 8, zh); if (line) { ctx.strokeStyle = '#000'; ctx.lineWidth = 0.7; ctx.strokeRect(rx, zy, 8, zh); }
          text(ZONE_NAME[z], fl ? W - (lx + 11) : lx + 11, zy + zh / 2 + 0.5, { size: 9.5, align: fl ? 'right' : 'left', color: MUTE });
          lx += ctx.measureText(ZONE_NAME[z]).width + 20;
        });
      }
    }
    // 도로 폭 전체 치수(치수 열 아래): 숫자는 치수, '도로 폭 … · 중로0류'는 텍스트를 켰을 때
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xL, dy2); ctx.lineTo(xR, dy2); ctx.stroke();
    tick(xL, dy2); tick(xR, dy2);
    const total = sT ? `도로 폭 ${U.fmt(lay.W, 2).replace(/\.?0+$/, '')}m · ${C.classify(lay.W)}` : `${U.fmt(lay.W, 2).replace(/\.?0+$/, '')}`;
    ctx.font = `700 11px ${UDS.FONT}`;
    const tw = ctx.measureText(total).width + 12;
    const bgc = line ? '#fff' : '#FAF8F5';
    if (tw < xR - xL - 8) { ctx.fillStyle = bgc; ctx.fillRect(cx - tw / 2, dy2 - 8, tw, 16); text(total, cx, dy2 + 0.5, { size: 11, w: 700, color: INK }); }
    else text(`${U.fmt(lay.W, 1)}m`, cx, dy2 - 0.5, { size: 10.5, w: 700, color: INK, halo: bgc });
    } // sD

    /* 방위: 단면 양 끝이 어느 쪽인지. 그림 좌표로 그리므로 반대쪽에서 볼 때는 그림과 함께 자리를 바꾼다 */
    {
      const len0 = info ? info.len : U.polylineLength(road.pts);
      const cq0 = U.pointAlong(road.pts, U.clamp(st.secS === null || st.secS === undefined ? len0 / 2 : st.secS, 0, len0));
      const nL = U.perpL(cq0.dir); // 그림 왼쪽(+거리) 방향
      const card = (v) => ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round((((Math.atan2(v[0], v[1]) * 180) / Math.PI + 360) % 360) / 45) % 8];
      const yA = 12, col = line ? '#000' : TOPINK, halo = line ? '#fff' : TOPHALO;
      const arrow = (xTip, dir) => {
        ctx.beginPath(); ctx.moveTo(xTip, yA); ctx.lineTo(xTip - dir * 6, yA - 4); ctx.lineTo(xTip - dir * 6, yA + 4); ctx.closePath();
        ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.lineJoin = 'round'; ctx.stroke(); ctx.fillStyle = col; ctx.fill();
        ctx.beginPath(); ctx.moveTo(xTip - dir * 5, yA); ctx.lineTo(xTip - dir * 12, yA); ctx.lineWidth = 1.6; ctx.strokeStyle = col; ctx.stroke();
      };
      grp('NORTH', '방위');
      arrow(6, -1); text(card(nL), 20, yA + 0.5, { size: 11, w: 800, align: 'left', color: col, halo });
      arrow(W - 6, 1); text(card([-nL[0], -nL[1]]), W - 20, yA + 0.5, { size: 11, w: 800, align: 'right', color: col, halo });
    }

    if (svg) { svg.group(null); return; } // 내보낼 때는 선택·끌기 표시를 넣지 않는다
    /* 8. 선택·끌기 표시 */
    const hv = this.hover;
    const colTop = sT ? padT - 20 : 0, colBot = sD ? dy - 18 : H;
    bands.forEach((q) => {
      const isSel = st.selSeg === q.b.seg.id;
      const isHv = hv && hv.kind === 'band' && hv.id === q.b.seg.id;
      if (!isSel && !isHv) return;
      ctx.fillStyle = isSel ? 'rgba(43,127,110,0.14)' : 'rgba(43,127,110,0.07)';
      ctx.fillRect(q.x0, colTop, q.wpx, colBot - colTop);
      if (isSel) { ctx.strokeStyle = ACC; ctx.lineWidth = 1.5; ctx.strokeRect(q.x0 + 0.75, colTop, q.wpx - 1.5, colBot - colTop); }
    });
    const grip = (x, strong) => {
      ctx.strokeStyle = ACC; ctx.lineWidth = strong ? 2 : 1.2;
      ctx.beginPath(); ctx.moveTo(x, colTop); ctx.lineTo(x, colBot); ctx.stroke();
      const yy = gy - 1.1 * sc;
      rr(ctx, x - 5, yy - 11, 10, 22, 5); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = ACC; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 1.6, yy - 5); ctx.lineTo(x - 1.6, yy + 5); ctx.moveTo(x + 1.6, yy - 5); ctx.lineTo(x + 1.6, yy + 5); ctx.lineWidth = 1; ctx.stroke();
    };
    if (this.drag && this.drag.kind === 'div') grip(this.drag.x, true);
    else if (hv && hv.kind === 'div') grip(hv.x, false);
    else if (st.selSeg) { const q = bands.find((z) => z.b.seg.id === st.selSeg); if (q) { grip(q.x0, false); grip(q.x1, false); } }

    this.geo = { sc, cx, gy, padT, padB, bands, pipes, xL, xR, sideGeo, colTop, colBot, yBot, below };
  };

  /* 내보낸 그림 아래에 붙이는 띠: 축척 막대(흑백 칸)와 제목. c는 캔버스 2D 문맥이나 SvgCtx, (0, y0)부터 폭 W, 높이 S.FOOT */
  S.FOOT = 60;
  S.scaleStrip = function (c, W, y0, sc, title, note) {
    const FONT = UDS.FONT, ink = '#1c1c1e';
    c.fillStyle = '#fff'; c.fillRect(0, y0, W, S.FOOT);
    c.strokeStyle = '#cfcac2'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, y0 + 0.5); c.lineTo(W, y0 + 0.5); c.stroke();
    // 막대 길이: 160px 넘는 가장 짧은 것(칸 수 n)
    const cand = [[1, 4], [2, 4], [5, 5], [10, 5], [20, 4], [50, 5], [100, 4]];
    let pick = cand[cand.length - 1];
    for (const q of cand) if (q[0] * sc >= 160) { pick = q; break; }
    const L = pick[0], n = pick[1], x0 = 24, yb = y0 + 18, hb = 6, seg = (L / n) * sc;
    for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? '#fff' : ink; c.fillRect(x0 + i * seg, yb, seg, hb); }
    c.strokeStyle = ink; c.lineWidth = 1; c.strokeRect(x0, yb, L * sc, hb);
    c.font = `600 10.5px ${FONT}`; c.fillStyle = ink; c.textBaseline = 'top'; c.textAlign = 'center';
    const num = (v) => String(Math.round(v * 100) / 100);
    for (let i = 0; i <= n; i++) c.fillText(i === n ? `${num(L)}m` : num((L / n) * i), x0 + i * seg, yb + hb + 5);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    c.font = `700 12px ${FONT}`; c.fillText(title, W - 24, yb + 1);
    if (note) { c.font = `500 10.5px ${FONT}`; c.fillStyle = '#6b6b70'; c.fillText(note, W - 24, yb + 18); }
  };
  S.title = function () {
    const road = this.app.secRoad();
    return `가로 단면 A–A′${road && road.name ? ' · ' + road.name : ''}`;
  };

  /* 벡터(SVG) 내보내기. 화면 크기와 상관없이 넉넉한 판에 그리고, 인쇄 치수는 1:100에 맞춘다(1m = 10mm). 아래에 축척 막대를 붙인다 */
  S.exportSVG = function () {
    const app = this.app, road = app.secRoad();
    if (!road || !app.D) return null;
    const lay = Dv.layout(road);
    const W = Math.round(U.clamp((lay.W + 26) * 44, 1100, 1900)), H0 = 640;
    const svg = new UDS.SvgCtx(W, H0);
    this.draw(svg);
    const sc = svg.sc || 44;
    svg.H = H0 + S.FOOT; svg.canvas.height = svg.H;
    svg.setTransform(1, 0, 0, 1, 0, 0);
    svg.group('SCALE', '축척·제목');
    S.scaleStrip(svg, W, H0, sc, this.title(), `축척 1:100 (인쇄 기준 1m = 10mm)${this.flip ? ' · 반대쪽에서 본 단면' : ''}`);
    return svg.toString({ title: `${this.title()} · 축척 1:100`, desc: `Urbify에서 내보낸 가로 단면. 1m = ${U.fmt(sc, 1)}px, 인쇄 치수 기준 1:100.`, mmPerPx: 10 / sc });
  };
  /* 그림(PNG) 내보내기용: 지금 화면의 단면 아래에 축척 막대 띠를 붙인 캔버스 */
  S.lctx = function () { const c = this.layer.getContext('2d'); return UDS.TH ? UDS.TH.wrap(c) : c; };
  S.exportCanvas = function () {
    const TH = UDS.TH, dk = !!(TH && TH.inkOn());
    if (dk) TH.off = true; // 그림 파일은 인쇄를 생각해 라이트로 그린다
    try { this.draw(); } finally { if (dk) TH.off = false; }
    if (dk) setTimeout(() => this.draw(), 0); // 화면은 다시 다크로
    const cv = this.cv, g = this.geo;
    if (!cv || cv.width < 20 || !g) return cv;
    const dpr = this.dpr, out = document.createElement('canvas');
    out.width = cv.width; out.height = cv.height + Math.round(S.FOOT * dpr);
    const c = out.getContext('2d');
    c.drawImage(cv, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, cv.height);
    S.scaleStrip(c, cv.width / dpr, 0, g.sc, this.title(), this.flip ? '반대쪽에서 본 단면' : '');
    return out;
  };

  S._arrow = function (ctx, x, y, away, line, dark) {
    ctx.fillStyle = line ? '#000' : dark ? 'rgba(245,245,250,0.85)' : 'rgba(28,28,30,0.6)';
    ctx.beginPath();
    if (away) { ctx.moveTo(x, y - 5); ctx.lineTo(x + 4.5, y + 1); ctx.lineTo(x + 1.5, y + 1); ctx.lineTo(x + 1.5, y + 5); ctx.lineTo(x - 1.5, y + 5); ctx.lineTo(x - 1.5, y + 1); ctx.lineTo(x - 4.5, y + 1); }
    else { ctx.moveTo(x, y + 5); ctx.lineTo(x + 4.5, y - 1); ctx.lineTo(x + 1.5, y - 1); ctx.lineTo(x + 1.5, y - 5); ctx.lineTo(x - 1.5, y - 5); ctx.lineTo(x - 1.5, y - 1); ctx.lineTo(x - 4.5, y - 1); }
    ctx.closePath(); ctx.fill();
  };

  /* ---------- 판정·조작 ---------- */
  S.hit = function (x, y) {
    const g = this.geo; if (!g) return null;
    for (const p of g.pipes) if (Math.hypot(x - p.x, y - p.y) <= p.r + 5) return { kind: 'pipe', id: p.u.id, p };
    if (y > g.colTop - 4 && y < g.colBot + 4) {
      const bs = g.bands;
      for (let i = 0; i <= bs.length; i++) {
        const bx = i === 0 ? bs[0].x0 : bs[i - 1].x1;
        if (Math.abs(x - bx) <= 6) return { kind: 'div', i, x: bx };
      }
      for (const q of bs) if (x >= q.x0 && x <= q.x1) return { kind: 'band', id: q.b.seg.id, q };
    }
    if (y < g.gy) {
      if (x < g.xL && g.sideGeo.L && g.sideGeo.L.sd) return { kind: 'side', side: 'L' };
      if (x > g.xR && g.sideGeo.R && g.sideGeo.R.sd) return { kind: 'side', side: 'R' };
    }
    return null;
  };

  S._bind = function () {
    const cv = this.cv, app = this.app;
    const pos = (e) => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left; return [this.flip ? this.W - x : x, e.clientY - r.top]; }; // 뒤집어 그렸으면 누른 자리도 뒤집는다
    cv.addEventListener('pointerdown', (e) => {
      if (!app.state.secSeen) { app.state.secSeen = true; if (UDS.ui && app.state.tab === 'props' && !app.state.sel) setTimeout(() => UDS.ui.pane(), 0); } // 작업 순서: 가로 단면을 살펴봄
      if (e.button !== undefined && e.button > 0) return;
      const [x, y] = pos(e);
      cv.classList.add('pf'); // 눌러서 받은 초점에는 테두리를 그리지 않는다(자판으로 옮겨 온 초점에만 그림)
      try { cv.focus({ preventScroll: true }); } catch (err) { /* 무시 */ }
      const h = this.hit(x, y);
      const road = app.secRoad();
      if (!h || !road) { this.drag = null; return; }
      cv.setPointerCapture(e.pointerId);
      this.drag = { ...h, kind0: h.kind, sx: x, sy: y, moved: false, x: h.x };
      if (h.kind === 'div') this.drag.w0 = road.segs.map((s) => s.w);
      if (h.kind === 'pipe') { const u = road.utils.find((z) => z.id === h.id); this.drag.u0 = { off: u.off, depth: u.depth }; }
      e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      const d = this.drag, g = this.geo;
      if (!d) {
        const h = this.hit(x, y);
        const key = h ? h.kind + (h.id || h.i || h.side || '') : '';
        const prev = this.hover ? this.hover.kind + (this.hover.id || this.hover.i || this.hover.side || '') : '';
        this.hover = h;
        cv.style.cursor = !h ? 'default' : h.kind === 'div' ? 'ew-resize' : h.kind === 'pipe' ? 'grab' : 'pointer';
        if (key !== prev) this.draw();
        return;
      }
      if (!g) return;
      if (!d.moved && Math.hypot(x - d.sx, y - d.sy) < 4) return;
      d.moved = true;
      const road = app.secRoad();
      const step = e.shiftKey || e.altKey ? 0.05 : 0.25;
      const snap = (v, s) => Math.round(v / s) * s;
      if (d.kind === 'div') {
        const segs = road.segs, n = segs.length, i = d.i;
        const dm = (x - d.sx) / g.sc;
        const MINW = 0.25;
        if (i === 0) {
          const half = Math.abs(g.cx - x) / g.sc;
          const W0 = d.w0.reduce((a, b) => a + b, 0);
          segs[0].w = Math.max(MINW, snap(d.w0[0] + (half * 2 - W0), step));
        } else if (i === n) {
          const half = Math.abs(x - g.cx) / g.sc;
          const W0 = d.w0.reduce((a, b) => a + b, 0);
          segs[n - 1].w = Math.max(MINW, snap(d.w0[n - 1] + (half * 2 - W0), step));
        } else {
          let a = snap(d.w0[i - 1] + dm, step);
          const sum = d.w0[i - 1] + d.w0[i];
          a = U.clamp(a, MINW, sum - MINW);
          segs[i - 1].w = U.round(a, 2); segs[i].w = U.round(sum - a, 2);
        }
        app.liveChange();
        const lay = Dv.layout(road);
        d.x = i === 0 ? g.cx - (lay.W / 2) * g.sc : g.cx - lay.bands[i - 1].oR * g.sc;
        this.draw();
      } else if (d.kind === 'pipe') {
        const u = road.utils.find((z) => z.id === d.id);
        if (!u) return;
        u.off = U.round(snap(d.u0.off - (x - d.sx) / g.sc, 0.1), 2);
        u.depth = U.round(U.clamp(snap(d.u0.depth + (y - d.sy) / g.sc, 0.1), 0.3, Math.max(1.2, (g.below || BELOW) - 0.3)), 2);
        cv.style.cursor = 'grabbing';
        app.liveChange();
        this.draw();
      }
    });
    const up = (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      if (d.moved) { app.commit(d.kind === 'pipe' ? '관로 위치 변경' : '구간 폭 변경'); return; }
      if (d.kind === 'band') app.selectSeg(d.id);
      else if (d.kind === 'pipe') app.selectUtil(d.id);
      else if (d.kind === 'side') { const g = this.geo.sideGeo[d.side]; if (g && g.sd) app.select(g.sd.ctx ? { type: 'ctx', id: g.sd.ctx } : { type: g.sd.building ? 'building' : 'lot', id: g.sd.lot.id }, { keepSection: true }); }
      else if (d.kind === 'div') { /* 눌렀다 뗌: 변화 없음 */ }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (!this.drag && this.hover) { this.hover = null; this.draw(); } });
    cv.addEventListener('blur', () => cv.classList.remove('pf'));
    cv.addEventListener('keydown', (e) => {
      const road = app.secRoad(); if (!road) return;
      const st = app.state;
      const i = road.segs.findIndex((s) => s.id === st.selSeg);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const left = (e.key === 'ArrowLeft') !== !!this.flip; // 뒤집어 보면 화면의 왼쪽이 반대
        const j = i < 0 ? 0 : U.clamp(i + (left ? -1 : 1), 0, road.segs.length - 1);
        app.selectSeg(road.segs[j].id); e.preventDefault();
      } else if (i >= 0 && (e.key === '+' || e.key === '=' || e.key === '-')) {
        road.segs[i].w = Math.max(0.25, U.round(road.segs[i].w + (e.key === '-' ? -0.25 : 0.25), 2)); app.changed('구간 폭 변경'); e.preventDefault();
      } else if (e.key === 'Delete' || e.key === 'Backspace') { app.deleteSelected(); e.preventDefault(); } // 고른 구간·관, 또는 옆 건물
    });
  };

  UDS.Section = Section;
  UDS.SEG_SHORT = SHORT;
})(typeof window !== 'undefined' ? window : globalThis);
