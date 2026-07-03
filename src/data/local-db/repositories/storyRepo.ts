// storyRepo (BC-02/08). Stories são source-of-truth local (AD-01). STORIES_LIMIT
// é enforçado no insert (BR-MIGRAR-009). version = optimistic lock para conflito.
import { all, get, run } from '../db';
import type { StoryRow } from '../rows';

export async function getStory(storyId: string): Promise<StoryRow | null> {
  return get<StoryRow>('SELECT * FROM stories WHERE story_id = ?', [storyId]);
}

export async function listActiveStories(userId: string): Promise<StoryRow[]> {
  return all<StoryRow>(
    "SELECT * FROM stories WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC",
    [userId],
  );
}

export async function countActiveStories(userId: string): Promise<number> {
  const row = await get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM stories WHERE user_id = ? AND status = 'active'",
    [userId],
  );
  return row?.n ?? 0;
}

export async function upsertStory(s: StoryRow): Promise<void> {
  await run(
    `INSERT INTO stories
       (story_id, user_id, title, brainstorm, genre, theme, mood_setting, core_question,
        synopsis, segments_json, version, status, created_at, updated_at, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(story_id) DO UPDATE SET
       title=excluded.title, brainstorm=excluded.brainstorm, genre=excluded.genre,
       theme=excluded.theme, mood_setting=excluded.mood_setting,
       core_question=excluded.core_question, synopsis=excluded.synopsis,
       segments_json=excluded.segments_json, version=excluded.version,
       status=excluded.status, updated_at=excluded.updated_at, synced_at=excluded.synced_at`,
    [
      s.story_id, s.user_id, s.title, s.brainstorm, s.genre, s.theme, s.mood_setting,
      s.core_question, s.synopsis, s.segments_json, s.version, s.status,
      s.created_at, s.updated_at, s.synced_at,
    ],
  );
}

/** Soft-delete local (não apaga até o sync confirmar — AD-01). */
export async function softDelete(storyId: string, at: string): Promise<void> {
  await run("UPDATE stories SET status = 'soft_deleted', updated_at = ? WHERE story_id = ?", [at, storyId]);
}

/** Marca como sincronizada após push bem-sucedido. */
export async function markSynced(storyId: string, at: string, version: number): Promise<void> {
  await run('UPDATE stories SET synced_at = ?, version = ? WHERE story_id = ?', [at, version, storyId]);
}
