-- =========================================================================
-- SOLICITAR TREINAMENTO: contratos da LICITAÇÃO (16/11/2026)
--
-- RELATO (Pablo, com print de Lucas de Jesus Silva pedindo treinamento para
-- o contrato novo da Secretaria da Justiça RS): "não tá aparecendo os
-- contratos pra selecionar quando vai solicitar treinamento, ajusta, tem que
-- puxar os contratos da licitação certinho" / "tem que aparecer secretaria
-- da justiça".
--
-- DE ONDE VINHA: public."CONTRATOS" com "ATIVO" = 'SIM' — o cadastro de
-- filiais da Senior. Contrato recém-ganho só entra lá quando a Senior abre a
-- filial, então o encarregado não achava o contrato novo. Mesmo problema
-- que o 13º teve (mig 20261113001000): quem controla contrato é a Licitação
-- (Licitações › Contratos, public.contratos.status).
--
-- O QUE MUDA
--   1. trn_sol_opcoes lista os contratos da Licitação que não estão
--      encerrados nem suspensos. Cada um leva, quando existir, a filial da
--      Senior de mesmo nome (rh_norm_contrato, a régua do Ativos/Contratos)
--      — é ela que o "Treinamentos por contrato" (trn_ct_solicitacoes) usa.
--      Contrato novo sem filial na Senior vai sem empresa/filial.
--   2. "meu" (encarregado responsável, Hierarquia de Postos): a filial do
--      responsável casa com o contrato da Licitação pelo nome normalizado
--      ou pelo de-para de Suprimentos (sup_empregado_contrato_depara).
--   3. TRN_SOLICITACAO ganha contrato_id (uuid do contrato da Licitação);
--      trn_sol_campos/criar/reenviar gravam. As antigas ficam com NULL.
--
-- Espelho na tela: src/lib/treinamentos/solicitacaoTreinamento.ts
-- (valor do contrato = "empresa__filial__contrato_id").
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."TRN_SOLICITACAO" ADD COLUMN IF NOT EXISTS contrato_id uuid;
CREATE INDEX IF NOT EXISTS idx_trn_solicitacao_contrato_id ON public."TRN_SOLICITACAO"(contrato_id);

-- ── 1) As opções: contratos da Licitação ────────────────────────────────
CREATE OR REPLACE FUNCTION public.trn_sol_opcoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre no sistema.' USING ERRCODE = '42501'; END IF;

  WITH
  -- Filiais da Senior pelo nome normalizado (a ativa primeiro).
  senior AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(s."NOME CONTRATO"))
           public.rh_norm_contrato(s."NOME CONTRATO") AS nn, s."Empresa"::bigint AS empresa, s."Filial"::bigint AS filial
      FROM public."CONTRATOS" s
     WHERE public.rh_norm_contrato(s."NOME CONTRATO") IS NOT NULL
     ORDER BY public.rh_norm_contrato(s."NOME CONTRATO"), (s."ATIVO" = 'SIM') DESC, s."Filial"
  ),
  -- Os contratos (da Senior) de que quem está logado é responsável.
  meus_senior AS MATERIALIZED (
    SELECT DISTINCT s."NOME CONTRATO" AS nome, public.rh_norm_contrato(s."NOME CONTRATO") AS nn
      FROM (SELECT DISTINCT r.empresa, r.filial FROM public.rh_hier_responsaveis() r WHERE r.auth_user_id = auth.uid()) m
      JOIN public."CONTRATOS" s ON s."Empresa" = m.empresa AND s."Filial" = m.filial
  ),
  meus AS (
    SELECT c.id
      FROM public.contratos c
      JOIN meus_senior ms ON ms.nn = public.rh_norm_contrato(c.nome)
    UNION
    SELECT d.contrato_id
      FROM public.sup_empregado_contrato_depara d
      JOIN meus_senior ms ON ms.nome = d.filial_nome
  ),
  lic AS (
    SELECT c.id, c.nome, public.rh_norm_contrato(c.nome) AS nn
      FROM public.contratos c
     WHERE COALESCE(c.status, 'ativo') NOT IN ('encerrado', 'suspenso')
       AND NULLIF(btrim(c.nome), '') IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'contrato_id', l.id,
           'empresa', s.empresa,
           'filial', s.filial,
           'nome', l.nome,
           'meu', l.id IN (SELECT id FROM meus))
         ORDER BY (l.id IN (SELECT id FROM meus)) DESC, l.nome), '[]'::jsonb)
    INTO v_out
    FROM lic l
    LEFT JOIN senior s ON s.nn = l.nn;

  RETURN jsonb_build_object('eu', public.trn_sol_eu(), 'contratos', v_out);
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sol_opcoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_sol_opcoes() TO authenticated;

-- ── 2) Gravar o contrato_id ─────────────────────────────────────────────
-- Igual à 20261027000120 + contrato_id.
CREATE OR REPLACE FUNCTION public.trn_sol_campos(p jsonb)
RETURNS public."TRN_SOLICITACAO" LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  r       public."TRN_SOLICITACAO";
  v_local boolean := p->>'modalidade' = 'presencial';
BEGIN
  r.contrato_empresa := NULLIF(p->>'contrato_empresa', '')::bigint;
  r.contrato_filial := NULLIF(p->>'contrato_filial', '')::bigint;
  r.contrato_id := CASE WHEN p->>'contrato_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        THEN (p->>'contrato_id')::uuid END;
  r.contrato_nome := btrim(p->>'contrato_nome');
  r.treinamento := btrim(p->>'treinamento');
  r.motivo := btrim(p->>'motivo');
  r.objetivo := NULLIF(btrim(p->>'objetivo'), '');
  r.assuntos := btrim(p->>'assuntos');
  r.qtd_participantes := (p->>'qtd_participantes')::int;
  r.equipe := NULLIF(btrim(p->>'equipe'), '');
  r.turnos := NULLIF(btrim(p->>'turnos'), '');
  r.modalidade := p->>'modalidade';
  r.local_treinamento := CASE WHEN v_local THEN NULLIF(btrim(p->>'local_treinamento'), '') END;
  -- Sem repetição e em ordem; a primeira é a data_preferencial.
  r.datas_previstas := ARRAY(SELECT DISTINCT d::date FROM jsonb_array_elements_text(p->'datas_previstas') d WHERE NULLIF(d, '') IS NOT NULL ORDER BY 1);
  r.data_preferencial := r.datas_previstas[1];
  r.horario_inicio := NULL;
  r.horario_fim := NULL;
  r.urgencia := COALESCE(NULLIF(p->>'urgencia', ''), 'programavel');
  r.recursos := '{}';
  r.tem_sala := CASE WHEN v_local THEN (p->>'tem_sala')::boolean END;
  r.voltagem := CASE WHEN v_local THEN NULLIF(p->>'voltagem', '') END;
  r.tem_projetor := CASE WHEN v_local THEN (p->>'tem_projetor')::boolean END;
  r.precisa_projetor := CASE WHEN v_local THEN (p->>'precisa_projetor')::boolean END;
  r.tem_internet := CASE WHEN v_local THEN (p->>'tem_internet')::boolean END;
  r.tem_som := CASE WHEN v_local THEN (p->>'tem_som')::boolean END;
  r.tem_espaco_cafe := CASE WHEN v_local THEN (p->>'tem_espaco_cafe')::boolean END;
  r.precisa_transporte := NULL;
  r.observacoes := NULLIF(btrim(p->>'observacoes'), '');
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sol_campos(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trn_sol_criar(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  c    public."TRN_SOLICITACAO";
  v_eu text;
  v_em text;
  v_id bigint;
  v_pr text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre no sistema.' USING ERRCODE = '42501'; END IF;
  PERFORM public.trn_sol_validar(p);
  c := public.trn_sol_campos(p);
  SELECT x->>'nome', x->>'email' INTO v_eu, v_em FROM (SELECT public.trn_sol_eu() x) y;

  INSERT INTO public."TRN_SOLICITACAO" (
    solicitante_nome, solicitante_email, contrato_empresa, contrato_filial, contrato_id, contrato_nome, treinamento, motivo, objetivo, assuntos,
    qtd_participantes, equipe, turnos, modalidade, local_treinamento, datas_previstas, data_preferencial, urgencia,
    tem_sala, voltagem, tem_projetor, precisa_projetor, tem_internet, tem_som, tem_espaco_cafe,
    observacoes, declaracao, confirmado_em)
  VALUES (
    v_eu, v_em, c.contrato_empresa, c.contrato_filial, c.contrato_id, c.contrato_nome, c.treinamento, c.motivo, c.objetivo, c.assuntos,
    c.qtd_participantes, c.equipe, c.turnos, c.modalidade, c.local_treinamento, c.datas_previstas, c.data_preferencial, c.urgencia,
    c.tem_sala, c.voltagem, c.tem_projetor, c.precisa_projetor, c.tem_internet, c.tem_som, c.tem_espaco_cafe,
    c.observacoes,
    'Declaro que todas as informações fornecidas foram verificadas e confirmadas, correspondendo às condições reais do local e às '
      || 'necessidades do treinamento. Estou ciente de que serão utilizadas para elaboração do ofício e organização das atividades.',
    now())
  RETURNING id, protocolo INTO v_id, v_pr;

  INSERT INTO public."TRN_SOLICITACAO_EVENTO" (solicitacao_id, acao, para_status, texto, autor_nome)
  VALUES (v_id, 'enviada', 'pendente', 'Solicitação enviada com a declaração de veracidade.', v_eu);
  PERFORM public.trn_sol_avisar_treinamentos(v_id,
    CASE WHEN c.urgencia = 'prioritario' THEN 'Solicitação de treinamento PRIORITÁRIA' ELSE 'Nova solicitação de treinamento' END,
    v_pr || ' — ' || c.treinamento || ' · ' || c.contrato_nome || ' · ' || c.qtd_participantes || ' participante(s) · ' || coalesce(v_eu, ''));
  RETURN jsonb_build_object('id', v_id, 'protocolo', v_pr);
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sol_criar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_sol_criar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.trn_sol_reenviar(p_id bigint, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  s public."TRN_SOLICITACAO";
  c public."TRN_SOLICITACAO";
  v_eu text;
BEGIN
  SELECT * INTO s FROM public."TRN_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR s.solicitante_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só quem pediu corrige a solicitação.' USING ERRCODE = '42501';
  END IF;
  IF s.status <> 'pendente' OR s.devolucao_motivo IS NULL THEN
    RAISE EXCEPTION 'A solicitação não foi devolvida para ajuste.';
  END IF;
  PERFORM public.trn_sol_validar(p);
  c := public.trn_sol_campos(p);
  v_eu := public.trn_sol_eu()->>'nome';
  UPDATE public."TRN_SOLICITACAO" SET
    contrato_empresa = c.contrato_empresa, contrato_filial = c.contrato_filial, contrato_id = c.contrato_id, contrato_nome = c.contrato_nome,
    treinamento = c.treinamento, motivo = c.motivo, objetivo = c.objetivo, assuntos = c.assuntos,
    qtd_participantes = c.qtd_participantes, equipe = c.equipe, turnos = c.turnos, modalidade = c.modalidade,
    local_treinamento = c.local_treinamento, datas_previstas = c.datas_previstas, data_preferencial = c.data_preferencial,
    horario_inicio = NULL, horario_fim = NULL, urgencia = c.urgencia, recursos = '{}',
    tem_sala = c.tem_sala, voltagem = c.voltagem, tem_projetor = c.tem_projetor, precisa_projetor = c.precisa_projetor,
    tem_internet = c.tem_internet, tem_som = c.tem_som, tem_espaco_cafe = c.tem_espaco_cafe, precisa_transporte = NULL,
    observacoes = c.observacoes, confirmado_em = now(), devolucao_motivo = NULL
  WHERE id = p_id;
  INSERT INTO public."TRN_SOLICITACAO_EVENTO" (solicitacao_id, acao, de_status, para_status, texto, autor_nome)
  VALUES (p_id, 'reenviada', 'pendente', 'pendente', 'Corrigida e reenviada com a declaração de veracidade.', v_eu);
  PERFORM public.trn_sol_avisar_treinamentos(p_id, 'Solicitação de treinamento corrigida',
    s.protocolo || ' — ' || c.treinamento || ' · ' || c.contrato_nome || ' foi corrigida e reenviada.');
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sol_reenviar(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_sol_reenviar(bigint, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar trn_sol_opcoes da 20261026000910 e trn_sol_campos/criar/reenviar
-- da 20261027000120. Depois:
-- DROP INDEX IF EXISTS public.idx_trn_solicitacao_contrato_id;
-- ALTER TABLE public."TRN_SOLICITACAO" DROP COLUMN IF EXISTS contrato_id;
