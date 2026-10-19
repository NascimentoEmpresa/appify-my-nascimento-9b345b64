#!/usr/bin/env bash
# ============================================================================
#  O CERTIFICADO DO BANCO1 CHEGANDO AO BANCO2 SOZINHO
#
#  O PROBLEMA QUE ISTO RESOLVE
#  `api.grpnascimento.com.br` e atendido pelos dois nos, mas quem EMITE o
#  certificado e o banco1 (o Let's Encrypt valida por HTTP-01 e bate no
#  proprio dominio; com um registro A so, ele nunca alcancaria o banco2 --
#  ver a secao 1.14 do roteiro). O banco2 serve uma COPIA.
#
#  Ate hoje essa copia era manual: `expor-api-https.sh --caddy-banco2`, rodado
#  a mao depois de cada renovacao. O certificado atual vence em 12/01/2027 e o
#  Caddy do banco1 renova sozinho uns 30 dias antes, em meados de dezembro.
#  Ou seja: por volta de 12/12/2026 o banco1 passa a servir um certificado
#  novo e o banco2 continua com o velho ate alguem lembrar. No dia 12/01/2027
#  metade dos acessos (os que caissem no banco2) veria "certificado expirado"
#  no navegador -- e ninguem estaria olhando, porque nada quebra ate quebrar.
#
#  Uma renovacao esquecida nao e um risco teorico: e a causa mais comum de
#  queda em infraestrutura que "estava funcionando havia meses".
#
#  COMO ISTO FUNCIONA SEM CHAVE NOVA NENHUMA
#  O espelho de anexos ja tem uma chave SSH entre os nos
#  (`/root/.ssh/espelho_anexos`) presa a um comando unico por
#  `command="/usr/local/sbin/espelho-permitido.sh"`, que aceita duas coisas:
#  consultar o caminho do volume do Docker e servir `rsync --server --sender`,
#  que e rsync SO DE LEITURA. Como o path vai nos argumentos do rsync, essa
#  mesma chave ja consegue LER qualquer arquivo do banco1 -- inclusive o
#  certificado. Nao criamos chave nova, nao afrouxamos nada.
#
#  (Isso tambem e uma observacao honesta sobre aquela trava: ela impede shell
#  e impede escrita, mas nao limita o caminho da leitura. Para o que ela
#  guarda -- anexos que o outro no ja tem -- esta de bom tamanho; mas vale
#  saber que ela da leitura ampla, nao leitura de uma pasta.)
#
#  TRES TRAVAS ANTES DE INSTALAR O ARQUIVO NOVO
#  1. o .crt tem que ser um certificado que o openssl consegue ler
#  2. a chave privada tem que CASAR com ele (crt novo + key velha = Caddy
#     sobe sem servir nada, e o erro aparece so no navegador)
#  3. a validade do novo tem que ser >= a do que esta instalado (nunca
#     substituir por um mais velho -- protege contra rsync de arquivo pela
#     metade e contra rollback acidental no banco1)
#
#  USO
#    bash infra/ha/espelhar-cert.sh --instalar   # uma vez
#    bash infra/ha/espelhar-cert.sh --agora      # roda ja, mostra o resultado
#    bash infra/ha/espelhar-cert.sh --conferir   # os dois nos, de fora
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
BANCO2="${BANCO2:-172.237.48.8}"
BANCO1_WG="${BANCO1_WG:-10.77.0.11}"
PORTA_SSH="${PORTA_SSH:-8443}"
DOMINIO="${DOMINIO:-api.grpnascimento.com.br}"
ACAO="${1:---conferir}"

em() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
         -o StrictHostKeyChecking=accept-new "root@$1" "$2"; }

case "$ACAO" in

--instalar)
  echo "== instalando o espelho do certificado no banco2"
  em "$BANCO2" "
set -e
cat > /usr/local/sbin/espelho-cert.sh <<'FIM'
#!/bin/bash
# Puxa o certificado do banco1 e instala AQUI, se for mais novo e valido.
# Instalado por infra/ha/espelhar-cert.sh -- nao editar a mao.
set -uo pipefail
PAR=\"\${PAR:-$BANCO1_WG}\"
DOM=\"\${DOM:-$DOMINIO}\"
CHAVE=/root/.ssh/espelho_anexos
ORIGEM=/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/\$DOM
DESTINO=/etc/caddy/cert-api
TMP=\$(mktemp -d); trap 'rm -rf \"\$TMP\"' EXIT

for F in \"\$DOM.crt\" \"\$DOM.key\"; do
  rsync -q --timeout=60 \
    -e \"ssh -i \$CHAVE -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new\" \
    \"root@\$PAR:\$ORIGEM/\$F\" \"\$TMP/\$F\" || { echo \"espelho-cert: falhou puxar \$F do \$PAR\"; exit 1; }
  [ -s \"\$TMP/\$F\" ] || { echo \"espelho-cert: \$F veio vazio\"; exit 1; }
done

# 1. e um certificado?
NOVO_FIM=\$(openssl x509 -enddate -noout -in \"\$TMP/\$DOM.crt\" 2>/dev/null | cut -d= -f2) \
  || { echo 'espelho-cert: .crt nao e certificado'; exit 1; }
[ -n \"\$NOVO_FIM\" ] || { echo 'espelho-cert: .crt sem data de validade'; exit 1; }

# 2. a chave casa com o certificado? (sem isto o Caddy sobe servindo nada)
A=\$(openssl x509 -noout -pubkey -in \"\$TMP/\$DOM.crt\" 2>/dev/null | sha256sum | cut -d' ' -f1)
B=\$(openssl pkey -pubout -in \"\$TMP/\$DOM.key\" 2>/dev/null | sha256sum | cut -d' ' -f1)
[ -n \"\$A\" ] && [ \"\$A\" = \"\$B\" ] || { echo 'espelho-cert: a chave privada NAO casa com o certificado'; exit 1; }

# nada mudou?
if [ -f \"\$DESTINO/\$DOM.crt\" ]; then
  F1=\$(openssl x509 -noout -fingerprint -sha256 -in \"\$DESTINO/\$DOM.crt\" 2>/dev/null)
  F2=\$(openssl x509 -noout -fingerprint -sha256 -in \"\$TMP/\$DOM.crt\" 2>/dev/null)
  if [ \"\$F1\" = \"\$F2\" ]; then
    echo \"espelho-cert: igual ao instalado, nada a fazer (vence \$NOVO_FIM)\"
    exit 0
  fi
  # 3. o novo vale mais que o velho?
  VELHO_FIM=\$(openssl x509 -enddate -noout -in \"\$DESTINO/\$DOM.crt\" | cut -d= -f2)
  if [ \"\$(date -d \"\$NOVO_FIM\" +%s)\" -lt \"\$(date -d \"\$VELHO_FIM\" +%s)\" ]; then
    echo \"espelho-cert: o do banco1 vence ANTES (\$NOVO_FIM < \$VELHO_FIM) -- nao troquei\"
    exit 1
  fi
fi

mkdir -p \"\$DESTINO\"; chmod 700 \"\$DESTINO\"
install -m 600 \"\$TMP/\$DOM.crt\" \"\$DESTINO/\$DOM.crt\"
install -m 600 \"\$TMP/\$DOM.key\" \"\$DESTINO/\$DOM.key\"
id caddy >/dev/null 2>&1 && chown -R caddy:caddy \"\$DESTINO\"
systemctl reload caddy || systemctl restart caddy
sleep 3
systemctl is-active --quiet caddy || { echo 'espelho-cert: CADDY NAO SUBIU com o certificado novo'; exit 1; }
echo \"espelho-cert: certificado novo instalado, vence \$NOVO_FIM\"
FIM
chmod 750 /usr/local/sbin/espelho-cert.sh

cat > /etc/systemd/system/espelho-cert.service <<'FIM'
[Unit]
Description=Copia o certificado do banco1 para este no, se mudou
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/espelho-cert.sh
FIM

# Diario. O Caddy renova ~30 dias antes de vencer, entao um dia de atraso na
# copia nao tem consequencia nenhuma -- e de hora em hora seria barulho.
cat > /etc/systemd/system/espelho-cert.timer <<'FIM'
[Unit]
Description=Espelho diario do certificado do banco1

[Timer]
OnCalendar=*-*-* 04:40:00 UTC
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
FIM

systemctl daemon-reload
systemctl enable --now espelho-cert.timer >/dev/null
echo -n '   timer: '; systemctl is-enabled espelho-cert.timer
echo -n '   proxima: '; systemctl list-timers espelho-cert.timer --no-pager 2>/dev/null | awk 'NR==2{print \$1, \$2, \$3}'
"
  echo
  echo "Agora rode uma vez para provar:  bash infra/ha/espelhar-cert.sh --agora"
  ;;

--agora)
  echo "== rodando o espelho no banco2"
  em "$BANCO2" "systemctl start espelho-cert.service; systemctl show espelho-cert.service -p ExecMainStatus --value; journalctl -u espelho-cert.service -n 6 --no-pager | tail -4"
  ;;

--conferir)
  echo "== validade e emissor do que cada no esta servindo agora"
  for NO in "$BANCO1" "$BANCO2"; do
    INFO=$(echo | openssl s_client -connect "$NO:443" -servername "$DOMINIO" 2>/dev/null \
            | openssl x509 -noout -enddate -issuer 2>/dev/null | tr '\n' ' ')
    printf '%-18s %s\n' "$NO" "${INFO:-nao respondeu na 443}"
    FIM=$(printf '%s' "$INFO" | sed -nE 's/.*notAfter=([^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+).*/\1/p')
    if [ -n "$FIM" ]; then
      DIAS=$(( ( $(date -d "$FIM" +%s) - $(date +%s) ) / 86400 ))
      printf '%-18s faltam %s dias\n' "" "$DIAS"
      [ "$DIAS" -lt 21 ] && echo "                   >>> MENOS DE 21 DIAS: confira a renovacao do banco1"
    fi
  done
  echo
  echo "== fingerprint, que e o que decide se sao o mesmo certificado"
  for NO in "$BANCO1" "$BANCO2"; do
    printf '%-18s %s\n' "$NO" \
      "$(echo | openssl s_client -connect "$NO:443" -servername "$DOMINIO" 2>/dev/null \
          | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)"
  done
  echo
  echo "== o timer do espelho no banco2"
  em "$BANCO2" "systemctl is-enabled espelho-cert.timer 2>/dev/null || echo 'NAO INSTALADO (rode --instalar)'"
  ;;

*)
  sed -n '2,50p' "$0"
  exit 2
  ;;
esac
