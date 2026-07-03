// Transformações de dados backend (DynamoDB/S3) -> linhas SQLite locais (T-01..T-08).
//
// Fonte: data_migration_plan.md §Transformações. Funções PURAS e testáveis (sem I/O).
// Consumidas pelo initial-pull (Tarefa 03) e pelo ongoing pull (Tarefa 07).
//
// Estas funções produzem LINHAS (rows.ts, snake_case) — não modelos de domínio
// (Tarefa 04). Booleans saem como 0|1; timestamps como ISO-8601 UTC.

import type {
  UserRow,
  SubscriptionRow,
  StoryRow,
  CharacterRow,
  CharacterImportance,
  CharacterArcGrowth,
  SqliteBool,
} from '../local-db/rows';

// ---------------------------------------------------------------------------
// Tipos de entrada (permissivos — o backend retorna shapes variados/legados)
// ---------------------------------------------------------------------------

/** Payload bruto de GET /user (campos legados, tolerante a ausências). */
export interface RawUser {
  userId?: string;
  sub?: string;
  email?: string;
  preferred_username?: string;
  preferredUsername?: string;
  cap?: number | string;
  subscription?: string | null;
  privacy?: boolean | number | null;
  current_period_end?: string | number | null;
  stripe_customer_id?: string | null;
  stripeCustomerId?: string | null;
  created_at?: string | number;
  createdAt?: string | number;
  updated_at?: string | number;
  updatedAt?: string | number;
  last_signed_in_at?: string | number;
  // contest_submitted é IGNORADO de propósito (T-05 / BR-DESCARTAR-001).
  [k: string]: unknown;
}

/** Payload bruto de um item de GET /works. */
export interface RawStory {
  storyId?: string;
  story_id?: string;
  id?: string;
  title?: string;
  brainstorm?: string | null;
  BRAINSTORM?: string | null;
  genre?: string | null;
  G?: string | null;
  theme?: string | null;
  T?: string | null;
  mood_setting?: string | null;
  M?: string | null;
  core_question?: string | null;
  CQ?: string | null;
  synopsis?: string | null;
  SUM?: string | null;
  version?: number;
  status?: string;
  characters?: RawCharacter[] | Record<string, RawCharacter> | null;
  created_at?: string | number;
  createdAt?: string | number;
  updated_at?: string | number;
  updatedAt?: string | number;
  // S1..S9 ficam como chaves dinâmicas — ver normalizeSegmentsJson.
  [k: string]: unknown;
}

export interface RawCharacter {
  name?: string;
  description?: string | null;
  importance?: string | null;
  locked?: boolean | number | null;
  is_new?: boolean | number | null;
  isNew?: boolean | number | null;
  user_touched?: boolean | number | null;
  userTouched?: boolean | number | null;
  arc?: {
    starting_state?: string | null;
    startingState?: string | null;
    goal?: string | null;
    conflict?: string | null;
    need?: string | null;
    growth?: string | null;
  } | null;
  [k: string]: unknown;
}

/** Cena canônica como persistida dentro de segments_json. */
export interface CanonicalScene {
  sceneId: string;
  title: string;
  content: string;
  shortDescription?: string;
  fullDescription?: string;
  metadata?: Record<string, unknown>;
}

/** Segmento canônico { S: outline, scenes: [...] }. */
export interface CanonicalSegment {
  S: string;
  scenes: CanonicalScene[];
}

export type CanonicalSegments = Record<string, CanonicalSegment>;

const SEGMENT_KEYS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'] as const;

// ---------------------------------------------------------------------------
// T-08 — Timestamps em ISO-8601 UTC
// ---------------------------------------------------------------------------

/**
 * Normaliza qualquer timestamp (Unix ms num/str, ISO string, Date) para ISO-8601 UTC.
 * Se ausente ou irrecuperável, usa o `now` fornecido (default = agora).
 */
export function normalizeTimestamp(
  raw: string | number | Date | null | undefined,
  now: string = new Date().toISOString(),
): string {
  if (raw == null || raw === '') return now;
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? now : raw.toISOString();
  }
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? now : d.toISOString();
  }
  // string: pode ser ISO ou Unix ms numérico em texto
  const asNum = Number(raw);
  if (raw.trim() !== '' && !Number.isNaN(asNum) && /^\d+$/.test(raw.trim())) {
    const d = new Date(asNum);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? now : d.toISOString();
}

// ---------------------------------------------------------------------------
// Helpers de coerção
// ---------------------------------------------------------------------------

function toSqliteBool(v: boolean | number | string | null | undefined): SqliteBool {
  return v === true || v === 1 || v === '1' ? 1 : 0;
}

function genId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `${prefix}_${uuid}`;
}

function pick<T>(...vals: (T | null | undefined)[]): T | undefined {
  for (const v of vals) if (v != null) return v;
  return undefined;
}

// ---------------------------------------------------------------------------
// T-03 — Normalizar scenes para canonical Scene shape
// ---------------------------------------------------------------------------

/**
 * Normaliza uma scene bruta. **Mantém o ID original** (não reescreve — evita quebrar
 * refs). Gera UUID só quando o sceneId está ausente. title vazio é válido.
 */
export function normalizeScene(raw: unknown): CanonicalScene {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sceneId =
    (typeof r.sceneId === 'string' && r.sceneId) ||
    (typeof r.id === 'string' && r.id) ||
    genId('scene');
  return {
    sceneId,
    title: typeof r.title === 'string' ? r.title : '',
    content: typeof r.content === 'string' ? r.content : '',
    ...(typeof r.shortDescription === 'string' ? { shortDescription: r.shortDescription } : {}),
    ...(typeof r.fullDescription === 'string' ? { fullDescription: r.fullDescription } : {}),
    ...(r.metadata && typeof r.metadata === 'object'
      ? { metadata: r.metadata as Record<string, unknown> }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// T-01 — Normalizar polimorfismo S1..S9 para JSON canônico
// ---------------------------------------------------------------------------

/** Converte um único valor Sn (string | {S,scenes} | null) para CanonicalSegment. */
export function normalizeSegmentValue(value: unknown): CanonicalSegment {
  if (typeof value === 'string') {
    return { S: value, scenes: [] };
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const outline = typeof o.S === 'string' ? o.S : '';
    const scenesRaw = Array.isArray(o.scenes) ? o.scenes : [];
    return { S: outline, scenes: scenesRaw.map(normalizeScene) };
  }
  // null / ausente / shape inesperado -> default (não descarta o resto da story)
  return { S: '', scenes: [] };
}

/**
 * Compõe `stories.segments_json` a partir de um objeto bruto contendo S1..S9.
 * Sempre retorna as 9 chaves. Aceita objeto raiz (RawStory) ou sub-objeto `segments`.
 */
export function normalizeSegmentsJson(rawStory: Record<string, unknown>): string {
  const source =
    rawStory.segments && typeof rawStory.segments === 'object'
      ? (rawStory.segments as Record<string, unknown>)
      : rawStory;
  const segments: CanonicalSegments = {};
  for (const key of SEGMENT_KEYS) {
    segments[key] = normalizeSegmentValue(source[key]);
  }
  return JSON.stringify(segments);
}

// ---------------------------------------------------------------------------
// T-02 — Normalizar characters para array canônico -> rows
// ---------------------------------------------------------------------------

const VALID_IMPORTANCE: CharacterImportance[] = ['major', 'supporting', 'minor'];
const VALID_GROWTH: CharacterArcGrowth[] = ['static', 'dynamic'];

export interface CharacterTransformResult {
  rows: CharacterRow[];
  dropped: number; // characters sem name descartados (com warning)
}

/**
 * Normaliza characters (array OU map) para rows canônicas. Descarta os sem `name`.
 * Defaults: importance='minor', arc_growth='static'.
 */
export function normalizeCharacters(
  raw: RawCharacter[] | Record<string, RawCharacter> | null | undefined,
  storyId: string,
  now: string,
  warn: (msg: string) => void = () => {},
): CharacterTransformResult {
  const list: RawCharacter[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.values(raw)
      : [];

  const rows: CharacterRow[] = [];
  let dropped = 0;

  for (const c of list) {
    const name = typeof c?.name === 'string' ? c.name.trim() : '';
    if (!name) {
      dropped++;
      warn(`[transforms] character sem name descartado (story ${storyId})`);
      continue;
    }
    const importanceRaw = (c.importance ?? 'minor') as string;
    const importance: CharacterImportance = VALID_IMPORTANCE.includes(
      importanceRaw as CharacterImportance,
    )
      ? (importanceRaw as CharacterImportance)
      : 'minor';

    const growthRaw = (c.arc?.growth ?? 'static') as string;
    const arc_growth: CharacterArcGrowth = VALID_GROWTH.includes(growthRaw as CharacterArcGrowth)
      ? (growthRaw as CharacterArcGrowth)
      : 'static';

    rows.push({
      story_id: storyId,
      name,
      description: c.description ?? null,
      importance,
      locked: toSqliteBool(c.locked),
      is_new: toSqliteBool(pick(c.is_new, c.isNew)),
      user_touched: toSqliteBool(pick(c.user_touched, c.userTouched)),
      arc_starting_state: pick(c.arc?.starting_state, c.arc?.startingState) ?? null,
      arc_goal: c.arc?.goal ?? null,
      arc_conflict: c.arc?.conflict ?? null,
      arc_need: c.arc?.need ?? null,
      arc_growth,
      created_at: now,
      updated_at: now,
      synced_at: now,
    });
  }

  return { rows, dropped };
}

// ---------------------------------------------------------------------------
// T-04 — Hidratar mfa_configured de Cognito attributes (DEC-007 dormente)
// ---------------------------------------------------------------------------

/**
 * Deriva users.mfa_configured. `hasTotpEnrolled` vem de fetchAuthSession.
 * Default 'OFF' se config ausente.
 */
export function deriveMfaConfigured(
  mfaConfiguration: string | null | undefined,
  hasTotpEnrolled: boolean,
): 'OPTIONAL' | 'OFF' {
  if (!mfaConfiguration) return 'OFF';
  if (mfaConfiguration === 'OPTIONAL' && hasTotpEnrolled) return 'OPTIONAL';
  return 'OFF';
}

// ---------------------------------------------------------------------------
// Mapeadores de linha (compõem as transformações acima)
// ---------------------------------------------------------------------------

/** RawUser -> UserRow. Aplica T-04, T-05 (drop contest_submitted), T-08. */
export function mapUserToRow(
  raw: RawUser,
  opts: { userId: string; mfaConfigured: 'OPTIONAL' | 'OFF'; now: string },
): UserRow {
  const { userId, mfaConfigured, now } = opts;
  return {
    user_id: userId,
    email: typeof raw.email === 'string' ? raw.email : '',
    preferred_username: pick(raw.preferred_username, raw.preferredUsername) ?? null,
    cap: Number(raw.cap ?? 0) || 0,
    subscription: raw.subscription ?? null,
    privacy: raw.privacy == null ? null : toSqliteBool(raw.privacy as number | boolean),
    mfa_configured: mfaConfigured,
    last_signed_in_at: raw.last_signed_in_at ? normalizeTimestamp(raw.last_signed_in_at, now) : now,
    created_at: normalizeTimestamp(pick(raw.created_at, raw.createdAt), now),
    updated_at: normalizeTimestamp(pick(raw.updated_at, raw.updatedAt), now),
    synced_at: now,
  };
}

/** RawUser -> SubscriptionRow (extrai subscription/cap para tabela própria). */
export function mapUserToSubscriptionRow(
  raw: RawUser,
  opts: { userId: string; now: string },
): SubscriptionRow {
  const { userId, now } = opts;
  return {
    user_id: userId,
    tier: raw.subscription ?? null,
    cap_mirror: Number(raw.cap ?? 0) || 0,
    current_period_end: raw.current_period_end
      ? normalizeTimestamp(raw.current_period_end, now)
      : null,
    stripe_customer_id: pick(raw.stripe_customer_id, raw.stripeCustomerId) ?? null,
    last_checkout_session: null,
    updated_at: now,
    synced_at: now,
  };
}

/** RawStory -> StoryRow. Aplica T-01 (segments), T-08 (timestamps). */
export function mapStoryToRow(
  raw: RawStory,
  opts: { userId: string; now: string },
): StoryRow {
  const { userId, now } = opts;
  const storyId = pick(raw.storyId, raw.story_id, raw.id);
  if (!storyId) {
    throw new Error('[transforms] story sem storyId — não é possível mapear');
  }
  const status = raw.status === 'soft_deleted' ? 'soft_deleted' : 'active';
  return {
    story_id: storyId,
    user_id: userId,
    title: typeof raw.title === 'string' && raw.title ? raw.title : 'Untitled',
    brainstorm: pick(raw.brainstorm, raw.BRAINSTORM) ?? null,
    genre: pick(raw.genre, raw.G) ?? null,
    theme: pick(raw.theme, raw.T) ?? null,
    mood_setting: pick(raw.mood_setting, raw.M) ?? null,
    core_question: pick(raw.core_question, raw.CQ) ?? null,
    synopsis: pick(raw.synopsis, raw.SUM) ?? null,
    segments_json: normalizeSegmentsJson(raw as Record<string, unknown>),
    version: typeof raw.version === 'number' ? raw.version : 1,
    status,
    created_at: normalizeTimestamp(pick(raw.created_at, raw.createdAt), now),
    updated_at: normalizeTimestamp(pick(raw.updated_at, raw.updatedAt), now),
    synced_at: now,
  };
}
