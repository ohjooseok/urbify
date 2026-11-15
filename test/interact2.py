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
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        ev = pg.evaluate
        sbox = await pg.locator('#cvsec').bounding_box()
        g = await ev("(()=>{const g=UDS.app.sec.geo; return g.pipes.map(p=>({id:p.u.id,type:p.u.type,x:p.x,y:p.y,r:p.r,off:p.u.off,depth:p.u.depth}))})()")
        print(json.dumps(g, ensure_ascii=False))
        p0 = g[0]
        h = await ev(f"(()=>{{const h=UDS.app.sec.hit({p0['x']},{p0['y']}); return h? h.kind+':'+(h.id||h.i):null}})()")
        print("hit at pipe0:", h)
        await pg.mouse.move(sbox['x']+p0['x'], sbox['y']+p0['y']); await pg.mouse.down()
        await pg.mouse.move(sbox['x']+p0['x']-30, sbox['y']+p0['y']+15, steps=4); await pg.mouse.up(); await pg.wait_for_timeout(300)
        print("after:", await ev(f"(()=>{{const u=UDS.app.secRoad().utils.find(z=>z.id==='{p0['id']}'); return [u.off,u.depth]}})()"), "hist", await ev("[UDS.app.hist.length, UDS.app.hi]"))
        # 레이어: 지하 투시
        await pg.click('[data-act="menu"][data-arg="view"]:visible'); await pg.wait_for_timeout(150); await pg.click('#pop [data-act="layers"]'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=OUTD + "/i3.png")
        print("pop html len", await ev("document.getElementById('pop').innerHTML.length"))
        await ev("UDS.ui.closeOverlays()")
        # 대상지 전환 → 확인 대화상자
        await pg.click('[data-scene="oldtown"]'); await pg.wait_for_timeout(300)
        print("dialog open:", await ev("document.getElementById('dialog').hidden===false || document.getElementById('dialog').classList.contains('open')"), await ev("document.getElementById('dialog').innerText.slice(0,120)"))
        await pg.screenshot(path=OUTD + "/i4.png")
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
