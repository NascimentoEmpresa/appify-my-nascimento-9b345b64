#!/usr/bin/env bash
# ============================================================================
#  O BOTAO DE VOLTA DA VIRADA
#
#  PARA QUE ISTO EXISTE
#  A virada tem um ponto sem volta -- o primeiro salvamento feito no cluster --
#  mas TUDO antes dele e reversivel em segundos, e este script e o caminho.
#  Enquanto o frontend nao apontar para o cluster, a producao continua sendo a
#  producao: basta devolver a escrita a ela e esta tudo como antes.
#
#  A REGRA QUE MANDA AQUI
#  O ERP **nunca** fica fora do ar. O congelamento NAO e uma tela de
#  manutencao: o ERP continua abrindo, consultando e navegando -- ele so
#  recusa SALVAR. Quem tenta salvar recebe erro de permissao; quem esta
#  consultando nem percebe. Se algo der errado, `--descongelar` devolve o
#  salvamento sem reiniciar nada e sem derrubar ninguem.
#
#  O DESFAZER E O MESMO CODIGO DO FAZER
#  `--congelar` e `--descongelar` sao o mesmo caminho, invertido, no mesmo
#  script, testados juntos. Rollback escrito num documento e testado so no dia
#  do desastre nao e rollback, e esperanca.
#
#  USO
#    bash infra/ha/rollback-virada.sh --fotografar    # ANTES de tudo
#    bash infra/ha/rollback-virada.sh --conferir      # onde estamos agora
#    bash infra/ha/rollback-virada.sh --congelar      # passo 2.1 da virada
#    bash infra/ha/rollback-virada.sh --descongelar   # <<< O BOTAO DE VOLTA
#    bash infra/ha/rollback-virada.sh --abrir-cluster # libera escrita no cluster
#    bash infra/ha/rollback-virada.sh --fechar-cluster
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
BANCO2="${BANCO2:-172.237.48.8}"
PORTA_SSH="${PORTA_SSH:-8443}"
REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
ORIGEM_HOST="${ORIGEM_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
DOMINIO_APP="${DOMINIO_APP:-app.grpnascimento.com.br}"
ACAO="${1:---conferir}"

cd "$(dirname "$0")/../.." || exit 1
RAIZ="$PWD"

PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local 2>/dev/null | cut -d= -f2- | tr -d '\r\n')
[ -n "$PW" ] || { echo "nao achei SENHA_ACESSO_SUPABASE em .env.local" >&2; exit 1; }

# Tudo roda NO NO: a rede da empresa filtra a 5432 de saida.
no() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
         -o StrictHostKeyChecking=accept-new "root@$BANCO1" "SENHA='$PW' REF='$REF' ORIGEM_HOST='$ORIGEM_HOST' bash -s"; }

case "$ACAO" in --fotografar|--conferir|--congelar|--descongelar|--abrir-cluster|--fechar-cluster) : ;;
  *) sed -n '2,30p' "$0"; exit 2 ;; esac

# ---------------------------------------------------------------------------
if [ "$ACAO" = "--conferir" ] || [ "$ACAO" = "--fotografar" ]; then
  echo "=========================================================="
  echo " ESTADO EM $(date '+%d/%m/%Y %H:%M:%S') (horario desta maquina)"
  echo "=========================================================="
  no <<'REMOTO'
P() { PGPASSWORD="$SENHA" psql -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres -At "$@"; }
SUP=$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
C() { PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At "$@"; }
G="select count(*) from information_schema.role_table_grants
     where grantee in ('anon','authenticated')
       and privilege_type in ('INSERT','UPDATE','DELETE') and table_schema='public'"

echo "-- PRODUCAO"
printf '   aceita escrita em %s permissoes (0 = CONGELADA)\n' "$(P -c "$G")"
printf '   tabelas em public: %s   linhas em CHAMADO_SISTEMA: %s\n' \
  "$(P -c "select count(*) from pg_tables where schemaname='public'")" \
  "$(P -c 'select count(*) from public."CHAMADO_SISTEMA"')"
printf '   assinatura erp_corte: %s\n' \
  "$(P -c "select coalesce(string_agg(subname||' ativa='||subenabled::text,', '),'(nao existe)') from pg_subscription" 2>/dev/null)"
printf '   slot erp_corte: %s\n' \
  "$(P -c "select coalesce(string_agg(slot_name||' '||coalesce(wal_status,'?')||' ativo='||active::text,', '),'(nenhum)') from pg_replication_slots where slot_name='erp_corte'")"

echo "-- CLUSTER"
printf '   aceita escrita em %s permissoes (0 = FECHADO, o estado de hoje)\n' "$(C -c "$G")"
printf '   tabelas em public: %s   linhas em CHAMADO_SISTEMA: %s\n' \
  "$(C -c "select count(*) from pg_tables where schemaname='public'")" \
  "$(C -c 'select count(*) from public."CHAMADO_SISTEMA"')"
printf '   assinatura: %s\n' \
  "$(C -c "select coalesce(string_agg(subname||' ativa='||subenabled::text,', '),'(nenhuma)') from pg_subscription")"
printf '   jobs de cron: %s total, %s ligados\n' \
  "$(C -c 'select count(*) from cron.job')" "$(C -c 'select count(*) from cron.job where active')"
REMOTO

  echo "-- FRONTEND (o que o navegador baixa)"
  URL=$(grep -m1 '^VITE_SUPABASE_URL=' "$RAIZ/.env" | cut -d= -f2- | tr -d '\r\n')
  printf '   .env da main aponta para: %s\n' "$URL"
  printf '   commit da main: %s\n' "$(git rev-parse --short origin/main 2>/dev/null || echo '?')"
  printf '   %s responde: %s\n' "$DOMINIO_APP" \
    "$(curl -s -o /dev/null -w '%{http_code}' -m 20 "https://$DOMINIO_APP/")"

  echo "-- WORKER"
  printf '   worker/.env aponta para: %s\n' \
    "$(grep -m1 '^SUPABASE_URL=' "$RAIZ/worker/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r\n')"

  if [ "$ACAO" = "--fotografar" ]; then
    echo
    echo "=========================================================="
    echo " GUARDE ESTES NUMEROS. Se algo der errado, eles sao o alvo"
    echo " do rollback: a producao tem que voltar a ter o mesmo"
    echo " numero de permissoes de escrita e o .env tem que voltar"
    echo " para a URL acima."
    echo "=========================================================="
    echo
    echo " O BOTAO DE VOLTA, em uma linha:"
    echo "    bash infra/ha/rollback-virada.sh --descongelar"
    echo
    echo " Ele devolve a escrita a producao. Enquanto o .env da main"
    echo " nao tiver mudado, isso sozinho ja e o rollback completo."
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
if [ "$ACAO" = "--congelar" ] || [ "$ACAO" = "--descongelar" ]; then
  if [ "$ACAO" = "--congelar" ]; then
    SQL="REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;"
    QUAL="CONGELANDO a escrita na PRODUCAO"
    ESPERADO=0
  else
    SQL="GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;"
    QUAL="DEVOLVENDO a escrita a PRODUCAO  <<< ROLLBACK"
    ESPERADO=1
  fi
  echo "== $QUAL"
  no <<REMOTO
P() { PGPASSWORD="\$SENHA" psql -h "\$ORIGEM_HOST" -p 5432 -U "postgres.\$REF" -d postgres -At "\$@"; }
G="select count(*) from information_schema.role_table_grants
     where grantee in ('anon','authenticated')
       and privilege_type in ('INSERT','UPDATE','DELETE') and table_schema='public'"
ANTES=\$(P -c "\$G")
echo "   permissoes de escrita antes: \$ANTES"
# O NOTIFY e obrigatorio: sem ele o PostgREST segue com o catalogo velho em
# memoria e a mudanca so vale no proximo restart dele -- ou seja, nao vale.
P -c "$SQL" >/dev/null 2>&1 || { echo "   FALHOU o comando no banco" >&2; exit 1; }
P -c "NOTIFY pgrst, 'reload schema';" >/dev/null 2>&1
sleep 3
DEPOIS=\$(P -c "\$G")
echo "   permissoes de escrita depois: \$DEPOIS"
if [ "$ESPERADO" = "0" ]; then
  [ "\$DEPOIS" = "0" ] && echo "   OK: a producao parou de aceitar salvamento (continua lendo normal)" \
                       || { echo "   NAO CONGELOU -- ainda ha \$DEPOIS permissoes" >&2; exit 1; }
else
  [ "\$DEPOIS" -gt 0 ] && echo "   OK: a producao voltou a aceitar salvamento (\$DEPOIS permissoes)" \
                       || { echo "   NAO DESCONGELOU -- continua em \$DEPOIS" >&2; exit 1; }
fi
REMOTO
  RC=$?
  echo
  if [ "$ACAO" = "--descongelar" ] && [ $RC -eq 0 ]; then
    echo "   A producao voltou a salvar. Se o .env da main JA tiver sido"
    echo "   trocado, falta tambem:"
    echo "      git revert <commit do .env> && git push    (o Lovable reconstroi)"
    echo "      devolver worker/.env para a URL da Supabase"
    echo "      bash infra/ha/rollback-virada.sh --fechar-cluster"
  fi
  exit $RC
fi

# ---------------------------------------------------------------------------
if [ "$ACAO" = "--abrir-cluster" ] || [ "$ACAO" = "--fechar-cluster" ]; then
  if [ "$ACAO" = "--abrir-cluster" ]; then
    SQL="GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;"
    QUAL="ABRINDO a escrita no CLUSTER (ele vira a producao)"
  else
    SQL="REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;"
    QUAL="FECHANDO a escrita no CLUSTER (rollback: ele volta a ser copia)"
  fi
  echo "== $QUAL"
  # Nos DOIS nos nao: o banco e um so (o lider). Mas o comando vai pelo HAProxy
  # 5000, que sempre aponta para o lider -- entao basta uma vez.
  no <<REMOTO
SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
C() { PGPASSWORD="\$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At "\$@"; }
G="select count(*) from information_schema.role_table_grants
     where grantee in ('anon','authenticated')
       and privilege_type in ('INSERT','UPDATE','DELETE') and table_schema='public'"
echo "   antes: \$(C -c "\$G") permissoes"
C -c "$SQL" >/dev/null 2>&1 || { echo "   FALHOU" >&2; exit 1; }
C -c "NOTIFY pgrst, 'reload schema';" >/dev/null 2>&1
sleep 3
echo "   depois: \$(C -c "\$G") permissoes"
REMOTO
  exit $?
fi
