import asyncio, json, sys
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
async def main(mobile=False):
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        vp = {"width":390,"height":780} if mobile else {"width":1440,"height":900}
        ctx = await b.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, has_touch=mobile, is_mobile=mobile)
        pg = await ctx.new_page()
        logs=[]
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        pg.on("console", lambda m: logs.append(m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        ev = pg.evaluate
        tag = 'm' if mobile else 'd'
        # 지도 캡처는 [프로젝트 → 새 프로젝트]에서(계획 패널의 대상지 목록에서는 뺐다)
        await ev("document.querySelector('.mb[data-act=\"menu\"][data-arg=\"project\"]').click()")
        await pg.wait_for_timeout(250)
        await ev("document.querySelector('#pop [data-act=\"newproject\"]').click()")
        await pg.wait_for_timeout(250)
        await ev("document.querySelector('[data-new=\"import\"]').click()")
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f"{OUTD}/imp_{tag}0.png")
        await pg.set_input_files('#impFile', str(pathlib.Path(TESTD, 'maps', 'phone.png')))
        await pg.wait_for_timeout(1500)
        print("sum1:", (await ev("document.getElementById('impSum').innerText")).replace("\n"," | "))
        print("crop:", await ev("(()=>{const c=document.getElementById('impCv'); return [c.width,c.height]})()"), "go disabled:", await ev("document.getElementById('impGo').disabled"))
        # 축척 두 점: 축척 막대 양 끝 (820,1060)-(1010,1060) of 1080x1500 → 100m
        cvb = await pg.locator('#impCv').bounding_box()
        if mobile: await pg.locator('[data-imp-mode="scale"]').tap()
        else: await pg.click('[data-imp-mode="scale"]')
        for (fx,fy) in [(820/1080,1060/1500),(1010/1080,1060/1500)]:
            x=cvb['x']+fx*cvb['width']; y=cvb['y']+fy*cvb['height']
            await pg.mouse.click(x,y); await pg.wait_for_timeout(150)
        await pg.wait_for_timeout(300)
        await pg.fill('#impD', '100'); await pg.dispatch_event('#impD','change'); await pg.wait_for_timeout(1200)
        print("sum2:", (await ev("document.getElementById('impSum').innerText")).replace("\n"," | "))
        print("W field:", await ev("document.getElementById('impW').value"))
        await pg.screenshot(path=f"{OUTD}/imp_{tag}1.png")
        await pg.select_option('#impType', 'oldtown'); await pg.wait_for_timeout(900)
        await pg.click('#impGo'); await pg.wait_for_timeout(2500)
        print("after build:", await ev("(()=>{const a=UDS.app; return {scene:a.P.meta.scene, title:a.P.meta.title, site:a.P.site, roads:a.P.roads.length, blocks:a.D.blocks.length, lots:a.D.lots.length, bld:a.D.buildings.length, underlay:!!a.underlay, dlg:!document.getElementById('dialog').hidden, sec:(a.secRoad()||{}).name}})()"))
        await pg.screenshot(path=f"{OUTD}/imp_{tag}2.png")
        if not mobile:
            await ev("(()=>{const a=UDS.app; a.state.layers.underlay=true; a.invalidate(7)})()"); await pg.wait_for_timeout(400)
            await pg.screenshot(path=f"{OUTD}/imp_{tag}3.png")
            # 편집이 되는지: 도로 하나 지우고 되돌리기
            print("edit:", await ev("(()=>{const a=UDS.app; const n=a.P.roads.length; a.eraseAt({type:'road',id:a.P.roads[3].id}); const n2=a.P.roads.length; a.undo(); return [n,n2,a.P.roads.length,a.D.blocks.length]})()"))
        print("errors:", logs[:6] or "none")
        await b.close()
asyncio.run(main(len(sys.argv)>1))
