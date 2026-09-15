-- =====================================================================
-- Suprimentos — baixa por código do produto, desvincular código, e o CA
-- que acompanha o lote até a Ficha EPI
--
-- PEDIDOS (15/09/2026, tela /app/suprimentos/pedidos-materiais)
--   a) "Imagine que tenho 3 códigos de jaqueta e designei o código errado.
--      Eu precisaria remover esse código designado no pedido e designar o
--      código correto, tudo ficando no histórico do pedido — e assim que for
--      tirada a designação, a quantidade daquele código já volta pro estoque."
--   b) Aceitar no campo de bipar o código do PRODUTO (os 7 dígitos do ajuste
--      7), com o sistema escolhendo o lote — "e os números de CA (caso aquele
--      item possuir) devem puxar do item automático também".
--
-- Até aqui o código baixado ficava TRAVADO no modal de propósito (ver
-- ModalBaixaPedido.tsx): impedia trocar por baixo o código de uma peça que
-- já saiu. A trava continua. O que muda é que agora existe uma saída oficial,
-- com trilha, para desfazer a designação.
--
--   1) sup_est_desvincular      — RPC nova.
--   2) sup_est_baixar           — reprodução fiel de
--      20260930000080_suprimentos_baixar_reserva_aware.sql:38, com UMA
--      edição marcada: o histórico do pedido passa a dizer QUAL código foi
--      designado, e com qual CA. Sem isso, "desvinculei o errado e designei o
--      certo" ficaria pela metade no histórico — a remoção diria o código, e
--      a designação só "1 etiqueta(s) baixada(s) do estoque".
--   3) sup_est_resolver_codigos — RPC nova, só leitura: código do produto
--      → de quais lotes sai, com o CA de cada um.
--   4) sup_pedido_ficha_epi     — reprodução fiel de
--      20260930000095_sup_pedido_ficha_epi.sql:36, com UMA edição: o CA passa
--      a vir também do ledger. Era por isso que o CA "não puxava".
--   5) sst_ca_entregue          — reprodução de
--      20260927000001_sst_laudo_epi_ca.sql:246 com a mesma correção: o
--      alerta de CA vencendo passa a ver quem recebeu de lote não zerado.
--
-- 1 e 2 escrevem no histórico no formato campo + valor, o mesmo das edições
-- do pedido (sup_pedido_registrar_edicao, 20260930000037): a tela traduz o
-- nome do campo, e nenhuma ação nova precisa entrar no CHECK de acao.
--
-- Idempotente. ROLLBACK no fim do arquivo.
-- =====================================================================

-- ── 1. sup_est_desvincular ───────────────────────────────────────────
--
-- O vínculo código ↔ item de pedido mora em dois lugares, e a função
-- desfaz o que existir:
--
--   • no LEDGER (sup_estoque_consumo) — lote por quantidade, e também a
--     etiqueta antiga de peça única quando ela saiu pela separação
--     (sup_sep_confirmar grava ledger para os dois tipos);
--   • na PRÓPRIA ETIQUETA — peça única baixada pelo modal, que nunca passou
--     pelo ledger.
--
-- Devolve a quantidade INTEIRA daquele código no item. Desvincular metade
-- não tem caso de uso ("designei o código errado") e reabriria a conta de
-- delta que o ledger já faz.
--
-- Por que os gatilhos de guarda do lote não atrapalham:
--   • sst_ca_guard_baixa (versão de 20260930000018) só olha quando o lote
--     GANHA um pedido_id ou PERDE quantidade — aqui nenhum dos dois;
--   • sup_est_tag_guard_saldo_reservado (20260930000076) só olha quando o
--     saldo CAI — aqui ele só sobe.
--
-- Os campos pedido_id/usado_* do LOTE ficam como estão, igual ao ajuste
-- para menos de sup_est_baixar: no lote eles só dizem "quem zerou", e quem
-- responde "qual pedido levou quanto" é o ledger, que aqui perde a linha.
-- (É também por isso que a Ficha EPI, no bloco 4, deixa de confiar no
-- pedido_item_id do lote.)
--
-- Pedido EM SEPARACAO é recusado pelo mesmo motivo de sup_est_baixar: a
-- separação escreve no ledger de forma aditiva, e mexer nele por fora no
-- meio dela corromperia a conta.

CREATE OR REPLACE FUNCTION public.sup_est_desvincular(
  p_pedido_id uuid, p_pedido_item_id uuid, p_codigo text, p_motivo text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text := public.sup_est_nome_usuario();
  v_motivo text := nullif(btrim(p_motivo), '');
  v_ped    record;
  v_pi     record;
  t        record;
  v_ledger integer;
  v_qtd    integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;

  SELECT p.id, p.pedido_id, p.status INTO v_ped
    FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_ped.status = 'EM SEPARACAO' THEN
    RAISE EXCEPTION 'Pedido % está em separação. Confirme ou libere a separação antes de desvincular.',
      v_ped.pedido_id;
  END IF;

  SELECT pi.id, pi.nome_item INTO v_pi
    FROM public.sup_pedido_item pi
   WHERE pi.id = p_pedido_item_id AND pi.pedido_id = p_pedido_id;
  IF v_pi.id IS NULL THEN RAISE EXCEPTION 'Item não pertence a este pedido'; END IF;

  SELECT tg.id, tg.codigo, tg.tipo, tg.usado, tg.quantidade_massa, tg.tamanho,
         tg.pedido_id, tg.pedido_item_id, tg.ca_numero,
         ei.id AS ei_id, ei.empresa_id
    INTO t
    FROM public.sup_estoque_tag tg
    JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
   WHERE tg.codigo = upper(btrim(p_codigo))
   FOR UPDATE OF tg;
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'Código % não existe no estoque', upper(btrim(p_codigo));
  END IF;

  SELECT cs.quantidade INTO v_ledger
    FROM public.sup_estoque_consumo cs
   WHERE cs.codigo = t.codigo AND cs.pedido_item_id = v_pi.id
   FOR UPDATE;

  IF t.tipo = 'massa' THEN
    IF COALESCE(v_ledger, 0) <= 0 THEN
      RAISE EXCEPTION 'Código % não está designado a "%" neste pedido', t.codigo, v_pi.nome_item;
    END IF;
    v_qtd := v_ledger;

    UPDATE public.sup_estoque_tag tg
       SET quantidade_massa = COALESCE(tg.quantidade_massa, 0) + v_qtd,
           usado            = false
     WHERE tg.id = t.id;
  ELSE
    -- Peça única: quem prova que ela está com ESTE item é a própria
    -- etiqueta. Se o ledger apontasse para cá com a peça em outro pedido,
    -- devolvê-la ao estoque a tiraria de quem está com ela de verdade.
    IF NOT (t.usado AND t.pedido_id = p_pedido_id AND t.pedido_item_id = v_pi.id) THEN
      RAISE EXCEPTION 'Código % não está designado a "%" neste pedido', t.codigo, v_pi.nome_item;
    END IF;
    v_qtd := 1;

    UPDATE public.sup_estoque_tag tg
       SET usado = false, pedido_id = NULL, pedido_item_id = NULL,
           usado_em = NULL, usado_por = NULL, usado_por_nome = NULL
     WHERE tg.id = t.id;
  END IF;

  DELETE FROM public.sup_estoque_consumo cs
   WHERE cs.codigo = t.codigo AND cs.pedido_item_id = v_pi.id;

  -- Trilha do MATERIAL: aparece em "Últimas movimentações" do estoque.
  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
     pedido_id, pedido_item_id, usuario_id, usuario_nome, observacao)
  VALUES (t.empresa_id, t.ei_id, t.codigo, 'devolucao', v_qtd, t.tamanho,
          p_pedido_id, v_pi.id, v_uid, v_nome,
          format('Designação desfeita no pedido %s', v_ped.pedido_id)
            || COALESCE(' — ' || v_motivo, ''));

  -- Trilha do PEDIDO: aparece no botão "Histórico".
  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_novo, campo, valor_anterior, observacao,
     alterado_por, alterado_por_nome)
  VALUES (p_pedido_id, 'EDITADO', v_ped.status, 'estoque_desvinculado',
          format('%s: %s (%s un.%s)', v_pi.nome_item, t.codigo, v_qtd,
                 COALESCE(', CA ' || nullif(btrim(t.ca_numero), ''), '')),
          CASE WHEN v_qtd = 1 THEN '1 unidade voltou ao estoque.'
               ELSE format('%s unidades voltaram ao estoque.', v_qtd) END
            || COALESCE(' Motivo: ' || v_motivo, ''),
          v_uid, v_nome);

  RETURN jsonb_build_object('codigo', t.codigo, 'quantidade', v_qtd);
END $fn$;

REVOKE ALL ON FUNCTION public.sup_est_desvincular(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_desvincular(uuid, uuid, text, text) TO authenticated;

-- ── 2. sup_est_baixar ────────────────────────────────────────────────
-- Reprodução fiel de 20260930000080:38. Edições marcadas com "EDIÇÃO 0114":
--   • v_desc junta "ITEM: CÓDIGO (N un., CA X)" de cada baixa que passou;
--   • a linha de histórico da baixa deixa de ser o ELSIF "N etiqueta(s)
--     baixada(s)" — que só aparecia quando o status NÃO mudava — e vira uma
--     linha própria, sempre que algo foi baixado, com os códigos.

CREATE OR REPLACE FUNCTION public.sup_est_baixar(p_pedido_id uuid, p_status text, p_observacao text, p_baixas jsonb, p_envio jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_nome      text := public.sup_est_nome_usuario();
  v_ped       record;
  b           jsonb;
  v_ok        int := 0;
  v_tent      int := 0;
  v_rej       jsonb := '[]'::jsonb;
  t           record;
  v_pi        record;
  v_existente int;
  v_delta     int;
  v_desejada  int;
  v_novo      int;
  v_mudou_st  boolean;
  v_tipo_envio text := upper(nullif(btrim(p_envio->>'tipo'), ''));
  v_rastreio   text := nullif(btrim(p_envio->>'rastreio'), '');
  v_mudou_envio boolean;
  v_res_outros int;
  v_desc      text[] := ARRAY[]::text[];   -- EDIÇÃO 0114
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;

  SELECT * INTO v_ped FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

  -- Pedido EM SEPARACAO sai pelas RPCs sup_sep_*, não por aqui.
  --
  -- O motivo é real, não estético: esta função grava sup_estoque_consumo
  -- com o total ABSOLUTO (SET quantidade = excluded.quantidade), enquanto
  -- sup_sep_confirmar grava ADITIVO. Os dois caminhos sobre a mesma chave
  -- (codigo, pedido_item_id) se sobrescrevem em silêncio e corrompem o
  -- ledger. O modal antigo volta a valer quando o pedido chega em
  -- AGUARDANDO ENVIO.
  IF v_ped.status = 'EM SEPARACAO' THEN
    RAISE EXCEPTION 'Pedido % está em separação. Confirme ou libere a separação antes de baixar por aqui.',
      v_ped.pedido_id;
  END IF;

  -- A guarda precisa estar no banco: despacho também pode acontecer por
  -- script ou SQL Editor, e a tela não é uma fronteira de integridade.
  IF p_status = 'DESPACHADO' THEN
    IF v_tipo_envio IS NULL OR v_tipo_envio NOT IN ('SUPERVISOR', 'CORREIO') THEN
      RAISE EXCEPTION 'Informe o tipo de envio para despachar o pedido';
    END IF;
    IF v_tipo_envio = 'CORREIO' AND v_rastreio IS NULL THEN
      RAISE EXCEPTION 'Informe o ID de rastreio dos Correios';
    END IF;
  END IF;

  FOR b IN SELECT * FROM jsonb_array_elements(COALESCE(p_baixas, '[]'::jsonb)) LOOP
    v_tent := v_tent + 1;

    SELECT pi.id, pi.item_id, pi.nome_item INTO v_pi
      FROM public.sup_pedido_item pi
     WHERE pi.id = (b->>'pedido_item_id')::uuid AND pi.pedido_id = p_pedido_id;
    IF v_pi.id IS NULL THEN
      v_rej := v_rej || jsonb_build_object('codigo', b->>'codigo',
                 'motivo', 'Item não pertence a este pedido');
      CONTINUE;
    END IF;

    SELECT tg.*, ei.sup_item_id, ei.id AS ei_id, ei.empresa_id, i.nome AS material
      INTO t
      FROM public.sup_estoque_tag tg
      JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
      JOIN public.sup_item i ON i.id = ei.sup_item_id
     WHERE tg.codigo = upper(trim(b->>'codigo'))
     FOR UPDATE OF tg;

    IF t.id IS NULL THEN
      v_rej := v_rej || jsonb_build_object('codigo', b->>'codigo',
                 'motivo', 'Não existe no estoque');
      CONTINUE;
    END IF;

    IF t.sup_item_id <> v_pi.item_id THEN
      v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                 'motivo', format('Etiqueta é de "%s", e o pedido é de "%s"', t.material, v_pi.nome_item));
      CONTINUE;
    END IF;

    IF t.tipo = 'unico' THEN
      IF t.usado AND t.pedido_id IS DISTINCT FROM p_pedido_id THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', format('Já utilizada no pedido %s',
                     COALESCE((SELECT p2.pedido_id FROM public.sup_pedido p2 WHERE p2.id = t.pedido_id), '—')));
        CONTINUE;
      END IF;

      IF EXISTS (SELECT 1 FROM public.sup_estoque_reserva rr
                  WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'
                    AND rr.pedido_item_id <> v_pi.id) THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', 'Peça reservada para outro pedido em separação');
        CONTINUE;
      END IF;

      UPDATE public.sup_estoque_tag tg
         SET usado = true, pedido_id = p_pedido_id, pedido_item_id = v_pi.id,
             usado_em = now(), usado_por = v_uid, usado_por_nome = v_nome
       WHERE tg.id = t.id;

      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         pedido_id, pedido_item_id, usuario_id, usuario_nome)
      VALUES (t.empresa_id, t.ei_id, t.codigo, 'saida', 1, t.tamanho,
              p_pedido_id, v_pi.id, v_uid, v_nome);
      v_ok := v_ok + 1;
      -- EDIÇÃO 0114
      v_desc := v_desc || format('%s: %s (1 un.%s)', v_pi.nome_item, t.codigo,
                                 COALESCE(', CA ' || nullif(btrim(t.ca_numero), ''), ''));
    ELSE
      v_desejada := GREATEST(COALESCE((b->>'quantidade')::int, 1), 0);

      SELECT COALESCE(cs.quantidade, 0) INTO v_existente
        FROM public.sup_estoque_consumo cs
       WHERE cs.codigo = t.codigo AND cs.pedido_item_id = v_pi.id;
      v_existente := COALESCE(v_existente, 0);
      v_delta := v_desejada - v_existente;

      IF v_delta = 0 THEN CONTINUE; END IF;

      IF v_delta > 0 AND COALESCE(t.quantidade_massa, 0) <= 0 THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo, 'motivo', 'Etiqueta esgotada');
        CONTINUE;
      END IF;
      -- Consulta SEPARADA e já sob o lock da etiqueta: subquery de outra
      -- tabela dentro do WHERE que trava não é reavaliada pelo EvalPlanQual.
      SELECT COALESCE(SUM(rr.quantidade), 0) INTO v_res_outros
        FROM public.sup_estoque_reserva rr
       WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'
         AND rr.pedido_item_id <> v_pi.id;

      IF v_delta > COALESCE(t.quantidade_massa, 0) - v_res_outros THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', CASE WHEN v_res_outros > 0
                     THEN format('Quantidade adicional (%s) maior que a livre (%s): %s unidade(s) reservada(s) para outro pedido em separação',
                                 v_delta, COALESCE(t.quantidade_massa, 0) - v_res_outros, v_res_outros)
                     ELSE format('Quantidade adicional (%s) maior que a disponível (%s)',
                                 v_delta, COALESCE(t.quantidade_massa, 0)) END);
        CONTINUE;
      END IF;

      v_novo := COALESCE(t.quantidade_massa, 0) - v_delta;
      UPDATE public.sup_estoque_tag tg
         SET quantidade_massa = GREATEST(v_novo, 0),
             usado = (v_novo <= 0),
             pedido_id = CASE WHEN v_novo <= 0 THEN p_pedido_id ELSE tg.pedido_id END,
             pedido_item_id = CASE WHEN v_novo <= 0 THEN v_pi.id ELSE tg.pedido_item_id END,
             usado_em = CASE WHEN v_novo <= 0 THEN now() ELSE tg.usado_em END,
             usado_por = CASE WHEN v_novo <= 0 THEN v_uid ELSE tg.usado_por END,
             usado_por_nome = CASE WHEN v_novo <= 0 THEN v_nome ELSE tg.usado_por_nome END
       WHERE tg.id = t.id;

      IF v_desejada = 0 THEN
        DELETE FROM public.sup_estoque_consumo cs
         WHERE cs.codigo = t.codigo AND cs.pedido_item_id = v_pi.id;
      ELSE
        INSERT INTO public.sup_estoque_consumo
          (codigo, item_estoque_id, pedido_id, pedido_item_id, quantidade,
           consumido_por, consumido_por_nome)
        VALUES (t.codigo, t.ei_id, p_pedido_id, v_pi.id, v_desejada, v_uid, v_nome)
        ON CONFLICT (codigo, pedido_item_id) DO UPDATE
          SET quantidade = excluded.quantidade, consumido_em = now(),
              consumido_por = excluded.consumido_por,
              consumido_por_nome = excluded.consumido_por_nome;
      END IF;

      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         pedido_id, pedido_item_id, usuario_id, usuario_nome, observacao)
      VALUES (t.empresa_id, t.ei_id, t.codigo,
              CASE WHEN v_delta > 0 THEN 'saida' ELSE 'devolucao' END,
              abs(v_delta), t.tamanho, p_pedido_id, v_pi.id, v_uid, v_nome,
              format('Ajuste de %s para %s', v_existente, v_desejada));
      v_ok := v_ok + 1;
      -- EDIÇÃO 0114: o total do código no item, que é o que o operador vê.
      v_desc := v_desc || CASE WHEN v_desejada = 0
                             THEN format('%s: %s (desfeito)', v_pi.nome_item, t.codigo)
                             ELSE format('%s: %s (%s un.%s)', v_pi.nome_item, t.codigo, v_desejada,
                                         COALESCE(', CA ' || nullif(btrim(t.ca_numero), ''), '')) END;
    END IF;
  END LOOP;

  IF v_tent > 0 AND v_ok = 0 AND jsonb_array_length(v_rej) > 0 THEN
    RAISE EXCEPTION 'Nenhuma etiqueta pôde ser baixada: %',
      (SELECT string_agg(x->>'motivo', '; ') FROM jsonb_array_elements(v_rej) x);
  END IF;

  v_mudou_st := p_status IS NOT NULL AND p_status <> v_ped.status;
  v_mudou_envio := p_envio IS NOT NULL AND (
    v_tipo_envio IS DISTINCT FROM v_ped.envio_tipo
    OR v_rastreio IS DISTINCT FROM v_ped.envio_rastreio
  );

  IF v_mudou_st
     OR COALESCE(p_observacao, '') IS DISTINCT FROM COALESCE(v_ped.observacao, '')
     OR v_mudou_envio THEN
    UPDATE public.sup_pedido p
       SET status = COALESCE(p_status, p.status),
           observacao = nullif(p_observacao, ''),
           envio_tipo = CASE WHEN p_envio IS NULL THEN p.envio_tipo ELSE v_tipo_envio END,
           envio_rastreio = CASE WHEN p_envio IS NULL THEN p.envio_rastreio ELSE v_rastreio END
     WHERE p.id = p_pedido_id;

    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id,
            CASE WHEN NOT v_mudou_st THEN 'EDITADO'
                 WHEN p_status = 'CANCELADO' THEN 'CANCELADO' ELSE 'STATUS' END,
            CASE WHEN v_mudou_st THEN v_ped.status END,
            COALESCE(p_status, v_ped.status), nullif(p_observacao, ''), v_uid, v_nome);
  END IF;

  -- EDIÇÃO 0114: era um ELSIF depois do bloco acima, com o texto
  -- "N etiqueta(s) baixada(s) do estoque" — sem código, e sumia quando o
  -- status mudava na mesma chamada. Agora é uma linha própria, com os
  -- códigos, para a troca "desvinculei o errado, designei o certo" ficar
  -- inteira no histórico do pedido.
  IF v_ok > 0 THEN
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_novo, campo, valor_novo, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id, 'EDITADO', COALESCE(p_status, v_ped.status), 'estoque_designado',
            array_to_string(v_desc, ' · '), v_uid, v_nome);
  END IF;

  RETURN jsonb_build_object('baixadas', v_ok, 'rejeitadas', v_rej);
END $fn$;

REVOKE ALL ON FUNCTION public.sup_est_baixar(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_baixar(uuid, text, text, jsonb, jsonb) TO authenticated;

-- ── 3. sup_est_resolver_codigos ──────────────────────────────────────
--
-- O modal manda as linhas que o operador bipou — [{pedido_item_id, codigo,
-- quantidade}] — e recebe, na mesma ordem, o que cada código é:
--
--   'lote'          código de lote ou etiqueta antiga: segue como sempre foi.
--                   Tem precedência de propósito — há rótulo antigo colado na
--                   peça, e o modal sempre aceitou esses códigos;
--   'produto'       código do produto (sup_item.codigo, os 7 dígitos do
--                   ajuste 7) ou o EAN do fabricante, igual a
--                   sup_item_por_codigo. Vem com os lotes de onde sair e o CA
--                   de cada um — é esse o CA "que puxa do item";
--   'outro_produto' código de produto de OUTRO material;
--   'desconhecido'  nada com esse código.
--
-- A escolha dos lotes é a da separação (sup_sep_sugerir, 20260930000079:92)
-- e de sup_est_baixar_quantidade: CA vencendo primeiro, depois a entrada mais
-- antiga; livre = físico menos reserva ATIVA; lote em contagem rotativa
-- aberta fica de fora. Uma diferença deliberada: lote de EPI com CA
-- BLOQUEADO (sst_ca_bloqueio) é PULADO, não sugerido com alerta. Na separação
-- quem escolhe é uma pessoa, olhando; aqui a escolha é automática, e o
-- gatilho sst_ca_guard_baixa recusaria esse lote no confirmar, derrubando a
-- baixa inteira. Como a ordem põe o CA mais velho primeiro, sem o pulo o
-- lote vencido seria justamente o primeiro escolhido.
--
-- SÓ LEITURA. Quem baixa continua sendo sup_est_baixar, que reconfere tudo
-- sob lock: se outra pessoa levar o lote entre a consulta e o Confirmar, o
-- código volta recusado com o motivo, como já acontecia.

CREATE OR REPLACE FUNCTION public.sup_est_resolver_codigos(p_linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_out       jsonb := '[]'::jsonb;
  l           jsonb;
  v_cod       text;
  v_falta     integer;
  v_pegar     integer;
  v_bloqueadas integer;
  v_lotes     jsonb;
  v_pi        record;
  v_prod      record;
  t           record;
  v_bloq      record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_linhas, '[]'::jsonb)) LOOP
    v_cod := upper(btrim(COALESCE(l->>'codigo', '')));

    IF v_cod = '' THEN
      v_out := v_out || jsonb_build_object('codigo', v_cod, 'tipo', 'desconhecido');
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.sup_estoque_tag tg WHERE tg.codigo = v_cod) THEN
      v_out := v_out || jsonb_build_object('codigo', v_cod, 'tipo', 'lote');
      CONTINUE;
    END IF;

    -- SELECT INTO sem linha zera o record: não sobra nada da volta anterior.
    SELECT pi.id, pi.item_id, pi.tamanho INTO v_pi
      FROM public.sup_pedido_item pi
     WHERE pi.id = (l->>'pedido_item_id')::uuid;

    -- O EAN pode se repetir entre cadastros; o do próprio item ganha.
    SELECT i.id, i.codigo, i.nome, i.tipo INTO v_prod
      FROM public.sup_item i
     WHERE i.codigo = v_cod OR i.codigo_barras = v_cod
     ORDER BY (i.id = v_pi.item_id) DESC NULLS LAST, (i.codigo = v_cod) DESC
     LIMIT 1;

    IF v_prod.id IS NULL THEN
      v_out := v_out || jsonb_build_object('codigo', v_cod, 'tipo', 'desconhecido');
      CONTINUE;
    END IF;
    IF v_pi.item_id IS DISTINCT FROM v_prod.id THEN
      v_out := v_out || jsonb_build_object('codigo', v_cod, 'tipo', 'outro_produto',
                 'produto', jsonb_build_object('codigo', v_prod.codigo, 'nome', v_prod.nome));
      CONTINUE;
    END IF;

    v_falta := CASE WHEN COALESCE(l->>'quantidade', '') ~ '^\d+$'
                    THEN GREATEST((l->>'quantidade')::int, 1) ELSE 1 END;
    v_bloqueadas := 0;
    v_lotes := '[]'::jsonb;

    FOR t IN
      SELECT tg.codigo, tg.ca_numero, tg.ca_validade,
             (CASE WHEN tg.tipo = 'massa' THEN COALESCE(tg.quantidade_massa, 0) ELSE 1 END)
             - COALESCE((SELECT SUM(rr.quantidade) FROM public.sup_estoque_reserva rr
                          WHERE rr.tag_id = tg.id AND rr.situacao = 'ATIVA'), 0) AS livre
        FROM public.sup_estoque_tag tg
        JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
       WHERE ei.sup_item_id = v_prod.id
         AND NOT tg.usado
         AND (v_pi.tamanho IS NULL OR tg.tamanho IS NOT DISTINCT FROM v_pi.tamanho)
         AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_contagem_fila cf
                          WHERE cf.tag_id = tg.id AND cf.situacao = 'ABERTA')
       ORDER BY tg.ca_validade NULLS LAST, tg.created_at, tg.id
    LOOP
      EXIT WHEN v_falta <= 0;
      CONTINUE WHEN t.livre <= 0;

      IF v_prod.tipo = 'epi' THEN
        SELECT * INTO v_bloq FROM public.sst_ca_bloqueio(t.ca_numero, t.ca_validade);
        IF v_bloq.bloqueado THEN
          v_bloqueadas := v_bloqueadas + t.livre;
          CONTINUE;
        END IF;
      END IF;

      v_pegar := LEAST(v_falta, t.livre);
      v_falta := v_falta - v_pegar;
      v_lotes := v_lotes || jsonb_build_object(
        'codigo', t.codigo, 'quantidade', v_pegar,
        'ca_numero', nullif(btrim(t.ca_numero), ''), 'ca_validade', t.ca_validade);
    END LOOP;

    v_out := v_out || jsonb_build_object(
      'codigo', v_cod, 'tipo', 'produto',
      'produto', jsonb_build_object('codigo', v_prod.codigo, 'nome', v_prod.nome),
      'lotes', v_lotes, 'faltam', v_falta, 'bloqueadas', v_bloqueadas);
  END LOOP;

  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.sup_est_resolver_codigos(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_resolver_codigos(jsonb) TO authenticated;

-- ── 4. sup_pedido_ficha_epi ──────────────────────────────────────────
-- Reprodução fiel de 20260930000095:36. Uma edição, marcada "EDIÇÃO 0114",
-- na coluna C.A. dos itens.
--
-- POR QUE O CA NÃO "PUXAVA": a ficha procurava o CA em
-- sup_estoque_tag.pedido_item_id = item. Só que LOTE só recebe
-- pedido_item_id quando ZERA — é a mesma armadilha que 20260930000018 §5 já
-- documentou para o bloqueio de CA. Uma jaqueta tirada de um lote de 50 não
-- deixava rastro no lote, e a ficha saía com o C.A. em branco. Com a entrada
-- por quantidade (ajuste 7), esse virou o caso normal.
--
-- Agora o CA vem de dois lugares, sem repetir:
--   • peça única ainda com o item (a própria etiqueta prova o vínculo);
--   • o LEDGER (sup_estoque_consumo), que sabe quanto de cada lote foi para
--     cada item, zerando ou não.
-- O ramo da etiqueta exige peça única AINDA USADA: lote zerado por este item
-- e depois desvinculado (bloco 1) guarda o pedido_item_id antigo, e não pode
-- continuar imprimindo o CA de uma peça que voltou ao estoque.

CREATE OR REPLACE FUNCTION public.sup_pedido_ficha_epi(p_pedido_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_contrato_id uuid;
  v_empregado   bigint;
  v_matricula   text;
  v_nome        text;
  v_empresa     jsonb;
  v_contrato    jsonb;
  v_itens       jsonb;
  v_achou       boolean := false;
  v_cadastro    text;
  v_admissao    text;
  v_situacao    text;
  v_cargo       text;
  v_local       text;
  v_afastamento text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver pedidos de materiais' USING ERRCODE = '42501';
  END IF;

  SELECT p.contrato_id,
         p.colaborador_empregado_id,
         nullif(btrim(p.matricula_colaborador), ''),
         nullif(btrim(p.nome_colaborador), '')
    INTO v_contrato_id, v_empregado, v_matricula, v_nome
    FROM public.sup_pedido p
   WHERE p.id = p_pedido_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- ── Cabeçalho: empresa dona do contrato ─────────────────────────────
  SELECT jsonb_build_object('razao_social', e.razao_social, 'cnpj', e.cnpj, 'codigo', e.codigo),
         jsonb_build_object('nome', c.nome, 'cliente', c.cliente)
    INTO v_empresa, v_contrato
    FROM public.contratos c
    LEFT JOIN public.empresas e ON e.id = c.empresa_id
   WHERE c.id = v_contrato_id;

  -- ── Colaborador em EMPREGADOS (a → b → c, ver cabeçalho) ────────────
  IF v_empregado IS NOT NULL THEN
    SELECT e."Cadastro"::text, e."Admissão"::text, e."Situação"::text,
           e."Título do Cargo"::text, e."Descrição do Local"::text, e."Data Afastamento"::text
      INTO v_cadastro, v_admissao, v_situacao, v_cargo, v_local, v_afastamento
      FROM public."EMPREGADOS" e
     WHERE e."ID"::bigint = v_empregado;
    v_achou := FOUND;
  END IF;

  IF NOT v_achou AND v_matricula IS NOT NULL AND v_nome IS NOT NULL THEN
    SELECT e."Cadastro"::text, e."Admissão"::text, e."Situação"::text,
           e."Título do Cargo"::text, e."Descrição do Local"::text, e."Data Afastamento"::text
      INTO v_cadastro, v_admissao, v_situacao, v_cargo, v_local, v_afastamento
      FROM public."EMPREGADOS" e
     WHERE btrim(e."Cadastro"::text) = v_matricula
       AND public.sup_norm_nome(e."Nome") = public.sup_norm_nome(v_nome)
     -- Readmissão: a mesma pessoa pode ter a linha antiga (demitida) e a
     -- atual. Vale a ativa; entre iguais, a admissão mais recente.
     ORDER BY (e."Situação" = 'Demitido') NULLS LAST,
              public.sup_norm_data(e."Admissão"::text) DESC NULLS LAST
     LIMIT 1;
    v_achou := FOUND;
  END IF;

  IF NOT v_achou AND v_nome IS NOT NULL THEN
    SELECT x.cadastro, x.admissao, x.situacao, x.cargo, x.local, x.afastamento
      INTO v_cadastro, v_admissao, v_situacao, v_cargo, v_local, v_afastamento
      FROM (
        SELECT e."Cadastro"::text           AS cadastro,
               e."Admissão"::text           AS admissao,
               e."Situação"::text           AS situacao,
               e."Título do Cargo"::text    AS cargo,
               e."Descrição do Local"::text AS local,
               e."Data Afastamento"::text   AS afastamento,
               count(*) OVER ()             AS homonimos
          FROM public."EMPREGADOS" e
         WHERE e."Situação" <> 'Demitido'
           AND public.sup_norm_nome(e."Nome") = public.sup_norm_nome(v_nome)
      ) x
     WHERE x.homonimos = 1;
    v_achou := FOUND;
  END IF;

  -- ── Itens, com o C.A. das etiquetas que saíram para cada um ─────────
  -- O C.A. mora na etiqueta física (sup_estoque_tag.ca_numero, SIS-2026-0222)
  -- porque remessas do mesmo material podem ter certificados diferentes.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'nome_item',  i.nome_item,
           'tamanho',    i.tamanho,
           'quantidade', i.quantidade,
           'litros',     i.litros,
           'ordem',      i.ordem,
           -- EDIÇÃO 0114: peça única ainda com o item + tudo o que o ledger
           -- diz que saiu para ele (lote consumido em parte incluído).
           'ca', (SELECT string_agg(DISTINCT x.ca, ' / ')
                    FROM (
                      SELECT btrim(t.ca_numero) AS ca
                        FROM public.sup_estoque_tag t
                       WHERE t.pedido_item_id = i.id
                         AND t.tipo = 'unico'
                         AND t.usado
                      UNION
                      SELECT btrim(t.ca_numero)
                        FROM public.sup_estoque_consumo c
                        JOIN public.sup_estoque_tag t ON t.codigo = c.codigo
                       WHERE c.pedido_item_id = i.id
                    ) x
                   WHERE nullif(x.ca, '') IS NOT NULL)
         ) ORDER BY i.ordem), '[]'::jsonb)
    INTO v_itens
    FROM public.sup_pedido_item i
   WHERE i.pedido_id = p_pedido_id;

  RETURN jsonb_build_object(
    'empresa',  v_empresa,
    'contrato', v_contrato,
    'colaborador', CASE WHEN v_achou THEN jsonb_build_object(
        'matricula', nullif(btrim(v_cadastro), ''),
        'admissao',  public.sup_norm_data(v_admissao),
        'cargo',     nullif(btrim(v_cargo), ''),
        'local',     nullif(btrim(v_local), ''),
        'situacao',  v_situacao,
        -- "Data Afastamento" também é preenchida em férias e atestado; só
        -- vira data de demissão quando a situação é de fato Demitido.
        'demissao',  CASE WHEN v_situacao = 'Demitido' THEN public.sup_norm_data(v_afastamento) END
      ) END,
    'itens', v_itens
  );
END $$;

REVOKE ALL ON FUNCTION public.sup_pedido_ficha_epi(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sup_pedido_ficha_epi(uuid) TO authenticated;

COMMENT ON FUNCTION public.sup_pedido_ficha_epi(uuid) IS
  'Dados da Ficha de Controle e Entrega de EPI de um pedido: empresa do contrato, colaborador (campos fixos de EMPREGADOS) e itens com C.A.';

-- ── 5. sst_ca_entregue ───────────────────────────────────────────────
-- Reprodução de 20260927000001_sst_laudo_epi_ca.sql:246 — a aba "Com
-- colaboradores" da tela Controle de CA —, com a MESMA correção do bloco 4.
--
-- A versão anterior só enxergava etiqueta com `usado AND pedido_id`: peça
-- única, ou lote que ZEROU — e, nesse caso, atribuído só ao pedido que
-- zerou. Quem levou 1 jaqueta de um lote de 50 não aparecia no alerta de CA
-- vencendo, que é exatamente o que o 0222 pediu: "a botina do Eduardo vence
-- daqui a seis meses, quando vencer como é que eu vou saber pra trocar?".
--
-- Agora são duas fontes, sem repetir:
--   • o LEDGER: tudo o que saiu de cada lote para cada pedido, zerando ou não;
--   • a etiqueta com pedido_id, só quando o ledger não cobre o mesmo par
--     código + pedido — peça única baixada pelo modal, e lote antigo zerado
--     sem linha no ledger, continuam aparecendo como antes.
-- É o mesmo desempate de sup_est_tags_do_pedido (20260820000002:403).
--
-- O mesmo lote pode agora sair em mais de uma linha, uma por colaborador que
-- recebeu dele. Por isso a tela deixou de usar o código como chave da linha.
--
-- Só leitura, e nada sai sozinho daqui: a função alimenta apenas a tela
-- ControleCa.tsx — o worker/ não a chama, então não há WhatsApp nem e-mail
-- novo disparado por esta correção.

CREATE OR REPLACE FUNCTION public.sst_ca_entregue(p_dias_alerta integer DEFAULT 60)
RETURNS TABLE (
  colaborador text, matricula text, contrato text,
  material text, codigo text, ca_numero text, ca_validade date,
  situacao text, dias_restantes integer, entregue_em timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH entregas AS (
    SELECT t.id AS tag_id, t.pedido_id, t.usado_em AS entregue_em
      FROM public.sup_estoque_tag t
     WHERE t.usado
       AND t.pedido_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_consumo c
                        WHERE c.codigo = t.codigo AND c.pedido_id = t.pedido_id)
    UNION ALL
    SELECT t.id, c.pedido_id, c.consumido_em
      FROM public.sup_estoque_consumo c
      JOIN public.sup_estoque_tag t ON t.codigo = c.codigo
  )
  SELECT p.nome_colaborador, p.matricula_colaborador, p.contrato_nome,
         i.nome, t.codigo, t.ca_numero, t.ca_validade,
         public.sst_situacao_ca(t.ca_validade, p_dias_alerta),
         (t.ca_validade - CURRENT_DATE)::integer, e.entregue_em
    FROM entregas e
    JOIN public.sup_estoque_tag t   ON t.id  = e.tag_id
    JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
    JOIN public.sup_item i          ON i.id  = ei.sup_item_id
    JOIN public.sup_pedido p        ON p.id  = e.pedido_id
   WHERE i.tipo = 'epi'
     AND t.ca_validade IS NOT NULL
     AND t.ca_validade <= CURRENT_DATE + p_dias_alerta
     AND (public.can_access(auth.uid(), 'sst_ca', 'visualizar')
          OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar'))
   ORDER BY t.ca_validade;
$$;

REVOKE ALL ON FUNCTION public.sst_ca_entregue(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ca_entregue(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.sup_est_desvincular(uuid, uuid, text, text);
--   DROP FUNCTION IF EXISTS public.sup_est_resolver_codigos(jsonb);
--   sup_est_baixar: recriar a partir de
--     20260930000080_suprimentos_baixar_reserva_aware.sql:38
--   sup_pedido_ficha_epi: recriar a partir de
--     20260930000095_sup_pedido_ficha_epi.sql:36
--   sst_ca_entregue: recriar a partir de
--     20260927000001_sst_laudo_epi_ca.sql:246
--   As linhas de histórico com campo 'estoque_designado'/'estoque_desvinculado'
--   já gravadas podem ficar: sem o rótulo, a tela mostra o nome cru do campo.
--   NOTIFY pgrst, 'reload schema';
