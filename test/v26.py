"""v26: 발표용 표현
- 3D 선 도면의 선 굵기 위계(땅에 닿는 선 > 건물 모서리·지붕 > 바닥·도로 > 노면 표시·시설물)와 가늘게·보통·굵게 단계
- 발표 화면(three.js, 처음 열 때만 vendor/three-urbify.js 를 불러옴): 같은 모형(입면·수목), 주변광 가림, 그림자, 선 겹치기,
  눈높이 걷기(1.6m, 건물에 막힘), VR 단추(지원하지 않는 브라우저에서는 안내), 그림 저장(두 배 해상도), 닫기·Esc
- 묶음 파일이 없을 때 안내"""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD
from playwright.async_api import async_playwright
ok = True
def check(msg, c, info=None):
    global ok
    print(("PASS " if c else "FAIL ") + msg + (f"  [{info}]" if info is not None else ""))
    if not c: ok = False

async def page(b, logs):
    pg = await b.new_page(viewport={"width": 1280, "height": 800})
    pg.on("console", lambda m: logs.append(m.text) if m.type == "error" and "net::" not in m.text and "sites.json" not in m.text and "ERR_FILE_NOT_FOUND" not in m.text else None)
    pg.on("pageerror", lambda e: logs.append("PAGEERROR: " + str(e)))
    await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    await pg.goto(URL); await pg.wait_for_timeout(1200)
    return pg

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH())
        logs = []
        pg = await page(b, logs)
        ev = pg.evaluate
        await ev("""(() => { const a = UDS.app; a.state.view = '3d'; document.querySelector('#app').dataset.view = '3d'; UDS.ui.top && UDS.ui.top(); a.resize && a.resize();
          const r = a.r3; r.cam.dist = 230; r.cam.pitch = 0.45; r.cam.yaw = -0.75; a.invalidate(2); })()""")
        # ---------- 선 굵기 위계 ----------
        w = await ev("""(() => { const S = UDS.app.r3.buildScene({}), c = [0, 0, 0, 0]; S.edges.Wt.forEach((x) => c[x]++); return c; })()""")
        check('edge weight classes all present (hair, light, mid, heavy)', all(x > 0 for x in w), w)
        dark = """(() => { const a = UDS.app, r = a.r3; r.draw(); const gl = r.gl, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 150) n++; return n / (W * H); })()"""
        await ev("UDS.ui.setMode('line', '3d')")
        res = {}
        for lw in (0.7, 1, 1.5):
            await ev(f"(() => {{ UDS.app.state.lineW = {lw}; }})()")
            res[lw] = await ev(dark)
        check('3D line mode: thicker setting gives more ink (가늘게 < 보통 < 굵게)', res[0.7] < res[1] < res[1.5], {k: round(v, 4) for k, v in res.items()})
        inst = await ev("(() => { const m = UDS.app.r3.meshes.edges; return { n: m.count, prog: !!UDS.app.r3.tprog }; })()")
        check('edges drawn as instanced quads', inst['n'] > 100 and inst['prog'], inst)
        el = await pg.query_selector('#v3d')
        if el: await el.screenshot(path=os.path.join(OUTD, 'v26_line_weights.png'))
        # 보기 메뉴의 선 굵기
        await ev("UDS.ui.setMode('color', '3d')")
        await pg.click('[data-act="menu"][data-arg="view"]'); await pg.wait_for_timeout(250)
        items = await ev("[...document.querySelectorAll('#pop [data-act=linew]')].map(b => b.textContent.trim())")
        check('view menu lists line weights 가늘게·보통·굵게', items == ['가늘게', '보통', '굵게'], items)
        await pg.click('#pop [data-act=linew][data-arg="1.5"]'); await pg.wait_for_timeout(300)
        st = await ev("({ w: UDS.app.state.lineW, m: UDS.app.modeOf('3d') })")
        check('choosing 굵게 sets the weight and switches 3D to line drawing', st == {'w': 1.5, 'm': 'line'}, st)
        await ev("UDS.ui.setMode('color', '3d'); UDS.app.state.lineW = 1;")
        # ---------- 발표 화면 ----------
        btn = await pg.query_selector('#v3d [data-act="present"], [data-act="present"]')
        check('3D header has a presentation-view button', btn is not None)
        await btn.click()
        for i in range(80):
            await pg.wait_for_timeout(400)
            if await ev("!!(UDS.Present.state() && UDS.Present.state().frames)"): break
        info = await ev("""(() => { const s = UDS.Present.state(); if (!s) return null;
          return { rev: window.THREE_U && window.THREE_U.REVISION, meshes: s.model.children.length, frames: s.frames, env: !!s.scene.environment,
            loadHidden: s.root.querySelector('.presLoad').hidden, sky: !!s.sky, shadows: s.sun.castShadow }; })()""")
        check('presentation view loads three.js r187 on demand and draws the model', bool(info) and info['rev'] == '187' and info['meshes'] >= 3 and info['frames'] >= 1 and info['loadHidden'], info)
        wnd = await ev("""(() => { const s = UDS.Present.state(); let bad = 0, n = 0;
          s.model.children.forEach((m) => { const g = m.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array;
            for (let t = 0; t + 2 < I.length; t += 3) { const a = I[t] * 3, c = I[t + 1] * 3, d = I[t + 2] * 3;
              const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
              const f = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], nn = [N[a] + N[c] + N[d], N[a + 1] + N[c + 1] + N[d + 1], N[a + 2] + N[c + 2] + N[d + 2]];
              const dt = f[0] * nn[0] + f[1] * nn[1] + f[2] * nn[2]; const lf = Math.hypot(...f), lnn = Math.hypot(...nn); if (lf > 1e-6 && lnn > 1e-6) { n++; if (dt < -0.1 * lf * lnn) bad++; } } }); // 거의 직각(판단 불가)인 삼각형은 빼고
          return { n, bad }; })()""")
        check('triangles wound to face their normals (lit tree crowns)', wnd['n'] > 1000 and wnd['bad'] == 0, wnd)
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=os.path.join(OUTD, 'v26_present_orbit.png'))
        # 선 겹치기
        await ev("(() => { const c = UDS.Present.state().root.querySelector('[data-po=lines]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()")
        await pg.wait_for_timeout(1200)
        ln = await ev("(() => { const s = UDS.Present.state(); return s.lines ? { groups: s.lines.children.length, vis: s.lines.visible } : null; })()")
        check('line overlay uses the weight classes as separate line widths', bool(ln) and ln['groups'] >= 3 and ln['vis'], ln)
        await pg.screenshot(path=os.path.join(OUTD, 'v26_present_lines.png'))
        await ev("(() => { const c = UDS.Present.state().root.querySelector('[data-po=lines]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()")
        # 눈높이 걷기
        await ev("UDS.Present.state().root.querySelector('[data-pm=walk]').click()")
        await pg.wait_for_timeout(800)
        wk = await ev("(() => { const s = UDS.Present.state(); return { mode: s.mode, y: +s.camera.position.y.toFixed(3), w: s.walk }; })()")
        check('walk mode puts the eye at 1.6m', wk['mode'] == 'walk' and abs(wk['y'] - 1.6) < 1e-6, wk)
        mv = await ev("""(() => { const s = UDS.Present.state(), w = s.walk, x0 = w.x, y0 = w.y; s.keys.add('KeyW'); for (let i = 0; i < 20; i++) UDS.Present.test.step(0.1); s.keys.delete('KeyW');
          return { d: Math.hypot(w.x - x0, w.y - y0), y: s.camera.position.y }; })()""")
        check('W walks forward about 1.5 m/s at eye height', 2.0 < mv['d'] < 3.2 and abs(mv['y'] - 1.6) < 1e-6, mv)
        col = await ev("""(() => { const a = UDS.app, s = UDS.Present.state(), b = a.D.buildings.find((x) => x.fp && x.fp.length >= 3); if (!b) return null;
          const P = b.fp, c = P.reduce((q, p) => [q[0] + p[0] / P.length, q[1] + p[1] / P.length], [0, 0]);
          const e = P[0], m = [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2], dir = UDS.U.norm(UDS.U.sub(m, c)), st = UDS.U.add(m, UDS.U.mul(dir, 1.5));
          s.walk.x = st[0]; s.walk.y = st[1]; s.walk.yaw = Math.atan2(dir[0], -dir[1]) ; // 벽 쪽(안쪽)을 보게: 앞 = (-sin, -cos) = -dir(평면 y는 -z)
          const fx = -Math.sin(s.walk.yaw), fy = Math.cos(s.walk.yaw); // 평면 좌표로 본 앞
          s.keys.add('KeyW'); for (let i = 0; i < 40; i++) UDS.Present.test.step(0.1); s.keys.delete('KeyW');
          return { inside: UDS.U.pointInPoly([s.walk.x, s.walk.y], P), toward: fx * -dir[0] + fy * -dir[1], blocked: UDS.Present.test.blocked(s.walk.x, s.walk.y) }; })()""")
        check('walking into a building stops at the wall', bool(col) and not col['inside'] and not col['blocked'] and col['toward'] > 0.9, col)
        await pg.screenshot(path=os.path.join(OUTD, 'v26_present_walk.png'))
        # VR 단추: 이 브라우저(머리띠 기기 없음)에서는 안내
        await ev("UDS.Present.state().root.querySelector('[data-pm=vr]').click()")
        await pg.wait_for_timeout(700)
        toast = await ev("(() => { const t = document.querySelector('.toast'); return t ? t.textContent : ''; })()")
        check('VR button explains when WebXR is unavailable', 'VR' in toast and 'WebXR' in toast, toast[:60])
        # 그림 저장
        await ev("UDS.Present.state().root.querySelector('[data-pa=shot]').click()")
        await pg.wait_for_timeout(2500)
        im = await ev("""(() => { const im = document.querySelector('#dialog img'), s = UDS.Present.state(); return im ? { src: im.src.slice(0, 22), w: im.naturalWidth, cw: s.cv.width } : null; })()""")
        check('save picture renders at double resolution', bool(im) and im['src'].startswith('data:image/png') and im['w'] >= im['cw'] * 1.9, im)
        await ev("UDS.ui.closeDialog()")
        # 닫기(Esc)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(500)
        cl = await ev("({ gone: !document.querySelector('.pres'), st: !!UDS.Present.state(), r3: UDS.app.r3.ok })")
        check('Esc closes the presentation view and the plan 3D keeps working', cl == {'gone': True, 'st': False, 'r3': True}, cl)
        check('no console errors', not logs, logs[:4])
        # 묶음 파일이 없을 때
        logs2 = []
        pg2 = await page(b, logs2)
        await pg2.evaluate("UDS.Present.src = 'vendor/none.js'; UDS.Present.open()")
        await pg2.wait_for_timeout(1500)
        msg = await pg2.evaluate("(() => { const l = document.querySelector('.pres .presLoad'); return l ? l.textContent : ''; })()")
        check('missing bundle shows a clear message', '불러오지 못했습니다' in msg, msg[:50])
        await b.close()
    print('ALL PASS' if ok else 'SOME FAILED')
    sys.exit(0 if ok else 1)

asyncio.run(main())
