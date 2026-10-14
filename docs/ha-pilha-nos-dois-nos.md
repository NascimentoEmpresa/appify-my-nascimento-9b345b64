# A pilha nos dois nós, e os quatro defeitos que só apareceram aí

13/10/2026. A pilha do ERP (PostgREST, GoTrue, Storage, Edge Functions, Kong)
estava rodando só no `banco1`. Subir no `banco2` era "repetir o que já
funciona" — e foi aí que quatro coisas apareceram, três delas invisíveis com
um nó só.

## Estado atual

```
banco1  10.77.0.11  Vultr SP     2 vCPU / 4 GB   Postgres + Patroni + etcd + pilha
banco2  10.77.0.12  Linode SP    1 vCPU / 2 GB   Postgres + Patroni + etcd + pilha
arbitro 10.77.0.13  AWS Ohio     0,5 GB          só etcd
```

Os dois nós respondem a bateria de testes de forma **idêntica**:

| Chamada | `banco1` | `banco2` |
|---|---|---|
| sem chave | 401 | 401 |
| `/rest/v1` com anon | 200 (862 caminhos) | 200 (862 caminhos) |
| `/auth/v1/health` | 200 | 200 |
| `rpc/has_screen_access` | 200 → `false` | 200 → `false` |
| `/functions/v1/<função>` sem token | 401 | 401 |
| `/storage/v1/bucket` | 200 | 200 |

## 1. O HAProxy morreria no próximo reboot

`net.ipv4.ip_nonlocal_bind` estava em 0. O `haproxy.service` espera
`network-online.target`, mas um dos endereços que ele escuta — `172.28.0.1`, a
ponte da rede do compose — **só nasce quando o Docker levanta os containers**,
depois. Provado derrubando a pilha e reiniciando o serviço:

```
[ALERT] (2075165) : [...haproxy.main()] Some protocols failed to start their
listeners! Exiting.
Failed to start haproxy.service - HAProxy Load Balancer.
```

Em todo reboot, a máquina voltaria com a API morta e ninguém avisado. Com
`ip_nonlocal_bind=1` o HAProxy escuta no endereço antes dele existir e passa a
atender quando a ponte aparece — provado também: socket criado sem a ponte,
container alcançando `172.28.0.1:5000` depois que ela subiu.

Corrigido nos **dois** nós, em `/etc/sysctl.d/80-haproxy-bind.conf`.

## 2. O storage mentia no erro

Toda chamada ao storage voltava:

```json
{"statusCode":"403","error":"Unauthorized",
 "message":"new row violates row-level security policy"}
```

Um `GET /bucket` não insere linha nenhuma. A pista real estava no log do
container, não na resposta da API:

```
code: 42501   file: "guc.c"   routine: "call_string_check_hook"
query: SELECT set_config('role', $1, true), ...
```

`guc.c` é `set_config`. **Não é RLS.** O `storage-api` conecta como
`supabase_storage_admin` e troca de papel a cada requisição; sem ser membro de
`service_role`, isso falha com 42501 — e o `storage-api` traduz *todo* 42501
para aquela frase. Dias podem ser gastos caçando política que nunca foi o
problema.

Causa real: **atributo e participação de papel não vêm em dump de schema.**
`pg_dump` exporta objetos e GRANTs; `pg_authid` e `pg_auth_members` ficam de
fora. Comparando com a produção viva:

| | produção | cluster |
|---|---|---|
| `service_role` BYPASSRLS | **sim** | não |
| `supabase_storage_admin` → `authenticator` | **sim** | não |

Corrigido e registrado em `infra/ha/papeis-atributos.sql`, agora passo fixo do
restore.

## 3. O upload morria, e só o upload

Com o storage respondendo, listar e criar bucket passaram a funcionar — e o
upload continuou caindo:

```
42P10 there is no unique or exclusion constraint matching the
      ON CONFLICT specification
```

A imagem era `storage-api:v1.11.13`, que exige um índice único em
`(bucket_id, name)`. Esse índice não existe mais na produção — e o nome da
migration que o removeu não deixa dúvida:

```
73 revoke-grants-to-unused-operations
72 drop-bucketid-objname-index      <<<
71 objects-delete-marker-index
```

Os objetos da produção agora são versionados (`is_versioned`, `archived_at`,
`is_delete_marker`). **A versão da imagem é amarrada ao nível de migration do
banco, não é "pegar a mais nova":** `v1.78.0` a `v1.80.2` trazem exatamente as
73 migrations da produção e não aplicam nada; a `v1.81.0` traz a 74
(`unlock-object-versioning`) e mudaria o schema para além da produção.

Fixado em **v1.80.2**, e confirmado depois de subir: `max(id)` de
`storage.migrations` continua **73**.

O GoTrue passou pela mesma checagem: produção e cluster em **82 migrations**
(`20260831180000`), e o container diz `Migrations already up to date, nothing
to apply`.

## 4. Os anexos não atravessavam

Está em [`ha-anexos-entre-nos.md`](ha-anexos-entre-nos.md): o arquivo enviado
num nó respondia **500** no outro. Resolvido com espelho pelo túnel, nos dois
sentidos, com `xattr` preservado.

## O login, ponta a ponta

Nada disso prova que o ERP entra. Isto prova:

```
1) criar usuário pela API de admin ........ 200
2) login com senha ........................ 200, token de 613 caracteres
3) /auth/v1/user com o token .............. 200, devolve o id certo
4) has_screen_access com o usuário real ... false  (correto: sem permissão semeada)
5) apagar o usuário de teste .............. 200
```

E o elo que sustenta todo o modelo de acesso, dentro do banco:

```
auth.uid()   = 703c2801-8405-4345-a4bf-ad4726b7ce26
auth.role()  = authenticated
auth.email() = x@y.z
current_user = authenticated
```

## A conferência agora compara com a produção viva

A conferência antiga batia contagens contra números anotados em 08/10. Ela
envelheceu em quatro dias — e, pior, **não olhava índice nem papel**, as duas
portas por onde os defeitos acima entraram.

`infra/ha/conferir-contra-producao.sh` lê os dois lados agora e compara
conjuntos, não quantidades:

```
=========== CONTAGENS (produção x cluster) ===========
  funcoes em public           1487 = 1487    ok
  politicas de RLS            1432 = 1432    ok
  tabelas em public            656 = 656     ok
  tabelas que anon le          558 = 558     ok
  migrations de auth            82 = 82      ok
  migrations de storage         74 = 74      ok
  (+ 6 linhas, todas ok)

=========== INDICES ===========     identico (1874 itens)
=========== RESTRICOES ===========  identico (2514 itens)
=========== PAPEIS ===========      identico (28 itens)
  (+ 21 divergência(s) deliberada(s))

TUDO IGUAL. Pode seguir.
```

As 21 divergências deliberadas são papéis que nenhum serviço da pilha usa e que
nascem sem LOGIN de propósito. O script conhece a lista pelo nome — aviso que
sempre grita é aviso que ninguém lê.

## O schema tem prazo de validade

A própria conferência achou a deriva de quatro dias: entre 09/10 e 13/10 a
produção ganhou **2 funções** (`tvg_fonte`, `tvg_trecho_calculo`), **1 índice**
e mudou **1 CHECK** (`WA_MENSAGEM` passou a aceitar `pendente` e `cancelada`).

Aplicamos a deriva e o cluster voltou a ficar idêntico. Mas a lição é
operacional: **no dia da virada, rodar a conferência antes de começar.** Se
acusar diferença, refazer o restore — apagando os `.sql` antigos primeiro,
senão o script reusa o dump velho.

## O que ainda falta

```
✅ IPv6 nos dois bancos     13/10 — sem ele a replicação lógica era impossível
✅ anexos: script + carga   infra/ha/carregar-anexos.sh (5,6 GB, provado nos 2 nós)
✅ auth + storage           infra/ha/carregar-auth-storage.sh (159 logins no cluster)
✅ alerta do slot           migration 20261014000020 + worker/src/saudeBanco.js
⬜ replicação lógica        REPLICA IDENTITY FULL + publicação + assinatura
⬜ domínio + HTTPS          api.gprnascimento.com.br (adiado: sai da Render/Vercel)
⬜ troca de DNS pelo árbitro
✅ banco2 continua 1 vCPU / 2 GB — orçamento de infra fechado em 13/10/2026.
   A folga sai de dentro: parar a pilha dele durante a carga (378 MB) e capar o
   diário do sistema (170 MB). Ver ha-corte-roteiro.md, passo 0.2.
```

O passo a passo da virada, com ponto de desistência em cada etapa, está em
[`ha-corte-roteiro.md`](ha-corte-roteiro.md).
