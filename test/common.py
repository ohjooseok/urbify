"""테스트 공용 설정: 저장소 경로, 빌드 결과(docs/index.html) 주소, 브라우저 실행 옵션, 스크린숏·출력 폴더.
CHROME_PATH 환경 변수로 쓸 크롬을 정할 수 있다(없으면 /usr/bin/google-chrome, 그것도 없으면 Playwright 기본 Chromium)."""
import os, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTD = str(ROOT / 'test')
OUTD = str(pathlib.Path(os.environ.get('UDS_TEST_OUT', ROOT / 'test' / 'out')))
os.makedirs(OUTD, exist_ok=True)
URL = (ROOT / 'docs' / 'index.html').as_uri()
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--allow-file-access-from-files"]
_chrome = os.environ.get('CHROME_PATH') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)
def LAUNCH(args=None):
    """chromium.launch(**LAUNCH()) 에 넘길 옵션"""
    o = {'args': args or ARGS}
    if _chrome: o['executable_path'] = _chrome
    return o
