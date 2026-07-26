/**
 * NerEngine — selector between the heuristic extractor and the ONNX model.
 *
 * The heuristic extractor (EntityExtractor) is always available and stays
 * the default. When configured with 'onnx', initNerEngine() loads the
 * multilingual ONNX model; if loading fails (no network on first download,
 * OOM, corrupted cache) the engine falls back to the heuristic with a
 * warning — extraction never breaks because of the optional model.
 */

import { extractEntities, type ExtractedEntity, type ExtractOptions } from '../EntityExtractor.js';
import { OnnxNerExtractor } from './OnnxNerExtractor.js';
import { type Result, ok } from '../types.js';

export type NerEngineKind = 'heuristic' | 'onnx';

export interface NerEngineInfo {
  readonly configured: NerEngineKind;
  readonly active: NerEngineKind;
  readonly modelLoaded: boolean;
  readonly loadFailed: boolean;
}

let configured: NerEngineKind = 'heuristic';
let onnx: OnnxNerExtractor | null = null;
let loadFailed = false;

/** Select the desired engine. Call initNerEngine() afterwards to load the model. */
export function configureNerEngine(engine: NerEngineKind): void {
  configured = engine;
}

/**
 * Load the ONNX model when the configured engine is 'onnx'.
 * Always resolves ok: a load failure only means the heuristic is used.
 */
export async function initNerEngine(): Promise<Result<void>> {
  if (configured === 'heuristic' || onnx !== null) {
    return ok(undefined);
  }
  const extractor = new OnnxNerExtractor();
  const result = await extractor.init();
  if (result.ok) {
    onnx = extractor;
  } else {
    loadFailed = true;
    console.warn(`[NerEngine] ONNX unavailable, falling back to heuristic: ${result.error.message}`);
  }
  return ok(undefined);
}

/**
 * Extract entities with the best available engine:
 * ONNX when loaded, heuristic otherwise (also on ONNX extraction errors).
 */
export async function extractEntitiesAsync(text: string, opts?: ExtractOptions): Promise<ExtractedEntity[]> {
  if (onnx !== null) {
    const result = await onnx.extract(text, opts);
    if (result.ok) return result.value;
    console.warn(`[NerEngine] ONNX extraction failed, using heuristic: ${result.error.message}`);
  }
  return extractEntities(text, opts);
}

/** Report which engine is configured and which one is actually serving */
export function getNerEngineInfo(): NerEngineInfo {
  return {
    configured,
    active: onnx !== null ? 'onnx' : 'heuristic',
    modelLoaded: onnx !== null,
    loadFailed,
  };
}

/** Test hook: reset all module state */
export function resetNerEngine(): void {
  configured = 'heuristic';
  onnx = null;
  loadFailed = false;
}

/** Test hook: inject a pre-built extractor (e.g. backed by a fake classifier) */
export function setOnnxExtractorForTest(extractor: OnnxNerExtractor | null): void {
  onnx = extractor;
}
