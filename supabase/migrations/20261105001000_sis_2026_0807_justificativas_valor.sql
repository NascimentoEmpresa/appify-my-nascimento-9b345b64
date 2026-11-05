-- ============================================================================
-- SIS-2026-0807 — Justificativas de valor (fase 1): a Controladoria cobra de um gerente a explicação de um valor da Lucratividade de Contratos
-- ============================================================================
-- Fluxo (fase 1):
--   Controladoria cobra (contrato + mês + coluna, com a pergunta, o responsável, o prazo e, se quiser, os lançamentos em dúvida)
--     → aberta → o responsável responde → respondida → a Controladoria encerra (ok) ou reabre (devolve com comentário) ou cancela.
--   Todo movimento fica em controladoria_justificativa_evento (ninguém apaga nem edita).
-- A fase 2 (reclassificar e o Financeiro aceitar, gravando o ajuste no Fluxo) vem depois e usa estas mesmas tabelas.
--
-- Acesso (por usuário, nunca por cargo):
--   menu 'justificativas-valor'  (Controladoria: gestão)    visualizar = ver todas | incluir = cobrar | alterar = encerrar/reabrir/cancelar
--   menu 'minhas-justificativas' (quem responde)            visualizar = ver as que foram dirigidas a ele | alterar = responder
--   O gerente NÃO precisa de acesso ao Fluxo de Caixa: os lançamentos em dúvida são copiados (foto) para a cobrança no momento em que ela é criada.
--
-- Escrita só pelas RPCs (SECURITY DEFINER), que conferem permissão, estado e dono da cobrança. Tabelas sem policy de escrita.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.justificativa_decidir(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.justificativa_responder(uuid, text);
--   DROP FUNCTION IF EXISTS public.justificativa_solicitar(uuid, date, text, text, numeric, text, text, uuid, date, jsonb);
--   DROP TABLE IF EXISTS public.controladoria_justificativa_evento;
--   DROP TABLE IF EXISTS public.controladoria_justificativa_lancamento;
--   DROP TABLE IF EXISTS public.controladoria_justificativa;
--   DROP FUNCTION IF EXISTS public.controladoria_justificativa_gerar_numero();
--   DROP SEQUENCE IF EXISTS public.controladoria_justificativa_numero_seq;
--   DELETE FROM public.app_menu_acao WHERE menu_codigo IN ('justificativas-valor', 'minhas-justificativas');
--   DELETE FROM public.app_menu WHERE codigo IN ('justificativas-valor', 'minhas-justificativas');
--   NOTIFY pgrst, 'reload schema';

-- ── 1. Menus e ações ────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, v.codigo, v.nome, v.rota, v.ordem
  FROM public.app_modulo m
  CROSS JOIN (VALUES
    ('justificativas-valor',  'Justificativas de Valor', '/app/controladoria/justificativas',         53),
    ('minhas-justificativas', 'Minhas Justificativas',   '/app/controladoria/minhas-justificativas',  54)
  ) AS v(codigo, nome, rota, ordem)
 WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('justificativas-valor',  'visualizar'),
  ('justificativas-valor',  'incluir'),
  ('justificativas-valor',  'alterar'),
  ('minhas-justificativas', 'visualizar'),
  ('minhas-justificativas', 'alterar')
ON CONFLICT DO NOTHING;

-- ── 2. Tabelas ──────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.controladoria_justificativa_numero_seq;

CREATE TABLE IF NOT EXISTS public.controladoria_justificativa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL,
  contrato_id uuid NOT NULL REFERENCES public.contratos(id),
  mes date NOT NULL CHECK (mes = date_trunc('month', mes)::date),
  -- coluna da Lucratividade: valor_exec | valor_bruto | valor_liquido | desc_contrato | rubrica:<id> | total_custos | lucro_bruto | margem
  coluna text NOT NULL,
  coluna_rotulo text NOT NULL,
  valor_referencia numeric(15,2),            -- o que a Controladoria viu na célula quando cobrou
  base_leitura text CHECK (base_leitura IN ('competencia', 'pagamento')),
  pergunta text NOT NULL CHECK (length(btrim(pergunta)) >= 5),
  responsavel_id uuid NOT NULL,              -- usuário que precisa responder (sem FK: nem sempre o cadastro acompanha o login)
  prazo date,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'respondida', 'encerrada', 'cancelada')),
  resposta text,
  respondida_em timestamptz,
  respondida_por uuid,
  encerrada_em timestamptz,
  encerrada_por uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS controladoria_justificativa_numero ON public.controladoria_justificativa (numero);
CREATE INDEX IF NOT EXISTS controladoria_justificativa_contrato_mes ON public.controladoria_justificativa (contrato_id, mes);
CREATE INDEX IF NOT EXISTS controladoria_justificativa_responsavel ON public.controladoria_justificativa (responsavel_id, status);
CREATE INDEX IF NOT EXISTS controladoria_justificativa_status ON public.controladoria_justificativa (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.controladoria_justificativa_lancamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  justificativa_id uuid NOT NULL REFERENCES public.controladoria_justificativa(id) ON DELETE CASCADE,
  id_lancamento text,                        -- ID do lançamento no Fluxo (ex.: DM-2026-0123), foto do momento da cobrança
  descricao text,
  classificacao text,
  data_pagamento date,
  valor numeric(15,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS controladoria_justificativa_lancamento_just ON public.controladoria_justificativa_lancamento (justificativa_id);

CREATE TABLE IF NOT EXISTS public.controladoria_justificativa_evento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  justificativa_id uuid NOT NULL REFERENCES public.controladoria_justificativa(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('solicitada', 'respondida', 'encerrada', 'reaberta', 'cancelada')),
  ator_id uuid,
  texto text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS controladoria_justificativa_evento_just ON public.controladoria_justificativa_evento (justificativa_id, created_at);

-- Número CGJ-style: JV-AAAA-NNNN. SECURITY DEFINER porque a sequence não é do usuário que dispara a RPC.
CREATE OR REPLACE FUNCTION public.controladoria_justificativa_gerar_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    NEW.numero := 'JV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.controladoria_justificativa_numero_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_controladoria_justificativa_numero ON public.controladoria_justificativa;
CREATE TRIGGER trg_controladoria_justificativa_numero BEFORE INSERT ON public.controladoria_justificativa
  FOR EACH ROW EXECUTE FUNCTION public.controladoria_justificativa_gerar_numero();

-- ── 3. RLS: leitura por acesso; nenhuma escrita direta ──────────────────────
ALTER TABLE public.controladoria_justificativa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controladoria_justificativa_lancamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controladoria_justificativa_evento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS controladoria_justificativa_select ON public.controladoria_justificativa;
CREATE POLICY controladoria_justificativa_select ON public.controladoria_justificativa
  FOR SELECT TO authenticated
  USING (
    (SELECT public.can_access((SELECT auth.uid()), 'justificativas-valor', 'visualizar'))
    OR (responsavel_id = (SELECT auth.uid()) AND (SELECT public.can_access((SELECT auth.uid()), 'minhas-justificativas', 'visualizar')))
  );

-- Os filhos seguem o pai: quem enxerga a cobrança enxerga os lançamentos e os eventos dela.
DROP POLICY IF EXISTS controladoria_justificativa_lancamento_select ON public.controladoria_justificativa_lancamento;
CREATE POLICY controladoria_justificativa_lancamento_select ON public.controladoria_justificativa_lancamento
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.controladoria_justificativa j WHERE j.id = justificativa_id));

DROP POLICY IF EXISTS controladoria_justificativa_evento_select ON public.controladoria_justificativa_evento;
CREATE POLICY controladoria_justificativa_evento_select ON public.controladoria_justificativa_evento
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.controladoria_justificativa j WHERE j.id = justificativa_id));

GRANT SELECT ON public.controladoria_justificativa, public.controladoria_justificativa_lancamento, public.controladoria_justificativa_evento TO authenticated;

-- ── 4. RPC: cobrar ──────────────────────────────────────────────────────────
-- _lancamentos: jsonb [{id_lancamento, descricao, classificacao, data_pagamento, valor}], opcional (até 300).
DROP FUNCTION IF EXISTS public.justificativa_solicitar(uuid, date, text, text, numeric, text, text, uuid, date, jsonb);
CREATE FUNCTION public.justificativa_solicitar(
  _contrato_id uuid, _mes date, _coluna text, _coluna_rotulo text, _valor_referencia numeric, _base text,
  _pergunta text, _responsavel_id uuid, _prazo date DEFAULT NULL, _lancamentos jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_contrato text;
  v_numero text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'justificativas-valor', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para cobrar justificativa.';
  END IF;
  IF COALESCE(btrim(_pergunta), '') = '' OR length(btrim(_pergunta)) < 5 THEN
    RAISE EXCEPTION 'Escreva o que precisa ser justificado.';
  END IF;
  IF _mes IS NULL OR _mes <> date_trunc('month', _mes)::date THEN
    RAISE EXCEPTION 'Mês inválido (use o primeiro dia do mês).';
  END IF;
  IF COALESCE(btrim(_coluna), '') = '' OR COALESCE(btrim(_coluna_rotulo), '') = '' THEN
    RAISE EXCEPTION 'Informe a coluna a justificar.';
  END IF;
  IF _prazo IS NOT NULL AND _prazo < current_date THEN
    RAISE EXCEPTION 'O prazo não pode ser anterior a hoje.';
  END IF;
  SELECT nome INTO v_contrato FROM public.contratos WHERE id = _contrato_id;
  IF v_contrato IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _responsavel_id AND ativo = true) THEN
    RAISE EXCEPTION 'O responsável precisa ser um usuário ativo.';
  END IF;
  IF jsonb_typeof(COALESCE(_lancamentos, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_lancamentos, '[]'::jsonb)) > 300 THEN
    RAISE EXCEPTION 'Informe no máximo 300 lançamentos.';
  END IF;

  INSERT INTO public.controladoria_justificativa (
    numero, contrato_id, mes, coluna, coluna_rotulo, valor_referencia, base_leitura, pergunta, responsavel_id, prazo, created_by
  ) VALUES (
    '', _contrato_id, _mes, _coluna, _coluna_rotulo, _valor_referencia,
    CASE WHEN _base IN ('competencia', 'pagamento') THEN _base END,
    btrim(_pergunta), _responsavel_id, _prazo, auth.uid()
  ) RETURNING id, numero INTO v_id, v_numero;

  INSERT INTO public.controladoria_justificativa_lancamento (justificativa_id, id_lancamento, descricao, classificacao, data_pagamento, valor)
  SELECT v_id, NULLIF(x->>'id_lancamento', ''), NULLIF(x->>'descricao', ''), NULLIF(x->>'classificacao', ''),
         NULLIF(x->>'data_pagamento', '')::date, COALESCE((x->>'valor')::numeric, 0)
    FROM jsonb_array_elements(COALESCE(_lancamentos, '[]'::jsonb)) AS x;

  INSERT INTO public.controladoria_justificativa_evento (justificativa_id, tipo, ator_id, texto)
  VALUES (v_id, 'solicitada', auth.uid(), btrim(_pergunta));

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT _responsavel_id,
         'Justificativa solicitada: ' || v_numero,
         v_contrato || ' · ' || _coluna_rotulo || ' · ' || to_char(_mes, 'MM/YYYY') || CASE WHEN _prazo IS NOT NULL THEN ' · responder até ' || to_char(_prazo, 'DD/MM/YYYY') ELSE '' END,
         'justificativa_valor',
         '/app/controladoria/minhas-justificativas?id=' || v_id
   WHERE _responsavel_id IS DISTINCT FROM auth.uid();

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.justificativa_solicitar(uuid, date, text, text, numeric, text, text, uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.justificativa_solicitar(uuid, date, text, text, numeric, text, text, uuid, date, jsonb) TO authenticated;

-- ── 5. RPC: responder (só o responsável da cobrança) ─────────────────────────
DROP FUNCTION IF EXISTS public.justificativa_responder(uuid, text);
CREATE FUNCTION public.justificativa_responder(_id uuid, _texto text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j public.controladoria_justificativa%ROWTYPE;
BEGIN
  IF NOT public.can_access(auth.uid(), 'minhas-justificativas', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para responder justificativa.';
  END IF;
  SELECT * INTO j FROM public.controladoria_justificativa WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Justificativa não encontrada.';
  END IF;
  IF j.responsavel_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só o responsável indicado pode responder esta justificativa.';
  END IF;
  IF j.status <> 'aberta' THEN
    RAISE EXCEPTION 'Esta justificativa não está aberta para resposta (situação: %).', j.status;
  END IF;
  IF COALESCE(length(btrim(_texto)), 0) < 10 THEN
    RAISE EXCEPTION 'Explique o valor com pelo menos 10 caracteres.';
  END IF;

  UPDATE public.controladoria_justificativa
     SET status = 'respondida', resposta = btrim(_texto), respondida_em = now(), respondida_por = auth.uid(), updated_at = now()
   WHERE id = _id;
  INSERT INTO public.controladoria_justificativa_evento (justificativa_id, tipo, ator_id, texto) VALUES (_id, 'respondida', auth.uid(), btrim(_texto));

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT j.created_by, 'Justificativa respondida: ' || j.numero, j.coluna_rotulo || ' · ' || to_char(j.mes, 'MM/YYYY'), 'justificativa_valor',
         '/app/controladoria/justificativas?id=' || _id
   WHERE j.created_by IS DISTINCT FROM auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.justificativa_responder(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.justificativa_responder(uuid, text) TO authenticated;

-- ── 6. RPC: encerrar / reabrir / cancelar (Controladoria) ────────────────────
DROP FUNCTION IF EXISTS public.justificativa_decidir(uuid, text, text);
CREATE FUNCTION public.justificativa_decidir(_id uuid, _acao text, _texto text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j public.controladoria_justificativa%ROWTYPE;
  v_texto text := NULLIF(btrim(COALESCE(_texto, '')), '');
BEGIN
  IF NOT public.can_access(auth.uid(), 'justificativas-valor', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para decidir justificativa.';
  END IF;
  IF _acao NOT IN ('encerrar', 'reabrir', 'cancelar') THEN
    RAISE EXCEPTION 'Ação inválida.';
  END IF;
  SELECT * INTO j FROM public.controladoria_justificativa WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Justificativa não encontrada.';
  END IF;

  IF _acao = 'encerrar' THEN
    IF j.status <> 'respondida' THEN
      RAISE EXCEPTION 'Só se encerra uma justificativa já respondida (situação: %).', j.status;
    END IF;
    UPDATE public.controladoria_justificativa SET status = 'encerrada', encerrada_em = now(), encerrada_por = auth.uid(), updated_at = now() WHERE id = _id;
    INSERT INTO public.controladoria_justificativa_evento (justificativa_id, tipo, ator_id, texto) VALUES (_id, 'encerrada', auth.uid(), v_texto);

  ELSIF _acao = 'reabrir' THEN
    IF j.status NOT IN ('respondida', 'encerrada') THEN
      RAISE EXCEPTION 'Só se reabre uma justificativa respondida ou encerrada (situação: %).', j.status;
    END IF;
    IF v_texto IS NULL THEN
      RAISE EXCEPTION 'Explique o que falta ao devolver a justificativa.';
    END IF;
    UPDATE public.controladoria_justificativa
       SET status = 'aberta', resposta = NULL, respondida_em = NULL, respondida_por = NULL, encerrada_em = NULL, encerrada_por = NULL, updated_at = now()
     WHERE id = _id;
    INSERT INTO public.controladoria_justificativa_evento (justificativa_id, tipo, ator_id, texto) VALUES (_id, 'reaberta', auth.uid(), v_texto);
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT j.responsavel_id, 'Justificativa devolvida: ' || j.numero, v_texto, 'justificativa_valor', '/app/controladoria/minhas-justificativas?id=' || _id
     WHERE j.responsavel_id IS DISTINCT FROM auth.uid();

  ELSE
    IF j.status NOT IN ('aberta', 'respondida') THEN
      RAISE EXCEPTION 'Só se cancela uma justificativa em andamento (situação: %).', j.status;
    END IF;
    IF v_texto IS NULL THEN
      RAISE EXCEPTION 'Informe o motivo do cancelamento.';
    END IF;
    UPDATE public.controladoria_justificativa SET status = 'cancelada', encerrada_em = now(), encerrada_por = auth.uid(), updated_at = now() WHERE id = _id;
    INSERT INTO public.controladoria_justificativa_evento (justificativa_id, tipo, ator_id, texto) VALUES (_id, 'cancelada', auth.uid(), v_texto);
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT j.responsavel_id, 'Justificativa cancelada: ' || j.numero, v_texto, 'justificativa_valor', '/app/controladoria/minhas-justificativas?id=' || _id
     WHERE j.responsavel_id IS DISTINCT FROM auth.uid();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.justificativa_decidir(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.justificativa_decidir(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
