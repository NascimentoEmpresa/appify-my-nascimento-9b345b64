-- =========================================================================
-- SIS-2026-0918 (retorno do solicitante) — SST › ASO Periódico: MEI fora
-- (19/11/2026)
--
-- O RELATO: "Os MEI´s continuam aparecendo. Preciso que sejam retirados da
-- contagem dos periódicos os colaboradores em situação de aposentadoria, aux
-- doença, licença maternidade e os que são MEIs".
--
-- VERIFICADO NO CÓDIGO: sst_aso_per_base (mig 20261117020000) lê toda linha
-- de "EMPREGADOS" que não está desligada — nada separa o MEI. O MEI não é
-- empregado da folha (não tem PCMSO nem ASO pela empresa), então ele entrava
-- como "Vencido"/"Próximo" sem motivo.
--   Aposentadoria, auxílio-doença/INSS e licença-maternidade já saem das
--   pendências pela mig 20261119190000 (SIS-2026-0886). O que ainda sobrava
--   (afastado com periódico agendado/realizado contando em Previstos,
--   Agendados e Realizados) é resolvido no front (contarPainel, em
--   src/lib/sst/asoPeriodico.ts) — a lista do banco não muda para isso.
--
-- COMO O MEI É RECONHECIDO: a mesma régua que o RH já usa para deixar o MEI
-- fora da importação e da exportação (src/lib/rh/mei.ts, 18/09/2026) — uma
-- das colunas de tipo de contrato/categoria da linha contém a sigla MEI
-- (palavra inteira) ou "MICROEMPREEND". Na EMPREGADOS de hoje é
-- "TIPO DE CONTRATO" = 'MEI' (~10 linhas, cadastradas no ERP, sem par na
-- Senior — ver migs 20260909000010 e 20261007000001). As colunas são lidas
-- por to_jsonb(linha): coluna que não existir vira NULL em vez de derrubar a
-- migration.
--
-- O filtro é por LINHA, antes de escolher o vínculo do CPF: quem tem uma
-- linha MEI e outra CLT ativa continua, pelo vínculo CLT.
--
-- O QUE MUDA: função nova sst_aso_per_eh_mei(jsonb) e sst_aso_per_base com o
-- filtro (mesma assinatura e retorno — CREATE OR REPLACE). Lista, painel,
-- configuração (contagem por contrato) e abertura de ciclo passam todos por
-- ela, então o MEI sai de tudo.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. A régua do MEI (espelho de src/lib/rh/mei.ts) ─────────────────────
CREATE OR REPLACE FUNCTION public.sst_aso_per_eh_mei(p_linha jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM unnest(ARRAY['TIPO DE CONTRATO', 'Descrição (T. Contrato)', 'Descrição (Tipo)',
                        'Descrição (Categoria Contribuinte)', 'Descrição (Cat. eSocial)',
                        'Descrição (Categoria Sefip)']) AS c(col)
     WHERE p_linha->>c.col ~* '\mMEI\M' OR p_linha->>c.col ~* 'MICROEMPREEND')
$$;

-- ── 2. Base sem MEI (resto idêntico à 20261117020000) ────────────────────
CREATE OR REPLACE FUNCTION public.sst_aso_per_base(p_cpf text DEFAULT NULL)
RETURNS TABLE (cpf text, empregado_id bigint, nome text, situacao text, filial_nome text, contrato_id uuid,
               contrato_nome text, cargo text, admissao date, ultimo_aso date, ultimo_tipo text,
               periodicidade_meses integer, periodicidade_origem text, vencimento date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH cfg AS (SELECT * FROM public.sst_aso_per_cfg()),
  emp AS (
    SELECT DISTINCT ON (x.cpf) x.*
      FROM (SELECT regexp_replace(COALESCE(e."CPF", ''), '\D', '', 'g') AS cpf, e."ID" AS empregado_id,
                   btrim(e."Nome") AS nome, e."Situação" AS situacao, btrim(e."Nome Filial") AS filial_nome,
                   COALESCE(btrim(e."Descrição do Local"), '') AS local_nome,
                   nullif(btrim(e."Título do Cargo"), '') AS cargo, public.rh_data(e."Admissão"::text) AS admissao
              FROM public."EMPREGADOS" e
             WHERE COALESCE(public.sst_afa_tipo_da_situacao(e."Situação"), '') <> 'desligamento'
               -- SIS-2026-0918 (19/11): MEI não é empregado da folha, não tem periódico.
               AND NOT public.sst_aso_per_eh_mei(to_jsonb(e))) x
     WHERE length(x.cpf) = 11 AND (p_cpf IS NULL OR x.cpf = p_cpf)
     ORDER BY x.cpf, (x.situacao = 'Trabalhando') DESC, x.admissao DESC NULLS LAST
  ), com_aso AS (
    SELECT m.*, cl.contrato_id, cl.contrato_nome, pc.periodicidade_meses AS meses_contrato,
           COALESCE(u.data, m.admissao) AS ultimo_aso,
           CASE WHEN u.data IS NOT NULL THEN u.tipo WHEN m.admissao IS NOT NULL THEN 'admissao_estimada' END AS ultimo_tipo
      FROM emp m
      LEFT JOIN public.sst_aso_per_contrato_local() cl ON cl.filial = m.filial_nome AND cl.local = m.local_nome
      LEFT JOIN public."SST_ASO_PERIODICO_CONTRATO" pc ON pc.contrato_id = cl.contrato_id
      LEFT JOIN public.sst_aso_per_ultimos() u ON u.cpf = m.cpf
  )
  SELECT a.cpf, a.empregado_id, a.nome, a.situacao, a.filial_nome, a.contrato_id, a.contrato_nome, a.cargo, a.admissao,
         a.ultimo_aso, a.ultimo_tipo,
         COALESCE(a.meses_contrato, cfg.periodicidade_padrao_meses),
         CASE WHEN a.meses_contrato IS NOT NULL THEN 'contrato' ELSE 'padrao' END,
         (a.ultimo_aso + make_interval(months => COALESCE(a.meses_contrato, cfg.periodicidade_padrao_meses)))::date
    FROM com_aso a CROSS JOIN cfg
$$;
REVOKE ALL ON FUNCTION public.sst_aso_per_base(text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (MEI volta para a lista)
-- =========================================================================
-- -- recriar public.sst_aso_per_base(text) exatamente como na seção 4 da
-- -- 20261117020000 (sem a linha "AND NOT public.sst_aso_per_eh_mei(...)"), e então:
-- DROP FUNCTION IF EXISTS public.sst_aso_per_eh_mei(jsonb);
-- NOTIFY pgrst, 'reload schema';
