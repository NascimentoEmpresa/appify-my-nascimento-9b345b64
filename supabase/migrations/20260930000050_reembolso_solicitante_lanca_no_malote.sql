-- =====================================================================
-- REEMBOLSO: troca de dono do passo "lançar no malote".
--
-- Decisão de 04/09/2026: o líder aprova, mas quem lança a despesa no malote
-- passa a ser quem pediu o reembolso — pela própria tela de Minhas
-- Solicitações, depois de aprovada. Até aqui (20260930000046) era o
-- APROVADOR quem via o botão "Enviar ao malote" e chamava esta RPC — o
-- mesmo par (menu de aprovação + `cs_reembolso_aprova_setor`) que decide.
-- Agora o papel troca: o líder só decide (aprovar/reprovar); quem pediu é
-- quem manda a despesa aprovada para o Malote.
--
-- TRÊS PONTOS TOCADOS, e só esses:
--
--   1. `cs_reembolso_vincular_despesa` — a checagem de autorização vira
--      "é o solicitante" em vez de "é quem aprova aquele setor".
--
--   2. `cs_reembolso_guard()` — o trigger BEFORE UPDATE de CS_REEMBOLSO só
--      deixava o DONO fazer UMA transição sem ser aprovador: pendente →
--      cancelado. `aprovado → enviado_malote` pelo dono era barrada aqui
--      ANTES de a RPC nem rodar (`Você não tem permissão para decidir esta
--      solicitação`) — sem esta linha a troca acima não fazia efeito nenhum.
--
--   3. `cs_reembolso_evento_auto()` — o evento de histórico usava
--      `NEW.decidido_por_nome` para QUALQUER transição de status. Isso
--      sempre foi certo por acidente: só quem tinha decidido (o aprovador)
--      é que chamava as transições não-cobertas por 'aprovado'/'reprovado'.
--      Com o solicitante lançando ao malote, `decidido_por_nome` continua
--      sendo o APROVADOR (não muda nesta UPDATE) — o evento "enviado_malote"
--      ficaria assinado com o nome errado. Também corrige o mesmo problema
--      em "cancelado", que já existia (o solicitante cancela e o evento saía
--      sem autor: `decidido_por_nome` nunca tinha sido preenchido).
--
-- NADA MAIS MUDA: quem aprova/reprova continua sendo só quem tem
-- `central_servicos_reembolso_aprovacao`+`aprovar` naquele setor — a policy
-- de UPDATE e a `cs_reembolso_guard` para essas duas transições ficam como
-- estavam. O histórico de quem aprovou (`decidido_por`/`decidido_por_nome`)
-- também não muda: continua gravado por quem decide, e é o que os eventos
-- 'aprovado'/'reprovado' seguem mostrando.
--
-- ⚠️ Rota SEPARADA: para o solicitante concluir o passo, ele precisa também
-- abrir `/app/malote/criar-despesa` (formulário do Malote), que é gateado
-- pelo menu `malote_criar_despesa` — igual vale hoje para o aprovador. Esta
-- migration NÃO concede esse menu a ninguém; é decisão de quem administra
-- Acesso por Usuário liberar `malote_criar_despesa` (visualizar + incluir)
-- para quem vai pedir reembolso.
-- =====================================================================

-- 1) Quem pode vincular a despesa ao reembolso ---------------------------
CREATE OR REPLACE FUNCTION public.cs_reembolso_vincular_despesa(_id uuid, _despesa uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r public."CS_REEMBOLSO"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public."CS_REEMBOLSO" WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reembolso não encontrado.'; END IF;

  -- Antes: quem aprova aquele setor. Agora: quem pediu o reembolso — é ele
  -- quem está em Minhas Solicitações e leva a despesa aprovada ao malote.
  IF r.solicitante_id <> auth.uid() THEN
    RAISE EXCEPTION 'Só quem pediu o reembolso pode lançá-lo no malote.';
  END IF;

  IF r.malote_despesa_id IS NOT NULL THEN
    IF r.malote_despesa_id = _despesa THEN
      RETURN;  -- já ligado nesta mesma despesa: nada a fazer
    END IF;
    RAISE EXCEPTION 'Este reembolso já foi enviado ao malote em outra despesa.';
  END IF;

  IF r.status <> 'aprovado' THEN
    RAISE EXCEPTION 'Só reembolso aprovado vai para o malote (este está %).', r.status;
  END IF;

  UPDATE public."CS_REEMBOLSO"
     SET malote_despesa_id = _despesa,
         enviado_malote_em = now(),
         status = 'enviado_malote'
   WHERE id = _id;
END $$;
REVOKE ALL ON FUNCTION public.cs_reembolso_vincular_despesa(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_vincular_despesa(uuid, uuid) TO authenticated;

-- 2) Guard de campo: libera a transição aprovado→enviado_malote PARA O DONO.
CREATE OR REPLACE FUNCTION public.cs_reembolso_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
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

  IF NEW.total_centavos IS DISTINCT FROM OLD.total_centavos THEN
    RAISE EXCEPTION 'O total é calculado pelas despesas, não pode ser digitado.';
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

DROP TRIGGER IF EXISTS cs_reembolso_guard_trg ON public."CS_REEMBOLSO";
CREATE TRIGGER cs_reembolso_guard_trg BEFORE UPDATE ON public."CS_REEMBOLSO"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_guard();

-- 3) Histórico: autor do evento é quem FEZ a transição, não sempre quem
--    decidiu. 'aprovado'/'reprovado' continuam usando o nome gravado na
--    decisão (é o registro exato do que a mutation escreveu naquele
--    momento); as demais transições resolvem o nome de quem está chamando
--    agora, pelo profile — sem isso "cancelado" saía sem autor e
--    "enviado_malote" saía assinado com o nome de quem tinha aprovado.
CREATE OR REPLACE FUNCTION public.cs_reembolso_evento_auto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."CS_REEMBOLSO_EVENTO" (reembolso_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id, 'criado', 'Solicitação registrada.', NEW.solicitante_id, NEW.solicitante_nome);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."CS_REEMBOLSO_EVENTO" (reembolso_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id, NEW.status,
            CASE WHEN NEW.status = 'reprovado'
                 THEN COALESCE(NEW.motivo_reprovacao, 'Sem motivo informado.')
                 ELSE NULL END,
            auth.uid(),
            CASE
              WHEN NEW.status IN ('aprovado', 'reprovado') THEN NEW.decidido_por_nome
              ELSE COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'Sistema')
            END);
  END IF;
  RETURN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- 1) Recriar cs_reembolso_vincular_despesa com a checagem de 20260930000046
--    (can_access(...,'central_servicos_reembolso_aprovacao','aprovar')
--     AND cs_reembolso_aprova_setor(r.setor)) no lugar do
--    `r.solicitante_id <> auth.uid()`.
-- 2) Recriar cs_reembolso_guard() sem o terceiro NOT (a linha
--    "aprovado → enviado_malote"), como estava em 20260930000006.
-- 3) Recriar cs_reembolso_evento_auto() usando NEW.decidido_por_nome direto
--    (sem o CASE), como estava em 20260930000006.
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
