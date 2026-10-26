import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(file) {
  const dir = dirname(file);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT,
      invite_code TEXT UNIQUE,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      salt TEXT,
      hash TEXT,
      avatar TEXT DEFAULT 'frida',
      notifications INTEGER DEFAULT 1,
      monthly_summary INTEGER DEFAULT 1,
      household_id TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      household_id TEXT,
      month TEXT,
      title TEXT,
      category TEXT,
      amount REAL,
      due_day INTEGER DEFAULT 0,
      paid INTEGER DEFAULT 0,
      owner_id TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS incomes (
      household_id TEXT,
      month TEXT,
      amount REAL,
      PRIMARY KEY (household_id, month)
    );
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      bill_id TEXT,
      household_id TEXT,
      name TEXT,
      content_type TEXT,
      size INTEGER,
      data BLOB,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bills_hm ON bills (household_id, month);
    CREATE INDEX IF NOT EXISTS idx_users_hh ON users (household_id);
    CREATE INDEX IF NOT EXISTS idx_receipts_bill ON receipts (bill_id);
    CREATE INDEX IF NOT EXISTS idx_receipts_hh ON receipts (household_id);
  `);
  return db;
}

export function uid() {
  return randomUUID();
}

// Código de convite curto e fácil de digitar (sem caracteres ambíguos).
export function inviteCode() {
  const alpha = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const b = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += alpha[b[i] % alpha.length];
  return out;
}
