-- Observador (papel = 'observador' em reuniao_convidado) passa a ficar de
-- fora da checagem de conflito de horário e bloqueio de agenda — é um papel
-- opcional/informativo por natureza, então a mesma pessoa pode ser
-- observadora em quantas reuniões quiserem ao mesmo tempo. Convidado
-- (participação obrigatória), organizador e responsável continuam com a
-- checagem cheia, sem mudança nenhuma.
--
-- Motivo: com o observador automático (reuniao_observador_automatico), a
-- mesma pessoa passou a ser adicionada como observadora em várias reuniões
-- de Comitê/Gerencial/Diretoria — quando duas dessas reuniões se sobrepõem
-- no horário, a checagem de conflito bloqueava a criação da segunda inteira
-- (o INSERT em reuniao_convidado disparado pelo trigger de observador
-- automático levantava exceção e cancelava a transação toda).

CREATE OR REPLACE FUNCTION public.checar_conflito_convidado()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_data_hora timestamptz;
  v_duracao   int;
  v_etapa     text;
BEGIN
  IF NEW.papel = 'observador' THEN
    RETURN NEW;
  END IF;

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
$function$;

-- Mesma isenção no reagendamento: ao mudar data/hora de uma reunião já
-- existente, a checagem que varre os convidados só considera quem não é
-- observador.
CREATE OR REPLACE FUNCTION public.checar_conflito_horario_reuniao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
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
       AND c.papel <> 'observador'
       AND public.pessoa_tem_conflito_horario(c.user_id, NEW.data_hora, NEW.duracao_minutos, NEW.id)
     LIMIT 1;
    IF v_convidado_em_conflito IS NOT NULL THEN
      RAISE EXCEPTION 'Um dos convidados já está em outra reunião (ou com a agenda bloqueada) no novo horário.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;