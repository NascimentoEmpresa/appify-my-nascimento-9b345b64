-- =====================================================================
-- REEMBOLSO → MALOTE: o envio passa pelo FORMULÁRIO do Malote.
--
-- Pedido do Pablo em 02/09/2026, depois de ver a tela travada: "não tá dando
-- pra enviar ao malote, preciso que quando clicar em enviar pro malote abra
-- essa tela com as informações já preenchidas. E aí sim ao enviar pro malote
-- essa solicitação vai ficar com o status enviado pro malote."
--
-- O QUE ESTAVA ERRADO NO DESENHO ANTERIOR (mesmo dia, 20260930000044):
-- aprovar criava a despesa sozinho, a partir de uma configuração global
-- ("Padrões para o malote"). Isso exigia uma classificação padrão para TODO
-- reembolso, e:
--
--   • não existe uma. Classificação é categoria contábil e varia por despesa;
--     a única parecida no catálogo é "DIÁRIA", que não é reembolso.
--   • enquanto ela faltasse, aprovar ficava BLOQUEADO — foi exatamente o que
--     aconteceu: a fila do Jurídico parou com o aviso "Aprovar está
--     bloqueado" e ninguém conseguia seguir.
--
-- O desenho novo é o que o Patrimônio já usa desde antes (ver
-- `src/pages/juridico/patrimonio/vinculoMalote.ts`): a tela de origem manda o
-- usuário para o FORMULÁRIO do Malote com tudo preenchido, ele confere,
-- escolhe a classificação ali — onde ela é escolhida despesa a despesa, como
-- deve ser — e salva. O Malote então carimba a volta.
--
-- Uma tela só para criar despesa, em vez de duas: era esse o argumento do
-- comentário em CriarDespesa.tsx ("clonar o formulário faria as regras de
-- aprovação, rateio e parcelamento existirem em dois lugares"), e criar a
-- despesa por RPC era justamente o segundo lugar.
-- =====================================================================

-- 1) O carimbo de volta ---------------------------------------------------
/**
 * Liga um reembolso à despesa que o Malote acabou de criar.
 *
 * SECURITY DEFINER pelo mesmo motivo da `cs_reembolso_enviar_ao_malote`: quem
 * está no formulário do Malote é o aprovador do reembolso, não
 * necessariamente alguém que a RLS de `CS_REEMBOLSO` deixaria escrever. A
 * autorização é conferida aqui dentro, com a MESMA dupla de sempre (menu de
 * aprovação + aprovar aquele setor).
 *
 * Idempotente: chamar de novo com a mesma despesa não muda nada, e chamar com
 * outra despesa é recusado — reembolso ligado a duas despesas é reembolso
 * pago duas vezes.
 */
CREATE OR REPLACE FUNCTION public.cs_reembolso_vincular_despesa(_id uuid, _despesa uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r public."CS_REEMBOLSO"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public."CS_REEMBOLSO" WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reembolso não encontrado.'; END IF;

  IF NOT (public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar')
          AND public.cs_reembolso_aprova_setor(r.setor)) THEN
    RAISE EXCEPTION 'Você não aprova reembolso do setor %.', r.setor;
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

-- 2) Sai a função que criava a despesa sozinha ----------------------------
-- Nasceu hoje de manhã e nunca chegou a criar uma despesa em produção — foi
-- barrada pela config vazia antes disso. Deixá-la seria manter dois caminhos
-- para criar a MESMA despesa, e o que não é usado é o que diverge calado.
DROP FUNCTION IF EXISTS public.cs_reembolso_aprovar_e_lancar(uuid);

-- `cs_reembolso_enviar_ao_malote` FICA, mas sem quem a chame: ela é da
-- 20260930000007 e some da tela neste commit. Não removo junto porque
-- derrubar função alheia no mesmo passo em que se muda o fluxo é como se
-- perde a chance de voltar atrás com um clique.
COMMENT ON FUNCTION public.cs_reembolso_enviar_ao_malote(uuid) IS
  'SEM USO desde 02/09/2026: o envio ao malote passou a ser feito pelo formulário do Malote, que devolve o vínculo por cs_reembolso_vincular_despesa. Mantida para rollback.';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP FUNCTION IF EXISTS public.cs_reembolso_vincular_despesa(uuid, uuid);
-- -- E reaplique o bloco 2 da 20260930000044 para recriar
-- -- cs_reembolso_aprovar_e_lancar.
-- NOTIFY pgrst, 'reload schema';
