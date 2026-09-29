-- PORTAL DO COLABORADOR — Assistente de IA (botão "Tirar dúvida").
--
-- A Edge Function `colaborador-ia` responde dúvidas do colaborador na tela de
-- entrar (/colaborador/entrar, sem sessão) e dentro do portal (com sessão).
-- A tela de entrar é pública: sem limite, qualquer um queimaria os créditos
-- de IA do workspace chamando a função em loop. Esta migration cria só o
-- controle de uso — mesma ideia do COL_PORTAL_TENTATIVA do login (20260930000196).
--
--   • sem sessão → chave 'ip:<ip>'         (limite menor)
--   • com sessão → chave 'emp:<empregado>' (limite maior)
--
-- Tabela e RPC ficam fechadas para anon/authenticated: só a Edge Function
-- (service_role) chama, igual às col_*.

-- ── 1. Tabela de uso ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."COL_PORTAL_IA_USO" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chave text NOT NULL,
  empregado_id bigint,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_col_portal_ia_uso_chave ON public."COL_PORTAL_IA_USO"(chave, criado_em);

ALTER TABLE public."COL_PORTAL_IA_USO" ENABLE ROW LEVEL SECURITY;
-- Sem policy de propósito: nenhum acesso pelo PostgREST.

-- ── 2. RPC: consome uma pergunta se ainda houver cota ─────────────────────
-- Devolve true e registra o uso; false quando a cota da janela acabou.
-- Aproveita a chamada pra limpar registros com mais de 7 dias.
CREATE OR REPLACE FUNCTION public.col_ia_consumir(p_chave text, p_limite int, p_janela_min int, p_emp bigint DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_usos int;
BEGIN
  IF coalesce(p_chave, '') = '' THEN
    RETURN false;
  END IF;

  DELETE FROM public."COL_PORTAL_IA_USO" WHERE criado_em < now() - interval '7 days';

  SELECT count(*) INTO v_usos
    FROM public."COL_PORTAL_IA_USO"
   WHERE chave = p_chave
     AND criado_em > now() - make_interval(mins => p_janela_min);
  IF v_usos >= p_limite THEN
    RETURN false;
  END IF;

  INSERT INTO public."COL_PORTAL_IA_USO"(chave, empregado_id) VALUES (p_chave, p_emp);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.col_ia_consumir(text, int, int, bigint) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.col_ia_consumir(text, int, int, bigint);
--   DROP TABLE IF EXISTS public."COL_PORTAL_IA_USO";
-- =====================================================================
