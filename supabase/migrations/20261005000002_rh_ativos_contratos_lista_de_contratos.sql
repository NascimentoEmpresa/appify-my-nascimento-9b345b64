-- =========================================================================
-- RH › ATIVOS/CONTRATOS — seletor "Ligar ao contrato" com TODOS os contratos
--
-- PEDIDO (05/10/2026, Pablo): "por que não tá aparecendo esses
-- ADMINISTRATIVO - pra vincular??". O seletor das filiais sem contrato usava
-- a lista do painel, que só traz contrato com posto na planilha ou com gente
-- ativa ligada. "ADMINISTRATIVO - NH/SN/HAGG" ainda não têm nenhum dos dois —
-- e são exatamente o destino das filiais "ADM E ESTAGIARIOS - NH/SN/HAGG".
--
-- rh_ac_painel passa a devolver também 'todos_contratos' (id, nome,
-- cliente) de todo contrato não encerrado. Resto igual à mig 20261005000001.
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

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
                WHEN pvo.posto IS NOT NULL THEN pvo.posto
                WHEN l.ignorar THEN NULL
                ELSE l.planilha_posto END AS posto,
           (oc.planilha_posto = '' OR (pvo.posto IS NULL AND COALESCE(l.ignorar, false))) IS TRUE AS fora,
           CASE WHEN oc.planilha_posto = '' OR pvo.posto IS NOT NULL THEN 'pessoa'
                WHEN l.ignorar OR l.planilha_posto IS NOT NULL THEN 'posto' END AS origem
      FROM pessoas p
      LEFT JOIN public."RH_POSTO_COLABORADOR" oc
             ON oc.empresa = p.empresa AND oc.cadastro::text = p.cadastro
            AND oc.contrato_id = p.contrato_id
      LEFT JOIN pv pvo
             ON pvo.contrato_id = p.contrato_id AND oc.planilha_posto <> ''
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

-- ROLLBACK: reaplicar a seção 4 da mig 20261005000001 (sem 'todos_contratos').
