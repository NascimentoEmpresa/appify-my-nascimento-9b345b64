-- =========================================================================
-- SIS-2026-0886 — SST › ASO Periódico: afastados saem das pendências
-- (18/11/2026, pedido da Milena / SST)
--
-- O PEDIDO: "os colaboradores que estejam afastados, seja por aposentadoria,
-- benefício do INSS ou licença-maternidade, não sejam incluídos na relação de
-- exames periódicos pendentes de agendamento" — durante o afastamento não há
-- periódico a fazer, e eles inflavam Vencidos/Próximos/Aguardando.
--
-- ATÉ AQUI: a mig 20261117020000 (SIS-2026-0918) dizia, de propósito,
-- "Afastados (férias, auxílio, licença) continuam na lista: o vínculo está
-- ativo e o vencimento corre". Esta migration troca essa decisão SÓ para os
-- três motivos pedidos. Férias, atestado, licença-paternidade, licença sem
-- remuneração e demais situações continuam na lista como antes.
--
-- DE ONDE VEM O AFASTAMENTO (as duas fontes que a SST já usa):
--   1. Situação ATUAL da Senior — public."EMPREGADOS"."Situação" (descrição
--      da BiEmpregados.sitafa, sincronizada de 15 em 15 min) e
--      "Data Afastamento" (início). É a mesma coluna que alimenta o Controle
--      de Afastamentos (sst_ctrl_afa_capturar_senior) e a régua
--      sst_afa_tipo_da_situacao. Classificação POR TEXTO, como lá — o código
--      numérico da Senior não é estável entre bases (ver mig
--      20261113000100, código 079 criado sem descrição):
--        APOSENT | INVALIDEZ                → aposentadoria
--        MATERN                             → licença-maternidade
--        AUX | DOEN | INSS | BENEF | ACIDENT | PREVID → benefício do INSS
--      e NÃO entram: Trabalhando, aviso prévio, desligado, FÉRIAS, ATESTADO
--      e "doença até 15 dias"/"primeiros 15 dias" (período pago pela
--      empresa, ainda não é benefício do INSS).
--   2. Controle de Afastamentos do ERP ("SST_CTRL_AFASTAMENTO", SIS-2026-0767):
--      caso em aberto ("Afastado", "Auxílio-doença", "Licença-maternidade",
--      sem retorno real) com motivo Auxílio-doença / Acidente de trabalho /
--      Licença-maternidade ou marcado "aposentado afastado". Vale quando a
--      Senior mostra uma situação de afastamento genérica (licença,
--      "afastamento", código sem descrição) — nunca contra "Trabalhando",
--      "Férias" ou "Atestado": a folha manda. É também de lá que sai a
--      PREVISÃO DE RETORNO (data_prevista_retorno, senão a informada no
--      último contato).
--
-- REGRA DO STATUS (repetida em src/lib/sst/asoPeriodico.ts, com teste):
--   afastado + ciclo agendado          → Agendado (continua visível)
--   afastado + periódico em dia        → Realizado/recebido (continua)
--   afastado + qualquer outro status   → "Afastado" (fora do painel de
--                                        pendências; aparece na aba Afastados)
--   Nada é gravado: o cálculo é na hora. Quando a Senior volta a
--   "Trabalhando" (ou o caso do Controle de Afastamentos é encerrado), a
--   pessoa volta sozinha para Vencido/Próximo/Aguardando. O ciclo já aberto
--   (solicitado, sem data) não é apagado — reaparece como "Aguardando
--   agendamento" no retorno.
--
-- A lista ganha a chave 'afastamento' ({motivo, situacao, desde,
-- previsao_retorno, fonte}) em todo afastado — inclusive nos agendados.
--
-- A exclusão de MEI/terceiros (SIS-2026-0918 Parte 2) não é tocada aqui.
-- Aditiva e idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Situação da Senior → motivo de afastamento que tira do periódico ──
-- NULL = continua no periódico (inclui férias e atestado).
CREATE OR REPLACE FUNCTION public.sst_aso_per_motivo_afastamento(p_sit text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN COALESCE(btrim(p_sit), '') = '' OR btrim(p_sit) ~* '^TRABALHANDO$' THEN NULL
    WHEN p_sit ~* 'AVISO' OR p_sit ~* '^(DEMIT|DESLIG|RESCIS)' THEN NULL
    WHEN p_sit ~* '(F[EÉ]RIAS|FERIAS)' THEN NULL
    WHEN p_sit ~* '(APOSENT|INVALIDEZ)' THEN 'aposentadoria'
    WHEN p_sit ~* 'MATERN' THEN 'licenca_maternidade'
    WHEN p_sit ~* 'ATEST' THEN NULL
    WHEN p_sit ~* '(AT[EÉ]\s*15|15\s*DIAS|PRIMEIROS)' THEN NULL
    WHEN p_sit ~* '(AUX|DOEN|INSS|BENEF|ACIDENT|PREVID)' THEN 'beneficio_inss'
    ELSE NULL
  END
$$;

-- ── 2. Quem está afastado HOJE por um dos três motivos ───────────────────
-- Um por empregado (EMPREGADOS."ID"); a lista casa pelo empregado_id que
-- sst_aso_per_base escolheu para o CPF (que já prefere a linha
-- "Trabalhando" — vínculo novo ativo não é tirado por um antigo afastado).
CREATE OR REPLACE FUNCTION public.sst_aso_per_afastados()
RETURNS TABLE (empregado_id bigint, motivo text, situacao text, desde date, previsao_retorno date, fonte text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ctrl AS MATERIALIZED (
    SELECT DISTINCT ON (a.empregado_id) a.empregado_id, a.data_inicio,
           COALESCE(a.data_prevista_retorno, a.retorno_informado_em) AS previsao,
           CASE WHEN a.aposentado_afastado THEN 'aposentadoria'
                WHEN a.motivo = 'Licença-maternidade' OR a.status = 'Licença-maternidade' THEN 'licenca_maternidade'
                WHEN a.motivo IN ('Auxílio-doença', 'Acidente de trabalho') OR a.status = 'Auxílio-doença' THEN 'beneficio_inss'
           END AS motivo
      FROM public."SST_CTRL_AFASTAMENTO" a
     WHERE a.status IN ('Afastado', 'Auxílio-doença', 'Licença-maternidade')
       AND a.data_retorno_real IS NULL
       AND a.data_inicio <= current_date
     ORDER BY a.empregado_id, a.data_inicio DESC, a.id DESC
  ), emp AS (
    SELECT e."ID" AS empregado_id, btrim(e."Situação") AS situacao,
           public.sst_aso_per_motivo_afastamento(e."Situação") AS motivo_senior,
           public.sst_afa_tipo_da_situacao(e."Situação") AS tipo_afa,
           public.rh_data(e."Data Afastamento"::text) AS desde
      FROM public."EMPREGADOS" e
     WHERE COALESCE(btrim(e."Situação"), '') NOT IN ('', 'Trabalhando')
  )
  SELECT m.empregado_id,
         COALESCE(m.motivo_senior, c.motivo),
         m.situacao,
         COALESCE(m.desde, c.data_inicio),
         c.previsao,
         CASE WHEN m.motivo_senior IS NOT NULL THEN 'senior' ELSE 'controle_afastamentos' END
    FROM emp m
    LEFT JOIN ctrl c ON c.empregado_id = m.empregado_id
   WHERE m.motivo_senior IS NOT NULL
      OR (c.motivo IS NOT NULL AND m.tipo_afa IN ('licenca', 'afastamento', 'auxilio_doenca', 'acidente_trabalho'))
$$;
REVOKE ALL ON FUNCTION public.sst_aso_per_afastados() FROM PUBLIC, anon, authenticated;

-- ── 3. Status final: afastado sai das pendências ─────────────────────────
CREATE OR REPLACE FUNCTION public.sst_aso_per_status_afastado(p_status text, p_afastado boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_afastado AND p_status NOT IN ('Agendado', 'Realizado/recebido') THEN 'Afastado' ELSE p_status END
$$;

-- ── 4. Lista (mesma da 20261117020000 + afastamento) ─────────────────────
CREATE OR REPLACE FUNCTION public.sst_aso_per_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_aviso integer := (SELECT dias_aviso FROM public.sst_aso_per_cfg());
BEGIN
  PERFORM public.sst_aso_per_exige('visualizar');
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'cpf', b.cpf, 'empregado_id', b.empregado_id, 'nome', b.nome, 'situacao', b.situacao,
             'filial_nome', b.filial_nome, 'contrato_id', b.contrato_id, 'contrato_nome', b.contrato_nome, 'cargo', b.cargo,
             'admissao', b.admissao, 'ultimo_aso', b.ultimo_aso, 'ultimo_tipo', b.ultimo_tipo,
             'periodicidade_meses', b.periodicidade_meses, 'periodicidade_origem', b.periodicidade_origem,
             'vencimento', b.vencimento,
             'status', public.sst_aso_per_status_afastado(
                         public.sst_aso_per_status(b.vencimento, b.ultimo_tipo, c.id IS NOT NULL, c.agendado_para, current_date, v_aviso),
                         af.motivo IS NOT NULL),
             'afastamento', CASE WHEN af.motivo IS NOT NULL THEN jsonb_build_object(
               'motivo', af.motivo, 'situacao', af.situacao, 'desde', af.desde,
               'previsao_retorno', af.previsao_retorno, 'fonte', af.fonte) END,
             'ciclo', CASE WHEN c.id IS NOT NULL THEN to_jsonb(c) - 'created_by' END,
             'ultimo_periodico', CASE WHEN b.ultimo_tipo = 'periodico' THEN (
               SELECT to_jsonb(p) - 'created_by' FROM public."SST_ASO_PERIODICO" p
                WHERE p.cpf = b.cpf AND p.realizado ORDER BY p.realizado_em DESC, p.id DESC LIMIT 1) END)
           ORDER BY b.vencimento NULLS FIRST, b.nome)
      FROM public.sst_aso_per_base() b
      LEFT JOIN public."SST_ASO_PERIODICO" c ON c.cpf = b.cpf AND NOT c.realizado
      LEFT JOIN public.sst_aso_per_afastados() af ON af.empregado_id = b.empregado_id), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_per_lista() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (afastados voltam às pendências, como na 20261117020000)
-- =========================================================================
-- -- recriar public.sst_aso_per_lista() exatamente como na seção 5 da
-- -- 20261117020000 (sem o JOIN de sst_aso_per_afastados e sem 'afastamento'), e então:
-- DROP FUNCTION IF EXISTS public.sst_aso_per_status_afastado(text, boolean),
--   public.sst_aso_per_afastados(), public.sst_aso_per_motivo_afastamento(text);
-- NOTIFY pgrst, 'reload schema';
