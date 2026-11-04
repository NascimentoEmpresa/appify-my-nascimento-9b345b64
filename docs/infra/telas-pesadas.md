# Telas que baixam milhares de linhas: inventário medido e o que foi feito

> Item 4 do pedido de 03/11/2026. Fonte: log de acesso do Kong do dia 03/11
> inteiro (`infra/incidentes/coletar.sh` + agregação por rota e por forma de
> consulta). Volume = bytes que o PostgREST devolveu (o Caddy comprime com
> gzip na saída, então na rede é ~10× menos; **no banco e no PostgREST o custo
> é este**).

## 1. O ranking

| # | Consulta (forma real, do log) | Vezes no dia | Por vez | No dia | Quem pede |
|---|---|---|---|---|---|
| 1 | `planilha_custo?select=*` (2 páginas de 1000) | 1.605 | **2,1 MB** | **3,1 GB** | 11 telas via `usePlanilhaCustos` |
| 2 | `rpc/fluxo_caixa_ler_fonte` (importado) | 1.301 | **17,9 MB** | **2,8 GB** | Fluxo de Caixa |
| 3 | `malote_despesa?select=<80 colunas>` | 2.057 | **1,4 MB** | **2,8 GB** | Meus Itens / Aprovações / Pagamento do Malote |
| 4 | `v_fluxo_caixa_importado_fluxo_caixa` | 4.262 | 0,3–0,8 MB | 2,5 GB | Fluxo de Caixa, Fechamento |
| 5 | `v_malote_utilizado_orcamento?select=*` | 498 | **2,5 MB** | 1,2 GB | 15 telas do Malote/Orçamento via `useUtilizadoOrcamento` |
| 6 | `sup_pedido?select=*,itens,romaneio,comprovação` | 764 | 1,6 MB | 1,2 GB | Pedidos de Materiais |
| 7 | `nf_emissao?select=*,contrato,empresa` | 773 | 1,3 MB | 1,0 GB | Emissão de NF, dashboards |
| 8 | `WA_CONVERSA?select=*` (sem limit) | 1.055 | 0,7 MB | 762 MB | WhatsApp Inbox, **a cada 8 s** |
| 9 | `SISTEMA_NOVIDADES` (200 com descrição) | 4.842 | 60 kB | 289 MB | sininho de novidades, em toda tela |
| 10 | `app_menu?select=codigo,rota,ativo` | 6.717 | 25 kB | 167 MB | `useAccessibleMenus`, a cada navegação |
| 11 | `CHAMADO_SISTEMA?select=*` | 109 | 1,3 MB | 137 MB | painel de chamados |
| 12 | `profiles` (a linha de quem está logado) | 23.912 | — | — | **7 leituras por recarga** |
| 13 | `auth/v1/user` | 25.287 | — | — | **4 idas ao GoTrue por recarga** |

## 2. O que foi feito neste item

| Alvo | Mudança | Corte esperado |
|---|---|---|
| Cache padrão do ERP | `staleTime` de 30 s para **5 min**, `gcTime` de 5 para **30 min** (`src/App.tsx`). Voltar a uma tela não refaz as consultas dela, e navegar não refaz as do layout. Mutation continua invalidando na hora. | todas as linhas acima, na frequência |
| #12 `profiles` | `src/lib/meuPerfil.ts`: **uma** leitura `select=*` compartilhada por Topbar, EmpresaAtiva, Permissões, troca de senha obrigatória e `useMeuNome`. Quem grava no próprio perfil chama `esquecerMeuPerfil()`. | 7 → 1 por recarga |
| #13 `auth/v1/user` | `getUser()` compartilhado por token de acesso, 10 s (`src/integrations/supabase/getUserCompartilhado.ts`, instalado em `client.ts`) | 4 → 1 por recarga |
| #10 `app_menu` | `useAccessibleMenus` com 5 min de cache (eram 30 s) | ~90 % |
| #9 novidades | 30 min de cache (era 1 min). Quem publica invalida a lista. | ~95 % |
| #1 `planilha_custo` | 10 min de cache (as 11 telas já compartilham a mesma chave) | a maior parte das 1.605 leituras/dia |
| #8 `WA_CONVERSA` | limite e fim do poll (item 5) | — |
| rajadas de lote | `emLotes` com no máximo 4 por vez (item 2) | — |

Teste: `src/test/leitura-compartilhada.test.ts`. Prova que 7 pedidos juntos
viram 1 busca, que nada fica velho depois da validade, que erro não fica
guardado, que usuários diferentes não se misturam e que `esquecer()` força
leitura fresca.

## 3. Leitura compacta: as mesmas linhas, ~75 % menores (04/11/2026)

Depois da autorização do Eduardo para otimizar as telas que baixam tudo,
**desde que não quebre**, a escolha foi mudar só o **transporte**: o mesmo
dado, num formato menor. Colunar, para o nome das colunas ir uma vez só, e com
dicionário, para os valores repetidos irem uma vez só. O navegador remonta
**objetos idênticos** e o resto da tela não fica sabendo.

| Fonte | Linhas | Antes | Depois | Redução |
|---|---|---|---|---|
| Fluxo de Caixa — importação histórica | 21.650 | 17,5 MB | 4,3 MB | **76 %** |
| Fluxo de Caixa — Malote / consolidado | 559–4.059 | 0,4–4,0 MB | 0,1–1,3 MB | 63–71 % |
| Fluxo de Caixa — previsto | 28–972 | até 686 kB | até 176 kB | 59–74 % |
| **Planilha de Custo** (11 telas) | 1.909 | 4,5 MB | 1,2 MB | **74 %** |
| Orçamento utilizado do Malote (15 telas) | 5.038 | 2,7 MB | 0,75 MB | **72 %** |

- **Banco:** `leitura_compacta_sql` + `fluxo_caixa_ler_fonte_compacta` +
  `ler_compacto`, migration `20261104000100`. Mesmas cercas da leitura
  antiga: lista fechada de fontes, `SECURITY INVOKER` (a RLS de quem lê
  decide) e o mesmo código de erro para view ausente.
- **Frontend:** `src/lib/leituraCompacta.ts`, usado por
  `useFluxoCaixaMalote`, `usePlanilhaCustos` (sem filtro de texto) e
  `useUtilizadoOrcamento`. Se a função não existe no banco, cai na leitura
  antiga, então front e migration sobem em qualquer ordem.
- **Prova** (`infra/qa/conferir-leitura-compacta.mjs`): o bloco que monta a
  consulta foi extraído **do próprio arquivo da migration** e executado na
  produção como `authenticated`, para 5 usuários comuns de perfis diferentes
  (RH, Financeiro, Comercial, Operacional, Encarregados), em transação desfeita.
  Resultado: **idêntico, linha a linha e campo a campo, nas 10 fontes, para os
  5**, com a mesma ordem (`created_at`/`data_pagamento` decrescentes) onde a
  tela depende dela. Cada um vê uma quantidade diferente de linhas pela RLS
  (559, 2.389, 4.054...).
- **O que foi descartado no caminho:** a 1ª versão numerava o dicionário com
  `dense_rank()`, que ordena a tabela inteira por coluna. Ficou 4× mais
  barata no tamanho e 7× mais cara no banco (287 → 2.070 ms), e CPU do banco é
  o gargalo da produção. A versão final monta o dicionário sobre os valores
  distintos e liga por hash join: ~0,1 s a mais de banco na maior fonte, para
  tirar 13 MB do caminho PostgREST → Kong → gzip do Caddy, que rodam na mesma
  máquina.
- **Testes:** `src/test/leitura-compacta.test.ts` (6). Remontagem com todas as
  chaves; `null` de dicionário continua `null`; zero e `false` intactos;
  formato antigo reconhecido; mais de 100 colunas (a planilha tem ~120, e o
  Postgres limita função a 100 argumentos: a linha vai em pedaços).

## 4. O que NÃO dá para resolver com paginação sem decisão de produto

As linhas #1 a #7 têm a mesma raiz: **a tela calcula no navegador** (KPI,
total, saldo de orçamento, Excel), então precisa da tabela inteira. Paginar
sem levar o cálculo para o servidor **muda os números da tela**. Em telas de
dinheiro (Fluxo de Caixa, Orçamento do Malote) isso não se faz sem validação de
quem usa.

| Tela | O que precisa mudar | Ganho | Risco |
|---|---|---|---|
| **Fluxo de Caixa** (#2, #4) | período/competência filtrado no servidor; totais por aba numa RPC; lista paginada | 17,9 MB → ~200 kB por abertura; a rota mais lenta do teste de carga (p95 5 s) | alto: tela de dinheiro, 21.650 linhas |
| **Orçamento do Malote** (#5) | RPC `malote_utilizado_por_classificacao(periodo)` devolvendo o agregado que as 15 telas somam no cliente | 2,5 MB → poucos kB | alto: alçada de aprovação depende desse número |
| **Malote — listas** (#3) | Meus Itens/Aprovações: só o que está em aberto + "carregar finalizadas" sob demanda; KPIs por RPC | 1,4 MB → ~100 kB | médio |
| **Pedidos de Materiais** (#6) | KPIs por RPC; lista paginada; Excel por Edge Function | 1,6 MB → ~100 kB | médio |
| **Emissão de NF** (#7) | idem | 1,3 MB → ~100 kB | médio |
| **Planilha de Custo** (#1) | cada tela pedir só as colunas que usa (a tabela tem ~120 colunas numéricas) | 2,1 MB → ~300 kB | baixo, mas são 11 telas para auditar |

A leitura compacta (seção 3) já tirou ~75 % do volume das três maiores. O que
sobra na tabela acima é o passo seguinte, de produto. Cada um vira um chamado próprio, com o antes e depois medido pelo
`infra/carga/carga.mjs`. A pipeline do item 13 passa a **reprovar** código
novo que repita o padrão (lista sem `.range`/`.limit` em tabela grande e
`select("*")` em tabela grande).
