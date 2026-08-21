-- =========================================================================
-- Recrutamento: vaga ADMINISTRATIVA só para quem tem a capacidade
--
-- Pedido do Pablo (20/08/2026): as vagas do escritório são geridas só pela
-- diretora. Quem não tiver "Ver vaga administrativa?" não pode nem VER a
-- vaga — logo não aprova, não reprova e não mexe nos candidatos dela.
--
-- A capacidade é um menu em `app_menu` com rota NULL, do mesmo jeito que
-- `recrutamento_etapa_juridico` e `whatsapp_pasta_rh`: aparece sozinha em
-- Administração › Acesso por Usuário, sem tocar em ModulosMenusTab.tsx.
-- Nenhuma tabela nova de permissão.
--
-- O MESMO código entra em DOIS módulos (Recrutamento e Operacional) porque
-- os dois têm gente que decide sobre a vaga, e o Pablo pediu o botão nos
-- dois lugares. Como a permissão é gravada por `menu_codigo` (e não por
-- módulo), as duas entradas ligam e desligam a MESMA capacidade — é uma
-- porta com duas maçanetas, não duas portas.
-- =========================================================================

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS administrativa boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".administrativa IS
  'Vaga do escritório. Só é visível para quem tem a capacidade recrutamento_vaga_administrativa — a RLS abaixo é quem garante.';

-- Índice parcial: a esmagadora maioria é false, e quem filtra são as telas
-- que listam as administrativas.
CREATE INDEX IF NOT EXISTS sistema_recrutamento_administrativa_idx
  ON public."SISTEMA_RECRUTAMENTO" (administrativa) WHERE administrativa;

-- ── A capacidade, nos dois módulos ───────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'recrutamento_vaga_administrativa', 'Ver vaga administrativa?', NULL, 25, true
  FROM public.app_modulo m
 WHERE m.codigo IN ('recrutamento', 'operacional')
   AND NOT EXISTS (
     SELECT 1 FROM public.app_menu x
      WHERE x.modulo_id = m.id AND x.codigo = 'recrutamento_vaga_administrativa');

-- ── RLS ──────────────────────────────────────────────────────────────────
-- As duas policies existentes são FOR ALL e são OR entre si: basta uma
-- passar. Então a trava da administrativa tem que entrar nas DUAS, senão
-- quem entra pela outra porta continua vendo tudo.
--
-- A condição vale para SELECT e também para UPDATE/DELETE (é o `USING` de
-- uma policy FOR ALL): não aprovar nem reprovar o que não se pode ver não é
-- efeito colateral, é o pedido.
--
-- R3: cada DROP abaixo tem o CREATE correspondente logo em seguida.
DROP POLICY IF EXISTS sistema_recrutamento_gate ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_gate ON public."SISTEMA_RECRUTAMENTO"
  FOR ALL TO authenticated
  USING (
    (has_screen_access(auth.uid(), 'recrutamento_gestao'::text, 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes'::text, 'visualizar'::app_acao))
    AND (NOT administrativa
      OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa'::text, 'visualizar'::app_acao))
  )
  WITH CHECK (
    (has_screen_access(auth.uid(), 'recrutamento_gestao'::text, 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'recrutamento_gestao'::text, 'alterar'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes'::text, 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes'::text, 'alterar'::app_acao))
    -- Marcar uma vaga como administrativa é decisão de quem pode vê-las:
    -- sem isto, qualquer um criaria uma vaga e ela sumiria da própria vista.
    AND (NOT administrativa
      OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa'::text, 'visualizar'::app_acao))
  );

DROP POLICY IF EXISTS sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO"
  FOR ALL TO authenticated
  USING (
    has_screen_access(auth.uid(), 'operacional_recrutamento'::text, 'visualizar'::app_acao)
    AND (NOT administrativa
      OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa'::text, 'visualizar'::app_acao))
  )
  WITH CHECK (
    (has_screen_access(auth.uid(), 'operacional_recrutamento'::text, 'alterar'::app_acao)
      OR has_screen_access(auth.uid(), 'operacional_recrutamento'::text, 'aprovar'::app_acao))
    AND (NOT administrativa
      OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa'::text, 'visualizar'::app_acao))
  );

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Recriar as duas policies sem o trecho "AND (NOT administrativa OR ...)"
--   (versão em 20260903000001 / migrations anteriores);
--   DELETE FROM public.app_menu WHERE codigo = 'recrutamento_vaga_administrativa';
--   DROP INDEX public.sistema_recrutamento_administrativa_idx;
--   ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN administrativa;
-- =========================================================================
