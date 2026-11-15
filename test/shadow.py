import asyncio, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
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
        st = "(()=>{const a=UDS.app; const bs=[...document.querySelectorAll('button.ibtn[data-act=shadow]')]; return {mode:a.state.mode, shadows:a.state.layers.shadows, pressed:bs.map(b=>b.getAttribute('aria-pressed')), disabled:bs.map(b=>b.disabled), modeBtns:[...document.querySelectorAll('button[data-mode]')].map(b=>b.getAttribute('aria-pressed')+':'+b.textContent.trim()+':'+b.getAttribute('aria-label'))}})()"
        print("start     ", json.dumps(await pg.evaluate(st), ensure_ascii=False))
        # 평면 픽셀로 그림자 유무 확인: 건물 옆 한 점의 밝기
        probe = "(()=>{const cv=document.getElementById('cv2d'); const c=cv.getContext('2d'); const d=c.getImageData(0,0,cv.width,cv.height).data; let s=0,n=0; for(let i=0;i<d.length;i+=4*7){s+=d[i]+d[i+1]+d[i+2];n++;} return Math.round(s/n*10)/10})()"
        v0 = await pg.evaluate(probe)
        await pg.click('.psw[data-act="xsw"][data-arg="shade"]'); await pg.wait_for_timeout(300)
        v1 = await pg.evaluate(probe)
        print("shadow on ", json.dumps(await pg.evaluate(st), ensure_ascii=False), "plan brightness", v0, "->", v1)
        await pg.click("button[data-mode=line]:visible"); await pg.wait_for_timeout(400)
        print("line      ", json.dumps(await pg.evaluate(st), ensure_ascii=False))
        await pg.click("button[data-mode=color]:visible"); await pg.wait_for_timeout(400)
        v2 = await pg.evaluate(probe)
        print("color back", json.dumps(await pg.evaluate(st), ensure_ascii=False), "plan brightness", v2)
        # 팝오버에서 끄기
        await pg.click("#v3d button[data-act=sun]"); await pg.wait_for_timeout(200)
        txt = await pg.evaluate("document.getElementById('pop').innerText.replace(/\\n+/g,' | ').slice(0,200)")
        print("pop:", txt)
        await pg.click("#pop button[data-act=shadow][data-arg=off]"); await pg.wait_for_timeout(300)
        v3 = await pg.evaluate(probe)
        print("off       ", json.dumps(await pg.evaluate(st), ensure_ascii=False), "plan brightness", v3)
        print("errors:", logs or "none")
        await b.close()
asyncio.run(main())
