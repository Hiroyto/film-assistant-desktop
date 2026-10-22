// Story workflow resolution — which pathway a story lives in.
//
// A story is either an `outline` story (the structured editor at /home) or a
// `freeform` story (the corkboard at /freeform/:storyId). The choice is made
// once at creation (NewStoryModal) and must stick: every surface that opens a
// story routes through resolveStoryWorkflow so a corkboard story always
// returns to the corkboard.
//
// Source of truth is the `workflow` field on the work record. Because the
// works backend builds its own payload server-side and may not persist
// unknown fields, a localStorage map keeps a per-device fallback so routing
// never silently flips a corkboard story into the outline editor. If the
// backend is confirmed to persist `workflow`, the fallback simply never
// fires.
//
// Desktop: the grid record comes from worksFromLocal, which surfaces the local
// `stories.workflow` column (migration v2). That column is fed by the pull (the
// cloud record's field) and by local creation, so a corkboard story created on
// another device — or on the web — routes to the corkboard here too. The
// localStorage map stays as the per-device fallback for rows written before the
// column existed (and for the web, which has no local DB).

import type { StoryWorkflow } from '../models/story';

export type { StoryWorkflow };

const LS_KEY = 'ff-story-workflows';

function readMap(): Record<string, StoryWorkflow> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** The local tag alone — no record, no default. Desktop-only addition: the
 *  local-first layer stores only the POSITIVE (`stories.workflow` is freeform
 *  or null) and must never push or display a workflow it only inferred from
 *  the default, or an outline story would turn into a corkboard. */
export function taggedStoryWorkflow(storyId: string): StoryWorkflow | undefined {
  return readMap()[storyId];
}

/** Record a story's workflow locally (call at creation time). */
export function markStoryWorkflow(storyId: string, workflow: StoryWorkflow): void {
  try {
    const map = readMap();
    map[storyId] = workflow;
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — the work-record field is still the primary path */
  }
}

/** The workflow a story belongs to. Work-record field wins; localStorage
 *  fallback covers a backend that drops the field; default is the corkboard
 *  (2026-10-18, Ben: nothing defaults to outline). Records that predate the
 *  field were backfilled to an explicit workflow, outline where they hold
 *  outline content. */
export function resolveStoryWorkflow(
  story: { workflow?: string | null } | undefined | null,
  storyId: string,
): StoryWorkflow {
  if (story?.workflow === 'freeform') return 'freeform';
  if (story?.workflow === 'outline') return 'outline';
  return readMap()[storyId] === 'outline' ? 'outline' : 'freeform';
}
