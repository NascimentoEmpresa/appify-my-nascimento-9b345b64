-- =========================================================================
-- SIS-2026-0886 (parte 2) — SST › ASO Periódico: empresa do vínculo na lista
-- (18/11/2026, pedido da Milena / SST)
--
-- O PEDIDO: "incluídas ... Função/cargo do colaborador; Empresa à qual o
-- colaborador está vinculado". O SST está migrando da plataforma da clínica
-- Zielo (que vai encerrar) e passa a pedir os periódicos direto pelo ERP —
-- a clínica precisa da função e da empresa em cada solicitação.
--
-- A função já vinha (sst_aso_per_base.cargo = "Título do Cargo"); faltava a
-- EMPRESA. Ela vem do mesmo cadastro da Senior que a base já escolheu para o
-- CPF (EMPREGADOS."ID" = empregado_id): "Empresa" (numemp da Senior: 1, 2,
-- 3, 5) e "Nome da Empresa". A sigla (HAGG, SN, CANAÃ, NH) é montada no front
-- pela mesma régua das outras telas de RH (src/lib/rh/colaboradoresUtils.ts,
-- empresaDe / EMPRESA_MAP) — não se repete aqui um segundo mapa.
--
-- sst_aso_per_base NÃO muda (o tipo de retorno ficaria diferente e ela é
-- usada pela configuração); só a lista ganha 'empresa_codigo' e
-- 'empresa_nome'. Tudo o mais é a lista da 20261119190000.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sst_aso_per_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_aviso integer := (SELECT dias_aviso FROM public.sst_aso_per_cfg());
BEGIN
  PERFORM public.sst_aso_per_exige('visualizar');
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'cpf', b.cpf, 'empregado_id', b.empregado_id, 'nome', b.nome, 'situacao', b.situacao,
             'filial_nome', b.filial_nome, 'contrato_id', b.contrato_id, 'contrato_nome', b.contrato_nome, 'cargo', b.cargo,
             'empresa_codigo', nullif(btrim(e."Empresa"::text), ''),
             'empresa_nome', nullif(btrim(e."Nome da Empresa"::text), ''),
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
      LEFT JOIN public."EMPREGADOS" e ON e."ID" = b.empregado_id
      LEFT JOIN public."SST_ASO_PERIODICO" c ON c.cpf = b.cpf AND NOT c.realizado
      LEFT JOIN public.sst_aso_per_afastados() af ON af.empregado_id = b.empregado_id), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_per_lista() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK: recriar public.sst_aso_per_lista() exatamente como na seção 4 da
-- 20261119190000 (sem o JOIN de EMPREGADOS e sem empresa_codigo/empresa_nome)
-- e NOTIFY pgrst, 'reload schema';
-- =========================================================================
