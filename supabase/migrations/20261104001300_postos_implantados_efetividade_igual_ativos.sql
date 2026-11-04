-- =========================================================================
-- POSTOS IMPLANTADOS — Efetividade do Dia igual ao Ativos/Contratos
-- (04/11/2026)
--
-- PEDIDO (chamado da Operação): "O Painel de efetividade do dia não bate com
-- o painel Ativos/Contratos, onde os supervisores fazem a gestão diária.
-- Ambos precisam ter a mesma quantidade de postos previstos [...] O que deve
-- aparecer para os supervisores é o implantado, não o previsto."
--
-- O QUE JÁ EXISTIA (mig 20261027000020)
--   · contrato_postos_base: previsto da Planilha de Custo + implantado
--     registrado pela Licitação (Contratos › Implantação). As duas telas já
--     liam dela — o NÚMERO por posto era o mesmo.
--
-- POR QUE AINDA NÃO BATIA
--   A Efetividade é por filial da Senior (Empresa + Filial); o Ativos, por
--   contrato do ERP. ope_efet_previsto_planilha ligava UM contrato a UMA
--   filial (DISTINCT ON dos dois lados):
--     · filial com gente de dois contratos (pessoa movida para outro
--       contrato, contrato pequeno dentro da filial de um grande) → só o
--       maior aparecia; o implantado dos outros SUMIA da Efetividade;
--     · e não havia o "tem" do Ativos (quem está Trabalhando no contrato) —
--       o supervisor não via, no Painel, implantado × realidade.
--
-- O QUE MUDA
--   1. rh_ac_pessoas_posto(): a ligação pessoa → posto da planilha que
--      estava DENTRO do rh_ac_painel (depara do posto da Senior, exceção por
--      pessoa, renda técnica, "fora da conta") vira função própria. O
--      rh_ac_painel passa a ler dela — mesma saída, byte a byte — e a
--      Efetividade também: uma regra só para "quem ocupa o posto".
--   2. ope_efet_previsto_planilha(): uma linha POR CONTRATO (não mais por
--      filial), com previsto, implantado e tem (Trabalhando, fora da conta e
--      renda técnica de fora — a mesma conta do conferirContrato do
--      Ativos/Contratos) e a filial "casa" do contrato (a de mais gente). A
--      tela soma os contratos que caem na mesma filial. Contrato com
--      planilha e sem ninguém ativo vem com filial NULL: entra no total.
--      Mesmo conjunto de contratos do Ativos (não encerrado, ou com gente).
--
-- Só leitura: nada de tabela, menu ou permissão nova. Idempotente.
-- ROLLBACK no fim.
-- =========================================================================

-- ── 1. Quem ocupa qual posto (a regra do Ativos/Contratos) ───────────────
-- Interna: só as RPCs SECURITY DEFINER a chamam (sem EXECUTE para o
-- client — ela não confere acesso; cada RPC confere o seu).
CREATE OR REPLACE FUNCTION public.rh_ac_pessoas_posto()
RETURNS TABLE (
  empregado_id bigint, cadastro text, nome text, cargo text, posto_senior text, situacao text,
  admissao text, filial text, local text, contrato_id uuid, empresa bigint,
  posto text, fora boolean, origem text, conta boolean, rt boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH pessoas AS MATERIALIZED (SELECT * FROM public.rh_ac_ativos()),
  pv AS MATERIALIZED (
    SELECT b.contrato_id, b.posto, b.posto_norm AS pn
      FROM public.contrato_postos_base(current_date) b
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
  pes AS (
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
  )
  SELECT pes.empregado_id, pes.cadastro, pes.nome, pes.cargo, pes.posto_senior, pes.situacao,
         pes.admissao, pes.filial, pes.local, pes.contrato_id, pes.empresa,
         pes.posto, pes.fora, pes.origem,
         public.rh_ac_conta_no_posto(pes.situacao),
         -- Mesma régua do ehPostoRT (conferenciaAtivos.ts).
         COALESCE(public.sup_norm_nome(pes.posto) = 'RENDATECNICA', false)
    FROM pes
$fn$;
REVOKE ALL ON FUNCTION public.rh_ac_pessoas_posto() FROM PUBLIC, anon, authenticated;

-- ── 2. RH › Ativos/Contratos: lê a ligação da função acima ───────────────
-- Corpo igual ao da mig 20261027000020; só o "pessoas"/"pes" sai da função.
CREATE OR REPLACE FUNCTION public.rh_ac_painel()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.rh_ac_exige();

  WITH pessoas AS MATERIALIZED (SELECT * FROM public.rh_ac_pessoas_posto()),
  pv AS MATERIALIZED (
    SELECT b.contrato_id, b.posto, b.posto_norm AS pn, b.previsto AS vagas, b.implantado, b.registrado
      FROM public.contrato_postos_base(current_date) b
  ),
  pes AS (SELECT * FROM pessoas WHERE contrato_id IS NOT NULL),
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
         SELECT jsonb_agg(jsonb_build_object('nome', pv.posto, 'vagas', pv.vagas, 'previsto', pv.vagas,
                                             'implantado', pv.implantado, 'implantado_registrado', pv.registrado)
                          ORDER BY pv.posto)
           FROM pv WHERE pv.contrato_id = c.id), '[]'::jsonb),
      'pessoas', COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'id', p.empregado_id, 'cadastro', p.cadastro, 'nome', p.nome, 'cargo', p.cargo,
                  'situacao', p.situacao, 'conta', p.conta,
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

-- ── 3. Operacional › Efetividade: implantado × tem POR CONTRATO ──────────
-- Uma linha por contrato do ERP (o mesmo conjunto do Ativos/Contratos), com
-- a filial "casa" para a tela casar com a chave Empresa+Filial da Senior.
-- Campos antigos (empresa, filial, contrato_id, contrato, previsto,
-- implantado) seguem com o mesmo nome — o front de antes continua lendo.
CREATE OR REPLACE FUNCTION public.ope_efet_previsto_planilha()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.ope_efet_exige('visualizar');

  WITH pes AS MATERIALIZED (
    SELECT a.contrato_id, e."Empresa" AS empresa, e."Filial" AS filial, a.conta, a.fora, a.rt
      FROM public.rh_ac_pessoas_posto() a
      JOIN public."EMPREGADOS" e ON e."ID" = a.empregado_id
     WHERE a.contrato_id IS NOT NULL
  ),
  casa AS (   -- a filial do contrato: a de mais gente
    SELECT DISTINCT ON (contrato_id) contrato_id, empresa, filial
      FROM (SELECT contrato_id, empresa, filial, count(*) AS n
              FROM pes WHERE empresa IS NOT NULL AND filial IS NOT NULL
             GROUP BY 1, 2, 3) x
     ORDER BY contrato_id, n DESC, empresa, filial
  ),
  -- tem = Trabalhando, dentro da conta, fora a renda técnica (conferirContrato).
  tem AS (
    SELECT contrato_id,
           count(*) FILTER (WHERE NOT fora AND NOT rt AND conta) AS tem,
           count(*) FILTER (WHERE NOT fora AND NOT rt AND NOT conta) AS afastados
      FROM pes GROUP BY 1
  ),
  base AS MATERIALIZED (SELECT * FROM public.contrato_postos_base(current_date)),
  pv AS (
    -- Contrato com qualquer posto na planilha (RT inclusive) entra nos
    -- totais do Ativos; a soma é sem a RT.
    SELECT b.contrato_id,
           COALESCE(sum(b.previsto) FILTER (WHERE NOT b.rt), 0) AS previsto,
           COALESCE(sum(b.implantado) FILTER (WHERE NOT b.rt), 0) AS implantado,
           COALESCE(bool_or(b.registrado) FILTER (WHERE NOT b.rt), false) AS registrado
      FROM base b
     GROUP BY 1
  ),
  cids AS (
    SELECT contrato_id FROM base
    UNION
    SELECT contrato_id FROM pes
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'empresa', ca.empresa, 'filial', ca.filial, 'contrato_id', c.id, 'contrato', c.nome,
           'com_planilha', pv.contrato_id IS NOT NULL,
           'previsto', COALESCE(pv.previsto, 0), 'implantado', COALESCE(pv.implantado, 0),
           'implantado_registrado', COALESCE(pv.registrado, false),
           'tem', COALESCE(t.tem, 0), 'afastados', COALESCE(t.afastados, 0))
           ORDER BY c.nome), '[]'::jsonb)
    INTO v_out
    FROM cids
    JOIN public.contratos c ON c.id = cids.contrato_id
    LEFT JOIN casa ca ON ca.contrato_id = c.id
    LEFT JOIN pv ON pv.contrato_id = c.id
    LEFT JOIN tem t ON t.contrato_id = c.id
   WHERE COALESCE(c.status, 'ativo') <> 'encerrado'
      OR EXISTS (SELECT 1 FROM pes WHERE pes.contrato_id = c.id);

  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_efet_previsto_planilha() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_previsto_planilha() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência (pgAdmin) — por contrato, a Efetividade tem que dar o mesmo
-- implantado/tem que a linha do contrato no Ativos/Contratos:
--   SELECT x->>'contrato', x->>'previsto', x->>'implantado', x->>'tem', x->>'filial'
--     FROM jsonb_array_elements(public.ope_efet_previsto_planilha()) x
--    ORDER BY 1;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar rh_ac_painel e ope_efet_previsto_planilha da mig
-- 20261027000020; depois:
--   DROP FUNCTION IF EXISTS public.rh_ac_pessoas_posto();
