-- =====================================================================
-- Chamados de Sistemas › PARTICIPANTES EXTRAS (09/10/2026).
--
-- Pedido do Pablo: botão "Adicionar participante" logo abaixo do "Abrir PR";
-- depois de concluído, os participantes extras também AVALIAM o chamado e,
-- como o solicitante, não abrem outro chamado enquanto não avaliarem.
--
--   · CHAMADO_SISTEMA_PARTICIPANTE — quem foi incluído (responsável ou gestão
--     incluem/removem pelas RPCs; ninguém escreve direto na tabela).
--   · O participante enxerga o chamado e a conversa como o solicitante
--     (comentário sim, observação interna não).
--   · CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO — a avaliação de cada
--     participante, mesmos 6 critérios e a mesma regra do comentário. Fica em
--     tabela à parte porque CHAMADO_SISTEMA_AVALIACAO é UMA por chamado
--     (UNIQUE chamado_id) e várias telas leem com maybeSingle — misturar
--     quebraria dashboards e o ranking, que seguem sendo do solicitante.
--   · chamado_pendencias_solicitante passa a devolver também as avaliações
--     de participante (pendencia = 'avaliacao_participante'); o gatilho que
--     bloqueia abrir chamado já usa essa função, então a trava vale sozinha.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_PARTICIPANTE" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chamado_id     uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  adicionado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chamado_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chamado_participante_user ON public."CHAMADO_SISTEMA_PARTICIPANTE"(user_id);

CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO" (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chamado_id   uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  qualidade    smallint NOT NULL CHECK (qualidade BETWEEN 1 AND 5),
  prazo        smallint NOT NULL CHECK (prazo BETWEEN 1 AND 5),
  comunicacao  smallint NOT NULL CHECK (comunicacao BETWEEN 1 AND 5),
  clareza      smallint NOT NULL CHECK (clareza BETWEEN 1 AND 5),
  facilidade   smallint NOT NULL CHECK (facilidade BETWEEN 1 AND 5),
  satisfacao   smallint NOT NULL CHECK (satisfacao BETWEEN 1 AND 5),
  comentario   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chamado_id, user_id),
  -- Mesmo texto da regra do solicitante (a tela reconhece o nome no erro).
  CONSTRAINT chamado_avaliacao_comentario_obrigatorio_participante CHECK (
    (qualidade = 5 AND prazo = 5 AND comunicacao = 5 AND clareza = 5 AND facilidade = 5 AND satisfacao = 5)
    OR (comentario IS NOT NULL AND length(btrim(comentario)) >= 10))
);

-- É participante deste chamado? (SECURITY DEFINER: usada dentro das policies
-- de CHAMADO_SISTEMA sem cair em recursão de RLS.)
CREATE OR REPLACE FUNCTION public.chamado_eh_participante(p_chamado_id uuid, p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_PARTICIPANTE" p WHERE p.chamado_id = p_chamado_id AND p.user_id = p_uid);
$$;
REVOKE ALL ON FUNCTION public.chamado_eh_participante(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_eh_participante(uuid, uuid) TO authenticated;

-- ---- RLS das tabelas novas ---------------------------------------------------
ALTER TABLE public."CHAMADO_SISTEMA_PARTICIPANTE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chamado_participante_select ON public."CHAMADO_SISTEMA_PARTICIPANTE";
CREATE POLICY chamado_participante_select ON public."CHAMADO_SISTEMA_PARTICIPANTE" FOR SELECT TO authenticated
  USING (public.chamado_pode_conversar(chamado_id));

DROP POLICY IF EXISTS chamado_participante_avaliacao_select ON public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO";
CREATE POLICY chamado_participante_avaliacao_select ON public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO" FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.chamado_sistema_pode_ver_todos()
         OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id AND c.responsavel_id = auth.uid()));

DROP POLICY IF EXISTS chamado_participante_avaliacao_insert ON public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO";
CREATE POLICY chamado_participante_avaliacao_insert ON public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO" FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.chamado_eh_participante(chamado_id)
              AND EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id AND c.status = 'concluido'));

GRANT SELECT ON public."CHAMADO_SISTEMA_PARTICIPANTE" TO authenticated;
GRANT SELECT, INSERT ON public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO" TO authenticated;

-- ---- O participante enxerga o chamado e a conversa -----------------------------
DROP POLICY IF EXISTS chamado_sistema_select ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_select ON public."CHAMADO_SISTEMA" FOR SELECT TO authenticated
  USING (solicitante_id = auth.uid() OR responsavel_id = auth.uid() OR public.chamado_sistema_pode_ver_todos()
         OR public.chamado_eh_participante(id));

DROP POLICY IF EXISTS chamado_sistema_evento_select ON public."CHAMADO_SISTEMA_EVENTO";
CREATE POLICY chamado_sistema_evento_select ON public."CHAMADO_SISTEMA_EVENTO" FOR SELECT TO authenticated
  USING (public.chamado_sistema_gestor() OR EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = "CHAMADO_SISTEMA_EVENTO".chamado_id
       AND (c.responsavel_id = auth.uid()
            OR ((c.solicitante_id = auth.uid() OR public.chamado_eh_participante(c.id)) AND "CHAMADO_SISTEMA_EVENTO".tipo <> 'observacao_interna'))));

DROP POLICY IF EXISTS chamado_sistema_evento_insert ON public."CHAMADO_SISTEMA_EVENTO";
CREATE POLICY chamado_sistema_evento_insert ON public."CHAMADO_SISTEMA_EVENTO" FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = "CHAMADO_SISTEMA_EVENTO".chamado_id
       AND (public.chamado_sistema_gestor() OR c.responsavel_id = auth.uid()
            OR ((c.solicitante_id = auth.uid() OR public.chamado_eh_participante(c.id)) AND "CHAMADO_SISTEMA_EVENTO".tipo = 'comentario'))));

CREATE OR REPLACE FUNCTION public.chamado_pode_conversar(p_chamado_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND (c.solicitante_id = auth.uid()
            OR c.responsavel_id = auth.uid()
            OR public.chamado_sistema_gestor()
            OR public.chamado_eh_participante(c.id))
  );
$$;

-- "Quem tem acesso" da conversa: participantes extras entram com papel 'participante'.
CREATE OR REPLACE FUNCTION public.chamado_participantes(p_chamado_id uuid)
 RETURNS TABLE(user_id uuid, nome text, papel text, ve_interno boolean, principal boolean, lido_em timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  WITH ch AS (
    SELECT c.id, c.solicitante_id, c.responsavel_id
      FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND public.chamado_pode_conversar(p_chamado_id)
  ),
  gestores AS (
    SELECT DISTINCT s.user_id AS uid
      FROM public.screen_permission_user s
     WHERE s.menu_codigo IN ('chamados_sistemas_painel',
                             'chamados_sistemas_coordenar',
                             'chamados_sistemas_aprovar')
       AND s.acao = 'visualizar'::public.app_acao
       AND s.allow = true
       AND s.empresa_id IS NULL
  ),
  extras AS (
    SELECT pp.user_id AS uid FROM public."CHAMADO_SISTEMA_PARTICIPANTE" pp JOIN ch ON ch.id = pp.chamado_id
  ),
  gente AS (
    SELECT solicitante_id AS uid FROM ch
    UNION
    SELECT responsavel_id FROM ch WHERE responsavel_id IS NOT NULL
    UNION
    SELECT g.uid FROM gestores g CROSS JOIN ch
    UNION
    SELECT uid FROM extras
  )
  SELECT g.uid,
         COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.email), ''), 'Usuário'),
         CASE WHEN g.uid = ch.solicitante_id THEN 'solicitante'
              WHEN g.uid = ch.responsavel_id THEN 'responsavel'
              WHEN g.uid IN (SELECT uid FROM extras) THEN 'participante'
              ELSE 'gestao' END,
         (g.uid = ch.responsavel_id) OR public.chamado_sistema_gestor_uid(g.uid),
         g.uid IN (ch.solicitante_id, ch.responsavel_id),
         l.lido_em
    FROM gente g
    CROSS JOIN ch
    LEFT JOIN public.profiles p ON p.id = g.uid
    LEFT JOIN public."CHAMADO_SISTEMA_LEITURA" l
           ON l.chamado_id = ch.id AND l.user_id = g.uid
   WHERE COALESCE(p.ativo, true)
   ORDER BY CASE WHEN g.uid = ch.solicitante_id THEN 1
                 WHEN g.uid = ch.responsavel_id THEN 2
                 WHEN g.uid IN (SELECT uid FROM extras) THEN 3
                 ELSE 4 END,
            2;
$function$;

-- ---- Incluir / remover ------------------------------------------------------------
-- Quem pode: o responsável (dev) ou a gestão de chamados. Grava no histórico.
CREATE OR REPLACE FUNCTION public.chamado_participante_adicionar(p_chamado_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE c record; v_nome text;
BEGIN
  SELECT * INTO c FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chamado não encontrado.'; END IF;
  IF NOT (public.chamado_sistema_gestor() OR c.responsavel_id = auth.uid()) THEN
    RAISE EXCEPTION 'Só o responsável ou a gestão de chamados incluem participantes.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IN (c.solicitante_id, c.responsavel_id) THEN
    RAISE EXCEPTION 'Essa pessoa já está no chamado (solicitante ou responsável).';
  END IF;
  INSERT INTO public."CHAMADO_SISTEMA_PARTICIPANTE" (chamado_id, user_id, adicionado_por)
  VALUES (p_chamado_id, p_user_id, auth.uid())
  ON CONFLICT (chamado_id, user_id) DO NOTHING;
  IF FOUND THEN
    SELECT COALESCE(NULLIF(btrim(display_name), ''), email, 'Usuário') INTO v_nome FROM public.profiles WHERE id = p_user_id;
    INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
    VALUES (p_chamado_id, auth.uid(), 'evento', 'adicionou ' || COALESCE(v_nome, 'um participante') || ' como participante',
            jsonb_build_object('acao', 'participante_adicionado', 'user_id', p_user_id));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.chamado_participante_remover(p_chamado_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE c record; v_nome text;
BEGIN
  SELECT * INTO c FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chamado não encontrado.'; END IF;
  IF NOT (public.chamado_sistema_gestor() OR c.responsavel_id = auth.uid()) THEN
    RAISE EXCEPTION 'Só o responsável ou a gestão de chamados removem participantes.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."CHAMADO_SISTEMA_PARTICIPANTE" WHERE chamado_id = p_chamado_id AND user_id = p_user_id;
  IF FOUND THEN
    SELECT COALESCE(NULLIF(btrim(display_name), ''), email, 'Usuário') INTO v_nome FROM public.profiles WHERE id = p_user_id;
    INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
    VALUES (p_chamado_id, auth.uid(), 'evento', 'removeu ' || COALESCE(v_nome, 'um participante') || ' dos participantes',
            jsonb_build_object('acao', 'participante_removido', 'user_id', p_user_id));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.chamado_participante_adicionar(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chamado_participante_remover(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_participante_adicionar(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chamado_participante_remover(uuid, uuid) TO authenticated;

-- ---- Pendências: o participante também avalia antes de abrir outro -------------
CREATE OR REPLACE FUNCTION public.chamado_pendencias_solicitante(p_uid uuid)
 RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamp with time zone, pendencia text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT * FROM (
    SELECT c.id, c.numero, c.assunto, c.concluido_em, 'avaliacao'::text
      FROM public."CHAMADO_SISTEMA" c
      LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
     WHERE c.solicitante_id = p_uid
       AND c.status = 'concluido'
       AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
       -- Presidência ainda validando (ou devolvido ao dev): nada a fazer pelo solicitante.
       AND (v.chamado_id IS NULL OR v.etapa IN ('treinamento', 'finalizado'))
    UNION ALL
    -- Participante extra (mig 20261009000003): mesma janela do solicitante.
    SELECT c.id, c.numero, c.assunto, c.concluido_em, 'avaliacao_participante'::text
      FROM public."CHAMADO_SISTEMA_PARTICIPANTE" pp
      JOIN public."CHAMADO_SISTEMA" c ON c.id = pp.chamado_id
      LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
     WHERE pp.user_id = p_uid
       AND c.status = 'concluido'
       AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO" a WHERE a.chamado_id = c.id AND a.user_id = p_uid)
       AND (v.chamado_id IS NULL OR v.etapa IN ('treinamento', 'finalizado'))
  ) x
  ORDER BY x.concluido_em NULLS LAST;
$function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.chamado_participante_adicionar(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.chamado_participante_remover(uuid, uuid);
-- Recriar chamado_pendencias_solicitante / chamado_participantes / chamado_pode_conversar
-- e as policies chamado_sistema_select / chamado_sistema_evento_select / _insert sem o
-- chamado_eh_participante (versões atuais do banco em 09/10/2026), depois:
-- DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO";
-- DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_PARTICIPANTE";
-- DROP FUNCTION IF EXISTS public.chamado_eh_participante(uuid, uuid);
