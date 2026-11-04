# Capacidade em usuários simultâneos

> Item 9 do pedido de 03/11/2026. Ferramentas e tokens descritos em [capacidade.md](capacidade.md); o teste de manada é `infra/carga/manada.mjs`.

## 1. Quanto tráfego o ERP tem de verdade (03/11/2026)

O `presenca_registrar` é um batimento de 60 s por aba logada, então dá para contar
abas pelo log do Kong:

| | Valor |
|---|---|
| Abas logadas no pico do dia | **62** (19:00 UTC); 40–58 no horário comercial |
| Requisições por segundo em horário normal | **8–18 req/s** |
| Requisições por aba | **0,22 req/s** (13 por minuto), em média nas janelas sem erro |
| Requisições por recarga de página (boot) | **~36**, das quais `profiles` ×7 e `auth/v1/user` ×4 |

Uma aba parada faz 13 requisições por minuto. É quase tudo polling (item 5).

## 2. Quantos usuários isso dá (item 9)

`~85 req/s ÷ 0,22 req/s por aba` ≈ **380 abas logadas ao mesmo tempo**, em
regime normal, com o código de hoje. **O pico real foi 62.** Sobra de ~6×.

**Então por que caiu com 62?** Porque a carga real **não fica em 0,22 req/s
por aba** quando algo dá errado. Nas janelas de queda, a mesma quantidade de
abas fez:

| Janela (UTC) | Abas | req/s | req/s por aba |
|---|---|---|---|
| 12:30 (normal) | 47 | 10,2 | 0,22 |
| 14:10 (queda) | 56 | **48,8** | **0,87** |
| 19:00 (queda) | 62 | **81,1** | **1,30** |

Na queda, cada aba passa a fazer **4 a 6 vezes** o tráfego normal (recargas,
retentativas, `sistema_saude`). Com 62 abas a 1,30 req/s, a carga encosta no
limite de ~85 req/s **sem nenhum usuário a mais**. O que derruba o ERP não é
crescer o número de usuários: é **amplificação**. Crescer usuários só deixa a
amplificação chegar mais cedo.

## 3. A manada: N abas recarregando no mesmo segundo

Boot real de uma aba = 36 requisições.

**Como era** (`--modo juntas`, todas no mesmo segundo):

| Abas | Requisições | p50 | p95 | boot completo (p95) | 5xx |
|---|---|---|---|---|---|
| 10 | 360 | 2,0 s | 2,6 s | 3,2 s | 0,3 % |
| 20 | 720 | 3,6 s | 3,9 s | 4,4 s | 0,3 % |
| 40 | 1.440 | 7,2 s | 7,7 s | 7,8 s | 0,7 % |
| 60 | 2.160 | **11,1 s** | **11,7 s** | **12,4 s** | 0,8 % |

**Como fica com a correção do item 2** (`--modo espalhadas --janela 20`):

| Abas | Requisições | p50 | p95 | boot completo (p95) | 5xx |
|---|---|---|---|---|---|
| 60 | 2.160 | **153 ms** | **935 ms** | **1,8 s** | 0,1 % |
| 120 | 4.320 | 1,2 s | 10,1 s | 10,6 s | **21,9 %** |

60 abas espalhadas em 20 s bootam **7× mais rápido** que juntas. Com 120 aparece
o limite seguinte: o log do PostgREST registrou `PGRST003 Timed out acquiring
connection from connection pool` com a **CPU do banco1 65 % ociosa** (sar,
23:10). Quem segurou foi o **pool de 10 conexões**, não o processador. Daí o
`PGRST_DB_POOL: "20"` no compose (seção 5).

Por que a recarga em massa da produção derrubou e a deste teste não: aqui o
pool estava vazio quando a manada chegou. Na produção, a manada chegava com o
pool já ocupado pelas consultas pesadas (`fluxo_caixa_ler_fonte` de 5 s,
`planilha_custo` de 3 s) e logo depois de uma recarga de schema que tinha
descartado o pool.

## 4. Depois: pool 20 no ar (04/11/2026, 04:20 BRT)

Mesma simulação de manada, mesmos usuários:

| Cenário | Pool 10 (03/11) | Pool 20 (04/11) |
|---|---|---|
| 60 abas **no mesmo segundo** (como a produção se comporta HOJE) | p50 11,1 s · 0,8 % 5xx | **pior:** p50 13,1 s · **7,6 % 5xx · 13,7 % passou de 20 s** · a sonda de saúde falhou 1x |
| 60 abas **espalhadas em 20 s** (como fica depois do merge) | boot p95 1,76 s · 0,1 % | **melhor:** boot p95 **0,83 s** · 0,4 % |
| 120 abas espalhadas em 20 s | boot p95 10,6 s · **21,9 % 5xx** | **muito melhor:** boot p95 **2,5 s** · **0,6 %** |

Leitura: o pool de 20 faz o servidor aceitar mais trabalho ao mesmo tempo.
Quando o trabalho chega **espalhado**, isso vira vazão (120 abas quase sem
erro). Quando chega **tudo junto**, vira disputa de CPU e piora. O frontend
desta PR é o que espalha. A recomendação e a alternativa até o merge estão em
[capacidade.md](capacidade.md), seção 3.
