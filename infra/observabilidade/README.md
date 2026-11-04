# Saúde da produção: Grafana Cloud + diagnóstico em um bloco

> Item 8 do pedido de 03/11/2026. Duas ferramentas, para duas perguntas:
>
> | Pergunta | Ferramenta |
> |---|---|
> | "Como está a produção hoje comparada a ontem? Está piorando?" | **Painel no Grafana Cloud**, com a linha de hoje e a de ontem no mesmo gráfico |
> | "Caiu agora. Por quê?" | **`diagnostico.sh`**: um bloco de texto que você cola no Claude, e a causa costuma estar escrita nele |

## Por que Grafana Cloud (plano grátis)

- Os 2 núcleos do banco1 já são o limite do ERP (docs/infra/capacidade.md).
  Prometheus + Grafana **dentro** dele disputariam CPU com o Postgres
  justamente na hora da queda, e cairiam junto com o que deveriam mostrar.
- O plano grátis cobre o ERP: 10 mil séries de métrica, 50 GB de log por mês
  e **14 dias** de histórico. O log do Kong dá ~1 GB/dia somando os dois nós,
  descontados os `OPTIONS`.
- Datadog faria o mesmo por algumas centenas de dólares por mês.

## O que é medido

| Fonte | Mostra | Responde |
|---|---|---|
| Log do Kong (agora com `rt=` tempo de resposta) | req/min, 4xx/5xx, p95, rotas mais chamadas e mais lentas | "o usuário está vendo erro? qual tela?" |
| PostgREST `/metrics` (porta 3001, só localhost) | pool livre/esperando, `PGRST003`, recargas de schema OK/FAIL | as causas C1 e C2 do post-mortem de 03/11, ao vivo |
| Patroni `/metrics` | quem é o líder, atraso da réplica | "trocou de líder?" |
| Postgres (papel `monitor`, só leitura) | conexões por estado, transações, locks | "o banco está lotado?" |
| Máquina (node) | CPU, carga, memória, disco, rede | "o nó está no limite?" |
| Containers (cadvisor) | CPU/memória de cada serviço | "quem está comendo a CPU?" (o que faltou em 03/11) |
| Journal do Patroni | log do Postgres: `statement timeout`, `ERROR`, `FATAL` | "qual consulta estourou?" |

## Estado em 03/11/2026

| Passo | Estado |
|---|---|
| 1. conta, stack e token | **feito**: stack `redgarlic110`, região **São Paulo** (`prod-sa-east-1`). Access policy `erp-alloy` (só `metrics:write` e `logs:write`, só neste stack), token no `.env.local`. Conferido com um envio de teste ao Loki (HTTP 204) e lido de volta pelo painel |
| 2. pilha nova + agente nos nós | **falta**: escrita na produção, você roda (abaixo) |
| 3. painel | **feito**: https://redgarlic110.grafana.net/d/erp-saude-producao (fica vazio até o passo 2) |
| 4. alertas | **feito**: 7 regras na pasta **ERP**, para o contato padrão (e-mail da conta). Para mandar ao Discord, troque o contato em *Alerting → Notification policies* |
| 5. `pg_stat_statements` | **falta**: exige reiniciar o Postgres, na janela do item 11 |

O stack está em **teste de 14 dias** (até 18/11/2026) e depois cai sozinho no plano grátis, que basta.

## Passo a passo

### 1. Criar a conta e pegar as 5 chaves (no navegador, uma vez)

1. Abra **https://grafana.com/auth/sign-up/create-user** e crie a conta (dá para
   entrar com o Google). Plano: **Free**.
2. Ele pede um nome de *stack*. Use `grpnascimento`. Região: **AWS São Paulo
   (sa-east-1)**, se aparecer; senão, **US East**.
3. Na página inicial do *stack* (https://grafana.com/orgs/<sua-org>), no cartão
   **Prometheus**, clique **Details**. Copie:
   - **Remote Write Endpoint** (termina em `/api/prom/push`) → `GC_PROM_URL`
   - **Username / Instance ID** (um número) → `GC_PROM_USER`
4. Volte, no cartão **Loki** clique **Details**. Copie:
   - **URL** e acrescente `/loki/api/v1/push` no fim → `GC_LOKI_URL`
   - **User** (outro número) → `GC_LOKI_USER`
5. No menu da esquerda, **Security → Access Policies → Create access policy**:
   nome `erp-alloy`, *Realms*: o seu stack, *Scopes*: marque **metrics: write** e
   **logs: write**. Salve, clique **Add token**, nome `nos`, **Create**. Copie o
   token (`glc_…`), que só aparece uma vez → `GC_TOKEN`.
6. No **VS Code deste PC**, abra o arquivo **`.env.local`** da raiz do projeto
   (o que já tem `VULTR_API_KEY`) e cole no fim:

   ```
   GC_PROM_URL=https://prometheus-prod-xx-prod-sa-east-1.grafana.net/api/prom/push
   GC_PROM_USER=1234567
   GC_LOKI_URL=https://logs-prod-xxx.grafana.net/loki/api/v1/push
   GC_LOKI_USER=7654321
   GC_TOKEN=glc_...
   ```

   O `.env.local` não vai para o git. A raiz tem `.env` versionado e o repo é
   público: **nunca** cole lá.

### 2. Aplicar a pilha nova e instalar o agente nos dois nós (fora do horário)

No terminal deste PC, no prompt do Claude Code:

```
! ARQUIVAR=1 bash infra/ha/aplicar-pilha.sh --aplicar
! bash infra/observabilidade/instalar-alloy.sh --aplicar
```

O primeiro recria os containers que mudaram: Kong com `rt=` e as correções do
502, PostgREST com `/metrics` e pool 20, e log com teto. Faz um nó por vez e
para se o nó não voltar. O segundo instala o Grafana Alloy (~100 MB de RAM em
cada nó).

### 3. Importar o painel

No Grafana do stack (https://grpnascimento.grafana.net): menu **Dashboards →
New → Import** → **Upload dashboard JSON file** → escolha
`infra/observabilidade/painel-saude.json`. Nos dois campos de *datasource*,
escolha os `grafanacloud-grpnascimento-prom` e `-logs` → **Import**.

O painel abre em "últimas 24 h". A linha **tracejada cinza** é a mesma hora de
**ontem**. Para ver a semana, troque o período no canto superior direito.

### 4. Alertas (direto para o seu Discord, por DM)

**Alerting → Contact points → Add**: tipo **Discord**, cole o webhook. Depois
**Alerting → Alert rules → New alert rule**, uma para cada linha:

| Nome | Fonte | Consulta | Dispara quando |
|---|---|---|---|
| API com erro | Loki | `100 * sum(count_over_time({servico="kong",classe="5xx"}[2m])) / sum(count_over_time({servico="kong"}[2m]))` | > 2 por 2 min |
| Pool do PostgREST cheio | Prometheus | `max(pgrst_db_pool_waiting)` | > 0 por 1 min |
| Recarga de schema falhou | Prometheus | `sum(increase(pgrst_schema_cache_loads_total{status="FAIL"}[5m]))` | > 0 |
| CPU do banco1 | Prometheus | `100 - 100 * avg(rate(node_cpu_seconds_total{mode="idle",no="banco1"}[5m]))` | > 85 por 5 min |
| Disco | Prometheus | `max(100 - 100 * node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})` | > 85 |
| Líder trocou | Prometheus | `changes(patroni_primary{no="banco1"}[10m])` | > 0 |
| Réplica atrasada | Prometheus | `max(patroni_xlog_received_location - patroni_xlog_replayed_location)` | > 100000000 por 5 min |

### 5. Ligar o `pg_stat_statements` (o "top consultas"), na próxima janela

A extensão está criada, mas **não carregada**. Sem ela não existe "quanto tempo
cada consulta gastou hoje", que foi a lacuna do post-mortem. Precisa
**reiniciar o Postgres**, então junte com o upgrade do item 11
(docs/infra/upgrade-vultr.md, passo 6), fora do horário:

```
! ssh -p 8443 root@216.238.120.171 "/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml edit-config -p 'shared_preload_libraries=pg_cron,pg_stat_statements' --force && /opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml restart erp-ha --force"
```

O `restart` reinicia **os dois** nós, a réplica primeiro: ~10–30 s de erro no
líder. Depois disso o `diagnostico.sh` passa a mostrar as 8 consultas que mais
gastaram tempo.

## O diagnóstico em um bloco

No terminal deste PC, no prompt do Claude Code:

```
! bash infra/observabilidade/diagnostico.sh
```

Leva ~20 s e só **lê**. Nos dois nós, mostra:

- carga, CPU e memória;
- estado do Patroni;
- req/min, 4xx, 5xx e p95 **por minuto**;
- top rotas e origem do tráfego;
- eventos do PostgREST por minuto (pool esgotado, schema cache, reconexão);
- conexões, o que está rodando e há quanto tempo, quem espera lock, timeouts
  por alvo e erros do Postgres;
- CPU/memória de cada container.

Cole a saída inteira na conversa. Para uma janela maior:
`! MINUTOS=30 bash infra/observabilidade/diagnostico.sh`.

Ele nunca chama `docker logs`: lê a cauda do arquivo com `nice`/`ionice`. Em
03/11 um `docker logs` no log de 4,8 GB do Kong agravou a queda.

## Arquivos

| Arquivo | O quê |
|---|---|
| `diagnostico.sh` | o bloco de texto para colar |
| `config.alloy` | o que o agente coleta e manda |
| `instalar-alloy.sh` | instala o agente nos dois nós (banco2 primeiro) |
| `gerar-painel.mjs` → `painel-saude.json` | o painel (editar o `.mjs` e regerar) |
| `../incidentes/coletar.sh` + `analisar.mjs` | o dia inteiro, para post-mortem |
