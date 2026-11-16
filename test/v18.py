"""v18: 메뉴 묶음 제목(Draw · View & Visibility), 용도 이름표가 획지 용도를 따름, 평면 글자 끄기, 구도심 맞벽·재건축 맞벽 불가,
신도시 용적률 최대(건폐율 최대·정북 일조), 단지 안 길(단지내도로·오솔길: 가구를 나누지 않음, 모양, 진출입로, 회전교차로, 건물 비킴),
수공간(원형·둥근 사각·자유형·하천과 다리), 저장·되돌리기, 내보내기"""
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

        # 1. 왼쪽 메뉴: 묶음 이름과 제목
        pal = await ev("()=>({secs:[...document.querySelectorAll('#palette .psec')].map(x=>x.textContent.trim()), grp:[...document.querySelectorAll('#palette .pgrp:not(.xg) .pgh .lg')].map(x=>x.textContent)})")
        check(pal['secs']==['계획','보기·분석'] and pal['grp'][:3]==['대상지','도로','건물'], f"palette section titles and group names {pal}")
        order = await ev("""()=>{const s=[...document.querySelectorAll('#palette .pscroll > *')].map(x=>x.classList.contains('psec')?'T:'+x.textContent.trim():x.classList.contains('pview')?'VIEW':x.classList.contains('xg')?'X:'+x.dataset.grp:x.dataset.grp||x.className); return s;}""")
        check(order[0]=='T:계획' and order.index('T:보기·분석') < order.index('X:shade') < order.index('X:lyr') < order.index('VIEW') and order[-1]=='VIEW', f"계획 above 대상지…조경; 보기·분석 above 음영분석…레이어, view icons at the bottom (hidden on wide screens: top bar) {order}")
        cs = "(sel)=>getComputedStyle(document.querySelector(sel)).backgroundColor"
        await ev("()=>UDS.app.setTool('select')"); await pg.wait_for_timeout(300)
        st = await ev(f"""()=>{{const cs={cs}; return {{sOn:cs('#palette [data-pal="tool:select"] .picto'), mOff:cs('#palette [data-pal="tool:move"] .picto'), fs:parseFloat(getComputedStyle(document.querySelector('#palette .psec')).fontSize)}};}}""")
        await pg.mouse.move(700, 450); await ev("()=>UDS.app.setTool('erase')"); await pg.wait_for_timeout(600)
        st.update(await ev(f"""()=>{{const cs={cs}; return {{eOn:cs('#palette [data-pal="tool:erase"] .picto'), sOff:cs('#palette [data-pal="tool:select"] .picto')}};}}"""))
        await ev("()=>UDS.app.setTool('select')")
        check(st['sOn']==st['eOn'] and st['mOff']==st['sOff'] and st['sOn']!=st['sOff'], f"tool circles are gray until active, then teal {st}")
        check(st['fs']>=14, f"section titles are larger ({st['fs']}px)")

        # 2. 신도시: 용적률 최대 · 건폐율 상한 이내 · 정북 일조 지킴
        s = await ev("""()=>{const a=UDS.app; a.setScene('standard'); const bs=a.D.buildings;
          const res=bs.filter(b=>b.use==='res'&&b.cfg.style==='res_multi'), com=bs.filter(b=>b.use==='com');
          return {fit:bs.filter(b=>b.fitFar).length, n:bs.length, resFar:res.map(b=>b.far), resBcr:res.map(b=>b.bcr), comFar:com.map(b=>b.far), comBcr:com.map(b=>b.bcr), over:bs.filter(b=>b.over.bcr||b.over.far).length,
            sun:a.D.checks.filter(c=>/정북/.test(c.msg)).length, comF:com.map(b=>b.floors)};}""")
        check(s['fit']==s['n'] and s['over']==0, f"new-town buildings are FAR-fitted and within zoning ({s['fit']}/{s['n']}, over {s['over']})")
        check(min(s['comFar'])>7.9 and max(s['comBcr'])<=0.6005, f"commercial lots reach ~800% FAR with BCR <= 60% (far {min(s['comFar']):.3f}..{max(s['comFar']):.3f}, floors {sorted(set(s['comF']))})")
        check(max(s['resBcr'])<=0.6005 and min(s['resFar'])>1.5, f"res lots: BCR <= 60%, FAR as high as the rules allow (far {min(s['resFar']):.2f}..{max(s['resFar']):.2f})")
        check(s['sun']==0, f"no 정북방향 일조 warnings in the new town ({s['sun']})")
        r = await ev("""()=>{const a=UDS.app, M=UDS.Model, Dv=UDS.Derive, out=[]; for (const sd of [3,8,21]) { const D=Dv.derive(M.sceneRandom(sd,'new')); out.push([D.buildings.filter(b=>b.fitFar).length, D.buildings.length, D.buildings.filter(b=>b.over.bcr||b.over.far).length, D.checks.filter(c=>/정북/.test(c.msg)).length]); } return out;}""")
        check(all(x[0]==x[1] and x[2]==0 and x[3]==0 for x in r), f"random new towns: all fitted, within zoning, no 정북 warnings {r}")
        pane = await ev("""()=>{const a=UDS.app; const b=a.D.buildings.find(x=>x.use==='res'); a.select({type:'building', id:b.lotId}); a.state.tab='props'; UDS.ui.pane(); return document.querySelector('#pane').innerText;}""")
        check('용적률 최대로 짓기' in pane, "building pane explains the FAR-max fit")
        bp = await ev("""()=>{const a=UDS.app; a.select({type:'block', id:'b_st4'}); UDS.ui.pane(); const t=document.querySelector('#pane').innerText; const has=!!document.querySelector('#pane input[data-k="용적률 최대로"]'); return {t:t.includes('용적률 최대로'), has};}""")
        check(bp['t'] and bp['has'], f"block pane has the FAR-max toggle {bp}")

        # 3. 용도 이름표: 공원 획지를 상업으로 바꾸면 이름도 바뀜, 평면 글자 끄기
        lb = await ev("""()=>{const a=UDS.app; const cnt=(t)=>(a.r2.exportSVG().match(new RegExp('>'+t+'<','g'))||[]).length; const p0=cnt('공원'), c0=cnt('상업');
          const l=a.D.lots.find(x=>x.blockId==='b_st5'); const ov=a.lotOv(l.id); ov.use='com'; a.commit();
          return {p0, p1:cnt('공원'), c0, c1:cnt('상업')};}""")
        check(lb['p1']==lb['p0']-1 and lb['c1']==lb['c0']+1, f"use label follows the lot's use (park→commercial) {lb}")
        await ev("()=>{UDS.app.undo();}")
        tb = await ev("""()=>{const b=document.querySelector('#v2d button[data-act="labels"]'); const s0=UDS.app.state.layers.labels; b.click(); const s1=UDS.app.state.layers.labels; const svg=UDS.app.r2.exportSVG(); const pressed=b.getAttribute('aria-pressed'); b.click(); return {s0, s1, pressed, txt:/>주거</.test(svg), s2:UDS.app.state.layers.labels};}""")
        check(tb['s0'] and not tb['s1'] and tb['pressed']=='false' and not tb['txt'] and tb['s2'], f"Top view text toggle turns names off and on {tb}")

        # 4. 구도심: 맞벽 건축, 지우고 다시 지으면 맞벽 불가
        o = await ev("""()=>{const a=UDS.app; a.setScene('oldtown'); const bs=a.D.buildings; const resWall=bs.filter(b=>b.use==='res'&&b.side===0).length;
          const tgt=bs.find(b=>b.use==='res'&&b.side===0); const lot=a.D.lots.find(l=>l.id===tgt.lotId);
          a.eraseAt({type:'building', id:lot.id}); const gone=!a.D.buildings.find(b=>b.lotId===lot.id);
          a.state.buildUse='res'; a.state.buildOpt.scope='lot'; a.buildAt(null, {type:'lot', id:lot.id}); const nb=a.D.buildings.find(b=>b.lotId===lot.id);
          return {resWall, total:bs.length, wall:bs.filter(b=>b.side===0).length, gone, side:nb?nb.side:null, noParty:nb?!!nb.cfg.noParty:null};}""")
        check(o['resWall']>=8 and o['wall']>o['total']*0.4, f"old town starts with party-wall (맞벽) buildings incl. housing {o}")
        check(o['gone'] and o['side'] is not None and o['side']>=1.0 and o['noParty'], f"rebuilt building after erasing keeps >=1m from neighbours (no party wall) {o}")
        f2 = await ev("""()=>{const a=UDS.app; const blk=a.D.blocks.find(b=>a.D.buildings.some(x=>x.blockId===b.id&&x.side===0&&x.use==='mixed')); a.fillBlock(blk.id,'mixed'); a.commit(); const bs=a.D.buildings.filter(x=>x.blockId===blk.id); return {n:bs.length, minSide:Math.min(...bs.map(x=>x.side)), fit:bs.every(x=>x.fitFar)};}""")
        check(f2['n']>0 and f2['minSide']>=1.0 and f2['fit'], f"fill block rebuilds without party walls and fits FAR {f2}")
        rw = await ev("""()=>{const D=UDS.Derive.derive(UDS.Model.sceneRandom(5,'old')); return D.buildings.filter(b=>b.use==='res'&&b.side===0).length;}""")
        check(rw>0, f"random old town also has party-wall housing ({rw})")

        # 5. 단지 안 길: 도구로 그리기(모서리 둥글게), 가구를 나누지 않음, 진출입로, 건물 비킴
        await ev("()=>{UDS.app.setScene('standard');}")
        e = await ev("""()=>{const a=UDS.app, D0=a.D; const nb=D0.blocks.length;
          a.setTool('road','estate4'); [[40,75],[40,120],[80,120]].forEach(p=>a.roadClick(p)); a.finishRoad();
          const r=a.P.roads[a.P.roads.length-1]; const D=a.D; const hw=Dv=null;
          const segs=[]; for(let i=0;i+1<r.pts.length;i++) segs.push([r.pts[i], r.pts[i+1]]);
          let minD=Infinity; D.buildings.filter(b=>b.blockId==='b_st4').forEach(b=>b.fp.forEach(p=>segs.forEach(([s0,s1])=>{const q=UDS.U.distPointSeg(p,s0,s1); minD=Math.min(minD,q.d);})));
          return {nb, nb2:D.blocks.length, inner:!!r.inner, shape:r.shape, ctrl:r.ctrl.length, pts:r.pts.length, minD, fil:D.fillets.filter(f=>f.inner).length, dead:D.deadEnds.length, pane:document.querySelector('#pane .phead b').textContent, cls:D.roadInfo.get(r.id).cls};}""")
        check(e['inner'] and e['nb']==e['nb2'] and e['shape']=='round' and e['pts']>e['ctrl'], f"estate road drawn with rounded corner, blocks not split {e}")
        check(e['minD']>=2.0+1.0-0.05, f"buildings keep W/2+1m from the estate road (min {e['minD']:.2f}m)")
        check(e['fil']>=2 and e['dead']==0 and e['cls']=='단지내도로', f"driveway junction has curb returns; dead-end not flagged; class shown as 단지내도로 {e}")
        sh = await ev("""()=>{const a=UDS.app; const r=a.P.roads[a.P.roads.length-1]; a.select({type:'road', id:r.id}); a.state.tab='props'; UDS.ui.pane();
          const n0=r.pts.length; document.querySelector('#pane [data-act="roadshape"][data-arg="curve"]').click(); const r2=a.road(r.id);
          return {shape:r2.shape, n0, n1:r2.pts.length, end0:r2.pts[0], ctrl0:r2.ctrl[0], btns:[...document.querySelectorAll('#pane [data-act="roadshape"]')].map(x=>x.textContent)};}""")
        check(sh['shape']=='curve' and sh['n1']!=sh['n0'] and sh['end0']==sh['ctrl0'], f"shape switch to curve (Bezier) keeps end points {sh}")
        # 이동 도구로 찍은 점 끌기
        vd = await ev("""()=>{const a=UDS.app; const r=a.P.roads[a.P.roads.length-1]; a.setTool('move'); a.select({type:'road', id:r.id}); a.state.view='2d'; document.getElementById('app').dataset.view='2d'; window.dispatchEvent(new Event('resize'));
          const v=a.r2.view; v.cx=60; v.cy=110; v.s=4; a.invalidate(7); const s=a.r2.w2s(r.ctrl[1]); const R=a.r2.cv.getBoundingClientRect(); return {x:R.left+s[0], y:R.top+s[1], c1:r.ctrl[1].slice(), pts0:JSON.stringify(r.pts)};}""")
        await pg.mouse.move(vd['x'], vd['y']); await pg.mouse.down(); await pg.mouse.move(vd['x']+30, vd['y']+12, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(300)
        vd2 = await ev("""()=>{const a=UDS.app; const r=a.P.roads[a.P.roads.length-1]; return {c1:r.ctrl[1], same:JSON.stringify(r.pts)};}""")
        check(vd2['c1']!=vd['c1'] and vd2['same']!=vd['pts0'], f"dragging a control point reshapes the curve {vd['c1']} → {vd2['c1']}")
        # 오솔길(곡선) · 회전교차로
        t = await ev("""()=>{const a=UDS.app, M=UDS.Model; a.setTool('select');
          const S=a.P.blocks.find(b=>b.id==='b_st5'); S.use='res'; S.lotsAlong=2; S.lotRows=2; S.bld={fit:'far'}; a.commit();
          a.P.roads.push(M.makeRoad('estate4', [[157.5,75],[157.5,225]], {shape:'line'})); a.P.roads.push(M.makeRoad('estate4', [[105,150],[210,150]], {shape:'line'})); a.commit();
          a.setTool('rabout'); a.raboutAt([157.5,150], null); a.setTool('select'); const rb=a.D.rabs.find(x=>UDS.U.dist(x.c,[157.5,150])<1);
          a.setTool('road','trail2'); [[20,160],[45,175],[70,165],[95,185]].forEach(p=>a.roadClick(p)); a.finishRoad(); const tr=a.P.roads[a.P.roads.length-1];
          return {rab:rb?[rb.inner, Math.round(rb.d)]:null, trail:[tr.inner, tr.shape, tr.ctrl.length, tr.pts.length], blocks:a.D.blocks.length, fn:tr.fn};}""")
        check(t['rab'] and t['rab'][0] and t['rab'][1]==16, f"mini roundabout on estate-road crossing (16m) {t['rab']}")
        check(t['trail'][0] and t['trail'][1]=='curve' and t['trail'][3]>t['trail'][2]*3 and t['fn']=='trail', f"trail drawn as a smooth curve through clicked points {t['trail']}")
        # 단면: 단지 안 길도 양쪽 건물
        sc = await ev("""()=>{const a=UDS.app; const r=a.P.roads.find(x=>x.inner&&x.preset==='estate4'); const c=UDS.Derive.sectionContext(a.P,a.D,r.id,20); return [!!(c.sides.L||c.sides.R), !!((c.sides.L||{}).building||(c.sides.R||{}).building)];}""")
        check(sc[0] and sc[1], f"section of an estate road finds buildings beside it {sc}")
        tf = await ev("""()=>{const a=UDS.app; a.setTraffic(true); const t=a.traffic; const n=[t.cars.length, t.peds.length]; a.setTraffic(false); return n;}""")
        check(tf[1]>0, f"traffic runs with inner roads {tf}")

        # 6. 수공간: 원형·둥근 사각(누르기), 자유형·하천(점 찍기), 다리, 건물·나무 비킴
        # 수공간: 교목처럼 [수공간]을 누르고 종류 목록에서 고른다
        await pg.click('#palette .pgrp[data-grp="land"] .pgh'); await pg.wait_for_timeout(250)
        await pg.click('#palette [data-pal="tool:water"]'); await pg.wait_for_timeout(150)
        await pg.select_option('#palette select.palwk', 'river'); await pg.wait_for_timeout(150)
        wk = await ev("()=>({tool:UDS.app.state.tool, kind:UDS.app.state.waterKind, pressed:document.querySelector('#palette [data-pal=\"tool:water\"]').getAttribute('aria-pressed'), opts:[...document.querySelectorAll('#palette select.palwk option')].map(o=>o.textContent)})")
        check(wk['tool']=='water' and wk['kind']=='river' and wk['pressed']=='true' and len(wk['opts'])==4, f"water item with a kind list like 교목 {wk}")
        await ev("()=>UDS.app.setTool('select')")
        w = await ev("""()=>{const a=UDS.app; a.setScene('standard');
          a.setTool('water','circle'); a.clickWorld([150,110], null, {}); const c1=a.state.sel;
          a.setTool('water','rect'); a.clickWorld([175,190], null, {});
          a.setTool('water','free'); [[115,160],[135,150],[140,170],[125,185],[110,178]].forEach(p=>a.clickWorld(p,null,{})); a.clickWorld([115,160],null,{});
          a.setTool('water','river'); [[0,40],[120,55],[260,35],[420,50]].forEach(p=>a.clickWorld(p,null,{})); a.waterFinish(); a.setTool('select');
          const D=a.D, U=UDS.U; const riv=D.waters.find(x=>x.kind==='river');
          let bad=0; D.buildings.forEach(b=>D.waters.forEach(wt=>{ if (b.fp.some(p=>U.pointInPoly(p,wt.poly))||wt.poly.some(p=>U.pointInPoly(p,b.fp))) bad++; }));
          const wetTrees=D.trees.filter(t=>t.kind!=='free'&&D.waters.some(wt=>U.pointInPoly([t.x,t.y],wt.poly))).length;
          return {kinds:D.waters.map(x=>x.kind), c1, sel:a.state.sel, bridges:D.bridges.filter(g=>g.waterId===riv.id).map(g=>a.road(g.roadId).name), bad, wetTrees, pane:document.querySelector('#pane').innerText.slice(0,80)};}""")
        check(w['kinds']==['circle','rect','free','river'], f"four water kinds placed {w['kinds']}")
        check(w['c1'] and w['c1']['type']=='water' and w['sel']['type']=='water', f"placed water is selected {w['sel']}")
        check(len(set(w['bridges']))>=3, f"roads crossing the river become bridges {sorted(set(w['bridges']))}")
        check(w['bad']==0 and w['wetTrees']==0, f"no building or generated tree in the water (bad {w['bad']}, trees {w['wetTrees']})")
        check('하천' in w['pane'] and '다리' in await ev("()=>document.querySelector('#pane').innerText"), "river pane shows its bridges")
        wp = await ev("""()=>{const a=UDS.app; const wt=a.P.waters.find(x=>x.kind==='circle'); a.select({type:'water', id:wt.id}); UDS.ui.pane(); const inp=document.querySelector('#pane input[data-k="지름"]'); inp.value='20'; inp.dispatchEvent(new Event('change',{bubbles:true}));
          const dw=a.D.waters.find(x=>x.id===wt.id); return {r:a.water(wt.id).r, area:Math.round(dw.area)};}""")
        check(abs(wp['r']-10)<1e-6 and wp['area']>300, f"circle diameter edit in the pane {wp}")
        # 이동 도구로 연못 옮기기
        mv = await ev("""()=>{const a=UDS.app; const wt=a.P.waters.find(x=>x.kind==='rect'); a.setTool('move'); a.select(null); a.state.view='2d'; document.getElementById('app').dataset.view='2d'; window.dispatchEvent(new Event('resize'));
          const v=a.r2.view; v.cx=175; v.cy=190; v.s=4; a.invalidate(7); const s=a.r2.w2s(wt.c); const R=a.r2.cv.getBoundingClientRect(); return {x:R.left+s[0], y:R.top+s[1], c:wt.c.slice(), id:wt.id};}""")
        await pg.mouse.move(mv['x'], mv['y']); await pg.mouse.down(); await pg.mouse.move(mv['x']+40, mv['y'], steps=6); await pg.mouse.up(); await pg.wait_for_timeout(300)
        mv2 = await ev(f"()=>UDS.app.water('{mv['id']}').c")
        check(mv2[0]>mv['c'][0]+5 and abs(mv2[1]-mv['c'][1])<1, f"move tool drags a pond {mv['c']} → {mv2}")
        # 저장·되돌리기·지우기
        sv = await ev("""()=>{const a=UDS.app; const js=JSON.stringify(a.P); const P=JSON.parse(js); return {w:P.waters.length, ctrl:P.waters.some(x=>x.ctrl)};}""")
        check(sv['w']==4 and sv['ctrl'], f"project JSON keeps water features {sv}")
        ud = await ev("""()=>{const a=UDS.app; a.setTool('select'); const wt=a.P.waters.find(x=>x.kind==='free'); a.eraseAt({type:'water', id:wt.id}); a.commit(); const n1=a.P.waters.length; a.undo(); return [n1, a.P.waters.length];}""")
        check(ud==[3,4], f"erase water and undo {ud}")
        # 내보내기: SVG 레이어, 3D 갈래
        ex = await ev("""()=>{const a=UDS.app; const svg=a.r2.exportSVG(); const X=UDS.Export3D.collect(a,{ground:true,bld:false,tree:false,furn:false,ctx:false,util:false}); return {water:/inkscape:label="수공간"/.test(svg)||/수공간/.test(svg), bridge:/다리/.test(svg), cat:X?[...X.cats.values()].some(c=>[...c.nodes.keys()].length>=0&&c.name==='Ground'):false};}""")
        check(ex['water'] and ex['bridge'] and ex['cat'], f"exports carry water and bridge layers {ex}")
        await ev("()=>{const a=UDS.app; a.state.view='split'; document.getElementById('app').dataset.view='split'; window.dispatchEvent(new Event('resize')); const v=a.r2.view; v.cx=130; v.cy=100; v.s=1.9; a.invalidate(7);}")
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=OUTD + "/v18_a.png")

        # 7. 도움말 메뉴의 소개 칸에 저작권, 음영분석이 꺼져 있으면 날짜·시각을 적지 않음
        await ev("()=>UDS.app.setTool('select')")
        await pg.click('.top .mbar .mb[data-arg="help"]'); await pg.wait_for_timeout(250)
        ab = await ev("()=>{const m=document.querySelector('#pop .mhead.about'); return m?m.innerText:''}")
        check('©' in ab and 'School of Smart Cities' in ab and 'All rights reserved' in ab, f"copyright sits in the help menu's about box {ab!r}")
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        sl = await ev("""()=>{const a=UDS.app, t=()=>document.querySelector('#palette .pgrp.xg[data-grp="shade"] .pgv').textContent; UDS.ui.run('shadow','off'); const off=t(); UDS.ui.run('shadow','on'); const on=t(); UDS.ui.run('shadow','off'); return {off, on, off2:t()};}""")
        check(sl['off']=='' and sl['on']!='' and sl['off2']=='', f"shade header shows date/time only while shade analysis is on {sl}")
        # 8. 전선 지중화: 단면에서 전력관을 넣으면 그 도로의 전주가 사라지고, 법규검토의 [모두 지중화]로 한꺼번에
        u1 = await ev("""()=>{const a=UDS.app; a.setScene('oldtown'); const r=a.P.roads.find(x=>x.overhead&&UDS.Derive.layout(x).hasCar); const p0=a.D.poles.filter(p=>p.roadId===r.id).length;
          a.state.secRoadId=r.id; a.addUtil('power'); const r2=a.road(r.id); return {p0, p1:a.D.poles.filter(p=>p.roadId===r.id).length, overhead:r2.overhead, utils:r2.utils.map(u=>u.type)};}""")
        check(u1['p0']>0 and u1['p1']==0 and not u1['overhead'] and 'power' in u1['utils'] and 'telecom' in u1['utils'], f"adding a power duct undergrounds that road's wires (poles removed) {u1}")
        await ev("()=>{const a=UDS.app; a.state.tab='checks'; UDS.ui.pane();}"); await pg.wait_for_timeout(200)
        u2 = await ev("""()=>{const a=UDS.app; const bar=document.querySelector('#pane .ckfix'); const txt=bar?bar.innerText:''; const e0=a.D.checks.filter(c=>c.level==='error').length, ov0=a.P.roads.filter(r=>r.overhead).length;
          if (bar) bar.querySelector('[data-act="undergrall"]').click(); return {txt, ov0, ov1:a.P.roads.filter(r=>r.overhead&&UDS.Derive.layout(r).hasCar).length, poles:a.D.poles.length, e0, e1:a.D.checks.filter(c=>c.level==='error').length, bar2:!!document.querySelector('#pane .ckfix')};}""")
        check('모두 지중화' in u2['txt'] and u2['ov0']>0 and u2['ov1']==0 and u2['poles']==0 and u2['e1']<=u2['e0'], f"checks pane offers one-click undergrounding for all roads {u2}")
        # 9. 하천: 대상지 밖에서도 생기고, 깊이를 고치면 3D 물길이 내려가고, 천변공원(녹지·산책로·가로수) 바깥으로 건물이 물러남
        rv = await ev("""()=>{const a=UDS.app, U=UDS.U; a.setScene('standard'); a.state.view='split'; document.getElementById('app').dataset.view='split'; window.dispatchEvent(new Event('resize'));
          a.setTool('water','river'); [[-60,40],[120,55],[260,35],[480,50]].forEach(p=>a.clickWorld(p,null,{})); a.waterFinish(); const id1=a.state.sel.id;
          a.setTool('water','river'); [[-80,-40],[200,-30],[500,-45]].forEach(p=>a.clickWorld(p,null,{})); a.waterFinish(); const id2=a.state.sel.id;
          const o=a.D.waters.find(x=>x.id===id2), oy=o?Math.max(...o.poly.map(q=>q[1])):99;
          a.setTool('select'); a.select({type:'water', id:id1}); UDS.ui.pane();
          const inp=document.querySelector('#pane input[data-k="깊이"]'); inp.value='4'; inp.dispatchEvent(new Event('change',{bubbles:true}));
          const cb=document.querySelector('#pane input[data-k="천변공원"]'); cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));
          const w=a.D.waters.find(x=>x.id===id1), strips=w.parkStrips||[];
          const inStrip=(p)=>strips.some(q=>U.pointInPoly(p,q));
          const bad=a.D.buildings.filter(b=>b.fp.some(inStrip)||strips.some(q=>q.some(p=>U.pointInPoly(p,b.fp)))).length;
          const outTrees=a.D.trees.filter(t=>t.kind==='park'&&t.x<0&&t.y>20&&t.y<75).length;
          return {n:a.D.waters.length, oArea:o?Math.round(o.area):0, oy, depth:w.depth, park:w.park, strips:strips.length, bad, outTrees, metric:a.D.metrics.trees,
            inSite:a.D.trees.filter(t=>t.x>=0&&t.y>=0&&t.x<=a.P.site.w&&t.y<=a.P.site.h).length,
            head:document.querySelector('#pane').innerText.slice(0,120), parkW:!!document.querySelector('#pane input[data-k="천변공원 폭"]')};}""")
        check(rv['n']==2 and rv['oArea']>3000 and rv['oy']<0, f"a river drawn wholly outside the site is generated {rv['oArea']}㎡, max y {rv['oy']}")
        check(rv['depth']==4 and '깊이 4m' in rv['head'], f"river depth edit in the pane (depth {rv['depth']})")
        check(rv['park']==12 and rv['strips']==2 and rv['parkW'], f"riverside park option adds strips on both banks {rv['strips']}")
        check(rv['bad']==0, f"buildings stay outside the riverside park ({rv['bad']} overlapping)")
        check(rv['outTrees']>0 and rv['metric']==rv['inSite'], f"park trees continue outside the site ({rv['outTrees']}), tree metric counts the site only ({rv['metric']}/{rv['inSite']})")
        await pg.wait_for_timeout(600)
        r3 = await ev("""()=>{const a=UDS.app; a.r3.draw&&a.r3.draw(); const m=a.r3.meshes||{}; return {punch:m.punch?m.punch.count:0, g2:m.ground2?m.ground2.count:0};}""")
        check(r3['punch']>0 and r3['g2']>0, f"3D cuts the river channel below ground {r3}")
        print("console:", logs[:6])
        check(not logs, "no console errors")
        await b.close()
    print("ALL OK" if ok else "SOME FAILED")
asyncio.run(main())
