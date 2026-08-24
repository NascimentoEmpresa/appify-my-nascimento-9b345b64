---
description: Manda o plano aprovado de um chamado pro Codex CLI executar numa worktree isolada, depois revisa o resultado
---

Chamado: `$ARGUMENTS` (formato `SIS-AAAA-NNNN`). Se vazio, pare e peça.

Este comando roda **sempre interativo** (nunca headless) — ele envolve
aprovação humana em pontos irreversíveis. Contexto completo em
`docs/automacao-chamados.md`.

## 1. Localizar o plano

Procure nesta ordem:
1. `worker/state/planos/$ARGUMENTS.md` (gravado pelo worker no disparo automático);
2. `~/.claude/plans/` — o arquivo que começa com `<!-- chamado:$ARGUMENTS -->`.

Se não existir plano nenhum, pare e sugira rodar `/chamado $ARGUMENTS` primeiro.

Leia o plano e confira se a seção "Perguntas em Aberto" foi respondida pelo
desenvolvedor. **Se houver pergunta em aberto ainda sem resposta, pare e
pergunte** — não escolha por conta própria.

## 2. Criar e preparar a worktree

A worktree é criada só agora (a fase de planejamento não usa worktree —
plan mode é read-only). Crie com:
```
git worktree add .claude/worktrees/$ARGUMENTS -b $ARGUMENTS
```
Nome da branch = número do chamado, como combinado.

Arquivos git-ignorados não são materializados numa worktree nova. Se a tarefa
depender deles, copie da raiz do repositório: `.env` e/ou `worker/.env`.
Nunca imprima o conteúdo deles.

**`node_modules` na worktree — faça `npm install` de verdade.** Rode
`npm install --no-audit --no-fund` dentro da worktree e espere terminar
(alguns minutos, roda uma vez por worktree). Avise o desenvolvedor que vai
demorar.

Não tente atalho com link/junction/symlink apontando pro `node_modules` do
repositório principal: **já foi testado e quebra de duas formas** — o sandbox
do Codex (`workspace-write`) bloqueia acesso a caminho fora da worktree, e o
Vitest falha a resolução de módulos ("No test suite found in file" em todos
os arquivos de teste, mesmo rodando fora do sandbox). Com `npm install` real,
os 217 testes passam normalmente na worktree.

## 3. Gerar o CODEX_PLAN.md

Escreva `CODEX_PLAN.md` na raiz da worktree, contendo:
- O plano aprovado, já com as respostas do desenvolvedor incorporadas (não
  deixe "Perguntas em Aberto" no arquivo que vai pro Codex — ele não tem quem
  perguntar).
- Instruções finais explícitas, sempre:
  ```
  Implemente integralmente esta especificação.
  Não pare para pedir confirmação — faça escolhas técnicas razoáveis quando
  não houver ambiguidade crítica.
  Após implementar: rode npm run lint, npm run test e (se a mudança puder
  afetar build) npm run build. Corrija falhas causadas pela sua implementação.
  NÃO faça commit, push, merge ou rebase. Deixe tudo sem commit para revisão.
  Finalize quando a implementação estiver completa ou quando houver um
  bloqueio impossível de resolver sem decisão externa — nesse caso, descreva
  o bloqueio.
  ```

## 4. Rodar o Codex

Modelo por complexidade (leia `worker/state/planos/$ARGUMENTS.complexidade`
se o worker tiver gravado; senão classifique você mesmo pelo plano):

```
simples  → -m gpt-5.6-luna  -c model_reasoning_effort=low
normal   → -m gpt-5.6-terra -c model_reasoning_effort=medium
complexo → -m gpt-5.6-sol   -c model_reasoning_effort=high
```

Comando (sintaxe validada na prática — em Windows é sempre `codex.cmd`,
nunca `codex` puro, que é bloqueado pela política de execução do PowerShell):

```
codex.cmd exec -C <caminho-absoluto-da-worktree> -s workspace-write \
  -c approval_policy=never -c model_reasoning_effort=<effort> \
  -m <modelo> --skip-git-repo-check --json -o resultado.md \
  - < <caminho-absoluto>/CODEX_PLAN.md
```

Rode em `run_in_background: true` (pode levar muitos minutos) e acompanhe com
Monitor. Os eventos `--json` são JSONL: `thread.started` → `turn.started` →
`item.completed` (com `type: file_change` e o `path` de cada arquivo tocado)
→ `turn.completed`. **Não confie só no exit code** — confira também os
eventos e o resultado real.

## 5. Revisar

Leia `resultado.md` (última mensagem do Codex) e o diff real
(`git -C <worktree> status` e `git -C <worktree> diff`). Confirme que:
- nada foi commitado (deve estar tudo como modificação não commitada);
- o que mudou corresponde ao plano, sem escopo extra não pedido.

Depois rode o skill `code-review` sobre esse diff.

- **Reprovado**: escreva `FIX.md` na worktree com os problemas encontrados
  (mesmo formato de instrução do CODEX_PLAN.md, incluindo "não commitar"),
  mostre ao desenvolvedor o que deu errado, e **só rode o Codex de novo com o
  OK dele** — usando `FIX.md` como entrada em vez do `CODEX_PLAN.md`.
- **Aprovado**: apresente o resumo do que foi feito e **espere o OK explícito
  do desenvolvedor antes de commitar**. Só depois disso, commit na branch da
  worktree.

## 6. Depois do commit (manual, sempre do desenvolvedor)

Merge na branch `eduardo` e abertura da PR são do desenvolvedor, não suas —
a menos que ele peça explicitamente. Lembre-o de que o título da PR precisa
começar com `$ARGUMENTS: ` (sem colchetes), senão o CI bloqueia o merge; e
que ao mergear, o chamado é concluído automaticamente no ERP.