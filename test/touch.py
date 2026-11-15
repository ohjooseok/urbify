import asyncio, sys, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width":390,"height":780}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        ev = pg.evaluate
        box = await pg.locator('#cv2d').bounding_box()
        async def w2s(x,y):
            q = await ev(f"UDS.app.r2.w2s([{x},{y}])"); return box['x']+q[0], box['y']+q[1]
        # 건물 탭
        bl = await ev("(()=>{const a=UDS.app; const b=a.D.buildings[8]; const c=b.fp.reduce((s,p)=>[s[0]+p[0]/b.fp.length,s[1]+p[1]/b.fp.length],[0,0]); return c})()")
        x,y = await w2s(bl[0], bl[1])
        await pg.touchscreen.tap(x,y); await pg.wait_for_timeout(400)
        print("tap building → sel:", await ev("JSON.stringify(UDS.app.state.sel)"), "sheet:", await ev("UDS.app.state.sheet"), "| peek:", (await ev("document.getElementById('tabs').innerText")).replace("\n"," "))
        # 시트 열기
        await pg.touchscreen.tap(60, 780-64-20); await pg.wait_for_timeout(400)
        print("sheet open:", await ev("document.getElementById('app').dataset.sheet"), "pane h:", await ev("document.getElementById('pane').clientHeight"))
        await pg.screenshot(path=OUTD + "/t1.png")
        # 시트 닫기 (같은 탭 다시)
        tb = await pg.locator('#tabs [data-tab="props"]').bounding_box()
        await pg.touchscreen.tap(tb['x']+20, tb['y']+15); await pg.wait_for_timeout(400)
        print("sheet after re-tap:", await ev("document.getElementById('app').dataset.sheet"))
        # 도로 탭 → 단면 탭으로
        x,y = await w2s(210, 100)
        await pg.touchscreen.tap(x,y); await pg.wait_for_timeout(300)
        print("tap road → sel:", await ev("JSON.stringify(UDS.app.state.sel)"))
        await pg.locator('.mtabs [data-mview-btn="sec"]').tap(); await pg.wait_for_timeout(500)
        sb = await pg.locator('#cvsec').bounding_box()
        g = await ev("(()=>{const g=UDS.app.sec.geo; const q=g.bands[0]; return {x:(q.x0+q.x1)/2, y:g.gy-50, n:g.bands.length}})()")
        await pg.touchscreen.tap(sb['x']+g['x'], sb['y']+g['y']); await pg.wait_for_timeout(400)
        print("tap band → selSeg:", await ev("UDS.app.state.selSeg"), "| ctx row:", (await ev("document.querySelector('.secrow.ctx').innerText")).replace("\n"," ")[:60])
        # +0.25 버튼
        await pg.locator('[data-act="segstep"][data-arg="0.25"]').tap(); await pg.wait_for_timeout(300)
        print("seg w:", await ev("UDS.app.secRoad().segs[0].w"))
        # 3D 탭 → 탭으로 선택
        await pg.locator('.mtabs [data-mview-btn="3d"]').tap(); await pg.wait_for_timeout(600)
        b3 = await pg.locator('#cv3d').bounding_box()
        await pg.touchscreen.tap(b3['x']+b3['width']*0.5, b3['y']+b3['height']*0.55); await pg.wait_for_timeout(400)
        print("3d tap → sel:", await ev("JSON.stringify(UDS.app.state.sel)"), "cv3d size:", b3['width'], b3['height'])
        # 팔레트: 교목 놓기
        await pg.locator('.mtabs [data-mview-btn="2d"]').tap(); await pg.wait_for_timeout(300)
        n0 = await ev("UDS.app.P.objects.length")
        await pg.locator('[data-act="palgrp"][data-arg="land"]').tap(); await pg.wait_for_timeout(300)  # v6: 아래 막대의 묶음 → 뜨는 창
        await pg.locator('#pop [data-pal="place:tree"]').tap(); await pg.wait_for_timeout(300)
        x,y = await w2s(150,160)
        await pg.touchscreen.tap(x,y); await pg.wait_for_timeout(300)
        print("place tree:", n0, "→", await ev("UDS.app.P.objects.length"), "tool:", await ev("UDS.app.state.tool"), "scrollY:", await ev("window.scrollY"))
        await pg.screenshot(path=OUTD + "/t2.png")
        print("errors:", logs[:6] or "none")
        await b.close()
asyncio.run(main())
