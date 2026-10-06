-- =========================================================================
-- CONTROLADORIA › REUNIÕES COM ENCARREGADOS (06/10/2026)
--
-- PEDIDO (Pablo): "conforme são feitas as reuniões dos supervisores com os
-- encarregados são feitas transcrições dessas reuniões; quero importar as
-- transcrições e gerar um Dashboard das reclamações e dificuldades dos
-- encarregados" — submódulo de CONTROLADORIA.
--
-- FLUXO (referência: o protótipo "Gestão de Contratos" que ele mostrou)
--   Importar  → o navegador lê o arquivo (TXT/MD/DOCX/VTT/SRT/PDF), separa
--               as falas e sugere tema + tipo por regras de palavras-chave
--               (src/lib/controladoria/reunioes.ts). NÃO há IA: o texto não
--               sai do ERP.
--   Revisar   → cada registro sugerido nasce 'pendente'; quem revisa
--               corrige tema/tipo e valida ou exclui.
--   Plano de ação → ação ligada ao registro (responsável, prazo, situação).
--   Dashboard → temas recorrentes, reuniões no período, composição,
--               casos por contrato/encarregado.
--
-- MODELO
--   "CTRL_REUNIAO"           uma reunião importada (texto integral guardado).
--   "CTRL_REUNIAO_REGISTRO"  um trecho de fala classificado.
--   "CTRL_REUNIAO_ACAO"      plano de ação.
--   "CTRL_REUNIAO_VINCULO"   "nome na transcrição" → encarregado + contrato,
--                            reaproveitado nas próximas importações.
--
-- ACESSO: menu ctrl_reunioes_encarregados (nasce fechado — liberar em
-- Acesso por Usuário › Controladoria). visualizar lê tudo; incluir importa;
-- alterar revisa/edita; excluir apaga reunião/registro/ação.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'ctrl_reunioes_encarregados', 'Reuniões com Encarregados', '/app/controladoria/reunioes-encarregados', 55, true
  FROM public.app_modulo m WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ctrl_reuniao_pode(_acao text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), 'ctrl_reunioes_encarregados', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.ctrl_reuniao_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ctrl_reuniao_pode(text) TO authenticated;

-- ── 2) Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CTRL_REUNIAO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL CHECK (length(btrim(titulo)) >= 2),
  data_reuniao  date,
  supervisor    text,
  -- Contrato único da reunião, quando houver (vazio = vários contratos).
  contrato      text,
  equipe        text,
  participantes text[] NOT NULL DEFAULT '{}',
  arquivo_nome  text,
  texto         text NOT NULL,
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ctrl_reuniao_data ON public."CTRL_REUNIAO" (data_reuniao DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public."CTRL_REUNIAO_REGISTRO" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reuniao_id   uuid NOT NULL REFERENCES public."CTRL_REUNIAO"(id) ON DELETE CASCADE,
  ordem        int NOT NULL DEFAULT 0,
  falante      text,
  -- Encarregado/contrato resolvidos pelo vínculo (ou pelo contrato da reunião).
  encarregado  text,
  contrato     text,
  trecho       text NOT NULL,
  tema         text NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('dificuldade', 'duvida')),
  status       text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'validado', 'excluido')),
  revisado_por uuid,
  revisado_em  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ctrl_reuniao_registro_reuniao ON public."CTRL_REUNIAO_REGISTRO" (reuniao_id, ordem);
CREATE INDEX IF NOT EXISTS idx_ctrl_reuniao_registro_status ON public."CTRL_REUNIAO_REGISTRO" (status);

CREATE TABLE IF NOT EXISTS public."CTRL_REUNIAO_ACAO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id uuid REFERENCES public."CTRL_REUNIAO_REGISTRO"(id) ON DELETE SET NULL,
  reuniao_id  uuid REFERENCES public."CTRL_REUNIAO"(id) ON DELETE SET NULL,
  descricao   text NOT NULL CHECK (length(btrim(descricao)) >= 3),
  responsavel text,
  prazo       date,
  situacao    text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'andamento', 'concluida')),
  contrato    text,
  tema        text,
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."CTRL_REUNIAO_VINCULO" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Como o nome aparece na transcrição (comparado sem acento/caixa).
  nome_transcricao text NOT NULL,
  encarregado      text NOT NULL,
  contrato         text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ctrl_reuniao_vinculo_nome ON public."CTRL_REUNIAO_VINCULO" (lower(btrim(nome_transcricao)));

-- ── 3) updated_at ────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CTRL_REUNIAO', 'CTRL_REUNIAO_REGISTRO', 'CTRL_REUNIAO_ACAO', 'CTRL_REUNIAO_VINCULO'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', lower(t), t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', lower(t), t);
  END LOOP;
END $$;

-- Quem revisou e quando — carimbado no banco, não confiado ao cliente.
CREATE OR REPLACE FUNCTION public.ctrl_reuniao_registro_revisao()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.tema IS DISTINCT FROM OLD.tema OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    NEW.revisado_por := auth.uid();
    NEW.revisado_em := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ctrl_reuniao_registro_revisao ON public."CTRL_REUNIAO_REGISTRO";
CREATE TRIGGER trg_ctrl_reuniao_registro_revisao BEFORE UPDATE ON public."CTRL_REUNIAO_REGISTRO"
  FOR EACH ROW EXECUTE FUNCTION public.ctrl_reuniao_registro_revisao();

-- ── 4) RLS ───────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CTRL_REUNIAO', 'CTRL_REUNIAO_REGISTRO', 'CTRL_REUNIAO_ACAO', 'CTRL_REUNIAO_VINCULO'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.ctrl_reuniao_pode(''visualizar''))', lower(t) || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_insert', t);
    -- Ação e vínculo também nascem na revisão: incluir OU alterar.
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.ctrl_reuniao_pode(''incluir'') OR public.ctrl_reuniao_pode(''alterar''))', lower(t) || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.ctrl_reuniao_pode(''alterar'')) WITH CHECK (public.ctrl_reuniao_pode(''alterar''))', lower(t) || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.ctrl_reuniao_pode(''excluir''))', lower(t) || '_delete', t);
  END LOOP;
END $$;

-- ── 5) Importação numa transação só (reunião + registros + vínculos) ─────
-- p_registros: [{ordem, falante, encarregado, contrato, trecho, tema, tipo}]
-- p_vinculos:  [{nome_transcricao, encarregado, contrato}] — upsert pelo nome.
CREATE OR REPLACE FUNCTION public.ctrl_reuniao_importar(p_reuniao jsonb, p_registros jsonb, p_vinculos jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.ctrl_reuniao_pode('incluir') THEN
    RAISE EXCEPTION 'Sem permissão para importar reuniões' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."CTRL_REUNIAO" (titulo, data_reuniao, supervisor, contrato, equipe, participantes, arquivo_nome, texto)
  VALUES (p_reuniao->>'titulo', NULLIF(p_reuniao->>'data_reuniao', '')::date, NULLIF(btrim(p_reuniao->>'supervisor'), ''),
          NULLIF(btrim(p_reuniao->>'contrato'), ''), NULLIF(btrim(p_reuniao->>'equipe'), ''),
          COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_reuniao->'participantes')), '{}'),
          NULLIF(p_reuniao->>'arquivo_nome', ''), p_reuniao->>'texto')
  RETURNING id INTO v_id;

  INSERT INTO public."CTRL_REUNIAO_REGISTRO" (reuniao_id, ordem, falante, encarregado, contrato, trecho, tema, tipo)
  SELECT v_id, COALESCE((r->>'ordem')::int, 0), NULLIF(r->>'falante', ''), NULLIF(r->>'encarregado', ''), NULLIF(r->>'contrato', ''),
         r->>'trecho', r->>'tema', r->>'tipo'
    FROM jsonb_array_elements(COALESCE(p_registros, '[]'::jsonb)) r;

  INSERT INTO public."CTRL_REUNIAO_VINCULO" (nome_transcricao, encarregado, contrato)
  SELECT btrim(x->>'nome_transcricao'), btrim(x->>'encarregado'), NULLIF(btrim(x->>'contrato'), '')
    FROM jsonb_array_elements(COALESCE(p_vinculos, '[]'::jsonb)) x
   WHERE COALESCE(btrim(x->>'nome_transcricao'), '') <> '' AND COALESCE(btrim(x->>'encarregado'), '') <> ''
  ON CONFLICT (lower(btrim(nome_transcricao))) DO UPDATE SET encarregado = EXCLUDED.encarregado, contrato = EXCLUDED.contrato;

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.ctrl_reuniao_importar(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ctrl_reuniao_importar(jsonb, jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.ctrl_reuniao_importar(jsonb, jsonb, jsonb);
-- DROP TABLE IF EXISTS public."CTRL_REUNIAO_ACAO", public."CTRL_REUNIAO_REGISTRO", public."CTRL_REUNIAO_VINCULO", public."CTRL_REUNIAO";
-- DROP FUNCTION IF EXISTS public.ctrl_reuniao_registro_revisao();
-- DROP FUNCTION IF EXISTS public.ctrl_reuniao_pode(text);
-- DELETE FROM public.app_menu WHERE codigo = 'ctrl_reunioes_encarregados';
