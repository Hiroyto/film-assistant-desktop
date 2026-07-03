-- Migration v1 — schema inicial (BC-01/02/03/05/06/08/10).
-- Idempotente (IF NOT EXISTS): seguro re-executar. Fiel a target_data_model.md.
-- O runner (Tarefa 07) envolve em transação e grava (1, <now>) em schema_version
-- ao concluir. PRAGMA journal_mode=WAL e foreign_keys=ON são setados pelo runner
-- na abertura da conexão (connection-scoped), não aqui.

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    preferred_username TEXT,
    cap INTEGER NOT NULL DEFAULT 0,
    subscription TEXT,
    privacy INTEGER,
    mfa_configured TEXT NOT NULL DEFAULT 'OFF',
    last_signed_in_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY,
    tier TEXT,
    cap_mirror INTEGER,
    current_period_end TEXT,
    stripe_customer_id TEXT,
    last_checkout_session TEXT,
    updated_at TEXT NOT NULL,
    synced_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stories (
    story_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    brainstorm TEXT,
    genre TEXT,
    theme TEXT,
    mood_setting TEXT,
    core_question TEXT,
    synopsis TEXT,
    segments_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    synced_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stories_user_status ON stories(user_id, status);
CREATE INDEX IF NOT EXISTS idx_stories_updated ON stories(updated_at DESC);

CREATE TABLE IF NOT EXISTS screenplays (
    story_id TEXT PRIMARY KEY,
    html_content BLOB,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    synced_at TEXT,
    FOREIGN KEY (story_id) REFERENCES stories(story_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS characters (
    story_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    importance TEXT NOT NULL DEFAULT 'minor',
    locked INTEGER NOT NULL DEFAULT 0,
    is_new INTEGER NOT NULL DEFAULT 0,
    user_touched INTEGER NOT NULL DEFAULT 0,
    arc_starting_state TEXT,
    arc_goal TEXT,
    arc_conflict TEXT,
    arc_need TEXT,
    arc_growth TEXT NOT NULL DEFAULT 'static',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    synced_at TEXT,
    PRIMARY KEY (story_id, name),
    FOREIGN KEY (story_id) REFERENCES stories(story_id) ON DELETE CASCADE,
    CHECK (importance IN ('major', 'supporting', 'minor')),
    CHECK (arc_growth IN ('static', 'dynamic'))
);

CREATE INDEX IF NOT EXISTS idx_characters_story ON characters(story_id);
CREATE INDEX IF NOT EXISTS idx_characters_locked ON characters(story_id, locked);

CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    next_attempt_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    failure_reason TEXT,
    conflict_metadata TEXT,
    created_at TEXT NOT NULL,
    CHECK (status IN ('pending', 'in_flight', 'failed', 'succeeded', 'conflict')),
    CHECK (operation IN ('create', 'update', 'delete', 'custom'))
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue(status, next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_sync_queue_in_flight ON sync_queue(status) WHERE status = 'in_flight';
CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_state TEXT NOT NULL,
    snapshot_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    related_sync_queue_id TEXT,
    expires_at TEXT,
    CHECK (reason IN ('pre_sync', 'pre_conflict_resolution')),
    FOREIGN KEY (related_sync_queue_id) REFERENCES sync_queue(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_entity ON snapshots(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_expires ON snapshots(expires_at);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
