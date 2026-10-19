#!/usr/bin/env bash
# ============================================================================
#  AS TABELAS QUE O SINCRONIZADOR DE SCHEMA NAO CRIA
#
#  O BURACO (achado na noite da virada, 16/10/2026)
#  `sincronizar-colunas.sh` acrescenta COLUNA em tabela que ja existe.
#  `sincronizar-schema.sh` acerta FUNCAO, VIEW, TRIGGER, INDICE, CHECK e
#  NOT NULL. Nenhum dos dois **cria tabela nova** -- e a producao criou 19
#  desde a ultima sincronia.
#
#  O sintoma nao e silencioso, e foi assim que apareceu: o
#  `sincronizar-schema.sh --aplicar` quebrou no meio com
#  `relation "FIN_JUROS_IMPORTADO" does not exist`, porque uma VIEW nova lia
#  uma TABELA nova. A transacao inteira voltou atras (o script e de uma
#  transacao so, e isso salvou a noite).
#
#  POR QUE NAO DA PARA IGNORAR E SEGUIR
#  A recopia (`religar-replicacao.sh`) copia o que esta na PUBLICACAO da
#  producao. Tabela que nao existe no cluster faz a assinatura entrar em erro
#  naquela tabela -- e o pior: as outras continuam, entao a copia parece ter
#  dado certo e o dado daquela tabela nunca chega.
#
#  COMO ELE FAZ
#  `pg_dump --schema-only` da producao, so das tabelas que faltam, aplicado no
#  cluster numa transacao unica. O dump leva indice, constraint, default e os
#  GRANT -- e e justamente por causa dos GRANT que o REVOKE da secao 1.9 e
#  reaplicado no fim: tabela nova chega com `GRANT ALL TO anon, authenticated`
#  e abriria escrita direta no cluster sem ninguem pedir.
#
#  USO
#    bash infra/ha/tabelas-que-faltam.sh --conferir
#    bash infra/ha/tabelas-que-faltam.sh --aplicar
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
case "$ACAO" in --conferir|--aplicar|--politicas|--publicacao) : ;; *) sed -n '2,33p' "$0"; exit 2 ;; esac

ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
    -o StrictHostKeyChecking=accept-new "root@$BANCO1" \
    "SENHA='$PW' REF='$REF' ORIGEM_HOST='$ORIGEM_HOST' ACAO='$ACAO' CONFIRMA='${CONFIRMA:-}' bash -s" <<'REMOTO'
set -uo pipefail
BIN=/usr/lib/postgresql/17/bin
SUP=$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
P() { PGPASSWORD="$SENHA" psql -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres -At "$@"; }
C() { PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At "$@"; }

# `order by 1` do Postgres usa a collation do banco (acentos e maiusculas
# agrupados); `comm` exige ordem de BYTE. Misturar os dois faz o comm cuspir
# "input is not in sorted order" e devolver lista ERRADA -- com o numero certo
# de itens, o que e pior ainda. Entao a ordenacao que vale e a do `sort` com
# LC_ALL=C, nos dois lados.
LISTA_P=$(P -c "select tablename from pg_tables where schemaname='public'" | LC_ALL=C sort)
LISTA_C=$(C -c "select tablename from pg_tables where schemaname='public'" | LC_ALL=C sort)
FALTAM=$(LC_ALL=C comm -23 <(printf '%s\n' "$LISTA_P") <(printf '%s\n' "$LISTA_C"))
SOBRAM=$(LC_ALL=C comm -13 <(printf '%s\n' "$LISTA_P") <(printf '%s\n' "$LISTA_C"))

echo "producao: $(printf '%s\n' "$LISTA_P" | grep -c .) tabelas   cluster: $(printf '%s\n' "$LISTA_C" | grep -c .)"
echo
echo "FALTAM no cluster ($(printf '%s\n' "$FALTAM" | grep -c .)):"
printf '%s\n' "$FALTAM" | sed '/^$/d;s/^/   /'
if [ -n "$(printf '%s\n' "$SOBRAM" | sed '/^$/d')" ]; then
  echo
  echo "SO NO CLUSTER ($(printf '%s\n' "$SOBRAM" | grep -c .)) -- nao serao tocadas:"
  printf '%s\n' "$SOBRAM" | sed '/^$/d;s/^/   /'
fi

# ── 3a FASE: por as tabelas novas na PUBLICACAO da producao ────────────────
#
#  POR QUE ISTO E OBRIGATORIO, e nao "mais um conferidor"
#  A assinatura copia e replica o que esta na PUBLICACAO. Uma publicacao
#  criada por lista (a nossa) NAO ganha tabela nova sozinha -- quem cria
#  tabela na producao nao sabe que existe um cluster do outro lado.
#  Tabela fora da publicacao nao da erro: ela simplesmente fica VAZIA no
#  cluster para sempre, e a replicacao continua verde.
#
#  O QUE FICA DE FORA DE PROPOSITO
#    . tabelas de backup (BKP/bkp_/_backup_) -- nenhuma tem chave primaria, e
#      sem PK a replicacao nao consegue replicar UPDATE/DELETE
#    . particoes de audit_log -- entram pela tabela-mae
if [ "$ACAO" = "--publicacao" ]; then
  PUB="${PUB:-erp_corte}"
  CAND=$(P -c "
    select t.tablename from pg_tables t
     where t.schemaname='public'
       and not exists (select 1 from pg_publication_tables p
                       where p.pubname='$PUB' and p.schemaname='public' and p.tablename=t.tablename)
       and exists (select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid
                   join pg_namespace n on n.oid=r.relnamespace
                   where n.nspname='public' and r.relname=t.tablename and c.contype='p')
       and t.tablename !~ '(?i)(bkp|backup|_bkp_|removidos)'
       and t.tablename !~ '^audit_log'
     order by 1")
  N=$(printf '%s\n' "$CAND" | sed '/^$/d' | wc -l)
  echo "== publicacao '$PUB': $(P -c "select count(*) from pg_publication_tables where pubname='$PUB'") tabelas"
  echo "== com PK, em public, FORA da publicacao: $N"
  printf '%s\n' "$CAND" | sed '/^$/d;s/^/   /'
  [ "$N" -gt 0 ] || { echo "   nada a fazer"; exit 0; }
  if [ "${CONFIRMA:-}" != "sim" ]; then
    echo
    echo "   Isto ESCREVE NA PRODUCAO (ALTER PUBLICATION, so catalogo)."
    echo "   Para fazer:  CONFIRMA=sim bash infra/ha/tabelas-que-faltam.sh --publicacao"
    exit 0
  fi
  # lock_timeout: ALTER PUBLICATION pega ShareUpdateExclusive na tabela. Nao
  # bloqueia leitura nem escrita comum, mas se ficar na fila atras de outro
  # DDL, ESPERA -- e esperar na producao e o que ja travou duas telas por 63 s.
  LISTA=$(printf '%s\n' "$CAND" | sed '/^$/d' | awk '{printf "%spublic.\"%s\"", (NR>1?", ":""), $0}')
  if P -c "set lock_timeout='5s'; ALTER PUBLICATION $PUB ADD TABLE $LISTA;" >/dev/null 2>&1; then
    echo "   ok -- publicacao agora com $(P -c "select count(*) from pg_publication_tables where pubname='$PUB'") tabelas"
  else
    echo "   FALHOU (provavelmente lock_timeout). Nenhuma foi adicionada." >&2; exit 1
  fi
  exit 0
fi

# ── 2a FASE: gatilhos e politicas, depois que as funcoes existem ───────────
if [ "$ACAO" = "--politicas" ]; then
  # Aqui a lista nao e "tabela que falta" (elas ja existem): e "tabela que tem
  # politica na producao e NENHUMA no cluster". Mais geral e mais honesto --
  # pega tambem qualquer tabela que tenha ficado sem politica por outro motivo.
  # Comparar por POLITICA, nao por tabela. Comparar por tabela deixa para tras
  # a politica que falta numa tabela que ja tem outras -- foram 16 assim em
  # 16/10, e politica de RLS faltando nao da erro: da LINHA A MENOS na tela,
  # ou linha a mais. Nenhum dos dois grita.
  PARES_P=$(P -c "select tablename||'|'||policyname from pg_policies where schemaname='public'" | LC_ALL=C sort)
  PARES_C=$(C -c "select tablename||'|'||policyname from pg_policies where schemaname='public'" | LC_ALL=C sort)
  FALTA_POL=$(LC_ALL=C comm -23 <(printf '%s\n' "$PARES_P") <(printf '%s\n' "$PARES_C"))
  N=$(printf '%s\n' "$FALTA_POL" | sed '/^$/d' | wc -l)
  echo
  echo "== politicas que faltam no cluster: $N"
  printf '%s\n' "$FALTA_POL" | sed '/^$/d;s/^/   /' | head -40
  [ "$N" -gt 0 ] || { echo "   nada a fazer"; exit 0; }
  SEM=$(printf '%s\n' "$FALTA_POL" | cut -d'|' -f1 | LC_ALL=C sort -u)
  echo "   em $(printf '%s\n' "$SEM" | sed '/^$/d' | wc -l) tabelas"

  ARGS=(); while read -r T; do [ -n "$T" ] && ARGS+=(-t "public.\"$T\""); done <<< "$SEM"
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  PGPASSWORD="$SENHA" "$BIN/pg_dump" -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres \
    --schema-only --no-owner "${ARGS[@]}" > "$TMP/tudo.sql" 2>/dev/null || { echo "falhou o pg_dump" >&2; exit 1; }
  # SO as politicas. Os gatilhos ja vieram no `sincronizar-schema.sh --aplicar`
  # do passo anterior -- conferido na pratica em 16/10: esta fase quebrou com
  # `trigger "implantacao_base_doc_touch" ... already exists`, o que e uma boa
  # noticia disfarcada de erro (quer dizer que o passo anterior fez o trabalho).
  # Do dump dessas tabelas, guardar SO as politicas que faltam -- as que ja
  # existem no cluster dariam "already exists" e derrubariam a transacao
  # inteira, levando junto as que faltavam.
  printf '%s\n' "$FALTA_POL" | sed '/^$/d' > "$TMP/faltam.txt"
  awk -v lista="$TMP/faltam.txt" '
    BEGIN { while ((getline l < lista) > 0) { split(l, p, "|"); quero[p[2] "@" p[1]] = 1 } }
    /^CREATE POLICY/ {
      # CREATE POLICY "nome" ON public."TABELA" ...
      linha = $0
      nome = linha; sub(/^CREATE POLICY /, "", nome); sub(/ ON .*/, "", nome); gsub(/"/, "", nome)
      tab = linha; sub(/^.* ON public\./, "", tab); sub(/[ (].*$/, "", tab); gsub(/"/, "", tab)
      guardando = (quero[nome "@" tab] == 1)
    }
    guardando { print; if (/;[[:space:]]*$/) guardando = 0 }
  ' "$TMP/tudo.sql" > "$TMP/pol.sql"
  echo "   $(grep -c '^CREATE POLICY' "$TMP/pol.sql") politicas a aplicar (de $N que faltam)"
  [ -s "$TMP/pol.sql" ] || { echo "   nada extraido -- nao aplico" >&2; exit 1; }

  if PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres \
       -v ON_ERROR_STOP=1 -1 -q -f "$TMP/pol.sql" 2>"$TMP/e"; then
    echo "   ok"
  else
    echo "   FALHOU -- nada aplicado:"; sed 's/^/     /' "$TMP/e" | head -6; exit 1
  fi
  C -c "REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;" >/dev/null
  C -c "NOTIFY pgrst, 'reload schema';" >/dev/null
  echo
  echo "== politicas de RLS, os dois lados"
  echo "   producao: $(P -c "select count(*) from pg_policies where schemaname='public'")   cluster: $(C -c "select count(*) from pg_policies where schemaname='public'")"
  exit 0
fi

[ -n "$(printf '%s\n' "$FALTAM" | sed '/^$/d')" ] || { echo; echo "Nada a fazer."; exit 0; }
if [ "$ACAO" = "--conferir" ]; then
  echo; echo "Para criar:  bash infra/ha/tabelas-que-faltam.sh --aplicar"; exit 0
fi

ARGS=(); while read -r T; do [ -n "$T" ] && ARGS+=(-t "public.\"$T\""); done <<< "$FALTAM"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo
echo "== pegando o DDL da producao (schema-only, so essas tabelas)"
PGPASSWORD="$SENHA" "$BIN/pg_dump" -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres \
  --schema-only --no-owner "${ARGS[@]}" > "$TMP/novas.sql" 2>"$TMP/erro" || {
  echo "   falhou o pg_dump:"; sed 's/^/     /' "$TMP/erro" | head -5; exit 1; }
echo "   $(grep -c '^CREATE TABLE' "$TMP/novas.sql") CREATE TABLE, $(wc -l < "$TMP/novas.sql") linhas"
[ "$(grep -c '^CREATE TABLE' "$TMP/novas.sql")" -gt 0 ] || { echo "   dump sem CREATE TABLE -- nao aplico"; exit 1; }

# ── tirar os CREATE TRIGGER, e por que ──────────────────────────────────────
# Tabela nova vem com gatilho, e o gatilho chama uma FUNCAO que ainda nao
# existe no cluster -- ela entra no passo seguinte (sincronizar-schema.sh).
# Sem isto, o dump quebra com `function public.implantacao_base_touch() does
# not exist` e, como e transacao unica, NADA e criado: as tabelas ficam
# faltando e a recopia copiaria para o vazio.
# A ordem certa e: tabela (sem gatilho) -> funcao -> gatilho. O
# `sincronizar-schema.sh` faz os dois ultimos, e e ele que tem que rodar
# DEPOIS deste script.
# E o mesmo vale para CREATE POLICY: a politica de RLS da tabela nova chama
# `implantacao_base_pode_escrever()`, que tambem so existe depois.
#
# DEIXAR A POLITICA DE FORA E SEGURO, e vale dizer por que: o
# `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` CONTINUA no dump. Tabela com RLS
# ligada e nenhuma politica **nega tudo** -- ela nasce fechada, nao aberta. O
# risco seria o contrario: criar a tabela sem ligar a RLS.
awk '
  /^CREATE TRIGGER/ || /^CREATE POLICY/ { pulando=1 }
  pulando { if (/;[[:space:]]*$/) pulando=0; next }
  { print }
' "$TMP/novas.sql" > "$TMP/so-tabela.sql"
QTD_TRG=$(grep -c '^CREATE TRIGGER' "$TMP/novas.sql")
QTD_POL=$(grep -c '^CREATE POLICY' "$TMP/novas.sql")
QTD_RLS=$(grep -c 'ENABLE ROW LEVEL SECURITY' "$TMP/so-tabela.sql")
mv "$TMP/so-tabela.sql" "$TMP/novas.sql"
echo "   $QTD_TRG gatilho(s) e $QTD_POL politica(s) ficam para a 2a fase"
echo "   $QTD_RLS tabelas entram com RLS LIGADA (sem politica = nega tudo)"

echo "== aplicando no cluster, em UMA transacao"
# ON_ERROR_STOP + -1: ou entra tudo, ou nao entra nada. Meia tabela criada e
# pior que nenhuma -- a assinatura copiaria para uma estrutura incompleta.
if PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres \
     -v ON_ERROR_STOP=1 -1 -q -f "$TMP/novas.sql" 2>"$TMP/erro2"; then
  echo "   ok"
else
  echo "   FALHOU -- nada foi aplicado:"; sed 's/^/     /' "$TMP/erro2" | head -8; exit 1
fi

# Tabela nova chega com GRANT ALL para anon/authenticated (vem do dump). Sem
# isto, o cluster passaria a aceitar escrita direta nessas tabelas enquanto
# ainda e copia. Ver secao 1.9 do roteiro.
echo "== reaplicando o REVOKE da secao 1.9"
C -c "REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;" >/dev/null
C -c "NOTIFY pgrst, 'reload schema';" >/dev/null
echo "   permissoes de escrita no cluster agora: $(C -c "select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE') and table_schema='public'")  (tem que ser 0)"

echo
echo "== conferindo"
echo "   producao: $(P -c "select count(*) from pg_tables where schemaname='public'")   cluster: $(C -c "select count(*) from pg_tables where schemaname='public'")"
echo
echo "FALTA A 2a FASE, nesta ordem:"
echo "   1. bash infra/ha/disparar-schema.sh --aplicar          (cria as funcoes)"
echo "   2. bash infra/ha/tabelas-que-faltam.sh --politicas     (gatilhos e politicas)"
echo "Ate a fase 2, as tabelas novas estao com RLS ligada e nenhuma politica:"
echo "negam tudo. Fechado demais e o lado certo de errar."
REMOTO
