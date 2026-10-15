#!/bin/bash
# ============================================================================
#  Expoe a API do cluster em https://api.grpnascimento.com.br
#
#  POR QUE ISTO E NECESSARIO
#  O frontend serve de https://app.grpnascimento.com.br. Um site HTTPS NAO pode
#  chamar uma API em HTTP -- o navegador bloqueia antes de sair, e nenhum teste
#  de `curl` mostra isso (essa armadilha ja custou 4 tentativas neste projeto).
#  Hoje o Kong do cluster escuta HTTP puro na 8000, com URL_EXTERNA apontando
#  para localhost. Sem este passo, o Marco B entrega tela branca.
#
#  O PROBLEMA DA PORTA, E POR QUE O SSH E QUE MUDA
#  A 443 dos nos esta ocupada pelo *sshd*, porque a rede da empresa bloqueia a
#  22 (ver memoria rede_empresa_bloqueia_saida_22). Medido em 14/10/2026, do
#  escritorio: saida 80 OK, 443 OK, 8443 OK, 8000 BLOQUEADA, 2222 BLOQUEADA.
#
#  Entao o SSH vai para a 8443 -- que so nos usamos -- e a 443 fica para os
#  usuarios, que e a porta que funciona em qualquer rede, inclusive no 4G de
#  quem esta em campo. O contrario (usuario na 8443) funcionaria do escritorio,
#  mas apostaria que toda rede de onde alguem abre o ERP permite porta
#  nao-padrao. Nao vale a aposta.
#
#  AS ETAPAS SAO SEPARADAS DE PROPOSITO
#  Nenhuma etapa tira o acesso antes da proxima estar provada:
#
#    --preparar      abre 80 e 8443 no ufw e ADICIONA a 8443 ao sshd.
#                    A 443 continua funcionando. Totalmente reversivel.
#    --provar        conecta pela 8443 nos dois nos e diz se esta de pe.
#    --liberar-443   so entao tira a 443 do sshd. Ele proprio reconfere a 8443
#                    antes de mexer, e recusa se ela nao estiver respondendo.
#    --caddy         instala o Caddy e sobe o HTTPS. Exige o DNS ja apontando.
#    --caddy-banco2  poe o SEGUNDO no atendendo o mesmo endereco, com o
#                    certificado copiado do banco1. Rodar ANTES de publicar o
#                    segundo registro A.
#    --conferir      mede o resultado de fora.
#
#  DNS: antes do --caddy, `A api.grpnascimento.com.br -> 216.238.120.171` tem
#  que estar publicado. O Let's Encrypt valida pela porta 80, por isso ela e
#  aberta no --preparar. DNS PRIMEIRO, SERVICO DEPOIS -- a ordem inversa foi o
#  que derrubou a producao em 14/10 ao conectar o dominio na Lovable.
#
#  SE PERDER O ACESSO: o console web da Vultr (banco1) e da Linode (banco2)
#  entra sem rede, e `sed -i '/^Port 8443/a Port 443' /etc/ssh/sshd_config`
#  seguido de `systemctl reload ssh` devolve a 443.
#
#  USO:
#    bash infra/ha/expor-api-https.sh --preparar
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
BANCO2="${BANCO2:-172.237.48.8}"
DOMINIO="${DOMINIO:-api.grpnascimento.com.br}"
ACAO="${1:-}"

em() {  # em <ip> <porta> <comando>
  ssh -p "$2" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "root@$1" "$3"
}

case "$ACAO" in

--preparar)
  for NO in "$BANCO1" "$BANCO2"; do
    echo "===== $NO ====="
    em "$NO" 443 "
      ufw allow 80/tcp   >/dev/null 2>&1
      ufw allow 8443/tcp >/dev/null 2>&1

      # DUAS ARMADILHAS, as duas pagas no banco2 em 14/10/2026:
      #
      # 1. Se o sshd for ativado por SOCKET (systemd), as diretivas 'Port' do
      #    sshd_config sao IGNORADAS -- quem manda e o ListenStream da unidade.
      #    Editar o sshd_config ali nao faz absolutamente nada, e o sintoma e
      #    mudo: a configuracao mostra a porta nova e ela nunca sobe.
      #
      # 2. ListenStream=<porta>, so com o numero, pode subir SO EM IPv6 (visto:
      #    'ss' mostrando apenas [::]:443 e IPv4 recusando conexao). Isso tira o
      #    acesso de quem chega por IPv4, que e o nosso caso. Por isso cada
      #    porta e declarada DUAS vezes, explicitamente, 0.0.0.0 e [::].
      if systemctl is-active --quiet ssh.socket 2>/dev/null; then
        mkdir -p /etc/systemd/system/ssh.socket.d
        cat > /etc/systemd/system/ssh.socket.d/portas.conf <<'SOCK'
[Socket]
ListenStream=
ListenStream=0.0.0.0:22
ListenStream=0.0.0.0:443
ListenStream=0.0.0.0:8443
ListenStream=[::]:22
ListenStream=[::]:443
ListenStream=[::]:8443
SOCK
        systemctl daemon-reload
        systemctl restart ssh.socket
      else
        # Porta ADICIONAL. A 443 so sai no --liberar-443, e so depois de provada.
        grep -qE '^Port 8443' /etc/ssh/sshd_config || sed -i '/^Port 443/a Port 8443' /etc/ssh/sshd_config
        systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null
      fi
      sleep 2
      echo -n 'portas no sshd_config: '; grep -E '^Port' /etc/ssh/sshd_config | tr '\n' ' '; echo
      echo -n 'sshd escutando em:     '; ss -tlnp 2>/dev/null | awk '/sshd/{n=split(\$4,a,\":\"); printf \"%s \", a[n]}'; echo
      echo    'ufw:'; ufw status 2>/dev/null | grep -E '^(80|443|8443)/tcp' | sed 's/^/  /'
    "
    echo
  done
  echo "Agora rode:  bash infra/ha/expor-api-https.sh --provar"
  ;;

--provar)
  OK=1
  for NO in "$BANCO1" "$BANCO2"; do
    printf '%-18s 8443 -> ' "$NO"
    if em "$NO" 8443 "hostname" 2>/dev/null; then :; else echo "FALHOU"; OK=0; fi
  done
  if [ "$OK" = 1 ]; then
    echo
    echo "Os dois nos respondem na 8443. Pode rodar:"
    echo "  bash infra/ha/expor-api-https.sh --liberar-443"
  else
    echo
    echo "NAO prossiga. A 443 continua ativa, entao nada foi perdido." >&2
    exit 1
  fi
  ;;

--liberar-443)
  # REDE DE SEGURANCA, aprendida da forma cara em 14/10/2026: uma mudanca de
  # porta de ssh feita por ssh pode cortar o galho em que se esta sentado. Cada
  # no agenda, DENTRO DELE MESMO, uma reversao em 5 minutos ANTES de mexer. Se
  # eu nao conseguir voltar, ela devolve a 443 sozinha. O --confirmar e que a
  # cancela, e so depois de a 8443 estar provada de fora.
  for NO in "$BANCO1" "$BANCO2"; do
    echo "===== $NO ====="
    if ! em "$NO" 8443 "true" 2>/dev/null; then
      echo "8443 nao responde neste no -- NAO vou tirar a 443. Pulando." >&2
      continue
    fi
    em "$NO" 8443 "
      cp -a /etc/ssh/sshd_config /root/sshd_config.antes-de-tirar-443
      [ -d /etc/systemd/system/ssh.socket.d ] && cp -a /etc/systemd/system/ssh.socket.d /root/ssh.socket.d.antes-de-tirar-443 2>/dev/null
      systemd-run --on-active=300 --unit=reverter-porta-443 /bin/bash -c '
        cp -a /root/sshd_config.antes-de-tirar-443 /etc/ssh/sshd_config
        [ -d /root/ssh.socket.d.antes-de-tirar-443 ] && cp -a /root/ssh.socket.d.antes-de-tirar-443/. /etc/systemd/system/ssh.socket.d/
        systemctl daemon-reload
        systemctl restart ssh.socket 2>/dev/null
        systemctl restart ssh 2>/dev/null' >/dev/null 2>&1
      echo 'reversao automatica armada (5 min)'

      sed -i '/^Port 443\$/d' /etc/ssh/sshd_config
      if systemctl is-active --quiet ssh.socket 2>/dev/null; then
        # Socket-activated: o sshd_config sozinho nao basta, o ListenStream manda.
        for f in /etc/systemd/system/ssh.socket.d/*.conf; do
          [ -e \"\$f\" ] && sed -i '/[:= ]443\$/d' \"\$f\"
        done
        systemctl daemon-reload
        systemctl restart ssh.socket
      fi
      systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null
      sleep 3
      echo -n 'escutando: '; ss -tln 2>/dev/null | awk '/:(22|443|8443) /{print \$4}' | tr '\n' ' '; echo
      echo -n '443 livre para o Caddy? '; (ss -tln 2>/dev/null | grep -q ':443 ' && echo 'NAO, ainda ocupada' || echo SIM)
    "
    echo
  done
  echo "AGORA, sem demorar:  bash infra/ha/expor-api-https.sh --confirmar"
  echo "(a reversao automatica dispara em 5 min se voce nao confirmar)"
  ;;

--confirmar)
  OK=1
  for NO in "$BANCO1" "$BANCO2"; do
    printf '%-18s 8443 -> ' "$NO"
    if em "$NO" 8443 "hostname" 2>/dev/null; then
      # `systemd-run --unit=X --on-active=` cria X.timer E X.service. Parar so
      # o timer nao bastou em 14/10: o erro foi engolido por um 2>/dev/null e a
      # reversao disparou 5 min depois, devolvendo a 443 e derrubando o Caddy
      # com "address already in use". Agora para os dois e CONFERE.
      em "$NO" 8443 "
        systemctl stop reverter-porta-443.timer reverter-porta-443.service 2>&1 | head -2
        systemctl reset-failed reverter-porta-443.service 2>/dev/null
        if systemctl list-units --all 2>/dev/null | grep -q reverter-porta-443; then
          echo '  ATENCAO: a reversao AINDA esta armada -- nao prossiga' >&2; exit 1
        fi
        rm -f /root/sshd_config.antes-de-tirar-443
        rm -rf /root/ssh.socket.d.antes-de-tirar-443
        echo '  reversao cancelada e conferida'"
    else
      echo "FALHOU -- NAO vou cancelar a reversao. Ela vai devolver a 443 sozinha." >&2
      OK=0
    fi
  done
  [ "$OK" = 1 ] && echo && echo "Proximo passo: bash infra/ha/expor-api-https.sh --caddy"
  ;;

--caddy)
  # Sem DNS publicado o Let's Encrypt nao emite e o Caddy fica em retry eterno.
  # `getent` nao existe no Git Bash do Windows, de onde este script e disparado:
  # usar so ele dava "resolve para nada" com o DNS perfeitamente publicado.
  IP=$(getent hosts "$DOMINIO" 2>/dev/null | awk '{print $1; exit}')
  [ -n "$IP" ] || IP=$(nslookup "$DOMINIO" 8.8.8.8 2>/dev/null | awk '/^Address: /{a=$2} END{print a}')
  if [ "$IP" != "$BANCO1" ]; then
    echo "$DOMINIO resolve para '${IP:-nada}', esperado $BANCO1." >&2
    echo "Publique o DNS e espere propagar antes de rodar isto." >&2
    exit 1
  fi
  em "$BANCO1" 8443 "
    set -e
    if ! command -v caddy >/dev/null; then
      apt-get update -qq
      apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
      curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      echo 'deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main' > /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -qq && apt-get install -y -qq caddy
    fi
    cat > /etc/caddy/Caddyfile <<'CADDY'
# A API do ERP. O Kong da pilha escuta em 127.0.0.1:8000, HTTP puro; quem
# termina o TLS e quem responde ao Let's Encrypt e o Caddy.
#
# CORS NAO e tratado aqui, de proposito: quem responde ao preflight tem que ser
# o Kong, porque e ele que conhece as rotas do PostgREST/GoTrue. Tratar aqui
# daria cabecalho duplicado em Access-Control-Allow-Origin, e o navegador
# recusa resposta com o cabecalho repetido -- falha que so aparece no
# navegador, nunca no curl.
api.grpnascimento.com.br {
	encode gzip
	reverse_proxy 127.0.0.1:8000 {
		header_up X-Forwarded-For {remote_host}
		header_up X-Forwarded-Proto {scheme}
	}
}
CADDY
    caddy validate --config /etc/caddy/Caddyfile
    systemctl enable --now caddy
    systemctl restart caddy
    sleep 10
    echo -n 'caddy: '; systemctl is-active caddy
  "
  echo "Agora: bash infra/ha/expor-api-https.sh --conferir"
  ;;

--caddy-banco2)
  # O SEGUNDO NO ATENDENDO O MESMO ENDERECO.
  #
  # Problema que isto resolve: o banco troca de lider sozinho, mas
  # `api.grpnascimento.com.br` resolvia so para o banco1. O no que morresse
  # inteiro levava o ERP junto, com o banco intacto do outro lado -- metade da
  # alta disponibilidade que montamos.
  #
  # Medido em 15/10/2026, e e o que torna isto barato: os dois nos estao em Sao
  # Paulo (Vultr Osasco e Linode SP) e o tunel entre eles tem 1,5 ms. Dividir o
  # trafego entre os dois nao custa latencia nenhuma.
  #
  # POR QUE AQUI O CERTIFICADO E COPIADO, E NAO EMITIDO
  # O Let's Encrypt valida por HTTP-01: ele bate no proprio dominio. Com um
  # registro A so (banco1), o banco2 nunca seria alcancado e o Caddy ficaria em
  # retry eterno -- servindo, nesse meio tempo, um certificado interno que o
  # navegador recusa. Com DOIS registros A, a validacao cai em um dos dois por
  # sorteio e falha na metade das vezes.
  #
  # A saida e a ordem certa: copiar o certificado que o banco1 ja tem, subir o
  # banco2 JA servindo um certificado valido, e so depois publicar o segundo
  # registro A. E a mesma licao do dominio na Lovable: DNS primeiro, servico
  # depois -- ou, aqui, servico PRONTO primeiro, DNS depois.
  #
  # RENOVACAO: quem renova e o banco1, sozinho, e este comando e quem leva a
  # copia. Rodar de novo depois de cada renovacao (o atual vence em
  # 12/01/2027). Nao ha automacao para isso ainda, e esta frase existe para
  # ninguem descobrir pelo navegador.
  CERT="/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$DOMINIO"
  echo "== copiando o certificado do banco1 para o banco2 (sem tocar o disco daqui)"
  ssh -p 8443 -o BatchMode=yes "root@$BANCO2" "mkdir -p /etc/caddy/cert-api && chmod 700 /etc/caddy/cert-api"
  for F in "$DOMINIO.crt" "$DOMINIO.key"; do
    ssh -p 8443 -o BatchMode=yes "root@$BANCO1" "cat '$CERT/$F'" \
      | ssh -p 8443 -o BatchMode=yes "root@$BANCO2" "cat > /etc/caddy/cert-api/$F && chmod 600 /etc/caddy/cert-api/$F" \
      || { echo "falhou copiar $F" >&2; exit 1; }
    printf '   %s ok\n' "$F"
  done

  em "$BANCO2" 8443 "
    set -e
    if ! command -v caddy >/dev/null; then
      apt-get update -qq
      apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
      curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      echo 'deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main' > /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -qq && apt-get install -y -qq caddy
    fi
    id caddy >/dev/null 2>&1 && chown -R caddy:caddy /etc/caddy/cert-api || true
    cat > /etc/caddy/Caddyfile <<'CADDY'
# A API do ERP, no SEGUNDO no. Identico ao banco1 em tudo menos uma linha: o
# certificado vem de arquivo, nao do Let's Encrypt.
#
# CORS NAO e tratado aqui, de proposito: quem responde ao preflight e o Kong,
# que conhece as rotas. Tratar nos dois duplicaria Access-Control-Allow-Origin
# e o navegador recusa cabecalho repetido -- falha que so aparece no navegador,
# nunca no curl.
api.grpnascimento.com.br {
	tls /etc/caddy/cert-api/api.grpnascimento.com.br.crt /etc/caddy/cert-api/api.grpnascimento.com.br.key
	encode gzip
	reverse_proxy 127.0.0.1:8000 {
		header_up X-Forwarded-For {remote_host}
		header_up X-Forwarded-Proto {scheme}
	}
}
CADDY
    caddy validate --config /etc/caddy/Caddyfile
    command -v ufw >/dev/null && ufw allow 443/tcp >/dev/null 2>&1 || true
    systemctl enable --now caddy
    systemctl restart caddy
    sleep 6
    echo -n '   caddy no banco2: '; systemctl is-active caddy
  "

  echo
  # A chave anon nao e gravada em arquivo nenhum: vem do no, em tempo de uso.
  ANON=$(ssh -p 8443 -o BatchMode=yes "root@$BANCO1" "grep -m1 '^ANON_KEY=' /opt/erp/infra/failover/.env | cut -d= -f2-" | tr -d '
')

  echo "== provando o banco2 pelo nome, antes de qualquer mudanca de DNS"
  echo "   (--resolve finge que o DNS ja aponta para la; o resto e real)"
  for P in /auth/v1/health '/rest/v1/CHAMADO_SISTEMA?select=id&limit=1'; do
    printf '   %-44s -> %s\n' "$P" \
      "$(curl -s -o /dev/null -w '%{http_code}' -m 15 --resolve "$DOMINIO:443:$BANCO2" \
           -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "https://$DOMINIO$P")"
  done
  echo -n '   certificado servido pelo banco2: '
  curl -sv --resolve "$DOMINIO:443:$BANCO2" "https://$DOMINIO/" 2>&1 \
    | grep -E 'subject:|expire date' | tr '\n' ' ' | sed 's/^ *//'
  echo
  echo
  echo "Se as duas linhas acima vieram 200 e o certificado e o do dominio, o"
  echo "banco2 ja atende. Falta so o DNS, no registro.br:"
  echo "   acrescentar  A  api  $BANCO2   (mantendo o do $BANCO1)"
  ;;

--conferir)
  echo "=== DNS ==="
  for R in 8.8.8.8 1.1.1.1; do
    printf '%-10s ' "$R"
    nslookup "$DOMINIO" "$R" 2>/dev/null | awk '/^Address: /{a=$2} END{print a}'
  done
  echo
  echo "=== HTTPS, de fora ==="
  # No Git Bash do Windows, texto comecado por '/' dentro do -w vira caminho
  # C:\...\ e o rotulo sai ilegivel -- por isso o rotulo vai no printf, fora do
  # -w. Nao use MSYS_NO_PATHCONV para resolver isso: ele tambem para de
  # traduzir o /dev/null do -o, e o curl passa a falhar com erro 23.
  medir() { # medir <rotulo> <caminho>
    printf '%-22s ' "$1"
    curl -sS -m 20 -o /dev/null -w 'status=%{http_code}  tls=%{ssl_verify_result}\n' "https://$DOMINIO$2" || echo "FALHOU"
  }
  medir "raiz"            "/"
  medir "rest/v1(401=ok)" "/rest/v1/"
  medir "auth/v1/health"  "/auth/v1/health"
  echo "(tls=0 significa certificado valido)"
  echo
  # O QUE DE FATO DECIDE SE O ERP FUNCIONA. O navegador manda um OPTIONS antes
  # de qualquer chamada com cabecalho, e so prossegue se vier
  # Access-Control-Allow-Origin. `curl` simples NAO exerce esse caminho -- foi
  # assim que a contingencia passou 4 vezes nos testes e falhou no navegador.
  echo "=== preflight de CORS (OPTIONS), vindo do frontend ==="
  curl -sS -m 20 -i -X OPTIONS "https://$DOMINIO/rest/v1/" \
    -H "Origin: https://app.grpnascimento.com.br" \
    -H "Access-Control-Request-Method: GET" \
    -H "Access-Control-Request-Headers: apikey,authorization,content-type" 2>&1 \
    | grep -i -E '^HTTP/|^access-control-' | sed 's/^/  /' || echo "  sem resposta"
  ;;

*)
  sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
