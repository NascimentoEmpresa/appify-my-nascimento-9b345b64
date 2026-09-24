-- =========================================================================
-- Central de Serviços › Veículos: coluna controle_km + backfill, com os
-- gatilhos da tabela desligados. APLICAR ANTES DA 20260930000219.
--
-- A 20260930000219 falhou ao ser aplicada (23/09/2026): o backfill
--   UPDATE cs_veiculo_agendamento SET controle_km = false WHERE km_inicial IS NULL
-- dispara os gatilhos de UPDATE da tabela, e o trg_cs_veic_checar recusou
-- uma viagem antiga de um carro hoje em manutenção ("Veículo em manutenção:
-- previsão de retorno em 20/09/2026"). O backfill só preenche uma coluna
-- nova — não é agendamento sendo mexido — então nenhum gatilho de regra
-- (checar disponibilidade, solicitante, log, updated_at) deve rodar nele.
--
-- A 219 já está na main (R4: não se edita). Esta aqui faz a parte que
-- falhou; com a coluna já criada, o bloco DO da 219 pula o backfill e o
-- resto dela (funções) aplica normalmente. Ordem: 223, depois 219.
--
-- DISABLE TRIGGER USER não desliga os gatilhos internos de FK. Tudo na
-- mesma transação: se algo falhar, os gatilhos voltam ligados.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'cs_veiculo_agendamento'
                    AND column_name = 'controle_km') THEN
    ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN controle_km boolean NOT NULL DEFAULT true;
    ALTER TABLE public.cs_veiculo_agendamento DISABLE TRIGGER USER;
    UPDATE public.cs_veiculo_agendamento SET controle_km = false WHERE km_inicial IS NULL;
    ALTER TABLE public.cs_veiculo_agendamento ENABLE TRIGGER USER;
  END IF;
END $$;

COMMENT ON COLUMN public.cs_veiculo_agendamento.controle_km IS
  'false = viagem anterior ao controle de KM (legado): fechar é opcional e não trava agendamento. true = KM final + foto obrigatórios para fechar.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public.cs_veiculo_agendamento DROP COLUMN IF EXISTS controle_km;
-- NOTIFY pgrst, 'reload schema';
