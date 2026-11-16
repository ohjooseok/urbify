/* Urbify — 실제 지역(브이월드 공간정보)
 * 브이월드 국가중점데이터 WFS의 GIS건물통합정보(dt_d010)와 연속지적도(dt_d002)를 받아 대상지 좌표(m)로 옮겨
 * 현황 건물(층수·높이·용도·사용승인일)과 필지(지목)로 쓴다. 지적도의 도로 필지(지목 '도')로 도로망을 만들 수도 있다.
 * 받은 자료(app.ctx)는 계획(P)과 따로 두고, 계획에는 자료의 식별자와 지운 건물 목록(P.ctx)만 남긴다(되돌리기 기록을 가볍게). */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C;
  const X = (UDS.Ctx = {});
  X.MAX = 1000; // 한 번에 받는 최대 건수(브이월드 maxFeatures 상한)

  const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
  const r2 = (v) => Math.round(v * 100) / 100;
  const inLat = (v) => v >= 32.5 && v <= 39.5, inLon = (v) => v >= 124 && v <= 132.5;

  /* ---------- 위치 읽기 ----------
     '37.5894, 127.0323' · '127.0323 37.5894' · 37°35'21.8"N 127°01'56.3"E · 구글 지도 주소(@위도,경도) · 네이버 지도 주소(c=x,y, EPSG:3857) · lng=…&lat=… */
  X.parseLoc = function (s) {
    s = String(s || '').trim();
    if (!s) return null;
    // 도·분·초를 십진 도로
    s = s.replace(/(\d+(?:\.\d+)?)\s*[°˚º]\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″”]|''))?/g, (m, d, mi, se) => ' ' + (+d + (+mi || 0) / 60 + (+se || 0) / 3600).toFixed(7) + ' ');
    const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    for (let i = 0; i + 1 < nums.length; i++) {
      const a = nums[i], b = nums[i + 1];
      if (inLat(a) && inLon(b)) return { lat: a, lon: b };
      if (inLon(a) && inLat(b)) return { lat: b, lon: a };
    }
    for (let i = 0; i + 1 < nums.length; i++) {
      const a = nums[i], b = nums[i + 1];
      if (a > 13.6e6 && a < 14.8e6 && b > 3.7e6 && b < 4.9e6) return merc(a, b);
    }
    return null;
  };
  const merc = (x, y) => ({ lon: (x / 6378137) * (180 / Math.PI), lat: (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI) });
  X.fmtLoc = (l) => `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}`;

  /* ---------- 좌표계: 대상지 중심을 기준으로 한 평면(m). x 동쪽, y 북쪽, 원점은 대상지 남서쪽 모서리 ---------- */
  X.frame = function (lat, lon, W, H) {
    const r = (lat * Math.PI) / 180;
    return { lat, lon, W, H, mLat: 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r), mLon: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r) };
  };
  const toXY = (F, lon, lat) => [(lon - F.lon) * F.mLon + F.W / 2, (lat - F.lat) * F.mLat + F.H / 2];
  X.toXY = toXY;
  /* 요청 범위(위경도). pad: 바깥으로 더 받을 너비(m) */
  X.bbox = function (F, pad) {
    pad = pad || 0;
    return { s: F.lat - (F.H / 2 + pad) / F.mLat, w: F.lon - (F.W / 2 + pad) / F.mLon, n: F.lat + (F.H / 2 + pad) / F.mLat, e: F.lon + (F.W / 2 + pad) / F.mLon };
  };
  /* 범위를 k×k로 나눔(1,000건 상한을 넘을 때) */
  X.tiles = function (b, k) {
    const out = [];
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      out.push({ s: b.s + ((b.n - b.s) * j) / k, n: b.s + ((b.n - b.s) * (j + 1)) / k, w: b.w + ((b.e - b.w) * i) / k, e: b.w + ((b.e - b.w) * (i + 1)) / k, i, j, k });
    }
    return out;
  };

  /* ---------- 요청 주소 ---------- */
  X.LAYERS = {
    bld: { name: '건물', full: 'GIS건물통합정보', path: 'getBldgisSpceWFS', type: 'dt_d010' },
    par: { name: '지적', full: '연속지적도', path: 'getCtnlgsSpceWFS', type: 'dt_d002' },
  };
  X.url = function (kind, b, key, domain, o) {
    const L = X.LAYERS[kind];
    const q = [
      ['typename', L.type],
      ['bbox', [b.s, b.w, b.n, b.e].map((v) => v.toFixed(7)).join(',') + ',EPSG:4326'], // 위도 최소, 경도 최소, 위도 최대, 경도 최대
      ['maxFeatures', String(X.MAX)],
      ['resultType', 'results'],
      ['srsName', 'EPSG:4326'],
      ['output', o && o.jsonp ? 'text/javascript' : 'application/json'],
    ];
    if (o && o.jsonp) q.push(['format_options', 'callback:' + o.jsonp]);
    q.push(['key', String(key || '').trim()]);
    if (domain) q.push(['domain', String(domain).trim()]);
    return 'https://api.vworld.kr/ned/wfs/' + L.path + '?' + q.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  };

  /* ---------- 응답 읽기: GeoJSON · JSONP로 감싼 GeoJSON · XML 오류 보고 ---------- */
  const ERR_HELP = {
    INVALID_KEY: '등록되지 않은 인증키입니다. 인증키를 다시 확인하세요.',
    INCORRECT_KEY: '인증키와 서비스 URL이 맞지 않습니다. 인증키를 받을 때 등록한 서비스 URL을 그대로 넣으세요.',
    UNAVAILABLE_KEY: '쓸 수 없는 인증키입니다(기간 만료·사용 중지). 브이월드에서 인증키 상태를 확인하세요.',
    OVER_REQUEST_LIMIT: '오늘 쓸 수 있는 요청 수를 넘었습니다. 내일 다시 하거나 브이월드에서 한도를 늘리세요.',
  };
  X.parse = function (text) {
    let t = String(text || '').replace(/^﻿/, '').trim();
    if (!t) return { ok: false, msg: '붙여 넣은 내용이 비어 있습니다.' };
    if (t[0] === '<') {
      const code = (t.match(/code\s*=\s*"([^"]+)"/) || [])[1] || '';
      const body = ((t.match(/<(?:\w+:)?(?:ServiceException|ExceptionText|text|message)[^>]*>([\s\S]*?)<\//) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\s+/g, ' ').trim();
      const k = Object.keys(ERR_HELP).find((x) => code.toUpperCase().indexOf(x) >= 0 || t.indexOf(x) >= 0);
      return { ok: false, code: k || code, msg: (k ? ERR_HELP[k] : '브이월드가 오류를 돌려보냈습니다.') + (body ? ` (응답: ${body.slice(0, 120)})` : '') };
    }
    const p = t.indexOf('{'), q = t.lastIndexOf('}');
    if (p < 0 || q < p) return { ok: false, msg: '데이터(JSON) 형식이 아닙니다. 새 탭에 나온 글 전체를 복사했는지 확인하세요.' };
    if (p > 0) t = t.slice(p, q + 1); // JSONP: 이름( {...} )
    let J = null;
    try { J = JSON.parse(t); } catch (e) { return { ok: false, msg: '내용이 중간에 잘렸거나 데이터(JSON) 형식이 아닙니다. 새 탭에서 전체 선택(Ctrl+A) 뒤 복사했는지 확인하세요.' }; }
    return X.ingest(J);
  };
  X.ingest = function (J) {
    if (J && J.response && /ERROR/i.test(J.response.status || '')) {
      const e = J.response.error || {};
      const k = Object.keys(ERR_HELP).find((x) => String(e.code || '').toUpperCase().indexOf(x) >= 0);
      return { ok: false, code: k || e.code, msg: k ? ERR_HELP[k] : `브이월드 오류: ${e.text || e.code || '알 수 없음'}` };
    }
    const feats = J && (J.type === 'FeatureCollection' ? J.features : Array.isArray(J.features) ? J.features : Array.isArray(J) ? J : null);
    if (!Array.isArray(feats)) return { ok: false, msg: '건물이나 필지 자료가 아닙니다(GeoJSON 형식이 아님).' };
    const f0 = feats.find((f) => f && f.properties) || null;
    const pr = (f0 && f0.properties) || {};
    let kind = null;
    if ('ground_floor_co' in pr || 'buld_prpos_code' in pr || 'gis_idntfc_no' in pr || 'hg' in pr) kind = 'bld';
    else if ('lnm_lndcgr_smbol' in pr || ('pnu' in pr && 'jibun' in pr)) kind = 'par';
    if (!feats.length) kind = 'empty';
    if (!kind) return { ok: false, msg: '건물(GIS건물통합정보)이나 지적(연속지적도) 자료가 아닙니다.' };
    const returned = feats.length;
    const tot = +J.numberMatched || +J.totalFeatures || 0;
    const ext = featExtent(feats);
    return { ok: true, kind, feats, returned, matched: tot || null, cut: returned >= X.MAX || (tot > returned), ext };
  };
  /* 좌표 축 순서 정하기: [경도, 위도]가 보통이지만 [위도, 경도]나 웹 메르카토르(m)로 온 자료도 읽는다 */
  function axisOf(feats) {
    for (const f of feats) {
      const c = firstCoord(f && f.geometry);
      if (!c) continue;
      if (inLon(c[0]) && inLat(c[1])) return 'xy';
      if (inLat(c[0]) && inLon(c[1])) return 'yx';
      if (c[0] > 13.6e6 && c[0] < 14.8e6) return 'merc';
      return null;
    }
    return null;
  }
  function firstCoord(g) {
    if (!g || !g.coordinates) return null;
    let c = g.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    return Array.isArray(c) && c.length >= 2 ? c : null;
  }
  const lonlatOf = (ax, c) => (ax === 'yx' ? [c[1], c[0]] : ax === 'merc' ? ((m) => [m.lon, m.lat])(merc(c[0], c[1])) : [c[0], c[1]]);
  function featExtent(feats) {
    const ax = axisOf(feats); if (!ax) return null;
    let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
    feats.forEach((f) => eachRing(f.geometry, (ring) => ring.forEach((c) => { const q = lonlatOf(ax, c); if (q[0] < w) w = q[0]; if (q[0] > e) e = q[0]; if (q[1] < s) s = q[1]; if (q[1] > n) n = q[1]; })));
    return isFinite(s) ? { s, w, n, e } : null;
  }
  /* 다각형 고리마다 fn(ring, polyIndex, ringIndex) */
  function eachRing(g, fn) {
    if (!g) return;
    if (g.type === 'Polygon') (g.coordinates || []).forEach((r, k) => fn(r, 0, k));
    else if (g.type === 'MultiPolygon') (g.coordinates || []).forEach((poly, i) => (poly || []).forEach((r, k) => fn(r, i, k)));
  }

  /* ---------- 다각형 손질 ---------- */
  function cleanRing(pts) {
    const out = [];
    pts.forEach((p) => { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.04) out.push(p); });
    if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.04) out.pop();
    // 거의 일직선인 점 빼기
    let changed = true;
    while (changed && out.length > 3) {
      changed = false;
      for (let i = 0; i < out.length; i++) {
        const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        const d = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / L;
        if (d < 0.03) { out.splice(i, 1); changed = true; break; }
      }
    }
    return out;
  }
  /* 지오메트리 → 부분들 [{o: 바깥 고리(반시계), h: [구멍(시계)]}] */
  function partsOf(g, ax, F) {
    const polys = [];
    eachRing(g, (ring, pi, k) => {
      let pts = ring.map((c) => { const q = lonlatOf(ax, c); const p = toXY(F, q[0], q[1]); return [r2(p[0]), r2(p[1])]; });
      pts = cleanRing(pts);
      if (pts.length < 3) return;
      const A = U.polyArea(pts);
      if (Math.abs(A) < 0.3) return;
      if (!polys[pi]) polys[pi] = { o: null, h: [] };
      if (k === 0) polys[pi].o = A > 0 ? pts : pts.reverse();
      else polys[pi].h.push(A < 0 ? pts : pts.reverse());
    });
    return polys.filter((p) => p && p.o);
  }

  /* ---------- 건물 ---------- */
  // 주용도 코드 앞 두 자리 → [이름, 분류]. 분류: res 주거 · com 상업·근린 · off 업무 · pub 공공·문화·교육·의료 · ind 산업·창고·기타
  const USE2 = {
    '01': ['단독주택', 'res'], '02': ['공동주택', 'res'], '03': ['제1종근린생활시설', 'com'], '04': ['제2종근린생활시설', 'com'],
    '05': ['문화및집회시설', 'pub'], '06': ['종교시설', 'pub'], '07': ['판매시설', 'com'], '08': ['운수시설', 'com'], '09': ['의료시설', 'pub'],
    '10': ['교육연구시설', 'pub'], '11': ['노유자시설', 'pub'], '12': ['수련시설', 'pub'], '13': ['운동시설', 'pub'], '14': ['업무시설', 'off'],
    '15': ['숙박시설', 'com'], '16': ['위락시설', 'com'], '17': ['공장', 'ind'], '18': ['창고시설', 'ind'], '19': ['위험물저장및처리시설', 'ind'],
    '20': ['자동차관련시설', 'ind'], '21': ['동물및식물관련시설', 'ind'], '22': ['자원순환관련시설', 'ind'], '23': ['교정및군사시설', 'pub'],
    '24': ['방송통신시설', 'pub'], '25': ['발전시설', 'ind'], '26': ['묘지관련시설', 'pub'], '27': ['관광휴게시설', 'com'], '28': ['장례시설', 'pub'], '29': ['야영장시설', 'com'],
  };
  const USE5 = { '01001': '단독주택', '01002': '다중주택', '01003': '다가구주택', '01004': '공관', '02001': '아파트', '02002': '연립주택', '02003': '다세대주택', '02004': '기숙사' };
  X.useOf = function (code) {
    const c = String(code || '').replace(/\D/g, '');
    if (c.length < 2) return { name: '용도 정보 없음', cat: 'none' };
    const g = USE2[c.slice(0, 2)];
    if (!g) return { name: `기타(코드 ${c})`, cat: 'ind' };
    return { name: USE5[c.slice(0, 5)] || g[0], cat: g[1] };
  };
  const STRUCT = { '11': '벽돌구조', '12': '블록구조', '13': '석구조', '19': '기타조적구조', '21': '철근콘크리트구조', '22': '프리캐스트콘크리트구조', '26': '철골철근콘크리트구조', '29': '기타콘크리트구조', '31': '일반철골구조', '32': '경량철골구조', '33': '강파이프구조', '39': '기타강구조', '41': '일반목구조', '42': '통나무구조' };
  X.structOf = function (code) {
    const c = String(code || '').replace(/\D/g, '');
    if (!c) return '';
    return STRUCT[c.slice(0, 2)] || ({ 1: '조적조', 2: '콘크리트조', 3: '철골조', 4: '목조' }[c[0]] || `기타(코드 ${c})`);
  };
  // 층고(m): 분류별 어림값. 층수만 있고 높이가 없을 때 높이를 어림하는 데 씀
  const FLOOR_H = { res: 2.9, com: 3.6, off: 3.8, pub: 3.9, ind: 5.5, none: 3.3 };
  /* 층수로 어림한 높이(m): 층고 × 층수 + 파라펫 */
  X.hOf = (cat, fl) => r2(fl * (FLOOR_H[cat] || 3.3) + (cat === 'res' ? 0.4 : 0.8));
  X.CATS = {
    res: { name: '주거', color: null }, com: { name: '상업·근린생활', color: null }, off: { name: '업무', color: null },
    pub: { name: '공공·문화·교육·의료', color: null }, ind: { name: '산업·창고·기타', color: '#B5A795' }, none: { name: '정보 없음', color: '#D6D1CA' },
  };
  const catColor = (k) => X.CATS[k].color || (C.USES[k] ? C.USES[k].color : '#C9C3BA');

  /* 사용승인일 → 'YYYYMMDD'(모르면 '') */
  function dateOf(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length < 4) return '';
    const y = +d.slice(0, 4);
    return y >= 1880 && y <= new Date().getFullYear() + 1 ? d.slice(0, 8) : '';
  }

  /* GeoJSON 건물 → 현황 건물(대상지 안에 무게중심이 드는 것만) */
  X.buildings = function (feats, F) {
    const ax = axisOf(feats); if (!ax) return [];
    const seen = new Set(), out = [];
    feats.forEach((f, i) => {
      if (!f || !f.geometry) return;
      const p = f.properties || {};
      const id = String(f.id || p.gis_idntfc_no || p.buld_idntfc_no || 'b' + i);
      if (seen.has(id)) return;
      const parts = partsOf(f.geometry, ax, F);
      if (!parts.length) return;
      let big = parts[0], bigA = 0, area = 0;
      parts.forEach((pt) => { const a = U.polyArea(pt.o) - pt.h.reduce((s, h) => s + Math.abs(U.polyArea(h)), 0); area += a; if (a > bigA) { bigA = a; big = pt; } });
      const c = U.polyCentroid(big.o);
      if (!(c[0] >= 0 && c[0] <= F.W && c[1] >= 0 && c[1] <= F.H)) return;
      seen.add(id);
      const use = X.useOf(p.buld_prpos_code);
      const ar = num(p.ar), ta = num(p.totar);
      let fl = Math.round(num(p.ground_floor_co)), est = '';
      if (!(fl > 0)) { const k = ta > 0 && ar > 0 ? ta / ar : 0; fl = k >= 0.6 ? U.clamp(Math.round(k), 1, 90) : 0; if (fl) est = 'fl'; }
      const fh = FLOOR_H[use.cat] || 3.3;
      let h = num(p.hg);
      const okH = h > 2 && h < 400 && (!fl || (h / fl > 1.9 && h / fl < 12));
      if (!okH) {
        if (!fl) { const g = Math.round(num(p._fl)); if (g > 0) { fl = U.clamp(g, 1, 90); est = 'g'; } else { fl = 1; est = 'all'; } } // g: 용도·건축면적으로 어림(공개 지도 자료)
        h = X.hOf(use.cat, fl);
        if (!est) est = 'h';
      } else if (!fl) { fl = Math.max(1, Math.round(h / fh)); est = 'fl'; }
      const jb = +p.mnnm ? String(+p.mnnm) + (+p.slno ? '-' + +p.slno : '') : '';
      const rec = {
        id, parts, c: [r2(c[0]), r2(c[1])], a: r2(area), fl, h: r2(h),
        ug: Math.round(num(p.undgrnd_floor_co)) || 0, pc: String(p.buld_prpos_code || ''), cat: use.cat,
        ar: r2(ar), ta: r2(ta), pa: r2(num(p.plot_ar)), bcr: r2(num(p.btl_rt)), far: r2(num(p.measrmt_rt)),
        y: dateOf(p.use_confm_de), sc: String(p.strct_code || ''), nm: String(p.buld_nm || '').trim(), dn: String(p.dong_nm || '').trim(),
        pnu: String(p.pnu || ''), jb, vi: String(p.violt_bild || '').toUpperCase() === 'Y' ? 1 : 0, dd: dateOf(p.data_creat_change_de || p.last_updt_dt),
      };
      if (p.ovt_cls || p.ovt_sub) rec.oc = String(p.ovt_cls || p.ovt_sub); // 공개 지도 자료의 건물 분류(영문)
      if (est) rec.est = est;
      out.push(rec);
    });
    return out;
  };

  /* ---------- 필지 ---------- */
  // 지목 부호 → 분류(바탕 칠): road 도로 · rail 철도 · water 하천·구거·유지 · green 공원·체육·유원지·묘지 · farm 전·답·과수원·목장·임야 · lot 그 밖의 대지
  const JIMOK = { 도: 'road', 철: 'rail', 천: 'water', 구: 'water', 유: 'water', 양: 'water', 제: 'water', 공: 'green', 체: 'green', 원: 'green', 묘: 'green', 전: 'farm', 답: 'farm', 과: 'farm', 목: 'farm', 임: 'farm' };
  X.JIMOK_NAME = { 전: '전', 답: '답', 과: '과수원', 목: '목장용지', 임: '임야', 광: '광천지', 염: '염전', 대: '대', 장: '공장용지', 학: '학교용지', 차: '주차장', 주: '주유소용지', 창: '창고용지', 도: '도로', 철: '철도용지', 제: '제방', 천: '하천', 구: '구거', 유: '유지', 양: '양어장', 수: '수도용지', 공: '공원', 체: '체육용지', 원: '유원지', 종: '종교용지', 사: '사적지', 묘: '묘지', 잡: '잡종지' };
  X.jimokCls = (jm) => JIMOK[jm] || 'lot';
  X.parcels = function (feats, F, opt) {
    const ax = axisOf(feats); if (!ax) return [];
    const seen = new Set(), out = [];
    const noClip = !!(opt && opt.noClip);
    const clip = (poly) => {
      if (noClip) return poly;
      let p = poly;
      [[[0, 0], [1, 0]], [[F.W, 0], [-1, 0]], [[0, 0], [0, 1]], [[0, F.H], [0, -1]]].forEach(([p0, n]) => { if (p.length >= 3) p = U.clipHalfPlane(p, p0, n); });
      return p.length >= 3 ? p.map((q) => [r2(q[0]), r2(q[1])]) : null;
    };
    feats.forEach((f, i) => {
      if (!f || !f.geometry) return;
      const p = f.properties || {};
      const id = String(f.id || p.pnu || 'p' + i);
      if (seen.has(id)) return;
      seen.add(id);
      const sm = String(p.lnm_lndcgr_smbol || p.jibun || '').trim();
      const jm = (sm.match(/([가-힣])\s*$/) || [])[1] || '';
      const no = sm.replace(/\s*[가-힣]\s*$/, '').trim();
      const parts = [];
      partsOf(f.geometry, ax, F).forEach((pt) => {
        const o = clip(pt.o); if (!o || Math.abs(U.polyArea(o)) < 0.5) return;
        parts.push({ o, h: pt.h.map(clip).filter((h) => h && Math.abs(U.polyArea(h)) >= 0.5) });
      });
      if (!parts.length) return;
      out.push({ id, jm, no, pnu: String(p.pnu || ''), parts });
    });
    return out;
  };

  /* ---------- 표현: 단색 · 용도 · 층수 · 사용승인 경과 연수 ---------- */
  const NOW = new Date().getFullYear();
  X.MODES = [['fac', '입면'], ['gray', '단색'], ['use', '용도'], ['floor', '층수'], ['age', '건축 연도'], ['est', '높이 근거']];
  // 층수·높이를 어디서 얻었나: 자료값 · 일부 어림(층수만/높이만) · 용도·면적으로 어림 · 직접 고침
  const EST_CLS = [['edata', '자료값', '#7FC8B4'], ['epart', '일부 어림', '#FBC193'], ['eguess', '어림(용도·면적)', '#F28076'], ['efix', '직접 고침', '#8FB4E3']];
  X.estKey = (b) => (b.fix ? 'efix' : !b.est ? 'edata' : b.est === 'fl' || b.est === 'h' ? 'epart' : 'eguess');
  const FLOOR_CLS = [[2, '1–2층', '#FAE0C7'], [5, '3–5층', '#FBC193'], [10, '6–10층', '#F28076'], [15, '11–15층', '#C9574F'], [999, '16층 이상', '#8B3A3E']];
  const AGE_CLS = [[10, '10년 미만', '#BFE3D8'], [20, '10–20년', '#7FC8B4'], [30, '20–30년', '#FBC193'], [999, '30년 이상', '#F28076']];
  X.GRAY = { fill: '#CBC5BC', edge: '#8F887E', wall: '#E3DFD8', roof: '#D6D0C7' };
  X.ageOf = (b) => (b.y ? NOW - +b.y.slice(0, 4) : null);
  /* 건물 b의 분류 [키, 이름, 색] */
  X.classOf = function (b, mode) {
    if (mode === 'fac') { const f = X.facOf(b.id), T = UDS.Fac && UDS.Fac.TYPES, k = f && T && T[f.t] ? f.t : 'house'; return T ? [k, T[k].name, T[k].color] : ['gray', '현황 건물', X.GRAY.fill]; }
    if (mode === 'use') return [b.cat, X.CATS[b.cat].name, catColor(b.cat)];
    if (mode === 'floor') { const k = FLOOR_CLS.findIndex((c) => b.fl <= c[0]); const c = FLOOR_CLS[k]; return ['f' + k, c[1], c[2]]; }
    if (mode === 'est') { const k = X.estKey(b), c = EST_CLS.find((x) => x[0] === k); return [k, c[1], c[2]]; }
    if (mode === 'age') {
      const a = X.ageOf(b);
      if (a === null) return ['anone', '정보 없음', '#D6D1CA'];
      const k = AGE_CLS.findIndex((c) => a < c[0]); const c = AGE_CLS[k]; return ['a' + k, c[1], c[2]];
    }
    return ['gray', '현황 건물', X.GRAY.fill];
  };
  /* 범례: 표현 방식별 분류 목록(순서 고정) [키, 이름, 색] */
  X.legend = function (mode) {
    if (mode === 'fac' && UDS.Fac) return UDS.Fac.ORDER.map((k) => [k, UDS.Fac.TYPES[k].name, UDS.Fac.TYPES[k].color]);
    if (mode === 'use') return ['res', 'com', 'off', 'pub', 'ind', 'none'].map((k) => [k, X.CATS[k].name, catColor(k)]);
    if (mode === 'floor') return FLOOR_CLS.map((c, k) => ['f' + k, c[1], c[2]]);
    if (mode === 'age') return AGE_CLS.map((c, k) => ['a' + k, c[1], c[2]]).concat([['anone', '정보 없음', '#D6D1CA']]);
    if (mode === 'est') return EST_CLS.map((c) => c.slice());
    return [['gray', '현황 건물', X.GRAY.fill]];
  };

  /* 현황 건물의 추정 입면(facade.js). 앱이 없으면(검사 등) null */
  X.facOf = (id) => { const a = UDS.app, m = a && a.ctxFac ? a.ctxFac() : null; return m ? m.get(id) || null : null; };

  /* ---------- 계획과 겹치는 현황 건물: 지운 것(off) · 새 계획으로 철거되는 것(demo) ----------
     용도가 정해진(빈 터가 아닌) 획지 안이나 새로 낸 도로 위에 무게중심이 드는 건물은 철거된 것으로 보고 감춘다 */
  X.vis = function (P, D, cx) {
    const off = new Set((P.ctx && P.ctx.off) || []);
    const demo = new Map();
    if (!cx || !D) return { off, demo };
    const lots = D.lots.filter((l) => l.use !== 'vacant').map((l) => ({ l, b: U.polyBounds(l.poly) }));
    const rds = P.roads.map((r) => {
      const info = D.roadInfo.get(r.id), hw = info ? info.lay.W / 2 : 3, b = U.polyBounds(r.pts);
      return { pts: r.pts, hw, b: { minx: b.minx - hw, miny: b.miny - hw, maxx: b.maxx + hw, maxy: b.maxy + hw } };
    });
    const inB = (c, b) => c[0] >= b.minx && c[0] <= b.maxx && c[1] >= b.miny && c[1] <= b.maxy;
    cx.bld.forEach((b) => {
      if (off.has(b.id)) return;
      const c = b.c;
      for (const L of lots) if (inB(c, L.b) && U.pointInPoly(c, L.l.poly)) { demo.set(b.id, L.l.id); return; }
      for (const R of rds) {
        if (!inB(c, R.b)) continue;
        for (let i = 0; i + 1 < R.pts.length; i++) if (U.distPointSeg(c, R.pts[i], R.pts[i + 1]).d < R.hw - 0.5) { demo.set(b.id, 'road'); return; }
      }
    });
    return { off, demo };
  };
  X.shown = (V, id) => !V.off.has(id) && !V.demo.has(id);
  /* 건물·필지의 경계 상자(저장되지 않게 숨은 속성으로 기억) */
  X.bb = (b) => {
    if (!b._bb) Object.defineProperty(b, '_bb', { value: U.polyBounds([].concat(...b.parts.map((pt) => pt.o))), enumerable: false });
    return b._bb;
  };
  /* 점 p가 건물(여러 부분·구멍 포함) 안에 드는가 */
  X.hit = (b, p) => {
    const bb = X.bb(b);
    if (p[0] < bb.minx || p[0] > bb.maxx || p[1] < bb.miny || p[1] > bb.maxy) return false;
    return b.parts.some((pt) => U.pointInPoly(p, pt.o) && !pt.h.some((h) => U.pointInPoly(p, h)));
  };
  /* 지목 분류별 바탕색(채색 평면) */
  X.PAR_FILL = { road: '#DFDAD2', rail: '#D9D6DF', water: '#CFE2EA', green: '#D8E8CC', farm: '#ECEFD8' };

  /* 가로 단면: 빈 획지 쪽에는 단면선을 따라 도로 밖으로 나가며 처음 만나는 현황 건물을 세운다(가로의 D/H를 실제 건물로 읽게) */
  const SHORT = { res: '주거', com: '근생·상업', off: '업무', pub: '공공', ind: '기타', none: '' };
  X.sectionSides = function (out, cx, V) {
    if (!cx || !V) return;
    ['L', 'R'].forEach((k) => {
      const sd = out.sides[k];
      if (!sd || sd.building || sd.use !== 'vacant') return;
      const dir = U.mul(out.n, k === 'L' ? 1 : -1), t0 = out.W / 2 - 1, t1 = out.W / 2 + 45;
      let best = null, bt = Infinity;
      // 단면선과 그 앞뒤(±2.5m, ±5m)로 나란히 쏘아 건물 사이 틈에 빠지지 않게 한다. 단면선 위의 것을 먼저 친다
      [0, -2.5, 2.5, -5, 5].forEach((off, ri) => {
        const o = [out.p[0] + out.dir[0] * off, out.p[1] + out.dir[1] * off];
        const ex = [o[0] + dir[0] * t1, o[1] + dir[1] * t1];
        cx.bld.forEach((b) => {
          if (!X.shown(V, b.id)) return;
          const bb = X.bb(b);
          if (Math.max(o[0], ex[0]) < bb.minx || Math.min(o[0], ex[0]) > bb.maxx || Math.max(o[1], ex[1]) < bb.miny || Math.min(o[1], ex[1]) > bb.maxy) return;
          b.parts.forEach((pt) => {
            const R = pt.o;
            for (let i = 0; i < R.length; i++) {
              const a = R[i], c = R[(i + 1) % R.length], e = [c[0] - a[0], c[1] - a[1]];
              const den = dir[0] * e[1] - dir[1] * e[0];
              if (Math.abs(den) < 1e-9) continue;
              const w = [a[0] - o[0], a[1] - o[1]];
              const t = (w[0] * e[1] - w[1] * e[0]) / den, u = (w[0] * dir[1] - w[1] * dir[0]) / den;
              const tt = t + (ri ? 0.75 : 0); // 옆으로 쏜 것은 조금 불리하게
              if (u >= 0 && u <= 1 && t > t0 && t < t1 && tt < bt) { bt = tt; best = b; }
            }
          });
        });
      });
      if (!best) return;
      const use = X.useOf(best.pc), cat = use.cat, fl = Math.max(1, best.fl);
      const setback = Math.max(0, bt - out.W / 2);
      const fc = X.facOf(best.id), T = UDS.Fac && UDS.Fac.TYPES;
      if (fc && T) { // 추정 입면: 3D와 같은 재료·창·1층·간판·지붕
        sd.building = { id: 'ctx:' + best.id, ctxId: best.id, h: best.h, floors: fl, groundH: fc.groundH, floorH: fc.floorH, front: setback, label: `현황 ${T[fc.t].name}`, st: { ...fc.st } };
      } else {
        const gH = Math.min(best.h, cat === 'com' || cat === 'off' || cat === 'pub' ? 4.2 : 3.0);
        const fH = fl > 1 ? U.clamp((best.h - gH) / (fl - 1), 2.5, 6) : 3;
        sd.building = {
          id: 'ctx:' + best.id, ctxId: best.id, h: best.h, floors: fl, groundH: gH, floorH: fH, front: setback,
          label: `현황 ${SHORT[cat] || ''}`.trim(),
          st: { material: 'concrete', wallColor: '#D8D3CB', wwr: 0.3, win: 'punched', ground: cat === 'com' ? 'shop' : cat === 'res' ? 'residential' : 'lobby', sign: 'none', canopy: false, roof: 'flat' },
        };
      }
      sd.setback = setback; sd.h = best.h; sd.ctx = best.id;
    });
  };

  /* 현황 요약: 동수·건축면적·연면적·평균 층수·노후 비율과, 표현 방식별 분류 개수 */
  X.stats = function (cx, V, mode) {
    const s = { n: cx.bld.length, shown: 0, demo: V.demo.size, off: V.off.size, fp: 0, gfa: 0, flSum: 0, maxFl: 0, maxH: 0, old: 0, aged: 0, cls: {}, demoGfa: 0, est: 0 };
    cx.bld.forEach((b) => {
      const gfa = b.ta > 0 ? b.ta : b.a * b.fl;
      if (V.demo.has(b.id)) { s.demoGfa += gfa; return; }
      if (V.off.has(b.id)) return;
      s.shown++; s.fp += b.a; s.gfa += gfa; s.flSum += b.fl; s.maxFl = Math.max(s.maxFl, b.fl); s.maxH = Math.max(s.maxH, b.h);
      if (b.est && !b.fix) s.est++;
      const a = X.ageOf(b); if (a !== null) { s.aged++; if (a >= 30) s.old++; }
      const k = X.classOf(b, mode)[0]; s.cls[k] = (s.cls[k] || 0) + 1;
    });
    return s;
  };

  /* ---------- 삼각분할(구멍 있는 지붕): 구멍을 바깥 고리에 다리로 이은 뒤 귀 자르기 ---------- */
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  function segX(a, b, c, d) { // 끝점을 공유하지 않는 두 선분이 엄밀히 교차하는가
    const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
  }
  function bridge(ring, hole, rest) {
    let mi = 0; hole.forEach((p, i) => { if (p[0] > hole[mi][0]) mi = i; });
    const M = hole[mi];
    const cand = ring.map((p, i) => [i, Math.hypot(p[0] - M[0], p[1] - M[1])]).sort((a, b) => a[1] - b[1]);
    const rings = [ring, hole].concat(rest);
    let vi = cand.length ? cand[0][0] : 0;
    for (const [i] of cand) {
      const V = ring[i];
      let ok = true;
      for (const R of rings) {
        for (let k = 0; k < R.length && ok; k++) { const a = R[k], b = R[(k + 1) % R.length]; if (a === V || b === V || a === M || b === M) continue; if (segX(M, V, a, b)) ok = false; }
        if (!ok) break;
      }
      if (ok) { vi = i; break; }
    }
    const h2 = hole.slice(mi).concat(hole.slice(0, mi));
    return ring.slice(0, vi + 1).concat(h2, [M, ring[vi]], ring.slice(vi + 1));
  }
  function inTri(p, a, b, c) {
    const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    return d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9;
  }
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  /* outer: 반시계, holes: 시계. 반환 { pts, idx } */
  X.tri = function (outer, holes) {
    let ring = outer.slice();
    const hs = (holes || []).filter((h) => h.length >= 3).map((h) => ({ h, mx: Math.max(...h.map((p) => p[0])) })).sort((a, b) => b.mx - a.mx);
    hs.forEach((x, k) => { ring = bridge(ring, x.h, hs.slice(k + 1).map((y) => y.h)); });
    const P = ring, n = P.length, idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    const tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < n * n * 3) {
      let found = false;
      for (let i = 0; i < idx.length; i++) {
        const ia = idx[(i - 1 + idx.length) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        const A = P[ia], B = P[ib], Cc = P[ic];
        if (cross(A, B, Cc) <= 1e-9) continue;
        let ok = true;
        for (let j = 0; j < idx.length; j++) {
          const q = P[idx[j]];
          if (idx[j] === ia || idx[j] === ib || idx[j] === ic || same(q, A) || same(q, B) || same(q, Cc)) continue;
          if (inTri(q, A, B, Cc)) { ok = false; break; }
        }
        if (!ok) continue;
        tris.push(ia, ib, ic); idx.splice(i, 1); found = true; break;
      }
      if (!found) {
        // 일직선·겹친 점을 빼고 다시. 그래도 안 되면 남은 것을 부채꼴로
        const di = idx.findIndex((ib, i) => Math.abs(cross(P[idx[(i - 1 + idx.length) % idx.length]], P[ib], P[idx[(i + 1) % idx.length]])) <= 1e-9);
        if (di >= 0) { idx.splice(di, 1); continue; }
        for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]);
        idx.length = 0; break;
      }
    }
    if (idx.length === 3 && cross(P[idx[0]], P[idx[1]], P[idx[2]]) > 1e-9) tris.push(idx[0], idx[1], idx[2]);
    return { pts: P, idx: tris };
  };

  /* ---------- 지적도의 도로 필지 → 도로망 ----------
     도로(지목 '도') 필지를 격자 그림으로 칠한 뒤 지도 캡처와 같은 방법(가늘게 깎기 → 교차점·구간 → 노선 → 폭)으로 중심선을 얻는다.
     지적의 도로 폭은 법적 경계이므로 그림에서 읽은 폭보다 믿을 만하다. 막다른 골목은 그대로 두고(끊긴 곳 잇기는 아주 짧은 틈만) 작은 가구도 메우지 않는다 */
  X.streetsFromParcels = function (par, W, H) {
    const MI = UDS.MapImport;
    const roads = par.filter((p) => p.jm === '도');
    if (!roads.length || !MI) return [];
    // 대상지 둘레에 여유(M)를 두고 칠한다: 가장자리에서 생기는 잔가지·꺾임이 대상지 밖에 생기게 한 뒤 대상지 경계로 자른다
    const Mg = 30, W2 = W + 2 * Mg, H2 = H + 2 * Mg;
    const mpp0 = Math.max(0.4, Math.max(W2, H2) / 1200);
    const w = Math.round(W2 / mpp0) + 1, h = Math.round(H2 / mpp0) + 1;
    const mpp = W2 / (w - 1);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff';
    const ring = (pts) => pts.forEach((p, i) => { const x = (p[0] + Mg) / mpp, y = (H + Mg - p[1]) / mpp; if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    roads.forEach((p) => { c.beginPath(); p.parts.forEach((pt) => { ring(pt.o); c.closePath(); pt.h.forEach((hh) => { ring(hh); c.closePath(); }); }); c.fill('evenodd'); });
    const img = c.getImageData(0, 0, w, h).data;
    const n = w * h, mask = new Uint8Array(n);
    let nr = 0;
    for (let i = 0; i < n; i++) if (img[i * 4] > 127) { mask[i] = 1; nr++; }
    if (nr < 50) return [];
    const zeros = new Uint8Array(n);
    const o = { mpp, maxWidth: 80, keepHoles: true, closeR: 1, gap: 4, spur: 12, tiny: 6, tinyW: 0.6, linkWR: 1.35, inner: [Mg / mpp, Mg / mpp, (Mg + W) / mpp, (Mg + H) / mpp], grid: false, widthK: 1, W: w, H: h };
    const cls = { w, h, road: mask, major: zeros, green: zeros, water: zeros, land: [0, 0, 0], landWhite: false, ratio: nr / n };
    const cl = MI.clean(cls, o);
    const sk = MI.thin(cl.mask, w, h);
    const gr = MI.graph(sk, w, h, cl.dt, zeros, o);
    const st = MI.streets(gr, o);
    let out = [];
    (st.streets || []).forEach((s) => {
      const pts = s.pts.map((p) => [p[0] - Mg, p[1] - Mg]);
      clipLine(pts, W, H).forEach((q) => out.push({ pts: q, w: s.w, major: false }));
    });
    // 끝 다듬기: 다른 길과 닿지 않는 아주 짧은 조각은 버리고, 대상지 가장자리 바로 안에서 끊긴 길(바깥 필지가 없어 생긴 막다른 끝)은 가장자리까지 늘린다
    const key = (p) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
    const lenOf = (s) => { let L = 0; for (let i = 1; i < s.pts.length; i++) L += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]); return L; };
    const endMap = () => { const m = new Map(); out.forEach((s) => [s.pts[0], s.pts[s.pts.length - 1]].forEach((p) => m.set(key(p), (m.get(key(p)) || 0) + 1))); return m; };
    const onEdge = (p) => p[0] < 0.05 || p[1] < 0.05 || p[0] > W - 0.05 || p[1] > H - 0.05;
    const touches = (p, self) => out.some((o) => o !== self && o.pts.some((q, i) => i > 0 && i < o.pts.length - 1 && Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.6));
    let ends = endMap();
    const linked = (p, s) => ends.get(key(p)) > 1 || touches(p, s);
    for (let pass = 0; pass < 3; pass++) {
      const n0 = out.length;
      out = out.filter((s) => { const L = lenOf(s); return L >= Math.max(10, s.w) || (L >= 3 && linked(s.pts[0], s) && linked(s.pts[s.pts.length - 1], s)); });
      ends = endMap();
      if (out.length === n0) break;
    }
    out.forEach((s) => {
      [0, 1].forEach((k) => {
        const pts = s.pts, i = k ? pts.length - 1 : 0, j = k ? pts.length - 2 : 1, p = pts[i];
        if (onEdge(p) || linked(p, s)) return;
        const L = Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]) || 1;
        const d = [(p[0] - pts[j][0]) / L, (p[1] - pts[j][1]) / L];
        let t = Infinity;
        if (d[0] < -1e-6) t = Math.min(t, -p[0] / d[0]); if (d[0] > 1e-6) t = Math.min(t, (W - p[0]) / d[0]);
        if (d[1] < -1e-6) t = Math.min(t, -p[1] / d[1]); if (d[1] > 1e-6) t = Math.min(t, (H - p[1]) / d[1]);
        if (t <= s.w / 2 + 4) pts[i] = [U.clamp(p[0] + d[0] * t, 0, W), U.clamp(p[1] + d[1] * t, 0, H)];
      });
      s.len = lenOf(s);
    });
    out.forEach((s) => { s.pts = s.pts.map((p) => [r2(p[0]), r2(p[1])]); });
    return out;
  };
  /* 꺾은선을 대상지 사각형 [0,W]×[0,H]로 자름(드나들면 여러 조각) */
  function clipSeg(a, b, W, H) {
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const P = [-dx, dx, -dy, dy], Q = [a[0], W - a[0], a[1], H - a[1]];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(P[i]) < 1e-12) { if (Q[i] < 0) return null; continue; }
      const t = Q[i] / P[i];
      if (P[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    if (t1 - t0 < 1e-9) return null;
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
  }
  function clipLine(pts, W, H) {
    const out = [];
    let cur = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const sg = clipSeg(pts[i], pts[i + 1], W, H);
      if (!sg) { if (cur.length > 1) out.push(cur); cur = []; continue; }
      const l = cur[cur.length - 1];
      if (!l || Math.hypot(l[0] - sg[0][0], l[1] - sg[0][1]) > 1e-6) { if (cur.length > 1) out.push(cur); cur = [sg[0]]; }
      cur.push(sg[1]);
      if (Math.hypot(sg[1][0] - pts[i + 1][0], sg[1][1] - pts[i + 1][1]) > 1e-6) { out.push(cur); cur = []; }
    }
    if (cur.length > 1) out.push(cur);
    return out;
  }

  /* ---------- 받은 자료로 프로젝트 만들기 ----------
     o: { title, lat, lon, W, H, bld(GeoJSON 지형지물), par, roads(도로망 만들기), type(도로 단면 유형) } */
  X.makeProject = function (o) {
    const M = UDS.Model, MI = UDS.MapImport;
    const F = X.frame(o.lat, o.lon, o.W, o.H);
    const bld = X.buildings(o.bld || [], F);
    const par = X.parcels(o.par || [], F);
    const P = M.newProject('real');
    P.meta.title = o.title || '실제 지역';
    P.meta.defaultUse = 'vacant';
    const type = MI && MI.TYPES && MI.TYPES[o.type] ? o.type : 'oldtown';
    P.meta.scheme = type === 'newtown' ? 'separate' : 'combined';
    P.meta.importType = type;
    P.site = { w: o.W, h: o.H };
    P.settings.lat = Math.round(o.lat * 10) / 10;
    const id = U.uid('cx');
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    P.ctx = { id, lat: +o.lat.toFixed(6), lon: +o.lon.toFixed(6), off: [] };
    let nRoads = 0;
    const rd = []; // 받을 때의 도로망(중심선·폭): 현황 건물이 길에 면했는지 볼 때 쓴다(계획 도로를 고쳐도 그대로)
    const snap = (pts, w) => { if (pts && pts.length > 1 && w > 0) rd.push({ p: pts.map((q) => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]), w: Math.round(w * 10) / 10 }); };
    if (o.par2 && o.par2.length) o.par2.forEach((q) => par.push(q)); // 이미 대상지 좌표로 된 바탕(철도 부지 등)
    if (o.streets && MI && MI.roadSpec) { // 도로 중심선(공개 지도 자료): 폭·등급으로 단면을 정한다
      const cnt = {}, nm = {};
      o.streets.forEach((s) => {
        if (!s.pts || s.pts.length < 2) return;
        const sp = MI.roadSpec(s.w, s.major, type);
        cnt[sp.cls] = (cnt[sp.cls] || 0) + 1;
        let name = s.name && /[가-힣]/.test(s.name) ? s.name : `${sp.cls} ${cnt[sp.cls]}`;
        if (s.name && nm[name]) name = `${s.name} ${++nm[s.name]}`; else nm[name] = 1; // 같은 이름의 길이 여러 토막이면 번호를 붙인다
        P.roads.push(M.makeRoad(sp.k, s.pts, { ...sp.o, name }));
        snap(s.pts, s.w);
        nRoads++;
      });
      (o.rabs || []).forEach((rb) => { (P.rabouts = P.rabouts || []).push({ id: U.uid('rb'), p: rb.p.slice(), d: rb.d || null, lanes: null }); });
    } else if (o.roads && par.length && MI && MI.roadSpec) {
      const cnt = {};
      X.streetsFromParcels(X.parcels(o.par || [], F, { noClip: true }), o.W, o.H).forEach((s) => {
        if (s.pts.length < 2) return;
        const sp = MI.roadSpec(s.w, false, type);
        cnt[sp.cls] = (cnt[sp.cls] || 0) + 1;
        P.roads.push(M.makeRoad(sp.k, s.pts, { ...sp.o, name: `${sp.cls} ${cnt[sp.cls]}` }));
        snap(s.pts, s.w);
        nRoads++;
      });
    }
    const data = { id, lat: P.ctx.lat, lon: P.ctx.lon, W: o.W, H: o.H, date, src: o.src || '브이월드 GIS건물통합정보' + (par.length ? '·연속지적도' : ''), bld, par };
    if (o.attr) data.attr = o.attr;
    if (rd.length) data.rd = rd;
    return { P, data, nRoads };
  };

  /* ---------- 바로 받기(JSONP): Claude 화면 밖(내려받은 파일·직접 올린 누리집)에서만 된다 ----------
     브이월드는 JSONP 응답을 parseResponse(...)로 감싸 보낸다. 한 번에 하나씩 차례로 부른다 */
  X.inSandbox = function () {
    try {
      if (G.claude && typeof G.claude.use === 'function') return true;
      if (/claude(usercontent)?\.(ai|com)$/.test(location.hostname)) return true;
      const ao = location.ancestorOrigins;
      if (ao && Array.prototype.some.call(ao, (x) => /claude\.ai|claudeusercontent/.test(x))) return true;
    } catch (e) { return true; }
    return false;
  };
  X.jsonp = function (url, ms) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      let done = false;
      const prev = G.parseResponse;
      const fin = (err, data) => {
        if (done) return; done = true; clearTimeout(t);
        G.parseResponse = prev;
        s.remove();
        if (err) reject(err); else resolve(data);
      };
      G.parseResponse = (data) => fin(null, data);
      s.onerror = () => fin(new Error('blocked'));
      s.onload = () => setTimeout(() => fin(new Error('notdata')), 60);
      const t = setTimeout(() => fin(new Error('timeout')), ms || 25000);
      s.async = true; s.src = url;
      document.head.appendChild(s);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
