#!/bin/bash
# Instala o espelho de anexos nos dois bancos. Rode UMA VEZ, de qualquer lugar
# que alcance as duas maquinas por SSH:
#
#   ./infra/ha/instalar-espelho-anexos.sh 216.238.120.171 172.237.48.8
#
# Idempotente: rodar de novo nao duplica chave nem timer.
set -euo pipefail

B1="${1:?ip publico do banco1}"
B2="${2:?ip publico do banco2}"
PORTA="${PORTA:-443}"   # 443 porque a rede da empresa barra a 22 na saida

S() { ssh -p "$PORTA" -o BatchMode=yes "root@$1" "${@:2}"; }

echo "== 1. chave dedicada ao espelho em cada no"
for ip in "$B1" "$B2"; do
  S "$ip" "test -f /root/.ssh/espelho_anexos || ssh-keygen -q -t ed25519 -N '' -C espelho-anexos -f /root/.ssh/espelho_anexos"
done

echo "== 2. cada no autoriza a chave do outro, SO para rsync e SO pelo tunel"
# from=10.77.0.x: a chave nao serve de nada fora do WireGuard, nem com o IP
# publico na mao. restrict: sem porta, sem agente, sem tty, sem X11.
autorizar() {
  local destino="$1" origem_ip="$2" origem_wg="$3"
  local pub; pub=$(S "$origem_ip" "cat /root/.ssh/espelho_anexos.pub")
  S "$destino" "touch /root/.ssh/authorized_keys; chmod 600 /root/.ssh/authorized_keys
    grep -q 'espelho-anexos' /root/.ssh/authorized_keys && sed -i '/espelho-anexos/d' /root/.ssh/authorized_keys
    echo 'from=\"$origem_wg\",restrict,command=\"/usr/local/sbin/espelho-permitido.sh\" $pub' >> /root/.ssh/authorized_keys"
}
autorizar "$B1" "$B2" "10.77.0.12"
autorizar "$B2" "$B1" "10.77.0.11"

echo "== 3. a trava: a chave so consegue rodar duas coisas"
# command= no authorized_keys ignora o que o cliente pediu e roda ISTO. Entao a
# chave do espelho nao abre shell: ela consulta o caminho do volume ou serve um
# rsync de LEITURA. Se a chave vazar, o que ela da e copia de anexo, nao root.
for ip in "$B1" "$B2"; do
  S "$ip" "cat > /usr/local/sbin/espelho-permitido.sh <<'EOF'
#!/bin/bash
# Roda no lugar de qualquer comando que a chave do espelho pedir.
case \"\$SSH_ORIGINAL_COMMAND\" in
  'docker volume inspect erp-pilha_storage-arquivos --format '*)
      exec docker volume inspect erp-pilha_storage-arquivos --format '{{.Mountpoint}}' ;;
  'rsync --server --sender '*)
      exec \$SSH_ORIGINAL_COMMAND ;;
  *)  echo \"espelho: comando nao permitido\" >&2; exit 1 ;;
esac
EOF
  chmod 750 /usr/local/sbin/espelho-permitido.sh"
done

echo "== 4. o script do espelho e o timer de 1 minuto"
for ip in "$B1" "$B2"; do
  scp -q -P "$PORTA" "$(dirname "$0")/espelhar-anexos.sh" "root@$ip:/usr/local/sbin/espelhar-anexos.sh"
  S "$ip" "chmod 750 /usr/local/sbin/espelhar-anexos.sh
  cat > /etc/systemd/system/espelho-anexos.service <<'EOF'
[Unit]
Description=Espelha os arquivos de anexo vindos do outro banco
After=docker.service wg-quick@wg0.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/espelhar-anexos.sh
# Se o par estiver fora do ar isto falha, e falhar aqui e NORMAL: o proximo
# minuto tenta de novo. Por isso nao ha Restart= nem alarme.
SuccessExitStatus=0 1
EOF
  cat > /etc/systemd/system/espelho-anexos.timer <<'EOF'
[Unit]
Description=Espelho de anexos a cada minuto

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now espelho-anexos.timer >/dev/null
  systemctl is-enabled espelho-anexos.timer"
done

echo "== 5. primeira rodada, agora, nos dois sentidos"
for ip in "$B1" "$B2"; do
  echo "-- $ip"
  S "$ip" "systemctl start espelho-anexos.service; systemctl show espelho-anexos.service -p ExecMainStatus --value"
done
echo "pronto"
