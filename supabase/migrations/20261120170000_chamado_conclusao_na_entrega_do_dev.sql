-- =========================================================================
-- [SEM-CHAMADO] Chamados de Sistemas: a hora da CONCLUSÃO é a da entrega do
-- dev (merge da PR ou botão "Concluir chamado"), não a do Gestor (19/11/2026)
--
-- O PEDIDO (Pablo): "preciso que a hora da conclusão fique quando vocês
-- liberam pra eu avaliar e não quando eu avalio; do jeito que tá, se vocês
-- concluírem dentro do tempo esperado e eu demorar, ela fica atrasada." E
-- depois: "o tempo da conclusão do chamado tem que ser quando o dev mergea a
-- pr, não quando o gestor dá o concluido, pq por exemplo o gestor pode ficar
-- 3 dias analisando enquanto o dev já lançou a pr e da parte do dev estava no
-- prazo".
--
-- COMO ERA: desde a mig 20261117235500 o merge (ou o botão do dev, mig
-- 20261118120000) só marca desenvolvimento_entregue_em; quem põe 'concluido'
-- é o Gestor de Sistemas. Nesse UPDATE:
--   · chamado_sistema_desenvolvimento gravava concluido_no_prazo com now() —
--     a hora do GESTOR;
--   · o guard gravava concluido_em = now() — também a do gestor;
--   · chamado_sistema_entrega_merge apagava desenvolvimento_entregue_em (o
--     status mudou), e a hora da entrega se perdia.
--
-- COMO FICA:
--   1. coluna nova concluido_gestor_em = quando o gestor de fato concluiu (só
--      para registro e para a janela de confirmação do solicitante, abaixo);
--   2. concluido_no_prazo compara a PREVISÃO com a hora da entrega
--      (OLD.desenvolvimento_entregue_em); sem entrega (chamado antigo, ou o
--      dev concluiu direto), continua now();
--   3. gatilho novo trg_chamado_zz_conclusao_na_entrega (o "zz" é de
--      propósito: gatilhos BEFORE rodam em ordem alfabética, e este tem que
--      vir DEPOIS do guard, que preenche concluido_em = now()) troca
--      concluido_em pela hora da entrega. Assim TODO relatório que usa
--      concluido_em (dashboards, TVs, Monitoramento, tempo médio) já mede
--      até a entrega, sem mexer em cada um;
--   4. chamado_confirmar_conclusoes_antigas (mig 20261029001100) passa a
--      olhar concluido_gestor_em: o chamado entregue na semana passada e
--      concluído pelo gestor hoje NÃO pode ser confirmado sozinho de
--      madrugada — o solicitante só soube hoje;
--   5. chamado_gerencial_listar devolve desenvolvimento_entregue_em, para o
--      Acompanhamento não contar como "atrasado" o que só espera o gestor;
--   6. backfill: concluídos com evento 'desenvolvimento_entregue' antes da
--      conclusão ganham concluido_em = essa entrega e concluido_no_prazo
--      recalculado. Sem evento (antigos), nada muda.
--
-- Corpo de chamado_sistema_desenvolvimento = mig 20261028001900 + item 2.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1. Coluna ────────────────────────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS concluido_gestor_em timestamptz;
COMMENT ON COLUMN public."CHAMADO_SISTEMA".concluido_gestor_em IS
  'Quando o status virou concluido (o Gestor de Sistemas concluiu). concluido_em guarda a entrega do dev (merge/botão) desde a mig 20261120170000.';

-- ── 2. Confirmação automática: pela hora do gestor ──────────────────────
-- Corpo da mig 20261029001100 com COALESCE(concluido_gestor_em, ...).
CREATE OR REPLACE FUNCTION public.chamado_confirmar_conclusoes_antigas()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_corte timestamptz := date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_replica boolean := false;
  v_n integer;
BEGIN
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    v_replica := true;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.chamado_confirmacao', 'on', true);
  END;

  UPDATE public."CHAMADO_SISTEMA"
     SET conclusao_confirmada_em  = COALESCE(concluido_gestor_em, concluido_em, updated_at, now()),
         conclusao_confirmada_por = NULL
   WHERE status = 'concluido'
     AND conclusao_confirmada_em IS NULL
     AND COALESCE(concluido_gestor_em, concluido_em, updated_at) < v_corte;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_replica THEN
    PERFORM set_config('session_replication_role', 'origin', true);
  ELSE
    PERFORM set_config('app.chamado_confirmacao', 'off', true);
  END IF;

  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.chamado_confirmar_conclusoes_antigas() FROM PUBLIC, anon, authenticated;

-- ── 3. Backfill (antes do gatilho novo, que travaria concluido_gestor_em) ─
DO $$
DECLARE
  v_replica boolean := false;
BEGIN
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    v_replica := true;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  END;

  WITH entrega AS (
    SELECT c.id,
           (SELECT max(e.created_at) FROM public."CHAMADO_SISTEMA_EVENTO" e
             WHERE e.chamado_id = c.id
               AND e.meta->>'acao' = 'desenvolvimento_entregue'
               AND e.created_at <= c.concluido_em) AS em
      FROM public."CHAMADO_SISTEMA" c
     WHERE c.status = 'concluido'
       AND c.concluido_em IS NOT NULL
       AND c.concluido_gestor_em IS NULL
  )
  UPDATE public."CHAMADO_SISTEMA" c
     SET concluido_gestor_em = c.concluido_em,
         concluido_em        = en.em,
         concluido_no_prazo  = CASE
           WHEN c.prazo_dias IS NULL THEN c.concluido_no_prazo
           ELSE en.em <= public.chamado_previsao_entrega(
                  COALESCE(c.desenvolvimento_iniciado_em, c.prazo_definido_em), c.prazo_dias, c.prazo_unidade)
         END
    FROM entrega en
   WHERE en.id = c.id AND en.em IS NOT NULL;

  IF v_replica THEN
    PERFORM set_config('session_replication_role', 'origin', true);
  ELSE
    PERFORM set_config('request.jwt.claim.role', '', true);
  END IF;
END $$;

-- ── 4. "No prazo" medido até a entrega ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_desenvolvimento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_marca boolean := COALESCE(current_setting('app.chamado_inicio_dev', true) = 'on', false);
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.desenvolvimento_iniciado_em := NULL;
    NEW.desenvolvimento_iniciado_por := NULL;
    NEW.prazo_conclusao_em := NULL;
    NEW.prazo_dias := NULL;
    NEW.prazo_unidade := 'dias';
    NEW.prazo_definido_em := NULL;
    NEW.prazo_definido_por := NULL;
    NEW.prazo_posicao_fila := NULL;
    NEW.prazo_redefinicoes := 0;
    NEW.concluido_no_prazo := NULL;
    RETURN NEW;
  END IF;

  -- Outro dev assumiu, ou o chamado encerrado voltou para a fila: início e
  -- prazo eram da rodada anterior — o dev (novo) define o seu.
  IF NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
     OR (OLD.status IN ('concluido', 'reprovado', 'cancelado')
         AND NEW.status NOT IN ('concluido', 'reprovado', 'cancelado')) THEN
    NEW.desenvolvimento_iniciado_em := NULL;
    NEW.desenvolvimento_iniciado_por := NULL;
    NEW.prazo_conclusao_em := NULL;
    NEW.prazo_dias := NULL;
    NEW.prazo_unidade := 'dias';
    NEW.prazo_definido_em := NULL;
    NEW.prazo_definido_por := NULL;
    NEW.prazo_posicao_fila := NULL;
    NEW.prazo_redefinicoes := 0;
    NEW.concluido_no_prazo := NULL;
    RETURN NEW;
  END IF;

  -- Concluiu: dentro do prazo ou com atraso. Sem início marcado, a previsão
  -- conta de quando o prazo foi definido. A régua é a ENTREGA do dev (merge
  -- da PR / botão) — o tempo do gestor avaliando não conta (mig
  -- 20261120170000); sem entrega marcada, a hora de agora.
  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    NEW.concluido_no_prazo := CASE
      WHEN NEW.prazo_dias IS NULL THEN NULL
      ELSE COALESCE(OLD.desenvolvimento_entregue_em, now()) <= public.chamado_previsao_entrega(
             COALESCE(NEW.desenvolvimento_iniciado_em, NEW.prazo_definido_em), NEW.prazo_dias, NEW.prazo_unidade)
    END;
  ELSIF NEW.status IS DISTINCT FROM 'concluido' THEN
    NEW.concluido_no_prazo := NULL;
  END IF;

  -- Início e prazo: só pelas RPCs (marca de transação) ou servidor.
  -- Limpar (NULL) passa — a FK ON DELETE SET NULL da exclusão de usuário vem por aqui.
  IF NOT (v_marca OR v_auto) AND (
       (NEW.desenvolvimento_iniciado_em IS NOT NULL AND NEW.desenvolvimento_iniciado_em IS DISTINCT FROM OLD.desenvolvimento_iniciado_em)
    OR (NEW.desenvolvimento_iniciado_por IS NOT NULL AND NEW.desenvolvimento_iniciado_por IS DISTINCT FROM OLD.desenvolvimento_iniciado_por)
    OR (NEW.prazo_conclusao_em IS NOT NULL AND NEW.prazo_conclusao_em IS DISTINCT FROM OLD.prazo_conclusao_em)
    OR (NEW.prazo_dias IS NOT NULL AND NEW.prazo_dias IS DISTINCT FROM OLD.prazo_dias)
    OR NEW.prazo_unidade IS DISTINCT FROM OLD.prazo_unidade
    OR (NEW.prazo_definido_em IS NOT NULL AND NEW.prazo_definido_em IS DISTINCT FROM OLD.prazo_definido_em)
    OR (NEW.prazo_posicao_fila IS NOT NULL AND NEW.prazo_posicao_fila IS DISTINCT FROM OLD.prazo_posicao_fila)
    OR NEW.prazo_redefinicoes IS DISTINCT FROM OLD.prazo_redefinicoes) THEN
    RAISE EXCEPTION 'O prazo e o início do desenvolvimento são definidos no Painel do Desenvolvedor (Iniciar desenvolvimento / Ajustar prazo).';
  END IF;
  -- concluido_no_prazo só o próprio gatilho escreve.
  IF NOT v_auto AND NEW.status = OLD.status AND NEW.concluido_no_prazo IS DISTINCT FROM OLD.concluido_no_prazo THEN
    NEW.concluido_no_prazo := OLD.concluido_no_prazo;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_desenvolvimento() FROM PUBLIC, anon, authenticated;

-- ── 5. concluido_em = hora da entrega ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_conclusao_na_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    NEW.concluido_gestor_em := now();
    -- LEAST: nunca joga a conclusão para depois do que o guard/tela gravou.
    IF OLD.desenvolvimento_entregue_em IS NOT NULL THEN
      NEW.concluido_em := LEAST(OLD.desenvolvimento_entregue_em, COALESCE(NEW.concluido_em, now()));
    END IF;
  ELSIF NEW.status IS DISTINCT FROM 'concluido' THEN
    NEW.concluido_gestor_em := NULL;
  ELSIF NOT COALESCE(auth.role() = 'service_role', false) THEN
    -- Continua concluído: só o gatilho escreve esta coluna.
    NEW.concluido_gestor_em := OLD.concluido_gestor_em;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_conclusao_na_entrega() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_zz_conclusao_na_entrega ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_zz_conclusao_na_entrega BEFORE UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_conclusao_na_entrega();

-- ── 6. Acompanhamento gerencial: + desenvolvimento_entregue_em ──────────
-- Corpo da mig 20261117000200 + a coluna no fim (muda o tipo de retorno:
-- precisa DROP).
DROP FUNCTION IF EXISTS public.chamado_gerencial_listar();
CREATE FUNCTION public.chamado_gerencial_listar()
RETURNS TABLE(
  id uuid, numero text, assunto text, descricao text, prioridade text, status text,
  setor text, solicitante_id uuid, solicitante_nome text,
  responsavel_id uuid, responsavel_nome text, posicao_dev integer,
  modulo_sistema text, modulo_sistema_outro text,
  created_at timestamptz, concluido_em timestamptz, cancelado_em timestamptz,
  conclusao_confirmada_em timestamptz, concluido_sem_retorno boolean, gestao_finalizada_em timestamptz,
  desenvolvimento_iniciado_em timestamptz, prazo_conclusao_em timestamptz, prazo_solicitante date,
  concluido_no_prazo boolean, horas_gastas numeric,
  etapa_validacao text, avaliacao_nota numeric, avaliacao_comentario text,
  acoes_pendentes integer, desenvolvimento_entregue_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.chamado_gerencial_pode_ver() THEN
    RAISE EXCEPTION 'Sem acesso ao Acompanhamento de Chamados.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.numero::text, c.assunto::text, c.descricao::text, c.prioridade::text, c.status::text,
         c.setor::text, c.solicitante_id, COALESCE(ps.display_name, c.solicitante_nome)::text,
         c.responsavel_id, pr.display_name::text, c.posicao_dev::integer,
         c.modulo_sistema::text, c.modulo_sistema_outro::text,
         c.created_at, c.concluido_em, c.cancelado_em,
         c.conclusao_confirmada_em, COALESCE(c.concluido_sem_retorno, false), c.gestao_finalizada_em,
         c.desenvolvimento_iniciado_em, c.prazo_conclusao_em, c.prazo_solicitante::date,
         c.concluido_no_prazo, c.horas_gastas::numeric,
         v.etapa::text,
         CASE WHEN a.id IS NULL THEN NULL
              ELSE round((a.qualidade * 0.30 + a.prazo * 0.20 + a.comunicacao * 0.15
                          + a.clareza * 0.10 + a.facilidade * 0.10 + a.satisfacao * 0.15)::numeric, 2) END,
         a.comentario::text,
         (SELECT count(*)::integer FROM public."CHAMADO_SISTEMA_ACAO_GESTAO" g
           WHERE g.chamado_id = c.id AND g.status = 'pendente'),
         c.desenvolvimento_entregue_em
    FROM public."CHAMADO_SISTEMA" c
    LEFT JOIN public.profiles ps ON ps.id = c.solicitante_id
    LEFT JOIN public.profiles pr ON pr.id = c.responsavel_id
    LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
    LEFT JOIN public."CHAMADO_SISTEMA_AVALIACAO" a ON a.chamado_id = c.id
   ORDER BY c.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_gerencial_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gerencial_listar() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_chamado_zz_conclusao_na_entrega ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_sistema_conclusao_na_entrega();
--   -- chamado_sistema_desenvolvimento: reaplicar o corpo da mig 20261028001900.
--   -- chamado_confirmar_conclusoes_antigas: reaplicar o da mig 20261029001100.
--   -- chamado_gerencial_listar: DROP + reaplicar o da mig 20261117000200.
--   -- Desfazer o backfill (antes de apagar a coluna):
--   -- UPDATE public."CHAMADO_SISTEMA" SET concluido_em = concluido_gestor_em
--   --  WHERE concluido_gestor_em IS NOT NULL;   -- (com os gatilhos desligados)
--   ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS concluido_gestor_em;
-- =========================================================================
