-- =========================================================================
-- FORMULÁRIOS — MURAL DE RECONHECIMENTO NO INÍCIO
--
-- PEDIDO (30/10/2026, Pablo)
--   "Adiciona aqui um card > RECONHECIMENTO E CONVIVÊNCIA PROFISSIONAL onde
--   aparecem todos comentários POSITIVOS (SOMENTE) dos usuários, sempre do
--   mês anterior. MAS quem tem acesso às permissões do formulário tem que
--   liberar antes de aparecer no painel inicial."
--
-- DE ONDE VEM O COMENTÁRIO
--   A AVALIAÇÃO DE RECONHECIMENTO E CONVIVÊNCIA PROFISSIONAL é um formulário
--   anônimo com uma pergunta do tipo "colegas" (mig 20260902000001): cada
--   resposta grava em itens[pergunta_id] uma lista de
--     {colaborador, setor, nota, comentario}
--   — o colega AVALIADO, o setor DELE, a nota e o comentário. Uma linha dessa
--   lista é a unidade do mural. Nada aqui é preso a um formulário pelo nome:
--   vale para qualquer formulário com pergunta "colegas", mas só aparece o que
--   alguém liberou de propósito.
--
-- O QUE É "POSITIVO" (cs_form_mural_positivo)
--   A própria linha já diz: a NOTA. Positivo = nota >= 80% do topo da escala
--   da pergunta (escala 5 → 4 ou 5; escala 10 → 8 a 10) E comentário com
--   texto (>= 3 caracteres). Nota baixa ou comentário vazio nunca chega nem à
--   fila de moderação. A nota é o filtro automático; a LIBERAÇÃO humana é a
--   segunda trava — pega o comentário de nota alta com texto que não serve
--   para o mural. A mesma regra mora em src/lib/formularios/muralReconhecimento.ts
--   (testada em src/test/mural-reconhecimento.test.ts): mudou aqui, muda lá.
--
-- QUEM LIBERA
--   "Quem tem acesso às permissões do formulário" = cs_form_pode(_, 'acesso'),
--   a MESMA régua do botão "Acesso" do card do formulário (form_dono /
--   form_gerenciar da lista, o gerente de acesso de Administração › Acesso por
--   Usuário, ver_tudo, ou editar_criar/encerrar_excluir em formulário sem
--   lista). Nenhuma permissão nova, nenhuma tabela de permissão nova.
--
-- MÊS ANTERIOR
--   Mês civil de Brasília (mesma régua de cs_form_participacao_mes). Em
--   novembro o Início mostra os de outubro; em 01/12 vira para novembro
--   sozinho. Quem decide o "hoje" é o banco, não o relógio do navegador.
--
-- ANONIMATO
--   Nenhuma função daqui devolve quem RESPONDEU — nem para o moderador. Sai o
--   colega avaliado, o setor dele, a nota e o comentário. O formulário é
--   anônimo e o mural continua anônimo.
--
-- CS_FORM_MURAL_RECONHECIMENTO fica fechada a anon/authenticated (sem GRANT,
-- sem policy): só as RPCs abaixo leem e escrevem. `assinatura` é o md5 do
-- colega + comentário no momento da liberação — se a linha da resposta mudar
-- depois, a liberação deixa de valer em vez de publicar um texto que ninguém
-- leu.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."CS_FORM_MURAL_RECONHECIMENTO" (
  resposta_id   uuid NOT NULL REFERENCES public."CS_FORM_RESPOSTAS"(id) ON DELETE CASCADE,
  pergunta_id   text NOT NULL,
  linha         integer NOT NULL CHECK (linha >= 0),
  formulario_id uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('liberado', 'recusado')),
  assinatura    text NOT NULL,
  decidido_por  uuid,
  decidido_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resposta_id, pergunta_id, linha)
);
CREATE INDEX IF NOT EXISTS cs_form_mural_rec_form_idx
  ON public."CS_FORM_MURAL_RECONHECIMENTO"(formulario_id, status);

ALTER TABLE public."CS_FORM_MURAL_RECONHECIMENTO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_FORM_MURAL_RECONHECIMENTO" FROM PUBLIC, anon, authenticated;

-- ── 1) A regra do "positivo" ─────────────────────────────────────────────
-- CASE e não AND: o Postgres não promete curto-circuito, e o cast de uma nota
-- não numérica derrubaria a consulta inteira.
CREATE OR REPLACE FUNCTION public.cs_form_mural_positivo(_nota text, _comentario text, _escala integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN length(btrim(coalesce(_comentario, ''))) < 3 THEN false
    WHEN btrim(coalesce(_nota, '')) !~ '^[0-9]+([.,][0-9]+)?$' THEN false
    ELSE replace(btrim(_nota), ',', '.')::numeric
         >= ceil(greatest(2, coalesce(_escala, 5)) * 0.8)
  END;
$$;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_positivo(text, text, integer) TO authenticated;

-- ── 2) As linhas "colegas" de um período, já com o positivo calculado ─────
-- Interna: não tem GRANT. As RPCs abaixo checam a permissão e chamam esta.
-- `linha` é a posição na lista ORIGINAL (com as linhas em branco), para a
-- chave continuar a mesma que a tela de Respostas enxerga.
CREATE OR REPLACE FUNCTION public.cs_form_mural_linhas(_form_id uuid, _ini timestamptz, _fim timestamptz)
RETURNS TABLE (
  resposta_id uuid, formulario_id uuid, formulario text, pergunta_id text, linha integer,
  colaborador text, setor text, nota text, escala integer, comentario text,
  enviado_em timestamptz, assinatura text, positivo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT x.resposta_id, x.formulario_id, x.formulario, x.pergunta_id, x.linha,
         x.colaborador, x.setor, x.nota, x.escala, x.comentario, x.enviado_em,
         md5(upper(x.colaborador) || '|' || x.comentario),
         public.cs_form_mural_positivo(x.nota, x.comentario, x.escala)
    FROM (
      SELECT r.id AS resposta_id, r.formulario_id, f.titulo::text AS formulario,
             p->>'id' AS pergunta_id, (l.ord - 1)::int AS linha,
             btrim(l.v->>'colaborador') AS colaborador,
             nullif(btrim(coalesce(l.v->>'setor', '')), '') AS setor,
             nullif(btrim(coalesce(l.v->>'nota', '')), '') AS nota,
             CASE WHEN coalesce(p->'config'->>'escala_max', '') ~ '^[0-9]+$'
                  THEN (p->'config'->>'escala_max')::int ELSE 5 END AS escala,
             btrim(coalesce(l.v->>'comentario', '')) AS comentario,
             r.enviado_em
        FROM public."CS_FORM_RESPOSTAS" r
        JOIN public."CS_FORMULARIOS" f ON f.id = r.formulario_id AND f.deleted_at IS NULL
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(f.perguntas, '[]'::jsonb)) p
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(r.itens -> (p->>'id')) = 'array'
               THEN r.itens -> (p->>'id') ELSE '[]'::jsonb END) WITH ORDINALITY l(v, ord)
       WHERE p->>'tipo' = 'colegas'
         AND (_form_id IS NULL OR r.formulario_id = _form_id)
         AND r.enviado_em >= _ini AND r.enviado_em < _fim
         AND jsonb_typeof(l.v) = 'object'
         AND btrim(coalesce(l.v->>'colaborador', '')) <> ''
    ) x;
$$;
REVOKE ALL ON FUNCTION public.cs_form_mural_linhas(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 3) Fila de moderação de UM formulário, num mês ────────────────────────
-- Só os POSITIVOS entram na fila: o que não é positivo nunca vai ao mural, e
-- mostrar ao moderador só criaria a tentação de liberar.
CREATE OR REPLACE FUNCTION public.cs_form_mural_moderacao(_form_id uuid, _mes date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ini timestamptz;
  v_fim timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.cs_form_pode(_form_id, 'acesso') THEN
    RAISE EXCEPTION 'Sem permissão para liberar o mural deste formulário.' USING ERRCODE = '42501';
  END IF;

  v_ini := date_trunc('month', _mes::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  v_fim := (date_trunc('month', _mes::timestamp) + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'resposta_id', l.resposta_id, 'pergunta_id', l.pergunta_id, 'linha', l.linha,
             'colaborador', l.colaborador, 'setor', l.setor, 'nota', l.nota, 'escala', l.escala,
             'comentario', l.comentario, 'enviado_em', l.enviado_em,
             -- Liberação de um texto que mudou depois não vale: volta a pendente.
             'status', CASE WHEN m.assinatura = l.assinatura THEN m.status ELSE 'pendente' END,
             'decidido_em', CASE WHEN m.assinatura = l.assinatura THEN m.decidido_em END,
             'decidido_por', CASE WHEN m.assinatura = l.assinatura THEN
               (SELECT coalesce(nullif(btrim(pr.display_name), ''), pr.email)
                  FROM public.profiles pr WHERE pr.id = m.decidido_por) END)
           ORDER BY l.enviado_em, l.linha)
      FROM public.cs_form_mural_linhas(_form_id, v_ini, v_fim) l
      LEFT JOIN public."CS_FORM_MURAL_RECONHECIMENTO" m
        ON m.resposta_id = l.resposta_id AND m.pergunta_id = l.pergunta_id AND m.linha = l.linha
     WHERE l.positivo
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_moderacao(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_moderacao(uuid, date) TO authenticated;

-- ── 4) Liberar / recusar / voltar a pendente ──────────────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_mural_decidir(
  _resposta_id uuid, _pergunta_id text, _linha integer, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_form uuid;
  v_env  timestamptz;
  v_l    record;
BEGIN
  IF _status NOT IN ('liberado', 'recusado', 'pendente') THEN
    RAISE EXCEPTION 'Situação inválida: %', _status USING ERRCODE = '22023';
  END IF;

  SELECT r.formulario_id, r.enviado_em INTO v_form, v_env
    FROM public."CS_FORM_RESPOSTAS" r WHERE r.id = _resposta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resposta não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT public.cs_form_pode(v_form, 'acesso') THEN
    RAISE EXCEPTION 'Sem permissão para liberar o mural deste formulário.' USING ERRCODE = '42501';
  END IF;

  IF _status = 'pendente' THEN
    DELETE FROM public."CS_FORM_MURAL_RECONHECIMENTO"
     WHERE resposta_id = _resposta_id AND pergunta_id = _pergunta_id AND linha = _linha;
    RETURN;
  END IF;

  SELECT * INTO v_l
    FROM public.cs_form_mural_linhas(v_form, v_env, v_env + interval '1 microsecond') l
   WHERE l.resposta_id = _resposta_id AND l.pergunta_id = _pergunta_id AND l.linha = _linha;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comentário não encontrado nesta resposta.' USING ERRCODE = 'P0002';
  END IF;
  -- A trava é aqui, não só na tela: comentário que não é positivo não vai ao mural.
  IF _status = 'liberado' AND NOT v_l.positivo THEN
    RAISE EXCEPTION 'Só comentários positivos podem ir para o mural.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."CS_FORM_MURAL_RECONHECIMENTO"
         (resposta_id, pergunta_id, linha, formulario_id, status, assinatura, decidido_por, decidido_em)
  VALUES (_resposta_id, _pergunta_id, _linha, v_form, _status, v_l.assinatura, auth.uid(), now())
  ON CONFLICT (resposta_id, pergunta_id, linha) DO UPDATE
     SET status = EXCLUDED.status, assinatura = EXCLUDED.assinatura,
         decidido_por = EXCLUDED.decidido_por, decidido_em = EXCLUDED.decidido_em;
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_decidir(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_decidir(uuid, text, integer, text) TO authenticated;

-- ── 5) O que o Início mostra: liberado + positivo + mês anterior ─────────
-- Qualquer logado lê — é um mural, como o de aniversários. A foto e o cargo
-- do colega saem do cadastro pelo nome oficial (a pergunta "colegas" grava o
-- "Nome" da EMPREGADOS); sem casar, o cartão mostra as iniciais.
CREATE OR REPLACE FUNCTION public.cs_form_mural_inicio()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoje timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_ini  timestamptz;
  v_fim  timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  v_ini := date_trunc('month', v_hoje - interval '1 month') AT TIME ZONE 'America/Sao_Paulo';
  v_fim := date_trunc('month', v_hoje) AT TIME ZONE 'America/Sao_Paulo';

  RETURN jsonb_build_object(
    'mes', to_char(date_trunc('month', v_hoje - interval '1 month'), 'YYYY-MM'),
    'itens', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'chave', l.resposta_id::text || ':' || l.pergunta_id || ':' || l.linha,
               'colaborador', l.colaborador, 'setor', coalesce(l.setor, c.setor),
               'cargo', c.cargo, 'avatar_url', c.avatar_url,
               'nota', l.nota, 'escala', l.escala, 'comentario', l.comentario,
               'formulario', l.formulario, 'enviado_em', l.enviado_em, 'status', m.status)
             ORDER BY l.enviado_em DESC, l.linha)
        FROM public.cs_form_mural_linhas(NULL, v_ini, v_fim) l
        JOIN public."CS_FORM_MURAL_RECONHECIMENTO" m
          ON m.resposta_id = l.resposta_id AND m.pergunta_id = l.pergunta_id AND m.linha = l.linha
         AND m.status = 'liberado' AND m.assinatura = l.assinatura
        LEFT JOIN LATERAL (
          SELECT p.avatar_url,
                 nullif(btrim(coalesce(e."Título do Cargo", '')), '') AS cargo,
                 nullif(btrim(coalesce(e."Setor_ERP", '')), '') AS setor
            FROM public."EMPREGADOS" e
            LEFT JOIN public.profiles p ON p.id = e.auth_user_id
           WHERE upper(btrim(e."Nome")) = upper(l.colaborador)
           ORDER BY (coalesce(e."Situação", '') ~* 'demitid'), (e.auth_user_id IS NULL)
           LIMIT 1
        ) c ON true
       WHERE l.positivo
    ), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_inicio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_inicio() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.cs_form_mural_inicio();
-- DROP FUNCTION IF EXISTS public.cs_form_mural_decidir(uuid, text, integer, text);
-- DROP FUNCTION IF EXISTS public.cs_form_mural_moderacao(uuid, date);
-- DROP FUNCTION IF EXISTS public.cs_form_mural_linhas(uuid, timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.cs_form_mural_positivo(text, text, integer);
-- DROP TABLE IF EXISTS public."CS_FORM_MURAL_RECONHECIMENTO";   -- (R2: só com justificativa)
-- NOTIFY pgrst, 'reload schema';
-- =========================================================================
