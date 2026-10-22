-- =====================================================================
-- CENTRAL DE SERVIÇOS › CHAMADOS DE SISTEMAS › MONITORAMENTO DE CHAMADOS
-- (22/10/2026)
--
-- PEDIDO: visão gerencial consolidada dos chamados de desenvolvimento, por
-- solicitante — tema, índice de qualidade da solicitação (0–10), efetividade
-- da entrega, ranking e leitura para a Controladoria. Alimentada direto de
-- CHAMADO_SISTEMA e das tabelas ligadas, SEM cópia do chamado e SEM pedir
-- nada novo ao solicitante.
--
-- O QUE MORA ONDE:
--   · as regras (tema por palavra-chave, notas por critério, efetividade) são
--     do front, numa lib pura com teste: src/lib/chamados/monitoramento.ts.
--     O banco só entrega os fatos (chamado + contagens + avaliações que já
--     existem) — mesma divisão do Custo das Faltas (mig 20261021000060);
--   · o que um humano corrigir (tema, complexidade, aderência, efetividade,
--     índice) vai para CHAMADO_SISTEMA_MONITOR_AJUSTE, só INSERT, com autor,
--     data e justificativa obrigatória. O último por campo vale; valor NULL
--     devolve o campo ao automático. Nunca UPDATE/DELETE: a tabela É o
--     histórico.
--
-- ACESSO (por usuário, nunca por cargo):
--   · central_servicos_chamados_monitoramento / visualizar → vê a tela;
--   · ... / alterar → faz ajuste manual.
-- Leitura via SECURITY DEFINER: a RLS de CHAMADO_SISTEMA só abre tudo para a
-- gestão (chamado_sistema_pode_ver_todos), e esta tela é de quem analisa,
-- não de quem atende — não dá para enfiá-la naquele predicado sem abrir de
-- quebra o Painel de Distribuição, eventos internos etc. A RPC de detalhe
-- devolve só a conversa (sem observação interna).
--
-- SEMENTE: tela nova nasce sem ninguém (08/10/2026). Copia quem já enxerga
-- todos os chamados — Painel de Distribuição ou Dashboard de Chamados —
-- para visualizar; quem coordena ganha também o alterar.
-- =====================================================================

-- ── 1) Menu + ação separada de "alterar" ────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'central_servicos_chamados_monitoramento', 'Monitoramento de Chamados',
       '/app/central-servicos/chamados/monitoramento', 61, true
  FROM public.app_modulo m WHERE m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('central_servicos_chamados_monitoramento', 'alterar')
ON CONFLICT DO NOTHING;

-- ── 2) Semente ──────────────────────────────────────────────────────────
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, 'central_servicos_chamados_monitoramento', a.acao, true
  FROM public.perfil_acesso_permissao pp
  CROSS JOIN LATERAL (
    SELECT 'visualizar'::public.app_acao AS acao
    UNION ALL
    SELECT 'alterar'::public.app_acao WHERE pp.menu_codigo = 'chamados_sistemas_coordenar'
  ) a
 WHERE pp.menu_codigo IN ('chamados_sistemas_painel', 'chamados_sistemas_dashboard', 'chamados_sistemas_coordenar')
   AND pp.acao = 'visualizar' AND pp.allow
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = pp.perfil_id AND x.menu_codigo = 'central_servicos_chamados_monitoramento' AND x.acao = a.acao);

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'central_servicos_chamados_monitoramento', a.acao, true,
       'Migração 20261022000180: já via todos os chamados (Painel/Dashboard/Coordenar)'
  FROM public.screen_permission_user s
  CROSS JOIN LATERAL (
    SELECT 'visualizar'::public.app_acao AS acao
    UNION ALL
    SELECT 'alterar'::public.app_acao WHERE s.menu_codigo = 'chamados_sistemas_coordenar'
  ) a
 WHERE s.menu_codigo IN ('chamados_sistemas_painel', 'chamados_sistemas_dashboard', 'chamados_sistemas_coordenar')
   AND s.acao = 'visualizar' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'central_servicos_chamados_monitoramento' AND x.acao = a.acao);

-- ── 3) Histórico de ajustes manuais ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_MONITOR_AJUSTE" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chamado_id     uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  -- Campos e faixas: CampoAjuste em src/lib/chamados/monitoramento.ts.
  campo          text NOT NULL CHECK (campo IN ('tema', 'complexidade', 'aderencia', 'efetividade', 'indice')),
  valor          text,          -- NULL = volta ao cálculo automático
  valor_anterior text,          -- o que a tela mostrava antes (automático ou ajuste anterior)
  justificativa  text NOT NULL CHECK (length(btrim(justificativa)) >= 10),
  autor_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  autor_nome     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_monitor_ajuste_chamado
  ON public."CHAMADO_SISTEMA_MONITOR_AJUSTE"(chamado_id, campo, created_at DESC);

ALTER TABLE public."CHAMADO_SISTEMA_MONITOR_AJUSTE" ENABLE ROW LEVEL SECURITY;

-- Só leitura direta; gravação exclusivamente pela RPC (valida a faixa do valor).
DROP POLICY IF EXISTS chamado_monitor_ajuste_select ON public."CHAMADO_SISTEMA_MONITOR_AJUSTE";
CREATE POLICY chamado_monitor_ajuste_select ON public."CHAMADO_SISTEMA_MONITOR_AJUSTE"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'central_servicos_chamados_monitoramento', 'visualizar'::public.app_acao));

REVOKE INSERT, UPDATE, DELETE ON public."CHAMADO_SISTEMA_MONITOR_AJUSTE" FROM anon, authenticated;
GRANT SELECT ON public."CHAMADO_SISTEMA_MONITOR_AJUSTE" TO authenticated;

-- ── 4) RPC: os fatos de cada chamado do período ─────────────────────────
-- Período pela ABERTURA (created_at, dia de Brasília). Contagens agregadas
-- uma vez por tabela (GROUP BY) e juntadas por id — nada de subconsulta por
-- linha, para a tela abrir na hora mesmo com o ano inteiro.
CREATE OR REPLACE FUNCTION public.chamados_monitoramento(p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_screen_access(auth.uid(), 'central_servicos_chamados_monitoramento', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Monitoramento de Chamados' USING ERRCODE = '42501';
  END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Período inválido.'; END IF;

  WITH ch AS (
    SELECT c.*
      FROM public."CHAMADO_SISTEMA" c
     WHERE (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate
  ),
  anx AS (
    SELECT a.chamado_id,
           count(*) FILTER (WHERE a.campo = 'abertura' AND a.evento_id IS NULL)::int AS abertura,
           count(*)::int AS total
      FROM public."CHAMADO_SISTEMA_ANEXO" a JOIN ch ON ch.id = a.chamado_id
     GROUP BY a.chamado_id
  ),
  ev AS (
    SELECT e.chamado_id,
           count(*) FILTER (WHERE e.tipo = 'comentario')::int AS comentarios,
           count(*) FILTER (WHERE e.tipo = 'solicitar_info')::int AS pedidos_info,
           count(*) FILTER (WHERE e.tipo = 'evento' AND e.texto LIKE 'Chamado reaberto%')::int AS reaberturas
      FROM public."CHAMADO_SISTEMA_EVENTO" e JOIN ch ON ch.id = e.chamado_id
     GROUP BY e.chamado_id
  ),
  -- Pesos = CRITERIOS_AVALIACAO em src/pages/chamados/types.tsx.
  av AS (
    SELECT a.chamado_id,
           (a.qualidade * 0.30 + a.prazo * 0.20 + a.comunicacao * 0.15
            + a.clareza * 0.10 + a.facilidade * 0.10 + a.satisfacao * 0.15)::numeric(4,2) AS nota
      FROM public."CHAMADO_SISTEMA_AVALIACAO" a JOIN ch ON ch.id = a.chamado_id
  ),
  avd AS (
    SELECT d.chamado_id, d.clareza, d.informacoes
      FROM public."CHAMADO_SISTEMA_AVALIACAO_DEV" d JOIN ch ON ch.id = d.chamado_id
     WHERE d.papel = 'solicitante'
  ),
  aj AS (
    SELECT x.chamado_id, jsonb_object_agg(x.campo, x.valor) AS ajustes
      FROM (SELECT DISTINCT ON (m.chamado_id, m.campo) m.chamado_id, m.campo, m.valor
              FROM public."CHAMADO_SISTEMA_MONITOR_AJUSTE" m JOIN ch ON ch.id = m.chamado_id
             ORDER BY m.chamado_id, m.campo, m.created_at DESC, m.id DESC) x
     GROUP BY x.chamado_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ch.id, 'numero', ch.numero, 'assunto', ch.assunto, 'descricao', ch.descricao,
           'categorias', ch.categorias, 'tipo_solicitacao', ch.tipo_solicitacao, 'prioridade', ch.prioridade,
           'impacto_trabalho', ch.impacto_trabalho, 'urgencia', ch.urgencia,
           'modulo_sistema', ch.modulo_sistema, 'modulo_sistema_outro', ch.modulo_sistema_outro,
           'afeta_usuarios', ch.afeta_usuarios, 'observacoes_solicitante', ch.observacoes_solicitante,
           'solicitante_id', ch.solicitante_id,
           'solicitante_nome', COALESCE(NULLIF(btrim(ch.solicitante_nome), ''), p.display_name),
           'setor', ch.setor, 'status', ch.status, 'prazo_previsto', ch.prazo_previsto,
           'concluido_em', ch.concluido_em, 'created_at', ch.created_at,
           'anexos_abertura', COALESCE(anx.abertura, 0), 'anexos_total', COALESCE(anx.total, 0),
           'comentarios', COALESCE(ev.comentarios, 0), 'pedidos_info', COALESCE(ev.pedidos_info, 0),
           'reaberturas', COALESCE(ev.reaberturas, 0),
           'aval_entrega', av.nota,
           'aval_dev_clareza', avd.clareza, 'aval_dev_informacoes', avd.informacoes,
           'validacao_aprovado', v.presidencia_aprovado, 'validacao_devolucoes', v.devolucoes,
           'ajustes', COALESCE(aj.ajustes, '{}'::jsonb)
         ) ORDER BY ch.created_at DESC), '[]'::jsonb)
    INTO r
    FROM ch
    LEFT JOIN public.profiles p ON p.id = ch.solicitante_id
    LEFT JOIN anx ON anx.chamado_id = ch.id
    LEFT JOIN ev  ON ev.chamado_id  = ch.id
    LEFT JOIN av  ON av.chamado_id  = ch.id
    LEFT JOIN avd ON avd.chamado_id = ch.id
    LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = ch.id
    LEFT JOIN aj  ON aj.chamado_id  = ch.id;
  RETURN r;
END;
$fn$;
REVOKE ALL ON FUNCTION public.chamados_monitoramento(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamados_monitoramento(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamados_monitoramento(date, date) TO authenticated;

-- ── 5) RPC: detalhe (conversa sem nota interna + histórico de ajustes) ──
CREATE OR REPLACE FUNCTION public.chamado_monitoramento_detalhe(p_chamado_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_screen_access(auth.uid(), 'central_servicos_chamados_monitoramento', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Monitoramento de Chamados' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'eventos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'tipo', e.tipo, 'texto', e.texto,
                                          'autor', p.display_name, 'created_at', e.created_at)
                       ORDER BY e.created_at)
        FROM public."CHAMADO_SISTEMA_EVENTO" e
        LEFT JOIN public.profiles p ON p.id = e.autor_id
       WHERE e.chamado_id = p_chamado_id AND e.tipo <> 'observacao_interna'), '[]'::jsonb),
    'anexos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nome', a.nome_arquivo, 'campo', a.campo, 'created_at', a.created_at)
                       ORDER BY a.created_at)
        FROM public."CHAMADO_SISTEMA_ANEXO" a
       WHERE a.chamado_id = p_chamado_id AND a.campo <> 'interno'), '[]'::jsonb),
    'ajustes', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC, m.id DESC)
        FROM public."CHAMADO_SISTEMA_MONITOR_AJUSTE" m
       WHERE m.chamado_id = p_chamado_id), '[]'::jsonb)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.chamado_monitoramento_detalhe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_monitoramento_detalhe(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_monitoramento_detalhe(uuid) TO authenticated;

-- ── 6) RPC: ajuste manual (com histórico) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_monitoramento_ajustar(
  p_chamado_id uuid, p_campo text, p_valor text, p_valor_anterior text, p_justificativa text)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_valor text := NULLIF(btrim(COALESCE(p_valor, '')), '');
  v_num   numeric;
  v_id    bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_screen_access(auth.uid(), 'central_servicos_chamados_monitoramento', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para ajustar a avaliação dos chamados' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id) THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF length(btrim(COALESCE(p_justificativa, ''))) < 10 THEN
    RAISE EXCEPTION 'Explique o ajuste (mínimo de 10 caracteres).';
  END IF;

  IF v_valor IS NOT NULL THEN
    CASE p_campo
      -- Lista = TEMAS em src/lib/chamados/monitoramento.ts.
      WHEN 'tema' THEN
        IF v_valor NOT IN ('fluxo_caixa','automatizacao','visao_estrategica','relatorios',
                           'integracoes','cadastros','correcoes','outros') THEN
          RAISE EXCEPTION 'Tema inválido: %', v_valor;
        END IF;
      WHEN 'complexidade', 'aderencia' THEN
        IF v_valor NOT IN ('baixa','media','alta') THEN RAISE EXCEPTION 'Valor inválido: %', v_valor; END IF;
      WHEN 'indice', 'efetividade' THEN
        BEGIN
          v_num := replace(v_valor, ',', '.')::numeric;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'Informe um número.';
        END;
        IF v_num < 0 OR (p_campo = 'indice' AND v_num > 10) OR v_num > 100 THEN
          RAISE EXCEPTION 'Fora da faixa (índice 0 a 10, efetividade 0 a 100).';
        END IF;
        v_valor := v_num::text;
      ELSE
        RAISE EXCEPTION 'Campo inválido: %', p_campo;
    END CASE;
  ELSIF p_campo NOT IN ('tema','complexidade','aderencia','efetividade','indice') THEN
    RAISE EXCEPTION 'Campo inválido: %', p_campo;
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_MONITOR_AJUSTE"
    (chamado_id, campo, valor, valor_anterior, justificativa, autor_id, autor_nome)
  VALUES (p_chamado_id, p_campo, v_valor, NULLIF(btrim(COALESCE(p_valor_anterior, '')), ''),
          btrim(p_justificativa), auth.uid(),
          (SELECT display_name FROM public.profiles WHERE id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.chamado_monitoramento_ajustar(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_monitoramento_ajustar(uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_monitoramento_ajustar(uuid, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.chamado_monitoramento_ajustar(uuid, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.chamado_monitoramento_detalhe(uuid);
--   DROP FUNCTION IF EXISTS public.chamados_monitoramento(date, date);
--   DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_MONITOR_AJUSTE";
--   DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'central_servicos_chamados_monitoramento';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'central_servicos_chamados_monitoramento';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'central_servicos_chamados_monitoramento';
--   DELETE FROM public.app_menu WHERE codigo = 'central_servicos_chamados_monitoramento';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
