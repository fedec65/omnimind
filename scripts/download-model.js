#!/usr/bin/env node
/**
 * Post-install script: pre-download the embedding model
 * so the first run of Omnimind is fast.
 */

import { pipeline } from '@xenova/transformers';

const MODEL = 'Xenova/all-MiniLM-L6-v2';

async function main() {
  console.log('[omnimind:postinstall] Pre-downloading embedding model...');
  try {
    // Trigger download by creating the pipeline
    await pipeline('feature-extraction', MODEL);
    console.log('[omnimind:postinstall] Model ready:', MODEL);
  } catch (err) {
    console.warn('[omnimind:postinstall] Model download failed (will retry on first run):', err.message);
    // Non-fatal: Xenova will retry on first use
    process.exit(0);
  }
}

main();
