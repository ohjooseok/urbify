"""공개 지도 자료(Overture) 처리 검사(Node로): 시험 PMTiles 읽기(ovt_node), 회전교차로 갈래(ovt_arms), 도로 이음새 고치기(ovt_tidy)"""
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
ok = True
for js in ('ovt_node.js', 'ovt_arms.js', 'ovt_tidy.js'):
    r = subprocess.run(['node', os.path.join(here, js)], capture_output=True, text=True, timeout=120)
    tail = (r.stdout.strip().splitlines() or [''])[-1]
    good = r.returncode == 0 and ('FAIL' not in r.stdout)
    print(('PASS ' if good else 'FAIL ') + js + '  ' + tail)
    if not good:
        ok = False; print(r.stdout[-2000:], r.stderr[-2000:])
print('ALL PASS' if ok else 'SOME FAILED')
sys.exit(0 if ok else 1)
