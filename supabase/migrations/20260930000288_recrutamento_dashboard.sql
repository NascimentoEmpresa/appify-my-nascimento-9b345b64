-- =========================================================================
-- Recrutamento e Seleção › DASHBOARD RECRUTAMENTO (02/10/2026)
--
-- Pedido do Pablo: "desenvolve um dashboard COMPLETO sobre o sistema de
-- RECRUTAMENTO E SELEÇÃO, submódulo novo > Dashboard Recrutamento", com a
-- referência do painel em Power BI que o RH usava (total de vagas, em
-- andamento, em atenção, em processo, no prazo, atrasadas com ação imediata
-- e a tabela "vagas atrasadas e próximas" com dias que faltam e candidato).
--
-- O Dashboard antigo (rh_recrutamento_dashboard, /app/rh/recrutamento-
-- dashboard) continua de pé — este é outro menu, com permissão própria.
--
-- Uma RPC só (recrut_dashboard_dados) devolve tudo de uma vez — vagas,
-- candidatos, marcos do histórico e tempos por etapa — em vez de quatro
-- SELECTs paginados pela RLS: a tela abre num round-trip só (ver "telas
-- devem carregar instantâneo"). Formato COLUNAR (um cabeçalho + uma lista
-- por linha) e datas até o minuto, no fuso de São Paulo: com objeto por
-- linha a resposta passava de 880 KB, quase tudo nome de chave repetido. A RPC repete a regra de visibilidade da RLS
-- de SISTEMA_RECRUTAMENTO: vaga administrativa só para quem tem
-- recrutamento_vaga_administrativa ou diretoria_recrutamento.
--
-- Quem já via o Dashboard antigo ganha este (mesmas ações). E o histórico
-- (RECRUTAMENTO_HISTORICO) ganha uma policy de leitura para este menu — o
-- clique numa vaga abre o mesmo "Status" da Gestão Recrutamento, que lê dali.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── A tela ───────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'recrutamento_dashboard', 'Dashboard Recrutamento', '/app/rh/recrutamento/dashboard', 4, true
  FROM public.app_modulo m
 WHERE m.codigo = 'recrutamento'
ON CONFLICT (modulo_id, codigo) DO NOTHING;
UPDATE public.app_menu SET ativo = true WHERE codigo = 'recrutamento_dashboard';

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'recrutamento_dashboard', s.acao, true,
       'Migração 20260930000288: já via o Dashboard de Recrutamento antigo'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'rh_recrutamento_dashboard' AND s.allow
   AND s.acao IN ('visualizar'::public.app_acao, 'exportar'::public.app_acao)
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'recrutamento_dashboard' AND x.acao = s.acao);

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT p.perfil_id, 'recrutamento_dashboard', p.acao, true
  FROM public.perfil_acesso_permissao p
 WHERE p.menu_codigo = 'rh_recrutamento_dashboard' AND p.allow
   AND p.acao IN ('visualizar'::public.app_acao, 'exportar'::public.app_acao)
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = p.perfil_id AND x.menu_codigo = 'recrutamento_dashboard' AND x.acao = p.acao);

-- ── O "Status" da vaga lê o histórico ────────────────────────────────────
DROP POLICY IF EXISTS recrutamento_historico_select_dashboard ON public."RECRUTAMENTO_HISTORICO";
CREATE POLICY recrutamento_historico_select_dashboard ON public."RECRUTAMENTO_HISTORICO" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'recrutamento_dashboard', 'visualizar'::public.app_acao));

-- ── Os dados ─────────────────────────────────────────────────────────────
-- aprovada_em = primeiro evento de aprovação da etapa 1 (inclui o legado do
-- Discord, "Operação aprovou", que tem data real); aberta_em = "Abertura de
-- vaga confirmada"; o fim (contratada/reprovada) é o status_changed_at.
-- Data/hora local (São Paulo) até o minuto, "YYYY-MM-DDTHH:MI".
CREATE OR REPLACE FUNCTION public.recrut_dash_ts(_t timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT to_char(_t AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI');
$f$;

CREATE OR REPLACE FUNCTION public.recrut_dashboard_dados()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_adm boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'recrutamento_dashboard', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Dashboard Recrutamento. Peça em Administração › Acesso por Usuário.'
      USING ERRCODE = '42501';
  END IF;
  v_adm := public.has_screen_access(v_uid, 'recrutamento_vaga_administrativa', 'visualizar'::public.app_acao)
        OR public.has_screen_access(v_uid, 'diretoria_recrutamento', 'visualizar'::public.app_acao);

  RETURN jsonb_build_object(
    'gerado_em', public.recrut_dash_ts(now()),
    'vagas_colunas', jsonb_build_array('id', 'criada', 'status', 'mudou', 'cargo', 'contrato', 'cidade', 'qtd',
                                       'motivo', 'urgencia', 'prevista', 'escala', 'horario', 'local', 'solicitante',
                                       'administrativa', 'contratado', 'contratado_inicio', 'substituido', 'legado',
                                       'aprovada_em', 'aberta_em'),
    'vagas', coalesce((
      SELECT jsonb_agg(jsonb_build_array(
               r.id, public.recrut_dash_ts(r.created_at), r.status, public.recrut_dash_ts(r.status_changed_at),
               r.cargo, r.contrato, r.cidade, coalesce(r.quantidade_vagas, 1),
               r.motivo_vaga, r.grau_urgencia, left(r.data_inicio_prevista, 40), left(r.escala, 40), left(r.horario, 60),
               left(r.local_exato, 90), r.solicitante_nome, coalesce(r.administrativa, false),
               nullif(btrim(coalesce(nullif(btrim(r.contratado_nome), ''), r.funcionario_selecionado, '')), ''),
               left(r.contratado_data_inicio, 20), r.nome_substituido, r.legado_chave IS NOT NULL,
               public.recrut_dash_ts(m.aprovada_em), public.recrut_dash_ts(m.aberta_em))
             ORDER BY r.id)
        FROM public."SISTEMA_RECRUTAMENTO" r
        LEFT JOIN LATERAL (
          SELECT min(h.created_at) FILTER (WHERE h.evento IN ('Operação aprovou', 'Aprovada pelo Analista',
                                                             'Aprovada pelo Operacional', 'Aprovada pela Diretoria')) AS aprovada_em,
                 min(h.created_at) FILTER (WHERE h.evento = 'Abertura de vaga confirmada') AS aberta_em
            FROM public."RECRUTAMENTO_HISTORICO" h
           WHERE h.solicitacao_id = r.id
        ) m ON true
       WHERE NOT coalesce(r.administrativa, false) OR v_adm), '[]'::jsonb),
    'candidatos_colunas', jsonb_build_array('id', 'vaga_id', 'criado', 'etapa', 'etapa_em', 'nome', 'tipo', 'desistiu', 'admitido_em'),
    'candidatos', coalesce((
      SELECT jsonb_agg(jsonb_build_array(
               c.id, c.vaga_id, public.recrut_dash_ts(c.created_at), c.etapa_processo,
               public.recrut_dash_ts(c.etapa_changed_at), c.nome, c.tipo_candidatura,
               coalesce(c.desistiu, false), public.recrut_dash_ts(coalesce(c.admitido_em, c.enviado_admissao_em))))
        FROM public."WA_CURRICULOS" c
       WHERE c.vaga_id IS NULL
          OR EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" r
                      WHERE r.id = c.vaga_id AND (NOT coalesce(r.administrativa, false) OR v_adm))), '[]'::jsonb),
    'tempos', coalesce((
      SELECT jsonb_agg(jsonb_build_object('etapa', t.etapa, 'n', t.n, 'media', t.media, 'mediana', t.mediana) ORDER BY t.n DESC)
        FROM (SELECT l.status_anterior AS etapa, count(*) AS n,
                     round(avg(l.dias_no_anterior)::numeric, 1) AS media,
                     round((percentile_cont(0.5) WITHIN GROUP (ORDER BY l.dias_no_anterior))::numeric, 1) AS mediana
                FROM public."SISTEMA_RECRUTAMENTO_STATUS_LOG" l
               WHERE l.status_anterior IS NOT NULL AND l.dias_no_anterior IS NOT NULL
               GROUP BY l.status_anterior) t), '[]'::jsonb)
  );
END $fn$;

REVOKE ALL ON FUNCTION public.recrut_dashboard_dados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recrut_dashboard_dados() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.recrut_dashboard_dados();
-- DROP FUNCTION IF EXISTS public.recrut_dash_ts(timestamptz);
-- DROP POLICY IF EXISTS recrutamento_historico_select_dashboard ON public."RECRUTAMENTO_HISTORICO";
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'recrutamento_dashboard';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'recrutamento_dashboard';
-- DELETE FROM public.app_menu                WHERE codigo      = 'recrutamento_dashboard';
-- NOTIFY pgrst, 'reload schema';
