-- =========================================================================
-- CHAMADOS / BONIFICAÇÃO: O PREÇO DA I.A SAI SÓ DO PEDIDO (12/11/2026)
--
-- ORIGEM: auditoria da Bonificação pedida pelo Iury (11/11/2026: "o Pablo
-- com 21 tarefas e 52 mil, o Peretti com 24 e 25 mil"). O que se mediu no
-- banco1, só leitura:
--   * o valor de novembro seguia as HORAS DIGITADAS pelo próprio dev —
--     ~R$ 500 por hora digitada, igual para todos (Pablo 103 h, João 52 h);
--   * chamado fechado pela PR ficava sem horas e, sem horas, sem parecer:
--     R$ 0 em 10 dos 13 do Eduardo e em 6 dos 23 do João. Os do Pablo e do
--     Otavio nunca fecham pela PR (o login deles não estava na lista chumbada
--     de chamado-concluir-pr), então todos tinham horas e valor;
--   * a reavaliação da mig 20261112001000 trocou as horas por PRs e
--     comentários do dev — outros dados que quem desenvolve controla.
--
-- APROVADO PELO IURY (12/11/2026), itens 1 e 2 da proposta:
--   1. Todo chamado entra do mesmo jeito: as Edges do fechamento pela PR leem
--      "DEV_GITHUB_USUARIO" (_shared/dev-github-login.ts) e o Otavio entra na
--      tabela aqui. Parecer com erro é tentado de novo sozinho — chamado
--      concluído não fica sem valor.
--   2. O valor vem só do que o dev não controla: a Edge chamado-parecer-ia
--      precifica pelo pedido (montarPromptDoPreco), sem horas, PRs nem
--      histórico; editar as horas não refaz mais o preço (sai o gatilho
--      abaixo). Todos os concluídos são reavaliados uma vez pela régua nova.
--
-- As horas informadas continuam gravadas: valem para o custo real (card
-- verde) e para o lucro, não para o preço.
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1) Login do Otavio no GitHub → pessoa ────────────────────────────────
-- A Thamires ainda não tem login conhecido: quando tiver, uma linha aqui.
INSERT INTO public."DEV_GITHUB_USUARIO" (login, profile_id)
SELECT 'otaviosistemas', '3c162159-b340-43d2-837e-ac189397c2ea'::uuid
 WHERE NOT EXISTS (SELECT 1 FROM public."DEV_GITHUB_USUARIO" WHERE lower(login) = 'otaviosistemas');

-- ── 2) Horas não mexem mais no preço ─────────────────────────────────────
-- O parecer nasce na conclusão (trg_chamado_concluido_parecer_ia_escopo, mig
-- 20261112001000). Este gatilho refazia o parecer a cada troca de horas
-- (chamado_informar_horas_gastas, mig 20261110004000) — era o jeito de o dev
-- mudar o próprio valor.
DROP TRIGGER IF EXISTS trg_chamado_horas_gastas_parecer_ia ON public."CHAMADO_SISTEMA";

-- ── 3) Reavaliar todos os concluídos pela régua nova ─────────────────────
-- Mesma fila e mesmo ritmo da mig 20261112001000 (6 por minuto, novembro
-- primeiro, depois do mais novo para o mais antigo).
INSERT INTO public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" (chamado_id, prioridade)
SELECT c.id, 0
  FROM public."CHAMADO_SISTEMA" c
 WHERE c.status = 'concluido'
ON CONFLICT (chamado_id) DO NOTHING;

UPDATE public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" r
   SET prioridade = s.ordem, enfileirado_em = NULL
  FROM (
    SELECT c.id,
           row_number() OVER (ORDER BY ((c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date >= DATE '2026-11-01') DESC,
                                       c.concluido_em DESC NULLS LAST, c.id)::int AS ordem
      FROM public."CHAMADO_SISTEMA" c
     WHERE c.status = 'concluido'
  ) s
 WHERE s.id = r.chamado_id;

-- ── 4) Nenhum concluído fica sem valor ───────────────────────────────────
-- Fila vazia: o lote devolve à fila quem está sem parecer pronto (erro da
-- I.A, cota, ou nunca gerou) — no máximo uma tentativa a cada 6 h por
-- chamado, para não gastar a cota da I.A girando no mesmo erro.
CREATE OR REPLACE FUNCTION public.chamado_parecer_ia_reavaliar_lote(p_qtd integer DEFAULT 6)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_n  integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" WHERE enfileirado_em IS NULL) THEN
    INSERT INTO public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" (chamado_id, prioridade)
    SELECT c.id, 0
      FROM public."CHAMADO_SISTEMA" c
      LEFT JOIN public."CHAMADO_SISTEMA_PARECER_IA" p ON p.chamado_id = c.id
     WHERE c.status = 'concluido'
       AND (p.chamado_id IS NULL OR p.status <> 'pronto')
    ON CONFLICT (chamado_id) DO NOTHING;

    UPDATE public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" r
       SET enfileirado_em = NULL
      FROM public."CHAMADO_SISTEMA" c
      LEFT JOIN public."CHAMADO_SISTEMA_PARECER_IA" p ON p.chamado_id = c.id
     WHERE c.id = r.chamado_id
       AND c.status = 'concluido'
       AND (p.chamado_id IS NULL OR p.status <> 'pronto')
       AND (r.enfileirado_em IS NULL OR r.enfileirado_em < now() - interval '6 hours');
  END IF;

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

-- O cron da mig 20261112001000 continua; reagendado aqui por garantia.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('chamado-parecer-ia-reavaliar')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chamado-parecer-ia-reavaliar');
    PERFORM cron.schedule('chamado-parecer-ia-reavaliar', '* * * * *',
      $job$SELECT public.chamado_parecer_ia_reavaliar_lote(6);$job$);
  ELSE
    RAISE NOTICE 'pg_cron ausente: rode SELECT public.chamado_parecer_ia_reavaliar_lote(6) a cada minuto.';
  END IF;
END
$cron$;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
-- SELECT count(*) FILTER (WHERE enfileirado_em IS NULL) AS faltam, count(*) AS total
--   FROM public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO";
-- SELECT status, count(*) FROM public."CHAMADO_SISTEMA_PARECER_IA" GROUP BY 1;
-- SELECT login, profile_id FROM public."DEV_GITHUB_USUARIO" ORDER BY 1;

-- =========================================================================
-- ROLLBACK
--   DELETE FROM public."DEV_GITHUB_USUARIO" WHERE login = 'otaviosistemas';
--   (gatilho das horas: reaplicar a seção 4 da mig 20261029002400 — só o
--    CREATE TRIGGER trg_chamado_horas_gastas_parecer_ia)
--   (lote sem a nova tentativa: reaplicar a seção 3 da mig 20261112001000)
--   UPDATE public."CHAMADO_SISTEMA_PARECER_IA_REAVALIACAO" SET enfileirado_em = now()
--    WHERE enfileirado_em IS NULL;   -- para a reavaliação
--   Os pareceres já refeitos não voltam ao valor anterior.
-- =========================================================================
