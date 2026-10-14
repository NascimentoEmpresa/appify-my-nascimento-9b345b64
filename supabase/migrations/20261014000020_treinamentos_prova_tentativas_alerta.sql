-- =========================================================================
-- TREINAMENTOS: vídeo + prova com tentativas, tipo e alerta (14/10/2026)
--
-- Pedido do Pablo (Central de Serviços › Treinamentos Sistemas): "um vídeo
-- por módulo e depois de assistir o vídeo uma prova de 10 questões; se o
-- usuário não acertar 8 de 10 ele deve assistir o vídeo novamente e refazer a
-- prova; se não acertar em 3 tentativas, gerar um alerta para a gente
-- verificar. Tenho que conseguir adicionar vídeo e prova, classificar o tipo
-- (sistema, segurança…), escolher quantas tentativas e a nota mínima."
--
-- NÃO é um sistema novo: é o mesmo TREINAMENTOS (vídeo, anexo, prova, editor,
-- dashboard) ganhando o que faltava. O que muda:
--
--   1. Grade nova `sistemas` — Treinamentos Sistemas, rota já liberada a
--      todo usuário logado (ROTAS_SEMPRE_LIBERADAS), então quem está logado
--      vê os treinamentos marcados ali. Arquivos do bucket desses
--      treinamentos ganham leitura própria (pasta = id do treinamento).
--   2. Colunas `tipo` (Sistema, Segurança, …, texto livre com sugestões),
--      `modulo_sistema` (o módulo do ERP, mesma lista dos chamados) e
--      `max_tentativas` (NULL = ilimitado; os treinamentos que já existiam
--      ficam ilimitados, como eram).
--   3. A PROVA É CORRIGIDA NO BANCO. Até aqui o gabarito vinha no jsonb
--      `prova` para qualquer um que abrisse o card (dava para ler no
--      DevTools) e a nota era gravada pelo próprio navegador — com limite de
--      tentativas isso deixaria de ser regra. Agora:
--        • o gatilho trn_separar_gabarito tira o `correta` de `prova` (vira -1)
--          e guarda em TREINAMENTO_GABARITO, que só quem gerencia lê;
--        • trn_prova_enviar corrige, grava a tentativa e a conclusão;
--        • TREINAMENTO_CONCLUSAO não aceita mais gravação direta de
--          treinamento com prova (as policies passaram a exigir "sem prova").
--   4. Tentativas: reprovou → precisa assistir o vídeo de novo até o fim
--      (trn_video_assistido) antes de refazer. Reprovou `max_tentativas`
--      vezes seguidas → a prova trava e nasce um TREINAMENTO_ALERTA, com
--      notificação (sininho) para quem tem "Recebe alertas de treinamento"
--      (menu fantasma `treinamentos_alertas`) ou gerencia treinamentos.
--      Quem trata o alerta libera uma nova rodada ou encerra.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1) Colunas novas ─────────────────────────────────────────────────────
ALTER TABLE public."TREINAMENTOS"
  ADD COLUMN IF NOT EXISTS tipo            text,
  ADD COLUMN IF NOT EXISTS modulo_sistema  text,
  ADD COLUMN IF NOT EXISTS max_tentativas  integer;

ALTER TABLE public."TREINAMENTOS" DROP CONSTRAINT IF EXISTS trn_max_tentativas_valido;
ALTER TABLE public."TREINAMENTOS" ADD CONSTRAINT trn_max_tentativas_valido
  CHECK (max_tentativas IS NULL OR max_tentativas BETWEEN 1 AND 20);

-- ── 2) A grade "Treinamentos Sistemas" ──────────────────────────────────
ALTER TABLE public."TREINAMENTOS" DROP CONSTRAINT IF EXISTS trn_escopos_validos;
ALTER TABLE public."TREINAMENTOS" ADD CONSTRAINT trn_escopos_validos CHECK (
  cardinality(escopos) > 0
  AND escopos <@ ARRAY['encarregados', 'central_servicos', 'sistemas']::text[]
);

-- `sistemas` responde à rota liberada a todos: basta estar logado.
CREATE OR REPLACE FUNCTION public.trn_pode_ver_escopos(_escopos text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT ('encarregados' = ANY(_escopos)
          AND public.can_access(auth.uid(), 'treinamentos_erp', 'visualizar'::public.app_acao))
      OR ('central_servicos' = ANY(_escopos)
          AND public.can_access(auth.uid(), 'central_servicos_treinamentos', 'visualizar'::public.app_acao))
      -- 14/10/2026 (mig 20261014000020): Treinamentos Sistemas.
      OR ('sistemas' = ANY(_escopos)
          AND auth.uid() IS NOT NULL
          AND NOT public.erp_login_bloqueado(auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.trn_pode_ver_escopos(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_pode_ver_escopos(text[]) TO authenticated;

-- Vídeo, anexo e capa desses treinamentos: a primeira pasta do arquivo é o
-- id do treinamento (caminhoNoBucket, core.ts). A trn_stg_read continua
-- valendo para os outros módulos.
DROP POLICY IF EXISTS trn_stg_read_sistemas ON storage.objects;
CREATE POLICY trn_stg_read_sistemas ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'treinamentos'
    AND EXISTS (
      SELECT 1 FROM public."TREINAMENTOS" t
       WHERE t.id::text = (storage.foldername(storage.objects.name))[1]
         AND 'sistemas' = ANY(t.escopos)
         AND (t.publicado OR public.trn_pode_gerenciar())
         AND public.trn_pode_ver_escopos(t.escopos)
    )
  );

-- ── 3) Quem recebe e trata os alertas ───────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'treinamentos_alertas', 'Recebe alertas de treinamento (reprovações)', NULL, 95, true
  FROM public.app_modulo m
 WHERE m.codigo = 'treinamentos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('treinamentos_alertas', 'visualizar'::public.app_acao),
       ('treinamentos_alertas', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trn_pode_ver_alertas()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.can_access(auth.uid(), 'treinamentos_alertas', 'visualizar'::public.app_acao)
      OR public.trn_pode_gerenciar();
$$;
REVOKE ALL ON FUNCTION public.trn_pode_ver_alertas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_pode_ver_alertas() TO authenticated;

CREATE OR REPLACE FUNCTION public.trn_pode_tratar_alertas()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.can_access(auth.uid(), 'treinamentos_alertas', 'alterar'::public.app_acao)
      OR public.trn_pode_gerenciar();
$$;
REVOKE ALL ON FUNCTION public.trn_pode_tratar_alertas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_pode_tratar_alertas() TO authenticated;

-- ── 4) Gabarito fora do alcance de quem faz a prova ─────────────────────
CREATE TABLE IF NOT EXISTS public."TREINAMENTO_GABARITO" (
  -- DEFERRABLE: o gatilho grava o gabarito no BEFORE INSERT do treinamento,
  -- antes de a linha-mãe existir; a FK é conferida no fim da transação.
  treinamento_id uuid PRIMARY KEY
    REFERENCES public."TREINAMENTOS"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  -- { "<id da questão>": <índice da alternativa certa> }
  respostas      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."TREINAMENTO_GABARITO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trn_gab_select ON public."TREINAMENTO_GABARITO";
CREATE POLICY trn_gab_select ON public."TREINAMENTO_GABARITO" FOR SELECT TO authenticated
  USING (public.trn_pode_gerenciar());
-- Sem policy de escrita: só o gatilho (SECURITY DEFINER) grava.

CREATE OR REPLACE FUNCTION public.trn_separar_gabarito()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ant   jsonb := '{}'::jsonb;
  v_gab   jsonb := '{}'::jsonb;
  v_prova jsonb := '[]'::jsonb;
  q       jsonb;
  v_id    text;
  v_c     jsonb;
BEGIN
  IF NEW.prova IS NULL OR jsonb_typeof(NEW.prova) <> 'array' THEN
    RETURN NEW;
  END IF;
  SELECT g.respostas INTO v_ant FROM public."TREINAMENTO_GABARITO" g WHERE g.treinamento_id = NEW.id;
  v_ant := coalesce(v_ant, '{}'::jsonb);

  FOR q IN SELECT * FROM jsonb_array_elements(NEW.prova) LOOP
    v_id := q->>'id';
    v_c  := q->'correta';
    IF v_id IS NOT NULL THEN
      -- Alternativa válida vinda do editor vence; -1/ausente (a prova já
      -- separada, regravada sem mexer no gabarito) mantém o que estava.
      IF jsonb_typeof(v_c) = 'number' AND (v_c)::int >= 0 THEN
        v_gab := v_gab || jsonb_build_object(v_id, (v_c)::int);
      ELSIF v_ant ? v_id THEN
        v_gab := v_gab || jsonb_build_object(v_id, v_ant->v_id);
      END IF;
    END IF;
    v_prova := v_prova || jsonb_build_array(jsonb_set(q, '{correta}', '-1'::jsonb, true));
  END LOOP;

  NEW.prova := v_prova;
  INSERT INTO public."TREINAMENTO_GABARITO" (treinamento_id, respostas, updated_at)
  VALUES (NEW.id, v_gab, now())
  ON CONFLICT (treinamento_id) DO UPDATE SET respostas = EXCLUDED.respostas, updated_at = now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trn_separar_gabarito() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trn_separar_gabarito ON public."TREINAMENTOS";
CREATE TRIGGER trg_trn_separar_gabarito
  BEFORE INSERT OR UPDATE OF prova ON public."TREINAMENTOS"
  FOR EACH ROW EXECUTE FUNCTION public.trn_separar_gabarito();

-- Separa o gabarito das provas que já existem (dispara o gatilho acima).
UPDATE public."TREINAMENTOS" SET prova = prova
 WHERE prova IS NOT NULL AND jsonb_typeof(prova) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(prova) e
                WHERE jsonb_typeof(e->'correta') = 'number' AND (e->>'correta')::int >= 0);

-- ── 5) Estado da pessoa em cada prova, tentativas e alertas ─────────────
CREATE TABLE IF NOT EXISTS public."TREINAMENTO_PROVA_ESTADO" (
  treinamento_id      uuid NOT NULL REFERENCES public."TREINAMENTOS"(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_visto_em      timestamptz,
  ultima_tentativa_em timestamptz,
  ultima_aprovada     boolean,
  -- Reprovações desde a última aprovação ou liberação: é o que trava.
  falhas_seguidas     integer NOT NULL DEFAULT 0,
  bloqueado           boolean NOT NULL DEFAULT false,
  bloqueado_em        timestamptz,
  liberacoes          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (treinamento_id, user_id)
);
ALTER TABLE public."TREINAMENTO_PROVA_ESTADO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trn_estado_select ON public."TREINAMENTO_PROVA_ESTADO";
CREATE POLICY trn_estado_select ON public."TREINAMENTO_PROVA_ESTADO" FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.trn_pode_ver_alertas());

CREATE TABLE IF NOT EXISTS public."TREINAMENTO_TENTATIVA" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treinamento_id uuid NOT NULL REFERENCES public."TREINAMENTOS"(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usuario_nome   text,
  numero         integer NOT NULL,
  acertos        integer NOT NULL,
  total          integer NOT NULL,
  nota           integer NOT NULL,
  nota_minima    integer NOT NULL,
  aprovado       boolean NOT NULL,
  respostas      jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trn_tentativa_user ON public."TREINAMENTO_TENTATIVA" (treinamento_id, user_id, created_at DESC);
ALTER TABLE public."TREINAMENTO_TENTATIVA" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trn_tent_select ON public."TREINAMENTO_TENTATIVA";
CREATE POLICY trn_tent_select ON public."TREINAMENTO_TENTATIVA" FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.trn_pode_ver_alertas() OR public.trn_pode_dashboard());

CREATE TABLE IF NOT EXISTS public."TREINAMENTO_ALERTA" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treinamento_id     uuid NOT NULL REFERENCES public."TREINAMENTOS"(id) ON DELETE CASCADE,
  treinamento_titulo text,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usuario_nome       text,
  tentativas         integer NOT NULL,
  ultima_nota        integer,
  nota_minima        integer,
  status             text NOT NULL DEFAULT 'aberto',
  tratado_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tratado_por_nome   text,
  tratado_em         timestamptz,
  tratado_obs        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trn_alerta_status_valido CHECK (status IN ('aberto', 'liberado', 'encerrado'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trn_alerta_aberto
  ON public."TREINAMENTO_ALERTA" (treinamento_id, user_id) WHERE status = 'aberto';
CREATE INDEX IF NOT EXISTS idx_trn_alerta_status ON public."TREINAMENTO_ALERTA" (status, created_at DESC);
ALTER TABLE public."TREINAMENTO_ALERTA" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trn_alerta_select ON public."TREINAMENTO_ALERTA";
CREATE POLICY trn_alerta_select ON public."TREINAMENTO_ALERTA" FOR SELECT TO authenticated
  USING (public.trn_pode_ver_alertas() OR user_id = auth.uid());

-- ── 6) Conclusão: treinamento com prova só pela RPC ─────────────────────
-- A gravação direta continua para o treinamento sem prova (abrir = concluir);
-- com prova, a nota vem de trn_prova_enviar, que corrige no banco.
DROP POLICY IF EXISTS trn_conc_insert ON public."TREINAMENTO_CONCLUSAO";
CREATE POLICY trn_conc_insert ON public."TREINAMENTO_CONCLUSAO" FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public."TREINAMENTOS" t
                 WHERE t.id = "TREINAMENTO_CONCLUSAO".treinamento_id
                   AND (t.prova IS NULL OR jsonb_typeof(t.prova) <> 'array' OR jsonb_array_length(t.prova) = 0))
  );
DROP POLICY IF EXISTS trn_conc_update ON public."TREINAMENTO_CONCLUSAO";
CREATE POLICY trn_conc_update ON public."TREINAMENTO_CONCLUSAO" FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public."TREINAMENTOS" t
                 WHERE t.id = "TREINAMENTO_CONCLUSAO".treinamento_id
                   AND (t.prova IS NULL OR jsonb_typeof(t.prova) <> 'array' OR jsonb_array_length(t.prova) = 0))
  );

-- ── 7) Regras ────────────────────────────────────────────────────────────
-- O vídeo que o player consegue acompanhar até o fim (PlayerAteOFim /
-- embedDeVideo, core.ts): arquivo do bucket, YouTube, Vimeo ou link de
-- arquivo. Link de outro tipo abre em outra aba e não dá para exigir.
CREATE OR REPLACE FUNCTION public.trn_video_rastreavel(_url text, _path text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(btrim(_path), '') <> ''
      OR coalesce(_url, '') ~* '(youtube\.com/(watch\?(.*&)?v=|embed/|shorts/|live/)|youtu\.be/)[A-Za-z0-9_-]{6,}'
      OR coalesce(_url, '') ~* 'vimeo\.com/(video/)?[0-9]+'
      OR coalesce(_url, '') ~* '\.(mp4|webm|ogg|mov|m4v)(\?|#|$)';
$$;

-- Precisa (re)ver o vídeo antes da prova? Primeira vez: sim, se nunca viu
-- (exceto quem já foi aprovado antes desta regra). Depois de reprovar: sim,
-- até assistir de novo depois da tentativa.
CREATE OR REPLACE FUNCTION public.trn_precisa_ver_video(_t public."TREINAMENTOS", _e public."TREINAMENTO_PROVA_ESTADO", _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.trn_video_rastreavel(_t.video_url, _t.video_path)
     AND CASE
           WHEN _e.ultima_tentativa_em IS NOT NULL AND NOT coalesce(_e.ultima_aprovada, false)
             THEN _e.video_visto_em IS NULL OR _e.video_visto_em < _e.ultima_tentativa_em
           WHEN _e.video_visto_em IS NOT NULL OR coalesce(_e.ultima_aprovada, false) THEN false
           ELSE NOT EXISTS (SELECT 1 FROM public."TREINAMENTO_CONCLUSAO" c
                             WHERE c.treinamento_id = _t.id AND c.user_id = _uid AND c.aprovado)
         END;
$$;
REVOKE ALL ON FUNCTION public.trn_precisa_ver_video(public."TREINAMENTOS", public."TREINAMENTO_PROVA_ESTADO", uuid) FROM PUBLIC, anon, authenticated;

-- O treinamento, conferindo que a pessoa pode fazê-lo.
CREATE OR REPLACE FUNCTION public.trn_treinamento_acessivel(_treinamento uuid)
RETURNS public."TREINAMENTOS" LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t public."TREINAMENTOS";
BEGIN
  SELECT * INTO t FROM public."TREINAMENTOS" WHERE id = _treinamento;
  IF t.id IS NULL OR NOT public.trn_pode_ver_escopos(t.escopos) OR NOT (t.publicado OR public.trn_pode_gerenciar()) THEN
    RAISE EXCEPTION 'Treinamento não encontrado.';
  END IF;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.trn_treinamento_acessivel(uuid) FROM PUBLIC, anon, authenticated;

-- Situação da pessoa na prova — o que o visor mostra antes de começar.
CREATE OR REPLACE FUNCTION public.trn_prova_estado(_treinamento uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  t     public."TREINAMENTOS";
  e     public."TREINAMENTO_PROVA_ESTADO";
  v_tot integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login.'; END IF;
  t := public.trn_treinamento_acessivel(_treinamento);
  SELECT * INTO e FROM public."TREINAMENTO_PROVA_ESTADO" WHERE treinamento_id = t.id AND user_id = v_uid;
  SELECT count(*) INTO v_tot FROM public."TREINAMENTO_TENTATIVA" WHERE treinamento_id = t.id AND user_id = v_uid;
  RETURN jsonb_build_object(
    'max_tentativas',    t.max_tentativas,
    'falhas_seguidas',   coalesce(e.falhas_seguidas, 0),
    'restantes',         CASE WHEN t.max_tentativas IS NULL THEN NULL
                              ELSE greatest(t.max_tentativas - coalesce(e.falhas_seguidas, 0), 0) END,
    'bloqueado',         coalesce(e.bloqueado, false),
    'precisa_ver_video', public.trn_precisa_ver_video(t, e, v_uid),
    'video_rastreavel',  public.trn_video_rastreavel(t.video_url, t.video_path),
    'ultima_aprovada',   e.ultima_aprovada,
    'tentativas_total',  v_tot);
END $$;
REVOKE ALL ON FUNCTION public.trn_prova_estado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_prova_estado(uuid) TO authenticated;

-- O player avisou que o vídeo foi assistido até o fim.
CREATE OR REPLACE FUNCTION public.trn_video_assistido(_treinamento uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); t public."TREINAMENTOS";
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login.'; END IF;
  t := public.trn_treinamento_acessivel(_treinamento);
  INSERT INTO public."TREINAMENTO_PROVA_ESTADO" (treinamento_id, user_id, video_visto_em)
  VALUES (t.id, v_uid, now())
  ON CONFLICT (treinamento_id, user_id) DO UPDATE SET video_visto_em = now();
END $$;
REVOKE ALL ON FUNCTION public.trn_video_assistido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_video_assistido(uuid) TO authenticated;

-- Avisa (sininho) quem trata os alertas.
CREATE OR REPLACE FUNCTION public.trn_notificar_alerta(_alerta public."TREINAMENTO_ALERTA")
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT p.id,
         'Treinamento: ' || coalesce(_alerta.usuario_nome, 'colaborador') || ' reprovou ' || _alerta.tentativas || 'x',
         coalesce(_alerta.usuario_nome, 'Um colaborador') || ' não atingiu a nota mínima ('
           || coalesce(_alerta.nota_minima::text, '?') || '%) em "' || coalesce(_alerta.treinamento_titulo, 'treinamento')
           || '" depois de ' || _alerta.tentativas || ' tentativas (última: ' || coalesce(_alerta.ultima_nota::text, '?')
           || '%). A prova ficou travada até alguém verificar.',
         'treinamento_alerta',
         '/app/central-servicos/treinamentos-sistemas?aba=alertas'
    FROM public.profiles p
   WHERE p.id <> _alerta.user_id
     AND (public.can_access(p.id, 'treinamentos_alertas', 'visualizar'::public.app_acao)
          OR public.can_access(p.id, 'treinamentos_gerenciar', 'alterar'::public.app_acao));
EXCEPTION WHEN others THEN
  -- Avisar não pode desfazer a tentativa: o alerta já está gravado e aparece na tela.
  RAISE WARNING 'trn_notificar_alerta: %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public.trn_notificar_alerta(public."TREINAMENTO_ALERTA") FROM PUBLIC, anon, authenticated;

-- Envia a prova: corrige, grava a tentativa, trava e alerta quando é o caso.
CREATE OR REPLACE FUNCTION public.trn_prova_enviar(_treinamento uuid, _respostas jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid     uuid := auth.uid();
  t         public."TREINAMENTOS";
  e         public."TREINAMENTO_PROVA_ESTADO";
  v_gab     jsonb;
  v_nome    text;
  q         jsonb;
  v_id      text;
  v_marcou  text;
  v_certo   boolean;
  v_por     jsonb := '[]'::jsonb;
  v_acertos integer := 0;
  v_total   integer := 0;
  v_nota    integer;
  v_aprov   boolean;
  v_numero  integer;
  v_falhas  integer;
  v_bloq    boolean := false;
  a         public."TREINAMENTO_ALERTA";
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login.'; END IF;
  t := public.trn_treinamento_acessivel(_treinamento);
  IF t.prova IS NULL OR jsonb_typeof(t.prova) <> 'array' OR jsonb_array_length(t.prova) = 0 THEN
    RAISE EXCEPTION 'Este treinamento não tem prova.';
  END IF;
  SELECT g.respostas INTO v_gab FROM public."TREINAMENTO_GABARITO" g WHERE g.treinamento_id = t.id;
  IF v_gab IS NULL THEN
    RAISE EXCEPTION 'A prova deste treinamento está sem gabarito. Avise quem gerencia os treinamentos.';
  END IF;

  INSERT INTO public."TREINAMENTO_PROVA_ESTADO" (treinamento_id, user_id)
  VALUES (t.id, v_uid) ON CONFLICT (treinamento_id, user_id) DO NOTHING;
  SELECT * INTO e FROM public."TREINAMENTO_PROVA_ESTADO"
   WHERE treinamento_id = t.id AND user_id = v_uid FOR UPDATE;

  IF e.bloqueado THEN
    RAISE EXCEPTION 'Você atingiu o limite de tentativas desta prova. A equipe já foi avisada e vai liberar uma nova rodada.';
  END IF;
  IF public.trn_precisa_ver_video(t, e, v_uid) THEN
    RAISE EXCEPTION '%', CASE WHEN e.ultima_tentativa_em IS NULL
      THEN 'Assista o vídeo até o fim antes de fazer a prova.'
      ELSE 'Assista o vídeo novamente até o fim antes de refazer a prova.' END;
  END IF;

  -- Correção. Questão sem resposta conta como erro (corrigirProva, core.ts).
  FOR q IN SELECT * FROM jsonb_array_elements(t.prova) LOOP
    v_id := q->>'id';
    v_total := v_total + 1;
    v_marcou := _respostas->>v_id;
    v_certo := v_marcou IS NOT NULL AND v_gab ? v_id AND v_marcou = (v_gab->>v_id);
    IF v_certo THEN v_acertos := v_acertos + 1; END IF;
    v_por := v_por || to_jsonb(v_certo);
  END LOOP;
  v_nota  := round(v_acertos * 100.0 / v_total);
  v_aprov := v_nota >= t.nota_minima;

  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_nome FROM public.profiles WHERE id = v_uid;
  SELECT count(*) + 1 INTO v_numero FROM public."TREINAMENTO_TENTATIVA" WHERE treinamento_id = t.id AND user_id = v_uid;

  INSERT INTO public."TREINAMENTO_TENTATIVA"
    (treinamento_id, user_id, usuario_nome, numero, acertos, total, nota, nota_minima, aprovado, respostas)
  VALUES (t.id, v_uid, v_nome, v_numero, v_acertos, v_total, v_nota, t.nota_minima, v_aprov, _respostas);

  v_falhas := CASE WHEN v_aprov THEN 0 ELSE e.falhas_seguidas + 1 END;
  v_bloq := NOT v_aprov AND t.max_tentativas IS NOT NULL AND v_falhas >= t.max_tentativas;

  UPDATE public."TREINAMENTO_PROVA_ESTADO"
     SET ultima_tentativa_em = now(), ultima_aprovada = v_aprov, falhas_seguidas = v_falhas,
         bloqueado = v_bloq, bloqueado_em = CASE WHEN v_bloq THEN now() ELSE bloqueado_em END
   WHERE treinamento_id = t.id AND user_id = v_uid;

  -- Histórico de conclusão (grade e Dashboard de vídeos): a última tentativa vale.
  INSERT INTO public."TREINAMENTO_CONCLUSAO"
    (treinamento_id, user_id, usuario_nome, prova_nota, prova_respostas, aprovado, tentativas, concluido_em)
  VALUES (t.id, v_uid, v_nome, v_nota, _respostas, v_aprov, v_numero, now())
  ON CONFLICT (treinamento_id, user_id) DO UPDATE
     SET usuario_nome = EXCLUDED.usuario_nome, prova_nota = EXCLUDED.prova_nota,
         prova_respostas = EXCLUDED.prova_respostas, aprovado = EXCLUDED.aprovado,
         tentativas = EXCLUDED.tentativas, concluido_em = EXCLUDED.concluido_em;

  IF v_bloq THEN
    INSERT INTO public."TREINAMENTO_ALERTA"
      (treinamento_id, treinamento_titulo, user_id, usuario_nome, tentativas, ultima_nota, nota_minima)
    VALUES (t.id, t.titulo, v_uid, v_nome, v_falhas, v_nota, t.nota_minima)
    ON CONFLICT (treinamento_id, user_id) WHERE status = 'aberto' DO NOTHING
    RETURNING * INTO a;
    IF a.id IS NOT NULL THEN PERFORM public.trn_notificar_alerta(a); END IF;
  END IF;

  RETURN jsonb_build_object(
    'acertos', v_acertos, 'total', v_total, 'nota', v_nota, 'nota_minima', t.nota_minima,
    'aprovado', v_aprov, 'por_questao', v_por,
    -- O gabarito só volta para quem passou: a quem vai refazer, mostrar a
    -- resposta certa seria entregar a próxima prova.
    'gabarito', CASE WHEN v_aprov THEN v_gab ELSE NULL END,
    'tentativa', v_numero, 'falhas_seguidas', v_falhas, 'max_tentativas', t.max_tentativas,
    'restantes', CASE WHEN t.max_tentativas IS NULL THEN NULL ELSE greatest(t.max_tentativas - v_falhas, 0) END,
    'bloqueado', v_bloq,
    'precisa_ver_video', NOT v_aprov AND public.trn_video_rastreavel(t.video_url, t.video_path));
END $$;
REVOKE ALL ON FUNCTION public.trn_prova_enviar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_prova_enviar(uuid, jsonb) TO authenticated;

-- Tratar o alerta: liberar nova rodada (zera as reprovações e destrava) ou encerrar.
CREATE OR REPLACE FUNCTION public.trn_alerta_tratar(_alerta uuid, _acao text, _obs text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  uuid := auth.uid();
  a      public."TREINAMENTO_ALERTA";
  v_nome text;
  v_obs  text := nullif(btrim(coalesce(_obs, '')), '');
BEGIN
  IF v_uid IS NULL OR NOT public.trn_pode_tratar_alertas() THEN
    RAISE EXCEPTION 'Você não pode tratar alertas de treinamento. Peça "Recebe alertas de treinamento" (alterar) em Acesso por Usuário › Treinamentos.'
      USING ERRCODE = '42501';
  END IF;
  IF _acao NOT IN ('liberar', 'encerrar') THEN RAISE EXCEPTION 'Ação inválida.'; END IF;
  SELECT * INTO a FROM public."TREINAMENTO_ALERTA" WHERE id = _alerta FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Alerta não encontrado.'; END IF;
  IF a.status <> 'aberto' THEN RAISE EXCEPTION 'Este alerta já foi tratado.'; END IF;
  IF _acao = 'encerrar' AND v_obs IS NULL THEN
    RAISE EXCEPTION 'Para encerrar sem liberar, escreva o que foi verificado.';
  END IF;

  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_nome FROM public.profiles WHERE id = v_uid;
  UPDATE public."TREINAMENTO_ALERTA"
     SET status = CASE WHEN _acao = 'liberar' THEN 'liberado' ELSE 'encerrado' END,
         tratado_por = v_uid, tratado_por_nome = v_nome, tratado_em = now(), tratado_obs = v_obs
   WHERE id = a.id;

  IF _acao = 'liberar' THEN
    UPDATE public."TREINAMENTO_PROVA_ESTADO"
       SET bloqueado = false, falhas_seguidas = 0, liberacoes = liberacoes + 1
     WHERE treinamento_id = a.treinamento_id AND user_id = a.user_id;
    BEGIN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (a.user_id, 'Prova liberada: ' || coalesce(a.treinamento_titulo, 'treinamento'),
              'Você ganhou uma nova rodada de tentativas. Assista o vídeo novamente e refaça a prova.'
                || coalesce(' Observação: ' || v_obs, ''),
              'treinamento_liberado', '/app/central-servicos/treinamentos-sistemas');
    EXCEPTION WHEN others THEN
      RAISE WARNING 'trn_alerta_tratar (aviso ao colaborador): %', SQLERRM;
    END;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.trn_alerta_tratar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alerta_tratar(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Atenção: o gabarito está em TREINAMENTO_GABARITO. Antes de apagar, devolver
-- para o jsonb (com o gatilho já removido):
--   DROP TRIGGER IF EXISTS trg_trn_separar_gabarito ON public."TREINAMENTOS";
--   UPDATE public."TREINAMENTOS" t SET prova = (
--     SELECT jsonb_agg(jsonb_set(e, '{correta}', coalesce(g.respostas->(e->>'id'), '0'::jsonb)) ORDER BY o)
--       FROM jsonb_array_elements(t.prova) WITH ORDINALITY x(e, o))
--     FROM public."TREINAMENTO_GABARITO" g WHERE g.treinamento_id = t.id;
-- Depois:
-- DROP FUNCTION IF EXISTS public.trn_alerta_tratar(uuid, text, text);
-- DROP FUNCTION IF EXISTS public.trn_prova_enviar(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.trn_notificar_alerta(public."TREINAMENTO_ALERTA");
-- DROP FUNCTION IF EXISTS public.trn_video_assistido(uuid);
-- DROP FUNCTION IF EXISTS public.trn_prova_estado(uuid);
-- DROP FUNCTION IF EXISTS public.trn_treinamento_acessivel(uuid);
-- DROP FUNCTION IF EXISTS public.trn_precisa_ver_video(public."TREINAMENTOS", public."TREINAMENTO_PROVA_ESTADO", uuid);
-- DROP FUNCTION IF EXISTS public.trn_video_rastreavel(text, text);
-- DROP FUNCTION IF EXISTS public.trn_separar_gabarito();
-- DROP TABLE IF EXISTS public."TREINAMENTO_ALERTA", public."TREINAMENTO_TENTATIVA",
--   public."TREINAMENTO_PROVA_ESTADO", public."TREINAMENTO_GABARITO";
-- Reaplicar trn_conc_insert/trn_conc_update da 20260925000001 e
-- trn_pode_ver_escopos da 20260930000055; DROP POLICY trn_stg_read_sistemas ON storage.objects;
-- ALTER TABLE public."TREINAMENTOS" DROP CONSTRAINT trn_max_tentativas_valido,
--   DROP COLUMN tipo, DROP COLUMN modulo_sistema, DROP COLUMN max_tentativas;
-- (trn_escopos_validos: só depois de tirar 'sistemas' das linhas.)
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'treinamentos_alertas';
-- DELETE FROM public.app_menu      WHERE codigo      = 'treinamentos_alertas';
-- NOTIFY pgrst, 'reload schema';
