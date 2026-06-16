// @proveria/shingling — V1 text shingling per docs/protocol/v1/shingling-v1.md.
//
// Pure, deterministic, no IO. Producers (desktop) + verifiers (Hash CLI,
// verifier lookup) both run these functions on plaintext and submit only the
// resulting hashes; plaintext never crosses the network.

export {
  PRESETS,
  SHINGLING_V1_VERSIONS,
  SHINGLING_PACKAGE_VERSION,
  type ShinglePreset,
  type SourceExtractionMethod,
  type PresetSpec,
} from './types.js';

export { normalizeForShingling } from './normalize.js';

export { tokenizeNormalized } from './tokenize.js';

export { generateShingles, type Shingle } from './shingle.js';

export {
  buildShinglePayload,
  computeShinglePayloadHash,
  computeShingleLeafHash,
  type ShingleHashContext,
} from './hash.js';
