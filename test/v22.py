"""v22: 현황 건물 입면 추정(facade.js) — 시험 PMTiles(test/gen_ovt.py)와 브이월드 꼴 수업 자료로.
유형 판정(용도·층수·면적·모양·면한 길)·같은 결과(결정성)·받을 때의 도로망 기억(rd)·3D 입면(재질 수)·경사지붕·평면 범례·
가로 단면의 현황 건물 입면·건물별 유형 고치기·다른 변주·되돌리기·저장 후 다시 열기·대상지 고르기의 '입면 추정' 선택"""
import asyncio, json, os, re, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--allow-file-access-from-files"]
D = pathlib.Path(TESTD, 'data', 'ovt')
STYLE = json.dumps({"version": 8, "sources": {}, "layers": [{"id": "bg", "type": "background", "paint": {"background-color": "#d9dcd6"}}]})
NOMI = json.dumps([{"lat": "36.6012", "lon": "127.2975", "name": "조치원역", "display_name": "조치원역, 조치원로, 조치원읍, 세종특별자치시, 대한민국", "addresstype": "railway"},
                   {"lat": "36.6000", "lon": "127.2900", "name": "조치원읍사무소", "display_name": "조치원읍사무소, 세종특별자치시", "addresstype": "amenity"}], ensure_ascii=False)
fails = []
def check(name, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{info}]' if info else ''))
    if not ok: fails.append(name)


async def routes(ctx, broken=False):
    async def ovt(route):
        req = route.request
        m = re.search(r'tiles\.overturemaps\.org/(.+)$', req.url)
        f = D / m.group(1) if m else None
        if broken or not f or not f.exists():
            await route.fulfill(status=404, body='not found'); return
        data = f.read_bytes()
        rg = req.headers.get('range', '')
        mm = re.match(r'bytes=(\d+)-(\d+)', rg)
        if mm:
            a, b = int(mm.group(1)), min(int(mm.group(2)), len(data) - 1)
            await route.fulfill(status=206, body=data[a:b + 1], headers={'Content-Range': f'bytes {a}-{b}/{len(data)}', 'Access-Control-Allow-Origin': '*'})
        else:
            await route.fulfill(status=200, body=data, headers={'Access-Control-Allow-Origin': '*'})
    await ctx.route('**/tiles.overturemaps.org/**', ovt)
    await ctx.route('**/stac.overturemaps.org/**', lambda r: r.fulfill(status=200, body=(D / 'catalog.json').read_text(), headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}))
    await ctx.route('**/tiles.openfreemap.org/**', lambda r: r.fulfill(status=200, body=STYLE, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}))
    await ctx.route('**/nominatim.openstreetmap.org/search**', lambda r: r.fulfill(status=200, body=NOMI, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}))
    await ctx.route('**/nominatim.openstreetmap.org/reverse**', lambda r: r.fulfill(status=200, body=json.dumps({"address": {"quarter": "남리"}}, ensure_ascii=False), headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}))
    for host in ('unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'):
        await ctx.route(f'**/{host}/**', lambda r: r.abort())



async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await routes(ctx)
        pg = await ctx.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type == "error" and "GPU stall" not in m.text and "ERR_FAILED" not in m.text and "net::" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: " + str(e)))
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)
        ev = pg.evaluate

        # ---------- 1) 시험 지역으로 대상지 만들기(대화상자 없이) ----------
        r = await ev("""async () => {
          const O = UDS.Ovt, X = UDS.Ctx, F = X.frame(36.6012, 127.2975, 500, 500);
          const raw = await O.fetchArea(X.bbox(F, 45), {});
          const S = O.streets(raw.segs, F);
          const res = X.makeProject({ title: '입면 시험', lat: 36.6012, lon: 127.2975, W: 500, H: 500, bld: raw.bld, streets: S.streets, rabs: S.rabs, type: 'oldtown', src: 'test' });
          UDS.app.load(res.P, { ctx: res.data });
          await new Promise((r) => setTimeout(r, 400));
          const a = UDS.app, m = a.ctxFac(), out = {};
          m.forEach((d, id) => { out[id] = { t: d.t, auto: d.auto, sum: UDS.Fac.summary(d), why: d.why.join(' · '), pitch: d.pitch ? d.pitch.kind : null, front: d.front.size, gH: d.groundH, fH: d.floorH, top: d.top, H: d.H, st: d.st }; });
          // 같은 자료로 다시 셈: 같은 결과
          const again = UDS.Fac.compute(a.ctxData(), a.ctxData().rd.map((r) => ({ pts: r.p, W: r.w })), null);
          let same = true; m.forEach((d, id) => { const e = again.get(id); if (JSON.stringify(d.st) !== JSON.stringify(e.st) || d.t !== e.t || d.groundH !== e.groundH) same = false; });
          return { mode: a.state.ctxMode, rd: (a.ctxData().rd || []).length, rd0: a.ctxData().rd[0], n: m.size, fac: out, same, modes: UDS.Ctx.MODES.map((x) => x[0]) };
        }""")
        print('facades:', json.dumps(r['fac'], ensure_ascii=False))
        f = r['fac']
        check('default existing-building mode is facade', r['mode'] == 'fac' and r['modes'][0] == 'fac', r['modes'])
        check('import-time road network kept (rd)', r['rd'] == 10 and len(r['rd0']['p']) >= 2 and r['rd0']['w'] > 0, r['rd0'])
        check('every building gets a facade', r['n'] == 5)
        check('apartment (02001, 15F) -> apt', f['b-apt']['t'] == 'apt', f['b-apt'])
        check('detached house (01001, 2F) -> house with pitched roof', f['b-house']['t'] == 'house' and f['b-house']['pitch'] in ('gable', 'hip'), f['b-house'])
        check('neighbourhood shop (03) -> shop with shopfront', f['b-shop']['t'] == 'shop' and f['b-shop']['st']['ground'] == 'shop' and f['b-shop']['front'] >= 1, f['b-shop'])
        check('school (10) -> public', f['b-school']['t'] == 'pub', f['b-school'])
        check('unknown use classified from floors/area/road', f['b-none']['t'] in ('multi', 'shop') and '용도 정보 없음' in f['b-none']['why'], f['b-none'])
        check('reasons listed', '15층' in f['b-apt']['why'] and '건축면적' in f['b-apt']['why'], f['b-apt']['why'])
        check('deterministic (same data, same facade)', r['same'])
        check('curtain wall only with glass', all((v['st']['win'] == 'curtain') == (v['st']['material'] == 'glass') for v in f.values()))
        okh = all(v['gH'] >= 2.3 and v['fH'] >= 2.4 and v['top'] <= v['H'] + 0.01 for v in f.values())
        check('floor heights sane (ground ≥2.3m, typical ≥2.4m, wall top ≤ height)', okh, [(k, v['gH'], v['fH'], v['top'], v['H']) for k, v in f.items()])
        check('summary text', '평지붕' in f['b-apt']['sum'] and ('박공지붕' in f['b-house']['sum'] or '모임지붕' in f['b-house']['sum']), (f['b-apt']['sum'], f['b-house']['sum']))

        # ---------- 2) 3D: 입면이면 재질이 여럿, 단색이면 둘 ----------
        mats = await ev("""(() => {
          const a = UDS.app, E = UDS.Export3D, n = () => { const R = E.collect(a, { ctx: true }); return R ? R.mats.filter((m) => /^ctx_/.test(m.name)).length : -1; };
          const f = n(); a.state.ctxMode = 'gray'; a.rebuild3d(); const g = n(); a.state.ctxMode = 'fac'; a.rebuild3d();
          return [f, g];
        })()""")
        check('3D facade colours (many) vs mass (wall+roof)', mats[0] >= 6 and mats[1] == 2, mats)
        await ev("(() => { const a = UDS.app, b = a.ctxBld('b-house'); a.state.view = '3d'; document.querySelector('#app').dataset.view = '3d'; UDS.ui.top && UDS.ui.top(); a.resize && a.resize(); const c = a.r3.cam; c.tx = b.c[0]; c.tz = -b.c[1]; c.dist = 60; c.pitch = 0.5; c.yaw = 0.6; a.rebuild3d(); a.invalidate(7); })()")
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=OUTD + '/v22_house3d.png')
        await ev("(() => { const a = UDS.app, b = a.ctxBld('b-shop'); const c = a.r3.cam; c.tx = b.c[0]; c.tz = -b.c[1]; c.dist = 80; c.pitch = 0.45; c.yaw = 2.2; a.invalidate(7); })()")
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=OUTD + '/v22_shop3d.png')

        # ---------- 3) 평면: 입면 유형 범례·색 ----------
        await ev("(() => { const a = UDS.app; a.state.sel = null; a.state.tab = 'props'; UDS.ui.pane(); })()")
        await pg.wait_for_timeout(200)
        seg = await ev("[...document.querySelectorAll('.cxmode .seg button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : ''))")
        check('mode buttons (facade first, pressed)', seg[0] == '입면*' and len(seg) == 6, seg)
        leg = await ev("[...document.querySelectorAll('.cxleg span')].map((s) => s.innerText.replace(/\\n/g, ' '))")
        check('facade type legend with counts', len(leg) == 7 and any(t.startswith('단독주택') and t.strip().endswith('1') for t in leg) and any(t.startswith('공공·교육') and t.strip().endswith('1') for t in leg), leg)
        tip = await ev("document.querySelector('#pane').innerText")
        check('summary note explains the inference', '추정한 것입니다' in tip)
        col = await ev("UDS.Ctx.classOf(UDS.app.ctxBld('b-school'), 'fac')")
        check('plan colour by facade type', col[0] == 'pub' and col[2] == await ev("UDS.Fac.TYPES.pub.color"), col)

        # ---------- 4) 가로 단면: 빈 획지 쪽 현황 건물에 추정 입면 ----------
        sec = await ev("""(() => {
          const a = UDS.app, Dv = UDS.Derive || UDS.Dv, m = a.ctxFac(); const out = [];
          a.P.roads.forEach((r) => { const inf = a.D.roadInfo.get(r.id); if (!inf) return; for (let s = 5; s < inf.len; s += 10) { const sc = Dv.sectionContext(a.P, a.D, r.id, s); ['L', 'R'].forEach((k) => { const sd = sc && sc.sides[k]; if (sd && sd.ctx && sd.building) out.push({ id: sd.ctx, label: sd.building.label, st: sd.building.st, gH: sd.building.groundH, t: m.get(sd.ctx).t, fst: m.get(sd.ctx).st, fgH: m.get(sd.ctx).groundH }); }); } });
          return out;
        })()""")
        okS = len(sec) > 0 and all(x['label'] == '현황 ' + {'house': '단독주택', 'multi': '다세대·다가구', 'shop': '근린상가', 'apt': '아파트·연립', 'office': '업무·상업 빌딩', 'pub': '공공·교육', 'shed': '창고·공장'}[x['t']] and x['st'] == x['fst'] and x['gH'] == x['fgH'] for x in sec)
        check('section uses the inferred facade of existing buildings', okS, sec[:2])

        # ---------- 5) 건물별 유형 고치기·다른 변주·되돌리기·자동으로 ----------
        await ev("(() => { const a = UDS.app; a.state.sel = { type: 'ctx', id: 'b-none' }; a.state.tab = 'props'; UDS.ui.pane(); })()")
        await pg.wait_for_timeout(200)
        pane = await ev("document.querySelector('#pane').innerText")
        check('ctx pane shows facade section', '입면 (추정)' in pane and '다른 변주' in pane and '근거:' in pane, pane[-300:])
        await pg.select_option('#pane select[data-k="입면 유형"]', 'office'); await pg.wait_for_timeout(500)
        st1 = await ev("(() => { const a = UDS.app, d = a.ctxFac().get('b-none'); return { fa: JSON.stringify(a.P.ctx.fa), t: d.t, auto: d.auto, fixed: d.fixed, win: d.st.win }; })()")
        check('type override stored in plan and applied', st1['fa'] == '{"b-none":{"t":"office"}}' and st1['t'] == 'office' and st1['fixed'] and st1['auto'] != 'office', st1)
        seen = set()
        for i in range(3):
            await pg.locator('#pane [data-act="ctxvar"]').click(); await pg.wait_for_timeout(350)
            seen.add(await ev("JSON.stringify(UDS.app.ctxFac().get('b-none').st)"))
        vv = await ev("UDS.app.P.ctx.fa['b-none']")
        check('other variant: counter grows and look changes', vv == {'t': 'office', 'v': 3} and len(seen) >= 2, (vv, len(seen)))
        await ev("UDS.app.undo()"); await pg.wait_for_timeout(300)
        check('undo steps the variant back', await ev("UDS.app.P.ctx.fa['b-none'].v") == 2)
        await ev("UDS.app.saveNow ? UDS.app.saveNow() : null"); await pg.wait_for_timeout(600)
        await pg.reload(); await pg.wait_for_timeout(1500)
        try: await pg.wait_for_function("!!(UDS.app && UDS.app.ctxData())", timeout=10000)
        except Exception: pass
        rr = await ev("(() => { const a = UDS.app, d = a.ctxFac() && a.ctxFac().get('b-none'); return { fa: a.P.ctx && a.P.ctx.fa, t: d && d.t, v: d && d.v, rd: !!(a.ctxData() && a.ctxData().rd) }; })()")
        check('override and variant survive reload', rr['fa'] == {'b-none': {'t': 'office', 'v': 2}} and rr['t'] == 'office' and rr['v'] == 2 and rr['rd'], rr)
        await ev("(() => { const a = UDS.app; a.state.sel = { type: 'ctx', id: 'b-none' }; a.state.tab = 'props'; UDS.ui.pane(); })()")
        await pg.wait_for_timeout(200)
        await pg.locator('#pane [data-act="ctxfareset"]').click(); await pg.wait_for_timeout(400)
        rs = await ev("(() => { const a = UDS.app, d = a.ctxFac().get('b-none'); return { fa: a.P.ctx.fa, t: d.t, auto: d.auto }; })()")
        check('back to automatic', rs['fa'] == {} and rs['t'] == rs['auto'], rs)
        await pg.screenshot(path=OUTD + '/v22_pane.png')

        # ---------- 6) 브이월드 꼴 수업 자료(용도·사용승인일 있음): 유형이 여럿 ----------
        TD = pathlib.Path(TESTD, 'data')
        bt = (TD / 'vw_bld.js').read_text(encoding='utf-8'); bj = json.loads(bt[bt.index('{'):bt.rindex('}') + 1])
        pj = json.loads((TD / 'vw_par.json').read_text(encoding='utf-8'))
        vw = await ev("""([B, Pj]) => {
          const X = UDS.Ctx, res = X.makeProject({ title: '안암', lat: 37.5894, lon: 127.0323, W: 400, H: 400, bld: B.features, par: Pj.features, roads: true, type: 'oldtown' });
          UDS.app.load(res.P, { ctx: res.data, save: false });
          const m = UDS.app.ctxFac(), cnt = {}; let pitched = 0, green = 0;
          m.forEach((d) => { cnt[d.t] = (cnt[d.t] || 0) + 1; if (d.pitch) pitched++; if (/평지붕\\(녹색/.test(UDS.Fac.summary(d))) green++; });
          const cx = UDS.app.ctxData();
          const apt = cx.bld.filter((b) => /^02001/.test(b.pc) && b.fl >= 5).map((b) => m.get(b.id).t);
          return { n: m.size, nb: cx.bld.length, cnt, pitched, green, apt, rd: (cx.rd || []).length };
        }""", [bj, pj])
        print('vworld bundle:', json.dumps(vw, ensure_ascii=False))
        check('vworld data: all buildings get facades', vw['n'] == vw['nb'] and vw['n'] > 100, vw['n'])
        check('vworld data: several facade types', len(vw['cnt']) >= 4, vw['cnt'])
        check('vworld data: registered apartments -> apt', all(t == 'apt' for t in vw['apt']), vw['apt'])
        check('vworld data: parcel-road snapshot kept', vw['rd'] > 3, vw['rd'])

        # ---------- 7) 대상지 고르기: '입면 추정'을 끄면 단색(매스)으로 ----------
        await ev("UDS.ui.siteDialog()")
        await pg.wait_for_timeout(500)
        check('picker has facade option (on by default)', await ev("!!document.querySelector('#spFac') && document.querySelector('#spFac').checked"))
        await pg.locator('#spFac').uncheck()
        await pg.wait_for_function("UDS.SitePick.st.pv && !UDS.SitePick.st.step", timeout=15000)
        await pg.locator('#spGo').click()
        await pg.wait_for_function("!document.querySelector('.dlg.site')", timeout=15000)
        await pg.wait_for_timeout(600)
        check('facade off in picker -> mass mode', await ev("UDS.app.state.ctxMode") == 'gray')
        check('picker remembers the choice', await ev("JSON.parse(localStorage.getItem('uds.site')).fac") is False)
        await ev("UDS.ui.siteDialog()"); await pg.wait_for_timeout(400)
        check('picker shows remembered choice', await ev("!document.querySelector('#spFac').checked"))
        await pg.locator('#spFac').check()
        await pg.wait_for_function("UDS.SitePick.st.pv && !UDS.SitePick.st.step", timeout=15000)
        await pg.locator('#spGo').click()
        await pg.wait_for_function("!document.querySelector('.dlg.site')", timeout=15000)
        await pg.wait_for_timeout(600)
        check('facade on in picker -> facade mode', await ev("UDS.app.state.ctxMode") == 'fac')

        # ---------- 8) v24까지 만든 대상지(rd 없음): 지금 도로로 판단 ----------
        old = await ev("""(() => { const a = UDS.app, cx = { ...a.ctx }; delete cx.rd; a.ctx = cx; a._facM = null; a.derive(); const m = a.ctxFac(); return { n: m ? m.size : 0, shop: m ? m.get('b-shop').t : null }; })()""")
        check('older site without road snapshot still gets facades', old['n'] == 5 and old['shop'] == 'shop', old)

        await pg.screenshot(path=OUTD + '/v22_site.png')
        check('no page errors', not logs, logs[:5])
        await b.close()
    print('ALL PASS' if not fails else 'SOME FAILED: ' + ', '.join(fails))
    sys.exit(1 if fails else 0)


asyncio.run(main())
