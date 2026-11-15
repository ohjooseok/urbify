import asyncio, sys, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width":360,"height":740}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type in ("error",) and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(1000)
        ev = pg.evaluate
        await pg.locator('[data-act="palgrp"][data-arg="bld"]').tap(); await pg.wait_for_timeout(300)
        await pg.locator('#pop [data-pal="build:mixed"]').tap(); await pg.wait_for_timeout(300)
        print("tool:", await ev("[UDS.app.state.tool, UDS.app.state.buildUse, document.querySelector('#pop').hidden]"))
        info = await ev("(()=>{const a=UDS.app; const l=a.D.lots.find(x=>x.use==='res'&&x.building); const c=UDS.U.interiorPoint(l.poly); const r=a.r2.cv.getBoundingClientRect(), q=a.r2.w2s(c); return {id:l.id, x:r.left+q[0], y:r.top+q[1]};})()")
        await pg.touchscreen.tap(info['x'], info['y']); await pg.wait_for_timeout(600)
        print("placed:", await ev(f"(()=>{{const l=UDS.app.D.lots.find(x=>x.id==={json.dumps(info['id'])}); return [l.use, l.building&&l.building.floors]}})()"), "sel:", await ev("UDS.app.state.sel"))
        await pg.screenshot(path=OUTD + "/b_m_placed.png")
        print("brand width:", await ev("document.querySelector('.brand b').getBoundingClientRect().width"), "top overflow:", await ev("(()=>{const t=document.querySelector('.top'); return [t.scrollWidth, t.clientWidth]})()"))
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
