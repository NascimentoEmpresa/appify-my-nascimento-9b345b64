-- =========================================================================
-- Chamados de Sistemas: o SOLICITANTE confirma a conclusão (28/10/2026)
--
-- Pedido do Pablo: "o setor de sistemas quando clicar em CONCLUIR o
-- SOLICITANTE vai ter que clicar em CONFIRMAR CONCLUSÃO, antes de continuar e
-- abrir o próximo quarto chamado (respeitando aquele limite de 3)."
--
-- DESENHO — o status NÃO muda. A confirmação é uma camada por cima do
-- 'concluido', como a validação da Presidência (mig 266):
--   · CHAMADO_SISTEMA.conclusao_confirmada_em / _por. NULL com status
--     'concluido' = "aguardando a confirmação do solicitante".
--   · Por que não um status novo: 'concluido' é lido por Dashboard de
--     Chamados, Painel/Dashboard do Dev, Monitoramento, TV de TI
--     (tvg_ti_espelho_chamados), hora extra, novidade da I.A., Presidência,
--     avaliação do dev... Um status a mais mudaria todas essas contas (o
--     tempo de entrega do dev passaria a incluir quanto o solicitante demorou
--     para clicar). Com a coluna, todas continuam iguais e só a trava do
--     solicitante muda.
--
-- O QUE MUDA
--   1. Gatilho chamado_sistema_confirmacao (BEFORE INSERT/UPDATE): toda troca
--      de status zera a confirmação — o dev concluir (tela ou merge da PR,
--      edge chamado-concluir-pr), reabrir, a Presidência devolver. Marcar a
--      confirmação só pela RPC (marca de transação app.chamado_confirmacao,
--      mesmo desenho do app.chamado_solicitante da mig 255) ou service_role.
--   2. RPC chamado_confirmar_conclusao(chamado): só o solicitante, só com o
--      chamado concluído e, no fluxo da Presidência, depois que ela aprovar
--      (mesma janela da avaliação). Registra evento no histórico.
--      "Não resolveu" continua sendo chamado_reabrir_pelo_solicitante (mig
--      255) — o solicitante devolve com motivo e o chamado volta pro dev.
--   3. chamado_pendencias_solicitante ganha a pendência 'confirmacao'. A trava
--      de abrir chamado (chamado_sistema_bloqueia_avaliacao_pendente, mig
--      20261020000070) já conta essa função: 3 pendências (confirmar OU
--      avaliar) e o 4º chamado não abre. Cada chamado conta UMA vez: primeiro
--      como 'confirmacao', depois de confirmado como 'avaliacao'.
--   4. A avaliação do solicitante só entra depois da confirmação (gatilho em
--      CHAMADO_SISTEMA_AVALIACAO) — senão daria para "avaliar" um chamado que
--      ele nem conferiu e a pendência de confirmar ficaria para trás.
--   5. Sino: ao concluir, o solicitante recebe notificação (public.notificacoes)
--      com link para o acompanhamento. O push continua pela edge
--      enviar-notificacao-push (evento 'concluido', texto ajustado lá).
--
-- LEGADO: chamados já concluídos antes desta migration entram confirmados
-- (conclusao_confirmada_em = concluido_em) — ninguém amanhece travado por
-- causa de chamado antigo. Backfill sem gatilhos (session_replication_role,
-- só nesta transação, mesmo uso da mig 20261026000080) para não mexer em
-- updated_at — senão a bolinha de "Chamados de Sistemas" acenderia para todo
-- mundo que já teve chamado concluído.
-- =========================================================================

-- ── 1. Colunas ────────────────────────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS conclusao_confirmada_em  timestamptz,
  ADD COLUMN IF NOT EXISTS conclusao_confirmada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public."CHAMADO_SISTEMA".conclusao_confirmada_em IS
  'Solicitante confirmou a conclusão (mig 20261028001300). NULL com status concluido = aguardando a confirmação; zera a cada troca de status.';

-- Legado: o que já estava concluído conta como confirmado.
SET LOCAL session_replication_role = replica;
UPDATE public."CHAMADO_SISTEMA"
   SET conclusao_confirmada_em = COALESCE(concluido_em, updated_at, now())
 WHERE status = 'concluido'
   AND conclusao_confirmada_em IS NULL;
SET LOCAL session_replication_role = origin;

-- Trava de abrir chamado e lista de pendências filtram por aqui.
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_aguardando_confirmacao
  ON public."CHAMADO_SISTEMA"(solicitante_id)
  WHERE status = 'concluido' AND conclusao_confirmada_em IS NULL;

-- ── 2. Gatilho: troca de status zera, só a RPC confirma ──────────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_confirmacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_marca boolean := COALESCE(current_setting('app.chamado_confirmacao', true) = 'on', false);
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.conclusao_confirmada_em := NULL;
    NEW.conclusao_confirmada_por := NULL;
    RETURN NEW;
  END IF;

  -- Concluiu (de novo), reabriu, reprovou, cancelou, Presidência devolveu:
  -- a confirmação anterior não vale para a entrega nova.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.conclusao_confirmada_em := NULL;
    NEW.conclusao_confirmada_por := NULL;
    RETURN NEW;
  END IF;

  -- Marcar como confirmado: só chamado_confirmar_conclusao (ou automação de
  -- servidor). Limpar (NULL) não é travado — a FK ON DELETE SET NULL da
  -- exclusão de usuário passa por aqui.
  IF NEW.conclusao_confirmada_em IS NOT NULL
     AND NEW.conclusao_confirmada_em IS DISTINCT FROM OLD.conclusao_confirmada_em
     AND NOT (v_marca OR v_auto) THEN
    RAISE EXCEPTION 'A conclusão só pode ser confirmada pelo solicitante, no botão Confirmar conclusão.';
  END IF;
  IF NEW.conclusao_confirmada_por IS NOT NULL
     AND NEW.conclusao_confirmada_por IS DISTINCT FROM OLD.conclusao_confirmada_por
     AND NOT (v_marca OR v_auto) THEN
    RAISE EXCEPTION 'A conclusão só pode ser confirmada pelo solicitante, no botão Confirmar conclusão.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_confirmacao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_sistema_confirmacao ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_confirmacao
  BEFORE INSERT OR UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_confirmacao();

-- ── 3. RPC: o solicitante confirma ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_confirmar_conclusao(p_chamado_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_solicitante uuid;
  v_status      text;
  v_confirmada  timestamptz;
  v_etapa       text;
BEGIN
  SELECT solicitante_id, status, conclusao_confirmada_em
    INTO v_solicitante, v_status, v_confirmada
    FROM public."CHAMADO_SISTEMA"
   WHERE id = p_chamado_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF v_solicitante IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Apenas quem abriu o chamado pode confirmar a conclusão.';
  END IF;
  IF v_status <> 'concluido' THEN
    RAISE EXCEPTION 'O chamado não está concluído — não há conclusão para confirmar.';
  END IF;
  IF v_confirmada IS NOT NULL THEN
    RETURN;  -- já confirmado (duplo clique, duas abas): nada a fazer
  END IF;
  -- Fluxo da Presidência: confirma depois que ela aprovar (mesma janela da avaliação).
  SELECT etapa INTO v_etapa FROM public."CHAMADO_SISTEMA_VALIDACAO" WHERE chamado_id = p_chamado_id;
  IF v_etapa IN ('desenvolvimento', 'validacao_presidencia') THEN
    RAISE EXCEPTION 'A Presidência ainda está validando este chamado. A confirmação abre depois que ela aprovar.';
  END IF;

  PERFORM set_config('app.chamado_confirmacao', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET conclusao_confirmada_em = now(), conclusao_confirmada_por = auth.uid()
   WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_confirmacao', 'off', true);

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento', 'Conclusão confirmada pelo solicitante',
          jsonb_build_object('acao', 'conclusao_confirmada'));
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_confirmar_conclusao(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_confirmar_conclusao(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_confirmar_conclusao(uuid) TO authenticated;

-- ── 4. Pendências do solicitante: confirmar entra na conta ───────────────
-- Corpo da mig 20261009000003 + o bloco 'confirmacao'; 'avaliacao' passa a
-- exigir a confirmação (cada chamado conta uma vez só).
CREATE OR REPLACE FUNCTION public.chamado_pendencias_solicitante(p_uid uuid)
 RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamp with time zone, pendencia text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT * FROM (
    -- Concluído pelo time, solicitante ainda não confirmou (mig 20261028001300).
    SELECT c.id, c.numero, c.assunto, c.concluido_em, 'confirmacao'::text
      FROM public."CHAMADO_SISTEMA" c
      LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
     WHERE c.solicitante_id = p_uid
       AND c.status = 'concluido'
       AND c.conclusao_confirmada_em IS NULL
       AND (v.chamado_id IS NULL OR v.etapa IN ('treinamento', 'finalizado'))
    UNION ALL
    SELECT c.id, c.numero, c.assunto, c.concluido_em, 'avaliacao'::text
      FROM public."CHAMADO_SISTEMA" c
      LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
     WHERE c.solicitante_id = p_uid
       AND c.status = 'concluido'
       AND c.conclusao_confirmada_em IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
       -- Presidência ainda validando (ou devolvido ao dev): nada a fazer pelo solicitante.
       AND (v.chamado_id IS NULL OR v.etapa IN ('treinamento', 'finalizado'))
    UNION ALL
    -- Participante extra (mig 20261009000003): mesma janela do solicitante.
    SELECT c.id, c.numero, c.assunto, c.concluido_em, 'avaliacao_participante'::text
      FROM public."CHAMADO_SISTEMA_PARTICIPANTE" pp
      JOIN public."CHAMADO_SISTEMA" c ON c.id = pp.chamado_id
      LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
     WHERE pp.user_id = p_uid
       AND c.status = 'concluido'
       AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO" a WHERE a.chamado_id = c.id AND a.user_id = p_uid)
       AND (v.chamado_id IS NULL OR v.etapa IN ('treinamento', 'finalizado'))
  ) x
  ORDER BY x.concluido_em NULLS LAST;
$function$;

-- Trava ao abrir: mesmo corpo da mig 20261020000070, só a mensagem fala
-- também de confirmar.
CREATE OR REPLACE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.chamado_encaminhamento_bug', true) = 'on', false) THEN
    RETURN NEW;
  END IF;
  -- 3 = LIMITE_AVALIACOES_PENDENTES em src/pages/chamados/validacaoPresidencia.ts.
  IF (SELECT count(*) FROM public.chamado_pendencias_solicitante(NEW.solicitante_id)) >= 3 THEN
    RAISE EXCEPTION 'Você tem 3 chamados concluídos aguardando sua confirmação ou avaliação. Confirme a conclusão e avalie antes de abrir um novo.';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 5. Avaliar só depois de confirmar ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_avaliacao_exige_confirmacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c
              WHERE c.id = NEW.chamado_id
                AND c.status = 'concluido'
                AND c.conclusao_confirmada_em IS NULL) THEN
    RAISE EXCEPTION 'Confirme a conclusão do chamado antes de avaliar.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_avaliacao_exige_confirmacao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_avaliacao_exige_confirmacao ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE TRIGGER trg_chamado_avaliacao_exige_confirmacao
  BEFORE INSERT ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_avaliacao_exige_confirmacao();

-- ── 6. Sino: avisa o solicitante que tem conclusão a confirmar ───────────
-- No fluxo da Presidência o aviso sai na conclusão também: o card de
-- validação explica que a confirmação abre depois da aprovação.
CREATE OR REPLACE FUNCTION public.chamado_concluido_avisa_solicitante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.solicitante_id IS NOT NULL AND NEW.solicitante_id IS DISTINCT FROM auth.uid() THEN
    BEGIN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (NEW.solicitante_id,
              'Confirme a conclusão do chamado #' || NEW.numero,
              left(NEW.assunto, 120) || ' — o time de Sistemas concluiu. Confira e clique em Confirmar conclusão (ou reabra se não resolveu).',
              'chamado_confirmar_conclusao',
              '/app/central-servicos/chamados/' || NEW.id || '/acompanhar');
    EXCEPTION WHEN others THEN
      -- Aviso não pode derrubar a conclusão.
      RAISE WARNING 'chamado_concluido_avisa_solicitante (%): %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_concluido_avisa_solicitante() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_concluido_avisa_solicitante ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_concluido_avisa_solicitante
  AFTER UPDATE OF status ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido')
  EXECUTE FUNCTION public.chamado_concluido_avisa_solicitante();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_chamado_concluido_avisa_solicitante ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_concluido_avisa_solicitante();
-- DROP TRIGGER IF EXISTS trg_chamado_avaliacao_exige_confirmacao ON public."CHAMADO_SISTEMA_AVALIACAO";
-- DROP FUNCTION IF EXISTS public.chamado_avaliacao_exige_confirmacao();
-- Recriar chamado_pendencias_solicitante como na mig 20261009000003 e
-- chamado_sistema_bloqueia_avaliacao_pendente como na mig 20261020000070.
-- DROP FUNCTION IF EXISTS public.chamado_confirmar_conclusao(uuid);
-- DROP TRIGGER IF EXISTS trg_chamado_sistema_confirmacao ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_sistema_confirmacao();
-- DROP INDEX IF EXISTS public.idx_chamado_sistema_aguardando_confirmacao;
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS conclusao_confirmada_por,
--                                      DROP COLUMN IF EXISTS conclusao_confirmada_em;
-- NOTIFY pgrst, 'reload schema';
