-- =====================================================================
-- RH › Ativos/Contratos — posto RENDA TÉCNICA (RT) em TODO contrato
-- (20/10/2026).
--
-- Pedido do Pablo: "alguns postos têm colaboradores que são contratados só
-- como renda técnica. Todos os contratos vão ter esse RT" — ao abrir o
-- contrato, depois do último posto (ex.: BENTO, embaixo de COPEIRO), a linha
-- RENDA TÉCNICA com quem é RT; e "mover qualquer um pra RT".
--
-- RT não é posto da Planilha de Custo (não tem vaga): é um destino a mais do
-- "mover pessoa" que vale em qualquer contrato. Fica na mesma
-- RH_POSTO_COLABORADOR, com planilha_posto = 'RENDA TÉCNICA'. A tela mostra
-- a linha em todo contrato e NÃO soma RT no previsto/tem/saldo — quem é RT
-- não ocupa vaga de posto.
--
--   1. rh_ac_mover_colaborador: aceita 'RENDA TÉCNICA' sem exigir o posto na
--      planilha (o resto igual à mig 20261005000001).
--   2. rh_ac_painel: a pessoa movida para RT sai com posto 'RENDA TÉCNICA'
--      (antes o LEFT JOIN na planilha não achava o posto e ela caía em "sem
--      posto"). Resto igual à mig 20261005000002.
--
-- Comparação sempre por sup_norm_nome: 'RENDA TECNICA', 'Renda técnica' e
-- 'RENDA TÉCNICA' são o mesmo ('RENDATECNICA').
-- =====================================================================

-- ── 1. Mover: RT vale em qualquer contrato ───────────────────────────
CREATE OR REPLACE FUNCTION public.rh_ac_mover_colaborador(p_empregado_id bigint, p_planilha_posto text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := public.rh_ac_exige(true);
  v_emp  bigint;
  v_cad  bigint;
  v_ct   uuid;
  v_pp   text := btrim(p_planilha_posto);
BEGIN
  SELECT a.empresa, a.cadastro::bigint, a.contrato_id INTO v_emp, v_cad, v_ct
    FROM public.rh_ac_ativos() a WHERE a.empregado_id = p_empregado_id;
  IF v_emp IS NULL OR v_cad IS NULL THEN
    RAISE EXCEPTION 'Colaborador ativo não encontrado.';
  END IF;
  IF v_ct IS NULL THEN
    RAISE EXCEPTION 'O colaborador não está ligado a nenhum contrato.';
  END IF;

  IF p_planilha_posto IS NULL THEN
    DELETE FROM public."RH_POSTO_COLABORADOR" WHERE empresa = v_emp AND cadastro = v_cad;
    RETURN;
  END IF;

  -- RENDA TÉCNICA: grava sempre com o mesmo nome, exista ou não na planilha.
  IF v_pp <> '' AND public.sup_norm_nome(v_pp) = 'RENDATECNICA' THEN
    v_pp := 'RENDA TÉCNICA';
  ELSIF v_pp <> '' AND NOT EXISTS (
       SELECT 1 FROM public.planilha_custo pc
        WHERE pc.contrato_id = v_ct
          AND public.sup_norm_nome(pc.posto) = public.sup_norm_nome(v_pp)) THEN
    RAISE EXCEPTION 'O posto "%" não existe na planilha deste contrato.', v_pp;
  END IF;

  INSERT INTO public."RH_POSTO_COLABORADOR" (empresa, cadastro, contrato_id, planilha_posto, atualizado_por)
  VALUES (v_emp, v_cad, v_ct, v_pp, v_uid)
  ON CONFLICT (empresa, cadastro) DO UPDATE
     SET contrato_id = EXCLUDED.contrato_id, planilha_posto = EXCLUDED.planilha_posto,
         atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now();
END $$;
REVOKE ALL ON FUNCTION public.rh_ac_mover_colaborador(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_ac_mover_colaborador(bigint, text) TO authenticated;

-- ── 2. Painel: quem é RT sai no posto RENDA TÉCNICA ───────────────────
CREATE OR REPLACE FUNCTION public.rh_ac_painel()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.rh_ac_exige();

  WITH pessoas AS MATERIALIZED (SELECT * FROM public.rh_ac_ativos()),
  pv AS MATERIALIZED (
    SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto))
           pc.contrato_id, btrim(pc.posto) AS posto, public.sup_norm_nome(pc.posto) AS pn,
           COALESCE(pc.qt_postos, 0) AS vagas
      FROM public.planilha_custo pc
     WHERE pc.contrato_id IS NOT NULL
       AND pc.orexec = 'EXECUTADO'
       AND NOT COALESCE(pc.encerrado, false)
       AND pc.data_vigencia IS NOT NULL
       AND pc.data_vigencia <= current_date
       AND COALESCE(btrim(pc.posto), '') <> ''
     ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), pc.data_vigencia DESC
  ),
  -- Posto da Senior → UM posto da planilha (ou fora da conta).
  lig AS MATERIALIZED (
    SELECT DISTINCT ON (d.contrato_id, d.posto_senior)
           d.contrato_id, d.posto_senior, d.ignorar, pv.posto AS planilha_posto
      FROM public."RH_POSTO_DEPARA" d
      LEFT JOIN pv ON pv.contrato_id = d.contrato_id
                  AND pv.pn = public.sup_norm_nome(d.planilha_posto)
     WHERE d.ignorar OR pv.posto IS NOT NULL
     ORDER BY d.contrato_id, d.posto_senior, d.ignorar DESC, pv.posto
  ),
  pes AS MATERIALIZED (
    SELECT p.*,
           CASE WHEN oc.planilha_posto = '' THEN NULL
                WHEN oc.rt THEN 'RENDA TÉCNICA'
                WHEN pvo.posto IS NOT NULL THEN pvo.posto
                WHEN l.ignorar THEN NULL
                ELSE l.planilha_posto END AS posto,
           (oc.planilha_posto = '' OR (NOT COALESCE(oc.rt, false) AND pvo.posto IS NULL AND COALESCE(l.ignorar, false))) IS TRUE AS fora,
           CASE WHEN oc.planilha_posto = '' OR oc.rt OR pvo.posto IS NOT NULL THEN 'pessoa'
                WHEN l.ignorar OR l.planilha_posto IS NOT NULL THEN 'posto' END AS origem
      FROM pessoas p
      LEFT JOIN LATERAL (
        SELECT x.planilha_posto, public.sup_norm_nome(x.planilha_posto) = 'RENDATECNICA' AS rt
          FROM public."RH_POSTO_COLABORADOR" x
         WHERE x.empresa = p.empresa AND x.cadastro::text = p.cadastro
           AND x.contrato_id = p.contrato_id
      ) oc ON true
      LEFT JOIN pv pvo
             ON pvo.contrato_id = p.contrato_id AND oc.planilha_posto <> '' AND NOT oc.rt
            AND pvo.pn = public.sup_norm_nome(oc.planilha_posto)
      LEFT JOIN lig l
             ON l.contrato_id = p.contrato_id AND l.posto_senior = p.posto_senior
     WHERE p.contrato_id IS NOT NULL
  ),
  cids AS (
    SELECT contrato_id FROM pv
    UNION
    SELECT contrato_id FROM pes
  ),
  nos AS (
    SELECT c.nome AS ordem, jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'cliente', c.cliente,
      'encerrado', COALESCE(c.status, 'ativo') = 'encerrado',
      'postos', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', pv.posto, 'vagas', pv.vagas) ORDER BY pv.posto)
           FROM pv WHERE pv.contrato_id = c.id), '[]'::jsonb),
      'pessoas', COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'id', p.empregado_id, 'cadastro', p.cadastro, 'nome', p.nome, 'cargo', p.cargo,
                  'situacao', p.situacao, 'conta', public.rh_ac_conta_no_posto(p.situacao),
                  'posto_senior', p.posto_senior, 'posto', p.posto, 'fora', p.fora, 'origem', p.origem)
                  ORDER BY p.nome)
           FROM pes p WHERE p.contrato_id = c.id), '[]'::jsonb)
    ) AS no
      FROM cids JOIN public.contratos c ON c.id = cids.contrato_id
     WHERE COALESCE(c.status, 'ativo') <> 'encerrado'
        OR EXISTS (SELECT 1 FROM pes WHERE pes.contrato_id = c.id)
  )
  SELECT jsonb_build_object(
    'gerado_em', now(),
    'total_ativos', (SELECT count(*) FROM pessoas),
    'com_contrato', (SELECT count(*) FROM pessoas WHERE contrato_id IS NOT NULL),
    'contratos', COALESCE((SELECT jsonb_agg(no ORDER BY ordem) FROM nos), '[]'::jsonb),
    'todos_contratos', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'cliente', c.cliente) ORDER BY c.nome)
         FROM public.contratos c WHERE COALESCE(c.status, 'ativo') <> 'encerrado'), '[]'::jsonb),
    'filiais_sem_contrato', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('filial', f.filial, 'qtd', f.qtd) ORDER BY f.qtd DESC)
         FROM (SELECT COALESCE(filial, '(sem filial)') AS filial, count(*)::int AS qtd
                 FROM pessoas WHERE contrato_id IS NULL GROUP BY 1) f), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.rh_ac_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_ac_painel() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar rh_ac_mover_colaborador da mig 20261005000001 e rh_ac_painel da
-- mig 20261005000002. Quem já foi movido para RT volta a cair em "sem
-- posto" (a linha em RH_POSTO_COLABORADOR fica; apagar com
--   DELETE FROM public."RH_POSTO_COLABORADOR" WHERE public.sup_norm_nome(planilha_posto) = 'RENDATECNICA';).
