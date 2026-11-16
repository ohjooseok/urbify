/* Urbify — 화면 테마(다크 기본 · 라이트 · 시스템 설정 따름)
   다크 테마는 틀(메뉴·패널·막대·대화상자)만 어둡게 하고, 그림(평면·3D·가로 단면·지도)은 라이트 그대로 그린다.
   화면 요소의 색은 CSS 변수(:root[data-theme])로 바꾼다.
   그림까지 어둡게 그리는 길(TH.ink = true)도 남겨 둔다: 2D 문맥의 fillStyle·strokeStyle·shadowColor와 그러데이션 색을 가로채 다크용 색으로 옮긴다.
   - 무채색: 밝기를 뒤집는다(종이 → 어두운 바탕, 먹 → 밝은 글자). 반투명한 검정(그림자·덮개)은 어둡게 두고 흰 반투명은 어둡게 뒤집는다
   - 유채색: 옅은 채움(토지이용 등)은 어둡게 낮추고, 진한 색(글자·선)은 밝게 올린다. 색상은 그대로
   그림 내보내기(PNG·SVG)는 언제나 라이트(TH.off) */
(function (G) {
  'use strict';
  const UDS = G.UDS;
  const LS = 'uds.theme';
  const TH = { pref: 'dark', dark: true, off: false, ink: false, ver: 0 }; // ink: 그림도 어둡게(지금은 쓰지 않음)
  TH.inkOn = () => TH.dark && TH.ink && !TH.off;
  const mq = G.matchMedia ? G.matchMedia('(prefers-color-scheme: dark)') : null;
  try { const v = localStorage.getItem(LS); if (v === 'light' || v === 'dark' || v === 'system') TH.pref = v; } catch (e) { /* 저장 공간 없음 */ }
  const want = () => (TH.pref === 'system' ? !!(mq && mq.matches) : TH.pref === 'dark');

  /* ---------- 색 바꾸기(OKLab) ---------- */
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  function toLab(r, g, b) {
    r = lin(r); g = lin(g); b = lin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function toRgb(L, a, b) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    const c = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    return c.map((v) => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, v))))) * 255));
  }
  /* 다크용 색: [r,g,b](0~1), 알파, 글자 여부 → [r,g,b](0~255) 또는 null(그대로) */
  function darkOf(r, g, b, al, text) {
    const [L, A, B] = toLab(r, g, b), C = Math.hypot(A, B);
    if (C < 0.02) {
      if (al < 0.5 && L < 0.3) return null; // 그림자·덮개로 쓰는 반투명 검정은 그대로
      if (text) return L >= 0.9 ? null : toRgb(Math.min(0.93, 1.0 - L * 0.5), A * 0.4 - 0.003, B * 0.4 - 0.01); // 글자: 흰 글자는 그대로, 나머지는 밝게(대비 유지)
      return toRgb(0.2 + (1 - L) * 0.74, A * 0.4 - 0.004, B * 0.4 - 0.014); // 무채색 면·선: 밝기를 뒤집고 살짝 푸른 쪽으로
    }
    if (text) return toRgb(Math.max(L, 1.08 - L, 0.66), A * 1.02, B * 1.02); // 색 글자: 밝게
    if (L > 0.62) return toRgb(0.4 + (L - 0.62) * 0.62, A * 1.02, B * 1.02); // 옅은 채움(토지이용 등): 어둡게, 색은 살림
    return toRgb(Math.max(L, 1.06 - L), A * 1.02, B * 1.02); // 진한 색(선·기호): 밝게
  }
  /* 캔버스가 이해하는 아무 색 문자열이든 [r,g,b,a]로 */
  let pc = null;
  function parse(s) {
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
    if (m) { let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]; return [+m[1], +m[2], +m[3], a]; }
    if (!pc) { const c = document.createElement('canvas'); c.width = c.height = 1; pc = c.getContext('2d'); }
    pc.fillStyle = '#000'; pc.fillStyle = s; // 이름·hsl 등은 캔버스에 맡겨 정규화
    const v = pc.fillStyle;
    return v === s ? null : parse(v);
  }
  const CACHE = new Map(), TCACHE = new Map(), MAPPED = new Set(), REV = new Map(); // REV: 바꾼 색 → 라이트 기준 원래 색
  const fmt = (d, a) => (a >= 1 ? '#' + d.map((x) => x.toString(16).padStart(2, '0')).join('') : `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${+a.toFixed(3)})`);
  /* 라이트 기준 색 → 지금 테마의 색(text: 글자에 쓰는 색) */
  TH.c = function (s, text) {
    if (!TH.inkOn() || typeof s !== 'string') return s;
    if (MAPPED.has(s)) return s; // 이미 바꾼 색(되읽어 다시 넣는 경우)
    const C = text ? TCACHE : CACHE;
    let v = C.get(s);
    if (v === undefined) {
      const p = parse(s.trim());
      v = s;
      if (p && p[3] > 0) { const d = darkOf(p[0] / 255, p[1] / 255, p[2] / 255, p[3], !!text); if (d) v = fmt(d, p[3]); }
      C.set(s, v); MAPPED.add(v); if (!text && !REV.has(v)) REV.set(v, s);
    }
    return v;
  };
  /* [r,g,b](0~1) 배열용: 3D 바탕 등 */
  TH.rgb = function (c) {
    if (!TH.inkOn()) return c;
    const d = darkOf(c[0], c[1], c[2], 1, false);
    return d ? d.map((x) => x / 255) : c;
  };

  /* ---------- 2D 문맥 가로채기 ---------- */
  const PRO = G.CanvasRenderingContext2D && G.CanvasRenderingContext2D.prototype;
  const desc = (k) => PRO && Object.getOwnPropertyDescriptor(PRO, k);
  const D = { fillStyle: desc('fillStyle'), strokeStyle: desc('strokeStyle'), shadowColor: desc('shadowColor') };
  TH.wrap = function (g) {
    if (!g || g.__th || !PRO || !(g instanceof G.CanvasRenderingContext2D)) return g;
    g.__th = true;
    // 글자는 면보다 대비를 세게: 채움 색의 원래 값(라이트 기준)을 기억해 두었다가 글자를 쓸 때 글자용으로 바꿔 쓴다
    let fo = null; const stk = [];
    Object.keys(D).forEach((k) => {
      const d = D[k]; if (!d) return;
      Object.defineProperty(g, k, {
        configurable: true,
        get() { return d.get.call(this); },
        set(v) {
          const str = typeof v === 'string', orig = str ? (MAPPED.has(v) ? REV.get(v) || null : v) : null; // 되읽은 색이면 원래 색을 찾아 둔다
          if (k === 'fillStyle') fo = orig;
          d.set.call(this, str ? TH.c(v) : v);
          if (TH.inkOn() && str) { const nv = d.get.call(this); if (!MAPPED.has(nv)) MAPPED.add(nv); if (orig && !REV.has(nv)) REV.set(nv, orig); }
        },
      });
    });
    const sv = g.save, rs = g.restore;
    g.save = function () { stk.push(fo); return sv.call(this); };
    g.restore = function () { if (stk.length) fo = stk.pop(); return rs.call(this); };
    const ft = g.fillText;
    g.fillText = function () {
      if (TH.inkOn() && fo) { const cur = D.fillStyle.get.call(this), tc = TH.c(fo, true); if (tc !== cur) { D.fillStyle.set.call(this, tc); try { return ft.apply(this, arguments); } finally { D.fillStyle.set.call(this, cur); } } }
      return ft.apply(this, arguments);
    };
    const wg = (gr) => { const a = gr.addColorStop; gr.addColorStop = function (o, c) { return a.call(this, o, TH.c(c)); }; return gr; };
    ['createLinearGradient', 'createRadialGradient', 'createConicGradient'].forEach((k) => { const f = g[k]; if (typeof f === 'function') g[k] = function () { return wg(f.apply(this, arguments)); }; });
    return g;
  };

  /* ---------- 적용 ---------- */
  TH.apply = function () {
    TH.dark = want();
    const de = document.documentElement;
    de.dataset.theme = TH.dark ? 'dark' : 'light';
    TH.ver++;
    const app = UDS.app;
    if (app && app.P && app.refresh) app.refresh(); // 화면 요소(견본 색 등)와 평면·3D·단면을 새 테마로 다시 그림
  };
  TH.set = function (p) {
    TH.pref = p === 'light' || p === 'system' ? p : 'dark';
    try { localStorage.setItem(LS, TH.pref); } catch (e) { /* 무시 */ }
    TH.apply();
  };
  TH.toggle = function () { TH.set(TH.dark ? 'light' : 'dark'); };
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (TH.pref === 'system') TH.apply(); });
  TH.dark = want();
  document.documentElement.dataset.theme = TH.dark ? 'dark' : 'light';
  UDS.TH = TH;
})(typeof window !== 'undefined' ? window : globalThis);
