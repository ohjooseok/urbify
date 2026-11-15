import asyncio, sys, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"]
async def run(b, w, h, mob):
    ctx = await b.new_context(viewport={"width":w,"height":h}, device_scale_factor=2 if mob else 1, has_touch=mob, is_mobile=mob)
    pg = await ctx.new_page()
    logs=[]
    pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
    pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
    await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    await pg.goto(URL)
    await pg.wait_for_timeout(900)
    ev = pg.evaluate
    steps = [
      "UDS.app.setScene('oldtown')",
      "UDS.ui.setMode('line')",
      "(()=>{const a=UDS.app; const r=a.P.roads[2]; a.select({type:'road',id:r.id}); a.selectSeg(r.segs[0].id)})()",
      "(()=>{const a=UDS.app; a.addSeg('planting'); a.addUtil('tunnel'); a.undergroundWires && a.undergroundWires(a.secRoad())})()",
      "(()=>{const a=UDS.app; const b=a.D.buildings[5]; a.select({type:'building',id:b.lotId}); })()",
      "(()=>{const a=UDS.app; const l=a.D.lots.find(x=>x.building); const o=a.lotOv(l.id); o.bld=Object.assign({},o.bld||{}, {floors:12, style:'office'}); a.changed('test'); })()",
      "(()=>{const a=UDS.app; const B=a.D.blocks[3]; a.select({type:'block',id:B.id}); const S=a.block(B.id); S.use='park'; S.parkType='neighborhood'; a.changed('t'); })()",
      "(()=>{const a=UDS.app; const B=a.D.blocks[4]; const S=a.block(B.id); S.lotsAlong=6; S.lotRows=3; S.chamfer=5; a.changed('t'); })()",
      "(()=>{const a=UDS.app; for (const t of ['tree','shrub','light','bench','busstop','bollard','bikerack','pm','smartpole','transformer','hydrant']) { a.setTool('place'); a.state.placeType=t; a.placeAt([120+Math.random()*60, 100+Math.random()*40]); } })()",
      "(()=>{const a=UDS.app; a.state.tab='metrics'; UDS.ui.pane(); a.state.tab='checks'; UDS.ui.pane(); a.state.tab='props'; UDS.ui.pane(); })()",
      "(()=>{const a=UDS.app; for(let i=0;i<12;i++) a.undo(); for(let i=0;i<5;i++) a.redo(); })()",
      "(()=>{const a=UDS.app; UDS.ui.setMode('color'); a.camPreset('eye'); a.camPreset('top'); a.camPreset('persp'); a.camPreset('aerial'); UDS.ui.top(); a.invalidate(7); })()",
      "(()=>{const a=UDS.app; a.P.roads.slice().forEach((r,i)=>{ if(i%3===0) a.eraseAt({type:'road',id:r.id}); }); })()",
      "(()=>{const a=UDS.app; a.setScene('standard'); a.P.roads.forEach(r=>{ r.segs.forEach(s=>{ s.w=Math.max(0.25, s.w-0.5); }); }); a.changed('narrow'); return [a.D.checks.length, a.D.blocks.length] })()",
      "(()=>{const a=UDS.app; while(a.P.roads.length>1) a.eraseAt({type:'road',id:a.P.roads[0].id}); return [a.P.roads.length, a.D.blocks.length, a.D.lots.length] })()",
      "(()=>{const a=UDS.app; a.eraseAt({type:'road',id:a.P.roads[0].id}); return [a.P.roads.length, a.D.blocks.length] })()",
      "(()=>{const a=UDS.app; a.setTool('road'); a.state.roadPreset='jung2'; a.roadClick([50,50]); a.roadClick([300,50]); a.roadClick([300,220]); a.finishRoad(); return [a.P.roads.length, a.D.blocks.length, a.D.deadEnds.length] })()",
    ]
    for i, s in enumerate(steps):
        try:
            r = await ev(s)
            await pg.wait_for_timeout(350)
            if r is not None: print(f"  step {i}: {json.dumps(r, ensure_ascii=False)[:160]}")
        except Exception as e:
            print(f"  step {i} EXC: {str(e)[:300]}")
    await pg.screenshot(path=f"{OUTD}/f_{w}.png")
    print(w, "errors:", logs[:8] or "none")
    await ctx.close()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        await run(b, 1440, 900, False)
        await run(b, 390, 780, True)
        await b.close()
asyncio.run(main())
