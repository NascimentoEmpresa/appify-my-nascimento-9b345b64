-- SIS-2026-0236 (pedido do Iury): permitir mais de um aprovador por nível
-- (N1/N2/N3) numa Classificação do Malote — setores com mais de um
-- gerente/supervisor não podem depender de uma pessoa só faltando no dia.
-- aprovadorN_user_id (uuid único) vira aprovadorN_user_ids (uuid[]); o
-- mesmo pro nome denormalizado (aprovadorN_nome -> aprovadorN_nomes),
-- cache calculado no client (ClassificacoesMalote.tsx), não por trigger.
--
-- Backfill preserva 100% do que já está cadastrado (aprovador único vira
-- array de 1 elemento). Colunas antigas são dropadas na mesma migration —
-- só existe UM lugar escrevendo isso (o modal de Classificações), e o
-- código desta mesma PR já passa a ler/escrever só as novas colunas.
ALTER TABLE public.planejamento_orcamentario_classificacao
  ADD COLUMN aprovador1_user_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN aprovador1_nomes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN aprovador2_user_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN aprovador2_nomes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN aprovador3_user_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN aprovador3_nomes text[] NOT NULL DEFAULT '{}';

UPDATE public.planejamento_orcamentario_classificacao SET
  aprovador1_user_ids = CASE WHEN aprovador1_user_id IS NOT NULL THEN ARRAY[aprovador1_user_id] ELSE '{}'::uuid[] END,
  aprovador1_nomes = CASE WHEN aprovador1_nome IS NOT NULL AND aprovador1_nome <> '' THEN ARRAY[aprovador1_nome] ELSE '{}'::text[] END,
  aprovador2_user_ids = CASE WHEN aprovador2_user_id IS NOT NULL THEN ARRAY[aprovador2_user_id] ELSE '{}'::uuid[] END,
  aprovador2_nomes = CASE WHEN aprovador2_nome IS NOT NULL AND aprovador2_nome <> '' THEN ARRAY[aprovador2_nome] ELSE '{}'::text[] END,
  aprovador3_user_ids = CASE WHEN aprovador3_user_id IS NOT NULL THEN ARRAY[aprovador3_user_id] ELSE '{}'::uuid[] END,
  aprovador3_nomes = CASE WHEN aprovador3_nome IS NOT NULL AND aprovador3_nome <> '' THEN ARRAY[aprovador3_nome] ELSE '{}'::text[] END;

ALTER TABLE public.planejamento_orcamentario_classificacao
  DROP COLUMN aprovador1_user_id,
  DROP COLUMN aprovador1_nome,
  DROP COLUMN aprovador2_user_id,
  DROP COLUMN aprovador2_nome,
  DROP COLUMN aprovador3_user_id,
  DROP COLUMN aprovador3_nome;

-- ── RPCs que comparavam o campo direto contra um único uuid ────────────

DROP FUNCTION IF EXISTS public.malote_aprovador_do_nivel(uuid, smallint);

CREATE FUNCTION public.malote_e_aprovador_do_nivel(_despesa_id uuid, _nivel smallint, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE _nivel
    WHEN 1 THEN _user_id = ANY(c.aprovador1_user_ids)
    WHEN 2 THEN _user_id = ANY(c.aprovador2_user_ids)
    WHEN 3 THEN _user_id = ANY(c.aprovador3_user_ids)
    ELSE false
  END
  FROM public.malote_despesa d
  JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
  WHERE d.id = _despesa_id;
$$;

REVOKE ALL ON FUNCTION public.malote_e_aprovador_do_nivel(uuid, smallint, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_e_aprovador_do_nivel(uuid, smallint, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.malote_sou_aprovador_configurado(_despesa_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.malote_despesa d
    JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
    WHERE d.id = _despesa_id
      AND (
        _user_id = ANY(c.aprovador1_user_ids)
        OR _user_id = ANY(c.aprovador2_user_ids)
        OR _user_id = ANY(c.aprovador3_user_ids)
      )
  );
$$;

-- Corpo idêntico ao de 20260921000003_malote_rateio_congela_em_aguardando_pagamento.sql
-- (a versão vigente) — só a checagem de permissão na linha do meio muda,
-- de malote_aprovador_do_nivel(...) = auth.uid() pra
-- malote_e_aprovador_do_nivel(..., auth.uid()).
CREATE OR REPLACE FUNCTION public.malote_aprovar_despesa(
  _id uuid,
  _proximo_nivel_configurado boolean,
  _valor_aprovado numeric,
  _justificativa text,
  _forma_pagamento text,
  _informacoes_pagamento text,
  _data_pagamento date,
  _competencia date,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
  v_linha jsonb;
BEGIN
  SELECT status, nivel_aprovacao_atual INTO v_status, v_nivel FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_e_aprovador_do_nivel(_id, v_nivel, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET
    valor_aprovado = _valor_aprovado,
    justificativa_aprovacao = _justificativa,
    forma_pagamento = _forma_pagamento,
    informacoes_pagamento = _informacoes_pagamento,
    data_pagamento = _data_pagamento,
    competencia = _competencia,
    nivel_aprovacao_atual = CASE WHEN v_nivel < 3 AND _proximo_nivel_configurado THEN v_nivel + 1 ELSE nivel_aprovacao_atual END,
    status = CASE WHEN v_nivel < 3 AND _proximo_nivel_configurado THEN status ELSE 'aguardando_pagamento' END
  WHERE id = _id;

  IF NOT (v_nivel < 3 AND _proximo_nivel_configurado) THEN
    FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
    LOOP
      UPDATE public.malote_despesa_rateio_linha
      SET orcado_snapshot = (v_linha->>'orcado')::numeric,
          utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
          congelado_em = now()
      WHERE id = (v_linha->>'linha_id')::uuid
        AND despesa_id = _id;
    END LOOP;
  END IF;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'aprovacao_nivel', _justificativa, v_nivel, auth.uid());
END;
$$;

-- Corpo idêntico ao de 20260906000002_malote_permissoes_aprovacao.sql —
-- mesma troca pontual na checagem de permissão.
CREATE OR REPLACE FUNCTION public.malote_solicitar_ajuste_despesa(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
BEGIN
  SELECT status, nivel_aprovacao_atual INTO v_status, v_nivel FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_e_aprovador_do_nivel(_id, v_nivel, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para solicitar ajuste nesta despesa.';
  END IF;

  UPDATE public.malote_despesa SET status = 'necessidade_de_ajuste', motivo_ajuste = _motivo WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'necessidade_de_ajuste', _motivo, v_nivel, auth.uid());
END;
$$;

-- ── Suprimentos/NF: participação de recebimento também compara esse campo ──

CREATE OR REPLACE FUNCTION public.sup_receb_usuario_participa(
  p_recebimento_id uuid, p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.recebimento_nf r
      LEFT JOIN public.sup_compra_pedido pc ON pc.id = r.sup_compra_pedido_id
      LEFT JOIN public.malote_despesa d ON d.id = pc.despesa_id
      LEFT JOIN public.planejamento_orcamentario_classificacao c
             ON c.id = d.classificacao_id
     WHERE r.id = p_recebimento_id
       AND (
         r.recebido_por = p_user_id
         OR pc.created_by = p_user_id
         OR d.created_by = p_user_id
         OR d.cotacao_decidida_por = p_user_id
         OR c.aprovador_solicitacao_user_id = p_user_id
         OR p_user_id = ANY(c.aprovador1_user_ids)
         OR p_user_id = ANY(c.aprovador2_user_ids)
         OR p_user_id = ANY(c.aprovador3_user_ids)
         OR (r.status = 'aguardando' AND r.recebido_por IS NULL)
         OR public.can_access(p_user_id, 'recebimentos', 'aprovar')
       )
  );
$$;

REVOKE ALL ON FUNCTION public.sup_receb_usuario_participa(uuid, uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.planejamento_orcamentario_classificacao
--     ADD COLUMN aprovador1_user_id uuid REFERENCES auth.users(id),
--     ADD COLUMN aprovador1_nome text,
--     ADD COLUMN aprovador2_user_id uuid REFERENCES auth.users(id),
--     ADD COLUMN aprovador2_nome text,
--     ADD COLUMN aprovador3_user_id uuid REFERENCES auth.users(id),
--     ADD COLUMN aprovador3_nome text;
--   UPDATE public.planejamento_orcamentario_classificacao SET
--     aprovador1_user_id = aprovador1_user_ids[1], aprovador1_nome = aprovador1_nomes[1],
--     aprovador2_user_id = aprovador2_user_ids[1], aprovador2_nome = aprovador2_nomes[1],
--     aprovador3_user_id = aprovador3_user_ids[1], aprovador3_nome = aprovador3_nomes[1];
--   ALTER TABLE public.planejamento_orcamentario_classificacao
--     DROP COLUMN aprovador1_user_ids, DROP COLUMN aprovador1_nomes,
--     DROP COLUMN aprovador2_user_ids, DROP COLUMN aprovador2_nomes,
--     DROP COLUMN aprovador3_user_ids, DROP COLUMN aprovador3_nomes;
--   -- Recriar malote_aprovador_do_nivel/malote_sou_aprovador_configurado/
--   -- malote_aprovar_despesa/malote_solicitar_ajuste_despesa/
--   -- sup_receb_usuario_participa com a definição de
--   -- 20260906000002_malote_permissoes_aprovacao.sql /
--   -- 20260926000008_receb_participacao_e_supervisao.sql;
--   DROP FUNCTION IF EXISTS public.malote_e_aprovador_do_nivel(uuid, smallint, uuid);
-- =====================================================================
