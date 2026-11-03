-- =========================================================================
-- Chamados de Sistemas: o DEV marca "Em desenvolvimento" com PRAZO (28/10/2026)
--
-- Pedido do Pablo: "o desenvolvedor agora vai definir o status de Em
-- desenvolvimento no chamado, pra informar pro usuario que começou a
-- desenvolver, e antes de confirmar o inicio do chamado, tem que informar o
-- PRAZO quanto tempo vai levar pra concluir o chamado. Se for só horas, ou
-- dias, cada chamado tem que ter sua data. Não posso colocar a mesma data em
-- dois chamados. Mas nada pode impedir também, só tem que dar um aviso e
-- deixar como opcional."
--
-- DESENHO — de novo uma camada por cima do status, sem status novo:
--   'em_andamento' hoje quer dizer "direcionado a um dev / na fila dele" (a
--   coordenação põe nesse status ao atribuir — chamado_direcionar, mig 260).
--   Usar outro status quebraria "Em andamento" do Painel de Distribuição,
--   Painel do Dev, TV de TI e a fila (posicao_dev). Então:
--   · desenvolvimento_iniciado_em / _por: o dev clicou em "Iniciar
--     desenvolvimento". Com status 'em_andamento' a tela mostra "Em
--     desenvolvimento"; sem isso, "Na fila — aguardando início".
--   · prazo_conclusao_em (timestamptz): o prazo informado, em horas ou dias —
--     com hora, porque chamado de 3 horas vence no mesmo dia.
--     prazo_previsto (date, já existente) recebe o DIA desse prazo, para os
--     indicadores que já leem prazo_previsto (atrasados do Painel, TV de TI
--     ti_demandas, Monitoramento) continuarem funcionando sem mudança.
--   · Prazo OBRIGATÓRIO para iniciar (a RPC recusa sem prazo ou com prazo no
--     passado). Mesma data em dois chamados do mesmo dev é só AVISO, na tela
--     (ver src/lib/chamados/prazoDesenvolvimento.ts) — o banco não impede,
--     como o Pablo pediu.
--   · RPC chamado_iniciar_desenvolvimento(chamado, prazo): inicia OU altera o
--     prazo de um já iniciado. Quem pode: o dev responsável, a coordenação ou
--     a aprovação (mesma régua do guard chamado_sistema_guard). Grava evento
--     no histórico e avisa o solicitante no sino.
--   · Gatilho chamado_sistema_desenvolvimento: troca de responsável ou
--     reabertura (encerrado → ativo) zera o início e o prazo — o novo dev (ou
--     a nova rodada) informa o seu. Marcar início/prazo só pela RPC.
--
-- Chamados que já estavam em andamento ficam sem início marcado: o dev clica
-- em "Iniciar desenvolvimento" e informa o prazo quando pegar cada um.
-- =========================================================================

-- ── 1. Colunas ────────────────────────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS desenvolvimento_iniciado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS desenvolvimento_iniciado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prazo_conclusao_em           timestamptz;

COMMENT ON COLUMN public."CHAMADO_SISTEMA".desenvolvimento_iniciado_em IS
  'Dev clicou em Iniciar desenvolvimento (mig 20261028001400). Zera ao trocar de responsável ou reabrir.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".prazo_conclusao_em IS
  'Prazo informado pelo dev ao iniciar (horas ou dias). prazo_previsto recebe o dia, para os indicadores antigos.';

-- ── 2. Gatilho: zera na troca de dev / reabertura; só a RPC marca ─────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_desenvolvimento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_marca boolean := COALESCE(current_setting('app.chamado_inicio_dev', true) = 'on', false);
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.desenvolvimento_iniciado_em := NULL;
    NEW.desenvolvimento_iniciado_por := NULL;
    NEW.prazo_conclusao_em := NULL;
    RETURN NEW;
  END IF;

  -- Outro dev assumiu, ou o chamado encerrado voltou para a fila: o início e
  -- o prazo eram da rodada anterior.
  IF NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
     OR (OLD.status IN ('concluido', 'reprovado', 'cancelado')
         AND NEW.status NOT IN ('concluido', 'reprovado', 'cancelado')) THEN
    NEW.desenvolvimento_iniciado_em := NULL;
    NEW.desenvolvimento_iniciado_por := NULL;
    NEW.prazo_conclusao_em := NULL;
    RETURN NEW;
  END IF;

  -- Marcar início ou prazo: só chamado_iniciar_desenvolvimento (ou servidor).
  -- Limpar (NULL) passa — a FK ON DELETE SET NULL da exclusão de usuário vem por aqui.
  IF NOT (v_marca OR v_auto) AND (
       (NEW.desenvolvimento_iniciado_em IS NOT NULL AND NEW.desenvolvimento_iniciado_em IS DISTINCT FROM OLD.desenvolvimento_iniciado_em)
    OR (NEW.desenvolvimento_iniciado_por IS NOT NULL AND NEW.desenvolvimento_iniciado_por IS DISTINCT FROM OLD.desenvolvimento_iniciado_por)
    OR (NEW.prazo_conclusao_em IS NOT NULL AND NEW.prazo_conclusao_em IS DISTINCT FROM OLD.prazo_conclusao_em)) THEN
    RAISE EXCEPTION 'O início do desenvolvimento e o prazo são informados no botão Iniciar desenvolvimento.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_desenvolvimento() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_sistema_desenvolvimento ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_desenvolvimento
  BEFORE INSERT OR UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_desenvolvimento();

-- ── 3. RPC: iniciar o desenvolvimento (ou alterar o prazo) ───────────────
CREATE OR REPLACE FUNCTION public.chamado_iniciar_desenvolvimento(p_chamado_id uuid, p_prazo timestamptz)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_c        public."CHAMADO_SISTEMA"%ROWTYPE;
  v_alterar  boolean;
  v_prazo_tx text;
BEGIN
  IF p_prazo IS NULL THEN
    RAISE EXCEPTION 'Informe o prazo para concluir o chamado (em horas ou dias).';
  END IF;
  IF p_prazo <= now() THEN
    RAISE EXCEPTION 'O prazo tem que ser depois de agora.';
  END IF;

  SELECT * INTO v_c FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  -- Mesma régua do chamado_sistema_guard para mexer no andamento.
  IF NOT (COALESCE(v_c.responsavel_id = auth.uid(), false)
          OR public.tem_acesso_menu('chamados_sistemas_coordenar')
          OR public.tem_acesso_menu('chamados_sistemas_aprovar')) THEN
    RAISE EXCEPTION 'Só o desenvolvedor responsável (ou a coordenação) inicia o desenvolvimento.';
  END IF;
  IF v_c.responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Direcione o chamado a um desenvolvedor antes de iniciar.';
  END IF;

  v_alterar := v_c.desenvolvimento_iniciado_em IS NOT NULL;
  IF v_alterar THEN
    IF v_c.status IN ('concluido', 'reprovado', 'cancelado') THEN
      RAISE EXCEPTION 'Chamado encerrado — não há prazo para alterar.';
    END IF;
  ELSIF v_c.status NOT IN ('aberto', 'em_andamento') THEN
    RAISE EXCEPTION 'Só dá para iniciar chamado aberto ou em andamento (este está %).', v_c.status;
  END IF;

  PERFORM set_config('app.chamado_inicio_dev', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET status                       = CASE WHEN status = 'aberto' THEN 'em_andamento' ELSE status END,
         desenvolvimento_iniciado_em  = COALESCE(desenvolvimento_iniciado_em, now()),
         desenvolvimento_iniciado_por = COALESCE(desenvolvimento_iniciado_por, auth.uid()),
         prazo_conclusao_em           = p_prazo,
         prazo_previsto               = (p_prazo AT TIME ZONE 'America/Sao_Paulo')::date
   WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_inicio_dev', 'off', true);

  v_prazo_tx := to_char(p_prazo AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI');
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          CASE WHEN v_alterar THEN 'Prazo de conclusão alterado para ' ELSE 'Desenvolvimento iniciado — prazo de conclusão: ' END || v_prazo_tx,
          jsonb_build_object('acao', CASE WHEN v_alterar THEN 'prazo_alterado' ELSE 'desenvolvimento_iniciado' END,
                             'prazo', p_prazo));

  IF v_c.solicitante_id IS DISTINCT FROM auth.uid() THEN
    BEGIN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (v_c.solicitante_id,
              CASE WHEN v_alterar THEN 'Novo prazo no chamado #' ELSE 'Seu chamado #' END || v_c.numero
                || CASE WHEN v_alterar THEN '' ELSE ' está em desenvolvimento' END,
              left(v_c.assunto, 120) || ' — previsão de conclusão: ' || v_prazo_tx || '.',
              'chamado_desenvolvimento',
              '/app/central-servicos/chamados/' || p_chamado_id || '/acompanhar');
    EXCEPTION WHEN others THEN
      RAISE WARNING 'chamado_iniciar_desenvolvimento (aviso %): %', p_chamado_id, SQLERRM;
    END;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_iniciar_desenvolvimento(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_iniciar_desenvolvimento(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_iniciar_desenvolvimento(uuid, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.chamado_iniciar_desenvolvimento(uuid, timestamptz);
-- DROP TRIGGER IF EXISTS trg_chamado_sistema_desenvolvimento ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_sistema_desenvolvimento();
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS prazo_conclusao_em,
--                                      DROP COLUMN IF EXISTS desenvolvimento_iniciado_por,
--                                      DROP COLUMN IF EXISTS desenvolvimento_iniciado_em;
-- NOTIFY pgrst, 'reload schema';
