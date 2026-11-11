-- =========================================================================
-- SIS-2026-0770 (continuação, 11/11/2026) — ENCARREGADO POR POSTO
--
-- Helena (10/11, 16:44): "precisamos conseguir vincular os postos de um
-- contrato aos encarregados disponíveis nesse contrato. Ou seja, vínculo de
-- encarregado por contrato e por posto que fiscaliza e é responsável."
--
-- Até aqui (mig 20261110230000) o vínculo era pessoa a pessoa, e o sistema só
-- deduzia o encarregado pelo posto quando a Hierarquia de Postos apontava UM
-- líder. Com 2 ou 3 encarregados no contrato ninguém sabia quem cobre qual
-- posto, e quem entrava depois caía em "Sem encarregado".
--
-- DESENHO
--   · ORGANOGRAMA_POSTO_ENCARREGADO: (empresa, filial, posto) → nó do
--     encarregado. Um encarregado por posto no contrato; um encarregado pode ter
--     vários postos.
--   · Continua UMA verdade só: o "reporta a" (ORGANOGRAMA_NO.parent_id). A
--     tabela diz quem DEVE ser o encarregado; ao salvar, quem está no posto passa
--     a se reportar a ele (com histórico), e organograma_superior_por_posto olha
--     a tabela primeiro — então quem é contratado, volta da ativa ou muda para
--     esse posto já entra ligado ao encarregado certo.
--   · Ao aplicar, não desfaz turma: quem já responde a alguém ABAIXO do
--     encarregado (o vigia do líder de turma, que responde ao encarregado) fica
--     onde está. O próprio encarregado e outros encarregados do posto também.
--   · Tirar o encarregado do posto (p_encarregado NULL) só apaga a regra: o
--     "reporta a" de quem já estava ligado fica, como no vínculo manual.
--   · Encarregado demitido: o nó dele sai da árvore e a regra cai junto
--     (ON DELETE CASCADE); a equipe sobe como já era (organograma_empregado_saiu).
--
-- ACESSO: ler = organograma/visualizar; gravar = quem monta o organograma
-- (organograma_pode_montar, a mesma do vínculo em lote).
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) A regra ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."ORGANOGRAMA_POSTO_ENCARREGADO" (
  empresa         bigint NOT NULL,
  filial          bigint NOT NULL,
  posto_codigo    text   NOT NULL,
  encarregado_no  uuid   NOT NULL REFERENCES public."ORGANOGRAMA_NO"(id) ON DELETE CASCADE,
  criado_por      uuid   DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, filial, posto_codigo)
);
CREATE INDEX IF NOT EXISTS idx_organograma_posto_encarregado_no ON public."ORGANOGRAMA_POSTO_ENCARREGADO" (encarregado_no);

ALTER TABLE public."ORGANOGRAMA_POSTO_ENCARREGADO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ORGANOGRAMA_POSTO_ENCARREGADO" FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS organograma_posto_encarregado_select ON public."ORGANOGRAMA_POSTO_ENCARREGADO";
CREATE POLICY organograma_posto_encarregado_select ON public."ORGANOGRAMA_POSTO_ENCARREGADO" FOR SELECT TO authenticated
  USING ((SELECT public.can_access((SELECT auth.uid()), 'organograma', 'visualizar'::public.app_acao)));
GRANT SELECT ON public."ORGANOGRAMA_POSTO_ENCARREGADO" TO authenticated;

-- ── 2) Dedução: o encarregado do posto vem antes da Hierarquia de Postos ──
-- Mesmo corpo da mig 20261104009000, com o passo 0 na frente.
CREATE OR REPLACE FUNCTION public.organograma_superior_por_posto(_empregado bigint)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_posto text := public.organograma_posto_efetivo(_empregado);
  v_emp bigint; v_fil bigint; v_ids uuid[]; v_mesmo uuid[]; n int := 0; v_enc uuid;
BEGIN
  IF v_posto IS NULL THEN RETURN NULL; END IF;
  SELECT e."Empresa"::bigint, e."Filial"::bigint INTO v_emp, v_fil FROM public."EMPREGADOS" e WHERE e."ID" = _empregado;

  -- 0) SIS-2026-0770: encarregado definido para o posto neste contrato.
  SELECT pe.encarregado_no INTO v_enc
    FROM public."ORGANOGRAMA_POSTO_ENCARREGADO" pe
    JOIN public."ORGANOGRAMA_NO" o ON o.id = pe.encarregado_no
   WHERE pe.empresa = v_emp AND pe.filial = v_fil AND pe.posto_codigo = v_posto
     AND o.empregado_id IS DISTINCT FROM _empregado;
  IF v_enc IS NOT NULL THEN RETURN v_enc; END IF;

  LOOP
    SELECT h.pai_codigo INTO v_posto FROM public."RH_POSTO_HIERARQUIA" h WHERE h.posto_codigo = v_posto;
    n := n + 1;
    IF v_posto IS NULL OR n > 20 THEN RETURN NULL; END IF;

    SELECT array_agg(x.id), array_agg(x.id) FILTER (WHERE x.emp = v_emp AND x.fil = v_fil)
      INTO v_ids, v_mesmo
      FROM (
        SELECT o.id, e."Empresa"::bigint AS emp, e."Filial"::bigint AS fil
          FROM public."EMPREGADOS" e
          JOIN public."ORGANOGRAMA_NO" o ON o.empregado_id = e."ID"
         WHERE e."Posto" = v_posto AND e."ID" <> _empregado AND public.organograma_ativo(e."Situação"::text)
           AND NOT EXISTS (SELECT 1 FROM public."RH_POSTO_OCUPANTE_ERP" a WHERE a.empregado_id = e."ID")
        UNION
        SELECT o.id, e."Empresa"::bigint, e."Filial"::bigint
          FROM public."RH_POSTO_OCUPANTE_ERP" a
          JOIN public."EMPREGADOS" e ON e."ID" = a.empregado_id
          JOIN public."ORGANOGRAMA_NO" o ON o.empregado_id = e."ID"
         WHERE a.posto_codigo = v_posto AND e."ID" <> _empregado AND public.organograma_ativo(e."Situação"::text)
      ) x;

    IF coalesce(array_length(v_ids, 1), 0) = 1 THEN RETURN v_ids[1]; END IF;
    IF coalesce(array_length(v_ids, 1), 0) > 1 THEN
      RETURN CASE WHEN coalesce(array_length(v_mesmo, 1), 0) = 1 THEN v_mesmo[1] END;
    END IF;
  END LOOP;
END $$;

-- ── 3) Definir (ou tirar) o encarregado de postos do contrato ────────────
CREATE OR REPLACE FUNCTION public.organograma_definir_encarregado_postos(
  p_empresa bigint, p_filial bigint, p_postos text[], p_encarregado uuid, p_aplicar boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_postos text[]; r record; v_ligados int := 0; v_mantidos int := 0; v_falhas int := 0; v_nome text;
BEGIN
  IF NOT public.organograma_pode_montar() THEN RAISE EXCEPTION 'Sem permissão para mudar o organograma.' USING ERRCODE = '42501'; END IF;
  IF p_empresa IS NULL OR p_filial IS NULL THEN RAISE EXCEPTION 'Contrato não informado.'; END IF;
  SELECT array_agg(DISTINCT btrim(p)) INTO v_postos FROM unnest(coalesce(p_postos, '{}')) p WHERE nullif(btrim(p), '') IS NOT NULL;
  IF v_postos IS NULL THEN RAISE EXCEPTION 'Escolha ao menos um posto.'; END IF;

  IF p_encarregado IS NULL THEN
    DELETE FROM public."ORGANOGRAMA_POSTO_ENCARREGADO"
     WHERE empresa = p_empresa AND filial = p_filial AND posto_codigo = ANY (v_postos);
    RETURN jsonb_build_object('postos', array_length(v_postos, 1), 'ligados', 0, 'mantidos', 0, 'falhas', 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public."ORGANOGRAMA_NO" WHERE id = p_encarregado) THEN
    RAISE EXCEPTION 'Encarregado não está no organograma.';
  END IF;

  INSERT INTO public."ORGANOGRAMA_POSTO_ENCARREGADO" (empresa, filial, posto_codigo, encarregado_no)
  SELECT p_empresa, p_filial, p, p_encarregado FROM unnest(v_postos) p
  ON CONFLICT (empresa, filial, posto_codigo)
  DO UPDATE SET encarregado_no = EXCLUDED.encarregado_no, criado_por = auth.uid(), updated_at = now();

  IF NOT coalesce(p_aplicar, true) THEN
    RETURN jsonb_build_object('postos', array_length(v_postos, 1), 'ligados', 0, 'mantidos', 0, 'falhas', 0);
  END IF;

  v_nome := coalesce(public.organograma_nome_no(p_encarregado), '—');
  PERFORM set_config('organograma.motivo',
    'Encarregado do posto: ' || v_nome || ' (' || public.organograma_contrato_nome(p_empresa, p_filial) || ')', true);

  -- Quem está HOJE nesses postos do contrato (o posto do ERP vale sobre o da Senior).
  FOR r IN
    SELECT o.id, o.parent_id
      FROM public."EMPREGADOS" e
      JOIN public."ORGANOGRAMA_NO" o ON o.empregado_id = e."ID"
     WHERE e."Empresa"::bigint = p_empresa AND e."Filial"::bigint = p_filial
       AND public.organograma_ativo(e."Situação"::text)
       AND public.organograma_posto_efetivo(e."ID"::bigint) = ANY (v_postos)
       AND o.id <> p_encarregado
  LOOP
    IF r.parent_id = p_encarregado
       OR (r.parent_id IS NOT NULL AND public.organograma_fecha_ciclo(p_encarregado, r.parent_id))
       OR public.organograma_eh_encarregado(r.id) THEN
      -- Já é dele (direto ou por um líder de turma abaixo dele), ou é outro encarregado.
      v_mantidos := v_mantidos + 1;
      CONTINUE;
    END IF;
    IF public.organograma_fecha_ciclo(r.id, p_encarregado) THEN
      v_falhas := v_falhas + 1;   -- o encarregado está abaixo dessa pessoa na árvore
      CONTINUE;
    END IF;
    -- organograma.auto: a origem fica 'posto' (organograma_no_normaliza gravaria
    -- 'manual'), para quem trocar de posto depois seguir o encarregado novo.
    -- O histórico continua: só organograma.silencio o cala.
    PERFORM set_config('organograma.auto', '1', true);
    UPDATE public."ORGANOGRAMA_NO"
       SET parent_id = p_encarregado, superior_origem = 'posto', do_grupo = false,
           ordem = (SELECT count(*) FROM public."ORGANOGRAMA_NO" i WHERE i.parent_id = p_encarregado)
     WHERE id = r.id;
    PERFORM set_config('organograma.auto', '', true);
    v_ligados := v_ligados + 1;
  END LOOP;
  PERFORM set_config('organograma.motivo', '', true);

  RETURN jsonb_build_object('postos', array_length(v_postos, 1), 'ligados', v_ligados, 'mantidos', v_mantidos, 'falhas', v_falhas);
END $$;
REVOKE ALL ON FUNCTION public.organograma_definir_encarregado_postos(bigint, bigint, text[], uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organograma_definir_encarregado_postos(bigint, bigint, text[], uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.organograma_definir_encarregado_postos(bigint, bigint, text[], uuid, boolean);
-- (reexecutar o CREATE de organograma_superior_por_posto da mig 20261104009000)
-- DROP TABLE IF EXISTS public."ORGANOGRAMA_POSTO_ENCARREGADO";
-- NOTIFY pgrst, 'reload schema';
