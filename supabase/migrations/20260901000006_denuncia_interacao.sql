-- =====================================================================
-- CANAL DE DENÚNCIAS — conversa, histórico e título do relato
--
-- POR QUE
-- A tratativa era de mão única: o comitê escrevia um `retorno_denunciante`
-- e pronto. Não havia como pedir um detalhe ("em que dia foi?", "quem mais
-- viu?") e receber a resposta, que é justamente o que destrava a maioria das
-- apurações — sobretudo quando o relato veio sem nome.
--
-- O QUE ENTRA
--   1. CANAL_DENUNCIA_MENSAGEM — conversa dos dois lados, com nota interna
--      (visível só para o comitê) no mesmo fio, para o contexto não se perder.
--   2. CANAL_DENUNCIA_EVENTO — trilha automática de mudança de situação,
--      resultado e responsável. Ninguém escreve nela: é gatilho.
--   3. `titulo` no relato — a lista precisa de um assunto legível; protocolo
--      não diz o que é o caso.
--
-- COMO CADA LADO ENTRA
--   · Comitê: RLS pelo menu, como no resto do módulo.
--   · Denunciante: NÃO toca a tabela. Passa por RPC SECURITY DEFINER que
--     confere e-mail + senha a cada chamada — mesma porta do acompanhamento.
--     Sem sessão, sem token, sem cookie.
-- =====================================================================

-- Assunto do caso. Fica FORA da trava de imutabilidade de propósito: é
-- redação do comitê sobre o relato, não é o relato.
ALTER TABLE public."CANAL_DENUNCIA"
  ADD COLUMN IF NOT EXISTS titulo text;

COMMENT ON COLUMN public."CANAL_DENUNCIA".titulo IS
  'Assunto dado pelo comite. O relato em si continua imutavel (canal_denuncia_guard).';

-- ── 1. Conversa ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_MENSAGEM" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denuncia_id   uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  autor         text NOT NULL CHECK (autor IN ('comite', 'denunciante')),
  -- Só preenchido quando quem escreve é do comitê. Do lado do denunciante
  -- fica NULL: ele não tem usuário, e criar um destruiria o desenho.
  autor_user_id uuid REFERENCES auth.users(id),
  mensagem      text NOT NULL CHECK (length(btrim(mensagem)) > 0),
  -- Nota de trabalho: fica no mesmo fio para o comitê, e a RPC pública nunca
  -- a devolve. É o que permite comentar o caso sem abrir uma segunda tela.
  interna       boolean NOT NULL DEFAULT false,
  lida_em       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Nota interna é conceito do comitê; do denunciante seria contradição.
ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM"
  DROP CONSTRAINT IF EXISTS canal_denuncia_msg_interna_chk;
ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM"
  ADD CONSTRAINT canal_denuncia_msg_interna_chk
  CHECK (NOT (interna AND autor = 'denunciante'));

CREATE INDEX IF NOT EXISTS idx_canal_denuncia_msg_denuncia
  ON public."CANAL_DENUNCIA_MENSAGEM"(denuncia_id, created_at);

ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CANAL_DENUNCIA_MENSAGEM" FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public."CANAL_DENUNCIA_MENSAGEM" TO authenticated;

DROP POLICY IF EXISTS canal_denuncia_msg_select ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_select ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- O comitê só escreve como comitê: sem isto, a tela poderia forjar uma
-- resposta "do denunciante" e o fio deixaria de ser prova de nada.
DROP POLICY IF EXISTS canal_denuncia_msg_insert ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_insert ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR INSERT TO authenticated
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias')
              AND autor = 'comite'
              AND autor_user_id = auth.uid());

-- Update existe só para marcar leitura.
DROP POLICY IF EXISTS canal_denuncia_msg_update ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_update ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- ── 2. Histórico ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_EVENTO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denuncia_id uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  campo       text NOT NULL,
  de          text,
  para        text,
  por_user_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canal_denuncia_evento_denuncia
  ON public."CANAL_DENUNCIA_EVENTO"(denuncia_id, created_at DESC);

ALTER TABLE public."CANAL_DENUNCIA_EVENTO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CANAL_DENUNCIA_EVENTO" FROM anon;
-- Só leitura pela API: quem escreve é o gatilho. Histórico que a aplicação
-- pode editar não serve como histórico.
GRANT SELECT ON TABLE public."CANAL_DENUNCIA_EVENTO" TO authenticated;

DROP POLICY IF EXISTS canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO";
CREATE POLICY canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias')
      OR public.tem_acesso_menu('comite_etica_indicadores'));

CREATE OR REPLACE FUNCTION public.canal_denuncia_registrar_evento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."CANAL_DENUNCIA_EVENTO"(denuncia_id, campo, de, para, por_user_id)
    VALUES (NEW.id, 'status', OLD.status, NEW.status, auth.uid());
  END IF;
  IF NEW.resultado IS DISTINCT FROM OLD.resultado THEN
    INSERT INTO public."CANAL_DENUNCIA_EVENTO"(denuncia_id, campo, de, para, por_user_id)
    VALUES (NEW.id, 'resultado', OLD.resultado, NEW.resultado, auth.uid());
  END IF;
  IF NEW.gravidade IS DISTINCT FROM OLD.gravidade THEN
    INSERT INTO public."CANAL_DENUNCIA_EVENTO"(denuncia_id, campo, de, para, por_user_id)
    VALUES (NEW.id, 'gravidade', OLD.gravidade, NEW.gravidade, auth.uid());
  END IF;
  IF NEW.apuracao_responsavel IS DISTINCT FROM OLD.apuracao_responsavel THEN
    INSERT INTO public."CANAL_DENUNCIA_EVENTO"(denuncia_id, campo, de, para, por_user_id)
    VALUES (NEW.id, 'responsavel', OLD.apuracao_responsavel, NEW.apuracao_responsavel, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_canal_denuncia_evento ON public."CANAL_DENUNCIA";
CREATE TRIGGER trg_canal_denuncia_evento
  AFTER UPDATE ON public."CANAL_DENUNCIA"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_registrar_evento();

-- ── 3. Porta pública do denunciante ──────────────────────────────────
-- Confere e-mail + senha a CADA chamada. Sem sessão: é o mesmo modelo do
-- acompanhamento, e é o que permite conversar sem criar login para quem
-- denuncia.
CREATE OR REPLACE FUNCTION public.denuncia_mensagens(
  p_email text, p_senha text, p_protocolo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_id uuid; v_itens jsonb;
BEGIN
  SELECT d.id INTO v_id
    FROM public."CANAL_DENUNCIA" d
   WHERE d.protocolo = btrim(upper(COALESCE(p_protocolo, '')))
     AND lower(btrim(d.email)) = lower(btrim(COALESCE(p_email, '')))
     AND d.senha_hash = crypt(COALESCE(p_senha, ''), d.senha_hash);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'E-mail ou senha inválidos.' USING ERRCODE = '42501';
  END IF;

  -- Marca como lidas as do comitê. Feito aqui e não na tela porque é o
  -- servidor que sabe que a pessoa realmente abriu a conversa.
  UPDATE public."CANAL_DENUNCIA_MENSAGEM"
     SET lida_em = now()
   WHERE denuncia_id = v_id AND autor = 'comite' AND interna = false AND lida_em IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'autor', m.autor, 'mensagem', m.mensagem, 'criada_em', m.created_at
         ) ORDER BY m.created_at), '[]'::jsonb)
    INTO v_itens
    FROM public."CANAL_DENUNCIA_MENSAGEM" m
   WHERE m.denuncia_id = v_id
     AND m.interna = false;   -- nota de trabalho do comitê nunca sai daqui

  RETURN jsonb_build_object('mensagens', v_itens);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_mensagens(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_mensagens(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.denuncia_responder(
  p_email text, p_senha text, p_protocolo text, p_mensagem text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_id uuid; v_txt text := btrim(COALESCE(p_mensagem, ''));
BEGIN
  IF length(v_txt) < 2 THEN
    RAISE EXCEPTION 'Escreva sua mensagem antes de enviar.' USING ERRCODE = '22023';
  END IF;
  IF length(v_txt) > 5000 THEN
    RAISE EXCEPTION 'Mensagem muito longa (máximo de 5000 caracteres).' USING ERRCODE = '22023';
  END IF;

  SELECT d.id INTO v_id
    FROM public."CANAL_DENUNCIA" d
   WHERE d.protocolo = btrim(upper(COALESCE(p_protocolo, '')))
     AND lower(btrim(d.email)) = lower(btrim(COALESCE(p_email, '')))
     AND d.senha_hash = crypt(COALESCE(p_senha, ''), d.senha_hash);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'E-mail ou senha inválidos.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public."CANAL_DENUNCIA_MENSAGEM"(denuncia_id, autor, mensagem)
  VALUES (v_id, 'denunciante', v_txt);

  -- Toca a denúncia para o comitê ver que houve movimento na fila.
  UPDATE public."CANAL_DENUNCIA" SET updated_at = now() WHERE id = v_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_responder(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_responder(text, text, text, text) TO anon, authenticated;

-- ── 4. A consulta passa a avisar que há mensagem nova ────────────────
CREATE OR REPLACE FUNCTION public.denuncia_consultar(p_email text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_itens jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'registrada_em' DESC), '[]'::jsonb)
    INTO v_itens
    FROM (
      SELECT jsonb_build_object(
               'protocolo',     d.protocolo,
               'titulo',        d.titulo,
               'status',        d.status,
               'resultado',     d.resultado,
               'tipo_denuncia', d.tipo_denuncia,
               'registrada_em', d.created_at,
               'atualizada_em', d.updated_at,
               'concluida_em',  d.concluido_em,
               'retorno',       d.retorno_denunciante,
               'nao_lidas',     (SELECT count(*) FROM public."CANAL_DENUNCIA_MENSAGEM" m
                                  WHERE m.denuncia_id = d.id AND m.autor = 'comite'
                                    AND m.interna = false AND m.lida_em IS NULL)
             ) AS x
        FROM public."CANAL_DENUNCIA" d
       WHERE lower(btrim(d.email)) = lower(btrim(COALESCE(p_email, '')))
         AND d.senha_hash = crypt(COALESCE(p_senha, ''), d.senha_hash)
    ) s;

  IF v_itens = '[]'::jsonb THEN
    RAISE EXCEPTION 'E-mail ou senha inválidos.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('denuncias', v_itens);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_consultar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_consultar(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT json_build_object(
  'tabela_mensagem', (SELECT count(*) FROM information_schema.tables
                       WHERE table_schema='public' AND table_name='CANAL_DENUNCIA_MENSAGEM'),
  'tabela_evento',   (SELECT count(*) FROM information_schema.tables
                       WHERE table_schema='public' AND table_name='CANAL_DENUNCIA_EVENTO'),
  'rpcs',            (SELECT json_agg(p.proname ORDER BY p.proname) FROM pg_proc p
                       JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public'
                        AND p.proname IN ('denuncia_mensagens','denuncia_responder','denuncia_consultar')),
  'anon_executa',    json_build_object(
                       'mensagens', has_function_privilege('anon','public.denuncia_mensagens(text,text,text)','EXECUTE'),
                       'responder', has_function_privilege('anon','public.denuncia_responder(text,text,text,text)','EXECUTE')),
  'anon_le_tabela',  has_table_privilege('anon','public."CANAL_DENUNCIA_MENSAGEM"','SELECT')
)::text;

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_canal_denuncia_evento ON public."CANAL_DENUNCIA";
--   DROP FUNCTION IF EXISTS public.canal_denuncia_registrar_evento();
--   DROP FUNCTION IF EXISTS public.denuncia_mensagens(text,text,text);
--   DROP FUNCTION IF EXISTS public.denuncia_responder(text,text,text,text);
--   DROP TABLE IF EXISTS public."CANAL_DENUNCIA_MENSAGEM";
--   DROP TABLE IF EXISTS public."CANAL_DENUNCIA_EVENTO";
--   ALTER TABLE public."CANAL_DENUNCIA" DROP COLUMN IF EXISTS titulo;
--   -- e recriar denuncia_consultar da 20260901000005 (sem titulo/nao_lidas)
-- =====================================================================
