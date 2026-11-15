"""새로 고침 뒤에도 '처음 상태'가 이어지는지, 대상지를 바꾸기 전에 묻는지"""
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
        url = URL
        await pg.goto(url); await pg.wait_for_timeout(1200)
        ev = pg.evaluate
        info = "(()=>{const a=UDS.app,P=a.P; return {scene:P.meta.scene, uid:P.meta.uid, roads:P.roads.length, bld:a.D.buildings.length, initial:a.isInitial(), edited:a.isEdited(), hasInit:!!a.initial};})()"
        toast = "(document.querySelector('#toast')||{}).textContent"
        print("first start:", await ev(info))
        # 임의생성으로 새로 열고 도로 하나 지움 → 새로 고침
        await ev("UDS.app.load(UDS.Model.sceneRandom(77))"); await pg.wait_for_timeout(800)
        r0 = await ev(info); print("random(77):", r0)
        await ev("(()=>{const a=UDS.app; a.eraseAt({type:'road', id:a.P.roads[2].id});})()"); await pg.wait_for_timeout(900)
        print("edited:", await ev(info))
        await pg.reload(); await pg.wait_for_timeout(1500)
        r1 = await ev(info); print("after reload:", r1, "|", await ev(toast))
        # 이어 연 작업에서 다른 대상지를 누르면 묻는다
        await pg.locator('#palette [data-scene="oldtown"]').click(); await pg.wait_for_timeout(400)
        print("switch after reload → dialog:", await ev("(document.querySelector('#dialog .dh2 b')||{}).textContent"))
        await pg.locator('#dialog .df [data-act="closedlg"]').click(); await pg.wait_for_timeout(300)
        # 처음 상태로 되돌리기 → 77번 임의생성의 처음 모습
        await pg.locator('[data-act="menu"][data-arg="project"]:visible').click(); await pg.wait_for_timeout(300)
        await pg.locator('#pop [data-act="resetscene"]').click(); await pg.wait_for_timeout(300)
        await pg.locator('#dialog [data-act="confirmyes"]').click(); await pg.wait_for_timeout(1200)
        r2 = await ev(info); print("reset after reload:", r2, "| same roads/bld as first:", r2["roads"] == r0["roads"] and r2["bld"] == r0["bld"], "| uid kept:", r2["uid"] == r0["uid"])
        # 처음 상태가 다른 프로젝트의 것이면 쓰지 않는다
        await ev("(()=>{const P=JSON.parse(localStorage.getItem('uds.sandbox.v1.init')); P.meta.uid='p_other'; localStorage.setItem('uds.sandbox.v1.init', JSON.stringify(P));})()")
        print("  erase →", await ev("(()=>{const a=UDS.app; const n0=a.P.roads.length; a.eraseAt({type:'road', id:a.P.roads[2].id}); return [n0, a.P.roads.length, a.hist.length, a.hi];})()")); await pg.wait_for_timeout(900)
        print("  saved roads:", await ev("JSON.parse(localStorage.getItem('uds.sandbox.v1')).roads.length"))
        await pg.reload(); await pg.wait_for_timeout(1500)
        print("mismatched init:", await ev(info), "| fallback initial roads:", await ev("UDS.app.initialProject().roads.length"))
        # 저장 공간이 비어 있으면 기본 대상지
        await ev("localStorage.clear()"); await pg.reload(); await pg.wait_for_timeout(1500)
        print("cleared storage:", await ev(info))
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
