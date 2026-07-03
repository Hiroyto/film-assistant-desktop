// CacheData (legacy App.tsx story state) <-> CanonicalStory adapter + desktop
// local-first MIRROR (Fase de Integração — Tarefa 17/18).
//
// The adapter is the App/home boundary: it lifts the legacy CacheData shape
// (S1..S9 as string | {S,scenes}, characters as map/array) into the canonical
// Story (segments ALWAYS {S,scenes}; characters as array) WITHOUT ever dropping
// scenes — each segment is normalized independently, so updating a scalar field
// (synopsis/brainstorm/title) never wipes a segment's scenes (corrige tech-debt
// #1 / RISK-011 / BR-MIGRAR-013 lossy save).
//
// mirrorStoryToLocal writes the saved story into the local SQLite cache on
// desktop. STRANGLER FIG: the legacy axios POST /works stays the BACKEND writer
// for now, so the mirror sets synced_at = now to converge cleanly with the
// scheduler pull (no spurious version conflicts). Flipping the backend writer to
// the sync queue (queue->push) is gated on backend-coordination (the /works
// event+userId payload contract) + a parity harness.

import {
  CanonicalStory,
  CanonicalSegments,
  SEGMENT_KEYS,
  emptySegments,
  StoryStatus,
} from '../../../models/story';
import { normalizeSegmentValue } from '../../../data/sync-agent/transforms';
import { toCanonicalCharacterArray } from '../../../models/character';
import { canonicalToRow } from './storySerialization';
import { storyRepo as defaultStoryRepo } from '../../../data/local-db/repositories';
import type { StoryRow } from '../../../data/local-db/rows';

/** Subconjunto do CacheData legado relevante para a Story (tolerante a ausências). */
export interface CacheDataLike {
  title?: string;
  storyId?: string;
  M?: string;
  T?: string;
  G?: string;
  CQ?: string;
  SUM?: string;
  BRAINSTORM?: string;
  S1?: unknown;
  S2?: unknown;
  S3?: unknown;
  S4?: unknown;
  S5?: unknown;
  S6?: unknown;
  S7?: unknown;
  S8?: unknown;
  S9?: unknown;
  characters?: unknown;
  [k: string]: unknown;
}

export interface CacheToCanonicalOpts {
  version?: number;
  status?: StoryStatus;
  createdAt?: string;
  updatedAt?: string;
  syncedAt?: string | null;
  now?: () => string;
}

/**
 * CacheData -> CanonicalStory. Cada segment é normalizado independentemente para
 * { S, scenes }; portanto atualizar um campo escalar (synopsis/brainstorm/title)
 * JAMAIS apaga as scenes de um segment (RISK-011 / BR-MIGRAR-013).
 */
export function cacheDataToCanonical(
  data: CacheDataLike,
  opts: CacheToCanonicalOpts = {},
): CanonicalStory {
  const now = (opts.now ?? (() => new Date().toISOString()))();
  const segments: CanonicalSegments = emptySegments();
  for (const k of SEGMENT_KEYS) {
    segments[k] = normalizeSegmentValue((data as Record<string, unknown>)[k]);
  }
  return {
    storyId: data.storyId ?? '',
    title: typeof data.title === 'string' && data.title ? data.title : 'Untitled',
    BRAINSTORM: data.BRAINSTORM ?? '',
    G: data.G ?? '',
    T: data.T ?? '',
    M: data.M ?? '',
    CQ: data.CQ ?? '',
    SUM: data.SUM ?? '',
    segments,
    characters: toCanonicalCharacterArray(data.characters as any),
    version: opts.version ?? 1,
    status: opts.status ?? 'active',
    createdAt: opts.createdAt ?? now,
    updatedAt: opts.updatedAt ?? now,
    syncedAt: opts.syncedAt ?? null,
  };
}

export interface MirrorDeps {
  upsertStory: (row: StoryRow) => Promise<void> | void;
  now?: () => string;
}

/**
 * Espelha a Story salva no SQLite local (desktop). O writer de backend continua
 * sendo o axios POST /works legado; por isso synced_at = now (converge com o pull
 * sem conflito espúrio). Desktop-only — o caller deve checar isDesktop().
 */
export async function mirrorStoryToLocal(
  data: CacheDataLike,
  userId: string,
  deps: MirrorDeps = { upsertStory: defaultStoryRepo.upsertStory },
): Promise<void> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const canonical = cacheDataToCanonical(data, { syncedAt: now, now: () => now });
  const row: StoryRow = { ...canonicalToRow(canonical, now), user_id: userId, synced_at: now };
  await deps.upsertStory(row);
}
