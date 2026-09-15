-- =========================================================================
-- Central de Serviços › SOLICITAÇÕES — as telas do encarregado, na Central
--
-- Pedido do Pablo em 15/09/2026: "colocar os módulos que hoje estão nos
-- encarregados também na Central de Serviços, num submódulo Solicitações:
-- solicitar vaga, férias, demissão, advertência, mudança de função —
-- duplicar os sistemas pra lá em outra rota".
--
-- UM menu só, `central_servicos_solicitacoes`, com rota
-- /app/central-servicos/solicitacoes. As subrotas (/vaga, /ferias,
-- /advertencia, /demissao, /mudanca-funcao) caem nele por prefixo — é o
-- mesmo desenho do módulo Encarregados, onde /solicitar-vaga e /solicitar-
-- ferias são governadas pelo menu raiz. Liberou o menu, aparecem todas as
-- opções; a tela é a MESMA do encarregado (componente reaproveitado).
--
-- O que mais precisa saber do código novo (senão a tela abre e nada funciona):
--   • policies que citam encarregados_minhas_solicitacoes ganham o OR:
--     CONTRATOS (ler contrato do colaborador), EMPREGADOS (buscar
--     colaborador), SISTEMA_RECRUTAMENTO (abrir/ver/editar vaga),
--     RECRUTAMENTO_HISTORICO (histórico da vaga);
--   • rh_pode_ver_colaboradores() e rec_custo_do_posto() idem;
--   • sup_cat_postos_do_contrato(): a 20260930000096 (Suprimentos) foi
--     aplicada DEPOIS da 102 e voltou o gate pra só 'sup_catalogo' — a
--     lista de postos em Solicitar Demissão ficou vazia de novo pro
--     encarregado. Aqui a função é recriada com o corpo da 096 (sincroniza
--     da planilha) e o gate largo. Se a 096 for reaplicada, esta tem que
--     vir depois.
--
-- Férias, demissão, mudança de função e advertência não precisam de nada:
-- as tabelas são abertas a authenticated (ou checam o solicitante).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'central_servicos_solicitacoes', 'Solicitações', '/app/central-servicos/solicitacoes', 25, true
  FROM public.app_modulo m
 WHERE m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES
  ('central_servicos_solicitacoes', 'visualizar'::app_acao),
  ('central_servicos_solicitacoes', 'incluir'::app_acao),
  ('central_servicos_solicitacoes', 'alterar'::app_acao),
  ('central_servicos_solicitacoes', 'excluir'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── 2) Policies que precisam reconhecer o código ─────────────────────────
-- Texto = o que está no banco em 15/09/2026 + o OR novo.

DROP POLICY IF EXISTS contratos_gate ON public."CONTRATOS";
CREATE POLICY contratos_gate ON public."CONTRATOS" FOR SELECT TO authenticated
USING (
  public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'colaboradores', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'advertencias', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
);

DROP POLICY IF EXISTS erp_auth_read_empregados ON public."EMPREGADOS";
CREATE POLICY erp_auth_read_empregados ON public."EMPREGADOS" FOR SELECT TO authenticated
USING (
  auth_user_id = auth.uid()
  OR public.has_screen_access(auth.uid(), 'colaboradores', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'duvidas', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_formularios', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
);

DROP POLICY IF EXISTS recrutamento_historico_insert ON public."RECRUTAMENTO_HISTORICO";
CREATE POLICY recrutamento_historico_insert ON public."RECRUTAMENTO_HISTORICO" FOR INSERT TO authenticated
WITH CHECK (
  public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir'::app_acao)
  OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'sst_aso', 'incluir'::app_acao)
  OR public.has_screen_access(auth.uid(), 'candidatos', 'incluir'::app_acao)
  OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'incluir'::app_acao)
  OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'alterar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'incluir'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'alterar'::app_acao)
);

DROP POLICY IF EXISTS sistema_recrutamento_insert ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_insert ON public."SISTEMA_RECRUTAMENTO" FOR INSERT TO authenticated
WITH CHECK (
  (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir'::app_acao)
   OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'incluir'::app_acao)
   OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'alterar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'incluir'::app_acao)
   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'alterar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'incluir'::app_acao)
   OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar'::app_acao))
  AND ((NOT administrativa) OR public.has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
);

DROP POLICY IF EXISTS sistema_recrutamento_select ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_select ON public."SISTEMA_RECRUTAMENTO" FOR SELECT TO authenticated
USING (
  (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao))
  AND ((NOT administrativa) OR public.has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
);

DROP POLICY IF EXISTS sistema_recrutamento_update ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_update ON public."SISTEMA_RECRUTAMENTO" FOR UPDATE TO authenticated
USING (
  (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao))
  AND ((NOT administrativa) OR public.has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
)
WITH CHECK (
  (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir'::app_acao)
   OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'incluir'::app_acao)
   OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'alterar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'incluir'::app_acao)
   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'alterar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'incluir'::app_acao)
   OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar'::app_acao)
   OR public.has_screen_access(auth.uid(), 'recrutamento_solicitacao_editar', 'alterar'::app_acao))
  AND ((NOT administrativa) OR public.has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
);

-- ── 3) Funções ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_pode_ver_colaboradores()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.has_screen_access(auth.uid(), 'colaboradores', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'sst_aso', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'candidatos', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'processos', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'duvidas', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'central_servicos_formularios', 'visualizar');
$fn$;

-- rec_custo_do_posto: só o gate muda (corpo da 20260930000109).
CREATE OR REPLACE FUNCTION public.rec_custo_do_posto(
  p_contrato text,
  p_cargo    text DEFAULT NULL,
  p_salario  numeric DEFAULT NULL,
  p_cidade   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_contrato text := public.rec_norm_txt(regexp_replace(coalesce(p_contrato, ''), '^\s*\d+\s*-\s*', ''));
  v_cargo    text := public.rec_norm_txt(p_cargo);
  v_cidade   text := public.rec_norm_txt(p_cidade);
  v_tokens   text[];
  melhor     record;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF v_contrato = '' THEN RETURN NULL; END IF;

  v_cargo := replace(replace(v_cargo, 'AUXILIAR DE SERVICOS GERAIS', 'ASG'), 'AUX SERVICOS GERAIS', 'ASG');
  v_tokens := ARRAY(SELECT t FROM unnest(string_to_array(v_cargo, ' ')) t WHERE length(t) >= 3 AND t NOT IN ('DOS','DAS','DE','DA','DO'));

  WITH base AS (
    SELECT pc.*, public.rec_norm_txt(pc.posto) AS posto_n
      FROM public.planilha_custo pc
     WHERE coalesce(pc.encerrado, false) = false
       AND public.rec_norm_txt(pc.contrato) = v_contrato
  ), pontos AS (
    SELECT b.*,
           (CASE WHEN p_salario IS NOT NULL AND abs(coalesce(b.salario, 0) - p_salario) < 0.01 THEN 100 ELSE 0 END)
         + (CASE WHEN v_cidade <> '' AND b.posto_n LIKE '%' || v_cidade || '%' THEN 20 ELSE 0 END)
         + 5 * (SELECT count(*) FROM unnest(v_tokens) t WHERE b.posto_n LIKE '%' || t || '%')::int AS score
      FROM base b
  ), topo AS (
    SELECT * FROM pontos WHERE score = (SELECT max(score) FROM pontos)
  )
  SELECT t.posto, t.servico, t.salario, t.insalubridade, t.periculosidade, t.transporte, t.transporte_desconto,
         t.aux_alimentacao, t.aux_alimentacao_desconto, t.aux_refeicao, t.cesta_basica, t.assistencia_medica,
         t.data_vigencia, t.score,
         (SELECT count(*) FROM pontos) AS total,
         (SELECT count(DISTINCT (x.insalubridade, x.transporte, x.aux_alimentacao)) FROM topo x) AS variantes_no_topo
    INTO melhor
    FROM topo t
   ORDER BY t.data_vigencia DESC NULLS LAST, t.salario DESC
   LIMIT 1;

  IF melhor.posto IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'posto',              melhor.posto,
    'servico',            melhor.servico,
    'salario',            melhor.salario,
    'insalubridade',      melhor.insalubridade,
    'periculosidade',     melhor.periculosidade,
    'vt',                 melhor.transporte,
    'vt_desconto',        melhor.transporte_desconto,
    'va',                 melhor.aux_alimentacao,
    'va_desconto',        melhor.aux_alimentacao_desconto,
    'vr',                 melhor.aux_refeicao,
    'cesta_basica',       melhor.cesta_basica,
    'assistencia_medica', melhor.assistencia_medica,
    'vigencia',           melhor.data_vigencia,
    'score',              melhor.score,
    'candidatos',         melhor.total,
    'ambiguo',            coalesce(melhor.variantes_no_topo, 1) > 1,
    'casou_salario',      melhor.score >= 100
  );
END $fn$;

-- sup_cat_postos_do_contrato: corpo da 20260930000096 (sincroniza da
-- planilha) + o gate largo da 102, que a 096 tinha desfeito.
CREATE OR REPLACE FUNCTION public.sup_cat_postos_do_contrato(p_contrato_id uuid)
RETURNS TABLE (
  id          uuid,
  contrato_id uuid,
  nome        text,
  ativo       boolean,
  aprovado    boolean,
  na_planilha boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  v_norm text[];
BEGIN
  IF NOT (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
          OR public.can_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar')
          OR public.can_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar')
          OR public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
          OR public.can_access(auth.uid(), 'encarregados_solicitar_demissao', 'visualizar')
          OR public.can_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão para o Catálogo de Materiais.';
  END IF;

  v_norm := public.sup_posto_sincronizar_planilha(p_contrato_id, true);
  IF v_norm IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT sp.id, sp.contrato_id, sp.nome, sp.ativo, sp.aprovado,
         (public.sup_norm_nome(sp.nome) = ANY (v_norm)) AS na_planilha
    FROM public.sup_posto sp
   WHERE sp.contrato_id = p_contrato_id
     AND sp.ativo
   ORDER BY sp.nome;
END $fn$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Recriar as seis policies e rh_pode_ver_colaboradores sem o OR de
-- 'central_servicos_solicitacoes' (texto na 20260930000049 / 20260930000077 /
-- 20260906000007), rec_custo_do_posto da 20260930000109 e
-- sup_cat_postos_do_contrato da 20260930000096;
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'central_servicos_solicitacoes';
-- DELETE FROM public.app_menu WHERE codigo = 'central_servicos_solicitacoes';
-- NOTIFY pgrst, 'reload schema';
