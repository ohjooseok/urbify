/* 양방향 차도 합치기(overture.js O.streets (3)) 검사: 조치원 충현로 실제 자료(Overture, 1km 대상지의 일부, 대상지 m 좌표)로
   · 한 차도는 293m 한 토막, 맞은편 차도는 옆길이 붙는 곳마다 네 토막 → 함께 짝지어 가운데 선 하나로(두 줄로 남지 않음)
   · 짝 끝의 남은 꼬리(교차로까지 모여드는 16m)를 버리지 않음 → 가운데 선이 남쪽 교차로(행복길)까지 닿음
   · 지운 차도에 붙어 있던 옆길(침산1·2·3길, 침산로, 침산5길)은 가운데 선에 닿음
   · 충현로가 북쪽 끝에서 남쪽 끝까지 끊기지 않고 이어짐 */
const fs = require('fs');
global.window = global; global.document = { createElement: () => ({ getContext: () => null }) };
global.localStorage = { getItem: () => null, setItem: () => {} };
['util', 'catalog', 'ctx', 'overture'].forEach((n) => eval(fs.readFileSync(__dirname + '/../src/js/' + n + '.js', 'utf8')));
const U = UDS.U, X = UDS.Ctx, O = UDS.Ovt;
const F = X.frame(36.60134, 127.29832, 1000, 1000);
const ll = (x, y) => [F.lon + (x - F.W / 2) / F.mLon, F.lat + (y - F.H / 2) / F.mLat];
const rows = JSON.parse(fs.readFileSync(__dirname + '/data/ovt_chunghyeon.json', 'utf8'));
const segs = rows.map(([cls, name, ow, w, major, pts]) => ({ cls, sub: '', name, w, ow, major, br: 0, pts: pts.map(([x, y]) => ll(x, y)) }));
const R = O.streets(segs, F), S = R.streets;
let ok = true;
const check = (m, c, info) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (info !== undefined ? '  ' + JSON.stringify(info) : '')); if (!c) ok = false; };
const rd = (p) => p.map((v) => Math.round(v));
const ends = (s) => [s.pts[0], s.pts[s.pts.length - 1]];
const onLine = (p, s) => s.pts.some((q, i) => i > 0 && U.distPointSeg(p, s.pts[i - 1], q).d < 0.8);
const main = S.filter((s) => s.name === '충현로' && s.cls === 'tertiary');
// 두 줄로 남은 구간 없음: 충현로끼리 폭의 60% 안에서 나란히 12m 넘게 붙어 가지 않음
const samp = (pts) => { const o = []; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 2)); for (let k = 0; k < n; k++) o.push({ p: [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], u: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] }); } return o; };
let worst = 0, at = null;
main.forEach((s1) => main.forEach((s2) => {
  if (s1 === s2) return;
  const tol = 0.6 * Math.min(s1.w, s2.w); let n = 0;
  samp(s1.pts).forEach((sm) => { for (let k = 0; k + 1 < s2.pts.length; k++) { const a = s2.pts[k], b = s2.pts[k + 1], r = U.distPointSeg(sm.p, a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; if (r.d < tol && Math.abs(sm.u[0] * (b[0] - a[0]) / L + sm.u[1] * (b[1] - a[1]) / L) >= 0.9) { n++; break; } } });
  if (n * 2 > worst) { worst = n * 2; at = rd(s1.pts[0]); }
}));
check('carriageways merged: no doubled 충현로 stretch longer than 12m', worst <= 12, { worst, at });
// 끊김 없음: 대상지 일부 자료의 바깥 끝(북쪽 y<45, 남쪽 y>870)을 빼면 충현로 끝은 모두 다른 길에 닿음
const dang = [];
main.forEach((s) => ends(s).forEach((p) => { if (p[1] < 45 || p[1] > 870) return; if (!S.some((t) => t !== s && onLine(p, t))) dang.push(rd(p)); }));
check('no dead ends along 충현로', dang.length === 0, dang);
// 북쪽 끝에서 남쪽 끝까지 이어짐(끝점을 따라 걷기)
const north = main.find((s) => ends(s).some((p) => p[1] < 45)), south = main.find((s) => ends(s).some((p) => p[1] > 870));
const seen = new Set([north]); let frontier = [north], reached = false;
while (frontier.length && !reached) {
  const nx = [];
  frontier.forEach((s) => main.forEach((t) => { if (seen.has(t)) return; if (ends(s).some((p) => ends(t).some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.8)) || ends(t).some((q) => onLine(q, s)) || ends(s).some((p) => onLine(p, t))) { seen.add(t); nx.push(t); if (t === south) reached = true; } }));
  frontier = nx;
}
check('충현로 runs unbroken from the north edge to the south edge', !!(north && south && reached), { pieces: main.length });
const sj = main.find((s) => ends(s).some((p) => Math.hypot(p[0] - 158.8, p[1] - 754.1) < 1.5));
check('dual centreline reaches the 행복길 junction (no 16m gap)', !!sj, main.map((s) => ends(s).map(rd).join('→')));
['침산1길', '침산2길', '침산3길', '침산로', '침산5길'].forEach((nm) => {
  const ss = S.filter((s) => s.name === nm);
  const touch = ss.some((s) => ends(s).some((p) => main.some((m) => onLine(p, m))));
  check(nm + ' meets 충현로', touch, ss.map((s) => ends(s).map(rd).join('→')));
});
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
