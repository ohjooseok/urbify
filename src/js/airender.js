/* Urbify — AI 렌더(Gemini 이미지 모델)
   3D 화면의 지금 시점을 참고 그림으로 보내, 건물의 위치·높이·매스와 시점은 그대로 두고 재료·빛·하늘·사람만 더한 그림을 받는다.
   · 내 키로 바로: 사람마다 Google AI Studio에서 받은 Gemini API 키를 넣는다. 키는 이 브라우저(원하면 localStorage)에만 두고 Google API로만 보낸다.
     Nano Banana 계열 이미지 모델은 API 무료 등급이 없어 결제를 연결한 키가 필요하다(장당 약 $0.03~0.13, 2026-10 Google 가격표 기준).
   · 키 없이: 참고 그림을 저장하고 프롬프트를 복사해 Gemini 앱이나 Google AI Studio에 올린다.
   Claude 화면(미리보기) 안에서는 바깥 주소로 보내는 요청이 막혀 있어 '내 키로 바로'는 배포 페이지나 내려받은 HTML에서만 된다 */
(function (root) {
  'use strict';
  const UDS = root.UDS;
  const X = {};
  const LS_KEY = 'uds.gemini.key', LS_OPT = 'uds.airender.opt';
  const API = 'https://generativelanguage.googleapis.com';
  X.MODELS = [
    ['gemini-nano-banana-2.1', 'Nano Banana 2.1 · 권장(1K 약 $0.034/장)'],
    ['gemini-3-pro-image', 'Nano Banana Pro · 고품질(약 $0.134/장)'],
    ['gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite · 빠름(1K만)'],
  ];
  X.STYLES = {
    day: ['맑은 낮', 'a photorealistic architectural visualization on a clear sunny afternoon, natural daylight and soft realistic shadows'],
    dusk: ['해 질 녘', 'a photorealistic architectural visualization at golden hour, warm low sunlight, some windows softly lit from inside, street lights just turned on'],
    overcast: ['흐린 날·비 갠 뒤', 'a photorealistic architectural visualization under an overcast sky with diffuse light and wet pavement reflecting the buildings after rain'],
    winter: ['눈 내린 겨울', 'a photorealistic architectural visualization in winter with a light snow cover on roofs, sidewalks and open spaces, bare deciduous street trees'],
    night: ['밤 경관', 'a photorealistic night view, illuminated windows, street lights and shop fronts glowing, deep blue sky'],
    sketch: ['수채 투시도', 'a hand-drawn architectural perspective with fine ink lines and soft watercolor washes on textured paper'],
    model: ['흰 모형 사진', 'a photograph of a physical white architectural massing model (white foam and basswood) on a studio table with soft studio lighting'],
  };
  X.KEEP = {
    strict: 'STRICT GEOMETRY: keep exactly the same camera position, viewing angle, lens perspective and framing. Keep every building in the same position with the same footprint, height, number of floors, roof shape and massing; keep the street network, road widths, lane markings, crosswalks, blocks, parks, water bodies and tree positions where they are. Do not add, remove, merge, enlarge, shrink or reshape any building, and do not change the skyline.',
    loose: 'Keep the same camera viewpoint and composition, and keep the buildings in the same positions with the same overall height and massing. Facade articulation (balconies, setbacks of a few meters, roof details) may be elaborated.',
  };
  const opt = { style: 'day', keep: 'strict', model: X.MODELS[0][0], size: '1K', extra: '', remember: false };
  try { Object.assign(opt, JSON.parse(localStorage.getItem(LS_OPT) || '{}')); } catch (e) { /* 저장소 없음 */ }
  let key = '';
  try { key = localStorage.getItem(LS_KEY) || ''; if (key) opt.remember = true; } catch (e) { key = ''; }
  let snap = null, ref = null, busy = false, result = null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const saveOpt = () => { try { const o = { ...opt }; delete o.remember; localStorage.setItem(LS_OPT, JSON.stringify(o)); } catch (e) { /* 무시 */ } };

  /* 보낼 프롬프트(영어가 모델의 지시 이행이 가장 안정적). 사용자가 더한 말은 한국어 그대로 붙인다 */
  X.prompt = function () {
    const st = X.STYLES[opt.style] || X.STYLES.day;
    let p = 'The attached image is a screenshot of a 3D urban design massing model of a district in South Korea. ' +
      `Render it as ${st[1]}. ` + X.KEEP[opt.keep === 'loose' ? 'loose' : 'strict'] + ' ' +
      'Only add realistic materials and facade details that match each building\'s existing facade type (curtain wall, ribbon windows, punched windows, brick or stone), paving and road surface textures, lawn and tree foliage at the existing tree positions, sky, lighting, and a few pedestrians and cars at street level. ' +
      'Keep the proportions accurate (about 3 m per floor). Do not add any text, labels, logos, borders or user-interface elements.';
    if (ref) p += ' The second image is a mood reference only: borrow its atmosphere, color palette and material feel, but not its geometry or composition.';
    if (opt.extra.trim()) p += ` Additional instructions from the designer (may be written in Korean): ${opt.extra.trim()}`;
    return p;
  };

  /* 3D 화면을 참고 그림으로(긴 변 1600px 이하 JPEG) */
  function capture() {
    const app = UDS.app, r3 = app && app.r3;
    if (!r3 || !r3.ok || !r3.cv || r3.cv.width < 20) return null;
    const cv = r3.cv, w0 = cv.width, h0 = cv.height;
    // 화면이 작으면 같은 비율로 키워 한 번 더 그린다(긴 변 약 1600px): 참고 그림이 클수록 형태를 잘 지킨다
    const up = Math.min(3, 1600 / Math.max(w0, h0));
    let mx = 4096; try { mx = Math.min(4096, r3.gl.getParameter(r3.gl.MAX_RENDERBUFFER_SIZE) || 4096); } catch (e) { /* 무시 */ }
    if (up > 1.1) r3.forceSize = { w: Math.min(mx, Math.round(w0 * up)), h: Math.min(mx, Math.round(h0 * up)) };
    try { r3.draw(); } catch (e) { r3.forceSize = null; return null; }
    const k = Math.min(1, 1600 / Math.max(cv.width, cv.height));
    const c2 = document.createElement('canvas');
    c2.width = Math.round(cv.width * k); c2.height = Math.round(cv.height * k);
    const g = c2.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c2.width, c2.height);
    g.drawImage(cv, 0, 0, c2.width, c2.height);
    if (r3.forceSize) { r3.forceSize = null; r3.draw(); }
    let url = '';
    try { url = c2.toDataURL('image/jpeg', 0.92); } catch (e) { return null; }
    return { url, w: c2.width, h: c2.height, mime: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
  }
  /* 화면 비율에 가장 가까운 출력 비율 */
  const RATIOS = ['1:1', '5:4', '4:3', '3:2', '16:9', '21:9', '4:5', '3:4', '2:3', '9:16'];
  X.aspect = function (w, h) {
    const r = w / h;
    return RATIOS.reduce((m, s) => { const [a, b] = s.split(':').map(Number); const d = Math.abs(Math.log(a / b / r)); return !m || d < m.d ? { s, d } : m; }, null).s;
  };
  /* 응답에서 마지막 그림(생각 과정의 그림은 뺌): generateContent의 inlineData·inline_data, Interactions의 {type:'image', data} 모두 */
  X.findImage = function (j) {
    let out = null;
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.thought === true) return;
      const inl = o.inlineData || o.inline_data;
      if (inl && inl.data && /^image\//.test(inl.mimeType || inl.mime_type || 'image/png')) out = { mime: inl.mimeType || inl.mime_type || 'image/png', data: inl.data };
      else if (o.type === 'image' && typeof o.data === 'string' && o.data.length > 100) out = { mime: o.mime_type || o.mimeType || 'image/png', data: o.data };
      Object.keys(o).forEach((k) => { if (k !== 'inlineData' && k !== 'inline_data') walk(o[k]); });
    };
    walk(j);
    return out;
  };
  const textOf = (j) => { const t = []; const w = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(w); return; } if (typeof o.text === 'string' && !o.thought) t.push(o.text); Object.values(o).forEach(w); }; w(j); return t.join(' ').trim(); };
  function apiError(status, j) {
    const m = (j && j.error && (j.error.message || j.error.status)) || '';
    let s = `요청이 거절되었습니다(${status}).`;
    if (status === 400 && /API key|API_KEY|key not valid/i.test(m)) s = 'API 키가 맞지 않습니다. Google AI Studio에서 받은 키를 다시 확인하세요.';
    else if (status === 400) s = `보낸 내용을 모델이 받지 않았습니다(400). 모델이나 크기를 바꿔 보세요.`;
    else if (status === 401 || status === 403) s = '이 키로는 이 모델을 쓸 수 없습니다(결제 미연결·권한·지역). Google AI Studio에서 결제를 연결했는지 확인하세요.';
    else if (status === 404) s = '모델을 찾지 못했습니다(이름이 바뀌었을 수 있음). 다른 모델을 고르세요.';
    else if (status === 429) s = '사용 한도를 넘었습니다(무료 등급에는 이미지 모델이 없음). 결제·한도를 확인하거나 잠시 뒤 다시 하세요.';
    else if (status >= 500) s = 'Google 서버가 응답하지 못했습니다. 잠시 뒤 다시 하세요.';
    const e = new Error(s + (m && !/key/i.test(m) ? ` (응답: ${String(m).slice(0, 140)})` : ''));
    e.status = status;
    return e;
  }
  /* Gemini 호출: generateContent(v1beta → v1), 둘 다 없으면 Interactions API. 키는 머리말(x-goog-api-key)로만 보낸다 */
  X.call = async function (o) {
    const parts = [{ text: o.prompt }, { inline_data: { mime_type: o.img.mime, data: o.img.data } }];
    if (o.ref) parts.push({ inline_data: { mime_type: o.ref.mime, data: o.ref.data } });
    const size = /lite/.test(o.model) ? '1K' : o.size;
    const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: o.aspect, imageSize: size } } });
    const hdr = { 'Content-Type': 'application/json', 'x-goog-api-key': o.key };
    let lastText = '';
    for (const ver of ['v1beta', 'v1']) {
      const r = await fetch(`${API}/${ver}/models/${encodeURIComponent(o.model)}:generateContent`, { method: 'POST', headers: hdr, body, signal: o.signal });
      if (r.status === 404) continue;
      const j = await r.json().catch(() => null);
      if (!r.ok) throw apiError(r.status, j);
      const im = X.findImage(j);
      if (im) return im;
      lastText = textOf(j);
      break;
    }
    if (!lastText) { // 예전 방식이 없어졌으면 Interactions API로
      const input = [{ type: 'text', text: o.prompt }, { type: 'image', mime_type: o.img.mime, data: o.img.data }];
      if (o.ref) input.push({ type: 'image', mime_type: o.ref.mime, data: o.ref.data });
      const r = await fetch(`${API}/v1beta/interactions`, { method: 'POST', headers: hdr, signal: o.signal, body: JSON.stringify({ model: o.model, input, response_format: { type: 'image', aspect_ratio: o.aspect, image_size: size } }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw apiError(r.status, j);
      const im = X.findImage(j);
      if (im) return im;
      lastText = textOf(j);
    }
    throw new Error('그림 없이 글만 돌아왔습니다' + (lastText ? `: ${lastText.slice(0, 160)}` : '. 프롬프트를 바꿔 다시 해 보세요.'));
  };

  /* ---------- 창 ---------- */
  const inFrame = () => { try { return window.self !== window.top; } catch (e) { return true; } };
  function body() {
    const S = X.STYLES, sel = (k, v, list) => `<select data-ai="${k}">${list.map(([a, b]) => `<option value="${esc(a)}"${a === v ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
    const seg = (k, v, list) => `<span class="seg sm" role="group">${list.map(([a, b]) => `<button type="button" data-ai-seg="${k}" data-v="${a}" aria-pressed="${a === v}">${b}</button>`).join('')}</span>`;
    const frame = inFrame();
    return `<div class="air">` +
      `<div class="aircol"><div class="airimg">${snap ? `<img src="${snap.url}" alt="참고 그림: 3D 화면">` : '<p class="mut">3D 화면을 먼저 열어 주세요.</p>'}</div>` +
      `<div class="airrow"><span class="mut">참고 그림 · 3D 화면의 지금 시점${snap ? ` · ${snap.w}×${snap.h}px` : ''}</span><button type="button" class="btn sm" data-ai-do="recap">다시 찍기</button></div>` +
      `<div class="airres" ${result ? '' : 'hidden'}>${result ? `<img src="${result.url}" alt="AI 렌더 결과">` : ''}</div></div>` +
      `<div class="aircol">` +
      `<label class="airf"><span>분위기</span>${sel('style', opt.style, Object.keys(S).map((k) => [k, S[k][0]]))}</label>` +
      `<div class="airf"><span>형태 지키기</span>${seg('keep', opt.keep, [['strict', '엄격(매스·시점 고정)'], ['loose', '보통(입면은 다듬음)']])}</div>` +
      `<label class="airf col"><span>더할 말(선택)</span><textarea data-ai="extra" rows="2" placeholder="예: 1층 상가 앞에 사람들, 가로수는 은행나무 단풍">${esc(opt.extra)}</textarea></label>` +
      `<div class="airf"><span>분위기 참고(선택)</span><span class="airfile"><label class="btn sm">그림 고르기<input type="file" accept="image/*" data-ai="ref" hidden></label><span class="mut">${ref ? `${esc(ref.name)} <button type="button" class="lnk" data-ai-do="unref">빼기</button>` : '사진·스케치의 분위기만 빌림'}</span></span></div>` +
      `<div class="airsec"><b>내 Gemini API 키로 바로 만들기</b>` +
      `<label class="airf"><span>API 키</span><input type="password" data-ai="key" value="${esc(key)}" autocomplete="off" spellcheck="false" placeholder="Google AI Studio에서 받은 키"></label>` +
      `<label class="airchk"><input type="checkbox" data-ai="remember"${opt.remember ? ' checked' : ''}> 이 브라우저에 기억(공용 컴퓨터에서는 끄기)</label>` +
      `<label class="airf"><span>모델</span>${sel('model', opt.model, X.MODELS)}</label>` +
      `<div class="airf"><span>크기</span>${seg('size', opt.size, [['1K', '1K'], ['2K', '2K']])}</div>` +
      `<div class="airrow"><button type="button" class="btn pri" data-ai-do="go"${busy ? ' disabled' : ''}>${busy ? '만드는 중…' : 'AI 렌더 만들기'}</button>${result ? '<button type="button" class="btn" data-ai-do="save">결과 저장</button>' : ''}</div>` +
      `<p class="err" data-ai="msg" hidden></p>` +
      `<p class="mut">키 받기: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>(본인 Google 계정). 이미지 모델은 API 무료 등급이 없어 결제를 연결해야 하며, 장마다 요금이 듭니다. 키는 이 브라우저에만 두고 Google API(generativelanguage.googleapis.com)로만 보냅니다. 만든 그림에는 SynthID 표식이 들어갑니다.${frame ? ' <b>Claude 화면 안에서는 바깥으로 보내는 요청이 막혀 있어, 배포 페이지나 내려받은 HTML에서 쓰세요.</b>' : ''}</p></div>` +
      `<div class="airsec"><b>키 없이 Gemini 앱에서</b><p class="mut">참고 그림을 저장하고 프롬프트를 복사해 <a href="https://gemini.google.com/" target="_blank" rel="noopener">Gemini</a>나 <a href="https://aistudio.google.com/" target="_blank" rel="noopener">Google AI Studio</a>에 그림과 함께 넣습니다(앱의 하루 사용량 안에서 무료).</p>` +
      `<div class="airrow"><button type="button" class="btn" data-ai-do="savesnap">참고 그림 저장</button><button type="button" class="btn" data-ai-do="copy">프롬프트 복사</button></div>` +
      `<details class="airp"><summary>보낼 프롬프트</summary><textarea readonly rows="6" data-ai="prompt">${esc(X.prompt())}</textarea></details></div>` +
      `</div></div>`;
  }
  function render() {
    const d = UDS.ui.dialog('AI 렌더 · Gemini 이미지', body(), '<button class="btn" data-act="closedlg">닫기</button>');
    const dlg = d.querySelector('.dlg'); if (dlg) dlg.classList.add('wide');
    wire(d);
  }
  const setMsg = (d, s, ok) => { const m = d.querySelector('[data-ai="msg"]'); if (!m) return; m.hidden = !s; m.textContent = s || ''; m.classList.toggle('ok', !!ok); };
  const refreshPrompt = (d) => { const t = d.querySelector('[data-ai="prompt"]'); if (t) t.value = X.prompt(); };
  function wire(d) {
    d.querySelectorAll('[data-ai]').forEach((el) => {
      const k = el.dataset.ai;
      const on = () => {
        if (k === 'key') { key = el.value.trim(); if (opt.remember) { try { localStorage.setItem(LS_KEY, key); } catch (e) { /* 무시 */ } } return; }
        if (k === 'remember') { opt.remember = el.checked; try { if (opt.remember && key) localStorage.setItem(LS_KEY, key); else localStorage.removeItem(LS_KEY); } catch (e) { /* 무시 */ } return; }
        if (k === 'ref') {
          const f = el.files && el.files[0]; if (!f) return;
          if (f.size > 8e6) { setMsg(d, '참고 그림은 8MB 이하로 넣어 주세요.'); return; }
          const rd = new FileReader();
          rd.onload = () => { const u = String(rd.result); ref = { name: f.name, mime: f.type || 'image/jpeg', data: u.slice(u.indexOf(',') + 1) }; render(); };
          rd.readAsDataURL(f);
          return;
        }
        if (k in opt) { opt[k] = el.value; saveOpt(); refreshPrompt(d); }
      };
      el.addEventListener(el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'file' && el.type !== 'checkbox') ? 'input' : 'change', on);
    });
    d.querySelectorAll('[data-ai-seg]').forEach((b) => b.addEventListener('click', () => {
      opt[b.dataset.aiSeg] = b.dataset.v; saveOpt();
      d.querySelectorAll(`[data-ai-seg="${b.dataset.aiSeg}"]`).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      refreshPrompt(d);
    }));
    d.querySelectorAll('[data-ai-do]').forEach((b) => b.addEventListener('click', () => act(b.dataset.aiDo, d)));
  }
  const fileBase = () => (UDS.app.P.meta.title || '도시설계').replace(/[\\/:*?"<>|\s]+/g, '_');
  async function act(a, d) {
    const ui = UDS.ui;
    if (a === 'recap') { snap = capture(); render(); return; }
    if (a === 'unref') { ref = null; render(); return; }
    if (a === 'copy') { ui.copyText(X.prompt(), '프롬프트를 복사했습니다. Gemini에 참고 그림과 함께 붙여 넣으세요.'); return; }
    if (a === 'savesnap') { if (snap) ui.saveDataUrl(`${fileBase()}_3D참고.jpg`, snap.url); return; }
    if (a === 'save') { if (result) ui.saveDataUrl(`${fileBase()}_AI렌더.${/png/.test(result.mime) ? 'png' : 'jpg'}`, result.url); return; }
    if (a !== 'go' || busy) return;
    if (!snap) { setMsg(d, '3D 화면을 먼저 열고 [다시 찍기]를 누르세요.'); return; }
    if (!key) { setMsg(d, 'API 키를 넣어 주세요(Google AI Studio에서 받음). 키 없이 하려면 아래의 Gemini 앱 방법을 쓰세요.'); return; }
    busy = true;
    const btn = d.querySelector('[data-ai-do="go"]'); if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }
    setMsg(d, '');
    try {
      const im = await X.call({ key, model: opt.model, size: opt.size, prompt: X.prompt(), img: snap, ref, aspect: X.aspect(snap.w, snap.h) });
      result = { mime: im.mime, url: `data:${im.mime};base64,${im.data}` };
      busy = false;
      render();
      ui.toast('AI 렌더를 만들었습니다. [결과 저장]으로 내려받습니다.');
    } catch (e) {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'AI 렌더 만들기'; }
      const net = e && (e.name === 'TypeError' || /fetch|network|Load failed/i.test(e.message || ''));
      setMsg(d, net ? '바깥 주소로 보내는 요청이 막혔습니다. Claude 화면(미리보기) 안에서는 쓸 수 없으니 배포 페이지나 내려받은 HTML에서 하거나, 아래 Gemini 앱 방법을 쓰세요.' : (e && e.message) || '만들지 못했습니다.');
    }
  }
  X.open = function () {
    const app = UDS.app, cv = app.r3 && app.r3.cv;
    result = null;
    if (!cv || cv.clientWidth < 60 || cv.clientHeight < 40) { // 3D 화면이 닫혀 있으면 평면과 나란히 연 뒤에 찍는다
      app.state.view = 'split'; const el = document.getElementById('app'); if (el) el.dataset.view = 'split';
      window.dispatchEvent(new Event('resize')); app.invalidate(7);
      snap = null; render();
      setTimeout(() => { snap = capture(); render(); }, 420);
      return;
    }
    snap = capture();
    render();
  };
  UDS.AIRender = X;
})(typeof window !== 'undefined' ? window : globalThis);
