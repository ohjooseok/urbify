/* Urbify — 단면에 세우는 사람·자전거·차량·수목 그림
 * 만화풍 기호 대신 실제 비례(신장 대비 머리·어깨·다리 길이, 차량 제원)와 한쪽에서 드는 빛의 음영으로 그린다.
 * 모든 도형은 미터 단위, 원점은 발밑(지면) 가운데, 위쪽이 +y. */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U;
  const F = (UDS.Fig = {});
  const TAU = Math.PI * 2;

  /* 사실적인 색: 채도를 낮춘 옷·차체 색 */
  F.COATS = ['#2f3238', '#3b4a63', '#b39468', '#5b6048', '#70323c', '#8b8e93', '#d0c6b3', '#4e6a8c', '#1f2124', '#e9e8e4', '#7a5c46', '#3f5d54'];
  F.PANTS = ['#26282c', '#3a465c', '#5f574d', '#1c1d20', '#6f7379', '#2f3b4f'];
  F.SKIN = ['#f0d2b6', '#e3bd98', '#cfa27c', '#a5714f'];
  F.HAIR = ['#1b1918', '#2c211b', '#4a3628', '#6d6d6f'];
  F.CAR_COLORS = ['#eceef0', '#d9dbde', '#b7bbc0', '#7d8188', '#3a3d42', '#1d1e21', '#27344d', '#70202a', '#3f5f8a', '#e9e6df'];
  F.BUS_COLORS = ['#2f61b5', '#3a9d5f'];

  const shadeCache = new Map();
  const sh = (c, k) => { const key = c + k; let v = shadeCache.get(key); if (!v) { v = U.shade(c, k); shadeCache.set(key, v); } return v; };

  /* 점들을 부드럽게 잇는 경로(Catmull-Rom) */
  function sm(ctx, pts, closed) {
    const n = pts.length; if (n < 2) return;
    const P = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    ctx.moveTo(pts[0][0], pts[0][1]);
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    if (closed) ctx.closePath();
  }
  /* 관절 중심선과 굵기로 팔다리 윤곽을 만든다. J: [[x,y,반폭],...] */
  function tube(ctx, J) {
    const L = [], R = [];
    for (let i = 0; i < J.length; i++) {
      const a = J[Math.max(0, i - 1)], b = J[Math.min(J.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      L.push([J[i][0] - dy * J[i][2], J[i][1] + dx * J[i][2]]);
      R.push([J[i][0] + dy * J[i][2], J[i][1] - dx * J[i][2]]);
    }
    ctx.beginPath(); sm(ctx, L.concat(R.reverse()), true);
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  /* 채우기: 채색이면 왼쪽 위에서 드는 빛(왼쪽 밝게, 오른쪽 어둡게), 선 도면이면 흰 면+검은 선 */
  function fillH(ctx, q, col, x0, x1, k) {
    if (q.line) { ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = q.lw; ctx.lineJoin = 'round'; ctx.stroke(); return; }
    k = k === undefined ? 1 : k;
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, sh(col, 0.12 * k)); g.addColorStop(0.5, col); g.addColorStop(1, sh(col, -0.24 * k));
    ctx.fillStyle = g; ctx.fill();
  }
  function fillV(ctx, q, cTop, cBot, y1, y0) {
    if (q.line) { ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = q.lw; ctx.lineJoin = 'round'; ctx.stroke(); return; }
    const g = ctx.createLinearGradient(0, y1, 0, y0);
    g.addColorStop(0, cTop); g.addColorStop(1, cBot);
    ctx.fillStyle = g; ctx.fill();
  }
  function flat(ctx, q, col, inkFill) {
    if (q.line) { ctx.fillStyle = inkFill ? '#000' : '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = q.lw; ctx.lineJoin = 'round'; ctx.stroke(); return; }
    ctx.fillStyle = col; ctx.fill();
  }
  function ground(ctx, q, rx, ry, a) {
    if (q.line) return;
    ctx.beginPath(); ctx.ellipse(rx * 0.06, 0.004, rx, ry, 0, 0, TAU); ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fill();
  }

  /* ---------- 사람 ---------- */
  function head(ctx, q, cx, cy, hs, skin, hair, back, o) {
    const rx = 0.049 * hs, ry = 0.062 * hs;
    if (back) {
      ctx.beginPath(); ctx.ellipse(cx, cy - ry * 0.25, rx * 0.86, ry * 0.8, 0, 0, TAU); fillH(ctx, q, skin, cx - rx, cx + rx);
      ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.08, rx * 1.03, ry * 0.95, 0, 0, TAU); fillH(ctx, q, hair, cx - rx, cx + rx, 0.7);
      if (o && o.longHair) { rrect(ctx, cx - rx * 1.2, cy - ry * 2.25, rx * 2.4, ry * 2.6, rx * 0.95); fillH(ctx, q, hair, cx - rx * 1.2, cx + rx * 1.2, 0.7); }
    } else {
      ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.14, rx * 1.06, ry * 0.93, 0, 0, TAU); fillH(ctx, q, hair, cx - rx, cx + rx, 0.7);
      ctx.beginPath(); ctx.ellipse(cx, cy - ry * 0.1, rx * 0.86, ry * 0.86, 0, 0, TAU); fillH(ctx, q, skin, cx - rx, cx + rx);
      if (!q.line) { // 앞머리
        ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.66, rx * 0.84, ry * 0.3, 0, 0, TAU); ctx.fillStyle = hair; ctx.fill();
      } else { ctx.beginPath(); ctx.moveTo(cx - rx * 0.86, cy + ry * 0.3); ctx.quadraticCurveTo(cx, cy + ry * 0.62, cx + rx * 0.86, cy + ry * 0.3); ctx.strokeStyle = '#000'; ctx.lineWidth = q.lw; ctx.stroke(); }
    }
    if (o && o.hat) { // 챙 있는 모자
      ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.36, rx * 1.1, ry * 0.72, 0, Math.PI, 0, true); ctx.closePath(); fillH(ctx, q, o.hat, cx - rx, cx + rx, 0.8);
      if (!back) { rrect(ctx, cx - rx * 1.25, cy + ry * 0.27, rx * 2.5, ry * 0.16, ry * 0.08); flat(ctx, q, sh(o.hat, -0.18)); }
    }
    if (o && o.helmet) {
      ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.3, rx * 1.2, ry * 0.86, 0, Math.PI, 0, true); ctx.closePath(); fillH(ctx, q, o.helmet, cx - rx * 1.2, cx + rx * 1.2, 0.8);
      if (!q.line) { ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = q.lw * 1.2; ctx.beginPath(); [-0.45, 0, 0.45].forEach((d) => { ctx.moveTo(cx + d * rx, cy + ry * 0.42); ctx.lineTo(cx + d * rx * 0.8, cy + ry * 1.05); }); ctx.stroke(); }
    }
  }

  /* 서서 걷는 사람(정면 또는 뒷모습). o: {h, sex, back, style, top, bottom, skin, hair, shoe, phase, bag, longHair, hat, reach:{side, x, y}} */
  F.person = function (ctx, x, y, sc, o) {
    o = o || {};
    const H = o.h || 1.7, kid = H < 1.42;
    const s = sc * H;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, -s);
    const q = { line: !!o.line, lw: 0.9 / s };
    const fem = o.sex === 'f', back = !!o.back;
    const sw = kid ? 0.84 : fem ? 0.88 : 1.0;
    const hs = kid ? 1.27 : fem ? 0.97 : 1.0;
    const shY = kid ? 0.772 : 0.815, crY = kid ? 0.43 : 0.47;
    const top = o.top || '#2f3238', bot = o.bottom || '#26282c', skin = o.skin || '#e3bd98', hair = o.hair || '#1b1918', shoe = o.shoe || '#1a1a1c';
    const style = o.style || 'jacket';
    const ph = o.phase ? 1 : -1;
    ground(ctx, q, 0.17, 0.014, 0.3);
    const skirt = style === 'dress' || style === 'skirt';
    const shorts = style === 'tee' && o.shorts;
    // 다리와 신발
    const leg = (sd) => {
      const lead = sd === ph;
      const hx = sd * 0.052, ax = sd * (lead ? 0.040 : 0.047), kx = sd * (lead ? 0.047 : 0.056), lift = lead ? 0 : 0.034;
      const w = skirt || shorts ? 0.86 : 1;
      const pts = [
        [hx + sd * 0.050, crY + 0.06], [hx + sd * 0.050 * w, crY - 0.07], [kx + sd * 0.037 * w, 0.275 + lift * 0.5], [ax + sd * 0.036 * w, 0.17 + lift * 0.7], [ax + sd * 0.021, 0.052 + lift],
        [ax - sd * 0.019, 0.052 + lift], [ax - sd * 0.027 * w, 0.17 + lift * 0.7], [kx - sd * 0.030 * w, 0.275 + lift * 0.5], [hx - sd * 0.046 * w, crY - 0.012], [hx - sd * 0.046, crY + 0.06],
      ];
      ctx.beginPath(); sm(ctx, pts, true);
      fillH(ctx, q, skirt || shorts ? (o.tights || skin) : bot, Math.min(hx, ax) - 0.05, Math.max(hx, ax) + 0.05, lead ? 1 : 1.25);
      if (shorts) { ctx.beginPath(); sm(ctx, [[hx + sd * 0.052, crY + 0.06], [hx + sd * 0.052, crY - 0.09], [hx - sd * 0.047, crY - 0.085], [hx - sd * 0.047, crY + 0.06]], true); fillH(ctx, q, bot, hx - 0.05, hx + 0.05); }
      ctx.beginPath();
      if (lead) ctx.ellipse(ax + sd * 0.005, 0.027, 0.036, 0.027, 0, 0, TAU);
      else ctx.ellipse(ax, 0.044 + lift * 0.45, 0.028, 0.036, 0, 0, TAU);
      flat(ctx, q, shoe);
    };
    leg(-ph); leg(ph);
    const hy = 1 - 0.062 * hs;
    // 정면의 긴 머리는 어깨 뒤로 넘어가므로 몸통보다 먼저
    if (o.longHair && !back) { const rx = 0.049 * hs, ry = 0.062 * hs; rrect(ctx, -rx * 1.25, hy - ry * 2.0, rx * 2.5, ry * 2.4, rx * 0.9); fillH(ctx, q, hair, -rx * 1.25, rx * 1.25, 0.7); }
    // 팔: 몸통 뒤쪽 것은 먼저
    const arm = (sd, front) => {
      const fwd = sd === -ph; // 내딛는 다리의 반대쪽 팔이 앞으로
      const sx = sd * 0.116 * sw, sy = shY - 0.014;
      let ex = sx + sd * 0.026, ey = shY - 0.185, wx = sx + sd * (fwd ? 0.016 : 0.032), wy = shY - (fwd ? 0.315 : 0.338);
      if (o.reach && o.reach.side === sd) { wx = o.reach.x / H; wy = o.reach.y / H; ex = (sx + wx) / 2 + sd * 0.012; ey = (sy + wy) / 2 - 0.01; }
      const J = [[sx, sy, 0.036], [ex, ey, 0.028], [wx, wy, 0.021]];
      const sleeveless = style === 'tee';
      tube(ctx, J); fillH(ctx, q, sleeveless ? skin : top, Math.min(sx, wx) - 0.035, Math.max(sx, wx) + 0.035, front ? 1 : 1.3);
      if (sleeveless) { tube(ctx, [[sx, sy, 0.037], [(sx + ex) / 2, (sy + ey) / 2 - 0.01, 0.033]]); fillH(ctx, q, top, sx - 0.04, sx + 0.04); }
      const dx = wx - ex, dy = wy - ey, l = Math.hypot(dx, dy) || 1;
      ctx.beginPath(); ctx.ellipse(wx + (dx / l) * 0.022, wy + (dy / l) * 0.022, 0.016, 0.027, Math.atan2(dx, -dy) * 0, 0, TAU); fillH(ctx, q, skin, wx - 0.02, wx + 0.02);
      return [wx + (dx / l) * 0.03, wy + (dy / l) * 0.03];
    };
    // 가방(토트)은 뒤 팔 쪽 손에
    let handPos = null;
    if (o.bag === 'tote') {
      const sd = ph, sx = sd * 0.116 * sw;
      const wx = sx + sd * 0.032, wy = shY - 0.338;
      rrect(ctx, wx - 0.048, wy - 0.185, 0.096, 0.125, 0.012); fillH(ctx, q, o.bagColor || '#5a4030', wx - 0.05, wx + 0.05);
      ctx.beginPath(); ctx.moveTo(wx - 0.03, wy - 0.06); ctx.quadraticCurveTo(wx, wy + 0.01, wx + 0.03, wy - 0.06); ctx.strokeStyle = q.line ? '#000' : sh(o.bagColor || '#5a4030', -0.2); ctx.lineWidth = q.line ? q.lw : 0.008; ctx.stroke();
    }
    // 몸통
    const neckY = shY + 0.052, wst = fem ? 0.073 : 0.088, hipY = crY + 0.055;
    let hemY = crY - 0.012, hemW = 0.101;
    if (style === 'coat') { hemY = crY - 0.14; hemW = 0.112; } else if (style === 'dress') { hemY = crY - 0.17; hemW = 0.138; } else if (style === 'skirt') { hemY = crY - 0.12; hemW = 0.118; } else if (style === 'tee') { hemY = crY + 0.018; hemW = 0.096; }
    const half = [[0.03, neckY + 0.006], [0.074 * sw, neckY - 0.012], [0.124 * sw, shY], [0.119 * sw, shY - 0.06], [0.101 * sw, shY - 0.115], [wst, shY - 0.2], [0.097, hipY], [hemW, hemY + 0.014], [hemW * 0.62, hemY]];
    const torso = half.concat(half.slice().reverse().map((p) => [-p[0], p[1]]));
    arm(ph, false);
    if (style === 'skirt') { ctx.beginPath(); sm(ctx, [[wst, shY - 0.2], [0.1, hipY], [hemW, hemY + 0.012], [hemW * 0.6, hemY], [-hemW * 0.6, hemY], [-hemW, hemY + 0.012], [-0.1, hipY], [-wst, shY - 0.2]], true); fillH(ctx, q, bot, -hemW, hemW); }
    ctx.beginPath(); sm(ctx, style === 'skirt' ? half.slice(0, 7).concat([[0.09, hipY - 0.03]]).concat([[-0.09, hipY - 0.03]]).concat(half.slice(0, 7).reverse().map((p) => [-p[0], p[1]])) : torso, true);
    fillH(ctx, q, top, -0.125 * sw, 0.125 * sw);
    // 목
    rrect(ctx, -0.021, shY + 0.03, 0.042, 0.07, 0.01); fillH(ctx, q, sh(skin, -0.1), -0.02, 0.02);
    if (!back) {
      if (style === 'coat' || style === 'jacket') { // 깃과 여밈선
        ctx.beginPath(); ctx.moveTo(-0.03, neckY + 0.004); ctx.lineTo(0, shY - 0.1); ctx.lineTo(0.03, neckY + 0.004); ctx.closePath(); flat(ctx, q, o.inner || '#e8e6e1');
        ctx.beginPath(); ctx.moveTo(0, shY - 0.1); ctx.lineTo(0, hemY + 0.01); ctx.strokeStyle = q.line ? '#000' : 'rgba(0,0,0,0.3)'; ctx.lineWidth = q.line ? q.lw : 0.006; ctx.stroke();
      }
      if (o.bag === 'pack' && !q.line) { ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.014; ctx.beginPath(); [-1, 1].forEach((d) => { ctx.moveTo(d * 0.075 * sw, neckY - 0.014); ctx.lineTo(d * 0.088 * sw, shY - 0.15); }); ctx.stroke(); }
    } else if (o.bag === 'pack') { rrect(ctx, -0.085, shY - 0.27, 0.17, 0.25, 0.04); fillH(ctx, q, o.bagColor || '#2b3a4e', -0.085, 0.085); }
    if (o.bag === 'cross') {
      const sd = ph;
      ctx.beginPath(); ctx.moveTo(-sd * 0.09 * sw, neckY - 0.02); ctx.lineTo(sd * 0.1, hipY + 0.02); ctx.strokeStyle = q.line ? '#000' : 'rgba(0,0,0,0.5)'; ctx.lineWidth = q.line ? q.lw : 0.011; ctx.stroke();
      rrect(ctx, sd * 0.1 - 0.05, hipY - 0.07, 0.1, 0.09, 0.02); fillH(ctx, q, o.bagColor || '#3b2f28', sd * 0.1 - 0.05, sd * 0.1 + 0.05);
    }
    handPos = arm(-ph, true);
    head(ctx, q, 0, hy, hs, skin, hair, back, o);
    if (o.cane) { ctx.beginPath(); ctx.moveTo(handPos[0], handPos[1]); ctx.lineTo(handPos[0] + (handPos[0] > 0 ? 0.03 : -0.03), 0); ctx.strokeStyle = q.line ? '#000' : '#4a4038'; ctx.lineWidth = q.line ? q.lw : 0.012; ctx.stroke(); }
    ctx.restore();
  };

  /* 손잡고 걷는 보호자와 아이 */
  F.pair = function (ctx, x, y, sc, a, c) {
    const hx = 0.36, hyy = 0.74; // 맞잡은 손 위치(m)
    F.person(ctx, x - 0.2 * sc, y, sc, { ...a, phase: 0, reach: { side: 1, x: hx - 0.02, y: hyy } });
    F.person(ctx, x + 0.34 * sc, y, sc, { ...c, phase: 1, reach: { side: -1, x: -0.18, y: hyy } });
  };

  /* 휠체어 이용자(정면) */
  F.wheelchair = function (ctx, x, y, sc, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, -sc);
    const q = { line: !!o.line, lw: 0.9 / sc };
    const top = o.top || '#3b4a63', bot = o.bottom || '#26282c', skin = o.skin || '#e3bd98', hair = o.hair || '#6d6d6f';
    ground(ctx, q, 0.38, 0.03, 0.3);
    const metal = q.line ? '#000' : '#4a4f55';
    [-1, 1].forEach((d) => { // 큰 바퀴(정면에서는 가는 타원)
      ctx.beginPath(); ctx.ellipse(d * 0.3, 0.3, 0.034, 0.3, 0, 0, TAU); flat(ctx, q, '#202225', true);
      ctx.beginPath(); ctx.ellipse(d * 0.335, 0.3, 0.012, 0.27, 0, 0, TAU); ctx.strokeStyle = q.line ? '#000' : '#9aa0a6'; ctx.lineWidth = q.line ? q.lw : 0.012; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(d * 0.19, 0.065, 0.02, 0.065, 0, 0, TAU); flat(ctx, q, '#2a2c30', true);
    });
    ctx.strokeStyle = metal; ctx.lineWidth = q.line ? q.lw : 0.022; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.24, 0.5); ctx.lineTo(0.24, 0.5); ctx.moveTo(-0.19, 0.5); ctx.lineTo(-0.19, 0.12); ctx.moveTo(0.19, 0.5); ctx.lineTo(0.19, 0.12); ctx.moveTo(-0.24, 0.5); ctx.lineTo(-0.26, 0.74); ctx.moveTo(0.24, 0.5); ctx.lineTo(0.26, 0.74); ctx.stroke();
    rrect(ctx, -0.17, 0.085, 0.34, 0.03, 0.01); flat(ctx, q, '#3a3d42');
    // 종아리·발
    [-1, 1].forEach((d) => { tube(ctx, [[d * 0.085, 0.56, 0.05], [d * 0.085, 0.35, 0.042], [d * 0.085, 0.16, 0.03]]); fillH(ctx, q, bot, d * 0.085 - 0.05, d * 0.085 + 0.05); ctx.beginPath(); ctx.ellipse(d * 0.088, 0.125, 0.04, 0.03, 0, 0, TAU); flat(ctx, q, '#1a1a1c'); });
    rrect(ctx, -0.175, 0.5, 0.35, 0.14, 0.05); fillH(ctx, q, bot, -0.175, 0.175);
    // 팔·몸통·머리
    const arm = (d) => { tube(ctx, [[d * 0.17, 1.0, 0.045], [d * 0.24, 0.82, 0.037], [d * 0.265, 0.68, 0.03]]); fillH(ctx, q, top, d * 0.2 - 0.07, d * 0.2 + 0.07); ctx.beginPath(); ctx.ellipse(d * 0.27, 0.65, 0.024, 0.032, 0, 0, TAU); fillH(ctx, q, skin, d * 0.27 - 0.02, d * 0.27 + 0.02); };
    arm(1);
    const half = [[0.04, 1.075], [0.1, 1.06], [0.185, 1.02], [0.18, 0.9], [0.155, 0.72], [0.165, 0.6]];
    ctx.beginPath(); sm(ctx, half.concat(half.slice().reverse().map((p) => [-p[0], p[1]])), true); fillH(ctx, q, top, -0.19, 0.19);
    rrect(ctx, -0.028, 1.05, 0.056, 0.07, 0.012); fillH(ctx, q, sh(skin, -0.1), -0.03, 0.03);
    arm(-1);
    ctx.save(); ctx.translate(0, 1.21); ctx.scale(1.72, 1.72); head(ctx, { line: q.line, lw: q.lw / 1.72 }, 0, 0, 1, skin, hair, !!o.back, o); ctx.restore();
    ctx.restore();
  };

  /* 자전거 이용자(정면 또는 뒷모습) */
  F.cyclist = function (ctx, x, y, sc, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, -sc);
    const q = { line: !!o.line, lw: 0.9 / sc };
    const back = !!o.back, top = o.top || '#4e6a8c', bot = o.bottom || '#26282c', skin = o.skin || '#e3bd98', hair = o.hair || '#1b1918';
    ground(ctx, q, 0.3, 0.022, 0.3);
    const ink = q.line ? '#000' : '#26282c';
    const wheel = () => { // 바퀴(정면에서는 가는 타원)와 포크
      ctx.beginPath(); ctx.ellipse(0, 0.34, 0.026, 0.34, 0, 0, TAU); flat(ctx, q, '#1c1d20', true);
      ctx.strokeStyle = q.line ? '#000' : '#7b8188'; ctx.lineWidth = q.line ? q.lw : 0.018; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-0.05, 0.34); ctx.lineTo(-0.03, 0.8); ctx.moveTo(0.05, 0.34); ctx.lineTo(0.03, 0.8); ctx.moveTo(0, 0.76); ctx.lineTo(0, back ? 0.9 : 1.0); ctx.stroke();
    };
    // 다리: 한쪽 페달은 아래, 한쪽은 위
    const legJ = (d, up) => [[d * 0.075, 0.95, 0.062], [d * (up ? 0.135 : 0.12), up ? 0.76 : 0.57, 0.048], [d * 0.115, up ? 0.5 : 0.21, 0.032]];
    [[-1, false], [1, true]].forEach(([d, up]) => {
      tube(ctx, legJ(d, up)); fillH(ctx, q, bot, d * 0.1 - 0.07, d * 0.1 + 0.07, up ? 1.2 : 1);
      ctx.beginPath(); ctx.ellipse(d * 0.118, (up ? 0.47 : 0.18), 0.04, 0.03, 0, 0, TAU); flat(ctx, q, '#1a1a1c');
      rrect(ctx, d * 0.118 - 0.05, (up ? 0.435 : 0.145), 0.1, 0.02, 0.006); flat(ctx, q, '#3a3d42', true);
    });
    wheel();
    // 몸통(앞으로 숙여 정면에서는 짧게 보임)
    const half = [[0.035, 1.5], [0.11, 1.48], [0.19, 1.43], [0.185, 1.3], [0.15, 1.08], [0.14, 0.93]];
    const arm = (d) => { tube(ctx, [[d * 0.18, 1.42, 0.045], [d * 0.27, 1.22, 0.036], [d * 0.275, 1.04, 0.028]]); fillH(ctx, q, o.sleeve || top, d * 0.22 - 0.08, d * 0.22 + 0.08); ctx.beginPath(); ctx.ellipse(d * 0.277, 1.015, 0.026, 0.028, 0, 0, TAU); fillH(ctx, q, skin, d * 0.277 - 0.02, d * 0.277 + 0.02); };
    if (back) { // 뒷모습: 안장과 뒷등
      rrect(ctx, -0.07, 0.9, 0.14, 0.05, 0.02); flat(ctx, q, '#1c1d20', true);
    }
    arm(1);
    ctx.beginPath(); sm(ctx, half.concat(half.slice().reverse().map((p) => [-p[0], p[1]])), true); fillH(ctx, q, top, -0.19, 0.19);
    arm(-1);
    // 핸들
    ctx.strokeStyle = ink; ctx.lineWidth = q.line ? q.lw : 0.022; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.3, 1.0); ctx.quadraticCurveTo(0, 1.03, 0.3, 1.0); ctx.stroke();
    rrect(ctx, -0.026, 1.47, 0.052, 0.07, 0.012); fillH(ctx, q, sh(skin, -0.1), -0.03, 0.03);
    ctx.save(); ctx.translate(0, 1.625); ctx.scale(1.72, 1.72); head(ctx, { line: q.line, lw: q.lw / 1.72 }, 0, 0, 1, skin, hair, back, { helmet: o.helmet || '#e9e9e6' }); ctx.restore();
    const em = [];
    if (o.lights > 0.05) em.push(back ? { x: x, y: y - 0.86 * sc, r: 0.5 * sc, c: '255,60,48', a: 0.75 * o.lights, core: 0.035 * sc } : { x: x, y: y - 0.92 * sc, r: 0.8 * sc, c: '255,244,214', a: 0.8 * o.lights, core: 0.04 * sc });
    ctx.restore();
    return em;
  };

  /* ---------- 승용차(정면·후면) ---------- */
  const CAR = {
    sedan: { hw: 0.93, h: 1.45, belt: 0.9, roof: 0.57, cl: 0.17, tw: 0.225, th: 0.34, face: 0.71 },
    suv: { hw: 0.96, h: 1.68, belt: 1.04, roof: 0.69, cl: 0.21, tw: 0.245, th: 0.39, face: 0.84 },
    compact: { hw: 0.86, h: 1.5, belt: 0.93, roof: 0.6, cl: 0.16, tw: 0.195, th: 0.31, face: 0.73 },
  };
  F.CAR_TYPES = ['sedan', 'suv', 'compact', 'sedan'];
  F.car = function (ctx, x, y, sc, o) {
    o = o || {};
    const T = CAR[o.type] || CAR.sedan;
    const c = o.color || '#b7bbc0';
    const rear = !!o.rear, lit = o.lights || 0;
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, -sc);
    const q = { line: !!o.line, lw: 0.9 / sc };
    const hw = T.hw, h = T.h, belt = T.belt, cl = T.cl, rf = T.roof, fine = sc >= 13;
    if (!q.line) { ctx.beginPath(); ctx.ellipse(0, 0.012, hw + 0.08, 0.055, 0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fill(); }
    // 타이어
    [-1, 1].forEach((d) => {
      rrect(ctx, d > 0 ? hw - 0.045 - T.tw : -hw + 0.045, 0, T.tw, T.th, 0.055); flat(ctx, q, '#141517', true);
      if (!q.line && fine) { ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 0.012; ctx.beginPath(); for (let i = 1; i < 4; i++) { const xx = (d > 0 ? hw - 0.045 - T.tw : -hw + 0.045) + (T.tw * i) / 4; ctx.moveTo(xx, 0.02); ctx.lineTo(xx, cl + 0.04); } ctx.stroke(); }
    });
    // 차체 하부(범퍼~벨트라인)
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(-(hw - 0.1), cl); ctx.lineTo(hw - 0.1, cl);
      ctx.quadraticCurveTo(hw - 0.01, cl + 0.01, hw, cl + 0.13);
      ctx.lineTo(hw + 0.012, 0.5);
      ctx.bezierCurveTo(hw + 0.012, belt - 0.12, hw - 0.02, belt - 0.015, hw - 0.1, belt);
      ctx.lineTo(-(hw - 0.1), belt);
      ctx.bezierCurveTo(-(hw - 0.02), belt - 0.015, -(hw + 0.012), belt - 0.12, -(hw + 0.012), 0.5);
      ctx.lineTo(-hw, cl + 0.13);
      ctx.quadraticCurveTo(-(hw - 0.01), cl + 0.01, -(hw - 0.1), cl);
      ctx.closePath();
    };
    // 지붕과 기둥
    ctx.beginPath();
    ctx.moveTo(-(hw - 0.1), belt - 0.02); ctx.lineTo(-(rf + 0.02), h - 0.075);
    ctx.quadraticCurveTo(-rf, h - 0.004, -(rf - 0.11), h); ctx.quadraticCurveTo(0, h + 0.014, rf - 0.11, h);
    ctx.quadraticCurveTo(rf, h - 0.004, rf + 0.02, h - 0.075); ctx.lineTo(hw - 0.1, belt - 0.02); ctx.closePath();
    fillV(ctx, q, sh(c, 0.16), sh(c, -0.1), h, belt);
    // 유리
    const gi = rear ? 0.25 : 0.19, gb = belt + (rear ? 0.1 : 0.05), gt = h - (rear ? 0.075 : 0.055);
    ctx.beginPath();
    ctx.moveTo(-(hw - gi), gb); ctx.lineTo(-(rf - 0.035), gt - 0.035);
    ctx.quadraticCurveTo(-(rf - 0.05), gt, -(rf - 0.12), gt); ctx.lineTo(rf - 0.12, gt);
    ctx.quadraticCurveTo(rf - 0.05, gt, rf - 0.035, gt - 0.035); ctx.lineTo(hw - gi, gb);
    ctx.quadraticCurveTo(0, gb + 0.03, -(hw - gi), gb); ctx.closePath();
    if (q.line) flat(ctx, q, '#fff');
    else {
      const g = ctx.createLinearGradient(-hw, gt, hw * 0.6, gb);
      if (lit > 0.4) { g.addColorStop(0, '#2a3440'); g.addColorStop(1, '#0f1318'); } else { g.addColorStop(0, '#b9cad6'); g.addColorStop(0.42, '#5d6f7d'); g.addColorStop(1, '#27313a'); }
      ctx.fillStyle = g; ctx.fill();
      if (fine) { // 실내: 머리받침과 운전자
        ctx.fillStyle = 'rgba(12,16,20,0.55)';
        const drv = rear ? -1 : 1;
        [-1, 1].forEach((d) => { rrect(ctx, d * 0.36 - 0.1, gb + 0.06, 0.2, 0.22, 0.05); ctx.fill(); });
        ctx.beginPath(); ctx.ellipse(drv * 0.36, gb + 0.3, 0.085, 0.1, 0, 0, TAU); ctx.fill();
        rrect(ctx, -0.09, gt - 0.085, 0.18, 0.05, 0.015); ctx.fill();
        // 유리 반사
        ctx.beginPath(); ctx.moveTo(-(rf - 0.2), gt - 0.02); ctx.lineTo(-(rf - 0.36), gt - 0.02); ctx.lineTo(-(hw - gi - 0.36), gb + 0.04); ctx.lineTo(-(hw - gi - 0.14), gb + 0.04); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
      }
    }
    // 차체
    body(); fillV(ctx, q, sh(c, 0.1), sh(c, -0.3), belt, cl);
    if (!q.line) {
      ctx.save(); body(); ctx.clip();
      // 보닛·트렁크 윗면(하늘빛을 받아 밝음)
      ctx.beginPath(); ctx.moveTo(-(hw - 0.06), T.face); ctx.quadraticCurveTo(0, T.face + 0.035, hw - 0.06, T.face); ctx.lineTo(hw - 0.1, belt + 0.01); ctx.lineTo(-(hw - 0.1), belt + 0.01); ctx.closePath();
      const g1 = ctx.createLinearGradient(0, belt, 0, T.face); g1.addColorStop(0, sh(c, 0.3)); g1.addColorStop(1, sh(c, 0.06)); ctx.fillStyle = g1; ctx.fill();
      // 양옆 어둡게
      const g2 = ctx.createLinearGradient(-hw, 0, hw, 0); g2.addColorStop(0, 'rgba(0,0,0,0.05)'); g2.addColorStop(0.2, 'rgba(0,0,0,0)'); g2.addColorStop(0.72, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = g2; ctx.fillRect(-hw - 0.05, 0, hw * 2 + 0.1, belt + 0.05);
      // 범퍼 아래 검은 띠
      if (rear) { ctx.fillStyle = 'rgba(14,15,17,0.86)'; rrect(ctx, -(hw - 0.2), cl - 0.01, (hw - 0.2) * 2, 0.13, 0.04); ctx.fill(); }
      ctx.restore();
    } else { ctx.beginPath(); ctx.moveTo(-(hw - 0.05), T.face); ctx.quadraticCurveTo(0, T.face + 0.035, hw - 0.05, T.face); ctx.strokeStyle = '#000'; ctx.lineWidth = q.lw; ctx.stroke(); }
    // 사이드미러
    [-1, 1].forEach((d) => {
      ctx.beginPath(); ctx.moveTo(d * (hw - 0.07), belt + 0.02); ctx.lineTo(d * (hw + 0.03), belt + 0.06); ctx.lineTo(d * (hw + 0.03), belt + 0.1); ctx.lineTo(d * (hw - 0.09), belt + 0.07); ctx.closePath(); flat(ctx, q, sh(c, -0.4));
      ctx.beginPath(); ctx.ellipse(d * (hw + 0.07), belt + 0.088, 0.078, 0.05, 0, 0, TAU); fillV(ctx, q, sh(c, -0.05), sh(c, -0.42), belt + 0.14, belt + 0.04);
    });
    const em = [];
    const ly = T.face - 0.065;
    if (!rear) {
      // 그릴
      const gy0 = T.face - 0.075, gy1 = T.face - 0.27;
      ctx.beginPath(); ctx.moveTo(-0.38, gy0); ctx.lineTo(0.38, gy0); ctx.lineTo(0.43, gy0 - 0.07); ctx.lineTo(0.33, gy1); ctx.lineTo(-0.33, gy1); ctx.lineTo(-0.43, gy0 - 0.07); ctx.closePath(); flat(ctx, q, '#101113');
      if (fine) { ctx.strokeStyle = q.line ? '#000' : 'rgba(255,255,255,0.2)'; ctx.lineWidth = q.line ? q.lw * 0.7 : 0.009; ctx.beginPath(); [0.05, 0.1, 0.15].forEach((dy) => { ctx.moveTo(-0.39 + dy * 0.2, gy0 - dy); ctx.lineTo(0.39 - dy * 0.2, gy0 - dy); }); ctx.stroke(); }
      if (!q.line) { ctx.strokeStyle = 'rgba(205,210,215,0.85)'; ctx.lineWidth = 0.012; ctx.beginPath(); ctx.moveTo(-0.38, gy0); ctx.lineTo(0.38, gy0); ctx.lineTo(0.43, gy0 - 0.07); ctx.lineTo(0.33, gy1); ctx.lineTo(-0.33, gy1); ctx.lineTo(-0.43, gy0 - 0.07); ctx.closePath(); ctx.stroke(); if (fine) { ctx.beginPath(); ctx.ellipse(0, gy0 - 0.06, 0.045, 0.032, 0, 0, TAU); ctx.fillStyle = '#d5d9dd'; ctx.fill(); } }
      // 전조등
      [-1, 1].forEach((d) => {
        ctx.beginPath(); ctx.moveTo(d * (hw - 0.035), T.face - 0.01); ctx.quadraticCurveTo(d * (hw - 0.25), T.face - 0.02, d * 0.47, T.face - 0.075); ctx.lineTo(d * 0.5, T.face - 0.155); ctx.lineTo(d * (hw - 0.02), T.face - 0.15); ctx.closePath();
        if (q.line) flat(ctx, q, '#fff');
        else {
          ctx.fillStyle = '#23272c'; ctx.fill();
          ctx.save(); ctx.clip();
          const g = ctx.createLinearGradient(0, T.face, 0, T.face - 0.16);
          if (lit > 0.05) { g.addColorStop(0, '#fffef6'); g.addColorStop(1, '#ffe7a0'); } else { g.addColorStop(0, '#f6f8fa'); g.addColorStop(0.55, '#c2cbd2'); g.addColorStop(1, '#7c868e'); }
          ctx.fillStyle = g; ctx.fillRect(d > 0 ? 0.5 : -hw, T.face - 0.16, hw - 0.5, 0.05 + 0.11 * (lit > 0.05 ? 1 : 0.62));
          ctx.beginPath(); ctx.ellipse(d * (hw - 0.2), T.face - 0.095, 0.05, 0.04, 0, 0, TAU); ctx.fillStyle = lit > 0.05 ? '#ffffff' : '#e9eef2'; ctx.fill();
          ctx.restore();
        }
        if (lit > 0.05) em.push({ x: x + d * (hw - 0.22) * sc, y: y - (T.face - 0.09) * sc, r: 0.95 * sc, c: '255,243,206', a: 0.8 * lit, core: 0.08 * sc });
      });
      // 범퍼 흡기구
      if (!q.line) { ctx.beginPath(); ctx.moveTo(-0.62, cl + 0.02); ctx.lineTo(0.62, cl + 0.02); ctx.lineTo(0.5, cl + 0.15); ctx.lineTo(-0.5, cl + 0.15); ctx.closePath(); ctx.fillStyle = '#0f1012'; ctx.fill(); if (fine) [-1, 1].forEach((d) => { rrect(ctx, d * (hw - 0.21) - 0.07, cl + 0.07, 0.14, 0.05, 0.02); ctx.fillStyle = lit > 0.05 ? '#fff1c4' : '#cfd5da'; ctx.fill(); }); }
      // 번호판
      rrect(ctx, -0.26, cl + 0.17, 0.52, 0.11, 0.012); flat(ctx, q, '#f4f4f1');
      if (!q.line && fine) { ctx.fillStyle = 'rgba(20,22,26,0.7)'; ctx.fillRect(-0.19, cl + 0.205, 0.13, 0.04); ctx.fillRect(-0.02, cl + 0.205, 0.21, 0.04); }
      // 와이퍼
      if (fine) { ctx.strokeStyle = q.line ? '#000' : 'rgba(10,10,12,0.75)'; ctx.lineWidth = q.line ? q.lw * 0.7 : 0.012; ctx.beginPath(); ctx.moveTo(-0.5, gb + 0.012); ctx.lineTo(-0.08, gb + 0.05); ctx.moveTo(0.05, gb + 0.012); ctx.lineTo(0.47, gb + 0.05); ctx.stroke(); }
    } else {
      // 후미등과 연결 띠
      [-1, 1].forEach((d) => {
        ctx.beginPath(); ctx.moveTo(d * (hw - 0.03), ly + 0.11); ctx.lineTo(d * (hw - 0.47), ly + 0.09); ctx.lineTo(d * (hw - 0.45), ly); ctx.lineTo(d * (hw - 0.02), ly - 0.01); ctx.closePath();
        if (q.line) flat(ctx, q, '#fff');
        else { const g = ctx.createLinearGradient(0, ly + 0.11, 0, ly - 0.01); if (lit > 0.05) { g.addColorStop(0, '#ff6259'); g.addColorStop(1, '#e02a22'); } else { g.addColorStop(0, '#b3222b'); g.addColorStop(1, '#7c141c'); } ctx.fillStyle = g; ctx.fill(); }
        if (lit > 0.05) em.push({ x: x + d * (hw - 0.24) * sc, y: y - (ly + 0.05) * sc, r: 0.6 * sc, c: '255,56,44', a: 0.75 * lit, core: 0.05 * sc });
      });
      if (!q.line) { ctx.fillStyle = lit > 0.05 ? '#d8362e' : '#8a1a22'; ctx.fillRect(-(hw - 0.47), ly + 0.045, (hw - 0.47) * 2, 0.022); }
      // 트렁크 선·번호판
      ctx.beginPath(); ctx.moveTo(-(hw - 0.12), ly - 0.05); ctx.lineTo(hw - 0.12, ly - 0.05); ctx.strokeStyle = q.line ? '#000' : 'rgba(0,0,0,0.28)'; ctx.lineWidth = q.line ? q.lw : 0.008; ctx.stroke();
      if (!q.line) { ctx.beginPath(); ctx.moveTo(-0.33, ly - 0.07); ctx.lineTo(0.33, ly - 0.07); ctx.lineTo(0.29, ly - 0.22); ctx.lineTo(-0.29, ly - 0.22); ctx.closePath(); ctx.fillStyle = sh(c, -0.34); ctx.fill(); }
      rrect(ctx, -0.26, ly - 0.2, 0.52, 0.11, 0.012); flat(ctx, q, '#f4f4f1');
      if (!q.line && fine) { ctx.fillStyle = 'rgba(20,22,26,0.7)'; ctx.fillRect(-0.19, ly - 0.165, 0.13, 0.04); ctx.fillRect(-0.02, ly - 0.165, 0.21, 0.04); ctx.fillStyle = lit > 0.05 ? '#ff5a50' : '#8a1a22'; ctx.fillRect(-0.16, gt - 0.03, 0.32, 0.014); }
    }
    if (o.taxi) { rrect(ctx, -0.17, h + 0.005, 0.34, 0.1, 0.03); flat(ctx, q, lit > 0.05 ? '#ffe58a' : '#f1efe6'); if (lit > 0.05) em.push({ x, y: y - (h + 0.05) * sc, r: 0.45 * sc, c: '255,226,130', a: 0.6 * lit, core: 0 }); }
    ctx.restore();
    return em;
  };

  /* ---------- 시내버스(정면·후면) ---------- */
  F.bus = function (ctx, x, y, sc, o) {
    o = o || {};
    const c = o.color || '#2f61b5', rear = !!o.rear, lit = o.lights || 0;
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, -sc);
    const q = { line: !!o.line, lw: 0.9 / sc };
    const hw = 1.245, top = 3.14, fine = sc >= 11;
    if (!q.line) { ctx.beginPath(); ctx.ellipse(0, 0.015, hw + 0.1, 0.07, 0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fill(); }
    [-1, 1].forEach((d) => { rrect(ctx, d > 0 ? hw - 0.07 - 0.3 : -hw + 0.07, 0, 0.3, 0.52, 0.07); flat(ctx, q, '#141517', true); });
    // 지붕 냉방기
    rrect(ctx, -0.82, top - 0.02, 1.64, 0.2, 0.07); fillV(ctx, q, '#e9eaec', '#b9bcc0', top + 0.18, top);
    // 차체
    rrect(ctx, -hw, 0.3, hw * 2, top - 0.3, 0.14); fillV(ctx, q, sh(c, 0.12), sh(c, -0.22), top, 0.3);
    if (!q.line) {
      ctx.save(); rrect(ctx, -hw, 0.3, hw * 2, top - 0.3, 0.14); ctx.clip();
      ctx.fillStyle = '#eceef0'; ctx.fillRect(-hw, 0.98, hw * 2, 0.16);
      ctx.fillStyle = 'rgba(16,17,19,0.9)'; ctx.fillRect(-hw, 0.3, hw * 2, 0.2);
      const g2 = ctx.createLinearGradient(-hw, 0, hw, 0); g2.addColorStop(0, 'rgba(0,0,0,0.04)'); g2.addColorStop(0.25, 'rgba(0,0,0,0)'); g2.addColorStop(0.75, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,0.26)');
      ctx.fillStyle = g2; ctx.fillRect(-hw, 0.3, hw * 2, top);
      ctx.restore();
    }
    const em = [];
    const glass = (x0, y0, w, hh, r) => {
      rrect(ctx, x0, y0, w, hh, r);
      if (q.line) return flat(ctx, q, '#fff');
      const g = ctx.createLinearGradient(x0, y0 + hh, x0 + w * 0.7, y0);
      if (lit > 0.4) { g.addColorStop(0, '#3b4652'); g.addColorStop(1, '#161b21'); } else { g.addColorStop(0, '#c2d2dd'); g.addColorStop(0.45, '#64778a'); g.addColorStop(1, '#2a343e'); }
      ctx.fillStyle = g; ctx.fill();
    };
    if (!rear) {
      glass(-1.12, 1.3, 2.24, 1.42, 0.09);
      if (!q.line && fine) {
        ctx.fillStyle = 'rgba(10,14,18,0.5)'; ctx.beginPath(); ctx.ellipse(0.62, 1.78, 0.14, 0.17, 0, 0, TAU); ctx.fill(); rrect(ctx, 0.4, 1.32, 0.46, 0.38, 0.1); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0.62, 1.5, 0.24, 0.05, 0, 0, TAU); ctx.strokeStyle = 'rgba(10,14,18,0.7)'; ctx.lineWidth = 0.03; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-0.9, 2.66); ctx.lineTo(-0.6, 2.66); ctx.lineTo(-0.2, 1.36); ctx.lineTo(-0.62, 1.36); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.11)'; ctx.fill();
      }
      ctx.strokeStyle = q.line ? '#000' : 'rgba(10,10,12,0.75)'; ctx.lineWidth = q.line ? q.lw * 0.8 : 0.018;
      if (fine) { ctx.beginPath(); ctx.moveTo(-0.95, 1.34); ctx.lineTo(-0.3, 1.52); ctx.moveTo(0.1, 1.34); ctx.lineTo(0.75, 1.52); ctx.stroke(); }
      // 행선지 표시
      rrect(ctx, -0.98, 2.78, 1.96, 0.27, 0.04); flat(ctx, q, '#0e0f11');
      if (!q.line) { ctx.fillStyle = lit > 0.05 ? '#ffb23d' : '#d98a1f'; [[-0.86, 0.3], [-0.46, 0.5], [0.14, 0.34], [0.56, 0.3]].forEach(([xx, w]) => ctx.fillRect(xx, 2.86, w, 0.11)); if (lit > 0.05) em.push({ x, y: y - 2.91 * sc, r: 1.1 * sc, c: '255,170,60', a: 0.35 * lit, core: 0 }); }
      // 전조등·번호판
      [-1, 1].forEach((d) => {
        rrect(ctx, d * 0.96 - 0.19, 0.66, 0.38, 0.2, 0.05);
        if (q.line) flat(ctx, q, '#fff'); else { ctx.fillStyle = lit > 0.05 ? '#fff6d2' : '#dfe4e8'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.012; ctx.stroke(); }
        if (lit > 0.05) em.push({ x: x + d * 0.96 * sc, y: y - 0.76 * sc, r: 1.5 * sc, c: '255,243,206', a: 0.85 * lit, core: 0.11 * sc });
        // 후사경
        rrect(ctx, d * (hw + 0.2) - 0.07, 2.2, 0.14, 0.42, 0.04); flat(ctx, q, '#1c1d20', true);
        ctx.beginPath(); ctx.moveTo(d * hw, 2.78); ctx.lineTo(d * (hw + 0.2), 2.62); ctx.strokeStyle = q.line ? '#000' : '#1c1d20'; ctx.lineWidth = q.line ? q.lw : 0.03; ctx.stroke();
      });
      rrect(ctx, -0.26, 0.56, 0.52, 0.11, 0.012); flat(ctx, q, '#f4f4f1');
    } else {
      glass(-0.95, 1.95, 1.9, 0.72, 0.08);
      rrect(ctx, -0.5, 2.76, 1.0, 0.25, 0.04); flat(ctx, q, '#0e0f11');
      if (!q.line) { ctx.fillStyle = lit > 0.05 ? '#ffb23d' : '#d98a1f'; ctx.fillRect(-0.3, 2.83, 0.6, 0.11); }
      rrect(ctx, -0.7, 0.62, 1.4, 0.3, 0.03); flat(ctx, q, sh(c, -0.3));
      if (fine) { ctx.strokeStyle = q.line ? '#000' : 'rgba(0,0,0,0.4)'; ctx.lineWidth = q.line ? q.lw * 0.7 : 0.012; ctx.beginPath(); for (let i = 1; i < 5; i++) { ctx.moveTo(-0.66, 0.62 + i * 0.06); ctx.lineTo(0.66, 0.62 + i * 0.06); } ctx.stroke(); }
      rrect(ctx, -0.8, 1.2, 1.6, 0.6, 0.03); flat(ctx, q, '#e9e7e1');
      [-1, 1].forEach((d) => {
        rrect(ctx, d * 1.08 - 0.09, 0.9, 0.18, 0.62, 0.04);
        if (q.line) flat(ctx, q, '#fff'); else { ctx.fillStyle = lit > 0.05 ? '#ff5248' : '#a01e26'; ctx.fill(); }
        if (lit > 0.05) em.push({ x: x + d * 1.08 * sc, y: y - 1.2 * sc, r: 0.9 * sc, c: '255,56,44', a: 0.8 * lit, core: 0.08 * sc });
      });
      rrect(ctx, -0.26, 0.98, 0.52, 0.11, 0.012); flat(ctx, q, '#f4f4f1');
    }
    ctx.restore();
    return em;
  };

  /* ---------- 수목(입면) ----------
   * 도면용 나무 표현: 옅은 회색 면에 가는 외곽선, 잔 잎이 이룬 오돌토돌한 가장자리, 군데군데 뚫린 작은 틈과
   * 그 사이로 보이는 가지, 수관 안에 옅게 비치는 가지 선. 그림자·명암은 넣지 않는다.
   * 수관은 거리장(안쪽 +, m)으로 만든다: 큰 잎 덩어리를 부드럽게 합친 바탕 → 떨어져 나온 잎 조각 → 틈(작은 원을 뺌)
   * → 잎 가장자리 굴곡(물결 잡음). 거리장의 0 등고선을 격자에서 따라가 닫힌 꺾은선으로 얻고, 짝홀 규칙으로 칠한다.
   * 틈은 실제로 뚫려 있어야 뒤가 비치므로 나무마다 따로 그려 두었다가(캐시) 붙인다.
   * sp: {crown, height, clear, shape, form}, o: {k, seed, line, maxH} */
  const TREE = { fill: '#E7E7E5', edge: '#363636', wood: '#E3E3E1', inner: '#CACAC8' };
  const TREE_CACHE = new Map();
  /* 수형별 윤곽: [수관 아래(0)→위(1), 반폭(0~1)] */
  const PROFILE = {
    oval: [[0, 0.42], [0.12, 0.74], [0.32, 0.97], [0.52, 1.0], [0.74, 0.86], [0.9, 0.6], [1, 0.28]],
    vase: [[0, 0.3], [0.14, 0.56], [0.36, 0.86], [0.6, 1.0], [0.8, 0.9], [0.93, 0.62], [1, 0.3]],
    column: [[0, 0.4], [0.12, 0.78], [0.3, 1.0], [0.5, 0.92], [0.72, 0.7], [0.9, 0.42], [1, 0.16]],
    spread: [[0, 0.46], [0.14, 0.82], [0.36, 1.0], [0.58, 0.97], [0.8, 0.78], [0.93, 0.5], [1, 0.26]],
  };
  function profW(form, t) {
    const P = PROFILE[form] || PROFILE.oval;
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < P.length; i++) if (t <= P[i][0]) { const a = P[i - 1], b = P[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); }
    return P[P.length - 1][1];
  }
  function polyAt(J, u) { // 꺾은선 J 위의 점(u: 0~1)
    const n = J.length - 1, f = Math.max(0, Math.min(0.9999, u)) * n, i = Math.floor(f), k = f - i;
    return [J[i][0] + (J[i + 1][0] - J[i][0]) * k, J[i][1] + (J[i + 1][1] - J[i][1]) * k];
  }
  /* 정수 해시와 값 잡음(0~1). 물결 잡음 |2n-1|은 둥근 마루와 뾰족한 골이 번갈아 나와 잎이 뭉친 가장자리처럼 보인다 */
  function hash2(i, j, s) {
    let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul((s | 0) + 1, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  /* 잎 가장자리: 큰 덩어리의 가장자리를 조금 안으로 물린 뒤, 그 둘레에 크고 작은 잎 뭉치(원)를 촘촘히 찍어
     가장자리가 작은 반원들로 오돌토돌하게 이어지게 한다. scales: [간격, 반지름(간격 대비) 최소·최대, 놓는 자리(덩어리 가장자리에서 안쪽 거리) 최소·최대, 놓을 확률, 이어 붙이는 부드러움(반지름 대비)].
     화면에서 너무 작아 보이지 않을 잎은 만들지 않는다. q: 크기 배율, px: 1m가 몇 px인지 */
  function leafOpts(seed, q, px, noFine) {
    const sc = [[0.44, 0.36, 0.62, -0.05, 0.42, 0.95, 0.35], [0.19, 0.34, 0.66, -0.08, 0.2, 0.82, 0.3], [0.085, 0.38, 0.68, -0.08, 0.1, 0.9, 0.12]]
      .map(([sp, r0, r1, f0, f1, pk, kf]) => [sp * q, r0, r1, f0 * q, f1 * q, pk, kf])
      .filter((x, i) => i === 0 || x[0] * (px || 40) >= (i === 1 ? 6 : 2.8));
    // 가장자리 띠의 잔 틈·떨어진 잎 부스러기와 잔 떨림: 화면에서 1px 넘게 보일 때만
    const fine = !noFine && 0.03 * q * (px || 40) >= 1.0;
    return { seed, inset: 0.13 * q, scales: sc, amp: sc.reduce((m, x) => Math.max(m, x[0] * x[2] - x[3]), 0), q, fine };
  }
  /* 큰 잎 덩어리(타원 [x, y, rx, ry])를 부드럽게 합친 거리장 값 */
  function macroField(blobs, kS, x, y) {
    let f = -1e9;
    for (let n = 0; n < blobs.length; n++) {
      const b = blobs[n], dx = (x - b[0]) / b[2], dy = (y - b[1]) / b[3];
      const d = (1 - Math.sqrt(dx * dx + dy * dy)) * (b[2] < b[3] ? b[2] : b[3]);
      if (n === 0) f = d;
      else { const hh = kS - Math.abs(f - d); f = (f > d ? f : d) + (hh > 0 ? (hh * hh) / (4 * kS) : 0); }
    }
    return f;
  }
  /* 격자 위 값의 등고선(iso)을 따라가 닫힌 꺾은선들로(marching squares). 점은 격자 칸 단위(i, j). 격자 밖은 val이 iso 아래여야 한다 */
  function msLoops(val, w, h, iso, eps) {
    const W2 = w + 2;
    const pts = new Map(), nb = new Map(); // 변 번호 → 점, 변 번호 → 이웃 변들
    const link = (e1, p1, e2, p2) => {
      pts.set(e1, p1); pts.set(e2, p2);
      let a2 = nb.get(e1); if (!a2) nb.set(e1, (a2 = [])); a2.push(e2);
      a2 = nb.get(e2); if (!a2) nb.set(e2, (a2 = [])); a2.push(e1);
    };
    const T = (u, v) => { const d = v - u; return Math.abs(d) < 1e-9 ? 0.5 : U.clamp((iso - u) / d, 0, 1); };
    for (let j = -1; j < h; j++) {
      for (let i = -1; i < w; i++) {
        const a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1);
        const k = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const base = (j + 1) * W2 + (i + 1);
        const eT = base * 2, eL = base * 2 + 1, eB = (base + W2) * 2, eR = (base + 1) * 2 + 1;
        const pT = [i + T(a, b), j], pB = [i + T(d, c), j + 1], pL = [i, j + T(a, d)], pR = [i + 1, j + T(b, c)];
        const mid = (a + b + c + d) / 4 > iso;
        switch (k) {
          case 1: case 14: link(eL, pL, eB, pB); break;
          case 2: case 13: link(eB, pB, eR, pR); break;
          case 3: case 12: link(eL, pL, eR, pR); break;
          case 4: case 11: link(eT, pT, eR, pR); break;
          case 6: case 9: link(eT, pT, eB, pB); break;
          case 7: case 8: link(eT, pT, eL, pL); break;
          case 5: if (mid) { link(eT, pT, eL, pL); link(eB, pB, eR, pR); } else { link(eT, pT, eR, pR); link(eL, pL, eB, pB); } break;
          default: if (mid) { link(eT, pT, eR, pR); link(eL, pL, eB, pB); } else { link(eT, pT, eL, pL); link(eB, pB, eR, pR); } // 10
        }
      }
    }
    const seen = new Set(), loops = [];
    nb.forEach((_, start) => {
      if (seen.has(start)) return;
      const loop = [];
      let cur = start, prev = -1;
      while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur); loop.push(pts.get(cur));
        const ns = nb.get(cur) || [];
        const nx = ns[0] !== prev && !seen.has(ns[0]) ? ns[0] : ns[1] !== undefined && !seen.has(ns[1]) ? ns[1] : undefined;
        prev = cur; cur = nx;
      }
      if (loop.length < 4) return;
      let ar = 0;
      for (let i = 0; i < loop.length; i++) { const p = loop[i], q = loop[(i + 1) % loop.length]; ar += p[0] * q[1] - q[0] * p[1]; }
      if (Math.abs(ar) / 2 < 1.5) return; // 티끌
      loops.push(thin(loop, eps));
    });
    return loops;
  }
  /* 수관(또는 덤불) 윤곽: 큰 덩어리는 성긴 격자에서 구해 이어 붙이고(매끈해서 충분하다), 잎 뭉치·잎 조각·틈은 고운 격자에 찍는다.
     floorY를 주면 그 아래를 잘라 바닥을 평평하게. 결과는 m 단위 닫힌 꺾은선들 */
  function crownLoops(blobs, bits, holes, leaf, kS, cell, floorY) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const grow = (x, y, rx, ry) => { x0 = Math.min(x0, x - rx); x1 = Math.max(x1, x + rx); y0 = Math.min(y0, y - ry); y1 = Math.max(y1, y + ry); };
    blobs.forEach((b) => grow(b[0], b[1], b[2] + kS * 0.5, b[3] + kS * 0.5));
    bits.forEach((b) => grow(b[0], b[1], b[2] * 1.8, b[2] * 1.8));
    if (!(x1 > x0)) return [];
    const m = leaf.amp + cell * 3; x0 -= m; x1 += m; y0 -= m; y1 += m;
    if (floorY !== undefined) y0 = Math.max(y0, floorY - cell * 2);
    let c = cell;
    const span = Math.max(x1 - x0, y1 - y0);
    if (span / c > 900) c = span / 900; // 아주 큰 나무는 격자를 성기게
    const w = Math.ceil((x1 - x0) / c) + 1, h = Math.ceil((y1 - y0) / c) + 1;
    const S = 4, cw = Math.max(2, Math.ceil((w - 1) / S) + 1), chh = Math.max(2, Math.ceil((h - 1) / S) + 1);
    const Cg = new Float32Array(cw * chh);
    for (let j = 0; j < chh; j++) for (let i = 0; i < cw; i++) Cg[j * cw + i] = macroField(blobs, kS, x0 + i * S * c, y0 + j * S * c);
    const V = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      const gj = j / S, j0 = Math.min(chh - 2, Math.floor(gj)), fy = gj - j0;
      for (let i = 0; i < w; i++) {
        const gi = i / S, i0 = Math.min(cw - 2, Math.floor(gi)), fx = gi - i0;
        const a = Cg[j0 * cw + i0], b = Cg[j0 * cw + i0 + 1], cc = Cg[(j0 + 1) * cw + i0], d = Cg[(j0 + 1) * cw + i0 + 1];
        V[j * w + i] = a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy - leaf.inset;
      }
    }
    const put = (cx, cy, r, fn) => {
      const i0 = Math.max(0, Math.floor((cx - r - x0) / c)), i1 = Math.min(w - 1, Math.ceil((cx + r - x0) / c));
      const j0 = Math.max(0, Math.floor((cy - r - y0) / c)), j1 = Math.min(h - 1, Math.ceil((cy + r - y0) / c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * w + i, x0 + i * c, y0 + j * c);
    };
    // 찍을 때 조금 부드럽게 합쳐(목이 가는 거품처럼 보이지 않게) 잎 뭉치가 서로 이어진 가장자리로
    const stamp = (cx, cy, r, kf) => { const kk = r * (kf || 0.3); put(cx, cy, r + kk + c * 2, (k, x, y) => { const d = r - Math.hypot(x - cx, y - cy), v = V[k], hh = kk - Math.abs(v - d); V[k] = (v > d ? v : d) + (hh > 0 ? (hh * hh) / (4 * kk) : 0); }); };
    // 잎 뭉치: 어긋난 격자 자리마다 하나씩, 덩어리 가장자리 근처에만
    const rnd = U.rng(leaf.seed * 2654435761 % 4294967296 + 17);
    leaf.scales.forEach(([sp, r0, r1, f0, f1, pk, kf]) => {
      let row = 0;
      for (let y = y0; y <= y1; y += sp * 0.87, row++) {
        for (let x = x0 + (row % 2 ? sp * 0.5 : 0); x <= x1; x += sp) {
          const px = x + (rnd() - 0.5) * sp * 0.7, py = y + (rnd() - 0.5) * sp * 0.7, r = sp * (r0 + rnd() * (r1 - r0)), keep = rnd();
          if (keep > pk) continue;
          const f = macroField(blobs, kS, px, py);
          if (f < f0 || f > f1) continue;
          stamp(px, py, r, kf);
        }
      }
    });
    // 떨어져 나온 잎 조각: 작은 뭉치 몇 개
    bits.forEach(([bx, by, r]) => {
      stamp(bx, by, r);
      const n = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) { const a = rnd() * TAU, d = r * (0.7 + rnd() * 0.4); stamp(bx + Math.cos(a) * d, by + Math.sin(a) * d, r * (0.45 + rnd() * 0.3)); }
    });
    // 틈
    const carve = (hx, hy, r) => put(hx, hy, r + c * 2, (k, x, y) => { const d = Math.hypot(x - hx, y - hy) - r; if (d < V[k]) V[k] = d; });
    holes.forEach(([hx, hy, r]) => carve(hx, hy, r));
    if (leaf.fine) {
      // 가장자리 가까이에 잔 틈과 떨어져 나온 잎 부스러기를 흩어 잎 사이로 하늘이 비치는 가장자리로
      // 안쪽 깊이(m): 바깥에서 몇 m 들어왔는지(두 번 훑는 거리 변환). 거리장 값은 안쪽 깊은 곳에서는 거리가 아니라서 따로 구한다
      const q = leaf.q, D = new Float32Array(w * h);
      for (let k = 0; k < w * h; k++) D[k] = V[k] > 0 ? 1e9 : 0;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = j * w + i; if (!D[k]) continue; let d = D[k];
        if (i > 0) d = Math.min(d, D[k - 1] + 1);
        if (j > 0) { d = Math.min(d, D[k - w] + 1); if (i > 0) d = Math.min(d, D[k - w - 1] + 1.414); if (i < w - 1) d = Math.min(d, D[k - w + 1] + 1.414); }
        D[k] = d;
      }
      for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i; if (!D[k]) continue; let d = D[k];
        if (i < w - 1) d = Math.min(d, D[k + 1] + 1);
        if (j < h - 1) { d = Math.min(d, D[k + w] + 1); if (i < w - 1) d = Math.min(d, D[k + w + 1] + 1.414); if (i > 0) d = Math.min(d, D[k + w - 1] + 1.414); }
        D[k] = d;
      }
      const at = (x, y) => { const i = Math.round((x - x0) / c), j = Math.round((y - y0) / c); return i < 0 || j < 0 || i >= w || j >= h ? [-1, 0] : [V[j * w + i], D[j * w + i] * c]; };
      const step = 0.1 * q;
      for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
        const px = x + (rnd() - 0.5) * step, py = y + (rnd() - 0.5) * step, [v, din] = at(px, py), u = rnd();
        if (din > 0.03 * q && din < 0.15 * q && u < 0.11) {
          const r = (0.016 + rnd() * 0.024) * q; carve(px, py, r);
          if (rnd() < 0.5) { const a = rnd() * TAU; carve(px + Math.cos(a) * r * 1.1, py + Math.sin(a) * r * 1.1, r * (0.55 + rnd() * 0.3)); }
        } else if (v < -0.035 * q && v > -0.1 * q && u < 0.09) stamp(px, py, (0.02 + rnd() * 0.026) * q, 0.05);
      }
      // 잔 떨림: 둥근 잎 뭉치 가장자리가 너무 매끈하지 않게
      const L = Math.max(0.07 * q, c * 3), A = 0.018 * q, band = A + c * 1.5;
      for (let j = 0; j < h; j++) { const y = y0 + j * c; for (let i = 0; i < w; i++) { const k = j * w + i, v = V[k]; if (v > -band && v < band) V[k] = v + A * (2 * vnoise((x0 + i * c) / L, y / L, leaf.seed + 7) - 1); } }
    }
    if (floorY !== undefined) for (let j = 0; j < h; j++) { const fy = y0 + j * c - floorY; for (let i = 0; i < w; i++) { const k = j * w + i; if (fy < V[k]) V[k] = fy; } }
    const val = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? -1 : V[j * w + i]);
    return msLoops(val, w, h, 0, 0.2).map((lp) => lp.map((p) => [x0 + p[0] * c, y0 + p[1] * c]));
  }
  /* opt.coarse: 아주 작게 줄여 볼 그림(3D 나무 그림 모음)에는 가장자리 잔 틈·부스러기를 넣지 않는다(줄이면 검은 점으로 뭉친다) */
  function treeModel(sp, k, seed, maxH, sc, opt) {
    const h = Math.min(sp.height * k, maxH || 99), rx = (sp.crown / 2) * k;
    const clear = Math.min(sp.clear, h * 0.42), ch = h - clear;
    const form = sp.form || (sp.shape === 'cone' ? 'column' : sp.shape === 'pine' ? 'pine' : 'oval');
    const rnd = U.rng(seed * 7919 + Math.round(sp.crown * 10) + 13);
    const R = (a, b) => a + rnd() * (b - a);
    const sz = U.clamp(rx / 2.4, 0.6, 1.4);            // 잎·틈 크기 배율(작은 나무는 조금 잘게)
    const cell = U.clamp(1.0 / (sc || 30), 0.022, 0.1); // 등고선 격자 간격(m): 화면 1px 남짓
    const kS = 0.16 * sz;                              // 큰 잎 덩어리끼리 이어지는 부드러움(m): 작을수록 골이 또렷하다
    const tw = U.clamp(0.07 + rx * 0.022, 0.09, 0.2);
    const blobs = [], bits = [], holes = [], limbs = [], twigs = [];
    const mf = (x, y) => macroField(blobs, kS, x, y);
    // 틈: 작은 원 여럿을 겹쳐 가장자리가 울퉁불퉁하게
    const addHole = (x, y, r, parts) => {
      holes.push([x, y, r * 0.8]);
      let px = x, py = y;
      for (let i = 1; i < parts + 1; i++) { const a = rnd() * TAU, d = r * R(0.45, 0.8); px += Math.cos(a) * d * 0.6; py += Math.sin(a) * d * 0.6; holes.push([px + Math.cos(a) * d * 0.4, py + Math.sin(a) * d * 0.4, r * R(0.42, 0.7)]); }
    };
    if (form !== 'pine') {
      const lean = R(-0.05, 0.05) * rx;
      const p1 = rnd() * TAU, p2 = rnd() * TAU;
      const WR = (t) => profW(form, t) * rx * 0.84 * (1 + 0.12 * Math.sin(t * 4.4 + p1));
      const WL = (t) => profW(form, t) * rx * 0.84 * (1 + 0.12 * Math.sin(t * 5.2 + p2));
      // 가운데: 세로로 겹친 타원
      for (let i = 0; i < 6; i++) { const t = 0.12 + i * 0.152; blobs.push([lean * t + (WR(t) - WL(t)) * 0.3, clear + t * ch, (WR(t) + WL(t)) * 0.34, ch * 0.12]); }
      // 둘레: 크고 작은 잎 덩어리(군데군데 빠져 깊은 골이 생긴다)
      const outline = [], N = 48;
      for (let i = 0; i <= N; i++) { const t = i / N; outline.push([WR(t) + lean * t, clear + t * ch]); }
      for (let i = N; i >= 0; i--) { const t = i / N; outline.push([-WL(t) + lean * t, clear + t * ch]); }
      const cx0 = lean * 0.5, cy0 = clear + ch * 0.5;
      const base = rx * (form === 'column' ? 0.26 : 0.3);
      let pos = 0, next = 0;
      for (let i = 0; i < outline.length - 1; i++) {
        const p = outline[i], q = outline[i + 1], seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
        while (next <= pos + seg) {
          const u = (next - pos) / (seg || 1), x = p[0] + (q[0] - p[0]) * u, y = p[1] + (q[1] - p[1]) * u;
          const r = base * R(0.5, 1.35);
          const dx = cx0 - x, dy = cy0 - y, dl = Math.hypot(dx, dy) || 1, inset = r * R(0.18, 0.85);
          if (!(rnd() < 0.17 && y > clear + ch * 0.1)) blobs.push([x + (dx / dl) * inset, y + (dy / dl) * inset, r, r]);
          next += r * R(0.8, 1.4);
        }
        pos += seg;
      }
      // 줄기(곧고 조금씩 가늘어진다)와 가지
      const topT = form === 'column' ? 0.74 : 0.58, bend = R(-0.04, 0.04) * rx;
      const trunk = [[0, 0, tw * 1.12], [0, clear * 0.5, tw], [bend * 0.5, clear, tw * 0.86], [bend + lean * 0.3, clear + ch * topT * 0.45, tw * 0.6], [bend + lean * topT, clear + ch * topT, tw * 0.16]];
      limbs.push(trunk);
      const trunkX = (y) => { for (let i = 1; i < trunk.length; i++) if (y <= trunk[i][1]) { const a = trunk[i - 1], b = trunk[i]; return a[0] + (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 1); } return trunk[trunk.length - 1][0]; };
      const nb = form === 'vase' ? 6 : form === 'column' ? 4 : 5;
      const paths = [];
      for (let i = 0; i < nb; i++) {
        const side = i % 2 ? 1 : -1;
        const tb = (form === 'vase' ? 0.0 : 0.05) + (i / nb) * (form === 'column' ? 0.45 : 0.3);
        const y0 = clear + tb * ch, x0 = trunkX(y0);
        const te = R(0.35, 0.86), xe = side * (side > 0 ? WR(te) : WL(te)) * R(0.45, 0.82) + lean * te, ye = clear + te * ch;
        const xm = x0 + (xe - x0) * 0.42 + side * 0.04 * rx, ym = y0 + (ye - y0) * 0.5;
        const w0 = tw * Math.max(0.24, 0.56 - i * 0.05);
        const J = [[x0, y0, w0], [xm, ym, w0 * 0.6], [xe, ye, w0 * 0.18]];
        limbs.push(J); paths.push(J);
        // 잔가지: 반은 틈 사이로 보이는 가는 가지, 나머지는 수관 안의 옅은 선
        const a = polyAt(J, R(0.45, 0.7)), d2 = side * R(0.25, 0.7), up = R(0.5, 1.1);
        const J2 = [[a[0], a[1], w0 * 0.32], [a[0] + d2 * rx * 0.16, a[1] + up * rx * 0.14, w0 * 0.2], [a[0] + d2 * rx * 0.3, a[1] + up * rx * 0.32, w0 * 0.08]];
        if (rnd() < 0.5) limbs.push(J2); else twigs.push(J2.map((p) => [p[0], p[1]]));
      }
      // 가지가 갈라지는 자리에 큰 틈, 가지를 따라 중간 틈, 그 밖에 작은 틈을 흩는다(가장자리는 피한다)
      { const t = topT * R(0.25, 0.45), y = clear + ch * t, x = trunkX(y) + R(-0.08, 0.08) * rx, r = R(0.2, 0.3) * sz; if (mf(x, y) > r + 0.25 * sz) addHole(x, y, r, 3); }
      paths.forEach((J) => { if (rnd() < 0.25) return; const p = polyAt(J, R(0.38, 0.72)), r = R(0.09, 0.19) * sz; if (mf(p[0], p[1]) > r + 0.22 * sz) addHole(p[0], p[1], r, 2); });
      // 작은 틈은 몇 군데에 몰리게(가지 둘레·아래쪽), 나머지는 드문드문
      const zones = [];
      for (let i = 0, nz = 3 + Math.floor(rnd() * 3); i < nz; i++) { const t = 0.1 + 0.62 * Math.pow(rnd(), 1.3), sd = rnd() < 0.5 ? -1 : 1; zones.push([lean * t + sd * R(0.05, 0.6) * (sd > 0 ? WR(t) : WL(t)), clear + t * ch]); }
      const nh = 12 + Math.floor(rnd() * 7);
      for (let i = 0, tries = 0; i < nh && tries < nh * 8; tries++) {
        let x, y;
        if (rnd() < 0.7) { const z = zones[Math.floor(rnd() * zones.length)], a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.55 * sz; x = z[0] + Math.cos(a) * d; y = z[1] + Math.sin(a) * d * 0.8; }
        else { const t = 0.08 + 0.8 * rnd(), sd = rnd() < 0.5 ? -1 : 1; x = lean * t + sd * R(0, 0.8) * (sd > 0 ? WR(t) : WL(t)); y = clear + t * ch; }
        const r = R(0.045, 0.11) * sz;
        if (mf(x, y) > r + 0.22 * sz) { addHole(x, y, r, rnd() < 0.45 ? 2 : 1); i++; }
      }
      // 가장자리에서 떨어져 나온 잎 조각
      const nbit = 2 + Math.floor(rnd() * 3);
      for (let i = 0, tries = 0; i < nbit && tries < 40; tries++) {
        const t = R(0.1, 0.92), sd = rnd() < 0.5 ? -1 : 1, r = R(0.07, 0.13) * sz;
        const x = lean * t + sd * ((sd > 0 ? WR(t) : WL(t)) + base * R(0.3, 0.9)), y = clear + t * ch + R(-0.3, 0.3);
        const f = mf(x, y);
        if (f < -(r + 0.06 * sz) && f > -(r + 0.4 * sz)) { bits.push([x, y, r]); i++; }
      }
    } else {
      // 소나무: 굽은 줄기 끝마다 납작한 잎 덩어리
      const b1 = R(-0.4, 0.4), b2 = b1 + R(-0.5, 0.5), b3 = b2 * 0.7 + R(-0.25, 0.25);
      const trunk = [[0, 0, tw * 1.15], [b1 * 0.2, clear * 0.3, tw * 0.95], [b1, clear * 0.75, tw * 0.82], [b2 * 0.9, clear + ch * 0.3, tw * 0.66], [b2, clear + ch * 0.62, tw * 0.46], [b3, clear + ch * 0.9, tw * 0.2]];
      limbs.push(trunk);
      const trunkX = (y) => { for (let i = 1; i < trunk.length; i++) if (y <= trunk[i][1]) { const a = trunk[i - 1], b = trunk[i]; return a[0] + (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 1); } return trunk[trunk.length - 1][0]; };
      const pads = 4 + (rnd() < 0.5 ? 1 : 0);
      for (let p = 0; p < pads; p++) {
        const t = p / (pads - 1), y = clear + ch * (0.16 + 0.76 * t);
        const pw = rx * (1.0 - 0.5 * t) * R(0.62, 0.9), ph = Math.max(0.3, pw * R(0.26, 0.36));
        const side = p === pads - 1 ? 0 : (p % 2 ? 1 : -1);
        const x = trunkX(y) + side * pw * R(0.45, 0.7);
        blobs.push([x, y, pw * 0.9, ph * 0.8]);
        const n = Math.max(5, Math.round(pw / 0.34));
        for (let i = 0; i < n; i++) { const a = Math.PI * (i + 0.5) / n + R(-0.12, 0.12), r = ph * R(0.4, 0.68); blobs.push([x + Math.cos(a) * pw * 0.84, y + Math.sin(a) * ph * 0.78 + r * 0.1, r, r]); }
        if (side) limbs.push([[trunkX(y - ph * 0.9), y - ph * 0.9, tw * 0.34], [(trunkX(y) + x) / 2, y - ph * 0.5, tw * 0.24], [x, y - ph * 0.1, tw * 0.1]]);
      }
      for (let i = 0, tries = 0; i < 6 && tries < 40; tries++) {
        const x = R(-1, 1) * rx, y = clear + R(0.1, 0.95) * ch, r = R(0.05, 0.1) * sz;
        if (mf(x, y) > r + 0.14 * sz) { addHole(x, y, r, 1 + (rnd() < 0.4 ? 1 : 0)); i++; }
      }
    }
    const loops = crownLoops(blobs, bits, holes, leafOpts(seed * 31 + Math.round(sp.crown * 7), Math.sqrt(sz), sc, !!(opt && opt.coarse)), kS, cell);
    let bx0 = -tw * 1.5, bx1 = tw * 1.5, by1 = clear;
    loops.forEach((lp) => lp.forEach((p) => { if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0]; if (p[1] > by1) by1 = p[1]; }));
    limbs.forEach((J) => J.forEach((p) => { bx0 = Math.min(bx0, p[0] - p[2]); bx1 = Math.max(bx1, p[0] + p[2]); by1 = Math.max(by1, p[1]); }));
    return { loops, limbs, twigs, bx0, bx1, by1 };
  }
  const loopPath = (ctx, loops) => { ctx.beginPath(); loops.forEach((lp) => { ctx.moveTo(lp[0][0], lp[0][1]); for (let i = 1; i < lp.length; i++) ctx.lineTo(lp[i][0], lp[i][1]); ctx.closePath(); }); };
  /* 칠하기: 줄기·가지(테두리 → 면) → 수관 면(틈은 비운다) → 수관 안의 옅은 가지 선 → 수관 외곽선.
     틈 자리는 칠하지 않으므로 뒤에 그린 줄기·가지가 그 사이로 보인다. pal로 색을 바꾼다(3D 그림의 선·줄기 가리개) */
  function paintTree(t, M, sc, line, pal) {
    const lw = 0.75 / sc;
    const FILL = pal ? pal.fill : line ? '#ffffff' : TREE.fill, EDGE = pal ? pal.edge : line ? '#000000' : TREE.edge;
    const WOOD = pal ? pal.wood : line ? '#ffffff' : TREE.wood, INNER = pal ? pal.inner : line ? '#9a9a9a' : TREE.inner;
    t.lineJoin = 'round'; t.lineCap = 'round';
    M.limbs.forEach((J) => { tube(t, J); t.strokeStyle = EDGE; t.lineWidth = lw * 2; t.stroke(); });
    M.limbs.forEach((J) => { tube(t, J); t.fillStyle = WOOD; t.fill(); });
    if (!M.loops.length) return;
    loopPath(t, M.loops); t.fillStyle = FILL; t.fill('evenodd');
    t.save(); loopPath(t, M.loops); t.clip('evenodd');
    t.strokeStyle = INNER; t.lineWidth = lw * 0.8;
    M.limbs.forEach((J) => { t.beginPath(); sm(t, J.map((p) => [p[0], p[1]]), false); t.stroke(); });
    M.twigs.forEach((J) => { t.beginPath(); sm(t, J, false); t.stroke(); });
    t.restore();
    loopPath(t, M.loops); t.strokeStyle = EDGE; t.lineWidth = lw; t.stroke();
  }
  /* 닫힌 꺾은선에서 곧은 줄에 가까운 점을 덜어낸다(Douglas–Peucker) */
  function thin(loop, eps) {
    const n = loop.length;
    let far = 0, fd = -1;
    for (let i = 1; i < n; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > fd) { fd = d; far = i; } }
    const keep = new Uint8Array(n + 1);
    const seq = loop.concat([loop[0]]);
    keep[0] = keep[far] = keep[n] = 1;
    const stack = [[0, far], [far, n]];
    while (stack.length) {
      const [a, b] = stack.pop();
      if (b - a < 2) continue;
      const A = seq[a], B = seq[b], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-9;
      let mi = -1, md = eps;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((seq[i][0] - A[0]) * dy - (seq[i][1] - A[1]) * dx) / L; if (d > md) { md = d; mi = i; } }
      if (mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(seq[i]);
    return out;
  }
  /* 벡터로 내보낼 때의 나무: 화면과 같은 칠하기를 SVG 문맥에 그대로 */
  function treeVector(ctx, x, y, sc, sp, o) {
    const k = o.k || 1;
    const M = treeModel(sp, k, o.seed || 1, Math.min(sp.height * k, o.maxH || 99), sc);
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, -sc);
    paintTree(ctx, M, sc, !!o.line);
    ctx.restore();
  }

  /* 나무 그림은 배율을 약 4% 간격으로 끊어 만들어 두고 조금 늘이거나 줄여 붙인다.
     단면 높이를 끌어 바꾸는 동안 매 장면마다 새로 그리지 않기 위해서다 */
  let TREE_PX = 0;
  function treeSprite(sp, o, sc, dpr) {
    const k = o.k || 1, seed = o.seed || 1, line = !!o.line;
    const hq = Math.floor(Math.min(sp.height * k, o.maxH || 99) * 4) / 4; // 화면에 다 안 들어갈 때만 낮아진다
    const scq = Math.pow(2, Math.round(Math.log2(sc) * 18) / 18);
    const TH = UDS.TH, dk = !!(TH && TH.inkOn()); // 다크 테마는 다른 그림(색을 바꿔 그림)
    const key = [sp.name, sp.crown, sp.height, sp.clear, k.toFixed(3), seed, line ? 1 : 0, hq, scq.toFixed(3), dpr, dk ? 'd' : 'l'].join('|');
    let s = TREE_CACHE.get(key);
    if (s) return s;
    const M = treeModel(sp, k, seed, hq, scq);
    const pad = 3;
    let pxs = scq * dpr;
    const big = Math.max((M.bx1 - M.bx0) * pxs, M.by1 * pxs);
    if (big > 2200) pxs *= 2200 / big; // 아주 크게 그릴 때는 해상도를 낮춰 메모리를 아낀다
    const q = pxs / scq; // 실제로 쓴 화소 배율
    const x0 = M.bx0 * pxs - pad * q, yTop = M.by1 * pxs + pad * q;
    const cw = Math.max(2, Math.ceil(M.bx1 * pxs + pad * q - x0)), chh = Math.max(2, Math.ceil(yTop + pad * q));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh;
    const t = dk ? TH.wrap(cv.getContext('2d')) : cv.getContext('2d');
    t.setTransform(pxs, 0, 0, -pxs, -x0, yTop); // 미터 단위, 위가 +
    paintTree(t, M, scq, line);
    // ox·oy·w·h는 미터 단위(그릴 때 지금 배율을 곱한다)
    s = { cv, ox: -x0 / pxs, oy: yTop / pxs, w: cw / pxs, h: chh / pxs };
    if (TREE_CACHE.size > 60 || TREE_PX + cw * chh > 14e6) { TREE_CACHE.clear(); TREE_PX = 0; }
    TREE_CACHE.set(key, s); TREE_PX += cw * chh;
    return s;
  }
  /* 3D 화면의 납작한(face-me) 나무 그림에 쓰는 부품: 수형 모형과 칠하기(pal로 색을 바꿔 선 그림·줄기 가리개를 따로 만든다) */
  F.treeModel = treeModel;
  F.paintTree = paintTree;
  /* 위에서 본 수관(반지름 약 1): 지름 4.8m 수관으로 만들어 1로 줄인다. 같은 잎 가장자리와 작은 틈, 안쪽의 옅은 가지 선 */
  F.crownTopModel = function (seed) {
    const S = 2.4, rnd = U.rng(seed * 977 + 5), R = (a, b) => a + rnd() * (b - a);
    const blobs = [[0, 0, 1.5, 1.5]], holes = [], twigs = [];
    const n = 13;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + R(-0.15, 0.15), r = R(0.42, 0.68), d = 1.72 - r * 0.55; if (rnd() < 0.1) continue; blobs.push([Math.cos(a) * d, Math.sin(a) * d, r, r]); }
    for (let i = 0; i < 12; i++) { const a = rnd() * TAU, d = R(0.15, 1.25), r = R(0.05, 0.13); holes.push([Math.cos(a) * d, Math.sin(a) * d, r]); }
    const loops = crownLoops(blobs, [], holes, leafOpts(seed * 13 + 3, 1, 60, true), 0.16, 0.03).map((lp) => lp.map((p) => [p[0] / S, p[1] / S]));
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + rnd() * 0.5, s = rnd() < 0.5 ? 1 : -1; twigs.push([[Math.cos(a) * 0.06, Math.sin(a) * 0.06], [Math.cos(a + s * 0.18) * 0.3, Math.sin(a + s * 0.18) * 0.3], [Math.cos(a + s * 0.1) * 0.56, Math.sin(a + s * 0.1) * 0.56]]); }
    let r = 0.9;
    loops.forEach((lp) => lp.forEach((p) => { r = Math.max(r, Math.abs(p[0]), Math.abs(p[1])); }));
    return { loops, limbs: [], twigs, bx0: -r, bx1: r, by1: r };
  };
  F.tree = function (ctx, x, y, sc, sp, o) {
    o = o || {};
    if (ctx.isSVG) { treeVector(ctx, x, y, sc, sp, o); return; }
    const m = ctx.getTransform ? ctx.getTransform() : { a: 1, b: 0 };
    const dpr = U.clamp(Math.round(Math.hypot(m.a, m.b) * 100) / 100, 1, 3);
    const s = treeSprite(sp, o, sc, dpr);
    ctx.drawImage(s.cv, Math.round((x - s.ox * sc) * dpr) / dpr, Math.round((y - s.oy * sc) * dpr) / dpr, s.w * sc, s.h * sc);
  };

  /* 관목 군식: 나무와 같은 표현(옅은 면 + 가는 외곽선 + 잔 잎 가장자리)으로 낮게. 윤곽은 폭·높이·배율마다 만들어 둔다 */
  const SHRUB_CACHE = new Map();
  F.shrubs = function (ctx, x0, x1, y, sc, o) {
    o = o || {};
    const w = (x1 - x0) / sc; if (w < 0.25) return;
    const hgt = o.h || 0.7, line = !!o.line, lw = 0.75 / sc;
    const scq = Math.pow(2, Math.round(Math.log2(sc) * 6) / 6);
    const key = [Math.round(w * 50), Math.round(hgt * 50), o.seed || 3, scq.toFixed(2)].join('|');
    let loops = SHRUB_CACHE.get(key);
    if (!loops) {
      const rnd = U.rng((o.seed || 3) * 131 + Math.round(w * 10));
      const blobs = [];
      const n = Math.max(3, Math.round(w / 0.3));
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, r = hgt * (0.32 + rnd() * 0.18); blobs.push([t * w + (rnd() - 0.5) * 0.1, hgt - r * (0.75 + rnd() * 0.35), r, r]); }
      blobs.push([w / 2, hgt * 0.32, w * 0.5, hgt * 0.36]);
      const cell = U.clamp(1.1 / scq, 0.02, 0.08);
      loops = crownLoops(blobs, [], [], leafOpts((o.seed || 3) * 7 + 1, 0.55, scq), 0.08, cell, 0);
      if (SHRUB_CACHE.size > 160) SHRUB_CACHE.clear();
      SHRUB_CACHE.set(key, loops);
    }
    if (!loops.length) return;
    ctx.save(); ctx.translate(x0, y); ctx.scale(sc, -sc);
    ctx.lineJoin = 'round';
    loopPath(ctx, loops); ctx.fillStyle = line ? '#fff' : '#DFDFDC'; ctx.fill('evenodd');
    ctx.strokeStyle = line ? '#000' : TREE.edge; ctx.lineWidth = lw; ctx.stroke();
    ctx.restore();
  };

  /* ---------- 가로등·벤치·전주 ---------- */
  /* dir: 차도 쪽으로 뻗는 방향(±1), 0이면 보행등. 반환: 등기구 위치(조명 표현용) */
  F.lamp = function (ctx, x, y, sc, h, dir, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, -sc);
    const q = { line: !!o.line, lw: 0.9 / sc };
    const lit = o.lights || 0;
    const metal = '#4d535a';
    ground(ctx, q, 0.3, 0.02, 0.22);
    rrect(ctx, -0.14, 0, 0.28, 0.32, 0.03); fillH(ctx, q, metal, -0.14, 0.14);
    let hx = 0, hy = h;
    if (dir) {
      const arm = Math.min(1.5, h * 0.18);
      ctx.beginPath(); ctx.moveTo(-0.075, 0.3); ctx.lineTo(-0.05, h - 0.5); ctx.quadraticCurveTo(-0.05 + dir * 0.0, h + 0.05, dir * arm * 0.55, h + 0.03); ctx.lineTo(dir * arm, h);
      ctx.lineTo(dir * arm, h - 0.07); ctx.lineTo(dir * arm * 0.55, h - 0.05); ctx.quadraticCurveTo(0.05, h - 0.12, 0.05, h - 0.55); ctx.lineTo(0.075, 0.3); ctx.closePath();
      fillH(ctx, q, metal, -0.08, 0.08);
      hx = dir * (arm + 0.28); hy = h - 0.035;
      rrect(ctx, hx - 0.36, hy - 0.05, 0.72, 0.12, 0.05); fillV(ctx, q, '#5d646b', '#33383d', hy + 0.07, hy - 0.05);
      rrect(ctx, hx - 0.28, hy - 0.075, 0.56, 0.04, 0.02);
      if (q.line) flat(ctx, q, '#fff'); else { ctx.fillStyle = lit > 0.05 ? '#fff3cf' : '#d9dcdf'; ctx.fill(); }
    } else {
      ctx.beginPath(); ctx.moveTo(-0.06, 0.3); ctx.lineTo(-0.04, h - 0.3); ctx.lineTo(0.04, h - 0.3); ctx.lineTo(0.06, 0.3); ctx.closePath(); fillH(ctx, q, metal, -0.06, 0.06);
      ctx.beginPath(); ctx.moveTo(-0.13, h - 0.3); ctx.lineTo(-0.19, h); ctx.lineTo(0.19, h); ctx.lineTo(0.13, h - 0.3); ctx.closePath();
      if (q.line) flat(ctx, q, '#fff'); else { ctx.fillStyle = lit > 0.05 ? '#fff3cf' : '#e4e6e3'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.012; ctx.stroke(); }
      rrect(ctx, -0.23, h, 0.46, 0.06, 0.02); flat(ctx, q, '#3a3f45');
      hy = h - 0.15;
    }
    ctx.restore();
    return { x: x + hx * sc, y: y - hy * sc, h: hy, post: !dir };
  };
  F.bench = function (ctx, x, y, sc, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, -sc);
    const q = { line: !!o.line, lw: 0.9 / sc };
    ground(ctx, q, 0.34, 0.018, 0.24);
    const wood = '#8a6a4c';
    [-0.2, 0.2].forEach((d) => { rrect(ctx, d - 0.025, 0, 0.05, 0.42, 0.01); flat(ctx, q, '#3f4347'); });
    rrect(ctx, -0.27, 0.4, 0.54, 0.06, 0.02); fillH(ctx, q, wood, -0.27, 0.27);
    ctx.save(); ctx.translate(-0.25, 0.46); ctx.rotate(0.14); rrect(ctx, -0.03, 0, 0.06, 0.42, 0.02); fillH(ctx, q, wood, -0.03, 0.03); ctx.restore();
    ctx.restore();
  };
  F.pole = function (ctx, x, y, sc, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, -sc);
    const q = { line: !!o.line, lw: 0.9 / sc };
    const H = 9.6;
    ground(ctx, q, 0.4, 0.025, 0.24);
    ctx.beginPath(); ctx.moveTo(-0.17, 0); ctx.lineTo(-0.1, H); ctx.lineTo(0.1, H); ctx.lineTo(0.17, 0); ctx.closePath(); fillH(ctx, q, '#a3a19b', -0.17, 0.17);
    [[9.05, 0.92], [8.2, 0.76]].forEach(([yy, w]) => { rrect(ctx, -w, yy, w * 2, 0.1, 0.02); flat(ctx, q, '#62605a'); });
    const ins = [[-0.8, 9.15], [0, 9.15], [0.8, 9.15], [-0.62, 8.3], [0.62, 8.3]];
    ins.forEach(([xx, yy]) => { rrect(ctx, xx - 0.045, yy, 0.09, 0.16, 0.03); flat(ctx, q, '#d9d6cc'); });
    rrect(ctx, 0.16, 6.85, 0.5, 0.82, 0.12); fillH(ctx, q, '#7c8789', 0.16, 0.66);
    if (!q.line) { ctx.strokeStyle = 'rgba(20,20,20,0.75)'; ctx.lineWidth = 0.02; ctx.beginPath(); ctx.moveTo(0.4, 7.67); ctx.quadraticCurveTo(0.5, 8.0, 0.62, 8.3); ctx.moveTo(0.1, 6.4); ctx.quadraticCurveTo(0.3, 6.5, 0.3, 6.85); ctx.stroke(); }
    ctx.restore();
    return { x, top: y - 8.3 * sc, ins: ins.map(([xx, yy]) => [x + xx * sc, y - (yy + 0.16) * sc]) };
  };

  /* ---------- 빛 ---------- */
  F.glow = function (ctx, x, y, r, rgb, a) {
    if (r <= 0 || a <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.35, `rgba(${rgb},${a * 0.35})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  /* 가로등 아래로 퍼지는 빛: 폭이 다른 삼각형을 여러 겹 겹쳐 가장자리를 부드럽게 */
  F.cone = function (ctx, x, y, gy, spread, a) {
    const hgt = gy - y; if (hgt <= 2 || a <= 0) return;
    [1, 0.74, 0.5, 0.3].forEach((k, i) => {
      const g = ctx.createLinearGradient(0, y, 0, gy);
      g.addColorStop(0, `rgba(255,226,176,${0.2 * a})`); g.addColorStop(0.55, `rgba(255,216,156,${0.07 * a})`); g.addColorStop(1, `rgba(255,216,156,${0.02 * a})`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x + 2, y); ctx.lineTo(x + spread * k, gy); ctx.lineTo(x - spread * k, gy); ctx.closePath(); ctx.fill();
    });
    const g2 = ctx.createRadialGradient(x, gy, 0, x, gy, spread);
    g2.addColorStop(0, `rgba(255,226,170,${0.5 * a})`); g2.addColorStop(0.5, `rgba(255,226,170,${0.16 * a})`); g2.addColorStop(1, 'rgba(255,226,170,0)');
    ctx.save(); ctx.translate(x, gy); ctx.scale(1, 0.1); ctx.translate(-x, -gy); ctx.fillStyle = g2; ctx.fillRect(x - spread, gy - spread, spread * 2, spread * 2); ctx.restore();
  };

  /* 난수로 사람 차림새 고르기 */
  F.randomPerson = function (r, o) {
    const pick = (a) => a[Math.floor(r() * a.length)];
    const fem = r() < 0.5;
    const style = fem ? pick(['coat', 'jacket', 'dress', 'skirt', 'jacket', 'tee']) : pick(['coat', 'jacket', 'jacket', 'tee', 'jacket']);
    const top = pick(F.COATS);
    return {
      sex: fem ? 'f' : 'm', h: fem ? 1.56 + r() * 0.12 : 1.68 + r() * 0.14, style, top,
      bottom: style === 'skirt' ? pick(['#2a2c30', '#4a4f58', '#8b7b66', '#2f3b4f']) : pick(F.PANTS),
      tights: r() < 0.55 ? '#2a2a2e' : undefined,
      skin: pick(F.SKIN.slice(0, 3)), hair: r() < 0.12 ? '#8a8a8c' : pick(F.HAIR.slice(0, 3)), longHair: fem && r() < 0.6,
      shoe: r() < 0.25 ? '#e8e6e1' : '#1a1a1c', phase: r() < 0.5 ? 1 : 0, back: r() < 0.5,
      bag: pick(['none', 'none', 'tote', 'cross', 'pack']), bagColor: pick(['#5a4030', '#22242a', '#7a2f2f', '#2b3a4e', '#b9a17c']),
      inner: pick(['#e8e6e1', '#cfd6dd', '#2b2d31', '#b33a3a']),
      ...(o || {}),
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
