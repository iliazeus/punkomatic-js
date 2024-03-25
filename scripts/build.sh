#!/bin/sh

esbuild \
  --bundle --sourcemap=inline --minify --charset=utf8 \
  --platform=browser --format=esm \
  ./src/index.browser.ts \
  --outfile=./dist/punkomatic.browser.js

esbuild \
  --bundle --sourcemap=inline --minify --charset=utf8 \
  --platform=node --external:node-web-audio-api \
  ./src/index.node.ts \
  --outfile=./dist/punkomatic.node.js
