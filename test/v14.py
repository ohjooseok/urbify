"""v14: PM 막대·도구 단추·제목, 메뉴 폭, 대상지 모서리 도로, 위도 기본값, 날짜 막대, 기준점검 더블클릭, 건물 태양궤적도,
회전교차로(빈터·획지 안·소로), face-me 나무, 3D 모델 내보내기, 풍선 도움말, 카피라이트"""
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
        # 1~6, 14: 메뉴 모양
        u = await ev("""()=>{const q=(s)=>document.querySelector(s); const vis=[...document.querySelectorAll('.ptools .tl')].filter(b=>b.getBoundingClientRect().width>0); const tl=vis.map(b=>Math.round(b.getBoundingClientRect().width)); const xs=vis.map(b=>b.getBoundingClientRect().left); const ub=q('#btnUndo').getBoundingClientRect(), rb=q('#btnRedo').getBoundingClientRect();
          const gaps=xs.slice(1).map((x,i)=>Math.round(x-xs[i]));
          return {tl, gaps, ur:[Math.round(ub.width), Math.round(rb.width), Math.round(ub.top)], brand:q('.pbrand b').innerText, title:document.title, blank:[...document.querySelectorAll('[data-scene="blank"]')].map(b=>b.innerText).join('|'), pnote:!!q('#palette .pnote'), pal:Math.round(q('#palette').getBoundingClientRect().width), side:Math.round(q('.side').getBoundingClientRect().width)}}""")
        check(len(u['tl'])==5 and len(set(u['tl']))==1 and u['ur'][0]==u['ur'][1]==0, f"undo/redo back in the tool row before select·move·erase, all same size; none in the top bar {u['tl']} {u['ur']}")
        check(max(u['gaps'][2:])-min(u['gaps'][2:])<=1 and u['gaps'][0]>0, f"tool buttons evenly spaced {u['gaps']}")
        check(u['brand']=='Urbify' and '\n' not in u['brand'] and u['title']=='Urbify', f"title one line {u['brand']!r} / {u['title']!r}")
        check('직접 그림' not in u['blank'] and not u['pnote'], f"blank note and bottom note removed {u['blank']!r}")
        check(u['pal']>=250 and u['side']<=320, f"left menu wider, right narrower {u['pal']} / {u['side']}")
        await pg.click('.pgrp[data-grp="obj"] .pgh'); await pg.wait_for_timeout(200)
        ob = await ev("""()=>{const b=document.querySelector('[data-xbody="obj"]'); return {n:b.querySelectorAll('input[type=range]').length, pm:+b.querySelector('input[data-tset="pm"]').value, ped:+b.querySelector('input[data-tset="ped"]').value, sw:!!b.querySelector('.psw'), note:!!b.querySelector('.pon'), txt:b.innerText}}""")
        check(ob['n']==3 and ob['pm']==ob['ped']==0.4 and not ob['sw'] and not ob['note'], f"PM is a slider with the same default {ob}")
        # 8, 9: 모서리 도로·위도
        cn = await ev("""()=>{const a=UDS.app, D=a.D, W=a.P.site.w, H=a.P.site.h; const deg=(p)=>{const n=D.nodes.slice().sort((x,y)=>Math.hypot(x.p[0]-p[0],x.p[1]-p[1])-Math.hypot(y.p[0]-p[0],y.p[1]-p[1]))[0]; return [n.deg, Math.round(Math.hypot(n.p[0]-p[0],n.p[1]-p[1]))];};
          return {c:[[0,0],[W,0],[W,H],[0,H]].map(deg), lat:a.P.settings.lat}}""")
        check(all(d[0]==4 and d[1]==0 for d in cn['c']), f"site corners are full 4-way junctions {cn['c']}")
        check(cn['lat']==37.5, f"city latitude Seoul {cn['lat']}")
        la = await ev("""()=>{const a=UDS.app; a.setScene('oldtown'); const o=a.P.settings.lat; a.setScene('standard'); return [o, a.P.settings.lat]}""")
        check(la==[36.6,37.5], f"oldtown Chungcheong, city Seoul {la}")
        # 10: 날짜 막대
        await pg.click('.pgrp[data-grp="shade"] .pgh'); await pg.wait_for_timeout(250)
        d0 = await ev("""()=>{const r=document.querySelector('[data-xbody="shade"] .drow:not(.trow)'); return {has:!!r, keys:[...r.querySelectorAll('[data-act=setday]')].map(b=>b.textContent), out:r.querySelector('output').textContent, ticks:r.querySelectorAll('.dmk i').length, doy:UDS.app.P.settings.doy, sel:!!document.querySelector('[data-xbody="shade"] select[data-k="계절"]')}}""")
        check(d0['has'] and d0['keys']==['춘분','하지','추분','동지'] and d0['ticks']==11 and d0['doy']==356 and '동지' in d0['out'] and not d0['sel'], f"date slider with solstice/equinox marks {d0}")
        await pg.click('[data-xbody="shade"] [data-act="setday"][data-arg="172"]'); await pg.wait_for_timeout(300)
        d1 = await ev("""()=>{const S=UDS.app.P.settings; return {doy:S.doy, decl:UDS.declDeg(S), lbl:(()=>{const q=()=>document.querySelector('.pgrp[data-grp="shade"] .pgv').textContent; const off=q(); UDS.ui.run('shadow','on'); const on=q(); UDS.ui.run('shadow','off'); return off===''?on:'shown-while-off:'+off;})(), out:document.querySelector('[data-xbody="shade"] .drow:not(.trow) output').textContent}}""")
        check(d1['doy']==172 and abs(d1['decl']-23.44)<1e-9 and d1['lbl'].startswith('하지') and '6월 21일' in d1['out'], f"summer solstice button {d1}")
        d2 = await ev("""()=>{const i=document.querySelector('[data-xbody="shade"] .drow:not(.trow) input'); i.value=264; i.dispatchEvent(new Event('input',{bubbles:true})); const a=i.value; i.value=135; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); return {snap:+a, may:UDS.app.P.settings.doy, decl:UDS.declDeg(UDS.app.P.settings), out:document.querySelector('[data-xbody="shade"] .drow:not(.trow) output').textContent}}""")
        check(d2['snap']==266 and d2['may']==135 and 18 < d2['decl'] < 20 and '5월 15일' in d2['out'], f"date drag snaps to 추분 and reads other days {d2}")
        old = await ev("""()=>{const a=UDS.app; const P=JSON.parse(JSON.stringify(a.exportProject())); delete P.settings.doy; P.settings.season='summer'; a.load(P); return [a.P.settings.doy, UDS.dayOf({season:'equinox'})]}""")
        check(old==[172,80], f"old files: season read as a day {old}")
        await ev("()=>{const a=UDS.app; a.P.settings.doy=356; a.changed();}")
        # 12: 건물 태양궤적도
        await ev("""()=>{const a=UDS.app; const b=a.D.buildings.slice().sort((x,y)=>y.h-x.h)[40]; a.select({type:'building', id:b.lotId}); a.state.tab='props'; UDS.ui.pane();}""")
        await pg.wait_for_timeout(300)
        sp = await ev("""()=>{const box=document.querySelector('#pane .spbox'); return {svg:!!(box&&box.querySelector('svg.stereo')), paths:box?box.querySelectorAll('svg path').length:0, txt:box?box.innerText:'', faces:[...document.querySelectorAll('#pane [data-act=spface]')].map(b=>b.textContent)}}""")
        check(sp['svg'] and sp['paths']>10 and '해 드는 시간' in sp['txt'] and sp['faces']==['남','동','서','북','옥상'], f"stereographic sun path in building props {sp['paths']} {sp['faces']}")
        await pg.click('#pane [data-act="spface"][data-arg="R"]'); await pg.wait_for_timeout(300)
        sr = await ev("""()=>{const a=UDS.app, t=a.state.sel; const s1=UDS.Ana.bldSky(a,t.id,'R'), s2=UDS.Ana.bldSky(a,t.id,'N'); const S=a.P.settings; const r1=UDS.Ana.pointSun(s1,S.lat,356), r2=UDS.Ana.pointSun(UDS.Ana.bldSky(a,t.id,'N'),S.lat,356); return {face:a.state.spFace, roof:r1, north:r2, own:Math.max(...s2.own)}}""")
        check(sr['face']=='R' and sr['roof']['all'] > sr['north']['all'] and sr['own']==90, f"roof gets more winter sun than the north face {sr}")
        # 11: 기준 점검 더블클릭
        await ev("()=>{const a=UDS.app; const r=a.P.roads.find(x=>x.segs.some(g=>g.type==='sidewalk')); r.segs.find(g=>g.type==='sidewalk').w=1.0; a.changed(); a.select(null); a.state.tab='checks'; UDS.ui.pane(); const v=a.r2.view; v.s=0.4; v.cx=10; v.cy=10; a.invalidate(1);}")
        await pg.wait_for_timeout(200)
        has = await ev("()=>!!document.querySelector('#pane [data-act=check]')")
        if has:
            v0 = await ev("()=>({...UDS.app.r2.view})")
            await pg.dblclick('#pane [data-act="check"]'); await pg.wait_for_timeout(900)
            v1 = await ev("()=>({...UDS.app.r2.view})")
            check(v1['s'] > v0['s']*1.5, f"double-click on a check zooms in {round(v0['s'],2)} → {round(v1['s'],2)}")
        else: check(False, "no check items")
        # 7: 회전교차로를 빈터(획지 안)와 보행로에
        rb = await ev("""()=>{const a=UDS.app; a.setScene('standard'); const b=a.D.buildings.find(x=>x.area>900); const lot=a.D.lots.find(l=>l.id===b.lotId); const c=UDS.U.polyCentroid(b.fp); const n0=a.D.rabs.length, nb=a.D.buildings.length;
           a.setTool('rabout'); a.raboutAt(c, null); a.setTool('select'); const rb=a.D.rabs.find(r=>!r.arms);
           const still=a.D.buildings.filter(x=>x.lotId===b.lotId).map(x=>Math.min(...x.fp.map(p=>Math.hypot(p[0]-rb.c[0],p[1]-rb.c[1]))));
           const trees=a.D.trees.filter(t=>t.kind!=='rab'&&Math.hypot(t.x-rb.c[0],t.y-rb.c[1])<rb.R2).length;
           return {n:a.D.rabs.length-n0, arms:rb&&rb.arms, R2:rb&&rb.R2, still, trees, sel:a.state.sel&&a.state.sel.type}}""")
        check(rb['n']==1 and rb['arms']==0 and rb['sel']=='rab', f"standalone roundabout inside a lot {rb}")
        check(all(d > rb['R2'] for d in rb['still']) and rb['trees']==0, f"building and trees keep clear of it {rb['still']} R2={rb['R2']}")
        cn2 = await ev("""()=>{const a=UDS.app, rb=a.D.rabs.find(r=>!r.arms); const road=a.P.roads.slice().sort((x,y)=>{const d=(r)=>Math.min(...r.pts.map(p=>Math.hypot(p[0]-rb.c[0],p[1]-rb.c[1])));return d(x)-d(y);})[0];
           const q=road.pts.map(p=>[p,Math.hypot(p[0]-rb.c[0],p[1]-rb.c[1])]); let best=null,bd=1e9; for(let i=0;i+1<road.pts.length;i++){const r=UDS.U.distPointSeg(rb.c,road.pts[i],road.pts[i+1]); if(r.d<bd){bd=r.d;best=r.q;}}
           const id=rb.id; a.setTool('road','so1'); a.roadClick(a.snapPoint(rb.c).p); a.roadClick([Math.round(best[0]),Math.round(best[1])]); a.finishRoad(); a.setTool('select');
           const r2=a.D.rabs.find(r=>r.id===id); return {arms:r2&&r2.arms, entries:r2&&r2.entries}}""")
        check(cn2['arms']>=1 and cn2['entries']>=1, f"drawing a road into it connects {cn2}")
        # 13: face-me 나무
        await ev("()=>{UDS.ui.setView('split'); UDS.app.setScene('standard');}")
        await pg.wait_for_timeout(700)
        tb = await ev("""()=>{const a=UDS.app, r3=a.r3; r3.preset('aerial'); r3.draw(); const m=r3.meshes; return {bb:m.bb&&m.bb.count, leaf:m.leaf&&m.leaf.count, sh:m.treeSh&&m.treeSh.count, atlas:!!(r3.atlas&&r3.atlas.tex), trees:a.D.trees.length}}""")
        check(tb['atlas'] and tb['bb']==tb['trees']*12 and tb['leaf']==0 and tb['sh']>0, f"face-me billboards replace translucent crowns {tb}")
        pk = await ev("""()=>{const a=UDS.app, r3=a.r3; const t=a.D.trees.find(x=>x.kind==='street'); const c=r3.cam; c.tx=t.x; c.tz=-t.y; c.ty=3; c.dist=30; c.pitch=0.25; r3.draw(); const {VP}=r3.matrices(); const q=[t.x, 4.5, -t.y, 1]; const M=VP; const x=M[0]*q[0]+M[4]*q[1]+M[8]*q[2]+M[12], y=M[1]*q[0]+M[5]*q[1]+M[9]*q[2]+M[13], w=M[3]*q[0]+M[7]*q[1]+M[11]*q[2]+M[15]; const sx=(x/w*0.5+0.5)*r3.cssW, sy=(0.5-y/w*0.5)*r3.cssH; const hs=[]; for(let d=-30;d<=30;d+=10){ const h=r3.pickAt(sx,sy+d); hs.push(h&&h.type); } return {hs, key:t.key}}""")
        check(pk['hs'].count('tree') >= 3, f"3D pick hits a billboard tree {pk}")
        # 15: 3D 모델 내보내기
        ex = await ev("""()=>{const a=UDS.app, X=UDS.Export3D, o={ground:true,bld:true,tree:true,furn:true,ctx:false,util:false}; const out={};
          ['glb','dae','obj'].forEach(f=>{const r=X.build(a,f,o,'t'); out[f]={n:r&&r.ntri, size:r&&r.blob.size, ext:r&&r.ext};});
          const only=X.build(a,'glb',{bld:true},'t'); out.only=only&&only.ntri; const none=X.build(a,'glb',{},'t'); out.none=none; return out}""")
        check(ex['glb']['n']>20000 and ex['glb']['ext']=='glb' and ex['dae']['ext']=='dae' and ex['obj']['ext']=='zip' and 0 < ex['only'] < ex['glb']['n'] and ex['none'] is None, f"3D model export {ex}")
        await pg.click('.top .mbar .mb[data-arg="project"]'); await pg.wait_for_timeout(200)
        await pg.click('[data-act="exportmodel"]'); await pg.wait_for_timeout(300)
        dl = await ev("()=>({fmts:[...document.querySelectorAll('#dialog input[name=mfmt]')].map(i=>i.value), opts:[...document.querySelectorAll('#dialog [data-mopt]')].map(i=>i.dataset.mopt+':'+i.checked)})")
        check(dl['fmts']==['glb','dae','obj'] and 'util:false' in dl['opts'] and 'bld:true' in dl['opts'], f"export dialog {dl}")
        await ev("()=>UDS.ui.closeDialog()")
        # 15: 풍선 도움말, 13: 카피라이트
        await ev("()=>{const a=UDS.app; const b=a.D.buildings[3]; a.select({type:'building', id:b.lotId}); a.state.tab='props'; UDS.ui.pane();}")
        tp = await ev("()=>({tp:document.querySelectorAll('#pane .lb.tp').length, note:document.querySelectorAll('#pane .note').length, lead:[...document.querySelectorAll('#pane .lead')].map(p=>p.innerText.length)})")
        check(tp['tp']>=4 and tp['note']==0, f"field notes moved into tooltips {tp}")
        await pg.hover('#pane .lb.tp'); await pg.wait_for_timeout(900)
        ht = await ev("()=>{const t=document.getElementById('htip'); return t && !t.hidden ? t.textContent : ''}")
        check(len(ht) > 3, f"tooltip shows on hover {ht!r}")
        await ev("()=>UDS.ui.closePop&&UDS.ui.closePop()")
        await pg.keyboard.press('F1'); await pg.wait_for_timeout(300)
        cp = await ev("()=>{const d=document.getElementById('dialog'); return d? d.innerText:''}")
        check('Urban Planning & Informatics Lab, School of Smart Cities, Korea University (Prof. Jooseok Oh)' in cp, "English copyright in help")
        await pg.screenshot(path=OUTD + "/v14_a.png")
        print("errors:", logs or "none")
        await b.close()
    print("RESULT", "OK" if ok and not logs else "FAIL")
asyncio.run(main())
