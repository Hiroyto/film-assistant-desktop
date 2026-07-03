// Test for the desktop character mirror (BC-05 cutover slice — Tarefa 23).
import { mirrorCharactersToLocal } from './model/characterCommands';
import type { CharacterRow } from '../../data/local-db/rows';

describe('mirrorCharactersToLocal', () => {
  it('converts a DDB character map to canonical rows and replaces them for the story', async () => {
    let captured: { storyId: string; rows: CharacterRow[] } | null = null;
    await mirrorCharactersToLocal(
      'story_1700_abc',
      {
        Ada: { name: 'Ada', description: 'lead', importance: 'major', locked: true, arc: { goal: 'win', growth: 'dynamic' } },
        Bo: { name: 'Bo' }, // defaults: minor / static
        ghost: { name: '' }, // dropped — no name = no identity
      },
      {
        replaceCharactersForStory: (storyId: string, rows: CharacterRow[]) => {
          captured = { storyId, rows };
        },
        now: () => '2026-06-12T00:00:00.000Z',
      },
    );

    expect(captured).not.toBeNull();
    const cap = captured as unknown as { storyId: string; rows: CharacterRow[] };
    expect(cap.storyId).toBe('story_1700_abc');
    expect(cap.rows.map((r) => r.name).sort()).toEqual(['Ada', 'Bo']); // nameless dropped
    const ada = cap.rows.find((r) => r.name === 'Ada')!;
    expect(ada.story_id).toBe('story_1700_abc');
    expect(ada.importance).toBe('major');
    expect(ada.locked).toBe(1);
    expect(ada.arc_goal).toBe('win');
    expect(ada.arc_growth).toBe('dynamic');
    expect(ada.synced_at).toBe('2026-06-12T00:00:00.000Z'); // backend writer is legacy axios
    const bo = cap.rows.find((r) => r.name === 'Bo')!;
    expect(bo.importance).toBe('minor'); // default
    expect(bo.arc_growth).toBe('static'); // default
  });

  it('accepts an array source and no-ops without a storyId', async () => {
    let called = 0;
    await mirrorCharactersToLocal('s1', [{ name: 'Cy' }], {
      replaceCharactersForStory: () => {
        called++;
      },
    });
    await mirrorCharactersToLocal('', [{ name: 'Cy' }], {
      replaceCharactersForStory: () => {
        called++;
      },
    });
    expect(called).toBe(1); // second call (no storyId) was a no-op
  });
});
