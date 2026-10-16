-- [SEM-CHAMADO] Fluxo de Caixa: excluir linhas importadas da planilha e ratear linhas que não são rateadas.
--
-- Pedido (urgente): "permitir a exclusão de linhas do fluxo importadas" e "ratear linhas que não são rateadas".
--
-- EXCLUIR: exclusão lógica (fluxo_caixa_importado.deleted_at, que a view já respeita), agora com quem excluiu
-- (deleted_by). Aparece na Lixeira do Fluxo e pode ser restaurada. As linhas que a carga/conferência já tinham
-- marcado como excluídas (deleted_by nulo) NÃO aparecem na lixeira nem podem ser restauradas por aqui.
--
-- RATEAR: uma linha importada avulsa vira um grupo de cotas (mesmo modelo dos rateios que vieram da planilha:
-- várias linhas com o mesmo rateio_grupo_id; a tela já agrupa e abre "Rateio"). A 1ª cota fica na própria linha; as
-- demais nascem como cópias (marcadas rateio_erp = true, com planilha_linha de uma faixa própria, a partir de
-- 800000001, para nunca colidir com a carga). O ajuste feito no Fluxo (data, banco, classificação...) acompanha
-- o grupo. Para refazer o rateio (ou desfazê-lo, com 1 cota só) vale o mesmo: só rateios criados no ERP; o que veio
-- rateado da planilha não é alterado por aqui.
--
-- Permissão: a mesma de editar o Fluxo (financeiro-fluxo-caixa-gestao › alterar). Esse menu não tem a ação
-- "excluir" concedida a ninguém, e não vale criar uma permissão nova para uma urgência.
--
-- Migrations não se auto-aplicam: rodar no SQL Editor, um BLOCO por vez (BLOCO 1 a 5).

SET lock_timeout = '5s';

-- BLOCO 1 ─ colunas e faixa de numeração
ALTER TABLE public.fluxo_caixa_importado
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rateio_erp boolean NOT NULL DEFAULT false;

CREATE SEQUENCE IF NOT EXISTS public.fluxo_caixa_importado_linha_erp_seq START 800000001;

-- BLOCO 2 ─ view: mesma definição de 20261007000005, com rateio_erp no fim (a tela só edita rateio criado no ERP)
CREATE OR REPLACE VIEW public.v_fluxo_caixa_importado_fluxo_caixa AS
SELECT
  COALESCE(fi.rateio_grupo_id, fi.id) AS despesa_id,
  COALESCE(fi.rateio_codigo, fi.planilha_id_original, 'IMP-' || lpad(fi.planilha_linha::text, 5, '0')) AS id_malote,
  COALESCE(aj.data_pagamento, fi.data_pagamento) AS data_pagamento,
  COALESCE(aj.competencia, fi.competencia) AS competencia,
  COALESCE(aj.empresa_id, fi.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  fi.contrato_id,
  COALESCE(c.nome, CASE WHEN fi.rateio_grupo_id IS NOT NULL THEN NULLIF(fi.contrato_texto, '') END) AS contrato_nome,
  COALESCE(aj.classificacao_id, fi.classificacao_id) AS classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(aj.descricao, fi.descricao) AS descricao,
  COALESCE(aj.forma_pagamento, fi.forma_pagamento) AS forma_pagamento,
  COALESCE(aj.banco_id, fi.banco_id) AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  CASE WHEN fi.rateio_grupo_id IS NOT NULL THEN fi.valor ELSE COALESCE(aj.valor, fi.valor) END AS valor,
  COALESCE(aj.tipo, fi.tipo) AS tipo,
  'importacao_historica'::text AS origem,
  (aj.id IS NOT NULL) AS ajustado,
  NULLIF(concat_ws(' · ',
    CASE WHEN fi.contrato_id IS NULL AND fi.rateio_grupo_id IS NULL AND NOT fi.sem_contrato_confirmado
      THEN 'Contrato não mapeado (planilha: ' || COALESCE(NULLIF(fi.contrato_texto, ''), '—') || ')' END,
    CASE WHEN COALESCE(aj.classificacao_id, fi.classificacao_id) IS NULL
      THEN 'Classificação não mapeada (planilha: ' || COALESCE(NULLIF(fi.classificacao_texto, ''), '—') || ')' END,
    CASE WHEN fi.conferencia = 'possivel_duplicidade' OR fi.observacao_importacao LIKE 'Rateio % sem cotas%'
      THEN fi.observacao_importacao END
  ), '') AS inconsistencia,
  fi.id AS linha_id,
  fi.rateio_erp AS rateio_erp
FROM public.fluxo_caixa_importado fi
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = 'importacao_historica' AND aj.despesa_id = COALESCE(fi.rateio_grupo_id, fi.id) AND aj.numero_parcela IS NULL
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, fi.empresa_id)
LEFT JOIN public.contratos c ON c.id = fi.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(aj.classificacao_id, fi.classificacao_id)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, fi.banco_id)
WHERE fi.deleted_at IS NULL AND fi.conferencia <> 'ja_existe_no_erp';

ALTER VIEW public.v_fluxo_caixa_importado_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_fluxo_caixa_importado_fluxo_caixa TO authenticated;

-- BLOCO 3 ─ excluir e restaurar (p_despesa_id = o despesa_id da linha na tela: id da linha ou do grupo de rateio)
CREATE OR REPLACE FUNCTION public.fluxo_caixa_importado_excluir(_despesa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Fluxo de Caixa.';
  END IF;

  UPDATE public.fluxo_caixa_importado
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE COALESCE(rateio_grupo_id, id) = _despesa_id
     AND deleted_at IS NULL
     AND conferencia <> 'ja_existe_no_erp';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Lançamento importado não encontrado (ou já excluído).';
  END IF;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.fluxo_caixa_importado_restaurar(_despesa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Fluxo de Caixa.';
  END IF;

  UPDATE public.fluxo_caixa_importado
     SET deleted_at = NULL, deleted_by = NULL
   WHERE COALESCE(rateio_grupo_id, id) = _despesa_id
     AND deleted_at IS NOT NULL
     AND deleted_by IS NOT NULL;           -- só o que um usuário excluiu pela tela
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Nada para restaurar.';
  END IF;
  RETURN v_n;
END;
$$;

-- BLOCO 4 ─ ratear
-- _cotas: [{"contrato_id": "<uuid>" | null, "valor": 123.45}, ...] — a soma tem que ser igual ao valor atual da linha.
-- contrato_id nulo = cota "sem contrato (administrativo)". Com 1 cota só, DESFAZ um rateio criado no ERP.
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
  SELECT l INTO v_ancora FROM unnest(v_linhas) l WHERE l.planilha_linha < 800000001 ORDER BY l.planilha_linha LIMIT 1;
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

-- BLOCO 5 ─ permissões
REVOKE ALL ON FUNCTION public.fluxo_caixa_importado_excluir(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fluxo_caixa_importado_restaurar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fluxo_caixa_importado_ratear(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_importado_excluir(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_importado_restaurar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_importado_ratear(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_importado_ratear(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_importado_restaurar(uuid);
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_importado_excluir(uuid);
--   (recriar a view com a definição de 20261007000005_fluxo_caixa_importado_sem_contrato.sql)
--   -- desfazer os rateios feitos no ERP ANTES de remover as colunas: refazer cada um com 1 cota
--   DROP SEQUENCE IF EXISTS public.fluxo_caixa_importado_linha_erp_seq;
--   ALTER TABLE public.fluxo_caixa_importado DROP COLUMN IF EXISTS rateio_erp, DROP COLUMN IF EXISTS deleted_by;
--   NOTIFY pgrst, 'reload schema';
