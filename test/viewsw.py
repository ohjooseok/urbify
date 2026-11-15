import asyncio, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width":1440,"height":900})
        pg = await ctx.new_page()
        logs=[]
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        pg.on("console", lambda m: logs.append(m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        ev = pg.evaluate
        q = "(()=>{const a=UDS.app; const r=(id)=>{const e=document.getElementById(id).getBoundingClientRect(); return [Math.round(e.width),Math.round(e.height)]}; return {view:a.state.view, mode:a.state.mode, v2d:r('v2d'), v3d:r('v3d'), cv2d:[a.r2.W|0,a.r2.H|0]}})()"
        for k in ['2d','3d','split']:
            await pg.click(f'button[data-view-btn="{k}"]:visible'); await pg.wait_for_timeout(400)
            print(k, await ev(q))
            await pg.screenshot(path=f"{OUTD}/v_{k}.png")
        await pg.click('button[data-mode="line"]:visible'); await pg.wait_for_timeout(400)
        print("mode", await ev("UDS.app.state.mode"))
        await pg.click('button[data-scene="oldtown"]'); await pg.wait_for_timeout(300)
        await pg.wait_for_timeout(600)
        print("scene", await ev("UDS.app.P.meta.scene"), "pressed:", await ev("[...document.querySelectorAll('button[data-scene]')].map(b=>b.getAttribute('aria-pressed')).join(',')"))
        print("errors:", logs[:5] or "none")
        await b.close()
asyncio.run(main())
