// B2 — worksFromLocal: monta o mapa `works` (shape legado) a partir do SQLite.
import { worksFromLocal } from './model/worksFromLocal';
import type { StoryRow, CharacterRow } from '../../data/local-db/rows';

const storyRow = (over: Partial<StoryRow> = {}): StoryRow => ({
  story_id: 'story_1', user_id: 'u1', title: 'My Story',
  brainstorm: 'bs', genre: 'drama', theme: 'loss', mood_setting: 'noir',
  core_question: 'why?', synopsis: 'sum',
  segments_json: JSON.stringify({ S1: { S: 'outline 1', scenes: [{ id: 'sc1' }] } }),
  version: 3, status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-02-02T00:00:00.000Z',
  synced_at: null,
  ...over,
});

const charRow = (over: Partial<CharacterRow> = {}): CharacterRow => ({
  story_id: 'story_1', name: 'Ana', description: 'lead',
  importance: 'major', locked: 1, is_new: 0, user_touched: 1,
  arc_starting_state: 'lost', arc_goal: 'find', arc_conflict: 'fear',
  arc_need: 'trust', arc_growth: 'dynamic',
  created_at: 'c', updated_at: 'u', synced_at: null,
  ...over,
});

describe('worksFromLocal (B2 — works do SQLite)', () => {
  it('monta o mapa works com title/segments/characters(map)/timestamps', async () => {
    const works = await worksFromLocal('u1', {
      listActiveStories: async () => [storyRow()],
      listByStory: async () => [charRow(), charRow({ name: 'Bia', locked: 0 })],
    });

    expect(Object.keys(works)).toEqual(['story_1']);
    const w = works['story_1'];
    expect(w.title).toBe('My Story');
    expect(w.M).toBe('noir');
    expect(w.lastModified).toBe('2026-02-02T00:00:00.000Z');
    expect(w.createdAt).toBe('2026-01-01T00:00:00.000Z');

    // segments sempre { S, scenes } (nunca scalar — RISK-011)
    expect(w.S1.S).toBe('outline 1');
    expect(w.S1.scenes).toHaveLength(1);
    expect(Array.isArray(w.S2.scenes)).toBe(true);

    // characters como MAPA keyed by name (loadCharactersFromStoryData faz Object.values)
    expect(Object.keys(w.characters).sort()).toEqual(['Ana', 'Bia']);
    expect(w.characters.Ana.locked).toBe(true);
    expect(w.characters.Bia.locked).toBe(false);
  });

  it('retorna {} quando não há stories (caller cai p/ backend)', async () => {
    const works = await worksFromLocal('u1', {
      listActiveStories: async () => [],
      listByStory: async () => [],
    });
    expect(works).toEqual({});
  });
});
