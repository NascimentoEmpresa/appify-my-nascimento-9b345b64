-- =========================================================================
-- HIERARQUIA DE POSTOS REMOVIDA (17/11/2026)
--
-- PEDIDO (Pablo): "remove o sistema de hierarquia de postos, não tem
-- utilidade, ninguém usou até agora".
--
-- O QUE SAI
--   1. A tela RH › Hierarquia de Postos (/app/rh/hierarquia-postos, menu
--      rh_hierarquia_postos): menu desativado aqui; página, rota e item do
--      menu lateral saíram do código (a rota antiga redireciona para o
--      Organograma Operacional).
--   2. A Hierarquia como fonte do encarregado do contrato. Desde a
--      20261117000100 ela era a reserva de rh_hier_responsaveis() (Ponto do
--      encarregado, Documentos do RH, Efetividade, Treinamento, organograma
--      geral). Agora a fonte é SÓ o Organograma Operacional.
--
-- PARA NINGUÉM FICAR SEM ENCARREGADO AMANHÃ: antes de cortar, o que a
-- Hierarquia aponta hoje é copiado UMA vez para OPE_ORG_CONTRATO, só nos
-- contratos da Licitação (não encerrados) que ainda não têm encarregado no
-- organograma. Contrato com mais de um responsável na Hierarquia fica com
-- quem tem login (e, empatando, o de menor ID). Cada cópia vai para o
-- histórico (OPE_ORG_HIST, motivo "Trazido da Hierarquia de Postos").
-- Filial da Senior que não casa com nenhum contrato da Licitação (nome
-- normalizado ou de-para de Suprimentos) não tem onde entrar e fica sem
-- encarregado — mesmo critério que o Organograma Operacional usa.
--
-- O QUE FICA (de propósito)
--   RH_POSTO_TRABALHO, RH_POSTO_HIERARQUIA, RH_POSTO_OCUPANTE_ERP e as
--   funções rh_hier_ocupacao/rh_hier_descendentes continuam: Efetividade,
--   Turnover, Pesquisa de Permanência, Troca de Função e o organograma geral
--   ("encarregado por posto", mig 20261111120000) leem essas tabelas por
--   funções SECURITY DEFINER. Nada é apagado. Desativar o menu só fecha a
--   leitura DIRETA (policies com rh_hier_pode), que era só da tela removida.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
UPDATE public.app_menu SET ativo = false WHERE codigo = 'rh_hierarquia_postos' AND ativo;

-- ── 2) Cópia única do que a Hierarquia aponta hoje ───────────────────────
WITH cand AS (
  SELECT DISTINCT ON (m.contrato_id) m.contrato_id, r.empregado_id
    FROM public.rh_hier_responsaveis_postos() r
    JOIN public.ope_org_contrato_senior() m ON m.empresa = r.empresa AND m.filial = r.filial
    JOIN public.contratos c ON c.id = m.contrato_id AND COALESCE(c.status, 'ativo') <> 'encerrado'
   ORDER BY m.contrato_id, (r.auth_user_id IS NULL), r.empregado_id
),
novos AS (
  INSERT INTO public."OPE_ORG_CONTRATO" AS o (contrato_id, encarregado_id, alterado_em)
  SELECT cand.contrato_id, cand.empregado_id, now() FROM cand
  ON CONFLICT (contrato_id) DO UPDATE SET encarregado_id = EXCLUDED.encarregado_id, alterado_em = now()
   WHERE o.encarregado_id IS NULL
  RETURNING o.contrato_id, o.encarregado_id
)
INSERT INTO public."OPE_ORG_HIST" (acao, contrato_id, contrato_nome, depois_id, depois_nome, motivo, autor_nome)
SELECT 'encarregado', n.contrato_id, c.nome, n.encarregado_id, public.ope_org_nome(n.encarregado_id),
       'Trazido da Hierarquia de Postos (removida em 17/11/2026)', 'Sistema'
  FROM novos n JOIN public.contratos c ON c.id = n.contrato_id;

-- ── 3) A fonte passa a ser só o organograma ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_hier_responsaveis()
RETURNS TABLE (empresa bigint, filial bigint, posto_lider text, empregado_id bigint, auth_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.empresa, o.filial, o.posto, o.empregado_id, o.auth_user_id
    FROM public.ope_org_encarregados_senior() o
$$;
REVOKE ALL ON FUNCTION public.rh_hier_responsaveis() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ope_org_meus_contratos()
RETURNS TABLE (contrato_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.contrato_id
    FROM public."OPE_ORG_CONTRATO" o
    JOIN public."EMPREGADOS" e ON e."ID" = o.encarregado_id
   WHERE auth.uid() IS NOT NULL AND e.auth_user_id = auth.uid()
     AND COALESCE(e."Situação", '') <> 'Demitido'
$$;
REVOKE ALL ON FUNCTION public.ope_org_meus_contratos() FROM PUBLIC, anon, authenticated;

-- Painel do organograma: sem a coluna da reserva (a tela não mostra mais).
CREATE OR REPLACE FUNCTION public.ope_org_painel()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.ope_org_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Organograma Operacional.' USING ERRCODE = '42501';
  END IF;

  WITH
  lic AS MATERIALIZED (
    SELECT c.id, c.nome, COALESCE(c.status, 'ativo') AS status, o.encarregado_id, o.supervisor_id
      FROM public.contratos c
      LEFT JOIN public."OPE_ORG_CONTRATO" o ON o.contrato_id = c.id
     WHERE NULLIF(btrim(c.nome), '') IS NOT NULL
       AND (COALESCE(c.status, 'ativo') <> 'encerrado' OR o.contrato_id IS NOT NULL)
  ),
  qtd AS MATERIALIZED (
    SELECT a.contrato_id, count(*)::int AS n FROM public.rh_ac_ativos() a
     WHERE a.contrato_id IS NOT NULL GROUP BY a.contrato_id
  ),
  ids AS (
    SELECT encarregado_id AS id FROM lic WHERE encarregado_id IS NOT NULL
    UNION SELECT supervisor_id FROM lic WHERE supervisor_id IS NOT NULL
    UNION SELECT empregado_id FROM public."OPE_ORG_PESSOA"
  )
  SELECT jsonb_build_object(
    'contratos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'nome', l.nome, 'status', l.status,
               'encarregado_id', l.encarregado_id, 'supervisor_id', l.supervisor_id,
               'colaboradores', COALESCE(q.n, 0)) ORDER BY l.nome)
        FROM lic l LEFT JOIN qtd q ON q.contrato_id = l.id), '[]'::jsonb),
    'pessoas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e."ID", 'nome', e."Nome", 'cargo', e."Título do Cargo", 'situacao', e."Situação",
               'avatar_url', pr.avatar_url, 'tem_login', e.auth_user_id IS NOT NULL))
        FROM public."EMPREGADOS" e
        LEFT JOIN public.profiles pr ON pr.id = e.auth_user_id
       WHERE e."ID" IN (SELECT id FROM ids)), '[]'::jsonb),
    'papeis', COALESCE((SELECT jsonb_agg(jsonb_build_object('empregado_id', x.empregado_id, 'papel', x.papel))
                          FROM public."OPE_ORG_PESSOA" x), '[]'::jsonb),
    'historico', COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC)
                             FROM (SELECT * FROM public."OPE_ORG_HIST" ORDER BY created_at DESC LIMIT 200) h), '[]'::jsonb),
    'pode_alterar', public.ope_org_pode('alterar'))
  INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_painel() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public.app_menu SET ativo = true WHERE codigo = 'rh_hierarquia_postos';
-- Reaplicar rh_hier_responsaveis, ope_org_meus_contratos e ope_org_painel da
-- 20261117000100 (volta a reserva da Hierarquia). As cópias do passo 2 ficam
-- no organograma; para desfazê-las:
-- DELETE FROM public."OPE_ORG_CONTRATO" o USING public."OPE_ORG_HIST" h
--  WHERE h.contrato_id = o.contrato_id AND h.motivo LIKE 'Trazido da Hierarquia de Postos%'
--    AND o.encarregado_id = h.depois_id AND o.supervisor_id IS NULL;
-- NOTIFY pgrst, 'reload schema';
