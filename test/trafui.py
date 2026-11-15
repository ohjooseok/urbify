import asyncio, json, sys
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
mobile = len(sys.argv)>1 and sys.argv[1]=="m"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width":390 if mobile else 1280,"height":760 if mobile else 800}, device_scale_factor=2 if mobile else 1, has_touch=mobile, is_mobile=mobile)
        pg = await ctx.new_page()
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        st = "(()=>{const a=UDS.app,t=a.traffic; const b=document.querySelector('#v3d [data-act=traffic]'); return {on:a.state.traffic.on, pressed:b.getAttribute('aria-pressed'), barHidden:document.getElementById('trafbar').hidden, ready:t.ready, cars:t.cars.length, peds:t.peds.length, tk:!!a._tk, t:Math.round(t.t*100)/100, out:[document.getElementById('trafPedN').textContent, document.getElementById('trafCarN').textContent]}})()"
        if mobile:
            await pg.evaluate("[...document.querySelectorAll('.mtabs button')].find(x=>/3D/.test(x.textContent)).click()")
            await pg.wait_for_timeout(600)
        print("start   ", json.dumps(await pg.evaluate(st), ensure_ascii=False))
        await pg.evaluate("document.querySelector('#v3d [data-act=traffic]').click()")
        await pg.wait_for_timeout(2500)
        print("on      ", json.dumps(await pg.evaluate(st), ensure_ascii=False))
        # 밀도 조절
        await pg.evaluate("(()=>{const e=document.getElementById('trafPed'); e.value='1'; e.dispatchEvent(new Event('input',{bubbles:true})); const c=document.getElementById('trafCar'); c.value='0.1'; c.dispatchEvent(new Event('input',{bubbles:true}));})()")
        await pg.wait_for_timeout(600)
        print("ped 1 car .1", json.dumps(await pg.evaluate(st), ensure_ascii=False))
        await pg.evaluate("(()=>{const e=document.getElementById('trafPed'); e.value='0'; e.dispatchEvent(new Event('input',{bubbles:true})); const c=document.getElementById('trafCar'); c.value='0'; c.dispatchEvent(new Event('input',{bubbles:true}));})()")
        await pg.wait_for_timeout(400)
        print("both 0  ", json.dumps(await pg.evaluate(st), ensure_ascii=False))
        await pg.evaluate("(()=>{const e=document.getElementById('trafPed'); e.value='0.4'; e.dispatchEvent(new Event('input',{bubbles:true})); const c=document.getElementById('trafCar'); c.value='0.4'; c.dispatchEvent(new Event('input',{bubbles:true}));})()")
        # 편집해도 이어지는지: 도로 폭 변경
        r = await pg.evaluate("(()=>{const a=UDS.app; const before=a.traffic.cars.length; const rd=a.P.roads[5]; rd.segs[0].w+=0.5; a.changed(); return [before,a.traffic.cars.length,a.traffic.peds.length,a.traffic.ready]})()")
        print("after edit (cars before/after, peds, ready):", r)
        # 장면 바꾸기
        r = await pg.evaluate("(()=>{const a=UDS.app; a.setScene('oldtown'); return [a.traffic.cars.length,a.traffic.peds.length,a.traffic.lanes.length,a.traffic.stalls.length]})()")
        print("oldtown (cars, peds, lanes, stalls):", r)
        await pg.wait_for_timeout(800)
        # 선 도면·평면만 보기에서 멈추는지
        if not mobile:
            await pg.evaluate("document.querySelector('[data-view-btn=\"2d\"]').click()")
            await pg.wait_for_timeout(900)
            print("2d only ", json.dumps(await pg.evaluate(st), ensure_ascii=False))
            await pg.evaluate("document.querySelector('[data-view-btn=\"split\"]').click()")
            await pg.wait_for_timeout(900)
            print("split   ", json.dumps(await pg.evaluate(st), ensure_ascii=False))
        else:
            await pg.evaluate("[...document.querySelectorAll('.mtabs button')].find(x=>/평면/.test(x.textContent)).click()")
            await pg.wait_for_timeout(900)
            print("plan tab", json.dumps(await pg.evaluate(st), ensure_ascii=False))
            await pg.evaluate("[...document.querySelectorAll('.mtabs button')].find(x=>/3D/.test(x.textContent)).click()")
            await pg.wait_for_timeout(900)
            print("3d tab  ", json.dumps(await pg.evaluate(st), ensure_ascii=False))
        await pg.evaluate("(()=>{const a=UDS.app; cancelAnimationFrame(a._tk); a._tk=0; const k=a.trafficKick; a.trafficKick=()=>{}; a.r3.draw(); window.__k=k;})()")
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUTD + "/trafui_%s.png" % ("m" if mobile else "d"))
        await pg.evaluate("(()=>{const a=UDS.app; a.trafficKick=window.__k;})()")
        await pg.evaluate("document.querySelector('#v3d [data-act=traffic]').click()")
        await pg.wait_for_timeout(700)
        print("off     ", json.dumps(await pg.evaluate(st), ensure_ascii=False))
        print("errors:", logs or "none")
        await b.close()
asyncio.run(main())
