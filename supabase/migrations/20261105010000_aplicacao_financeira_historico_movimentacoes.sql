-- ============================================================================
-- [SEM-CHAMADO] Histórico nas Movimentações da Aplicação Financeira (duplo clique, como no Fluxo de Caixa)
-- ============================================================================
-- A tela de Aplicações Financeiras só tinha histórico das APLICAÇÕES da carteira (APLICACAO_FINANCEIRA_EVENTO). Os RESGATES, que se editam, mudam de
-- banco (em massa) e se excluem, não deixavam rastro. Esta migration:
--
--   1. APLICACAO_FINANCEIRA_RESGATE_EVENTO: o que aconteceu com cada resgate (criação, edição campo a campo, exclusão), com autor e data. Sem FK para o
--      resgate de propósito: o histórico sobrevive à exclusão. É alimentado por um TRIGGER na tabela dos resgates, então pega a edição pela tela, a
--      definição de banco em massa e a exclusão sem mexer em nenhuma RPC.
--   2. Carga dos resgates que já existem: um evento "criação" na data em que foram registrados.
--   3. aplicacao_financeira_historico_movimento(_tipo, _id): lê o histórico de uma linha da tela, com o nome de quem fez, para os 3 tipos de
--      linha das Movimentações: 'aplicacao' (eventos da carteira), 'resgate' (eventos novos) e 'importado' (a linha do Fluxo de Caixa importada da
--      planilha: origem, ajustes e rateio feitos no Fluxo). Exige 'financeiro-aplicacao-financeira' › visualizar (não exige acesso ao Fluxo).
--
-- Migration leve (1 tabela, 1 trigger, 2 funções, carga de poucas dezenas de linhas): pode rodar inteira. Idempotente.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_historico_movimento(text, uuid);
--   DROP TRIGGER IF EXISTS aplicacao_resgate_evento_trg ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA";
--   DROP FUNCTION IF EXISTS public.aplicacao_resgate_registrar_evento();
--   DROP TABLE IF EXISTS public."APLICACAO_FINANCEIRA_RESGATE_EVENTO";
--   NOTIFY pgrst, 'reload schema';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resgate_id uuid NOT NULL,                 -- sem FK: o histórico fica depois que o resgate é excluído
  numero text,
  tipo_evento text NOT NULL CHECK (tipo_evento IN ('criacao', 'edicao', 'exclusao')),
  ator_user_id uuid,
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aplicacao_resgate_evento_resgate ON public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" (resgate_id, created_at);

ALTER TABLE public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aplicacao_resgate_evento_select ON public."APLICACAO_FINANCEIRA_RESGATE_EVENTO";
CREATE POLICY aplicacao_resgate_evento_select ON public."APLICACAO_FINANCEIRA_RESGATE_EVENTO"
  FOR SELECT TO authenticated
  USING ((SELECT public.can_access((SELECT auth.uid()), 'financeiro-aplicacao-financeira', 'visualizar')));
GRANT SELECT ON public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" TO authenticated;

-- ── Trigger: registra criação, cada campo alterado e exclusão ────────────────
CREATE OR REPLACE FUNCTION public.aplicacao_resgate_registrar_evento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_msgs text[] := ARRAY[]::text[];
  v_banco_ant text;
  v_banco_novo text;
  fmt text := 'FM999G999G990D00';
  v_atual text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" (resgate_id, numero, tipo_evento, ator_user_id, descricao)
    VALUES (NEW.id, NEW.numero, 'criacao', COALESCE(auth.uid(), NEW.created_by),
            'Resgate registrado: principal R$ ' || to_char(NEW.valor_principal, fmt) || ' + rendimento R$ ' || to_char(COALESCE(NEW.valor_rendimento, 0), fmt)
            || ' em ' || to_char(NEW.data_resgate, 'DD/MM/YYYY')
            || COALESCE(' · ' || (SELECT nome FROM public.malote_cartao_banco WHERE id = NEW.banco_id), ' · sem banco informado'));
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" (resgate_id, numero, tipo_evento, ator_user_id, descricao)
    VALUES (OLD.id, OLD.numero, 'exclusao', auth.uid(),
            'Resgate excluído: principal R$ ' || to_char(OLD.valor_principal, fmt) || ' + rendimento R$ ' || to_char(COALESCE(OLD.valor_rendimento, 0), fmt)
            || ' de ' || to_char(OLD.data_resgate, 'DD/MM/YYYY'));
    RETURN OLD;
  END IF;

  -- UPDATE: uma linha com cada campo que mudou (antes → depois)
  IF NEW.data_resgate IS DISTINCT FROM OLD.data_resgate THEN
    v_msgs := v_msgs || ('Data: ' || to_char(OLD.data_resgate, 'DD/MM/YYYY') || ' → ' || to_char(NEW.data_resgate, 'DD/MM/YYYY'));
  END IF;
  IF NEW.valor_principal IS DISTINCT FROM OLD.valor_principal THEN
    v_msgs := v_msgs || ('Principal: R$ ' || to_char(OLD.valor_principal, fmt) || ' → R$ ' || to_char(NEW.valor_principal, fmt));
  END IF;
  IF NEW.valor_rendimento IS DISTINCT FROM OLD.valor_rendimento THEN
    v_msgs := v_msgs || ('Rendimento: R$ ' || to_char(COALESCE(OLD.valor_rendimento, 0), fmt) || ' → R$ ' || to_char(COALESCE(NEW.valor_rendimento, 0), fmt));
  END IF;
  IF NEW.banco_id IS DISTINCT FROM OLD.banco_id THEN
    SELECT nome INTO v_banco_ant FROM public.malote_cartao_banco WHERE id = OLD.banco_id;
    SELECT nome INTO v_banco_novo FROM public.malote_cartao_banco WHERE id = NEW.banco_id;
    v_msgs := v_msgs || ('Banco: ' || COALESCE(v_banco_ant, 'sem banco') || ' → ' || COALESCE(v_banco_novo, 'sem banco'));
  END IF;
  IF NEW.observacao IS DISTINCT FROM OLD.observacao THEN
    v_msgs := v_msgs || ('Observação: ' || COALESCE(NULLIF(btrim(OLD.observacao), ''), '(vazia)') || ' → ' || COALESCE(NULLIF(btrim(NEW.observacao), ''), '(vazia)'));
  END IF;

  IF array_length(v_msgs, 1) IS NULL THEN RETURN NEW; END IF;
  v_atual := array_to_string(v_msgs, ' · ');
  INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" (resgate_id, numero, tipo_evento, ator_user_id, descricao)
  VALUES (NEW.id, NEW.numero, 'edicao', COALESCE(auth.uid(), NEW.updated_by), v_atual);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.aplicacao_resgate_registrar_evento() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aplicacao_resgate_evento_trg ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA";
CREATE TRIGGER aplicacao_resgate_evento_trg
  AFTER INSERT OR UPDATE OR DELETE ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"
  FOR EACH ROW EXECUTE FUNCTION public.aplicacao_resgate_registrar_evento();

-- ── Carga: os resgates que já existem ganham o evento de criação (na data em que foram registrados) ──
INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" (resgate_id, numero, tipo_evento, ator_user_id, descricao, created_at)
SELECT r.id, r.numero, 'criacao', r.created_by,
       'Resgate registrado: principal R$ ' || to_char(r.valor_principal, 'FM999G999G990D00') || ' + rendimento R$ ' || to_char(COALESCE(r.valor_rendimento, 0), 'FM999G999G990D00')
       || ' em ' || to_char(r.data_resgate, 'DD/MM/YYYY') || ' (registro anterior ao histórico; valores de hoje)',
       r.created_at
  FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" r
 WHERE NOT EXISTS (SELECT 1 FROM public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" e WHERE e.resgate_id = r.id);

-- ── Leitura do histórico de uma linha das Movimentações ─────────────────────
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_historico_movimento(_tipo text, _id uuid)
RETURNS TABLE (quando timestamptz, fonte text, tipo text, descricao text, usuario text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_despesa uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver as Aplicações Financeiras.';
  END IF;

  IF _tipo = 'aplicacao' THEN
    RETURN QUERY
    SELECT ev.created_at, 'Aplicação'::text, ev.tipo_evento::text, ev.descricao::text,
           (SELECT p.display_name FROM public.profiles p WHERE p.id = ev.ator_user_id)::text
      FROM public."APLICACAO_FINANCEIRA_EVENTO" ev
     WHERE ev.aplicacao_id = _id
     ORDER BY ev.created_at DESC;

  ELSIF _tipo = 'resgate' THEN
    RETURN QUERY
    SELECT ev.created_at, 'Resgate'::text, ev.tipo_evento::text, ev.descricao::text,
           (SELECT p.display_name FROM public.profiles p WHERE p.id = ev.ator_user_id)::text
      FROM public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" ev
     WHERE ev.resgate_id = _id
     ORDER BY ev.created_at DESC;

  ELSIF _tipo = 'importado' THEN
    -- linha do Fluxo importada da planilha: _id é a linha (linha_id); o histórico do Fluxo é pelo grupo de rateio (despesa_id)
    SELECT v.despesa_id INTO v_despesa FROM public.v_fluxo_caixa_importado_fluxo_caixa v WHERE v.linha_id = _id LIMIT 1;
    IF v_despesa IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT x.quando, x.fonte, x.tipo, x.descricao, x.usuario FROM (
      SELECT min(fi.created_at) AS quando, 'Planilha'::text AS fonte, 'importado'::text AS tipo,
             ('Importado da planilha (linha ' || min(fi.planilha_linha) FILTER (WHERE fi.planilha_linha < 800000001) || ')'
               || COALESCE(' — ' || min(fi.observacao_importacao) FILTER (WHERE fi.planilha_linha < 800000001), ''))::text AS descricao,
             NULL::text AS usuario
        FROM public.fluxo_caixa_importado fi
       WHERE COALESCE(fi.rateio_grupo_id, fi.id) = v_despesa
      HAVING count(*) > 0
      UNION ALL
      SELECT h.created_at, 'Fluxo de Caixa', 'ajuste_' || h.operacao,
             (CASE h.operacao WHEN 'criado' THEN 'Ajuste criado' WHEN 'alterado' THEN 'Ajuste alterado' ELSE 'Ajuste desfeito' END)::text,
             COALESCE(h.usuario_nome, 'banco de dados (' || h.usuario_banco || ')')
        FROM public.financeiro_fluxo_caixa_ajuste_historico h
       WHERE h.origem = 'importacao_historica' AND h.despesa_id = v_despesa AND h.numero_parcela IS NULL
      UNION ALL
      SELECT e.created_at, 'Fluxo de Caixa', e.tipo, e.descricao::text,
             COALESCE(e.usuario_nome, 'banco de dados (' || e.usuario_banco || ')')
        FROM public.financeiro_fluxo_caixa_evento e
       WHERE e.origem = 'importacao_historica' AND e.despesa_id = v_despesa AND e.numero_parcela IS NULL
    ) x
    ORDER BY x.quando DESC NULLS LAST;

  ELSE
    RAISE EXCEPTION 'Tipo de movimentação inválido.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.aplicacao_financeira_historico_movimento(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_historico_movimento(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
