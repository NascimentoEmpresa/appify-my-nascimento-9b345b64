-- =====================================================================
-- Agendamento de Veículos: CONCLUIR o agendamento (10/11/2026).
--
-- Reclamação da Frota (Pablo, 10/11/2026): "o pessoal NÃO TÁ CONSEGUINDO
-- CONCLUIR o agendamento de veículo, aqui não aparece NADA pra concluir".
-- Exemplo: viagem do JOEL DOS SANTOS (agendada 06/11, KM inicial 64844 e
-- final 65042 com foto, duas notas de abastecimento) — tudo preenchido e o
-- card continuava "confirmado" para sempre.
--
-- Causa: o status 'concluido' existe desde a 20260828000001 (CHECK do
-- status, rótulo "Concluído" no histórico), mas NENHUMA função nem tela
-- jamais o gravava. Fechar a viagem (cs_veiculo_km_final) só carimba
-- finalizada_em; o agendamento ficava 'confirmado', segurando o carro no
-- calendário/StatusRapido e sem nenhum botão para encerrar. Não é permissão:
-- o caminho simplesmente não existia.
--
-- O que esta migration faz:
--   1) cs_veiculo_concluir(p_agendamento): quem agendou (ou quem gerencia a
--      frota — sup_patrimonio, mesma régua de cs_veiculo_km_final) passa o
--      agendamento de 'confirmado' para 'concluido' depois de a viagem estar
--      finalizada (KM final registrado ou "Não usei o carro"). O histórico
--      ganha a linha "Concluído" pelo trg_cs_veic_log (mudança de status) —
--      por isso a função não insere log próprio.
--   2) Concluir NÃO pode apagar a cobrança do checklist (regra do Pablo:
--      nada bloqueia, mas quem não preencheu continua sendo cobrado). As
--      duas varreduras que filtravam status = 'confirmado' passam a aceitar
--      qualquer status menos 'cancelado' — mesma régua de
--      cs_veic_checklist_pendencias(), que já era assim:
--        • cs_veic_checklist_ao_agendar (texto "FULANO NÃO PREENCHEU…");
--        • cs_veiculo_checklist_lembretes (sino, pg_cron).
--      Os corpos abaixo são cópia fiel da 20261105009300 com só essa troca.
-- =====================================================================

-- 1) Concluir -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_concluir(p_agendamento uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou quem gerencia a frota) conclui este agendamento.';
  END IF;
  IF a.status = 'concluido' THEN RAISE EXCEPTION 'Este agendamento já está concluído.'; END IF;
  IF a.status <> 'confirmado' THEN RAISE EXCEPTION 'Este agendamento está %.', a.status; END IF;
  IF a.finalizada_em IS NULL THEN
    RAISE EXCEPTION 'Finalize a viagem (registre o KM final) antes de concluir o agendamento.';
  END IF;

  UPDATE public.cs_veiculo_agendamento
     SET status = 'concluido', updated_at = now()
   WHERE id = p_agendamento;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_concluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_concluir(uuid) TO authenticated;

-- 2a) Ao agendar: concluído sem checklist também aparece no texto -------------
CREATE OR REPLACE FUNCTION public.cs_veic_checklist_ao_agendar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r       record;
  v_nome  text;
  v_quem  text;
  v_linha text;
  v_textos text[] := '{}';
BEGIN
  -- Fallback da provável chegada (a tela exige; o que chegar sem ela —
  -- carga, front antigo em cache — ganha o fim do turno do retorno).
  IF NEW.chegada_prevista IS NULL THEN
    NEW.chegada_prevista := (NEW.data_fim + make_time(CASE NEW.turno WHEN 'manha' THEN 12 ELSE 18 END, 0, 0)) AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  IF NEW.status <> 'confirmado' OR NOT NEW.checklist_exigido THEN
    RETURN NEW;
  END IF;

  -- Daqui para baixo é só registro: se algo falhar, o agendamento vale.
  BEGIN
    v_nome := coalesce(nullif(btrim(NEW.solicitante_nome), ''),
                       (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = NEW.solicitante_id));
    v_quem := upper(coalesce(nullif(btrim(v_nome), ''), 'USUÁRIO SEM NOME'));

    FOR r IN
      SELECT a.id, a.numero, p.saida, p.chegada
        FROM public.cs_veiculo_agendamento a
        CROSS JOIN LATERAL public.cs_veic_checklist_pendencias(a.id) p
       WHERE a.solicitante_id = NEW.solicitante_id
         AND a.id <> NEW.id
         AND a.status <> 'cancelado'  -- concluído também cobra (20261110003700)
         AND a.checklist_exigido
         AND (p.saida OR p.chegada)
       ORDER BY a.data_inicio, a.numero
    LOOP
      v_linha := v_quem || ' NÃO PREENCHEU ' || public.cs_veic_checklist_o_que_falta(r.saida, r.chegada)
                 || ' do agendamento nº ' || r.numero || ' (' || public.cs_veic_checklist_veiculo_e_data(r.id) || ')';
      v_textos := v_textos || v_linha;

      -- No histórico do agendamento NOVO…
      INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
      VALUES (NEW.id, 'checklist_pendente', v_linha, NEW.solicitante_id, v_nome);
      -- …e no do anterior, para quem abrir aquele.
      INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
      VALUES (r.id, 'checklist_pendente',
              v_linha || ' — agendou outro veículo (' || NEW.veiculo_nome || ', ' || to_char(NEW.data_inicio, 'DD/MM/YYYY') || ') sem preencher',
              NEW.solicitante_id, v_nome);

      IF r.saida   THEN PERFORM public.cs_veic_checklist_avisar(r.id, 'saida');   END IF;
      IF r.chegada THEN PERFORM public.cs_veic_checklist_avisar(r.id, 'chegada'); END IF;
    END LOOP;

    IF cardinality(v_textos) > 0 THEN
      NEW.checklist_pendente_ao_agendar := array_to_string(v_textos, E'\n');
    END IF;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'cs_veic_checklist_ao_agendar: % (agendamento segue)', SQLERRM;
  END;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veic_checklist_ao_agendar() FROM PUBLIC, anon;

-- 2b) Lembretes no sino: concluído sem checklist continua sendo lembrado -----
CREATE OR REPLACE FUNCTION public.cs_veiculo_checklist_lembretes()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT a.id, p.saida, p.chegada
      FROM public.cs_veiculo_agendamento a
      CROSS JOIN LATERAL public.cs_veic_checklist_pendencias(a.id) p
     WHERE a.status <> 'cancelado'  -- concluído também cobra (20261110003700)
       AND a.checklist_exigido
       -- Janela: lembrete de viagem de dois meses atrás já não ajuda ninguém.
       AND a.data_inicio >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 60
       AND a.data_inicio <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
       AND (p.saida OR p.chegada)
  LOOP
    IF r.saida   AND public.cs_veic_checklist_avisar(r.id, 'saida')   THEN n := n + 1; END IF;
    IF r.chegada AND public.cs_veic_checklist_avisar(r.id, 'chegada') THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_checklist_lembretes() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar os blocos 5) (cs_veic_checklist_ao_agendar) e 8)
-- (cs_veiculo_checklist_lembretes) da 20261105009300; depois:
-- UPDATE public.cs_veiculo_agendamento SET status = 'confirmado' WHERE status = 'concluido';
-- DROP FUNCTION IF EXISTS public.cs_veiculo_concluir(uuid);
-- NOTIFY pgrst, 'reload schema';
