// ESTOQUE RAEL SORVETES — servidor web
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');

const { db, tx, hashPassword, checkPassword, getSettings, getCategories, DATA_DIR } = require('./src/db');
const S = require('./src/service');
const R = require('./src/rules');
const { chaveProduto } = require('./src/matcher');
const { importarPlanilha } = require('./src/importer');
const exporter = require('./src/exporter');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // atrás do proxy HTTPS da hospedagem
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------- Autenticação ----------------
const SESSAO_DIAS = 30;
function usuarioDaSessao(req) {
  const token = req.cookies.sid;
  if (!token) return null;
  const s = db.prepare(`SELECT u.id, u.nome, u.login, u.perfil, u.ativo, s.expires_at FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!s || !s.ativo || s.expires_at < Date.now()) return null;
  return { id: s.id, nome: s.nome, login: s.login, perfil: s.perfil };
}
function auth(req, res, next) {
  const u = usuarioDaSessao(req);
  if (!u) return res.status(401).json({ erro: 'Faça login para continuar' });
  req.user = u;
  next();
}
function admin(req, res, next) {
  if (req.user.perfil !== 'admin') return res.status(403).json({ erro: 'Acesso permitido só para a administradora' });
  next();
}

const tentativas = new Map();
app.post('/api/login', (req, res) => {
  const login = String(req.body.login || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const t = tentativas.get(login) || { n: 0, ate: 0 };
  if (t.ate > Date.now()) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  const u = db.prepare('SELECT * FROM users WHERE lower(login) = ?').get(login);
  if (!u || !u.ativo || !checkPassword(senha, u.senha_hash)) {
    t.n++; if (t.n >= 8) { t.ate = Date.now() + 5 * 60000; t.n = 0; }
    tentativas.set(login, t);
    return res.status(401).json({ erro: 'Login ou senha incorretos' });
  }
  tentativas.delete(login);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, u.id, Date.now() + SESSAO_DIAS * 86400000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSAO_DIAS * 86400000 });
  S.auditoria(u.nome, 'login', null);
  res.json({ id: u.id, nome: u.nome, login: u.login, perfil: u.perfil });
});
app.post('/api/logout', (req, res) => {
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json(req.user));
app.put('/api/me/senha', auth, (req, res) => {
  const { atual, nova } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!checkPassword(atual || '', u.senha_hash)) return res.status(400).json({ erro: 'Senha atual incorreta' });
  if (!nova || String(nova).length < 4) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 4 caracteres' });
  db.prepare('UPDATE users SET senha_hash = ? WHERE id = ?').run(hashPassword(nova), u.id);
  S.auditoria(u.nome, 'trocar_senha', null);
  res.json({ ok: true });
});

app.use('/api', auth);

// ---------------- Dados gerais ----------------
app.get('/api/bootstrap', (req, res) => {
  const unidades = db.prepare('SELECT DISTINCT unidade FROM products ORDER BY unidade').all().map(r => r.unidade);
  res.json({ user: req.user, categorias: getCategories(), settings: getSettings(), unidades, niveis: R.NIVEIS, regras: R.REGRAS, hoje: R.today() });
});

// ---------------- Produtos ----------------
app.get('/api/products', (req, res) => {
  const incl = req.user.perfil === 'admin' && req.query.todos === '1';
  res.json(S.listarProdutos({ incluirInativos: incl }));
});
app.get('/api/products/:id/history', admin, (req, res) => {
  res.json(db.prepare('SELECT * FROM product_history WHERE product_id = ? ORDER BY id DESC LIMIT 200').all(req.params.id));
});

const CAMPOS_PRODUTO = ['nome', 'categoria', 'unidade', 'quantidade_embalagem', 'estoque_minimo', 'regra_estoque', 'permite_aberto',
  'permite_quarto', 'permite_zerado', 'validade', 'data_abertura', 'prazo_apos_aberto', 'armazenamento', 'observacao', 'ativo'];

function validarProduto(body, atual) {
  const p = {};
  for (const k of CAMPOS_PRODUTO) if (k in body) p[k] = body[k];
  const txt = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
  if ('nome' in p) { p.nome = txt(p.nome); if (!p.nome) throw new S.HttpError(400, 'Informe o nome do produto'); }
  if ('categoria' in p) {
    p.categoria = txt(p.categoria).toUpperCase();
    if (!getCategories().some(c => c.nome === p.categoria)) throw new S.HttpError(400, 'Categoria inválida');
  }
  if ('unidade' in p) { p.unidade = txt(p.unidade).toUpperCase(); if (!p.unidade) throw new S.HttpError(400, 'Informe o tipo de unidade'); }
  for (const k of ['quantidade_embalagem', 'estoque_minimo', 'prazo_apos_aberto']) {
    if (k in p) {
      if (p[k] === '' || p[k] == null) p[k] = null;
      else { const n = Number(p[k]); if (!Number.isInteger(n) || n < 0) throw new S.HttpError(400, `Valor inválido em ${k.replace(/_/g, ' ')}`); p[k] = n; }
    }
  }
  if ('regra_estoque' in p && p.regra_estoque !== 'categoria' && !R.REGRAS[p.regra_estoque]) throw new S.HttpError(400, 'Regra inválida');
  for (const k of ['permite_aberto', 'permite_quarto', 'permite_zerado', 'ativo']) if (k in p) p[k] = p[k] ? 1 : 0;
  for (const k of ['validade', 'data_abertura']) if (k in p) { p[k] = p[k] || null; if (p[k] && !R.parseDate(p[k])) throw new S.HttpError(400, 'Data inválida'); }
  for (const k of ['armazenamento', 'observacao']) if (k in p) p[k] = txt(p[k]) || null;
  if (p.nome) {
    const chave = chaveProduto(p.nome);
    const dup = db.prepare('SELECT id, nome FROM products').all().find(x => chaveProduto(x.nome) === chave && (!atual || x.id !== atual.id));
    if (dup) throw new S.HttpError(400, `Já existe um produto com esse nome: ${dup.nome}`);
  }
  return p;
}

app.post('/api/products', admin, (req, res) => {
  const p = validarProduto(req.body, null);
  if (!p.nome || !p.categoria || !p.unidade) throw new S.HttpError(400, 'Nome, categoria e unidade são obrigatórios');
  const ks = Object.keys(p);
  const r = db.prepare(`INSERT INTO products (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`).run(...ks.map(k => p[k]));
  const id = Number(r.lastInsertRowid);
  S.historico(id, 'cadastro', null, null, req.user.nome, 'Produto cadastrado');
  res.json(S.enriquecerProduto(db.prepare('SELECT * FROM products WHERE id = ?').get(id)));
});

app.put('/api/products/:id', admin, (req, res) => {
  const atual = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!atual) throw new S.HttpError(404, 'Produto não encontrado');
  const p = validarProduto(req.body, atual);
  const ks = Object.keys(p).filter(k => String(p[k] ?? '') !== String(atual[k] ?? ''));
  if (ks.length) {
    db.prepare(`UPDATE products SET ${ks.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...ks.map(k => p[k]), atual.id);
    const detalhes = ks.map(k => `${k.replace(/_/g, ' ')}: ${atual[k] ?? '—'} → ${p[k] ?? '—'}`).join('; ');
    S.historico(atual.id, ks.includes('ativo') ? (p.ativo ? 'reativado' : 'inativado') : 'edicao', null, null, req.user.nome, detalhes);
    if (ks.includes('ativo') && !p.ativo) db.prepare("UPDATE purchase_items SET status = 'resolvido' WHERE product_id = ? AND status = 'pendente'").run(atual.id);
  }
  res.json(S.enriquecerProduto(db.prepare('SELECT * FROM products WHERE id = ?').get(atual.id)));
});

app.delete('/api/products/:id', admin, (req, res) => {
  const atual = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!atual) throw new S.HttpError(404, 'Produto não encontrado');
  const usado = db.prepare('SELECT COUNT(*) AS n FROM stock_count_items WHERE product_id = ?').get(atual.id).n;
  if (req.query.definitivo === '1' && !usado) {
    tx(() => {
      db.prepare('DELETE FROM purchase_items WHERE product_id = ?').run(atual.id);
      db.prepare('DELETE FROM product_history WHERE product_id = ?').run(atual.id);
      db.prepare('DELETE FROM products WHERE id = ?').run(atual.id);
      S.auditoria(req.user.nome, 'excluir_produto', { id: atual.id, nome: atual.nome });
    });
    return res.json({ excluido: true });
  }
  db.prepare("UPDATE products SET ativo = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(atual.id);
  db.prepare("UPDATE purchase_items SET status = 'resolvido' WHERE product_id = ? AND status = 'pendente'").run(atual.id);
  S.historico(atual.id, 'inativado', null, null, req.user.nome, usado ? 'Inativado (tem contagens no histórico, não pode ser excluído)' : 'Inativado');
  res.json({ inativado: true });
});

// ---------------- Usuárias ----------------
app.get('/api/users', admin, (req, res) => {
  res.json(db.prepare('SELECT id, nome, login, perfil, ativo, created_at FROM users ORDER BY perfil, nome').all());
});
app.post('/api/users', admin, (req, res) => {
  const nome = String(req.body.nome || '').trim(), login = String(req.body.login || '').trim().toLowerCase();
  const senha = String(req.body.senha || ''), perfil = req.body.perfil === 'admin' ? 'admin' : 'funcionaria';
  if (!nome || !login) throw new S.HttpError(400, 'Informe nome e login');
  if (senha.length < 4) throw new S.HttpError(400, 'A senha precisa ter pelo menos 4 caracteres');
  if (db.prepare('SELECT id FROM users WHERE lower(login) = ?').get(login)) throw new S.HttpError(400, 'Este login já existe');
  const r = db.prepare('INSERT INTO users (nome, login, senha_hash, perfil) VALUES (?, ?, ?, ?)').run(nome, login, hashPassword(senha), perfil);
  S.auditoria(req.user.nome, 'cadastrar_usuaria', { nome, login, perfil });
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/users/:id', admin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new S.HttpError(404, 'Usuária não encontrada');
  const novo = {
    nome: req.body.nome != null ? String(req.body.nome).trim() : u.nome,
    login: req.body.login != null ? String(req.body.login).trim().toLowerCase() : u.login,
    perfil: req.body.perfil ? (req.body.perfil === 'admin' ? 'admin' : 'funcionaria') : u.perfil,
    ativo: req.body.ativo != null ? (req.body.ativo ? 1 : 0) : u.ativo,
  };
  if (!novo.nome || !novo.login) throw new S.HttpError(400, 'Informe nome e login');
  if (db.prepare('SELECT id FROM users WHERE lower(login) = ? AND id != ?').get(novo.login, u.id)) throw new S.HttpError(400, 'Este login já existe');
  if (u.perfil === 'admin' && (novo.perfil !== 'admin' || !novo.ativo)) {
    const outros = db.prepare("SELECT COUNT(*) AS n FROM users WHERE perfil = 'admin' AND ativo = 1 AND id != ?").get(u.id).n;
    if (!outros) throw new S.HttpError(400, 'Precisa existir pelo menos uma administradora ativa');
  }
  db.prepare('UPDATE users SET nome = ?, login = ?, perfil = ?, ativo = ? WHERE id = ?').run(novo.nome, novo.login, novo.perfil, novo.ativo, u.id);
  if (req.body.senha) {
    if (String(req.body.senha).length < 4) throw new S.HttpError(400, 'A senha precisa ter pelo menos 4 caracteres');
    db.prepare('UPDATE users SET senha_hash = ? WHERE id = ?').run(hashPassword(req.body.senha), u.id);
  }
  if (!novo.ativo || req.body.senha) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  S.auditoria(req.user.nome, 'editar_usuaria', { id: u.id, ...novo, senha_alterada: !!req.body.senha });
  res.json({ ok: true });
});

// ---------------- Contagens ----------------
app.get('/api/counts', (req, res) => res.json(S.listarContagens(req.user)));
app.post('/api/counts/start', (req, res) => res.json({ id: S.iniciarContagem(req.user) }));
app.get('/api/counts/compare', (req, res) => res.json(S.compararContagens(Number(req.query.a), Number(req.query.b), req.user)));
app.get('/api/counts/:id', (req, res) => res.json(S.detalheContagem(Number(req.params.id), req.user)));
app.put('/api/counts/:id/items/:pid', (req, res) => res.json(S.salvarItem(Number(req.params.id), Number(req.params.pid), req.body, req.user)));
app.post('/api/counts/:id/finalize', (req, res) => res.json(S.finalizarContagem(Number(req.params.id), req.user, req.body)));
app.delete('/api/counts/:id', admin, (req, res) => {
  const c = db.prepare('SELECT * FROM stock_counts WHERE id = ?').get(req.params.id);
  if (!c) throw new S.HttpError(404, 'Contagem não encontrada');
  if (c.status !== 'em_andamento') throw new S.HttpError(400, 'Só é possível descartar contagens em andamento');
  db.prepare('DELETE FROM stock_counts WHERE id = ?').run(c.id);
  S.auditoria(req.user.nome, 'descartar_contagem', { id: c.id });
  res.json({ ok: true });
});

// ---------------- Compras ----------------
app.get('/api/purchases', admin, (req, res) => res.json(S.listaCompras()));
app.post('/api/purchases/:id/comprar', admin, (req, res) => res.json(S.marcarComprado(Number(req.params.id), req.user)));
app.post('/api/purchases/:id/desfazer', admin, (req, res) => res.json(S.desfazerCompra(Number(req.params.id), req.user)));

// ---------------- Painel e avisos ----------------
app.get('/api/dashboard', admin, (req, res) => res.json(S.painel()));
app.post('/api/notifications/:id/lida', admin, (req, res) => {
  db.prepare('UPDATE notifications SET lida = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/notifications/lidas', admin, (req, res) => {
  db.prepare('UPDATE notifications SET lida = 1').run();
  res.json({ ok: true });
});

// ---------------- Configurações ----------------
app.get('/api/config', admin, (req, res) => res.json({ settings: getSettings(), categorias: getCategories(), regras: R.REGRAS }));
app.put('/api/config', admin, (req, res) => {
  const { settings, categorias, nova_categoria } = req.body;
  tx(() => {
    if (settings) {
      for (const k of ['alerta_validade_dias', 'alerta_aberto_dias']) {
        if (k in settings) {
          const n = Number(settings[k]);
          if (!Number.isInteger(n) || n < 0 || n > 365) throw new S.HttpError(400, 'Informe um número de dias entre 0 e 365');
          db.prepare('INSERT INTO settings (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(k, String(n));
        }
      }
    }
    for (const c of categorias || []) {
      if (!['minimo', 'nivel', 'nivel_aberto', 'nenhuma'].includes(c.regra)) throw new S.HttpError(400, 'Regra inválida');
      const n = Number(c.estoque_minimo);
      if (!Number.isInteger(n) || n < 0) throw new S.HttpError(400, 'Estoque mínimo inválido');
      db.prepare('UPDATE categories SET regra = ?, estoque_minimo = ? WHERE nome = ?').run(c.regra, n, c.nome);
    }
    if (nova_categoria) {
      const nome = String(nova_categoria).trim().toUpperCase();
      if (nome) db.prepare("INSERT OR IGNORE INTO categories (nome, regra, estoque_minimo, ordem) VALUES (?, 'minimo', 3, 50)").run(nome);
    }
    S.auditoria(req.user.nome, 'configuracoes', req.body);
  });
  res.json({ settings: getSettings(), categorias: getCategories() });
});

// ---------------- Importação / Exportação ----------------
app.post('/api/import', admin, express.raw({ type: () => true, limit: '20mb' }), wrap(async (req, res) => {
  if (!req.body || !req.body.length) throw new S.HttpError(400, 'Envie um arquivo Excel (.xlsx)');
  try {
    res.json(await importarPlanilha(req.body, req.user.nome));
  } catch (e) {
    if (e.status) throw e;
    throw new S.HttpError(400, 'Não consegui ler o arquivo. Envie uma planilha .xlsx. (' + e.message + ')');
  }
}));

app.get('/api/export/:tipo', admin, wrap(async (req, res) => {
  const tipo = req.params.tipo, formato = req.query.formato === 'pdf' ? 'pdf' : 'xlsx';
  const opts = { contagem: req.query.contagem ? Number(req.query.contagem) : null };
  const nome = `rael-${tipo}${opts.contagem ? '-' + opts.contagem : ''}-${R.today()}.${formato}`;
  const buf = formato === 'pdf' ? await exporter.pdf(tipo, opts) : await exporter.excel(tipo, opts);
  res.set('Content-Type', formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${nome}"`);
  res.send(buf);
}));

// ---------------- Erros ----------------
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.status && err.status < 500) return res.status(err.status).json({ erro: err.message });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno. Tente de novo.' });
});

// ---------------- Início ----------------
async function carregarPlanilhaInicial() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  const arq = [path.join(DATA_DIR, 'planilha-inicial.xlsx'), path.join(__dirname, 'data', 'planilha-inicial.xlsx')].find(f => fs.existsSync(f));
  if (n || !arq) return;
  const r = await importarPlanilha(fs.readFileSync(arq), 'sistema (carga inicial)');
  console.log(`Planilha inicial importada: ${r.novos} produtos, ${r.regras_aplicadas} regras após aberto.`);
}

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  carregarPlanilhaInicial().then(() => {
    app.listen(PORT, () => console.log(`ESTOQUE RAEL SORVETES rodando em http://localhost:${PORT}`));
  });
}

module.exports = { app, carregarPlanilhaInicial };
