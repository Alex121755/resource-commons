#!/bin/sh
set -eu
mkdir -p dist/.openai dist/server
cp .openai/hosting.json dist/.openai/hosting.json
cp worker.mjs dist/server/index.js
