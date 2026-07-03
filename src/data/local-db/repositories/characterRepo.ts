// characterRepo (BC-05/08). Escopo por story; PK composta (story_id, name) —
// BR-MIGRAR-018. replaceCharactersForStory roda em transação (batch).
import { all, run, batch } from '../db';
import type { CharacterRow } from '../rows';

export async function listByStory(storyId: string): Promise<CharacterRow[]> {
  return all<CharacterRow>('SELECT * FROM characters WHERE story_id = ? ORDER BY name', [storyId]);
}

function insertSql(): string {
  return `INSERT INTO characters
    (story_id, name, description, importance, locked, is_new, user_touched,
     arc_starting_state, arc_goal, arc_conflict, arc_need, arc_growth,
     created_at, updated_at, synced_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(story_id, name) DO UPDATE SET
     description=excluded.description, importance=excluded.importance,
     locked=excluded.locked, is_new=excluded.is_new, user_touched=excluded.user_touched,
     arc_starting_state=excluded.arc_starting_state, arc_goal=excluded.arc_goal,
     arc_conflict=excluded.arc_conflict, arc_need=excluded.arc_need,
     arc_growth=excluded.arc_growth, updated_at=excluded.updated_at, synced_at=excluded.synced_at`;
}

function params(c: CharacterRow): unknown[] {
  return [
    c.story_id, c.name, c.description, c.importance, c.locked, c.is_new, c.user_touched,
    c.arc_starting_state, c.arc_goal, c.arc_conflict, c.arc_need, c.arc_growth,
    c.created_at, c.updated_at, c.synced_at,
  ];
}

export async function upsert(c: CharacterRow): Promise<void> {
  await run(insertSql(), params(c));
}

export async function remove(storyId: string, name: string): Promise<void> {
  await run('DELETE FROM characters WHERE story_id = ? AND name = ?', [storyId, name]);
}

/** Substitui todo o conjunto de characters de uma story (initial pull / WS push). */
export async function replaceCharactersForStory(storyId: string, rows: CharacterRow[]): Promise<void> {
  await batch([
    { sql: 'DELETE FROM characters WHERE story_id = ?', params: [storyId] },
    ...rows.map((c) => ({ sql: insertSql(), params: params(c) })),
  ]);
}
