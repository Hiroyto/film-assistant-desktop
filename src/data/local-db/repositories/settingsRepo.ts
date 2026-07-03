// settingsRepo (BC-10/08). Key-value JSON local (substitui localStorage —
// hasSeenTutorialHint BR-MIGRAR-042, lastResendCodeAt BR-MIGRAR-005, etc).
import { get, run } from '../db';
import type { SettingRow } from '../rows';

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const row = await get<SettingRow>('SELECT * FROM settings WHERE key = ?', [key]);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export async function setSetting(key: string, value: unknown, at: string = new Date().toISOString()): Promise<void> {
  await run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [key, JSON.stringify(value), at],
  );
}
