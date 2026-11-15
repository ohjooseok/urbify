import asyncio, sys, json
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
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type in ("error",) and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(1000)
        ev = pg.evaluate
        sb = await pg.locator('#cvsec').bounding_box()
        g = await ev("(()=>{const g=UDS.app.sec.geo; const q=g.bands[3]; return {x:(q.x0+q.x1)/2, y:g.gy-60, gy:g.gy, xR:g.xR, pipes:g.pipes.map(p=>[p.x,p.y,p.u.type])}})()")
        segs0 = await ev("UDS.app.secRoad().segs.map(s=>s.type+':'+s.w)")
        await pg.mouse.click(sb['x']+g['x'], sb['y']+g['y']); await pg.wait_for_timeout(300)
        print("band click: selSeg idx", await ev("UDS.app.secRoad().segs.findIndex(s=>s.id===UDS.app.state.selSeg)"), "focus:", await ev("document.activeElement.id"), "outline:", await ev("getComputedStyle(document.getElementById('cvsec')).outlineStyle"))
        await pg.keyboard.press("ArrowRight"); await pg.wait_for_timeout(200)
        print("→ idx", await ev("UDS.app.secRoad().segs.findIndex(s=>s.id===UDS.app.state.selSeg)"))
        await pg.keyboard.press("+"); await pg.wait_for_timeout(300)
        print("+ :", await ev("UDS.app.secRoad().segs.map(s=>s.w)"))
        await pg.keyboard.press("Delete"); await pg.wait_for_timeout(400)
        print("Delete band:", len(segs0), "->", await ev("UDS.app.secRoad().segs.length"))
        await pg.keyboard.press("Control+z"); await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(400)
        # 관 고르고 Delete
        g = await ev("(()=>{const g=UDS.app.sec.geo; return {pipes:g.pipes.map(p=>[p.x,p.y,p.u.type]), gy:g.gy, xR:g.xR}})()")
        n0 = await ev("UDS.app.secRoad().utils.length")
        await pg.mouse.click(sb['x']+g['pipes'][0][0], sb['y']+g['pipes'][0][1]); await pg.wait_for_timeout(300)
        print("pipe sel:", await ev("!!UDS.app.state.selUtil"))
        await pg.keyboard.press("Delete"); await pg.wait_for_timeout(400)
        print("Delete pipe:", n0, "->", await ev("UDS.app.secRoad().utils.length"))
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(400)
        # 옆 건물 고르고 Delete → 건물이 지워짐(구간이 아니라)
        await pg.mouse.click(sb['x']+g['pipes'][0][0], sb['y']+g['gy']-60); await pg.wait_for_timeout(200)  # 구간을 먼저 골라 둠
        nb = await ev("UDS.app.D.buildings.length"); ns = await ev("UDS.app.secRoad().segs.length")
        await pg.mouse.click(sb['x']+g['xR']+120, sb['y']+g['gy']-80); await pg.wait_for_timeout(400)
        print("side click sel:", await ev("UDS.app.state.sel"), "selSeg kept:", await ev("!!UDS.app.state.selSeg"))
        await pg.keyboard.press("Delete"); await pg.wait_for_timeout(500)
        print("Delete side building: bld", nb, "->", await ev("UDS.app.D.buildings.length"), "segs", ns, "->", await ev("UDS.app.secRoad().segs.length"))
        # 기반시설을 끈 채 지하시설 추가 → 다시 켜짐
        await ev("document.querySelector('[data-act=\"secshow\"][data-arg=\"util\"]').click()"); await pg.wait_for_timeout(200)
        print("infra off:", await ev("UDS.app.state.secShow.util"), "pipes in geo:", await ev("UDS.app.sec.geo.pipes.length"))
        await ev("UDS.app.addUtil('gas')"); await pg.wait_for_timeout(300)
        print("after addUtil infra:", await ev("UDS.app.state.secShow.util"), "pressed:", await ev("document.querySelector('[data-act=\"secshow\"][data-arg=\"util\"]').getAttribute('aria-pressed')"))
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
