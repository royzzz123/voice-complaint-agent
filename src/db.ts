import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

// node:sqlite is synchronous and in-process: fine for a single gateway instance.
// For multiple instances, move these tables to Postgres/Redis; the queries are plain SQL.

export type Db = DatabaseSync;

export function openDb(path = config.dbPath): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;

    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_call_id TEXT,
      phone TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      admitted INTEGER NOT NULL,
      reject_reason TEXT,
      status TEXT NOT NULL,           -- active | completed | rejected | ended_by_guardrail | abandoned
      flagged INTEGER NOT NULL DEFAULT 0,
      flag_reason TEXT,
      turns INTEGER NOT NULL DEFAULT 0,
      complaint_id TEXT,
      state TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS calls_phone_time ON calls(phone, started_at);
    CREATE UNIQUE INDEX IF NOT EXISTS calls_provider_id ON calls(provider, provider_call_id);

    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,       -- system | admin
      lifted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS blocks_phone ON blocks(phone, expires_at);

    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      entity TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      mirror_status TEXT NOT NULL DEFAULT 'pending',
      mirror_detail TEXT
    );
    CREATE INDEX IF NOT EXISTS complaints_phone_time ON complaints(phone, created_at);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT,
      phone TEXT,
      type TEXT NOT NULL,
      detail TEXT,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_call ON events(call_id);
  `);
  return db;
}

export function logEvent(db: Db, e: { callId?: string | null; phone?: string | null; type: string; detail?: unknown }) {
  db.prepare("INSERT INTO events (call_id, phone, type, detail, at) VALUES (?, ?, ?, ?, ?)").run(
    e.callId ?? null,
    e.phone ?? null,
    e.type,
    e.detail === undefined ? null : JSON.stringify(e.detail),
    Date.now(),
  );
}
