#!/usr/bin/env node
/**
 * Prune node_modules for bundling into a native app.
 * Removes files not needed at runtime (tests, docs, TS defs, source maps,
 * platform-specific native binaries for OTHER platforms).
 *
 * Usage: node scripts/prune-for-bundle.js <platform>
 *   platform: darwin | linux | win32
 */

import { readdirSync, statSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

const PLATFORM = process.argv[2];
if (!PLATFORM || !['darwin', 'linux', 'win32'].includes(PLATFORM)) {
  console.error('Usage: node scripts/prune-for-bundle.js <darwin|linux|win32>');
  process.exit(1);
}

const ROOT = join(process.cwd(), 'node_modules');

const KEEP_ONNX_PLATFORMS = new Set([PLATFORM]);
const ONNX_RUNTIME_PATHS = [
  'onnxruntime-node/bin',
  '@xenova/transformers/node_modules/onnxruntime-node/bin',
];

const FILES_TO_REMOVE = [
  '.DS_Store',
  '.editorconfig',
  '.eslintignore',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  '.jshintrc',
  '.npmignore',
  '.nycrc',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  '.travis.yml',
  '.yarn-metadata.json',
  'appveyor.yml',
  'AUTHORS',
  'CHANGELOG',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'HISTORY.md',
  'ISSUE_TEMPLATE.md',
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'Makefile',
  'README',
  'README.md',
  'TODO.md',
];

const EXTENSIONS_TO_REMOVE = [
  '.d.ts',
  '.d.ts.map',
  '.flow',
  '.ts.map',
  '.test.js',
  '.test.ts',
  '.spec.js',
  '.spec.ts',
];

const DIRS_TO_REMOVE = [
  '.github',
  '.git',
  '__tests__',
  'benchmark',
  'benchmarks',
  'demo',
  'demos',
  'doc',
  'docs',
  'example',
  'examples',
  'jest',
  'scripts',
  'spec',
  'specs',
  'test',
  'tests',
  'tsconfig',
  'tsconfig.json',
  'typings',
];

let removedFiles = 0;
let removedDirs = 0;
let removedBytes = 0;

function getSize(path) {
  try {
    const stats = statSync(path);
    return stats.isDirectory() ? 0 : stats.size;
  } catch {
    return 0;
  }
}

function removeFile(path) {
  const size = getSize(path);
  try {
    unlinkSync(path);
    removedFiles++;
    removedBytes += size;
  } catch {
    // ignore
  }
}

function removeDir(path) {
  try {
    rmdirSync(path, { recursive: true });
    removedDirs++;
  } catch {
    // ignore
  }
}

function shouldRemoveFile(name) {
  const lower = name.toLowerCase();
  if (FILES_TO_REMOVE.some(f => lower === f.toLowerCase())) return true;
  if (EXTENSIONS_TO_REMOVE.some(ext => lower.endsWith(ext))) return true;
  return false;
}

function shouldRemoveDir(name) {
  const lower = name.toLowerCase();
  return DIRS_TO_REMOVE.some(d => lower === d.toLowerCase());
}

function pruneDirectory(dir, depth = 0) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(dir, entry);
    const isDir = statSync(path).isDirectory();

    if (isDir) {
      if (shouldRemoveDir(entry)) {
        removeDir(path);
        continue;
      }
      pruneDirectory(path, depth + 1);
    } else {
      if (shouldRemoveFile(entry)) {
        removeFile(path);
      }
    }
  }
}

function pruneOnnxPlatforms() {
  for (const base of ONNX_RUNTIME_PATHS) {
    const binPath = join(ROOT, base);
    if (!existsSync(binPath)) continue;

    let entries;
    try {
      entries = readdirSync(binPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const path = join(binPath, entry);
      if (!statSync(path).isDirectory()) continue;

      // entry is like "napi-v3" or "napi-v6"
      const versionPath = path;
      let platforms;
      try {
        platforms = readdirSync(versionPath);
      } catch {
        continue;
      }

      for (const platform of platforms) {
        if (KEEP_ONNX_PLATFORMS.has(platform)) continue;
        const platformPath = join(versionPath, platform);
        if (statSync(platformPath).isDirectory()) {
          const sizeBefore = removedBytes;
          removeDir(platformPath);
          // Rough estimate: we don't track dir sizes recursively
          removedBytes += 10_000_000; // approximate
        }
      }
    }
  }
}

function main() {
  if (!existsSync(ROOT)) {
    console.error('node_modules not found at', ROOT);
    process.exit(1);
  }

  console.log(`[prune] Pruning node_modules for platform: ${PLATFORM}`);

  pruneDirectory(ROOT);
  pruneOnnxPlatforms();

  const mb = (removedBytes / 1024 / 1024).toFixed(1);
  console.log(
    `[prune] Removed ${removedFiles} files, ${removedDirs} dirs (~${mb} MB)`
  );
}

main();
