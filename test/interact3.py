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
        # 레이어 팝오버
        await pg.click('[data-act="menu"][data-arg="view"]:visible'); await pg.wait_for_timeout(150); await pg.click('#pop [data-act="layers"]'); await pg.wait_for_timeout(250)
        print("layers pop:", (await ev("document.getElementById('pop').innerText")).replace("\n"," | ")[:300])
        await pg.screenshot(path=OUTD + "/j1.png")
        # 지하 투시 켜기 (팝오버 안의 체크 항목 찾기)
        items = await ev("[...document.querySelectorAll('#pop [data-act], #pop input, #pop button, #pop label')].map(e=>e.tagName+':'+(e.dataset.act||'')+':'+(e.dataset.arg||'')+':'+(e.innerText||'').trim().slice(0,14))")
        print(items)
        await ev("UDS.ui.closeOverlays()")
        await ev("(()=>{const a=UDS.app; a.state.under3d=true; a.rebuild3d&&a.rebuild3d(); a.invalidate(7); UDS.ui.top&&UDS.ui.top();})()")
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUTD + "/j2.png")
        await ev("(()=>{const a=UDS.app; a.state.under3d=false; a.rebuild3d&&a.rebuild3d(); a.invalidate(7);})()")
        # 햇빛 팝오버
        await pg.click('[data-act="sun"]'); await pg.wait_for_timeout(250)
        print("sun pop:", (await ev("document.getElementById('pop').innerText")).replace("\n"," | ")[:200])
        await pg.screenshot(path=OUTD + "/j3.png")
        await ev("UDS.ui.closeOverlays()")
        # 파일 팝오버 → 저장
        await pg.click('[data-act="menu"][data-arg="project"]:visible'); await pg.wait_for_timeout(250)
        print("file pop:", (await ev("document.getElementById('pop').innerText")).replace("\n"," | ")[:300])
        await pg.click('#pop [data-act="exportsvg"]'); await pg.wait_for_timeout(500)
        print("after exportsvg dialog:", (await ev("document.getElementById('dialog').innerText")).replace("\n"," | ")[:200])
        await ev("UDS.ui.closeOverlays()")
        await pg.click('[data-act="menu"][data-arg="project"]:visible'); await pg.wait_for_timeout(200)
        await pg.click('#pop [data-act="export3d"]'); await pg.wait_for_timeout(600)
        print("after export3d dialog:", (await ev("document.getElementById('dialog').innerText")).replace("\n"," | ")[:200])
        await pg.screenshot(path=OUTD + "/j4.png")
        await ev("UDS.ui.closeOverlays()")
        # 사용법
        await pg.click('[data-act="menu"][data-arg="help"]:visible'); await pg.wait_for_timeout(200); await pg.click('#pop [data-act="help"]'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUTD + "/j5.png")
        print("help len:", await ev("document.getElementById('dialog').innerText.length"))
        await ev("UDS.ui.closeOverlays()")
        # 지표·기준 점검 탭
        await pg.click('#tabs [data-tab="metrics"]'); await pg.wait_for_timeout(250)
        await pg.screenshot(path=OUTD + "/j6.png")
        await pg.click('#tabs [data-tab="checks"]'); await pg.wait_for_timeout(250)
        await pg.screenshot(path=OUTD + "/j7.png")
        # 점 끌기: 도로 선택 후 끝점 이동
        box = await pg.locator('#cv2d').bounding_box()
        async def w2s(x,y):
            q = await ev(f"UDS.app.r2.w2s([{x},{y}])"); return box['x']+q[0], box['y']+q[1]
        rd = await ev("(()=>{const a=UDS.app; const r=a.P.roads.find(x=>x.name.startsWith('중앙')); a.setTool('move'); a.select({type:'road',id:r.id}); return r.pts})()")
        print("road pts", rd)
        x,y = await w2s(rd[0][0], rd[0][1])
        await pg.mouse.move(x,y); await pg.mouse.down(); await pg.mouse.move(x+30,y, steps=5); await pg.mouse.up(); await pg.wait_for_timeout(400)
        print("after vertex drag", await ev("(()=>{const a=UDS.app; const r=a.P.roads.find(x=>x.name.startsWith('중앙')); return [r.pts, a.D.blocks.length, a.D.deadEnds.length]})()"))
        await pg.screenshot(path=OUTD + "/j8.png")
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(300)
        print("undo ->", await ev("(()=>{const a=UDS.app; const r=a.P.roads.find(x=>x.name.startsWith('중앙')); return [r.pts, a.D.blocks.length]})()"))
        # 저장·복원
        print("autosave:", await ev("(()=>{try{const s=localStorage.getItem('uds.sandbox.v1'); return s? s.length: null}catch(e){return 'err '+e}})()"))
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
