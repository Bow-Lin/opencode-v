// src/util/db/db.ts
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema'; // 你的表定义（sqliteTable...）

// Function to create/open database connection
export function createDbConnection() {
  // 创建/打开数据库文件；没有就创建
  const sqlite = new Database('project-index.db', { create: true });

  // 推荐的 PRAGMA（按需调整）
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  // 创建表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      name TEXT NOT NULL,
      symbol_fqn TEXT PRIMARY KEY,
      module_fqn TEXT NOT NULL,
      type TEXT NOT NULL,
      visibility TEXT NOT NULL,
      is_async INTEGER,
      docstring TEXT,
      docstring_summary TEXT,
      location_path TEXT NOT NULL,
      location_line_start INTEGER NOT NULL,
      location_line_end INTEGER NOT NULL,
      signature_parameters TEXT,
      signature_returnType TEXT,
      signature_decorators TEXT
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      UNIQUE(source, target, type)
    )
  `);

  // 创建索引
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_module_fqn ON symbols(module_fqn)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_visibility ON symbols(visibility)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type)`);

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export type DB = ReturnType<typeof createDbConnection>['db'];