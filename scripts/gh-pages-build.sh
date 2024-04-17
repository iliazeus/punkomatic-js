#!/usr/bin/env bash
set -euxo pipefail

rm -rf ./gh-pages

mkdir -p ./gh-pages
cp ./index.html ./gh-pages

mkdir -p ./gh-pages/dist
cp ./dist/libav-* ./gh-pages/dist
cp ./dist/punkomatic.browser.* ./gh-pages/dist

touch .gitstash
git stash --include-untracked
git switch gh-pages

rm -rf ./dist ./index.html
mv ./gh-pages/* .
git add ./dist ./index.html
git commit -m $(date -Im)

git switch -
git stash pop
rm .gitstash
