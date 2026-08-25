# worker/AGENTS.md

Regras específicas desta pasta, além das gerais em [`../AGENTS.md`](../AGENTS.md).

`worker/` é um processo Node **separado** do app Vite, roda localmente (fora
do sandbox de qualquer worktree, na máquina real do usuário) — ele é quem
**dispara** você (Codex) ou o Claude Code headless para uma worktree nova,
não algo que você deveria normalmente estar editando de dentro de uma
worktree isolada, a menos que a tarefa seja explicitamente sobre o próprio
worker (ex.: um chamado pedindo ajuste no `worker/src/chamadosDev.js`).

Se a tarefa for sobre o worker: `SUPABASE_SERVICE_ROLE_KEY` (em `worker/.env`,
nunca em texto) **ignora toda RLS** — qualquer código aqui já enxerga tudo,
não tente simular sessão de usuário. Siga o padrão de módulo descrito em
`.claude/skills/worker/SKILL.md`: função `async function algumaCoisa(supabase, ...)`,
plugada em `rodarCiclo()` de `src/index.js` dentro de `try/catch` isolado,
erro em um item não trava os demais.
