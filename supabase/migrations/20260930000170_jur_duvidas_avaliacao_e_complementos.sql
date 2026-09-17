-- =========================================================================
-- Parecer Jurídico: quem perguntou AVALIA a resposta e CONTINUA PERGUNTANDO
--
-- PEDIDO (17/09/2026, Pablo)
--   "Melhorar o Parecer Jurídico: o usuário que perguntou avalia a resposta
--   do Jurídico e pode continuar perguntando para tirar dúvidas,
--   complementando a resposta."
--
-- ATÉ AQUI
--   Uma dúvida era pergunta → aprovação → UMA resposta → biblioteca. Quem
--   perguntou não tinha como dizer se a resposta serviu, nem como pedir um
--   esclarecimento sem abrir outra dúvida do zero (que passaria por
--   aprovação de novo e viraria outro item na biblioteca).
--
-- O QUE MUDA
--   1. AVALIAÇÃO em JUR_DUVIDAS: `avaliacao` (resolveu / parcial / nao_resolveu),
--      `avaliacao_comentario`, `avaliado_em`. Só o AUTOR avalia, só depois de
--      respondida, e por RPC (jur_duvida_avaliar) — a policy de UPDATE da
--      tabela continua só para quem aprova/responde; não dá para abrir uma
--      policy de UPDATE "só nessas colunas" pro autor sem ele conseguir
--      mexer no resto.
--   2. COMPLEMENTOS em JUR_DUVIDAS_COMPLEMENTOS: a conversa que continua
--      depois da resposta. `tipo` = 'pergunta' (autor da dúvida) ou
--      'resposta' (quem responde). A pergunta complementar NÃO passa por
--      aprovação: a dúvida já foi aprovada e o assunto é o mesmo. A dúvida
--      continua 'Respondida' e na biblioteca; a tela sabe que há complemento
--      pendente porque o último item do fio é uma 'pergunta'.
--      A biblioteca pública mostra o fio sem o nome de quem perguntou, como
--      já faz com a pergunta original.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Avaliação ──────────────────────────────────────────────────────────
ALTER TABLE public."JUR_DUVIDAS"
  ADD COLUMN IF NOT EXISTS avaliacao            text,
  ADD COLUMN IF NOT EXISTS avaliacao_comentario text,
  ADD COLUMN IF NOT EXISTS avaliado_em          timestamptz;

ALTER TABLE public."JUR_DUVIDAS" DROP CONSTRAINT IF EXISTS jur_duvidas_avaliacao_chk;
ALTER TABLE public."JUR_DUVIDAS" ADD CONSTRAINT jur_duvidas_avaliacao_chk
  CHECK (avaliacao IS NULL OR avaliacao IN ('resolveu', 'parcial', 'nao_resolveu'));

COMMENT ON COLUMN public."JUR_DUVIDAS".avaliacao IS
  'Avaliação de quem perguntou sobre a resposta do Jurídico: resolveu / parcial / nao_resolveu. Gravada só pela RPC jur_duvida_avaliar.';

CREATE OR REPLACE FUNCTION public.jur_duvida_avaliar(p_id bigint, p_avaliacao text, p_comentario text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_autor uuid;
  v_status text;
BEGIN
  IF p_avaliacao NOT IN ('resolveu', 'parcial', 'nao_resolveu') THEN
    RAISE EXCEPTION 'Avaliação inválida: %', p_avaliacao;
  END IF;
  SELECT autor_id, status INTO v_autor, v_status FROM public."JUR_DUVIDAS" WHERE id = p_id;
  IF v_autor IS NULL OR v_autor <> auth.uid() THEN
    RAISE EXCEPTION 'Só quem fez a pergunta pode avaliar a resposta.';
  END IF;
  IF v_status <> 'Respondida' THEN
    RAISE EXCEPTION 'A dúvida ainda não foi respondida.';
  END IF;
  UPDATE public."JUR_DUVIDAS"
     SET avaliacao = p_avaliacao,
         avaliacao_comentario = nullif(btrim(coalesce(p_comentario, '')), ''),
         avaliado_em = now(),
         updated_at = now()
   WHERE id = p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.jur_duvida_avaliar(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jur_duvida_avaliar(bigint, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.jur_duvida_avaliar(bigint, text, text) TO authenticated;

-- ── 2) Complementos (a conversa depois da resposta) ──────────────────────
CREATE TABLE IF NOT EXISTS public."JUR_DUVIDAS_COMPLEMENTOS" (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  duvida_id  bigint NOT NULL REFERENCES public."JUR_DUVIDAS"(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('pergunta', 'resposta')),
  texto      text NOT NULL,
  autor_id   uuid DEFAULT auth.uid(),
  autor_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jur_duvidas_compl_duvida_idx ON public."JUR_DUVIDAS_COMPLEMENTOS"(duvida_id, id);

COMMENT ON TABLE public."JUR_DUVIDAS_COMPLEMENTOS" IS
  'Fio de complementos de uma dúvida jurídica já respondida: pergunta (autor da dúvida) e resposta (Jurídico), em ordem. Sem aprovação — a dúvida já foi aprovada.';

ALTER TABLE public."JUR_DUVIDAS_COMPLEMENTOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public."JUR_DUVIDAS_COMPLEMENTOS" TO authenticated;

-- Leitura: igual à dúvida (biblioteca pública; a tela esconde o nome).
DROP POLICY IF EXISTS jur_duvidas_compl_select ON public."JUR_DUVIDAS_COMPLEMENTOS";
CREATE POLICY jur_duvidas_compl_select ON public."JUR_DUVIDAS_COMPLEMENTOS"
  FOR SELECT TO authenticated USING (true);

-- Pergunta complementar: só o autor da dúvida, e só depois de respondida.
-- Resposta complementar: só quem responde dúvidas (setor JURIDICO ou
-- JUR_DUVIDAS_RESPONSAVEIS), a mesma régua da resposta principal.
DROP POLICY IF EXISTS jur_duvidas_compl_insert ON public."JUR_DUVIDAS_COMPLEMENTOS";
CREATE POLICY jur_duvidas_compl_insert ON public."JUR_DUVIDAS_COMPLEMENTOS"
  FOR INSERT TO authenticated WITH CHECK (
    autor_id = auth.uid()
    AND (
      (tipo = 'pergunta' AND EXISTS (
        SELECT 1 FROM public."JUR_DUVIDAS" d
         WHERE d.id = duvida_id AND d.autor_id = auth.uid() AND d.status = 'Respondida'))
      OR (tipo = 'resposta' AND public.pode_responder_duvida())
    )
  );

-- Apagar: quem responde (limpeza), ou o próprio autor do item.
DROP POLICY IF EXISTS jur_duvidas_compl_delete ON public."JUR_DUVIDAS_COMPLEMENTOS";
CREATE POLICY jur_duvidas_compl_delete ON public."JUR_DUVIDAS_COMPLEMENTOS"
  FOR DELETE TO authenticated USING (autor_id = auth.uid() OR public.pode_responder_duvida());

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TABLE IF EXISTS public."JUR_DUVIDAS_COMPLEMENTOS";
-- DROP FUNCTION IF EXISTS public.jur_duvida_avaliar(bigint, text, text);
-- ALTER TABLE public."JUR_DUVIDAS" DROP CONSTRAINT IF EXISTS jur_duvidas_avaliacao_chk;
-- ALTER TABLE public."JUR_DUVIDAS"
--   DROP COLUMN IF EXISTS avaliacao, DROP COLUMN IF EXISTS avaliacao_comentario, DROP COLUMN IF EXISTS avaliado_em;
-- NOTIFY pgrst, 'reload schema';
