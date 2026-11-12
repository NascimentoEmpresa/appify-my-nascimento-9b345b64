-- =========================================================================
-- CHAMADOS DE SISTEMAS — motivo da reabertura e chamados vinculados (Parte 1, 2…)
-- 12/11/2026, pedido do Pablo:
--   "Quando o solicitante clicar em REABRIR CHAMADO, ele vai ter que
--    selecionar o motivo: não atendeu o solicitado / precisa de modificações
--    no que foi solicitado. Se for a primeira, o chamado é reaberto e vai pra
--    primeira aprovação de novo pro gestor de sistemas verificar e enviar pra
--    um dev novamente. Se for a segunda: 'Pra melhorias, abra outro chamado'
--    (botão Reabrir chamado baseado nesse) — clona o chamado com um quadro a
--    mais do que é preciso a mais, e os chamados ficam vinculados como Parte 1,
--    Parte 2 etc. E ao criar chamado novo: vincular a algum existente?"
--
-- O QUE MUDA:
--   1. Colunas de vínculo em "CHAMADO_SISTEMA":
--        vinculado_a  — o chamado em que este foi pendurado (FK, SET NULL);
--        serie_id     — o primeiro chamado da série (a Parte 1). Sem FK de
--                       propósito: se a Parte 1 for excluída, as outras
--                       continuam juntas;
--        parte        — 2, 3, …; a Parte 1 é a que tem serie_id NULL e filhos;
--        complemento  — "O que é preciso a mais" (só no "baseado nesse").
--      O gatilho de INSERT calcula série e parte (o front só manda
--      vinculado_a) e confere que quem abre ENXERGA o chamado escolhido —
--      mesma regra da policy chamado_sistema_select. Depois de criado, o
--      vínculo não muda (só a FK, ao excluir o outro, zera vinculado_a).
--   2. RPC chamado_vinculos(id): a série inteira (Parte 1..N) para o cartão
--      "Chamados vinculados", para quem enxerga o chamado consultado.
--   3. Reabrir "não atendeu o solicitado" (RPC chamado_reabrir_nao_atendeu):
--      volta para 'aberto' SEM responsável — a triagem do Gestor de Sistemas
--      (Coordenar) verifica e manda para um dev de novo. Início e prazo da
--      rodada anterior zeram sozinhos (chamado_sistema_desenvolvimento) e a
--      posição na fila também (chamado_sistema_fila_dev).
--      O gatilho chamado_sistema_guard ganha a marca app.chamado_reabrir_triagem,
--      que deixa a RPC tirar o responsável — e só tirar (NULL), nada mais.
--      A RPC antiga (chamado_reabrir_pelo_solicitante, mig 255) passa a fazer
--      o mesmo: o solicitante não tem mais um caminho que devolve direto ao dev.
--   "Precisa de modificações" não reabre nada: o front abre o formulário de
--   chamado novo preenchido com o anterior (vinculado_a + complemento).
-- =========================================================================

-- ── 1. Colunas ────────────────────────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS vinculado_a uuid REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS serie_id    uuid,
  ADD COLUMN IF NOT EXISTS parte       smallint,
  ADD COLUMN IF NOT EXISTS complemento text;

COMMENT ON COLUMN public."CHAMADO_SISTEMA".vinculado_a IS
  'Chamado em que este foi vinculado ao abrir (mig 20261112002000). NULL = sem vínculo.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".serie_id IS
  'Primeiro chamado da série (Parte 1). NULL na própria Parte 1 e em chamado sem vínculo.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".parte IS
  'Número da parte na série (2, 3, …). A Parte 1 fica NULL.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".complemento IS
  'O que é preciso a mais — chamado aberto pelo "Reabrir chamado baseado nesse".';

CREATE INDEX IF NOT EXISTS idx_chamado_sistema_serie
  ON public."CHAMADO_SISTEMA"(serie_id) WHERE serie_id IS NOT NULL;

-- Quem enxerga o chamado: a mesma regra da policy chamado_sistema_select
-- (mig 20261009000003). Usada pelo gatilho e pela RPC da série.
CREATE OR REPLACE FUNCTION public.chamado_sistema_visivel(p_chamado_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
            OR public.chamado_sistema_pode_ver_todos()
            OR public.chamado_eh_participante(c.id)));
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_visivel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_sistema_visivel(uuid) TO authenticated;

-- ── 2. Gatilho do vínculo ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_vinculo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_serie uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.complemento := NULLIF(btrim(COALESCE(NEW.complemento, '')), '');
    IF NEW.vinculado_a IS NULL THEN
      NEW.serie_id := NULL;
      NEW.parte := NULL;
      NEW.complemento := NULL;  -- "o que é preciso a mais" só existe com um chamado anterior
      RETURN NEW;
    END IF;

    SELECT COALESCE(c.serie_id, c.id) INTO v_serie
      FROM public."CHAMADO_SISTEMA" c WHERE c.id = NEW.vinculado_a;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O chamado escolhido para vincular não existe mais.';
    END IF;
    -- Sem sessão = automação de servidor; com sessão, só o que a pessoa enxerga.
    IF auth.uid() IS NOT NULL AND NOT public.chamado_sistema_visivel(NEW.vinculado_a) THEN
      RAISE EXCEPTION 'Você não tem acesso ao chamado escolhido para vincular.' USING ERRCODE = '42501';
    END IF;

    -- Duas partes abertas ao mesmo tempo não pegam o mesmo número.
    PERFORM pg_advisory_xact_lock(hashtext('chamado_serie:' || v_serie::text));
    NEW.serie_id := v_serie;
    SELECT COALESCE(max(parte), 1) + 1 INTO NEW.parte
      FROM public."CHAMADO_SISTEMA" WHERE serie_id = v_serie;
    RETURN NEW;
  END IF;

  -- UPDATE: o vínculo é da abertura e não muda. Zerar vinculado_a passa (é a
  -- FK ON DELETE SET NULL quando o outro chamado é excluído).
  IF NEW.vinculado_a IS NOT NULL AND NEW.vinculado_a IS DISTINCT FROM OLD.vinculado_a THEN
    RAISE EXCEPTION 'O vínculo do chamado é definido na abertura e não muda.';
  END IF;
  NEW.serie_id := OLD.serie_id;
  NEW.parte := OLD.parte;
  IF NEW.complemento IS DISTINCT FROM OLD.complemento
     AND NOT public.tem_acesso_menu('chamados_sistemas_coordenar') THEN
    RAISE EXCEPTION 'Sem permissão para coordenar/editar este chamado.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_vinculo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_sistema_vinculo ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_vinculo
  BEFORE INSERT OR UPDATE OF vinculado_a, serie_id, parte, complemento ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_vinculo();

-- ── 3. A série de um chamado (cartão "Chamados vinculados") ─────────────
CREATE OR REPLACE FUNCTION public.chamado_vinculos(p_chamado_id uuid)
RETURNS TABLE (id uuid, numero text, assunto text, status text, parte integer,
               vinculado_a uuid, complemento text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_serie uuid;
BEGIN
  IF NOT public.chamado_sistema_visivel(p_chamado_id) THEN
    RETURN;
  END IF;
  SELECT COALESCE(c.serie_id, c.id) INTO v_serie FROM public."CHAMADO_SISTEMA" c WHERE c.id = p_chamado_id;
  RETURN QUERY
    SELECT c.id, c.numero::text, c.assunto::text, c.status::text,
           COALESCE(c.parte, 1)::int, c.vinculado_a, c.complemento, c.created_at
      FROM public."CHAMADO_SISTEMA" c
     WHERE (c.id = v_serie OR c.serie_id = v_serie)
       -- Sem filhos, a "série" é só ele: nada a mostrar.
       AND EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" f WHERE f.serie_id = v_serie)
     ORDER BY COALESCE(c.parte, 1), c.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_vinculos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_vinculos(uuid) TO authenticated;

-- ── 4. Guard: a reabertura por "não atendeu" pode tirar o responsável ───
-- Mesmo corpo da mig 20260930000266 + a marca app.chamado_reabrir_triagem.
CREATE OR REPLACE FUNCTION public.chamado_sistema_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Faxina de exclusão de usuário (admin_excluir_usuario_completo).
  v_faxina boolean := COALESCE(current_setting('app.exclusao_usuario', true) = 'on', false);
  -- Automação de servidor: edge function com service_role, sem sessão.
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
  -- Solicitante devolvendo/reabrindo (mig 255) ou cancelando (mig 260) o
  -- próprio chamado por RPC.
  v_solic boolean := COALESCE(current_setting('app.chamado_solicitante', true) = 'on', false);
  -- Presidência devolvendo ao desenvolvimento (mig 266).
  v_presid boolean := COALESCE(current_setting('app.chamado_presidencia', true) = 'on', false);
  -- Solicitante reabrindo por "não atendeu o solicitado" (mig 20261112002000):
  -- o chamado volta para a triagem, sem responsável.
  v_triagem boolean := COALESCE(current_setting('app.chamado_reabrir_triagem', true) = 'on', false);
  v_coord boolean;
  v_aprov boolean;
  v_resp  boolean;
BEGIN
  -- A faxina não é alguém editando o chamado: é o sistema tirando o nome de
  -- quem saiu da empresa. Nenhum campo de negócio muda — só as colunas que
  -- apontam pro usuário, e por ação de chave estrangeira. Os automatismos de
  -- status continuam valendo.
  IF v_faxina THEN
    IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
    IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
    RETURN NEW;
  END IF;

  v_coord := public.tem_acesso_menu('chamados_sistemas_coordenar');
  v_aprov := public.tem_acesso_menu('chamados_sistemas_aprovar');
  v_resp  := COALESCE(OLD.responsavel_id = auth.uid(), false);

  -- Campos de abertura + coordenação só mudam com "coordenar".
  -- Exceção única: a triagem tira o responsável (vira NULL) e mais nada.
  IF NOT v_coord THEN
    IF NEW.assunto              IS DISTINCT FROM OLD.assunto
    OR NEW.categorias           IS DISTINCT FROM OLD.categorias
    OR NEW.tipo_solicitacao     IS DISTINCT FROM OLD.tipo_solicitacao
    OR NEW.prioridade           IS DISTINCT FROM OLD.prioridade
    OR NEW.descricao            IS DISTINCT FROM OLD.descricao
    OR NEW.impacto_trabalho     IS DISTINCT FROM OLD.impacto_trabalho
    OR NEW.urgencia             IS DISTINCT FROM OLD.urgencia
    OR NEW.modulo_sistema       IS DISTINCT FROM OLD.modulo_sistema
    OR NEW.modulo_sistema_outro IS DISTINCT FROM OLD.modulo_sistema_outro
    OR NEW.afeta_usuarios       IS DISTINCT FROM OLD.afeta_usuarios
    OR NEW.solicitante_id       IS DISTINCT FROM OLD.solicitante_id
    OR NEW.solicitante_nome     IS DISTINCT FROM OLD.solicitante_nome
    OR NEW.setor                IS DISTINCT FROM OLD.setor
    OR (NEW.responsavel_id      IS DISTINCT FROM OLD.responsavel_id
        AND NOT (v_triagem AND NEW.responsavel_id IS NULL))
    OR NEW.observacao_gerente   IS DISTINCT FROM OLD.observacao_gerente
    OR NEW.comentario_gerente   IS DISTINCT FROM OLD.comentario_gerente THEN
      RAISE EXCEPTION 'Sem permissão para coordenar/editar este chamado.';
    END IF;
  END IF;

  -- Reprovar/motivo só com "aprovar".
  IF (NEW.status = 'reprovado' AND OLD.status <> 'reprovado') AND NOT v_aprov THEN
    RAISE EXCEPTION 'Sem permissão para reprovar chamados.';
  END IF;
  IF NEW.motivo_reprovacao IS DISTINCT FROM OLD.motivo_reprovacao AND NOT v_aprov THEN
    RAISE EXCEPTION 'Sem permissão para reprovar chamados.';
  END IF;
  -- Motivo do cancelamento: só a RPC do solicitante (ou a coordenação).
  IF NEW.motivo_cancelamento IS DISTINCT FROM OLD.motivo_cancelamento AND NOT (v_solic OR v_coord) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar este chamado.';
  END IF;

  -- Demais mudanças de status: coordenar, aprovar, o dev responsável, a
  -- automação de servidor (conclusão no merge da PR), o solicitante pelas
  -- RPCs que ligam app.chamado_solicitante — e aí só para voltar à fila
  -- ('aberto' / 'em_andamento') ou cancelar ('cancelado', mig 260) — OU a
  -- Presidência devolvendo ao desenvolvimento (mig 266), só para voltar à
  -- fila. Concluir ou reprovar continua da equipe.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (v_auto OR v_coord OR v_aprov OR v_resp
       OR (v_solic AND NEW.status IN ('aberto', 'em_andamento', 'cancelado'))
       OR (v_presid AND NEW.status IN ('aberto', 'em_andamento'))) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status do chamado.';
  END IF;

  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
  IF NEW.status = 'cancelado' AND NEW.cancelado_em IS NULL THEN NEW.cancelado_em := now(); END IF;
  IF NEW.status <> 'cancelado' THEN NEW.cancelado_em := NULL; END IF;
  RETURN NEW;
END;
$function$;

-- ── 5. Reabrir por "não atendeu o solicitado" → triagem do Gestor ────────
CREATE OR REPLACE FUNCTION public.chamado_reabrir_nao_atendeu(p_chamado_id uuid, p_motivo text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_solicitante uuid;
  v_status      text;
BEGIN
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Conte o que não ficou como você pediu.';
  END IF;

  SELECT solicitante_id, status INTO v_solicitante, v_status
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF v_solicitante IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Apenas quem abriu o chamado pode reabri-lo por aqui.';
  END IF;
  IF v_status NOT IN ('concluido', 'reprovado') THEN
    RAISE EXCEPTION 'O chamado ainda está em atendimento — use a conversa do chamado.';
  END IF;

  PERFORM set_config('app.chamado_solicitante', 'on', true);
  PERFORM set_config('app.chamado_reabrir_triagem', 'on', true);
  UPDATE public."CHAMADO_SISTEMA" SET status = 'aberto', responsavel_id = NULL WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_reabrir_triagem', 'off', true);
  PERFORM set_config('app.chamado_solicitante', 'off', true);

  -- "Chamado reaberto: …" é o formato que o chat traduz e que a bonificação
  -- conta como reabertura.
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          'Chamado reaberto: não atendeu o solicitado — ' || btrim(p_motivo)
          || ' (voltou para a triagem do Gestor de Sistemas)');

  RETURN 'aberto';
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_reabrir_nao_atendeu(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_reabrir_nao_atendeu(uuid, text) TO authenticated;

-- A RPC antiga (mig 255) segue a regra nova: tela antiga em cache também
-- manda para a triagem, não direto ao dev.
CREATE OR REPLACE FUNCTION public.chamado_reabrir_pelo_solicitante(p_chamado_id uuid, p_motivo text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.chamado_reabrir_nao_atendeu(p_chamado_id, p_motivo);
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_reabrir_pelo_solicitante(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_reabrir_pelo_solicitante(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.chamado_reabrir_nao_atendeu(uuid, text);
--   -- chamado_reabrir_pelo_solicitante e chamado_sistema_guard: reaplicar os
--   -- corpos das migs 20260930000255 e 20260930000266.
--   DROP FUNCTION IF EXISTS public.chamado_vinculos(uuid);
--   DROP TRIGGER IF EXISTS trg_chamado_sistema_vinculo ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_sistema_vinculo();
--   DROP FUNCTION IF EXISTS public.chamado_sistema_visivel(uuid);
--   ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS complemento,
--     DROP COLUMN IF EXISTS parte, DROP COLUMN IF EXISTS serie_id, DROP COLUMN IF EXISTS vinculado_a;
