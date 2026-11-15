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
        await ev("Object.assign(UDS.ui.palOpen,{road:true,furn:true,land:true}); UDS.ui.palette()"); await pg.wait_for_timeout(350)  # v6: 묶음을 펼쳐 둠
        async def state(label):
            s = await ev("(()=>{const a=UDS.app,m=a.D.metrics;return {tool:a.state.tool, sel:a.state.sel, roads:a.P.roads.length, blocks:a.D.blocks.length, lots:a.D.lots.length, bld:a.D.buildings.length, objs:a.P.objects.length, hist:a.hist.length, hi:a.hi, dead:a.D.deadEnds.length, selSeg:a.state.selSeg, secRoad:(a.secRoad()||{}).name}})()")
            print(label, json.dumps(s, ensure_ascii=False))
        await state("init")
        # 1) 평면에서 도로 클릭 → 선택
        box = await pg.locator('#cv2d').bounding_box()
        async def w2s(x,y):
            q = await ev(f"UDS.app.r2.w2s([{x},{y}])"); return box['x']+q[0], box['y']+q[1]
        x,y = await w2s(210,40)   # 중앙 집산도로
        await pg.mouse.click(x,y); await pg.wait_for_timeout(200)
        await state("click road")
        # 2) 건물 클릭
        x,y = await w2s(30,30)
        await pg.mouse.click(x,y); await pg.wait_for_timeout(200)
        await state("click building")
        # 3) 도로 그리기: 소로1류, 근린공원 가구를 가로지르는 도로 (105,112)→(210,112)
        await pg.click('[data-pal="road:so1"]'); await pg.wait_for_timeout(100)
        x,y = await w2s(105,112); await pg.mouse.move(x,y); await pg.mouse.click(x,y); await pg.wait_for_timeout(150)
        x2,y2 = await w2s(210,112.4); await pg.mouse.move(x2,y2); await pg.wait_for_timeout(100)
        await pg.screenshot(path=OUTD + "/i1.png")
        await pg.mouse.click(x2,y2); await pg.wait_for_timeout(500)
        await state("road drawn")
        # 4) 요소 배치: 벤치
        await ev("UDS.ui.palOpen.furn=true; UDS.ui.palette()"); await pg.wait_for_timeout(350)  # v10: 묶음은 하나씩 펼쳐짐
        await pg.click('[data-pal="place:bench"]')
        x,y = await w2s(150,180); await pg.mouse.click(x,y); await pg.wait_for_timeout(300)
        await state("bench placed")
        # 5) 지우개: 건물 하나 지우기
        await pg.click('[data-pal="tool:erase"]')
        x,y = await w2s(30,30); await pg.mouse.click(x,y); await pg.wait_for_timeout(300)
        await state("building erased")
        await pg.click('[data-pal="tool:select"]')
        # 6) 단면: 경계선 끌기
        r = await ev("(()=>{const a=UDS.app; const rd=a.P.roads.find(x=>x.name.startsWith('중앙')); a.select({type:'road',id:rd.id}); return rd.segs.map(s=>s.w)})()")
        await pg.wait_for_timeout(300)
        sbox = await pg.locator('#cvsec').bounding_box()
        g = await ev("(()=>{const g=UDS.app.sec.geo; return {x:g.bands[1].x0, y:g.gy-40, sc:g.sc}})()")
        await pg.mouse.move(sbox['x']+g['x'], sbox['y']+g['y']); await pg.mouse.down(); await pg.mouse.move(sbox['x']+g['x']+g['sc']*1.0, sbox['y']+g['y'], steps=5); await pg.mouse.up(); await pg.wait_for_timeout(400)
        r2 = await ev("UDS.app.secRoad().segs.map(s=>s.w)")
        print("seg widths before", r, "after", r2)
        await state("divider dragged")
        # 7) 구간 클릭 → 선택, 폭 + 버튼
        g = await ev("(()=>{const g=UDS.app.sec.geo; const q=g.bands[3]; return {x:(q.x0+q.x1)/2, y:g.gy-60}})()")
        await pg.mouse.click(sbox['x']+g['x'], sbox['y']+g['y']); await pg.wait_for_timeout(300)
        await pg.click('[data-act="segstep"][data-arg="0.25"]'); await pg.wait_for_timeout(300)
        print("after +0.25:", await ev("UDS.app.secRoad().segs.map(s=>s.w)"))
        # 8) 구간 추가: 띠녹지
        await pg.click('#sechead [data-act="addseg"]'); await pg.wait_for_timeout(150)
        await pg.click('[data-act="addsegtype"][data-arg="planting"]'); await pg.wait_for_timeout(300)
        print("segs:", await ev("UDS.app.secRoad().segs.map(s=>s.type+':'+s.w).join(' | ')"))
        # 9) 관 끌기
        g = await ev("(()=>{const g=UDS.app.sec.geo; const p=g.pipes[0]; return {x:p.x,y:p.y,off:p.u.off,depth:p.u.depth}})()")
        await pg.mouse.move(sbox['x']+g['x'], sbox['y']+g['y']); await pg.mouse.down(); await pg.mouse.move(sbox['x']+g['x']-30, sbox['y']+g['y']+15, steps=4); await pg.mouse.up(); await pg.wait_for_timeout(300)
        print("pipe before", g['off'], g['depth'], "after", await ev("(()=>{const u=UDS.app.secRoad().utils[0]; return [u.off,u.depth]})()"))
        # 10) 되돌리기 여러 번
        for i in range(3): await pg.keyboard.press("Control+z")
        await pg.wait_for_timeout(300)
        await state("after 3 undo")
        # 11) 3D 클릭 선택
        b3 = await pg.locator('#cv3d').bounding_box()
        await pg.mouse.click(b3['x']+b3['width']*0.55, b3['y']+b3['height']*0.62); await pg.wait_for_timeout(300)
        await state("3d click")
        # 12) 속성 패널: 층수 바꾸기
        ok = await ev("(()=>{const el=[...document.querySelectorAll('#pane input[type=number]')].find(e=>e.dataset.k==='층수'); if(!el) return 'no floors input'; el.value=9; el.dispatchEvent(new Event('change',{bubbles:true})); return 'set';})()")
        await pg.wait_for_timeout(300)
        print("floors:", ok, await ev("(()=>{const a=UDS.app; const t=a.state.sel; if(!t) return null; const l=a.D.lots.find(x=>x.id===t.id); return l&&l.building? l.building.floors : 'nobld'})()"))
        await pg.screenshot(path=OUTD + "/i2.png")
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
