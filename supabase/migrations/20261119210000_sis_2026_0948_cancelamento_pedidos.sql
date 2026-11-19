-- ============================================================================
-- SIS-2026-0948 — solicitação de cancelamento de pedidos de materiais
--
-- Recrutamento e Encarregado solicitam; Suprimentos decide. O motivo fica
-- estruturado para auditoria e dashboard. A aprovação muda o status para
-- CANCELADO na mesma transação, reaproveitando sup_pedido_guard_transicao
-- para liberar reservas de estoque.
-- ============================================================================

ALTER TABLE public.sup_pedido
  ADD COLUMN IF NOT EXISTS cancelamento_estado text NOT NULL DEFAULT 'NENHUM',
  ADD COLUMN IF NOT EXISTS cancelamento_categoria text,
  ADD COLUMN IF NOT EXISTS cancelamento_detalhe text,
  ADD COLUMN IF NOT EXISTS cancelamento_origem text,
  ADD COLUMN IF NOT EXISTS cancelamento_solicitado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelamento_solicitado_por_nome text,
  ADD COLUMN IF NOT EXISTS cancelamento_solicitado_em timestamptz,
  ADD COLUMN IF NOT EXISTS cancelamento_decidido_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelamento_decidido_por_nome text,
  ADD COLUMN IF NOT EXISTS cancelamento_decidido_em timestamptz,
  ADD COLUMN IF NOT EXISTS cancelamento_decisao_observacao text;

ALTER TABLE public.sup_pedido
  DROP CONSTRAINT IF EXISTS sup_pedido_cancelamento_estado_check,
  ADD CONSTRAINT sup_pedido_cancelamento_estado_check
    CHECK (cancelamento_estado IN ('NENHUM', 'SOLICITADO', 'RECUSADO', 'APROVADO')),
  DROP CONSTRAINT IF EXISTS sup_pedido_cancelamento_categoria_check,
  ADD CONSTRAINT sup_pedido_cancelamento_categoria_check
    CHECK (cancelamento_categoria IS NULL OR cancelamento_categoria IN (
      'DUPLICIDADE', 'DESISTENCIA_ADMISSAO', 'PEDIDO_INCORRETO',
      'COLABORADOR_DESLIGADO', 'NAO_NECESSARIO', 'OUTRO'
    )),
  DROP CONSTRAINT IF EXISTS sup_pedido_cancelamento_origem_check,
  ADD CONSTRAINT sup_pedido_cancelamento_origem_check
    CHECK (cancelamento_origem IS NULL OR cancelamento_origem IN ('RECRUTAMENTO', 'ENCARREGADO'));

CREATE INDEX IF NOT EXISTS idx_sup_pedido_cancelamento_solicitado
  ON public.sup_pedido(cancelamento_solicitado_em DESC)
  WHERE cancelamento_estado = 'SOLICITADO';
CREATE INDEX IF NOT EXISTS idx_sup_pedido_cancelamento_solicitado_por
  ON public.sup_pedido(cancelamento_solicitado_por)
  WHERE cancelamento_solicitado_por IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sup_pedido_cancelamento_decidido_por
  ON public.sup_pedido(cancelamento_decidido_por)
  WHERE cancelamento_decidido_por IS NOT NULL;

ALTER TABLE public.sup_pedido_historico
  DROP CONSTRAINT IF EXISTS sup_pedido_historico_acao_check;
ALTER TABLE public.sup_pedido_historico
  ADD CONSTRAINT sup_pedido_historico_acao_check
  CHECK (acao IN (
    'CRIADO','STATUS','EDITADO','CANCELADO','DECLARACAO','COMPROVACAO',
    'SEPARACAO','DIVERGENCIA','RETIRADA','ROMANEIO',
    'CANCELAMENTO_SOLICITADO','CANCELAMENTO_APROVADO','CANCELAMENTO_RECUSADO'
  ));

CREATE OR REPLACE FUNCTION public.sup_cancelamento_validar_motivo(
  p_categoria text,
  p_detalhe text
) RETURNS void
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_categoria IS NULL OR p_categoria NOT IN (
    'DUPLICIDADE', 'DESISTENCIA_ADMISSAO', 'PEDIDO_INCORRETO',
    'COLABORADOR_DESLIGADO', 'NAO_NECESSARIO', 'OUTRO'
  ) THEN
    RAISE EXCEPTION 'Selecione um motivo válido para o cancelamento.' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_detalhe, ''))) < 10 THEN
    RAISE EXCEPTION 'Explique o cancelamento com pelo menos 10 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(p_detalhe)) > 1000 THEN
    RAISE EXCEPTION 'O detalhe do cancelamento deve ter no máximo 1000 caracteres.' USING ERRCODE = '22023';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_cancelamento_validar_motivo(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sup_ext_solicitar_cancelamento(
  p_pedido_id uuid,
  p_categoria text,
  p_detalhe text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_pedido public.sup_pedido;
  v_nome text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.sup_cancelamento_validar_motivo(p_categoria, p_detalhe);

  SELECT p.* INTO v_pedido
    FROM public.sup_pedido p
   WHERE p.id = p_pedido_id
     AND (
       p.criado_por = v_uid
       OR EXISTS (
         SELECT 1
           FROM public.sup_ext_sessao s
          WHERE s.user_id = v_uid
            AND s.contrato_id = p.contrato_id
            AND s.login_informado = p.solicitante_login
       )
     )
   FOR UPDATE;

  IF v_pedido.id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado entre os seus pedidos.' USING ERRCODE = '42501';
  END IF;
  IF v_pedido.status NOT IN ('EM PREPARACAO', 'EM SEPARACAO', 'AGUARDANDO ENVIO', 'AGUARDANDO COMPRA') THEN
    RAISE EXCEPTION 'Este pedido não pode mais ser cancelado porque já foi retirado, despachado ou encerrado.' USING ERRCODE = '22023';
  END IF;
  IF v_pedido.cancelamento_estado = 'SOLICITADO' THEN
    RAISE EXCEPTION 'Já existe uma solicitação de cancelamento aguardando o Suprimentos.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), pr.email)
    INTO v_nome FROM public.profiles pr WHERE pr.id = v_uid;
  v_nome := COALESCE(v_nome, v_pedido.solicitante_nome, v_pedido.solicitante_login, 'Encarregado');

  UPDATE public.sup_pedido
     SET cancelamento_estado = 'SOLICITADO',
         cancelamento_categoria = p_categoria,
         cancelamento_detalhe = btrim(p_detalhe),
         cancelamento_origem = 'ENCARREGADO',
         cancelamento_solicitado_por = v_uid,
         cancelamento_solicitado_por_nome = v_nome,
         cancelamento_solicitado_em = now(),
         cancelamento_decidido_por = NULL,
         cancelamento_decidido_por_nome = NULL,
         cancelamento_decidido_em = NULL,
         cancelamento_decisao_observacao = NULL
   WHERE id = v_pedido.id;

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
  VALUES
    (v_pedido.id, 'CANCELAMENTO_SOLICITADO', v_pedido.status, v_pedido.status,
     p_categoria || ': ' || btrim(p_detalhe), v_uid, v_nome);

  RETURN jsonb_build_object('pedido_id', v_pedido.id, 'estado', 'SOLICITADO');
END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_ext_solicitar_cancelamento(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_ext_solicitar_cancelamento(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rec_solicitar_cancelamento_pedido(
  p_candidato_id bigint,
  p_categoria text,
  p_detalhe text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_pedido public.sup_pedido;
  v_nome text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'recrutamento_gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para solicitar o cancelamento pelo Recrutamento.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.sup_cancelamento_validar_motivo(p_categoria, p_detalhe);

  SELECT p.* INTO v_pedido
    FROM public.sup_admissao_enxoval e
    JOIN public.sup_pedido p ON p.id = e.pedido_id
   WHERE e.candidato_id = p_candidato_id
   FOR UPDATE OF p;

  IF v_pedido.id IS NULL THEN
    RAISE EXCEPTION 'O candidato não possui pedido de materiais vinculado.' USING ERRCODE = '22023';
  END IF;
  IF v_pedido.status NOT IN ('EM PREPARACAO', 'EM SEPARACAO', 'AGUARDANDO ENVIO', 'AGUARDANDO COMPRA') THEN
    RAISE EXCEPTION 'Este pedido não pode mais ser cancelado porque já foi retirado, despachado ou encerrado.' USING ERRCODE = '22023';
  END IF;
  IF v_pedido.cancelamento_estado = 'SOLICITADO' THEN
    RAISE EXCEPTION 'Já existe uma solicitação de cancelamento aguardando o Suprimentos.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), pr.email)
    INTO v_nome FROM public.profiles pr WHERE pr.id = v_uid;
  v_nome := COALESCE(v_nome, 'Recrutamento');

  UPDATE public.sup_pedido
     SET cancelamento_estado = 'SOLICITADO',
         cancelamento_categoria = p_categoria,
         cancelamento_detalhe = btrim(p_detalhe),
         cancelamento_origem = 'RECRUTAMENTO',
         cancelamento_solicitado_por = v_uid,
         cancelamento_solicitado_por_nome = v_nome,
         cancelamento_solicitado_em = now(),
         cancelamento_decidido_por = NULL,
         cancelamento_decidido_por_nome = NULL,
         cancelamento_decidido_em = NULL,
         cancelamento_decisao_observacao = NULL
   WHERE id = v_pedido.id;

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
  VALUES
    (v_pedido.id, 'CANCELAMENTO_SOLICITADO', v_pedido.status, v_pedido.status,
     p_categoria || ': ' || btrim(p_detalhe), v_uid, v_nome);

  RETURN jsonb_build_object('pedido_id', v_pedido.id, 'estado', 'SOLICITADO');
END;
$fn$;

REVOKE ALL ON FUNCTION public.rec_solicitar_cancelamento_pedido(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_solicitar_cancelamento_pedido(bigint, text, text) TO authenticated;

-- Impede que uma atualização direta ou o modal antigo pule a solicitação.
CREATE OR REPLACE FUNCTION public.sup_pedido_exigir_solicitacao_cancelamento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.status = 'CANCELADO'
     AND OLD.status IS DISTINCT FROM 'CANCELADO'
     AND NOT (
       OLD.cancelamento_estado = 'SOLICITADO'
       AND NEW.cancelamento_estado = 'APROVADO'
       AND NEW.cancelamento_decidido_por IS NOT NULL
       AND NEW.cancelamento_decidido_em IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'O cancelamento precisa ser solicitado pelo Recrutamento ou Encarregado e aprovado pelo Suprimentos.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sup_pedido_exigir_solicitacao_cancelamento ON public.sup_pedido;
CREATE TRIGGER trg_sup_pedido_exigir_solicitacao_cancelamento
  BEFORE UPDATE OF status ON public.sup_pedido
  FOR EACH ROW EXECUTE FUNCTION public.sup_pedido_exigir_solicitacao_cancelamento();

CREATE OR REPLACE FUNCTION public.sup_decidir_cancelamento_pedido(
  p_pedido_id uuid,
  p_aprovar boolean,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_pedido public.sup_pedido;
  v_nome text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para decidir cancelamentos de pedidos.' USING ERRCODE = '42501';
  END IF;
  IF p_aprovar IS NULL THEN
    RAISE EXCEPTION 'Informe se a solicitação será aprovada ou recusada.' USING ERRCODE = '22023';
  END IF;
  IF NOT p_aprovar AND length(btrim(COALESCE(p_observacao, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da recusa com pelo menos 5 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_pedido
    FROM public.sup_pedido p
   WHERE p.id = p_pedido_id
   FOR UPDATE;

  IF v_pedido.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF v_pedido.cancelamento_estado <> 'SOLICITADO' THEN
    RAISE EXCEPTION 'Este pedido não possui solicitação de cancelamento pendente.' USING ERRCODE = '22023';
  END IF;
  IF p_aprovar AND v_pedido.status NOT IN ('EM PREPARACAO', 'EM SEPARACAO', 'AGUARDANDO ENVIO', 'AGUARDANDO COMPRA') THEN
    RAISE EXCEPTION 'O pedido avançou para retirada ou despacho e não pode mais ser cancelado.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), pr.email)
    INTO v_nome FROM public.profiles pr WHERE pr.id = v_uid;
  v_nome := COALESCE(v_nome, 'Suprimentos');

  IF p_aprovar THEN
    UPDATE public.sup_pedido
       SET status = 'CANCELADO',
           cancelamento_estado = 'APROVADO',
           cancelamento_decidido_por = v_uid,
           cancelamento_decidido_por_nome = v_nome,
           cancelamento_decidido_em = now(),
           cancelamento_decisao_observacao = NULLIF(btrim(COALESCE(p_observacao, '')), '')
     WHERE id = v_pedido.id;

    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES
      (v_pedido.id, 'CANCELAMENTO_APROVADO', v_pedido.status, 'CANCELADO',
       NULLIF(btrim(COALESCE(p_observacao, '')), ''), v_uid, v_nome);
  ELSE
    UPDATE public.sup_pedido
       SET cancelamento_estado = 'RECUSADO',
           cancelamento_decidido_por = v_uid,
           cancelamento_decidido_por_nome = v_nome,
           cancelamento_decidido_em = now(),
           cancelamento_decisao_observacao = btrim(p_observacao)
     WHERE id = v_pedido.id;

    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES
      (v_pedido.id, 'CANCELAMENTO_RECUSADO', v_pedido.status, v_pedido.status,
       btrim(p_observacao), v_uid, v_nome);
  END IF;

  RETURN jsonb_build_object(
    'pedido_id', v_pedido.id,
    'estado', CASE WHEN p_aprovar THEN 'APROVADO' ELSE 'RECUSADO' END,
    'status', CASE WHEN p_aprovar THEN 'CANCELADO' ELSE v_pedido.status END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_decidir_cancelamento_pedido(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_decidir_cancelamento_pedido(uuid, boolean, text) TO authenticated;

-- A listagem do solicitante leva o estado e o retorno do Suprimentos sem
-- abrir leitura direta da fila inteira.
DROP FUNCTION IF EXISTS public.sup_ext_meus_pedidos();
CREATE FUNCTION public.sup_ext_meus_pedidos()
RETURNS TABLE (
  id uuid, pedido_id text, status text, data_solicitacao date,
  contrato_nome text, posto_nome text, funcao_nome text,
  nome_colaborador text, matricula_colaborador text,
  tipo_pedido text, observacoes_solicitante text, observacao text,
  data_despachado timestamptz, created_at timestamptz,
  comprovacao_id uuid, comprovacao_status text,
  cancelamento_estado text, cancelamento_categoria text, cancelamento_detalhe text,
  cancelamento_origem text, cancelamento_solicitado_por_nome text,
  cancelamento_solicitado_em timestamptz, cancelamento_decidido_por_nome text,
  cancelamento_decidido_em timestamptz, cancelamento_decisao_observacao text,
  itens jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT p.id, p.pedido_id, p.status, p.data_solicitacao,
         p.contrato_nome, p.posto_nome, p.funcao_nome,
         p.nome_colaborador, p.matricula_colaborador,
         p.tipo_pedido, p.observacoes_solicitante, p.observacao,
         p.data_despachado, p.created_at,
         c.id, c.status,
         p.cancelamento_estado, p.cancelamento_categoria, p.cancelamento_detalhe,
         p.cancelamento_origem, p.cancelamento_solicitado_por_nome,
         p.cancelamento_solicitado_em, p.cancelamento_decidido_por_nome,
         p.cancelamento_decidido_em, p.cancelamento_decisao_observacao,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'nome', pi.nome_item, 'tipo', pi.tipo_item,
                    'tamanho', pi.tamanho, 'quantidade', pi.quantidade,
                    'litros', pi.litros) ORDER BY pi.ordem)
             FROM public.sup_pedido_item pi WHERE pi.pedido_id = p.id
         ), '[]'::jsonb)
    FROM public.sup_pedido p
    LEFT JOIN public.sup_pedido_comprovacao c ON c.pedido_id = p.id
   WHERE auth.uid() IS NOT NULL
     AND (
       p.criado_por = auth.uid()
       OR EXISTS (
         SELECT 1 FROM public.sup_ext_sessao s
          WHERE s.user_id = auth.uid()
            AND s.contrato_id = p.contrato_id
            AND s.login_informado = p.solicitante_login
       )
     )
   ORDER BY p.created_at DESC;
$fn$;

REVOKE ALL ON FUNCTION public.sup_ext_meus_pedidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_ext_meus_pedidos() TO authenticated;

CREATE OR REPLACE FUNCTION public.rec_pedido_candidato(p_candidato_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c public."WA_CURRICULOS";
  p public.sup_pedido;
  v_itens jsonb;
  v_hist jsonb;
BEGIN
  IF NOT public.rec_pode_ver_pedido_candidato() THEN
    RAISE EXCEPTION 'Sem acesso ao pedido deste candidato.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public."WA_CURRICULOS" WHERE id = p_candidato_id;
  SELECT sp.* INTO p
    FROM public.sup_admissao_enxoval e
    JOIN public.sup_pedido sp ON sp.id = e.pedido_id
   WHERE e.candidato_id = p_candidato_id;
  IF p.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', i.id, 'item_id', i.item_id, 'nome_item', i.nome_item,
             'tamanho', i.tamanho, 'quantidade', i.quantidade, 'ordem', i.ordem
           ) ORDER BY i.ordem, i.nome_item), '[]'::jsonb)
      INTO v_itens FROM public.sup_pedido_item i WHERE i.pedido_id = p.id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'acao', h.acao, 'status_anterior', h.status_anterior,
             'status_novo', h.status_novo, 'observacao', h.observacao,
             'por', h.alterado_por_nome, 'em', h.data_alteracao, 'campo', h.campo
           ) ORDER BY h.data_alteracao, h.id), '[]'::jsonb)
      INTO v_hist FROM public.sup_pedido_historico h WHERE h.pedido_id = p.id;
  END IF;
  RETURN jsonb_build_object(
    'dispensado', c.compras_dispensado, 'dispensa_motivo', c.compras_dispensa_motivo,
    'obs_rh', c.compras_obs_rh, 'compras_ok', c.compras_ok,
    'compras_por', c.compras_por, 'compras_em', c.compras_em, 'compras_obs', c.compras_obs,
    'compras_visto_em', c.compras_visto_em, 'compras_visto_por', c.compras_visto_por,
    'pedido', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', p.id, 'pedido_id', p.pedido_id, 'status', p.status, 'observacao', p.observacao,
      'envio_tipo', p.envio_tipo, 'envio_rastreio', p.envio_rastreio, 'tipo_pedido', p.tipo_pedido,
      'nome_colaborador', p.nome_colaborador, 'observacoes_solicitante', p.observacoes_solicitante,
      'retirado_em', p.retirado_em, 'retirado_por_nome', p.retirado_por_nome,
      'created_at', p.created_at, 'contrato_nome', p.contrato_nome,
      'posto_nome', p.posto_nome, 'funcao_nome', p.funcao_nome,
      'cancelamento_estado', p.cancelamento_estado,
      'cancelamento_categoria', p.cancelamento_categoria,
      'cancelamento_detalhe', p.cancelamento_detalhe,
      'cancelamento_origem', p.cancelamento_origem,
      'cancelamento_solicitado_por_nome', p.cancelamento_solicitado_por_nome,
      'cancelamento_solicitado_em', p.cancelamento_solicitado_em,
      'cancelamento_decidido_por_nome', p.cancelamento_decidido_por_nome,
      'cancelamento_decidido_em', p.cancelamento_decidido_em,
      'cancelamento_decisao_observacao', p.cancelamento_decisao_observacao,
      'sup_pedido_item', v_itens, 'historico', v_hist
    ) END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rec_pedido_candidato(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_pedido_candidato(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sup_dashboard_cancelamentos(
  p_empresa_id uuid,
  p_inicio date,
  p_fim date,
  p_contrato_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'sup_dashboard_compras_estoque', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para visualizar o Dashboard de Compras, Estoque e Saving.' USING ERRCODE = '42501';
  END IF;
  IF p_empresa_id IS NULL OR p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim THEN
    RAISE EXCEPTION 'Empresa e período válido são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
     WHERE pr.id = v_uid AND (pr.acessa_todas_empresas OR pr.empresa_id = p_empresa_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_empresa ue WHERE ue.user_id = v_uid AND ue.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa selecionada.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH cancelados AS (
      SELECT p.*
        FROM public.sup_pedido p
       WHERE p.empresa_id = p_empresa_id
         AND p.cancelamento_estado = 'APROVADO'
         AND p.status = 'CANCELADO'
         AND p.cancelamento_decidido_em >= p_inicio::timestamptz
         AND p.cancelamento_decidido_em < (p_fim + 1)::timestamptz
         AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
         AND (
           p_categoria IS NULL OR EXISTS (
             SELECT 1
               FROM public.sup_pedido_item pi
               LEFT JOIN public.sup_item i ON i.id = pi.item_id
              WHERE pi.pedido_id = p.id
                AND COALESCE(i.tipo, pi.tipo_item) = p_categoria
           )
         )
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM cancelados),
      'por_motivo', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC, x.nome)
          FROM (
            SELECT CASE cancelamento_categoria
                     WHEN 'DUPLICIDADE' THEN 'Pedido duplicado'
                     WHEN 'DESISTENCIA_ADMISSAO' THEN 'Desistência da admissão'
                     WHEN 'PEDIDO_INCORRETO' THEN 'Pedido incorreto'
                     WHEN 'COLABORADOR_DESLIGADO' THEN 'Colaborador desligado'
                     WHEN 'NAO_NECESSARIO' THEN 'Material não necessário'
                     ELSE 'Outro'
                   END AS nome,
                   count(*)::int AS quantidade
              FROM cancelados
             GROUP BY cancelamento_categoria
          ) x
      ), '[]'::jsonb),
      'por_origem', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC, x.nome)
          FROM (
            SELECT CASE cancelamento_origem
                     WHEN 'RECRUTAMENTO' THEN 'Recrutamento'
                     ELSE 'Encarregado'
                   END AS nome,
                   count(*)::int AS quantidade
              FROM cancelados
             GROUP BY cancelamento_origem
          ) x
      ), '[]'::jsonb)
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_dashboard_cancelamentos(uuid, date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_dashboard_cancelamentos(uuid, date, date, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.sup_dashboard_cancelamentos(uuid, date, date, uuid, text) IS
  'SIS-2026-0948: cancelamentos aprovados no período, agrupados por motivo e origem.';

-- ROLLBACK (requer restaurar as definições anteriores das duas RPCs de leitura):
-- DROP FUNCTION IF EXISTS public.sup_dashboard_cancelamentos(uuid, date, date, uuid, text);
-- DROP FUNCTION IF EXISTS public.sup_decidir_cancelamento_pedido(uuid, boolean, text);
-- DROP FUNCTION IF EXISTS public.rec_solicitar_cancelamento_pedido(bigint, text, text);
-- DROP FUNCTION IF EXISTS public.sup_ext_solicitar_cancelamento(uuid, text, text);
-- DROP TRIGGER IF EXISTS trg_sup_pedido_exigir_solicitacao_cancelamento ON public.sup_pedido;
-- DROP FUNCTION IF EXISTS public.sup_pedido_exigir_solicitacao_cancelamento();
-- DROP FUNCTION IF EXISTS public.sup_cancelamento_validar_motivo(text, text);
-- DROP INDEX IF EXISTS public.idx_sup_pedido_cancelamento_solicitado;
-- DROP INDEX IF EXISTS public.idx_sup_pedido_cancelamento_solicitado_por;
-- DROP INDEX IF EXISTS public.idx_sup_pedido_cancelamento_decidido_por;
-- ALTER TABLE public.sup_pedido DROP COLUMN IF EXISTS cancelamento_estado,
--   DROP COLUMN IF EXISTS cancelamento_categoria, DROP COLUMN IF EXISTS cancelamento_detalhe,
--   DROP COLUMN IF EXISTS cancelamento_origem, DROP COLUMN IF EXISTS cancelamento_solicitado_por,
--   DROP COLUMN IF EXISTS cancelamento_solicitado_por_nome, DROP COLUMN IF EXISTS cancelamento_solicitado_em,
--   DROP COLUMN IF EXISTS cancelamento_decidido_por, DROP COLUMN IF EXISTS cancelamento_decidido_por_nome,
--   DROP COLUMN IF EXISTS cancelamento_decidido_em, DROP COLUMN IF EXISTS cancelamento_decisao_observacao;

NOTIFY pgrst, 'reload schema';
