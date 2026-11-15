/* Urbify — 이미지로 벽 재료 만들기
   사진·그림 한 장을 벽 재료의 무늬로 쓴다: 512×512로 줄여(JPEG) 프로젝트에 담고, 무늬 크기(그림 한 장이 벽에서 덮는 가로×세로 m)만큼
   되풀이해 3D·단면에 칠한다. 창·1층·간판은 그 위에 그대로 그린다. 평균색은 멀리서 볼 때·그림을 못 쓰는 곳에서 벽 색으로 쓴다 */
(function (root) {
  'use strict';
  const UDS = root.UDS, U = UDS.U, C = UDS.C;
  const X = {};
  const PW = 330, PH = 236; // 미리보기 크기(CSS px)
  let st = null, done = null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = (v) => Math.round(v * 100) / 100;

  /* 그림 읽기 → 정사각형으로 줄이기(가로세로 비는 무늬 크기로 되살린다) · 평균색 */
  function load(file, d) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { msg(d, '그림 파일(JPG·PNG·WebP)을 넣어 주세요.'); return; }
    if (file.size > 25e6) { msg(d, '25MB 이하의 그림을 넣어 주세요.'); return; }
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      const S = C.CMAT_PX, cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); // 투명한 곳은 흰 바탕
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(im, 0, 0, S, S);
      const sm = document.createElement('canvas'); sm.width = sm.height = 24;
      const g2 = sm.getContext('2d'); g2.imageSmoothingQuality = 'high'; g2.drawImage(cv, 0, 0, 24, 24);
      const px = g2.getImageData(0, 0, 24, 24).data, sum = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) { sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2]; }
      const n = px.length / 4;
      const asp = (im.naturalWidth || 1) / (im.naturalHeight || 1);
      const W = 2, H = r2(U.clamp(W / asp, 0.05, 50));
      st = {
        cv, url: cv.toDataURL('image/jpeg', 0.85), color: U.rgbToHex(sum.map((v) => v / n / 255)),
        file: file.name, name: (file.name || '').replace(/\.[^.]+$/, '').trim().slice(0, 16) || '이미지 재료',
        tile: [W, H], ratio: W / H, lock: true, mirror: false, mir: null,
      };
      render();
    };
    im.onerror = () => { URL.revokeObjectURL(url); msg(d, '그림을 읽지 못했습니다. 다른 형식(JPG·PNG)으로 넣어 주세요.'); };
    im.src = url;
  }

  /* 거울 반복 미리보기용 2×2 그림(왼쪽 아래가 원래 그림) */
  function mirrorOf(cv) {
    const w = cv.width, h = cv.height, c = document.createElement('canvas');
    c.width = w * 2; c.height = h * 2;
    const g = c.getContext('2d');
    [[1, 1, 0, h], [-1, 1, 2 * w, h], [1, -1, 0, h], [-1, -1, 2 * w, h]].forEach(([sx, sy, tx, ty]) => { g.setTransform(sx, 0, 0, sy, tx, ty); g.drawImage(cv, 0, 0, w, h); });
    return c;
  }

  /* 벽 미리보기: 땅에서 위로 무늬를 되풀이하고, 첫 장의 테두리·1m 막대·사람(1.7m)으로 크기를 가늠하게 한다 */
  function draw(d) {
    const cv = d.querySelector('[data-md="cv"]'); if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(PW * dpr); cv.height = Math.round(PH * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, PW, PH);
    if (!st) return;
    const tw = st.tile[0], th = st.tile[1];
    const Wm = Math.max(6, tw * 2.4, th * 2.4 * PW / PH), sc = PW / Wm; // px/m
    const img = st.mirror ? (st.mir || (st.mir = mirrorOf(st.cv))) : st.cv, k = st.mirror ? 2 : 1;
    const pat = g.createPattern(img, 'repeat');
    pat.setTransform(new DOMMatrix([tw * k * sc / img.width, 0, 0, th * k * sc / img.height, 0, PH]));
    g.fillStyle = pat; g.fillRect(0, 0, PW, PH);
    // 첫 장(왼쪽 아래)의 테두리
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.strokeRect(0.75, PH - th * sc + 0.75, tw * sc - 1.5, th * sc - 1.5);
    g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeStyle = '#0f6f61'; g.strokeRect(0.75, PH - th * sc + 0.75, tw * sc - 1.5, th * sc - 1.5); g.setLineDash([]);
    // 사람 1.7m
    const hx = PW - 0.75 * sc, hy = PH, hh = 1.7 * sc;
    g.fillStyle = 'rgba(28,32,38,0.82)';
    g.beginPath(); g.arc(hx, hy - hh + 0.11 * sc, 0.11 * sc, 0, Math.PI * 2); g.fill();
    g.beginPath();
    g.moveTo(hx - 0.2 * sc, hy - hh + 0.26 * sc); g.lineTo(hx + 0.2 * sc, hy - hh + 0.26 * sc); g.lineTo(hx + 0.17 * sc, hy - 0.8 * sc);
    g.lineTo(hx + 0.12 * sc, hy); g.lineTo(hx + 0.02 * sc, hy); g.lineTo(hx, hy - 0.72 * sc); g.lineTo(hx - 0.02 * sc, hy); g.lineTo(hx - 0.12 * sc, hy); g.lineTo(hx - 0.17 * sc, hy - 0.8 * sc);
    g.closePath(); g.fill();
    // 1m 막대
    const bx = 8, by = 12;
    g.fillStyle = 'rgba(255,255,255,0.88)'; g.fillRect(bx - 4, by - 9, sc + 30, 15);
    g.fillStyle = '#1c2026'; g.fillRect(bx, by, sc, 2.5); g.fillRect(bx, by - 3, 1.2, 8.5); g.fillRect(bx + sc - 1.2, by - 3, 1.2, 8.5);
    g.font = '600 10px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText('1 m', bx + sc + 5, by + 1);
  }

  function body() {
    const has = !!st;
    const num = (k, v) => `<span class="num"><input type="number" inputmode="decimal" data-md="${k}" value="${has ? v : ''}" min="0.05" max="50" step="0.05"${has ? '' : ' disabled'} aria-label="${k === 'w' ? '무늬 가로' : '무늬 세로'}"><i>m</i></span>`;
    return `<div class="md">` +
      `<div class="mdv${has ? '' : ' empty'}" data-md="drop"><canvas data-md="cv" style="width:${PW}px;height:${PH}px"${has ? '' : ' hidden'}></canvas>` +
      (has ? '' : `<p>그림을 여기에 끌어 놓거나<br><label class="btn sm">그림 고르기<input type="file" accept="image/*" data-md="file" hidden></label></p>`) + '</div>' +
      `<div class="mdc">` +
      `<div class="airf"><span>그림</span><span class="airfile"><label class="btn sm">${has ? '바꾸기' : '그림 고르기'}<input type="file" accept="image/*" data-md="file" hidden></label><span class="mut">${has ? esc(st.file) : 'JPG·PNG·WebP'}</span></span></div>` +
      `<label class="airf"><span>이름</span><input type="text" data-md="name" maxlength="20" value="${has ? esc(st.name) : ''}"${has ? '' : ' disabled'}></label>` +
      `<div class="airf"><span>무늬 크기</span><span class="mdsz">${num('w', has ? st.tile[0] : 0)}<i>×</i>${num('h', has ? st.tile[1] : 0)}</span></div>` +
      `<label class="airchk"><input type="checkbox" data-md="lock"${!has || st.lock ? ' checked' : ''}${has ? '' : ' disabled'}> 가로세로 비 고정</label>` +
      `<label class="airchk"><input type="checkbox" data-md="mirror"${has && st.mirror ? ' checked' : ''}${has ? '' : ' disabled'}> 거울 반복(한 장 건너 뒤집어 이음매를 숨김)</label>` +
      `<div class="airf"><span>평균색</span><span class="mdcol">${has ? `<i style="background:${st.color}"></i><code>${st.color}</code>` : '<span class="mut">그림을 넣으면 정함</span>'}</span></div>` +
      `<p class="mut mdn">무늬 크기는 그림 한 장이 벽에서 덮는 실제 크기입니다. 점선 칸이 한 장, 사람은 1.7m. 창·1층·간판은 무늬 위에 그리고, 멀리서 보거나 그림을 쓰지 못하는 곳에서는 평균색으로 칠합니다. 그림은 ${C.CMAT_PX}×${C.CMAT_PX}로 줄여 프로젝트에 담습니다.</p>` +
      `<p class="err" data-md="msg" hidden></p>` +
      `</div></div>`;
  }
  const msg = (d, s) => { const m = d && d.querySelector('[data-md="msg"]'); if (!m) { if (s) UDS.ui.toast(s); return; } m.hidden = !s; m.textContent = s || ''; };

  function render() {
    const d = UDS.ui.dialog('이미지로 벽 재료 만들기', body(), `<button class="btn pri" data-md-go${st ? '' : ' disabled'}>재료 만들기</button><button class="btn" data-act="closedlg">취소</button>`);
    const dlg = d.querySelector('.dlg'); if (dlg) dlg.classList.add('mdw');
    wire(d);
    draw(d);
  }

  function wire(d) {
    d.querySelectorAll('[data-md="file"]').forEach((el) => el.addEventListener('change', () => load(el.files && el.files[0], d)));
    const zone = d.querySelector('[data-md="drop"]');
    if (zone) {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; load(f, d); });
    }
    if (!st) return;
    const iw = d.querySelector('[data-md="w"]'), ih = d.querySelector('[data-md="h"]');
    const size = (which) => {
      let w = parseFloat(iw.value), h = parseFloat(ih.value);
      if (which === 'w' && w > 0) { w = U.clamp(w, 0.05, 50); if (st.lock) { h = r2(U.clamp(w / st.ratio, 0.05, 50)); ih.value = h; } }
      if (which === 'h' && h > 0) { h = U.clamp(h, 0.05, 50); if (st.lock) { w = r2(U.clamp(h * st.ratio, 0.05, 50)); iw.value = w; } }
      if (w > 0 && h > 0) { st.tile = [w, h]; if (!st.lock) st.ratio = w / h; draw(d); }
    };
    iw.addEventListener('input', () => size('w')); ih.addEventListener('input', () => size('h'));
    d.querySelector('[data-md="lock"]').addEventListener('change', (e) => { st.lock = e.target.checked; st.ratio = st.tile[0] / st.tile[1]; });
    d.querySelector('[data-md="mirror"]').addEventListener('change', (e) => { st.mirror = e.target.checked; draw(d); });
    d.querySelector('[data-md="name"]').addEventListener('input', (e) => { st.name = e.target.value; });
    const go = d.querySelector('[data-md-go]');
    if (go) go.addEventListener('click', () => create(d));
  }

  function create(d) {
    const app = UDS.app;
    if (!st) return;
    const [w, h] = st.tile;
    if (!(w >= 0.05 && w <= 50 && h >= 0.05 && h <= 50)) { msg(d, '무늬 크기는 0.05~50m 사이로 넣어 주세요.'); return; }
    const id = app.addMat({ name: (st.name || '').trim() || '이미지 재료', tile: [w, h], mirror: st.mirror, color: st.color }, st.url);
    if (!id) { msg(d, `이미지 재료는 프로젝트마다 ${C.CMAT_MAX}개까지 만들 수 있습니다.`); return; }
    const col = st.color, cb = done;
    st = null; done = null;
    UDS.ui.closeDialog();
    if (cb) cb(id, col); else app.changed();
    UDS.ui.toast('재료를 만들었습니다. 무늬 크기·거울 반복은 오른쪽 입면 항목에서 고칩니다.');
  }

  /* onDone(id, 평균색): 만든 재료를 고르던 건물에 입힌다 */
  X.open = function (onDone) { st = null; done = onDone || null; render(); };
  X.state = () => st; // 시험용
  UDS.MatDlg = X;
})(typeof window !== 'undefined' ? window : globalThis);
