import knex from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DB_TYPE = process.env.DB_TYPE || 'sqlite';

const ARRAY_COLS = ['tags', 'vibe', 'tech_stack', 'links', 'related_ideas'];
const JSON_COLS  = ['conversation', 'riff_conversation', 'settings', 'messages', 'project_plan'];
const BOOL_COLS  = ['archived', 'ai_generated', 'git_committed', 'completed', 'sharing_enabled', 'is_author_reply'];
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function parseRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (v === null || v === undefined) continue;
    if (ARRAY_COLS.includes(k) && typeof v === 'string') {
      try { out[k] = JSON.parse(v); if (!Array.isArray(out[k])) out[k] = []; }
      catch { out[k] = []; }
    } else if (JSON_COLS.includes(k) && typeof v === 'string') {
      try { out[k] = JSON.parse(v); } catch {}
    } else if (BOOL_COLS.includes(k)) {
      out[k] = Boolean(v);
    } else if (typeof v === 'string' && DATETIME_RE.test(v)) {
      out[k] = v.replace(' ', 'T') + 'Z';
    }
  }
  return out;
}

function makeConfig() {
  if (DB_TYPE === 'postgres') {
    console.log('🗄️  Using PostgreSQL database');
    return {
      client: 'pg',
      connection: process.env.DATABASE_URL,
      pool: { min: 2, max: 10 },
    };
  }

  console.log('🗄️  Using SQLite database');
  const dir  = process.env.SQLITE_DIR || join(__dirname, '../../storage');
  const file = process.env.SQLITE_PATH || join(dir, 'viberater.db');
  fs.ensureDirSync(dir);
  console.log(`✓ SQLite path: ${file}`);
  return {
    client: 'better-sqlite3',
    connection: { filename: file },
    useNullAsDefault: true,
    pool: {
      min: 1, max: 1,
      // Set PRAGMAs synchronously when the connection is first created — avoids
      // fire-and-forget pool races that caused migration deadlocks.
      afterCreate: (conn, done) => {
        conn.pragma('journal_mode = WAL');
        conn.pragma('foreign_keys = ON');
        console.log('✓ Connected to SQLite');
        done(null, conn);
      },
    },
  };
}

export const db = knex({
  ...makeConfig(),
  postProcessResponse(result) {
    if (Array.isArray(result)) return result.map(parseRow);
    if (result && typeof result === 'object' && !('rowCount' in result)) return parseRow(result);
    return result;
  },
});

// Verify PostgreSQL connection on startup
if (DB_TYPE === 'postgres') {
  db.raw('SELECT 1').then(() => console.log('✓ Connected to PostgreSQL')).catch(console.error);
}

export const generateUUID = () => uuidv4();

// Compatibility shim used by tests — wraps knex.raw() in the old {rows, rowCount} shape
export async function query(sql, params = []) {
  const result = await db.raw(sql, params);
  const rows = Array.isArray(result) ? result : (result?.rows ?? []);
  return { rows, rowCount: rows.length };
}

// Run raw SQL (used by migrations)
// knex.raw() uses better-sqlite3's prepare() which rejects multi-statement SQL.
// For SQLite we split on statement boundaries and run each one separately.
export async function executeSql(sql) {
  if (DB_TYPE === 'postgres') {
    return db.raw(sql);
  }
  const statements = sql
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map(s => s.replace(/^(\s*--[^\n]*\n|\s*\n)*/g, '').trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await db.raw(stmt);
  }
}

export async function getDbType() {
  return DB_TYPE;
}

export default db;
