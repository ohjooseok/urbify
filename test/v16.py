"""v16: 획지 나누기 두 줄, 건물 변 끌기(깊이·길이), 돌리기 손잡이·건물 막대(평면·3D), 건물 직접 그리기, 길이 입력(도로·건물)"""
import asyncio, math
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
        async def scr(w):
            return await ev("(w)=>{const a=UDS.app, r=a.r2.cv.getBoundingClientRect(), s=a.r2.w2s(w); return [r.left+s[0], r.top+s[1]];}", w)
        async def drag(p0, p1, shift=False):
            await pg.mouse.move(*p0); await pg.wait_for_timeout(60)
            if shift: await pg.keyboard.down('Shift')
            await pg.mouse.down(); await pg.mouse.move(p0[0]+4, p0[1]+3, steps=2); await pg.mouse.move(*p1, steps=8); await pg.wait_for_timeout(80); await pg.mouse.up()
            if shift: await pg.keyboard.up('Shift')
            await pg.wait_for_timeout(250)

        # 1. 획지 나누기: 나란히·앞뒤로 각각 한 줄
        sp = await ev("""()=>{const a=UDS.app; const l=a.D.lots.find(x=>x.building); a.select({type:'lot', id:l.id}); a.state.tab='props'; UDS.ui.pane();
           const rows=[...document.querySelectorAll('#pane .splitrow')]; return rows.map(r=>({segs:r.querySelectorAll('.seg').length, txt:r.innerText.replace(/\\s+/g,' ').trim(), top:Math.round(r.getBoundingClientRect().top)}));}""")
        check(len(sp)==2 and all(r['segs']==1 for r in sp) and sp[0]['txt'].startswith('나란히') and sp[1]['txt'].startswith('앞뒤로') and sp[1]['top']>sp[0]['top'], f"lot split modes on separate lines {sp}")

        # 2. 건물 변: 마우스를 대면 굵어지고 크기 바꾸기 화살표
        info = await ev("""()=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.use==='res'&&x.area>300&&!x.gable&&!x.custom); const c=U.polyCentroid(b.fp); const v=a.r2.view; v.cx=c[0]; v.cy=c[1]; v.s=5; a.setTool('select'); a.select(null); a.invalidate(7);
           const lot=a.D.lots.find(l=>l.id===b.lotId), fr=UDS.Derive.lotFrame(lot);
           const ed=(dir)=>{let k=-1,best=-2; b.fp.forEach((p,i)=>{const q=b.fp[(i+1)%b.fp.length]; const n=U.perpR(U.norm(U.sub(q,p))); const d=U.dot(n,dir); if(d>best){best=d;k=i;}}); const A=b.fp[k],B=b.fp[(k+1)%b.fp.length]; return {mid:U.mid(A,B), n:U.perpR(U.norm(U.sub(B,A)))};};
           const ext=(dir)=>{const t=b.fp.map(q=>U.dot(q,dir)); return [Math.min(...t),Math.max(...t)];};
           return {id:b.lotId, back:ed(fr.v), side:ed(fr.u), u:fr.u, v:fr.v, ev:ext(fr.v), eu:ext(fr.u), depth:b.cfg.depth, len:b.cfg.len||0}}""")
        await pg.wait_for_timeout(250)
        m = await scr(info['back']['mid'])
        await pg.mouse.move(m[0]+1, m[1]); await pg.wait_for_timeout(200)
        hv = await ev("()=>{const st=UDS.app.state; return {hv:st.bldHover&&st.bldHover.kind, id:st.bldHover&&st.bldHover.id, cur:UDS.app.r2.cv.style.cursor, hover:st.hover&&st.hover.type}}")
        check(hv['hv']=='edge' and hv['id']==info['id'] and hv['cur'].endswith('-resize') and hv['hover']=='building', f"hovering a building edge offers a resize handle {hv}")
        # 3. 안쪽 변을 끌면 깊이가 바뀌고 도로 쪽 변은 제자리
        t = await scr([info['back']['mid'][0]-info['back']['n'][0]*4, info['back']['mid'][1]-info['back']['n'][1]*4])
        await drag(m, t)
        d1 = await ev("""(o)=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.lotId===o.id); const t=b.fp.map(q=>U.dot(q,o.v)); return {depth:a.lotOv(o.id).bld.depth, ev:[Math.min(...t),Math.max(...t)], sel:a.state.sel}}""", info)
        check(abs(d1['ev'][0]-info['ev'][0])<0.3 and abs((info['ev'][1]-d1['ev'][1])-4)<0.6 and d1['sel']['id']==info['id'], f"dragging the back edge changes depth, front edge stays {info['ev']} → {d1['ev']} depth {info['depth']}→{d1['depth']}")
        # 옆 변을 안쪽으로 끌면 길이가 바뀌고 맞은편 변은 제자리
        m2 = await scr(info['side']['mid']); t2 = await scr([info['side']['mid'][0]-info['side']['n'][0]*5, info['side']['mid'][1]-info['side']['n'][1]*5])
        await drag(m2, t2)
        d2 = await ev("""(o)=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.lotId===o.id); const t=b.fp.map(q=>U.dot(q,o.u)); return {len:a.lotOv(o.id).bld.len, eu:[Math.min(...t),Math.max(...t)]}}""", info)
        check(d2['len']>0 and abs(d2['eu'][0]-info['eu'][0])<0.3 and abs((info['eu'][1]-d2['eu'][1])-5)<0.6, f"dragging a side edge changes length, the other side stays {info['eu']} → {d2['eu']} len {d2['len']}")

        # 4. 돌리기 손잡이(5° 단위)와 건물 막대
        await pg.wait_for_timeout(150)
        h = await ev("(id)=>{const a=UDS.app; const b=a.D.buildings.find(x=>x.lotId===id); const h=a.bldRotHandle(b); return {p:h.p, c:h.c, bar:!document.getElementById('bldbar2').hidden, btn:[...document.querySelectorAll('#bldbar2 [data-act]')].map(x=>x.dataset.act+':'+x.dataset.arg.split('|').slice(1).join('|'))}}", info['id'])
        check(h['bar'] and h['btn'][:6]==['bldx:rot|15','bldx:rot|-15','bldx:flipU','bldx:flipV','bldclip:move','bldclip:copy'], f"selected building shows a toolbar above it {h['btn']}")
        hp = await scr(h['p']); await pg.mouse.move(*hp); await pg.wait_for_timeout(150)
        cur = await ev("()=>({hv:UDS.app.state.bldHover&&UDS.app.state.bldHover.kind, cur:UDS.app.r2.cv.style.cursor})")
        c=h['c']; d=[h['p'][0]-c[0], h['p'][1]-c[1]]; a=math.radians(33)
        hp2 = await scr([c[0]+d[0]*math.cos(a)-d[1]*math.sin(a), c[1]+d[0]*math.sin(a)+d[1]*math.cos(a)])
        await drag(hp, hp2)
        r1 = await ev("(id)=>UDS.app.lotOv(id).bld.rot", info['id'])
        check(cur['hv']=='rot' and cur['cur']=='grab' and r1==35, f"rotation handle turns the building in 5° steps {cur} rot={r1}")
        await pg.wait_for_timeout(200)
        await pg.click(f'#bldbar2 [data-arg="{info["id"]}|rot|-15"]'); await pg.wait_for_timeout(250)
        await pg.click(f'#bldbar2 [data-arg="{info["id"]}|flipV"]'); await pg.wait_for_timeout(250)
        r2 = await ev("""(id)=>{const a=UDS.app, o=a.lotOv(id).bld; return {rot:o.rot, fv:o.flipV, pressed:document.querySelector(`#bldbar2 [data-arg="${id}|flipV"]`).getAttribute('aria-pressed'), reset:!!document.querySelector(`#bldbar2 [data-arg="${id}|reset"]`), pane:!!document.querySelector('#pane .plrow [data-act=bldx]'), inp:+document.querySelector('#pane .rotin input').value}}""", info['id'])
        check(r2['rot']==20 and r2['fv'] and r2['pressed']=='true' and r2['reset'] and not r2['pane'] and r2['inp']==20, f"toolbar rotates 15° and flips; pane keeps only the angle field {r2}")
        b3 = await ev("""(id)=>{const a=UDS.app; const b=a.D.buildings.find(x=>x.lotId===id); const c=UDS.U.polyCentroid(b.fp); const cam=a.r3.cam; cam.tx=c[0]; cam.tz=-c[1]; cam.dist=120; a.invalidate(7); return true}""", info['id'])
        await pg.wait_for_timeout(900)
        b3 = await ev("()=>{const el=document.getElementById('bldbar3'); const r=el.getBoundingClientRect(), v=document.getElementById('v3d').getBoundingClientRect(); return {vis:!el.hidden, inside:r.left>=v.left-1 && r.right<=v.right+1 && r.top>=v.top-1 && r.bottom<=v.bottom+1, n:el.querySelectorAll('[data-act]').length}}")
        check(b3['vis'] and b3['inside'] and b3['n']>=6, f"the same toolbar floats over the building in 3D {b3}")
        await pg.click(f'#bldbar2 [data-arg="{info["id"]}|reset"]'); await pg.wait_for_timeout(250)
        r3 = await ev("(id)=>{const o=UDS.app.lotOv(id).bld; return [o.rot||0, !!o.flipV, o.shift||null]}", info['id'])
        check(r3==[0, False, None], f"처음대로 clears rotation, flips and offsets {r3}")

        # 5. 건물 직접 그리기(마우스 + 길이 입력)
        await pg.click('.pgrp[data-grp="bld"] .pgh'); await pg.wait_for_timeout(200)
        await pg.click('[data-pal="build:res"]'); await pg.wait_for_timeout(150)
        await pg.click('[data-act="bscope"][data-arg="draw"]'); await pg.wait_for_timeout(200)
        L = await ev("""()=>{const a=UDS.app, U=UDS.U; const lot=a.D.lots.find(l=>a.D.buildings.some(b=>b.lotId===l.id&&b.use==='com'&&b.area>500)); const fr=UDS.Derive.lotFrame(lot); const c=U.polyCentroid(lot.poly);
           const v=a.r2.view; v.cx=c[0]; v.cy=c[1]; v.s=5; a.invalidate(1); const P=(u,w)=>[fr.a[0]+fr.u[0]*u+fr.v[0]*w, fr.a[1]+fr.u[1]*u+fr.v[1]*w];
           return {id:lot.id, p0:P(4,5), u:fr.u, v:fr.v, tool:a.state.tool, scope:a.state.buildOpt.scope, use0:lot.use, opt:document.querySelector('.popt')&&document.querySelector('.popt').innerText}}""")
        check(L['tool']=='build' and L['scope']=='draw' and '직접 그리기' in (L['opt'] or ''), f"건물 놓기 menu has 직접 그리기 {L['tool']} {L['scope']}")
        await pg.wait_for_timeout(150)
        s0 = await scr(L['p0']); await pg.mouse.move(*s0); await pg.mouse.click(*s0); await pg.wait_for_timeout(80)
        for vec, txt in [(L['u'], '12'), (L['v'], '9.5'), ([-L['u'][0], -L['u'][1]], '12')]:
            last = await ev("()=>{const p=UDS.app.state.drawBld.pts; return p[p.length-1]}")
            q = await scr([last[0]+vec[0]*6, last[1]+vec[1]*6]); await pg.mouse.move(*q, steps=3); await pg.wait_for_timeout(60)
            await pg.keyboard.type(txt); await pg.wait_for_timeout(60)
            if txt=='9.5':
                hint = await ev("()=>document.getElementById('hint').innerText")
            await pg.keyboard.press('Enter'); await pg.wait_for_timeout(80)
        pts = await ev("()=>UDS.app.state.drawBld.pts")
        dist = lambda a,b: math.hypot(a[0]-b[0], a[1]-b[1])
        check(len(pts)==4 and abs(dist(pts[0],pts[1])-12)<0.02 and abs(dist(pts[1],pts[2])-9.5)<0.02 and abs(dist(pts[2],pts[3])-12)<0.02 and '길이 9.5m' in hint, f"typed lengths place exact corners {[round(dist(pts[i],pts[i+1]),2) for i in range(len(pts)-1)]} / {hint[:30]!r}")
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(400)
        dw = await ev("""(id)=>{const a=UDS.app; const b=a.D.buildings.find(x=>x.lotId===id), lot=a.D.lots.find(l=>l.id===id); return b?{custom:b.custom, area:Math.round(b.area*10)/10, floors:b.floors, use:b.use, lotUse:lot.use, tool:a.state.tool, drawing:!!a.state.drawBld, toast:(document.querySelector('#toast')||{}).textContent||'', pane:document.querySelector('#pane').innerText}:null}""", L['id'])
        check(dw and dw['custom'] and abs(dw['area']-114)<0.5 and dw['use']=='res' and 1<=dw['floors']<=7 and dw['tool']=='build', f"closing the outline creates the building on that lot {dw and {k:dw[k] for k in ['custom','area','floors','use','tool']}}")
        check(dw and '그렸습니다' in dw['toast'] and '직접 그린 모양' in dw['pane'] and '건축선 후퇴' not in dw['pane'], f"toast and pane for a drawn building {dw and dw['toast'][:40]!r}")
        # Backspace·Esc
        bk = await ev("""(L)=>{const a=UDS.app, U=UDS.U; const P=(u,w)=>{const fr=UDS.Derive.lotFrame(a.D.lots.find(l=>l.id===L.id)); return [fr.a[0]+fr.u[0]*u+fr.v[0]*w, fr.a[1]+fr.u[1]*u+fr.v[1]*w];};
           a.clickWorld(P(1,1),null,{}); a.clickWorld(P(8,1),null,{}); a.clickWorld(P(8,8),null,{});
           const n0=a.state.drawBld.pts.length; window.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace'})); const n1=a.state.drawBld.pts.length;
           window.dispatchEvent(new KeyboardEvent('keydown',{key:'5'})); const buf=a.state.lenBuf; window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); const buf2=a.state.lenBuf, still=!!(a.state.drawBld&&a.state.drawBld.pts.length);
           window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); return {n0,n1,buf,buf2,still,after:!!(a.state.drawBld&&a.state.drawBld.pts.length), tool:a.state.tool}}""", L)
        check(bk['n0']==3 and bk['n1']==2 and bk['buf']=='5' and bk['buf2']=='' and bk['still'] and not bk['after'] and bk['tool']=='build', f"Backspace drops a point, Esc clears the number then the outline {bk}")
        bad = await ev("""(L)=>{const a=UDS.app; const fr=UDS.Derive.lotFrame(a.D.lots.find(l=>l.id===L.id)); const P=(u,w)=>[fr.a[0]+fr.u[0]*u+fr.v[0]*w, fr.a[1]+fr.u[1]*u+fr.v[1]*w];
           const n=a.D.buildings.length; [[2,2],[12,12],[12,2],[2,12]].forEach(q=>a.clickWorld(P(q[0],q[1]),null,{})); a.bldDrawFinish(); const t1=(document.querySelector('#toast')||{}).textContent;
           const r=a.P.roads[0]; const m=r.pts[0], m2=r.pts[1]; const c=[(m[0]*3+m2[0])/4,(m[1]*3+m2[1])/4];
           [[0,0],[9,0],[9,7]].forEach(o=>a.clickWorld([c[0]+o[0],c[1]+o[1]],null,{})); a.bldDrawFinish(); const t2=(document.querySelector('#toast')||{}).textContent;
           return {t1, t2, n:a.D.buildings.length-n}}""", L)
        check('엇갈렸' in bad['t1'] and bad['n']==0, f"crossing outlines are refused {bad['t1'][:30]!r}")
        check('획지 안' in bad['t2'] or '작습니다' in bad['t2'], f"outlines off the lots are refused {bad['t2'][:30]!r}")

        # 6. 직접 그린 건물: 변 밀기·손잡이 돌리기·막대 복사·이동 도구로 옮기기
        await ev("(id)=>{const a=UDS.app; a.setTool('select'); a.select({type:'building', id}); a.invalidate(7);}", L['id'])
        await pg.wait_for_timeout(250)
        e1 = await ev("""(o)=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.lotId===o.id); let k=-1,best=-2; b.fp.forEach((p,i)=>{const q=b.fp[(i+1)%b.fp.length]; const n=U.perpR(U.norm(U.sub(q,p))); const d=U.dot(n,o.v); if(d>best){best=d;k=i;}}); const A=b.fp[k],B=b.fp[(k+1)%b.fp.length]; return {mid:U.mid(A,B), n:U.perpR(U.norm(U.sub(B,A))), area:b.area}}""", L)
        p0 = await scr(e1['mid']); p1 = await scr([e1['mid'][0]+e1['n'][0]*3, e1['mid'][1]+e1['n'][1]*3])
        await drag(p0, p1)
        a1 = await ev("(id)=>UDS.app.D.buildings.find(x=>x.lotId===id).area", L['id'])
        check(abs(a1-(e1['area']+12*3))<1.5, f"pushing an edge of a drawn building grows it {round(e1['area'])} → {round(a1)}")
        h2 = await ev("(id)=>{const a=UDS.app; const b=a.D.buildings.find(x=>x.lotId===id); const h=a.bldRotHandle(b); return {p:h.p, c:h.c}}", L['id'])
        c=h2['c']; d=[h2['p'][0]-c[0], h2['p'][1]-c[1]]; a=math.radians(-58)
        q0 = await scr(h2['p']); q1 = await scr([c[0]+d[0]*math.cos(a)-d[1]*math.sin(a), c[1]+d[0]*math.sin(a)+d[1]*math.cos(a)])
        await drag(q0, q1, shift=True)
        rr = await ev("""(id)=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.lotId===id); return {area:b.area, custom:b.custom}}""", L['id'])
        check(rr['custom'] and abs(rr['area']-a1)<1.5, f"rotating a drawn building keeps its shape {round(a1)} → {round(rr['area'])}")
        await pg.wait_for_timeout(150)
        await pg.click(f'#bldbar2 [data-arg="{L["id"]}|copy"]'); await pg.wait_for_timeout(200)
        tgt = await ev("""(id)=>{const a=UDS.app, U=UDS.U; const src=a.D.lots.find(l=>l.id===id); const t=a.D.lots.filter(l=>l.id!==id && l.blockId!==src.blockId && !UDS.C.USES[l.use].open && l.area>500)[2]; const c=U.interiorPoint(t.poly); const v=a.r2.view; v.cx=c[0]; v.cy=c[1]; v.s=3; a.invalidate(1); return {id:t.id, c}}""", L['id'])
        await pg.wait_for_timeout(150)
        qq = await scr(tgt['c']); await pg.mouse.click(*qq); await pg.wait_for_timeout(300); await pg.keyboard.press('Escape')
        cp = await ev("""(o)=>{const a=UDS.app; const A=a.D.buildings.find(x=>x.lotId===o.s), B=a.D.buildings.find(x=>x.lotId===o.t); return {a:A&&A.area, b:B&&B.area, custom:B&&B.custom, tool:a.state.tool}}""", {"s":L['id'], "t":tgt['id']})
        check(cp['custom'] and cp['a'] and abs(cp['a']-cp['b'])<1.0 and cp['tool']=='select', f"toolbar copy pastes the same outline on another lot {cp}")
        await ev("(id)=>{const a=UDS.app; a.setTool('move'); a.select({type:'building', id}); const b=a.D.buildings.find(x=>x.lotId===id); const c=UDS.U.polyCentroid(b.fp); const v=a.r2.view; v.cx=c[0]; v.cy=c[1]; v.s=5; a.invalidate(7);}", tgt['id'])
        await pg.wait_for_timeout(250)
        mc = await ev("(id)=>UDS.U.polyCentroid(UDS.app.D.buildings.find(x=>x.lotId===id).fp)", tgt['id'])
        m0 = await scr(mc); m1 = await scr([mc[0]+1.5, mc[1]+1.0])
        await drag(m0, m1)
        mc2 = await ev("(id)=>UDS.U.polyCentroid(UDS.app.D.buildings.find(x=>x.lotId===id).fp)", tgt['id'])
        mv = math.hypot(mc2[0]-mc[0], mc2[1]-mc[1])
        check(0.4 < mv < 2.2, f"move tool slides a drawn building inside its lot ({mv:.2f} m)")

        # 7. 도로 길이 입력
        rd = await ev("""()=>{const a=UDS.app, P=a.P; const s=P.roads.find(r=>r.name==='남측 간선도로'); const e=s.pts[s.pts.length-1]; const v=a.r2.view; v.cx=e[0]+30; v.cy=e[1]+10; v.s=3; a.invalidate(1); a.setTool('road', s.preset); return {e, n:P.roads.length, W:P.site.w, id:s.id}}""")
        await pg.wait_for_timeout(150)
        q0 = await scr(rd['e']); await pg.mouse.click(*q0); await pg.wait_for_timeout(80)
        q1 = await scr([rd['e'][0]+20, rd['e'][1]+0.2]); await pg.mouse.move(*q1, steps=3); await pg.wait_for_timeout(60)
        await pg.keyboard.type('37.5'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(80)
        mid = await ev("()=>({n:UDS.app.state.drawRoad&&UDS.app.state.drawRoad.pts.length})")
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(400)
        r5 = await ev("(o)=>{const a=UDS.app, P=a.P, s=a.road(o.id); return {end:s.pts[s.pts.length-1], n:P.roads.length, W:P.site.w}}", rd)
        check(mid['n']==2 and abs(r5['end'][0]-(rd['e'][0]+37.5))<0.02 and abs(r5['end'][1]-rd['e'][1])<0.02 and r5['n']==rd['n'] and r5['W']>=rd['W']+37, f"typed 37.5 m extends the road exactly {rd['e']} → {r5['end']} site {rd['W']}→{r5['W']}")

        # 8. 직접 놓은 수목·시설물이 단면에 나온다(단면선 앞뒤 8m 안)
        await ev("()=>{UDS.app.setTool('select');}")
        sc_ = await ev("""()=>{const a=UDS.app, U=UDS.U, P=a.P; const road=P.roads.find(r=>r.name.includes('보행자')); const info=a.D.roadInfo.get(road.id); const s=info.len*0.4; const q=U.pointAlong(road.pts, s); const n=U.perpL(q.dir);
           const ids=[]; const add=(t,o,dt,extra)=>{const p=U.add(U.add(q.p,U.mul(n,o)),U.mul(q.dir,dt)); const id=U.uid('o'); ids.push(id); P.objects.push({id, type:t, x:U.round(p[0],2), y:U.round(p[1],2), rot:0, ...(extra||{})});};
           add('tree',0,1.5,{species:'zelkova'}); add('bench',-2.6,-2); add('light',3.6,4); add('tree',0,30,{species:'pine'});
           a.commit(); a.select({type:'road', id:road.id}, {s}); a.state.secRoadId=road.id; a.state.secS=s; a.invalidate(7); return ids;}""")
        await pg.wait_for_timeout(700)
        drawn = await ev("()=>UDS.app.sec.placedIds||[]")
        check(sc_[0] in drawn and sc_[1] in drawn and sc_[2] in drawn and sc_[3] not in drawn, f"placed trees and furniture near the cut appear in the section ({len(drawn)} drawn, far tree left out)")
        # 9. 저장·불러오기 뒤에도 그린 건물이 남는다
        sv = await ev("""(id)=>{const a=UDS.app; const before=a.D.buildings.find(x=>x.lotId===id).area; const P=JSON.parse(JSON.stringify(a.exportProject())); a.load(P); const b=a.D.buildings.find(x=>x.lotId===id); return {before, after:b&&b.area, custom:b&&b.custom}}""", L['id'])
        check(sv['custom'] and abs(sv['before']-sv['after'])<0.01, f"drawn buildings survive save/load {sv}")
        check(not logs, f"no errors {logs[:3]}")
        await b.close()
    print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())
