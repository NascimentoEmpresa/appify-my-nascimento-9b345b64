#!/usr/bin/env bash
# ============================================================================
#  Confere a replica de failover - roda de qualquer maquina, pela internet
# ============================================================================
#
#  PARA QUE SERVE
#  Responder, com teste e nao com opiniao, as tres perguntas que importam:
#
#    1. a replica esta no ar e com os dados?
#    2. as regras de acesso (RLS) valem la, ou todo mundo ve tudo?
#    3. ela RECUSA escrita, como promete o modo consulta?
#
#  A terceira e a que mais engana. Em 02/10/2026 a trava parecia aplicada
#  (aparecia em pg_roles nos tres papeis) e a escrita passava mesmo assim -
#  o PostgREST abre a transacao como READ WRITE e sobrescreve o default do
#  papel. So um POST de verdade mostra isso. Por isso este script grava,
#  em vez de ler configuracao.
#
#  USO
#      bash infra/failover/conferir-replica.sh
#
#  Nada aqui toca a producao. As chaves sao as da replica, que nao servem na
#  Supabase (o segredo de assinatura e outro).
# ============================================================================
set -uo pipefail

BASE="${REPLICA_URL:-https://erp-failover.onrender.com}"
ANON="${REPLICA_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkwNzkzNTk4LCJleHAiOjIxMDYxNTM1OTh9.Yq3uXHEiLhhZhPh3kKbdLwg-ftTROdZFKKW8MxGQWNw}"
SEGREDO="${REPLICA_JWT_SECRET:-}"

# Usuarias reais, restauradas do backup. Servem para provar que a RLS separa
# quem ve o que - uma gerente e uma encarregada enxergam volumes diferentes.
GERENTE=a240e3b5-3cda-4913-bebb-edcfa1035c7a
ENCARREGADA=2b58102a-e859-4485-be32-e465fb547bec

ok=0; falhou=0
checar() { # rotulo, esperado, obtido
  if [[ "$2" == "$3" ]]; then printf '  [ok]    %-44s %s\n' "$1" "$3"; ok=$((ok+1))
  else printf '  [FALHA] %-44s esperado=%s obtido=%s\n' "$1" "$2" "$3"; falhou=$((falhou+1)); fi
}

assinar() {
  node -e '
const c=require("crypto");
const b=s=>Buffer.from(s).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const [sub,chave]=process.argv.slice(1);
const h=b(JSON.stringify({alg:"HS256",typ:"JWT"}));
const n=Math.floor(Date.now()/1e3);
const p=b(JSON.stringify({role:"authenticated",sub,iat:n,exp:n+3600}));
console.log(`${h}.${p}.`+b(c.createHmac("sha256",chave).update(h+"."+p).digest()));
' "$1" "$2"
}

visiveis() { # token, tabela  -> quantidade que aquele usuario enxerga
  local cab
  cab=$(curl -s -D- -o /dev/null -m 60 "$BASE/rest/v1/$2?limit=1" \
        -H "apikey: $ANON" ${1:+-H "Authorization: Bearer $1"} -H "Prefer: count=exact" 2>/dev/null)
  echo "$cab" | grep -i '^content-range' | tr -d '\r' | sed 's#.*/##'
}

echo "=================================================================="
echo " CONFERENCIA DA REPLICA   $BASE"
echo " $(date '+%d/%m/%Y %H:%M')"
echo "=================================================================="
echo
echo "1. ESTA NO AR?"
checar "/saude responde 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$BASE/saude")"
echo
echo "2. TEM OS DADOS?"
emp=$(visiveis "" "EMPREGADOS")
echo "     empregados visiveis sem login: ${emp:-0} (a RLS deve esconder)"
echo
if [[ -z "$SEGREDO" ]]; then
  echo "3-4. RLS e ESCRITA: PULADOS"
  echo "     Defina REPLICA_JWT_SECRET para rodar estes testes - eles precisam"
  echo "     assinar um token de usuario real."
else
  TG=$(assinar "$GERENTE" "$SEGREDO")
  TE=$(assinar "$ENCARREGADA" "$SEGREDO")
  FALSO=$(assinar "$GERENTE" "segredo-de-um-atacante")

  echo "3. A RLS VALE AQUI?"
  g=$(visiveis "$TG" "notificacoes"); e=$(visiveis "$TE" "notificacoes"); s=$(visiveis "" "notificacoes")
  echo "     gerente ve ${g:-?} | encarregada ve ${e:-?} | sem login ve ${s:-?}"
  if [[ "${g:-0}" -gt "${e:-0}" && "${s:-1}" == "0" ]]; then
    echo "  [ok]    a RLS separa os tres casos"; ok=$((ok+1))
  else
    echo "  [FALHA] a RLS NAO esta separando - todo mundo veria o mesmo"; falhou=$((falhou+1))
  fi
  checar "token forjado e recusado" "401" \
    "$(curl -s -o /dev/null -w '%{http_code}' -m 40 "$BASE/rest/v1/notificacoes?limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $FALSO")"
  echo
  echo "4. RECUSA ESCRITA?  (o teste que pegou a trava falsa)"
  checar "INSERT recusado" "403" \
    "$(curl -s -o /dev/null -w '%{http_code}' -m 60 -X POST "$BASE/rest/v1/notificacoes" \
       -H "apikey: $ANON" -H "Authorization: Bearer $TG" -H "Content-Type: application/json" \
       -d "{\"user_id\":\"$GERENTE\",\"titulo\":\"conferencia\",\"mensagem\":\"x\",\"tipo\":\"info\"}")"
  checar "UPDATE recusado" "403" \
    "$(curl -s -o /dev/null -w '%{http_code}' -m 60 -X PATCH "$BASE/rest/v1/notificacoes?user_id=eq.$GERENTE" \
       -H "apikey: $ANON" -H "Authorization: Bearer $TG" -H "Content-Type: application/json" -d '{"lida":true}')"
  checar "LEITURA continua funcionando" "206" \
    "$(curl -s -o /dev/null -w '%{http_code}' -m 60 "$BASE/rest/v1/notificacoes?limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $TG")"
fi
echo
echo "=================================================================="
printf " %d passaram, %d falharam\n" "$ok" "$falhou"
echo "=================================================================="
exit $(( falhou > 0 ? 1 : 0 ))
