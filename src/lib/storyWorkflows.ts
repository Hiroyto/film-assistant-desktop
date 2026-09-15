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

export type StoryWorkflow = 'outline' | 'freeform';

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

/** The workflow a story belongs to. A `freeform` tag from EITHER source wins;
 *  only then does the record's field decide; default is outline.
 *
 *  Why freeform wins over a record that says `outline`: the local tag is written
 *  once, at creation, from the writer's explicit choice, and a story never
 *  converts from corkboard to outline. A work record claiming `outline` for a
 *  story this device tagged as freeform is a LOST FIELD, not a conversion — and
 *  obeying it strands the board (the corkboard's graph lives in the freeform
 *  backend, so the outline editor opens an empty template over real work). The
 *  desktop hits exactly this: its local-first save never sends `workflow` to
 *  /works, so the cloud record answers for a field it never received. */
export function resolveStoryWorkflow(
  story: { workflow?: string } | undefined | null,
  storyId: string,
): StoryWorkflow {
  if (story?.workflow === 'freeform') return 'freeform';
  if (readMap()[storyId] === 'freeform') return 'freeform';
  return 'outline';
}
