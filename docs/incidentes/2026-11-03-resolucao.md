# Relatório de resolução — quedas de 03/11/2026

Complemento do [post-mortem](2026-11-03-post-mortem.md). Cada causa tem a
correção, onde ela está e o teste que prova que funciona. "Aplicado" quer dizer
que está na produção, e o teste foi feito na produção.

## Placar

| Causa | Correção | Onde | Estado |
|---|---|---|---|
| C3 — abas recarregando juntas | Reteste com recuo exponencial e sorteio; aba visível espera um sorteio de até 20 s; aba escondida só recarrega quando o usuário volta para ela | `src/lib/monitorDeQueda.ts` | código + 6 testes novos |
| C2 — recarga do schema estoura 8 s | `authenticator` com `statement_timeout=60s`; as requisições seguem com o limite do papel personificado | migration `20261103009100` | **aplicada** 04/11 ~02:35 UTC |
| C2 — LISTEN cortado a cada 30 min | HAProxy com `timeout tunnel 24h` + keepalive de TCP | `infra/ha/modelos/haproxy.cfg` + `infra/ha/aplicar-pilha.sh` | **aplicado** nos dois nós, 04/11 ~02:30 UTC |
| C1 — rajadas de lotes em paralelo | `emLotes` passa a soltar no máximo 4 lotes por vez (antes: todos) | `src/lib/emLotes.ts` | código + teste |
| C1 — Malote: 247 lotes por tela | RPC `malote_rateio_primeira_linha(uuid[])`, uma chamada só | migration `20261103005300` (outro dev, já na main e aplicada) | aplicada |
| C1 — RLS do Malote: 3,4 s por leitura | Empresa e setor por lista | migration `20261103004200` | aplicada (03/11 15:24) |
| C1 — `SISTEMA_NOTIFICACAO_ALVO`: 2,4 s em 86 linhas (sob carga) | Permissão e `auth.uid()` em InitPlan | migration `20261103004300` (escrita em outra sessão, completada nesta PR) | entra no merge |
| C5 — log do Kong de 4,8 GB | `json-file` com `max-size 100m`, `max-file 5` nos 5 containers | `infra/failover/docker-compose.cluster.yml` | **aplicado** nos dois nós (log antigo arquivado em `/root/kong-log-ate-20261103-2329.json.gz`) |
| C1 — telas que baixam MB por abertura | Paginação/filtro no servidor | item 4 | — |
| C1 — polling | Fim do polling | item 5 | — |

## 1. Monitor de queda (C3)

**Antes:** reteste a cada 15 s **fixos** e `window.location.reload()` **no
primeiro sucesso**. Com N abas, as N recarregavam no mesmo intervalo de 15 s.

**Depois:**

| Situação | Antes | Agora |
|---|---|---|
| 1º reteste | 15 s | 7,5–22,5 s (sorteado) |
| 2º, 3º, 4º... | 15 s, 15 s, 15 s | 15–45 s, 30–90 s, 60–180 s (teto) |
| Servidor voltou, aba visível | recarrega já | recarrega após um sorteio de 0–20 s |
| Servidor voltou, aba escondida | recarrega já | **não recarrega**; recarrega quando o usuário volta para ela |
| Botão "Recarregar" | imediato | imediato (é uma pessoa pedindo) |

**Testes** (`src/test/monitor-de-queda.test.ts`, 10/10 verdes; 6 novos):

- recuo de 15 → 30 → 60 → 120 s, com teto;
- 100 abas sorteando: espalhadas por mais de 10 s (antes: 0 s);
- aba visível: com o servidor de volta, **não** recarrega no mesmo instante, e
  recarrega depois do sorteio;
- aba escondida: 5 minutos com o servidor de volta e **nenhuma** recarga;
  recarrega no `visibilitychange`;
- botão manual: imediato.

Os testes novos falham contra a versão antiga. A antiga recarregava no mesmo
tick do sucesso, e a asserção `expect(reload).not.toHaveBeenCalled()` acusa isso.

**Efeito esperado, em números de 03/11:** o pico de boot de 1.674–1.990 req/min
vinha de as abas recarregarem dentro da mesma janela de 15 s. Espalhadas em
20 s, e com as escondidas fora, o pico cai na proporção das abas visíveis. A
medição real é o teste de carga do item 3.

## 2. `authenticator` (C2)

Aplicada com `LOCK=30s bash infra/ha/aplicar-migration.sh` e registrada em
`supabase_migrations.schema_migrations`. Conferido em `pg_roles` logo depois:

```
authenticator: statement_timeout=60s, lock_timeout=8s
authenticated: statement_timeout=8s
anon:          statement_timeout=3s
```

As 18 conexões do PostgREST no banco1 tinham menos de 5 min. O pool recicla
conexão ociosa a cada 30 s, então todas passam a nascer com o limite novo.

## 3. HAProxy e logs (C2/C5)

`ARQUIVAR=1 bash infra/ha/aplicar-pilha.sh --aplicar`: banco2 primeiro, banco1
depois, com `sistema_saude` respondendo **200** antes e depois em cada nó.
Conferido nos dois nós:

- `timeout tunnel 24h`, `option clitcpka`, `option srvtcpka` no
  `/etc/haproxy/haproxy.cfg`;
- os 5 containers com `LogConfig` `max-size:100m max-file:5`;
- PostgREST com `pgrst_db_pool_max 20` (item 3) e `/metrics` respondendo;
- Kong com `KONG_UPSTREAM_KEEPALIVE_IDLE_TIMEOUT=15`, `worker_connections 4096`
  e `nofile 65536` (item 7), e logando `rt=` e `urt=` (item 8).

**O corte do LISTEN acabou, medido.** Antes, o log do PostgREST tinha
`Failed listening` duas vezes por hora, a noite inteira de 03/11 (00:20, 00:50,
01:20, 01:50...). Depois da aplicação, conferido às 03:34 UTC de 04/11:

| Nó | PostgREST no ar há | `Failed listening` | Recargas de schema | `Failed to load` |
|---|---|---|---|---|
| banco1 | 62 min (desde 02:32:47) | **0** | 1 (a do início) | 0 |
| banco2 | 63 min (desde 02:31:23) | **0** | 1 (a do início) | 0 |

Foram dois ciclos inteiros de 30 min sem nenhum corte. No Grafana isso aparece
como `pgrst_schema_cache_loads_total` parado.

## 4. `emLotes` (C1)

`simultaneos` passou de `Infinity` para `4`. Uma lista de 10 mil ids era 247
requisições ao mesmo tempo para um pool de 10 conexões. Agora são no máximo 4, e
sobram 6 conexões para o resto do ERP.

Teste: `src/test/em-lotes.test.ts`. Com 30 lotes de 40, o pico de lotes em voo
é **exatamente 4**.

## 5. O que fica para os outros itens

- **PostgREST com 10 conexões:** só aumentar depois do teste de carga (item 3).
  Com 2 núcleos, mais conexões podem significar mais disputa de CPU, não mais
  vazão. Precisa de medição, não de palpite.
- **Senha do `authenticator`:** apareceu em texto puro na saída de um
  `docker inspect` durante esta investigação (a sessão do Claude Code
  registrou). Recomendação: trocar. É `ALTER ROLE authenticator PASSWORD ...` e
  o mesmo valor em `PG_SENHA_SERVICOS` no `.env` dos dois nós, seguido de
  `docker compose up -d rest`.
- **Devs locais batendo na produção** (15,8 mil requisições no dia): item 13.
