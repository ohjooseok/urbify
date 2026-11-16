const fs=require('fs');
global.window=global; global.document={createElement:()=>({getContext:()=>null})};
global.localStorage={getItem:()=>null,setItem:()=>{}};
eval(fs.readFileSync('src/js/util.js','utf8'));
eval(fs.readFileSync('src/js/ctx.js','utf8'));
eval(fs.readFileSync('src/js/overture.js','utf8'));
const base=__dirname+'/data/ovt/';
global.fetch=async (url,init)=>{
  if(url.includes('stac')) return new Response(fs.readFileSync(base+'catalog.json'),{status:200});
  const m=url.match(/tiles\.overturemaps\.org\/(.+)$/); const f=fs.readFileSync(base+m[1]);
  const rg=init&&init.headers&&init.headers.Range; const mm=/bytes=(\d+)-(\d+)/.exec(rg||'');
  if(!mm) return new Response(f,{status:200});
  const a=+mm[1],b=Math.min(+mm[2],f.length-1); return new Response(f.subarray(a,b+1),{status:206});
};
(async()=>{
  const O=UDS.Ovt,X=UDS.Ctx;
  const F=X.frame(36.6012,127.2975,500,500);
  const r=await O.fetchArea(X.bbox(F,45),{});
  const S=O.streets(r.segs,F);
  const C=S.rabs[0].p; let arms=[];
  S.streets.forEach(s=>[s.pts[0],s.pts[s.pts.length-1]].forEach((p,i)=>{ if(Math.hypot(p[0]-C[0],p[1]-C[1])<1){ const q=i?s.pts[s.pts.length-2]:s.pts[1]; arms.push(Math.round(Math.atan2(q[1]-C[1],q[0]-C[0])*180/Math.PI)+':'+(s.name||s.cls)); }}));
  const near=S.streets.filter(s=>s.pts.every(p=>Math.hypot(p[0]-C[0],p[1]-C[1])<60)&&!s.pts.some(p=>Math.hypot(p[0]-C[0],p[1]-C[1])<1));
  console.log('arms',arms.length,arms.join(' '),'| bypass',near.length);
  if(arms.length!==4||near.length) { console.log('FAIL'); process.exit(1);} console.log('OK');
})().catch(e=>{console.error('ERR',e);process.exit(1)});
