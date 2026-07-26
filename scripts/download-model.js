#!/usr/bin/env node
/**
 * Post-install script: pre-download the embedding model
 * so the first run of Omnimind is fast.
 *
 * The multilingual NER model (~178MB) is optional and only pre-downloaded
 * when OMNIMIND_NER=onnx is set in the environment. Otherwise it downloads
 * lazily on first use (same pattern as the embedding model).
 */

import { pipeline } from '@xenova/transformers';

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const NER_MODEL = 'Xenova/bert-base-multilingual-cased-ner-hrl';

async function main() {
  console.log('[omnimind:postinstall] Pre-downloading embedding model...');
  try {
    // Trigger download by creating the pipeline
    await pipeline('feature-extraction', EMBEDDING_MODEL);
    console.log('[omnimind:postinstall] Model ready:', EMBEDDING_MODEL);
  } catch (err) {
    console.warn('[omnimind:postinstall] Model download failed (will retry on first run):', err.message);
    // Non-fatal: Xenova will retry on first use
  }

  if (process.env.OMNIMIND_NER === 'onnx') {
    console.log('[omnimind:postinstall] OMNIMIND_NER=onnx — pre-downloading NER model (~178MB)...');
    try {
      await pipeline('token-classification', NER_MODEL, { quantized: true });
      console.log('[omnimind:postinstall] Model ready:', NER_MODEL);
    } catch (err) {
      console.warn('[omnimind:postinstall] NER model download failed (will retry on first use):', err.message);
    }
  }

  process.exit(0);
}

main();
