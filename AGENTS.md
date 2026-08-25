# AGENTS.md — instruções operacionais pro Codex

Este arquivo é lido pelo Codex CLI. Convenções gerais do projeto (stack,
padrões de código, controle de acesso) estão em [`CLAUDE.md`](CLAUDE.md) —
leia os dois, este aqui cobre só regras operacionais de execução. Existem
`AGENTS.md` específicos em subpastas (ex. `worker/AGENTS.md`) — eles se
aplicam além deste, não em vez dele.

## Regra nº 1: nunca commitar, pushar, mergear ou rebasear sozinho

Implemente, teste, corrija — **pare aí**. Deixe as alterações no working
directory sem commit. Quem revisa e decide se commita é o Claude Code, depois
de aprovação humana. Isso vale mesmo se a tarefa parecer concluída com
sucesso: "concluído" aqui significa "pronto pra revisão", não "pronto pra
virar commit".

## Sandbox e worktree

Você deve estar rodando com `--sandbox workspace-write` dentro de uma git
worktree isolada (`-C <caminho-da-worktree>`), nunca direto no checkout
principal. Se por algum motivo você perceber que está rodando fora de uma
worktree isolada, pare e avise em vez de continuar.

## Variáveis de ambiente — nunca em texto, sempre lidas do arquivo

**Nenhuma credencial real deve aparecer em texto/prompt/chat.** Este projeto
usa dois `.env` (não versionados, git-ignorados):

- `.env` (raiz) — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (frontend).
- `worker/.env` — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ignora RLS —
  cuidado redobrado), `DISCORD_BOT_TOKEN`, `DISCORD_USER_ID`, `SMTP_*`, e
  (quando a automação de chamados da Fase 3 existir) `CHAMADOS_DEV_USER_ID`,
  `CHAMADOS_DEV_REPO_PATH`.

**Importante sobre worktree**: `git worktree` compartilha o histórico do
repositório, mas arquivos git-ignorados (os dois `.env` acima) **não existem
automaticamente** numa worktree nova — é um checkout só de arquivos
rastreados. Se uma tarefa depender de rodar contra o Supabase de verdade
(migration, teste de integração), confirme antes se o `.env` relevante foi
copiado pra dentro da worktree; se não foi, pare e avise em vez de tentar
adivinhar ou pedir a credencial em texto.

## Escolha de modelo por complexidade

O `CODEX_PLAN.md` de cada tarefa (gerado pelo Claude Code a partir do chamado)
já vem com o modelo/reasoning recomendado, baseado na mesma classificação de
complexidade usada do lado do Claude:

```
simples  → gpt-5.6-luna  + low     (CSS, labels, docs, renames, testes repetitivos)
normal   → gpt-5.6-terra + medium  (CRUD, endpoints, migrations simples, integrações)
complexo → gpt-5.6-sol   + high    (auth, concorrência, migração arquitetural, alto risco;
                                     xhigh/max se a investigação mostrar risco excepcional)
```

Guia completo de modelos (fonte oficial, com exemplos): `worker/src/guia_modelos_capacidades_codex_desenvolvimento.md`.
Se o `CODEX_PLAN.md` não especificar modelo, use `gpt-5.6-terra + medium`
como padrão e escale pra `sol` se, durante a investigação, perceber que o
risco é maior do que parecia.

## Depois de implementar

Sempre, antes de considerar a tarefa pronta pra revisão:
```
1. lint (npm run lint)
2. typecheck (se aplicável ao que foi tocado)
3. testes (npm run test)
4. build (npm run build) — só se a mudança puder afetar build
5. reportar bloqueios restantes, se houver, em vez de forçar uma solução incompleta
```

## Contexto completo da automação

O fluxo inteiro (chamado → worker → Claude planeja → você executa → Claude
revisa → merge) está descrito ponta a ponta em
[`docs/automacao-chamados.md`](docs/automacao-chamados.md).
