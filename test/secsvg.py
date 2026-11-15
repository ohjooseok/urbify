import asyncio, json, sys
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
CASES=[("std_color","standard","color",12),("std_line","standard","line",12),("old_color","oldtown","color",12),("old_night","oldtown","color",20.5),("old_line","oldtown","line",12)]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        pg = await b.new_page(viewport={"width":1280,"height":800})
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        for name, scene, mode, hour in CASES:
            r = await pg.evaluate("""([scene,mode,hour])=>{const a=UDS.app; if(a.P.meta.scene!==scene) a.setScene(scene); UDS.ui.setMode(mode); a.P.settings.hour=hour; a.changed();
              const t0=performance.now(); const svg=a.sec.exportSVG(); const ms=Math.round(performance.now()-t0);
              const doc=new DOMParser().parseFromString(svg,'image/svg+xml'); const err=doc.querySelector('parsererror');
              const cnt=(t)=>doc.querySelectorAll(t).length;
              return {svg, ms, bytes:svg.length, err: err?err.textContent.slice(0,200):null, paths:cnt('path'), texts:cnt('text'), images:cnt('image'), grads:cnt('linearGradient')+cnt('radialGradient'), clips:cnt('clipPath'), groups:[...doc.documentElement.children].filter(e=>e.tagName==='g').map(e=>e.id), size:[doc.documentElement.getAttribute('width'),doc.documentElement.getAttribute('height'),doc.documentElement.getAttribute('viewBox')]}}""", [scene, mode, hour])
            svg = r.pop("svg")
            open(f"{OUTD}/sec_{name}.svg","w").write(svg)
            print(name, json.dumps(r, ensure_ascii=False))
        # 평면
        r = await pg.evaluate("(()=>{const a=UDS.app; UDS.ui.setMode('color'); a.P.settings.hour=12; a.changed(); const svg=a.r2.exportSVG(); const doc=new DOMParser().parseFromString(svg,'image/svg+xml'); return {svg, bytes:svg.length, err:!!doc.querySelector('parsererror'), size:[doc.documentElement.getAttribute('width'),doc.documentElement.getAttribute('height'),doc.documentElement.getAttribute('viewBox')], title:doc.querySelector('title').textContent}})()")
        open(OUTD + "/plan_old.svg","w").write(r.pop("svg")); print("plan", json.dumps(r, ensure_ascii=False))
        print("errors:", logs or "none")
        # 내보낸 SVG를 그림으로 띄워 확인
        for name,_,_,_ in CASES:
            pg2 = await b.new_page(viewport={"width":1500,"height":700})
            await pg2.goto(f"file://{OUTD}/sec_{name}.svg")
            await pg2.wait_for_timeout(500)
            await pg2.screenshot(path=f"{OUTD}/sec_{name}.png")
            await pg2.close()
        await b.close()
asyncio.run(main())
