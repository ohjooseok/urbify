#!/usr/bin/env python3
"""수업 대상지 자료 만들기: 브이월드·국가공간정보포털에서 내려받은 SHP(GIS건물통합정보·연속지적도)를
Urbify가 읽는 꼴(브이월드 WFS와 같은 속성 이름의 GeoJSON, 경위도)로 바꿔 범위만큼 잘라 src/data/에 둔다.

  python tools/shp2bundle.py --id jochiwon --name "조치원 (2026 도시설계 스튜디오)" \
      --bld AL_D010_36_20261101.shp --par LSMD_CONT_LDREG_36110.shp \
      --bbox 127.280,36.585,127.315,36.615 [--date 2026-11-01]

- 좌표계는 .prj에서 읽는다(없으면 --epsg로, 흔히 5186 또는 5174).
- 건물 속성은 영문 이름(gis_idntfc_no, buld_prpos_code …)이든 A0–A28 같은 부호든 아래 표로 맞춘다. 모르는 꼴이면 필드 목록을 보여 주고 멈춘다.
- 지적은 PNU의 법정동(앞 10자리)으로 거를 수 있다(--pnu 3611025000 처럼 앞자리만).
- 결과: src/data/<id>.json, src/data/sites.json(목록에 더하거나 바꿈). build.py가 docs/data/로 옮긴다."""
import argparse, datetime, json, pathlib, sys

try:
    import shapefile  # pyshp
    from pyproj import CRS, Transformer
except ImportError:
    sys.exit('pip install pyshp pyproj 가 필요합니다.')

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'src' / 'data'

# 브이월드 WFS 속성 이름 ← SHP 필드 이름(여러 꼴)
BLD_MAP = {
    'gis_idntfc_no': ['gis_idntfc_no', 'GIS_IDNTFC', 'A1'],
    'pnu': ['pnu', 'PNU', 'A2'],
    'buld_prpos_code': ['buld_prpos_code', 'BULD_PRPOS', 'A8'],
    'strct_code': ['strct_code', 'STRCT_CODE', 'A10'],
    'ar': ['ar', 'AR', 'BULD_AR', 'A12'],
    'use_confm_de': ['use_confm_de', 'USE_CONFM_', 'A13'],
    'totar': ['totar', 'TOTAR', 'A14'],
    'plot_ar': ['plot_ar', 'PLOT_AR', 'A15'],
    'hg': ['hg', 'HG', 'BULD_HG', 'A16'],
    'btl_rt': ['btl_rt', 'BTL_RT', 'A17'],
    'measrmt_rt': ['measrmt_rt', 'MEASRMT_RT', 'A18'],
    'violt_bild': ['violt_bild', 'VIOLT_BULD', 'A20'],
    'buld_nm': ['buld_nm', 'BULD_NM', 'A24'],
    'dong_nm': ['dong_nm', 'DONG_NM', 'A25'],
    'ground_floor_co': ['ground_floor_co', 'GROUND_FLO', 'GRND_FLR', 'A26'],
    'undgrnd_floor_co': ['undgrnd_floor_co', 'UNDGRND_FL', 'UGRND_FLR', 'A27'],
    'data_creat_change_de': ['data_creat_change_de', 'DATA_CREAT', 'A28'],
}
PAR_MAP = {
    'pnu': ['pnu', 'PNU', 'A1'],
    'jibun': ['jibun', 'JIBUN', 'A5'],
    'lnm_lndcgr_smbol': ['lnm_lndcgr_smbol', 'LNM_LNDCGR', 'JIBUN', 'A5'],
}


def field_map(names, table):
    low = {n.lower(): n for n in names}
    out = {}
    for k, cands in table.items():
        for c in cands:
            if c in names: out[k] = c; break
            if c.lower() in low: out[k] = low[c.lower()]; break
    return out


def transformer(shp_path, epsg):
    prj = pathlib.Path(shp_path).with_suffix('.prj')
    src = CRS.from_wkt(prj.read_text(encoding='utf-8', errors='ignore')) if prj.exists() else CRS.from_epsg(epsg or 5186)
    return Transformer.from_crs(src, CRS.from_epsg(4326), always_xy=True), src


def rings_to_geom(shape, tf):
    """shapefile 다각형(부분 = 고리) → GeoJSON MultiPolygon. 바깥 고리는 시계 방향(shapefile 규칙), 구멍은 반시계"""
    pts = shape.points
    parts = list(shape.parts) + [len(pts)]
    polys = []
    for i in range(len(parts) - 1):
        ring = pts[parts[i]:parts[i + 1]]
        if len(ring) < 4: continue
        a = sum(ring[j][0] * ring[(j + 1) % len(ring)][1] - ring[(j + 1) % len(ring)][0] * ring[j][1] for j in range(len(ring))) / 2
        ll = [list(map(lambda v: round(v, 7), tf.transform(x, y))) for x, y in ring]
        if a <= 0 or not polys: polys.append([ll])  # 시계(음) → 바깥 고리
        else: polys[-1].append(ll)
    return {'type': 'MultiPolygon', 'coordinates': polys} if polys else None


def inside(geom, bbox):
    w, s, e, n = bbox
    xs = [p[0] for poly in geom['coordinates'] for p in poly[0]]
    ys = [p[1] for poly in geom['coordinates'] for p in poly[0]]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    return w <= cx <= e and s <= cy <= n


def read(path, table, bbox, epsg, encoding, pnu=None):
    r = shapefile.Reader(str(path), encoding=encoding)
    names = [f[0] for f in r.fields[1:]]
    fm = field_map(names, table)
    print(f'{pathlib.Path(path).name}: {len(r)}개, 필드 {names}')
    print('  맞춘 속성:', fm)
    tf, crs = transformer(path, epsg)
    print('  좌표계:', crs.name)
    feats = []
    for sr in r.iterShapeRecords():
        if sr.shape.shapeType not in (5, 15, 25): continue
        rec = sr.record.as_dict()
        props = {k: rec.get(v) for k, v in fm.items()}
        for k, v in list(props.items()):
            if isinstance(v, (datetime.date, datetime.datetime)): props[k] = v.strftime('%Y%m%d')
            elif isinstance(v, bytes): props[k] = v.decode(encoding, errors='ignore')
            elif v is None: props[k] = ''
        if pnu and not str(props.get('pnu', '')).startswith(pnu): continue
        g = rings_to_geom(sr.shape, tf)
        if not g or not inside(g, bbox): continue
        fid = str(props.get('gis_idntfc_no') or props.get('pnu') or len(feats))
        feats.append({'type': 'Feature', 'id': fid, 'properties': props, 'geometry': g})
    return {'type': 'FeatureCollection', 'features': feats}, fm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', required=True); ap.add_argument('--name', required=True)
    ap.add_argument('--bld', required=True); ap.add_argument('--par')
    ap.add_argument('--bbox', required=True, help='서,남,동,북 (경위도)')
    ap.add_argument('--epsg', type=int); ap.add_argument('--encoding', default='cp949')
    ap.add_argument('--pnu', help='지적을 거를 PNU 앞자리(예: 법정동 코드)')
    ap.add_argument('--date', default=datetime.date.today().isoformat())
    a = ap.parse_args()
    bbox = [float(v) for v in a.bbox.split(',')]
    bld, fm = read(a.bld, BLD_MAP, bbox, a.epsg, a.encoding)
    if 'ground_floor_co' not in fm or 'buld_prpos_code' not in fm:
        sys.exit('건물 SHP의 층수·용도 필드를 찾지 못했습니다. 위의 필드 목록을 보고 BLD_MAP을 고치세요.')
    par = read(a.par, PAR_MAP, bbox, a.epsg, a.encoding, a.pnu)[0] if a.par else {'type': 'FeatureCollection', 'features': []}
    src = f"브이월드 GIS건물통합정보·연속지적도({a.date} 기준, 수업용)"
    DATA.mkdir(parents=True, exist_ok=True)
    out = DATA / f'{a.id}.json'
    out.write_text(json.dumps({'src': src, 'date': a.date, 'bld': bld, 'par': par}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    sites_p = DATA / 'sites.json'
    sites = json.loads(sites_p.read_text(encoding='utf-8')) if sites_p.exists() else []
    sites = [s for s in sites if s.get('id') != a.id]
    sites.append({'id': a.id, 'name': a.name, 'bbox': bbox, 'center': [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2], 'file': f'data/{a.id}.json', 'src': src, 'date': a.date})
    sites_p.write_text(json.dumps(sites, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'건물 {len(bld["features"])}동, 필지 {len(par["features"])}필지 → {out} ({out.stat().st_size:,} bytes), 목록 {sites_p}')


if __name__ == '__main__':
    main()
