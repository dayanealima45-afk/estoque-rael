// Banco de dados SQLite (módulo nativo node:sqlite, sem dependências externas)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'estoque.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin','funcionaria')),
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  nome TEXT PRIMARY KEY,
  regra TEXT NOT NULL DEFAULT 'minimo',
  estoque_minimo INTEGER NOT NULL DEFAULT 3,
  ordem INTEGER NOT NULL DEFAULT 99
);
CREATE TABLE IF NOT EXISTS settings (
  chave TEXT PRIMARY KEY,
  valor TEXT
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL,
  unidade TEXT NOT NULL,
  quantidade_embalagem INTEGER,
  estoque_atual REAL,
  nivel_atual TEXT,
  estoque_minimo INTEGER,
  regra_estoque TEXT NOT NULL DEFAULT 'categoria',
  permite_aberto INTEGER NOT NULL DEFAULT 0,
  permite_quarto INTEGER NOT NULL DEFAULT 0,
  permite_zerado INTEGER NOT NULL DEFAULT 1,
  validade TEXT,
  data_abertura TEXT,
  prazo_apos_aberto INTEGER,
  armazenamento TEXT,
  observacao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  situacao TEXT,
  motivo TEXT,
  ultima_contagem_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  data TEXT NOT NULL,
  hora TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'em_andamento',
  observacao TEXT,
  finalizada_em TEXT,
  total_produtos INTEGER,
  contados INTEGER,
  nao_contados INTEGER,
  para_compra INTEGER,
  urgentes INTEGER
);
CREATE TABLE IF NOT EXISTS stock_count_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_count_id INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantidade REAL,
  status TEXT,
  validade TEXT,
  data_abertura TEXT,
  data_limite_aberto TEXT,
  observacao TEXT,
  situacao TEXT,
  motivo TEXT,
  contado_em TEXT,
  alterado_por INTEGER,
  UNIQUE (stock_count_id, product_id)
);
CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  stock_count_id INTEGER REFERENCES stock_counts(id),
  status TEXT NOT NULL DEFAULT 'pendente',
  motivo TEXT,
  prioridade TEXT NOT NULL,
  data_identificacao TEXT NOT NULL,
  data_compra TEXT,
  comprado_por INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS product_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id),
  tipo_movimentacao TEXT NOT NULL,
  quantidade_anterior TEXT,
  quantidade_nova TEXT,
  usuario TEXT,
  data TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  observacao TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  dados TEXT,
  lida INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT,
  acao TEXT NOT NULL,
  detalhe TEXT,
  data TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_items_count ON stock_count_items(stock_count_id);
CREATE INDEX IF NOT EXISTS idx_purchase_status ON purchase_items(status);
CREATE INDEX IF NOT EXISTS idx_history_product ON product_history(product_id);
`);

// ---------- Senhas ----------
function hashPassword(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(senha, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(senha), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

// ---------- Configurações ----------
const DEFAULT_SETTINGS = {
  alerta_validade_dias: '7',
  alerta_aberto_dias: '3',
};
const DEFAULT_CATEGORIES = [
  ['DESCARTÁVEIS', 'minimo', 3, 1],
  ['INSUMO', 'minimo', 3, 2],
  ['MATERIAL DE LIMPEZA', 'minimo', 3, 3],
  ['MATERIAL DE USO', 'minimo', 3, 4],
];

function seedBase() {
  const insS = db.prepare('INSERT OR IGNORE INTO settings (chave, valor) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insS.run(k, v);
  const insC = db.prepare('INSERT OR IGNORE INTO categories (nome, regra, estoque_minimo, ordem) VALUES (?, ?, ?, ?)');
  for (const c of DEFAULT_CATEGORIES) insC.run(...c);
  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE perfil='admin'").get().n;
  if (!admins) {
    const login = process.env.ADMIN_LOGIN || 'admin';
    // Na internet não usamos senha padrão: sem ADMIN_SENHA, gera uma aleatória e mostra no log
    const senha = process.env.ADMIN_SENHA || (process.env.NODE_ENV === 'production' ? crypto.randomBytes(6).toString('base64url') : 'rael2026');
    db.prepare("INSERT INTO users (nome, login, senha_hash, perfil) VALUES (?, ?, ?, 'admin')")
      .run('Administradora', login, hashPassword(senha));
    console.log(`Usuária administradora criada: login "${login}" / senha "${senha}" (troque no primeiro acesso).`);
  }
}
seedBase();

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT chave, valor FROM settings').all()) out[r.chave] = r.valor;
  return {
    alerta_validade_dias: Number(out.alerta_validade_dias) || 0,
    alerta_aberto_dias: Number(out.alerta_aberto_dias) || 0,
  };
}
function getCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY ordem, nome').all();
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, tx, hashPassword, checkPassword, getSettings, getCategories, DB_FILE, DATA_DIR };
