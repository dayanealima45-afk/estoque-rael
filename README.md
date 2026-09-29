# ESTOQUE RAEL SORVETES

Sistema web de controle e contagem de estoque da Rael Sorvetes. Funciona no celular, tablet e computador.

## Como rodar

Precisa do **Node.js 22.13 ou mais novo** (https://nodejs.org).

```bash
npm install
npm start
```

Abra http://localhost:3000. No primeiro início o sistema:

- cria o banco de dados em `data/estoque.db` (SQLite, um arquivo só);
- importa os 99 produtos de `data/planilha-inicial.xlsx` (a planilha original) e as regras da aba APÓS ABERTO;
- cria a administradora: login **admin**, senha **rael2026**. Troque a senha em *Minha conta*.

Para as funcionárias usarem pelo celular na mesma rede Wi-Fi, abra `http://IP-DO-COMPUTADOR:3000`.
Para usar de qualquer lugar, hospede em um serviço que rode Node.js e que guarde a pasta `data/`.

Variáveis opcionais: `PORT` (porta), `ADMIN_LOGIN` / `ADMIN_SENHA` (primeira administradora), `DB_FILE` (caminho do banco).

**Backup:** copie o arquivo `data/estoque.db` (com o sistema parado) ou use *Importar/Exportar › Relatório completo*.

## Testes

```bash
npm test
```

Sobe o sistema com um banco temporário e testa: cadastro de produto, login das duas perfis, contagem, finalização,
lista de compras, regras de descartáveis/insumos/baldes/Nutella e cremes, validade, prazo após aberto, histórico,
comparação, marcar como comprado/desfazer, regras configuráveis e exportação Excel/PDF.

## Regras de compra (padrão, todas mudáveis em Configurações ou no cadastro do produto)

| Produto | Regra |
|---|---|
| Descartáveis | compra com menos de 3 (pacote/caixa/rolo). 0 = urgente |
| Insumos padrão | compra com menos de 3. 0 = urgente |
| Material de limpeza / de uso | compra com menos de 3. 0 = urgente |
| Baldes, Nutella 3KG, Creme de Ovomaltine, Kit Kat Pasta, Doce de Leite Pasta | compra em 1/4; zerado = urgente; aberto **não** compra |
| Balde com a regra "aberto já compra" | compra em aberto ou 1/4; zerado = urgente |

Aberto nunca vira compra sozinho. Um produto contado por quantidade que tem 0 fechados e 1 aberto entra como "comprar", não "urgente".

## Estrutura

- `server.js` — servidor e rotas da API
- `src/db.js` — tabelas (users, products, stock_counts, stock_count_items, purchase_items, product_history, notifications, categories, settings, audit_log)
- `src/rules.js` — regras de compra, validade e prazo após aberto
- `src/importer.js` / `src/matcher.js` — importação da planilha e ligação dos nomes das duas abas
- `src/exporter.js` — Excel e PDF
- `public/` — telas (HTML, CSS e JavaScript, sem etapa de build)

## Colocar na internet (Railway)

O sistema já vem pronto para hospedar com o `Dockerfile` desta pasta. O banco fica em um volume, então os dados não se perdem quando o servidor reinicia.

1. Crie uma conta em https://railway.com (pode entrar com o GitHub).
2. **New Project › Deploy from GitHub repo** e escolha o repositório deste sistema.
3. Em **Variables**, crie `ADMIN_SENHA` com a senha da administradora (não use `rael2026`).
4. Clique com o botão direito no serviço › **Attach Volume**, com o caminho de montagem `/data`.
5. Em **Settings › Networking › Generate Domain**. O endereço gerado (ex.: `estoque-rael.up.railway.app`) é o que as funcionárias abrem no celular.

No celular, abra o endereço no navegador e use "Adicionar à tela inicial" para ficar como um aplicativo.
