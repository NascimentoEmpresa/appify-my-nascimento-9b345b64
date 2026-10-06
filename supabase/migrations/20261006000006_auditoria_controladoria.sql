-- SIS-2026-0553: Painel de Auditoria da Controladoria — checkpoint formal antes
-- da Lucratividade. A Controladoria vê os TOTAIS consolidados de 7 validações e
-- aprova ou rejeita (rejeição exige justificativa). Os totais são calculados na
-- tela; aqui fica só o que precisa de rastreabilidade: a decisão, o snapshot dos
-- valores no momento da decisão e o histórico.
--
-- Decisões fechadas com o solicitante:
--   * Aprovação por PERÍODO (mês) + EMPRESA (empresa_id NULL = todas as empresas).
--     Contrato/centro de custo só refinam a visualização, nunca viram aprovação.
--   * Responsável por validação configurável (tabela abaixo) — é quem recebe a
--     notificação in-app quando há rejeição ou pedido de revisão.
--   * A Lucratividade só ALERTA (não bloqueia) — lê o status por RPC.

-- ── 1. Validação (estado atual) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.controladoria_auditoria_validacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo date NOT NULL,                        -- sempre dia 01 do mês
  empresa_id uuid REFERENCES public.empresas(id),
  tipo text NOT NULL CHECK (tipo IN (
    'malote_fluxo', 'fluxo_extrato', 'centros_malote', 'orcado_realizado',
    'faturado', 'recebido', 'descontos'
  )),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  justificativa text,
  observacao text,
  valores jsonb,                                -- totais mostrados no momento da decisão
  decidido_por uuid REFERENCES auth.users(id),
  decidido_por_nome text,
  decidido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auditoria_rejeicao_com_justificativa
    CHECK (status <> 'rejeitado' OR length(btrim(coalesce(justificativa, ''))) >= 5)
);

-- 1 linha por período + empresa + validação (NULL de empresa = grupo todo).
CREATE UNIQUE INDEX IF NOT EXISTS uq_auditoria_validacao
  ON public.controladoria_auditoria_validacao (periodo, COALESCE(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo);

-- ── 2. Histórico (tudo que acontece, nunca é apagado) ─────────────────────
CREATE TABLE IF NOT EXISTS public.controladoria_auditoria_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo date NOT NULL,
  empresa_id uuid REFERENCES public.empresas(id),
  tipo text,                                    -- NULL = observação geral do período
  acao text NOT NULL CHECK (acao IN ('aprovado', 'rejeitado', 'reaberto', 'revisao_solicitada', 'observacao')),
  status_anterior text,
  status_novo text,
  justificativa text,
  observacao text,
  valores jsonb,
  user_id uuid REFERENCES auth.users(id),
  user_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_historico_periodo
  ON public.controladoria_auditoria_historico (periodo, created_at DESC);

-- ── 3. Responsáveis por validação (quem é sinalizado) ─────────────────────
CREATE TABLE IF NOT EXISTS public.controladoria_auditoria_responsavel (
  tipo text PRIMARY KEY CHECK (tipo IN (
    'malote_fluxo', 'fluxo_extrato', 'centros_malote', 'orcado_realizado',
    'faturado', 'recebido', 'descontos'
  )),
  user_ids uuid[] NOT NULL DEFAULT '{}',
  nomes text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- ── 4. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.controladoria_auditoria_validacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controladoria_auditoria_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controladoria_auditoria_responsavel ENABLE ROW LEVEL SECURITY;

-- Leitura por quem vê a tela. Escrita das validações/histórico SÓ pela RPC
-- auditoria_registrar (SECURITY DEFINER) — nenhuma policy de INSERT/UPDATE.
DROP POLICY IF EXISTS auditoria_validacao_select ON public.controladoria_auditoria_validacao;
CREATE POLICY auditoria_validacao_select ON public.controladoria_auditoria_validacao
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'auditoria-controladoria', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS auditoria_historico_select ON public.controladoria_auditoria_historico;
CREATE POLICY auditoria_historico_select ON public.controladoria_auditoria_historico
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'auditoria-controladoria', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS auditoria_responsavel_select ON public.controladoria_auditoria_responsavel;
CREATE POLICY auditoria_responsavel_select ON public.controladoria_auditoria_responsavel
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'auditoria-controladoria', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS auditoria_responsavel_escrita ON public.controladoria_auditoria_responsavel;
CREATE POLICY auditoria_responsavel_escrita ON public.controladoria_auditoria_responsavel
  FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'auditoria-controladoria', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'auditoria-controladoria', 'alterar'::public.app_acao));

-- ── 5. RPC: registrar decisão / revisão / observação ──────────────────────
-- _acao: aprovar | rejeitar | reabrir | solicitar_revisao | observacao
DROP FUNCTION IF EXISTS public.auditoria_registrar(date, uuid, text, text, text, text, jsonb);
CREATE FUNCTION public.auditoria_registrar(
  _periodo date,
  _empresa uuid,
  _tipo text,
  _acao text,
  _justificativa text DEFAULT NULL,
  _observacao text DEFAULT NULL,
  _valores jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nome text;
  v_periodo date := date_trunc('month', _periodo)::date;
  v_antes text;
  v_novo text;
  v_id uuid;
  v_hist_acao text;
  v_titulo text;
  v_link text;
  v_destinos uuid[];
  v_rotulo text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _acao NOT IN ('aprovar', 'rejeitar', 'reabrir', 'solicitar_revisao', 'observacao') THEN
    RAISE EXCEPTION 'Ação inválida: %', _acao;
  END IF;
  IF _acao = 'observacao' THEN
    IF NOT public.can_access(v_uid, 'auditoria-controladoria', 'alterar'::public.app_acao) THEN
      RAISE EXCEPTION 'Sem permissão para registrar observação';
    END IF;
    IF length(btrim(coalesce(_observacao, ''))) = 0 THEN RAISE EXCEPTION 'Observação vazia'; END IF;
  ELSIF _acao IN ('aprovar', 'rejeitar', 'reabrir') THEN
    IF NOT public.can_access(v_uid, 'auditoria-controladoria', 'aprovar'::public.app_acao) THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/rejeitar validações';
    END IF;
  ELSE
    IF NOT public.can_access(v_uid, 'auditoria-controladoria', 'alterar'::public.app_acao) THEN
      RAISE EXCEPTION 'Sem permissão para solicitar revisão';
    END IF;
  END IF;
  IF _acao IN ('rejeitar', 'solicitar_revisao') AND length(btrim(coalesce(_justificativa, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe a justificativa (mínimo 5 caracteres)';
  END IF;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;

  -- Observação geral do período (sem validação específica).
  IF _acao = 'observacao' THEN
    INSERT INTO public.controladoria_auditoria_historico (periodo, empresa_id, tipo, acao, observacao, user_id, user_nome)
    VALUES (v_periodo, _empresa, NULL, 'observacao', btrim(_observacao), v_uid, v_nome)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF _tipo NOT IN ('malote_fluxo', 'fluxo_extrato', 'centros_malote', 'orcado_realizado', 'faturado', 'recebido', 'descontos') THEN
    RAISE EXCEPTION 'Validação inválida: %', _tipo;
  END IF;

  -- Garante a linha da validação (nasce pendente) e trava para a decisão.
  INSERT INTO public.controladoria_auditoria_validacao (periodo, empresa_id, tipo)
  VALUES (v_periodo, _empresa, _tipo)
  ON CONFLICT (periodo, (COALESCE(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid)), tipo) DO NOTHING;

  SELECT id, status INTO v_id, v_antes
    FROM public.controladoria_auditoria_validacao
   WHERE periodo = v_periodo
     AND empresa_id IS NOT DISTINCT FROM _empresa
     AND tipo = _tipo
   FOR UPDATE;

  IF _acao = 'aprovar' THEN
    v_novo := 'aprovado'; v_hist_acao := 'aprovado';
  ELSIF _acao = 'rejeitar' THEN
    v_novo := 'rejeitado'; v_hist_acao := 'rejeitado';
  ELSIF _acao = 'reabrir' THEN
    v_novo := 'pendente'; v_hist_acao := 'reaberto';
  ELSE
    v_novo := v_antes; v_hist_acao := 'revisao_solicitada';
  END IF;

  IF _acao <> 'solicitar_revisao' THEN
    UPDATE public.controladoria_auditoria_validacao
       SET status = v_novo,
           justificativa = CASE WHEN _acao = 'rejeitar' THEN btrim(_justificativa) ELSE NULL END,
           observacao = NULLIF(btrim(coalesce(_observacao, '')), ''),
           valores = CASE WHEN _acao = 'reabrir' THEN NULL ELSE _valores END,
           decidido_por = CASE WHEN _acao = 'reabrir' THEN NULL ELSE v_uid END,
           decidido_por_nome = CASE WHEN _acao = 'reabrir' THEN NULL ELSE v_nome END,
           decidido_em = CASE WHEN _acao = 'reabrir' THEN NULL ELSE now() END,
           updated_at = now()
     WHERE id = v_id;
  END IF;

  INSERT INTO public.controladoria_auditoria_historico
    (periodo, empresa_id, tipo, acao, status_anterior, status_novo, justificativa, observacao, valores, user_id, user_nome)
  VALUES
    (v_periodo, _empresa, _tipo, v_hist_acao, v_antes, v_novo, NULLIF(btrim(coalesce(_justificativa, '')), ''),
     NULLIF(btrim(coalesce(_observacao, '')), ''), _valores, v_uid, v_nome);

  -- Sinaliza o(s) responsável(is) da validação quando há rejeição ou pedido de revisão.
  IF _acao IN ('rejeitar', 'solicitar_revisao') THEN
    SELECT user_ids INTO v_destinos FROM public.controladoria_auditoria_responsavel WHERE tipo = _tipo;
    v_rotulo := CASE _tipo
      WHEN 'malote_fluxo' THEN 'Malote x Fluxo de Caixa'
      WHEN 'fluxo_extrato' THEN 'Fluxo de Caixa x Extrato'
      WHEN 'centros_malote' THEN 'Centros de Custo x Malote'
      WHEN 'orcado_realizado' THEN 'Orçado x Realizado'
      WHEN 'faturado' THEN 'Notas Faturadas x Falta Faturar'
      WHEN 'recebido' THEN 'Notas Recebidas x Falta Receber'
      ELSE 'Descontos dos Contratos' END;
    v_link := CASE _tipo
      WHEN 'malote_fluxo' THEN '/app/financeiro/gestao-financeira/fluxo-caixa'
      WHEN 'fluxo_extrato' THEN '/app/financeiro/gestao-financeira/conciliacao-fluxo-caixa'
      WHEN 'centros_malote' THEN '/app/controladoria/centros-custo'
      WHEN 'orcado_realizado' THEN '/app/malote/orcamento-geral'
      ELSE '/app/financeiro/relatorio-servicos' END;
    v_titulo := CASE WHEN _acao = 'rejeitar'
      THEN 'Controladoria rejeitou: ' || v_rotulo
      ELSE 'Controladoria pediu revisão: ' || v_rotulo END;
    IF v_destinos IS NOT NULL AND array_length(v_destinos, 1) > 0 THEN
      INSERT INTO public.notificacoes (user_id, empresa_id, titulo, mensagem, tipo, link)
      -- empresa da notificação = a do destinatário (a validação pode ser do grupo todo).
      SELECT DISTINCT pr.id, COALESCE(_empresa, pr.empresa_id), v_titulo,
             to_char(v_periodo, 'MM/YYYY') || ' — ' || btrim(_justificativa),
             'auditoria_controladoria', v_link
        FROM unnest(v_destinos) AS uid
        JOIN public.profiles pr ON pr.id = uid
       WHERE pr.id IS DISTINCT FROM v_uid;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.auditoria_registrar(date, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditoria_registrar(date, uuid, text, text, text, text, jsonb) TO authenticated;

-- ── 6. RPC: status do período para a Lucratividade (sem valores) ──────────
-- Qualquer usuário autenticado pode ver SE o período foi validado — não os
-- valores nem as justificativas. Por isso é SECURITY DEFINER e devolve só
-- status e carimbo.
DROP FUNCTION IF EXISTS public.auditoria_status_periodo(date, uuid);
CREATE FUNCTION public.auditoria_status_periodo(_periodo date, _empresa uuid DEFAULT NULL)
RETURNS TABLE (tipo text, status text, decidido_em timestamptz, decidido_por_nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.tipo, v.status, v.decidido_em, v.decidido_por_nome
    FROM public.controladoria_auditoria_validacao v
   WHERE v.periodo = date_trunc('month', _periodo)::date
     AND v.empresa_id IS NOT DISTINCT FROM _empresa;
$$;
REVOKE ALL ON FUNCTION public.auditoria_status_periodo(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditoria_status_periodo(date, uuid) TO authenticated;

-- ── 7. Menu e permissões ──────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'auditoria-controladoria', 'Auditoria da Controladoria', '/app/controladoria/auditoria', 53
  FROM public.app_modulo m WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Sem seed o menu novo nasce aberto a qualquer autenticado (RouteGuard): semeia
-- só os perfis que concedem tudo; o resto é liberado por usuário em Administração.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'auditoria-controladoria', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('aprovar'::public.app_acao),
    ('exportar'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.auditoria_status_periodo(date, uuid);
--   DROP FUNCTION IF EXISTS public.auditoria_registrar(date, uuid, text, text, text, text, jsonb);
--   DROP TABLE IF EXISTS public.controladoria_auditoria_responsavel;
--   DROP TABLE IF EXISTS public.controladoria_auditoria_historico;
--   DROP TABLE IF EXISTS public.controladoria_auditoria_validacao;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'auditoria-controladoria';
--   DELETE FROM public.app_menu WHERE codigo = 'auditoria-controladoria';
--   NOTIFY pgrst, 'reload schema';
