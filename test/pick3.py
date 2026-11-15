import asyncio, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        pg = await b.new_page(viewport={"width":1280,"height":800})
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        # 가로수 수관 한가운데를 화면 좌표로 구해 눌렀을 때 그 도로가 잡히는지, 자유 배치 나무는 나무로 잡히는지
        r = await pg.evaluate("""(()=>{const a=UDS.app, r3=a.r3; const t=a.D.trees.find(t=>t.roadId); const sp=UDS.C.TREES[t.species];
          const {VP}=r3.matrices(); const y=sp.clear+(sp.height-sp.clear)/2; const v=[t.x,y,-t.y,1];
          const c=[0,1,2,3].map(i=>VP[i]*v[0]+VP[4+i]*v[1]+VP[8+i]*v[2]+VP[12+i]*v[3]);
          const sx=(c[0]/c[3]*0.5+0.5)*r3.cssW, sy=(1-(c[1]/c[3]*0.5+0.5))*r3.cssH;
          const hit=r3.pickAt(sx,sy); const gl=r3.gl; return {tree:[t.x,t.y,t.roadId], screen:[Math.round(sx),Math.round(sy)], hit, glErr:gl.getError(), leaf:r3.meshes.leaf.count, sizes:Object.values(UDS.C.TREES).map(s=>s.crown+'/'+s.height)}})()""")
        print(json.dumps(r, ensure_ascii=False))
        print("errors:", logs or "none")
        await b.close()
asyncio.run(main())
