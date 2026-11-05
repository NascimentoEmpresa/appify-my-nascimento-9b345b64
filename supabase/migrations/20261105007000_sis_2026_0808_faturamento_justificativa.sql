-- ============================================================================
-- SIS-2026-0808 — Chat de justificativa dos contratos não faturados (Controle de Faturamento)
-- ============================================================================
-- O Controle de Faturamento mostra os contratos vigentes ainda não faturados na competência, mas não havia onde
-- perguntar o porquê aos responsáveis nem guardar a conversa. Cada contrato + competência passa a ter um CHAT:
--
--   1. faturamento_justificativa_mensagem : cada mensagem (autor, texto, destinatário opcional); ninguém edita nem apaga
--   2. faturamento_justificativa_enviar   : RPC que grava a mensagem e avisa no sino quem participa da conversa
--   3. ação 'responder' no menu controle-faturamento (catálogo): quem pode escrever no chat. Quem só tem
--      'visualizar' lê a conversa, não escreve.
--
-- Quem é avisado: o destinatário escolhido na mensagem ("perguntar a") e todos que já participaram daquele chat
-- (escreveram ou foram perguntados antes), menos quem está enviando.
-- Leitura: 'controle-faturamento' › 'visualizar'. Nenhuma escrita direta na tabela (só pela RPC).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.faturamento_justificativa_enviar(uuid, date, text, uuid);
--   DROP TABLE IF EXISTS public.faturamento_justificativa_mensagem;
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'controle-faturamento' AND acao = 'responder';
--   NOTIFY pgrst, 'reload schema';

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES ('controle-faturamento', 'responder')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.faturamento_justificativa_mensagem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos(id),
  competencia date NOT NULL CHECK (competencia = date_trunc('month', competencia)::date),
  autor_id uuid NOT NULL,
  destinatario_id uuid,                       -- "perguntar a": quem foi chamado a responder (sem FK: nem sempre o cadastro acompanha o login)
  texto text NOT NULL CHECK (length(btrim(texto)) >= 2 AND length(texto) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS faturamento_justificativa_mensagem_chat
  ON public.faturamento_justificativa_mensagem (contrato_id, competencia, created_at);
CREATE INDEX IF NOT EXISTS faturamento_justificativa_mensagem_competencia
  ON public.faturamento_justificativa_mensagem (competencia, created_at DESC);

ALTER TABLE public.faturamento_justificativa_mensagem ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS faturamento_justificativa_mensagem_select ON public.faturamento_justificativa_mensagem;
CREATE POLICY faturamento_justificativa_mensagem_select ON public.faturamento_justificativa_mensagem
  FOR SELECT TO authenticated
  USING ((SELECT public.can_access((SELECT auth.uid()), 'controle-faturamento', 'visualizar')));

GRANT SELECT ON public.faturamento_justificativa_mensagem TO authenticated;

CREATE OR REPLACE FUNCTION public.faturamento_justificativa_enviar(_contrato_id uuid, _competencia date, _texto text, _destinatario_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_texto text := btrim(coalesce(_texto, ''));
  v_comp date;
  v_id uuid;
  v_contrato text;
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(v_uid, 'controle-faturamento', 'responder') THEN
    RAISE EXCEPTION 'Sem permissão para escrever no chat do Controle de Faturamento.';
  END IF;
  IF _contrato_id IS NULL OR _competencia IS NULL THEN
    RAISE EXCEPTION 'Informe o contrato e a competência.';
  END IF;
  IF length(v_texto) < 2 THEN RAISE EXCEPTION 'Escreva a mensagem.'; END IF;
  IF length(v_texto) > 2000 THEN RAISE EXCEPTION 'A mensagem pode ter no máximo 2000 caracteres.'; END IF;

  SELECT nome INTO v_contrato FROM public.contratos WHERE id = _contrato_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado.'; END IF;
  v_comp := date_trunc('month', _competencia)::date;

  -- Avisa o destinatário e quem já participou do chat (antes de gravar a nova mensagem), menos quem envia.
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT DISTINCT p.uid,
         CASE WHEN p.uid = _destinatario_id THEN 'Pergunta sobre faturamento: ' ELSE 'Nova mensagem sobre faturamento: ' END || v_contrato,
         to_char(v_comp, 'MM/YYYY') || ' · ' || left(v_texto, 140),
         'faturamento_justificativa',
         '/app/financeiro/controle-faturamento?chat=' || _contrato_id || '&competencia=' || v_comp
    FROM (
      SELECT autor_id AS uid FROM public.faturamento_justificativa_mensagem WHERE contrato_id = _contrato_id AND competencia = v_comp
      UNION
      SELECT destinatario_id FROM public.faturamento_justificativa_mensagem WHERE contrato_id = _contrato_id AND competencia = v_comp AND destinatario_id IS NOT NULL
      UNION
      SELECT _destinatario_id WHERE _destinatario_id IS NOT NULL
    ) p
   WHERE p.uid IS DISTINCT FROM v_uid;

  INSERT INTO public.faturamento_justificativa_mensagem (contrato_id, competencia, autor_id, destinatario_id, texto)
  VALUES (_contrato_id, v_comp, v_uid, _destinatario_id, v_texto)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.faturamento_justificativa_enviar(uuid, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.faturamento_justificativa_enviar(uuid, date, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
