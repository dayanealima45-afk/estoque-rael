// Exportação em Excel e PDF
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { db } = require('./db');
const S = require('./service');
const R = require('./rules');

const ROXO = '7B08C0', AMARELO = 'FFF800';
const d = S.fmtData;
const LOGO = path.join(__dirname, '..', 'public', 'logo.jpeg');

function secaoEstoque() {
  return {
    titulo: 'Lista de estoque',
    colunas: ['Produto', 'Categoria', 'Unidade', 'Qtd/emb.', 'Estoque atual', 'Mínimo', 'Situação', 'Validade', 'Aberto em', 'Limite após aberto', 'Armazenamento', 'Observação'],
    larguras: [34, 16, 9, 8, 12, 7, 15, 11, 11, 13, 18, 20],
    linhas: S.listarProdutos().map(p => [
      p.nome, p.categoria, p.unidade, p.quantidade_embalagem ?? '', p.estoque_texto,
      p.regra_efetiva === 'minimo' ? p.minimo_efetivo : (p.regra_efetiva.startsWith('nivel') ? 'por nível' : '—'),
      p.situacao_texto, d(p.validade), d(p.data_abertura), d(p.data_limite_aberto), p.armazenamento || '', p.observacao || '',
    ]),
  };
}

function secaoCompras() {
  const l = S.listaCompras();
  const linha = (tipo) => (r) => [tipo, r.nome, r.categoria, r.estoque_texto, r.regra_efetiva === 'minimo' ? r.minimo_efetivo : (r.regra_efetiva.startsWith('nivel') ? 'por nível' : '—'), r.unidade, r.motivo || '', d(r.data_contagem || r.data_identificacao)];
  return {
    titulo: 'Lista de compras',
    colunas: ['Prioridade', 'Produto', 'Categoria', 'Atual/status', 'Mínimo', 'Unidade', 'Motivo', 'Data da contagem'],
    larguras: [16, 34, 16, 13, 9, 9, 34, 14],
    linhas: [...l.urgentes.map(linha('COMPRA URGENTE')), ...l.comprar.map(linha('COMPRAR'))],
  };
}

function secaoVencimentos() {
  const prods = S.listarProdutos();
  const linhas = [];
  for (const p of prods) {
    if (p.alerta_validade && p.alerta_validade.nivel !== 'normal') linhas.push([p.nome, p.categoria, 'Validade', d(p.validade), p.alerta_validade.texto, p.armazenamento || '']);
    if (p.alerta_aberto && p.alerta_aberto.nivel !== 'normal') linhas.push([p.nome, p.categoria, `Após aberto (${p.prazo_apos_aberto} dias, aberto em ${d(p.data_abertura)})`, d(p.data_limite_aberto), p.alerta_aberto.texto, p.armazenamento || '']);
  }
  return {
    titulo: 'Produtos próximos do vencimento',
    colunas: ['Produto', 'Categoria', 'Tipo', 'Data limite', 'Alerta', 'Armazenamento'],
    larguras: [34, 16, 34, 12, 26, 20],
    linhas,
  };
}

function secaoHistorico(countId) {
  const where = countId ? 'WHERE sc.id = ?' : "WHERE sc.status = 'finalizada'";
  const rows = db.prepare(`SELECT sc.id, sc.data, sc.hora, u.nome AS funcionaria, p.nome, p.categoria, p.unidade,
      i.quantidade, i.status, i.validade, i.data_abertura, i.data_limite_aberto, i.situacao, i.motivo, i.observacao
    FROM stock_counts sc JOIN users u ON u.id = sc.user_id
    JOIN stock_count_items i ON i.stock_count_id = sc.id JOIN products p ON p.id = i.product_id
    ${where} ORDER BY sc.data DESC, sc.id DESC, p.categoria, p.nome`).all(...(countId ? [countId] : []));
  return {
    titulo: countId ? `Contagem #${countId}` : 'Histórico de contagens',
    colunas: ['Data', 'Hora', 'Funcionária', 'Produto', 'Categoria', 'Contagem', 'Situação', 'Validade', 'Aberto em', 'Limite após aberto', 'Motivo', 'Observação'],
    larguras: [11, 7, 14, 34, 16, 12, 15, 11, 11, 13, 28, 24],
    linhas: rows.map(r => [d(r.data), r.hora, r.funcionaria, r.nome, r.categoria, R.descreverRegistro(r), S.SITUACAO_TXT[r.situacao] || '',
      d(r.validade), d(r.data_abertura), d(r.data_limite_aberto), r.motivo || '', r.observacao || '']),
  };
}

function secoes(tipo, opts = {}) {
  switch (tipo) {
    case 'estoque': return [secaoEstoque()];
    case 'compras': return [secaoCompras()];
    case 'vencimentos': return [secaoVencimentos()];
    case 'historico': return [secaoHistorico(opts.contagem)];
    case 'completo': return [secaoEstoque(), secaoCompras(), secaoVencimentos(), secaoHistorico()];
    default: throw new S.HttpError(400, 'Tipo de exportação inválido');
  }
}

async function excel(tipo, opts) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ESTOQUE RAEL SORVETES';
  for (const s of secoes(tipo, opts)) {
    const ws = wb.addWorksheet(s.titulo.slice(0, 31));
    ws.addRow([`ESTOQUE RAEL SORVETES — ${s.titulo}`]).font = { bold: true, size: 14, color: { argb: 'FF' + ROXO } };
    ws.addRow([`Gerado em ${d(R.today())} às ${R.nowTime()}`]);
    ws.addRow([]);
    const h = ws.addRow(s.colunas);
    h.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + ROXO } };
    });
    for (const l of s.linhas) ws.addRow(l);
    s.larguras.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: s.colunas.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function pdf(tipo, opts) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 56;
    let first = true;
    for (const s of secoes(tipo, opts)) {
      if (!first) doc.addPage();
      first = false;
      try { doc.image(LOGO, 28, 20, { height: 42 }); } catch { /* sem logo */ }
      doc.fillColor('#' + ROXO).font('Helvetica-Bold').fontSize(16).text('ESTOQUE RAEL SORVETES', 80, 24);
      doc.fillColor('#333').font('Helvetica').fontSize(11).text(`${s.titulo} — gerado em ${d(R.today())} às ${R.nowTime()}`, 80, 44);
      doc.moveTo(28, 68).lineTo(28 + W, 68).strokeColor('#' + AMARELO).lineWidth(3).stroke();
      let y = 78;
      const total = s.larguras.reduce((a, b) => a + b, 0);
      const ws = s.larguras.map(w => (w / total) * W);
      const fs = 7.5;
      const cab = () => {
        doc.rect(28, y, W, 16).fill('#' + ROXO);
        let x = 28;
        doc.fillColor('#fff').font('Helvetica-Bold').fontSize(fs);
        s.colunas.forEach((c, i) => { doc.text(c, x + 2, y + 4, { width: ws[i] - 4, height: 10, ellipsis: true }); x += ws[i]; });
        y += 16;
      };
      cab();
      if (!s.linhas.length) doc.fillColor('#555').font('Helvetica').fontSize(10).text('Nenhum registro.', 30, y + 6);
      s.linhas.forEach((l, idx) => {
        doc.font('Helvetica').fontSize(fs);
        const hs = l.map((v, i) => doc.heightOfString(String(v ?? ''), { width: ws[i] - 4 }));
        const hRow = Math.max(12, ...hs) + 4;
        if (y + hRow > doc.page.height - 30) { doc.addPage(); y = 28; cab(); doc.font('Helvetica').fontSize(fs); }
        if (idx % 2) doc.rect(28, y, W, hRow).fill('#F4EEF9');
        let x = 28;
        doc.fillColor('#222');
        l.forEach((v, i) => { doc.text(String(v ?? ''), x + 2, y + 3, { width: ws[i] - 4 }); x += ws[i]; });
        y += hRow;
      });
    }
    doc.end();
  });
}

module.exports = { excel, pdf };
