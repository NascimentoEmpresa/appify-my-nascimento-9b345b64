-- =========================================================================
-- Férias: o encarregado REFAZ a solicitação (volta pro RH aprovar de novo)
--
-- Pedido do Pablo em 16/09/2026: em Minhas Solicitações › Detalhes e chat,
-- o encarregado passa a poder REFAZER uma solicitação de férias — corrige
-- data de saída, dias, abono e observações — e ela volta para o RH avaliar
-- (aprovar ou reprovar) outra vez. Vale por UMA SEMANA a partir da
-- solicitação; depois disso não dá mais pra refazer.
--
--  refeita_em    — quando foi refeita pela última vez (NULL = nunca).
--  refeita_vezes — quantas vezes já foi refeita.
--
-- O trigger de histórico (mig 000113) ganha o evento 'Refeita' (de <status
-- anterior> para Pendente, pelo solicitante) e é ele que TRAVA o prazo:
-- refazer depois de 7 dias da criação é recusado no banco, não só na tela.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS"
  ADD COLUMN IF NOT EXISTS refeita_em    timestamptz,
  ADD COLUMN IF NOT EXISTS refeita_vezes integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".refeita_em IS
  'Última vez que o encarregado refez a solicitação (volta a Pendente pro RH avaliar de novo). Só até 7 dias da criação.';

CREATE OR REPLACE FUNCTION public.ferias_registrar_historico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_nome text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id)
    VALUES (NEW.id, 'Criada', NULL, NEW.status, NEW.solicitante_nome, auth.uid());
    RETURN NEW;
  END IF;

  -- Refeita pelo encarregado (16/09/2026): um evento só, mesmo que o status
  -- também tenha mudado (Reprovada → Pendente) — a troca de status faz parte
  -- do refazer, não é uma decisão do RH.
  IF NEW.refeita_em IS DISTINCT FROM OLD.refeita_em AND NEW.refeita_em IS NOT NULL THEN
    IF coalesce(OLD.criado_em, now()) < now() - interval '7 days' THEN
      RAISE EXCEPTION 'Já passou uma semana da solicitação — não é mais possível refazê-la.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'Cancelada' THEN
      RAISE EXCEPTION 'Solicitação cancelada não pode ser refeita.' USING ERRCODE = 'check_violation';
    END IF;
    v_nome := NULLIF(btrim(coalesce(NEW.solicitante_nome, '')), '');
    IF v_nome IS NULL AND auth.uid() IS NOT NULL THEN
      SELECT coalesce(NULLIF(p.display_name, ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
    END IF;
    INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
    VALUES (NEW.id, 'Refeita', OLD.status, NEW.status, v_nome, auth.uid(),
            'Saída ' || to_char(NEW.data_saida, 'DD/MM/YYYY') || ' · ' || coalesce(NEW.dias_ferias, 30) || ' dias'
            || CASE WHEN coalesce(NEW.dias_vendidos, 0) > 0 THEN ' · abono ' || NEW.dias_vendidos || ' dias' ELSE '' END);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Quem decidiu: a tela grava aprovado_por junto com o status; sem ele,
    -- cai no nome do usuário logado (profiles) e por fim no e-mail.
    v_nome := NULLIF(btrim(coalesce(NEW.aprovado_por, '')), '');
    IF v_nome IS NULL AND auth.uid() IS NOT NULL THEN
      SELECT coalesce(NULLIF(p.display_name, ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
    END IF;
    INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
    VALUES (NEW.id, NEW.status, OLD.status, NEW.status, v_nome, auth.uid(),
            CASE WHEN NEW.status = 'Reprovada' THEN NULLIF(btrim(coalesce(NEW.motivo_reprovacao, '')), '') END);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_ferias_historico ON public."SISTEMA_SOLICITACOES_FERIAS";
CREATE TRIGGER trg_ferias_historico
  AFTER INSERT OR UPDATE OF status, refeita_em ON public."SISTEMA_SOLICITACOES_FERIAS"
  FOR EACH ROW EXECUTE FUNCTION public.ferias_registrar_historico();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (volta o trigger da 20260930000113; as colunas podem ficar)
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_ferias_historico ON public."SISTEMA_SOLICITACOES_FERIAS";
-- CREATE TRIGGER trg_ferias_historico
--   AFTER INSERT OR UPDATE OF status ON public."SISTEMA_SOLICITACOES_FERIAS"
--   FOR EACH ROW EXECUTE FUNCTION public.ferias_registrar_historico();
-- (e reaplicar o corpo de ferias_registrar_historico da 20260930000113)
-- ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS" DROP COLUMN IF EXISTS refeita_em, DROP COLUMN IF EXISTS refeita_vezes;
