# Restaurar o cluster do zero

> Escrito em 16/10/2026, **antes** da virada, de propósito: este é o único
> documento que precisa estar pronto justamente no dia em que tudo deu errado.
> Nesse dia ninguém tem paciência para descobrir a ordem certa.

Quem lê isto está numa de três situações:

| | O que aconteceu | Vá para |
|---|---|---|
| **A** | o banco se perdeu ou corrompeu | [Restaurar o banco](#a-restaurar-o-banco) |
| **B** | os **arquivos** dos anexos se perderam | [Restaurar os anexos](#b-restaurar-os-anexos) |
| **C** | os dois nós se perderam (provedor, conta, incêndio) | [Começar numa máquina nova](#c-comecar-numa-maquina-nova) |

---

## O que você precisa ter em mãos

**1. A chave privada GPG do Eduardo.** Sem ela **nada** aqui é possível. Qual
chave, exatamente (conferido no nó em 16/10/2026, porque em emergência ninguém
quer adivinhar isto):

```
pub  rsa4096/346F5F8723595EC2  [C]   <- a principal
     53B1F5DE1075BAA392D1AD1D346F5F8723595EC2
uid  Eduardo Monteiro (backup ERP) <eduardojeielmonteiro1802@gmail.com>
sub  rsa4096/E1AB789FA3F1159F  [E]   <- a de CIFRAGEM, que aparece no .gpg
```

É por isso que o `gpg --list-packets` do arquivo mostra `E1AB789FA3F1159F` e o
script fala de `53B1F5DE...`: são a subchave e a principal da **mesma** chave.
A privada **não existe em servidor nenhum** — `gpg --list-secret-keys` nos dois
nós devolve zero linhas. Isso é o que permite levar o backup para fora sem
medo, e é também o que torna a perda dessa chave equivalente a perder todos os
backups de uma vez.

**2. Um arquivo `.gpg`.** Em ordem de preferência:

```bash
# (a) do GitHub -- é o que existe FORA dos nossos servidores
gh run download --repo NascimentoEmpresa/appify-my-nascimento-9b345b64 \
   --name erp-cluster-AAAAMMDD-HHMM.tar.gz.gpg
gh api /repos/NascimentoEmpresa/appify-my-nascimento-9b345b64/actions/artifacts \
   --jq '.artifacts[] | select(.name|startswith("erp-cluster")) | "\(.name)  \(.created_at)"' | head

# (b) do nó, se ele ainda responde
ssh -p 8443 root@216.238.120.171 'ls -lt /var/backups/erp-cluster/'
scp -P 8443 root@216.238.120.171:/var/backups/erp-cluster/erp-cluster-*.tar.gz.gpg .
```

O banco1 guarda cópia de 03h10 UTC e o banco2 de 05h10 UTC — **os dois tiram
do líder**, então são duas cópias independentes do mesmo conteúdo, em dois
provedores. Os anexos saem no domingo, 04h30 UTC.

**3. Conferir que o arquivo é o que diz ser, antes de confiar nele:**

```bash
gpg --list-packets --list-only erp-cluster-*.tar.gz.gpg | head -3
# tem que aparecer "pubkey enc packet" e o keyid E1AB789FA3F1159F
```

---

## A. Restaurar o banco

### A.1 Abrir o pacote

```bash
gpg --decrypt erp-cluster-20261016-0310.tar.gz.gpg | tar -xz
ls -l
#  globais.sql    <- os papéis e as senhas deles
#  banco.dump     <- o banco (pg_dump -Fc)
```

### A.2 A ordem, que é a única parte deste documento que não se pode errar

```bash
# 1) PRIMEIRO os papéis
psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -f globais.sql

# 2) só então o banco
pg_restore -h 127.0.0.1 -p 5000 -U postgres -d postgres \
           --no-owner --role=postgres -j 4 banco.dump
```

**Por que esta ordem, e o que acontece ao contrário.** `pg_dump` não carrega
papel nenhum — papéis são do agrupamento, não do banco. Restaurando sem eles
prontos, cada `GRANT ... TO authenticated` e cada `CREATE POLICY ... TO anon`
falha, uma por uma, e o `pg_restore` **continua**. Já nos custou um susto
documentado: o banco subiu com **1 política de RLS de 1.416** e, do lado de
fora, parecia saudável — o ERP abria. Quem notaria seria o primeiro usuário
vendo dado de outra pessoa.

> ⚠️ **Nunca `--no-privileges`.** A tentação de "limpar o dump" aparece sempre.
> Ele apaga todos os `GRANT` e o sintoma depois é o storage mentindo
> `violates row-level security policy` — quando o erro real é falta de
> `GRANT` para o papel `authenticator`.

### A.3 Os atributos dos papéis, que o dump também não leva

`globais.sql` cria os papéis, mas atributos de alguns deles (notadamente
`authenticator`, que é quem o PostgREST usa para trocar de papel) podem não
voltar completos. O arquivo que resolve isso já está no repositório:

```bash
psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -f infra/ha/papeis-atributos.sql
psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -f infra/ha/pos-restauracao.sql
```

### A.4 Conferir que a restauração prestou — com números, não com sensação

```sql
select count(*) from pg_tables  where schemaname = 'public';            -- ~657
select count(*) from pg_policies;                                       -- ~1416
select count(*) from auth.users;                                        -- ~157
select count(*) from storage.objects;                                   -- ~12053
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public';                                             -- centenas
select rolname from pg_roles where rolname in
  ('anon','authenticated','service_role','authenticator','supabase_admin');
```

**`pg_policies` perto de 1.416 é o número que importa.** Se vier 1, 0 ou
dezenas, pare: os papéis não estavam prontos. Apague o banco e volte ao A.2 —
não tente consertar por cima.

Depois, pelo caminho do navegador (o que o `curl` não prova é CORS, mas estes
dois provam a pilha):

```bash
bash infra/ha/espelhar-cert.sh --conferir      # o HTTPS dos dois nós
bash infra/ha/configurar-secrets.sh --provar   # as variáveis das functions
```

### A.5 Religar o que estava desligado

```bash
bash infra/ha/cron-no-cluster.sh --conferir    # os 7 jobs de cron existem?
bash infra/ha/cron-no-cluster.sh --ligar       # só quando o worker já aponta pra cá
```

Um banco restaurado volta **sem os jobs de `pg_cron`**: a tabela `cron.job`
pertence a uma extensão, e `pg_dump` não leva o conteúdo dela. Sem este passo,
as sete automações (cobrança, SLA, comitê de ética, retomada de WhatsApp, TVG,
malote, plano de ação) ficam paradas sem erro nenhum.

---

## B. Restaurar os anexos

Os arquivos **não** estão no dump do banco. O banco guarda a lista
(`storage.objects`); o byte mora no volume do Docker. Restaurar só o banco
devolve telas com anexo listado que **falha com 500 ao abrir** — não 404.

```bash
gpg --decrypt anexos-cluster-20261018.tar.gz.gpg \
  | tar -xz --xattrs --xattrs-include='*' \
        -C "$(docker volume inspect erp-pilha_storage-arquivos --format '{{.Mountpoint}}')"
```

> ⚠️ **`--xattrs` nas duas pontas.** O content-type de cada anexo mora num
> atributo estendido do arquivo, não no banco. Sem ele o download morre com
> `ENODATA` e a mensagem não fala de arquivo nenhum — já perdemos tempo
> procurando no lugar errado por causa disso.

Conferir:

```bash
V=$(docker volume inspect erp-pilha_storage-arquivos --format '{{.Mountpoint}}')
find "$V/stub/stub" -type f | wc -l          # tem que bater com storage.objects
getfattr -d "$(find "$V/stub/stub" -type f | head -1)"   # tem que listar o content-type
```

Se um nó ficou bom e o outro não, **não restaure duas vezes**: o espelho de 1
minuto leva do nó bom para o outro sozinho (`espelho-anexos.timer`), e ele
nunca apaga nada.

---

## C. Começar numa máquina nova

A ordem completa, que é a mesma do laboratório e está detalhada em
`infra/ha/README.md`:

```bash
bash infra/ha/instalar-banco.sh      <ip>    # Postgres + Patroni + etcd
bash infra/ha/instalar-tunel.sh      <ip>    # WireGuard 10.77.0.x
bash infra/ha/instalar-arbitro.sh            # o terceiro voto do etcd
# ... A.1 a A.5 deste documento ...
bash infra/ha/expor-api-https.sh --preparar  # e depois --caddy / --caddy-banco2
bash infra/ha/espelhar-cert.sh --instalar
bash infra/ha/configurar-secrets.sh --aplicar
bash infra/ha/instalar-espelho-anexos.sh <ip1> <ip2>
bash infra/ha/backup-cluster.sh --instalar
bash infra/ha/backup-cluster.sh --instalar-anexos
bash infra/ha/chave-backup-github.sh
```

Duas coisas que quebram em silêncio ao recriar máquina, e que já quebraram:

1. **A versão do Postgres tem que ser a mesma** (17). `pg_restore` de um dump
   17 num servidor 16 falha no meio, com metade dentro.
2. **`net.ipv4.ip_nonlocal_bind=1` tem que estar persistido**
   (`/etc/sysctl.d/80-haproxy-bind.conf`). O HAProxy se amarra num endereço que
   só existe depois dos containers subirem; sem isso ele não sobe no boot e o
   ERP responde "connection refused" com o banco perfeito.

---

## Quanto tempo isso leva (medido, não estimado)

| | |
|---|---|
| backup do banco, no nó | **46 s** → 68,1 MB de dump, 61,8 MB cifrados |
| backup dos anexos, no nó | ~5,5 GB cifrados, semanal |
| `gpg --decrypt` + `tar -xz` do banco | segundos |
| `psql -f globais.sql` | segundos, 18 papéis |
| `pg_restore -j 4` | **minutos**, não horas |
| restaurar os anexos | limitado pelo disco, ~5,8 GB |

O caminho crítico de verdade não é a restauração: é **conseguir a chave
privada GPG**. Vale conferir, hoje, se ela está onde você acha que está.
