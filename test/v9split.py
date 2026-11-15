"""획지 나누기: 나란히·앞뒤로, 다시 나누기, 다시 하나로, 조각 합치기, 합친 획지 나누기"""
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
        toast = "(document.querySelector('#toast')||{}).textContent"
        blk = "b_st4"  # 주거 4×2
        lots = "(()=>{const a=UDS.app; return a.D.lots.filter(l=>l.blockId==='b_st4').map(l=>[l.key, Math.round(l.area), l.building?l.building.floors:0, l.sub?l.sub.k+'/'+l.sub.n+l.sub.dir:'', l.frontage.length]);})()"
        print("lots before:", await ev(lots))
        # 획지 하나를 평면에서 눌러 고른 뒤 속성 패널에서 [나란히 2]
        pt = await ev("(()=>{const a=UDS.app,l=a.D.lots.find(x=>x.id==='b_st4:0:1'); const c=l.poly.reduce((s,q)=>[s[0]+q[0]/l.poly.length,s[1]+q[1]/l.poly.length],[0,0]); const q=a.r2.w2s(c); const r=a.r2.cv.getBoundingClientRect(); return [r.left+q[0], r.top+q[1]];})()")
        await pg.mouse.click(*pt); await pg.wait_for_timeout(500)
        print("sel:", await ev("UDS.app.state.sel"))
        await pg.screenshot(path=OUTD + "/s_pane0.png")
        await pg.locator('#pane [data-act="splitlot"][data-arg$="|u|2"]').click(); await pg.wait_for_timeout(800)
        print("after split u2:", await ev(lots)); print(" sel:", await ev("UDS.app.state.sel"), "|", await ev(toast))
        print(" splits:", await ev("UDS.app.block('b_st4').splits"), "| pressed:", await ev("Array.from(document.querySelectorAll('#pane [data-act=\"splitlot\"][aria-pressed=\"true\"]')).map(x=>x.dataset.arg)"))
        await pg.screenshot(path=OUTD + "/s_split_u2.png")
        # 조각을 고른 채 [앞뒤로 2] → 원래 획지를 다시 나눔
        await pg.locator('#pane [data-act="splitlot"][data-arg$="|v|2"]').click(); await pg.wait_for_timeout(800)
        print("re-split v2:", await ev(lots)); print(" sel:", await ev("UDS.app.state.sel"))
        await pg.screenshot(path=OUTD + "/s_split_v2.png")
        # 조각 하나의 층수를 바꾸고 → 3개로 다시 나누면 그 설정을 이어받음
        await ev("(()=>{const a=UDS.app; const o=a.lotOv(a.state.sel.id); o.bld={floors:7}; a.commit();})()"); await pg.wait_for_timeout(400)
        await pg.locator('#pane [data-act="splitlot"][data-arg$="|u|3"]').click(); await pg.wait_for_timeout(800)
        print("re-split u3 (floors 7 inherited):", await ev(lots))
        # 다시 하나로
        await pg.locator('#pane [data-act="unsplit"]').click(); await pg.wait_for_timeout(800)
        print("unsplit:", await ev(lots)); print(" sel:", await ev("UDS.app.state.sel"), "|", await ev(toast), "| splits:", await ev("UDS.app.block('b_st4').splits"))
        # 되돌리기
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(600)
        print("undo → split again:", await ev("UDS.app.D.lots.filter(l=>l.blockId==='b_st4'&&l.sub).length"))
        # 조각 일부 + 옆 획지 합치기 → 이유 안내, 조각 전부 + 옆 획지 → 합침
        r = await ev("(()=>{const a=UDS.app; const ids=['b_st4:0:1.0','b_st4:0:2']; const c=a.mergeCheck(ids.map(id=>({type:'lot',id}))); return {ok:c.ok, reason:c.reason};})()")
        print("partial pieces + neighbour:", r)
        r = await ev("(()=>{const a=UDS.app; const ids=['b_st4:0:1.0','b_st4:0:1.1','b_st4:0:1.2','b_st4:0:2']; a.state.multi=ids.map(id=>({type:a.D.lots.find(l=>l.id===id).building?'building':'lot',id})); a.state.sel=a.state.multi[3]; const c=a.mergeCheck(a.selList()); a.mergeLots(); return {ok:c.ok, range:c.range, splits:a.block('b_st4').splits, merges:a.block('b_st4').merges};})()")
        print("all pieces + neighbour merged:", r); print(" lots:", await ev(lots))
        # 합친 획지를 나누기(앞뒤로 2)
        await ev("UDS.app.splitLot('b_st4:0:1', 2, 'v')"); await pg.wait_for_timeout(600)
        print("split merged lot v2:", await ev(lots))
        # 조각만 모두 골라 합치기 = 나눔만 풀림(합친 범위는 유지)
        r = await ev("(()=>{const a=UDS.app; const ids=['b_st4:0:1.0','b_st4:0:1.1']; a.state.multi=ids.map(id=>({type:a.D.lots.find(l=>l.id===id).building?'building':'lot',id})); a.state.sel=a.state.multi[1]; a.mergeLots(); return {splits:a.block('b_st4').splits, merges:a.block('b_st4').merges};})()")
        print("merge pieces only:", r); print(" lots:", await ev(lots))
        # 가구 패널: 처음 격자로
        await ev("UDS.app.splitLot('b_st4:1:0', 3, 'u')"); await pg.wait_for_timeout(500)
        await ev("UDS.app.select({type:'block', id:'b_st4'})"); await pg.wait_for_timeout(500)
        print("block pane head:", await ev("Array.from(document.querySelectorAll('#pane .h .hn')).map(x=>x.textContent)"))
        await pg.screenshot(path=OUTD + "/s_block.png")
        await pg.locator('#pane [data-act="unmergeall"]').click(); await pg.wait_for_timeout(700)
        print("reset grid:", await ev(lots), "|", await ev(toast))
        # 너무 작은 획지는 나눌 수 없음
        r = await ev("(()=>{const a=UDS.app; const n0=a.hist.length; a.splitLot('b_st4:0:0', 6, 'u'); const l=a.D.lots.filter(x=>x.blockId==='b_st4'&&x.sub).length; return [l, a.hist.length-n0];})()")
        print("split 6 (pieces, new hist):", r, "|", await ev(toast))
        # 공원 가구(한 획지)도 나눌 수 있음
        r = await ev("(()=>{const a=UDS.app; const b=a.D.blocks.find(x=>x.settings.use==='park'); const l=a.D.lots.find(x=>x.blockId===b.id); a.splitLot(l.id, 2, 'u'); return a.D.lots.filter(x=>x.blockId===b.id).map(x=>[x.key, x.use, Math.round(x.area)]);})()")
        print("park block split:", r)
        await pg.screenshot(path=OUTD + "/s_park.png")
        # 3D에서도 조각이 따로 집힘
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
