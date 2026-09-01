-- =====================================================================
-- REEMBOLSO — o teto passa a AVISAR, a fila mostra só a alçada, e o
-- rollback do envio deixa de largar cabeçalho órfão.
--
-- Três defeitos vistos em produção em 01/09/2026, com a mesma origem:
--
-- 1. TETO BARRAVA O LANÇAMENTO. `cs_reembolso_item_valida` levantava exceção
--    quando o valor passava do teto do tipo. Só que teto de reembolso não é
--    limite de digitação — é referência de política: quem gastou R$ 62,00 num
--    almoço de teto R$ 35,00 gastou isso mesmo, e quem decide se paga o
--    excedente é o aprovador, não a trigger. Agora o valor entra e o excedente
--    aparece marcado nas duas telas (formulário e fila).
--
-- 2. E ISSO PRODUZIA SOLICITAÇÃO DE R$ 0,00. O front cria o cabeçalho, sobe o
--    comprovante e só então insere o item. Com a trigger recusando o item, o
--    `useCriarReembolso` tentava apagar o cabeçalho — mas `CS_REEMBOLSO` nunca
--    teve GRANT de DELETE (a 20260930000006 concedeu SELECT, INSERT e UPDATE),
--    então o delete não apagava nada e ninguém percebia: sobrava um REEMB
--    pendente, sem despesa, valendo R$ 0,00. Foi assim que apareceram
--    REEMB-202608-0001, -0002 e -0003 zerados. Aqui o DELETE ganha grant e
--    policy, estreitos de propósito: só o dono, só enquanto pendente, e só
--    enquanto a solicitação não tiver NENHUM item — que é exatamente o
--    rollback, e nunca uma solicitação de verdade (essa se cancela).
--
-- 3. A FILA DE APROVAÇÃO MOSTRAVA O QUE NÃO É DA ALÇADA. A policy de SELECT
--    é `solicitante_id = auth.uid() OR (menu + aprova_setor)` — correta para a
--    tabela, porque o dono precisa ver a própria solicitação em "Minhas
--    solicitações". Só que a tela de aprovação fazia o mesmo SELECT sem filtro,
--    então o primeiro ramo entregava as solicitações DO PRÓPRIO usuário para a
--    fila: o Pablo, de SISTEMAS, via os próprios REEMB numa fila onde o guard
--    respondia "Você não aprova reembolso do setor SISTEMAS". A fila agora tem
--    RPC própria, com o mesmo par de condições do ramo de aprovação — e sem o
--    ramo do dono.
--
-- A validação de janela continua sendo barreira (ela diz o que a viagem
-- permite pedir, não quanto custa). O espelho em src/lib/reembolso/regras.ts
-- foi ajustado junto: `podeLancar` perdeu o teto e ganhou `avisoDeTeto`.
-- =====================================================================

-- 1) Teto vira aviso ----------------------------------------------------
-- Mesma função da 20260930000006 menos o bloco do teto. Tipo inativo, viagem
-- fora da janela e solicitação já decidida continuam recusando: as três são
-- sobre o que pode ser pedido, não sobre quanto custou.
CREATE OR REPLACE FUNCTION public.cs_reembolso_item_valida() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  t        public."CS_REEMBOLSO_TIPO"%ROWTYPE;
  r        public."CS_REEMBOLSO"%ROWTYPE;
  alcanca  boolean;
BEGIN
  SELECT * INTO t FROM public."CS_REEMBOLSO_TIPO" WHERE codigo = NEW.tipo_codigo;
  IF NOT FOUND OR NOT t.ativo THEN
    RAISE EXCEPTION 'Tipo de despesa "%" não está disponível.', NEW.tipo_codigo;
  END IF;

  SELECT * INTO r FROM public."CS_REEMBOLSO" WHERE id = NEW.reembolso_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de reembolso não encontrada.';
  END IF;

  IF r.status <> 'pendente' THEN
    RAISE EXCEPTION 'Solicitação já foi % — não aceita mais despesas.', r.status;
  END IF;

  IF t.hora_inicio IS NOT NULL AND t.hora_fim IS NOT NULL THEN
    alcanca := public.cs_reembolso_periodos_cruzam(r.saida, r.chegada, t.hora_inicio, t.hora_fim);
    IF NOT alcanca THEN
      RAISE EXCEPTION '% vale para viagem que passe entre % e %. A sua foi de % às %.',
        t.nome, to_char(t.hora_inicio,'HH24:MI'), to_char(t.hora_fim,'HH24:MI'),
        to_char(r.saida,'HH24:MI'), to_char(r.chegada,'HH24:MI');
    END IF;
  END IF;

  -- O teto ficava aqui e levantava exceção. Ver o item 1 do cabeçalho: o
  -- excedente é informação para o aprovador, não impedimento para o
  -- solicitante. `CS_REEMBOLSO_TIPO.valor_maximo_centavos` segue sendo lido
  -- pelas telas para montar o aviso.
  RETURN NEW;
END $$;

-- 2) Rollback do envio pode apagar o cabeçalho vazio --------------------
GRANT DELETE ON public."CS_REEMBOLSO" TO authenticated;

-- `"CS_REEMBOLSO".id` qualificado de propósito: `CS_REEMBOLSO_ITEM` também tem
-- uma coluna `id`, e um `i.reembolso_id = id` cru casaria a subconsulta com ela
-- mesma — a policy passaria a valer para qualquer linha.
DROP POLICY IF EXISTS cs_reembolso_delete ON public."CS_REEMBOLSO";
CREATE POLICY cs_reembolso_delete ON public."CS_REEMBOLSO"
  FOR DELETE TO authenticated
  USING (
    solicitante_id = auth.uid()
    AND status = 'pendente'
    AND NOT EXISTS (
      SELECT 1 FROM public."CS_REEMBOLSO_ITEM" i
       WHERE i.reembolso_id = "CS_REEMBOLSO".id
    )
  );

-- 3) A fila é só a alçada -----------------------------------------------
/**
 * As solicitações que ESTA pessoa aprova.
 *
 * Mesmo par de condições do ramo de aprovação da policy de SELECT (menu de
 * aprovação + `cs_reembolso_aprova_setor`), sem o ramo `solicitante_id =
 * auth.uid()` — a própria solicitação aparece em "Minhas solicitações", não na
 * fila de quem decide.
 *
 * SECURITY DEFINER contorna a RLS, então a autorização é conferida aqui
 * dentro, na marra. `_status` NULL ou 'todos' não filtra.
 */
CREATE OR REPLACE FUNCTION public.cs_reembolso_fila(_status text DEFAULT NULL)
RETURNS SETOF public."CS_REEMBOLSO"
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.*
    FROM public."CS_REEMBOLSO" r
   WHERE public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'visualizar')
     AND public.cs_reembolso_aprova_setor(r.setor)
     AND (_status IS NULL OR _status = 'todos' OR r.status = _status)
   ORDER BY r.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.cs_reembolso_fila(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_fila(text) TO authenticated;

-- 4) Limpa os órfãos que o defeito 2 deixou ------------------------------
-- Pendente, sem nenhuma despesa e sem decisão: só pode ter vindo de um envio
-- que falhou no meio. Solicitação de verdade sempre tem pelo menos um item,
-- porque o formulário exige comprovante por despesa.
DELETE FROM public."CS_REEMBOLSO" r
 WHERE r.status = 'pendente'
   AND r.total_centavos = 0
   AND NOT EXISTS (
     SELECT 1 FROM public."CS_REEMBOLSO_ITEM" i WHERE i.reembolso_id = r.id
   );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- -- Volta o teto a barrar (reaplique o bloco 3.1 da 20260930000006, ou
-- -- reinsira antes do RETURN NEW:
-- --   IF t.valor_maximo_centavos IS NOT NULL
-- --      AND NEW.valor_centavos > t.valor_maximo_centavos THEN
-- --     RAISE EXCEPTION '% tem teto de R$ %. Você lançou R$ %.',
-- --       t.nome,
-- --       to_char(t.valor_maximo_centavos / 100.0, 'FM999G999D00'),
-- --       to_char(NEW.valor_centavos      / 100.0, 'FM999G999D00');
-- --   END IF;
-- DROP POLICY IF EXISTS cs_reembolso_delete ON public."CS_REEMBOLSO";
-- REVOKE DELETE ON public."CS_REEMBOLSO" FROM authenticated;
-- DROP FUNCTION IF EXISTS public.cs_reembolso_fila(text);
-- NOTIFY pgrst, 'reload schema';
