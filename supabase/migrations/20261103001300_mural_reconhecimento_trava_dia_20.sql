-- =========================================================================
-- FORMULÁRIOS — MURAL DE RECONHECIMENTO: TRAVA DO DIA 20 + LIBERAR EM LOTE
--
-- PEDIDO (03/11/2026, Pablo)
--   Na moderação do "Mural do Início — Reconhecimento" (mig 20261030003200),
--   os votos de um mês só podem ser LIBERADOS a partir do dia 20 do mês
--   seguinte: os de outubro/2026 só a partir de 20/11/2026. Antes disso nada
--   vai ao mural — nem pela tela, nem por chamada direta à RPC.
--
-- ONDE MORA A TRAVA
--   Num trigger BEFORE INSERT/UPDATE em CS_FORM_MURAL_RECONHECIMENTO, e não
--   só dentro de cs_form_mural_decidir: qualquer caminho que grave
--   status = 'liberado' (RPC atual, o lote abaixo, um script futuro) passa
--   pelo mesmo portão. "Hoje" é o relógio do banco em Brasília, não o do
--   navegador. Recusar e voltar a pendente continuam livres a qualquer dia.
--   A mesma conta mora em src/lib/formularios/muralReconhecimento.ts
--   (dataLiberacao/podeLiberar, testada em src/test/mural-ranking-liberacao.test.ts):
--   mudou aqui, muda lá.
--
-- LOTE
--   "Liberar todos os pendentes" de um mês eram 345 chamadas em série à
--   cs_form_mural_decidir. cs_form_mural_decidir_lote faz numa chamada só e
--   numa transação só — ou libera tudo, ou nada (a trava derruba o lote
--   inteiro se um único voto ainda não puder). Mesma checagem de permissão,
--   porque chama cs_form_mural_decidir linha a linha.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) A data em que um voto pode ir ao mural ────────────────────────────
-- Dia 20 do mês seguinte ao do envio, no calendário de Brasília.
CREATE OR REPLACE FUNCTION public.cs_form_mural_libera_em(_enviado_em timestamptz)
RETURNS date LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT (date_trunc('month', _enviado_em AT TIME ZONE 'America/Sao_Paulo')
          + interval '1 month' + interval '19 days')::date;
$$;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_libera_em(timestamptz) TO authenticated;

-- ── 2) O portão: liberar antes do dia 20 do mês seguinte não grava ───────
CREATE OR REPLACE FUNCTION public.cs_form_mural_trava_liberacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_env   timestamptz;
  v_libera date;
BEGIN
  IF NEW.status <> 'liberado' THEN
    RETURN NEW;
  END IF;

  SELECT r.enviado_em INTO v_env
    FROM public."CS_FORM_RESPOSTAS" r WHERE r.id = NEW.resposta_id;
  v_libera := public.cs_form_mural_libera_em(v_env);

  IF v_env IS NULL OR (now() AT TIME ZONE 'America/Sao_Paulo')::date < v_libera THEN
    RAISE EXCEPTION 'Votos de % só podem ser liberados a partir de %.',
      to_char(v_env AT TIME ZONE 'America/Sao_Paulo', 'MM/YYYY'),
      to_char(v_libera, 'DD/MM/YYYY')
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_trava_liberacao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cs_form_mural_trava_liberacao ON public."CS_FORM_MURAL_RECONHECIMENTO";
CREATE TRIGGER cs_form_mural_trava_liberacao
  BEFORE INSERT OR UPDATE ON public."CS_FORM_MURAL_RECONHECIMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.cs_form_mural_trava_liberacao();

-- ── 3) Liberar / recusar / voltar a pendente em lote ─────────────────────
-- _itens: [{"resposta_id": uuid, "pergunta_id": text, "linha": int}, ...]
-- Devolve quantas linhas foram decididas.
CREATE OR REPLACE FUNCTION public.cs_form_mural_decidir_lote(_itens jsonb, _status text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_i jsonb;
  v_n integer := 0;
BEGIN
  IF jsonb_typeof(_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de comentários inválida.' USING ERRCODE = '22023';
  END IF;
  FOR v_i IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    PERFORM public.cs_form_mural_decidir(
      (v_i->>'resposta_id')::uuid, v_i->>'pergunta_id', (v_i->>'linha')::int, _status);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_decidir_lote(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_decidir_lote(jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.cs_form_mural_decidir_lote(jsonb, text);
-- DROP TRIGGER IF EXISTS cs_form_mural_trava_liberacao ON public."CS_FORM_MURAL_RECONHECIMENTO";
-- DROP FUNCTION IF EXISTS public.cs_form_mural_trava_liberacao();
-- DROP FUNCTION IF EXISTS public.cs_form_mural_libera_em(timestamptz);
-- NOTIFY pgrst, 'reload schema';
-- =========================================================================
