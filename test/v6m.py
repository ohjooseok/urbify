import asyncio, sys, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width":390,"height":800}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type in ("error",) and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(1000)
        ev = pg.evaluate
        # 평면 두 번 두드림 → 크게
        await pg.touchscreen.tap(200, 520); await pg.wait_for_timeout(120); await pg.touchscreen.tap(200, 520); await pg.wait_for_timeout(700)
        print("double tap:", await ev("[UDS.app.state.max, UDS.app.r2.W, UDS.app.r2.H]"))
        await pg.screenshot(path=OUTD + "/m_max.png")
        await pg.touchscreen.tap(200, 420); await pg.wait_for_timeout(120); await pg.touchscreen.tap(200, 420); await pg.wait_for_timeout(700)
        print("double tap again:", await ev("[UDS.app.state.max, UDS.app.r2.W, UDS.app.r2.H]"))
        # 천천히 두 번(0.7초 간격)은 크게 보기가 아님
        await pg.touchscreen.tap(200, 520); await pg.wait_for_timeout(700); await pg.touchscreen.tap(200, 520); await pg.wait_for_timeout(500)
        print("slow taps:", await ev("UDS.app.state.max"))
        # 크게 보기 단추
        await pg.locator('#v2d [data-act="max"]').tap(); await pg.wait_for_timeout(600)
        print("button:", await ev("UDS.app.state.max"))
        await pg.locator('#v2d [data-act="max"]').tap(); await pg.wait_for_timeout(600)
        print("button again:", await ev("UDS.app.state.max"))
        # 단면: 눈 단추 → 표시 항목
        await pg.locator('.mtabs [data-mview-btn="sec"]').tap(); await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUTD + "/m_sec0.png")
        await pg.locator('[data-act="secshowpop"]').tap(); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUTD + "/m_sec1.png")
        await pg.locator('#pop [data-secshow="util"]').tap(); await pg.wait_for_timeout(300)
        await pg.locator('#pop [data-secshow="dim"]').tap(); await pg.wait_for_timeout(300)
        print("secShow:", await ev("UDS.app.state.secShow"))
        await ev("UDS.ui.closePop()"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUTD + "/m_sec2.png")
        # 조경 묶음: 수종 바꾸기
        await pg.locator('.mtabs [data-mview-btn="2d"]').tap(); await pg.wait_for_timeout(300)
        await pg.locator('[data-act="palgrp"][data-arg="land"]').tap(); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUTD + "/m_land.png")
        print("species default:", await ev("document.querySelector('#pop select.palsp').value"))
        await pg.select_option('#pop select.palsp', 'pine'); await pg.wait_for_timeout(400)
        print("after species:", await ev("[UDS.app.state.treeSpecies, UDS.app.state.tool, UDS.app.state.placeType, document.querySelector('#pop').hidden]"))
        await pg.screenshot(path=OUTD + "/m_tree.png")
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
