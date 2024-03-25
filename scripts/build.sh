#!/bin/sh
set -e

rm -f ./dist/punkomatic.*.js

esbuild \
  --bundle --sourcemap=inline --minify --charset=utf8 \
  --platform=browser --format=esm \
  --alias:libav.js=./dist/libav-5.1.6.1.1-punkomatic.mjs \
  ./src/index.browser.ts \
  --outfile=./dist/punkomatic.browser.js

esbuild \
  --bundle --sourcemap=inline --minify --charset=utf8 \
  --platform=node --format=esm --external:node-web-audio-api \
  --alias:libav.js=./dist/libav-5.1.6.1.1-punkomatic.mjs \
  ./src/index.node.ts \
  --outfile=./dist/punkomatic.node.js
