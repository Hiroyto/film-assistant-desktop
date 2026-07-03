// Tipos de LINHA do SQLite local (persistence-shaped, snake_case) — stack better-sqlite3.
//
// Estes NÃO são os modelos de domínio canônicos (Story/Character/Scene/User camelCase),
// que são definidos na Tarefa 04 (src/models/*). Aqui ficam apenas os formatos exatos
// das linhas das tabelas, consumidos pelos repositories (Tarefa 07) para mapear
// linha <-> entidade. Booleans são INTEGER 0|1; timestamps são ISO-8601 em TEXT.
//
// Fonte: target_data_model.md (schema.sql / migrations/v1.sql).

/** 0 = false, 1 = true (SQLite não tem BOOLEAN nativo). */
export type SqliteBool = 0 | 1;

export interface SchemaVersionRow {
  version: number;
  applied_at: string;
}

export interface UserRow {
  user_id: string;            // Cognito sub
  email: string;
  preferred_username: string | null;
  cap: number;                // token balance
  subscription: string | null;
  privacy: SqliteBool | null; // fetched mas não wired (DEC-008)
  mfa_configured: 'OPTIONAL' | 'OFF'; // dormente (DEC-007)
  last_signed_in_at: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface SubscriptionRow {
  user_id: string;
  tier: string | null;
  cap_mirror: number | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  last_checkout_session: string | null;
  updated_at: string;
  synced_at: string | null;
}

export interface StoryRow {
  story_id: string;           // story_<unix-ms>_<rand6>
  user_id: string;
  title: string;
  brainstorm: string | null;
  genre: string | null;
  theme: string | null;
  mood_setting: string | null;
  core_question: string | null;
  synopsis: string | null;
  segments_json: string;      // JSON { "S1": { "S": "...", "scenes": [...] }, ... }
  version: number;            // optimistic lock
  status: 'active' | 'soft_deleted';
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface ScreenplayRow {
  story_id: string;
  html_content: Uint8Array | null; // BLOB (TipTap HTML em UTF-8)
  version: number;
  updated_at: string;
  synced_at: string | null;
}

export type CharacterImportance = 'major' | 'supporting' | 'minor';
export type CharacterArcGrowth = 'static' | 'dynamic';

export interface CharacterRow {
  story_id: string;
  name: string;               // PK part 2
  description: string | null;
  importance: CharacterImportance;
  locked: SqliteBool;
  is_new: SqliteBool;
  user_touched: SqliteBool;
  arc_starting_state: string | null;
  arc_goal: string | null;
  arc_conflict: string | null;
  arc_need: string | null;
  arc_growth: CharacterArcGrowth;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export type SyncEntityType =
  | 'story'
  | 'screenplay'
  | 'character'
  | 'user'
  | 'subscription'
  | 'character_refresh';

export type SyncOperation = 'create' | 'update' | 'delete' | 'custom';

export type SyncStatus = 'pending' | 'in_flight' | 'failed' | 'succeeded' | 'conflict';

export interface SyncQueueRow {
  id: string;                 // UUID
  request_id: string;         // UUID — idempotência server-side
  entity_type: SyncEntityType;
  entity_id: string;          // composite key serializada ("<story_id>:<name>")
  operation: SyncOperation;
  payload: string;            // JSON do delta
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  status: SyncStatus;
  failure_reason: string | null;
  conflict_metadata: string | null; // JSON com versão remota
  created_at: string;
}

export type SnapshotReason = 'pre_sync' | 'pre_conflict_resolution';

export interface SnapshotRow {
  id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  before_state: string;       // JSON snapshot completo
  snapshot_at: string;
  reason: SnapshotReason;
  related_sync_queue_id: string | null;
  expires_at: string | null;  // TTL local (~30 dias)
}

export interface SettingRow {
  key: string;
  value: string;              // JSON-encoded
  updated_at: string;
}

/** Versão atual do schema (deve bater com o maior migrations/v<n>.sql). */
export const CURRENT_SCHEMA_VERSION = 1 as const;
