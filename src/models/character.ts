// Canonical Character (resolve drift map vs array — BR-MIGRAR-025).
//
// Fonte: target_domain_model.md (AGG-CharacterDB, Entidade Character, VOs).
// Shape canônico = ARRAY (a hidratação de qualquer source — DDB map, WS array —
// é normalizada antes de entrar no aggregate). `name` é a PK (BR-MIGRAR-018).

export type Importance = 'major' | 'supporting' | 'minor';
export type Growth = 'static' | 'dynamic';

export const DEFAULT_IMPORTANCE: Importance = 'minor';
export const DEFAULT_GROWTH: Growth = 'static';

export interface CharacterArc {
  starting_state?: string;
  goal?: string;
  conflict?: string;
  need?: string;
  growth: Growth;
}

export interface Character {
  /** PK (BR-MIGRAR-018) — rename = delete + create. */
  name: string;
  description?: string;
  importance: Importance;
  /** locked === true => imune a WS merges (BR-MIGRAR-021). */
  locked: boolean;
  is_new: boolean;
  user_touched: boolean;
  arc: CharacterArc;
}

// --- Value Object: CharacterName --------------------------------------------

export const CHARACTER_NAME_MAX = 100;

export function isValidCharacterName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= CHARACTER_NAME_MAX;
}

const VALID_IMPORTANCE: Importance[] = ['major', 'supporting', 'minor'];
const VALID_GROWTH: Growth[] = ['static', 'dynamic'];

export function normalizeImportance(v: unknown): Importance {
  return VALID_IMPORTANCE.includes(v as Importance) ? (v as Importance) : DEFAULT_IMPORTANCE;
}

export function normalizeGrowth(v: unknown): Growth {
  return VALID_GROWTH.includes(v as Growth) ? (v as Growth) : DEFAULT_GROWTH;
}

/**
 * Normaliza um character bruto para o shape canônico, aplicando defaults
 * (importance='minor', growth='static' — BR-MIGRAR-024). Retorna null se o
 * `name` for inválido (sem name não há identidade — descartar com warning).
 */
export function toCanonicalCharacter(raw: Record<string, unknown>): Character | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!isValidCharacterName(name)) return null;
  const arcRaw = (raw.arc && typeof raw.arc === 'object' ? raw.arc : {}) as Record<string, unknown>;
  return {
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    importance: normalizeImportance(raw.importance),
    locked: raw.locked === true || raw.locked === 1,
    is_new: raw.is_new === true || raw.is_new === 1 || raw.isNew === true,
    user_touched: raw.user_touched === true || raw.user_touched === 1 || raw.userTouched === true,
    arc: {
      starting_state:
        typeof arcRaw.starting_state === 'string'
          ? arcRaw.starting_state
          : typeof arcRaw.startingState === 'string'
            ? (arcRaw.startingState as string)
            : undefined,
      goal: typeof arcRaw.goal === 'string' ? arcRaw.goal : undefined,
      conflict: typeof arcRaw.conflict === 'string' ? arcRaw.conflict : undefined,
      need: typeof arcRaw.need === 'string' ? arcRaw.need : undefined,
      growth: normalizeGrowth(arcRaw.growth),
    },
  };
}

/**
 * Normaliza qualquer source (array OU map) para array canônico (BR-MIGRAR-025),
 * descartando entradas sem name.
 */
export function toCanonicalCharacterArray(
  source: unknown[] | Record<string, unknown> | null | undefined,
): Character[] {
  const list: unknown[] = Array.isArray(source)
    ? source
    : source && typeof source === 'object'
      ? Object.values(source)
      : [];
  const out: Character[] = [];
  for (const c of list) {
    const canon = toCanonicalCharacter((c ?? {}) as Record<string, unknown>);
    if (canon) out.push(canon);
  }
  return out;
}

/**
 * Merge de characters preservando locks (BR-MIGRAR-021).
 * Characters com `locked === true` na base local são imunes ao batch incoming
 * (WS/AI), mesmo que o batch os omita ou tente sobrescrever.
 */
export function mergeCharactersWithLocks(current: Character[], incoming: Character[]): Character[] {
  const lockedByName = new Map<string, Character>();
  for (const c of current) {
    if (c.locked) lockedByName.set(c.name, c);
  }
  const result: Character[] = [];
  const seen = new Set<string>();

  // incoming aplica, exceto onde há lock local (mantém o local)
  for (const inc of incoming) {
    if (lockedByName.has(inc.name)) {
      result.push(lockedByName.get(inc.name)!);
    } else {
      result.push(inc);
    }
    seen.add(inc.name);
  }
  // locked locais que o batch omitiu sobrevivem
  for (const [name, locked] of lockedByName) {
    if (!seen.has(name)) result.push(locked);
  }
  return result;
}
