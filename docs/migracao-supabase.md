# Migração do Supabase para o cluster próprio

Levantamento feito em **08/10/2026**, por medição contra a produção (leitura
apenas) e por ensaio de restauração no cluster novo. Nenhum número aqui é
estimativa.

## O que é a produção hoje

| | |
|---|---|
| Supabase | PostgreSQL **17.6**, `wal_level=logical` |
| Host alcançável | `aws-1-sa-east-1.pooler.supabase.com:5432` (o `aws-0` recusa o tenant) |
| Tamanho | **2.346 MB** |
| Tabelas em `public` | **647** |
| Schemas com dados | `auth`, `cron`, `espelho`, `net`, `public`, `realtime`, `storage`, `supabase_migrations`, `vault` |
| Slots de replicação | **nenhum** em uso (limite 10) |
| Publicações | `supabase_realtime`, `supabase_realtime_messages_publication` — do Supabase, **não mexer** |

O cluster novo roda **PostgreSQL 17.11** — mesma versão maior. A armadilha de
versão que derrubou o ensaio anterior (ver `failover_replica_container_provado`)
não se aplica aqui.

## O que o schema contém

`pg_dump --schema-only --schema=public` produziu 110.433 linhas (4 MB), sem
erro de leitura:

```
647 tabelas   1.230 funções   1.416 políticas de RLS
789 índices     493 triggers     30 views   71 sequences   109 tipos
```

## O ensaio de restauração — e por que ele foi decisivo

Restaurando esse dump num PostgreSQL 17 limpo, **2.436 erros**:

| Causa | Ocorrências |
|---|---|
| `role "X" does not exist` | 1.391 |
| `relation "X" does not exist` | 728 |
| `schema "X" does not exist` | 306 |
| tipos / operator class | 10 |

Resultado:

| Objeto | Entrou | Total |
|---|---|---|
| Tabelas | 551 | 647 |
| Funções | 1.219 | 1.230 |
| Índices | 1.465 | — |
| Triggers | 385 | 493 |
| **Políticas de RLS** | **1** | **1.416** |

**Uma política de 1.416.** Um banco restaurado assim sobe funcionando e **sem
controle de acesso** — deny-by-default deixa de existir e todo usuário
autenticado enxerga o que não deve, sem nenhum erro visível na tela. Este é o
motivo de o ensaio existir: sem ele, isso seria descoberto em produção.

A causa não é dificuldade, é **ordem**: o dump referencia 2.556 vezes o schema
`auth` e 1.397 vezes o papel `authenticated`, que não existem num Postgres
comum. Faltando o papel, o `CREATE POLICY` inteiro falha.

## Ordem correta do restore (RESOLVIDO em 08/10/2026)

1. **Papéis**, antes de tudo: `anon`, `authenticated`, `service_role`,
   `authenticator`, `supabase_admin`, `supabase_auth_admin`,
   `supabase_storage_admin`. São `CREATE ROLE` simples.
2. **Schemas** `auth`, `storage`, `vault`, `extensions`.
3. **Extensões**: `btree_gist`, `pgcrypto`, `uuid-ossp`, `pg_trgm`,
   `pg_stat_statements`. Resolvem também o erro de *operator class* do `gist`
   com `uuid`.
4. **O contrato de autenticação**: `auth.uid()`, `auth.role()`, `auth.jwt()` e a
   tabela `auth.users`. É disto que dependem as 1.416 políticas — e é a peça
   que o Supabase fornece como serviço (GoTrue), não como banco.
5. **O dump**, e depois **o dump de novo**: o segundo passe resolve os 728
   `relation does not exist`, que são dependências em ordem inconveniente.
6. Conferir o placar: `select count(*) from pg_policies` tem que bater **1.416**.

Esta ordem está automatizada em [`../infra/ha/restaurar-schema.sh`](../infra/ha/restaurar-schema.sh),
com a preparação em [`../infra/ha/preparar-destino.sql`](../infra/ha/preparar-destino.sql).

## Replicação lógica — o que precisa ser resolvido antes

**11 tabelas não têm chave primária.** A replicação lógica não replica `UPDATE`
nem `DELETE` nelas: a assinatura **trava com erro**, para de consumir o slot, e
o WAL começa a acumular no Supabase. É assim que uma migração derruba a
produção que ela deveria proteger.

Três são tabelas de negócio vivas e precisam de `REPLICA IDENTITY FULL`:

```sql
ALTER TABLE public."CONTRATOS" REPLICA IDENTITY FULL;
ALTER TABLE public."ESCALAS"   REPLICA IDENTITY FULL;
ALTER TABLE public."SETORES"   REPLICA IDENTITY FULL;
```

As outras oito são cópias de segurança antigas e **ficam fora da publicação**:
`APP_MENU_CONSOLIDACAO_BACKUP`, `EMPREGADOS_DUPLICADOS_BKP`,
`EMPREGADOS_REMOVIDOS_BKP`, `TRN_ALUNO_REMOVIDOS_BKP`,
`TRN_MATRICULA_REMOVIDOS_BKP`, `bkp_chamados_permissao_20260828`,
`bkp_screen_permission_20260909`, `fornecedor_backup_20260821`.

## O que afeta a produção, e o que não afeta

| Fase | Impacto no Supabase | Janela? |
|---|---|---|
| `pg_dump --schema-only` | leitura de catálogo, segundos | não |
| Restaurar e corrigir no cluster novo | **nenhum** | não |
| `CREATE PUBLICATION` | instantâneo, lock breve por tabela | não |
| **Cópia inicial (2,3 GB)** | **lê a base inteira** — CPU, disco e memória | **sim** |
| Replicação contínua | leve, só o delta | não |
| **Virada** | parada curta e controlada | **sim** |

A cópia inicial é a fase crítica: lê 2,3 GB de uma instância **Small, de 2 GB de
RAM, que já caiu três vezes por falta de recurso** (ver
`supabase_compute_nano_micro_queda`). Rodar em horário comercial é pedir para
engasgar.

O plano de aborto está em [`migracao-rollback.md`](migracao-rollback.md).

## Resultado: o schema já restaura idêntico

Executado em 08/10/2026 com a ordem acima. Conferência contra a produção,
consulta a consulta:

| | Supabase | Cluster novo | |
|---|---|---|---|
| Tabelas em `public` | 647 | 647 | ✅ |
| **Políticas de RLS** | **1.416** | **1.416** | ✅ |
| Funções em `public` | 1.449 | 1.449 | ✅ |
| Views | 30 | 30 | ✅ |
| Tipos | 786 | 786 | ✅ |
| Sequences | 126 | 126 | ✅ |
| Triggers | 493 | 493 | ✅ |
| Tabelas com RLS ligada | 643 | 643 | ✅ |
| Tabelas faltando | — | nenhuma | ✅ |

`has_screen_access`, `can_access` e `tem_acesso_menu` conferem assinatura por
assinatura com a produção — incluindo o terceiro argumento ser o enum
`app_acao`, não `text`.

Com a preparação no lugar, **a primeira passada do dump do `public` dá 1 erro**.
Sem ela, dá 2.436 e entra uma política de 1.416.

### Onde cada extensão mora — lido da produção, não suposto

| Extensão | Schema no Supabase |
|---|---|
| `btree_gist`, `pg_trgm`, `pg_net` | `public` |
| `pgcrypto`, `uuid-ossp`, `pg_stat_statements` | `extensions` |
| `pg_cron` | `pg_catalog` |
| `supabase_vault` | `vault` |

Isto importa: o schema do ERP chama essas funções **sem qualificar o schema**.
Instalar `pg_trgm` em `extensions` em vez de `public` já fez 31 funções
"sumirem" da conferência.

## O que ainda falta antes da cópia de dados

1. **`pg_cron`** — a produção tem 5 agendamentos (todos `enfileirar_tick`). No
   cluster novo exige o pacote `postgresql-17-cron` e entrada em
   `shared_preload_libraries`, que no Patroni se configura pelo DCS, não pelo
   `postgresql.conf` na mão.
2. **`pg_net`** — instalado na produção, mas o inventário de 06/10 não achou
   nenhum uso (`docs/ha-inventario.md`). Confirmar e, se for mesmo zero, não
   migrar.
3. **`supabase_vault`** — substituído por um arquivo equivalente em
   `preparar-destino.sql`, com o segredo em claro. Aceitável só porque o banco
   não é alcançável fora do túnel; trocar por um cofre de verdade antes da
   virada definitiva. Os 5 segredos migram à parte, nunca por dump.
4. **`REPLICA IDENTITY FULL`** nas três tabelas sem chave primária.
5. **A camada de API** (PostgREST + GoTrue). Enquanto ela não existir e for
   ensaiada, não há virada — ver `migracao-rollback.md`.
