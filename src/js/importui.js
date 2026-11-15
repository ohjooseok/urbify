/* Urbify — 지도 캡처로 대상지 만들기(대화상자)
 * 그림을 넣고 → 범위·축척을 정하고 → 도시 유형을 고르면, 인식한 도로를 그림 위에 겹쳐 보여 준 뒤 대상지를 만든다. */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C, MI = UDS.MapImport, ui = UDS.ui, app = UDS.app, icon = UDS.icon;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = U.esc;
  const LATS = [['37.5', '서울·수도권 37.5°'], ['36.6', '세종·충청 36.6°'], ['35.8', '대구·전주 35.8°'], ['35.1', '부산·광주 35.1°'], ['33.5', '제주 33.5°']];
  const trim = (v, d) => U.fmt(v, d === undefined ? 1 : d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

  const st = { img: null, iw: 0, ih: 0, crop: [0, 0, 1, 1], mPerPx: null, scale: [], scaleDist: 100, mode: 'crop', sens: 0.5, picks: [], type: 'newtown', lat: 36.6, widthK: 1, grid: true, res: null, work: null, timer: 0, drag: null, name: '' };

  const MSG = {
    crop: '그림 위를 끌어 대상지로 삼을 범위를 정합니다. 검색창이나 단추가 있는 부분은 빼세요.',
    scale: '거리를 아는 두 점을 차례로 누르세요. 지도 축척 막대의 양 끝을 누르고 막대에 적힌 거리를 넣으면 됩니다.',
    pick: '도로가 잘 안 잡히면 그림에서 도로를 한두 곳 눌러 그 색을 도로로 지정합니다.',
  };

  ui.importDialog = function () {
    ui.closePop();
    const typeOpts = Object.keys(MI.TYPES).map((k) => `<option value="${k}"${k === st.type ? ' selected' : ''}>${MI.TYPES[k].name}</option>`).join('');
    const body = `<div class="imp">
      <div class="impl">
        <div class="impcv${st.img ? '' : ' empty'}" id="impBox">
          <div class="impdrop"><b>지도 캡처 그림 넣기</b>아래 [그림 고르기]를 누르거나, 그림을 여기로 끌어 놓거나, 붙여넣기(Ctrl+V) 하세요.<br>도로가 흰색·노란색으로 그려진 일반 지도 화면이 잘 읽힙니다. 지도는 위쪽이 북쪽이라고 봅니다.</div>
          <canvas id="impCv" aria-label="지도 그림과 인식한 도로"></canvas>
        </div>
        <div class="imptools">
          <label class="btn sm pri">${icon('image', 14)}그림 고르기<input type="file" accept="image/*" id="impFile" hidden></label>
          <div class="seg" role="group" aria-label="그림 위에서 할 일">
            <button data-imp-mode="crop" aria-pressed="${st.mode === 'crop'}">범위</button>
            <button data-imp-mode="scale" aria-pressed="${st.mode === 'scale'}">축척 두 점</button>
            <button data-imp-mode="pick" aria-pressed="${st.mode === 'pick'}">도로 색 찍기</button>
          </div>
          <button class="btn sm quiet" id="impFull">전체 범위</button>
        </div>
        <p class="impmsg" id="impMsg"></p>
      </div>
      <div class="impr">
        <div class="h"><b>축척</b><span class="hn">꼭 필요</span></div>
        <div class="row"><span class="lb">범위 가로 폭</span><span class="ctl"><span class="num"><input type="number" id="impW" min="30" max="5000" step="10" placeholder="예: 600" aria-label="범위 가로 폭(m)"><i>m</i></span></span><span class="note">직접 넣거나 [축척 두 점]으로 맞춥니다</span></div>
        <div class="row" id="impScaleRow" hidden><span class="lb">두 점 사이</span><span class="ctl"><span class="num"><input type="number" id="impD" min="1" max="5000" step="1" aria-label="두 점 사이 실제 거리(m)"><i>m</i></span></span></div>
        <div class="h"><b>대상지</b></div>
        <div class="row"><span class="lb">도시 유형</span><span class="ctl"><select id="impType" aria-label="도시 유형">${typeOpts}</select></span><span class="note" id="impTypeNote"></span></div>
        <div class="row"><span class="lb">위치(위도)</span><span class="ctl"><select id="impLat" aria-label="위치(위도)">${LATS.map(([v, n]) => `<option value="${v}"${+v === st.lat ? ' selected' : ''}>${n}</option>`).join('')}</select></span></div>
        <div class="h"><b>도로 인식</b></div>
        <div class="row"><span class="lb">민감도</span><span class="ctl"><span class="rg"><input type="range" id="impSens" min="0" max="1" step="0.05" value="${st.sens}" aria-label="도로 인식 민감도"><output id="impSensOut"></output></span></span></div>
        <div class="row"><span class="lb">도로 폭</span><span class="ctl"><select id="impK" aria-label="도로 폭 보정">${[['0.8', '그림보다 좁게(×0.8)'], ['1', '그림에서 잰 대로'], ['1.2', '그림보다 넓게(×1.2)']].map(([v, n]) => `<option value="${v}"${+v === st.widthK ? ' selected' : ''}>${n}</option>`).join('')}</select></span></div>
        <div class="row"><span class="lb">정리</span><span class="ctl"><label class="sw"><input type="checkbox" id="impGrid"${st.grid ? ' checked' : ''}><span>직각 격자에 가깝게 폄</span></label></span></div>
        <div class="row" id="impPickRow" hidden><span class="lb">찍은 도로 색</span><span class="ctl chips" id="impChips"></span></div>
        <div class="impsum" id="impSum"></div>
      </div>
    </div>`;
    const d = ui.dialog('지도 캡처로 대상지 만들기', body, '<button class="btn pri" id="impGo" disabled>대상지 만들기</button><button class="btn" data-act="closedlg">취소</button><span class="mut" style="font-size:11.5px">그림은 이 브라우저 안에서만 쓰이고 저장되지 않습니다.</span>');
    $('.dlg', d).classList.add('big');
    bind();
    syncForm();
    if (st.img) { draw(); schedule(0); }
  };

  function bind() {
    const cv = $('#impCv'), box = $('#impBox');
    $('#impFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) loadBlob(f, f.name); });
    box.addEventListener('dragover', (e) => { e.preventDefault(); });
    box.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) loadBlob(f, f.name); });
    if (!ui._impPaste) {
      ui._impPaste = true;
      document.addEventListener('paste', (e) => {
        if (!$('#impCv')) return;
        const items = (e.clipboardData && e.clipboardData.items) || [];
        for (const it of items) if (it.type && it.type.indexOf('image/') === 0) { const f = it.getAsFile(); if (f) { e.preventDefault(); loadBlob(f, '붙여 넣은 그림'); return; } }
      });
    }
    $$('[data-imp-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.impMode; if (st.mode === 'scale' && st.scale.length === 2) st.scale = []; syncForm(); draw(); }));
    $('#impFull').addEventListener('click', () => { st.crop = [0, 0, 1, 1]; schedule(0); draw(); });
    $('#impW').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (v > 0 && st.img) { st.mPerPx = v / cropPx()[2]; st.scale = []; schedule(0); syncForm(); } });
    $('#impD').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (v > 0) { st.scaleDist = v; applyScale(); } });
    $('#impType').addEventListener('change', (e) => { st.type = e.target.value; st.grid = st.type === 'newtown'; syncForm(); schedule(0); });
    $('#impLat').addEventListener('change', (e) => { st.lat = parseFloat(e.target.value); });
    $('#impSens').addEventListener('input', (e) => { st.sens = parseFloat(e.target.value); syncForm(); schedule(160); });
    $('#impK').addEventListener('change', (e) => { st.widthK = parseFloat(e.target.value); schedule(0); });
    $('#impGrid').addEventListener('change', (e) => { st.grid = e.target.checked; schedule(0); });
    $('#impChips').addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) { st.picks.splice(+b.dataset.pick, 1); syncForm(); schedule(0); } });
    $('#impGo').addEventListener('click', build);
    // 그림 위 조작
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [U.clamp((e.clientX - r.left) / r.width, 0, 1), U.clamp((e.clientY - r.top) / r.height, 0, 1)]; };
    cv.addEventListener('pointerdown', (e) => {
      if (!st.img) return;
      const p = pos(e);
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      st.drag = { a: p, b: p, moved: false };
      e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!st.drag) return;
      st.drag.b = pos(e);
      if (Math.hypot(st.drag.b[0] - st.drag.a[0], st.drag.b[1] - st.drag.a[1]) > 0.012) st.drag.moved = true;
      if (st.drag.moved) draw();
    });
    const up = (e) => {
      const dg = st.drag; st.drag = null;
      if (!dg || !st.img) return;
      if (e.type === 'pointercancel') { draw(); return; }
      const a = dg.a, b = dg.b;
      if (st.mode === 'crop') {
        if (dg.moved && Math.abs(b[0] - a[0]) > 0.08 && Math.abs(b[1] - a[1]) > 0.08) { st.crop = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; schedule(0); }
      } else if (st.mode === 'scale') {
        if (dg.moved) st.scale = [a, b]; else { if (st.scale.length >= 2) st.scale = []; st.scale.push(a); }
        if (st.scale.length === 2) applyScale();
      } else if (st.mode === 'pick') {
        const c = sample(a);
        if (c && st.picks.length < 6) { st.picks.push(c); schedule(0); }
      }
      syncForm(); draw();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  const cropPx = () => [st.crop[0] * st.iw, st.crop[1] * st.ih, (st.crop[2] - st.crop[0]) * st.iw, (st.crop[3] - st.crop[1]) * st.ih];
  function applyScale() {
    if (st.scale.length !== 2 || !st.img) return;
    const dpx = Math.hypot((st.scale[1][0] - st.scale[0][0]) * st.iw, (st.scale[1][1] - st.scale[0][1]) * st.ih);
    if (dpx < 4) return;
    st.mPerPx = st.scaleDist / dpx;
    syncForm(); schedule(0);
  }
  function sample(p) {
    const c = st.img.getContext('2d');
    const x = Math.round(p[0] * (st.iw - 1)), y = Math.round(p[1] * (st.ih - 1));
    let d;
    try { d = c.getImageData(U.clamp(x - 1, 0, st.iw - 3), U.clamp(y - 1, 0, st.ih - 3), 3, 3).data; } catch (e) { return null; }
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < 36; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    return [Math.round(r / 9), Math.round(g / 9), Math.round(b / 9)];
  }

  function loadBlob(blob, name) {
    const done = (src, w, h) => {
      const k = Math.min(1, 2200 / Math.max(w, h));
      const cv = document.createElement('canvas');
      cv.width = Math.max(8, Math.round(w * k)); cv.height = Math.max(8, Math.round(h * k));
      const c = cv.getContext('2d', { willReadFrequently: true });
      c.imageSmoothingQuality = 'high';
      c.drawImage(src, 0, 0, cv.width, cv.height);
      st.img = cv; st.iw = cv.width; st.ih = cv.height; st.name = name || '';
      st.scale = []; st.picks = []; st.mPerPx = null; st.res = null;
      // 화면 캡처의 흰 여백을 뺀 범위를 먼저 제안
      try {
        const kk = Math.min(1, 420 / Math.max(st.iw, st.ih));
        const t = document.createElement('canvas'); t.width = Math.max(8, Math.round(st.iw * kk)); t.height = Math.max(8, Math.round(st.ih * kk));
        const tc = t.getContext('2d'); tc.drawImage(cv, 0, 0, t.width, t.height);
        st.crop = MI.autoCrop(tc.getImageData(0, 0, t.width, t.height));
      } catch (e) { st.crop = [0, 0, 1, 1]; }
      const box = $('#impBox'); if (box) box.classList.remove('empty');
      syncForm(); draw(); schedule(0);
    };
    const fail = () => ui.toast('그림을 읽지 못했습니다. PNG나 JPG 캡처를 넣어 주세요.');
    if (G.createImageBitmap) { G.createImageBitmap(blob).then((bm) => done(bm, bm.width, bm.height), () => viaImg()); } else viaImg();
    function viaImg() {
      const url = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { done(im, im.naturalWidth, im.naturalHeight); URL.revokeObjectURL(url); };
      im.onerror = () => { URL.revokeObjectURL(url); fail(); };
      im.src = url;
    }
  }
  ui.importLoad = loadBlob; // 시험·확장용

  function schedule(ms) { clearTimeout(st.timer); st.timer = setTimeout(analyze, ms === undefined ? 200 : ms); }

  function analyze() {
    if (!st.img || !$('#impCv')) return;
    const cp = cropPx();
    const WORK = window.matchMedia('(max-width: 900px)').matches ? 600 : 760;
    const k = Math.min(1, WORK / Math.max(cp[2], cp[3]));
    const ww = Math.max(16, Math.round(cp[2] * k)), wh = Math.max(16, Math.round(cp[3] * k));
    const wc = document.createElement('canvas'); wc.width = ww; wc.height = wh;
    const c = wc.getContext('2d', { willReadFrequently: true });
    c.imageSmoothingQuality = 'high';
    c.drawImage(st.img, cp[0], cp[1], cp[2], cp[3], 0, 0, ww, wh);
    let img;
    try { img = c.getImageData(0, 0, ww, wh); } catch (e) { ui.toast('그림을 분석하지 못했습니다.'); return; }
    const widthM = st.mPerPx ? st.mPerPx * cp[2] : 500; // 축척을 모르면 일단 500m로 보고 미리 보기만
    const mpp = widthM / (ww - 1);
    const pk = st.picks.slice();
    try {
      st.res = MI.run(img, { mpp, sens: st.sens, picks: pk, grid: st.grid, widthK: st.widthK });
      st.work = { ww, wh, mpp, widthM };
    } catch (e) { console.error(e); st.res = null; }
    syncForm(); draw();
  }

  function syncForm() {
    if (!$('#impCv')) return;
    $$('[data-imp-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.impMode === st.mode ? 'true' : 'false'));
    $('#impMsg').textContent = st.img ? MSG[st.mode] : '';
    const sens = $('#impSensOut'); if (sens) sens.textContent = st.sens < 0.35 ? '낮음' : st.sens > 0.65 ? '높음' : '보통';
    $('#impTypeNote').textContent = MI.TYPES[st.type].desc;
    $('#impGrid').checked = st.grid;
    const w = $('#impW');
    if (document.activeElement !== w) w.value = st.mPerPx && st.img ? Math.round(st.mPerPx * cropPx()[2]) : '';
    $('#impScaleRow').hidden = st.scale.length !== 2;
    const dd = $('#impD'); if (document.activeElement !== dd) dd.value = st.scaleDist;
    $('#impPickRow').hidden = !st.picks.length;
    $('#impChips').innerHTML = st.picks.map((p, i) => `<span class="chip"><i style="background:rgb(${p.join(',')})"></i>${p.join(' ')}<button data-pick="${i}" aria-label="이 색 빼기">×</button></span>`).join('');
    // 요약
    const sum = $('#impSum'), go = $('#impGo');
    let h = '', warn = false, ok = false;
    if (!st.img) h = '그림을 넣으면 인식한 도로와 대상지 크기가 여기에 나옵니다.';
    else if (!st.res) h = '도로를 읽는 중입니다…';
    else {
      const r = st.res, n = r.streets.length;
      const cls = { 대로: 0, 중로: 0, '소로·골목': 0 };
      r.streets.forEach((s) => { const W = MI.widthClass(s.w, s.major); if (W >= 25) cls['대로']++; else if (W >= 12) cls['중로']++; else cls['소로·골목']++; });
      if (n < 2) { warn = true; h = '<b>도로를 거의 찾지 못했습니다.</b> [도로 색 찍기]로 그림의 도로를 한두 곳 눌러 주거나 민감도를 높여 보세요.'; }
      else {
        h = `<b>도로 ${n}개</b> · ${Object.keys(cls).filter((k) => cls[k]).map((k) => `${k} ${cls[k]}`).join(' · ')}`;
        if (st.mPerPx) {
          const ha = (r.site.w * r.site.h) / 10000;
          h += `<br>대상지 <b>${trim(r.site.w, 0)} × ${trim(r.site.h, 0)}m</b> (${trim(ha, 1)}ha) · 인식한 도로 폭 ${trim(Math.min(...r.streets.map((s) => s.w)), 0)}~${trim(Math.max(...r.streets.map((s) => s.w)), 0)}m`;
          ok = true;
          if (ha > 70 || n > 90) { warn = true; h += '<br>범위가 넓어 화면이 느려질 수 있습니다. 범위를 줄이는 편이 좋습니다.'; }
          else if (st.work && st.work.mpp > 2.3) { warn = true; h += '<br>축척이 작아 좁은 골목은 빠질 수 있습니다. 더 확대한 캡처가 정확합니다.'; }
          if (r.site.w < 60 || r.site.h < 60) { ok = false; warn = true; h += '<br>대상지가 너무 작습니다. 축척을 다시 확인하세요.'; }
        } else h += '<br><b>축척을 넣어 주세요.</b> 범위 가로 폭을 적거나 [축척 두 점]으로 맞추면 크기와 도로 폭이 정해집니다.';
        if (r.cls.landWhite && !st.picks.length) h += '<br>바탕이 흰 지도입니다. 도로가 빠졌다면 [도로 색 찍기]를 써 보세요.';
      }
    }
    sum.innerHTML = h; sum.classList.toggle('warn', warn);
    go.disabled = !ok;
  }

  function draw() {
    const cv = $('#impCv'); if (!cv || !st.img) return;
    const maxW = 1100, k = Math.min(1, maxW / st.iw);
    const W = Math.round(st.iw * k), H = Math.round(st.ih * k);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = cv.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(st.img, 0, 0, W, H);
    let cr = st.crop;
    if (st.drag && st.drag.moved && st.mode === 'crop') { const a = st.drag.a, b = st.drag.b; cr = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; }
    const x0 = cr[0] * W, y0 = cr[1] * H, cw = (cr[2] - cr[0]) * W, ch = (cr[3] - cr[1]) * H;
    // 범위 밖은 어둡게
    c.fillStyle = 'rgba(38,36,34,0.5)';
    c.fillRect(0, 0, W, y0); c.fillRect(0, y0 + ch, W, H - y0 - ch); c.fillRect(0, y0, x0, ch); c.fillRect(x0 + cw, y0, W - x0 - cw, ch);
    const lw = Math.max(1.5, W / 520);
    // 인식 결과(끌어서 범위를 바꾸는 중에는 감춤)
    if (st.res && st.work && !(st.drag && st.drag.moved && st.mode === 'crop')) {
      const r = st.res, ww = st.work.ww, wh = st.work.wh;
      const mk = document.createElement('canvas'); mk.width = ww; mk.height = wh;
      const mc = mk.getContext('2d'); const id = mc.createImageData(ww, wh);
      for (let i = 0, p = 0; i < ww * wh; i++, p += 4) if (r.mask[i]) { id.data[p] = 78; id.data[p + 1] = 176; id.data[p + 2] = 155; id.data[p + 3] = 96; }
      mc.putImageData(id, 0, 0);
      c.imageSmoothingEnabled = false; c.drawImage(mk, x0, y0, cw, ch); c.imageSmoothingEnabled = true;
      const T = (p) => [x0 + (p[0] / r.site.w) * cw, y0 + (1 - p[1] / r.site.h) * ch];
      c.lineJoin = 'round'; c.lineCap = 'round';
      r.streets.forEach((s) => {
        const Wc = MI.widthClass(s.w, s.major);
        c.beginPath(); s.pts.forEach((p, i) => { const q = T(p); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
        c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = lw * (Wc >= 25 ? 3.4 : Wc >= 12 ? 2.8 : 2.2); c.stroke();
        c.strokeStyle = Wc >= 25 ? C.THEME.coralDeep : Wc >= 12 ? C.THEME.apricotDeep : C.THEME.tealDeep; c.lineWidth = lw * (Wc >= 25 ? 2 : Wc >= 12 ? 1.5 : 1.1); c.stroke();
      });
    }
    // 범위 테두리
    c.strokeStyle = '#fff'; c.lineWidth = lw * 2; c.strokeRect(x0, y0, cw, ch);
    c.strokeStyle = C.THEME.tealDeep; c.lineWidth = lw; c.setLineDash([lw * 5, lw * 3]); c.strokeRect(x0, y0, cw, ch); c.setLineDash([]);
    // 축척 두 점
    let sp = st.scale;
    if (st.drag && st.drag.moved && st.mode === 'scale') sp = [st.drag.a, st.drag.b];
    if (sp.length) {
      const P = sp.map((p) => [p[0] * W, p[1] * H]);
      if (P.length === 2) { c.strokeStyle = '#fff'; c.lineWidth = lw * 3; c.beginPath(); c.moveTo(P[0][0], P[0][1]); c.lineTo(P[1][0], P[1][1]); c.stroke(); c.strokeStyle = C.THEME.coralInk; c.lineWidth = lw * 1.4; c.stroke(); }
      P.forEach((q) => { c.beginPath(); c.arc(q[0], q[1], lw * 4, 0, 7); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = C.THEME.coralInk; c.lineWidth = lw * 1.4; c.stroke(); });
      if (P.length === 2 && st.scale.length === 2) {
        const t = `${trim(st.scaleDist, 0)}m`; c.font = `700 ${Math.round(lw * 9)}px ${UDS.FONT}`; c.textAlign = 'center'; c.textBaseline = 'bottom';
        const mx = (P[0][0] + P[1][0]) / 2, my = Math.min(P[0][1], P[1][1]) - lw * 5;
        c.lineWidth = lw * 2.4; c.strokeStyle = '#fff'; c.strokeText(t, mx, my); c.fillStyle = C.THEME.coralInk; c.fillText(t, mx, my);
      }
    }
  }

  function build() {
    if (!st.res || !st.mPerPx) return;
    const go = $('#impGo'); if (go) { go.disabled = true; go.textContent = '만드는 중…'; }
    setTimeout(() => {
      let out = null;
      try { out = MI.build(st.res, { type: st.type, lat: st.lat, title: st.name && !/붙여/.test(st.name) ? st.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 30) : '가져온 지도' }); } catch (e) { console.error(e); out = null; }
      if (!out || !out.P.roads.length) {
        if (go) { go.disabled = false; go.textContent = '대상지 만들기'; }
        ui.toast('이 인식 결과로는 배치를 만들지 못했습니다. 민감도를 낮추거나 범위를 줄여 다시 해 보세요.');
        return;
      }
      // 견줘 볼 밑그림(범위만 잘라 둠). 작업 파일에는 넣지 않음
      try {
        const cp = cropPx(), k = Math.min(1, 1600 / Math.max(cp[2], cp[3]));
        const u = document.createElement('canvas'); u.width = Math.max(8, Math.round(cp[2] * k)); u.height = Math.max(8, Math.round(cp[3] * k));
        u.getContext('2d').drawImage(st.img, cp[0], cp[1], cp[2], cp[3], 0, 0, u.width, u.height);
        app.underlay = { img: u, w: out.P.site.w, h: out.P.site.h };
      } catch (e) { app.underlay = null; }
      app.state.layers.underlay = false;
      ui.closeDialog();
      app.load(out.P, { keepUnderlay: true });
      ui.toast(`도로 ${out.P.roads.length}개, 가구 ${out.D.blocks.length}개로 대상지를 만들었습니다. 레이어에서 [지도 밑그림]을 켜면 원래 그림과 견줘 볼 수 있습니다.`);
    }, 30);
  }
})(typeof window !== 'undefined' ? window : globalThis);
