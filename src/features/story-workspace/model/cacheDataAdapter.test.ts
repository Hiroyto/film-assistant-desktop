// Tests for the CacheData<->Canonical adapter + desktop local mirror (Tarefa 17/18).
// The headline property is RISK-011 / BR-MIGRAR-013: lifting CacheData to canonical
// must NEVER drop a segment's scenes when a scalar field changes.

import { cacheDataToCanonical, mirrorStoryToLocal, CacheDataLike } from './cacheDataAdapter';
import type { StoryRow } from '../../../data/local-db/rows';

const BASE: CacheDataLike = {
  title: 'My Story',
  storyId: 'story_1700000000000_abc123',
  G: 'drama',
  T: 'redemption',
  M: 'noir city at night',
  CQ: 'can he change?',
  SUM: 'a synopsis',
  BRAINSTORM: 'some notes',
  // S1 carries scenes; S2 is a plain outline string; the rest empty.
  S1: { S: 'open on a rooftop', scenes: [{ sceneId: 'sc1', title: 'Rooftop', content: 'INT.' }] },
  S2: 'a plain outline string',
  characters: [{ name: 'Ada', description: 'the lead' }],
};

describe('cacheDataToCanonical', () => {
  it('normalizes every segment to { S, scenes } and preserves scenes', () => {
    const c = cacheDataToCanonical(BASE);
    expect(c.segments.S1.S).toBe('open on a rooftop');
    expect(c.segments.S1.scenes).toHaveLength(1);
    expect(c.segments.S1.scenes[0].sceneId).toBe('sc1');
    // string segment -> { S, scenes:[] }
    expect(c.segments.S2.S).toBe('a plain outline string');
    expect(c.segments.S2.scenes).toEqual([]);
    // empty segments are present with the canonical empty shape
    expect(c.segments.S9).toEqual({ S: '', scenes: [] });
  });

  it('maps scalar fields and characters (array)', () => {
    const c = cacheDataToCanonical(BASE);
    expect(c.storyId).toBe('story_1700000000000_abc123');
    expect(c.title).toBe('My Story');
    expect(c.G).toBe('drama');
    expect(c.SUM).toBe('a synopsis');
    expect(c.BRAINSTORM).toBe('some notes');
    expect(Array.isArray(c.characters)).toBe(true);
    expect(c.characters).toHaveLength(1);
    expect(c.characters[0].name).toBe('Ada');
  });

  it('RISK-011: changing a scalar (SUM) does NOT drop S1 scenes', () => {
    const edited = cacheDataToCanonical({ ...BASE, SUM: 'a brand new synopsis' });
    expect(edited.SUM).toBe('a brand new synopsis');
    expect(edited.segments.S1.scenes).toHaveLength(1); // scenes survive the scalar edit
    expect(edited.segments.S1.scenes[0].sceneId).toBe('sc1');
  });

  it('defaults a missing title to Untitled and tolerates missing fields', () => {
    const c = cacheDataToCanonical({ storyId: 'story_1_aaaaaa' });
    expect(c.title).toBe('Untitled');
    expect(c.G).toBe('');
    expect(c.segments.S1).toEqual({ S: '', scenes: [] });
    expect(c.characters).toEqual([]);
  });
});

describe('mirrorStoryToLocal', () => {
  it('upserts a StoryRow with user_id + synced_at set and scenes preserved in segments_json', async () => {
    const rows: StoryRow[] = [];
    await mirrorStoryToLocal(BASE, 'user-42', {
      upsertStory: (row: StoryRow) => {
        rows.push(row);
      },
      now: () => '2026-06-12T00:00:00.000Z',
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.story_id).toBe('story_1700000000000_abc123');
    expect(row.user_id).toBe('user-42');
    expect(row.title).toBe('My Story');
    // backend writer is legacy axios -> mirror marks the row synced to avoid pull conflicts
    expect(row.synced_at).toBe('2026-06-12T00:00:00.000Z');
    // scenes preserved through serialization
    const segs = JSON.parse(row.segments_json);
    expect(segs.S1.scenes).toHaveLength(1);
    expect(segs.S1.scenes[0].sceneId).toBe('sc1');
  });
});
