-- =====================================================================
-- SIS-2026-0534 — romaneio de retirada: um QR para vários pedidos
--
-- O romaneio agrupa pedidos do mesmo contrato sem apagar a identidade de
-- cada pedido. A retirada é confirmada em lote pelo supervisor, mas o
-- despacho e a comprovação continuam nascendo por pedido.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_romaneio_despachar(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.sup_retirada_romaneio_confirmar(text, jsonb);
--   DROP FUNCTION IF EXISTS public.sup_retirada_romaneio_consultar(text);
--   DROP FUNCTION IF EXISTS public.sup_retirada_tipo(text);
--   DROP FUNCTION IF EXISTS public.sup_retirada_registrar(uuid, uuid, text, timestamptz, boolean, boolean, text);
--   DROP FUNCTION IF EXISTS public.sup_romaneio_cancelar(uuid, text);
--   DROP FUNCTION IF EXISTS public.sup_romaneio_remover_pedido(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.sup_romaneio_criar(uuid[], integer, text);
--   DROP FUNCTION IF EXISTS public.sup_romaneio_localizar(text);
--   DROP POLICY IF EXISTS sup_romaneio_select ON public.sup_romaneio;
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sup_romaneio';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sup_romaneio';
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'sup_romaneio';
--   DELETE FROM public.app_menu WHERE codigo = 'sup_romaneio';
--   ALTER TABLE public.sup_pedido DROP COLUMN IF EXISTS romaneio_id;
--   DROP TABLE IF EXISTS public.sup_romaneio;
--   DROP FUNCTION IF EXISTS public.sup_gerar_romaneio_codigo();
--   DROP SEQUENCE IF EXISTS public.sup_romaneio_seq;
--   DELETE FROM public.sup_pedido_historico WHERE acao = 'ROMANEIO';
--   ALTER TABLE public.sup_pedido_historico DROP CONSTRAINT IF EXISTS sup_pedido_historico_acao_check;
--   ALTER TABLE public.sup_pedido_historico ADD CONSTRAINT sup_pedido_historico_acao_check
--     CHECK (acao IN ('CRIADO','STATUS','EDITADO','CANCELADO','DECLARACAO','COMPROVACAO',
--                     'SEPARACAO','DIVERGENCIA','RETIRADA'));
-- =====================================================================

-- 1) Numeração e tabela -------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.sup_romaneio_seq START 1;

CREATE OR REPLACE FUNCTION public.sup_gerar_romaneio_codigo()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $fn$
  SELECT 'ROM-'
      || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD')
      || '-'
      || lpad(nextval('public.sup_romaneio_seq')::text, 4, '0');
$fn$;

REVOKE ALL ON FUNCTION public.sup_gerar_romaneio_codigo() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.sup_romaneio (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                text NOT NULL UNIQUE DEFAULT public.sup_gerar_romaneio_codigo(),
  contrato_id           uuid NOT NULL REFERENCES public.contratos(id) ON DELETE RESTRICT,
  contrato_nome         text NOT NULL,
  status                text NOT NULL DEFAULT 'ABERTO'
                          CHECK (status IN ('ABERTO', 'RETIRADO', 'CANCELADO')),
  volumes               integer CHECK (volumes IS NULL OR volumes > 0),
  observacao            text,
  criado_por            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome       text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  retirado_em           timestamptz,
  retirado_por          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  retirado_por_nome     text,
  cancelado_em          timestamptz,
  cancelado_por_nome    text,
  motivo_cancelamento   text
);

CREATE INDEX IF NOT EXISTS idx_sup_romaneio_contrato_status
  ON public.sup_romaneio(contrato_id, status, created_at DESC);

ALTER TABLE public.sup_pedido
  ADD COLUMN IF NOT EXISTS romaneio_id uuid
    REFERENCES public.sup_romaneio(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sup_pedido_romaneio
  ON public.sup_pedido(romaneio_id)
  WHERE romaneio_id IS NOT NULL;

ALTER TABLE public.sup_pedido_historico
  DROP CONSTRAINT IF EXISTS sup_pedido_historico_acao_check;
ALTER TABLE public.sup_pedido_historico
  ADD CONSTRAINT sup_pedido_historico_acao_check
  CHECK (acao IN ('CRIADO','STATUS','EDITADO','CANCELADO','DECLARACAO','COMPROVACAO',
                  'SEPARACAO','DIVERGENCIA','RETIRADA','ROMANEIO'));

-- 2) Acesso -------------------------------------------------------------

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_romaneio', 'Romaneio de Retirada', NULL, 64, true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, rota = NULL, ordem = EXCLUDED.ordem, ativo = true;

-- Menu sem regra nasce aberto. Os perfis que concedem tudo recebem as três
-- ações já na mesma transação que cria o menu.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_romaneio', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
   ('visualizar'::public.app_acao),
   ('incluir'::public.app_acao),
   ('alterar'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Mantém a operação do almoxarifado no primeiro dia: quem já podia alterar
-- Pedidos de Materiais recebe as ações do romaneio como exceção individual.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'sup_romaneio', a.acao, true,
       'Migração 20260930000261: já podia alterar Pedidos de Materiais'
  FROM public.screen_permission_user s
 CROSS JOIN (VALUES
   ('visualizar'::public.app_acao),
   ('incluir'::public.app_acao),
   ('alterar'::public.app_acao)
 ) AS a(acao)
 WHERE s.menu_codigo = 'sup_pedidos_materiais'
   AND s.acao = 'alterar'::public.app_acao
   AND s.allow
   AND NOT EXISTS (
     SELECT 1
       FROM public.screen_permission_user x
      WHERE x.user_id = s.user_id
        AND x.menu_codigo = 'sup_romaneio'
        AND x.acao = a.acao
   );

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('sup_romaneio', 'visualizar'),
  ('sup_romaneio', 'incluir'),
  ('sup_romaneio', 'alterar')
ON CONFLICT DO NOTHING;

ALTER TABLE public.sup_romaneio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_romaneio_select ON public.sup_romaneio;
CREATE POLICY sup_romaneio_select ON public.sup_romaneio
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_romaneio', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
  );

GRANT SELECT ON public.sup_romaneio TO authenticated;

-- 3) Localização e gestão do romaneio ----------------------------------

CREATE OR REPLACE FUNCTION public.sup_romaneio_localizar(p_ref text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_id  uuid;
BEGIN
  IF v_ref = '' THEN RETURN NULL; END IF;

  IF v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT r.id INTO v_id FROM public.sup_romaneio r WHERE r.id = v_ref::uuid;
    RETURN v_id;
  END IF;

  SELECT r.id INTO v_id
    FROM public.sup_romaneio r
   WHERE upper(r.codigo) = upper(v_ref)
   ORDER BY r.created_at DESC
   LIMIT 1;
  RETURN v_id;
END $fn$;

REVOKE ALL ON FUNCTION public.sup_romaneio_localizar(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sup_romaneio_criar(
  p_pedido_ids uuid[],
  p_volumes integer,
  p_observacao text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid            uuid := auth.uid();
  v_nome           text;
  v_romaneio       public.sup_romaneio%ROWTYPE;
  v_total_esperado integer;
  v_total_encontrado integer;
  v_contratos      integer;
  v_contrato_id    uuid;
  v_contrato_nome  text;
  v_status_invalidos integer;
  v_com_romaneio   integer;
  v_sem_contrato   integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_romaneio', 'incluir') THEN
    RAISE EXCEPTION 'Seu usuário não pode criar romaneios. Peça a liberação de "Romaneio de Retirada" em Acesso por Usuário.';
  END IF;
  IF p_volumes IS NOT NULL AND p_volumes <= 0 THEN
    RAISE EXCEPTION 'A quantidade de volumes deve ser maior que zero.';
  END IF;

  SELECT count(DISTINCT ids.id) INTO v_total_esperado
    FROM unnest(COALESCE(p_pedido_ids, ARRAY[]::uuid[])) AS ids(id);
  IF v_total_esperado = 0 THEN
    RAISE EXCEPTION 'Selecione pelo menos um pedido para o romaneio.';
  END IF;

  -- A ordem fixa dos locks evita deadlock quando dois operadores tentam
  -- agrupar conjuntos sobrepostos no mesmo instante.
  PERFORM p.id
    FROM public.sup_pedido p
   WHERE p.id = ANY(p_pedido_ids)
   ORDER BY p.id
   FOR UPDATE;

  -- count(DISTINCT contrato_id) ignora NULL: sem o contador próprio, um
  -- pedido sem contrato entraria junto com pedidos do contrato X.
  --
  -- "Já em romaneio" é só romaneio ABERTO. Um pedido que saiu num romaneio
  -- RETIRADO e voltou para AGUARDANDO ENVIO (Compras voltou o status) ainda
  -- aponta para o romaneio antigo e precisa poder entrar num novo; o vínculo
  -- antigo continua no histórico do pedido.
  SELECT count(*), count(DISTINCT p.contrato_id), min(p.contrato_id::text)::uuid,
         min(p.contrato_nome),
         count(*) FILTER (WHERE p.status <> 'AGUARDANDO ENVIO'),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.sup_romaneio r
            WHERE r.id = p.romaneio_id AND r.status = 'ABERTO')),
         count(*) FILTER (WHERE p.contrato_id IS NULL)
    INTO v_total_encontrado, v_contratos, v_contrato_id, v_contrato_nome,
         v_status_invalidos, v_com_romaneio, v_sem_contrato
    FROM public.sup_pedido p
   WHERE p.id = ANY(p_pedido_ids);

  IF v_total_encontrado <> v_total_esperado THEN
    RAISE EXCEPTION 'Um ou mais pedidos selecionados não existem.';
  END IF;
  IF v_contrato_id IS NULL OR v_contratos <> 1 OR v_sem_contrato > 0 THEN
    RAISE EXCEPTION 'O romaneio só pode reunir pedidos do mesmo contrato.';
  END IF;
  IF v_status_invalidos > 0 THEN
    RAISE EXCEPTION 'Todos os pedidos do romaneio devem estar em Aguardando envio.';
  END IF;
  IF v_com_romaneio > 0 THEN
    RAISE EXCEPTION 'Um ou mais pedidos já pertencem a outro romaneio.';
  END IF;

  v_nome := COALESCE(public.sup_est_nome_usuario(), auth.jwt()->>'email', 'Usuário');

  INSERT INTO public.sup_romaneio
    (contrato_id, contrato_nome, volumes, observacao, criado_por, criado_por_nome)
  VALUES
    (v_contrato_id, v_contrato_nome, p_volumes, nullif(btrim(p_observacao), ''), v_uid, v_nome)
  RETURNING * INTO v_romaneio;

  UPDATE public.sup_pedido p
     SET romaneio_id = v_romaneio.id
   WHERE p.id = ANY(p_pedido_ids);

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_anterior, status_novo, observacao,
     alterado_por, alterado_por_nome)
  SELECT p.id, 'ROMANEIO', p.status, p.status,
         format('Pedido incluído no romaneio %s por %s.', v_romaneio.codigo, v_nome),
         v_uid, v_nome
    FROM public.sup_pedido p
   WHERE p.id = ANY(p_pedido_ids);

  RETURN jsonb_build_object(
    'id', v_romaneio.id,
    'codigo', v_romaneio.codigo,
    'contrato_id', v_romaneio.contrato_id,
    'contrato_nome', v_romaneio.contrato_nome,
    'status', v_romaneio.status,
    'volumes', v_romaneio.volumes,
    'observacao', v_romaneio.observacao,
    'created_at', v_romaneio.created_at
  );
END $fn$;

CREATE OR REPLACE FUNCTION public.sup_romaneio_remover_pedido(
  p_romaneio uuid,
  p_pedido uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_nome     text;
  v_romaneio public.sup_romaneio%ROWTYPE;
  v_pedido   public.sup_pedido%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_romaneio', 'alterar') THEN
    RAISE EXCEPTION 'Seu usuário não pode alterar romaneios.';
  END IF;

  SELECT * INTO v_romaneio
    FROM public.sup_romaneio r
   WHERE r.id = p_romaneio
   FOR UPDATE;
  IF v_romaneio.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
  IF v_romaneio.status <> 'ABERTO' THEN
    RAISE EXCEPTION 'Só é possível remover pedidos de um romaneio aberto.';
  END IF;

  SELECT * INTO v_pedido
    FROM public.sup_pedido p
   WHERE p.id = p_pedido
   FOR UPDATE;
  IF v_pedido.id IS NULL OR v_pedido.romaneio_id IS DISTINCT FROM p_romaneio THEN
    RAISE EXCEPTION 'O pedido não pertence a este romaneio.';
  END IF;

  v_nome := COALESCE(public.sup_est_nome_usuario(), auth.jwt()->>'email', 'Usuário');
  UPDATE public.sup_pedido SET romaneio_id = NULL WHERE id = p_pedido;
  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_anterior, status_novo, observacao,
     alterado_por, alterado_por_nome)
  VALUES
    (p_pedido, 'ROMANEIO', v_pedido.status, v_pedido.status,
     format('Pedido removido do romaneio %s por %s.', v_romaneio.codigo, v_nome),
     v_uid, v_nome);

  RETURN jsonb_build_object('romaneio_id', p_romaneio, 'pedido_id', p_pedido, 'removido', true);
END $fn$;

CREATE OR REPLACE FUNCTION public.sup_romaneio_cancelar(
  p_romaneio uuid,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_nome     text;
  v_romaneio public.sup_romaneio%ROWTYPE;
  v_motivo   text := nullif(btrim(p_motivo), '');
  v_total    integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_romaneio', 'alterar') THEN
    RAISE EXCEPTION 'Seu usuário não pode cancelar romaneios.';
  END IF;
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;

  SELECT * INTO v_romaneio
    FROM public.sup_romaneio r
   WHERE r.id = p_romaneio
   FOR UPDATE;
  IF v_romaneio.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
  IF v_romaneio.status <> 'ABERTO' THEN
    RAISE EXCEPTION 'Só é possível cancelar um romaneio aberto.';
  END IF;

  PERFORM p.id
    FROM public.sup_pedido p
   WHERE p.romaneio_id = p_romaneio
   ORDER BY p.id
   FOR UPDATE;

  v_nome := COALESCE(public.sup_est_nome_usuario(), auth.jwt()->>'email', 'Usuário');
  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_anterior, status_novo, observacao,
     alterado_por, alterado_por_nome)
  SELECT p.id, 'ROMANEIO', p.status, p.status,
         format('Pedido removido porque o romaneio %s foi cancelado por %s. Motivo: %s',
                v_romaneio.codigo, v_nome, v_motivo),
         v_uid, v_nome
    FROM public.sup_pedido p
   WHERE p.romaneio_id = p_romaneio;
  GET DIAGNOSTICS v_total = ROW_COUNT;

  UPDATE public.sup_pedido SET romaneio_id = NULL WHERE romaneio_id = p_romaneio;
  UPDATE public.sup_romaneio
     SET status = 'CANCELADO', cancelado_em = now(),
         cancelado_por_nome = v_nome, motivo_cancelamento = v_motivo
   WHERE id = p_romaneio;

  RETURN jsonb_build_object('id', p_romaneio, 'codigo', v_romaneio.codigo,
                            'status', 'CANCELADO', 'pedidos_liberados', v_total);
END $fn$;

-- 4) Leitura e confirmação da retirada ---------------------------------

CREATE OR REPLACE FUNCTION public.sup_retirada_tipo(p_ref text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'A retirada exige login com um usuário do sistema.';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_retirada_entrega', 'visualizar') THEN
    RAISE EXCEPTION 'Seu usuário não tem acesso a "Retirada para Entrega". Peça a liberação em Acesso por Usuário.';
  END IF;

  IF public.sup_romaneio_localizar(p_ref) IS NOT NULL THEN RETURN 'ROMANEIO'; END IF;
  IF public.sup_retirada_localizar(p_ref) IS NOT NULL THEN RETURN 'PEDIDO'; END IF;
  RETURN NULL;
END $fn$;

CREATE OR REPLACE FUNCTION public.sup_retirada_romaneio_consultar(p_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_id       uuid;
  v_romaneio public.sup_romaneio%ROWTYPE;
  v_pedidos  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'A retirada exige login com um usuário do sistema.';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_retirada_entrega', 'visualizar') THEN
    RAISE EXCEPTION 'Seu usuário não tem acesso a "Retirada para Entrega". Peça a liberação em Acesso por Usuário.';
  END IF;

  v_id := public.sup_romaneio_localizar(p_ref);
  IF v_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_romaneio FROM public.sup_romaneio r WHERE r.id = v_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'pedido_id', p.pedido_id,
           'status', p.status,
           'nome_colaborador', p.nome_colaborador,
           'contrato_nome', p.contrato_nome,
           'posto_nome', p.posto_nome,
           'funcao_nome', p.funcao_nome,
           'retirado_em', p.retirado_em,
           'retirado_por_nome', p.retirado_por_nome,
           'itens', (
             SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'nome_item', i.nome_item,
               'tamanho', i.tamanho,
               'quantidade', i.quantidade,
               'litros', i.litros
             ) ORDER BY i.ordem), '[]'::jsonb)
             FROM public.sup_pedido_item i
             WHERE i.pedido_id = p.id
           )
         ) ORDER BY p.pedido_id), '[]'::jsonb)
    INTO v_pedidos
    FROM public.sup_pedido p
   WHERE p.romaneio_id = v_id;

  RETURN jsonb_build_object(
    'id', v_romaneio.id,
    'codigo', v_romaneio.codigo,
    'contrato_id', v_romaneio.contrato_id,
    'contrato_nome', v_romaneio.contrato_nome,
    'status', v_romaneio.status,
    'volumes', v_romaneio.volumes,
    'observacao', v_romaneio.observacao,
    'pedidos', v_pedidos,
    'retirado_em', v_romaneio.retirado_em,
    'retirado_por_nome', v_romaneio.retirado_por_nome,
    'usuario_nome', COALESCE(public.sup_est_nome_usuario(), auth.jwt()->>'email'),
    'pode_confirmar', v_romaneio.status = 'ABERTO'
      AND public.can_access(v_uid, 'sup_retirada_entrega', 'incluir')
  );
END $fn$;

-- Miolo exclusivo do fluxo novo. As RPCs antigas permanecem intactas para
-- abas que já estavam abertas durante o deploy da migration.
CREATE OR REPLACE FUNCTION public.sup_retirada_registrar(
  v_id uuid,
  v_uid uuid,
  v_nome text,
  v_agora timestamptz,
  ficha boolean,
  cracha boolean,
  origem text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_pedido_id text;
  v_status    text;
BEGIN
  SELECT p.pedido_id, p.status INTO v_pedido_id, v_status
    FROM public.sup_pedido p
   WHERE p.id = v_id;

  UPDATE public.sup_pedido p
     SET status = 'RETIRADO PARA ENTREGA',
         retirado_em = v_agora,
         retirado_por = v_uid,
         retirado_por_nome = v_nome
   WHERE p.id = v_id;

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_anterior, status_novo, observacao,
     alterado_por, alterado_por_nome, data_alteracao)
  VALUES
    (v_id, 'RETIRADA', v_status, 'RETIRADO PARA ENTREGA',
     format('%s retirou para entrega o pedido %s em %s via romaneio %s. Ficha de EPI física: %s. Crachá físico: %s.',
            v_nome, v_pedido_id,
            to_char(v_agora AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'),
            origem,
            CASE WHEN ficha THEN 'Sim' ELSE 'Não' END,
            CASE WHEN cracha THEN 'Sim' ELSE 'Não' END),
     v_uid, v_nome, v_agora);
END $fn$;

REVOKE ALL ON FUNCTION public.sup_retirada_registrar(uuid, uuid, text, timestamptz, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sup_retirada_romaneio_confirmar(
  p_ref text,
  p_pedidos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_nome      text;
  v_id        uuid;
  v_romaneio  public.sup_romaneio%ROWTYPE;
  v_agora     timestamptz := now();
  v_pedido    record;
  v_resposta  record;
  v_retirados jsonb := '[]'::jsonb;
  v_removidos jsonb := '[]'::jsonb;
  v_pulados   jsonb := '[]'::jsonb;
  v_desconhecidos integer;
  v_duplicados integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'A retirada exige login com um usuário do sistema.';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_retirada_entrega', 'incluir') THEN
    RAISE EXCEPTION 'Seu usuário não pode confirmar retirada. Peça a liberação de "Retirada para Entrega" em Acesso por Usuário.';
  END IF;
  IF p_pedidos IS NULL OR jsonb_typeof(p_pedidos) <> 'array' THEN
    RAISE EXCEPTION 'A lista de pedidos do romaneio é inválida.';
  END IF;

  v_id := public.sup_romaneio_localizar(p_ref);
  IF v_id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado: %', p_ref; END IF;

  SELECT * INTO v_romaneio
    FROM public.sup_romaneio r
   WHERE r.id = v_id
   FOR UPDATE;

  IF v_romaneio.status = 'RETIRADO' THEN
    RETURN jsonb_build_object(
      'ja_retirado', true,
      'codigo', v_romaneio.codigo,
      'retirado_em', v_romaneio.retirado_em,
      'retirado_por_nome', v_romaneio.retirado_por_nome,
      'retirados', '[]'::jsonb,
      'removidos', '[]'::jsonb,
      'pulados', '[]'::jsonb
    );
  END IF;
  IF v_romaneio.status <> 'ABERTO' THEN
    RAISE EXCEPTION 'O romaneio % foi cancelado e não pode ser retirado.', v_romaneio.codigo;
  END IF;

  SELECT count(*) INTO v_desconhecidos
    FROM jsonb_to_recordset(p_pedidos) AS x(pedido_id uuid, retirado boolean,
      ficha_epi_fisica boolean, cracha_fisico boolean)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.sup_pedido p
      WHERE p.id = x.pedido_id AND p.romaneio_id = v_id
   );
  IF v_desconhecidos > 0 THEN
    RAISE EXCEPTION 'A confirmação contém pedido que não pertence ao romaneio.';
  END IF;

  SELECT count(*) - count(DISTINCT x.pedido_id) INTO v_duplicados
    FROM jsonb_to_recordset(p_pedidos) AS x(pedido_id uuid, retirado boolean,
      ficha_epi_fisica boolean, cracha_fisico boolean);
  IF v_duplicados > 0 THEN RAISE EXCEPTION 'A confirmação contém pedido duplicado.'; END IF;

  PERFORM p.id
    FROM public.sup_pedido p
   WHERE p.romaneio_id = v_id
   ORDER BY p.id
   FOR UPDATE;

  v_nome := COALESCE(public.sup_est_nome_usuario(), auth.jwt()->>'email', 'Usuário');

  FOR v_pedido IN
    SELECT p.id, p.pedido_id, p.status
      FROM public.sup_pedido p
     WHERE p.romaneio_id = v_id
     ORDER BY p.pedido_id
  LOOP
    SELECT x.* INTO v_resposta
      FROM jsonb_to_recordset(p_pedidos) AS x(pedido_id uuid, retirado boolean,
        ficha_epi_fisica boolean, cracha_fisico boolean)
     WHERE x.pedido_id = v_pedido.id;

    -- A situação atual vence a marcação da tela: pedido retirado pelo QR
    -- individual ou cancelado no meio da conferência é sempre reportado como
    -- pulado, mesmo que o supervisor também o tenha desmarcado.
    IF v_pedido.status <> 'AGUARDANDO ENVIO' THEN
      UPDATE public.sup_pedido SET romaneio_id = NULL WHERE id = v_pedido.id;
      INSERT INTO public.sup_pedido_historico
        (pedido_id, acao, status_anterior, status_novo, observacao,
         alterado_por, alterado_por_nome, data_alteracao)
      VALUES
        (v_pedido.id, 'ROMANEIO', v_pedido.status, v_pedido.status,
         format('Pedido retirado do romaneio %s durante a conferência porque estava em %s.',
                v_romaneio.codigo, v_pedido.status),
         v_uid, v_nome, v_agora);
      v_pulados := v_pulados || jsonb_build_array(jsonb_build_object(
        'pedido_id', v_pedido.pedido_id,
        'motivo', format('Situação atual: %s', v_pedido.status)));
      CONTINUE;
    END IF;

    -- Ausência no payload equivale a desmarcado. Isso evita deixar um pedido
    -- preso a um romaneio que será fechado por uma versão antiga da tela.
    IF v_resposta.pedido_id IS NULL OR NOT COALESCE(v_resposta.retirado, false) THEN
      UPDATE public.sup_pedido SET romaneio_id = NULL WHERE id = v_pedido.id;
      INSERT INTO public.sup_pedido_historico
        (pedido_id, acao, status_anterior, status_novo, observacao,
         alterado_por, alterado_por_nome, data_alteracao)
      VALUES
        (v_pedido.id, 'ROMANEIO', v_pedido.status, v_pedido.status,
         format('Pedido desmarcado na conferência do romaneio %s por %s.', v_romaneio.codigo, v_nome),
         v_uid, v_nome, v_agora);
      v_removidos := v_removidos || jsonb_build_array(jsonb_build_object(
        'pedido_id', v_pedido.pedido_id, 'motivo', 'Desmarcado na conferência'));
      CONTINUE;
    END IF;

    IF v_resposta.ficha_epi_fisica IS NULL OR v_resposta.cracha_fisico IS NULL THEN
      RAISE EXCEPTION 'Informe Ficha de EPI física e Crachá físico para o pedido %.', v_pedido.pedido_id;
    END IF;

    PERFORM public.sup_retirada_registrar(
      v_pedido.id, v_uid, v_nome, v_agora,
      v_resposta.ficha_epi_fisica, v_resposta.cracha_fisico,
      v_romaneio.codigo
    );
    v_retirados := v_retirados || jsonb_build_array(jsonb_build_object(
      'pedido_id', v_pedido.pedido_id, 'status', 'RETIRADO PARA ENTREGA'));
  END LOOP;

  UPDATE public.sup_romaneio
     SET status = 'RETIRADO', retirado_em = v_agora,
         retirado_por = v_uid, retirado_por_nome = v_nome
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'ja_retirado', false,
    'codigo', v_romaneio.codigo,
    'retirado_em', v_agora,
    'retirado_por_nome', v_nome,
    'retirados', v_retirados,
    'removidos', v_removidos,
    'pulados', v_pulados
  );
END $fn$;

-- 5) Despacho -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sup_romaneio_despachar(
  p_romaneio uuid,
  p_envio jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_romaneio  public.sup_romaneio%ROWTYPE;
  v_pedido    record;
  v_despachados jsonb := '[]'::jsonb;
  v_pulados     jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;

  SELECT * INTO v_romaneio
    FROM public.sup_romaneio r
   WHERE r.id = p_romaneio
   FOR UPDATE;
  IF v_romaneio.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
  IF v_romaneio.status <> 'RETIRADO' THEN
    RAISE EXCEPTION 'O romaneio precisa estar retirado antes do despacho.';
  END IF;

  -- sup_est_baixar percorre somente os elementos de p_baixas para tocar em
  -- sup_estoque_tag/sup_estoque_consumo. Com [] o laço não executa, portanto
  -- nenhum consumo já gravado é desfeito. Reutilizar a função mantém ainda
  -- as guardas SUPERVISOR/CORREIO, o rastreio obrigatório e o UPDATE que
  -- dispara uma comprovação PENDENTE para cada pedido.
  --
  -- A observação do pedido VAI JUNTO, e não NULL: sup_est_baixar grava
  -- "observacao = nullif(p_observacao, '')" sempre que o status muda. Com
  -- NULL, despachar o romaneio apagava a observação do Compras em todos os
  -- pedidos (achado na revisão, provado em Postgres local antes do deploy).
  FOR v_pedido IN
    SELECT p.id, p.pedido_id, p.status, p.observacao
      FROM public.sup_pedido p
     WHERE p.romaneio_id = p_romaneio
     ORDER BY p.id
     FOR UPDATE
  LOOP
    IF v_pedido.status <> 'RETIRADO PARA ENTREGA' THEN
      v_pulados := v_pulados || jsonb_build_array(jsonb_build_object(
        'pedido_id', v_pedido.pedido_id,
        'motivo', format('Situação atual: %s', v_pedido.status)));
      CONTINUE;
    END IF;

    PERFORM public.sup_est_baixar(v_pedido.id, 'DESPACHADO', v_pedido.observacao, '[]'::jsonb, p_envio);
    v_despachados := v_despachados || jsonb_build_array(jsonb_build_object(
      'pedido_id', v_pedido.pedido_id, 'status', 'DESPACHADO'));
  END LOOP;

  RETURN jsonb_build_object(
    'codigo', v_romaneio.codigo,
    'despachados', v_despachados,
    'pulados', v_pulados
  );
END $fn$;

-- 6) Privilégios --------------------------------------------------------

REVOKE ALL ON FUNCTION public.sup_romaneio_criar(uuid[], integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_romaneio_remover_pedido(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_romaneio_cancelar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_retirada_tipo(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_retirada_romaneio_consultar(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_retirada_romaneio_confirmar(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_romaneio_despachar(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sup_romaneio_criar(uuid[], integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_romaneio_remover_pedido(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_romaneio_cancelar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_retirada_tipo(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_retirada_romaneio_consultar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_retirada_romaneio_confirmar(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_romaneio_despachar(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
