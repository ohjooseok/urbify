"""v20: 이미지로 만든 벽 재료 — 창에서 그림 넣기·무늬 크기(비 고정)·거울 반복, 건물에 입히기, 3D(텍스처 배열)·단면(무늬)·SVG,
GLB(그림 내장·REPEAT/MIRRORED_REPEAT)·OBJ(zip의 textures, map_Kd, vt)·DAE(zip, library_images·TEXCOORD) 내보내기,
작업 파일(matData)·브라우저 저장, 지우기(도장·스타코로)·되돌리기, 12개 제한, 없는 재료는 도장·스타코로"""
import asyncio, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import URL, LAUNCH, OUTD, TESTD
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--allow-file-access-from-files"]
ok = True
def check(c, msg):
    global ok
    print(("PASS " if c else "FAIL ") + msg)
    if not c: ok = False

# 자홍·청록 바둑판(장면 어디에도 없는 색이라 화면에서 무늬가 칠해졌는지 셀 수 있다). 600×400 → 가로세로 비 1.5
IMG = os.path.join(OUTD, 'v20_checker.png')
im = Image.new('RGB', (600, 400), (0, 230, 230)); dr = ImageDraw.Draw(im)
for i in range(6):
    for j in range(4):
        if (i + j) % 2 == 0: dr.rectangle([i * 100, j * 100, i * 100 + 99, j * 100 + 99], fill=(235, 0, 235))
im.save(IMG)

# 페이지 안에서 zip(저장 방식)을 읽는 함수: 이름 목록과 글자 파일 내용
ZIP_JS = """async (blob)=>{const u8=new Uint8Array(await blob.arrayBuffer()); const dv=new DataView(u8.buffer); let e=u8.length-22; while(e>0&&dv.getUint32(e,true)!==0x06054b50) e--;
  const n=dv.getUint16(e+10,true); let p=dv.getUint32(e+16,true); const out={};
  for(let i=0;i<n;i++){const csz=dv.getUint32(p+20,true), nl=dv.getUint16(p+28,true), el=dv.getUint16(p+30,true), cl=dv.getUint16(p+32,true), off=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(u8.subarray(p+46,p+46+nl)); const lnl=dv.getUint16(off+26,true), lel=dv.getUint16(off+28,true); const data=u8.subarray(off+30+lnl+lel, off+30+lnl+lel+csz);
    out[name]= /\\.(obj|mtl|dae)$/.test(name) ? new TextDecoder().decode(data) : {size:data.length, jpeg:data[0]===0xff&&data[1]===0xd8, png:data[0]===0x89&&data[1]===0x50}; p+=46+nl+el+cl;}
  return out;}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH(ARGS))
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        pg = await ctx.new_page()
        logs = []
        def onc(m):
            t = m.text
            if m.type == "error" and "ERR_FAILED" not in t and "ERR_INTERNET_DISCONNECTED" not in t: logs.append("error: " + t)
            elif "GL_INVALID" in t or "WebGL: INVALID" in t or "RENDER WARNING" in t: logs.append(m.type + ": " + t)
        pg.on("console", onc)
        pg.on("pageerror", lambda e: logs.append("PAGEERROR: " + str(e)))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        await pg.goto(URL)
        await pg.wait_for_timeout(900)
        ev = pg.evaluate
        await ev("()=>{const a=UDS.app; a.setScene('standard'); a.state.view='split'; document.getElementById('app').dataset.view='split'; window.dispatchEvent(new Event('resize'));}")
        await pg.wait_for_timeout(500)

        # 1. 건물 하나를 고르고, 외장 재료에서 '이미지로 새 재료…' → 창
        lot = await ev("""()=>{const a=UDS.app; const b=a.D.buildings.find(x=>!x.cx&&x.st&&x.st.material!=='glass'); a.select({type:'building', id:b.lotId}); return b.lotId;}""")
        await pg.wait_for_timeout(300)
        opts = await ev("""()=>{const s=document.querySelector('#pane select[data-k="외장 재료"]'); return s?[...s.options].map(o=>o.value):null}""")
        check(opts and opts[-1] == '__new' and 'brick' in opts, f"material select ends with the new-image entry {opts and opts[-2:]}")
        await pg.select_option('#pane select[data-k="외장 재료"]', '__new')
        await pg.wait_for_timeout(300)
        dl = await ev("""()=>{const d=document.querySelector('#dialog'); return {open:!d.hidden, title:d.querySelector('.dh2 b')?.textContent, go:d.querySelector('[data-md-go]')?.disabled, empty:!!d.querySelector('.mdv.empty'),
          sel:document.querySelector('#pane select[data-k="외장 재료"]').value}}""")
        check(dl['open'] and dl['title'] == '이미지로 벽 재료 만들기' and dl['go'] and dl['empty'] and dl['sel'] != '__new', f"new-material dialog opens empty with 재료 만들기 disabled; the select falls back {dl}")

        # 2. 그림 넣기 → 미리보기·이름·무늬 크기(그림 비 1.5)·평균색
        await pg.set_input_files('#dialog .mdc input[data-md="file"]', IMG)
        await pg.wait_for_timeout(600)
        s1 = await ev("""()=>{const d=document.querySelector('#dialog'), st=UDS.MatDlg.state(); const cv=d.querySelector('[data-md="cv"]');
          return {cv:!!cv&&!cv.hidden&&cv.width>0, name:d.querySelector('[data-md="name"]').value, w:+d.querySelector('[data-md="w"]').value, h:+d.querySelector('[data-md="h"]').value,
            color:st&&st.color, url:st&&st.url.slice(0,23), px:st&&st.cv.width, go:d.querySelector('[data-md-go]').disabled}}""")
        check(s1['cv'] and s1['name'] == 'v20_checker' and abs(s1['w'] - 2) < 1e-6 and abs(s1['h'] - 1.33) < 0.011 and not s1['go'], f"picture loads: preview, name from file, 2×1.33m keeps the 1.5 aspect {s1}")
        check(s1['url'] == 'data:image/jpeg;base64,' and s1['px'] == 512, f"picture stored as a 512×512 JPEG {s1['url']} {s1['px']}")
        rgb = [int(s1['color'][i:i + 2], 16) for i in (1, 3, 5)]
        check(abs(rgb[0] - 117) < 14 and abs(rgb[1] - 115) < 14 and abs(rgb[2] - 232) < 14, f"average color is the mean of the checker {s1['color']}")
        # 비 고정: 가로 1.2 → 세로 0.8, 비를 풀면 따로
        await pg.fill('#dialog [data-md="w"]', '1.2')
        h1 = await ev("()=>+document.querySelector('#dialog [data-md=\"h\"]').value")
        await pg.click('#dialog [data-md="lock"]')
        await pg.fill('#dialog [data-md="h"]', '1.5')
        w2 = await ev("()=>[+document.querySelector('#dialog [data-md=\"w\"]').value, UDS.MatDlg.state().tile]")
        check(abs(h1 - 0.8) < 1e-6 and abs(w2[0] - 1.2) < 1e-6 and w2[1] == [1.2, 1.5], f"aspect lock scales the other side; unlocked sides are free (h {h1}, {w2})")
        await pg.click('#dialog [data-md="lock"]')
        await pg.fill('#dialog [data-md="w"]', '4')
        await pg.fill('#dialog [data-md="name"]', '바둑판')
        await pg.screenshot(path=os.path.join(OUTD, 'v20_dialog.png'))
        await pg.click('#dialog [data-md-go]')
        await pg.wait_for_timeout(500)
        c1 = await ev(f"""()=>{{const a=UDS.app, m=a.P.mats&&a.P.mats[0], b=a.D.buildings.find(x=>x.lotId==='{lot}');
          return {{closed:document.querySelector('#dialog').hidden, n:(a.P.mats||[]).length, m, mat:b.st.material, cm:b.st.cm, wall:b.st.wallColor, img:!!a.matImg[m&&m.id], hist:a.hi}}}}""")
        m0 = c1['m'] or {}
        check(c1['closed'] and c1['n'] == 1 and m0.get('name') == '바둑판' and m0.get('tile') == [4, 5] and not m0.get('mirror') and c1['img'], f"material created with name, 4×5m tile (aspect 1.2/1.5 kept) {m0}")
        check(c1['mat'] == m0.get('id') and c1['cm'] == 0 and c1['wall'].lower() == s1['color'].lower(), f"the selected building wears it (slot 0, wall color = average) {c1['mat']} {c1['wall']}")
        await ev("()=>UDS.app.undo()")
        un = await ev(f"()=>{{const a=UDS.app; return [(a.P.mats||[]).length, a.D.buildings.find(x=>x.lotId==='{lot}').st.material]}}")
        await ev("()=>UDS.app.redo()")
        check(un[0] == 0 and not un[1].startswith('cm_'), f"creating + wearing is one undo step {un}")

        # 3. 패널: 무늬 크기·거울 반복·지우기 단추, 고치면 모든 건물에 함께
        await ev(f"()=>UDS.app.select({{type:'building', id:'{lot}'}})")
        await pg.wait_for_timeout(250)
        pn = await ev("""()=>{const p=document.querySelector('#pane'); return {w:+p.querySelector('input[data-k="cmw"]')?.value, h:+p.querySelector('input[data-k="cmh"]')?.value,
          mir:!!p.querySelector('input[data-k="거울 반복"]'), del:!!p.querySelector('[data-act="matdel"]'), sel:p.querySelector('select[data-k="외장 재료"]').selectedOptions[0].textContent}}""")
        check(pn['w'] == 4 and pn['h'] == 5 and pn['mir'] and pn['del'] and pn['sel'] == '이미지 · 바둑판', f"pane shows tile size, mirror and delete for the image material {pn}")
        await pg.fill('#pane input[data-k="cmw"]', '6')
        await pg.press('#pane input[data-k="cmw"]', 'Enter')
        await pg.wait_for_timeout(250)
        t6 = await ev("()=>UDS.app.P.mats[0].tile")
        check(t6 == [6, 5], f"tile width edited in the pane {t6}")
        await ev("()=>UDS.app.undo()")
        check(await ev("()=>UDS.app.P.mats[0].tile[0]") == 4, "tile edit undoes")

        # 4. 3D: 텍스처 배열이 올라가고, 벽에 무늬(자홍·청록)가 칠해진다. 가구 전체에 입혀 화면에서 센다
        await ev("""()=>{const a=UDS.app, id=a.P.mats[0].id; a.P.blocks.forEach(S=>{ if(!S.bld) S.bld={}; S.bld.material=id; S.bld.wallColor=a.P.mats[0].color; Object.values(S.lots||{}).forEach(o=>{ if(o&&o.bld){ delete o.bld.material; delete o.bld.wallColor; } }); }); a.changed();}""")
        await pg.wait_for_timeout(700)
        cnt = """()=>{const cv=UDS.app.r3.cv, gl=UDS.app.r3.gl; UDS.app.r3.draw(); const w=cv.width,h=cv.height, px=new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
          let mg=0, cy=0; for(let i=0;i<px.length;i+=4){const r=px[i],g=px[i+1],b=px[i+2]; if(r>g+55&&b>g+55) mg++; if(g>r+55&&b>r+55&&g>90) cy++;} return {mg,cy,sig:UDS.app.r3._cmSig,n:UDS.app.D.buildings.filter(b=>b.st.cm===0).length};}"""
        r3 = await ev(cnt)
        check('+' in (r3['sig'] or '') and r3['n'] > 5, f"texture array uploaded with the picture ({r3['sig']}, {r3['n']} buildings)")
        check(r3['mg'] > 400 and r3['cy'] > 400, f"walls show the picture in 3D (magenta {r3['mg']} px, cyan {r3['cy']} px)")
        await pg.screenshot(path=os.path.join(OUTD, 'v20_3d.png'))
        # 그림을 못 읽은 경우(층에 그림 없음): 평균색만 → 자홍 거의 없음
        nl = await ev("""()=>{const a=UDS.app, keep=a.matImg; a.matImg={}; a._matEl={}; const r=(%s)(); a.matImg=keep; return r;}""" % cnt)
        await pg.wait_for_timeout(300)
        check(nl['mg'] < r3['mg'] * 0.05 and '-' in nl['sig'], f"without the picture the wall falls back to the average color (magenta {nl['mg']} px)")
        r3b = await ev(cnt)
        await pg.wait_for_timeout(400)
        r3b = await ev(cnt)
        check(r3b['mg'] > 400, f"picture comes back after it decodes again ({r3b['mg']} px)")

        # 5. 단면: 무늬로 칠하고(화면 캔버스에 자홍), SVG에는 pattern·image(한 번만)
        sec = await ev("""()=>{const a=UDS.app; const r=a.P.roads[0]; a.select({type:'road', id:r.id}); a.invalidate(7); return r.id;}""")
        await pg.wait_for_timeout(600)
        sc = await ev("""()=>{const s=UDS.app.sec||UDS.app.section; const cv=s.cv||document.querySelector('#sec canvas, canvas.sec'); s.draw(); const g=cv.getContext('2d'); const d=g.getImageData(0,0,cv.width,cv.height).data; let mg=0; for(let i=0;i<d.length;i+=4){ if(d[i]>d[i+1]+55&&d[i+2]>d[i+1]+55) mg++; }
          const svg=s.exportSVG(); return {mg, pat:(svg.match(/<pattern /g)||[]).length, img:(svg.match(/<image id=/g)||[]).length, mix:svg.includes('mix-blend-mode:multiply')}}""")
        check(sc['mg'] > 300, f"section facades use the picture pattern ({sc['mg']} magenta px)")
        check(sc['pat'] >= 1 and sc['img'] == 1, f"section SVG embeds the picture once and patterns reuse it (patterns {sc['pat']}, images {sc['img']})")

        # 6. 내보내기: GLB(그림 내장, REPEAT), OBJ(zip: textures, map_Kd, vt), DAE(zip: library_images, TEXCOORD)
        glb = await ev("""async ()=>{const out=UDS.Export3D.build(UDS.app,'glb',{bld:true,ground:false,tree:false,furn:false,ctx:false,util:false},'T'); const u8=new Uint8Array(await out.blob.arrayBuffer()); const dv=new DataView(u8.buffer);
          const jl=dv.getUint32(12,true); const J=JSON.parse(new TextDecoder().decode(u8.subarray(20,20+jl)));
          const tm=J.materials.filter(m=>m.pbrMetallicRoughness.baseColorTexture); let uvp=0; J.meshes.forEach(m=>m.primitives.forEach(p=>{ if(p.attributes.TEXCOORD_0!==undefined) uvp++; }));
          const im=J.images&&J.images[0], bv=im&&J.bufferViews[im.bufferView], bin0=20+jl+8+(bv?bv.byteOffset:0);
          return {ext:out.ext, ntex:out.ntex, images:(J.images||[]).length, mime:im&&im.mimeType, jpeg:u8[bin0]===0xff&&u8[bin0+1]===0xd8, wrap:J.samplers&&J.samplers[0].wrapS, tm:tm.length, uvp, name:tm[0]&&tm[0].name}}""")
        check(glb['ext'] == 'glb' and glb['images'] == 1 and glb['mime'] == 'image/jpeg' and glb['jpeg'] and glb['wrap'] == 10497 and glb['tm'] >= 1 and glb['uvp'] >= 1, f"GLB embeds the JPEG with a repeating sampler and TEXCOORD_0 {glb}")
        obj = await ev("""async ()=>{const out=UDS.Export3D.build(UDS.app,'obj',{bld:true,ground:true,tree:false,furn:false,ctx:false,util:false},'T'); const z=await (%s)(out.blob);
          const o=z['ud_model.obj'], m=z['ud_model.mtl']; return {ext:out.ext, names:Object.keys(z), tex:z['textures/img1.jpg'], mapkd:(m.match(/map_Kd textures\\/img1\\.jpg/g)||[]).length, vt:(o.match(/^vt /mg)||[]).length, ft:/^f \\d+\\/\\d+\\/\\d+ /m.test(o), fn:/^f \\d+\\/\\/\\d+ /m.test(o)}}""" % ZIP_JS)
        check(obj['ext'] == 'zip' and obj['tex'] and obj['tex']['jpeg'] and obj['mapkd'] >= 1 and obj['vt'] > 0 and obj['ft'] and obj['fn'], f"OBJ zip carries textures/img1.jpg, map_Kd, vt and textured faces {obj['names']} vt {obj['vt']}")
        dae = await ev("""async ()=>{const out=UDS.Export3D.build(UDS.app,'dae',{bld:true,ground:false,tree:false,furn:false,ctx:false,util:false},'T'); const z=await (%s)(out.blob); const d=z['ud_model.dae']||'';
          let xml=false; try{ xml=!new DOMParser().parseFromString(d,'application/xml').querySelector('parsererror'); }catch(e){}
          return {ext:out.ext, names:Object.keys(z), img:d.includes('<init_from>textures/img1.jpg</init_from>'), tc:d.includes('semantic="TEXCOORD"'), bind:d.includes('bind_vertex_input'), xml}}""" % ZIP_JS)
        check(dae['ext'] == 'zip' and 'textures/img1.jpg' in dae['names'] and dae['img'] and dae['tc'] and dae['bind'] and dae['xml'], f"DAE becomes a zip with the texture, library_images, TEXCOORD and valid XML {dae}")
        # 거울 반복: GLB는 MIRRORED_REPEAT, OBJ는 2×2로 굽힌 그림
        await ev("()=>{UDS.app.P.mats[0].mirror=true; UDS.app.changed();}")
        mir = await ev("""async ()=>{const g=UDS.Export3D.build(UDS.app,'glb',{bld:true},'T'); const u8=new Uint8Array(await g.blob.arrayBuffer()); const dv=new DataView(u8.buffer); const J=JSON.parse(new TextDecoder().decode(u8.subarray(20,20+dv.getUint32(12,true))));
          const o=UDS.Export3D.build(UDS.app,'obj',{bld:true},'T'); const z=await (%s)(o.blob); return {wrap:J.samplers[0].wrapS, names:Object.keys(z), mtl:/map_Kd textures\\/img1_mirror\\.jpg/.test(z['ud_model.mtl'])}}""" % ZIP_JS)
        check(mir['wrap'] == 33648 and 'textures/img1_mirror.jpg' in mir['names'] and mir['mtl'], f"mirror repeat: GLB MIRRORED_REPEAT, OBJ bakes a 2×2 picture {mir}")
        r3m = await ev(cnt)
        check(r3m['mg'] > 400, f"mirror repeat still renders ({r3m['mg']} px)")
        await ev("()=>{UDS.app.P.mats[0].mirror=false; UDS.app.changed();}")

        # 7. 작업 파일(matData)과 브라우저 저장, 새로 열기
        pj = await ev("""()=>{const a=UDS.app, P=a.exportProject(), id=a.P.mats[0].id; const ok1=!!(P.matData&&P.matData[id]&&P.matData[id].startsWith('data:image/jpeg')) && !a.P.matData;
          const txt=JSON.stringify(P); a.matImg={}; a._matEl={}; a.load(JSON.parse(txt)); return {ok1, back:!!a.matImg[id], clean:!a.P.matData, worn:a.D.buildings.filter(b=>b.st.material===id).length}}""")
        check(pj['ok1'] and pj['back'] and pj['clean'] and pj['worn'] > 5, f"project file carries matData; loading restores pictures and keeps P clean {pj}")
        await ev("()=>{UDS.app.saveSoon(); UDS.app.saveNow();}")
        ls = await ev("()=>{const o=JSON.parse(localStorage.getItem('uds.sandbox.v1.mat')||'{}'); return Object.keys(o).length}")
        check(ls == 1, f"browser autosave keeps the picture under its own key ({ls})")
        await pg.reload(); await pg.wait_for_timeout(1300)
        rl = await ev("""()=>{const a=UDS.app; a.state.view='split'; document.getElementById('app').dataset.view='split'; window.dispatchEvent(new Event('resize')); return {n:(a.P.mats||[]).length, img:!!(a.P.mats&&a.matImg[a.P.mats[0].id])}}""")
        await pg.wait_for_timeout(700)
        r3r = await ev(cnt)
        check(rl['n'] == 1 and rl['img'] and r3r['mg'] > 400, f"after reload the material and its picture come back and render {rl} {r3r['mg']}px")

        # 8. 지우기: 쓰던 건물은 도장·스타코로, 되돌리기로 살림. 없는 재료 id도 도장·스타코로
        dl2 = await ev("""()=>{const a=UDS.app, id=a.P.mats[0].id; const b=a.D.buildings.find(x=>x.st.material===id); a.select({type:'building', id:b.lotId}); UDS.ui.pane();
          document.querySelector('#pane [data-act="matdel"]').click(); const after={n:(a.P.mats||[]).length, stucco:a.D.buildings.filter(x=>x.st.material==='stucco').length, left:a.D.buildings.filter(x=>x.st.material===id).length};
          a.undo(); return {...after, undo:(a.P.mats||[]).length, back:a.D.buildings.filter(x=>x.st.material===id).length}}""")
        check(dl2['n'] == 0 and dl2['left'] == 0 and dl2['stucco'] > 5 and dl2['undo'] == 1 and dl2['back'] > 5, f"deleting falls back to 도장·스타코 and undo restores {dl2}")
        miss = await ev("""()=>{const a=UDS.app; a.P.blocks[0].bld=Object.assign(a.P.blocks[0].bld||{}, {material:'cm_missing'}); a.derive(); const bs=a.D.buildings.filter(b=>b.blockId===a.P.blocks[0].id); return bs.length && bs.every(b=>b.st.material==='stucco'&&b.st.cm===undefined)}""")
        check(miss, "a material id with no definition falls back to 도장·스타코")

        # 9. 12개 제한
        lim = await ev("""()=>{const a=UDS.app, url=a.matImg[a.P.mats[0].id]; while(a.P.mats.length<UDS.C.CMAT_MAX) a.addMat({name:'x', tile:[1,1], color:'#888888'}, url); const over=a.addMat({name:'y', tile:[1,1]}, url); a.changed();
          const b=a.D.buildings.find(x=>!x.cx); a.select({type:'building', id:b.lotId}); UDS.ui.pane(); return {n:a.P.mats.length, over}}""")
        await pg.select_option('#pane select[data-k="외장 재료"]', '__new')
        await pg.wait_for_timeout(300)
        lt = await ev("()=>({dlg:!document.querySelector('#dialog').hidden, toast:(document.querySelector('#toast')||{}).textContent||''})")
        check(lim['n'] == 12 and lim['over'] is None and not lt['dlg'] and '12개' in lt['toast'], f"at most 12 image materials per project {lim} {lt}")
        r3x = await ev(cnt)
        check('+' in r3x['sig'] and r3x['sig'].count(',') == 11, "texture array grows to 12 layers")

        check(not logs, "no console errors or WebGL warnings " + json.dumps(logs[:5], ensure_ascii=False))
        await b.close()
    print("ALL OK" if ok else "SOME FAILED")
asyncio.run(main())
