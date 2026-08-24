-- =========================================================================
-- FORMULÁRIOS — "Botão de acessos de cada formulário" (menu de capacidade)
--
-- O botão "Acesso" de cada card passa a ser o lugar onde se gerencia POR
-- COMPLETO o acesso de cada pessoa àquele formulário — inclusive o recorte de
-- leitura criado em 20260921000002. Faltava dizer QUEM pode abrir esse botão
-- sem depender de já ser dono do formulário.
--
-- É um MENU DE CAPACIDADE: uma linha em app_menu com `rota = NULL`, no módulo
-- Central de Serviços. Aparece sozinho em Administração › Acesso por Usuário
-- (a aba lista app_menu) como mais um switch — é o padrão já usado por
-- `novidades_publicar`, `chamados_sistemas_aprovar` e outros ~25. Nenhuma
-- tabela nova de permissão.
--
-- O toggle daquele painel grava visualizar+incluir+alterar+aprovar+exportar de
-- uma vez (nunca `excluir`), por isso a checagem aqui cobra `incluir`.
--
-- É ADITIVO: quem já abre o botão hoje (dono/gerente do formulário, quem tem
-- 'ver_tudo', ou quem administra formulários num formulário ainda sem lista)
-- continua abrindo. O flag só acrescenta quem mais pode.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 1) O menu de capacidade ──────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'formularios_acesso_botao', 'Botão de acessos de cada formulário', NULL, 90, true
  FROM public.app_modulo m
 WHERE m.codigo = 'central_servicos'
   AND NOT EXISTS (
     SELECT 1 FROM public.app_menu x
      WHERE x.modulo_id = m.id AND x.codigo = 'formularios_acesso_botao');

-- ── 2) O helper ──────────────────────────────────────────────────────────
-- Envelopado numa função própria para a policy não repetir a string do menu
-- em quatro lugares — e para o dia em que a regra mudar ter UM lugar só.
CREATE OR REPLACE FUNCTION public.cs_form_gerente_de_acesso()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access(auth.uid(), 'formularios_acesso_botao', 'incluir'::public.app_acao);
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_gerente_de_acesso() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_gerente_de_acesso() TO authenticated;

-- ── 3) Entra no 'acesso' de qualquer formulário ──────────────────────────
-- Mesma função de 20260921000002, com o ramo do flag somado ao 'acesso'. As
-- policies de escrita de CS_FORM_ACESSOS já chamam cs_form_pode(_,'acesso'),
-- então nada mais precisa mudar para o flag valer.
CREATE OR REPLACE FUNCTION public.cs_form_pode(_form uuid, _cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _form IS NULL THEN false
    WHEN _cap = 'ver'    AND public.cs_form_cap_ver(_form, 'ver_tudo') THEN true
    WHEN _cap = 'acesso' AND (public.cs_form_cap('ver_tudo') OR public.cs_form_gerente_de_acesso()) THEN true
    ELSE coalesce(
      CASE _cap
        WHEN 'ver'     THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar','form_editar','form_ver')
        WHEN 'editar'  THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar','form_editar')
        WHEN 'excluir' THEN public.cs_form_papel_no_form(_form) =  'form_dono'
        WHEN 'acesso'  THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar')
                         OR (NOT public.cs_form_tem_lista(_form)
                             AND (public.cs_form_cap('editar_criar') OR public.cs_form_cap('encerrar_excluir')))
        ELSE false
      END, false)
  END;
$$;

-- ── 4) Conferência ───────────────────────────────────────────────────────
SELECT x.codigo, x.nome, x.ativo
  FROM public.app_menu x JOIN public.app_modulo m ON m.id = x.modulo_id
 WHERE m.codigo = 'central_servicos' AND x.codigo = 'formularios_acesso_botao';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu x USING public.app_modulo m
--    WHERE x.modulo_id = m.id AND m.codigo = 'central_servicos'
--      AND x.codigo = 'formularios_acesso_botao';
--   DROP FUNCTION IF EXISTS public.cs_form_gerente_de_acesso();
--   (e recriar cs_form_pode como está em 20260921000002)
-- =========================================================================
