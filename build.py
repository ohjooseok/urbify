#!/usr/bin/env python3
"""src/ 를 하나의 docs/index.html 로 묶는다(스타일·스크립트 인라인, 바깥 파일 없음).
docs/ 는 GitHub Pages(main 브랜치 /docs)로 그대로 배포되고, 내려받아 브라우저로 열어도 된다.
VERSION 파일의 번호와 빌드 날짜를 화면(도움말 → 소개)에 넣는다."""
import re, pathlib, datetime
root = pathlib.Path(__file__).resolve().parent
src = root / 'src'
version = (root / 'VERSION').read_text(encoding='utf-8').strip()
built = datetime.date.today().isoformat()
html = (src / 'index.html').read_text(encoding='utf-8')
css = (src / 'css' / 'app.css').read_text(encoding='utf-8')
html = re.sub(r'<!--CSS-->.*?<!--/CSS-->', lambda m: '<style>\n' + css + '</style>', html, flags=re.S)
def js_block(m):
    out = []
    for name in re.findall(r'src="js/([\w.]+)"', m.group(0)):
        code = (src / 'js' / name).read_text(encoding='utf-8')
        assert '</script' not in code, name
        out.append('<script>\n' + code + '</script>')
    return '\n'.join(out)
html = re.sub(r'<!--JS-->.*?<!--/JS-->', js_block, html, flags=re.S)
html = html.replace('__UDS_VERSION__', version).replace('__UDS_BUILD__', built)
out = root / 'docs'
out.mkdir(exist_ok=True)
(out / 'index.html').write_text(html, encoding='utf-8')
# 지도에서 대상지 고르기에 쓰는 MapLibre GL JS(BSD-3): 필요할 때만 불러오므로 index.html에 넣지 않고 옆에 둔다
import shutil
for sub in ('vendor', 'data'):
    s_dir = src / sub
    if s_dir.is_dir():
        d_dir = out / sub
        d_dir.mkdir(exist_ok=True)
        for f in s_dir.iterdir():
            if f.is_file():
                shutil.copy2(f, d_dir / f.name)
(out / '.nojekyll').write_text('', encoding='utf-8')  # GitHub Pages가 Jekyll로 가공하지 않게
print(f'docs/index.html  v{version} ({built})  {len(html.encode("utf-8")):,} bytes')
