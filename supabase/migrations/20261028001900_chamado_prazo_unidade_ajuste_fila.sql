-- =========================================================================
-- Chamados de Sistemas: PRAZO EM HORAS, DIAS OU SEMANAS + ajuste quando a
-- posição na fila muda (28/10/2026, SIS-2026-0763)
--
-- Pedido do Pablo:
--   "determinar se o prazo vai ser em dias, horas, semanas."
--   "E se for ajustado a posição do chamado o desenvolvedor PODE AJUSTAR O
--   PRAZO. exemplo, se meu chamado numero 5 foi pra 6, posso ajustar o prazo,
--   e vice versa."
--
-- Em relação à mig 20261028001410:
--   · prazo_unidade ('horas' | 'dias' | 'semanas', padrão 'dias'). A coluna
--     prazo_dias continua sendo a QUANTIDADE (o nome ficou da versão só em
--     dias; renomear quebraria as telas já publicadas). Os prazos já gravados
--     são em dias, e o padrão cobre isso.
--   · Previsão de entrega (chamado_previsao_entrega com unidade):
--       horas   → início + N horas (corridas, com a hora exata);
--       dias    → N dias úteis depois, até 23:59 desse dia;
--       semanas → N × 5 dias úteis depois, até 23:59 desse dia.
--     Dias úteis = sem sábado, domingo e feriado nacional (chamado_feriado).
--   · Ajuste do prazo: liberado quando a posição na fila MUDOU desde que o
--     prazo foi definido — desceu (5º → 6º) OU subiu (6º → 5º). Antes era só
--     quando descia. Sem mudança de posição, continua travado.
--   · Limite da quantidade: até 720 horas, 120 dias ou 24 semanas.
--   · concluido_no_prazo: concluiu até a previsão (para horas, pela hora; para
--     dias/semanas, até o fim do dia da previsão — igual a antes).
-- =========================================================================

-- ── 1. Unidade + limite da quantidade ────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS prazo_unidade text NOT NULL DEFAULT 'dias';

ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS chamado_sistema_prazo_unidade_check;
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD CONSTRAINT chamado_sistema_prazo_unidade_check CHECK (prazo_unidade IN ('horas', 'dias', 'semanas'));

-- O CHECK da mig 1410 (prazo_dias entre 1 e 120) não comporta 720 horas.
ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS "CHAMADO_SISTEMA_prazo_dias_check";
ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS chamado_sistema_prazo_quantidade_check;
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD CONSTRAINT chamado_sistema_prazo_quantidade_check CHECK (prazo_dias IS NULL OR prazo_dias BETWEEN 1 AND 720);

COMMENT ON COLUMN public."CHAMADO_SISTEMA".prazo_dias IS
  'QUANTIDADE do prazo informado pelo dev, na unidade de prazo_unidade (mig 20261028001900; o nome é da versão só em dias).';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".prazo_unidade IS
  'Unidade do prazo do dev: horas, dias (úteis) ou semanas (de 5 dias úteis). Mig 20261028001900.';

-- ── 2. Previsão com unidade ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_previsao_entrega(p_inicio timestamptz, p_quantidade int, p_unidade text)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT CASE COALESCE(p_unidade, 'dias')
    WHEN 'horas' THEN p_inicio + make_interval(hours => GREATEST(COALESCE(p_quantidade, 0), 0))
    WHEN 'semanas' THEN public.chamado_previsao_entrega(p_inicio, GREATEST(COALESCE(p_quantidade, 0), 0) * 5)
    ELSE public.chamado_previsao_entrega(p_inicio, p_quantidade)
  END;
$$;

-- Limite por unidade (o mesmo da tela: LIMITE_PRAZO em prazoDesenvolvimento.ts).
CREATE OR REPLACE FUNCTION public.chamado_prazo_valido(p_quantidade int, p_unidade text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT p_quantidade IS NOT NULL AND p_quantidade >= 1 AND CASE p_unidade
    WHEN 'horas' THEN p_quantidade <= 720
    WHEN 'dias' THEN p_quantidade <= 120
    WHEN 'semanas' THEN p_quantidade <= 24
    ELSE false
  END;
$$;

-- ── 3. Gatilho: corpo da mig 1410 + unidade ──────────────────────────────
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
  -- conta de quando o prazo foi definido.
  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    NEW.concluido_no_prazo := CASE
      WHEN NEW.prazo_dias IS NULL THEN NULL
      ELSE now() <= public.chamado_previsao_entrega(
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

-- ── 4. Definir / ajustar o prazo (com unidade; ajuste quando a posição mudou) ─
DROP FUNCTION IF EXISTS public.chamado_definir_prazo(uuid, int);
CREATE OR REPLACE FUNCTION public.chamado_definir_prazo(p_chamado_id uuid, p_quantidade int, p_unidade text DEFAULT 'dias')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_c         public."CHAMADO_SISTEMA"%ROWTYPE;
  v_unidade   text := COALESCE(p_unidade, 'dias');
  v_ajuste    boolean;
  v_previsao  timestamptz;
  v_rotulo    text;
  v_texto     text;
BEGIN
  IF NOT public.chamado_prazo_valido(p_quantidade, v_unidade) THEN
    RAISE EXCEPTION 'Informe o prazo: de 1 a 720 horas, 1 a 120 dias úteis ou 1 a 24 semanas.';
  END IF;

  SELECT * INTO v_c FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  -- Mesma régua do chamado_sistema_guard para mexer no andamento.
  IF NOT (COALESCE(v_c.responsavel_id = auth.uid(), false)
          OR public.tem_acesso_menu('chamados_sistemas_coordenar')
          OR public.tem_acesso_menu('chamados_sistemas_aprovar')) THEN
    RAISE EXCEPTION 'Só o desenvolvedor responsável (ou a coordenação) define o prazo.';
  END IF;
  IF v_c.responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Direcione o chamado a um desenvolvedor antes de definir o prazo.';
  END IF;
  IF v_c.status NOT IN ('aberto', 'em_andamento', 'aguardando_retorno') THEN
    RAISE EXCEPTION 'Chamado encerrado — não há prazo para definir.';
  END IF;

  v_ajuste := v_c.prazo_dias IS NOT NULL;
  -- Ajuste: só quando a posição na fila mudou (subiu ou desceu) desde que o
  -- prazo foi definido. Sem mudança, o prazo continua travado.
  IF v_ajuste AND NOT (v_c.posicao_dev IS NOT NULL AND v_c.prazo_posicao_fila IS NOT NULL
                       AND v_c.posicao_dev <> v_c.prazo_posicao_fila) THEN
    RAISE EXCEPTION 'O prazo deste chamado já foi definido e só pode ser ajustado quando a posição dele na fila muda.';
  END IF;

  v_previsao := CASE WHEN v_c.desenvolvimento_iniciado_em IS NOT NULL
                     THEN public.chamado_previsao_entrega(v_c.desenvolvimento_iniciado_em, p_quantidade, v_unidade) END;

  PERFORM set_config('app.chamado_inicio_dev', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET prazo_dias         = p_quantidade,
         prazo_unidade      = v_unidade,
         prazo_definido_em  = now(),
         prazo_definido_por = auth.uid(),
         prazo_posicao_fila = posicao_dev,
         prazo_redefinicoes = prazo_redefinicoes + CASE WHEN v_ajuste THEN 1 ELSE 0 END,
         prazo_conclusao_em = COALESCE(v_previsao, prazo_conclusao_em),
         prazo_previsto     = COALESCE((v_previsao AT TIME ZONE 'America/Sao_Paulo')::date, prazo_previsto)
   WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_inicio_dev', 'off', true);

  v_rotulo := p_quantidade || CASE v_unidade WHEN 'horas' THEN ' hora(s)' WHEN 'semanas' THEN ' semana(s)' ELSE ' dia(s) útil(eis)' END;
  v_texto := CASE WHEN v_ajuste
                  THEN format('Prazo ajustado para %s — a tarefa mudou de posição na fila (%sº → %sº)',
                              v_rotulo, v_c.prazo_posicao_fila, v_c.posicao_dev)
                  ELSE 'Prazo definido: ' || v_rotulo END
          || CASE WHEN v_previsao IS NOT NULL
                  THEN ' — previsão de entrega: ' || to_char(v_previsao AT TIME ZONE 'America/Sao_Paulo',
                         CASE WHEN v_unidade = 'horas' THEN 'DD/MM/YYYY "às" HH24:MI' ELSE 'DD/MM/YYYY' END)
                  ELSE '' END;
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento', v_texto,
          jsonb_build_object('acao', CASE WHEN v_ajuste THEN 'prazo_redefinido' ELSE 'prazo_definido' END,
                             'prazo_quantidade', p_quantidade, 'prazo_unidade', v_unidade, 'posicao_fila', v_c.posicao_dev));

  -- Ajuste muda a previsão que o solicitante já viu: avisa no sino.
  IF v_ajuste AND v_previsao IS NOT NULL AND v_c.solicitante_id IS DISTINCT FROM auth.uid() THEN
    BEGIN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (v_c.solicitante_id, 'Novo prazo no chamado #' || v_c.numero,
              left(v_c.assunto, 120) || ' — nova previsão de entrega: '
                || to_char(v_previsao AT TIME ZONE 'America/Sao_Paulo',
                           CASE WHEN v_unidade = 'horas' THEN 'DD/MM/YYYY "às" HH24:MI' ELSE 'DD/MM/YYYY' END) || '.',
              'chamado_desenvolvimento', '/app/central-servicos/chamados/' || p_chamado_id || '/acompanhar');
    EXCEPTION WHEN others THEN
      RAISE WARNING 'chamado_definir_prazo (aviso %): %', p_chamado_id, SQLERRM;
    END;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_definir_prazo(uuid, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_definir_prazo(uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_definir_prazo(uuid, int, text) TO authenticated;

-- ── 5. Iniciar desenvolvimento com prazo em horas / dias / semanas ───────
DROP FUNCTION IF EXISTS public.chamado_iniciar_desenvolvimento(uuid, int);
CREATE OR REPLACE FUNCTION public.chamado_iniciar_desenvolvimento(p_chamado_id uuid, p_quantidade int DEFAULT NULL, p_unidade text DEFAULT 'dias')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_c        public."CHAMADO_SISTEMA"%ROWTYPE;
  v_previsao timestamptz;
  v_prev_tx  text;
  v_rotulo   text;
BEGIN
  SELECT * INTO v_c FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF NOT (COALESCE(v_c.responsavel_id = auth.uid(), false)
          OR public.tem_acesso_menu('chamados_sistemas_coordenar')
          OR public.tem_acesso_menu('chamados_sistemas_aprovar')) THEN
    RAISE EXCEPTION 'Só o desenvolvedor responsável (ou a coordenação) inicia o desenvolvimento.';
  END IF;
  IF v_c.responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Direcione o chamado a um desenvolvedor antes de iniciar.';
  END IF;
  IF v_c.desenvolvimento_iniciado_em IS NOT NULL THEN
    RAISE EXCEPTION 'O desenvolvimento deste chamado já foi iniciado.';
  END IF;
  IF v_c.status NOT IN ('aberto', 'em_andamento') THEN
    RAISE EXCEPTION 'Só dá para iniciar chamado aberto ou em andamento (este está %).', v_c.status;
  END IF;

  -- Prazo obrigatório: o já definido ou o informado agora.
  IF v_c.prazo_dias IS NULL THEN
    IF p_quantidade IS NULL THEN
      RAISE EXCEPTION 'Informe o prazo (em horas, dias ou semanas) para concluir o chamado antes de iniciar.';
    END IF;
    PERFORM public.chamado_definir_prazo(p_chamado_id, p_quantidade, COALESCE(p_unidade, 'dias'));
    SELECT * INTO v_c FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id;
  END IF;

  v_previsao := public.chamado_previsao_entrega(now(), v_c.prazo_dias, v_c.prazo_unidade);
  PERFORM set_config('app.chamado_inicio_dev', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET status                       = CASE WHEN status = 'aberto' THEN 'em_andamento' ELSE status END,
         desenvolvimento_iniciado_em  = now(),
         desenvolvimento_iniciado_por = auth.uid(),
         prazo_conclusao_em           = v_previsao,
         prazo_previsto               = (v_previsao AT TIME ZONE 'America/Sao_Paulo')::date
   WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_inicio_dev', 'off', true);

  v_prev_tx := to_char(v_previsao AT TIME ZONE 'America/Sao_Paulo',
                       CASE WHEN v_c.prazo_unidade = 'horas' THEN 'DD/MM/YYYY "às" HH24:MI' ELSE 'DD/MM/YYYY' END);
  v_rotulo := v_c.prazo_dias || CASE v_c.prazo_unidade WHEN 'horas' THEN ' hora(s)' WHEN 'semanas' THEN ' semana(s)' ELSE ' dia(s) útil(eis)' END;
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          format('Desenvolvimento iniciado — prazo de %s, previsão de entrega: %s', v_rotulo, v_prev_tx),
          jsonb_build_object('acao', 'desenvolvimento_iniciado', 'prazo_quantidade', v_c.prazo_dias,
                             'prazo_unidade', v_c.prazo_unidade, 'previsao', v_previsao));

  IF v_c.solicitante_id IS DISTINCT FROM auth.uid() THEN
    BEGIN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (v_c.solicitante_id, 'Seu chamado #' || v_c.numero || ' está em desenvolvimento',
              left(v_c.assunto, 120) || ' — previsão de entrega: ' || v_prev_tx || '.',
              'chamado_desenvolvimento', '/app/central-servicos/chamados/' || p_chamado_id || '/acompanhar');
    EXCEPTION WHEN others THEN
      RAISE WARNING 'chamado_iniciar_desenvolvimento (aviso %): %', p_chamado_id, SQLERRM;
    END;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_iniciar_desenvolvimento(uuid, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_iniciar_desenvolvimento(uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_iniciar_desenvolvimento(uuid, int, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.chamado_iniciar_desenvolvimento(uuid, int, text);
-- DROP FUNCTION IF EXISTS public.chamado_definir_prazo(uuid, int, text);
-- -- recriar chamado_iniciar_desenvolvimento(uuid, int), chamado_definir_prazo(uuid, int)
-- -- e chamado_sistema_desenvolvimento() como na mig 20261028001410
-- DROP FUNCTION IF EXISTS public.chamado_prazo_valido(int, text);
-- DROP FUNCTION IF EXISTS public.chamado_previsao_entrega(timestamptz, int, text);
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS chamado_sistema_prazo_quantidade_check;
-- ALTER TABLE public."CHAMADO_SISTEMA" ADD CONSTRAINT "CHAMADO_SISTEMA_prazo_dias_check" CHECK (prazo_dias IS NULL OR prazo_dias BETWEEN 1 AND 120);
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS chamado_sistema_prazo_unidade_check;
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS prazo_unidade;
-- NOTIFY pgrst, 'reload schema';
