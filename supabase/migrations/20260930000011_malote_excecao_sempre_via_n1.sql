-- SIS-2026-0250 (errata, pedido do usuário): "a exceção do mesmo dia
-- pulou direto pra N2. ainda sim ela deveria passar pela avaliação de
-- N1." Confirmado que vale pra QUALQUER exceção, não só mesmo-dia: a
-- 20260930000010 forçava nivel_aprovacao_atual=2 direto na inclusão,
-- pulando o Aprovador Nível 1 inteiro — errado. Correção:
--
--  - Exceção passa a nascer no Nível 1 igual qualquer despesa (comporta-
--    mento padrão do sistema, sem trigger nenhum forçando nível).
--  - N1 avalia normalmente (aprova/reprova/ajusta).
--  - Se N1 APROVAR uma exceção, a escalada pro Nível 2 (ou Carol/Gerente
--    Financeiro como reforço) é OBRIGATÓRIA — não fica sujeita à alçada
--    configurada (aprovador1_sem_limite/limite_pct) como despesa comum.
--    Isso é decidido no próprio malote_aprovar_despesa (servidor), não só
--    confiando no _proximo_nivel_configurado que o client manda.
--  - Carol (malote_gerente_financeiro) só age nas RPCs quando a despesa
--    JÁ está no Nível 2+ (nivel_aprovacao_atual <> 1) — ela é reforço do
--    Nível 2 em diante, nunca um atalho pra pular a avaliação do N1.

-- ── a) Remove o trigger que forçava nível 2 na inclusão ─────────────────
DROP TRIGGER IF EXISTS malote_despesa_forcar_nivel_excecao ON public.malote_despesa;
DROP FUNCTION IF EXISTS public.malote_forcar_nivel_para_excecao();

-- ── b) Backfill: única despesa afetada pela 20260930000010 (nível forçado
--       pra 2 sem ter passado por N1) volta pro Nível 1 ──────────────────
UPDATE public.malote_despesa
SET nivel_aprovacao_atual = 1
WHERE status = 'pendente_aprovacao' AND excecao AND nivel_aprovacao_atual = 2
  AND NOT EXISTS (
    SELECT 1 FROM public.malote_despesa_evento e
    WHERE e.despesa_id = malote_despesa.id AND e.tipo_evento = 'aprovacao_nivel' AND e.nivel = 1
  );

-- ── c) malote_aprovar_despesa: escalada pra exceção é obrigatória quando
--       quem está aprovando é o Nível 1 — não depende de alçada ────────
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
  v_excecao boolean;
  v_escala boolean;
  v_linha jsonb;
BEGIN
  SELECT status, nivel_aprovacao_atual, excecao INTO v_status, v_nivel, v_excecao FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_e_aprovador_do_nivel(_id, v_nivel, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR (v_excecao AND v_nivel <> 1 AND public.malote_gerente_financeiro(auth.uid()))
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta despesa.';
  END IF;

  -- Exceção aprovada pelo Nível 1 escala pro Nível 2 sempre, ignorando a
  -- alçada — a alçada continua valendo pra escalar 2→3 e pra despesa comum.
  v_escala := _proximo_nivel_configurado OR (v_excecao AND v_nivel = 1);

  UPDATE public.malote_despesa SET
    valor_aprovado = _valor_aprovado,
    justificativa_aprovacao = _justificativa,
    forma_pagamento = _forma_pagamento,
    informacoes_pagamento = _informacoes_pagamento,
    data_pagamento = _data_pagamento,
    competencia = _competencia,
    nivel_aprovacao_atual = CASE WHEN v_nivel < 3 AND v_escala THEN v_nivel + 1 ELSE nivel_aprovacao_atual END,
    status = CASE WHEN v_nivel < 3 AND v_escala THEN status ELSE 'aguardando_pagamento' END
  WHERE id = _id;

  IF NOT (v_nivel < 3 AND v_escala) THEN
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

-- ── d) malote_solicitar_ajuste_despesa / malote_reprovar_despesa: Carol só
--       age a partir do Nível 2 (nunca pula a avaliação do N1) ──────────
CREATE OR REPLACE FUNCTION public.malote_solicitar_ajuste_despesa(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
  v_excecao boolean;
BEGIN
  SELECT status, nivel_aprovacao_atual, excecao INTO v_status, v_nivel, v_excecao FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_e_aprovador_do_nivel(_id, v_nivel, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR (v_excecao AND v_nivel <> 1 AND public.malote_gerente_financeiro(auth.uid()))
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para solicitar ajuste nesta despesa.';
  END IF;

  UPDATE public.malote_despesa SET status = 'necessidade_de_ajuste', motivo_ajuste = _motivo WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'necessidade_de_ajuste', _motivo, v_nivel, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_reprovar_despesa(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
  v_excecao boolean;
BEGIN
  SELECT status, nivel_aprovacao_atual, excecao INTO v_status, v_nivel, v_excecao FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status NOT IN ('pendente_aprovacao', 'aguardando_pagamento', 'pronto_para_pagar', 'ajuste_pagamento') THEN
    RAISE EXCEPTION 'Despesa não pode ser reprovada neste status.';
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    (public.malote_pode('aprovar') AND public.malote_sou_aprovador_configurado(_id, auth.uid()))
    OR public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR (v_excecao AND v_nivel IS DISTINCT FROM 1 AND public.malote_gerente_financeiro(auth.uid()))
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para reprovar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET status = 'despesa_reprovada' WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'despesa_reprovada', _motivo, auth.uid());
END;
$$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   -- (c)/(d) voltar pro CREATE OR REPLACE de 20260930000010 (tira o
--   -- v_escala em aprovar, tira o "v_nivel <> 1"/"v_nivel IS DISTINCT
--   -- FROM 1" das 3 RPCs).
--
--   -- (a) recriar malote_forcar_nivel_para_excecao() e o trigger
--   -- malote_despesa_forcar_nivel_excecao, iguais à 20260930000010.
--
--   -- (b) não reversível de forma automática (não sabe reconstruir o
--   -- nível 2 forçado original) — só reaplicando manualmente se preciso.
