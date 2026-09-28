-- =========================================================================
-- Demissão: o sino avisa a CANCELADA, e ninguém pede a própria demissão
--
-- Pedido do Pablo (28/09/2026):
--   "aqui encima tem que aparecer as solicitações de demissões canceladas
--    pelos encarregados também" / "o usuario não pode solicitar demissão pra
--    ele mesmo".
--
-- 1) SINO (sino_demissao_notificar, mig 240)
--    ANTES  só o PEDIDO de cancelamento ('Cancelamento solicitado') avisava,
--           e só quem aprova no RH (rh_demissoes/aprovar). A solicitação
--           virando 'Cancelada' não avisava ninguém — e a que saía de
--           'Cancelamento solicitado' era descartada logo na 1ª linha (a
--           regra que evita repetir aviso quando o RH RECUSA o pedido).
--    AGORA  • pedido de cancelamento avisa rh_demissoes/aprovar (como antes)
--             E quem acompanha o RH (rh_demissoes/visualizar);
--           • 'Cancelada' (a pedido do encarregado e aprovada pelo RH, ou
--             direto pelo RH) avisa as filas por onde a solicitação passou:
--             Operacional sempre; Diretoria (pelo setor) se estava lá; RH se
--             já tinha chegado nele; SST se já estava no ASO. A etapa vem do
--             status anterior — ou do cancel_status_anterior quando veio de
--             'Cancelamento solicitado'.
--           Recusa do pedido (volta ao status anterior) segue sem aviso.
--    Cópia da função da mig 240 (conferida contra o banco em 28/09/2026)
--    com esses dois blocos a mais.
--
-- 2) PRÓPRIA DEMISSÃO (gatilho demissao_bloqueia_propria)
--    BEFORE INSERT: se o CPF do colaborador (só dígitos) é o do EMPREGADOS
--    vinculado a quem está logado, recusa. A tela já trava
--    (ehAPropriaPessoa em lib/demissao/solicitacao.ts); aqui é a garantia.
--    Sem login (automação/service_role) ou sem vínculo, passa.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Sino ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sino_demissao_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_quem   text := '#' || NEW.id || ' · ' || coalesce(NEW.colaborador_nome, '—')
                   || coalesce(' — ' || nullif(btrim(NEW.contrato), ''), '');
  v_origem text;
  v_msg    text;
  v_sst    text[] := ARRAY['Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida',
                           'Agendamento concluído', 'ASO válido'];
BEGIN
  -- Cancelada (mig 256): avisa as filas por onde a solicitação passou.
  IF TG_OP = 'UPDATE' AND NEW.status = 'Cancelada' AND OLD.status IS DISTINCT FROM 'Cancelada' THEN
    v_origem := CASE WHEN OLD.status = 'Cancelamento solicitado'
                     THEN coalesce(NEW.cancel_status_anterior, OLD.cancel_status_anterior, OLD.status)
                     ELSE OLD.status END;
    v_msg := v_quem || ' — cancelada'
             || coalesce(' a pedido de ' || nullif(btrim(NEW.cancel_pedido_por), ''), '')
             || coalesce(' por ' || nullif(btrim(NEW.cancelado_por), ''), '')
             || coalesce('. Motivo: ' || nullif(btrim(NEW.cancelado_motivo), ''), '.');

    PERFORM public.jur_notificar(public.jur_quem_tem('operacional_demissoes', 'visualizar'),
      '🚫 Demissão CANCELADA', v_msg, 'error', '/app/operacional/solicitacoes-demissao?abrir=' || NEW.id);
    IF v_origem = 'Pendente Diretoria' THEN
      PERFORM public.jur_notificar(public.sino_quem_tem_setor('diretoria_solicitacoes_demissao', 'visualizar', NEW.setor),
        '🚫 Demissão CANCELADA', v_msg, 'error', '/app/diretoria/solicitacoes-demissao?abrir=' || NEW.id);
    END IF;
    IF v_origem NOT IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria') THEN
      PERFORM public.jur_notificar(public.jur_quem_tem('rh_demissoes', 'visualizar'),
        '🚫 Demissão CANCELADA', v_msg, 'error', '/app/rh/solicitacoes-demissao?abrir=' || NEW.id);
    END IF;
    IF v_origem = ANY (v_sst) THEN
      PERFORM public.jur_notificar(public.jur_quem_tem('sst_aso_demissional', 'visualizar'),
        '🚫 Demissão CANCELADA — ASO não é mais necessário', v_msg, 'error', '/app/sst/aso-demissional?abrir=' || NEW.id);
    END IF;
    RETURN NEW;
  END IF;

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
    -- Quem aprova decide; quem só acompanha o RH também fica sabendo (mig 256).
    PERFORM public.jur_notificar(
      ARRAY(SELECT DISTINCT u FROM unnest(public.jur_quem_tem('rh_demissoes', 'aprovar')
                                       || public.jur_quem_tem('rh_demissoes', 'visualizar')) AS u),
      '🚫 Pedido de CANCELAMENTO de demissão',
      v_quem || ' — ' || coalesce(NEW.cancel_pedido_por, NEW.solicitante_nome, 'o solicitante')
        || ' pede para cancelar. Motivo: ' || coalesce(NEW.cancel_pedido_motivo, '—'),
      'error', '/app/rh/solicitacoes-demissao?abrir=' || NEW.id);
  END IF;
  RETURN NEW;
END $fn$;

-- ── 2) Ninguém pede a própria demissão ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.demissao_bloqueia_propria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cpf text := regexp_replace(coalesce(NEW.colaborador_cpf, ''), '\D', '', 'g');
BEGIN
  IF auth.uid() IS NULL OR length(v_cpf) <> 11 THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."EMPREGADOS" e
     WHERE e.auth_user_id = auth.uid()
       AND regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g') = v_cpf
  ) THEN
    RAISE EXCEPTION 'Você não pode solicitar a sua própria demissão. Se quer sair da empresa, fale com o seu gestor ou com o RH.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.demissao_bloqueia_propria() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_demissao_bloqueia_propria ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_bloqueia_propria
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.demissao_bloqueia_propria();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar sino_demissao_notificar() da 20260930000240;
-- DROP TRIGGER IF EXISTS trg_demissao_bloqueia_propria ON public."SISTEMA_SOLICITACOES_DEMISSAO";
-- DROP FUNCTION IF EXISTS public.demissao_bloqueia_propria();
-- NOTIFY pgrst, 'reload schema';
