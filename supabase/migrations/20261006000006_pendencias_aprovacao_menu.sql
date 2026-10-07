-- =========================================================================
-- BOLINHA DE PENDÊNCIA DE APROVAÇÃO NO MENU (06/10/2026)
--
-- PEDIDO: "seria possível aparecer uma notificação de pendência de
-- aprovação, só uma bolinha vermelha, como aparece no Jurídico — tenho
-- várias situações que dependem da minha aprovação; se o pessoal não me
-- avisar ou eu ficar entrando a todo momento pra ver, fica lá parado".
-- Escolhidos: Malote, Recrutamento (vagas), Demissões, Plano de Ações e
-- Suprimentos (Jurídico, Reembolso, Mudança de Função e Chamados já tinham).
--
-- minhas_pendencias_aprovacao() devolve { "<rota do menu>": quantidade } só
-- do que está parado NA ETAPA QUE EU DECIDO — a mesma regra que cada tela e
-- cada trigger usam para deixar aprovar. Uma chamada só para o menu inteiro,
-- em vez de cada bolinha baixar a tabela toda (o Malote calculava a alçada
-- no navegador com milhares de despesas). O menu (useAprovacoesNotif)
-- acende a bolinha onde a contagem > 0; a sidebar já esconde o que a pessoa
-- não enxerga.
--
--   Malote › Aprovações (e Diretoria › Aprovações do Malote)
--     pendente_aprovacao no nível atual em que sou aprovador — forma de
--     pagamento com fluxo especial manda (aprovador_especial_user_id); sem
--     classificação na despesa, vale a das linhas do rateio
--     (= souAprovadorDoNivelComRateio, useMaloteDespesa.ts); e a fase de
--     solicitação (aguardando_aprovacao_inicial / cotacao_realizada) para
--     o "Aprovador da solicitação" da classificação.
--   Recrutamento
--     'Pendente Analista' → quem tem APROVA VAGAS (Operacional e/ou
--     Licitações — rec_aprova_vagas, separado por tela);
--     'Pendente Diretoria' → diretoria_recrutamento aprovar + setor
--     (aprova_setor, o mesmo do rec_guard_aprovador_setor).
--   Demissões (STATUS_DE_ACAO de PainelDemissoes)
--     Operacional 'Pendente Operacional'; Diretoria 'Pendente Diretoria'
--     (+ aprova_setor, como ssd_guard_aprovador_setor); RH 'Pendente RH' e
--     'Cancelamento solicitado'; SST 'Pendente SST' e a recebida.
--   Plano de Ações › Aprovações
--     'aguardando_validacao' para quem pode_aprovar ou é quem validaria
--     (podeValidarPlanoAcao: o criador; sem criador, o responsável).
--   Suprimentos
--     Aprovação de Catálogo: lotes PENDENTE (sup_cat_decidir_lote);
--     Cadastros de Fornecedor: 'pendente' (sup_forn_aprovar).
--   Votação de cotações (sup_aprov_*) ficou de fora: tabela vazia e sem
--   item no menu.
--
-- Só conta — não devolve nenhum dado das linhas.
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.minhas_pendencias_aprovacao()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb := '{}'::jsonb;
  n int;
BEGIN
  IF v_uid IS NULL THEN RETURN v_out; END IF;

  -- ── Malote ─────────────────────────────────────────────────────────────
  SELECT count(*) INTO n
    FROM public.malote_despesa d
    LEFT JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
    LEFT JOIN LATERAL (
      SELECT true AS tem, f.aprovador_especial_user_id FROM public.malote_forma_pagamento f
       WHERE f.nome = d.forma_pagamento AND f.fluxo_aprovacao = 'especial' LIMIT 1
    ) esp ON true
   WHERE d.deleted_at IS NULL
     AND (
       (d.status = 'pendente_aprovacao' AND d.nivel_aprovacao_atual IS NOT NULL AND (
          CASE
            WHEN esp.tem THEN esp.aprovador_especial_user_id IS NOT DISTINCT FROM v_uid AND v_uid IS NOT NULL
            WHEN d.classificacao_id IS NOT NULL THEN
              v_uid = ANY (CASE d.nivel_aprovacao_atual WHEN 1 THEN c.aprovador1_user_ids WHEN 2 THEN c.aprovador2_user_ids ELSE c.aprovador3_user_ids END)
            ELSE EXISTS (
              SELECT 1 FROM public.malote_despesa_rateio_linha r
                JOIN public.planejamento_orcamentario_classificacao c2 ON c2.id = r.classificacao_id
               WHERE r.despesa_id = d.id
                 AND v_uid = ANY (CASE d.nivel_aprovacao_atual WHEN 1 THEN c2.aprovador1_user_ids WHEN 2 THEN c2.aprovador2_user_ids ELSE c2.aprovador3_user_ids END))
          END))
       OR (d.status IN ('aguardando_aprovacao_inicial', 'cotacao_realizada') AND c.aprovador_solicitacao_user_id = v_uid)
     );
  IF n > 0 THEN
    v_out := v_out || jsonb_build_object('/app/malote/aprovacoes', n, '/app/diretoria/malote-aprovacoes', n);
  END IF;

  -- ── Recrutamento (vagas) ──────────────────────────────────────────────
  IF public.has_screen_access(v_uid, 'operacional_aprova_vagas', 'aprovar'::public.app_acao)
     OR public.has_screen_access(v_uid, 'licitacoes_aprova_vagas', 'aprovar'::public.app_acao) THEN
    SELECT count(*) INTO n FROM public."SISTEMA_RECRUTAMENTO" WHERE status = 'Pendente Analista';
    IF n > 0 THEN
      IF public.has_screen_access(v_uid, 'operacional_aprova_vagas', 'aprovar'::public.app_acao) THEN
        v_out := v_out || jsonb_build_object('/app/operacional/recrutamento', n);
      END IF;
      IF public.has_screen_access(v_uid, 'licitacoes_aprova_vagas', 'aprovar'::public.app_acao) THEN
        v_out := v_out || jsonb_build_object('/app/licitacoes/analistas/recrutamento', n);
      END IF;
    END IF;
  END IF;
  IF public.has_screen_access(v_uid, 'diretoria_recrutamento', 'aprovar'::public.app_acao) THEN
    SELECT count(*) INTO n FROM public."SISTEMA_RECRUTAMENTO" WHERE status = 'Pendente Diretoria' AND public.aprova_setor(setor);
    IF n > 0 THEN v_out := v_out || jsonb_build_object('/app/diretoria/recrutamento', n); END IF;
  END IF;

  -- ── Demissões ─────────────────────────────────────────────────────────
  IF public.has_screen_access(v_uid, 'operacional_demissoes', 'visualizar'::public.app_acao) THEN
    SELECT count(*) INTO n FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE status = 'Pendente Operacional';
    IF n > 0 THEN v_out := v_out || jsonb_build_object('/app/operacional/solicitacoes-demissao', n); END IF;
  END IF;
  IF public.has_screen_access(v_uid, 'diretoria_solicitacoes_demissao', 'visualizar'::public.app_acao) THEN
    SELECT count(*) INTO n FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE status = 'Pendente Diretoria' AND public.aprova_setor(setor);
    IF n > 0 THEN v_out := v_out || jsonb_build_object('/app/diretoria/solicitacoes-demissao', n); END IF;
  END IF;
  IF public.has_screen_access(v_uid, 'rh_demissoes', 'visualizar'::public.app_acao) THEN
    SELECT count(*) INTO n FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE status IN ('Pendente RH', 'Cancelamento solicitado');
    IF n > 0 THEN v_out := v_out || jsonb_build_object('/app/rh/solicitacoes-demissao', n); END IF;
  END IF;
  IF public.has_screen_access(v_uid, 'sst_aso_demissional', 'visualizar'::public.app_acao) THEN
    SELECT count(*) INTO n FROM public."SISTEMA_SOLICITACOES_DEMISSAO"
     WHERE status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida');
    IF n > 0 THEN v_out := v_out || jsonb_build_object('/app/sst/aso-demissional', n); END IF;
  END IF;

  -- ── Plano de Ações ────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.plano_acao p
   WHERE p.deleted_at IS NULL AND p.status_normalizado = 'aguardando_validacao'
     AND (COALESCE((public.minha_permissao_plano_acao(p.empresa_id) ->> 'pode_aprovar')::boolean, false)
          OR p.criado_por = v_uid
          OR (p.criado_por IS NULL AND p.responsavel_profile_id = v_uid));
  IF n > 0 THEN v_out := v_out || jsonb_build_object('/app/plano-acoes/aprovacoes', n); END IF;

  -- ── Suprimentos ───────────────────────────────────────────────────────
  IF public.can_access(v_uid, 'sup_catalogo_aprovacao', 'alterar') THEN
    SELECT count(*) INTO n FROM public.sup_cat_lote WHERE status = 'PENDENTE';
    IF n > 0 THEN v_out := v_out || jsonb_build_object('/app/suprimentos/catalogo/aprovacoes', n); END IF;
  END IF;
  IF public.can_access(v_uid, 'sup_fornecedor_aprovacao', 'alterar') THEN
    SELECT count(*) INTO n FROM public.fornecedor_cadastro_pendente WHERE status = 'pendente';
    IF n > 0 THEN v_out := v_out || jsonb_build_object('/app/suprimentos/fornecedores/pendentes', n); END IF;
  END IF;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.minhas_pendencias_aprovacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_pendencias_aprovacao() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.minhas_pendencias_aprovacao();
