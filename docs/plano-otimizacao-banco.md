# Plano de otimização do banco — sem downtime

> **Documento de trabalho e de passagem de bastão.**
> Se a sessão do Claude acabar, entregue este arquivo ao Codex e peça para
> continuar a partir da primeira fase com status `PENDENTE`.
> Atualizado a cada etapa concluída. Última atualização: **21/09/2026 15:05**.

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
| R6 | **`npm run test` e `npm run build` antes de cada commit.** | Baseline registrado na seção 7. |
| R7 | **Não desligar o Realtime sem autorização explícita.** | Libera 7 conexões, mas remove um recurso em uso. É decisão do gerente, não técnica. |

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

### FASE 1 — `staleTime` global — `STATUS: PENDENTE`

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

### FASE 2 — Aliviar os pollings globais — `STATUS: PENDENTE`

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

### FASE 3 — `debounce` nas buscas por digitação — `STATUS: PENDENTE`

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

### FASE 4 — Corrigir o N+1 do Malote — `STATUS: PENDENTE`

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

### FASE 5 — Paginação e colunas — `STATUS: PENDENTE` (maior, deixar por último)

**Problema:** 264 `select` sem `limit`/`range` e 95 `select('*')`.

Telas mais lentas medidas no banco:

| Tela | Média | Pior caso |
|---|---|---|
| Pedidos de compra (`sup_pedido`) | 1,6 s | 5,5 s |
| Estoque (`sup_estoque_item`) | 2,3 s | 4,2 s |
| Empregados (`EMPREGADOS`) | 2,8 s | 7,7 s |
| Despesas do Malote | 0,7 s | 7,5 s |
| Planilha de custo | 0,3 s | 3,5 s |

**O que fazer, uma tela por vez** (nunca em lote):
1. `.range(de, ate)` com paginação de verdade na tela;
2. trocar `select('*')` pelas colunas realmente usadas;
3. conferir se a tela precisa mesmo de todas as linhas (muitas só mostram as 50 primeiras).

**Esta fase não deve ser feita às pressas.** Cada tela é um commit separado, com
teste manual. É a fase com maior chance de mudar comportamento visível.

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
| Baseline (testes + build) | **OK** | — | 21/09 16:55 | 6 testes já falhavam ANTES — ver seção 7 |
| 1 — staleTime global | PENDENTE | — | — | |
| 2 — pollings | PENDENTE | — | — | |
| 3 — debounce | PENDENTE | — | — | |
| 4 — N+1 Malote | PENDENTE | — | — | |
| 5 — paginação | PENDENTE | — | — | |

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
