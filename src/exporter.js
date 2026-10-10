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

const minimoTxt = p => (p.regra_efetiva === 'minimo' ? p.minimo_efetivo : (p.regra_efetiva.startsWith('nivel') ? 'por nível' : '—'));
const juntar = partes => partes.filter(Boolean).join(' · ');

// Cada seção tem as colunas do Excel (linha completa) e um layout próprio para o PDF,
// que agrupa por categoria e mostra os campos secundários numa linha de detalhe.
function secaoEstoque() {
  const itens = S.listarProdutos();
  return {
    titulo: 'Lista de estoque',
    colunas: ['Produto', 'Categoria', 'Unidade', 'Qtd/emb.', 'Estoque atual', 'Mínimo', 'Situação', 'Validade', 'Aberto em', 'Limite após aberto', 'Armazenamento', 'Observação'],
    larguras: [34, 16, 9, 8, 12, 7, 15, 11, 11, 13, 18, 20],
    itens,
    linha: p => [
      p.nome, p.categoria, p.unidade, p.quantidade_embalagem ?? '', p.estoque_texto, minimoTxt(p),
      p.situacao_texto, d(p.validade), d(p.data_abertura), d(p.data_limite_aberto), p.armazenamento || '', p.observacao || '',
    ],
    pdf: {
      colunas: ['Produto', 'Unidade', 'Estoque', 'Mínimo', 'Situação', 'Validade'],
      larguras: [38, 11, 13, 9, 17, 12],
      linha: p => [p.nome, p.unidade, p.estoque_texto || '—', minimoTxt(p), p.situacao_texto, d(p.validade) || '—'],
      detalhe: p => juntar([
        p.data_abertura && `Aberto em ${d(p.data_abertura)}, usar até ${d(p.data_limite_aberto)}`,
        p.armazenamento && `Armazenamento: ${p.armazenamento}`,
        p.observacao && `Obs.: ${p.observacao}`,
      ]),
    },
  };
}

function secaoCompras() {
  const l = S.listaCompras();
  const itens = [...l.urgentes.map(r => ({ ...r, tipo: 'COMPRA URGENTE' })), ...l.comprar.map(r => ({ ...r, tipo: 'COMPRAR' }))];
  return {
    titulo: 'Lista de compras',
    colunas: ['Prioridade', 'Produto', 'Categoria', 'Atual/status', 'Mínimo', 'Unidade', 'Motivo', 'Data da contagem'],
    larguras: [16, 34, 16, 13, 9, 9, 34, 14],
    itens,
    linha: r => [r.tipo, r.nome, r.categoria, r.estoque_texto, minimoTxt(r), r.unidade, r.motivo || '', d(r.data_contagem || r.data_identificacao)],
    pdf: {
      colunas: ['Prioridade', 'Produto', 'Atual', 'Mínimo', 'Unidade'],
      larguras: [19, 40, 14, 11, 11],
      linha: r => [r.tipo, r.nome, r.estoque_texto || '—', minimoTxt(r), r.unidade],
      detalhe: r => juntar([r.motivo && `Motivo: ${r.motivo}`, `Contagem de ${d(r.data_contagem || r.data_identificacao)}`]),
    },
  };
}

function secaoVencimentos() {
  const itens = [];
  for (const p of S.listarProdutos()) {
    if (p.alerta_validade && p.alerta_validade.nivel !== 'normal') itens.push({ ...p, tipo: 'Validade', limite: p.validade, alerta: p.alerta_validade.texto });
    if (p.alerta_aberto && p.alerta_aberto.nivel !== 'normal') itens.push({ ...p, tipo: `Após aberto (${p.prazo_apos_aberto} dias, aberto em ${d(p.data_abertura)})`, limite: p.data_limite_aberto, alerta: p.alerta_aberto.texto });
  }
  return {
    titulo: 'Produtos próximos do vencimento',
    colunas: ['Produto', 'Categoria', 'Tipo', 'Data limite', 'Alerta', 'Armazenamento'],
    larguras: [34, 16, 34, 12, 26, 20],
    itens,
    linha: v => [v.nome, v.categoria, v.tipo, d(v.limite), v.alerta, v.armazenamento || ''],
    pdf: {
      colunas: ['Produto', 'Tipo', 'Data limite', 'Alerta'],
      larguras: [36, 28, 14, 22],
      linha: v => [v.nome, v.tipo, d(v.limite), v.alerta],
      detalhe: v => (v.armazenamento ? `Armazenamento: ${v.armazenamento}` : ''),
    },
  };
}

function secaoHistorico(countId) {
  const where = countId ? 'WHERE sc.id = ?' : "WHERE sc.status = 'finalizada'";
  const itens = db.prepare(`SELECT sc.id, sc.data, sc.hora, u.nome AS funcionaria, p.nome, p.categoria, p.unidade,
      i.quantidade, i.status, i.validade, i.data_abertura, i.data_limite_aberto, i.situacao, i.motivo, i.observacao
    FROM stock_counts sc JOIN users u ON u.id = sc.user_id
    JOIN stock_count_items i ON i.stock_count_id = sc.id JOIN products p ON p.id = i.product_id
    ${where} ORDER BY sc.data DESC, sc.id DESC, p.categoria, p.nome`).all(...(countId ? [countId] : []));
  return {
    titulo: countId ? `Contagem #${countId}` : 'Histórico de contagens',
    colunas: ['Data', 'Hora', 'Funcionária', 'Produto', 'Categoria', 'Contagem', 'Situação', 'Validade', 'Aberto em', 'Limite após aberto', 'Motivo', 'Observação'],
    larguras: [11, 7, 14, 34, 16, 12, 15, 11, 11, 13, 28, 24],
    itens,
    linha: r => [d(r.data), r.hora, r.funcionaria, r.nome, r.categoria, R.descreverRegistro(r), S.SITUACAO_TXT[r.situacao] || '',
      d(r.validade), d(r.data_abertura), d(r.data_limite_aberto), r.motivo || '', r.observacao || ''],
    pdf: {
      grupo: r => `Contagem de ${d(r.data)} às ${r.hora} — ${r.funcionaria}`,
      colunas: ['Produto', 'Contagem', 'Situação', 'Validade'],
      larguras: [42, 18, 22, 14],
      linha: r => [r.nome, `${R.descreverRegistro(r)} ${r.quantidade != null ? r.unidade : ''}`.trim(), S.SITUACAO_TXT[r.situacao] || '', d(r.validade) || '—'],
      detalhe: r => juntar([
        r.data_abertura && `Aberto em ${d(r.data_abertura)}, usar até ${d(r.data_limite_aberto)}`,
        r.situacao !== 'ok' && r.motivo && `Motivo: ${r.motivo}`,
        r.observacao && `Obs.: ${r.observacao}`,
      ]),
    },
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
    for (const it of s.itens) ws.addRow(s.linha(it));
    s.larguras.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: s.colunas.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Fonte do PDF: Arial se o servidor tiver; senão Liberation Sans, que tem as mesmas medidas da Arial
const fs = require('fs');
const FONTES = [
  ['/usr/share/fonts/truetype/msttcorefonts/Arial.ttf', '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf'],
  ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf'],
  ['/Library/Fonts/Arial.ttf', '/Library/Fonts/Arial Bold.ttf'],
  [path.join(__dirname, '..', 'assets', 'fonts', 'LiberationSans-Regular.ttf'), path.join(__dirname, '..', 'assets', 'fonts', 'LiberationSans-Bold.ttf')],
];
const [FONTE, FONTE_NEGRITO] = FONTES.find(([a, b]) => fs.existsSync(a) && fs.existsSync(b)) || ['Helvetica', 'Helvetica-Bold'];

const TAM = 14;          // tamanho do texto pedido: Arial 14
const M = 30;            // margem

function ordemCategorias() {
  const cats = require('./db').getCategories();
  return new Map(cats.map((c, i) => [c.nome, i]));
}

function pdf(tipo, opts) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: M, bufferPages: true });
    doc.registerFont('texto', FONTE);
    doc.registerFont('negrito', FONTE_NEGRITO);
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 2 * M;
    const BAIXO = doc.page.height - M - 18;
    const ordem = ordemCategorias();
    let y;

    const cabecalhoPagina = (titulo, continuacao) => {
      try { doc.image(LOGO, M, 18, { height: 46 }); } catch { /* sem logo */ }
      doc.fillColor('#' + ROXO).font('negrito').fontSize(20).text('ESTOQUE RAEL SORVETES', M + 58, 20, { lineBreak: false });
      doc.fillColor('#333').font('texto').fontSize(TAM)
        .text(`${titulo}${continuacao ? ' (continuação)' : ''} — gerado em ${d(R.today())} às ${R.nowTime()}`, M + 58, 46, { lineBreak: false });
      doc.moveTo(M, 72).lineTo(M + W, 72).strokeColor('#' + AMARELO).lineWidth(3).stroke();
      y = 82;
    };

    let first = true;
    for (const s of secoes(tipo, opts)) {
      const P = s.pdf;
      const total = P.larguras.reduce((a, b) => a + b, 0);
      const ws = P.larguras.map(w => (w / total) * W);
      if (!first) doc.addPage();
      first = false;
      cabecalhoPagina(s.titulo, false);
      const novaPagina = () => { doc.addPage(); cabecalhoPagina(s.titulo, true); };

      const cabTabela = () => {
        doc.font('negrito').fontSize(TAM);
        const h = Math.max(...P.colunas.map((c, i) => doc.heightOfString(c, { width: ws[i] - 8 }))) + 8;
        doc.rect(M, y, W, h).fill('#EDE3F6');
        let x = M;
        doc.fillColor('#' + ROXO);
        P.colunas.forEach((c, i) => { doc.text(c, x + 4, y + 4, { width: ws[i] - 8 }); x += ws[i]; });
        y += h;
      };
      const tituloCategoria = (cat, n, cont) => {
        if (y + 34 + 60 > BAIXO) novaPagina();
        doc.rect(M, y, W, 26).fill('#' + ROXO);
        doc.fillColor('#fff').font('negrito').fontSize(TAM + 2)
          .text(`${cat}${cont ? ' (continuação)' : ''}`, M + 8, y + 5, { lineBreak: false });
        doc.fillColor('#' + AMARELO).text(`${n} ${n === 1 ? 'item' : 'itens'}`, M, y + 5, { width: W - 8, align: 'right', lineBreak: false });
        y += 26;
        cabTabela();
      };
      const tituloGrupo = g => {
        if (y + 30 + 100 > BAIXO) novaPagina();
        y += 6;
        doc.fillColor('#' + ROXO).font('negrito').fontSize(TAM + 2).text(g, M, y, { width: W });
        y = doc.y + 6;
      };

      if (!s.itens.length) {
        doc.fillColor('#555').font('texto').fontSize(TAM).text('Nenhum registro.', M, y + 8);
        continue;
      }

      // Agrupa (por contagem, quando houver) e depois por categoria, na ordem configurada
      const grupos = [];
      for (const it of s.itens) {
        const g = P.grupo ? P.grupo(it) : '';
        let G = grupos.find(x => x.nome === g);
        if (!G) grupos.push(G = { nome: g, cats: new Map() });
        if (!G.cats.has(it.categoria)) G.cats.set(it.categoria, []);
        G.cats.get(it.categoria).push(it);
      }
      for (const G of grupos) {
        if (G.nome) tituloGrupo(G.nome);
        const cats = [...G.cats.keys()].sort((a, b) => (ordem.get(a) ?? 99) - (ordem.get(b) ?? 99) || a.localeCompare(b, 'pt-BR'));
        for (const cat of cats) {
          const lista = G.cats.get(cat);
          tituloCategoria(cat, lista.length, false);
          lista.forEach((it, idx) => {
            const cel = P.linha(it).map(v => String(v ?? ''));
            const det = P.detalhe ? P.detalhe(it) : '';
            doc.font('texto').fontSize(TAM);
            const hCel = Math.max(...cel.map((v, i) => doc.heightOfString(v, { width: ws[i] - 8 })));
            const hDet = det ? doc.heightOfString(det, { width: W - 24 }) + 2 : 0;
            const hRow = hCel + hDet + 10;
            if (y + hRow > BAIXO) { novaPagina(); tituloCategoria(cat, lista.length, true); }
            if (idx % 2) doc.rect(M, y, W, hRow).fill('#F7F2FB');
            let x = M;
            doc.fillColor('#222').font('texto').fontSize(TAM);
            cel.forEach((v, i) => {
              doc.font(i === 0 ? 'negrito' : 'texto').text(v, x + 4, y + 5, { width: ws[i] - 8 });
              x += ws[i];
            });
            if (det) doc.fillColor('#555').font('texto').fontSize(TAM).text(det, M + 16, y + 5 + hCel + 2, { width: W - 24 });
            doc.moveTo(M, y + hRow).lineTo(M + W, y + hRow).strokeColor('#E6E1EC').lineWidth(0.5).stroke();
            y += hRow;
          });
          y += 12;
        }
      }
    }
    // Número de página no rodapé
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;
      doc.fillColor('#888').font('texto').fontSize(10)
        .text(`Página ${i + 1} de ${range.count}`, M, doc.page.height - M - 10, { width: W, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { excel, pdf };
