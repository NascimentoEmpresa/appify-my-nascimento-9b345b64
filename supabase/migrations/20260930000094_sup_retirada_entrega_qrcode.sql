-- =====================================================================
-- Suprimentos — retirada do pedido para entrega pelo QR code da etiqueta
--
-- O estoque físico fica fechado fora do horário comercial. Os pedidos já
-- separados ficam do lado de fora, e o Supervisor Operacional (frota
-- própria) passa para buscar. Até aqui nada registrava QUEM levou o volume
-- nem QUANDO: o pedido pulava de AGUARDANDO ENVIO direto para DESPACHADO,
-- quando alguém do Compras lembrava de mudar o status no dia seguinte.
--
-- Agora a etiqueta térmica traz um QR code que abre
-- /app/suprimentos/retirada/<id do pedido>. O supervisor lê, confere e
-- confirma — e o pedido vai para RETIRADO PARA ENTREGA com autor e horário
-- no histórico. O tipo de envio (Correio ou próprio) continua sendo
-- informado depois, pelo Compras, no modal de status que já existe; é ele
-- quem leva o pedido a DESPACHADO.
--
-- POR QUE UM STATUS PERSISTIDO, E NÃO SÓ UMA LINHA NO HISTÓRICO
--   É uma decisão humana com dono (mesmo critério da EM SEPARACAO, ver
--   20260930000077): tem autor, tem hora, e o Compras precisa filtrar a
--   fila por ela para saber o que falta informar o envio.
--
-- POR QUE AS COLUNAS retirado_* ALÉM DO HISTÓRICO
--   O card da fila mostra "retirado por X às HH:MM" em ~1.500 pedidos.
--   Buscar isso no histórico seria uma consulta por card. As colunas são o
--   estado atual (como data_despachado); o histórico é a trilha.
--
-- QUEM PODE CONFIRMAR
--   Só usuário com login de verdade (sessão anônima do encarregado externo
--   é recusada) E com a tela "Retirada para Entrega" liberada em Acesso por
--   Usuário. O toggle padrão concede visualizar + incluir, que é
--   exatamente o que as RPCs abaixo exigem — nada de Administrador Geral.
--   Não há filtro de empresa, de propósito (REGRAS-PR J1.E).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_retirada_confirmar(text);
--   DROP FUNCTION IF EXISTS public.sup_retirada_consultar(text);
--   DROP FUNCTION IF EXISTS public.sup_retirada_localizar(text);
--   DROP TRIGGER IF EXISTS trg_sup_pedido_guard_retirada ON public.sup_pedido;
--   DROP FUNCTION IF EXISTS public.sup_pedido_guard_retirada();
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sup_retirada_entrega';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sup_retirada_entrega';
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'sup_retirada_entrega';
--   DELETE FROM public.app_menu WHERE codigo = 'sup_retirada_entrega';
--   UPDATE public.sup_pedido SET status = 'AGUARDANDO ENVIO' WHERE status = 'RETIRADO PARA ENTREGA';
--   ALTER TABLE public.sup_pedido DROP CONSTRAINT IF EXISTS sup_pedido_status_check;
--   ALTER TABLE public.sup_pedido ADD CONSTRAINT sup_pedido_status_check
--     CHECK (status IN ('EM PREPARACAO','EM SEPARACAO','AGUARDANDO ENVIO',
--                       'AGUARDANDO COMPRA','DESPACHADO','CANCELADO'));
--   DELETE FROM public.sup_pedido_historico WHERE acao = 'RETIRADA';
--   ALTER TABLE public.sup_pedido_historico DROP CONSTRAINT IF EXISTS sup_pedido_historico_acao_check;
--   ALTER TABLE public.sup_pedido_historico ADD CONSTRAINT sup_pedido_historico_acao_check
--     CHECK (acao IN ('CRIADO','STATUS','EDITADO','CANCELADO','DECLARACAO','COMPROVACAO',
--                     'SEPARACAO','DIVERGENCIA'));
--   ALTER TABLE public.sup_pedido DROP COLUMN IF EXISTS retirado_em,
--     DROP COLUMN IF EXISTS retirado_por, DROP COLUMN IF EXISTS retirado_por_nome;
-- =====================================================================

-- ── 1. Status novo e ação nova no histórico ──────────────────────────
-- As duas constraints foram nomeadas explicitamente em 20260930000077.

ALTER TABLE public.sup_pedido DROP CONSTRAINT IF EXISTS sup_pedido_status_check;
ALTER TABLE public.sup_pedido ADD CONSTRAINT sup_pedido_status_check
  CHECK (status IN ('EM PREPARACAO','EM SEPARACAO','AGUARDANDO ENVIO',
                    'RETIRADO PARA ENTREGA','AGUARDANDO COMPRA','DESPACHADO','CANCELADO'));

ALTER TABLE public.sup_pedido_historico DROP CONSTRAINT IF EXISTS sup_pedido_historico_acao_check;
ALTER TABLE public.sup_pedido_historico ADD CONSTRAINT sup_pedido_historico_acao_check
  CHECK (acao IN ('CRIADO','STATUS','EDITADO','CANCELADO','DECLARACAO','COMPROVACAO',
                  'SEPARACAO','DIVERGENCIA','RETIRADA'));

-- ── 2. Quem retirou e quando ─────────────────────────────────────────

ALTER TABLE public.sup_pedido
  ADD COLUMN IF NOT EXISTS retirado_em       timestamptz,
  ADD COLUMN IF NOT EXISTS retirado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retirado_por_nome text;

-- ── 3. A retirada só nasce do QR code ────────────────────────────────
--
-- Sem esta trava, o modal de status do Compras (sup_est_baixar) conseguiria
-- pôr um pedido em RETIRADO PARA ENTREGA sem ninguém ter retirado nada — e
-- o status perderia o único valor que tem, que é afirmar que alguém com
-- login confirmou ter levado o volume. A RPC sup_retirada_confirmar sempre
-- carimba retirado_em junto; é isso que a trava confere.

CREATE OR REPLACE FUNCTION public.sup_pedido_guard_retirada()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.status = 'RETIRADO PARA ENTREGA'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.retirado_em IS NOT DISTINCT FROM OLD.retirado_em THEN
    RAISE EXCEPTION 'A retirada para entrega só é registrada pela leitura do QR code da etiqueta.';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sup_pedido_guard_retirada ON public.sup_pedido;
CREATE TRIGGER trg_sup_pedido_guard_retirada
  BEFORE UPDATE ON public.sup_pedido
  FOR EACH ROW EXECUTE FUNCTION public.sup_pedido_guard_retirada();

REVOKE ALL ON FUNCTION public.sup_pedido_guard_retirada() FROM PUBLIC, anon;

-- ── 4. Menu ──────────────────────────────────────────────────────────
--
-- Menu próprio, e não uma ação dentro de Pedidos de Materiais, porque o
-- supervisor não pode enxergar a fila comercial inteira — mesmo motivo da
-- sup_separacao. Toda a leitura dele passa pelas RPCs abaixo.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_retirada_entrega', 'Retirada para Entrega', '/app/suprimentos/retirada', 63, true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true;

-- Menu SEM NENHUMA regra nasce ABERTO neste ERP (list_configured_menu_codes).
-- Sem esta semeadura, qualquer autenticado confirmaria retirada — que é
-- justamente o que esta tela existe para impedir.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_retirada_entrega', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Sem estas linhas o switch nem aparece em "Acesso por Usuário"
-- (achado de 20260930000009_cartao_credito_app_menu_acao.sql).
INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('sup_retirada_entrega', 'visualizar'),
  ('sup_retirada_entrega', 'incluir')
ON CONFLICT DO NOTHING;

-- ── 5. RPCs ──────────────────────────────────────────────────────────

-- O QR code leva o id (uuid) do pedido: é inequívoco e não depende do
-- formato do protocolo, que mudou entre o legado e o sistema novo. Quem
-- digita à mão, com a etiqueta rasgada, digita o protocolo. As duas formas
-- caem aqui. Função interna — sem GRANT para ninguém.
CREATE OR REPLACE FUNCTION public.sup_retirada_localizar(p_ref text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_id  uuid;
BEGIN
  IF v_ref = '' THEN RETURN NULL; END IF;

  -- Dois passos, e não um OR: o cast ::uuid num OR pode ser avaliado mesmo
  -- quando o texto é um protocolo, e aí estoura em vez de não achar.
  IF v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT p.id INTO v_id FROM public.sup_pedido p WHERE p.id = v_ref::uuid;
    RETURN v_id;
  END IF;

  SELECT p.id INTO v_id
    FROM public.sup_pedido p
   WHERE upper(p.pedido_id) = upper(v_ref)
   ORDER BY p.created_at DESC
   LIMIT 1;
  RETURN v_id;
END $fn$;

REVOKE ALL ON FUNCTION public.sup_retirada_localizar(text) FROM PUBLIC, anon, authenticated;

-- O mínimo para o supervisor conferir o volume na rua: protocolo,
-- colaborador, destino e itens. Nada de solicitante, observação ou
-- histórico — ele não tem a tela da fila, e não é aqui que vai ganhar.
-- Devolve NULL quando o pedido não existe.
CREATE OR REPLACE FUNCTION public.sup_retirada_consultar(p_ref text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_ped   record;
  v_itens jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'A retirada exige login com um usuário do sistema.';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_retirada_entrega', 'visualizar') THEN
    RAISE EXCEPTION 'Seu usuário não tem acesso a "Retirada para Entrega". Peça a liberação em Acesso por Usuário.';
  END IF;

  v_id := public.sup_retirada_localizar(p_ref);
  IF v_id IS NULL THEN RETURN NULL; END IF;

  SELECT p.id, p.pedido_id, p.status, p.nome_colaborador, p.contrato_nome,
         p.posto_nome, p.funcao_nome, p.retirado_em, p.retirado_por_nome
    INTO v_ped
    FROM public.sup_pedido p
   WHERE p.id = v_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'nome_item', i.nome_item, 'tamanho', i.tamanho,
           'quantidade', i.quantidade, 'litros', i.litros) ORDER BY i.ordem), '[]'::jsonb)
    INTO v_itens
    FROM public.sup_pedido_item i
   WHERE i.pedido_id = v_id;

  RETURN jsonb_build_object(
    'id',                v_ped.id,
    'pedido_id',         v_ped.pedido_id,
    'status',            v_ped.status,
    'nome_colaborador',  v_ped.nome_colaborador,
    'contrato_nome',     v_ped.contrato_nome,
    'posto_nome',        v_ped.posto_nome,
    'funcao_nome',       v_ped.funcao_nome,
    'itens',             v_itens,
    'retirado_em',       v_ped.retirado_em,
    'retirado_por_nome', v_ped.retirado_por_nome,
    -- Quem está logado neste celular. A tela mostra antes do botão: celular
    -- de frota às vezes passa de mão em mão, e a retirada fica no nome de
    -- quem está logado, não de quem está segurando.
    'usuario_nome',      COALESCE(public.sup_est_nome_usuario(), auth.jwt()->>'email'),
    'pode_retirar',      v_ped.status = 'AGUARDANDO ENVIO',
    'pode_confirmar',    public.can_access(v_uid, 'sup_retirada_entrega', 'incluir')
  );
END $fn$;

-- Confirma a retirada. Reler o QR de um pedido já retirado NÃO é erro: o
-- supervisor que escaneia duas vezes (ou o colega que chega depois) recebe
-- de volta quem levou e quando, sem sobrescrever nada.
CREATE OR REPLACE FUNCTION public.sup_retirada_confirmar(p_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_id    uuid;
  v_ped   record;
  v_agora timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'A retirada exige login com um usuário do sistema.';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_retirada_entrega', 'incluir') THEN
    RAISE EXCEPTION 'Seu usuário não pode confirmar retirada. Peça a liberação de "Retirada para Entrega" em Acesso por Usuário.';
  END IF;

  v_id := public.sup_retirada_localizar(p_ref);
  IF v_id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado: %', p_ref; END IF;

  SELECT p.id, p.pedido_id, p.status, p.retirado_em, p.retirado_por_nome
    INTO v_ped
    FROM public.sup_pedido p
   WHERE p.id = v_id
     FOR UPDATE;

  IF v_ped.status = 'RETIRADO PARA ENTREGA' THEN
    RETURN jsonb_build_object(
      'ja_retirado', true, 'pedido_id', v_ped.pedido_id,
      'retirado_em', v_ped.retirado_em, 'retirado_por_nome', v_ped.retirado_por_nome);
  END IF;

  IF v_ped.status <> 'AGUARDANDO ENVIO' THEN
    RAISE EXCEPTION '%', CASE v_ped.status
      WHEN 'DESPACHADO' THEN format('O pedido %s já consta como despachado.', v_ped.pedido_id)
      WHEN 'CANCELADO'  THEN format('O pedido %s foi cancelado. Não leve este volume e avise o Suprimentos.', v_ped.pedido_id)
      ELSE format('O pedido %s ainda não está liberado para retirada (situação: %s). Confirme com o Suprimentos antes de levar.',
                  v_ped.pedido_id, v_ped.status)
    END;
  END IF;

  v_nome := COALESCE(public.sup_est_nome_usuario(), auth.jwt()->>'email', 'Usuário');

  UPDATE public.sup_pedido p
     SET status            = 'RETIRADO PARA ENTREGA',
         retirado_em       = v_agora,
         retirado_por      = v_uid,
         retirado_por_nome = v_nome
   WHERE p.id = v_id;

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_anterior, status_novo, observacao,
     alterado_por, alterado_por_nome, data_alteracao)
  VALUES
    (v_id, 'RETIRADA', v_ped.status, 'RETIRADO PARA ENTREGA',
     format('%s retirou para entrega o pedido %s em %s',
            v_nome, v_ped.pedido_id,
            to_char(v_agora AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI')),
     v_uid, v_nome, v_agora);

  RETURN jsonb_build_object(
    'ja_retirado', false, 'pedido_id', v_ped.pedido_id,
    'retirado_em', v_agora, 'retirado_por_nome', v_nome);
END $fn$;

REVOKE ALL ON FUNCTION public.sup_retirada_consultar(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_retirada_confirmar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_retirada_consultar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_retirada_confirmar(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
