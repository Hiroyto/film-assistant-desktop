// OutlineEstimate hand-coded (BR-MIGRAR-050 / R-AI-7). Tempos de overlay da brainstorm.
// Full = 4000 (genre) + 6000 (synopsis) + 4500 × 9 segments = 50500ms.

export const PREVIEW_ESTIMATE_MS = 25_000;

const GENRE_MS = 4_000;
const SYNOPSIS_MS = 6_000;
const PER_SEGMENT_MS = 4_500;
const SEGMENT_COUNT = 9;

export const FULL_ESTIMATE_MS = GENRE_MS + SYNOPSIS_MS + PER_SEGMENT_MS * SEGMENT_COUNT; // 50500

export function estimateMs(kind: 'preview' | 'full'): number {
  return kind === 'preview' ? PREVIEW_ESTIMATE_MS : FULL_ESTIMATE_MS;
}
