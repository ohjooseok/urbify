"""프로젝트 메뉴: 새 프로젝트(대상지 종류), 빈 대상지, 임의생성, 처음 상태로 되돌리기, 전체 지우기"""
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
        info = "(()=>{const a=UDS.app,P=a.P,D=a.D; return {scene:P.meta.scene, title:P.meta.title, site:[P.site.w,P.site.h], roads:P.roads.length, blocks:D.blocks.length, lots:D.lots.length, bld:D.buildings.length, obj:P.objects.length, hist:a.hist.length, hi:a.hi, initial:a.isInitial(), edited:a.isEdited(), sec:a.state.secRoadId};})()"
        toast = "(document.querySelector('#toast')||{}).textContent"
        print("start:", await ev(info))
        # 1) 처음 상태에서 초기화 → '이미 처음 상태'
        await pg.locator('[data-act="menu"][data-arg="project"]:visible').click(); await pg.wait_for_timeout(300)
        await pg.locator('#pop [data-act="resetscene"]').click(); await pg.wait_for_timeout(300)
        print("reset at initial → toast:", await ev(toast), "| dialog open:", await ev("!document.querySelector('#dialog').hidden"))
        # 2) 조금 고치고(도로 하나 지움) 초기화
        await ev("(()=>{const a=UDS.app; a.eraseAt({type:'road', id:a.P.roads[6].id});})()"); await pg.wait_for_timeout(400)
        print("after erase:", await ev(info))
        await pg.locator('[data-act="menu"][data-arg="project"]:visible').click(); await pg.wait_for_timeout(300)
        await pg.locator('#pop [data-act="resetscene"]').click(); await pg.wait_for_timeout(300)
        print("reset dialog:", await ev("document.querySelector('#dialog .db').textContent"))
        await pg.locator('#dialog [data-act="confirmyes"]').click(); await pg.wait_for_timeout(900)
        print("after reset:", await ev(info), "|", await ev(toast))
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(700)
        print("undo after reset:", await ev(info))
        # 3) 전체 지우기
        await pg.locator('[data-act="menu"][data-arg="project"]:visible').click(); await pg.wait_for_timeout(300)
        await pg.locator('#pop [data-act="clearall"]').click(); await pg.wait_for_timeout(300)
        print("clear dialog:", await ev("document.querySelector('#dialog .db').textContent"))
        await pg.locator('#dialog [data-act="confirmyes"]').click(); await pg.wait_for_timeout(1200)
        print("after clear:", await ev(info), "|", await ev(toast))
        print(" block:", await ev("(()=>{const b=UDS.app.D.blocks[0]; return b ? {use:b.settings.use, auto:b.settings.auto, along:b.settings.lotsAlong, rows:b.settings.lotRows, area:Math.round(b.area)} : null;})()"))
        await pg.screenshot(path=OUTD + "/p_clear.png")
        # 빈 터에 도로를 그리면 가구가 생기고 획지 수가 자동으로
        await ev("(()=>{const a=UDS.app, M=UDS.Model; a.P.roads.push(M.makeRoad('jung3', [[0,150],[420,150]], {name:'가로 1'})); a.P.roads.push(M.makeRoad('so1', [[210,0],[210,300]], {name:'세로 1'})); a.P.roads.push(M.makeRoad('so1', [[0,0],[420,0]], {name:'남'})); a.commit();})()"); await pg.wait_for_timeout(900)
        print("after drawing 3 roads:", await ev(info))
        print(" blocks:", await ev("UDS.app.D.blocks.map(b=>[b.settings.use, !!b.settings.auto, b.settings.lotsAlong, b.settings.lotRows, Math.round(b.dims.long), Math.round(b.dims.short)])"))
        await pg.screenshot(path=OUTD + "/p_clear_roads.png")
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(500)
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(900)
        print("undo ×2 (clear undone):", await ev(info))
        # 4) 새 프로젝트 창
        await pg.locator('[data-act="menu"][data-arg="project"]:visible').click(); await pg.wait_for_timeout(300)
        await pg.locator('#pop [data-act="newproject"]').click(); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUTD + "/p_new.png")
        print("new dialog cards:", await ev("Array.from(document.querySelectorAll('#dialog .ncard b')).map(x=>x.textContent)"), "| note:", await ev("document.querySelector('#dialog .db p').textContent"))
        await pg.locator('#dialog [data-new="random:new"]').click(); await pg.wait_for_timeout(1500)
        r1 = await ev(info); print("random:", r1, "|", await ev(toast))
        await pg.screenshot(path=OUTD + "/p_random1.png")
        # 왼쪽 메뉴에서 임의생성을 다시 누르면 새로(고치지 않았으므로 묻지 않음)
        await pg.locator('#palette [data-scene="random:new"]').click(); await pg.wait_for_timeout(1500)
        r2 = await ev(info); print("random again:", r2, "| differs:", json.dumps(r1) != json.dumps(r2), "| seed:", await ev("UDS.app.P.meta.seed"), await ev("UDS.app.P.meta.pattern"))
        await pg.screenshot(path=OUTD + "/p_random2.png")
        # 임의생성에서 초기화: 같은 씨앗으로
        await ev("(()=>{const a=UDS.app; a.eraseAt({type:'road', id:a.P.roads[3].id});})()"); await pg.wait_for_timeout(400)
        await ev("UDS.ui.acts ? 0 : 0")
        await pg.locator('[data-act="menu"][data-arg="project"]:visible').click(); await pg.wait_for_timeout(300)
        await pg.locator('#pop [data-act="resetscene"]').click(); await pg.wait_for_timeout(300)
        await pg.locator('#dialog [data-act="confirmyes"]').click(); await pg.wait_for_timeout(1200)
        r3 = await ev(info); print("random reset:", r3, "| same as before edit:", r3["roads"] == r2["roads"] and r3["bld"] == r2["bld"])
        # 고친 뒤 임의생성 → 물어봄
        await ev("(()=>{const a=UDS.app; a.eraseAt({type:'road', id:a.P.roads[3].id});})()"); await pg.wait_for_timeout(400)
        await pg.locator('#palette [data-scene="random:new"]').click(); await pg.wait_for_timeout(400)
        print("random when edited → dialog:", await ev("(document.querySelector('#dialog .dh2 b')||{}).textContent"), "|", await ev("(document.querySelector('#dialog .db')||{}).textContent"))
        await pg.locator('#dialog .df [data-act="closedlg"]').click(); await pg.wait_for_timeout(300)
        # 5) 빈 대상지
        await pg.locator('#palette [data-scene="blank"]').click(); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUTD + "/p_blankdlg.png")
        await pg.locator('#dialog [data-blank="600x400"]').click(); await pg.wait_for_timeout(200)
        print("blank dialog ha:", await ev("document.querySelector('#blankHa').textContent"), await ev("[document.querySelector('#blankW').value, document.querySelector('#blankH').value]"))
        await pg.fill('#blankW', '50'); await pg.locator('#dialog [data-act="blankgo"]').click(); await pg.wait_for_timeout(300)
        print("bad size → err:", await ev("document.querySelector('#blankErr').textContent"), "| still open:", await ev("!document.querySelector('#dialog').hidden"))
        await pg.fill('#blankW', '500'); await pg.fill('#blankH', '320'); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(1500)
        print("blank:", await ev(info), "|", await ev(toast))
        await pg.screenshot(path=OUTD + "/p_blank.png")
        print(" palette pressed:", await ev("Array.from(document.querySelectorAll('#palette [data-scene][aria-pressed=\"true\"]')).map(x=>x.dataset.scene)"), "| group value:", await ev("document.querySelector('#palette .pgrp[data-grp=\"site\"] .pgv').textContent"))
        # 빈 대상지에서 도로 도구로 그리기(마우스)
        await ev("UDS.app.setTool('road','jung3')")
        box = await ev("(()=>{const a=UDS.app,r=a.r2.cv.getBoundingClientRect(); const q=(w)=>{const s=a.r2.w2s(w); return [r.left+s[0], r.top+s[1]];}; return [q([0,160]), q([500,160]), q([250,0]), q([250,320])];})()")
        await pg.mouse.click(*box[0]); await pg.wait_for_timeout(200); await pg.mouse.click(*box[1]); await pg.wait_for_timeout(700)
        await ev("UDS.app.setTool('road','so1')")
        await pg.mouse.click(*box[2]); await pg.wait_for_timeout(200); await pg.mouse.click(*box[3]); await pg.wait_for_timeout(900)
        print("blank + 2 roads:", await ev(info))
        print(" blocks:", await ev("UDS.app.D.blocks.map(b=>[b.settings.use, !!b.settings.auto, b.settings.lotsAlong, b.settings.lotRows])"))
        await pg.screenshot(path=OUTD + "/p_blank_roads.png")
        # 가구 용도를 주거로 → 건물이 선다
        n = await ev("(()=>{const a=UDS.app; const S=a.P.blocks[0]; S.use='res'; a.commit(); return [a.D.buildings.length, S.auto, S.lotsAlong];})()")
        print("block use → res: buildings, auto, along:", n)
        # 건물 놓기 도구로 빈 터 획지에 건물
        res = await ev("(()=>{const a=UDS.app; const l=a.D.lots.find(x=>x.use==='vacant'); const c=l.poly.reduce((s,q)=>[s[0]+q[0]/l.poly.length,s[1]+q[1]/l.poly.length],[0,0]); a.setTool('build','com'); a.buildAt(c, null); const b=a.P.blocks.find(x=>x.id===l.blockId); return {bld:a.D.buildings.length, auto:!!b.auto, along:b.lotsAlong};})()")
        print("build on vacant lot:", res)
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
