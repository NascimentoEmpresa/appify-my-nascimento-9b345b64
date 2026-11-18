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
| Healthcheck real em Auth/REST/Storage/Functions | compose | **descartado** (18/11): a imagem do REST e a do Functions não têm shell/wget/curl, o Kong já tem o da imagem, e o Docker não age sobre "unhealthy". A sonda por nó cobre o mesmo de fora, sem recriar nada |
| `live-restore` no Docker | `/etc/docker/daemon.json` | **aplicado** nos 2 nós em 18/11 ~00:15 UTC com `systemctl reload docker` (reloadável no Docker 29; validado com `dockerd --validate`; horário de início dos containers inalterado) |
| Sonda blackbox **por nó** no Alloy + alertas (API de um nó fora > 1 min, "sem dados" = falha) | `infra/observabilidade/config.alloy` | sonda **aplicada** nos 2 nós em 18/11 ~00:12 UTC (reload, sem reinício; 8 alvos `up` em cada nó; backup `/etc/alloy/config.alloy.bak-20261117`). Alertas: criar no Grafana conforme `infra/observabilidade/README.md` §4 |
| Balanceador / DNS com health check na frente dos 2 IPs | DNS hoje no Registro.br (sem health check) | pendente — decisão do Eduardo; roteiro abaixo |
| Vigia limitado: religa container parado (`docker start`, nunca recria), 3×/hora, pausável | `infra/ha/vigia-pilha.sh` (timer de 2 min) | **instalado** nos 2 nós em 18/11 ~00:17 UTC; testado no banco2 com containers descartáveis (ordem, limite por hora, pausa) |

Validação após aplicar (17/11, de fora, em cada IP com `--resolve`): preflight
CORS de `/rest/v1/rpc/sistema_saude` → 200; `/auth/v1/health` → 200.

## Em aberto: balanceador com health check

Sem ele, um nó com a API fora continua recebendo metade dos acessos — as
camadas acima reduzem a chance e o tempo, não o efeito.

**IP virtual (keepalived/HAProxy) não serve aqui:** banco1 está na Vultr e
banco2 na Linode, e IP flutuante não atravessa provedor. Um HAProxy numa
terceira máquina vira ponto único de falha.

**Recomendado: Cloudflare Load Balancing em modo DNS-only** (nuvem cinza —
TLS continua no Caddy de cada nó, sem limite de upload do proxy):

1. Exportar TODOS os registros de `grpnascimento.com.br` do Registro.br
   (inclusive `app.` da Lovable e e-mail) e conferir um a um no Cloudflare
   antes de trocar os nameservers — "DNS primeiro, serviço depois" (14/10).
2. Trocar os nameservers no Registro.br para os do Cloudflare (plano grátis).
3. Load Balancing (~US$ 5/mês): pool com os 2 IPs, monitor HTTPS
   `GET /auth/v1/health` esperando 200, Host `api.grpnascimento.com.br`;
   tirar o nó após 2 falhas, devolver após sucessos seguidos; TTL 30 s.
4. Notificação quando o pool ficar com 1 nó só.

Alternativa sem custo mensal: só o DNS no Cloudflare (grátis) e um script
(no runner ou no árbitro) que tira/devolve o registro A pela API do
Cloudflare a partir da mesma sonda. Funciona, mas é mais uma peça nossa
para manter.

## Disco do banco2 — encaminhado em 18/11

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

**18/11/2026 — servidor configurado** (`infra/servidor-local/README.md`).
Ajuste da regra, com o servidor pronto: os anexos **continuam todos na nuvem**
(se saíssem, o ERP não abriria anexo antigo, porque o servidor da empresa não é
acessível pela internet). O que sai são os **backups**, que eram os 16 GB:
o servidor da empresa puxa os `.gpg` todo dia às 05:00 BRT e devolve recibo; o
`podar-backups` dos nós (08:30 BRT) apaga só o que tem recibo conferido — banco
com mais de 3 dias, anexos menos o mais novo. Esperado depois da primeira
carga (madrugada de 19/11): ~8 GB liberados por nó, banco2 de 91% para ~75%.
Cadeia testada em 18/11 com o backup do dia (sha256 igual nas duas pontas;
poda simulada).
