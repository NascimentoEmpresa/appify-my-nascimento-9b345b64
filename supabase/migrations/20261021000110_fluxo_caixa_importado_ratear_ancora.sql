-- [SEM-CHAMADO] Fluxo de Caixa: a função fluxo_caixa_importado_ratear falhava no cluster com
--   ERROR: invalid input syntax for type uuid: "(ba29b378-...,8355,,saida,...)"   (22P02, na linha da âncora)
-- Causa: `SELECT l INTO v_ancora FROM unnest(v_linhas) l` devolve UMA coluna composta e o PL/pgSQL tentava gravá-la no primeiro campo
-- (o id, uuid) da variável de linha. Provavelmente o Postgres do cluster (18) é mais estrito que o da Supabase, onde a função foi escrita e
-- testada. Com `SELECT l.*` a linha é expandida nas colunas e cai nos campos certos. Mais nada muda: o resto da função é o da migration 20261015000010.
-- Isto quebrava o botão "Ratear" da tela do Fluxo de Caixa (linhas importadas) e qualquer carga de rateio pela função.
-- (O nome do arquivo diz "ancora"; a migration também acerta a sequência das cotas, ver o fim.)

CREATE OR REPLACE FUNCTION public.fluxo_caixa_importado_ratear(_despesa_id uuid, _cotas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_linhas public.fluxo_caixa_importado[];
  v_ancora public.fluxo_caixa_importado;
  v_extras uuid[];
  v_agrupada boolean;
  v_total numeric(14,2);
  v_soma numeric(14,2) := 0;
  v_grupo uuid;
  v_codigo text;
  v_cota jsonb;
  v_i integer := 0;
  v_n integer;
  v_contrato uuid;
  v_valor numeric(14,2);
  v_texto text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Fluxo de Caixa.';
  END IF;
  IF _cotas IS NULL OR jsonb_typeof(_cotas) <> 'array' OR jsonb_array_length(_cotas) = 0 THEN
    RAISE EXCEPTION 'Informe as cotas do rateio.';
  END IF;
  v_n := jsonb_array_length(_cotas);

  -- linhas ativas do lançamento (avulso = 1 linha; rateio = 1 por cota)
  PERFORM 1 FROM public.fluxo_caixa_importado fi
   WHERE COALESCE(fi.rateio_grupo_id, fi.id) = _despesa_id
     AND fi.deleted_at IS NULL
     AND fi.conferencia <> 'ja_existe_no_erp'
     FOR UPDATE;

  SELECT array_agg(fi ORDER BY fi.planilha_linha) INTO v_linhas
    FROM public.fluxo_caixa_importado fi
   WHERE COALESCE(fi.rateio_grupo_id, fi.id) = _despesa_id
     AND fi.deleted_at IS NULL
     AND fi.conferencia <> 'ja_existe_no_erp';
  IF v_linhas IS NULL THEN
    RAISE EXCEPTION 'Lançamento importado não encontrado.';
  END IF;

  v_agrupada := (v_linhas[1]).rateio_grupo_id IS NOT NULL;
  IF v_agrupada AND EXISTS (SELECT 1 FROM unnest(v_linhas) l WHERE NOT l.rateio_erp) THEN
    RAISE EXCEPTION 'Este rateio veio da planilha e não é alterado por aqui. Só rateios criados no ERP podem ser refeitos.';
  END IF;
  IF NOT v_agrupada AND v_n < 2 THEN
    RAISE EXCEPTION 'Para ratear, informe ao menos 2 cotas.';
  END IF;

  -- âncora = a linha original (a que veio da planilha); as demais cotas só existem por causa do rateio
  SELECT l.* INTO v_ancora FROM unnest(v_linhas) AS l WHERE l.planilha_linha < 800000001 ORDER BY l.planilha_linha LIMIT 1;
  IF v_ancora.id IS NULL THEN
    RAISE EXCEPTION 'Linha original do rateio não encontrada.';
  END IF;
  SELECT array_agg(l.id) INTO v_extras FROM unnest(v_linhas) l WHERE l.id <> v_ancora.id;

  -- valor atual a distribuir: no avulso, o valor mostrado (com o ajuste do Fluxo, se houver); no grupo, a soma das cotas
  IF v_agrupada THEN
    SELECT COALESCE(sum(l.valor), 0) INTO v_total FROM unnest(v_linhas) l;
  ELSE
    SELECT COALESCE(aj.valor, v_ancora.valor) INTO v_total
      FROM (SELECT 1) x
      LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
        ON aj.origem = 'importacao_historica' AND aj.despesa_id = _despesa_id AND aj.numero_parcela IS NULL;
  END IF;

  -- valida as cotas
  FOR v_cota IN SELECT * FROM jsonb_array_elements(_cotas) LOOP
    v_valor := round(COALESCE((v_cota->>'valor')::numeric, 0), 2);
    IF v_valor = 0 THEN RAISE EXCEPTION 'Toda cota precisa ter valor diferente de zero.'; END IF;
    IF sign(v_valor) <> sign(v_total) THEN RAISE EXCEPTION 'Todas as cotas precisam ter o mesmo sinal do valor do lançamento.'; END IF;
    v_contrato := NULLIF(v_cota->>'contrato_id', '')::uuid;
    IF v_contrato IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = v_contrato) THEN
      RAISE EXCEPTION 'Contrato da cota não encontrado.';
    END IF;
    v_soma := v_soma + v_valor;
  END LOOP;
  IF abs(v_soma - v_total) > 0.005 THEN
    RAISE EXCEPTION 'A soma das cotas (R$ %) precisa ser igual ao valor do lançamento (R$ %).', v_soma, v_total;
  END IF;

  -- tira as cotas antigas (todas criadas no ERP, nunca da planilha) e reaplica
  IF v_extras IS NOT NULL THEN
    DELETE FROM public.fluxo_caixa_importado WHERE id = ANY(v_extras) AND rateio_erp;
  END IF;

  -- 1 cota: desfaz o rateio (volta a ser uma linha avulsa, com o valor/ajuste de antes)
  IF v_n = 1 THEN
    v_contrato := NULLIF((_cotas->0)->>'contrato_id', '')::uuid;
    UPDATE public.fluxo_caixa_importado
       SET rateio_grupo_id = NULL, rateio_codigo = NULL, rateio_erp = false,
           valor = COALESCE(rateio_valor_original, v_total), rateio_valor_original = NULL,
           contrato_id = v_contrato,
           contrato_texto = CASE WHEN v_contrato IS NULL THEN 'Sem contrato (administrativo)' ELSE contrato_texto END,
           sem_contrato_confirmado = (v_contrato IS NULL)
     WHERE id = v_ancora.id;
    UPDATE public.financeiro_fluxo_caixa_ajuste SET despesa_id = v_ancora.id
     WHERE origem = 'importacao_historica' AND despesa_id = _despesa_id AND numero_parcela IS NULL AND _despesa_id <> v_ancora.id;
    RETURN;
  END IF;

  v_grupo := COALESCE(v_ancora.rateio_grupo_id, gen_random_uuid());
  v_codigo := COALESCE(v_ancora.rateio_codigo, v_ancora.planilha_id_original, 'IMP-' || lpad(v_ancora.planilha_linha::text, 5, '0'));

  FOR v_cota IN SELECT * FROM jsonb_array_elements(_cotas) LOOP
    v_i := v_i + 1;
    v_contrato := NULLIF(v_cota->>'contrato_id', '')::uuid;
    v_valor := round((v_cota->>'valor')::numeric, 2);
    v_texto := CASE WHEN v_contrato IS NULL THEN 'Sem contrato (administrativo)'
                    ELSE (SELECT nome FROM public.contratos WHERE id = v_contrato) END;
    IF v_i = 1 THEN
      UPDATE public.fluxo_caixa_importado
         SET rateio_grupo_id = v_grupo, rateio_codigo = v_codigo, rateio_erp = true,
             rateio_valor_original = COALESCE(v_ancora.rateio_valor_original, v_ancora.valor),
             contrato_id = v_contrato, contrato_texto = v_texto, valor = v_valor,
             sem_contrato_confirmado = (v_contrato IS NULL)
       WHERE id = v_ancora.id;
    ELSE
      INSERT INTO public.fluxo_caixa_importado (
        planilha_linha, planilha_id_original, tipo, data_pagamento, competencia, empresa_id,
        contrato_id, contrato_texto, classificacao_id, classificacao_texto, descricao, forma_pagamento,
        banco_id, banco_texto, valor, conferencia, conferencia_ref, observacao_importacao,
        rateio_codigo, rateio_grupo_id, rateio_valor_original, rateio_erp, sem_contrato_confirmado, created_by
      ) VALUES (
        nextval('public.fluxo_caixa_importado_linha_erp_seq'), v_ancora.planilha_id_original, v_ancora.tipo, v_ancora.data_pagamento, v_ancora.competencia, v_ancora.empresa_id,
        v_contrato, v_texto, v_ancora.classificacao_id, v_ancora.classificacao_texto, v_ancora.descricao, v_ancora.forma_pagamento,
        v_ancora.banco_id, v_ancora.banco_texto, v_valor, v_ancora.conferencia, v_ancora.conferencia_ref, v_ancora.observacao_importacao,
        v_codigo, v_grupo, COALESCE(v_ancora.rateio_valor_original, v_ancora.valor), true, (v_contrato IS NULL), auth.uid()
      );
    END IF;
  END LOOP;

  -- o ajuste do Fluxo (data, banco, classificação...) passa a valer para o grupo todo
  IF v_grupo <> _despesa_id THEN
    UPDATE public.financeiro_fluxo_caixa_ajuste SET despesa_id = v_grupo
     WHERE origem = 'importacao_historica' AND despesa_id = _despesa_id AND numero_parcela IS NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fluxo_caixa_importado_ratear(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_importado_ratear(uuid, jsonb) TO authenticated;

-- Segundo problema do cluster: a sequência que numera as cotas criadas pelo rateio (fluxo_caixa_importado_linha_erp_seq, START 800000001)
-- estava num valor baixo depois da restauração do banco (a próxima cota recebia planilha_linha = 6, que já existe na planilha:
-- "duplicate key ... fluxo_caixa_importado_planilha_linha_key"). Só empurra a sequência PARA FRENTE, como infra/ha/reparar-dre-e-sequencias.sh.
SELECT setval('public.fluxo_caixa_importado_linha_erp_seq',
  GREATEST(800000000,
           COALESCE((SELECT max(planilha_linha) FROM public.fluxo_caixa_importado WHERE planilha_linha >= 800000001), 0),
           (SELECT last_value FROM public.fluxo_caixa_importado_linha_erp_seq)),
  true);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar a função da migration 20261015000010_fluxo_caixa_importado_excluir_e_ratear.sql (BLOCO 4).
