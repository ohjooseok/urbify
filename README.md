# Urbify

Interactive Urban Design Platform. 도시설계 수업용 웹 앱.
도로를 그리면 가구·획지·건물이 따라 생기고, 평면·3D·가로 단면·지표·법규검토를 한 화면에서 함께 봄.
설치·서버 없이 브라우저에서 HTML 파일 하나로 실행.

- 배포 페이지: https://ohjooseok.github.io/urbify/
- 내려받아 쓰기: `docs/index.html` 하나를 브라우저로 열기

## 주요 기능

- 대상지: 가상 도시·구도심·임의생성 도시, 빈 대상지, 지도 캡처 그림에서 도로 읽기, 실제 지역(지도에서 고르기 — 인증키 없이 Overture Maps 건물·도로, 브이월드 인증키가 있으면 GIS건물통합정보·연속지적도, 수업 대상지 자료)
- 도로: 위계별 단면, 회전교차로, 단지 안 길, 하천·수변 공원
- 가구·획지: 자동 분할, 합치기·나누기, 가각 전제
- 건물: 용도·층수·건축선 후퇴, 건폐율·용적률 맞춤 채우기, 단지(공동주택·캠퍼스), 입면 스타일·외장 재료(이미지 재료 포함)
- 3D: 그림자·음영분석(날짜·시각), 수목·가로시설물, 보행자·차량
- 가로 단면: 구간 편집, 지하시설
- 지표·법규검토: 건폐율, 용적률, 정북방향 일조 이격 등, 계획 목표(용적률·건폐율·도로율·공원·녹지율·인구)와 비교
- 작업 순서 안내: 대상지 → 도로망 → 용도·밀도 → 건축물 → 가로 단면 → 법규 검토
- 화면 테마: 다크(기본, 틀만 어둡고 그림은 밝게)·라이트·시스템 설정
- 내보내기: 작업 파일(.json), 평면·단면 그림(PNG·SVG), 3D 모델(GLB·DAE·OBJ, 이미지 재료는 텍스처로), AI 렌더(Google Gemini)

## 폴더

| 경로 | 내용 |
|---|---|
| `src/` | 원본: `index.html`, `css/app.css`, `js/*.js`(기능별 모듈), `vendor/`(MapLibre GL JS, BSD-3), `data/`(수업 대상지 자료 목록 `sites.json`) |
| `build.py` | `src/` → `docs/index.html` 한 파일로 묶기(스타일·스크립트 인라인, 버전·빌드 날짜 삽입), `vendor/`·`data/`는 `docs/`로 복사 |
| `tools/shp2bundle.py` | 수업 대상지 자료 만들기: SHP(GIS건물통합정보·연속지적도) → `src/data/<id>.json` + `sites.json` |
| `docs/` | 배포본(GitHub Pages: main 브랜치 `/docs`) |
| `test/` | Playwright 검사(`suite.txt` 목록, `run_all.py`로 한꺼번에) |
| `VERSION` | 판 번호 |

## 빌드·검사

```sh
python3 build.py                       # docs/index.html 만들기
pip install playwright pillow
python3 -m playwright install chromium
python3 test/run_all.py -j 4           # 전체 검사(기록: test/out/logs/)
python3 test/run_all.py v20 v19        # 일부만
```

- 크롬 경로: `CHROME_PATH` 환경 변수(없으면 `/usr/bin/google-chrome`, 그것도 없으면 Playwright Chromium)
- 검사 출력(스크린숏·기록): `test/out/`(저장소에 넣지 않음)

## 데이터와 바깥 요청

- 작업: 브라우저 localStorage에 자동 저장(실제 지역 자료처럼 큰 것은 IndexedDB), 작업 파일(.json)로 저장·열기
- 인증키(브이월드·Gemini): 사용자가 직접 입력, 그 브라우저에만 보관(기억을 고른 경우)
- 바깥 요청: 지도에서 고르기(바탕 지도 OpenFreeMap, 장소 찾기 OpenStreetMap Nominatim, 자료 Overture Maps PMTiles — 모두 인증키 없음), 실제 지역 브이월드(인증키), AI 렌더(Google Gemini API), 글꼴(Google Fonts)
- 지도 자료 출처: © OpenStreetMap 기여자(ODbL), Overture Maps Foundation, OpenFreeMap. 지도 프로그램 MapLibre GL JS(BSD-3, `docs/vendor/`)
- 내려받은 `index.html` 하나로 열면 지도 프로그램은 공개 CDN(unpkg·jsDelivr)에서 불러옴. Claude 화면 안에서는 지도 대신 자료 붙여 넣기 방식

## 저작권

© 2026 Urban Planning & Informatics Lab, School of Smart Cities, Korea University (Prof. Jooseok Oh). All rights reserved.
