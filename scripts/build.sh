#!/usr/bin/env bash
set -euxo pipefail

rm -f ./dist/punkomatic.*.js

esbuild \
  --platform=browser --format=esm --define:NODE=false \
  --bundle --sourcemap --minify --charset=utf8 \
  --alias:libav.js=./dist/libav-5.1.6.1.1-punkomatic.mjs \
  --external:path --external:os \
  ./src/index.ts \
  --outfile=./dist/punkomatic.browser.js

esbuild \
  --platform=node --format=esm --define:NODE=true \
  --bundle --packages=external --minify --sourcemap --charset=utf8 \
  --alias:libav.js=./dist/libav-5.1.6.1.1-punkomatic.mjs \
  ./src/index.ts \
  --outfile=./dist/punkomatic.node.js
