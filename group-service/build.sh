#!/bin/sh
set -eu
mkdir -p dist/.openai dist/server
cp .openai/hosting.json dist/.openai/hosting.json
"${ESBUILD_BIN:-./node_modules/.bin/esbuild}" worker.mjs --bundle --platform=browser --format=esm --target=es2022 --outfile=dist/server/index.js
