-- =========================================================================
-- RH › ATIVOS/CONTRATOS — efetivo real (EMPREGADOS) × quantidade contratada
-- por posto (planilha_custo."QT. PESSOAS" = qt_postos)
--
-- PEDIDO (30/09/2026)
--   Um painel no RH que mostra, por contrato, quantos colaboradores ativos
--   existem na tabela EMPREGADOS e compara com o que a Planilha de Custo diz
--   que deveria ter. A conferência é POR POSTO: cada colaborador tem o posto
--   dele, e cada posto da planilha tem a quantidade de pessoas contratadas.
--
-- AS DUAS FONTES NÃO TÊM CHAVE EM COMUM (medido em 30/09/2026)
--   Contrato: EMPREGADOS."Nome Filial" = "1050 - UFRGS - LIMPEZA GERAL - 047/2022"
--             contratos.nome           = "UFRGS - LIMPEZA GERAL - 047/2022"
--     → casa tirando o código da frente e os zeros à esquerda dos números
--       (rh_norm_contrato): 2.178 dos 2.466 ativos casam assim. O código da
--       filial NÃO serve de chave: 1097 é SAMU, Guaporé e Rosário ao mesmo
--       tempo. O que não casar o RH liga na tela, e a ligação vai para
--       sup_empregado_contrato_depara — a mesma tabela que Suprimentos e o
--       Espaço do Colaborador já leem, então corrige lá também.
--       (Obs.: esp_col_arvore ainda compara "Nome Filial" sem tirar o código
--       e hoje só casa 6 pessoas — fora do escopo desta migration.)
--   Posto:    EMPREGADOS."Nome do Posto" = "01-1097-0069-0201-06-TELEFONISTA TARM-A 6X1 06 AS 12"
--             planilha_custo.posto       = "POSTO A - TELEFONISTA 180H"
--     → não há regra que case isso com segurança. Por isso existe
--       "RH_POSTO_DEPARA": para cada contrato, cada posto da Senior é ligado
--       UMA VEZ ao(s) posto(s) da planilha (ou marcado para ignorar). A tela
--       sugere a ligação; quem tem permissão confirma.
--
-- O QUE CONTA COMO "ATIVO": esp_col_esta_ativo — a mesma régua do Espaço do
-- Colaborador (fora só demitido/desligado/rescindido/aposentado). Afastados e
-- férias continuam ocupando o posto; a tela os mostra à parte.
--
-- O QUE CONTA COMO POSTO VIGENTE: a linha EXECUTADO mais recente de cada
-- contrato+posto com vigência até hoje e não encerrada — a mesma que a
-- Planilha de Custo marca como VIGENTE.
--
-- LIBERAÇÃO (Acesso por Usuário, módulo Recursos Humanos) — nascem FECHADOS:
--   · "Ativos/Contratos"                      (rh_ativos_contratos)
--   · "Ativos/Contratos · Vincular postos"    (rh_ativos_contratos_vincular)
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1. Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM (VALUES
    ('rh_ativos_contratos',          'Ativos/Contratos',                    '/app/rh/ativos-contratos', 12),
    ('rh_ativos_contratos_vincular', 'Ativos/Contratos · Vincular postos',  NULL,                       13)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'rh'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2. Normalização do nome do contrato ──────────────────────────────────
-- Tira o código da filial da frente ("1050 - "), os zeros à esquerda de cada
-- número ("055/2023" = "55/2023") e passa por sup_norm_nome (sem acento,
-- sem pontuação, maiúsculo).
CREATE OR REPLACE FUNCTION public.rh_norm_contrato(_t text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(public.sup_norm_nome(
           regexp_replace(
             regexp_replace(COALESCE(_t, ''), '^\s*\d+\s*-\s*', ''),
             '(^|[^0-9])0+([0-9])', '\1\2', 'g')), '');
$$;

-- ── 3. De-para de postos (Senior ↔ planilha), muitos-para-muitos ─────────
-- Nem sempre é 1 para 1: na UFRGS Limpeza Geral a planilha separa o posto por
-- cidade ("ASG 5D POA", "ASG 5D TRAMANDAI"…) e a Senior tem um posto só
-- ("AUX SERVIÇOS GERAIS-30H") para todas. Por isso um posto da Senior pode
-- ligar a vários da planilha e vice-versa; os postos ligados entre si formam
-- um GRUPO, e a conferência é feita no total do grupo (montado no front,
-- src/pages/rh/conferenciaAtivos.ts).
CREATE TABLE IF NOT EXISTS public."RH_POSTO_DEPARA" (
  contrato_id     uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  -- "Nome do Posto" exatamente como vem da Senior (sem espaços nas pontas).
  -- '' = colaborador sem posto no cadastro.
  posto_senior    text NOT NULL,
  -- Nome do posto na planilha_custo (casado por sup_norm_nome, para a ligação
  -- sobreviver a uma nova vigência com o mesmo nome). '' quando ignorar.
  planilha_posto  text NOT NULL,
  -- Posto da Senior que não entra na conta (ex.: "Posto padrão do sistema").
  ignorar         boolean NOT NULL DEFAULT false,
  atualizado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contrato_id, posto_senior, planilha_posto),
  CHECK (ignorar = (planilha_posto = ''))
);

ALTER TABLE public."RH_POSTO_DEPARA" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."RH_POSTO_DEPARA" TO authenticated;

DROP POLICY IF EXISTS rh_posto_depara_select ON public."RH_POSTO_DEPARA";
CREATE POLICY rh_posto_depara_select ON public."RH_POSTO_DEPARA"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rh_ativos_contratos', 'visualizar'::public.app_acao));
-- Escrita só pelas RPCs abaixo (SECURITY DEFINER).

-- ── 4. Acesso ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_ac_exige(_vincular boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_screen_access(v_uid, 'rh_ativos_contratos', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso a Ativos/Contratos' USING ERRCODE = '42501';
  END IF;
  IF _vincular AND NOT public.has_screen_access(v_uid, 'rh_ativos_contratos_vincular', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para vincular postos e contratos' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END $$;
REVOKE ALL ON FUNCTION public.rh_ac_exige(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_ac_exige(boolean) TO authenticated;

-- ── 5. Contrato de cada colaborador ativo ────────────────────────────────
-- Uma função só, usada pelo painel e pela lista de pessoas, para as duas
-- nunca discordarem. Ordem:
--   1. de-para com o "Nome Filial" EXATO (o que o RH liga nesta tela);
--   2. contrato com o mesmo nome da filial (sem o código);
--   3. de-para antigo, comparado sem o código — vem DEPOIS do nome exato
--      porque ficou desatualizado: ligava "UFFS CHAPECO - 041/2021" ao
--      contrato "UFFS - 041/2021", e hoje existe o contrato "UFFS CHAPECO -
--      041/2021" com a planilha (medido em 30/09/2026);
--   4. "Descrição do Local" (a regra antiga do Espaço do Colaborador).
CREATE OR REPLACE FUNCTION public.rh_ac_ativos()
RETURNS TABLE (
  empregado_id bigint, cadastro text, nome text, cargo text, posto_senior text,
  situacao text, admissao text, filial text, local text, contrato_id uuid)
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
           (SELECT ct.id FROM ct WHERE ct.nn = public.rh_norm_contrato(e."Descrição do Local") LIMIT 1))
    FROM public."EMPREGADOS" e
   WHERE public.esp_col_esta_ativo(e."Situação")
     AND COALESCE(btrim(e."Nome"), '') <> '';
$$;
-- Interna: só as RPCs do painel chamam (elas checam o acesso).
REVOKE ALL ON FUNCTION public.rh_ac_ativos() FROM PUBLIC, anon, authenticated;

-- ── 6. O painel ──────────────────────────────────────────────────────────
-- Devolve os dados crus de cada contrato — postos da planilha (com as vagas),
-- postos da Senior (com as pessoas) e as ligações. A montagem dos grupos e a
-- conferência ficam no front (src/pages/rh/conferenciaAtivos.ts, com teste),
-- porque ligação muitos-para-muitos é um grafo e isso é mais claro em código.
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
           pc.servico, COALESCE(pc.qt_postos, 0) AS vagas, pc.data_vigencia
      FROM public.planilha_custo pc
     WHERE pc.contrato_id IS NOT NULL
       AND pc.orexec = 'EXECUTADO'
       AND NOT COALESCE(pc.encerrado, false)
       AND pc.data_vigencia IS NOT NULL
       AND pc.data_vigencia <= current_date
       AND COALESCE(btrim(pc.posto), '') <> ''
     ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), pc.data_vigencia DESC
  ),
  ps AS (
    SELECT p.contrato_id, p.posto_senior,
           count(*)::int AS qtd,
           count(*) FILTER (WHERE COALESCE(p.situacao, '') <> 'Trabalhando')::int AS afastados
      FROM pessoas p WHERE p.contrato_id IS NOT NULL
     GROUP BY 1, 2
  ),
  -- Ligações, já apontando para o nome ATUAL do posto na planilha vigente.
  -- Ligação a posto que saiu da planilha volta com planilha_posto NULL e
  -- 'orfa' = true, para a tela avisar em vez de sumir com ela.
  lig AS (
    SELECT d.contrato_id, d.posto_senior, d.ignorar,
           CASE WHEN d.ignorar THEN NULL ELSE pv.posto END AS planilha_posto,
           (NOT d.ignorar AND pv.posto IS NULL) AS orfa,
           d.planilha_posto AS planilha_posto_gravado
      FROM public."RH_POSTO_DEPARA" d
      LEFT JOIN pv ON pv.contrato_id = d.contrato_id
                  AND pv.pn = public.sup_norm_nome(d.planilha_posto)
  ),
  cids AS (
    SELECT contrato_id FROM pv
    UNION
    SELECT contrato_id FROM pessoas WHERE contrato_id IS NOT NULL
  ),
  nos AS (
    SELECT c.nome AS ordem, jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'cliente', c.cliente, 'status', c.status,
      'encerrado', COALESCE(c.status, 'ativo') = 'encerrado',
      'postos', COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'nome', pv.posto, 'servico', pv.servico, 'vagas', pv.vagas, 'vigencia', pv.data_vigencia)
                  ORDER BY pv.posto)
           FROM pv WHERE pv.contrato_id = c.id), '[]'::jsonb),
      'postos_senior', COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'posto_senior', ps.posto_senior, 'qtd', ps.qtd, 'afastados', ps.afastados)
                  ORDER BY ps.qtd DESC, ps.posto_senior)
           FROM ps WHERE ps.contrato_id = c.id), '[]'::jsonb),
      'vinculos', COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'posto_senior', l.posto_senior, 'planilha_posto', l.planilha_posto,
                  'ignorar', l.ignorar, 'orfa', l.orfa, 'planilha_posto_gravado', l.planilha_posto_gravado))
           FROM lig l WHERE l.contrato_id = c.id), '[]'::jsonb)
    ) AS no
      FROM cids JOIN public.contratos c ON c.id = cids.contrato_id
     WHERE COALESCE(c.status, 'ativo') <> 'encerrado'
        OR EXISTS (SELECT 1 FROM ps WHERE ps.contrato_id = c.id)
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

-- ── 7. As pessoas de um contrato (ou de uma filial sem contrato) ─────────
-- Só campos não sensíveis (sem CPF, salário, banco).
CREATE OR REPLACE FUNCTION public.rh_ac_pessoas(p_contrato_id uuid, p_filial text DEFAULT NULL)
RETURNS TABLE (
  empregado_id bigint, cadastro text, nome text, cargo text, posto_senior text,
  situacao text, admissao text, local text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.rh_ac_exige();
  RETURN QUERY
  SELECT a.empregado_id, a.cadastro, a.nome, a.cargo, a.posto_senior,
         a.situacao, a.admissao, a.local
    FROM public.rh_ac_ativos() a
   WHERE (p_contrato_id IS NOT NULL AND a.contrato_id = p_contrato_id)
      OR (p_contrato_id IS NULL AND a.contrato_id IS NULL
          AND COALESCE(a.filial, '(sem filial)') = COALESCE(p_filial, '(sem filial)'))
   ORDER BY a.posto_senior, a.nome;
END $$;
REVOKE ALL ON FUNCTION public.rh_ac_pessoas(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_ac_pessoas(uuid, text) TO authenticated;

-- ── 8. Vincular postos ───────────────────────────────────────────────────
-- p_itens: [{"posto_senior": "...", "planilha_postos": ["...", ...], "ignorar": bool}]
-- Cada item SUBSTITUI todas as ligações daquele posto da Senior no contrato:
--   planilha_postos com nomes   → liga a esses postos;
--   ignorar true                → fica fora da conta;
--   lista vazia e ignorar false → desfaz.
CREATE OR REPLACE FUNCTION public.rh_ac_vincular_postos(p_contrato_id uuid, p_itens jsonb)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := public.rh_ac_exige(true);
  v_n   int := 0;
  it    jsonb;
  v_ps  text;
  v_pp  text;
  v_ig  boolean;
BEGIN
  IF p_contrato_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = p_contrato_id) THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de postos inválida.';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_ps := btrim(COALESCE(it->>'posto_senior', ''));
    v_ig := COALESCE((it->>'ignorar')::boolean, false);

    DELETE FROM public."RH_POSTO_DEPARA" WHERE contrato_id = p_contrato_id AND posto_senior = v_ps;

    IF v_ig THEN
      INSERT INTO public."RH_POSTO_DEPARA" (contrato_id, posto_senior, planilha_posto, ignorar, atualizado_por)
      VALUES (p_contrato_id, v_ps, '', true, v_uid);
    ELSE
      FOR v_pp IN
        SELECT DISTINCT btrim(x) FROM jsonb_array_elements_text(COALESCE(it->'planilha_postos', '[]'::jsonb)) x
         WHERE btrim(x) <> ''
      LOOP
        IF NOT EXISTS (SELECT 1 FROM public.planilha_custo pc
                        WHERE pc.contrato_id = p_contrato_id
                          AND public.sup_norm_nome(pc.posto) = public.sup_norm_nome(v_pp)) THEN
          RAISE EXCEPTION 'O posto "%" não existe na planilha deste contrato.', v_pp;
        END IF;
        INSERT INTO public."RH_POSTO_DEPARA" (contrato_id, posto_senior, planilha_posto, ignorar, atualizado_por)
        VALUES (p_contrato_id, v_ps, v_pp, false, v_uid)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.rh_ac_vincular_postos(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_ac_vincular_postos(uuid, jsonb) TO authenticated;

-- ── 9. Ligar uma filial sem contrato a um contrato ───────────────────────
-- Grava em sup_empregado_contrato_depara (mesma tabela de Suprimentos e do
-- Espaço do Colaborador), com o "Nome Filial" exatamente como está na
-- EMPREGADOS. p_contrato_id null = desfaz.
CREATE OR REPLACE FUNCTION public.rh_ac_vincular_filial(p_filial text, p_contrato_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := public.rh_ac_exige(true);
  v_nome text;
BEGIN
  IF COALESCE(btrim(p_filial), '') = '' THEN
    RAISE EXCEPTION 'Informe a filial.';
  END IF;
  IF p_contrato_id IS NULL THEN
    DELETE FROM public.sup_empregado_contrato_depara WHERE filial_nome = p_filial;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = p_contrato_id) THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;
  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.sup_empregado_contrato_depara (filial_nome, contrato_id, motivo)
  VALUES (p_filial, p_contrato_id, 'Vinculado em RH › Ativos/Contratos por ' || COALESCE(v_nome, 'usuário'))
  ON CONFLICT (filial_nome) DO UPDATE
     SET contrato_id = EXCLUDED.contrato_id, motivo = EXCLUDED.motivo;
END $$;
REVOKE ALL ON FUNCTION public.rh_ac_vincular_filial(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_ac_vincular_filial(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT (public.rh_ac_painel())->>'com_contrato', (public.rh_ac_painel())->>'total_ativos';
-- SELECT contrato_id IS NOT NULL AS com_contrato, count(*) FROM public.rh_ac_ativos() GROUP BY 1;

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.rh_ac_vincular_filial(text, uuid);
-- DROP FUNCTION IF EXISTS public.rh_ac_vincular_postos(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.rh_ac_pessoas(uuid, text);
-- DROP FUNCTION IF EXISTS public.rh_ac_painel();
-- DROP FUNCTION IF EXISTS public.rh_ac_ativos();
-- DROP FUNCTION IF EXISTS public.rh_ac_exige(boolean);
-- DROP TABLE IF EXISTS public."RH_POSTO_DEPARA";
-- DROP FUNCTION IF EXISTS public.rh_norm_contrato(text);
-- UPDATE public.app_menu SET ativo = false WHERE codigo IN ('rh_ativos_contratos', 'rh_ativos_contratos_vincular');
-- (ligações feitas em sup_empregado_contrato_depara têm motivo 'Vinculado em RH › Ativos/Contratos%')
