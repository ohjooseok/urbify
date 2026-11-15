/* Urbify — 3D 모델 내보내기(.glb · .dae · .obj+.mtl)
 * 3D 화면과 같은 도형을 모아, 갈래(바닥·도로·건물·수목·시설물·지하시설)와 건물 동마다 묶어 내보낸다.
 * 단위 m, 원점은 대상지 남서쪽 모서리. glb·obj는 Y축이 위, dae는 Z축이 위(스케치업 축과 같음).
 * 수목은 face-me 그림 대신 줄기와 수관 부피로 내보낸다(다른 프로그램에서 늘 카메라를 향하게 할 수 없으므로). */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C;
  const X = (UDS.Export3D = {});

  const CAT = {
    site: ['Ground', 'Site'], lot: ['Ground', 'Lots'], park: ['Ground', 'Park features'], water: ['Ground', 'Water'],
    road: ['Roads', 'Pavement'], mark: ['Roads', 'Markings'], curb: ['Roads', 'Curbs'],
    building: ['Buildings', null], ctx: ['Existing buildings', null],
    tree: ['Trees', 'Trees'], furn: ['Street furniture', 'Street furniture'], util: ['Utilities', 'Utilities'],
  };
  const hex2 = (v) => { const s = Math.round(U.clamp(v, 0, 1) * 255).toString(16); return s.length < 2 ? '0' + s : s; };
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // glTF 색은 선형값

  /* 도형 모으기. opt: {ground, bld, tree, furn, ctx, util} */
  X.collect = function (app, opt) {
    const r3 = app.r3;
    if (!r3 || !r3.buildScene || !app.D) return null;
    const layers = { buildings: !!opt.bld, trees: !!opt.tree, furniture: !!opt.furn, ctx: !!opt.ctx, parcels: false, utilities: !!opt.util, labels: false, shadows: false };
    const S = r3.buildScene({ exp: true, layers });
    const want = { site: opt.ground, lot: opt.ground, park: opt.ground, water: opt.ground, road: opt.ground, mark: opt.ground, curb: opt.ground, building: opt.bld, ctx: opt.ctx, tree: opt.tree, furn: opt.furn, util: opt.util };
    const cats = new Map(), mats = new Map(), matList = [];
    const bldName = new Map();
    let nb = 0;
    (app.D.buildings || []).forEach((b) => { nb++; bldName.set('building:' + b.lotId, `B${String(nb).padStart(2, '0')} ${b.use || 'bld'} ${b.floors || ''}F`.replace(/\s+/g, ' ').trim()); });
    let nctx = 0;
    const nodeOf = (cn, key, name) => {
      let c = cats.get(cn); if (!c) { c = { name: cn, nodes: new Map() }; cats.set(cn, c); }
      let n = c.nodes.get(key); if (!n) { n = { name, prims: new Map() }; c.nodes.set(key, n); }
      return n;
    };
    const matOf = (rgb, tag) => {
      const hx = hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]);
      let m = mats.get(hx);
      if (!m) { m = { id: matList.length, name: `${tag}_${hx}`, rgb: [parseInt(hx.slice(0, 2), 16) / 255, parseInt(hx.slice(2, 4), 16) / 255, parseInt(hx.slice(4, 6), 16) / 255] }; mats.set(hx, m); matList.push(m); }
      return m;
    };
    /* 이미지 재료: 재료 차례(slot)와 벽 색마다 하나. 그림이 없으면(아직 못 읽음) null → 평균색(벽 색) 재질로.
       색 계수는 벽 색 ÷ 평균색(1을 넘으면 1): 벽 색을 바꿔 물들인 만큼 곱한다 */
    const cmDefs = app.mats ? app.mats() : [], texs = new Map();
    const texOf = (def, slot) => {
      let t = texs.get(def.id);
      if (t === undefined) {
        const url = app.matImg && app.matImg[def.id], mt = url && /^data:image\/(jpeg|png);base64,/.exec(url);
        t = null;
        if (mt) {
          t = { file: `img${slot + 1}`, name: def.name || `Image ${slot + 1}`, tile: def.tile.slice(), mirror: !!def.mirror, ext: mt[1] === 'png' ? 'png' : 'jpg', mime: 'image/' + mt[1], bytes: b64bytes(url), mbytes: null };
          if (t.mirror) { // 거울 반복을 모르는 형식(OBJ·DAE)용: 2×2로 뒤집어 붙인 그림
            let c = null; try { c = app.matMirror(def.id); } catch (e) { c = null; }
            if (c) t.mbytes = b64bytes(c.toDataURL('image/jpeg', 0.9));
          }
        }
        texs.set(def.id, t);
      }
      return t;
    };
    const matOfCM = (slot, rgb) => {
      const def = cmDefs[slot]; if (!def) return null;
      const t = texOf(def, slot); if (!t) return null;
      const hx = hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]), key = 'cm' + slot + '_' + hx;
      let m = mats.get(key);
      if (!m) {
        const A = U.hexToRgb(def.color || '#808080');
        m = { id: matList.length, name: `${t.file}_${hx}`, label: `${t.name} ${hx}`, rgb: rgb.map((v, i) => U.clamp(v / Math.max(A[i], 0.03), 0, 1)), tex: t };
        mats.set(key, m); matList.push(m);
      }
      return m;
    };
    let ntri = 0;
    [S.ground, S.ground2, S.solid, S.treeSh, S.pipes].forEach((b) => {
      const I = b.I, Pp = b.P, N = b.N, Cl = b.Cl, K = b.K, S2 = b.S2, UV = b.UV, tags = b.tags || [];
      if (!I.length) return;
      let ti = 0, tag = null;
      for (let i = 0; i + 2 < I.length; i += 3) {
        while (ti < tags.length && tags[ti][0] <= i) { tag = tags[ti][1]; ti++; }
        if (!tag || !want[tag] || !CAT[tag]) continue;
        let ia = I[i], ib = I[i + 1], ic = I[i + 2];
        const ax = Pp[ia * 3], ay = Pp[ia * 3 + 1], az = Pp[ia * 3 + 2];
        const ux = Pp[ib * 3] - ax, uy = Pp[ib * 3 + 1] - ay, uz = Pp[ib * 3 + 2] - az;
        const vx = Pp[ic * 3] - ax, vy = Pp[ic * 3 + 1] - ay, vz = Pp[ic * 3 + 2] - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.hypot(nx, ny, nz) < 1e-7) continue; // 넓이가 없는 삼각형
        if (nx * N[ia * 3] + ny * N[ia * 3 + 1] + nz * N[ia * 3 + 2] < 0) { const t = ib; ib = ic; ic = t; } // 앞면이 법선 쪽을 보게
        const [cn, sub] = CAT[tag];
        let node;
        if (sub) node = nodeOf(cn, sub, sub);
        else {
          const id = Math.round(K[ia * 3] * 255) + (Math.round(K[ia * 3 + 1] * 255) << 8) + (Math.round(K[ia * 3 + 2] * 255) << 16);
          const it = S.pickTable[id];
          const key = it ? it.type + ':' + it.id : 'misc';
          node = nodeOf(cn, key, () => (bldName.get(key) || (tag === 'ctx' ? `E${String(++nctx).padStart(3, '0')}` : cn)));
          if (typeof node.name === 'function') node.name = node.name();
        }
        const rgb = [Cl[ia * 3], Cl[ia * 3 + 1], Cl[ia * 3 + 2]];
        let m = null;
        // 벽(면 종류 1)의 재료 부호가 1000 이상이면 이미지 재료(1000 + 차례×10 + 간판)
        if (tag === 'building' && S2 && Math.round(S2[ia * 4 + 3]) === 1 && S2[ia * 4 + 2] > 999.5) m = matOfCM(Math.floor((Math.round(S2[ia * 4 + 2]) - 1000) / 10), rgb);
        if (!m) m = matOf(rgb, tag);
        let pr = node.prims.get(m.id);
        if (!pr) { pr = { P: [], N: [], I: [], T: m.tex ? [] : null, map: new Map() }; node.prims.set(m.id, pr); }
        [ia, ib, ic].forEach((vi) => {
          let li = pr.map.get(vi);
          if (li === undefined) {
            li = pr.P.length / 3; pr.map.set(vi, li);
            pr.P.push(Pp[vi * 3], Pp[vi * 3 + 1], Pp[vi * 3 + 2]);
            const qx = N[vi * 3], qy = N[vi * 3 + 1], qz = N[vi * 3 + 2], ql = Math.hypot(qx, qy, qz) || 1;
            pr.N.push(qx / ql, qy / ql, qz / ql);
            if (pr.T) pr.T.push(UV[vi * 2], UV[vi * 2 + 1]); // 벽 위 좌표(m): 가로는 벽을 따라, 세로는 땅에서 위로
          }
          pr.I.push(li);
        });
        ntri++;
      }
    });
    return { cats, mats: matList, ntri, texs: Array.from(texs.values()).filter(Boolean) };
  };
  function b64bytes(url) {
    const bin = atob(url.slice(url.indexOf(',') + 1)), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  /* 벽 위 좌표(m) → 텍스처 좌표. v위(OBJ·DAE): 땅이 그림의 아래 끝. 거울 반복을 2×2 그림으로 굽힌 경우는 한 장이 두 배 */
  const uvUp = (t, x, y) => { const k = t.mirror && t.mbytes ? 2 : 1; return [x / (t.tile[0] * k), y / (t.tile[1] * k)]; };
  const texFile = (t) => (t.mirror && t.mbytes ? `textures/${t.file}_mirror.jpg` : `textures/${t.file}.${t.ext}`);
  const texFiles = (R) => R.texs.map((t) => ({ name: texFile(t), data: t.mirror && t.mbytes ? t.mbytes : t.bytes }));

  /* ---------- glTF 2.0 바이너리(.glb) ---------- */
  X.toGLB = function (R, title) {
    const json = { asset: { version: '2.0', generator: 'Urbify' }, scene: 0, scenes: [{ name: title, nodes: [0] }], nodes: [{ name: title, children: [] }], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
    const bins = []; let off = 0;
    const view = (ta, target) => {
      const pad = (4 - (off % 4)) % 4;
      if (pad) { bins.push(new Uint8Array(pad)); off += pad; }
      const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
      json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: u8.length, target });
      bins.push(u8); off += u8.length;
      return json.bufferViews.length - 1;
    };
    const acc = (bv, ct, count, type, mn, mx) => { const a = { bufferView: bv, componentType: ct, count, type }; if (mn) { a.min = mn; a.max = mx; } json.accessors.push(a); return json.accessors.length - 1; };
    // 이미지 재료: 그림(원래 JPEG·PNG)을 바이너리에 넣고, 되풀이는 표본기(REPEAT / MIRRORED_REPEAT)로
    const texIdx = new Map();
    const texOf = (t) => {
      if (texIdx.has(t)) return texIdx.get(t);
      if (!json.images) { json.images = []; json.textures = []; json.samplers = []; }
      json.images.push({ name: t.file, mimeType: t.mime, bufferView: view(t.bytes) });
      json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: t.mirror ? 33648 : 10497, wrapT: t.mirror ? 33648 : 10497 });
      json.textures.push({ source: json.images.length - 1, sampler: json.samplers.length - 1 });
      texIdx.set(t, json.textures.length - 1);
      return json.textures.length - 1;
    };
    R.mats.forEach((m) => {
      const pbr = { baseColorFactor: [lin(m.rgb[0]), lin(m.rgb[1]), lin(m.rgb[2]), 1], metallicFactor: 0, roughnessFactor: 0.9 };
      if (m.tex) pbr.baseColorTexture = { index: texOf(m.tex) };
      json.materials.push({ name: m.label || m.name, pbrMetallicRoughness: pbr, doubleSided: true });
    });
    R.cats.forEach((cat) => {
      const ci = json.nodes.length; json.nodes.push({ name: cat.name, children: [] }); json.nodes[0].children.push(ci);
      cat.nodes.forEach((nd) => {
        const prims = [];
        nd.prims.forEach((pr, mid) => {
          const P = new Float32Array(pr.P), N = new Float32Array(pr.N), I = new Uint32Array(pr.I);
          const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
          const at = { POSITION: acc(view(P, 34962), 5126, P.length / 3, 'VEC3', mn, mx), NORMAL: acc(view(N, 34962), 5126, N.length / 3, 'VEC3') };
          const t = R.mats[mid].tex;
          if (t && pr.T) { // glTF의 v는 아래로 커진다: 땅(0)이 그림의 아래 끝(1)
            const T = new Float32Array(pr.T.length);
            for (let i = 0; i < pr.T.length; i += 2) { T[i] = pr.T[i] / t.tile[0]; T[i + 1] = 1 - pr.T[i + 1] / t.tile[1]; }
            at.TEXCOORD_0 = acc(view(T, 34962), 5126, T.length / 2, 'VEC2');
          }
          prims.push({ attributes: at, indices: acc(view(I, 34963), 5125, I.length, 'SCALAR'), material: mid, mode: 4 });
        });
        if (!prims.length) return;
        json.meshes.push({ name: nd.name, primitives: prims });
        json.nodes.push({ name: nd.name, mesh: json.meshes.length - 1 });
        json.nodes[ci].children.push(json.nodes.length - 1);
      });
      if (!json.nodes[ci].children.length) delete json.nodes[ci].children;
    });
    if (!json.nodes[0].children.length) delete json.nodes[0].children;
    const binPad = (4 - (off % 4)) % 4;
    json.buffers.push({ byteLength: off + binPad });
    let js = new TextEncoder().encode(JSON.stringify(json));
    const jPad = (4 - (js.length % 4)) % 4;
    const total = 12 + 8 + js.length + jPad + 8 + off + binPad;
    const head = new DataView(new ArrayBuffer(20));
    head.setUint32(0, 0x46546c67, true); head.setUint32(4, 2, true); head.setUint32(8, total, true);
    head.setUint32(12, js.length + jPad, true); head.setUint32(16, 0x4e4f534a, true);
    const jtail = new Uint8Array(jPad).fill(0x20);
    const bh = new DataView(new ArrayBuffer(8)); bh.setUint32(0, off + binPad, true); bh.setUint32(4, 0x004e4942, true);
    return new Blob([head.buffer, js, jtail, bh.buffer].concat(bins, [new Uint8Array(binPad)]), { type: 'model/gltf-binary' });
  };

  /* ---------- COLLADA 1.4.1(.dae): 스케치업이 모든 판에서 읽는 형식. Z축이 위 ---------- */
  const f3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? '0' : String(r); };
  const f4 = (v) => { const r = Math.round(v * 10000) / 10000; return r === 0 ? '0' : String(r); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  X.toDAE = function (R, title) { return new Blob([daeText(R, title)], { type: 'model/vnd.collada+xml' }); };
  function daeText(R, title) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const o = ['<?xml version="1.0" encoding="utf-8"?>\n<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">',
      `<asset><contributor><authoring_tool>Urbify</authoring_tool></contributor><created>${now}</created><modified>${now}</modified><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>`];
    if (R.texs.length) { // 이미지 재료: 같은 zip 안 textures/의 그림을 가리킨다
      o.push('<library_images>');
      R.texs.forEach((t) => o.push(`<image id="${t.file}" name="${esc(t.name)}"><init_from>${texFile(t)}</init_from></image>`));
      o.push('</library_images>');
    }
    o.push('<library_effects>');
    R.mats.forEach((m) => {
      if (m.tex) o.push(`<effect id="m${m.id}-fx"><profile_COMMON><newparam sid="m${m.id}-sf"><surface type="2D"><init_from>${m.tex.file}</init_from></surface></newparam><newparam sid="m${m.id}-sp"><sampler2D><source>m${m.id}-sf</source></sampler2D></newparam><technique sid="common"><lambert><diffuse><texture texture="m${m.id}-sp" texcoord="UVSET0"/></diffuse></lambert></technique></profile_COMMON></effect>`);
      else o.push(`<effect id="m${m.id}-fx"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${f3(m.rgb[0])} ${f3(m.rgb[1])} ${f3(m.rgb[2])} 1</color></diffuse></lambert></technique></profile_COMMON></effect>`);
    });
    o.push('</library_effects><library_materials>');
    R.mats.forEach((m) => o.push(`<material id="m${m.id}" name="${esc(m.label || m.name)}"><instance_effect url="#m${m.id}-fx"/></material>`));
    o.push('</library_materials><library_geometries>');
    const scene = [];
    let gi = 0;
    R.cats.forEach((cat, ck) => {
      const kids = [];
      cat.nodes.forEach((nd) => {
        const g = 'g' + gi++;
        const pos = [], nrm = [], uv = [], tris = [], used = [];
        let base = 0, anyT = false;
        nd.prims.forEach((pr, mid) => {
          for (let i = 0; i < pr.P.length; i += 3) { pos.push(f3(pr.P[i]), f3(-pr.P[i + 2]), f3(pr.P[i + 1])); nrm.push(f3(pr.N[i]), f3(-pr.N[i + 2]), f3(pr.N[i + 1])); }
          const t = R.mats[mid].tex && pr.T ? R.mats[mid].tex : null;
          // 텍스처 좌표는 꼭짓점 번호를 같이 쓴다(그림 없는 면은 0)
          for (let i = 0, nv = pr.P.length / 3; i < nv; i++) { if (t) { const q = uvUp(t, pr.T[i * 2], pr.T[i * 2 + 1]); uv.push(f4(q[0]), f4(q[1])); } else uv.push('0', '0'); }
          if (t) anyT = true;
          const idx = new Array(pr.I.length);
          for (let i = 0; i < pr.I.length; i++) idx[i] = pr.I[i] + base;
          tris.push(`<triangles material="m${mid}" count="${pr.I.length / 3}"><input semantic="VERTEX" source="#${g}-v" offset="0"/>${t ? `<input semantic="TEXCOORD" source="#${g}-t" offset="0" set="0"/>` : ''}<p>${idx.join(' ')}</p></triangles>`);
          used.push(mid);
          base += pr.P.length / 3;
        });
        if (!used.length) return;
        const n = pos.length / 3;
        o.push(`<geometry id="${g}" name="${esc(nd.name)}"><mesh>` +
          `<source id="${g}-p"><float_array id="${g}-pa" count="${pos.length}">${pos.join(' ')}</float_array><technique_common><accessor source="#${g}-pa" count="${n}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>` +
          `<source id="${g}-n"><float_array id="${g}-na" count="${nrm.length}">${nrm.join(' ')}</float_array><technique_common><accessor source="#${g}-na" count="${n}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>` +
          (anyT ? `<source id="${g}-t"><float_array id="${g}-ta" count="${uv.length}">${uv.join(' ')}</float_array><technique_common><accessor source="#${g}-ta" count="${n}" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>` : '') +
          `<vertices id="${g}-v"><input semantic="POSITION" source="#${g}-p"/><input semantic="NORMAL" source="#${g}-n"/></vertices>` + tris.join('') + '</mesh></geometry>');
        kids.push(`<node id="n${g}" name="${esc(nd.name)}"><instance_geometry url="#${g}"><bind_material><technique_common>${used.map((mid) => `<instance_material symbol="m${mid}" target="#m${mid}">${R.mats[mid].tex ? '<bind_vertex_input semantic="UVSET0" input_semantic="TEXCOORD" input_set="0"/>' : ''}</instance_material>`).join('')}</technique_common></bind_material></instance_geometry></node>`);
      });
      if (kids.length) scene.push(`<node id="c${scene.length}" name="${esc(cat.name)}">${kids.join('')}</node>`);
    });
    o.push('</library_geometries>');
    o.push(`<library_visual_scenes><visual_scene id="scene" name="${esc(title)}"><node id="root" name="${esc(title)}">${scene.join('')}</node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#scene"/></scene></COLLADA>`);
    return o.join('\n');
  }

  /* ---------- Wavefront OBJ + MTL(zip 한 덩어리): Y축이 위 ---------- */
  X.toOBJ = function (R, title, base) {
    const v = [], vn = [], vt = [], f = [];
    let nv = 0, nt = 0;
    const mtlName = (m) => m.name.replace(/[^\w.-]/g, '_');
    R.cats.forEach((cat) => cat.nodes.forEach((nd) => {
      f.push(`g ${cat.name.replace(/\s+/g, '_')}`); // 갈래(레이어): 라이노는 OBJ 그룹을 레이어로 읽는다
      f.push(`o ${(cat.name + '_' + nd.name).replace(/\s+/g, '_')}`);
      nd.prims.forEach((pr, mid) => {
        const b0 = nv + 1, t = R.mats[mid].tex && pr.T ? R.mats[mid].tex : null, t0 = nt + 1;
        for (let i = 0; i < pr.P.length; i += 3) { v.push(`v ${f3(pr.P[i])} ${f3(pr.P[i + 1])} ${f3(pr.P[i + 2])}`); vn.push(`vn ${f3(pr.N[i])} ${f3(pr.N[i + 1])} ${f3(pr.N[i + 2])}`); }
        nv += pr.P.length / 3;
        if (t) { for (let i = 0; i < pr.T.length; i += 2) { const q = uvUp(t, pr.T[i], pr.T[i + 1]); vt.push(`vt ${f4(q[0])} ${f4(q[1])}`); } nt += pr.T.length / 2; }
        f.push(`usemtl ${mtlName(R.mats[mid])}`);
        for (let i = 0; i < pr.I.length; i += 3) {
          const a = pr.I[i], b = pr.I[i + 1], c = pr.I[i + 2];
          if (t) f.push(`f ${a + b0}/${a + t0}/${a + b0} ${b + b0}/${b + t0}/${b + b0} ${c + b0}/${c + t0}/${c + b0}`);
          else f.push(`f ${a + b0}//${a + b0} ${b + b0}//${b + b0} ${c + b0}//${c + b0}`);
        }
      });
    }));
    const obj = `# ${title} — Urbify (units: m, Y up)\nmtllib ${base}.mtl\n` + v.join('\n') + '\n' + vn.join('\n') + '\n' + (vt.length ? vt.join('\n') + '\n' : '') + f.join('\n') + '\n';
    const mtl = '# Urbify\n' + R.mats.map((m) => `newmtl ${mtlName(m)}\nKa 0 0 0\nKd ${f3(m.rgb[0])} ${f3(m.rgb[1])} ${f3(m.rgb[2])}\nKs 0 0 0\nd 1\nillum 1\n${m.tex ? `map_Kd ${texFile(m.tex)}\n` : ''}`).join('\n');
    const enc = new TextEncoder();
    return zip([{ name: base + '.obj', data: enc.encode(obj) }, { name: base + '.mtl', data: enc.encode(mtl) }].concat(texFiles(R)));
  };

  /* 압축하지 않는(저장 방식) zip */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cen = [];
    const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let off = 0, csz = 0;
    files.forEach((fl) => {
      const nm = enc.encode(fl.name), crc = crc32(fl.data), sz = fl.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosT, true); lh.setUint16(12, dosD, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
      lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nm, fl.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosT, true); ch.setUint16(14, dosD, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true);
      ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
      cen.push(new Uint8Array(ch.buffer), nm);
      off += 30 + nm.length + sz; csz += 46 + nm.length;
    });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csz, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(cen, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }
  X.zip = zip;

  X.FORMATS = {
    glb: { ext: 'glb', mime: 'model/gltf-binary' },
    dae: { ext: 'dae', mime: 'model/vnd.collada+xml' },
    obj: { ext: 'zip', mime: 'application/zip' },
  };
  /* 한 번에: 모으고 → 형식대로 쓴다. 돌려주는 값 {blob, ext, ntri} 또는 null */
  X.build = function (app, fmt, opt, title) {
    const R = X.collect(app, opt);
    if (!R || !R.ntri) return null;
    const base = 'ud_model';
    let blob, ext = X.FORMATS[fmt] ? X.FORMATS[fmt].ext : 'glb';
    if (fmt === 'dae' && R.texs.length) { // 그림을 가리키는 .dae는 그림과 함께 zip으로
      blob = zip([{ name: base + '.dae', data: new TextEncoder().encode(daeText(R, title)) }].concat(texFiles(R))); ext = 'zip';
    } else blob = fmt === 'dae' ? X.toDAE(R, title) : fmt === 'obj' ? X.toOBJ(R, title, base) : X.toGLB(R, title);
    return { blob, ext, ntri: R.ntri, nmat: R.mats.length, ntex: R.texs.length };
  };
})(typeof window !== 'undefined' ? window : globalThis);
