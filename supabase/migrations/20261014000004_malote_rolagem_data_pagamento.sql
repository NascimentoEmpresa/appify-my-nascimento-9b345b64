-- SIS-2026-0664: despesa pendente de aprovação no Nível 2 (ou acima) que passa do prazo do item 1.2
-- das Configurações do Malote tem a data de pagamento reagendada para o próximo dia útil.
--
-- PROBLEMA: desde o SIS-2026-0361 não dá para aprovar com data de pagamento anterior a hoje; o único
-- caminho era "Solicitar ajuste" (volta para o solicitante, que edita a data e reenvia). Com o
-- aprovador do N2 fora da empresa, as despesas pendentes envelheciam e travavam.
--
-- REGRA (rodada a cada 15 minutos por pg_cron; idempotente):
--   Candidata  = malote_despesa em 'pendente_aprovacao', não parcelada, não excluída, nível atual >=
--                _nivel_minimo (padrão 2; para incluir o N1 no futuro, agendar com 1) e
--                  - data_pagamento anterior a hoje, ou
--                  - data_pagamento = hoje e já passou do horário 1.2 (conferencia_aprovacao_horario).
--   Nova data  = primeiro dia NÃO bloqueado (fim de semana/feriado/dia bloqueado do Malote) a partir de
--                hoje, se ainda não passou do horário 1.2; a partir de amanhã, se já passou.
--   Exceções TAMBÉM são reagendadas (a marca de exceção continua na despesa); parceladas não.
--   Cada reagendamento grava um evento na linha do tempo da despesa (tipo 'edicao', sem ator: é o
--   sistema) e avisa o solicitante (ou os lançadores configurados) pela notificação do Malote.
--   Uma despesa que o banco recusar (trigger) é pulada, sem derrubar as demais.
--
-- Liga/desliga: malote_config.rolagem_data_pagamento_ativa (padrão LIGADA), em Malote → Configurações.
--
-- Migrations não se auto-aplicam: rodar no SQL Editor, na ordem dos blocos. Leve; sem ALTER em tabela
-- grande (só uma coluna com default em malote_config, de 1 linha).

-- BLOCO 1 ─ chave liga/desliga
ALTER TABLE public.malote_config
  ADD COLUMN IF NOT EXISTS rolagem_data_pagamento_ativa boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.malote_config.rolagem_data_pagamento_ativa IS
  'SIS-2026-0664: reagenda para o próximo dia útil a data de pagamento das despesas pendentes de aprovação (N2+) que passaram do prazo do item 1.2.';

-- BLOCO 2 ─ função da rolagem
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
       AND (d.data_pagamento < v_hoje OR (d.data_pagamento = v_hoje AND v_passou))
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

-- Só o agendador (postgres) e a service role chamam; usuário logado não.
REVOKE ALL ON FUNCTION public.malote_rolar_datas_pagamento(smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.malote_rolar_datas_pagamento(smallint) TO service_role;

-- BLOCO 3 ─ agendamento (a cada 15 min; o horário 1.2 é lido da configuração a cada rodada)
DO $$
BEGIN
  PERFORM cron.unschedule('malote-rolagem-data-pagamento');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'malote-rolagem-data-pagamento',
  '*/15 * * * *',
  $$ SELECT public.malote_rolar_datas_pagamento(2::smallint); $$
);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   SELECT cron.unschedule('malote-rolagem-data-pagamento');
--   DROP FUNCTION IF EXISTS public.malote_rolar_datas_pagamento(smallint);
--   ALTER TABLE public.malote_config DROP COLUMN IF EXISTS rolagem_data_pagamento_ativa;
--   NOTIFY pgrst, 'reload schema';
--   (as datas já reagendadas não voltam sozinhas; o histórico de cada despesa mostra a data anterior)
--
-- Para incluir o Nível 1 no futuro: reagendar com 1 em vez de 2:
--   SELECT cron.unschedule('malote-rolagem-data-pagamento');
--   SELECT cron.schedule('malote-rolagem-data-pagamento', '*/15 * * * *', $$ SELECT public.malote_rolar_datas_pagamento(1::smallint); $$);
