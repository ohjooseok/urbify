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
  console.log('rel',r.rel,'tiles',r.tiles,'bld',r.bld.length,r.bld.map(f=>f.id+':'+JSON.stringify({fl:f.properties.ground_floor_co,hg:f.properties.hg,c:f.properties.buld_prpos_code,g:f.properties._fl,n:f.properties.buld_nm})).join(' | '));
  console.log('segs',r.segs.length,'rails',r.rails.length,[...new Set(r.segs.map(s=>s.cls+'/'+(s.name||'-')+(s.ow?'(ow)':'')))].join(', '));
  const B=X.buildings(r.bld,F);
  console.log('buildings in site',B.length,B.map(b=>b.id+' fl'+b.fl+' h'+b.h+' est'+(b.est||'-')+' cat'+b.cat+' holes'+b.parts[0].h.length).join(' | '));
  const S=O.streets(r.segs,F);
  console.log('streets',S.streets.length,'rabs',JSON.stringify(S.rabs),'dual',S.dual);
  S.streets.forEach(s=>console.log('  ',s.cls,s.name||'-','w'+s.w,'len'+Math.round(s.len),'pts'+s.pts.length,JSON.stringify(s.pts[0]),JSON.stringify(s.pts[s.pts.length-1]),s.dual?'dual':''));
  const rp=O.railParcels(r.rails,F); console.log('rail parcels',rp.length);
  // seam test
  const F2=X.frame(36.6012+300/F.mLat,127.2975+1100/F.mLon,300,300);
  const r2=await O.fetchArea(X.bbox(F2,45),{});
  console.log('seam tiles',r2.tiles,'bld',r2.bld.map(f=>f.id+' rings'+f.geometry.coordinates[0][0].length+' lonmax'+Math.max(...f.geometry.coordinates[0][0].map(p=>p[0])).toFixed(5)+' lonmin'+Math.min(...f.geometry.coordinates[0][0].map(p=>p[0])).toFixed(5)).join(' | '));
  const S2=O.streets(r2.segs,F2); console.log('seam streets',S2.streets.map(s=>s.name+' len'+Math.round(s.len)+' pts'+s.pts.length).join(' | '));
})().catch(e=>{console.error('ERR',e);process.exit(1)});
