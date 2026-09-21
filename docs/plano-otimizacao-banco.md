# Plano de otimização do banco — sem downtime

> **Documento de trabalho e de passagem de bastão.**
> Se a sessão do Claude acabar, entregue este arquivo ao Codex e peça para
> continuar a partir da primeira fase com status `PENDENTE`.
> Atualizado a cada etapa concluída. Última atualização: **21/09/2026 19:35**.
>
> **Estado atual: Fases 1–4 e 6 concluídas; Fase 5 parcial.**
> **LEIA A SEÇÃO 1.1 PRIMEIRO:** isto NÃO garante que o banco pare de cair, e lá está o porquê, com medição.
> Nada foi mergeado na `main` — portanto **nada disto está em produção ainda**.
>
> **Para o Codex:** leia a seção 2 (restrições) e o AVISO DE CORREÇÃO DE ESCOPO
> no início da Fase 5. O único item claramente pendente está BLOQUEADO pela
> regra R1 (exige migration) — não o execute sem autorização do gerente.

---

## 1. Por que este trabalho existe

Em **21/09/2026 às 14:01:59** o banco de dados de produção reiniciou sozinho.
Diagnóstico completo (com desenhos, para leigos) em
[`docs/incidente-supabase-2026-09-21.pdf`](incidente-supabase-2026-09-21.pdf).

Resumo da causa: a instância é **Micro**, com `max_connections = 60` menos 3
reservadas = **57 utilizáveis**. Os serviços internos da Supabase já ocupam
**43 dessas 57 de forma permanente** (PostgREST 21, Realtime 7, encanamento ~14).
Sobram ~14. Um pico do Storage (que varia de 1 a 15) estoura o teto, os pedidos
entram em fila, e a máquina de 1 GB reinicia.

**A gerência vetou o upgrade de máquina (escala vertical).** Portanto todo o
ganho tem de vir de *consumir menos*, e não de *ter mais*.

---

## 1.1. Isto impede o banco de cair de novo? — **NÃO, e é importante entender por quê**

> Esta seção foi escrita em 21/09/2026, depois que a pergunta foi feita
> diretamente: *"você tem certeza absoluta que o banco não vai mais cair?"*.
> A resposta honesta é **não**, e esconder isso seria pior do que o problema.

### A conta do que encheu as 57 vagas, linha por linha

| Consumidor | No estouro (14:14) | As fases 1–5 mudam? |
|---|---|---|
| PostgREST | 21 | ❌ **Não.** Pool FIXO, definido pela Supabase conforme o tamanho da máquina |
| Storage | **15** ← o gatilho | ❌ Não (a fase 6 ajuda um pouco) |
| Realtime | 7 | ❌ Não — mas **dá para eliminar** |
| Encanamento interno | 18 | ❌ Não. Fora do nosso controle |

**Medição que prova o ponto principal:** às 19:22, com o sistema praticamente
parado (**1 consulta ativa**), o PostgREST mantinha **as mesmas 21 conexões**
de quando o banco estava afogado.

**O pool do PostgREST não depende do volume de consultas.** Ele segura 21
conexões tendo 1 consulta por segundo ou 70. Portanto **reduzir o número de
consultas — que é tudo o que as fases 1 a 5 fazem — não reduz o número de
conexões**, e foi o número de conexões que estourou.

### Então as fases 1–5 serviram para quê?

Elas são ganho real, só não são *este* ganho:

- telas mais rápidas para quem usa;
- menos CPU, menos memória e menos estouro para disco (o banco gerou 451 MB de
  arquivos temporários em 33 minutos);
- menos tempo com cada conexão ocupada, então menos fila quando houver aperto;
- recuperação mais rápida depois de um pico.

O que elas **não** fazem é impedir o teto de 57 conexões de ser atingido.

### O que realmente ataca a causa — em ordem de impacto

**1. Desligar o Realtime — a única alavanca grande que está nas nossas mãos.**
Libera até 7 das 57. A folga em dia normal sai de ~14 para ~21: **metade de
margem a mais**. Custo: a lista de contratos no catálogo de compras deixa de
atualizar sozinha e passa a atualizar ao recarregar a tela. É **um único hook**
(`useSupCatalogo.ts:114`). Bloqueado pela regra R7 — **decisão do gerente.**

**2. Fase 6 — parar de insistir quando o banco está afogado.** ✅ Feita
(commit abaixo). Não evita o estouro, mas evita que um estouro pequeno vire
reinício. Ver a seção da Fase 6.

**3. Subir a máquina.** Vetado pela gerência. Fica registrado que é a única
solução que resolve de fato, porque os 21 do PostgREST e os ~18 de encanamento
só mudam com o tamanho da instância.

### A resposta honesta, em uma frase

> Com as fases 1–6 o sistema fica mais rápido, mais leve e **muito menos
> propenso a transformar um pico em reinício**. Mas se o Storage voltar a
> saltar para 15 conexões num momento de pico, **o teto de 57 pode estourar de
> novo** — e nenhuma das mudanças feitas até aqui impede isso.
> Quem quiser reduzir esse risco de verdade escolhe entre **desligar o
> Realtime** ou **subir a máquina**. Não há terceira opção no frontend.

---

## 2. Restrições absolutas deste trabalho

Este sistema é de produção crítica: pagamentos, aprovações, dados em tempo real.
Quem continuar este trabalho **deve respeitar estas regras**:

| # | Regra | Por quê |
|---|---|---|
| R1 | **Nenhuma migration, nenhum DDL, nenhuma alteração de schema.** | Qualquer `ALTER`/`DROP`/`CREATE POLICY` em tabela com tráfego pode travar a tabela. Todo o trabalho é **frontend**. |
| R2 | **Nenhuma alteração de dado em produção.** | Nada de `UPDATE`/`DELETE`. |
| R3 | **Uma fase por commit.** | Se algo der errado, `git revert` de um commit desfaz só aquela fase. |
| R4 | **Não mexer no bloco `retry`/`retryDelay` do `QueryClient`.** | É defesa deliberada contra o bug de "JWT expired" (ver comentário em `src/App.tsx:275-283`). Mexer nele reabre um bug de produção conhecido. |
| R5 | **Branch `eduardo`. Nunca criar branch nova.** | Regra R8 do projeto, verificada pelo CI (`.github/REGRAS-PR.md`). |
| R6 | **`npm run test`, `npm run build` E o typecheck antes de cada commit.** | Baseline na seção 7. Veja o alerta sobre o typecheck logo abaixo — **build verde não significa tipos corretos**. |
| R7 | **Não desligar o Realtime sem autorização explícita.** | Libera 7 conexões, mas remove um recurso em uso. É decisão do gerente, não técnica. |

### ⚠️ O `npm run build` NÃO checa tipos

O `vite build` usa esbuild, que apenas transpila — **build verde não prova que
os tipos estão corretos**. Na Fase 4 eu introduzi um erro de tipo real
(`Property 'despesa_id' does not exist on type 'RateioLinha'`) e o build passou
normalmente nas duas vezes. Só o typecheck pegou.

E o typecheck só funciona com o projeto explícito — sem `-p tsconfig.app.json`
ele compila zero arquivos e sempre passa:

```bash
npx tsc --noEmit -p tsconfig.app.json
```

**Baseline: 54 erros**, todos pré-existentes e fora do escopo deste trabalho.
O critério é: continuar em 54 e **nenhum erro nos arquivos que você tocou**.
Filtre assim:

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "error TS" | grep -iE "<seus|arquivos|aqui>"
```

### O que NÃO é garantido (sendo honesto)

Nenhuma dessas mudanças pode derrubar o banco de dados — **todas são frontend,
não tocam no schema nem nos dados**. O risco real não é "o banco cai", é "uma
tela mostra dado velho por alguns segundos" ou "um bug de código numa tela".
Ambos são resolvidos por `git revert`, que devolve o estado anterior na hora.

O que **não** dá para prometer é ausência total de bugs. Por isso: uma fase por
commit, teste antes de cada uma, e a ordem abaixo vai do menos invasivo ao mais
invasivo.

---

## 3. O diagnóstico do frontend (medido em 21/09/2026)

Números levantados por varredura do código e por `pg_stat_statements`:

| Medida | Valor | Significado |
|---|---|---|
| Pontos de consulta (`useQuery`) | **513** | |
| Chamadas `.from()` em hooks | **581** | |
| Queries com `staleTime` próprio | **109** | as outras **~404 usam o padrão `staleTime: 0`** |
| `refetchInterval` (pollings) | **17** | 6 deles rodam em *toda* tela, pra *todo* usuário |
| `select` sem `limit`/`range`/`single` | **264** | contra apenas **30** com paginação |
| `select('*')` | **95** | traz todas as colunas, inclusive as não usadas |
| Arquivos com `debounce` | **8** | várias buscas disparam **1 consulta por tecla digitada** |
| `invalidateQueries` | **586** em 139 arquivos | **rede de segurança: o app já atualiza após toda escrita** |

### Carga medida no banco (33 min após o reinício)

```
tempo total de banco          1.472 s
  sendo de telas (PostgREST)  1.325 s  (90 %)
chamadas totais             140.255    (~70 por segundo)
arquivos temporários          142 / 451 MB   (work_mem = 3,5 MB)
```

Consulta mais chamada: `malote_despesa_rateio_linha`, **25.894 vezes em 33 min**
(~13 por segundo, initerrupto) — é o problema N+1 da Fase 4.

---

## 4. As fases

Ordem escolhida por **ganho ÷ risco**: cada fase seguinte mexe em mais arquivos
que a anterior. Pare em qualquer ponto e o que já foi feito continua valendo.

---

### FASE 1 — `staleTime` global — ✅ `CONCLUÍDA` (commit `94fb7709`)

**Ganho estimado: o maior de todos.** Um arquivo, ~404 queries afetadas.

**Problema:** `src/App.tsx:285` cria o `QueryClient` sem `staleTime`. O padrão do
React Query é `staleTime: 0`, que marca todo dado como velho imediatamente. Com
`refetchOnWindowFocus: true` (também padrão), **toda volta para a aba refaz todas
as consultas da tela**, e toda remontagem de componente refaz a consulta.

O próprio código já reconhece o sintoma — comentário em `src/App.tsx:279`:
> "o refetchOnWindowFocus e os pollings de 60s disparam uma rajada de requests"

A equipe tratou o sintoma (o erro de JWT, via `retry`) mas nunca a rajada.

**Por que é seguro num sistema de pagamento:** `staleTime` só afeta busca
*passiva*. As 586 `invalidateQueries` garantem que toda escrita (aprovar, pagar,
salvar) continua atualizando a tela na hora. Nada muda no fluxo de ação.

**O que fazer** — em `src/App.tsx`, adicionar ao bloco `queries` **sem tocar em
`retry`/`retryDelay`** (R4):
```ts
staleTime: 30_000,   // 30s: dado recém-buscado não é rebuscado à toa
gcTime:    300_000,  // 5min de cache em memória antes de descartar
```
Manter `refetchOnWindowFocus` como está (padrão `true`): com `staleTime` de 30s
ele deixa de disparar a rajada, mas continua atualizando quem ficou tempo fora.

Estender o comentário existente no estilo arqueológico do projeto (CLAUDE.md
exige), citando o incidente de 21/09/2026.

**Como verificar:** `npm run test` + `npm run build`. Na aplicação, trocar de aba
e voltar não deve mais disparar rajada de requests na aba Network.

**Reverter:** `git revert <sha>`.

---

### FASE 2 — Aliviar os pollings globais — ✅ `CONCLUÍDA` (commit `77b4e880`)

**Ganho: carga constante por usuário conectado, o dia inteiro.**

**Problema:** estes rodam em *toda* tela, para *todo* usuário logado, porque
estão na Topbar e na Sidebar:

| Onde | Intervalo | O que busca |
|---|---|---|
| `src/components/layout/Topbar.tsx:88` | 60 s | sininho de notificações |
| `src/hooks/useChamadosNotif.ts:56` | 60 s | bolinha de chamados |
| `src/hooks/useReembolsoNotif.ts:58` | 60 s | bolinha de reembolso |
| `src/hooks/useJuridicoNotif.ts:48` | 5 min | bolinha do jurídico |
| `src/hooks/useTrocaFuncaoNotif.ts` | — | bolinha de troca de função |

Com N usuários conectados, isso é carga fixa de N × (várias consultas/minuto),
independente de alguém estar usando o sistema.

**O que fazer:** subir os intervalos de **60 s para 180 s** nos três de 60 s.
São *bolinhas de aviso*, não dado transacional — 3 minutos de atraso num aviso é
aceitável, e o `invalidateQueries` continua atualizando na hora quando a própria
pessoa age.

**Não mexer:** `WhatsAppInbox` (8 s/5 s) e `ChatChamado` (15 s) são conversa em
tempo real e só rodam na tela aberta. `PainelCatalogoCa` e `useExtratorBeneficios`
já são condicionais (só sondam enquanto processam) — estão corretos.

**Decisão pendente do gerente:** 180 s é sugestão. Se ele preferir manter 60 s
nas notificações, pular esta fase não invalida as outras.

---

### FASE 3 — `debounce` nas buscas por digitação — ✅ `CONCLUÍDA` (commit `e069f86a`)

**Ganho: elimina N consultas por palavra digitada.** É exatamente o exemplo que
o gerente deu.

**Problema:** o texto digitado entra direto na `queryKey`, então **cada tecla
dispara uma consulta nova**. Digitar "MARIA" = 5 consultas ao banco.

Locais confirmados:
| Arquivo | Linha |
|---|---|
| `src/components/encarregados/ColaboradorCombobox.tsx` | 56 |
| `src/hooks/useDiarias.ts` | 272 |
| `src/hooks/useDiariasUfrgs.ts` | 270 |
| `src/hooks/useEspacoColaborador.ts` | 278 |
| `src/hooks/useSupEstoque.ts` | 405 |

**O que fazer:** criar um hook `useDebounce` em `src/hooks/useDebounce.ts` (300–400 ms)
e passar o valor "atrasado" para a `queryKey`, em vez do valor cru do input.
Opcionalmente, exigir mínimo de 3 caracteres antes de consultar.

**Atenção:** 8 arquivos do projeto já têm debounce próprio — conferir antes para
não duplicar padrão. Usar o padrão que já existir, se houver.

---

### FASE 4 — Corrigir o N+1 do Malote — ✅ `CONCLUÍDA` (commit `f36c6832`)

**Ganho: remove ~13 consultas por segundo, constantes.**

**Problema:** `useRateioLinhasEParcelas()` (`src/hooks/useMaloteDespesa.ts:1361`)
busca as linhas de rateio **de uma única despesa**. Ele é consumido por
`JustificativaPendenteBadge` (`src/pages/malote/JustificativaPendenteBadge.tsx:60`),
que é renderizado **dentro do `.map()` das listas**:

```
src/pages/malote/MeusItens.tsx:582      (dentro do .map da linha 540)
src/pages/malote/Aprovacoes.tsx:1019
```

Uma lista de 100 despesas dispara 100 consultas (200 se houver parceladas).
Medido: **25.894 chamadas em 33 minutos**.

**O que fazer:** buscar as linhas de rateio de **todas** as despesas da lista numa
consulta só (`.in("despesa_id", ids)`), em um hook de nível de lista, e passar o
resultado por prop para o badge — ou agrupar num `Map` e consultar em memória.
As duas telas já calculam `despesaIdsTodos` (`MeusItens.tsx:173`,
`Aprovacoes.tsx:227`), então a lista de ids **já existe pronta**.

**Cuidado:** telas de aprovação de pagamento. Testar que a bolinha de
"justificativa pendente" continua aparecendo exatamente nos mesmos casos.

---

### FASE 6 — Parar de insistir quando o banco está afogado — ✅ `CONCLUÍDA`

> **Esta fase não estava no plano original.** Ela apareceu ao investigar se as
> fases 1–5 realmente previnem a queda (seção 1.1). É, de longe, a mais
> importante de todas para a *gravidade* de um incidente futuro.

**O problema:** o `retry` do `QueryClient` tratava dois casos — token vencido
(5 tentativas) e **"todo o resto"** (3 tentativas, backoff 1s/2s/4s). Erro de
banco afogado caía em "todo o resto".

Então às 13:57, quando o Postgres começou a engasgar, **cada consulta que
falhou foi repetida 3 vezes** — por todos os usuários conectados, em ~500
pontos de `useQuery`. Aproximadamente **4× mais requisições em cima de um banco
que já não dava conta**.

Isso tem nome: **colapso por congestionamento**. A resposta automática do
sistema à sobrecarga era gerar mais carga. É plausivelmente o que transformou
um pico de conexões — que seria lentidão passageira — num **reinício do banco**.

**O que foi feito:**

- novo `src/lib/erroSobrecarga.ts` separa "afogado" (521/522/524, 503/504, 429,
  `fetch` morto, pooler sem conexão) de "token vencido";
- afogado ganha **uma única** nova tentativa, com atraso **sorteado entre 4s e
  12s**. O sorteio é essencial: sem ele todos os navegadores voltam no mesmo
  instante e batem em bloco outra vez;
- a checagem de auth vem **sempre antes** — 401/403 é token vencido, não
  sobrecarga. O caminho de auth ficou **byte-idêntico** ao de antes (R4
  respeitada no que ela protegia).

**Também nesta fase:** `ModalFotosComprovacao` assinava as fotos da entrega
**uma a uma, em sequência**. Cada chamada ao Storage consome uma conexão do
pool que ele mantém com o Postgres — e foi o Storage saltando de 1 para 15 que
estourou o teto. Passou a usar `createSignedUrls` (lote).

**Verificação:** 13 testes novos em `src/test/erroSobrecarga.test.ts` cobrindo
inclusive a regra completa do retry como ela roda de verdade. Suíte em **1310
passed** (era 1297).

---

### FASE 5 — Consultas sobre tabelas grandes — `STATUS: PARCIAL`

> ## ⚠️ CORREÇÃO DE ESCOPO — leia antes de trabalhar nesta fase
>
> **A premissa original desta fase estava errada e foi corrigida em 21/09/2026.**
>
> Eu havia dimensionado a fase por "264 `select` sem `limit`/`range`". Esse
> número é um **proxy ruim** e levaria a semanas de trabalho inútil. Ao medir o
> banco de verdade, duas coisas apareceram:
>
> **1. Quase toda consulta "sem limite" tem filtro por chave.** Exemplos que eu
> ia "otimizar" e que já estão certos:
> - `screen_permission_user` (14.555 linhas) → `.eq("user_id", user.id)`, devolve
>   um punhado de linhas.
> - `sup_estoque_tag` (13.408 linhas) → `.eq("item_estoque_id", ...)`.
>
> **2. Quase todo `.limit()` alto é defensivo sobre tabela pequena:**
>
> | Tabela | Linhas REAIS | Limite no código |
> |---|---|---|
> | `JUR_DUVIDAS_COMPLEMENTOS` | **2** | `.limit(5000)` |
> | `conta_contabil` | 1.194 | `.limit(5000)` |
> | `orcamento_contrato_linha` | 8.308 (todas empresas/anos) | `.limit(50000)` |
>
> Eu estava prestes a "consertar" o `useJuridicoNotif`, que busca **2 linhas**.
>
> **O critério certo não é "tem `limit`?" — é "a tabela é grande E a consulta
> não tem filtro por chave?"**. Meça antes de mexer:
> ```sql
> SELECT c.relname, c.reltuples::bigint AS linhas
>   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
>  WHERE n.nspname='public' AND c.relkind='r' AND c.reltuples > 5000
>  ORDER BY c.reltuples DESC;
> ```
> (Não use `pg_stat_user_tables.n_live_tup`: foi zerado no reinício de 14:01:59
> e só volta após o próximo ANALYZE. `pg_class.reltuples` sobrevive.)
>
> As tabelas realmente grandes são quase todas `mz_*` (staging de contabilidade,
> alimentadas por ETL) e **o frontend não as consulta**. A única tabela grande
> que o frontend lê de forma ampla é **`EMPREGADOS` (13.279 linhas, 46 MB)**.

#### ✅ Feito: `FormularioEditor` — commit `12f2a6e1`

Puxava 20.000 linhas de `EMPREGADOS` só pra calcular os setores distintos no
navegador. Trocado pela RPC `listar_setores_empregados`, que já existia e faz o
mesmo `SELECT DISTINCT` no banco.

Medido contra produção: **13.279 linhas → 14**, mesmo conjunto exato (`EXCEPT`
nos dois sentidos deu 0). **949× menos dados.**

#### ⬜ Pendente e BLOQUEADO: `ExportarDados.tsx:168`

```ts
(supabase as any).from("EMPREGADOS").select('"Situação"').limit(20000)
```

Mesmo anti-padrão: **13.279 linhas para obter 9 valores distintos**.

**Está bloqueado pela regra R1 deste trabalho** (sem migration/DDL). O PostgREST
não faz `SELECT DISTINCT`, e não existe RPC de situações — conferi todas as 39
funções com nome parecido. O conserto é uma migration de ~5 linhas, no mesmo
molde da `listar_setores_empregados`:

```sql
CREATE OR REPLACE FUNCTION public.listar_situacoes_empregados()
RETURNS TABLE(situacao text) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
  SELECT DISTINCT btrim("Situação") FROM public."EMPREGADOS"
   WHERE btrim(COALESCE("Situação",'')) <> '';
$$;
NOTIFY pgrst, 'reload schema';
```

**Não execute isso sem autorização** — decisão do gerente, porque sai do combinado
de "nenhuma alteração no banco". Guardado aqui só para quando houver janela.

#### Sobre `select('*')` (95 ocorrências)

Vale trocar pelas colunas usadas **quando a tabela for larga** (`EMPREGADOS` tem
46 MB para 13 mil linhas — as colunas pesam). Em tabela pequena o ganho é
irrelevante e o risco de quebrar uma tela não compensa. Não faça em lote.

#### Telas lentas que sobraram (medidas no banco)

Telas mais lentas medidas no banco:

| Tela | Média | Pior caso |
|---|---|---|
| Pedidos de compra (`sup_pedido`) | 1,6 s | 5,5 s |
| Estoque (`sup_estoque_item`) | 2,3 s | 4,2 s |
| Empregados (`EMPREGADOS`) | 2,8 s | 7,7 s |
| Despesas do Malote | 0,7 s | 7,5 s |
| Planilha de custo | 0,3 s | 3,5 s |

Essas continuam lentas e **não foram investigadas a fundo**. Atenção: a lentidão
delas não vem de "falta de `limit`" — vem do custo da própria consulta (joins,
RLS, agregação). Antes de mexer, rode `EXPLAIN ANALYZE` na consulta real em vez
de presumir.

**Uma tela por commit, com teste manual.** É a parte com maior chance de mudar
comportamento visível, e `Aprovações`/`Pedidos` envolvem pagamento.

---

## 5. Boas práticas a adotar daqui pra frente

Resposta à segunda pergunta do gerente. Sugestão de inclusão no `CLAUDE.md` e no
`.claude/skills/frontend/SKILL.md` depois de validada:

1. **Toda lista paginada.** Nenhum `select` sem `limit`/`range` em tela que possa
   crescer. Padrão sugerido: 50 por página.
2. **Busca por digitação sempre com `debounce`** (300–400 ms) e mínimo de 3
   caracteres. Nunca `queryKey: [..., textoDoInput]` direto.
3. **Nunca uma consulta por linha de lista.** Se o dado é por item, buscar todos
   de uma vez com `.in(...)` no nível da lista. (É o erro da Fase 4.)
4. **`select` com colunas explícitas**, não `*` — menos dado trafegado e menos
   memória no banco.
5. **`staleTime` consciente em cada hook novo.** O default global cobre o caso
   comum; telas que exigem dado sempre fresco declaram o seu.
6. **Polling é exceção, não padrão.** Antes de `refetchInterval`, perguntar se
   `invalidateQueries` após a ação não resolve.
7. **Scripts diretos no banco usam a porta 6543** (transaction mode), não a 5432
   (session mode, que prende uma das 57 conexões enquanto roda). Vale para
   `espelho-mysql/`, `migracao-sistema-antigo/`, `integracao-senior/`.
8. **Não rodar script pesado em horário comercial.**

---

## 6. Registro de progresso

| Fase | Status | Commit | Quando | Observação |
|---|---|---|---|---|
| Baseline (testes + build) | **OK** | — | 21/09 16:55 | ver seção 7 e o aviso abaixo |
| 1 — staleTime global | ✅ **CONCLUÍDA** | `94fb7709` | 21/09 17:1x | `src/App.tsx`, 24 inserções, só 2 linhas de código |
| 2 — pollings | ✅ **CONCLUÍDA** | `77b4e880` | 21/09 17:2x | 3 arquivos, 3 linhas de código (60s → 180s) |
| 3 — debounce | ✅ **CONCLUÍDA** | `e069f86a` | 21/09 18:0x | novo `useDebounce` + 4 hooks de busca |
| 4 — N+1 Malote | ✅ **CONCLUÍDA** | `f36c6832` | 21/09 18:3x | `useRateioLinhasEParcelasEmLote`, mudança aditiva |
| 6 — parar de insistir no afogamento | ✅ **CONCLUÍDA** | `bf80e168` | 21/09 19:3x | NÃO estava no plano; a mais importante para a gravidade |
| 5 — tabelas grandes | 🟡 **PARCIAL** | `12f2a6e1` | 21/09 19:0x | escopo CORRIGIDO na seção 4 — leia o aviso; resta 1 item, bloqueado por R1 |

### O que as 4 fases concluídas atacam

| Fonte de carga | Antes | Depois |
|---|---|---|
| Consultas refeitas à toa (remontagem de componente, volta pra aba) | ~404 queries com `staleTime: 0` | 30s de cache |
| Pollings em toda tela de todo usuário | 3 × a cada 60s | 3 × a cada 180s (**⅓ da carga**) |
| Busca por digitação | 1 consulta **por tecla** | 1 consulta por palavra |
| Badge do Malote (N+1) | **~13 consultas/segundo**, 25.894 em 33 min | 2 consultas por lista |

Nenhuma dessas mudanças altera dado, schema, policy ou comportamento de
aprovação. Todas são reversíveis com `git revert` do commit da fase.

**Importante:** o efeito só aparece em produção após merge na `main` e deploy.
Até lá o banco continua exatamente como estava.

### ⚠️ Aviso importante para quem continuar

**Há outra sessão editando esta mesma árvore de trabalho.** Durante a Fase 1,
`src/test/enderecoEstoque.test.ts` foi modificado por terceiros às 16:58, entre
o meu baseline (16:55) e a minha verificação — o resultado dos testes mudou de
"6 failed | 1284 passed" para "0 failed | 1297 passed" **sem relação com esta
otimização**.

Consequências práticas:

1. **Refaça o baseline** (`npm run test`) antes de começar a sua fase, em vez de
   confiar no número da seção 7. Compare contra o SEU baseline, não contra o meu.
2. **Nunca use `git add .` nem `git commit -a`.** Há um refactor do mapa 3D em
   andamento na árvore (`src/components/suprimentos/mapa3d/*`,
   `src/hooks/useSupEstoqueMapa.ts`, `src/lib/suprimentos/enderecoEstoque.ts`,
   mais uma migration `2026093000200_sup_estoque_mapa_corredor_coluna.sql`) que
   **não é deste trabalho**.
3. Commite **por caminho explícito**: `git commit -F msg.txt -- <arquivo1> <arquivo2>`.
   Eu commitei com `git add` uma vez e arrastei junto uma exclusão de arquivo que
   já estava no stage de outra pessoa (`mapa3d/Estantes.tsx`); precisei desfazer
   com `git reset --soft HEAD~1` e refazer por caminho. Não repita esse erro.

---

## 7. Baseline (estado ANTES de qualquer alteração)

> Preenchido pela execução do baseline. Se algum teste já falhava antes, **não
> foi esta otimização que quebrou** — comparar sempre contra estes números.

```
npm run test   — 21/09/2026 16:55, ANTES de qualquer alteração

  Test Files    1 failed | 96 passed    (97)
        Tests   6 failed | 1284 passed  (1290)
  Duração       33,6 s

  A falha é PRÉ-EXISTENTE e não tem relação com esta otimização:
    src/test/enderecoEstoque.test.ts
    TypeError: enderecoCabeNoModulo is not a function
    (6 testes do mesmo arquivo, todos pela mesma causa)

  >>> Critério de sucesso das fases seguintes: continuar em
  >>> "6 failed | 1284 passed". Qualquer número diferente disso
  >>> foi causado pela alteração e deve ser revertido.
```

---

## 8. Como continuar este trabalho (instruções para o Codex)

1. Ler as seções 2 (restrições) e 6 (progresso) antes de qualquer coisa.
2. Pegar a primeira fase com `STATUS: PENDENTE` e executar **apenas ela**.
3. Rodar `npm run test` e `npm run build`; comparar com o baseline da seção 7.
4. Commitar **só aquela fase**, na branch `eduardo`, mensagem começando com
   `[SEM-CHAMADO]:` (com colchetes), pois não há chamado associado.
5. Atualizar a tabela da seção 6 com status, sha do commit e data.
6. Não avançar para a fase seguinte sem os testes passando.

**Importante:** as mudanças só afetam a produção depois de mergeadas na `main` e
publicadas. O trabalho nesta branch **não altera o sistema em produção** — o que
significa que nada aqui pode derrubar o sistema hoje, e também que o alívio no
banco só aparece após o deploy.
