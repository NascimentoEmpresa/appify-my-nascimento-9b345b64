-- =========================================================================
-- RECRUTAMENTO: TEMPO EM CADA STATUS POR RESPONSÁVEL (27/10/2026)
--
-- PEDIDO (Pablo, chamado Gestão Recrutamento): "Possibilidade de controle
-- de responsável por vaga, saber quanto tempo está demorando em cada status
-- por responsável."
--
-- O responsável pela vaga já existe (SISTEMA_RECRUTAMENTO_RESPONSAVEL, mig
-- 20261013000003) e o tempo em cada status também (SISTEMA_RECRUTAMENTO_
-- STATUS_LOG, mig 20260618000001 — "dias_no_anterior"). Faltava ligar os
-- dois: o log não dizia COM QUEM a vaga estava enquanto ficou parada.
--
-- 1) STATUS_LOG ganha responsavel_id / responsavel_nome.
-- 2) sr_track_status_change carimba quem é o responsável NA HORA em que a
--    vaga sai do status. O gatilho é BEFORE UPDATE e a tela grava o status
--    antes do histórico, então o carimbo é de quem segurava a vaga no status
--    que está acabando — não de quem acabou de mexer (que pode virar o
--    responsável logo depois, pelo gatilho do histórico).
-- 3) Carga das linhas antigas pela mesma regra do automático: quem fez o
--    último andamento de Recrutamento na vaga ANTES da troca. Passagens sem
--    nenhum andamento antes (aprovação, abertura) ficam sem responsável —
--    nessa fase a vaga ainda não estava com ninguém do Recrutamento.
-- 4) recrut_tempo_status_responsavel(_de, _ate): média, mediana e maior
--    tempo por responsável × status, das passagens no período. O "parado
--    agora" a tela calcula com o que o dashboard já traz (status, mudou e
--    responsável de cada vaga em aberto).
--
-- O log nunca trava a vaga: a busca do responsável fica dentro do mesmo
-- bloco protegido do INSERT. Idempotente.
-- =========================================================================

-- ── 1) Colunas ───────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_RECRUTAMENTO_STATUS_LOG"
  ADD COLUMN IF NOT EXISTS responsavel_id   uuid,
  ADD COLUMN IF NOT EXISTS responsavel_nome text;

-- ── 2) Gatilho: carimba o responsável ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sr_track_status_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_dias numeric;
  v_resp_id uuid;
  v_resp_nome text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_dias := EXTRACT(EPOCH FROM (now() - COALESCE(OLD.status_changed_at, OLD.created_at))) / 86400.0;
    NEW.status_changed_at := now();
    -- O log nunca pode bloquear a atualização principal da solicitação.
    BEGIN
      SELECT rr.responsavel_id, rr.responsavel_nome INTO v_resp_id, v_resp_nome
        FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" rr WHERE rr.vaga_id = NEW.id;
      INSERT INTO public."SISTEMA_RECRUTAMENTO_STATUS_LOG"
        (solicitacao_id, status_anterior, status_novo, dias_no_anterior, responsavel_id, responsavel_nome)
      VALUES (NEW.id, OLD.status, NEW.status, round(v_dias, 2), v_resp_id, v_resp_nome);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3) Carga das passagens antigas ───────────────────────────────────────
WITH alvo AS (
  SELECT l.id, r.pid, r.nome
    FROM public."SISTEMA_RECRUTAMENTO_STATUS_LOG" l
    CROSS JOIN LATERAL (
      SELECT p.id AS pid, coalesce(nullif(btrim(p.display_name), ''), p.email) AS nome
        FROM public."RECRUTAMENTO_HISTORICO" h
        JOIN public.profiles p ON lower(p.email) = lower(h.usuario_email)
       WHERE h.solicitacao_id = l.solicitacao_id
         AND h.papel = 'Recrutamento'
         AND (h.de_status IS NOT NULL OR h.para_status IS NOT NULL OR h.candidato_id IS NOT NULL)
         AND h.created_at < l.changed_at
       ORDER BY h.created_at DESC, h.id DESC
       LIMIT 1
    ) r
   WHERE l.responsavel_nome IS NULL
)
UPDATE public."SISTEMA_RECRUTAMENTO_STATUS_LOG" l
   SET responsavel_id = alvo.pid, responsavel_nome = alvo.nome
  FROM alvo
 WHERE l.id = alvo.id;

-- ── 4) Relatório ─────────────────────────────────────────────────────────
-- Mesma porta e mesmo recorte do Dashboard Recrutamento (recrut_dashboard_dados):
-- vaga administrativa só para quem a vê.
CREATE OR REPLACE FUNCTION public.recrut_tempo_status_responsavel(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_adm boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'recrutamento_dashboard', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Dashboard Recrutamento. Peça em Administração › Acesso por Usuário.'
      USING ERRCODE = '42501';
  END IF;
  v_adm := public.has_screen_access(v_uid, 'recrutamento_vaga_administrativa', 'visualizar'::public.app_acao)
        OR public.has_screen_access(v_uid, 'diretoria_recrutamento', 'visualizar'::public.app_acao);

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'responsavel', t.responsavel, 'status', t.status, 'n', t.n,
             'media', t.media, 'mediana', t.mediana, 'maximo', t.maximo)
           ORDER BY t.responsavel, t.n DESC)
      FROM (SELECT coalesce(l.responsavel_nome, 'Sem responsável') AS responsavel,
                   l.status_anterior AS status, count(*) AS n,
                   round(avg(l.dias_no_anterior)::numeric, 1) AS media,
                   round((percentile_cont(0.5) WITHIN GROUP (ORDER BY l.dias_no_anterior))::numeric, 1) AS mediana,
                   round(max(l.dias_no_anterior)::numeric, 1) AS maximo
              FROM public."SISTEMA_RECRUTAMENTO_STATUS_LOG" l
              JOIN public."SISTEMA_RECRUTAMENTO" r ON r.id = l.solicitacao_id
             WHERE l.status_anterior IS NOT NULL AND l.dias_no_anterior IS NOT NULL
               AND (NOT coalesce(r.administrativa, false) OR v_adm)
               AND (_de  IS NULL OR (l.changed_at AT TIME ZONE 'America/Sao_Paulo')::date >= _de)
               AND (_ate IS NULL OR (l.changed_at AT TIME ZONE 'America/Sao_Paulo')::date <= _ate)
             GROUP BY 1, 2) t), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.recrut_tempo_status_responsavel(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recrut_tempo_status_responsavel(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.recrut_tempo_status_responsavel(date, date);
-- (sr_track_status_change: reaplicar a versão da mig 20260618000001)
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO_STATUS_LOG" DROP COLUMN IF EXISTS responsavel_nome, DROP COLUMN IF EXISTS responsavel_id;
