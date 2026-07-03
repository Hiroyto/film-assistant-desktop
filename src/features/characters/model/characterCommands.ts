// Comandos de Character (BC-05). PK = name (BR-MIGRAR-018: rename = delete+create).
// Ops de array PURAS + persistência local-first. saveCharacters requer storyId (BR-020).
import { characterRepo } from '../../../data/local-db/repositories';
import { enqueueMutation } from '../../../data/sync-queue';
import { Character, toCanonicalCharacter, toCanonicalCharacterArray } from '../../../models/character';
import type { CharacterRow, SqliteBool } from '../../../data/local-db/rows';

const bool = (b: boolean): SqliteBool => (b ? 1 : 0);

function toRow(storyId: string, c: Character, now: string): CharacterRow {
  return {
    story_id: storyId,
    name: c.name,
    description: c.description ?? null,
    importance: c.importance,
    locked: bool(c.locked),
    is_new: bool(c.is_new),
    user_touched: bool(c.user_touched),
    arc_starting_state: c.arc.starting_state ?? null,
    arc_goal: c.arc.goal ?? null,
    arc_conflict: c.arc.conflict ?? null,
    arc_need: c.arc.need ?? null,
    arc_growth: c.arc.growth,
    created_at: now,
    updated_at: now,
    synced_at: now,
  };
}

// --- Ops de array puras (edição em memória) ---------------------------------

export function addCharacter(list: Character[], raw: Partial<Character> & { name: string }): Character[] {
  const canon = toCanonicalCharacter({ ...raw, is_new: true, user_touched: true });
  if (!canon) return list;
  if (list.some((c) => c.name === canon.name)) {
    return list.map((c) => (c.name === canon.name ? canon : c)); // upsert por name (PK)
  }
  return [...list, canon];
}

export function updateCharacter(list: Character[], name: string, patch: Partial<Character>): Character[] {
  return list.map((c) => (c.name === name ? { ...c, ...patch, user_touched: true } : c));
}

export function deleteCharacter(list: Character[], name: string): Character[] {
  return list.filter((c) => c.name !== name);
}

export function toggleLock(list: Character[], name: string, locked: boolean): Character[] {
  return list.map((c) => (c.name === name ? { ...c, locked } : c));
}

// --- Persistência local-first ----------------------------------------------

/** Persiste o conjunto de characters (replace) + enfileira sync (BR-MIGRAR-020). */
export async function saveCharacters(storyId: string, characters: Character[], userId: string): Promise<void> {
  if (!storyId) throw new Error('saveCharacters requer storyId (BR-MIGRAR-020).');
  const now = new Date().toISOString();
  await characterRepo.replaceCharactersForStory(
    storyId,
    characters.map((c) => toRow(storyId, c, now)),
  );
  // Contrato da Lambda /works (igual ao saveCharacters legado): event=update-characters,
  // characters como MAPA { [name]: char } (DynamoDB shape), userId presente. O push-worker
  // envia este payload verbatim — os nomes de campo têm de bater com o backend.
  const charactersMap: Record<string, Character> = {};
  for (const c of characters) charactersMap[c.name] = c;
  await enqueueMutation({
    entityType: 'character',
    entityId: storyId,
    operation: 'update',
    payload: { event: 'update-characters', userId, storyId, characters: charactersMap },
  });
}

export interface CharacterMirrorDeps {
  replaceCharactersForStory: (storyId: string, rows: CharacterRow[]) => Promise<void> | void;
  now?: () => string;
}

/**
 * Espelha o conjunto de characters no SQLite local (desktop) SEM enfileirar push —
 * o writer de backend continua sendo o axios legado (Strangler Fig). `source` pode
 * ser array OU map (DDB shape). synced_at = now (converge com o pull, sem conflito).
 * Caller deve checar isDesktop(). Best-effort.
 */
export async function mirrorCharactersToLocal(
  storyId: string,
  source: unknown,
  deps: CharacterMirrorDeps = { replaceCharactersForStory: characterRepo.replaceCharactersForStory },
): Promise<void> {
  if (!storyId) return;
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const rows = toCanonicalCharacterArray(source as any).map((c) => toRow(storyId, c, now));
  await deps.replaceCharactersForStory(storyId, rows);
}
