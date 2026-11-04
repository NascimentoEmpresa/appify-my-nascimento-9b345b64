# Pipeline que barra código que derruba a produção

> Item 13 do pedido de 03/11/2026. Objetivo: o Eduardo não precisar revisar PR
> de junior nem fazer o papel de QA. **O que a máquina consegue provar, a
> máquina prova e reprova.** O que ela não consegue, está dito na seção 5.

## 1. O que já existia, e o buraco

| Check | Prova | Não prova |
|---|---|---|
| `ci.yml` (tipos, testes, build, lint) | que compila e que os testes passam | que não derruba a produção |
| `revisao_ia.yml` (portaria R1–R8 + revisão por IA) | regras de acesso/RLS, título, branch, migration perigosa | desempenho (a IA pode **não** revisar: com a cota esgotada o check fica verde sem revisar) |
| `cluster_pos_merge.yml` | aplica a migration no merge | — |

As três quedas de 03/11 vieram de código que **passava em tudo isso**: polling,
listas que baixam MB, policy com função por linha.

## 2. O que entra: `qualidade.yml`, dois jobs que REPROVAM

### `guardiao` — regras sobre as linhas que a PR adiciona

`.github/scripts/guardiao-desempenho.mjs`. Só linha **nova** conta: a dívida
antiga não trava ninguém, mas ninguém acrescenta mais.

| Regra | Reprova | Nasceu de |
|---|---|---|
| D1 | `refetchInterval` | WhatsApp Inbox a cada 8 s: 232 req/min de uma aba |
| D2 | `setInterval` que chama o servidor | conversas e conferência de 8 a 30 s |
| D3 | `.channel(` / `postgres_changes` | Realtime não existe no cluster: 404 a cada 10 s, para sempre |
| D4 | `refetchOnWindowFocus: true` | rajada a cada alt-tab |
| D5 | lista sem `.range()`/`.limit()` em uma das 78 tabelas grandes (`.github/tabelas-grandes.json`, tirado da produção) | telas de 1 a 17,9 MB por abertura |
| D6 | `select("*")` em tabela grande | `planilha_custo`: 2,1 MB por leitura, 3,1 GB/dia |
| D7 | `Promise.all` de uma requisição por item | 247 lotes juntos esgotaram o pool |
| M1 | policy com `auth.uid()`, `has_screen_access(...)` etc. **fora** de `(SELECT ...)` | 2,4 s para devolver zero de 86 linhas |
| M2 | FOREIGN KEY sem índice | varredura completa em JOIN/DELETE |
| M3 | `SECURITY DEFINER` sem `SET search_path` | convenção de segurança do projeto |

Cada erro aparece **na linha** da PR, com a explicação do porquê e de como
corrigir. Válvula: `guardiao-ok: <motivo com 15+ caracteres>` num comentário
libera aquela linha, e toda liberação fica listada no resumo da PR.

**Prova de que pega o que importa.** Rodado sobre os commits antigos que
introduziram as causas da queda:

| Commit | O que entrou | O guardião acusaria |
|---|---|---|
| `a6a1c17e` (28/07) | WhatsApp Inbox | D1 polling, D5/D6 lista sem limite (18 achados) |
| `867f43f3` (24/06) | `planilha_custo` | D6 `select *` em tabela grande, M2 FK sem índice |
| `09d03d7f` (09/09) | policy de `SISTEMA_NOTIFICACAO_ALVO` | M1 ×4: a de 2,4 s |

E sobre esta branch, que corrige tudo isso: **zero** achados.
Testes: `src/test/guardiao-desempenho.test.ts` (14). Cada regra pega o caso
ruim, deixa passar o certo e respeita a válvula.

### `qa-requisicoes` — o QA que abre todas as telas

`infra/qa/orcamento-requisicoes.mjs`. Builda a PR, abre **cada uma das ~340
telas** num Chromium com a **API simulada** (nada vai à produção) e mede:

1. **abertura:** requisições para abrir a tela. Reprova acima de 60;
2. **parada:** adianta o relógio da página em **10 minutos** (`page.clock`).
   Qualquer requisição nesse intervalo é busca automática e **reprova**. É o
   que pega polling escondido em hook, timer encadeado ou biblioteca, que
   nenhuma regra de texto enxerga.

Medido em 03/11 nas telas do WhatsApp:

| | Frontend da produção (antes) | Esta branch |
|---|---|---|
| Requisições sozinhas em 10 min parada | **35–36 por tela** → reprova | **0** |
| Requisições para abrir | 54 | 42 |

## 3. Obrigatório desde 04/11/2026 — FEITO

Até 04/11 nada disso travava o merge: o único check obrigatório na `main` era
`validar-chamado` (o prefixo do chamado no título). Ou seja, os dez outros
podiam estar vermelhos e o botão de merge continuava verde — a pipeline era
documentação executável. Hoje a proteção da `main` está assim (conferível com
`gh api repos/.../branches/main/protection`):

| | |
|---|---|
| Checks obrigatórios | `validar-chamado`, `tipos`, `testes`, `build`, `lint`, `migrations`, `portaria`, `revisao-ia`, `guardiao`, `qa-requisicoes`, `migracao-roda` |
| Branch atualizada antes do merge | sim (`strict`) |
| PR obrigatória (sem push direto na `main`) | sim |
| Vale para administrador também | sim (`enforce_admins`) |
| Force push / apagar a `main` | bloqueados |
| Atores com bypass | nenhum |

O que mudou junto, para que "obrigatório" não virasse teatro — os detalhes
estão em [`pipeline-revisao-04-11-2026.md`](pipeline-revisao-04-11-2026.md):

- a **portaria (R1–R8) passou a rodar em todo push** da PR. Antes rodava só na
  abertura: abria-se a PR com uma linha e o código real entrava depois, sem
  passar por regra nenhuma;
- a **label `pular-revisao-ia` deixou de desligar a portaria** (job pulado
  conta como sucesso, então a label era um merge livre);
- **"a IA não revisou" virou vermelho**. Com a cota esgotada o check ficava
  verde sem uma linha de revisão;
- o **veredito da IA passou a bloquear** (era `REVISAO_IA_BLOQUEIA`, nunca
  ligada).

## 4. Regras para o revisor por IA

`.github/REGRAS-PR.md` ganhou a seção **J9 — Desempenho**, com o que a máquina
não pega: tela nova que calcula total no navegador, consulta nova sem índice
para o filtro que usa, e RPC chamada dentro de laço.

## 5. O que a pipeline NÃO consegue garantir (e o que faria isso)

| Lacuna | Por quê | O que resolveria |
|---|---|---|
| **Teste de carga por PR** | Exige um banco com dados de verdade. Não existe homologação; carga na produção a cada PR derrubaria a produção | um **ambiente de homologação**: uma VM com cópia noturna sem dados pessoais (~US$ 30/mês na Vultr). Aí `infra/carga/carga.mjs` roda por PR contra ela e reprova regressão de p95 |
| **Aplicar a migration no schema de verdade** | *Parcialmente resolvido em 04/11:* o job `migracao-roda` já aplica as migrations da PR num Postgres 18 do runner e reprova erro de sintaxe — o que para a fila. O que falta é o schema real, porque as 1.247 migrations não aplicam do zero | um dump **só de schema** da produção, publicado todo dia. Depende de um subcomando novo na chave restrita do cluster (hoje ela aceita só `functions` e `migrations`), que é mudança nos nós |
| **Consulta lenta nova** (falta de índice para um filtro) | Precisa de `EXPLAIN` com dados reais | idem: com o dump de schema no runner, `EXPLAIN` já diria se a policy nova varre a tabela |
| **Tela medida com DADO** (total somado no navegador) | A API falsa do `qa-requisicoes` responde `[]` para tudo, então nenhuma tela exercita render de lista. Devolver linhas sintéticas faria telas quebrarem por formato inesperado e a nova regra de "erro no console" acusaria falso positivo | gerar as linhas a partir do `types.ts` (o tipo de cada tabela está lá) em vez de inventar o formato |
| **Dev rodando o frontend local contra a produção** | Está fora do CI: em 03/11 vieram 15,8 mil requisições de `localhost:8080`, `192.168.100.18:8080` e `192.168.1.38:8080`, com hot-reload batendo no banco de produção | homologação, de novo. Até lá, combinar com o time que `npm run dev` aponta para a produção e é para usar com cuidado |

A homologação é o próximo passo de maior retorno: ela destrava as três
primeiras linhas.
