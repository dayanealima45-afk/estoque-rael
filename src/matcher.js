// Correspondência aproximada entre nomes de produtos ("Nutella 3KG" <-> "Nutella (Nutella)")

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'e', 'c', 'com', 'para', 'ex', 'a', 'o']);

function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Chave para identificar duplicados (mesmo nome, ignorando acento/maiúscula/espaços)
function chaveProduto(nome) {
  return normalizar(nome).replace(/[^a-z0-9]+/g, ' ').trim();
}

function stem(w) {
  let s = w;
  if (s.length > 4 && s.endsWith('s')) s = s.slice(0, -1);
  if (s.length > 4 && /[ao]$/.test(s)) s = s.slice(0, -1);
  return s;
}

function palavras(s) {
  return normalizar(s)
    .replace(/[^a-z0-9 ]+/g, '')
    .split(' ')
    .filter(w => w && !STOP.has(w));
}

// Palavras do nome da regra: remove o que está entre parênteses ("(ex: Fini)", "(bala)")
function tokensRegra(nomeRegra) {
  return palavras(String(nomeRegra).replace(/\([^)]*\)/g, ' ')).map(stem);
}

// Palavras do produto, incluindo junções de palavras vizinhas ("kit kat" -> "kitkat")
function tokensProduto(nomeProduto) {
  const ws = palavras(String(nomeProduto).replace(/[()]/g, ' '));
  const out = new Set(ws.map(stem));
  for (let i = 0; i < ws.length - 1; i++) out.add(stem(ws[i] + ws[i + 1]));
  return [...out];
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function tokenBate(t, lista) {
  return lista.some(p => p === t || (t.length >= 6 && p.length >= 6 && lev(t, p) <= 1));
}

/**
 * Para um produto, encontra a regra que melhor corresponde (todas as palavras da regra
 * precisam existir no nome do produto; vence a regra com mais palavras).
 */
function melhorRegra(nomeProduto, regras) {
  const tp = tokensProduto(nomeProduto);
  let best = null, bestScore = 0;
  for (const r of regras) {
    const tr = tokensRegra(r.produto);
    if (!tr.length) continue;
    if (tr.every(t => tokenBate(t, tp)) && tr.length > bestScore) {
      best = r; bestScore = tr.length;
    }
  }
  return best;
}

// Produtos com regra especial de reposição por nível (seção 9 do pedido)
const ESPECIAIS = ['Nutella', 'Creme de Ovomaltine', 'Kit Kat Pasta', 'Doce de Leite Pasta'];
function ehEspecial(nomeProduto) {
  return !!melhorRegra(nomeProduto, ESPECIAIS.map(produto => ({ produto })));
}

module.exports = { normalizar, chaveProduto, melhorRegra, ehEspecial, tokensRegra, tokensProduto };
