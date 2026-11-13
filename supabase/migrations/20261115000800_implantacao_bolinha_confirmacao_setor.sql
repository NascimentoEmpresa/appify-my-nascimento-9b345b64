-- =====================================================================
-- [SEM-CHAMADO] — Resumo dos Contratos: bolinha vermelha no menu enquanto
--                 o setor não confirma o recebimento
--
-- PEDIDO (Pablo, 13/11/2026): "fazer com que fique aquela notificação com a
-- bolinha vermelha no módulo caso a pessoa não confirmar o recebimento em
-- seu setor" — nas 8 permissões "Resumo de Contrato <SETOR>"
-- (licitacoes-implantacao-painel-<slug>, mig 20261115000400).
--
-- O QUE CRIA
--   implantacao_confirmacao_pendente() → jsonb { rota do item do menu:
--   quantidade de contratos esperando a confirmação daquele setor }.
--   Mesmo formato do minhas_pendencias_aprovacao (useAprovacoesNotif): a
--   Sidebar acende o item pela rota e o módulo Licitações acende junto.
--
-- QUANDO UM CONTRATO CONTA (espelho de src/lib/implantacao/notifConfirmacao.ts
-- e do "prontoParaConfirmar" de painelSetores.ts)
--   • contrato com status 'ativo' (encerrado não espera ninguém);
--   • TODAS as perguntas do setor (as dele + as "Todos") respondidas — antes
--     disso o botão "Confirmar recebimento" fica desabilitado e a bolinha
--     seria um aviso que ninguém consegue apagar;
--   • nenhuma linha em "IMPLANTACAO_SETOR_CONFIRMACAO" para o contrato+setor.
--   Some quando o setor confirma. Confirmação DESATUALIZADA (resposta mudou
--   depois) não acende: a assinatura é calculada no front e o banco não sabe
--   recalculá-la — a tela continua avisando "confirme de novo".
--
-- QUEM VÊ
--   Quem tem 'visualizar' no menu do setor (can_access — acesso por pessoa,
--   README). Sem nenhum dos 8, a função sai na primeira linha sem tocar em
--   tabela nenhuma (a Sidebar chama para todo mundo).
--
-- SETOR DA PERGUNTA = responsavel_acao partido em "/" com os mesmos apelidos
-- do front ("Operação"/"Operacao" → Operacional; "Todos" = comum a todos).
--
-- DESEMPENHO: uma consulta por conjunto (sem laço por contrato). Índices já
-- existentes cobrem os joins: checklist_respostas UNIQUE(contrato_id,
-- row_index) e "IMPLANTACAO_SETOR_CONFIRMACAO" UNIQUE(contrato_id, setor).
--
-- Leve (1 função). Idempotente. ROLLBACK no fim.
-- =====================================================================
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.implantacao_confirmacao_pendente()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_slugs  text[];
  v_saida  jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- Setores cujo painel a pessoa pode ver.
  SELECT array_agg(s) INTO v_slugs
    FROM unnest(ARRAY['compras','financeiro','licitacao','operacional',
                      'recrutamento','rh','sst','treinamentos']) AS s
   WHERE public.can_access(v_uid, 'licitacoes-implantacao-painel-' || s, 'visualizar'::app_acao);

  IF v_slugs IS NULL THEN RETURN '{}'::jsonb; END IF;

  WITH partes AS (
    -- Cada pergunta × cada setor do "Resp. ação".
    SELECT i.row_index,
           CASE lower(regexp_replace(btrim(p), '\s+', ' ', 'g'))
             WHEN 'operação'    THEN 'Operacional'
             WHEN 'operacao'    THEN 'Operacional'
             WHEN 'operacional' THEN 'Operacional'
             WHEN 'todos'       THEN 'Todos'
             ELSE regexp_replace(btrim(p), '\s+', ' ', 'g')
           END AS setor
      FROM public.checklist_items i
      CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.responsavel_acao, ''), '/') AS p
     WHERE btrim(p) <> ''
  ),
  setores AS (
    -- Nome do setor + slug da URL (mesma conta do slugSetor do front).
    SELECT DISTINCT setor,
           btrim(regexp_replace(
             translate(lower(setor), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
             '[^a-z0-9]+', '-', 'g'), '-') AS slug
      FROM partes
     WHERE setor <> 'Todos'
  ),
  alvo AS (
    SELECT * FROM setores WHERE slug = ANY (v_slugs)
  ),
  itens_do_setor AS (
    -- Perguntas de cada setor: as dele e as comuns.
    SELECT DISTINCT a.setor, a.slug, p.row_index
      FROM alvo a
      JOIN partes p ON p.setor = a.setor OR p.setor = 'Todos'
  ),
  pendentes AS (
    SELECT a.slug, c.id AS contrato_id
      FROM alvo a
      CROSS JOIN public.implantacao_contrato c
     WHERE c.status = 'ativo'
       AND NOT EXISTS (
             SELECT 1 FROM public."IMPLANTACAO_SETOR_CONFIRMACAO" k
              WHERE k.contrato_id = c.id AND k.setor = a.setor)
       -- Pronto para confirmar: nenhuma pergunta do setor sem resposta.
       AND NOT EXISTS (
             SELECT 1 FROM itens_do_setor d
              WHERE d.setor = a.setor
                AND NOT EXISTS (
                      SELECT 1 FROM public.checklist_respostas r
                       WHERE r.contrato_id = c.id
                         AND r.empresa_id  = c.empresa_id
                         AND r.row_index   = d.row_index
                         AND r.resposta ~ '\S'))
  )
  SELECT coalesce(jsonb_object_agg('/app/licitacoes/implantacao/painel/' || slug, n), '{}'::jsonb)
    INTO v_saida
    FROM (SELECT slug, count(*)::int AS n FROM pendentes GROUP BY slug) t;

  RETURN v_saida;
END;
$$;

REVOKE ALL ON FUNCTION public.implantacao_confirmacao_pendente() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.implantacao_confirmacao_pendente() FROM anon;
GRANT EXECUTE ON FUNCTION public.implantacao_confirmacao_pendente() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.implantacao_confirmacao_pendente();
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
