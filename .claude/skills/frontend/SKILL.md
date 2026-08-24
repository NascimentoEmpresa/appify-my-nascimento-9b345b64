---
name: frontend
description: Convenções do frontend deste ERP (React + Vite + shadcn/ui) — estrutura de pastas, autenticação, controle de acesso, padrão de hooks/Supabase, testes. Use ao criar ou alterar qualquer tela, componente ou hook em src/.
---

# Frontend — Projeto_ERP_LOVABLE

## Stack

React 18.3 + Vite 5 (SPA, `BrowserRouter`, não é Next.js) + `@tanstack/react-query`
v5 para dados de servidor + shadcn/ui sobre Radix + Tailwind + `react-hook-form`
+ `zod`. Ícones `lucide-react`, toasts `sonner`. `zustand` está instalado mas o
estado global real do projeto é majoritariamente Context, não zustand — confirme
antes de assumir um padrão de estado global novo.

Rotas centralizadas em `src/App.tsx` (arquivo grande, ~250+ páginas importadas),
todas dentro de `<Route path="/app" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>`.

## Estrutura de `src/`

```
App.tsx                      # todas as rotas + providers
components/                  # compartilhados; subpastas por módulo quando existem
components/ui/               # shadcn
context/                     # Contexts globais (nome da pasta é "context", singular)
hooks/                       # ~70 hooks, 1 por entidade/módulo
integrations/supabase/       # client.ts, env.ts, types.ts (gerado)
lib/                         # utilitários de domínio
pages/<modulo>/              # 1 pasta por módulo de negócio
test/                        # Vitest
```

## Autenticação

`src/hooks/useAuth.tsx` — `AuthContext`/`AuthProvider`/`useAuth()` (fica em
`hooks/`, não em `context/`). Ao trocar de usuário, chama `queryClient.clear()`
pra não vazar cache do React Query entre sessões. `src/components/ProtectedRoute.tsx`
bloqueia render enquanto carrega, redireciona pra `/login` sem sessão, força
`/trocar-senha` se `mustChange`. Existe um "modo externo" (`useModoExterno.ts`,
sessão anônima do Supabase pra encarregados de obra sem cadastro) e um
`DemoModeContext` — considere os dois ao mexer em qualquer guarda de rota.

## Controle de acesso (ver `README.md` da raiz para a convenção completa)

- `src/hooks/useAccessibleMenus.ts` — RPCs `list_accessible_menus`/
  `list_configured_menu_codes`, expõe `matchMenuCode(pathname, routes)`.
- `src/components/auth/RouteGuard.tsx` — gateia rota inteira, loga negações em
  `access_audit_log`.
- `src/components/auth/AcessoGate.tsx` — gateia bloco/botão dentro de tela já
  liberada. **Este é o componente a usar em telas novas**, nunca checar
  `role`/`cargo` no componente.
- `src/hooks/useScreenAccess.ts` — RPC `has_screen_access` granular por
  tela+ação (`incluir`, `alterar`, `excluir`, `aprovar`, `exportar`, ...).
- `src/context/PermissoesContext.tsx` é legado/complementar — o próprio
  comentário no topo diz que `role` é só decorativo, nunca decide acesso.
- `src/components/layout/Sidebar.tsx` define módulos estáticos em código
  (`ModuleDef[]`) mas filtra visibilidade em runtime pelos mesmos
  `codes`/`inactiveCodes`.

Armadilha já documentada no código: `codigo` de `app_menu` só é único por
módulo (`UNIQUE (modulo_id, codigo)`), não globalmente — `matchMenuCode`
desempata por prefixo mais longo e depois `ativo`.

## Padrão de hook por módulo/entidade

Um arquivo `useX.ts` em `src/hooks/` por entidade (ex. `useContratos.ts`):
reexporta `Row`/`Insert` de `Database["public"]["Tables"][...]`, um `useQuery`
por consulta (`queryKey` = array simples, nome da entidade), um `useMutation`
por escrita com `onSuccess` chamando `invalidateQueries`. Chamada Supabase
sempre `const { data, error } = await supabase.from(...)...; if (error) throw error;`.
Client único em `src/integrations/supabase/client.ts`, credenciais via
`src/integrations/supabase/env.ts` (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
— só essas duas, guarda explícita no build se faltarem).

## Estrutura de um módulo novo

Pasta homônima em `src/pages/<modulo>/`: página(s) "lista"/"painel" + páginas
de detalhe/ação + diálogos (`*Dialog.tsx`) + `types.tsx` local +,
opcionalmente, um hook de permissão específico do módulo dentro da própria
pasta (ex. `src/pages/chamados/useChamadoPerms.ts`) quando a permissão é muito
local — não force isso pra todo módulo novo, só quando fizer sentido. Módulos
grandes nem sempre decompõem em vários arquivos pequenos — arquivos únicos de
40-70KB existem e são aceitos neste projeto.

## Testes e lint

`npm run test` (Vitest, `jsdom`, `src/**/*.{test,spec}.{ts,tsx}`) — foco em
lógica de negócio, não rendering. `npm run lint` (ESLint 9 flat config).
**`@typescript-eslint/no-unused-vars` está desligado de propósito** — não é
lint a corrigir. Sem Prettier configurado.

## Não óbvio

- Todo o código (variáveis, componentes, nomes de tabela) é em português.
- Comentários longos citando incidentes de produção com data são convenção
  deliberada em arquivos de acesso/auth — preserve o estilo.
- Menu inativo ≠ rota liberada (já foi bug real, corrigido — não reverta essa
  lógica em `useAccessibleMenus.ts`).
