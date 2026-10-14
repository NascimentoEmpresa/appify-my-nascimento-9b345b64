# O corte: roteiro da virada para o cluster próprio

Escrito em 13/10/2026, **antes de qualquer execução**. Nada aqui foi rodado
ainda. Até a última linha da Fase 2, o ERP continua servindo da Supabase.

Pré-requisito já cumprido: a pilha do ERP (PostgREST, GoTrue, Storage, Edge
Runtime, Kong) roda nos dois bancos contra o cluster Patroni, com schema
idêntico à produção viva, login real e anexo atravessando de um nó ao outro —
ver [`ha-pilha-nos-dois-nos.md`](ha-pilha-nos-dois-nos.md) e
[`../infra/ha/README.md`](../infra/ha/README.md).

## Os dois marcos, e por que separá-los

A virada tem duas metades que **não dependem uma da outra**, e juntá-las numa
noite só atrasa a parte que já dá para fazer:

**Marco A — o cluster acompanhando a produção em tempo real.** Replicação
lógica ligada, dados e anexos carregados, cluster segundos atrás da Supabase.
Não precisa de domínio, não precisa de janela de parada e **não precisa de
dinheiro**. O ERP continua inteiramente na Supabase; ninguém percebe nada.

Já vale por si: hoje, se a Supabase sumisse, o que existe é o backup da noite
anterior. Com o Marco A pronto, a perda possível cai de **horas para segundos**
— e o cluster vira um standby morno de verdade, promovível à mão.

**Marco B — virar o endereço.** É o que exige domínio com HTTPS, chave nova,
rebuild do frontend e uma janela curta. Fica para quando o
`grpnascimento.com.br` sair da Render/Vercel.

Fases 0 e 1 deste documento são o Marco A. A Fase 2 é o Marco B.

## O que exatamente vai se mover

| | Medido em |
|---|---|
| **2.346 MB** de banco, 656 tabelas em `public` | 13/10/2026 |
| **5.577 MB** de anexos, 11.192 objetos, 51 buckets | 13/10/2026 |
| 126 sequences, 1.432 políticas de RLS, 28 papéis | 13/10/2026 |

**E o que a replicação lógica NÃO cobre** — descoberto medindo, em 13/10/2026.
A publicação cobre o schema `public`. Fora dele ficam as duas coisas sem as
quais o ERP não abre:

| Schema | O que tem | Como atravessa |
|---|---|---|
| `public` | 656 tabelas | replicação lógica contínua (Fase 1) |
| `auth` | **159 logins**, 159 identities, 254 sessões | dump na janela (`carregar-auth-storage.sh`) |
| `storage` | **51 buckets, 11.252 anexos** (metadado) | dump na janela (`carregar-auth-storage.sh`) |
| arquivos | **5.586 MB** de bytes de anexo | `carregar-anexos.sh`, antes da janela |

Antes de 13/10 o cluster tinha `auth.users = 0` e `storage.objects = 2`. Quem
ligasse só a replicação lógica e virasse a chave descobriria isso na tela de
login.

Produção: PostgreSQL **17.6**, `wal_level=logical` (já ligado, não precisa
pedir nada à Supabase), host `aws-1-sa-east-1.pooler.supabase.com:5432`.
Cluster: PostgreSQL **17.11** — mesma versão maior, a armadilha de versão que
já nos mordeu não existe aqui. Nenhum slot de replicação em uso hoje (limite
10); a publicação `supabase_realtime` é do próprio Supabase e **não se mexe
nela**.

---

## O risco que manda em todo o roteiro

**Um slot de replicação que para de ser consumido enche o WAL da produção e
derruba a Supabase.** É assim que uma migração mata o sistema que ela deveria
proteger. Duas consequências práticas:

1. Enquanto existir slot nosso na produção, **alguém tem que estar olhando**.
   A consulta de vigilância está no passo 1.5 e roda a cada poucos minutos.
2. Em qualquer passo que der errado, a primeira coisa a fazer é **soltar o
   slot** — não investigar com o slot de pé.

E a causa número um de slot travado neste banco já é conhecida: **11 tabelas
sem chave primária.** A replicação lógica não replica `UPDATE`/`DELETE` nelas;
a assinatura trava com erro e para de consumir. Três são de negócio vivo e
levam `REPLICA IDENTITY FULL`; as outras oito são cópias de segurança antigas
e ficam **fora** da publicação (passo 1.1).

---

## Fase 0 — véspera, em horário comercial

Tudo aqui é leitura ou mexe só no nosso lado. Pode rodar de dia, e **deve**:
é onde as surpresas são baratas.

### 0.1 ✅ Viabilidade: medida em 13/10/2026

Era o teste que podia cancelar a noite inteira. Rodado, com resultado claro.

`CREATE SUBSCRIPTION` precisa de uma **conexão de replicação**, e o caminho
para ela é o host direto `db.<ref>.supabase.co`, que **só resolve em IPv6**:

```
db.fwmzeaztjxrxxzxzxmgc.supabase.co -> 2600:1f1e:75b:4b16:63c6:7767:6051:28f8
```

O que foi medido:

| De onde | IPv6 global | Alcança a 5432 direta | Protocolo de replicação |
|---|---|---|---|
| `banco2` (Linode) | **sim** | **sim** | **aceito** |
| `arbitro` (Lightsail) | **sim** | **sim** | não testado |
| `banco1` (Vultr) | **NÃO** | não (`Network is unreachable`) | impossível |

A prova de que a replicação lógica funciona, vinda do `banco2`:

```
$ psql "host=db...supabase.co ... replication=database" -c "IDENTIFY_SYSTEM"
7623125441096521075 | 1 | E4/4200DF38 | postgres
```

E a prova de que **não existe plano B por IPv4**: o pooler não fala o
protocolo de replicação — ele tenta interpretar o comando como SQL.

```
$ psql "host=aws-1-sa-east-1.pooler.supabase.com ... replication=database" -c "IDENTIFY_SYSTEM"
ERROR:  syntax error at or near "IDENTIFY_SYSTEM"
```

(O add-on de IPv4 da Supabase resolveria e **custa dinheiro** — fora de
questão: o orçamento está fechado.)

### 0.1b Habilitar IPv6 no `banco1` — e por que isso não é detalhe

A assinatura roda **no nó que for primário naquele momento**. Se o `banco1` for
primário sem ter IPv6, a replicação para — e slot que para de ser consumido é
exatamente o cenário que enche o WAL e derruba a Supabase (ver o aviso no topo).
Então **os dois** bancos precisam alcançar a Supabase por IPv6, não só um.

No painel da **Vultr**: *Settings → IPv6 → atribuir rede IPv6*. Nos planos
atuais é gratuito; a tela confirma antes de aplicar. Depois, conferir na
máquina:

```bash
ssh -p 443 root@216.238.120.171 'ip -6 addr show scope global | grep inet6'
```

Se a Vultr pedir reinício, melhor de dia: reiniciar o `banco1` troca o líder, e
é um ensaio de troca de primário com a casa vazia.

**Se por algum motivo a Vultr não der IPv6**, existe caminho provado hoje: o
`arbitro` tem IPv6 e alcança a Supabase. Um `socat` nele, escutando na ponta do
túnel, faz o repasse:

```bash
# no arbitro (10.77.0.13) — fallback, não primeira escolha
socat TCP4-LISTEN:5432,bind=10.77.0.13,fork,reuseaddr \
      TCP6:db.fwmzeaztjxrxxzxzxmgc.supabase.co:5432
```

A assinatura então aponta para `host=10.77.0.13`. Funciona com
`sslmode=require` (não há verificação de nome), mas paga São Paulo → Ohio → São
Paulo em cada ida e volta, e põe uma máquina de 0,5 GB no caminho da
replicação. É contingência, não desenho.

### 0.2 Folga no `banco2` sem gastar nada

O `banco2` é 1 vCPU / 2 GB e as três máquinas já estão pagas — **o orçamento de
infraestrutura está fechado, não há máquina maior nesta conta**. Então a folga
sai de dentro. Medido nele em 13/10/2026:

```
Mem: 1.967 MB total | 1.086 MB disponíveis | 1.216 MB em buff/cache
Swap: 2.543 MB (swapfile 2 GB + partição 496 MB), 7 MB em uso
Disco: 36 GB livres
Containers da pilha: 378 MB somados (storage 107, kong 107, functions 89, rest 48, auth 27)
journald: 170 MB de diário acumulado, sem limite configurado
```

Três folgas de graça, nesta ordem:

1. **Parar a pilha do `banco2` durante a carga.** Ela não serve ninguém ainda —
   o ERP está na Supabase. Libera os 378 MB e volta em segundos:
   `docker compose -f /root/erp-pilha/docker-compose.yml stop` (e `start` depois).
2. **Capar o diário do sistema** nos dois nós: `SystemMaxUse=100M` em
   `/etc/systemd/journald.conf` + `systemctl restart systemd-journald`. Devolve
   ~70 MB e evita o diário crescer sozinho.
3. **O swap já existe** (2,5 GB, praticamente intocado). Ele é a rede embaixo,
   não o plano.

**Por que isso basta:** no modo síncrono o primário espera a standby **gravar**
o WAL, não aplicá-lo (`synchronous_commit = on` é flush remoto). A standby,
durante a carga, escreve WAL em disco — barato — e aplica no seu ritmo. Atraso
de aplicação não trava a escrita no `banco1`.

**E se não bastar:** o `shared_buffers` é **1 GB**, herdado do `banco1` (que tem
4 GB). Numa máquina de 2 GB isso é metade da RAM. Dá para baixar só no `banco2`,
mas é mudança que pede reinício e deixa os nós com configuração diferente — só
se a medição mostrar swap sendo usado de verdade durante a carga. Não mexer
preventivamente.

Durante a carga, acompanhar em outra janela:

```bash
ssh -p 443 root@172.237.48.8 'free -m; patronictl -c /etc/patroni/patroni.yml list'
```

Sinal de alerta: `Swap used` subindo de forma contínua, ou o `banco2` saindo de
`sync_standby`. Nesse caso o Patroni tira a standby do síncrono sozinho e o
`banco1` segue aceitando escrita — degrada, não para.

### 0.3 Conferir o schema contra a produção **do dia**

O schema restaurado tem prazo de validade: entre 09/10 e 13/10 a produção
ganhou 2 funções, 1 índice e mudou 1 CHECK. Rodar **na véspera**, não antes:

```bash
SENHA_SUPABASE=... SENHA_DESTINO=... ./infra/ha/conferir-contra-producao.sh
```

Se acusar diferença, aplicar a deriva. Se for muita coisa, refazer o restore —
**apagando os `.sql` antigos primeiro**, senão o `restaurar-schema.sh` reusa o
dump velho.

### 0.4 Rede de segurança

- Backup cifrado do dia **concluído e conferido**, e a chave GPG privada na mão
  (ela é a única cópia; sem ela, todos os backups morrem juntos).
- `patronictl list` nos dois nós: líder definido, lag 0.
- As quatro portas da API respondendo 200 nos **dois** nós.
- Timer do espelho de anexos ativo nos dois: `systemctl list-timers | grep anexo`.

### 0.5 ✅ Cópia dos anexos — `infra/ha/carregar-anexos.sh`

5,6 GB em 11.251 objetos não cabem na janela da noite. A cópia é
**idempotente e repetível**: roda de dia, e na janela só o delta.

```bash
# no banco1, com os segredos num arquivo 0600 (e NAO na linha de comando:
# `pgrep -af` mostra argumento de processo para quem for root na maquina)
cat > /root/.carga-anexos.env <<'X'
SENHA_SUPABASE=...
SUPABASE_URL=https://fwmzeaztjxrxxzxzxmgc.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
X
chmod 600 /root/.carga-anexos.env
set -a; . /root/.carga-anexos.env; set +a
bash carregar-anexos.sh --limite 3            # ensaio nos 3 maiores
bash carregar-anexos.sh --paralelo 6          # a carga
bash carregar-anexos.sh --conferir            # disco x producao, sem baixar
```

**A decisão que manda no script:** o arquivo é gravado **direto no volume, no
caminho da versão da produção** — não enviado pela API do cluster. O storage
guarda cada objeto em
`<volume>/stub/stub/<bucket>/<nome>/<version>`, e enviar pela API geraria uma
`version` nova; o dump de `storage.objects` (passo 2.3) apontaria então para
caminhos inexistentes, e o sintoma seria o conhecido: a linha aparece na tela e
o download estoura com **500, não 404**.

Dois pontos que já custaram tempo neste projeto e estão resolvidos dentro dele:

- **`curl`, nunca `fetch` do Node.** Em download longo o `fetch` estoura com
  `assert(!this.paused)` **fora** do try/catch e mata o processo. E nunca
  `--retry-all-errors`, que faz o curl repetir 403/404 como se fosse falha de
  rede.
- **O `content-type` não está no banco**: mora em `xattr` no arquivo
  (`user.supabase.content-type`). Sem ele o download morre com `ENODATA`, num
  erro que não fala de arquivo nenhum. O script grava os dois xattrs a partir
  do metadata da produção.

**Provado em 13/10/2026**, ensaio nos 3 maiores objetos (400 MB em 11 s) e
depois a corrente inteira, com o metadado já carregado:

| Teste | Resultado |
|---|---|
| anexo de 243 MB pelo Kong do `banco1` | `206`, `Content-Type: video/quicktime`, `content-range: bytes 0-0/254812394` |
| o mesmo anexo pelo Kong do `banco2` | `206`, mesmo content-type (o espelho de 1 min levou sozinho) |
| anexo **com metadado e sem os bytes** | `500` — o modo de falha que esta carga existe para evitar |

### 0.6 Decidir antes, não na hora

| Decisão | Recomendação |
|---|---|
| `synchronous_mode_strict` | **deixar desligado no corte.** Ligado, o banco recusa escrita se a standby cair — é mais seguro contra perda e mais frágil contra indisponibilidade. Não se estreia isso na noite da virada. |
| `api.grpnascimento.com.br` | **adiado de propósito.** O domínio é do registro.br e está hoje apontado para Render e Vercel; tirá-lo de lá é assunto separado, para depois da infraestrutura pronta. Isso **não atrasa o Marco A** — só o B. O certificado em si é grátis (Let's Encrypt no Kong). |
| Rebuild do frontend | publicado pelo **Lovable, espelhando a branch `main`**. O endereço da API é compilado dentro do JavaScript (`VITE_SUPABASE_URL`), então a virada é um PR na `main` mexendo no `.env` — e o Lovable reconstrói. DNS sozinho não resolve. |

---

## Fase 1 — ligar a replicação ✅ executada em 13/10/2026

Primeira escrita na Supabase de produção em todo o projeto. Tudo aqui é
desfazível, e **nada aqui para o ERP** — o sistema segue atendendo normalmente
enquanto os 2,3 GB atravessam. Só pede horário de menos movimento por causa do
peso do passo 1.3 na instância Small.

**Resultado real** (`bash infra/ha/disparar-fase1.sh`, 23:47 UTC):

```
23:47:05  CONTRATOS, ESCALAS, SETORES -> FULL (tentativa 1, lock_timeout 3s)
23:47:06  publicacao criada: 642 tabelas
23:47:07  assinatura criada; slot "erp_corte" criado no publisher
23:47:37  prontas 179/642 |   469.707 linhas | atraso 56 bytes
23:48:08  prontas 354/642 |   998.731 linhas | atraso  0 bytes
00:05:xx  prontas 642/642 | 1.545.419 linhas | atraso  0 bytes
```

Contagem conferida nos dois lados depois: `mz_32_fato_razao_contabil` 215.210,
`EMPREGADOS` 13.395, `CHAMADO_SISTEMA` 632 — **iguais**. Zero consultas presas
em lock na produção durante toda a carga.

**Duas armadilhas pararam 5 tabelas em "copiando dados"**, e o sintoma era
enganoso: `637 de 642` parado, sem nenhum trabalhador vivo para olhar. Os dois
erros só aparecem no **log do Postgres do nó líder**
(`journalctl -u patroni | grep -i "logical replication"`):

1. **Coluna faltando no cluster** — `WA_TEMPLATE`, `WA_CURRICULOS` e
   `malote_config` tinham ganhado colunas na produção no mesmo dia:
   `ERROR: logical replication target relation "public.WA_TEMPLATE" is missing
   replicated columns: "botoes", "template_nome_anterior"`.
   A conferência dizia "TUDO IGUAL" porque **não comparava coluna**. Corrigido:
   `conferir-contra-producao.sh` agora compara 10.481 colunas, views incluídas.
2. **CHECK `NOT VALID` com linha antiga perdoada** —
   `CHAMADO_SISTEMA_AVALIACAO` e `SIS_CHECKLIST`:
   `ERROR: new row for relation ... violates check constraint ...`.
   A restrição é **idêntica** nos dois lados; o que difere é a história.
   `NOT VALID` perdoa só as linhas que já existiam, e na replicação essas mesmas
   linhas chegam como inserção nova. Saída: soltar a restrição no cluster,
   deixar sincronizar, recriar com `NOT VALID` — o estado final fica igual ao da
   produção. Está documentado no rodapé da conferência, com a lista das 6
   `NOT VALID` deste banco.

Depois das duas correções, as 5 tabelas fecharam sozinhas — os trabalhadores de
sincronização repetem a cada 5 segundos.

### 1.1 As três tabelas sem chave primária — e o `lock_timeout`

```sql
-- na PRODUÇÃO, uma transação por tabela, SEMPRE com lock_timeout.
SET lock_timeout = '3s';
ALTER TABLE public."CONTRATOS" REPLICA IDENTITY FULL;
```

**"Instantâneo porque a tabela é pequena" é falso, e custou uma lição em
13/10/2026, 23:12 UTC.** Os três `ALTER` rodaram sem `lock_timeout` e ficaram
**63 segundos** esperando. O tamanho da tabela não importa: `ALTER TABLE` pede
`ACCESS EXCLUSIVE`, e **enquanto espera, ele entra na fila** — todo pedido
posterior de leitura da mesma tabela espera atrás dele. Duas consultas do ERP,
pelo PostgREST, ficaram presas **43s e 19s**. Usuário real esperando tela, numa
operação que o roteiro descrevia como inofensiva.

Quem segurava o lock não era nosso script: uma sessão `idle in transaction` com
5 minutos de vida, entrando pelo pooler como `postgres`, de um endereço IPv6 da
AWS, fazendo introspecção de dump — a plataforma Supabase. **Isso vai acontecer
de novo**: não se controla quando a plataforma abre uma transação longa.

O que ficou no `ligar-replicacao.sh`:

- `lock_timeout = '3s'` — o pior caso vira 3 segundos de fila, não 63;
- cada `ALTER` em sua própria transação, para o lock de um não segurar o outro;
- 10 tentativas com 20s de espera, e na primeira falha ele **diz quem está
  segurando o lock**;
- tabela que já está `FULL` é pulada, então repetir é seguro.

**Regra que vale para qualquer DDL deste banco, não só esta:** em tabela viva,
sempre com `lock_timeout`. Sem ele, o seu comando que espera vira o comando que
derruba a tela dos outros.

Como ver a fila, do outro lado, enquanto um DDL roda:

```sql
select pid, state, wait_event_type||'/'||coalesce(wait_event,'-') as espera,
       round(extract(epoch from now()-query_start))||'s' as ha,
       left(regexp_replace(query,'\s+',' ','g'), 60) as consulta
  from pg_stat_activity
 where datname = current_database() and pid <> pg_backend_pid()
   and (state <> 'idle' or wait_event_type = 'Lock')
 order by query_start;
```

Volta atrás: `REPLICA IDENTITY DEFAULT` nas três.

### 1.2 A publicação, sem as oito de backup

**Não** usar `FOR ALL TABLES`: isso arrastaria as oito tabelas de backup sem
chave primária e travaria a assinatura. Gerar a lista pelo catálogo:

```sql
-- na PRODUÇÃO: monta o comando e MOSTRA. Ler antes de executar.
select 'CREATE PUBLICATION erp_corte FOR TABLE ' ||
       string_agg(format('%I.%I','public',tablename), ', ' order by tablename) || ';'
from pg_tables t
where schemaname = 'public'
  and tablename not in ('APP_MENU_CONSOLIDACAO_BACKUP','EMPREGADOS_DUPLICADOS_BKP',
      'EMPREGADOS_REMOVIDOS_BKP','TRN_ALUNO_REMOVIDOS_BKP','TRN_MATRICULA_REMOVIDOS_BKP',
      'bkp_chamados_permissao_20260828','bkp_screen_permission_20260909',
      'fornecedor_backup_20260821');
```

Conferir que o número de tabelas da publicação é o total menos 8, e que as três
do passo 1.1 estão dentro.

Volta atrás: `DROP PUBLICATION erp_corte;`

### 1.3 A assinatura no cluster

No **líder** do cluster (pelo HAProxy em `127.0.0.1:5000`, que sempre aponta
para o primário):

```sql
CREATE SUBSCRIPTION erp_corte
  CONNECTION 'host=db.fwmzeaztjxrxxzxzxmgc.supabase.co port=5432 user=postgres
              dbname=postgres sslmode=require password=...'
  PUBLICATION erp_corte
  WITH (copy_data = true, streaming = on);
```

Duas coisas que valem saber e que **não** precisam de providência:

- **Os gatilhos não disparam.** O processo que aplica a replicação roda em
  `session_replication_role = replica`, então só gatilho criado com `ENABLE
  ALWAYS` dispara. Não é a armadilha do ETL do sistema antigo, onde a carga por
  `INSERT` normal acionava tudo.
- **A RLS não barra**, porque quem aplica é superusuário.

E uma que **precisa** de atenção: `copy_data = true` copia os 2,3 GB numa
transação longa na produção. Em banco Small isso aparece como uso de CPU e
`temp_files`, não como travamento — mas é o momento mais pesado da noite.

### 1.4 O que a replicação lógica NÃO traz

**Sequences.** Nenhuma das 126. Se virarmos a chave sem elas, o primeiro
`INSERT` de cada tabela colide com id já usado. O `setval` fica na Fase 2,
depois do congelamento — fazer antes é inútil, porque a produção continua
andando.

### 1.5 Vigiar até o lag zerar

Na **produção**, a cada poucos minutos (é a consulta que protege contra o
cenário "WAL enche e a Supabase cai"):

```sql
select slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) as atraso
from pg_replication_slots;
```

- `active = f` por mais de um minuto, ou `atraso` **crescendo sem parar** →
  a assinatura travou. Olhar o log do cluster e, se não for óbvio em 5 minutos,
  **desistir**: `DROP SUBSCRIPTION` no cluster, `DROP PUBLICATION` na produção,
  conferir que o slot sumiu. A produção fica exatamente como estava.
- `atraso` perto de zero e estável → o Marco A está de pé.

### 1.6 ✅ O alerta do slot — escrito e provado; falta aplicar na produção

A partir do Marco A a assinatura fica **de pé por dias ou semanas**, esperando
o Marco B. Slot vigiado só por mim olhando `psql` não é vigilância: é o mesmo
erro de 23/09/2026, quando o banco ficou 20 minutos inalcançável e a equipe
soube por um usuário ligando — o painel mostrava tudo, mas painel só avisa quem
está olhando.

Já existe o lugar certo: `worker/src/saudeBanco.js`, que avisa no Discord
quando um indicador passa do limite — e por DM, que é o que a infraestrutura
pede (o canal tem outras pessoas).

O que foi escrito em 13/10/2026:

1. **`supabase/migrations/20261014000020_ha_slot_replicacao_estado.sql`** — RPC
   `SECURITY DEFINER` devolvendo o atraso de cada slot em bytes.
   `pg_replication_slots` é view sobre função de sistema e o PostgREST não a
   expõe, então a leitura precisa do RPC. Só `service_role` executa.
2. **o indicador no `saudeBanco.js`**, com limite de **1 GB** de atraso ou slot
   inativo por mais de **5 minutos**. 1 GB é folgado de propósito: a produção
   gera ~400 MB de WAL por hora em dia útil, então é mais de duas horas de
   margem, e alto o bastante para a carga inicial não dar alarme falso.

Provado antes de entrar em produção:

| Teste | Resultado |
|---|---|
| migration aplicada no **cluster** (mesmo schema) | `CREATE FUNCTION` … `NOTIFY`, sem erro |
| RPC pelo psql | devolveu o slot físico real do cluster: `banco1 \| physical \| ativo \| 0 bytes` |
| RPC pelo PostgREST com `service_role` | `200` com o JSON |
| RPC pelo PostgREST com `anon` | **`401 permission denied for function`** |
| o código do worker contra o RPC real | linha `SLOT [░░░] 0% banco1: 0 bytes atrasado, ativo` |
| slot com 1,5 GB de atraso (servidor falso) | **alerta disparado** |
| slot voltando a 8 MB | **aviso de normalizou disparado** |
| migration ainda não aplicada (404) | linha informativa, **sem alerta** — fora do corte não há slot |

**Aplicada na produção em 13/10/2026**, por `psql` em transação única
(`CREATE FUNCTION`, `REVOKE`, `REVOKE`, `GRANT`, `COMMENT`, `NOTIFY`, saída 0).
Conferido na produção depois de aplicar:

| | |
|---|---|
| `select * from ha_slot_replicacao_estado()` | responde: **0 slots** (certo — a replicação ainda não foi ligada) |
| PostgREST com `service_role` | `200` com `[]` |
| PostgREST com a chave `anon` do ERP | **`401 permission denied for function`** |
| o worker contra a produção | `SLOT nenhum slot na producao (normal fora do corte)`, sem alerta |

**Sem o alerta de pé, a assinatura não fica ligada da noite para o dia.** O
risco não é perder a replicação; é encher o WAL da Supabase sem ninguém ver.

---

### 1.7 ⚠️ O que aconteceu em 14/10/2026 — a deriva de coluna para a replicação

O aviso acima não era teórico. **No dia seguinte a ligar a replicação, ela
parou, e ninguém viu por 1h50.**

Às 10h40 (13:40 UTC) uma migration aplicada na produção acrescentou quatro
colunas em `TVG_INDICADOR`. A partir daí, o processo de aplicação do cluster
passou a morrer e renascer a cada 5 segundos:

```
ERROR: logical replication target relation "public.TVG_INDICADOR" is missing
       replicated columns: "espelho_fonte", "espelho_item",
                           "espelho_grafico", "espelho_destaque"
```

884 tentativas. O slot parou de ser consumido e **840 MB de WAL ficaram
presos na produção**, crescendo a ~11 MB/min — cerca de 16 GB por dia se
ninguém tocasse. Nada disso apareceu em lugar nenhum: o worker de alertas
estava desligado, então o vigia do slot da seção 1.6 não estava de pé.

Levantamento completo no momento do conserto: **11 colunas** faltando em 6
tabelas (`HORA_EXTRA_SOLICITACAO`, `TREINAMENTOS`, `TVG_INDICADOR`,
`TVG_PAINEL`, `malote_config`) e 4 tabelas inteiras novas
(`TREINAMENTO_ALERTA`, `TREINAMENTO_GABARITO`, `TREINAMENTO_PROVA_ESTADO`,
`TREINAMENTO_TENTATIVA`). Tabela inteira ausente **não** quebra a replicação
— ela não está na publicação —, mas precisa existir antes do Marco B.

**A segunda armadilha, que custou mais tempo que a primeira:** corrigir as
colunas não religou nada. O processo ficou pendurado numa conexão morta
(`SSL error: unexpected eof while reading`) com `received_lsn` nulo por 30
minutos, e **`ALTER SUBSCRIPTION ... DISABLE` seguido de `ENABLE` não o
derrubou** — o PID continuou idêntico. Só `pg_terminate_backend` resolveu.
Depois disso o atraso saiu de 840 MB para 0 bytes em segundos.

#### A trava: `infra/ha/sincronizar-colunas.sh`

```bash
# no banco1, que alcança a produção e o cluster
SENHA_SUPABASE=... bash /root/sincronizar-colunas.sh --conferir   # só olha
SENHA_SUPABASE=... bash /root/sincronizar-colunas.sh --aplicar    # corrige
```

O `--conferir` não escreve nada e sai com código 1 quando acha divergência,
para servir de alerta em rotina. O `--aplicar` recria as colunas com o tipo,
o `NOT NULL` e o `DEFAULT` da produção, e **termina reiniciando o worker à
força**, pela armadilha acima.

Duas armadilhas que o próprio script documenta, descobertas ao escrevê-lo:

- **Comparar a linha inteira (tipo + default) dá falso positivo.** O mesmo
  default aparece como `gen_random_bytes` na produção e
  `extensions.gen_random_bytes` no cluster, porque o `search_path` do restore
  qualificou a função. O que para a replicação é a coluna **não existir**.
- **`DEFAULT` não pode entrar na tabela de comparação.** Existe coluna cujo
  default é um texto com quebra de linha e `|` dentro ("Precisamos entrar em
  contato com você..."), e isso destrói qualquer formato de uma-linha-por-coluna.
  A comparação usa só `tabela|coluna|tipo|notnull`; o default é buscado
  individualmente, só para as poucas colunas que faltam.

#### O que isso significa para o roteiro

Enquanto a replicação estiver ligada e a equipe continuar aplicando migrations
na produção, **toda coluna nova é uma parada em potencial**. Duas defesas, e
elas se somam:

1. **Ligar o worker**, para o alerta do slot da seção 1.6 existir de verdade.
   Hoje essa é a única coisa que teria avisado.
2. **Rodar `sincronizar-colunas.sh --conferir` de rotina** (ou depois de cada
   migration aplicada na produção) e `--aplicar` quando acusar.

Enquanto nenhuma das duas estiver no lugar, o estado do slot precisa ser
olhado à mão todo dia — não é opcional.

---

## Fase 2 — a virada

Daqui até o fim, o ERP fica fora do ar para escrita. Alvo: **minutos**, não
horas — a cópia pesada já aconteceu na Fase 1.

### 2.1 Congelar a escrita na Supabase

Não é tela de manutenção: é no banco, e funciona com o PostgREST (o
`default_transaction_read_only` **não** funciona, já medido):

```sql
-- na PRODUÇÃO
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';
```

O ERP passa a abrir e consultar, e a recusar salvar. **Não tocar nas funções de
RLS** — o que trava é o GRANT, nunca a política.

Volta atrás (é o `GRANT` que o Supabase usa por padrão):
`GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;`

### 2.2 Lag em zero e parar a assinatura

Esperar `atraso` = 0 com a escrita já congelada (agora ele zera de verdade e
fica), e então:

```sql
-- no CLUSTER
ALTER SUBSCRIPTION erp_corte DISABLE;
```

### 2.3 Os 159 logins e os 11 mil metadados de anexo

`infra/ha/carregar-auth-storage.sh` — o que a replicação lógica não cobre.

```bash
SENHA_SUPABASE=... SENHA_DESTINO=... bash carregar-auth-storage.sh
SENHA_SUPABASE=... SENHA_DESTINO=... bash carregar-auth-storage.sh --conferir
```

**As duas armadilhas, as duas descobertas na prática em 13/10/2026** — e as
duas resolvidas dentro do script:

1. `COPY storage.objects FROM STDIN` **falha sempre**, com `extra data after
   last expected column`. Causa: `path_tokens` é coluna **gerada**
   (`GENERATED ALWAYS`) nos dois lados, então `copy (select * …) to stdout`
   manda 15 campos e o destino aceita 14. Vale também para
   `auth.users.confirmed_at` e `auth.identities.email`. A saída é `pg_dump`,
   que escreve a lista explícita de colunas e deixa as geradas de fora — o
   script confere isso e aborta se o dump sair errado.
2. Os gatilhos `protect_objects_delete`, `protect_buckets_delete` e
   `protect_bucket_control_insert` **recusam escrita direta**:

   ```
   ERROR:  Direct deletion from storage tables is not allowed.
   HINT:   Use the Storage API instead.
   ```

   Eles vieram no restore do schema, da produção. A saída é
   `session_replication_role = replica` na sessão da carga — o mesmo recurso
   que a replicação lógica usa, e que já tinha sido necessário no ETL do
   sistema antigo. De quebra, ele desliga a checagem de chave estrangeira, o
   que torna a ordem das tabelas irrelevante.

**Provado em 13/10/2026** (dump de 31 MB, carga em 9 segundos):

```
  tabela                             producao    cluster
  auth.users                              159        159  ok
  auth.identities                         159        159  ok
  auth.sessions                           254        254  ok
  auth.mfa_amr_claims                     254        254  ok
  storage.buckets                          51         51  ok
  storage.objects                       11252      11252  ok
  auth.refresh_tokens                  124001     123999  DIFERE
```

A diferença de 2 em `refresh_tokens` **é a produção viva**: duas pessoas
renovaram sessão entre o dump e a conferência. Na janela, com a escrita já
congelada (passo 2.1), tudo bate — e é por isso que a conferência vale como
critério só depois do congelamento.

Uma consequência que vale saber: como os `refresh_tokens` atravessam, quem
estiver logado **não** perde a sessão por causa do banco. Perde por causa da
troca de endereço (passo 2.6), que muda a chave onde o navegador guarda a
sessão. O efeito prático é o mesmo — todos entram de novo — mas a causa é
outra, e é a que não tem como evitar sem mexer no frontend.

### 2.4 As sequences

```sql
-- gerado a partir da PRODUÇÃO, aplicado no CLUSTER
select format('select setval(%L, %s, true);', schemaname||'.'||sequencename, last_value)
from pg_sequences where schemaname = 'public' and last_value is not null;
```

Conferir: nenhuma sequence do cluster abaixo do `max(id)` da sua tabela.

### 2.5 Delta final dos anexos

Rodar a carga do passo 0.5 de novo — só o que entrou desde a cópia de dia — e
depois forçar o espelho entre os nós:

```bash
ssh -p 443 root@216.238.120.171 'bash /root/espelhar-anexos.sh'
ssh -p 443 root@172.237.48.8    'bash /root/espelhar-anexos.sh'
```

Conferir que `select count(*) from storage.objects` bate com a produção.

### 2.6 Virar o endereço

1. `api.grpnascimento.com.br` apontando para o `banco1`, com HTTPS válido.
2. PR na `main` trocando no `.env` o endereço e a **chave anônima** — ela é um
   JWT assinado com o segredo do cluster; a chave antiga não serve. (As duas
   são públicas por natureza: tudo que começa com `VITE_` vai compilado para o
   navegador.)
3. O Lovable reconstrói a partir da `main`. **Volta atrás = reverter o commit.**
4. O `worker/` aponta para o endereço novo, com a `service_role` nova.

⚠️ **A armadilha do Lovable, aqui, é séria.** Ele pode regenerar
`src/integrations/supabase/client.ts` com as credenciais da Supabase escritas no
literal. Se isso acontecer depois da virada, o ERP **volta a falar com a
Supabase sozinho** — e nada na tela avisa. Hoje o arquivo importa de `./env.ts`
(linha 7) e é isso que tem que continuar valendo. Conferir **depois** do build
do Lovable, não antes.

**Todo mundo vai ter que fazer login outra vez.** As sessões atuais estão
assinadas com o segredo da Supabase e o GoTrue do cluster vai recusá-las. Isso
não é defeito; é consequência de trocar o emissor dos tokens. Avisar antes.

### 2.7 Aceitação **pelo navegador**, não por `curl`

`curl` não prova nada aqui: ele não faz preflight de CORS. Já foram quatro
falhas de CORS neste projeto com o `curl` dizendo que estava tudo bem, e botão
aparecendo na tela sem funcionar. Abrir o ERP de verdade e, nesta ordem:

1. login com usuário real;
2. uma lista grande (`/app/suprimentos/pedidos-materiais` — é a que já estourou
   por timeout de RLS, serve de termômetro);
3. **abrir um anexo antigo** (prova a Fase 0.5) e **enviar um novo**;
4. uma tela gateada por permissão, com usuário que **não** tem acesso — tem que
   continuar negando;
5. uma Edge Function;
6. salvar algo (prova que a escrita saiu do congelamento no lugar certo).

### 2.8 Ponto sem volta

A volta atrás é barata até o item 2.6. **Depois do primeiro salvamento de um
usuário no cluster**, voltar para a Supabase significa perder o que entrou ou
montar replicação no sentido inverso. É o momento de decidir com calma, não às
2h da manhã: se qualquer item do 2.7 falhar, a saída é **desfazer o 2.5 e o
2.1** (frontend volta ao endereço antigo, GRANT de escrita volta) e o pior
custo é o tempo que o sistema ficou lento à noite.

---

## Depois do corte, nos dias seguintes

- Backup cifrado passa a sair do cluster, não da Supabase. Até isso estar
  provado, **não cancelar nada**.
- Container de failover na Render e projeto Supabase só saem do ar depois de
  alguns dias de operação normal. É o corte dos R$ 287/mês — ele espera.
  **Vale dizer com clareza:** as três máquinas já estão pagas, e concluir o
  corte é o que faz a conta de infraestrutura **cair** — saem R$ 287/mês de
  Supabase e Render, ficam os R$ 244/mês do cluster. Até o corte, o projeto
  paga os dois lados; é o período mais caro, e ele encurta terminando, não
  pausando.
- `synchronous_mode_strict`: decidir com a casa já rodando.

## O que falta, em ordem

**Marco A — sem custo novo, sem parada, sem domínio:**

```
✅ 0.1  viabilidade: IPv6 + protocolo de replicação   13/10 — aceito nos dois nós
✅ 0.1b IPv6 no banco1 (painel da Vultr)              13/10 — IDENTIFY_SYSTEM ok
✅ 0.5  carregar-anexos.sh escrito e provado          13/10 — 206 nos dois nós
✅ 2.3  carregar-auth-storage.sh escrito e provado    13/10 — 159 logins no cluster
✅ 1.6  RPC do slot + alerta no worker                13/10 — provado no cluster
✅ 0.5  a carga dos 5,6 GB de anexos                  13/10 — 11.251/11.251, 0 falhas
✅ 1.6b migration 20261014000020 na produção          13/10 — anon recebe 401
✅ 0.2  folga no banco2 (parar pilha, capar diário)   13/10 — pilha religada depois
✅ 0.3  conferência do schema contra a produção       13/10 — e agora compara coluna
✅ 1.1  REPLICA IDENTITY FULL nas três tabelas        13/10 — tentativa 1, sem fila
✅ 1.2  publicação com 642 tabelas                    13/10 — lista do catálogo
✅ 1.3  assinatura no cluster, copy_data=true         13/10 — 1.545.419 linhas
✅ 1.5  lag em zero e estável                         13/10 — 0 bytes, slot ativo
```

**O Marco A está fechado.** A perda possível deixou de ser "o backup da noite
anterior" e passou a ser **segundos**. O que falta é só o Marco B, que espera o
domínio.

Nada nessa lista para o ERP. A única coisa que pede horário de menos
movimento é o passo 1.3, pelo peso na Supabase — e mesmo ele não derruba nada,
só pesa.

**Marco B — espera decisão, não dinheiro:**

```
⬜ domínio: tirar grpnascimento.com.br da Render/Vercel, DNS no registro.br
⬜ HTTPS no Kong dos dois nós (Let's Encrypt, grátis)
⬜ gerar as chaves anon/service_role do cluster
⬜ a noite curta: passos 2.1 a 2.7
⬜ conferir client.ts depois do build do Lovable
⬜ backup cifrado passando a sair do cluster
⬜ só então: desligar Render e Supabase
```

**Decisões ainda abertas:** a noite do Marco B (depois do domínio) e o
`synchronous_mode_strict` (recomendação: continuar desligado).
