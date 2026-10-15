# Onde estamos — 15/10/2026, 08h

Relatório reescrito às 08h de 15/10. **A versão que você leu antes tinha o
item 1 errado** — e o erro está explicado abaixo, não apagado.

Ordem de prioridade mudou: o que mais dói agora não é o cluster, é o worker.

---

## 🔴 1. O worker está parado desde 17h16 de ontem — e as automações do ERP com ele

Isto é o de maior impacto no negócio hoje, e passa na frente do cluster.

Com o worker morto, **nada da fila é processado**. A fila só cresce, e o cron
continua empilhando:

| Destino | Pendentes | Desde | O que deixou de acontecer |
|---|---|---|---|
| `novidade-ia-chamado` | 10 | 06/10 13:27 | só insere em `SISTEMA_NOVIDADES` |
| `sla-escalonamento-tick` | 1 | 14/10 21:00 | **SLA não escalou nada** |
| `regua-cobranca-tick` | 1 | 14/10 21:00 | **régua de cobrança não rodou** |
| `plano-acao-marcar-atrasadas` | 1 | 15/10 06:00 | plano de ação não marcou atrasadas |
| `comite-etica-alertas-tick` | 1 | 15/10 08:00 | alertas do comitê |
| `whatsapp-retomada-tick` | 1 | 14/10 20:20 | **pode disparar WhatsApp de verdade** |
| `comite-etica-nova-denuncia` | 1 | 13/10 10:41 | morre em `500 — SMTP não configurado` |

Eram 11 itens às 21h40 de ontem; são **16** agora.

**E foi o worker morto que custou o cluster.** O vigia do slot (migration
`20261014000020`) alerta por DM quando o slot passa de 1 GB — metade do limite
que o mata. O alerta existia, foi escrito para exatamente isto, e **não saiu
porque quem envia é o worker**. Se tivesse saído, o item 2 deste relatório não
existiria.

**Por que não religuei:** ele manda WhatsApp e e-mail de verdade, e a regra
aqui é mostrar a fila antes. A fila está acima. Religar às 8h da manhã é bem
diferente de religar às 21h40 — mas a decisão continua sendo sua.

**Onde:** PowerShell, na pasta do projeto, no seu PC.

```
worker\worker-servico.bat
```

Depois de ligar, confira que ele andou:

```
type scripts\status-banco.txt
```

A data/hora no alto do arquivo tem que ser de agora.

---

## 🟡 2. O cluster: a replicação morreu de um jeito diferente do que eu disse

### Primeiro, o que eu errei

Ontem eu te escrevi, aqui e por notificação, que **o disco da produção encheria
em ~7 horas** e que a produção pararia de gravar. Isso **não aconteceu e não
ia acontecer.**

A produção tem `max_slot_wal_keep_size = 2GB`. O Postgres se recusa a guardar
mais de 2 GB de WAL para um slot parado: chegando lá, ele **invalida o slot** e
libera o disco. É uma proteção, e ela funcionou exatamente como devia.

```
slot_name | active | restart_lsn | wal_status
erp_corte |   f    |   (vazio)   |    lost
```

Medido agora: WAL da produção em **1296 MB** (normal, o teto é 4 GB), ERP
respondendo **200**, disco fora de perigo. **Não havia emergência de
madrugada.** Eu li um risco que o Postgres já tinha coberto, e te acordei para
ele. Peço desculpas pelo alarme.

### O que isso troca de verdade

O limite de 2 GB não é só uma boa notícia. Ele é um **cronômetro**:

| | |
|---|---|
| WAL que a produção gera | ~300 MB/h |
| teto por slot parado | 2 GB |
| **prazo para destravar uma parada** | **~7 horas** |
| alerta do vigia (1 GB) | ~3,5 h de folga |

Dentro de 7 h, uma parada custa um comando. Passando de 7 h, o slot morre e o
preço vira **recopiar o banco inteiro**. Foi o que aconteceu: a parada começou
20h09 e ninguém foi avisado, porque o worker estava morto.

E o comando do relatório antigo — `disparar-conflito.sh --aplicar` — **já não
resolve nada**: ele conserta a linha em conflito, mas o WAL que a assinatura
precisava para continuar foi apagado. (Rodar não estraga nada, só não serve.)

### O caminho de volta: `infra/ha/religar-replicacao.sh` (novo)

Único caminho possível: **copiar tudo de novo.** Não existe conserto
incremental para slot perdido.

**Onde:** Git Bash, na pasta do projeto.

```bash
bash infra/ha/disparar-religar.sh              # só diz o que faria
bash infra/ha/disparar-religar.sh --aplicar    # recopia
```

O `--conferir` já rodou e está correto:

```
  slot na producao                   lost (ativo=false)
  publicacao na producao             647 tabelas
  linhas vivas em public             1552766
  tamanho producao                   2355 MB

== o slot esta PERDIDO. A unica saida e recopiar.
    1. DROP da assinatura 'erp_corte' no cluster
    2. soltar o slot morto 'erp_corte' na producao
    3. TRUNCATE em 657 tabelas de public no cluster (1552766 linhas)
    4. CREATE SUBSCRIPTION com copy_data=true -- 2355 MB atravessando
    5. acompanhar ate 647/647 PRONTA
    6. reaplicar a trava de escrita da secao 1.9
```

O passo 3 **apaga o cluster inteiro.** É seguro porque ninguém usa o cluster —
quem atende os usuários é a Supabase. O script tem uma trava: se o slot
estiver saudável, ele **se recusa** a rodar, para não apagar o cluster por
engano. Testei os cinco estados possíveis de `wal_status`; só `lost` e slot
inexistente liberam a recopia.

### ⏰ Minha recomendação: rodar depois das 18h, não agora

O passo 4 é uma leitura longa de 2,3 GB na produção. Numa instância Small que
já caiu três vezes por recurso, isso aparece como CPU e `temp_files` — com os
usuários dentro do sistema, às 8h da manhã.

E **esperar não custa nada**: a cópia é integral de qualquer jeito, então a
conta não piora com o tempo. Depois das 18h é a hora certa, e ela encaixa
naturalmente como primeira etapa da noite do Marco B.

Se você preferir rodar agora, o comando está pronto e funciona — é uma escolha
de horário, não de risco de dados.

---

## 🟡 3. Teste de failover — e ele vem ANTES da recopia

```bash
bash infra/ha/testar-failover.sh
```

Imprime `>>> JANELA DE INDISPONIBILIDADE: X s`. Impacto zero nos usuários: eles
falam com a Supabase, e o único usuário de `api.grpnascimento.com.br` somos nós.

**A ordem importa:** trocar o líder **no meio da cópia** derruba a cópia. Então:
teste de failover primeiro (3 min), recopia depois. Se o teste rodar depois do
`--aplicar`, espere o `647/647 PRONTA`.

Bloqueado para mim: o `patronictl switchover` cai no classificador do modo
automático (*Modify Shared Resources*).

---

## ✅ 4. PR #877 — mergeada por você às 07h42

Entrou na `main` como `47fc23e0`. Conferido: está na `main` e a `main` seguiu
(já tem a #878 do joão em cima).

O chamado **SIS-2026-0276 já estava `concluido`** desde 13/10 18:58 — a
automação de conclusão fechou no merge anterior, então não havia nada a fechar
agora.

⚠️ A `revisao-ia` passou **sem revisar** de novo — cota da assinatura pessoal.
O check fica verde de qualquer jeito.

---

## Estado agora, medido

```
PRODUÇÃO (o que os usuários usam)
  ERP                      200 em 0,95 s        app.grpnascimento.com.br
  WAL                      1296 MB em 82 arquivos (teto 4 GB) -- tranquilo
  slot erp_corte           lost, nao retem mais WAL  <-- sem risco de disco
  banco                    2355 MB
  worker                   PARADO desde 17h16 de 14/10   <-- item 1
  fila                     16 pendentes em 7 destinos

CLUSTER (paralelo, ninguém usa)
  Patroni                  banco2 líder, banco1 sync standby, streaming, lag 0, TL 6
  API                      https://api.grpnascimento.com.br -> 200 em 0,10 s
  schema                   estava IDÊNTICO ontem; reconferir depois da recopia
  escrita anon/auth        REVOGADA (direta); 372 portas SECURITY DEFINER abertas
  replicação               PARADA, slot perdido -- recopia integral pendente
  dados                    986 MB, 1.552.766 linhas em public (vão ser recopiados)

FRONTEND
  app.grpnascimento.com.br 200, certificado válido
  *.lovable.app/app        302 para o domínio próprio
  localhost:4173           derrubado de propósito
```

---

## O que falta para o Marco B

Ordem da noite, com a recopia entrando na frente:

| | O que | Quanto tempo |
|---|---|---|
| 0 | **recopiar** (`disparar-religar.sh --aplicar`) | o passo longo |
| 1 | os três conferidores dizendo "nada divergente" | 10 min |
| 2 | congelar escrita na produção (`REVOKE`) | início da janela |
| 3 | esperar lag zero e parar a assinatura | minutos |
| 4 | **`GRANT` de volta no cluster** (seção 1.9) | antes de liberar ninguém |
| 5 | dump de `auth` e `storage` | não vêm por replicação |
| 6 | **`setval` nas 126 sequences** | depois do congelamento |
| 7 | delta final dos anexos | imediatamente antes |
| 8 | trocar o `.env` por commit no `main` | o ponto de virada |
| 9 | aceitação pelo navegador | antes de liberar |

Impacto nos usuários nessa noite: **um relogin**.

---

## "É a última coisa antes de migrar tudo?" — não, e aqui está o que falta

Levantado em 15/10, depois da sua pergunta. **Nada disto estava na lista**, e
todos são o mesmo tipo de armadilha da seção 1.11 do roteiro: **uma cópia feita
num dia e tratada como se fosse viva.**

| | Medido agora | O que fazer |
|---|---|---|
| **anexos** | produção 11.620 × cluster **11.252** → **368 de diferença**, +39 só desde ontem à noite | `carregar-anexos.sh` imediatamente antes da virada |
| **auth/storage** | produção com **156** logins; o cluster tem a carga de 13/10 (159 — já houve exclusão depois) | `carregar-auth-storage.sh` no passo 2.3 |
| **Edge Functions** | **63 de 64** no container; falta `tvg-ia` | subir a que falta e comparar `ls` antes da virada |
| **backup do cluster** | **não existe** | apontar `backup_banco.yml` e `backup_storage.yml` para o cluster |
| **endereço HTTP** | `api.grpnascimento.com.br` → só `banco1` | decisão de HA do endpoint |

Duas merecem destaque:

**O espelho de anexos não traz nada da produção.** Ele roda de 1 em 1 minuto e
está funcionando — mas é **entre os dois nós** (banco1 ↔ banco2), para o nó que
não recebeu o arquivo não responder 500. Quem traz da produção é o
`carregar-anexos.sh`, à mão, e a última vez foi 13/10. Eu estava olhando um
timer verde e concluindo a coisa errada; o número é que conta.

**O cluster não tem backup.** Hoje quem faz backup é a Supabase, e os dois
workflows do GitHub apontam para ela. No dia seguinte à virada, o cluster passa
a ser a produção **sem backup nenhum**. É o item mais fácil de esquecer e o
mais caro de esquecer — e eu recomendo resolver **antes** da virada, não
depois.

E a `tvg-ia` conta uma história: é do **mesmo módulo TVG** cujas 21 funções de
banco faltavam ontem. As Edge Functions derivam igual ao schema, e para elas
não existe conferidor nenhum ainda.

Roteiro completo: [`docs/ha-corte-roteiro.md`](ha-corte-roteiro.md) — a seção
**1.12** é nova e é sobre o limite de 2 GB.

---

## Pendências menores, sem pressa

- **SMTP do comitê de ética quebrado.** `HTTP 500 — SMTP não configurado`. A
  denúncia de 13/10 10h41 não avisou ninguém, e nenhuma vai avisar até os
  secrets entrarem na Edge Function. 31 alertas pendentes e **zero**
  `COMITE_ETICA_RESPONSAVEL` ativo.
- **`revisao-ia` passa sem revisar** — precisa de `ANTHROPIC_API_KEY` própria.
- **Certificado A1 da NF-e vencido** há 33 dias (12/09). SEFAZ devolve 403.
- **Duas sessões automáticas não rodaram** (SIS-2026-0649 e SIS-2026-0663):
  `'claude.cmd' não é reconhecido`. Rode `/chamado 0649` e `/chamado 0663` na
  mão se quiser os planos.
- **`api.grpnascimento.com.br` aponta só para o `banco1`.** Decisão de HA do
  endereço HTTP em aberto; não bloqueia o Marco B.
- **Domínio no seu CPF**, vencendo 27/02/2027 — vale transferir para o CNPJ.
