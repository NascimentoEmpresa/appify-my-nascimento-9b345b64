# Incidente 13/11/2026 — API do banco1 fora por ~5 h

## Resumo

Das **04:00 às ~09:05 BRT** a API do `banco1` (Kong, Auth, REST, Storage)
ficou parada. O PostgreSQL nunca caiu e o `banco2` atendeu normalmente — mas
`api.grpnascimento.com.br` tem dois registros A, então **quem caía no IP do
banco1 recebia 502** do Caddy, sem cabeçalho CORS. O navegador mostrava erro de
CORS e o ERP cobria a tela com "Instabilidade / 404". Aba anônima, reiniciar o
PC ou limpar dados "resolvia" só porque trocava, por acaso, o IP usado.

Diagnóstico e restauração feitos pelo Codex na manhã de 13/11 (Grafana MCP +
SSH somente leitura; depois `docker start` dos containers existentes, sem
recriar nada).

## Linha do tempo (UTC)

| Hora | Evento |
|---|---|
| 07:00:00 | `apt-daily-upgrade` instala atualizações de segurança (libc6) |
| 07:00:43 | needrestart para o `containerd`; o `dockerd` perde o runtime |
| 07:00:58 | `dockerd`: "Force shutdown daemon". Kong/Auth/Storage `Exited (0)`, REST `Exited (255)` |
| 07:01:00 | `docker.service` volta. **Nenhum container volta** (`restarts=0`, política `unless-stopped`) |
| 07:01–12:04 | Caddy sem nada na porta 8000 → 502 sem CORS em metade dos acessos |
| ~11:55 | Codex isola o defeito testando cada IP separadamente |
| 12:04–12:07 | Auth, REST, Storage e Kong religados, um por vez; preflight e auth 200 |

## Causas

1. **needrestart podia reiniciar docker/containerd.** `infra/ha/atualizacoes-seguras.sh`
   protegia só patroni, etcd, postgresql e wg-quick.
2. **`restart: unless-stopped` não trouxe a pilha de volta** quando o
   containerd caiu antes do dockerd. O Docker voltou em 17 s; os containers não.
3. **Ninguém viu.** O alerta de 5xx soma os dois nós; Kong parado não gera log,
   então o Grafana só enxergava os 200 do banco2. O vigia de 30 min não testa a
   API de cada nó.
4. **DNS round-robin sem health check.** Nada tira do tráfego um nó cuja API
   está fora.

## Correções

| Item | Onde | Estado |
|---|---|---|
| needrestart não reinicia `docker`/`containerd` | `infra/ha/atualizacoes-seguras.sh` | **aplicado** nos 2 nós em 17/11 (~00:30 UTC de 18/11), sem reinício; backup em `/etc/needrestart/conf.d/99-cluster-ha.conf.bak-20261117` |
| `restart: always` nos 5 containers | `infra/failover/docker-compose.cluster.yml` | **aplicado** nos 2 nós com `docker update --restart=always` (sem recriar; horário de início dos containers inalterado) |
| Healthcheck real em Auth/REST/Storage/Functions | compose | pendente — exige recriar containers, fazer nó a nó em janela |
| `live-restore` no Docker | `/etc/docker/daemon.json` | pendente — exige reload do daemon |
| Sonda blackbox **por nó** no Alloy + alertas (API de um nó fora > 1 min, "sem dados" = falha) | `infra/observabilidade/config.alloy` | pendente |
| Balanceador / DNS com health check na frente dos 2 IPs | DNS hoje no Registro.br (sem health check) | pendente — decidir entre Cloudflare e HAProxy+VIP |
| Watchdog limitado (`docker compose up -d --no-recreate`) | — | pendente |

Validação após aplicar (17/11, de fora, em cada IP com `--resolve`): preflight
CORS de `/rest/v1/rpc/sistema_saude` → 200; `/auth/v1/health` → 200.

## Em aberto: disco do banco2

| Data | Uso | Livre |
|---|---|---|
| 13/11 | 87% | 6,2 GB |
| 17/11 | **91%** | **4,5 GB** |

O disco tem 49 GB. O grosso é anexo: `/var/backups/erp-cluster` (16 GB —
backups do banco e dos arquivos de anexos, retenção proposital) e o volume do
Storage (9,1 GB). Imagens Docker não usadas liberariam só ~0,8 GB.

**Decisão (Eduardo, 17/11):** não ampliar o disco agora. A empresa comprou um
servidor físico (rack, 2 TB) que vai receber, por SSH, os arquivos com mais de
**15 dias**: nos nós da nuvem ficam só os últimos 15 dias de anexos/backups. O
espaço do banco2 se resolve quando esse servidor estiver configurado. Até lá,
acompanhar o alerta "Disco > 85%" — abaixo de ~2 GB livres o Postgres do banco2
corre risco e a decisão precisa ser revista.
