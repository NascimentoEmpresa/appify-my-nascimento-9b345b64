#!/usr/bin/env bash
# ============================================================================
#  Impede que as atualizacoes automaticas do Ubuntu derrubem o cluster.
#
#  O QUE ACONTECEU (09/10/2026, 06:50 UTC / 03:50 BRT): o
#  apt-daily-upgrade.timer rodou, o unattended-upgrades trocou ~110 pacotes
#  (libc6, systemd, openssh-server) e o needrestart -- que vem em modo
#  automatico -- REINICIOU O PATRONI. Resultado: failover nao planejado, com
#  35 s sem gravacao. O banco2 teve o Patroni reiniciado 7 vezes no mesmo dia.
#
#  O RISCO MAIOR: os tres nos tinham a MESMA janela (06:00 UTC + 60 min
#  aleatorios). No dia em que o sorteio juntar banco1 e banco2 no mesmo minuto,
#  os dois reiniciam ao mesmo tempo -- isso nao e failover, e apagao.
#
#  O QUE ESTE SCRIPT FAZ, e o que NAO faz:
#    - continua aplicando atualizacoes de seguranca, todo dia. Nao desligamos
#      seguranca para ganhar disponibilidade.
#    - proibe o needrestart de reiniciar patroni/etcd/postgres sozinho. Quem
#      derruba um no do cluster e uma pessoa, numa hora escolhida.
#    - separa as janelas em uma hora por no, para nunca coincidirem.
#    - mantem o reinicio automatico de maquina DESLIGADO.
#
#  Uso:  HORA=6 bash atualizacoes-seguras.sh      (6 = arbitro, 7 = banco1, 8 = banco2)
# ============================================================================
set -euo pipefail
: "${HORA:?defina HORA (UTC) desta maquina -- uma hora diferente por no}"
S=""; [ "$(id -u)" -ne 0 ] && S=sudo

# ── 1. needrestart nao encosta nos servicos do cluster ──────────────────────
$S install -d /etc/needrestart/conf.d
$S tee /etc/needrestart/conf.d/99-cluster-ha.conf >/dev/null <<'CFG'
# 0 = nunca reiniciar sozinho. Os pacotes sao atualizados do mesmo jeito; o
# servico so passa a usar a biblioteca nova quando ALGUEM o reiniciar de
# proposito. Para um no de banco em cluster, esse "alguem" nunca pode ser um
# timer as 3 da manha.
$nrconf{override_rc} = {
    qr(^patroni\.service$)   => 0,
    qr(^etcd\.service$)      => 0,
    qr(^postgresql.*)        => 0,
    qr(^wg-quick@.*)         => 0,
};
CFG

# ── 2. janela propria, sem sorteio ──────────────────────────────────────────
$S install -d /etc/systemd/system/apt-daily-upgrade.timer.d
$S tee /etc/systemd/system/apt-daily-upgrade.timer.d/99-cluster-ha.conf >/dev/null <<CFG
[Timer]
# OnCalendar vazio zera o horario herdado antes de declarar o novo; sem isso
# os dois valem e a janela antiga continua de pe.
OnCalendar=
OnCalendar=*-*-* 0${HORA}:00
# Sem atraso aleatorio: a separacao entre os nos e o que protege o cluster.
RandomizedDelaySec=0
CFG

# ── 3. nunca reiniciar a maquina sozinha ────────────────────────────────────
$S tee /etc/apt/apt.conf.d/99-cluster-ha >/dev/null <<'CFG'
// Reinicio de maquina e decisao humana, um no por vez, com o cluster
// saudavel. Automatico aqui significa os tres reiniciando na mesma madrugada.
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
CFG

$S systemctl daemon-reload
$S systemctl restart apt-daily-upgrade.timer
echo "  janela desta maquina: $($S systemctl list-timers apt-daily-upgrade.timer --all 2>/dev/null | awk 'NR==2{print $1,$2,$3}')"
echo "  needrestart: patroni, etcd, postgres e wg-quick protegidos"
