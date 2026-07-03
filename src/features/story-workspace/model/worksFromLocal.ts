// B2 (Ativação local-first) — monta o mapa `works` (shape legado do backend) a
// partir do SQLite local, para a Home/grade ler local-first no desktop.
//
// Espelha o que o `POST /user` devolvia em `body.works`:
//   { [storyId]: { ...wire (title, M/T/G/CQ/SUM/BRAINSTORM, S1..S9 {S,scenes}),
//                  characters: { [name]: Character },  // mapa (loadCharactersFromStoryData)
//                  lastModified, createdAt } }
//
// Fonte = SQLite (já populado pelo initial-pull + scheduler). Desktop-only — o
// caller deve checar isDesktop(). Repos injetáveis p/ teste sem Electron/DB.
import { storyRepo, characterRepo } from '../../../data/local-db/repositories';
import { rowToCanonical, canonicalToWire } from './storySerialization';
import { toCanonicalCharacterArray, Character } from '../../../models/character';
import type { StoryRow, CharacterRow } from '../../../data/local-db/rows';

export interface WorksRepos {
  listActiveStories: (userId: string) => Promise<StoryRow[]>;
  listByStory: (storyId: string) => Promise<CharacterRow[]>;
}

const DEFAULT_REPOS: WorksRepos = {
  listActiveStories: storyRepo.listActiveStories,
  listByStory: characterRepo.listByStory,
};

/** CharacterRow -> objeto character-like (espelho do toRow de characterCommands). */
function rowToCharacterLike(r: CharacterRow): Record<string, unknown> {
  return {
    name: r.name,
    description: r.description ?? '',
    importance: r.importance,
    locked: !!r.locked,
    is_new: !!r.is_new,
    user_touched: !!r.user_touched,
    arc: {
      starting_state: r.arc_starting_state ?? '',
      goal: r.arc_goal ?? '',
      conflict: r.arc_conflict ?? '',
      need: r.arc_need ?? '',
      growth: r.arc_growth,
    },
  };
}

/** Array canônico de characters -> mapa { name: char } (shape que a Home consome). */
function charactersToMap(chars: Character[]): Record<string, Character> {
  const map: Record<string, Character> = {};
  for (const c of chars) if (c?.name) map[c.name] = c;
  return map;
}

/**
 * StoryRow + CharacterRow[] -> valor `works` no shape legado (CacheData-like).
 * Pura: usada tanto pela grade (worksFromLocal) quanto pela carga de uma única
 * story (loadCache local-first / B1). NÃO inclui screenplayContent — o editor de
 * screenplay carrega isso à parte (B3).
 */
export function buildStoryValue(row: StoryRow, charRows: CharacterRow[]): Record<string, any> {
  const characters = toCanonicalCharacterArray(charRows.map(rowToCharacterLike) as any);
  const canonical = rowToCanonical(row, characters);
  return {
    ...canonicalToWire(canonical),
    characters: charactersToMap(characters),
    lastModified: row.updated_at,
    createdAt: row.created_at,
  };
}

/**
 * Monta o `works` (mapa storyId -> storyData) do SQLite local. Retorna {} se não
 * houver stories ativas (o caller faz fallback p/ o backend nesse caso).
 */
export async function worksFromLocal(
  userId: string,
  repos: WorksRepos = DEFAULT_REPOS,
): Promise<Record<string, any>> {
  const rows = await repos.listActiveStories(userId);
  const works: Record<string, any> = {};
  for (const row of rows) {
    const charRows = await repos.listByStory(row.story_id);
    works[row.story_id] = buildStoryValue(row, charRows);
  }
  return works;
}
