-- =========================================================================
-- [SEM-CHAMADO] MURAL DO INÍCIO: "CADA UM VÊ SÓ OS SEUS COMENTÁRIOS"
--
-- O PEDIDO (13/11/2026, Pablo)
--   "ao publicar no mural, deixa a opção de CADA UM VER SÓ OS SEUS
--   COMENTÁRIOS BONS, exemplo: ao publicar eu posso ver só os comentários
--   bons feitos pra mim Pablo Flores Santarem. deixa isso configurável ao
--   publicar os comentários > CADA UM VER SÓ OS SEUS COMENTÁRIOS ou TODOS
--   VEREM OS COMENTÁRIOS BONS"
--
-- O DESENHO
--   1. "CS_FORM_MURAL_PUBLICACAO": um modo por FORMULÁRIO + MÊS (a moderação
--      já é por formulário e mês). Sem linha = 'todos' (o que era antes).
--        'todos'    → todo mundo logado vê os recados liberados do mês;
--        'proprios' → cada pessoa vê só os recados feitos PARA ELA.
--   2. cs_form_mural_visibilidade / cs_form_mural_definir_visibilidade: ler
--      e gravar o modo, com a MESMA permissão de liberar
--      (cs_form_pode(form, 'acesso')).
--   3. cs_form_mural_inicio: no modo 'proprios', o recado só sai para quem
--      é a pessoa reconhecida — pelo vínculo do login com "EMPREGADOS"
--      (auth_user_id), comparando o Nome como a pergunta "colegas" grava.
--      O filtro é NO BANCO: os recados dos outros nem chegam ao navegador.
--      Cada item leva 'visibilidade', para o cartão avisar "só você vê".
--      O resto da função é o de 20261114000000 (pessoa uma vez só, sem
--      LATERAL por recado).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1. Modo por formulário + mês ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CS_FORM_MURAL_PUBLICACAO" (
  formulario_id uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  mes           date NOT NULL CHECK (mes = date_trunc('month', mes)::date),
  visibilidade  text NOT NULL DEFAULT 'todos' CHECK (visibilidade IN ('todos', 'proprios')),
  definido_por  uuid,
  definido_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (formulario_id, mes)
);
ALTER TABLE public."CS_FORM_MURAL_PUBLICACAO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_FORM_MURAL_PUBLICACAO" FROM PUBLIC, anon, authenticated;

-- ── 2. Ler / gravar o modo ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_mural_visibilidade(_form_id uuid, _mes date)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.cs_form_pode(_form_id, 'acesso') THEN
    RAISE EXCEPTION 'Sem permissão para o mural deste formulário.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT p.visibilidade FROM public."CS_FORM_MURAL_PUBLICACAO" p
                    WHERE p.formulario_id = _form_id AND p.mes = date_trunc('month', _mes)::date), 'todos');
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_visibilidade(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_visibilidade(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.cs_form_mural_definir_visibilidade(_form_id uuid, _mes date, _visibilidade text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF _visibilidade NOT IN ('todos', 'proprios') THEN
    RAISE EXCEPTION 'Opção inválida: %', _visibilidade USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NULL OR NOT public.cs_form_pode(_form_id, 'acesso') THEN
    RAISE EXCEPTION 'Sem permissão para o mural deste formulário.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."CS_FORM_MURAL_PUBLICACAO" (formulario_id, mes, visibilidade, definido_por, definido_em)
  VALUES (_form_id, date_trunc('month', _mes)::date, _visibilidade, auth.uid(), now())
  ON CONFLICT (formulario_id, mes) DO UPDATE
     SET visibilidade = EXCLUDED.visibilidade, definido_por = EXCLUDED.definido_por, definido_em = EXCLUDED.definido_em;
  RETURN _visibilidade;
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_definir_visibilidade(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_definir_visibilidade(uuid, date, text) TO authenticated;

-- ── 3. O Início respeita o modo ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_mural_inicio()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoje  timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_ini   timestamptz;
  v_fim   timestamptz;
  v_itens jsonb;
  v_meses jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  -- Do 1º dia de 11 meses atrás até o fim do mês corrente: 12 meses civis.
  v_ini := date_trunc('month', v_hoje - interval '11 months') AT TIME ZONE 'America/Sao_Paulo';
  v_fim := (date_trunc('month', v_hoje) + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';

  WITH eu AS (
    -- Os nomes de cadastro do login (normalmente um só).
    SELECT DISTINCT upper(btrim(e."Nome")) AS nome_chave
      FROM public."EMPREGADOS" e
     WHERE e.auth_user_id = auth.uid() AND btrim(coalesce(e."Nome", '')) <> ''
  ),
  pub AS MATERIALIZED (
    SELECT l.*, m.status,
           to_char(l.enviado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS mes,
           upper(btrim(l.colaborador)) AS nome_chave,
           coalesce(pm.visibilidade, 'todos') AS visibilidade
      FROM public.cs_form_mural_linhas(NULL, v_ini, v_fim) l
      JOIN public."CS_FORM_MURAL_RECONHECIMENTO" m
        ON m.resposta_id = l.resposta_id AND m.pergunta_id = l.pergunta_id AND m.linha = l.linha
       AND m.status = 'liberado' AND m.assinatura = l.assinatura
      LEFT JOIN public."CS_FORM_MURAL_PUBLICACAO" pm
        ON pm.formulario_id = l.formulario_id
       AND pm.mes = date_trunc('month', l.enviado_em AT TIME ZONE 'America/Sao_Paulo')::date
     WHERE l.positivo
       AND (coalesce(pm.visibilidade, 'todos') = 'todos'
            OR upper(btrim(l.colaborador)) IN (SELECT nome_chave FROM eu))
  ),
  -- Uma linha por pessoa reconhecida: quem não está demitido primeiro,
  -- depois quem tem login.
  pessoa AS (
    SELECT DISTINCT ON (n.nome_chave)
           n.nome_chave, pr.avatar_url,
           nullif(btrim(coalesce(e."Título do Cargo", '')), '') AS cargo,
           nullif(btrim(coalesce(e."Setor_ERP", '')), '') AS setor
      FROM (SELECT DISTINCT nome_chave FROM pub) n
      JOIN public."EMPREGADOS" e ON upper(btrim(e."Nome")) = n.nome_chave
      LEFT JOIN public.profiles pr ON pr.id = e.auth_user_id
     ORDER BY n.nome_chave, (coalesce(e."Situação", '') ~* 'demitid'), (e.auth_user_id IS NULL)
  )
  SELECT jsonb_agg(jsonb_build_object(
           'chave', p.resposta_id::text || ':' || p.pergunta_id || ':' || p.linha,
           'mes', p.mes,
           'colaborador', p.colaborador, 'setor', coalesce(p.setor, c.setor),
           'cargo', c.cargo, 'avatar_url', c.avatar_url,
           'nota', p.nota, 'escala', p.escala, 'comentario', p.comentario,
           'formulario', p.formulario, 'enviado_em', p.enviado_em, 'status', p.status,
           'visibilidade', p.visibilidade)
         ORDER BY p.mes DESC, p.enviado_em DESC, p.linha),
         (SELECT jsonb_agg(x.mes ORDER BY x.mes DESC) FROM (SELECT DISTINCT mes FROM pub) x)
    INTO v_itens, v_meses
    FROM pub p
    LEFT JOIN pessoa c ON c.nome_chave = p.nome_chave;

  RETURN jsonb_build_object(
    'mes', coalesce(v_meses->>0, to_char(date_trunc('month', v_hoje - interval '1 month'), 'YYYY-MM')),
    'meses', coalesce(v_meses, '[]'::jsonb),
    'itens', coalesce(v_itens, '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_inicio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_inicio() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Reaplicar cs_form_mural_inicio de 20261114000000 (sem o modo).
--   DROP FUNCTION IF EXISTS public.cs_form_mural_definir_visibilidade(uuid, date, text);
--   DROP FUNCTION IF EXISTS public.cs_form_mural_visibilidade(uuid, date);
--   DROP TABLE IF EXISTS public."CS_FORM_MURAL_PUBLICACAO";
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
