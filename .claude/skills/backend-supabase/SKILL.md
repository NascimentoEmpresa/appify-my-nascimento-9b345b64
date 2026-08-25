---
name: backend-supabase
description: Convenções de banco/Supabase deste ERP — nomenclatura, RLS, Edge Functions, storage, padrão de migration. Use ao criar ou alterar qualquer migration, RLS policy, RPC ou Edge Function.
---

# Backend/Supabase — Projeto_ERP_LOVABLE

Todo o backend é Supabase (Postgres + RLS + Edge Functions Deno) — não existe
servidor de aplicação Node separado (o `worker/` é outra coisa, ver
`worker/AGENTS.md`). 714+ migrations em `supabase/migrations/`, sem banco
local (`supabase/config.toml` não tem seção `[db]`/`[api]` — não há
`supabase start`). **Migrations não se auto-aplicam**: aplicar no SQL Editor
do projeto remoto é sempre manual, mesmo depois do merge em `main`.

## Nomenclatura

- Tabela de **domínio/negócio**: `"NOME_MAIUSCULO"` citado, ex.
  `"CHAMADO_SISTEMA"`, `"CHAMADO_SISTEMA_EVENTO"`. Tabela de **infraestrutura
  do sistema** (mais antiga): `nome_minusculo` (`app_menu`, `profiles`,
  `screen_permission_user`, `perfil_acesso_permissao`).
- Função/trigger/índice/policy: sempre `snake_case` minúsculo, mesmo sobre
  tabela MAIÚSCULA (ex. `idx_chamado_sistema_solicitante` sobre
  `"CHAMADO_SISTEMA"`).

## Estrutura de uma migration nova

Nome do arquivo: `<timestamp>_<descricao_snake_case>.sql` (a era de nome
gerado automaticamente pelo Lovable, `<timestamp>_<uuid>.sql`, é só histórica —
não replique isso em migration nova).

Módulo pequeno/médio: **1 arquivo monólito** cobrindo menus → tabelas →
triggers → RLS → storage → RPCs, com seções numeradas em comentário (`-- 1)
Menus...`). Exemplo de referência completo: `supabase/migrations/20260802000001_chamados_sistemas.sql`.
Módulo grande ou reforma ampla de RLS: série de arquivos `faseN`/`loteNx` no
mesmo dia, cada um cobrindo uma fatia. Depois da criação, é normal uma cauda
de migrations pequenas incrementais (1 arquivo = 1 hotfix/ajuste) por semanas.

Padrões quase universais em função/trigger nova:
```sql
CREATE OR REPLACE FUNCTION public.minha_funcao(...)
RETURNS ... LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ ... $$;
```
- Trigger/policy **nunca** usa `CREATE OR REPLACE` (Postgres não suporta) —
  sempre `DROP ... IF EXISTS` seguido de `CREATE`, pra reexecução idempotente.
- RPC sensível: `REVOKE ALL ... FROM PUBLIC` (e de `anon` quando faz sentido)
  seguido de `GRANT EXECUTE ... TO authenticated`.
- Migration que cria/altera função, tabela ou policy termina com
  `NOTIFY pgrst, 'reload schema';`.
- Migration de hotfix/permissão costuma terminar com bloco `-- ROLLBACK`
  comentado com o DDL inverso — siga esse padrão em mudança sensível.
- Guard trigger de campo (restringir quais colunas um papel pode alterar num
  UPDATE) usa `IF NEW.campo IS DISTINCT FROM OLD.campo ... RAISE EXCEPTION`
  campo a campo — ver `chamado_sistema_guard()` como referência.

## RLS — funções auxiliares (coexistem, prefira as mais novas em código novo)

- **`has_screen_access(auth.uid(), '<menu_codigo>', '<acao>')`** e
  **`can_access(...)`** são o padrão atual/dominante (>1200 usos) e o
  oficialmente documentado no `README.md` da raiz pra telas novas.
- `list_accessible_menus(...)` é a RPC que o frontend usa pra listar menus
  visíveis.
- `tem_acesso_menu(_menu_codigo, _acao DEFAULT 'visualizar')` é mais antiga
  mas ainda ativamente usada em módulos específicos (ex. Chamados de
  Sistemas) — não a remova de onde já está, mas não a use como padrão em
  RLS nova.
- `get_user_empresa()` está em descontinuação — o README cita
  `empresa_id = get_user_empresa(...)` explicitamente como o que **não**
  fazer.
- `set_updated_at()` é a trigger function padrão pra `updated_at`.

**Atenção**: `tem_acesso_menu()`/`has_screen_access()` controlam se o usuário
acessa aquele *menu/tela*, não se ele vê aquela *linha específica* — em
tabela com dono, combine sempre com checagem de `solicitante_id = auth.uid()`
/`responsavel_id = auth.uid()` (ver `chamado_sistema_select` como referência),
senão vaza dado entre usuários que têm o mesmo menu liberado.

## Menu novo nasce aberto

Um menu criado sem nenhuma regra em `perfil_acesso_permissao` fica visível
pra todo autenticado — se a tela precisa de RLS/liberação restrita, semeie a
regra na própria migration que cria o menu, não deixe pra depois.

## Storage

Bucket por módulo, criado inline na migration que cria a tabela de anexo
correspondente (não há arquivo central de buckets). Padrão:
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('meu-bucket', 'meu-bucket', false, 20971520) -- 20 MB
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "meu bucket anexo select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'meu-bucket');
```
Privado (`public = false`) por padrão, `file_size_limit` em bytes com
comentário do tamanho em MB, nome de policy entre aspas com espaços (não
snake_case), `ON CONFLICT (id) DO NOTHING` pra idempotência.

## Edge Functions (`supabase/functions/`, Deno)

33 funções, cada uma com seu próprio `index.ts` — a maioria **não**
compartilha código (CORS/init duplicados inline), só `_shared/whatsapp-bot.ts`
é helper real. Estrutura típica: comentário de cabeçalho (propósito/
consumidor/autenticação) → import `@supabase/supabase-js` via `esm.sh` →
objeto CORS inline → `Deno.serve(async (req) => {...})` tratando `OPTIONS`
manualmente. Categorias existentes: admin de usuário (service role),
integração CI/GitHub Actions (secret compartilhado `CHAMADOS_CI_SECRET`, não
JWT — ver `chamado-info`/`chamado-vincular-pr`/`chamado-concluir-pr`),
WhatsApp (maior grupo), notificações push, Canal de Ética (autenticação
própria por protocolo+senha, não JWT), cron/tick agendados.

`supabase/config.toml` controla `verify_jwt` por função — funções chamadas
por webhook público ou por CI ficam com `verify_jwt = false` e validam por
outro mecanismo (HMAC, secret) explicado em comentário ao lado.

## Tipos gerados

`src/integrations/supabase/types.ts` (~19.700 linhas) é gerado por
`supabase gen types typescript --project-id <id>` **fora** do CI/scripts do
repo — não há step automático que o regenere. Depois de qualquer migration
que muda schema, considere se o frontend precisa desse arquivo atualizado
manualmente.

## CI

`.github/workflows/ci.yml` nunca aplica migration nem toca Supabase — só
type-check, `npm test`, `npm run build`. Aplicar migration em produção
continua 100% manual (SQL Editor).
