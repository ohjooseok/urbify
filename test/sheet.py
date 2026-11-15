import asyncio, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width":360,"height":612}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        logs=[]
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        pg.on("console", lambda m: logs.append(m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        ev = pg.evaluate
        st = "(()=>{const s=document.getElementById('side').getBoundingClientRect(); const c=document.getElementById('cv2d').getBoundingClientRect(); return {sheet:UDS.app.state.sheet, data:document.getElementById('app').dataset.sheet, sideH:Math.round(s.height), sideTop:Math.round(s.top), cvH:Math.round(c.height), tab:UDS.app.state.tab}})()"
        print("init", await ev(st))
        # 탭 누르기 → 반 열림
        await pg.locator('#tabs [data-tab="props"]').tap(); await pg.wait_for_timeout(500)
        print("tap tab", await ev(st))
        await pg.screenshot(path=OUTD + "/s1.png")
        # 손잡이를 아래로 끌어 닫기
        g = await pg.locator('#grab').bounding_box()
        x = g['x']+g['width']/2; y = g['y']+7
        await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move(x, y+60, steps=6); await pg.wait_for_timeout(50)
        print("dragging", await ev(st))
        await pg.mouse.up(); await pg.wait_for_timeout(500)
        print("drag down → ", await ev(st))
        # 위로 끌어 열기(탭 줄에서 시작)
        t = await pg.locator('#tabs').bounding_box()
        x = t['x']+60; y = t['y']+14
        await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move(x, y-120, steps=8); await pg.mouse.up(); await pg.wait_for_timeout(500)
        print("drag up from tabs → ", await ev(st))
        # 더 위로 → 전체
        g = await pg.locator('#grab').bounding_box()
        x = g['x']+g['width']/2; y = g['y']+7
        await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move(x, y-150, steps=8); await pg.mouse.up(); await pg.wait_for_timeout(500)
        print("drag up → ", await ev(st))
        await pg.screenshot(path=OUTD + "/s2.png")
        # 닫기 단추
        await pg.locator('.sheetx').tap(); await pg.wait_for_timeout(500)
        print("close button → ", await ev(st))
        # 지표 탭 → 열림, 같은 탭 다시 → 닫힘
        await pg.locator('#tabs [data-tab="metrics"]').tap(); await pg.wait_for_timeout(450)
        print("metrics", await ev(st))
        await pg.locator('#tabs [data-tab="metrics"]').tap(); await pg.wait_for_timeout(450)
        print("metrics again", await ev(st))
        # 더보기 → 시각·그림자·조명
        await pg.locator('[data-act="more"]').tap(); await pg.wait_for_timeout(250)
        await pg.locator('#pop [data-act="sun"]').tap(); await pg.wait_for_timeout(300)
        print("sun pop:", (await ev("document.getElementById('pop').innerText")).replace("\n"," | ")[:160])
        await pg.locator('#pop [data-act="tod"][data-arg="night"]').tap(); await pg.wait_for_timeout(400)
        print("after night:", await ev("[UDS.app.P.settings.hour, !document.getElementById('pop').hidden, UDS.sky(UDS.app.P.settings).glow]"))
        await pg.screenshot(path=OUTD + "/s3.png")
        print("errors:", logs[:6] or "none")
        await b.close()
asyncio.run(main())
