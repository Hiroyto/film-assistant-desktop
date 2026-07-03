// Serialização canônica de Story (BC-02). CORAÇÃO da correção do lossy save
// (tech-debt #1 / BR-MIGRAR-013 / RISK-011): TODA save path serializa os segments
// como `{ S, scenes }` — NUNCA como scalar. Atualizar um campo de foundation/synopsis
// jamais apaga as scenes de um segment.
//
// CanonicalStory (domínio) <-> StoryRow (SQLite) <-> wire (payload backend).
import type { StoryRow } from '../../../data/local-db/rows';
import type { Character } from '../../../models/character';
import {
  CanonicalStory,
  CanonicalSegments,
  SegmentKey,
  SEGMENT_KEYS,
  emptySegments,
} from '../../../models/story';
import { normalizeSegmentValue } from '../../../data/sync-agent/transforms';
import { toCanonicalCharacterArray } from '../../../models/character';

/** Parse seguro de segments_json -> CanonicalSegments (sempre as 9 chaves). */
export function parseSegments(segmentsJson: string): CanonicalSegments {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(segmentsJson || '{}');
  } catch {
    raw = {};
  }
  const segs = emptySegments();
  for (const k of SEGMENT_KEYS) {
    segs[k] = normalizeSegmentValue(raw[k]); // sempre { S, scenes }
  }
  return segs;
}

/** StoryRow + characters -> CanonicalStory. */
export function rowToCanonical(row: StoryRow, characters: Character[] = []): CanonicalStory {
  return {
    storyId: row.story_id,
    title: row.title,
    BRAINSTORM: row.brainstorm ?? '',
    G: row.genre ?? '',
    T: row.theme ?? '',
    M: row.mood_setting ?? '',
    CQ: row.core_question ?? '',
    SUM: row.synopsis ?? '',
    segments: parseSegments(row.segments_json),
    characters,
    version: row.version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
  };
}

/** CanonicalStory -> StoryRow. segments_json SEMPRE estruturado (sem scalars). */
export function canonicalToRow(story: CanonicalStory, now: string): StoryRow {
  return {
    story_id: story.storyId,
    user_id: '', // preenchido pelo command (owner) — ver storyCommands
    title: story.title,
    brainstorm: story.BRAINSTORM || null,
    genre: story.G || null,
    theme: story.T || null,
    mood_setting: story.M || null,
    core_question: story.CQ || null,
    synopsis: story.SUM || null,
    segments_json: JSON.stringify(story.segments),
    version: story.version,
    status: story.status,
    created_at: story.createdAt,
    updated_at: now,
    synced_at: story.syncedAt,
  };
}

/** Payload wire (backend /works). Segments polimórficos preservados. */
export function canonicalToWire(story: CanonicalStory): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    storyId: story.storyId,
    title: story.title,
    BRAINSTORM: story.BRAINSTORM,
    G: story.G,
    T: story.T,
    M: story.M,
    CQ: story.CQ,
    SUM: story.SUM,
  };
  for (const k of SEGMENT_KEYS) wire[k] = story.segments[k]; // { S, scenes }
  return wire;
}

export type ScalarStoryField = 'title' | 'BRAINSTORM' | 'G' | 'T' | 'M' | 'CQ' | 'SUM';

/**
 * Atualiza um campo escalar (foundation/synopsis/brainstorm/title) PRESERVANDO
 * todos os segments e scenes. Retorna nova Story (imutável). Corrige o bug do
 * legado em que Profile.save()/Scripts.save() escreviam scalars e perdiam scenes.
 */
export function updateScalarField(story: CanonicalStory, field: ScalarStoryField, value: string): CanonicalStory {
  return { ...story, [field]: value, segments: story.segments }; // segments intactos
}

/** Atualiza o OUTLINE (texto .S) de um segment, preservando suas scenes. */
export function updateSegmentOutline(story: CanonicalStory, key: SegmentKey, outline: string): CanonicalStory {
  return {
    ...story,
    segments: { ...story.segments, [key]: { S: outline, scenes: story.segments[key].scenes } },
  };
}

/** Re-deriva characters canônicos (array) de qualquer source. */
export function withCharacters(story: CanonicalStory, source: unknown): CanonicalStory {
  return { ...story, characters: toCanonicalCharacterArray(source as any) };
}
