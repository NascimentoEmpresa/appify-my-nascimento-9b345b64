---
description: Lê um chamado de desenvolvimento (CHAMADO_SISTEMA) e monta um plano de implementação em plan.md
---

Número do chamado: `$ARGUMENTS` (formato `SIS-AAAA-NNNN`, ex. `SIS-2026-0112`).
Se `$ARGUMENTS` estiver vazio, pare e peça o número — não invente um.

Esta é a receita única de planejamento de chamado, usada tanto manualmente
(interativo) quanto disparada automaticamente pelo worker (headless, ver
`docs/automacao-chamados.md`). Siga os passos na ordem:

## 1. Buscar o chamado

Leia `worker/.env` (git-ignorado, local) pra pegar `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY` — **nunca imprima esses valores**, use-os só pra
montar a chamada. Busque o chamado via REST:

```
curl -sS "$SUPABASE_URL/rest/v1/CHAMADO_SISTEMA?numero=eq.$NUMERO&select=*" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Se não encontrar, pare e informe — não prossiga com um chamado inexistente.
Campos relevantes: `assunto`, `descricao`, `tipo_solicitacao`, `prioridade`,
`modulo_sistema`, `urgencia`, `impacto_trabalho`, `ambiente`.

## 2. Explorar o código relevante

Use `modulo_sistema` pra localizar a área do código (ex. `src/pages/<modulo>/`
no frontend, migrations relacionadas no backend). Leia
[`CLAUDE.md`](../../CLAUDE.md) e o skill relevante em `.claude/skills/` antes
de propor qualquer mudança — não repita convenção que já está documentada
ali, só referencie.

## 3. Escrever o plano

Escreva um plano de implementação claro, cobrindo o que muda em frontend e
backend, arquivos críticos, e como verificar que funcionou — no mesmo nível
de detalhe de um plano normal do Claude Code. **A primeira linha do plano
precisa ser exatamente** `<!-- chamado:$ARGUMENTS -->` (comentário Markdown,
não aparece renderizado) — é o marcador que o worker usa depois pra
identificar qual arquivo em `~/.claude/plans/` pertence a este chamado (ver
nota abaixo).

**Termine sempre com uma seção "Perguntas em Aberto"** — qualquer ambiguidade
que normalmente viraria uma pergunta interativa vira um item nessa seção em
vez disso. Não deixe a seção vazia sem necessidade: se não há ambiguidade
real, diga isso explicitamente ("nenhuma pergunta em aberto") em vez de
omitir a seção.

## 4. Modo headless vs. interativo

Se a variável de ambiente `CHAMADO_HEADLESS=1` estiver setada: **não chame
`AskUserQuestion`** (não tem quem responda em tempo real) e termine o turno
assim que o plano estiver escrito — não dependa de `ExitPlanMode` pra
sinalizar conclusão nesse modo (validado: `--permission-mode plan` headless
não trava esperando isso, o turno termina sozinho).

**Nota validada sobre onde o plano é salvo em modo headless**: com
`--permission-mode plan`, a ferramenta Write só consegue gravar no arquivo de
plano que o próprio Claude Code escolhe (nome aleatório tipo
`~/.claude/plans/<slug-aleatorio>.md`) — **nunca** num caminho arbitrário
como `./plan.md` dentro do diretório de trabalho, mesmo se instruído via
`--append-system-prompt` (testado e confirmado: a tentativa de escrever fora
de `~/.claude/plans/` é negada pelo sistema de permissões, não é só o modelo
se recusando). Não tente forçar um caminho diferente. É responsabilidade de
quem chamou este comando de forma headless (o worker) localizar o arquivo
mais recente em `~/.claude/plans/` que comece com o marcador
`<!-- chamado:NUMERO -->` e copiá-lo pra dentro da worktree como `plan.md`
depois que esta sessão terminar — isso não acontece sozinho.

Se `CHAMADO_HEADLESS` não estiver setada (uso manual, interativo): siga o
fluxo normal de plan mode, incluindo `ExitPlanMode` ao final pra pedir
aprovação do desenvolvedor — nesse caso o arquivo também fica em
`~/.claude/plans/`, o que já é o comportamento padrão conhecido do Claude Code.
