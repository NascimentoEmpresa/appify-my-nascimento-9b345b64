-- =====================================================================
-- REEMBOLSO — aprovar JÁ lança a despesa no Malote.
--
-- Pedido do Pablo em 02/09/2026: "preciso que ao clicar em APROVAR vá pro
-- malote e entre como despesa lá, como se registrasse uma conta no malote."
--
-- Até aqui eram dois cliques: Aprovar deixava a solicitação em `aprovado` e
-- só então aparecia o botão "Enviar ao malote". Um passo que ninguém pediu e
-- que ninguém lembrava de dar — o reembolso ficava aprovado, o dinheiro não
-- entrava em lugar nenhum, e a pessoa que pediu via "Aprovado" achando que
-- estava resolvido.
--
-- Agora é uma transação só. Ou aprova E lança, ou não faz nem uma coisa nem
-- outra: um reembolso "aprovado mas fora do malote" era exatamente o estado
-- intermediário que se está eliminando, então não faz sentido a correção
-- poder produzi-lo de novo quando o lançamento falha.
--
-- DUAS COISAS QUE ESTA MIGRATION PRECISOU RESOLVER ANTES:
--
--   1. `CS_REEMBOLSO_CONFIG` está VAZIA no banco (conferido em 02/09/2026:
--      empresa_id, classificacao_id, forma_pagamento e tipo_movimento todos
--      nulos). Como `cs_reembolso_enviar_ao_malote` exigia
--      `cfg.empresa_id`, juntar os dois passos sem mexer nisso quebraria
--      TODA aprovação a partir de agora — inclusive as seis do Jurídico que
--      estão na fila da Natália.
--
--      A empresa passa a cair para a do SOLICITANTE quando a config não
--      define uma. É a leitura certa de qualquer forma: o reembolso é uma
--      despesa da empresa da pessoa, não de uma empresa "padrão do módulo".
--      A config continua valendo e continua ganhando quando preenchida —
--      vira o jeito de dizer "todo reembolso vai numa empresa só".
--
--   2. `classificacao_id` também é nula na config, e essa NÃO tem saída: o
--      check `malote_despesa_classificacao_coerente` exige classificação em
--      toda despesa cuja origem não seja multi-classificação. Escolher uma
--      por conta própria seria pior que recusar — classificação é categoria
--      contábil, e a errada passa despercebida justamente por estar
--      preenchida. Então a função recusa, dizendo onde resolver, e a tela de
--      aprovação avisa ANTES de alguém clicar (ver AprovacaoReembolso).
--
--      A tela de Tipos e Limites pedia esses dois campos como UUID digitado
--      à mão — foi por isso que ninguém preencheu, e é por isso que nenhum
--      reembolso jamais chegou ao Malote. Virou seletor no mesmo commit.
--
--   3. O INSERT ESTAVA QUEBRADO e ninguém tinha percebido.
--      `CS_REEMBOLSO.competencia` é texto "AAAA-MM"; `malote_despesa.competencia`
--      virou `date` na 20260930000035 (SIS-2026-0287, "competência como data").
--      Desde então a função morria com "column competencia is of type date but
--      expression is of type text" — e não havia como notar, porque o botão
--      "Enviar ao malote" só aparece em reembolso APROVADO e nenhum tinha
--      chegado lá (a config vazia já barrava antes). Agora vai `-01` no fim e
--      cast explícito: a competência do reembolso é o mês, e no Malote o mês é
--      o dia 1º dele.
--
-- A despesa nasce em `rascunho` (era assim antes e continua): o Malote tem o
-- próprio fluxo de conferência, e reembolso aprovado não é reembolso pago.
-- =====================================================================

-- 1) A empresa da despesa cai para a do solicitante ---------------------
CREATE OR REPLACE FUNCTION public.cs_reembolso_enviar_ao_malote(_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r   public."CS_REEMBOLSO"%ROWTYPE;
  cfg public."CS_REEMBOLSO_CONFIG"%ROWTYPE;
  nova_id      uuid;
  nome_despesa text;
  emp          uuid;
BEGIN
  SELECT * INTO r FROM public."CS_REEMBOLSO" WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reembolso não encontrado.'; END IF;

  IF NOT (public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar')
          AND public.cs_reembolso_aprova_setor(r.setor)) THEN
    RAISE EXCEPTION 'Você não aprova reembolso do setor %.', r.setor;
  END IF;

  IF r.malote_despesa_id IS NOT NULL THEN
    RETURN r.malote_despesa_id;   -- já foi; devolve o mesmo
  END IF;

  IF r.status <> 'aprovado' THEN
    RAISE EXCEPTION 'Só reembolso aprovado vai para o malote (este está %).', r.status;
  END IF;

  SELECT * INTO cfg FROM public."CS_REEMBOLSO_CONFIG" WHERE id;

  -- A config manda quando existe; senão, a empresa de quem pediu. Ver o item
  -- 1 do cabeçalho: sem esta linha, aprovar quebraria para todo mundo,
  -- porque a config nunca foi preenchida.
  emp := coalesce(
    cfg.empresa_id,
    (SELECT p.empresa_id FROM public.profiles p WHERE p.id = r.solicitante_id)
  );
  IF emp IS NULL THEN
    RAISE EXCEPTION 'Não sei em qual empresa lançar: % não tem empresa no cadastro, e não há empresa padrão em Tipos e Limites.',
      coalesce(r.solicitante_nome, 'o solicitante');
  END IF;

  -- Sem saída: o Malote recusa despesa sem classificação, e adivinhar a
  -- categoria contábil é pior do que parar aqui. Ver o item 2 do cabeçalho.
  IF cfg.classificacao_id IS NULL THEN
    RAISE EXCEPTION 'Falta escolher a classificação do Malote em Central de Serviços › Reembolso › Tipos e Limites. Sem ela o Malote não aceita a despesa.';
  END IF;

  nome_despesa := 'Reembolso ' || coalesce(r.numero, '') || ' — ' ||
                  coalesce(r.solicitante_nome, 'colaborador') || ' (' || coalesce(r.setor, '—') || ')';

  INSERT INTO public.malote_despesa (
    empresa_id, classificacao_id, origem, status, nome, valor_total,
    descricao, competencia, forma_pagamento, tipo_movimento,
    informacoes_pagamento, created_by
  ) VALUES (
    -- `despesa_unica` é uma das TRÊS origens que o Malote aceita
    -- ('solicitacao', 'despesa_unica', 'despesa_multi_classificacao'). A
    -- 20260930000007 escrevia 'reembolso', que o check sempre recusou — mais
    -- uma prova de que esta função nunca rodou. Um reembolso é despesa de uma
    -- classificação só, então `despesa_unica` é a origem certa, e assim o
    -- Malote não precisa mudar de forma para receber reembolso. Quem veio de
    -- reembolso se reconhece pela descrição e pelo
    -- `CS_REEMBOLSO.malote_despesa_id`, que aponta para cá.
    emp, cfg.classificacao_id, 'despesa_unica', 'rascunho',
    nome_despesa, (r.total_centavos / 100.0),
    'Gerado do Reembolso ' || coalesce(r.numero, r.id::text) ||
      '. Viagem em ' || to_char(r.data_viagem, 'DD/MM/YYYY') ||
      ', das ' || to_char(r.saida, 'HH24:MI') || ' às ' || to_char(r.chegada, 'HH24:MI') || '.',
    -- "2026-09" (texto, no reembolso) → 2026-09-01 (date, no malote).
    (r.competencia || '-01')::date, cfg.forma_pagamento, cfg.tipo_movimento,
    'PIX: ' || r.pix, auth.uid()
  ) RETURNING id INTO nova_id;

  UPDATE public."CS_REEMBOLSO"
     SET malote_despesa_id = nova_id,
         enviado_malote_em = now(),
         status = 'enviado_malote'
   WHERE id = _id;

  RETURN nova_id;
END $$;
REVOKE ALL ON FUNCTION public.cs_reembolso_enviar_ao_malote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_enviar_ao_malote(uuid) TO authenticated;

-- 2) Aprovar e lançar, numa transação só --------------------------------
/**
 * O que o botão Aprovar chama.
 *
 * Faz a decisão e o lançamento juntos. Se o Malote recusar, a aprovação
 * volta atrás junto — é uma função, logo uma transação — e quem clicou lê o
 * motivo em vez de ficar com um reembolso aprovado e invisível para o
 * financeiro.
 *
 * A autorização é conferida aqui E dentro de `cs_reembolso_enviar_ao_malote`.
 * Duas vezes de propósito: esta função existe para ser chamada pela tela, a
 * outra continua chamável sozinha (as solicitações que já estavam aprovadas
 * antes desta mudança ainda precisam do botão antigo), e cada uma tem que se
 * defender sem depender de quem a chamou.
 */
CREATE OR REPLACE FUNCTION public.cs_reembolso_aprovar_e_lancar(_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r    public."CS_REEMBOLSO"%ROWTYPE;
  nome text;
BEGIN
  SELECT * INTO r FROM public."CS_REEMBOLSO" WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reembolso não encontrado.'; END IF;

  IF NOT (public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar')
          AND public.cs_reembolso_aprova_setor(r.setor)) THEN
    RAISE EXCEPTION 'Você não aprova reembolso do setor %.', r.setor;
  END IF;

  -- Idempotência: dois cliques rápidos não podem virar duas despesas.
  IF r.malote_despesa_id IS NOT NULL THEN
    RETURN r.malote_despesa_id;
  END IF;

  IF r.status <> 'pendente' THEN
    RAISE EXCEPTION 'Só dá para aprovar o que está aguardando aprovação (este está %).', r.status;
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO nome
    FROM public.profiles p WHERE p.id = auth.uid();

  UPDATE public."CS_REEMBOLSO"
     SET status = 'aprovado',
         decidido_por = auth.uid(),
         decidido_por_nome = nome,
         decidido_em = now(),
         motivo_reprovacao = NULL
   WHERE id = _id;

  -- Levanta exceção se o Malote recusar, e aí o UPDATE acima volta atrás.
  RETURN public.cs_reembolso_enviar_ao_malote(_id);
END $$;
REVOKE ALL ON FUNCTION public.cs_reembolso_aprovar_e_lancar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_aprovar_e_lancar(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP FUNCTION IF EXISTS public.cs_reembolso_aprovar_e_lancar(uuid);
-- -- E reaplique o bloco 8 da 20260930000007 para devolver
-- -- cs_reembolso_enviar_ao_malote à versão que exigia cfg.empresa_id.
-- NOTIFY pgrst, 'reload schema';
