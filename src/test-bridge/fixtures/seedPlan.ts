// Resolução PURA de uma fixture em um plano de semente (parity 19D). Sem efeitos —
// testável isoladamente. A aplicação (applySeed.ts) consome este plano.
import type { FixtureSpec, SeedPlan } from './types';

export function buildSeedPlan(spec: FixtureSpec | null): SeedPlan {
  const db = spec?.db ?? {};
  const stories = db.stories ?? [];
  const activeStoryId =
    db.activeStoryId ?? (stories.length === 1 ? stories[0].story_id : null);
  return {
    user: spec?.user ?? {},
    stories,
    characters: db.characters ?? [],
    snapshots: db.snapshots ?? [],
    queueDepth: Math.max(0, db.queueDepth ?? 0),
    activeStoryId,
    hint: spec?.hint ?? null,
  };
}
