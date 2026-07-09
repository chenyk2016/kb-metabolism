import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { dbPath } from "./config.js";

/**
 * Everything in the sqlite file is derived — delete it and `kb index`
 * rebuilds it. The one non-reproducible artifact (the access log) lives in
 * .kb/access.log.jsonl, never in here.
 */
export function openDb(root: string): Database.Database {
  const file = dbPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      path     TEXT PRIMARY KEY,
      id       TEXT,
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
    CREATE TABLE IF NOT EXISTS embeddings (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      dim  INTEGER NOT NULL,
      vec  BLOB NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      path UNINDEXED, title, body, tokenize = 'trigram'
    );
    CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst);
  `);
  try {
    // 旧库迁移：反链来源标记（1 = 来自创作目录 outputDirs，铁证级吸收）
    db.exec("ALTER TABLE links ADD COLUMN from_output INTEGER NOT NULL DEFAULT 0");
  } catch {
    // 列已存在
  }
  return db;
}
