-- =====================================================================
-- SIS-2026-0207 — a escrita direta fica FECHADA, e agora está escrito
--
-- CONTEXTO
-- A 20260926000003 e a ...0004 derrubaram as policies de escrita de
-- recebimento e NF, porque a partir delas quem grava são as RPCs
-- SECURITY DEFINER (sup_receb_*, nf_*). O efeito é o pretendido: com RLS
-- ligada e sem policy, `authenticated` não escreve.
--
-- POR QUE ESTA MIGRATION EXISTE
-- "Sem policy" e "policy que nega" produzem o mesmo efeito, mas dizem coisas
-- diferentes para quem lê o schema depois. Ausência de policy parece
-- esquecimento; uma policy `false` com comentário é uma decisão registrada.
--
-- A portaria do CI cobra exatamente isso (R3: policy removida e nunca
-- recriada) — e cobra com razão, porque num módulo com 700+ migrations a
-- diferença entre "fecharam de propósito" e "esqueceram de recriar" não se
-- recupera pelo git.
--
-- O QUE NÃO MUDA
-- As policies de LEITURA continuam como estão: `receb_select` em
-- recebimento_nf, `ocor_select` em recebimento_ocorrencia e `nfe_select` em
-- nf_entrada seguem intactas, e são elas que fazem a tela de Recebimentos e a
-- de NF de Entrada funcionarem.
--
-- A exceção é `receb_item_select`, que fica fechada de propósito: a leitura
-- item a item passou para `sup_receb_itens`, porque é ali que mora a
-- CONFERÊNCIA CEGA — decidir, por usuário, se a quantidade esperada aparece.
-- Isso uma policy não faz. Se a leitura direta continuasse aberta, qualquer um
-- com o menu leria a quantidade prevista e a conferência cega deixaria de
-- existir, que é o motivo deste chamado.
--
-- Idempotente. Nenhum dado é tocado; nenhuma permissão é ampliada.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS receb_insert      ON public.recebimento_nf;
--   DROP POLICY IF EXISTS receb_update      ON public.recebimento_nf;
--   DROP POLICY IF EXISTS receb_item_all    ON public.recebimento_nf_item;
--   DROP POLICY IF EXISTS receb_item_select ON public.recebimento_nf_item;
--   DROP POLICY IF EXISTS ocor_insert       ON public.recebimento_ocorrencia;
--   DROP POLICY IF EXISTS ocor_update       ON public.recebimento_ocorrencia;
--   DROP POLICY IF EXISTS nfe_insert        ON public.nf_entrada;
--   DROP POLICY IF EXISTS nfe_update        ON public.nf_entrada;
-- =====================================================================

-- ── recebimento_nf ───────────────────────────────────────────────────
-- Quem cria: trigger nf_criar_recebimento, a partir da NF.
-- Quem altera: sup_receb_iniciar, sup_receb_conferir, sup_receb_recusar.
DROP POLICY IF EXISTS receb_insert ON public.recebimento_nf;
CREATE POLICY receb_insert ON public.recebimento_nf
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS receb_update ON public.recebimento_nf;
CREATE POLICY receb_update ON public.recebimento_nf
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

-- ── recebimento_nf_item ──────────────────────────────────────────────
-- Escrita: sup_receb_conferir. Leitura: sup_receb_itens (conferência cega).
DROP POLICY IF EXISTS receb_item_all ON public.recebimento_nf_item;
CREATE POLICY receb_item_all ON public.recebimento_nf_item
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS receb_item_select ON public.recebimento_nf_item;
CREATE POLICY receb_item_select ON public.recebimento_nf_item
  FOR SELECT TO authenticated USING (false);

-- ── recebimento_ocorrencia ───────────────────────────────────────────
-- Escrita: sup_receb_tratar_ocorrencia. A LEITURA (ocor_select) continua
-- aberta — a tela de Recebimentos lista as ocorrências direto.
DROP POLICY IF EXISTS ocor_insert ON public.recebimento_ocorrencia;
CREATE POLICY ocor_insert ON public.recebimento_ocorrencia
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS ocor_update ON public.recebimento_ocorrencia;
CREATE POLICY ocor_update ON public.recebimento_ocorrencia
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

-- ── nf_entrada ───────────────────────────────────────────────────────
-- Quem cria: Edge Function nf-import-xml (service role, fora da RLS) e a RPC
-- de lançamento manual. Quem altera: nf_entrada_validar_manual e
-- nf_lancar_estoque. A LEITURA (nfe_select) continua aberta.
DROP POLICY IF EXISTS nfe_insert ON public.nf_entrada;
CREATE POLICY nfe_insert ON public.nf_entrada
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS nfe_update ON public.nf_entrada;
CREATE POLICY nfe_update ON public.nf_entrada
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

-- ── Conferência ──────────────────────────────────────────────────────
-- As oito devem existir, todas negando. E as de leitura devem continuar lá.
SELECT tablename, policyname, cmd, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('recebimento_nf', 'recebimento_nf_item',
                     'recebimento_ocorrencia', 'nf_entrada')
 ORDER BY tablename, policyname;

NOTIFY pgrst, 'reload schema';

-- ── Complemento: as três que faltavam ────────────────────────────────
--
-- Derrubadas nas migrations 0004 e 0006 desta mesma PR, pelo mesmo motivo:
-- escrita passou para RPC. Recriadas aqui para ficarem explícitas.
--
-- `receb_item_write` é o nome VIGENTE da policy de escrita de
-- recebimento_nf_item — a 0003 tentou derrubar `receb_item_all`, que era o
-- nome ANTIGO, renomeado em 20260718100005. A 0006 corrigiu derrubando os
-- dois. Aqui os dois são recriados negando, para não sobrar nome solto.
DROP POLICY IF EXISTS receb_item_write ON public.recebimento_nf_item;
CREATE POLICY receb_item_write ON public.recebimento_nf_item
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- nf_entrada_item: escrita é da Edge Function nf-import-xml (service role,
-- fora da RLS) e das RPCs de vínculo/lançamento. A leitura (nfi_select)
-- continua aberta — a tela de NF de Entrada lista os itens direto.
DROP POLICY IF EXISTS nfi_write ON public.nf_entrada_item;
CREATE POLICY nfi_write ON public.nf_entrada_item
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Apagar NF não é operação de tela: uma nota lançada vira histórico fiscal e
-- de estoque. Cancelamento é mudança de status, não DELETE.
DROP POLICY IF EXISTS nfe_delete ON public.nf_entrada;
CREATE POLICY nfe_delete ON public.nf_entrada
  FOR DELETE TO authenticated USING (false);

NOTIFY pgrst, 'reload schema';
