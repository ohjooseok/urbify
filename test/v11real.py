"""v11: 실제 지역 불러오기(브이월드 자료 꼴의 가상 자료로) — 붙여 넣기·파일·오류·1,000건 상한 분할, 현황 건물 2D/3D, 선택·지우기·되돌리기,
건물 놓기로 철거, 표현 방식, 저장·다시 열기"""
import asyncio, json, pathlib
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--allow-file-access-from-files"]
D = pathlib.Path(TESTD, 'data')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        pg = await ctx.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type in ("error", "warning") and "GPU stall" not in m.text and "fonts.g" not in m.text and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: " + str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)
        ev = pg.evaluate
        toast = "(document.querySelector('#toast')||{}).textContent"
        st = "(document.querySelector('#rlSt')||{}).innerText"
        async def paste(text):
            await ev("""(t) => { const ta = document.querySelector('#rlPaste'); const dt = new DataTransfer(); dt.setData('text/plain', t); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""", text)
            await pg.wait_for_timeout(250)
        # 위치 읽기
        print("parseLoc:", await ev("""[
          UDS.Ctx.parseLoc('37.5894, 127.0323'), UDS.Ctx.parseLoc('127.0323 37.5894'),
          UDS.Ctx.parseLoc("37°35'21.8\\"N 127°01'56.3\\"E"),
          UDS.Ctx.parseLoc('https://www.google.com/maps/@37.5893872,127.0322761,17z'),
          UDS.Ctx.parseLoc('https://map.naver.com/p?c=14140912.0123,4520000.5,15,0,0,0,dh'),
          UDS.Ctx.parseLoc('https://map.naver.com/p/entry/place/1?lng=127.0323&lat=37.5894'),
          UDS.Ctx.parseLoc('서울 성북구')].map(x => x ? x.lat.toFixed(4) + ',' + x.lon.toFixed(4) : null)"""))
        # 1) 프로젝트 메뉴 → 실제 지역 불러오기
        await pg.locator('.top .mbar [data-arg="project"]').click(); await pg.wait_for_timeout(250)
        check_map = await ev("!!document.querySelector('#pop [data-act=\"realopen\"]')")
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        await ev("UDS.ui.realDialog()"); await pg.wait_for_timeout(400)  # 붙여 넣기 방식(지도에서 고르기의 [받은 자료 붙여 넣기로 열기])
        print("project menu has real-area item:", check_map)
        print("dialog:", await ev("document.querySelector('#dialog .dh2 b').textContent"), "| sandbox mode (no direct button):", await ev("!document.querySelector('#rlFetch')"))
        print("req before input:", await ev("document.querySelector('#rlReq').innerText"))
        await pg.fill('#rlLoc', 'https://www.google.com/maps/@37.5894,127.0323,17z')
        await pg.locator('[data-rl-size="400"]').click()
        await pg.fill('#rlKey', 'TESTKEY-1234')
        await pg.fill('#rlDom', 'http://localhost')
        await pg.wait_for_timeout(200)
        print("loc out:", await ev("document.querySelector('#rlLocOut').textContent"))
        hrefs = await ev("[...document.querySelectorAll('#rlReq a')].map(a => a.href)")
        print("links:", len(hrefs), "| target/rel:", await ev("[...document.querySelectorAll('#rlReq a')].map(a => a.target + '/' + a.rel).join(' ')"))
        print("bld url:", hrefs[0][:60], '…', 'bbox=' + hrefs[0].split('bbox=')[1].split('&')[0], '| has key:', 'key=TESTKEY-1234' in hrefs[0], '| domain:', 'domain=http%3A%2F%2Flocalhost' in hrefs[0], '| typename dt_d010:', 'dt_d010' in hrefs[0], '| par dt_d002:', 'dt_d002' in hrefs[1])
        print("go disabled before data:", await ev("document.querySelector('#rlGo').disabled"))
        # 오류(XML) 붙여 넣기
        await paste((D / 'vw_err.xml').read_text(encoding='utf-8'))
        print("xml error →", (await ev(st)).split('\n')[0])
        await paste('{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"foo":1},"geometry":null}]}')
        print("wrong data →", (await ev(st)).split('\n')[0])
        await paste('{"type":"FeatureCollection","features":[{"type":"Fea')
        print("cut text →", (await ev(st)).split('\n')[0])
        # 건물: 붙여 넣기(JSONP로 감싼 글), 지적: 파일
        await paste((D / 'vw_bld.js').read_text(encoding='utf-8'))
        await pg.locator('#rlFile').set_input_files(str(D / 'vw_par.json'))
        await pg.wait_for_timeout(600)
        print("status:", (await ev(st)).replace('\n', ' | '))
        print("received chips:", await ev("[...document.querySelectorAll('#rlReq .rlok')].map(x => x.textContent)"), "| go enabled:", not await ev("document.querySelector('#rlGo').disabled"), "| roads checkbox enabled:", not await ev("document.querySelector('#rlRoads').disabled"))
        await pg.screenshot(path=OUTD + "/v11_dialog.png")
        # 대상지 만들기
        await pg.locator('#rlGo').click(); await pg.wait_for_timeout(2500)
        info = await ev("""(() => { const a = UDS.app, cx = a.ctxData(); return { scene: a.P.meta.scene, title: a.P.meta.title, site: a.P.site, lat: a.P.settings.lat, bld: cx && cx.bld.length, par: cx && cx.par.length, roads: a.P.roads.length, blocks: a.D.blocks.length, lots: a.D.lots.length, designB: a.D.buildings.length, est: cx && cx.bld.filter(b => b.est).length, holes: cx && cx.bld.filter(b => b.parts.some(p => p.h.length)).length, multi: cx && cx.bld.filter(b => b.parts.length > 1).length, demo: a.D.ctxV.demo.size, defUse: a.P.meta.defaultUse, saved: a._ctxSaved }; })()""")
        print("project:", info)
        print("toast:", await ev(toast))
        print("road names:", await ev("UDS.app.P.roads.slice(0, 8).map(r => r.name + ' ' + UDS.Derive.layout(r).W + 'm').join(', ')"))
        print("est kinds:", await ev("UDS.app.ctxData().bld.reduce((m, b) => (m[b.est || 'none'] = (m[b.est || 'none'] || 0) + 1, m), {})"))
        print("cats:", await ev("UDS.app.ctxData().bld.reduce((m, b) => (m[b.cat] = (m[b.cat] || 0) + 1, m), {})"))
        sample = await ev("(() => { const b = UDS.app.ctxData().bld.find(x => x.nm === '안암초등학교'); return b && { fl: b.fl, h: b.h, holes: b.parts[0].h.length, cat: b.cat, pc: b.pc, y: b.y }; })()")
        print("school:", sample)
        await pg.screenshot(path=OUTD + "/v11_site.png")
        # 지적 경계가 도로 필지를 따라 도로가 났는가: 도로 필지 중심이 도로 띠 안에 드는 비율
        print("road fit:", await ev("""(() => { const a = UDS.app, cx = a.ctxData(); const rp = cx.par.filter(q => q.jm === '도'); let hit = 0, n = 0;
            rp.forEach(q => q.parts.forEach(pt => { const c = UDS.U.polyCentroid(pt.o); if (c[0] < 5 || c[1] < 5 || c[0] > 395 || c[1] > 395) return; n++; if (a.P.roads.some(r => { const W = UDS.Derive.layout(r).W; for (let i = 0; i + 1 < r.pts.length; i++) if (UDS.U.distPointSeg(c, r.pts[i], r.pts[i + 1]).d < W / 2 + 1.5) return true; return false; })) hit++; }));
            return hit + '/' + n; })()"""))
        # 2) 현황 건물 고르기(평면)
        pt = await ev("""(() => { const a = UDS.app, cx = a.ctxData(); const b = cx.bld.find(x => !x.nm && x.fl >= 3 && x.c[0] > 120 && x.c[0] < 280 && x.c[1] > 120 && x.c[1] < 280) || cx.bld[0]; a.state.pickedCtx = b.id; const r = a.r2.cv.getBoundingClientRect(); const q = a.r2.w2s(b.c); return [r.left + q[0], r.top + q[1], b.id]; })()""")
        await pg.mouse.click(pt[0], pt[1]); await pg.wait_for_timeout(400)
        print("selected:", await ev("JSON.stringify(UDS.app.state.sel)"), "| pane:", await ev("document.querySelector('#pane .phead .pt').innerText.replace(/\\n/g,' / ')"))
        print("pane stats:", await ev("[...document.querySelectorAll('#pane .stat')].map(s => s.innerText.replace(/\\n/g,' ')).join(' | ')"))
        print("pane kv:", await ev("[...document.querySelectorAll('#pane .tb.kv tr')].map(t => t.innerText.replace(/\\t/g,': ')).join(' | ')"))
        await pg.screenshot(path=OUTD + "/v11_sel.png")
        # 3D에서 같은 건물 집기
        r3 = await ev("""(() => { const a = UDS.app, b = a.ctxBld(a.state.pickedCtx); a.r3.focus(b.c, 140); a.r3.cam.pitch = 1.45; a.r3.draw(); const vp = a.r3.matrices().VP; const p = [b.c[0], b.h * 0.6, -b.c[1], 1]; const m = vp; const x = m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], y = m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], w = m[3]*p[0]+m[7]*p[1]+m[11]*p[2]+m[15]; const W = a.r3.cv.width, H = a.r3.cv.height; const sx = (x / w * 0.5 + 0.5) * W, sy = (1 - (y / w * 0.5 + 0.5)) * H; const hit = a.r3.pickAt(sx, sy); return hit && hit.type + ':' + (hit.id === b.id); })()""")
        print("3D pick:", r3)
        # 지우기 → 되돌리기
        await pg.locator('#pane [data-act="ctxdel"]').click(); await pg.wait_for_timeout(400)
        print("after erase: off", await ev("UDS.app.P.ctx.off.length"), "| sel:", await ev("JSON.stringify(UDS.app.state.sel)"), "| toast:", await ev(toast))
        print("site pane has restore:", await ev("!!document.querySelector('#pane [data-act=\"ctxrestore\"]')"))
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(400)
        print("after undo: off", await ev("UDS.app.P.ctx.off.length"))
        # 3) 표현 방식: 층수 → 범례
        await ev("UDS.app.select(null)"); await pg.wait_for_timeout(200)
        await pg.locator('#pane [data-act="ctxmode"][data-arg="floor"]').click(); await pg.wait_for_timeout(500)
        print("mode:", await ev("UDS.app.state.ctxMode"), "| legend:", await ev("[...document.querySelectorAll('#pane .cxleg span')].map(s => s.innerText.replace(/\\n/g,' ')).join(' / ')"))
        print("summary:", await ev("document.querySelector('#pane .cxsum').innerText.replace(/\\n/g,' / ')"))
        await pg.screenshot(path=OUTD + "/v11_floor.png")
        await pg.locator('#pane [data-act="ctxmode"][data-arg="age"]').click(); await pg.wait_for_timeout(400)
        print("age legend:", await ev("[...document.querySelectorAll('#pane .cxleg span')].map(s => s.innerText.replace(/\\n/g,' ')).join(' / ')"))
        await pg.screenshot(path=OUTD + "/v11_age.png")
        await pg.locator('#pane [data-act="ctxmode"][data-arg="use"]').click(); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUTD + "/v11_use.png")
        # 보기 메뉴에도 표현 방식
        await pg.locator('.top .mbar [data-arg="view"]').click(); await pg.wait_for_timeout(250)
        print("view menu ctx items:", await ev("[...document.querySelectorAll('#pop [data-act=\"ctxmode\"]')].map(b => b.innerText.trim() + (b.getAttribute('aria-checked') === 'true' ? '✓' : '')).join(' ')"))
        await pg.keyboard.press("Escape")
        await ev("UDS.app.state.ctxMode = 'gray'; UDS.app.rebuild3d(); UDS.app.invalidate(7); UDS.ui.pane();")
        # 4) 건물 놓기: 현황 건물이 선 획지를 누르면 그 획지의 현황 건물은 철거
        await ev("UDS.app.setTool('build', 'mixed')")
        pt2 = await ev("""(() => { const a = UDS.app; const b = a.ctxBld(a.state.pickedCtx); const r = a.r2.cv.getBoundingClientRect(); const q = a.r2.w2s(b.c); return [r.left + q[0], r.top + q[1]]; })()""")
        d0 = await ev("UDS.app.D.ctxV.demo.size")
        await pg.mouse.click(pt2[0], pt2[1]); await pg.wait_for_timeout(600)
        print("build on ctx: design buildings", await ev("UDS.app.D.buildings.length"), "| demolished", d0, "→", await ev("UDS.app.D.ctxV.demo.size"), "| picked hidden:", await ev("!UDS.app.ctxShown(UDS.app.state.pickedCtx)"), "| toast:", await ev(toast))
        await ev("UDS.app.setTool('select')"); await ev("UDS.app.select(null)"); await pg.wait_for_timeout(300)
        print("summary after build:", await ev("document.querySelector('#pane .cxsum').innerText.replace(/\\n/g,' / ')"))
        await ev("(() => { const a = UDS.app, b = a.ctxBld(a.state.pickedCtx); a.r2.view.cx = b.c[0]; a.r2.view.cy = b.c[1]; a.r2.view.s = 5; a.invalidate(7); })()"); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUTD + "/v11_demo.png")
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(400)
        print("undo build → demolished", await ev("UDS.app.D.ctxV.demo.size"))
        # 레이어 끄기
        await ev("UDS.app.state.layers.ctx = false; UDS.app.rebuild3d(); UDS.app.invalidate(7)"); await pg.wait_for_timeout(300)
        print("layer off hit:", await ev("(() => { const a = UDS.app, b = a.ctxData().bld[5]; return JSON.stringify(a.r2.hitTest(a.r2.w2s(b.c))); })()"))
        await ev("UDS.app.state.layers.ctx = true; UDS.app.rebuild3d(); UDS.app.invalidate(7)")
        # 선 도면
        await ev("UDS.ui.setMode('line')"); await pg.wait_for_timeout(500)
        await ev("UDS.app.fitAll(); UDS.app.invalidate(7)"); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUTD + "/v11_line.png")
        await ev("UDS.ui.setMode('color')"); await pg.wait_for_timeout(300)
        # SVG 내보내기에 현황 건물이 들어가는가
        print("svg has paths:", await ev("(() => { const s = UDS.app.r2.exportSVG(); return [s.length, (s.match(/fill-rule=\"evenodd\"/g) || []).length]; })()"))
        # 5) 저장·다시 열기: 작업 파일에 현황 자료가 함께 담김
        js = await ev("JSON.stringify(UDS.app.exportProject())")
        print("export size", len(js), "| has ctxData:", '"ctxData"' in js)
        await ev("(t) => { UDS.app.load(UDS.Model.scenes.standard.make()); }", None); await pg.wait_for_timeout(500)
        print("standard: ctx", await ev("!!UDS.app.ctxData()"), "| ls ctx removed:", await ev("localStorage.getItem('uds.sandbox.v1.ctx') === null"))
        await ev("(t) => { UDS.app.load(JSON.parse(t)); }", js); await pg.wait_for_timeout(800)
        print("reloaded file: ctx bld", await ev("UDS.app.ctxData() && UDS.app.ctxData().bld.length"), "| P has ctxData key:", await ev("'ctxData' in UDS.app.P"))
        # 새로 고침: 브라우저 저장 공간에서 이어서
        await pg.reload(); await pg.wait_for_timeout(1500)
        print("after reload: scene", await ev("UDS.app.P.meta.scene"), "| ctx bld", await ev("UDS.app.ctxData() && UDS.app.ctxData().bld.length"), "| toast:", await ev(toast))
        # 6) 1,000건 상한: 전체 요청이 잘리면 4조각으로
        await ev("UDS.ui.realDialog()"); await pg.wait_for_timeout(300)
        await pg.locator('#rlClear').click(); await pg.wait_for_timeout(100)
        await paste((D / 'vw_dense_full.json').read_text(encoding='utf-8'))
        print("dense full → links", await ev("document.querySelectorAll('#rlReq .rlq:first-child .rll a').length"), "| status:", (await ev(st)).split('\n')[0])
        for k in range(4):
            await paste((D / f'vw_dense_t{k}.json').read_text(encoding='utf-8'))
        print("tiles on:", await ev("[...document.querySelectorAll('#rlReq .rlq:first-child .rll a')].map(a => a.classList.contains('on') ? 1 : 0).join('')"), "| status:", (await ev(st)).split('\n')[1] if '\n' in (await ev(st)) else await ev(st))
        await pg.screenshot(path=OUTD + "/v11_tiles.png")
        await pg.locator('#rlGo').click(); await pg.wait_for_timeout(2000)
        print("dense project: bld", await ev("UDS.app.ctxData().bld.length"), "| roads", await ev("UDS.app.P.roads.length"), "| est h:", await ev("UDS.app.ctxData().bld.filter(b => b.est === 'h').length"))
        # 7) 좁은 화면에서 대화상자
        await pg.set_viewport_size({"width": 390, "height": 844}); await pg.wait_for_timeout(500)
        await ev("UDS.ui.realDialog()"); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUTD + "/v11_mobile.png")
        print("mobile dialog width:", await ev("Math.round(document.querySelector('#dialog .dlg').getBoundingClientRect().width)"))
        print("LOGS:", logs[:12])
        await b.close()
asyncio.run(main())
