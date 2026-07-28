-- pessoa_tem_conflito_horario() já bloqueia reunião/convite quando alguém
-- tem a agenda bloqueada (20260719000001), mas a mensagem de erro sempre
-- dizia "já está em outra reunião" mesmo quando o motivo real era um
-- bloqueio de agenda pessoal — confuso pra quem tenta agendar. Os
-- triggers passam a checar pessoa_tem_bloqueio_agenda separadamente pra
-- dar uma mensagem específica nesse caso.

CREATE OR REPLACE FUNCTION public.checar_conflito_horario_reuniao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_convidado_em_conflito uuid;
BEGIN
  IF NEW.etapa = 'cancelada' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.data_hora = OLD.data_hora
     AND NEW.duracao_minutos = OLD.duracao_minutos
     AND NEW.responsavel_preenchimento_user_id = OLD.responsavel_preenchimento_user_id
     AND NEW.organizador_user_id = OLD.organizador_user_id THEN
    RETURN NEW;
  END IF;

  IF public.pessoa_tem_bloqueio_agenda(NEW.criado_por, NEW.data_hora, NEW.duracao_minutos) THEN
    RAISE EXCEPTION 'O criador desta reunião está com a agenda bloqueada nesse horário.';
  END IF;
  IF public.pessoa_tem_conflito_horario(NEW.criado_por, NEW.data_hora, NEW.duracao_minutos, NEW.id) THEN
    RAISE EXCEPTION 'O criador desta reunião já está em outra reunião no mesmo horário.';
  END IF;

  IF public.pessoa_tem_bloqueio_agenda(NEW.organizador_user_id, NEW.data_hora, NEW.duracao_minutos) THEN
    RAISE EXCEPTION 'O organizador está com a agenda bloqueada nesse horário.';
  END IF;
  IF public.pessoa_tem_conflito_horario(NEW.organizador_user_id, NEW.data_hora, NEW.duracao_minutos, NEW.id) THEN
    RAISE EXCEPTION 'O organizador já está em outra reunião no mesmo horário.';
  END IF;

  IF public.pessoa_tem_bloqueio_agenda(NEW.responsavel_preenchimento_user_id, NEW.data_hora, NEW.duracao_minutos) THEN
    RAISE EXCEPTION 'O responsável pelo preenchimento está com a agenda bloqueada nesse horário.';
  END IF;
  IF public.pessoa_tem_conflito_horario(NEW.responsavel_preenchimento_user_id, NEW.data_hora, NEW.duracao_minutos, NEW.id) THEN
    RAISE EXCEPTION 'O responsável pelo preenchimento já está em outra reunião no mesmo horário.';
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.data_hora <> OLD.data_hora OR NEW.duracao_minutos <> OLD.duracao_minutos) THEN
    SELECT c.user_id INTO v_convidado_em_conflito
      FROM public.reuniao_convidado c
     WHERE c.reuniao_id = NEW.id
       AND public.pessoa_tem_conflito_horario(c.user_id, NEW.data_hora, NEW.duracao_minutos, NEW.id)
     LIMIT 1;
    IF v_convidado_em_conflito IS NOT NULL THEN
      RAISE EXCEPTION 'Um dos convidados ou observadores já está em outra reunião (ou com a agenda bloqueada) no novo horário.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.checar_conflito_convidado()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_data_hora timestamptz;
  v_duracao   int;
  v_etapa     text;
BEGIN
  SELECT data_hora, duracao_minutos, etapa INTO v_data_hora, v_duracao, v_etapa
    FROM public.reuniao WHERE id = NEW.reuniao_id;

  IF v_etapa = 'cancelada' THEN
    RETURN NEW;
  END IF;

  IF public.pessoa_tem_bloqueio_agenda(NEW.user_id, v_data_hora, v_duracao) THEN
    RAISE EXCEPTION 'Este participante está com a agenda bloqueada nesse horário.';
  END IF;

  IF public.pessoa_tem_conflito_horario(NEW.user_id, v_data_hora, v_duracao, NEW.reuniao_id) THEN
    RAISE EXCEPTION 'Este participante já está em outra reunião no mesmo horário.';
  END IF;

  RETURN NEW;
END;
$$;
