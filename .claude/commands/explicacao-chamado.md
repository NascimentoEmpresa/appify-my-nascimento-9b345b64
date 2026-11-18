---
description: Explica para o usuário final o que foi entregue num chamado — telas, URLs, passo a passo, de onde vem cada informação e dúvidas comuns
---

Chamado: `$ARGUMENTS` (formato `SIS-AAAA-NNNN`; aceite também só o número,
ex. `0112` → `SIS-<ano atual>-0112`). Se vazio, pare e peça — não invente.

Objetivo: montar a explicação que o desenvolvedor manda pro **usuário final**
(quem abriu o chamado e quem vai usar a tela) depois que o chamado foi
atendido. Também serve pra tirar dúvida de usuário semanas depois — então a
fonte é sempre o que **está no código e no banco**, nunca a memória da sessão.

Este comando **só lê**. Não commita, não abre PR, não escreve no chat do
chamado nem manda nada pra ninguém — entrega o texto pro desenvolvedor colar.

## 1. Juntar o que foi pedido

Leia `worker/.env` pra pegar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`
(**nunca imprima os valores**) e busque o chamado:

```
curl -sS "$SUPABASE_URL/rest/v1/CHAMADO_SISTEMA?numero=eq.$NUMERO&select=*" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Campos que importam: `assunto`, `descricao`, `definicao`, `solicitante_nome`,
`modulo_sistema`, `status`. Leia também a conversa do chamado
(`CHAMADO_SISTEMA_EVENTO?chamado_id=eq.<id>&order=created_at`) — é onde
aparecem combinados e dúvidas que o solicitante já levantou; a explicação tem
que responder a elas.

## 2. Juntar o que foi feito

Ache a PR pelo prefixo do título:

```
gh pr list --state all --search "$NUMERO in:title" \
  --json number,title,url,state,mergedAt,headRefName
```

Pode haver mais de uma (entrega em partes, correção depois) — considere todas.
De cada uma: `gh pr view <n> --json body,commits,files` e `gh pr diff <n>`.
Se não houver PR (ex. rodando antes de abrir), use os commits locais:
`git log --all --grep="$NUMERO" --stat`. Se não houver nem PR nem commit,
diga isso e pare — não descreva o plano como se fosse entrega.

A PR pode estar aberta e não mergeada: nesse caso, avise no topo que **ainda
não está no ar** e que a explicação vale depois do merge.

## 3. Ler o código entregue (é daqui que sai a explicação)

Leia de verdade os arquivos alterados — não resuma só pelo título do commit.

- **Telas e URLs**: cruze os arquivos de `src/pages/` com as `<Route>` de
  `src/App.tsx`. A lógica já existe em `.github/scripts/rotas-da-pr.cjs`
  (`urlsDaPr(textoDoApp, arquivos)`), pode chamar com `node -e`. Endereço base:
  `https://app.grpnascimento.com.br`. Rota com parâmetro (`:id`) não vira link —
  descreva como chegar nela a partir da tela de lista.
- **Onde fica no menu**: o caminho que o usuário clica (módulo › grupo ›
  tela), pelo `src/components/layout/Sidebar.tsx` / `MENU_LATERAL_VERSAO` e
  pela linha de `app_menu` da migration.
- **Quem tem acesso**: o `codigo` do `app_menu` e os `<AcessoGate>`. Tela
  nova nasce **PENDENTE** (ver `CLAUDE.md`): diga se ela já foi liberada em
  Módulos & Menus › Novos Módulos ou se ainda falta, e quem precisa receber a
  permissão. Se der pra conferir no banco, confira; se não, diga que não foi
  conferido.
- **Passo a passo**: siga o fluxo real da tela — botões, abas, campos
  obrigatórios, validações (as mensagens de erro do `toast`/`zod` viram as
  "o que fazer se aparecer X"), estados/status e quem muda cada um.
- **De onde vem cada informação**: para cada número, lista ou campo que a
  tela mostra, rastreie a origem — a query/RPC do hook, a tabela, e **qual
  outra tela do ERP alimenta essa tabela** (procure os `insert`/`update`
  nela em `src/pages/` e nas RPCs). Ex.: "o saldo vem das entradas lançadas em
  Suprimentos › Entrada de NF". Se vem de integração/carga (Senior, worker,
  planilha), diga isso.
- **O que não mudou / limites**: o que ficou fora do escopo, o que foi
  combinado pra depois, o que depende de outra área.

## 4. Escrever a explicação

Público: usuário do ERP, não desenvolvedor. **Sem jargão** — nada de
"RLS", "RPC", "migration", "componente", "deploy", nome de tabela ou de
arquivo no texto pro usuário. Abra pelo impacto na operação dele. Diga ONDE
clicar, com o nome exato do botão/aba como aparece na tela.

Formato (Markdown, pronto pra colar no chat do chamado/WhatsApp):

1. **O que mudou** — 2 a 4 frases, do ponto de vista de quem usa.
2. **Onde acessar** — caminho no menu + link direto de cada tela.
3. **Quem pode usar** — e o que fazer se a tela não aparecer.
4. **Passo a passo** — numerado, uma ação por passo, por tarefa (ex.
   "Para cadastrar…", "Para consultar…").
5. **De onde vêm as informações** — tabela curta: *o que aparece na tela* →
   *de onde vem / quem preenche*.
6. **Dúvidas comuns** — perguntas e respostas, incluindo as que o
   solicitante já fez na conversa do chamado e as mensagens de erro/aviso que
   ele pode encontrar.
7. **O que ficou de fora** — só se houver.

Depois do texto pro usuário, separado por uma linha, um bloco curto **só pro
desenvolvedor** com: PR(s) e estado, se a tela já foi liberada em Novos
Módulos, e qualquer ponto que você não conseguiu confirmar (o que é
suposição tem que estar marcado como suposição).

Se o desenvolvedor vier com uma dúvida específica de usuário junto do número
(ex. "o usuário não acha o botão X"), responda essa dúvida primeiro, com base
no mesmo levantamento, e só depois ofereça a explicação completa.
