#!/usr/bin/env bash
# ============================================================================
#  REPARO: as tabelas que o TRUNCATE ... CASCADE esvaziou
#
#  O QUE ACONTECEU (17/10/2026, madrugada da virada)
#  `carregar-auth-storage.sh` limpa as tabelas de `auth` e `storage` antes de
#  carregar o dump da producao, e fazia isso com:
#
#      TRUNCATE auth.users, auth.identities, ... CASCADE;
#
#  O `CASCADE` do TRUNCATE **nao para no schema**: ele desce por TODA chave
#  estrangeira que aponte para as tabelas truncadas. Como meio ERP referencia
#  `auth.users` (quem criou, quem aprovou, quem assinou), o comando levou
#  junto **269 tabelas de `public`** -- Suprimentos inteiro, os vinculos de
#  Discord, e as tres tabelas de perfil que tiraram o administrador do
#  Eduardo. Nenhum erro apareceu: TRUNCATE CASCADE e silencioso por natureza,
#  e a conferencia do proprio script so olha `auth` e `storage`, onde tudo
#  batia.
#
#  Foi assim que apareceu: depois da virada, o Eduardo entrou no ERP e estava
#  como usuario comum. Uma linha de 161 fazia falta, e as outras 268 tabelas
#  estavam caladas atras dela.
#
#  POR QUE DA PARA REPARAR COM SEGURANCA
#  A producao esta CONGELADA (passo 2.1): ela nao muda enquanto isto roda,
#  entao uma copia feita agora e consistente. E este script so toca tabela que
#  esta **vazia** no cluster -- ele nunca sobrescreve dado novo, escrito
#  depois da virada.
#
#  USO
#    bash infra/ha/reparar-tabelas-vazias.sh --conferir
#    bash infra/ha/reparar-tabelas-vazias.sh --aplicar
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
PORTA_SSH="${PORTA_SSH:-8443}"
REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
ORIGEM_HOST="${ORIGEM_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
ACAO="${1:---conferir}"

cd "$(dirname "$0")/../.." || exit 1
PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local 2>/dev/null | cut -d= -f2- | tr -d '\r\n')
[ -n "$PW" ] || { echo "nao achei SENHA_ACESSO_SUPABASE em .env.local" >&2; exit 1; }
case "$ACAO" in --conferir|--aplicar|--delta|--delta-aplicar) : ;; *) sed -n '2,33p' "$0"; exit 2 ;; esac

ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
    -o StrictHostKeyChecking=accept-new "root@$BANCO1" \
    "SENHA='$PW' REF='$REF' ORIGEM_HOST='$ORIGEM_HOST' ACAO='$ACAO' ACAO2='${2:-}' bash -s" <<'REMOTO'
set -uo pipefail
BIN=/usr/lib/postgresql/17/bin
P() { PGPASSWORD="$SENHA" psql -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres -At "$@"; }
SUP=$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
C() { PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At "$@"; }

# TRAVA 1: a producao TEM que estar congelada. Copiar de um banco que esta
# mudando produz um retrato que nunca existiu -- metade de antes, metade de
# depois, e nenhuma forma de saber qual linha e qual.
GRANTS=$(P -c "select count(*) from information_schema.role_table_grants
                where grantee in ('anon','authenticated')
                  and privilege_type in ('INSERT','UPDATE','DELETE') and table_schema='public'")
echo "== producao: $GRANTS permissoes de escrita (0 = congelada)"
if [ "$GRANTS" != "0" ]; then
  echo "   A PRODUCAO NAO ESTA CONGELADA. Nao vou copiar de um alvo em movimento." >&2
  exit 1
fi

# ── --delta: as linhas que faltam em tabela que NAO esta vazia ────────────
#
#  Depois da virada sobraram tabelas com diferenca pequena: a producao
#  continuou escrevendo pelo cron dela (service_role nao e barrado pelo
#  congelamento, que so fecha anon/authenticated) ate o cron ser desligado.
#  Aqui nao da para truncar e recopiar: o cluster JA e a producao e pode ter
#  linha nova. Entao copiamos **so as chaves que faltam**, uma a uma.
#
#  Onde o cluster tem MAIS que a producao, nao se toca: isso e dado novo,
#  escrito no cluster depois da virada. E o que queremos.
if [ "$ACAO" = "--delta" ]; then
  P -c "select tablename from pg_publication_tables where pubname='erp_corte' and schemaname='public'" | LC_ALL=C sort > /tmp/l.txt
  SQL=$(awk '{printf "select %s::text||'"'"' '"'"'||count(*)::text from public.\"%s\" union all ", "'"'"'"$0"'"'"'", $0}' /tmp/l.txt | sed 's/ union all $//')
  P -c "$SQL" | LC_ALL=C sort > /tmp/p.txt
  C -c "$SQL" | LC_ALL=C sort > /tmp/c.txt
  join /tmp/p.txt /tmp/c.txt -o 0,1.2,2.2 | awk '$2+0 > $3+0 {print $1}' > /tmp/atras.txt
  echo "== $(wc -l < /tmp/atras.txt) tabela(s) com a producao na frente"
  TOTAL=0
  while read -r T; do
    [ -n "$T" ] || continue
    PK=$(P -c "select a.attname from pg_constraint c join pg_class r on r.oid=c.conrelid
                 join pg_namespace n on n.oid=r.relnamespace
                 join unnest(c.conkey) k(att) on true
                 join pg_attribute a on a.attrelid=r.oid and a.attnum=k.att
                where n.nspname='public' and r.relname='$T' and c.contype='p'")
    if [ -z "$PK" ] || [ "$(printf '%s\n' "$PK" | wc -l)" -ne 1 ]; then
      printf '   %-34s PULADA (sem PK de coluna unica)\n' "$T"; continue
    fi
    P -c "select \"$PK\"::text from public.\"$T\"" | LC_ALL=C sort > /tmp/kp.txt
    C -c "select \"$PK\"::text from public.\"$T\"" | LC_ALL=C sort > /tmp/kc.txt
    LC_ALL=C comm -23 /tmp/kp.txt /tmp/kc.txt > /tmp/kf.txt
    N=$(grep -c . /tmp/kf.txt)
    [ "$N" -gt 0 ] || { printf '   %-34s nada a copiar\n' "$T"; continue; }
    if [ "$ACAO2" = "--aplicar" ]; then
      IN=$(awk '{printf "%s'"'"'%s'"'"'", (NR>1?",":""), $0}' /tmp/kf.txt)
      PGPASSWORD="$SENHA" psql -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres \
        -c "\copy (select * from public.\"$T\" where \"$PK\"::text in ($IN)) to stdout" 2>/dev/null \
      | PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres \
        -c "set session_replication_role=replica;" -c "\copy public.\"$T\" from stdin" >/dev/null 2>&1 \
      && printf '   %-34s %s linha(s) copiada(s)\n' "$T" "$N" \
      || printf '   %-34s FALHOU (%s linhas)\n' "$T" "$N"
    else
      printf '   %-34s %s linha(s) faltando\n' "$T" "$N"
    fi
    TOTAL=$((TOTAL+N))
  done < /tmp/atras.txt
  echo "   total: $TOTAL linha(s)"
  rm -f /tmp/l.txt /tmp/p.txt /tmp/c.txt /tmp/atras.txt /tmp/kp.txt /tmp/kc.txt /tmp/kf.txt
  exit 0
fi

echo "== procurando tabelas VAZIAS no cluster e com dados na producao"
P -c "select tablename from pg_publication_tables where pubname='erp_corte' and schemaname='public'" | LC_ALL=C sort > /tmp/lista.txt
MK() { awk '{printf "select %s::text||'"'"' '"'"'||count(*)::text from public.\"%s\" union all ", "'"'"'"$0"'"'"'", $0}' /tmp/lista.txt | sed 's/ union all $//'; }
SQL=$(MK)
P -c "$SQL" | LC_ALL=C sort > /tmp/p.txt
C -c "$SQL" | LC_ALL=C sort > /tmp/c.txt
# so as que estao em ZERO no cluster: nunca sobrescrever dado novo
join /tmp/p.txt /tmp/c.txt -o 0,1.2,2.2 | awk '$3=="0" && $2+0>0 {print $1}' | LC_ALL=C sort > /tmp/alvo.txt
N=$(wc -l < /tmp/alvo.txt)
FALTAM=$(join /tmp/p.txt /tmp/c.txt -o 0,1.2,2.2 | awk '$3=="0" && $2+0>0 {s+=$2} END{print s+0}')
echo "   $N tabelas vazias no cluster, somando $FALTAM linhas na producao"

# As que divergem mas NAO estao zeradas: aviso, nao mexo. Pode ser dado novo.
join /tmp/p.txt /tmp/c.txt -o 0,1.2,2.2 | awk '$2!=$3 && $3!="0" {print "   ATENCAO (nao vou tocar): "$1" producao "$2" cluster "$3}'

[ "$N" -gt 0 ] || { echo "   nada a reparar"; exit 0; }
if [ "$ACAO" = "--conferir" ]; then
  head -12 /tmp/alvo.txt | sed 's/^/     /'
  [ "$N" -gt 12 ] && echo "     ... e mais $((N-12))"
  echo; echo "   Para reparar: bash infra/ha/reparar-tabelas-vazias.sh --aplicar"
  exit 0
fi

ARGS=(); while read -r T; do [ -n "$T" ] && ARGS+=(-t "public.\"$T\""); done < /tmp/alvo.txt
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "== puxando os dados da producao (--data-only)"
PGPASSWORD="$SENHA" "$BIN/pg_dump" -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres \
  --data-only --no-owner --disable-triggers "${ARGS[@]}" > "$TMP/dados.sql" 2>"$TMP/e" || {
  echo "   falhou o pg_dump:"; sed 's/^/     /' "$TMP/e" | head -5; exit 1; }
echo "   $(du -m "$TMP/dados.sql" | cut -f1) MB, $(grep -c '^COPY ' "$TMP/dados.sql") blocos COPY"
[ "$(grep -c '^COPY ' "$TMP/dados.sql")" -gt 0 ] || { echo "   dump sem COPY -- nao aplico"; exit 1; }

# ── os CHECK `NOT VALID` precisam sair durante a carga ────────────────────
#
#  Um CHECK criado como NOT VALID nao olha as linhas que ja existiam -- mas
#  VALE para toda linha nova. E `COPY` e linha nova. Entao a producao carrega
#  feliz linhas que o cluster recusa, e o erro e exatamente o que apareceu:
#    new row for relation "CHAMADO_SISTEMA_AVALIACAO" violates check
#    constraint "chamado_avaliacao_comentario_obrigatorio"
#  Aquela avaliacao e de 04/08, anterior a regra. Ela existe na producao e
#  tem que existir aqui: quem decide o que e valido e a producao, nao o
#  cluster.
#  `session_replication_role = replica` NAO resolve: ele desliga gatilho e
#  FK, nunca CHECK.
echo "== tirando os CHECK NOT VALID das tabelas alvo (voltam no fim)"
: > "$TMP/drop.sql"; : > "$TMP/add.sql"
while read -r T; do
  [ -n "$T" ] || continue
  P -c "select format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I;', '$T', conname)
          from pg_constraint c join pg_class r on r.oid=c.conrelid
          join pg_namespace n on n.oid=r.relnamespace
         where n.nspname='public' and r.relname='$T' and c.contype='c' and not c.convalidated" >> "$TMP/drop.sql"
  P -c "select format('ALTER TABLE public.%I ADD CONSTRAINT %I %s;', '$T', conname, pg_get_constraintdef(c.oid))
          from pg_constraint c join pg_class r on r.oid=c.conrelid
          join pg_namespace n on n.oid=r.relnamespace
         where n.nspname='public' and r.relname='$T' and c.contype='c' and not c.convalidated" >> "$TMP/add.sql"
done < /tmp/alvo.txt
echo "   $(grep -c . "$TMP/drop.sql") constraint(s) NOT VALID saindo"
[ -s "$TMP/drop.sql" ] && C -q -f "$TMP/drop.sql" >/dev/null 2>&1

echo "== carregando no cluster com session_replication_role=replica"
# replica desliga gatilho e checagem de FK: a ordem das tabelas deixa de
# importar, e os gatilhos de auditoria nao disparam 269 vezes.
{ echo "set session_replication_role = replica;"; cat "$TMP/dados.sql"; } \
  | PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres \
      -v ON_ERROR_STOP=1 -q 2>"$TMP/e2"
RC=$?
# Os CHECK voltam SEMPRE, deu certo ou nao: deixar o cluster sem a regra que a
# producao tem e pior do que a carga ter falhado.
if [ -s "$TMP/add.sql" ]; then
  C -q -f "$TMP/add.sql" >/dev/null 2>&1
  echo "   $(grep -c . "$TMP/add.sql") constraint(s) NOT VALID recolocadas"
fi
if [ "$RC" -ne 0 ]; then
  echo "   FALHOU:"; sed 's/^/     /' "$TMP/e2" | head -8; exit 1
fi
echo "   ok"

echo "== reconferindo as $N tabelas"
SQL2=$(awk '{printf "select %s::text||'"'"' '"'"'||count(*)::text from public.\"%s\" union all ", "'"'"'"$0"'"'"'", $0}' /tmp/alvo.txt | sed 's/ union all $//')
P -c "$SQL2" | LC_ALL=C sort > /tmp/p2.txt
C -c "$SQL2" | LC_ALL=C sort > /tmp/c2.txt
RESTO=$(join /tmp/p2.txt /tmp/c2.txt -o 0,1.2,2.2 | awk '$2!=$3 {print}' | wc -l)
echo "   ainda divergentes: $RESTO"
join /tmp/p2.txt /tmp/c2.txt -o 0,1.2,2.2 | awk '$2!=$3 {printf "     %-42s producao %-9s cluster %s\n",$1,$2,$3}' | head -10
rm -f /tmp/lista.txt /tmp/p.txt /tmp/c.txt /tmp/alvo.txt /tmp/p2.txt /tmp/c2.txt
[ "$RESTO" = "0" ] && echo "   >>> reparado" || exit 1
REMOTO
