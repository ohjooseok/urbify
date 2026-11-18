/* 도로 이음새 고치기(overture.js O.streets 3-b) 검사: 위경도로 바꾼 가짜 구간으로
   (1) 어긋난 십자로(두 교차점 5.9m)와 갈라졌다 다시 만나는 짧은 두 갈래 → 한 교차점, 겹친 갈래 하나만
   (2) 같은 길이 3m 끊긴 것 → 한 길로
   (3) 다른 길 3m 앞에서 끊긴 끝 → 그 길 위(T자)에 닿음, 그 길은 나누지 않음
   (4) 서로 멀리 떨어진 막다른 끝(12m)은 그대로
   (5)~(8) 겹친 길 풀기: 머리-꼬리 겹침, 거의 같은 자리, 옆으로 비킨 끝, 이름이 같고 4.5m 비킨 머리-꼬리(교차점 끝) */
const fs = require('fs');
global.window = global; global.document = { createElement: () => ({ getContext: () => null }) };
global.localStorage = { getItem: () => null, setItem: () => {} };
['util', 'catalog', 'ctx', 'overture'].forEach((n) => eval(fs.readFileSync(__dirname + '/../src/js/' + n + '.js', 'utf8')));
const U = UDS.U, X = UDS.Ctx, O = UDS.Ovt;
const F = X.frame(36.6, 127.3, 600, 400);
const ll = (x, y) => [F.lon + (x - F.W / 2) / F.mLon, F.lat + (y - F.H / 2) / F.mLat];
const seg = (pts, cls, name) => ({ cls, name: name || '', ow: 0, pts: pts.map(([x, y]) => ll(x, y)) });
const S = [
  // (1) 어긋길: 서쪽 본선 A(300,200)까지, A에서 두 갈래가 B1(325,205)·B2(323,199.5)로. B1은 북쪽 길, B2는 남쪽 길과 동쪽 본선
  seg([[100, 200], [300, 200]], 'tertiary', '어긋길'),
  seg([[300, 200], [325, 205]], 'residential'),
  seg([[300, 200], [323, 199.5]], 'tertiary', '어긋길'),
  seg([[325, 205], [330, 300]], 'residential', '북쪽길'),
  seg([[323, 199.5], [320, 120]], 'residential', '남쪽길'),
  seg([[323, 199.5], [500, 200]], 'tertiary', '어긋길'),
  // (2) 3m 끊긴 같은 길
  seg([[100, 350], [250, 350]], 'residential', '틈새길'),
  seg([[253, 350], [400, 350]], 'residential', '틈새길'),
  // (3) 다른 길(가로길, y=60) 3m 앞에서 끊긴 끝
  seg([[50, 60], [550, 60]], 'residential', '가로길'),
  seg([[200, 150], [200, 63]], 'residential', '세로길'),
  // (4) 12m 떨어진 두 막다른 끝(잇지 않음)
  seg([[420, 300], [480, 300]], 'residential', '막다른길1'),
  seg([[492, 300], [560, 300]], 'residential', '막다른길2'),
  // (5) 머리-꼬리로 15m 겹친 같은 길(옆으로 2m 비킴): 양방향 차도를 가운데 선으로 합친 끝에서 생기는 모양
  seg([[20, 20], [250, 20]], 'tertiary', '겹침로'),
  seg([[235, 22], [450, 22]], 'tertiary', '겹침로'),
  // (6) 거의 같은 자리에 겹친 두 길(1.5m): 짧은 쪽을 지움
  seg([[50, 380], [300, 380]], 'secondary', '쌍둥이길'),
  seg([[60, 381.5], [280, 381.5]], 'secondary', '쌍둥이길'),
  // (7) 끝이 옆으로 3m 비켜 이어지는 같은 길
  seg([[350, 380], [450, 380]], 'residential', '옆끝길'),
  seg([[450, 383], [560, 383]], 'residential', '옆끝길'),
  // (8) 머리-꼬리로 14m 겹치고 옆으로 4.5m 비킨 같은 길(폭 15m, 1/4 폭보다 멂), 위쪽 길 끝 v는 곁길이 만나는 교차점
  seg([[585, 100], [585, 240]], 'tertiary', '비킴로'),
  seg([[585, 240], [550, 245]], 'residential', '곁길'),
  seg([[589.5, 226], [589.5, 340]], 'tertiary', '비킴로'),
  // (9) (8)을 뒤집은 순서: 교차점 끝이 나중에 나오는 길에 있음(교차점에 달린 곁길을 남는 길 위로 옮겨 잇는지)
  seg([[34.5, 196], [34.5, 330]], 'tertiary', '비킴2로'),
  seg([[30, 90], [30, 210]], 'tertiary', '비킴2로'),
  seg([[30, 210], [5, 212]], 'residential', '곁길2'),
];
const R = O.streets(S, F);
const near = (p, q, d) => Math.hypot(p[0] - q[0], p[1] - q[1]) < (d || 0.6);
let ok = true;
const check = (m, c, info) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (info !== undefined ? '  ' + JSON.stringify(info) : '')); if (!c) ok = false; };
const ends = (s) => [s.pts[0], s.pts[s.pts.length - 1]];
// (1)
const M = [324, 202.25];
const atM = R.streets.filter((s) => ends(s).some((p) => near(p, M, 1.5)));
check('staggered junction merged into one 4-way node', atM.length === 4, atM.map((s) => s.name + ':' + ends(s).map((p) => p.map((v) => Math.round(v)).join(',')).join('→')));
check('duplicate short branch dropped', !R.streets.some((s) => !s.name && s.len < 40 && ends(s).some((p) => near(p, [300, 200], 1))), R.streets.filter((s) => s.len < 40).map((s) => s.name || s.cls));
const west = R.streets.find((s) => s.name === '어긋길' && ends(s).some((p) => near(p, [100, 200], 1)));
check('west part runs straight into the junction', west && ends(west).some((p) => near(p, M, 1.5)), west && ends(west));
// (2)
const gap = R.streets.filter((s) => s.name === '틈새길');
check('3m gap in the same road closed (one road)', gap.length === 1 && Math.abs(gap[0].len - 300) < 4, gap.map((s) => Math.round(s.len)));
// (3)
const cross = R.streets.filter((s) => s.name === '가로길'), vert = R.streets.find((s) => s.name === '세로길');
const tEnd = vert && ends(vert).find((p) => p[1] < 100);
check('dangling end pinned onto road ahead (T)', tEnd && Math.abs(tEnd[1] - 60) < 0.05, tEnd);
check('through road kept whole', cross.length === 1 && Math.abs(cross[0].len - 500) < 1, cross.map((s) => Math.round(s.len)));
// (4)
const dd = R.streets.filter((s) => /^막다른길/.test(s.name));
check('far dead ends left alone', dd.length === 2 && dd.every((s) => Math.abs(s.len - (s.name === '막다른길1' ? 60 : 68)) < 1), dd.map((s) => s.name + ':' + Math.round(s.len)));
// (5)~(7)
const ov = R.streets.filter((s) => s.name === '겹침로');
check('head-tail overlap joined into one road', ov.length === 1 && Math.abs(ov[0].len - 430) < 4, ov.map((s) => Math.round(s.len)));
const tw = R.streets.filter((s) => s.name === '쌍둥이길');
check('near-duplicate road removed', tw.length === 1 && Math.abs(tw[0].len - 250) < 2, tw.map((s) => Math.round(s.len)));
const sd = R.streets.filter((s) => s.name === '옆끝길');
check('side-by-side ends joined', sd.length === 1 && Math.abs(sd[0].len - 210) < 4, sd.map((s) => Math.round(s.len)));
// (8)
const bk = R.streets.filter((s) => s.name === '비킴로'), gs = R.streets.find((s) => s.name === '곁길');
const bkLen = bk.reduce((s, x) => s + x.len, 0), bkJoined = bk.length === 1 || (bk.length === 2 && ends(bk[0]).some((p) => ends(bk[1]).some((q) => near(p, q))));
check('offset head-tail overlap (same name, 4.5m) cut and joined (no double stretch)', bkJoined && Math.abs(bkLen - 240) < 4, bk.map((s) => Math.round(s.len)));
const gEnd = gs && ends(gs).find((p) => p[0] > 570);
const onRoad = (p, s) => s.pts.some((q, i) => i > 0 && U.distPointSeg(p, s.pts[i - 1], q).d < 0.8);
check('side road at the junction still meets the road', !!(gEnd && bk.some((s) => onRoad(gEnd, s))), gEnd);
// (9)
const bk2 = R.streets.filter((s) => s.name === '비킴2로'), gs2 = R.streets.find((s) => s.name === '곁길2');
const bk2Len = bk2.reduce((s, x) => s + x.len, 0), bk2Joined = bk2.length === 1 || (bk2.length === 2 && ends(bk2[0]).some((p) => ends(bk2[1]).some((q) => near(p, q))));
check('reversed order: overlap cut and joined', bk2Joined && Math.abs(bk2Len - 240) < 4, bk2.map((s) => Math.round(s.len)));
const gEnd2 = gs2 && ends(gs2).find((p) => p[0] > 20);
check('reversed order: side road still meets the road', !!(gEnd2 && bk2.some((s) => onRoad(gEnd2, s))), gEnd2);
// 겹침 없음: 어떤 두 길도 폭의 1/4 안에서 10m 넘게 나란히 붙어 가지 않음
const samp = (pts) => { const o = []; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 2)); for (let k = 0; k < n; k++) o.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return o; };
let worst = 0;
R.streets.forEach((s1) => R.streets.forEach((s2) => { if (s1 === s2) return; const tol = Math.max(3, 0.25 * Math.min(s1.w, s2.w)); let n = 0; samp(s1.pts).forEach((p) => { for (let i = 0; i + 1 < s2.pts.length; i++) if (U.distPointSeg(p, s2.pts[i], s2.pts[i + 1]).d < tol) { n++; break; } }); worst = Math.max(worst, n * 2); }));
check('no remaining overlaps longer than 10m', worst <= 10, worst);
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
