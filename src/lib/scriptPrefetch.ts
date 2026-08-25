// scriptPrefetch — warm the script page's three list calls from the board.
//
// The script page's document builds from list-project-entities +
// list-braindumps + list-scene-texts. Fired on pointerenter/pointerdown of
// the board's "Script →" button, the trio is already in flight (or done) by
// the time the route mounts, so the page opens on warm data instead of
// paying the waterfall after mount. Single-shot and story-scoped: the page
// TAKES the bundle (one use), and anything older than TTL_MS is stale.
import {
  listBraindumps,
  listProjectEntities,
  listSceneTexts,
  type ListProjectEntitiesResponse,
} from './freeformApi';

export type ScriptPrefetchBundle = {
  entities: ListProjectEntitiesResponse;
  bds: { projectId: string; braindumps: any[] };
  stexts: { projectId: string; sceneTexts: Array<{ eventId: string; html: string; updatedAt: string; stale?: boolean }> };
};

const TTL_MS = 15_000;

let slot: { storyId: string; at: number; promise: Promise<ScriptPrefetchBundle> } | null = null;

export function prefetchScriptData(storyId: string, token: string): void {
  if (slot && slot.storyId === storyId && Date.now() - slot.at < TTL_MS) return; // already warm
  const promise = (async () => {
    const [entities, bds, stexts] = await Promise.all([
      listProjectEntities({ projectId: storyId }, token),
      listBraindumps({ projectId: storyId }, token).catch(() => ({ projectId: storyId, braindumps: [] })),
      listSceneTexts({ projectId: storyId }, token).catch(() => ({ projectId: storyId, sceneTexts: [] })),
    ]);
    return { entities, bds, stexts };
  })();
  promise.catch(() => { slot = null; }); // a failed warm-up never blocks the page's own fetch
  slot = { storyId, at: Date.now(), promise };
}

/** One-shot take: the fresh in-flight bundle for this story, or null. */
export function takeScriptPrefetch(storyId: string): Promise<ScriptPrefetchBundle> | null {
  if (!slot || slot.storyId !== storyId || Date.now() - slot.at >= TTL_MS) return null;
  const p = slot.promise;
  slot = null;
  return p;
}
