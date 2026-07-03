// screenplayRepo (BC-03/08). HTML do screenplay em SQLite (BLOB) — substitui o
// localStorage como mirror local (BR-MIGRAR-035). Load priority: SQLite > state > S3
// (BR-MIGRAR-036). Pull lazy ao abrir a story (Tarefa 11).
import { get, run } from '../db';
import type { ScreenplayRow } from '../rows';

export async function getScreenplay(storyId: string): Promise<ScreenplayRow | null> {
  return get<ScreenplayRow>('SELECT * FROM screenplays WHERE story_id = ?', [storyId]);
}

export async function upsertScreenplay(s: ScreenplayRow): Promise<void> {
  await run(
    `INSERT INTO screenplays (story_id, html_content, version, updated_at, synced_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(story_id) DO UPDATE SET
       html_content=excluded.html_content, version=excluded.version,
       updated_at=excluded.updated_at, synced_at=excluded.synced_at`,
    [s.story_id, s.html_content, s.version, s.updated_at, s.synced_at],
  );
}

export async function markSynced(storyId: string, at: string, version: number): Promise<void> {
  await run('UPDATE screenplays SET synced_at = ?, version = ? WHERE story_id = ?', [at, version, storyId]);
}
