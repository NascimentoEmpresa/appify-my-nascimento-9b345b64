# Módulo COMPRAS — Lógica, Funcionamento e Design dos 7 Subsistemas

> **Objetivo deste documento:** descrever, em nível de reimplementação, **o que o módulo de
> Compras faz, como faz e de que maneira faz**. É a especificação funcional e de design
> extraída da leitura do código do sistema legado (`https://grpnascimento.com.br/compras`).
>
> **Escopo:** lógica de negócio, máquinas de estado, algoritmos, modelo de dados, comportamento
> de cada tela e design de interface. **Fora de escopo por decisão do time:** autenticação,
> login, gestão de segredos, CORS, variáveis de ambiente e configuração de deploy — isso será
> tratado em momento separado, antes de subir o sistema.
>
> Quando uma regra de negócio depende de "quem é o usuário" (por exemplo: quem pode aprovar uma
> compra), ela **está** documentada aqui — é lógica de negócio, não configuração de segurança.
> O que não está é *como* o sistema descobre quem é o usuário.
>
> **Diferença no ambiente novo:** no legado, os pedidos do Subsistema 3 chegam de um site externo.
> No ambiente novo eles nascem internamente, em outras rotas do mesmo sistema. A Seção 5.9 trata
> exclusivamente do que muda e do que permanece igual nessa adaptação.

---

## Índice

1. [Panorama: os 7 subsistemas](#1-panorama-os-7-subsistemas)
2. [Padrões de design que se repetem](#2-padrões-de-design-que-se-repetem)
3. [Subsistema 1 — Hub `/compras`](#3-subsistema-1--hub-compras)
4. [Subsistema 2 — Solicitar Compra](#4-subsistema-2--solicitar-compra)
5. [Subsistema 3 — Status de Pedidos](#5-subsistema-3--status-de-pedidos)
6. [Subsistema 4 — Controle de Estoque e TAGs](#6-subsistema-4--controle-de-estoque-e-tags)
7. [Subsistema 5 — Compras-Licitação](#7-subsistema-5--compras-licitação)
8. [Subsistema 6 — Aprovação de Catálogo](#8-subsistema-6--aprovação-de-catálogo)
9. [Subsistema 7 — Manutenção](#9-subsistema-7--manutenção)
10. [Modelo de dados consolidado](#10-modelo-de-dados-consolidado)
11. [Mapa completo da API](#11-mapa-completo-da-api)
12. [Defeitos de lógica confirmados — corrigir na reimplementação](#12-defeitos-de-lógica-confirmados--corrigir-na-reimplementação)
13. [Ordem de implementação sugerida](#13-ordem-de-implementação-sugerida)
14. [Checklist funcional de aceite](#14-checklist-funcional-de-aceite)

---

## 1. Panorama: os 7 subsistemas

Compras não é uma tela — é um **hub que agrega seis aplicações independentes**, cada uma com
lógica, modelo de dados e desenho de tela próprios. Somando o hub, são sete peças.

| # | Subsistema | Rota | O que faz | Complexidade |
|---|---|---|---|---|
| 1 | **Hub Compras** | `/compras` | Menu de cards com badge de pendências | baixa |
| 2 | **Solicitar Compra** | `/solicitar-compra/*` | Workflow documental de aprovação de compra | **alta** |
| 3 | **Status de Pedidos** | `/compras/status-pedidos-externos` | Fila operacional de pedidos de uniforme/EPI | **alta** |
| 4 | **Controle de Estoque** | `/compras/controle-estoque` | Inventário rastreado por etiquetas (TAGs) | **alta** |
| 5 | **Compras-Licitação** | `/compras/compras-licitacao` | Canal de ida-e-volta com o setor de Licitação | média |
| 6 | **Aprovação de Catálogo** | `/compras/aprovacao-catalogo` | Aprovação em lote de mudanças de catálogo | média |
| 7 | **Manutenção** | `/compras/manutencao` | Cadastro de frota/maquinário com anexos e custos | média |

Dois cards do hub são **placeholders** que só disparam um `alert("em breve")`:
*Uniformes Admissão* e *SurveyMonkey*. Não há código por trás deles.

### 1.1 Como as peças se relacionam

A maior parte é independente. Existem exatamente **três acoplamentos**, e todos importam:

```
┌─────────────────────┐         ┌──────────────────────┐
│  3. Pedidos         │────────►│  4. Estoque / TAGs   │
│                     │  consome│                      │
│  ao mudar status,   │  TAGs   │  valida → debita     │
│  atribui etiquetas  │◄────────│  devolve saldo       │
└─────────────────────┘  saldo  └──────────────────────┘

┌─────────────────────┐         ┌──────────────────────┐
│  5. Compras-Licit.  │────────►│  1. Hub              │
│  nº não visualizados│  badge  │  card pulsante       │
└─────────────────────┘         └──────────────────────┘

┌─────────────────────┐         ┌──────────────────────┐
│  2. Solicitar Compra│────────►│  Dashboard raiz "/"  │
│  nº a aprovar por mim│ badge  │  card "Solicitar     │
└─────────────────────┘         │  Compras"            │
                                └──────────────────────┘
```

O acoplamento 3↔4 é o coração operacional do módulo e o ponto que exige mais atenção na
reimplementação — está detalhado nas Seções 5.6 e 6.6.

### 1.2 Uma observação importante sobre o Subsistema 2

Apesar de ser **o processo central de compras**, "Solicitar Compra" **não fica dentro de
`/compras`**. Ele mora em `/solicitar-compra` e é acessado por um card do dashboard principal.
Isso é uma inconsistência de navegação do legado, não uma decisão deliberada.

> **Decisão a tomar no ambiente novo:** provavelmente vale mover para `/compras/solicitacoes`
> e colocá-lo como card do hub. Se fizer isso, o badge de pendências deve ir junto (ou aparecer
> nos dois lugares).

---

## 2. Padrões de design que se repetem

Antes de detalhar cada subsistema, vale registrar os padrões comuns — eles se repetem em todas
as telas e definem a "cara" e o comportamento do módulo.

### 2.1 Sistema visual

**Tema escuro, laranja como cor de marca.** Duas gerações de estilo convivem:

**Geração 1 — telas do hub e submódulos** (`Compras.css`, `StatusPedidosExternos.css`,
`ControleDeEstoque.css`, `Manutencao.css`):

```
Fundo de card:  linear-gradient(135deg, rgba(15,15,15,.95), rgba(26,26,26,.95))
Borda:          2px solid rgba(255,107,53,.3)      /* laranja translúcido */
Sombra:         0 4px 15px rgba(255,107,53,.2)
Raio:           12px
Sidebar:        250px, linear-gradient(180deg, #0f0f0f, #1a1a1a)
Grade de cards: repeat(auto-fill, minmax(350px, 1fr)), gap 20px
```

Cards de menu do hub têm uma **faixa superior colorida** (`::before`) que identifica a categoria:
laranja, verde, vermelho, azul e roxo.

**Geração 2 — Solicitar Compra** (`SolicitarCompra.css`), mais moderna, com *glassmorphism*:

```css
:root {
  --sc-orange:       #FF6B35;
  --sc-orange-light: #FF8C42;
  --sc-orange-dark:  #E85D2F;
  --sc-glass:        rgba(10, 10, 10, 0.82);
  --sc-border:       rgba(255, 107, 53, 0.18);
  --sc-shadow:       0 25px 50px -12px rgba(0,0,0,.7), 0 0 15px rgba(255,107,53,.08);
}
.sc-card    { background: var(--sc-glass); backdrop-filter: blur(22px);
              border: 1px solid var(--sc-border); border-radius: 22px; padding: 24px; }
.sc-btn     { background: linear-gradient(135deg, #FF6B35, #E85D2F); border-radius: 10px;
              font-weight: 700; box-shadow: 0 10px 25px rgba(255,107,53,.22); }
.sc-badge   { border-radius: 999px; padding: 7px 10px; font-weight: 700; font-size: .82rem; }
.sc-main    { max-width: 1200px; margin: 0 auto; padding: 24px 16px; }
```

Hierarquia tipográfica da geração 2: títulos `font-weight: 900`, valores de KPI `2.55rem`,
rótulos em `uppercase` com `letter-spacing: .6–.7px` e opacidade ~55%.

> **Recomendação:** adote a **geração 2** como base do design system no ambiente novo. É mais
> consistente, mais legível e já resolve responsividade. Depois, reescreva as telas da
> geração 1 sobre ela.

**Fundo animado:** quase toda tela renderiza um componente `Particles` — um `<canvas>` com 45
partículas laranja flutuantes que se conectam por linhas quando ficam a menos de 150px de
distância. É puramente decorativo e roda em `requestAnimationFrame`.

**Ícones:** Font Awesome por classe (`fas fa-...`).

### 2.2 Padrões de interação

| Padrão | Como é feito |
|---|---|
| Confirmação de ação destrutiva | `window.confirm()`; exclusão de pedido usa **dupla confirmação** |
| Feedback de resultado | `alert()` na maioria; **toast próprio** só no detalhe de solicitação (3,5s, canto superior direito) |
| Colar imagem | handler de `paste` no container, filtra `clipboardData.items` por `type.startsWith('image/')` |
| Fechar modal | clique no overlay (com `stopPropagation` no conteúdo) + botão ✕ |
| Estado vazio | ícone grande esbatido + frase principal + frase de apoio |
| Estado de carregamento | `fa-spinner fa-spin` + texto |
| Auto-refresh | `setInterval` limpo no unmount — 30s (badge de cotações), 2min (lista de pedidos) |
| Exportação | `xlsx` (planilha real) na maioria; CSV com BOM no Painel TV |

### 2.3 Padrões de código

**Backend** — todo endpoint segue a mesma forma:

```js
router.put('/recurso/:id/acao', async (req, res) => {
  const client = await pool.connect();
  try {
    // 1. valida entrada             → 400
    // 2. carrega o registro          → 404 se não existe
    // 3. valida a transição de estado → 400 se inválida
    // 4. valida a permissão de negócio → 403
    await client.query('BEGIN');
    // 5. UPDATE no registro
    // 6. INSERT no histórico
    await client.query('COMMIT');
    res.json({ success: true, message: '...', historico_id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally { client.release(); }
});
```

Envelope de resposta: `{ success, data | message | error }`.
**Exceção:** o Subsistema 5 (cotações) devolve o array/objeto cru e usa `{ error, details }`
em falha. Padronize tudo no formato acima.

**Frontend** — componentes de página seguem:

```js
const [dados, setDados]   = useState([]);
const [loading, setLoading] = useState(true);
const [erro, setErro]     = useState(null);

const carregar = useCallback(async () => { ... }, [deps]);
useEffect(() => { carregar(); }, [carregar]);
```

Sem gerenciador de estado global e sem camada de cache. Cada tela busca o que precisa e
recarrega tudo (`carregar()`) depois de qualquer escrita.

### 2.4 Tratamento de datas — replicar exatamente

Duas medidas, uma em cada ponta, que corrigem um bug real de fuso:

**Backend**, antes de qualquer conexão:
```js
require('pg').types.setTypeParser(1082, val => val);   // OID 1082 = DATE
```
Sem isso, o driver converte `DATE` em objeto `Date` no fuso local e `2026-03-18` vira
`2026-03-17T21:00:00Z` — a data "anda um dia para trás" na tela.

**Frontend**, para formatar:
```js
const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(T00:00:00\.000Z)?$/);
if (m) return `${m[3]}/${m[2]}/${m[1]}`;   // só usa new Date() se não casar
```

O Subsistema 7 usa uma terceira variante para o mesmo fim: `new Date(str + 'T12:00:00')` —
força meio-dia para que qualquer deslocamento de fuso não mude o dia.

> **No ambiente novo:** escolha **uma** estratégia e aplique em todo lugar. A do parser no
> driver + regex no frontend é a mais robusta das três.

### 2.5 Duplicação a eliminar

O legado tem cópias literais dos mesmos arquivos espalhadas por subpastas de página:
`Particles.js`, `Logo.js`, `permissionHelper.js` e `shared/auth/*` aparecem **7 ou mais vezes
cada**, idênticos. Extraia para um módulo compartilhado único desde o começo.

---

## 3. Subsistema 1 — Hub `/compras`

A peça mais simples: um menu.

### 3.1 Lógica

Ao montar:
1. Lê o usuário da sessão.
2. Busca `GET /api/cotacoes/notificacoes` e guarda `data.compras`.
3. Repete a busca **a cada 30 segundos** (`setInterval` limpo no unmount).

Não há mais nada — nenhum dado próprio, nenhuma escrita.

### 3.2 Design da tela

Layout clássico de painel: **sidebar de 250px** (com um único item, "Voltar para Painel Geral"),
**topbar** com busca decorativa e nome do usuário, e o corpo com uma **grade de 3 colunas**
(2 em tablet, 1 em mobile) de cards clicáveis.

| Card | Faixa | Destino |
|---|---|---|
| Manutenção | laranja | `/compras/manutencao` |
| Controle de Estoque | verde | `/compras/controle-estoque` |
| Compras-Licitação | vermelho | `/compras/compras-licitacao` — **com badge** |
| Uniformes Admissão | azul | `alert("em breve")` |
| Status Pedidos Externos | laranja | `/compras/status-pedidos-externos` |
| SurveyMonkey | verde | `alert("em breve")` |
| Aprovação Catálogo | roxo | `/compras/aprovacao-catalogo` — **renderizado condicionalmente** |

**Badge de Compras-Licitação:** círculo vermelho (`#ff1744`) no canto superior direito do card,
borda branca de 2px, `min-width: 26px`, com animação CSS `badgePulse` de 1,5s em loop infinito.
Só aparece se a contagem for maior que zero.

O card de Aprovação de Catálogo só é renderizado para o papel administrativo — os demais são
sempre visíveis, e cada submódulo faz sua própria verificação ao carregar.

---

## 4. Subsistema 2 — Solicitar Compra

O processo central de compras: um fluxo documental no estilo SEI onde uma solicitação nasce,
percorre etapas com responsáveis diferentes, acumula comentários e anexos numa linha do tempo,
e termina paga ou cancelada.

### 4.1 Máquina de estados — o núcleo da lógica

```
                        ┌──────────────► CANCELADO   (de qualquer estado, exceto PAGO)
                        │
   [criar]              │
      │                 │
      ▼                 │
  PENDENTE ──aprovar──► APROVADO ──cotar──► COTADO ──encaminhar──► AGUARDANDO_APROVACAO ──pagar──► PAGO
      │                                                     ▲                   │
      │                                                     └───── devolver ────┘
      │
      └──reprovar──► REPROVADO ──corrigir──► PENDENTE   (volta ao início)


  ATALHO "Dispensa Cotação":
  PENDENTE ──aprovar──► AGUARDANDO_APROVACAO ──pagar──► PAGO     (pula APROVADO e COTADO)
```

**Guardas — validadas no servidor, retornam 400 se violadas:**

| Ação | Exige status | Resulta em | Efeitos adicionais |
|---|---|---|---|
| aprovar | `PENDENTE` | `APROVADO`, ou `AGUARDANDO_APROVACAO` se `dispensa_cotacao` | grava aprovador, data, justificativa |
| reprovar | `PENDENTE` | `REPROVADO` | justificativa **obrigatória** |
| cotar | `APROVADO` | `COTADO` | grava cotador, data, observação |
| aguardar-aprovacao | `COTADO` | `AGUARDANDO_APROVACAO` | — |
| pagar | `AGUARDANDO_APROVACAO` | `PAGO` | grava pagador, data, observação |
| devolver-aprovacao | `AGUARDANDO_APROVACAO` | `COTADO` | — |
| corrigir | `REPROVADO` | `PENDENTE` | **limpa** aprovador/data/justificativa |
| cancelar | qualquer ≠ `PAGO` | `CANCELADO` | justificativa obrigatória na UI |

Toda transição roda em transação e grava **uma linha no histórico**. A aprovação com dispensa
de cotação grava **duas**: a aprovação em si e uma entrada do tipo `sistema` explicando que a
etapa de cotação foi pulada.

**A regra do atalho de dispensa:** o botão só é oferecido quando
`tipo === 'ADMINISTRATIVO'` **e** `classificacao ∈ {FERRAMENTAS E SOFTWARES, SISTEMAS}`.
A ideia de negócio é que compras de software/licença não passam por cotação de fornecedores.

### 4.2 Numeração

Cada solicitação recebe um `numero` de uma **sequence dedicada**, separada do `id` serial.
O `numero` é o que o usuário vê (`#123`); o `id` é a chave técnica na URL. No legado a sequence
começa em 97 por causa de uma migração; **no ambiente novo comece em 1**.

### 4.3 Taxonomia de classificação

O `tipo` determina quais classificações ficam disponíveis (select encadeado):

```
ADMINISTRATIVO → EQUIP. DE INFORMÁTICA · FERRAMENTAS E SOFTWARES · MÓVEIS E UTENSÍLIOS
                 SISTEMAS · VEÍCULOS · MATERIAL DE ESCRITÓRIO

CONTRATO       → UNIFORMES · EPI · MATERIAIS DE LIMPEZA · UTENSÍLIOS
                 INSUMOS DE JARDINAGEM · COMBUSTÍVEL · MANUTENÇÃO · MATERIAL PEDAGÓGICO
```

Se `tipo === 'CONTRATO'`, aparecem dois selects adicionais encadeados: **Empresa → Contrato**.
No legado esse mapa vem de um arquivo estático no frontend; **no ambiente novo deve vir da API**,
porque contratos mudam.

### 4.4 Quem pode fazer o quê — regras de negócio do workflow

Esta é a parte mais idiossincrática: no legado, **as regras estão escritas em código, por nome
de pessoa**.

Grupos usados nas comparações (setor é comparado por "contém", em maiúsculas):

```
SETORES_OPERACIONAIS    = OPERACIONAL · COMPRAS · LICITAÇÃO
SETORES_ADMINISTRATIVOS = CONTROLADORIA · JURÍDICO · RH · FINANCEIRO · DIRETORIA

CLASSIF_TECH     = EQUIP. DE INFORMÁTICA
CLASSIF_GERAL    = MÓVEIS E UTENSÍLIOS · VEÍCULOS · MATERIAL DE ESCRITÓRIO
CLASSIF_FERNANDA = CLASSIF_GERAL + FERRAMENTAS E SOFTWARES + SISTEMAS
```

**Matriz de aprovação.** Cada linha é uma condição; a pessoa pode aprovar se **qualquer** linha
com o seu nome casar com a solicitação (`*` = qualquer valor):

| Aprovador | tipo | classificação | setor de quem criou |
|---|---|---|---|
| Helena Nascimento | `*` | `*` | `*` |
| Senilton Nascimento | ADMINISTRATIVO | CLASSIF_GERAL | operacionais |
| Senilton Nascimento | CONTRATO | `*` | `*` |
| Fernanda Maldaner | ADMINISTRATIVO | CLASSIF_FERNANDA | administrativos |
| Yuri Rosa | ADMINISTRATIVO | CLASSIF_TECH | `*` |

**Demais capacidades:**

| Capacidade | Regra no legado |
|---|---|
| cotar | setor do usuário **contém** "COMPRAS" |
| pagar | setor contém "FINANCEIRO" **ou** nome é "isadora prisco" |
| encaminhar p/ aprovação final | nome é "isadora prisco" |
| devolver | mesma regra de pagar |
| corrigir | é o criador **e** status é `REPROVADO` |
| cancelar | é o criador **ou** é um dos aprovadores; e status ≠ `PAGO` |

> **Semântica a preservar, implementação a mudar.** A matriz acima descreve regras de negócio
> reais e deve ser reproduzida. Mas nomes próprios em constantes significam que trocar uma
> pessoa exige deploy. Modele como **dados**: uma tabela de regras
> `(aprovador_id, tipo, classificacao, setor_criador)` e capacidades por papel/setor.

**Como o frontend descobre as capacidades:** chama `GET /permissoes-usuario?nome=X&setor=Y`
ao montar a tela e recebe `{ podeAprovar, regrasAprovacao[], podeCotar, podePagar,
podeAguardarAprovacao }`. Com isso decide quais blocos de ação renderizar.

### 4.5 Modelo de dados e a relação que faz a timeline funcionar

Três tabelas:

- **`compras_solicitacoes`** — a solicitação, com trilhas separadas por etapa
  (`aprovado_por_*` / `aprovado_em` / `justificativa_aprovacao`, e o mesmo padrão para
  cotação e pagamento).
- **`compras_historico`** — a linha do tempo. Um evento por linha, com `tipo`, `conteudo`,
  autor e data.
- **`compras_anexos`** — arquivos, com **duas** chaves estrangeiras:
  `solicitacao_id` (obrigatória, CASCADE) e **`historico_id` (opcional, SET NULL)**.

**A chave do design está no `historico_id` opcional:**

```
historico_id = NULL  →  anexo da solicitação como um todo (veio do formulário de criação)
                        renderiza no cabeçalho
historico_id = 42    →  anexo daquele evento específico
                        renderiza dentro do balão do evento 42 na timeline
```

Isso é o que produz o efeito de "o PDF da cotação aparece dentro do evento de cotação".
Para funcionar, as rotas de workflow **retornam o `historico_id` que acabaram de criar**, e o
frontend usa esse id no upload subsequente. Replique esse contrato.

Tipos de evento efetivamente usados:
`criacao`, `aprovacao`, `reprovacao`, `cotacao`, `aguardando_aprovacao`, `pagamento`,
`cancelamento`, `comentario`, `correcao`, `sistema`.

### 4.6 Listagem e os dois filtros especiais

`GET /solicitacoes` aceita `mes` (`YYYY-MM`), `status`, `tipo`, `busca`, `page`, `limit`.
A busca faz `ILIKE %termo%` sobre nome, motivo, criador e o número convertido para texto.
Ordenação fixa por `created_at DESC`. A query traz também `total_anexos` por subquery.

Dois valores de filtro têm tratamento próprio:

**`status=_MINHAS`** — filtra por `criado_por_nome = <usuario>`.

**`designadas_para=<usuario>`** — "o que **eu** posso aprovar agora". Como a regra depende do
setor de quem criou, **não é expressável em SQL simples**. A implementação:

```
1. SELECT id, tipo, classificacao, criado_por_setor WHERE status = 'PENDENTE'
2. filtra em memória aplicando podeAprovar(usuario, solicitacao)
3. WHERE s.id = ANY(<ids permitidos>)
4. se a lista ficou vazia → injeta WHERE 1 = 0
```

Funciona porque o volume de pendentes é pequeno. Se crescer, será preciso materializar a
regra (por exemplo, uma coluna `aprovador_designado` calculada na criação).

### 4.7 Detalhe — a montagem da timeline

`GET /solicitacoes/:id` faz três queries (solicitação, histórico, anexos) e monta a resposta
em JS: cada evento do histórico recebe seu array `anexos`; os anexos sem `historico_id` ficam
num array separado no nível raiz.

No frontend, a timeline é construída por um `useMemo` que:

1. **Filtra** os eventos do tipo `criacao` (já estão no cabeçalho).
2. Mapeia cada evento restante para um dos layouts:
   - `single` — eventos de workflow, com autor, setor, data, texto e anexos;
   - `comment` — comentários, **recolhíveis individualmente**.
3. **Acrescenta um passo sintético `pending`**, derivado do status atual e da ausência do
   evento correspondente:
   ```
   status APROVADO  e sem evento de cotação e sem dispensa → "Aguardando cotação"
   status COTADO    e sem evento de encaminhamento         → "Aguardando próximas atuações..."
   status AGUARDANDO_APROVACAO e sem pagamento             → "Aguardando pagamento"
   ```
4. Se o status for `PAGO` ou `CANCELADO`, acrescenta um passo `encerrado` com bandeira.

> Repare no design: **a timeline mostra só o que já aconteceu, mais um único passo esperado.**
> As ações disponíveis ficam num painel separado, abaixo. Isso mantém a leitura da história
> limpa e separa "o que foi" de "o que posso fazer".

### 4.8 Design da tela de detalhe

É a tela mais elaborada do módulo. Estrutura vertical com uma **linha de vida** — uma barra
vertical contínua desenhada com `::before` no container (`padding-left: 56px`, linha em
`left: 19px`), da qual cada evento pendura seu ícone.

```
 ●━━━ [ Cabeçalho: #123 · título · badges · motivo · valores · descrição · anexos ]
 ┃
 ●━━━ [ Evento: autor · setor · data · texto · chips de anexo ]
 ┃
 ●┈┈┈ [ Passo pendente — borda tracejada âmbar ]
 ┃
 ●━━━ [ Painel de Ações ⚡ ]
 ┃
      [ Caixa de comentário estilo "reply" ]
```

**Ícones da timeline** — círculo de 40px, posicionado em `left: -56px`, com cor por tipo de
evento (fundo a 15% de opacidade, borda a 30%, texto sólido):

| Evento | Cor | Ícone |
|---|---|---|
| criação / correção | `#667eea` azul-violeta | `fa-file-alt` / `fa-edit` |
| aprovação / pagamento | `#00D9A5` verde | `fa-check-circle` / `fa-credit-card` |
| reprovação / cancelamento | `#FF4757` vermelho | `fa-times-circle` / `fa-ban` |
| cotação | `#FF8C42` laranja | `fa-dollar-sign` |
| aguardando aprovação | `#f0ad4e` âmbar | `fa-hourglass-half` |
| comentário | `#ff6b35` laranja-marca | `fa-comment` |
| sistema | `#CE93D8` lilás | `fa-info-circle` |

Balão de conteúdo: `linear-gradient(135deg, rgba(15,15,15,.95), rgba(26,26,26,.95))`,
borda laranja translúcida, raio 12px. Eventos do tipo `sistema` usam **borda tracejada** e
fundo mais apagado — sinalizam que não foram gerados por uma pessoa.

Anexos aparecem como **chips** arredondados com ícone de arquivo, abaixo do texto do evento.

**Painel de Ações** — só renderiza se o status não for final **e** o usuário tiver alguma
capacidade aplicável. Traz um badge indicando a situação ("Aguardando aprovação", "Aguardando
cotação"…) e um bloco por ação disponível, cada um com seus campos e botões coloridos conforme
a natureza (verde aprovar/pagar, vermelho reprovar/cancelar, laranja cotar, âmbar encaminhar,
azul-violeta corrigir).

**Caixa de comentário** — imita o campo de resposta do SEI: textarea, botão de anexar, suporte
a Ctrl+V, e envio. Depois de enviar, faz scroll suave até o fim da timeline.

### 4.9 Design do dashboard

Cabeçalho com título grande (`2.55rem`, peso 900), subtítulo, e dois *mini-chips* com o mês
corrente e o total de solicitações. Botões de ação à direita: "+ Nova Solicitação" e "📺 Painel TV".

**Grade de 7 KPIs** (`repeat(3, 1fr)`, caixas de 138px de altura mínima, rótulo em uppercase
e número em `2.55rem` colorido conforme o status):

```
Total · Pendentes · Cotadas · Aguard. Aprov. · Aprovadas · Finalizadas (minha etapa) · Pagas
```

"Finalizadas (minha etapa)" conta `status IN (APROVADO, COTADO, AGUARDANDO_APROVACAO, PAGO)` —
ou seja, tudo que já passou da etapa inicial.

Abaixo, o **Painel de Solicitações**: toolbar com busca, três selects e um `input type="month"`,
seguida da tabela (ID · Solicitação · Status · Tipo · Solicitante · Criado) com linha inteira
clicável, e paginação de 10 itens mostrando no máximo 5 botões de página.

A opção "Designadas para mim" só aparece no select se a API tiver confirmado que o usuário é
aprovador.

### 4.10 Paleta de status

```
PENDENTE  #FF8C42    APROVADO   #667eea    COTADO     #a371f7
PAGO      #00D9A5    REPROVADO  #FF4757    CANCELADO  #777777
AGUARDANDO_APROVACAO #f0ad4e    (label na UI: "AGUARD. APROVAÇÃO")
```

Badges usam a cor em três intensidades: fundo com sufixo `22` (13% alfa), borda `55` (33%) e
texto sólido. Esse padrão de três camadas se repete em todo o módulo.

### 4.11 Painel TV

Tela pensada para monitor de parede, sem navbar.

- **Countdown regressivo** até o fim do mês, atualizado a cada segundo, exibido como
  `Xd Xh Xm Xs`. Só fica ativo se o mês selecionado for o corrente.
- **Dois gráficos** (rosca e barras) alimentados por `/stats`. A biblioteca de gráficos é
  carregada por injeção de `<script>` na primeira montagem; nas trocas de mês os gráficos são
  **atualizados** (`.update()`) em vez de recriados, e destruídos no unmount.
- **Tabela de ranking** por status.
- **Exportação CSV** com separador `;` e BOM `﻿` para o Excel reconhecer o UTF-8.

### 4.12 Fluxo de criação — detalhe importante

O envio acontece em **duas etapas encadeadas**:

```
1. POST /solicitacoes           → cria e devolve o id
2. POST /solicitacoes/:id/anexos → envia os arquivos (multipart)
```

Se o passo 2 falhar, a solicitação **permanece criada** e o erro é apenas registrado no console.
É uma decisão consciente (não perder o trabalho de preencher o formulário), mas o usuário não
é avisado. **No ambiente novo, avise** — um toast de "solicitação criada, mas os anexos falharam;
tente anexar novamente na tela de detalhe" resolve.

---

## 5. Subsistema 3 — Status de Pedidos

Fila operacional de pedidos de uniforme, EPI e equipamento para colaboradores. É a tela onde o
time de Compras trabalha no dia a dia.

### 5.1 Lógica de estados

```
EM PREPARACAO  ⇄  AGUARDANDO ENVIO  ⇄  AGUARDANDO COMPRA  ⇄  DESPACHADO
```

Diferente do Subsistema 2, **não há guardas de transição** — o servidor aceita qualquer status;
o `<select>` da tela é a única restrição. Semântica de negócio:

| Status | Significa |
|---|---|
| `EM PREPARACAO` | recebido, sendo separado no almoxarifado |
| `AGUARDANDO ENVIO` | separado, esperando logística |
| `AGUARDANDO COMPRA` | falta item em estoque; precisa comprar |
| `DESPACHADO` | enviado — **carimba `data_despachado = NOW()`** |

O carimbo de despacho é o **único efeito colateral** de uma mudança de status.

### 5.2 O modelo de dados e a decisão de design mais importante

Um pedido guarda os equipamentos como **array JSONB**, não como tabela filha:

```json
"equipamentos": [
  { "nome": "Calça Sarja", "tamanho": "M",  "quantidade": 2 },
  { "nome": "Camisa Polo", "tamanho": "GG", "quantidade": 1 }
]
```

**A posição de cada item nesse array (`equipamento_index`, base 0) é a chave que amarra as
etiquetas de estoque ao item do pedido.** A TAG gravada com `equipamento_index = 0` pertence à
Calça Sarja; a com `1`, à Camisa Polo.

> **Consequência crítica:** reordenar o array quebra silenciosamente todas as associações de
> TAG já feitas. A tela de edição permite adicionar e remover equipamentos — e não há nenhuma
> proteção contra isso hoje.
>
> **No ambiente novo:** ou promova os equipamentos a uma tabela filha com id próprio (mais
> correto), ou dê um id estável a cada item dentro do JSON e passe a referenciar por id em vez
> de índice. Manter índice posicional é a maior fragilidade estrutural deste subsistema.

Dois campos de observação **distintos** e facilmente confundíveis:

- `observacoes_solicitante` — texto escrito por quem pediu, mostrado em destaque na tela;
- `observacao` — comentário do operador de Compras ao mudar o status.

### 5.3 Listagem e as contagens globais

A listagem devolve os pedidos **e**, num campo separado, contagens calculadas por uma segunda
query sem `LIMIT`:

```json
{ "count": 250, "totalReal": 250,
  "contagens": { "total": n, "emPreparacao": n, "aguardandoEnvio": n,
                 "aguardandoCompra": n, "despachado": n },
  "data": [ ... ] }
```

Isso existe porque os cards de estatística precisam refletir o banco inteiro, não a página atual.
Na prática, porém, a tela pede `limite=10000` e faz **toda a busca e filtragem no cliente**.

> **No ambiente novo:** implemente paginação e filtros no servidor. Carregar dez mil registros
> para filtrar em memória é a maior dívida de performance do módulo.

### 5.4 A busca "varre tudo"

O filtro de texto é deliberadamente abrangente — percorre **todos os campos visíveis do card**:

- texto direto: pedido, colaborador, solicitante, matrícula, contrato, posto, função,
  tipo de pedido, observações, status;
- **datas já formatadas** em `dd/mm/aaaa` (o usuário digita como vê na tela);
- **nome e tamanho de cada equipamento** dentro do JSON;
- e um caso especial: digitar "admissão" ou "admissao" retorna os pedidos com a flag ligada.

Esse comportamento "digite qualquer coisa que aparece na tela" é uma boa decisão de UX e vale
preservar.

### 5.5 Design da tela

Título grande centralizado, header com "Voltar" à esquerda e usuário/sair à direita.

**Cinco cards de estatística** (`repeat(auto-fit, minmax(200px, 1fr))`): total e um por status,
cada um com ícone temático — caixa, caixa aberta, relógio, carrinho, caminhão.

**Barra de filtros:** campo de busca com ícone e botão de limpar, select de status, e botão
"Exportar Excel (N)" que mostra a contagem do que será exportado.

**Grade de cards** (`repeat(auto-fill, minmax(350px, 1fr))`), um por pedido:

```
┌──────────────────────────────────────────┐
│ #PED-20260318-0042      [ DESPACHADO ]   │  ← header: id + badge
├──────────────────────────────────────────┤
│ 👤 Colaborador:  ...                     │
│ 🪪 Matrícula:    ...                     │
│ 👔 Solicitante:  ...                     │
│ 💼 Função:       ...                     │
│ 📄 Contrato:     ...                     │
│ 📍 Posto:        ...                     │
│ ➕ Admissão:     18/03/2026 (Substituição)│  ← condicional
│ 📷 Foto p/ crachá: [download]            │  ← condicional
│ 📅 Data Solicitação: ...                 │
│ ┌── Uniformes ──────────────────────┐    │
│ │ Calça Sarja   Tam: M   Qtd: 2     │    │  ← título muda com tipo_pedido
│ │ Camisa Polo   Tam: GG  Qtd: 1     │    │
│ └───────────────────────────────────┘    │
│ 💬 Observação do Solicitante: ...        │  ← condicional
├──────────────────────────────────────────┤
│ [Atualizar Status][Editar][Histórico][🗑]│
└──────────────────────────────────────────┘
```

**Badges de status** seguem o padrão de três camadas, com cores próprias deste subsistema:

```
EM PREPARACAO     #ffc107  âmbar     · ícone fa-box-open
AGUARDANDO ENVIO  #2196f3  azul      · ícone fa-clock
AGUARDANDO COMPRA #ff9800  laranja   · ícone fa-shopping-cart
DESPACHADO        #4caf50  verde     · ícone fa-truck
```

**Detalhe de design que merece atenção:** o título da seção de equipamentos é **derivado do
`tipo_pedido`** — se o pedido é de uniforme, o cabeçalho diz "Uniformes"; se é de EPI, "EPIs".
Pequeno toque que faz o card falar a língua do usuário.

**Filtro visual em AGUARDANDO COMPRA:** quando o pedido está nesse status, a lista de
equipamentos do card **esconde os itens que já receberam TAG**. Assim o card mostra apenas o
que ainda falta comprar. Para isso a tela pré-carrega em paralelo as TAGs de todos os pedidos
nesse status. É a melhor ideia de UX do módulo — o card vira uma lista de pendências viva.

### 5.6 Modal "Atualizar Status" — a peça mais complexa da tela

**Ao abrir**, busca as TAGs já vinculadas ao pedido e **reconstrói o estado da interface**:

```
GET /api/estoque/tags/pedido/:id
  → agrupa por equipamento_index
  → restaura o modo de cada equipamento (única ou massa)
  → restaura a quantidade consumida (nas de massa)
  → guarda uma cópia da quantidade original, para detectar alterações depois
```

**Conteúdo do modal:**

- Select de status.
- Textarea de comentário, com o rótulo deixando explícito que é **opcional**.
- **Uma sub-seção por equipamento do pedido**, cada uma com:
  - cabeçalho com nome, tamanho e um chip azul com a quantidade solicitada;
  - **select de tipo de TAG**, com as duas opções descritas de forma didática:
    ```
    🔵 TAG Única  (1 TAG = 1 item específico)   → renderiza N inputs, um por unidade
    🟠 TAG em Massa (1 TAG = múltiplas quantidades) → renderiza 1 input de TAG + 1 de quantidade
    ```
  - texto de ajuda que muda com a escolha ("Você precisará informar 3 TAGs diferentes"
    vs. "Você informará 1 TAG e definirá a quantidade a distribuir");
  - ao trocar o modo, as TAGs já digitadas são **preservadas** e o array só é reformatado;
  - `onBlur` de cada input consulta a API para exibir o **valor unitário** daquela etiqueta;
  - no modo massa, cálculo ao vivo: `valor unitário × quantidade = valor total`;
  - a quantidade no modo massa é limitada ao que foi solicitado, com aviso quando o usuário
    distribui menos que o total.

**Design do estado das TAGs** — comunicação por cor:

| Estado | Borda | Fundo | Interação |
|---|---|---|---|
| vazia | cinza `#e0e0e0` | branco | editável |
| preenchida (nova, única) | verde `#27ae60` | branco | editável, com ✓ |
| preenchida (nova, massa) | laranja `#ff6b35` | branco | editável, com ✓ |
| **já salva** | verde | **verde claro `#d4edda`** | **`readOnly`, cursor `not-allowed`** |

Travar as TAGs já gravadas é uma decisão importante: impede que o operador troque a etiqueta de
um item já baixado do estoque. Só a quantidade do modo massa continua editável.

**Ao confirmar**, a ordem de operações é:

```
1. Monta duas listas:
     todasTags        = apenas as TAGs NOVAS (precisam de validação)
     tagsComMetadados = novas + TAGs em massa existentes cuja QUANTIDADE mudou
2. Se nada mudou (status, TAGs e comentário iguais) → avisa e aborta
3. Se há TAGs novas → POST /tags/validar
     alguma inválida? → ABORTA TUDO e lista os motivos
4. POST /tags/usar   → consome/ajusta o estoque
5. PUT  /pedidos/:id/status → grava status + observação
6. Monta a mensagem de sucesso conforme o que mudou e recarrega a lista
```

> **Falha de atomicidade a corrigir:** os passos 4 e 5 são requisições separadas. Se o 5 falhar,
> as TAGs já saíram do estoque e o pedido ficou com o status antigo. No ambiente novo, **faça
> os dois numa única transação** — um endpoint só, que recebe status e TAGs juntos.

### 5.7 Modal "Editar"

Formulário com os dados do pedido e uma lista editável de equipamentos (adicionar linha,
remover linha, alterar nome/tamanho/quantidade).

Lógica: o frontend faz **diff contra o original** e envia **somente os campos alterados**
(a comparação de `equipamentos` é por `JSON.stringify`). O servidor monta o `SET` dinamicamente
a partir de uma allowlist — campos ausentes no corpo não são tocados. Se nada mudou, avisa e
não chama a API.

### 5.8 Modal "Histórico"

Timeline vertical com bolinha e linha conectora, mostrando `status anterior → status novo`,
autor, data e um badge de origem.

> **Atenção — isto hoje é uma simulação.** Não existe tabela de histórico de pedidos. O servidor
> **fabrica** dois eventos a partir do estado atual: um "CRIADO" (usando a data de criação e o
> nome do solicitante) e, se o status for diferente do inicial ou houver observação, um
> "ATUALIZADO" com autor fixo `"Admin ERP"`. **Toda a trilha intermediária é perdida.**
>
> **No ambiente novo, crie a tabela de verdade** e grave um evento a cada mudança, dentro da
> mesma transação da mudança. A DDL sugerida está na Seção 10.

### 5.9 Adaptação: pedidos de origem interna

**Como funciona hoje.** O pedido entra por uma rota de sincronização que recebe o registro
pronto de um sistema externo, com estas validações:

- campos obrigatórios: pedido, solicitante, colaborador, matrícula, data de solicitação,
  contrato, posto, função, equipamentos e status;
- `equipamentos` precisa ser array não-vazio;
- pedido repetido → **409 Conflito**;
- normalização de status: se vier `PENDENTE`, é convertido para `EM PREPARACAO`;
- normalização de equipamento: se vier `nome_equipamento` sem `nome`, copia para `nome`.

E toda mudança de status ou edição dispara um webhook de volta para a origem
(fire-and-forget, 10s de timeout, falha só é registrada em log e não bloqueia a resposta).

**O que muda:**

| Hoje | No ambiente novo |
|---|---|
| Rota de sincronização recebendo de fora | **Remover.** Pedido criado por rota interna |
| Webhooks de saída (status e edição) | **Remover integralmente** — não há sistema externo |
| Badge de origem no histórico (externo × ERP) | Simplificar — tudo é interno |
| `pedido_id` gerado pela origem | **Você precisa gerá-lo** (ver abaixo) |
| Alias `nome_equipamento` | **Eliminar** — padronize `nome` |

**O que permanece idêntico:**

- o formato do registro, em especial o array de equipamentos e a semântica do índice;
- todas as validações de entrada;
- os quatro status e a semântica de cada um;
- o carimbo de `data_despachado`;
- **toda a tela de acompanhamento**, os modais e o vínculo com o estoque.

**Contrato interno sugerido:**

```
POST /api/pedidos
  body: { nome_colaborador, matricula_colaborador, contrato, posto, funcao,
          equipamentos: [{ nome, tamanho, quantidade }],
          tipo_pedido, admissao, tipo_admissao, data_admissao,
          observacoes_solicitante, imagem_cracha_url }

  o servidor preenche:
    pedido_id        → gerado (sugestão: sequence + formato PED-AAAAMMDD-NNNN)
    nome_solicitante → identidade do usuário logado
    data_solicitacao → hoje
    status           → 'EM PREPARACAO'
```

Mantenha a constraint de unicidade em `pedido_id` de qualquer forma — ela protege contra duplo
clique e reenvio.

---

## 6. Subsistema 4 — Controle de Estoque e TAGs

Inventário rastreado por etiqueta física. É o subsistema com a lógica mais densa do módulo.

### 6.1 Conceito central: dois tipos de etiqueta

O estoque é organizado em **itens** (ex.: "Calça Sarja Preta") e **TAGs** — etiquetas físicas,
tipicamente códigos de barras de 24 dígitos. A TAG é a unidade rastreável, e existem duas
naturezas dela:

| | **TAG única** (`unico`) | **TAG em massa** (`massa`) |
|---|---|---|
| Significa | 1 etiqueta = 1 peça específica | 1 etiqueta = um lote de N unidades |
| Caso de uso | uniforme numerado, item serializado | luvas, material de consumo |
| Saldo | não tem — existe ou foi consumida | `quantidade_massa`, que decrementa |
| Ao consumir | marca `usado = true` e vincula ao pedido | subtrai do saldo; só marca `usado` ao zerar |
| Serve vários pedidos | **não** | **sim** |
| Registro do consumo | a própria linha da TAG | tabela-ledger `estoque_tags_consumo` |

Entender essa dualidade é pré-requisito para tudo o mais neste subsistema.

### 6.2 Como a quantidade disponível é calculada

Existe uma coluna `quantidade_total` mantida por trigger, **mas a listagem não confia nela** —
recalcula na própria query:

```sql
SUM(CASE
      WHEN tipo_tag = 'massa' AND usado = false THEN COALESCE(quantidade_massa, 1)
      WHEN tipo_tag = 'unico' AND usado = false THEN 1
      ELSE 0
    END)
```

A listagem também agrega as TAGs num JSON (`unidades`) e monta a lista distinta de tamanhos
disponíveis (só de TAGs livres).

> Há divergência entre a fórmula do trigger e a da query — uma das migrações deixou o trigger
> somando `quantidade_massa` mesmo com `usado = true`. **Use uma fórmula só**, e prefira
> calcular por query/view a manter coluna denormalizada.

### 6.3 Criação de itens — dois modos de entrada

**Modo normal (TAGs únicas).** O usuário informa, por tamanho, uma **lista de códigos** colada
num textarea. O sistema aceita separação por vírgula **ou** quebra de linha (`split(/[\n,]+/)`)
e cria uma unidade por código. Se a contagem de códigos não bater com o campo "quantidade",
pede confirmação em vez de bloquear.

**Modo em massa.** O usuário informa, por tamanho, **um código + a quantidade** que ele
representa. Gera uma única linha com o saldo.

Ambos aceitam **valor unitário por tamanho**, com fallback para o valor do item — permite
registrar que o tamanho GG custou mais caro que o P no mesmo lote.

### 6.4 A regra de reutilização de etiqueta

A regra mais sutil do subsistema, aplicada tanto na criação quanto na edição:

```
A etiqueta já existe no banco?
├── aponta para um item que não existe mais (órfã)
│      → apaga o registro velho e segue
├── está ATIVA (não usada, ou massa com saldo > 0)
│      → ERRO: "TAG duplicada" — e a mensagem NOMEIA o item que já a está usando
└── já foi usada, ou é massa com saldo zerado
       → apaga o registro velho e RECICLA a etiqueta
```

A ideia de negócio: **uma etiqueta física pode voltar ao estoque depois de consumida** (o item
foi devolvido, higienizado e reetiquetado), mas nunca pode estar ativa em dois itens ao mesmo tempo.

O detalhe de nomear o item dono na mensagem de erro é o que torna esse erro acionável para quem
está no almoxarifado.

### 6.5 Edição de item — algoritmo de reconciliação

`PUT /items/:id` faz um *reconcile* entre o que veio e o que existe:

```
1. Carrega as TAGs ATIVAS do item num mapa por código
2. Calcula a maior sequência já usada no item (incluindo as consumidas), para não colidir
3. Para cada unidade recebida:
     já existe no item     → atualiza valor e/ou quantidade
                             (se veio quantidade_massa, força tipo_tag = 'massa')
     não existe            → checa globalmente:
                               ativa em OUTRO item → REJEITA (acumula, não aborta o resto)
                               já usada            → apaga o velho e reinsere
                               não existe          → insere com sequência = ++maxSequencia
     remove do mapa
4. O que sobrou no mapa foi removido pelo usuário
     → DELETE ... AND usado = false      (NUNCA apaga histórico de TAG consumida)
5. Se o valor unitário do item for > 0, propaga para as TAGs JÁ USADAS com valor divergente
     (para o relatório histórico ficar correto). Valor zero não é propagado.
```

**Decisão de design a preservar:** a operação é **parcialmente bem-sucedida por natureza**.
Uma etiqueta rejeitada não invalida as demais — a resposta traz `tagsRejeitadas` e um texto de
`warnings`, e a mensagem ao usuário vira "item atualizado, mas N TAGs não foram adicionadas".
Num almoxarifado, é melhor gravar 19 de 20 e avisar sobre a que falhou do que perder as 20.

### 6.6 Consumo de TAGs — o algoritmo de delta

O endpoint recebe:

```json
{ "tags": [{ "tagId": "...", "tipoTag": "unico|massa",
             "quantidade": 1, "equipamentoIndex": 0 }],
  "pedidoId": "PED-...", "usadoPor": "nome" }
```

**Para TAG única:**

```
se usado = true E o pedido é OUTRO   → erro "já usada no pedido X"
se usado = true E é o MESMO pedido   → permite (o usuário está alternando o modo)
marca usado = true, grava pedido, data, quem usou e o equipamento_index
```

A permissão de reatribuir dentro do mesmo pedido é intencional: cobre o caso do operador que
salvou como "única" e depois percebeu que deveria ser "massa".

**Para TAG em massa — controle por delta:**

```
existingQty = quanto já foi consumido por (etiqueta, pedido, equipamento)   [0 se novo]
delta       = quantidade_desejada − existingQty

delta == 0              → nada muda no estoque
delta > 0 e saldo <= 0  → erro "TAG esgotada"
delta > saldo           → erro "quantidade adicional maior que a disponível"
senão:
   novoSaldo = saldo − delta
   novoSaldo <= 0 → zera o saldo, marca usado = true e vincula ao pedido
   novoSaldo >  0 → apenas grava o novo saldo
   UPSERT no ledger com a quantidade TOTAL (não o delta)
```

**Por que delta e não valor absoluto:** é o que permite ao operador reabrir o pedido e ajustar
a quantidade para mais **ou para menos** sem corromper o saldo. Baixou 3, voltou e mudou para 5?
Sai mais 2 do estoque. Mudou de 5 para 2? **Voltam 3 unidades.** Sem o ledger e o delta, a
segunda edição debitaria tudo de novo.

**Semântica de erro do lote:** se **algumas** etiquetas falharem mas ao menos uma passar, faz
`COMMIT` e devolve `success: true` com a lista de erros. Só faz `ROLLBACK` se **nenhuma** passar.
É a mesma filosofia da edição — sucesso parcial é preferível a perda total.

### 6.7 Consulta das TAGs de um pedido

Precisa unir duas fontes, porque os dois tipos guardam o vínculo em lugares diferentes:

```sql
-- 1) TAGs únicas: vêm da própria tabela de tags
SELECT ... FROM estoque_tags
 WHERE pedido_id = :id AND (tipo_tag = 'unico' OR tipo_tag IS NULL)
   AND NOT EXISTS (SELECT 1 FROM estoque_tags_consumo c
                    WHERE c.tag_id = estoque_tags.tag_id AND c.pedido_id = :id)
UNION ALL
-- 2) TAGs em massa: vêm do ledger, trazendo a quantidade consumida
SELECT ... FROM estoque_tags_consumo c
  JOIN estoque_tags t ON t.tag_id = c.tag_id
 WHERE c.pedido_id = :id
ORDER BY equipamento_index, usado_em, id
```

O `NOT EXISTS` evita que uma etiqueta que aparece nas duas fontes seja contada em dobro.

### 6.8 Validação de TAGs

Recebe uma lista de códigos e devolve duas listas — válidas e inválidas — com o motivo de cada
recusa ("não existe no estoque" ou "já utilizada no pedido X"). O `success` só é `true` se
**nenhuma** for inválida, o que permite ao frontend abortar o fluxo inteiro com uma checagem só.

O valor unitário retornado é `COALESCE(valor da tag, valor do item)`.

### 6.9 Remoção de TAGs — três comportamentos

```
TAG em massa com saldo > 1  →  DECREMENTA em 1 (não apaga)
TAG única, ou massa com saldo 1  →  apaga a linha
   └─ se era a ÚLTIMA TAG do item  →  apaga o ITEM também
   └─ senão  →  RESEQUENCIA as restantes (ROW_NUMBER() OVER (ORDER BY sequencia))
```

Existe ainda uma remoção forçada por código, sem nenhuma dessas regras — ferramenta de limpeza
para etiquetas órfãs ou fantasma.

### 6.10 Design da tela

Duas visões alternadas por estado local: **dashboard** e **detalhes**.

**Dashboard** — filtro geral por texto e a grade de itens, cada um mostrando nome, quantidade
disponível, tipo, estado (Novo/Higienizado), localização e os tamanhos disponíveis, com ações
de editar, excluir e ver detalhes. Dois botões de criação: "Adicionar Item" e "Adicionar em Massa".

**Modal de adicionar (normal)** — dados do item no topo, seguidos de N blocos de "unidade",
cada bloco com tamanho + textarea de códigos + valor unitário opcional.

**Modal de adicionar em massa** — mesma estrutura, mas cada bloco é uma "distribuição":
tamanho + quantidade + um código + valor. A confirmação mostra o total consolidado:
*"Total de unidades: 120, usando 4 TAGs em modo massa"*.

**Modo edição** reaproveita o modal normal, preservando o tipo original de cada etiqueta através
de um mapa de metadados; etiquetas novas entram sempre como únicas.

**Detalhes** — três filtros independentes (nome, tamanho, código), contador de disponíveis, e a
grade de unidades com edição inline e exclusão.

**Duas decisões de exibição interessantes nessa tela:**

1. **TAGs em massa são "explodidas" em cards virtuais.** Uma etiqueta com saldo 40 é renderizada
   como 40 cards visuais, cada um com uma sequência virtual e um id sintético
   (`${id}-virtual-${i}`). Do ponto de vista do operador, ele vê 40 peças — que é como ele
   pensa o estoque —, mesmo que o banco guarde uma linha só.

2. **O contador de "já usadas" soma naturezas diferentes.** Para etiquetas únicas conta quantas
   estão marcadas como usadas; para as de massa calcula `quantidade original − saldo atual`.
   O resultado é exibido ao lado do nome do item: *"(37 TAGs já usadas em pedidos)"*.

---

## 7. Subsistema 5 — Compras-Licitação

Canal de mão dupla entre os setores de Licitação e Compras. Licitação envia um documento pedindo
cotação; Compras responde com outro documento.

### 7.1 Modelo: uma linha, dois lados

O design guarda **ida e volta na mesma linha**, o que torna a leitura da conversa trivial:

```
IDA      tipo · arquivo · comentário · remetente · data_envio
ESTADO   status: pendente → respondido
VOLTA    resposta_arquivo · resposta_comentário · respondente · data_resposta
LEITURA  visualizado_por/em          (Compras leu o pedido)
         resposta_visualizada_por/em (Licitação leu a resposta)
EDIÇÃO   editado_por · editado_em
```

### 7.2 Regras de negócio

- Criar exige tipo, comentário, remetente **e arquivo** — não existe pedido sem documento.
- Responder exige comentário, respondente **e arquivo**. Muda o status para `respondido`.
- **Editar (pela Licitação) zera os campos de visualização.** A edição faz o item voltar a
  contar como "não lido" para Compras, reacendendo o badge. É a lógica que garante que uma
  alteração no pedido não passe despercebida.
- Arquivos aceitos: PDF, Excel, Word e ZIP, até 10 MB.
- Nomes de arquivo passam por correção de codificação e sanitização (remove caracteres inválidos
  para o sistema de arquivos, troca espaços por `_`) com prefixo de timestamp — preserva acentos
  no nome exibido ao usuário.

### 7.3 Os dois contadores de notificação

```
para Licitação → respondidos cuja resposta ainda não foi lida
para Compras   → pedidos que ainda não foram lidos
```

O hub `/compras` consome o segundo.

### 7.4 Design e comportamento da tela

**Barra de estatísticas** no topo: pendentes e respondidos.

**Lista agrupada em dois níveis de accordion: ano → mês.** Cada nível mostra contadores
(o ano exibe "N solicitações"; o mês exibe badges separados de pendentes e respondidos).
Ordenação: pendentes primeiro, depois por data decrescente.

Dentro do mês, uma grade de cards expansíveis. O card fechado mostra dois badges — tipo
(cotação/impugnação, com ícone de cifrão ou triângulo de alerta) e status. Aberto, revela
remetente, data, comentário, arquivo com botão de download, e os carimbos de edição e
visualização quando existirem.

**Comportamento-chave:** abrir um card pendente que ainda não foi visualizado **dispara
automaticamente** a marcação de leitura e recarrega a lista. O usuário não precisa fazer nada —
ler é o ato de marcar como lido.

**Formulário de resposta inline**, dentro do próprio card: textarea de comentário + input de
arquivo (com validação de tamanho no cliente antes do envio), ambos obrigatórios. Depois de
respondido, a resposta passa a ser exibida no card num **bloco verde** com o cabeçalho
"✓ Sua Resposta", separando visualmente o que veio do que foi enviado.

---

## 8. Subsistema 6 — Aprovação de Catálogo

Fluxo de governança: mudanças no catálogo (contratos, postos, funções, equipamentos e suas
opções) não entram em vigor sem aprovação. As alterações chegam agrupadas em **lotes** e são
aprovadas ou reprovadas **em bloco**.

### 8.1 Modelo

Duas tabelas em relação pai-filho:

- **lote** — identificador, total de alterações, status, quem decidiu, comentário, datas;
- **alteração** — pertence a um lote, e descreve uma operação:
  `tipo_entidade` (contrato · posto · função · equipamento · opções) ×
  `tipo_acao` (criar · editar · excluir) + os dados completos em JSON + uma descrição legível.

### 8.2 Lógica

```
1. Chega um lote → grava lote + todas as alterações filhas numa transação
                   lote repetido → 409
2. O administrador revisa e decide
3. Ao responder:
     valida que o lote está PENDENTE (senão 409 — evita decisão dupla)
     atualiza o lote E todas as alterações filhas, em transação
     notifica a origem da decisão
     se a notificação falhar → marca o lote como ERRO
```

O estado `ERRO` é o detalhe de design que vale registrar: ele distingue "ninguém decidiu ainda"
de "foi decidido, mas a decisão não chegou ao destino". São situações operacionais diferentes e
merecem tratamento diferente.

### 8.3 Design da tela

Filtro por status (Pendentes · Aprovados · Reprovados · Todos) e uma lista de cards, um por lote.

O card não lista as alterações cruas — mostra uma **tabela de contexto** com quatro linhas:
Contrato, Posto, Função e Itens. Esse contexto é **derivado em JS** percorrendo as alterações
do lote: pega o primeiro valor não-nulo de cada campo de contexto e monta um mapa de
equipamentos com suas opções agrupadas por tipo (quantidade / tamanho / litros).

Clicar em "Itens" abre um popup detalhando cada equipamento e suas opções como chips.

> **É a decisão de design mais acertada deste subsistema:** o administrador não precisa ler
> JSON nem entender a estrutura do lote. Ele lê "Contrato X, Posto Y, Função Z, e estes itens" —
> a linguagem do negócio.

Modal de decisão com comentário opcional e dois botões, mostrando o total de alterações que
serão afetadas de uma vez.

> **Decisão a tomar no ambiente novo:** se o catálogo passa a ser mantido dentro do próprio
> sistema, este subsistema provavelmente **não precisa ser replicado** — vira um CRUD de
> catálogo com, no máximo, uma etapa de aprovação interna. Confirme com o dono do produto antes
> de investir aqui.

---

## 9. Subsistema 7 — Manutenção

Cadastro de frota e maquinário, com anexos que documentam manutenções e seus custos.

### 9.1 Estrutura

Dois domínios **simétricos** — veículos e equipamentos — com controllers praticamente idênticos.
Cada item tem: nome, descrição, contrato, posto, flag de "em manutenção" e as datas de início e
previsão de fim. Cada item tem uma tabela de arquivos própria, e **cada arquivo carrega um
comentário e um valor monetário** — é assim que o custo da manutenção fica documentado junto da
nota fiscal.

Uma tabela de log registra toda criação, alteração e exclusão, com campo alterado, valor
anterior e valor novo.

### 9.2 Lógica

- Toda operação de escrita chama um helper que grava no log. **O log nunca quebra a operação** —
  falha ao registrar é apenas logada no console e ignorada.
- A rota que lista os itens em manutenção é declarada **antes** da rota por id, senão o Express
  interpretaria "em-manutencao" como um identificador. Mesma precaução vale para as rotas de
  KPIs do Subsistema 2.
- Ao desmarcar "em manutenção", as duas datas são **limpas** (enviadas como nulas) — não fica
  data órfã de um estado que não existe mais.
- Arquivos: até 10 MB, filtrados por tipo (imagens, PDF, Word, Excel, ZIP).

### 9.3 Design da tela principal

Organização em **cascata de três níveis**: Contrato → Posto → Item, dentro de dois grandes
grupos (Veículos e Máquinas/Equipamentos), cada um com seu dropdown.

**Busca global com expansão automática** — o comportamento mais interessante desta tela. Ao
digitar, os níveis da cascata que contêm resultados **se abrem sozinhos**, em qualquer
profundidade. A lógica: cada nível responde "eu contenho o termo buscado, no meu nome ou no de
algum descendente?" e, se sim, renderiza aberto independentemente do estado manual.

Isso resolve o problema clássico de árvore com busca: o usuário digita e vê o resultado, sem
precisar adivinhar em qual galho procurar.

**Modal do item** — abre com os arquivos e o status de manutenção. Traz:
- checkbox "em manutenção" que revela os dois campos de data;
- lista de arquivos existentes (com link) e novos (a enviar);
- por arquivo: comentário e **valor com máscara BRL progressiva** — o usuário digita só dígitos,
  e o campo formata acumulando da direita para a esquerda (`1` → `R$ 0,01`, `150` → `R$ 1,50`).

Ao salvar, o modal faz duas coisas em sequência: atualiza o status do item e envia os arquivos
novos.

### 9.4 Design do Painel de Manutenções

Tela dedicada, listando o que está em manutenção **naquele momento**. Diferente da tela
principal, aqui **não há agrupamento** — é uma grade plana de cards pequenos
(`minmax(210px, 1fr)`), ordenada por nome, misturando veículos e equipamentos.

Três chips de resumo no topo: nº de veículos (laranja), nº de equipamentos (verde) e o total
(cinza — que vira "N de M" quando há busca ativa).

Cada card: cabeçalho laranja com nome e identificador, corpo centralizado com tipo, contrato,
posto, uma tag "EM MANUTENÇÃO" e o intervalo de datas `início — previsão`.

**Dois estados vazios diferentes**, e essa distinção é boa:

```
nada em manutenção        → ✓ verde  "Nenhum item em manutenção no momento!"
                                     "Todos os veículos e equipamentos estão disponíveis."
busca sem resultado       → 🔍 cinza "Nenhum resultado para 'xyz'"
                                     "Tente outro termo de busca."
```

O primeiro é uma **boa notícia** e é apresentado como tal. O segundo é um beco sem saída e
oferece a saída. Vale replicar esse cuidado nas outras telas.

---

## 10. Modelo de dados consolidado

DDL na ordem de execução, já corrigida (incorpora colunas que no legado eram adicionadas em
tempo de execução e conserta as restrições incompletas apontadas na Seção 12).

```sql
-- =====================================================================
-- 2. SOLICITAÇÕES DE COMPRA
-- =====================================================================
CREATE TABLE compras_solicitacoes (
  id                      SERIAL PRIMARY KEY,
  numero                  INTEGER NOT NULL,
  nome                    VARCHAR(500) NOT NULL,
  motivo                  TEXT,
  descricao               TEXT,
  tipo                    VARCHAR(50) NOT NULL CHECK (tipo IN ('CONTRATO','ADMINISTRATIVO')),
  classificacao           VARCHAR(200),
  empresa                 VARCHAR(300),
  contrato                VARCHAR(300),
  valor_estimado          DECIMAL(12,2),
  valor_final             DECIMAL(12,2),
  status                  VARCHAR(30) NOT NULL DEFAULT 'PENDENTE'
                            CHECK (status IN ('PENDENTE','APROVADO','REPROVADO','COTADO',
                                              'AGUARDANDO_APROVACAO','PAGO','CANCELADO')),
  dispensa_cotacao        BOOLEAN DEFAULT FALSE,
  criado_por_cpf          VARCHAR(11),
  criado_por_nome         VARCHAR(255) NOT NULL,
  criado_por_setor        VARCHAR(100),
  aprovado_por_cpf        VARCHAR(11),
  aprovado_por_nome       VARCHAR(255),
  aprovado_em             TIMESTAMP,
  justificativa_aprovacao TEXT,
  cotado_por_cpf          VARCHAR(11),
  cotado_por_nome         VARCHAR(255),
  cotado_em               TIMESTAMP,
  observacao_cotacao      TEXT,
  pago_por_cpf            VARCHAR(11),
  pago_por_nome           VARCHAR(255),
  pago_em                 TIMESTAMP,
  observacao_pagamento    TEXT,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_compras_sol_status     ON compras_solicitacoes(status);
CREATE INDEX idx_compras_sol_created_at ON compras_solicitacoes(created_at);

CREATE SEQUENCE compras_solicitacoes_numero_seq START 1;

CREATE TABLE compras_historico (
  id             SERIAL PRIMARY KEY,
  solicitacao_id INTEGER NOT NULL REFERENCES compras_solicitacoes(id) ON DELETE CASCADE,
  tipo           VARCHAR(30) NOT NULL
                   CHECK (tipo IN ('criacao','aprovacao','reprovacao','cotacao',
                                   'aguardando_aprovacao','pagamento','cancelamento',
                                   'comentario','correcao','sistema')),
  conteudo       TEXT,
  autor_cpf      VARCHAR(11),
  autor_nome     VARCHAR(255) NOT NULL,
  autor_setor    VARCHAR(100),
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_compras_hist_sol ON compras_historico(solicitacao_id);

CREATE TABLE compras_anexos (
  id               SERIAL PRIMARY KEY,
  solicitacao_id   INTEGER NOT NULL REFERENCES compras_solicitacoes(id) ON DELETE CASCADE,
  historico_id     INTEGER REFERENCES compras_historico(id) ON DELETE SET NULL,
  nome_arquivo     VARCHAR(500) NOT NULL,
  caminho_arquivo  VARCHAR(1000) NOT NULL,
  tamanho_kb       INTEGER,
  tipo_mime        VARCHAR(200),
  enviado_por_cpf  VARCHAR(11),
  enviado_por_nome VARCHAR(255) NOT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_compras_anexos_sol ON compras_anexos(solicitacao_id);

-- Regras de aprovação como DADOS (substitui as constantes hardcoded — ver Seção 4.4)
CREATE TABLE compras_regras_aprovacao (
  id             SERIAL PRIMARY KEY,
  aprovador_cpf  VARCHAR(11) NOT NULL,
  aprovador_nome VARCHAR(255) NOT NULL,
  tipo           VARCHAR(50),    -- NULL = qualquer
  classificacao  VARCHAR(200),   -- NULL = qualquer
  setor_criador  VARCHAR(100),   -- NULL = qualquer
  ativo          BOOLEAN DEFAULT TRUE
);

-- =====================================================================
-- 3. PEDIDOS
-- =====================================================================
CREATE TABLE pedidos (
  id                      SERIAL PRIMARY KEY,
  pedido_id               VARCHAR(50) UNIQUE NOT NULL,
  nome_solicitante        VARCHAR(255) NOT NULL,
  nome_colaborador        VARCHAR(255) NOT NULL,
  matricula_colaborador   VARCHAR(50)  NOT NULL,
  admissao                BOOLEAN DEFAULT FALSE,
  tipo_admissao           VARCHAR(50),          -- 'substituicao' | 'aditivo'
  data_admissao           DATE,
  data_solicitacao        DATE NOT NULL,
  contrato                VARCHAR(255) NOT NULL,
  posto                   VARCHAR(255) NOT NULL,
  funcao                  VARCHAR(255) NOT NULL,
  equipamentos            JSONB NOT NULL,       -- [{nome, tamanho, quantidade}]
  tipo_pedido             VARCHAR(100),
  observacoes_solicitante TEXT,                 -- texto de quem pediu
  observacao              TEXT,                 -- comentário do operador de Compras
  imagem_cracha_url       VARCHAR(500),
  status                  VARCHAR(50) DEFAULT 'EM PREPARACAO'
                            CHECK (status IN ('EM PREPARACAO','AGUARDANDO ENVIO',
                                              'AGUARDANDO COMPRA','DESPACHADO')),
  data_despachado         TIMESTAMP,
  data_criacao            TIMESTAMP DEFAULT NOW(),
  data_atualizacao        TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_pedido_status   ON pedidos(status);
CREATE INDEX idx_pedido_data_sol ON pedidos(data_solicitacao);
CREATE INDEX idx_pedido_contrato ON pedidos(contrato);
CREATE INDEX idx_pedido_colab    ON pedidos(nome_colaborador);

CREATE OR REPLACE FUNCTION atualizar_data_atualizacao() RETURNS TRIGGER AS $$
BEGIN NEW.data_atualizacao = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_pedidos_updated BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION atualizar_data_atualizacao();

-- NOVO — o legado não tem; hoje o histórico é fabricado (ver Seção 5.8)
CREATE TABLE pedidos_historico (
  id              SERIAL PRIMARY KEY,
  pedido_id       VARCHAR(50) NOT NULL REFERENCES pedidos(pedido_id) ON DELETE CASCADE,
  acao            VARCHAR(30) NOT NULL,   -- CRIADO | STATUS | EDITADO | TAGS
  status_anterior VARCHAR(50),
  status_novo     VARCHAR(50),
  observacao      TEXT,
  alterado_por    VARCHAR(255),
  data_alteracao  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_pedidos_hist ON pedidos_historico(pedido_id, data_alteracao);

-- =====================================================================
-- 4. ESTOQUE
-- =====================================================================
CREATE TABLE estoque_items (
  id               SERIAL PRIMARY KEY,
  nome             VARCHAR(255) NOT NULL,
  quantidade_total INTEGER NOT NULL DEFAULT 0,   -- derivada (ver Seção 6.2)
  localizacao      VARCHAR(300),
  tipo_item        VARCHAR(100) NOT NULL,
  estado           VARCHAR(50)  NOT NULL CHECK (estado IN ('Novo','Higienizado')),
  valor_unitario   DECIMAL(10,2) NOT NULL,
  estoque_minimo   INTEGER NOT NULL DEFAULT 0,
  validade         DATE,
  fornecedor       VARCHAR(300),
  contrato_id      INTEGER,
  devolucao        BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_estoque_items_tipo ON estoque_items(tipo_item);

CREATE TABLE estoque_tags (
  id                        SERIAL PRIMARY KEY,
  item_id                   INTEGER NOT NULL REFERENCES estoque_items(id) ON DELETE CASCADE,
  tag_id                    VARCHAR(50) NOT NULL UNIQUE,
  tamanho                   VARCHAR(20) NOT NULL,
  sequencia                 INTEGER NOT NULL,
  tipo_tag                  VARCHAR(10) NOT NULL DEFAULT 'unico'
                              CHECK (tipo_tag IN ('unico','massa')),
  quantidade_massa          INTEGER,
  quantidade_original_massa INTEGER,
  valor_unitario            DECIMAL(10,2),
  usado                     BOOLEAN NOT NULL DEFAULT false,
  pedido_id                 VARCHAR(50),
  equipamento_index         INTEGER,      -- índice 0-based no array de equipamentos
  usado_em                  TIMESTAMP,
  usado_por                 VARCHAR(255),
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_quantidade_massa_valida CHECK (
    (tipo_tag = 'massa' AND quantidade_massa IS NOT NULL AND quantidade_massa >= 0)
    OR (tipo_tag = 'unico' AND quantidade_massa IS NULL)
  )
);
CREATE INDEX idx_estoque_tags_item   ON estoque_tags(item_id);
CREATE INDEX idx_estoque_tags_usado  ON estoque_tags(usado);
CREATE INDEX idx_estoque_tags_pedido ON estoque_tags(pedido_id, equipamento_index);

CREATE TABLE estoque_tags_consumo (
  id                SERIAL PRIMARY KEY,
  tag_id            VARCHAR(100) NOT NULL,
  item_id           INTEGER,
  pedido_id         VARCHAR(100) NOT NULL,
  quantidade        INTEGER NOT NULL DEFAULT 1,
  equipamento_index INTEGER,
  consumido_em      TIMESTAMP DEFAULT NOW(),
  consumido_por     VARCHAR(100)
);
CREATE INDEX idx_consumo_pedido ON estoque_tags_consumo(pedido_id);
-- Recomendado: o legado não tem, e por isso faz SELECT-antes-de-UPSERT (sujeito a corrida)
CREATE UNIQUE INDEX uq_consumo_tag_pedido_eq
  ON estoque_tags_consumo(tag_id, pedido_id, COALESCE(equipamento_index, -1));

CREATE OR REPLACE FUNCTION update_estoque_quantidade_total() RETURNS TRIGGER AS $$
BEGIN
  UPDATE estoque_items SET quantidade_total = (
    SELECT COALESCE(SUM(CASE
      WHEN tipo_tag = 'massa' AND usado = false THEN COALESCE(quantidade_massa, 1)
      WHEN tipo_tag = 'unico' AND usado = false THEN 1
      ELSE 0 END)::integer, 0)
    FROM estoque_tags WHERE item_id = COALESCE(NEW.item_id, OLD.item_id)
  ), updated_at = NOW()
  WHERE id = COALESCE(NEW.item_id, OLD.item_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_quantidade_total
  AFTER INSERT OR UPDATE OR DELETE ON estoque_tags
  FOR EACH ROW EXECUTE FUNCTION update_estoque_quantidade_total();

-- =====================================================================
-- 5. COTAÇÕES
-- =====================================================================
CREATE TABLE cotacoes_impugnacoes (
  id                       SERIAL PRIMARY KEY,
  tipo                     VARCHAR(20) NOT NULL CHECK (tipo IN ('cotacao','impugnacao')),
  arquivo_url              VARCHAR(500) NOT NULL,
  arquivo_nome             VARCHAR(255) NOT NULL,
  comentario               TEXT NOT NULL,
  remetente                VARCHAR(255) NOT NULL,
  data_envio               TIMESTAMP NOT NULL DEFAULT NOW(),
  status                   VARCHAR(20) NOT NULL DEFAULT 'pendente'
                             CHECK (status IN ('pendente','respondido','cancelado')),
  resposta_arquivo_url     VARCHAR(500),
  resposta_arquivo_nome    VARCHAR(255),
  resposta_comentario      TEXT,
  respondente              VARCHAR(255),
  data_resposta            TIMESTAMP,
  visualizado_por          VARCHAR(255),
  visualizado_em           TIMESTAMP,
  resposta_visualizada_por VARCHAR(255),
  resposta_visualizada_em  TIMESTAMP,
  editado_por              VARCHAR(255),
  editado_em               TIMESTAMP,
  created_at               TIMESTAMP DEFAULT NOW(),
  updated_at               TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_cotacoes_status ON cotacoes_impugnacoes(status);
CREATE INDEX idx_cotacoes_envio  ON cotacoes_impugnacoes(data_envio DESC);

-- =====================================================================
-- 6. CATÁLOGO  (avaliar necessidade — ver Seção 8.3)
-- =====================================================================
CREATE TABLE lotes_alteracoes_catalogo (
  id               SERIAL PRIMARY KEY,
  lote_id          VARCHAR(100) NOT NULL UNIQUE,
  total_alteracoes INTEGER NOT NULL,
  callback_url     TEXT,
  status           VARCHAR(20) DEFAULT 'PENDENTE'
                     CHECK (status IN ('PENDENTE','APROVADO','REPROVADO','ERRO')),
  usuario_erp      VARCHAR(255),
  comentario_erp   TEXT,
  data_envio       TIMESTAMP NOT NULL,
  data_resposta    TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE alteracoes_catalogo (
  id            SERIAL PRIMARY KEY,
  lote_id       VARCHAR(100) NOT NULL REFERENCES lotes_alteracoes_catalogo(lote_id) ON DELETE CASCADE,
  alteracao_id  INTEGER NOT NULL,
  tipo_entidade VARCHAR(50) NOT NULL,   -- contrato|posto|funcao|equipamento|opcoes
  tipo_acao     VARCHAR(50) NOT NULL,   -- criar|editar|excluir
  dados         JSONB NOT NULL,
  descricao     TEXT NOT NULL,
  status        VARCHAR(20) DEFAULT 'PENDENTE',
  created_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_alt_catalogo_lote ON alteracoes_catalogo(lote_id);

-- =====================================================================
-- 7. MANUTENÇÃO
-- =====================================================================
CREATE TABLE veiculos (
  id                           SERIAL PRIMARY KEY,
  nome                         VARCHAR(255) NOT NULL,
  descricao                    TEXT,
  contrato                     VARCHAR(500),
  posto                        VARCHAR(500),
  em_manutencao                BOOLEAN DEFAULT FALSE,
  data_inicio_manutencao       DATE,
  data_previsao_fim_manutencao DATE,
  created_at                   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE equipamentos (LIKE veiculos INCLUDING ALL);

CREATE TABLE veiculos_arquivos (
  id            SERIAL PRIMARY KEY,
  veiculo_id    INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
  nome_original VARCHAR(255) NOT NULL,
  nome_arquivo  VARCHAR(255) NOT NULL,
  tamanho       INTEGER,
  tipo          VARCHAR(100),
  url           TEXT,
  comentario    TEXT,
  valor         NUMERIC(12,2),          -- custo documentado no anexo
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE equipamentos_arquivos (
  id             SERIAL PRIMARY KEY,
  equipamento_id INTEGER NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  nome_original  VARCHAR(255) NOT NULL,
  nome_arquivo   VARCHAR(255) NOT NULL,
  tamanho        INTEGER,
  tipo           VARCHAR(100),
  url            TEXT,
  comentario     TEXT,
  valor          NUMERIC(12,2),
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE manutencao_logs (
  id             SERIAL PRIMARY KEY,
  tipo_item      VARCHAR(20) NOT NULL,   -- 'veiculo' | 'equipamento'
  item_id        INTEGER NOT NULL,
  item_nome      VARCHAR(255),
  acao           VARCHAR(80) NOT NULL,
  campo          VARCHAR(100),
  valor_anterior TEXT,
  valor_novo     TEXT,
  usuario_nome   VARCHAR(255),
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 10.1 Sobre anexos e arquivos

Cada subsistema com upload guarda no banco o **caminho relativo** do arquivo e serve o binário
por uma rota dedicada. Limites e tipos aceitos:

| Subsistema | Limite | Aceita |
|---|---|---|
| Solicitações | 50 MB, até 10 arquivos por envio | PDF, Office, imagens, txt, csv, compactados |
| Cotações | 10 MB, 1 por envio | PDF, Excel, Word, ZIP |
| Manutenção | 10 MB, 1 por envio | imagens, PDF, Word, Excel, ZIP |

A rota de download valida contra travessia de diretório (rejeita nomes com `..`, `/` ou `\`),
resolve o tipo pelo sufixo e envia com `Content-Disposition: inline` — o arquivo abre no
navegador em vez de baixar direto, o que é o comportamento certo para PDFs e imagens.

---

## 11. Mapa completo da API

```
# 2 — SOLICITAÇÕES DE COMPRA            /api/compras-solicitacoes
GET  /solicitacoes                      lista paginada + filtros
GET  /solicitacoes/:id                  detalhe + timeline + anexos agrupados
POST /solicitacoes                      cria (status PENDENTE)
GET  /solicitacoes/kpis?mes=            contadores por status
GET  /solicitacoes/stats?mes=           distribuição (gráficos)
GET  /solicitacoes/pendentes-aprovacao?nome=   contagem do badge
GET  /permissoes-usuario?nome=&setor=   capacidades no workflow
PUT  /solicitacoes/:id/aprovar          { acao: aprovar|reprovar, justificativa, usuario_* }
PUT  /solicitacoes/:id/cotar
PUT  /solicitacoes/:id/aguardar-aprovacao
PUT  /solicitacoes/:id/pagar
PUT  /solicitacoes/:id/devolver-aprovacao
PUT  /solicitacoes/:id/corrigir
PUT  /solicitacoes/:id/cancelar
POST /solicitacoes/:id/comentario
POST /solicitacoes/:id/anexos           multipart, campo 'arquivos'
GET  /download/:filename
GET  /usuarios                          lista para selects
   ⚠ declarar kpis/stats/pendentes-aprovacao ANTES de /:id

# 3 — PEDIDOS                           /api/pedidos
POST   /                                cria (rota interna nova — ver Seção 5.9)
GET    /sincronizados                   lista + contagens globais
GET    /:pedidoId
GET    /:pedidoId/historico
PUT    /:pedidoId/status                status + observação (+ TAGs, ver Seção 5.6)
PUT    /:pedidoId/editar                edição parcial
DELETE /:pedidoId

# 4 — ESTOQUE                           /api/estoque
GET    /items                           itens com unidades agregadas
GET    /items/:id
POST   /items                           cria item + TAGs
PUT    /items/:id                       reconciliação de TAGs
DELETE /items/:id
DELETE /tags/:pk                        remove ou decrementa
DELETE /tags/force/:tagId               limpeza de órfãs
POST   /tags/validar                    { tagIds: [] }
POST   /tags/usar                       { tags: [...], pedidoId, usadoPor }
GET    /tags/pedido/:pedidoId
GET    /tags/info/:tagId                diagnóstico
GET    /contratos                        dropdown

# 5 — COTAÇÕES                          /api/cotacoes
GET    /                                lista
GET    /notificacoes                    { licitacao, compras }
GET    /:id
POST   /                                multipart 'arquivo' (Licitação cria)
PUT    /:id/responder                   multipart (Compras responde)
PUT    /:id/visualizar                  { visualizado_por, tipo: original|resposta }
PUT    /:id/editar                      multipart; zera visualização
DELETE /:id

# 6 — CATÁLOGO                          /api/catalogo
POST /notificar-alteracao               recebe lote
GET  /lotes-pendentes?status=
GET  /historico?limite=
POST /responder/:lote_id                { status, usuario, comentario }
GET  /estatisticas

# 7 — MANUTENÇÃO                        /api/manutencao
GET    /veiculos/em-manutencao          ⚠ declarar ANTES de /:id
GET    /veiculos            POST /veiculos
GET    /veiculos/:id        PUT  /veiculos/:id      DELETE /veiculos/:id
POST   /veiculos/:id/upload             multipart 'arquivo'
DELETE /veiculos/:id/arquivo/:arquivoId
   (o conjunto de /equipamentos é idêntico)
```

---

## 12. Defeitos de lógica confirmados — corrigir na reimplementação

Todos verificados na leitura do código. São defeitos **funcionais** — os pontos de segurança e
configuração ficaram fora, conforme combinado.

### 12.1 `valor_final` nunca é gravado

A tela de cotação **envia** `valor_final`, e o servidor da cotação **não lê nem grava** esse
campo. O servidor do pagamento **aceita** `valor_final`, e a tela de pagamento **não envia**.
Resultado: a coluna fica sempre nula e o bloco "VALOR FINAL" do detalhe nunca aparece.

**Correção:** decida em qual etapa o valor final é definido — pelo desenho da tela, é na
**cotação** — e alinhe os dois lados.

### 12.2 Restrições de banco incompletas no script versionado

O script SQL que cria as tabelas de solicitação define um `CHECK` de status **sem**
`AGUARDANDO_APROVACAO`, um `CHECK` de tipo de evento **sem** `correcao` nem
`aguardando_aprovacao`, e não tem a coluna `dispensa_cotacao`.

Em produção "funciona" porque o código cria as tabelas em tempo de execução **sem restrição
nenhuma**. Mas quem provisionar o banco pelo script versionado terá erro nas ações de
encaminhar e corrigir. A DDL da Seção 10 já está corrigida.

### 12.3 Histórico de pedidos é fabricado

Detalhado na Seção 5.8. Não existe tabela; o servidor sintetiza dois eventos a partir do estado
atual, com autor fixo. Toda a trilha real se perde.

### 12.4 A engine de regras está duplicada no frontend, com erro

A tela de detalhe da solicitação **reimplementa** a avaliação das regras de aprovação em JS,
para decidir se mostra os botões. A implementação assume que a classificação da regra é uma
**string** (chama `.startsWith('!')`), mas o servidor devolve **array** para três dos quatro
aprovadores. Chamar `.startsWith` num array lança `TypeError` durante a renderização.

Efeito prático: a tela funciona para o aprovador cujas regras usam curinga e **quebra** para os
que têm lista de classificações.

**Correção:** não duplique a regra. Faça o servidor devolver, junto do detalhe, a lista de
ações permitidas para aquele usuário naquela solicitação. O frontend só renderiza o que veio.

### 12.5 Endpoint de listagem de usuários quebrado

O handler importa o pool de conexão com desestruturação (`const { pool } = require(...)`), mas
o módulo exporta o pool **diretamente**. O resultado é `undefined` e a chamada lança `TypeError`
— o endpoint responde 500 sempre. (A rota de upload, no mesmo arquivo, importa corretamente.)

### 12.6 Consumo de TAG e mudança de status não são atômicos

Detalhado na Seção 5.6. São duas requisições; se a segunda falhar, as etiquetas já saíram do
estoque. Junte numa transação só.

### 12.7 Índice posicional como chave de vínculo

Detalhado na Seção 5.2. O `equipamento_index` amarra TAGs a itens pela **posição no array JSON**.
Reordenar ou remover um equipamento na edição quebra as associações silenciosamente, e a tela
permite exatamente isso.

### 12.8 Duas fórmulas divergentes para a mesma quantidade

Detalhado na Seção 6.2. O trigger e a query de listagem calculam `quantidade_total` de formas
diferentes para TAGs em massa consumidas.

### 12.9 Ledger de consumo sem índice único

O UPSERT em `estoque_tags_consumo` é feito com SELECT seguido de UPDATE/INSERT, sem restrição
de unicidade no banco — sujeito a condição de corrida se dois operadores mexerem no mesmo pedido
ao mesmo tempo. O índice está sugerido na Seção 10.

### 12.10 Carga de dez mil registros para filtrar no cliente

Detalhado na Seção 5.3. Paginação e filtros devem ir para o servidor.

### 12.11 Falha silenciosa no upload pós-criação

Detalhado na Seção 4.12. Se o envio dos anexos falhar depois de criar a solicitação, o erro só
vai para o console — o usuário acha que anexou.

---

## 13. Ordem de implementação sugerida

Pensada para ter valor entregue cedo e deixar o mais acoplado por último.

**Fase 1 — Solicitar Compra** *(maior valor de negócio, zero acoplamento)*
1. Tabelas, sequence de numeração e CRUD.
2. Máquina de estados com as guardas da Seção 4.1 — cada transição em transação, gravando o evento.
3. Regras de aprovação **como dados** (tabela da Seção 10), preservando a semântica da Seção 4.4.
4. Anexos com vínculo a `historico_id`.
5. Telas: dashboard, nova solicitação, detalhe com timeline e painel de ações.
6. Painel TV (acessório — pode ficar por último).

**Fase 2 — Controle de Estoque** *(pré-requisito da Fase 3)*
7. CRUD de itens e TAGs com a regra de reutilização (6.4) e o reconcile de edição (6.5).
8. Validação e consumo, com o algoritmo de delta (6.6).
9. Telas: dashboard, detalhes, modais normal e em massa.

**Fase 3 — Pedidos** *(com a adaptação de origem interna)*
10. Tabela de pedidos + **tabela de histórico real**.
11. Rota interna de criação (5.9), com geração de identificador e validações.
12. Listagem com paginação e filtros **no servidor**.
13. Endpoint único e transacional de status + consumo de TAGs.
14. Tela de acompanhamento, os três modais e a exportação.

**Fase 4 — Compras-Licitação e Manutenção** *(independentes, podem ser paralelos)*
15. Cotações: fluxo ida/volta, marcação de leitura, contadores de badge.
16. Manutenção: CRUD simétrico, anexos com valor, logs, cascata com busca expansiva.

**Fase 5 — Hub e acabamento**
17. Hub `/compras` com os cards e badges (depende dos anteriores para ter o que contar).
18. Decidir sobre Aprovação de Catálogo com o dono do produto.
19. Componentes compartilhados — eliminar as cópias de `Particles`, `Logo` e helpers.
20. Padronizar toasts no lugar de `alert()` e unificar o envelope de resposta da API.

---

## 14. Checklist funcional de aceite

**Solicitar Compra**
- [ ] Criar gera número sequencial e evento de criação na timeline.
- [ ] Anexos do formulário aparecem no cabeçalho; anexos de ação aparecem dentro do evento.
- [ ] Aprovador correto vê os botões; aprovador de outra faixa recebe 403 se forçar a chamada.
- [ ] **Detalhe abre sem erro para todos os aprovadores** (regressão de 12.4).
- [ ] Reprovar sem justificativa é bloqueado.
- [ ] Reprovado → corrigir → volta a PENDENTE com os campos de aprovação limpos.
- [ ] Cotar exige APROVADO; encaminhar exige COTADO; pagar exige AGUARDANDO_APROVACAO.
- [ ] Devolver leva de AGUARDANDO_APROVACAO de volta a COTADO.
- [ ] "Dispensa Cotação" só aparece na combinação certa e pula direto para AGUARDANDO_APROVACAO.
- [ ] Não é possível cancelar uma solicitação paga.
- [ ] **`valor_final` é gravado e exibido** (regressão de 12.1).
- [ ] Filtro "Designadas para mim" retorna só o que aquele aprovador pode aprovar.
- [ ] Badge do dashboard bate com a contagem de designadas.
- [ ] Ctrl+V cola imagem no formulário e no comentário.
- [ ] **Falha de upload após criar avisa o usuário** (regressão de 12.11).
- [ ] Timeline mostra o passo pendente correto para cada status.

**Controle de Estoque**
- [ ] Criar item com códigos separados por vírgula **e** por quebra de linha.
- [ ] Criar item em massa com uma etiqueta representando N unidades.
- [ ] Etiqueta ativa em outro item é rejeitada, e a mensagem **nomeia o item dono**.
- [ ] Etiqueta já consumida pode ser recadastrada (reciclagem).
- [ ] Editar item adicionando e removendo etiquetas reflete certo; consumidas não são apagadas.
- [ ] Uma etiqueta rejeitada não impede as demais de serem gravadas.
- [ ] Quantidade disponível bate com únicas livres + saldo das de massa.
- [ ] Remover a última etiqueta de um item remove o item.
- [ ] Remover uma unidade de etiqueta em massa decrementa em vez de apagar.
- [ ] Etiqueta em massa com saldo 40 aparece como 40 cards na tela de detalhes.

**Pedidos**
- [ ] Criar pela rota interna preenche solicitante e status inicial corretos.
- [ ] Identificador duplicado é rejeitado; pedido sem equipamento é rejeitado.
- [ ] Contadores dos cards refletem o banco inteiro, não a página.
- [ ] Busca encontra por nome de equipamento e por data no formato dd/mm/aaaa.
- [ ] Buscar "admissao" traz os pedidos com a flag ligada.
- [ ] Status DESPACHADO carimba a data de despacho.
- [ ] Atribuir etiqueta única e reabrir o modal **restaura** o estado (travada, verde claro).
- [ ] Atribuir em massa com quantidade 3, reabrir e mudar para 5 → sai só mais 2 do estoque.
- [ ] Mudar de 5 para 2 → **voltam 3 unidades** ao estoque.
- [ ] Etiqueta inválida aborta a operação antes de tocar o estoque.
- [ ] **Falha ao gravar status não deixa etiquetas consumidas** (regressão de 12.6).
- [ ] Em AGUARDANDO COMPRA, o card esconde os equipamentos que já têm etiqueta.
- [ ] **Histórico mostra a trilha real de mudanças** (regressão de 12.3).
- [ ] Editar envia só os campos alterados.
- [ ] **Editar equipamentos não quebra as etiquetas já vinculadas** (regressão de 12.7).
- [ ] Exportação gera colunas por equipamento com etiquetas e valores.

**Compras-Licitação**
- [ ] Criar exige arquivo; responder exige arquivo.
- [ ] Abrir card pendente marca como lido e apaga o badge.
- [ ] Editar pela Licitação **reacende** o badge para Compras.
- [ ] Agrupamento ano/mês com contadores corretos por nível.
- [ ] Arquivo com acento no nome baixa com o nome correto.

**Manutenção**
- [ ] CRUD de veículos e equipamentos com contrato e posto.
- [ ] Marcar em manutenção com datas; desmarcar **limpa** as datas.
- [ ] A rota de "em manutenção" não é confundida com um identificador.
- [ ] Anexo com valor monetário salva corretamente (máscara BRL).
- [ ] Toda ação gera linha no log de auditoria.
- [ ] Busca global expande a cascata até o item encontrado.
- [ ] Painel distingue "nada em manutenção" de "busca sem resultado".

**Hub e transversais**
- [ ] Badge de Compras-Licitação atualiza sozinho a cada 30s.
- [ ] Cards de placeholder não quebram a navegação.
- [ ] Datas não deslocam um dia em nenhuma tela.
- [ ] Estados vazios e de carregamento existem em todas as listas.
- [ ] Toda ação destrutiva pede confirmação.
