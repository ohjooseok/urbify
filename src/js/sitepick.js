/* Urbify — 지도에서 대상지 고르기
 * 지도를 움직여 가운데 사각형(대상지 범위)을 실제 동네에 맞춘 뒤 [대상지 만들기]를 누르면, 그 범위의 건물과 도로망을 세운다.
 * 지도: MapLibre GL JS(BSD-3, 필요할 때만 불러옴) · 바탕 지도: OpenFreeMap(인증키 없음) · 장소 찾기: OpenStreetMap Nominatim.
 * 자료: 공개 지도 자료(Overture Maps, 인증키 없음) · 브이월드(인증키) · 수업 대상지 자료(data/sites.json이 있을 때). */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, X = UDS.Ctx, O = UDS.Ovt, MI = UDS.MapImport, ui = UDS.ui, app = UDS.app, icon = UDS.icon;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = U.esc, nf = (v) => U.fmt(v, 0);
  const LS = 'uds.site', LS_VW = 'uds.vworld';
  const ML_VER = '5.24.1';
  const ML_SRC = [
    ['vendor/maplibre-gl.js', 'vendor/maplibre-gl.css'],
    [`https://unpkg.com/maplibre-gl@${ML_VER}/dist/maplibre-gl.js`, `https://unpkg.com/maplibre-gl@${ML_VER}/dist/maplibre-gl.css`],
    [`https://cdn.jsdelivr.net/npm/maplibre-gl@${ML_VER}/dist/maplibre-gl.js`, `https://cdn.jsdelivr.net/npm/maplibre-gl@${ML_VER}/dist/maplibre-gl.css`],
  ];
  const STYLE = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
  const NOMI = 'https://nominatim.openstreetmap.org/';
  const SIZES = [300, 400, 500, 600, 800, 1000];
  const MINS = 100, MAXS = 1000;
  const SRC_NAME = { ovt: '공개 지도 자료', vw: '브이월드', class: '수업 대상지 자료' };

  const st = {
    lat: 36.6012, lon: 127.2975, z: 16, W: 500, H: 500, src: 'ovt', type: 'oldtown', service: true, rail: true, fac: true,
    key: '', domain: '', name: '', nameAt: null,
    busy: false, err: '', note: '', step: '', pv: null, pvKey: '', sites: null, bundle: null,
  };
  try {
    const o = JSON.parse(localStorage.getItem(LS) || '{}');
    if (o.lat >= -85 && o.lat <= 85 && o.lon >= -180 && o.lon <= 180) { st.lat = o.lat; st.lon = o.lon; }
    if (o.z >= 5 && o.z <= 19) st.z = o.z;
    if (o.W >= MINS && o.W <= MAXS) st.W = o.W;
    if (o.H >= MINS && o.H <= MAXS) st.H = o.H;
    if (SRC_NAME[o.src]) st.src = o.src;
    if (o.type && MI && MI.TYPES[o.type]) st.type = o.type;
    if (o.service === false) st.service = false;
    if (o.rail === false) st.rail = false;
    if (o.fac === false) st.fac = false;
    const v = JSON.parse(localStorage.getItem(LS_VW) || '{}');
    st.key = v.key || ''; st.domain = v.domain || '';
  } catch (e) { /* 저장 공간을 쓸 수 없는 환경 */ }
  const remember = () => {
    try {
      localStorage.setItem(LS, JSON.stringify({ lat: U.round(st.lat, 6), lon: U.round(st.lon, 6), z: U.round(st.z, 2), W: st.W, H: st.H, src: st.src, type: st.type, service: st.service, rail: st.rail, fac: st.fac }));
      const v = JSON.parse(localStorage.getItem(LS_VW) || '{}');
      localStorage.setItem(LS_VW, JSON.stringify({ ...v, key: st.key, domain: st.domain }));
    } catch (e) { /* 무시 */ }
  };
  const frame = () => X.frame(st.lat, st.lon, st.W, st.H);
  const pick = { map: null, ml: null, t: 0, tok: 0 };
  UDS.SitePick = { st, pick, preview: () => preview(), resetSites: () => { sitesP = null; st.sites = null; } }; // 시험·점검용

  /* ---------- MapLibre 불러오기: 같은 누리집의 vendor 폴더 → 공개 CDN 차례로 ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  let mlP = null;
  function loadML() {
    if (G.maplibregl) return Promise.resolve(G.maplibregl);
    if (!mlP) {
      mlP = (async () => {
        for (const [js, css] of ML_SRC) {
          try {
            await loadScript(js);
            if (G.maplibregl) {
              if (!document.querySelector('link[data-ml]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = css; l.dataset.ml = '1'; document.head.appendChild(l); }
              return G.maplibregl;
            }
          } catch (e) { /* 다음 주소 */ }
        }
        throw new Error('지도 프로그램(MapLibre)을 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
      })();
      mlP.catch(() => { mlP = null; });
    }
    return mlP;
  }
  function fetchT(url, ms) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ac ? setTimeout(() => ac.abort(), ms || 8000) : 0;
    return fetch(url, ac ? { signal: ac.signal } : {}).finally(() => clearTimeout(t));
  }

  /* ---------- 수업 대상지 자료(data/sites.json): 있으면 지도에 범위를 그리고 고를 수 있게 ---------- */
  let sitesP = null;
  function loadSites() {
    if (!sitesP) sitesP = fetchT('data/sites.json', 6000).then((r) => (r.ok ? r.json() : [])).then((j) => (Array.isArray(j) ? j.filter((s) => s && s.file && Array.isArray(s.bbox) && s.bbox.length === 4) : [])).catch(() => []);
    return sitesP;
  }
  const bundleAt = () => {
    const b = X.bbox(frame());
    return (st.sites || []).find((s) => b.w >= s.bbox[0] && b.s >= s.bbox[1] && b.e <= s.bbox[2] && b.n <= s.bbox[3]) || null;
  };
  const bundleCache = new Map();
  function loadBundle(s) {
    if (!bundleCache.has(s.file)) {
      const p = fetchT(s.file, 60000).then((r) => { if (!r.ok) throw new Error('수업 대상지 자료를 받지 못했습니다(' + r.status + ').'); return r.json(); });
      p.catch(() => bundleCache.delete(s.file));
      bundleCache.set(s.file, p);
    }
    return bundleCache.get(s.file);
  }

  /* ---------- 대화상자 ---------- */
  ui.siteDialog = function () {
    ui.closePop();
    if (X.inSandbox()) { // Claude 화면 안에서는 바깥 지도·자료에 닿을 수 없다: 붙여 넣는 방식으로
      if (ui.realDialog) ui.realDialog();
      ui.toast('이 화면에서는 지도를 쓸 수 없어 자료 붙여 넣기 방식으로 엽니다. 지도에서 고르기는 ohjooseok.github.io/urbify 에서 씁니다.');
      return;
    }
    const edited = app.isEdited();
    const typeOpts = Object.keys(MI.TYPES).map((k) => `<option value="${k}"${k === st.type ? ' selected' : ''}>${MI.TYPES[k].name}</option>`).join('');
    const src = (k, b, i) => `<label class="spsrc"${k === 'class' ? ' id="spClassL" hidden' : ''}><input type="radio" name="spSrc" value="${k}"${st.src === k ? ' checked' : ''}><span><b>${b}</b><i${k === 'class' ? ' id="spClassI"' : ''}>${i}</i></span></label>`;
    const body = `<div class="sp">
      <div class="spmap">
        <form class="spq" id="spQ" role="search" autocomplete="off">
          <span class="spqi">${icon('search', 15)}<input id="spQi" type="search" placeholder="장소·주소·좌표 찾기 (예: 조치원역, 36.6012, 127.2975)" aria-label="장소 찾기" spellcheck="false"></span>
          <button class="btn sm" type="submit">찾기</button>
        </form>
        <ul class="spres" id="spRes" role="listbox" aria-label="찾은 장소" hidden></ul>
        <div class="spcv" id="spMap" role="application" aria-label="지도: 끌어서 대상지를 옮기고, 휠·두 손가락으로 확대합니다"></div>
        <div class="spcross" aria-hidden="true"></div>
        <p class="spmsg" id="spMsg" hidden></p>
      </div>
      <div class="spside">
        <p class="splead">지도를 끌어 가운데 사각형을 대상지에 맞추고 [대상지 만들기]를 누르세요. 현황 건물은 회색 매스로 서고, 그 위에 도로와 건물을 새로 계획합니다.${edited ? ' <b>지금 작업은 닫히므로</b> 남겨 두려면 먼저 저장하세요.' : ''}</p>
        <section class="sps">
          <h4>대상지 범위</h4>
          <div class="spwh"><label><span>가로</span><input id="spW" type="number" min="${MINS}" max="${MAXS}" step="10" value="${st.W}" inputmode="numeric"></label><i>×</i><label><span>세로</span><input id="spH" type="number" min="${MINS}" max="${MAXS}" step="10" value="${st.H}" inputmode="numeric"></label><i>m</i></div>
          <div class="seg sm spsz" role="group" aria-label="정사각형 크기">${SIZES.map((v) => `<button type="button" data-sp-size="${v}">${v}</button>`).join('')}</div>
          <p class="sph" id="spInfo"></p>
        </section>
        <section class="sps">
          <h4>자료</h4>
          ${src('ovt', '공개 지도 자료', '인증키 없이 · 건물 윤곽과 일부 층수, 도로 중심선(Overture Maps · OpenStreetMap)')}
          ${src('vw', '브이월드', '인증키 필요 · 건물 층수·높이·용도·사용승인일과 지적(필지)')}
          <div class="spvw" id="spVw" hidden>
            <label class="rlf"><span>인증키</span><input id="spKey" type="password" value="${esc(st.key)}" placeholder="오픈API 인증키" autocomplete="off" spellcheck="false"></label>
            <label class="rlf"><span>서비스 URL</span><input id="spDom" type="text" value="${esc(st.domain)}" placeholder="${esc(location.origin && location.origin !== 'null' ? location.origin : 'http://localhost')}" autocomplete="off" spellcheck="false"></label>
            <p class="rlh">인증키를 받을 때 등록한 서비스 URL을 넣습니다(비우면 이 누리집 주소). 넣은 값은 이 브라우저에만 남습니다. <button type="button" class="lnk" id="spPaste">받은 자료 붙여 넣기로 열기</button></p>
          </div>
          ${src('class', '수업 대상지 자료', '')}
        </section>
        <section class="sps">
          <h4>도로망</h4>
          <label class="rlf"><span>도로 단면</span><select id="spType" aria-label="도로 단면 유형">${typeOpts}</select></label>
          <label class="sw"><input type="checkbox" id="spSvc"${st.service ? ' checked' : ''}><span>골목·서비스 도로 포함</span></label>
          <label class="sw"><input type="checkbox" id="spRail"${st.rail ? ' checked' : ''}><span>철도 부지 표시</span></label>
        </section>
        <section class="sps">
          <h4>현황 건물</h4>
          <label class="sw"><input type="checkbox" id="spFac"${st.fac ? ' checked' : ''}><span>입면 추정(층수·크기·모양으로 재료·창·간판·지붕)</span></label>
        </section>
        <section class="spst" id="spSt" aria-live="polite"></section>
      </div>
    </div>`;
    const foot = `<button class="btn pri" id="spGo">대상지 만들기</button><button class="btn" data-act="closedlg">취소</button><span class="grow"></span><span class="spattr" id="spAttr">지도 © OpenStreetMap 기여자 · OpenFreeMap · Overture Maps Foundation</span>`;
    const d = ui.dialog('지도에서 대상지 고르기', body, foot);
    $('.dlg', d).classList.add('big', 'site');
    bind(d);
    sync();
    loadSites().then((s) => { st.sites = s; drawSites(); sync(); });
    loadML().then((ml) => initMap(ml)).catch((e) => { msg(e.message + ' 좌표를 찾기 칸에 넣어 범위를 정할 수 있습니다.'); });
    schedule(200); // 지금 범위의 자료를 바로 미리 본다(지도를 움직이지 않아도)
    const q = $('#spQi'); if (q) setTimeout(() => { try { q.focus(); } catch (e) { /* 무시 */ } }, 30);
  };
  /* 대화상자를 닫거나 다른 대화상자로 바꿀 때 지도를 함께 지운다(WebGL 자원 풀기) */
  const dropMap = () => { if (pick.map) { try { pick.map.remove(); } catch (e) { /* 무시 */ } pick.map = null; } pick.tok++; clearTimeout(pick.t); };
  const closeDlg = ui.closeDialog, openDlg = ui.dialog;
  ui.closeDialog = function () { dropMap(); return closeDlg.apply(this, arguments); };
  ui.dialog = function () { dropMap(); return openDlg.apply(this, arguments); };

  function bind(d) {
    const on = (id, ev, fn) => { const el = $('#' + id, d); if (el) el.addEventListener(ev, fn); };
    on('spQ', 'submit', (e) => { e.preventDefault(); search(); });
    on('spQi', 'keydown', (e) => { if (e.key === 'ArrowDown') { const f = $('#spRes button', d); if (f) { e.preventDefault(); f.focus(); } } });
    on('spRes', 'click', (e) => { const b = e.target.closest('[data-ll]'); if (!b) return; const [la, lo, z] = b.dataset.ll.split(',').map(Number); st.name = b.dataset.nm || ''; st.nameAt = [la, lo]; goTo(la, lo, z || 16); hideRes(); });
    const size = () => {
      const w = U.clamp(Math.round(+($('#spW', d).value) / 10) * 10 || st.W, MINS, MAXS), h = U.clamp(Math.round(+($('#spH', d).value) / 10) * 10 || st.H, MINS, MAXS);
      st.W = w; st.H = h; remember(); drawRect(); sync(); schedule();
    };
    on('spW', 'change', size); on('spH', 'change', size);
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sp-size]');
      if (b) { st.W = st.H = +b.dataset.spSize; $('#spW', d).value = st.W; $('#spH', d).value = st.H; remember(); drawRect(); sync(); schedule(); fitRect(); }
      const g = e.target.closest('[data-sp-goto]');
      if (g) { const s = (st.sites || [])[+g.dataset.spGoto]; if (s) { const c = s.center || [(s.bbox[1] + s.bbox[3]) / 2, (s.bbox[0] + s.bbox[2]) / 2]; st.name = s.name || ''; st.nameAt = c; goTo(c[0], c[1], 16); } }
    });
    d.querySelectorAll('input[name="spSrc"]').forEach((r) => r.addEventListener('change', () => { st.src = r.value; remember(); st.err = ''; sync(); schedule(0); }));
    on('spKey', 'input', (e) => { st.key = e.target.value.trim(); remember(); sync(); });
    on('spDom', 'input', (e) => { st.domain = e.target.value.trim(); remember(); });
    on('spType', 'change', (e) => { st.type = e.target.value; remember(); if (st.pv) { renderPreview(); syncStatus(); } });
    on('spSvc', 'change', (e) => { st.service = e.target.checked; remember(); st.pvKey = ''; schedule(0); });
    on('spFac', 'change', (e) => { st.fac = e.target.checked; remember(); });
    on('spRail', 'change', (e) => { st.rail = e.target.checked; remember(); if (st.pv) { renderPreview(); syncStatus(); } });
    on('spGo', 'click', build);
    on('spPaste', 'click', () => { ui.closeDialog(); if (ui.realDialog) ui.realDialog(); });
  }
  function hideRes() { const r = $('#spRes'); if (r) { r.hidden = true; r.innerHTML = ''; } }
  function msg(t) { const m = $('#spMsg'); if (m) { m.textContent = t || ''; m.hidden = !t; } }

  /* ---------- 장소 찾기: 좌표·지도 주소는 바로, 그 밖에는 Nominatim(OpenStreetMap) ---------- */
  async function search() {
    const q = ($('#spQi') || {}).value || '';
    if (!q.trim()) return;
    const l = X.parseLoc(q);
    if (l) { st.name = ''; st.nameAt = null; goTo(l.lat, l.lon, 16.5); hideRes(); return; }
    const r = $('#spRes'); if (!r) return;
    r.hidden = false; r.innerHTML = '<li class="spres0">찾는 중…</li>';
    try {
      const url = `${NOMI}search?format=jsonv2&limit=7&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(q.trim())}`;
      const j = await (await fetchT(url, 9000)).json();
      if (!$('#spRes')) return;
      if (!Array.isArray(j) || !j.length) { r.innerHTML = '<li class="spres0">찾지 못했습니다. 동네 이름·역 이름·도로명 주소로 다시 찾거나, 구글 지도에서 복사한 좌표를 넣으세요.</li>'; return; }
      r.innerHTML = j.map((x) => {
        const nm = String(x.name || (x.display_name || '').split(',')[0] || '').trim();
        const sub = String(x.display_name || '').split(',').slice(1, 4).map((s) => s.trim()).filter(Boolean).reverse().join(' ');
        const z = x.addresstype === 'city' || x.addresstype === 'county' ? 13 : x.addresstype === 'town' || x.addresstype === 'borough' || x.addresstype === 'suburb' ? 14.5 : 16.5;
        return `<li><button type="button" data-ll="${(+x.lat).toFixed(6)},${(+x.lon).toFixed(6)},${z}" data-nm="${esc(nm)}"><b>${esc(nm)}</b><i>${esc(sub)}</i></button></li>`;
      }).join('');
    } catch (e) {
      if ($('#spRes')) r.innerHTML = '<li class="spres0">장소 찾기 서버에 닿지 못했습니다. 좌표(예: 36.6012, 127.2975)를 넣거나 지도를 직접 옮기세요.</li>';
    }
  }
  function goTo(lat, lon, z) {
    st.lat = lat; st.lon = lon; if (z) st.z = z;
    remember();
    if (pick.map) pick.map.jumpTo({ center: [lon, lat], zoom: z || pick.map.getZoom() });
    else { drawRect(); sync(); schedule(0); }
  }

  /* ---------- 지도 ---------- */
  const rectLL = (F) => { const b = X.bbox(F); return [[b.w, b.s], [b.e, b.s], [b.e, b.n], [b.w, b.n], [b.w, b.s]]; };
  const toLL = (F, p) => [U.round(F.lon + (p[0] - F.W / 2) / F.mLon, 7), U.round(F.lat + (p[1] - F.H / 2) / F.mLat, 7)];
  const fc = (features) => ({ type: 'FeatureCollection', features });
  function initMap(ml) {
    const el = $('#spMap');
    if (!el || pick.map) return;
    pick.ml = ml;
    const dark = !!(UDS.TH && UDS.TH.inkOn()); // 지도도 그림: 다크 테마에서도 밝은 바탕 지도
    let map;
    try {
      map = new ml.Map({
        container: el, style: dark ? STYLE.dark : STYLE.light, center: [st.lon, st.lat], zoom: st.z, minZoom: 5, maxZoom: 19,
        dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: false,
        localIdeographFontFamily: '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
      });
    } catch (e) { msg('이 브라우저에서 지도를 그릴 수 없습니다(WebGL). 좌표를 찾기 칸에 넣어 범위를 정할 수 있습니다.'); schedule(0); return; }
    pick.map = map;
    if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
    map.addControl(new ml.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new ml.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
    // 바탕 지도 스타일을 읽으면 곧바로 대상지 사각형·미리 보기 층을 얹는다(바탕 타일을 다 받을 때까지 기다리지 않음)
    const ready = () => { if (map.getSource('sp-site')) return; koLabels(map); addLayers(map); drawRect(); drawSites(); if (st.pv) renderPreview(); };
    map.on('style.load', ready);
    map.on('load', () => {
      ready();
      setTimeout(() => {
        try {
          map.resize();
          // 대상지 범위가 지도보다 크면(좁은 화면 등) 한눈에 들어오게 물러선다
          const b = X.bbox(frame()), p1 = map.project([b.w, b.n]), p2 = map.project([b.e, b.s]), el2 = map.getContainer();
          if (p2.x - p1.x > el2.clientWidth * 0.92 || p2.y - p1.y > el2.clientHeight * 0.92) fitRect();
        } catch (e) { /* 무시 */ }
      }, 60);
    });
    map.on('move', () => { const c = map.getCenter(); st.lat = c.lat; st.lon = c.lng; st.z = map.getZoom(); drawRect(); syncInfo(); });
    map.on('moveend', () => { remember(); sync(); schedule(); });
    map.on('click', (e) => map.easeTo({ center: e.lngLat, duration: 350 }));
    map.on('error', (e) => { const m = String((e && e.error && e.error.message) || ''); if (/style|Failed to fetch|NetworkError/i.test(m) && !map.isStyleLoaded()) msg('바탕 지도를 불러오지 못했습니다(인터넷 연결 확인). 범위는 그대로 정하고 만들 수 있습니다.'); });
  }
  /* 지명은 한글로(바탕 지도의 영문·한글 겹쳐 쓰기 대신) */
  function koLabels(map) {
    const s = map.getStyle(); if (!s || !s.layers) return;
    s.layers.forEach((l) => {
      if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) return;
      if (JSON.stringify(l.layout['text-field']).indexOf('name') < 0) return;
      try { map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name:nonlatin'], ['get', 'name']]); } catch (e) { /* 무시 */ }
    });
  }
  const ACC = () => (UDS.TH && UDS.TH.inkOn() ? '#7bd2bf' : '#1f6f5f');
  function addLayers(map) {
    const dark = !!(UDS.TH && UDS.TH.inkOn());
    const add = (id, data) => { if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: data || fc([]) }); };
    ['sp-mask', 'sp-site', 'sp-bld', 'sp-road', 'sp-rab', 'sp-rail', 'sp-sites'].forEach((k) => add(k));
    const L = (o) => { if (!map.getLayer(o.id)) map.addLayer(o); };
    L({ id: 'sp-sites', type: 'line', source: 'sp-sites', paint: { 'line-color': '#e0a030', 'line-width': 1.6, 'line-dasharray': [3, 2] } });
    L({ id: 'sp-rail', type: 'fill', source: 'sp-rail', paint: { 'fill-color': dark ? '#5b5f78' : '#b9b4cc', 'fill-opacity': 0.55 } });
    L({ id: 'sp-bld', type: 'fill', source: 'sp-bld', paint: { 'fill-color': ['match', ['get', 'k'], 'd', dark ? '#4fb9a2' : '#2f8c7a', 'p', '#e0a85a', dark ? '#8a929b' : '#9aa1a8'], 'fill-opacity': 0.82, 'fill-outline-color': dark ? '#0d1013' : '#ffffff' } });
    const mpp = 156543.03 * Math.cos((st.lat * Math.PI) / 180); // 확대 단계 0에서 화소 하나의 길이(m)
    L({ id: 'sp-road', type: 'line', source: 'sp-road', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
      'line-color': ['match', ['get', 'c'], '대로', '#e8833a', '중로', dark ? '#e7c35a' : '#d9a82a', '소로', dark ? '#7fb6ff' : '#3c78d8', dark ? '#9aa6b2' : '#8a96a3'],
      'line-opacity': 0.85,
      'line-width': ['interpolate', ['exponential', 2], ['zoom'], 12, ['max', 1, ['*', ['get', 'w'], 4096 / mpp]], 20, ['*', ['get', 'w'], 1048576 / mpp]],
    } });
    L({ id: 'sp-rab', type: 'line', source: 'sp-rab', paint: { 'line-color': '#e8833a', 'line-width': 2.2 } });
    L({ id: 'sp-mask', type: 'fill', source: 'sp-mask', paint: { 'fill-color': dark ? '#000000' : '#1b2026', 'fill-opacity': dark ? 0.5 : 0.28 } });
    L({ id: 'sp-site', type: 'line', source: 'sp-site', paint: { 'line-color': ACC(), 'line-width': 2.6 } });
  }
  function setData(id, data) { const m = pick.map; if (!m) return; const s = m.getSource && m.getSource(id); if (s) s.setData(data); }
  function drawRect() {
    if (!pick.map) return;
    const r = rectLL(frame());
    setData('sp-site', fc([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r } }]));
    setData('sp-mask', fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-179, -85], [179, -85], [179, 85], [-179, 85], [-179, -85]], r.slice().reverse()] } }]));
  }
  function drawSites() {
    if (!pick.map || !st.sites) return;
    setData('sp-sites', fc(st.sites.map((s) => { const [w, so, e, n] = s.bbox; return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[w, so], [e, so], [e, n], [w, n], [w, so]] } }; })));
  }
  function fitRect() {
    const m = pick.map; if (!m) return;
    const b = X.bbox(frame(), Math.max(st.W, st.H) * 0.25);
    try { m.fitBounds([[b.w, b.s], [b.e, b.n]], { duration: 300, padding: 20 }); } catch (e) { /* 무시 */ }
  }

  /* ---------- 미리 보기: 지도를 멈추면 그 범위의 자료를 받아(타일 단위로 기억) 세울 건물·도로를 그린다 ---------- */
  function schedule(ms) {
    clearTimeout(pick.t);
    pick.t = setTimeout(preview, ms === undefined ? 450 : ms);
  }
  const pvKeyOf = () => [st.src, st.lat.toFixed(6), st.lon.toFixed(6), st.W, st.H, st.service ? 1 : 0].join('|');
  async function preview() {
    if (!$('#spSt')) return;
    const key = pvKeyOf();
    if (key === st.pvKey && st.pv) return;
    if (st.src === 'vw') { st.pv = null; st.pvKey = ''; renderPreview(); syncStatus(); return; } // 브이월드는 요청 수가 정해져 있어 만들 때만 받는다
    if (pick.map && pick.map.getZoom() < 12.5) { st.note = '지도를 더 확대하면 대상지 범위의 자료를 미리 봅니다.'; st.pv = null; renderPreview(); syncStatus(); return; }
    const tok = ++pick.tok;
    st.err = ''; st.note = ''; st.step = '자료 받는 중…'; syncStatus();
    try {
      const pv = await getData((t) => { if (tok === pick.tok) { st.step = t; syncStatus(); } });
      if (tok !== pick.tok) return;
      st.pv = pv; st.pvKey = key; st.step = '';
      renderPreview(); syncStatus();
    } catch (e) {
      if (tok !== pick.tok) return;
      st.pv = null; st.pvKey = ''; st.step = '';
      st.err = e.message || String(e);
      renderPreview(); syncStatus();
    }
  }
  /* 지금 범위의 자료: { F, kind, raw, bld(현황 건물), streets, rabs, rails } */
  async function getData(say) {
    const F = frame();
    if (st.src === 'class') {
      const s = bundleAt();
      if (!s) throw new Error('대상지 범위가 수업 대상지 자료의 범위(지도의 주황 점선) 밖에 있습니다.');
      say('수업 대상지 자료 받는 중…');
      const b = await loadBundle(s);
      const bf = (b.bld && b.bld.features) || [], pf = (b.par && b.par.features) || [];
      return { F, kind: 'class', site: s, raw: { bld: bf, par: pf }, bld: X.buildings(bf, F), par: X.parcels(pf, F) };
    }
    const raw = await O.fetchArea(X.bbox(F, 45), { onStep: say, service: st.service });
    const r = O.streets(raw.segs, F);
    return { F, kind: 'ovt', raw, bld: X.buildings(raw.bld, F), streets: r.streets, rabs: r.rabs, dual: r.dual, railPar: O.railParcels(raw.rails, F) };
  }
  function renderPreview() {
    const pv = st.pv;
    if (!pick.map) return;
    if (!pv) { ['sp-bld', 'sp-road', 'sp-rab', 'sp-rail'].forEach((k) => setData(k, fc([]))); return; }
    const F = pv.F;
    setData('sp-bld', fc(pv.bld.map((b) => ({ type: 'Feature', properties: { k: !b.est ? 'd' : b.est === 'fl' || b.est === 'h' ? 'p' : 'g' }, geometry: { type: 'MultiPolygon', coordinates: b.parts.map((pt) => [pt.o.concat([pt.o[0]]).map((p) => toLL(F, p))].concat(pt.h.map((h) => h.concat([h[0]]).map((p) => toLL(F, p))))) } }))));
    const cls = (s) => MI.roadSpec(s.w, s.major, st.type).cls;
    const roadCls = (c) => (c === '대로' ? '대로' : c === '중로' ? '중로' : c === '소로' ? '소로' : '골목');
    setData('sp-road', fc((pv.streets || []).map((s) => ({ type: 'Feature', properties: { w: s.w, c: roadCls(cls(s)) }, geometry: { type: 'LineString', coordinates: s.pts.map((p) => toLL(F, p)) } }))));
    setData('sp-rab', fc((pv.rabs || []).map((rb) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: Array.from({ length: 33 }, (_, i) => { const a = (i / 32) * Math.PI * 2; return toLL(F, [rb.p[0] + Math.cos(a) * rb.d / 2, rb.p[1] + Math.sin(a) * rb.d / 2]); }) } }))));
    const rails = pv.kind === 'ovt' && st.rail ? pv.railPar || [] : [];
    setData('sp-rail', fc(rails.map((q) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [q.parts[0].o.concat([q.parts[0].o[0]]).map((p) => toLL(F, p))] } }))));
  }

  /* ---------- 화면 갱신 ---------- */
  function syncInfo() {
    const el = $('#spInfo'); if (!el) return;
    el.innerHTML = `중심 ${st.lat.toFixed(5)}, ${st.lon.toFixed(5)} · ${U.fmt((st.W * st.H) / 10000, 1)}ha${st.name ? ` · ${esc(st.name)} 부근` : ''}`;
    document.querySelectorAll('[data-sp-size]').forEach((b) => b.setAttribute('aria-pressed', String(st.W === st.H && +b.dataset.spSize === st.W)));
  }
  function sync() {
    syncInfo();
    const vw = $('#spVw'); if (vw) vw.hidden = st.src !== 'vw';
    const s = bundleAt(), cl = $('#spClassL');
    if (cl) {
      const any = st.sites && st.sites.length;
      cl.hidden = !any;
      const i = $('#spClassI');
      if (i && any) i.innerHTML = s ? `${esc(s.name || '수업 대상지')} · ${esc(s.src || '')}` : `지도의 주황 점선 안에서 쓸 수 있습니다. ${st.sites.map((x, k) => `<button type="button" class="lnk" data-sp-goto="${k}">${esc(x.name || '수업 대상지')}로 이동</button>`).join(' ')}`;
      const r = $('input[value="class"]', cl); if (r) r.disabled = !s;
    }
    if (st.src === 'class' && !s && st.sites) { /* 범위 밖: 고른 채로 두고 안내 */ }
    const sv = $('#spSvc'); if (sv) sv.disabled = st.src !== 'ovt';
    const rl = $('#spRail'); if (rl) rl.disabled = st.src !== 'ovt';
    syncStatus();
  }
  function syncStatus() {
    const el = $('#spSt'); if (!el) return;
    const pv = st.pv;
    let h = '';
    if (st.err) h += `<p class="err">${esc(st.err)}</p>`;
    if (st.step) h += `<p class="spstep">${esc(st.step)}</p>`;
    else if (st.note) h += `<p class="rlh">${esc(st.note)}</p>`;
    if (st.src === 'vw') {
      h += `<p class="rlh">${st.key ? '[대상지 만들기]를 누르면 브이월드에서 건물과 지적을 받아 세웁니다(요청 2–8번).' : '브이월드 인증키를 넣으세요. 인증키가 없으면 공개 지도 자료로 만들 수 있습니다.'}</p>`;
    } else if (pv && !st.step) {
      const n = pv.bld.length, nd = pv.bld.filter((b) => !b.est).length, np = pv.bld.filter((b) => b.est === 'fl' || b.est === 'h').length;
      const row = (k, v) => `<div class="rlr ok"><b>${k}</b><span>${v}</span></div>`;
      h += row('건물', n ? `${nf(n)}동 · 층수·높이 자료 ${nf(nd + np)}동${n - nd - np > 0 ? `, ${nf(n - nd - np)}동은 용도·건축면적으로 어림` : ''}` : '없음');
      if (pv.kind === 'ovt') {
        const cnt = {}; (pv.streets || []).forEach((s) => { const c = MI.roadSpec(s.w, s.major, st.type).cls; cnt[c] = (cnt[c] || 0) + 1; });
        const order = ['대로', '중로', '소로', '이면도로', '골목길'];
        const txt = order.filter((k) => cnt[k]).map((k) => `${k} ${cnt[k]}`).join(' · ');
        h += row('도로', (pv.streets || []).length ? `${nf(pv.streets.length)}개 구간${txt ? ` (${txt})` : ''}${pv.rabs && pv.rabs.length ? ` · 회전교차로 ${pv.rabs.length}` : ''}` : '없음');
        if (pv.railPar && pv.railPar.length && st.rail) h += row('철도', '선로 부지를 바탕에 칠합니다');
        h += `<p class="rlh">지도의 색: <i class="spk d"></i>층수·높이 자료 <i class="spk p"></i>일부 어림 <i class="spk g"></i>어림. 어림한 층수는 만든 뒤 건물을 눌러 고칠 수 있습니다.</p>`;
      } else {
        h += row('지적', pv.par.length ? `${nf(pv.par.length)}필지 · 도로 필지로 도로망을 냅니다` : '없음');
      }
    }
    el.innerHTML = h;
    const go = $('#spGo');
    if (go) {
      go.disabled = st.busy || !!st.step || (st.src === 'vw' && !st.key) || (st.src === 'class' && !bundleAt()) || (st.src !== 'vw' && !!st.pv && !st.pv.bld.length);
      go.textContent = st.busy ? '만드는 중…' : '대상지 만들기';
    }
  }

  /* ---------- 브이월드에서 받기(JSONP, 1,000건 상한이면 넷으로 나눠 다시) ---------- */
  async function fetchVworld(F, say) {
    const got = { bld: new Map(), par: new Map() };
    const dom = st.domain || (location.origin && location.origin !== 'null' ? location.origin : '');
    let n = 0;
    const one = async (k, bb, depth) => {
      n++; say(`브이월드 ${X.LAYERS[k].name} 받는 중… (${n})`);
      let J;
      try { J = await X.jsonp(X.url(k, bb, st.key, dom, { jsonp: 'parseResponse' }), 25000); }
      catch (e) { throw new Error(e && e.message === 'timeout' ? '브이월드가 응답하지 않습니다. 잠시 뒤 다시 해 보세요.' : '브이월드가 요청을 거절했습니다. 인증키와 서비스 URL을 확인하세요.'); }
      const r = X.ingest(J);
      if (!r.ok) throw new Error(r.msg);
      if (r.kind === 'empty') return;
      if (r.cut && depth < 2) { for (const t of X.tiles(bb, 2)) await one(k, t, depth + 1); return; }
      r.feats.forEach((f, i) => { const p = f.properties || {}; const id = String(f.id || (k === 'bld' ? p.gis_idntfc_no || p.buld_idntfc_no : p.pnu) || k + got[k].size + '_' + i); if (!got[k].has(id)) got[k].set(id, f); });
    };
    await one('bld', X.bbox(F), 0);
    await one('par', X.bbox(F), 0);
    return { bld: Array.from(got.bld.values()), par: Array.from(got.par.values()) };
  }
  /* 대상지 이름: 찾은 장소가 있으면 그것, 없으면 지도 주소에서 동네 이름(Nominatim 역지오코딩) */
  async function placeName(lat, lon) {
    if (st.name && st.nameAt && Math.hypot((st.nameAt[0] - lat) * 111000, (st.nameAt[1] - lon) * 89000) < 600) return st.name;
    try {
      const j = await (await fetchT(`${NOMI}reverse?format=jsonv2&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&zoom=16&accept-language=ko`, 4000)).json();
      const a = (j && j.address) || {};
      return String(a.quarter || a.neighbourhood || a.suburb || a.village || a.hamlet || a.town || a.city_district || a.borough || a.city || '').trim();
    } catch (e) { return ''; }
  }

  /* ---------- 대상지 만들기 ---------- */
  async function build() {
    if (st.busy) return;
    const F = frame(), lat = st.lat, lon = st.lon;
    st.busy = true; st.err = ''; syncStatus();
    const say = (t) => { st.step = t; syncStatus(); };
    try {
      let res = null, src = '';
      const nmP = placeName(lat, lon);
      if (st.src === 'vw') {
        if (!st.key) throw new Error('브이월드 인증키를 넣으세요.');
        const got = await fetchVworld(F, say);
        say('대상지를 세우는 중…');
        res = X.makeProject({ title: '', lat, lon, W: st.W, H: st.H, bld: got.bld, par: got.par, roads: got.par.length > 0, type: st.type });
        src = '브이월드';
      } else {
        let pv = st.pv && st.pvKey === pvKeyOf() ? st.pv : null;
        if (!pv) { pv = await getData(say); st.pv = pv; st.pvKey = pvKeyOf(); renderPreview(); }
        say('대상지를 세우는 중…');
        if (pv.kind === 'class') {
          res = X.makeProject({ title: '', lat, lon, W: st.W, H: st.H, bld: pv.raw.bld, par: pv.raw.par, roads: pv.raw.par.length > 0, type: st.type });
          res.data.src = pv.site.src || '수업 대상지 자료';
          src = pv.site.name || '수업 대상지 자료';
        } else {
          const rails = st.rail ? pv.railPar || [] : [];
          res = X.makeProject({ title: '', lat, lon, W: st.W, H: st.H, bld: pv.raw.bld, streets: pv.streets, rabs: pv.rabs, par2: rails, type: st.type, src: `Overture Maps 건물·교통망(${pv.raw.rel})`, attr: O.ATTR });
          src = '공개 지도 자료';
        }
      }
      if (!res || !res.data.bld.length) throw new Error('대상지 안에 세울 건물이 없습니다. 범위를 옮기거나 키워 보세요.');
      const nm = await nmP;
      res.P.meta.title = nm ? `${nm} 일대` : `실제 지역 ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      st.busy = false; st.step = '';
      ui.closeDialog();
      app.state.ctxMode = st.fac ? 'fac' : 'gray'; // 현황 건물 표현: 입면 추정 또는 매스(단색)
      app.load(res.P, { ctx: res.data });
      const est = res.data.bld.filter((b) => b.est).length;
      const npar = res.data.par.filter((q) => !/^rail/.test(q.id)).length; // 철도 부지 띠는 필지가 아님
      ui.toast(`${res.P.meta.title} 대상지를 세웠습니다(${src}): 현황 건물 ${nf(res.data.bld.length)}동${npar ? ` · 필지 ${nf(npar)}` : ''}${res.nRoads ? ` · 도로 ${res.nRoads}개` : ''}.${est ? ` 층수·높이를 어림한 ${nf(est)}동은 건물을 눌러 고칠 수 있습니다.` : ''}${app._ctxSaved === false ? ' 자료가 커서 브라우저에 다 저장하지 못했습니다. 작업 파일로 저장해 두세요.' : ''}`);
    } catch (e) {
      st.busy = false; st.step = '';
      st.err = (e && e.message) || String(e);
      syncStatus();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
