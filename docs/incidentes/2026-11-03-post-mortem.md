# Post-mortem — quedas da produção em 03/11/2026

> Todos os horários em **UTC** (Brasília = UTC − 3). Tudo que está aqui foi
> **medido**; o que não deu para provar está marcado como tal na seção 7.

## 1. Resumo

A produção ficou indisponível em **três janelas** no dia 03/11/2026:

| Janela (UTC) | Brasília | Requisições | 5xx | Pior minuto |
|---|---|---|---|---|
| 13:51 → 14:26 | 10:51 → 11:26 | 69.867 | **27.920** | 14:22 — 5.639 req, 3.790 em 5xx |
| 17:28 → 17:33 | 14:28 → 14:33 | 23.930 | **6.994** | 17:29 — 4.837 req, 2.547 em 5xx |
| 18:55 → 19:10 | 15:55 → 16:10 | 69.901 | **37.822** | 19:03 — 6.720 req, 3.675 em 5xx |

No dia inteiro foram 445.885 requisições à API (sem contar `OPTIONS`) e
**76.014 terminaram em 5xx (17 %)**. O banco **nunca caiu**: o Postgres está no ar
desde 16/10 16:14, e o Patroni registrou *"no action. I am (banco1), the leader
with the lock"* a cada 5 s durante todas as janelas.

**Causa raiz em uma frase:** o PostgREST trabalha com um pool de **10 conexões**
(padrão, nunca configurado). Requisições pesadas do próprio frontend ocupam
essas 10 conexões. Quando o PostgREST recarrega o schema nesse estado, a recarga
estoura os 8 s de `statement_timeout`, e ele derruba o pool inteiro. A partir daí,
**todas as abas abertas do ERP recarregam a página ao mesmo tempo**, pelo
`monitorDeQueda`, e a rajada de boot (3.000 a 6.700 req/min, contra 300 a 900
normais) derruba o pool de novo. O ciclo se sustenta sozinho por 10 a 25 minutos.

## 2. Fontes usadas

| Fonte | Onde | Como foi lida |
|---|---|---|
| CPU, carga, memória do banco1 e banco2 | `sar` (`/var/log/sysstat/sa03`), coleta a cada 10 min | `sar -u`, `sar -q`, `sar -r` |
| Log do Postgres e do Patroni | `journalctl -u patroni` | 57.756 linhas exportadas e agregadas fora do servidor |
| Log do PostgREST | arquivo json do container `erp-pilha-rest-1` | `grep` no arquivo (não `docker logs`) |
| Log de acesso do Kong | arquivo json do container `erp-pilha-kong-1` (4,8 GB) | `tail -c` + `grep`, com `nice`/`ionice`, nunca `docker logs` (ver nota) |
| Merges e migrations | `gh run list/view` do `cluster_pos_merge.yml` | horários de aplicação das migrations |

> Nota: um `docker logs` no Kong de 4,8 GB ocupa 38–46 % de um núcleo do banco1
> (medido mais cedo no mesmo dia, durante a primeira queda). Nesta investigação
> nenhum comando passou pelo dockerd.

## 3. Linha do tempo

```
11:20  normal — a cada 30 min o PostgREST perde o LISTEN ("Failed listening for
       notifications ... server closed the connection unexpectedly") e recarrega o
       schema em ~100 ms. Acontece o dia todo: 11:20, 11:50, 12:26, 13:17, 13:47...
12:50  CPU do banco1 sobe para 30–37 % (uso normal do horário).
13:31  WhatsApp Inbox: WA_CONTATO 120–180 req/min (lotes de 40 a cada 8 s).
13:47:07  PostgREST perde o LISTEN (corte de 30 min do HAProxy).
13:47:19  "Failed to load the schema cache ... canceling statement due to statement
          timeout"  →  13:47:20 "Attempting to reconnect to the database".
13:51  malote_despesa_rateio_linha: 409 requisições em 1 minuto (rajada de lotes de
       40 ids, tela de Aprovações/Meus Itens do Malote).
       Primeiros PGRST003 "Timed out acquiring connection from connection pool"
       (13:51:34, 39, 44, 49, 54, 59 — um a cada 5 s). 205 respostas 5xx.
13:59:02  merge da PR #1101 → migration aplicada às 14:00:48 (NOTIFY pgrst).
14:00:56  "Failed to load the schema cache" (×5) → pool reconectado.
14:01  811 respostas 5xx; 14:02 → 1.608.
14:12 → 14:24  CICLO: 2.300 a 5.600 req/min, 40–70 % em 5xx. As rotas que mais
       crescem são as de BOOT da aplicação (profiles, auth/v1/user,
       has_screen_access, app_menu): 1.000 a 1.674 por minuto.
       Schema cache falha de novo às 14:12:07 (×16) e às 14:20:06 (×11).
       sar: CPU 72,68 % usuário + 21,71 % sistema, carga 16,98 em 2 núcleos.
14:25  o ciclo se desfaz sozinho (as abas dessincronizam).
16:35 → 17:27  malote_despesa_rateio_linha em rajadas de ~247 requisições
       (16:37, 16:40, 16:43, 16:47, 16:49, 16:52, 16:54...) — 247 lotes × 40 ids.
17:28:38  "Failed to load the schema cache" (×4); 17:30:23 de novo (×5).
17:29  4.837 req no minuto, 2.547 em 5xx; boot = 1.302/min.
17:33  recupera.
18:52:58  merge da PR #1109 → migration 20261103005000 aplicada às 18:55:02–04.
18:55:15  "Failed to load the schema cache" (×13) → pool reconectado.
18:55  938 em 5xx; 18:56 → 2.903; 18:57 → 3.273.
19:00:08  schema cache falha de novo (×21).
19:02 → 19:08  6.500 req/min, metade em 5xx; boot = 1.800–2.000/min.
       sar: 72,86 % usuário + 24,65 % sistema = 99,5 % de CPU.
19:09  recupera.
```

## 4. Causas, com a prova de cada uma

### C1 — Pool do PostgREST pequeno demais para requisições lentas (causa estrutural)

- O container `erp-pilha-rest-1` (PostgREST **v12.2.3**) não tem `PGRST_DB_POOL`,
  então usa o padrão: **10 conexões**. Prova: no log do Postgres, os erros das
  17:27–17:28 saem de exatamente 10 PIDs (3245534 a 3245554) e, depois da
  reconexão das 17:28:23, de outros 10 (32475xx).
- Com o pool cheio, o PostgREST devolve `PGRST003 Timed out acquiring connection
  from connection pool` (504): **8** às 13h, **148** às 14h, **64** às 17h,
  **55** às 18h, **107** às 19h.
- O que ocupa o pool (top do dia, log do Kong):

| Rota | Requisições | Volume |
|---|---|---|
| `GET planilha_custo` | 1.605 | **3,1 GB** (≈ 2 MB cada) |
| `POST rpc/fluxo_caixa_ler_fonte` | 1.301 | **2,8 GB** |
| `GET malote_despesa` | 2.596 | **2,8 GB** |
| `GET v_fluxo_caixa_importado_fluxo_caixa` | 4.262 | **2,5 GB** |
| `GET v_malote_utilizado_orcamento` | 499 | 1,2 GB |
| `GET sup_pedido` | 764 | 1,2 GB |
| `GET malote_despesa_rateio_linha` | **43.574** | 195 MB (rajadas de 247) |
| `GET WA_CONTATO` | **31.355** | 344 MB (WhatsApp Inbox) |

- Consultas que mais estouraram `statement_timeout` no dia (1.526 no total):
  `v_malote_pagamento_fluxo_caixa` (271), `malote_despesa` (200),
  `rpc fluxo_caixa_ler_fonte` (167), `v_malote_pagamento_fluxo_caixa_consolidado`
  (165), **introspecção de schema do próprio PostgREST (160)**, `tv_relatorio`
  (152). Onde estavam quando estouraram: `malote_tem_recorte_setor` (208),
  `malote_despesa_visivel_por_setor` (150), `user_pode_ver_empresa` (93),
  `erp_login_travado`/`erp_situacao_libera_login` (160), `has_role` (68). Ou seja,
  **RLS por linha** em tabela grande, que é o que a migration
  `20261103004200` (Malote: 3,4 s → 42 ms) corrige.

### C2 — Recarga do schema estoura o `statement_timeout` do `authenticator` (gatilho)

- `authenticator` tem `statement_timeout=8s` (`pg_roles.rolconfig`). A
  introspecção do schema roda como `authenticator`. Em repouso leva **80 a 260 ms**
  (log do PostgREST), mas com a CPU no teto passa de 8 s: 160 introspecções
  canceladas no dia.
- Quando a recarga falha, o PostgREST loga `Failed to load the schema cache` e
  logo em seguida `Attempting to reconnect to the database`: ele **descarta o pool
  e responde 503 para tudo** até conseguir recarregar. Contagem: 14h → 32
  reconexões, 17h → 9, 18h → 13, 19h → 21.
- **O que dispara a recarga:**
  1. **Migration aplicada no merge** (`NOTIFY pgrst, 'reload schema'`). PR #1101:
     migration às 14:00:48, falha às 14:00:56. PR #1109: migration às 18:55:04,
     falha às 18:55:15. As duas maiores quedas começaram **8 a 11 segundos depois
     de uma migration**.
  2. **HAProxy corta a conexão LISTEN a cada 30 min.** `timeout client 30m` e
     `timeout server 30m` em modo TCP: a conexão de LISTEN do PostgREST fica
     ociosa e é derrubada (`Failed listening ... server closed the connection`
     em 11:20, 11:50, 12:26, 13:17, 13:47, 15:25, 15:55, 16:25, 17:16, 17:58...).
     Ao reconectar, o PostgREST recarrega o schema. A das 13:47 foi feita sob
     carga e falhou às 13:47:19.

### C3 — O `monitorDeQueda` sincroniza todas as abas e transforma 1 minuto ruim em 25 (amplificador)

- `src/lib/monitorDeQueda.ts`: qualquer 5xx dispara `sistema_saude`. Com duas
  falhas seguidas, a tela de queda entra e o monitor testa de novo **a cada 15 s
  fixos**. No primeiro sucesso, chama **`window.location.reload()`**.
- Todas as abas entram em queda no mesmo segundo (é o mesmo PostgREST caindo) e
  passam a testar em fase. Quando o servidor volta, **todas recarregam juntas**,
  inclusive as abas em segundo plano que ninguém está olhando.
- Prova pela assinatura das rotas: nos minutos de ciclo, as rotas que crescem não
  são as pesadas, e sim as de **boot da aplicação**:

| Minuto | Req | 5xx | profiles + auth/user + has_screen_access + app_menu | sistema_saude |
|---|---|---|---|---|
| 13:45 (normal) | 231 | 0 | 15 | 0 |
| 14:22 | 5.639 | 3.790 | **1.674** | 206 |
| 17:29 | 4.837 | 2.547 | **1.302** | 182 |
| 19:03 | 6.720 | 3.675 | **1.990** | 219 |

  `GET profiles` sozinho foi de 76/min a **6.859 em 10 minutos** (19:00–19:10).

### C4 — Tudo roda num nó de 2 núcleos (limite físico)

- banco1 (`vc2-2c-4gb`) roda **Postgres + PostgREST + GoTrue + Storage + Kong +
  Edge Functions + Caddy + HAProxy + etcd + Patroni**. No pior minuto: 99,5 % de
  CPU e carga 17,94.
- banco2 (1 vCPU) ficou **70 % ocioso** em todas as janelas: o PostgREST dele
  também manda as consultas para o banco1 (`host.docker.internal:5000`, o
  primário).

### C5 — Agravantes que não derrubam sozinhos

- **Desenvolvedores rodando o frontend local contra a produção**: referer
  `http://192.168.100.18:8080` (10.419 req no dia), `http://localhost:8080`
  (4.014) e `http://192.168.1.38:8080` (1.422). É hot-reload de dev batendo no
  banco de produção.
- **Frontend publicado antes da migration**: às 17:27 o Postgres recusou
  `WA_CONVERSA.menu_enviado_em`, `WA_CONVERSA.ultima_opcao_id`,
  `financeiro_conta_banco` e `financeiro_fluxo_caixa_conta` ("does not exist"). O
  código já estava no ar, mas a migration da PR #1106 **falhou** às 17:38.
- **Log do Kong com 4,8 GB sem rotação**: não existe `/etc/docker/daemon.json`, e
  o `LogConfig` do container é `json-file map[]`.
- **Sem `pg_stat_statements` funcionando**: a extensão está criada, mas fora de
  `shared_preload_libraries` (`ERROR: pg_stat_statements must be loaded via
  shared_preload_libraries`). Por isso não há tempo por consulta.
- **O log do Kong não registra tempo de resposta**: o formato padrão do nginx não
  inclui `request_time`. Não dá para dizer "qual rota ficou lenta", só "qual
  rota apareceu mais".
- **~450 erros/dia de `permission denied for table SISTEMA_RECRUTAMENTO_ETAPA`**
  (11h–14h): uma tela consulta uma tabela sem GRANT. Não derruba nada, mas polui
  o log e vira erro no DevTools (item 7).

## 5. Por que o failover não aconteceu

Resposta curta: **porque não havia nada para o failover resolver**, e se tivesse
acontecido, teria piorado.

1. O Patroni troca de líder quando o **Postgres do líder morre** ou quando ele
   perde o etcd. Nas três janelas o Postgres respondeu, a réplica seguiu `sync` e o
   Patroni logou *"no action. I am (banco1), the leader with the lock"* 11–12
   vezes por minuto (`loop_wait: 5`). Exemplos: 14:15:55, 17:28:55, 18:56:54,
   19:05:54.
2. Quem falhou foi o **PostgREST** (pool e schema cache) e a **CPU** do banco1. O
   HAProxy só pergunta ao Patroni "você é o primário?" (`GET /primary`), e a
   resposta continuou sendo sim.
3. Se o banco2 (1 vCPU, 2 GB) virasse líder, receberia a mesma carga com **metade
   dos núcleos**. Além disso, cada troca de líder custa ~48 s de erro (medido em
   16/10).

Failover protege de **máquina morta**, não de **máquina sobrecarregada**. Contra
sobrecarga, o que protege é a carga não chegar (C1 e C3) e a recarga do schema não
derrubar o pool (C2).

## 6. Ações

As correções estão no relatório de resolução (seção 8), uma a uma, com o teste
de cada uma.

| # | Ação | Ataca | Onde |
|---|---|---|---|
| A1 | Monitor de queda sem recarga sincronizada: espera com jitter e recuo exponencial, e aba em segundo plano não recarrega | C3 | `src/lib/monitorDeQueda.ts` |
| A2 | `authenticator` com tempo suficiente para a introspecção (as requisições continuam com 8 s/3 s, porque o PostgREST aplica o limite do papel personificado) | C2 | migration |
| A3 | HAProxy com `timeout tunnel`, para a conexão LISTEN parar de cair a cada 30 min | C2 | `infra/ha/modelos/haproxy.cfg` + nós |
| A4 | Malote: classificações do rateio numa requisição só, em vez de 247 lotes | C1 | RPC + `useMaloteDespesa.ts` |
| A5 | `emLotes` com no máximo 4 lotes simultâneos por padrão | C1 | `src/lib/emLotes.ts` |
| A6 | Rotação de log do Docker e `request_time` no log do Kong | C5 | compose do cluster |
| A7 | Telas pesadas (`planilha_custo`, Fluxo de Caixa, `malote_despesa`, `sup_pedido`...) paginadas no servidor | C1 | item 4 |
| A8 | Polling eliminado | C1 | item 5 |
| A9 | Ligar `pg_stat_statements` | C5 | Patroni (exige reiniciar o Postgres, ver item 8) |
| A10 | Proibir frontend local apontando para a produção | C5 | item 13 (CI) + orientação ao time |

## 7. O que NÃO foi provado

- **O gatilho exato das 17:28:38.** Não houve migration nem corte de LISTEN
  naquele minuto (o corte foi às 17:16:57, e aquela recarga funcionou). A queda
  das 17:28 começou com o pool já esgotado pelas rajadas do Malote e da Fluxo de
  Caixa. O que fez o PostgREST recarregar o schema às 17:28:38 não ficou registrado
  em nenhum log disponível.
- **Qual processo consumiu a CPU, por processo.** O `sar` guarda CPU total, não
  por processo (`pidstat` não roda em coleta contínua). Que a CPU era do Postgres
  vem do volume de `statement timeout` por RLS, não de uma medição por processo.
  O item 8 resolve isso.
- **Tempo de resposta por rota.** O log do Kong não tem `request_time`.
- A conclusão registrada mais cedo no dia, de que **o WhatsApp Inbox sozinho
  derrubou a produção às 13:38**, estava **incompleta**. O Inbox somava 120–180
  req/min (lotes de 40 a cada 8 s) e pesou na base, mas o colapso começa às 13:51
  com o pool esgotado e só vira queda longa depois da recarga do schema às
  14:00:56 e da recarga em massa das abas.

## 8. Relatório de resolução

Preenchido no item 2 (`docs/incidentes/2026-11-03-resolucao.md`).
