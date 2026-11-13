-- SIS-2026-0877 — Fluxo de Caixa: ratear um Débito Automático (ex.: DA-2026-0821, cartão de crédito lançado como "Retirada de Sócios")
-- ============================================================================
-- Hoje o Débito Automático tem UM contrato e UMA classificação. Pedido: poder ratear no próprio Fluxo, como já se faz com as linhas importadas
-- da planilha (botão "Ratear" da linha) e como o Malote faz (uma linha por cota).
--
-- Modelo (igual ao do Malote): DEBITO_AUTOMATICO_RATEIO guarda as cotas (contrato, classificação e valor). v_debito_automatico_fluxo_caixa passa a
-- devolver UMA LINHA POR COTA quando o lançamento tem rateio (mesmo despesa_id: a tela já agrupa e mostra "Rateio" abrindo cada cota). Sem rateio, a
-- linha sai exatamente como antes. O lançamento original (DEBITO_AUTOMATICO) NÃO muda, nem a tela Débito Automático: o rateio vale para o Fluxo.
--   • contrato_id nulo na cota = "Sem contrato (administrativo)"; classificacao_id nula = usa a do lançamento (ou a ajustada no Fluxo).
--   • o contrato da cota tem que ser da MESMA empresa do lançamento (mesma regra da troca de contrato do Fluxo).
--   • valor do ajuste (financeiro_fluxo_caixa_ajuste.valor) não se aplica às cotas: o valor de cada uma é o da cota.
--
-- RPC fluxo_caixa_debito_ratear(_debito_id, _cotas jsonb): ação "incluir" do Fluxo (a mesma do Ratear das importadas). _cotas = [{"contrato_id":
-- uuid|null, "classificacao_id": uuid|null, "valor": 123.45}, ...]; a soma tem que fechar o valor do lançamento. Para refazer, manda as novas cotas; com
-- 1 cota só o rateio é DESFEITO (a linha volta a ser única, no contrato da cota). Registra o evento no histórico da linha ('rateio_criado' / 'rateio_alterado'
-- / 'rateio_desfeito', que o CHECK de financeiro_fluxo_caixa_evento já aceita) e na linha do tempo do Débito Automático.
-- Só Débito Automático (tipo_origem 'debito_automatico') já pago (é o que aparece no Fluxo).
--
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_debito_ratear(uuid, jsonb);
--   (recriar v_debito_automatico_fluxo_caixa como em 20261113005000, sem rateio_erp e sem o join de cotas)
--   DROP TABLE IF EXISTS public."DEBITO_AUTOMATICO_RATEIO";
--   NOTIFY pgrst, 'reload schema';

-- 1) cotas do rateio
CREATE TABLE IF NOT EXISTS public."DEBITO_AUTOMATICO_RATEIO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debito_id uuid NOT NULL REFERENCES public."DEBITO_AUTOMATICO"(id) ON DELETE CASCADE,
  contrato_id uuid REFERENCES public.contratos(id),
  classificacao_id uuid REFERENCES public.planejamento_orcamentario_classificacao(id),
  valor numeric(14,2) NOT NULL CHECK (valor <> 0),
  ordem integer NOT NULL DEFAULT 0,
  created_by uuid,   -- sem FK em auth.users: o usuário do pgAdmin não tem REFERENCES nessa tabela e é só campo de auditoria
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS debito_automatico_rateio_debito_id_idx ON public."DEBITO_AUTOMATICO_RATEIO" (debito_id);
CREATE INDEX IF NOT EXISTS debito_automatico_rateio_contrato_id_idx ON public."DEBITO_AUTOMATICO_RATEIO" (contrato_id);
CREATE INDEX IF NOT EXISTS debito_automatico_rateio_classificacao_id_idx ON public."DEBITO_AUTOMATICO_RATEIO" (classificacao_id);

ALTER TABLE public."DEBITO_AUTOMATICO_RATEIO" ENABLE ROW LEVEL SECURITY;
-- Leitura como a do próprio Débito Automático (a view do Fluxo roda como quem consulta). Escrita só pela RPC (SECURITY DEFINER).
DROP POLICY IF EXISTS debito_automatico_rateio_select ON public."DEBITO_AUTOMATICO_RATEIO";
CREATE POLICY debito_automatico_rateio_select ON public."DEBITO_AUTOMATICO_RATEIO" FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'financeiro-debito-automatico', 'visualizar'::public.app_acao)));

-- 2) a view do Fluxo: uma linha por cota (mesma definição de 20261113005000; mudam o JOIN das cotas, contrato/classificação/valor e a coluna
--    rateio_erp no fim, que a tela usa para oferecer "Refazer rateio")
CREATE OR REPLACE VIEW public.v_debito_automatico_fluxo_caixa AS
SELECT d.id AS despesa_id,
    d.numero AS id_malote,
    COALESCE(aj.data_pagamento, d.data_pagamento) AS data_pagamento,
    COALESCE(aj.competencia, d.competencia) AS competencia,
    COALESCE(aj.empresa_id, d.empresa_id) AS empresa_id,
    COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
    CASE WHEN r.id IS NULL THEN d.contrato_id ELSE r.contrato_id END AS contrato_id,
    CASE WHEN r.id IS NOT NULL AND r.contrato_id IS NULL THEN 'Sem contrato (administrativo)' ELSE c.nome END AS contrato_nome,
    CASE WHEN r.id IS NULL THEN COALESCE(aj.classificacao_id, d.classificacao_id)
         ELSE COALESCE(r.classificacao_id, aj.classificacao_id, d.classificacao_id) END AS classificacao_id,
    cl.nome AS classificacao_nome,
    COALESCE(aj.descricao, d.descricao) AS descricao,
    COALESCE(aj.forma_pagamento, d.forma_pagamento) AS forma_pagamento,
    COALESCE(aj.banco_id, d.banco_id) AS banco_id,
    cb.nome AS banco_nome,
    cb.logo_path AS banco_logo_path,
    NULL::integer AS numero_parcela,
    NULL::integer AS numero_parcelas,
    CASE WHEN r.id IS NULL THEN COALESCE(aj.valor, d.valor) ELSE r.valor END AS valor,
    COALESCE(aj.tipo, d.tipo) AS tipo,
    'debito_automatico'::text AS origem,
    aj.id IS NOT NULL AS ajustado,
    d.integrante_empregado_id,
    CASE
      WHEN d.integrante_empregado_id IS NULL THEN NULL::text
      ELSE fluxo_integrante_nome(d.integrante_empregado_id)
    END AS integrante_nome,
    (r.id IS NOT NULL) AS rateio_erp
   FROM "DEBITO_AUTOMATICO" d
     LEFT JOIN "DEBITO_AUTOMATICO_RATEIO" r ON r.debito_id = d.id
     LEFT JOIN financeiro_fluxo_caixa_ajuste aj ON aj.origem = 'debito_automatico'::text AND aj.despesa_id = d.id AND aj.numero_parcela IS NULL
     LEFT JOIN empresas e ON e.id = COALESCE(aj.empresa_id, d.empresa_id)
     LEFT JOIN contratos c ON c.id = CASE WHEN r.id IS NULL THEN d.contrato_id ELSE r.contrato_id END
     LEFT JOIN planejamento_orcamentario_classificacao cl ON cl.id = CASE WHEN r.id IS NULL THEN COALESCE(aj.classificacao_id, d.classificacao_id)
                                                                          ELSE COALESCE(r.classificacao_id, aj.classificacao_id, d.classificacao_id) END
     LEFT JOIN malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, d.banco_id)
  WHERE d.status = 'pago'::text AND d.deleted_at IS NULL AND NOT (COALESCE(aj.tipo, d.tipo) = 'saida'::text AND fn_debito_coberto_por_fatura_importada(COALESCE(aj.forma_pagamento, d.forma_pagamento), COALESCE(aj.competencia, d.competencia), COALESCE(aj.data_pagamento, d.data_pagamento)));

ALTER VIEW public.v_debito_automatico_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_debito_automatico_fluxo_caixa TO authenticated;

-- 3) ratear / refazer / desfazer
CREATE OR REPLACE FUNCTION public.fluxo_caixa_debito_ratear(_debito_id uuid, _cotas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_d public."DEBITO_AUTOMATICO"%ROWTYPE;
  v_existentes integer;
  v_total numeric(14,2);
  v_soma numeric(14,2) := 0;
  v_n integer;
  v_cota jsonb;
  v_contrato uuid;
  v_classif uuid;
  v_valor numeric(14,2);
  v_i integer := 0;
  v_detalhe jsonb;
  v_antes jsonb;
  v_tipo text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para ratear lançamentos do Fluxo de Caixa.';
  END IF;
  IF _cotas IS NULL OR jsonb_typeof(_cotas) <> 'array' OR jsonb_array_length(_cotas) = 0 THEN
    RAISE EXCEPTION 'Informe as cotas do rateio.';
  END IF;
  v_n := jsonb_array_length(_cotas);

  SELECT * INTO v_d FROM public."DEBITO_AUTOMATICO" WHERE id = _debito_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Débito automático não encontrado.'; END IF;
  IF v_d.tipo_origem <> 'debito_automatico' THEN
    RAISE EXCEPTION 'Só Débito Automático pode ser rateado (movimentação financeira e nota recebida não).';
  END IF;
  IF v_d.status <> 'pago' THEN RAISE EXCEPTION 'Só lançamento já pago aparece no Fluxo de Caixa e pode ser rateado.'; END IF;

  SELECT count(*), COALESCE(sum(valor), 0) INTO v_existentes, v_total FROM public."DEBITO_AUTOMATICO_RATEIO" WHERE debito_id = _debito_id;
  IF v_existentes = 0 THEN
    SELECT COALESCE(aj.valor, v_d.valor) INTO v_total
      FROM (SELECT 1) x
      LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
        ON aj.origem = 'debito_automatico' AND aj.despesa_id = _debito_id AND aj.numero_parcela IS NULL;
    IF v_n < 2 THEN RAISE EXCEPTION 'Para ratear, informe ao menos 2 cotas.'; END IF;
  END IF;

  FOR v_cota IN SELECT * FROM jsonb_array_elements(_cotas) LOOP
    v_valor := round(COALESCE((v_cota->>'valor')::numeric, 0), 2);
    IF v_valor = 0 THEN RAISE EXCEPTION 'Toda cota precisa ter valor diferente de zero.'; END IF;
    IF sign(v_valor) <> sign(v_total) THEN RAISE EXCEPTION 'Todas as cotas precisam ter o mesmo sinal do valor do lançamento.'; END IF;
    v_contrato := NULLIF(v_cota->>'contrato_id', '')::uuid;
    IF v_contrato IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = v_contrato AND empresa_id = v_d.empresa_id) THEN
      RAISE EXCEPTION 'O contrato da cota não existe ou pertence a outra empresa. Escolha contratos da mesma empresa do lançamento.';
    END IF;
    v_classif := NULLIF(v_cota->>'classificacao_id', '')::uuid;
    IF v_classif IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao WHERE id = v_classif) THEN
      RAISE EXCEPTION 'Classificação da cota não encontrada.';
    END IF;
    v_soma := v_soma + v_valor;
  END LOOP;
  IF abs(v_soma - v_total) > 0.005 THEN
    RAISE EXCEPTION 'A soma das cotas (R$ %) precisa ser igual ao valor do lançamento (R$ %).', v_soma, v_total;
  END IF;

  -- Para o histórico: o rateio de antes e o de depois (contrato, classificação e valor de cada cota).
  SELECT jsonb_agg(jsonb_build_object('contrato', COALESCE(c.nome, 'Sem contrato (administrativo)'), 'classificacao', cl.nome, 'valor', r.valor) ORDER BY r.ordem)
    INTO v_antes
    FROM public."DEBITO_AUTOMATICO_RATEIO" r
    LEFT JOIN public.contratos c ON c.id = r.contrato_id
    LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = r.classificacao_id
   WHERE r.debito_id = _debito_id;
  SELECT jsonb_build_object('valor_total', v_total, 'antes', v_antes,
           'depois', (SELECT jsonb_agg(jsonb_build_object(
                         'contrato', COALESCE((SELECT nome FROM public.contratos WHERE id = NULLIF(e->>'contrato_id', '')::uuid), 'Sem contrato (administrativo)'),
                         'classificacao', (SELECT nome FROM public.planejamento_orcamentario_classificacao WHERE id = NULLIF(e->>'classificacao_id', '')::uuid),
                         'valor', (e->>'valor')::numeric))
                      FROM jsonb_array_elements(_cotas) e))
    INTO v_detalhe;

  DELETE FROM public."DEBITO_AUTOMATICO_RATEIO" WHERE debito_id = _debito_id;

  IF v_n = 1 THEN
    -- Desfazer: a linha volta a ser única, no contrato da cota (a classificação segue a do lançamento).
    v_contrato := NULLIF((_cotas->0)->>'contrato_id', '')::uuid;
    UPDATE public."DEBITO_AUTOMATICO" SET contrato_id = v_contrato WHERE id = _debito_id;
    v_tipo := 'rateio_desfeito';
    PERFORM public.fluxo_caixa_registrar_evento('debito_automatico', _debito_id, v_tipo, 'Rateio desfeito: a linha voltou a ser única', v_detalhe);
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (_debito_id, 'edicao', auth.uid(), 'Rateio desfeito pelo Fluxo de Caixa: o lançamento voltou a ser único.');
    RETURN;
  END IF;

  FOR v_cota IN SELECT * FROM jsonb_array_elements(_cotas) LOOP
    v_i := v_i + 1;
    INSERT INTO public."DEBITO_AUTOMATICO_RATEIO" (debito_id, contrato_id, classificacao_id, valor, ordem, created_by)
    VALUES (_debito_id, NULLIF(v_cota->>'contrato_id', '')::uuid, NULLIF(v_cota->>'classificacao_id', '')::uuid, round((v_cota->>'valor')::numeric, 2), v_i, auth.uid());
  END LOOP;

  v_tipo := CASE WHEN v_existentes > 0 THEN 'rateio_alterado' ELSE 'rateio_criado' END;
  PERFORM public.fluxo_caixa_registrar_evento('debito_automatico', _debito_id, v_tipo,
    CASE WHEN v_existentes > 0 THEN 'Rateio refeito em ' || v_n || ' cotas' ELSE 'Linha rateada em ' || v_n || ' cotas' END, v_detalhe);
  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_debito_id, 'edicao', auth.uid(),
          CASE WHEN v_existentes > 0 THEN 'Rateio refeito pelo Fluxo de Caixa em ' || v_n || ' cotas.' ELSE 'Lançamento rateado pelo Fluxo de Caixa em ' || v_n || ' cotas.' END);
END;
$$;
REVOKE ALL ON FUNCTION public.fluxo_caixa_debito_ratear(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_debito_ratear(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
