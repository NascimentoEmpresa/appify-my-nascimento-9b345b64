#!/usr/bin/env bash
# ============================================================================
#  TODA TELA DO SISTEMA, MEDIDA DE UMA VEZ
#
#  POR QUE ISTO EXISTE
#  Depois da virada, o dashboard de Compras/Estoque vinha em branco. A causa
#  nao era dado nem permissao: era o JIT do Postgres, que deixava a consulta
#  26x mais lenta e estourava o `statement_timeout=8s` do papel
#  `authenticated`. O front, ao receber o erro, simplesmente nao desenha nada.
#
#  Isso e o pior tipo de defeito que esta infraestrutura pode ter: silencioso,
#  por tela, e so descoberto por quem abre a tela. Com 391 RPCs no sistema,
#  descobrir uma de cada vez em horario comercial nao e opcao.
#
#  O QUE ELE FAZ
#  Le do repositorio TODAS as funcoes que o frontend chama (`sb.rpc(...)`),
#  executa no cluster com a sessao de um usuario de verdade e reporta duas
#  coisas: o que falha e o que esta perto do limite de 8 segundos.
#
#  POR QUE SIMULAR A SESSAO, E NAO CHAMAR A API
#  Chamar a API exigiria um token de usuario. Aqui a sessao e simulada DENTRO
#  do banco, do jeito que o PostgREST faz:
#      set local role authenticated;
#      set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
#  E o mesmo caminho que a RLS e o `auth.uid()` enxergam, sem criar credencial
#  nenhuma.
#
#  USO
#    bash infra/ha/conferir-telas.sh
#    USUARIO=<uuid> LIMITE_MS=3000 bash infra/ha/conferir-telas.sh
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
PORTA_SSH="${PORTA_SSH:-8443}"
USUARIO="${USUARIO:-97260632-2f1a-44e3-9f93-58b2b1f3702c}"
LIMITE_MS="${LIMITE_MS:-3000}"

cd "$(dirname "$0")/../.." || exit 1

echo "== lendo as chamadas do frontend"
grep -rhoE '\.rpc\(\s*["'"'"'][a-z_0-9]+["'"'"']' src --include=*.ts --include=*.tsx 2>/dev/null \
  | sed -E 's/.*["'"'"']([a-z_0-9]+)["'"'"']/\1/' | LC_ALL=C sort -u > /tmp/rpcs-telas.txt
echo "   $(grep -c . /tmp/rpcs-telas.txt) funcoes distintas"
[ -s /tmp/rpcs-telas.txt ] || { echo "nao achei chamadas .rpc() em src/" >&2; exit 1; }

scp -q -P "$PORTA_SSH" -o BatchMode=yes /tmp/rpcs-telas.txt "root@$BANCO1:/tmp/rpcs-telas.txt" || exit 1
rm -f /tmp/rpcs-telas.txt

ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 "root@$BANCO1" \
    "USUARIO='$USUARIO' LIMITE_MS='$LIMITE_MS' bash -s" <<'REMOTO'
set -uo pipefail
SUP=$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
C() { PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At "$@"; }
SIM="set local role authenticated; set local request.jwt.claims='{\"sub\":\"$USUARIO\",\"role\":\"authenticated\"}';"

# Um contrato e uma empresa de verdade, para as funcoes que pedem um id. Sem
# isto so daria para testar as sem argumento, que sao a minoria.
CT=$(C -c "select id::text from public.contratos order by created_at desc limit 1" 2>/dev/null)
EMP=$(C -c "select empresa_id::text from public.profiles where id='$USUARIO'" 2>/dev/null)
echo "   contrato de amostra: ${CT:0:8}...   empresa: ${EMP:0:8}..."

LISTA=$(C -c "select p.proname||'|'||coalesce(pg_get_function_identity_arguments(p.oid),'')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f'
   and p.proname = any(string_to_array(trim(pg_read_file('/tmp/rpcs-telas.txt')), chr(10)))
   and (p.pronargs=0 or pg_get_function_identity_arguments(p.oid) ~ '^p_(contrato|empresa)_id uuid\$')
 order by 1")

N=0; LENTAS=0; ERROS=0
echo
echo "== executando com a sessao do usuario"
while IFS='|' read -r F ARGS; do
  [ -n "$F" ] || continue
  case "$ARGS" in
    "")             A="" ;;
    p_contrato_id*) A="'$CT'::uuid" ;;
    p_empresa_id*)  A="'$EMP'::uuid" ;;
    *) continue ;;
  esac
  N=$((N+1))
  T0=$(date +%s%N)
  # count(*) serve para funcao que devolve conjunto; se reclamar, tenta escalar
  R=$(C -c "begin; $SIM select count(*) from public.$F($A); rollback;" 2>&1 | grep -viE '^(BEGIN|ROLLBACK|SET)$' | grep -vE '^$' | head -1)
  case "$R" in *ERROR*)
    R=$(C -c "begin; $SIM select length(public.$F($A)::text); rollback;" 2>&1 | grep -viE '^(BEGIN|ROLLBACK|SET)$' | grep -vE '^$' | head -1) ;;
  esac
  T1=$(date +%s%N); MS=$(( (T1-T0)/1000000 ))
  case "$R" in *ERROR*) ERROS=$((ERROS+1)); printf '   FALHA  %-40s %s\n' "$F" "$(echo "$R" | cut -c1-70)" ;; esac
  if [ "$MS" -gt "$LIMITE_MS" ]; then
    LENTAS=$((LENTAS+1)); printf '   LENTA  %-40s %s ms\n' "$F" "$MS"
  fi
done <<< "$LISTA"

echo
echo "   $N funcoes testadas | $LENTAS acima de ${LIMITE_MS}ms | $ERROS com erro"
echo
echo "   Lembre: o papel 'authenticated' tem statement_timeout=8s. Funcao que"
echo "   passa disso NAO devolve erro na tela -- devolve tela em branco."
rm -f /tmp/rpcs-telas.txt
REMOTO
