-- =========================================================================
-- Recrutamento: histórico completo da solicitação + acesso por filtro
-- (Pendente Recrutamento / Pendente Seleção).
--
-- Pedido do Pablo (23/09/2026):
--   1) "os analistas estão aprovando e não tá aparecendo no histórico — todo
--      tipo de alteração relacionada à solicitação tem que aparecer";
--   2) novo filtro "Pendente Seleção" na Gestão Recrutamento e, em Acesso
--      por Usuário, quem vê cada um dos filtros "Pendente Recrutamento" e
--      "Pendente Seleção" — só organização da tela, não segurança.
--
-- 1) POR QUE SUMIA. O histórico era gravado pela TELA, num insert que
--    engole o erro, e a policy de INSERT do RECRUTAMENTO_HISTORICO só
--    conhecia a Gestão Recrutamento (e algumas telas). O analista aprova em
--    Licitações › Analistas (licitacoes_analistas_recrutamento): o insert
--    batia na RLS e morria calado. Conferido no banco: as aprovações da
--    analista (#249, #258, #263, #264) tinham ZERO eventos. O mesmo valia
--    para Diretoria, Novas Admissões, Banco de Talentos, EPIs de Admissão e
--    Jurídico › Candidatos. E a criação da vaga nunca foi registrada.
--
--    Correção em duas camadas:
--    a) GATILHO na SISTEMA_RECRUTAMENTO (rec_historico_automatico): toda
--       criação, mudança de status e edição de campo vira evento, venha de
--       qualquer tela, RPC ou gatilho (inclusive o status que o candidato
--       move sozinho, sr_sync_status_solicitacao). Não depende de a tela
--       lembrar de gravar nem de RLS — é SECURITY DEFINER.
--       Com isso a tela deixa de gravar aprovar/reprovar/concluir (era
--       duplicado; commit do mesmo dia).
--    b) Policies de INSERT/SELECT do histórico passam a reconhecer as telas
--       que faltavam, para os eventos de CANDIDATO (que continuam gravados
--       pelas telas: movimentação no kanban, roteiro, documento...).
--
-- 2) Menus fantasmas (rota NULL) no módulo recrutamento — aparecem em
--    Administração › Acesso por Usuário. Como o acesso é deny-by-default,
--    quem JÁ usa a Gestão Recrutamento (visualizar) recebe os dois, para
--    nenhum filtro sumir de quem já tinha; a partir daí é tirar de quem não
--    deve ver.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1a) Gatilho de histórico ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_historico_automatico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text;
  v_email  text;
  v_evento text;
  v_papel  text;
  v_detalhe text;
  v_mud    text[];
  k        text;
  v_de     text;
  v_para   text;
  -- Campos técnicos ou já cobertos pelo evento de status: não viram "edição".
  v_ignorar text[] := ARRAY['status', 'status_changed_at', 'updated_at', 'created_at', 'id',
                            'aprovado_por_nome', 'aprovado_por_email', 'motivo_reprovacao',
                            'legado_chave'];
  -- Nome legível de cada campo no detalhe da edição.
  v_rotulo jsonb := '{
    "motivo_vaga":"Motivo", "nome_substituido":"Substituído", "contrato":"Contrato", "cargo":"Cargo",
    "estado":"Estado", "cidade":"Cidade", "quantidade_vagas":"Quantidade", "data_inicio_prevista":"Data de início",
    "escala":"Escala", "horario":"Horário", "salario":"Salário", "insalubridade_recebe":"Insalubridade",
    "insalubridade_quanto":"Valor insalubridade", "beneficios":"Benefícios", "local_exato":"Local",
    "grau_urgencia":"Urgência", "alta_rotatividade":"Alta rotatividade", "req_obrigatorios":"Requisitos obrigatórios",
    "req_desejaveis":"Requisitos desejáveis", "exp_minima":"Experiência mínima", "exp_minima_qual":"Qual experiência",
    "motivos_saida":"Motivos de saída", "recomendacao":"Recomendação", "observacao_importante":"Observação",
    "solicitante_nome":"Solicitante", "analista_nome":"Analista", "funcionario_selecionado":"Selecionado",
    "contratado_nome":"Contratado", "contratado_contato":"Contato do contratado", "contratado_data_inicio":"Início do contratado",
    "etiquetas":"Etiquetas", "cnh_obrigatoria":"CNH obrigatória", "data_inicio_alteracoes":"Remarcação da data de início",
    "administrativa":"Administrativa", "setor":"Setor", "reposicao_tecnica":"Reserva técnica", "reserva_tecnica":"Reserva técnica",
    "tem_recomendacao":"Tem recomendação", "recomendacao_nome":"Nome da recomendação", "demissao_id":"Demissão vinculada",
    "contrato_id":"Contrato (cadastro)", "posto_id":"Posto", "funcao_id":"Função"
  }'::jsonb;
BEGIN
  -- Carga do sistema antigo (Discord) já traz o próprio histórico.
  IF TG_OP = 'INSERT' AND NEW.legado_chave IS NOT NULL THEN RETURN NEW; END IF;

  IF v_uid IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(display_name), ''), email), email INTO v_nome, v_email
      FROM public.profiles WHERE id = v_uid;
  END IF;
  v_nome := coalesce(v_nome, 'Sistema');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, de_status, para_status, papel, usuario_nome, usuario_email)
    VALUES (NEW.id, 'Solicitação criada', NULL, NEW.status, 'Solicitante', v_nome, v_email);
    RETURN NEW;
  END IF;

  -- Mudança de status
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_detalhe := NULL;
    IF NEW.status = 'Reprovada' THEN
      v_evento := 'Solicitação reprovada';
      v_papel  := CASE OLD.status WHEN 'Pendente Analista' THEN 'Analista' WHEN 'Pendente Diretoria' THEN 'Diretoria'
                                  WHEN 'Pendente Operacional' THEN 'Operacional' ELSE 'Recrutamento' END;
      v_detalhe := nullif(btrim(coalesce(NEW.motivo_reprovacao, '')), '');
    ELSIF OLD.status = 'Pendente Analista' AND NEW.status = 'Pendente Recrutamento' THEN
      v_evento := 'Aprovada pelo Analista';     v_papel := 'Analista';
    ELSIF OLD.status = 'Pendente Diretoria' AND NEW.status = 'Pendente Recrutamento' THEN
      v_evento := 'Aprovada pela Diretoria';    v_papel := 'Diretoria';
    ELSIF OLD.status = 'Pendente Operacional' THEN
      v_evento := 'Aprovada pelo Operacional';  v_papel := 'Operacional';
    ELSIF OLD.status = 'Pendente Recrutamento' AND NEW.status = 'Vaga aberta - Seleção de Currículos' THEN
      v_evento := 'Abertura de vaga confirmada'; v_papel := 'Recrutamento';
    ELSIF NEW.status IN ('Concluída', 'Contratado') OR NEW.status LIKE 'Concluído%' THEN
      v_evento := 'Solicitação concluída';      v_papel := 'Recrutamento';
    ELSIF NEW.status = 'Cancelada' THEN
      v_evento := 'Solicitação cancelada';      v_papel := NULL;
    ELSE
      -- Andamento dirigido pelo candidato mais adiantado (sr_sync_status_solicitacao).
      v_evento := 'Status da vaga atualizado';  v_papel := 'Recrutamento';
    END IF;
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, de_status, para_status, papel, usuario_nome, usuario_email, detalhe)
    VALUES (NEW.id, v_evento, OLD.status, NEW.status, v_papel, v_nome, v_email, v_detalhe);
  END IF;

  -- Edição de campos
  v_mud := ARRAY[]::text[];
  FOR k IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
    CONTINUE WHEN k = ANY (v_ignorar);
    IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
      v_de   := left(coalesce(to_jsonb(OLD) ->> k, '—'), 80);
      v_para := left(coalesce(to_jsonb(NEW) ->> k, '—'), 80);
      v_mud  := v_mud || format('%s: %s → %s', coalesce(v_rotulo ->> k, k), v_de, v_para);
    END IF;
  END LOOP;
  IF array_length(v_mud, 1) > 0 THEN
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, papel, usuario_nome, usuario_email, detalhe)
    VALUES (NEW.id,
            CASE WHEN array_length(v_mud, 1) = 1 THEN 'Solicitação editada (1 campo)'
                 ELSE format('Solicitação editada (%s campos)', array_length(v_mud, 1)) END,
            NULL, v_nome, v_email, array_to_string(v_mud, E'\n'));
  END IF;

  RETURN NEW;
END $fn$;

REVOKE ALL ON FUNCTION public.rec_historico_automatico() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_rec_historico_automatico ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_historico_automatico
  AFTER INSERT OR UPDATE ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_historico_automatico();

-- ── 1b) Telas que gravam/leem histórico de candidato ─────────────────
-- Policies novas, PERMISSIVAS: somam às que já existiam (não mexe nelas).
DROP POLICY IF EXISTS recrutamento_historico_insert_telas ON public."RECRUTAMENTO_HISTORICO";
CREATE POLICY recrutamento_historico_insert_telas ON public."RECRUTAMENTO_HISTORICO"
  FOR INSERT TO authenticated
  WITH CHECK (
    has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento'::text, 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento'::text, 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'rh_novas_admissoes'::text, 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'rh_banco_talentos'::text, 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'sup_epis_admissao'::text, 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'juridico_candidatos'::text, 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'candidatos'::text, 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'sst_aso'::text, 'visualizar'::app_acao)
  );

-- O botão Histórico/Status também abre na fila do analista e da Diretoria.
DROP POLICY IF EXISTS recrutamento_historico_select_telas ON public."RECRUTAMENTO_HISTORICO";
CREATE POLICY recrutamento_historico_select_telas ON public."RECRUTAMENTO_HISTORICO"
  FOR SELECT TO authenticated
  USING (
    has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento'::text, 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento'::text, 'visualizar'::app_acao)
  );

-- ── 2) Acesso por filtro na Gestão Recrutamento ──────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, v.codigo, v.nome, NULL, v.ordem, true
  FROM public.app_modulo m
 CROSS JOIN (VALUES
   ('recrutamento_filtro_pend_recrutamento', 'Filtro: Pendente Recrutamento', 26),
   ('recrutamento_filtro_pend_selecao',      'Filtro: Pendente Seleção',      27)
 ) AS v(codigo, nome, ordem)
 WHERE m.codigo = 'recrutamento'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.modulo_id = m.id AND x.codigo = v.codigo);

-- Quem já usa a Gestão Recrutamento continua vendo os dois filtros.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, v.codigo, 'visualizar'::app_acao, true,
       'Semeado na criação do filtro (mig 20260930000225): já tinha a Gestão Recrutamento'
  FROM public.screen_permission_user s
 CROSS JOIN (VALUES ('recrutamento_filtro_pend_recrutamento'), ('recrutamento_filtro_pend_selecao')) AS v(codigo)
 WHERE s.menu_codigo = 'recrutamento_gestao' AND s.acao = 'visualizar'::app_acao AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = v.codigo AND x.acao = 'visualizar'::app_acao);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_rec_historico_automatico ON public."SISTEMA_RECRUTAMENTO";
-- DROP FUNCTION IF EXISTS public.rec_historico_automatico();
-- DROP POLICY IF EXISTS recrutamento_historico_insert_telas ON public."RECRUTAMENTO_HISTORICO";
-- DROP POLICY IF EXISTS recrutamento_historico_select_telas ON public."RECRUTAMENTO_HISTORICO";
-- DELETE FROM public.screen_permission_user WHERE menu_codigo IN ('recrutamento_filtro_pend_recrutamento', 'recrutamento_filtro_pend_selecao');
-- DELETE FROM public.app_menu WHERE codigo IN ('recrutamento_filtro_pend_recrutamento', 'recrutamento_filtro_pend_selecao');
-- NOTIFY pgrst, 'reload schema';
