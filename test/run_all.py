#!/usr/bin/env python3
"""회귀 검사 전체 실행: test/suite.txt 의 검사를 나란히 돌리고 결과를 모은다.
먼저 `python build.py` 로 docs/index.html 을 만든 뒤 실행한다.
  python test/run_all.py            # 전체(동시 4개)
  python test/run_all.py v18 v19    # 고른 것만
  python test/run_all.py -j 2       # 동시 실행 수
기록은 test/out/logs/<이름>.log, 스크린숏은 test/out/ 에 남는다."""
import os, re, subprocess, sys, time, pathlib
from concurrent.futures import ThreadPoolExecutor

T = pathlib.Path(__file__).resolve().parent
ROOT = T.parent
LOGS = T / 'out' / 'logs'
BAD = re.compile(r'^(FAIL\b|Traceback|PAGEERROR)|\bSOME FAILED\b', re.M)


def run(name):
    t0 = time.time()
    try:
        r = subprocess.run([sys.executable, str(T / f'{name}.py')], cwd=ROOT, capture_output=True, text=True, timeout=420)
        out, code = r.stdout + r.stderr, r.returncode
    except subprocess.TimeoutExpired as e:
        out, code = (e.stdout or '') if isinstance(e.stdout, str) else '', 'timeout'
    (LOGS / f'{name}.log').write_text(out + f'\nexit={code}\n', encoding='utf-8')
    ok = code == 0 and not BAD.search(out)
    fails = [l for l in out.splitlines() if l.startswith('FAIL')][:3]
    return name, ok, round(time.time() - t0), code, fails


def main():
    args = sys.argv[1:]
    jobs = 4
    if '-j' in args:
        i = args.index('-j'); jobs = int(args[i + 1]); del args[i:i + 2]
    names = args or [l.strip() for l in (T / 'suite.txt').read_text(encoding='utf-8').splitlines() if l.strip()]
    if not (ROOT / 'docs' / 'index.html').exists():
        sys.exit('docs/index.html 이 없습니다. 먼저 python build.py 를 실행하세요.')
    LOGS.mkdir(parents=True, exist_ok=True)
    bad = []
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        for name, ok, sec, code, fails in ex.map(run, names):
            print(f"{'PASS' if ok else 'FAIL'}  {name:<11} {sec:>4}s" + ('' if ok else f'  (exit={code}) ' + ' | '.join(fails)), flush=True)
            if not ok: bad.append(name)
    print(f"\n{len(names) - len(bad)}/{len(names)} 통과" + (f" — 실패: {' '.join(bad)} (기록: test/out/logs/)" if bad else ''))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
