"""v24: 끊긴 도로 잇기 — 선택 도구에서 고른 도로의 끝 손잡이를 끌어 다른 도로에 잇기.
같은 단면이면 한 도로로 합침(이름은 실제 이름 쪽), 단면이 다르면 두 도로로 둔 채 끝만 맞춤, 다른 도로 위(T자)에 놓으면 교차로.
끝 손잡이가 아닌 곳을 끌면 예전처럼 화면이 움직임, 되돌리기, 끊긴 끝 손잡이는 속을 칠함"""
import asyncio, os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD
from playwright.async_api import async_playwright
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
ok = True
def check(msg, c, info=None):
    global ok
    print(("PASS " if c else "FAIL ") + msg + (f"  [{info}]" if info is not None else ""))
    if not c: ok = False


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        logs = []
        pg.on("console", lambda m: logs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text and "net::" not in m.text and "sites.json" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: " + str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(1000)
        ev = pg.evaluate

        await ev("""(() => {
          const a = UDS.app, M = UDS.Model; a.setScene('blank', { w: 600, h: 400 });
          a.state.view = '2d'; document.querySelector('#app').dataset.view = '2d'; UDS.ui.top && UDS.ui.top(); a.resize && a.resize();
          a.P.roads.push(M.makeRoad('jung3', [[0, 200], [250, 200]], { name: '중로 7' }));
          a.P.roads.push(M.makeRoad('jung3', [[262, 200], [600, 200]], { name: '시장길' }));
          a.P.roads.push(M.makeRoad('so1', [[300, 0], [300, 188]], { name: '세로길' }));
          a.P.roads.push(M.makeRoad('so1', [[0, 330], [250, 330]], { name: '윗길' }));
          a.P.roads.push(M.makeRoad('jung3', [[256, 330], [600, 330]], { name: '윗길 2' }));
          a.commit(); a.setTool('select');
        })()""")
        await pg.wait_for_timeout(400)
        await ev("(() => { const v = UDS.app.r2.view; v.cx = 280; v.cy = 220; v.s = 2.2; UDS.app.invalidate(7); })()")
        await pg.wait_for_timeout(300)
        S = "(p) => { const r2 = UDS.app.r2, s = r2.w2s(p), bb = r2.cv.getBoundingClientRect(); return [bb.left + s[0], bb.top + s[1]]; }"
        async def scr(pt): return await ev(S, pt)
        async def drag(a, z, steps=12):
            await pg.mouse.move(*a); await pg.mouse.down(); await pg.wait_for_timeout(60)
            await pg.mouse.move(*z, steps=steps); await pg.wait_for_timeout(80); await pg.mouse.up(); await pg.wait_for_timeout(400)
        n0 = await ev("UDS.app.P.roads.length")
        dead0 = await ev("UDS.app.D.deadEnds.length")
        check('setup: gaps leave dead ends', n0 == 5 and dead0 >= 4, (n0, dead0))

        # 1) 같은 단면: 끝을 끌어 다른 도로 끝에 놓으면 한 도로로
        rid = await ev("UDS.app.P.roads.find((r) => r.name === '중로 7').id")
        await ev(f"UDS.app.select({{ type: 'road', id: '{rid}' }}); UDS.app.invalidate(7)")
        await pg.wait_for_timeout(200)
        h = await ev("(() => { const a = UDS.app, r2 = a.r2, s = r2.w2s([250, 200]); return !!a.roadEndAt(s, 11); })()")
        check('end handle under pointer (select tool)', h)
        await pg.screenshot(path=OUTD + '/v24_handles.png')
        await drag(await scr([250, 200]), await scr([262, 200]))
        r1 = await ev("(() => { const a = UDS.app, r = a.P.roads.find((x) => x.pts.some((p) => p[0] === 0 && p[1] === 200)); return { n: a.P.roads.length, name: r && r.name, pts: r && r.pts, sel: a.state.sel, toast: document.querySelector('#toast').textContent, dead: a.D.deadEnds.filter((d) => Math.abs(d.p[1] - 200) < 1).length }; })()")
        check('same cross-section joined into one road', r1['n'] == n0 - 1 and r1['pts'][0] == [0, 200] and r1['pts'][-1] == [600, 200], r1)
        check('real name kept over generic one', r1['name'] == '시장길', r1['name'])
        check('joined road stays selected, toast says so', r1['sel'] and r1['sel']['type'] == 'road' and '한 도로' in r1['toast'], (r1['sel'], r1['toast']))
        check('no dead end left on the joined road', r1['dead'] == 0, r1['dead'])
        await ev("UDS.app.undo()"); await pg.wait_for_timeout(300)
        check('undo splits them again', await ev("UDS.app.P.roads.length") == n0)
        await ev("UDS.app.redo()"); await pg.wait_for_timeout(300)
        check('redo joins again', await ev("UDS.app.P.roads.length") == n0 - 1)

        # 2) 다른 도로 위(T자)에 놓기: 교차로가 되고 합치지 않음
        vid = await ev("UDS.app.P.roads.find((r) => r.name === '세로길').id")
        await ev(f"UDS.app.select({{ type: 'road', id: '{vid}' }}); UDS.app.invalidate(7)")
        await pg.wait_for_timeout(200)
        await drag(await scr([300, 188]), await scr([300, 199]))
        r2 = await ev(f"(() => {{ const a = UDS.app, r = a.road('{vid}'); return {{ n: a.P.roads.length, end: r.pts[r.pts.length - 1], dead: a.D.deadEnds.filter((d) => d.roadId === '{vid}').length, toast: document.querySelector('#toast').textContent, blocks: a.D.blocks.length }}; }})()")
        check('end dropped on a road line makes a T-junction', abs(r2['end'][1] - 200) < 0.05 and r2['dead'] == 0 and r2['n'] == n0 - 1, r2)
        check('toast: connected', r2['toast'] == '도로를 이었습니다.', r2['toast'])

        # 3) 단면이 다른 두 도로: 끝만 맞추고 두 도로로 둠
        uid = await ev("UDS.app.P.roads.find((r) => r.name === '윗길').id")
        await ev(f"(() => {{ const v = UDS.app.r2.view; v.cx = 240; v.cy = 320; UDS.app.select({{ type: 'road', id: '{uid}' }}); UDS.app.invalidate(7); }})()")
        await pg.wait_for_timeout(200)
        await drag(await scr([250, 330]), await scr([256, 330]))
        r3 = await ev(f"(() => {{ const a = UDS.app, r = a.road('{uid}'); return {{ n: a.P.roads.length, end: r.pts[r.pts.length - 1], dead: a.D.deadEnds.filter((d) => d.roadId === '{uid}' && d.p[0] > 200).length, toast: document.querySelector('#toast').textContent }}; }})()")
        check('different cross-sections: connected, kept as two roads', r3['end'] == [256, 330] and r3['dead'] == 0 and r3['n'] == n0 - 1, r3)
        check('toast explains why not merged', '단면이 달라' in r3['toast'], r3['toast'])

        # 4) 손잡이가 아닌 곳을 끌면 화면이 움직이고 도로는 그대로
        v0 = await ev("[UDS.app.r2.view.cx, UDS.app.r2.view.cy]")
        pts0 = await ev(f"JSON.stringify(UDS.app.road('{uid}').pts)")
        await drag(await scr([120, 330]), await scr([140, 300]))
        v1 = await ev("[UDS.app.r2.view.cx, UDS.app.r2.view.cy]")
        check('dragging elsewhere still pans the view', abs(v1[0] - v0[0]) > 3 and await ev(f"JSON.stringify(UDS.app.road('{uid}').pts)") == pts0, (v0, v1))

        # 5) 이동 도구에서 끝을 끌어도 같은 규칙(같은 단면이면 합침)
        await ev("""(() => { const a = UDS.app, M = UDS.Model; a.P.roads.push(M.makeRoad('so1', [[0, 30], [200, 30]], { name: '아랫길' })); a.P.roads.push(M.makeRoad('so1', [[207, 30], [290, 30]], { name: '소로 3' })); a.commit(); a.setTool('move'); const r = a.P.roads.find((x) => x.name === '아랫길'); a.select({ type: 'road', id: r.id }); const v = a.r2.view; v.cx = 200; v.cy = 60; a.invalidate(7); })()""")
        await pg.wait_for_timeout(300)
        n5 = await ev("UDS.app.P.roads.length")
        await drag(await scr([200, 30]), await scr([207, 30]))
        r5 = await ev("(() => { const a = UDS.app, r = a.P.roads.find((x) => x.name === '아랫길'); return { n: a.P.roads.length, pts: r && r.pts }; })()")
        check('move tool: end drag joins same cross-section too', r5['n'] == n5 - 1 and r5['pts'] and r5['pts'][-1] == [290, 30], r5)
        await ev("UDS.app.setTool('select')")
        await pg.screenshot(path=OUTD + '/v24_after.png')
        check('no page errors', not logs, logs[:5])
        await b.close()
    print('ALL PASS' if ok else 'SOME FAILED')
    sys.exit(0 if ok else 1)


asyncio.run(main())
