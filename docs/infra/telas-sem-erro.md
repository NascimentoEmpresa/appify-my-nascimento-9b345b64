# Nenhuma tela abrindo com erro no DevTools

> Item 7 do pedido de 03/11/2026. Ferramenta: `infra/qa/varrer-telas.mjs`, que
> abre **todas** as rotas estáticas do `/app` logado como um usuário comum e
> registra todo `console.error`, toda exceção e toda resposta HTTP ≥ 400.

## Como foi feito

- **Usuário:** sorteado entre os perfis comuns, nunca admin, presidência,
  diretoria nem gerência. Foi uma pessoa do perfil *Legado: rh*. A sessão é um
  JWT de 4 h assinado no próprio servidor (a senha dela não foi usada nem
  trocada). Nada é gravado: a varredura só abre telas.
- **Telas:** as 342 rotas sem parâmetro dentro de `/app` em `src/App.tsx`. As
  com `:id` ficam de fora, porque precisam de um registro real.
- **Duas rodadas:** a produção como está (antes) e a build desta branch,
  servida localmente e apontando para a mesma API (depois).

## Antes: produção em 03/11/2026, ~21h

**45 erros em 23 de 344 telas, 12 assinaturas.** Agrupados pela causa:

| Causa | Telas | O que aparecia | Correção |
|---|---|---|---|
| **502 do gateway** em chamadas leves (`has_screen_access`, `list_configured_menu_codes`, `meu_empregado`, `presenca_listar`, `list_accessible_menus`, `RECRUTAMENTO_CANDIDATO_ARQUIVOS`) | 19 | `Failed to load resource: 502` | ver abaixo |
| Tabela que não existe na produção (`CS_FORM_GESTORES`) | 1 | `404 GET /rest/v1/CS_FORM_GESTORES` em `/app/central-servicos/formularios/config` | rota redirecionada para Formulários; a tela órfã saiu |
| `/app/perfil`, `/app/ponto`, `/app/salario` com "rota inexistente" | 3 | `404 Error: User attempted to access non-existent route` | **falso positivo da ferramenta**: são rotas do Portal do Colaborador (`/colaborador/...`). O varredor passou a ler só o que está dentro de `<Route path="/app">` |

### O 502, com a prova

O log de **erro** do Kong (`stderr` do container) tem a causa escrita:

```
2026/11/03 23:53:28 [error] upstream prematurely closed connection while reading response header from upstream,
  request: "GET /rest/v1/app_menu?select=codigo%2Crota%2Cativo", upstream: "http://172.28.0.2:3000/app_menu..."
2026/11/04 00:04:48 [error] recv() failed (104: Connection reset by peer) while reading response header from upstream,
  request: "GET /rest/v1/CHAMADO_SISTEMA_AVALIACAO_DEV?..."
```

É uma disputa de *keep-alive* entre o Kong e o PostgREST. O servidor HTTP do
PostgREST (Warp) **fecha conexão ociosa aos 30 s**. O Kong guardava a conexão
para reuso por **60 s** (o padrão de `upstream_keepalive_idle_timeout`). Quando
o Kong reaproveita uma conexão que o PostgREST acabou de fechar, a requisição
morre no meio e o usuário recebe **502**. Por isso o erro é aleatório, em
chamadas leves, e some ao recarregar.

**Correção** (`infra/failover/docker-compose.cluster.yml`, serviço `kong`):
`KONG_UPSTREAM_KEEPALIVE_IDLE_TIMEOUT: "15"`. O Kong passa a soltar a conexão
antes dos 30 s do PostgREST.

No mesmo log: **`1024 worker_connections are not enough`**, 12 vezes em 03/11,
durante a recarga em massa. Correção: `KONG_NGINX_EVENTS_WORKER_CONNECTIONS:
"4096"` e `ulimits.nofile` 65536 no container.

As duas foram validadas num Kong 2.8.1 descartável no banco1: `kong prepare` e
`nginx -t` aceitam (`worker_connections 4096;` no `nginx.conf` gerado). Entram
na produção com `infra/ha/aplicar-pilha.sh --aplicar`.

## Depois: esta branch, 04/11/2026 ~03:50 UTC

Build **só desta branch**, gerada numa worktree separada e limpa, servida
localmente e apontando para a API de produção, com a correção do Kong já
aplicada nos dois nós. Mesmo usuário, mesmas 342 rotas.

**126 erros em 58 telas.** Mais que antes, e cada um tem explicação:

| Causa | Telas | Situação |
|---|---|---|
| **404 em `rpc/ler_compacto`** (e no console) | 6 | **esperado até o merge**: é a função nova do item 4, que só passa a existir quando a migration `20261104000100` for aplicada. A tela cai na leitura antiga e funciona; o 404 some depois do merge |
| **502 em chamadas leves** | 52 | **ver abaixo: não resolvido** |
| `upstream sent too big header` em `RECRUTAMENTO_CANDIDATO_ARQUIVOS` | 1 | **corrigido nesta PR**: o Banco de Talentos mandava os 1.309 ids de candidatura num `in.(...)` só. Agora são lotes de 200 (`emLotes`) |

### O 502 que ficou, sem enfeite

- O log de erro do Kong mostra **onde** acontece: **só no banco2**. Desde o
  reinício, o banco2 recebeu 45.018 requisições e deu **66 respostas 502
  (0,15 %)**, todas `Connection reset by peer` ou `prematurely closed` vindas
  do PostgREST dele, em 3 a 32 ms. O banco1 não registrou nenhum reset, mas só
  recebeu 2.344 requisições no mesmo período. Isso **não prova** que ele esteja
  imune.
- Os 502 caem nos segundos de **rajada**: 1 por segundo com 47 a 94 requisições
  (a abertura de uma tela), no nó de **1 vCPU**.
- **Hipótese testada e descartada:** conexão ociosa fechada pelo PostgREST
  antes do keep-alive do Kong. Medido de dentro do container do Kong, a mesma
  conexão é reusada depois de 1, 4, 6, 9, 12, 16 e 25 s parada, sem erro. Então
  a correção de keep-alive (`KONG_UPSTREAM_KEEPALIVE_IDLE_TIMEOUT=15`) está no
  ar, mas **não** era a causa deste 502.
- **Impacto para o usuário:** baixo. A chamada é refeita pelo React Query, e o
  monitor de queda não dispara, porque a checagem de saúde passa. Mas aparece
  vermelho no DevTools.
- **Próximos passos, em ordem, cada um medido com esta mesma varredura:**
  1. `KONG_UPSTREAM_KEEPALIVE_POOL_SIZE: "0"` **só no banco2**, ou seja, o Kong
     abre conexão nova a cada requisição. Se o reset for reuso de conexão sob
     rajada, some; o custo é um handshake TCP local por requisição;
  2. se não sumir: tirar o banco2 do DNS do `api.grpnascimento.com.br`.
     Hoje toda consulta que chega nele atravessa o túnel até o banco1, num nó
     com metade da CPU. Ele continua réplica e pronto para assumir no failover;
  3. em paralelo, o upgrade do banco2 (`docs/infra/por-que-nao-houve-failover.md`).
