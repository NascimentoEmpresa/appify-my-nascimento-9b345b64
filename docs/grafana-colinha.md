# Colinha do Grafana — painel de saúde e logs

Endereço: **https://redgarlic110.grafana.net** (conta analisededados@…)
Histórico disponível: **14 dias**. Mais antigo que isso, só `docs/incidentes/coletar.sh`.

---

## A. Ver os gráficos (está piorando?)

```
1. redgarlic110.grafana.net
2. menu ☰ → Dashboards → "ERP — Saúde da produção"
3. canto superior direito: período (Last 24 hours) · ↻ recarregar
```

**A linha tracejada cinza é a mesma hora de ONTEM.** A pergunta do painel não é
"está alto?", é "está pior que ontem nesse mesmo horário?".

Arraste o mouse por cima de um gráfico para dar zoom naquele intervalo.

| Faixa | O que olhar | Sinal de alerta |
|---|---|---|
| Agora × ontem | % de respostas 5xx | acima de **2%** = usuário vendo erro |
| | Tempo de resposta p95 | acima de **2 s** = tela travando |
| | CPU por nó | acima de **85%** no banco1 (só 2 núcleos) |
| PostgREST | Pool: esperando | qualquer coisa **acima de zero** = fila |
| | Pool esgotado (PGRST003) | acima de zero = erro na tela |
| Banco | statement timeout | consulta estourando o tempo |
| | Patroni líder (1) / atraso | trocou de líder? réplica atrasada? |
| Máquinas | CPU por container | "quem está comendo a CPU?" |
| Rotas | tabelas: mais chamadas / mais lentas | **qual tela** é a culpada |

---

## B. Ver os logs (o que aconteceu?)

```
1. redgarlic110.grafana.net
2. menu ☰ → Explore
3. fonte de dados (no alto) → grafanacloud-redgarlic110-logs
4. botão "Code" (canto direito da caixa da consulta)
5. colar uma consulta de baixo
6. período (canto superior direito) → Last 1 hour
7. "Run query" (botão laranja)
```

### As 5 consultas

```
{servico="kong"}
```
todo o tráfego do ERP

```
{servico="kong", classe="5xx"}
```
**só os erros que o usuário viu** — a primeira a rodar quando alguém reclama

```
{servico="kong"} |= "/rest/v1/CHAMADO_SISTEMA"
```
uma tela/tabela específica (troque o nome)

```
{servico="postgres"} |= "statement timeout"
```
consultas que estouraram o tempo no banco

```
{servico="rest"} |~ "PGRST0|schema cache|reconnect"
```
fila cheia, recarga de schema, reconexão

Sintaxe: `{}` escolhe de onde vem · `|=` contém o texto · `|~` várias palavras
separadas por `|` · `!=` exclui.

### Lendo a tela

- **Gráfico de barras (Logs volume)**: cada barra = 1 minuto. Cinza = normal,
  vermelho = erro, amarelo = aviso. **Barra faltando = o ERP parou de responder.**
- `unknown` no nível é normal: o Kong não escreve INFO/ERROR na linha.
- **Fields (coluna da esquerda)**: marque `classe` para ver 2xx/4xx/5xx em coluna,
  `no` para ver de qual máquina (banco1/banco2) veio.
- Canto direito da lista: **Newest logs first** · **Wrapping** (quebra a linha)
  · **Download logs** · **Logs / Table** (tabela é melhor para escanear).

### Decifrando uma linha do Kong

```
172.28.0.1 - - [04/Nov/2026:13:08:34] "GET /rest/v1/notificacoes?...limit=20
HTTP/1.1" 200 4499 "https://app.grpnascimento.com.br/" "Mozilla/5.0..."
rt=0.063 urt=0.063
```

- `GET /rest/v1/notificacoes` → a tabela que a tela pediu
- `200` → deu certo · `4xx` → pedido errado ou sem permissão · **`5xx` → o sistema falhou**
- `4499` → tamanho da resposta em bytes
- **`rt=0.063` → quanto demorou, em segundos.** É o que se procura em "está lento";
  acima de `rt=2` é a pessoa esperando a tela.

Duas pegadinhas: a hora **dentro dos colchetes é UTC** (+3h) — use a coluna
**Time** da esquerda, que é Brasília. E os `OPTIONS` não aparecem: descartados
de propósito (40% das linhas, nenhum valor).

### Dois botões do canto superior direito

- **Live** — linhas entrando ao vivo; é o que se deixa aberto durante um incidente.
- **Split** — dois painéis lado a lado. O uso bom: `{servico="kong", classe="5xx"}`
  de um lado e `{servico="postgres"}` do outro, no mesmo horário.

---

## C. Caiu AGORA? Não é o painel

O painel responde "está piorando". Para "caiu agora, por quê?", no Claude Code:

```
bash infra/observabilidade/diagnostico.sh
```

~20 s, só lê os dois nós, e a causa costuma estar escrita na saída. Nunca use
`docker logs` (o log do Kong tem GB e agravar a queda já aconteceu em 03/11).

**Pendência:** o "top consultas" (`pg_stat_statements`) ainda não está carregado —
exige reiniciar o Postgres, ficou para a janela do upgrade do banco1.
