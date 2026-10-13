-- =========================================================================
-- MALOTE › APROVAÇÕES — PONTO DO FALTANTE NAS DESPESAS DE DIÁRIA (14/10/2026)
-- SIS-2026-0626 (Gustavo Barcelos, Operacional)
--
-- PEDIDO: "que no meu login seja disponibilizado, assim como para os
-- supervisores, um campo onde informe se o colaborador está com o ponto
-- batido no dia de lançamento das diárias" — título do chamado: "Aprovação
-- do malote com a observação se o ponto está registrado no dia".
--
-- O Controle de Diárias já mostra isso (mig 20261007000021 / 20261013000001:
-- selo "Bateu ponto" e as batidas do relógio). Mas depois de aprovada a
-- diária vira DESPESA DO MALOTE (DIARIA_SOLICITACAO.malote_despesa_id) e é
-- aprovada em Malote › Aprovações, que não mostrava nada do ponto.
--
-- diaria_ponto_malote(despesas): para as despesas pedidas que vieram de
-- diária, cada dia da diária com as batidas do faltante no relógio
-- (diaria_ponto_minutos — a mesma conta do Controle de Diárias), o número da
-- solicitação, faltante, contrato/posto e se o faltante tem matrícula no
-- relógio. Só AVISA: quem aprova decide (como no Controle de Diárias desde a
-- mig 20261013000001).
--
-- Acesso: quem vê Aprovações do Malote, a despesa do Malote ou o Controle de
-- Diárias. Sem tela nova (nada em app_menu): é um bloco das telas que já
-- existem, com a liberação delas.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.diaria_ponto_malote(p_despesas uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (public.can_access(auth.uid(), 'malote_aprovacoes', 'visualizar'::public.app_acao)
       OR public.can_access(auth.uid(), 'malote_despesa_visualizar', 'visualizar'::public.app_acao)
       OR public.diaria_pode('visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem acesso às despesas do Malote.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_despesas), 0) = 0 THEN
    RETURN jsonb_build_object('sincronizado_ate', public.diaria_ponto_sincronizado_ate(), 'itens', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'sincronizado_ate', public.diaria_ponto_sincronizado_ate(),
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'despesa_id', s.malote_despesa_id,
               'solicitacao_id', s.id,
               'numero', s.numero,
               'faltante_nome', s.faltante_nome,
               'contrato_nome', s.contrato_nome,
               'posto_nome', s.posto_nome,
               'tem_vinculo', EXISTS (
                 SELECT 1 FROM public."EMPREGADOS" e
                  WHERE length(regexp_replace(coalesce(s.faltante_cpf, ''), '\D', '', 'g')) = 11
                    AND regexp_replace(coalesce(e."CPF"::text, ''), '\D', '', 'g') = regexp_replace(coalesce(s.faltante_cpf, ''), '\D', '', 'g')
                    AND btrim(e."Cadastro"::text) ~ '^[0-9]+$' AND btrim(e."Empresa"::text) ~ '^[0-9]+$'),
               'dias', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('data', l.data, 'turno', l.turno,
                                                     'minutos', to_jsonb(public.diaria_ponto_minutos(s.faltante_cpf, l.data)))
                                  ORDER BY l.data, l.turno)
                   FROM public."DIARIA_LINHA" l WHERE l.solicitacao_id = s.id), '[]'::jsonb))
             ORDER BY s.numero)
        FROM public."DIARIA_SOLICITACAO" s
       WHERE s.malote_despesa_id = ANY (p_despesas[1:300])
         AND s.status NOT IN ('excluida')), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.diaria_ponto_malote(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ponto_malote(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.diaria_ponto_malote(uuid[]);
