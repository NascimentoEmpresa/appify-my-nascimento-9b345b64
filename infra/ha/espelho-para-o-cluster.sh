#!/usr/bin/env bash
# ============================================================================
#  O ESPELHO PASSA A ESCREVER NO CLUSTER, PELO TUNEL
#
#  O QUE MUDA, E O QUE **NAO** MUDA
#  Nao muda: o agendamento (diaria as 07:00 + rapida a cada 10 min), o modo
#  incremental do BiMarcacoes (45 dias na diaria, 1 dia na rapida), o alerta,
#  o `tabelas.json`, o `espelho.mjs`. Nada disso e tocado.
#
#  Muda UMA coisa: para onde o espelho escreve. Ele continua rodando no
#  GitHub Actions -- que alcanca o MySQL da Hagg na porta 22 sem problema --
#  mas o Postgres de destino deixa de ser a Supabase publica e passa a ser o
#  cluster, alcancado por um TUNEL SSH, exatamente como o pgAdmin dos devs.
#
#  POR QUE O TUNEL, E NAO MUDAR O ESPELHO DE CASA
#  A primeira ideia foi levar o alimentador para dentro do banco1. Isso
#  resolveria, mas obrigaria a guardar a credencial SSH do MySQL da Hagg no
#  servidor -- credencial que hoje so existe no secret do GitHub. Trocar um
#  problema de rede por mais superficie de segredo e mau negocio quando ha
#  um caminho que nao precisa de nenhum dos dois.
#
#  O PAPEL `espelho_carga` SO ENXERGA O SCHEMA `espelho`
#  Ele vira DONO do schema e das 26 tabelas -- precisa disso porque o
#  carregador faz TRUNCATE e recria tabela. Mas nao e superusuario, nao e
#  membro do `postgres` e nao tem nada em `public`. No pior caso (secret
#  vazado), o estrago e refazivel em 60 segundos: e um espelho, o dado
#  original esta no MySQL da Hagg.
#
#  O QUE AS 4 LINHAS DO credenciais.json VIRAM
#      supabase.host     127.0.0.1      <- a ponta local do tunel
#      supabase.porta    5433
#      supabase.usuario  espelho_carga
#      supabase.senha    (gerada aqui)
#  O bloco `ssh` (Hagg) e o bloco `mysql` ficam intactos.
#
#  POR QUE SAO DOIS COMANDOS, E NAO UM
#  O espelho roda a cada 10 minutos. Se a troca da credencial acontecesse
#  antes do workflow novo estar na `main`, a rodada seguinte tentaria falar
#  com um tunel que ninguem abriu -- e falharia de 10 em 10 minutos ate o
#  merge, enchendo a DM de erro por causa da ORDEM, nao de um defeito.
#
#    --preparar  cria a chave, o papel e grava SO a chave no GitHub.
#                Nada muda: o espelho continua escrevendo na Supabase.
#    (merge da PR)
#    --virar     troca a credencial. Da proxima rodada em diante, cluster.
#
#  Entre um e outro o sistema fica inteiro, e o --virar e uma linha so --
#  entao a janela de risco dura o tempo de um comando, nao o de uma revisao.
#
#  USO
#    bash infra/ha/espelho-para-o-cluster.sh --conferir
#    bash infra/ha/espelho-para-o-cluster.sh --preparar
#    bash infra/ha/espelho-para-o-cluster.sh --virar     # só depois do merge
#    bash infra/ha/espelho-para-o-cluster.sh --voltar    # desfaz, volta à Supabase
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
PORTA_SSH="${PORTA_SSH:-8443}"
USUARIO_TUNEL="${USUARIO_TUNEL:-pgtunel}"
# O repo tem mais de um remote (o espelho do Lovable), e o `gh` recusa
# adivinhar: "multiple remotes detected". Nomear evita gravar o secret no
# repositorio errado -- que seria um erro silencioso e caro.
REPO_GH="${REPO_GH:-NascimentoEmpresa/appify-my-nascimento-9b345b64}"
MODO="${1:---conferir}"

cd "$(dirname "$0")/../.." || exit 1
case "$MODO" in --conferir|--preparar|--virar|--voltar) ;; *) sed -n '2,55p' "$0"; exit 2 ;; esac

CRED="espelho-mysql/credenciais.json"
CHAVE="$HOME/.ssh/espelho-cluster"
TMPD="${TMPDIR:-/tmp}"
# Fica FORA do repositorio (ele e publico) e com 600. E a ponte entre
# --preparar e --virar: a senha gerada precisa sobreviver entre os dois.
NOVO="$HOME/espelho-credenciais-cluster.json"
trap 'rm -f "$TMPD/esp-papel.$$.sql"' EXIT

no() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=25 \
         -o StrictHostKeyChecking=accept-new "root@$BANCO1" "$@"; }

if [ "$MODO" = "--conferir" ]; then
  echo "== o que ja esta pronto"
  [ -f "$CRED" ] && echo "   credenciais.json local: existe" || echo "   credenciais.json local: NAO existe (preciso dele para montar o novo)"
  [ -f "$CHAVE" ] && echo "   chave do tunel: existe em $CHAVE" || echo "   chave do tunel: ainda nao existe"
  echo -n "   papel espelho_carga: "
  no "SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
      PGPASSWORD=\"\$SUP\" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At -c \
        \"select case when count(*)>0 then 'existe' else 'ainda nao existe' end from pg_roles where rolname='espelho_carga'\""
  echo "   secrets do GitHub:"
  gh secret list -R "$REPO_GH" 2>/dev/null | grep -iE 'espelho|tunel|cluster' | sed 's/^/      /' || echo "      (nao consegui listar)"
  echo -n "   credencial nova (pronta para --virar): "
  [ -f "$NOVO" ] && echo "existe" || echo "ainda nao"
  echo
  echo "   Para preparar:  bash infra/ha/espelho-para-o-cluster.sh --preparar"
  exit 0
fi

# ── --virar / --voltar: so trocam o secret, nada mais ──────────────────────
if [ "$MODO" = "--virar" ]; then
  [ -f "$NOVO" ] || { echo "nao achei $NOVO -- rode --preparar antes" >&2; exit 1; }
  gh secret set ESPELHO_CREDENCIAIS -R "$REPO_GH" < "$NOVO" || exit 1
  echo "== virado. Da proxima rodada (ate 10 min) em diante, o espelho escreve no cluster."
  echo "   Para voltar:  bash infra/ha/espelho-para-o-cluster.sh --voltar"
  exit 0
fi

if [ "$MODO" = "--voltar" ]; then
  # O credenciais.json do repositorio nunca foi alterado -- e ele que aponta
  # para a Supabase. Por isso o caminho de volta e uma linha, e nao uma
  # reconstrucao.
  [ -f "$CRED" ] || { echo "nao achei $CRED, que e o caminho de volta" >&2; exit 1; }
  gh secret set ESPELHO_CREDENCIAIS -R "$REPO_GH" < "$CRED" || exit 1
  echo "== voltou para a Supabase. O workflow abre o tunel a toa, e nada quebra:"
  echo "   ele so nao sera usado."
  exit 0
fi

[ -f "$CRED" ] || { echo "preciso de $CRED para montar o novo (os blocos ssh/mysql vem dele)" >&2; exit 1; }

# ── 1. chave do tunel, so para o espelho ───────────────────────────────────
#  Chave propria, e nao a do pgAdmin: assim da para cortar o acesso do
#  espelho sem derrubar os devs, e vice-versa. Uma chave por uso e o que
#  torna "revogar" uma decisao barata.
if [ -f "$CHAVE" ]; then
  echo "== reaproveitando a chave em $CHAVE"
else
  echo "== gerando a chave do tunel do espelho"
  ssh-keygen -q -t ed25519 -N '' -C "espelho-cluster" -f "$CHAVE" || exit 1
fi

echo "== instalando a chave no banco1 (sem shell, so a porta do banco)"
PUB=$(awk '{print $1" "$2" espelho-cluster"; exit}' "$CHAVE.pub")
no "set -e
  id $USUARIO_TUNEL >/dev/null 2>&1 || useradd -m -s /usr/sbin/nologin $USUARIO_TUNEL
  mkdir -p /home/$USUARIO_TUNEL/.ssh && chmod 700 /home/$USUARIO_TUNEL/.ssh
  touch /home/$USUARIO_TUNEL/.ssh/authorized_keys
  sed -i '/espelho-cluster\$/d' /home/$USUARIO_TUNEL/.ssh/authorized_keys
  printf '%s %s\n' 'restrict,port-forwarding,permitopen=\"127.0.0.1:5000\"' '$PUB' \
    >> /home/$USUARIO_TUNEL/.ssh/authorized_keys
  chmod 600 /home/$USUARIO_TUNEL/.ssh/authorized_keys
  chown -R $USUARIO_TUNEL:$USUARIO_TUNEL /home/$USUARIO_TUNEL/.ssh
  echo '   chave instalada'" || exit 1

# ── 2. papel dono do schema espelho ────────────────────────────────────────
SENHA=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)
[ "${#SENHA}" -ge 20 ] || { echo "nao consegui gerar senha" >&2; exit 1; }

cat > "$TMPD/esp-papel.$$.sql" <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='espelho_carga') then
    execute format('create role espelho_carga login password %L', '$SENHA');
  else
    execute format('alter role espelho_carga login password %L', '$SENHA');
  end if;
end \$\$;
alter role espelho_carga nosuperuser nocreatedb nocreaterole nobypassrls inherit;
grant connect on database postgres to espelho_carga;
-- Dono do schema e de tudo que ha dentro: o carregador faz TRUNCATE e, em
-- tabela nova do MySQL, CREATE TABLE. Sem a posse ele falharia no meio da
-- madrugada, com a mensagem generica de permissao.
alter schema espelho owner to espelho_carga;
grant usage, create on schema espelho to espelho_carga;
do \$\$
declare r record;
begin
  for r in select c.relname, c.relkind from pg_class c
            join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='espelho' and c.relkind in ('r','S','v')
  loop
    execute format('alter %s espelho.%I owner to espelho_carga',
      case r.relkind when 'S' then 'sequence' when 'v' then 'view' else 'table' end, r.relname);
  end loop;
end \$\$;
-- E so isso. Nada em public: o papel nao enxerga uma linha do ERP.
select 'tabelas do espelho que agora sao dele: '||count(*)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='espelho' and c.relkind='r' and c.relowner=(select oid from pg_roles where rolname='espelho_carga');
SQL

echo "== criando o papel espelho_carga"
scp -q -P "$PORTA_SSH" -o BatchMode=yes "$TMPD/esp-papel.$$.sql" "root@$BANCO1:/tmp/esp-papel.sql" || exit 1
no "SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
    PGPASSWORD=\"\$SUP\" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At -q -v ON_ERROR_STOP=1 -f /tmp/esp-papel.sql
    rm -f /tmp/esp-papel.sql" | sed 's/^/   /' || exit 1

# ── 3. o credenciais.json novo: so o bloco supabase muda ───────────────────
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
c.supabase = Object.assign({}, c.supabase, {
  host: "127.0.0.1", porta: 5433,
  usuario: "espelho_carga", senha: process.argv[2], banco: "postgres", schema: "espelho"
});
fs.writeFileSync(process.argv[3], JSON.stringify(c, null, 2));
' "$CRED" "$SENHA" "$NOVO" || { echo "falhei ao montar o JSON novo" >&2; exit 1; }

chmod 600 "$NOVO" 2>/dev/null

# SO a chave agora. A credencial fica guardada e entra no --virar, depois do
# merge -- senao o espelho falharia de 10 em 10 minutos por ordem errada.
echo "== gravando a chave do tunel no GitHub"
gh secret set CLUSTER_TUNEL_SSH_KEY -R "$REPO_GH" < "$CHAVE" && echo "   CLUSTER_TUNEL_SSH_KEY gravado" || exit 1

echo
echo "   Nada mudou ainda: o espelho continua escrevendo na Supabase."
echo "   Nenhuma senha foi impressa; a credencial nova ficou em"
echo "      $NOVO  (600, fora do repositorio)"
echo
echo "   Ordem daqui:"
echo "      1. mergear a PR (o workflow passa a abrir o tunel)"
echo "      2. bash infra/ha/espelho-para-o-cluster.sh --virar"
echo
echo "   O credenciais.json do repositorio NAO foi tocado de proposito: e ele"
echo "   o caminho de volta, por --voltar, em uma linha."
