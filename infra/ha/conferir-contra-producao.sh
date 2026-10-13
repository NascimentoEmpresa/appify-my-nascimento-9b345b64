#!/bin/bash
# Compara o cluster com a producao VIVA, objeto por objeto.
#
# POR QUE ISTO SUBSTITUIU A CONFERENCIA ANTIGA
# A conferencia anterior comparava contagens contra numeros fixos anotados em
# 08/10/2026. Duas coisas deram errado com isso:
#
#   1. a producao andou (647 tabelas viraram 656) e toda linha passou a dizer
#      "DIFERE" sem nada estar errado -- aviso que sempre grita vira aviso que
#      ninguem le;
#   2. ela contava tabela, politica e funcao. Nao contava INDICE nem ATRIBUTO
#      DE PAPEL. E foi exatamente por ai que dois defeitos passaram:
#        - service_role sem BYPASSRLS e supabase_storage_admin fora de
#          authenticator: TODA chamada ao storage voltava 400 dizendo
#          "new row violates row-level security policy" -- mentira do
#          storage-api, que traduz qualquer 42501 nessa frase;
#        - a producao derrubou o indice unico (bucket_id, name) na migration 72
#          e a imagem v1.11.13 ainda o exigia: upload morria com 42P10.
#
# A licao: atributo de papel e participacao de papel NAO VEM em dump de schema.
# pg_dump le objetos; pg_authid e pg_auth_members ficam fora. Quem restaura
# schema e acha que terminou, nao terminou.
#
# COMO USAR (nao escreve nada em lugar nenhum, so le os dois lados):
#   SENHA_SUPABASE=... SENHA_DESTINO=... ./infra/ha/conferir-contra-producao.sh
set -u

: "${SENHA_SUPABASE:?senha do postgres da producao}"
: "${SENHA_DESTINO:?senha do postgres do cluster}"
ORIGEM_HOST="${ORIGEM_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
DESTINO_HOST="${DESTINO_HOST:-127.0.0.1}"
DESTINO_PORTA="${DESTINO_PORTA:-5000}"   # o HAProxy: sempre o primario
BANCO="${BANCO:-postgres}"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

P(){ PGPASSWORD="$SENHA_SUPABASE" psql -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d "$BANCO" -At "$@"; }
C(){ PGPASSWORD="$SENHA_DESTINO"  psql -h "$DESTINO_HOST" -p "$DESTINO_PORTA" -U postgres -d "$BANCO" -At "$@"; }

# ── contagens: numero contra numero, os dois lidos agora ────────────────────
cat > "$T/contagens.sql" <<'SQL'
select 'tabelas em public',   count(*)::text from pg_tables where schemaname='public'
union all select 'politicas de RLS',   count(*)::text from pg_policies where schemaname='public'
union all select 'tabelas com RLS',    count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity
union all select 'funcoes em public',  count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
union all select 'views',              count(*)::text from pg_views where schemaname='public'
union all select 'sequences',          count(*)::text from pg_sequences where schemaname='public'
union all select 'triggers',           count(*)::text from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace where not g.tgisinternal and n.nspname='public'
union all select 'tabelas em auth',    count(*)::text from pg_tables where schemaname='auth'
union all select 'tabelas em storage', count(*)::text from pg_tables where schemaname='storage'
union all select 'migrations de auth', count(*)::text from auth.schema_migrations
union all select 'migrations de storage', count(*)::text from storage.migrations
union all select 'tabelas que anon le',count(*)::text from information_schema.role_table_grants where grantee='anon' and privilege_type='SELECT' and table_schema='public'
order by 1;
SQL

# ── conjuntos: a diferenca exata, nao a quantidade ─────────────────────────
cat > "$T/indices.sql" <<'SQL'
select schemaname||'.'||tablename||' :: '||regexp_replace(indexdef,'^CREATE (UNIQUE )?INDEX [^ ]+ ON ','CREATE \1INDEX ON ')
  from pg_indexes where schemaname in ('public','auth','storage','extensions');
SQL
cat > "$T/restricoes.sql" <<'SQL'
select n.nspname||'.'||t.relname||' :: '||pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
 where n.nspname in ('public','auth','storage');
SQL
cat > "$T/papeis.sql" <<'SQL'
select rolname||' :: login='||rolcanlogin::text||' inherit='||rolinherit::text
       ||' bypassrls='||rolbypassrls::text||' createrole='||rolcreaterole::text
       ||' createdb='||rolcreatedb::text||' repl='||rolreplication::text
  from pg_roles where rolname not like 'pg\_%' and rolname <> 'replicator'
union all
select 'PARTICIPACAO :: '||m.rolname||' -> '||r.rolname
  from pg_auth_members am join pg_roles r on r.oid=am.roleid join pg_roles m on m.oid=am.member
 where r.rolname not like 'pg\_%' and m.rolname not like 'pg\_%';
SQL

falhas=0
echo "=========== CONTAGENS (producao x cluster) ==========="
P -f "$T/contagens.sql" | sort > "$T/cp.txt"
C -f "$T/contagens.sql" | sort > "$T/cc.txt"
while IFS='|' read -r nome prod; do
  clus=$(grep -F "$nome|" "$T/cc.txt" | cut -d'|' -f2)
  if [ "$prod" = "$clus" ]; then
    printf "  %-24s %7s = %-7s ok\n" "$nome" "$prod" "$clus"
  else
    printf "  %-24s %7s = %-7s  <<< DIFERE\n" "$nome" "$prod" "$clus"; falhas=$((falhas+1))
  fi
done < "$T/cp.txt"

# Divergencia DELIBERADA, nao defeito: papel que nenhum servico da pilha usa
# nasce sem LOGIN de proposito. O dump traz o papel porque objetos referenciam
# o nome; dar login a ele seria abrir porta sem ninguem do outro lado. Mantido
# aqui por nome para o relatorio nao gritar toda vez -- aviso que sempre grita
# e aviso que ninguem le.
DELIBERADO='^(cli_login_postgres|dashboard_user|pgbouncer|supabase_admin|supabase_etl_admin|supabase_functions_admin|supabase_privileged_role|supabase_read_only_user|supabase_replication_admin) ::|^PARTICIPACAO :: (cli_login_postgres|supabase_etl_admin|postgres) ->'

# Compara CONJUNTOS, nao quantidades: o que interessa e qual objeto falta, nao
# quantos. Normaliza parenteses e espacos antes, porque o Postgres reimprime a
# mesma regra de CHECK com parenteses diferentes conforme a versao e isso
# aparecia como uma linha "falta" + uma linha "sobra" para a MESMA restricao.
mapa(){ awk '{ n=$0; gsub(/[()[:space:]]/,"",n); print n "\t" $0 }' "$1" | sort -u; }

for par in "INDICES indices" "RESTRICOES restricoes" "PAPEIS papeis"; do
  set -- $par
  echo
  echo "=========== $1 ==========="
  P -f "$T/$2.sql" | sort -u > "$T/p-$2.txt"
  C -f "$T/$2.sql" | sort -u > "$T/c-$2.txt"
  mapa "$T/p-$2.txt" > "$T/pm.txt"; mapa "$T/c-$2.txt" > "$T/cm.txt"
  falta=$(comm -23 <(cut -f1 "$T/pm.txt") <(cut -f1 "$T/cm.txt") | while read -r n; do
            awk -F'\t' -v k="$n" '$1==k{print $2; exit}' "$T/pm.txt"; done)
  sobra=$(comm -13 <(cut -f1 "$T/pm.txt") <(cut -f1 "$T/cm.txt") | while read -r n; do
            awk -F'\t' -v k="$n" '$1==k{print $2; exit}' "$T/cm.txt"; done)
  # separa o que ja foi decidido do que e novidade
  falta_real=$(echo "$falta" | grep -vE "$DELIBERADO" | grep -v '^$')
  sobra_real=$(echo "$sobra" | grep -vE "$DELIBERADO" | grep -v '^$')
  deliberadas=$( { echo "$falta"; echo "$sobra"; } | grep -cE "$DELIBERADO")
  if [ -z "$falta_real" ] && [ -z "$sobra_real" ]; then
    echo "  identico ($(wc -l < "$T/p-$2.txt") itens)"
  else
    [ -n "$falta_real" ] && { echo "  FALTA NO CLUSTER:"; echo "$falta_real" | sed 's/^/    - /'; falhas=$((falhas+1)); }
    [ -n "$sobra_real" ] && { echo "  SO NO CLUSTER:";    echo "$sobra_real" | sed 's/^/    + /'; falhas=$((falhas+1)); }
  fi
  [ "$deliberadas" -gt 0 ] && echo "  (+ $deliberadas divergencia(s) deliberada(s), ver DELIBERADO no topo do script)"
done

echo
if [ "$falhas" -eq 0 ]; then
  echo "TUDO IGUAL. Pode seguir."
else
  echo "$falhas bloco(s) com diferenca. NAO seguir para a copia de dados antes de entender cada uma."
  echo "Diferenca de DONO de objeto e esperada e inofensiva: --no-owner e proposital."
fi
exit 0
