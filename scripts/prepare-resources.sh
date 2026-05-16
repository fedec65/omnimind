#!/bin/bash
set -euo pipefail

# Prepare resources for bundling into a Tauri native app.
# Downloads a platform-specific Node.js binary, copies the compiled backend,
# prunes node_modules, and stages everything into src-tauri/resources/.
#
# Usage: ./scripts/prepare-resources.sh <platform> [node_version]
#   platform:   darwin-arm64 | darwin-x64 | linux-x64 | win32-x64
#   node_version: default 20.19.0

PLATFORM="${1:-}"
NODE_VERSION="${2:-20.19.0}"
RESOURCES_DIR="src-tauri/resources"

if [[ -z "$PLATFORM" ]]; then
  echo "Usage: $0 <platform> [node_version]"
  echo "  platform: darwin-arm64 | darwin-x64 | linux-x64 | win32-x64"
  exit 1
fi

# Map platform to Node.js download URL
 case "$PLATFORM" in
  darwin-arm64)
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz"
    NODE_BIN="node-v${NODE_VERSION}-darwin-arm64/bin/node"
    PRUNE_PLATFORM="darwin"
    ;;
  darwin-x64)
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz"
    NODE_BIN="node-v${NODE_VERSION}-darwin-x64/bin/node"
    PRUNE_PLATFORM="darwin"
    ;;
  linux-x64)
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
    NODE_BIN="node-v${NODE_VERSION}-linux-x64/bin/node"
    PRUNE_PLATFORM="linux"
    ;;
  win32-x64)
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip"
    NODE_BIN="node-v${NODE_VERSION}-win-x64/node.exe"
    PRUNE_PLATFORM="win32"
    ;;
  *)
    echo "Unknown platform: $PLATFORM"
    exit 1
    ;;
esac

echo "[prepare] Cleaning $RESOURCES_DIR"
rm -rf "$RESOURCES_DIR"
mkdir -p "$RESOURCES_DIR"

# --- Download Node.js ---
echo "[prepare] Downloading Node.js ${NODE_VERSION} for ${PLATFORM}"
NODE_ARCHIVE="/tmp/node-${PLATFORM}.tar.gz"
if [[ "$PLATFORM" == win32-x64 ]]; then
  NODE_ARCHIVE="/tmp/node-${PLATFORM}.zip"
fi

curl -fsSL "$NODE_URL" -o "$NODE_ARCHIVE"

NODE_EXTRACT_DIR="/tmp/node-extract-${PLATFORM}"
rm -rf "$NODE_EXTRACT_DIR"
mkdir -p "$NODE_EXTRACT_DIR"

if [[ "$PLATFORM" == win32-x64 ]]; then
  unzip -q "$NODE_ARCHIVE" -d "$NODE_EXTRACT_DIR"
else
  tar -xf "$NODE_ARCHIVE" -C "$NODE_EXTRACT_DIR"
fi

# Copy only the node binary and necessary shared libs
mkdir -p "$RESOURCES_DIR/node"
if [[ "$PLATFORM" == win32-x64 ]]; then
  cp -r "$NODE_EXTRACT_DIR"/node-v${NODE_VERSION}-win-x64/* "$RESOURCES_DIR/node/"
else
  cp -r "$NODE_EXTRACT_DIR"/node-v${NODE_VERSION}-*/* "$RESOURCES_DIR/node/"
fi

echo "[prepare] Node.js copied: $(ls "$RESOURCES_DIR/node/bin/" 2>/dev/null || ls "$RESOURCES_DIR/node/" | head -5)"

# --- Copy compiled backend ---
echo "[prepare] Copying dist/"
cp -r dist "$RESOURCES_DIR/dist"

# --- Copy node_modules ---
echo "[prepare] Copying node_modules/"
cp -r node_modules "$RESOURCES_DIR/node_modules"

# --- Copy model cache ---
CACHE_SRC="node_modules/@xenova/transformers/.cache"
if [[ -d "$CACHE_SRC" ]]; then
  echo "[prepare] Copying model cache"
  mkdir -p "$RESOURCES_DIR/.cache"
  cp -r "$CACHE_SRC"/* "$RESOURCES_DIR/.cache/"
else
  echo "[prepare] Warning: model cache not found at $CACHE_SRC"
fi

# --- Prune ---
echo "[prepare] Pruning node_modules for $PRUNE_PLATFORM"
cd "$RESOURCES_DIR"
node ../../scripts/prune-for-bundle.js "$PRUNE_PLATFORM"
cd ../..

# --- Size report ---
echo "[prepare] Done. Resource sizes:"
du -sh "$RESOURCES_DIR"/* 2>/dev/null || true
echo "[prepare] Total: $(du -sh "$RESOURCES_DIR" | cut -f1)"
