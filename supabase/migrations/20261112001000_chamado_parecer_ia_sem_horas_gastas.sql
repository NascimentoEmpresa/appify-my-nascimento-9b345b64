-- =========================================================================
-- CHAMADOS: A I.A AVALIA TODOS PELO ESCOPO, SEM HORAS GASTAS (12/11/2026)
--
-- PEDIDO (Pablo, 12/11/2026): "não precisa mais informar as horas gastas
-- pro desenvolvimento, uma i.a vai avaliar de acordo com o chamado, vendo a
-- complexidade dele" e "preciso que a i.a reavalie todos os chamados
-- corretamente, quanto vale cada um, quanto de lucro dá".
--
-- 1. Concluir deixa de exigir horas_gastas (a tela não pede mais). A coluna
--    fica, e as horas já informadas continuam como histórico.
-- 2. O parecer da I.A nasce na CONCLUSÃO (antes, só quando as horas eram
--    gravadas). A Edge chamado-parecer-ia estima as horas pelo escopo e pela
--    entrega real (PRs) — ver o cabeçalho dela.
-- 3. TODOS os chamados concluídos são reavaliados, devagar: uma fila própria
--    (CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO) solta 6 por minuto na fila_http,
--    pelo pg_cron. Jogar ~800 de uma vez travaria a fila_http (o worker entrega
--    25 por minuto, em ordem) e atrasaria WhatsApp, Canal de Ética e novidades;
--    e estouraria a cota da I.A. Novembro/2026 vai primeiro (é o mês da
--    bonificação aberta), depois do mais novo para o mais antigo. O parecer
--    pronto atual continua na tela até o novo chegar.
-- 4. Bonificação: saem os VALORES que digitei à mão em 11/11/2026 nas entregas
--    de novembro (linhas com observação "Avaliação por escopo…", sem
--    qualidade, dificuldade nem exclusão gravadas — só o valor). Enquanto
--    existissem, venceriam o parecer da I.A. A planilha
--    Avaliacao_chamados_novembro_2026.xlsx guarda o que eram.
-- 5. Bonificação: a RPC passa a devolver as horas da equipe interna estimadas
--    pela I.A e a marca de horas supostas, para a tela calcular o LUCRO de
--    cada entrega (valor de mercado − custo real com o nosso salário).
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1) Concluir sem horas ────────────────────────────────────────────────
-- Mesmo corpo da mig 20261105005500, sem o RAISE das horas obrigatórias.
CREATE OR REPLACE FUNCTION public.chamado_horas_gastas_exige()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fora de 'concluido' não há horas (reabrir zera).
  IF NEW.status IS DISTINCT FROM 'concluido' THEN
    NEW.horas_gastas := NULL;
    NEW.horas_gastas_por := NULL;
    NEW.horas_gastas_em := NULL;
    NEW.horas_gastas_estimadas := false;
    RETURN NEW;
  END IF;

  IF NEW.horas_gastas IS NOT NULL AND NEW.horas_gastas IS DISTINCT FROM OLD.horas_gastas THEN
    NEW.horas_gastas_por := auth.uid();
    NEW.horas_gastas_em := now();
    NEW.horas_gastas_estimadas := false;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.chamado_horas_gastas_exige() FROM PUBLIC, anon, authenticated;

-- ── 2) Parecer na conclusão ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_concluido_gera_parecer_ia_escopo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.chamado_parecer_ia_enfileirar(NEW.id, true);
  EXCEPTION WHEN OTHERS THEN
    -- Concluir nunca pode falhar por causa do parecer.
    RAISE WARNING 'chamado-parecer-ia não foi enfileirada para %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chamado_concluido_gera_parecer_ia_escopo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_concluido_parecer_ia_escopo ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_concluido_parecer_ia_escopo
  AFTER UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido')
  EXECUTE FUNCTION public.chamado_concluido_gera_parecer_ia_escopo();

-- ── 3) Reavaliação de todos os concluídos, 6 por minuto ──────────────────
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" (
  chamado_id     uuid PRIMARY KEY REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  prioridade     integer     NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  enfileirado_em timestamptz
);
COMMENT ON TABLE public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" IS
  'Reavaliação única de todos os pareceres da I.A pela régua sem horas (mig 20261112001000). O pg_cron solta 6 por minuto na fila_http; menor prioridade primeiro.';
CREATE INDEX IF NOT EXISTS idx_chamado_parecer_ia_reavaliacao_pendente
  ON public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" (prioridade) WHERE enfileirado_em IS NULL;

-- Só o banco mexe: RLS ligada, nenhuma policy, nenhum papel de aplicação.
ALTER TABLE public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" FROM anon, authenticated;

-- Novembro/2026 primeiro; depois do concluído mais novo para o mais antigo.
INSERT INTO public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" (chamado_id, prioridade)
SELECT c.id,
       row_number() OVER (ORDER BY ((c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date >= DATE '2026-11-01') DESC,
                                   c.concluido_em DESC NULLS LAST, c.id)::int
  FROM public."CHAMADO_SISTEMA" c
 WHERE c.status = 'concluido'
ON CONFLICT (chamado_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.chamado_parecer_ia_reavaliar_lote(p_qtd integer DEFAULT 6)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_n  integer := 0;
BEGIN
  FOR v_id IN
    SELECT r.chamado_id
      FROM public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" r
      JOIN public."CHAMADO_SISTEMA" c ON c.id = r.chamado_id AND c.status = 'concluido'
     WHERE r.enfileirado_em IS NULL
     ORDER BY r.prioridade
     LIMIT greatest(coalesce(p_qtd, 6), 1)
       FOR UPDATE OF r SKIP LOCKED
  LOOP
    -- Sem parecer ainda: a tela mostra "a I.A está avaliando…".
    INSERT INTO public."CHAMADO_SISTEMA_PARECER_IA" (chamado_id, status)
    VALUES (v_id, 'pendente')
    ON CONFLICT (chamado_id) DO NOTHING;
    PERFORM public.enfileirar_http('chamado-parecer-ia', jsonb_build_object('chamado_id', v_id, 'reavaliar', true));
    UPDATE public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" SET enfileirado_em = now() WHERE chamado_id = v_id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.chamado_parecer_ia_reavaliar_lote(integer) FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('chamado-parecer-ia-reavaliar')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chamado-parecer-ia-reavaliar');
    PERFORM cron.schedule('chamado-parecer-ia-reavaliar', '* * * * *',
      $job$SELECT public.chamado_parecer_ia_reavaliar_lote(6);$job$);
  ELSE
    RAISE NOTICE 'pg_cron ausente: rode SELECT public.chamado_parecer_ia_reavaliar_lote(6) a cada minuto até devolver 0.';
  END IF;
END
$cron$;

-- ── 4) Bonificação: saem os valores digitados à mão em 11/11 ─────────────
DELETE FROM public."BONIFICACAO_DEV_ENTREGA" b
 USING public."CHAMADO_SISTEMA" c
 WHERE c.id = b.chamado_id
   AND b.observacao LIKE 'Avaliação por escopo%'
   AND b.qualidade IS NULL
   AND b.dificuldade IS NULL
   AND NOT b.fora_da_bonificacao
   AND (c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date >= DATE '2026-11-01';

-- ── 5) Bonificação: horas internas da I.A para o lucro ───────────────────
-- Mesmo corpo da mig 20261105004700 + horas_gastas_estimadas e
-- ia_horas_interno no fim. Muda o tipo de retorno: DROP antes do CREATE.
DROP FUNCTION IF EXISTS public.bonificacao_dev_entregas(date, date);
CREATE FUNCTION public.bonificacao_dev_entregas(p_inicio date, p_fim date)
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
  avaliado_em         timestamptz,
  horas_gastas_estimadas boolean,
  ia_horas_interno    numeric
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
         coalesce(b.fora_da_bonificacao, false), b.motivo_exclusao, b.observacao, b.updated_at,
         coalesce(c.horas_gastas_estimadas, false),
         CASE WHEN pia.status = 'pronto' THEN (SELECT nullif(x->>'horas', '')::numeric FROM jsonb_array_elements(pia.precos) x WHERE x->>'perfil' = 'interno' LIMIT 1) END
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
-- SELECT count(*) FILTER (WHERE enfileirado_em IS NULL) AS faltam, count(*) AS total
--   FROM public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO";
-- SELECT status, count(*) FROM public."CHAMADO_SISTEMA_PARECER_IA" GROUP BY 1;

-- =========================================================================
-- ROLLBACK
--   SELECT cron.unschedule('chamado-parecer-ia-reavaliar');
--   DROP FUNCTION IF EXISTS public.chamado_parecer_ia_reavaliar_lote(integer);
--   DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO";
--   DROP TRIGGER IF EXISTS trg_chamado_concluido_parecer_ia_escopo ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_concluido_gera_parecer_ia_escopo();
--   (horas obrigatórias: reaplicar a seção 3 da mig 20261105005500)
--   (RPC da bonificação: reaplicar a seção 6 da mig 20261105004700 — com DROP antes)
--   Os valores apagados em 4 estão na planilha; os pareceres refeitos não
--   voltam ao valor anterior.
-- =========================================================================
