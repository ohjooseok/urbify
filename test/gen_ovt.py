"""Overture Maps 꼴의 시험 자료 만들기: 조치원역 부근(z14 타일 13985/6399와 동쪽 이웃 13986/6399)에
건물(층수·높이 있음/없음, 안뜰, 지하, 타일 경계에 걸친 것)과 교통망(따로 그려진 양방향 차도, 회전교차로, 골목, 보도, 철도, 경계를 지나는 길)을
MVT(벡터 타일)로 만들어 PMTiles v3 파일 두 개(buildings·transportation)로 쓴다. 실제 배포 파일과 같은 방식(gzip, 버퍼 64)으로 자른다.
  python test/gen_ovt.py  →  test/data/ovt/2026-10-21.0/{buildings,transportation}.pmtiles"""
import gzip, json, math, os, struct, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'data' / 'ovt' / '2026-10-21.0'
Z, EXT, BUF = 14, 4096, 64
LAT0, LON0 = 36.6012, 127.2975
r = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * r) + 1.175 * math.cos(4 * r)
M_LON = 111412.84 * math.cos(r) - 93.5 * math.cos(3 * r)


def ll(x, y):
    """대상지 중심 기준 m → (경도, 위도)"""
    return (LON0 + x / M_LON, LAT0 + y / M_LAT)


def px(lon, lat, tx, ty):
    n = 2 ** Z
    X = ((lon + 180) / 360 * n - tx) * EXT
    rr = math.radians(lat)
    Y = ((1 - math.log(math.tan(rr) + 1 / math.cos(rr)) / math.pi) / 2 * n - ty) * EXT
    return (X, Y)


# ---------- 지형지물 ----------
def rect(cx, cy, w, h):
    return [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]


ONEWAY = json.dumps([{"access_type": "denied", "when": {"heading": "backward"}}])
def names(ko):
    return json.dumps({"primary": ko, "common": {"ko": ko}}, ensure_ascii=False) if ko else None


BLD = [
    dict(id='b-apt', rings=[rect(-150, 60, 60, 15)], props={'class': 'apartments', 'subtype': 'residential', 'num_floors': 15, '@name': '102동'}),
    dict(id='b-house', rings=[rect(50, 60, 10, 10)], props={'subtype': 'residential', 'class': 'residential'}),
    dict(id='b-shop', rings=[rect(80, -60, 20, 20)], props={'class': 'commercial', 'subtype': 'commercial', 'height': 12.5, '@name': '조치원상가'}),
    dict(id='b-none', rings=[rect(-80, -60, 20, 15)], props={}),
    dict(id='b-school', rings=[rect(250, 150, 40, 40), rect(250, 150, 20, 20)], props={'class': 'school', 'subtype': 'education', '@name': '조치원초등학교'}),
    dict(id='b-under', rings=[rect(-200, -150, 20, 20)], props={'class': 'parking', 'is_underground': True}),
    # 동쪽 타일 경계(경도 127.30957)에 걸친 건물: 경계에서 서쪽 10m, 동쪽 70m
    dict(id='b-seam', rings=[[(1072, 290), (1152, 290), (1152, 310), (1072, 310)]], props={'class': 'warehouse', 'subtype': 'industrial'}),
]
SEG = []
def seg(sid, pts, cls, name=None, sub='road', **kw):
    p = {'id': sid, 'class': cls, 'subtype': sub}
    if name:
        p['@name'] = name; p['names'] = names(name)
    p.update(kw)
    SEG.append(dict(id=sid, pts=pts, props=p))

# 따로 그려진 양방향 차도(새내로): 서쪽 선은 북쪽으로, 동쪽 선은 남쪽으로. 교차점(y=-200, 0, 200)마다 나뉨
for k, (a, b) in enumerate([(-400, -200), (-200, 0), (0, 200), (200, 400)]):
    seg(f'sn-w{k}', [(-6, a), (-6, b)], 'tertiary', '새내로', access_restrictions=ONEWAY)
    seg(f'sn-e{k}', [(6, b), (6, a)], 'tertiary', '새내로', access_restrictions=ONEWAY)
# 조치원로(양방향): 서쪽 끝 → 새내로 두 차도 → 회전교차로(150,0) 서쪽 입구까지, 동쪽 출구에서 끝까지
seg('jc-1', [(-400, 0), (-6, 0)], 'tertiary', '조치원로')
seg('jc-2', [(-6, 0), (6, 0)], 'tertiary', '조치원로')
seg('jc-3', [(6, 0), (136, 0)], 'tertiary', '조치원로')
# 회전교차로: 반지름 14m 고리(한 방향). 동쪽 입구는 진입로·진출로가 따로 그려져(삼각 분리섬) 고리의 ±20° 자리에 닿고 190m에서 한 길로 합쳐짐
R0, C0 = 14, (150, 0)
def rp(a):
    return (C0[0] + R0 * math.cos(math.radians(a)), C0[1] + R0 * math.sin(math.radians(a)))
def arc(a0, a1, n=8):
    return [rp(a0 + (a1 - a0) * i / n) for i in range(n + 1)]
for k, (a0, a1) in enumerate([(20, 90), (90, 135), (135, 180), (180, 270), (270, 340), (340, 380)]):
    seg(f'rb-{k}', arc(a0, a1), 'tertiary', access_restrictions=ONEWAY)
seg('jc-4in', [(190, 0), (175, 2), rp(20)], 'tertiary', 'Jochiwon-ro', access_restrictions=ONEWAY)
seg('jc-4out', [rp(-20), (175, -2), (190, 0)], 'tertiary', '조치원로', access_restrictions=ONEWAY)
seg('jc-4', [(190, 0), (400, 0)], 'tertiary', '조치원로')
# 고리에 붙은 짧은 꼬리(바깥 끝이 어디에도 닿지 않음): 버려야 함
seg('rb-stub', [rp(135), (C0[0] + 18 * math.cos(math.radians(135)), C0[1] + 18 * math.sin(math.radians(135)))], 'service', sub='road')
# 회전교차로 남북 입구: 새내8길
seg('sn8-n', [(150, 14), (150, 120)], 'residential', '새내8길')
seg('sn8-s', [(150, -14), (150, -120)], 'residential', '새내8길')
# 동서 국지도로 둘(교차점마다 나뉨)
for y, nm in ((120, '새내10길'), (-120, '새내12길')):
    xs = [-400, -6, 6, 150, 400]
    for k in range(len(xs) - 1):
        seg(f'{nm}-{k}', [(xs[k], y), (xs[k + 1], y)], 'residential', nm)
# 짧은 막다른 골목(버림), 보도·주차 통로(받지 않음), 단지 골목(남김)
seg('stub', [(300, 120), (300, 128)], 'service', sub='road')
seg('alley', [(-200, 120), (-200, 40), (-120, 40)], 'service', subclass='alley')
seg('foot', [(-300, 0), (-300, 100)], 'footway', subclass='sidewalk')
seg('aisle', [(200, 60), (240, 60)], 'service', subclass='parking_aisle')
seg('tunnel', [(-50, -300), (50, -300)], 'secondary', '지하차도', road_flags=json.dumps([{"values": ["is_tunnel"]}]))
# 철도(경부선)
seg('rail-1', [(-320, -500), (-320, 500)], 'standard_gauge', sub='rail')
# 동쪽 타일 경계를 지나는 큰길(세종로, 주간선)
seg('sj-1', [(900, 250), (1300, 250)], 'primary', '세종로')


# ---------- 자르기(타일 + 버퍼) ----------
def clip_poly(poly, x0, y0, x1, y1):
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia: out.append(inter(a, b))
                out.append(b)
            elif ia:
                out.append(inter(a, b))
        return out
    def ix(xv):
        return lambda a, b: (xv, a[1] + (b[1] - a[1]) * (xv - a[0]) / (b[0] - a[0]))
    def iy(yv):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (yv - a[1]) / (b[1] - a[1]), yv)
    p = poly
    for inside, inter in ((lambda q: q[0] >= x0, ix(x0)), (lambda q: q[0] <= x1, ix(x1)), (lambda q: q[1] >= y0, iy(y0)), (lambda q: q[1] <= y1, iy(y1))):
        if len(p) < 3: return []
        p = clip(p, inside, inter)
    return p


def clip_line(pts, x0, y0, x1, y1):
    out, cur = [], []
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        t0, t1 = 0.0, 1.0
        dx, dy = b[0] - a[0], b[1] - a[1]
        ok = True
        for P, Q in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dy, a[1] - y0), (dy, y1 - a[1])):
            if abs(P) < 1e-12:
                if Q < 0: ok = False; break
                continue
            t = Q / P
            if P < 0:
                if t > t1: ok = False; break
                t0 = max(t0, t)
            else:
                if t < t0: ok = False; break
                t1 = min(t1, t)
        if not ok or t1 - t0 < 1e-9:
            if len(cur) > 1: out.append(cur)
            cur = []; continue
        s0 = (a[0] + t0 * dx, a[1] + t0 * dy); s1 = (a[0] + t1 * dx, a[1] + t1 * dy)
        if not cur or abs(cur[-1][0] - s0[0]) > 1e-6 or abs(cur[-1][1] - s0[1]) > 1e-6:
            if len(cur) > 1: out.append(cur)
            cur = [s0]
        cur.append(s1)
        if t1 < 1 - 1e-9:
            out.append(cur); cur = []
    if len(cur) > 1: out.append(cur)
    return out


def area(r):
    return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2


# ---------- protobuf / MVT ----------
def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7f; n >>= 7
        if n: out.append(b | 0x80)
        else: out.append(b); return bytes(out)
def key(f, w): return varint((f << 3) | w)
def ld(f, b): return key(f, 2) + varint(len(b)) + b
def zz(n): return (n << 1) ^ (n >> 31)


def geom_cmds(parts, closed):
    out, cx, cy = [], 0, 0
    for pts in parts:
        q = [(int(round(x)), int(round(y))) for x, y in pts]
        dd = [q[0]]
        for p in q[1:]:
            if p != dd[-1]: dd.append(p)
        if closed and len(dd) > 1 and dd[0] == dd[-1]: dd.pop()
        if len(dd) < (3 if closed else 2): continue
        out.append(1 | (1 << 3)); out += [zz(dd[0][0] - cx), zz(dd[0][1] - cy)]; cx, cy = dd[0]
        out.append(2 | ((len(dd) - 1) << 3))
        for x, y in dd[1:]:
            out += [zz(x - cx), zz(y - cy)]; cx, cy = x, y
        if closed: out.append(7 | (1 << 3))
    return out


def value(v):
    if isinstance(v, bool): return key(7, 0) + varint(1 if v else 0)
    if isinstance(v, int): return key(5, 0) + varint(v) if v >= 0 else key(6, 0) + varint(zz(v))
    if isinstance(v, float): return key(3, 1) + struct.pack('<d', v)
    return ld(1, str(v).encode('utf-8'))


def layer(name, feats):
    keys, vals, kidx, vidx, fb = [], [], {}, {}, b''
    for fid, gtype, cmds, props in feats:
        tags = []
        for k, v in props.items():
            if v is None: continue
            if k not in kidx: kidx[k] = len(keys); keys.append(k)
            vk = (type(v).__name__, v)
            if vk not in vidx: vidx[vk] = len(vals); vals.append(v)
            tags += [kidx[k], vidx[vk]]
        body = key(1, 0) + varint(fid) + ld(2, b''.join(varint(t) for t in tags)) + key(3, 0) + varint(gtype) + ld(4, b''.join(varint(c) for c in cmds))
        fb += ld(2, body)
    b = key(15, 0) + varint(2) + ld(1, name.encode()) + fb
    b += b''.join(ld(3, k.encode('utf-8')) for k in keys) + b''.join(ld(4, value(v)) for v in vals) + key(5, 0) + varint(EXT)
    return ld(3, b)


def tile_bytes(kind, tx, ty):
    feats, fid = [], 1
    lo, hi = -BUF, EXT + BUF
    if kind == 'buildings':
        for b in BLD:
            rings_px = [[px(*ll(x, y), tx, ty) for x, y in rg] for rg in b['rings']]
            parts = []
            for k, rg in enumerate(rings_px):
                c = clip_poly(rg, lo, lo, hi, hi)
                if len(c) < 3: continue
                a = area(c)
                if (k == 0 and a < 0) or (k > 0 and a > 0): c = c[::-1] # 바깥은 양(시계, y 아래), 구멍은 음
                parts.append(c)
            if not parts: continue
            props = {'id': b['id'], **b['props']}
            feats.append((fid, 3, geom_cmds(parts, True), props)); fid += 1
        return layer('building', feats)
    for s in SEG:
        pts = [px(*ll(x, y), tx, ty) for x, y in s['pts']]
        for q in clip_line(pts, lo, lo, hi, hi):
            feats.append((fid, 2, geom_cmds([q], False), s['props'])); fid += 1
    return layer('segment', feats)


# ---------- PMTiles v3 ----------
def tile_id(z, x, y):
    acc = sum(4 ** i for i in range(z))
    n = 2 ** z; d = 0; xy = [x, y]; s = n // 2
    while s > 0:
        rx = 1 if xy[0] & s else 0; ry = 1 if xy[1] & s else 0
        d += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1: xy[0] = s - 1 - xy[0]; xy[1] = s - 1 - xy[1]
            xy[0], xy[1] = xy[1], xy[0]
        s //= 2
    return acc + d


def directory(entries):
    out = varint(len(entries)); last = 0
    for e in entries: out += varint(e['id'] - last); last = e['id']
    for e in entries: out += varint(e['run'])
    for e in entries: out += varint(e['len'])
    for i, e in enumerate(entries):
        if i > 0 and e['off'] == entries[i - 1]['off'] + entries[i - 1]['len']: out += varint(0)
        else: out += varint(e['off'] + 1)
    return out


def write_pmtiles(path, tiles, layer_name):
    tiles = sorted(tiles, key=lambda t: tile_id(*t[0]))
    data, entries = b'', []
    for (z, x, y), raw in tiles:
        g = gzip.compress(raw, mtime=0)
        entries.append({'id': tile_id(z, x, y), 'off': len(data), 'len': len(g), 'run': 1})
        data += g
    root = gzip.compress(directory(entries), mtime=0)
    meta = gzip.compress(json.dumps({'vector_layers': [{'id': layer_name, 'minzoom': 14, 'maxzoom': 14, 'fields': {}}], 'attribution': 'test', 'name': layer_name}).encode(), mtime=0)
    ro = 127; mo = ro + len(root); lo = mo + len(meta); do = lo
    h = b'PMTiles' + bytes([3])
    h += struct.pack('<QQQQQQQQ', ro, len(root), mo, len(meta), lo, 0, do, len(data))
    h += struct.pack('<QQQ', len(entries), len(entries), len(entries))
    h += bytes([1, 2, 2, 1, 14, 14])  # clustered, internal gzip, tile gzip, mvt, minZ, maxZ
    h += struct.pack('<iiii', int(127.28 * 1e7), int(36.59 * 1e7), int(127.34 * 1e7), int(36.62 * 1e7))
    h += bytes([14]) + struct.pack('<ii', int(LON0 * 1e7), int(LAT0 * 1e7))
    assert len(h) == 127, len(h)
    path.write_bytes(h + root + meta + data)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    T = [(13985, 6399), (13986, 6399)]
    for kind, lname in (('buildings', 'building'), ('transportation', 'segment')):
        write_pmtiles(OUT / f'{kind}.pmtiles', [((Z, tx, ty), tile_bytes(kind, tx, ty)) for tx, ty in T], lname)
        print(kind, (OUT / f'{kind}.pmtiles').stat().st_size, 'bytes')
    (OUT.parent / 'catalog.json').write_text(json.dumps({'latest': '2026-10-21.0', 'links': []}), encoding='utf-8')


if __name__ == '__main__':
    main()
