#!/usr/bin/env bash
# Builds the prebuilt omnimind the sandsiv harness VMs install (Debian 12, Node 22, linux-x64):
# dist, gui/dist, production node_modules with the embedding model, nothing for other platforms
# or GPUs. Builds in Docker so native modules match the VMs. Prints the file and its sha256.
#   scripts/harness-bundle.sh [commit]       default: HEAD
set -euo pipefail
COMMIT=$(git rev-parse "${1:-HEAD}")
SHORT=${COMMIT:0:8}
WORK=$(mktemp -d)
git worktree add --detach "$WORK/src" "$COMMIT" >/dev/null
trap 'git worktree remove --force "$WORK/src" >/dev/null 2>&1; rm -rf "$WORK"' EXIT
docker run --rm --platform linux/amd64 -v "$WORK/src":/app -w /app node:22-bookworm bash -c '
  set -e
  npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null
  (cd gui && npm ci --no-audit --no-fund >/dev/null && npx vite build >/dev/null)
  npm prune --omit=dev >/dev/null
  rm -rf gui/node_modules src-tauri tests benchmarks .git
  B=node_modules/onnxruntime-node/bin/napi-v6
  rm -rf $B/darwin $B/win32 $B/linux/arm64 $B/linux/x64/libonnxruntime_providers_cuda.so $B/linux/x64/libonnxruntime_providers_tensorrt.so'
echo "$COMMIT" > "$WORK/src/.commit"
OUT="$PWD/omnimind-linux-x64-$SHORT.tgz"
docker run --rm -v "$WORK/src":/src:ro -v "$PWD":/out debian:12 \
  tar czf "/out/$(basename "$OUT")" --owner=0 --group=0 --exclude=./.git -C /src .
echo "$OUT"
shasum -a 256 "$OUT" | cut -d' ' -f1
echo "publish: gh release create tino-$SHORT -R fedec65/omnimind --prerelease --target $COMMIT $(basename "$OUT")"
