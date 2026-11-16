/* 도로 이음새 고치기(overture.js O.streets 3-b) 검사: 위경도로 바꾼 가짜 구간으로
   (1) 어긋난 십자로(두 교차점 5.9m)와 갈라졌다 다시 만나는 짧은 두 갈래 → 한 교차점, 겹친 갈래 하나만
   (2) 같은 길이 3m 끊긴 것 → 한 길로
   (3) 다른 길 3m 앞에서 끊긴 끝 → 그 길 위(T자)에 닿음, 그 길은 나누지 않음
   (4) 서로 멀리 떨어진 막다른 끝(12m)은 그대로 */
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
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
