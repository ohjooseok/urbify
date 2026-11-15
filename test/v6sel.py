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
        # 화면 좌표 구하기
        S = "(w)=>{const a=UDS.app,r=a.r2.cv.getBoundingClientRect(),q=a.r2.w2s(w);return [r.left+q[0], r.top+q[1]];}"
        async def scr(w): return await ev(f"({S})({json.dumps(w)})")
        # 요소 세 개를 놓는다(빈 공원 안)
        await ev("(()=>{const a=UDS.app; a.setTool('place','bench'); a.placeAt([150,150]); a.placeAt([170,150]); a.setTool('place','tree'); a.placeAt([160,170]); a.setTool('select'); a.select(null);})()")
        await pg.wait_for_timeout(500)
        ids = await ev("UDS.app.P.objects.slice(-3).map(o=>[o.id,o.type,o.x,o.y,o.species||''])")
        print("objs:", ids)
        p1 = await scr([150,150]); p2 = await scr([170,150]); p3 = await scr([160,170])
        # A. 선택 도구: 끌어도 요소가 움직이지 않는다
        await pg.mouse.move(*p1); await pg.mouse.down(); await pg.mouse.move(p1[0]+40, p1[1]+10, steps=4); await pg.mouse.up(); await pg.wait_for_timeout(300)
        print("A select-drag obj pos:", await ev("UDS.app.P.objects.slice(-3)[0].x"), "view moved:", await ev("UDS.app.r2.view.cx"))
        await ev("UDS.app.r2.fit(UDS.app.P.site,1.14); UDS.app.invalidate(1)"); await pg.wait_for_timeout(200)
        p1 = await scr([150,150]); p2 = await scr([170,150]); p3 = await scr([160,170])
        # C. Shift+누름으로 여럿 고르기
        await pg.mouse.click(*p1); await pg.wait_for_timeout(250)
        await pg.keyboard.down("Shift"); await pg.mouse.click(*p2); await pg.wait_for_timeout(250); await pg.mouse.click(*p3); await pg.wait_for_timeout(250); await pg.keyboard.up("Shift")
        print("C multi:", await ev("[UDS.app.selList().length, UDS.app.state.multi.map(t=>t.type)]"), "pane:", await ev("document.querySelector('.phead .pt b').textContent"))
        # 빼기
        await pg.keyboard.down("Shift"); await pg.mouse.click(*p2); await pg.keyboard.up("Shift"); await pg.wait_for_timeout(250)
        print("C toggled off:", await ev("UDS.app.selList().length"))
        await pg.keyboard.down("Shift"); await pg.mouse.click(*p2); await pg.keyboard.up("Shift"); await pg.wait_for_timeout(250)
        # 빈 곳 Shift+누름: 유지
        pe = await scr([-12,-12])
        await pg.keyboard.down("Shift"); await pg.mouse.click(*pe); await pg.keyboard.up("Shift"); await pg.wait_for_timeout(250)
        print("C shift-empty keeps:", await ev("UDS.app.selList().length"))
        # F. 이동 도구로 묶음 이동
        await pg.keyboard.press("m"); await pg.wait_for_timeout(200)
        print("tool:", await ev("UDS.app.state.tool"), "pressed:", await ev("document.querySelector('[data-pal=\"tool:move\"]').getAttribute('aria-pressed')"))
        before = await ev("UDS.app.P.objects.slice(-3).map(o=>[o.x,o.y])")
        await pg.mouse.move(*p1); await pg.mouse.down(); await pg.mouse.move(p1[0]+30, p1[1]-20, steps=5); await pg.mouse.up(); await pg.wait_for_timeout(500)
        after = await ev("UDS.app.P.objects.slice(-3).map(o=>[o.x,o.y])")
        print("F group move:", before, "->", after, "still multi:", await ev("UDS.app.selList().length"))
        await pg.screenshot(path=OUTD + "/n_sel_move.png")
        # Delete: 한꺼번에
        n0 = await ev("UDS.app.P.objects.length")
        await pg.keyboard.press("Delete"); await pg.wait_for_timeout(500)
        print("Delete multi:", n0, "->", await ev("UDS.app.P.objects.length"), "toast:", await ev("document.querySelector('#toast').textContent"))
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(500)
        print("undo:", await ev("UDS.app.P.objects.length"))
        # B. 이동 도구로 도로 통째로 옮기기 (붙은 도로 끝이 따라옴)
        info = await ev("(()=>{const a=UDS.app; const r=a.P.roads.find(x=>x.name.startsWith('국지도로 1')); return {id:r.id, pts:r.pts, name:r.name};})()")
        print("road:", info)
        mid = [(info['pts'][0][0]+info['pts'][1][0])/2+7, (info['pts'][0][1]+info['pts'][1][1])/2]
        pm = await scr(mid)
        tied0 = await ev("(()=>{const a=UDS.app; return a.P.roads.filter(r=>r.id!=='%s').map(r=>[r.name, r.pts[0], r.pts[r.pts.length-1]]).filter(x=>true).length})()" % info['id'])
        dead0 = await ev("UDS.app.D.deadEnds.length")
        sc = await ev("UDS.app.r2.view.s")
        await pg.mouse.move(*pm); await pg.mouse.down(); await pg.mouse.move(pm[0], pm[1]-12*sc, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(900)
        print("B road moved:", await ev("UDS.app.road('%s').pts" % info['id']), "dead ends:", dead0, "->", await ev("UDS.app.D.deadEnds.length"), "sel:", await ev("UDS.app.state.sel"), "blocks:", await ev("UDS.app.D.blocks.length"))
        await pg.screenshot(path=OUTD + "/n_road_move.png")
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(600)
        print("undo road:", await ev("UDS.app.road('%s').pts" % info['id']))
        # 꼭짓점 끌기(이동 도구, 고른 도로)
        await ev("UDS.app.select({type:'road', id:'%s'})" % info['id']); await pg.wait_for_timeout(300)
        v0 = await scr(info['pts'][0])
        await pg.mouse.move(*v0); await pg.mouse.down(); await pg.mouse.move(v0[0]+6*sc, v0[1], steps=5); await pg.mouse.up(); await pg.wait_for_timeout(700)
        print("vertex drag:", await ev("UDS.app.road('%s').pts" % info['id']))
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(500)
        # 선택 도구에서는 꼭짓점이 움직이지 않는다
        await pg.keyboard.press("v"); await pg.wait_for_timeout(200)
        await pg.mouse.move(*v0); await pg.mouse.down(); await pg.mouse.move(v0[0]+6*sc, v0[1], steps=5); await pg.mouse.up(); await pg.wait_for_timeout(500)
        print("vertex drag in select:", await ev("UDS.app.road('%s').pts" % info['id']))
        await ev("UDS.app.r2.fit(UDS.app.P.site,1.14); UDS.app.invalidate(1)")
        # E. 목록 상자에 초점이 있어도 Delete로 지움
        await ev("UDS.app.select({type:'object', id: UDS.app.P.objects[UDS.app.P.objects.length-1].id})"); await pg.wait_for_timeout(300)
        await pg.focus('#pane select'); n0 = await ev("UDS.app.P.objects.length")
        await pg.keyboard.press("Delete"); await pg.wait_for_timeout(400)
        print("E delete with select focused:", n0, "->", await ev("UDS.app.P.objects.length"))
        # 글 입력 칸에서는 지우지 않음
        await ev("UDS.app.select({type:'road', id:'%s'})" % info['id']); await pg.wait_for_timeout(300)
        await pg.focus('#pane input[type=text]'); n0 = await ev("UDS.app.P.roads.length")
        await pg.keyboard.press("Delete"); await pg.wait_for_timeout(300)
        print("text input keeps:", n0, "->", await ev("UDS.app.P.roads.length"))
        # 도로 선택 후 Delete → 도로 삭제(구간이 아니라)
        await ev("document.activeElement.blur()")
        await ev("(()=>{const a=UDS.app; a.selectSeg(a.secRoad().segs[1].id);})()"); await pg.wait_for_timeout(200)
        pr = await scr(mid); await pg.mouse.click(*pr); await pg.wait_for_timeout(400)
        print("after clicking road: selSeg", await ev("UDS.app.state.selSeg"), "sel", await ev("UDS.app.state.sel"))
        nseg = await ev("UDS.app.secRoad().segs.length")
        await pg.keyboard.press("Delete"); await pg.wait_for_timeout(500)
        print("delete road:", n0, "->", await ev("UDS.app.P.roads.length"))
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(500)
        # D. 3D에서 Shift+누름
        r3 = await ev("(()=>{const r=UDS.app.r3.cv.getBoundingClientRect(); return [r.left,r.top,r.width,r.height]})()")
        await ev("UDS.app.select(null)")
        await pg.mouse.click(r3[0]+r3[2]*0.55, r3[1]+r3[3]*0.75); await pg.wait_for_timeout(1500)
        s1 = await ev("UDS.app.state.sel")
        await pg.keyboard.down("Shift"); await pg.mouse.click(r3[0]+r3[2]*0.35, r3[1]+r3[3]*0.62); await pg.keyboard.up("Shift"); await pg.wait_for_timeout(1500)
        print("D 3d shift:", s1, await ev("UDS.app.selList().map(t=>t.type)"))
        await pg.screenshot(path=OUTD + "/n_sel3d.png")
        print("\n".join(logs[:20]) or "no errors")
        await b.close()
asyncio.run(main())
