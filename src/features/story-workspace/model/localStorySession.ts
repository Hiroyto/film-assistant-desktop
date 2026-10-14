// Sessão local da story ativa (desktop): o que fica no localStorage entre
// logins, e o que o SQLite — um só para todas as contas do mesmo PC — pode
// entregar a quem não é dono.
//
// Brecha fechada aqui (out/2026): no boot, antes do login, App.tsx carrega a
// story de `active_story_id` do SQLite pelo id, sem conferir `user_id`. Como o
// signout não apagava nem o id nem os caches `story_<id>`, a conta seguinte
// abria o editor de outline com a última story da conta anterior — e um save a
// empurraria para a nuvem do novo usuário. Duas defesas, testáveis sem React:
//   1. clearLocalStorySession(): no signout, esquece o id ativo e os caches.
//   2. reconcileActiveStoryOwner(): quando o usuário autenticado é conhecido,
//      uma story ativa cuja linha pertence a OUTRO user_id é descartada.

export const ACTIVE_STORY_KEY = 'active_story_id';
/** Prefixo dos caches de conteúdo gravados pelo debouncedSave (App.tsx / Scripts.tsx). */
export const STORY_CACHE_PREFIX = 'story_';

/** O subconjunto de `Storage` que usamos — injetável nos testes. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // acesso negado (sandbox, modo privado)
  }
}

/** Chaves `story_*` presentes — snapshot, porque remover enquanto itera muda os índices. */
function storyCacheKeys(storage: StorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(STORY_CACHE_PREFIX)) keys.push(k);
  }
  return keys;
}

/**
 * Esquece a story ativa e os caches de conteúdo. Chamado no signout. Deixa o
 * resto (tema, tag de workflow por device, tour): nada disso é conteúdo de
 * story. Devolve quantas chaves saíram; nunca lança.
 */
export function clearLocalStorySession(storage: StorageLike | null = defaultStorage()): number {
  if (!storage) return 0;
  let removed = 0;
  try {
    for (const k of [ACTIVE_STORY_KEY, ...storyCacheKeys(storage)]) {
      if (storage.getItem(k) === null) continue;
      storage.removeItem(k);
      removed++;
    }
  } catch {
    /* storage indisponível: nada a limpar */
  }
  return removed;
}

export interface OwnedStoryRow {
  story_id: string;
  user_id: string | null | undefined;
}

/** A linha é de OUTRO usuário? Sem linha, ou sem dono gravado, não dá para afirmar. */
export function isForeignStoryRow(row: OwnedStoryRow | null | undefined, userId: string): boolean {
  if (!row) return false;
  const owner = typeof row.user_id === 'string' ? row.user_id.trim() : '';
  return owner !== '' && owner !== userId;
}

/**
 * Decide o que fazer com a story ativa quando o usuário autenticado é conhecido.
 * 'reset' = a linha é de outro usuário: o id ativo (se apontar para ela) e o
 * cache DELA saem do storage, e o chamador volta ao estado inicial.
 * 'keep' = é dele, ou não há linha (story nova, ainda não salva).
 */
export function reconcileActiveStoryOwner(
  row: OwnedStoryRow | null | undefined,
  userId: string,
  storage: StorageLike | null = defaultStorage(),
): 'keep' | 'reset' {
  if (!row || !isForeignStoryRow(row, userId)) return 'keep';
  if (storage) {
    try {
      if (storage.getItem(ACTIVE_STORY_KEY) === row.story_id) storage.removeItem(ACTIVE_STORY_KEY);
      storage.removeItem(STORY_CACHE_PREFIX + row.story_id);
    } catch {
      /* storage indisponível: o reset em memória já basta */
    }
  }
  return 'reset';
}
