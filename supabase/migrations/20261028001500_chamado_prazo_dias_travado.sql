-- =========================================================================
-- Chamados de Sistemas: PRAZO EM DIAS TRAVADO + concluído no prazo / com atraso
-- (28/10/2026, chamado SIS-2026-0763)
--
-- Pedido do Pablo (parte B do chamado):
--   "Ao receber a tarefa o desenvolvedor deve definir o prazo de acordo com as
--   suas prioridades, esse prazo não poderá ser alterado, somente se a tarefa
--   descer de prioridade. Ao concluir a tarefa deve ficar com o status de
--   concluída dentro do prazo ou concluída com atraso."
-- Referência: mockup do Painel do Desenvolvedor com "Prazo (dias)"
-- obrigatório, Início Dev., Previsão de entrega, Situação do prazo e Fila
-- (5º → 8º quando desceu, com "Redefinir prazo").
--
-- O QUE MUDA em relação à mig 20261028001400 (início com prazo em horas/dias,
-- alterável a qualquer hora):
--   · O prazo agora é o ESFORÇO em DIAS ÚTEIS (prazo_dias), definido pelo dev
--     ao receber a tarefa — antes ou ao iniciar o desenvolvimento.
--   · TRAVADO: uma vez definido, só a RPC chamado_definir_prazo muda, e só
--     quando a tarefa DESCEU na fila do dev (posicao_dev atual maior que a
--     posição gravada quando o prazo foi definido, prazo_posicao_fila).
--     Nem a coordenação destrava fora disso — é a regra do pedido.
--   · Previsão de entrega = início do desenvolvimento + prazo_dias em dias
--     úteis (sem sábado, domingo e feriado nacional), gravada em
--     prazo_conclusao_em quando o dev inicia. Antes de iniciar, a previsão é
--     uma projeção pela fila, calculada na tela (as tarefas da frente primeiro)
--     — muda sozinha quando a fila muda.
--   · Ao concluir, o gatilho grava concluido_no_prazo (true = dentro do prazo,
--     false = com atraso, NULL = chamado sem prazo, legado). Comparação por
--     DIA: entregar no dia da previsão é no prazo.
--   · prazo_previsto (date, antigo) continua recebendo o dia da previsão, para
--     os indicadores que já o leem (atrasados, TV de TI, Monitoramento).
--
-- Feriados: os mesmos de src/lib/feriadosNacionais.ts do tipo "Feriado"
-- (fixos nacionais + Sexta-feira Santa). Ponto facultativo (Carnaval, Corpus
-- Christi) conta como dia útil, como lá. Mudar um = mudar o outro.
-- =========================================================================

-- ── 1. Colunas ────────────────────────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS prazo_dias          integer CHECK (prazo_dias IS NULL OR prazo_dias BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS prazo_definido_em   timestamptz,
  ADD COLUMN IF NOT EXISTS prazo_definido_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prazo_posicao_fila  integer,
  ADD COLUMN IF NOT EXISTS prazo_redefinicoes  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS concluido_no_prazo  boolean;

COMMENT ON COLUMN public."CHAMADO_SISTEMA".prazo_dias IS
  'Esforço em dias úteis informado pelo dev (mig 20261028001500). Travado: só redefine quando a tarefa desce na fila.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".prazo_posicao_fila IS
  'posicao_dev quando o prazo foi definido. posicao_dev maior que isto = desceu de prioridade = libera redefinir.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".concluido_no_prazo IS
  'Gravado ao concluir: true = dentro do prazo, false = com atraso, NULL = sem prazo (legado).';

-- ── 2. Dias úteis ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_feriado(p_dia date)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $$
DECLARE
  y int := extract(year FROM p_dia)::int;
  a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
  v_pascoa date;
BEGIN
  IF to_char(p_dia, 'MM-DD') IN ('01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25') THEN
    RETURN true;
  END IF;
  -- Páscoa (Gauss / Meeus-Jones-Butcher), igual a src/lib/feriadosNacionais.ts.
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  v_pascoa := make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
  RETURN p_dia = v_pascoa - 2;  -- Sexta-feira Santa
END;
$$;

-- Dia (data) que fica N dias úteis depois de p_inicio, no fuso de Brasília.
CREATE OR REPLACE FUNCTION public.chamado_somar_dias_uteis(p_inicio timestamptz, p_dias int)
RETURNS date LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_dia  date := (p_inicio AT TIME ZONE 'America/Sao_Paulo')::date;
  v_falta int := GREATEST(COALESCE(p_dias, 0), 0);
BEGIN
  WHILE v_falta > 0 LOOP
    v_dia := v_dia + 1;
    IF extract(isodow FROM v_dia) < 6 AND NOT public.chamado_feriado(v_dia) THEN
      v_falta := v_falta - 1;
    END IF;
  END LOOP;
  RETURN v_dia;
END;
$$;

-- Previsão de entrega com hora: fim do dia útil da previsão (23:59 de Brasília),
-- para "entregou no dia = no prazo".
CREATE OR REPLACE FUNCTION public.chamado_previsao_entrega(p_inicio timestamptz, p_dias int)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT ((public.chamado_somar_dias_uteis(p_inicio, p_dias) + time '23:59:59') AT TIME ZONE 'America/Sao_Paulo');
$$;

-- ── 3. Gatilho: estende o da mig 20261028001400 ──────────────────────────
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
    NEW.prazo_definido_em := NULL;
    NEW.prazo_definido_por := NULL;
    NEW.prazo_posicao_fila := NULL;
    NEW.prazo_redefinicoes := 0;
    NEW.concluido_no_prazo := NULL;
    RETURN NEW;
  END IF;

  -- Concluiu: dentro do prazo ou com atraso (por DIA, em Brasília). Sem
  -- início marcado, a previsão conta de quando o prazo foi definido.
  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    NEW.concluido_no_prazo := CASE
      WHEN NEW.prazo_dias IS NULL THEN NULL
      ELSE (now() AT TIME ZONE 'America/Sao_Paulo')::date
           <= public.chamado_somar_dias_uteis(COALESCE(NEW.desenvolvimento_iniciado_em, NEW.prazo_definido_em), NEW.prazo_dias)
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
    OR (NEW.prazo_definido_em IS NOT NULL AND NEW.prazo_definido_em IS DISTINCT FROM OLD.prazo_definido_em)
    OR (NEW.prazo_posicao_fila IS NOT NULL AND NEW.prazo_posicao_fila IS DISTINCT FROM OLD.prazo_posicao_fila)
    OR NEW.prazo_redefinicoes IS DISTINCT FROM OLD.prazo_redefinicoes) THEN
    RAISE EXCEPTION 'O prazo e o início do desenvolvimento são definidos no Painel do Desenvolvedor (Definir prazo / Iniciar desenvolvimento).';
  END IF;
  -- concluido_no_prazo só o próprio gatilho escreve.
  IF NOT v_auto AND NEW.status = OLD.status AND NEW.concluido_no_prazo IS DISTINCT FROM OLD.concluido_no_prazo THEN
    NEW.concluido_no_prazo := OLD.concluido_no_prazo;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_desenvolvimento() FROM PUBLIC, anon, authenticated;
-- (o gatilho trg_chamado_sistema_desenvolvimento, da mig 20261028001400, já
--  aponta para esta função — só o corpo muda.)

-- ── 4. RPC: definir (ou redefinir, se desceu na fila) o prazo ────────────
CREATE OR REPLACE FUNCTION public.chamado_definir_prazo(p_chamado_id uuid, p_dias int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_c         public."CHAMADO_SISTEMA"%ROWTYPE;
  v_redefinir boolean;
  v_previsao  timestamptz;
  v_texto     text;
BEGIN
  IF p_dias IS NULL OR p_dias < 1 OR p_dias > 120 THEN
    RAISE EXCEPTION 'Informe o prazo em dias úteis (de 1 a 120).';
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

  v_redefinir := v_c.prazo_dias IS NOT NULL;
  IF v_redefinir AND NOT (v_c.posicao_dev IS NOT NULL AND v_c.prazo_posicao_fila IS NOT NULL
                          AND v_c.posicao_dev > v_c.prazo_posicao_fila) THEN
    RAISE EXCEPTION 'O prazo deste chamado já foi definido (% dia(s) útil(eis)) e só pode ser redefinido quando a tarefa desce de prioridade na fila.', v_c.prazo_dias;
  END IF;

  v_previsao := CASE WHEN v_c.desenvolvimento_iniciado_em IS NOT NULL
                     THEN public.chamado_previsao_entrega(v_c.desenvolvimento_iniciado_em, p_dias) END;

  PERFORM set_config('app.chamado_inicio_dev', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET prazo_dias         = p_dias,
         prazo_definido_em  = now(),
         prazo_definido_por = auth.uid(),
         prazo_posicao_fila = posicao_dev,
         prazo_redefinicoes = prazo_redefinicoes + CASE WHEN v_redefinir THEN 1 ELSE 0 END,
         prazo_conclusao_em = COALESCE(v_previsao, prazo_conclusao_em),
         prazo_previsto     = COALESCE((v_previsao AT TIME ZONE 'America/Sao_Paulo')::date, prazo_previsto)
   WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_inicio_dev', 'off', true);

  v_texto := CASE WHEN v_redefinir
                  THEN format('Prazo redefinido para %s dia(s) útil(eis) — a tarefa desceu na fila (%sº → %sº)',
                              p_dias, v_c.prazo_posicao_fila, v_c.posicao_dev)
                  ELSE format('Prazo definido: %s dia(s) útil(eis)', p_dias) END
          || CASE WHEN v_previsao IS NOT NULL
                  THEN ' — previsão de entrega: ' || to_char(v_previsao AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') ELSE '' END;
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento', v_texto,
          jsonb_build_object('acao', CASE WHEN v_redefinir THEN 'prazo_redefinido' ELSE 'prazo_definido' END,
                             'prazo_dias', p_dias, 'posicao_fila', v_c.posicao_dev));

  -- Redefinição muda a previsão que o solicitante já viu: avisa no sino.
  IF v_redefinir AND v_previsao IS NOT NULL AND v_c.solicitante_id IS DISTINCT FROM auth.uid() THEN
    BEGIN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (v_c.solicitante_id, 'Novo prazo no chamado #' || v_c.numero,
              left(v_c.assunto, 120) || ' — nova previsão de entrega: '
                || to_char(v_previsao AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || '.',
              'chamado_desenvolvimento', '/app/central-servicos/chamados/' || p_chamado_id || '/acompanhar');
    EXCEPTION WHEN others THEN
      RAISE WARNING 'chamado_definir_prazo (aviso %): %', p_chamado_id, SQLERRM;
    END;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_definir_prazo(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_definir_prazo(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_definir_prazo(uuid, int) TO authenticated;

-- ── 5. Iniciar desenvolvimento: agora com prazo em DIAS ──────────────────
-- A versão (uuid, timestamptz) da mig 20261028001400 alterava o prazo a
-- qualquer hora — sai. Esta exige o prazo em dias (já definido ou informado
-- agora) e grava a previsão = hoje + prazo em dias úteis.
DROP FUNCTION IF EXISTS public.chamado_iniciar_desenvolvimento(uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.chamado_iniciar_desenvolvimento(p_chamado_id uuid, p_prazo_dias int DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_c        public."CHAMADO_SISTEMA"%ROWTYPE;
  v_previsao timestamptz;
  v_prev_tx  text;
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

  -- Prazo obrigatório: o já definido (travado) ou o informado agora.
  IF v_c.prazo_dias IS NULL THEN
    IF p_prazo_dias IS NULL THEN
      RAISE EXCEPTION 'Informe o prazo em dias úteis para concluir o chamado antes de iniciar.';
    END IF;
    PERFORM public.chamado_definir_prazo(p_chamado_id, p_prazo_dias);
    SELECT * INTO v_c FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id;
  END IF;

  v_previsao := public.chamado_previsao_entrega(now(), v_c.prazo_dias);
  PERFORM set_config('app.chamado_inicio_dev', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET status                       = CASE WHEN status = 'aberto' THEN 'em_andamento' ELSE status END,
         desenvolvimento_iniciado_em  = now(),
         desenvolvimento_iniciado_por = auth.uid(),
         prazo_conclusao_em           = v_previsao,
         prazo_previsto               = (v_previsao AT TIME ZONE 'America/Sao_Paulo')::date
   WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_inicio_dev', 'off', true);

  v_prev_tx := to_char(v_previsao AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY');
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          format('Desenvolvimento iniciado — prazo de %s dia(s) útil(eis), previsão de entrega: %s', v_c.prazo_dias, v_prev_tx),
          jsonb_build_object('acao', 'desenvolvimento_iniciado', 'prazo_dias', v_c.prazo_dias, 'previsao', v_previsao));

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
REVOKE ALL ON FUNCTION public.chamado_iniciar_desenvolvimento(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_iniciar_desenvolvimento(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_iniciar_desenvolvimento(uuid, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.chamado_iniciar_desenvolvimento(uuid, int);
-- -- recriar chamado_iniciar_desenvolvimento(uuid, timestamptz) e
-- -- chamado_sistema_desenvolvimento() como na mig 20261028001400
-- DROP FUNCTION IF EXISTS public.chamado_definir_prazo(uuid, int);
-- DROP FUNCTION IF EXISTS public.chamado_previsao_entrega(timestamptz, int);
-- DROP FUNCTION IF EXISTS public.chamado_somar_dias_uteis(timestamptz, int);
-- DROP FUNCTION IF EXISTS public.chamado_feriado(date);
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS concluido_no_prazo,
--   DROP COLUMN IF EXISTS prazo_redefinicoes, DROP COLUMN IF EXISTS prazo_posicao_fila,
--   DROP COLUMN IF EXISTS prazo_definido_por, DROP COLUMN IF EXISTS prazo_definido_em,
--   DROP COLUMN IF EXISTS prazo_dias;
-- NOTIFY pgrst, 'reload schema';
