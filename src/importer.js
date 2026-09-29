// Importação da planilha Excel (aba de produtos + aba APÓS ABERTO)
const ExcelJS = require('exceljs');
const { db, tx } = require('./db');
const { chaveProduto, normalizar, melhorRegra, ehEspecial } = require('./matcher');
const { isoDate } = require('./rules');

function cellValue(cell) {
  let v = cell && cell.value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) v = v.richText.map(t => t.text).join('');
    else if ('result' in v) v = v.result;
    else if (v.text) v = v.text;
    else if (v.hyperlink) v = v.text || v.hyperlink;
  }
  return v;
}
function texto(v) {
  if (v == null) return '';
  if (v instanceof Date) return isoDate(utcToLocal(v));
  return String(v).replace(/\s+/g, ' ').trim();
}
// Datas do Excel chegam como meia-noite UTC
function utcToLocal(d) { return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
function dataIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isoDate(utcToLocal(v));
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d+(\.\d+)?$/.test(s)) { // número serial do Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(s)) * 86400000);
    return isoDate(utcToLocal(d));
  }
  return undefined; // inválida
}
function inteiro(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/\D+/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
// "COPO ... C/50 UND" -> 50
function qtdDoNome(nome) {
  const m = String(nome).match(/C\/\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function padroesNovoProduto(p) {
  const especial = ehEspecial(p.nome);
  const balde = p.unidade === 'BALDE';
  if (especial || balde) {
    return { regra_estoque: 'nivel', permite_aberto: 1, permite_quarto: 1, permite_zerado: 1 };
  }
  if (p.categoria === 'DESCARTÁVEIS') {
    return { regra_estoque: 'categoria', permite_aberto: 0, permite_quarto: 0, permite_zerado: 1 };
  }
  return { regra_estoque: 'categoria', permite_aberto: 1, permite_quarto: 0, permite_zerado: 1 };
}

function lerAbaProdutos(ws) {
  // Localiza a linha de cabeçalho: a que tem "Categoria"
  let headerRow = null;
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) {
      if (normalizar(texto(cellValue(row.getCell(c)))) === 'categoria') { headerRow = r; break; }
    }
    if (headerRow) break;
  }
  if (!headerRow) return null;
  const hdr = ws.getRow(headerRow);
  const cols = {};
  for (let c = 1; c <= hdr.cellCount; c++) {
    const h = normalizar(texto(cellValue(hdr.getCell(c))));
    if (!h) continue;
    if (/^(produto|nome)/.test(h) && !cols.nome) cols.nome = c;
    else if (h === 'tipo' || h.startsWith('unidade') || h === 'tipo de unidade') { if (!cols.unidade) cols.unidade = c; }
    else if (h.startsWith('quant')) { if (!cols.qtd) cols.qtd = c; }
    else if (h === 'categoria') cols.categoria = c;
    else if (h.startsWith('observa')) cols.obs = c;
    else if (h.startsWith('validade')) cols.validade = c;
  }
  if (!cols.nome) cols.nome = 1; // na planilha original a coluna do nome não tem título
  const linhas = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nome = texto(cellValue(row.getCell(cols.nome)));
    if (!nome) continue;
    linhas.push({
      linha: r,
      nome,
      categoria: cols.categoria ? texto(cellValue(row.getCell(cols.categoria))).toUpperCase() : '',
      unidade: cols.unidade ? texto(cellValue(row.getCell(cols.unidade))).toUpperCase() : '',
      qtd: cols.qtd ? inteiro(cellValue(row.getCell(cols.qtd))) : null,
      obs: cols.obs ? texto(cellValue(row.getCell(cols.obs))) : '',
      validade: cols.validade ? dataIso(cellValue(row.getCell(cols.validade))) : null,
    });
  }
  return linhas;
}

function lerAbaAposAberto(ws) {
  const regras = [];
  let start = 1;
  const first = normalizar(texto(cellValue(ws.getRow(1).getCell(1))));
  if (first.startsWith('produto')) start = 2;
  for (let r = start; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const produto = texto(cellValue(row.getCell(1)));
    const prazo = inteiro(texto(cellValue(row.getCell(2))));
    const armazenamento = texto(cellValue(row.getCell(3)));
    if (produto && prazo) regras.push({ produto, prazo, armazenamento });
  }
  return regras;
}

async function importarPlanilha(buffer, usuario) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  let linhas = null, regras = [];
  for (const ws of wb.worksheets) {
    const nomeAba = normalizar(ws.name);
    if (nomeAba.includes('aberto')) { regras = lerAbaAposAberto(ws); continue; }
    if (!linhas) linhas = lerAbaProdutos(ws);
  }
  if (!linhas) throw new Error('Não encontrei a aba de produtos (precisa ter uma coluna "Categoria").');

  const resumo = {
    novos: 0, atualizados: 0, duplicados: 0, erros: 0,
    mensagens_erro: [], categorias: [], unidades: [],
    regras_lidas: regras.length, regras_aplicadas: 0, regras_sem_produto: [], produtos_com_regra: [],
  };

  tx(() => {
    const existentes = new Map();
    for (const p of db.prepare('SELECT * FROM products').all()) existentes.set(chaveProduto(p.nome), p);
    const vistos = new Set();
    const cats = new Set(db.prepare('SELECT nome FROM categories').all().map(c => c.nome));
    const insCat = db.prepare("INSERT OR IGNORE INTO categories (nome, regra, estoque_minimo, ordem) VALUES (?, 'minimo', 3, 50)");
    const hist = db.prepare('INSERT INTO product_history (product_id, tipo_movimentacao, quantidade_anterior, quantidade_nova, usuario, observacao) VALUES (?, ?, ?, ?, ?, ?)');
    const unidades = new Set(), categorias = new Set();

    for (const l of linhas) {
      if (!l.categoria) { resumo.erros++; resumo.mensagens_erro.push(`Linha ${l.linha}: "${l.nome}" sem categoria`); continue; }
      if (!l.unidade) { resumo.erros++; resumo.mensagens_erro.push(`Linha ${l.linha}: "${l.nome}" sem tipo de unidade`); continue; }
      if (l.validade === undefined) { resumo.erros++; resumo.mensagens_erro.push(`Linha ${l.linha}: validade inválida em "${l.nome}"`); continue; }
      const chave = chaveProduto(l.nome);
      if (vistos.has(chave)) { resumo.duplicados++; continue; }
      vistos.add(chave);
      categorias.add(l.categoria); unidades.add(l.unidade);
      if (!cats.has(l.categoria)) { insCat.run(l.categoria); cats.add(l.categoria); }
      const qtd = l.qtd || qtdDoNome(l.nome);
      const atual = existentes.get(chave);
      if (atual) {
        const mud = {};
        if (atual.categoria !== l.categoria) mud.categoria = l.categoria;
        if (atual.unidade !== l.unidade) mud.unidade = l.unidade;
        if (qtd && atual.quantidade_embalagem !== qtd) mud.quantidade_embalagem = qtd;
        if (l.validade && atual.validade !== l.validade) mud.validade = l.validade;
        if (l.obs && atual.observacao !== l.obs) mud.observacao = l.obs;
        const ks = Object.keys(mud);
        if (!ks.length) { resumo.duplicados++; continue; }
        db.prepare(`UPDATE products SET ${ks.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
          .run(...ks.map(k => mud[k]), atual.id);
        hist.run(atual.id, 'importacao', null, null, usuario, 'Atualizado pela planilha: ' + ks.join(', '));
        resumo.atualizados++;
      } else {
        const d = padroesNovoProduto(l);
        const r = db.prepare(`INSERT INTO products (nome, categoria, unidade, quantidade_embalagem, validade, observacao,
            regra_estoque, permite_aberto, permite_quarto, permite_zerado) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(l.nome, l.categoria, l.unidade, qtd, l.validade, l.obs || null, d.regra_estoque, d.permite_aberto, d.permite_quarto, d.permite_zerado);
        hist.run(Number(r.lastInsertRowid), 'cadastro', null, null, usuario, 'Cadastrado pela importação da planilha');
        existentes.set(chave, { id: Number(r.lastInsertRowid), nome: l.nome });
        resumo.novos++;
      }
    }
    resumo.categorias = [...categorias];
    resumo.unidades = [...unidades];

    // Regras de prazo após aberto: só para insumos (evita casar "Casquinha" com guardanapo)
    if (regras.length) {
      const usadas = new Set();
      const insumos = db.prepare("SELECT id, nome, prazo_apos_aberto, armazenamento FROM products WHERE categoria = 'INSUMO'").all();
      const upd = db.prepare("UPDATE products SET prazo_apos_aberto = ?, armazenamento = ?, updated_at = datetime('now','localtime') WHERE id = ?");
      for (const p of insumos) {
        const r = melhorRegra(p.nome, regras);
        if (!r) continue;
        usadas.add(r.produto);
        resumo.produtos_com_regra.push({ produto: p.nome, regra: r.produto, prazo: r.prazo, armazenamento: r.armazenamento });
        if (p.prazo_apos_aberto !== r.prazo || p.armazenamento !== r.armazenamento) {
          upd.run(r.prazo, r.armazenamento, p.id);
          hist.run(p.id, 'regra_apos_aberto', p.prazo_apos_aberto != null ? `${p.prazo_apos_aberto} dias` : null, `${r.prazo} dias`, usuario, `Regra "${r.produto}" (${r.armazenamento})`);
          resumo.regras_aplicadas++;
        }
      }
      resumo.regras_sem_produto = regras.filter(r => !usadas.has(r.produto)).map(r => r.produto);
    }
    db.prepare('INSERT INTO audit_log (usuario, acao, detalhe) VALUES (?, ?, ?)')
      .run(usuario, 'importar_planilha', JSON.stringify({ novos: resumo.novos, atualizados: resumo.atualizados, duplicados: resumo.duplicados, erros: resumo.erros }));
  });
  return resumo;
}

module.exports = { importarPlanilha };
