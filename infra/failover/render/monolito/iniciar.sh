#!/usr/bin/env bash
# ============================================================================
#  Ponto de entrada da replica em imagem unica
# ============================================================================
#  Ordem: prepara o banco -> liga o supervisor -> (opcional) carrega o backup.
# ============================================================================
set -uo pipefail

log() { printf '[replica %(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$*"; }

for v in POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY; do
  if [[ -z "${!v:-}" ]]; then
    log "FALTA a variavel $v. Sem ela a replica nao sobe."
    exit 1
  fi
done
# Usadas pelo GoTrue para montar links e validar redirecionamento. Nao sao
# segredo, mas precisam existir - se vierem vazias o GoTrue recusa o boot.
export URL_PUBLICA="${URL_PUBLICA:-http://localhost:8000}"
export URL_SITE="${URL_SITE:-http://localhost:8080}"

log "=== replica do ERP subindo ==="
log "gateway em :8000   |   site: $URL_SITE"

/usr/local/bin/preparar-banco.sh || { log "preparar-banco.sh falhou"; exit 1; }

# O storage so entra se o modulo nativo tiver sido recompilado na build. Sem
# isso ele reinicia em loop e enterra o log dos outros processos.
if [[ -f /opt/storage/.nativo-ok ]]; then
  log "storage: modulo nativo OK, sera iniciado"
  # A pasta dos anexos fica DENTRO do disco persistente, e isso nao e detalhe:
  # ate 02/10/2026 ela apontava para /var/lib/storage, que mora no overlay do
  # container - ou seja, todo arquivo enviado aqui sumiria no deploy seguinte,
  # sem erro nenhum, so uma pasta vazia. Esse mesmo descuido ja custou 82
  # anexos de patrimonio em outro servico da Render.
  mkdir -p /var/lib/postgresql/data/storage
  chown -R 1000:1000 /var/lib/postgresql/data/storage 2>/dev/null || true
  sed -i '/^\[program:storage\]/,/^\[/{s/^autostart=false/autostart=true/}' /etc/supervisor/supervisord.conf
else
  log "storage: DESATIVADO (fs-xattr nao recompilou). Anexos nao funcionam nesta replica."
fi

# --- o que o ERP precisa saber para falar com esta replica -----------------
# A chave anon DESTA replica (assinada com outro segredo - a de producao nao
# serve aqui) nao pode morar no codigo do ERP: o repositorio e publico, e
# credencial versionada e credencial vazada. Entao a replica publica a propria
# configuracao, e no ERP fica so o endereco - que ja e publico.
#
# Escrito no boot porque o nginx nao interpola variavel de ambiente na
# configuracao.
mkdir -p /var/lib/nginx
printf '{"url":"%s","anon":"%s"}' \
  "${URL_PUBLICA:-https://erp-failover.onrender.com}" "${ANON_KEY:-}" \
  > /var/lib/nginx/contingencia.json
chmod 644 /var/lib/nginx/contingencia.json
log "configuracao de contingencia publicada em /contingencia.json"

# A carga do backup roda em segundo plano para nao atrasar o health check da
# Render: ela derruba o servico se o /saude nao responder em alguns minutos, e
# restaurar 641 tabelas leva mais que isso.
if [[ "${CARREGAR_NO_BOOT:-nao}" == "sim" ]]; then
  log "CARREGAR_NO_BOOT=sim: a carga comeca assim que o banco aceitar conexao"
  (
    export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
    export PGPASSWORD="$POSTGRES_PASSWORD"
    for _ in $(seq 1 60); do
      pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1 && break
      sleep 2
    done
    /usr/local/bin/recarga-render.sh 2>&1 | sed 's/^/[carga] /'
  ) &
fi

log "entregando o controle ao supervisor"
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
