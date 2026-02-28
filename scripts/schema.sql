-- Moss D1 Schema Migration
-- Database: moss-db
-- Run: pnpm schema (local) or pnpm schema:remote (production)

-- Core memory: extracted facts
CREATE TABLE IF NOT EXISTS moss_facts (
  id            TEXT PRIMARY KEY,
  content       TEXT NOT NULL,
  confidence    TEXT NOT NULL CHECK (confidence IN ('confirmed', 'inferred')),
  embedding_id  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  source        TEXT
);

CREATE INDEX IF NOT EXISTS idx_facts_deleted ON moss_facts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_facts_updated ON moss_facts(updated_at);
CREATE INDEX IF NOT EXISTS idx_facts_confidence ON moss_facts(confidence);

-- Episodic memory: per-conversation summaries
CREATE TABLE IF NOT EXISTS moss_episodes (
  id            TEXT PRIMARY KEY,
  summary       TEXT NOT NULL,
  mood_signal   TEXT,
  embedding_id  TEXT,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_episodes_created ON moss_episodes(created_at);
CREATE INDEX IF NOT EXISTS idx_episodes_deleted ON moss_episodes(deleted_at);

-- Task management
CREATE TABLE IF NOT EXISTS moss_tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT,
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'snoozed', 'done', 'cancelled')),
  priority      TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_at        INTEGER,
  remind_at     INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  tags          TEXT,
  source        TEXT DEFAULT 'telegram'
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON moss_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_remind ON moss_tasks(remind_at);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON moss_tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON moss_tasks(priority);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_tasks_status_remind ON moss_tasks(status, remind_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON moss_tasks(status, priority);
CREATE INDEX IF NOT EXISTS idx_facts_active ON moss_facts(deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_episodes_active ON moss_episodes(deleted_at, created_at);

-- Conversation log (input for memory extraction)
CREATE TABLE IF NOT EXISTS moss_conversations (
  id            TEXT PRIMARY KEY,
  messages      TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  processed     INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conversations_processed ON moss_conversations(processed);

-- Error log (internal debugging, never exposed to Telegram)
CREATE TABLE IF NOT EXISTS moss_errors (
  id            TEXT PRIMARY KEY,
  error         TEXT NOT NULL,
  context       TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_errors_created ON moss_errors(created_at);
