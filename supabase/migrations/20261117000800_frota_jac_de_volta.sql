-- =========================================================================
-- FROTA: a JAC (placa JBZ-4D93) de volta (17/11/2026)
--
-- RELATO (Pablo): "parece que alguém excluiu a JAC da frota, traz de volta".
--
-- Excluir um bem em Suprimentos › Patrimônio apaga a linha de
-- sup_patrimonio (useSupPatrimonio.ts → delete). O que sobra para refazer:
--   · as viagens do carro (cs_veiculo_agendamento) guardam o id, o nome e a
--     placa congelados na reserva — o histórico "agendamento nº 238 (I/JAC E
--     JS4 JBZ-4D93)" é de lá;
--   · sup_patrimonio_log guarda a exclusão (com o nome) e cada alteração
--     campo a campo (nome, placa, lotação, contrato, posto, ativo).
--
-- O QUE FAZ (uma vez; reaplicar não muda nada):
--   1. Acha o carro pela viagem mais recente com "JAC" no nome ou placa
--      JBZ-4D93.
--   2. Se o cadastro ainda existe mas está inativo → reativa.
--   3. Se não existe → recria com o MESMO id (as viagens antigas voltam a
--      apontar para ele), empresa da viagem, e nome/placa/lotação/contrato/
--      posto pelo último valor do log (na falta, o que a viagem guardou).
--   4. Se já existe outro cadastro com a mesma placa (alguém recriou à mão),
--      não duplica.
-- Não volta: fotos e documentos anexados ao bem (sup_patrimonio_arquivo é
-- apagada junto na exclusão) — reanexar pela tela do Patrimônio.
-- ROLLBACK no fim.
-- =========================================================================

DO $$
DECLARE
  v       record;
  v_ctr_txt   text;
  v_nome  text;
  v_ident text;
  v_lot   text;
  v_ctr   uuid;
  v_posto uuid;
  v_posto_txt text;
BEGIN
  SELECT a.patrimonio_id, a.empresa_id, a.veiculo_nome, a.veiculo_identificador
    INTO v
    FROM public.cs_veiculo_agendamento a
   WHERE a.veiculo_nome ILIKE '%JAC%'
      OR upper(replace(replace(coalesce(a.veiculo_identificador, ''), '-', ''), ' ', '')) = 'JBZ4D93'
   ORDER BY a.data_inicio DESC, a.created_at DESC
   LIMIT 1;
  IF v.patrimonio_id IS NULL THEN
    RAISE NOTICE 'JAC: nenhuma viagem encontrada — nada a restaurar.';
    RETURN;
  END IF;

  -- 2) Ainda existe: só reativa.
  IF EXISTS (SELECT 1 FROM public.sup_patrimonio WHERE id = v.patrimonio_id) THEN
    UPDATE public.sup_patrimonio SET ativo = true WHERE id = v.patrimonio_id AND NOT ativo;
    RAISE NOTICE 'JAC: cadastro existe (id %), garantido ativo.', v.patrimonio_id;
    RETURN;
  END IF;

  -- Último valor de cada campo pelo log.
  SELECT max(valor_novo) FILTER (WHERE campo = 'nome'),
         max(valor_novo) FILTER (WHERE campo = 'identificador'),
         max(valor_novo) FILTER (WHERE campo = 'lotacao'),
         max(valor_novo) FILTER (WHERE campo = 'contrato_id'),
         max(valor_novo) FILTER (WHERE campo = 'posto_id')
    INTO v_nome, v_ident, v_lot, v_ctr_txt, v_posto_txt
    FROM (SELECT DISTINCT ON (l.campo) l.campo, l.valor_novo
            FROM public.sup_patrimonio_log l
           WHERE l.patrimonio_id = v.patrimonio_id AND l.acao = 'alterado'
           ORDER BY l.campo, l.created_at DESC) u;
  v_ctr   := CASE WHEN v_ctr_txt ~* '^[0-9a-f-]{36}$' THEN v_ctr_txt::uuid END;
  v_posto := CASE WHEN v_posto_txt ~* '^[0-9a-f-]{36}$' THEN v_posto_txt::uuid END;
  IF v_ctr IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = v_ctr) THEN v_ctr := NULL; END IF;
  IF v_posto IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sup_posto WHERE id = v_posto) THEN v_posto := NULL; END IF;

  v_nome := COALESCE(NULLIF(btrim(v_nome), ''),
                     (SELECT l.patrimonio_nome FROM public.sup_patrimonio_log l
                       WHERE l.patrimonio_id = v.patrimonio_id AND l.acao = 'excluido'
                       ORDER BY l.created_at DESC LIMIT 1),
                     v.veiculo_nome);
  v_ident := COALESCE(NULLIF(btrim(v_ident), ''), NULLIF(btrim(v.veiculo_identificador), ''));

  -- 4) Alguém já recriou com a mesma placa: não duplica.
  IF v_ident IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.sup_patrimonio p
        WHERE upper(replace(replace(coalesce(p.identificador, ''), '-', ''), ' ', ''))
              = upper(replace(replace(v_ident, '-', ''), ' ', ''))) THEN
    RAISE NOTICE 'JAC: já existe cadastro com a placa % — não recriado.', v_ident;
    RETURN;
  END IF;

  -- 3) Recria com o mesmo id.
  INSERT INTO public.sup_patrimonio (id, empresa_id, categoria, nome, identificador, contrato_id, posto_id, lotacao, ativo, observacoes)
  VALUES (v.patrimonio_id, v.empresa_id, 'veiculo', v_nome, v_ident, v_ctr, v_posto,
          COALESCE(NULLIF(btrim(v_lot), ''), CASE WHEN v_ctr IS NULL THEN 'ADM' END), true,
          'Restaurado em 17/11/2026: o cadastro tinha sido excluído. Fotos e documentos anexados não voltam — reanexar.');
  RAISE NOTICE 'JAC: recriada (id %, %, %).', v.patrimonio_id, v_nome, v_ident;
END $$;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DELETE FROM public.sup_patrimonio
--  WHERE observacoes LIKE 'Restaurado em 17/11/2026: o cadastro tinha sido excluído.%';
