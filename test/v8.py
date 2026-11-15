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
        # ---- 가구 경계선 누르기
        blk = await ev("(()=>{const a=UDS.app; const b=a.D.blocks[0]; const e=[b.poly[0], b.poly[1]]; const lots=a.D.lots.filter(l=>l.blockId===b.id); return {id:b.id, mid:[(e[0][0]+e[1][0])/2,(e[0][1]+e[1][1])/2], poly:b.poly, lots:lots.map(l=>[l.id,UDS.U.interiorPoint(l.poly), l.cell, !!l.building, l.building?UDS.U.interiorPoint(l.building.fp):null])};})()")
        x,y = await scr(blk['mid']); await pg.mouse.move(x,y); await pg.wait_for_timeout(200)
        print("hover edge:", await ev("UDS.app.state.hover"))
        await pg.mouse.click(x,y); await pg.wait_for_timeout(500)
        print("click edge → sel:", await ev("UDS.app.state.sel"), "| head:", await ev("document.querySelector('.phead .pt').innerText.replace(/\\n/g,' / ')"))
        print("stats:", await ev("[...document.querySelectorAll('#pane .stats .stat')].map(s=>s.innerText.replace(/\\n/g,' ')).join(' | ')"))
        print("kv:", await ev("[...document.querySelectorAll('#pane .tb.kv tr')].map(s=>s.innerText.replace(/\\s+/g,' ')).join(' | ')"))
        print("uses:", await ev("[...document.querySelectorAll('#pane table.tb:not(.kv) tbody tr')].map(s=>s.innerText.replace(/\\s+/g,' ')).join(' | ')"))
        await pg.screenshot(path=OUTD + "/c_block.png")
        # 경계선에서 2px 안쪽·바깥쪽도 가구, 8px 안쪽은 획지/건물, 도로 한가운데는 도로
        for dy,label in [(-3,'3px out'),(3,'3px in'),(9,'9px in')]:
            await pg.mouse.click(x, y - dy); await pg.wait_for_timeout(250)
            print(" ", label, "→", await ev("UDS.app.state.sel && UDS.app.state.sel.type"))
        # ---- 획지 여럿 고르기 → 합치기 창
        L = blk['lots']
        print("lots:", [(l[0], l[2]) for l in L])
        a = next(l for l in L if l[2]['r0']==0 and l[2]['i0']==0); bb = next(l for l in L if l[2]['r0']==0 and l[2]['i0']==1); cc = next(l for l in L if l[2]['r0']==1 and l[2]['i0']==2)
        pa = await scr(a[4] or a[1]); pb = await scr(bb[4] or bb[1]); pc = await scr(cc[4] or cc[1])
        await pg.mouse.click(*pa); await pg.wait_for_timeout(250)
        print("one lot: selpop hidden", await ev("document.querySelector('#selpop').hidden"))
        await pg.keyboard.down("Shift"); await pg.mouse.click(*pb); await pg.keyboard.up("Shift"); await pg.wait_for_timeout(350)
        print("two lots: selpop", await ev("(()=>{const e=document.querySelector('#selpop'); const r=e.getBoundingClientRect(); return [e.hidden, e.innerText.replace(/\\n/g,' '), Math.round(r.left), Math.round(r.top)]})()"), "click at", [round(v) for v in pb])
        await pg.screenshot(path=OUTD + "/c_merge1.png")
        # 떨어진 획지를 더하면 이유 표시
        await pg.keyboard.down("Shift"); await pg.mouse.click(*pc); await pg.keyboard.up("Shift"); await pg.wait_for_timeout(350)
        print("non-adjacent:", await ev("document.querySelector('#selpop').innerText.replace(/\\n/g,' ')"))
        await pg.screenshot(path=OUTD + "/c_merge2.png")
        await pg.keyboard.down("Shift"); await pg.mouse.click(*pc); await pg.keyboard.up("Shift"); await pg.wait_for_timeout(350)
        n0 = await ev("[UDS.app.D.lots.length, UDS.app.D.buildings.length]")
        await pg.click('#selpop [data-act="mergelots"]'); await pg.wait_for_timeout(700)
        print("merged:", n0, "->", await ev("[UDS.app.D.lots.length, UDS.app.D.buildings.length]"), "sel:", await ev("UDS.app.state.sel"), "selpop hidden:", await ev("document.querySelector('#selpop').hidden"), "| head:", await ev("document.querySelector('.phead .pt').innerText.replace(/\\n/g,' / ')"), "| toast:", await ev("document.querySelector('#toast').textContent"))
        await pg.screenshot(path=OUTD + "/c_merged.png")
        # 합친 획지 + 아래 줄 두 칸 → 2×2
        L2 = await ev(f"(()=>{{const a=UDS.app; return a.D.lots.filter(l=>l.blockId==={json.dumps(blk['id'])}).map(l=>[l.id,UDS.U.interiorPoint(l.building?l.building.fp:l.poly), l.cell]);}})()")
        m = next(l for l in L2 if l[2]['i1']>l[2]['i0']); d1 = next(l for l in L2 if l[2]['r0']==1 and l[2]['i0']==0); d2 = next(l for l in L2 if l[2]['r0']==1 and l[2]['i0']==1)
        await pg.mouse.click(*(await scr(m[1]))); await pg.wait_for_timeout(200)
        await pg.keyboard.down("Shift"); await pg.mouse.click(*(await scr(d1[1]))); await pg.wait_for_timeout(200); await pg.mouse.click(*(await scr(d2[1]))); await pg.keyboard.up("Shift"); await pg.wait_for_timeout(300)
        print("3 sel (merged+2):", await ev("document.querySelector('#selpop').innerText.replace(/\\n/g,' ')"))
        await pg.click('#pane [data-act="mergelots"]'); await pg.wait_for_timeout(700)
        print("2x2 merged: lots", await ev(f"UDS.app.D.lots.filter(l=>l.blockId==={json.dumps(blk['id'])}).map(l=>l.key+':'+Math.round(l.area))"), "merges:", await ev(f"UDS.app.block({json.dumps(blk['id'])}).merges"))
        # 다시 나누기
        await pg.click('#pane [data-act="unmerge"]'); await pg.wait_for_timeout(600)
        print("unmerged: lots", await ev(f"UDS.app.D.lots.filter(l=>l.blockId==={json.dumps(blk['id'])}).length"), "merges:", await ev(f"UDS.app.block({json.dumps(blk['id'])}).merges"))
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(500)
        print("undo → merges:", await ev(f"UDS.app.block({json.dumps(blk['id'])}).merges"))
        # 서로 다른 가구
        other = await ev("(()=>{const a=UDS.app; const b=a.D.blocks[1]; const l=a.D.lots.find(x=>x.blockId===b.id); return UDS.U.interiorPoint(l.building?l.building.fp:l.poly);})()")
        await pg.mouse.click(*pc); await pg.wait_for_timeout(200)
        await pg.keyboard.down("Shift"); await pg.mouse.click(*(await scr(other))); await pg.keyboard.up("Shift"); await pg.wait_for_timeout(300)
        print("other block:", await ev("document.querySelector('#selpop').innerText.replace(/\\n/g,' ')"))
        # 닫기 단추
        await pg.click('#selpop [data-act="selpopclose"]'); await pg.wait_for_timeout(200)
        print("closed:", await ev("document.querySelector('#selpop').hidden"), "sel kept:", await ev("UDS.app.selList().length"))
        # 3D에서 가구 경계선
        await ev("UDS.app.select(null)")
        r3 = await ev("(()=>{const a=UDS.app, r=a.r3.cv.getBoundingClientRect(); const b=a.D.blocks[5]; const e=[b.poly[0], b.poly[1]]; const m=[(e[0][0]+e[1][0])/2,(e[0][1]+e[1][1])/2]; const M=a.r3.matrices().VP; const x=m[0], y=0, z=-m[1]; const cw=M[3]*x+M[7]*y+M[11]*z+M[15]; const cx=(M[0]*x+M[4]*y+M[8]*z+M[12])/cw, cy=(M[1]*x+M[5]*y+M[9]*z+M[13])/cw; return {x:r.left+(cx*0.5+0.5)*r.width, y:r.top+(1-(cy*0.5+0.5))*r.height, id:b.id};})()")
        await pg.mouse.click(r3['x'], r3['y']); await pg.wait_for_timeout(1500)
        print("3d edge click:", await ev("UDS.app.state.sel"), "expected block", r3['id'])
        await pg.screenshot(path=OUTD + "/c_block3d.png")
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
