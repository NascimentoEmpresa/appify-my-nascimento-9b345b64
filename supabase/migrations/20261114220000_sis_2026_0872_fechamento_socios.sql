-- SIS-2026-0872 — Fechamento dos Sócios (Controladoria): cadastro dos sócios, percentuais e fechamento por competência
-- ============================================================================
-- A conta (resultado − tributos − consumo da Empresa em Investimentos/Obras Adm, dividido por percentual, menos as retiradas de cada sócio) é feita
-- na tela a partir do Fechamento da Empresa. Aqui só ficam os DADOS que a tela precisa guardar:
--   fechamento_socio                          : os sócios (o rótulo da coluna do Fechamento da Empresa), os colaboradores que valem como ele no integrante
--                                               do rateio/Fluxo e o percentual PADRÃO.
--   fechamento_socio_percentual               : percentual de UMA competência (sobrepõe o padrão naquele mês).
--   fechamento_socio_competencia              : competência FECHADA (só existe linha para mês fechado; reabrir = apagar) com a foto dos totais.
--   fechamento_socio_competencia_socio        : a foto de cada sócio no fechamento (percentual, lucro, retiradas, saldo) e o COMPLEMENTO PAGO.
-- Acesso por pessoa (deny-by-default), nada liberado de início:
--   fechamento-socios           (visualizar) : ver as três telas;
--   fechamento-socios-percentual (alterar)   : cadastrar sócios e mexer nos percentuais (menu fantasma, sem rota);
--   fechamento-socios-fechar     (alterar)   : fechar/reabrir a competência e registrar o complemento pago (menu fantasma) — "quem fecha" é quem tem este.
-- fechamento_socios_colaboradores(): as pessoas de EMPREGADOS agrupadas por nome (só quem tem algum cadastro "Trabalhando", mas com TODOS os cadastros dele, inclusive demitidos: quem foi readmitido
--   tem mais de um ID e o integrante do lançamento pode apontar para qualquer um). Alimenta o vínculo do sócio no cadastro. SECURITY DEFINER porque EMPREGADOS
--   é restrito ao RH; só responde a quem tem a ação fechamento-socios-percentual.
-- (SELECT ...) em volta de auth.uid()/has_screen_access para o Postgres não reavaliar por linha (guardião de desempenho). Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.fechamento_socios_colaboradores();
--   DROP TABLE IF EXISTS public.fechamento_socio_competencia_socio, public.fechamento_socio_competencia, public.fechamento_socio_percentual, public.fechamento_socio;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('fechamento-socios', 'fechamento-socios-percentual', 'fechamento-socios-fechar');
--   DELETE FROM public.screen_permission_user WHERE menu_codigo IN ('fechamento-socios', 'fechamento-socios-percentual', 'fechamento-socios-fechar');
--   DELETE FROM public.app_menu WHERE codigo IN ('fechamento-socios', 'fechamento-socios-percentual', 'fechamento-socios-fechar');
--   NOTIFY pgrst, 'reload schema';

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM public.app_modulo m,
       (VALUES
         ('fechamento-socios',            'Fechamento dos Sócios',                       '/app/controladoria/fechamento-socios', 54),
         ('fechamento-socios-percentual', 'Fechamento dos Sócios — sócios e percentuais (ação)', NULL::text, 55),
         ('fechamento-socios-fechar',     'Fechamento dos Sócios — fechar competência (ação)',   NULL::text, 56)
       ) AS x(codigo, nome, rota, ordem)
 WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fechamento_socio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  empregado_ids integer[] NOT NULL DEFAULT '{}',
  percentual_padrao numeric(7,4) NOT NULL DEFAULT 0 CHECK (percentual_padrao >= 0 AND percentual_padrao <= 100),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS fechamento_socio_nome_uk ON public.fechamento_socio (lower(nome));

CREATE TABLE IF NOT EXISTS public.fechamento_socio_percentual (
  socio_id uuid NOT NULL REFERENCES public.fechamento_socio (id) ON DELETE CASCADE,
  competencia date NOT NULL CHECK (extract(day FROM competencia) = 1),
  percentual numeric(7,4) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (socio_id, competencia)
);

CREATE TABLE IF NOT EXISTS public.fechamento_socio_competencia (
  competencia date PRIMARY KEY CHECK (extract(day FROM competencia) = 1),
  resultado_antes_retiradas numeric(16,2) NOT NULL,
  consumo_empresa numeric(16,2) NOT NULL DEFAULT 0,
  lucro_distribuir numeric(16,2) NOT NULL,
  fechado_em timestamptz NOT NULL DEFAULT now(),
  fechado_por uuid
);

CREATE TABLE IF NOT EXISTS public.fechamento_socio_competencia_socio (
  competencia date NOT NULL REFERENCES public.fechamento_socio_competencia (competencia) ON DELETE CASCADE,
  socio_id uuid NOT NULL REFERENCES public.fechamento_socio (id),
  nome text NOT NULL,
  percentual numeric(7,4) NOT NULL,
  valor_lucro numeric(16,2) NOT NULL,
  retiradas numeric(16,2) NOT NULL DEFAULT 0,
  saldo numeric(16,2) NOT NULL,
  complemento_pago numeric(16,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (competencia, socio_id)
);

ALTER TABLE public.fechamento_socio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechamento_socio_percentual ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechamento_socio_competencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechamento_socio_competencia_socio ENABLE ROW LEVEL SECURITY;

-- Leitura: quem vê a tela
DROP POLICY IF EXISTS fechamento_socio_select ON public.fechamento_socio;
CREATE POLICY fechamento_socio_select ON public.fechamento_socio FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'visualizar'::public.app_acao)));
DROP POLICY IF EXISTS fechamento_socio_percentual_select ON public.fechamento_socio_percentual;
CREATE POLICY fechamento_socio_percentual_select ON public.fechamento_socio_percentual FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'visualizar'::public.app_acao)));
DROP POLICY IF EXISTS fechamento_socio_competencia_select ON public.fechamento_socio_competencia;
CREATE POLICY fechamento_socio_competencia_select ON public.fechamento_socio_competencia FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'visualizar'::public.app_acao)));
DROP POLICY IF EXISTS fechamento_socio_competencia_socio_select ON public.fechamento_socio_competencia_socio;
CREATE POLICY fechamento_socio_competencia_socio_select ON public.fechamento_socio_competencia_socio FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'visualizar'::public.app_acao)));

-- Sócios e percentuais: quem tem a ação de percentual
DROP POLICY IF EXISTS fechamento_socio_escrita ON public.fechamento_socio;
CREATE POLICY fechamento_socio_escrita ON public.fechamento_socio FOR ALL TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios-percentual', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios-percentual', 'alterar'::public.app_acao)));
DROP POLICY IF EXISTS fechamento_socio_percentual_escrita ON public.fechamento_socio_percentual;
CREATE POLICY fechamento_socio_percentual_escrita ON public.fechamento_socio_percentual FOR ALL TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios-percentual', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios-percentual', 'alterar'::public.app_acao)));

-- Fechamento da competência e complemento pago: quem tem a ação de fechar
DROP POLICY IF EXISTS fechamento_socio_competencia_escrita ON public.fechamento_socio_competencia;
CREATE POLICY fechamento_socio_competencia_escrita ON public.fechamento_socio_competencia FOR ALL TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios-fechar', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios-fechar', 'alterar'::public.app_acao)));
DROP POLICY IF EXISTS fechamento_socio_competencia_socio_escrita ON public.fechamento_socio_competencia_socio;
CREATE POLICY fechamento_socio_competencia_socio_escrita ON public.fechamento_socio_competencia_socio FOR ALL TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios-fechar', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios-fechar', 'alterar'::public.app_acao)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fechamento_socio, public.fechamento_socio_percentual,
  public.fechamento_socio_competencia, public.fechamento_socio_competencia_socio TO authenticated;

CREATE OR REPLACE FUNCTION public.fechamento_socios_colaboradores()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'fechamento-socios-percentual', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para cadastrar os sócios do Fechamento.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(json_agg(json_build_object('nome', x.nome, 'ids', x.ids, 'ativo', x.ativo) ORDER BY x.nome), '[]'::json)
      FROM (SELECT btrim(e."Nome") AS nome, array_agg(e."ID"::int ORDER BY e."ID") AS ids, bool_or(e."Situação" = 'Trabalhando') AS ativo
              FROM public."EMPREGADOS" e
             WHERE e."Nome" IS NOT NULL AND btrim(e."Nome") <> ''
             GROUP BY btrim(e."Nome")
            HAVING bool_or(e."Situação" = 'Trabalhando')) x
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fechamento_socios_colaboradores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fechamento_socios_colaboradores() TO authenticated;


NOTIFY pgrst, 'reload schema';
