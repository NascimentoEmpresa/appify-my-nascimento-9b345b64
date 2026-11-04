# Capacidade da produção — até onde a API aguenta

> Item 3 do pedido de 03/11/2026. Testes feitos **na produção**, à noite,
> com autorização do Eduardo. Ferramentas em `infra/carga/`. Os números abaixo
> são medidos; nada aqui é estimativa de fornecedor.

## Como medir de novo

```bash
# 1. trazer os logs de um dia de referência (sem passar pelo dockerd)
bash infra/incidentes/coletar.sh 2026-11-03
# 2. montar a mistura real de tráfego daquele dia (só leitura)
node infra/carga/montar-mix.mjs ./incidente-2026-11-03/kong.log.gz > mix.json
# 3. tokens de usuários comuns (nunca admin/diretoria/gerência): ver "Tokens" abaixo
# 4. degraus de carga com parada automática
ANON_KEY=... node infra/carga/carga.mjs --mix mix.json --tokens tokens.json \
  --degraus 5:60,10:60,20:60,30:60,45:60,60:60,80:60,100:60,130:60 --monitorar 216.238.120.171
# 5. N abas recarregando juntas (o que derrubou a produção em 03/11)
ANON_KEY=... node infra/carga/manada.mjs --mix mix.json --tokens tokens.json --abas 10,20,40,60 --modo juntas
ANON_KEY=... node infra/carga/manada.mjs --mix mix.json --tokens tokens.json --abas 60,120 --modo espalhadas --janela 20
```

**O que o teste NÃO faz:** escrever. O mix descarta POST/PATCH/DELETE e só
mantém RPCs conferidas como leitura (`has_screen_access`,
`list_accessible_menus`, `presenca_listar`, `fluxo_caixa_ler_fonte`...). As
requisições levam o cabeçalho `x-teste-de-carga`, para serem achadas no log.

**Tokens:** JWT de 4 h assinado no próprio banco1 com o `JWT_SECRET` da pilha
(o segredo não sai do servidor), para 5 usuários sorteados entre os perfis
*Encarregados*, *Legado: comercial*, *Legado: financeiro*, *Legado: operacional*
e *Legado: rh*. Foram excluídos quem tem perfil `concede_tudo`, ou com nome de
admin, diretor, presidência ou gerência, e contas de teste. Não cria sessão nem
grava nada no `auth`. A RLS aplica de verdade, porque é o usuário real.

## 1. Degraus de carga com o tráfego real (03/11, 23:13 UTC)

Mistura: 180 rotas, proporcional às 316.517 leituras do dia.

| req/s pedidos | alcançados | p50 | p95 | p99 | 5xx | sonda de saúde p95 | carga do nó |
|---|---|---|---|---|---|---|---|
| 5 | 5,0 | 48 ms | 119 ms | 258 ms | 0 % | 64 ms | 0,18 |
| 10 | 9,9 | 48 ms | 125 ms | 571 ms | 0 % | 111 ms | 0,17 |
| 20 | 19,8 | 46 ms | 124 ms | 317 ms | 0 % | 63 ms | 0,55 |
| 30 | 29,9 | 48 ms | 139 ms | 315 ms | 0 % | 74 ms | 1,09 |
| 45 | 44,7 | 51 ms | 211 ms | 412 ms | 0 % | 144 ms | 1,62 |
| 60 | 59,8 | 57 ms | 313 ms | 602 ms | 0 % | 146 ms | 2,35 |
| **80** | **79,7** | 79 ms | **932 ms** | 1,5 s | 0,02 % | 598 ms | 2,06 |
| 100 | **86,8** | **1,7 s** | **4,2 s** | 6,7 s | 0,2 % | 4,1 s | 1,97 |

**Parou no degrau de 100 req/s:** p95 de 5,2 s na janela de 10 s. O servidor
entregou no máximo **~87 req/s**. Uma rodada isolada a 90 req/s passou (p95
369 ms). Por isso:

- **Saudável até ~80–90 req/s** (p95 abaixo de 1 s).
- **Ruptura entre 90 e 100 req/s:** a fila cresce, o p50 salta de 79 ms para
  1,7 s, e a sonda que o `monitorDeQueda` usa passa de 4 s.

**Onde satura:** a 90 req/s, `mpstat` no banco1 deu **82,7 % usuário +
14,0 % sistema** (os 2 núcleos cheios). Por processo (`top`), o **Postgres**
ficou com ~93 % do tempo de CPU dos processos. Caddy teve 2,3 % e o nginx do Kong
1,4 %. O limite é **CPU do banco**, não rede nem gateway.

**Quem cede primeiro** (p95 no teste inteiro): `rpc/fluxo_caixa_ler_fonte`
**5,0 s**, `planilha_custo` 3,4 s, `extrator_beneficios_job` 3,2 s,
`malote_classificacao_malote_link` 3,1 s, `sup_pedido` 2,9 s. São as telas do
item 4.

Quantos **usuários** isso representa, e por que a produção caiu com só 62 abas, está em [capacidade-usuarios.md](capacidade-usuarios.md) (item 9).

## 2. O que muda a capacidade, em ordem de efeito

| Ação | Efeito medido ou esperado | Item |
|---|---|---|
| Fim do polling | 0,22 → ~0,02 req/s por aba parada. Capacidade em abas ~10× | 5 |
| Telas pesadas paginadas | tira os 2,5–5 s das rotas que cedem primeiro | 4 |
| Monitor sem manada | boot de 60 abas: 12,4 s → 1,8 s (medido acima) | 2 |
| Pool 10 → 20 | ataca o PGRST003 da manada de 120 abas | 3 (compose) |
| banco1 2 → 4 vCPU | o limite de ~87 req/s é CPU do Postgres; o esperado é próximo do dobro, a medir | 11 |

## 3. Depois: pool 20 no ar (04/11/2026, 04:10 BRT)

Mesma mistura de tráfego, mesmos degraus e mesmos usuários. Já estavam no ar:
pool do PostgREST 10 → 20, keep-alive do Kong, HAProxy e o agente do Grafana.
O frontend novo **ainda não**.

| req/s pedidos | alcançados | p50 | p95 | 5xx | conexões ativas |
|---|---|---|---|---|---|
| 45 | 44,8 | 55 ms | 322 ms | 0 % | 3 |
| **60** | **59,8** | 64 ms | **833 ms** | 0 % | 10 |
| 80 | **63,1** | 260 ms | **6,4 s** | 0,2 % | **17** |

**Piorou:** o último degrau saudável caiu de 80 para **60 req/s**. A CPU por
processo no banco1 a 60 req/s (`pidstat`) diz por quê:

| Processo | CPU (de 200 %) |
|---|---|
| Postgres | **110,6 %** |
| rsync (espelho de anexos, de 1 em 1 min) | **14,6 %** |
| Alloy (agente do Grafana) | 1,1 % |

O agente não é a causa. O pool de 20 deixa **17** consultas pesadas (Fluxo de
Caixa de 17,9 MB, Planilha, Malote) disputando os mesmos 2 núcleos, contra 8
com o pool de 10. Mais conexões, mais disputa, cada consulta mais lenta. É o
risco que o comentário do compose já previa.

**Achado à parte:** o espelho de anexos (rsync a cada minuto, `ha_anexos`)
come ~15 % da CPU do banco1 o tempo todo. Vale passar a sincronizar por evento,
ou a cada 5 min.

**O outro lado** (simulação de recarga em massa,
[capacidade-usuarios.md](capacidade-usuarios.md), seção 4): com o pool de 20, a
recarga **espalhada**, que é o comportamento depois do merge, ficou **muito
melhor** (120 abas: 21,9 % → 0,6 % de 5xx). Por isso a recomendação:

- **manter o pool de 20 depois** que o frontend desta PR estiver publicado:
  leitura compacta (−75 % nas consultas mais pesadas), fim do polling e recarga
  espalhada;
- **até lá**, se a prioridade for o pior caso de hoje (recarga em massa no
  mesmo segundo), voltar para 10 é uma linha no compose
  (`PGRST_DB_POOL: "10"`) e `bash infra/ha/aplicar-pilha.sh --aplicar`. Os
  dois gatilhos dessa recarga já estão corrigidos e provados
  (docs/incidentes/2026-11-03-resolucao.md), e o tráfego real fica em 8–18 req/s.
- Cada número acima é **uma** rodada. Antes de fixar o valor, repetir em outro
  horário.
