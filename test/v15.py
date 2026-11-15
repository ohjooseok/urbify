"""v15: 도로 이어 그리기·대상지 넓히기, 건물 옮기기·복사·회전·반전, 사람·건물 표현(무릎·팔꿈치, 난간벽·옥상 설비, 창 상세)"""
import asyncio
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
        async def scr(w):  # 세계 좌표 → 페이지 좌표
            return await ev("(w)=>{const a=UDS.app, r=a.r2.cv.getBoundingClientRect(), s=a.r2.w2s(w); return [r.left+s[0], r.top+s[1]];}", w)

        # 1. 도로 이어 그리기(마우스): 남측 간선도로 끝에서 대상지 밖까지
        r0 = await ev("""()=>{const a=UDS.app, P=a.P; const s=P.roads.find(r=>r.name==='남측 간선도로'); const v=a.r2.view; v.cx=470; v.cy=20; v.s=2.2; a.invalidate(1);
           a.setTool('road', s.preset); return {id:s.id, n:P.roads.length, end:s.pts[s.pts.length-1], W:P.site.w, H:P.site.h};}""")
        p1 = await scr(r0['end']); p2 = await scr([r0['end'][0]+90, r0['end'][1]])
        await pg.mouse.click(*p1); await pg.wait_for_timeout(120)
        await pg.mouse.move(p2[0], p2[1]); await pg.wait_for_timeout(200)
        pv = await ev("()=>{const a=UDS.app; return {draw:!!a.state.drawRoad, pts:(a.state.drawRoad||{}).pts?.length}}")
        await pg.mouse.click(*p2); await pg.wait_for_timeout(120)
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        r1 = await ev("""(id)=>{const a=UDS.app, P=a.P, s=a.road(id); return {n:P.roads.length, end:s.pts[s.pts.length-1], np:s.pts.length, W:P.site.w, H:P.site.h, dead:a.D.deadEnds.length, toast:(document.querySelector('#toast')||{}).textContent||''}}""", r0['id'])
        check(r1['n']==r0['n'] and abs(r1['end'][0]-(r0['end'][0]+90))<0.6, f"same-type road continues from its end instead of a new road {r0['end']} → {r1['end']} (roads {r0['n']}→{r1['n']})")
        check(r1['W']>=r0['W']+89 and r1['H']==r0['H'] and '넓혔' in r1['toast'], f"site grows to hold the road {r0['W']}→{r1['W']} / toast {r1['toast'][:40]!r}")
        # 동쪽 경계 도로까지 이어 닫기
        r2 = await ev("""()=>{const a=UDS.app, P=a.P; const n=P.roads.find(r=>r.name.includes('북측')); a.setTool('road', n.preset); const e0=n.pts[n.pts.length-1]; a.roadClick(e0); a.roadClick([e0[0]+90,e0[1]]); a.finishRoad();
           const e=P.roads.find(r=>r.name.includes('동측')); a.setTool('road', e.preset); a.roadClick([P.site.w,0]); a.roadClick([P.site.w,P.site.h]); a.finishRoad(); a.setTool('select');
           return {W:P.site.w, H:P.site.h, dead:a.D.deadEnds.length, blocks:a.D.blocks.length}}""")
        check(r2['dead']==0 and r2['W']==r1['W'], f"extended streets close into new blocks without dead ends {r2}")
        # 서쪽으로 넓히기: 좌표가 밀려도 블록 설정·지운 가로수가 따라온다
        r3 = await ev("""()=>{const a=UDS.app, P=a.P, U=UDS.U; const blk=a.D.blocks[0]; const S=a.block(blk.id); S.use='com'; const t=a.D.trees.find(x=>x.kind==='street'); P.treeOff=(P.treeOff||[]).concat([t.key]); a.commit();
           const W0=P.site.w, c0=U.polyCentroid(blk.poly); const s=P.roads.find(r=>r.name==='남측 간선도로');
           a.setTool('road', s.preset); a.roadClick([0,0]); a.roadClick([-60,0]); a.finishRoad(); a.setTool('select');
           const blk2=a.D.blocks.find(b=>U.pointInPoly([c0[0]+60,c0[1]],b.poly)); const S2=blk2&&a.block(blk2.id);
           const tk=P.treeOff[P.treeOff.length-1];
           return {W0, W:P.site.w, shift:P.shift, start:s.pts[0], use:S2&&S2.use, treeGone:!a.D.trees.some(x=>x.key===tk)}}""")
        check(r3['W']==r3['W0']+60 and r3['shift']==[60,0] and r3['start'][0]==0, f"west growth shifts the world {r3['W0']}→{r3['W']} shift {r3['shift']} start {r3['start']}")
        check(r3['use']=='com' and r3['treeGone'], f"block settings and removed trees follow the shift {r3['use']} {r3['treeGone']}")
        r4 = await ev("()=>{const a=UDS.app; a.undo(); return {W:a.P.site.w, shift:a.P.shift||[0,0]}}")
        check(r4['W']==r3['W0'] and (r4['shift']==[0,0] or r4['shift']==[0,0]), f"undo returns the site {r4}")
        r5 = await ev("""()=>{const a=UDS.app, P=a.P; const n=P.roads.length, W=P.site.w; const s=P.roads.find(r=>r.name==='남측 간선도로'); const e0=s.pts[s.pts.length-1];
           a.setTool('road', s.preset); a.roadClick(e0); a.roadClick([e0[0]+3000,e0[1]]); a.finishRoad(); a.setTool('select');
           return {n:P.roads.length-n, W:P.site.w-W, toast:(document.querySelector('#toast')||{}).textContent||''}}""")
        check(r5['n']==0 and r5['W']==0 and '2km' in r5['toast'], f"site over 2 km is refused {r5}")

        # 2. 건물 회전·반전·제자리
        await ev("()=>{UDS.app.setScene('standard');}")
        await pg.wait_for_timeout(300)
        b0 = await ev("""()=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.use==='res'&&x.area>300&&!x.gable); const id=b.lotId;
           const c=U.polyCentroid(b.fp); const v=a.r2.view; v.cx=c[0]; v.cy=c[1]; v.s=3; a.setTool('select');
           a.select({type:'building', id}); a.state.tab='props'; UDS.ui.pane(); a.invalidate(7);
           return {id, A:b.area, fp:b.fp}}""")
        await pg.wait_for_timeout(300)
        b0.update(await ev("()=>({row:!!document.querySelector('#pane .plrow'), btn:[...document.querySelectorAll('#bldbar2 [data-act]')].map(x=>x.dataset.act+':'+(x.dataset.arg||'').split('|')[1])})"))
        check(b0['row'] and 'bldx:rot' in b0['btn'] and 'bldx:flipU' in b0['btn'] and 'bldclip:move' in b0['btn'] and 'bldclip:copy' in b0['btn'], f"placement row in props and toolbar on the plan {b0['btn']}")
        await pg.click(f'#bldbar2 [data-act="bldx"][data-arg="{b0["id"]}|rot|15"]'); await pg.wait_for_timeout(250)
        x1 = await ev("""(id)=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.lotId===id), lot=a.D.lots.find(l=>l.id===id); const d=U.sub(b.fp[1],b.fp[0]);
           return {xf:b.xf, rot:a.lotOv(id).bld.rot, A:b.area, inLot:b.fp.every(q=>U.pointInPoly(q,lot.poly)), ang:Math.atan2(d[1],d[0])*180/Math.PI, inp:+document.querySelector('#pane .rotin input').value, first:!!document.querySelector('#pane [data-act=bldx][data-arg$="|reset"]')}}""", b0['id'])
        check(x1['xf'] and x1['rot']==15 and x1['inLot'] and 0 < x1['A'] <= b0['A']+0.5 and x1['inp']==15 and x1['first'], f"rotate +15° keeps the building in its lot {x1}")
        await ev("(id)=>{const i=document.querySelector('#pane .rotin input'); i.value='-30'; i.dispatchEvent(new Event('change',{bubbles:true}));}", b0['id']); await pg.wait_for_timeout(250)
        x2 = await ev("(id)=>UDS.app.lotOv(id).bld.rot", b0['id'])
        check(x2==-30, f"typed angle sets the rotation {x2}")
        await pg.click(f'#bldbar2 [data-act="bldx"][data-arg="{b0["id"]}|flipU"]'); await pg.wait_for_timeout(250)
        x3 = await ev("""(id)=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.lotId===id); const o=a.lotOv(id).bld; return {fu:o.flipU, ccw:U.polyArea(b.fp)>0, pressed:document.querySelector(`#bldbar2 [data-act=bldx][data-arg="${id}|flipU"]`).getAttribute('aria-pressed')}}""", b0['id'])
        check(x3['fu'] and x3['ccw'] and x3['pressed']=='true', f"mirror keeps a valid outline {x3}")
        await pg.click(f'#pane [data-act="bldx"][data-arg="{b0["id"]}|reset"]'); await pg.wait_for_timeout(250)
        x4 = await ev("(id)=>{const a=UDS.app; const b=a.D.buildings.find(x=>x.lotId===id); return {xf:b.xf, A:b.area}}", b0['id'])
        check(not x4['xf'] and abs(x4['A']-b0['A'])<0.5, f"처음대로 restores the original placement {x4}")

        # 3. 이동 도구로 건물 끌기(마우스): 같은 획지 안 → 밀기, 다른 획지 → 옮기기, Alt → 복사
        m0 = await ev("""(id)=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.lotId===id); const c=U.polyCentroid(b.fp); const v=a.r2.view; v.cx=c[0]; v.cy=c[1]; v.s=4; a.setTool('move'); a.invalidate(1); return c;}""", b0['id'])
        await pg.wait_for_timeout(200)
        s0 = await scr(m0); s1 = await scr([m0[0]+2, m0[1]+1.5])
        await pg.mouse.move(*s0); await pg.mouse.down(); await pg.mouse.move(s0[0]+3, s0[1]+2, steps=2); await pg.mouse.move(*s1, steps=4); await pg.mouse.up(); await pg.wait_for_timeout(300)
        m1 = await ev("""(id)=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.lotId===id); const c=U.polyCentroid(b.fp); const o=a.lotOv(id); return {c, sh:o&&o.bld&&o.bld.shift, sel:a.state.sel}}""", b0['id'])
        dm = [m1['c'][0]-m0[0], m1['c'][1]-m0[1]]
        inl = await ev("(id)=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.lotId===id), lot=a.D.lots.find(l=>l.id===id); return b.fp.every(q=>U.pointInPoly(q,lot.poly));}", b0['id'])
        check(m1['sh'] and 1.0 < (dm[0]**2+dm[1]**2)**0.5 < 2.7 and inl, f"dragging a building nudges it inside its lot (slides along the setback line) {[round(x,2) for x in dm]} shift {m1['sh']}")
        tg = await ev("""(id)=>{const a=UDS.app, U=UDS.U; const lot=a.D.lots.find(l=>l.id===id);
           const t=a.D.lots.filter(l=>l.id!==id && !UDS.C.USES[l.use].open && !a.D.buildings.some(x=>x.lotId===l.id)).sort((x,y)=>U.dist(U.polyCentroid(x.poly),U.polyCentroid(lot.poly))-U.dist(U.polyCentroid(y.poly),U.polyCentroid(lot.poly)))[0]
              || a.D.lots.filter(l=>l.id!==id && !UDS.C.USES[l.use].open).sort((x,y)=>U.dist(U.polyCentroid(x.poly),U.polyCentroid(lot.poly))-U.dist(U.polyCentroid(y.poly),U.polyCentroid(lot.poly)))[0];
           const c=U.polyCentroid(a.D.buildings.find(x=>x.lotId===id).fp), w=U.polyCentroid(t.poly); const v=a.r2.view; v.cx=(c[0]+w[0])/2; v.cy=(c[1]+w[1])/2; v.s=Math.min(4, 600/Math.max(1,U.dist(c,w))); a.invalidate(1);
           return {t:t.id, c, w};}""", b0['id'])
        await pg.wait_for_timeout(200)
        s0 = await scr(tg['c']); s1 = await scr(tg['w'])
        await pg.mouse.move(*s0); await pg.mouse.down(); await pg.mouse.move(s0[0]+6, s0[1]+4, steps=2); await pg.mouse.move(*s1, steps=8); await pg.wait_for_timeout(150)
        gh = await ev("()=>{const d=UDS.app.state.bldDrag; return d?{t:d.target, copy:d.copy}:null}")
        await pg.mouse.up(); await pg.wait_for_timeout(300)
        mv = await ev("""(o)=>{const a=UDS.app; return {src:!!a.D.buildings.find(x=>x.lotId===o.s), dst:!!a.D.buildings.find(x=>x.lotId===o.t), sel:a.state.sel, toast:(document.querySelector('#toast')||{}).textContent||''}}""", {"s":b0['id'], "t":tg['t']})
        check(gh and gh['t']==tg['t'] and not gh['copy'], f"drag over another lot shows a move ghost {gh}")
        check(mv['dst'] and not mv['src'] and mv['sel'] and mv['sel']['id']==tg['t'], f"drop moves the building to that lot {mv}")
        await pg.keyboard.down('Alt')
        s2 = await scr(tg['w']); s3 = await scr(tg['c'])
        await pg.mouse.move(*s2); await pg.mouse.down(); await pg.mouse.move(s2[0]-6, s2[1]-4, steps=2); await pg.mouse.move(*s3, steps=8); await pg.mouse.up(); await pg.wait_for_timeout(300)
        await pg.keyboard.up('Alt')
        cp = await ev("""(o)=>{const a=UDS.app; const A=a.D.buildings.find(x=>x.lotId===o.s), B=a.D.buildings.find(x=>x.lotId===o.t); return {src:!!A, dst:!!B, same:!!A&&!!B&&A.floors===B.floors&&A.use===B.use}}""", {"s":b0['id'], "t":tg['t']})
        check(cp['src'] and cp['dst'] and cp['same'], f"Alt-drag copies the building back {cp}")
        # 단추로 복사(여러 곳에 붙이기)
        await ev("(id)=>{const a=UDS.app; a.setTool('select'); a.select({type:'building', id}); a.state.tab='props'; UDS.ui.pane(); a.invalidate(7);}", tg['t'])
        await pg.wait_for_timeout(300)
        await pg.click(f'#bldbar2 [data-act="bldclip"][data-arg="{tg["t"]}|copy"]'); await pg.wait_for_timeout(200)
        pc = await ev("""(id)=>{const a=UDS.app, U=UDS.U; const src=a.D.lots.find(l=>l.id===id); const L=a.D.lots.filter(l=>l.id!==id && !UDS.C.USES[l.use].open && l.blockId!==src.blockId).slice(0,2);
           const c=U.polyCentroid(L[0].poly); const v=a.r2.view; v.cx=c[0]; v.cy=c[1]; v.s=2; a.invalidate(1); return {tool:a.state.tool, hint:document.getElementById('hint').textContent, L:L.map(l=>({id:l.id, c:U.polyCentroid(l.poly)}))}}""", tg['t'])
        check(pc['tool']=='bldpaste' and '복사' in pc['hint'], f"copy button arms paste mode {pc['tool']} {pc['hint'][:30]!r}")
        await pg.wait_for_timeout(150)
        q0 = await scr(pc['L'][0]['c'])
        await pg.mouse.click(*q0); await pg.wait_for_timeout(300)
        pc2 = await ev("""(o)=>{const a=UDS.app; const A=a.D.buildings.find(x=>x.lotId===o.s), B=a.D.buildings.find(x=>x.lotId===o.t); return {tool:a.state.tool, ok:!!A&&!!B&&A.floors===B.floors, n:a.state.bldClip&&a.state.bldClip.n}}""", {"s":tg['t'], "t":pc['L'][0]['id']})
        check(pc2['ok'] and pc2['tool']=='bldpaste' and pc2['n']==1, f"click a lot pastes a copy and stays in paste mode {pc2}")
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        t2 = await ev("()=>UDS.app.state.tool")
        check(t2=='select', f"Esc leaves paste mode {t2}")

        # 4. 사람: 무릎·팔꿈치가 있는 사람, 화면에서 작은 사람은 간단히
        await ev("()=>{UDS.app.setScene('standard'); UDS.ui.setView('3d');}")
        await pg.wait_for_timeout(500)
        pp = await ev("""()=>{const a=UDS.app; a.setTraffic(true); a.setTrafficDensity(0.6,0.4); const T=a.traffic; if(!T||!T.ready) return null;
           const e=a.r3.eye(); T.fill(e,1e9); const near=[T.buf.nBox,T.buf.nCyl,T.buf.nSph]; T.fill(e,1e-9); const far=[T.buf.nBox,T.buf.nCyl,T.buf.nSph];
           T.fill(e,1e9); let bad=0; for(const k of ['box','cyl','sph']){ const A=T.buf[k], n=T.buf['n'+k[0].toUpperCase()+k.slice(1)]*16; for(let i=0;i<n;i++) if(!isFinite(A[i])) bad++; }
           const st=T.peds.find(p=>p.mode===1); const vars={skirt:T.peds.filter(p=>p.skirt).length, bag:T.peds.filter(p=>p.bag).length, long:T.peds.filter(p=>p.long).length, cap:T.peds.filter(p=>p.cap).length};
           return {peds:T.peds.length, pms:T.pms.length, near, far, bad, vars}}""")
        if pp:
            per = (pp['near'][1]-pp['far'][1])/max(1,pp['peds'])
            check(pp['peds']>50 and 7.5 <= per <= 10.5 and pp['bad']==0, f"near people get thigh·shin·arm segments ({per:.1f} more parts each), no bad numbers {pp['near']} vs {pp['far']}")
            check(all(v>0 for v in pp['vars'].values()), f"clothing and accessory variety {pp['vars']}")
        else: check(False, "traffic not ready")
        await pg.wait_for_timeout(800)
        # 5. 건물: 평지붕 난간벽과 옥상 설비, 박공지붕에는 없음
        rf = await ev("""()=>{const a=UDS.app, U=UDS.U; const S=a.r3.buildScene({exp:true, layers:{buildings:true}}); const P=S.solid.P;
           const flat=a.D.buildings.filter(b=>!b.gable&&b.st.roof!=='green').sort((x,y)=>y.area-x.area)[0];
           const at=(b,h)=>{let n=0; for(let i=0;i<P.length;i+=3){ if(Math.abs(P[i+1]-h)<0.01 && U.pointInPoly([P[i],-P[i+2]], b.fp)) n++; } return n;};
           const above=(b,h0,h1)=>{let n=0; for(let i=0;i<P.length;i+=3){ if(P[i+1]>h0 && P[i+1]<h1 && U.pointInPoly([P[i],-P[i+2]], b.fp)) n++; } return n;};
           const r={par:flat?at(flat,flat.h+0.9):0, kit:flat?above(flat,flat.h+0.95,flat.h+3.2):0, floors:flat&&flat.floors, area:flat&&Math.round(flat.area)};
           a.setScene('oldtown'); const S2=a.r3.buildScene({exp:true, layers:{buildings:true}}); const P2=S2.solid.P; const gab=a.D.buildings.find(b=>b.gable);
           let g=0; if(gab) for(let i=0;i<P2.length;i+=3){ if(Math.abs(P2[i+1]-gab.h-0.9)<0.01 && U.pointInPoly([P2[i],-P2[i+2]], gab.fp)) g++; }
           r.gpar=gab?g:-1; a.setScene('standard'); return r;}""")
        check(rf['par']>=8, f"flat roofs get a parapet ring ({rf['par']} vertices at roof+0.9 m)")
        check(rf['kit']>=8, f"rooftop penthouse/units on a large roof ({rf['kit']} vertices, {rf['floors']}F {rf['area']} m²)")
        check(rf['gpar']==0, f"gable roofs get no parapet {rf['gpar']}")
        # 3D 화면 그리기(색·선)에서 오류 없음
        await ev("()=>{const a=UDS.app; const B=a.D.buildings.slice().sort((x,y)=>y.h-x.h)[10]; const c=UDS.U.polyCentroid(B.fp); const cam=a.r3.cam; cam.tx=c[0]; cam.tz=-c[1]; cam.dist=60; cam.pitch=0.45; a.invalidate(7);}")
        await pg.wait_for_timeout(1200)
        await ev("()=>{UDS.ui.setMode('line'); UDS.app.invalidate(7);}")
        await pg.wait_for_timeout(1200)
        await ev("()=>{UDS.ui.setMode('color'); UDS.app.invalidate(7);}")
        await pg.wait_for_timeout(600)
        check(not logs, f"no errors {logs[:3]}")
        await b.close()
    print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())
