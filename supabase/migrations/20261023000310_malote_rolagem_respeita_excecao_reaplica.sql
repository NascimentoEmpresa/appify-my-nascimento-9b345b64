-- [SEM-CHAMADO] Rolagem de data (SIS-2026-0664): REAPLICA a regra "despesa com exceção mantém o dia" e a estende à chave de aprovação do N1.
--
-- DM-2026-3201 (exceção EXC-2026-0021, pagamento em 23/10): foi reagendada para 26/10 às 13:45, 14:00 e 15:00 do próprio dia 23/10, com o
-- texto "Despesa marcada como exceção: a marca foi mantida". A despesa TEM excecao = true, e a função que está no banco é a ANTIGA
-- (20261014000004): a 20261015000012, que poupa a exceção da rolagem, nunca foi aplicada no cluster (a consulta de diagnóstico devolveu
-- pg_get_functiondef sem o trecho da regra). Esta migration traz a função completa, com:
--   1. a regra da 20261015000012: excecao = true NÃO é reagendada no dia da data de pagamento, mesmo depois do horário 1.2;
--   2. um complemento: a despesa com uma solicitação de exceção 'utilizada' apontando para ela (despesa_id) também é poupada. É o caso da
--      chave de aprovação do N1 (20261021000020 / 20261022000290), que só marca a solicitação e não marca malote_despesa.excecao.
-- Data já passada continua sendo reagendada (a aprovação seria barrada pela regra de data passada).
-- Não marca excecao = true na despesa (isso mudaria selos, filtros e relatórios de exceção).
--
-- Só recria a função; o agendamento não muda. Migration leve: pode rodar inteira no pgAdmin.
--
-- ROLLBACK: reaplicar a 20261014000004_malote_rolagem_data_pagamento.sql (BLOCO 2).

CREATE OR REPLACE FUNCTION public.malote_rolar_datas_pagamento(_nivel_minimo smallint DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agora      timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_hoje       date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_horario    time;
  v_ativa      boolean;
  v_passou     boolean;
  v_base       date;
  v_nova       date;
  v_guarda     int;
  r            record;
  v_destinos   uuid[];
  v_lancadores uuid[];
  v_total      int := 0;
BEGIN
  SELECT conferencia_aprovacao_horario, rolagem_data_pagamento_ativa
    INTO v_horario, v_ativa
    FROM public.malote_config WHERE id = true;

  IF NOT COALESCE(v_ativa, false) OR v_horario IS NULL THEN
    RETURN 0;
  END IF;

  v_passou := v_agora::time > v_horario;
  v_base := CASE WHEN v_passou THEN v_hoje + 1 ELSE v_hoje END;

  FOR r IN
    SELECT d.id, d.numero, d.empresa_id, d.classificacao_id, d.created_by, d.excecao,
           d.data_pagamento, d.nivel_aprovacao_atual
      FROM public.malote_despesa d
     WHERE d.status = 'pendente_aprovacao'
       AND d.deleted_at IS NULL
       AND NOT d.parcelado
       AND d.data_pagamento IS NOT NULL
       AND COALESCE(d.nivel_aprovacao_atual, 1) >= _nivel_minimo
       AND (d.data_pagamento < v_hoje
            -- exceção (marcada na despesa OU chave de aprovação do N1 utilizada nela) mantém o dia, mesmo depois do horário 1.2
            OR (d.data_pagamento = v_hoje AND v_passou
                AND NOT COALESCE(d.excecao, false)
                AND NOT EXISTS (
                  SELECT 1 FROM public.malote_excecao_solicitacao s
                   WHERE s.despesa_id = d.id AND s.status = 'utilizada'
                )))
     ORDER BY d.data_pagamento, d.numero
       FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Primeiro dia útil a partir da base (trava de segurança de 60 dias contra calendário todo bloqueado).
      v_nova := v_base;
      v_guarda := 0;
      WHILE public.malote_dia_esta_bloqueado(v_nova, r.classificacao_id) AND v_guarda < 60 LOOP
        v_nova := v_nova + 1;
        v_guarda := v_guarda + 1;
      END LOOP;

      IF v_nova <= r.data_pagamento THEN
        CONTINUE; -- nada a reagendar (não deveria ocorrer; protege contra voltar no tempo)
      END IF;

      UPDATE public.malote_despesa SET data_pagamento = v_nova WHERE id = r.id;

      INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, nivel, ator_user_id, descricao)
      VALUES (
        r.id, 'edicao', r.nivel_aprovacao_atual::smallint, NULL,
        format('Data de pagamento reagendada automaticamente de %s para %s: a despesa seguia pendente de aprovação do Nível %s depois do prazo (item 1.2, %s).%s',
               to_char(r.data_pagamento, 'DD/MM/YYYY'), to_char(v_nova, 'DD/MM/YYYY'),
               COALESCE(r.nivel_aprovacao_atual, 1), to_char(v_horario, 'HH24:MI'),
               CASE WHEN r.excecao THEN ' Despesa marcada como exceção: a marca foi mantida.' ELSE '' END)
      );

      SELECT ARRAY(SELECT public.malote_lancadores_despesa(r.id)) INTO v_lancadores;
      v_destinos := CASE WHEN COALESCE(array_length(v_lancadores, 1), 0) > 0 THEN v_lancadores ELSE ARRAY[r.created_by] END;

      PERFORM public.malote_notificar_usuarios(
        v_destinos, r.empresa_id,
        CASE WHEN r.excecao THEN 'Exceção reagendada' ELSE 'Data de pagamento reagendada' END,
        format('A despesa %s ficou pendente de aprovação (N%s) além do prazo e o pagamento foi reagendado de %s para %s.',
               r.numero, COALESCE(r.nivel_aprovacao_atual, 1),
               to_char(r.data_pagamento, 'DD/MM/YYYY'), to_char(v_nova, 'DD/MM/YYYY')),
        'malote_status', '/app/malote/despesa/' || r.id::text
      );

      v_total := v_total + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'malote_rolar_datas_pagamento: despesa % não reagendada: %', r.numero, SQLERRM;
    END;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_rolar_datas_pagamento(smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.malote_rolar_datas_pagamento(smallint) TO service_role;

NOTIFY pgrst, 'reload schema';
