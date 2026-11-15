import asyncio, sys, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width":390,"height":800}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type in ("error",) and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(1000)
        ev = pg.evaluate
        cdp = await ctx.new_cdp_session(pg)
        async def press(x, y, ms):
            await cdp.send("Input.dispatchTouchEvent", {"type":"touchStart","touchPoints":[{"x":x,"y":y}]})
            await pg.wait_for_timeout(ms)
            await cdp.send("Input.dispatchTouchEvent", {"type":"touchEnd","touchPoints":[]})
        info = await ev("(()=>{const a=UDS.app; const b=a.D.blocks[0]; const r=a.r2.cv.getBoundingClientRect(); const S=(w)=>{const q=a.r2.w2s(w); return [r.left+q[0], r.top+q[1]]}; const lots=a.D.lots.filter(l=>l.blockId===b.id); const c=(l)=>S(UDS.U.interiorPoint(l.building?l.building.fp:l.poly)); const f=(r0,i0)=>lots.find(l=>l.cell.r0===r0&&l.cell.i0===i0); return {a:c(f(0,0)), b:c(f(0,1)), n:a.D.lots.length};})()")
        await pg.touchscreen.tap(*info['a']); await pg.wait_for_timeout(300)
        print("tap:", await ev("UDS.app.selList().length"))
        await press(info['b'][0], info['b'][1], 650); await pg.wait_for_timeout(400)
        print("long press:", await ev("UDS.app.selList().length"), "selpop:", await ev("(()=>{const e=document.querySelector('#selpop'); const r=e.getBoundingClientRect(); return [e.hidden, e.innerText.replace(/\\n/g,' '), Math.round(r.left), Math.round(r.top), Math.round(r.right)]})()"), "peek:", await ev("document.querySelector('#selname').textContent"))
        await pg.screenshot(path=OUTD + "/c_m_merge.png")
        # 짧게 누르면(탭) 길게 누르기로 치지 않음
        await pg.locator('#selpop [data-act="mergelots"]').tap(); await pg.wait_for_timeout(700)
        print("merged:", info['n'], "->", await ev("UDS.app.D.lots.length"), "toast:", await ev("document.querySelector('#toast').textContent"))
        # 끌기(화면 이동)는 길게 누르기로 치지 않음
        await cdp.send("Input.dispatchTouchEvent", {"type":"touchStart","touchPoints":[{"x":200,"y":300}]})
        for k in range(1,8):
            await cdp.send("Input.dispatchTouchEvent", {"type":"touchMove","touchPoints":[{"x":200+k*6,"y":300+k*3}]}); await pg.wait_for_timeout(90)
        await cdp.send("Input.dispatchTouchEvent", {"type":"touchEnd","touchPoints":[]}); await pg.wait_for_timeout(300)
        print("after pan: sel count", await ev("UDS.app.selList().length"))
        # 가구 경계선 두드리기 → 가구
        e = await ev("(()=>{const a=UDS.app; const b=a.D.blocks[3]; const r=a.r2.cv.getBoundingClientRect(); let best=null; for(let k=0;k<b.poly.length;k++){const p=b.poly[k], q=b.poly[(k+1)%b.poly.length]; const L=Math.hypot(q[0]-p[0],q[1]-p[1]); if(!best||L>best.L) best={L, m:[(p[0]+q[0])/2,(p[1]+q[1])/2]};} const s=a.r2.w2s(best.m); return [r.left+s[0], r.top+s[1], b.id];})()")
        await pg.touchscreen.tap(e[0], e[1]); await pg.wait_for_timeout(400)
        print("edge tap:", await ev("UDS.app.state.sel"), "expected", e[2])
        await pg.locator('#tabs [data-tab="props"]').tap(); await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUTD + "/c_m_block.png")
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
