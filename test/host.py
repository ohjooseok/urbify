import asyncio, sys, json
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
ARGS=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files","--disable-web-security"]
FAKE = """
if (window.self !== window.top) {
  window.claude = { use: (n) => new Promise((res) => setTimeout(() => res(n === 'downloads' ? Object.freeze({ save: async (req) => { (window.__saved = window.__saved || []).push({ filename: req.filename, kind: (req.data && req.data.constructor && req.data.constructor.name), size: req.data.size || req.data.length }); if (window.__decline) { const e = new Error('no'); e.code = 'declined'; throw e; } return { status: 'saved' }; } }) : null), 300)) };
}
"""
async def run(with_cap):
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width":1440,"height":900})
        if with_cap: await ctx.add_init_script(FAKE)
        pg = await ctx.new_page()
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: "+str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.goto(pathlib.Path(TESTD, 'frame.html').as_uri())
        await pg.wait_for_timeout(1800)
        fr = pg.frames[1]
        print("cap" if with_cap else "nocap", "top?", await fr.evaluate("window.self===window.top"), "claude?", await fr.evaluate("typeof window.claude"))
        async def menu(act):
            await fr.click('[data-act="menu"][data-arg="project"]:visible'); await fr.wait_for_timeout(200)
            await fr.click(f'#pop [data-act="{act}"]'); await fr.wait_for_timeout(700)
        await menu('savefile')
        print("  savefile → dialog:", (await fr.evaluate("document.getElementById('dialog').hidden ? '(none)' : document.getElementById('dialog').innerText.slice(0,40)")).replace("\n"," "), "| toast:", await fr.evaluate("document.getElementById('toast').innerText"))
        await fr.evaluate("UDS.ui.closeOverlays()")
        await menu('exportsvg')
        print("  exportsvg → dialog:", (await fr.evaluate("document.getElementById('dialog').hidden ? '(none)' : document.getElementById('dialog').innerText.slice(0,40)")).replace("\n"," "), "| toast:", await fr.evaluate("document.getElementById('toast').innerText"))
        await fr.evaluate("UDS.ui.closeOverlays()")
        await menu('exportsecsvg')
        print("  exportsecsvg → dialog:", (await fr.evaluate("document.getElementById('dialog').hidden ? '(none)' : document.getElementById('dialog').innerText.slice(0,46)")).replace("\n"," "), "| toast:", await fr.evaluate("document.getElementById('toast').hidden ? '' : document.getElementById('toast').innerText"), "| preview img ok:", await fr.evaluate("(()=>{const i=document.querySelector('#dialog img'); return i? (i.naturalWidth>0) : null})()"))
        await fr.evaluate("UDS.ui.closeOverlays()")
        await menu('export3d')
        print("  export3d → dialog buttons:", await fr.evaluate("[...document.querySelectorAll('#dialog .df *')].map(e=>e.innerText).join(' / ')"))
        if with_cap:
            await fr.click('#dialog [data-act="hostimg"]'); await fr.wait_for_timeout(500)
            print("  after hostimg → dialog hidden:", await fr.evaluate("document.getElementById('dialog').hidden"), "| toast:", await fr.evaluate("document.getElementById('toast').innerText"))
            await fr.evaluate("window.__decline = true")
            await menu('exportsec')
            await fr.click('#dialog [data-act="hostimg"]'); await fr.wait_for_timeout(400)
            print("  declined → dialog still open:", await fr.evaluate("!document.getElementById('dialog').hidden"))
            print("  saved:", json.dumps(await fr.evaluate("window.__saved"), ensure_ascii=False))
        print("  errors:", logs[:5] or "none")
        await b.close()
asyncio.run(run(True)); asyncio.run(run(False))
