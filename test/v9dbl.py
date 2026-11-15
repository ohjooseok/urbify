"""더블클릭: 화면을 키우지 않고, 옆 화면이 그 요소로 다가간다. 크게 보기는 화면 제목 단추·Esc로만."""
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
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type in ("error","warning") and "GPU stall" not in m.text and "fonts.g" not in m.text and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)
        ev = pg.evaluate
        cam = "(()=>{const c=UDS.app.r3.cam; return [Math.round(c.tx),Math.round(-c.tz),Math.round(c.dist),+c.ty.toFixed(1),+c.pitch.toFixed(2)];})()"
        view = "(()=>{const v=UDS.app.r2.view; return [Math.round(v.cx),Math.round(v.cy),+v.s.toFixed(2)];})()"
        # 건물 하나의 화면 좌표(평면)
        pt = await ev("(()=>{const a=UDS.app,b=a.D.buildings[5]; const c=b.fp.reduce((s,q)=>[s[0]+q[0]/b.fp.length,s[1]+q[1]/b.fp.length],[0,0]); const q=a.r2.w2s(c); const r=a.r2.cv.getBoundingClientRect(); return {x:r.left+q[0], y:r.top+q[1], c, id:b.lotId, h:b.h};})()")
        print("building:", pt)
        print("before: max", await ev("UDS.app.state.max"), "cam", await ev(cam), "view", await ev(view))
        await pg.mouse.dblclick(pt["x"], pt["y"]); await pg.wait_for_timeout(1600)
        print("after dbl on building in plan: max", await ev("UDS.app.state.max"), "sel", await ev("UDS.app.state.sel"), "cam", await ev(cam), "view", await ev(view))
        await pg.screenshot(path=OUTD + "/d_plan2three.png")
        # 빈 곳(대상지 밖) 더블클릭: 아무 일도 없음
        c0 = await ev(cam)
        emp = await ev("(()=>{const a=UDS.app,q=a.r2.w2s([-12,-12]),r=a.r2.cv.getBoundingClientRect(); return [r.left+q[0], r.top+q[1]];})()")  # 대상지 밖 빈 땅
        await pg.mouse.dblclick(*emp); await pg.wait_for_timeout(700)
        print("dbl on empty: max", await ev("UDS.app.state.max"), "cam same:", c0 == await ev(cam))
        # 3D에서 더블클릭 → 평면이 다가감
        r3 = await ev("(()=>{const r=UDS.app.r3.cv.getBoundingClientRect(); return [r.left+r.width*0.55, r.top+r.height*0.62];})()")
        v0 = await ev(view)
        await pg.mouse.click(r3[0], r3[1]); await pg.wait_for_timeout(1500)
        await pg.mouse.dblclick(r3[0], r3[1]); await pg.wait_for_timeout(2500)
        print("after dbl in 3D: max", await ev("UDS.app.state.max"), "sel", await ev("UDS.app.state.sel"), "view before", v0, "after", await ev(view))
        await pg.screenshot(path=OUTD + "/d_three2plan.png")
        # 도로 더블클릭(평면): 누른 자리 둘레로
        rp = await ev("(()=>{const a=UDS.app,r=a.P.roads.find(x=>/남측/.test(x.name)); const w=[r.pts[0][0]+(r.pts[1][0]-r.pts[0][0])*0.3, r.pts[0][1]+(r.pts[1][1]-r.pts[0][1])*0.3]; a.r2.fit(a.P.site,1.14); a.invalidate(1); const q=a.r2.w2s(w); const b=a.r2.cv.getBoundingClientRect(); return {x:b.left+q[0], y:b.top+q[1], w};})()")
        await pg.wait_for_timeout(300)
        await pg.mouse.dblclick(rp["x"], rp["y"]); await pg.wait_for_timeout(1600)
        print("road dbl: target", [round(v) for v in rp["w"]], "cam", await ev(cam), "sel", await ev("UDS.app.state.sel"))
        # 제목 단추로만 크게 보기
        await pg.locator('button.vt[data-arg="2d"]').click(); await pg.wait_for_timeout(700)
        print("title button → max:", await ev("UDS.app.state.max"), "| toast:", await ev("(document.querySelector('#toast')||{}).textContent"))
        # 크게 본 평면에서 더블클릭: 평면이 다가가고(3D는 가려져 있음), 3D도 같은 곳을 보도록 맞춰짐
        await ev("(()=>{const a=UDS.app; a.r2.fit(a.P.site,1.14); a.invalidate(1);})()"); await pg.wait_for_timeout(300)
        pt2 = await ev("(()=>{const a=UDS.app,b=a.D.buildings[20]; const c=b.fp.reduce((s,q)=>[s[0]+q[0]/b.fp.length,s[1]+q[1]/b.fp.length],[0,0]); const q=a.r2.w2s(c); const r=a.r2.cv.getBoundingClientRect(); return {x:r.left+q[0], y:r.top+q[1], c};})()")
        v1 = await ev(view)
        await pg.mouse.dblclick(pt2["x"], pt2["y"]); await pg.wait_for_timeout(1500)
        print("dbl in maximised plan: max", await ev("UDS.app.state.max"), "target", [round(v) for v in pt2["c"]], "view", v1, "→", await ev(view), "cam", await ev(cam))
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(600)
        print("esc → max:", await ev("UDS.app.state.max"))
        # 단면 더블클릭: 크게 보지 않음
        sr = await ev("(()=>{const r=UDS.app.sec.cv.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2];})()")
        await pg.mouse.dblclick(sr[0], sr[1]); await pg.wait_for_timeout(700)
        print("dbl on section → max:", await ev("UDS.app.state.max"))
        await pg.locator('[data-act="max"][data-arg="sec"]').first.click(); await pg.wait_for_timeout(600)
        print("section button → max:", await ev("UDS.app.state.max"))
        await pg.locator('[data-act="max"][data-arg="sec"]').first.click(); await pg.wait_for_timeout(600)
        print("section button again → max:", await ev("UDS.app.state.max"))
        # 도로 그리기 중 더블클릭은 도로 끝내기
        await ev("UDS.app.setTool('road','so1')")
        await pg.mouse.click(262, 238); await pg.wait_for_timeout(150)
        n0 = await ev("UDS.app.P.roads.length")
        await pg.mouse.dblclick(300, 262); await pg.wait_for_timeout(600)
        print("road tool dbl: max", await ev("UDS.app.state.max"), "tool", await ev("UDS.app.state.tool"), "roads", n0, "→", await ev("UDS.app.P.roads.length"))
        # 놓기 도구 더블클릭: 다가가기 없음
        c1 = await ev(cam)
        await ev("UDS.app.setTool('place','bench')")
        await pg.mouse.dblclick(500, 200); await pg.wait_for_timeout(600)
        print("place tool dbl: cam same", c1 == await ev(cam), "objects", await ev("UDS.app.P.objects.length"))
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
