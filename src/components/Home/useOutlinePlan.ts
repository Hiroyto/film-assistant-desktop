/**
 * useOutlinePlan.ts
 * =================
 * Client-side mirror of the backend's buildGenerationPlan logic
 * (see story-processor.mjs). Returns:
 *   - plan:      which phases will run + which segments are empty
 *   - estimated: rough duration for progress-bar pacing (ms per phase)
 *
 * Why this exists:
 *   The OutlineGenerationOverlay needs to know (a) which phases the backend
 *   is about to run so it can show only the relevant stages, and (b) how
 *   long each phase is expected to take so the progress bar fills at a
 *   plausible rate rather than jumping between fixed percents.
 *
 *   Without this hook, the overlay would default to a generic 3-stage
 *   timer that lies when the backend is, e.g., only generating 2 segments
 *   (10-second actual run shown with a 24-second timer).
 *
 * How accurate is this:
 *   Not very — it's client-side estimation. Actual phase durations depend
 *   on the model (Haiku fast, Gemini 3 Pro slow) and server load. But
 *   since the overlay is cosmetic progress (not a hard ETA), slightly-
 *   wrong estimates are fine. The bar transitions smoothly between phases
 *   and the stage label is correct — that's the important part.
 *
 *   When/if the backend grows WebSocket progress streaming (FIL-330
 *   follow-up), this hook gets replaced with a real-time subscription
 *   and the overlay keeps the same shape. Design is forward-compatible.
 *
 * Timing assumptions (ms):
 *   These are tuned for ORCHESTRATOR_SEGMENT_MODEL = Haiku 4.5. If the
 *   orchestrator default changes (e.g., back to Gemini 3 Pro), update
 *   SEGMENT_MS. Metadata and summary use their own configured defaults
 *   so those numbers are more stable.
 */

import { useMemo } from 'react';

// ─── Estimated phase durations (ms) ──────────────────────────────────────────
// Tune these if the backend defaults change materially.
const METADATA_MS = 4_000;   // Phase A: metadata batch (single grounded-setting + single combined call)
const SUMMARY_MS  = 6_000;   // Phase B: summary generation
const SEGMENT_MS  = 4_500;   // Phase C: per-segment cost (Haiku 4.5 baseline)

const METADATA_FIELDS = ['G', 'T', 'M'] as const;
const SEGMENT_FIELDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'] as const;

export interface OutlinePlan {
  willGenerateMetadata: boolean;
  willGenerateSummary: boolean;
  segmentsToGenerate: string[];
  /** True if at least one phase will run — matches backend's nothingToGenerate check */
  hasWork: boolean;
}

export interface OutlineEstimate {
  /** Total estimated duration in ms */
  totalMs: number;
  /** Per-phase ms, in order of execution (skipped phases omitted) */
  phases: Array<{
    id: 'metadata' | 'summary' | 'segments';
    ms: number;
    /** For segments phase only — how many segments to generate */
    segmentCount?: number;
  }>;
}

export interface UseOutlinePlanResult {
  plan: OutlinePlan;
  estimated: OutlineEstimate;
}

/**
 * readField
 * Safely reads field content whether it's a string or { S: string } object.
 * Matches the readField helper in Home.tsx — duplicated here rather than
 * imported to keep this hook self-contained and easy to test.
 */
function readField(data: any, fieldName: string): string {
  const fieldData = data?.[fieldName];
  if (!fieldData) return '';
  if (typeof fieldData === 'string') return fieldData;
  if (typeof fieldData === 'object' && fieldData.S) return fieldData.S;
  return '';
}

function hasContent(data: any, fieldName: string): boolean {
  return readField(data, fieldName).trim() !== '';
}

/**
 * useOutlinePlan
 * Compute the generation plan from the current data state.
 *
 * Re-runs whenever `data` changes. Cheap — just a few string checks.
 * Consumers typically call this once at dispatch time and pass the result
 * to the overlay component, so the plan is stable for the duration of
 * the generation.
 *
 * @param data - The story data state from Home.tsx
 * @returns Plan describing what will be generated + duration estimate
 */
export function useOutlinePlan(data: any): UseOutlinePlanResult {
  return useMemo(() => {
    const missingMetadata = METADATA_FIELDS.filter(f => !hasContent(data, f));
    const needsSummary = !hasContent(data, 'SUM');
    const emptySegments = SEGMENT_FIELDS.filter(s => !hasContent(data, s));

    const willGenerateMetadata = missingMetadata.length > 0;
    const willGenerateSummary = needsSummary;
    const willGenerateSegments = emptySegments.length > 0;
    const hasWork = willGenerateMetadata || willGenerateSummary || willGenerateSegments;

    const plan: OutlinePlan = {
      willGenerateMetadata,
      willGenerateSummary,
      segmentsToGenerate: [...emptySegments],
      hasWork,
    };

    const phases: OutlineEstimate['phases'] = [];
    if (willGenerateMetadata) {
      phases.push({ id: 'metadata', ms: METADATA_MS });
    }
    if (willGenerateSummary) {
      phases.push({ id: 'summary', ms: SUMMARY_MS });
    }
    if (willGenerateSegments) {
      phases.push({
        id: 'segments',
        ms: SEGMENT_MS * emptySegments.length,
        segmentCount: emptySegments.length,
      });
    }

    const totalMs = phases.reduce((sum, p) => sum + p.ms, 0);

    return {
      plan,
      estimated: { totalMs, phases },
    };
  }, [data]);
}