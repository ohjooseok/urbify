import asyncio, json, sys
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
        await pg.evaluate("()=>{const a=UDS.app; a.setScene('standard');}")
        await pg.wait_for_timeout(300)
        # 1. 도구 고르기(왼쪽 메뉴)
        await pg.evaluate("()=>UDS.ui.palReveal && UDS.ui.palReveal('rabout')")
        btn = await pg.query_selector('[data-pal="tool:rabout"]')
        check(btn is not None, "palette has roundabout tool")
        await pg.evaluate("()=>UDS.app.setTool('rabout')")
        st = await pg.evaluate("()=>({tool:UDS.app.state.tool, hint:document.getElementById('hint').textContent, cand:UDS.app.D.rabCand.length})")
        check(st['tool']=='rabout' and '회전교차로' in st['hint'] and st['cand']>0, f"tool active, hint shown, candidates={st['cand']}")
        # 2. 가장 큰 교차점을 평면에서 눌러 만들기
        q = await pg.evaluate("""()=>{const a=UDS.app; const c=a.D.rabCand.slice().sort((x,y)=>(y.deg-x.deg)||(y.W-x.W))[0]; a.r2.view.cx=c.p[0]; a.r2.view.cy=c.p[1]; a.r2.view.s=3; a.invalidate(1); const s=a.r2.w2s(c.p); const r=a.r2.cv.getBoundingClientRect(); return {x:r.left+s[0], y:r.top+s[1], p:c.p}}""")
        await pg.mouse.move(q['x']+3, q['y']+2)
        await pg.wait_for_timeout(150)
        hv = await pg.evaluate("()=>UDS.app.state.hover")
        check(hv is not None and hv.get('type')=='rabcand', f"hover shows candidate preview {hv and hv.get('type')}")
        await pg.mouse.click(q['x']+3, q['y']+2)
        await pg.wait_for_timeout(300)
        r = await pg.evaluate("""()=>{const a=UDS.app, rb=a.D.rabs[0]; return {n:a.D.rabs.length, P:(a.P.rabouts||[]).length, sel:a.state.sel, pane:document.getElementById('pane').textContent.slice(0,200), rb: rb && {d:rb.d, lanes:rb.lanes, entries:rb.entries, R2:rb.R2}, hist:a.hist.length}}""")
        check(r['n']==1 and r['P']==1, f"roundabout created {r['rb']}")
        check(r['sel'] and r['sel']['type']=='rab', "new roundabout selected")
        check('회전교차로' in r['pane'] and '내접원 지름' in r['pane'], "property pane shows roundabout")
        # 블록이 원 둘레에서 잘렸는가: 원(R2) 안에 가구 꼭짓점이 없어야
        inside = await pg.evaluate("""()=>{const a=UDS.app, rb=a.D.rabs[0]; let n=0; a.D.blocks.forEach(b=>b.poly.forEach(p=>{ if (Math.hypot(p[0]-rb.c[0],p[1]-rb.c[1]) < rb.R2-0.05) n++; })); return n}""")
        check(inside==0, f"blocks cut by roundabout footprint (vertices inside: {inside})")
        # 차도 밴드가 중앙섬을 덮지 않음: 팔의 차도 다각형 꼭짓점이 Ri 안쪽에 없어야
        cov = await pg.evaluate("""()=>{const a=UDS.app, rb=a.D.rabs[0]; let n=0; a.D.arms.forEach(arm=>arm.geo.bands.forEach(bp=>{ if(!bp.band.def.carriage) return; bp.poly.forEach(p=>{ if(Math.hypot(p[0]-rb.c[0],p[1]-rb.c[1]) < rb.Ri-0.05) n++; }); })); return n}""")
        check(cov==0, f"carriage bands stop at the ring ({cov})")
        yl = await pg.evaluate("()=>UDS.app.D.arms.reduce((s,a)=>s+a.geo.yields.length,0)")
        sp = await pg.evaluate("()=>UDS.app.D.arms.reduce((s,a)=>s+a.geo.splits.length,0)")
        stp = await pg.evaluate("""()=>{const a=UDS.app; let n=0; a.D.arms.forEach(arm=>['start','end'].forEach(e=>{ if(arm.trim[e].rab && arm.geo.stops.length) n++; })); return n}""")
        check(yl>=4 and sp>=4, f"yield lines {yl}, splitter islands {sp}")
        # 3. 지름·차로 수 바꾸기(속성 패널)
        await pg.evaluate("""()=>{const i=[...document.querySelectorAll('#pane input[type=number]')].find(x=>x.dataset.k==='내접원 지름'); i.value='42'; i.dispatchEvent(new Event('change',{bubbles:true}));}""")
        await pg.wait_for_timeout(200)
        d1 = await pg.evaluate("()=>UDS.app.D.rabs[0].d")
        check(abs(d1-42)<0.01, f"diameter set to 42 -> {d1}")
        await pg.evaluate("""()=>{const s=[...document.querySelectorAll('#pane select')].find(x=>x.dataset.k==='회전차로 수'); s.value='2'; s.dispatchEvent(new Event('change',{bubbles:true}));}""")
        await pg.wait_for_timeout(200)
        l2 = await pg.evaluate("()=>[UDS.app.D.rabs[0].lanes, UDS.app.D.rabs[0].d]")
        check(l2[0]==2, f"two-lane ring -> {l2}")
        await pg.evaluate("""()=>{const i=[...document.querySelectorAll('#pane input[type=number]')].find(x=>x.dataset.k==='내접원 지름'); i.value=''; i.dispatchEvent(new Event('change',{bubbles:true}));}""")
        await pg.wait_for_timeout(200)
        au = await pg.evaluate("()=>[UDS.app.D.rabs[0].auto, UDS.app.D.rabs[0].d]")
        check(au[0] is True, f"empty diameter -> auto {au}")
        # 4. 되돌리기
        await pg.evaluate("()=>{const a=UDS.app; a.undo(); a.undo();}")
        u = await pg.evaluate("()=>[UDS.app.D.rabs.length, UDS.app.D.rabs[0]&&UDS.app.D.rabs[0].lanes, UDS.app.D.rabs[0]&&UDS.app.D.rabs[0].d]")
        check(u[0]==1 and u[1]==1 and abs(u[2]-42)<0.01, f"undo restores earlier state {u}")
        await pg.evaluate("()=>{const a=UDS.app; a.redo(); a.redo();}")
        # 5. 도로를 옮기면 따라감
        mv = await pg.evaluate("""()=>{const a=UDS.app, rb=a.D.rabs[0]; const c0=rb.c.slice(); const n=a.D.rabs[0].node;
            // 이 교차점을 지나는 도로 하나를 3m 옮긴다(도로 전체 평행이동)
            const arm=a.D.arms.find(x=>x.trim.start.rab||x.trim.end.rab); const r=arm.road; const vert = Math.abs(r.pts[0][0]-r.pts[r.pts.length-1][0]) < 1;
            r.pts.forEach(p=>{ if (vert) p[0]+=3; else p[1]+=3; }); a.commit(); const rb2=a.D.rabs[0]; return {n:a.D.rabs.length, c0, c1: rb2&&rb2.c, vert}}""")
        check(mv['n']==1 and mv['c1'] is not None and abs((mv['c1'][0]-mv['c0'][0]) + (mv['c1'][1]-mv['c0'][1]))>2.5, f"roundabout follows moved road {mv}")
        await pg.evaluate("()=>UDS.app.undo()")
        # 6. 평면 SVG 내보내기
        sv = await pg.evaluate("()=>{const s=UDS.app.r2.exportSVG(); const d=new DOMParser().parseFromString(s,'image/svg+xml'); return {err:!!d.querySelector('parsererror'), n:s.length}}")
        check(not sv['err'], f"plan SVG export ok ({sv['n']} bytes)")
        # 7. 3D 그리기 + 고르기
        await pg.evaluate("()=>{const a=UDS.app; a.select({type:'rab', id:a.D.rabs[0].id}); a.focusFrom('2d', a.state.sel);}")
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=OUTD + "/v12rab_a.png")
        pk = await pg.evaluate("""()=>{const a=UDS.app, r3=a.r3; if(!r3.ok) return 'no3d'; const rb=a.D.rabs[0]; r3.draw(); const s=r3.w2s? r3.w2s([rb.c[0]+ (rb.Ri+rb.R)/2, rb.c[1]], 0.2):null; return s}""")
        # 8. 사람·차량
        tr = await pg.evaluate("""()=>{const a=UDS.app; a.setTraffic(true); const T=a.traffic; if(!T.ready) return {ready:false};
            const n=[...T.nodes.values()].find(x=>x.rab); let used=0, maxRing=0, minGap=1e9, sigOnRab = !!(n && n.sig);
            for(let k=0;k<2400;k++){ T.step(0.05); const ring=T.cars.filter(c=>c.conn&&c.conn.rab); if(ring.length) used++; maxRing=Math.max(maxRing, ring.length);
              if (k%10===0) for(let i=0;i<ring.length;i++) for(let j=i+1;j<ring.length;j++){ const A=ring[i], B=ring[j]; const pa=[0,0,0,0], pb=[0,0,0,0]; T._route(A,0,pa); T._route(B,0,pb); minGap=Math.min(minGap, Math.hypot(pa[0]-pb[0],pa[1]-pb[1])); } }
            const walks=T.walks.filter(W=>W.key.startsWith('rab|')).length;
            return {ready:true, used, maxRing, minGap, sigOnRab, walks, cars:T.cars.length}}""")
        check(tr.get('ready') and tr['used']>50 and tr['maxRing']>=1, f"cars circulate through roundabout {tr}")
        check(not tr.get('sigOnRab'), "no signal at roundabout")
        check(tr.get('walks',0)>=3, "pedestrian ring walkways built")
        check(tr.get('minGap',0) > 2.0, f"ring cars keep distance (min centre gap {tr.get('minGap')})")
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUTD + "/v12rab_b.png")
        await pg.evaluate("()=>UDS.app.setTraffic(false)")
        # 9. 지우개로 지우기
        await pg.evaluate("()=>{const a=UDS.app; a.setTool('erase'); a.clickWorld(a.D.rabs[0].c, {type:'rab', id:a.D.rabs[0].id});}")
        e = await pg.evaluate("()=>[UDS.app.D.rabs.length, (UDS.app.P.rabouts||[]).length]")
        check(e==[0,0], f"eraser removes roundabout {e}")
        await pg.evaluate("()=>UDS.app.undo()")
        # 10. 저장 후 다시 열기
        sv2 = await pg.evaluate("()=>{const a=UDS.app; a.saveSoon && a.saveSoon(); return (a.P.rabouts||[]).length}")
        await pg.wait_for_timeout(1500)
        await pg.reload()
        await pg.wait_for_timeout(1200)
        rl = await pg.evaluate("()=>[UDS.app.D.rabs.length, (UDS.app.P.rabouts||[]).length]")
        check(rl[0]==1, f"roundabout persists after reload {rl}")
        # 11. 구도심·빈 대상지에서도 오류 없이
        for sc in ['oldtown','random']:
            r2 = await pg.evaluate("""(sc)=>{const a=UDS.app; a.setScene(sc); const cs=a.D.rabCand.slice(0,4); cs.forEach(c=>{ a.setTool('rabout'); a.raboutAt(c.p, null); }); a.setTool('select');
                const R=a.D.rabs; let over=0; R.forEach((x,i)=>R.slice(i+1).forEach(y=>{ if (Math.hypot(x.c[0]-y.c[0],x.c[1]-y.c[1]) < x.R2+y.R2-0.5) over++; }));
                return {cand:cs.length, rabs:R.length, over, blocks:a.D.blocks.length, warn:a.D.checks.filter(k=>k.kind==='회전교차로 겹침').length}}""", sc)
            check(r2['rabs']>=2 and r2['over']==0 and r2['warn']==0, f"{sc}: placed without overlap {r2}")
        # 가까운 교차점은 막고 알림
        bl = await pg.evaluate("""()=>{const a=UDS.app; a.setScene('oldtown'); a.setTool('rabout'); const c0=a.D.rabCand.find(c=>Math.abs(c.p[0]-70)<1&&Math.abs(c.p[1]-130)<1); if(!c0) return null; a.raboutAt(c0.p,null);
            const c1=a.D.rabCand.find(c=>Math.abs(c.p[0]-95)<1&&Math.abs(c.p[1]-130)<1); const n0=a.D.rabs.length; if(c1) a.raboutAt(c1.p,null); a.setTool('select');
            return {blocked: c1 && c1.blocked, n0, n1:a.D.rabs.length, toast:(document.querySelector('#toast')||{}).textContent||''}}""")
        check(bl is None or (bl['blocked'] and bl['n0']==bl['n1']), f"too-close junction refused {bl}")
        print("errors:", logs or "none")
        if logs: ok_=False
        await b.close()
    print("RESULT", "OK" if ok and not logs else "FAIL")
asyncio.run(main())
