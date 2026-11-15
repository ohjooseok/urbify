#!/usr/bin/env python3
"""브이월드 국가중점데이터 WFS(dt_d010 건물, dt_d002 지적) 응답과 같은 꼴의 가상 자료를 만든다.
기울어진 격자 도로망(대로·중로·소로·골목, 막다른 골목), 필지(도로 필지 조각 포함), 건물(층수·높이 누락, 중정, 여러 부분)."""
import json, math, random, pathlib

random.seed(7)
LAT0, LON0 = 37.5894, 127.0323
r = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * r) + 1.175 * math.cos(4 * r)
M_LON = 111412.84 * math.cos(r) - 93.5 * math.cos(3 * r)
TH = math.radians(12)
OUT = pathlib.Path(__file__).parent / 'data'
OUT.mkdir(exist_ok=True)

def ll(x, y):  # 중심 기준 m → [경도, 위도]
    return [round(LON0 + x / M_LON, 8), round(LAT0 + y / M_LAT, 8)]

def rot(u, v):
    return (u * math.cos(TH) - v * math.sin(TH), u * math.sin(TH) + v * math.cos(TH))

def rect(u0, v0, u1, v1):
    return [rot(u0, v0), rot(u1, v0), rot(u1, v1), rot(u0, v1)]

def ring(pts):
    c = [ll(*p) for p in pts]
    return c + [c[0]]

def bbox_of(rings):
    xs = [p[0] for rg in rings for p in rg]; ys = [p[1] for rg in rings for p in rg]
    return [min(xs), min(ys), max(xs), max(ys)]

HALF = 200  # 대상지 400m
def hits_site(pts, pad=0):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return max(xs) >= -HALF - pad and min(xs) <= HALF + pad and max(ys) >= -HALF - pad and min(ys) <= HALF + pad

# 도로선: (좌표, 폭)
UL = [(-235, 8), (-170, 10), (-60, 20), (40, 8), (125, 12), (215, 6)]   # u = const (세로)
VL = [(-230, 6), (-180, 10), (-95, 20), (-20, 8), (60, 6), (140, 12), (225, 8)]  # v = const (가로)
LIM = 300

parcels, buildings = [], []
pid = [1000]
def jibun():
    pid[0] += 1
    return pid[0]

def add_parcel(pts, jm, holes=None):
    n = jibun()
    sl = random.choice([0, 0, 1, 2, 3, 5, 7, 12])
    no = f"{n}" + (f"-{sl}" if sl else '')
    rings = [ring(pts)] + [ring(h) for h in (holes or [])]
    pnu = f"1129013300{1 if jm != '임' else 2}{n:04d}{sl:04d}"
    parcels.append({
        'type': 'Feature', 'id': f'dt_d002.{len(parcels) + 1}',
        'geometry': {'type': 'MultiPolygon', 'coordinates': [rings]},
        'geometry_name': 'ag_geom',
        'properties': {'pnu': pnu, 'lnm_lndcgr_smbol': f'{no} {jm}', 'issu_confm_code': '', 'src_objectid': len(parcels) + 1,
                        'src_ld_cpsg_code': '11290', 'ld_cpsg_code': '11290', 'ld_emd_li_code': '13300', 'regstr_se_code': '1',
                        'mnnm': f'{n:04d}', 'slno': f'{sl:04d}', 'frst_regist_dt': '2019-03-02', 'last_updt_dt': '2026-10-01'},
        'bbox': bbox_of(rings),
    })
    return pnu, n, sl

USES_RES = [('01003', 2, 4), ('02003', 3, 5), ('01001', 1, 2), ('02002', 3, 4)]
def add_building(pts, code, fl, *, hg=None, holes=None, parts=None, name='', dong='', pnu='', mn=0, sl=0, year=None, ug=0, missing=None):
    polys = parts or [[pts] + (holes or [])]
    coords = [[ring(rg) for rg in poly] for poly in polys]
    ar = 0
    for poly in polys:
        o = poly[0]
        a = 0.5 * abs(sum(o[i][0] * o[(i + 1) % len(o)][1] - o[(i + 1) % len(o)][0] * o[i][1] for i in range(len(o))))
        for h in poly[1:]:
            a -= 0.5 * abs(sum(h[i][0] * h[(i + 1) % len(h)][1] - h[(i + 1) % len(h)][0] * h[i][1] for i in range(len(h))))
        ar += a
    fh = 2.9 if code and code[:2] in ('01', '02') else 3.7
    h = hg if hg is not None else round(fl * fh + random.uniform(0.2, 1.4), 2)
    y = year or random.choice([1979, 1985, 1988, 1992, 1996, 1999, 2003, 2008, 2012, 2016, 2019, 2022])
    props = {
        'src_objectid': len(buildings) + 1, 'gis_idntfc_no': f'1129010{len(buildings) + 1:08d}', 'pnu': pnu, 'ld_cpsg_code': '11290',
        'mnnm': f'{mn:04d}', 'slno': f'{sl:04d}', 'regstr_se_code': '1', 'buld_prpos_code': code,
        'strct_code': random.choice(['21', '21', '21', '11', '31', '26']), 'ar': round(ar, 2),
        'use_confm_de': f'{y}{random.randint(1, 12):02d}{random.randint(1, 28):02d}', 'totar': round(ar * fl, 2),
        'plot_ar': round(ar * random.uniform(1.4, 2.2), 2), 'hg': h, 'btl_rt': round(random.uniform(45, 70), 2), 'measrmt_rt': round(random.uniform(90, 600), 2),
        'buld_idntfc_no': f'{len(buildings) + 1:010d}', 'violt_bild': random.choice(['N'] * 12 + ['Y']), 'refrn_systm_cntc_no': '',
        'last_updt_dt': '2026-10-01', 'src_signgu_code': '11290', 'buld_nm': name, 'dong_nm': dong,
        'ground_floor_co': fl, 'undgrnd_floor_co': ug, 'data_creat_change_de': '2026-09-15',
    }
    for k in (missing or []):
        props[k] = 0 if k in ('hg', 'ground_floor_co', 'totar') else None
    buildings.append({'type': 'Feature', 'id': f'dt_d010.{len(buildings) + 1}', 'geometry': {'type': 'MultiPolygon', 'coordinates': coords}, 'geometry_name': 'ag_geom', 'properties': props, 'bbox': bbox_of([c for p in coords for c in p])})

# 도로 필지: 교차점 사이마다 따로(실제처럼 조각난 지적)
ucs = sorted(UL); vcs = sorted(VL)
for (u, w) in UL:
    edges = [-LIM] + [v for v, _ in vcs] + [LIM]
    for a, b in zip(edges, edges[1:]):
        wa = dict(VL).get(a, 0) / 2; wb = dict(VL).get(b, 0) / 2
        pts = rect(u - w / 2, a + wa, u + w / 2, b - wb)
        if hits_site(pts, 10): add_parcel(pts, '도')
for (v, w) in VL:
    edges = [-LIM] + [u for u, _ in ucs] + [LIM]
    for a, b in zip(edges, edges[1:]):
        wa = dict(UL).get(a, 0) / 2; wb = dict(UL).get(b, 0) / 2
        pts = rect(a + wa, v - w / 2, b - wb, v + w / 2)
        if hits_site(pts, 10): add_parcel(pts, '도')
for (u, wu) in UL:
    for (v, wv) in VL:
        pts = rect(u - wu / 2, v - wv / 2, u + wu / 2, v + wv / 2)
        if hits_site(pts, 10): add_parcel(pts, '도')

# 가구 → 획지 → 건물
ub = [-LIM] + [u for u, _ in ucs] + [LIM]
vb = [-LIM] + [v for v, _ in vcs] + [LIM]
wU = dict(UL); wV = dict(VL)
bi = 0
for i in range(len(ub) - 1):
    for j in range(len(vb) - 1):
        u0 = ub[i] + wU.get(ub[i], 0) / 2; u1 = ub[i + 1] - wU.get(ub[i + 1], 0) / 2
        v0 = vb[j] + wV.get(vb[j], 0) / 2; v1 = vb[j + 1] - wV.get(vb[j + 1], 0) / 2
        if u1 - u0 < 8 or v1 - v0 < 8: continue
        blk = rect(u0, v0, u1, v1)
        if not hits_site(blk, 0): continue
        bi += 1
        cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
        major = abs(ub[i] + 60) < 1 or abs(ub[i + 1] + 60) < 1 or abs(vb[j] + 95) < 1 or abs(vb[j + 1] + 95) < 1
        # 특별한 가구
        if (i, j) == (2, 4):  # 공원
            add_parcel(blk, '공'); continue
        if (i, j) == (3, 2):  # 학교: 중정 있는 건물
            pnu, n, sl = add_parcel(blk, '학')
            ou = rect(u0 + 12, v0 + 10, u1 - 12, v1 - 10)
            hole = list(reversed(rect(u0 + 26, v0 + 22, u1 - 26, v1 - 22)))
            add_building(ou, '10000', 4, holes=[hole], name='안암초등학교', pnu=pnu, mn=n, sl=sl, year=1987)
            continue
        if (i, j) == (4, 4):  # 아파트 단지
            pnu, n, sl = add_parcel(blk, '대')
            for k in range(4):
                a = u0 + 8 + k * (u1 - u0 - 16) / 4
                add_building(rect(a + 2, cv - 8, a + (u1 - u0 - 16) / 4 - 4, cv + 8), '02001', random.choice([15, 18, 20]), name='래미안안암', dong=f'{101 + k}동', pnu=pnu, mn=n, sl=sl, year=2004, ug=2)
            continue
        # 막다른 골목 하나(긴 가구)
        alley = None
        if (u1 - u0) > 80 and (v1 - v0) > 50 and bi % 2 == 0:
            au = cu
            alley = (au - 2, v0, au + 2, v0 + min(32, (v1 - v0) * 0.55))
            add_parcel(rect(*alley), '도')
        rows = 2 if (v1 - v0) > 34 else 1
        for rr in range(rows):
            ra0 = v0 if rr == 0 else (v0 + v1) / 2
            ra1 = v1 if rows == 1 or rr == 1 else (v0 + v1) / 2
            u = u0
            while u < u1 - 6:
                lw = random.uniform(11, 17) if not major else random.uniform(15, 24)
                ue = min(u1, u + lw)
                if u1 - ue < 8: ue = u1
                if alley and not (ue <= alley[0] or u >= alley[2]) and ra0 < alley[3]:
                    # 골목에 걸리는 획지는 골목 양쪽으로 나눔
                    parts_ = [(u, alley[0]), (alley[2], ue)]
                else:
                    parts_ = [(u, ue)]
                for (a, b) in parts_:
                    if b - a < 5: continue
                    lot = rect(a, ra0, b, ra1)
                    if not hits_site(lot, 0): continue
                    jm = '대'
                    pnu, n, sl = add_parcel(lot, jm)
                    if random.random() < 0.06: continue  # 빈 필지(나대지·주차장)
                    fs = 1.0 if major else 1.4
                    bpts = rect(a + 0.7, ra0 + fs, b - 0.7, ra1 - 1.2)
                    if major:
                        code = random.choice(['03000', '04000', '04000', '14000', '07000', '15000'])
                        fl = random.randint(4, 12)
                    else:
                        code, f0, f1 = random.choice(USES_RES + [('04000', 2, 4)])
                        fl = random.randint(f0, f1)
                    miss = None
                    roll = random.random()
                    if roll < 0.10: miss = ['hg']                       # 높이 없음 → 층수로 어림
                    elif roll < 0.14: miss = ['ground_floor_co']        # 층수 없음 → 연면적÷건축면적
                    elif roll < 0.16: miss = ['hg', 'ground_floor_co', 'totar']  # 모두 없음 → 1층
                    elif roll < 0.18: code = None                        # 용도 없음
                    if random.random() < 0.03 and b - a > 14:   # 두 동이 한 건물(여러 부분)
                        m = (a + b) / 2
                        add_building(None, code, fl, parts=[[rect(a + 0.7, ra0 + fs, m - 1, ra1 - 1.2)], [rect(m + 1, ra0 + fs, b - 0.7, ra1 - 1.2)]], pnu=pnu, mn=n, sl=sl, missing=miss)
                    else:
                        add_building(bpts, code, fl, pnu=pnu, mn=n, sl=sl, missing=miss, ug=random.choice([0, 0, 1]))
                u = ue

def bbox_req():
    s = LAT0 - HALF / M_LAT; n = LAT0 + HALF / M_LAT; w = LON0 - HALF / M_LON; e = LON0 + HALF / M_LON
    return s, w, n, e
S, W, N, E = bbox_req()
def in_req(f, bb=None):
    s, w, n, e = bb or (S, W, N, E)
    b = f['bbox']
    return b[2] >= w and b[0] <= e and b[3] >= s and b[1] <= n

def coll(feats, matched=None):
    return {'type': 'FeatureCollection', 'features': feats, 'totalFeatures': matched or len(feats), 'numberMatched': matched or len(feats), 'numberReturned': len(feats),
            'timeStamp': '2026-11-12T14:20:11.512Z', 'crs': {'type': 'name', 'properties': {'name': 'urn:ogc:def:crs:EPSG::4326'}}}

bld = [f for f in buildings if in_req(f)]
par = [f for f in parcels if in_req(f)]
(OUT / 'vw_bld.json').write_text(json.dumps(coll(bld), ensure_ascii=False), encoding='utf-8')
(OUT / 'vw_par.json').write_text(json.dumps(coll(par), ensure_ascii=False), encoding='utf-8')
(OUT / 'vw_bld.js').write_text('parseResponse(' + json.dumps(coll(bld), ensure_ascii=False) + ')', encoding='utf-8')
(OUT / 'vw_err.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><ServiceExceptionReport version="1.2.0"><ServiceException code="INCORRECT_KEY">인증키 정보가 올바르지 않습니다.</ServiceException></ServiceExceptionReport>', encoding='utf-8')

# 1,000건 상한 시험: 촘촘한 작은 건물 1,600동. 전체 요청은 1,000건에서 잘리고, 2×2 조각은 각각 다 들어온다
dense = []
for a in range(40):
    for b in range(40):
        x = -195 + a * 10; y = -195 + b * 10
        pts = [(x, y), (x + 6, y), (x + 6, y + 6), (x, y + 6)]
        rings = [ring(pts)]
        dense.append({'type': 'Feature', 'id': f'dt_d010.d{a}_{b}', 'geometry': {'type': 'Polygon', 'coordinates': rings},
                      'properties': {'gis_idntfc_no': f'D{a:02d}{b:02d}', 'buld_prpos_code': '01001', 'ground_floor_co': 1 + (a + b) % 4, 'hg': 0, 'ar': 36, 'totar': 36 * (1 + (a + b) % 4), 'use_confm_de': '19980101'},
                      'bbox': bbox_of(rings)})
(OUT / 'vw_dense_full.json').write_text(json.dumps(coll(dense[:1000], 1600), ensure_ascii=False), encoding='utf-8')
for k, (tj, ti) in enumerate([(0, 0), (0, 1), (1, 0), (1, 1)]):
    s = S + (N - S) * tj / 2; n = S + (N - S) * (tj + 1) / 2; w = W + (E - W) * ti / 2; e = W + (E - W) * (ti + 1) / 2
    part = [f for f in dense if in_req(f, (s, w, n, e))]
    (OUT / f'vw_dense_t{k}.json').write_text(json.dumps(coll(part), ensure_ascii=False), encoding='utf-8')
print('buildings', len(bld), 'parcels', len(par), 'road parcels', sum(1 for f in par if f['properties']['lnm_lndcgr_smbol'].endswith('도')), 'dense', len(dense))
