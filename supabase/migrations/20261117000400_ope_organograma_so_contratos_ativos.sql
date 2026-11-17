-- =========================================================================
-- ORGANOGRAMA OPERACIONAL: só os contratos ATIVOS da Licitação (17/11/2026)
--
-- RELATO (Pablo, com print da caixa "Sem supervisor" mostrando 90
-- contratos — INVESTIMENTOS AGPS/HAGG/NH/SN, MOVIMENTAÇÃO FINANCEIRA - …,
-- HEMOPEL LIMPEZA duas vezes): "aqui tem que aparecer apenas os contratos
-- ativos da licitação, puxar os corretos".
--
-- DE ONDE VINHA (mig 20261117000100): todo public.contratos que não estava
-- 'encerrado' — entravam os suspensos e os "contratos" contábeis que existem
-- só como centro de custo.
--
-- O QUE MUDA: a tela e a lista do cadastro de login mostram só contrato
--   1. com status 'ativo' na Licitação (Licitações › Contratos), e
--   2. que é contrato de verdade — a mesma régua da Controladoria
--      (tv_ctl_fora_das_despesas, mig 20261113005100): fora MOVIMENTAÇÃO
--      FINANCEIRA, ESTOQUE, INVESTIMENTO, OBRAS ADM e ADMINISTRATIVO, ou o que
--      estiver marcado assim em Tratamento dos contratos.
-- Cada contrato passa a vir com o código da empresa, para distinguir nomes
-- repetidos (o mesmo cliente em duas empresas do grupo).
--
-- Encarregado já gravado num contrato que saiu da lista continua valendo
-- para o Ponto (rh_hier_responsaveis não muda) — só não aparece na tela.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.ope_org_contrato_valido(p_id uuid, p_nome text, p_status text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(p_status, 'ativo') = 'ativo'
     AND NULLIF(btrim(p_nome), '') IS NOT NULL
     AND NOT public.tv_ctl_fora_das_despesas(p_id, p_nome)
$$;
REVOKE ALL ON FUNCTION public.ope_org_contrato_valido(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ope_org_painel()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.ope_org_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Organograma Operacional.' USING ERRCODE = '42501';
  END IF;

  WITH
  lic AS MATERIALIZED (
    SELECT c.id, c.nome, COALESCE(c.status, 'ativo') AS status, em.codigo AS empresa,
           o.encarregado_id, o.supervisor_id
      FROM public.contratos c
      LEFT JOIN public.empresas em ON em.id = c.empresa_id
      LEFT JOIN public."OPE_ORG_CONTRATO" o ON o.contrato_id = c.id
     WHERE public.ope_org_contrato_valido(c.id, c.nome, c.status)
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
               'id', l.id, 'nome', l.nome, 'status', l.status, 'empresa', l.empresa,
               'encarregado_id', l.encarregado_id, 'supervisor_id', l.supervisor_id,
               'colaboradores', COALESCE(q.n, 0)) ORDER BY l.nome, l.empresa)
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

CREATE OR REPLACE FUNCTION public.ope_org_contratos_opcoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.ope_org_pode('visualizar') OR public.login_pode_criar(auth.uid()) IS NOT NULL) THEN
    RAISE EXCEPTION 'Sem acesso.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', c.id,
                                        'nome', c.nome || COALESCE(' · ' || em.codigo, ''),
                                        'encarregado_id', o.encarregado_id, 'encarregado_nome', public.ope_org_nome(o.encarregado_id))
                     ORDER BY c.nome, em.codigo)
      FROM public.contratos c
      LEFT JOIN public.empresas em ON em.id = c.empresa_id
      LEFT JOIN public."OPE_ORG_CONTRATO" o ON o.contrato_id = c.id
     WHERE public.ope_org_contrato_valido(c.id, c.nome, c.status)), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_contratos_opcoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_contratos_opcoes() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar ope_org_painel da 20261117000300 e ope_org_contratos_opcoes da
-- 20261117000100. Depois:
-- DROP FUNCTION IF EXISTS public.ope_org_contrato_valido(uuid, text, text);
-- NOTIFY pgrst, 'reload schema';
