# Site Externo Nascimento — Documento de Replicação Completa

> **Para quem é este documento:** para uma IA (ou pessoa) que nunca viu este projeto e precisa
> **entender e reconstruir o sistema inteiro do zero** em outro ambiente.
>
> Tudo aqui foi extraído lendo o código real (não a documentação antiga). Onde o `README.md`
> ou o `database/schema.sql` divergem da realidade, isso está **explicitamente sinalizado**.
>
> **Leia a seção [§14 — Armadilhas](#14-armadilhas-e-dívidas-técnicas-leia-antes-de-mexer) antes de alterar qualquer coisa.**

---

## Índice

1. [O que o sistema faz (domínio de negócio)](#1-o-que-o-sistema-faz-domínio-de-negócio)
2. [Stack e topologia de produção](#2-stack-e-topologia-de-produção)
3. [Estrutura de pastas](#3-estrutura-de-pastas)
4. [Variáveis de ambiente](#4-variáveis-de-ambiente)
5. [Modelo de dados REAL](#5-modelo-de-dados-real)
6. [Arquitetura do backend](#6-arquitetura-do-backend)
7. [Referência completa da API](#7-referência-completa-da-api)
8. [Módulo A — Pedidos de Equipamentos](#8-módulo-a--pedidos-de-equipamentos)
9. [Módulo B — Solicitação de Vagas](#9-módulo-b--solicitação-de-vagas)
10. [Módulo C — Solicitação de Demissão](#10-módulo-c--solicitação-de-demissão)
11. [Módulo D — Painel Admin e aprovação de catálogo](#11-módulo-d--painel-admin-e-aprovação-de-catálogo)
12. [Integração com o ERP (contrato completo)](#12-integração-com-o-erp-contrato-completo)
13. [Frontend — convenções e design system](#13-frontend--convenções-e-design-system)
14. [Armadilhas e dívidas técnicas](#14-armadilhas-e-dívidas-técnicas-leia-antes-de-mexer)
15. [Deploy](#15-deploy)
16. [Inventário de scripts utilitários](#16-inventário-de-scripts-utilitários)
17. [Checklist de replicação passo a passo](#17-checklist-de-replicação-passo-a-passo)

---

## 1. O que o sistema faz (domínio de negócio)

O **Grupo Nascimento** é uma empresa de terceirização de serviços (limpeza, portaria, motoristas,
jardinagem, telefonia, coleta de lixo…). Ela opera dezenas de **contratos** com órgãos públicos
(UFRGS, TJRS, HCPA, Polícia Civil, prefeituras…). Em cada contrato existem **postos** (locais/unidades),
em cada posto existem **funções** (cargos), e cada função tem um **enxoval** de uniformes/EPIs.

Este repositório é o **"Site Externo"** (também chamado internamente de **Site 1**): um portal público,
**sem cadastro de usuário**, usado pelos **encarregados de campo** para abrir três tipos de solicitação:

| Módulo | O que faz | Quem usa |
|---|---|---|
| **Área de Pedidos** | Pede uniformes/EPIs/insumos para um colaborador | Encarregado do posto |
| **Solicitar Vaga** | Abre uma requisição de contratação | Encarregado do posto |
| **Solicitar Demissão** | Abre uma requisição de desligamento | Encarregado do posto |
| **Painel Admin** *(oculto)* | Edita o catálogo (contratos → postos → funções → itens) | TI / Compras |

Toda solicitação criada é **espelhada por webhook para o ERP interno** (`api.grpnascimento.com.br`),
onde os setores Operacional / RH / Treinamentos aprovam ou reprovam. O ERP devolve o resultado por
**callback HTTP** de volta para este site, que atualiza o status e mostra ao encarregado.

O encarregado acompanha tudo por um **ID de protocolo** (`PED-…`, `VAGA-…`, `DEMISS-…`) — não há login.

### Fluxo macro

```
┌──────────────────────────────┐         POST webhook          ┌─────────────────────┐
│  SITE EXTERNO (este repo)    │  ───────────────────────────► │       ERP           │
│  Vercel (front) + Render(API)│                               │ api.grpnascimento…  │
│  PostgreSQL próprio          │  ◄─────────────────────────── │ Operacional/RH/Trein│
└──────────────────────────────┘   PUT callback (x-api-key)    └─────────────────────┘
        ▲
        │ ID de protocolo (sem login)
   Encarregado de campo
```

---

## 2. Stack e topologia de produção

### Backend
- **Node.js 18+ / Express 4** (JavaScript puro, CommonJS, sem TypeScript, sem build)
- **PostgreSQL** via `pg` (driver nativo, **sem ORM** — SQL escrito à mão)
- Dependências (`backend/package.json`): `express`, `cors`, `morgan`, `dotenv`, `pg`,
  `axios`, `jsonwebtoken`, `express-validator`, `node-fetch@2`. Dev: `nodemon`.
- `express-validator` está instalado mas **não é usado** — validação é manual nos controllers.

### Frontend
- **HTML + CSS + JavaScript vanilla**. Zero framework, zero bundler, zero `npm`.
- Multi-page application: cada tela é um `index.html` próprio com `script.js` e `style.css` ao lado.
- Estado entre telas: **`sessionStorage`**. Sessão admin: **`sessionStorage.admin_token`** (JWT).
- Única dependência externa: **SheetJS (`XLSX`)** via `<script>` no Painel Admin, para exportar `.xlsx`.

### URLs de produção (estado atual do código)

| Item | URL |
|---|---|
| Frontend | `https://site-externo-nascimento.vercel.app` |
| **Backend API (atual)** | `https://api.mustaches.com.br/api` |
| Backend API (legado) | `https://site-externo-nascimento.onrender.com` |
| ERP (destino dos webhooks) | `https://api.grpnascimento.com.br` |
| Repositório | `github.com/desenvolvimentohagg-dev/site-externo-nascimento` |

> ⚠️ O `README.md` do repo ainda cita Railway e `onrender.com`. **A produção real hoje aponta para
> `api.mustaches.com.br`**, hardcoded em 5 arquivos de frontend (ver §14.9).

---

## 3. Estrutura de pastas

```
Site Externo Nascimento/
├── ARQUITETURA-COMPLETA.md     ← este arquivo
├── README.md                   ← ⚠️ desatualizado (Railway, schema antigo)
├── railway.json                ← legado (build/start commands do Railway)
├── deploy.sh                   ← legado (git push --force para repo antigo)
│
├── backend/                    ← API REST (roda no Render)
│   ├── server.js               ← ⭐ entry point + AUTO-MIGRAÇÕES (ver §6.3) — 727 linhas
│   ├── package.json            ← postinstall roda setup-database.js
│   ├── .env.example            ← template de dev
│   ├── .env.render             ← ⚠️ valores REAIS de produção, COMMITADO no git (§14.10)
│   ├── setup-database.js       ← executa database/schema.sql (idempotente-ish)
│   │
│   ├── config/
│   │   ├── database.js         ← Pool pg (max 20) + query() + getClient() + testarConexao()
│   │   └── dados_vagas_cascata.json  ← ⭐ catálogo de VAGAS (68 contratos / 387 postos / 671 locais)
│   │
│   ├── routes/                 ← só mapeia URL → controller
│   │   ├── index.js            ├── pedidoRoutes.js         ├── catalogoRoutes.js
│   │   ├── catalogoVagasRoutes.js  (lê o JSON, não o banco)
│   │   ├── solicitacaoVagaRoutes.js├── solicitacaoDemissaoRoutes.js
│   │   ├── adminRoutes.js      └── adminCatalogoRoutes.js  └── alteracaoCatalogoRoutes.js
│   │
│   ├── controllers/            ← validação + regra de negócio + webhooks
│   │   ├── pedidoController.js       ├── catalogoController.js
│   │   ├── solicitacaoVagaController.js  ├── solicitacaoDemissaoController.js
│   │   ├── adminController.js        ├── adminCatalogoController.js
│   │   └── alteracaoCatalogoController.js
│   │
│   ├── models/                 ← SQL puro + transações
│   │   ├── pedidoModel.js      ├── catalogoModel.js
│   │   ├── solicitacaoVagaModel.js   ├── solicitacaoDemissaoModel.js
│   │   ├── adminCatalogoModel.js     └── alteracaoCatalogoModel.js
│   │
│   ├── middlewares/
│   │   ├── erpAuth.js          ← valida header x-api-key contra ERP_API_KEY
│   │   ├── adminAuth.js        ← valida JWT Bearer, exige role === 'admin'
│   │   └── errorHandler.js     ← errorHandler + notFound + requestLogger
│   │
│   ├── utils/helpers.js        ← formatarData, validarEmail, gerarIdPedido…
│   ├── api-consumida/          ← docs da integração com o "Site 2"
│   └── *.js (raiz)             ← ~40 scripts pontuais de migração/seed (ver §16)
│
├── database/
│   ├── schema.sql              ← ⚠️ OBSOLETO — hierarquia antiga. NÃO É A VERDADE (§5)
│   ├── migracao-*.sql          ← migrações incrementais (vaga, demissão, tipo_pedido, status…)
│   ├── mockdata*.js, equipamentos_opcoes*.js  ← seeds do catálogo
│   └── *.py, *.xlsx            ← scripts de importação de planilhas (uso único, histórico)
│
└── frontend/
    ├── telaInicial/            ← ⚠️ splash legado, FORA do root do Vercel → inacessível em prod
    └── dashboardInicial/       ← ⭐ ROOT DO DEPLOY VERCEL
        ├── index.html/.js/.css ← menu principal + modal de login admin (botão "⋮")
        ├── vercel.json         ← { rewrites: [{ source:"/(.*)", destination:"/" }] }
        └── pages/
            ├── AreaDePedidos/
            │   ├── index.html  (menu: Fazer / Consultar)
            │   └── pages/
            │       ├── FazerPedido/         index.html + script.js (form inicial)
            │       │   └── pages/  api.js, selecionarContrato.*, selecionarFuncao.*,
            │       │                selecionarEquipamentos.*, selecionarInsumos.*, confirmacao.*
            │       └── ConsultarPedido/     index.html + script.js + api.js
            ├── SolicitarVaga/     index.html + pages/{api.js, CriarSolicitacao, ConsultarSolicitacao}
            ├── SolicitarDemissao/ index.html + pages/{api.js, CriarSolicitacao, ConsultarSolicitacao}
            └── PainelAdmin/       index.html + script.js + style.css
```

---

## 4. Variáveis de ambiente

Todas lidas via `dotenv` a partir de `backend/.env`.
`config/database.js` aceita **dois conjuntos de nomes** para o banco: prefere `PG*`
(que o Render injeta automaticamente) e cai para `DB_*`.

| Variável | Obrigatória | Função |
|---|:---:|---|
| `PORT` | não | Porta HTTP. Default `4000`. |
| `NODE_ENV` | **sim** | `production` **liga SSL no Postgres** (`rejectUnauthorized:false`). Em `development` o SSL fica desligado e `morgan('dev')` é ativado. |
| `PGHOST` / `DB_HOST` | **sim** | Host do Postgres |
| `PGPORT` / `DB_PORT` | não | Default `5432` |
| `PGUSER` / `DB_USER` | **sim** | Usuário |
| `PGPASSWORD` / `DB_PASSWORD` | **sim** | Senha |
| `PGDATABASE` / `DB_NAME` | **sim** | Nome do banco |
| `CORS_ORIGIN` | não | **Declarada mas IGNORADA** — o CORS está aberto (§14.5) |
| `UPLOADS_PATH` | recomendada | Diretório das fotos de crachá. Default `backend/uploads`. Sem disco persistente, os arquivos somem a cada deploy (§14.12) |
| `ERP_API_URL` | **sim** | Base do ERP. Prod: `https://api.grpnascimento.com.br`. Dev: `http://localhost:5012` |
| `API_KEY_ERP` | **sim** | Chave de **saída** para vagas, demissões e catálogo |
| `API_KEY_ERP_PEDIDOS` | **sim** | Chave de **saída** só para pedidos (fallback: `API_KEY_ERP`) |
| `ERP_API_KEY` | **sim** | Chave de **entrada** — valida `x-api-key` dos callbacks do ERP |
| `ADMIN_LOGIN` | **sim** | Login do Painel Admin |
| `ADMIN_PASSWORD` | **sim** | Senha em **texto plano** comparada via `crypto.timingSafeEqual` (§14.19) |
| `ADMIN_JWT_SECRET` | **sim** | Segredo HS256 do JWT admin (expira em 8h) |

**Onde estão os valores reais:** `backend/.env.render` (arquivo commitado). **Não duplique os
segredos em novos arquivos** — no ambiente novo, gere chaves novas e mova esse arquivo para fora
do git (ver §14.10).

> 🔑 **Atenção à assimetria dos nomes:** `API_KEY_ERP*` = eu chamo o ERP (saída).
> `ERP_API_KEY` = o ERP me chama (entrada). São variáveis diferentes com nomes quase iguais.
> Em produção hoje ambas têm o mesmo valor, mas o código as trata como independentes.

---

## 5. Modelo de dados REAL

> 🚨 **`database/schema.sql` NÃO reflete o banco de produção.** Ele descreve a hierarquia antiga
> (`funcoes.contrato_id`, `postos` sem `contrato_id`, `equipamentos` sem `tipo`). A estrutura real
> foi recriada pelos scripts `migrar-nova-estrutura-v2.js` / `migrar-v4.js` e depois evoluída pelas
> auto-migrações do `server.js`. **A verdade é o DDL abaixo.**

### 5.1 Hierarquia do catálogo de pedidos (4 níveis, em cascata)

```
contratos ──1:N──► postos ──1:N──► funcoes ──1:N──► equipamentos
   │                 │               │                  │
 "TJRS - 023.2025"  "TJRS-1"    "SERVENTE"      "CAMISETA - AZUL (MC)" (tipo: uniforme)
                                                 "LUVA DE LATEX"      (tipo: epi)

equipamento_opcoes ← ligado por NOME (string), GLOBAL, fora da hierarquia (§14.6)
```

### 5.2 DDL completo para recriar do zero

```sql
-- ============================================================
-- CATÁLOGO (hierarquia em cascata)
-- ============================================================
CREATE TABLE contratos (
    id            SERIAL PRIMARY KEY,
    nome          VARCHAR(255) UNIQUE NOT NULL,
    descricao     TEXT,
    ativo         BOOLEAN DEFAULT TRUE,
    aprovado_erp  BOOLEAN DEFAULT TRUE,      -- FALSE enquanto aguarda aprovação do ERP
    data_criacao      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE postos (
    id            SERIAL PRIMARY KEY,
    contrato_id   INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    nome          VARCHAR(255) NOT NULL,
    descricao     TEXT,
    ativo         BOOLEAN DEFAULT TRUE,
    aprovado_erp  BOOLEAN DEFAULT TRUE,
    data_criacao      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (contrato_id, nome)
);

CREATE TABLE funcoes (
    id            SERIAL PRIMARY KEY,
    posto_id      INTEGER NOT NULL REFERENCES postos(id) ON DELETE CASCADE,
    nome          VARCHAR(255) NOT NULL,
    ativo         BOOLEAN DEFAULT TRUE,
    aprovado_erp  BOOLEAN DEFAULT TRUE,
    data_criacao      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (posto_id, nome)
);

CREATE TABLE equipamentos (
    id            SERIAL PRIMARY KEY,
    funcao_id     INTEGER NOT NULL REFERENCES funcoes(id) ON DELETE CASCADE,
    nome          VARCHAR(255) NOT NULL,
    tipo          VARCHAR(30) NOT NULL DEFAULT 'uniforme',
    ativo         BOOLEAN DEFAULT TRUE,
    aprovado_erp  BOOLEAN DEFAULT TRUE,
    data_criacao      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (funcao_id, nome),
    CONSTRAINT equipamentos_tipo_check CHECK (tipo IN ('uniforme','equipamento','epi'))
);

-- ⚠️ GLOBAL: as opções são casadas pelo NOME do item, não pelo id.
--    Dois contratos com um item de mesmo nome COMPARTILHAM as mesmas opções.
CREATE TABLE equipamento_opcoes (
    id               SERIAL PRIMARY KEY,
    nome_equipamento VARCHAR(255) NOT NULL,
    tipo             VARCHAR(20)  NOT NULL,          -- 'tamanho' | 'quantidade' | 'litros'
    opcoes           TEXT[] NOT NULL,                -- ex.: '{P,M,G,GG}'
    data_criacao      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT equipamento_opcoes_nome_tipo_unique UNIQUE (nome_equipamento, tipo),
    CONSTRAINT chk_tipo CHECK (tipo IN ('tamanho','quantidade','litros'))
);

-- ============================================================
-- PEDIDOS
-- ============================================================
CREATE TABLE pedidos (
    id                     SERIAL PRIMARY KEY,
    pedido_id              VARCHAR(50) UNIQUE NOT NULL,  -- 'PED-XXXXX-XXXXX' (gerado no front)
    nome_solicitante       VARCHAR(255) NOT NULL,
    nome_colaborador       VARCHAR(255) NOT NULL,        -- string vazia em pedidos de insumos
    matricula_colaborador  VARCHAR(50)  NOT NULL,        -- idem
    admissao               BOOLEAN NOT NULL DEFAULT FALSE,
    tipo_admissao          VARCHAR(50),                  -- 'substituicao' | 'aditivo' | NULL
    data_admissao          DATE,
    data_solicitacao       DATE NOT NULL,
    contrato               VARCHAR(255) NOT NULL,        -- snapshot textual, sem FK
    posto                  VARCHAR(255) NOT NULL,        -- snapshot textual, sem FK
    funcao                 VARCHAR(255) NOT NULL,        -- snapshot textual, sem FK
    status                 VARCHAR(50) DEFAULT 'PENDENTE',
    tipo_pedido            VARCHAR(20) DEFAULT 'uniforme', -- 'uniforme'|'insumos'|'ambos'
    observacoes            TEXT,                         -- comentário livre do solicitante
    imagem_cracha          VARCHAR(255),                 -- caminho: /uploads/crachas/<id>.jpg
    data_criacao           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_status CHECK (status IN (
        'PENDENTE','EM PREPARACAO','AGUARDANDO ENVIO',
        'AGUARDANDO COMPRA','DESPACHADO','ENTREGUE','CANCELADO'))
);
CREATE INDEX idx_pedidos_pedido_id   ON pedidos(pedido_id);
CREATE INDEX idx_pedidos_matricula   ON pedidos(matricula_colaborador);
CREATE INDEX idx_pedidos_status      ON pedidos(status);
CREATE INDEX idx_pedidos_data_criacao ON pedidos(data_criacao);
CREATE INDEX idx_pedidos_contrato    ON pedidos(contrato);

CREATE TABLE pedido_equipamentos (
    id               SERIAL PRIMARY KEY,
    pedido_id        INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE, -- FK no id NUMÉRICO
    nome_equipamento VARCHAR(255) NOT NULL,
    tamanho          VARCHAR(50),   -- 'P','M','G','42'…
    quantidade       VARCHAR(10),   -- string, não integer
    litros           VARCHAR(10),   -- '10'…'190' (produtos de limpeza)
    data_criacao     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_pedido_equipamentos_pedido_id ON pedido_equipamentos(pedido_id);

CREATE TABLE usuarios (          -- legado: NÃO há autenticação de usuário final no sistema.
    id SERIAL PRIMARY KEY,       -- existe só porque pedido_historico.usuario_id referencia.
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('SOLICITANTE','APROVADOR','ADMIN')),
    ativo BOOLEAN DEFAULT TRUE,
    data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ultimo_acesso TIMESTAMP
);

CREATE TABLE pedido_historico (
    id              SERIAL PRIMARY KEY,
    pedido_id       INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    status_anterior VARCHAR(50),
    status_novo     VARCHAR(50) NOT NULL,
    usuario_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    observacao      TEXT,        -- comentário do ERP exibido ao usuário final
    data_alteracao  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SOLICITAÇÃO DE VAGAS
-- ============================================================
CREATE TABLE solicitacao_vagas (
    id SERIAL PRIMARY KEY,
    solicitacao_id VARCHAR(50) UNIQUE NOT NULL,        -- 'VAGA-<ts>-<4dig>'
    -- descrição da vaga
    contrato VARCHAR(255) NOT NULL,
    posto_vaga VARCHAR(300),
    cidade VARCHAR(255) NOT NULL,
    cargo VARCHAR(255) NOT NULL,
    escala_prevista VARCHAR(50) NOT NULL,              -- '5X2','6X1','12x36'
    solicitado_por VARCHAR(255) NOT NULL,
    -- motivo
    motivo_vaga VARCHAR(100) NOT NULL,                 -- substituição|nova contratação|aumento de quadro|reserva técnica
    nome_substituido VARCHAR(255),
    -- jornada e condições
    horario VARCHAR(100) NOT NULL,
    salario VARCHAR(50) NOT NULL,                      -- texto com máscara "1.500,00"
    beneficios_vt_vr TEXT,
    recebe_insalubridade VARCHAR(10) NOT NULL DEFAULT 'Não',
    quantos_insalubridade VARCHAR(100),
    local_exato_trabalho VARCHAR(500) NOT NULL,
    data_prevista_inicio VARCHAR(50) NOT NULL,         -- string, não DATE
    -- requisitos
    requisitos_obrigatorios TEXT,
    requisitos_desejaveis TEXT,
    experiencia_minima VARCHAR(50) NOT NULL DEFAULT 'Não',
    qual_experiencia_minima TEXT,
    -- criticidade / histórico
    grau_urgencia VARCHAR(100) NOT NULL,               -- calculado no front pela data de início
    alta_rotatividade VARCHAR(10) NOT NULL DEFAULT 'Não',
    possui_recomendacao TEXT,
    observacoes_importantes TEXT,
    -- preenchido pelo ERP/Treinamentos ao contratar
    contratado_nome VARCHAR(255),
    contratado_cpf VARCHAR(20),
    contratado_data_inicio VARCHAR(50),
    contratado_numero_contato VARCHAR(30),
    contratado_pis VARCHAR(30),
    -- controle
    status VARCHAR(100) NOT NULL DEFAULT 'PENDENTE_OPERACIONAL',
    data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT status_vaga_check CHECK (status IN (
        'PENDENTE_OPERACIONAL','APROVADO_OPERACIONAL','REPROVADO_OPERACIONAL',
        'PENDENTE_TREINAMENTOS','APROVADO_TREINAMENTOS','REPROVADO_TREINAMENTOS',
        'CONTRATADO','CANCELADO','EM_CORRECAO'))
);

CREATE TABLE solicitacao_vaga_historico (
    id SERIAL PRIMARY KEY,
    solicitacao_id INTEGER NOT NULL REFERENCES solicitacao_vagas(id) ON DELETE CASCADE,
    status_anterior VARCHAR(100),
    status_novo     VARCHAR(100) NOT NULL,
    observacao TEXT,
    usuario    VARCHAR(255),
    origem     VARCHAR(50) DEFAULT 'SITE_EXTERNO',   -- 'SITE_EXTERNO' | 'ERP' | 'SISTEMA'
    data_alteracao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SOLICITAÇÃO DE DEMISSÃO
-- ============================================================
CREATE TABLE solicitacao_demissoes (
    id SERIAL PRIMARY KEY,
    solicitacao_id VARCHAR(50) UNIQUE NOT NULL,        -- 'DEMISS-<4dig>-<4letras>'
    data_solicitacao VARCHAR(50) NOT NULL,
    nome_solicitante VARCHAR(255) NOT NULL,
    email_solicitante VARCHAR(255) NOT NULL,
    nome_colaborador VARCHAR(255) NOT NULL,
    posto_colaborador VARCHAR(300) NOT NULL,
    contrato VARCHAR(255) NOT NULL,
    escala_trabalho VARCHAR(50) NOT NULL,
    motivo_solicitacao VARCHAR(255) NOT NULL,
    motivo_solicitacao_outro TEXT,
    motivo_pedido_demissao VARCHAR(255) NOT NULL,
    relato_motivo TEXT,
    termino_contrato_experiencia VARCHAR(255),
    termino_contrato_experiencia_outro TEXT,
    data_aviso VARCHAR(50),
    modelo_aviso VARCHAR(100),
    telefone_colaborador VARCHAR(30),
    email_colaborador VARCHAR(255),
    documentos_anexados TEXT,                          -- JSON string: [{nome,tipo,tamanho,base64}]
    status VARCHAR(100) NOT NULL DEFAULT 'PENDENTE_OPERACIONAL',
    comentario_operacional TEXT,
    comentario_rh TEXT,
    data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT status_demissao_check CHECK (status IN (
        'PENDENTE_OPERACIONAL','APROVADO_OPERACIONAL','REPROVADO_OPERACIONAL',
        'EM_CORRECAO','APROVADO_RH','REPROVADO_RH'))
);

CREATE TABLE solicitacao_demissao_historico (
    id SERIAL PRIMARY KEY,
    solicitacao_id INTEGER NOT NULL REFERENCES solicitacao_demissoes(id) ON DELETE CASCADE,
    status_anterior VARCHAR(100),
    status_novo     VARCHAR(100) NOT NULL,
    observacao TEXT,
    usuario    VARCHAR(255),
    origem     VARCHAR(50) DEFAULT 'SITE_EXTERNO',
    data_alteracao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- FILA DE APROVAÇÃO DO CATÁLOGO (Painel Admin → ERP)
-- ============================================================
CREATE TABLE alteracoes_catalogo (
    id SERIAL PRIMARY KEY,
    tipo_entidade  VARCHAR(30) NOT NULL,   -- 'contrato'|'posto'|'funcao'|'equipamento'|'opcoes'
    tipo_acao      VARCHAR(20) NOT NULL,   -- 'criar'|'editar'|'excluir'
    dados          JSONB NOT NULL,         -- payload + nomes da hierarquia p/ exibição
    descricao      TEXT NOT NULL,          -- texto legível: "Criar item: BOTINA (uniforme)…"
    status         VARCHAR(20) DEFAULT 'RASCUNHO',  -- RASCUNHO→PENDENTE→APROVADO|REPROVADO
    lote_id        VARCHAR(50),            -- 'LOTE-<timestamp>'
    comentario_erp TEXT,
    usuario_erp    VARCHAR(100),
    data_criacao   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_resposta  TIMESTAMP
);

-- ============================================================
-- TRIGGER de data_atualizacao (aplicar nas tabelas com essa coluna)
-- ============================================================
CREATE OR REPLACE FUNCTION atualizar_data_atualizacao()
RETURNS TRIGGER AS $$
BEGIN
    NEW.data_atualizacao = CURRENT_TIMESTAMP;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_pedidos_atualizacao      BEFORE UPDATE ON pedidos
    FOR EACH ROW EXECUTE FUNCTION atualizar_data_atualizacao();
CREATE TRIGGER trigger_contratos_atualizacao    BEFORE UPDATE ON contratos
    FOR EACH ROW EXECUTE FUNCTION atualizar_data_atualizacao();
CREATE TRIGGER trigger_postos_atualizacao       BEFORE UPDATE ON postos
    FOR EACH ROW EXECUTE FUNCTION atualizar_data_atualizacao();
CREATE TRIGGER trigger_funcoes_atualizacao      BEFORE UPDATE ON funcoes
    FOR EACH ROW EXECUTE FUNCTION atualizar_data_atualizacao();
CREATE TRIGGER trigger_equipamentos_atualizacao BEFORE UPDATE ON equipamentos
    FOR EACH ROW EXECUTE FUNCTION atualizar_data_atualizacao();
```

### 5.3 Catálogo de VAGAS ≠ catálogo de PEDIDOS

Existem **duas fontes de catálogo totalmente independentes**:

| | Catálogo de **Pedidos** | Catálogo de **Vagas/Demissões** |
|---|---|---|
| Fonte | Tabelas `contratos/postos/funcoes/equipamentos` | Arquivo `backend/config/dados_vagas_cascata.json` |
| Endpoint | `/api/catalogo/*` | `/api/catalogo-vagas/*` |
| Estrutura | 4 níveis + itens | 3 níveis: `{ contrato: { posto: [locais] } }` |
| Volume atual | dezenas de contratos | **68 contratos / 387 postos / 671 locais** |
| Como editar | Painel Admin (com aprovação ERP) | **Editar o JSON e fazer deploy** |

```json
{
  "TJRS - 023/2025": {
    "SERVENTES DE LIMPEZA":     ["FORO CENTRAL 1", "FORO CENTRAL 2"],
    "SUPERVISOR TÉC. ADM.":     ["FORO CENTRAL 1", "FORO CENTRAL 2"],
    "COORD. ADM. ADMINISTRADOR":["FORO CENTRAL 1 E 2"]
  }
}
```

> ⚠️ **Os nomes de contrato divergem entre as duas fontes.** No JSON de vagas é
> `"GUAPORÉ LIMPEZA SMED EMERGENCIAL - 063/2026"` (com barra); no banco de pedidos é
> `"GUAPORÉ LIMPEZA SMED EMERGENCIAL - 063.2026"` (com ponto). São strings livres,
> sem FK entre os módulos — não tente cruzá-las automaticamente.

---

## 6. Arquitetura do backend

### 6.1 Camadas

```
HTTP → routes/ → middleware (erpAuth|adminAuth) → controllers/ → models/ → config/database.js → PG
```

- **routes/** — só declara URL → handler. **Ordem importa**: rotas específicas (`/public/*`, `/erp/*`,
  `/stats/*`) são registradas **antes** das genéricas (`/:pedidoId`), senão o Express casa `"public"`
  como se fosse um ID.
- **controllers/** — validam entrada manualmente, chamam o model, montam a resposta e **disparam
  os webhooks para o ERP**.
- **models/** — só SQL. Operações multi-tabela usam `getClient()` + `BEGIN/COMMIT/ROLLBACK`.
- **config/database.js** — `Pool` (`max:20`, `idleTimeout 30s`, `connectionTimeout 10s`), com
  `query()` que loga duração de cada consulta e `getClient()` que auto-libera após 5s de esquecimento.

### 6.2 Contrato de resposta (padrão em toda a API)

```jsonc
// sucesso
{ "success": true, "data": <objeto|array>, "count": <n opcional>, "message": "<opcional>" }
// erro
{ "success": false, "message": "descrição legível", "error": "<detalhe técnico opcional>" }
```

`middlewares/errorHandler.js` traduz códigos do Postgres: `23505` → **409** (duplicado),
`23503` → **400** (FK inválida), `42601`/`42703` → **500** genérico. Stack só vaza em `NODE_ENV=development`.

### 6.3 ⭐ O sistema de AUTO-MIGRAÇÃO no `server.js` (o ponto mais importante e mais estranho)

Ao subir, **antes de `app.listen()`**, `iniciarServidor()` roda um bloco enorme (~530 linhas, linhas
155–687 de `backend/server.js`) que executa DDL e **seed de dados de negócio direto no boot**:

1. `ALTER TABLE … ADD COLUMN IF NOT EXISTS` para `imagem_cracha`, `tipo_admissao`, `comentario_rh`
2. Executa `database/migracao-solicitacao-vaga.sql` se o arquivo existir
3. Recria a constraint de status de demissão (adicionando `APROVADO_RH`/`REPROVADO_RH`)
4. Troca a UNIQUE de `equipamento_opcoes` de `(nome_equipamento)` para `(nome_equipamento, tipo)`,
   **deletando duplicatas antes**
5. Troca a CHECK de `equipamentos.tipo` para aceitar `'epi'`
6. Cria `alteracoes_catalogo` e adiciona `aprovado_erp` nas 4 tabelas do catálogo
7. **Insere contratos inteiros hardcoded** — GUAPORÉ (11 postos, 22 funções, 187 itens),
   TRIUNFO COLETA DE LIXO (3 postos), CRACHÁ/JALECO/EPIs no GUAPORÉ, JAQUETA no PENHA,
   funções faltantes no UFRGS CARREGADORES…

Cada bloco é **guardado por um teste de existência** (`SELECT COUNT(*) …`) e envolto em
`try/catch` que só emite `console.warn` — nenhuma falha derruba o servidor.

**Consequências práticas:**
- ✅ Um banco vazio se auto-popula parcialmente só de subir o servidor.
- ❌ O boot fica lento e faz dezenas de queries toda vez.
- ❌ **Regra de negócio (dados de contratos reais) está dentro do código-fonte.** Ao replicar,
  esses blocos devem virar seeds/migrations de verdade (ver §17, passo 7).
- ❌ Se a conexão com o banco falhar, o servidor **sobe assim mesmo** com avisos — as rotas de banco
  quebram em runtime em vez de falhar rápido no boot (é intencional, comentado como "TEMPORÁRIO").

### 6.4 Padrão "webhook fire-and-forget com retry"

Repetido em `pedidoController.criarPedido`, `solicitacaoVagaController.criarSolicitacao` e
`solicitacaoDemissaoController.criarSolicitacao`:

```js
res.status(201).json({ success: true, data: registro });   // 1) responde ao front IMEDIATAMENTE

(async () => {                                             // 2) IIFE async solta, não-awaited
    const delays = [0, 3000, 6000];                        //    3 tentativas
    while (tentativa < 3 && !sucesso) {
        try {
            await axios.post(`${ERP_API_URL}/api/…/sincronizar`, payload,
                { headers: { 'x-api-key': apiKey }, timeout: 30000 });
            sucesso = true;
        } catch (e) {
            // só re-tenta em 429, 503 ou timeout (ECONNABORTED).
            // 4xx "de verdade", ECONNREFUSED e ENOTFOUND abortam o loop na hora.
        }
    }
})();
```

> ⚠️ **Não há fila persistente.** Se as 3 tentativas falharem, a solicitação fica **só no banco
> local** e o ERP nunca fica sabendo. A recuperação é manual, pelos scripts `reenviar-*.js` (§16).

---

## 7. Referência completa da API

Base: `https://api.mustaches.com.br`. Prefixo `/api` em tudo, **exceto `/health` e `/setup-db-now`**.

**Legenda de auth:** 🌐 público · 🔑 `x-api-key: <ERP_API_KEY>` · 🔒 `Authorization: Bearer <JWT admin>`

### 7.1 Raiz / infraestrutura

| Método | Rota | Auth | Descrição |
|---|---|:--:|---|
| GET | `/health` | 🌐 | Health check do Render (`status`, `uptime`) — não é logado pelo requestLogger |
| GET | `/setup-db-now` | 🌐 | ⚠️ **Executa `database/schema.sql` inteiro no banco. Sem autenticação.** Remover (§14.4) |
| GET | `/api` | 🌐 | Índice de endpoints |
| GET | `/api/health` | 🌐 | Health check da API |
| GET | `/uploads/*` | 🌐 | Arquivos estáticos (fotos de crachá) |

### 7.2 Pedidos — `/api/pedidos`

| Método | Rota | Auth | Descrição |
|---|---|:--:|---|
| POST | `/` | 🌐 | Cria pedido + itens + histórico (transação) e dispara webhook |
| GET | `/` | 🌐 | Lista. Query: `status`, `contrato`, `matricula`, `dataInicio`, `dataFim` |
| GET | `/stats/overview` | 🌐 | Contagem e percentual por status |
| GET | `/public/listar` | 🌐 | Para o ERP consumir. Query: `limite`(100), `offset`(0), `status`, `dataInicio`, `dataFim`. Retorna itens agregados via `json_agg` + `imagem_cracha_url` absoluta |
| GET | `/public/:pedidoId/historico` | 🌐 | Retorna **apenas 1 registro** — o último com `observacao` não vazia e diferente de "Pedido criado" |
| PUT | `/erp/:pedidoId/status` | 🔑 | ERP muda o status. Body: `{status, updated_by, observacao?}` |
| PUT | `/erp/:pedidoId/dados` | 🔑 | ERP edita campos. Body: `{campos_alterados:{…}, updated_by}` (allowlist de campos; `equipamentos` faz replace total) |
| GET | `/erp/:pedidoId/historico` | 🔑 | Histórico completo, ordem ASC |
| GET | `/:pedidoId` | 🌐 | Busca por `pedido_id` (string), já com `equipamentos[]` |
| PUT | `/:pedidoId/status` | 🌐 | ⚠️ Uso interno **sem auth**. Body `{novoStatus, observacao}`. Aceita só 4 status |
| GET | `/:pedidoId/historico` | 🌐 | Histórico com `usuario_nome`, ordem DESC |

### 7.3 Catálogo de pedidos — `/api/catalogo`

Todos 🌐. Filtram sempre por `ativo = true AND aprovado_erp = true`.

| Método | Rota | Retorno |
|---|---|---|
| GET | `/contratos` | `[{id, nome, ativo}]` |
| GET | `/postos` | Todos os postos + nome do contrato |
| GET | `/postos/:contrato` | Postos daquele contrato |
| GET | `/funcoes/:contrato/:posto` | Funções daquele posto |
| GET | `/equipamentos/:contrato/:posto/:funcao` | `[{id, nome, tipo}]` ordenado por tipo, nome |
| GET | `/opcoes/:equipamento` | `{tamanho:[], quantidade:[], litros:[]}` — `null` se o item não tiver nenhuma |
| GET | `/opcoes` | Todas as linhas de `equipamento_opcoes` |
| POST | `/resposta-alteracao` | 🔑 Callback do ERP aprovando/reprovando lote (ver §11.3) |

### 7.4 Catálogo de vagas — `/api/catalogo-vagas` (lê o JSON, não o banco)

| Método | Rota | Retorno |
|---|---|---|
| GET | `/contratos` | `string[]` ordenado |
| GET | `/postos/:contrato` | `string[]` ordenado |
| GET | `/locais/:contrato/:posto` | `string[]` ordenado |

### 7.5 Solicitação de vagas — `/api/solicitacao-vagas`

| Método | Rota | Auth | Descrição |
|---|---|:--:|---|
| POST | `/` | 🌐 | Cria + histórico + webhook |
| GET | `/` | 🌐 | Lista. Query: `status`, `contrato`, `solicitadoPor`, `limite`, `offset` |
| GET | `/public/listar` | 🌐 | Idem, com envelope `{timestamp, fonte}` |
| GET | `/public/:solicitacaoId/historico` | 🌐 | Histórico completo |
| PUT | `/:solicitacaoId/editar` | 🌐 | Encarregado corrige após reprovação. Só em `REPROVADO_*` ou `EM_CORRECAO` |
| PUT | `/erp/:solicitacaoId/status` | 🔑 | Normaliza + mapeia aliases de status (§9.3) |
| PUT | `/erp/:solicitacaoId/contratado` | 🔑 | Registra o contratado e força status `CONTRATADO` |
| GET | `/erp/:solicitacaoId/historico` | 🔑 | Histórico |
| GET | `/:solicitacaoId` | 🌐 | Busca por ID, já com `historico[]` embutido |

### 7.6 Solicitação de demissão — `/api/solicitacao-demissoes`

| Método | Rota | Auth | Descrição |
|---|---|:--:|---|
| POST | `/` | 🌐 | Cria + histórico + webhook |
| GET | `/` | 🌐 | Lista. Query: `status`, `contrato`, `limite` |
| PUT | `/:solicitacaoId/editar` | 🌐 | Correção pelo encarregado |
| PUT | `/erp/:solicitacaoId/status` | 🔑 | Body `{status, updated_by, comentario?}`. Roteia o comentário para `comentario_rh` se o status contém "RH", senão `comentario_operacional` |
| GET | `/erp/:solicitacaoId/historico` | 🔑 | Histórico |
| GET | `/:solicitacaoId` | 🌐 | Busca por ID, com `historico[]` |

### 7.7 Admin — `/api/admin` e `/api/admin/catalogo`

| Método | Rota | Auth | Descrição |
|---|---|:--:|---|
| POST | `/api/admin/login` | 🌐 | Body `{login, senha}` → `{token}` (JWT HS256, `role:'admin'`, exp 8h) |
| GET | `/api/admin/verificar` | 🔒 | Valida o token |
| GET/POST | `/api/admin/catalogo/contratos` | 🔒 | Listar / criar |
| PUT/DELETE | `/api/admin/catalogo/contratos/:id` | 🔒 | Renomear / excluir em cascata |
| GET | `/api/admin/catalogo/postos/:contratoId` | 🔒 | Listar postos do contrato |
| POST | `/api/admin/catalogo/postos` | 🔒 | Body `{contratoId, nome}` |
| PUT/DELETE | `/api/admin/catalogo/postos/:id` | 🔒 | Renomear / excluir em cascata |
| GET | `/api/admin/catalogo/funcoes/:postoId` | 🔒 | Listar funções do posto |
| POST | `/api/admin/catalogo/funcoes` | 🔒 | Body `{postoId, nome}` |
| PUT/DELETE | `/api/admin/catalogo/funcoes/:id` | 🔒 | Renomear / excluir em cascata |
| GET | `/api/admin/catalogo/equipamentos/:funcaoId` | 🔒 | Listar itens da função |
| POST | `/api/admin/catalogo/equipamentos` | 🔒 | Body `{funcaoId, nome, tipo}` |
| PUT/DELETE | `/api/admin/catalogo/equipamentos/:id` | 🔒 | Editar / excluir (remove opções órfãs) |
| GET | `/api/admin/catalogo/opcoes/:nomeEquipamento` | 🔒 | `{tamanho:[],quantidade:[],litros:[]}` |
| POST | `/api/admin/catalogo/opcoes` | 🔒 | Body `{nomeEquipamento, opcoesPorTipo}`. Array vazio **deleta** aquele tipo |
| GET | `/api/admin/catalogo/alteracoes` | 🔒 | Últimas 100 alterações |
| POST | `/api/admin/catalogo/enviar-lote` | 🔒 | Agrupa RASCUNHOs num `LOTE-*`, marca PENDENTE e notifica o ERP |

---

## 8. Módulo A — Pedidos de Equipamentos

### 8.1 Jornada do usuário (6 telas)

```
dashboardInicial/index.html
  └► pages/AreaDePedidos/index.html            [Fazer pedido | Consultar]
      └► pages/FazerPedido/index.html          PASSO 1 — dados + contrato + posto
          └► pages/selecionarFuncao.html       PASSO 2 — função
              └► pages/selecionarEquipamentos.html  PASSO 3 — uniformes (checkbox + selects)
                  ├► pages/selecionarInsumos.html   PASSO 3b — EPIs/equipamentos (opcional)
                  └► pages/confirmacao.html         PASSO 4 — resumo + POST + ID gerado
```

**Passo 1** (`FazerPedido/script.js`) coleta:
`nomeSolicitante`, `nomeColaborador`, `matriculaColaborador` (numérico),
`admissao` (radio sim/não), e — **só se admissão = sim** — `dataAdmissao`,
`tipoAdmissao` (`substituicao` | `aditivo`) e **upload da foto do crachá**
(JPG/PNG/WEBP, máx. 40 MB, lida como Base64 via `FileReader`).
`dataSolicitacao` é preenchida com a data local e marcada `readonly` (o usuário não pode manipular).
Contrato e posto são cards expansíveis com radio, em cascata: escolher o contrato carrega os postos.
O botão "Seguinte" só habilita quando **todos** os campos obrigatórios estiverem válidos.

**Passo 3** carrega os itens da função e os separa por `tipo`:
- `tipo === 'uniforme'` → checkbox normal na lista
- `tipo === 'equipamento'` ou `'epi'` → **não aparecem aqui**; em vez disso é injetado um card
  "🔧 INSUMOS →" que leva para `selecionarInsumos.html`
- Se a função **só tem** insumos e nenhum uniforme, redireciona direto para insumos
  com `tipoPedido = 'insumos'`
- Um item chamado literalmente `"INSUMOS"` é filtrado da lista (é um portal legado, não um item real)

Para cada item selecionado, o front busca `GET /api/catalogo/opcoes/:nome` e monta dinamicamente
até três `<select>`: **Tamanho**, **Qtd**, **Litros**. Os selects nascem `disabled` e só habilitam
quando o checkbox é marcado. O botão "Avançar" só libera quando **todos os selects visíveis dos
itens marcados** estiverem preenchidos.

Ao voltar de insumos, os uniformes já escolhidos são preservados em
`pedidoData.uniformesSelecionados` e mesclados; `tipoPedido` vira `'ambos'`.

**Passo 4** (`confirmacao.js`) gera o ID, exibe o resumo e faz o POST:

```js
function gerarIdPedido() {
  const timestamp = Date.now().toString(36);
  const randomNum = Math.random().toString(36).substring(2, 9);
  return `PED-${timestamp}-${randomNum}`.toUpperCase();   // ex.: PED-M8K2P1-A9F3B2C
}
```

### 8.2 Payload de criação

```jsonc
POST /api/pedidos
{
  "pedidoId": "PED-M8K2P1-A9F3B2C",
  "nomeSolicitante": "João Silva",
  "nomeColaborador": "Maria Santos",      // "" quando tipoPedido = "insumos"
  "matriculaColaborador": "12345",        // idem
  "admissao": true,
  "tipoAdmissao": "substituicao",         // só quando admissao = true
  "dataAdmissao": "2026-08-10",
  "dataSolicitacao": "2026-08-04",
  "contrato": "TJRS - 023.2025",
  "posto": "TJRS-1",
  "funcao": "SERVENTE DE LIMPEZA",
  "tipoPedido": "uniforme",               // "uniforme" | "insumos" | "ambos"
  "observacoes": "Colaborador é canhoto", // comentário livre, opcional
  "imagemCrachaBase64": "data:image/jpeg;base64,/9j/4AA…",  // só se admissao = true
  "equipamentos": [
    { "nome": "CAMISETA - AZUL (MC)", "tamanho": "M",  "quantidade": "2", "litros": null },
    { "nome": "BOTINA - PRETA",       "tamanho": "42", "quantidade": "1", "litros": null }
  ]
}
```

**Validações no controller** (`pedidoController.criarPedido`):
1. `pedidoId` e `nomeSolicitante` obrigatórios → 400
2. `nomeColaborador` + `matriculaColaborador` obrigatórios **exceto** se `tipoPedido === 'insumos'` → 400
3. `contrato`, `posto`, `funcao` obrigatórios → 400
4. `equipamentos` não vazio → 400

**Imagem do crachá:** só é salva se `imagemCrachaBase64` **e** `admissao` forem verdadeiros.
Regex aceita `data:image/(jpeg|png|webp);base64,…`, grava em
`{UPLOADS_PATH}/crachas/{pedidoId}.{ext}` e guarda o caminho relativo em `pedidos.imagem_cracha`.
Falha ao salvar a imagem **não aborta o pedido** (só loga).
O `express.json({ limit: '60mb' })` existe justamente por causa desse Base64.

### 8.3 Máquina de estados

```
PENDENTE ──► EM PREPARACAO ──┬──► AGUARDANDO ENVIO ──► DESPACHADO ──► ENTREGUE
   (criação)                 └──► AGUARDANDO COMPRA ──┘
                                              qualquer um ──► CANCELADO
```

Transições vêm do ERP via `PUT /api/pedidos/erp/:id/status`. Toda mudança grava em
`pedido_historico`. Se o ERP mandar `observacao`, ela vira o "comentário dos administradores"
mostrado ao encarregado na tela de consulta.

### 8.4 Consulta de pedido

`ConsultarPedido/script.js` busca por ID e monta o card. O `statusMap` do front traduz
apenas 4 status (`EM PREPARACAO`, `AGUARDANDO ENVIO`, `AGUARDANDO COMPRA`, `DESPACHADO`);
qualquer outro cai no fallback e é exibido **cru**, com a classe `em-analise`.
Em seguida chama `/public/:id/historico` para exibir a última observação do ERP.
A tela tem um botão de impressão (`window.print()`).

---

## 9. Módulo B — Solicitação de Vagas

### 9.1 Formulário (6 seções + tela de sucesso)

`SolicitarVaga/pages/CriarSolicitacao/` — wizard de uma página só, com barra de progresso
(`data-step="1..6"`) e validação por seção antes de avançar.

| Seção | Campos | Obrigatórios |
|---|---|---|
| 1 — Descrição da vaga | contrato, postoVaga, cidade, cargo, escalaPrevista, solicitadoPor | todos |
| 2 — Cadastro manual | motivoVaga, nomeSubstituido | motivoVaga |
| 3 — Jornada e condições | horario, salario, beneficiosVtVr, recebeInsalubridade, quantosInsalubridade, localExatoTrabalho, dataPrevistaInicio | horario, salario, localExatoTrabalho, dataPrevistaInicio |
| 4 — Requisitos | requisitosObrigatorios, requisitosDesejaveis, experienciaMinima, qualExperienciaMinima | nenhum |
| 5 — Criticidade | grauUrgencia (**calculado**), altaRotatividade, possuiRecomendacao, observacoesImportantes | nenhum |
| 6 — Confirmação | resumo renderizado | — |

**Cascata dos dropdowns:** contrato → posto → cidade/local, lendo `/api/catalogo-vagas/*` (o JSON).

**Grau de urgência é auto-calculado** a partir de `dataPrevistaInicio` (campo fica readonly):
| Dias até o início | Grau |
|---|---|
| ≤ 4 | 🔴 Alta |
| 5 – 10 | 🟡 Média |
| > 10 | 🟢 Baixa |

**Máscara de salário:** só dígitos, formata como `1.500,00`. O `R$` é removido antes de enviar ao ERP.

**ID:** `VAGA-${Date.now()}-${4 dígitos}` → `VAGA-1754312400000-0873`

**Campos condicionais:** `quantosInsalubridade` só aparece se `recebeInsalubridade === 'Sim'`;
`qualExperienciaMinima` só se `experienciaMinima === 'Sim'`.

### 9.2 Máquina de estados

```
                     ┌──── ERP reprova ────► REPROVADO_OPERACIONAL
                     │                              │ (automático)
PENDENTE_OPERACIONAL ┤                              ▼
                     │                        EM_CORRECAO ──(encarregado corrige)──┐
                     └──── ERP aprova ─────► APROVADO_OPERACIONAL                  │
                                                    │            ┌─────────────────┘
                                                    ▼            ▼ volta p/ PENDENTE_OPERACIONAL
                                          PENDENTE_TREINAMENTOS       (ou PENDENTE_TREINAMENTOS
                                                    │                  se a reprovação foi lá)
                                    ┌───────────────┴────────────┐
                                    ▼                            ▼
                        APROVADO_TREINAMENTOS      REPROVADO_TREINAMENTOS ──► EM_CORRECAO
                                    │
                                    ▼  (PUT /erp/:id/contratado)
                               CONTRATADO                       ... ──► CANCELADO
```

**Regras não-óbvias, todas em `solicitacaoVagaController.atualizarStatusERP`:**

- **Reprovação vira correção automaticamente.** Ao receber `REPROVADO_OPERACIONAL` ou
  `REPROVADO_TREINAMENTOS`, o backend grava esse status e **em seguida** grava `EM_CORRECAO`
  (origem `SISTEMA`) — para liberar a edição pelo encarregado.
- **Lock de edição.** Se a vaga estiver `EM_CORRECAO`, qualquer `PUT /erp/:id/status` é rejeitado
  com **HTTP 423 (Locked)**: "está em correção pelo encarregado". O ERP fica travado até a correção.
- **Bloqueio no ERP acontece no clique de "Corrigir".** `PUT /:id/editar` primeiro chama
  `PUT {ERP}/api/solicitacoes-vagas/:id/status-externo` com `EM_CORRECAO`, depois edita local,
  depois reenvia o corrigido para `/correcao`. Se o bloqueio no ERP falhar, a edição local
  **continua mesmo assim** (só loga o erro).
- **Reabertura pelo RH.** Se o ERP mandar `PENDENTE_OPERACIONAL` numa vaga que já está em fase
  avançada (`APROVADO_OPERACIONAL`, `PENDENTE_TREINAMENTOS`, `APROVADO_TREINAMENTOS`,
  `REPROVADO_TREINAMENTOS`, `CONTRATADO`), isso é interpretado como reabertura e **remapeado para
  `APROVADO_OPERACIONAL`** — não volta para o começo do fluxo.
- **Destino da correção.** Ao corrigir, o model consulta o histórico para saber qual foi a última
  reprovação: se foi em treinamentos, volta para `PENDENTE_TREINAMENTOS`; senão, `PENDENTE_OPERACIONAL`.

### 9.3 Normalização de status vinda do ERP

O ERP manda status em formatos variados. O backend normaliza:
`toUpperCase()` → `trim()` → espaços viram `_` → remove acentos (`NFD` + regex de diacríticos).
Depois aplica aliases:

| ERP envia | Vira |
|---|---|
| `FINALIZADO` | `CONTRATADO` |
| `APROVADO` | `APROVADO_OPERACIONAL` |
| `REPROVADO` | `REPROVADO_OPERACIONAL` |
| `PENDENTE` | `PENDENTE_OPERACIONAL` |
| `EM_PROCESSO_TREINAMENTOS` | `PENDENTE_TREINAMENTOS` |
| `REABERTO`, `REABRIR`, `REATIVADO`, `REABERTO_RH`, `REABERTO_OPERACIONAL`, `PENDENTE_RH` | `APROVADO_OPERACIONAL` |

### 9.4 Consulta e correção

`ConsultarSolicitacao/script.js` busca por ID, mostra card + timeline do histórico.
O botão **Editar** só aparece em `EM_CORRECAO`, `REPROVADO_OPERACIONAL` ou `REPROVADO_TREINAMENTOS`.
Ao salvar, o front **compara com os dados originais e envia apenas os campos modificados**
(`montarPayloadCorrecao`), convertendo `snake_case` → `camelCase`. Se nada mudou, avisa e não envia.
Se `contratado_nome` estiver preenchido, uma seção extra mostra os dados do contratado.

---

## 10. Módulo C — Solicitação de Demissão

### 10.1 Formulário (4 seções)

| Seção | Campos obrigatórios |
|---|---|
| 1 — Solicitante e colaborador | `dataSolicitacao`, `nomeSolicitante`, `emailSolicitante`, `nomeColaborador`, `postoColaborador`, `contrato`, `escalaTrabalho` |
| 2 — Motivos | `motivoSolicitacao`, `motivoPedidoDemissao`, `relatoMotivo` |
| 3 — Aviso e contato | `terminoContratoExperiencia`, `dataAviso`, `modeloAviso`, `telefoneColaborador`, `emailColaborador`, `documentosAnexados` |
| 4 — Confirmação | — |

**Validação de e-mail** (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) aplicada em `emailSolicitante` (seção 1)
e `emailColaborador` (seção 3). Campos "Outro" viram obrigatórios quando o select é `"Outro"`.

**Anexos:** todos os arquivos são convertidos para Base64 no navegador e enviados no JSON como
`[{nome, tipo, tamanho, base64}]`, persistidos como string JSON em `documentos_anexados`.

**ID:** `DEMISS-${4 dígitos}-${4 letras maiúsculas}` → `DEMISS-4821-KRPZ`

**Valores dos dropdowns** (extraídos do HTML — replicar exatamente):
- *Escala:* `5X2`, `6X1`, `12X36`, `220H 5X2`
- *Motivo da solicitação:* Pedido de demissão pelo colaborador · Desligamento sem justa causa ·
  Desligamento por justa causa · Término de contrato de experiência · Abandono de emprego ·
  Aposentadoria · Outro
- *Motivo do pedido de demissão:* Proposta de outro emprego · Insatisfação salarial ·
  Insatisfação com o ambiente de trabalho · Problemas de saúde · Problemas pessoais/familiares ·
  Mudança de cidade · Falta grave/indisciplina · Não informado · Outra
- *Término do contrato de experiência:* Dentro do período de experiência (até 30 dias) ·
  Dentro do período de experiência (até 90 dias) · Após período de experiência · Não se aplica · Outro
- *Modelo de aviso:* Aviso Prévio Trabalhado · Aviso Prévio Indenizado · Dispensa do Aviso Prévio ·
  `TERMINO DE CONTRATO (AUSENCIA E DISPENSA)`

O dropdown de contrato vem de `/api/catalogo-vagas/contratos` (mesmo JSON das vagas).

### 10.2 Máquina de estados

```
                          ┌── reprova ──► REPROVADO_OPERACIONAL ──(auto)──► EM_CORRECAO
PENDENTE_OPERACIONAL ─────┤                                                      │
                          └── aprova ───► APROVADO_OPERACIONAL         (corrige) │
                                                  │                              │
                                    ┌─────────────┴──────────┐   ◄───────────────┘
                                    ▼                        ▼   volta p/ PENDENTE_OPERACIONAL
                              APROVADO_RH             REPROVADO_RH
                          (rescisão concluída)
```

**Roteamento de comentários:** em `PUT /erp/:id/status`, se o status normalizado **contém "RH"**,
`comentario` é gravado em `comentario_rh`; caso contrário em `comentario_operacional`.
A tela de consulta exibe os dois em blocos separados (vermelho = Operacional, rosa = RH).

Mesma lógica de reabertura das vagas: `PENDENTE_OPERACIONAL` chegando numa solicitação já em
`APROVADO_OPERACIONAL`/`APROVADO_RH`/`REPROVADO_RH` é remapeado para `APROVADO_OPERACIONAL`.

> Diferença em relação às vagas: aqui **não há lock 423** e a edição **não bloqueia o ERP antes**.
> A correção edita local e depois reenvia para `/sincronizar` com `editado: true`.

---

## 11. Módulo D — Painel Admin e aprovação de catálogo

### 11.1 Acesso

Não há link visível. Existe um botão de **três pontinhos (`⋮`)** no canto da tela inicial
(`#adminDotsBtn`). Ao clicar:
1. Se já existe `sessionStorage.admin_token`, valida em `GET /api/admin/verificar` e redireciona
2. Senão abre um modal de login → `POST /api/admin/login` → guarda o JWT em `sessionStorage`

A autenticação **não usa a tabela `usuarios`**: compara `login`/`senha` diretamente com
`ADMIN_LOGIN`/`ADMIN_PASSWORD` do `.env`, usando `crypto.timingSafeEqual` (proteção contra timing
attack; a comparação de comprimento é feita antes para evitar exceção). Token HS256, `role:'admin'`, 8h.

### 11.2 CRUD em cascata

A UI é uma cascata de `<select>`: **Contrato → Posto → Função → Itens**. Cada nível ganha botões
Criar/Renomear/Excluir quando selecionado. Os itens listam badges (`Qtd.` / `Tam.` / `Lit.`)
indicando quais opções estão configuradas, e um modal ⚙️ com **chips clicáveis** para escolher os
valores a partir de listas pré-definidas:

```js
const OPCOES_PREDEFINIDAS = {
  quantidade: ['1','2','3','4'],
  tamanho:    ['P','M','G','GG','EGG','EXGG','33'…'49'],
  litros:     ['10','20','30',…,'190']
};
```

**Exclusões são em cascata e feitas na aplicação** (não por `ON DELETE CASCADE`), sempre limpando
`equipamento_opcoes` órfãs primeiro. Excluir contrato → apaga opções → itens → funções → postos → contrato.

### 11.3 ⭐ Fluxo de aprovação de catálogo pelo ERP

Este é o mecanismo mais sutil do sistema.

```
1. Admin cria algo no painel
   └► a linha é gravada NO CATÁLOGO REAL, mas com aprovado_erp = FALSE
      (invisível para os usuários finais, pois /api/catalogo filtra aprovado_erp = true)
   └► e um registro é gravado em alteracoes_catalogo com status = 'RASCUNHO'

2. Admin clica "📤 Enviar para Aprovação (N)"
   └► POST /api/admin/catalogo/enviar-lote
   └► todos os RASCUNHO viram PENDENTE e recebem o mesmo lote_id = 'LOTE-<timestamp>'
   └► POST {ERP}/api/catalogo/notificar-alteracao  { lote_id, alteracoes[], callback_url }

3. ERP responde
   └► POST /api/catalogo/resposta-alteracao  { lote_id, status: 'APROVADO'|'REPROVADO', usuario, comentario }
      ├─ APROVADO  → UPDATE <tabela> SET aprovado_erp = true  (itens passam a aparecer no site)
      └─ REPROVADO → DELETE FROM <tabela> WHERE … AND aprovado_erp = false  (some do catálogo)
```

- **Só ações `tipo_acao = 'criar'` são aplicadas/revertidas.** Edições e exclusões já foram
  aplicadas direto no banco e não são desfeitas por uma reprovação.
- **Casamento da linha** (`condicaoDeCasamento`, em `alteracaoCatalogoController.js`), em ordem
  de prioridade: `id` → `nome + coluna_pai` → `nome` global. Usar o `id` é o que torna o sistema
  imune a renomeações posteriores e a nomes repetidos entre contratos — foi uma correção deliberada
  (commit `7e5bfd8`); não regrida para casar por nome.
- **Idempotência:** se o lote não tiver nenhum item `PENDENTE`, a resposta é **409 Conflict**
  ("Lote já processado"). Lote inexistente → **404**.
- O `callback_url` enviado ao ERP está **hardcoded** como
  `https://api.mustaches.com.br/api/catalogo/resposta-alteracao` (§14.8).
- Autenticação do callback: comparação direta de `x-api-key` com `ERP_API_KEY` **dentro do
  controller** — esta rota não usa o middleware `validarTokenERP`.

O painel exibe o histórico agrupado por lote (contrato / posto / função / itens), com modal de
detalhes dos itens e **exportação para Excel** via SheetJS.

---

## 12. Integração com o ERP (contrato completo)

### 12.1 Saída — este site chama o ERP

Header em todas: `Content-Type: application/json` + `x-api-key`. Timeout 30 s (15 s no catálogo).

| Evento | Método + URL | Chave | Retry |
|---|---|---|---|
| Pedido criado | `POST {ERP}/api/pedidos/sincronizar` | `API_KEY_ERP_PEDIDOS` (fallback `API_KEY_ERP`) | 3× `[0, 3s, 6s]` |
| Vaga criada | `POST {ERP}/api/solicitacoes-vagas/sincronizar` | `API_KEY_ERP` | 3× |
| Vaga: início de correção | `PUT {ERP}/api/solicitacoes-vagas/:id/status-externo` | `API_KEY_ERP` | não |
| Vaga corrigida | `PUT {ERP}/api/solicitacoes-vagas/:id/correcao` | `API_KEY_ERP` | não |
| Demissão criada / corrigida | `POST {ERP}/api/demissoes-solicitadas/sincronizar` | `API_KEY_ERP` | 3× (criação) |
| Lote de catálogo | `POST {ERP}/api/catalogo/notificar-alteracao` | `API_KEY_ERP` | não |

**Payload de pedido** (`snake_case`; note `status: "EM PREPARACAO"` já na criação, embora o banco
local grave `PENDENTE`):

```jsonc
{
  "pedido_id": "PED-…", "nome_solicitante": "…", "nome_colaborador": "…",
  "matricula_colaborador": "…", "admissao": true, "tipo_admissao": "substituicao",
  "data_admissao": "2026-08-10", "data_solicitacao": "2026-08-04",
  "contrato": "…", "posto": "…", "funcao": "…",
  "equipamentos": [{ "nome": "…", "tamanho": "M", "quantidade": "2", "litros": null }],
  "tipo_pedido": "uniforme", "observacoes": "…",
  "imagem_cracha_url": "https://api.mustaches.com.br/uploads/crachas/PED-….jpg",
  "status": "EM PREPARACAO"
}
```

**Payload de vaga** — montado por `converterParaFormatoERP()`, que:
- mapeia sinônimos de `motivo_vaga` (`desligamento`→`substituição`, `nova vaga`→`nova contratação`)
- mapeia `grau_urgencia` (`urgente`→`critica`, remove acentos: `média`→`media`)
- normaliza campos Sim/Não (`normalizarSimNao`: aceita `sim`/`s`/`true` → `"Sim"`, resto → `"Não"`)
- remove o prefixo `R$` do salário
- inclui `status` e o booleano `editado`

### 12.2 Entrada — o ERP chama este site

Todas exigem `x-api-key: <ERP_API_KEY>`.

| Método + URL | Body |
|---|---|
| `PUT /api/pedidos/erp/:pedidoId/status` | `{status, updated_by, observacao?}` |
| `PUT /api/pedidos/erp/:pedidoId/dados` | `{campos_alterados:{…}, updated_by}` |
| `GET /api/pedidos/erp/:pedidoId/historico` | — |
| `PUT /api/solicitacao-vagas/erp/:id/status` | `{status, updated_by, observacao? \| motivo_reprovacao?}` |
| `PUT /api/solicitacao-vagas/erp/:id/contratado` | `{contratado_nome, contratado_cpf, contratado_data_inicio, contratado_numero_contato, contratado_pis, updated_by}` (aceita também camelCase: `nomeCompleto`, `cpf`, `dataInicio`, `numeroContato`, `pis`) |
| `PUT /api/solicitacao-demissoes/erp/:id/status` | `{status, updated_by, comentario?}` |
| `POST /api/catalogo/resposta-alteracao` | `{lote_id, status, usuario, comentario}` |

**Campos aceitos em `campos_alterados`** (allowlist em `pedidoModel.atualizarDadosERP`):
`nome_solicitante`, `nome_colaborador`, `matricula_colaborador`, `contrato`, `posto`, `funcao`,
`data_admissao`, `data_solicitacao`, `admissao`, `tipo_admissao`, `tipo_pedido`,
`observacoes_solicitante` (→ coluna `observacoes`), e `equipamentos` (replace total: DELETE + INSERT).
Qualquer outra chave é ignorada silenciosamente. Tudo dentro de uma transação, com registro
no histórico no formato `[ERP - <updated_by>] Dados editados: <campos>`.

### 12.3 Códigos de erro relevantes

| Código | Quando |
|---|---|
| 401 | `x-api-key` ausente ou inválida |
| 404 | Registro/lote inexistente |
| 409 | Registro duplicado (PG `23505`) ou lote já processado |
| **423** | Vaga em `EM_CORRECAO` — ERP bloqueado até a correção terminar |
| 500 | `ERP_API_KEY` não configurada no servidor, ou erro interno |

---

## 13. Frontend — convenções e design system

### 13.1 Regras estruturais (seguir ao replicar)

1. **Uma pasta por tela**, com `index.html` + `script.js` + `style.css` irmãos.
2. **`api.js` por módulo.** Existem 4 arquivos `api.js` distintos (FazerPedido, ConsultarPedido,
   SolicitarVaga, SolicitarDemissao). Todos declaram `const API_BASE_URL` e `const api` no escopo
   global → **dois `api.js` na mesma página causam `SyntaxError: Identifier already declared`.**
   Nunca carregue dois.
3. **Ordem dos `<script>`:** o `api.js` **sempre antes** do `script.js` da tela.
4. **Estado entre telas:** `sessionStorage`. Chaves usadas:
   - `pedidoFormulario` — objeto acumulado do fluxo de pedido
   - `admin_token` — JWT do painel
   - `solicitacaoEditar` — dados pré-carregados no modo edição de vaga
5. **Guard clause padrão:** toda tela intermediária lê o `sessionStorage`, e se faltar dado
   dispara `alert()` + `window.location.href` de volta ao início.
6. **Navegação:** `window.location.href` com caminhos relativos. Não há router.

### 13.2 Datas — armadilha de fuso resolvida

**Nunca** use `new Date().toISOString().split('T')[0]` — com o fuso do Brasil (UTC-3) isso
retorna o dia anterior à noite. O padrão adotado (commit `b2b6206`) é:

```js
const d = new Date();
const hoje = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
```

No backend: `new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })`.
Para exibir `YYYY-MM-DD`, faça parse manual dos componentes (`new Date(ano, mes-1, dia)`) em vez
de `new Date(string)`.

### 13.3 Design system

| Token | Valor |
|---|---|
| Laranja primário | `#ff6b35` |
| Laranja claro (gradiente) | `#ff8c61` |
| Laranja escuro | `#ff4500` |
| Fundo | `linear-gradient(135deg, #000 0%, #1a1a1a 50%, #000 100%)` |
| Card | `rgba(30, 30, 30, 0.95)` + borda `rgba(255,107,53,0.2)` |
| Texto | `#ffffff` / secundário `#b0b0b0` / terciário `#707070` |
| Fonte | `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif` |
| Botão de ação | `linear-gradient(135deg, #ff6b35 0%, #ff8c61 100%)`, com brilho varrendo no `:hover` via `::before` |

**Cores de status:** pendente `#ffc107` · aprovado-operacional `#2196f3` · reprovado `#f44336` ·
em correção `#ff9800` · aprovado/contratado `#4caf50` · reprovado RH/treinamentos `#e91e63` ·
comentário do ERP `#4ecdc4` · cancelado `#757575`.

**Partículas flutuantes:** toda tela tem 8 `<div class="particle">` estáticas no HTML
(`animation: float 8s infinite ease-in-out`) mais 3–5 geradas por `createParticles()` em JS,
com posição e `animation-delay` aleatórios. É puramente decorativo, mas é a assinatura visual
do sistema — replique.

**Responsividade:** mobile `< 480px` (coluna única) · tablet `481–768px` (grid 2 colunas) ·
desktop `> 769px`. Cards de tamanho/quantidade usam `grid-template-columns: 1fr 1fr` com
`box-sizing: border-box` para os dropdowns não vazarem.

**Logo:** composição CSS pura — `.logo-arc` (arco laranja) + `.logo-title` ("GRUPO<br>NASCIMENTO")
+ `.logo-subtitle`. O PNG `Logo_Nascimento_02.png` só é usado na `telaInicial` legada e na impressão
da consulta de pedido (embutido como `logo-base64.txt`).

---

## 14. Armadilhas e dívidas técnicas (LEIA ANTES DE MEXER)

> As marcadas com 🔴 são as que mais provavelmente causarão um bug ou incidente de segurança
> se ignoradas ao replicar.

1. 🔴 **`database/schema.sql` está obsoleto** e descreve a hierarquia antiga. Rodá-lo num banco
   novo cria tabelas **incompatíveis** com o código. Use o DDL da §5.2.
2. 🔴 **`postinstall: node setup-database.js`** roda o `schema.sql` **a cada `npm install`**,
   inclusive no deploy. Falhas são engolidas ("já existe"), mas num banco virgem ele cria o
   esquema errado. Remover ou apontar para o DDL correto.
3. 🔴 **Regra de negócio dentro do `server.js`.** ~530 linhas de seed de contratos reais
   (GUAPORÉ, TRIUNFO, PENHA, UFRGS) rodam a cada boot. Extrair para migrations/seeds versionados.
4. 🔴 **`GET /setup-db-now` é público e destrutivo.** Qualquer pessoa na internet pode disparar a
   execução do `schema.sql`. **Remover antes de qualquer deploy novo.**
5. 🔴 **CORS totalmente aberto.** `cors({ origin: true, credentials: true })` reflete qualquer
   origem — o comentário no código diz "temporário para debug". `CORS_ORIGIN` existe no `.env`
   mas **nunca é lido**. Ligar a variável de verdade no ambiente novo.
6. **`equipamento_opcoes` é global por nome.** Não há vínculo com contrato/função. Mudar as opções
   de `"JAQUETA"` afeta **todos** os contratos que tenham um item com esse nome. Renomear um item
   no painel **não** renomeia a opção — ela vira órfã.
7. **URL de imagem hardcoded.** `https://api.mustaches.com.br` está fixo em
   `pedidoController.js` (2 lugares) ao montar `imagem_cracha_url`. Trocar de domínio quebra as
   fotos no ERP.
8. **`callback_url` hardcoded** em `adminCatalogoController.enviarLoteParaERP`. Mesma questão.
9. 🔴 **`API_BASE_URL` hardcoded em 6 arquivos de frontend ativos.** Trocar de backend exige editar
   todos (caminhos a partir de `frontend/dashboardInicial/`):
   1. `script.js` (linha 52 — login admin)
   2. `pages/PainelAdmin/script.js` (linha 1)
   3. `pages/AreaDePedidos/pages/FazerPedido/pages/api.js`
   4. `pages/AreaDePedidos/pages/ConsultarPedido/api.js`
   5. `pages/SolicitarVaga/pages/api.js`
   6. `pages/SolicitarDemissao/pages/api.js`

   Existe um 7º em `frontend/telaInicial/script.js`, mas essa pasta está fora do root do Vercel
   e é inalcançável em produção. Comando de verificação:
   `grep -rn "API_BASE_URL = " --include=*.js frontend/`
10. 🔴 **`backend/.env.render` está commitado no git** com senha do banco, chaves de API e a senha
    do admin em texto plano. No ambiente novo: **rotacione todos os segredos**, adicione o arquivo
    ao `.gitignore` e (se possível) purgue do histórico.
11. **Dois `api.js` na mesma página quebram tudo** — ver §13.1.2.
12. 🔴 **`uploads/` é efêmero.** No Render free, o disco é recriado a cada deploy: as fotos de crachá
    **somem**. Configure `UPLOADS_PATH` para um disco persistente ou migre para storage externo (S3).
13. **Catálogo de vagas ≠ catálogo de pedidos**, e os nomes de contrato divergem (§5.3).
14. **`GET /public/:pedidoId/historico` retorna só 1 registro** (`LIMIT 1`), mas
    `ConsultarPedido/script.js` trata como lista e refiltra. Além disso o front lê
    `comentario.alterado_por`, campo que **não existe** no SELECT → o card mostra
    "👤 undefined". Bug cosmético real, ainda presente.
15. **Webhook sem fila.** Se as 3 tentativas falharem, o ERP nunca recebe. Recuperação só manual
    via `reenviar-*.js`. Uma fila persistente (outbox) resolveria.
16. **Servidor sobe com o banco fora do ar** — por decisão explícita no código. As rotas de banco
    então falham em runtime com 500 em vez de o processo morrer no boot.
17. **`PUT /api/pedidos/:id/status` é público.** Qualquer pessoa pode mudar o status de qualquer
    pedido, sem chave. Comentado como "uso interno", mas está exposto.
18. **`express-validator` está instalado e nunca usado**; `usuarios` existe e nunca é populada;
    `frontend/telaInicial/` está fora do root do Vercel e é inalcançável em produção;
    `railway.json` e `deploy.sh` são de uma infraestrutura abandonada
    (o `deploy.sh` faz `git push --force` para um repositório **antigo e errado**).
19. **Senha do admin em texto plano** no `.env`. A comparação com `timingSafeEqual` protege contra
    timing attack, mas a senha não é hasheada em lugar nenhum. Considerar bcrypt/argon2.
20. **`quantidade` é `VARCHAR`, não `INTEGER`** em `pedido_equipamentos`. O ERP recebe string.
    Não "conserte" sem alinhar com o ERP.
21. **Ordem das rotas Express importa.** `/public/*`, `/erp/*` e `/stats/*` **devem** ficar antes
    de `/:id`. Ao adicionar rotas novas, respeite isso ou elas serão engolidas pela genérica.
22. **~40 scripts soltos em `backend/`** com credenciais de produção hardcoded
    (`migrar-v4.js`, `migrar-nova-estrutura-v2.js`…). Não rode nenhum sem ler antes:
    vários fazem `DROP TABLE` no catálogo.

---

## 15. Deploy

### 15.1 Backend (Render — configuração atual)

| Config | Valor |
|---|---|
| Runtime | Node |
| Root directory | *(raiz do repo)* |
| Build command | `cd backend && npm install` |
| Start command | `cd backend && npm start` |
| Health check path | `/health` |
| Env vars | Todas da §4 |

O Render injeta `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` automaticamente ao vincular
um PostgreSQL — por isso `config/database.js` prefere esses nomes. SSL é obrigatório
(`rejectUnauthorized:false`) e só liga quando `NODE_ENV=production`.

> ⚠️ **Plano free hiberna após 15 min** de inatividade; a primeira requisição leva 30–60 s.
> Isso pode estourar o timeout de quem consome a API. Considere um plano pago ou um ping periódico.

### 15.2 Frontend (Vercel)

| Config | Valor |
|---|---|
| Root directory | `frontend/dashboardInicial` |
| Framework preset | Other |
| Build command | *(vazio)* |
| Output directory | *(vazio)* |
| `vercel.json` | `{ "version":2, "public":true, "rewrites":[{"source":"/(.*)","destination":"/"}] }` |

Deploy automático a cada push na `main`.

> ⚠️ O rewrite `/(.*) → /` manda **tudo** para a raiz. Como a navegação é feita por caminhos
> relativos de arquivo `.html` reais, funciona — mas URLs digitadas à mão caem no menu inicial.

### 15.3 Local

```bash
# Backend
cd backend
npm install
cp .env.example .env      # editar credenciais
npm run dev               # nodemon, porta 4000

# Frontend — qualquer servidor estático
cd frontend/dashboardInicial
npx serve                 # ou Live Server do VS Code
# Depois aponte API_BASE_URL para http://localhost:4000/api nos 6 arquivos (§14.9)
```

---

## 16. Inventário de scripts utilitários

Todos em `backend/`, executados com `node <arquivo>.js`. **Nenhum é chamado pela aplicação** —
são ferramentas pontuais. Vários têm **credenciais de produção hardcoded**.

| Grupo | Arquivos | O que fazem |
|---|---|---|
| **Migração estrutural** | `migrar-nova-estrutura.js`, `migrar-nova-estrutura-v2.js`, `migrar-v3.js`, `migrar-v4.js` | ⚠️ **`DROP TABLE` + recriação do catálogo** e reimportação a partir de `mockdata_novo.js`. `v4` é a versão final (bulk insert). Preservam `pedidos`. |
| **Migração pontual** | `migrar-tipo-pedido.js`, `adicionar-coluna-litros.js`, `atualizar-constraint-status.js`, `atualizar-constraint-demissao.js`, `executar-migracao-*.js`, `scripts/executar-migracao.js` | Aplicam os `.sql` de `database/` |
| **Seed / conteúdo** | `popular-banco.js`, `popular-catalogo-inicial.js`, `popular-dados-reais.js`, `popular-dados-teste.js`, `popular-opcoes-equipamentos.js`, `inserir-guapore.js`, `inserir-policia-civil.js`, `inserir-triunfo.js`, `adicionar-contrato-caxias-telefonistas.js`, `adicionar-contratos-em-massa.js`, `adicionar-funcoes-ufrgs-carregadores.js`, `adicionar-postos-render.js`, `adicionar-sueter-tjrs-023-2025.js` | Inserem contratos/postos/funções/itens |
| **Correção de dados** | `corrigir-avental.js`, `corrigir-samu.js`, `corrigir-tipos-equipamentos.js`, `reinserir-avental.js`, `renomear-equipamentos-insumos.js` | Consertos pontuais já aplicados |
| **Reenvio ao ERP** | `reenviar-pedido-erp.js`, `reenviar-rapido.js`, `reenviar-solicitacao-vaga-erp.js`, `reenviar-vaga-erp.js` | 🔧 **Recuperação de webhook que falhou** — a ferramenta mais útil do conjunto |
| **Diagnóstico** | `testar-conn.js`, `testar-novas-rotas.js`, `testar-variavel.js`, `testar-webhook-erp.js`, `verificar-*.js`, `listar-pedidos-teste.js` | Testes manuais |
| **Setup** | `setup-database.js`, `setup-render.js`, `executar-setup-render.ps1`, `migrar-dados-local-para-render.js`, `resgatar-dados-agora.js` | Bootstrap de ambiente |
| **Python (`database/`)** | `analisar_*.py`, `processar_*.py`, `gerar_dados_oficiais.py`, `investigar_estrutura.py`, `buscar_exemplo_rico.py` | Importaram os `.xlsx` originais para os `mockdata*.js`. Uso único, valor histórico. |

**Lixo a remover no ambiente novo:** `conn_err.txt`, `conn_out.txt`, `err2.txt`, `err3.txt`
(logs commitados por engano), `site-externo-nascimento.git/` (repositório bare aninhado dentro
do próprio repo), os `.xlsx` da raiz.

---

## 17. Checklist de replicação passo a passo

### Fase 1 — Infraestrutura
1. **PostgreSQL 14+** provisionado. Anote host/porta/usuário/senha/base.
2. **Rode o DDL da §5.2 inteiro** (não use `database/schema.sql`).
3. Crie o `backend/.env` com as variáveis da §4. **Gere segredos NOVOS** para
   `API_KEY_ERP`, `API_KEY_ERP_PEDIDOS`, `ERP_API_KEY`, `ADMIN_JWT_SECRET`, `ADMIN_PASSWORD`.
4. Adicione `.env*` ao `.gitignore` — **antes** do primeiro commit.

### Fase 2 — Backend
5. `cd backend && npm install` (⚠️ o `postinstall` roda `setup-database.js`; remova esse script
   do `package.json` antes, ou aponte-o para o DDL correto — §14.2).
6. **Higienize o `server.js`**: remova `GET /setup-db-now` (§14.4) e feche o CORS (§14.5).
7. **Extraia as auto-migrações** (linhas 155–687) para arquivos de migration/seed versionados.
   Mantenha os `ALTER TABLE … IF NOT EXISTS` se quiser compatibilidade, mas **tire os contratos
   hardcoded** do boot.
8. `npm run dev` → confira o log `✅ Teste de conexão bem-sucedido`.
9. `curl http://localhost:4000/api/health` → `{"success":true,…}`.

### Fase 3 — Dados
10. **Catálogo de pedidos:** ou (a) exporte o banco atual com `pg_dump -t contratos -t postos
    -t funcoes -t equipamentos -t equipamento_opcoes` e restaure, ou (b) rode `migrar-v4.js`
    apontado para o banco novo (ele lê `database/mockdata_novo.js` +
    `equipamentos_opcoes_novo.js`) — **revise antes: ele dá `DROP TABLE`**.
11. **Catálogo de vagas:** copie `backend/config/dados_vagas_cascata.json` como está
    (68 contratos / 387 postos / 671 locais). É só um arquivo.
12. Valide: `GET /api/catalogo/contratos` e `GET /api/catalogo-vagas/contratos` devem retornar dados.

### Fase 4 — Frontend
13. Copie `frontend/dashboardInicial/` inteiro (`telaInicial/` é opcional — está morta).
14. **Atualize `API_BASE_URL` nos 6 arquivos** listados em §14.9.
15. Sirva estaticamente e teste as 3 jornadas ponta a ponta.

### Fase 5 — Integração ERP
16. Combine com a equipe do ERP: URL base, as duas chaves de saída e a chave de entrada.
17. Confirme que o ERP expõe: `/api/pedidos/sincronizar`,
    `/api/solicitacoes-vagas/sincronizar`, `/api/solicitacoes-vagas/:id/status-externo`,
    `/api/solicitacoes-vagas/:id/correcao`, `/api/demissoes-solicitadas/sincronizar`,
    `/api/catalogo/notificar-alteracao`.
18. Atualize o `callback_url` hardcoded (§14.8) e a URL das imagens (§14.7) para o domínio novo.
19. Teste um callback: `PUT /api/pedidos/erp/<id>/status` com a `x-api-key` correta.

### Fase 6 — Deploy
20. Backend conforme §15.1 (health check `/health`; **configure disco persistente para uploads** — §14.12).
21. Frontend conforme §15.2 (root `frontend/dashboardInicial`).
22. Smoke test em produção: criar 1 pedido, 1 vaga, 1 demissão; consultar cada uma pelo ID;
    logar no Painel Admin e enviar um lote de teste.

### Teste de aceitação final
- [ ] Pedido de **uniforme** criado, consultado por ID, e recebido pelo ERP
- [ ] Pedido de **insumos** (função só com EPIs) redireciona direto para a tela de insumos
- [ ] Pedido **"ambos"** mescla uniformes + insumos corretamente
- [ ] Foto do crachá salva e servida em `/uploads/crachas/…`
- [ ] Vaga criada → ERP reprova → status vira `EM_CORRECAO` → encarregado edita → volta a `PENDENTE_OPERACIONAL`
- [ ] Vaga em `EM_CORRECAO` faz o ERP receber **HTTP 423**
- [ ] `PUT /erp/:id/contratado` grava os dados e move para `CONTRATADO`
- [ ] Demissão criada → aprovada pelo Operacional → aprovada pelo RH; os dois comentários aparecem separados
- [ ] Painel Admin: criar item → aparece como RASCUNHO → enviar lote → ERP aprova → item fica visível para o usuário final
- [ ] Painel Admin: ERP reprova o lote → o item some do catálogo
- [ ] Datas exibidas corretamente após as 21h (teste do bug de fuso — §13.2)

---

## Referência rápida de arquivos-chave

| Preciso mexer em… | Arquivo |
|---|---|
| Rotas, boot, auto-migrações | `backend/server.js` |
| Conexão com o banco | `backend/config/database.js` |
| Catálogo de vagas/demissões | `backend/config/dados_vagas_cascata.json` |
| Criação de pedido + webhook | `backend/controllers/pedidoController.js` |
| Máquina de estados das vagas | `backend/controllers/solicitacaoVagaController.js` |
| Máquina de estados das demissões | `backend/controllers/solicitacaoDemissaoController.js` |
| Aprovação de catálogo pelo ERP | `backend/controllers/alteracaoCatalogoController.js` |
| CRUD do catálogo (admin) | `backend/controllers/adminCatalogoController.js` + `models/adminCatalogoModel.js` |
| Queries em cascata do catálogo | `backend/models/catalogoModel.js` |
| Login do admin | `backend/controllers/adminController.js` + `middlewares/adminAuth.js` |
| Auth do ERP | `backend/middlewares/erpAuth.js` |
| URL da API (frontend) | os 6 arquivos da §14.9 |
| Fluxo de pedido (front) | `frontend/dashboardInicial/pages/AreaDePedidos/pages/FazerPedido/` |
| Painel Admin (front) | `frontend/dashboardInicial/pages/PainelAdmin/script.js` |
| Tema/cores | `frontend/dashboardInicial/style.css` |

---

*Documento gerado a partir da leitura integral do código-fonte em 2026-08-04.*
*Fonte da verdade: o código. Se este documento divergir dele, o código vence — e corrija este arquivo.*
