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
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(1000)
        ev = pg.evaluate
        S = "(w)=>{const a=UDS.app,r=a.r2.cv.getBoundingClientRect(),q=a.r2.w2s(w);return [r.left+q[0], r.top+q[1]];}"
        async def scr(w): return await ev(f"({S})({json.dumps(w)})")
        lot = "(id)=>{const l=UDS.app.D.lots.find(x=>x.id===id); return l?{use:l.use, bld:!!l.building, floors:l.building&&l.building.floors, style:l.building&&l.building.style, h:l.building&&l.building.h}:null}"
        # 대상: 주거 가구의 한 획지, 공원 획지, 주거 가구의 다른 획지
        info = await ev("(()=>{const a=UDS.app; const res=a.D.lots.filter(l=>l.use==='res'&&l.building); const park=a.D.lots.find(l=>l.use==='park'); const c=(l)=>UDS.U.interiorPoint(l.poly); return {r1:[res[0].id,c(res[0])], r2:[res[5].id,c(res[5])], park:[park.id,c(park)], n:a.D.buildings.length};})()")
        print("targets:", info)
        # 메뉴에서 업무 고르기
        await pg.click('[data-act="palgrp"][data-arg="bld"]'); await pg.wait_for_timeout(300)
        await pg.click('[data-pal="build:off"]'); await pg.wait_for_timeout(200)
        print("tool:", await ev("[UDS.app.state.tool, UDS.app.state.buildUse]"), "hdr:", await ev("document.querySelector('.pgrp[data-grp=bld] .pgv').textContent"), "hint:", (await ev("document.querySelector('#hint').innerText")).replace("\n"," | "))
        # 1) 주거 건물이 있는 획지에 업무 놓기 → 바뀜
        x,y = await scr(info['r1'][1]); await pg.mouse.move(x,y); await pg.wait_for_timeout(150)
        print("hover:", await ev("UDS.app.state.hover"))
        await pg.mouse.click(x,y); await pg.wait_for_timeout(500)
        print("1 replace:", await ev(f"({lot})({json.dumps(info['r1'][0])})"), "sel:", await ev("UDS.app.state.sel"), "tool:", await ev("UDS.app.state.tool"), "toast:", await ev("document.querySelector('#toast').textContent"))
        # 2) 같은 곳 다시 → 그대로(고르기만)
        h0 = await ev("UDS.app.hist.length")
        await pg.mouse.click(x,y); await pg.wait_for_timeout(400)
        print("2 same use: hist", h0, "->", await ev("UDS.app.hist.length"), "toast:", await ev("document.querySelector('#toast').textContent"))
        # 3) 공원 획지에 공공 건물
        await pg.click('[data-pal="build:pub"]'); await pg.wait_for_timeout(200)
        x,y = await scr(info['park'][1]); await pg.mouse.click(x,y); await pg.wait_for_timeout(600)
        print("3 park→pub:", await ev(f"({lot})({json.dumps(info['park'][0])})"), "n bld:", info['n'], "->", await ev("UDS.app.D.buildings.length"))
        await pg.screenshot(path=OUTD + "/b_placed.png")
        # 4) 도로를 누르면 안내만
        h0 = await ev("UDS.app.hist.length")
        rx,ry = await scr([210, 150]); await pg.mouse.click(rx,ry); await pg.wait_for_timeout(300)
        print("4 road click: hist", h0, "->", await ev("UDS.app.hist.length"), "toast:", await ev("document.querySelector('#toast').textContent"))
        # 5) 되돌리기 두 번
        await pg.keyboard.press("Control+z"); await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(500)
        print("5 undo x2:", await ev(f"({lot})({json.dumps(info['r1'][0])})"), await ev(f"({lot})({json.dumps(info['park'][0])})"))
        # 6) 지운 건물 자리에 주거 다시 놓기
        await ev(f"(()=>{{const a=UDS.app; a.eraseAt({{type:'building', id:{json.dumps(info['r2'][0])}}});}})()"); await pg.wait_for_timeout(300)
        print("6 erased:", await ev(f"({lot})({json.dumps(info['r2'][0])})"))
        await pg.keyboard.press("b"); await pg.wait_for_timeout(150)
        await pg.click('[data-pal="build:res"]'); await pg.wait_for_timeout(150)
        x,y = await scr(info['r2'][1]); await pg.mouse.click(x,y); await pg.wait_for_timeout(500)
        print("6 re-placed:", await ev(f"({lot})({json.dumps(info['r2'][0])})"))
        # 7) 3D에서 놓기: 상업
        await pg.click('[data-pal="build:com"]'); await pg.wait_for_timeout(150)
        r3 = await ev("(()=>{const r=UDS.app.r3.cv.getBoundingClientRect(); return [r.left,r.top,r.width,r.height]})()")
        px, py = r3[0]+r3[2]*0.35, r3[1]+r3[3]*0.62
        before = await ev("UDS.app.D.lots.filter(l=>l.use==='com').length")
        await pg.mouse.click(px, py); await pg.wait_for_timeout(1800)
        print("7 3d place: com lots", before, "->", await ev("UDS.app.D.lots.filter(l=>l.use==='com').length"), "sel:", await ev("UDS.app.state.sel"), "toast:", await ev("document.querySelector('#toast').textContent"))
        await pg.screenshot(path=OUTD + "/b_3d.png")
        # 8) Esc → 선택 도구
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        print("8 esc tool:", await ev("UDS.app.state.tool"))
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
