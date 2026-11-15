/* Urbify — 캔버스 그리기 명령을 SVG로 받아 적는 문맥
 * 단면처럼 캔버스 2D 명령으로 직접 그리는 그림을, 같은 코드로 벡터 파일에 옮기기 위한 것.
 * 이 도구가 쓰는 명령만 다룬다: 경로·채우기·선·잘라내기·글자·그라디언트·변환.
 * 좌표는 그리는 순간의 변환을 미리 곱해 화면 좌표로 적으므로, 결과물에는 변환 속성이 거의 남지 않는다. */
(function (G) {
  'use strict';
  const UDS = G.UDS;
  const TAU = Math.PI * 2;
  const f2 = (v) => { const r = Math.round(v * 100) / 100; return r === 0 ? '0' : String(r); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* 색 → [색 문자열, 불투명도]. rgba()와 8자리 16진수는 편집 프로그램이 읽지 못하는 경우가 있어 나눠 적는다 */
  function color(c) {
    if (!c || c === 'transparent' || c === 'none') return ['none', 1];
    const s = String(c).trim();
    let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(s);
    if (m) return [`rgb(${Math.round(+m[1])},${Math.round(+m[2])},${Math.round(+m[3])})`, m[4] === undefined ? 1 : Math.max(0, Math.min(1, +m[4]))];
    m = /^#([0-9a-f]{8})$/i.exec(s);
    if (m) return ['#' + m[1].slice(0, 6), parseInt(m[1].slice(6), 16) / 255];
    return [s, 1];
  }

  function Grad(type, a) { this.type = type; this.a = a; this.stops = []; }
  Grad.prototype.addColorStop = function (o, c) { this.stops.push([o, c]); };
  /* 그림 무늬(createPattern): 그림은 defs에 한 번만 넣고 무늬마다 다시 쓴다 */
  function Pat(img) { this.img = img; this.m = [1, 0, 0, 1, 0, 0]; }
  Pat.prototype.setTransform = function (t) { if (t) this.m = [t.a, t.b, t.c, t.d, t.e, t.f]; };

  const STYLE = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha', 'font', 'textAlign', 'textBaseline', 'globalCompositeOperation'];

  function SvgCtx(w, h) {
    this.isSVG = true;
    this.W = w; this.H = h;
    this.canvas = { width: w, height: h };
    this.out = this._main = []; this.defs = []; this._n = 0;
    this._sec = null; this._ids = new Set(); // 레이어 덩어리
    this._m = [1, 0, 0, 1, 0, 0];
    this._dash = [];
    this._open = 0;        // 이 저장 단계에서 연 잘라내기 묶음 수
    this._stack = [];
    this._d = [];
    this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.lineCap = 'butt'; this.lineJoin = 'miter';
    this.globalAlpha = 1; this.font = '10px sans-serif'; this.textAlign = 'start'; this.textBaseline = 'alphabetic'; this.globalCompositeOperation = 'source-over';
    this._mc = null;
  }
  const P = SvgCtx.prototype;

  /* ---------- 변환 ---------- */
  P._pt = function (x, y) { const m = this._m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; };
  P._k = function () { const m = this._m; return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; };
  P._plain = function () { const m = this._m; return Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[0] - m[3]) < 1e-9 && m[0] > 0; };
  P.transform = function (a, b, c, d, e, f) {
    const m = this._m;
    this._m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];
  };
  P.setTransform = function (a, b, c, d, e, f) { this._m = [a, b, c, d, e, f]; };
  P.getTransform = function () { const m = this._m; return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }; };
  P.translate = function (x, y) { this.transform(1, 0, 0, 1, x, y); };
  P.scale = function (x, y) { this.transform(x, 0, 0, y, 0, 0); };
  P.rotate = function (a) { const c = Math.cos(a), s = Math.sin(a); this.transform(c, s, -s, c, 0, 0); };
  P.save = function () {
    const st = { m: this._m.slice(), dash: this._dash.slice(), open: this._open };
    STYLE.forEach((k) => { st[k] = this[k]; });
    this._stack.push(st); this._open = 0;
  };
  P.restore = function () {
    const st = this._stack.pop(); if (!st) return;
    for (let i = 0; i < this._open; i++) this.out.push('</g>');
    this._m = st.m; this._dash = st.dash; this._open = st.open;
    STYLE.forEach((k) => { this[k] = st[k]; });
  };

  /* ---------- 경로 ---------- */
  P.beginPath = function () { this._d = []; };
  P.moveTo = function (x, y) { const p = this._pt(x, y); this._d.push('M' + f2(p[0]) + ' ' + f2(p[1])); };
  P.lineTo = function (x, y) { const p = this._pt(x, y); this._d.push((this._d.length ? 'L' : 'M') + f2(p[0]) + ' ' + f2(p[1])); };
  P.closePath = function () { if (this._d.length) this._d.push('Z'); };
  P.quadraticCurveTo = function (cx, cy, x, y) { const c = this._pt(cx, cy), p = this._pt(x, y); this._d.push('Q' + f2(c[0]) + ' ' + f2(c[1]) + ' ' + f2(p[0]) + ' ' + f2(p[1])); };
  P.bezierCurveTo = function (ax, ay, bx, by, x, y) { const a = this._pt(ax, ay), b = this._pt(bx, by), p = this._pt(x, y); this._d.push('C' + f2(a[0]) + ' ' + f2(a[1]) + ' ' + f2(b[0]) + ' ' + f2(b[1]) + ' ' + f2(p[0]) + ' ' + f2(p[1])); };
  P.rect = function (x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); };
  /* 원호는 3차 곡선 조각으로 바꿔 적는다(변환에 뒤집기가 섞여도 모양이 유지됨) */
  P.ellipse = function (x, y, rx, ry, rot, a0, a1, ccw) {
    let sweep = a1 - a0;
    if (!ccw) { if (sweep >= TAU) sweep = TAU; else { sweep %= TAU; if (sweep < 0) sweep += TAU; } }
    else { if (sweep <= -TAU) sweep = -TAU; else { sweep %= TAU; if (sweep > 0) sweep -= TAU; } }
    const cr = Math.cos(rot || 0), sr = Math.sin(rot || 0);
    const at = (t, dx, dy) => { const px = rx * (Math.cos(t) + dx), py = ry * (Math.sin(t) + dy); return [x + px * cr - py * sr, y + px * sr + py * cr]; };
    const p0 = at(a0, 0, 0);
    this.lineTo(p0[0], p0[1]);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)), step = sweep / n, k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < n; i++) {
      const t0 = a0 + step * i, t1 = t0 + step;
      const c1 = at(t0, -k * Math.sin(t0), k * Math.cos(t0)), c2 = at(t1, k * Math.sin(t1), -k * Math.cos(t1)), p = at(t1, 0, 0);
      this.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p[0], p[1]);
    }
  };
  P.arc = function (x, y, r, a0, a1, ccw) { this.ellipse(x, y, r, r, 0, a0, a1, ccw); };

  /* ---------- 칠 ---------- */
  P._paint = function (style) {
    if (style instanceof Grad) {
      const id = 'g' + (++this._n), a = style.a, k = this._k();
      const stops = style.stops.map(([o, c]) => { const q = color(c); return `<stop offset="${f2(o)}" stop-color="${q[0]}"${q[1] < 1 ? ` stop-opacity="${f2(q[1])}"` : ''}/>`; }).join('');
      if (style.type === 'l') {
        const p0 = this._pt(a[0], a[1]), p1 = this._pt(a[2], a[3]);
        this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f2(p0[0])}" y1="${f2(p0[1])}" x2="${f2(p1[0])}" y2="${f2(p1[1])}">${stops}</linearGradient>`);
      } else {
        const p0 = this._pt(a[0], a[1]), p1 = this._pt(a[3], a[4]);
        this.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" fx="${f2(p0[0])}" fy="${f2(p0[1])}" cx="${f2(p1[0])}" cy="${f2(p1[1])}" r="${f2(a[5] * k)}">${stops}</radialGradient>`);
      }
      return [`url(#${id})`, 1];
    }
    if (style instanceof Pat) {
      const img = style.img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!this._imgs) this._imgs = new Map();
      let iid = this._imgs.get(img);
      if (!iid) {
        let url = '';
        try { url = img.toDataURL ? img.toDataURL('image/jpeg', 0.88) : img.src; } catch (e) { url = ''; }
        if (!url) return ['none', 1];
        iid = 'i' + (++this._n); this._imgs.set(img, iid);
        this.defs.push(`<image id="${iid}" width="${iw}" height="${ih}" href="${url}"/>`);
      }
      // 무늬 좌표 = 지금 변환 × 무늬 변환(이 문맥은 좌표를 화면 좌표로 미리 곱해 적으므로)
      const m = this._m, t = style.m, id = 'p' + (++this._n);
      const M = [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];
      this.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${iw}" height="${ih}" patternTransform="matrix(${M.map((v) => String(Math.round(v * 1e5) / 1e5)).join(' ')})"><use href="#${iid}"/></pattern>`);
      return [`url(#${id})`, 1];
    }
    return color(style);
  };
  P.createPattern = function (img) { return img ? new Pat(img) : null; };
  P._common = function () {
    let s = '';
    if (this.globalAlpha < 0.999) s += ` opacity="${f2(this.globalAlpha)}"`;
    if (this.globalCompositeOperation === 'lighter') s += ' style="mix-blend-mode:screen"';
    else if (this.globalCompositeOperation === 'multiply') s += ' style="mix-blend-mode:multiply"';
    return s;
  };
  P._fillAttr = function (rule) {
    const q = this._paint(this.fillStyle);
    return `fill="${q[0]}"${q[1] < 1 ? ` fill-opacity="${f2(q[1])}"` : ''}${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}`;
  };
  P._strokeAttr = function () {
    const q = this._paint(this.strokeStyle), k = this._k();
    let s = `fill="none" stroke="${q[0]}" stroke-width="${f2(Math.max(0.01, this.lineWidth * k))}"`;
    if (q[1] < 1) s += ` stroke-opacity="${f2(q[1])}"`;
    if (this.lineCap && this.lineCap !== 'butt') s += ` stroke-linecap="${this.lineCap}"`;
    if (this.lineJoin && this.lineJoin !== 'miter') s += ` stroke-linejoin="${this.lineJoin}"`;
    if (this._dash.length) s += ` stroke-dasharray="${this._dash.map((v) => f2(v * k)).join(' ')}"`;
    return s;
  };
  P.fill = function (rule) { if (this._d.length) this.out.push(`<path d="${this._d.join('')}" ${this._fillAttr(rule)}${this._common()}/>`); };
  P.stroke = function () { if (this._d.length) this.out.push(`<path d="${this._d.join('')}" ${this._strokeAttr()}${this._common()}/>`); };
  P.clip = function (rule) {
    const id = 'c' + (++this._n);
    this.defs.push(`<clipPath id="${id}"><path d="${this._d.join('')}"${rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
    this.out.push(`<g clip-path="url(#${id})">`);
    this._open++;
  };
  P._rectD = function (x, y, w, h) { const keep = this._d; this._d = []; this.rect(x, y, w, h); const d = this._d.join(''); this._d = keep; return d; };
  P.fillRect = function (x, y, w, h) { this.out.push(`<path d="${this._rectD(x, y, w, h)}" ${this._fillAttr()}${this._common()}/>`); };
  P.strokeRect = function (x, y, w, h) { this.out.push(`<path d="${this._rectD(x, y, w, h)}" ${this._strokeAttr()}${this._common()}/>`); };
  P.clearRect = function () {};
  P.setLineDash = function (a) { this._dash = (a || []).slice(); };
  P.getLineDash = function () { return this._dash.slice(); };
  P.createLinearGradient = function (x0, y0, x1, y1) { return new Grad('l', [x0, y0, x1, y1]); };
  P.createRadialGradient = function (x0, y0, r0, x1, y1, r1) { return new Grad('r', [x0, y0, r0, x1, y1, r1]); };

  /* ---------- 글자 ---------- */
  P._font = function () {
    const m = /^(?:(\d+|bold|normal)\s+)?([\d.]+)px\s+(.+)$/.exec(this.font) || [null, '400', '10', 'sans-serif'];
    return { w: m[1] || '400', size: parseFloat(m[2]), fam: m[3].replace(/['"]/g, '') };
  };
  P.measureText = function (s) {
    if (!this._mc) { try { this._mc = document.createElement('canvas').getContext('2d'); } catch (e) { this._mc = null; } }
    if (!this._mc) return { width: String(s).length * this._font().size * 0.6 };
    this._mc.font = this.font;
    return this._mc.measureText(s);
  };
  P._text = function (s, x, y, paint) {
    const ft = this._font();
    const anchor = this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' || this.textAlign === 'end' ? 'end' : 'start';
    const dy = { middle: 0.35, top: 0.8, hanging: 0.8, bottom: -0.2, ideographic: -0.2 }[this.textBaseline] || 0;
    let pos;
    if (this._plain()) { const p = this._pt(x, y), k = this._m[0]; pos = `x="${f2(p[0])}" y="${f2(p[1] + dy * ft.size * k)}" font-size="${f2(ft.size * k)}"`; }
    else { const m = this._m; pos = `transform="matrix(${m.map(f2).join(' ')})" x="${f2(x)}" y="${f2(y + dy * ft.size)}" font-size="${f2(ft.size)}"`; }
    this.out.push(`<text ${pos} font-family="${esc(ft.fam)}" font-weight="${ft.w}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} ${paint}${this._common()}>${esc(s)}</text>`);
  };
  P.fillText = function (s, x, y) { const q = this._paint(this.fillStyle); this._text(s, x, y, `fill="${q[0]}"${q[1] < 1 ? ` fill-opacity="${f2(q[1])}"` : ''}`); };
  P.strokeText = function (s, x, y) { this._text(s, x, y, this._strokeAttr()); };

  /* 그림(캔버스·이미지)은 벡터로 옮길 수 없으므로 그대로 끼워 넣는다. 가능한 한 쓰지 않는다 */
  P.drawImage = function (img, x, y, w, h) {
    let url = '';
    try { url = img.toDataURL ? img.toDataURL('image/png') : img.src; } catch (e) { url = ''; }
    if (!url) return;
    const iw = w === undefined ? img.width : w, ih = h === undefined ? img.height : h, m = this._m;
    this.out.push(`<image transform="matrix(${m.map(f2).join(' ')})" x="${f2(x)}" y="${f2(y)}" width="${f2(iw)}" height="${f2(ih)}" href="${url}"${this._common()}/>`);
  };

  /* 편집 프로그램(Inkscape·Illustrator 등)에서 레이어로 보이도록 그림을 덩어리로 나눈다(저장 단계 바깥에서만 부른다).
     group(id, label, subs): 새 덩어리를 연다. subs = [[id, label], ...]를 주면 그 안을 레이어 여럿으로 나누고 sub(id)로 옮겨 가며 그린다.
     같은 레이어에 든 것은 그린 차례가 섞여도 한데 모으고, 레이어는 subs 차례로 쌓는다. 빈 레이어는 적지 않는다 */
  P.group = function (id, label, subs) {
    this._flush();
    if (!id) return;
    const list = subs && subs.length ? subs : [[id, label || id]];
    this._sec = { order: list.map((q) => q[0]), map: new Map(list.map((q) => [q[0], { label: q[1] || q[0], out: [] }])) };
    this.out = this._sec.map.get(list[0][0]).out;
  };
  P.sub = function (id, label) {
    const sc = this._sec;
    if (!sc || this._stack.length || this._open) return; // 잘라내기·저장 단계 안에서는 옮기지 않는다(태그가 어긋나지 않게)
    let b = sc.map.get(id);
    if (!b) { b = { label: label || id, out: [] }; sc.map.set(id, b); sc.order.push(id); }
    this.out = b.out;
  };
  P._flush = function () {
    const sc = this._sec; if (!sc) return;
    this._sec = null; this.out = this._main;
    sc.order.forEach((k) => {
      const b = sc.map.get(k); if (!b.out.length) return;
      const base = k.replace(/[^A-Za-z0-9_-]/g, '_') || 'layer'; let id = base, n = 2; while (this._ids.has(id)) id = `${base}-${n++}`;
      this._ids.add(id);
      this.out.push(`<g id="${esc(id)}" inkscape:groupmode="layer" inkscape:label="${esc(b.label)}" data-name="${esc(b.label)}">`);
      for (let i = 0; i < b.out.length; i++) this.out.push(b.out[i]);
      this.out.push('</g>');
    });
  };
  /* o: {title, mmPerPx} — mmPerPx를 주면 인쇄 치수(mm)를 적어 축척에 맞는 도면이 된다 */
  P.toString = function (o) {
    o = o || {};
    while (this._stack.length) this.restore();
    this._flush();
    const size = o.mmPerPx ? `width="${f2(this.W * o.mmPerPx)}mm" height="${f2(this.H * o.mmPerPx)}mm"` : `width="${this.W}" height="${this.H}"`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ${size} viewBox="0 0 ${this.W} ${this.H}">` +
      (o.title ? `<title>${esc(o.title)}</title>` : '') + (o.desc ? `<desc>${esc(o.desc)}</desc>` : '') +
      `<defs>${this.defs.join('')}</defs>\n${this.out.join('\n')}\n</svg>`;
  };

  UDS.SvgCtx = SvgCtx;
})(typeof window !== 'undefined' ? window : globalThis);
