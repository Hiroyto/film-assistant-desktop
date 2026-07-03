-- Film Assistant Desktop — SQLite local schema (source-of-truth: AD-01).
-- Referência canônica do schema local. DDL fiel a target_data_model.md.
-- DynamoDB (espelho remoto) NÃO muda — o sync agent traduz entre os dois modelos.
--
-- Pragmas de conexão (setados pelo runner em código, por serem connection-scoped):
--   PRAGMA journal_mode = WAL;     -- reduz lock contention sync<->UI (persistente)
--   PRAGMA foreign_keys = ON;      -- integridade referencial (por conexão)
--
-- Este arquivo cria o schema do zero (v1). Migrations incrementais ficam em
-- migrations/v<n>.sql e rodam no boot via a tabela schema_version (Tarefa 07).

-- ============================================
-- Schema version (infra)
-- ============================================
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL  -- ISO-8601
);

-- ============================================
-- Users (BC-01)
-- ============================================
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,                  -- Cognito sub (UUID)
    email TEXT NOT NULL UNIQUE,
    preferred_username TEXT,
    cap INTEGER NOT NULL DEFAULT 0,            -- token balance
    subscription TEXT,                         -- free-form string; "member" é especial
    privacy INTEGER,                           -- 0|1, fetched mas não wired (DEC-008)
    mfa_configured TEXT NOT NULL DEFAULT 'OFF', -- 'OPTIONAL'|'OFF' (DEC-007 dormente)
    last_signed_in_at TEXT,                    -- ISO-8601
    created_at TEXT NOT NULL,                  -- ISO-8601
    updated_at TEXT NOT NULL,
    synced_at TEXT                             -- last successful sync with /user
);

CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- Subscriptions (BC-06) — extraído de User
-- ============================================
CREATE TABLE subscriptions (
    user_id TEXT PRIMARY KEY,
    tier TEXT,                                  -- mesma string de users.subscription (mantida para query/state isolation)
    cap_mirror INTEGER,                         -- mirror de users.cap, sincronizado
    current_period_end TEXT,                    -- ISO-8601, se houver
    stripe_customer_id TEXT,
    last_checkout_session TEXT,                 -- ID da última sessão Stripe (debug)
    updated_at TEXT NOT NULL,
    synced_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ============================================
-- Stories (BC-02)
-- ============================================
CREATE TABLE stories (
    story_id TEXT PRIMARY KEY,                  -- formato story_<unix-ms>_<rand6>
    user_id TEXT NOT NULL,                      -- owner
    title TEXT NOT NULL,
    brainstorm TEXT,                            -- BRAINSTORM (qualquer save path persiste — fix tech-debt #1)
    genre TEXT,                                 -- G
    theme TEXT,                                 -- T
    mood_setting TEXT,                          -- M
    core_question TEXT,                         -- CQ
    synopsis TEXT,                              -- SUM
    segments_json TEXT NOT NULL DEFAULT '{}',   -- JSON: { "S1": { "S": "...", "scenes": [...] }, ..., "S9": ... }
                                                -- canonical polymorphic shape (BR-MIGRAR-013)
    version INTEGER NOT NULL DEFAULT 1,         -- optimistic lock para conflict detection
    status TEXT NOT NULL DEFAULT 'active',      -- 'active' | 'soft_deleted'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    synced_at TEXT,                             -- last successful push to DDB
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_stories_user_status ON stories(user_id, status);
CREATE INDEX idx_stories_updated ON stories(updated_at DESC);

-- ============================================
-- Screenplays (BC-03) — one-to-one com Story
-- ============================================
CREATE TABLE screenplays (
    story_id TEXT PRIMARY KEY,
    html_content BLOB,                          -- TipTap rendered HTML (BR-MIGRAR-035 substitui localStorage)
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    synced_at TEXT,                             -- last successful push to S3
    FOREIGN KEY (story_id) REFERENCES stories(story_id) ON DELETE CASCADE
);

-- ============================================
-- Characters (BC-05) — escopo por story
-- ============================================
CREATE TABLE characters (
    story_id TEXT NOT NULL,
    name TEXT NOT NULL,                         -- PK part 2 (BR-MIGRAR-018)
    description TEXT,
    importance TEXT NOT NULL DEFAULT 'minor',   -- enum: 'major'|'supporting'|'minor' (BR-MIGRAR-024)
    locked INTEGER NOT NULL DEFAULT 0,          -- boolean (BR-MIGRAR-021)
    is_new INTEGER NOT NULL DEFAULT 0,
    user_touched INTEGER NOT NULL DEFAULT 0,
    arc_starting_state TEXT,
    arc_goal TEXT,
    arc_conflict TEXT,
    arc_need TEXT,
    arc_growth TEXT NOT NULL DEFAULT 'static',  -- 'static'|'dynamic'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    synced_at TEXT,
    PRIMARY KEY (story_id, name),
    FOREIGN KEY (story_id) REFERENCES stories(story_id) ON DELETE CASCADE,
    CHECK (importance IN ('major', 'supporting', 'minor')),
    CHECK (arc_growth IN ('static', 'dynamic'))
);

CREATE INDEX idx_characters_story ON characters(story_id);
CREATE INDEX idx_characters_locked ON characters(story_id, locked);

-- ============================================
-- SyncQueue (BC-08) — mutations pendentes
-- ============================================
CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY,                        -- UUID
    request_id TEXT NOT NULL UNIQUE,            -- UUID para idempotência server-side
    entity_type TEXT NOT NULL,                  -- 'story' | 'screenplay' | 'character' | 'user' | 'subscription' | 'character_refresh'
    entity_id TEXT NOT NULL,                    -- composite key serialized (e.g., "<story_id>:<character_name>")
    operation TEXT NOT NULL,                    -- 'create' | 'update' | 'delete' | 'custom' (e.g., refresh trigger)
    payload TEXT NOT NULL,                      -- JSON com delta a enviar
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,                       -- ISO-8601
    next_attempt_at TEXT,                       -- ISO-8601, calculado por backoff
    status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'in_flight' | 'failed' | 'succeeded' | 'conflict'
    failure_reason TEXT,
    conflict_metadata TEXT,                     -- JSON com versão remota se conflict
    created_at TEXT NOT NULL,
    CHECK (status IN ('pending', 'in_flight', 'failed', 'succeeded', 'conflict')),
    CHECK (operation IN ('create', 'update', 'delete', 'custom'))
);

CREATE INDEX idx_sync_queue_pending ON sync_queue(status, next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX idx_sync_queue_in_flight ON sync_queue(status) WHERE status = 'in_flight';
CREATE INDEX idx_sync_queue_entity ON sync_queue(entity_type, entity_id);

-- ============================================
-- Snapshots (BC-08) — backup pré-sync para conflict resolution
-- ============================================
CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,                        -- UUID
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_state TEXT NOT NULL,                 -- JSON snapshot completo
    snapshot_at TEXT NOT NULL,
    reason TEXT NOT NULL,                       -- 'pre_sync' | 'pre_conflict_resolution'
    related_sync_queue_id TEXT,
    expires_at TEXT,                            -- TTL local (e.g., 30 dias)
    CHECK (reason IN ('pre_sync', 'pre_conflict_resolution')),
    FOREIGN KEY (related_sync_queue_id) REFERENCES sync_queue(id) ON DELETE SET NULL
);

CREATE INDEX idx_snapshots_entity ON snapshots(entity_type, entity_id);
CREATE INDEX idx_snapshots_expires ON snapshots(expires_at);

-- ============================================
-- Settings (BC-10) — key-value para flags locais
-- ============================================
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,                        -- JSON-encoded value
    updated_at TEXT NOT NULL
);

-- Settings esperados:
-- 'hasSeenTutorialHint' (BR-MIGRAR-042) — substitui localStorage
-- 'lastResendCodeAt' (BR-MIGRAR-005) — persiste throttle 60s entre sleeps
-- 'aiModelOverride' (BR-MIGRAR-049) — mirror do AIModelContext
-- 'lastSyncCompletedAt' — telemetria local
-- 'storyChangeSource' (BR-MIGRAR-016) — efêmero, talvez não persistir

-- ============================================
-- Migrations bootstrap row
-- ============================================
INSERT INTO schema_version (version, applied_at) VALUES (1, '2026-05-22T00:09:00Z');
