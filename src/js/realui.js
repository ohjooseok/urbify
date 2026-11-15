/* Urbify — 실제 지역 불러오기(대화상자)
 * 위치·범위를 정하고 브이월드 인증키를 넣은 뒤 건물(·지적) 자료를 받아 대상지를 만든다.
 * Claude 화면 안에서는 다른 사이트로 직접 요청할 수 없으므로, 요청 주소를 새 탭에서 열고 나온 글을 복사해 붙여 넣는다.
 * Claude 밖(내려받은 파일, 직접 올린 누리집)에서는 [바로 받기]로 한 번에 받는다. */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, X = UDS.Ctx, MI = UDS.MapImport, ui = UDS.ui, app = UDS.app, icon = UDS.icon;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = U.esc;
  const LS = 'uds.vworld';
  const SIZES = [300, 400, 500, 600];
  const KINDS = ['bld', 'par'];

  const st = {
    loc: '', size: 400, key: '', domain: '', roads: true, type: 'oldtown',
    got: { bld: new Map(), par: new Map() }, // 받은 GeoJSON 지형지물(식별자별)
    cut: { bld: false, par: false }, tiles: { bld: 1, par: 1 }, seen: { bld: new Set(), par: new Set() },
    err: '', note: '', busy: false,
  };
  try {
    const o = JSON.parse(localStorage.getItem(LS) || '{}');
    st.key = o.key || ''; st.domain = o.domain || ''; st.loc = o.loc || ''; if (SIZES.includes(o.size)) st.size = o.size;
    if (o.type && MI && MI.TYPES[o.type]) st.type = o.type;
  } catch (e) { /* 저장 공간을 쓸 수 없는 환경 */ }
  const remember = () => { try { localStorage.setItem(LS, JSON.stringify({ key: st.key, domain: st.domain, loc: st.loc, size: st.size, type: st.type })); } catch (e) { /* 무시 */ } };

  const loc = () => X.parseLoc(st.loc);
  const frame = () => { const l = loc(); return l ? X.frame(l.lat, l.lon, st.size, st.size) : null; };
  const ready = () => !!(loc() && st.key.trim());
  const nf = (v) => U.fmt(v, 0);

  /* 받은 자료 가운데 대상지 안에 드는 것(첫 고리의 평균점으로 어림) */
  function inside(kind) {
    const F = frame(); if (!F) return 0;
    let n = 0;
    st.got[kind].forEach((f) => {
      let c = f.geometry && f.geometry.coordinates;
      while (Array.isArray(c) && Array.isArray(c[0]) && Array.isArray(c[0][0])) c = c[0];
      if (!Array.isArray(c) || !c.length) return;
      let sx = 0, sy = 0; c.forEach((q) => { sx += q[0]; sy += q[1]; });
      let a = sx / c.length, b = sy / c.length;
      if (a < 90 && b > 90) { const t = a; a = b; b = t; } // [위도, 경도]로 온 자료
      const p = X.toXY(F, a, b);
      if (p[0] >= -2 && p[0] <= F.W + 2 && p[1] >= -2 && p[1] <= F.H + 2) n++;
    });
    return n;
  }
  const roadParcels = () => { let n = 0; st.got.par.forEach((f) => { if (/도\s*$/.test(String((f.properties || {}).lnm_lndcgr_smbol || ''))) n++; }); return n; };

  /* ---------- 대화상자 ---------- */
  ui.realDialog = function () {
    ui.closePop();
    const sandbox = X.inSandbox();
    const typeOpts = Object.keys(MI.TYPES).map((k) => `<option value="${k}"${k === st.type ? ' selected' : ''}>${MI.TYPES[k].name}</option>`).join('');
    const edited = app.isEdited();
    const body = `<div class="rl">
      <p class="rlead">브이월드의 <b>GIS건물통합정보</b>(건물 윤곽·층수·높이·용도·사용승인일)로 실제 지역의 건물을 세우고, <b>연속지적도</b>로 필지와 도로망을 그립니다. 현황 건물은 회색 매스로 서고, 그 위에 도로와 건물을 새로 계획합니다.${edited ? ' <b>지금 작업은 닫히므로</b> 남겨 두려면 먼저 저장하세요.' : ''}</p>
      <div class="rlg">
        <section class="rls">
          <h4><i>1</i>대상지</h4>
          <label class="rlf"><span>위치</span><input id="rlLoc" type="text" value="${esc(st.loc)}" placeholder="예: 37.5894, 127.0323" autocomplete="off" spellcheck="false"></label>
          <p class="rlh" id="rlLocOut"></p>
          <div class="rlf"><span>범위</span><div class="seg" role="group" aria-label="대상지 범위(정사각형 한 변)">${SIZES.map((v) => `<button data-rl-size="${v}" aria-pressed="${v === st.size}">${v}m</button>`).join('')}</div><output id="rlHa"></output></div>
        </section>
        <section class="rls">
          <h4><i>2</i>브이월드 인증키</h4>
          <label class="rlf"><span>인증키</span><input id="rlKey" type="password" value="${esc(st.key)}" placeholder="오픈API 인증키" autocomplete="off" spellcheck="false"></label>
          <label class="rlf"><span>서비스 URL</span><input id="rlDom" type="text" value="${esc(st.domain)}" placeholder="인증키를 받을 때 등록한 주소 (예: http://localhost)" autocomplete="off" spellcheck="false"></label>
          <p class="rlh">인증키는 브이월드(<a href="https://www.vworld.kr" target="_blank" rel="noopener noreferrer">vworld.kr</a>)에 가입한 뒤 오픈API에서 무료로 받습니다. 넣은 값은 이 브라우저에만 남습니다.</p>
        </section>
        <section class="rls rlwide">
          <h4><i>3</i>자료 받기</h4>
          ${sandbox ? '' : `<div class="rlrow"><button class="btn pri" id="rlFetch">${icon('download', 14)}바로 받기</button><label class="sw"><input type="checkbox" id="rlWithPar" checked><span>지적도 함께</span></label><span class="rlh" id="rlBusy"></span></div>`}
          <p class="rlh">${sandbox ? '이 화면에서는 브이월드에 직접 요청할 수 없습니다. 아래 단추로 요청을 새 탭에 연 뒤, 나온 글을 모두 선택해 복사(Ctrl+A → Ctrl+C)하고 아래 칸에 붙여 넣으세요.' : '[바로 받기]가 안 되면 아래 단추로 요청을 새 탭에 연 뒤, 나온 글을 모두 복사해 아래 칸에 붙여 넣으세요.'} 표가 보이면 ‘원본 데이터’ 보기로 바꾼 뒤 복사합니다.</p>
          <div class="rlreq" id="rlReq"></div>
          <textarea id="rlPaste" rows="3" placeholder="여기에 붙여 넣기 (Ctrl+V) · 저장해 둔 .json 파일은 이 창에 끌어 놓기" aria-label="받은 자료 붙여 넣기" spellcheck="false"></textarea>
          <div class="rlrow"><label class="btn sm">${icon('upload', 13)}파일 고르기<input type="file" id="rlFile" accept=".json,.geojson,.js,.txt,application/json" multiple hidden></label><span class="grow"></span><button class="btn sm quiet" id="rlClear">받은 자료 비우기</button></div>
          <div class="rlst" id="rlSt" aria-live="polite"></div>
        </section>
        <section class="rls rlwide">
          <h4><i>4</i>도로망</h4>
          <label class="sw"><input type="checkbox" id="rlRoads"${st.roads ? ' checked' : ''}><span>지적도의 도로 필지로 도로망 만들기</span></label>
          <label class="rlf"><span>도로 단면</span><select id="rlType" aria-label="도로 단면 유형">${typeOpts}</select></label>
          <p class="rlh" id="rlRoadNote">도로 필지의 중심선과 폭으로 도로를 냅니다. 도로로 둘러싸인 곳은 빈 가구가 되고, 가구에 건물을 놓거나 용도를 정하면 그 자리의 현황 건물은 철거된 것으로 봅니다.</p>
        </section>
      </div>
    </div>`;
    const d = ui.dialog('실제 지역 불러오기', body, '<button class="btn pri" id="rlGo" disabled>대상지 만들기</button><button class="btn" data-act="closedlg">취소</button><span class="mut" style="font-size:11.5px">받은 자료는 이 브라우저 안에서만 씁니다.</span>');
    $('.dlg', d).classList.add('big', 'real');
    bind(d);
    sync();
    if (!st.loc) { const i = $('#rlLoc'); if (i) try { i.focus(); } catch (e) { /* 무시 */ } }
  };

  function bind(d) {
    const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    on('rlLoc', 'input', (e) => { st.loc = e.target.value; resetTiles(); remember(); sync(); });
    on('rlKey', 'input', (e) => { st.key = e.target.value.trim(); remember(); syncReq(); });
    on('rlDom', 'input', (e) => { st.domain = e.target.value.trim(); remember(); syncReq(); });
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rl-size]');
      if (b) { st.size = +b.dataset.rlSize; resetTiles(); remember(); d.querySelectorAll('[data-rl-size]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); sync(); }
    });
    on('rlRoads', 'change', (e) => { st.roads = e.target.checked; });
    on('rlType', 'change', (e) => { st.type = e.target.value; remember(); });
    on('rlClear', 'click', () => { KINDS.forEach((k) => { st.got[k].clear(); st.cut[k] = false; }); resetTiles(); st.err = ''; st.note = ''; sync(); });
    on('rlGo', 'click', build);
    on('rlFetch', 'click', fetchAll);
    const ta = $('#rlPaste');
    if (ta) {
      ta.addEventListener('paste', (e) => {
        const t = e.clipboardData && e.clipboardData.getData('text');
        if (t) { e.preventDefault(); take(t, '붙여 넣은 글'); }
      });
      ta.addEventListener('input', () => { const t = ta.value; if (t.length > 20) { ta.value = ''; take(t, '붙여 넣은 글'); } });
    }
    on('rlFile', 'change', (e) => { readFiles(e.target.files); e.target.value = ''; });
    d.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); d.classList.add('drag'); } });
    d.addEventListener('dragleave', (e) => { if (e.target === d) d.classList.remove('drag'); });
    d.addEventListener('drop', (e) => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); d.classList.remove('drag'); readFiles(e.dataTransfer.files); });
  }
  function readFiles(list) {
    Array.from(list || []).forEach((f) => {
      const r = new FileReader();
      r.onload = () => take(String(r.result || ''), f.name);
      r.onerror = () => { st.err = `${f.name}: 파일을 읽지 못했습니다.`; syncStatus(); };
      r.readAsText(f);
    });
  }
  function resetTiles() { KINDS.forEach((k) => { st.tiles[k] = 1; st.seen[k].clear(); st.cut[k] = false; }); }

  /* 받은 글 하나를 읽어 해당 자료에 더한다 */
  function take(text, from) {
    const r = X.parse(text);
    if (!r.ok) { st.err = `${from}: ${r.msg}`; st.note = ''; syncStatus(); return; }
    st.err = '';
    add(r, true);
    syncReq(); syncStatus();
  }
  function add(r, manual) {
    if (r.kind === 'empty') { st.note = '받은 자료가 비어 있습니다(그 범위에 자료가 없음). 위치를 확인하세요.'; return; }
    const k = r.kind, m = st.got[k];
    const before = m.size;
    r.feats.forEach((f, i) => { const p = f.properties || {}; const id = String(f.id || (k === 'bld' ? p.gis_idntfc_no || p.buld_idntfc_no : p.pnu) || k + m.size + '_' + i); if (!m.has(id)) m.set(id, f); });
    const added = m.size - before;
    st.note = `${X.LAYERS[k].full} ${nf(r.returned)}건을 읽었습니다${added < r.returned ? `(새로 더한 것 ${nf(added)}건)` : ''}.`;
    if (!manual) return;
    // 1,000건 상한: 범위를 나눠 받게 한다. 어느 조각의 응답인지는 자료가 놓인 자리로 어림한다
    const F = frame();
    if (r.cut && st.tiles[k] < 3) { st.tiles[k]++; st.seen[k].clear(); st.cut[k] = true; }
    else if (r.cut) st.cut[k] = 'max';
    if (F && r.ext && st.tiles[k] > 1) {
      const b = X.bbox(F), cy = (r.ext.s + r.ext.n) / 2, cxx = (r.ext.w + r.ext.e) / 2, kk = st.tiles[k];
      const i = U.clamp(Math.floor(((cxx - b.w) / (b.e - b.w)) * kk), 0, kk - 1), j = U.clamp(Math.floor(((cy - b.s) / (b.n - b.s)) * kk), 0, kk - 1);
      if (!r.cut) st.seen[k].add(j * kk + i);
    }
  }

  /* ---------- 화면 갱신 ---------- */
  function sync() {
    const l = loc(), o = $('#rlLocOut');
    if (o) {
      o.classList.toggle('err', !!st.loc.trim() && !l);
      o.textContent = l ? `북위 ${l.lat.toFixed(5)}°, 동경 ${l.lon.toFixed(5)}°를 중심으로 ${st.size}×${st.size}m` : st.loc.trim() ? '좌표를 읽지 못했습니다. 위도·경도 숫자 두 개(예: 37.5894, 127.0323)나 구글·네이버 지도 주소를 넣으세요.' : '구글 지도에서 자리를 오른쪽 단추로 누르면 좌표가 복사됩니다. 네이버·카카오 지도의 주소(URL)를 붙여 넣어도 됩니다.';
    }
    const ha = $('#rlHa'); if (ha) ha.textContent = `${U.fmt((st.size * st.size) / 10000, 0)}ha`;
    syncReq(); syncStatus();
  }
  function syncReq() {
    const el = $('#rlReq'); if (!el) return;
    const F = frame();
    if (!F || !st.key.trim()) { el.innerHTML = `<p class="rlh">${!F ? '위치를 넣으면' : '인증키를 넣으면'} 여기에 요청 단추가 생깁니다.</p>`; return; }
    const bb = X.bbox(F);
    el.innerHTML = KINDS.map((k) => {
      const kk = st.tiles[k], L = X.LAYERS[k];
      const links = kk === 1
        ? `<a class="btn sm" href="${esc(X.url(k, bb, st.key, st.domain))}" target="_blank" rel="noopener noreferrer">${icon('expand', 13)}요청 열기</a>`
        : X.tiles(bb, kk).map((t, n) => `<a class="btn sm${st.seen[k].has(n) ? ' on' : ''}" href="${esc(X.url(k, t, st.key, st.domain))}" target="_blank" rel="noopener noreferrer" title="${kk * kk}조각 가운데 ${n + 1}번째">${n + 1}</a>`).join('');
      const got = st.got[k].size;
      return `<div class="rlq"><b>${L.name}</b><i>${k === 'par' ? '선택 · 필지·도로망' : '꼭 필요'}</i><span class="rll">${links}</span>${got ? `<span class="rlok">${icon('check', 12)}${nf(got)}${k === 'bld' ? '동' : '필지'}</span>` : ''}</div>` +
        (kk > 1 ? `<p class="rlh">${L.name} 자료가 한 번에 받을 수 있는 1,000건을 넘어 ${kk * kk}조각으로 나눠 받습니다. 번호마다 열어 붙여 넣으세요(받은 조각은 색이 바뀝니다).</p>` : '');
    }).join('') + (st.domain ? '' : '<p class="rlh">서비스 URL을 비워 두면 브이월드가 요청을 거절할 수 있습니다. 인증키를 받을 때 등록한 주소를 넣으세요.</p>');
  }
  function syncStatus() {
    const el = $('#rlSt'); if (!el) return;
    const nb = st.got.bld.size, np = st.got.par.size;
    const inB = nb ? inside('bld') : 0;
    let h = '';
    if (st.err) h += `<p class="err">${esc(st.err)}</p>`;
    else if (st.note) h += `<p class="rlnote">${esc(st.note)}</p>`;
    const row = (name, txt, ok) => `<div class="rlr${ok ? ' ok' : ''}"><b>${name}</b><span>${txt}</span></div>`;
    h += row('건물', nb ? `${nf(nb)}동 받음 · 대상지 안 ${nf(inB)}동${st.cut.bld === 'max' ? ' · <em>아직 1,000건 상한에 걸림: 범위를 줄이세요</em>' : ''}` : '아직 없음', nb > 0 && inB > 0);
    h += row('지적', np ? `${nf(np)}필지 받음 · 도로 필지 ${nf(roadParcels())}${st.cut.par === 'max' ? ' · <em>아직 1,000건 상한에 걸림</em>' : ''}` : '아직 없음 (없으면 도로망 없이 건물만 세움)', np > 0);
    if (nb && !inB) h += '<p class="err">받은 건물이 지금 위치·범위 밖에 있습니다. 위치를 바꿨다면 요청을 다시 열어 받으세요.</p>';
    el.innerHTML = h;
    const go = $('#rlGo'); if (go) go.disabled = st.busy || !(inB > 0 && loc());
    const rn = $('#rlRoads'); if (rn) rn.disabled = !np;
  }

  /* ---------- 바로 받기(JSONP) ---------- */
  async function fetchAll() {
    if (st.busy) return;
    if (!ready()) { st.err = '위치와 인증키를 먼저 넣으세요.'; syncStatus(); return; }
    const F = frame(), withPar = !!($('#rlWithPar') || {}).checked;
    st.busy = true; st.err = ''; st.note = '';
    const busy = $('#rlBusy'), btn = $('#rlFetch');
    if (btn) btn.disabled = true;
    const say = (t) => { if (busy) busy.textContent = t; };
    let n = 0;
    const one = async (k, bb, depth) => {
      n++; say(`${X.LAYERS[k].name} 받는 중… (${n})`);
      let J;
      try { J = await X.jsonp(X.url(k, bb, st.key, st.domain, { jsonp: 'parseResponse' }), 25000); }
      catch (e) {
        const m = e && e.message;
        throw new Error(m === 'timeout' ? '브이월드가 응답하지 않습니다. 잠시 뒤 다시 해 보세요.' : '요청이 거절되었습니다. 인증키와 서비스 URL을 확인하세요. 아래 [요청 열기]로 열면 브이월드가 보낸 오류 내용을 볼 수 있습니다.');
      }
      const r = X.ingest(J);
      if (!r.ok) throw new Error(r.msg);
      if (r.cut && depth < 2) { for (const t of X.tiles(bb, 2)) await one(k, t, depth + 1); return; }
      add(r, false);
    };
    try {
      await one('bld', X.bbox(F), 0);
      if (withPar) await one('par', X.bbox(F), 0);
      st.note = `받았습니다: 건물 ${nf(st.got.bld.size)}동${withPar ? ` · 필지 ${nf(st.got.par.size)}필지` : ''}.`;
    } catch (e) { st.err = e.message || String(e); }
    st.busy = false; say('');
    if (btn) btn.disabled = false;
    syncReq(); syncStatus();
  }

  /* ---------- 대상지 만들기 ---------- */
  function build() {
    const l = loc(); if (!l) return;
    const go = $('#rlGo'); if (go) { go.disabled = true; go.textContent = '만드는 중…'; }
    setTimeout(() => {
      let res = null;
      try {
        res = X.makeProject({ title: `실제 지역 ${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}`, lat: l.lat, lon: l.lon, W: st.size, H: st.size, bld: Array.from(st.got.bld.values()), par: Array.from(st.got.par.values()), roads: st.roads && st.got.par.size > 0, type: st.type });
      } catch (e) { console.error(e); res = null; }
      if (!res || !res.data.bld.length) {
        st.err = '대상지 안에 세울 건물이 없습니다. 위치와 받은 자료를 확인하세요.';
        if (go) { go.disabled = false; go.textContent = '대상지 만들기'; }
        syncStatus(); return;
      }
      ui.closeDialog();
      app.load(res.P, { ctx: res.data });
      const est = res.data.bld.filter((b) => b.est).length;
      ui.toast(`실제 지역을 세웠습니다: 현황 건물 ${nf(res.data.bld.length)}동${res.data.par.length ? ` · 필지 ${nf(res.data.par.length)}` : ''}${res.nRoads ? ` · 도로 ${res.nRoads}개` : ''}.${est ? ` 높이 정보가 없는 ${nf(est)}동은 층수로 어림했습니다.` : ''}${app._ctxSaved === false ? ' 자료가 커서 브라우저에 다 저장하지 못했습니다. 작업 파일로 저장해 두세요.' : ''}`);
    }, 30);
  }
})(typeof window !== 'undefined' ? window : globalThis);
