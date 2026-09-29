// Regras de negócio: contagens, lista de compras, painel, comparação
const { db, tx, getSettings, getCategories } = require('./db');
const R = require('./rules');

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const SITUACAO_TXT = { urgente: 'Compra urgente', comprar: 'Comprar', ok: 'Estoque adequado' };

function enriquecerProduto(p, settings = getSettings(), cats = getCategories()) {
  const { regra, minimo } = R.regraEfetiva(p, cats);
  const limite = R.limiteAberto(p.data_abertura, p.prazo_apos_aberto);
  return {
    ...p,
    regra_efetiva: regra,
    minimo_efetivo: minimo,
    data_limite_aberto: limite,
    alerta_validade: R.alertaValidade(p.validade, settings),
    alerta_aberto: R.alertaAberto(p.data_abertura, p.prazo_apos_aberto, settings),
    estoque_texto: R.descreverRegistro({ quantidade: p.estoque_atual, status: p.nivel_atual }),
    situacao_texto: SITUACAO_TXT[p.situacao] || 'Não contado',
  };
}

function listarProdutos({ incluirInativos = false } = {}) {
  const settings = getSettings(), cats = getCategories();
  const ordem = new Map(cats.map(c => [c.nome, c.ordem]));
  const rows = db.prepare(`SELECT * FROM products ${incluirInativos ? '' : 'WHERE ativo = 1'}`).all();
  rows.sort((a, b) => (ordem.get(a.categoria) ?? 99) - (ordem.get(b.categoria) ?? 99) || a.nome.localeCompare(b.nome, 'pt-BR'));
  return rows.map(p => enriquecerProduto(p, settings, cats));
}

function historico(productId, tipo, antes, depois, usuario, obs) {
  db.prepare('INSERT INTO product_history (product_id, tipo_movimentacao, quantidade_anterior, quantidade_nova, usuario, observacao) VALUES (?, ?, ?, ?, ?, ?)')
    .run(productId, tipo, antes ?? null, depois ?? null, usuario, obs ?? null);
}
function auditoria(usuario, acao, detalhe) {
  db.prepare('INSERT INTO audit_log (usuario, acao, detalhe) VALUES (?, ?, ?)').run(usuario, acao, detalhe ? JSON.stringify(detalhe) : null);
}

// ---------------- Contagens ----------------
function iniciarContagem(user) {
  const aberta = db.prepare("SELECT id FROM stock_counts WHERE user_id = ? AND status = 'em_andamento' ORDER BY id DESC").get(user.id);
  if (aberta) return aberta.id;
  const r = db.prepare("INSERT INTO stock_counts (user_id, data, hora, status) VALUES (?, ?, ?, 'em_andamento')")
    .run(user.id, R.today(), R.nowTime());
  auditoria(user.nome, 'iniciar_contagem', { id: Number(r.lastInsertRowid) });
  return Number(r.lastInsertRowid);
}

function carregarContagem(id, user) {
  const c = db.prepare('SELECT sc.*, u.nome AS funcionaria FROM stock_counts sc JOIN users u ON u.id = sc.user_id WHERE sc.id = ?').get(id);
  if (!c) throw new HttpError(404, 'Contagem não encontrada');
  if (user.perfil !== 'admin' && c.user_id !== user.id) throw new HttpError(403, 'Você só pode ver as suas contagens');
  return c;
}

function detalheContagem(id, user) {
  const c = carregarContagem(id, user);
  const settings = getSettings(), cats = getCategories();
  const items = db.prepare('SELECT * FROM stock_count_items WHERE stock_count_id = ?').all(id);
  let produtos;
  if (c.status === 'em_andamento') {
    produtos = listarProdutos();
  } else {
    const ids = items.map(i => i.product_id);
    produtos = listarProdutos({ incluirInativos: true }).filter(p => ids.includes(p.id) || p.ativo);
  }
  const porProduto = Object.fromEntries(items.map(i => [i.product_id, {
    ...i,
    alerta_validade: R.alertaValidade(i.validade, settings),
    alerta_aberto: R.alertaAberto(i.data_abertura, produtos.find(p => p.id === i.product_id)?.prazo_apos_aberto, settings),
  }]));
  const total = c.status === 'em_andamento' ? produtos.length : (c.total_produtos ?? produtos.length);
  return { contagem: c, produtos, itens: porProduto, total, contados: items.length, categorias: cats, settings };
}

function normalizarRegistro(body, produto) {
  const out = {};
  let q = body.quantidade;
  if (q === '' || q === undefined || q === null) q = null;
  else {
    q = Number(String(q).replace(',', '.'));
    if (!Number.isFinite(q) || q < 0) throw new HttpError(400, 'Quantidade inválida');
  }
  out.quantidade = q;
  const st = body.status || null;
  if (st && !R.NIVEIS[st]) throw new HttpError(400, 'Status inválido');
  if (st === 'aberto' && !produto.permite_aberto) throw new HttpError(400, 'Este produto não usa o status "Aberto"');
  if (st === 'quarto' && !produto.permite_quarto) throw new HttpError(400, 'Este produto não usa o status "1/4"');
  if (st === 'zerado' && !produto.permite_zerado) throw new HttpError(400, 'Este produto não usa o status "Zerado"');
  if (st === 'cheio' && !(produto.permite_aberto || produto.permite_quarto)) throw new HttpError(400, 'Status inválido');
  out.status = st;
  for (const k of ['validade', 'data_abertura']) {
    const v = body[k] || null;
    if (v && !R.parseDate(v)) throw new HttpError(400, `Data inválida em ${k}`);
    out[k] = v;
  }
  out.observacao = (body.observacao || '').toString().trim().slice(0, 500) || null;
  return out;
}

function salvarItem(countId, productId, body, user) {
  const c = carregarContagem(countId, user);
  if (c.status !== 'em_andamento' && user.perfil !== 'admin') {
    throw new HttpError(403, 'Esta contagem já foi finalizada. Só a administradora pode corrigir.');
  }
  const produto = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!produto) throw new HttpError(404, 'Produto não encontrado');
  const reg = normalizarRegistro(body, produto);
  const cats = getCategories();
  const anterior = db.prepare('SELECT * FROM stock_count_items WHERE stock_count_id = ? AND product_id = ?').get(countId, productId);

  return tx(() => {
    if (reg.quantidade == null && !reg.status) {
      // Sem quantidade nem status = volta a "não contado"
      if (anterior) db.prepare('DELETE FROM stock_count_items WHERE id = ?').run(anterior.id);
      if (c.status !== 'em_andamento') {
        historico(productId, 'correcao', R.descreverRegistro(anterior), 'não contado', user.nome, `Correção na contagem #${countId}`);
        recalcularResumo(countId);
      }
      return { item: null, situacao: null };
    }
    const av = R.avaliar(produto, reg, cats);
    const limite = R.limiteAberto(reg.data_abertura, produto.prazo_apos_aberto);
    const agora = `${R.today()} ${R.nowTime()}`;
    if (anterior) {
      db.prepare(`UPDATE stock_count_items SET quantidade=?, status=?, validade=?, data_abertura=?, data_limite_aberto=?, observacao=?,
        situacao=?, motivo=?, contado_em=?, alterado_por=? WHERE id=?`)
        .run(reg.quantidade, reg.status, reg.validade, reg.data_abertura, limite, reg.observacao, av.situacao, av.motivo, agora, user.id, anterior.id);
    } else {
      db.prepare(`INSERT INTO stock_count_items (stock_count_id, product_id, quantidade, status, validade, data_abertura, data_limite_aberto,
        observacao, situacao, motivo, contado_em, alterado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(countId, productId, reg.quantidade, reg.status, reg.validade, reg.data_abertura, limite, reg.observacao, av.situacao, av.motivo, agora, user.id);
    }
    if (c.status !== 'em_andamento') {
      // Correção da administradora em contagem finalizada
      historico(productId, 'correcao', R.descreverRegistro(anterior), R.descreverRegistro(reg), user.nome, `Correção na contagem #${countId} de ${fmtData(c.data)}`);
      const ultima = db.prepare('SELECT ultima_contagem_id FROM products WHERE id = ?').get(productId).ultima_contagem_id;
      if (ultima === countId) aplicarNoProduto(produto, reg, av, countId, user, 'correcao');
      recalcularResumo(countId);
    }
    const item = db.prepare('SELECT * FROM stock_count_items WHERE stock_count_id = ? AND product_id = ?').get(countId, productId);
    return { item, situacao: av.situacao, motivo: av.motivo };
  });
}

function aplicarNoProduto(produto, reg, av, countId, user, tipo) {
  const antes = R.descreverRegistro({ quantidade: produto.estoque_atual, status: produto.nivel_atual });
  db.prepare(`UPDATE products SET estoque_atual = ?, nivel_atual = ?, validade = COALESCE(?, validade),
      data_abertura = ?, situacao = ?, motivo = ?, ultima_contagem_id = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(reg.quantidade, reg.status, reg.validade, reg.data_abertura ?? null, av.situacao, av.motivo, countId, produto.id);
  if (tipo === 'contagem') historico(produto.id, 'contagem', antes, R.descreverRegistro(reg), user.nome, reg.observacao);
  sincronizarCompra(produto.id, av, countId);
}

function sincronizarCompra(productId, av, countId) {
  const pend = db.prepare("SELECT * FROM purchase_items WHERE product_id = ? AND status = 'pendente'").get(productId);
  if (av.situacao === 'urgente' || av.situacao === 'comprar') {
    if (pend) {
      db.prepare('UPDATE purchase_items SET prioridade = ?, motivo = ?, stock_count_id = ? WHERE id = ?').run(av.situacao, av.motivo, countId, pend.id);
    } else {
      db.prepare("INSERT INTO purchase_items (product_id, stock_count_id, status, motivo, prioridade, data_identificacao) VALUES (?, ?, 'pendente', ?, ?, ?)")
        .run(productId, countId, av.motivo, av.situacao, R.today());
    }
  } else if (av.situacao === 'ok' && pend) {
    db.prepare("UPDATE purchase_items SET status = 'resolvido', motivo = motivo || ' (saiu da lista na contagem #' || ? || ')' WHERE id = ?").run(countId, pend.id);
  }
}

function recalcularResumo(countId) {
  const itens = db.prepare('SELECT situacao FROM stock_count_items WHERE stock_count_id = ?').all(countId);
  const c = db.prepare('SELECT total_produtos FROM stock_counts WHERE id = ?').get(countId);
  const contados = itens.length;
  db.prepare('UPDATE stock_counts SET contados = ?, nao_contados = ?, para_compra = ?, urgentes = ? WHERE id = ?').run(
    contados, Math.max(0, (c.total_produtos || contados) - contados),
    itens.filter(i => i.situacao === 'comprar' || i.situacao === 'urgente').length,
    itens.filter(i => i.situacao === 'urgente').length, countId);
}

function fmtData(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function finalizarContagem(countId, user, { observacao, forcar } = {}) {
  const c = carregarContagem(countId, user);
  if (c.status !== 'em_andamento') throw new HttpError(400, 'Esta contagem já foi finalizada');
  const produtos = db.prepare('SELECT * FROM products WHERE ativo = 1').all();
  const itens = db.prepare('SELECT * FROM stock_count_items WHERE stock_count_id = ?').all(countId);
  const contadosIds = new Set(itens.map(i => i.product_id));
  const naoContados = produtos.filter(p => !contadosIds.has(p.id));
  if (naoContados.length && !forcar) {
    return { precisaConfirmar: true, nao_contados: naoContados.length };
  }
  const cats = getCategories();
  return tx(() => {
    let paraCompra = 0, urgentes = 0;
    const byId = new Map(db.prepare('SELECT * FROM products').all().map(p => [p.id, p]));
    for (const it of itens) {
      const p = byId.get(it.product_id);
      if (!p) continue;
      const av = R.avaliar(p, it, cats); // reavalia com a regra vigente
      db.prepare('UPDATE stock_count_items SET situacao = ?, motivo = ? WHERE id = ?').run(av.situacao, av.motivo, it.id);
      if (av.situacao === 'urgente') urgentes++;
      if (av.situacao === 'urgente' || av.situacao === 'comprar') paraCompra++;
      aplicarNoProduto(p, it, av, countId, user, 'contagem');
    }
    const hora = R.nowTime();
    db.prepare(`UPDATE stock_counts SET status = 'finalizada', observacao = ?, finalizada_em = ?, hora = ?, total_produtos = ?,
      contados = ?, nao_contados = ?, para_compra = ?, urgentes = ? WHERE id = ?`)
      .run((observacao || '').trim() || null, `${R.today()} ${hora}`, hora, produtos.length, itens.length, naoContados.length, paraCompra, urgentes, countId);
    const dados = {
      contagem_id: countId, funcionaria: c.funcionaria, data: R.today(), hora,
      contados: itens.length, nao_contados: naoContados.length, para_compra: paraCompra, urgentes,
    };
    db.prepare("INSERT INTO notifications (tipo, titulo, dados) VALUES ('contagem', 'Nova contagem concluída', ?)").run(JSON.stringify(dados));
    auditoria(user.nome, 'finalizar_contagem', dados);
    return { finalizada: true, ...dados };
  });
}

function listarContagens(user) {
  const where = user.perfil === 'admin' ? '' : 'WHERE sc.user_id = ?';
  const args = user.perfil === 'admin' ? [] : [user.id];
  return db.prepare(`SELECT sc.*, u.nome AS funcionaria,
      (SELECT COUNT(*) FROM stock_count_items i WHERE i.stock_count_id = sc.id) AS itens
    FROM stock_counts sc JOIN users u ON u.id = sc.user_id ${where} ORDER BY sc.data DESC, sc.id DESC`).all(...args);
}

// ---------------- Comparação ----------------
function compararContagens(aId, bId, user) {
  const A = carregarContagem(aId, user), B = carregarContagem(bId, user);
  const ia = new Map(db.prepare('SELECT * FROM stock_count_items WHERE stock_count_id = ?').all(aId).map(i => [i.product_id, i]));
  const ib = new Map(db.prepare('SELECT * FROM stock_count_items WHERE stock_count_id = ?').all(bId).map(i => [i.product_id, i]));
  const ids = new Set([...ia.keys(), ...ib.keys()]);
  const prods = db.prepare('SELECT id, nome, categoria, unidade FROM products').all().filter(p => ids.has(p.id));
  const compra = s => s === 'comprar' || s === 'urgente';
  const linhas = prods.map(p => {
    const a = ia.get(p.id), b = ib.get(p.id);
    const va = R.valorComparavel(a), vb = R.valorComparavel(b);
    const ind = [];
    if (!a) ind.push('novo');
    else if (!b) ind.push('nao_contado');
    else {
      if (vb === 0 && va !== 0) ind.push('zerou');
      else if (va != null && vb != null && vb > va) ind.push('aumentou');
      else if (va != null && vb != null && vb < va) ind.push('diminuiu');
      else ind.push('igual');
      if (!compra(a.situacao) && compra(b.situacao)) ind.push('entrou_baixo');
      if (compra(a.situacao) && !compra(b.situacao)) ind.push('saiu_compras');
    }
    return {
      produto_id: p.id, nome: p.nome, categoria: p.categoria, unidade: p.unidade,
      antes: R.descreverRegistro(a), depois: R.descreverRegistro(b),
      situacao_antes: a?.situacao || null, situacao_depois: b?.situacao || null,
      indicadores: ind,
    };
  });
  const resumo = {};
  for (const l of linhas) for (const i of l.indicadores) resumo[i] = (resumo[i] || 0) + 1;
  return { a: A, b: B, linhas, resumo };
}

// ---------------- Compras ----------------
function listaCompras() {
  const pend = db.prepare(`SELECT pi.*, p.nome, p.categoria, p.unidade, p.estoque_atual, p.nivel_atual, p.estoque_minimo, p.regra_estoque,
      sc.data AS data_contagem
    FROM purchase_items pi JOIN products p ON p.id = pi.product_id LEFT JOIN stock_counts sc ON sc.id = pi.stock_count_id
    WHERE pi.status = 'pendente' AND p.ativo = 1 ORDER BY p.categoria, p.nome`).all();
  const cats = getCategories();
  const enr = r => ({
    ...r,
    estoque_texto: R.descreverRegistro({ quantidade: r.estoque_atual, status: r.nivel_atual }),
    minimo_efetivo: R.regraEfetiva(r, cats).minimo,
    regra_efetiva: R.regraEfetiva(r, cats).regra,
  });
  const comprados = db.prepare(`SELECT pi.*, p.nome, p.categoria, p.unidade, u.nome AS comprado_por_nome
    FROM purchase_items pi JOIN products p ON p.id = pi.product_id LEFT JOIN users u ON u.id = pi.comprado_por
    WHERE pi.status = 'comprado' ORDER BY pi.data_compra DESC, pi.id DESC LIMIT 100`).all();
  const pendIds = new Set(pend.map(p => p.product_id));
  const adequados = listarProdutos().filter(p => !pendIds.has(p.id) && p.situacao === 'ok');
  const naoContados = listarProdutos().filter(p => !pendIds.has(p.id) && !p.situacao);
  return {
    urgentes: pend.filter(p => p.prioridade === 'urgente').map(enr),
    comprar: pend.filter(p => p.prioridade === 'comprar').map(enr),
    adequados, nao_contados: naoContados, comprados,
  };
}

function marcarComprado(id, user) {
  const pi = db.prepare('SELECT pi.*, p.nome FROM purchase_items pi JOIN products p ON p.id = pi.product_id WHERE pi.id = ?').get(id);
  if (!pi) throw new HttpError(404, 'Item não encontrado');
  if (pi.status !== 'pendente') throw new HttpError(400, 'Este item não está pendente');
  const data = `${R.today()} ${R.nowTime()}`;
  db.prepare("UPDATE purchase_items SET status = 'comprado', data_compra = ?, comprado_por = ? WHERE id = ?").run(data, user.id, id);
  historico(pi.product_id, 'compra', null, null, user.nome, `Marcado como comprado (${pi.motivo || ''})`);
  return { ok: true };
}
function desfazerCompra(id, user) {
  const pi = db.prepare('SELECT * FROM purchase_items WHERE id = ?').get(id);
  if (!pi) throw new HttpError(404, 'Item não encontrado');
  if (pi.status !== 'comprado') throw new HttpError(400, 'Este item não está marcado como comprado');
  const outro = db.prepare("SELECT id FROM purchase_items WHERE product_id = ? AND status = 'pendente'").get(pi.product_id);
  if (outro) throw new HttpError(400, 'Este produto já tem uma compra pendente mais recente');
  db.prepare("UPDATE purchase_items SET status = 'pendente', data_compra = NULL, comprado_por = NULL WHERE id = ?").run(id);
  historico(pi.product_id, 'compra_desfeita', null, null, user.nome, 'Compra desfeita (marcada por engano)');
  return { ok: true };
}

// ---------------- Painel ----------------
function painel() {
  const produtos = listarProdutos();
  const ultima = db.prepare(`SELECT sc.*, u.nome AS funcionaria FROM stock_counts sc JOIN users u ON u.id = sc.user_id
    WHERE sc.status = 'finalizada' ORDER BY sc.finalizada_em DESC, sc.id DESC LIMIT 1`).get();
  const pend = db.prepare(`SELECT pi.prioridade, COUNT(*) AS n FROM purchase_items pi JOIN products p ON p.id = pi.product_id
    WHERE pi.status = 'pendente' AND p.ativo = 1 GROUP BY pi.prioridade`).all();
  const n = k => pend.find(x => x.prioridade === k)?.n || 0;
  const vencimentos = produtos.filter(p => p.alerta_validade && p.alerta_validade.nivel !== 'normal')
    .sort((a, b) => a.alerta_validade.dias - b.alerta_validade.dias);
  const aposAberto = produtos.filter(p => p.alerta_aberto && p.alerta_aberto.nivel !== 'normal')
    .sort((a, b) => a.alerta_aberto.dias - b.alerta_aberto.dias);
  const emAndamento = db.prepare(`SELECT sc.id, sc.data, u.nome AS funcionaria,
      (SELECT COUNT(*) FROM stock_count_items i WHERE i.stock_count_id = sc.id) AS itens
    FROM stock_counts sc JOIN users u ON u.id = sc.user_id WHERE sc.status = 'em_andamento' ORDER BY sc.id DESC`).all();
  const avisos = db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 10').all().map(a => ({ ...a, dados: JSON.parse(a.dados || '{}') }));
  return {
    ultima, total_produtos: produtos.length,
    urgentes: n('urgente'), estoque_baixo: n('comprar'),
    vencimentos, apos_aberto: aposAberto,
    vencidos: vencimentos.filter(v => v.alerta_validade.nivel === 'vencido').length,
    em_andamento: emAndamento, avisos, avisos_nao_lidos: avisos.filter(a => !a.lida).length,
  };
}

module.exports = {
  HttpError, enriquecerProduto, listarProdutos, historico, auditoria,
  iniciarContagem, detalheContagem, salvarItem, finalizarContagem, listarContagens,
  compararContagens, listaCompras, marcarComprado, desfazerCompra, painel, fmtData, SITUACAO_TXT,
};
