/* Urbify — 인증키 없이 받는 공개 지도 자료(Overture Maps)
 * Overture Maps Foundation이 PMTiles(벡터 타일 묶음 파일)로 내놓는 건물·교통망을 브라우저에서 바로 읽는다.
 * 파일 전체(수백 GB)를 받지 않고 필요한 타일만 범위 요청(HTTP Range)으로 가져온다:
 *   머리(127바이트) → 목록(디렉터리, gzip) → 타일(MVT 벡터 타일, gzip) → 지형지물.
 * 건물은 브이월드 건물 자료와 같은 꼴(속성 이름)로 바꿔 ctx.js의 X.buildings로 세우고,
 * 도로는 중심선을 이어 붙여 대상지의 도로망(가로 단면 유형별 폭)으로 만든다. */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U;
  const O = (UDS.Ovt = {});
  O.BASE = 'https://tiles.overturemaps.org/';
  O.STAC = 'https://stac.overturemaps.org/catalog.json';
  O.FALLBACK = '2026-10-21.0'; // 목록을 읽지 못할 때 쓰는 배포판
  O.Z = 14; // 건물·교통 타일의 가장 큰 확대 단계(z14 한 장 ≈ 2.4km × 2.4km × cos 위도)
  O.ATTR = '© OpenStreetMap contributors, Overture Maps Foundation';
  const LS = 'uds.ovt';

  /* ---------- 배포판(release): 가장 최근 것을 목록(STAC)에서 읽어 사흘 동안 기억 ---------- */
  const okRel = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}\.\d+$/.test(s);
  O.release = async function () {
    if (O._rel) return O._rel;
    let rel = null;
    try { const c = JSON.parse(localStorage.getItem(LS) || 'null'); if (c && okRel(c.rel) && Date.now() - c.t < 3 * 864e5) rel = c.rel; } catch (e) { /* 무시 */ }
    if (!rel) {
      try {
        const j = await (await fetchT(O.STAC, 9000)).json();
        rel = okRel(j.latest) ? j.latest : (((j.links || []).find((l) => l.latest) || {}).href || '').split('/').find(okRel) || null;
        if (rel) try { localStorage.setItem(LS, JSON.stringify({ rel, t: Date.now() })); } catch (e) { /* 무시 */ }
      } catch (e) { /* 목록을 못 읽으면 정해 둔 배포판 */ }
    }
    return (O._rel = rel || O.FALLBACK);
  };
  function fetchT(url, ms, init) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ac ? setTimeout(() => ac.abort(), ms || 20000) : 0;
    return fetch(url, { ...(init || {}), ...(ac ? { signal: ac.signal } : {}) }).finally(() => clearTimeout(t));
  }

  /* ---------- gzip 풀기 ---------- */
  async function gunzip(u8) {
    if (u8.length > 1 && u8[0] === 0x1f && u8[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 풀기(DecompressionStream)를 지원하지 않습니다. 최신 크롬·엣지·사파리에서 여세요.');
      return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    }
    return u8;
  }

  /* ---------- PMTiles v3 읽기 ---------- */
  const rv = (s) => { let v = 0, m = 1, b; do { b = s.b[s.p++]; v += (b & 0x7f) * m; m *= 128; } while (b & 0x80 && s.p < s.b.length); return v; };
  function readDir(u8) {
    const s = { b: u8, p: 0 }, n = rv(s), E = new Array(n);
    let last = 0;
    for (let i = 0; i < n; i++) { last += rv(s); E[i] = { id: last, off: 0, len: 0, run: 1 }; }
    for (let i = 0; i < n; i++) E[i].run = rv(s);
    for (let i = 0; i < n; i++) E[i].len = rv(s);
    for (let i = 0; i < n; i++) { const v = rv(s); E[i].off = v === 0 && i > 0 ? E[i - 1].off + E[i - 1].len : v - 1; }
    return E;
  }
  function findEntry(E, id) {
    let m = 0, n = E.length - 1;
    while (m <= n) {
      const k = (n + m) >> 1, c = id - E[k].id;
      if (c > 0) m = k + 1; else if (c < 0) n = k - 1; else return E[k];
    }
    if (n >= 0 && (E[n].run === 0 || id - E[n].id < E[n].run)) return E[n];
    return null;
  }
  /* 타일 번호(z/x/y) → PMTiles 타일 식별자(힐베르트 곡선 순서) */
  O.tileId = function (z, x, y) {
    let acc = 0;
    for (let i = 0; i < z; i++) acc += Math.pow(4, i);
    const xy = [x, y];
    let d = 0;
    for (let s = Math.pow(2, z) / 2; s >= 1; s /= 2) {
      const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      if (ry === 0) { if (rx === 1) { xy[0] = s - 1 - xy[0]; xy[1] = s - 1 - xy[1]; } const t = xy[0]; xy[0] = xy[1]; xy[1] = t; }
    }
    return acc + d;
  };
  function Archive(url) { this.url = url; this.h = null; this.dirs = new Map(); this.tiles = new Map(); }
  Archive.prototype.range = async function (off, len) {
    const r = await fetchT(this.url, 30000, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
    if (!r.ok) { const e = new Error('http ' + r.status); e.status = r.status; throw e; }
    const b = new Uint8Array(await r.arrayBuffer());
    return r.status === 200 && b.length > len ? b.subarray(off, off + len) : b; // 범위 요청을 무시하고 통째로 보낸 경우
  };
  Archive.prototype.head = function () {
    if (!this._head) {
      this._head = this.range(0, 16384).then((b) => {
        if (String.fromCharCode.apply(null, Array.from(b.subarray(0, 7))) !== 'PMTiles' || b[7] !== 3) throw new Error('PMTiles 형식이 아닙니다.');
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), u64 = (o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296;
        this.h = { ro: u64(8), rl: u64(16), mo: u64(24), ml: u64(32), lo: u64(40), do: u64(56), ic: b[97], tc: b[98], minZ: b[100], maxZ: b[101] };
        if (this.h.ro + this.h.rl <= b.length) this.dirs.set('r', gunzip(b.subarray(this.h.ro, this.h.ro + this.h.rl)).then(readDir)); // 머리와 함께 온 뿌리 목록
        return this.h;
      });
      this._head.catch(() => { this._head = null; });
    }
    return this._head;
  };
  Archive.prototype.dir = function (key, off, len) {
    if (!this.dirs.has(key)) {
      const p = this.range(off, len).then(gunzip).then(readDir);
      p.catch(() => this.dirs.delete(key));
      this.dirs.set(key, p);
    }
    return this.dirs.get(key);
  };
  /* 타일 하나(압축을 푼 MVT 바이트). 없으면 null */
  Archive.prototype.tile = function (z, x, y) {
    const k = z + '/' + x + '/' + y;
    if (!this.tiles.has(k)) {
      const p = (async () => {
        const h = await this.head();
        if (z > h.maxZ) return null;
        const id = O.tileId(z, x, y);
        let dir = await this.dir('r', h.ro, h.rl);
        for (let depth = 0; depth < 4; depth++) {
          const e = findEntry(dir, id);
          if (!e) return null;
          if (e.run > 0) { const raw = await this.range(h.do + e.off, e.len); return h.tc === 1 ? raw : gunzip(raw); }
          dir = await this.dir('l' + e.off, h.lo + e.off, e.len);
        }
        return null;
      })();
      p.catch(() => this.tiles.delete(k));
      this.tiles.set(k, p);
    }
    return this.tiles.get(k);
  };
  O.Archive = Archive;

  /* ---------- MVT(맵박스 벡터 타일) 읽기: protobuf를 직접 푼다 ---------- */
  function skip(s, t) { if (t === 0) rv(s); else if (t === 1) s.p += 8; else if (t === 2) s.p += rv(s); else if (t === 5) s.p += 4; else s.p = s.b.length; }
  const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  function str(s) { const n = rv(s), v = td.decode(s.b.subarray(s.p, s.p + n)); s.p += n; return v; }
  function value(s, end) {
    let v = null;
    while (s.p < end) {
      const k = rv(s), f = k >> 3, t = k & 7;
      if (f === 1) v = str(s);
      else if (f === 2) { v = new DataView(s.b.buffer, s.b.byteOffset + s.p, 4).getFloat32(0, true); s.p += 4; }
      else if (f === 3) { v = new DataView(s.b.buffer, s.b.byteOffset + s.p, 8).getFloat64(0, true); s.p += 8; }
      else if (f === 4) { v = rv(s); if (v >= 9223372036854775808) v -= 18446744073709551616; }
      else if (f === 5) v = rv(s);
      else if (f === 6) { const n = rv(s); v = n % 2 ? -(n + 1) / 2 : n / 2; }
      else if (f === 7) v = !!rv(s);
      else skip(s, t);
    }
    s.p = end;
    return v;
  }
  const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);
  function geometry(s, a, b) {
    s.p = a;
    const out = [];
    let line = null, x = 0, y = 0, cmd = 0, cnt = 0;
    while (s.p < b) {
      if (cnt === 0) { const c = rv(s); cmd = c & 7; cnt = c >> 3; if (!cnt) continue; }
      cnt--;
      if (cmd === 1 || cmd === 2) {
        x += zz(rv(s)); y += zz(rv(s));
        if (cmd === 1 || !line) { line = []; out.push(line); }
        line.push([x, y]);
      } else if (cmd === 7) { if (line && line.length) line.push([line[0][0], line[0][1]]); }
      else break;
    }
    return out;
  }
  /* buf: 압축을 푼 타일. want: 읽을 층 이름 목록(없으면 모두). 반환 { 층이름: { extent, feats: [{ id, type, props, geom }] } } */
  O.decode = function (buf, want) {
    const s = { b: buf, p: 0 }, layers = {};
    while (s.p < buf.length) {
      const k = rv(s), f = k >> 3, t = k & 7;
      if (f !== 3 || t !== 2) { skip(s, t); continue; }
      const len = rv(s), end = s.p + len;
      const L = { name: '', extent: 4096, keys: [], vals: [], fp: [] };
      while (s.p < end) {
        const k2 = rv(s), f2 = k2 >> 3, t2 = k2 & 7;
        if (f2 === 1) L.name = str(s);
        else if (f2 === 2) { const n = rv(s); L.fp.push(s.p, s.p + n); s.p += n; }
        else if (f2 === 3) L.keys.push(str(s));
        else if (f2 === 4) { const n = rv(s); L.vals.push(value(s, s.p + n)); }
        else if (f2 === 5) L.extent = rv(s);
        else skip(s, t2);
      }
      s.p = end;
      if (want && want.indexOf(L.name) < 0) continue;
      const feats = [];
      for (let i = 0; i < L.fp.length; i += 2) {
        s.p = L.fp[i];
        const b = L.fp[i + 1], F = { id: null, type: 0, props: {}, geom: null };
        let tags = null, g0 = -1, g1 = -1;
        while (s.p < b) {
          const k3 = rv(s), f3 = k3 >> 3, t3 = k3 & 7;
          if (f3 === 1) F.id = rv(s);
          else if (f3 === 2) { const n = rv(s), e = s.p + n; tags = []; while (s.p < e) tags.push(rv(s)); }
          else if (f3 === 3) F.type = rv(s);
          else if (f3 === 4) { const n = rv(s); g0 = s.p; g1 = s.p + n; s.p = g1; }
          else skip(s, t3);
        }
        if (tags) for (let j = 0; j + 1 < tags.length; j += 2) { const kk = L.keys[tags[j]]; if (kk !== undefined) F.props[kk] = L.vals[tags[j + 1]]; }
        if (g0 >= 0) F.geom = geometry(s, g0, g1);
        feats.push(F);
      }
      layers[L.name] = { extent: L.extent, feats };
      s.p = end;
    }
    return layers;
  };

  /* ---------- 좌표 ---------- */
  const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * Math.pow(2, z));
  const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z)); };
  const tLon = (z, x, px, E) => ((x + px / E) / Math.pow(2, z)) * 360 - 180;
  const tLat = (z, y, py, E) => { const n = Math.PI * (1 - (2 * (y + py / E)) / Math.pow(2, z)); return (Math.atan(Math.sinh(n)) * 180) / Math.PI; };
  /* 범위(위경도 s,w,n,e)를 덮는 타일 목록 */
  O.tilesFor = function (bb, z) {
    z = z || O.Z;
    const x0 = lon2x(bb.w, z), x1 = lon2x(bb.e, z), y0 = lat2y(bb.n, z), y1 = lat2y(bb.s, z), out = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
    return out;
  };
  const ringArea = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

  /* 선을 타일 경계(정확히 0..E)로 자른다. 이웃 타일에도 같은 선이 여유분(버퍼)까지 들어 있으므로, 제 타일 몫만 남겨야 이어 붙일 때 겹치지 않는다 */
  function clipSeg(a, b, x0, y0, x1, y1) {
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1], P = [-dx, dx, -dy, dy], Q = [a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1]];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(P[i]) < 1e-12) { if (Q[i] < 0) return null; continue; }
      const t = Q[i] / P[i];
      if (P[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    if (t1 - t0 < 1e-9) return null;
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
  }
  function clipLine(pts, x0, y0, x1, y1) {
    const out = [];
    let cur = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const sg = clipSeg(pts[i], pts[i + 1], x0, y0, x1, y1);
      if (!sg) { if (cur.length > 1) out.push(cur); cur = []; continue; }
      const l = cur[cur.length - 1];
      if (!l || Math.hypot(l[0] - sg[0][0], l[1] - sg[0][1]) > 1e-6) { if (cur.length > 1) out.push(cur); cur = [sg[0]]; }
      cur.push(sg[1]);
      if (Math.hypot(sg[1][0] - pts[i + 1][0], sg[1][1] - pts[i + 1][1]) > 1e-6) { out.push(cur); cur = []; }
    }
    if (cur.length > 1) out.push(cur);
    return out;
  }
  O.clipLine = clipLine;

  /* ---------- 건물: 용도 부호(브이월드 주용도 코드 꼴)와 층수 어림 ---------- */
  const CLS_CODE = {
    apartments: '02001', dormitory: '02004', residential: '', house: '01001', detached: '01001', dwelling_house: '01001', semidetached_house: '01001', bungalow: '01001', terrace: '02002', static_caravan: '01001', cabin: '01001',
    commercial: '03', retail: '03', kiosk: '03', supermarket: '07', office: '14', hotel: '15',
    school: '10', kindergarten: '11', college: '10', university: '10',
    hospital: '09', church: '06', cathedral: '06', chapel: '06', temple: '06', shrine: '06', mosque: '06', synagogue: '06', monastery: '06', religious: '06', wayside_shrine: '06', presbytery: '06',
    government: '14', civic: '14', public: '05', post_office: '14', fire_station: '14', library: '05', pavilion: '27',
    industrial: '17', factory: '17', manufacture: '17', warehouse: '18', hangar: '18', digester: '22', silo: '18', storage_tank: '19',
    train_station: '08', transportation: '08', parking: '20', garage: '20', garages: '20', carport: '20',
    greenhouse: '21', glasshouse: '21', barn: '21', cowshed: '21', farm_auxiliary: '21', farm: '21', stable: '21', sty: '21', slurry_tank: '21', agricultural: '21',
    sports_hall: '13', sports_centre: '13', stadium: '13', grandstand: '13',
    military: '23', bunker: '23', guardhouse: '23', transformer_tower: '25', service: '25', toilets: '04',
    shed: '18', outbuilding: '18', hut: '18', roof: '', allotment_house: '01001', boathouse: '18',
  };
  const SUB_CODE = { residential: '', commercial: '03', education: '10', medical: '09', religious: '06', civic: '14', entertainment: '05', industrial: '17', transportation: '08', agricultural: '21', military: '23', outbuilding: '18', service: '25' };
  /* 지상 층수 어림(층수·높이 자료가 모두 없을 때): 한국 시가지의 흔한 꼴을 용도와 건축면적으로 */
  const CLS_FL = {
    apartments: 15, dormitory: 5, house: 2, detached: 2, dwelling_house: 2, semidetached_house: 2, bungalow: 1, terrace: 4, cabin: 1, static_caravan: 1,
    retail: 2, kiosk: 1, supermarket: 2, office: 6, hotel: 7, school: 4, kindergarten: 2, college: 5, university: 5, hospital: 6,
    church: 2, cathedral: 2, chapel: 1, temple: 1, shrine: 1, mosque: 2, synagogue: 2, monastery: 2, religious: 2,
    government: 4, civic: 3, public: 3, post_office: 3, fire_station: 3, library: 3, pavilion: 1,
    industrial: 1, factory: 1, manufacture: 1, warehouse: 1, hangar: 1, silo: 3, storage_tank: 1, digester: 1,
    train_station: 2, transportation: 2, parking: 4, garage: 1, garages: 1, carport: 1,
    greenhouse: 1, glasshouse: 1, barn: 1, cowshed: 1, farm_auxiliary: 1, farm: 1, stable: 1, sty: 1, agricultural: 1,
    sports_hall: 2, sports_centre: 3, stadium: 3, grandstand: 2, military: 2, bunker: 1, guardhouse: 1, transformer_tower: 1, service: 1, toilets: 1,
    shed: 1, outbuilding: 1, hut: 1, roof: 1, allotment_house: 1, boathouse: 1,
  };
  O.guessFloors = function (cls, sub, area) {
    if (cls && CLS_FL[cls]) return CLS_FL[cls];
    const a = area || 0;
    if (cls === 'residential' || sub === 'residential') return a < 120 ? 2 : a < 250 ? 3 : a < 450 ? 5 : a < 900 ? 12 : 15;
    if (cls === 'commercial' || sub === 'commercial' || sub === 'entertainment') return a < 150 ? 2 : a < 400 ? 3 : a < 1200 ? 5 : 4;
    if (sub === 'education') return 4;
    if (sub === 'medical') return 5;
    if (sub === 'civic') return 3;
    if (sub === 'industrial' || sub === 'agricultural' || sub === 'outbuilding' || sub === 'service') return 1;
    return a < 50 ? 1 : a < 160 ? 2 : a < 450 ? 3 : 4;
  };
  O.codeOf = function (cls, sub, area) {
    let c = cls && CLS_CODE[cls] !== undefined ? CLS_CODE[cls] : '';
    if (!c && sub && SUB_CODE[sub]) c = SUB_CODE[sub];
    if (!c && (cls === 'residential' || sub === 'residential')) c = (area || 0) >= 400 ? '02' : '01'; // 크면 공동주택, 작으면 단독주택
    return c;
  };
  const numOr = (v) => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x : 0; };

  /* ---------- 도로: 등급별 폭과 걸러 낼 것 ---------- */
  // 전체 폭(m) 어림: 한국 도로 위계(대로 25m 이상 · 중로 12–25m · 소로 8–12m · 골목 4–8m)에 맞춤
  O.ROAD_W = { motorway: 30, trunk: 30, primary: 25, secondary: 20, tertiary: 15, unclassified: 8, residential: 8, living_street: 6, service: 5, pedestrian: 6 };
  O.MAJOR = { motorway: 1, trunk: 1, primary: 1 };
  O.ROAD_NAME = { motorway: '고속도로', trunk: '간선도로', primary: '주간선도로', secondary: '보조간선도로', tertiary: '집산도로', unclassified: '국지도로', residential: '국지도로', living_street: '생활도로', service: '골목길', pedestrian: '보행자도로' };
  const SKIP_SUB = { parking_aisle: 1, driveway: 1, sidewalk: 1, crosswalk: 1 };
  const parseJ = (v) => { if (typeof v !== 'string' || !v) return v || null; try { return JSON.parse(v); } catch (e) { return null; } };
  const hasFlag = (v, f) => typeof v === 'string' && v.indexOf(f) >= 0;
  /* 한 방향 통행(양방향이 나뉜 큰길의 한쪽)인가: access_restrictions에 진행 방향 하나를 막는 규칙이 있음 */
  const oneWay = (p) => { const a = p.access_restrictions; return typeof a === 'string' && /"denied"/.test(a) && /"heading"\s*:\s*"(forward|backward)"/.test(a) && !/"using"|"recognized"|"mode"/.test(a); };
  /* 이름: 한글 이름(names.common.ko)을 먼저, 없으면 대표 이름 */
  function nameOf(p) {
    const n = parseJ(p.names), ko = n && n.common && n.common.ko;
    return String(ko || p['@name'] || '').trim();
  }
  O.nameOf = nameOf;
  function widthOf(p) {
    const w = parseJ(p.width_rules);
    if (Array.isArray(w)) { const v = w.map((r) => +(r && r.value)).filter((x) => x > 2 && x < 80); if (v.length) return Math.max(...v); }
    return 0;
  }

  /* ---------- 범위 안의 자료 받기 ----------
     bb: { s, w, n, e } 위경도. o: { roads: true, rail: true, onStep(text) }
     반환 { rel, bld: GeoJSON 지형지물(브이월드 건물 속성 꼴), segs: [{ cls, sub, name, w, ow, major, pts:[[경도,위도]…] }], rails: [...], tiles } */
  O.fetchArea = async function (bb, o) {
    o = o || {};
    const say = (t) => { if (o.onStep) try { o.onStep(t); } catch (e) { /* 무시 */ } };
    let rel = await O.release();
    const arch = (name) => { const k = rel + '/' + name; O._arch = O._arch || new Map(); if (!O._arch.has(k)) O._arch.set(k, new Archive(O.BASE + rel + '/' + name + '.pmtiles')); return O._arch.get(k); };
    try { await arch('buildings').head(); }
    catch (e) {
      if (rel !== O.FALLBACK) { rel = O._rel = O.FALLBACK; await arch('buildings').head(); } // 최근 배포판 파일이 아직 없으면 정해 둔 것으로
      else throw e;
    }
    const T = O.tilesFor(bb);
    if (T.length > 16) throw new Error('범위가 너무 큽니다.');
    const out = { rel, bld: [], segs: [], rails: [], tiles: T.length, attr: O.ATTR };
    const best = new Map(); // 건물 식별자 → 가장 큰 조각(타일 경계에 걸친 건물은 이웃 타일에도 잘려 들어 있다)
    let done = 0;
    const kinds = ['buildings'].concat(o.roads === false ? [] : ['transportation']);
    say(`자료 받는 중… 0/${T.length * kinds.length}`);
    await Promise.all(T.map(async (t) => {
      for (const kind of kinds) {
        const raw = await arch(kind).tile(t.z, t.x, t.y);
        done++; say(`자료 받는 중… ${done}/${T.length * kinds.length}`);
        if (!raw) continue;
        if (kind === 'buildings') {
          const L = O.decode(raw, ['building']).building;
          if (L) L.feats.forEach((F) => { const f = bldOf(F, t, L.extent); if (!f) return; const b = best.get(f.id); if (!b || b._a < f._a) best.set(f.id, f); });
        } else {
          const L = O.decode(raw, ['segment']).segment;
          if (L) L.feats.forEach((F) => segOf(F, t, L.extent, out, o));
        }
      }
    }));
    best.forEach((f) => { delete f._a; out.bld.push(f); });
    return out;
  };
  function toLL(t, E, pts) { return pts.map((q) => [U.round(tLon(t.z, t.x, q[0], E), 7), U.round(tLat(t.z, t.y, q[1], E), 7)]); }
  function bldOf(F, t, E) {
    if (F.type !== 3 || !F.geom) return null;
    const p = F.props;
    if (p.is_underground === true || p.is_underground === 'true') return null;
    const polys = [];
    F.geom.forEach((r) => {
      if (r.length < 4) return;
      const a = ringArea(r);
      if (a > 0 || !polys.length) polys.push({ rings: [r], a: Math.abs(a) });
      else { polys[polys.length - 1].rings.push(r); polys[polys.length - 1].a -= Math.abs(a); }
    });
    if (!polys.length) return null;
    const A = polys.reduce((s, q) => s + q.a, 0);
    const mpu = (40075016.7 * Math.cos((tLat(t.z, t.y, E / 2, E) * Math.PI) / 180)) / Math.pow(2, t.z) / E; // 타일 단위 하나의 길이(m)
    const area = A * mpu * mpu;
    const cls = p.class || '', sub = p.subtype || '';
    const fl = numOr(p.num_floors), h = numOr(p.height);
    const props = {
      gis_idntfc_no: String(p.id || F.id || ''), buld_nm: nameOf(p),
      ground_floor_co: fl ? Math.round(fl) : '', undgrnd_floor_co: numOr(p.num_floors_underground) ? Math.round(numOr(p.num_floors_underground)) : '',
      hg: h ? U.round(h, 1) : '', buld_prpos_code: O.codeOf(cls, sub, area), ovt_cls: cls, ovt_sub: sub,
    };
    if (!fl && !h) props._fl = O.guessFloors(cls, sub, area);
    return { type: 'Feature', id: props.gis_idntfc_no || 'ovt_' + t.x + '_' + t.y + '_' + F.id, _a: A, properties: props, geometry: { type: 'MultiPolygon', coordinates: polys.map((q) => q.rings.map((r) => toLL(t, E, r))) } };
  }
  function segOf(F, t, E, out, o) {
    if (F.type !== 2 || !F.geom) return;
    const p = F.props, sub = p.subtype;
    const rail = sub === 'rail';
    if (sub !== 'road' && !rail) return;
    if (rail && o.rail === false) return;
    const flags = String(p.road_flags || '') + String(p.rail_flags || '');
    if (hasFlag(flags, 'is_tunnel') || hasFlag(flags, 'is_under_construction') || hasFlag(flags, 'is_abandoned') || hasFlag(flags, 'is_indoor')) return;
    const cls = String(p.class || ''), sc = String(p.subclass || '');
    let rec;
    if (rail) {
      if (/subway|tram|funicular|monorail/.test(cls)) return;
      rec = { cls, rail: 1 };
    } else {
      if (!(cls in O.ROAD_W) || SKIP_SUB[sc]) return;
      if (cls === 'service' && o.service === false) return;
      if (hasFlag(flags, 'is_link') && O.MAJOR[cls]) return; // 큰길의 진입·진출 연결로
      const ow = oneWay(p);
      rec = { cls, sub: sc, name: nameOf(p), w: widthOf(p), ow: ow ? 1 : 0, major: O.MAJOR[cls] ? 1 : 0, br: hasFlag(flags, 'is_bridge') ? 1 : 0 };
    }
    F.geom.forEach((ln) => clipLine(ln, 0, 0, E, E).forEach((q) => { if (q.length > 1) (rail ? out.rails : out.segs).push({ ...rec, id: String(p.id || ''), pts: toLL(t, E, q) }); }));
  }

  /* ---------- 받은 도로 중심선 → 대상지 도로망 ----------
     타일마다 잘린 조각과 교차점마다 나뉜 구간을 같은 이름·등급끼리 이어 붙이고(1), 따로 그려진 양방향 차도 한 쌍은 가운데 선 하나로 합친다(3),
     작은 원형 고리는 회전교차로로 바꾼다(2). 그 뒤 점을 줄이고 대상지 경계로 자른다.
     segs: fetchArea의 segs, F: X.frame. 반환 { streets: [{ pts(대상지 m), w(전체 폭 m), major, cls, name, len }], rabs: [{ p, d }] } */
  O.streets = function (segs, F, opt) {
    opt = opt || {};
    const X = UDS.Ctx, W = F.W, H = F.H, M = 40;
    const SN = 0.7; // 끝점을 같은 점으로 볼 거리(m)
    const raw = [];
    segs.forEach((s) => {
      const pts = s.pts.map((q) => X.toXY(F, q[0], q[1]));
      clipLine(pts, -M, -M, W + M, H + M).forEach((q) => { if (q.length > 1) raw.push({ s, pts: q }); });
    });
    // 끝점 모으기(가까운 점은 한 점으로)
    const nodes = [], grid = new Map();
    const nodeAt = (p) => {
      const cx = Math.floor(p[0] / 2), cy = Math.floor(p[1] / 2);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const l = grid.get(cx + i + ',' + (cy + j)); if (!l) continue;
        for (const n of l) if (Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) < SN) { let m = n; while (m.alias) m = m.alias; return m; }
      }
      const n = { id: nodes.length, p: [p[0], p[1]], e: [] };
      nodes.push(n);
      const k = cx + ',' + cy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n);
      return n;
    };
    const mkEdge = (pts, s) => {
      const a = nodeAt(pts[0]), b = nodeAt(pts[pts.length - 1]);
      const q = pts.slice(); q[0] = a.p; q[q.length - 1] = b.p;
      if (a === b && q.length < 4) return null;
      const e = { a, b, pts: q, s };
      a.e.push(e); b.e.push(e);
      return e;
    };
    const drop = (e) => { [e.a, e.b].forEach((n) => { const k = n.e.indexOf(e); if (k >= 0) n.e.splice(k, 1); }); };
    let edges = raw.map((r) => mkEdge(r.pts, r.s)).filter(Boolean);
    const lenOf = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
    const dirAt = (e, n) => { const P = e.pts, k = e.a === n ? 0 : P.length - 1, j = e.a === n ? 1 : P.length - 2; const d = [P[j][0] - P[k][0], P[j][1] - P[k][1]], L = Math.hypot(d[0], d[1]) || 1; return [d[0] / L, d[1] / L]; };
    /* (1) 차수 2인 점에서 같은 길(등급·이름·통행 방향이 같고 50° 넘게 꺾이지 않음)끼리 잇는다 */
    // 이름이 같거나 한쪽에 한글 이름이 없으면(이름 없음·로마자 표기) 같은 길로 볼 수 있다
    const hk = (s) => (/[가-힣]/.test(s.name || '') ? s.name : '');
    const sameName = (a, b) => { const x = hk(a), y = hk(b); return !x || !y || x === y; };
    const same = (e1, e2) => e1.s.cls === e2.s.cls && sameName(e1.s, e2.s) && !!e1.s.ow === !!e2.s.ow;
    const better = (a, b) => (hk(b) && !hk(a) ? b : a); // 한글 이름이 있는 쪽의 속성을 남긴다
    const chainAll = () => {
      edges.forEach((e) => { e.used = false; });
      const out = [];
      edges.forEach((e0) => {
        if (e0.used) return;
        e0.used = true;
        let pts = e0.pts.slice(), A = e0.a, B = e0.b, last = { atEnd: e0, atStart: e0 }, sa = e0.s;
        const ext = (atEnd) => {
          for (let guard = 0; guard < 500; guard++) {
            const n = atEnd ? B : A, cur = atEnd ? last.atEnd : last.atStart;
            if (n.e.length !== 2 || A === B) return;
            const nx = n.e[0] === cur ? n.e[1] : n.e[0];
            if (!nx || nx.used || !same(cur, nx)) return;
            const d1 = dirAt(cur, n), d2 = dirAt(nx, n);
            if (d1[0] * d2[0] + d1[1] * d2[1] > -0.64) return;
            nx.used = true; sa = better(sa, nx.s);
            const q = nx.pts.slice(); if (nx.b === n) q.reverse();
            const far = nx.a === n ? nx.b : nx.a;
            if (atEnd) { pts = pts.concat(q.slice(1)); B = far; last.atEnd = nx; } else { pts = q.reverse().concat(pts.slice(1)); A = far; last.atStart = nx; }
          }
        };
        ext(true); ext(false);
        out.push({ pts, s: sa, a: A, b: B });
      });
      // 이은 결과로 변 목록을 바꾼다
      edges.forEach(drop);
      edges = out.map((c) => { const e = { a: c.a, b: c.b, pts: c.pts, s: c.s }; c.a.e.push(e); c.b.e.push(e); return e; });
    };
    chainAll();
    /* (2) 회전교차로: 짧은 호들이 이룬 고리가 원에 가까우면(반지름 6–35m, 모서리 없음) 원 중심으로 길을 모은다 */
    const rabs = [], rabNodes = [];
    const shortE = new Set(edges.filter((e) => lenOf(e.pts) <= 160));
    const inLoop = new Set();
    const ringPts = (path) => { // 고리를 이루는 호들의 점을 차례로
      let n = path[0].a, pts = [];
      path.forEach((x) => { const q = x.pts.slice(); if (x.b === n) q.reverse(); pts = pts.length ? pts.concat(q.slice(1)) : q; n = x.a === n ? x.b : x.a; });
      if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
      return pts;
    };
    const circle = (pts) => { // 원에 가까우면 { c, r }
      if (pts.length < 6) return null;
      const A2 = U.polyArea(pts); if (Math.abs(A2) < 30) return null;
      const c = U.polyCentroid(A2 > 0 ? pts : pts.slice().reverse());
      const ds = pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])), r = ds.reduce((x, y) => x + y, 0) / ds.length;
      if (r < 6 || r > 35 || (Math.max(...ds) - Math.min(...ds)) / r > 0.35) return null;
      for (let i = 0; i < pts.length; i++) { // 모서리(급히 꺾이는 점)가 있으면 원이 아님
        const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], d = pts[(i + 1) % pts.length];
        const u = [b[0] - a[0], b[1] - a[1]], v = [d[0] - b[0], d[1] - b[1]], lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
        if (lu > 0.5 && lv > 0.5 && (u[0] * v[0] + u[1] * v[1]) / (lu * lv) < 0.5) return null;
      }
      return { c, r };
    };
    shortE.forEach((e0) => {
      if (inLoop.has(e0)) return;
      // e0에서 출발해 같은 쪽으로 도는 짧은 호를 따라 처음 점으로 돌아오는 길을 찾는다(깊이 우선, 둘레 230m·12개까지)
      let found = null;
      const st = [{ e: e0, n: e0.b, path: [e0], L: lenOf(e0.pts), sg: 0 }];
      let guard = 0;
      while (st.length && !found && guard++ < 4000) {
        const t = st.pop();
        if (t.n === e0.a) { const cc = circle(ringPts(t.path)); if (cc) found = { path: t.path, ...cc }; continue; }
        if (t.path.length >= 12 || t.L > 230) continue;
        const din = dirAt(t.e, t.n);
        t.n.e.forEach((x) => {
          if (x === t.e || !shortE.has(x) || inLoop.has(x) || t.path.includes(x)) return;
          const dx = dirAt(x, t.n), c = -(din[0] * dx[0] + din[1] * dx[1]);
          if (c < 0.5) return; // 60° 넘게 꺾이면 고리를 잇는 호가 아님
          const cr = din[1] * dx[0] - din[0] * dx[1]; // 꺾이는 쪽(왼쪽 +)
          if (t.sg && cr * t.sg < -0.12) return; // 지금까지와 반대쪽으로 꺾임
          st.push({ e: x, n: x.a === t.n ? x.b : x.a, path: t.path.concat([x]), L: t.L + lenOf(x.pts), sg: t.sg || (Math.abs(cr) > 0.12 ? Math.sign(cr) : 0) });
        });
      }
      if (!found) return;
      const loop = found.path, c = found.c, r = found.r;
      loop.forEach((x) => inLoop.add(x));
      // 고리 위의 점에 닿은 다른 길은 끝을 원 중심까지 늘인다
      const ringNodes = new Set(); loop.forEach((x) => { ringNodes.add(x.a); ringNodes.add(x.b); });
      loop.forEach((x) => { drop(x); });
      edges = edges.filter((x) => !loop.includes(x));
      const C = nodeAt(c);
      ringNodes.forEach((rn) => rn.e.slice().forEach((x) => {
        drop(x);
        if (x.a === rn) { x.pts = [C.p].concat(x.pts); x.a = C; }
        if (x.b === rn) { x.pts = x.pts.concat([C.p]); x.b = C; }
        x.a.e.push(x); x.b.e.push(x);
      }));
      rabs.push({ p: [U.round(c[0], 2), U.round(c[1], 2)], d: U.clamp(Math.round(2 * (r + 2.75)), 16, 60) });
      rabNodes.push({ C, r });
    });
    /* (2-b) 회전교차로 팔 정리: 한 방향에서 들어오는 여러 갈래(진입로·진출로가 따로 그려진 것, 나란한 샛길)를 곧은 한 갈래로 묶고,
       바깥 끝이 다른 길과 닿지 않는 짧은 꼬리는 버린다. 갈래들의 바깥 끝 점은 한 점(가운데)으로 모은다 */
    const along = (e, from, dist) => { // e를 from 쪽 끝에서 dist(m)만큼 간 점
      const P = e.a === from ? e.pts : e.pts.slice().reverse();
      let acc = 0;
      for (let i = 1; i < P.length; i++) {
        const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
        if (acc + L >= dist) { const t = (dist - acc) / (L || 1); return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t]; }
        acc += L;
      }
      return P[P.length - 1];
    };
    const relink = (e, from, to) => { // e의 from 끝을 to 점으로
      drop(e);
      if (e.a === from) { e.a = to; e.pts = [to.p].concat(e.pts.slice(1)); }
      if (e.b === from) { e.b = to; e.pts = e.pts.slice(0, -1).concat([to.p]); }
      e.a.e.push(e); e.b.e.push(e);
    };
    const mergeNodes = (N1, N2) => { // N2를 N1에 합치고 N1을 두 점의 가운데로
      const mid = [(N1.p[0] + N2.p[0]) / 2, (N1.p[1] + N2.p[1]) / 2];
      N2.e.slice().forEach((e) => relink(e, N2, N1));
      N2.alias = N1;
      N1.p[0] = mid[0]; N1.p[1] = mid[1];
      N1.e.forEach((e) => { if (e.a === N1) e.pts[0] = N1.p; if (e.b === N1) e.pts[e.pts.length - 1] = N1.p; });
      return N1;
    };
    const rank = (e) => (e.s.ow ? 0 : 1000) + (O.ROAD_W[e.s.cls] || 0) * 10 + (/[가-힣]/.test(e.s.name || '') ? 5 : 0); // 양방향 > 넓은 등급 > 한글 이름
    rabNodes.forEach(({ C, r }) => {
      const kill = (e) => { drop(e); edges = edges.filter((x) => x !== e); };
      C.e.slice().forEach((e) => { const far = e.a === C ? e.b : e.a; if (far !== C && far.e.length === 1 && lenOf(e.pts) < r + 14) kill(e); });
      for (let guard = 0; guard < 12; guard++) {
        const arms = C.e.filter((e) => e.a !== e.b).map((e) => { const far = e.a === C ? e.b : e.a, q = along(e, C, r + 10); return { e, far, ang: Math.atan2(q[1] - C.p[1], q[0] - C.p[0]) }; });
        let pair = null;
        for (let i = 0; i < arms.length && !pair; i++) for (let j = i + 1; j < arms.length && !pair; j++) {
          let da = Math.abs(arms[i].ang - arms[j].ang); if (da > Math.PI) da = 2 * Math.PI - da;
          const dfar = Math.hypot(arms[i].far.p[0] - arms[j].far.p[0], arms[i].far.p[1] - arms[j].far.p[1]);
          if (da < 0.7 && dfar < 35 && arms[i].far !== C && arms[j].far !== C) pair = [arms[i], arms[j]];
        }
        if (!pair) break;
        const [A, B] = pair;
        const M = A.far === B.far ? A.far : mergeNodes(A.far, B.far);
        const keep = rank(A.e) >= rank(B.e) ? A.e : B.e, lose = keep === A.e ? B.e : A.e;
        kill(lose);
        drop(keep);
        keep.pts = keep.a === C ? [C.p, M.p] : [M.p, C.p];
        if (keep.a === C) keep.b = M; else keep.a = M;
        keep.s = { ...keep.s, ow: 0 };
        keep.a.e.push(keep); keep.b.e.push(keep);
      }
      // 고리 둘레를 감싸는 짧은 샛길(이웃한 입구끼리 잇는 우회전 연결로 등): 두 끝이 모두 원 가까이(r+35m 안)에 있고 원 중심에 닿지 않는 짧은 길은 버린다
      const nearC = (n) => Math.hypot(n.p[0] - C.p[0], n.p[1] - C.p[1]) < r + 35;
      edges.filter((e) => e.a !== C && e.b !== C && nearC(e.a) && nearC(e.b) && lenOf(e.pts) < 90).forEach(kill);
    });
    if (rabNodes.length) chainAll();
    /* (3) 양방향이 따로 그려진 길(한 방향 통행 둘이 나란히, 서로 반대로 달림)을 가운데 선 하나로 */
    const SEP = { motorway: 45, trunk: 45, primary: 40, secondary: 32, tertiary: 26 };
    const near = (p, pts) => { // 꺾은선 위의 가장 가까운 점과 그 구간의 방향
      let best = null;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], d = [b[0] - a[0], b[1] - a[1]], L2 = d[0] * d[0] + d[1] * d[1] || 1e-9;
        const t = U.clamp(((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2, 0, 1), q = [a[0] + d[0] * t, a[1] + d[1] * t], dd = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (!best || dd < best.d) { const L = Math.sqrt(L2); best = { d: dd, q, u: [d[0] / L, d[1] / L] }; }
      }
      return best;
    };
    const resample = (pts, step) => {
      const out = [pts[0]];
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let t = step - acc;
        while (t < L) { out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]); t += step; }
        acc = (acc + L) % step;
      }
      const z = pts[pts.length - 1], l = out[out.length - 1];
      if (Math.hypot(z[0] - l[0], z[1] - l[1]) > 0.5) out.push(z);
      return out;
    };
    const pairInfo = (A, B, sep) => { // A의 표본점 가운데 B와 짝이 되는(가깝고 반대로 달리는) 비율과 평균 간격
      const S = resample(A.pts, 4);
      let ok = 0, dsum = 0;
      for (let i = 0; i < S.length; i++) {
        const p = S[i], j = Math.min(i + 1, S.length - 1), k = Math.max(i - 1, 0);
        const ua = [S[j][0] - S[k][0], S[j][1] - S[k][1]], la = Math.hypot(ua[0], ua[1]) || 1;
        const nb = near(p, B.pts);
        if (nb && nb.d <= sep && nb.d >= 2 && (ua[0] * nb.u[0] + ua[1] * nb.u[1]) / la < -0.8) { ok++; dsum += nb.d; }
      }
      return { f: S.length ? ok / S.length : 0, sep: ok ? dsum / ok : 0, S };
    };
    const chord = (pts) => Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]);
    const ows = edges.filter((e) => { const L = lenOf(e.pts); return e.s.ow && SEP[e.s.cls] && L >= 12 && L <= 1.3 * chord(e.pts); }); // 굽은 고리(회전교차로 둘레 등)는 빼고
    const bbOf = (pts, m) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; pts.forEach((p) => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }); return [x0 - m, y0 - m, x1 + m, y1 + m]; };
    const paired = new Set();
    let nDual = 0;
    ows.forEach((A) => {
      if (paired.has(A)) return;
      const sep = SEP[A.s.cls], ba = bbOf(A.pts, sep);
      let best = null;
      ows.forEach((B) => {
        if (B === A || paired.has(B) || B.s.cls !== A.s.cls || !sameName(A.s, B.s)) return;
        const bb = bbOf(B.pts, 0);
        if (bb[0] > ba[2] || bb[2] < ba[0] || bb[1] > ba[3] || bb[3] < ba[1]) return;
        const ia = pairInfo(A, B, sep); if (ia.f < 0.6) return;
        const ib = pairInfo(B, A, sep); if (ib.f < 0.6) return;
        const sc = ia.f + ib.f;
        if (!best || sc > best.sc) best = { B, ia, ib, sc };
      });
      if (!best) return;
      const B = best.B;
      // 가운데 선: 더 긴 쪽의 표본점마다 짝의 가장 가까운 점과의 가운데
      const base = lenOf(A.pts) >= lenOf(B.pts) ? A : B, other = base === A ? B : A;
      const S = base === A ? best.ia.S : best.ib.S;
      const mid = [];
      S.forEach((p) => { const nb = near(p, other.pts); if (nb && nb.d <= sep * 1.25) mid.push([(p[0] + nb.q[0]) / 2, (p[1] + nb.q[1]) / 2]); });
      if (mid.length < 2) return;
      paired.add(A); paired.add(B);
      drop(A); drop(B);
      edges = edges.filter((e) => e !== A && e !== B);
      const sepAvg = (best.ia.sep + best.ib.sep) / 2;
      const s = { ...better(base.s, other.s), ow: 0, w: Math.max(O.ROAD_W[base.s.cls] || 15, Math.round(sepAvg + 0.5 * (O.ROAD_W[base.s.cls] || 15))), dual: 1 };
      const e = mkEdge(mid, s); if (e) edges.push(e);
      // 두 차도가 끝나는 점(가로지르는 길 위)과 가운데 선의 끝을 잇는다: 가운데 선 끝을 가장 가까운 끝점 쪽 교차로 사이 가운데에 둔다
      nDual++;
    });
    if (nDual) chainAll();
    /* (4) 점 줄이기(더글러스-포이커), 대상지 경계로 자르기 */
    let res = [];
    edges.forEach((e) => {
      const s = e.s, pts = dp(e.pts, opt.tol || 0.8);
      const w = s.w || O.ROAD_W[s.cls] || 8;
      clipLine(pts, 0, 0, W, H).forEach((q) => {
        const L = lenOf(q);
        if (L < 1) return;
        res.push({ pts: q.map((p) => [U.round(p[0], 2), U.round(p[1], 2)]), w, major: !!s.major || w >= 25, cls: s.cls, name: s.name, len: L, dual: s.dual ? 1 : 0 });
      });
    });
    /* (5) 다른 길과 닿지 않는 짧은 조각(막다른 서비스 길 끝 등) 버리기 */
    const key = (p) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
    const onEdge = (p) => p[0] < 0.05 || p[1] < 0.05 || p[0] > W - 0.05 || p[1] > H - 0.05;
    const nearRab = (p) => rabs.some((rb) => Math.hypot(rb.p[0] - p[0], rb.p[1] - p[1]) < 1);
    for (let pass = 0; pass < 3; pass++) {
      const cnt = new Map();
      res.forEach((s) => [s.pts[0], s.pts[s.pts.length - 1]].forEach((p) => cnt.set(key(p), (cnt.get(key(p)) || 0) + 1)));
      const touches = (p, self) => res.some((o) => o !== self && o.pts.some((q, i) => i > 0 && i < o.pts.length - 1 && Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.8));
      const linked = (p, s) => onEdge(p) || nearRab(p) || cnt.get(key(p)) > 1 || touches(p, s);
      const n0 = res.length;
      res = res.filter((s) => s.len >= 25 || (linked(s.pts[0], s) && linked(s.pts[s.pts.length - 1], s)) || (s.len >= 10 && (linked(s.pts[0], s) || linked(s.pts[s.pts.length - 1], s))));
      if (res.length === n0) break;
    }
    res.sort((a, b) => b.w - a.w || b.len - a.len);
    const inSite = (p) => p[0] > 1 && p[1] > 1 && p[0] < W - 1 && p[1] < H - 1;
    return { streets: res, rabs: rabs.filter((rb) => inSite(rb.p)), dual: nDual };
  };
  function dp(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop();
      let md = 0, mi = -1;
      const A = pts[a], B = pts[b], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      for (let i = a + 1; i < b; i++) {
        const P = pts[i];
        const d = L < 1e-9 ? Math.hypot(P[0] - A[0], P[1] - A[1]) : Math.abs((B[0] - A[0]) * (A[1] - P[1]) - (A[0] - P[0]) * (B[1] - A[1])) / L;
        if (d > md) { md = d; mi = i; }
      }
      if (mi > 0 && md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  O.dp = dp;

  /* ---------- 철도: 선로 양쪽으로 폭을 둔 띠(지목 '철'의 필지처럼 바탕에 칠함) ---------- */
  O.railParcels = function (rails, F) {
    const X = UDS.Ctx, W = F.W, H = F.H, hw = 3.5, out = [];
    rails.forEach((r, k) => {
      const pts = dp(r.pts.map((q) => X.toXY(F, q[0], q[1])), 0.6);
      clipLine(pts, -10, -10, W + 10, H + 10).forEach((q) => {
        for (let i = 0; i + 1 < q.length; i++) {
          const a = q[i], b = q[i + 1], d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]);
          if (L < 0.5) continue;
          const n = [(-d[1] / L) * hw, (d[0] / L) * hw];
          let poly = [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]];
          [[[0, 0], [1, 0]], [[W, 0], [-1, 0]], [[0, 0], [0, 1]], [[0, H], [0, -1]]].forEach(([p0, nn]) => { if (poly.length >= 3) poly = U.clipHalfPlane(poly, p0, nn); });
          if (poly.length < 3 || Math.abs(U.polyArea(poly)) < 0.5) continue;
          if (U.polyArea(poly) < 0) poly.reverse();
          out.push({ id: 'rail' + k + '_' + out.length, jm: '철', no: '', pnu: '', parts: [{ o: poly.map((p) => [U.round(p[0], 2), U.round(p[1], 2)]), h: [] }] });
        }
      });
    });
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
