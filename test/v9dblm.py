"""휴대폰: 두 번 두드리면 지금 화면이 그 요소로 다가가고(옆 화면이 없으므로), 가려진 3D도 같은 곳을 보도록 맞춰 둔다"""
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
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)
        ev = pg.evaluate
        cam = "(()=>{const c=UDS.app.r3.cam; return [Math.round(c.tx),Math.round(-c.tz),Math.round(c.dist)];})()"
        view = "(()=>{const v=UDS.app.r2.view; return [Math.round(v.cx),Math.round(v.cy),+v.s.toFixed(2)];})()"
        pt = await ev("(()=>{const a=UDS.app,b=a.D.buildings[30]; const c=b.fp.reduce((s,q)=>[s[0]+q[0]/b.fp.length,s[1]+q[1]/b.fp.length],[0,0]); const q=a.r2.w2s(c); const r=a.r2.cv.getBoundingClientRect(); return {x:r.left+q[0], y:r.top+q[1], c:[Math.round(c[0]),Math.round(c[1])]};})()")
        print("target", pt["c"], "before view", await ev(view), "cam", await ev(cam), "shown 2d/3d:", await ev("[UDS.ui.viewShown('2d'), UDS.ui.viewShown('3d')]"))
        await pg.touchscreen.tap(pt["x"], pt["y"]); await pg.wait_for_timeout(120)
        await pg.touchscreen.tap(pt["x"], pt["y"]); await pg.wait_for_timeout(1500)
        print("after double tap: max", await ev("UDS.app.state.max"), "sel", await ev("UDS.app.state.sel"), "view", await ev(view), "cam", await ev(cam))
        await pg.screenshot(path=OUTD + "/dm_plan.png")
        # 3D 탭으로 넘어가면 같은 곳을 보고 있다
        await pg.locator('[data-mview-btn="3d"]').tap(); await pg.wait_for_timeout(2500)
        await pg.screenshot(path=OUTD + "/dm_3d.png")
        # 3D에서 두 번 두드리면 3D가 다가가고, 평면도 맞춰 둔다(평면이 가려져 있으므로 다시 보일 때 적용)
        await ev("UDS.app.camPreset('aerial')"); await pg.wait_for_timeout(1500)
        # (소프트웨어 렌더러에서는 3D 누름 처리가 느려 두 번 두드림 간격을 맞출 수 없으므로, 두 번 두드렸을 때 불리는 함수를 직접 부른다)
        c0 = await ev(cam)
        r = await ev("(()=>{const a=UDS.app,b=a.D.buildings[3]; const ok=a.focusFrom('3d',{type:'building',id:b.lotId},null); return [ok, !!a._pend2, UDS.ui.viewShown('2d'), UDS.ui.viewShown('3d'), b.fp[0].map(Math.round)];})()")
        await pg.wait_for_timeout(1500)
        print("3D focus (plan hidden): [ok, pend2, shown2d, shown3d, target]", r, "cam", c0, "→", await ev(cam))
        await pg.locator('[data-mview-btn="2d"]').tap(); await pg.wait_for_timeout(900)
        print("back to plan: view", await ev(view), "pend2:", await ev("!!UDS.app._pend2"))
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
