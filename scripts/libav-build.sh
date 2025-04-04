#!/usr/bin/env bash
set -euxo pipefail

emcc --version

cd ./libav.js/configs
./mkconfig.js punkomatic '[
  "cli",
  "demuxer-pcm_f32le", "decoder-pcm_f32le",
  "filter-amerge", "filter-aresample",
  "encoder-libmp3lame", "muxer-mp3"
]'

cd ..
make clean
make dist/libav-6.5.7.1-punkomatic.mjs
make dist/libav-6.5.7.1-punkomatic.wasm.mjs
make dist/libav-6.5.7.1-punkomatic.wasm.wasm
make dist/libav.types.d.ts

cd ..

cp ./libav.js/dist/libav-6.5.7.1-punkomatic.mjs ./dist
cp ./libav.js/dist/libav-6.5.7.1-punkomatic.wasm.mjs ./dist
cp ./libav.js/dist/libav-6.5.7.1-punkomatic.wasm.wasm ./dist
cp ./libav.js/dist/libav.types.d.ts ./dist
