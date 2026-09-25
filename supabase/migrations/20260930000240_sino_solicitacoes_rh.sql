-- =========================================================================
-- Sino do ERP: aviso quando chega SOLICITAÇÃO na fila de quem trata
--
-- PEDIDO (25/09/2026, Pablo)
--   "Tem que adicionar notificações lá em cima quando receber solicitações
--   dos sistemas, qualquer sistema que o usuário tenha permissão. Tipo
--   solicitações de demissão, de férias, etc. E ao clicar transfere pro
--   sistema da notificação."
--
-- O sino (public.notificacoes / Topbar) já avisava Malote, Compras, Atas,
-- Reembolso, Diárias, Parecer Jurídico e Advertências (mig 083, 185...).
-- Faltavam as solicitações de RH. Entram aqui, no mesmo desenho da 185:
-- gatilho AFTER INSERT / UPDATE OF status que, quando a solicitação CHEGA
-- numa fila, avisa quem tem a permissão daquela tela
-- (malote_usuarios_com_acesso — exceção individual ou perfil; o "concede
-- tudo" do administrador fica de fora, senão o admin recebe tudo de todos) e
-- nunca quem fez a ação (jur_notificar pula auth.uid()).
--
-- O `link` leva à tela da fila. Na demissão vai com ?abrir=<id> e o painel
-- já abre o card.
--
-- QUEM RECEBE O QUÊ
--   Demissão ........ Pendente Operacional → operacional_demissoes
--                     Pendente Diretoria   → diretoria_solicitacoes_demissao (pelo setor)
--                     Pendente RH          → rh_demissoes
--                     Pendente SST         → sst_aso_demissional
--                     Cancelamento solicitado → rh_demissoes/aprovar (🚫, vermelho)
--   Férias .......... Pendente             → rh_ferias/alterar
--   Mudança de função Pendente Operacional → operacional_troca_funcao
--                     Pendente Escritório  → diretoria_troca_funcao / escritorio_troca_funcao (pelo setor)
--                     Pendente SST         → sst_troca_funcao
--                     Pendente RH          → rh_troca_funcao
--   Vaga ............ Pendente Analista    → licitacoes_analistas_recrutamento
--                     Pendente Operacional → operacional_recrutamento
--                     Pendente Diretoria   → diretoria_recrutamento (pelo setor)
--                     Pendente Recrutamento→ recrutamento_gestao
--
-- Filas por setor (Diretoria): a mesma regra de aprova_setor — quem não tem
-- setor marcado em Acesso por Usuário vê todos; quem tem, só os dele.
--
-- Volta de um pedido de cancelamento recusado (Cancelamento solicitado →
-- status anterior) NÃO avisa de novo: não é solicitação nova. Vaga importada
-- do sistema antigo (legado_chave) também não.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── Helpers ──────────────────────────────────────────────────────────────
-- aprova_setor para OUTRO usuário (a original olha auth.uid()).
CREATE OR REPLACE FUNCTION public.aprova_setor_de(_user uuid, _setor text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.cs_reembolso_norm_setor(_setor) IS NULL
      OR NOT EXISTS (SELECT 1 FROM public."SISTEMA_APROVADOR_SETOR" a WHERE a.user_id = _user)
      OR EXISTS (
        SELECT 1 FROM public."SISTEMA_APROVADOR_SETOR" a
         WHERE a.user_id = _user
           AND public.cs_reembolso_norm_setor(a.setor) = public.cs_reembolso_norm_setor(_setor)
      );
$fn$;
REVOKE ALL ON FUNCTION public.aprova_setor_de(uuid, text) FROM PUBLIC, anon;

-- Quem tem a permissão da tela E trata aquele setor, como array.
CREATE OR REPLACE FUNCTION public.sino_quem_tem_setor(_menu text, _acao public.app_acao, _setor text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce(array_agg(u), '{}'::uuid[])
    FROM public.malote_usuarios_com_acesso(_menu, _acao) AS u
   WHERE public.aprova_setor_de(u, _setor);
$fn$;
REVOKE ALL ON FUNCTION public.sino_quem_tem_setor(text, public.app_acao, text) FROM PUBLIC, anon;

-- ── Demissão ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sino_demissao_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_quem text := '#' || NEW.id || ' · ' || coalesce(NEW.colaborador_nome, '—')
                 || coalesce(' — ' || nullif(btrim(NEW.contrato), ''), '');
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.status IS NOT DISTINCT FROM OLD.status OR OLD.status = 'Cancelamento solicitado') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Pendente Operacional' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('operacional_demissoes', 'visualizar'),
      'Nova solicitação de demissão', v_quem || ' — aguardando a aprovação do Operacional.',
      'info', '/app/operacional/solicitacoes-demissao?abrir=' || NEW.id);
  ELSIF NEW.status = 'Pendente Diretoria' THEN
    PERFORM public.jur_notificar(public.sino_quem_tem_setor('diretoria_solicitacoes_demissao', 'visualizar', NEW.setor),
      'Nova solicitação de demissão', v_quem || coalesce(' (setor ' || nullif(btrim(NEW.setor), '') || ')', '') || ' — aguardando a Diretoria.',
      'info', '/app/diretoria/solicitacoes-demissao?abrir=' || NEW.id);
  ELSIF NEW.status = 'Pendente RH' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('rh_demissoes', 'visualizar'),
      'Demissão aprovada — aguardando o RH', v_quem || ' — confira e libere para o SST.',
      'info', '/app/rh/solicitacoes-demissao?abrir=' || NEW.id);
  ELSIF NEW.status = 'Pendente SST' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('sst_aso_demissional', 'visualizar'),
      'ASO demissional a agendar', v_quem || ' — liberada pelo RH.',
      'info', '/app/sst/aso-demissional?abrir=' || NEW.id);
  ELSIF NEW.status = 'Cancelamento solicitado' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('rh_demissoes', 'aprovar'),
      '🚫 Pedido de CANCELAMENTO de demissão',
      v_quem || ' — ' || coalesce(NEW.cancel_pedido_por, NEW.solicitante_nome, 'o solicitante')
        || ' pede para cancelar. Motivo: ' || coalesce(NEW.cancel_pedido_motivo, '—'),
      'error', '/app/rh/solicitacoes-demissao?abrir=' || NEW.id);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sino_demissao ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_sino_demissao
  AFTER INSERT OR UPDATE OF status ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.sino_demissao_notificar();

-- ── Férias ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sino_ferias_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'Pendente' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('rh_ferias', 'alterar'),
      CASE WHEN TG_OP = 'UPDATE' THEN 'Solicitação de férias reenviada' ELSE 'Nova solicitação de férias' END,
      '#' || NEW.id || ' · ' || coalesce(NEW.colaborador_nome, '—')
        || coalesce(' — saída ' || to_char(NEW.data_saida::date, 'DD/MM/YYYY'), '')
        || coalesce(', ' || NEW.dias_ferias || ' dias', '')
        || coalesce(' · pedido por ' || nullif(btrim(NEW.solicitante_nome), ''), ''),
      'info', '/app/rh/ferias');
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sino_ferias ON public."SISTEMA_SOLICITACOES_FERIAS";
CREATE TRIGGER trg_sino_ferias
  AFTER INSERT OR UPDATE OF status ON public."SISTEMA_SOLICITACOES_FERIAS"
  FOR EACH ROW EXECUTE FUNCTION public.sino_ferias_notificar();

-- ── Mudança de função ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sino_troca_funcao_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_quem text := '#' || NEW.id || ' · ' || coalesce(NEW.colaborador_nome, '—')
                 || coalesce(' — ' || nullif(btrim(NEW.cargo_atual), '') || ' → ' || nullif(btrim(NEW.cargo_novo), ''), '');
  v_dir  uuid[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'Pendente Operacional' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('operacional_troca_funcao', 'visualizar'),
      'Nova solicitação de mudança de função', v_quem, 'info', '/app/operacional/troca-funcao');
  ELSIF NEW.status = 'Pendente Escritório' THEN
    -- Duas portas para a mesma fila; quem tem as duas recebe um aviso só.
    v_dir := public.sino_quem_tem_setor('diretoria_troca_funcao', 'visualizar', NEW.setor);
    PERFORM public.jur_notificar(v_dir,
      'Nova solicitação de mudança de função', v_quem || ' (escritório)', 'info', '/app/diretoria/troca-funcao-escritorio');
    PERFORM public.jur_notificar(
      ARRAY(SELECT u FROM unnest(public.sino_quem_tem_setor('escritorio_troca_funcao', 'visualizar', NEW.setor)) AS u
             WHERE u <> ALL (v_dir)),
      'Nova solicitação de mudança de função', v_quem || ' (escritório)', 'info', '/app/rh/troca-funcao-escritorio');
  ELSIF NEW.status = 'Pendente SST' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('sst_troca_funcao', 'visualizar'),
      'Mudança de função — ASO a tratar', v_quem, 'info', '/app/sst/troca-funcao');
  ELSIF NEW.status = 'Pendente RH' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('rh_troca_funcao', 'visualizar'),
      'Mudança de função aguardando o RH', v_quem, 'info', '/app/rh/troca-funcao');
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sino_troca_funcao ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
CREATE TRIGGER trg_sino_troca_funcao
  AFTER INSERT OR UPDATE OF status ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  FOR EACH ROW EXECUTE FUNCTION public.sino_troca_funcao_notificar();

-- ── Vaga (Recrutamento) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sino_vaga_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_quem text := '#' || NEW.id || ' · ' || coalesce(nullif(btrim(NEW.cargo), ''), 'vaga')
                 || coalesce(' (' || NEW.quantidade_vagas || ')', '')
                 || coalesce(' — ' || nullif(btrim(NEW.contrato), ''), '')
                 || coalesce(' · ' || nullif(btrim(NEW.motivo_vaga), ''), '');
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.legado_chave IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.status = 'Pendente Analista' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('licitacoes_analistas_recrutamento', 'visualizar'),
      'Nova solicitação de vaga', v_quem, 'info', '/app/licitacoes/analistas/recrutamento');
  ELSIF NEW.status = 'Pendente Operacional' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('operacional_recrutamento', 'visualizar'),
      'Nova solicitação de vaga', v_quem, 'info', '/app/operacional/recrutamento');
  ELSIF NEW.status = 'Pendente Diretoria' THEN
    PERFORM public.jur_notificar(public.sino_quem_tem_setor('diretoria_recrutamento', 'visualizar', NEW.setor),
      'Nova solicitação de vaga (administrativa)', v_quem, 'info', '/app/diretoria/recrutamento');
  ELSIF NEW.status = 'Pendente Recrutamento' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('recrutamento_gestao', 'visualizar'),
      'Vaga aprovada — conferir e abrir', v_quem, 'info', '/app/rh/recrutamento');
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sino_vaga ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_sino_vaga
  AFTER INSERT OR UPDATE OF status ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.sino_vaga_notificar();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_sino_demissao ON public."SISTEMA_SOLICITACOES_DEMISSAO";
-- DROP TRIGGER IF EXISTS trg_sino_ferias ON public."SISTEMA_SOLICITACOES_FERIAS";
-- DROP TRIGGER IF EXISTS trg_sino_troca_funcao ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
-- DROP TRIGGER IF EXISTS trg_sino_vaga ON public."SISTEMA_RECRUTAMENTO";
-- DROP FUNCTION IF EXISTS public.sino_demissao_notificar();
-- DROP FUNCTION IF EXISTS public.sino_ferias_notificar();
-- DROP FUNCTION IF EXISTS public.sino_troca_funcao_notificar();
-- DROP FUNCTION IF EXISTS public.sino_vaga_notificar();
-- DROP FUNCTION IF EXISTS public.sino_quem_tem_setor(text, public.app_acao, text);
-- DROP FUNCTION IF EXISTS public.aprova_setor_de(uuid, text);
-- NOTIFY pgrst, 'reload schema';
