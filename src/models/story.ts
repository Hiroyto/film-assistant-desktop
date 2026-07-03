import type { Scene } from './scene';
import type { Character } from './character';

// ===========================================================================
// LEGADO (wire shape) — usado pela web SPA (Strangler Fig). NÃO remover: os
// componentes legados preservados em src/components/ ainda dependem deste shape
// (S1..S9 como string, characters como Record). O desktop usa o shape CANÔNICO
// definido abaixo; a tradução é feita pelos transforms (data/sync-agent).
// ===========================================================================
export interface Story {
    storyId: string;
    title: string;
    SUM: string;
    G: string;
    CQ: string;
    M: string;
    T: string;
    S1: string;
    S2: string;
    S3: string;
    S4: string;
    S5: string;
    S6: string;
    S7: string;
    S8: string;
    S9: string;

    characters: Record<string, any>
    createdAt: string;
    lastModified: string;
    version: number;

    [key: string]: any;
}

// ===========================================================================
// CANÔNICO (AGG-Story) — consolida os 4 shapes legados em um (BR-MIGRAR-053 /
// tech-debt #11). Fonte: target_domain_model.md (AGG-Story, Segment, VOs).
// ===========================================================================

/** S1..S9 — outline de 9 segments em 3 atos (BR-MIGRAR-012, ADR-0002). */
export type SegmentKey = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9';

export const SEGMENT_KEYS: SegmentKey[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];

/** Segmento polimórfico canônico: { S: outline, scenes: Scene[] } (BR-MIGRAR-013). */
export interface Segment {
  S: string;
  scenes: Scene[];
}

export type CanonicalSegments = Record<SegmentKey, Segment>;

export type StoryStatus = 'active' | 'soft_deleted';

/**
 * Story canônica (CacheData). Source-of-truth local (AD-01). `characters` é ARRAY
 * (BR-MIGRAR-025). `S1..S9` são objetos `{ S, scenes }` — Profile/Scripts NÃO podem
 * mais escrever scalars (corrige tech-debt #1 lossy save — BR-MIGRAR-013).
 */
export interface CanonicalStory {
  storyId: string;
  title: string;
  BRAINSTORM: string;
  G: string; // genre
  T: string; // theme
  M: string; // mood/setting
  CQ: string; // core question
  SUM: string; // synopsis
  segments: CanonicalSegments;
  characters: Character[];
  version: number;
  status: StoryStatus;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
}

/** Alias semântico (o spec chama o shape canônico de "CacheData"). */
export type CacheData = CanonicalStory;

// --- Invariantes do produto -------------------------------------------------

/** Máximo de stories simultâneas por user (BR-MIGRAR-009, hard-coded por DEC-009). */
export const STORIES_LIMIT = 5;

/** Mínimo de chars no BRAINSTORM para habilitar "Build Your Story" (BR-MIGRAR-010). */
export const BRAINSTORM_MIN_CHARS = 50;

export function canBuildStory(brainstorm: string): boolean {
  return brainstorm.trim().length >= BRAINSTORM_MIN_CHARS;
}

export function canCreateStory(currentActiveCount: number): boolean {
  return currentActiveCount < STORIES_LIMIT;
}

// --- Value Object: StoryId --------------------------------------------------

/** Regex do StoryId (BR-MIGRAR-011): `story_<unix-ms>_<rand6>`. */
export const STORY_ID_REGEX = /^story_\d+_[a-z0-9]{6}$/;

export function isValidStoryId(id: string): boolean {
  return STORY_ID_REGEX.test(id);
}

function randomBase36(len: number): string {
  let out = '';
  while (out.length < len) out += Math.random().toString(36).slice(2);
  return out.slice(0, len);
}

/** Gera um StoryId client-side definitivo (BR-MIGRAR-011). */
export function generateStoryId(now: number = Date.now()): string {
  return `story_${now}_${randomBase36(6)}`;
}

// --- Value Object: OutlineBeat (1..9) + mapeamento de atos -------------------

export type OutlineBeat = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Ato (I/II/III) de um beat: S1-S3 = I, S4-S6 = II, S7-S9 = III (BR-MIGRAR-012). */
export function actOfBeat(beat: OutlineBeat): 1 | 2 | 3 {
  if (beat <= 3) return 1;
  if (beat <= 6) return 2;
  return 3;
}

export function segmentKeyOfBeat(beat: OutlineBeat): SegmentKey {
  return `S${beat}` as SegmentKey;
}

/** Cria os 9 segments vazios canônicos. */
export function emptySegments(): CanonicalSegments {
  const segs = {} as CanonicalSegments;
  for (const k of SEGMENT_KEYS) segs[k] = { S: '', scenes: [] };
  return segs;
}