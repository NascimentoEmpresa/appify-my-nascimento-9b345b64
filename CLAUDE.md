# Projeto_ERP_LOVABLE

ERP interno da empresa, nascido e ainda gerenciado via **Lovable** (existe uma
pasta `.lovable/` na raiz — o Lovable pode regenerar `src/integrations/supabase/client.ts`
e reintroduzir credenciais hardcoded; se isso acontecer, reaplicar o import de
`env.ts`). Stack: **React 18 + Vite 5 + shadcn/ui (Radix + Tailwind) + React
Query** no frontend, **Supabase** (Postgres + RLS + Edge Functions Deno) como
único backend — não existe servidor Node de aplicação, só o `worker/`
(processo à parte, ver `worker/AGENTS.md`) para automações fora do request/response
(WhatsApp, e-mail, Discord).

714+ migrations em `supabase/migrations/`, ~4-5 meses de histórico ativo
(múltiplas migrations por dia em fases recentes). Projeto maduro, não um
protótipo.

## Como o acesso funciona

Documentado em detalhe no [`README.md`](README.md) da raiz — leia antes de
criar qualquer tela ou tabela nova. Resumo: acesso é 100% por usuário
(`/app/administracao?tab=modulos`), nunca por cargo/role, nunca por empresa.
Toda tela nova ganha 1 linha em `app_menu`; blocos com visibilidade própria
ganham um "menu fantasma" (`app_menu.rota = NULL`); no React, gateie com
`<AcessoGate menu="..." acao="...">`; no banco, gateie RLS com
`has_screen_access(auth.uid(), '<codigo>', '<acao>')` ou `can_access(...)` —
**nunca** `has_role(...)` nem `empresa_id = get_user_empresa(...)` (essa
última está em descontinuação, citada no README como o que NÃO fazer).

`tem_acesso_menu()` também existe e ainda é usada em módulos mais antigos
(ex. Chamados de Sistemas) — os dois padrões coexistem, não há migração
retroativa completa. Para código novo, prefira `has_screen_access`/`can_access`.

Deny-by-default é o padrão atual e definitivo (`ACESSO_ABERTO_SEM_PERMISSOES = false`
em `src/lib/acesso.ts`) — foi `true` só durante uma janela curta em julho/2026
enquanto o backend de permissões era construído.

## Convenções de banco (ver `.claude/skills/backend-supabase/SKILL.md` para o detalhe)

- Tabelas de **domínio/negócio**: `"NOME_MAIUSCULO"` citado (ex. `"CHAMADO_SISTEMA"`).
  Tabelas de **infraestrutura do sistema** (mais antigas): `nome_minusculo`
  (`app_menu`, `profiles`, `screen_permission_user`...). Funções/triggers/
  índices/policies: sempre `snake_case` minúsculo, independente do case da
  tabela.
- **Migrations não se auto-aplicam** — mergear `.sql` em `main` não roda nada
  no Supabase real; precisa ser aplicado manualmente no SQL Editor do projeto
  remoto. Não há `supabase start`/banco local (confirmado: `supabase/config.toml`
  não tem seção `[db]`/`[api]`).
- Funções `SECURITY DEFINER` levam quase sempre `SET search_path = public, pg_temp`.
- Migration que cria/altera função, tabela ou policy termina com
  `NOTIFY pgrst, 'reload schema';`.
- Trigger/policy nunca usa `CREATE OR REPLACE` (Postgres não suporta) — sempre
  `DROP ... IF EXISTS` seguido de `CREATE`, pra idempotência ao reexecutar.
- Migrations de hotfix/permissão costumam terminar com um bloco
  `-- ROLLBACK` comentado com o DDL inverso — siga esse padrão em mudanças
  sensíveis.

## Convenções de código

- Nomenclatura em **português** ponta a ponta (variáveis, componentes, tabelas,
  colunas) — não é "banco em português, código em inglês".
- Comentários longos e "arqueológicos" em arquivos-chave de acesso/auth são
  deliberados (explicam *por que*, geralmente citando um incidente de produção
  com data) — mantenha esse estilo ao editar esses arquivos, não remova.
- `@typescript-eslint/no-unused-vars` está desligado de propósito no
  `eslint.config.js` — não é lint a corrigir.
- Testes (`Vitest`, `npm run test`) focam em lógica de negócio/regras
  (`src/test/*.test.ts`), não em rendering de componente.

## Branches — quatro, e só

**NUNCA crie branch nova. Nem temporária, nem `fix/`, `ci/`, `chore/`, nem
"só pra isolar um teste".** Existem exatamente quatro: `eduardo`, `joao`,
`pablo` e `main`. Cada dev trabalha na branch com o próprio nome e abre PR
para a `main` a partir dela. Trabalho novo vai **na branch pessoal que já
está em uso** — em sessão de agente, `pablo`.

Isso não é preferência de estilo: é a **R8**, regra absoluta verificada por
`.github/scripts/portaria-pr.mjs` (ver [`.github/REGRAS-PR.md`](.github/REGRAS-PR.md)).
Branch fora da lista deixa o check vermelho e a PR não merge. Não há label
nem comentário `portaria-ok` que libere — só R2 e R3 aceitam justificativa
por linha. A regra já foi mais frouxa e foi apertada de propósito: a v1
aceitava branch temporária com justificativa, e a exceção virou porta usada de
novo.

Se você se pegar querendo uma branch nova, a resposta certa é commitar na
`pablo` mesmo. Se achar que o caso é especial, **pergunte antes** — não crie
e avise depois.

## Automação de chamados de desenvolvimento

Demandas chegam como chamados em `/app/sistemas/chamados/dev` (tabela
`"CHAMADO_SISTEMA"`). Fluxo documentado por completo em
[`docs/automacao-chamados.md`](docs/automacao-chamados.md): o comando
`/chamado <numero>` é a receita única para ler um chamado e montar um plano de
implementação (usada manualmente ou disparada pelo `worker/`).

**Ao abrir a PR que resolve um chamado, o título TEM que começar com
`SIS-AAAA-NNNN: <resumo>`** (sem colchetes) — CI (`chamado_pr_sync.yml`)
bloqueia o merge se faltar, e (`chamado_concluir_no_merge.yml`) **conclui o
chamado sozinho quando a PR é mergeada**, sem passo manual extra. PR sem
chamado relacionado usa `[SEM-CHAMADO]:` (com colchetes) no início do título.

## Pastas fora do ciclo normal de desenvolvimento

`worker/` (processo Node à parte — alertas), `espelho-mysql/`, `integracao-senior/`,
`migracao-sistema-antigo/` — scripts/serviços auxiliares, não fazem parte do
fluxo de "criar uma tela/tabela nova".
