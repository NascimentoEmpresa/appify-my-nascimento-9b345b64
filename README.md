# ERP Grupo Nascimento

React + Vite + TypeScript + Supabase.
<!-- sync: 2026-08-11 -->

## Gerenciamento de acessos — convenção para telas novas

O acesso do sistema é 100% por usuário, configurado em `/app/administracao?tab=modulos` (aba "Acesso por Usuário") — nunca por cargo/role e nunca por empresa vinculada. Isso só funciona se toda tela nova seguir esta regra:

1. **Toda tela nova ganha 1 linha em `app_menu`** (na migration que cria a tela), vinculada ao `app_modulo` do módulo correspondente. **Se o módulo (`app_modulo`) também for novo, não precisa fazer mais nada** — um trigger (`trg_criar_perfil_acesso_do_modulo`) já cria sozinho um perfil de acesso "espelho" daquele módulo, pronto pra atribuir em "Acesso por Usuário → Perfis Atribuídos", sem precisar de nenhuma configuração manual.
2. **Todo bloco/ação dentro da tela que pode ter visibilidade diferente por pessoa** (uma seção, uma ação, um botão) ganha a sua própria linha em `app_menu`, com `rota = NULL` — é um "menu fantasma", só existe para carregar uma permissão, nunca é uma página navegável. Referência viva desse padrão: os 7 papéis de `sistemas_comite`, `sistemas_gerente_sistemas` etc. na migration `20260624000001_solicitacoes_erp_fluxo_completo_papeis.sql`, consumidos por `src/pages/sistemas/SolicitacoesErp.tsx`. Quem já tem o perfil "espelho" do módulo ganha esse bloco novo automaticamente também — o perfil de módulo cobre qualquer menu daquele `app_modulo`, mesmo os criados depois.
3. **No componente React, envolva o bloco em `<AcessoGate menu="<codigo>" acao="visualizar">`** (`src/components/auth/AcessoGate.tsx`) em vez de checar `role`/`cargo` no código. Quem decide QUEM vê aquele código nunca é quem desenvolve a tela — é o admin, depois, no painel.
4. Se a tabela de dados por trás da tela precisar de RLS, gateie com `has_screen_access(auth.uid(), '<codigo>', '<acao>')` ou `can_access(...)` — nunca com `has_role(...)` nem `empresa_id = get_user_empresa(...)`. Note que o perfil de módulo libera **qualquer ação** para os menus daquele módulo (não só `visualizar`) — a regra de negócio de cada bloco (o que uma ação específica permite) fica inteiramente a cargo do código do bloco, não do gate.

Depois que a migration com os `app_menu`/`app_modulo` novos é aplicada, o admin já consegue atribuir aquele módulo (ou ligar/desligar um bloco específico) pra qualquer usuário, sem precisar de deploy nenhum — o painel é 100% data-driven (lê `app_modulo`/`app_menu`/`perfil_acesso` direto do banco).
