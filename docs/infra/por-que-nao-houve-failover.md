# Por que o banco2 não assumiu em 03/11/2026

> Item 6 do pedido. Resposta curta: **o failover não disparou porque o banco
> não caiu.** Se tivesse disparado, a queda teria sido pior. Abaixo, a prova e o
> que de fato protege contra o que aconteceu.

## 1. O que o failover vigia

O Patroni troca de líder em **dois** casos, e só neles:

1. o **Postgres do líder para de responder** (processo morto, máquina
   desligada, disco cheio que derruba o Postgres);
2. o líder **perde contato com o etcd** por mais de `ttl` (20 s). O
   lock do líder expira e a réplica concorre.

Lentidão, CPU a 100 % e consulta estourando `statement_timeout` **não**
estão na lista. Isso é de propósito: o banco lento continua sendo o único com
os dados mais novos. Promover a réplica nessa hora abre a porta para a troca de
líder ficar indo e voltando (*flapping*), e cada troca custa **~48 s de erro**
para todos (medido em 16/10, `ha_trocar_lider`).

## 2. O que os logs mostram em 03/11

**O Patroni viu um líder saudável o tempo todo.** `journalctl -u patroni`, 11 a
12 linhas por minuto (`loop_wait: 5`) em todas as janelas de queda:

```
2026-11-03 14:00:55,082 INFO: no action. I am (banco1), the leader with the lock
2026-11-03 14:15:55,702 INFO: no action. I am (banco1), the leader with the lock
2026-11-03 17:28:55,814 INFO: no action. I am (banco1), the leader with the lock
2026-11-03 18:56:54,992 INFO: no action. I am (banco1), the leader with the lock
2026-11-03 19:05:54,980 INFO: no action. I am (banco1), the leader with the lock
```

- `patronictl history`: a última troca de líder foi em **16/10 16:14**
  (linha do tempo 7 → 8). Nenhuma em 03/11.
- `/patroni` no banco1: `postmaster_start_time: 2026-10-16 16:14:16`. O Postgres
  **não reiniciou**.
- Réplica: `banco2 | Sync Standby | streaming | lag 0` durante e depois.

**Quem falhou foi o PostgREST, na frente do banco** (post-mortem, C1 e C2):
pool de 10 conexões esgotado (`PGRST003`) e recarga de schema estourando o
tempo (`Failed to load the schema cache`). O HAProxy pergunta ao Patroni
`GET /primary`, e a resposta continuou 200 no banco1.

## 3. Se tivesse trocado, teria sido pior

| | banco1 (líder) | banco2 (réplica) |
|---|---|---|
| Plano | Vultr `vc2-2c-4gb`: **2 vCPU / 4 GB** | Linode `g6-standard-1`: **1 vCPU / 2 GB** |
| CPU durante as quedas (sar) | 94–99,5 % ocupada | **70 % ociosa** |

O banco2 estava folgado só porque **não recebia as consultas**: o PostgREST dele
também manda tudo para o primário, via HAProxy `:5000`. Promovido, ele receberia
a mesma carga com **metade dos núcleos e metade da memória**, depois de
48 s de troca.

## 4. O que protege contra o que aconteceu

| Proteção | Contra | Onde |
|---|---|---|
| Não chegar a carga amplificada: monitor sem recarga em massa, fim do polling, telas mais leves | a causa | itens 2, 4 e 5 |
| A recarga do schema não derrubar o pool (`authenticator` 60 s, HAProxy sem corte de 30 min) | o gatilho | item 2 |
| Pool do PostgREST 10 → 20 | o gargalo da manada | item 3 |
| **banco1 com 4 vCPU** | o teto de ~85 req/s | item 11 |
| **banco2 do mesmo tamanho do banco1** | failover cair num nó mais fraco | ver 5 |
| Painel com CPU, pool, 5xx e estado do Patroni, com alerta | ver chegando, não depois | item 8 |

## 5. Recomendações para o failover servir quando precisar

1. **Igualar o banco2 ao banco1.** Hoje, se o banco1 cair num horário de pico,
   o banco2 assume com metade da máquina e provavelmente cai junto. Linode
   `g6-standard-2` (2 vCPU / 4 GB) em São Paulo custa ~US$ 33,60/mês (+US$ 16,80
   do que hoje, já anotado como "adiado" no desenho de HA). Se o banco1 for a
   4 vCPU (item 11), o par certo é `g6-standard-4`.
2. **Não** criar failover por lentidão. Trocar de líder com o banco lento
   transfere a lentidão e soma 48 s de erro.
3. **Leitura no banco2** (o HAProxy já tem `:5001`, `postgres_leitura`) só
   depois de separar as RPCs de leitura das que gravam. Hoje há funções
   `SECURITY DEFINER` chamadas por GET que escrevem, e numa réplica somente
   leitura elas falham. É um projeto, não um ajuste.
