"""v23: 메뉴·표현 손질 — 계획 패널 대상지 목록([지도에서 삽입], 지도 캡처는 새 프로젝트에만),
보행자우선도로 회색 포장(평면·3D 같은 색), 막다른 도로 끝의 빨간 고리는 [법규검토] 탭을 볼 때만 평면에(목록에는 늘)"""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD
from playwright.async_api import async_playwright
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
ok = True
def check(msg, c, info=None):
    global ok
    print(("PASS " if c else "FAIL ") + msg + (f"  [{info}]" if info is not None else ""))
    if not c: ok = False

# 평면 화면에서 막다른 끝 둘레(반지름 7px)에 빨간 고리가 있는지: 둘레 여러 곳의 화소를 본다
RING = """(() => {
  const a = UDS.app, r2 = a.r2, d = a.D.deadEnds[0]; if (!d) return null;
  const [x, y] = r2.w2s(d.p), cv = r2.cv, k = cv.width / cv.clientWidth, g = cv.getContext('2d');
  let red = 0;
  for (let i = 0; i < 24; i++) { const t = (i / 24) * Math.PI * 2, px = Math.round((x + Math.cos(t) * 7) * k), py = Math.round((y + Math.sin(t) * 7) * k);
    const c = g.getImageData(px, py, 1, 1).data; if (c[0] > 180 && c[1] < 150 && c[2] < 140 && c[0] - c[1] > 60) red++; }
  return red;
})()"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        logs = []
        pg.on("console", lambda m: logs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text and "net::" not in m.text and "sites.json" not in m.text else None)  # 파일로 열면 수업 자료 목록(sites.json)을 못 읽음(시험 환경 탓)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: " + str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(1000)
        ev = pg.evaluate

        # 1) 계획 패널 대상지 목록
        items = await ev("[...document.querySelectorAll('[data-scene]')].filter((x) => x.offsetParent).map((x) => x.dataset.scene + ':' + x.textContent.trim())")
        check('site list has [지도에서 삽입]', 'real:지도에서 삽입' in items, items)
        check('map capture removed from site list', not any(x.startswith('import:') for x in items), items)
        await pg.click('.mb[data-act="menu"][data-arg="project"]'); await pg.wait_for_timeout(200)
        menu = await ev("[...document.querySelectorAll('#pop .mm .ml')].map((x) => x.textContent)")
        check('project menu says 지도에서 삽입…', '지도에서 삽입…' in menu and not any('실제 지역 불러오기' in x for x in menu), menu)
        await pg.click('#pop [data-act="newproject"]'); await pg.wait_for_timeout(200)
        cards = await ev("[...document.querySelectorAll('[data-new]')].map((x) => x.dataset.new + ':' + ((x.querySelector('b') || x).textContent.trim()))")
        check('new project: 지도에서 삽입 and map capture kept', 'real:지도에서 삽입' in cards and 'import:지도 캡처로 만들기' in cards, cards)
        await ev("document.querySelector('[data-new=\"real\"]').click()"); await pg.wait_for_timeout(500)
        check('지도에서 삽입 opens the site picker', await ev("!!document.querySelector('.dlg.site') || !!document.querySelector('.dlg')"))
        await ev("UDS.ui.closeDialog()"); await pg.wait_for_timeout(200)

        # 2) 보행자우선도로: 회색(평면·3D가 같은 구간 색을 씀)
        col = await ev("UDS.C.SEG.shared.color")
        rgb = [int(col[i:i + 2], 16) for i in (1, 3, 5)]
        check('shared street is grey', max(rgb) - min(rgb) <= 14 and 120 < sum(rgb) / 3 < 200, col)
        lane = await ev("UDS.C.SEG.lane.color")
        check('lighter than drive lane (still tells apart)', sum(rgb) > sum(int(lane[i:i + 2], 16) for i in (1, 3, 5)), (col, lane))
        # 구도심 대상지의 보행자우선도로가 평면에 회색으로 칠해지는지(구간 가운데 화소)
        await ev("UDS.app.setScene('oldtown')"); await pg.wait_for_timeout(600)
        await ev("(() => { const a = UDS.app; a.state.view = '2d'; document.querySelector('#app').dataset.view = '2d'; UDS.ui.top && UDS.ui.top(); a.resize && a.resize(); })()")
        await pg.wait_for_timeout(400)
        px = await ev("""(() => {
          const a = UDS.app, r2 = a.r2;
          const arm = a.D.arms.find((x) => x.geo.bands.some((bp) => bp.band.def === UDS.C.SEG.shared)); if (!arm) return null;
          const bp = arm.geo.bands.find((q) => q.band.def === UDS.C.SEG.shared), c = bp.poly.reduce((s, q) => [s[0] + q[0] / bp.poly.length, s[1] + q[1] / bp.poly.length], [0, 0]);
          r2.view.cx = c[0]; r2.view.cy = c[1]; r2.view.s = 6; r2.draw();
          const [x, y] = r2.w2s(c), cv = r2.cv, k = cv.width / cv.clientWidth; return [...cv.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data];
        })()""")
        check('plan paints shared street grey', px is not None and max(px[:3]) - min(px[:3]) <= 18, px)

        # 3) 막다른 도로: 목록에는 늘, 평면 빨간 고리는 [법규검토] 탭에서만
        await ev("(() => { const a = UDS.app; a.setScene('blank', { w: 300, h: 200 }); a.setTool('road', 'jung3'); a.roadClick([0, 100]); a.roadClick([150, 100]); a.finishRoad(); a.setTool('select'); a.state.sel = null; a.state.tab = 'props'; UDS.ui.pane(); const r2 = a.r2; r2.view.cx = 150; r2.view.cy = 100; r2.view.s = 3; a.invalidate(1); })()")
        await pg.wait_for_timeout(400)
        n = await ev("UDS.app.D.deadEnds.length")
        listed = await ev("UDS.app.D.checks.filter((c) => /막다른 도로 끝/.test(c.msg || c.text || '')).length")
        check('dead end found and listed in checks', n == 1 and listed == 1, (n, listed))
        red0 = await ev(RING)
        await pg.screenshot(path=OUTD + '/v23_props.png')
        await pg.click('#tabs [data-tab="checks"]'); await pg.wait_for_timeout(400)
        red1 = await ev(RING)
        txt = await ev("document.querySelector('#pane').innerText")
        await pg.screenshot(path=OUTD + '/v23_checks.png')
        check('no red ring on plan in normal view', red0 == 0, red0)
        check('red ring shown while 법규검토 tab is open', red1 >= 6, red1)
        check('법규검토 lists the dead end', '막다른 도로 끝' in txt)
        await pg.click('#tabs [data-tab="props"]'); await pg.wait_for_timeout(400)
        check('ring hides again when leaving 법규검토', await ev(RING) == 0)

        check('no page errors', not logs, logs[:5])
        await b.close()
    print('ALL PASS' if ok else 'SOME FAILED')
    sys.exit(0 if ok else 1)


asyncio.run(main())
