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
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        for tag, show in [("all", {"text":True,"dim":True,"util":True}), ("clean", {"text":False,"dim":False,"util":False}), ("noinfra", {"text":True,"dim":True,"util":False})]:
            svg = await pg.evaluate("(sh)=>{const a=UDS.app; Object.assign(a.state.secShow, sh); const r=a.P.roads.find(x=>x.name.startsWith('남측')); a.select({type:'road',id:r.id}); return a.sec.exportSVG();}", show)
            open(f"{OUTD}/sec_{tag}.svg","w",encoding="utf-8").write(svg)
            import re
            print(tag, len(svg), "texts:", len(re.findall("<text", svg)), "has zigzag fill? n/a", "viewBox:", re.search(r'viewBox="([^"]+)"', svg).group(1), "minY path coords<0:", len(re.findall(r'[ML](-?\d+\.?\d*) (-\d+\.?\d*)', svg)))
            pg2 = await ctx.new_page(); await pg2.goto("file://" + OUTD + "/sec_%s.svg" % tag); await pg2.wait_for_timeout(300); await pg2.screenshot(path=f"{OUTD}/sec_{tag}.png"); await pg2.close()
        print("\n".join(logs) or "no errors")
        await b.close()
asyncio.run(main())
