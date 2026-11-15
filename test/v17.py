"""v17: 용도지역 상한(건폐율·용적률) 생성·검토·표시, 단면 방향 뒤집기, 블록 정보·돌아가기, 법규검토, 태양궤적도 끌기,
3D·단면 방위, 음영분석 끄기, 단면 도로 고르면 평면 줌, 축척 입력, 내보내기(축척 막대·레이어), 앱 이름, 시각 막대, 나무"""
import asyncio, math, re
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

        # 16. 앱 이름
        nm = await ev("()=>({title:document.title, brand:document.querySelector('.brand')?document.querySelector('.brand').innerText:''})")
        check(nm['title']=='Urbify' and nm['brand'].startswith('Urbify'), f"app is named Urbify {nm}")
        # 8. 법규검토 탭
        tabs = await ev("()=>[...document.querySelectorAll('#tabs [data-tab]')].map(x=>x.innerText.trim())")
        check('법규검토' in tabs and not any('기준' in t for t in tabs), f"checks tab is 법규검토 {tabs}")

        # 3. 만든 건물은 용도지역 상한 안에(도시·구도심·임의생성 여러 번)
        z = await ev("""()=>{const a=UDS.app, out=[]; const scan=(nm)=>{const bs=a.D.buildings; out.push({nm, n:bs.length, over:bs.filter(b=>b.over&&(b.over.bcr||b.over.far)).length, res80:bs.filter(b=>['res','pub'].includes(b.use)&&b.bcr>0.6005).length, maxBcr:Math.max(...bs.filter(b=>b.use==='res').map(b=>b.bcr))});};
           scan('std'); a.setScene('oldtown'); scan('old'); for(let i=0;i<4;i++){a.setScene('random'); scan('rnd'+i);} a.setScene('standard'); return out;}""")
        check(all(r['over']==0 and r['res80']==0 for r in z), f"generated buildings respect zoning BCR/FAR {[(r['nm'],r['n'],r['over'],round(r['maxBcr'],3)) for r in z]}")
        # 1. 상한을 넘으면 법규검토에 오류, 건물 정보에서 빨간 표시
        o1 = await ev("""()=>{const a=UDS.app; const b=a.D.buildings.find(x=>x.use==='res'&&!x.custom&&x.floors<10); const ov=a.lotOv(b.lotId); ov.bld=Object.assign(ov.bld||{}, {floors:40}); delete ov.bld.floorsAuto; a.commit();
           const nb=a.D.buildings.find(x=>x.lotId===b.lotId); const ck=a.D.checks.filter(c=>c.level==='error'&&/용적률/.test(c.msg)&&/초과/.test(c.msg));
           a.select({type:'lot', id:b.lotId}); a.state.tab='props'; UDS.ui.pane();
           const over=[...document.querySelectorAll('#pane .stat.over')].map(x=>x.innerText.replace(/\\s+/g,' '));
           return {id:b.lotId, floors:nb.floors, far:nb.far, farMax:nb.farMax, overFar:nb.over.far, ck:ck.length, over};}""")
        check(o1['floors']==40 and o1['overFar'] and o1['ck']>=1 and any('용적률' in x for x in o1['over']), f"FAR over the zone limit is flagged in 법규검토 and red in the pane {o1}")
        sty = await ev("()=>{const e=document.querySelector('#pane .stat.over b'); return e?getComputedStyle(e).color:''}")
        check(sty and re.match(r"rgb\((1[5-9]\d|2\d\d), ?(\d{1,2}|1[0-1]\d), ?(\d{1,2}|1[0-1]\d)\)", sty) is not None, f"over-limit value is shown in red ({sty})")
        # 획지 용도 고르기에 건폐율·용적률이 함께
        opts = await ev("()=>{const s=[...document.querySelectorAll('#pane select')].find(x=>[...x.options].some(o=>/건폐율/.test(o.text))); return s?[...s.options].map(o=>o.text).slice(0,4):[]}")
        check(len(opts)>0 and any('건폐율' in t and '용적률' in t for t in opts), f"lot use choices show BCR/FAR limits {opts[:2]}")
        # 4. 태양궤적도는 입면 아래
        order = await ev("""()=>{const pane=document.querySelector('#pane'); const all=[...pane.querySelectorAll('*')]; const h=all.findIndex(e=>e.children.length===0&&e.textContent.trim()==='입면'); const sp=all.findIndex(e=>e.classList&&e.classList.contains('spbox')); return {h, sp};}""")
        check(order['h']>=0 and order['sp']>order['h'], f"sun path diagram sits below the facade settings {order}")
        # 9. 태양궤적도에서 해를 끌면 시각이 바뀐다
        await ev("()=>{const S=UDS.app.P.settings; S.hour=10; UDS.ui.spRefresh();}")
        await pg.wait_for_timeout(200)
        sun = await ev("""()=>{const box=document.querySelector('#pane .spbox'); box.scrollIntoView({block:'center'}); const svg=box.querySelector('svg'); const r=svg.getBoundingClientRect(); const vb=svg.viewBox.baseVal;
           const c=svg.querySelector('circle[r="6"]');
           const cx=+c.getAttribute('cx'), cy=+c.getAttribute('cy'); return {x:r.left+(cx-vb.x)*r.width/vb.width, y:r.top+(cy-vb.y)*r.height/vb.height, k:r.width/vb.width};}""")
        await pg.mouse.move(sun['x'], sun['y']); await pg.mouse.down()
        await pg.mouse.move(sun['x']+30*sun['k'], sun['y']-6*sun['k'], steps=6)
        await pg.mouse.move(sun['x']+70*sun['k'], sun['y']-4*sun['k'], steps=8)
        await pg.mouse.up(); await pg.wait_for_timeout(250)
        h2 = await ev("()=>UDS.app.P.settings.hour")
        check(abs(h2-10)>=0.5, f"dragging the sun on the sun path diagram changes the time (10:00 → {h2})")
        # 5·7. 블록 정보 단추와 돌아가기
        bb = await ev("()=>[...document.querySelectorAll('#pane .phead button')].map(x=>x.innerText.trim()).filter(Boolean)")
        check(any('블록 정보' in t for t in bb) and not any('가구 정보' in t for t in bb), f"pane header offers 블록 정보 {bb}")
        await pg.click("#pane .phead button[data-act='selblock']"); await pg.wait_for_timeout(250)
        blk = await ev("()=>({sel:UDS.app.state.sel, title:document.querySelector('#pane .phead b,#pane .phead h2,#pane .phead .pt')?document.querySelector('#pane .phead').innerText:'', back:!!document.querySelector('#pane [data-act=\"goback\"]')})")
        check(blk['sel']['type']=='block' and '블록' in blk['title'] and blk['back'], f"block pane opens with a back button {blk['sel']} {blk['title'][:20]!r}")
        await pg.click("#pane [data-act='goback']"); await pg.wait_for_timeout(250)
        bk = await ev("()=>UDS.app.state.sel")
        check(bk and bk['type']=='lot' and bk['id']==o1['id'], f"back returns to the building {bk}")
        # 입지 분석 → 돌아가기
        await pg.click("#pane .phead button[data-act='gotab'][data-arg='loc'], #pane .phead button:has-text('입지 분석')"); await pg.wait_for_timeout(250)
        lb = await ev("()=>!!document.querySelector('#pane .back, #side .back')")
        check(lb, "location analysis offers a back button")
        await ev("()=>{UDS.app.undo(); UDS.app.select(null); UDS.app.state.tab='props'; UDS.ui.pane();}")

        # 17. 왼쪽 음영분석: 시각 막대가 날짜 막대와 같은 너비
        await ev("()=>{const b=document.querySelector('#palette .pgrp.xg[data-grp=\"shade\"] .pgh'); if(b && b.getAttribute('aria-expanded')!=='true') b.click();}")
        await pg.wait_for_timeout(400)
        wd = await ev("""()=>{const body=document.querySelector('#palette [data-xbody="shade"]'); const t=body.querySelector('.drow.trow input[type=range]'), d=[...body.querySelectorAll('.drow input[type=range]')].find(x=>x.dataset.fmt==='date');
           const rt=t.getBoundingClientRect(), rd=d.getBoundingClientRect(); return {tw:Math.round(rt.width), dw:Math.round(rd.width), tl:Math.round(rt.left), dl:Math.round(rd.left), keys:[...body.querySelectorAll('.trow .dkeys button')].map(x=>x.innerText)};}""")
        check(abs(wd['tw']-wd['dw'])<=1 and abs(wd['tl']-wd['dl'])<=1 and len(wd['keys'])>=1, f"time slider matches the date slider {wd}")
        # 11. 음영분석을 끄면 궤적도·일조시간 등도 꺼진다
        await ev("()=>{const a=UDS.app; if(!a.state.layers.shadows) UDS.ui.run('xsw','shade'); Object.keys(a.state.ana).forEach(k=>a.state.ana[k]=true); a.rebuild3d(); a.invalidate(7); UDS.ui.xRefresh();}")
        await pg.wait_for_timeout(300)
        await pg.click("#palette .psw[data-act='xsw'][data-arg='shade']"); await pg.wait_for_timeout(300)
        an = await ev("()=>({sh:UDS.app.state.layers.shadows, ana:Object.assign({},UDS.app.state.ana)})")
        check(not an['sh'] and not any(an['ana'].values()), f"turning 음영분석 off clears the analysis overlays {an}")

        # 2. 단면: 평면의 A 표시를 누르면 반대쪽에서 본다
        await ev("""()=>{const a=UDS.app; const r=a.P.roads.find(x=>Math.abs(x.pts[0][1]-x.pts[x.pts.length-1][1])<1&&a.D.roadInfo.get(x.id).len>150)||a.P.roads[0]; a.select({type:'road', id:r.id}); a.state.secFlip=false; a.r2.fit(a.P.site,1.14); a.invalidate(7);}""")
        await pg.wait_for_timeout(500)
        mk = await ev("()=>{const a=UDS.app, r=a.r2.cv.getBoundingClientRect(); const m=a.secMarks(); return m.map(p=>{const s=a.r2.w2s(p); return [r.left+s[0], r.top+s[1]];});}")
        await pg.mouse.click(mk[0][0], mk[0][1]); await pg.wait_for_timeout(350)
        fl = await ev("()=>({flip:UDS.app.state.secFlip, sec:UDS.app.sec.flip})")
        check(fl['flip'] and fl['sec'], f"clicking the A marker flips the section {fl}")
        # 10. 단면 양 끝 방위(뒤집으면 바뀜) — SVG에 방위 레이어가 있다
        svgs = await ev("""()=>{const a=UDS.app; const one=()=>{const s=a.sec.exportSVG(); const d=new DOMParser().parseFromString(s,'image/svg+xml'); const g=d.getElementById('NORTH'); return g?[...g.querySelectorAll('text')].map(t=>({t:t.textContent, x:+(t.getAttribute('x')||0)})):[];};
           const f1=one(); a.state.secFlip=false; a.sec.draw(); const f0=one(); return {f0, f1};}""")
        def side(lst):
            if len(lst)<2: return None
            lst=sorted(lst, key=lambda q:q['x']); return (lst[0]['t'], lst[-1]['t'])
        s0, s1 = side(svgs['f0']), side(svgs['f1'])
        dirs = {'북','남','동','서','북동','북서','남동','남서'}
        check(s0 and s1 and set(s0)<=dirs and s0==(s1[1],s1[0]), f"section ends name their compass directions and swap when flipped {s0} / {s1}")
        # 3D 방위표: 동쪽을 바라보면 N은 왼쪽
        cp = await ev("""()=>{const a=UDS.app; a.r3.cam.yaw=-Math.PI/2; a.r3.draw(); const el=document.getElementById('compass3'); const r=el.getBoundingClientRect(); const n=el.querySelector('b[data-c="0"]').getBoundingClientRect(), e=el.querySelector('b[data-c="1"]').getBoundingClientRect();
           return {vis:r.width>20&&!el.hidden, nx:n.left+n.width/2-(r.left+r.width/2), ny:n.top+n.height/2-(r.top+r.height/2), ex:e.left+e.width/2-(r.left+r.width/2), ey:e.top+e.height/2-(r.top+r.height/2)}}""")
        check(cp['vis'] and cp['nx']<-10 and abs(cp['ny'])<4 and cp['ey']<-10 and abs(cp['ex'])<4, f"3D compass shows N to the left when facing east {cp}")
        await pg.click('#compass3')
        for _ in range(40):
            await pg.wait_for_timeout(150)
            yw = await ev("()=>UDS.app.r3.cam.yaw")
            if abs(yw)<0.01: break
        check(abs(yw)<0.01, f"clicking the compass turns the 3D view to face north (yaw {yw:.3f})")

        # 12. 단면에서 도로를 고르면 평면이 그 도로로 다가간다
        zr = await ev("""()=>{const a=UDS.app; a.r2.fit(a.P.site,1.14); a.invalidate(1); const cur=a.state.sel.id; const r=a.P.roads.filter(x=>x.id!==cur).sort((p,q)=>a.D.roadInfo.get(p.id).len-a.D.roadInfo.get(q.id).len)[0]; const s0=a.r2.view.s;
           const sel=document.querySelector('#sechead select[data-k="secroad"]'); sel.value=r.id; sel.dispatchEvent(new Event('change',{bubbles:true})); return {id:r.id, s0, len:a.D.roadInfo.get(r.id).len, W:a.r2.W, H:a.r2.H, tgt:a.r2.viewFor([0,0,1,1]).s};}""")
        for _ in range(30):
            await pg.wait_for_timeout(150)
            if await ev("(s0)=>UDS.app.r2.view.s>s0*1.3", zr['s0']): break
        z2 = await ev("""(o)=>{const a=UDS.app; const r=a.P.roads.find(x=>x.id===o.id); const xs=r.pts.map(p=>p[0]), ys=r.pts.map(p=>p[1]); const v=a.r2.view;
           const tl=a.r2.s2w([0,0]), br=a.r2.s2w([a.r2.W,a.r2.H]); const inside=r.pts.every(p=>p[0]>=tl[0]&&p[0]<=br[0]&&p[1]<=tl[1]&&p[1]>=br[1]);
           return {sel:a.state.sel&&a.state.sel.id, s:v.s, inside, cx:v.cx, mid:(Math.min(...xs)+Math.max(...xs))/2};}""", zr)
        check(z2['sel']==zr['id'] and z2['s']>zr['s0']*1.3 and z2['inside'] and abs(z2['cx']-z2['mid'])<2, f"picking a road in the section zooms the plan to it (s {zr['s0']:.2f} → {z2['s']:.2f}, inside {z2['inside']}) {zr}")

        # 13. 축척을 숫자로 치면 그 축척으로
        await pg.click('#sclIn'); await pg.wait_for_timeout(100)
        await pg.keyboard.type('500'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        sc = await ev("()=>({d:UDS.app.r2.scaleDenom(), v:document.getElementById('sclIn').value, m:document.getElementById('sclM').textContent, bw:document.getElementById('sclBar').getBoundingClientRect().width, s:UDS.app.r2.view.s})")
        check(sc['d']==500 and sc['v']=='500' and sc['bw']>20, f"typing 500 sets the plan to 1:500 {sc}")
        await pg.click('#sclIn'); await pg.keyboard.type('1:2,000'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        sc2 = await ev("()=>UDS.app.r2.scaleDenom()")
        check(sc2==2000, f"'1:2,000' is understood too ({sc2})")
        await pg.click('#sclIn'); await pg.keyboard.type('abc'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        sc3 = await ev("()=>({d:UDS.app.r2.scaleDenom(), v:document.getElementById('sclIn').value})")
        check(sc3['d']==2000 and sc3['v']=='2,000', f"bad input leaves the scale alone {sc3}")
        await pg.click('#sclIn'); await pg.keyboard.type('700'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        sc4 = await ev("()=>({d:UDS.app.r2.scaleDenom(), v:document.getElementById('sclIn').value})")
        check(sc4['d']==2000 and sc4['v']=='2,000', f"Esc cancels a typed scale {sc4}")

        # 14·15. 내보내기: 축척 막대와 레이어
        pl = await ev("""()=>{const a=UDS.app; a.state.layers.labels=true; const s=a.r2.exportSVG(); const d=new DOMParser().parseFromString(s,'image/svg+xml'); const err=d.querySelector('parsererror');
           const L=[...d.querySelectorAll('g[id]')].filter(g=>g.getAttribute('inkscape:groupmode')==='layer'); const ids=L.map(g=>g.id);
           const sheet=d.getElementById('SHEET'); const txt=sheet?[...sheet.querySelectorAll('text')].map(t=>t.textContent):[];
           const counts={}; L.forEach(g=>counts[g.id]=g.childElementCount);
           return {err:!!err, ids, uniq:new Set(ids).size===ids.length, txt, rects:sheet?sheet.querySelectorAll('rect').length:0, counts, nest:L.some(g=>g.parentNode.closest&&g.parentNode.closest('g[inkscape\\\\:groupmode]'))};}""")
        need = ['SITE','LOT','BLOCK','ROAD-SIDE','ROAD-CARRIAGE','ROAD-MARKING','ROAD-CURB','BUILDING','TREE','STREETLIGHT','FURNITURE','LABEL','SHEET']
        check(not pl['err'] and pl['uniq'] and all(k in pl['ids'] for k in need), f"plan SVG is split into layers {pl['ids']}")
        check(any('1:1000' in t for t in pl['txt']) and pl['rects']>=4 and any(t.endswith('m') for t in pl['txt']) and 'N' in pl['txt'], f"plan SVG has a scale bar, north arrow and scale note {pl['txt'][:6]}")
        bc = await ev("()=>UDS.app.D.buildings.length")
        check(pl['counts'].get('BUILDING',0)>=bc, f"every building is in the building layer ({pl['counts'].get('BUILDING')} ≥ {bc})")
        await ev("()=>{const a=UDS.app; const r=a.P.roads.find(x=>x.trees&&x.trees.on&&x.lights&&x.lights.on&&a.D.roadInfo.get(x.id).lay.hasCar); a.select({type:'road', id:r.id}); a.invalidate(7);}")
        await pg.wait_for_timeout(300)
        se = await ev("""()=>{const a=UDS.app; const s=a.sec.exportSVG(); const d=new DOMParser().parseFromString(s,'image/svg+xml'); const err=d.querySelector('parsererror');
           const L=[...d.querySelectorAll('g[id]')].filter(g=>g.getAttribute('inkscape:groupmode')==='layer'); const ids=L.map(g=>g.id);
           const sc=d.getElementById('SCALE'); const svg=d.documentElement;
           return {err:!!err, ids, uniq:new Set(ids).size===ids.length, txt:sc?[...sc.querySelectorAll('text')].map(t=>t.textContent):[], h:svg.getAttribute('height'), vb:svg.getAttribute('viewBox')};}""")
        need2 = ['BASE','SIDE-GROUND','PAVEMENT','TREE','LIGHT','PEOPLE','VEHICLE','UTILITY','LABEL','DIM','NORTH','SCALE']
        check(not se['err'] and se['uniq'] and all(k in se['ids'] for k in need2), f"section SVG is split into layers {se['ids']}")
        check(any('1:100' in t for t in se['txt']) and any(t.endswith('m') for t in se['txt']) and se['vb'].endswith(' 700'), f"section SVG has a scale bar strip {se['txt'][:7]} {se['vb']}")
        pn = await ev("()=>{const a=UDS.app; const c=a.sec.exportCanvas(); return {h:c.height, ch:a.sec.cv.height, w:c.width, cw:a.sec.cv.width, foot:a.sec.FOOT, dpr:a.sec.dpr};}")
        check(pn['w']==pn['cw'] and pn['h']==pn['ch']+round(pn['foot']*pn['dpr']), f"section PNG gets a scale bar strip {pn}")
        ob = await ev("""async ()=>{const a=UDS.app; const o={fmt:'obj', ground:true, bld:true, tree:true, furn:true, ctx:false, util:false}; const out=UDS.Export3D.build(a,'obj',o,'t'); const txt=await out.blob.text();
           const gs=[...new Set((txt.match(/^g .+$/gm)||[]))]; return gs;}""")
        check('g Buildings' in ob and 'g Trees' in ob and 'g Roads' in ob, f"OBJ export groups objects by layer {ob}")

        # 6. 나무: 잎 뭉치가 잘고 틈이 많다
        tm = await ev("""()=>{const F=UDS.Fig, C=UDS.C; const M=F.treeModel(C.TREES.zelkova,1,1,99,60); const L=M.loops.slice().sort((a,b)=>b.length-a.length);
           const area=(lp)=>{let s=0; for(let i=0;i<lp.length;i++){const p=lp[i], q=lp[(i+1)%lp.length]; s+=p[0]*q[1]-q[0]*p[1];} return Math.abs(s)/2;};
           const per=(lp)=>{let s=0; for(let i=0;i<lp.length;i++){const p=lp[i], q=lp[(i+1)%lp.length]; s+=Math.hypot(q[0]-p[0],q[1]-p[1]);} return s;};
           const main=L[0], A=area(main), P=per(main); return {loops:M.loops.length, mainPts:main.length, A:+A.toFixed(1), rough:+(P/(2*Math.sqrt(Math.PI*A))).toFixed(2), shade:'tufts' in M};}""")
        check(tm['loops']>=25 and tm['mainPts']>=250 and tm['rough']>=1.6 and not tm['shade'], f"tree crowns are flat drafting-style cut-outs with leafy edges and gaps {tm}")

        check(not logs, f"no errors {logs[:3]}")
        await b.close()
    print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())
