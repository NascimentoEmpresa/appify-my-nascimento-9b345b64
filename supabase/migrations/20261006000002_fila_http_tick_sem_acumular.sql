-- ===========================================================================
--  Tick não acumula na fila
-- ===========================================================================
--  O DEFEITO, OBSERVADO EM PRODUÇÃO
--
--  A fila de 20261006000001 trocou `net.http_post` por um INSERT. Funcionou —
--  mas introduziu um problema que o pg_net não tinha, e que apareceu na
--  primeira meia hora:
--
--      id  destino                 criado_em
--       1  whatsapp-retomada-tick  2026-10-06 00:30:00
--       2  whatsapp-retomada-tick  2026-10-06 00:35:00
--       3  whatsapp-retomada-tick  2026-10-06 00:40:00
--       4  whatsapp-retomada-tick  2026-10-06 00:45:00
--
--  Tick de 5 em 5 minutos, empilhando. Com o worker parado, a fila cresce
--  ~288 linhas por dia por tick; ao subir, ele dispararia TODAS, uma por uma.
--  Com `net.http_post` a chamada era simplesmente perdida - ruim por outro
--  motivo, mas não empilhava.
--
--  A DISTINÇÃO QUE FALTAVA
--
--  Evento de gatilho e tick periódico não são a mesma coisa:
--
--    - "a denúncia X chegou" é ÚNICO. Perder é perder informação, e duas
--      entregas são dois avisos. Cada um tem de ser entregue.
--    - "passaram-se 5 minutos, veja se há algo a fazer" é REPETIDO e sem
--      estado. Dez ticks represados fazem exatamente o mesmo que um, e o
--      próximo vem em 5 minutos de qualquer forma. Só o mais recente importa.
--
--  Então o tick ganha função própria, que não enfileira de novo se já existe
--  um pendente para o mesmo destino - apenas atualiza a hora. O gatilho segue
--  usando `enfileirar_http`, sem dedupe, porque lá cada evento conta.
--
--  POR QUE FUNÇÃO NOVA E NÃO UM PARÂMETRO
--  Porque acrescentar parâmetro com valor padrão a `enfileirar_http` criaria
--  uma SOBRECARGA: as chamadas de dois argumentos continuariam indo para a
--  versão antiga, e teríamos duas funções parecidas com comportamento
--  diferente. Nome diferente diz o que faz.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.enfileirar_tick(_destino text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF coalesce(_destino, '') = '' THEN
    RAISE EXCEPTION 'enfileirar_tick: destino vazio';
  END IF;

  -- Já existe um tick esperando entrega para este destino? Então só adianta o
  -- relógio dele. FOR UPDATE SKIP LOCKED porque o worker pode estar lendo a
  -- mesma linha neste instante: sem isto, o cron esperaria o worker terminar.
  SELECT id INTO v_id
    FROM public.fila_http
   WHERE destino = _destino
     AND processado_em IS NULL
   ORDER BY id
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_id IS NOT NULL THEN
    UPDATE public.fila_http
       SET corpo = jsonb_build_object('tick_at', now())
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.fila_http (destino, corpo)
  VALUES (_destino, jsonb_build_object('tick_at', now()))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.enfileirar_tick(text) FROM PUBLIC, anon, authenticated;

-- ── Os cinco agendamentos passam a usar o tick com dedupe ─────────────────
-- Mesmos nomes e horários; só a função chamada muda.
DO $$
DECLARE
  v_agenda text[][] := ARRAY[
    ['sla-escalonamento-tick',      '0 * * * *',    'sla-escalonamento-tick'],
    ['regua-cobranca-tick',         '0 * * * *',    'regua-cobranca-tick'],
    ['plano-acao-marcar-atrasadas', '0 6 * * *',    'plano-acao-marcar-atrasadas'],
    ['whatsapp-retomada-tick',      '*/5 * * * *',  'whatsapp-retomada-tick'],
    ['comite-etica-alertas',        '0 8 * * 1-5',  'comite-etica-alertas-tick']
  ];
  v_i int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente - nenhum agendamento alterado (esperado na replica)';
    RETURN;
  END IF;

  FOR v_i IN 1 .. array_length(v_agenda, 1) LOOP
    BEGIN
      PERFORM cron.unschedule(v_agenda[v_i][1]);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'agendamento % nao existia', v_agenda[v_i][1];
    END;

    PERFORM cron.schedule(
      v_agenda[v_i][1],
      v_agenda[v_i][2],
      format($cmd$SELECT public.enfileirar_tick(%L)$cmd$, v_agenda[v_i][3])
    );
  END LOOP;
END $$;

-- ── Conferência ───────────────────────────────────────────────────────────
-- Nenhum destino deve ter mais de um pendente:
--   SELECT destino, count(*) FROM public.fila_http
--    WHERE processado_em IS NULL GROUP BY destino HAVING count(*) > 1;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- ROLLBACK
--   -- Volta os agendamentos para enfileirar_http (acumula de novo):
--   --   reaplicar o bloco DO de 20261006000001_fila_http_substitui_pg_net.sql
--   DROP FUNCTION IF EXISTS public.enfileirar_tick(text);
-- ===========================================================================
