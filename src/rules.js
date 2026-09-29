// Regras automáticas de estoque, validade e prazo após aberto.
// Nada aqui é fixo: mínimos e tipos de regra vêm das categorias e do cadastro do produto.

const NIVEIS = {
  cheio: 'Cheio',
  aberto: 'Aberto',
  quarto: '1/4',
  zerado: 'Zerado',
};

const REGRAS = {
  minimo: 'Quantidade mínima (compra quando abaixo do mínimo)',
  nivel: 'Por nível (compra em 1/4 ou zerado)',
  nivel_aberto: 'Por nível, aberto já compra (compra em aberto, 1/4 ou zerado)',
  nenhuma: 'Sem compra automática',
};

// ---------- Datas (sempre YYYY-MM-DD no horário local) ----------
function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function today() { return isoDate(new Date()); }
function nowTime() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function parseDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseDate(s);
  if (!d || n == null || n === '') return null;
  d.setDate(d.getDate() + Number(n));
  return isoDate(d);
}
function diffDays(from, to) {
  const a = parseDate(from), b = parseDate(to);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

// ---------- Regra de compra ----------
function regraEfetiva(product, categories) {
  const cat = categories.find(c => c.nome === product.categoria);
  const regra = product.regra_estoque && product.regra_estoque !== 'categoria'
    ? product.regra_estoque
    : (cat ? cat.regra : 'minimo');
  const minimo = product.estoque_minimo != null && product.estoque_minimo !== ''
    ? Number(product.estoque_minimo)
    : (cat ? Number(cat.estoque_minimo) : 3);
  return { regra, minimo };
}

function fmtQtd(q) {
  if (q == null) return '';
  return Number.isInteger(q) ? String(q) : String(q).replace('.', ',');
}

/**
 * Avalia um registro de contagem (quantidade + status/nível) contra a regra do produto.
 * Retorna { situacao: 'urgente' | 'comprar' | 'ok' | null, motivo }
 * null = produto não contado.
 */
function avaliar(product, registro, categories) {
  const quantidade = registro.quantidade == null || registro.quantidade === '' ? null : Number(registro.quantidade);
  const nivel = registro.status || null;
  if (quantidade == null && !nivel) return { situacao: null, motivo: null };

  const { regra, minimo } = regraEfetiva(product, categories);
  const un = (product.unidade || '').toLowerCase();

  if (regra === 'nenhuma') return { situacao: 'ok', motivo: 'Sem regra de compra automática' };

  if (regra === 'nivel' || regra === 'nivel_aberto') {
    // Zerado só é zerado se não houver unidades cheias informadas
    if (nivel === 'zerado' && !(quantidade > 0)) return { situacao: 'urgente', motivo: 'Produto zerado' };
    if (nivel === 'quarto') return { situacao: 'comprar', motivo: 'Nível em 1/4' };
    if (nivel === 'aberto' && regra === 'nivel_aberto') return { situacao: 'comprar', motivo: 'Aberto (regra: aberto já entra na compra)' };
    if (!nivel && quantidade === 0) return { situacao: 'urgente', motivo: 'Produto zerado' };
    if (nivel === 'aberto') return { situacao: 'ok', motivo: 'Aberto, com estoque' };
    return { situacao: 'ok', motivo: 'Estoque adequado' };
  }

  // regra 'minimo': conta embalagens fechadas (pacote, caixa, rolo...)
  let q = quantidade;
  if (nivel === 'zerado') q = 0;
  if (q == null) {
    // Só marcou aberto / 1/4 sem informar quantidade: aberto não significa zerado
    if (nivel === 'quarto') return { situacao: 'ok', motivo: 'Nível em 1/4 (sem quantidade informada)' };
    return { situacao: 'ok', motivo: 'Aberto (sem quantidade informada)' };
  }
  if (q <= 0 && (nivel === 'aberto' || nivel === 'quarto')) {
    return { situacao: 'comprar', motivo: `Só resta a embalagem aberta (0 fechadas, mínimo ${minimo})` };
  }
  if (q <= 0) return { situacao: 'urgente', motivo: 'Produto zerado' };
  if (q < minimo) return { situacao: 'comprar', motivo: `Abaixo do mínimo (${fmtQtd(q)} ${un} < ${minimo})` };
  return { situacao: 'ok', motivo: 'Estoque adequado' };
}

// ---------- Alertas ----------
function alertaValidade(validade, settings, ref = today()) {
  if (!validade) return null;
  const dias = diffDays(ref, validade);
  if (dias == null) return null;
  if (dias < 0) return { nivel: 'vencido', dias, texto: `Vencido há ${-dias} dia${-dias === 1 ? '' : 's'}` };
  if (dias <= settings.alerta_validade_dias) return { nivel: 'proximo', dias, texto: dias === 0 ? 'Vence hoje' : `Vence em ${dias} dia${dias === 1 ? '' : 's'}` };
  return { nivel: 'normal', dias, texto: `Válido (${dias} dias)` };
}

function limiteAberto(dataAbertura, prazo) {
  if (!dataAbertura || !prazo) return null;
  return addDays(dataAbertura, prazo);
}

function alertaAberto(dataAbertura, prazo, settings, ref = today()) {
  const limite = limiteAberto(dataAbertura, prazo);
  if (!limite) return null;
  const dias = diffDays(ref, limite);
  if (dias < 0) return { nivel: 'expirado', dias, limite, texto: 'PRAZO APÓS ABERTO EXPIRADO' };
  if (dias <= settings.alerta_aberto_dias) return { nivel: 'atencao', dias, limite, texto: dias === 0 ? 'ATENÇÃO: último dia' : `ATENÇÃO: faltam ${dias} dia${dias === 1 ? '' : 's'}` };
  return { nivel: 'normal', dias, limite, texto: `Faltam ${dias} dias` };
}

// Valor numérico usado para comparar duas contagens
function valorComparavel(item) {
  if (!item) return null;
  const q = item.quantidade == null ? null : Number(item.quantidade);
  const rank = { zerado: 0, quarto: 0.25, aberto: 0.6, cheio: 1 };
  if (item.status === 'zerado' && !(q > 0)) return 0;
  if (item.status && item.status !== 'cheio' && q == null) return rank[item.status];
  if (item.status === 'cheio' && q == null) return 1;
  if (q == null) return null;
  // quantidade de embalagens fechadas + fração da aberta
  return q + (item.status === 'aberto' ? 0.6 : item.status === 'quarto' ? 0.25 : 0);
}

function descreverRegistro(item) {
  if (!item) return '—';
  const partes = [];
  if (item.quantidade != null && item.quantidade !== '') partes.push(fmtQtd(Number(item.quantidade)));
  if (item.status) partes.push(NIVEIS[item.status] || item.status);
  return partes.length ? partes.join(' + ') : '—';
}

module.exports = {
  NIVEIS, REGRAS, today, nowTime, addDays, diffDays, parseDate, isoDate,
  regraEfetiva, avaliar, alertaValidade, alertaAberto, limiteAberto,
  valorComparavel, descreverRegistro, fmtQtd,
};
