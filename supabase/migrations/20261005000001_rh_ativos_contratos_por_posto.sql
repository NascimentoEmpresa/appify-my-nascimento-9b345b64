-- =========================================================================
-- RH › ATIVOS/CONTRATOS v2 — conferência posto a posto, pessoa a pessoa
--
-- PEDIDO (05/10/2026, Pablo): "tá MUITO CONFUSO". A v1 (mig 20260930000279)
-- mostrava grupos de postos ligados muitos-para-muitos, ativos × afastados ×
-- pendentes × ignorados — e só 8 dos ~300 postos da Senior tinham sido
-- ligados. Agora:
--   · por contrato e por posto da planilha: PREVISTO × TEM, e pronto;
--   · quem está em Auxílio Doença, Licença, Férias, Cárcere… NÃO conta
--     (o posto está descoberto). Só "Trabalhando" e atestado contam
--     (rh_ac_conta_no_posto — regra num lugar só);
--   · cada colaborador fica num posto da planilha. Padrão: o posto da Senior
--     dele ligado a UM posto da planilha (RH_POSTO_DEPARA, como na v1);
--     exceção: a pessoa movida individualmente ("RH_POSTO_COLABORADOR") —
--     é o que resolve o caso UFRGS (um posto na Senior, vários na planilha
--     separados por cidade) sem o grupo muitos-para-muitos da v1.
--
-- Pessoa é identificada por Empresa + Cadastro (único entre os 2.457 ativos
-- em 05/10/2026), não pelo "ID" da EMPREGADOS: a importação já recriou
-- linhas (ver limpeza de duplicados de 20/08/2026) e o ID mudaria.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1. Quem conta no posto ───────────────────────────────────────────────
-- Situações medidas em 05/10/2026 entre os ativos: Trabalhando 2239,
-- Auxílio Doença 96, Férias 79, Licença Maternidade 35, Atestado (dias) 6,
-- Cárcere 1, Atestado Filho 1.
CREATE OR REPLACE FUNCTION public.rh_ac_conta_no_posto(_situacao text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(btrim(_situacao), '') = 'Trabalhando'
      OR COALESCE(_situacao, '') ILIKE 'atestado%';
$$;

-- ── 2. Posto individual do colaborador ───────────────────────────────────
-- Vale só enquanto a pessoa estiver no mesmo contrato (contrato_id): se ela
-- for transferida, a exceção para de valer sozinha e volta a regra do posto.
CREATE TABLE IF NOT EXISTS public."RH_POSTO_COLABORADOR" (
  empresa         bigint NOT NULL,
  cadastro        bigint NOT NULL,
  contrato_id     uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  -- Nome do posto na planilha_custo (casado por sup_norm_nome, como o
  -- RH_POSTO_DEPARA). '' = fora da conta (ex.: cobrindo outro contrato).
  planilha_posto  text NOT NULL,
  atualizado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, cadastro)
);

ALTER TABLE public."RH_POSTO_COLABORADOR" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."RH_POSTO_COLABORADOR" TO authenticated;

DROP POLICY IF EXISTS rh_posto_colaborador_select ON public."RH_POSTO_COLABORADOR";
CREATE POLICY rh_posto_colaborador_select ON public."RH_POSTO_COLABORADOR"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rh_ativos_contratos', 'visualizar'::public.app_acao));
-- Escrita só pela RPC rh_ac_mover_colaborador (SECURITY DEFINER).

-- ── 3. rh_ac_ativos ganha Empresa ────────────────────────────────────────
-- Mesmo corpo da mig 279 + a coluna empresa. Muda o RETURNS TABLE, então é
-- DROP + CREATE (rh_ac_pessoas usa colunas pelo nome e segue funcionando).
DROP FUNCTION IF EXISTS public.rh_ac_ativos();
CREATE FUNCTION public.rh_ac_ativos()
RETURNS TABLE (
  empregado_id bigint, cadastro text, nome text, cargo text, posto_senior text,
  situacao text, admissao text, filial text, local text, contrato_id uuid, empresa bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH ct AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(c.nome))
           public.rh_norm_contrato(c.nome) AS nn, c.id
      FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(c.nome),
              (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC
  ),
  dp AS MATERIALIZED (
    SELECT d.filial_nome, public.rh_norm_contrato(d.filial_nome) AS nn, d.contrato_id
      FROM public.sup_empregado_contrato_depara d
  )
  SELECT e."ID"::bigint,
         e."Cadastro"::text,
         e."Nome",
         e."Título do Cargo",
         btrim(COALESCE(e."Nome do Posto", '')),
         e."Situação",
         e."Admissão"::text,
         e."Nome Filial",
         e."Descrição do Local",
         COALESCE(
           (SELECT dp.contrato_id FROM dp WHERE dp.filial_nome = e."Nome Filial" LIMIT 1),
           (SELECT ct.id FROM ct WHERE ct.nn = public.rh_norm_contrato(e."Nome Filial") LIMIT 1),
           (SELECT dp.contrato_id FROM dp WHERE dp.nn = public.rh_norm_contrato(e."Nome Filial") LIMIT 1),
           (SELECT ct.id FROM ct WHERE ct.nn = public.rh_norm_contrato(e."Descrição do Local") LIMIT 1)),
         e."Empresa"::bigint
    FROM public."EMPREGADOS" e
   WHERE public.esp_col_esta_ativo(e."Situação")
     AND COALESCE(btrim(e."Nome"), '') <> '';
$$;
REVOKE ALL ON FUNCTION public.rh_ac_ativos() FROM PUBLIC, anon, authenticated;

-- ── 4. O painel ──────────────────────────────────────────────────────────
-- Por contrato: os postos vigentes da planilha (com as vagas), as pessoas
-- (cada uma já com o posto da planilha em que está, e de onde veio isso) e
-- a ligação de cada posto da Senior. A soma por posto fica no front
-- (src/pages/rh/conferenciaAtivos.ts, com teste).
--
-- Posto de cada pessoa, nesta ordem:
--   1. RH_POSTO_COLABORADOR do mesmo contrato  → origem 'pessoa'
--      ('' = fora da conta);
--   2. RH_POSTO_DEPARA do posto da Senior      → origem 'posto'
--      (ignorar = fora da conta). A v1 deixava um posto da Senior apontar
--      para vários da planilha; aqui vale o primeiro em ordem alfabética
--      (eram 8 ligações em 05/10/2026, nenhuma com mais de um destino);
--   3. nada → sem posto (a tela pede para vincular).
-- Ligação que aponta para posto que saiu da planilha vigente cai para o
-- passo seguinte (a pessoa reaparece como "sem posto").
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
    'filiais_sem_contrato', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('filial', f.filial, 'qtd', f.qtd) ORDER BY f.qtd DESC)
         FROM (SELECT COALESCE(filial, '(sem filial)') AS filial, count(*)::int AS qtd
                 FROM pessoas WHERE contrato_id IS NULL GROUP BY 1) f), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.rh_ac_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_ac_painel() TO authenticated;

-- ── 5. Mover UM colaborador de posto ─────────────────────────────────────
-- p_planilha_posto: nome do posto da planilha → fica nesse posto;
--                   ''   → fora da conta deste contrato;
--                   NULL → desfaz (volta a valer o posto da Senior).
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

  IF v_pp <> '' AND NOT EXISTS (
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

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT jsonb_array_length((public.rh_ac_painel())->'contratos');
-- SELECT public.rh_ac_conta_no_posto(s), s FROM (VALUES ('Trabalhando'),('Férias'),('Atestado (dias)'),('Auxílio Doença')) v(s);

-- ROLLBACK (volta à v1: reaplicar as seções 5 e 6 da mig 20260930000279)
-- DROP FUNCTION IF EXISTS public.rh_ac_mover_colaborador(bigint, text);
-- DROP TABLE IF EXISTS public."RH_POSTO_COLABORADOR";
-- DROP FUNCTION IF EXISTS public.rh_ac_conta_no_posto(text);
