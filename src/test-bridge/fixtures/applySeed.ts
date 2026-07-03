// Aplica um SeedPlan ao banco local via os repositories reais + sync-queue (parity
// 19D). Glue fino, exercitado em runtime (IPC SQLite). As dependências são injetáveis
// para teste. Idempotente: usa upsert.
import type { SeedPlan } from './types';
import { storyRepo, characterRepo, snapshotRepo, userRepo } from '../../data/local-db/repositories';
import { enqueueMutation } from '../../data/sync-queue';
import type { StoryRow, CharacterRow, SnapshotRow, UserRow } from '../../data/local-db/rows';

export interface SeedDeps {
  upsertUser: (u: UserRow) => Promise<void>;
  upsertStory: (s: StoryRow) => Promise<void>;
  upsertCharacter: (c: CharacterRow) => Promise<void>;
  createSnapshot: (s: SnapshotRow) => Promise<void>;
  enqueue: (entityId: string) => Promise<unknown>;
}

const defaultDeps: SeedDeps = {
  upsertUser: (u) => userRepo.upsertUser(u),
  upsertStory: (s) => storyRepo.upsertStory(s),
  upsertCharacter: (c) => characterRepo.upsert(c),
  createSnapshot: (s) => snapshotRepo.create(s),
  enqueue: (entityId) =>
    enqueueMutation({ entityType: 'story', entityId, operation: 'update', payload: { seeded: true } }),
};

const SEED_TS = '2026-01-01T00:00:00.000Z';

/** Linha mínima de users para satisfazer o FK stories.user_id → users(user_id). */
function minimalUser(userId: string, patch: SeedPlan['user']): UserRow {
  const p = (patch ?? {}) as { cap?: number; subscription?: string };
  return {
    user_id: userId,
    email: `${userId}@test.local`, // NOT NULL UNIQUE no schema
    preferred_username: null,
    cap: typeof p.cap === 'number' ? p.cap : 0,
    subscription: p.subscription ?? null,
    privacy: null,
    mfa_configured: 'OFF',
    last_signed_in_at: null,
    created_at: SEED_TS,
    updated_at: SEED_TS,
    synced_at: null,
  };
}

/**
 * Escreve stories/characters/snapshots e enfileira `queueDepth` mutations pendentes.
 * Semeia PRIMEIRO os users donos das stories (FK stories.user_id → users com
 * foreign_keys=ON — sem isto o INSERT de story falha com FOREIGN KEY constraint failed,
 * erro que o boot engolia deixando o banco vazio; runtime 19).
 */
export async function applySeedPlan(plan: SeedPlan, deps: SeedDeps = defaultDeps): Promise<void> {
  const userIds = Array.from(new Set(plan.stories.map((s) => s.user_id)));
  for (const uid of userIds) await deps.upsertUser(minimalUser(uid, plan.user));
  for (const s of plan.stories) await deps.upsertStory(s);
  for (const c of plan.characters) await deps.upsertCharacter(c);
  for (const snap of plan.snapshots) await deps.createSnapshot(snap);
  for (let i = 0; i < plan.queueDepth; i++) {
    await deps.enqueue(`${plan.activeStoryId ?? 'seed'}#${i}`);
  }
}
