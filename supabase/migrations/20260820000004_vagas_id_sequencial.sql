-- =====================================================================
-- RECRUTAMENTO — renumerar o id das vagas para 1..N sem buracos
--
-- A PK ja existia (SISTEMA_RECRUTAMENTO_pkey em id, bigint identity). O
-- problema era estetico: vaga apagada nao devolve o numero para a sequencia,
-- entao a lista mostrava #1 #2 #3 #4 #8 com 5 vagas. Aqui o id vira denso e
-- a sequencia continua de N+1 em diante.
--
-- Nao ha ON UPDATE CASCADE nas 4 FKs que apontam para ca, e o id e GENERATED
-- ALWAYS (UPDATE direto e recusado). Por isso a ordem: soltar as FKs, tirar a
-- identidade, renumerar pai e filhos, devolver identidade e FKs.
--
-- O deslocamento intermediario (+OFFSET) existe porque a renumeracao comprime
-- para baixo: sem ele, um id descendo para um valor ainda ocupado violaria a
-- PK no meio do UPDATE (a unicidade e checada linha a linha).
--
-- NAO toca em sistema_solicitacao_* (minusculo): apesar do nome da coluna,
-- aquele solicitacao_id e de outro modulo e nao aponta para vagas.
--
-- Nenhum link publico usa o id da vaga (/candidatura redireciona para /vagas,
-- que lista do banco), entao renumerar nao quebra link ja divulgado.
--
-- Idempotente: rodar de novo com os ids ja densos nao muda nada.
-- ROLLBACK: nao ha volta automatica — os ids antigos se perdem. O backup
-- esta na tabela temporaria abaixo apenas durante a transacao; se precisar
-- reverter, restaure de um point-in-time do banco.
-- =====================================================================

BEGIN;

-- Mapa old -> new. row_number pela ordem do id preserva a ordem de criacao:
-- a vaga mais antiga continua sendo a de menor numero.
CREATE TEMP TABLE _mapa_vaga ON COMMIT DROP AS
SELECT id AS old_id, row_number() OVER (ORDER BY id) AS new_id
  FROM public."SISTEMA_RECRUTAMENTO";

DO $$
DECLARE
  v_offset bigint := 1000000;
  v_max    bigint;
BEGIN
  -- Nada a fazer se ja esta denso — deixa a migration repetivel.
  IF NOT EXISTS (SELECT 1 FROM _mapa_vaga WHERE old_id <> new_id) THEN
    RAISE NOTICE 'ids ja sequenciais, nada a renumerar';
  ELSE
    -- Offset alto o bastante para nao colidir com id existente.
    SELECT COALESCE(MAX(old_id), 0) + 1000000 INTO v_offset FROM _mapa_vaga;

    ALTER TABLE public."SISTEMA_RECRUTAMENTO_STATUS_LOG" DROP CONSTRAINT "SISTEMA_RECRUTAMENTO_STATUS_LOG_solicitacao_id_fkey";
    ALTER TABLE public."WA_MENSAGENS_RECRUTAMENTO"       DROP CONSTRAINT "WA_MENSAGENS_RECRUTAMENTO_solicitacao_id_fkey";
    ALTER TABLE public."WA_CURRICULOS"                   DROP CONSTRAINT "WA_CURRICULOS_vaga_id_fkey";
    ALTER TABLE public."RECRUTAMENTO_HISTORICO"          DROP CONSTRAINT "RECRUTAMENTO_HISTORICO_solicitacao_id_fkey";

    -- GENERATED ALWAYS recusa UPDATE na coluna; a identidade volta no fim.
    ALTER TABLE public."SISTEMA_RECRUTAMENTO" ALTER COLUMN id DROP IDENTITY;

    -- Fase A: tira todo mundo da faixa final.
    UPDATE public."SISTEMA_RECRUTAMENTO"            SET id             = id + v_offset;
    UPDATE public."SISTEMA_RECRUTAMENTO_STATUS_LOG" SET solicitacao_id = solicitacao_id + v_offset WHERE solicitacao_id IS NOT NULL;
    UPDATE public."WA_MENSAGENS_RECRUTAMENTO"       SET solicitacao_id = solicitacao_id + v_offset WHERE solicitacao_id IS NOT NULL;
    UPDATE public."WA_CURRICULOS"                   SET vaga_id        = vaga_id        + v_offset WHERE vaga_id        IS NOT NULL;
    UPDATE public."RECRUTAMENTO_HISTORICO"          SET solicitacao_id = solicitacao_id + v_offset WHERE solicitacao_id IS NOT NULL;

    -- Fase B: aterrissa nos numeros densos.
    UPDATE public."SISTEMA_RECRUTAMENTO" t
       SET id = m.new_id FROM _mapa_vaga m WHERE t.id = m.old_id + v_offset;
    UPDATE public."SISTEMA_RECRUTAMENTO_STATUS_LOG" t
       SET solicitacao_id = m.new_id FROM _mapa_vaga m WHERE t.solicitacao_id = m.old_id + v_offset;
    UPDATE public."WA_MENSAGENS_RECRUTAMENTO" t
       SET solicitacao_id = m.new_id FROM _mapa_vaga m WHERE t.solicitacao_id = m.old_id + v_offset;
    UPDATE public."WA_CURRICULOS" t
       SET vaga_id = m.new_id FROM _mapa_vaga m WHERE t.vaga_id = m.old_id + v_offset;
    UPDATE public."RECRUTAMENTO_HISTORICO" t
       SET solicitacao_id = m.new_id FROM _mapa_vaga m WHERE t.solicitacao_id = m.old_id + v_offset;

    -- Sobrou alguem na faixa deslocada = filho apontando para vaga inexistente
    -- (orfao que a FK nao pegou). Aborta em vez de deixar lixo apontando pro nada.
    IF EXISTS (SELECT 1 FROM public."WA_CURRICULOS"                   WHERE vaga_id        > v_offset)
    OR EXISTS (SELECT 1 FROM public."RECRUTAMENTO_HISTORICO"          WHERE solicitacao_id > v_offset)
    OR EXISTS (SELECT 1 FROM public."WA_MENSAGENS_RECRUTAMENTO"       WHERE solicitacao_id > v_offset)
    OR EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO_STATUS_LOG" WHERE solicitacao_id > v_offset) THEN
      RAISE EXCEPTION 'ha registro filho apontando para vaga inexistente; renumeracao abortada';
    END IF;

    SELECT COALESCE(MAX(id), 0) + 1 INTO v_max FROM public."SISTEMA_RECRUTAMENTO";
    EXECUTE format(
      'ALTER TABLE public."SISTEMA_RECRUTAMENTO" ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (RESTART WITH %s)', v_max);

    ALTER TABLE public."SISTEMA_RECRUTAMENTO_STATUS_LOG"
      ADD CONSTRAINT "SISTEMA_RECRUTAMENTO_STATUS_LOG_solicitacao_id_fkey"
      FOREIGN KEY (solicitacao_id) REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE CASCADE;
    ALTER TABLE public."WA_MENSAGENS_RECRUTAMENTO"
      ADD CONSTRAINT "WA_MENSAGENS_RECRUTAMENTO_solicitacao_id_fkey"
      FOREIGN KEY (solicitacao_id) REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE CASCADE;
    ALTER TABLE public."WA_CURRICULOS"
      ADD CONSTRAINT "WA_CURRICULOS_vaga_id_fkey"
      FOREIGN KEY (vaga_id) REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE CASCADE;
    ALTER TABLE public."RECRUTAMENTO_HISTORICO"
      ADD CONSTRAINT "RECRUTAMENTO_HISTORICO_solicitacao_id_fkey"
      FOREIGN KEY (solicitacao_id) REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
