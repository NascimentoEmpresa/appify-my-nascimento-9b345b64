#!/bin/bash
# ============================================================================
#  Traz os DADOS de `auth` e `storage` da producao para o cluster.
#
#  POR QUE ISTO EXISTE SEPARADO DA REPLICACAO LOGICA
#
#  A publicacao do corte cobre o schema `public` -- 648 tabelas. Os schemas
#  `auth` e `storage` ficam de fora, e com eles as duas coisas sem as quais o
#  ERP nao abre:
#
#    auth.users      159 logins       <- sem isso ninguem entra
#    storage.objects 11.252 anexos    <- sem isso todo anexo vira link quebrado
#
#  (Medido em 13/10/2026. Nao da para por esses schemas na publicacao: as
#  tabelas pertencem a supabase_auth_admin / supabase_storage_admin, e mexer na
#  Supabase nisso e risco sem ganho -- aqui sao minutos de dump.)
#
#  AS DUAS ARMADILHAS, as duas descobertas na pratica em 13/10/2026
#
#  1. `COPY storage.objects FROM STDIN` FALHA sempre, com "extra data after
#     last expected column". Causa: `path_tokens` e coluna GERADA
#     (`GENERATED ALWAYS`), entao `copy (select * from ...) to stdout` manda 15
#     campos e o destino aceita 14. Vale para `auth.users.confirmed_at` e
#     `auth.identities.email` tambem. Solucao: pg_dump, que escreve a lista
#     explicita de colunas e deixa as geradas de fora. Nao trocar por
#     `copy ... select *` "para simplificar".
#
#  2. Os gatilhos `protect_objects_delete`, `protect_buckets_delete` e
#     `protect_bucket_control_insert` RECUSAM escrita direta:
#       ERROR: Direct deletion from storage tables is not allowed.
#              Use the Storage API instead.
#     Eles existem na producao e vieram no restore do schema. Solucao:
#     `session_replication_role = replica` na sessao da carga -- o mesmo
#     recurso que a propria replicacao logica usa, e que ja tinha sido
#     necessario no ETL do sistema antigo.
#
#  QUANDO RODAR
#  Na janela do corte, DEPOIS de congelar a escrita na producao (passo 2.1 do
#  roteiro) e DEPOIS da carga dos arquivos (carregar-anexos.sh). Antes disso,
#  pode rodar quantas vezes quiser para ensaiar: ele trunca e recarrega, e o
#  cluster ainda nao atende ninguem.
#
#  O QUE ELE NAO FAZ
#  Nao toca no schema `public` (isso e a replicacao logica) e nao escreve NADA
#  na producao -- so le.
#
#  USO (na maquina que alcanca a producao e o cluster -- banco1 ou banco2):
#    SENHA_SUPABASE=... SENHA_DESTINO=... bash carregar-auth-storage.sh
#    SENHA_SUPABASE=... SENHA_DESTINO=... bash carregar-auth-storage.sh --conferir
# ============================================================================
set -uo pipefail

SO_CONFERIR=0
[ "${1:-}" = "--conferir" ] && SO_CONFERIR=1

: "${SENHA_SUPABASE:?senha do postgres da producao}"
: "${SENHA_DESTINO:?senha do postgres do cluster}"

REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
ORIGEM_HOST="${ORIGEM_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
DESTINO_HOST="${DESTINO_HOST:-127.0.0.1}"
DESTINO_PORTA="${DESTINO_PORTA:-5000}"   # o HAProxy: sempre o primario
BANCO="${BANCO:-postgres}"
PGB="${PGB:-/usr/lib/postgresql/17/bin}"
SAIDA="${SAIDA:-/root/migracao}"
mkdir -p "$SAIDA"
DUMP="$SAIDA/auth-storage.sql"

log(){ echo "[$(date +%H:%M:%S)] $*"; }
P(){ PGPASSWORD="$SENHA_SUPABASE" psql -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d "$BANCO" -At "$@"; }
C(){ PGPASSWORD="$SENHA_DESTINO" psql -h "$DESTINO_HOST" -p "$DESTINO_PORTA" -U postgres -d "$BANCO" -At "$@"; }

# ── a lista de tabelas: tudo de auth e storage, menos o controle das imagens ─
# auth.schema_migrations e storage.migrations sao de quem gerencia a imagem do
# GoTrue e do storage-api. Sobrescrever isso faz a imagem achar que precisa
# aplicar migration de novo -- ja mordeu neste projeto.
EXCLUIR="auth.schema_migrations storage.migrations"

tabelas_do_cluster(){
  C -c "select n.nspname||'.'||quote_ident(c.relname)
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname in ('auth','storage') and c.relkind='r'
           and n.nspname||'.'||c.relname not in ('auth.schema_migrations','storage.migrations')
         order by 1;"
}

# A producao esta congelada? E o que decide se divergencia e erro ou e vida.
#
# A primeira versao disto tinha uma lista fixa de tabelas "volateis"
# (refresh_tokens, sessions...) -- e errou na hora: em 13/10/2026 a conferencia
# acusou storage.objects divergindo em 2, porque DUAS PESSOAS ANEXARAM ARQUIVO
# nos treze minutos entre a carga e a conferencia. Toda tabela anda enquanto a
# producao atende; o que muda e o ritmo.
#
# O sinal honesto e o congelamento do passo 2.1 do roteiro: enquanto
# `authenticated` ainda puder gravar em public, divergencia e esperada; depois
# do REVOKE, qualquer divergencia e defeito.
producao_congelada(){
  local n
  n=$(P -c "select count(*) from information_schema.role_table_grants
             where grantee='authenticated' and privilege_type='INSERT'
               and table_schema='public';" 2>/dev/null)
  [ "${n:-1}" = "0" ]
}

confere(){
  local congelada=0
  producao_congelada && congelada=1
  echo
  if [ "$congelada" = "1" ]; then
    echo "  escrita na producao: CONGELADA (passo 2.1) -- aqui tudo tem que bater"
  else
    echo "  escrita na producao: ATIVA -- divergencia e vida, nao defeito"
  fi
  echo
  printf '  %-32s %10s %10s  %s\n' "tabela" "producao" "cluster" ""
  local difere=0 andou=0
  for t in auth.users auth.identities auth.sessions auth.refresh_tokens auth.mfa_amr_claims \
           auth.one_time_tokens storage.buckets storage.objects; do
    local a b marca
    a=$(P -c "select count(*) from $t;" 2>/dev/null)
    b=$(C -c "select count(*) from $t;" 2>/dev/null)
    marca="ok"
    if [ "$a" != "$b" ]; then
      if [ "$congelada" = "1" ]; then
        marca="DIFERE"
        difere=$((difere+1))
      else
        marca="+$((a - b)) na producao desde a carga"
        andou=$((andou+1))
      fi
    fi
    printf '  %-32s %10s %10s  %s\n' "$t" "${a:-?}" "${b:-?}" "$marca"
  done
  local sa sb
  sa=$(P -c "select last_value from pg_sequences where schemaname='auth' and sequencename='refresh_tokens_id_seq';")
  sb=$(C -c "select last_value from pg_sequences where schemaname='auth' and sequencename='refresh_tokens_id_seq';")
  printf '  %-32s %10s %10s  %s\n' "seq refresh_tokens_id_seq" "${sa:-?}" "${sb:-?}" \
    "$([ "${sa:-x}" = "${sb:-y}" ] && echo ok || echo "producao andou")"
  echo
  if [ "$difere" -gt 0 ]; then
    echo "  >>> $difere tabela(s) divergindo COM A ESCRITA CONGELADA -- isto e defeito."
    echo "      Rodar a carga de novo antes de seguir para o passo 2.4."
    return 1
  fi
  if [ "$andou" -gt 0 ]; then
    echo "  >>> auth e storage carregados. $andou tabela(s) ja andaram na producao"
    echo "      desde a carga -- esperado com o ERP no ar. Na janela, depois do"
    echo "      congelamento, rodar de novo: ai tem que bater tudo."
    return 0
  fi
  echo "  >>> auth e storage iguais a producao, tabela por tabela"
  return 0
}

if [ $SO_CONFERIR -eq 1 ]; then
  log "conferindo (nada sera escrito)"
  confere
  exit $?
fi

# ── 1. dump da producao (leitura pura) ──────────────────────────────────────
log "dump de auth e storage da producao"
ARGS=(--data-only --no-owner --no-privileges --schema=auth --schema=storage)
for t in $EXCLUIR; do ARGS+=(--exclude-table-data="$t"); done
PGPASSWORD="$SENHA_SUPABASE" "$PGB/pg_dump" \
  -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d "$BANCO" "${ARGS[@]}" -f "$DUMP" || {
    echo "pg_dump falhou -- nada foi alterado no cluster" >&2; exit 1; }
log "dump: $(du -h "$DUMP" | cut -f1)"

# A prova de que a armadilha 1 esta resolvida: path_tokens NAO aparece na
# lista de colunas do COPY de storage.objects.
if grep -q "COPY storage.objects.*path_tokens" "$DUMP"; then
  echo "ERRO: o dump incluiu path_tokens (coluna gerada) -- a carga vai falhar" >&2
  exit 1
fi
log "conferido: o COPY de storage.objects deixou a coluna gerada de fora"

# ── 2. a carga, numa transacao so, com os gatilhos de lado ─────────────────
LISTA=$(tabelas_do_cluster | paste -sd, -)
[ -n "$LISTA" ] || { echo "nao consegui listar as tabelas do cluster" >&2; exit 1; }

CARGA="$SAIDA/carga-auth-storage.sql"
{
  echo "BEGIN;"
  # replica: desliga os gatilhos protect_* e tambem a checagem de chave
  # estrangeira, o que torna a ORDEM das tabelas irrelevante.
  echo "SET LOCAL session_replication_role = replica;"
  # ── DELETE, NUNCA `TRUNCATE ... CASCADE` ────────────────────────────────
  #
  # O QUE O CASCADE FEZ AQUI, EM 17/10/2026, NA NOITE DA VIRADA
  # Esta linha era `TRUNCATE $LISTA CASCADE;`. O CASCADE do TRUNCATE **nao
  # para no schema**: ele desce por TODA chave estrangeira que aponte para as
  # tabelas limpas. Como meio ERP referencia `auth.users` (quem criou, quem
  # aprovou, quem assinou), o comando esvaziou **269 tabelas de `public`** --
  # Suprimentos inteiro, os 65 vinculos de Discord, e as tres tabelas de
  # perfil, que tiraram o administrador do Eduardo.
  #
  # E foi calado: TRUNCATE CASCADE nao reclama, e a conferencia deste script
  # so olha `auth` e `storage`, onde tudo batia. O defeito apareceu pelo
  # unico caminho que sobrou -- uma pessoa entrando no ERP e vendo menos
  # menus do que devia.
  #
  # `DELETE` nao tem CASCADE. Com `session_replication_role = replica` as
  # checagens de FK estao desligadas, entao apagar `auth.users` sem mexer em
  # quem o referencia e exatamente o que queremos: as linhas de `public`
  # ficam, e o dump logo abaixo repoe `auth` e `storage`.
  #
  # Mais lento que TRUNCATE? Sim, alguns segundos em 50 mil linhas. Barato.
  for T in $(echo "$LISTA" | tr ',' ' '); do
    echo "DELETE FROM $T;"
  done
  echo "\\i $DUMP"
  echo "SELECT setval('auth.refresh_tokens_id_seq', GREATEST((select coalesce(max(id),1) from auth.refresh_tokens), 1), true);"
  echo "COMMIT;"
} > "$CARGA"

log "carregando no cluster ($DESTINO_HOST:$DESTINO_PORTA)"
SAIDA_PSQL="$SAIDA/carga-auth-storage.log"
PGPASSWORD="$SENHA_DESTINO" psql -h "$DESTINO_HOST" -p "$DESTINO_PORTA" -U postgres -d "$BANCO" \
  -v ON_ERROR_STOP=1 -e -f "$CARGA" > "$SAIDA_PSQL" 2>&1
RC=$?

# A trava do psql que ja custou caro aqui: meta-comando pode engolir o BEGIN e
# o script inteiro rodar em autocommit sem avisar. Se nao houver BEGIN e COMMIT
# na saida, nao houve transacao -- e isso precisa aparecer.
grep -q '^BEGIN' "$SAIDA_PSQL"  || echo "AVISO: nao vi BEGIN na saida -- rodou em autocommit?"
grep -q '^COMMIT' "$SAIDA_PSQL" || echo "AVISO: nao vi COMMIT na saida"

if [ $RC -ne 0 ]; then
  echo "a carga falhou -- veja $SAIDA_PSQL" >&2
  tail -5 "$SAIDA_PSQL" >&2
  exit 1
fi
log "carga concluida"

# ── 3. conferencia ─────────────────────────────────────────────────────────
confere
