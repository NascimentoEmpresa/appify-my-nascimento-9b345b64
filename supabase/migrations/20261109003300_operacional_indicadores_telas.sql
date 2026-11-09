-- =========================================================================
-- OPERACIONAL › INDICADORES: AS OUTRAS 4 TELAS (09/11/2026)
--
-- Pablo, com os protótipos: "são 4 novas telas nos indicadores ali, assim
-- como a primeira do painel executivo, desenvolve todas".
--   2. Faturamento e Recebimentos   — notas do Faturamento da Empresa
--   3. Lucratividade e Orçamento    — líquido − despesas do Fluxo de Caixa
--   4. Pessoas e Capacidade         — RH › Ativos/Contratos, faltas das NFs,
--                                     Controle de Afastamentos, Turn-over
--   5. Kaizen e Efetividade         — iniciativas de melhoria (tabela nova)
-- As três primeiras só LEEM o que já existe, pelas mesmas consultas das telas
-- de origem (que cobram o próprio acesso). A única tabela nova é a das
-- iniciativas, que não existia em lugar nenhum do ERP.
--
-- Tela nova nasce sem ninguém (desde 08/10/2026): liberar em Administração ›
-- Acesso por Usuário.
-- =========================================================================

-- ── 1) Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, v.codigo, v.nome, v.rota, v.ordem, true
  FROM public.app_modulo m
 CROSS JOIN (VALUES
   ('ope_indicadores_faturamento',   'Faturamento e Recebimentos', '/app/operacional/indicadores/faturamento-recebimentos', 51),
   ('ope_indicadores_lucratividade', 'Lucratividade e Orçamento',  '/app/operacional/indicadores/lucratividade-orcamento',  52),
   ('ope_indicadores_pessoas',       'Pessoas e Capacidade',       '/app/operacional/indicadores/pessoas-capacidade',       53),
   ('ope_indicadores_kaizen',        'Kaizen e Efetividade',       '/app/operacional/indicadores/kaizen-efetividade',       54)
 ) AS v(codigo, nome, rota, ordem)
 WHERE m.codigo = 'operacional'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2) Iniciativas de melhoria (Kaizen) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public."OPE_KAIZEN_INICIATIVA" (
  id           bigserial PRIMARY KEY,
  titulo       text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 200),
  area         text NOT NULL CHECK (length(btrim(area)) BETWEEN 2 AND 120),
  descricao    text,
  data_inicio  date NOT NULL,
  prazo        date,
  status       text NOT NULL DEFAULT 'Em andamento'
               CHECK (status IN ('Planejada', 'Em andamento', 'Concluída', 'Cancelada')),
  -- O que mudou de fato; com resultado preenchido a iniciativa conta como
  -- "resultado mensurado".
  resultado    text,
  -- Economia por mês, em R$, quando dá para medir; NULL = não mensurada.
  economia     numeric(14, 2) CHECK (economia IS NULL OR economia >= 0),
  concluida_em date,
  criado_por   uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ope_kaizen_prazo_valido CHECK (prazo IS NULL OR prazo >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_ope_kaizen_status ON public."OPE_KAIZEN_INICIATIVA"(status, data_inicio DESC);

CREATE OR REPLACE FUNCTION public.ope_kaizen_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  -- Concluir grava a data; sair de "Concluída" apaga.
  IF NEW.status = 'Concluída' AND NEW.concluida_em IS NULL THEN NEW.concluida_em := (now() AT TIME ZONE 'America/Sao_Paulo')::date; END IF;
  IF NEW.status <> 'Concluída' THEN NEW.concluida_em := NULL; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ope_kaizen_touch ON public."OPE_KAIZEN_INICIATIVA";
CREATE TRIGGER trg_ope_kaizen_touch BEFORE INSERT OR UPDATE ON public."OPE_KAIZEN_INICIATIVA"
  FOR EACH ROW EXECUTE FUNCTION public.ope_kaizen_touch();

ALTER TABLE public."OPE_KAIZEN_INICIATIVA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ope_kaizen_ver ON public."OPE_KAIZEN_INICIATIVA";
CREATE POLICY ope_kaizen_ver ON public."OPE_KAIZEN_INICIATIVA" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'ope_indicadores_kaizen', 'visualizar'::public.app_acao));
DROP POLICY IF EXISTS ope_kaizen_incluir ON public."OPE_KAIZEN_INICIATIVA";
CREATE POLICY ope_kaizen_incluir ON public."OPE_KAIZEN_INICIATIVA" FOR INSERT TO authenticated
  WITH CHECK (public.has_screen_access(auth.uid(), 'ope_indicadores_kaizen', 'incluir'::public.app_acao));
DROP POLICY IF EXISTS ope_kaizen_alterar ON public."OPE_KAIZEN_INICIATIVA";
CREATE POLICY ope_kaizen_alterar ON public."OPE_KAIZEN_INICIATIVA" FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'ope_indicadores_kaizen', 'alterar'::public.app_acao))
  WITH CHECK (public.has_screen_access(auth.uid(), 'ope_indicadores_kaizen', 'alterar'::public.app_acao));
DROP POLICY IF EXISTS ope_kaizen_excluir ON public."OPE_KAIZEN_INICIATIVA";
CREATE POLICY ope_kaizen_excluir ON public."OPE_KAIZEN_INICIATIVA" FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'ope_indicadores_kaizen', 'excluir'::public.app_acao));

REVOKE ALL ON public."OPE_KAIZEN_INICIATIVA" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."OPE_KAIZEN_INICIATIVA" TO authenticated;
GRANT USAGE ON SEQUENCE public."OPE_KAIZEN_INICIATIVA_id_seq" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TABLE IF EXISTS public."OPE_KAIZEN_INICIATIVA";
-- DROP FUNCTION IF EXISTS public.ope_kaizen_touch();
-- DELETE FROM public.app_menu WHERE codigo IN ('ope_indicadores_faturamento','ope_indicadores_lucratividade','ope_indicadores_pessoas','ope_indicadores_kaizen');
-- NOTIFY pgrst, 'reload schema';
