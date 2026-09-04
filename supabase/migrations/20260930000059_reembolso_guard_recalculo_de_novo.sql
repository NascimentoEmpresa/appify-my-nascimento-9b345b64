-- =====================================================================
-- REEMBOLSO — o guard voltou a barrar a PRÓPRIA trigger de recálculo.
-- É a MESMA falha da 20260930000041, reintroduzida pela 20260930000050.
--
-- SINTOMA (04/09/2026, produção): "Enviar para aprovação" volta com
-- "A solicitação não foi enviada — O total é calculado pelas despesas, não
-- pode ser digitado." Ninguém digitou total nenhum: `useCriarReembolso` nem
-- manda esse campo. Vale para QUALQUER despesa, de qualquer tipo — apareceu
-- junto com um tipo novo por coincidência de quem foi testar primeiro.
--
-- O caminho é o mesmo de sempre:
--   INSERT em CS_REEMBOLSO_ITEM
--     └─ AFTER INSERT: cs_reembolso_recalcula_total()
--          └─ UPDATE CS_REEMBOLSO SET total_centavos = soma(itens)
--               └─ BEFORE UPDATE: cs_reembolso_guard()
--                    └─ NEW.total_centavos <> OLD.total_centavos → EXCEPTION
--
-- COMO VOLTOU
-- A 20260930000050 precisava abrir a transição `aprovado → enviado_malote`
-- para o dono, e reescreveu a função inteira a partir de uma cópia ANTERIOR
-- à 041 — `CREATE OR REPLACE` não avisa que está desfazendo alguém. O trecho
-- do total voltou à forma estrita e levou junto o `SECURITY DEFINER`.
--
-- Esta migration recompõe as duas metades: as regras de transição são as da
-- 050 (que são as vigentes e as queridas), e a regra do total é a da 041 — o
-- total continua não podendo ser DIGITADO; ele pode mudar para um valor só, a
-- soma real dos itens, que é o único valor que a trigger de recálculo
-- escreve.
--
-- Fica registrado para a próxima: quem for reescrever cs_reembolso_guard()
-- parte do corpo VIGENTE (\sf public.cs_reembolso_guard no banco), não de uma
-- migration antiga — esta função já foi redefinida quatro vezes (006, 007,
-- 041, 050) e é a terceira vez que uma reescrita apaga uma correção.
--
-- Idempotente.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.cs_reembolso_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  soma_itens bigint;
BEGIN
  IF public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar') THEN
    RETURN NEW;  -- quem tem a chave de decidir passa direto
  END IF;

  -- Para quem NÃO decide, só duas transições passam:
  --   pendente  → cancelado       (o dono desiste do próprio pedido)
  --   aprovado  → enviado_malote  (o dono lança a despesa aprovada, e só o
  --                                 dono — `cs_reembolso_vincular_despesa`
  --                                 confere isso de novo, esta linha é a
  --                                 barreira do trigger, não a única).
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'pendente' AND NEW.status = 'cancelado')
     AND NOT (OLD.status = 'aprovado' AND NEW.status = 'enviado_malote' AND OLD.solicitante_id = auth.uid()) THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação.';
  END IF;

  -- O total pode mudar, mas só para a soma dos itens. Quem escreve esse valor
  -- é cs_reembolso_recalcula_total(); qualquer outro número é digitação.
  IF NEW.total_centavos IS DISTINCT FROM OLD.total_centavos THEN
    SELECT COALESCE(sum(i.valor_centavos), 0) INTO soma_itens
      FROM public."CS_REEMBOLSO_ITEM" i
     WHERE i.reembolso_id = NEW.id;

    IF NEW.total_centavos IS DISTINCT FROM soma_itens THEN
      RAISE EXCEPTION 'O total é calculado pelas despesas, não pode ser digitado.';
    END IF;
  END IF;

  IF NEW.solicitante_id IS DISTINCT FROM OLD.solicitante_id THEN
    RAISE EXCEPTION 'O solicitante não muda.';
  END IF;
  IF NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
     OR NEW.motivo_reprovacao IS DISTINCT FROM OLD.motivo_reprovacao THEN
    RAISE EXCEPTION 'Só quem aprova preenche a decisão.';
  END IF;

  RETURN NEW;
END $$;

-- SECURITY DEFINER (também perdido na 050) é o que garante que a soma enxergue
-- TODOS os itens: a policy de SELECT de CS_REEMBOLSO_ITEM recorta por
-- dono/aprovador, e um guard que somasse só o que o chamador vê aprovaria
-- totais errados.

DROP TRIGGER IF EXISTS cs_reembolso_guard_trg ON public."CS_REEMBOLSO";
CREATE TRIGGER cs_reembolso_guard_trg BEFORE UPDATE ON public."CS_REEMBOLSO"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_guard();

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reexecute o bloco 2 de
--   20260930000050_reembolso_solicitante_lanca_no_malote.sql
--   (volta a versão estrita do total — e volta o bug deste chamado).
-- =====================================================================
