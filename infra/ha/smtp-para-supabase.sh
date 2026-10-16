#!/usr/bin/env bash
# ============================================================================
#  O SMTP QUE FALTA NA SUPABASE (e conserta o Comite de Etica)
#
#  O QUE ESTA QUEBRADO HOJE
#  As Edge Functions que mandam e-mail leem SMTP_HOST, SMTP_PORT, SMTP_USER e
#  SMTP_PASS. Nenhuma das quatro esta nos secrets do projeto -- e o Comite de
#  Etica devolve `HTTP 500 - SMTP nao configurado` por causa disso.
#
#  E O ACHADO: as quatro estao em `worker/.env` ha meses. O worker manda
#  e-mail normalmente, com elas, do outro lado da parede. Ninguem tinha
#  comparado as duas listas.
#
#  POR QUE UM SCRIPT, E NAO UM COMANDO NO TERMINAL
#  `supabase secrets set SMTP_PASS=...` deixa a senha no `.bash_history`, nos
#  logs do shell e na tela. Aqui os valores saem de `worker/.env` e vao para a
#  CLI por um arquivo temporario que e apagado com `shred` no fim, inclusive
#  se o script falhar no meio. Nenhum valor aparece na tela: a prova de que
#  chegou e o digest SHA256 que a Supabase devolve.
#
#  ANTES DE APLICAR, LEIA O --conferir
#  Ligar o SMTP faz um sistema que estava mudo comecar a falar. O `--conferir`
#  mostra quantos alertas estao pendentes e quantas pessoas estao cadastradas
#  para receber -- a regra da casa e mostrar a fila ANTES de ligar qualquer
#  coisa que fale com gente de verdade.
#
#  USO
#    bash infra/ha/smtp-para-supabase.sh --conferir
#    bash infra/ha/smtp-para-supabase.sh --aplicar
# ============================================================================
set -uo pipefail

REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
BANCO1="${BANCO1:-216.238.120.171}"
PORTA_SSH="${PORTA_SSH:-8443}"
ORIGEM_HOST="${ORIGEM_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
VARS="SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS"
ACAO="${1:---conferir}"

cd "$(dirname "$0")/../.." || exit 1

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
CLI=$(achar_cli) || { echo "nao achei a CLI da supabase (nem no PATH, nem no cache do npx)" >&2; exit 1; }

digest_de() {  # digest_de <NOME>  -> o sha256 que a Supabase guarda, ou vazio
  "$CLI" secrets list --project-ref "$REF" 2>/dev/null \
    | tr '{' '\n' | sed -nE "s/.*\"name\":\"$1\",\"value\":\"([0-9a-f]{64})\".*/\1/p" | head -1
}

echo "== as quatro, em worker/.env e na Supabase"
FALTAM=""
for V in $VARS; do
  VAL=$(grep -m1 "^$V=" worker/.env 2>/dev/null | cut -d= -f2- | tr -d '\r\n')
  D=$(digest_de "$V")
  if [ -z "$VAL" ]; then
    printf '   %-12s  worker/.env: NAO TEM     Supabase: %s\n' "$V" "${D:+ja esta}${D:-nao esta}"
    continue
  fi
  H=$(printf '%s' "$VAL" | sha256sum | cut -c1-64)
  if [ -z "$D" ]; then
    printf '   %-12s  worker/.env: tem         Supabase: NAO ESTA  <- vai\n' "$V"
    FALTAM="$FALTAM $V"
  elif [ "$D" = "$H" ]; then
    printf '   %-12s  worker/.env: tem         Supabase: IGUAL, nada a fazer\n' "$V"
  else
    printf '   %-12s  worker/.env: tem         Supabase: DIFERENTE <- vai sobrescrever\n' "$V"
    FALTAM="$FALTAM $V"
  fi
done

echo
echo "== o que acontece quando o e-mail voltar a funcionar"
PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local 2>/dev/null | cut -d= -f2- | tr -d '\r\n')
if [ -n "$PW" ]; then
  ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 "root@$BANCO1" \
    "SENHA='$PW' bash -s" <<REMOTO 2>&1 | sed 's/^/   /'
PGPASSWORD="\$SENHA" psql -h $ORIGEM_HOST -p 5432 -U postgres.$REF -d postgres -At -F' | ' -c "
  select 'destinatarios ativos do aviso de denuncia', count(*)::text
    from public.\"CANAL_DENUNCIA_AVISO_EMAIL\" where ativo
  union all
  select 'avisos que falharam por falta de SMTP', count(*)::text
    from public.\"CANAL_DENUNCIA_AVISO_LOG\" where not ok
  union all
  select 'denuncias no canal', count(*)::text from public.\"CANAL_DENUNCIA\"
" 2>&1 | head -6
REMOTO
else
  echo "   (sem SENHA_ACESSO_SUPABASE em .env.local; nao consegui olhar a fila)"
fi
echo
echo "   Quem usa o SMTP e a \`comite-etica-nova-denuncia\`: ela avisa por"
echo "   e-mail os destinatarios ativos quando entra uma denuncia nova. Hoje"
echo "   ela devolve 500 'SMTP nao configurado' e registra a falha no log."
echo
echo "   NAO HA DISPARO RETROATIVO. A function e chamada por denuncia nova,"
echo "   nao por cron -- ligar o SMTP agora nao reenvia o que falhou antes."
echo "   E se 'destinatarios ativos' for 0, ela nem tenta enviar."

if [ "$ACAO" != "--aplicar" ]; then
  echo
  echo "   Para aplicar:  bash infra/ha/smtp-para-supabase.sh --aplicar"
  exit 0
fi

[ -n "$FALTAM" ] || { echo; echo "Nada a aplicar: as quatro ja estao iguais na Supabase."; exit 0; }

echo
echo "== aplicando:$FALTAM"
TMP=$(mktemp -d)
limpar() {
  [ -d "$TMP" ] || return 0
  find "$TMP" -type f -exec shred -u {} \; 2>/dev/null || rm -f "$TMP"/* 2>/dev/null
  rmdir "$TMP" 2>/dev/null
}
trap limpar EXIT INT TERM

ARQ="$TMP/smtp.env"
( umask 077; : > "$ARQ" )
for V in $FALTAM; do
  grep -m1 "^$V=" worker/.env | tr -d '\r' >> "$ARQ"
done
echo "   $(grep -c '^SMTP' "$ARQ") variaveis no arquivo temporario"

"$CLI" secrets set --env-file "$ARQ" --project-ref "$REF" 2>&1 | grep -v '^$' | sed 's/^/   /'
limpar; trap - EXIT INT TERM

echo
echo "== provando pelo digest (o unico jeito: a Supabase nunca devolve o valor)"
# A lista nao fica pronta no mesmo instante do `set`: em 16/10/2026 ela voltou
# sem as quatro um segundo depois e com as quatro meio minuto depois. Sem esta
# espera, o script acusaria falha num set que deu certo -- e "nao conferiu"
# manda consertar o que nao esta quebrado.
for TENTATIVA in 1 2 3 4 5; do
  TODAS_OK=1
  for V in $VARS; do
    VAL=$(grep -m1 "^$V=" worker/.env 2>/dev/null | cut -d= -f2- | tr -d '\r\n')
    [ -n "$VAL" ] || continue
    H=$(printf '%s' "$VAL" | sha256sum | cut -c1-64)
    [ "$(digest_de "$V")" = "$H" ] || TODAS_OK=0
  done
  [ "$TODAS_OK" = "1" ] && break
  printf '   (a lista ainda nao refletiu o set; tentativa %s de 5)\n' "$TENTATIVA"
  sleep 10
done
for V in $VARS; do
  VAL=$(grep -m1 "^$V=" worker/.env 2>/dev/null | cut -d= -f2- | tr -d '\r\n')
  [ -n "$VAL" ] || continue
  H=$(printf '%s' "$VAL" | sha256sum | cut -c1-64)
  D=$(digest_de "$V")
  if [ "$D" = "$H" ]; then printf '   %-12s CONFERIDO igual ao do worker\n' "$V"
  else printf '   %-12s NAO CONFERE (digest %s)\n' "$V" "${D:-ausente}"; fi
done
echo
echo "   O deploy das functions NAO e necessario: secret novo vale na proxima"
echo "   invocacao. Para provar de verdade, abra o Canal de Etica e dispare um"
echo "   alerta -- o 500 'SMTP nao configurado' tem que ter virado 200."
