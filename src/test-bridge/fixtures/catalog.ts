// Catálogo declarativo das fixtures (parity 19D). Fonte única que o seeder e o
// FixtureContext consomem. Cobre os nomes referenciados pelos parity specs. Fixtures
// "de banco" trazem `db` (linhas SQLite); fixtures de estado em memória trazem `hint`
// (conflito aberto, geração em voo, etc.) para o componente-dono interpretar.
import type { FixtureSpec, DbSeed } from './types';
import type { StoryRow, CharacterRow, SnapshotRow } from '../../data/local-db/rows';

const TEST_USER = 'test-user';
const TS = '2026-01-01T00:00:00.000Z';
const EXPIRES = '2026-02-01T00:00:00.000Z'; // TTL local do snapshot (~30 dias)

/** Snapshot pré-resolução de conflito (spec 12 t18). */
function preConflictSnapshot(entityId: string): SnapshotRow {
  return {
    id: `snap-${entityId}`,
    entity_type: 'story',
    entity_id: entityId,
    before_state: '{}',
    snapshot_at: TS,
    reason: 'pre_conflict_resolution',
    related_sync_queue_id: null,
    expires_at: EXPIRES,
  };
}

function story(id: string, title: string, overrides: Partial<StoryRow> = {}): StoryRow {
  return {
    story_id: id,
    user_id: TEST_USER,
    title,
    brainstorm: null,
    genre: null,
    theme: null,
    mood_setting: null,
    core_question: null,
    synopsis: null,
    segments_json: '{}',
    version: 1,
    status: 'active',
    created_at: TS,
    updated_at: TS,
    synced_at: null,
    ...overrides,
  };
}

function character(storyId: string, name: string, overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    story_id: storyId,
    name,
    description: null,
    importance: 'minor',
    locked: 0,
    is_new: 0,
    user_touched: 0,
    arc_starting_state: null,
    arc_goal: null,
    arc_conflict: null,
    arc_need: null,
    arc_growth: 'static',
    created_at: TS,
    updated_at: TS,
    synced_at: null,
    ...overrides,
  };
}

function nStories(n: number): StoryRow[] {
  return Array.from({ length: n }, (_, i) => story(`story-${i + 1}`, `Story ${i + 1}`));
}

const ACTIVE = 'story-active';
function activeStoryDb(extra: Partial<DbSeed> = {}): DbSeed {
  return { stories: [story(ACTIVE, 'Active Story')], activeStoryId: ACTIVE, ...extra };
}

/** Segmento S5 com duas cenas (spec 12 — scenes). */
function twoScenesSegments(): string {
  return JSON.stringify({
    S5: { S: 'Segment five', scenes: [{ id: 'scene_a', text: 'Scene A' }, { id: 'scene_b', text: 'Scene B' }] },
  });
}

export const FIXTURES: Record<string, FixtureSpec> = {
  // --- Billing / usuário (spec 06/09) ---
  'cap-100': { user: { cap: 100 } },
  free: { user: { subscription: undefined, cap: 0 } },
  member: { user: { subscription: 'member', cap: 250 } },

  // --- sync_queue depth (specs 07/09) ---
  '3-pending': { db: { queueDepth: 3 } },
  '20-pending-offline': { db: { queueDepth: 20 }, hint: 'offline' },

  // --- Stories (specs 03/07) ---
  'five-stories': { db: { stories: nStories(5) } },
  'active-story': { db: activeStoryDb() },

  // --- Scenes (spec 12) ---
  'two-scenes': {
    db: { stories: [story(ACTIVE, 'Active Story', { segments_json: twoScenesSegments() })], activeStoryId: ACTIVE },
    hint: 'segment-S5',
  },

  // --- Screenplay (spec 04) ---
  '90-pages': { db: activeStoryDb(), hint: '90-pages' },

  // --- Characters (spec 05) ---
  'alice-locked-bob': {
    db: {
      stories: [story(ACTIVE, 'Active Story')],
      activeStoryId: ACTIVE,
      characters: [
        character(ACTIVE, 'Alice', { locked: 1, importance: 'major' }),
        character(ACTIVE, 'Bob'),
      ],
    },
  },
  'ws-updating': { db: activeStoryDb(), hint: 'ws-updating' },

  // --- Conflito de sync (spec 08) — estado em memória ---
  'conflict-open': { db: activeStoryDb(), hint: 'conflict-open' },
  'conflict-resolved-keep-mine': {
    db: activeStoryDb({ snapshots: [preConflictSnapshot(ACTIVE)] }),
    hint: 'conflict-resolved-keep-mine',
  },
  'conflict-v6-local-v7-remote': { db: activeStoryDb(), hint: 'conflict-v6-local-v7-remote' },

  // --- Dirty / offline (specs 03/04/07) ---
  'dirty-scene': { db: { stories: [story(ACTIVE, 'Active Story', { segments_json: twoScenesSegments() })], activeStoryId: ACTIVE }, hint: 'dirty-scene' },
  'dirty-segment': { db: activeStoryDb(), hint: 'dirty-segment' },
  'offline-dirty': { db: activeStoryDb({ queueDepth: 1 }), hint: 'offline-dirty' },
  'offline-edit-s5': { db: { stories: [story(ACTIVE, 'Active Story', { segments_json: twoScenesSegments() })], activeStoryId: ACTIVE }, hint: 'offline-edit-s5' },

  // --- Pipeline IA (specs 04/10) — estado em memória ---
  generating: { db: activeStoryDb(), hint: 'generating' },
  'handoff-in-flight': { db: activeStoryDb(), hint: 'handoff-in-flight' },
  'ai-unresponsive': { db: activeStoryDb(), hint: 'ai-unresponsive' },
  'model-claude': { db: activeStoryDb(), hint: 'model-claude' },

  // --- Sync mechanics (specs 03/04/07) ---
  'local-vs-s3': { db: activeStoryDb(), hint: 'local-vs-s3' },
  'retry-same-request': { db: { queueDepth: 1 }, hint: 'retry-same-request' },
  'ws-exhausted': { db: activeStoryDb(), hint: 'ws-exhausted' },

  // --- Billing edge (spec 06) ---
  'webhook-arrived-no-deeplink': { user: { subscription: undefined }, hint: 'webhook-arrived-no-deeplink' },
};

export function resolveFixtureSpec(name: string | null): FixtureSpec | null {
  if (!name) return null;
  return FIXTURES[name] ?? null;
}
