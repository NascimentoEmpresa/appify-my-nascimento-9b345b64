-- =====================================================================
-- CHAMADOS DE SISTEMAS — a conversa vira um CHAT DE GRUPO (estilo WhatsApp)
--
-- POR QUE
-- O histórico do chamado era uma lista de caixinhas com dois campos separados
-- ("Responder ao solicitante" e "Observações internas"). Quem atende precisava
-- adivinhar em qual campo escrever e não tinha como saber se o solicitante já
-- tinha lido. Puxar informação com o solicitante ficava lento.
--
-- O QUE MUDA
--   1. "CHAMADO_SISTEMA_LEITURA" — até quando cada pessoa leu a conversa
--      (mesma ideia do "visto por" do WhatsApp: um carimbo por pessoa).
--   2. chamado_participantes() — quem é o GRUPO do chamado: solicitante,
--      responsável e quem já escreveu ou abriu a conversa. Devolve, de cada um,
--      se enxerga mensagem interna e até quando leu → a tela calcula sozinha
--      "entregue", "lido por alguns" e "lido por TODOS".
--   3. chamado_marcar_lido() — carimba a leitura de quem abriu o chat.
--   4. chamado_enviar_mensagem() — um único caminho de envio (pública ou só
--      equipe), que já devolve o chamado ao time quando o solicitante responde
--      um "aguardando retorno" (era o que a chamado_adicionar_informacao fazia).
--   5. "CHAMADO_SISTEMA_ANEXO".evento_id — o anexo passa a pertencer à MENSAGEM
--      (é o que permite mostrar a imagem colada dentro do balão) e o campo
--      'interno' esconde do solicitante o print que só a equipe pode ver.
--
-- Idempotente.
-- =====================================================================

-- ── 1. Anexo pertence à mensagem ─────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA_ANEXO"
  ADD COLUMN IF NOT EXISTS evento_id uuid
    REFERENCES public."CHAMADO_SISTEMA_EVENTO"(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_chamado_sistema_anexo_evento
  ON public."CHAMADO_SISTEMA_ANEXO"(evento_id);

COMMENT ON COLUMN public."CHAMADO_SISTEMA_ANEXO".evento_id IS
  'Mensagem do chat à qual o anexo pertence. NULL = anexo de abertura ou anexo antigo, anterior ao chat.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA_ANEXO".campo IS
  'abertura | chat (mensagem visível ao solicitante) | interno (mensagem só da equipe) | resposta (legado).';

-- O solicitante NÃO pode ver anexo de mensagem interna — antes a policy só
-- olhava o chamado, e um print colado numa observação interna vazaria pra ele.
DROP POLICY IF EXISTS chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO";
CREATE POLICY chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = chamado_id
       AND (public.chamado_sistema_gestor()
            OR c.responsavel_id = auth.uid()
            OR (c.solicitante_id = auth.uid() AND campo <> 'interno'))
  ));

-- O bucket liberava SELECT a qualquer autenticado: quem soubesse o caminho
-- baixava o arquivo. Com print colado em mensagem interna isso passa a doer, então
-- o acesso ao objeto agora segue a linha do anexo — a subconsulta roda com a RLS
-- de CHAMADO_SISTEMA_ANEXO aplicada, e o solicitante não acha o print interno.
DROP POLICY IF EXISTS "chamados sistemas anexo select" ON storage.objects;
CREATE POLICY "chamados sistemas anexo select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chamados-sistemas' AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA_ANEXO" a WHERE a.storage_path = name
  ));

-- ── 2. Quem enxerga a conversa ───────────────────────────────────────
-- Versão de chamado_sistema_gestor() para um usuário QUALQUER (a original só
-- responde sobre auth.uid()). Precisa disso para saber, de cada participante,
-- se ele enxerga as mensagens internas.
CREATE OR REPLACE FUNCTION public.chamado_sistema_gestor_uid(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.screen_permission_user s
     WHERE s.user_id = _uid
       AND s.menu_codigo IN ('chamados_sistemas_painel',
                             'chamados_sistemas_coordenar',
                             'chamados_sistemas_aprovar')
       AND s.acao = 'visualizar'::public.app_acao
       AND s.allow = true
       AND s.empresa_id IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_gestor_uid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_sistema_gestor_uid(uuid) TO authenticated;

-- Está no chat deste chamado? (solicitante, responsável ou gestão)
CREATE OR REPLACE FUNCTION public.chamado_pode_conversar(p_chamado_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND (c.solicitante_id = auth.uid()
            OR c.responsavel_id = auth.uid()
            OR public.chamado_sistema_gestor())
  );
$$;
REVOKE ALL ON FUNCTION public.chamado_pode_conversar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_pode_conversar(uuid) TO authenticated;

-- ── 3. Até quando cada um leu ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_LEITURA" (
  chamado_id uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  lido_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chamado_id, user_id)
);
COMMENT ON TABLE public."CHAMADO_SISTEMA_LEITURA" IS
  'Carimbo de leitura do chat por pessoa. Mensagem com created_at <= lido_em já foi vista por ela.';

ALTER TABLE public."CHAMADO_SISTEMA_LEITURA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chamado_sistema_leitura_select ON public."CHAMADO_SISTEMA_LEITURA";
CREATE POLICY chamado_sistema_leitura_select ON public."CHAMADO_SISTEMA_LEITURA"
  FOR SELECT TO authenticated
  USING (public.chamado_pode_conversar(chamado_id));

-- Escrita só pela RPC (SECURITY DEFINER): ninguém carimba leitura alheia.
DROP POLICY IF EXISTS chamado_sistema_leitura_upsert ON public."CHAMADO_SISTEMA_LEITURA";
CREATE POLICY chamado_sistema_leitura_upsert ON public."CHAMADO_SISTEMA_LEITURA"
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.chamado_pode_conversar(chamado_id));

DROP POLICY IF EXISTS chamado_sistema_leitura_update ON public."CHAMADO_SISTEMA_LEITURA";
CREATE POLICY chamado_sistema_leitura_update ON public."CHAMADO_SISTEMA_LEITURA"
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.chamado_marcar_lido(p_chamado_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_agora timestamptz := now();
BEGIN
  IF NOT public.chamado_pode_conversar(p_chamado_id) THEN
    RAISE EXCEPTION 'Sem acesso a este chamado.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_LEITURA" (chamado_id, user_id, lido_em)
  VALUES (p_chamado_id, auth.uid(), v_agora)
  ON CONFLICT (chamado_id, user_id)
  -- Só avança: reabrir uma tela antiga não pode "desler" o que já foi lido.
  DO UPDATE SET lido_em = GREATEST(public."CHAMADO_SISTEMA_LEITURA".lido_em, EXCLUDED.lido_em);

  RETURN v_agora;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_marcar_lido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_marcar_lido(uuid) TO authenticated;

-- ── 4. O grupo do chamado ────────────────────────────────────────────
-- Participante = solicitante + responsável + quem já escreveu ou já abriu a
-- conversa. Gestor que nunca entrou não conta: senão "lido por todos" nunca
-- acenderia, porque dependeria de gente que nem sabe do chamado.
CREATE OR REPLACE FUNCTION public.chamado_participantes(p_chamado_id uuid)
RETURNS TABLE(
  user_id     uuid,
  nome        text,
  papel       text,     -- solicitante | responsavel | equipe
  ve_interno  boolean,
  lido_em     timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH ch AS (
    SELECT c.id, c.solicitante_id, c.responsavel_id
      FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND public.chamado_pode_conversar(p_chamado_id)
  ),
  gente AS (
    SELECT solicitante_id AS uid FROM ch
    UNION
    SELECT responsavel_id FROM ch WHERE responsavel_id IS NOT NULL
    UNION
    SELECT e.autor_id FROM public."CHAMADO_SISTEMA_EVENTO" e, ch
     WHERE e.chamado_id = ch.id AND e.autor_id IS NOT NULL
    UNION
    SELECT l.user_id FROM public."CHAMADO_SISTEMA_LEITURA" l, ch
     WHERE l.chamado_id = ch.id
  )
  SELECT g.uid,
         COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.email), ''), 'Usuário'),
         CASE WHEN g.uid = ch.solicitante_id THEN 'solicitante'
              WHEN g.uid = ch.responsavel_id THEN 'responsavel'
              ELSE 'equipe' END,
         (g.uid = ch.responsavel_id) OR public.chamado_sistema_gestor_uid(g.uid),
         l.lido_em
    FROM gente g
    CROSS JOIN ch
    LEFT JOIN public.profiles p ON p.id = g.uid
    LEFT JOIN public."CHAMADO_SISTEMA_LEITURA" l
           ON l.chamado_id = ch.id AND l.user_id = g.uid
   ORDER BY 3, 2;
$$;
REVOKE ALL ON FUNCTION public.chamado_participantes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_participantes(uuid) TO authenticated;

-- ── 5. Envio de mensagem (o único caminho do chat) ───────────────────
CREATE OR REPLACE FUNCTION public.chamado_enviar_mensagem(
  p_chamado_id uuid,
  p_texto      text,
  p_interno    boolean DEFAULT false,
  p_tem_anexo  boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_solicitante uuid;
  v_responsavel uuid;
  v_status      text;
  v_equipe      boolean;
  v_texto       text := NULLIF(btrim(COALESCE(p_texto, '')), '');
  v_id          uuid;
BEGIN
  IF v_texto IS NULL AND NOT p_tem_anexo THEN
    RAISE EXCEPTION 'Escreva uma mensagem ou anexe um arquivo.' USING ERRCODE = '22023';
  END IF;

  SELECT c.solicitante_id, c.responsavel_id, c.status
    INTO v_solicitante, v_responsavel, v_status
    FROM public."CHAMADO_SISTEMA" c WHERE c.id = p_chamado_id;

  IF v_solicitante IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = '42704';
  END IF;

  v_equipe := (v_responsavel = v_uid) OR public.chamado_sistema_gestor();

  IF NOT (v_equipe OR v_solicitante = v_uid) THEN
    RAISE EXCEPTION 'Sem acesso à conversa deste chamado.' USING ERRCODE = '42501';
  END IF;
  IF p_interno AND NOT v_equipe THEN
    RAISE EXCEPTION 'Somente a equipe registra mensagens internas.' USING ERRCODE = '42501';
  END IF;
  -- Chamado encerrado ainda aceita registro interno (a equipe documenta o que
  -- ficou), mas não aceita mais conversa com o solicitante.
  IF v_status IN ('concluido', 'reprovado') AND NOT p_interno THEN
    RAISE EXCEPTION 'Chamado encerrado — a conversa está fechada.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, v_uid,
          CASE WHEN p_interno THEN 'observacao_interna' ELSE 'comentario' END,
          v_texto)
  RETURNING id INTO v_id;

  -- Quem escreveu já leu a própria mensagem.
  INSERT INTO public."CHAMADO_SISTEMA_LEITURA" (chamado_id, user_id, lido_em)
  VALUES (p_chamado_id, v_uid, now())
  ON CONFLICT (chamado_id, user_id)
  DO UPDATE SET lido_em = GREATEST(public."CHAMADO_SISTEMA_LEITURA".lido_em, EXCLUDED.lido_em);

  -- Solicitante respondeu o "aguardando retorno" → volta pro time.
  IF v_solicitante = v_uid AND NOT v_equipe AND v_status = 'aguardando_retorno' THEN
    UPDATE public."CHAMADO_SISTEMA"
       SET status = CASE WHEN v_responsavel IS NOT NULL THEN 'em_andamento' ELSE 'aberto' END
     WHERE id = p_chamado_id;
  END IF;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_enviar_mensagem(uuid, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_enviar_mensagem(uuid, text, boolean, boolean) TO authenticated;

-- ── 6. Conferência ───────────────────────────────────────────────────
SELECT count(*) AS leituras FROM public."CHAMADO_SISTEMA_LEITURA";

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.chamado_enviar_mensagem(uuid, text, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.chamado_participantes(uuid);
--   DROP FUNCTION IF EXISTS public.chamado_marcar_lido(uuid);
--   DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_LEITURA";
--   DROP FUNCTION IF EXISTS public.chamado_pode_conversar(uuid);
--   DROP FUNCTION IF EXISTS public.chamado_sistema_gestor_uid(uuid);
--   ALTER TABLE public."CHAMADO_SISTEMA_ANEXO" DROP COLUMN evento_id;
--   -- e recriar chamado_sistema_anexo_select da 20260802000002
-- =====================================================================
