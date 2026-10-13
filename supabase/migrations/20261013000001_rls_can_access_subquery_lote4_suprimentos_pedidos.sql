-- ============================================================================
-- RLS: can_access() + auth.uid() em subquery escalar — lote 4 (as com EXISTS)
-- Alvo: /app/suprimentos/pedidos-materiais, que estourava statement_timeout
-- ============================================================================
--
-- Fecha a lacuna que as 20260930000265 (mz_*), 267 (puras) e 268 (mistas)
-- deixaram ABERTA DE PROPOSITO: o lote 2 escreveu "as com EXISTS ficam para
-- lote proprio, com cuidado extra". Este e esse lote, e sao justamente as
-- policies da fila de Pedidos de Materiais.
--
-- O QUE ESTAVA ACONTECENDO (13/10/2026)
-- A tela abria em 4 a 8 segundos e, com mais de um usuario junto, devolvia
-- `canceling statement due to statement timeout` — o role `authenticated` tem
-- statement_timeout = 8s. Em pg_stat_statements, medido na producao:
--   SELECT da lista (sup_pedido + embeds):  media 4.186 ms, MAXIMO 7.941 ms
--   SELECT da view sup_pedido_situacao:     media 2.234 ms, MAXIMO 7.643 ms
-- O maximo encostado em 8s e o timeout: nao era pico esporadico, era o teto.
--
-- A CAUSA
-- can_access() e STABLE, mas escrita CRUA na policy ela e avaliada UMA VEZ POR
-- LINHA. Medido como role authenticated, mesma sessao, 13/10/2026:
--   sup_estoque_consumo   6.656 linhas  policy JA envelopada   ->     37 ms
--   sup_estoque_item        913 linhas  can_access cru         ->    278 ms
--   sup_pedido            2.606 linhas  can_access cru         ->    758 ms
--   sup_estoque_tag      13.305 linhas  herda sup_estoque_item ->    318 ms
--   sup_pedido_item       8.819 linhas  herda sup_pedido       ->  1.494 ms
-- Repare no controle: a tabela envelopada tem 7x mais linhas que sup_pedido e
-- responde 20x mais rapido. O custo cru e linear no numero de linhas
-- (~0,29 ms por linha), porque e uma chamada de funcao por linha.
--
-- O efeito se MULTIPLICA aqui porque sup_pedido_item e sup_pedido_comprovacao
-- tem policy `EXISTS (SELECT 1 FROM sup_pedido p WHERE p.id = ...)`: elas nao
-- checam permissao propria, elas DELEGAM para a RLS de sup_pedido. No plano
-- (EXPLAIN ANALYZE, producao) isso aparece como
--   Seq Scan on sup_pedido p  (actual time=15.155..3026.900 rows=2606)
-- dentro da view sup_pedido_situacao. Tres segundos de um unico no, so
-- chamando can_access 2.606 vezes. A tela faz esse embed em UMA consulta
-- (sup_pedido + sup_romaneio + sup_pedido_item + sup_pedido_comprovacao) e
-- ainda dispara 6 fatias da view em paralelo, todas pagando o mesmo pedagio e
-- disputando as 2 vCPUs da instancia.
--
-- POR QUE E SEGURO (nada muda de acesso)
-- `X` e `(select X)` devolvem o MESMO booleano para expressao STABLE — muda so
-- quantas vezes e calculada, nao a decisao. can_access e auth.uid() sao as
-- duas STABLE (pg_proc.provolatile = 's'). O auth.uid() de DENTRO do
-- can_access nao e tocado. Nenhuma policy e removida, nenhuma fica mais
-- permissiva, nenhuma linha de dado e alterada: so o texto do USING.
--
-- Provado por wrap+unwrap na propria producao (13/10/2026): aplicou-se esta
-- migration dentro de uma transacao, leu-se de volta o pg_get_expr das 8
-- policies (USING + WITH CHECK), removeram-se os 20 envelopes `(select ...)`
-- e o texto resultante bate com o original BYTE A BYTE, 0 divergencias.
-- Depois, ROLLBACK — a producao nunca saiu do estado anterior durante o teste.
--
-- AS POLICIES `FOR ALL` TAMBEM PESAM NA LEITURA
-- Isto custou uma rodada de medicao para aparecer: `sup_pedido_item_write`,
-- `sup_estoque_tag_write` e `sup_estoque_item_write` sao `FOR ALL`, e `ALL`
-- INCLUI SELECT. Sendo permissivas, o Postgres as une com OR a policy de
-- SELECT e avalia as DUAS no mesmo scan:
--   Filter: ((ANY (pedido_id = (hashed SubPlan 14).col1))
--         OR (ANY (pedido_id = (hashed SubPlan 28).col1)))
-- Sao dois scans de sup_pedido por leitura de sup_pedido_item. Corrigir so as
-- de SELECT levava sup_pedido_item de 1.494 ms para 1.286 ms — praticamente
-- nada. Com as `FOR ALL` envelopadas tambem, cai para 33 ms. Por isso elas
-- entram aqui, e nao num lote futuro: elas sao parte do caminho de LEITURA.
--
-- RESULTADO MEDIDO (producao, 13/10/2026, transacao com ROLLBACK)
-- A consulta da lista nao foi aproximada: e o texto EXATO que o PostgREST
-- emite, extraido de pg_stat_statements e reexecutado com os parametros reais.
--   consulta real da lista (1.000 linhas + 3 embeds):  3.283 ms ->   116 ms
--   view sup_pedido_situacao (fatia de 500 pedidos):   1.953 ms ->    42 ms
--   sup_pedido                           758 ms ->  24 ms   (piso sem RLS: 22 ms)
--   sup_pedido_item                    1.494 ms ->  33 ms
--   sup_estoque_tag                      318 ms ->  34 ms
--   sup_pedido_comprovacao             1.884 ms ->  27 ms
-- O piso de 22 ms e o tempo de ida e volta de rede ate Sao Paulo: depois da
-- correcao a RLS praticamente nao custa mais nada.
--
-- ESCOPO
-- Somente as policies no caminho de leitura desta tela (as de SELECT e as
-- `FOR ALL`, que o SELECT tambem avalia). Nao se cria nem se remove policy:
-- as 8 ja existiam e seguem com o mesmo nome, mesmo comando, mesmos roles.
-- ============================================================================

-- ─── sup_estoque_item: policy PURA, ficou fora do lote 2 pelo corte de 2.000
-- linhas (tem 913). Mas sup_estoque_tag, 13.305 linhas, DELEGA pra ela. ───────
DROP POLICY IF EXISTS "sup_estoque_item_select" ON public."sup_estoque_item";
CREATE POLICY "sup_estoque_item_select" ON public."sup_estoque_item"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((select can_access(auth.uid(), 'sup_estoque'::text, 'visualizar'::app_acao)));

-- ─── sup_romaneio: pura, 89 linhas. Entra porque e embed da mesma consulta. ──
DROP POLICY IF EXISTS "sup_romaneio_select" ON public."sup_romaneio";
CREATE POLICY "sup_romaneio_select" ON public."sup_romaneio"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((select can_access(auth.uid(), 'sup_romaneio'::text, 'visualizar'::app_acao)) OR (select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'visualizar'::app_acao))));

-- ─── sup_pedido: o no central. 2.606 linhas, e sup_pedido_item (8.819) e
-- sup_pedido_comprovacao (1.440) delegam a decisao pra ca. O EXISTS de
-- sup_ext_sessao continua correlacionado por contrato_id/solicitante_login —
-- so o auth.uid() de dentro dele sai do laco. ────────────────────────────────
DROP POLICY IF EXISTS "sup_pedido_select" ON public."sup_pedido";
CREATE POLICY "sup_pedido_select" ON public."sup_pedido"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'visualizar'::app_acao)) OR (criado_por = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM sup_ext_sessao s
  WHERE ((s.user_id = (select auth.uid())) AND (s.contrato_id = sup_pedido.contrato_id) AND (s.login_informado = sup_pedido.solicitante_login))))));

-- ─── sup_pedido_comprovacao: EXISTS aninhado. O IN (user_empresa) ja era
-- avaliado uma vez (subplan hasheado), mas o can_access e o auth.uid() crus
-- rodavam por linha de sup_pedido varrida. ──────────────────────────────────
DROP POLICY IF EXISTS "sup_pedido_comprovacao_select" ON public."sup_pedido_comprovacao";
CREATE POLICY "sup_pedido_comprovacao_select" ON public."sup_pedido_comprovacao"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sup_pedido p
  WHERE ((p.id = sup_pedido_comprovacao.pedido_id) AND ((p.criado_por = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM sup_ext_sessao s
          WHERE ((s.user_id = (select auth.uid())) AND (s.contrato_id = p.contrato_id) AND (s.login_informado = p.solicitante_login)))) OR ((select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'visualizar'::app_acao)) AND (p.empresa_id IN ( SELECT ue.empresa_id
           FROM user_empresa ue
          WHERE (ue.user_id = (select auth.uid()))))))))));

-- ─── sup_estoque_reserva: 1.953 linhas, alimenta os campos
-- itens_em_separacao / itens_pendentes_compra da view sup_pedido_situacao. ───
DROP POLICY IF EXISTS "sup_estoque_reserva_select" ON public."sup_estoque_reserva";
CREATE POLICY "sup_estoque_reserva_select" ON public."sup_estoque_reserva"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM sup_estoque_item ei
  WHERE (ei.id = sup_estoque_reserva.item_estoque_id))) OR (select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'visualizar'::app_acao)) OR (select can_access(auth.uid(), 'sup_separacao'::text, 'visualizar'::app_acao))));

-- ─── As tres `FOR ALL`. Entram pelo mesmo motivo que as de SELECT: `ALL`
-- inclui SELECT, e sendo permissivas sao avaliadas em TODA leitura. ─────────
DROP POLICY IF EXISTS "sup_estoque_item_write" ON public."sup_estoque_item";
CREATE POLICY "sup_estoque_item_write" ON public."sup_estoque_item"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((select can_access(auth.uid(), 'sup_estoque'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'sup_estoque'::text, 'alterar'::app_acao)));

DROP POLICY IF EXISTS "sup_estoque_tag_write" ON public."sup_estoque_tag";
CREATE POLICY "sup_estoque_tag_write" ON public."sup_estoque_tag"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sup_estoque_item ei
  WHERE ((ei.id = sup_estoque_tag.item_estoque_id) AND (select can_access(auth.uid(), 'sup_estoque'::text, 'alterar'::app_acao))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM sup_estoque_item ei
  WHERE ((ei.id = sup_estoque_tag.item_estoque_id) AND (select can_access(auth.uid(), 'sup_estoque'::text, 'alterar'::app_acao))))));

DROP POLICY IF EXISTS "sup_pedido_item_write" ON public."sup_pedido_item";
CREATE POLICY "sup_pedido_item_write" ON public."sup_pedido_item"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sup_pedido p
  WHERE ((p.id = sup_pedido_item.pedido_id) AND ((select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'alterar'::app_acao)) OR (p.criado_por = (select auth.uid())))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM sup_pedido p
  WHERE ((p.id = sup_pedido_item.pedido_id) AND ((select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'alterar'::app_acao)) OR (p.criado_por = (select auth.uid())))))));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK — devolve o texto ORIGINAL das 8 policies, byte a byte
-- ============================================================================
-- DROP POLICY IF EXISTS "sup_estoque_item_select" ON public."sup_estoque_item";
-- CREATE POLICY "sup_estoque_item_select" ON public."sup_estoque_item"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (can_access(auth.uid(), 'sup_estoque'::text, 'visualizar'::app_acao));
-- DROP POLICY IF EXISTS "sup_romaneio_select" ON public."sup_romaneio";
-- CREATE POLICY "sup_romaneio_select" ON public."sup_romaneio"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING ((can_access(auth.uid(), 'sup_romaneio'::text, 'visualizar'::app_acao) OR can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'visualizar'::app_acao)));
-- DROP POLICY IF EXISTS "sup_pedido_select" ON public."sup_pedido";
-- CREATE POLICY "sup_pedido_select" ON public."sup_pedido"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING ((can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'visualizar'::app_acao) OR (criado_por = auth.uid()) OR (EXISTS ( SELECT 1
--    FROM sup_ext_sessao s
--   WHERE ((s.user_id = auth.uid()) AND (s.contrato_id = sup_pedido.contrato_id) AND (s.login_informado = sup_pedido.solicitante_login))))));
-- DROP POLICY IF EXISTS "sup_pedido_comprovacao_select" ON public."sup_pedido_comprovacao";
-- CREATE POLICY "sup_pedido_comprovacao_select" ON public."sup_pedido_comprovacao"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING ((EXISTS ( SELECT 1
--    FROM sup_pedido p
--   WHERE ((p.id = sup_pedido_comprovacao.pedido_id) AND ((p.criado_por = auth.uid()) OR (EXISTS ( SELECT 1
--            FROM sup_ext_sessao s
--           WHERE ((s.user_id = auth.uid()) AND (s.contrato_id = p.contrato_id) AND (s.login_informado = p.solicitante_login)))) OR (can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'visualizar'::app_acao) AND (p.empresa_id IN ( SELECT ue.empresa_id
--            FROM user_empresa ue
--           WHERE (ue.user_id = auth.uid())))))))));
-- DROP POLICY IF EXISTS "sup_estoque_reserva_select" ON public."sup_estoque_reserva";
-- CREATE POLICY "sup_estoque_reserva_select" ON public."sup_estoque_reserva"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (((EXISTS ( SELECT 1
--    FROM sup_estoque_item ei
--   WHERE (ei.id = sup_estoque_reserva.item_estoque_id))) OR can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'visualizar'::app_acao) OR can_access(auth.uid(), 'sup_separacao'::text, 'visualizar'::app_acao)));
-- DROP POLICY IF EXISTS "sup_estoque_item_write" ON public."sup_estoque_item";
-- CREATE POLICY "sup_estoque_item_write" ON public."sup_estoque_item"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING (can_access(auth.uid(), 'sup_estoque'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'sup_estoque'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "sup_estoque_tag_write" ON public."sup_estoque_tag";
-- CREATE POLICY "sup_estoque_tag_write" ON public."sup_estoque_tag"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING ((EXISTS ( SELECT 1
--    FROM sup_estoque_item ei
--   WHERE ((ei.id = sup_estoque_tag.item_estoque_id) AND can_access(auth.uid(), 'sup_estoque'::text, 'alterar'::app_acao)))))
--   WITH CHECK ((EXISTS ( SELECT 1
--    FROM sup_estoque_item ei
--   WHERE ((ei.id = sup_estoque_tag.item_estoque_id) AND can_access(auth.uid(), 'sup_estoque'::text, 'alterar'::app_acao)))));
-- DROP POLICY IF EXISTS "sup_pedido_item_write" ON public."sup_pedido_item";
-- CREATE POLICY "sup_pedido_item_write" ON public."sup_pedido_item"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING ((EXISTS ( SELECT 1
--    FROM sup_pedido p
--   WHERE ((p.id = sup_pedido_item.pedido_id) AND (can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'alterar'::app_acao) OR (p.criado_por = auth.uid()))))))
--   WITH CHECK ((EXISTS ( SELECT 1
--    FROM sup_pedido p
--   WHERE ((p.id = sup_pedido_item.pedido_id) AND (can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'alterar'::app_acao) OR (p.criado_por = auth.uid()))))));
-- NOTIFY pgrst, 'reload schema';
