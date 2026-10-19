#!/usr/bin/env bash
# ============================================================================
#  Os JOBS DE CRON DE DENTRO DO BANCO, no cluster
#
#  O PROBLEMA QUE ISTO RESOLVE (achado em 16/10/2026)
#
#  A producao tem SETE jobs de `pg_cron` rodando dentro do banco:
#
#     sla-escalonamento-tick          0 * * * *     de hora em hora
#     regua-cobranca-tick             0 * * * *     de hora em hora
#     plano-acao-marcar-atrasadas     0 6 * * *     06h00 UTC
#     whatsapp-retomada-tick          */5 * * * *   de 5 em 5 minutos
#     comite-etica-alertas            0 8 * * 1-5   dias de semana
#     tvg-dre-atualizar               17 */6 * * *  4x ao dia
#     malote-rolagem-data-pagamento   */15 * * * *  de 15 em 15 minutos
#
#  O cluster tem a extensao `pg_cron` instalada e **zero jobs**.
#
#  POR QUE NINGUEM VIU ISSO ANTES
#  `pg_dump` nao carrega o conteudo da tabela `cron.job`: ela pertence a uma
#  EXTENSAO, e o dump leva a extensao, nao as linhas dela. Entao todo
#  conferidor que montamos deu "igual": mesmas tabelas, mesmas funcoes, mesmos
#  dados em `public`. A agenda, que nao e nem tabela nem funcao, ficou fora.
#
#  O QUE ACONTECERIA NA VIRADA SEM ISTO
#  Nada falharia. Nenhum erro, nenhum 500, nenhum alerta -- as sete
#  automacoes simplesmente nunca mais rodariam. O primeiro a notar seria o
#  Comite de Etica na segunda-feira seguinte sem o alerta das 8h, ou a regua
#  de cobranca que para de cobrar. Isso e pior que quebrar: quebra avisa.
#
#  UMA NOTA SOBRE O QUE OS JOBS FAZEM
#  Nenhum deles chama HTTP. Todos sao `SELECT public.enfileirar_tick(...)` ou
#  uma funcao SQL -- eles so EMPILHAM trabalho numa fila, e quem executa e o
#  `worker/`. Conferido: nenhuma funcao do banco tem `supabase.co` no corpo.
#  Por isso a agenda viaja sem reescrever URL nenhuma.
#
#  POR QUE OS JOBS NASCEM DESLIGADOS
#  Primeiro o que NAO acontece, para o motivo nao ficar inflado: `fila_http`
#  tem dedupe por destino (ver 20261006000002) -- se ja existe um tick nao
#  processado para aquele destino, o cron so adianta o relogio dele em vez de
#  inserir outro. Entao a fila nao vira avalanche: no maximo um tick por
#  destino espera la.
#  O motivo real e outro: enquanto o cluster nao e producao, tick acumulado
#  ali nao serve para nada e confunde a leitura da fila na noite da virada --
#  e um tick de `regua-cobranca` ou `whatsapp-retomada` entregue no momento
#  errado e cobranca e WhatsApp para gente de verdade. Agenda pronta e parada
#  e o estado seguro.
#  Entao `--aplicar` cria os sete DESLIGADOS e `--ligar` e um passo da noite
#  da virada, DEPOIS de apontar o worker para o cluster.
#
#  USO
#    bash infra/ha/cron-no-cluster.sh --conferir
#    bash infra/ha/cron-no-cluster.sh --aplicar    # cria desligados, hoje
#    bash infra/ha/cron-no-cluster.sh --ligar      # na virada, por ultimo
#
#  A senha da producao vem de `.env.local` (SENHA_ACESSO_SUPABASE) e e passada
#  por ambiente, em tempo de execucao. O psql roda NO NO, nunca aqui: a rede
#  da empresa filtra a 5432 de saida.
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

case "$ACAO" in --conferir|--aplicar|--ligar) : ;; *) sed -n '2,55p' "$0"; exit 2 ;; esac

ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
    -o StrictHostKeyChecking=accept-new "root@$BANCO1" \
    "SENHA='$PW' REF='$REF' ORIGEM_HOST='$ORIGEM_HOST' ACAO='$ACAO' bash -s" <<'REMOTO'
set -uo pipefail

SUP=$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
[ -n "$SUP" ] || { echo "sem PG_SENHA_SUPER no no" >&2; exit 1; }

# A producao SO para leitura. O cluster pelo HAProxy 5000, que sempre aponta
# para o lider -- escrever no standby devolveria "read-only transaction".
P() { PGPASSWORD="$SENHA" psql -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres -At "$@"; }
C() { PGPASSWORD="$SUP"   psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At "$@"; }

echo "== a agenda da producao"
# O separador e tab: schedule tem espacos ("0 * * * *") e comando tem de tudo.
AGENDA=$(P -F$'\t' -c "select jobname, schedule, command, active from cron.job order by jobname")
[ -n "$AGENDA" ] || { echo "producao devolveu agenda vazia -- parando por seguranca" >&2; exit 1; }
printf '%s\n' "$AGENDA" | awk -F'\t' '{printf "   %-32s %-14s ativo=%s\n", $1, $2, $4}'
QTD=$(printf '%s\n' "$AGENDA" | grep -c .)
echo "   $QTD jobs"

echo
echo "== a agenda do cluster, agora"
C -c "select coalesce(string_agg(jobname||' ('||schedule||')', ', '), '(nenhum)') from cron.job" 2>/dev/null \
  | sed 's/^/   /'

if [ "$ACAO" = "--conferir" ]; then
  CLUS=$(C -At -c "select count(*) from cron.job" 2>/dev/null || echo 0)
  LIGADOS=$(C -At -c "select count(*) from cron.job where active" 2>/dev/null || echo 0)
  echo
  printf '   producao %s jobs   cluster %s jobs, %s ligado(s)\n' "$QTD" "$CLUS" "$LIGADOS"
  if [ "$CLUS" != "$QTD" ]; then
    echo "   FALTAM no cluster. Criar (desligadas):"
    echo "      bash infra/ha/cron-no-cluster.sh --aplicar"
    exit 1
  elif [ "$LIGADOS" = "0" ]; then
    echo "   Agenda completa e PARADA -- o estado certo antes da virada."
    echo "   Na noite da virada, depois de apontar o worker:"
    echo "      bash infra/ha/cron-no-cluster.sh --ligar"
  else
    echo "   Agenda completa e RODANDO ($LIGADOS de $QTD)."
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
if [ "$ACAO" = "--ligar" ]; then
  echo "== a fila do cluster ANTES de ligar (regra da casa: mostrar a fila"
  echo "   antes de ligar qualquer coisa que fale com o usuario final)"
  C -F' | ' -c "select destino, count(*) filter (where processado_em is null) as esperando, count(*) as total
                  from public.fila_http group by destino order by 2 desc, 1" 2>/dev/null \
    | sed 's/^/   /' || echo "   (nao li fila_http -- confira a mao antes de seguir)"
  echo
  # ── espelhar a producao deixa de fazer sentido quando ela e aposentada ──
  #
  # Ate a virada, "ligado" era o que a producao dizia. DEPOIS da virada a
  # producao e desligada -- inclusive o cron dela, para parar de escrever dado
  # que o cluster nunca veria. A partir dai, espelhar o estado de la liga
  # exatamente NADA, que foi o que aconteceu em 17/10: o --ligar rodou e
  # manteve os sete parados, porque a referencia ja estava morta.
  #
  # Entao: se a producao ainda tem job ligado, espelha (estamos ANTES da
  # virada). Se nao tem nenhum, o cluster manda em si mesmo e liga todos.
  LIGADOS_PROD=$(printf '%s\n' "$AGENDA" | awk -F'\t' '$4=="t"' | grep -c . || true)
  if [ "$LIGADOS_PROD" -gt 0 ]; then
    echo "== espelhando a producao ($LIGADOS_PROD ligados la)"
  else
    echo "== a producao nao tem nenhum job ligado -- ela ja foi aposentada."
    echo "   O cluster passa a mandar em si mesmo: ligando os sete."
  fi
  printf '%s\n' "$AGENDA" | while IFS=$'\t' read -r NOME _ _ ATIVO; do
    [ -n "$NOME" ] || continue
    if [ "$LIGADOS_PROD" -gt 0 ] && [ "$ATIVO" != "t" ]; then
      echo "   $NOME fica desligado (desligado na producao tambem)"; continue
    fi
    NOME_SQL=${NOME//\'/\'\'}
    C -c "update cron.job set active=true where jobname='$NOME_SQL'" >/dev/null 2>&1 \
      && echo "   $NOME LIGADO" || echo "   FALHOU ligar $NOME" >&2
  done
  echo
  C -F' | ' -c "select jobname, schedule, active from cron.job order by jobname" | sed 's/^/   /'
  exit 0
fi

echo
echo "== criando no cluster, DESLIGADOS (cron.schedule re-agenda pelo nome)"
# cron.schedule(nome, ...) sobrescreve o agendamento daquele nome, entao rodar
# duas vezes nao duplica. Todos nascem com active=false, inclusive os que
# estao ligados na producao -- quem liga e o --ligar, na noite da virada.
printf '%s\n' "$AGENDA" | while IFS=$'\t' read -r NOME SCHED CMD ATIVO; do
  [ -n "$NOME" ] || continue
  # Aspas simples dobradas no nome e no schedule; o comando vai em $cmd$.
  CMD_SQL=$CMD
  NOME_SQL=${NOME//\'/\'\'}
  SCHED_SQL=${SCHED//\'/\'\'}
  OUT=$(C -c "select cron.schedule('$NOME_SQL', '$SCHED_SQL', \$cmd\$$CMD_SQL\$cmd\$)" 2>&1) || {
    echo "   FALHOU $NOME: $OUT" >&2; continue; }
  C -c "update cron.job set active=false where jobname='$NOME_SQL'" >/dev/null 2>&1
  printf '   %-32s agendado, DESLIGADO (jobid %s)\n' "$NOME" "$OUT"
done

echo
echo "== conferindo os dois lados"
PROD=$(P -At -c "select count(*) from cron.job")
CLUS=$(C -At -c "select count(*) from cron.job")
LIGADOS=$(C -At -c "select count(*) from cron.job where active")
echo "   jobs na producao $PROD   no cluster $CLUS   ligados no cluster $LIGADOS"
[ "$PROD" = "$CLUS" ] || { echo "   NAO FECHOU -- olhe as falhas acima" >&2; exit 1; }
[ "$LIGADOS" = "0" ] || { echo "   ALGUM FICOU LIGADO -- desligue antes de sair" >&2; exit 1; }
echo
echo "   Agenda pronta e parada. Nada roda, nada e enviado a ninguem."
echo "   Na noite da virada, DEPOIS de apontar o worker para o cluster:"
echo "      bash infra/ha/cron-no-cluster.sh --ligar"
REMOTO
