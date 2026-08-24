# Automação de chamados de desenvolvimento — Claude Code + Codex

> Documento pensado pra ser lido tanto por humano quanto por um agente de IA
> (Claude Code ou Codex) como contexto de arquitetura. Não contém nenhuma
> credencial real — só nomes de variáveis e onde elas moram.

## Por quê

O desenvolvedor recebe demandas como chamados dentro do próprio ERP
(`/app/sistemas/chamados/dev`, tabela `"CHAMADO_SISTEMA"`). O problema que
motiva esta automação: a janela de uso do Claude Code Pro esgota rápido, e
fica tempo ocioso esperando ela recarregar. A solução é dividir o trabalho
entre duas assinaturas que já existem — **Claude Code pensa** (ler chamado,
explorar, planejar, revisar código, decidir merge — trabalho compacto) e
**Codex executa** (implementar, testar, corrigir — trabalho longo e
iterativo) — preservando a janela do Claude pro que só ele faz bem.

## Status desta automação

| Peça | Status |
|---|---|
| `CLAUDE.md`, `AGENTS.md` (raiz + `worker/`), skills por área | ✅ Pronto |
| Este documento | ✅ Pronto |
| `.claude/commands/chamado.md` (comando de planejamento) | ✅ Pronto |
| `.claude/commands/codex-executar.md` (handoff pro Codex) | ✅ Pronto |
| `worker/src/chamadosDev.js` (disparo automático) | ✅ Escrito e plugado no ciclo — **falta testar com chamado real** |
| Codex CLI headless | ✅ Validado na prática (ver abaixo) |
| Claude Code headless plan mode | ✅ Validado na prática (ver abaixo) |
| Teste ponta a ponta com um chamado real | ⏳ Nunca rodado |

A automação **fica desligada** enquanto `CHAMADOS_DEV_USER_ID` e
`CHAMADOS_DEV_REPO_PATH` não forem preenchidos em `worker/.env` — o módulo
detecta a ausência e pula o ciclo, sem quebrar os outros módulos do worker.

## O que é automático vs. manual

**Automático** (sem humano por perto): pesquisa + rascunho do plano (Claude
Code headless), e implementação dentro de uma worktree isolada sem commit
(Codex headless).

**Manual/interativo, sempre** (decisão explícita do desenvolvedor, não é
limitação técnica): aprovar o plano, mandar pro Codex, aprovar o code review,
mergear na branch `eduardo`, commitar, abrir a PR. Nenhuma dessas etapas deve
virar automática sem essa decisão ser revisitada explicitamente com o
desenvolvedor.

## Arquitetura completa

```
CHAMADO_SISTEMA_EVENTO (Supabase)
  texto LIKE 'Chamado direcionado a%' AND responsavel_id = <dev>
        │
        ▼
worker/src/chamadosDev.js  (roda no ciclo de 60s já existente do worker)
  ├── cursor: último created_at processado + contador diário (máx. 5 disparos automáticos/dia)
  ├── 1) triagem: `claude --print --model haiku ...` classifica a complexidade do chamado
  ├── 2) planejamento: `claude --print --permission-mode plan --model <sonnet|opus>
  │                      --output-format json "/chamado <numero>"`
  │      SEM --worktree de propósito: plan mode é read-only e o plano sai em
  │      ~/.claude/plans/ de qualquer jeito — worktree só é criada na hora de
  │      escrever código (no /codex-executar). Timeout controlado pelo worker.
  ├── 3) localiza o plano em ~/.claude/plans/ pelo marcador <!-- chamado:NUMERO -->
  │      e copia pra worker/state/planos/<numero>.md (+ .complexidade)
  └── 4) notifica via Discord (enviarAlertaDiscord, já existente)
        │  (desenvolvedor revisa quando quiser e roda /codex-executar <numero>)
        ▼
Claude Code interativo (manual, sempre)
  ├── desenvolvedor revisa o plano, responde a seção "Perguntas em Aberto", aprova
  ├── cria a worktree agora: `git worktree add .claude/worktrees/<numero> -b <numero>`
  │     (CLAUDE.md, AGENTS.md e .claude/skills valem lá dentro porque são
  │      versionados — ver nota sobre .gitignore em "Validado na prática";
  │      já os .env NÃO vêm automático, ver seção "Credenciais")
  ├── Claude gera CODEX_PLAN.md (instruções pro Codex, incl. "não commitar",
  │     e o modelo/reasoning recomendado — ver "Modelo por complexidade")
  ├── confirma que os .env necessários já foram copiados pra dentro da worktree
  ├── roda `codex.cmd exec -C <worktree> -s workspace-write
  │          -c approval_policy=never --skip-git-repo-check --json
  │          -o resultado.md - < CODEX_PLAN.md`  (sintaxe confirmada na prática,
  │          ver "Validado na prática" acima — em Windows é sempre codex.cmd)
  ├── Codex lê AGENTS.md (raiz + `worker/AGENTS.md` se aplicável) e implementa + testa, não commita
  ├── Claude Code lê o diff/resultado.md, roda o skill code-review
  │     ├── reprovado → escreve FIX.md, roda o Codex de novo
  │     └── aprovado  → aguarda OK explícito do desenvolvedor, só então commita
  └── desenvolvedor mergeia na branch `eduardo` e abre a PR no próprio sistema
```

## Regra de ouro do título da PR (já existe em produção, não é novo)

O título da PR **precisa** começar com `SIS-AAAA-NNNN: <resumo>` (sem
colchetes) — sem chamado relacionado, usa `[SEM-CHAMADO]:` (com colchetes).
Isso já é validado por CI hoje (`.github/workflows/chamado_pr_sync.yml`,
required status check que bloqueia merge) e, quando a PR é mergeada,
`.github/workflows/chamado_concluir_no_merge.yml` **conclui o chamado
sozinho** — nenhum passo manual extra é necessário depois do merge.

## Modelo por complexidade (mesma classificação alimenta os dois agentes)

A triagem barata do lado do Claude (Haiku classificando o chamado) decide,
ao mesmo tempo, o modelo de planejamento do Claude e o modelo/reasoning que
o Codex deve usar — uma classificação única, não duas lógicas separadas:

```
simples  → Claude: sonnet | Codex: gpt-5.6-luna  + low
normal   → Claude: sonnet | Codex: gpt-5.6-terra + medium
complexo → Claude: opus   | Codex: gpt-5.6-sol    + high (xhigh/max se a
                                     investigação mostrar risco excepcional)
```

Guia completo dos modelos do Codex (fonte oficial, com exemplos por nível):
`worker/src/guia_modelos_capacidades_codex_desenvolvimento.md`.

## Credenciais — o que NUNCA fazer

**Nenhuma credencial real (chave, senha, token) deve aparecer em texto** —
nem em `CLAUDE.md`, nem em `AGENTS.md`, nem em `plan.md`/`CODEX_PLAN.md`, nem
colada em qualquer chat (ChatGPT web, etc.). Cada ferramenta se autentica de
forma própria e local:
- Claude Code: já autenticado via `claude login` (assinatura Claude Code Pro).
- Codex CLI: `codex login` (ChatGPT Plus — conta compartilhada entre CLI,
  app Desktop, extensão e web).
- Projeto (Supabase): variáveis de ambiente em arquivos `.env` locais,
  git-ignorados — ver `AGENTS.md` (raiz) pra saber os nomes das variáveis e
  onde cada arquivo mora. Nunca o valor em texto.

## Validado na prática (24/08/2026)

**Claude Code headless com `--permission-mode plan`** — testado com
`claude --print --permission-mode plan --model sonnet --output-format json "..."`
num diretório de teste isolado:

- ✅ **Não trava** esperando `AskUserQuestion`/`ExitPlanMode` — o turno
  termina sozinho (`"terminal_reason":"completed"`, exit code 0), mesmo sem
  essas ferramentas disponíveis.
- ✅ `--output-format json` devolve um objeto único com `result` (texto
  final), `permission_denials` (lista estruturada de tentativas de
  ferramenta negadas — útil pra detectar desvio de comportamento
  programaticamente), `total_cost_usd`, `session_id`, etc.
- ⚠️ **Achado importante, muda o desenho original**: a ferramenta Write em
  modo `plan` só consegue gravar no arquivo de plano que o próprio Claude
  Code escolhe automaticamente — um nome aleatório dentro de
  `~/.claude/plans/` (ex. `~/.claude/plans/diga-oi-e-escreva-binary-bumblebee.md`).
  **Nunca** um caminho arbitrário tipo `./plan.md` dentro do diretório de
  trabalho — testado explicitamente via `--append-system-prompt` instruindo
  um caminho específico, e a tentativa de Write foi **negada pelo sistema de
  permissões** (`permission_denials`), não foi só o modelo recusando.
  Consequência: **o plano nunca nasce onde você mandaria** — precisa ser
  localizado depois em `~/.claude/plans/` (arquivo mais recente que comece
  com o marcador `<!-- chamado:NUMERO -->`, gravado por
  `.claude/commands/chamado.md`) e copiado pro lugar definitivo. Isso já está
  implementado em `worker/src/chamadosDev.js` (função `localizarPlano`), que
  copia pra `worker/state/planos/<numero>.md`.
- Custo de referência dos testes: ~US$ 0,09 e ~US$ 0,19 (chamadas pequenas,
  Sonnet) — vale ter isso em mente ao rodar mais testes exploratórios.
- ✅ `--worktree <nome>` cria a worktree em `<repo>/.claude/worktrees/<nome>`,
  na branch `worktree-<nome>`, e a deixa travada (`git worktree lock`).
  **Não usamos essa flag na fase de planejamento** (plan mode é read-only e
  não escreve na worktree) — a worktree é criada no `/codex-executar`, com
  `git worktree add`, usando o número do chamado como nome da branch.

**Achado sobre `.gitignore` (corrigido em 24/08/2026)**: `docs`, `worker` e
`.claude` estavam ignorados por completo. Como `git worktree` só materializa
arquivo **versionado**, uma worktree nova nascia sem os skills, sem os slash
commands e sem esta documentação — testado e confirmado: o `/chamado` não era
encontrado lá dentro (o Claude tratava como texto solto). As três linhas foram
removidas do `.gitignore` (o desenvolvedor confirmou que estavam ali por
engano), mantendo ignorados `.claude/settings.local.json` (pessoal),
`.claude/worktrees/` (gerado), e — via `worker/.gitignore` interno —
`worker/node_modules`, `worker/.env` e `worker/.wwebjs_auth` (sessão do
WhatsApp). Verificado: nenhum segredo passou a ser versionado.

**Codex CLI headless** — testado e confirmado na prática (24/08/2026, Windows/PowerShell):

- ✅ **No Windows, chame sempre `codex.cmd`, nunca `codex` puro** dentro do
  PowerShell — o wrapper `codex.ps1` que o `npm install -g` gera é bloqueado
  pela política de execução de scripts do Windows por padrão
  (`UnauthorizedAccess`/`PSSecurityException`). Isso vale pro worker também:
  ao dar `spawn(...)` a partir do Node, use o executável `codex.cmd`
  explicitamente.
- ✅ **Não existe flag `--ask-for-approval`** em `codex exec` (diferente do
  que um guia mais antigo sugeria) — o mecanismo real é `-c approval_policy=never`
  (override de config via `-c chave=valor`, sintaxe TOML). Confirmado
  funcionando sem nenhum prompt de confirmação.
- ✅ `-s workspace-write` (sandbox) funciona como esperado.
- ✅ `-m <modelo>` seleciona o modelo (ex. `gpt-5.6-terra`) — confirmado.
  Reasoning effort é `-c model_reasoning_effort=<minimal|low|medium|high|xhigh>`
  (não é uma flag dedicada, é outro override `-c`; fonte: [Codex CLI config.toml guide 2026](https://majesticlabs.dev/blog/202607/codex-cli-configuration-guide)) — ainda não testado na prática, só confirmado por fonte externa.
- ✅ **`--skip-git-repo-check` costuma ser necessário** — o Codex tem um
  conceito de "diretório confiável" separado de "é um repo git", e em modo
  não-interativo ele não pode perguntar "confia nessa pasta?", então recusa
  a rodar a menos que essa checagem seja pulada explicitamente.
- ✅ `--json` devolve eventos estruturados limpos e úteis pro orquestrador:
  `thread.started` → `turn.started` → `item.completed` (`type: agent_message`
  ou `type: file_change` com `path`/`kind` exatos) → `turn.completed` (com
  `usage`: tokens de entrada/cache/saída/raciocínio).
- ✅ `-o/--output-last-message <arquivo>` grava só a última mensagem do
  agente em texto limpo — é o que o Claude Code deve ler depois pra saber o
  resumo do que foi feito, sem precisar reprocessar o JSONL inteiro.
- ✅ Não commitou nada sozinho (rodou até numa pasta sem `.git` sem
  problema) — confirma que o comportamento de "nunca commitar" pode ser só
  por instrução (`AGENTS.md` já cobre isso), não precisa de flag técnica
  adicional.

Comando confirmado, real, testado (adaptar caminho/prompt/modelo):
```
codex.cmd exec -C <worktree> -s workspace-write -c approval_policy=never \
  -m gpt-5.6-terra --skip-git-repo-check --json -o resultado.md - < CODEX_PLAN.md
```

## Worktree precisa de `npm install` próprio (validado na dor)

Uma worktree nova não tem `node_modules`. A tentação é criar um link
(junction/symlink) pro `node_modules` do repositório principal — **não
funciona, testado em 24/08/2026**:

- O sandbox do Codex (`-s workspace-write`) bloqueia acesso a caminho fora da
  worktree, então `npm run test`/`build` falham com "Acesso negado" e o Codex
  não consegue validar o próprio trabalho.
- Mesmo fora do sandbox, o Vitest quebra a resolução de módulos através da
  junction: os 15 arquivos de teste falham com "No test suite found in file",
  enquanto passam normalmente no repositório principal.

Solução: `npm install --no-audit --no-fund` dentro da worktree, uma vez por
worktree (leva alguns minutos). Com `node_modules` real, os 217 testes passam
na worktree normalmente. Isso já está instruído em
`.claude/commands/codex-executar.md`.

## Como ligar a automação (passo a passo)

1. Abra `worker/.env` (o arquivo real, não o `.example`) e acrescente as duas
   linhas novas, com os valores do seu ambiente:
   ```
   CHAMADOS_DEV_USER_ID=<seu uuid em profiles/auth.users>
   CHAMADOS_DEV_REPO_PATH=C:\Users\<voce>\Desktop\Projeto_ERP_LOVABLE
   ```
   Enquanto essas duas estiverem em branco, a automação fica desligada e o
   resto do worker continua funcionando normalmente.
2. Teste o comando manualmente primeiro, numa sessão interativa do Claude
   Code: `/chamado SIS-AAAA-NNNN` com um chamado real já atribuído a você.
   Confira se o plano gerado faz sentido.
3. Só depois disso, reinicie o worker (`npm start` dentro de `worker/`) e
   crie/direcione um chamado de teste pra você mesmo — deve chegar um alerta
   no Discord com o caminho do plano em até ~1 minuto.
4. Com o plano na mão, rode `/codex-executar SIS-AAAA-NNNN` numa sessão
   interativa pra ver o handoff completo pro Codex.

## Limites e comportamento em falha

- Máximo de **5 disparos automáticos por dia** — o 6º chamado em diante só
  gera notificação no Discord dizendo pra rodar `/chamado` manualmente.
- Se a triagem falhar, assume `normal` (não trava o fluxo).
- Se a sessão de planejamento falhar ou o plano não for encontrado, manda
  alerta no Discord e **marca o evento como processado mesmo assim** — de
  propósito, pra não ficar retentando o mesmo chamado a cada 60s (mesmo
  padrão de `lembreteWhatsapp.js`).
- Timeouts: 2 min pra triagem, 15 min pra planejamento — controlados pelo
  worker, não pela ferramenta.
