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

**Um slot de replicação que para de ser consumido tem sete horas de vida.**

> 🔴 **Corrigido em 15/10/2026.** Este trecho dizia, até hoje, que o slot
> parado *"enche o WAL da produção e derruba a Supabase"*. **Está errado, e eu
> repeti o erro ao Eduardo em relatório e em notificação.** A produção tem
> `max_slot_wal_keep_size = 2GB`: o Postgres invalida o slot para proteger o
> disco, e o disco nunca enche por essa via. Medido depois de 14 h de parada
> real: WAL em 1296 MB de um teto de 4 GB, ERP respondendo 200. Detalhe,
> aritmética e o caminho de volta na **seção 1.12**.

O risco verdadeiro é o outro lado da mesma moeda: a ~300 MB/h, o slot parado
chega aos 2 GB em **cerca de 7 horas** e é **invalidado**. O preço de uma
parada muda de categoria nesse momento:

| Parada percebida em… | Preço |
|---|---|
| menos de 7 h | um comando (`disparar-sincronia` ou `disparar-conflito`) |
| mais de 7 h | **recopiar o banco inteiro** (`disparar-religar`) |

Três consequências práticas:

1. Enquanto existir slot nosso na produção, **alguém tem que estar olhando**.
   A consulta de vigilância está no passo 1.5 e roda a cada poucos minutos.
2. **O vigia só vale se o worker estiver vivo.** O alerta por DM dispara com
   1 GB no slot (~3,5 h de folga), e quem envia DM é o `worker/`. Em 14/10 o
   worker estava morto desde 17h16, a replicação parou às 20h09, e o aviso que
   existia exatamente para isso não saiu. Conferir
   `scripts/status-banco.txt` com data de agora **antes** de deixar a
   replicação ligada da noite para o dia.
3. Em qualquer passo que der errado, a primeira coisa a fazer é **soltar o
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
   inativo por mais de **5 minutos**. 1 GB é **metade do limite que mata o
   slot** (`max_slot_wal_keep_size = 2GB`, seção 1.12): a produção gera
   ~300 MB de WAL por hora, então o alerta sai com cerca de 3,5 h de folga
   antes de a parada passar a custar uma recópia integral — e alto o bastante
   para a carga inicial não dar alarme falso.

   ⚠️ **O alerta só existe se o worker estiver vivo.** Quem envia a DM é o
   `worker/`. Em 14/10 ele estava morto desde 17h16, a replicação parou às
   20h09, e o slot foi invalidado de madrugada sem que ninguém soubesse. O
   vigia estava certo e calado.

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

#### A quarta deriva, no mesmo dia — e o que ela provou (14/10/2026, 19h)

A rotina acima foi exercitada de verdade poucas horas depois, e desta vez
**nada precisou ser descoberto à mão**. O cron do vigia pegou às 19h00 e
escreveu a causa no log, de 10 em 10 minutos:

```
14/10 19:00:02 [banco2] ALERTA: replicacao parada (received_lsn='', sem mensagem ha 999999s).
14/10 19:00:02 [banco2] CAUSA: coluna faltando no cluster. Rode da maquina do Eduardo:
14/10 19:00:02 [banco2]        bash infra/ha/disparar-sincronia.sh --aplicar
14/10 19:00:02 [banco2]        logical replication target relation
                               "public.financeiro_conciliacao_fluxo_caixa" is
                               missing replicated columns: "extrato_entradas", "extrato_saidas"
```

Levantamento do `--conferir`: **14 colunas** em 3 tabelas e **1 tabela
inteira**.

| Tabela | O que faltava |
|---|---|
| `WA_CURRICULOS` | 11 colunas (`urgente_*`, `sst_visto_*`, `compras_visto_*`, `cracha_foto_path`) |
| `financeiro_conciliacao_fluxo_caixa` | `extrato_entradas`, `extrato_saidas` — as que pararam a replicação |
| `financeiro_fluxo_caixa_ajuste` | `created_by` |
| `financeiro_fluxo_caixa_ajuste_log` | a tabela inteira (39 linhas) |

Conserto em um comando, e o slot saiu de **353 MB presos** para **0 bytes**:

```
=== estado do slot na producao ===
erp_corte|ativo=true|353 MB      <- antes
erp_corte|ativo=true|0 bytes     <- menos de um minuto depois
```

**Três coisas que este episódio fixou:**

1. **O ritmo é real, não anedota: quatro derivas em dois dias.** A pergunta
   "será que vai acontecer de novo até a virada?" está respondida — vai. O
   `--conferir` entra no passo 2.1, imediatamente antes de congelar a
   escrita, e o resultado tem que ser `nenhuma faltando`.
2. **A tabela nova chega com `GRANT ALL ON TABLE ... TO anon, authenticated`**
   no `pg_dump`, o que **furaria a trava da seção 1.9** para ela. Toda tabela
   trazida depois da trava exige reaplicar o `REVOKE` em seguida — foi feito,
   e a conferência voltou a `escrita: 0 / leitura: 1.229` (1.227 + as duas
   leituras da tabela nova).
3. **A bandeira mora no líder, e o líder muda.** O `disparar-sincronia.sh`
   apagava `/var/run/replicacao-precisa-coluna` só no `banco1`, mas quem a
   escreve é o líder — hoje o `banco2`. O conserto deu certo e a bandeira
   ficou de pé, afirmando um problema que já não existia. A vigia a limpa
   sozinha no ciclo seguinte, então nunca passaria de 10 minutos, mas
   bandeira que mente é bandeira que se aprende a ignorar. Agora o gatilho
   limpa **nos dois nós** — ele é o único lugar com chave para ambos, porque
   o `banco1` não tem chave para o `banco2`.

A publicação passou de **646 para 647 tabelas**, e a assinatura está `647 de
647` em estado `r`. Paridade conferida nas cinco tabelas envolvidas:

| Tabela | Produção | Cluster |
|---|---|---|
| `WA_CURRICULOS` | 773 | 773 |
| `financeiro_conciliacao_fluxo_caixa` | 24 | 24 |
| `financeiro_fluxo_caixa_ajuste` | 39 | 39 |
| `financeiro_fluxo_caixa_ajuste_log` | 39 | 39 |
| `CHAMADO_SISTEMA` | 640 | 640 |

---


### 1.8 ✅ A API do cluster em HTTPS, e o que já foi aceito (14/10/2026)

Sem isto o Marco B entrega tela branca: o frontend serve de
`https://app.grpnascimento.com.br`, e **um site HTTPS não pode chamar uma API
em HTTP** — o navegador bloqueia antes de sair, e nenhum teste de `curl`
mostra isso. O Kong escutava HTTP puro na 8000, com `URL_EXTERNA` em
`localhost`.

**O problema da porta.** A 443 dos nós estava ocupada pelo `sshd`, porque a
rede da empresa bloqueia a 22. Medido do escritório: saída **80 OK, 443 OK,
8443 OK, 8000 bloqueada, 2222 bloqueada**. Então o **SSH foi para a 8443** — que
só nós usamos — e a 443 ficou para o usuário, que é a porta que funciona em
qualquer rede, inclusive no 4G de quem está em campo.

Feito por `infra/ha/expor-api-https.sh`, em etapas que nunca tiram o acesso
antes da próxima estar provada. **Anote: o SSH dos nós agora é
`ssh -p 8443`.**

#### O que foi medido, e o que cada medida prova

| Medida | Resultado | O que prova |
|---|---|---|
| certificado | `Let's Encrypt YE2 ← ISRG Root YE ← ISRG Root X2`, `Verify return code: 0` | TLS real, renovação automática, válido até 12/01/2027 |
| `/auth/v1/health` | `200` | GoTrue de pé |
| preflight `OPTIONS` com `Origin` do frontend | `200` com `Access-Control-Allow-Origin` | **o navegador vai deixar passar** — é o teste que o `curl` simples não faz, e que reprovou 4 vezes na contingência |
| login com senha errada | `400 invalid_grant / Invalid login credentials` | a cadeia de autenticação inteira lê a tabela de usuários replicada |
| `anon` lendo `EMPREGADOS` | `200` com `[]` | a RLS barra, e barra devolvendo lista vazia (não erro) |
| `service_role` lendo | `200`, 4.384 bytes | dados reais sendo servidos |
| `CHAMADO_SISTEMA` por PostgREST | `content-range: 0-0/640` | contagem igual à da produção, pela API |
| **download de anexo** | `200`, 43.584 bytes, content-type correto, conteúdo começando em `PK` | o byte está no disco **e** o xattr sobreviveu — é aqui que o nó sem o arquivo responde 500 |

#### A trava de leitura durante o teste

O cluster é **assinante** da replicação: uma escrita local pode tomar uma PK
que a produção ainda vai replicar, e o conflito de chave duplicada **para a
replicação**. Por isso o teste rodou com a escrita revogada no cluster
(`REVOKE INSERT, UPDATE, DELETE ... FROM anon, authenticated`, o mesmo padrão
da seção 2.1, só que do lado do cluster), e os `GRANT` foram devolvidos ao
final. **Escrita pelo ERP ainda não foi aceita** — isso só acontece na janela,
depois que a produção estiver congelada.

#### O que falta para a aceitação pelo navegador

O build local apontando para o cluster depende da chave `anon` do cluster
entrar num `.env` da máquina de quem builda. Com ele pronto, o login é feito
com a **senha real**: o dump de `auth` já carregou os 159 usuários no cluster,
com os hashes da produção.

#### A diferença que o teste expôs

| | produção | cluster |
|---|---|---|
| `CHAMADO_SISTEMA` | 640 | 640 |
| `EMPREGADOS` | 13.404 | 13.404 |
| `mz_32_fato_razao_contabil` | 215.210 | 215.210 |
| **`storage.objects`** | **11.568** | **11.252** |

Faltam **316 anexos**, enviados depois da carga de 13/10. É esperado —
`storage` não entra na publicação —, mas agora tem ritmo: **~316 por dia**.
Confirma que o passo 2.5 (delta final dos anexos) não é formalidade e precisa
rodar **imediatamente antes** da virada.

---

### 1.9 O cluster fica com a escrita REVOGADA até a virada

Enquanto o cluster é **assinante** da replicação, uma escrita local pode tomar
uma chave primária que a produção ainda vai replicar — e o conflito de chave
duplicada **para a replicação**, exatamente como a coluna faltando da seção
1.7, só que sem erro óbvio no log.

Por isso, desde 14/10/2026, o cluster está assim:

```sql
-- no CLUSTER (não na produção)
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';
```

O ERP apontado para o cluster **abre, loga e consulta, e recusa salvar pelos
caminhos diretos**. Isso é o estado correto de espera, não um defeito a
consertar.

> 🔴 **Correção de 14/10/2026, 20h: este REVOKE NÃO torna o cluster
> somente-leitura.** A frase original desta seção dizia que dizia, e estava
> errada.
>
> `REVOKE ... FROM anon, authenticated` fecha o acesso **direto** às tabelas.
> Não fecha nada que passe por função `SECURITY DEFINER` — ela roda com os
> privilégios do **dono**, não de quem chamou. Medido neste banco:
>
> | | |
> |---|---|
> | funções em `public` | 1.532 |
> | `SECURITY DEFINER` | 1.124 |
> | …que escrevem | 418 |
> | …que escrevem **e** `anon`/`authenticated` podem chamar | **372** |
>
> São 372 portas que o REVOKE não encosta. E não há plano B fácil:
> `default_transaction_read_only` também não serve, porque o PostgREST abre
> transação `READ WRITE` explicitamente para todo verbo que modifica.
>
> **Consequência prática: abrir o ERP contra o cluster é uma operação de
> escrita.** Vale fazer — a aceitação pelo navegador achou coisa que nenhum
> `curl` acharia — mas não é um teste inócuo, e precisa do
> `resolver-conflito.sh` da seção 1.10 à mão. Foi exatamente assim que a
> replicação parou às 20h09 de 14/10.

> ⚠️ **A trava vaza por tabela nova.** `REVOKE ... ON ALL TABLES` age sobre as
> tabelas que existiam no momento em que rodou — não é uma regra permanente.
> Toda tabela trazida da produção depois disso chega com
> `GRANT ALL ON TABLE ... TO anon, authenticated` no `pg_dump` e entra
> **gravável**. Aconteceu em 14/10 com `financeiro_fluxo_caixa_ajuste_log`.
> Depois de trazer qualquer tabela, rode o `REVOKE` de novo e confira:
> ```sql
> select count(*) from information_schema.role_table_grants
>   where grantee in ('anon','authenticated') and table_schema = 'public'
>     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
> -- tem que ser 0
> ```

> ⚠️ **A virada tem que desfazer isso.** Depois de parar a assinatura (passo
> 2.2) e antes de liberar os usuários, rode no cluster:
> ```sql
> GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
> NOTIFY pgrst, 'reload schema';
> ```
> Esquecer isto entrega um ERP que abre, mostra tudo e não deixa salvar nada —
> e o sintoma na tela não fala de permissão, fala de erro ao gravar.

Para a aceitação pelo navegador: `infra/ha/testar-cluster-local.sh` sobe o ERP
em `localhost:4173` apontando para o cluster, sem publicar nada. A senha é
digitada no navegador pelo próprio usuário — o dump de `auth` já carregou os
159 logins no cluster **com os hashes da produção**, então a senha real
funciona lá.

---

### 1.10 ⚠️ Conflito de chave: o preço da aceitação pelo navegador (14/10/2026)

Às 20h08 o Eduardo abriu três chamados no ERP apontado para o cluster. Cada
abertura marca o chamado como lido, e a marcação passa por função
`SECURITY DEFINER` — então escreveu, apesar do REVOKE da seção 1.9. Três linhas
entraram em `CHAMADO_SISTEMA_LEITURA` às 20:08:23, 20:08:47 e 20:09:15.

Às 20:09:41 a produção inseriu, de verdade, uma linha com a **mesma chave**
`(chamado_id, user_id)`. A replicação tentou aplicar e morreu:

```
ERROR: duplicate key value violates unique constraint "CHAMADO_SISTEMA_LEITURA_pkey"
```

Daí em diante, o mesmo ciclo da coluna faltando: trabalhador morrendo a cada
5 s, slot inativo, WAL preso na produção.

**O diagnóstico que engana:** a contagem batia. 997 linhas na produção, 997 no
cluster, e as 997 chaves idênticas — uma conferência por contagem ou por chave
diria "tudo igual". A divergência estava no **conteúdo**: duas linhas de 07/10
e 13/10 que o teste sobrescreveu via UPSERT, e uma terceira que o cluster
criou antes da produção.

| Chave | Produção | Cluster |
|---|---|---|
| `63f7f66d…` | `2026-10-07 17:15:08` | `2026-10-14 20:08:23` |
| `bd210d42…` | `2026-10-13 11:43:49` | `2026-10-14 20:08:47` |
| `d636884e…` | `2026-10-14 20:09:41` | `2026-10-14 20:09:15` |

#### `infra/ha/resolver-conflito.sh` — e por que são duas fases

```bash
bash infra/ha/disparar-conflito.sh                   # mostra as divergentes
bash infra/ha/disparar-conflito.sh --aplicar         # resolve
bash infra/ha/disparar-conflito.sh --aplicar TABELA  # se o líder for o banco2
```

Ele descobre a tabela pela restrição citada no log, lê a chave primária do
catálogo, compara **`md5` da linha inteira** nos dois lados — e não contagem,
nem chave — e então:

1. **Fase 1 — apaga do cluster as linhas divergentes.** Libera a chave e a
   fila da replicação anda.
2. **Fase 2 — recopia da produção o que ficou faltando**, por `COPY` em CSV
   (respeita `jsonb`, array e fuso sem conversão escrita à mão).

**A ordem não é intercambiável.** Recopiar antes de a fila andar reocuparia a
chave e o conflito voltaria no mesmo lugar. E a Fase 2 não é opcional: a
produção **não reenvia linha antiga**, então apagar sem recopiar deixaria um
furo permanente nas duas linhas que o UPSERT sobrescreveu.

#### O que isso muda no roteiro

A aceitação pelo navegador da seção 2.7 acontece **depois** de parar a
assinatura (passo 2.2) — lá não há conflito possível, e por isso ela está no
lugar certo. O que custou caro foi a aceitação **antecipada**, feita com a
replicação viva. Ela valeu a pena e deve ser repetida em outra ocasião, mas
com três coisas combinadas antes:

- rodar fora do horário em que a produção escreve muito (a colisão precisa de
  escrita simultânea na mesma chave);
- rodar o `disparar-conflito.sh --conferir` logo depois, sempre;
- não confundir "a replicação está em 647 de 647" com "não há conflito": o
  número fica perfeito até a primeira tentativa de aplicar.

---

### 1.11 ⚠️ O sincronizador de colunas não sincroniza schema (14/10/2026)

Erro de leitura meu, e o mais consequente do dia. O `sincronizar-colunas.sh`
foi escrito para uma pergunta — *"por que a replicação parou?"* — e passou a
ser usado como se respondesse outra: *"o cluster está igual à produção?"*.

Não responde. Ele acrescenta a **coluna crua** e vai embora. Fica para trás o
`NOT NULL`, o `CHECK`, a `FOREIGN KEY`, o índice, a **view** que passou a
expor a coluna, e a **função** e o **trigger** que dão sentido a ela. E a
replicação continua verde, porque nada disso lhe interessa.

Medido com a replicação em **"647 de 647, 0 bytes de atraso"** — aparentemente
perfeita:

| Faltando no cluster | Quantos |
|---|---|
| funções | **44** (12 `trn_*`, 21 `tvg_*`, 3 `ferias_*`, …) |
| triggers | 5 |
| views | 1 faltando + 1 desatualizada em 11 colunas |
| restrições | 3 (1 FK, 2 CHECK) |
| `NOT NULL` perdidos | 3 |
| índices | 1 (parcial) |
| função com assinatura **velha** | 1 (`rec_enxoval_informar`) |

O caso das 12 funções `trn_*` é o mais ilustrativo: as quatro tabelas
`TREINAMENTO_*` foram trazidas com cuidado, privilégio por privilégio — e as
funções do módulo, não. **O módulo Treinamentos abriria quebrado na virada, e
nenhum número da replicação reclamaria.**

#### `infra/ha/sincronizar-schema.sh`

```bash
bash infra/ha/disparar-schema.sh              # só confere (sai 1 se achar)
bash infra/ha/disparar-schema.sh --mostrar    # confere e imprime o DDL
bash infra/ha/disparar-schema.sh --aplicar    # aplica no cluster
```

Seis blocos: **FUNÇÕES, VIEWS, TRIGGERS, RESTRIÇÕES, NOT NULL, ÍNDICES**.
Quatro decisões que valem registro:

- **ACL reconstruído função por função.** `pg_get_functiondef` devolve o corpo
  e **não** devolve os GRANT. Sem isso, `trn_prova_enviar` — `SECURITY
  DEFINER`, restrita a `authenticated` na produção — chegaria executável por
  **PUBLIC**, o default do Postgres: o `anon` poderia enviar prova. O script
  emite `REVOKE ALL` e reconstrói os GRANT a partir do `proacl` da produção.
- **`SET check_function_bodies = off`.** Função chama função, e qualquer
  ordenação fixa erra em algum par: por nome, `ferias_saldo` vem antes de
  `ferias_vendas_12m` e o CREATE falha. É o mesmo interruptor que o `pg_dump`
  emite, pelo mesmo motivo.
- **Uma transação só.** Schema meio aplicado é o pior dos mundos — o
  `--conferir` seguinte mostraria um resto sem explicação. Na primeira
  execução isso salvou: a transação caiu inteira no erro de ordem.
- **`DROP` sem `CASCADE`, em lugar nenhum.** Se um DROP falhar por
  dependência, eu quero ver o erro, não descobrir depois o que foi levado
  junto.

Depois do `--aplicar`, a conferência independente
(`conferir-contra-producao.sh`) fechou **TUDO IGUAL** pela primeira vez:

```
funcoes em public    1532 = 1532    politicas de RLS   1437 = 1437
triggers              503 = 503     tabelas em public   661 = 661
views                  32 = 32      tabelas que anon le  564 = 564
COLUNAS      identico (10588 itens)
INDICES      identico (1884 itens)
RESTRICOES   identico (2533 itens)
PAPEIS       identico (28 itens)
TUDO IGUAL. Pode seguir.
```

**Os dois sincronizadores respondem perguntas diferentes e os dois são
obrigatórios no passo 2.1:** o de colunas responde "a replicação vai parar?";
o de schema responde "o cluster está igual à produção?". Em 14/10 o primeiro
dizia *"nenhuma faltando"* enquanto faltavam 44 funções, 5 triggers e 2 views.

---

### 1.12 🔴 O slot tem prazo de validade: 2 GB (15/10/2026)

A parada de 14/10 às 20h09 (seção 1.10) não foi destravada naquela noite. Na
manhã de 15/10 o log do líder repetia, de 5 em 5 segundos:

```
ERROR:  could not start WAL streaming: ERROR:  can no longer get changes
        from replication slot "erp_corte"
DETAIL:  This slot has been invalidated because it exceeded the maximum
         reserved size.
```

E o catálogo da produção:

```
 slot_name | active | restart_lsn | confirmed_flush_lsn | wal_status
 erp_corte |   f    |   (vazio)   |    E7/3B13A1C0      |    lost
```

#### Duas correções a este roteiro, de uma vez

**1. A produção nunca ia encher o disco.** Este roteiro dizia — e eu repeti ao
Eduardo em relatório e em notificação — que slot parado enche o disco e põe a
produção fora do ar. **Na Supabase, não.** `max_slot_wal_keep_size = 2GB`: o
Postgres se recusa a guardar mais que isso para um slot parado e **invalida o
slot** para proteger o disco. Medido depois de 14 h de parada: WAL em 1296 MB,
teto `max_wal_size` de 4 GB, ERP respondendo 200. O risco que eu anunciei
estava coberto pelo próprio banco.

**2. Em troca, a parada tem um cronômetro — e ele é curto.**

| | |
|---|---|
| WAL que a produção gera | ~300 MB/h (medido em 3 min, confirmado em 14 h) |
| teto por slot parado | 2 GB |
| **prazo para destravar** | **~7 horas** |
| alerta do vigia (1 GB) | ~3,5 h de folga |

Dentro das 7 h, destravar custa um comando. Passando delas, o preço vira
**recopiar o banco inteiro** — de "3 minutos" para "a noite".

Os valores a conferir antes de confiar nesta aritmética, porque são da
instância e podem mudar:

```sql
select name, setting from pg_settings
 where name in ('max_slot_wal_keep_size','max_wal_size','wal_keep_size');
```

#### O que mata o slot é a falta do aviso, não a parada

O vigia da migration `20261014000020` alerta por DM com 1 GB no slot — metade
do limite, de propósito. Em 14/10 ele **não avisou ninguém**, porque quem envia
DM é o `worker/`, e o worker estava morto desde 17h16. A parada foi às 20h09.

**Consequência operacional:** o worker não é um acessório deste roteiro, é
parte da proteção. Antes de deixar a replicação ligada da noite para o dia,
conferir que ele está vivo — `scripts/status-banco.txt` com data de agora — e
não só que o vigia existe.

#### `infra/ha/religar-replicacao.sh`

Para slot perdido não existe conserto incremental: o WAL que a assinatura
precisava **foi apagado**. O único caminho é copiar tudo de novo.

O `ligar-replicacao.sh` não serve para isto: um dos pré-requisitos dele é
`public` do cluster **vazio**, porque com `copy_data=true` dado preexistente
viraria conflito de chave na carga inicial. Daí o script novo.

```bash
bash infra/ha/disparar-religar.sh              # só diz o que faria
bash infra/ha/disparar-religar.sh --aplicar    # recopia
```

Seis passos: `DROP` da assinatura (DISABLE → `slot_name=none` → DROP, nessa
ordem, senão o DROP fica pendurado tentando falar com um slot que já não
existe), soltar o slot órfão na produção, `TRUNCATE` nas 657 tabelas de
`public`, `CREATE SUBSCRIPTION` com `copy_data=true`, acompanhar até
`647/647 PRONTA`, reaplicar a trava da seção 1.9.

Três decisões que valem registro:

- **Uma `TRUNCATE` só, com as 657 tabelas na mesma lista.** Assim as chaves
  estrangeiras entre elas ficam satisfeitas **sem `CASCADE`** — e `CASCADE`
  aqui poderia levar tabela de fora de `public` sem aparecer no log. Partição
  não entra na lista: o `TRUNCATE` do pai já leva as filhas.
- **A trava de recusa.** Se o `wal_status` não for `lost` (e o slot não for
  inexistente), o script **se recusa a rodar**. Sem isso, um `--aplicar`
  digitado na hora errada apagaria 1,5 milhão de linhas de um cluster
  perfeitamente saudável para recopiá-las. Os cinco estados foram testados:
  só `lost` e slot ausente liberam.
- **O `TRUNCATE` não toca em schema.** Função, view, trigger e política
  continuam lá — mas a produção andou desde a última conferência, então rodar
  `disparar-schema.sh` e `disparar-sincronia.sh` depois da recopia é parte do
  procedimento, não zelo extra.

#### A ordem entre o teste de failover e a recopia

Trocar o líder **no meio da cópia inicial** derruba a cópia: o processo que
copia roda no líder. Teste de failover **antes** do `--aplicar`, ou depois do
`647/647 PRONTA` — nunca no meio.
---

### 1.13 Backup do cluster — o que a Supabase fazia por nós (15/10/2026)

Hoje quem faz cópia do banco é a Supabase, e os dois workflows do GitHub
(`backup_banco.yml`, `backup_storage.yml`) apontam para ela. **No dia seguinte
à virada, o cluster passa a ser a produção — e, até 15/10, sem backup nenhum.**
Era o item mais fácil de esquecer e o mais caro de esquecer.

#### `infra/ha/backup-cluster.sh`, com timer nos dois nós

```
banco1  03h10 UTC (00h10 BRT)
banco2  05h10 UTC (02h10 BRT)
```

Os dois tiram a cópia do **líder** (via HAProxy em `127.0.0.1:5000`), em
horários diferentes para não se atropelarem. Resultado: duas cópias
independentes, **em dois provedores**, sem custo novo.

Tirar do standby local pareceria mais gentil com o líder, mas `pg_dump` longo
em standby morre com `canceling statement due to conflict with recovery`. No
líder é snapshot: **não trava escrita**.

#### São dois arquivos, e o segundo não é detalhe

| | |
|---|---|
| `banco.dump` | `pg_dump -Fc` do `postgres` inteiro — `public`, `auth`, `storage` |
| `globais.sql` | `pg_dumpall --globals-only`: **os papéis e as senhas deles** |

`pg_dump` **não leva papel nenhum**. Restaurar sem os papéis prontos já nos
custou um susto documentado: entra 1 política de RLS de 1.416 e o banco sobe
sem controle de acesso, em silêncio. A ordem de restauração é `globais.sql`
**primeiro**, `pg_restore` depois.

E **nunca `--no-privileges`**: ele apaga todos os `GRANT` do dump e o storage
passa a mentir dizendo `violates row-level security policy`. A frase está no
cabeçalho do script porque a tentação de "limpar o dump" já apareceu antes.

#### Medido na primeira execução

```
18 papeis
68,1 MB de dump  ->  61,8 MB cifrados      (46 s)
pg_restore -l enxerga 698 tabelas com dados
cifrado para a chave E1AB789FA3F1159F (Eduardo, backup ERP)
gpg --list-secret-keys nos dois nos:  0
```

A última linha é a que importa: **o servidor não consegue abrir o próprio
backup.** Isso é o que permite levar o arquivo para fora sem medo.

O script se recusa a publicar um arquivo com menos de 100 tabelas com dados —
o caso real que isso pega é disco cheio ou conexão cortada no meio, que gera
um arquivo truncado de tamanho convincente.

#### Levar para fora: `.github/workflows/backup_cluster.yml`

Dois backups em dois provedores ainda são dois servidores nossos. O workflow
diário (04h00 UTC) puxa o `.gpg` e guarda como artefato no GitHub.

O runner **não faz o dump**: o Postgres do cluster não atende na internet —
só escuta no IP do túnel e no HAProxy local, e abrir a 5432 para fora seria
desfazer metade do trabalho. Ele **puxa** o arquivo que o nó já fez, por uma
chave SSH amarrada a um comando único (`backup-cluster.sh --enviar`), sem
shell, sem pty, sem port-forward. No pior caso — secret do GitHub vazado — o
que vaza é um arquivo que o vazador não abre.

✅ **Feito em 16/10/2026**, num comando, com conferência no fim:

```bash
bash infra/ha/chave-backup-github.sh            # instala e grava o secret
bash infra/ha/chave-backup-github.sh --conferir # só olha
```

```
chave ed25519 nova, só em diretório temporário (shred no fim)
erpbackup nos dois nós, casa /home/erpbackup, 1 chave presa ao --enviar
a chave entrega 64.803.328 bytes       <- a prova: abaixo de 1 MB ele recusa
CLUSTER_BACKUP_SSH_KEY gravado         2026-10-16T12:23:51Z
```

> ⚠️ **O usuário não pode se chamar `backup`.** A primeira versão deste passo
> usou esse nome e falhou em silêncio: `backup` **já existe no Debian** (uid 34,
> home em `/var/backups`, shell `nologin`). O `useradd` falhou e caiu no
> `|| true`, a chave foi escrita em `/home/backup/.ssh/authorized_keys` — que o
> sshd nem olha, porque a casa de verdade é outra — e o `nologin` recusaria o
> `command=` de qualquer forma. **O sintoma foi `0 bytes` entregues, sem erro
> nenhum.** Quem salvou foi a trava do "menos de 1 MB não é dump": sem ela, o
> secret teria sido gravado e o backup off-site seria um arquivo vazio por
> meses. O usuário agora é `erpbackup`, e a casa sai do `getent`, nunca de
> `/home/<nome>` suposto.
>
> No caminho houve outro erro meu, já desfeito: pegar o grupo do diretório de
> backup (`stat -c %G`) para dar leitura ao usuário colocava ele no grupo
> **root**, porque o diretório é `root:root`. Era muito mais acesso do que ler
> um arquivo cifrado — e desnecessário, já que o diretório é 755 e os arquivos
> 644. Removido dos dois nós (`gpasswd -d backup root`).

#### Os anexos: coberto em 16/10/2026

```bash
ssh ... '/usr/local/sbin/backup-cluster.sh --instalar-anexos'   # timer semanal
```

`backup-cluster.sh --anexos` empacota o volume com `tar --xattrs`, cifra e
guarda; `backup_anexos_cluster.yml` puxa no domingo pela **mesma** chave,
dizendo só a palavra `anexos` (o `--enviar` lê `SSH_ORIGINAL_COMMAND` e escolhe
entre os dois pacotes — nada é executado). Medido na primeira execução:

```
[12:24:41] 12186 arquivos em /var/lib/docker/volumes/erp-pilha_storage-arquivos/_data
[12:28:40] 12186 arquivos empacotados, 5048 MB cifrados
```

**12.186 de 12.186, em 4 minutos.** A contagem não é um segundo `find`: o `tar`
roda com `-v` e lista no stderr cada membro que entrou de verdade, enquanto os
bytes seguem para o `gpg`. É o que pega pacote truncado — e truncado é
exatamente o que eu quase relatei: olhei o arquivo **enquanto ele era escrito**,
vi 2,5 GB e cheguei a registrar isso aqui como o tamanho final. Conferir
tamanho de arquivo que ainda está sendo gerado não vale nada; o número que
vale é o que o script imprime no fim.

A guarda do workflow (recusar pacote abaixo de 1 GB) segue válida, e os 12 GB
de folga exigidos no runner continuam de sobra para 5 GB.

**Por que um workflow novo e não reapontar o `backup_storage.yml`:** aquele
monta a lista de objetos com `psql` **contra a Supabase**, e o Postgres do
cluster não atende na internet para o runner. Reapontar seria reescrevê-lo.
Depois da virada ele pode ser aposentado.

Restaurar exige `--xattrs` nas **duas** pontas: o content-type de cada anexo
mora num atributo estendido, e sem ele o download morre com `ENODATA` sem falar
de arquivo. Está no passo B de `docs/ha-restauracao.md`.

---

### 1.14 O segundo nó atendendo o mesmo endereço (15/10/2026)

O banco trocava de líder sozinho, mas `api.grpnascimento.com.br` resolvia **só
para o banco1**. O nó que morresse inteiro levava o ERP junto, com o banco
intacto do outro lado — metade da alta disponibilidade que montamos.

O que tornou isto barato, medido em 15/10:

| | |
|---|---|
| banco1 | Vultr, **Osasco/SP** |
| banco2 | Linode, **São Paulo/SP** |
| RTT do túnel | **1,5 ms** |

Dividir o tráfego entre os dois **não custa latência nenhuma**. E o banco2 já
tinha a pilha inteira de pé (Kong, PostgREST, GoTrue, Storage, Functions) e o
HAProxy dele já enxergava o líder corretamente — faltava só o HTTPS.

#### Por que o certificado é copiado, e não emitido

O Let's Encrypt valida por HTTP-01: ele bate no próprio domínio. Com **um**
registro A (banco1), o banco2 nunca seria alcançado e o Caddy ficaria em retry
eterno — servindo, nesse meio-tempo, um certificado interno que o navegador
recusa. Com **dois** registros A, a validação cai num dos dois por sorteio e
falha em metade das vezes.

A saída é a ordem certa: copiar o certificado que o banco1 já tem, subir o
banco2 **já servindo certificado válido**, e só então publicar o segundo
registro A. É a mesma lição do domínio na Lovable — serviço pronto primeiro,
DNS depois.

`bash infra/ha/expor-api-https.sh --caddy-banco2` faz isso, e é repetível: é
ele também que leva a cópia depois de cada renovação.

#### O que foi provado antes de pedir o DNS

```
https pelo nome, resolvendo no banco2:
  /auth/v1/health                 -> 200
  /rest/v1/CHAMADO_SISTEMA?...    -> 200
  tls_verify_result = 0  (o navegador aceitaria), 93 ms
  issuer: Let's Encrypt YE2,  vence 12/01/2027
  fingerprint SHA256 IDENTICA a do banco1
```

E a conferência que decidia se round-robin era seguro ou desastre:

```
JWT_SECRET        banco1 = banco2   IGUAL
ANON_KEY          banco1 = banco2   IGUAL
SERVICE_ROLE_KEY  banco1 = banco2   IGUAL
URL_EXTERNA/SITE  banco1 = banco2   IGUAL
```

Se o `JWT_SECRET` diferisse, um token emitido por um nó seria recusado pelo
outro e **metade dos usuários seria deslogada a cada requisição**. Era a
pergunta que tinha que ser respondida antes de publicar o DNS, não depois.

#### Falta um passo, e é no registro.br

```
acrescentar   A   api   172.237.48.8      (mantendo o 216.238.120.171)
```

Com os dois registros, o navegador tenta um e, em falha de conexão, cai no
outro. **Não é um balanceador** — não há verificação de saúde, e um nó que
responda errado (em vez de não responder) continua recebendo metade. É o que
dá para fazer sem balanceador pago, e é muito melhor do que um endereço só.

⚠️ **Renovação:** quem renova é o banco1. O certificado atual vence em
**12/01/2027** e nada automatiza a cópia ainda — rodar o `--caddy-banco2` de
novo depois da renovação. Esta frase existe para ninguém descobrir isso pelo
navegador.



---

---

### 1.15 🔴 As 54 variáveis das Edge Functions (16/10/2026)

Na Supabase, cada Edge Function recebe os *secrets* do projeto. No cluster, o
container `erp-pilha-functions-1` subiu com **dez** variáveis:

```
HOME HOSTNAME JWT_SECRET PATH SUPABASE_ANON_KEY SUPABASE_DB_URL
SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL VERIFY_JWT
```

As 64 functions leem **54 nomes**. Nenhum conferidor olhava para isto: não é
tabela, não é função, não é arquivo — e a replicação continua verde do mesmo
jeito. Na virada, quebrariam em silêncio o envio de WhatsApp (12 functions), as
IAs, o push, os Correios, a régua de cobrança, o SMTP e o GitHub.

#### A descoberta que transformou isto num problema resolvível

`supabase secrets list` **não devolve valor nenhum** — devolve um *digest*. E
esse digest é o **SHA256 cru do valor, sem sal**. Provado com as cinco
variáveis que também existem em `worker/.env`: os cinco `sha256sum` bateram com
os cinco digests, caractere por caractere.

Isso muda a natureza da tarefa. Antes: "recuperei a chave no console da Meta,
espero que seja a mesma". Agora: `configurar-secrets.sh --conferir` responde
**CONFERIDO igual à produção** ou **DIFERENTE** — sem nunca ler o segredo da
produção, que continua ilegível.

#### O levantamento, de 16/10/2026

```
 9  eu levo daqui, sem console nenhum   (worker/.env, 5 delas CONFERIDAS)
16  só existem dentro da Supabase       <- estas bloqueiam a virada
 9  não existem em lugar nenhum         <- a function que as usa JÁ falha hoje
```

**As 9 que já temos:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`CORREIOS_API_CODIGO`, `CORREIOS_API_USUARIO`, `CORREIOS_CARTAO_POSTAGEM`,
`WHATSAPP_TICK_SECRET`, `WORKER_NOTIFICAR_SECRET`.

> **E as quatro do SMTP não estão na Supabase** — enquanto estão em
> `worker/.env` há meses, do outro lado da parede. O worker manda e-mail
> normalmente com elas; a Edge Function não.
>
> Quem paga por isso é a `comite-etica-nova-denuncia`, que avisa por e-mail
> quem cuida do Canal de Ética quando entra uma denúncia nova. Medido em
> 16/10/2026, na produção:
>
> ```
> destinatarios ativos do aviso de denuncia : 2
> avisos que falharam por falta de SMTP     : 3
> denuncias no canal                        : 16
> ```
>
> **Três denúncias entraram e ninguém foi avisado por e-mail**, com duas
> pessoas cadastradas esperando o aviso. Isso não tem nada a ver com a virada
> e deveria ter sido consertado meses atrás: `smtp-para-supabase.sh --aplicar`.
>
> Conferido antes de mexer: **não há disparo retroativo.** A function é
> invocada por denúncia nova, não por cron — ligar o SMTP não reenvia as três
> que falharam. (Era a pergunta certa a fazer: a regra da casa é mostrar a fila
> antes de ligar qualquer coisa que fale com gente de verdade.)

**As 16 presas:** `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_APP_ID`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_VERIFY_TOKEN`,
`GEMINI_API_KEY`, `GROQ_API_KEY`, `LOVABLE_API_KEY`, `GITHUB_TOKEN`,
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URIS`,
`CHAMADOS_CI_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`.

Foi tentada a recuperação automática delas, e **não deu**: o `client_id` do
Discord não sai do token do bot que temos, o token do `gh` não é o mesmo
`GITHUB_TOKEN`, e nenhum dos valores aparece em log, dump ou documento local.
A busca foi por hash contra os 30 digests — então o "não achei" aqui é
conclusivo, não desistência.

**As 9 que já estão quebradas hoje** (não são regressão da virada, e é
importante não confundir as duas coisas): `ANTHROPIC_API_KEY`,
`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
`COBRANCA_EMAIL_JURIDICO`, `COBRANCA_EMAIL_FINANCEIRO`, `ESCAVADOR_API_TOKEN`,
`NFEIO_API_KEY`, `WHATSAPP_TEMPLATE_DENUNCIA`.

#### Como aplicar

```bash
bash infra/ha/configurar-secrets.sh --conferir
SEGREDOS=~/segredos.env bash infra/ha/configurar-secrets.sh --aplicar
bash infra/ha/configurar-secrets.sh --provar
```

#### ✅ 16/10/2026: 12 já estão no cluster, 13 continuam nos consoles

Os 9 de `worker/.env` foram aplicados, e mais **três resolvidos sem console
nenhum**, porque as duas pontas eram nossas:

| | |
|---|---|
| `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` | par novo, gerado **dentro do nó** (`--girar-vapid`); a privada nunca passou por outra máquina. Custo conhecido: as **3** assinaturas de push atuais param até as 3 pessoas reativarem. A pública vai para `VITE_VAPID_PUBLIC_KEY` no build do Lovable, na virada. |
| `CHAMADOS_CI_SECRET` | valor novo **só no cluster** (`--girar-ci-secret`). Não rotacionei na produção de propósito: haveria um instante com um lado novo e o outro velho, e — como ninguém conhece o valor atual — um erro no meio não teria volta. Vira o do GitHub na virada, junto com a URL. |

O container saiu de **10** para **22** variáveis nos dois nós.

⚠️ **O `--aplicar` MESCLA, não sobrescreve.** Isso foi corrigido no mesmo dia,
e não é detalhe: as geradas no nó (VAPID, CI) não existem nesta máquina, então
um `--aplicar` que sobrescrevesse as apagaria — e a privada do VAPID não tem
cópia em lugar nenhum. O que vem daqui ganha; o que só existe lá é preservado,
e a gravação é recusada se a mescla encolher o arquivo.

O passo a passo clicável dos 13 restantes está em
[`ha-segredos-consoles.md`](ha-segredos-consoles.md).

O script grava `/opt/erp/infra/failover/segredos-functions.env` (chmod 600) nos
**dois** nós, acrescenta `env_file:` ao serviço `functions` do compose e recria
o container. `environment:` **ganha** de `env_file:`, e é por isso que
`SUPABASE_URL` continua valendo `http://kong:8000` mesmo que o arquivo diga
outra coisa. Nenhum valor é gravado nesta máquina nem aparece na tela.

---

### 1.16 🔴 Os sete jobs de cron dentro do banco (16/10/2026)

A produção tem **sete** agendamentos de `pg_cron` rodando dentro do banco:

| job | quando |
|---|---|
| `sla-escalonamento-tick` | de hora em hora |
| `regua-cobranca-tick` | de hora em hora |
| `whatsapp-retomada-tick` | de 5 em 5 minutos |
| `malote-rolagem-data-pagamento` | de 15 em 15 minutos |
| `tvg-dre-atualizar` | 4× ao dia |
| `plano-acao-marcar-atrasadas` | 06h00 |
| `comite-etica-alertas` | 08h00, dias de semana |

O cluster tem a extensão `pg_cron` instalada e **zero jobs**.

**Por que nenhum conferidor pegou isso.** `cron.job` pertence a uma *extensão*.
`pg_dump` leva a extensão, não as linhas dela — então "mesmas tabelas, mesmas
funções, mesmos dados em `public`" continuou verdadeiro o tempo todo. A agenda
não é tabela nem função: ficou fora de todas as contagens.

**O que aconteceria na virada.** Nada. Nenhum erro, nenhum 500, nenhum alerta —
as sete automações simplesmente nunca mais rodariam. O primeiro a notar seria o
Comitê de Ética na segunda sem o alerta das 8h. Isso é pior que quebrar:
quebrar avisa.

Uma boa notícia conferida no caminho: **nenhum job chama HTTP**. Todos são
`SELECT public.enfileirar_tick(...)` ou função SQL — empilham em `fila_http` e
quem executa é o `worker/`. E nenhuma função do banco tem `supabase.co` no
corpo (`prosrc like '%supabase.co%'` devolve vazio). Então a agenda viaja sem
reescrever URL nenhuma.

```bash
bash infra/ha/cron-no-cluster.sh --conferir
bash infra/ha/cron-no-cluster.sh --aplicar    # cria os sete DESLIGADOS
bash infra/ha/cron-no-cluster.sh --ligar      # na virada, depois do worker
```

Eles nascem **desligados** de propósito. `fila_http` tem dedupe por destino, de
modo que a fila não viraria avalanche; o motivo é outro — um tick de
`regua-cobranca` ou `whatsapp-retomada` entregue no momento errado é cobrança e
WhatsApp para gente de verdade. Agenda pronta e parada é o estado seguro.

---

### 1.17 ✅ Os usuários NÃO precisam fazer login outra vez (16/10/2026)

Esta seção corrige uma frase que estava no passo 2.6 desde o começo: *"todo
mundo vai ter que fazer login outra vez"*. Era verdade pelo motivo errado, e a
consequência prática é melhor do que se pensava — mas só por causa de **uma
linha** que até hoje não existia.

#### O que foi medido

```
chave anon da produção:  alg HS256, assinada com o segredo da Supabase
JWKS do projeto:         uma chave ES256  <- os tokens de USUÁRIO são ES256
JWT_SECRET do cluster:   DIFERENTE do da produção (conferido por HMAC)
```

A produção assina os tokens de acesso em **ES256**, com uma chave privada que
existe só dentro da Supabase. Então não há como "copiar o segredo" para o
cluster: o caminho de manter os tokens válidos **não existe**, e qualquer plano
que dependa disso está errado desde o início.

#### Mas o token de acesso não é a sessão

O que o navegador guarda é um par: o *access token* (que morre) e o
`refresh_token`, que é uma **string opaca conferida no banco**. E
`auth.refresh_tokens` **é copiado para o cluster** (passo 2.3). Então o
`autoRefreshToken` do supabase-js troca o token morto por um vivo contra o
GoTrue do cluster, e o usuário não vê nada.

#### A linha que decidia isso, e que faltava

Sem `storageKey`, o supabase-js **inventa** a chave do `localStorage` a partir
da URL — `sb-${primeiro rótulo do host}-auth-token`. Conferido no pacote
instalado (`supabase-js` 2.108.2, `SupabaseClient`):

```js
const defaultStorageKey = `sb-${baseUrl.hostname.split(".")[0]}-auth-token`;
```

| URL | gaveta onde a sessão é procurada |
|---|---|
| `https://fwmzeaztjxrxxzxzxmgc.supabase.co` | `sb-fwmzeaztjxrxxzxzxmgc-auth-token` |
| `https://api.grpnascimento.com.br` | `sb-api-auth-token` — **vazia** |

Trocar a URL mudaria a gaveta. O navegador não acharia sessão nenhuma e os
~157 usuários cairiam na tela de login no momento da virada, cada um com a
senha que talvez não lembre — **com o `refresh_token` intacto na gaveta
antiga**, a dois centímetros de distância.

`src/integrations/supabase/client.ts` agora fixa
`storageKey: 'sb-fwmzeaztjxrxxzxzxmgc-auth-token'`. **O valor é exatamente o
que o padrão já produz hoje**, então a mudança é inócua na produção atual e
decisiva na virada. Não é "o nome do projeto": é o endereço da gaveta onde a
sessão das pessoas já está. Mudar = deslogar todo mundo. Se o Lovable regerar o
arquivo, esta linha tem que voltar.

---

### 1.18 O reboot dos dois nós, e por que agora (16/10/2026)

Os dois nós estão com `linux-image-6.8.0-147-generic` instalado e rodando o
`6.8.0-146` — kernel novo esperando reboot desde que o
`apt-daily-upgrade.timer` o trouxe.

**O momento é hoje.** O cluster não atende usuário nenhum: um reboot errado
hoje é contratempo. Depois da virada, o mesmo reboot é janela de manutenção com
gente dentro do ERP.

```bash
bash infra/ha/reboot-controlado.sh --conferir
bash infra/ha/reboot-controlado.sh --rodar
```

A ordem importa e `reboot` nos dois **não** serve: sem quorum no etcd (2 dos 3
votos moram nos próprios bancos), ninguém assume. O script faz standby →
espera `streaming` com lag 0 → `patronictl switchover` → o outro nó → confere.

Três coisas conferidas antes de aceitar isto (16/10):

```
net.ipv4.ip_nonlocal_bind=1  persistido em /etc/sysctl.d/80-haproxy-bind.conf
patroni haproxy caddy docker etcd wg-quick@wg0   enabled nos DOIS nós
lag 0, TL 6, os dois em streaming
```

A primeira é a que já tinha mordido: o HAProxy se amarra num endereço que só
existe depois dos containers subirem. Sem o `sysctl` persistido, ele não sobe
no boot e o ERP responde "connection refused" com o banco perfeito.

E uma consequência agradável: o reboot do standby **é** um teste de failover de
verdade, feito pela porta da frente. O `switchover` do passo 2 é exatamente o
que o `testar-failover.sh` provaria.

#### ✅ Executado em 16/10/2026 — e o número que faltava

Os dois nós estão no **6.8.0-147**, sem reboot pendente, e o cluster passou da
**timeline 6 para a 8**: a troca de líder aconteteu de verdade, duas vezes.
`ip_nonlocal_bind` sobreviveu ao boot nos dois (era o risco anotado), e HAProxy,
Caddy, Patroni, etcd, Docker e os dois timers voltaram sozinhos.

Uma sonda ficou batendo no **endereço real** (sem `--resolve`, o caminho do
navegador) a cada 2 s durante a manobra. 205 amostras:

```
13:13:33  banco1  200     <- normal
13:13:35  banco1  503     <- o lider comeca a sair
13:13:38  banco2  200     <- o ENDERECO virou sozinho, em 3 segundos
13:13:40  banco2  503  ]
   ...                ]   <- 30 s sem lider: a eleicao do Patroni (ttl 20)
13:14:10  banco2  503  ]
13:14:12  banco1  502  ]
   ...                ]   <- a pilha do banco1 subindo
13:14:21  banco1  503  ]
13:14:23  banco1  200     <- normal de novo
```

**Duas lições, e a segunda corrige uma expectativa que estava errada:**

1. **Reiniciar o standby não custa nada.** Zero erro na sonda. É por isso que
   a ordem do script importa.
2. **Trocar de líder custa ~48 segundos de erro para quem está usando.** O
   endereço vira em 3 segundos — essa parte é excelente —, mas o nó que
   assume passa ~30 s sem ter a quem perguntar, porque a eleição do Patroni
   leva o `ttl` (20 s) e a pilha ainda precisa reconectar.

Ou seja: **alta disponibilidade aqui não é "sem interrupção", é "um minuto e
se cura sozinho"**. Perder um nó inteiro, de madrugada, com o banco intacto do
outro lado e o ERP voltando sozinho em menos de um minuto, é um resultado bom —
mas quem prometer "transparente" vai ser desmentido pelo usuário que estava
salvando uma tela naquele minuto.

Para a noite da virada isto significa uma coisa prática: **não trocar de líder
de propósito com gente usando.** O reboot que sobrar, faça no standby.

> Sobre `synchronous_mode_strict`: ele está **desligado**, e o passo 1 é a
> razão prática para continuar assim. Com o strict ligado, derrubar o único
> standby sincronizado faria a escrita esperar para sempre. Desligado, o
> Patroni tira o nome do standby de `synchronous_standby_names` e a escrita
> segue até ele voltar.

---

### 1.19 🔴 Os endereços que não estão no nosso código (16/10/2026)

Varredura de tudo que aponta para `fwmzeaztjxrxxzxzxmgc.supabase.co` e não é
documento nem script de corte. O que **nós** controlamos já foi parametrizado;
o que mora em console de terceiro é o que resta, e não dá para descobrir de
fora que está errado.

**Já resolvido no repositório** (a virada passa a ser uma variável, não um
`git grep`):

```
.github/workflows/chamado_pr_sync.yml          -> vars.SUPABASE_FUNCTIONS_URL
.github/workflows/chamado_concluir_no_merge.yml -> vars.SUPABASE_FUNCTIONS_URL
.github/workflows/vigia_banco.yml               -> já usava vars.SUPABASE_PROJETO_REF
```

Com a variável de repositório `SUPABASE_FUNCTIONS_URL` apontando para
`https://api.grpnascimento.com.br/functions/v1`, o CI troca de backend sem
mexer em workflow. Sem ela, continua na Supabase — o padrão é o de hoje.

**O que só existe em console de terceiro:**

| Onde | O que aponta para a Supabase | Se não mudar |
|---|---|---|
| Meta / WhatsApp | URL do webhook (`/functions/v1/whatsapp-webhook`) | mensagem recebida vai para o projeto desligado: **chatbot cego** |
| Discord | OAuth redirect URI | vincular conta para de funcionar |
| `worker/.env` | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | o worker continua trabalhando no banco antigo |
| Lovable | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | o ERP inteiro continua na Supabase |

O do Meta é o mais traiçoeiro: **ninguém reclama de mensagem que não chega.**
A fila não cresce, nenhum 500 aparece, o número continua recebendo. Só não há
resposta.

E ele amarra duas coisas: como a URL do webhook muda de qualquer forma, o
`WHATSAPP_VERIFY_TOKEN` pode ser um valor **novo**, escolhido por nós — basta
ser o mesmo nos dois lados, no mesmo momento. Isso tira uma das 16 da seção
1.15 da categoria "preciso recuperar" e põe na categoria "preciso definir".

## Fase 2 — a virada

Daqui até o fim, o ERP fica fora do ar para escrita. Alvo: **minutos**, não
horas — a cópia pesada já aconteceu na Fase 1.

### 2.1 Congelar a escrita na Supabase

> **Antes de congelar, rodar a conferência de deriva.** Foram quatro derivas de
> coluna em dois dias (seção 1.7), então a pergunta não é *se* haverá uma
> pendente na noite da virada:
>
> ```bash
> bash infra/ha/disparar-sincronia.sh --conferir     # "nenhuma faltando"
> bash infra/ha/disparar-sincronia.sh --aplicar      # se acusar
> bash infra/ha/disparar-schema.sh                   # "nada divergente"
> bash infra/ha/disparar-schema.sh --aplicar         # se acusar
> bash infra/ha/disparar-conflito.sh                 # "nenhuma linha divergente"
> ```
>
> **Os três, não um.** Eles respondem perguntas diferentes e já se
> contradisseram: em 14/10 o de colunas dizia *"nenhuma faltando"* enquanto
> faltavam 44 funções, 5 triggers e 2 views (seção 1.11).
>
> | Script | Pergunta que responde |
> |---|---|
> | `disparar-sincronia.sh` | a replicação vai parar por coluna? |
> | `disparar-schema.sh` | o cluster está igual à produção? |
> | `disparar-conflito.sh` | sobrou linha escrita localmente? (seção 1.10) |
>
> Congelar com uma coluna faltando trava a virada no pior momento: a assinatura
> não consegue chegar a lag zero, e o passo 2.2 fica esperando um número que
> nunca vem. Se o `--aplicar` trouxer **tabela nova**, reaplicar o `REVOKE` da
> seção 1.9 depois — o `pg_dump` traz `GRANT ALL` para `anon`/`authenticated`
> (o `sincronizar-schema.sh` já reaplica sozinho no fim).


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

~~**Todo mundo vai ter que fazer login outra vez.**~~ **Corrigido em
16/10/2026 — ver a seção 1.17.** A premissa estava certa (o token de acesso
atual é assinado pela Supabase, em ES256, e o cluster vai recusá-lo), mas a
conclusão estava errada: o que fica no navegador não é só o token, é o
`refresh_token` ao lado dele — uma string opaca conferida **no banco**, e
`auth.refresh_tokens` é copiado no passo 2.3. O supabase-js troca o token morto
por um vivo e **ninguém precisa logar de novo**.

Isso só vale por causa de uma linha que até 16/10 não existia:
`storageKey: 'sb-fwmzeaztjxrxxzxzxmgc-auth-token'` no `client.ts`. Sem ela, a
troca de URL mudaria a gaveta do `localStorage` (`sb-api-auth-token`, vazia) e
o navegador não acharia a sessão — com o `refresh_token` intacto na gaveta
antiga. **Conferir que essa linha sobreviveu ao build do Lovable** é parte do
passo 2.7, junto com o `client.ts`.

Mesmo assim, avisar antes: pode haver pessoas com janela aberta há horas, e um
erro momentâneo durante a troca é possível. "Se der erro, recarregue a página"
resolve o caso.

5. **As variáveis das Edge Functions** (seção 1.15) e **os sete jobs de cron**
   (seção 1.16):

```bash
bash infra/ha/configurar-secrets.sh --provar   # antes de virar: nada faltando?
bash infra/ha/cron-no-cluster.sh --ligar       # DEPOIS de apontar o worker
```

6. **A URL do webhook da Meta e o redirect do Discord** (seção 1.19) — os dois
   só existem em console de terceiro, e o da Meta não dá nenhum sinal de que
   está errado: mensagem recebida simplesmente não é respondida.

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

> Revisado em 15/10/2026. A versão anterior desta lista dizia **"O Marco A está
> fechado"** e marcava domínio e HTTPS como pendentes. As duas coisas
> envelheceram ao contrário: domínio e HTTPS **ficaram prontos**, e o Marco A
> **reabriu** quando o slot foi invalidado (seção 1.12).

**Marco A — sem custo novo, sem parada:**

```
✅ 0.1  viabilidade: IPv6 + protocolo de replicação   13/10 — aceito nos dois nós
✅ 0.1b IPv6 no banco1 (painel da Vultr)              13/10 — IDENTIFY_SYSTEM ok
✅ 0.5  carregar-anexos.sh escrito e provado          13/10 — 206 nos dois nós
✅ 2.3  carregar-auth-storage.sh escrito e provado    13/10 — 159 logins no cluster
✅ 1.6  RPC do slot + alerta no worker                13/10 — provado no cluster
✅ 1.6b migration 20261014000020 na produção          13/10 — anon recebe 401
✅ 0.2  folga no banco2 (parar pilha, capar diário)   13/10 — pilha religada depois
✅ 0.3  conferência do schema contra a produção       13/10 — e agora compara coluna
✅ 1.1  REPLICA IDENTITY FULL nas três tabelas        13/10 — tentativa 1, sem fila
✅ 1.2  publicação com 642 tabelas                    13/10 → 647 em 14/10
✅ 1.11 sincronizar-schema.sh (função/view/trigger)   14/10 — "TUDO IGUAL"
✅ dom  grpnascimento.com.br fora da Vercel, no .br   14/10 — app. e api. de pé
✅ 1.8  HTTPS no cluster (Caddy + Let's Encrypt)      14/10 — válido até 12/01/2027
✅ ---  chaves anon/service_role do cluster           em uso (ANON_KEY, 169 car.)
✅ ---  aceitação pelo navegador em localhost         14/10 — aprovada pelo Eduardo
🔁 1.3  assinatura com copy_data=true                 REABRIU — slot perdido 15/10
🔁 1.5  lag em zero e estável                         REABRIU — depende do 1.3
```

**O Marco A deixou de estar fechado em 15/10.** Enquanto o 1.3 não voltar, a
perda possível não é "segundos": é o backup da noite anterior, como antes de
começarmos. É o motivo de a recópia vir antes de qualquer outra coisa.

**Antes da noite do Marco B — levantado em 15/10, nada disso estava na lista:**

```
⬜ recopiar (disparar-religar.sh --aplicar) e conferir os três conferidores
✅ anexos: 12.041 de 12.041 no disco, 5.806 MB, 0 sem xattr   15/10 16h
✅ auth/storage: 157 logins e 12.053 objetos, tudo batendo    15/10 16h
✅ Edge Functions: 64 de 64 nos DOIS nós, idênticas ao repo   15/10 16h
✅ backup cifrado do cluster, timer diário nos dois nós       15/10 16h
🔸 endpoint HTTP: banco2 pronto e servindo; falta o 2º registro A
⬜ a noite curta: passos 2.1 a 2.7
⬜ conferir client.ts depois do build do Lovable
⬜ só então: desligar Render e Supabase
```

**Levantado em 16/10 — também não estava em lista nenhuma:**

```
🔴 1.15 as 54 variáveis das Edge Functions          9 em mãos, 16 presas na Supabase
🔴 1.16 os 7 jobs de pg_cron, inexistentes no cluster      script pronto
✅ 1.17 a sessão dos 157 usuários (storageKey)       resolvido no client.ts
⬜ 1.18 reboot controlado dos dois nós (kernel novo)       script pronto
🔴 1.19 webhook da Meta e redirect do Discord        só em console de terceiro
✅ ---  CI parametrizado (vars.SUPABASE_FUNCTIONS_URL)     16/10
✅ ---  renovação do certificado no banco2, automática     espelhar-cert.sh
✅ ---  backup dos anexos fora dos nós (semanal)           backup-cluster.sh --anexos
✅ ---  vigia do certificado por DM (<21 dias ou divergência)  backup_cluster.yml
✅ ---  roteiro de restauração                             docs/ha-restauracao.md
⬜ ---  o secret CLUSTER_BACKUP_SSH_KEY                    chave-backup-github.sh
```

**O que todos esses cinco itens de 16/10 têm em comum** merece ser dito, porque
é a terceira vez que o mesmo tipo de coisa aparece (seções 1.11, 1.13 e agora):
**nenhum deles é tabela, linha ou arquivo.** Variável de ambiente, agenda de
`pg_cron`, chave do `localStorage`, kernel, URL em console de terceiro — nada
disso entra numa contagem de tabelas, e todos os nossos conferidores contam
tabelas. Um sistema não é só o seu banco de dados, e a parte que não é banco
não tem conferidor nenhum.

Quatro dessas merecem explicação, porque são do mesmo tipo de erro que a
seção 1.11 descreve — **uma cópia feita num dia e tratada como se fosse viva.**

> Os quatro diagnósticos abaixo são de **15/10 de manhã** e os números deles
> são os daquele momento. Todos foram fechados na tarde do mesmo dia (ver os
> ✅ na lista acima) — ficam aqui porque o raciocínio continua valendo, e
> porque apagar o diagnóstico depois de resolver faz o próximo caso parecer
> inédito.

- **Anexos.** O espelho de 1 minuto é **entre os nós** (banco1 ↔ banco2), para
  o nó que não recebeu o byte não responder 500. Ele **não traz nada da
  produção**. Quem faz isso é o `carregar-anexos.sh`, à mão, e a última vez foi
  13/10. Medido em 15/10: produção 11.620, cluster 11.252 — **368 de diferença,
  +39 só desde a noite de 14/10.** Rodar imediatamente antes da virada, e
  conferir o número, não a sensação de que o espelho "está rodando".
- **auth e storage.** Não vêm por replicação lógica (seção 1.4). A carga de
  13/10 trouxe 159 logins; a produção tem **156** agora — ou seja, já houve
  exclusão de usuário depois. Reexecutar no passo 2.3 não é zelo, é o que
  mantém quem entra no sistema.
- **Edge Functions.** O container `erp-pilha-functions-1` tem **63** das 64 do
  repositório. Falta `tvg-ia` — e é do **mesmo módulo TVG** cujas 21 funções de
  banco faltavam na seção 1.11. A cópia das functions deriva igual à do schema,
  e não existe conferidor para ela. Comparar `ls` no container com
  `ls supabase/functions` faz parte do passo 2.1.
- **Backup.** Hoje `backup_banco.yml` e `backup_storage.yml` apontam para a
  Supabase. No dia seguinte à virada, **o cluster não tem backup nenhum** —
  e o cluster passa a ser a produção. Isto é o item mais fácil de esquecer e o
  mais caro de esquecer.

**Decisões ainda abertas:** a noite do Marco B e o `synchronous_mode_strict`
(recomendação: continuar desligado — a seção 1.18 explica por quê, com um caso
concreto).

~~a alta disponibilidade do **endereço HTTP**~~ — **fechada em 15/10** (seção
1.14): o banco2 serve o mesmo endereço, com o mesmo certificado, e a renovação
dele deixou de ser manual em 16/10 (`espelhar-cert.sh`). Falta só publicar o
segundo registro A no registro.br, que é passo de 2 minutos e não depende de
mais nada nosso.
