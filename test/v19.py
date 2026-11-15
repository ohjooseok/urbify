"""v19: 도로 메뉴 한 목록(회전교차로 맨 아래, 단지 안 길 모양 단추), 보기 묶음을 끄면 접힘, 건물 직사각형(가각·회전교차로·정북 일조),
단지(한 획지에 여러 동: 공동주택 단지·캠퍼스, 신도시 하나·구도심 없음), 건물 옮기기(같은 획지 안·다른 획지의 누른 자리), AI 렌더(Gemini) 창"""
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
PNG1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        pg = await b.new_page(viewport={"width":1440,"height":900})
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type=="error" and "ERR_FAILED" not in m.text and "ERR_INTERNET_DISCONNECTED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        ev = pg.evaluate

        # 1. 도로 메뉴: 소제목 없이 한 목록, 단지내도로·오솔길 다음 맨 아래 회전교차로. 모양 단추는 단지 안 길을 고를 때만, 가운데·간격
        await ev("()=>{const a=UDS.app; a.setTool('road'); a.state.roadPreset='trail2'; UDS.ui.palReveal('road'); UDS.ui.palette();}")
        await pg.wait_for_timeout(350)
        rd = await ev("""()=>{const g=document.querySelector('#palette .pgrp[data-grp="road"] .pgi'); const kids=[...g.children].map(x=>x.dataset.pal||x.className);
          const it=g.querySelector('[data-pal="road:trail2"]').getBoundingClientRect(), sh=g.querySelector('.pshape'), sr=sh.getBoundingClientRect(), seg=sh.querySelector('.seg').getBoundingClientRect();
          return {kids, sub:!!g.querySelector('.psub2'), txt:g.innerText.includes('단지 안 길'), shown:!sh.hidden, gap:sr.top-it.bottom, center:Math.abs((seg.left+seg.right)/2-(sr.left+sr.right)/2)}}""")
        k = rd['kids']
        check(not rd['sub'] and not rd['txt'] and k[-1]=='tool:rabout' and k.index('road:estate4') < k.index('road:trail2') < k.index('tool:rabout') and 'psep' not in k, f"road menu is one list with the roundabout last {k}")
        check(rd['shown'] and rd['gap']>=4 and rd['center']<2, f"shape buttons appear under 오솔길 with a gap and centered (gap {rd['gap']:.1f}px, off-center {rd['center']:.1f}px)")
        await ev("()=>{const a=UDS.app; a.state.roadPreset='so1'; UDS.ui.palette();}")
        check(await ev("()=>document.querySelector('#palette .pshape').hidden"), "shape buttons hide for ordinary roads")
        await ev("()=>UDS.app.setTool('select')")

        # 2. 음영분석·3D 오브젝트: 끄면 펼친 메뉴가 접힘(꺼진 채 펼치면 그대로)
        xs = await ev("""()=>{const ui=UDS.ui, g=(k)=>document.querySelector(`#palette .pgrp.xg[data-grp="${k}"]`).classList.contains('open');
          ui.run('xsw','shade'); ui.xOpen.shade=true; ui.palette(); const a1=g('shade'); ui.run('xsw','shade'); const a2=g('shade');
          ui.xOpen.shade=true; ui.palette(); const a3=g('shade');
          ui.run('xsw','obj'); ui.xOpen.obj=true; ui.palette(); const b1=g('obj'); ui.run('xsw','obj'); const b2=g('obj');
          ui.xOpen.shade=false; ui.palette(); return {a1,a2,a3,b1,b2,sh:UDS.app.state.layers.shadows,tr:UDS.app.state.traffic.on};}""")
        check(xs['a1'] and not xs['a2'] and xs['a3'] and xs['b1'] and not xs['b2'] and not xs['sh'] and not xs['tr'], f"turning 음영분석·3D 오브젝트 off folds an open menu; opening while off stays open {xs}")

        # 3. 건물은 직사각형(맞벽·직접 그린 건물 제외): 가각·회전교차로·임의생성 도시
        rc = await ev("""()=>{const a=UDS.app, U=UDS.U, M=UDS.Model; const bad=(D)=>D.buildings.filter(b=>!b.custom&&b.side>=0.3&&!U.isRect(U.cleanPoly(b.fp),0.004)).map(b=>b.lotId);
          a.setScene('standard'); const s0=bad(a.D), o0=a.D.buildings.filter(b=>b.over&&(b.over.far||b.over.bcr)).length;
          a.setTool('rabout'); a.clickWorld([105,150],null,{}); a.clickWorld([105,75],null,{}); a.setTool('select');
          const s1=bad(a.D); let rn=[];
          for (const sd of [11,23,37]) { a.load(M.sceneRandom(sd,'new')); rn=rn.concat(bad(a.D)); }
          return {s0, s1, rn, o0, rabs:2};}""")
        check(not rc['s0'] and not rc['s1'] and not rc['rn'] and rc['o0']==0, f"detached buildings stay rectangular at chamfered corners, beside roundabouts and in random towns {rc}")
        nc = await ev("""()=>{const a=UDS.app, U=UDS.U; a.setScene('standard'); const D=a.D;
          // 가각(교차로 쪽으로 깎인 변)을 정북방향 인접 대지경계선으로 보지 않는다
          const lot=D.lots.find(l=>(l.cornerK||[]).length && l.building); if(!lot) return null;
          const ck=lot.cornerK.map(k=>{const a0=lot.poly[k], c=lot.poly[(k+1)%lot.poly.length]; return UDS.U.perpR(UDS.U.norm(UDS.U.sub(c,a0)));});
          return {n:D.lots.filter(l=>(l.cornerK||[]).length).length, ck, sunErr:D.checks.filter(c=>/정북방향/.test(c.msg)).length};}""")
        check(nc and nc['n']>0 and nc['sunErr']==0, f"corner chamfer edges are road-facing, not north lot lines {nc}")

        # 4. 단지: 도시(가상)에 공동주택 단지 하나, 임의생성 도시 하나씩, 구도심 없음. 동 사이 거리, 단지 전체 건폐율·용적률
        cx = await ev("""()=>{const a=UDS.app, U=UDS.U; a.setScene('standard'); const D=a.D, l=D.lots.find(x=>x.cx); if(!l) return null;
          const bs=l.buildings, ax=[1,0];
          let minGap=Infinity; for (let i=0;i<bs.length;i++) for (let j=i+1;j<bs.length;j++){ const A=bs[i].fp, B=bs[j].fp;
            const ax0=Math.min(...A.map(p=>p[0])), ax1=Math.max(...A.map(p=>p[0])), bx0=Math.min(...B.map(p=>p[0])), bx1=Math.max(...B.map(p=>p[0]));
            if (Math.min(ax1,bx1)-Math.max(ax0,bx0) < 1) continue; // 남북으로 마주 보는 두 동만
            const ay0=Math.min(...A.map(p=>p[1])), ay1=Math.max(...A.map(p=>p[1])), by0=Math.min(...B.map(p=>p[1])), by1=Math.max(...B.map(p=>p[1]));
            minGap=Math.min(minGap, Math.max(by0-ay1, ay0-by1)); }
          const need=Math.max(10, 0.5*bs[0].h), tot=bs.reduce((s,b)=>s+b.area,0), gfa=bs.reduce((s,b)=>s+b.gfa,0);
          const errs=D.checks.filter(c=>c.target&&c.target.id===l.id&&c.level==='error').length;
          const ids=new Set(bs.map(b=>b.id)).size;
          return {n:l.cx.n, kind:l.cx.kind, floors:l.cx.floors, minGap, need, bcr:tot/l.area, far:gfa/l.area, farMax:bs[0].farMax, bcrMax:bs[0].bcrMax, errs, ids, ids0:bs[0].id===l.id, rect:bs.every(b=>U.isRect(U.cleanPoly(b.fp),0.004)), lots:D.lots.filter(x=>x.cx).length};}""")
        check(cx and cx['kind']=='apt' and cx['n']>=2 and cx['lots']==1 and cx['ids']==cx['n'] and cx['ids0'] and cx['rect'] and cx['floors']>=5, f"도시(가상) has one apartment complex of rectangular slabs (5+ floors) {cx}")
        check(cx and cx['minGap']>=cx['need']-0.01 and cx['far']<=cx['farMax']+1e-6 and cx['bcr']<=cx['bcrMax']+1e-6 and cx['errs']==0, f"slabs facing each other keep max(10m, 0.5H) and the complex stays within BCR/FAR (gap {cx and round(cx['minGap'],1)} ≥ {cx and round(cx['need'],1)})")
        rn = await ev("""()=>{const a=UDS.app, M=UDS.Model; const out=[];
          for (const sd of [3,11,23,37,51]) { a.load(M.sceneRandom(sd,'new')); out.push(a.D.lots.filter(l=>l.cx).length); }
          let camp=null; for (let sd=1; sd<120 && !camp; sd++) { a.load(M.sceneRandom(sd,'new')); const l=a.D.lots.find(x=>x.cx&&x.cx.kind==='campus'); if (l) camp={sd, n:l.cx.n, far:l.cx.far, farMax:l.building.farMax}; }
          const old=[]; for (const sd of [5,9,13]) { a.load(M.sceneRandom(sd,'old')); old.push(a.D.lots.filter(l=>l.cx).length); } a.setScene('oldtown'); old.push(a.D.lots.filter(l=>l.cx).length);
          return {out, camp, old};}""")
        check(all(x==1 for x in rn['out']) and all(x==0 for x in rn['old']), f"each generated new town has one complex, old towns none {rn['out']} / {rn['old']}")
        check(rn['camp'] and rn['camp']['n']>=2 and rn['camp']['far']<=rn['camp']['farMax']+1e-6, f"some generated towns get a campus complex instead {rn['camp']}")
        # 속성: 단지 배치·통계, 동 하나만 고르기 막대 없음, 한 동으로 바꾸기
        await ev("()=>{const a=UDS.app; a.setScene('standard'); a.state.view='split'; document.getElementById('app').dataset.view='split'; window.dispatchEvent(new Event('resize'));}")
        await pg.wait_for_timeout(400)
        pn = await ev("""()=>{const a=UDS.app; const l=a.D.lots.find(x=>x.cx); a.select({type:'building', id:l.id}); UDS.ui.pane(); UDS.ui.bldBar('2d');
          const t=document.querySelector('#pane').innerText; return {id:l.id, head:document.querySelector('#pane .ph b, #pane h2, #pane .phead b')?.textContent||'', has:t.includes('단지 배치')&&t.includes('동 수')&&t.includes('마주 보는 두 동'), bar:document.getElementById('bldbar2').hidden, sel:document.querySelector('#pane select[data-k="단지 배치"]').value};}""")
        check(pn['has'] and pn['bar'] and pn['sel']=='apt', f"complex pane shows 단지 배치 and totals; no single-building toolbar {pn}")
        one = await ev(f"""()=>{{const a=UDS.app; const s=document.querySelector('#pane select[data-k="단지 배치"]'); s.value=''; s.dispatchEvent(new Event('change',{{bubbles:true}}));
          const l=a.D.lots.find(x=>x.id==='{pn['id']}'); const n1=a.D.buildings.filter(b=>b.lotId===l.id).length;
          const s2=document.querySelector('#pane select[data-k="단지 배치"]'); s2.value='campus'; s2.dispatchEvent(new Event('change',{{bubbles:true}}));
          const l2=a.D.lots.find(x=>x.id==='{pn['id']}'); return {{n1, cx1:!!l.cx, kind2:l2.cx&&l2.cx.kind, n2:l2.cx&&l2.cx.n}};}}""")
        check(one['n1']==1 and not one['cx1'] and one['kind2']=='campus' and one['n2']>=2, f"단지 배치 switches between one building and a campus {one}")
        await ev("()=>{UDS.app.undo(); UDS.app.undo();}")
        # 단면: 단지에 접한 도로의 단면은 가장 가까운 동을 보인다
        sc = await ev("""()=>{const a=UDS.app; const l=a.D.lots.find(x=>x.cx); const f=l.frontage[0], r=a.road(f.roadId);
          const U=UDS.U, pa=l.poly[f.k], pb=l.poly[(f.k+1)%l.poly.length], mid=U.mid(pa,pb);
          let acc=0, best=null; for (let i=0;i+1<r.pts.length;i++){ const q=U.distPointSeg(mid, r.pts[i], r.pts[i+1]); const L=U.dist(r.pts[i], r.pts[i+1]); const t=U.dist(r.pts[i], q.q); if(!best||q.d<best.d) best={d:q.d, s:acc+t}; acc+=L; }
          const ss=best.s;
          const C=UDS.Derive.sectionContext(a.P, a.D, r.id, ss); const sd=['L','R'].map(k=>C.sides[k]).find(x=>x&&x.lot&&x.lot.id===l.id);
          return sd? {inCx: l.buildings.includes(sd.building), setback:sd.setback} : {none:true};}""")
        check(sc.get('inCx') and sc['setback']>=3.9, f"street section beside the complex shows its nearest slab and setback {sc}")

        # 5. 옮기기 막대: 같은 획지 안의 누른 자리로, 다른 획지면 누른 자리 가까이로
        mv = await ev("""()=>{const a=UDS.app, U=UDS.U; a.setScene('standard'); a.state.view='2d'; document.getElementById('app').dataset.view='2d'; window.dispatchEvent(new Event('resize'));
          const b=a.D.buildings.find(x=>x.use==='com'&&!x.cx); const lot=a.D.lots.find(l=>l.id===b.lotId); const fr=UDS.Derive.lotFrame(lot), c0=U.polyCentroid(b.fp);
          a.select({type:'building', id:b.lotId}); a.bldClipStart(b.lotId,'move');
          const w=U.add(c0, U.mul(fr.v, 5)); a.bldPasteAt(w, null);
          const b2=a.D.buildings.find(x=>x.lotId===b.lotId); const c1=U.polyCentroid(b2.fp);
          return {id:b.lotId, moved:U.dot(U.sub(c1,c0), fr.v), shift:a.lotOv(b.lotId).bld.shift, tool:a.state.tool};}""")
        check(abs(mv['moved']-5)<0.6 and mv['tool']=='select', f"toolbar move places the building at the clicked spot inside its own lot {mv}")
        mv2 = await ev("""()=>{const a=UDS.app, U=UDS.U; const src=a.D.buildings.find(x=>x.use==='res'&&!x.cx&&!x.custom&&x.area<500);
          const dst=a.D.lots.find(l=>l.use==='res'&&l.building&&l.id!==src.lotId&&l.blockId!==src.blockId&&!l.cx&&l.area>src.area*1.2);
          const fr=UDS.Derive.lotFrame(dst), c=U.polyCentroid(dst.poly), at=U.add(c, U.mul(fr.u, 3));
          a.select({type:'building', id:src.lotId}); a.bldClipStart(src.lotId,'move'); a.bldPasteAt(at, {type:'lot', id:dst.id});
          const nb=a.D.buildings.find(x=>x.lotId===dst.id), old=a.D.buildings.find(x=>x.lotId===src.lotId);
          return {moved:!!nb, srcEmpty:!old, d:nb?U.dist(U.polyCentroid(nb.fp), at):null};}""")
        check(mv2['moved'] and mv2['srcEmpty'] and mv2['d'] is not None and mv2['d']<6, f"moving to another lot seats the building near the clicked point {mv2}")
        gh = await ev("""()=>{const a=UDS.app, U=UDS.U; const b=a.D.buildings.find(x=>x.use==='com'&&!x.cx); a.select({type:'building', id:b.lotId}); a.bldClipStart(b.lotId,'move');
          const c=U.polyCentroid(b.fp), s=a.r2.w2s(c); a.hover2D([s[0]+3, s[1]+3], {}); const g=a.state.bldDrag; const out={ghost:!!g, same:g&&g.same, hint:document.getElementById('hint').innerText.slice(0,40)}; a.setTool('select'); return out;}""")
        check(gh['ghost'] and gh['same'] and '같은 획지 안' in gh['hint'], f"move mode shows the building ghost under the pointer {gh}")

        # 6. AI 렌더(Gemini): 창·참고 그림·프롬프트, 키는 기억을 켤 때만 저장, 응답 그림 표시, 키 오류·막힌 요청 안내
        await ev("()=>{const a=UDS.app; a.state.view='split'; document.getElementById('app').dataset.view='split'; window.dispatchEvent(new Event('resize'));}")
        await pg.wait_for_timeout(500)
        await pg.click('#v3d [data-act="airender"]'); await pg.wait_for_timeout(900)
        ai = await ev("""()=>{const d=document.getElementById('dialog'); const im=d.querySelector('.airimg img'); const t=d.querySelector('[data-ai="prompt"]').value;
          const s=d.querySelector('[data-ai="style"]'); s.value='dusk'; s.dispatchEvent(new Event('change',{bubbles:true})); const t2=d.querySelector('[data-ai="prompt"]').value;
          return {open:!d.hidden, img:!!im, w:im?im.naturalWidth:0, strict:t.includes('STRICT GEOMETRY'), dusk:t2.includes('golden hour'), aspect:UDS.AIRender.aspect(1600,900), cvw:UDS.app.r3.cv.width};}""")
        check(ai['open'] and ai['img'] and ai['w']>=1000 and ai['strict'] and ai['dusk'] and ai['aspect']=='16:9' and ai['cvw']<ai['w']+5000, f"AI render dialog captures the 3D view (upscaled) and builds a geometry-keeping prompt {ai}")
        calls=[]
        async def fake(route):
            req=route.request; calls.append({'url':req.url, 'key':req.headers.get('x-goog-api-key'), 'body':req.post_data_json})
            await route.fulfill(status=200, content_type="application/json", body=json.dumps({"candidates":[{"content":{"parts":[{"text":"rendered"},{"inlineData":{"mimeType":"image/png","data":PNG1}}]}}]}))
        await pg.route("https://generativelanguage.googleapis.com/**", fake)
        await ev("()=>{const i=document.querySelector('#dialog [data-ai=\"key\"]'); i.value='TEST-KEY-123'; i.dispatchEvent(new Event('input',{bubbles:true}));}")
        await pg.click('#dialog [data-ai-do="go"]'); await pg.wait_for_timeout(700)
        res = await ev("()=>({img:!!document.querySelector('#dialog .airres img'), save:!!document.querySelector('#dialog [data-ai-do=\"save\"]'), ls:localStorage.getItem('uds.gemini.key')})")
        body = calls[0]['body'] if calls else {}
        parts = body.get('contents',[{}])[0].get('parts',[]) if body else []
        check(calls and ':generateContent' in calls[0]['url'] and calls[0]['key']=='TEST-KEY-123' and 'key=' not in calls[0]['url'] and len(parts)==2 and 'inline_data' in parts[1] and body['generationConfig']['imageConfig']['aspectRatio'], f"request carries the key only in the header, the prompt and the 3D image {calls[0]['url'] if calls else None}")
        check(res['img'] and res['save'] and res['ls'] is None, f"returned image is shown with a save button; key not stored without 기억 {res}")
        await pg.unroute("https://generativelanguage.googleapis.com/**")
        await pg.route("https://generativelanguage.googleapis.com/**", lambda r: r.fulfill(status=400, content_type="application/json", body=json.dumps({"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}})))
        await pg.click('#dialog [data-ai-do="go"]'); await pg.wait_for_timeout(600)
        m1 = await ev("()=>document.querySelector('#dialog [data-ai=\"msg\"]').textContent")
        await pg.unroute("https://generativelanguage.googleapis.com/**")
        await pg.route("https://generativelanguage.googleapis.com/**", lambda r: r.abort())
        await pg.click('#dialog [data-ai-do="go"]'); await pg.wait_for_timeout(600)
        m2 = await ev("()=>document.querySelector('#dialog [data-ai=\"msg\"]').textContent")
        check('API 키가 맞지 않습니다' in m1 and '막혔습니다' in m2, f"errors explain a wrong key and blocked requests {m1[:30]!r} / {m2[:30]!r}")
        await ev("()=>{const c=document.querySelector('#dialog [data-ai=\"remember\"]'); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));}")
        rem = await ev("()=>localStorage.getItem('uds.gemini.key')")
        await ev("()=>{const c=document.querySelector('#dialog [data-ai=\"remember\"]'); c.checked=false; c.dispatchEvent(new Event('change',{bubbles:true}));}")
        rem2 = await ev("()=>localStorage.getItem('uds.gemini.key')")
        check(rem=='TEST-KEY-123' and rem2 is None, f"이 브라우저에 기억 stores and clears the key ({rem!r} → {rem2!r})")
        await ev("()=>UDS.ui.closeDialog()")
        await pg.screenshot(path=OUTD + "/v19_a.png")

        print("console:", logs[:6])
        check(not [l for l in logs if 'net::ERR' not in l and 'status of 400' not in l], "no console errors (the 400 is the simulated wrong-key reply)")
        await b.close()
    print("ALL OK" if ok else "SOME FAILED")
asyncio.run(main())
