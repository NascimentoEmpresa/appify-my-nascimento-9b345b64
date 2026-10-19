#!/usr/bin/env bash
# ============================================================================
#  O NO APLICA AS MIGRATIONS DO `main`, SOZINHO  (vai para /usr/local/sbin)
#
#  O QUE MUDOU, E POR QUE AGORA PODE
#  Ate 19/10/2026 a migration so AVISAVA: o CI mandava DM e alguem rodava
#  `aplicar-migration.sh` na mao. A razao era boa -- um `ALTER TABLE` que
#  espera nao espera quieto, ele entra na fila e passa a BARRAR as leituras
#  que chegam depois (63 segundos de duas telas travadas, em 2026).
#
#  O Eduardo pediu que passasse a rodar no merge. O risco acima e real, entao
#  ele nao foi ignorado: foi CERCADO. Cada arquivo entra assim:
#
#    1. `lock_timeout` (5 s por padrao). Se a tabela estiver em uso, a
#       migration DESISTE em vez de entrar na fila e travar o ERP. Ela volta
#       como pendente e entra na proxima rodada, ou na mao, fora do pico.
#    2. UMA transacao por arquivo. Ou entra inteira, ou nao entra nada.
#       Meia migration e o pior estado possivel: o codigo novo encontra a
#       coluna que existe e a constraint que nao.
#    3. Para no PRIMEIRO erro. Migrations sao ordenadas e costumam depender
#       uma da outra; seguir em frente depois de uma falha aplica a 0231 num
#       banco onde a 0230 nao entrou.
#    4. Registra em `supabase_migrations.schema_migrations`. Rodar duas vezes
#       nao aplica duas vezes.
#
#  O QUE ESTE SCRIPT **NAO** ACEITA
#  Ele nao recebe SQL de ninguem. Ele le os arquivos do clone do `main` do
#  repositorio PUBLICO. Quem dispara (a chave restrita do CI) nao consegue
#  mandar um comando, so dizer "aplique o que esta no main" -- e no main so
#  entra o que passou pela portaria e pelo merge.
#
#  ARQUIVO SEM VERSAO NUMERICA E IGNORADO
#  Existe `20260612000005_grant_eduardo_todos_menus copy.sql` no repositorio
#  -- uma copia com espaco no nome. Sem versao numerica propria, ela seria
#  reaplicada em toda rodada. Aqui so entra arquivo cujo nome COMECA com
#  digitos, e o laco usa `find -print0`: nome com espaco nao se parte em dois.
#
#  USO (no no; normalmente chamado pelo CI)
#    /usr/local/sbin/aplicar-migrations.sh --conferir   # so lista
#    /usr/local/sbin/aplicar-migrations.sh
#    LOCK=30s /usr/local/sbin/aplicar-migrations.sh     # fora do horario
# ============================================================================
set -uo pipefail

REPO="${REPO:-https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64.git}"
RAMO="${RAMO:-main}"
TRABALHO="${TRABALHO:-/opt/erp-repo}"
ENV_ARQ="${ENV_ARQ:-/opt/erp/infra/failover/.env}"
LOCK="${LOCK:-5s}"
ACAO="${1:-}"

log() { echo "[$(date +%H:%M:%S)] $*"; }

# Duas rodadas ao mesmo tempo aplicariam o mesmo arquivo duas vezes na janela
# entre "ler o que falta" e "registrar". Dois merges seguidos fazem isso.
exec 9>/var/lock/aplicar-migrations.lock
flock -n 9 || { echo "ja ha uma rodada em andamento -- saindo"; exit 0; }

SUP=$(grep -m1 '^PG_SENHA_SUPER=' "$ENV_ARQ" 2>/dev/null | cut -d= -f2-)
[ -n "$SUP" ] || { echo "nao consegui ler PG_SENHA_SUPER de $ENV_ARQ" >&2; exit 1; }
# Porta 5000 = HAProxy, que sempre aponta para o lider. DDL no standby seria
# recusado ("cannot execute in a read-only transaction") -- e so aqui o erro
# seria claro; em outros caminhos ele vira silencio.
Q() { PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At -c "$1"; }

# ── 1. trazer o main ───────────────────────────────────────────────────────
if [ -d "$TRABALHO/.git" ]; then
  git -C "$TRABALHO" fetch --depth 1 -q origin "$RAMO" || { echo "fetch falhou" >&2; exit 1; }
  git -C "$TRABALHO" reset --hard -q "origin/$RAMO"  || { echo "reset falhou" >&2; exit 1; }
else
  git clone --depth 1 -b "$RAMO" -q "$REPO" "$TRABALHO" || { echo "clone falhou" >&2; exit 1; }
fi
log "main em $(git -C "$TRABALHO" log -1 --format='%h %s' | cut -c1-70)"

DIR="$TRABALHO/supabase/migrations"
[ -d "$DIR" ] || { echo "$DIR nao existe" >&2; exit 1; }

# ── 2. o que ja esta registrado ────────────────────────────────────────────
Q "create schema if not exists supabase_migrations;
   create table if not exists supabase_migrations.schema_migrations
     (version text primary key, statements text[], name text)" >/dev/null
Q "select version from supabase_migrations.schema_migrations" | LC_ALL=C sort -u > /tmp/.mig-aplicadas

# ── 2b. DOIS ARQUIVOS COM O MESMO NUMERO = UM DELES NUNCA ENTRA ───────────
#
#  Aconteceu em 19/10/2026, no primeiro dia deste aplicador. Tres devs
#  mergearam em dois minutos e os tres numeraram `20261019000013`, porque
#  cada um conferiu o repositorio num momento diferente:
#
#      20261019000013_he_chamados_so_do_colaborador_no_cluster.sql   aplicada
#      20261019000013_malote_forma_e_cartao_fluxo_especial.sql       NAO
#      20261019000013_urls_de_storage_apontam_para_o_cluster.sql     NAO
#
#  A chave do registro e o NUMERO. Registrada a primeira, as outras duas
#  passaram a contar como aplicadas -- para sempre, sem erro, sem log. O
#  resultado foi uma funcao que a tela do Malote chama e que nao existia no
#  banco: tela quebrada em producao por um numero repetido.
#
#  Por isso o aplicador PARA aqui, antes de tocar no banco. A alternativa --
#  aplicar as que dao e avisar no fim -- deixaria o merge verde, e merge
#  verde ninguem le. Com a parada, o proximo merge fica vermelho ate alguem
#  renumerar, que e um conserto de dois minutos.
VISTOS=$(mktemp); DUPES=$(mktemp)
while IFS= read -r -d '' F; do
  B=$(basename "$F")
  case "$B" in [0-9]*) ;; *) continue ;; esac
  printf '%s\n' "$(printf '%s' "$B" | sed -E 's/^([0-9]+).*/\1/')" >> "$VISTOS"
done < <(find "$DIR" -maxdepth 1 -name '*.sql' -print0)
LC_ALL=C sort "$VISTOS" | uniq -d > "$DUPES"
if [ -s "$DUPES" ]; then
  echo
  echo "PAREI: ha migrations diferentes com o MESMO numero de versao." >&2
  echo "Uma delas nunca entraria no banco, e sem erro nenhum." >&2
  echo >&2
  while read -r V; do
    [ -n "$V" ] || continue
    find "$DIR" -maxdepth 1 -name "${V}_*.sql" -printf '   %f\n' >&2
  done < "$DUPES"
  echo >&2
  echo "Conserto: renumere todas menos uma, com 'git mv', e mergeie." >&2
  rm -f "$VISTOS" "$DUPES"
  exit 1
fi
rm -f "$VISTOS" "$DUPES"

PENDENTES=()
while IFS= read -r -d '' F; do
  B=$(basename "$F")
  case "$B" in [0-9]*) ;; *) continue ;; esac
  V=$(printf '%s' "$B" | sed -E 's/^([0-9]+).*/\1/')
  [ -n "$V" ] || continue
  LC_ALL=C grep -qxF "$V" /tmp/.mig-aplicadas && continue
  PENDENTES+=("$F")
done < <(find "$DIR" -maxdepth 1 -name '*.sql' -print0 | LC_ALL=C sort -z)
rm -f /tmp/.mig-aplicadas

if [ "${#PENDENTES[@]}" -eq 0 ]; then
  log "nenhuma migration pendente."
  exit 0
fi

log "${#PENDENTES[@]} migration(s) pendente(s):"
for F in "${PENDENTES[@]}"; do echo "   - $(basename "$F")"; done

if [ "$ACAO" = "--conferir" ]; then
  echo
  echo "   (--conferir: nada foi aplicado)"
  exit 0
fi

# ── 3. aplicar, uma a uma, parando no primeiro erro ────────────────────────
APLICADAS=0
for F in "${PENDENTES[@]}"; do
  B=$(basename "$F")
  V=$(printf '%s' "$B" | sed -E 's/^([0-9]+).*/\1/')
  log "aplicando $B"
  SAIDA=$(
    {
      echo "BEGIN;"
      echo "SET LOCAL lock_timeout = '$LOCK';"
      cat "$F"
      echo ";"
      printf "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('%s', %s) ON CONFLICT DO NOTHING;\n" \
        "$V" "$(printf '%s' "$B" | sed "s/'/''/g; s/^/'/; s/$/'/")"
      echo "COMMIT;"
    } | PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres \
          -v ON_ERROR_STOP=1 -q -f - 2>&1
  )
  RC=$?
  if [ "$RC" -ne 0 ]; then
    echo "$SAIDA" | tail -12
    echo
    echo "::FALHA:: $B -- nada desta migration foi aplicado (transacao unica)." >&2
    case "$SAIDA" in
      *lock_timeout*|*"canceling statement due to lock timeout"*)
        echo "Motivo: a tabela estava em uso. O ERP NAO travou -- a migration" >&2
        echo "desistiu. Rode de novo fora do pico, ou com LOCK=30s." >&2 ;;
    esac
    echo "Aplicadas antes de parar: $APLICADAS" >&2
    exit 1
  fi
  APLICADAS=$((APLICADAS+1))
done

log "$APLICADAS migration(s) aplicada(s) e registrada(s)."
# As migrations do projeto terminam com NOTIFY pgrst -- mas nem todas, e uma
# que esqueceu deixa a API servindo o schema velho ate o proximo reload.
Q "notify pgrst, 'reload schema'" >/dev/null
echo
echo "Se alguma criou tabela ou policy, vale reconferir a trava de escrita:"
echo "   bash infra/ha/rollback-virada.sh --conferir"
