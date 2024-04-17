#!/bin/bash
set -euxo pipefail

rm -f ./dist/punkomatic.*.js

esbuild \
  --platform=browser --format=esm \
  --bundle --sourcemap --minify --charset=utf8 \
  --alias:libav.js=./dist/libav-5.1.6.1.1-punkomatic.mjs \
  --external:path --external:os \
  ./src/index.browser.ts \
  --outfile=./dist/punkomatic.browser.js

esbuild \
  --platform=node --format=esm \
  --bundle --packages=external --minify --sourcemap --charset=utf8 \
  --alias:libav.js=./dist/libav-5.1.6.1.1-punkomatic.mjs \
  ./src/index.node.ts \
  --outfile=./dist/punkomatic.node.js
