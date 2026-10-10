'use strict';
/* ESTOQUE RAEL SORVETES — aplicação web (sem build, JavaScript puro) */

// ============================================================ utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtData = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const fmtDataHora = s => (s ? `${fmtData(s)} ${s.slice(11, 16)}` : '');
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtNum = n => (n == null || n === '' ? '' : String(n).replace('.', ','));

const st = { user: null, boot: null, produtos: null };

const ICONES = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9z"/><path d="M9 11h6M9 15h4"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h12L22 7H6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  data: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  compare: '<path d="M8 3v18M16 3v18"/><path d="m4 7 4-4 4 4M12 17l4 4 4-4"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
};
const ic = (n, extra = '') => `<svg class="icon" viewBox="0 0 24 24" ${extra}>${ICONES[n] || ''}</svg>`;

const NIVEL_TXT = { cheio: 'Cheio', aberto: 'Aberto', quarto: '1/4', zerado: 'Zerado' };
const SIT = {
  urgente: { txt: 'Compra urgente', emoji: '🔴' },
  comprar: { txt: 'Comprar', emoji: '🟠' },
  ok: { txt: 'Estoque adequado', emoji: '🟢' },
};
const REGRA_CURTA = { minimo: 'Quantidade mínima', nivel: 'Por nível (1/4 ou zerado)', nivel_aberto: 'Por nível (aberto, 1/4 ou zerado)', nenhuma: 'Sem compra automática' };

async function api(url, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}) } };
  if (o.body && typeof o.body === 'object' && !(o.body instanceof Blob) && !(o.body instanceof ArrayBuffer)) {
    o.body = JSON.stringify(o.body);
    o.headers['Content-Type'] = 'application/json';
  }
  const r = await fetch(url, o);
  let data = null;
  try { data = await r.json(); } catch { /* vazio */ }
  if (r.status === 401 && !url.endsWith('/login')) {
    st.user = null;
    location.hash = '#/login';
    throw new Error(data?.erro || 'Sessão expirada');
  }
  if (!r.ok) throw new Error(data?.erro || 'Erro ao falar com o servidor');
  return data;
}

let toastTimer;
function toast(msg, tipo = '') {
  $('.toast')?.remove();
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), tipo === 'erro' ? 4500 : 2200);
}

function modal({ titulo, html = '', botoes = [{ rotulo: 'OK', valor: true }] }) {
  return new Promise(resolve => {
    const f = document.createElement('div');
    f.className = 'modal-fundo';
    f.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(titulo)}</h2><div>${html}</div>
      <div class="botoes">${botoes.map((b, i) => `<button class="btn ${b.classe || ''}" data-i="${i}">${esc(b.rotulo)}</button>`).join('')}</div></div>`;
    document.body.appendChild(f);
    f.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) { f.remove(); resolve(botoes[b.dataset.i].valor); }
      else if (e.target === f) { f.remove(); resolve(null); }
    });
  });
}
const confirmar = (titulo, html, sim = 'Confirmar', classe = '') =>
  modal({ titulo, html, botoes: [{ rotulo: sim, valor: true, classe }, { rotulo: 'Cancelar', valor: false, classe: 'sec' }] });

function hoje() { return st.boot?.hoje || new Date().toISOString().slice(0, 10); }
function addDias(iso, n) {
  if (!iso || !n) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + Number(n));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function difDias(a, b) {
  const p = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}
function alertaValidade(validade) {
  if (!validade) return null;
  const dias = difDias(hoje(), validade);
  if (dias < 0) return { nivel: 'vencido', texto: `🔴 Vencido há ${-dias} dia${-dias === 1 ? '' : 's'}` };
  if (dias <= st.boot.settings.alerta_validade_dias) return { nivel: 'proximo', texto: dias === 0 ? '🟡 Vence hoje' : `🟡 Vence em ${dias} dia${dias === 1 ? '' : 's'}` };
  return { nivel: 'normal', texto: '🟢 Validade normal' };
}
function alertaAberto(abertura, prazo) {
  const limite = addDias(abertura, prazo);
  if (!limite) return null;
  const dias = difDias(hoje(), limite);
  if (dias < 0) return { nivel: 'expirado', limite, texto: '🔴 PRAZO APÓS ABERTO EXPIRADO' };
  if (dias <= st.boot.settings.alerta_aberto_dias) return { nivel: 'atencao', limite, texto: dias === 0 ? '🟡 ATENÇÃO: usar até hoje' : `🟡 ATENÇÃO: faltam ${dias} dia${dias === 1 ? '' : 's'}` };
  return { nivel: 'normal', limite, texto: `🟢 Faltam ${dias} dias` };
}
function tagAlerta(a) { return a ? `<span class="tag ${a.nivel}">${esc(a.texto || '')}</span>` : ''; }
function tagSit(s) { return s ? `<span class="tag ${s}">${SIT[s].emoji} ${SIT[s].txt}</span>` : '<span class="tag neutro">Não contado</span>'; }
function descrRegistro(item, p) {
  if (!item) return '';
  const partes = [];
  if (item.status) partes.push(NIVEL_TXT[item.status]);
  if (item.quantidade != null) partes.push(`${fmtNum(item.quantidade)} ${p ? esc(p.unidade) : ''}`.trim());
  return partes.join(' + ');
}

// ============================================================ estrutura
function navItens() {
  if (st.user.perfil === 'admin') {
    return {
      lado: [
        ['painel', 'home', 'Painel'], ['contagem', 'clipboard', 'Contagem'], ['compras', 'cart', 'Lista de compras'],
        ['produtos', 'box', 'Produtos'], ['historico', 'clock', 'Histórico'], ['comparar', 'compare', 'Comparar contagens'],
        ['vencimentos', 'calendar', 'Vencimentos'], null,
        ['config', 'gear', 'Configurações'], ['usuarias', 'users', 'Funcionárias'], ['dados', 'data', 'Importar / Exportar'], ['conta', 'user', 'Minha conta'],
      ],
      baixo: [['painel', 'home', 'Painel'], ['contagem', 'clipboard', 'Contagem'], ['compras', 'cart', 'Compras'], ['historico', 'clock', 'Histórico'], ['mais', 'menu', 'Mais']],
    };
  }
  return {
    lado: [['contagem', 'clipboard', 'Contagem'], ['historico', 'clock', 'Minhas contagens'], ['conta', 'user', 'Minha conta']],
    baixo: [['contagem', 'clipboard', 'Contagem'], ['historico', 'clock', 'Minhas contagens'], ['conta', 'user', 'Conta']],
  };
}

function shell(ativo) {
  const n = navItens();
  const link = (it, cls = '') => it ? `<a href="#/${it[0]}" class="${ativo === it[0] ? 'ativo' : ''} ${cls}">${ic(it[1])}<span>${it[2]}</span></a>` : '<div class="sep"></div>';
  $('#app').innerHTML = `
    <header class="topbar">
      <img class="logo" src="logo.jpeg" alt="Rael Sorvetes">
      <div class="marca">ESTOQUE RAEL SORVETES<small>${esc(st.user.nome)}${norm(st.user.nome) === 'administradora' ? '' : ` · ${st.user.perfil === 'admin' ? 'Administradora' : 'Funcionária'}`}</small></div>
      <button class="icon-btn" id="btn-busca" title="Pesquisar" aria-label="Pesquisar">${ic('search')}</button>
      <button class="icon-btn" id="btn-sair" title="Sair" aria-label="Sair">${ic('logout')}</button>
    </header>
    <div class="layout">
      <nav class="sidenav">${n.lado.map(i => link(i)).join('')}</nav>
      <main id="main"><div class="vazio">Carregando…</div></main>
    </div>
    <nav class="bottomnav">${n.baixo.map(i => link(i)).join('')}</nav>`;
  $('#btn-busca').onclick = abrirBuscaGlobal;
  $('#btn-sair').onclick = sair;
  return $('#main');
}

async function sair() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  st.user = null; st.boot = null; st.produtos = null;
  location.hash = '#/login';
}

// ============================================================ roteador
const ROTAS = {};
function rota(nome, fn, soAdmin = false) { ROTAS[nome] = { fn, soAdmin }; }

async function navegar() {
  const hash = location.hash.replace(/^#\/?/, '') || '';
  const [caminho, qs] = hash.split('?');
  const partes = caminho.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  $('.painel-fundo')?.remove();
  $('.busca-global')?.remove();

  if (partes[0] === 'login') { st.user = null; return telaLogin(); }
  if (!st.user) {
    try { st.user = await api('/api/me'); } catch { return; }
  }
  if (!st.boot) st.boot = await api('/api/bootstrap');
  const inicio = st.user.perfil === 'admin' ? 'painel' : 'contagem';
  const nome = partes[0] || inicio;
  const r = ROTAS[nome];
  if (!r || (r.soAdmin && st.user.perfil !== 'admin')) { location.hash = '#/' + inicio; return; }
  const main = shell(nome === 'produto' ? 'produtos' : nome);
  window.scrollTo(0, 0);
  try { await r.fn(main, partes.slice(1), query); }
  catch (e) { main.innerHTML = `<div class="card vazio">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', navegar);

// ============================================================ login
function telaLogin() {
  $('#app').innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="f-login" autocomplete="on">
        <img src="logo.jpeg" alt="Rael Sorvetes">
        <h1>ESTOQUE RAEL SORVETES</h1>
        <label class="campo"><span>Login</span><input type="text" name="login" autocomplete="username" autocapitalize="none" required></label>
        <label class="campo"><span>Senha</span><input type="password" name="senha" autocomplete="current-password" required></label>
        <button class="btn grande" type="submit">ENTRAR</button>
        <p class="muted small" id="login-erro" style="text-align:center;min-height:1.2em;color:var(--vermelho);font-weight:800"></p>
      </form>
    </div>`;
  $('#f-login').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      st.user = await api('/api/login', { method: 'POST', body: { login: fd.get('login'), senha: fd.get('senha') } });
      st.boot = null;
      location.hash = st.user.perfil === 'admin' ? '#/painel' : '#/contagem';
    } catch (err) { $('#login-erro').textContent = err.message; }
  };
}

// ============================================================ painel da administradora
rota('painel', async main => {
  const d = await api('/api/dashboard');
  const u = d.ultima;
  main.innerHTML = `
    <div class="card pergunta">
      <h2>O que eu preciso <span>comprar?</span></h2>
      <a class="atalho" href="#/compras?ver=urgente"><span class="n">${d.urgentes}</span>🔴 compra${d.urgentes === 1 ? '' : 's'} urgente${d.urgentes === 1 ? '' : 's'}<span class="seta">${ic('right')}</span></a>
      <a class="atalho" href="#/compras?ver=comprar"><span class="n">${d.estoque_baixo}</span>🟠 produto${d.estoque_baixo === 1 ? '' : 's'} com estoque baixo<span class="seta">${ic('right')}</span></a>
      <a class="atalho" href="#/vencimentos"><span class="n">${d.vencimentos.length}</span>🟡 próximo${d.vencimentos.length === 1 ? '' : 's'} do vencimento ou vencido${d.vencimentos.length === 1 ? '' : 's'}<span class="seta">${ic('right')}</span></a>
      <a class="atalho" href="#/vencimentos?aba=aberto"><span class="n">${d.apos_aberto.length}</span>🟣 com prazo após aberto perto do fim<span class="seta">${ic('right')}</span></a>
    </div>

    ${d.avisos.filter(a => !a.lida).map(avisoHtml).join('')}

    <div class="secao-titulo">Resumo</div>
    <div class="grid grid-kpi">
      <a class="card kpi" href="${u ? '#/historico/' + u.id : '#/historico'}"><span class="rot">Contagem</span>
        <span class="val" style="font-size:1.25rem">${u ? fmtData(u.data) : 'Nenhuma'}</span>
        <span class="sub">${u ? `${esc(u.funcionaria)} · ${u.hora} · ${u.contados} contados` : 'Ainda não houve contagem finalizada'}</span></a>
      <a class="card kpi" href="#/produtos"><span class="rot">Produtos</span><span class="val">${d.total_produtos}</span><span class="sub">cadastrados e ativos</span></a>
      <a class="card kpi urg" href="#/compras?ver=urgente"><span class="rot">Compra urgente</span><span class="val">${d.urgentes}</span><span class="sub">comprar imediatamente</span></a>
      <a class="card kpi baixo" href="#/compras?ver=comprar"><span class="rot">Estoque baixo</span><span class="val">${d.estoque_baixo}</span><span class="sub">abaixo do mínimo</span></a>
      <a class="card kpi venc" href="#/vencimentos"><span class="rot">Vencimentos</span><span class="val">${d.vencimentos.length}</span><span class="sub">${d.vencidos} vencido${d.vencidos === 1 ? '' : 's'}</span></a>
      <a class="card kpi aberto" href="#/vencimentos?aba=aberto"><span class="rot">Após aberto</span><span class="val">${d.apos_aberto.length}</span><span class="sub">perto ou além do prazo</span></a>
    </div>

    ${d.em_andamento.length ? `<div class="secao-titulo">Contagens em andamento</div><div class="card">${d.em_andamento.map(c => `
      <div class="lista-item"><div class="corpo"><div class="titulo">${esc(c.funcionaria)}</div><div class="det">Iniciada em ${fmtData(c.data)} · ${c.itens} de ${d.total_produtos} produtos contados</div></div>
      <div class="acoes"><button class="btn peq perigo" data-descartar="${c.id}">Descartar</button></div></div>`).join('')}</div>` : ''}

    ${d.avisos.some(a => a.lida) ? `<div class="secao-titulo">Avisos anteriores</div>${d.avisos.filter(a => a.lida).slice(0, 5).map(avisoHtml).join('')}` : ''}`;

  main.onclick = async e => {
    const lida = e.target.closest('[data-lida]');
    if (lida) { await api(`/api/notifications/${lida.dataset.lida}/lida`, { method: 'POST' }); navegar(); }
    const desc = e.target.closest('[data-descartar]');
    if (desc && await confirmar('Descartar contagem?', 'A contagem em andamento será apagada. Essa ação não pode ser desfeita.', 'Descartar', 'perigo')) {
      await api(`/api/counts/${desc.dataset.descartar}`, { method: 'DELETE' }); toast('Contagem descartada'); navegar();
    }
  };
}, true);

function avisoHtml(a) {
  const d = a.dados;
  return `<div class="card aviso ${a.lida ? '' : 'nao-lido'}" style="margin-top:12px">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
      <strong>🔔 ${esc(a.titulo)}</strong>
      <div style="display:flex;gap:6px">
        <a class="btn peq sec" href="#/historico/${d.contagem_id}">Ver contagem</a>
        ${a.lida ? '' : `<button class="btn peq" data-lida="${a.id}">${ic('check')} Ok</button>`}
      </div>
    </div>
    <div class="campos">
      <div><b>Funcionária</b>${esc(d.funcionaria)}</div><div><b>Data</b>${fmtData(d.data)}</div><div><b>Hora</b>${esc(d.hora)}</div>
      <div><b>Produtos contados</b>${d.contados}</div><div><b>Produtos para compra</b>${d.para_compra}</div><div><b>Compras urgentes</b>${d.urgentes}</div>
    </div></div>`;
}

// ============================================================ contagem semanal
const C = { d: null, filtro: 'todos', busca: '', cat: '', ordem: [] };

rota('contagem', async (main, partes, query) => {
  let id = partes[0] ? Number(partes[0]) : null;
  if (!id) {
    const minhas = await api('/api/counts');
    const aberta = minhas.find(c => c.status === 'em_andamento' && c.user_id === st.user.id);
    if (!aberta) {
      const ultima = minhas.find(c => c.status === 'finalizada' && c.user_id === st.user.id);
      main.innerHTML = `
        <div class="card cab-contagem"><h1>CONTAGEM DE ESTOQUE</h1>
          <div class="linha"><span>Hoje: ${fmtData(hoje())}</span><span>Funcionária: ${esc(st.user.nome)}</span></div></div>
        <div class="card" style="margin-top:14px;text-align:center;padding:26px 16px">
          <p style="font-weight:800;font-size:1.1rem;margin-top:0">Pronta para a contagem semanal?</p>
          <p class="muted">Você vai passar produto por produto. Dá para parar e continuar depois: tudo fica salvo.</p>
          ${ultima ? `<p class="muted small">Sua última contagem: ${fmtData(ultima.data)}</p>` : ''}
          <button class="btn grande amarelo" id="iniciar">INICIAR CONTAGEM</button>
        </div>`;
      $('#iniciar').onclick = async () => {
        const r = await api('/api/counts/start', { method: 'POST' });
        location.hash = '#/contagem';
        if (r.id) navegar();
      };
      return;
    }
    id = aberta.id;
  }
  C.d = await api(`/api/counts/${id}`);
  C.filtro = 'todos'; C.busca = ''; C.cat = '';
  renderContagem(main);
  if (query.p) abrirProduto(Number(query.p));
});

function correcao() { return C.d.contagem.status !== 'em_andamento'; }

function produtosFiltrados() {
  const q = norm(C.busca);
  return C.d.produtos.filter(p => {
    const it = C.d.itens[p.id];
    if (C.cat && p.categoria !== C.cat) return false;
    if (C.filtro === 'nao' && it) return false;
    if (C.filtro === 'contado' && !it) return false;
    if (C.filtro === 'baixo' && it?.situacao !== 'comprar') return false;
    if (C.filtro === 'urgente' && it?.situacao !== 'urgente') return false;
    if (q) {
      const alvo = norm(`${p.nome} ${p.categoria} ${p.unidade} ${it ? SIT[it.situacao]?.txt || '' : 'nao contado'} ${it ? descrRegistro(it) : ''}`);
      if (!q.split(/\s+/).every(t => alvo.includes(t))) return false;
    }
    return true;
  });
}

function renderContagem(main = $('#main')) {
  const d = C.d, c = d.contagem;
  const itens = Object.values(d.itens);
  const contados = correcao() ? itens.length : d.produtos.filter(p => d.itens[p.id]).length;
  const total = correcao() ? (c.total_produtos || d.produtos.length) : d.produtos.length;
  const pct = total ? Math.round((contados / total) * 100) : 0;
  const cnt = {
    nao: d.produtos.filter(p => !d.itens[p.id]).length,
    contado: contados,
    baixo: itens.filter(i => i.situacao === 'comprar').length,
    urgente: itens.filter(i => i.situacao === 'urgente').length,
  };
  const lista = produtosFiltrados();
  C.ordem = lista.map(p => p.id);
  const grupos = [];
  for (const p of lista) {
    let g = grupos.find(x => x.cat === p.categoria);
    if (!g) grupos.push(g = { cat: p.categoria, itens: [] });
    g.itens.push(p);
  }
  const chip = (k, rot) => `<button class="chip ${C.filtro === k ? 'ativo' : ''}" data-filtro="${k}">${rot}${cnt[k] != null ? `<span class="n">${cnt[k]}</span>` : ''}</button>`;

  main.innerHTML = `
    <div class="card cab-contagem">
      <h1>${correcao() ? 'CORREÇÃO DA CONTAGEM' : 'CONTAGEM DE ESTOQUE'}</h1>
      <div class="linha"><span>Contagem semanal — ${fmtData(c.data)}</span><span class="status">${correcao() ? 'FINALIZADA · CORRIGINDO' : 'EM ANDAMENTO'}</span></div>
      <div class="linha"><span>Funcionária: ${esc(c.funcionaria)}</span></div>
      <div class="progresso"><div style="width:${pct}%"></div></div>
      <div class="prog-texto">${contados} de ${total} produtos contados — ${pct}%</div>
    </div>
    <div class="barra-filtros">
      <div class="busca">${ic('search')}<input type="search" id="c-busca" placeholder="Pesquisar produto, categoria, tipo…" value="${esc(C.busca)}"></div>
      <div class="chips">
        ${chip('todos', 'Todos')}${chip('nao', 'Não contado')}${chip('contado', 'Contado')}${chip('baixo', '🟠 Estoque baixo')}${chip('urgente', '🔴 Compra urgente')}
      </div>
      <div class="chips" style="padding-top:2px">
        <button class="chip ${!C.cat ? 'ativo' : ''}" data-cat="">Todas as categorias</button>
        ${d.categorias.filter(k => d.produtos.some(p => p.categoria === k.nome)).map(k => `<button class="chip ${C.cat === k.nome ? 'ativo' : ''}" data-cat="${esc(k.nome)}">${esc(k.nome)}</button>`).join('')}
      </div>
    </div>
    <div id="c-lista">
      ${grupos.length ? grupos.map(g => `
        <section class="grupo-cat"><h2><span>${esc(g.cat)}</span><span>${g.itens.filter(p => d.itens[p.id]).length}/${g.itens.length}</span></h2>
        ${g.itens.map(p => itemListaHtml(p)).join('')}</section>`).join('') : '<div class="card vazio" style="margin-top:14px">Nenhum produto com esse filtro.</div>'}
    </div>
    ${correcao() ? `<div class="finalizar-box"><a class="btn grande sec" href="#/historico/${c.id}">VOLTAR PARA A CONTAGEM</a></div>` : `
    <div class="finalizar-box card">
      <label class="campo"><span>Observação geral da contagem (opcional)</span><textarea id="c-obs" placeholder="Ex.: faltou conferir o freezer 2">${esc(c.observacao || '')}</textarea></label>
      <button class="btn grande verde" id="finalizar">✓ FINALIZAR CONTAGEM</button>
    </div>`}`;

  $('#c-busca').oninput = e => {
    C.busca = e.target.value;
    const pos = e.target.selectionStart;
    renderContagem(main);
    const inp = $('#c-busca'); inp.focus(); inp.setSelectionRange(pos, pos);
  };
  main.onclick = e => {
    const f = e.target.closest('[data-filtro]'); if (f) { C.filtro = f.dataset.filtro; renderContagem(main); return; }
    const k = e.target.closest('[data-cat]'); if (k) { C.cat = k.dataset.cat; renderContagem(main); return; }
    const p = e.target.closest('[data-produto]'); if (p) abrirProduto(Number(p.dataset.produto));
  };
  const fin = $('#finalizar');
  if (fin) fin.onclick = () => finalizarContagem();
}

function itemListaHtml(p) {
  const it = C.d.itens[p.id];
  const alertas = [];
  const av = it ? alertaValidade(it.validade) : p.alerta_validade && alertaValidade(p.validade);
  if (av && av.nivel !== 'normal') alertas.push(tagAlerta(av));
  const aa = it ? alertaAberto(it.data_abertura, p.prazo_apos_aberto) : null;
  if (aa && aa.nivel !== 'normal') alertas.push(tagAlerta(aa));
  return `<button class="item-lista ${it ? 'contado ' + (it.situacao || '') : ''}" data-produto="${p.id}">
    <span class="dot ${it ? it.situacao || 'ok' : 'nc'}"></span>
    <span class="info"><div class="nome">${esc(p.nome)}</div>
      <div class="meta"><span class="tag roxo">${esc(p.unidade)}</span>${it?.observacao ? `<span>📝 ${esc(it.observacao)}</span>` : ''}${alertas.join('')}</div></span>
    <span class="res">${it ? `<span class="qtd">${descrRegistro(it, p)}</span>` : '<span class="tag neutro">Não contado</span>'}</span>
  </button>`;
}

// ---------- painel de um produto
let P = null; // { p, draft, salvo }

function plural(u, n) {
  if (n === 1) return u;
  return ({ und: 'unidades', kilo: 'quilos' })[u] || (u.endsWith('s') ? u : u + 's');
}
function regraDoProduto(p) { return p.regra_efetiva; }
function usaNivel(p) { return regraDoProduto(p) === 'nivel' || regraDoProduto(p) === 'nivel_aberto'; }

function abrirProduto(pid) {
  const p = C.d.produtos.find(x => x.id === pid);
  if (!p) return;
  const it = C.d.itens[pid];
  const draft = it
    ? { quantidade: it.quantidade, status: it.status, validade: it.validade, data_abertura: it.data_abertura, observacao: it.observacao || '' }
    : { quantidade: null, status: null, validade: p.validade, data_abertura: p.data_abertura, observacao: '' };
  P = { p, draft, inicial: JSON.stringify(draft), contado: !!it };
  renderPainel();
}

function estadosDisponiveis(p) {
  const e = [];
  if (usaNivel(p)) e.push('cheio');
  if (p.permite_aberto) e.push('aberto');
  if (p.permite_quarto) e.push('quarto');
  if (p.permite_zerado) e.push('zerado');
  return e;
}

function renderPainel() {
  const { p, draft } = P;
  const idx = C.ordem.indexOf(p.id);
  const pos = idx >= 0 ? `${idx + 1} de ${C.ordem.length}` : '';
  const nivel = usaNivel(p);
  const estados = estadosDisponiveis(p);
  const unidadeLow = p.unidade.toLowerCase();
  const embalagem = ['PACOTE', 'CAIXA', 'ROLO'].includes(p.unidade);
  let aviso = '';
  if (!nivel && (p.categoria === 'DESCARTÁVEIS' || embalagem)) {
    aviso = `📦 Conte ${unidadeLow === 'caixa' ? 'as CAIXAS fechadas' : unidadeLow === 'rolo' ? 'os ROLOS' : 'os PACOTES fechados'}, não as unidades de dentro.${p.quantidade_embalagem ? ` (cada ${unidadeLow} tem ${p.quantidade_embalagem} un.)` : ''}`;
  } else if (nivel) {
    aviso = '🪣 Informe o nível do produto. <b>Aberto</b> não quer dizer que acabou.';
  }
  const regraTxt = nivel
    ? `Entra na compra quando estiver em ${p.regra_efetiva === 'nivel_aberto' ? 'ABERTO, ' : ''}1/4 ou ZERADO.`
    : p.regra_efetiva === 'minimo' ? `Entra na compra com menos de ${p.minimo_efetivo} ${plural(unidadeLow, p.minimo_efetivo)}.` : '';
  const armazen = (p.prazo_apos_aberto || p.armazenamento)
    ? `<div class="info-arm">🧊 ${p.prazo_apos_aberto ? `Prazo após aberto: <b>${p.prazo_apos_aberto} dias</b>` : ''}${p.prazo_apos_aberto && p.armazenamento ? ' · ' : ''}${p.armazenamento ? `Armazenamento: <b>${esc(p.armazenamento)}</b>` : ''}</div>` : '';

  const botoesNum = Array.from({ length: 11 }, (_, n) => `<button class="num ${draft.quantidade === n ? 'sel' : ''}" data-num="${n}">${n}</button>`).join('');
  const blocoEstados = estados.length ? `
    <div class="bloco-rot">${nivel ? 'Estoque' : 'Situação da embalagem (opcional)'}</div>
    <div class="estados">${estados.map(s => `<button class="estado ${s} ${draft.status === s ? 'sel' : ''}" data-estado="${s}">${{ cheio: 'CHEIO', aberto: 'ABERTO', quarto: '1/4', zerado: 'ZERADO' }[s]}</button>`).join('')}</div>` : '';
  const blocoQtd = `
    <div class="bloco-rot">${nivel ? 'Quantidade de unidades cheias/fechadas (opcional)' : `Quantidade (${esc(unidadeLow)})`}</div>
    <div class="numeros">${botoesNum}</div>
    <div class="qtd-manual">
      <button data-passo="-1" aria-label="Diminuir">−</button>
      <input type="text" inputmode="decimal" id="p-qtd" placeholder="Digite" value="${draft.quantidade ?? ''}" aria-label="Quantidade">
      <button data-passo="1" aria-label="Aumentar">+</button>
    </div>`;

  const aa = alertaAberto(draft.data_abertura, p.prazo_apos_aberto);
  const av = alertaValidade(draft.validade);
  const f = $('.painel-fundo') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'painel-fundo' }));
  f.innerHTML = `
    <div class="painel" role="dialog" aria-modal="true">
      <div class="painel-topo">
        <div class="linha1"><span>${pos ? 'Produto ' + pos : ''}</span>
          <button class="icon-btn" data-fechar aria-label="Fechar">${ic('x')}</button></div>
        <h2>${esc(p.nome)}</h2>
        <div class="sub">${esc(p.categoria)} · ${esc(p.unidade)}${p.quantidade_embalagem ? ` c/ ${p.quantidade_embalagem}` : ''}</div>
      </div>
      <div class="painel-corpo">
        ${aviso ? `<div class="aviso-contar">${aviso}${regraTxt ? `<div class="small muted" style="margin-top:4px">${regraTxt}</div>` : ''}</div>` : regraTxt ? `<div class="aviso-contar small">${regraTxt}</div>` : ''}
        ${armazen}
        ${nivel ? blocoEstados + blocoQtd : blocoQtd + blocoEstados}
        ${p.prazo_apos_aberto ? `
          <div class="bloco-rot">Data de abertura</div>
          <div class="data-linha"><input type="date" id="p-abertura" value="${esc(draft.data_abertura || '')}"><button class="btn sec" data-hoje>Aberto hoje</button></div>
          <div id="p-lim">${htmlLimite(aa)}</div>` : ''}
        <div class="bloco-rot">Validade</div>
        <input type="date" id="p-validade" value="${esc(draft.validade || '')}">
        <div id="p-val-al">${htmlValidade(av)}</div>
        <div class="bloco-rot">Observação</div>
        <textarea id="p-obs" placeholder="Ex.: pacote aberto, produto danificado…">${esc(draft.observacao || '')}</textarea>
        <div class="obs-rapidas">${['Pacote aberto', 'Produto vencendo', 'Foi usado hoje', 'Produto danificado', 'Precisa comprar', 'Último pacote'].map(o => `<button data-obs="${o}">${o}</button>`).join('')}</div>
        ${P.contado ? '<button class="btn sec bloco" style="margin-top:16px" data-limpar>Limpar contagem deste produto</button>' : ''}
      </div>
      <div class="painel-rodape">
        <button class="btn sec" data-anterior ${idx <= 0 ? 'disabled' : ''}>${ic('left')} Anterior</button>
        <button class="btn" data-proximo>${idx >= 0 && idx < C.ordem.length - 1 ? 'SALVAR E PRÓXIMO' : 'SALVAR'} ${ic('right')}</button>
      </div>
    </div>`;
  document.body.style.overflow = 'hidden';

  const lerCampos = () => {
    const q = $('#p-qtd', f).value.trim();
    if (q === '') draft.quantidade = null;
    else { const n = Number(q.replace(',', '.')); if (Number.isFinite(n) && n >= 0) draft.quantidade = n; }
    draft.validade = $('#p-validade', f).value || null;
    if ($('#p-abertura', f)) draft.data_abertura = $('#p-abertura', f).value || null;
    draft.observacao = $('#p-obs', f).value;
  };
  const atualizar = () => {
    $$('[data-num]', f).forEach(b => b.classList.toggle('sel', Number(b.dataset.num) === draft.quantidade));
    $$('[data-estado]', f).forEach(b => b.classList.toggle('sel', b.dataset.estado === draft.status));
    const qi = $('#p-qtd', f);
    if (document.activeElement !== qi) qi.value = draft.quantidade ?? '';
    if ($('#p-abertura', f)) { $('#p-abertura', f).value = draft.data_abertura || ''; $('#p-lim', f).innerHTML = htmlLimite(alertaAberto(draft.data_abertura, p.prazo_apos_aberto)); }
    $('#p-val-al', f).innerHTML = htmlValidade(alertaValidade(draft.validade));
    $('#p-obs', f).value = draft.observacao || '';
  };

  f.onclick = async e => {
    const t = e.target;
    if (t === f || t.closest('[data-fechar]')) { lerCampos(); if (await salvarProduto()) fecharPainel(); return; }
    const num = t.closest('[data-num]');
    if (num) {
      lerCampos();
      draft.quantidade = Number(num.dataset.num);
      if (!nivel && draft.status === 'zerado' && draft.quantidade > 0) draft.status = null;
      if (nivel && draft.quantidade > 0 && (draft.status === 'zerado' || !draft.status)) draft.status = 'cheio';
      $('#p-qtd', f).blur(); atualizar(); return;
    }
    const passo = t.closest('[data-passo]');
    if (passo) {
      lerCampos();
      draft.quantidade = Math.max(0, (draft.quantidade || 0) + Number(passo.dataset.passo));
      $('#p-qtd', f).blur(); atualizar(); return;
    }
    const est = t.closest('[data-estado]');
    if (est) {
      lerCampos();
      const s = est.dataset.estado;
      draft.status = draft.status === s ? null : s;
      if (draft.status === 'zerado' && !nivel) draft.quantidade = 0;
      if (draft.status === 'zerado' && nivel) draft.quantidade = null;
      atualizar(); return;
    }
    if (t.closest('[data-hoje]')) { lerCampos(); draft.data_abertura = hoje(); atualizar(); return; }
    const obs = t.closest('[data-obs]');
    if (obs) {
      lerCampos();
      const cur = draft.observacao.trim();
      draft.observacao = cur ? (cur.includes(obs.dataset.obs) ? cur : `${cur}; ${obs.dataset.obs}`) : obs.dataset.obs;
      atualizar(); return;
    }
    if (t.closest('[data-limpar]')) {
      const r = await api(`/api/counts/${C.d.contagem.id}/items/${p.id}`, { method: 'PUT', body: {} });
      if (!r.item) delete C.d.itens[p.id];
      toast('Contagem do produto removida');
      fecharPainel(); return;
    }
    if (t.closest('[data-anterior]')) {
      lerCampos();
      if (await salvarProduto()) { const i = C.ordem.indexOf(p.id); if (i > 0) abrirProduto(C.ordem[i - 1]); }
      return;
    }
    if (t.closest('[data-proximo]')) {
      lerCampos();
      if (draft.quantidade == null && !draft.status) { toast('Informe a quantidade ou o status', 'erro'); return; }
      if (await salvarProduto(true)) {
        const i = C.ordem.indexOf(p.id);
        if (i >= 0 && i < C.ordem.length - 1) abrirProduto(C.ordem[i + 1]);
        else { fecharPainel(); toast(correcao() ? 'Correção salva' : 'Último produto da lista! Confira e toque em FINALIZAR CONTAGEM.', 'ok'); }
      }
    }
  };
  $('#p-qtd', f).addEventListener('input', () => {
    lerCampos();
    if (nivel && draft.quantidade > 0 && !draft.status) draft.status = 'cheio';
    atualizar();
  });
  for (const idc of ['#p-abertura', '#p-validade']) $(idc, f)?.addEventListener('change', () => { lerCampos(); atualizar(); });
  $('.painel-corpo', f).scrollTop = 0;
}

function htmlLimite(aa) {
  return aa ? `<div class="limite-box ${aa.nivel}">Usar até ${fmtData(aa.limite)} · ${aa.texto}</div>`
    : '<div class="small muted" style="margin-top:4px">Se estiver aberto, informe a data para calcular o limite de uso.</div>';
}
function htmlValidade(av) { return av ? `<div style="margin-top:6px">${tagAlerta(av)}</div>` : ''; }

async function salvarProduto(forcar = false) {
  const { p, draft } = P;
  const mudou = JSON.stringify(draft) !== P.inicial;
  if (!mudou && !forcar) return true;
  if (!mudou && P.contado) return true;
  if (draft.quantidade == null && !draft.status) {
    if (!mudou) return true;
    // mexeu só em validade/observação sem contar: não salva como contado
    if (!P.contado) { toast('Informe a quantidade ou o status para salvar', 'erro'); return false; }
  }
  try {
    const r = await api(`/api/counts/${C.d.contagem.id}/items/${p.id}`, { method: 'PUT', body: draft });
    if (r.item) C.d.itens[p.id] = r.item; else delete C.d.itens[p.id];
    P.inicial = JSON.stringify(draft); P.contado = !!r.item;
    if (r.situacao === 'urgente') toast('Salvo · 🔴 COMPRA URGENTE', 'ok');
    else if (r.situacao === 'comprar') toast('Salvo · 🟠 entrou na lista de compras', 'ok');
    else toast('Salvo ✓', 'ok');
    renderContagem();
    return true;
  } catch (e) { toast(e.message, 'erro'); return false; }
}

function fecharPainel() {
  $('.painel-fundo')?.remove();
  document.body.style.overflow = '';
  P = null;
  renderContagem();
}

async function finalizarContagem(forcar = false) {
  const obs = $('#c-obs')?.value || '';
  try {
    const r = await api(`/api/counts/${C.d.contagem.id}/finalize`, { method: 'POST', body: { observacao: obs, forcar } });
    if (r.precisaConfirmar) {
      const n = r.nao_contados;
      const v = await modal({
        titulo: 'Ainda faltam produtos',
        html: `<p style="font-size:1.05rem;font-weight:700">Existem ${n} produto${n === 1 ? '' : 's'} ainda não contabilizado${n === 1 ? '' : 's'}. Deseja finalizar mesmo assim?</p>`,
        botoes: [{ rotulo: 'CONTINUAR CONTAGEM', valor: 'continuar' }, { rotulo: 'FINALIZAR MESMO ASSIM', valor: 'finalizar', classe: 'perigo' }],
      });
      if (v === 'finalizar') return finalizarContagem(true);
      if (v === 'continuar') { C.filtro = 'nao'; renderContagem(); }
      return;
    }
    $('#main').innerHTML = `
      <div class="card sucesso">
        <div class="check-grande">✓</div>
        <h1>CONTAGEM FINALIZADA COM SUCESSO</h1>
        <p class="muted">${fmtData(r.data)} às ${esc(r.hora)} · ${esc(r.funcionaria)}</p>
        <div class="grid grid-kpi" style="margin:18px 0;text-align:left">
          <div class="card kpi"><span class="rot">Contados</span><span class="val">${r.contados}</span></div>
          <div class="card kpi"><span class="rot">Não contados</span><span class="val">${r.nao_contados}</span></div>
          <div class="card kpi baixo"><span class="rot">Para compra</span><span class="val">${r.para_compra}</span></div>
          <div class="card kpi urg"><span class="rot">Urgentes</span><span class="val">${r.urgentes}</span></div>
        </div>
        <p class="muted">A administradora já recebeu o aviso.</p>
        <a class="btn grande" href="#/historico/${r.contagem_id}">VER RESUMO DA CONTAGEM</a>
      </div>`;
    window.scrollTo(0, 0);
  } catch (e) { toast(e.message, 'erro'); }
}

// ============================================================ lista de compras
rota('compras', async (main, partes, query) => {
  const d = await api('/api/purchases');
  let busca = '';
  const filtra = arr => arr.filter(x => !busca || norm(`${x.nome} ${x.categoria} ${x.unidade} ${x.motivo || ''}`).includes(norm(busca)));
  const render = () => {
    const u = filtra(d.urgentes), c = filtra(d.comprar), ok = filtra(d.adequados), nc = filtra(d.nao_contados), f = filtra(d.comprados);
    $('#compras-corpo').innerHTML = `
      <div class="card compra-sec urg" id="sec-urgente">
        <h2>🔴 COMPRA URGENTE <span class="tag urgente">${u.length}</span></h2>
        <p class="muted small" style="margin:4px 0 0">Produtos zerados ou com regra crítica atingida.</p>
        ${u.length ? u.map(x => `
          <div class="lista-item empilha"><div class="corpo">
            <div class="titulo">${esc(x.nome)}</div>
            <div class="det">${esc(x.categoria)} · Atual: <b>${esc(x.estoque_texto || '—')} ${x.estoque_atual != null ? esc(x.unidade) : ''}</b></div>
            <div class="det">Motivo: <b>${esc(x.motivo)}</b> · Contagem de ${fmtData(x.data_contagem || x.data_identificacao)}</div>
          </div><div class="acoes"><button class="btn verde" data-comprar="${x.id}">${ic('check')} MARCAR COMO COMPRADO</button></div></div>`).join('') : '<div class="vazio">Nenhuma compra urgente 🎉</div>'}
      </div>
      <div class="card compra-sec comp" id="sec-comprar">
        <h2>🟠 COMPRAR <span class="tag comprar">${c.length}</span></h2>
        <p class="muted small" style="margin:4px 0 0">Produtos abaixo do estoque mínimo ou no nível de reposição.</p>
        ${c.length ? c.map(x => `
          <div class="lista-item empilha"><div class="corpo">
            <div class="titulo">${esc(x.nome)}</div>
            <div class="det">Atual: <b>${esc(x.estoque_texto || '—')}</b> · Mínimo: <b>${x.regra_efetiva === 'minimo' ? x.minimo_efetivo : 'regra por nível'}</b> · Unidade: <b>${esc(x.unidade)}</b></div>
            <div class="det">Motivo: <b>${esc(x.motivo)}</b> · ${esc(x.categoria)} · ${fmtData(x.data_contagem || x.data_identificacao)}</div>
          </div><div class="acoes"><button class="btn verde" data-comprar="${x.id}">${ic('check')} MARCAR COMO COMPRADO</button></div></div>`).join('') : '<div class="vazio">Nada abaixo do mínimo.</div>'}
      </div>
      <div class="card compra-sec ok">
        <details class="dobra"><summary><h2>🟢 ESTOQUE ADEQUADO <span class="tag ok">${ok.length}</span></h2>${ic('right')}</summary>
        ${ok.map(x => `<div class="lista-item"><div class="corpo"><div class="titulo">${esc(x.nome)}</div><div class="det">${esc(x.categoria)} · ${esc(x.estoque_texto)} ${x.estoque_atual != null ? esc(x.unidade) : ''}</div></div></div>`).join('') || '<div class="vazio">—</div>'}
        </details>
      </div>
      ${nc.length ? `<div class="card"><details class="dobra"><summary><h2 style="font-size:1rem">⚪ Ainda sem contagem <span class="tag neutro">${nc.length}</span></h2>${ic('right')}</summary>
        ${nc.map(x => `<div class="lista-item"><div class="corpo"><div class="titulo">${esc(x.nome)}</div><div class="det">${esc(x.categoria)}</div></div></div>`).join('')}</details></div>` : ''}
      <div class="card compra-sec feito">
        <details class="dobra" ${query.ver === 'comprados' ? 'open' : ''}><summary><h2>🛒 Comprados recentemente <span class="tag roxo">${f.length}</span></h2>${ic('right')}</summary>
        ${f.map(x => `<div class="lista-item empilha"><div class="corpo"><div class="titulo">${esc(x.nome)}</div>
          <div class="det">Comprado em <b>${fmtDataHora(x.data_compra)}</b> por <b>${esc(x.comprado_por_nome || '')}</b> · ${esc(x.motivo || '')}</div></div>
          <div class="acoes"><button class="btn peq perigo" data-desfazer="${x.id}">DESFAZER COMPRA</button></div></div>`).join('') || '<div class="vazio">Nenhuma compra registrada.</div>'}
        </details>
      </div>`;
  };
  main.innerHTML = `
    <div class="page-head"><h1>LISTA DE COMPRAS</h1>
      <div class="acoes"><a class="btn peq sec" href="/api/export/compras?formato=xlsx">Excel</a><a class="btn peq sec" href="/api/export/compras?formato=pdf" target="_blank">PDF</a></div></div>
    <div class="busca" style="margin-bottom:12px">${ic('search')}<input type="search" id="cp-busca" placeholder="Pesquisar na lista de compras…"></div>
    <div id="compras-corpo"></div>`;
  render();
  if (query.ver) $(`#sec-${query.ver}`)?.scrollIntoView({ block: 'start' });
  $('#cp-busca').oninput = e => { busca = e.target.value; render(); };
  main.onclick = async e => {
    const b = e.target.closest('[data-comprar]');
    if (b) {
      b.disabled = true;
      try { await api(`/api/purchases/${b.dataset.comprar}/comprar`, { method: 'POST' }); toast('Marcado como comprado ✓', 'ok'); Object.assign(d, await api('/api/purchases')); render(); }
      catch (err) { toast(err.message, 'erro'); b.disabled = false; }
    }
    const u = e.target.closest('[data-desfazer]');
    if (u && await confirmar('Desfazer compra?', 'O produto volta para a lista de compras pendentes.', 'Desfazer compra')) {
      try { await api(`/api/purchases/${u.dataset.desfazer}/desfazer`, { method: 'POST' }); toast('Compra desfeita'); Object.assign(d, await api('/api/purchases')); render(); }
      catch (err) { toast(err.message, 'erro'); }
    }
  };
}, true);

// ============================================================ produtos
rota('produtos', async (main, partes, query) => {
  let lista = await api('/api/products?todos=1');
  st.produtos = lista.filter(p => p.ativo);
  let busca = query.q || '', cat = '', inativos = false;
  const render = () => {
    const q = norm(busca);
    const f = lista.filter(p => (inativos || p.ativo) && (!cat || p.categoria === cat) &&
      (!q || q.split(/\s+/).every(t => norm(`${p.nome} ${p.categoria} ${p.unidade} ${p.situacao_texto} ${REGRA_CURTA[p.regra_efetiva]} ${p.ativo ? 'ativo' : 'inativo'}`).includes(t))));
    $('#prod-lista').innerHTML = f.length ? f.map(p => `
      <a class="lista-item" href="#/produto/${p.id}">
        <span class="dot ${p.situacao || 'nc'}" style="margin-top:6px"></span>
        <div class="corpo"><div class="titulo">${esc(p.nome)}</div>
          <div class="det" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">
            <span class="tag roxo">${esc(p.categoria)}</span><span class="tag neutro">${esc(p.unidade)}</span>
            ${p.regra_efetiva !== 'minimo' ? `<span class="tag neutro">${REGRA_CURTA[p.regra_efetiva]}</span>` : `<span class="tag neutro">mín. ${p.minimo_efetivo}</span>`}
            ${p.prazo_apos_aberto ? `<span class="tag neutro">aberto: ${p.prazo_apos_aberto} dias</span>` : ''}
            ${p.alerta_validade && p.alerta_validade.nivel !== 'normal' ? tagAlerta(alertaValidade(p.validade)) : ''}
            ${p.ativo ? '' : '<span class="tag inativo">INATIVO</span>'}
          </div></div>
        <div class="acoes"><span class="small muted">${esc(p.estoque_texto || '')}</span>${ic('right')}</div>
      </a>`).join('') : '<div class="vazio">Nenhum produto encontrado.</div>';
    $('#prod-cont').textContent = `${f.length} produto${f.length === 1 ? '' : 's'}`;
  };
  main.innerHTML = `
    <div class="page-head"><h1>PRODUTOS</h1><div class="acoes"><a class="btn" href="#/produto/novo">${ic('plus')} Novo produto</a></div></div>
    <div class="busca">${ic('search')}<input type="search" id="pr-busca" placeholder="Pesquisar por nome, categoria, tipo ou status…" value="${esc(busca)}"></div>
    <div class="chips"><button class="chip ativo" data-cat="">Todas</button>${st.boot.categorias.map(c => `<button class="chip" data-cat="${esc(c.nome)}">${esc(c.nome)}</button>`).join('')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <label class="check"><input type="checkbox" id="pr-inat"> Mostrar inativos</label><span class="muted small" id="prod-cont"></span></div>
    <div class="card" id="prod-lista" style="padding-top:4px;padding-bottom:4px"></div>`;
  render();
  $('#pr-busca').oninput = e => { busca = e.target.value; render(); };
  $('#pr-inat').onchange = e => { inativos = e.target.checked; render(); };
  main.querySelector('.chips').onclick = e => {
    const c = e.target.closest('[data-cat]'); if (!c) return;
    cat = c.dataset.cat; $$('.chips .chip', main).forEach(x => x.classList.toggle('ativo', x === c)); render();
  };
}, true);

rota('produto', async (main, partes) => {
  const novo = partes[0] === 'novo';
  const cfg = await api('/api/config');
  const p = novo
    ? { nome: '', categoria: cfg.categorias[0]?.nome, unidade: 'UND', regra_estoque: 'categoria', permite_aberto: 0, permite_quarto: 0, permite_zerado: 1, ativo: 1 }
    : (await api('/api/products?todos=1')).find(x => x.id === Number(partes[0]));
  if (!p) throw new Error('Produto não encontrado');
  const hist = novo ? [] : await api(`/api/products/${p.id}/history`);
  const catRegra = nome => { const c = cfg.categorias.find(x => x.nome === nome); return c ? `${REGRA_CURTA[c.regra]}${c.regra === 'minimo' ? `, mínimo ${c.estoque_minimo}` : ''}` : ''; };
  const unidades = [...new Set([...(st.boot.unidades || []), 'UND', 'PACOTE', 'CAIXA', 'BALDE', 'ROLO', 'KILO', 'POTE', 'LITRO', 'GARRAFA', 'FRUTA', 'BISNAGA'])];
  main.innerHTML = `
    <div class="page-head"><h1>${novo ? 'NOVO PRODUTO' : 'EDITAR PRODUTO'}</h1><div class="acoes"><a class="btn peq sec" href="#/produtos">${ic('left')} Produtos</a></div></div>
    <form class="card" id="f-prod">
      <label class="campo"><span>Nome *</span><input type="text" name="nome" value="${esc(p.nome)}" required></label>
      <div class="form-grid tres">
        <label class="campo"><span>Categoria *</span><select name="categoria">${cfg.categorias.map(c => `<option ${c.nome === p.categoria ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="campo"><span>Tipo de unidade *</span><input type="text" name="unidade" list="unidades" value="${esc(p.unidade)}" required><datalist id="unidades">${unidades.map(u => `<option value="${esc(u)}">`).join('')}</datalist></label>
        <label class="campo"><span>Quantidade por embalagem</span><input type="number" min="0" name="quantidade_embalagem" value="${p.quantidade_embalagem ?? ''}" inputmode="numeric"><span class="dica">Ex.: pacote com 50 copos = 50</span></label>
      </div>
      <div class="secao-titulo" style="margin-top:6px">Regra de estoque</div>
      <div class="form-grid duas">
        <label class="campo"><span>Regra de reposição</span><select name="regra_estoque" id="sel-regra">
          <option value="categoria" ${p.regra_estoque === 'categoria' ? 'selected' : ''}>Usar a regra da categoria (${esc(catRegra(p.categoria))})</option>
          ${Object.entries(REGRA_CURTA).map(([k, v]) => `<option value="${k}" ${p.regra_estoque === k ? 'selected' : ''}>${v}${k === 'nivel' ? ' — regra especial (Nutella, cremes, baldes)' : ''}</option>`).join('')}
        </select></label>
        <label class="campo"><span>Estoque mínimo</span><input type="number" min="0" name="estoque_minimo" value="${p.estoque_minimo ?? ''}" placeholder="Vazio = mínimo da categoria" inputmode="numeric"><span class="dica">Compra quando a quantidade ficar abaixo deste número.</span></label>
      </div>
      <div class="form-grid tres">
        <label class="check"><input type="checkbox" name="permite_aberto" ${p.permite_aberto ? 'checked' : ''}> Permite "Aberto"</label>
        <label class="check"><input type="checkbox" name="permite_quarto" ${p.permite_quarto ? 'checked' : ''}> Permite "1/4"</label>
        <label class="check"><input type="checkbox" name="permite_zerado" ${p.permite_zerado ? 'checked' : ''}> Permite "Zerado"</label>
      </div>
      <div class="secao-titulo">Validade e após aberto</div>
      <div class="form-grid tres">
        <label class="campo"><span>Data de validade</span><input type="date" name="validade" value="${esc(p.validade || '')}"></label>
        <label class="campo"><span>Prazo após aberto (dias)</span><input type="number" min="0" name="prazo_apos_aberto" value="${p.prazo_apos_aberto ?? ''}" inputmode="numeric"></label>
        <label class="campo"><span>Data de abertura</span><input type="date" name="data_abertura" value="${esc(p.data_abertura || '')}"><span class="dica" id="limite-calc"></span></label>
      </div>
      <label class="campo"><span>Tipo de armazenamento</span><input type="text" name="armazenamento" value="${esc(p.armazenamento || '')}" placeholder="Ex.: Refrigerado / fechado" list="arm-list">
        <datalist id="arm-list"><option value="Refrigerado"><option value="Refrigerado / fechado"><option value="Seco"><option value="Seco / fechado"><option value="Fechado"><option value="Ambiente / fechado"></datalist></label>
      <label class="campo"><span>Observações</span><textarea name="observacao">${esc(p.observacao || '')}</textarea></label>
      ${novo ? '' : `<label class="check"><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Produto ativo (aparece na contagem)</label>
        <p class="small muted">Estoque atual: <b>${esc(p.estoque_texto || 'não contado')}</b> · Situação: ${tagSit(p.situacao)}</p>`}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
        <button class="btn" type="submit" style="flex:1">${ic('check')} SALVAR PRODUTO</button>
        ${novo ? '' : '<button class="btn perigo" type="button" id="btn-excluir">Excluir / inativar</button>'}
      </div>
    </form>
    ${hist.length ? `<div class="secao-titulo">Histórico do produto</div><div class="card">${hist.map(h => `
      <div class="lista-item"><div class="corpo"><div class="titulo">${esc(h.tipo_movimentacao.replace(/_/g, ' '))} ${h.quantidade_anterior || h.quantidade_nova ? `· ${esc(h.quantidade_anterior || '—')} → ${esc(h.quantidade_nova || '—')}` : ''}</div>
      <div class="det">${fmtDataHora(h.data)} · ${esc(h.usuario || '')}${h.observacao ? ' · ' + esc(h.observacao) : ''}</div></div></div>`).join('')}</div>` : ''}`;

  const form = $('#f-prod');
  const calcLimite = () => {
    const a = form.data_abertura.value, pz = form.prazo_apos_aberto.value;
    const al = alertaAberto(a, pz);
    $('#limite-calc').textContent = al ? `Data limite: ${fmtData(al.limite)} · ${al.texto}` : '';
  };
  calcLimite();
  form.data_abertura.onchange = calcLimite; form.prazo_apos_aberto.oninput = calcLimite;
  form.categoria.onchange = () => { $('#sel-regra').options[0].text = `Usar a regra da categoria (${catRegra(form.categoria.value)})`; };
  form.onsubmit = async e => {
    e.preventDefault();
    const body = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      body[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    try {
      const r = await api(novo ? '/api/products' : `/api/products/${p.id}`, { method: novo ? 'POST' : 'PUT', body });
      toast('Produto salvo ✓', 'ok');
      st.produtos = null;
      if (novo) location.hash = `#/produto/${r.id}`; else navegar();
    } catch (err) { toast(err.message, 'erro'); }
  };
  const bx = $('#btn-excluir');
  if (bx) bx.onclick = async () => {
    const v = await modal({
      titulo: 'Excluir ou inativar?',
      html: '<p><b>Inativar</b> tira o produto da contagem e mantém o histórico.</p><p><b>Excluir</b> apaga de vez (só funciona se o produto nunca foi contado).</p>',
      botoes: [{ rotulo: 'Inativar', valor: 'inativar' }, { rotulo: 'Excluir definitivamente', valor: 'excluir', classe: 'perigo' }, { rotulo: 'Cancelar', valor: null, classe: 'sec' }],
    });
    if (!v) return;
    try {
      const r = await api(`/api/products/${p.id}${v === 'excluir' ? '?definitivo=1' : ''}`, { method: 'DELETE' });
      toast(r.excluido ? 'Produto excluído' : v === 'excluir' ? 'Produto já foi contado: foi inativado para manter o histórico' : 'Produto inativado', r.excluido ? 'ok' : '');
      st.produtos = null;
      location.hash = '#/produtos';
    } catch (err) { toast(err.message, 'erro'); }
  };
}, true);

// ============================================================ histórico
rota('historico', async (main, partes) => {
  if (partes[0]) return telaDetalheContagem(main, Number(partes[0]));
  const lista = await api('/api/counts');
  let busca = '';
  const render = () => {
    const f = lista.filter(c => !busca || norm(`${fmtData(c.data)} ${c.funcionaria} ${c.status === 'finalizada' ? 'finalizada' : 'em andamento'}`).includes(norm(busca)));
    $('#h-lista').innerHTML = f.length ? f.map(c => `
      <a class="lista-item" href="${c.status === 'finalizada' ? '#/historico/' + c.id : '#/contagem'}">
        <div class="corpo"><div class="titulo">${fmtData(c.data)} — ${esc(c.funcionaria)}</div>
          <div class="det">${c.status === 'finalizada'
            ? `Finalizada às ${esc(c.hora)} · ${c.contados} contados${c.nao_contados ? ` · ${c.nao_contados} não contados` : ''}`
            : `<span class="tag proximo">Em andamento</span> · ${c.itens} contados`}</div></div>
        <div class="acoes">${c.status === 'finalizada' ? `${c.urgentes ? `<span class="tag urgente">🔴 ${c.urgentes}</span>` : ''}${c.para_compra - c.urgentes > 0 ? `<span class="tag comprar">🟠 ${c.para_compra - c.urgentes}</span>` : ''}` : ''}</div>
        ${ic('right')}
      </a>`).join('') : '<div class="vazio">Nenhuma contagem ainda.</div>';
  };
  main.innerHTML = `
    <div class="page-head"><h1>${st.user.perfil === 'admin' ? 'HISTÓRICO' : 'MINHAS CONTAGENS'}</h1>
      ${st.user.perfil === 'admin' ? `<div class="acoes"><a class="btn peq sec" href="#/comparar">${ic('compare')} Comparar</a>
        <a class="btn peq sec" href="/api/export/historico?formato=xlsx">Excel</a><a class="btn peq sec" href="/api/export/historico?formato=pdf" target="_blank">PDF</a></div>` : ''}</div>
    <div class="busca" style="margin-bottom:12px">${ic('search')}<input type="search" id="h-busca" placeholder="Pesquisar por data ou funcionária…"></div>
    <div class="card" id="h-lista" style="padding-top:4px;padding-bottom:4px"></div>`;
  render();
  $('#h-busca').oninput = e => { busca = e.target.value; render(); };
});

async function telaDetalheContagem(main, id) {
  const d = await api(`/api/counts/${id}`);
  const c = d.contagem;
  if (c.status === 'em_andamento') { location.hash = '#/contagem' + (c.user_id === st.user.id ? '' : '/' + id); return; }
  let filtro = 'todos', busca = '';
  const contados = d.produtos.filter(p => d.itens[p.id]);
  const render = () => {
    const q = norm(busca);
    const f = contados.filter(p => {
      const it = d.itens[p.id];
      if (filtro === 'compra' && !['comprar', 'urgente'].includes(it.situacao)) return false;
      if (filtro === 'obs' && !it.observacao) return false;
      if (filtro === 'validade' && !(it.alerta_validade && it.alerta_validade.nivel !== 'normal')) return false;
      return !q || norm(`${p.nome} ${p.categoria} ${p.unidade} ${SIT[it.situacao]?.txt}`).includes(q);
    });
    let cat = '';
    $('#det-lista').innerHTML = f.length ? f.map(p => {
      const it = d.itens[p.id];
      const cab = p.categoria !== cat ? `<div class="grupo-cat"><h2><span>${esc(cat = p.categoria)}</span></h2></div>` : '';
      return `${cab}<div class="card" style="margin-top:8px;padding:12px 14px">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <div><div style="font-weight:800">${esc(p.nome)}</div>
            <div class="small muted" style="margin-top:3px">Registrado: <b style="color:var(--texto)">${descrRegistro(it, p)}</b>${it.motivo && it.situacao !== 'ok' ? ` · ${esc(it.motivo)}` : ''}</div></div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">${tagSit(it.situacao)}
            ${st.user.perfil === 'admin' ? `<a class="btn peq sec" href="#/contagem/${c.id}?p=${p.id}">${ic('edit')} Corrigir</a>` : ''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          ${it.validade ? `<span class="tag neutro">Validade ${fmtData(it.validade)}</span>${it.alerta_validade?.nivel !== 'normal' ? tagAlerta(alertaValidade(it.validade)) : ''}` : ''}
          ${it.data_abertura ? `<span class="tag neutro">Aberto em ${fmtData(it.data_abertura)} · limite ${fmtData(it.data_limite_aberto)}</span>` : ''}
          ${it.observacao ? `<span class="tag roxo">📝 ${esc(it.observacao)}</span>` : ''}
        </div></div>`;
    }).join('') : '<div class="card vazio">Nada com esse filtro.</div>';
  };
  main.innerHTML = `
    <div class="page-head"><h1>CONTAGEM DE ${fmtData(c.data)}</h1>
      <div class="acoes"><a class="btn peq sec" href="#/historico">${ic('left')} Histórico</a>
      ${st.user.perfil === 'admin' ? `<a class="btn peq sec" href="/api/export/historico?contagem=${c.id}&formato=xlsx">Excel</a><a class="btn peq sec" href="/api/export/historico?contagem=${c.id}&formato=pdf" target="_blank">PDF</a>` : ''}</div></div>
    <div class="card">
      <div class="aviso" style="border:0;padding:0"><div class="campos">
        <div><b>Funcionária</b>${esc(c.funcionaria)}</div><div><b>Data</b>${fmtData(c.data)}</div><div><b>Hora</b>${esc(c.hora)}</div>
        <div><b>Contados</b>${c.contados}</div><div><b>Não contados</b>${c.nao_contados}</div>
        <div><b>Para compra</b>${c.para_compra}</div><div><b>Urgentes</b>${c.urgentes}</div>
      </div></div>
      ${c.observacao ? `<p style="margin:12px 0 0"><b>Observação:</b> ${esc(c.observacao)}</p>` : ''}
    </div>
    <div class="barra-filtros">
      <div class="busca">${ic('search')}<input type="search" id="det-busca" placeholder="Pesquisar nesta contagem…"></div>
      <div class="chips">
        <button class="chip ativo" data-f="todos">Todos <span class="n">${contados.length}</span></button>
        <button class="chip" data-f="compra">Indicados para compra <span class="n">${contados.filter(p => ['comprar', 'urgente'].includes(d.itens[p.id].situacao)).length}</span></button>
        <button class="chip" data-f="validade">Alerta de validade</button>
        <button class="chip" data-f="obs">Com observação</button>
      </div>
    </div>
    <div id="det-lista"></div>`;
  render();
  $('#det-busca').oninput = e => { busca = e.target.value; render(); };
  $('.barra-filtros .chips', main).onclick = e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    filtro = b.dataset.f; $$('.barra-filtros .chip', main).forEach(x => x.classList.toggle('ativo', x === b)); render();
  };
}

// ============================================================ comparação
rota('comparar', async (main, partes, query) => {
  const lista = (await api('/api/counts')).filter(c => c.status === 'finalizada');
  if (lista.length < 2) {
    main.innerHTML = `<div class="page-head"><h1>COMPARAR CONTAGENS</h1></div><div class="card vazio">É preciso ter pelo menos duas contagens finalizadas.</div>`;
    return;
  }
  const a = Number(query.a) || lista[1].id, b = Number(query.b) || lista[0].id;
  const opt = sel => lista.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${fmtData(c.data)} — ${esc(c.funcionaria)}</option>`).join('');
  const r = await api(`/api/counts/compare?a=${a}&b=${b}`);
  const IND = {
    aumentou: ['up', '▲ Aumentou'], diminuiu: ['down', '▼ Diminuiu'], zerou: ['zero', '⛔ Zerou'], igual: ['eq', '＝ Igual'],
    entrou_baixo: ['down', '⚠ Entrou em estoque baixo'], saiu_compras: ['up', '✓ Saiu da lista de compras'],
    novo: ['eq', 'Só na 2ª contagem'], nao_contado: ['eq', 'Não contado na 2ª'],
  };
  let filtro = '';
  const render = () => {
    const f = r.linhas.filter(l => !filtro || l.indicadores.includes(filtro)).filter(l => filtro || !l.indicadores.every(i => i === 'igual'));
    $('#cmp-lista').innerHTML = f.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Produto</th><th>${fmtData(r.a.data)}</th><th>${fmtData(r.b.data)}</th><th>Mudança</th></tr></thead><tbody>
      ${f.map(l => `<tr><td><b>${esc(l.nome)}</b><div class="small muted">${esc(l.categoria)}</div></td>
        <td>${esc(l.antes)}<div>${l.situacao_antes ? `<span class="dot ${l.situacao_antes}"></span>` : ''}</div></td>
        <td>${esc(l.depois)}<div>${l.situacao_depois ? `<span class="dot ${l.situacao_depois}"></span>` : ''}</div></td>
        <td>${l.indicadores.map(i => `<div class="cmp-ind ${IND[i][0]}">${IND[i][1]}</div>`).join('')}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="vazio">Nenhuma mudança com esse filtro.</div>';
  };
  main.innerHTML = `
    <div class="page-head"><h1>COMPARAR CONTAGENS</h1></div>
    <div class="card"><div class="form-grid duas">
      <label class="campo"><span>Contagem anterior</span><select id="cmp-a">${opt(a)}</select></label>
      <label class="campo"><span>Contagem mais nova</span><select id="cmp-b">${opt(b)}</select></label>
    </div></div>
    <div class="grid grid-kpi" style="margin-top:12px">
      ${[['aumentou', 'Aumentou', ''], ['diminuiu', 'Diminuiu', 'baixo'], ['zerou', 'Zerou', 'urg'], ['entrou_baixo', 'Entrou em estoque baixo', 'baixo'], ['saiu_compras', 'Saiu da lista de compras', ''], ['igual', 'Sem mudança', '']]
        .map(([k, t, cl]) => `<button class="card kpi ${cl}" data-ind="${k}" style="text-align:left;cursor:pointer;font:inherit"><span class="rot">${t}</span><span class="val">${r.resumo[k] || 0}</span></button>`).join('')}
    </div>
    <div class="chips"><button class="chip ativo" data-ind="">Todas as mudanças</button></div>
    <div class="card" id="cmp-lista"></div>`;
  render();
  const ir = () => { location.hash = `#/comparar?a=${$('#cmp-a').value}&b=${$('#cmp-b').value}`; };
  $('#cmp-a').onchange = ir; $('#cmp-b').onchange = ir;
  main.onclick = e => {
    const k = e.target.closest('[data-ind]'); if (!k) return;
    filtro = k.dataset.ind;
    $$('[data-ind]', main).forEach(x => x.classList.toggle('ativo', x === k));
    render();
  };
}, true);

// ============================================================ vencimentos
rota('vencimentos', async (main, partes, query) => {
  const prods = await api('/api/products');
  let aba = query.aba === 'aberto' ? 'aberto' : 'validade', busca = '';
  const render = () => {
    const q = norm(busca);
    const f = prods.filter(p => !q || norm(`${p.nome} ${p.categoria} ${p.unidade}`).includes(q));
    let html = '';
    if (aba === 'validade') {
      const com = f.filter(p => p.validade).sort((x, y) => x.validade.localeCompare(y.validade));
      const alerta = com.filter(p => alertaValidade(p.validade).nivel !== 'normal');
      html = `<div class="card">${alerta.length ? alerta.map(p => `
          <a class="lista-item" href="#/produto/${p.id}"><div class="corpo"><div class="titulo">${esc(p.nome)}</div>
          <div class="det">${esc(p.categoria)} · Validade <b>${fmtData(p.validade)}</b>${p.armazenamento ? ` · ${esc(p.armazenamento)}` : ''}</div></div>
          <div class="acoes">${tagAlerta(alertaValidade(p.validade))}</div></a>`).join('') : '<div class="vazio">🟢 Nenhum produto vencido ou perto de vencer.</div>'}</div>
        <div class="card"><details class="dobra"><summary><b>Todos os produtos com validade (${com.length})</b>${ic('right')}</summary>
        ${com.map(p => `<a class="lista-item" href="#/produto/${p.id}"><div class="corpo"><div class="titulo">${esc(p.nome)}</div><div class="det">${fmtData(p.validade)}</div></div><div class="acoes">${tagAlerta(alertaValidade(p.validade))}</div></a>`).join('')}</details></div>`;
    } else {
      const abertos = f.filter(p => p.data_abertura && p.prazo_apos_aberto)
        .map(p => ({ p, a: alertaAberto(p.data_abertura, p.prazo_apos_aberto) })).sort((x, y) => x.a.limite.localeCompare(y.a.limite));
      html = `<div class="card">${abertos.length ? abertos.map(({ p, a }) => `
          <a class="lista-item" href="#/produto/${p.id}"><div class="corpo"><div class="titulo">${esc(p.nome)}</div>
          <div class="det">Aberto em <b>${fmtData(p.data_abertura)}</b> · prazo ${p.prazo_apos_aberto} dias · usar até <b>${fmtData(a.limite)}</b>${p.armazenamento ? ` · ${esc(p.armazenamento)}` : ''}</div></div>
          <div class="acoes">${tagAlerta(a)}</div></a>`).join('') : '<div class="vazio">Nenhum produto aberto registrado.</div>'}</div>
        <div class="card"><details class="dobra"><summary><b>Regras de prazo após aberto (${f.filter(p => p.prazo_apos_aberto).length})</b>${ic('right')}</summary>
        ${f.filter(p => p.prazo_apos_aberto).map(p => `<a class="lista-item" href="#/produto/${p.id}"><div class="corpo"><div class="titulo">${esc(p.nome)}</div><div class="det">${p.prazo_apos_aberto} dias · ${esc(p.armazenamento || '')}</div></div></a>`).join('')}</details></div>`;
    }
    $('#v-corpo').innerHTML = html;
  };
  main.innerHTML = `
    <div class="page-head"><h1>VENCIMENTOS</h1><div class="acoes"><a class="btn peq sec" href="/api/export/vencimentos?formato=xlsx">Excel</a><a class="btn peq sec" href="/api/export/vencimentos?formato=pdf" target="_blank">PDF</a></div></div>
    <div class="abas"><button data-aba="validade" class="${aba === 'validade' ? 'ativo' : ''}">Validade</button><button data-aba="aberto" class="${aba === 'aberto' ? 'ativo' : ''}">Após aberto</button></div>
    <div class="busca" style="margin-bottom:12px">${ic('search')}<input type="search" id="v-busca" placeholder="Pesquisar…"></div>
    <div id="v-corpo"></div>`;
  render();
  $('#v-busca').oninput = e => { busca = e.target.value; render(); };
  $('.abas', main).onclick = e => {
    const b = e.target.closest('[data-aba]'); if (!b) return;
    aba = b.dataset.aba; $$('.abas button', main).forEach(x => x.classList.toggle('ativo', x === b)); render();
  };
}, true);

// ============================================================ configurações
rota('config', async main => {
  const cfg = await api('/api/config');
  const prods = await api('/api/products');
  const especiais = prods.filter(p => p.regra_estoque !== 'categoria' || p.estoque_minimo != null);
  main.innerHTML = `
    <div class="page-head"><h1>CONFIGURAÇÕES DE ESTOQUE</h1></div>
    <form id="f-cfg">
      <div class="card">
        <div class="secao-titulo" style="margin-top:0">Alertas</div>
        <div class="form-grid duas">
          <label class="campo"><span>Avisar sobre validade com quantos dias de antecedência?</span><input type="number" min="0" max="365" name="alerta_validade_dias" value="${cfg.settings.alerta_validade_dias}" inputmode="numeric"><span class="dica">Padrão: 7 dias antes do vencimento.</span></label>
          <label class="campo"><span>Avisar sobre prazo após aberto com quantos dias?</span><input type="number" min="0" max="365" name="alerta_aberto_dias" value="${cfg.settings.alerta_aberto_dias}" inputmode="numeric"><span class="dica">Mostra 🟡 ATENÇÃO quando faltar isso ou menos.</span></label>
        </div>
      </div>
      <div class="card">
        <div class="secao-titulo" style="margin-top:0">Regra de compra por categoria</div>
        <p class="small muted" style="margin-top:0">Vale para todos os produtos da categoria que usam "regra da categoria". Produtos com regra própria (lista abaixo) não mudam.</p>
        ${cfg.categorias.map(c => `
          <div class="form-grid duas" data-categoria="${esc(c.nome)}" style="border-top:1px solid var(--borda);padding-top:12px">
            <label class="campo"><span>${esc(c.nome)}</span><select name="regra">${Object.entries(REGRA_CURTA).map(([k, v]) => `<option value="${k}" ${c.regra === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="campo"><span>Quantidade mínima para compra</span><input type="number" min="0" name="minimo" value="${c.estoque_minimo}" inputmode="numeric"><span class="dica">Compra quando tiver menos que isso.</span></label>
          </div>`).join('')}
        <label class="campo" style="margin-top:8px"><span>Nova categoria (opcional)</span><input type="text" name="nova_categoria" placeholder="Ex.: EMBALAGENS"></label>
      </div>
      <button class="btn grande" type="submit" style="margin-top:12px">${ic('check')} SALVAR CONFIGURAÇÕES</button>
    </form>
    <div class="secao-titulo">Validades</div>
    <div class="card">
      <p style="margin-top:0">Hoje <b>${prods.filter(p => p.validade).length}</b> produto(s) têm data de validade cadastrada.</p>
      <p class="small muted">Apaga a data de validade de <b>todos</b> os produtos. As funcionárias podem informar novas datas na próxima contagem. As contagens antigas no histórico não mudam.</p>
      <button class="btn perigo" id="limpar-validades" ${prods.some(p => p.validade) ? '' : 'disabled'}>Limpar validade de todos os produtos</button>
    </div>
    <div class="secao-titulo">Produtos com regra especial (${especiais.length})</div>
    <div class="card" style="padding-top:4px;padding-bottom:4px">
      ${especiais.map(p => `<a class="lista-item" href="#/produto/${p.id}"><div class="corpo"><div class="titulo">${esc(p.nome)}</div>
        <div class="det">${REGRA_CURTA[p.regra_efetiva]}${p.regra_efetiva === 'minimo' ? ` · mínimo ${p.minimo_efetivo}` : ''} · ${esc(p.unidade)}</div></div>${ic('right')}</a>`).join('') || '<div class="vazio">Nenhum</div>'}
    </div>
    <p class="small muted">Para dar uma regra especial a outro produto, abra o produto em <a href="#/produtos">Produtos</a> e mude a "Regra de reposição" ou o "Estoque mínimo".
    Os prazos após aberto também são editados no cadastro de cada produto (veja todos em <a href="#/vencimentos?aba=aberto">Vencimentos › Após aberto</a>).</p>`;
  $('#limpar-validades').onclick = async () => {
    const n = prods.filter(p => p.validade).length;
    const ok = await confirmar('Limpar todas as validades?',
      `<p>Isso apaga a data de validade de <b>${n} produto(s)</b>. Não dá para desfazer.</p>`, 'Sim, limpar validades', 'perigo');
    if (!ok) return;
    try {
      const r = await api('/api/products/limpar-validades', { method: 'POST', body: { confirmar: 'LIMPAR' } });
      st.produtos = null;
      toast(`Validade apagada de ${r.limpos} produto(s) ✓`, 'ok');
      navegar();
    } catch (err) { toast(err.message, 'erro'); }
  };
  $('#f-cfg').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const body = {
      settings: { alerta_validade_dias: f.alerta_validade_dias.value, alerta_aberto_dias: f.alerta_aberto_dias.value },
      categorias: $$('[data-categoria]', f).map(el => ({ nome: el.dataset.categoria, regra: $('[name=regra]', el).value, estoque_minimo: $('[name=minimo]', el).value })),
      nova_categoria: f.nova_categoria.value,
    };
    try { await api('/api/config', { method: 'PUT', body }); st.boot = null; toast('Configurações salvas ✓', 'ok'); navegar(); }
    catch (err) { toast(err.message, 'erro'); }
  };
}, true);

// ============================================================ funcionárias
rota('usuarias', async main => {
  const us = await api('/api/users');
  main.innerHTML = `
    <div class="page-head"><h1>FUNCIONÁRIAS E ACESSOS</h1></div>
    <form class="card" id="f-nova">
      <div class="secao-titulo" style="margin-top:0">Cadastrar nova</div>
      <div class="form-grid duas">
        <label class="campo"><span>Nome</span><input type="text" name="nome" required placeholder="Ex.: Vitória"></label>
        <label class="campo"><span>Login</span><input type="text" name="login" required autocapitalize="none" placeholder="Ex.: vitoria"></label>
        <label class="campo"><span>Senha</span><input type="text" name="senha" required minlength="4"></label>
        <label class="campo"><span>Perfil</span><select name="perfil"><option value="funcionaria">Funcionária</option><option value="admin">Administradora</option></select></label>
      </div>
      <button class="btn" type="submit">${ic('plus')} Cadastrar</button>
    </form>
    <div class="secao-titulo">Cadastradas</div>
    <div class="card" style="padding-top:4px;padding-bottom:4px">${us.map(u => `
      <div class="lista-item empilha"><div class="corpo"><div class="titulo">${esc(u.nome)} ${u.ativo ? '' : '<span class="tag inativo">INATIVA</span>'}</div>
        <div class="det">Login: <b>${esc(u.login)}</b> · ${u.perfil === 'admin' ? 'Administradora' : 'Funcionária'}</div></div>
        <div class="acoes" style="flex-direction:row;flex-wrap:wrap">
          <button class="btn peq sec" data-senha="${u.id}">Nova senha</button>
          <button class="btn peq ${u.ativo ? 'perigo' : 'sec'}" data-ativo="${u.id}" data-v="${u.ativo ? 0 : 1}">${u.ativo ? 'Desativar' : 'Reativar'}</button>
        </div></div>`).join('')}</div>`;
  $('#f-nova').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try { await api('/api/users', { method: 'POST', body: fd }); toast('Cadastrada ✓', 'ok'); navegar(); }
    catch (err) { toast(err.message, 'erro'); }
  };
  main.onclick = async e => {
    const s = e.target.closest('[data-senha]');
    if (s) {
      const senha = prompt('Nova senha (mínimo 4 caracteres):');
      if (!senha) return;
      try { await api(`/api/users/${s.dataset.senha}`, { method: 'PUT', body: { senha } }); toast('Senha alterada ✓', 'ok'); }
      catch (err) { toast(err.message, 'erro'); }
    }
    const a = e.target.closest('[data-ativo]');
    if (a) {
      try { await api(`/api/users/${a.dataset.ativo}`, { method: 'PUT', body: { ativo: a.dataset.v === '1' } }); navegar(); }
      catch (err) { toast(err.message, 'erro'); }
    }
  };
}, true);

// ============================================================ importar / exportar
rota('dados', async main => {
  const tipos = [['estoque', 'Lista de estoque'], ['historico', 'Histórico de contagens'], ['compras', 'Lista de compras'], ['vencimentos', 'Produtos próximos do vencimento'], ['completo', 'Relatório completo']];
  main.innerHTML = `
    <div class="page-head"><h1>IMPORTAR / EXPORTAR</h1></div>
    <div class="card">
      <div class="secao-titulo" style="margin-top:0">Importar planilha</div>
      <p class="small muted" style="margin-top:0">Envie um arquivo Excel (.xlsx) com a aba de produtos (Produto, Tipo, Categoria, Validade…) e, se tiver, a aba "APOS ABERTO". Produtos que já existem não são duplicados.</p>
      <input type="file" id="arq" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="margin-bottom:10px">
      <button class="btn bloco" id="btn-importar">${ic('data')} IMPORTAR PLANILHA</button>
      <div id="imp-res"></div>
    </div>
    <div class="card">
      <div class="secao-titulo" style="margin-top:0">Exportar</div>
      ${tipos.map(([k, t]) => `<div class="lista-item"><div class="corpo"><div class="titulo">${t}</div></div>
        <div class="acoes" style="flex-direction:row"><a class="btn peq sec" href="/api/export/${k}?formato=xlsx">Excel</a><a class="btn peq sec" href="/api/export/${k}?formato=pdf" target="_blank">PDF</a></div></div>`).join('')}
    </div>`;
  $('#btn-importar').onclick = async () => {
    const f = $('#arq').files[0];
    if (!f) { toast('Escolha o arquivo .xlsx', 'erro'); return; }
    const b = $('#btn-importar'); b.disabled = true; b.textContent = 'Importando…';
    try {
      const r = await api('/api/import', { method: 'POST', body: await f.arrayBuffer(), headers: { 'Content-Type': 'application/octet-stream' } });
      st.boot = null; st.produtos = null;
      $('#imp-res').innerHTML = `
        <div class="card" style="margin-top:14px;background:var(--verde-claro);border-color:#bfe6cc">
          <h3 style="color:var(--verde);margin-bottom:8px">✓ Importação concluída</h3>
          <div class="aviso" style="border:0;padding:0;background:transparent"><div class="campos">
            <div><b>Produtos novos</b>${r.novos}</div><div><b>Produtos atualizados</b>${r.atualizados}</div>
            <div><b>Duplicados ignorados</b>${r.duplicados}</div><div><b>Erros</b>${r.erros}</div>
            <div><b>Regras após aberto</b>${r.regras_aplicadas} aplicadas</div>
          </div></div>
          <p class="small" style="margin-bottom:0"><b>Categorias:</b> ${r.categorias.map(esc).join(', ')}<br><b>Unidades:</b> ${r.unidades.map(esc).join(', ')}</p>
          ${r.mensagens_erro.length ? `<p class="small" style="color:var(--vermelho)">${r.mensagens_erro.map(esc).join('<br>')}</p>` : ''}
          ${r.regras_sem_produto.length ? `<p class="small muted">Regras da aba APÓS ABERTO sem produto correspondente: ${r.regras_sem_produto.map(esc).join(', ')}</p>` : ''}
        </div>`;
    } catch (err) { toast(err.message, 'erro'); }
    b.disabled = false; b.innerHTML = `${ic('data')} IMPORTAR PLANILHA`;
  };
}, true);

// ============================================================ conta / mais
rota('conta', async main => {
  main.innerHTML = `
    <div class="page-head"><h1>MINHA CONTA</h1></div>
    <div class="card"><p style="margin-top:0"><b>${esc(st.user.nome)}</b><br><span class="muted">Login: ${esc(st.user.login)} · ${st.user.perfil === 'admin' ? 'Administradora' : 'Funcionária'}</span></p></div>
    <form class="card" id="f-senha">
      <div class="secao-titulo" style="margin-top:0">Trocar senha</div>
      <label class="campo"><span>Senha atual</span><input type="password" name="atual" required autocomplete="current-password"></label>
      <label class="campo"><span>Nova senha</span><input type="password" name="nova" required minlength="4" autocomplete="new-password"></label>
      <button class="btn" type="submit">Salvar nova senha</button>
    </form>
    <button class="btn grande sec" id="sair2" style="margin-top:14px">${ic('logout')} SAIR</button>`;
  $('#f-senha').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/me/senha', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Senha alterada ✓', 'ok'); e.target.reset(); }
    catch (err) { toast(err.message, 'erro'); }
  };
  $('#sair2').onclick = sair;
});

rota('mais', async main => {
  const itens = navItens().lado.filter(Boolean).filter(i => !['painel', 'contagem', 'compras', 'historico'].includes(i[0]));
  main.innerHTML = `<div class="page-head"><h1>MAIS OPÇÕES</h1></div>
    <div class="card" style="padding-top:4px;padding-bottom:4px">${itens.map(i => `<a class="lista-item" href="#/${i[0]}" style="align-items:center">${ic(i[1])}<div class="corpo"><div class="titulo">${i[2]}</div></div>${ic('right')}</a>`).join('')}
    <a class="lista-item" href="#/login" id="mais-sair" style="align-items:center">${ic('logout')}<div class="corpo"><div class="titulo">Sair</div></div></a></div>`;
  $('#mais-sair').onclick = e => { e.preventDefault(); sair(); };
}, true);

// ============================================================ busca global
async function abrirBuscaGlobal() {
  if (!st.produtos) st.produtos = await api('/api/products');
  const f = document.createElement('div');
  f.className = 'busca-global';
  f.innerHTML = `<div class="caixa">
    <div style="display:flex;gap:8px"><div class="busca" style="flex:1">${ic('search')}<input type="search" id="bg-q" placeholder="Nome, categoria, tipo ou status (ex.: urgente, vencido)"></div>
      <button class="btn sec" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="resultados" id="bg-res"><div class="vazio">Digite para pesquisar em todos os produtos.</div></div></div>`;
  document.body.appendChild(f);
  const inp = $('#bg-q', f); inp.focus();
  const emContagem = location.hash.startsWith('#/contagem') && C.d && !correcao();
  inp.oninput = () => {
    const q = norm(inp.value).trim();
    if (!q) { $('#bg-res', f).innerHTML = '<div class="vazio">Digite para pesquisar em todos os produtos.</div>'; return; }
    const res = st.produtos.filter(p => {
      const status = [p.situacao_texto, p.alerta_validade?.nivel === 'vencido' ? 'vencido' : '', p.alerta_validade?.nivel === 'proximo' ? 'proximo do vencimento vencendo' : '',
        p.alerta_aberto && p.alerta_aberto.nivel !== 'normal' ? 'apos aberto expirado atencao' : '', p.situacao === 'comprar' ? 'estoque baixo' : '', p.situacao === 'urgente' ? 'urgente zerado' : ''].join(' ');
      const alvo = norm(`${p.nome} ${p.categoria} ${p.unidade} ${status}`);
      return q.split(/\s+/).every(t => alvo.includes(t));
    }).slice(0, 60);
    $('#bg-res', f).innerHTML = res.length ? res.map(p => `
      <button class="item-lista" data-p="${p.id}"><span class="dot ${p.situacao || 'nc'}"></span>
        <span class="info"><div class="nome">${esc(p.nome)}</div><div class="meta"><span class="tag roxo">${esc(p.categoria)}</span><span class="tag neutro">${esc(p.unidade)}</span>
        ${p.situacao ? tagSit(p.situacao) : ''}${p.alerta_validade && p.alerta_validade.nivel !== 'normal' ? tagAlerta(alertaValidade(p.validade)) : ''}</div></span>
        <span class="res small muted">${esc(p.estoque_texto || '')}</span></button>`).join('') : '<div class="vazio">Nada encontrado.</div>';
  };
  f.onclick = e => {
    if (e.target === f || e.target.closest('[data-fechar]')) { f.remove(); return; }
    const b = e.target.closest('[data-p]');
    if (!b) return;
    f.remove();
    const id = Number(b.dataset.p);
    if (emContagem) { abrirProduto(id); return; }
    if (st.user.perfil === 'admin') location.hash = `#/produto/${id}`;
    else location.hash = `#/contagem?p=${id}`;
  };
}

// ============================================================ início
navegar();
