-- =====================================================================
-- REEMBOLSO — o guard de campo estava barrando a PRÓPRIA trigger de
-- recálculo do total, e com isso nenhum envio chegava ao fim.
--
-- Visto em produção em 02/09/2026: o formulário mostrava um toast de erro
-- "O total é calculado pelas despesas, não pode ser digitado." e a tabela
-- `CS_REEMBOLSO` terminava o dia VAZIA — nenhuma solicitação, de ninguém.
--
-- O caminho é este, e as duas triggers são da 20260930000006:
--
--   INSERT em CS_REEMBOLSO_ITEM
--     └─ AFTER INSERT: cs_reembolso_recalcula_total()
--          └─ UPDATE CS_REEMBOLSO SET total_centavos = soma(itens)
--               └─ BEFORE UPDATE: cs_reembolso_guard()
--                    └─ NEW.total_centavos <> OLD.total_centavos → EXCEPTION
--
-- Ou seja: o guard existe para impedir que alguém DIGITE o total, mas quem
-- ele barrava na prática era a trigger que CALCULA o total. Só passava quem
-- caísse no atalho do topo da função — `can_access(...,'aprovar')` + ser o
-- aprovador daquele setor —, que é justamente o que o solicitante comum não
-- é. O Pablo, de SISTEMAS, não aprova SISTEMAS (ver item 3 da
-- 20260930000027), então nem ele conseguia enviar.
--
-- E o erro não deixava rastro: `useCriarReembolso` faz rollback do
-- cabeçalho quando o item falha, e a 20260930000027 acabou de dar GRANT e
-- policy de DELETE para esse rollback funcionar. O resultado é que o
-- cabeçalho era apagado direitinho e sobrava só o toast — a leitura de quem
-- usa era "deu um errinho mas foi", quando não tinha ido nada.
--
-- A correção não afrouxa a regra: o total continua não podendo ser digitado.
-- Ele passa a poder MUDAR para um valor só — a soma real dos itens, que é o
-- único valor que a trigger de recálculo escreve. Um cliente que tente gravar
-- um total inventado continua batendo na exceção; um que, por acaso, mande
-- exatamente a soma dos itens grava um valor que já era o correto.
--
-- Escolhido em vez de uma flag de sessão (`set_config('app.recalculo',...)`)
-- porque a condição fica verificável olhando só a linha: não depende de
-- ninguém ter lembrado de ligar e desligar a flag no lugar certo.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.cs_reembolso_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  soma_itens bigint;
BEGIN
  IF public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar')
     AND public.cs_reembolso_aprova_setor(OLD.setor) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'pendente' AND NEW.status = 'cancelado') THEN
    RAISE EXCEPTION 'Você não aprova reembolso do setor %.', OLD.setor;
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

  IF NEW.solicitante_id IS DISTINCT FROM OLD.solicitante_id
     OR NEW.setor IS DISTINCT FROM OLD.setor THEN
    RAISE EXCEPTION 'Solicitante e setor não mudam depois de criada.';
  END IF;
  IF NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
     OR NEW.motivo_reprovacao IS DISTINCT FROM OLD.motivo_reprovacao THEN
    RAISE EXCEPTION 'Só quem aprova preenche a decisão.';
  END IF;

  RETURN NEW;
END $$;

-- SECURITY DEFINER acima é o que garante que a soma enxergue TODOS os itens:
-- a policy de SELECT de CS_REEMBOLSO_ITEM recorta por dono/aprovador, e um
-- guard que somasse só o que o chamador vê aprovaria totais errados.

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- CREATE OR REPLACE FUNCTION public.cs_reembolso_guard() RETURNS trigger
-- LANGUAGE plpgsql SET search_path = public, pg_temp
-- AS $$
-- BEGIN
--   IF public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar')
--      AND public.cs_reembolso_aprova_setor(OLD.setor) THEN
--     RETURN NEW;
--   END IF;
--   IF NEW.status IS DISTINCT FROM OLD.status
--      AND NOT (OLD.status = 'pendente' AND NEW.status = 'cancelado') THEN
--     RAISE EXCEPTION 'Você não aprova reembolso do setor %.', OLD.setor;
--   END IF;
--   IF NEW.total_centavos IS DISTINCT FROM OLD.total_centavos THEN
--     RAISE EXCEPTION 'O total é calculado pelas despesas, não pode ser digitado.';
--   END IF;
--   IF NEW.solicitante_id IS DISTINCT FROM OLD.solicitante_id
--      OR NEW.setor IS DISTINCT FROM OLD.setor THEN
--     RAISE EXCEPTION 'Solicitante e setor não mudam depois de criada.';
--   END IF;
--   IF NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
--      OR NEW.motivo_reprovacao IS DISTINCT FROM OLD.motivo_reprovacao THEN
--     RAISE EXCEPTION 'Só quem aprova preenche a decisão.';
--   END IF;
--   RETURN NEW;
-- END $$;
-- NOTIFY pgrst, 'reload schema';
