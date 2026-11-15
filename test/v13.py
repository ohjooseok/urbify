"""v13: 회전교차로 노드(막다른 끝·도로 중간·끌기), 건물 곧은 면, 수목 고르기·지우기, 입지 분석, 음영분석·3D 오브젝트 묶음, 조도분석, 단면선 3D"""
import asyncio, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
ok=True
def check(c, msg):
    global ok
    print(("PASS " if c else "FAIL ")+msg)
    if not c: ok=False
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        pg = await b.new_page(viewport={"width":1440,"height":900})
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        ev = pg.evaluate
        # 머리글·이름표
        hd = await ev("()=>({brand:document.querySelector('.pbrand').innerText, logo:!!document.querySelector('.pbrand svg, .brand svg.logo'), top:document.querySelector('#v2d .vt').innerText.trim(), sec:document.querySelector('#sechead .st').innerText, rab:[...document.querySelectorAll('[data-pal=\"tool:rabout\"]')].map(b=>b.textContent.trim()), ur:document.querySelectorAll('.ur .picto').length, frame:document.querySelectorAll('.pvframe button').length, div:!!document.querySelector('.pvframe .pvdiv')})")
        check('Urbify' in hd['brand'] and 'Interactive Urban Design Platform' in hd['brand'] and not hd['logo'], f"brand {hd['brand']!r}")
        check(hd['top']=='Top' and hd['sec'].startswith('Section'), f"view labels {hd['top']} / {hd['sec']}")
        check(all(t=='회전교차로' for t in hd['rab']), f"rab item text {hd['rab']}")
        check(hd['ur']==2 and hd['frame']==5 and hd['div'], "undo/redo in circles, 5 buttons in one frame with divider")
        # 묶음: 음영분석 스위치·조도분석, 3D 오브젝트, 레이어
        await pg.click('.pgrp[data-grp="shade"] .pgh'); await pg.wait_for_timeout(200)
        s1 = await ev("()=>({open:document.querySelector('.pgrp[data-grp=\"shade\"]').classList.contains('open'), body:document.querySelector('[data-xbody=\"shade\"]').innerText})")
        check(s1['open'] and '조도분석' in s1['body'] and '태양 궤적도' in s1['body'] and '일조시간' in s1['body'], "음영분석 group opens with 조도분석 rows")
        await pg.click('.psw[data-act="xsw"][data-arg="shade"]'); await pg.wait_for_timeout(200)
        sh = await ev("()=>[UDS.app.state.layers.shadows, document.querySelector('.psw[data-arg=\"shade\"]').getAttribute('aria-checked')]")
        check(sh[0] is True and sh[1]=='true', f"shade switch turns shadows on {sh}")
        await pg.click('[data-xbody="shade"] .psw[data-arg="sunhours"]'); await pg.wait_for_timeout(600)
        sh2 = await ev("()=>{const r=UDS.Ana.sunHours(UDS.app); return {on:UDS.app.state.ana.sunhours, n:r.nx*r.ny, cell:r.cell, st:r.stats, txt:document.querySelector('[data-xbody=\"shade\"]').innerText.includes('4시간 이상')}}")
        check(sh2['on'] and sh2['txt'] and 0 < sh2['st']['ok4'] <= 1, f"sunlight hours computed {sh2}")
        await pg.click('[data-xbody="shade"] .psw[data-arg="lux"]'); await pg.wait_for_timeout(600)
        lx = await ev("()=>{const r=UDS.Ana.lux(UDS.app); return {on:UDS.app.state.ana.lux, st:r.stats}}")
        check(lx['on'] and lx['st']['n']>10 and lx['st']['avg']>1, f"streetlight lux computed {lx}")
        await pg.click('[data-xbody="shade"] .psw[data-arg="sunpath"]'); await pg.wait_for_timeout(500)
        sp = await ev("()=>{const a=UDS.app; a.r3.draw(); return {on:a.state.ana.sunpath, ov:a.r3.meshes.ovG&&a.r3.meshes.ovG.count, ov3:a.r3.meshes.ov3&&a.r3.meshes.ov3.count, ovl:a.r3.meshes.ovL&&a.r3.meshes.ovL.count, lab:[...document.querySelectorAll('.sec3d')].map(d=>d.hidden?'h':d.textContent)}}")
        check(sp['on'] and sp['ov']>1000 and sp['ov3']>100 and sp['ovl']>100, f"3D overlays built {sp}")
        check(sp['lab']==['A','A′'], f"section labels in 3D {sp['lab']}")
        await pg.screenshot(path=OUTD + "/v13_a.png")
        # 3D 오브젝트: 스위치·밀도·개인형 이동장치
        await pg.click('.pgrp[data-grp="obj"] .pgh'); await pg.wait_for_timeout(200)
        await pg.click('.psw[data-act="xsw"][data-arg="obj"]'); await pg.wait_for_timeout(600)
        ob = await ev("()=>{const a=UDS.app, T=a.traffic; for(let i=0;i<100;i++) T.step(0.05); return {on:a.state.traffic.on, c:T.counts(), txt:document.querySelector('[data-xbody=\"obj\"]').innerText}}")
        check(ob['on'] and ob['c']['pms']>0 and '개인형 이동장치' in ob['txt'], f"3D objects with PMs {ob['c']}")
        await ev("()=>{const i=document.querySelector('[data-xbody=\"obj\"] input[data-tset=\"pm\"]'); i.value=0; i.dispatchEvent(new Event('input',{bubbles:true}));}"); await pg.wait_for_timeout(300)
        ob2 = await ev("()=>UDS.app.traffic.counts()")
        check(ob2['pms']==0, f"PM toggle off {ob2}")
        await pg.click('.psw[data-act="xsw"][data-arg="obj"]', timeout=90000); await pg.wait_for_timeout(300) # 사람·차량이 움직이는 동안은 소프트웨어 렌더링이 느려 넉넉히
        # 레이어 묶음
        await pg.click('.pgrp[data-grp="lyr"] .pgh'); await pg.wait_for_timeout(200)
        await pg.click('[data-xbody="lyr"] input[data-layer="trees"]'); await pg.wait_for_timeout(200)
        ly = await ev("()=>UDS.app.state.layers.trees")
        check(ly is False, "layer checkbox in dropdown works")
        await pg.click('[data-xbody="lyr"] input[data-layer="trees"]')
        await ev("()=>{const a=UDS.app; a.state.ana.sunhours=false; a.state.ana.lux=false; a.state.ana.sunpath=false; UDS.ui.xRefresh(); a.invalidate(7);}")
        # 수목 고르기·지우기
        tr = await ev("""()=>{const a=UDS.app, t=a.D.trees.find(x=>x.kind==='street'); a.r2.view.cx=t.x; a.r2.view.cy=t.y; a.r2.view.s=6; a.invalidate(1); const s=a.r2.w2s([t.x,t.y]); const h=a.r2.hitTest(s); return {h, key:t.key, n:a.D.trees.length}}""")
        check(tr['h'] and tr['h']['type']=='tree' and tr['h']['id']==tr['key'], f"street tree hit test {tr['h']}")
        await ev("(k)=>UDS.app.select({type:'tree', id:k})", tr['key'])
        pane = await ev("()=>document.getElementById('pane').innerText")
        check('가로수' in pane and '수종' in pane, "tree pane shows")
        await ev("()=>UDS.app.deleteSelected()")
        n2 = await ev("()=>[UDS.app.D.trees.length, (UDS.app.P.treeOff||[]).length]")
        check(n2[0]==tr['n']-1 and n2[1]==1, f"tree deleted {n2}")
        await ev("()=>UDS.app.treeRestore()")
        n3 = await ev("()=>UDS.app.D.trees.length")
        check(n3==tr['n'], "trees restored")
        # 입지 분석
        loc = await ev("""()=>{const a=UDS.app; const b=a.D.buildings[10]; a.state.tab='metrics'; a.select({type:'building', id:b.lotId}); const L=UDS.Ana.location(a, b.lotId); return {tab:a.state.tab, txt:document.getElementById('pane').innerText.slice(0,400), front:L.front.length, rows:L.rows.map(r=>[r.name, Math.round(r.near), r.n4, r.n8]), pop:L.pop4}}""")
        check(loc['tab']=='metrics' and '입지 분석' in loc['txt'] and loc['front']>=1, f"location analysis in metrics: front {loc['front']}, pop {loc['pop']}")
        print("   rows:", loc['rows'])
        await pg.screenshot(path=OUTD + "/v13_b.png")
        # 회전교차로: 도로 중간에 두기
        rm = await ev("""()=>{const a=UDS.app; a.state.tab='props';
            // 차도가 있고 대상지 안쪽에 있는 가장 긴 팔의 가운데
            const W=a.P.site.w, H=a.P.site.h; const arm=a.D.arms.filter(x=>x.lay.hasCar && x.pts.every(p=>p[0]>30&&p[1]>30&&p[0]<W-30&&p[1]<H-30)).sort((x,y)=>y.len-x.len)[0];
            const r=arm.road; let acc=0, m=null; for(let i=0;i+1<arm.pts.length;i++){ const L=Math.hypot(arm.pts[i+1][0]-arm.pts[i][0],arm.pts[i+1][1]-arm.pts[i][1]); if(acc+L>=arm.len/2){ const t=(arm.len/2-acc)/L; m=[arm.pts[i][0]+(arm.pts[i+1][0]-arm.pts[i][0])*t, arm.pts[i][1]+(arm.pts[i+1][1]-arm.pts[i][1])*t]; break;} acc+=L; }
            const n0=r.pts.length; a.setTool('rabout'); a.raboutAt(m, null); a.setTool('select'); const rb=a.D.rabs[a.D.rabs.length-1]; return {n:a.D.rabs.length, arms: rb&&rb.arms, pts:[n0, r.pts.length], d: rb&&rb.d, road:r.name, toast:(document.querySelector('.toast')||{}).textContent}}""")
        check(rm['n']==1 and rm['arms']==2 and rm['pts'][1]==rm['pts'][0]+1, f"mid-road roundabout {rm}")
        # 끌어 옮기기(이동 도구, 평면에서 마우스로)
        dg = await ev("""()=>{const a=UDS.app, rb=a.D.rabs[0]; a.setTool('move'); a.r2.view.cx=rb.c[0]; a.r2.view.cy=rb.c[1]; a.r2.view.s=3; a.invalidate(1); const s=a.r2.w2s(rb.c), r=a.r2.cv.getBoundingClientRect(); return {x:r.left+s[0], y:r.top+s[1], c:rb.c.slice()}}""")
        await pg.mouse.move(dg['x'], dg['y']); await pg.mouse.down(); await pg.mouse.move(dg['x']+15, dg['y']-24, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(300)
        dg2 = await ev("()=>{const a=UDS.app, rb=a.D.rabs[0]; return {c:rb.c, n:a.D.rabs.length, hist:a.hi}}")
        moved = abs(dg2['c'][0]-dg['c'][0]) + abs(dg2['c'][1]-dg['c'][1])
        check(dg2['n']==1 and moved > 6, f"roundabout dragged {dg['c']} -> {dg2['c']}")
        await ev("()=>UDS.app.undo()")
        # 곧은 면: 회전교차로 원 가까이의 건물 꼭짓점이 원을 따라 늘어서지 않음
        st = await ev("""()=>{const a=UDS.app, rb=a.D.rabs[0]; let n=0, near=0; a.D.buildings.forEach(b=>{ const k=b.fp.filter(p=>Math.hypot(p[0]-rb.c[0],p[1]-rb.c[1]) < rb.R2+b.front+0.6).length; if(k) near++; n=Math.max(n,k); }); return {maxNearVerts:n, near}}""")
        check(st['maxNearVerts'] <= 2, f"building faces near roundabout are straight {st}")
        # 막다른 끝: 빈 대상지에 도로 하나를 반쯤 그리고 끝에 둔다
        de = await ev("""()=>{const a=UDS.app; a.setScene('blank',{w:300,h:200}); a.setTool('road','jung3'); a.roadClick([0,100]); a.roadClick([150,100]); a.finishRoad(); a.setTool('rabout'); const c=a.D.rabCand.find(x=>x.end); if(!c) return {cand:a.D.rabCand.length}; a.raboutAt(c.p,null); a.setTool('select'); const rb=a.D.rabs[0]; return {cand:a.D.rabCand.length, end:!!c, arms:rb&&rb.arms, dead:a.D.deadEnds.length, curb:rb&&rb.curbArcs.length}}""")
        check(de.get('arms')==1 and de.get('dead')==0, f"dead-end roundabout (turning circle) {de}")
        tr2 = await ev("""()=>{const a=UDS.app; a.setTraffic(true); const T=a.traffic; let ring=0; for(let i=0;i<1500;i++){ T.step(0.05); if(T.cars.some(c=>c.conn&&c.conn.rab)) ring++; } a.setTraffic(false); return {ring, cars:T.cars.length}}""")
        check(tr2['ring']>20, f"cars turn around at the dead-end roundabout {tr2}")
        print("errors:", logs or "none")
        if logs: ok_=False
        await b.close()
    print("RESULT", "OK" if ok and not logs else "FAIL")
asyncio.run(main())
