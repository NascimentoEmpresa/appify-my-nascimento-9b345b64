#!/usr/bin/env bash
# ============================================================================
#  As VARIAVEIS DE AMBIENTE das Edge Functions, no cluster
#
#  O PROBLEMA QUE ISTO RESOLVE (achado em 15/10/2026, na varredura final)
#
#  Na Supabase, cada Edge Function recebe ~30 "secrets" do projeto. No cluster,
#  o container `erp-pilha-functions-1` subiu com DEZ variaveis:
#
#     HOME HOSTNAME JWT_SECRET PATH SUPABASE_ANON_KEY SUPABASE_DB_URL
#     SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL VERIFY_JWT
#
#  As 64 functions leem 54 nomes. Na virada, sem isto, quebrariam em silencio:
#  WhatsApp (12 funcoes), as IAs, push, Correios, cobranca, SMTP, GitHub.
#  Nenhum conferidor de banco olha para variavel de ambiente -- e nao ha erro
#  no log do Postgres, nem lag de replicacao: a function responde 500 e o
#  usuario ve "erro ao enviar".
#
#  O QUE DESCOBRIMOS E FAZ ESTE SCRIPT FUNCIONAR (16/10/2026)
#
#  `supabase secrets list` NAO devolve valor nenhum -- devolve um "digest".
#  Esse digest e o SHA256 CRU do valor, sem sal. Provado com as cinco
#  variaveis que tambem existem em `worker/.env`: os cinco sha256 bateram com
#  os cinco digests, caractere por caractere.
#
#  Consequencia pratica, que e o coracao deste script: da para PROVAR que um
#  valor candidato e identico ao que roda na producao, sem nunca ler o segredo
#  da producao. Entao "recuperei a chave do console da Meta" deixa de ser fe e
#  passa a ser conferencia: `--conferir` responde IGUAL ou DIFERENTE.
#
#  O QUE ESTE SCRIPT NAO FAZ
#  Nao grava segredo em arquivo nenhum nesta maquina. Os valores sao juntados
#  em tempo de execucao a partir de `worker/.env` (que nao e versionado) e,
#  opcionalmente, de um arquivo que voce aponta em SEGREDOS=, e vao por stdin
#  do ssh direto para `/opt/erp/infra/failover/segredos-functions.env` nos nos,
#  com umask 077. Nenhum valor aparece na tela, nunca -- nem truncado.
#
#  USO
#    bash infra/ha/configurar-secrets.sh --conferir
#    bash infra/ha/configurar-secrets.sh --aplicar
#    SEGREDOS=~/segredos-recuperados.env bash infra/ha/configurar-secrets.sh --aplicar
#    bash infra/ha/configurar-secrets.sh --provar
#
#  O arquivo de SEGREDOS e um KEY=VALUE por linha, como um .env. Depois de
#  aplicar, APAGUE-O: o lugar definitivo e o no, com chmod 600.
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
BANCO2="${BANCO2:-172.237.48.8}"
PORTA_SSH="${PORTA_SSH:-8443}"
REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
ARQ_NO="/opt/erp/infra/failover/segredos-functions.env"
COMPOSE_NO="/opt/erp/infra/failover/docker-compose.cluster.yml"
ACAO="${1:---conferir}"

cd "$(dirname "$0")/../.." || exit 1
RAIZ="$PWD"

em() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
         -o StrictHostKeyChecking=accept-new "root@$1" "$2"; }

# ---------------------------------------------------------------------------
#  De onde vem cada valor, sem nunca imprimi-lo
# ---------------------------------------------------------------------------
# worker/.env e .env.local nao sao versionados (o .env da raiz E versionado em
# repo publico, por isso nao entra aqui nem como leitura).
valor_local() {
  local nome="$1" v=""
  for f in "$RAIZ/worker/.env" "${SEGREDOS:-/dev/null}"; do
    [ -f "$f" ] || continue
    v=$(grep -m1 "^$nome=" "$f" 2>/dev/null | cut -d= -f2- | tr -d '\r\n')
    [ -n "$v" ] && { printf '%s' "$v"; return 0; }
  done
  return 1
}

sha() { printf '%s' "$1" | sha256sum | cut -c1-64; }

# ---------------------------------------------------------------------------
#  A CLI da Supabase nao esta no PATH desta maquina: ela vive no cache do npx.
#  Procurar e mais honesto que exigir instalacao -- e o digest e so leitura.
# ---------------------------------------------------------------------------
achar_cli() {
  local c
  c=$(command -v supabase 2>/dev/null) && { printf '%s' "$c"; return 0; }
  # `find`, nao `ls`: o `ls` do Git Bash marca executavel com um asterisco no
  # fim do nome (`supabase*`) e o caminho resultante nao existe. Mesma
  # armadilha do md5sum com `*caminho`.
  c=$(find "$HOME/AppData/Local/npm-cache/_npx" -maxdepth 4 -path "*/.bin/supabase" -type f 2>/dev/null | head -1)
  [ -n "$c" ] && { printf '%s' "$c"; return 0; }
  return 1
}

digests_da_producao() {  # imprime "NOME sha256" por linha
  local cli; cli=$(achar_cli) || return 1
  "$cli" secrets list --project-ref "$REF" 2>/dev/null \
    | tr '{' '\n' \
    | sed -nE 's/.*"name":"([A-Z0-9_]+)","value":"([0-9a-f]{64})".*/\1 \2/p'
}

# ---------------------------------------------------------------------------
#  Classificacao. Montada do codigo, nao de cabeca: os nomes saem de um grep
#  nas 64 functions, e o "tem default" sai do proprio fonte.
# ---------------------------------------------------------------------------
# Ja entregues pelo compose (environment:), nao entram no arquivo de segredos.
JA_NO_CLUSTER="JWT_SECRET SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_PUBLISHABLE_KEY SUPABASE_DB_URL VERIFY_JWT"
# So usadas em teste automatizado (index_test.ts), nunca em producao.
SO_TESTE="TEST_ADMIN_EMAIL TEST_ADMIN_PASSWORD TEST_NOROLE_EMAIL TEST_NOROLE_PASSWORD TEST_SCOPED_EMAIL TEST_SCOPED_PASSWORD VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY"
# Tem valor padrao no codigo: ausencia nao quebra nada.
TEM_DEFAULT="GROQ_MODEL IA_BI_MODELO IA_CHAT_MODELO IA_COLABORADOR_MODELO IA_DIRETORIA_MODELO IA_TVG_MODELO VAPID_SUBJECT DENUNCIA_URL_BASE"

contem() { case " $2 " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

nomes_das_functions() {
  grep -rhoE "Deno\.env\.get\(\s*['\"][A-Za-z0-9_]+['\"]" "$RAIZ/supabase/functions" 2>/dev/null \
    | grep -oE "['\"][A-Za-z0-9_]+['\"]" | tr -d "'\"" | sort -u
}

case "$ACAO" in

# ===========================================================================
--conferir)
  echo "== lendo os digests da producao (sha256, nunca o valor)"
  PROD=$(digests_da_producao)
  if [ -z "$PROD" ]; then
    echo "   nao consegui falar com a Supabase; segue sem a coluna da producao" >&2
  else
    echo "   $(printf '%s\n' "$PROD" | wc -l) secrets no projeto $REF"
  fi

  echo "== lendo as variaveis que o container do cluster tem hoje"
  NO_CLUSTER=$(em "$BANCO1" "docker exec erp-pilha-functions-1 env 2>/dev/null | cut -d= -f1 | sort" || true)
  echo "   $(printf '%s\n' "$NO_CLUSTER" | grep -c . ) no banco1"
  echo

  printf '%-30s %-22s %s\n' "VARIAVEL" "ONDE ESTA" "VEREDITO"
  printf '%-30s %-22s %s\n' "------------------------------" "----------------------" "--------"

  BLOQ=0; LEVO=0; QUEBRADO=0
  while read -r V; do
    [ -n "$V" ] || continue
    contem "$V" "$SO_TESTE"      && { printf '%-30s %-22s %s\n' "$V" "so em teste"      "ok"; continue; }
    contem "$V" "$JA_NO_CLUSTER" && { printf '%-30s %-22s %s\n' "$V" "o compose entrega" "ok"; continue; }

    TEM_PROD=$(printf '%s\n' "$PROD" | awk -v n="$V" '$1==n{print $2}')
    if VAL=$(valor_local "$V"); then
      if [ -n "$TEM_PROD" ]; then
        if [ "$(sha "$VAL")" = "$TEM_PROD" ]; then
          printf '%-30s %-22s %s\n' "$V" "aqui (worker/.env)" "CONFERIDO igual a producao"
        else
          printf '%-30s %-22s %s\n' "$V" "aqui (worker/.env)" "ATENCAO: DIFERENTE da producao"
        fi
      else
        printf '%-30s %-22s %s\n' "$V" "aqui (worker/.env)" "levo eu (nao esta na Supabase)"
      fi
      LEVO=$((LEVO+1)); continue
    fi

    if [ -n "$TEM_PROD" ]; then
      printf '%-30s %-22s %s\n' "$V" "SO na Supabase" "BLOQUEIA A VIRADA"
      BLOQ=$((BLOQ+1)); continue
    fi

    if contem "$V" "$TEM_DEFAULT"; then
      printf '%-30s %-22s %s\n' "$V" "default no codigo" "ok"
    else
      printf '%-30s %-22s %s\n' "$V" "lugar nenhum" "ja quebrado HOJE, nao e a virada"
      QUEBRADO=$((QUEBRADO+1))
    fi
  done <<< "$(nomes_das_functions)"

  echo
  echo "   $LEVO     eu levo daqui, sem console nenhum"
  echo "   $BLOQ     SO existem dentro da Supabase: tem que ser recuperadas ou rotacionadas"
  echo "   $QUEBRADO     nao existem em lugar nenhum: a function que as usa JA falha hoje"
  echo
  echo "   As que BLOQUEIAM: recupere o valor no console de origem, ponha num"
  echo "   arquivo KEY=VALUE e rode:"
  echo "      SEGREDOS=~/segredos.env bash infra/ha/configurar-secrets.sh --conferir"
  echo "   O veredito vira CONFERIDO igual a producao quando o valor estiver certo."
  ;;

# ===========================================================================
--aplicar)
  echo "== montando o conteudo em memoria (nada e gravado nesta maquina)"
  CONTEUDO="# Variaveis das Edge Functions no cluster.
# Gerado por infra/ha/configurar-secrets.sh -- NAO versionado, NAO editar a mao
# sem anotar de onde veio o valor. O compose le este arquivo em env_file.
"
  LEVADAS=0; FALTANDO=""
  while read -r V; do
    [ -n "$V" ] || continue
    contem "$V" "$SO_TESTE" && continue
    contem "$V" "$JA_NO_CLUSTER" && continue
    if VAL=$(valor_local "$V"); then
      CONTEUDO="$CONTEUDO$V=$VAL
"
      LEVADAS=$((LEVADAS+1))
    else
      contem "$V" "$TEM_DEFAULT" || FALTANDO="$FALTANDO $V"
    fi
  done <<< "$(nomes_das_functions)"
  echo "   $LEVADAS variaveis com valor em maos"
  [ -n "$FALTANDO" ] && { echo "   sem valor ainda:"; printf '     %s\n' $FALTANDO; }

  for NO in "$BANCO1" "$BANCO2"; do
    echo
    echo "===== $NO ====="
    printf '%s' "$CONTEUDO" | ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
      "root@$NO" "umask 077; cat > $ARQ_NO && chmod 600 $ARQ_NO && echo '   arquivo gravado com '\$(grep -c '^[A-Z]' $ARQ_NO)' variaveis'" \
      || { echo "   falhou gravar em $NO" >&2; exit 1; }

    # O compose precisa LER o arquivo. env_file entra como irmao de
    # environment:, e environment GANHA dele -- e por isso que SUPABASE_URL
    # continua sendo http://kong:8000 mesmo se alguem puser outro valor aqui.
    em "$NO" "
      set -e
      if grep -q 'segredos-functions.env' $COMPOSE_NO; then
        echo '   compose ja aponta para o arquivo'
      else
        cp -n $COMPOSE_NO $COMPOSE_NO.antes-dos-segredos
        awk '
          /^  functions:/ { dentro=1 }
          dentro && /^    environment:/ && !feito {
            print \"    env_file:\"
            print \"      - ./segredos-functions.env\"
            feito=1
          }
          /^  [a-z]+:/ && !/^  functions:/ { dentro=0 }
          { print }
        ' $COMPOSE_NO > $COMPOSE_NO.novo
        # Trava: nunca publicar um compose que encolheu ou nao ganhou as 2 linhas
        A=\$(wc -l < $COMPOSE_NO); B=\$(wc -l < $COMPOSE_NO.novo)
        if [ \"\$B\" -ne \$((A+2)) ]; then
          echo \"   compose nao ficou com 2 linhas a mais (\$A -> \$B); nao mexi\" >&2
          rm -f $COMPOSE_NO.novo; exit 1
        fi
        mv $COMPOSE_NO.novo $COMPOSE_NO
        echo '   compose alterado (copia em .antes-dos-segredos)'
      fi
      cd /opt/erp/infra/failover
      docker compose -f docker-compose.cluster.yml --env-file .env up -d functions 2>&1 | tail -3
      sleep 6
      echo -n '   variaveis no container agora: '
      docker exec erp-pilha-functions-1 env 2>/dev/null | grep -c '^[A-Z]' || echo '?'
    " || { echo "   falhou em $NO" >&2; exit 1; }
  done

  echo
  echo "== provando que o runtime continua servindo as functions"
  ANON=$(em "$BANCO1" "grep -m1 '^ANON_KEY=' /opt/erp/infra/failover/.env | cut -d= -f2-" | tr -d '\r\n')
  for NO in "$BANCO1" "$BANCO2"; do
    for F in chamado-info tvg-ia; do
      printf '   %-16s %-14s -> %s\n' "$NO" "$F" \
        "$(curl -s -o /dev/null -w '%{http_code}' -m 20 \
             --resolve "api.grpnascimento.com.br:443:$NO" \
             -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
             "https://api.grpnascimento.com.br/functions/v1/$F")"
    done
  done
  echo
  echo "   401 e 405 sao o esperado (function viva, pedindo credencial ou POST)."
  echo "   404 significa runtime fora do ar -- nesse caso rode --provar."
  ;;

# ===========================================================================
--provar)
  ANON=$(em "$BANCO1" "grep -m1 '^ANON_KEY=' /opt/erp/infra/failover/.env | cut -d= -f2-" | tr -d '\r\n')
  for NO in "$BANCO1" "$BANCO2"; do
    echo "===== $NO ====="
    em "$NO" "
      echo -n '   arquivo de segredos: '
      [ -f $ARQ_NO ] && echo \$(grep -c '^[A-Z]' $ARQ_NO)' variaveis, permissao '\$(stat -c %a $ARQ_NO) || echo 'NAO EXISTE'
      echo -n '   compose aponta para ele: '
      grep -q 'segredos-functions.env' $COMPOSE_NO && echo sim || echo NAO
      echo -n '   container: '
      docker exec erp-pilha-functions-1 env 2>/dev/null | grep -c '^[A-Z]' || echo 'nao respondeu'
      echo '   nomes que o container NAO tem (dos que as functions leem):'
    " || continue
    TEM=$(em "$NO" "docker exec erp-pilha-functions-1 env 2>/dev/null | cut -d= -f1 | sort")
    while read -r V; do
      [ -n "$V" ] || continue
      contem "$V" "$SO_TESTE" && continue
      contem "$V" "$TEM_DEFAULT" && continue
      printf '%s\n' "$TEM" | grep -qx "$V" || printf '     %s\n' "$V"
    done <<< "$(nomes_das_functions)"
  done
  ;;

*)
  sed -n '2,45p' "$0"
  exit 2
  ;;
esac
