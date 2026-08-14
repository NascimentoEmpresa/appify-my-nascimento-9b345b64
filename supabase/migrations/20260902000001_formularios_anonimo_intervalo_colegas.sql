-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — resposta anônima, intervalo entre respostas e
-- pergunta "avaliação de colegas" (com as regras valendo no BANCO).
--
-- Três recursos que valem para QUALQUER formulário novo (nada é hard-coded
-- num formulário específico):
--
-- 1) RESPOSTA ANÔNIMA  (CS_FORMULARIOS.permite_anonimo)
--    Ligado, o respondente escolhe na hora de enviar: identificado ou
--    anônimo. Anônimo é anônimo DE VERDADE — o trigger abaixo apaga
--    criado_por, nome, e-mail e o snapshot de cadastro ANTES de gravar; não
--    existe coluna escondida ligando a resposta à pessoa. O setor continua
--    (é dele que vivem os painéis, e ele não identifica ninguém).
--
-- 2) INTERVALO ENTRE RESPOSTAS  (CS_FORMULARIOS.intervalo_horas)
--    "só pode responder 1x a cada N horas/dias". Como a resposta anônima
--    não guarda quem respondeu, o carimbo de quem enviou vai para uma tabela
--    À PARTE (CS_FORM_ENVIOS): formulário + usuário + data, SEM ponteiro para
--    a resposta. Ela é fechada a anon/authenticated — só as funções
--    SECURITY DEFINER daqui leem —, então serve de relógio sem desanonimizar
--    ninguém. A trava está na policy de INSERT, não só na tela.
--    LIMITE CONHECIDO: formulário 'liberado' (sem login) não tem identidade
--    p/ contar o intervalo — ali a regra não se aplica.
--
-- 3) PERGUNTA "COLEGAS"  (perguntas[].tipo = 'colegas')
--    Uma pergunta com N linhas: colega + setor + nota + comentário. A config
--    da pergunta diz o que é obrigatório:
--      min_colegas       int   — mínimo de colegas indicados
--      max_colegas       int   — teto (0/ausente = sem teto)
--      setores_distintos bool  — no máximo 1 colega por setor
--      excluir_proprio   bool  — não pode indicar a si mesmo (padrão: sim)
--      nota_obrigatoria  bool  — toda linha precisa de nota
--    Valor gravado em itens[pergunta_id] = array de
--      {colaborador, setor, nota, comentario}
--    O trigger valida essas regras no INSERT: a tela ajuda, o banco decide.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Colunas novas ─────────────────────────────────────────────────────
ALTER TABLE public."CS_FORMULARIOS"
  ADD COLUMN IF NOT EXISTS permite_anonimo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intervalo_horas integer;

ALTER TABLE public."CS_FORMULARIOS" DROP CONSTRAINT IF EXISTS cs_forms_intervalo_check;
ALTER TABLE public."CS_FORMULARIOS" ADD  CONSTRAINT cs_forms_intervalo_check
  CHECK (intervalo_horas IS NULL OR intervalo_horas > 0);

ALTER TABLE public."CS_FORM_RESPOSTAS"
  ADD COLUMN IF NOT EXISTS anonimo boolean NOT NULL DEFAULT false;

-- ── 2) Carimbo de envio (relógio do intervalo, sem identificar a resposta) ─
CREATE TABLE IF NOT EXISTS public."CS_FORM_ENVIOS" (
  formulario_id uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  enviado_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (formulario_id, user_id, enviado_em)
);
CREATE INDEX IF NOT EXISTS cs_form_envios_idx
  ON public."CS_FORM_ENVIOS"(formulario_id, user_id, enviado_em DESC);

ALTER TABLE public."CS_FORM_ENVIOS" ENABLE ROW LEVEL SECURITY;
-- Sem policy e sem GRANT: ninguém lê pelo PostgREST. Só as funções abaixo.
REVOKE ALL ON public."CS_FORM_ENVIOS" FROM anon, authenticated;

-- ── 3) Pode responder agora? (intervalo entre respostas) ─────────────────
-- Sem intervalo configurado, sem login, ou nunca respondeu → true.
CREATE OR REPLACE FUNCTION public.cs_form_pode_responder(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public."CS_FORMULARIOS" f
      JOIN public."CS_FORM_ENVIOS" e
        ON e.formulario_id = f.id AND e.user_id = auth.uid()
     WHERE f.id = _form_id
       AND f.intervalo_horas IS NOT NULL
       AND auth.uid() IS NOT NULL
       AND e.enviado_em > now() - make_interval(hours => f.intervalo_horas));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_pode_responder(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cs_form_pode_responder(uuid) TO anon, authenticated;

-- Mesma conta, mas contando a história p/ a tela: quando respondeu e quando
-- libera de novo. É o que a página pública mostra em vez de um erro seco.
CREATE OR REPLACE FUNCTION public.cs_form_prazo(_form_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
           'pode', public.cs_form_pode_responder(_form_id),
           'intervalo_horas', f.intervalo_horas,
           'ultima_em', u.ultima,
           'proxima_em', CASE WHEN f.intervalo_horas IS NULL OR u.ultima IS NULL THEN NULL
                              ELSE u.ultima + make_interval(hours => f.intervalo_horas) END)
    FROM public."CS_FORMULARIOS" f
    LEFT JOIN LATERAL (
      SELECT max(e.enviado_em) AS ultima
        FROM public."CS_FORM_ENVIOS" e
       WHERE e.formulario_id = f.id AND e.user_id = auth.uid()
    ) u ON true
   WHERE f.id = _form_id;
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_prazo(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cs_form_prazo(uuid) TO anon, authenticated;

-- ── 4) Guarda da resposta: anonimiza, valida "colegas" e carimba o envio ──
-- Roda como trigger da tabela (não é chamável pelo client). BEFORE INSERT
-- porque precisa APAGAR a identidade antes de a linha existir — anonimizar
-- depois deixaria o dado gravado por um instante.
CREATE OR REPLACE FUNCTION public.cs_form_resposta_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form   record;
  v_perg   jsonb;
  v_cfg    jsonb;
  v_linhas jsonb;
  v_linha  jsonb;
  v_nome   text;      -- nome do próprio respondente (p/ "não pode ser você")
  v_tit    text;
  v_min    int;
  v_max    int;
  v_n      int;
  v_setor  text;
  v_colega text;
  v_setores text[];
  v_colegas text[];
BEGIN
  SELECT * INTO v_form FROM public."CS_FORMULARIOS" WHERE id = NEW.formulario_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- 4.1 Anonimato: só se o formulário permite, e aí some TUDO que identifica.
  IF COALESCE(NEW.anonimo, false) THEN
    IF NOT COALESCE(v_form.permite_anonimo, false) THEN
      RAISE EXCEPTION 'Este formulário não aceita resposta anônima.';
    END IF;
    NEW.criado_por           := NULL;
    NEW.respondente_nome     := NULL;
    NEW.respondente_email    := NULL;
    NEW.respondente_cadastro := NULL;
  END IF;

  -- 4.2 Nome oficial de quem está respondendo (só serve p/ barrar auto-indicação).
  SELECT e."Nome" INTO v_nome
    FROM public."EMPREGADOS" e
   WHERE e.auth_user_id = auth.uid()
   LIMIT 1;

  -- 4.3 Regras das perguntas do tipo "colegas".
  FOR v_perg IN SELECT * FROM jsonb_array_elements(COALESCE(v_form.perguntas, '[]'::jsonb))
  LOOP
    CONTINUE WHEN COALESCE(v_perg->>'tipo', '') <> 'colegas';
    v_cfg  := COALESCE(v_perg->'config', '{}'::jsonb);
    v_tit  := COALESCE(NULLIF(btrim(COALESCE(v_perg->>'titulo', '')), ''), 'Avaliação de colegas');
    v_linhas := COALESCE(NEW.itens -> (v_perg->>'id'), '[]'::jsonb);
    IF jsonb_typeof(v_linhas) <> 'array' THEN v_linhas := '[]'::jsonb; END IF;

    v_n := 0; v_setores := '{}'; v_colegas := '{}';
    FOR v_linha IN SELECT * FROM jsonb_array_elements(v_linhas)
    LOOP
      v_colega := btrim(COALESCE(v_linha->>'colaborador', ''));
      CONTINUE WHEN v_colega = '';                 -- linha em branco não conta
      v_setor  := upper(btrim(COALESCE(v_linha->>'setor', '')));
      v_n := v_n + 1;

      -- Não pode indicar a si mesmo.
      IF COALESCE(v_cfg->>'excluir_proprio', 'true') <> 'false'
         AND v_nome IS NOT NULL
         AND upper(btrim(v_nome)) = upper(v_colega) THEN
        RAISE EXCEPTION 'Em "%": você não pode indicar a si mesmo.', v_tit;
      END IF;

      -- Mesmo colega duas vezes na mesma pergunta nunca faz sentido.
      IF upper(v_colega) = ANY (v_colegas) THEN
        RAISE EXCEPTION 'Em "%": % foi indicado(a) mais de uma vez.', v_tit, v_colega;
      END IF;
      v_colegas := array_append(v_colegas, upper(v_colega));

      -- No máximo 1 colega por setor (quando a pergunta pede).
      IF COALESCE(v_cfg->>'setores_distintos', 'false') = 'true' AND v_setor <> '' THEN
        IF v_setor = ANY (v_setores) THEN
          RAISE EXCEPTION 'Em "%": só é possível indicar 1 colega por setor (% repetido).', v_tit, v_setor;
        END IF;
        v_setores := array_append(v_setores, v_setor);
      END IF;

      -- Nota obrigatória em cada linha indicada.
      IF COALESCE(v_cfg->>'nota_obrigatoria', 'false') = 'true'
         AND COALESCE(btrim(COALESCE(v_linha->>'nota', '')), '') = '' THEN
        RAISE EXCEPTION 'Em "%": dê uma nota para %.', v_tit, v_colega;
      END IF;
    END LOOP;

    v_min := COALESCE(NULLIF(v_cfg->>'min_colegas', '')::int, 0);
    v_max := COALESCE(NULLIF(v_cfg->>'max_colegas', '')::int, 0);
    IF v_n < v_min THEN
      RAISE EXCEPTION 'Em "%": indique pelo menos % colega(s).', v_tit, v_min;
    END IF;
    IF v_max > 0 AND v_n > v_max THEN
      RAISE EXCEPTION 'Em "%": no máximo % colega(s).', v_tit, v_max;
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cs_form_resposta_guard ON public."CS_FORM_RESPOSTAS";
CREATE TRIGGER trg_cs_form_resposta_guard
  BEFORE INSERT ON public."CS_FORM_RESPOSTAS"
  FOR EACH ROW EXECUTE FUNCTION public.cs_form_resposta_guard();

-- Carimbo do envio: DEPOIS da linha existir, e sempre pelo auth.uid() da
-- sessão — inclusive na resposta anônima, que já teve criado_por apagado.
-- É este registro (e só ele) que sabe "fulano respondeu tal formulário".
CREATE OR REPLACE FUNCTION public.cs_form_registra_envio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public."CS_FORM_ENVIOS" (formulario_id, user_id)
    VALUES (NEW.formulario_id, auth.uid())
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_cs_form_registra_envio ON public."CS_FORM_RESPOSTAS";
CREATE TRIGGER trg_cs_form_registra_envio
  AFTER INSERT ON public."CS_FORM_RESPOSTAS"
  FOR EACH ROW EXECUTE FUNCTION public.cs_form_registra_envio();

-- ── 5) A trava do intervalo entra na policy de INSERT ────────────────────
-- (mesma policy de 20260715000002 + cs_form_pode_responder; 'editar_criar'
--  segue com bypass — é por ela que a importação de respostas passa.)
DROP POLICY IF EXISTS cs_form_resp_ins_auth ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_ins_auth ON public."CS_FORM_RESPOSTAS"
  FOR INSERT TO authenticated WITH CHECK (
    public.cs_form_cap('editar_criar')
    OR (public.cs_form_aberto(formulario_id)
        AND public.cs_form_alvo(formulario_id)
        AND public.cs_form_senha_ok(formulario_id)
        AND public.cs_form_pode_responder(formulario_id)));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP TRIGGER trg_cs_form_resposta_guard  ON public."CS_FORM_RESPOSTAS";
--   DROP TRIGGER trg_cs_form_registra_envio  ON public."CS_FORM_RESPOSTAS";
--   DROP FUNCTION public.cs_form_resposta_guard(), public.cs_form_registra_envio();
--   DROP FUNCTION public.cs_form_prazo(uuid), public.cs_form_pode_responder(uuid);
--   DROP TABLE public."CS_FORM_ENVIOS";
--   e recriar cs_form_resp_ins_auth como está em 20260715000002 (sem o
--   cs_form_pode_responder). As colunas novas podem ficar (default = desligado).
