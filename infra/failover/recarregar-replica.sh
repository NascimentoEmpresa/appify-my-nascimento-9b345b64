#!/usr/bin/env bash
# ============================================================================
#  Recarrega a replica com o backup mais recente  (sincronizacao periodica)
# ============================================================================
#
#  O QUE ISTO RESOLVE
#  A replica e um standby FRIO: ela tem a idade do ultimo carregamento. Rodando
#  isto de hora em hora, o atraso maximo passa a ser 1 hora em vez de "desde
#  que alguem lembrou de rodar o script". E o passo que transforma a pasta de
#  uma prova de conceito em algo util numa emergencia de verdade.
#
#  POR QUE RECRIAR TUDO EM VEZ DE ATUALIZAR NO LUGAR
#  Parece desperdicio, e nao e. O ciclo completo leva ~90 segundos e e o mesmo
#  caminho que ja foi provado dezenas de vezes: derruba, sobe limpo, restaura,
#  confere. Uma recarga "incremental" precisaria saber o que mudou - e o
#  backup e um dump completo, nao um diff. Inventar diff aqui seria trocar um
#  processo provado por um artesanal, para economizar um minuto de uma maquina
#  que nao esta servindo ninguem enquanto e standby.
#
#  IMPORTANTE: isto NAO serve depois de uma promocao. Se a replica virou a
#  producao (a Supabase caiu e o trafego foi para ca), este script APAGA o que
#  os usuarios escreveram. Por isso a trava do arquivo PROMOVIDA abaixo.
#
#  USO
#    ./recarregar-replica.sh                      # procura o backup mais novo
#    ./recarregar-replica.sh /caminho/backup.gpg  # usa um especifico
#
#  SENHA DA CHAVE GPG - nunca fica aqui dentro. Ou o gpg-agent ja esta
#  destravado, ou aponte um arquivo:
#    export GPG_PASSPHRASE_FILE=/run/secrets/gpg-backup
# ============================================================================
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASTA_BACKUPS="${PASTA_BACKUPS:-/mnt/s/1- SERVIDOR/Analise de dados/Grupo Nascimento/Analise de Sistemas/Eduardo/BACKUP-BANCO}"
LOG="${LOG:-$AQUI/recarga.log}"
MARCA_PROMOVIDA="$AQUI/PROMOVIDA"

log() { printf '[%(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$*" | tee -a "$LOG"; }
erro() { log "FALHOU: $*"; exit 1; }

cd "$AQUI"

# --- trava contra apagar dados de uma replica ja promovida ------------------
# Se alguem criou este arquivo, a replica esta servindo usuarios de verdade e
# recarregar apagaria o trabalho deles. Melhor nao rodar e reclamar.
if [[ -f "$MARCA_PROMOVIDA" ]]; then
  erro "existe o arquivo PROMOVIDA: esta replica esta em uso como producao. Recarregar APAGARIA dados. Remova o arquivo so quando ela voltar a ser standby."
fi

# --- 1. achar o backup ------------------------------------------------------
BACKUP="${1:-}"
if [[ -z "$BACKUP" ]]; then
  [[ -d "$PASTA_BACKUPS" ]] || erro "pasta de backups nao acessivel: $PASTA_BACKUPS"
  BACKUP="$(ls -1t "$PASTA_BACKUPS"/*.dump.gpg 2>/dev/null | head -1)"
  [[ -n "$BACKUP" ]] || erro "nenhum .dump.gpg em $PASTA_BACKUPS"
fi
[[ -f "$BACKUP" ]] || erro "backup nao encontrado: $BACKUP"

IDADE_MIN=$(( ( $(date +%s) - $(stat -c %Y "$BACKUP") ) / 60 ))
log "=== recarga iniciada ==="
log "backup: $(basename "$BACKUP")  ($(du -h "$BACKUP" | cut -f1), gerado ha ${IDADE_MIN} min)"

# Backup velho e sinal de que a cadeia quebrou LA ATRAS - avisar, mas seguir:
# uma replica de ontem ainda e melhor que nenhuma.
if (( IDADE_MIN > 1500 )); then
  log "AVISO: o backup mais novo tem mais de 25h. Conferir o workflow backup_banco.yml."
fi

# --- 2. descriptografar -----------------------------------------------------
DUMP="$AQUI/producao.dump"
if [[ "$BACKUP" == *.gpg ]]; then
  log "descriptografando..."
  gpg_args=(--batch --yes --quiet --pinentry-mode loopback -o "$DUMP" -d "$BACKUP")
  if [[ -n "${GPG_PASSPHRASE_FILE:-}" ]]; then
    [[ -f "$GPG_PASSPHRASE_FILE" ]] || erro "GPG_PASSPHRASE_FILE aponta para arquivo inexistente"
    gpg_args=(--passphrase-file "$GPG_PASSPHRASE_FILE" "${gpg_args[@]}")
  fi
  gpg "${gpg_args[@]}" || erro "gpg nao conseguiu abrir o backup (senha? chave privada ausente?)"
else
  cp -f "$BACKUP" "$DUMP"
fi
log "dump em claro: $(du -h "$DUMP" | cut -f1)"

# --- 3. ciclo completo ------------------------------------------------------
inicio=$(date +%s)
log "derrubando a stack e apagando o volume do banco..."
docker compose down -v >>"$LOG" 2>&1 || erro "docker compose down falhou"

log "subindo limpo..."
docker compose up -d >>"$LOG" 2>&1 || erro "docker compose up falhou"

log "esperando o banco ficar saudavel..."
pronto=nao
for _ in $(seq 1 90); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' erp-failover-db-1 2>/dev/null)" == "healthy" ]]; then
    pronto=sim; break
  fi
  sleep 3
done
[[ "$pronto" == "sim" ]] || erro "o banco nao ficou saudavel em 4,5 min"

log "carregando o backup..."
./preparar-replica.sh "$DUMP" >>"$LOG" 2>&1 || erro "preparar-replica.sh falhou - ver $LOG"

# --- 4. conferir antes de declarar sucesso ----------------------------------
# Sem isto, uma recarga que restaurou pela metade passaria por boa - e o
# proximo a descobrir seria quem precisasse da replica numa emergencia.
consultar() { docker compose exec -T db psql -U postgres -d postgres -Atc "$1" 2>/dev/null; }
tabelas=$(consultar "select count(*) from information_schema.tables where table_schema in ('public','auth','storage','espelho') and table_type='BASE TABLE'")
policies=$(consultar "select count(*) from pg_policies")
logins=$(consultar "select count(*) from auth.users")
segundos=$(( $(date +%s) - inicio ))

log "resultado: ${tabelas} tabelas | ${policies} policies | ${logins} logins | ${segundos}s"

falhou=""
(( ${tabelas:-0} >= 600 )) || falhou="$falhou tabelas=${tabelas:-0}(<600)"
(( ${policies:-0} >= 1400 )) || falhou="$falhou policies=${policies:-0}(<1400)"
(( ${logins:-0} >= 100 )) || falhou="$falhou logins=${logins:-0}(<100)"
if [[ -n "$falhou" ]]; then
  erro "a replica ficou incompleta:$falhou"
fi

# --- 5. a aplicacao responde mesmo? -----------------------------------------
# Contagem no banco nao prova que o ERP funciona: ja aconteceu de o banco estar
# perfeito e a stack inteira recusar login por uma variavel de ambiente.
ANON="$(grep ^ANON_KEY= .env | cut -d= -f2)"
api=""
for _ in $(seq 1 30); do
  api=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://localhost:8000/rest/v1/profiles?limit=1" -H "apikey: $ANON")
  [[ "$api" == "200" ]] && break
  sleep 4
done
saude=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://localhost:8000/auth/v1/health")
log "API: HTTP $api  |  login (GoTrue): HTTP $saude"
[[ "$api" == "200" && "$saude" == "200" ]] || erro "a stack subiu mas nao esta servindo (API=$api login=$saude)"

log "=== recarga OK em ${segundos}s ==="
