-- =====================================================================
-- Suprimentos — estados da separação, parte 2 de 5
--
-- Depende de 20260930000074 (sup_estoque_reserva).
--
-- Acrescenta o estado EM SEPARACAO ao pedido, a view que responde
-- "quanto deste pedido já foi atendido", o primeiro grafo de transição
-- que este módulo já teve, e o menu da tela do estoquista.
--
-- POR QUE 'EM SEPARACAO' É PERSISTIDO E 'PARCIALMENTE DESPACHADO' NÃO
--
-- EM SEPARACAO é uma DECISÃO HUMANA — a supervisora conferiu o pedido e
-- clicou. Sem valor persistido não há o que gravar em
-- sup_pedido_historico, e a trilha da aprovação do pré-pedido some.
-- Além disso a fila do estoquista precisa filtrar por coluna indexada, e
-- derivar de "existe reserva ATIVA" falharia exatamente no caso crítico:
-- um pedido em que TODOS os itens deram divergência tem zero reservas
-- ativas e sairia da fila justo quando mais precisa de olho humano.
--
-- "Parcialmente despachado" é o oposto: função pura dos itens. Vira
-- valor de StatusVisivel no front, ao lado dos dois DESPACHADO_* que já
-- existem (src/hooks/useSupPedidos.ts:37-41). Persistir recriaria a
-- doença da §12.8 — dois lugares afirmando o mesmo fato.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_sup_pedido_transicao ON public.sup_pedido;
--   DROP FUNCTION IF EXISTS public.sup_pedido_guard_transicao();
--   DROP VIEW IF EXISTS public.sup_pedido_situacao;
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sup_separacao';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sup_separacao';
--   DELETE FROM public.app_menu WHERE codigo = 'sup_separacao';
--   ALTER TABLE public.sup_pedido DROP CONSTRAINT IF EXISTS sup_pedido_status_check;
--   ALTER TABLE public.sup_pedido ADD CONSTRAINT sup_pedido_status_check
--     CHECK (status IN ('EM PREPARACAO','AGUARDANDO ENVIO','AGUARDANDO COMPRA','DESPACHADO','CANCELADO'));
--   ALTER TABLE public.sup_pedido_historico DROP CONSTRAINT IF EXISTS sup_pedido_historico_acao_check;
--   ALTER TABLE public.sup_pedido_historico ADD CONSTRAINT sup_pedido_historico_acao_check
--     CHECK (acao IN ('CRIADO','STATUS','EDITADO','CANCELADO','DECLARACAO','COMPROVACAO'));
-- =====================================================================

-- ── 1. O status novo ─────────────────────────────────────────────────
-- Nome da constraint descoberto e não assumido; a migration original
-- (20260819000002:109) não nomeou explicitamente.

DO $mig$
DECLARE v_con text;
BEGIN
  SELECT c.conname INTO v_con FROM pg_constraint c
   WHERE c.conrelid = 'public.sup_pedido'::regclass AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%AGUARDANDO COMPRA%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sup_pedido DROP CONSTRAINT %I', v_con);
  END IF;

  ALTER TABLE public.sup_pedido ADD CONSTRAINT sup_pedido_status_check
    CHECK (status IN ('EM PREPARACAO','EM SEPARACAO','AGUARDANDO ENVIO',
                      'AGUARDANDO COMPRA','DESPACHADO','CANCELADO'));

  SELECT c.conname INTO v_con FROM pg_constraint c
   WHERE c.conrelid = 'public.sup_pedido_historico'::regclass AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%COMPROVACAO%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sup_pedido_historico DROP CONSTRAINT %I', v_con);
  END IF;

  ALTER TABLE public.sup_pedido_historico ADD CONSTRAINT sup_pedido_historico_acao_check
    CHECK (acao IN ('CRIADO','STATUS','EDITADO','CANCELADO','DECLARACAO','COMPROVACAO',
                    'SEPARACAO','DIVERGENCIA'));
END
$mig$;

-- ── 2. Índices que a view abaixo precisa ─────────────────────────────
--
-- Os índices existentes lideram pela coluna errada para este acesso:
-- uq_sup_consumo_tag_item é (codigo, pedido_item_id) e idx_sup_tag_pedido
-- é (pedido_id, pedido_item_id). A view consulta por pedido_item_id
-- sozinho, que não aproveita bem nenhum dos dois.

CREATE INDEX IF NOT EXISTS idx_sup_consumo_pedido_item
  ON public.sup_estoque_consumo(pedido_item_id);

CREATE INDEX IF NOT EXISTS idx_sup_tag_pedido_item
  ON public.sup_estoque_tag(pedido_item_id) WHERE pedido_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sup_reserva_pedido_item
  ON public.sup_estoque_reserva(pedido_item_id, situacao);

-- ── 3. Situação por pedido ───────────────────────────────────────────
--
-- Derivar isto no cliente custaria rodar buscarTagsDePedidos
-- (src/hooks/useSupEstoque.ts:399) para os ~1.300 pedidos em toda carga
-- da tela, só para pintar um KPI. A view resolve no banco.
--
-- Ganho colateral: substitui aquela réplica cliente-servidor no caminho
-- de filtro e de KPI. buscarTagsDePedidos fica só para a coluna "TAGs"
-- do Excel, onde o código da etiqueta importa de verdade.
--
-- "saiu" tem duas fontes porque o módulo tem dois tipos de etiqueta: o
-- ledger de massa e a tag única marcada usada. É a mesma união que
-- sup_est_tags_do_pedido faz (20260820000002:403).

CREATE OR REPLACE VIEW public.sup_pedido_situacao
WITH (security_invoker = true) AS
SELECT
  pi.pedido_id,
  count(*)::integer                                     AS itens,
  count(*) FILTER (WHERE s.saiu)::integer               AS itens_atendidos,
  count(*) FILTER (WHERE s.reservado)::integer          AS itens_em_separacao,
  count(*) FILTER (WHERE s.pendente_compra)::integer    AS itens_pendentes_compra
  FROM public.sup_pedido_item pi
  CROSS JOIN LATERAL (
    SELECT
      (EXISTS (SELECT 1 FROM public.sup_estoque_consumo cc
                WHERE cc.pedido_item_id = pi.id)
       OR EXISTS (SELECT 1 FROM public.sup_estoque_tag tg
                   WHERE tg.pedido_item_id = pi.id AND tg.tipo = 'unico' AND tg.usado)) AS saiu,
      EXISTS (SELECT 1 FROM public.sup_estoque_reserva rr
               WHERE rr.pedido_item_id = pi.id AND rr.situacao = 'ATIVA')               AS reservado,
      EXISTS (SELECT 1 FROM public.sup_estoque_reserva rr
               WHERE rr.pedido_item_id = pi.id AND rr.situacao = 'DIVERGENTE')          AS pendente_compra
  ) s
 GROUP BY pi.pedido_id;

-- ── 4. O primeiro grafo de transição deste módulo ────────────────────
--
-- Até aqui o select da tela oferecia os cinco status sempre, e nada
-- impedia levar um pedido com reserva ativa direto para DESPACHADO,
-- orfanando a mercadoria de forma invisível.
--
-- O grafo é DELIBERADAMENTE PERMISSIVO: todos os pares que a operação já
-- fazia continuam valendo. As únicas regras novas cercam o estado novo e
-- a reserva viva.
--
-- EM SEPARACAO -> CANCELADO libera as reservas aqui dentro, e não só na
-- RPC, porque cancelar também acontece por sup_est_baixar e pelo SQL
-- Editor. É o par mais perigoso e o que mais vai acontecer.

CREATE OR REPLACE FUNCTION public.sup_pedido_guard_transicao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ativas integer;
  r        record;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(rr.quantidade), 0) INTO v_ativas
    FROM public.sup_estoque_reserva rr
   WHERE rr.pedido_id = NEW.id AND rr.situacao = 'ATIVA';

  -- Entrar em separação exige ter reservado algo. Dentro de
  -- sup_sep_reservar isso já é verdade: as reservas entram antes do
  -- UPDATE do status, na mesma transação.
  IF NEW.status = 'EM SEPARACAO' AND v_ativas = 0 THEN
    RAISE EXCEPTION 'Um pedido só entra em separação depois de reservar estoque.';
  END IF;

  IF OLD.status = 'EM SEPARACAO'
     AND NEW.status NOT IN ('AGUARDANDO ENVIO','AGUARDANDO COMPRA','EM PREPARACAO','CANCELADO') THEN
    RAISE EXCEPTION
      'De EM SEPARACAO só se vai para AGUARDANDO ENVIO, AGUARDANDO COMPRA, EM PREPARACAO ou CANCELADO (tentado: %).',
      NEW.status;
  END IF;

  -- Cancelar devolve a mercadoria ao saldo, com trilha.
  IF NEW.status = 'CANCELADO' AND v_ativas > 0 THEN
    FOR r IN
      SELECT rr.id, rr.quantidade, rr.empresa_id, rr.item_estoque_id,
             rr.reservado_por, rr.reservado_por_nome, tg.codigo, tg.tamanho
        FROM public.sup_estoque_reserva rr
        JOIN public.sup_estoque_tag tg ON tg.id = rr.tag_id
       WHERE rr.pedido_id = NEW.id AND rr.situacao = 'ATIVA'
    LOOP
      UPDATE public.sup_estoque_reserva
         SET situacao   = 'LIBERADA',
             fechado_em = now(),
             motivo     = COALESCE(motivo, 'Pedido cancelado')
       WHERE id = r.id;

      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         pedido_id, observacao, usuario_id, usuario_nome)
      VALUES
        (r.empresa_id, r.item_estoque_id, r.codigo, 'liberacao', r.quantidade, r.tamanho,
         NEW.id, format('Reserva liberada: pedido %s cancelado', NEW.pedido_id),
         r.reservado_por, r.reservado_por_nome);
    END LOOP;

    v_ativas := 0;
  END IF;

  -- Nenhum outro destino aceita reserva pendurada: ou separa, ou libera.
  IF v_ativas > 0 AND NEW.status <> 'EM SEPARACAO' THEN
    RAISE EXCEPTION
      'Este pedido tem % unidade(s) reservada(s) em separação. Confirme a separação ou libere a reserva antes de mudar para %.',
      v_ativas, NEW.status;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sup_pedido_transicao ON public.sup_pedido;
CREATE TRIGGER trg_sup_pedido_transicao
  BEFORE UPDATE ON public.sup_pedido
  FOR EACH ROW EXECUTE FUNCTION public.sup_pedido_guard_transicao();

REVOKE ALL ON FUNCTION public.sup_pedido_guard_transicao() FROM PUBLIC, anon;

-- ── 5. Menu da tela do estoquista ────────────────────────────────────
--
-- Menu próprio, e não uma aba dentro de Pedidos de Materiais, porque o
-- separador não pode enxergar a fila comercial inteira. Toda a leitura da
-- tela dele passa por sup_sep_fila() (parte 3), pelo mesmo motivo que as
-- sup_ext_* existem: não abrir SELECT em tabela que carrega informação
-- que aquele perfil não deve ver.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_separacao', 'Separação de Pedidos', '/app/suprimentos/separacao', 62, true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true;

-- Menu SEM NENHUMA regra nasce ABERTO neste ERP (list_configured_menu_codes).
-- Sem esta semeadura, a fila de separação ficaria visível para todo
-- autenticado — ver 20260823000002_supply_menus_deny_by_default.sql.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_separacao', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Sem estas linhas o switch da ação nem APARECE na tela "Acesso por
-- Usuário", e o único jeito de conceder seria o perfil concede_tudo — é o
-- achado documentado em 20260930000009_cartao_credito_app_menu_acao.sql.
INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('sup_separacao', 'visualizar'),
  ('sup_separacao', 'alterar')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
