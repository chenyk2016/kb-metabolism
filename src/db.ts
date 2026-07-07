import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH } from "./config.js";

export type NoteRow = {
  path: string;
  title: string;
  tier: string | null;
  use_when: string | null;
  triaged: string | null;
  expires: string | null;
  created: string;
  modified: string;
  hash: string;
};

export function openDb(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      path     TEXT PRIMARY KEY,
      title    TEXT NOT NULL,
      tier     TEXT,
      use_when TEXT,
      triaged  TEXT,
      expires  TEXT,
      created  TEXT,
      modified TEXT,
      hash     TEXT
    );
    CREATE TABLE IF NOT EXISTS links (
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      PRIMARY KEY (src, dst)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      path UNINDEXED, title, body, tokenize = 'trigram'
    );
    -- 访问日志是不可再生的代谢信号，重建索引时永不清空
    CREATE TABLE IF NOT EXISTS access_log (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      ts    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      tool  TEXT NOT NULL,
      query TEXT,
      path  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_access_path ON access_log(path, tool);
    CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst);
  `);
  return db;
}

export function logAccess(
  db: Database.Database,
  tool: string,
  opts: { query?: string; path?: string }
): void {
  db.prepare("INSERT INTO access_log (tool, query, path) VALUES (?, ?, ?)").run(
    tool,
    opts.query ?? null,
    opts.path ?? null
  );
}
