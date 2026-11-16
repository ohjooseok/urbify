/* Urbify — 화면 구성: 왼쪽 메뉴, 속성·지표·점검 패널, 단면 머리줄, 팝오버·대화상자 */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C, M = UDS.Model, Dv = UDS.Derive, app = UDS.app;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = U.esc, picto = UDS.picto, icon = UDS.icon;
  const ui = (UDS.ui = {});
  const trim = (v, d) => U.fmt(v, d === undefined ? 2 : d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const pct = (v) => trim(v * 100, 1) + '%';
  const canDownload = (() => { try { return window.self === window.top; } catch (e) { return false; } })();
  const STYLE_KEYS = ['material', 'wallColor', 'wwr', 'win', 'ground', 'sign', 'canopy', 'roof'];

  /* ---------- 입력 양식 ---------- */
  function mkForm() {
    const b = [];
    const bind = (fn) => { b.push(fn); return b.length - 1; };
    return {
      b, bind,
      // note: 설명은 이름 위 풍선 도움말로(점선 밑줄). '!'로 시작하면 늘 보이는 알림(경고·지금 값)
      row(label, inner, note) {
        const vis = note && note[0] === '!';
        return `<div class="row"><span class="lb${note && !vis ? ' tp' : ''}"${note && !vis ? ` data-tip="${esc(note)}"` : ''}>${label}</span><span class="ctl">${inner}</span>${vis ? `<span class="note">${note.slice(1)}</span>` : ''}</div>`;
      },
      numIn(v, set, o) {
        o = o || {};
        const sc = o.scale || 1;
        const i = bind((raw) => {
          if (raw === '' && o.nullable) { set(null); return; }
          let x = parseFloat(raw); if (isNaN(x)) return false;
          if (o.min !== undefined) x = Math.max(o.min, x);
          if (o.max !== undefined) x = Math.min(o.max, x);
          if (o.int) x = Math.round(x);
          set(U.round(x * sc, 4));
        });
        const val = v === null || v === undefined ? '' : U.round(v / sc, 3);
        return `<span class="num"><input type="number" inputmode="decimal" data-b="${i}" data-k="${esc(o.k || '')}" value="${val}" step="${o.step || 1}"${o.min !== undefined ? ` min="${o.min}"` : ''}${o.max !== undefined ? ` max="${o.max}"` : ''}${o.ph ? ` placeholder="${esc(o.ph)}"` : ''} aria-label="${esc(o.aria || o.k || '')}">${o.unit ? `<i>${o.unit}</i>` : ''}</span>`;
      },
      num(label, v, set, o) { o = o || {}; o.k = o.k || label; return this.row(label, this.numIn(v, set, o), o.note); },
      selIn(v, set, opts, o) {
        o = o || {};
        const i = bind((raw) => set(raw));
        return `<select data-b="${i}" data-k="${esc(o.k || '')}" aria-label="${esc(o.aria || o.k || '')}">${opts.map(([val, lab]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
      },
      sel(label, v, set, opts, o) { o = o || {}; o.k = o.k || label; return this.row(label, this.selIn(v, set, opts, o), o.note); },
      chk(label, v, set, o) {
        o = o || {};
        const i = bind((raw) => set(!!raw));
        return this.row(label, `<label class="sw"><input type="checkbox" data-b="${i}" data-k="${esc(o.k || label)}"${v ? ' checked' : ''}><span>${o.on || (v ? '켬' : '끔')}</span></label>`, o.note);
      },
      text(label, v, set, o) {
        o = o || {};
        const i = bind((raw) => set(String(raw)));
        return this.row(label, `<input type="text" data-b="${i}" data-k="${esc(o.k || label)}" value="${esc(v || '')}" maxlength="40">`);
      },
      range(label, v, set, o) {
        const i = bind((raw) => set(parseFloat(raw)));
        const shown = o.fmt === 'time' ? UDS.fmtTime(v) : v + (o.sfx || '');
        return this.row(label, `<span class="rg"><input type="range" data-b="${i}" data-live="1" data-sfx="${esc(o.sfx || '')}" data-fmt="${esc(o.fmt || '')}"${o.fmt === 'time' ? ' data-sun="1"' : ''} data-k="${esc(o.k || label)}" min="${o.min}" max="${o.max}" step="${o.step}" value="${v}"><output>${shown}</output></span>`, o.note);
      },
      color(label, v, set, o) {
        o = o || {};
        const i = bind((raw) => set(raw));
        return this.row(label, `<span class="cw"><input type="color" data-b="${i}" data-live="1" data-k="${esc(o.k || label)}" value="${esc(v)}"><code>${esc(v)}</code></span>`);
      },
      ro(label, html) { return `<div class="row ro"><span class="lb">${label}</span><span class="ctl val">${html}</span></div>`; },
      head(title, extra) { return `<div class="h"><b>${title}</b>${extra || ''}</div>`; },
    };
  }
  function wireForm(el) {
    const run = (t, live) => {
      const f = el._form; if (!f) return;
      const fn = f.b[+t.dataset.b]; if (!fn) return;
      const r = fn(t.type === 'checkbox' ? t.checked : t.value);
      if (r === false) return;
      if (r === 'view' && live) { app.invalidate(7); return; }
      if (live) app.liveChange(); else app.changed();
    };
    el.addEventListener('change', (e) => { const t = e.target.closest('[data-b]'); if (t) run(t, false); });
    el.addEventListener('input', (e) => {
      const t = e.target.closest('[data-b][data-live]'); if (!t) return;
      if (t.dataset.fmt === 'date') { // 날짜 막대: 춘분·하지·추분·동지 가까이 가면 붙는다
        const v = UDS.snapDay(+t.value); if (+t.value !== v) t.value = v;
        const row = t.closest('.drow');
        if (row) { const o = row.querySelector('output'); if (o) o.textContent = dateText(v); row.querySelectorAll('[data-act="setday"]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.arg === v ? 'true' : 'false')); }
        run(t, true); ui.sunLive(); return;
      }
      const out = t.parentNode.querySelector('output') || (t.closest('.drow') && t.closest('.drow').querySelector('output')); if (out) out.textContent = t.dataset.fmt === 'time' ? UDS.fmtTime(parseFloat(t.value)) : t.value + (t.dataset.sfx || '');
      if (t.dataset.sun) ui.sunLive();
      const cd = t.parentNode.querySelector('code'); if (cd) cd.textContent = t.value;
      run(t, true);
    });
  }
  /* 설명을 풍선 도움말로만 보이는 작은 물음표(누르지 않아도 마우스를 올리면 뜸) */
  const swc = (c) => (UDS.TH ? UDS.TH.c(c) : c); // 견본 색: 평면에 그려지는 색과 같게(그림을 어둡게 그릴 때만 바뀜)
  const tipI = (t) => `<span class="itip" data-tip="${esc(t)}" tabindex="0" role="img" aria-label="${esc(t)}">${icon('help', 14)}</span>`;
  const phead = (ic, title, sub, actions) => `<div class="phead">${picto(ic, 30)}<div class="pt"><b>${esc(title)}</b><span>${sub || ''}</span></div><div class="pa">${actions || ''}</div></div>`;

  /* ---------- 왼쪽 메뉴 ----------
     넓은 화면: 맨 위에 로고, 그 아래 메뉴 막대(프로젝트·편집·보기·도움말), 되돌리기와 도구 셋(선택·이동·지우개) 한 줄,
     누르면 펼쳐지는 묶음(Draw: 대상지·도로·건물·시설물·조경), 그 아래 View & Visibility(음영분석·3D 오브젝트·레이어, 맨 아래 화면 배치·표현).
     메뉴가 좁아지는 화면(픽토그램 띠, 휴대폰 아래 막대)에서는 로고·메뉴 막대·화면 설정은 위쪽 막대로 가고, 묶음을 누르면 항목이 작은 창으로 뜬다 */
  const MENUS = [['project', '프로젝트'], ['edit', '편집'], ['view', '보기'], ['help', '도움말']];
  const PAL_GROUPS = [
    { k: 'site', name: '대상지', short: '대상지', ic: 'site' },
    { k: 'road', name: '도로', short: '도로', ic: 'roadl' },
    { k: 'bld', name: '건물', short: '건물', ic: 'bldl' },
    { k: 'furn', name: '가로시설물', short: '시설물', ic: 'benchl' },
    { k: 'land', name: '조경', short: '조경', ic: 'treel' },
  ];
  // 보기 묶음(넓은 화면): sw는 머리의 켜고 끄는 스위치
  const XGROUPS = [
    { k: 'shade', name: '음영분석', ic: 'sun', sw: true },
    { k: 'obj', name: '3D 오브젝트', ic: 'traffic', sw: true },
    { k: 'lyr', name: '레이어', ic: 'layers' },
  ];
  const BUILD_USES = C.USE_ORDER.filter((k) => C.BLD_DEFAULT[k]); // 건물을 세우는 용도(공원·광장 같은 열린 용도 제외)
  const FURN = ['light', 'bench', 'busstop', 'bollard', 'bikerack', 'pm', 'smartpole', 'transformer', 'hydrant'];
  const SCENE_NAME = { standard: '도시(가상)', oldtown: '구도심(가상)', random: '임의생성(가상)', blank: '빈 대상지', import: '지도 캡처', real: '실제 지역' };
  ui.palOpen = { site: true, road: false, bld: false, furn: false, land: false };
  ui.xOpen = { shade: false, obj: false, lyr: false }; // 보기 묶음은 도구 묶음과 따로 펼친다
  const VNAME = { '2d': '평면', '3d': '3D', sec: '단면' };
  /* 화면마다 표현(채색·선 도면)을 따로 고르는 픽토그램 한 쌍(평면·3D 이름표 옆, 단면 머리줄) */
  const vmodeHTML = (k) => `<span class="seg mode vmode" role="group" aria-label="${VNAME[k]} 표현">` +
    [['color', 'shade', '채색'], ['line', 'wire', '선 도면']].map(([m, ic, n]) => `<button data-vmode="${m}" data-vk="${k}" aria-pressed="${app.modeOf(k) === m}" aria-label="${VNAME[k]} ${n}" data-tip="${VNAME[k]} ${n}">${picto(ic, 22)}</button>`).join('') + '</span>';
  /* 대상지 단추의 열쇠: 임의생성은 성격(도시·구도심)까지 */
  const sceneKey = (P) => (P.meta.scene === 'random' ? 'random:' + (P.meta.family || (P.meta.pattern === 'old' ? 'old' : 'new')) : P.meta.scene);
  const palNarrow = () => window.matchMedia('(max-width: 1120px)').matches;
  const palItem = (key, ic, name, note) => `<button class="pi" data-pal="${key}" aria-pressed="false">${picto(ic, 26)}<span>${name}</span>${note ? `<small>${note}</small>` : ''}</button>`;
  function palBody(k) {
    if (k === 'site') {
      const sc = (key, ic, name, note) => `<button class="pi" data-scene="${key}" aria-pressed="false">${picto(ic, 26)}<span>${name}</span>${note ? `<small>${note}</small>` : ''}</button>`;
      // 도시(가상)·구도심(가상) 옆의 주사위: 같은 성격의 대상지를 누를 때마다 새로 만든다
      const dice = (fam, name) => `<button class="pdice" data-scene="random:${fam}" aria-pressed="false" aria-label="${name} 임의생성" data-tip="${name} 임의생성: 누를 때마다 도로망·건물을 새로 만듭니다">${picto('dice', 26)}</button>`;
      return `<div class="pirow">${sc('standard', 'grid', SCENE_NAME.standard)}${dice('new', SCENE_NAME.standard)}</div>` + `<div class="pirow">${sc('oldtown', 'oldtown', SCENE_NAME.oldtown)}${dice('old', SCENE_NAME.oldtown)}</div>` +
        sc('blank', 'blank', SCENE_NAME.blank) + sc('real', 'city', '실제 지역 고르기…') + sc('import', 'map', '지도 캡처로 만들기…');
    }
    if (k === 'road') {
      const item = (key) => {
        const p = C.PRESETS[key];
        const W = p.segs.reduce((a, g) => a + g.w, 0);
        return palItem('road:' + key, UDS.PRESET_ICON[key], p.name.replace(/ [\d.]+m$/, ''), trim(W) + 'm');
      };
      // 도로·단지 안 길(단지내도로·오솔길)·회전교차로를 한 목록으로(회전교차로는 맨 아래). 단지 안 길을 고르면 그 아래에 그릴 모양(꺾은선·모서리 둥글게·곡선)
      return C.PRESET_ORDER.map(item).join('') + C.INNER_ORDER.map(item).join('') +
        `<div class="pshape" hidden><span class="seg sm" role="group" aria-label="단지 안 길 모양">${Object.keys(C.SHAPES).map((s2) => `<button data-act="innershape" data-arg="${s2}" aria-pressed="false">${C.SHAPES[s2].replace('(베지에)', '')}</button>`).join('')}</span></div>` +
        palItem('tool:rabout', 'rabout', '회전교차로');
    }
    if (k === 'bld') {
      // 용도별 건물: 이름 옆에 토지이용 색과 기본 층수. 그 아래에 놓는 범위(획지 하나·가구 전체)와 크기·밀도 입력
      return BUILD_USES.map((key) => `<button class="pi" data-pal="build:${key}" aria-pressed="false">${picto(UDS.USE_ICON[key] || 'building', 26)}<span>${C.USES[key].name}</span><small><i class="usw" style="background:${swc(C.USES[key].color)}"></i>${C.BLD_DEFAULT[key].floors}층</small></button>`).join('') +
        `<div class="popt">${app.P ? bldOptHTML() : ''}</div>`;
    }
    if (k === 'furn') return FURN.map((key) => palItem('place:' + key, C.OBJECTS[key].icon, C.OBJECTS[key].name)).join('');
    // 조경: 교목(수종)·관목, 수공간(종류: 원형·둥근 사각·자유형 연못, 하천 — 도로·길이 건너면 다리). 교목처럼 누른 뒤 아래 목록에서 종류를 고른다
    return palItem('place:tree', 'tree', '교목') +
      `<label class="psub"><span>수종</span><select class="palsp" aria-label="교목 수종">${C.TREE_ORDER.map((key) => `<option value="${key}">${C.TREES[key].name} · 수관 ${C.TREES[key].crown}m</option>`).join('')}</select></label>` +
      palItem('place:shrub', 'shrub', '관목 군식') +
      palItem('tool:water', 'pond', '수공간') +
      `<label class="psub"><span>종류</span><select class="palwk" aria-label="수공간 종류">${['circle', 'rect', 'free', 'river'].map((k) => `<option value="${k}">${M.WATER[k]}${k === 'free' || k === 'river' ? ' · 곡선' : ''}</option>`).join('')}</select></label>`;
  }
  ui.buildPalette = function () {
    const tool = (key, ic, name, kc) => `<button class="tl" data-pal="tool:${key}" aria-pressed="false" aria-label="${name}" data-tip="${name} (${kc})">${picto(ic, 30)}<span>${name}</span></button>`;
    // 이름과 메뉴 막대(넓은 화면)
    let h = '<div class="phd"><div class="pbrand"><b>Urbify</b><i>Interactive Urban Design Platform</i></div>' +
      `<nav class="mbar" aria-label="메뉴">${MENUS.map(([k, n]) => `<button class="mb" data-act="menu" data-arg="${k}" aria-haspopup="menu" aria-expanded="false">${n}</button>`).join('')}</nav></div>`;
    // 되돌리기·다시 하기(넓은 화면) + 도구 셋
    h += '<div class="ptools" role="group" aria-label="도구">' +
      `<span class="ur"><button class="tl ub" data-act="undo" data-tip="되돌리기 (Ctrl+Z)" aria-label="되돌리기">${picto('undo', 30)}</button><button class="tl rb" data-act="redo" data-tip="다시 하기 (Ctrl+Shift+Z)" aria-label="다시 하기">${picto('redo', 30)}</button></span>` +
      tool('select', 'select', '선택', 'V') + tool('move', 'move', '이동', 'M') + tool('erase', 'erase', '지우개', 'E') + '</div>';
    h += '<div class="pscroll">';
    h += '<div class="psec" role="heading" aria-level="2">계획</div>'; // 대상지~조경: 그리고 놓는 메뉴
    PAL_GROUPS.forEach((g) => {
      h += `<div class="pgrp" data-grp="${g.k}"><button class="pgh" data-act="palgrp" data-arg="${g.k}" aria-expanded="false" title="${g.name}">${icon(g.ic, 17)}<b><span class="lg">${g.name}</span><span class="sm">${g.short}</span></b><i class="pgv"></i>${icon('right', 13)}</button>` +
        `<div class="pgb"><div class="pgi">${palBody(g.k)}</div></div></div>`;
    });
    h += '<div class="psec pvsec" role="heading" aria-level="2">보기·분석</div>'; // 음영분석·3D 오브젝트·레이어와 맨 아래 화면 배치·표현 다섯
    // 음영분석 · 3D 오브젝트 · 레이어: 펼치는 묶음(넓은 화면). 앞의 둘은 펼치지 않고도 켜고 끄는 스위치가 머리에 있다
    XGROUPS.forEach((g) => {
      h += `<div class="pgrp xg" data-grp="${g.k}"><div class="pgx"><button class="pgh" data-act="palgrp" data-arg="${g.k}" aria-expanded="false" title="${g.name}">${icon(g.ic, 17)}<b><span class="lg">${g.name}</span><span class="sm">${g.name}</span></b><i class="pgv"></i>${icon('right', 13)}</button>` +
        (g.sw ? `<button class="psw" role="switch" aria-checked="false" data-act="xsw" data-arg="${g.k}" aria-label="${g.name} 켜기" data-tip="${g.name} 켜기"><i></i></button>` : '') +
        `</div><div class="pgb"><div class="pgi"><div class="pform" data-xbody="${g.k}"></div></div></div></div>`;
    });
    // 보기(넓은 화면, 레이어 아래 맨 끝): 화면 배치 셋과 모든 화면의 표현 둘을 한 틀에 담고 사이를 선으로 나눈다
    const pvb = (attr, ic, tip) => `<button ${attr} aria-label="${tip}" data-tip="${tip}">${picto(ic, 26)}</button>`;
    h += '<div class="pview" role="group" aria-label="보기"><div class="pvframe seg mode">' +
      pvb('data-view-btn="split" aria-pressed="true"', 'vsplit', '평면과 3D 나란히') + pvb('data-view-btn="2d" aria-pressed="false"', 'vplan', '평면만') + pvb('data-view-btn="3d" aria-pressed="false"', 'v3d', '3D만') +
      '<span class="pvdiv" aria-hidden="true"></span>' +
      pvb('data-mode="color" aria-pressed="true"', 'shade', '모든 화면 채색') + pvb('data-mode="line" aria-pressed="false"', 'wire', '모든 화면 선 도면') + '</div></div>';
    h += '</div>';
    $('#palette').innerHTML = h;
    $$('#palette [data-xbody]').forEach((el) => wireForm(el));
  };
  /* 건물 놓기 묶음 아래의 입력: '획지 하나'는 층수·길이·깊이, '가구 전체'는 건폐율·용적률·최고 층수 */
  function bldOptHTML() {
    const st = app.state, bo = st.buildOpt, use = st.buildUse, def = C.BLD_DEFAULT[use] || C.BLD_DEFAULT.res, T = app.fillTargets(use);
    const sc = (v, n) => `<button data-act="bscope" data-arg="${v}" aria-pressed="${bo.scope === v}">${n}</button>`;
    const num = (key, val, o) => `<input type="number" class="pin" data-bopt="${key}" value="${val}" min="${o.min}" max="${o.max}" step="${o.step || 1}" inputmode="decimal" aria-label="${o.aria}"${o.ph ? ` placeholder="${o.ph}"` : ''}>`;
    const TIPS = { 길이: '도로를 따라 잰 길이 · 비우면 획지에 맞춤', 깊이: '도로에서 안쪽으로 잰 깊이 · 비우면 획지에 맞춤', 건폐율: '가구 안을 누르면 이 상한 안에서 획지를 모두 채움', 용적률: '이 상한을 넘지 않는 가장 높은 층수로 세움', 최고: '최고 층수' };
    const row = (lb, inp, unit) => `<label class="por"><span${TIPS[lb] ? ` class="tp" data-tip="${TIPS[lb]}"` : ''}>${lb}</span>${inp}<i>${unit}</i></label>`;
    let h = `<div class="poh"><span class="seg sm" role="group" aria-label="놓는 범위">${sc('lot', '획지 하나')}${sc('block', '가구 전체')}${sc('draw', '직접 그리기')}</span></div>`;
    if (bo.scope === 'draw') {
      h += '<div class="pog">' + row('층수', num('floors', bo.floors || def.floors, { min: 1, max: 80, aria: '층수' }), '층') + '</div>' +
        `<p class="pon">평면에서 모서리를 차례로 누르고 첫 점을 누르면(또는 Enter) 건물이 됩니다. 숫자를 치면 그 길이로 놓습니다. ${tipI('획지마다 건물 하나입니다. 그린 모양이 든 획지의 건물이 되고, 획지를 넘는 부분은 잘립니다. 한 획지에 여러 동을 두려면 먼저 획지를 나누세요.')}</p>`;
    } else if (bo.scope === 'lot') {
      h += '<div class="pog">' + row('층수', num('floors', bo.floors || def.floors, { min: 1, max: 80, aria: '층수' }), '층') +
        row('길이', num('len', bo.len || '', { min: 0, max: 300, aria: '건물 길이(도로 방향)', ph: '자동' }), 'm') +
        row('깊이', num('depth', bo.depth != null ? bo.depth || '' : def.depth || '', { min: 0, max: 150, aria: '건물 깊이', ph: '자동' }), 'm') +
        `<button class="ibtn sm swp" data-act="bswap" title="길이와 깊이 맞바꾸기" aria-label="길이와 깊이 맞바꾸기">${icon('swap', 13)}</button></div>`;
    } else {
      h += '<div class="pog">' + row('건폐율', num('bcr', T.bcr, { min: 5, max: 100, aria: '건폐율 상한' }), '%') +
        row('용적률', num('far', T.far, { min: 10, max: 2000, step: 10, aria: '용적률 상한' }), '%') +
        row('최고', num('fmax', T.fmax, { min: 1, max: 80, aria: '최고 층수' }), '층') + '</div>' +
        `<p class="pon"><button class="lnk" data-act="fillreset" data-tip="건폐율·용적률·최고 층수를 학습용 기본값으로">학습용 기본값</button></p>`;
    }
    const nv = app.D ? app.vacantBlocks().length : 0;
    h += `<button class="btn sm pfill" data-act="fillvacant"${nv ? '' : ' disabled'} title="건물이 없는 빈 가구를 지금 고른 용도로 한꺼번에 채웁니다">${icon('gridl', 14)}${nv ? `빈 가구 ${nv}곳 모두 채우기` : '채울 빈 가구 없음'}</button>`;
    return h;
  }
  /* 다시 그리기: 입력 칸에 글자를 치는 중이면 건너뛴다. force(범위·맞바꾸기 단추)이면 다시 그리고 누른 단추에 초점을 돌려 준다 */
  ui.poptRefresh = function (force) {
    const ae = document.activeElement;
    $$('.popt').forEach((el) => {
      const inside = ae && el.contains(ae);
      if (inside && !force) return;
      const key = inside ? (ae.dataset.bopt ? `[data-bopt="${ae.dataset.bopt}"]` : ae.dataset.act ? `[data-act="${ae.dataset.act}"]${ae.dataset.arg ? `[data-arg="${ae.dataset.arg}"]` : ''}` : '') : '';
      el.innerHTML = bldOptHTML();
      if (key) { const n = $(key, el); if (n) { try { n.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } } }
    });
  };
  const palGroupOf = (tool, placeType) => (tool === 'road' || tool === 'rabout' ? 'road' : tool === 'build' ? 'bld' : tool === 'water' ? 'land' : tool === 'place' ? (placeType === 'tree' || placeType === 'shrub' ? 'land' : 'furn') : '');
  /* 자판(R 등)으로 도구를 바꿨을 때도 그 도구가 든 묶음이 펼쳐져 있게 한다 */
  /* 묶음은 한 번에 하나만 펼친다(메뉴가 길어지지 않게) */
  const palOnly = (k) => { Object.keys(ui.palOpen).forEach((x) => { ui.palOpen[x] = x === k; }); };
  ui.palReveal = function (tool, placeType) { const k = palGroupOf(tool, placeType); if (k) palOnly(k); };
  ui.palette = function () {
    const st = app.state, P = app.P;
    const cur = st.tool === 'road' ? 'road:' + st.roadPreset : st.tool === 'build' ? 'build:' + st.buildUse : st.tool === 'place' ? 'place:' + st.placeType : 'tool:' + st.tool;
    $$('[data-pal]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.pal === cur ? 'true' : 'false'));
    { const inner = st.tool === 'road' && C.PRESETS[st.roadPreset] && C.PRESETS[st.roadPreset].inner, ik = inner ? st.roadPreset : 'estate4', sh = st.innerShape[ik] || C.PRESETS[ik].shape;
      $$('[data-act="innershape"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.arg === sh ? 'true' : 'false'));
      $$('.pshape').forEach((el) => { el.hidden = !inner; }); } // 모양 단추는 단지 안 길을 그릴 때만
    $$('[data-act="waterkind"]').forEach((b) => b.setAttribute('aria-pressed', st.tool === 'water' && b.dataset.arg === st.waterKind ? 'true' : 'false'));
    $$('select.palsp').forEach((sp) => { sp.value = st.treeSpecies; });
    $$('select.palwk').forEach((sp) => { sp.value = st.waterKind || 'circle'; });
    // 묶음 단추: 펼침 상태, 쓰고 있는 도구가 든 묶음, 지금 고른 값
    const act = palGroupOf(st.tool, st.placeType);
    const val = {
      site: P ? SCENE_NAME[P.meta.scene] || '' : '',
      road: act === 'road' ? (st.tool === 'rabout' ? '회전교차로' : C.PRESETS[st.roadPreset].name.replace(/ [\d.]+m$/, '')) : '',
      bld: act === 'bld' ? C.USES[st.buildUse].name : '',
      furn: act === 'furn' ? C.OBJECTS[st.placeType].name : '',
      land: act === 'land' ? (st.tool === 'water' ? M.WATER[st.waterKind] : st.placeType === 'tree' ? C.TREES[st.treeSpecies].name : C.OBJECTS[st.placeType].name) : '',
    };
    $$('#palette .pgrp').forEach((g) => {
      const k = g.dataset.grp, open = k in ui.xOpen ? !!ui.xOpen[k] : !!ui.palOpen[k];
      g.classList.toggle('open', open); g.classList.toggle('act', k === act);
      $('.pgh', g).setAttribute('aria-expanded', open ? 'true' : 'false');
      $('.pgv', g).textContent = val[k] || '';
    });
    ui.poptRefresh();
    ui.xRefresh();
  };
  /* 보기 묶음(음영분석·3D 오브젝트·레이어): 머리 스위치와 펼친 내용. 펼치지 않은 묶음은 펼칠 때 그린다.
     밀고 있는 막대(시각·밀도)가 있으면 그 묶음은 다시 그리지 않는다(끌던 손잡이가 사라지지 않게) */
  ui.xRefresh = function (force) {
    if (!app.P || !app.D) return;
    ui.xSwitch();
    const st = app.state, S = app.P.settings;
    const shOn = !!st.layers.shadows && !(app.modeOf('2d') === 'line' && app.modeOf('3d') === 'line'); // 음영분석이 꺼져 있으면 날짜·시각을 적지 않는다
    $$('#palette .pgrp.xg').forEach((g) => {
      const k = g.dataset.grp, v = $('.pgv', g);
      if (v) v.textContent = k === 'shade' && shOn ? shadeLabel(S) : '';
    });
    const ae = document.activeElement;
    $$('#palette [data-xbody]').forEach((el) => {
      const k = el.dataset.xbody;
      if (!ui.xOpen[k] && !force) { el._stale = true; return; }
      if (ae && el.contains(ae) && ae.type === 'range' && !force) return;
      el._stale = false;
      if (k === 'shade') { const f = mkForm(); el._form = f; el.innerHTML = sunFields(f, true, true) + anaHTML(); }
      else if (k === 'obj') el.innerHTML = objHTML();
      else el.innerHTML = layerRows().map(([lk, n]) => `<label class="lyr"><input type="checkbox" data-layer="${lk}"${st.layers[lk] ? ' checked' : ''}><span>${n}</span></label>`).join('');
    });
    ui.trafficCounts();
  };
  const shadeLabel = (S) => { const d = UDS.dayOf(S); return `${UDS.keyDay(d) || UDS.fmtDate(d, true)} ${UDS.fmtTime(S.hour)}`; };
  const dateText = (d) => UDS.fmtDate(d) + (UDS.keyDay(d) ? ` · ${UDS.keyDay(d)}` : '');
  /* 시각·날짜 막대를 끄는 동안: 음영분석 머리의 글자와 건물 태양궤적도만 바로 고친다 */
  ui.sunLive = function () {
    const S = app.P && app.P.settings; if (!S) return;
    const g = $('#palette .pgrp.xg[data-grp="shade"] .pgv'); if (g) g.textContent = app.state.layers.shadows ? shadeLabel(S) : '';
    ui.spRefresh();
  };
  /* 보기 묶음 머리의 스위치만 맞춘다(위쪽 막대를 다시 그릴 때마다 부름) */
  const xWas = {}; // 보기 묶음 기능이 켜져 있었는가(켜짐 → 꺼짐일 때 펼친 메뉴를 접는다)
  ui.xSwitch = function () {
    const st = app.state; if (!app.P) return;
    const shOn = !!st.layers.shadows, allLine = app.modeOf('2d') === 'line' && app.modeOf('3d') === 'line';
    $$('#palette .psw[data-act="xsw"]').forEach((b) => {
      const k = b.dataset.arg;
      const on = k === 'shade' ? shOn && !allLine : !!st.traffic.on;
      const live = k === 'shade' ? shOn : !!st.traffic.on;
      if (xWas[k] && !live && ui.xOpen[k]) { // 기능을 끄면 펼쳐 둔 메뉴도 접는다(스위치·레이어·자판 어느 쪽으로 꺼도)
        ui.xOpen[k] = false;
        const g = b.closest('.pgrp'); if (g) { g.classList.remove('open'); const hb = $('.pgh', g); if (hb) hb.setAttribute('aria-expanded', 'false'); }
      }
      xWas[k] = live;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.disabled = k === 'shade' && allLine;
      b.dataset.tip = k === 'shade' ? (allLine ? '선 도면에서는 그림자를 그리지 않습니다' : shOn ? '그림자 끄기' : '그림자 켜기') : st.traffic.on ? '사람·차량 끄기(3D)' : '사람·차량 보이기(3D)';
    });
    // 음영분석 머리의 날짜·시각(동지 12:00 등)은 켜 있을 때만
    const g = $('#palette .pgrp.xg[data-grp="shade"] .pgv'); if (g) g.textContent = shOn && !allLine ? shadeLabel(app.P.settings) : '';
  };
  const layerRows = () => {
    const rows = [['buildings', '건물'], ['trees', '수목'], ['furniture', '가로시설물·가로등·전주'], ['shadows', '그림자(채색에서만)'], ['labels', '글자(도로·용도 이름, 평면)'], ['utilities', '지하시설(평면에 표시, 3D는 투시)']];
    if (app.underlay) rows.push(['underlay', '지도 밑그림 겹쳐 보기(평면)']);
    if (app.ctxData()) { rows.push(['ctx', '현황 건물(실제 지역)']); if (app.ctxData().par.length) rows.push(['parcels', '지적(필지 경계·지목)']); }
    return rows;
  };
  const swb = (act, arg, on, label) => `<button class="psw sm" role="switch" aria-checked="${on ? 'true' : 'false'}" data-act="${act}"${arg ? ` data-arg="${arg}"` : ''} aria-label="${label}"><i></i></button>`;
  /* 조도분석: 태양 궤적도 · 일조시간 지도 · 가로등 조도 지도 */
  function anaHTML() {
    const A = app.state.ana, X = UDS.Ana;
    let h = '<div class="psub2">조도분석</div>';
    const row = (k, name, note, extra) => `<div class="xrow">${swb('ana', k, A[k], name + ' 켜기')}<div><b class="tp" data-tip="${note}">${name}</b>${A[k] && extra ? extra : ''}</div></div>`;
    const sp = X ? X.sunNow(app.P.settings) : null;
    h += row('sunpath', '태양 궤적도', '평면·3D에 동지·춘분·하지의 해의 길과 시각을 그림', sp ? `<em>지금 고도 ${trim(sp.alt, 1)}° · 방위 ${trim(sp.az, 0)}° (${sp.dir})</em>` : '');
    let sh = '';
    if (A.sunhours && X) {
      const r = X.sunHours(app);
      sh = X.legendHTML('sun') + (r ? `<em>열린 땅 기준 · 4시간 이상 ${pct(r.stats.ok4)} · 연속 2시간 이상 ${pct(r.stats.ok2)} · 둘 다 못 미침 ${pct(r.stats.bad)}</em>${r.doy === 356 ? '' : '<em class="sm">날짜를 동지로 두면 판례 기준과 견줌</em>'}` : '');
    }
    h += row('sunhours', '일조시간', '8~16시 사이 해가 드는 시간(건물 그림자만, 수목 제외). 동지 9~15시 연속 2시간 또는 8~16시 총 4시간이 판례의 수인한도', sh);
    let lx = '';
    if (A.lux && X) {
      const r = X.lux(app);
      lx = X.legendHTML('lux') + (r ? `<em>도로·보도 평균 ${trim(r.stats.avg, 1)}lx · 최소 ${trim(r.stats.min, 1)}lx · 3lx 미만 ${pct(r.stats.dark)}</em>` : '');
    }
    h += row('lux', '가로등 조도(야간)', '가로등·보행등이 켜졌을 때 바닥 밝기(lx) · 점광원 어림(반사 무시)', lx);
    return h;
  }
  /* 3D 오브젝트: 보행자·차량·개인형 이동장치의 밀도(막대를 0에 두면 없음) */
  function objHTML() {
    const T = app.state.traffic;
    const rg = (k, name, v, cls, unit, tip) => `<label class="tset"><span${tip ? ` data-tip="${tip}"` : ''}>${name}</span><input type="range" data-tset="${k}" min="0" max="1" step="0.05" value="${v}" aria-label="${name} 밀도"><output class="${cls}">0${unit}</output></label>`;
    return '<div class="tsets">' + rg('ped', '보행자', T.ped, 'tc-ped', '명') + rg('car', '차량', T.car, 'tc-car', '대') +
      rg('pm', '개인형 이동장치', T.pmd, 'tc-pm', '대', '자전거·전동킥보드. 자전거도로로 다님') + '</div>';
  }
  function palPop(anchor, k) {
    const g = PAL_GROUPS.find((x) => x.k === k);
    const p = ui.pop(anchor, `<div class="pt2">${g.name}</div><div class="palpop">${palBody(k)}</div>`, 'palp', isMobile() ? '' : 'right');
    if (p) { ui.palette(); ui.top(); }
  }

  /* ---------- 위쪽 막대 ---------- */
  ui.top = function () {
    const st = app.state, P = app.P;
    if (!P) return;
    const sk = sceneKey(P);
    $$('[data-scene]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.scene === sk ? 'true' : 'false'));
    $$('button[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === st.mode ? 'true' : 'false'));
    $$('button[data-vmode]').forEach((b) => b.setAttribute('aria-pressed', app.modeOf(b.dataset.vk) === b.dataset.vmode ? 'true' : 'false'));
    // 테마 단추: 지금 테마의 반대(다크면 해, 라이트면 달)
    const TH = UDS.TH, thb = $('#btnTheme');
    if (TH && thb) { const ic = TH.dark ? 'sun' : 'moon', nm = TH.dark ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기'; if (thb.dataset.icn !== ic) { thb.dataset.icn = ic; thb.innerHTML = icon(ic, 17); } thb.title = nm; thb.setAttribute('aria-label', nm); }
    $$('.ub').forEach((b) => { b.disabled = app.hi <= 0; });
    $$('.rb').forEach((b) => { b.disabled = app.hi >= app.hist.length - 1; });
    const a = $('#app');
    a.dataset.view = st.view; a.dataset.mview = st.mview; a.dataset.mode = st.mode;
    // 패널 접기(넓은 화면): 가장자리 손잡이의 방향과 이름
    if (st.hideL) a.dataset.hidel = '1'; else delete a.dataset.hidel;
    if (st.hideR) a.dataset.hider = '1'; else delete a.dataset.hider;
    $$('.edgeh').forEach((b) => {
      const L = b.dataset.arg === 'L', hid = L ? st.hideL : st.hideR;
      const ic = (L ? !hid : hid) ? 'left' : 'right';
      const nm = `${L ? '왼쪽 메뉴' : '오른쪽 패널'} ${hid ? '펼치기' : '접기'}`;
      b.title = nm; b.setAttribute('aria-label', nm); b.setAttribute('aria-expanded', hid ? 'false' : 'true');
      if (b.dataset.icn !== ic) { b.dataset.icn = ic; b.innerHTML = icon(ic, 14); }
    });
    if (!ui._sheetBusy) a.dataset.sheet = st.sheet || 'closed';
    // 크게 보기 단추(평면·3D·단면)
    const mx = st.max || '';
    if (mx) a.dataset.max = mx; else delete a.dataset.max;
    $$('button[data-act="max"]').forEach((b) => {
      const on = b.dataset.arg === mx, ic = on ? 'shrink' : 'expand';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const lb = b.dataset.lb || ''; // 평면·3D는 화면 이름표가 곧 단추
      b.title = on ? '원래 화면으로 (Esc)' : '이 화면만 크게 보기';
      b.setAttribute('aria-label', (lb ? lb + ' ' : '') + (on ? '원래 화면으로' : '이 화면만 크게 보기'));
      if (b.dataset.icn !== ic) { b.dataset.icn = ic; b.innerHTML = (lb ? `<span>${lb}</span>` : '') + icon(ic, lb ? 13 : 14); }
    });
    $$('[data-mview-btn]').forEach((b) => b.setAttribute('aria-selected', b.dataset.mviewBtn === st.mview ? 'true' : 'false'));
    $$('[data-view-btn]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.viewBtn === st.view ? 'true' : 'false'));
    $$('.lyrb').forEach((ly) => ly.classList.toggle('on', !!st.layers.utilities));
    // 사람·차량 단추와 밀도 막대
    const tf = st.traffic;
    $$('button[data-act="traffic"]:not(.mm)').forEach((b) => { b.setAttribute('aria-pressed', tf.on ? 'true' : 'false'); if (b.dataset.tip) b.dataset.tip = tf.on ? '사람·차량 끄기(3D)' : '사람·차량 보이기(3D)'; else b.title = tf.on ? '사람·차량 끄기' : '사람·차량 보이기'; });
    const tb = $('#trafbar'); if (tb) { tb.hidden = !tf.on; if (tf.on) ui.trafficCounts(); }
    // 그림자 단추: 선 도면에서는 그리지 않으므로 잠그되, 켜 둔 설정은 그대로 둔다(채색으로 돌아오면 다시 보임)
    const shOn = !!st.layers.shadows;
    ui.xSwitch();
    // 평면 머리의 글자 단추: 도로·용도 이름과 시설물 글자를 켜고 끈다(레이어의 '글자'와 같은 값)
    $$('button[data-act="labels"]').forEach((b) => { const on = !!st.layers.labels; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.title = on ? '글자 끄기(도로·용도 이름)' : '글자 켜기(도로·용도 이름)'; });
    $$('button[data-act="shadow"]:not(.mm)').forEach((b) => {
      // 평면·3D 머리의 단추는 그 화면의 표현을, 왼쪽 메뉴의 단추는 두 화면이 모두 선 도면인지를 본다
      const vk = b.closest('#v2d') ? '2d' : b.closest('#v3d') ? '3d' : '';
      const lineMode = vk ? app.modeOf(vk) === 'line' : app.modeOf('2d') === 'line' && app.modeOf('3d') === 'line';
      b.disabled = lineMode;
      b.setAttribute('aria-pressed', shOn && !lineMode ? 'true' : 'false');
      const t = lineMode ? '선 도면에서는 그림자를 그리지 않습니다' : shOn ? '그림자 끄기' : '그림자 켜기';
      if (b.dataset.tip) b.dataset.tip = t; else b.title = t;
    });
  };

  /* 단축키 등 바깥에서 메뉴 동작을 부를 때 */
  ui.run = function (act, arg) { const fn = acts[act]; if (fn) fn(arg, document.body); };
  /* 화면 배치(나란히·평면·3D)와 표현(채색·선 도면): 왼쪽 아래 단추, 위쪽 막대, 보기 메뉴가 함께 쓴다 */
  ui.setView = function (v) {
    const st = app.state;
    if (!['split', '2d', '3d'].includes(v) || st.view === v) return;
    st.view = v; ui.top();
    setTimeout(() => { app.r2.resize(); if (app.r2.W > 20) app.r2.fit(app.P.site, 1.14); app.invalidate(7); }, 40);
  };
  /* 표현 바꾸기: k가 있으면 그 화면만('2d' 평면 · '3d' · 'sec' 단면), 없으면 모든 화면 */
  ui.setMode = function (m, k) {
    const st = app.state;
    if (!['color', 'line'].includes(m)) return;
    const ks = k ? [k] : ['2d', '3d', 'sec'];
    let ch = false;
    ks.forEach((x) => { if (st.modes[x] !== m) { st.modes[x] = m; ch = true; } });
    const all = st.modes['2d'];
    st.mode = ['3d', 'sec'].every((x) => st.modes[x] === all) ? all : 'mixed';
    if (!ch) { ui.top(); return; }
    ui.top();
    if (ks.includes('3d')) app.rebuild3d();
    app.invalidate(ks.includes('2d') ? 1 | 2 | 4 : ks.includes('3d') ? 2 : 4);
    if (ks.includes('sec')) ui.secHead();
    ui.sunPopRefresh();
    if (st.tab === 'props' && !st.sel) ui.pane();
  };

  /* ---------- 도구 안내 ---------- */
  ui.hint = function () {
    const st = app.state, el = $('#hint');
    let h = '';
    if (st.tool === 'road') {
      const n = st.drawRoad && st.drawRoad.pts ? st.drawRoad.pts.length : 0;
      const p = C.PRESETS[st.roadPreset];
      const lb = st.lenBuf;
      const shp = p.inner ? st.innerShape[st.roadPreset] || p.shape : null;
      h = p.inner
        ? `<b>${p.name.replace(/ [\d.]+m$/, '')} · ${C.SHAPES[shp]}</b><span>${lb ? `<em class="lenin">길이 ${esc(lb)}m</em> Enter로 그 자리에 놓습니다(Esc: 지우기).` : n ? `다음 점을 누르세요${shp === 'curve' ? '(찍은 점을 지나는 곡선)' : shp === 'round' ? '(꺾인 곳은 둥글게)' : ''}. 다른 길에 닿으면 이어지며 끝나고, Enter나 [여기서 끝내기]로 획지 안에서 끝낼 수 있습니다.` : '획지 안이나 기존 도로 위에서 시작점을 누르세요. 가구는 나누지 않습니다.'}</span>`
        : `<b>${p.name}</b><span>${lb ? `<em class="lenin">길이 ${esc(lb)}m</em> Enter로 그 자리에 놓습니다(Esc: 지우기).` : n ? '다음 점을 누르세요. 마우스로 방향을 정하고 숫자를 치면 그 길이(m)로 놓습니다. 다른 도로나 대상지 경계에 닿으면 끝나고, 대상지 밖까지 그리면 대상지가 넓어집니다.' : '시작점을 누르세요. 같은 유형 도로의 끝에서 시작하면 그 도로를 이어 그립니다.'}</span>`;
      if (n >= 2) h += '<button class="btn sm pri" data-act="roadfinish">여기서 끝내기</button>';
      h += `<button class="btn sm" data-act="roadcancel">${n ? '취소' : '그만'}</button>`;
    } else if (st.tool === 'build') {
      const T = app.fillTargets(st.buildUse);
      const sc = st.buildOpt.scope, nm = C.USES[st.buildUse].name;
      if (sc === 'draw') {
        const n = st.drawBld ? st.drawBld.pts.length : 0, lb = st.lenBuf;
        h = `<b>건물 그리기 · ${nm}</b><span>${lb ? `<em class="lenin">길이 ${esc(lb)}m</em> Enter로 그 자리에 놓습니다(Esc: 지우기).` : n ? `점 ${n}개. ${n >= 3 ? '첫 점을 누르거나 Enter를 치면 닫혀 건물이 됩니다.' : '다음 모서리를 누르세요.'} 숫자를 치면 그 길이(m)로 놓고, 획지 축에 맞춰 붙습니다(Shift: 15°).` : '건물 모서리를 차례로 누르세요. 닫으면 그 모양의 건물이 획지에 섭니다(획지마다 건물 하나).'}</span>` +
          (n >= 3 ? '<button class="btn sm pri" data-act="blddrawfinish">닫기</button>' : '') + `<button class="btn sm" data-act="${n ? 'blddrawcancel' : 'toolselect'}">${n ? '취소' : '그만'}</button>`;
      } else h = sc === 'block'
        ? `<b>가구 채우기 · ${nm}</b><span>채울 가구 안을 평면이나 3D에서 누르세요. 건폐율 ${T.bcr}% · 용적률 ${T.far}% · 최고 ${T.fmax}층 기준.</span><button class="btn sm" data-act="toolselect">그만</button>`
        : `<b>건물 놓기 · ${nm}</b><span>세울 획지를 평면이나 3D에서 누르세요. 다른 용도의 건물이 있으면 바뀝니다.</span><button class="btn sm" data-act="toolselect">그만</button>`;
    } else if (st.tool === 'water') {
      const k = st.waterKind, nm = M.WATER[k], n = st.drawWater && st.drawWater.pts ? st.drawWater.pts.length : 0;
      if (k === 'circle' || k === 'rect') h = `<b>${nm}</b><span>놓을 자리를 평면이나 3D에서 누르세요. 크기는 놓은 뒤 오른쪽 [속성]에서 바꿉니다.</span><button class="btn sm" data-act="toolselect">그만</button>`;
      else h = `<b>${nm} · 곡선</b><span>${n ? `점 ${n}개. ${k === 'free' ? (n >= 3 ? '첫 점을 누르거나 Enter를 치면 닫혀 연못이 됩니다.' : '다음 점을 누르세요.') : n >= 2 ? 'Enter나 [여기서 끝내기]로 마칩니다. 대상지 밖까지 그려도 됩니다.' : '다음 점을 누르세요.'} Backspace는 마지막 점을 지웁니다.` : k === 'free' ? '연못 가장자리가 지날 점을 차례로 누르세요(찍은 점을 지나는 닫힌 곡선).' : '하천 중심선이 지날 점을 차례로 누르세요(찍은 점을 지나는 곡선, 폭 12m).'}</span>` +
        (n >= (k === 'free' ? 3 : 2) ? '<button class="btn sm pri" data-act="waterfinish">여기서 끝내기</button>' : '') + `<button class="btn sm" data-act="watercancel">${n ? '취소' : '그만'}</button>`;
    } else if (st.tool === 'place') {
      h = `<b>${C.OBJECTS[st.placeType].name}</b><span>놓을 자리를 평면이나 3D에서 누르세요.</span><button class="btn sm" data-act="toolselect">그만</button>`;
    } else if (st.tool === 'rabout') {
      const n = (app.D.rabCand || []).length;
      h = `<b>회전교차로</b><span>${n ? `동그라미로 표시된 교차점·도로 끝(${n}곳)이나 도로 중간을 누르면 그 자리에 만듭니다.` : '도로 위를 누르면 그 자리에 만듭니다.'} 만든 뒤 [이동] 도구로 끌어 옮깁니다.</span><button class="btn sm" data-act="toolselect">그만</button>`;
    } else if (st.tool === 'bldpaste' && st.bldClip) {
      const cl = st.bldClip, mv = cl.mode === 'move';
      h = `<b>${mv ? '건물 옮기기' : '건물 복사'}</b><span>${mv ? '놓을 자리를 누르세요. 같은 획지 안이면 그 안에서 옮기고(건축선 후퇴·이격 범위 안), 다른 획지를 누르면 그 획지로 옮겨 누른 자리 가까이에 앉힙니다.' : `복사할 획지를 누르세요${cl.n ? `(${cl.n}곳 복사함)` : ''}. 여러 곳에 이어서 놓을 수 있고, 새 획지에 맞춰 앉습니다.`}</span><button class="btn sm" data-act="toolselect">${mv || !cl.n ? '취소' : '마치기'}</button>`;
    } else if (st.tool === 'erase') {
      h = '<b>지우개</b><span>도로·건물·요소를 누르면 지워집니다.</span><button class="btn sm" data-act="toolselect">그만</button>';
    } else if (st.tool === 'move') {
      h = '<b>이동</b><span>요소·도로·회전교차로·건물을 끌어 옮깁니다. 흰 꼭짓점을 끌면 그 점만, 건물 변을 끌면 깊이·길이가 바뀝니다(Alt·Ctrl을 누르고 건물을 놓으면 복사).</span><button class="btn sm" data-act="toolselect">그만</button>';
    }
    el.innerHTML = h; el.hidden = !h;
  };

  /* 고른 건물 곁의 작은 도구 막대: 돌리기·뒤집기·옮기기·복사. 평면과 3D에서 그 건물 위에 띄운다 */
  ui.bldBar = function (view) {
    const st = app.state, D = app.D, sel = st.sel;
    const b0 = D && sel && sel.type === 'building' && (st.tool === 'select' || st.tool === 'move') && !st.bldOp && !st.bldBusy && !st.bldDrag && app.selList().length <= 1 ? D.buildings.find((x) => x.lotId === sel.id) : null;
    const b = b0 && !b0.cx ? b0 : null; // 단지(여러 동)는 돌리기·뒤집기·옮기기 막대를 띄우지 않는다
    if (!b && view === '2d') { const o = document.getElementById('bldbar3'); if (o && !o.hidden) o.hidden = true; }
    const el = document.getElementById(view === '3d' ? 'bldbar3' : 'bldbar2'); if (!el) return;
    const r = b ? (view === '3d' ? app.r3 : app.r2) : null;
    const box = r && r.bldScreenBox ? r.bldScreenBox(b) : null;
    if (!box) { if (!el.hidden) el.hidden = true; return; }
    const cfg = b.cfg || {};
    const key = [b.lotId, b.custom ? 1 : 0, b.xf ? 1 : 0, cfg.flipU ? 1 : 0, cfg.flipV ? 1 : 0].join('|');
    if (el.dataset.k !== key) {
      const B = (act, arg, ic, label, on) => `<button class="ibtn sm" data-act="${act}" data-arg="${esc(b.lotId)}|${arg}"${on !== undefined ? ` aria-pressed="${!!on}"` : ''} data-tip="${label}" aria-label="${label}">${icon(ic, 16)}</button>`;
      el.innerHTML = B('bldx', 'rot|15', 'rotl', '왼쪽으로 15° 돌리기') + B('bldx', 'rot|-15', 'rotr', '오른쪽으로 15° 돌리기') +
        B('bldx', 'flipU', 'flipu', '좌우 뒤집기', b.custom ? undefined : !!cfg.flipU) + B('bldx', 'flipV', 'flipv', '앞뒤 뒤집기', b.custom ? undefined : !!cfg.flipV) +
        '<i class="sep"></i>' + B('bldclip', 'move', 'move', '옮기기(같은 획지 안이나 다른 획지 · 놓을 자리를 누름)') + B('bldclip', 'copy', 'copy', '다른 획지에 복사(여러 곳)') +
        (b.xf ? '<i class="sep"></i>' + B('bldx', 'reset', 'reset', '처음대로(돌림·뒤집기·옮김 없애기)') : '');
      el.dataset.k = key;
    }
    if (el.hidden) el.hidden = false;
    const host = el.parentElement, W = host.clientWidth, H = host.clientHeight;
    const bw = el.offsetWidth || 230, bh = el.offsetHeight || 38;
    let x = (box.x0 + box.x1) / 2 - bw / 2, y = box.y0 - bh - 12;
    if (y < 46) y = box.y1 + 12;
    if (y + bh > H - 6) y = Math.max(46, Math.min(box.y0 - bh - 12, H - bh - 6));
    x = Math.max(6, Math.min(W - bw - 6, x));
    el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  };

  /* 블록 정보에서 원래 건물·획지로 돌아가는 단추 */
  ui.backBtn = function () {
    const st = app.state, bk = st.back;
    if (!bk || !(st.sel && st.sel.type === 'block' && st.sel.id === bk.to)) return '';
    const l = app.D && app.D.lots.find((x) => x.id === bk.sel.id);
    const nm = l ? `${(C.USES[l.use] || { name: '' }).name} ${l.building && bk.sel.type === 'building' ? '건물' : '획지'}` : '이전 선택';
    return `<button class="btn sm back" data-act="goback" title="${esc(nm)}(으)로 돌아가기">${icon('left', 13)}돌아가기</button>`;
  };

  /* ---------- 단면 머리줄 ---------- */
  ui.secHead = function () {
    const el = $('#sechead'); if (!el || !app.D) return;
    const ae = document.activeElement;
    const k = ae && el.contains(ae) ? ae.dataset.k : null;
    const f = mkForm(); el._form = f;
    const road = app.secRoad(), st = app.state;
    if (!road) { el.innerHTML = '<div class="secrow"><b class="st">가로 단면</b><span class="mut">도로가 없습니다. 왼쪽 메뉴의 [도로 그리기]에서 위계를 골라 그려 보세요.</span></div>'; return; }
    const info = app.D.roadInfo.get(road.id);
    if (!info) return;
    const lay = info.lay;
    const sPos = st.secS === null || st.secS === undefined ? info.len / 2 : st.secS;
    const sc = Dv.sectionContext(app.P, app.D, road.id, sPos);
    let h = '<b class="st">Section A–A′</b>' + vmodeHTML('sec');
    h += f.selIn(road.id, (v) => { app.state.secSeen = true; app.select({ type: 'road', id: v }); app.zoomToRoad(v); return false; }, app.P.roads.map((r) => [r.id, r.name]), { k: 'secroad', aria: '단면을 볼 도로' });
    h += `<span class="dimtag">${trim(lay.W)}m<i>${info.cls}</i></span>`;
    if (sc && sc.DH) h += `<span class="dh" title="마주 보는 건물 사이 거리(D)를 건물 높이(H)로 나눈 값. 1 안팎이면 균형, 작을수록 둘러싸인 느낌이 강함">D/H <b>${trim(sc.DH, 2)}</b><i>D ${trim(sc.Dist, 1)}m ÷ H ${trim(sc.Hmean, 1)}m</i></span>`;
    const zone = UDS.SEG_ZONE || {};
    const pedW = road.segs.reduce((s2, g) => s2 + (['ped', 'green', 'mix'].includes(zone[g.type]) ? g.w : 0), 0);
    h += `<span class="dh ped" title="보도·보행로·시설대·녹지(보차혼용 포함)에 돌아간 폭의 비율">보행·녹지 <b>${trim((pedW / lay.W) * 100, 0)}%</b></span>`;
    h += '<span class="grow"></span>';
    // 표시 항목: 넓으면 둘째 줄 오른쪽에 단추 셋으로, 좁으면 눈 단추 하나로(누르면 고르는 창)
    const sh = st.secShow, nOff = ['text', 'dim', 'util'].filter((x) => sh[x] === false).length;
    const tg = (x, name, tip) => `<button data-act="secshow" data-arg="${x}" aria-pressed="${sh[x] !== false}" data-tip="${tip}">${name}</button>`;
    const togs = `<span class="sectog"><span class="cl">표시</span><span class="seg" role="group" aria-label="단면에 표시할 정보">${tg('text', '텍스트', '건물 이름표, 구간 이름, 연석·관 이름 등 글자를 모두 켜고 끕니다')}${tg('dim', '치수', '구간 폭 치수 열과 그 아래 도로 폭, 도로경계선, 건축선 후퇴 치수를 켜고 끕니다')}${tg('util', '지하시설물', '지하 관로·맨홀·빗물받이와 깊이 눈금을 켜고 끕니다')}</span></span>`;
    h += `<button class="ibtn sm sectogm${nOff ? ' on' : ''}" data-act="secshowpop" title="단면에 표시할 정보" aria-label="단면에 표시할 정보">${icon('eye', 15)}</button>`;
    h += `<button class="btn sm" data-act="addseg">${icon('plus', 13)}구간</button><button class="btn sm" data-act="addutil">${icon('plus', 13)}지하시설</button>`;
    const mxs = st.max === 'sec';
    h += `<button class="ibtn sm" data-act="max" data-arg="sec" data-icn="${mxs ? 'shrink' : 'expand'}" aria-pressed="${mxs}" title="${mxs ? '원래 화면으로 (Esc)' : '이 화면만 크게 보기'}" aria-label="${mxs ? '원래 화면으로' : '이 화면만 크게 보기'}">${icon(mxs ? 'shrink' : 'expand', 14)}</button>`;
    // 둘째 줄: 고른 구간·관로의 조작 줄. 높이를 늘 같게 두어 단면이 위아래로 밀리지 않게 함
    const seg = road.segs.find((s) => s.id === st.selSeg);
    const ut = seg ? null : (road.utils || []).find((u) => u.id === st.selUtil);
    let c = '';
    if (seg) {
      const def = C.SEG[seg.type];
      c += '<span class="segctl">' + picto(UDS.SEG_ICON[seg.type], 22) +
        f.selIn(seg.type, (v) => { seg.type = v; if (v === 'lane' || v === 'bus') { if (!seg.dir) seg.dir = 1; } else delete seg.dir; }, C.SEG_ORDER.map((t) => [t, C.SEG[t].name]), { k: 'hseg', aria: '구간 유형' }) +
        '<span class="cl">폭</span>' +
        `<button class="ibtn sm" data-act="segstep" data-arg="-0.25" title="0.25m 좁히기" aria-label="0.25m 좁히기">${icon('minus', 13)}</button>` +
        f.numIn(seg.w, (v) => { seg.w = v; }, { min: 0.25, max: 40, step: 0.25, unit: 'm', k: 'hsegw', aria: `${def.name} 폭` }) +
        `<button class="ibtn sm" data-act="segstep" data-arg="0.25" title="0.25m 넓히기" aria-label="0.25m 넓히기">${icon('plus', 13)}</button>` +
        (seg.dir ? `<button class="btn sm" data-act="segdir" data-arg="${seg.id}" title="통행 방향 바꾸기">${seg.dir > 0 ? '가는 방향 ↑' : '오는 방향 ↓'}</button>` : '') +
        '<span class="vr"></span>' +
        `<button class="ibtn sm" data-act="segmove" data-arg="-1" title="왼쪽으로 옮기기" aria-label="왼쪽으로 옮기기">${icon('left', 13)}</button>` +
        `<button class="ibtn sm" data-act="segmove" data-arg="1" title="오른쪽으로 옮기기" aria-label="오른쪽으로 옮기기">${icon('right', 13)}</button>` +
        `<button class="ibtn sm" data-act="segdel" data-arg="${seg.id}" title="구간 지우기" aria-label="구간 지우기">${icon('trash', 13)}</button>` +
        `</span><span class="mut keytip">${tipI('← → 이웃 구간 · + − 폭 0.25m · Delete 지우기')}</span>`;
    } else if (ut) {
      const def = C.UTIL[ut.type];
      c += `<span class="segctl"><i class="udot" style="background:${swc(def.color)}"></i><b class="un2">${def.name}</b>` +
        '<span class="cl">위치</span>' + f.numIn(ut.off, (v) => { ut.off = v; }, { min: -40, max: 40, step: 0.1, unit: 'm', k: 'huo', aria: '중심선에서의 위치' }) +
        '<span class="cl">깊이</span>' + f.numIn(ut.depth, (v) => { ut.depth = v; }, { min: 0.3, max: 3.1, step: 0.1, unit: 'm', k: 'hud', aria: '묻는 깊이' }) +
        '<span class="cl">관경</span>' + f.numIn(ut.dia, (v) => { ut.dia = v; }, { min: 50, max: 3000, step: 50, unit: 'mm', scale: 0.001, k: 'huz', aria: '관경(mm)' }) +
        '<span class="vr"></span>' +
        `<button class="ibtn sm" data-act="utildel" data-arg="${ut.id}" title="지우기" aria-label="${def.name} 지우기">${icon('trash', 13)}</button>` +
        `</span><span class="mut keytip">${tipI('위치는 중심선에서 왼쪽 +, 오른쪽 − · 관을 끌어서도 옮김')}</span>`;
    } else c += `<span class="mut segtip">구간을 누르면 편집 ${tipI('구간을 눌러 유형과 폭을 바꾸고, 구간 사이 경계선을 끌어 폭을 나눕니다. 땅속 관은 끌어서 옮깁니다.')}</span>`;
    h = `<div class="secrow">${h}</div><div class="secrow ctx${seg || ut ? ' on' : ''}">${c}${togs}</div>`;
    el.innerHTML = h;
    if (k) { const n = $$('[data-k]', el).find((x) => x.dataset.k === k); if (n) { try { n.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } } }
  };

  /* ---------- 오른쪽 패널 ---------- */
  ui.pane = function () {
    const el = $('#pane'); if (!el || !app.D) return;
    const st = app.state;
    const ae = document.activeElement;
    const k = ae && el.contains(ae) ? ae.dataset.k : null;
    const nSel = app.selList().length;
    const key = st.tab + '|' + (nSel > 1 ? 'multi' : st.sel ? st.sel.type + st.sel.id : '');
    const keep = el._key === key ? el.scrollTop : 0;
    const focusSeg = el._seg !== (st.selSeg || st.selUtil || '');
    el._key = key; el._seg = st.selSeg || st.selUtil || '';
    const f = mkForm(); el._form = f;
    el.innerHTML = st.tab === 'metrics' ? paneMetrics(f) : st.tab === 'checks' ? paneChecks() : paneProps(f);
    el.scrollTop = keep;
    if (k) { const n = $$('[data-k]', el).find((x) => x.dataset.k === k); if (n) { try { n.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } } }
    if (focusSeg && st.tab === 'props' && el.clientHeight > 80) {
      // 패널 안에서만 굴림(scrollIntoView는 화면 전체를 밀어 올릴 수 있음)
      const on = $('.segrow.on, .utilrow.on', el);
      if (on) { const r = on.getBoundingClientRect(), pr = el.getBoundingClientRect(); if (r.top < pr.top + 4) el.scrollTop += r.top - pr.top - 10; else if (r.bottom > pr.bottom - 4) el.scrollTop += r.bottom - pr.bottom + 10; }
    }
    $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === st.tab ? 'true' : 'false'));
    const n = app.D.checks.filter((c) => c.level !== 'info').length;
    const badge = $('#ckn'); if (badge) { badge.textContent = n; badge.hidden = !n; badge.classList.toggle('bad', app.D.checks.some((c) => c.level === 'error')); }
  };
  ui.sheetPeek = function () {
    const st = app.state, el = $('#selname'); if (!el) return;
    let s = '';
    const t = st.sel, nSel = app.selList().length;
    if (nSel > 1) s = `${nSel}개 선택`;
    else if (t) {
      if (t.type === 'road') { const r = app.road(t.id); s = r ? r.name : ''; }
      else if (t.type === 'object') { const o = app.P.objects.find((x) => x.id === t.id); s = o ? C.OBJECTS[o.type].name : ''; }
      else if (t.type === 'block') s = '가구';
      else if (t.type === 'ctx') { const b = app.ctxBld(t.id); s = b ? b.nm || '현황 건물' : ''; }
      else if (t.type === 'rab') s = '회전교차로';
      else if (t.type === 'tree') { const tr = app.treeOf(t.id); s = tr ? (C.TREES[tr.species] || {}).name || '수목' : ''; }
      else { const l = app.D.lots.find((x) => x.id === t.id); s = l ? (l.building ? '건물' : C.USES[l.use].name) : ''; }
    }
    el.textContent = s ? ' · ' + s : '';
  };

  /* 여럿을 함께 골랐을 때: 무엇을 골랐는지 보여 주고, 한꺼번에 지우거나 하나씩 뺀다 */
  function paneMulti(f, list) {
    const P = app.P, D = app.D;
    const n = { road: 0, bld: 0, lot: 0, obj: 0 };
    const rows = list.map((t) => {
      let ic = 'road', name = '', sub = '';
      if (t.type === 'road') { const r = app.road(t.id); const info = r && D.roadInfo.get(r.id); ic = (r && UDS.PRESET_ICON[r.preset]) || 'road'; name = r ? r.name : '도로'; sub = info ? `${info.cls} ${trim(info.lay.W)}m` : '도로'; n.road++; }
      else if (t.type === 'object') { const o = P.objects.find((x) => x.id === t.id); const def = (o && C.OBJECTS[o.type]) || { name: '요소', icon: 'road' }; ic = def.icon; name = def.name; sub = o && o.type === 'tree' ? (C.TREES[o.species] || C.TREES.zelkova).name : ''; n.obj++; }
      else if (t.type === 'block') { ic = 'plaza'; name = '가구'; sub = '지울 수 없음'; }
      else if (t.type === 'ctx') { const b = app.ctxBld(t.id); ic = 'city'; name = b && b.nm ? b.nm : '현황 건물'; sub = b ? `${b.fl}층 · ${trim(b.h, 1)}m` : ''; n.ctx = (n.ctx || 0) + 1; }
      else if (t.type === 'rab') { const rb = D.rabs.find((x) => x.id === t.id); ic = 'rabout'; name = '회전교차로'; sub = rb ? `지름 ${trim(rb.d, 0)}m` : ''; n.rab = (n.rab || 0) + 1; }
      else if (t.type === 'water') { const w = app.water(t.id); ic = w ? UDS.WATER_ICON[w.kind] : 'pond'; name = w ? M.WATER[w.kind] : '수공간'; sub = ''; n.water = (n.water || 0) + 1; }
      else if (t.type === 'tree') { const tr = app.treeOf(t.id); ic = 'tree'; name = tr ? (C.TREES[tr.species] || {}).name || '수목' : '수목'; sub = tr ? (tr.kind === 'street' ? '가로수' : tr.kind === 'rab' ? '중앙섬' : '공원') : ''; n.tree = (n.tree || 0) + 1; }
      else {
        const l = D.lots.find((x) => x.id === t.id), u = (l && C.USES[l.use]) || { name: '' };
        if (l && l.building) { ic = UDS.USE_ICON[l.use] || 'building'; name = `${u.name} 건물`; sub = `${l.building.floors}층 · ${trim(l.building.h, 1)}m`; n.bld++; }
        else { ic = l && (l.use === 'park' || l.use === 'green') ? 'park' : 'plaza'; name = `${u.name} 획지`; sub = l ? `${trim(l.area, 0)}㎡` : ''; n.lot++; }
      }
      return `<div class="mrow"><button class="mpk" data-act="multipick" data-arg="${esc(t.id)}" title="이것만 고르기">${picto(ic, 22)}<span>${esc(name)}</span><small>${esc(sub)}</small></button>` +
        `<button class="ibtn sm" data-act="multidrop" data-arg="${esc(t.id)}" title="선택에서 빼기" aria-label="${esc(name)} 선택에서 빼기">${icon('close', 12)}</button></div>`;
    });
    const parts = [];
    if (n.road) parts.push(`도로 ${n.road}`);
    if (n.bld) parts.push(`건물 ${n.bld}`);
    if (n.lot) parts.push(`획지 ${n.lot}`);
    if (n.obj) parts.push(`요소 ${n.obj}`);
    if (n.ctx) parts.push(`현황 건물 ${n.ctx}`);
    if (n.rab) parts.push(`회전교차로 ${n.rab}`);
    if (n.tree) parts.push(`수목 ${n.tree}`);
    if (n.water) parts.push(`수공간 ${n.water}`);
    let h = phead('select', `${list.length}개 선택`, parts.join(' · '), tipI('Shift+누르기로 더하거나 빼고, Delete로 한꺼번에 지웁니다(Ctrl+Z로 되돌림). [이동] 도구로 고른 시설물·수목을 함께 끌어 옮깁니다.') + `<button class="ibtn" data-act="multidel" title="고른 요소 모두 지우기 (Delete)" aria-label="고른 요소 모두 지우기">${icon('trash', 16)}</button>`);
    const mc = app.mergeCheck(list);
    if (mc.n) h += mc.ok
      ? `<div class="rowbtn"><button class="btn pri" data-act="mergelots" data-tip="마지막에 고른 획지의 용도와 건물 설정을 이어받고, 건물은 넓어진 획지에 맞춰 다시 앉습니다">획지 ${mc.n}개 합치기</button></div>`
      : `<p class="lead tip">${esc(mc.reason)}</p>`;
    h += f.head('고른 요소', '<span class="hn">누르면 그것만 선택</span>');
    h += `<div class="mlist">${rows.join('')}</div>`;
    h += `<div class="rowbtn"><button class="btn sm" data-act="multidel">${icon('trash', 13)}모두 지우기</button><button class="btn sm" data-act="multiclear">선택 풀기</button></div>`;
    return h;
  }

  function paneProps(f) {
    const t = app.state.sel;
    const list = app.selList();
    if (list.length > 1) return paneMulti(f, list);
    if (!t) return paneSite(f);
    if (t.type === 'road') { const r = app.road(t.id); return r ? paneRoad(f, r) : paneSite(f); }
    if (t.type === 'block') { const b = app.D.blocks.find((x) => x.id === t.id); return b ? paneBlock(f, b) : paneSite(f); }
    if (t.type === 'object') { const o = app.P.objects.find((x) => x.id === t.id); return o ? paneObject(f, o) : paneSite(f); }
    if (t.type === 'ctx') { const b = app.ctxBld(t.id); return b ? paneCtx(f, b) : paneSite(f); }
    if (t.type === 'rab') { const rb = app.D.rabs.find((x) => x.id === t.id), sp = (app.P.rabouts || []).find((x) => x.id === t.id); return rb && sp ? paneRab(f, rb, sp) : paneSite(f); }
    if (t.type === 'tree') { const tr = app.treeOf(t.id); return tr ? paneTree(f, tr) : paneSite(f); }
    if (t.type === 'water') { const w = app.water(t.id); return w ? paneWater(f, w) : paneSite(f); }
    const li = app.lotInfo(t.id);
    return li ? paneLot(f, li) : paneSite(f);
  }

  function roadTable() {
    const P = app.P, D = app.D;
    let h = '<table class="tb"><thead><tr><th>노선</th><th>규모</th><th class="r">폭</th><th class="r">연장</th></tr></thead><tbody>';
    // 도시계획도로는 폭 순서로, 단지 안 길(단지내도로·오솔길)은 그 아래에(도시·군계획시설 규모 대신 종류)
    P.roads.slice().sort((a, b) => (!!a.inner - !!b.inner) || D.roadInfo.get(b.id).lay.W - D.roadInfo.get(a.id).lay.W).forEach((r) => {
      const info = D.roadInfo.get(r.id);
      h += `<tr data-act="selroad" data-arg="${r.id}" tabindex="0"><td>${esc(r.name)}</td><td>${info.cls}</td><td class="r">${trim(info.lay.W)}m</td><td class="r">${trim(info.len, 0)}m</td></tr>`;
    });
    return h + '</tbody></table>';
  }

  function paneSite(f) {
    const P = app.P, D = app.D, S = P.settings, m = D.metrics;
    let h = phead('plaza', P.meta.title || '계획', `${SCENE_NAME[P.meta.scene] && SCENE_NAME[P.meta.scene] !== P.meta.title ? SCENE_NAME[P.meta.scene] + ' · ' : ''}${trim(P.site.w, 0)} × ${trim(P.site.h, 0)}m · ${trim(m.site / 10000, 2)}ha`, tipI('요소를 누르면 여기서 치수와 유형을 바꿉니다. Shift+누르기로 여럿을 고르고 Delete로 지웁니다. 새 요소는 왼쪽 메뉴에서 골라 놓습니다.'));
    h += flowHTML();
    // 핵심 지표: 건축 획지 기준 건폐율·용적률, 건물 수·최고 높이, 추정 인구·공원 비율
    h += '<div class="stats">' +
      stat('건폐율', m.buildings ? pct(m.bcr) : '-', '건축면적 ÷ 건축 획지') +
      stat('용적률', m.buildings ? pct(m.far) : '-', '연면적 ÷ 건축 획지') +
      stat('건물', `${m.buildings}동`, m.buildings ? `최고 ${trim(m.maxH, 1)}m` : '아직 없음') +
      stat('추정 인구', `${trim(m.pop, 0)}명`, `공원 비율 ${pct(m.parkRatio)}`) + '</div>';
    const cx = app.ctxData();
    if (cx) h += ctxSection(f, cx);
    else if (P.ctx) h += f.head('현황') + '<p class="lead tip">현황 건물 자료가 이 브라우저에 남아 있지 않아 보이지 않습니다. 함께 저장해 둔 작업 파일(.json)을 열거나 [프로젝트 → 실제 지역 불러오기]로 다시 받으세요.</p>';
    h += f.head('계획');
    h += f.text('계획 이름', P.meta.title, (v) => { P.meta.title = v.trim() || '계획'; });
    h += f.sel('새 가구 용도', P.meta.defaultUse || 'res', (v) => { P.meta.defaultUse = v; }, C.USE_ORDER.map((k) => [k, C.USES[k].name]), { note: '도로를 내어 새로 생긴 가구에 적용' });
    h += f.num('1인당 주거면적', S.m2PerPerson, (v) => { S.m2PerPerson = v; }, { min: 15, max: 80, step: 1, unit: '㎡', note: '주거 연면적으로 인구를 추정' });
    h += f.head('가로 위계표', `<span class="hn">${P.roads.length}개 노선 · 누르면 선택</span>`);
    h += roadTable();
    return h;
  }

  function segLevel(road, seg) {
    let lv = '';
    app.D.checks.forEach((c) => { if (c.target && c.target.type === 'road' && c.target.id === road.id && c.target.seg === seg.id) { if (c.level === 'error') lv = 'error'; else if (c.level === 'warn' && lv !== 'error') lv = 'warn'; } });
    return lv;
  }

  /* 단지 안 길(단지내도로·오솔길): 종류·폭·모양(꺾은선·모서리 둥글게·곡선)과 어귀 모서리 반경 */
  function paneInner(f, r, info) {
    const lay = info.lay, st = app.state, fit = () => M.reshape(r);
    let h = phead(UDS.PRESET_ICON[r.preset] || 'estate', r.name, `${C.FN[r.fn] ? C.FN[r.fn].name : '단지 안 길'} · 폭 ${trim(lay.W)}m · 연장 ${trim(info.len, 0)}m`,
      `<button class="ibtn" data-act="delroad" title="길 지우기" aria-label="길 지우기">${icon('trash', 16)}</button>`);
    h += f.text('이름', r.name, (v) => { r.name = v.trim() || C.FN[r.fn].name; });
    h += f.sel('종류', r.preset, (v) => {
      const p = C.PRESETS[v]; if (!p || !p.inner) return false;
      const W = Dv.roadWidth(r), keepW = Math.abs(W - C.PRESETS[r.preset].segs.reduce((a, g) => a + g.w, 0)) > 0.01; // 폭을 바꿔 두었으면 그 폭 그대로
      r.preset = v; r.fn = p.fn; r.speed = p.speed; r.curbR = p.curbR;
      r.segs = p.segs.map((g) => ({ id: U.uid('s'), type: g.type, w: keepW ? W : g.w }));
      r.name = r.name.replace(/^(단지내도로|오솔길)(?=( \d+)?$)/, C.FN[p.fn].name); // 기본 이름이면 종류를 따라 바꾼다
    }, C.INNER_ORDER.map((k) => [k, C.PRESETS[k].name.replace(/ [\d.]+m$/, '')]));
    h += f.num('폭', lay.W, (v) => { const k = v / Math.max(0.1, Dv.roadWidth(r)); r.segs.forEach((g) => { g.w = U.round(g.w * k, 2); }); }, { min: 1, max: 12, step: 0.5, unit: 'm', note: r.fn === 'trail' ? '산책로는 1.5~3m가 흔함' : '단지내도로 기본 4m · 차가 서로 비켜 가려면 6m 안팎' });
    h += f.row('모양', `<span class="seg" role="group" aria-label="길 모양">${Object.keys(C.SHAPES).map((k) => `<button data-act="roadshape" data-arg="${k}" aria-pressed="${(r.shape || 'line') === k}">${C.SHAPES[k].replace('(베지에)', '')}</button>`).join('')}</span>`,
      r.shape === 'curve' ? '찍은 점을 모두 지나는 매끈한 곡선(3차 베지에). [이동] 도구로 점을 끌어 다듬습니다' : r.shape === 'round' ? '꺾인 곳마다 아래 반지름의 원호' : '찍은 점을 곧게 잇습니다');
    if (r.shape === 'round') h += f.num('모서리 반지름', r.cornerR || 6, (v) => { r.cornerR = v; fit(); }, { min: 1, max: 40, step: 0.5, unit: 'm', note: '이웃한 변 길이의 절반을 넘으면 그만큼 줄여 그립니다' });
    if (lay.hasCar) h += f.num('어귀 모서리 반경', r.curbR, (v) => { r.curbR = v; }, { min: 0.5, max: 12, step: 0.5, unit: 'm', note: '다른 길과 만나는 곳의 연석 곡선' });
    h += `<p class="zln">가구를 나누지 않는 길 · 지나는 자리의 건물은 길 가장자리에서 ${C.innerGap(lay.hasCar)}m 물러남 ${tipI('획지 안에 그리는 길입니다. 기존 도로에 이으면 그 도로의 연석선까지 진출입로가 되고, 다른 길과 만나지 않아도 됩니다. 모양은 [이동] 도구로 점(곡선·둥근 모서리는 찍은 점)을 끌어 고칩니다. 길과 길이 만나는 곳이나 길 위를 [회전교차로]로 누르면 소형 회전교차로를 둡니다.')}</p>`;
    return h;
  }
  function paneRoad(f, r) {
    const info = app.D.roadInfo.get(r.id), lay = info.lay, st = app.state;
    if (r.inner) return paneInner(f, r, info);
    let h = phead(UDS.PRESET_ICON[r.preset] || 'road', r.name, `${C.FN[r.fn].name} · ${info.cls} ${trim(lay.W)}m · 연장 ${trim(info.len, 0)}m`,
      `<button class="ibtn" data-act="delroad" title="도로 지우기" aria-label="도로 지우기">${icon('trash', 16)}</button>`);
    h += f.text('이름', r.name, (v) => { r.name = v.trim() || '도로'; });
    h += f.sel('기능', r.fn, (v) => { r.fn = v; }, Object.keys(C.FN).map((k) => [k, C.FN[k].name]));
    h += f.sel('표준 단면', '', (v) => { if (!v) return false; app.applyPreset(r, v); }, [['', '위계를 골라 단면 교체…']].concat(C.PRESET_ORDER.map((k) => [k, C.PRESETS[k].name])));
    if (lay.hasCar) {
      h += f.sel('설계속도', r.speed, (v) => { r.speed = +v; }, [20, 30, 40, 50, 60, 70, 80].map((v) => [v, v + ' km/h']), { note: `차로폭 ${trim(C.RULES.lane(r.speed))}m 이상` });
      h += f.num('연석 높이', r.curbH, (v) => { r.curbH = v; }, { min: 0, max: 40, step: 1, unit: 'cm', scale: 0.01, note: '25cm 이하' });
      h += f.num('모서리 반경', r.curbR, (v) => { r.curbR = v; }, { min: 0.5, max: 15, step: 0.5, unit: 'm', note: '작을수록 횡단 거리가 짧아짐' });
      h += f.chk('횡단보도', r.crosswalk, (v) => { r.crosswalk = v; }, { on: '교차로마다 설치' });
    }
    h += f.head('가로수·조명');
    h += f.chk('가로수', r.trees.on, (v) => { r.trees.on = v; }, { on: r.trees.on ? '심음' : '없음' });
    if (r.trees.on) {
      h += f.sel('수종', r.trees.species, (v) => { r.trees.species = v; }, C.TREE_ORDER.map((k) => [k, `${C.TREES[k].name} · 수관 ${C.TREES[k].crown}m`]));
      h += f.num('식재 간격', r.trees.spacing, (v) => { r.trees.spacing = v; }, { min: 4, max: 20, step: 0.5, unit: 'm' });
    }
    h += f.chk('가로등', r.lights.on, (v) => { r.lights.on = v; }, { on: r.lights.on ? '설치' : '없음' });
    if (r.lights.on) h += f.num('가로등 간격', r.lights.spacing, (v) => { r.lights.spacing = v; }, { min: 10, max: 60, step: 1, unit: 'm' });
    if (lay.hasCar) {
      // 전선 지중화: 누르면 전주·가공선을 걷어 내고 전력·통신선을 보도 밑 관로로 옮긴다(단면에서 전력관을 넣어도 같은 결과)
      if (r.overhead) h += f.row('전주·가공선', `<button class="btn sm pri" data-act="undergr" data-arg="${r.id}">지중화하기</button>`, `전주 ${app.D.poles.filter((p) => p.roadId === r.id).length}개와 가공선을 걷어 내고 전력·통신선을 보도 밑 관로로 옮깁니다. 보도 유효폭과 가로 경관이 나아집니다`);
      else h += f.chk('전주·가공선', false, (v) => { if (v) r.overhead = true; }, { on: '지중화함', note: '켜면 전주와 가공선을 다시 세웁니다(지하 관로는 그대로)' });
    }
    h += f.head('횡단 구성', `<span class="hn">왼쪽에서 오른쪽 · 합계 ${trim(lay.W)}m</span>`);
    h += '<div class="segs">';
    r.segs.forEach((seg) => {
      const def = C.SEG[seg.type];
      const lv = segLevel(r, seg);
      h += `<div class="segrow${st.selSeg === seg.id ? ' on' : ''}">` +
        `<button class="pk" data-act="selseg" data-arg="${seg.id}" title="단면에서 보기" aria-label="${def.name} 선택">${picto(UDS.SEG_ICON[seg.type], 22)}</button>` +
        f.selIn(seg.type, (v) => { seg.type = v; if (v === 'lane' || v === 'bus') { if (!seg.dir) seg.dir = 1; } else delete seg.dir; }, C.SEG_ORDER.map((t) => [t, C.SEG[t].name]), { k: 'st' + seg.id, aria: '구간 유형' }) +
        f.numIn(seg.w, (v) => { seg.w = v; }, { min: 0.25, max: 40, step: 0.25, unit: 'm', k: 'sw' + seg.id, aria: `${def.name} 폭` }) +
        (seg.dir ? `<button class="ibtn sm" data-act="segdir" data-arg="${seg.id}" title="통행 방향 바꾸기" aria-label="통행 방향 바꾸기">${seg.dir > 0 ? '↑' : '↓'}</button>` : '<span class="sp"></span>') +
        `<button class="ibtn sm" data-act="segdel" data-arg="${seg.id}" title="구간 지우기" aria-label="구간 지우기">${icon('close', 12)}</button>` +
        (lv ? `<i class="lv ${lv}" title="법규검토 탭에서 내용 확인"></i>` : '') + '</div>';
    });
    h += `</div><div class="rowbtn"><button class="btn sm" data-act="addseg">${icon('plus', 13)}구간 추가</button></div>`;
    h += f.head('지하시설', '<span class="hn">위치는 중심선에서 왼쪽 +, 오른쪽 −</span>');
    if ((r.utils || []).length) {
      h += '<div class="utils"><div class="uth"><span>종류</span><span>위치</span><span>깊이</span><span>관경</span><span></span></div>';
      r.utils.forEach((u) => {
        const def = C.UTIL[u.type];
        h += `<div class="utilrow${st.selUtil === u.id ? ' on' : ''}">` +
          `<button class="un" data-act="selutil" data-arg="${u.id}"><i style="background:${swc(def.color)}"></i>${def.name}</button>` +
          f.numIn(u.off, (v) => { u.off = v; }, { min: -40, max: 40, step: 0.1, unit: 'm', k: 'uo' + u.id, aria: '위치' }) +
          f.numIn(u.depth, (v) => { u.depth = v; }, { min: 0.3, max: 3.5, step: 0.1, unit: 'm', k: 'ud' + u.id, aria: '깊이' }) +
          f.numIn(u.dia, (v) => { u.dia = v; }, { min: 50, max: 3000, step: 50, unit: '', scale: 0.001, k: 'uz' + u.id, aria: '관경(mm)' }) +
          `<button class="ibtn sm" data-act="utildel" data-arg="${u.id}" title="지우기" aria-label="${def.name} 지우기">${icon('close', 12)}</button></div>`;
      });
      h += '</div>';
    } else h += '<p class="lead">이 도로에는 지하시설이 없습니다.</p>';
    h += `<div class="rowbtn"><button class="btn sm" data-act="addutil">${icon('plus', 13)}지하시설 추가</button></div>`;
    return h;
  }

  function facadeFields(f, st, styleKey, set, setStyle) {
    let h = f.head('입면');
    h += f.sel('스타일', styleKey, setStyle, C.STYLE_ORDER.map((k) => [k, C.STYLE_PRESETS[k].name]), { note: '고르면 아래 세부값이 함께 바뀜' });
    // 외장 재료: 기본 재료 + 이미지로 만든 재료(프로젝트마다) + 새로 만들기
    const cms = app.mats();
    const mopts = C.MAT_ORDER.map((k) => [k, C.MATERIALS[k].name]).concat(cms.map((m) => [m.id, '이미지 · ' + m.name]), [['__new', '+ 이미지로 새 재료…']]);
    h += f.sel('외장 재료', st.material, (v) => {
      if (v === '__new') {
        if (cms.length >= C.CMAT_MAX) { ui.toast(`이미지 재료는 프로젝트마다 ${C.CMAT_MAX}개까지 만들 수 있습니다. 쓰지 않는 재료를 지우고 만드세요.`); return; }
        setTimeout(() => UDS.MatDlg.open((id, col) => { set('material', id); set('wallColor', col); app.changed(); }), 0);
        return; // 고르기 칸은 다시 그릴 때 원래 재료로 돌아간다
      }
      const cm = app.matDef(v);
      set('material', v); set('wallColor', cm ? cm.color : C.MATERIALS[v].color);
    }, mopts, app.isCustomMat(st.material) ? { note: '이미지로 만든 재료: 그 위에 창·1층·간판을 그림' } : undefined);
    const cm = app.isCustomMat(st.material) ? app.matDef(st.material) : null;
    if (cm) {
      const o = { min: 0.05, max: 50, step: 0.05, unit: 'm' };
      h += f.row('무늬 크기', `<span class="cmsz">${f.numIn(cm.tile[0], (v) => { cm.tile[0] = v; }, { ...o, k: 'cmw', aria: '무늬 가로' })}<i>×</i>${f.numIn(cm.tile[1], (v) => { cm.tile[1] = v; }, { ...o, k: 'cmh', aria: '무늬 세로' })}</span>`, '그림 한 장이 벽에서 덮는 가로×세로(실제 크기). 이 재료를 쓰는 모든 건물에 함께 적용');
      h += f.chk('거울 반복', !!cm.mirror, (v) => { cm.mirror = v; }, { note: '한 장 건너 좌우·위아래로 뒤집어 붙여 이음매를 숨김', on: cm.mirror ? '켬' : '끔' });
      h += `<div class="rowbtn"><button class="btn sm quiet" data-act="matdel" data-arg="${esc(cm.id)}">${icon('close', 12)}재료 '${esc(cm.name)}' 지우기</button></div>`;
    }
    h += f.color('벽 색', st.wallColor, (v) => { set('wallColor', v); });
    h += f.sel('창 형식', st.win, (v) => { set('win', v); }, Object.entries(C.WIN));
    h += f.range('창 면적비', Math.round(st.wwr * 100), (v) => { set('wwr', v / 100); }, { min: 10, max: 90, step: 5, sfx: '%' });
    h += f.sel('1층 유형', st.ground, (v) => { set('ground', v); }, Object.entries(C.GROUND), st.ground === 'pilotis' ? { note: '필로티 층은 용적률 산정 연면적에서 뺌' } : undefined);
    h += f.sel('간판', st.sign, (v) => { set('sign', v); }, Object.entries(C.SIGN));
    h += f.chk('차양', !!st.canopy, (v) => { set('canopy', v); }, { on: st.canopy ? '있음' : '없음' });
    h += f.sel('지붕', st.roof, (v) => { set('roof', v); }, Object.entries(C.ROOF));
    return h;
  }
  const stat = (label, val, sub) => `<div class="stat"><span>${label}</span><b>${val}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;

  /* 실제 지역: 현황 요약 · 표현 방식(단색·용도·층수·건축 연도) · 범례(분류별 동수) */
  function ctxSection(f, cx) {
    const X = UDS.Ctx, V = app.D.ctxV, mode = app.state.ctxMode, line = app.modeOf('2d') === 'line' && app.modeOf('3d') === 'line';
    const S = X.stats(cx, V, mode);
    let h = f.head('현황 (실제 지역)', `<span class="hn">${esc(cx.date)} 받음</span>`);
    h += `<p class="cxsum">` + (S.shown ? `현황 건물 <b>${trim(S.shown, 0)}동</b> · 건축면적 ${trim(S.fp, 0)}㎡ · 연면적 ${trim(S.gfa, 0)}㎡<br>평균 ${trim(S.flSum / S.shown, 1)}층 · 최고 ${S.maxFl}층(${trim(S.maxH, 1)}m)` +
      (S.aged ? ` · 사용승인 30년 이상 ${pct(S.old / S.aged)}` : '') : `남은 현황 건물이 없습니다(전체 ${trim(S.n, 0)}동).`) +
      (S.demo ? `<br>새 계획으로 철거: <b>${trim(S.demo, 0)}동</b> (연면적 ${trim(S.demoGfa, 0)}㎡)` : '') +
      (S.off ? `<br>지운 현황 건물 ${trim(S.off, 0)}동 <button class="btn sm quiet" data-act="ctxrestore">모두 되살리기</button>` : '') + '</p>';
    h += `<div class="cxmode"><div class="seg" role="group" aria-label="현황 건물 표현">${X.MODES.map(([k, n]) => `<button data-act="ctxmode" data-arg="${k}" aria-pressed="${mode === k}"${line ? ' disabled' : ''}>${n}</button>`).join('')}</div></div>`;
    if (mode !== 'gray' && !line) h += `<div class="cxleg">${X.legend(mode).map(([k, n, c]) => `<span><i style="background:${swc(c)}"></i>${n}<em>${trim(S.cls[k] || 0, 0)}</em></span>`).join('')}</div>`;
    h += `<p class="lead tip">${esc(cx.src)} · 중심 ${cx.lat.toFixed(5)}, ${cx.lon.toFixed(5)}.${S.est ? ` 높이·층수 정보가 없는 ${trim(S.est, 0)}동은 어림값으로 세웠습니다(건물을 눌러 층수를 고칠 수 있음, 표현 '높이 근거'로 확인).` : ''} 지형(경사)은 반영하지 않습니다.${mode === 'fac' ? ' 입면(재료·창·1층·간판·지붕)은 층수·건축면적·평면 모양·용도·면한 길로 추정한 것입니다(건물을 눌러 유형·변주를 고칠 수 있음).' : ''}${cx.attr ? ` 자료 ${esc(cx.attr)}.` : ''}</p>`;
    return h;
  }
  /* 현황 건물 하나: 건축물대장 속성. 바꿀 수는 없고 지울(철거할) 수 있다 */
  function paneCtx(f, b) {
    const X = UDS.Ctx, use = X.useOf(b.pc), cx = app.ctxData();
    const title = b.nm ? (b.dn && b.dn !== b.nm ? `${b.nm} ${b.dn}` : b.nm) : use.name;
    let h = phead('city', title, `현황 건물 · ${esc(use.name)}`, tipI('현황 건물은 지상 층수만 고칠 수 있고, 지울(철거할) 수 있습니다. 이 자리에 새 건물을 놓거나 가구 용도를 정하면 철거된 것으로 보고 점선 윤곽만 남깁니다.') + `<button class="ibtn" data-act="ctxdel" data-arg="${esc(b.id)}" title="이 건물 지우기(철거)" aria-label="현황 건물 지우기">${icon('trash', 16)}</button>`);
    const hEst = !b.fix && (b.est === 'h' || b.est === 'all' || b.est === 'g'), flEst = !b.fix && (b.est === 'fl' || b.est === 'all' || b.est === 'g');
    h += '<div class="stats">' +
      stat('층수', `${b.fl}층`, b.fix ? '직접 고침' : flEst ? '어림값' : b.ug ? `지하 ${b.ug}층` : '지상') +
      stat('높이', `${trim(b.h, 1)}m`, b.fix ? '층수로 셈' : hEst ? '층수로 어림' : '자료값') +
      stat('건축면적', `${trim(b.ar > 0 ? b.ar : b.a, 0)}㎡`, b.ar > 0 ? '건축물대장' : '윤곽으로 잰 값') +
      stat('연면적', b.ta > 0 ? `${trim(b.ta, 0)}㎡` : '-', b.ta > 0 ? '건축물대장' : '자료 없음') + '</div>';
    const kv = (a, v) => (v ? `<tr><td>${a}</td><td class="r">${v}</td></tr>` : '');
    const age = X.ageOf(b);
    const ymd = b.y ? [b.y.slice(0, 4), b.y.slice(4, 6), b.y.slice(6, 8)].filter(Boolean).join('.') : '';
    h += '<table class="tb kv"><tbody>' +
      kv('주용도', esc(use.name) + (b.pc ? ` <span class="sub">${esc(b.pc)}</span>` : '')) +
      kv('사용승인일', ymd ? `${ymd} (${age}년 경과)` : '') +
      kv('구조', esc(X.structOf(b.sc))) +
      kv('대지면적', b.pa > 0 ? trim(b.pa, 0) + '㎡' : '') +
      kv('건폐율 · 용적률', b.bcr > 0 || b.far > 0 ? `${trim(b.bcr, 1)}% · ${trim(b.far, 1)}%` : '') +
      kv('지번', esc(b.jb)) +
      kv('위반건축물', b.vi ? '해당' : '') +
      '</tbody></table>';
    // 지상 층수 고치기: 고친 값은 계획에 남아 되돌리기·저장을 따른다. 높이는 층수×층고(용도별)로 다시 셈
    const raw = (app.ctx && app.ctx.bld.find((x) => x.id === b.id)) || b; // 받은 자료 그대로의 값
    h += f.head('지상 층수 고치기', b.fix ? `<button class="btn sm" data-act="ctxfl" data-arg="${esc(b.id)}|0">${icon('reset', 13)}받은 값 ${raw.fl}층으로</button>` : '') +
      f.num('지상 층수', b.fl, (v) => { const P = app.P; if (!P.ctx) return false; const fx = { ...(P.ctx.fl || {}) }; if (v > 0 && v !== raw.fl) fx[b.id] = v; else delete fx[b.id]; P.ctx.fl = fx; }, { min: 1, max: 90, int: true, unit: '층', note: '답사·거리뷰로 확인한 층수를 넣으면 높이(층수×용도별 층고)도 함께 바뀝니다.' });
    if (b.est && !b.fix) h += `<p class="lead tip">${b.est === 'all' ? '층수·높이 정보가 없어 1층으로 세웠습니다.' : b.est === 'g' ? '층수·높이 자료가 없어 용도와 건축면적으로 층수를 어림했습니다. 실제와 다르면 위에서 고치세요.' : b.est === 'fl' ? '지상 층수 정보가 없어 연면적÷건축면적(또는 높이)으로 층수를 어림했습니다.' : '높이 정보가 없어 층수×층고로 높이를 어림했습니다.'}</p>`;
    h += ctxFacHTML(f, b);
    if (cx) h += `<p class="lead tip">자료: ${esc(cx.src)} (${esc(cx.date)} 받음)</p>`;
    return h;
  }
  /* 현황 건물의 추정 입면: 유형 고르기 · 다른 변주 · 요약 · 근거 */
  function ctxFacHTML(f, b) {
    const Fc = UDS.Fac, map = app.ctxFac ? app.ctxFac() : null, d = map && map.get(b.id);
    if (!Fc || !d) return '';
    const ov = (app.P.ctx && app.P.ctx.fa && app.P.ctx.fa[b.id]) || {};
    let h = f.head('입면 (추정)' + tipI('외관 자료가 없어 층수·건축면적·평면 모양·주용도·받을 때 면한 길로 건물 유형을 정하고, 유형마다 흔한 재료·색·창·1층·간판·지붕 가운데 하나를 골라 입혔습니다. 유형을 바꾸거나 다른 변주를 고를 수 있습니다(되돌리기·저장 따름). 3D 표현이 [입면]일 때 보입니다.'),
      ov.t || ov.v ? `<button class="btn sm" data-act="ctxfareset" data-arg="${esc(b.id)}">${icon('reset', 13)}자동으로</button>` : '');
    h += f.sel('입면 유형', ov.t || '', (v) => { const P = app.P; if (!P.ctx) return false; const fa = { ...(P.ctx.fa || {}) }, cur = { ...(fa[b.id] || {}) }; if (v) cur.t = v; else delete cur.t; if (Object.keys(cur).length) fa[b.id] = cur; else delete fa[b.id]; P.ctx.fa = fa; },
      [['', `자동 · ${Fc.TYPES[d.auto].name}`]].concat(Fc.ORDER.map((k) => [k, Fc.TYPES[k].name])));
    h += `<div class="facrow"><span class="facsum">${esc(Fc.summary(d))}</span><button class="btn sm" data-act="ctxvar" data-arg="${esc(b.id)}" title="같은 유형에서 재료·색·창·간판을 다시 고릅니다">${icon('shuffle', 13)}다른 변주${d.v ? ` <em>${d.v + 1}</em>` : ''}</button></div>`;
    h += `<p class="lead tip">근거: ${esc(d.why.join(' · '))} → ${esc(Fc.TYPES[d.auto].name)}${d.fixed ? ` (직접 고침: ${esc(Fc.TYPES[d.t].name)})` : ''}</p>`;
    return h;
  }

  function paneLot(f, li) {
    const lot = li.lot, S = li.S, b = lot.building;
    const use = lot.use, u = C.USES[use] || C.USES.res;
    const ovr = () => app.lotOv(lot.id);
    const setB = (k, v) => { const o = ovr(); if (!o.bld) o.bld = {}; o.bld[k] = v; if (k === 'floors') delete o.bld.floorsAuto; }; // 직접 정한 층수
    const nRoads = new Set(lot.frontage.map((x) => x.roadId)).size;
    const cells = lot.cell ? (lot.cell.r1 - lot.cell.r0 + 1) * (lot.cell.i1 - lot.cell.i0 + 1) : 1; // 2 이상이면 합친 획지
    const sub = lot.sub || null;
    let h = phead(b ? UDS.USE_ICON[use] || 'building' : use === 'park' || use === 'green' ? 'park' : 'plaza', b ? `${u.name} ${lot.cx ? `단지(${lot.cx.n}동)` : '건물'}` : `${u.name} 획지`,
      `획지 ${trim(lot.area, 0)}㎡ · ${nRoads ? `도로 ${nRoads}곳에 접함` : '도로에 닿지 않음(맹지)'}${sub ? ` · ${sub.n}개로 나눈 조각` : cells > 1 ? ` · ${cells}칸을 합친 획지` : ''}`, `<button class="btn sm" data-act="gotab" data-arg="metrics" title="접한 도로와 걸어서 닿는 시설">입지 분석</button><button class="btn sm" data-act="selblock" data-arg="${lot.blockId}">블록 정보</button>`);
    /* 획지 나누기: 나란히(도로를 따라 폭을 나눔) · 앞뒤로(깊이를 나눔). 이미 나눈 조각이면 지금 값이 눌려 보이고, 다른 값을 누르면 원래 획지를 다시 나눈다 */
    const sbtn = (dir, n) => `<button data-act="splitlot" data-arg="${lot.id}|${dir}|${n}" aria-pressed="${!!(sub && sub.dir === dir && sub.n === n)}" aria-label="${dir === 'u' ? '나란히' : '앞뒤로'} ${n}개로 나누기">${n}</button>`;
    const split = f.head('획지 나누기' + tipI(sub ? `원래 획지를 ${sub.dir === 'v' ? '앞뒤로' : '나란히'} ${sub.n}개로 나눈 조각입니다. 다른 수를 누르면 다시 나눕니다.` : '나란히는 도로를 따라 폭을, 앞뒤로는 깊이를 똑같이 나눕니다.'), sub ? `<button class="btn sm" data-act="unsplit" data-arg="${lot.id}">${icon('reset', 13)}다시 하나로</button>` : '') +
      `<div class="splitrow"><span class="sl">${icon('splitu', 15)}나란히</span><div class="seg sm" role="group" aria-label="나란히 나누기">${[2, 3, 4].map((n) => sbtn('u', n)).join('')}</div></div>` +
      `<div class="splitrow"><span class="sl">${icon('splitv', 15)}앞뒤로</span><div class="seg sm" role="group" aria-label="앞뒤로 나누기">${[2, 3].map((n) => sbtn('v', n)).join('')}</div></div>` +
      '' +
      (cells > 1 && !sub ? `<div class="rowbtn"><button class="btn sm" data-act="unmerge" data-arg="${lot.id}">${icon('reset', 13)}합치기 전으로 되돌리기</button></div>` : '');
    // 용도마다 그 용도지역의 건폐율·용적률 상한을 함께 보인다(블록에 용도지역을 정했으면 그 지역 기준)
    const zLab = (k) => { const zk = C.zoneOf(k, S.zone), Z = zk && C.ZONES[zk]; return Z && !C.USES[k].open ? `${C.USES[k].name} · 건폐율 ${Z.bcr}% · 용적률 ${Z.far}%` : C.USES[k].name; };
    h += f.sel('획지 용도', (li.ov && li.ov.use) || '', (v) => { const o = ovr(); if (v) { o.use = v; if (C.USES[v].open) delete o.bld; } else delete o.use; },
      [['', `가구 용도 따름(${zLab(S.use)})`]].concat(C.USE_ORDER.map((k) => [k, zLab(k)])));
    { const zk = C.zoneOf(use, S.zone), Z = zk && C.ZONES[zk]; if (Z && !u.open) h += `<p class="zln">${Z.name}${S.zone ? '' : ' 가정'} · 건폐율 ${Z.bcr}% · 용적률 ${Z.far}% 이하 ${tipI(`서울특별시 도시계획 조례 제54조(건폐율)·제55조(용적률)의 값입니다. 용적률은 이 도구에서 800%까지로 묶습니다(중심상업지역 1,000% → 800%). 역사도심·지구단위계획 등 따로 정한 곳은 다를 수 있습니다. ${S.zone ? '블록 정보에서 정한 용도지역' : '블록에 용도지역을 정하지 않아 용도에 맞춰 가정한 지역'}입니다.`)}</p>`; }
    if (use === 'park') h += f.sel('공원 유형', lot.parkType, (v) => { ovr().parkType = v; }, Object.keys(C.PARK_TYPES).map((k) => [k, C.PARK_TYPES[k].name]));
    if (u.open) return h + `<p class="lead">건물을 두지 않는 용도 ${tipI('건물을 지으려면 획지 용도를 주거·상업 등으로 바꾸거나, 왼쪽 [건물]에서 용도를 골라 이 획지를 누르세요.')}</p>` + split;
    if (!b) return h + `<p class="lead">빈 획지 ${tipI('아래 단추는 가구 기본값의 건물을 다시 세웁니다(새로 짓는 건물이라 맞벽은 두지 않음). 다른 용도의 건물은 왼쪽 [건물]에서 고릅니다.')}</p><div class="rowbtn"><button class="btn pri" data-act="bldadd" data-arg="${lot.id}">${icon('plus', 14)}건물 놓기</button></div>` + split;
    h += split;
    const base = { ...(C.BLD_DEFAULT[use] || C.BLD_DEFAULT.res), ...(S.bld || {}), ...((li.ov && li.ov.bld) || {}) };
    // 단지(한 획지에 여러 동): 넓은 획지(C.CX_MIN 이상)에서만 고른다
    const mrL = U.minRect(lot.poly), bigLot = lot.area >= C.CX_MIN.area && mrL && mrL.b >= C.CX_MIN.side;
    const cxSel = bigLot || base.cx ? f.sel('단지 배치', base.cx || '', (v) => { setB('cx', v); if (v === 'apt' && base.style !== 'apt') setB('style', 'apt'); },
      [['', '건물 한 동']].concat(C.CX_ORDER.map((k) => [k, `${C.CX[k].name} · 여러 동`])),
      { note: bigLot ? `넓은 획지(${U.fmt0(C.CX_MIN.area)}㎡·짧은 변 ${C.CX_MIN.side}m 이상)에는 공동주택 단지나 캠퍼스처럼 여러 동을 세울 수 있습니다. 동 수·층수는 용적률 목표에 맞춰 정합니다.` : `!이 획지는 단지로 짓기에 좁습니다(${U.fmt0(C.CX_MIN.area)}㎡·짧은 변 ${C.CX_MIN.side}m 이상). 한 동으로 짓습니다.` }) : '';
    if (lot.cx) return h + paneComplex(f, lot, b, base, setB, cxSel);
    h += f.head('건축물', `<button class="btn sm" data-act="bldremove" data-arg="${lot.id}">${icon('trash', 13)}건물 지우기</button>`);
    h += cxSel;
    const over = b.over || {}, limS = (k) => (b[k + 'Max'] ? `상한 ${Math.round(b[k + 'Max'] * 100)}%` : '');
    const statO = (label, val, bad, sub) => `<div class="stat${bad ? ' over' : ''}"${bad ? ' data-tip="용도지역 상한을 넘었습니다(법규검토 참고)"' : ''}><span>${label}</span><b>${val}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
    h += '<div class="stats five">' + stat('높이', trim(b.h, 1) + 'm') + statO('건폐율', pct(b.bcr), over.bcr, limS('bcr')) + statO('용적률', pct(b.far), over.far, limS('far')) + stat('건축면적', trim(b.area, 0) + '㎡') + stat('연면적', trim(b.gfa, 0) + '㎡') + '</div>';
    if (b.floorsSet) h += `<p class="zln warnln">${b.floorsSet}층으로 정했지만 용적률 상한에 맞춰 ${b.floors}층으로 지었습니다. 층수를 직접 넣으면 그대로 짓고 법규검토에 표시합니다.</p>`;
    if (b.fitFar) { const ff = b.fitFar; h += `<p class="zln">${ff.mode === 'zone' ? '용적률 최대로 짓기' : '가구 채우기'} · 용적률 ${Math.round(ff.far * 100)}%를 채우는 ${b.floors}층, 건폐율 ${pct(b.bcr)}${ff.capped ? ` (최고 ${ff.fmax}층에 걸림)` : ''} ${tipI(`용적률 목표를 채우는 가장 적은 층수를 정하고, 그 층수에서 건폐율이 가장 크도록 건물 깊이를 맞춥니다(건폐율 상한 ${Math.round(ff.bcr * 100)}% · 최고 ${ff.fmax}층 · 건축선 후퇴·이격 지킴). 층수를 직접 넣으면 그 층수로 짓습니다.`)}</p>`; }
    if (b.cfg && b.cfg.noParty) h += `<p class="zln">새로 지은 건물 · 맞벽 불가(인접 대지경계선에서 ${C.PARTY_MIN}m 이상) ${tipI('구도심을 처음 만들 때 있던 건물은 양옆 벽이 붙은 맞벽 건물일 수 있지만, 지우고 새로 짓는 건물은 인접 대지경계선에서 띄웁니다(학습용 값 · 민법 제242조, 건축법 제58조 대지 안의 공지 참고).')}</p>`;
    else if (!b.custom && b.side === 0) h += `<p class="zln">맞벽 건축 · 옆·뒤 이격 0 ${tipI('양옆 벽이 이웃 건물에 붙은 기존 건물입니다(건축법 제59조 맞벽 건축). 지우고 새로 지으면 맞벽이 되지 않습니다.')}</p>`;
    h += placeHTML(lot, b, base);
    h += f.num('층수', b.floors, (v) => { setB('floors', v); }, { min: 1, max: 60, step: 1, int: true, unit: '층' });
    h += f.num('1층 높이', b.groundH, (v) => { setB('groundH', v); }, { min: 2.4, max: 8, step: 0.1, unit: 'm' });
    h += f.num('기준층 높이', b.floorH, (v) => { setB('floorH', v); }, { min: 2.4, max: 6, step: 0.1, unit: 'm' });
    if (!b.custom) { // 직접 그린 건물은 모양이 정해져 있어 후퇴·깊이·길이를 쓰지 않는다
      h += f.num('건축선 후퇴', b.front, (v) => { setB('front', v); }, { min: 0, max: 20, step: 0.5, unit: 'm', note: '도로 쪽 전면공지 폭' });
      h += f.num('옆·뒤 이격', b.side, (v) => { setB('side', v); }, { min: b.cfg && b.cfg.noParty ? C.PARTY_MIN : 0, max: 20, step: 0.5, unit: 'm', note: b.cfg && b.cfg.noParty ? `새로 지은 건물은 맞벽 불가 · ${C.PARTY_MIN}m 이상` : '0이면 맞벽(이웃 건물과 벽이 붙음)' });
      h += f.num('건물 깊이', base.depth || 0, (v) => { setB('depth', v); }, { min: 0, max: 150, step: 1, unit: 'm', note: '도로에서 안쪽으로 · 0이면 획지 깊이까지 · 평면에서 변을 끌어도 바뀜' });
      h += f.num('건물 길이', base.len || 0, (v) => { setB('len', v); }, { min: 0, max: 300, step: 1, unit: 'm', note: '도로를 따라 · 0이면 획지 폭에 맞춤' });
    }
    h += facadeFields(f, b.st, base.style, setB, (v) => { const o = ovr(); if (!o.bld) o.bld = {}; o.bld.style = v; STYLE_KEYS.forEach((k2) => delete o.bld[k2]); });
    h += spHTML(lot); // 태양궤적도는 입면 아래에
    if (li.ov && (li.ov.bld || li.ov.use)) h += `<div class="rowbtn"><button class="btn sm" data-act="lotreset" data-arg="${lot.id}">${icon('reset', 13)}가구 기본값으로 되돌리기</button></div>`;
    return h;
  }

  /* 단지(한 획지에 여러 동)의 속성: 동 수·층수와 단지 전체의 건폐율·용적률, 배치 근거(동 사이 거리), 층수·높이·후퇴·동 깊이·입면 */
  function paneComplex(f, lot, b, base, setB, cxSel) {
    const cx = lot.cx, K = C.CX[cx.kind] || C.CX.apt, over = b.over || {};
    const limS = (k) => (b[k + 'Max'] ? `상한 ${Math.round(b[k + 'Max'] * 100)}%` : '');
    const statO = (label, val, bad, sub) => `<div class="stat${bad ? ' over' : ''}"${bad ? ' data-tip="용도지역 상한을 넘었습니다(법규검토 참고)"' : ''}><span>${label}</span><b>${val}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
    let h = f.head(K.name, `<button class="btn sm" data-act="bldremove" data-arg="${lot.id}">${icon('trash', 13)}모두 지우기</button>`);
    h += '<div class="stats five">' + stat('동 수', cx.n + '동', cx.kind === 'apt' && cx.rows ? `${cx.rows}줄 × ${cx.perRow}동` : '마당 둘레') + stat('층수', b.floors + '층', trim(b.h, 1) + 'm') +
      statO('건폐율', pct(cx.bcr), over.bcr, limS('bcr')) + statO('용적률', pct(cx.far), over.far, limS('far')) + stat('연면적', trim(cx.gfa, 0) + '㎡', `건축면적 ${trim(cx.area, 0)}㎡`) + '</div>';
    if (cx.kind === 'apt') h += `<p class="zln">판상형 주동을 동서로 길게(남향) 앉힘 · 마주 보는 두 동 사이 ${trim(cx.D, 1)}m 이상${cx.gy ? `(지금 ${trim(cx.gy, 1)}m)` : ''} ${tipI('같은 대지에서 마주 보는 두 동 사이는 채광창이 있는 벽면에서 높이의 0.5배 이상(서울특별시 건축 조례 제35조, 2022 개정)이면서 10m 이상(건축법 시행령 제86조제3항제2호나목)으로 띄웁니다. 같은 줄의 측벽 사이는 8m(학습용 값, 같은 호 마목은 4m 이상). 주택으로 쓰는 층수 5개 층 이상(아파트, 건축법 시행령 별표 1). 용적률 목표를 채우는 가장 적은 층수를 고르고, 동 길이를 같은 비율로 줄여 건폐율·용적률을 맞춥니다.')}</p>`;
    else h += `<p class="zln">가운데 마당을 두고 둘레에 동을 앉힘 · 마당 폭 ${trim(cx.gy || 0, 0)}m ${tipI('모서리는 10m 통로로 비우고, 긴 변(120m 넘음)은 가운데 12m 문을 둡니다(학습용 값). 용적률 목표를 채우는 가장 적은 층수를 고르고, 동 길이를 같은 비율로 줄여 건폐율·용적률을 맞춥니다.')}</p>`;
    if (b.fitFar && b.fitFar.capped) h += `<p class="zln warnln">최고 ${b.fitFar.fmax}층·동 사이 거리에 걸려 용적률 ${Math.round(b.fitFar.far * 100)}%를 다 채우지 못했습니다.</p>`;
    h += cxSel;
    h += f.num('층수', b.floors, (v) => { setB('floors', v); }, { min: 1, max: 60, step: 1, int: true, unit: '층', note: '비우지 않고 넣으면 그 층수로 짓습니다(동 사이 거리는 높이에 맞춰 다시 정함)' });
    h += f.num('1층 높이', b.groundH, (v) => { setB('groundH', v); }, { min: 2.4, max: 8, step: 0.1, unit: 'm' });
    h += f.num('기준층 높이', b.floorH, (v) => { setB('floorH', v); }, { min: 2.4, max: 6, step: 0.1, unit: 'm' });
    h += f.num('건축선 후퇴', b.front, (v) => { setB('front', v); }, { min: 0, max: 20, step: 0.5, unit: 'm', note: '도로 쪽 전면공지 폭' });
    h += f.num('옆·뒤 이격', b.side, (v) => { setB('side', v); }, { min: 0.5, max: 20, step: 0.5, unit: 'm', note: '인접 대지경계선에서' });
    h += f.num('동 깊이', base.depth > 0 ? base.depth : K.depth, (v) => { setB('depth', v); }, { min: 8, max: 30, step: 0.5, unit: 'm', note: '동 하나의 짧은 변(판상형은 남북 깊이)' });
    h += facadeFields(f, b.st, base.style, setB, (v) => { const o = app.lotOv(lot.id); if (!o.bld) o.bld = {}; o.bld.style = v; STYLE_KEYS.forEach((k2) => delete o.bld[k2]); });
    const li = app.lotInfo(lot.id);
    if (li && li.ov && (li.ov.bld || li.ov.use)) h += `<div class="rowbtn"><button class="btn sm" data-act="lotreset" data-arg="${lot.id}">${icon('reset', 13)}가구 기본값으로 되돌리기</button></div>`;
    return h;
  }

  /* 가구(블록) 하나의 종합 지표. 건폐율·용적률의 분모는 지구 전체 지표와 같이 건축 획지(열린 용도를 뺀 획지) 면적 */
  function blockStats(blk) {
    const D = app.D, P = app.P;
    const lots = D.lots.filter((l) => l.blockId === blk.id);
    const blds = [].concat(...lots.filter((l) => l.building).map((l) => l.buildings || [l.building])); // 단지는 모든 동
    const bldLots = lots.filter((l) => !(C.USES[l.use] && C.USES[l.use].open));
    const net = bldLots.reduce((a, l) => a + l.area, 0);
    const fp = blds.reduce((a, b) => a + b.area, 0), gfa = blds.reduce((a, b) => a + b.gfa, 0);
    const resGfa = blds.reduce((a, b) => (b.use === 'res' ? a + b.gfa : b.use === 'mixed' ? a + b.gfa * Math.max(0, (b.floors - 1) / b.floors) : a), 0);
    const byUse = {};
    lots.forEach((l) => { const x = byUse[l.use] || (byUse[l.use] = { n: 0, area: 0, bld: 0 }); x.n++; x.area += l.area; if (l.building) x.bld++; });
    const fl = blds.map((b) => b.floors);
    return {
      lots, blds, net, fp, gfa, byUse,
      bcr: net ? fp / net : 0, far: net ? gfa / net : 0, gBcr: blk.area ? fp / blk.area : 0, gFar: blk.area ? gfa / blk.area : 0,
      maxH: blds.reduce((m, b) => Math.max(m, b.h), 0), maxF: fl.length ? Math.max(...fl) : 0, avgF: fl.length ? fl.reduce((a, v) => a + v, 0) / fl.length : 0,
      pop: resGfa / (P.settings.m2PerPerson || 35), empty: bldLots.filter((l) => !l.building).length,
      open: lots.filter((l) => ['park', 'plaza', 'green'].includes(l.use)).reduce((a, l) => a + l.area, 0),
      merged: lots.filter((l) => !l.sub && l.cell && (l.cell.r1 > l.cell.r0 || l.cell.i1 > l.cell.i0)).length,
      split: new Set(lots.filter((l) => l.sub).map((l) => l.sub.of)).size,
    };
  }

  function paneBlock(f, blk) {
    const S = blk.settings, u = C.USES[S.use] || C.USES.res;
    const base = { ...(C.BLD_DEFAULT[S.use] || C.BLD_DEFAULT.res), ...(S.bld || {}) };
    const sp = { ...(C.STYLE_PRESETS[base.style] || C.STYLE_PRESETS.res_multi) };
    STYLE_KEYS.forEach((k) => { if (base[k] !== undefined) sp[k] = base[k]; });
    const setB = (k, v) => { if (!S.bld) S.bld = {}; S.bld[k] = v; };
    const bs = blockStats(blk), nLots = bs.lots.length;
    let h = phead(u.open ? 'park' : UDS.USE_ICON[S.use] || 'building', `${u.name} 블록`, `${trim(blk.area, 0)}㎡ · ${blk.dims ? `${trim(blk.dims.long, 0)}×${trim(blk.dims.short, 0)}m · ` : ''}도로 ${blk.roads.length}개에 접함`, ui.backBtn());
    // 가구 현황: 건물 수, 건폐율·용적률, 높이, 면적과 용도 구성
    h += '<div class="stats">' +
      stat('건물', `${bs.blds.length}동`, `획지 ${nLots}곳${bs.empty ? ` · 빈 획지 ${bs.empty}곳` : ''}`) +
      stat('건폐율', bs.net ? pct(bs.bcr) : '-', '건축면적 ÷ 건축 획지') +
      stat('용적률', bs.net ? pct(bs.far) : '-', '연면적 ÷ 건축 획지') +
      stat('최고 높이', bs.blds.length ? trim(bs.maxH, 1) + 'm' : '-', bs.blds.length ? `평균 ${trim(bs.avgF, 1)}층 · 최고 ${bs.maxF}층` : '건물 없음') + '</div>';
    const kv = (a, b) => `<tr><td>${a}</td><td class="r">${b}</td></tr>`;
    h += '<table class="tb kv"><tbody>' +
      kv('가구 면적', trim(blk.area, 0) + '㎡') +
      kv('건축 획지 면적', `${trim(bs.net, 0)}㎡ <i class="sub">가구의 ${pct(blk.area ? bs.net / blk.area : 0)}</i>`) +
      kv('건축면적 합계', trim(bs.fp, 0) + '㎡') +
      kv('연면적 합계', trim(bs.gfa, 0) + '㎡') +
      kv('가구 전체 기준 건폐율 · 용적률', `${pct(bs.gBcr)} · ${pct(bs.gFar)}`) +
      (bs.open ? kv('공원·광장·녹지', `${trim(bs.open, 0)}㎡ <i class="sub">${pct(bs.open / blk.area)}</i>`) : '') +
      kv('추정 인구(주거 연면적 기준)', trim(bs.pop, 0) + '명') +
      '</tbody></table>';
    h += '<table class="tb"><thead><tr><th>용도 구성</th><th class="r">획지</th><th class="r">건물</th><th class="r">면적(㎡)</th><th class="r">비율</th></tr></thead><tbody>';
    C.USE_ORDER.forEach((k) => { const x = bs.byUse[k]; if (!x) return; h += `<tr><td><i class="sw2" style="background:${swc(C.USES[k].color)}"></i>${C.USES[k].name}</td><td class="r">${x.n}</td><td class="r">${x.bld || '-'}</td><td class="r">${trim(x.area, 0)}</td><td class="r">${pct(blk.area ? x.area / blk.area : 0)}</td></tr>`; });
    h += '</tbody></table>';
    // 건물 채우기: 용도와 건폐율·용적률·최고 층수로 가구 안의 획지를 한꺼번에 채운다
    if (!ui._fillUse || ui._fillBlk !== blk.id) { ui._fillBlk = blk.id; ui._fillUse = C.BLD_DEFAULT[S.use] ? S.use : C.BLD_DEFAULT[app.state.buildUse] ? app.state.buildUse : 'res'; }
    const fu = ui._fillUse, T = app.fillTargets(fu);
    h += f.head('건물 채우기' + tipI('획지마다 용적률 목표를 채우는 가장 적은 층수를 정하고, 그 층수에서 건폐율이 가장 크도록 건물 깊이를 맞춥니다(건축선 후퇴·이격을 지키고 최고 층수 이하). 새로 짓는 건물이라 맞벽은 두지 않습니다. 공원·광장·주차장 획지는 그대로 둡니다.'), S.fill ? `<span class="hn">지난번: ${C.USES[S.fill.use].name} · ${S.fill.bcr}% · ${S.fill.far}% · ${S.fill.fmax}층</span>` : '<span class="hn">학습용 기본값에서 시작</span>');
    h += f.sel('용도', fu, (v) => { ui._fillUse = v; ui.pane(); return false; }, BUILD_USES.map((k) => [k, C.USES[k].name]));
    h += f.num('건폐율 상한', T.bcr, (v) => { T.bcr = v; return false; }, { min: 5, max: 100, step: 5, unit: '%' });
    h += f.num('용적률 상한', T.far, (v) => { T.far = v; return false; }, { min: 10, max: 2000, step: 10, unit: '%' });
    h += f.num('최고 층수', T.fmax, (v) => { T.fmax = v; return false; }, { min: 1, max: 80, step: 1, int: true, unit: '층' });
    h += `<div class="rowbtn"><button class="btn pri sm" data-act="fillblock" data-arg="${blk.id}">${icon('gridl', 14)}이 가구를 건물로 채우기</button></div>`;
    h += f.head('가구 설정', '<span class="hn">가구 안의 모든 획지에 적용</span>');
    // 용도지역: 건폐율·용적률 상한의 기준. 정하지 않으면 획지 용도마다 가정한 지역을 쓴다
    const zDef = C.zoneOf(S.use, null);
    h += f.sel('용도지역', S.zone || '', (v) => { if (v) S.zone = v; else delete S.zone; },
      [['', `용도에 따라 가정${zDef ? `(${C.ZONES[zDef].name})` : ''}`]].concat(C.ZONE_ORDER.map((k) => [k, `${C.ZONES[k].name} · 건폐율 ${C.ZONES[k].bcr}% · 용적률 ${C.ZONES[k].far}%${C.ZONES[k].far0 ? `(조례 ${C.ZONES[k].far0.toLocaleString('ko-KR')}%)` : ''}`])));
    h += f.sel('가구 용도', S.use, (v) => {
      const was = C.USES[S.use].open, now = C.USES[v].open;
      const fit = S.bld && S.bld.fit === 'far'; // 신도시 블록: 용도를 바꿔도 용적률 최대로 짓기는 그대로
      S.use = v; S.bld = now ? {} : { noParty: true, ...(fit ? { fit: 'far' } : {}) }; S.lots = {}; S.merges = []; S.splits = {}; // 용도를 바꿔 새로 짓는 건물은 맞벽 불가
      if (S.auto) { if (now && v !== 'vacant') { delete S.auto; S.lotsAlong = 1; S.lotRows = 1; } } // 획지 수 자동인 가구: 공원·광장 같은 열린 용도로 바꾸면 한 획지로 굳힌다
      else if (now) { S.lotsAlong = 1; S.lotRows = 1; } else if (was || (S.lotsAlong || 1) <= 1) { S.lotsAlong = Math.max(2, Math.round((blk.dims ? blk.dims.long : 90) / 24)); S.lotRows = blk.dims && blk.dims.short < 36 ? 1 : 2; }
    }, C.USE_ORDER.map((k) => [k, C.USES[k].name]));
    if (S.use === 'park') h += f.sel('공원 유형', S.parkType || 'neighborhood', (v) => { S.parkType = v; }, Object.keys(C.PARK_TYPES).map((k) => [k, C.PARK_TYPES[k].name]));
    h += f.head('획지 나누기' + tipI('붙어 있는 획지 여럿을 Shift로 함께 고르면 하나로 합치고, 획지 하나를 고르면 둘 이상으로 나눌 수 있습니다.'), `<span class="hn">지금 ${nLots}개 획지${bs.merged ? ` · 합친 곳 ${bs.merged}` : ''}${bs.split ? ` · 나눈 곳 ${bs.split}` : ''}</span>`);
    h += f.num('도로변 획지 수', S.lotsAlong, (v) => { S.lotsAlong = v; S.lots = {}; S.merges = []; S.splits = {}; delete S.auto; }, { min: 1, max: 30, step: 1, int: true, unit: '개', note: S.auto ? '가구 크기에 맞춰 자동(약 24m 간격). 숫자를 바꾸면 그 값으로 고정' : '긴 변을 따라 나누는 수' });
    h += f.sel('획지 열', S.lotRows, (v) => { S.lotRows = +v; S.lots = {}; S.merges = []; S.splits = {}; delete S.auto; }, [[1, '1열(앞뒤 도로에 모두 접함)'], [2, '2열(등을 맞댐)'], [3, '3열(가운데 열은 맹지)']]);
    h += f.num('모서리 가각', S.chamfer === null || S.chamfer === undefined ? null : S.chamfer, (v) => { S.chamfer = v; }, { min: 0, max: 10, step: 0.5, unit: 'm', ph: '자동', nullable: true, note: '비우면 도로 모서리 반경에 맞춤' });
    if (bs.merged || bs.split) h += `<div class="rowbtn"><button class="btn sm" data-act="unmergeall" data-arg="${S.id}">${icon('reset', 13)}합치거나 나눈 획지 ${bs.merged + bs.split}곳 처음 격자로</button></div>`;
    if (!u.open) {
      h += f.head('건축물 기본값', '<span class="hn">획지별로 따로 바꾼 값은 유지</span>');
      const fitOn = !!(S.bld && S.bld.fit);
      h += f.chk('용적률 최대로', fitOn, (v) => { if (!S.bld) S.bld = {}; if (v) S.bld.fit = 'far'; else { delete S.bld.fit; S.bld.floors = Math.max(1, Math.round(bs.avgF || base.floors)); } },
        { on: fitOn ? (typeof S.bld.fit === 'object' ? `채우기 값(용적률 ${S.bld.fit.far}%)` : '용도지역 상한까지') : '층수 직접', note: '켜면 획지마다 용적률 상한을 채우는 층수로, 그 층수에서 건폐율이 가장 크게 짓습니다(서울특별시 도시계획 조례 · 용적률 800%까지)' });
      if (!fitOn) {
        h += f.num('층수', base.floors, (v) => { setB('floors', v); }, { min: 1, max: 60, step: 1, int: true, unit: '층' });
        h += f.range('층수 변화', Math.round((S.vary || 0) * 100), (v) => { S.vary = v / 100; }, { min: 0, max: 50, step: 5, sfx: '%', note: '건물마다 층수를 다르게' });
      }
      h += f.num('1층 높이', base.groundH, (v) => { setB('groundH', v); }, { min: 2.4, max: 8, step: 0.1, unit: 'm' });
      h += f.num('기준층 높이', base.floorH, (v) => { setB('floorH', v); }, { min: 2.4, max: 6, step: 0.1, unit: 'm' });
      h += f.num('건축선 후퇴', base.front, (v) => { setB('front', v); }, { min: 0, max: 20, step: 0.5, unit: 'm', note: '도로 쪽 전면공지 폭' });
      h += f.num('옆·뒤 이격', base.side, (v) => { setB('side', v); }, { min: 0, max: 20, step: 0.5, unit: 'm' });
      h += f.num('건물 깊이', base.depth || 0, (v) => { setB('depth', v); }, { min: 0, max: 150, step: 1, unit: 'm', note: '도로에서 안쪽으로 · 0이면 획지 깊이까지' });
      h += f.num('건물 길이', base.len || 0, (v) => { setB('len', v); }, { min: 0, max: 300, step: 1, unit: 'm', note: '도로를 따라 · 0이면 획지 폭에 맞춤' });
      h += facadeFields(f, sp, base.style, setB, (v) => { if (!S.bld) S.bld = {}; S.bld.style = v; STYLE_KEYS.forEach((k2) => delete S.bld[k2]); });
      h += f.chk('건물마다 다른 색', !!S.styleVary, (v) => { S.styleVary = v; }, { on: S.styleVary ? '기성 시가지처럼 섞음' : '가구 전체 같은 색' });
    }
    const nOv = Object.keys(S.lots || {}).length;
    if (nOv) h += `<div class="rowbtn"><button class="btn sm" data-act="blockreset" data-arg="${S.id}">${icon('reset', 13)}획지별 설정 ${nOv}건 지우기</button></div>`;
    return h;
  }

  /* 만들어진 수목 하나: 수종 바꾸기·지우기. 같은 길의 가로수 전체는 도로 속성에서 */
  function paneTree(f, t) {
    const P = app.P, sp = C.TREES[t.species] || C.TREES.zelkova, road = t.roadId ? app.road(t.roadId) : null;
    const kind = t.kind === 'street' ? '가로수' : t.kind === 'rab' ? '회전교차로 중앙섬 수목' : '공원·녹지 수목';
    let h = phead('tree', sp.name, `${kind}${road ? ' · ' + esc(road.name) : ''}`, tipI(`이 나무만 바꾸거나 지웁니다(Delete). ${road ? '같은 길의 가로수 전체는 도로 속성의 [가로수]에서 바꿉니다.' : t.kind === 'rab' ? '회전교차로를 지우면 함께 사라집니다.' : '공원 안의 배치는 공원 유형에 따릅니다.'}`) + `<button class="ibtn" data-act="treedel" title="이 나무 지우기" aria-label="이 나무 지우기">${icon('trash', 16)}</button>`);
    h += '<div class="stats">' + stat('수고', `${trim(sp.height, 1)}m`, '다 자랐을 때') + stat('수관 폭', `${trim(sp.crown, 1)}m`, `지하고 ${trim(sp.clear, 1)}m`) + '</div>';
    const orig = t.species0 || t.species;
    h += f.sel('수종', t.species, (v) => { P.treeSp = P.treeSp || {}; if (v === orig) delete P.treeSp[t.key]; else P.treeSp[t.key] = v; }, C.TREE_ORDER.map((k) => [k, `${C.TREES[k].name} · 수관 ${C.TREES[k].crown}m${k === orig ? ' (원래)' : ''}`]));
    const n = (P.treeOff || []).length;
    h += '<div class="rowbtn">' + (road ? `<button class="btn sm" data-act="selroad" data-arg="${esc(road.id)}">${icon('roadl', 13)}이 길 속성으로</button>` : '') + (n ? `<button class="btn sm" data-act="treerestore">${icon('reset', 13)}지운 나무 ${n}그루 되살리기</button>` : '') + '</div>';
    return h;
  }
  /* 배치: 제자리 회전·뒤집기, 획지 안 위치(이동 도구로 끌기), 다른 획지로 옮기기·복사 */
  /* 배치: 돌리기·뒤집기는 평면·3D에서 고른 건물 위의 막대와 손잡이로 한다. 여기서는 각도를 숫자로 정하고 되돌린다 */
  function placeHTML(lot, b, base) {
    if (b.custom) {
      return f0head('배치' + tipI('직접 그린 건물입니다. 평면에서 변에 마우스를 대고 끌면 밀고 당겨지고, 뒤쪽 동그란 손잡이를 끌면 돕니다. 위에 뜨는 막대로 돌리고 뒤집거나 다른 획지로 옮깁니다.')) +
        `<div class="plrow"><span class="pln l">직접 그린 모양 · 바닥 ${trim(b.area, 0)}㎡ · ${b.fp.length}각형</span></div>`;
    }
    const rot = +base.rot || 0, sh = Array.isArray(base.shift) ? base.shift : null, moved = sh && (sh[0] || sh[1]);
    const st = [base.flipU ? '좌우 뒤집음' : '', base.flipV ? '앞뒤 뒤집음' : '', moved ? `${trim(Math.hypot(sh[0], sh[1]), 1)}m 옮김` : ''].filter(Boolean).join(' · ');
    let h = f0head('배치' + tipI('평면에서 건물을 고르면 위에 뜨는 막대로 돌리고 뒤집거나 다른 획지로 옮깁니다. 뒤쪽 동그란 손잡이를 끌면 5°씩(Shift 15°) 돌고, 변에 마우스를 대고 끌면 깊이·길이가 바뀝니다. 건축선 후퇴·이격 범위를 벗어나면 모양을 지킨 채 줄여 맞춥니다.'),
      (moved ? `<button class="btn sm" data-act="bldx" data-arg="${lot.id}|center">제자리로</button>` : '') + (b.xf ? `<button class="btn sm" data-act="bldx" data-arg="${lot.id}|reset">${icon('reset', 13)}처음대로</button>` : ''));
    h += `<div class="plrow"><span class="sl">회전</span><label class="rotin"><input type="number" data-act-input="bldrot" data-arg="${lot.id}" value="${trim(rot, 1)}" step="5" min="-180" max="180" aria-label="회전 각도(반시계 +)"><i>°</i></label>` +
      `<span class="pln">${st || `건축선 후퇴 ${trim(b.frontEff !== undefined ? b.frontEff : b.front, 1)}m`}</span></div>`;
    return h;
  }
  const f0head = (t, extra) => `<div class="h"><b>${t}</b>${extra || ''}</div>`;
  /* 건물 하나의 태양궤적도(스테레오 투영): 고른 입면(또는 옥상)에서 본 하늘과 둘레 건물의 가림, 해의 길 */
  function spHTML(lot) {
    const X = UDS.Ana; if (!X || !X.bldSky) return '';
    const fc = app.state.spFace || 'S';
    const tips = { S: '남쪽 입면 가운데 · 지상 1.5m', E: '동쪽 입면 가운데 · 지상 1.5m', W: '서쪽 입면 가운데 · 지상 1.5m', N: '북쪽 입면 가운데 · 지상 1.5m', R: '지붕 가운데 · 지붕 위 0.5m' };
    return `<div class="h sph"><b data-tip="스테레오 투영 · 북쪽이 위 · 수목 제외">태양궤적도</b><span class="seg sm spface" role="group" aria-label="관측점">${X.FACES.map(([k, n]) => `<button data-act="spface" data-arg="${k}" aria-pressed="${fc === k}" data-tip="${tips[k]}">${n}</button>`).join('')}</span></div>` +
      `<div class="spbox" data-lot="${esc(lot.id)}">${spInner(lot.id)}</div>`;
  }
  function spInner(lotId) {
    const X = UDS.Ana, S = app.P.settings;
    const sky = X.bldSky(app, lotId, app.state.spFace || 'S'); if (!sky) return '';
    const d = UDS.dayOf(S), today = X.pointSun(sky, S.lat, d), win = d === 356 ? today : X.pointSun(sky, S.lat, 356);
    const hm = (x) => { const m = Math.round(x * 60); return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`; };
    return X.stereoSVG(S, sky) +
      '<div class="spleg"><span><i class="sw-o"></i>둘레 건물</span><span><i class="sw-s"></i>이 건물</span><span><i class="sw-p"></i>지금 해(끌면 시각이 바뀜)</span></div>' +
      `<div class="spsum"><div><b>${dateText(d)}</b> 해 드는 시간 ${hm(today.all)}</div>` +
      `<div>동지 8~16시 ${hm(win.tot)} · 9~15시 연속 ${hm(win.best)} <span class="tg${win.ok ? '' : ' w'}" data-tip="판례의 수인한도: 동지 9~15시 연속 2시간 또는 8~16시 총 4시간">${win.ok ? '기준 충족' : '기준 미달'}</span></div></div>`;
  }
  /* 시각·날짜를 끄는 동안 궤적도만 다시 그린다 */
  ui.spRefresh = function () { const el = $('#side .spbox'); if (el && el.dataset.lot) el.innerHTML = spInner(el.dataset.lot); };
  /* 태양궤적도의 해를 끌면 시각이 바뀐다: 지금 날짜의 해의 길에서 가장 가까운 시각(5분 단위). 길 위를 눌러도 그 시각으로 */
  (function spDrag() {
    const R = 124, cx = 150, cy = 150, rad = Math.PI / 180;
    const pr = (az, alt) => { const r = R * Math.tan(((90 - alt) / 2) * rad); return [cx + r * Math.sin(az * rad), cy - r * Math.cos(az * rad)]; };
    const svgPt = (box, e) => { const sv = box.querySelector('svg.stereo'); if (!sv) return null; const r = sv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 300, ((e.clientY - r.top) / r.height) * 300]; };
    const hourAt = (p) => {
      const S = app.P.settings, lat = S.lat || 36.6, doy = UDS.dayOf(S);
      let best = null, bd = Infinity;
      for (let h = 3; h <= 21.001; h += 1 / 12) { const v = UDS.sunVector({ lat, doy, hour: h }); if (v.alt <= 0) continue; const q = pr(v.az / rad, v.alt / rad), d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; best = h; } }
      return best === null ? null : { h: Math.round(best * 12) / 12, d: Math.sqrt(bd) };
    };
    const setHour = (h) => {
      const S = app.P.settings; if (Math.abs(S.hour - h) < 1e-6) return;
      S.hour = h; app.invalidate(7); ui.sunLive();
      $$('input[data-fmt="time"]').forEach((i) => { i.value = h; const row = i.closest('.drow') || i.parentNode, o = row && row.querySelector('output'); if (o) o.textContent = UDS.fmtTime(h); });
    };
    let drag = null;
    document.addEventListener('pointerdown', (e) => {
      const box = e.target.closest && e.target.closest('.spbox'); if (!box || e.button) return;
      const p = svgPt(box, e); if (!p) return;
      const v = UDS.sunVector(app.P.settings), sp = v.alt > 0 ? pr(v.az / rad, v.alt / rad) : null;
      const near = !!sp && Math.hypot(sp[0] - p[0], sp[1] - p[1]) < 16, on = hourAt(p);
      if (!near && !(on && on.d < 9)) return;
      drag = { box, id: e.pointerId }; try { box.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
      box.classList.add('dragging'); e.preventDefault();
      if (!near && on) setHour(on.h);
    });
    document.addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag.id) return; const p = svgPt(drag.box, e), r = p && hourAt(p); if (r) setHour(r.h); });
    const end = () => { if (!drag) return; drag.box.classList.remove('dragging'); drag = null; ui.xRefresh(); ui.sunPopRefresh(); };
    document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
  })();

  /* 회전교차로: 크기(내접원 지름)와 회전차로 수. 비우면 만나는 길의 폭에 맞춘 자동값 */
  /* 수공간: 종류마다 크기(지름·가로·세로·모서리 반지름·회전, 하천 폭)와 넓이, 건너는 다리 */
  function paneWater(f, w) {
    const D = app.D, dw = (D.waters || []).find((x) => x.id === w.id), br = (D.bridges || []).filter((g) => g.waterId === w.id);
    const area = dw ? dw.area : 0, nRoads = new Set(br.map((g) => g.roadId)).size;
    let h = phead(UDS.WATER_ICON[w.kind] || 'pond', M.WATER[w.kind] || '수공간', `수면 ${trim(area, 0)}㎡${dw && w.kind === 'river' ? ` · 깊이 ${trim(dw.depth, 1)}m` : ''}${br.length ? ` · 다리 ${nRoads}곳` : ''}`,
      `<button class="ibtn" data-act="waterdel" title="수공간 지우기" aria-label="수공간 지우기">${icon('trash', 16)}</button>`);
    if (w.kind === 'circle') h += f.num('지름', (w.r || 6) * 2, (v) => { w.r = v / 2; }, { min: 1, max: 200, step: 0.5, unit: 'm' });
    if (w.kind === 'rect') {
      h += f.num('가로', w.w || 18, (v) => { w.w = v; }, { min: 1, max: 400, step: 0.5, unit: 'm' });
      h += f.num('세로', w.h || 10, (v) => { w.h = v; }, { min: 1, max: 400, step: 0.5, unit: 'm' });
      h += f.num('모서리 반지름', w.cr || 0, (v) => { w.cr = v; }, { min: 0, max: 100, step: 0.5, unit: 'm', note: '짧은 변 길이의 절반까지' });
      h += f.num('회전', w.rot || 0, (v) => { let a = v % 360; if (a > 180) a -= 360; if (a <= -180) a += 360; w.rot = a; }, { min: -360, max: 360, step: 5, unit: '°', note: '반시계 방향 +' });
    }
    if (w.kind === 'river') {
      const dep = dw ? dw.depth : Dv.RIVER_DEPTH;
      h += f.num('폭', w.w || 12, (v) => { w.w = v; }, { min: 1, max: 120, step: 0.5, unit: 'm', note: '둑과 둑 사이(수면 폭)' });
      h += f.num('깊이', dep, (v) => { w.depth = v; }, { min: 0, max: 20, step: 0.5, unit: 'm', note: '지면에서 수면까지. 3D에서 물길이 그만큼 땅속으로 내려가고 호안 벽이 보입니다(0이면 지면 높이)' });
      h += f.chk('천변공원', (w.park || 0) > 0, (v) => { w.park = v ? w.parkW || 12 : 0; if (v) w.parkW = w.park; }, { on: (w.park || 0) > 0 ? '둑을 따라 녹지·산책로' : '없음', note: '양쪽 둑을 따라 녹지와 물가 산책로, 가로수를 둡니다. 건물은 그 바깥으로 물러납니다' });
      if ((w.park || 0) > 0) h += f.num('천변공원 폭', w.park, (v) => { w.park = v; w.parkW = v; }, { min: 3, max: 80, step: 1, unit: 'm', note: '한쪽 폭(둑에서 바깥으로)' });
    }
    if (w.kind === 'free' || w.kind === 'river') h += `<p class="zln">찍은 점 ${w.ctrl.length}개를 지나는 곡선(베지에) ${tipI('[이동] 도구로 이 수공간을 고른 뒤 흰 점을 끌어 모양을 고칩니다. 수공간 안쪽을 끌면 통째로 옮겨집니다.')}</p>`;
    if (br.length) {
      h += f.head('다리', `<span class="hn">물을 건너는 도로·길</span>`);
      h += '<table class="tb"><tbody>' + Array.from(new Set(br.map((g) => g.roadId))).map((id) => {
        const r = app.road(id), gs = br.filter((g) => g.roadId === id), span = gs.reduce((a, g) => a + g.span, 0);
        return r ? `<tr data-act="selroad" data-arg="${id}" tabindex="0"><td>${esc(r.name)}</td><td class="r">폭 ${trim(gs[0].W)}m</td><td class="r">길이 ${trim(span, 0)}m</td></tr>` : '';
      }).join('') + '</tbody></table>';
    }
    h += `<p class="zln">물가${w.kind === 'river' && w.park > 0 ? '(천변공원 바깥)' : ''}에서 1.5m 안쪽에는 건물을 세우지 않고, 물 위의 가로수·공원 나무는 빼냅니다 ${tipI('도로나 단지 안 길을 물 위로 그리면 그 구간은 다리가 되어 양쪽에 난간이 섭니다. 수공간은 대상지 밖까지 그려도 됩니다.')}</p>`;
    return h;
  }
  function paneRab(f, rb, sp) {
    const kind = rb.lanes === 2 ? '2차로형' : rb.d <= 26 ? '소형' : '1차로형';
    const about = '회전하는 차가 우선, 들어오는 차가 양보(반시계 방향). 「회전교차로 설계지침」(국토교통부): 소형·1차로형·2차로형, 1차로형은 하루 2만 대·2차로형은 3만 2천 대 이하에 권장. [이동] 도구로 끌면 모인 도로가 함께 움직입니다. 학습용 간이 모형(회전차로 폭·진입 곡선은 어림값).';
    let h = phead('rabout', '회전교차로', rb.arms ? `${kind} · 만나는 길 ${rb.arms}개 · 진입로 ${rb.entries}곳` : `${kind} · 길과 이어지지 않음`, tipI(about) + `<button class="ibtn" data-act="rabdel" title="회전교차로 지우기" aria-label="회전교차로 지우기">${icon('trash', 16)}</button>`);
    h += '<div class="stats">' +
      stat('내접원 지름', `${trim(rb.d, 1)}m`, rb.auto ? '자동' : '직접 정함') +
      stat('회전차로', `${trim(rb.wc, 1)}m`, `${rb.lanes}차로`) +
      stat('중앙섬 지름', `${trim(rb.Ra * 2, 1)}m`, `화물차 턱 ${trim(rb.apron, 1)}m`) +
      stat('차지하는 지름', `${trim(rb.R2 * 2, 0)}m`, '둘레 보도 포함') + '</div>';
    h += f.num('내접원 지름', sp.d > 0 ? sp.d : null, (v) => { sp.d = v; }, { min: 16, max: 80, step: 1, unit: 'm', nullable: true, ph: `자동 ${trim(rb.dAuto, 0)}`, note: sp.d > 0 && rb.d > sp.d + 0.05 ? `!만나는 길의 폭 때문에 ${trim(rb.d, 1)}m보다 작게 할 수 없습니다.` : '비우면 만나는 길의 폭에 맞춰 정합니다.' });
    h += f.sel('회전차로 수', sp.lanes === 1 || sp.lanes === 2 ? String(sp.lanes) : '', (v) => { sp.lanes = v ? +v : null; }, [['', `자동 (${rb.autoLanes ? rb.lanes : '폭에 맞춤'}차로)`], ['1', '1차로'], ['2', '2차로']]);
    if (!rb.arms) h += '<p class="lead tip">[도로 그리기]로 가운데에 도로를 이으면 진입로가 생깁니다.</p>';
    return h;
  }

  function paneObject(f, o) {
    const def = C.OBJECTS[o.type] || { name: o.type, icon: 'road' };
    let h = phead(def.icon, def.name, `위치 ${trim(o.x, 1)}, ${trim(o.y, 1)}m`, tipI('[이동] 도구로 평면에서 끌어 옮깁니다. 더 놓으려면 왼쪽 메뉴에서 다시 고르세요.') + `<button class="ibtn" data-act="objdel" title="지우기" aria-label="${def.name} 지우기">${icon('trash', 16)}</button>`);
    if (o.type === 'tree') h += f.sel('수종', o.species || 'zelkova', (v) => { o.species = v; }, C.TREE_ORDER.map((k) => [k, `${C.TREES[k].name} · 수관 ${C.TREES[k].crown}m`]));
    else if (o.type === 'shrub') h += f.num('반경', o.r || 1.6, (v) => { o.r = v; }, { min: 0.5, max: 6, step: 0.1, unit: 'm' });
    else h += f.range('방향', Math.round((((o.rot || 0) * 180) / Math.PI + 720) % 360 / 5) * 5 % 360, (v) => { o.rot = U.round((v * Math.PI) / 180, 4); }, { min: 0, max: 355, step: 5, sfx: '°' });
    return h;
  }

  /* 고른 건물(획지)의 입지: 접한 도로, 도로를 따라 걸어서 닿는 시설(5분 400m · 10분 800m) */
  function locHTML(f, li) {
    const L = UDS.Ana && UDS.Ana.location(app, li.lot.id); if (!L) return '';
    const lot = li.lot, b = lot.building, u = C.USES[lot.use] || { name: '' };
    const dm = (d) => (d === Infinity ? '-' : d >= 1000 ? `${trim(d / 1000, 2)}km` : `${trim(Math.round(d / 10) * 10, 0)}m`);
    const park = L.rows.find((r) => r.k === 'park'), bus = L.rows.find((r) => r.k === 'bus');
    let h = phead(UDS.USE_ICON[lot.use] || (b ? 'building' : 'plaza'), '입지 분석', `${esc(b ? u.name + ' 건물 · ' + b.floors + '층' : u.name + ' 획지')} · ${L.corner ? '모퉁이(각지)' : L.front.length ? '한 길에 면함' : '도로에 접하지 않음'}`,
      `<button class="btn sm back" data-act="gotab" data-arg="props" title="${b ? u.name + ' 건물' : u.name + ' 획지'} 속성으로 돌아가기">${icon('left', 13)}돌아가기</button>`);
    h += '<div class="stats">' +
      stat('접한 도로', `${L.front.length}면`, L.front.length ? L.front.map((x) => x.cls).join(' · ') : '맹지') +
      stat('가까운 공원', dm(park ? park.near : Infinity), park && park.n4 ? `400m 안 ${park.n4}곳` : '400m 안 없음') +
      stat('버스정류장', dm(bus ? bus.near : Infinity), bus && bus.n4 ? `400m 안 ${bus.n4}곳` : '400m 안 없음') +
      stat('5분 보행권 인구', `${trim(L.pop4, 0)}명`, '400m 안 주거 연면적 추정') + '</div>';
    if (L.front.length) {
      h += f.head('접한 도로');
      h += '<table class="tb"><thead><tr><th>노선</th><th>규모</th><th class="r">폭</th><th class="r">접도</th></tr></thead><tbody>' +
        L.front.map((x) => `<tr data-act="selroad" data-arg="${esc(x.id)}" tabindex="0"><td>${esc(x.name)}${x.bike ? ' <span class="tg">자전거</span>' : ''}${x.bus ? ' <span class="tg">버스</span>' : ''}${x.walk ? '' : ' <span class="tg w">보도 없음</span>'}</td><td>${x.cls}</td><td class="r">${trim(x.W)}m</td><td class="r">${trim(x.len, 0)}m</td></tr>`).join('') + '</tbody></table>';
    }
    h += f.head('보행권 안의 시설' + tipI(`건물에서 접한 도로(${L.road})로 나간 뒤 도로 중심선을 따라 잰 보행 거리(횡단보도 위치·경사는 따지지 않은 어림값). 5분 400m · 10분 800m는 근린 보행권의 흔한 기준입니다.`), '<span class="hn">도로를 따라 잰 거리</span>');
    h += '<table class="tb"><thead><tr><th>시설</th><th class="r">가장 가까이</th><th class="r">5분<br>400m</th><th class="r">10분<br>800m</th></tr></thead><tbody>' +
      L.rows.map((r) => `<tr${r.near === Infinity && !r.n8 ? ' class="mut"' : ''}><td>${esc(r.name)}</td><td class="r">${dm(r.near)}</td><td class="r">${r.n4}</td><td class="r">${r.n8}</td></tr>`).join('') + '</tbody></table>';
    return h + '<div class="psep2"></div>';
  }
  function paneMetrics(f) {
    const P = app.P, D = app.D, m = D.metrics;
    const t = app.state.sel, li = t && (t.type === 'building' || t.type === 'lot') && app.selList().length <= 1 ? app.lotInfo(t.id) : null;
    let h = li ? locHTML(f, li) : '';
    h += phead('plaza', '지표', `${esc(P.meta.title || '')} · 대상지 ${trim(m.site, 0)}㎡`);
    h += '<div class="stats">' + stat('건폐율', pct(m.bcr), '건축면적 ÷ 건축 획지') + stat('용적률', pct(m.far), '연면적 ÷ 건축 획지') + stat('도로율', pct(m.roadRatio), '도로 ÷ 대상지') + stat('공원·녹지율', pct(m.parkRatio), '공원·광장·녹지 ÷ 대상지') + '</div>';
    h += goalsHTML(f, m);
    const kv = (a, b) => `<tr><td>${a}</td><td class="r">${b}</td></tr>`;
    h += '<table class="tb kv"><tbody>' +
      kv('가구 · 획지 · 건물', `${m.blocks} · ${m.lots} · ${m.buildings}`) +
      kv('총 연면적', trim(m.gfa, 0) + '㎡') +
      kv('대상지 전체 용적률', pct(m.grossFar)) +
      kv('최고 높이', trim(m.maxH, 1) + 'm') +
      kv('추정 인구', trim(m.pop, 0) + '명') +
      kv('1인당 공원면적', m.parkPerCap === null ? '-' : trim(m.parkPerCap, 1) + '㎡') +
      kv('수목(그중 가로수)', `${trim(m.trees, 0)}주 (${trim(m.streetTrees, 0)}주)`) +
      '</tbody></table>';
    h += f.head('토지이용계획표');
    h += '<table class="tb"><thead><tr><th>구분</th><th class="r">면적(㎡)</th><th class="r">비율</th></tr></thead><tbody>';
    C.USE_ORDER.forEach((k) => { const a = m.byUse[k]; if (!a) return; h += `<tr><td><i class="sw2" style="background:${swc(C.USES[k].color)}"></i>${C.USES[k].name}</td><td class="r">${trim(a, 0)}</td><td class="r">${pct(a / m.site)}</td></tr>`; });
    h += `<tr><td><i class="sw2" style="background:${swc(C.PAL.asphalt)}"></i>도로</td><td class="r">${trim(m.roadArea, 0)}</td><td class="r">${pct(m.roadRatio)}</td></tr>`;
    h += `<tr class="sum"><td>합계</td><td class="r">${trim(m.site, 0)}</td><td class="r">100%</td></tr></tbody></table>`;
    h += f.head('가로 위계표', '<span class="hn">누르면 선택</span>');
    h += roadTable();
    return h;
  }

  /* 계획 목표: 마스터플랜의 밀도·녹지·인구 목표를 정해 두고 지금 계획과 견준다(목표는 계획에 함께 저장) */
  const GOALS = [
    ['far', '용적률', (m) => (m.buildings ? m.far * 100 : null), '%', 20, 1500, 10, '건축 획지 기준 연면적 ÷ 획지면적'],
    ['bcr', '건폐율', (m) => (m.buildings ? m.bcr * 100 : null), '%', 5, 90, 1, '건축 획지 기준 건축면적 ÷ 획지면적'],
    ['road', '도로율', (m) => m.roadRatio * 100, '%', 5, 60, 1, '도로 ÷ 대상지'],
    ['park', '공원·녹지율', (m) => m.parkRatio * 100, '%', 1, 60, 1, '공원·광장·녹지 ÷ 대상지'],
    ['pop', '추정 인구', (m) => m.pop, '명', 10, 200000, 10, '주거 연면적 ÷ 1인당 주거면적'],
  ];
  function goalsHTML(f, m) {
    const P = app.P, G = P.meta.goals || {};
    let h = f.head('계획 목표', '<span class="hn">목표를 넣으면 지금 값과 견줍니다</span>');
    h += '<div class="goals">';
    GOALS.forEach(([k, name, get, unit, min, max, step, note]) => {
      const cur = get(m), tg = +G[k] > 0 ? +G[k] : 0;
      const r = tg && cur !== null ? cur / tg : null;
      const cls = r === null ? '' : r > 1.1 ? ' over' : r < 0.9 ? ' under' : ' ok';
      const top = Math.max(tg, cur || 0) || 1;
      const say = r === null ? '' : r > 1.1 ? `목표보다 ${trim(cur - tg, unit === '명' ? 0 : 1)}${unit} 많음` : r < 0.9 ? `목표의 ${Math.round(r * 100)}%` : '목표 범위(±10%)';
      h += `<div class="goal${cls}"><span class="gn tp" data-tip="${esc(note)}">${name}</span><span class="gv">${cur === null ? '-' : trim(cur, unit === '명' ? 0 : 1) + unit}</span>` +
        f.numIn(tg || null, (v) => { const g = { ...(P.meta.goals || {}) }; if (v > 0) g[k] = v; else delete g[k]; P.meta.goals = g; }, { min, max, step, nullable: true, unit, k: 'goal-' + k, ph: '목표', aria: name + ' 목표' }) +
        `<span class="gb" aria-hidden="true"><i style="width:${(((cur || 0) / top) * 100).toFixed(1)}%"></i>${tg ? `<b style="left:${((tg / top) * 100).toFixed(1)}%"></b>` : ''}</span>${say ? `<span class="gs">${say}</span>` : ''}</div>`;
    });
    return h + '</div>';
  }

  /* 작업 순서: 대상지 → 도로망 → 용도·밀도 → 건축물 → 가로 단면 → 법규 검토. 계획 상태로 끝낸 단계를 표시하고 다음 단계를 안내 */
  const FLOW = [
    ['site', '대상지', '왼쪽 [대상지]에서 실제 지역(지도에서 고르기)이나 가상 대상지를 고릅니다.'],
    ['road', '도로망', '왼쪽 [도로]에서 위계(대로·중로·소로·골목)를 골라 평면에 그립니다. 도로로 둘러싸인 땅이 가구가 됩니다.'],
    ['use', '용도·밀도', '평면에서 가구를 눌러 용도와 건폐율·용적률을 정합니다.'],
    ['bld', '건축물', '획지를 눌러 건물 층수·형태를 정하거나 왼쪽 [건물]에서 놓습니다. 3D에서 스케일을 봅니다.'],
    ['sec', '가로 단면', '아래 단면 화면에서 보도·차로 폭과 양쪽 건물의 높이(D/H)를 확인합니다.'],
    ['law', '법규 검토', '[법규검토] 탭에서 도로·건축 기준에 어긋난 곳을 고칩니다.'],
  ];
  function flowState() {
    const P = app.P, D = app.D, m = D.metrics;
    const errs = D.checks.filter((c) => c.level === 'error').length;
    return {
      site: true, road: P.roads.some((r) => !r.inner),
      use: D.lots.some((l) => l.use && l.use !== 'vacant'),
      bld: m.buildings > 0, sec: !!app.state.secSeen, law: m.buildings > 0 && errs === 0,
    };
  }
  function flowHTML() {
    const S = flowState();
    const next = FLOW.find(([k]) => !S[k]);
    let h = '<div class="flow" role="list" aria-label="작업 순서">' + FLOW.map(([k, n], i) => `<button class="fl${S[k] ? ' done' : ''}${next && next[0] === k ? ' cur' : ''}" role="listitem" data-act="flow" data-arg="${k}" data-tip="${esc(FLOW[i][2])}"><i>${S[k] ? icon('check', 11) : i + 1}</i><span>${n}</span></button>`).join('') + '</div>';
    h += next ? `<p class="flownext"><b>다음 · ${next[1]}</b> ${next[2]}</p>` : '<p class="flownext"><b>모든 단계를 거쳤습니다.</b> 목표(지표 탭)와 견주며 다듬으세요.</p>';
    return h;
  }

  function checkList() {
    const seen = new Set(), out = [];
    app.D.checks.forEach((c) => { const k = c.level + '|' + (c.target ? c.target.type + (c.target.id || '') + (c.target.seg || '') + (c.target.util || '') : '') + '|' + c.msg; if (seen.has(k)) return; seen.add(k); out.push(c); });
    return out;
  }
  function targetName(t) {
    if (!t || t.type === 'site') return '지구 전체';
    if (t.type === 'road') { const r = app.road(t.id); return r ? r.name : '도로'; }
    if (t.type === 'block') { const b = app.block(t.id); return b ? `${C.USES[b.use].name} 가구` : '가구'; }
    const l = app.D.lots.find((x) => x.id === t.id);
    return l ? `${C.USES[l.use].name} ${t.type === 'building' ? '건물' : '획지'}` : '획지';
  }
  function paneChecks() {
    const list = (ui._checks = checkList());
    const by = { error: [], warn: [], info: [] };
    list.forEach((c, i) => by[c.level].push([c, i]));
    let h = phead('box', '법규검토', `기준 미달 ${by.error.length} · 주의 ${by.warn.length} · 참고 ${by.info.length}`, tipI('용도지역 건폐율·용적률 상한(서울특별시 도시계획 조례, 용적률은 800%까지)과 도로·보도 기준 등 법령 수치, 학습용 간이 기준으로 살핀 결과입니다. 항목을 누르면 고르고, 더블클릭하면 평면·3D가 그 자리로 다가갑니다.'));
    // 바로 고칠 수 있는 것: 전주·가공선 지중화(한 번에)
    const ov = app.P.roads.filter((r) => r.overhead && app.D.roadInfo.get(r.id) && app.D.roadInfo.get(r.id).lay.hasCar);
    if (ov.length) h += `<div class="ckfix"><span><b>전주·가공선</b> 도로 ${ov.length}곳 · 전주 ${app.D.poles.length}개 ${tipI('지중화하면 전주를 걷어 내고 전력·통신선을 보도 밑 관로로 옮깁니다. 전주에 막혀 좁던 보도 유효폭이 넓어집니다. 도로마다 하려면 도로를 고른 뒤 [속성]의 [지중화하기]를 누르거나, 단면에서 전력관을 넣습니다.')}</span><button class="btn sm pri" data-act="undergrall">모두 지중화</button></div>`;
    const one = (lv, [c, i]) => `<button class="ck ${lv}" data-act="check" data-arg="${i}"><b>${esc(targetName(c.target))}</b><span>${esc(c.msg)}</span><small>${esc(c.ref || '')}</small></button>`;
    const grp = (lv, title) => {
      if (!by[lv].length) return '';
      let g = `<div class="h"><b>${title}</b><span class="hn">${by[lv].length}건</span></div>`;
      // 같은 종류가 4건 이상이면 한 묶음으로 접어서 목록이 한 종류로 뒤덮이지 않게 함
      const buckets = [], at = {};
      by[lv].forEach((it) => { const k = it[0].kind || it[0].msg; if (!(k in at)) { at[k] = buckets.length; buckets.push({ k, kind: it[0].kind, items: [] }); } buckets[at[k]].items.push(it); });
      buckets.forEach((bk) => {
        if (!bk.kind || bk.items.length < 4) { bk.items.forEach((it) => { g += one(lv, it); }); return; }
        const key = lv + ':' + bk.k;
        const open = !!(ui._ckOpen && ui._ckOpen[key]);
        const names = new Set(bk.items.map(([c]) => targetName(c.target)));
        const show = open ? bk.items : bk.items.slice(0, 3);
        g += `<div class="ckg ${lv}"><div class="ckgh"><b>${esc(bk.kind)}</b><span>${bk.items.length}곳</span></div>`;
        show.forEach(([c, i]) => { const t = (names.size > 1 ? targetName(c.target) + ' · ' : '') + c.msg; g += `<button class="cki" data-act="check" data-arg="${i}" title="${esc(t)}">${esc(t)}</button>`; });
        g += `<div class="ckgf"><small>${esc(bk.items[0][0].ref || '')}</small><button class="ckm" data-act="ckmore" data-arg="${esc(key)}" aria-expanded="${open}">${open ? '접기' : `나머지 ${bk.items.length - 3}곳 펼치기`}</button></div></div>`;
      });
      return g;
    };
    h += grp('error', '기준 미달') + grp('warn', '주의') + grp('info', '참고');
    if (!list.length) h += '<p class="lead">기준에 어긋나는 곳이 없습니다.</p>';
    return h;
  }

  /* ---------- 팝오버·대화상자·알림 ---------- */
  /* side: 'right'면 기준 단추의 오른쪽에(띠 모양 왼쪽 메뉴에서 펼치는 창), 아니면 아래(자리가 없으면 위)에 띄운다 */
  ui.pop = function (anchor, html, cls, side) {
    const p = $('#pop');
    if (!p.hidden && p._anchor === anchor) { ui.closePop(); return null; }
    p.className = 'pop ' + (cls || ''); p.innerHTML = html; p.hidden = false; p._anchor = anchor; p._form = null; p._kind = null;
    const r = anchor.getBoundingClientRect();
    p.style.left = '0px'; p.style.top = '0px';
    const pw = p.offsetWidth, ph = p.offsetHeight;
    let x = Math.min(window.innerWidth - pw - 8, Math.max(8, r.left));
    let y = r.bottom + 6;
    if (side === 'right') { x = Math.min(window.innerWidth - pw - 8, r.right + 8); y = Math.max(8, Math.min(r.top - 6, window.innerHeight - ph - 8)); }
    else if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 6);
    p.style.left = x + 'px'; p.style.top = y + 'px';
    return p;
  };
  ui.closePop = function () {
    const p = $('#pop');
    if (p && !p.hidden) { if (p._kind === 'menu') $$('.mb[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false')); p.hidden = true; p._anchor = null; p._form = null; p._kind = null; return true; }
    return false;
  };
  ui.dialog = function (title, body, foot) {
    const d = $('#dialog');
    d.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dh2"><b>${esc(title)}</b><button class="ibtn" data-act="closedlg" aria-label="닫기">${icon('close', 16)}</button></div><div class="db">${body}</div>${foot ? `<div class="df">${foot}</div>` : ''}</div>`;
    d.hidden = false;
    const fb = $('.df .pri, .db input, .db textarea', d); if (fb) { try { fb.focus(); } catch (e) { /* 무시 */ } }
    return d;
  };
  ui.closeDialog = function () { const d = $('#dialog'); if (d && !d.hidden) { d.hidden = true; d.innerHTML = ''; return true; } return false; };
  ui.closeOverlays = function () { return ui.closePop() || ui.closeDialog(); };
  /* 되돌리는 방법 안내: 자판이 있는 기기는 Ctrl+Z, 손가락으로 쓰는 기기는 위쪽의 되돌리기 단추 */
  ui.undoTip = function () { return window.matchMedia && window.matchMedia('(pointer:coarse)').matches ? '위쪽 되돌리기 단추로 복구합니다.' : 'Ctrl+Z로 되돌립니다.'; };
  ui.toast = function (msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(ui._tt); ui._tt = setTimeout(() => { t.hidden = true; }, 4200);
  };

  /* ---------- 메뉴 막대(프로젝트·편집·보기·도움말) ----------
     Word처럼 이름을 누르면 아래로 펼쳐지고, 펼친 채 옆 이름 위로 가면 그 메뉴로 바뀐다. 항목 옆에는 단축키를 적는다 */
  const KEYMOD = /Mac|iPhone|iPad/.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '') ? '⌘' : 'Ctrl+';
  function menuHTML(k) {
    const st = app.state, P = app.P, D = app.D;
    const it = (act, arg, label, o) => {
      o = o || {};
      const chk = o.check !== undefined;
      return `<button class="mm${o.warn ? ' warn' : ''}" data-act="${act}"${arg != null ? ` data-arg="${arg}"` : ''}${o.dis ? ' disabled' : ''} role="${chk ? 'menuitemcheckbox' : 'menuitem'}"${chk ? ` aria-checked="${!!o.check}"` : ''}>` +
        `<span class="mk">${chk ? (o.check ? icon('check', 14) : '') : o.ic ? icon(o.ic, 15) : ''}</span><span class="ml">${label}</span>${o.key ? `<kbd>${o.key}</kbd>` : ''}</button>`;
    };
    const sep = '<hr>', cap = (t) => `<div class="mcap">${t}</div>`;
    if (k === 'project') {
      return `<div class="mhead"><b>${esc(P.meta.title || '계획')}</b><i>${SCENE_NAME[P.meta.scene] && SCENE_NAME[P.meta.scene] !== P.meta.title ? SCENE_NAME[P.meta.scene] + ' · ' : ''}${trim(P.site.w, 0)}×${trim(P.site.h, 0)}m · 도로 ${P.roads.length} · 건물 ${D.metrics.buildings}동</i></div>` +
        it('newproject', null, '새 프로젝트…', { ic: 'newfile' }) + it('realopen', null, '실제 지역 불러오기…', { ic: 'city' }) + it('openfile', null, '작업 파일 열기…', { ic: 'upload', key: KEYMOD + 'O' }) + it('savefile', null, '작업 파일 저장', { ic: 'download', key: KEYMOD + 'S' }) +
        sep + cap('내보내기') + it('exportsvg', null, '평면도 (SVG · 1:1000)', { ic: 'file' }) + it('exportsecsvg', null, '가로 단면 (SVG · 1:100)', { ic: 'file' }) + it('exportsec', null, '가로 단면 (PNG)', { ic: 'image' }) + it('export3d', null, '3D 장면 (PNG)', { ic: 'image' }) + it('airender', null, 'AI 렌더 (Gemini 이미지)…', { ic: 'spark' }) + it('exportmodel', null, '3D 모델 (GLB·DAE·OBJ)…', { ic: 'cube' }) +
        sep + it('resetscene', null, '처음 상태로 되돌리기…', { ic: 'reset' }) + it('clearall', null, '전체 지우기…', { ic: 'trash', warn: true });
    }
    if (k === 'edit') {
      const nSel = app.selList().length, nv = app.vacantBlocks().length;
      return it('undo', null, '되돌리기', { ic: 'undo', key: KEYMOD + 'Z', dis: app.hi <= 0 }) + it('redo', null, '다시 하기', { ic: 'redo', key: KEYMOD + 'Shift+Z', dis: app.hi >= app.hist.length - 1 }) +
        sep + it('settool', 'select', '선택', { check: st.tool === 'select', key: 'V' }) + it('settool', 'move', '이동', { check: st.tool === 'move', key: 'M' }) + it('settool', 'erase', '지우개', { check: st.tool === 'erase', key: 'E' }) +
        it('settool', 'road', '도로 그리기', { check: st.tool === 'road', key: 'R' }) + it('settool', 'build', '건물 놓기', { check: st.tool === 'build', key: 'B' }) +
        sep + it('delsel', null, nSel > 1 ? `고른 ${nSel}개 지우기` : '고른 것 지우기', { ic: 'trash', key: 'Delete', dis: !nSel }) + it('deselect', null, '선택 풀기', { key: 'Esc', dis: !nSel }) +
        sep + it('fillvacantdlg', null, nv ? `빈 가구 ${nv}곳 건물로 채우기…` : '빈 가구 건물로 채우기…', { ic: 'gridl', dis: !nv });
    }
    if (k === 'view') {
      const L = st.layers, line = app.modeOf('2d') === 'line' && app.modeOf('3d') === 'line';
      return cap('화면 배치') + it('viewsw', 'split', '평면과 3D 나란히', { check: st.view === 'split' }) + it('viewsw', '2d', '평면만', { check: st.view === '2d' }) + it('viewsw', '3d', '3D만', { check: st.view === '3d' }) +
        cap('크게 보기 (Esc로 되돌림)') + it('max', '2d', '평면', { check: st.max === '2d' }) + it('max', '3d', '3D', { check: st.max === '3d' }) + it('max', 'sec', '가로 단면', { check: st.max === 'sec' }) +
        sep + cap('표현 (화면마다 이름 옆에서도 바꿈)') + it('setmode', 'color', '모든 화면 채색', { check: st.mode === 'color' }) + it('setmode', 'line', '모든 화면 선 도면', { check: st.mode === 'line' }) + it('layers', null, '레이어…', { ic: 'layers' }) +
        (app.ctxData() ? sep + cap('현황 건물 표현') + UDS.Ctx.MODES.map(([k, n]) => it('ctxmode', k, n, { check: st.ctxMode === k, dis: line })).join('') : '') +
        sep + it('shadow', null, '그림자', { check: !!L.shadows && !line, dis: line }) + it('traffic', null, '3D 오브젝트(사람·차량)', { check: !!st.traffic.on }) + it('sun', null, '음영분석(시각·날짜·조명)…', { ic: 'sun' }) +
        sep + it('fit2d', null, '대상지 전체 보기', { ic: 'fit' }) + (palNarrow() ? '' : it('panel', 'L', '왼쪽 메뉴', { check: !st.hideL }) + it('panel', 'R', '오른쪽 패널', { check: !st.hideR })) +
        (UDS.TH ? sep + cap('테마') + it('theme', 'dark', '다크', { check: UDS.TH.pref === 'dark' }) + it('theme', 'light', '라이트', { check: UDS.TH.pref === 'light' }) + it('theme', 'system', '시스템 설정 따름', { check: UDS.TH.pref === 'system' }) : '');
    }
    return it('help', null, '사용법', { ic: 'help', key: 'F1' }) + it('keys', null, '단축키', { ic: 'keyboard' }) +
      sep + '<div class="mhead about"><b>Urbify</b><i>Interactive Urban Design Platform · ' + UDS.VERSION + ' (' + UDS.BUILD + ')</i>' +
      '<small class="mcopy">© 2026 Urban Planning &amp; Informatics Lab, School of Smart Cities, Korea University (Prof. Jooseok Oh). All rights reserved.</small></div>';
  }
  function menuPop(anchor, k) {
    const p = ui.pop(anchor, `<div class="mlist" role="menu" aria-label="${(MENUS.find((x) => x[0] === k) || [])[1] || ''}">${menuHTML(k)}</div>`, 'mdrop');
    if (p) { p._kind = 'menu'; anchor.setAttribute('aria-expanded', 'true'); }
  }

  function layersPop(anchor) {
    const L = app.state.layers;
    const rows = [['buildings', '건물'], ['trees', '수목'], ['furniture', '가로시설물·가로등·전주'], ['shadows', '그림자(채색에서만)'], ['labels', '글자(도로·용도 이름, 평면)'], ['utilities', '지하시설(평면에 표시, 3D는 투시)']];
    if (app.underlay) rows.push(['underlay', '지도 밑그림 겹쳐 보기(평면)']);
    if (app.ctxData()) { rows.push(['ctx', '현황 건물(실제 지역)']); if (app.ctxData().par.length) rows.push(['parcels', '지적(필지 경계·지목)']); }
    ui.pop(anchor, '<div class="pt2">보이는 요소</div>' + rows.map(([k, n]) => `<label class="lyr"><input type="checkbox" data-layer="${k}"${L[k] ? ' checked' : ''}><span>${n}</span></label>`).join(''), 'narrow');
  }
  /* 프로젝트 메뉴: 새로 만들기·열기·저장 / 내보내기 / 초기화·전체 지우기. 계획 전체에 걸친 일은 모두 여기에 모은다 */
  function projectPop(anchor) {
    const it = (act, ic, name, sub, cls) => `<button class="mi${cls ? ' ' + cls : ''}" data-act="${act}">${icon(ic, 16)}<span><b>${name}</b><i>${sub}</i></span></button>`;
    const P = app.P, m = app.D.metrics;
    ui.pop(anchor, `<div class="pt2 pj">${esc(SCENE_NAME[P.meta.scene] || P.meta.title || '프로젝트')}<i>${trim(P.site.w, 0)}×${trim(P.site.h, 0)}m · 도로 ${P.roads.length} · 가구 ${m.blocks} · 건물 ${m.buildings}</i></div>` +
      it('newproject', 'newfile', '새 프로젝트…', '대상지 종류를 골라 새로 시작') + it('openfile', 'upload', '작업 파일 열기…', '저장해 둔 .json 불러오기') + it('savefile', 'download', '작업 파일 저장', '나중에 이어서 할 수 있는 .json') +
      '<hr><div class="pt2">내보내기</div>' + it('exportsvg', 'file', '평면도 (SVG)', '벡터 도면 · 1:1000 · 지금 표현 그대로') + it('exportsecsvg', 'file', '가로 단면 (SVG)', '벡터 도면 · 1:100 · 지금 열린 단면') + it('exportsec', 'image', '가로 단면 (PNG)', '화면에 보이는 그대로의 그림') + it('export3d', 'image', '3D 장면 (PNG)', '지금 보이는 시점') + it('airender', 'spark', 'AI 렌더 (Gemini)', '지금 시점의 매스를 그대로 둔 사실적 그림') + it('exportmodel', 'cube', '3D 모델 (GLB·DAE·OBJ)', 'SketchUp·Rhino·Blender에서 여는 모형') +
      '<hr>' + it('resetscene', 'reset', '처음 상태로 되돌리기', '이 대상지를 처음 열었을 때의 배치로') + it('clearall', 'trash', '전체 지우기', '도로·건물·시설물을 모두 지우고 빈 터로', 'warn'), 'menu proj');
  }
  /* 단축키 목록 */
  function keysDlg() {
    const K = KEYMOD;
    const g = (title, rows) => `<tr class="kh"><th colspan="2">${title}</th></tr>` + rows.map(([k, d]) => `<tr><td><kbd>${k.split(' / ').join('</kbd> / <kbd>')}</kbd></td><td>${d}</td></tr>`).join('');
    ui.dialog('단축키', '<table class="keys"><tbody>' +
      g('도구', [['V', '선택'], ['M', '이동(시설물·도로 꼭짓점·도로 전체 끌기)'], ['E', '지우개'], ['R', '도로 그리기'], ['B', '건물 놓기'], ['Enter', '그리던 도로 끝내기']]) +
      g('편집', [[K + 'Z', '되돌리기'], [K + 'Shift+Z / ' + K + 'Y', '다시 하기'], ['Delete', '고른 것 지우기'], ['Shift+누르기', '여럿 고르기(휴대폰은 길게 누르기)'], ['Esc', '그리기 취소 · 크게 보기 끝내기 · 선택 풀기']]) +
      g('프로젝트', [[K + 'S', '작업 파일 저장'], [K + 'O', '작업 파일 열기'], ['F1', '사용법']]) +
      g('화면', [['휠', '확대·축소'], ['끌기', '평면 이동 · 3D 돌리기'], ['Shift+끌기', '3D 화면 옮기기'], ['더블클릭', '요소로 다가가기(옆 화면이 따라감)']]) +
      '</tbody></table>', '<button class="btn" data-act="closedlg">닫기</button>');
  }
  const fvText = (use) => { const T = app.fillTargets(use); return `기준: 건폐율 ${T.bcr}% · 용적률 ${T.far}% 이하 · 최고 ${T.fmax}층 (왼쪽 [건물]의 '가구 전체'에서 바꿈)`; };
  /* 빈 가구를 한꺼번에 채우기(편집 메뉴) */
  function fillVacantDlg() {
    const nv = app.vacantBlocks().length, use = app.state.buildUse, T = app.fillTargets(use);
    const nCtx = app.ctxInBlocks(app.vacantBlocks().map((b) => b.id));
    ui.dialog('빈 가구 건물로 채우기', `<p>건물이 하나도 없는 빈 가구 <b>${nv}곳</b>을 고른 용도의 건물로 채웁니다. 획지마다 건축선 후퇴·이격을 지킨 뒤 건폐율 상한을 넘으면 건물 깊이를 줄이고, 용적률 상한을 넘지 않는 가장 높은 층수로 세웁니다.</p>` +
      (nCtx ? `<p class="err">실제 지역입니다. 이 가구들에 서 있는 현황 건물 <b>${nCtx}동</b>이 모두 철거된 것으로 처리됩니다. 일부만 바꾸려면 가구를 하나씩 골라 채우세요.</p>` : '') +
      `<div class="sizef"><label><span>용도</span><select id="fvUse">${BUILD_USES.map((k) => `<option value="${k}"${k === use ? ' selected' : ''}>${C.USES[k].name}</option>`).join('')}</select></label></div>` +
      `<p class="mut" id="fvT">${fvText(use)}</p>`,
      `<button class="btn pri" data-act="fillvacantgo">${nv}곳 채우기</button><button class="btn" data-act="closedlg">취소</button>`);
  }

  /* 새 프로젝트: 대상지 종류 고르기 */
  function newProjectDialog() {
    ui.closePop();
    const card = (k, ic, name, desc) => `<button class="ncard" data-new="${k}">${picto(ic, 34)}<span><b>${name}</b><i>${desc}</i></span>${icon('right', 14)}</button>`;
    const edited = app.isEdited();
    ui.dialog('새 프로젝트', `<p>대상지 종류를 고르면 새로 엽니다.${edited ? ' <b>지금 작업은 닫히므로</b> 남겨 두려면 먼저 저장하세요.' : ''}</p><div class="ncards">` +
      `<div class="nrow">${card('standard', 'grid', SCENE_NAME.standard, '격자형 가구·위계별 도로·근린공원을 갖춘 신시가지(420×300m)')}<button class="nrand" data-new="random:new" data-tip="격자형·변형 격자형 도시를 새로 만듭니다">${picto('dice', 24)}<span>임의생성</span></button></div>` +
      `<div class="nrow">${card('oldtown', 'oldtown', SCENE_NAME.oldtown, '좁은 보도·전주·골목길·노후 상가가 남은 지방 구도심(360×260m)')}<button class="nrand" data-new="random:old" data-tip="구도심형 대상지를 새로 만듭니다">${picto('dice', 24)}<span>임의생성</span></button></div>` +
      card('blank', 'blank', SCENE_NAME.blank, '크기만 정하고 도로부터 직접 그리기') +
      card('real', 'city', '실제 지역 불러오기', '지도에서 대상지를 골라 실제 동네의 현황 건물과 도로망을 세움(인증키 없이 · 브이월드 인증키가 있으면 층수·용도·사용승인일까지)') +
      card('import', 'map', '지도 캡처로 만들기', '네이버·카카오 지도 화면 그림에서 도로망을 읽어 만듦') + '</div>',
      (edited ? `<button class="btn" data-act="savefile">${icon('download', 14)}작업 파일 저장</button>` : '') + '<button class="btn" data-act="closedlg">취소</button>');
  }
  /* 빈 대상지: 크기 정하기 */
  function blankDialog() {
    ui.closePop();
    const s0 = app.P && app.P.meta.scene === 'blank' ? app.P.site : { w: 400, h: 300 };
    const edited = app.isEdited();
    ui.dialog('빈 대상지', `<p>아무것도 없는 터에서 시작합니다. 도로를 그리면 도로로 둘러싸인 곳이 가구가 되고, 가구는 크기에 맞춰 획지로 나뉩니다. 건물은 [건물 놓기]로 세우거나 가구 용도를 바꿔 채웁니다.${edited ? ' <b>지금 작업은 닫힙니다.</b>' : ''}</p>` +
      `<div class="sizef"><label><span>가로</span><input type="number" id="blankW" min="100" max="1200" step="10" value="${Math.round(s0.w)}" inputmode="numeric"><i>m</i></label><span class="x">×</span><label><span>세로</span><input type="number" id="blankH" min="100" max="1200" step="10" value="${Math.round(s0.h)}" inputmode="numeric"><i>m</i></label><output id="blankHa"></output></div>` +
      '<div class="szs" role="group" aria-label="자주 쓰는 크기">' + [[300, 200], [400, 300], [600, 400], [800, 600]].map(([w, h]) => `<button class="szb" data-blank="${w}x${h}">${w}×${h}m</button>`).join('') + '</div><p class="err" id="blankErr" hidden></p>',
      '<button class="btn pri" data-act="blankgo">빈 대상지 만들기</button><button class="btn" data-act="closedlg">취소</button>');
    blankHa();
  }
  function blankHa() {
    const w = +($('#blankW') || {}).value, h = +($('#blankH') || {}).value, o = $('#blankHa');
    if (o) o.textContent = w > 0 && h > 0 ? `${trim((w * h) / 10000, 1)}ha` : '';
  }
  function morePop(anchor) {
    const L = app.state.layers;
    const rows = [['buildings', '건물'], ['trees', '수목'], ['furniture', '가로시설물'], ['shadows', '그림자'], ['labels', '글자'], ['utilities', '지하시설']];
    if (app.ctxData()) { rows.push(['ctx', '현황 건물']); if (app.ctxData().par.length) rows.push(['parcels', '지적']); }
    if (app.underlay) rows.push(['underlay', '지도 밑그림']);
    const it = (act, ic, name) => `<button class="mi" data-act="${act}">${icon(ic, 16)}<span><b>${name}</b></span></button>`;
    ui.pop(anchor, '<div class="pt2">보이는 요소</div><div class="grid2">' + rows.map(([k, n]) => `<label class="lyr"><input type="checkbox" data-layer="${k}"${L[k] ? ' checked' : ''}><span>${n}</span></label>`).join('') + '</div><hr>' +
      it('sun', 'sun', '음영분석') + '<hr><div class="pt2">프로젝트</div>' + it('newproject', 'newfile', '새 프로젝트…') + it('openfile', 'upload', '작업 파일 열기…') + it('savefile', 'download', '작업 파일 저장') +
      '<hr><div class="pt2">내보내기</div>' + it('exportsvg', 'file', '평면도 (SVG·벡터)') + it('exportsecsvg', 'file', '가로 단면 (SVG·벡터)') + it('exportsec', 'image', '가로 단면 (PNG)') + it('export3d', 'image', '3D 장면 (PNG)') + it('airender', 'spark', 'AI 렌더 (Gemini)') + it('exportmodel', 'cube', '3D 모델 (GLB·DAE·OBJ)') +
      '<hr>' + it('resetscene', 'reset', '처음 상태로 되돌리기') + it('clearall', 'trash', '전체 지우기') + '<hr>' + it('help', 'help', '사용법'), 'menu');
  }
  /* 시각·계절·조명: 속성 패널과 3D 팝오버가 같이 씀 */
  function sunFields(f, full, noShadow) {
    const S = app.P.settings;
    const t = UDS.sunTimes(S), k = UDS.sky(S);
    const cur = k.day > 0.9 && k.gold < 0.3 ? 'day' : k.day < 0.12 ? 'night' : 'dusk';
    let h = `<div class="todrow"><div class="seg" role="group" aria-label="때">${[['day', '낮'], ['dusk', '해질녘'], ['night', '밤']].map(([v, n]) => `<button data-act="tod" data-arg="${v}" aria-pressed="${cur === v}">${n}</button>`).join('')}</div></div>`;
    h += timeRow(f, S, t);
    const shOn = !!app.state.layers.shadows, lineMode = app.modeOf('2d') === 'line' && app.modeOf('3d') === 'line';
    if (!noShadow) h += f.row('그림자', `<span class="seg" role="group" aria-label="그림자">${[['off', '끔'], ['on', '켬']].map(([v, n]) => `<button data-act="shadow" data-arg="${v}" aria-pressed="${(v === 'on') === shOn}">${n}</button>`).join('')}</span>`,
      lineMode ? (shOn ? '선 도면에서는 그리지 않음 · 채색으로 돌아오면 다시 켜짐' : '선 도면에서는 그리지 않음') : !shOn ? '평면·3D에 건물·수목 그림자를 그리지 않음' : k.shadows ? '평면·3D에 표시 중' : '해가 진 시각이라 그림자가 없음');
    h += dateRow(f, S);
    h += f.sel('조명', S.lights || 'auto', (v) => { S.lights = v; }, [['auto', '어두워지면 켬'], ['on', '항상 켬'], ['off', '끔']], { note: k.on ? '가로등·창·차량 등이 켜져 있음' : '지금은 꺼져 있음' });
    if (full) h += f.sel('위도', String(S.lat || 36.6), (v) => { S.lat = parseFloat(v); }, [['37.5', '서울·수도권 37.5°'], ['36.6', '세종·충청 36.6°'], ['35.8', '대구·전주 35.8°'], ['35.1', '부산·광주 35.1°'], ['33.5', '제주 33.5°']].concat([37.5, 36.6, 35.8, 35.1, 33.5].includes(+S.lat || 36.6) ? [] : [[String(S.lat), `직접 입력 ${trim(S.lat, 1)}°`]]), { note: '해의 높이와 그림자 길이에 반영' });
    return h;
  }
  /* 시각 막대: 날짜 막대와 같은 너비로 하루를 한 줄에. 해가 떠 있는 동안을 옅게 칠하고, 일출·정오·일몰 단추 */
  function timeRow(f, S, t) {
    const i = f.bind((raw) => { S.hour = parseFloat(raw); return 'view'; });
    const pos = (h) => ((U.clamp(h, 0, 24) / 24) * 100).toFixed(2);
    let ticks = '';
    for (let h = 3; h < 24; h += 3) ticks += `<i style="left:${pos(h)}%"></i>`;
    const day = t && isFinite(t[0]) && isFinite(t[1]) ? `<b class="dsun" style="left:${pos(t[0])}%;width:${(pos(t[1]) - pos(t[0])).toFixed(2)}%"></b>` : '';
    const keys = (t && isFinite(t[0]) ? [[t[0], '일출'], [12, '정오'], [t[1], '일몰']] : [[12, '정오']])
      .map(([h, n]) => `<button type="button" data-act="sethour" data-arg="${(Math.round(h * 4) / 4).toFixed(2)}" style="left:${pos(h)}%" data-tip="${n} ${UDS.fmtTime(h)}">${n}</button>`).join('');
    return `<div class="drow trow"><div class="drh"><span class="lb">시각</span><output>${UDS.fmtTime(S.hour)}</output></div>` +
      `<div class="dtw"><span class="dmk" aria-hidden="true">${day}${ticks}</span><input type="range" data-b="${i}" data-live="1" data-fmt="time" data-sun="1" data-k="시각" min="0" max="24" step="0.25" value="${S.hour}" aria-label="시각"></div>` +
      `<div class="dkeys">${keys}</div></div>`;
  }
  /* 날짜 막대: 1년을 한 줄에. 달마다 눈금, 춘분·하지·추분·동지는 막대 아래 단추(누르면 그날로, 끌 때는 가까이 가면 붙음) */
  function dateRow(f, S) {
    const d = UDS.dayOf(S);
    const i = f.bind((raw) => { S.doy = UDS.snapDay(+raw); return 'view'; });
    const pos = (x) => (((x - 1) / 364) * 100).toFixed(2);
    let ticks = '';
    for (let m = 2; m <= 12; m++) ticks += `<i style="left:${pos(UDS.monthStart(m))}%"></i>`;
    const keys = UDS.KEY_DAYS.map(([k, n]) => `<button type="button" data-act="setday" data-arg="${k}" aria-pressed="${k === d}" style="left:${pos(k)}%" data-tip="${n} · ${UDS.fmtDate(k)}">${n}</button>`).join('');
    return `<div class="drow"><div class="drh"><span class="lb">날짜</span><output>${dateText(d)}</output></div>` +
      `<div class="dtw"><span class="dmk" aria-hidden="true">${ticks}</span><input type="range" data-b="${i}" data-live="1" data-fmt="date" min="1" max="365" step="1" value="${d}" aria-label="날짜"></div>` +
      `<div class="dkeys">${keys}</div></div>`;
  }
  function sunPop(anchor) {
    const f = mkForm();
    const p = ui.pop(anchor, '<div class="pt2">음영분석</div>' + sunFields(f, true) + `<div class="pform">${anaHTML()}</div>`, 'form');
    if (p) { p._form = f; p._kind = 'sun'; }
  }
  ui.sunPopRefresh = function () { const p = $('#pop'); if (p && !p.hidden && p._kind === 'sun' && p._anchor) { const a = p._anchor; ui.closePop(); sunPop(a); } ui.xRefresh(); };
  function secShowPop(anchor) {
    const sh = app.state.secShow;
    const rows = [['text', '텍스트', '건물 이름표 · 구간 이름 · 연석 · 관 이름 등 모든 글자'], ['dim', '치수', '구간 폭 치수 열 · 도로 폭 · 도로경계선 · 후퇴 거리'], ['util', '지하시설물', '지하 관로 · 맨홀 · 빗물받이 · 깊이 눈금']];
    ui.pop(anchor, '<div class="pt2">단면에 표시할 정보</div>' + rows.map(([k, n, d]) => `<label class="lyr two"><input type="checkbox" data-secshow="${k}"${sh[k] !== false ? ' checked' : ''}><span><b>${n}</b><i>${d}</i></span></label>`).join(''), 'narrow');
  }
  function setSecShow(k, on) {
    const st = app.state;
    st.secShow[k] = !!on;
    if (k === 'util' && !on) st.selUtil = null; // 숨긴 관은 골라 둘 수 없다
    ui.secHead(); if (st.tab === 'props') ui.pane();
    app.invalidate(4);
  }
  function addSegPop(anchor) {
    ui.pop(anchor, '<div class="pt2">추가할 구간</div><div class="grid2">' + C.SEG_ORDER.map((k) => `<button class="gi" data-act="addsegtype" data-arg="${k}">${picto(UDS.SEG_ICON[k], 24)}<span>${C.SEG[k].name}</span><small>${trim(C.SEG[k].defW)}m</small></button>`).join('') + '</div><p class="pnote">선택한 구간의 오른쪽에 들어갑니다.</p>', 'wide');
  }
  function addUtilPop(anchor) {
    ui.pop(anchor, '<div class="pt2">추가할 지하시설</div><div class="grid2">' + C.UTIL_ORDER.map((k) => `<button class="gi" data-act="addutiltype" data-arg="${k}"><i class="udot" style="background:${swc(C.UTIL[k].color)}"></i><span>${C.UTIL[k].name}</span><small>깊이 ${trim(C.UTIL[k].depth, 1)}m</small></button>`).join('') + '</div><p class="pnote">단면에서 관을 끌어 위치와 깊이를 옮깁니다.</p>', 'wide');
  }

  function download(name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 800);
  }
  const fileBase = () => (app.P.meta.title || '도시설계').replace(/[\\/:*?"<>|\s]+/g, '_');
  /* Claude 화면 안(샌드박스 프레임)에서는 직접 내려받기가 막혀 있으므로, 화면이 제공하는 저장 기능이 있으면 그것을 씀 */
  let hostSave = null, hostAsk = null;
  function askHost() {
    if (hostAsk) return hostAsk;
    let pr = null;
    try { if (window.claude && typeof window.claude.use === 'function') pr = window.claude.use('downloads'); } catch (e) { pr = null; }
    if (!pr) return Promise.resolve(null); // 아직 준비 전일 수 있으므로 기억해 두지 않고 다음에 다시 물음
    hostAsk = Promise.resolve(pr).then((d) => { hostSave = d || null; return hostSave; }, () => null);
    return hostAsk;
  }
  const soon = (pr, ms) => Promise.race([pr, new Promise((res) => setTimeout(() => res(null), ms))]);
  function saveOut(name, data, mime, okMsg, fallback) {
    if (canDownload) { download(name, data, mime); ui.toast(okMsg); return; }
    soon(askHost(), 1500).then((d) => {
      if (!d) { fallback(); return; }
      d.save({ filename: name, data }).then((r) => { if (r && r.status === 'saved') ui.toast(okMsg); }, (err) => { if (err && err.code === 'declined') return; fallback(); });
    });
  }
  const dataUrlBlob = (url) => { const b = atob(url.slice(url.indexOf(',') + 1)); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new Blob([a], { type: 'image/png' }); };
  function copyText(s, okMsg) {
    const done = () => ui.toast(okMsg || '복사했습니다.');
    const fallback = () => { const ta = $('#dialog textarea'); if (ta) { ta.focus(); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { ui.toast('복사하지 못했습니다. 글상자의 내용을 직접 선택해 복사하세요.'); } } };
    try { navigator.clipboard.writeText(s).then(done, fallback); } catch (e) { fallback(); }
  }
  ui.copyText = copyText;
  /* 그림 파일 저장(Claude 화면 안에서는 화면이 주는 저장 기능): AI 렌더 결과·참고 그림 */
  ui.saveDataUrl = function (name, url) {
    if (canDownload) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 800); ui.toast('이미지를 저장했습니다.'); return; }
    soon(askHost(), 1500).then((d) => {
      if (!d) { ui.toast('이 화면에서는 파일을 바로 내려받을 수 없습니다. 그림을 길게 누르거나 오른쪽 버튼으로 눌러 저장하세요.'); return; }
      let blob = null; try { blob = dataUrlBlob(url); } catch (e) { blob = null; }
      if (!blob) { ui.toast('이미지를 만들지 못했습니다.'); return; }
      d.save({ filename: name, data: blob }).then((r) => { if (r && r.status === 'saved') ui.toast('이미지를 저장했습니다.'); }, (err) => { if (!(err && err.code === 'declined')) ui.toast('저장하지 못했습니다. 그림을 길게 누르거나 오른쪽 버튼으로 눌러 저장하세요.'); });
    });
  };
  function saveFile() {
    const json = JSON.stringify(app.exportProject());
    saveOut(fileBase() + '.json', json, 'application/json', '작업 파일을 저장했습니다.', () => {
      ui._copy = json;
      ui.dialog('작업 파일 저장', '<p>이 화면에서는 파일을 바로 내려받을 수 없습니다. 아래 내용을 복사해 메모장 등에 보관했다가, [작업 파일 불러오기]에 붙여 넣으면 이어서 작업할 수 있습니다.</p><textarea readonly rows="7" aria-label="작업 파일 내용">' + esc(json) + '</textarea>', '<button class="btn pri" data-act="copydlg">내용 복사</button><button class="btn" data-act="closedlg">닫기</button>');
    });
  }
  function openFile() {
    ui.dialog('작업 파일 불러오기', '<p>저장해 둔 .json 파일을 고르거나, 복사해 둔 내용을 붙여 넣으세요. 지금 화면의 계획은 불러온 계획으로 바뀝니다.</p><input type="file" id="fileIn" accept=".json,application/json" aria-label="작업 파일 고르기"><textarea id="pasteIn" rows="6" placeholder="복사해 둔 작업 파일 내용 붙여 넣기" aria-label="작업 파일 내용 붙여 넣기"></textarea><p class="err" id="openErr" hidden></p>', '<button class="btn pri" data-act="doopen">불러오기</button><button class="btn" data-act="closedlg">취소</button>');
  }
  function loadJSON(txt) {
    let P = null;
    try { P = JSON.parse(txt); } catch (e) { P = null; }
    if (!app.validProject(P)) { const er = $('#openErr'); if (er) { er.hidden = false; er.textContent = '작업 파일 형식이 아닙니다. 이 도구에서 저장한 .json인지 확인하세요.'; } return; }
    ui.closeDialog();
    app.load(P);
    ui.toast('작업 파일을 불러왔습니다.');
  }
  function showImage(title, url, name, extra) {
    const host = !canDownload && !!hostSave;
    ui._img = { name, url };
    ui.dialog(title, `<p>${canDownload || host ? '아래 그림이 저장할 내용입니다.' : '이 화면에서는 파일을 바로 내려받을 수 없습니다. 그림을 길게 누르거나 오른쪽 버튼으로 눌러 저장하세요.'}</p><div class="imgbox"><img src="${url}" alt="${esc(title)} 미리보기"></div>${extra || ''}`,
      (canDownload ? `<a class="btn pri" href="${url}" download="${esc(name)}">파일로 저장</a>` : host ? '<button class="btn pri" data-act="hostimg">파일로 저장</button>' : '') + '<button class="btn" data-act="closedlg">닫기</button>');
  }
  function exportSVG() {
    const svg = app.r2.exportSVG();
    saveOut(`${fileBase()}_평면.svg`, svg, 'image/svg+xml', '평면도를 SVG로 저장했습니다.', () => {
      ui._copy = svg;
      showImage('평면도 내보내기', 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), `${fileBase()}_평면.svg`, '<textarea readonly rows="3" aria-label="SVG 코드">' + esc(svg.slice(0, 4000)) + (svg.length > 4000 ? '…' : '') + '</textarea>');
      const df = $('#dialog .df'); if (df) df.insertAdjacentHTML('afterbegin', '<button class="btn pri" data-act="copydlg">SVG 코드 복사</button>');
    });
  }
  function exportSecSVG() {
    let svg = null;
    try { svg = app.sec.exportSVG(); } catch (e) { console.error(e); svg = null; }
    if (!svg) { ui.toast('내보낼 단면이 없습니다. 평면이나 3D에서 도로를 먼저 눌러 주세요.'); return; }
    const name = `${fileBase()}_단면.svg`;
    saveOut(name, svg, 'image/svg+xml', '가로 단면을 SVG로 저장했습니다.', () => {
      ui._copy = svg;
      showImage('가로 단면 내보내기(SVG)', 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), name, '<textarea readonly rows="3" aria-label="SVG 코드">' + esc(svg.slice(0, 4000)) + (svg.length > 4000 ? '…' : '') + '</textarea>');
      const df = $('#dialog .df'); if (df) df.insertAdjacentHTML('afterbegin', '<button class="btn pri" data-act="copydlg">SVG 코드 복사</button>');
    });
  }
  function exportCanvas(which) {
    let cv = null, name = '';
    const TH = UDS.TH, dk = !!(TH && TH.inkOn());
    let url = '';
    if (which === '3d') {
      if (!app.r3.ok) return;
      if (dk) TH.off = true; // 그림 파일은 라이트 바탕으로
      try { app.r3.draw(); cv = app.r3.cv; name = `${fileBase()}_3D.png`; if (cv && cv.width >= 20) url = cv.toDataURL('image/png'); } catch (e) { url = ''; } finally { if (dk) { TH.off = false; app.invalidate(2); } }
    } else { cv = app.sec.exportCanvas(); name = `${fileBase()}_단면.png`; }
    if (!cv || cv.width < 20) { ui.toast(which === '3d' ? '3D 화면을 먼저 열어 주세요.' : '단면 화면을 먼저 열어 주세요.'); return; }
    try { if (!url) url = cv.toDataURL('image/png'); } catch (e) { ui.toast('이미지를 만들지 못했습니다.'); return; }
    const title = which === '3d' ? '3D 장면 내보내기' : '가로 단면 내보내기';
    if (canDownload) showImage(title, url, name); else soon(askHost(), 1500).then(() => showImage(title, url, name));
  }
  /* 3D 모델 내보내기: 형식과 넣을 것을 고른다 */
  const MODEL_FMT = [['glb', 'GLB', 'SketchUp(최신)·Blender·Rhino 8'], ['dae', 'DAE', 'SketchUp(모든 판)'], ['obj', 'OBJ', 'Rhino·3ds Max 등 (.obj+.mtl 압축)']];
  ui.modelOpt = { fmt: 'glb', ground: true, bld: true, tree: true, furn: true, ctx: true, util: false };
  function modelDlg() {
    ui.closePop();
    const o = ui.modelOpt, cx = !!app.ctxData();
    const fm = MODEL_FMT.map(([k, n, d]) => `<label class="mfmt"><input type="radio" name="mfmt" value="${k}"${o.fmt === k ? ' checked' : ''}><b>${n}</b><i>${d}</i></label>`).join('');
    const cb = (k, n, tip) => `<label class="lyr"${tip ? ` data-tip="${tip}"` : ''}><input type="checkbox" data-mopt="${k}"${o[k] ? ' checked' : ''}><span>${n}</span></label>`;
    ui.dialog('3D 모델 내보내기', `<div class="mfmts" role="radiogroup" aria-label="형식">${fm}</div>` +
      `<div class="mopts">${cb('bld', '건물', '동마다 따로 묶음')}${cb('ground', '바닥·도로', '대상지·획지·공원·차로·보도·노면 표시·연석')}${cb('tree', '수목', '줄기와 수관 부피')}${cb('furn', '가로시설물', '가로등·전주·벤치 등')}${cx ? cb('ctx', '현황 건물') : ''}${cb('util', '지하시설', '관로·맨홀')}</div>` +
      '<p class="mut">단위 m · 원점은 대상지 남서쪽 모서리' + (app.mats().length ? '<br>이미지 재료의 그림은 GLB 파일 안에, OBJ·DAE는 zip의 textures 폴더에 함께 넣음(창·1층·간판은 빠짐)' : '') + '</p>',
      '<button class="btn pri" data-act="exportmodelgo">내보내기</button><button class="btn" data-act="closedlg">취소</button>');
  }
  function exportModel() {
    const o = ui.modelOpt;
    $$('#dialog [data-mopt]').forEach((c) => { o[c.dataset.mopt] = c.checked; });
    const r = $('#dialog input[name="mfmt"]:checked'); if (r) o.fmt = r.value;
    if (!app.ctxData()) o.ctx = false;
    let out = null;
    try { out = UDS.Export3D.build(app, o.fmt, o, app.P.meta.title || 'Urbify'); } catch (e) { console.error(e); out = null; }
    if (!out) { ui.toast('내보낼 도형이 없습니다. 넣을 것을 하나 이상 고르세요.'); return; }
    ui.closeDialog();
    const name = `${fileBase()}_3D.${out.ext}`;
    saveOut(name, out.blob, out.blob.type, `3D 모델을 저장했습니다 (삼각형 ${out.ntri.toLocaleString()}개${out.ntex ? `, 재료 그림 ${out.ntex}장` : ''}).`, () => ui.toast('이 화면에서는 파일을 내려받을 수 없습니다.'));
  }
  function helpDlg() {
    ui.dialog('사용법', '<ul class="help">' +
      '<li><b>대상지</b>는 왼쪽 메뉴의 [대상지]에서 고릅니다. 도시(가상), 구도심(가상), 누를 때마다 새로 만드는 임의생성(가상), 아무것도 없는 빈 대상지, 지도 캡처 그림에서 도로를 읽어 만든 대상지 가운데 하나로 시작합니다.</li>' +
      '<li><b>실제 지역</b>: [프로젝트] 메뉴나 [대상지]의 [실제 지역 고르기]에서 장소를 찾고 지도를 끌어 가운데 사각형을 대상지에 맞춘 뒤 [대상지 만들기]를 누릅니다. 인증키 없이 공개 지도 자료(Overture Maps·OpenStreetMap)로 건물 윤곽과 도로 중심선(따로 그려진 양방향 차도는 하나로, 원형 교차로는 회전교차로로)을 세우고, 층수·높이 자료가 없는 건물은 용도와 건축면적으로 어림합니다. 브이월드 인증키가 있으면 건물(GIS건물통합정보)의 층수·높이·용도·사용승인일과 지적(연속지적도)으로 세웁니다. 오른쪽 [현황]에서 단색·용도·층수·건축 연도·높이 근거로 칠해 보고, 현황 건물을 눌러 속성을 보거나 지상 층수를 고칩니다. 가구에 건물을 놓거나 용도를 정하면 그 자리의 현황 건물은 철거된 것으로 보고 점선 윤곽만 남깁니다.</li>' +
      '<li><b>작업 순서·계획 목표</b>: 속성 탭 맨 위의 작업 순서(대상지 → 도로망 → 용도·밀도 → 건축물 → 가로 단면 → 법규 검토)가 끝낸 단계를 표시하고 다음 할 일을 알려 줍니다. 지표 탭의 [계획 목표]에 용적률·건폐율·도로율·공원·녹지율·인구 목표를 넣으면 지금 계획과 견주어 막대로 보여 줍니다(목표는 계획과 함께 저장).</li>' +
      '<li><b>메뉴 막대</b>(왼쪽 위 로고 아래): [프로젝트]에는 새 프로젝트·작업 파일 열기·저장·내보내기·처음 상태로 되돌리기·전체 지우기가, [편집]에는 되돌리기·도구·지우기·빈 가구 채우기가, [보기]에는 화면 배치·크게 보기·표현·레이어·그림자·패널 접기가, [도움말]에는 사용법과 단축키가 있습니다. 처음 상태로 되돌리기와 전체 지우기도 되돌리기(Ctrl+Z)로 다시 살릴 수 있습니다.</li>' +
      '<li><b>왼쪽 메뉴</b>(창이 좁으면 왼쪽의 좁은 띠, 휴대폰은 아래 막대)의 Draw 아래 [도로]·[건물]·[가로시설물]·[조경]을 누르면 세부 항목이 펼쳐집니다. 그 아래 View &amp; Visibility에는 음영분석·3D 오브젝트·레이어와 맨 아래 화면 배치·표현 단추가 있습니다. 도로는 위계를 고른 뒤 평면에 점을 찍어 내고, 건물은 용도를 고른 뒤 획지를 눌러 세우며, 교목·가로등·벤치 등은 고른 뒤 평면이나 3D에 눌러 놓습니다.</li>' +
      '<li><b>선택·이동·지우개</b>는 따로 있는 도구입니다. 선택은 누른 요소를 고르고, 이동은 시설물·수목과 도로를 끌어 옮기며(도로의 흰 꼭짓점을 끌면 그 점만), 지우개는 누른 도로·건물·요소를 지웁니다.</li>' +
      '<li><b>여럿 고르기</b>: Shift를 누른 채 누르면(휴대폰에서는 길게 누르면) 선택에 더하거나 뺍니다. Delete 키를 누르면 고른 것을 바로 지웁니다(Ctrl+Z로 되돌림).</li>' +
      '<li><b>획지 합치기</b>: 같은 가구 안에서 붙어 있는 획지를 함께 고르면 [합치기] 창이 뜹니다. 합친 획지는 속성에서 다시 나눌 수 있습니다.</li>' +
      '<li><b>획지 나누기</b>: 획지(또는 건물)를 하나 고르면 속성의 [획지 나누기]에서 나란히 2~4개, 앞뒤로 2~3개로 나눌 수 있습니다. 합친 획지도 나눌 수 있고, [다시 하나로]를 누르거나 조각을 모두 골라 합치면 원래대로 돌아갑니다. 가구 전체의 획지 수는 가구 정보에서 바꿉니다.</li>' +
      '<li><b>건물</b>: 용도를 고른 뒤 [획지 하나]이면 층수·길이·깊이를 정해 획지를 누르고, [가구 전체]이면 건폐율 상한·용적률 목표·최고 층수를 정해 가구 안을 누르면 가구의 획지가 모두 그 용도의 건물로 채워집니다. 길이는 도로를 따라, 깊이는 도로에서 안쪽으로 잰 값이며 비워 두면 획지에 맞춥니다. 빈 가구가 여럿이면 [빈 가구 모두 채우기]로 한꺼번에 채웁니다. 가구를 고르면 오른쪽 [건물 채우기]에서 다시 채울 수 있습니다.</li>' +
      '<li><b>건물 직접 그리기</b>: [건물]에서 용도를 고르고 [직접 그리기]를 누른 뒤 평면에서 모서리를 차례로 누릅니다. 첫 점을 누르거나 Enter를 치면 닫혀 그 모양의 건물이 섭니다(획지마다 건물 하나, 획지를 넘는 부분은 잘림). 변은 획지 축(도로 방향·직각)에 맞춰 붙고 Shift를 누르면 15°씩 꺾입니다. Backspace는 마지막 점을 지웁니다.</li>' +
      '<li><b>길이 입력</b>: 도로나 건물을 그리는 중에 마우스로 방향을 정하고 숫자를 치면(숫자 키패드도 됨) 그 길이(m)만큼 정확히 놓입니다. Enter로 놓고, 잘못 쳤으면 Backspace·Esc로 고칩니다.</li>' +
      '<li><b>평면에서 건물 다루기</b>: 선택·이동 도구에서 건물 변에 마우스를 대면 변이 굵어지고, 끌면 깊이(도로 쪽·안쪽 변)나 길이(옆 변)가 바뀝니다(맞은편 변은 제자리). 직접 그린 건물은 그 변을 밀고 당깁니다. 건물을 고르면 뒤쪽에 나오는 동그란 손잡이를 끌어 5°씩(Shift 15°) 돌리고, 위에 뜨는 막대로 15°씩 돌리기·좌우/앞뒤 뒤집기·옮기기·복사를 합니다(3D에서도 같은 막대). [옮기기]를 누른 뒤 놓을 자리를 누르면, 같은 획지 안이면 그 안에서(건축선 후퇴·이격 범위 안) 옮기고 다른 획지면 그 획지로 옮겨 누른 자리 가까이에 앉힙니다. 건물은 가각·회전교차로·일조 이격에 비스듬히 잘리지 않게 직사각형을 지킵니다(한쪽 변을 곧게 물림, 맞벽 건물은 획지 모양대로).</li>' +
      '<li><b>블록 정보</b>: 도로 가장자리의 가구 경계선을 누르면 가구(블록)가 선택되고, 건물 수·건폐율·용적률·용도 구성과 용도지역이 속성에 나옵니다. 건물 속성 머리줄의 [블록 정보]·[입지 분석]으로 넘어갔다가 [돌아가기]로 그 건물에 돌아옵니다.</li>' +
      '<li><b>도로를 누르면</b> 아래에 그 자리의 가로 단면이 열립니다. 구간 경계선을 끌어 폭을 나누고, [구간]·[지하시설] 단추로 요소를 더합니다. 관은 단면에서 끌어 옮깁니다. 평면·3D의 빨간 A·A′ 표시를 누르면 반대쪽에서 본 단면으로 바뀌고, 단면 양 끝 위에 그쪽 방위(←북 · 남→ 등)가 나옵니다. 단면 머리줄에서 도로를 고르면 평면이 그 도로로 다가갑니다.</li>' +
      '<li><b>단면에 표시할 정보</b>는 단면 머리줄의 [건물 정보]·[도로 정보]·[기반시설]로 켜고 끕니다. 기반시설을 끄면 지하 관로의 글자와 형태가 함께 사라집니다. 내보내는 그림에도 그대로 반영됩니다.</li>' +
      '<li><b>건물이나 획지를 누르면</b> 오른쪽에서 층수, 건축선 후퇴, 입면 스타일을 바꿉니다. [가구 설정]에서는 가구 전체의 용도와 획지 분할을 정합니다.</li>' +
      '<li><b>이미지 재료</b>: 입면의 [외장 재료]에서 [+ 이미지로 새 재료…]를 고르고 사진·그림을 넣으면 벽 재료의 무늬로 씁니다. 무늬 크기는 그림 한 장이 벽에서 덮는 가로×세로(m)로, 창에서 사람(1.7m)과 견주어 정하고 나중에 오른쪽에서 고칩니다. 거울 반복은 한 장 건너 뒤집어 붙여 이음매를 숨깁니다. 창·1층·간판은 무늬 위에 그대로 그리고, 벽 색을 바꾸면 그 비율로 물듭니다. 재료는 프로젝트마다 12개까지, 그림은 512×512로 줄여 작업 파일에 함께 담습니다. 3D 모델 내보내기에서 GLB는 그림을 파일 안에, OBJ·DAE는 zip의 textures 폴더에 넣습니다.</li>' +
      '<li><b>건폐율·용적률 상한</b>: 건물은 용도지역의 상한(서울특별시 도시계획 조례 제54·55조, 용적률은 800%까지)에 맞춰 지어집니다(안쪽 깊이를 줄이고, 도구가 정한 층수는 낮춤). 직접 정한 층수나 그린 모양이 상한을 넘으면 건물 정보에 빨갛게, [법규검토]에 기준 미달로 나옵니다. 용도지역은 블록 정보에서 정하고, 획지 용도를 고를 때 상한이 함께 보입니다.</li>' +
      '<li><b>크게 보기</b>: 화면 왼쪽 위의 [평면]·[3D] 단추(단면은 단면 머리줄 오른쪽 단추)를 누르면 그 화면만 창 전체로 커집니다. 같은 단추를 다시 누르거나 Esc를 누르면 모든 화면이 돌아옵니다.</li>' +
      '<li><b>패널 접기</b>: 평면 왼쪽 가장자리와 3D 오른쪽 가장자리의 작은 손잡이(또는 [보기] 메뉴)로 왼쪽 메뉴와 오른쪽 패널을 접어 화면을 넓힙니다.</li>' +
      '<li><b>요소로 다가가기(더블클릭)</b>: 평면에서 건물·획지·가구·도로·시설물을 더블클릭하면 옆의 3D가 그 요소로 다가가고, 3D에서 더블클릭하면 평면이 다가갑니다. 한 화면만 보고 있을 때는 그 화면이 다가갑니다.</li>' +
      '<li><b>채색·선 도면</b>은 왼쪽 메뉴 맨 아래(창이 좁으면 위쪽 막대)의 정육면체 픽토그램 두 개나 [보기] 메뉴로 바꿉니다. 화면 배치(나란히·평면·3D)와 레이어도 같은 자리에 있습니다. 선 도면에서는 평면·3D·단면이 흑백 선으로 바뀌고 그림자는 그리지 않습니다.</li>' +
      '<li><b>내보내기</b>는 프로젝트 메뉴에서 합니다. 평면도와 가로 단면은 벡터(SVG)로 나가며 지금 표현(채색·선 도면)을 따릅니다. 인쇄 치수는 평면 1:1000, 단면 1:100이며 축척 막대·방위표가 함께 들어갑니다. 건물·도로(차도·보도·노면 표시·연석)·수목·가로등·시설물·이름 등이 레이어로 나뉘어 Inkscape·Illustrator에서 따로 고를 수 있고, 3D 모델의 OBJ는 갈래마다 그룹(라이노에서는 레이어)으로 나뉩니다.</li>' +
      '<li><b>화면 축척</b>: 평면 오른쪽 아래의 1:N을 눌러 숫자를 넣고 Enter를 누르면 그 축척으로 맞춥니다(모니터 96dpi 기준). 3D의 방위표(N·E·S·W)를 누르면 북쪽이 위로 오게 돌립니다.</li>' +
      '<li><b>3D 오브젝트</b>: 왼쪽 메뉴 [3D 오브젝트]의 스위치로 켜고, 보행자·차량·개인형 이동장치(자전거도로의 자전거·킥보드)의 밀도를 막대로 조절합니다.</li>' +
      '<li><b>음영분석</b>: 왼쪽 메뉴 [음영분석]의 스위치로 그림자를 켜고 시각·날짜(춘분·하지·추분·동지)·위도를 바꿉니다. 조도분석에서 태양 궤적도·일조시간·가로등 조도를 켜고, 건물을 하나 고르면 속성에 그 건물의 태양궤적도(스테레오 투영)와 동지 일조시간이 나오고, 궤적도의 해를 끌면 시각이 바뀝니다. 스위치를 끄면 궤적도·일조시간·조도도 함께 꺼집니다.</li>' +
      '<li><b>회전교차로</b>: [도로]의 회전교차로를 고른 뒤 교차점·도로 위·빈터(획지 안)를 누릅니다. 빈터에 둔 회전교차로는 가운데로 도로를 그려 잇습니다. 단지 안 길끼리 만나는 곳에는 소형 회전교차로(지름 16m 안팎)가 섭니다.</li>' +
      '<li><b>단지 안 길</b>: [도로] 목록의 단지내도로(기본 4m)·오솔길(2m)은 획지 안에 그리는 길로, 가구를 나누지 않습니다. 고르면 바로 아래에 나오는 단추로 모양을 꺾은선·모서리 둥글게·곡선(찍은 점을 지나는 베지에 곡선) 가운데 고르고, 기존 도로에 닿게 그리면 진출입로(어귀의 연석 곡선)가 됩니다. 다른 길과 만나지 않아도 됩니다. 지나는 자리의 건물은 길 가장자리에서 1m(오솔길 0.5m) 물러납니다. 폭·모양·모서리 반지름은 속성에서, 점은 [이동] 도구로 끌어 고칩니다.</li>' +
      '<li><b>수공간</b>: [조경]의 수공간을 누르고 아래 목록에서 종류를 고릅니다. 원형 연못·둥근 사각 연못은 누른 자리에 놓고 크기를 속성에서 바꾸며, 자유형 연못·하천은 점을 차례로 찍어 그립니다(찍은 점을 지나는 곡선, 자유형은 첫 점을 누르면 닫힘, 대상지 밖까지 그려도 됨). 하천은 속성에서 폭·깊이(지면에서 수면까지, 3D에서 땅속 물길로 보임)와 천변공원(둑을 따라 녹지·산책로·가로수)을 정합니다. 도로나 단지 안 길이 물을 건너면 다리가 되어 난간이 섭니다. 물가 1.5m 안에는 건물을 세우지 않습니다.</li>' +
      '<li><b>맞벽과 신도시 밀도</b>: 구도심을 처음 만들 때는 양옆 벽이 붙은 맞벽 건물이 섞이지만, 지우고 다시 짓거나 가구를 채우는 건물은 인접 대지경계선에서 1m 이상 띄웁니다. 도시(가상)·임의생성 도시는 획지마다 용도지역 용적률(서울시 조례, 800%까지)을 채우는 층수로, 그 층수에서 건폐율이 가장 크게 짓습니다(주거지역은 정북방향 일조 이격까지 지킴). 블록 정보의 [용적률 최대로]로 켜고 끕니다.</li>' +
      '<li><b>단지(한 획지에 여러 동)</b>: 넓은 획지(3,000㎡·짧은 변 45m 이상)는 속성의 [단지 배치]에서 공동주택 단지나 캠퍼스로 바꿀 수 있습니다. 공동주택 단지는 판상형 주동을 동서로 길게(남향) 줄지어 앉히고, 마주 보는 두 동 사이를 높이의 0.5배 이상(서울시 건축 조례 제35조)이면서 10m 이상(건축법 시행령 제86조제3항제2호나목) 띄웁니다. 캠퍼스는 가운데 마당 둘레에 동을 앉힙니다. 동 수·층수는 용적률 목표를 채우도록 정하고, 건폐율·용적률은 단지 전체로 봅니다. 도시(가상)·임의생성 도시에는 단지가 하나쯤 생기고, 구도심에는 생기지 않습니다.</li>' +
      '<li><b>AI 렌더</b>: 3D 머리줄의 반짝이 단추(또는 [프로젝트 → 내보내기])로 엽니다. 지금 3D 시점을 참고 그림으로 Google Gemini 이미지 모델(Nano Banana)에 보내, 건물의 위치·높이·매스와 시점은 그대로 두고 재료·빛·하늘·사람을 더한 그림을 받습니다. 사람마다 Google AI Studio에서 받은 API 키를 넣으며(이미지 모델은 API 무료 등급이 없어 결제 연결 필요), 키는 그 브라우저에만 둡니다. 키 없이는 참고 그림을 저장하고 프롬프트를 복사해 Gemini 앱에서 만듭니다. Claude 화면 안에서는 바깥 요청이 막혀 있어 키로 바로 만들기는 배포 페이지나 내려받은 HTML에서 됩니다.</li>' +
      '<li><b>3D 모델 내보내기</b>: [프로젝트 → 3D 모델]에서 GLB(최신 SketchUp·Blender·Rhino 8)·DAE(SketchUp 모든 판)·OBJ(Rhino·3ds Max 등)로 내보냅니다. 건물은 동마다 묶이고, 단위는 m입니다.</li></ul>' +
      '<table class="tb kv"><tbody><tr><td>평면</td><td>빈 곳을 끌어 화면 이동, 휠이나 두 손가락으로 확대·축소</td></tr><tr><td>3D</td><td>끌어서 회전, Shift+끌기나 두 손가락으로 이동, 휠로 확대·축소</td></tr><tr><td>단축키</td><td>V 선택 · M 이동 · E 지우개 · R 도로 · B 건물 · Shift+누름 여럿 고르기 · Delete 지우기 · Ctrl+Z 되돌리기 · Esc 그만</td></tr></tbody></table>' +
      '<p class="mut">단순화한 부분: 지형과 종단경사가 없고, 획지는 격자로만 나뉘며, 도로는 직선 구간을 이어서 만듭니다. 일조·관로 점검은 학습용 간이 계산입니다. 지도 캡처에서 읽은 도로 폭과 용도는 어림값이므로 만든 뒤 고쳐 쓰세요. 실제 지역의 현황 건물은 바닥 윤곽을 높이만큼 올린 매스이며, 높이 자료가 없으면 층수로 어림합니다.</p>' +
      '<p class="copy">© 2026 Urban Planning &amp; Informatics Lab, School of Smart Cities, Korea University (Prof. Jooseok Oh). All rights reserved.</p>',
      '<button class="btn pri" data-act="closedlg">닫기</button>');
  }

  /* ---------- 풍선 도움말: data-tip을 가진 단추에 마우스를 올리면 잠시 뒤 이름이 뜬다(마우스가 있는 기기에서만) ---------- */
  function bindTips() {
    if (!(window.matchMedia && window.matchMedia('(hover: hover)').matches)) { // 터치 기기: 물음표를 누르면 설명을 알림으로
      document.addEventListener('click', (e) => { const it = e.target.closest && e.target.closest('.itip'); if (it && it.dataset.tip) ui.toast(it.dataset.tip); });
      return;
    }
    const tip = document.createElement('div');
    tip.className = 'htip'; tip.id = 'htip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    let cur = null, timer = 0;
    const hide = () => { clearTimeout(timer); timer = 0; cur = null; tip.hidden = true; };
    const show = (el) => {
      const t = el.dataset.tip;
      if (!t || !document.body.contains(el) || el.disabled) return;
      tip.textContent = t; tip.className = 'htip'; tip.hidden = false;
      const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      let x, y, side;
      if (el.closest('#palette') && r.right + 10 + w < vw) { x = r.right + 10; y = r.top + r.height / 2 - h / 2; side = 'r'; } // 왼쪽 메뉴: 오른쪽에
      else { x = r.left + r.width / 2 - w / 2; y = r.bottom + 8; side = 'b'; if (y + h > vh - 6) { y = r.top - h - 8; side = 't'; } } // 그 밖: 아래(모자라면 위)
      x = U.clamp(x, 6, vw - w - 6); y = U.clamp(y, 6, vh - h - 6);
      tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
      tip.style.setProperty('--ax', Math.round(U.clamp(r.left + r.width / 2 - x, 10, w - 10)) + 'px');
      tip.classList.add(side);
    };
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (el === cur) return;
      hide();
      if (!el) return;
      cur = el;
      timer = setTimeout(() => { if (cur === el) show(el); }, 320);
    });
    document.addEventListener('mouseout', (e) => { if (cur && !(e.relatedTarget && cur.contains(e.relatedTarget))) hide(); });
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('wheel', hide, { passive: true, capture: true });
    window.addEventListener('blur', hide);
  }

  /* ---------- 동작 ---------- */
  const acts = {
    selroad(a) { app.select({ type: 'road', id: a }); focusTarget({ type: 'road', id: a }); },
    selseg(a) { app.selectSeg(a); },
    selutil(a) { app.selectUtil(a); },
    segdel(a) { app.removeSeg(a); },
    segdir(a) { const r = app.secRoad(); const s = r && r.segs.find((x) => x.id === a); if (s) { s.dir = (s.dir || 1) > 0 ? -1 : 1; app.changed(); } },
    segstep(a) { const r = app.secRoad(); const s = r && r.segs.find((x) => x.id === app.state.selSeg); if (s) { s.w = Math.max(0.25, U.round(s.w + parseFloat(a), 2)); app.changed(); } },
    segmove(a) { if (app.state.selSeg) app.moveSeg(app.state.selSeg, parseInt(a, 10)); },
    addseg(a, el) { addSegPop(el); },
    addutil(a, el) { addUtilPop(el); },
    addsegtype(a) { ui.closePop(); app.addSeg(a); },
    addutiltype(a) { ui.closePop(); app.addUtil(a); },
    utildel(a) { app.removeUtil(a); },
    delroad() { const t = app.state.sel; if (t && t.type === 'road') app.eraseAt({ type: 'road', id: t.id }); },
    objdel() { const t = app.state.sel; if (t && t.type === 'object') app.eraseAt(t); },
    bldremove(a) { const o = app.lotOv(a); if (o) { o.bld = null; app.changed(); } },
    bldadd(a) { const o = app.lotOv(a); if (o) { o.bld = { noParty: true }; app.changed(); } }, // 지운 자리에 다시 짓는 건물은 맞벽 불가
    lotreset(a) { const li = app.lotInfo(a); if (li && li.S.lots) { delete li.S.lots[li.key]; app.changed(); } },
    selblock(a) { // 건물·획지에서 블록 정보로 가면 돌아갈 자리를 기억한다
      const cur = app.state.sel, back = cur && (cur.type === 'building' || cur.type === 'lot') ? { sel: { type: cur.type, id: cur.id }, to: a } : null;
      app.select({ type: 'block', id: a }); app.state.back = back; ui.pane();
    },
    goback() { const bk = app.state.back; app.state.back = null; if (bk) { app.select(bk.sel); app.state.tab = 'props'; ui.pane(); } },
    ckmore(a) { ui._ckOpen = ui._ckOpen || {}; ui._ckOpen[a] = !ui._ckOpen[a]; ui.pane(); },
    blockreset(a) { const S = app.block(a); if (S) { S.lots = {}; app.changed(); } },
    check(a) {
      // 같은 항목을 곧바로 두 번 누르면(더블클릭) 평면·3D가 그 자리로 다가간다. 한 번 누르면 고르기만(목록이 다시 그려져도 알아보게 직접 셈)
      const now = performance.now(), dbl = !!(ui._ckLast && ui._ckLast.a === a && now - ui._ckLast.t < 480);
      ui._ckLast = dbl ? null : { a, t: now };
      const c = ui._checks && ui._checks[+a]; if (!c || !c.target) return;
      const t = c.target;
      if (t.type === 'site') { if (dbl) { app.r2.fit && app.r2.fit(app.P.site); if (app.r3.ok) { app.r3.fit(app.P.site); app.invalidate(2); } app.invalidate(1); } return; }
      if (!dbl) { app.select(t.type === 'road' ? { type: 'road', id: t.id, seg: t.seg, util: t.util } : { type: t.type, id: t.id }); app.state.tab = 'checks'; ui.pane(); focusTarget(t); return; }
      const fb = app.focusBox(t.type === 'road' ? { type: 'road', id: t.id } : t);
      if (!fb) return;
      if (ui.viewShown('2d')) app.flyPlan(fb, 460);
      if (ui.viewShown('3d')) app.fly3D(fb, 460);
    },
    tab(a) {
      const st = app.state;
      if (!isMobile()) { st.tab = a; ui.pane(); return; }
      if (st.sheet && st.tab === a) { ui.sheetTo('closed'); return; }
      st.tab = a; ui.pane();
      if (!st.sheet) ui.sheetTo('half');
    },
    sheetclose() { ui.sheetTo('closed'); },
    setday(a) { app.P.settings.doy = +a; app.changed(); ui.sunPopRefresh(); },
    bldx(a) { const [id, op, v] = a.split('|'); app.bldXform(id, op, v !== undefined ? +v : undefined); },
    bldclip(a) { const [id, mode] = a.split('|'); app.bldClipStart(id, mode); },
    spface(a) { app.state.spFace = a; ui.pane(); app.invalidate(1); },
    tod(a) {
      const S = app.P.settings, t = UDS.sunTimes(S);
      S.hour = a === 'day' ? 12 : a === 'night' ? 21 : Math.round((t[1] - 0.35) * 4) / 4;
      app.changed(); ui.sunPopRefresh();
    },
    traffic() {
      const want = !app.state.traffic.on;
      app.setTraffic(want);
      ui.top();
      if (want && !app.state.traffic.on) ui.toast('이 기기의 3D 표시로는 사람·차량을 그릴 수 없습니다.');
      else if (want && !app.traffic.cars.length && !app.traffic.peds.length && app.state.traffic.ped + app.state.traffic.car > 0) ui.toast('사람이 걸을 보도나 차량이 다닐 차로가 없습니다. 도로를 먼저 그려 주세요.');
    },
    labels(a) { // 평면의 글자(도로·용도 이름) 켜고 끄기
      const L = app.state.layers;
      L.labels = a === 'on' ? true : a === 'off' ? false : !L.labels;
      ui.top(); ui.xRefresh(true); app.invalidate(1);
    },
    shadow(a) {
      const L = app.state.layers;
      L.shadows = a === 'on' ? true : a === 'off' ? false : !L.shadows;
      ui.top(); app.invalidate(7); ui.sunPopRefresh();
      if (app.state.tab === 'props') ui.pane();
    },
    importmap() { ui.closePop(); if (UDS.ui.importDialog) UDS.ui.importDialog(); },
    palgrp(a, el) {
      if (a in ui.xOpen) { ui.xOpen[a] = !ui.xOpen[a]; ui.palette(); return; } // 보기 묶음: 따로 펼치고 접음
      // 넓은 화면: 제자리에서 펼치고 접음. 좁은 화면(띠·아래 막대): 항목을 작은 창으로 띄움
      if (palNarrow()) { palPop(el, a); return; }
      if (ui.palOpen[a]) ui.palOpen[a] = false; else palOnly(a);
      ui.palette();
    },
    xsw(a) { // 보기 묶음 머리의 스위치: 음영분석(그림자) · 3D 오브젝트(사람·차량)
      if (a === 'shade') {
        acts.shadow();
        if (!app.state.layers.shadows) { // 음영분석을 끄면 태양 궤적도·일조시간·조도 지도도 함께 끈다
          const A = app.state.ana; let any = false;
          Object.keys(A).forEach((k) => { if (A[k]) { A[k] = false; any = true; } });
          if (any) { app.rebuild3d(); app.invalidate(7); ui.sunPopRefresh(); }
        }
      }
      else if (a === 'obj') acts.traffic();
      ui.xRefresh();
    },
    ana(a) { // 조도분석 켜고 끄기
      const A = app.state.ana; A[a] = !A[a];
      if (A[a] && a === 'lux' && UDS.sky(app.P.settings).day > 0.5) ui.toast('가로등 조도는 밤에 켜진 가로등 기준입니다. [시각]에서 밤으로 바꾸면 3D에서도 불빛을 볼 수 있습니다.');
      ui.xRefresh(); ui.sunPopRefresh(); app.rebuild3d(); app.invalidate(7);
    },
    secshow(a) { setSecShow(a, app.state.secShow[a] === false); },
    secshowpop(a, el) { secShowPop(el); },
    max(a) { ui.toggleMax(a); },
    multipick(a) { const t = app.selList().find((x) => x.id === a); if (t) app.select(t); },
    multidrop(a) { const t = app.selList().find((x) => x.id === a); if (t) app.select(t, { add: true }); },
    multidel() { app.deleteSelected(); },
    multiclear() { app.select(null); },
    mergelots() { app.mergeLots(); },
    unmerge(a) { app.unmergeLot(a); },
    unmergeall(a) {
      const S = app.block(a); if (!S) return;
      if (!((S.merges || []).length || Object.keys(S.splits || {}).length)) return;
      S.merges = []; S.splits = {};
      Object.keys(S.lots || {}).forEach((k) => { if (k.includes('.')) delete S.lots[k]; }); // 나눈 조각에 따로 준 설정은 조각과 함께 사라진다
      app.changed(); ui.toast(`합치거나 나눈 획지를 처음 격자로 되돌렸습니다. ${ui.undoTip()}`);
    },
    selpopclose() { ui._selPopOff = selKey(); ui.selPop(); },
    roadfinish() { app.finishRoad(); },
    undergr(a) { app.undergroundRoads([a]); }, // 전선 지중화(도로 하나)
    undergrall() { app.undergroundRoads(null); }, // 전선 지중화(모든 도로)
    waterkind(a) { app.setTool('water', a); }, // 왼쪽 메뉴 조경: 수공간 종류
    waterdel() { const t = app.state.sel; if (t && t.type === 'water') { app.eraseAt(t); ui.toast(`수공간을 지웠습니다. ${ui.undoTip()}`); } },
    waterfinish() { app.waterFinish(); },
    watercancel() { if (app.state.drawWater && app.state.drawWater.pts.length) app.waterCancel(); else app.setTool('select'); },
    innershape(a) { // 왼쪽 메뉴: 단지 안 길을 그릴 모양
      const st = app.state, ik = st.tool === 'road' && C.PRESETS[st.roadPreset] && C.PRESETS[st.roadPreset].inner ? st.roadPreset : null;
      st.innerShape[ik || 'estate4'] = a;
      if (!ik) app.setTool('road', 'estate4');
      ui.palette(); ui.hint(); app.invalidate(1);
    },
    roadshape(a) { // 속성: 고른 단지 안 길의 모양
      const t = app.state.sel, r = t && t.type === 'road' ? app.road(t.id) : null;
      if (!r || !r.ctrl || !C.SHAPES[a]) return;
      r.shape = a; M.reshape(r); app.changed();
    },
    roadcancel() { const st = app.state; if (st.drawRoad && st.drawRoad.pts && st.drawRoad.pts.length) app.cancelDraw(); else app.setTool('select'); },
    toolselect() { app.setTool('select'); },
    fit2d() { app.r2.fit(app.P.site, 1.14); app.invalidate(1); },
    cam(a) { app.camPreset(a); },
    north3d() { if (app.r3 && app.r3.ok) app.r3.turnNorth(); },
    sun(a, el) { if (el.closest('#pop')) { const anchor = $('[data-act="more"]') || el; ui.closePop(); sunPop(anchor); } else sunPop(el); },
    layers(a, el) { layersPop(el); },
    project(a, el) { projectPop(el); },
    menu(a, el) { menuPop(el, a); },
    settool(a) { app.setTool(a, a === 'road' ? app.state.roadPreset : a === 'build' ? app.state.buildUse : undefined); },
    viewsw(a) { ui.setView(a); },
    setmode(a) { ui.setMode(a); },
    delsel() { if (app.selList().length) app.deleteSelected(); },
    deselect() { app.select(null); },
    keys() { keysDlg(); },
    panel(a) {
      const st = app.state;
      if (a === 'L') st.hideL = !st.hideL; else st.hideR = !st.hideR;
      ui.top();
      setTimeout(() => { app.r2.resize(); app.invalidate(7); }, 30);
    },
    bscope(a) { const st = app.state; st.buildOpt.scope = a === 'block' || a === 'draw' ? a : 'lot'; st.drawBld = null; st.lenBuf = ''; if (a === 'draw' && st.tool !== 'build') app.setTool('build', st.buildUse); ui.poptRefresh(true); ui.hint(); app.invalidate(1); },
    blddrawfinish() { app.bldDrawFinish(); },
    blddrawcancel() { app.state.drawBld = null; app.state.lenBuf = ''; ui.hint(); app.invalidate(1); },
    bswap() {
      const bo = app.state.buildOpt, def = C.BLD_DEFAULT[app.state.buildUse] || {};
      const d = bo.depth != null ? bo.depth : def.depth || 0;
      bo.depth = bo.len || 0; bo.len = d; ui.poptRefresh(true);
    },
    fillreset() { const u = app.state.buildUse; app.state.fillT[u] = { ...(C.FILL_DEFAULT[u] || C.FILL_DEFAULT.res) }; ui.poptRefresh(true); ui.hint(); },
    fillvacant() {
      const use = app.state.buildUse, r = app.fillVacant(use);
      ui.toast(r.blocks ? `빈 가구 ${r.blocks}곳을 ${C.USES[use].name} 건물 ${r.built}동으로 채웠습니다.${r.demo ? ` 현황 건물 ${r.demo}동은 철거된 것으로 봅니다.` : ''} 가구 경계를 눌러 고르면 오른쪽 [건물 채우기]에서 가구마다 다시 채울 수 있습니다. ${ui.undoTip()}` : '건물이 없는 빈 가구가 없습니다.');
    },
    fillvacantdlg() { fillVacantDlg(); },
    fillvacantgo() {
      const sel = $('#fvUse'), use = sel ? sel.value : app.state.buildUse;
      ui.closeDialog();
      app.state.buildUse = use;
      acts.fillvacant();
    },
    fillblock(a) {
      const use = ui._fillUse && C.BLD_DEFAULT[ui._fillUse] ? ui._fillUse : 'res';
      app.fillBlockAt(a, use);
    },
    newproject() { newProjectDialog(); },
    realopen() { ui.closePop(); if (ui.siteDialog) ui.siteDialog(); else if (ui.realDialog) ui.realDialog(); },
    realpaste() { ui.closePop(); if (ui.realDialog) ui.realDialog(); },
    ctxmode(a) { if (!UDS.Ctx.MODES.some(([k]) => k === a)) return; ui.closePop(); app.state.ctxMode = a; app.rebuild3d(); app.invalidate(7); ui.pane(); },
    flow(a, el) {
      const step = FLOW.find(([k]) => k === a); if (!step) return;
      if (a === 'site' || a === 'road' || a === 'bld') { if (palNarrow()) { palPop(document.querySelector(`.pgrp[data-grp="${a}"] .pgh`) || el, a); } else { palOnly(a); ui.palette(); } }
      else if (a === 'law') { app.state.tab = 'checks'; ui.pane(); ui.top(); return; }
      else if (a === 'sec') { app.state.secSeen = true; const sp = document.querySelector('#secpanel'); if (sp && sp.scrollIntoView) try { sp.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 무시 */ } ui.pane(); }
      ui.toast(step[2]);
    },
    ctxdel(a) { app.eraseAt({ type: 'ctx', id: a }); ui.toast(`현황 건물을 지웠습니다. ${ui.undoTip()}`); },
    ctxvar(a) { const fa = (app.P.ctx && app.P.ctx.fa) || {}, cur = fa[a] || {}; app.ctxSetFac(a, { v: (cur.v || 0) + 1 }); },
    ctxfareset(a) { if (app.ctxSetFac(a, { t: '', v: 0 })) ui.toast('입면을 자동으로 정한 것으로 되돌렸습니다.'); },
    ctxfl(a) { const [id, n] = String(a).split('|'); if (app.ctxSetFloors(id, +n || 0)) ui.toast(+n ? `지상 ${+n}층으로 고쳤습니다.` : '받은 자료의 층수로 되돌렸습니다.'); },
    rabdel() { const t = app.state.sel; if (t && t.type === 'rab') { app.eraseAt(t); ui.toast(`회전교차로를 지웠습니다. ${ui.undoTip()}`); } },
    treedel() { const t = app.state.sel; if (t && t.type === 'tree') { app.eraseAt(t); ui.toast(`나무를 지웠습니다. ${ui.undoTip()}`); } },
    treerestore() { const n = app.treeRestore(); if (n) ui.toast(`지운 나무 ${n}그루를 되살렸습니다.`); },
    gotab(a) { app.state.tab = a; ui.pane(); ui.sheetPeek(); },
    sethour(a) { app.P.settings.hour = U.clamp(+a, 0, 24); app.invalidate(7); ui.sunLive(); ui.xRefresh(); ui.sunPopRefresh(); if (app.state.tab === 'props') ui.pane(); },
    ctxrestore() { const n = app.ctxRestoreAll(); if (n) ui.toast(`지운 현황 건물 ${n}동을 되살렸습니다.`); },
    clearall() {
      ui.closePop();
      if (app.isEmpty()) { ui.toast('지울 것이 없습니다. 이미 빈 터입니다.'); return; }
      confirmDlg('전체 지우기', `도로 ${app.P.roads.length}개, 건물 ${app.D.buildings.length}동, 시설물·수목 ${app.P.objects.length}개를 모두 지우고 같은 크기(${trim(app.P.site.w, 0)}×${trim(app.P.site.h, 0)}m)의 빈 터로 만듭니다.${app.underlay ? ' 지도 밑그림은 남습니다.' : ''} 지운 뒤에도 되돌리기로 다시 살릴 수 있습니다.`, '모두 지우기', () => { app.clearAll(); ui.toast(`모두 지웠습니다. ${ui.undoTip()} 왼쪽 메뉴의 [도로 그리기]로 다시 시작하세요.`); });
    },
    blankgo() {
      const w = Math.round(+($('#blankW') || {}).value), h = Math.round(+($('#blankH') || {}).value), er = $('#blankErr');
      if (!(w >= 100 && w <= 1200 && h >= 100 && h <= 1200)) { if (er) { er.textContent = '가로와 세로는 100m에서 1,200m 사이로 넣어 주세요.'; er.hidden = false; } return; }
      ui.closeDialog(); app.setScene('blank', { w, h });
    },
    splitlot(a) { const q = String(a).split('|'); app.splitLot(q[0], +q[2], q[1]); },
    unsplit(a) { app.unsplitLot(a); },
    help() { ui.closePop(); helpDlg(); },
    more(a, el) { morePop(el); },
    undo() { app.undo(); },
    redo() { app.redo(); },
    savefile() { ui.closePop(); saveFile(); },
    openfile() { ui.closePop(); openFile(); },
    exportsvg() { ui.closePop(); exportSVG(); },
    exportmodel() { modelDlg(); },
    exportmodelgo() { exportModel(); },
    exportsecsvg() { ui.closePop(); exportSecSVG(); },
    export3d() { ui.closePop(); exportCanvas('3d'); },
    exportsec() { ui.closePop(); exportCanvas('sec'); },
    resetscene() {
      ui.closePop();
      if (app.isInitial()) { ui.toast('이미 처음 상태입니다.'); return; }
      if (!app.initialProject()) { ui.toast('이 대상지는 처음 상태가 남아 있지 않습니다. 왼쪽 메뉴 [대상지]에서 지도 캡처나 실제 지역으로 다시 만들 수 있습니다.'); return; }
      confirmDlg('처음 상태로 되돌리기', '지금까지 바꾼 내용을 거두고 이 대상지를 처음 열었을 때의 배치로 되돌립니다. 되돌린 뒤에도 되돌리기로 다시 살릴 수 있습니다.', '처음 상태로', () => { if (app.resetProject()) ui.toast(`처음 상태로 되돌렸습니다. ${ui.undoTip()}`); });
    },
    closedlg() { ui.closeDialog(); },
    copydlg() { copyText(ui._copy || '', '복사했습니다.'); },
    airender() { ui.closePop(); if (UDS.AIRender) UDS.AIRender.open(); },
    theme(a) { ui.closePop(); if (!UDS.TH) return; if (a === 'dark' || a === 'light' || a === 'system') UDS.TH.set(a); else UDS.TH.toggle(); },
    matdel(a) { const m = app.matDef(a); if (!m) return; app.deleteMat(a); ui.toast(`재료 '${m.name}'를 지웠습니다. 쓰던 건물은 도장·스타코로 바뀝니다. ${ui.undoTip()}`); },
    hostimg() {
      const im = ui._img; if (!im || !hostSave) return;
      let blob = null; try { blob = dataUrlBlob(im.url); } catch (e) { blob = null; }
      if (!blob) { ui.toast('이미지를 만들지 못했습니다.'); return; }
      hostSave.save({ filename: im.name, data: blob }).then((r) => { if (r && r.status === 'saved') { ui.closeDialog(); ui.toast('이미지를 저장했습니다.'); } }, (err) => { if (!(err && err.code === 'declined')) ui.toast('저장하지 못했습니다. 그림을 길게 누르거나 오른쪽 버튼으로 눌러 저장하세요.'); });
    },
    doopen() {
      const fi = $('#fileIn'), ta = $('#pasteIn');
      if (fi && fi.files && fi.files[0]) { const rd = new FileReader(); rd.onload = () => loadJSON(String(rd.result)); rd.readAsText(fi.files[0]); }
      else if (ta && ta.value.trim()) loadJSON(ta.value.trim());
      else { const er = $('#openErr'); if (er) { er.hidden = false; er.textContent = '파일을 고르거나 내용을 붙여 넣으세요.'; } }
    },
    confirmyes() { const fn = ui._confirm; ui._confirm = null; ui.closeDialog(); if (fn) fn(); },
    mview(a) { app.state.mview = a; ui.top(); },
  };
  function confirmDlg(title, msg, yes, fn) {
    ui._confirm = fn;
    ui.dialog(title, `<p>${esc(msg)}</p>`, `<button class="btn pri" data-act="confirmyes">${esc(yes)}</button><button class="btn" data-act="closedlg">취소</button>`);
  }
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  function focusTarget(t) {
    const D = app.D, r2 = app.r2;
    let p = null;
    if (t.type === 'road') { const info = D.roadInfo.get(t.id); if (info) p = U.pointAlong(info.road.pts, info.len / 2).p; }
    else if (t.type === 'block') { const b = D.blocks.find((x) => x.id === t.id); if (b) p = U.interiorPoint(b.poly); }
    else { const l = D.lots.find((x) => x.id === t.id); if (l) p = U.interiorPoint(l.poly); }
    if (!p) return;
    const q = r2.w2s(p);
    if (q[0] < 40 || q[1] < 40 || q[0] > r2.W - 40 || q[1] > r2.H - 40) { r2.view.cx = p[0]; r2.view.cy = p[1]; app.invalidate(1); }
  }

  /* 휴대폰 아래 시트: 닫힘(손잡이만) · 반 · 전체. 열린 만큼 위 화면이 줄어든다 */
  const PEEK = 50;
  function sheetPx(to) {
    const H = $('#app').clientHeight || window.innerHeight;
    const room = H - 46 - 40 - 64;
    if (to === 'full') return Math.max(PEEK + 120, room - 56);
    if (to === 'half') return Math.round(U.clamp(H * 0.44, 190, Math.max(190, room - 130)));
    return PEEK;
  }
  ui.sheetTo = function (to, instant) {
    const st = app.state, a = $('#app'), side = $('#side');
    st.sheet = to === 'closed' ? false : to;
    if (!isMobile()) { a.dataset.sheet = to; side.style.height = ''; side.classList.remove('anim'); return; }
    const target = sheetPx(to);
    const cur = side.getBoundingClientRect().height;
    clearTimeout(ui._sheetT);
    const commit = () => { ui._sheetBusy = false; a.dataset.sheet = to; a.style.setProperty('--sheet-h', target + 'px'); side.classList.remove('anim'); side.style.height = ''; };
    const still = instant || Math.abs(cur - target) < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) { commit(); return; }
    ui._sheetBusy = true;
    if (to !== 'closed') a.dataset.sheet = to; // 열릴 때는 내용을 먼저 보이고, 닫힐 때는 다 내려간 뒤 감춤
    side.classList.remove('anim'); side.style.height = cur + 'px';
    if (target < cur) a.style.setProperty('--sheet-h', target + 'px'); // 줄어들 때는 뒤 화면을 먼저 넓혀 둠
    void side.offsetHeight;
    side.classList.add('anim'); side.style.height = target + 'px';
    ui._sheetT = setTimeout(commit, 250);
  };
  function bindSheet() {
    const side = $('#side'), a = $('#app');
    let d = null;
    const down = (e) => {
      if (!isMobile() || (e.button !== undefined && e.button > 0)) return;
      if (e.target.closest('.sheetx')) return;
      d = { y: e.clientY, h: side.getBoundingClientRect().height, moved: false, t: performance.now() };
    };
    const move = (e) => {
      if (!d) return;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dy) < 7) return;
      if (!d.moved) { d.moved = true; clearTimeout(ui._sheetT); ui._sheetBusy = true; side.classList.remove('anim'); if (!app.state.sheet) a.dataset.sheet = 'half'; }
      d.ly = e.clientY;
      side.style.height = U.clamp(d.h - dy, PEEK, sheetPx('full')) + 'px';
      if (e.cancelable) e.preventDefault();
    };
    const up = (e) => {
      if (!d) return;
      const q = d; d = null;
      if (!q.moved) return;
      ui._dragAt = performance.now();
      const h = side.getBoundingClientRect().height, dy = (e.type === 'pointercancel' ? q.ly : e.clientY) - q.y;
      const half = sheetPx('half'), full = sheetPx('full');
      let to;
      if (dy > 0) to = h < half - 30 ? 'closed' : h < full - 30 ? 'half' : 'full';
      else to = h > half + 30 ? 'full' : h > PEEK + 30 ? 'half' : 'closed';
      ui.sheetTo(to);
    };
    [$('#grab'), $('#tabs')].forEach((el) => { if (el) { el.addEventListener('pointerdown', down); el.addEventListener('dragstart', (e) => e.preventDefault()); } });
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('resize', () => { if (isMobile()) ui.sheetTo(app.state.sheet || 'closed', true); else { side.style.height = ''; } });
  }

  /* 획지를 둘 이상 함께 골랐을 때 누른 자리 옆에 뜨는 합치기 창. 선택 상태만 보고 띄우고 감춘다 */
  const selKey = () => app.selList().map((t) => t.id).join('|');
  ui.selPop = function () {
    const el = $('#selpop'); if (!el || !app.D) return;
    const st = app.state;
    const c = st.tool === 'select' || st.tool === 'move' ? app.mergeCheck(app.selList()) : { n: 0 };
    if (!c.n || st.max === 'sec' || ui._selPopOff === selKey()) { el.hidden = true; return; }
    ui._selPopOff = null;
    el.innerHTML = (c.ok
      ? `<span>획지 <b>${c.n}</b>개</span><button class="btn sm pri" data-act="mergelots">합치기</button>`
      : `<span>획지 <b>${c.n}</b>개</span><span class="why">${esc(c.reason)}</span>`) +
      `<button class="ibtn sm" data-act="selpopclose" title="닫기" aria-label="합치기 창 닫기">${icon('close', 12)}</button>`;
    const was = el.hidden;
    el.hidden = false;
    // 마지막으로 누른 자리의 오른쪽 아래. 자리를 모르면 평면 화면 아래 가운데
    const w = el.offsetWidth, hh = el.offsetHeight;
    let x, y;
    if (ui._pt) { x = ui._pt[0] + 14; y = ui._pt[1] + 18; }
    else { const r = $('#v2d').getBoundingClientRect(); x = r.left + r.width / 2 - w / 2; y = r.bottom - hh - 56; }
    el.style.left = Math.round(U.clamp(x, 8, window.innerWidth - w - 8)) + 'px';
    el.style.top = Math.round(U.clamp(y, 8, window.innerHeight - hh - 8)) + 'px';
    if (was) { el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
  };

  /* 그 화면(평면 '2d' · 3D '3d')이 지금 눈에 보이는가. 크게 보기·화면 나누기 설정·좁은 화면의 탭에 따라 가려질 수 있다 */
  ui.viewShown = function (k) {
    const st = app.state;
    if (st.max) return st.max === k;
    if (k === '3d' && !app.r3.ok) return false;
    const el = document.getElementById(k === '2d' ? 'v2d' : 'v3d');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 60 && r.height > 60;
  };

  /* 크게 보기: 평면·3D·단면 가운데 하나가 창 전체를 덮는다. 화면 제목 단추를 다시 누르거나 Esc를 누르면 원래 배치로 돌아온다 */
  ui.setMax = function (which) {
    const st = app.state, r2 = app.r2;
    which = which || null;
    if ((st.max || null) === which) return;
    const was2d = st.max === '2d';
    const w0 = r2.W, h0 = r2.H;
    st.max = which;
    ui.closePop();
    ui.top(); ui.secHead();
    // 평면은 화면이 커지는 만큼 축척도 같이 키워 보던 범위를 그대로 크게 보고, 돌아올 때는 키운 만큼 되돌린다
    ui._pt = null; ui.selPop();
    r2.resize(); app.sec.resize();
    if (which === '2d' && w0 > 20 && r2.W > 20) { ui._maxK = Math.min(r2.W / w0, r2.H / h0); r2.view.s = U.clamp(r2.view.s * ui._maxK, 0.15, 60); }
    else if (was2d && ui._maxK) { r2.view.s = U.clamp(r2.view.s / ui._maxK, 0.15, 60); ui._maxK = 0; }
    app.invalidate(7);
    if (!which) { const t = $('#toast'); if (t) t.hidden = true; } // 돌아오면 '크게 봅니다' 안내는 바로 치운다
    if (which) {
      const touch = !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
      const nm = which === '2d' ? '평면' : which === '3d' ? '3D' : '가로 단면';
      const btn = which === 'sec' ? '오른쪽 위 단추' : `왼쪽 위 [${nm}] 단추`;
      ui.toast(`${nm}만 크게 봅니다. ${touch ? `${btn}를 다시 누르면` : `${btn}를 다시 누르거나 Esc를 누르면`} 원래 화면으로 돌아옵니다.`);
    }
  };
  ui.toggleMax = function (which) { ui.setMax(app.state.max === which ? null : which); };

  ui.trafficCounts = function () {
    const c = app.traffic ? app.traffic.counts() : { cars: 0, peds: 0, pms: 0 };
    const on = app.state.traffic.on;
    const a = $('#trafPedN'), b = $('#trafCarN'), d = $('#trafPmN');
    if (a) a.textContent = c.peds + '명';
    if (b) b.textContent = c.cars + '대';
    if (d) d.textContent = (c.pms || 0) + '대';
    $$('.tc-ped').forEach((o) => { o.textContent = on ? c.peds + '명' : '-'; });
    $$('.tc-car').forEach((o) => { o.textContent = on ? c.cars + '대' : '-'; });
    $$('.tc-pm').forEach((o) => { o.textContent = on ? (c.pms || 0) + '대' : '-'; });
  };
  function bindTraffic() {
    const ped = $('#trafPed'), car = $('#trafCar');
    if (!ped || !car) return;
    ped.value = app.state.traffic.ped; car.value = app.state.traffic.car;
    ped.addEventListener('input', () => { app.setTrafficDensity(parseFloat(ped.value), null); ui.trafficCounts(); });
    const pm = $('#trafPm');
    if (pm) { pm.value = app.state.traffic.pmd; pm.addEventListener('input', () => { const T = app.state.traffic; T.pmd = parseFloat(pm.value); T.pm = T.pmd > 0; if (app.traffic) app.traffic.setPM(T.pm, T.pmd); ui.trafficCounts(); }); }
    car.addEventListener('input', () => { app.setTrafficDensity(null, parseFloat(car.value)); ui.trafficCounts(); });
    let lastT = 0;
    app.onTrafficFrame = (ts) => { if (ts - lastT > 700) { lastT = ts; ui.trafficCounts(); } };
  }

  ui.init = function () {
    $$('[data-ico]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.ico, 17)));
    bindSheet();
    bindTraffic();
    $$('[data-picto]').forEach((el) => { el.outerHTML = picto(el.dataset.picto, +el.dataset.size || 28); });
    $$('.vmodes').forEach((el) => { el.outerHTML = vmodeHTML(el.dataset.vk); });
    ui.buildPalette();
    bindTips();
    if (!canDownload) { askHost(); setTimeout(askHost, 1200); }
    wireForm($('#pane')); wireForm($('#sechead')); wireForm($('#pop'));
    document.addEventListener('click', (e) => {
      const pop = $('#pop');
      const inPop = pop && pop.contains(e.target);
      const a = e.target.closest('[data-act]');
      if (!pop.hidden && !inPop && !(pop._anchor && pop._anchor.contains(e.target))) ui.closePop();
      if (e.target.id === 'dialog') { ui.closeDialog(); return; }
      if (a) {
        if (a.disabled) return;
        if (ui._dragAt && performance.now() - ui._dragAt < 380 && a.closest('#side')) return;
        const fn = acts[a.dataset.act];
        if (inPop && pop._kind === 'menu' && a.dataset.act !== 'menu') { const anc = pop._anchor; ui.closePop(); if (fn) fn(a.dataset.arg, anc || a, e); return; }
        if (fn) fn(a.dataset.arg, a, e);
        return;
      }
      const pal = e.target.closest('[data-pal]');
      if (pal) {
        const [k, v] = pal.dataset.pal.split(':');
        if (pal.closest('#pop')) ui.closePop();
        if (k === 'tool') app.setTool(v); else if (k === 'road') app.setTool('road', v); else if (k === 'build') app.setTool('build', v); else app.setTool('place', v);
        if (isMobile() && app.state.mview !== '2d' && k !== 'tool' && !((k === 'place' || k === 'build') && app.state.mview === '3d')) { app.state.mview = '2d'; ui.top(); }
        return;
      }
      const sc = e.target.closest('button[data-scene]');
      if (sc) { if (sc.closest('#pop')) ui.closePop(); switchScene(sc.dataset.scene); return; }
      const nc = e.target.closest('button[data-new]'); // 새 프로젝트 창의 대상지 종류
      if (nc) { const k = nc.dataset.new; ui.closeDialog(); if (k === 'import') { if (ui.importDialog) ui.importDialog(); } else if (k === 'real') { if (ui.siteDialog) ui.siteDialog(); else if (ui.realDialog) ui.realDialog(); } else if (k === 'blank') blankDialog(); else if (k.startsWith('random')) app.setScene('random', { family: k.split(':')[1] || '' }); else if (M.scenes[k]) app.setScene(k); return; }
      const bz = e.target.closest('button[data-blank]');
      if (bz) { const [w, h] = bz.dataset.blank.split('x'); const a1 = $('#blankW'), b1 = $('#blankH'); if (a1 && b1) { a1.value = w; b1.value = h; blankHa(); } return; }
      const vm = e.target.closest('button[data-vmode]'); // 화면마다 따로 고르는 표현
      if (vm) { ui.setMode(vm.dataset.vmode, vm.dataset.vk); return; }
      const md = e.target.closest('button[data-mode]'); // #app에도 data-mode가 있으므로 단추만 받음
      if (md) { ui.setMode(md.dataset.mode); return; }
      const mv = e.target.closest('button[data-mview-btn]');
      if (mv) { app.state.mview = mv.dataset.mviewBtn; ui.top(); return; }
      const vb = e.target.closest('button[data-view-btn]');
      if (vb) { ui.setView(vb.dataset.viewBtn); return; }
    });
    // 메뉴 하나를 펼친 채 옆 메뉴 이름 위로 가면 그 메뉴로 바꾼다
    document.addEventListener('pointerover', (e) => {
      const b = e.target.closest && e.target.closest('.mb[data-act="menu"]'), p = $('#pop');
      if (!b || !p || p.hidden || p._kind !== 'menu' || p._anchor === b || !p._anchor || p._anchor.parentNode !== b.parentNode) return;
      ui.closePop(); menuPop(b, b.dataset.arg);
    });
    document.addEventListener('change', (e) => {
      const ri = e.target.closest && e.target.closest('[data-act-input="bldrot"]');
      if (ri) { const v = parseFloat(ri.value); app.bldXform(ri.dataset.arg, 'rotset', isFinite(v) ? v : 0); return; }
      const ly = e.target.closest('[data-layer]');
      if (ly) { app.state.layers[ly.dataset.layer] = ly.checked; ui.top(); app.rebuild3d(); app.invalidate(7); return; }
      const ss = e.target.closest('[data-secshow]');
      if (ss) { setSecShow(ss.dataset.secshow, ss.checked); return; }
      if (e.target.classList && e.target.classList.contains('palsp')) { app.state.treeSpecies = e.target.value; if (e.target.closest('#pop')) ui.closePop(); app.setTool('place', 'tree'); }
      if (e.target.classList && e.target.classList.contains('palwk')) { if (e.target.closest('#pop')) ui.closePop(); app.setTool('water', e.target.value); } // 수공간 종류를 고르면 바로 그 도구로
      if (e.target.id === 'fvUse') { const t = $('#fvT'); if (t) t.textContent = fvText(e.target.value); return; }
      const bo = e.target.closest && e.target.closest('[data-bopt]');
      if (bo) {
        // 건물 놓기 입력: 화면 상태만 바꾼다(계획에는 놓을 때 들어감). 범위를 벗어난 값은 그 자리에서 고쳐 보인다
        const k = bo.dataset.bopt, st = app.state, raw = bo.value.trim(), v = parseFloat(raw);
        const lim = { floors: [1, 80], len: [0, 300], depth: [0, 150], bcr: [5, 100], far: [10, 2000], fmax: [1, 80] }[k] || [0, 9999];
        const val = raw === '' || !isFinite(v) ? null : U.clamp(k === 'floors' || k === 'fmax' ? Math.round(v) : v, lim[0], lim[1]);
        if (k === 'floors') st.buildOpt.floors = val || 0;
        else if (k === 'len') st.buildOpt.len = val || 0;
        else if (k === 'depth') st.buildOpt.depth = val == null ? 0 : val;
        else { const T = app.fillTargets(st.buildUse); if (val != null) T[k] = val; bo.value = T[k]; return; }
        if (val != null && String(val) !== raw) bo.value = val;
      }
    });
    document.addEventListener('input', (e) => {
      if (e.target.id === 'blankW' || e.target.id === 'blankH') blankHa();
      const ts = e.target.closest && e.target.closest('[data-tset]');
      if (ts) { // 3D 오브젝트 밀도
        const v = parseFloat(ts.value), k = ts.dataset.tset, T = app.state.traffic;
        if (k === 'ped') app.setTrafficDensity(v, null); else if (k === 'car') app.setTrafficDensity(null, v);
        else { T.pmd = v; T.pm = v > 0; if (app.traffic) app.traffic.setPM(T.pm, v); }
        const tp = $('#trafPed'), tc = $('#trafCar'), tm = $('#trafPm'); if (tp) tp.value = T.ped; if (tc) tc.value = T.car; if (tm) tm.value = T.pmd;
        ui.trafficCounts();
      }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-act]')) { e.preventDefault(); e.target.click(); }
      else if (e.key === 'Enter' && (e.target.id === 'blankW' || e.target.id === 'blankH')) { e.preventDefault(); acts.blankgo(); }
    });
    window.addEventListener('resize', () => { const pp = $('#pop'); if (pp && !pp.hidden && pp.classList.contains('palp')) ui.closePop(); });
    // 단면 높이 조절
    const sp = $('#splitter'), stage = $('#stage');
    if (sp) {
      let y0 = 0, h0 = 0, on = false;
      sp.addEventListener('pointerdown', (e) => { on = true; y0 = e.clientY; h0 = $('#secpanel').getBoundingClientRect().height; sp.setPointerCapture(e.pointerId); e.preventDefault(); });
      sp.addEventListener('pointermove', (e) => { if (!on) return; const H = stage.getBoundingClientRect().height; const h = U.clamp(h0 + (y0 - e.clientY), 170, H - 160); stage.style.setProperty('--sec-h', h + 'px'); });
      const end = () => { on = false; };
      sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
    }
  };
  /* 왼쪽 메뉴 [대상지]에서 종류를 눌렀을 때. 바꾼 내용이 있으면 닫기 전에 한 번 묻는다. 임의생성은 누를 때마다 새로 만든다 */
  function switchScene(k) {
    if (k === 'import') { ui.top(); if (ui.importDialog) ui.importDialog(); return; }
    if (k === 'real') { ui.top(); if (ui.siteDialog) ui.siteDialog(); else if (ui.realDialog) ui.realDialog(); return; }
    if (k === 'blank') { ui.top(); blankDialog(); return; }
    if (k.startsWith('random')) { // 주사위: 누를 때마다 새로 만든다
      const fam = k.split(':')[1] || '', nm = fam === 'old' ? SCENE_NAME.oldtown : SCENE_NAME.standard;
      if (!app.isEdited()) app.setScene('random', { family: fam });
      else confirmDlg(`${nm} 임의생성`, '지금 작업을 닫고 대상지를 새로 만듭니다. 남겨 두려면 먼저 위쪽 [프로젝트] 메뉴에서 저장하세요.', '새로 만들기', () => app.setScene('random', { family: fam }));
      ui.top();
      return;
    }
    if (!M.scenes[k]) return;
    const same = app.P && app.P.meta.scene === k;
    const edited = app.isEdited();
    if (!edited) { if (!same || k === 'random') app.setScene(k); return; }
    const nm = M.scenes[k].name, keep = '남겨 두려면 먼저 위쪽 [프로젝트] 메뉴에서 저장하세요.';
    if (k === 'random') confirmDlg('임의생성', `지금 작업을 닫고 대상지를 새로 만듭니다. ${keep}`, '새로 만들기', () => app.setScene(k));
    else confirmDlg(same ? '대상지 새로 열기' : '대상지 바꾸기', `지금 작업을 닫고 ‘${nm}’ 대상지를 ${same ? '처음 모습으로 ' : ''}새로 엽니다. ${keep}`, '새로 열기', () => app.setScene(k));
    ui.top();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.start()); else app.start();
})(typeof window !== 'undefined' ? window : globalThis);
