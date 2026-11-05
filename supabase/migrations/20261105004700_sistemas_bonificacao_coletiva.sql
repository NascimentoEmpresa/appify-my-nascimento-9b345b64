-- =========================================================================
-- SISTEMAS › BONIFICAÇÃO COLETIVA POR NOTA DA EQUIPE (05/11/2026)
--
-- Pedido do Pablo: "Desenvolve esse sistema novo de bonificação no módulo
-- sistemas, é um sistema de bonificação por meta etc completo". Especificação:
-- protótipo Painel_ERP_Bonificacao_Coletiva.html (5 abas, fórmulas e textos
-- de ajuda). O protótipo usava dados fictícios e localStorage; aqui tudo vem
-- dos chamados reais e fica no banco.
--
-- AS REGRAS (a conta mora em src/lib/sistemas/bonificacaoColetiva.ts, com
-- teste — o banco só guarda os dados e as configurações):
--   · 5 critérios por entrega, cada um vira nota 0–100:
--       Qualidade   sem ajuste 100 · ajuste pequeno 50 · retrabalho 0
--       Satisfação  nota do solicitante (1–5) × 20
--       Prazo       concluído até o limite 100 · depois 0
--       Dificuldade fácil/médio/difícil/muito difícil = pontos do período
--       Valor       valor de mercado (IA) ÷ referência × 100, teto 100
--   · Nota = Σ(nota do critério × peso ÷ 100); pesos somam 100.
--   · Nota da equipe = média de cada critério sobre TODAS as entregas do
--     período, ponderada pelos pesos. Liberado = verba × nota ÷ 100, dividido
--     IGUALMENTE entre os devs com entrega no período (centavos fecham o total).
--
-- DE ONDE VEM CADA DADO (nada é redigitado):
--   Entrega        = "CHAMADO_SISTEMA" concluído, com responsável, mês do
--                    concluido_em (fuso de Brasília).
--   Prazo          = concluido_no_prazo (gatilho da mig 20261028001410); sem
--                    ele, concluido_em × prazo_previsto; sem prazo, fica fora
--                    da média desse critério.
--   Satisfação     = "CHAMADO_SISTEMA_AVALIACAO".satisfacao (o solicitante).
--   Dificuldade e  = "CHAMADO_SISTEMA_PARECER_IA" (mig 20261029000900), que
--   valores IA       já existe por chamado: complexidade 1–5 e os 3 preços
--                    (software house = mercado, freelancer, interno = CLT).
--                    A tela pode pedir o parecer pela Edge chamado-parecer-ia
--                    (mesmo botão/portão da tela do chamado).
--   Qualidade      = sugerida pelas reaberturas do chamado (eventos
--                    "Chamado reaberto: …"), decidida pelo gestor.
--
-- O QUE É NOVO:
--   "BONIFICACAO_DEV_ENTREGA"  a avaliação do gestor por chamado: qualidade,
--                              dificuldade e valores (sobrescrevem a sugestão /
--                              a IA), e "fora da bonificação" com motivo.
--   "BONIFICACAO_DEV_PERIODO"  um mês: verba, pesos, pontos de dificuldade,
--                              referência de valor e o fechamento (com a foto
--                              do resultado em `resultado`). Mês sem linha
--                              herda a configuração do último mês anterior.
--   bonificacao_dev_entregas(inicio, fim)  RPC de leitura (SECURITY DEFINER:
--                              quem vê o painel não precisa ver os chamados).
--
-- ACESSO — nasce SEM ninguém (mig 20261008000006), o Pablo libera em
-- Administração › Acesso por Usuário:
--   sistemas_bonificacao        /app/sistemas/bonificacao
--       visualizar = ver o painel · alterar = avaliar entregas (qualidade,
--       dificuldade, valores, fora da bonificação) · exportar = CSV/impressão
--   sistemas_bonificacao_regras menu fantasma (rota NULL)
--       alterar = verba, pesos, dificuldade e referência do mês
--       aprovar = fechar / reabrir o período
--
-- Período FECHADO trava: a configuração do mês e a avaliação das entregas
-- concluídas nele (gatilhos abaixo). Reabrir é 'aprovar' nas regras.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1) Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sistemas_bonificacao', 'Bonificação Coletiva da Equipe', '/app/sistemas/bonificacao', 40, true
  FROM public.app_modulo m WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sistemas_bonificacao_regras', 'Bonificação Coletiva — Verba, pesos e fechamento', NULL, 41, true
  FROM public.app_modulo m WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'sistemas_bonificacao', a::public.app_acao
  FROM unnest(ARRAY['visualizar','alterar','exportar']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'sistemas_bonificacao_regras', a::public.app_acao
  FROM unnest(ARRAY['alterar','aprovar']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bonificacao_dev_acesso(_menu text, _acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND _menu IN ('sistemas_bonificacao', 'sistemas_bonificacao_regras')
     AND public.can_access(auth.uid(), _menu, _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.bonificacao_dev_acesso(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bonificacao_dev_acesso(text, text) TO authenticated;

-- ── 2) Período (verba + configuração do mês) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public."BONIFICACAO_DEV_PERIODO" (
  competencia        date PRIMARY KEY,                       -- 1º dia do mês
  verba              numeric(12,2) NOT NULL DEFAULT 0 CHECK (verba >= 0 AND verba <= 100000000),
  peso_qualidade     smallint NOT NULL DEFAULT 30 CHECK (peso_qualidade   BETWEEN 0 AND 100),
  peso_satisfacao    smallint NOT NULL DEFAULT 20 CHECK (peso_satisfacao  BETWEEN 0 AND 100),
  peso_prazo         smallint NOT NULL DEFAULT 20 CHECK (peso_prazo       BETWEEN 0 AND 100),
  peso_dificuldade   smallint NOT NULL DEFAULT 15 CHECK (peso_dificuldade BETWEEN 0 AND 100),
  peso_valor         smallint NOT NULL DEFAULT 15 CHECK (peso_valor       BETWEEN 0 AND 100),
  pontos_facil         smallint NOT NULL DEFAULT 25  CHECK (pontos_facil         BETWEEN 0 AND 100),
  pontos_medio         smallint NOT NULL DEFAULT 50  CHECK (pontos_medio         BETWEEN 0 AND 100),
  pontos_dificil       smallint NOT NULL DEFAULT 75  CHECK (pontos_dificil       BETWEEN 0 AND 100),
  pontos_muito_dificil smallint NOT NULL DEFAULT 100 CHECK (pontos_muito_dificil BETWEEN 0 AND 100),
  referencia_valor   numeric(12,2) NOT NULL DEFAULT 10000 CHECK (referencia_valor > 0),
  observacao         text,
  fechado_em         timestamptz,
  fechado_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Foto do resultado no fechamento (nota, liberado, participantes, cota):
  -- o mês fechado não muda se alguém mexer num chamado depois.
  resultado          jsonb,
  created_by         uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bonificacao_dev_periodo_mes_chk CHECK (competencia = date_trunc('month', competencia)::date),
  CONSTRAINT bonificacao_dev_periodo_pesos_chk CHECK (
    peso_qualidade + peso_satisfacao + peso_prazo + peso_dificuldade + peso_valor = 100)
);
COMMENT ON TABLE public."BONIFICACAO_DEV_PERIODO" IS
  'Bonificação coletiva da equipe de Sistemas: verba e configuração (pesos, dificuldade, referência) por mês, e o fechamento.';

-- ── 3) Avaliação da entrega pelo gestor ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public."BONIFICACAO_DEV_ENTREGA" (
  chamado_id          uuid PRIMARY KEY REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  qualidade           text CHECK (qualidade IS NULL OR qualidade IN ('sem_ajuste', 'ajuste_pequeno', 'retrabalho')),
  dificuldade         text CHECK (dificuldade IS NULL OR dificuldade IN ('facil', 'medio', 'dificil', 'muito_dificil')),
  valor_mercado       numeric(12,2) CHECK (valor_mercado    IS NULL OR valor_mercado    >= 0),
  valor_freelancer    numeric(12,2) CHECK (valor_freelancer IS NULL OR valor_freelancer >= 0),
  valor_clt           numeric(12,2) CHECK (valor_clt        IS NULL OR valor_clt        >= 0),
  fora_da_bonificacao boolean NOT NULL DEFAULT false,
  motivo_exclusao     text,
  observacao          text,
  avaliado_por        uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bonificacao_dev_entrega_motivo_chk CHECK (
    NOT fora_da_bonificacao OR (motivo_exclusao IS NOT NULL AND length(btrim(motivo_exclusao)) >= 5))
);
COMMENT ON TABLE public."BONIFICACAO_DEV_ENTREGA" IS
  'Avaliação do gestor sobre uma entrega (chamado) para a bonificação coletiva: qualidade, dificuldade e valores (sobrescrevem a sugestão e o parecer da IA).';

-- Índice em toda FK (guardião de desempenho, regra M2): sem ele, apagar um
-- usuário em auth.users varre as tabelas inteiras.
CREATE INDEX IF NOT EXISTS bonificacao_dev_periodo_fechado_por_idx ON public."BONIFICACAO_DEV_PERIODO" (fechado_por);
CREATE INDEX IF NOT EXISTS bonificacao_dev_periodo_created_by_idx ON public."BONIFICACAO_DEV_PERIODO" (created_by);
CREATE INDEX IF NOT EXISTS bonificacao_dev_periodo_updated_by_idx ON public."BONIFICACAO_DEV_PERIODO" (updated_by);
CREATE INDEX IF NOT EXISTS bonificacao_dev_entrega_avaliado_por_idx ON public."BONIFICACAO_DEV_ENTREGA" (avaliado_por);

DROP TRIGGER IF EXISTS trg_bonificacao_dev_periodo_updated_at ON public."BONIFICACAO_DEV_PERIODO";
CREATE TRIGGER trg_bonificacao_dev_periodo_updated_at
  BEFORE UPDATE ON public."BONIFICACAO_DEV_PERIODO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_bonificacao_dev_entrega_updated_at ON public."BONIFICACAO_DEV_ENTREGA";
CREATE TRIGGER trg_bonificacao_dev_entrega_updated_at
  BEFORE UPDATE ON public."BONIFICACAO_DEV_ENTREGA"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4) Travas do período fechado ─────────────────────────────────────────
-- Período: fechado não muda; fechar/reabrir (mexer em fechado_em) só com
-- 'aprovar' nas regras. O resto (verba, pesos…) é 'alterar' — a RLS cuida.
CREATE OR REPLACE FUNCTION public.bonificacao_dev_periodo_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_antes_fechado   boolean := false;
  v_mexe_fechamento boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_antes_fechado   := OLD.fechado_em IS NOT NULL;
    v_mexe_fechamento := NEW.fechado_em IS DISTINCT FROM OLD.fechado_em;
  ELSE
    v_mexe_fechamento := NEW.fechado_em IS NOT NULL;
  END IF;

  IF v_mexe_fechamento AND NOT public.bonificacao_dev_acesso('sistemas_bonificacao_regras', 'aprovar') THEN
    RAISE EXCEPTION 'Sem permissão para fechar ou reabrir o período da bonificação.' USING ERRCODE = '42501';
  END IF;

  IF NEW.fechado_em IS NOT NULL THEN
    IF NOT v_antes_fechado THEN
      NEW.fechado_por := auth.uid();           -- fechando agora
    ELSIF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Período fechado: reabra o período antes de alterar.';
    END IF;
  ELSE
    NEW.fechado_por := NULL;
    NEW.resultado   := NULL;                   -- reaberto: a foto deixa de valer
  END IF;

  NEW.updated_by := auth.uid();
  IF TG_OP = 'UPDATE' THEN NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bonificacao_dev_periodo_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bonificacao_dev_periodo_guard ON public."BONIFICACAO_DEV_PERIODO";
CREATE TRIGGER trg_bonificacao_dev_periodo_guard
  BEFORE INSERT OR UPDATE ON public."BONIFICACAO_DEV_PERIODO"
  FOR EACH ROW EXECUTE FUNCTION public.bonificacao_dev_periodo_guard();

-- Entrega: chamado concluído num mês fechado não tem a avaliação mexida.
CREATE OR REPLACE FUNCTION public.bonificacao_dev_entrega_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_chamado uuid;
  v_mes     date;
BEGIN
  IF TG_OP = 'DELETE' THEN v_chamado := OLD.chamado_id; ELSE v_chamado := NEW.chamado_id; END IF;
  SELECT date_trunc('month', (c.concluido_em AT TIME ZONE 'America/Sao_Paulo'))::date
    INTO v_mes
    FROM public."CHAMADO_SISTEMA" c WHERE c.id = v_chamado;
  IF v_mes IS NOT NULL AND EXISTS (
       SELECT 1 FROM public."BONIFICACAO_DEV_PERIODO" p
        WHERE p.competencia = v_mes AND p.fechado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'O período % está fechado: reabra o período antes de mudar a avaliação.', to_char(v_mes, 'MM/YYYY');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.avaliado_por := auth.uid();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bonificacao_dev_entrega_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bonificacao_dev_entrega_guard ON public."BONIFICACAO_DEV_ENTREGA";
CREATE TRIGGER trg_bonificacao_dev_entrega_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public."BONIFICACAO_DEV_ENTREGA"
  FOR EACH ROW EXECUTE FUNCTION public.bonificacao_dev_entrega_guard();

-- ── 5) RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public."BONIFICACAO_DEV_PERIODO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BONIFICACAO_DEV_ENTREGA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."BONIFICACAO_DEV_PERIODO" FROM anon;
REVOKE ALL ON public."BONIFICACAO_DEV_ENTREGA" FROM anon;
GRANT SELECT, INSERT, UPDATE ON public."BONIFICACAO_DEV_PERIODO" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."BONIFICACAO_DEV_ENTREGA" TO authenticated;

DROP POLICY IF EXISTS bonificacao_dev_periodo_sel ON public."BONIFICACAO_DEV_PERIODO";
CREATE POLICY bonificacao_dev_periodo_sel ON public."BONIFICACAO_DEV_PERIODO" FOR SELECT TO authenticated
  USING ((select public.bonificacao_dev_acesso('sistemas_bonificacao', 'visualizar')));

-- Gravar o mês: 'alterar' (verba/pesos) OU 'aprovar' (fechar/reabrir) nas
-- regras; o gatilho separa quem pode mexer no fechamento.
DROP POLICY IF EXISTS bonificacao_dev_periodo_ins ON public."BONIFICACAO_DEV_PERIODO";
CREATE POLICY bonificacao_dev_periodo_ins ON public."BONIFICACAO_DEV_PERIODO" FOR INSERT TO authenticated
  WITH CHECK ((select public.bonificacao_dev_acesso('sistemas_bonificacao_regras', 'alterar'))
              OR (select public.bonificacao_dev_acesso('sistemas_bonificacao_regras', 'aprovar')));

DROP POLICY IF EXISTS bonificacao_dev_periodo_upd ON public."BONIFICACAO_DEV_PERIODO";
CREATE POLICY bonificacao_dev_periodo_upd ON public."BONIFICACAO_DEV_PERIODO" FOR UPDATE TO authenticated
  USING ((select public.bonificacao_dev_acesso('sistemas_bonificacao_regras', 'alterar'))
         OR (select public.bonificacao_dev_acesso('sistemas_bonificacao_regras', 'aprovar')))
  WITH CHECK ((select public.bonificacao_dev_acesso('sistemas_bonificacao_regras', 'alterar'))
              OR (select public.bonificacao_dev_acesso('sistemas_bonificacao_regras', 'aprovar')));

DROP POLICY IF EXISTS bonificacao_dev_entrega_sel ON public."BONIFICACAO_DEV_ENTREGA";
CREATE POLICY bonificacao_dev_entrega_sel ON public."BONIFICACAO_DEV_ENTREGA" FOR SELECT TO authenticated
  USING ((select public.bonificacao_dev_acesso('sistemas_bonificacao', 'visualizar')));

DROP POLICY IF EXISTS bonificacao_dev_entrega_ins ON public."BONIFICACAO_DEV_ENTREGA";
CREATE POLICY bonificacao_dev_entrega_ins ON public."BONIFICACAO_DEV_ENTREGA" FOR INSERT TO authenticated
  WITH CHECK ((select public.bonificacao_dev_acesso('sistemas_bonificacao', 'alterar')));

DROP POLICY IF EXISTS bonificacao_dev_entrega_upd ON public."BONIFICACAO_DEV_ENTREGA";
CREATE POLICY bonificacao_dev_entrega_upd ON public."BONIFICACAO_DEV_ENTREGA" FOR UPDATE TO authenticated
  USING ((select public.bonificacao_dev_acesso('sistemas_bonificacao', 'alterar')))
  WITH CHECK ((select public.bonificacao_dev_acesso('sistemas_bonificacao', 'alterar')));

DROP POLICY IF EXISTS bonificacao_dev_entrega_del ON public."BONIFICACAO_DEV_ENTREGA";
CREATE POLICY bonificacao_dev_entrega_del ON public."BONIFICACAO_DEV_ENTREGA" FOR DELETE TO authenticated
  USING ((select public.bonificacao_dev_acesso('sistemas_bonificacao', 'alterar')));

-- ── 6) Leitura das entregas do período ───────────────────────────────────
-- SECURITY DEFINER: quem tem o painel não precisa ter os menus de Chamados
-- para enxergar os chamados concluídos da equipe. Devolve só o necessário
-- para a conta (sem descrição, sem conversa).
CREATE OR REPLACE FUNCTION public.bonificacao_dev_entregas(p_inicio date, p_fim date)
RETURNS TABLE (
  chamado_id          uuid,
  numero              text,
  assunto             text,
  tipo_solicitacao    text,
  responsavel_id      uuid,
  responsavel_nome    text,
  concluido_em        timestamptz,
  prazo_limite        date,
  concluido_no_prazo  boolean,
  horas_gastas        numeric,
  satisfacao          smallint,
  reaberturas         integer,
  ia_status           text,
  ia_complexidade     smallint,
  ia_valor_mercado    numeric,
  ia_valor_freelancer numeric,
  ia_valor_clt        numeric,
  qualidade           text,
  dificuldade         text,
  valor_mercado       numeric,
  valor_freelancer    numeric,
  valor_clt           numeric,
  fora_da_bonificacao boolean,
  motivo_exclusao     text,
  observacao          text,
  avaliado_em         timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.bonificacao_dev_acesso('sistemas_bonificacao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem acesso à Bonificação Coletiva.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.numero, c.assunto, c.tipo_solicitacao,
         c.responsavel_id,
         coalesce(nullif(btrim(pr.display_name), ''), 'Sem nome'),
         c.concluido_em,
         coalesce((c.prazo_conclusao_em AT TIME ZONE 'America/Sao_Paulo')::date, c.prazo_previsto),
         c.concluido_no_prazo,
         c.horas_gastas,
         av.satisfacao,
         (SELECT count(*)::int FROM public."CHAMADO_SISTEMA_EVENTO" e
           WHERE e.chamado_id = c.id AND e.tipo = 'evento' AND e.texto ILIKE 'Chamado reaberto%'),
         pia.status,
         pia.complexidade_nivel,
         CASE WHEN pia.status = 'pronto' THEN (SELECT nullif(x->>'valor', '')::numeric FROM jsonb_array_elements(pia.precos) x WHERE x->>'perfil' = 'software_house' LIMIT 1) END,
         CASE WHEN pia.status = 'pronto' THEN (SELECT nullif(x->>'valor', '')::numeric FROM jsonb_array_elements(pia.precos) x WHERE x->>'perfil' = 'freelancer' LIMIT 1) END,
         CASE WHEN pia.status = 'pronto' THEN (SELECT nullif(x->>'valor', '')::numeric FROM jsonb_array_elements(pia.precos) x WHERE x->>'perfil' = 'interno' LIMIT 1) END,
         b.qualidade, b.dificuldade, b.valor_mercado, b.valor_freelancer, b.valor_clt,
         coalesce(b.fora_da_bonificacao, false), b.motivo_exclusao, b.observacao, b.updated_at
    FROM public."CHAMADO_SISTEMA" c
    LEFT JOIN public.profiles pr ON pr.id = c.responsavel_id
    LEFT JOIN public."CHAMADO_SISTEMA_AVALIACAO" av ON av.chamado_id = c.id
    LEFT JOIN public."CHAMADO_SISTEMA_PARECER_IA" pia ON pia.chamado_id = c.id
    LEFT JOIN public."BONIFICACAO_DEV_ENTREGA" b ON b.chamado_id = c.id
   WHERE c.status = 'concluido'
     AND c.responsavel_id IS NOT NULL
     AND c.concluido_em IS NOT NULL
     AND (c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_inicio AND p_fim
   ORDER BY c.concluido_em;
END $$;
REVOKE ALL ON FUNCTION public.bonificacao_dev_entregas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bonificacao_dev_entregas(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
-- SELECT codigo, rota FROM public.app_menu WHERE codigo LIKE 'sistemas_bonificacao%';
-- SELECT * FROM public.app_menu_acao WHERE menu_codigo LIKE 'sistemas_bonificacao%';
-- SELECT count(*) FROM public.bonificacao_dev_entregas('2026-10-01', '2026-10-31');  -- com login liberado

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.bonificacao_dev_entregas(date, date);
-- DROP TABLE IF EXISTS public."BONIFICACAO_DEV_ENTREGA";
-- DROP TABLE IF EXISTS public."BONIFICACAO_DEV_PERIODO";
-- DROP FUNCTION IF EXISTS public.bonificacao_dev_entrega_guard();
-- DROP FUNCTION IF EXISTS public.bonificacao_dev_periodo_guard();
-- DROP FUNCTION IF EXISTS public.bonificacao_dev_acesso(text, text);
-- DELETE FROM public.screen_permission_user WHERE menu_codigo LIKE 'sistemas_bonificacao%';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo LIKE 'sistemas_bonificacao%';
-- DELETE FROM public.app_menu WHERE codigo LIKE 'sistemas_bonificacao%';
-- NOTIFY pgrst, 'reload schema';
