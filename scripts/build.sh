#!/bin/sh

esbuild \
  --bundle --sourcemap=inline --minify --charset=utf8 \
  --format=iife --global-name=PunkomaticJs \
  --outfile=./punkomatic.bundle.js \
  ./src/index.ts
