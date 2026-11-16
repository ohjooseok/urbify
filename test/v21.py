"""v21: 지도에서 대상지 고르기 + 인증키 없는 공개 지도 자료(Overture Maps PMTiles) — 시험 자료는 test/gen_ovt.py가 만든 타일.
PMTiles 읽기(범위 요청)·MVT 풀기·건물 속성 옮기기(층수·높이·어림)·타일 경계 건물·도로 잇기·양방향 차도 합치기·회전교차로,
대화상자(지도·장소 찾기·범위·미리 보기)·대상지 만들기·현황 건물 층수 고치기·되돌리기·높이 근거 표현·저장(IndexedDB)·다시 열기·다크/라이트"""
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

        # ---------- 1) 자료 읽기(대화상자 없이) ----------
        r = await ev("""async () => {
          const O = UDS.Ovt, X = UDS.Ctx, F = X.frame(36.6012, 127.2975, 500, 500);
          const raw = await O.fetchArea(X.bbox(F, 45), {});
          const B = X.buildings(raw.bld, F), S = O.streets(raw.segs, F);
          const by = (id) => B.find((b) => b.id === id) || {};
          const F2 = X.frame(36.6012 + 300 / F.mLat, 127.2975 + 1100 / F.mLon, 300, 300);
          const raw2 = await O.fetchArea(X.bbox(F2, 45), {});
          const S2 = O.streets(raw2.segs, F2);
          return { rel: raw.rel, nb: raw.bld.length, ids: raw.bld.map((f) => f.id).sort(), inSite: B.length,
            apt: [by('b-apt').fl, by('b-apt').est, by('b-apt').nm, by('b-apt').cat], house: [by('b-house').fl, by('b-house').est, by('b-house').cat],
            shop: [by('b-shop').fl, by('b-shop').h, by('b-shop').est], none: [by('b-none').fl, by('b-none').est], school: [by('b-school').fl, by('b-school').parts[0].h.length, by('b-school').cat],
            streets: S.streets.map((s) => s.name || s.cls).sort(), dual: S.dual, rabs: S.rabs, sn: S.streets.filter((s) => s.name === '새내로').map((s) => [Math.round(s.len), s.w, s.dual]),
            seamB: raw2.bld.filter((f) => f.id === 'b-seam').length, seamLen: S2.streets.map((s) => Math.round(s.len)), tiles2: raw2.tiles,
            tid: [O.tileId(0, 0, 0), O.tileId(1, 0, 0), O.tileId(1, 0, 1), O.tileId(1, 1, 1), O.tileId(1, 1, 0)].join(',') };
        }""")
        print('data:', json.dumps(r, ensure_ascii=False))
        check('pmtiles hilbert tile ids', r['tid'] == '0,1,2,3,4')
        check('latest release from catalog', r['rel'] == '2026-10-21.0')
        check('underground building excluded', 'b-under' not in r['ids'] and r['nb'] == 6, r['ids'])
        check('apartments: floors from data', r['apt'][0] == 15 and r['apt'][1] == 'h' and r['apt'][2] == '102동' and r['apt'][3] == 'res', r['apt'])
        check('house: floors guessed from use/area', r['house'] == [2, 'g', 'res'], r['house'])
        check('shop: floors from height', r['shop'][0] == 3 and abs(r['shop'][1] - 12.5) < 0.01 and r['shop'][2] == 'fl', r['shop'])
        check('unknown building guessed', r['none'] == [3, 'g'], r['none'])
        check('school courtyard hole kept', r['school'][1] == 1 and r['school'][2] == 'pub', r['school'])
        check('dual carriageway merged into one centerline', r['dual'] == 2 and r['sn'] and r['sn'][0][0] == 500 and r['sn'][0][2] == 1 and r['sn'][0][1] >= 15, r['sn'])
        check('roundabout detected', len(r['rabs']) == 1 and abs(r['rabs'][0]['p'][0] - 400) < 1 and abs(r['rabs'][0]['p'][1] - 250) < 1 and 30 <= r['rabs'][0]['d'] <= 38, r['rabs'])
        check('footway/parking aisle/tunnel/stub dropped', not any(n in ('footway', '지하차도') for n in r['streets']) and r['streets'].count('service') == 1, r['streets'])
        check('building across tile seam kept once', r['seamB'] == 1 and r['tiles2'] == 2)
        check('road across tile seam joined', r['seamLen'] == [300], r['seamLen'])

        # ---------- 2) 대화상자: 지도·장소 찾기·범위·미리 보기 ----------
        await pg.locator('.top .mbar [data-arg="project"]').click(); await pg.wait_for_timeout(200)
        await pg.locator('#pop [data-act="realopen"]').click()
        await pg.wait_for_timeout(300)
        check('site dialog opened', await ev("!!document.querySelector('.dlg.site') && document.querySelector('#dialog .dh2 b').textContent === '지도에서 대상지 고르기'"))
        try:
            await pg.wait_for_selector('#spMap canvas.maplibregl-canvas', timeout=15000)
            ok_map = True
        except Exception:
            ok_map = False
        check('map (MapLibre from vendor) rendered', ok_map, await ev("typeof maplibregl"))
        await pg.wait_for_timeout(800)
        await pg.fill('#spQi', '조치원역')
        await pg.press('#spQi', 'Enter')
        await pg.wait_for_selector('#spRes button', timeout=5000)
        check('search results listed', await ev("document.querySelectorAll('#spRes button').length") == 2, await ev("document.querySelector('#spRes').innerText.replace(/\\n/g,' ')"))
        await pg.locator('#spRes button').first.click()
        await pg.wait_for_timeout(300)
        await pg.locator('[data-sp-size="500"]').click()
        await pg.wait_for_function("UDS.SitePick.st.pv && !UDS.SitePick.st.step", timeout=15000)
        st = await ev("(() => { const s = UDS.SitePick.st; return { lat: s.lat, lon: s.lon, W: s.W, H: s.H, name: s.name, nb: s.pv && s.pv.bld.length, ns: s.pv && s.pv.streets.length, nr: s.pv && s.pv.rabs.length }; })()")
        print('picker:', st)
        check('search moved the site', abs(st['lat'] - 36.6012) < 1e-4 and abs(st['lon'] - 127.2975) < 1e-4 and st['name'] == '조치원역', st)
        stt = await ev("document.querySelector('#spSt').innerText.replace(/\\n/g,' | ')")
        print('status:', stt)
        check('preview counts in panel', '건물' in stt and '5동' in stt and '도로' in stt and '회전교차로 1' in stt, stt)
        info = await ev("document.querySelector('#spInfo').textContent")
        check('site info (center, area)', '36.60120' in info and '25.0ha' in info, info)
        if ok_map:
            nfeat = await ev("(async () => { const m = UDS.SitePick.pick.map; const out = []; for (const k of ['sp-bld','sp-road','sp-rab','sp-site','sp-mask']) { const s = m.getSource(k); const d = s ? await s.getData() : null; out.push(d ? d.features.length : 0); } return out; })()")
            msz = await ev("(() => { const c = UDS.SitePick.pick.map.getCanvas(); return [c.clientWidth, c.clientHeight]; })()")
            check('map canvas fills the map pane', msz[0] > 600 and msz[1] > 500, msz)
            check('preview layers on map', nfeat[0] == 5 and nfeat[1] >= 8 and nfeat[2] == 1 and nfeat[3] == 1 and nfeat[4] == 1, nfeat)
        await pg.screenshot(path=OUTD + '/v21_picker_dark.png')
        # 브이월드를 고르면 인증키 칸이 보이고 키 없이는 만들 수 없음
        await pg.locator('input[name="spSrc"][value="vw"]').check(); await pg.wait_for_timeout(150)
        check('vworld source shows key fields; build disabled without key', await ev("!document.querySelector('#spVw').hidden && document.querySelector('#spGo').disabled"))
        await pg.locator('input[name="spSrc"][value="ovt"]').check(); await pg.wait_for_timeout(600)
        check('class source hidden without data/sites.json', await ev("document.querySelector('#spClassL').hidden"))

        # ---------- 3) 대상지 만들기 ----------
        await pg.locator('#spGo').click()
        await pg.wait_for_function("!document.querySelector('.dlg.site')", timeout=15000)
        await pg.wait_for_timeout(800)
        prj = await ev("""(() => { const a = UDS.app, cx = a.ctxData(); return { title: a.P.meta.title, site: a.P.site, roads: a.P.roads.length, names: a.P.roads.map((r) => r.name), rabs: (a.P.rabouts || []).length, drabs: a.D.rabs.length, bld: cx && cx.bld.length, src: cx && cx.src, attr: cx && cx.attr, blocks: a.D.blocks.length, est: cx && cx.bld.filter((b) => b.est === 'g').length, mapGone: !UDS.SitePick.pick.map }; })()""")
        print('project:', json.dumps(prj, ensure_ascii=False))
        check('project title from searched place', prj['title'] == '조치원역 일대', prj['title'])
        check('site size', prj['site'] == {'w': 500, 'h': 500})
        check('roads from centerlines with names', prj['roads'] >= 8 and '새내로' in prj['names'] and any(n.startswith('조치원로') for n in prj['names']), prj['names'])
        check('roundabout placed', prj['rabs'] == 1 and prj['drabs'] == 1, (prj['rabs'], prj['drabs']))
        check('context buildings + source label', prj['bld'] == 5 and 'Overture' in prj['src'] and 'OpenStreetMap' in (prj['attr'] or ''), prj['src'])
        check('blocks formed by imported roads', prj['blocks'] >= 6, prj['blocks'])
        check('map released after closing', prj['mapGone'])
        toast = await ev("document.querySelector('#toast').textContent")
        check('toast mentions guessed floors', '어림' in toast and '5동' in toast, toast)
        await pg.screenshot(path=OUTD + '/v21_site.png')

        # ---------- 4) 현황 건물 층수 고치기 · 되돌리기 · 높이 근거 ----------
        await ev("(() => { const a = UDS.app; a.state.sel = { type: 'ctx', id: 'b-house' }; a.state.tab = 'props'; UDS.ui.pane(); })()")
        await pg.wait_for_timeout(200)
        pane = await ev("document.querySelector('#pane').innerText")
        check('ctx pane shows guess note and floor editor', '용도와 건축면적으로' in pane and '지상 층수 고치기' in pane, pane[:200])
        inp = pg.locator('#pane input[data-k="지상 층수"]')
        await inp.fill('7'); await inp.dispatch_event('change'); await pg.wait_for_timeout(500)
        fx = await ev("(() => { const b = UDS.app.ctxBld('b-house'); return [b.fl, b.h, b.fix, JSON.stringify(UDS.app.P.ctx.fl)]; })()")
        check('floors edited (height recomputed, marked fixed)', fx[0] == 7 and abs(fx[1] - (7 * 2.9 + 0.4)) < 0.05 and fx[2] == 1, fx)
        h3 = await ev("UDS.app.D.ctxData.bld.find((b) => b.id === 'b-house').h")
        check('derived data sees edited height', abs(h3 - 20.7) < 0.05, h3)
        await ev("UDS.app.state.ctxMode = 'est'; UDS.ui.pane()")
        await ev("(() => { const a = UDS.app; a.state.sel = null; UDS.ui.pane(); })()")
        await pg.wait_for_timeout(200)
        leg = await ev("[...document.querySelectorAll('.cxleg span')].map((s) => s.innerText.replace(/\\n/g, ' '))")
        check('height-basis legend', any('직접 고침' in t and t.strip().endswith('1') for t in leg) and any('어림(용도·면적)' in t and t.strip().endswith('2') for t in leg), leg)
        await ev("UDS.app.undo()"); await pg.wait_for_timeout(300)
        fx2 = await ev("(() => { const b = UDS.app.ctxBld('b-house'); return [b.fl, !!b.fix]; })()")
        check('undo restores floors', fx2 == [2, False], fx2)
        await ev("UDS.app.redo()"); await pg.wait_for_timeout(300)
        await ev("UDS.app.saveNow ? UDS.app.saveNow() : null"); await pg.wait_for_timeout(600)

        # ---------- 5) 다시 열기: localStorage · IndexedDB ----------
        await pg.reload(); await pg.wait_for_timeout(1500)
        rr = await ev("(() => { const a = UDS.app, cx = a.ctxData(); return { title: a.P.meta.title, bld: cx && cx.bld.length, fl: cx && a.ctxBld('b-house').fl }; })()")
        check('reopen restores context and floor edit', rr == {'title': '조치원역 일대', 'bld': 5, 'fl': 7}, rr)
        await ev("localStorage.removeItem('uds.sandbox.v1.ctx')")
        await pg.reload(); await pg.wait_for_timeout(600)
        try: await pg.wait_for_function("!!(UDS.app && UDS.app.ctxData())", timeout=10000)
        except Exception: pass
        rr2 = await ev("(() => { const a = UDS.app, cx = a.ctxData(); return { bld: cx && cx.bld.length, fl: cx && a.ctxBld('b-house').fl, toast: document.querySelector('#toast').textContent }; })()")
        check('context restored from IndexedDB when localStorage lacks it', rr2['bld'] == 5 and rr2['fl'] == 7, rr2)

        # ---------- 5b) 수업 대상지 자료(data/sites.json + 묶음 파일): 페이지의 fetch를 바꿔 브이월드 꼴 시험 자료를 돌려준다 ----------
        TD = pathlib.Path(TESTD, 'data')
        bt = (TD / 'vw_bld.js').read_text(encoding='utf-8'); bj = json.loads(bt[bt.index('{'):bt.rindex('}') + 1])
        pj = json.loads((TD / 'vw_par.json').read_text(encoding='utf-8'))
        bundle = {'src': '시험 수업 자료', 'date': '2026-11-01', 'bld': {'type': 'FeatureCollection', 'features': bj['features']}, 'par': {'type': 'FeatureCollection', 'features': pj['features']}}
        sites = [{'id': 'test', 'name': '안암 시험 대상지', 'bbox': [127.020, 37.580, 127.045, 37.600], 'center': [37.5894, 127.0323], 'file': 'data/test.json', 'src': '시험 수업 자료'}]
        await ev("([S, B]) => { const rf = window.fetch; window.fetch = (u, o) => { const s = String(u); if (s.endsWith('data/sites.json')) return Promise.resolve(new Response(JSON.stringify(S))); if (s.endsWith('data/test.json')) return Promise.resolve(new Response(JSON.stringify(B))); return rf(u, o); }; UDS.SitePick.resetSites(); }", [sites, bundle])
        await ev("UDS.ui.siteDialog()")
        await pg.wait_for_function("UDS.SitePick.st.sites && UDS.SitePick.st.sites.length === 1", timeout=8000)
        check('class source listed with a jump link', await ev("!document.querySelector('#spClassL').hidden && !!document.querySelector('[data-sp-goto]')"))
        await pg.locator('[data-sp-goto="0"]').click(); await pg.wait_for_timeout(600)
        await pg.locator('[data-sp-size="400"]').click(); await pg.wait_for_timeout(200)
        check('class radio enabled inside the bundle area', await ev("!document.querySelector('input[value=\"class\"]').disabled"))
        await pg.locator('input[name="spSrc"][value="class"]').check()
        await pg.wait_for_function("UDS.SitePick.st.pv && UDS.SitePick.st.pv.kind === 'class' && !UDS.SitePick.st.step", timeout=15000)
        stc = await ev("document.querySelector('#spSt').innerText.split(String.fromCharCode(10)).join(' | ')")
        check('class preview (buildings + parcels)', '건물' in stc and '지적' in stc and '필지' in stc, stc)
        await pg.locator('#spGo').click()
        await pg.wait_for_function("!document.querySelector('.dlg.site')", timeout=20000)
        await pg.wait_for_timeout(600)
        cl = await ev("(() => { const a = UDS.app, cx = a.ctxData(); return { title: a.P.meta.title, bld: cx && cx.bld.length, par: cx && cx.par.length, roads: a.P.roads.length, src: cx && cx.src }; })()")
        check('project from class bundle (VWorld-format buildings, parcel roads)', cl['bld'] > 20 and cl['par'] > 20 and cl['roads'] > 3 and cl['src'] == '시험 수업 자료' and cl['title'] == '안암 시험 대상지 일대', cl)
        await ev("UDS.SitePick.st.src = 'ovt'; localStorage.setItem('uds.site', JSON.stringify({ lat: 36.6012, lon: 127.2975, z: 16, W: 500, H: 500, src: 'ovt' })); UDS.SitePick.st.lat = 36.6012; UDS.SitePick.st.lon = 127.2975; UDS.SitePick.st.W = UDS.SitePick.st.H = 500;")

        # ---------- 6) 라이트 테마 · 자료를 받지 못할 때 ----------
        await ev("UDS.TH.set('light')")
        await pg.locator('.top .mbar [data-arg="project"]').click(); await pg.wait_for_timeout(200)
        await pg.locator('#pop [data-act="realopen"]').click()
        await pg.wait_for_function("UDS.SitePick.st.pv && !UDS.SitePick.st.step", timeout=15000)
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUTD + '/v21_picker_light.png')
        await ev("document.querySelector('[data-act=\"closedlg\"]').click()")
        ctx2 = await b.new_context(viewport={"width": 1200, "height": 800})
        await routes(ctx2, broken=True)
        pg2 = await ctx2.new_page()
        await pg2.goto(URL); await pg2.wait_for_timeout(1000)
        await pg2.evaluate("UDS.ui.siteDialog()")
        await pg2.wait_for_function("!!UDS.SitePick.st.err", timeout=15000)
        err = await pg2.evaluate("document.querySelector('#spSt').innerText")
        check('fetch failure reported in panel', len(err) > 4, err)
        # 좁은 화면(휴대폰)
        ctx3 = await b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
        await routes(ctx3)
        pg3 = await ctx3.new_page()
        await pg3.goto(URL); await pg3.wait_for_timeout(1000)
        await pg3.evaluate("UDS.ui.siteDialog()")
        await pg3.wait_for_function("UDS.SitePick.st.pv && !UDS.SitePick.st.step", timeout=15000)
        mh = await pg3.evaluate("Math.round(document.querySelector('.spmap').getBoundingClientRect().height)")
        check('phone layout: map on top', mh > 300, mh)
        await pg3.screenshot(path=OUTD + '/v21_picker_phone.png')

        bad = [l for l in logs if 'Failed to load resource' not in l]
        check('no page errors', not bad, bad[:3])
        await b.close()
    print('ALL PASS' if not fails else f'SOME FAILED: {fails}')
    sys.exit(1 if fails else 0)

asyncio.run(main())
