/* Urbify — 발표 화면(three.js)
 * 3D 화면과 같은 모형(입면 창 무늬·이미지 재료·수목 포함)을 물리 기반 재질(유리에 하늘이 비침), 주변광 가림(GTAO),
 * 부드러운 그림자, 하늘빛으로 그린다. 둘러보기, 눈높이 걷기(1.6m, WASD·화살표, 끌어서 시선), VR 보기(WebXR), 그림 저장.
 * three.js 묶음(vendor/three-urbify.js, 약 630KB)은 이 화면을 처음 열 때만 불러온다(tools/three/build.sh 로 만듦). */
(function (G) {
  'use strict';
  const UDS = G.UDS, U = UDS.U, C = UDS.C;
  const PR = (UDS.Present = {});
  const EYE = 1.6, WALK = 1.5, RUN = 4.5, BODY = 0.3, LOOK = 0.0035;
  let T = null, S = null;
  const lin = (c) => c.map((v) => Math.pow(Math.max(0, v), 2.2));
  const $ = (q) => S && S.root.querySelector(q);

  /* three.js 묶음을 한 번만 불러온다 */
  PR.load = function () {
    if (G.THREE_U) { T = G.THREE_U; return Promise.resolve(T); }
    if (PR._loading) return PR._loading;
    PR._loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PR.src || 'vendor/three-urbify.js';
      s.onload = () => { T = G.THREE_U || null; if (T) res(T); else { PR._loading = null; rej(new Error('three 묶음이 비어 있음')); } };
      s.onerror = () => { PR._loading = null; s.remove(); rej(new Error('vendor/three-urbify.js 를 불러오지 못함')); };
      document.head.appendChild(s);
    });
    return PR._loading;
  };

  /* ---------- 재질: 3D 화면의 입면 셰이더 조각을 three.js 표준 재질에 끼운다 ---------- */
  const fragHead = (n) => `
uniform float u_lit; uniform float u_glow; uniform vec4 u_cm[${n}]; uniform vec3 u_cmA[${n}]; uniform mediump sampler2DArray u_cmTex;
varying vec3 v_col; varying vec2 v_uv; flat varying vec4 v_st1; flat varying vec4 v_st2; flat varying vec3 v_pick; varying vec3 v_wp;
vec3 toLin(vec3 c){ return pow(max(c, vec3(0.0)), vec3(2.2)); }
${UDS.Render3D.FACADE_GLSL}
float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); vec2 o = vec2(i.z * 17.0); // 부드러운 값 잡음(수관의 잎 뭉치 느낌)
  float a = mix(mix(h21(i.xy + o), h21(i.xy + vec2(1.0, 0.0) + o), f.x), mix(h21(i.xy + vec2(0.0, 1.0) + o), h21(i.xy + vec2(1.0) + o), f.x), f.y);
  o += 17.0;
  float b = mix(mix(h21(i.xy + o), h21(i.xy + vec2(1.0, 0.0) + o), f.x), mix(h21(i.xy + vec2(0.0, 1.0) + o), h21(i.xy + vec2(1.0) + o), f.x), f.y);
  return mix(a, b, f.z); }
`;
  function urbMat(uni) {
    const m = new T.MeshStandardMaterial({ roughness: 0.88, metalness: 0, side: T.DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 fcol; attribute vec2 fuv; attribute vec4 fst1; attribute vec4 fst2; attribute vec3 fpick;\nvarying vec3 v_col; varying vec2 v_uv; flat varying vec4 v_st1; flat varying vec4 v_st2; flat varying vec3 v_pick; varying vec3 v_wp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  v_col = fcol; v_uv = fuv; v_st1 = fst1; v_st2 = fst2; v_pick = fpick; v_wp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + fragHead(C.CMAT_MAX || 12))
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', [
          'float fGlass = 0.0, fLn = 0.0; vec3 fEm = vec3(0.0); float fKind = v_st2.w;',
          'vec3 fBase = v_col;',
          'if (fKind > 0.5 && fKind < 1.5) fBase = facade(fGlass, fLn, fEm);',
          'if (fKind > 3.5 && fKind < 4.5) fBase *= 0.84 + 0.3 * vn3(v_wp * 1.4);',
          'vec4 diffuseColor = vec4(toLin(fBase), opacity);'].join('\n'))
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.05, fGlass); metalnessFactor = mix(metalnessFactor, 0.3, fGlass);\n  if (fKind > 3.5 && fKind < 4.5) roughnessFactor = 0.96;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += toLin(fEm) * u_glow * 1.6;\n  if (fKind > 6.5 && fKind < 7.5) totalEmissiveRadiance += vec3(1.0, 0.92, 0.75) * u_glow * 3.0;');
    };
    m.customProgramCacheKey = () => 'urbify-facade-1';
    return m;
  }
  /* 이미지 재료(벽 사진): 3D 화면과 같은 방법으로 텍스처 배열을 만든다 */
  function cmTexture() {
    const app = UDS.app, N = C.CMAT_MAX || 12;
    const mats = (app.mats ? app.mats() : []).slice(0, N);
    const imgs = mats.map((m) => (app.matEl ? app.matEl(m.id) : null));
    const any = imgs.some(Boolean), Z = any ? C.CMAT_PX : 1, L = Math.max(1, mats.length);
    const data = new Uint8Array(Z * Z * 4 * L).fill(255);
    if (any) {
      const cv = document.createElement('canvas'); cv.width = cv.height = Z;
      const g = cv.getContext('2d', { willReadFrequently: true });
      imgs.forEach((img, i) => {
        if (!img) return;
        try { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, Z, Z); g.setTransform(1, 0, 0, -1, 0, Z); g.drawImage(img, 0, 0, Z, Z); data.set(g.getImageData(0, 0, Z, Z).data, i * Z * Z * 4); } catch (e) { /* 읽을 수 없는 그림은 흰 바탕 */ }
      });
    }
    const tex = new T.DataArrayTexture(data, Z, Z, L);
    tex.format = T.RGBAFormat; tex.type = T.UnsignedByteType; tex.colorSpace = T.NoColorSpace;
    tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.magFilter = T.LinearFilter;
    tex.minFilter = any ? T.LinearMipmapLinearFilter : T.LinearFilter; tex.generateMipmaps = any; tex.anisotropy = 8; tex.needsUpdate = true;
    const u = new Float32Array(N * 4), a = new Float32Array(N * 3).fill(0.5);
    mats.forEach((m, i) => {
      u[i * 4] = m.tile[0]; u[i * 4 + 1] = m.tile[1]; u[i * 4 + 2] = m.mirror ? 1 : 0; u[i * 4 + 3] = imgs[i] ? 1 : 0;
      const c = U.hexToRgb(m.color || '#808080'); a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2];
    });
    return { tex, u, a };
  }
  /* 3D 화면이 쌓은 도형(Builder) → three.js 도형 */
  function geom(b) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(b.P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(b.N, 3));
    g.setAttribute('fcol', new T.Float32BufferAttribute(b.Cl, 3));
    g.setAttribute('fuv', new T.Float32BufferAttribute(b.UV, 2));
    g.setAttribute('fst1', new T.Float32BufferAttribute(b.S1, 4));
    g.setAttribute('fst2', new T.Float32BufferAttribute(b.S2, 4));
    g.setAttribute('fpick', new T.Float32BufferAttribute(b.K, 3));
    g.setIndex(new T.Uint32BufferAttribute(windCCW(b), 1));
    g.computeBoundingSphere();
    return g;
  }
  /* 3D 화면은 면의 감기 방향을 쓰지 않아(법선을 그대로 씀) 수관 등이 거꾸로 감긴 곳이 있다.
     three.js는 앞뒤 면을 감기 방향으로 가리므로, 삼각형마다 법선과 같은 쪽을 보도록 감기 방향을 맞춘다 */
  function windCCW(b) {
    const I = Uint32Array.from(b.I), P = b.P, N = b.N;
    for (let t = 0; t + 2 < I.length; t += 3) {
      const a = I[t] * 3, c = I[t + 1] * 3, d = I[t + 2] * 3;
      const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const nx = N[a] + N[c] + N[d], ny = N[a + 1] + N[c + 1] + N[d + 1], nz = N[a + 2] + N[c + 2] + N[d + 2];
      if (fx * nx + fy * ny + fz * nz < 0) { const k = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = k; }
    }
    return I;
  }
  /* 하늘: 3D 화면과 같은 하늘색(위·지평선)에 해 둘레 빛. 카메라를 따라다니는 구 */
  const SKY_VS = `varying vec3 vDir; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vDir = normalize(wp.xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * wp; gl_Position.z = gl_Position.w; }`;
  const SKY_FS = `uniform vec3 top; uniform vec3 hor; uniform vec3 gnd; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vDir;
void main(){ vec3 d = normalize(vDir); float h = d.y;
  vec3 c = h > 0.0 ? mix(hor, top, smoothstep(0.0, 0.42, h)) : mix(hor, gnd, smoothstep(0.0, -0.12, h));
  float s = max(dot(d, sunDir), 0.0); c += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.18);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
  function skyMat() {
    return new T.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new T.Color() }, hor: { value: new T.Color() }, gnd: { value: new T.Color() }, sunDir: { value: new T.Vector3(0, 1, 0) }, sunCol: { value: new T.Color() } } });
  }

  /* ---------- 화면 ---------- */
  function html() {
    return `<canvas class="presCv" tabindex="0" aria-label="발표 화면 3D"></canvas>
<div class="presBar" role="toolbar" aria-label="발표 화면 도구">
  <b class="presT">발표 화면</b>
  <span class="seg presSeg" role="group" aria-label="보는 방식">
    <button data-pm="orbit" aria-pressed="true">둘러보기</button><button data-pm="walk" aria-pressed="false">눈높이 걷기</button><button data-pm="vr" aria-pressed="false">VR로 보기</button>
  </span>
  <span class="presSep"></span>
  <label class="presCk"><input type="checkbox" data-po="ao" checked>주변광 가림</label>
  <label class="presCk"><input type="checkbox" data-po="shadows" checked>그림자</label>
  <label class="presCk"><input type="checkbox" data-po="lines">선 겹치기</label>
  <span class="presGrow"></span>
  <button data-pa="shot">그림 저장</button><button data-pa="close" aria-label="발표 화면 닫기">닫기</button>
</div>
<div class="presHint" aria-live="polite"></div>
<div class="presLoad">three.js 불러오는 중…</div>`;
  }
  const HINT = {
    orbit: '끌기: 돌리기 · 오른쪽 끌기: 옮기기 · 휠: 가까이/멀리 · 두 번 누르기: 그 자리에서 걷기 시작',
    walk: 'W A S D·화살표: 걷기 · Shift: 빠르게 · 끌기: 둘러보기 · 두 번 누르기: 그 자리로 이동 · Esc: 닫기',
    vr: 'VR 기기 안: 왼쪽 막대로 걷기, 오른쪽 막대로 30°씩 돌기. 끝내려면 기기의 메뉴 단추',
  };

  PR.open = async function () {
    const app = UDS.app;
    if (S) return;
    if (!app.r3 || !app.r3.ok || !app.D) { UDS.ui && UDS.ui.toast('3D 화면을 쓸 수 없는 환경이라 발표 화면을 열 수 없습니다.'); return; }
    const root = document.createElement('div');
    root.className = 'pres'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', '발표 화면'); root.innerHTML = html();
    document.body.appendChild(root);
    S = { root, mode: 'orbit', keys: new Set(), opt: { ao: true, shadows: true, lines: false }, dirty: true, walk: null, vr: null, disposers: [] };
    try { await PR.load(); } catch (e) {
      const ld = $('.presLoad'); if (ld) ld.textContent = '발표 화면 파일(vendor/three-urbify.js)을 불러오지 못했습니다. 웹 주소(ohjooseok.github.io/urbify)에서 열었는지 확인해 주세요.';
      $('[data-pa="close"]').onclick = () => PR.close();
      return;
    }
    if (!S) return; // 불러오는 사이 닫음
    try { init(); } catch (e) {
      console.error(e);
      const ld = $('.presLoad'); if (ld) { ld.hidden = false; ld.textContent = '발표 화면을 만들지 못했습니다: ' + (e && e.message || e); }
    }
  };

  function init() {
    const app = UDS.app, P = app.P, r3 = app.r3;
    const cv = $('.presCv');
    const renderer = new T.WebGLRenderer({ canvas: cv, antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = T.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.xr.enabled = true;
    const scene = new T.Scene();
    const site = P.site, R = Math.hypot(site.w, site.h) * 0.62 + 30, cen = new T.Vector3(site.w / 2, 0, -site.h / 2);
    const camera = new T.PerspectiveCamera(45, 1, 0.5, R * 8 + 2500);
    const rig = new T.Group(); rig.add(camera); scene.add(rig); // VR에서는 rig를 옮겨 사람을 옮긴다
    Object.assign(S, { renderer, scene, camera, rig, R, cen, cv });
    // 모형
    const cm = cmTexture();
    S.uni = { u_lit: { value: 0.3 }, u_glow: { value: 0 }, u_cm: { value: cm.u }, u_cmA: { value: cm.a }, u_cmTex: { value: cm.tex } };
    S.mat = urbMat(S.uni);
    const B = r3.buildScene({ atlas: null, present: true });
    S.model = new T.Group(); scene.add(S.model);
    const add = (b, o) => {
      if (!b || !b.I || !b.I.length) return null;
      const m = new T.Mesh(geom(b), S.mat);
      m.castShadow = !!o.cast; m.receiveShadow = true;
      if (o.ground) { m.renderOrder = o.order; } // 바닥은 3D 화면처럼 그리는 순서로 겹친다(깊이 다툼 없이)
      S.model.add(m); return m;
    };
    S.ground = [add(B.ground, { ground: true, order: -3 }), add(B.ground2, { ground: true, order: -2 })].filter(Boolean);
    S.ground.forEach((m) => { m.material = S.gmat = S.gmat || groundMat(); });
    add(B.solid, { cast: true }); add(B.leaf, { cast: true });
    S.edges = B.edges;
    S.disposers.push(() => cm.tex.dispose());
    // 하늘·빛
    S.sky = new T.Mesh(new T.SphereGeometry(1, 32, 16), skyMat()); S.sky.frustumCulled = false; S.sky.renderOrder = -10; scene.add(S.sky);
    S.sun = new T.DirectionalLight(0xffffff, 2); S.sun.castShadow = true; scene.add(S.sun); scene.add(S.sun.target);
    S.sun.shadow.mapSize.set(4096, 4096);
    const sc = S.sun.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 1400 + R * 2; sc.updateProjectionMatrix();
    S.sun.shadow.bias = -0.0004; S.sun.shadow.normalBias = 1.2 * (2 * R / 4096);
    S.hemi = new T.HemisphereLight(0xffffff, 0x888888, 1); scene.add(S.hemi);
    S.pmrem = new T.PMREMGenerator(renderer);
    // 화면 뒤처리: 다중 표본(계단 줄임) → 주변광 가림 → 톤·색 맞춤
    const rt = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, samples: 4 });
    const comp = new T.EffectComposer(renderer, rt);
    comp.addPass(new T.RenderPass(scene, camera));
    const gtao = new T.GTAOPass(scene, camera, 4, 4);
    gtao.updateGtaoMaterial({ radius: 3.2, distanceExponent: 1.4, thickness: 2.0, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    gtao.blendIntensity = 1.0;
    comp.addPass(gtao); comp.addPass(new T.OutputPass());
    Object.assign(S, { comp, gtao });
    light();
    // 처음 시점: 3D 화면의 카메라 그대로
    const c3 = r3.cam, e = r3.eye();
    camera.fov = c3.fov * 180 / Math.PI; camera.position.set(e[0], e[1], e[2]);
    S.orbit = new T.OrbitControls(camera, cv);
    S.orbit.target.set(c3.tx, c3.ty, c3.tz); S.orbit.enableDamping = true; S.orbit.dampingFactor = 0.09;
    S.orbit.maxPolarAngle = Math.PI * 0.495; S.orbit.zoomToCursor = true; S.orbit.screenSpacePanning = false;
    S.orbit.minDistance = 3; S.orbit.maxDistance = R * 5;
    S.orbit.addEventListener('change', () => { S.dirty = true; });
    S.orbit.update();
    S.polys = footprints();
    S.lines = null;
    // 이벤트
    S.root.addEventListener('click', onClick);
    S.root.addEventListener('change', onChange);
    cv.addEventListener('dblclick', onDbl);
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKeyUp, true);
    S.ro = new ResizeObserver(() => { resize(); S.dirty = true; }); S.ro.observe(S.root);
    resize();
    renderer.shadowMap.needsUpdate = true;
    if (!(navigator.xr && navigator.xr.isSessionSupported)) $('[data-pm="vr"]').dataset.na = '1';
    S.t0 = performance.now();
    renderer.setAnimationLoop(tick);
    $('.presLoad').hidden = true;
    setHint();
    cv.focus();
    PR.ready = true;
  }
  function groundMat() { // 바닥: 깊이를 보지 않고 순서대로 그린다(3D 화면과 같음). 그림자는 받는다
    const m = urbMat(S.uni); m.depthTest = false; m.customProgramCacheKey = () => 'urbify-facade-1';
    return m;
  }
  /* 해·하늘을 3D 화면의 시각·날짜 설정(UDS.sky)에 맞춘다 */
  function light() {
    const P = UDS.app.P, sky = UDS.sky(P.settings), R = S.R, cen = S.cen;
    const sd = new T.Vector3(sky.dir[0], sky.dir[2], -sky.dir[1]).normalize();
    const lc = sky.lightCol, li = Math.max(lc[0], lc[1], lc[2], 1e-3);
    S.sun.color.setRGB(...lin(lc.map((v) => v / li)));
    S.sun.intensity = Math.PI * li * 1.35;
    S.sun.position.copy(cen).addScaledVector(sd, 700); S.sun.target.position.copy(cen); S.sun.target.updateMatrixWorld();
    S.sun.castShadow = S.opt.shadows && !!sky.shadows;
    S.hemi.color.setRGB(...lin(sky.ambSky)); S.hemi.groundColor.setRGB(...lin(sky.ambGnd)); S.hemi.intensity = Math.PI * 0.62;
    const su = S.sky.material.uniforms;
    su.top.value.setRGB(...lin(sky.top.map((v, i) => v + ([0.36, 0.55, 0.86][i] - v) * 0.35 * sky.day))); // 발표 화면은 하늘 꼭대기를 조금 더 푸르게 su.hor.value.setRGB(...lin(sky.hor)); su.gnd.value.setRGB(...lin(sky.hor.map((v, i) => v * 0.8 + sky.ambGnd[i] * 0.2)));
    su.sunDir.value.copy(sd); su.sunCol.value.setRGB(...lin(lc.map((v) => v / li))).multiplyScalar(sky.moon ? 0.15 : Math.min(1, sky.day + 0.15));
    S.scene.fog = new T.Fog(new T.Color().setRGB(...lin(sky.hor)), R * 1.6, R * 6 + 1500);
    S.uni.u_lit.value = 0.22 + 0.38 * sky.night; S.uni.u_glow.value = sky.glow;
    // 유리에 비칠 하늘(주변 빛): 같은 하늘 구를 작은 장면에 넣어 미리 거른다
    const env = new T.Scene(), dome = new T.Mesh(new T.SphereGeometry(50, 32, 16), S.sky.material); env.add(dome);
    if (S.envTex) S.envTex.dispose();
    S.envTex = S.pmrem.fromScene(env, 0.02).texture;
    dome.geometry.dispose();
    S.scene.environment = S.envTex; S.scene.environmentIntensity = 0.55 * Math.max(0.15, sky.day);
    S.renderer.shadowMap.needsUpdate = true; S.dirty = true;
  }
  /* 걷기 충돌용 건물 바닥 모양(계획 건물 + 현황 건물) */
  function footprints() {
    const app = UDS.app, out = [];
    const push = (pts) => { if (!pts || pts.length < 3) return; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; pts.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); out.push({ pts, bb: [x0, y0, x1, y1] }); };
    if (app.state.layers.buildings) (app.D.buildings || []).forEach((b) => push(b.fp));
    const cx = app.ctxData ? app.ctxData() : null, V = app.D.ctxV, X = UDS.Ctx;
    if (cx && V && app.state.layers.ctx !== false) cx.bld.forEach((b) => { if (X.shown(V, b.id)) b.parts.forEach((pt) => push(pt.o)); });
    return out;
  }
  function blocked(x, y) { // 계획 좌표(x 동, y 북)
    const r = BODY;
    for (const f of S.polys) {
      const b = f.bb; if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) continue;
      if (U.pointInPoly([x, y], f.pts)) return true;
      const P = f.pts;
      for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length]; if (U.distPointSeg([x, y], a, c).d < r) return true; }
    }
    return false;
  }
  function freeNear(x, y) { // 건물 안이면 가장 가까운 빈 자리
    if (!blocked(x, y)) return [x, y];
    for (let r = 1; r < 80; r += 1) for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (!blocked(px, py)) return [px, py]; }
    return [x, y];
  }

  /* ---------- 보는 방식 ---------- */
  function setMode(m) {
    if (!S || !S.renderer) return;
    if (m === 'vr') { enterVR(); return; }
    const cam = S.camera;
    if (m === 'walk') {
      let x, y, yaw;
      if (S.walkAt) { [x, y] = S.walkAt; yaw = S.walkYaw; S.walkAt = null; }
      else {
        const t = S.orbit.target, d = new T.Vector3().subVectors(t, cam.position);
        x = t.x; y = -t.z; yaw = Math.atan2(-d.x, -d.z);
      }
      [x, y] = freeNear(x, y);
      S.walk = { x, y, yaw: yaw || 0, pitch: -0.05 };
      S.orbit.enabled = false;
      cam.near = 0.12; cam.updateProjectionMatrix();
      applyWalk();
    } else {
      if (S.mode === 'walk' && S.walk) { // 걷던 자리를 내려다보는 시점으로
        const w = S.walk, f = new T.Vector3(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
        S.orbit.target.set(w.x, 0, -w.y).addScaledVector(f, 25);
        cam.position.set(w.x, 0, -w.y).addScaledVector(f, -45); cam.position.y = 38;
      }
      S.orbit.enabled = true;
      cam.near = 0.5; cam.updateProjectionMatrix();
      S.orbit.update();
    }
    S.mode = m;
    S.root.querySelectorAll('[data-pm]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pm === m)));
    setHint(); S.dirty = true;
    S.cv.focus();
  }
  function applyWalk() {
    const w = S.walk, cam = S.camera;
    cam.position.set(w.x, EYE, -w.y);
    cam.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  }
  function setHint() { const h = $('.presHint'); if (h) h.textContent = HINT[S.vr ? 'vr' : S.mode] || ''; }
  function stepWalk(dt) {
    const w = S.walk, k = S.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (!f && !s) return false;
    const sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK) * dt;
    const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw), rx = Math.cos(w.yaw), rz = -Math.sin(w.yaw);
    let dx = (fx * f + rx * s), dz = (fz * f + rz * s); const L = Math.hypot(dx, dz) || 1; dx = dx / L * sp; dz = dz / L * sp;
    const nx = w.x + dx, ny = w.y - dz; // 계획 좌표: y = -z
    if (!blocked(nx, w.y)) w.x = nx; // 벽을 따라 미끄러지게 축마다 따로
    if (!blocked(w.x, ny)) w.y = ny;
    applyWalk();
    return true;
  }
  /* ---------- VR(WebXR) ---------- */
  async function enterVR() {
    const xr = navigator.xr;
    let ok = false;
    try { ok = !!(xr && await xr.isSessionSupported('immersive-vr')); } catch (e) { ok = false; }
    if (!ok) { UDS.ui.toast('이 브라우저·기기에서는 VR(WebXR)을 쓸 수 없습니다. VR 기기의 브라우저(예: Meta Quest 브라우저)에서 이 주소를 열어 주세요.'); return; }
    if (S.mode !== 'walk') setMode('walk');
    let sess;
    try { sess = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] }); }
    catch (e) { UDS.ui.toast('VR을 시작하지 못했습니다. 기기에서 허용했는지 확인해 주세요.'); return; }
    S.renderer.xr.setReferenceSpaceType('local-floor');
    await S.renderer.xr.setSession(sess);
    S.vr = sess; S.turned = false;
    const w = S.walk; S.rig.position.set(w.x, 0, -w.y); S.rig.rotation.set(0, w.yaw, 0);
    S.camera.position.set(0, 0, 0); S.camera.rotation.set(0, 0, 0);
    S.root.querySelectorAll('[data-pm]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pm === 'vr')));
    setHint();
    sess.addEventListener('end', () => {
      S.vr = null; S.rig.position.set(0, 0, 0); S.rig.rotation.set(0, 0, 0);
      setMode('walk');
    });
  }
  function stepVR(dt) {
    for (const src of S.vr.inputSources) {
      const gp = src.gamepad; if (!gp || gp.axes.length < 4) continue;
      const ax = gp.axes[2], ay = gp.axes[3];
      if (src.handedness === 'left' && (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15)) {
        const xc = S.renderer.xr.getCamera(), d = new T.Vector3(); xc.getWorldDirection(d); d.y = 0; d.normalize();
        const r = new T.Vector3(-d.z, 0, d.x), sp = WALK * 1.4 * dt;
        const mv = new T.Vector3().addScaledVector(d, -ay * sp).addScaledVector(r, ax * sp);
        const nx = S.rig.position.x + mv.x, nz = S.rig.position.z + mv.z;
        if (!blocked(nx, -S.rig.position.z)) S.rig.position.x = nx;
        if (!blocked(S.rig.position.x, -nz)) S.rig.position.z = nz;
      }
      if (src.handedness === 'right') {
        if (Math.abs(ax) > 0.65 && !S.turned) { S.rig.rotation.y -= Math.sign(ax) * Math.PI / 6; S.turned = true; }
        else if (Math.abs(ax) < 0.3) S.turned = false;
      }
    }
  }
  /* ---------- 선 겹치기: 3D 선 도면과 같은 굵기 위계의 선을 사실적 모형 위에 ---------- */
  const LINE_PX = [0.6, 0.9, 1.5, 2.4];
  function buildLines() {
    const L = S.edges; if (!L || !L.P.length) return null;
    const by = [[], [], [], []];
    for (let i = 0, n = L.P.length / 6; i < n; i++) { const w = L.Wt ? L.Wt[i] : 1; by[w].push(L.P[i * 6], L.P[i * 6 + 1], L.P[i * 6 + 2], L.P[i * 6 + 3], L.P[i * 6 + 4], L.P[i * 6 + 5]); }
    const g = new T.Group();
    by.forEach((arr, w) => {
      if (!arr.length) return;
      const lg = new T.LineSegmentsGeometry(); lg.setPositions(arr);
      const lm = new T.LineMaterial({ color: 0x1d1f22, linewidth: LINE_PX[w], worldUnits: false });
      lm.polygonOffset = true; lm.polygonOffsetFactor = -2; lm.polygonOffsetUnits = -2;
      const ls = new T.LineSegments2(lg, lm); ls.frustumCulled = false; ls.renderOrder = 2; g.add(ls);
    });
    return g;
  }
  function setLines(on) {
    if (on && !S.lines) { S.lines = buildLines(); if (S.lines) S.scene.add(S.lines); }
    if (S.lines) S.lines.visible = on;
    S.mat.polygonOffset = on; S.mat.polygonOffsetFactor = 1; S.mat.polygonOffsetUnits = 2; S.mat.needsUpdate = true;
    resize(); S.dirty = true;
  }

  /* ---------- 그리기 ---------- */
  function resize() {
    if (!S || !S.renderer) return;
    const r = S.root.getBoundingClientRect(), w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (S.vr) return;
    S.renderer.setSize(w, h, false);
    S.comp.setPixelRatio(S.renderer.getPixelRatio()); S.comp.setSize(w, h);
    S.camera.aspect = w / h; S.camera.updateProjectionMatrix();
    if (S.lines) S.lines.children.forEach((l) => l.material.resolution.set(w * S.renderer.getPixelRatio(), h * S.renderer.getPixelRatio()));
    S.w = w; S.h = h;
  }
  function tick() {
    if (!S || !S.renderer) return;
    const now = performance.now(), dt = Math.min(0.25, (now - S.t0) / 1000); S.t0 = now;
    if (S.vr) { stepVR(dt); S.sky.position.copy(S.rig.position); S.renderer.render(S.scene, S.camera); return; }
    if (S.mode === 'walk') { if (stepWalk(dt)) S.dirty = true; }
    else if (S.orbit.update()) S.dirty = true;
    if (!S.dirty) return;
    S.dirty = false;
    draw();
  }
  function draw() {
    S.sky.position.copy(S.camera.position);
    S.gtao.enabled = S.opt.ao;
    S.comp.render();
    S.frames = (S.frames || 0) + 1;
  }
  function shot() { // 지금 화면을 두 배 해상도로 그려 그림으로
    const r = S.renderer, pr = r.getPixelRatio(), k = Math.min(2, 4096 / Math.max(S.w * pr, S.h * pr));
    let url = '';
    try {
      r.setPixelRatio(pr * k); resize(); draw(); url = S.cv.toDataURL('image/png');
    } catch (e) { url = ''; } finally { r.setPixelRatio(pr); resize(); S.dirty = true; }
    if (!url || url.length < 100) { UDS.ui.toast('그림을 만들지 못했습니다.'); return; }
    const base = (UDS.app.P.meta.title || '도시설계').replace(/[\\/:*?"<>|\s]+/g, '_');
    UDS.ui.exportImage('발표 화면 그림', url, `${base}_발표화면.png`);
  }

  /* ---------- 입력 ---------- */
  function onClick(e) {
    const pm = e.target.closest('[data-pm]'); if (pm) { setMode(pm.dataset.pm); return; }
    const pa = e.target.closest('[data-pa]'); if (!pa) return;
    if (pa.dataset.pa === 'close') PR.close();
    else if (pa.dataset.pa === 'shot') shot();
  }
  function onChange(e) {
    const k = e.target.dataset && e.target.dataset.po; if (!k) return;
    S.opt[k] = !!e.target.checked;
    if (k === 'shadows') light();
    else if (k === 'lines') setLines(S.opt.lines);
    S.dirty = true; S.cv.focus();
  }
  function groundAt(e) { // 화면의 한 점 → 땅(y=0) 위 계획 좌표
    const r = S.cv.getBoundingClientRect(), nd = new T.Vector3(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0.5);
    nd.unproject(S.camera);
    const o = S.camera.position, d = nd.sub(o).normalize();
    if (d.y > -1e-4) return null;
    const t = (0 - o.y) / d.y;
    return [o.x + d.x * t, -(o.z + d.z * t)];
  }
  function onDbl(e) {
    const g = groundAt(e); if (!g) return;
    const cam = S.camera, dx = g[0] - cam.position.x, dz = -g[1] - cam.position.z, yaw = Math.atan2(-dx, -dz); // 카메라에서 그 점을 바라보던 방향 그대로
    if (S.mode === 'walk') { const p = freeNear(g[0], g[1]); S.walk.x = p[0]; S.walk.y = p[1]; applyWalk(); S.dirty = true; return; }
    S.walkAt = g; S.walkYaw = yaw; setMode('walk');
  }
  function onDown(e) { if (S.mode !== 'walk') return; S.drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; try { S.cv.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ } }
  function onMove(e) {
    if (S.mode !== 'walk' || !S.drag || S.drag.id !== e.pointerId) return;
    const w = S.walk; w.yaw -= (e.clientX - S.drag.x) * LOOK; w.pitch = U.clamp(w.pitch - (e.clientY - S.drag.y) * LOOK, -1.35, 1.35);
    S.drag.x = e.clientX; S.drag.y = e.clientY; applyWalk(); S.dirty = true;
  }
  function onUp(e) { if (S.drag && S.drag.id === e.pointerId) S.drag = null; }
  const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];
  function onKey(e) {
    if (!S) return;
    if (document.querySelector('.scrim:not([hidden])') && !S.root.contains(e.target)) return; // 대화창(그림 저장 등)이 떠 있으면 그쪽에
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); PR.close(); return; }
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'checkbox') return;
    if (MOVE_KEYS.includes(e.code)) { e.preventDefault(); S.keys.add(e.code); if (S.mode !== 'walk' && !e.code.startsWith('Shift')) setMode('walk'); }
    e.stopPropagation(); // 발표 화면이 열려 있는 동안 계획 화면의 단축키는 쉬게
  }
  function onKeyUp(e) { if (!S) return; S.keys.delete(e.code); if (MOVE_KEYS.includes(e.code)) e.stopPropagation(); }

  PR.close = function () {
    if (!S) return;
    const s = S; S = null; PR.ready = false;
    try { if (s.vr) s.vr.end(); } catch (e) { /* 무시 */ }
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true);
    if (s.ro) s.ro.disconnect();
    if (s.renderer) {
      s.renderer.setAnimationLoop(null);
      s.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      [s.mat, s.gmat, s.sky && s.sky.material].forEach((m) => m && m.dispose());
      if (s.lines) s.lines.children.forEach((l) => l.material.dispose());
      if (s.envTex) s.envTex.dispose();
      s.disposers.forEach((f) => f());
      if (s.pmrem) s.pmrem.dispose();
      if (s.comp) s.comp.dispose();
      if (s.orbit) s.orbit.dispose();
      s.renderer.dispose(); s.renderer.forceContextLoss();
    }
    s.root.remove();
    if (UDS.app && UDS.app.r3) UDS.app.invalidate(2);
  };
  PR.state = () => S; // 검사용
  PR.test = { step: (dt) => stepWalk(dt), blocked: (x, y) => blocked(x, y), setMode: (m) => setMode(m), shot: () => shot() };
})(window);
