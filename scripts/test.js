// Teste de ponta a ponta: sobe o servidor com um banco temporário e percorre os cenários pedidos.
// Uso: npm test
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rael-teste-'));
process.env.DB_FILE = path.join(tmp, 'teste.db');
process.env.TZ = 'America/Sao_Paulo';

const { app, carregarPlanilhaInicial } = require('../server');
const R = require('../src/rules');

let base;
const ok = [];
function passo(nome) { ok.push(nome); console.log('  ✓', nome); }

function cliente() {
  let cookie = '';
  return async function req(metodo, url, body) {
    const r = await fetch(base + url, {
      method: metodo,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
}

async function main() {
  await carregarPlanilhaInicial();
  const srv = app.listen(0);
  base = `http://127.0.0.1:${srv.address().port}`;
  const adm = cliente(), vit = cliente(), tais = cliente();

  // 13. Login da administradora
  let r = await adm('POST', '/api/login', { login: 'admin', senha: 'errada' });
  assert.equal(r.status, 401);
  r = await adm('POST', '/api/login', { login: 'admin', senha: 'rael2026' });
  assert.equal(r.status, 200); assert.equal(r.data.perfil, 'admin');
  passo('13. Login da administradora (e senha errada recusada)');

  let prods = (await adm('GET', '/api/products')).data;
  assert.equal(prods.length, 99);
  const P = nome => prods.find(p => p.nome === nome);
  for (const n of ['NUTELLA 3KG', 'CREME DE OVOMALTINE', 'KIT KAT PASTA 1KG', 'DOCE DE LEITE PASTA 950G', 'MORANGO', 'KIWI']) assert.ok(P(n), n);
  assert.equal(P('NUTELLA 3KG').prazo_apos_aberto, 30); assert.equal(P('NUTELLA 3KG').armazenamento, 'Seco');
  assert.equal(P('KIT KAT PASTA 1KG').prazo_apos_aberto, 30);
  assert.equal(P('DOCE DE LEITE PASTA 950G').prazo_apos_aberto, 7);
  assert.equal(P('MORANGO').prazo_apos_aberto, 2); assert.equal(P('KIWI').prazo_apos_aberto, 3);
  assert.equal(P('CHANTILLY').prazo_apos_aberto, 3); assert.equal(P('CHANTILLY').armazenamento, 'Refrigerado');
  assert.equal(P('COPO MK 330 ML ULTRACOPOS C/50 UND').quantidade_embalagem, 50);
  passo('Carga inicial da planilha: 99 produtos, regras APÓS ABERTO relacionadas (Nutella, Kit Kat pasta, Doce de leite, Morango, Kiwi)');

  // 1. Cadastro de produto
  r = await adm('POST', '/api/products', { nome: 'PRODUTO DE TESTE', categoria: 'INSUMO', unidade: 'PACOTE', estoque_minimo: 2 });
  assert.equal(r.status, 200); const teste = r.data;
  r = await adm('POST', '/api/products', { nome: 'produto de teste ', categoria: 'INSUMO', unidade: 'PACOTE' });
  assert.equal(r.status, 400, 'não pode duplicar');
  r = await adm('PUT', `/api/products/${teste.id}`, { estoque_minimo: 5 });
  assert.equal(r.data.minimo_efetivo, 5);
  r = await adm('DELETE', `/api/products/${teste.id}?definitivo=1`);
  assert.equal(r.data.excluido, true);
  passo('1. Cadastro, edição, bloqueio de duplicado e exclusão de produto');

  // 2. Login da funcionária
  r = await adm('POST', '/api/users', { nome: 'Vitória', login: 'vitoria', senha: '1234', perfil: 'funcionaria' });
  assert.equal(r.status, 200);
  await adm('POST', '/api/users', { nome: 'Taís', login: 'tais', senha: '1234', perfil: 'funcionaria' });
  r = await vit('POST', '/api/login', { login: 'vitoria', senha: '1234' });
  assert.equal(r.data.perfil, 'funcionaria');
  await tais('POST', '/api/login', { login: 'tais', senha: '1234' });
  r = await vit('POST', '/api/products', { nome: 'X', categoria: 'INSUMO', unidade: 'UND' });
  assert.equal(r.status, 403);
  r = await vit('PUT', '/api/config', { settings: { alerta_validade_dias: 1 } });
  assert.equal(r.status, 403);
  r = await vit('GET', '/api/purchases');
  assert.equal(r.status, 403);
  passo('2. Login da funcionária; ela não consegue alterar produtos, regras nem ver compras');

  // 3. Contagem
  r = await vit('POST', '/api/counts/start');
  const c1 = r.data.id;
  r = await vit('POST', '/api/counts/start');
  assert.equal(r.data.id, c1, 'retoma a mesma contagem');
  r = await tais('GET', `/api/counts/${c1}`);
  assert.equal(r.status, 403, 'outra funcionária não vê');
  const salvar = (cli, cid, nome, body) => cli('PUT', `/api/counts/${cid}/items/${P(nome).id}`, body);

  // 6. Descartáveis < 3
  const copos = ['COPO MK 330 ML ULTRACOPOS C/50 UND', 'COPO MK 400 ML ULTRACOPOS C/50 UND', 'COPO MK 500 ML ULTRACOPOS C/50 UND', 'COPO PARA AGUA C/100 UND', 'COPO PARA CAFE C/100 UND'];
  const esperadoQtd = ['urgente', 'comprar', 'comprar', 'ok', 'ok'];
  for (let q = 0; q <= 4; q++) {
    r = await salvar(vit, c1, copos[q], { quantidade: q });
    assert.equal(r.data.situacao, esperadoQtd[q], `${copos[q]} = ${q}`);
  }
  r = await salvar(vit, c1, 'COPO SUNDAE C/50 UND', { quantidade: 12 });
  assert.equal(r.data.situacao, 'ok', 'aceita mais de 10');
  passo('6. Descartáveis: 0 → urgente, 1 e 2 → comprar, 3 e 4 → adequado; aceita quantidade acima de 10');

  // 7. Insumos < 3
  const ins = ['GRANOLA 1KG', 'NEGRESCO 1KG', 'SUCRILIOS', 'FARINHA LACTEA'];
  const espIns = ['urgente', 'comprar', 'comprar', 'ok'];
  for (let q = 0; q <= 3; q++) {
    r = await salvar(vit, c1, ins[q], { quantidade: q });
    assert.equal(r.data.situacao, espIns[q], `${ins[q]} = ${q}`);
  }
  r = await salvar(vit, c1, 'GOTAS DE CHOCOLATE', { quantidade: 4, status: 'aberto' });
  assert.equal(r.data.situacao, 'ok', 'insumo aberto com estoque não compra');
  passo('7. Insumos: 0 → urgente, 1 e 2 → comprar, 3 → adequado; aberto com estoque não compra');

  // 8. Baldes
  r = await salvar(vit, c1, 'CALDA DE MORANGO 4KG', { status: 'aberto' });
  assert.equal(r.data.situacao, 'ok', 'balde aberto não é vazio');
  r = await salvar(vit, c1, 'CALDA DE MARACUJA 1KG', { status: 'quarto' });
  assert.equal(r.data.situacao, 'comprar');
  r = await salvar(vit, c1, 'TRUFA SUNDAE CHOCOLATE 4KG', { status: 'zerado' });
  assert.equal(r.data.situacao, 'urgente');
  r = await salvar(vit, c1, 'CREME DE COOKIES PRETO', { status: 'cheio', quantidade: 2 });
  assert.equal(r.data.situacao, 'ok');
  passo('8. Baldes: aberto → adequado, 1/4 → comprar, zerado → urgente, cheio → adequado');

  // 9. Nutella e cremes
  r = await salvar(vit, c1, 'NUTELLA 3KG', { status: 'aberto', data_abertura: '2026-09-29' });
  assert.equal(r.data.situacao, 'ok', 'Nutella aberta não compra');
  assert.equal(r.data.item.data_limite_aberto, '2026-10-29');
  r = await salvar(vit, c1, 'CREME DE OVOMALTINE', { status: 'quarto' });
  assert.equal(r.data.situacao, 'comprar');
  r = await salvar(vit, c1, 'KIT KAT PASTA 1KG', { status: 'zerado' });
  assert.equal(r.data.situacao, 'urgente');
  r = await salvar(vit, c1, 'DOCE DE LEITE PASTA 950G', { status: 'cheio' });
  assert.equal(r.data.situacao, 'ok');
  r = await salvar(vit, c1, 'COPO MK 330 ML ULTRACOPOS C/50 UND', { status: 'quarto' });
  assert.equal(r.status, 400, 'descartável não aceita 1/4');
  passo('9. Nutella e cremes: aberto → adequado, 1/4 → comprar, zerado → urgente; Nutella aberta 29/09 com 30 dias → limite 29/10/2026');

  // 10. Validade
  const hoje = R.today();
  r = await salvar(vit, c1, 'CEREJA', { quantidade: 5, validade: R.addDays(hoje, -2) });
  const s = { alerta_validade_dias: 7, alerta_aberto_dias: 3 };
  assert.equal(R.alertaValidade(r.data.item.validade, s).nivel, 'vencido');
  r = await salvar(vit, c1, 'CHANTILLY', { quantidade: 4, validade: R.addDays(hoje, 5), data_abertura: R.addDays(hoje, -2) });
  assert.equal(R.alertaValidade(r.data.item.validade, s).nivel, 'proximo');
  // 11. Prazo após aberto (chantilly 3 dias, aberto há 2 → atenção; morango 2 dias aberto há 3 → expirado)
  assert.equal(R.alertaAberto(r.data.item.data_abertura, 3, s).nivel, 'atencao');
  r = await salvar(vit, c1, 'MORANGO', { quantidade: 3, data_abertura: R.addDays(hoje, -3) });
  assert.equal(r.data.item.data_limite_aberto, R.addDays(hoje, -1));
  r = await salvar(vit, c1, 'LEITE LIQUIDO', { quantidade: 6, observacao: 'Último pacote' });
  assert.equal(r.data.situacao, 'ok');

  // 4. Finalização
  r = await vit('POST', `/api/counts/${c1}/finalize`, { observacao: 'Contagem de teste' });
  assert.equal(r.data.precisaConfirmar, true);
  const faltam = r.data.nao_contados;
  assert.ok(faltam > 0);
  r = await vit('POST', `/api/counts/${c1}/finalize`, { observacao: 'Contagem de teste', forcar: true });
  assert.equal(r.data.finalizada, true);
  assert.equal(r.data.nao_contados, faltam);
  r = await salvar(vit, c1, 'GRANOLA 1KG', { quantidade: 9 });
  assert.equal(r.status, 403, 'funcionária não altera contagem finalizada');
  passo(`4. Finalização: avisou ${faltam} produtos sem contagem, finalizou mesmo assim e bloqueou edição da funcionária`);

  // 18. Aviso para a administradora
  let dash = (await adm('GET', '/api/dashboard')).data;
  assert.equal(dash.avisos[0].titulo, 'Nova contagem concluída');
  assert.equal(dash.avisos[0].dados.funcionaria, 'Vitória');
  assert.equal(dash.urgentes, 4);
  passo('Aviso "Nova contagem concluída" no painel da administradora');

  // 5. Lista de compras
  let compras = (await adm('GET', '/api/purchases')).data;
  const nomesUrg = compras.urgentes.map(x => x.nome).sort();
  assert.deepEqual(nomesUrg, ['COPO MK 330 ML ULTRACOPOS C/50 UND', 'GRANOLA 1KG', 'KIT KAT PASTA 1KG', 'TRUFA SUNDAE CHOCOLATE 4KG']);
  assert.ok(!compras.urgentes.some(x => x.nome === 'NUTELLA 3KG'));
  assert.ok(!compras.comprar.some(x => x.nome === 'NUTELLA 3KG'), 'Nutella aberta fora da lista');
  assert.ok(!compras.comprar.some(x => x.nome === 'CALDA DE MORANGO 4KG'), 'Balde aberto fora da lista');
  const nomesComp = compras.comprar.map(x => x.nome);
  for (const n of ['COPO MK 400 ML ULTRACOPOS C/50 UND', 'COPO MK 500 ML ULTRACOPOS C/50 UND', 'NEGRESCO 1KG', 'SUCRILIOS', 'CALDA DE MARACUJA 1KG', 'CREME DE OVOMALTINE']) assert.ok(nomesComp.includes(n), n);
  passo(`5. Lista de compras gerada: ${compras.urgentes.length} urgentes, ${compras.comprar.length} para comprar`);

  // 14. Marcar como comprado e desfazer
  const alvo = compras.urgentes.find(x => x.nome === 'GRANOLA 1KG');
  r = await adm('POST', `/api/purchases/${alvo.id}/comprar`);
  assert.equal(r.status, 200);
  compras = (await adm('GET', '/api/purchases')).data;
  assert.ok(!compras.urgentes.some(x => x.id === alvo.id));
  const feito = compras.comprados.find(x => x.id === alvo.id);
  assert.equal(feito.comprado_por_nome, 'Administradora'); assert.ok(feito.data_compra);
  r = await adm('POST', `/api/purchases/${alvo.id}/desfazer`);
  compras = (await adm('GET', '/api/purchases')).data;
  assert.ok(compras.urgentes.some(x => x.id === alvo.id));
  await adm('POST', `/api/purchases/${alvo.id}/comprar`);
  passo('14. Marcar como comprado (data e usuária registradas), sair da lista e desfazer compra');

  // Correção pela administradora
  r = await adm('PUT', `/api/counts/${c1}/items/${P('NEGRESCO 1KG').id}`, { quantidade: 4 });
  assert.equal(r.status, 200); assert.equal(r.data.situacao, 'ok');
  compras = (await adm('GET', '/api/purchases')).data;
  assert.ok(!compras.comprar.some(x => x.nome === 'NEGRESCO 1KG'), 'correção tira da lista');
  passo('Administradora corrigiu uma contagem finalizada e a lista de compras foi atualizada');

  // Segunda contagem (Taís) para histórico e comparação
  r = await tais('POST', '/api/counts/start'); const c2 = r.data.id;
  await salvar(tais, c2, 'COPO MK 330 ML ULTRACOPOS C/50 UND', { quantidade: 6 });   // aumentou, saiu das compras
  await salvar(tais, c2, 'COPO PARA AGUA C/100 UND', { quantidade: 0 });            // zerou
  await salvar(tais, c2, 'COPO PARA CAFE C/100 UND', { quantidade: 2 });            // diminuiu, entrou em baixo
  await salvar(tais, c2, 'NUTELLA 3KG', { status: 'quarto', data_abertura: '2026-09-29' }); // entrou na compra
  r = await tais('POST', `/api/counts/${c2}/finalize`, { forcar: true });
  assert.equal(r.data.finalizada, true);

  // 12. Histórico
  r = await adm('GET', '/api/counts');
  assert.equal(r.data.length, 2);
  assert.deepEqual(r.data.map(c => c.funcionaria).sort(), ['Taís', 'Vitória']);
  r = await vit('GET', '/api/counts');
  assert.equal(r.data.length, 1, 'funcionária vê só as dela');
  r = await adm('GET', `/api/counts/${c1}`);
  assert.equal(r.data.itens[P('LEITE LIQUIDO').id].observacao, 'Último pacote');
  assert.equal(r.data.itens[P('CEREJA').id].validade, R.addDays(hoje, -2));
  r = await adm('GET', `/api/counts/compare?a=${c1}&b=${c2}`);
  const L = n => r.data.linhas.find(l => l.nome === n).indicadores;
  assert.ok(L('COPO MK 330 ML ULTRACOPOS C/50 UND').includes('aumentou'));
  assert.ok(L('COPO MK 330 ML ULTRACOPOS C/50 UND').includes('saiu_compras'));
  assert.ok(L('COPO PARA AGUA C/100 UND').includes('zerou'));
  assert.ok(L('COPO PARA CAFE C/100 UND').includes('diminuiu'));
  assert.ok(L('COPO PARA CAFE C/100 UND').includes('entrou_baixo'));
  assert.ok(L('NUTELLA 3KG').includes('entrou_baixo'));
  r = await adm('GET', `/api/products/${P('NUTELLA 3KG').id}/history`);
  assert.ok(r.data.some(h => h.tipo_movimentacao === 'contagem' && h.usuario === 'Taís'));
  passo('12. Histórico: contagens por funcionária, detalhe com observação/validade, comparação e histórico do produto');

  dash = (await adm('GET', '/api/dashboard')).data;
  assert.ok(dash.vencimentos.some(p => p.nome === 'CEREJA'));
  assert.ok(dash.apos_aberto.some(p => p.nome === 'MORANGO' && p.alerta_aberto.nivel === 'expirado'));
  assert.ok(dash.apos_aberto.some(p => p.nome === 'CHANTILLY' && p.alerta_aberto.nivel === 'atencao'));
  passo('10. Validade: vencido e próximo do vencimento aparecem no painel');
  passo('11. Prazo após aberto: limite calculado, ATENÇÃO e EXPIRADO no painel');

  // Regras configuráveis
  r = await adm('PUT', '/api/config', { settings: { alerta_validade_dias: 10 }, categorias: [{ nome: 'DESCARTÁVEIS', regra: 'minimo', estoque_minimo: 5 }] });
  assert.equal(r.data.settings.alerta_validade_dias, 10);
  await adm('PUT', `/api/products/${P('CALDA DE MORANGO 4KG').id}`, { regra_estoque: 'nivel_aberto' });
  r = await tais('POST', '/api/counts/start'); const c3 = r.data.id;
  r = await salvar(tais, c3, 'COPO MK 330 ML ULTRACOPOS C/50 UND', { quantidade: 4 });
  assert.equal(r.data.situacao, 'comprar', 'novo mínimo 5 da categoria');
  r = await salvar(tais, c3, 'CALDA DE MORANGO 4KG', { status: 'aberto' });
  assert.equal(r.data.situacao, 'comprar', 'balde com regra "aberto já compra"');
  await adm('DELETE', `/api/counts/${c3}`);
  passo('Regras configuráveis: mínimo por categoria e regra de balde por produto mudam sem mexer no código');

  // Exportação e importação
  for (const t of ['estoque', 'historico', 'compras', 'vencimentos', 'completo']) {
    let e = await adm('GET', `/api/export/${t}?formato=xlsx`);
    assert.equal(e.status, 200); assert.equal(e.data.slice(0, 2).toString(), 'PK');
    e = await adm('GET', `/api/export/${t}?formato=pdf`);
    assert.equal(e.status, 200); assert.equal(e.data.slice(0, 4).toString(), '%PDF');
    assert.ok(/Arial|LiberationSans/.test(e.data.toString('latin1')), 'PDF usa Arial (ou Liberation Sans, mesmas medidas)');
    if (process.env.SALVAR_PDF) fs.writeFileSync(path.join(process.env.SALVAR_PDF, `${t}.pdf`), e.data);
  }
  const planilha = fs.readFileSync(path.join(__dirname, '..', 'data', 'planilha-inicial.xlsx'));
  const imp = await fetch(base + '/api/import', { method: 'POST', body: planilha, headers: { 'Content-Type': 'application/octet-stream', Cookie: '' } });
  assert.equal(imp.status, 401, 'importar exige login');
  passo('Exportação em Excel e PDF dos 5 relatórios');

  srv.close();
  console.log(`\nTodos os ${ok.length} testes passaram.`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch(e => { console.error('\nFALHOU:', e); process.exit(1); });
