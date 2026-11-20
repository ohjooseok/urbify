#!/bin/sh
# three.js 묶음 만들기: tools/three 에서 sh build.sh → docs/vendor/three-urbify.js, docs/vendor/three.LICENSE.txt
set -e
cd "$(dirname "$0")"
[ -d node_modules/three ] || npm install --silent
V=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/three/package.json','utf8')).version")
npx esbuild entry.js --bundle --minify --format=iife --legal-comments=none --outfile=../../docs/vendor/three-urbify.js \
  --banner:js="/* three.js r$(echo $V | cut -d. -f2) (MIT License, https://threejs.org) — Urbify 발표 화면용 묶음. 저작권 고지: three.LICENSE.txt */"
cp node_modules/three/LICENSE ../../docs/vendor/three.LICENSE.txt
echo "docs/vendor/three-urbify.js $(wc -c < ../../docs/vendor/three-urbify.js) bytes (three $V)"
