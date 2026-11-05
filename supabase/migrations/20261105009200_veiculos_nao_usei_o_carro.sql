-- =========================================================================
-- Central de Serviços › Agendamento de Veículos: "Não usei o carro no dia"
-- (05/11/2026).
--
-- Pedido do Pablo: "libera o pessoal pra fazer agendamento de veiculos, os
-- anteriores ao dia de hoje, alguns solicitaram agendamento e nem usaram o
-- carro aí precisam preencher pra usar de novo só que não tem como pq nem
-- usaram. Resolve isso e coloca um botão de > Não usei o carro no dia".
--
-- O que travava: a tela ainda segurava o passo 4 do Novo Agendamento enquanto
-- cs_veiculo_km_pendentes() devolvesse alguma viagem terminada e não
-- finalizada (a trava do BANCO já tinha saído na mig 286, a da tela não).
-- Quem reservou e não saiu com o carro não tinha KM nenhum para informar.
-- A tela deixa de travar no mesmo PR; esta migration dá o caminho certo para
-- fechar a pendência:
--   • colunas nao_utilizado_em / _por / _por_nome / _motivo — quem disse que
--     não usou e quando (fica no card e no histórico);
--   • cs_veiculo_nao_utilizado(agendamento, motivo): marca e FINALIZA
--     (finalizada_em), então a viagem sai de cs_veiculo_km_pendentes() e de
--     cs_veiculo_minhas_pendencias() sem mexer nelas. Só quem agendou ou quem
--     gerencia a frota (sup_patrimonio — mesmo gate do cs_veiculo_km_final).
--     Recusa agendamento futuro (o caminho é Cancelar), viagem já finalizada,
--     e viagem com KM final ou nota de abastecimento (aí o carro foi usado);
--   • cs_veic_checar_agendamento(): no UPDATE só revalida manutenção/conflito
--     quando veículo, datas, turno ou status mudam. Antes, qualquer UPDATE de
--     uma reserva confirmada repassava pela checagem de manutenção — marcar
--     "não usei" (ou finalizar o KM) de um carro que entrou em manutenção
--     depois da viagem dava "Veículo em manutenção" e não fechava nunca.
--
-- Idempotente.
-- =========================================================================

-- 1) Quem não usou o carro --------------------------------------------------
ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS nao_utilizado_em timestamptz;
ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS nao_utilizado_por uuid;
ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS nao_utilizado_por_nome text;
ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS nao_utilizado_motivo text;
COMMENT ON COLUMN public.cs_veiculo_agendamento.nao_utilizado_em IS
  'Botão "Não usei o carro no dia" (mig 20261105009200): a reserva passou e o carro não saiu. Também preenche finalizada_em.';

-- 2) Revalidar só o que mudou ----------------------------------------------
-- Cópia da 20260828000001 com o atalho do UPDATE no começo.
CREATE OR REPLACE FUNCTION public.cs_veic_checar_agendamento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_manut record;
  v_conf  record;
BEGIN
  IF NEW.status <> 'confirmado' THEN
    RETURN NEW;  -- cancelado/concluído não disputa o carro com ninguém
  END IF;

  -- UPDATE que não mexe em veículo, período, turno nem status (finalizar,
  -- KM, "não usei", destino...) não tem o que revalidar (05/11/2026).
  IF TG_OP = 'UPDATE'
     AND NEW.patrimonio_id IS NOT DISTINCT FROM OLD.patrimonio_id
     AND NEW.data_inicio   IS NOT DISTINCT FROM OLD.data_inicio
     AND NEW.data_fim      IS NOT DISTINCT FROM OLD.data_fim
     AND NEW.turno         IS NOT DISTINCT FROM OLD.turno
     AND NEW.status        IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Só na criação (ou quando a data muda): senão o gestor não conseguiria
  -- corrigir o destino de uma viagem que já começou.
  IF (TG_OP = 'INSERT' OR NEW.data_inicio IS DISTINCT FROM OLD.data_inicio)
     AND NEW.data_inicio < CURRENT_DATE THEN
    RAISE EXCEPTION 'Não dá para agendar um veículo para uma data que já passou.';
  END IF;

  SELECT ativo, em_manutencao, data_previsao_fim INTO v_manut
    FROM public.sup_patrimonio
   WHERE id = NEW.patrimonio_id AND categoria = 'veiculo';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Veículo não encontrado no cadastro de Patrimônio.';
  END IF;
  IF NOT v_manut.ativo THEN
    RAISE EXCEPTION 'Veículo inativo no cadastro de Patrimônio.';
  END IF;
  IF v_manut.em_manutencao
     AND (v_manut.data_previsao_fim IS NULL OR NEW.data_inicio <= v_manut.data_previsao_fim) THEN
    RAISE EXCEPTION 'Veículo em manutenção: %',
      coalesce('previsão de retorno em ' || to_char(v_manut.data_previsao_fim, 'DD/MM/YYYY'),
               'retorno por tempo indeterminado');
  END IF;

  SELECT a.numero, a.data_inicio, a.data_fim INTO v_conf
    FROM public.cs_veiculo_agendamento a
   WHERE a.patrimonio_id = NEW.patrimonio_id
     AND a.id <> NEW.id
     AND a.status = 'confirmado'
     AND a.data_inicio <= NEW.data_fim
     AND a.data_fim    >= NEW.data_inicio
     AND (a.turno = 'dia_todo' OR NEW.turno = 'dia_todo' OR a.turno = NEW.turno)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Veículo já reservado nesse período (reserva nº %, de % a %).',
      v_conf.numero, to_char(v_conf.data_inicio, 'DD/MM/YYYY'), to_char(v_conf.data_fim, 'DD/MM/YYYY');
  END IF;

  RETURN NEW;
END $$;

-- 3) "Não usei o carro no dia" -----------------------------------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_nao_utilizado(p_agendamento uuid, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  a record;
  v_nome text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou quem gerencia a frota) pode marcar que o carro não foi usado.';
  END IF;
  IF a.status <> 'confirmado' THEN
    RAISE EXCEPTION 'Este agendamento está %.', a.status;
  END IF;
  IF a.data_inicio > v_hoje THEN
    RAISE EXCEPTION 'O agendamento ainda não chegou — se não vai usar o carro, use Cancelar.';
  END IF;
  IF a.nao_utilizado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Já está marcado que o carro não foi usado.';
  END IF;
  IF a.finalizada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Esta viagem já foi finalizada.';
  END IF;
  IF a.km_final IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.cs_veiculo_abastecimento b WHERE b.agendamento_id = a.id) THEN
    RAISE EXCEPTION 'Esta viagem tem KM final ou nota de abastecimento — use Finalizar viagem.';
  END IF;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();

  UPDATE public.cs_veiculo_agendamento
     SET nao_utilizado_em       = now(),
         nao_utilizado_por      = auth.uid(),
         nao_utilizado_por_nome = v_nome,
         nao_utilizado_motivo   = v_motivo,
         finalizada_em          = now(),
         updated_at             = now()
   WHERE id = p_agendamento;

  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'nao_utilizado',
          concat_ws(' · ', 'Não usou o carro no dia', v_motivo),
          auth.uid(), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_nao_utilizado(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_nao_utilizado(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.cs_veiculo_nao_utilizado(uuid, text);
-- Reaplicar o bloco de cs_veic_checar_agendamento() da 20260828000001 (sem o atalho do UPDATE).
-- ALTER TABLE public.cs_veiculo_agendamento
--   DROP COLUMN IF EXISTS nao_utilizado_em, DROP COLUMN IF EXISTS nao_utilizado_por,
--   DROP COLUMN IF EXISTS nao_utilizado_por_nome, DROP COLUMN IF EXISTS nao_utilizado_motivo;
-- (as viagens marcadas continuam com finalizada_em — é o que tira das pendências.)
-- NOTIFY pgrst, 'reload schema';
