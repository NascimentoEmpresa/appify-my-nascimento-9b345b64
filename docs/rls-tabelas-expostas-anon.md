# Quatro tabelas sem RLS acessíveis pelo papel `anon`

> Achado em **09/10/2026**, durante o levantamento da migração do Supabase.
> Quem achou não tinha esse objetivo — apareceu ao comparar permissões entre a
> produção e o cluster novo.
>
> **Nada foi lido dessas tabelas e nada foi alterado em produção.** A lista de
> permissões abaixo já é a prova; abrir os dados não acrescentaria nada.

## O que está acontecendo

Quatro tabelas do schema `public` estão **sem RLS** e ao mesmo tempo
**concedem todos os privilégios ao papel `anon`**:

| Tabela | Linhas | `anon` pode | `authenticated` pode |
|---|---|---|---|
| `planilha_custo` | 4 | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER | o mesmo |
| `grade` | 1 | idem | idem |
| `bkp_screen_permission_20260909` | 0 | idem | idem |
| `fornecedor_backup_20260821` | 0 | idem | idem |

Conferido assim (roda no SQL Editor, só leitura):

```sql
select c.relname,
       c.relrowsecurity as tem_rls,
       string_agg(distinct a.privilege_type, ',' order by a.privilege_type)
         filter (where a.grantee = 'anon') as anon_pode
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join information_schema.role_table_grants a
         on a.table_name = c.relname and a.table_schema = 'public'
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
 group by 1, 2 order by 1;
```

## Por que isso é exposição real

`anon` é o papel **não autenticado**. A chave dele, `VITE_SUPABASE_ANON_KEY`,
viaja dentro do JavaScript entregue a qualquer visitante — e neste projeto ela
também está no `.env`, que é **versionado no repositório público**.

Somando: chave pública + nenhuma RLS + `GRANT ALL` ⇒ qualquer pessoa na
internet pode ler **e escrever** nessas quatro tabelas chamando
`/rest/v1/<tabela>` direto, sem login.

As outras **643** tabelas do schema estão com RLS ligada e não têm esse
problema — o padrão do projeto está certo; estas quatro escaparam.

## O que cada uma é

**`planilha_custo`** — a mais sensível. É de onde sai o posto de cada
empregado (ver `empregados_colunas_e_ligacao_contrato`). Consumida por:

- `src/hooks/usePlanilhaCusto.ts`
- e por 9 funções do banco: `contrato_quadro_listar`, `esp_col_arvore`,
  `rec_custo_do_posto`, `rh_ac_mover_colaborador`, `rh_ac_painel`,
  `rh_ac_vincular_postos`, `sup_cat_postos_do_contrato`,
  `sup_posto_sincronizar_planilha`, `sync_contrato_encerrado`

**`grade`** — usada por `useCapaEdital.ts`, `useGrade.ts` e
`useGradeAtivaCount.ts` (9 arquivos no total).

**`bkp_screen_permission_20260909` e `fornecedor_backup_20260821`** — cópias de
segurança antigas, **0 linhas** e **0 referências** no código. Nada deveria
alcançá-las pela API.

## Como corrigir

⚠️ **Ligar RLS sem criar política quebra tela.** O padrão passa a ser negar
tudo, e quem hoje lê legitimamente pelo `authenticated` recebe **lista vazia,
sem erro** — o sintoma clássico de `rls_negada_devolve_lista_vazia_nao_erro`:
combobox vazio, tela em branco, nenhuma mensagem. Por isso a RLS e a política
têm que entrar **na mesma migration**.

### As duas de backup — só revogar

Não têm código que as use; não precisam de política nenhuma.

```sql
REVOKE ALL ON public.bkp_screen_permission_20260909 FROM anon, authenticated;
REVOKE ALL ON public.fornecedor_backup_20260821     FROM anon, authenticated;
ALTER TABLE public.bkp_screen_permission_20260909 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_backup_20260821     ENABLE ROW LEVEL SECURITY;
```

### `planilha_custo` e `grade` — RLS + política no padrão do projeto

O acesso deste ERP é por usuário (`has_screen_access` / `can_access`), nunca
por cargo nem por empresa. **Qual `menu_codigo` gateia cada uma é decisão de
quem conhece as telas** — quem escreveu este documento não tem essa informação
e não vai chutar.

Esqueleto, seguindo as convenções do `CLAUDE.md` (sem `CREATE OR REPLACE` em
policy, com `NOTIFY` no fim e bloco `-- ROLLBACK` comentado):

```sql
-- planilha_custo
REVOKE ALL ON public.planilha_custo FROM anon;
ALTER TABLE public.planilha_custo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planilha_custo_leitura ON public.planilha_custo;
CREATE POLICY planilha_custo_leitura ON public.planilha_custo
  FOR SELECT TO authenticated
  USING (has_screen_access(auth.uid(), '<MENU_CODIGO>', 'visualizar'));

DROP POLICY IF EXISTS planilha_custo_escrita ON public.planilha_custo;
CREATE POLICY planilha_custo_escrita ON public.planilha_custo
  FOR ALL TO authenticated
  USING      (has_screen_access(auth.uid(), '<MENU_CODIGO>', 'editar'))
  WITH CHECK (has_screen_access(auth.uid(), '<MENU_CODIGO>', 'editar'));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP POLICY IF EXISTS planilha_custo_escrita ON public.planilha_custo;
-- DROP POLICY IF EXISTS planilha_custo_leitura ON public.planilha_custo;
-- ALTER TABLE public.planilha_custo DISABLE ROW LEVEL SECURITY;
-- GRANT ALL ON public.planilha_custo TO anon;
```

### Atenção às 9 funções que leem `planilha_custo`

Se forem `SECURITY DEFINER`, continuam funcionando — rodam como o dono e a RLS
do chamador não se aplica. Se forem `SECURITY INVOKER` (o padrão), passam a
obedecer à política nova e podem devolver menos linhas. Conferir antes:

```sql
select proname, prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('contrato_quadro_listar','esp_col_arvore','rec_custo_do_posto',
                   'rh_ac_mover_colaborador','rh_ac_painel','rh_ac_vincular_postos',
                   'sup_cat_postos_do_contrato','sup_posto_sincronizar_planilha',
                   'sync_contrato_encerrado');
```

## Como verificar que ficou resolvido

```sql
-- tem que voltar VAZIO
select c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join information_schema.role_table_grants a
    on a.table_name = c.relname and a.table_schema = 'public'
 where n.nspname = 'public' and c.relkind = 'r'
   and not c.relrowsecurity and a.grantee = 'anon';
```

E, pela aplicação: abrir as telas que usam `planilha_custo` e `grade` com um
usuário **que tem** permissão (tem que continuar vendo) e com um que **não tem**
(tem que deixar de ver). O segundo teste é o que importa.
