-- =========================================================================
-- CHAMADOS DE SISTEMAS — Treinamento vai para "Treinamentos Sistemas"
-- (Central de Serviços › Treinamentos), com participantes escolhidos pelo dev
--
-- PEDIDO (30/09/2026, Pablo):
--   "quando for concluído um chamado enviado pra presidência, não vai mais
--    precisar confirmar o treinamento nos chamados na central de serviços.
--    vai ficar em uma parte nova dentro de treinamentos da central de
--    serviços ... Treinamentos Sistemas, aí quando o dev for confirmar o envio
--    do treinamento, ele tem que selecionar os USUÁRIOS que vão receber o
--    treinamento ou o setor inteiro que vai. e esses usuários confirmam lá."
--
-- Substitui o desenho das mig 266/269 (dev e solicitante confirmam no
-- chamado, cada um o seu papel — a 269 ficou no ar só entre 30/09 e esta).
--
-- FLUXO
--   Presidência aprova → etapa 'treinamento'
--     → o DEV que concluiu (ou a gestão de chamados, por ele) ENVIA o
--       treinamento: escolhe usuários e/ou setores inteiros
--       (chamado_treinamento_enviar). Setor = quem tem login ativo com aquele
--       Setor_ERP NO MOMENTO do envio (a lista fica gravada).
--     → cada participante confirma que recebeu, em Central de Serviços ›
--       Treinamentos › Treinamentos Sistemas (chamado_treinamento_confirmar_recebimento)
--     → todos confirmaram → etapa 'finalizado'.
--   Colunas reaproveitadas: treinamento_dev_* = o ENVIO (quem, quando, obs).
--   treinamento_solic_* deixam de ser usadas (ficam, com o histórico antigo).
--
-- SOLICITANTE / AVALIAÇÃO
--   Não confirma mais nada no chamado. Avalia assim que a Presidência aprova
--   (enquanto ela valida, não — o trigger abaixo trava). A pendência que trava
--   "abrir novo chamado" volta a ser só a avaliação; chamado ainda na
--   Presidência não trava (não há o que o solicitante fazer).
--
-- Idempotente. Aplicar no banco do app ANTES de o front ir para a main: o
-- front antigo continua abrindo (chamado_treinamento_confirmar vira uma casca
-- que pede para atualizar a página). ROLLBACK no fim.
-- =========================================================================

-- ── 1. Participantes do treinamento ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CHAMADO_TREINAMENTO_DESTINATARIO" (
  chamado_id     uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA_VALIDACAO"(chamado_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Como entrou: escolhido a dedo ou pelo setor (e qual).
  origem         text NOT NULL DEFAULT 'usuario' CHECK (origem IN ('usuario', 'setor')),
  setor          text,
  confirmado_em  timestamptz,
  confirmado_obs text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chamado_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chamado_trein_dest_user ON public."CHAMADO_TREINAMENTO_DESTINATARIO"(user_id, confirmado_em);

ALTER TABLE public."CHAMADO_TREINAMENTO_DESTINATARIO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CHAMADO_TREINAMENTO_DESTINATARIO" FROM PUBLIC, anon;
GRANT SELECT ON public."CHAMADO_TREINAMENTO_DESTINATARIO" TO authenticated;

-- Ler: o próprio participante, quem já enxerga a validação do chamado
-- (dev, solicitante, responsável, gestão, Presidência). Escrever: só RPC.
DROP POLICY IF EXISTS chamado_trein_dest_select ON public."CHAMADO_TREINAMENTO_DESTINATARIO";
CREATE POLICY chamado_trein_dest_select ON public."CHAMADO_TREINAMENTO_DESTINATARIO" FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    OR (select public.chamado_sistema_gestor())
    OR (select public.tem_acesso_menu('presidencia_chamados_dev'))
    OR (select public.tem_acesso_menu('presidencia_chamados_dev_validar'))
    OR EXISTS (
      SELECT 1 FROM public."CHAMADO_SISTEMA" c
        JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
       WHERE c.id = "CHAMADO_TREINAMENTO_DESTINATARIO".chamado_id
         AND ((select auth.uid()) IN (c.solicitante_id, c.responsavel_id, v.desenvolvedor_id))
    )
  );

-- Chamado reaberto (sync da mig 266 zera treinamento_dev_*): a lista de
-- participantes era da entrega antiga — sai junto.
CREATE OR REPLACE FUNCTION public.chamado_treinamento_limpa_destinatarios()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.treinamento_dev_em IS NOT NULL AND NEW.treinamento_dev_em IS NULL THEN
    DELETE FROM public."CHAMADO_TREINAMENTO_DESTINATARIO" WHERE chamado_id = NEW.chamado_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.chamado_treinamento_limpa_destinatarios() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_chamado_treinamento_limpa_dest ON public."CHAMADO_SISTEMA_VALIDACAO";
CREATE TRIGGER trg_chamado_treinamento_limpa_dest
  AFTER UPDATE OF treinamento_dev_em ON public."CHAMADO_SISTEMA_VALIDACAO"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_treinamento_limpa_destinatarios();

-- ── 2. O dev envia o treinamento ─────────────────────────────────────────
-- A confirmação antiga (dev + solicitante no chamado, mig 266/269) sai. Fica
-- uma casca com o mesmo nome e assinatura da 269, só para o front que ainda
-- estiver aberto (antes de publicar o novo) receber uma mensagem clara em vez
-- de "function not found" — e para esta migration poder ser aplicada ANTES
-- do merge sem quebrar a tela no ar.
DROP FUNCTION IF EXISTS public.chamado_treinamento_confirmar(uuid, text);
CREATE OR REPLACE FUNCTION public.chamado_treinamento_confirmar(
  p_chamado_id uuid, p_observacao text DEFAULT NULL, p_papel text DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'O treinamento mudou: o desenvolvedor envia o treinamento pela tela do chamado e cada participante confirma em Central de Serviços › Treinamentos Sistemas. Atualize a página (Ctrl+F5).';
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_treinamento_confirmar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_treinamento_confirmar(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chamado_treinamento_enviar(
  p_chamado_id uuid, p_usuarios uuid[] DEFAULT NULL, p_setores text[] DEFAULT NULL, p_observacao text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_obs   text := NULLIF(btrim(COALESCE(p_observacao, '')), '');
  v       public."CHAMADO_SISTEMA_VALIDACAO"%ROWTYPE;
  v_resp  uuid;
  v_dev   uuid;
  v_setores text[];
  v_n     integer;
  v_nome  text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada — entre de novo.'; END IF;

  SELECT * INTO v FROM public."CHAMADO_SISTEMA_VALIDACAO" WHERE chamado_id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este chamado não passa pela validação da Presidência.'; END IF;
  IF v.etapa <> 'treinamento' THEN
    RAISE EXCEPTION 'O treinamento só é enviado depois que a Presidência aprova o desenvolvimento.';
  END IF;
  IF v.treinamento_dev_em IS NOT NULL THEN
    RAISE EXCEPTION 'O treinamento deste chamado já foi enviado.';
  END IF;

  SELECT responsavel_id INTO v_resp FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id;
  v_dev := COALESCE(v.desenvolvedor_id, v_resp);
  IF NOT (v_uid = v_dev OR public.chamado_sistema_gestor()) THEN
    RAISE EXCEPTION 'Só o desenvolvedor que concluiu (ou a gestão de chamados) envia o treinamento.';
  END IF;

  -- Setores normalizados (maiúsculo, sem acento) para casar com o Setor_ERP.
  SELECT array_agg(DISTINCT upper(public.trn_slugify_sem_hifen(s)))
    INTO v_setores
    FROM unnest(COALESCE(p_setores, '{}'::text[])) s
   WHERE btrim(COALESCE(s, '')) <> '';

  -- Setor inteiro: logins ativos com aquele Setor_ERP agora.
  INSERT INTO public."CHAMADO_TREINAMENTO_DESTINATARIO"(chamado_id, user_id, origem, setor)
  SELECT DISTINCT ON (p.id) p_chamado_id, p.id, 'setor', btrim(e."Setor_ERP")
    FROM public.profiles p
    JOIN public."EMPREGADOS" e ON e.auth_user_id = p.id
   WHERE p.ativo
     AND v_setores IS NOT NULL
     AND upper(public.trn_slugify_sem_hifen(e."Setor_ERP")) = ANY (v_setores)
  ON CONFLICT (chamado_id, user_id) DO NOTHING;

  -- Escolhidos a dedo (só login ativo). Quem já entrou pelo setor vira "usuario".
  INSERT INTO public."CHAMADO_TREINAMENTO_DESTINATARIO"(chamado_id, user_id, origem)
  SELECT DISTINCT p_chamado_id, p.id, 'usuario'
    FROM public.profiles p
   WHERE p.ativo AND p.id = ANY (COALESCE(p_usuarios, '{}'::uuid[]))
  ON CONFLICT (chamado_id, user_id) DO UPDATE SET origem = 'usuario', setor = NULL;

  SELECT count(*) INTO v_n FROM public."CHAMADO_TREINAMENTO_DESTINATARIO" WHERE chamado_id = p_chamado_id;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um usuário ou um setor com pessoas ativas no ERP.';
  END IF;

  UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
     SET treinamento_dev_por = v_uid, treinamento_dev_em = now(), treinamento_dev_obs = v_obs
   WHERE chamado_id = p_chamado_id;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;
  PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
    format('Treinamento enviado por %s para %s pessoa(s)%s%s — confirmam em Central de Serviços › Treinamentos',
           COALESCE(v_nome, 'usuário'), v_n,
           CASE WHEN v_setores IS NOT NULL THEN ' (setores: ' || array_to_string(p_setores, ', ') || ')' ELSE '' END,
           COALESCE(': ' || v_obs, '')));
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_treinamento_enviar(uuid, uuid[], text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_treinamento_enviar(uuid, uuid[], text[], text) TO authenticated;

-- Normalização de setor: sem acento, maiúsculo, espaços simples. (trn_slugify
-- da mig 190 troca espaço por hífen — aqui o setor tem que casar com o texto.)
CREATE OR REPLACE FUNCTION public.trn_slugify_sem_hifen(_txt text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT regexp_replace(btrim(upper(translate(coalesce(_txt, ''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))), '\s+', ' ', 'g');
$$;

-- ── 3. O participante confirma que recebeu ───────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_treinamento_confirmar_recebimento(p_chamado_id uuid, p_observacao text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_obs  text := NULLIF(btrim(COALESCE(p_observacao, '')), '');
  d      public."CHAMADO_TREINAMENTO_DESTINATARIO"%ROWTYPE;
  v_nome text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada — entre de novo.'; END IF;

  SELECT * INTO d FROM public."CHAMADO_TREINAMENTO_DESTINATARIO"
   WHERE chamado_id = p_chamado_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Você não está entre os participantes deste treinamento.'; END IF;
  IF d.confirmado_em IS NOT NULL THEN RAISE EXCEPTION 'Você já confirmou este treinamento.'; END IF;

  UPDATE public."CHAMADO_TREINAMENTO_DESTINATARIO"
     SET confirmado_em = now(), confirmado_obs = v_obs
   WHERE chamado_id = p_chamado_id AND user_id = v_uid;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;
  PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
    format('%s confirmou que recebeu o treinamento%s', COALESCE(v_nome, 'Participante'), COALESCE(': ' || v_obs, '')));

  -- Todos confirmaram → finaliza.
  IF NOT EXISTS (SELECT 1 FROM public."CHAMADO_TREINAMENTO_DESTINATARIO"
                  WHERE chamado_id = p_chamado_id AND confirmado_em IS NULL) THEN
    UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
       SET etapa = 'finalizado', finalizado_em = now()
     WHERE chamado_id = p_chamado_id AND etapa = 'treinamento';
    IF FOUND THEN
      PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
        'Todos os participantes confirmaram o treinamento — solicitação finalizada');
      RETURN 'finalizado';
    END IF;
  END IF;
  RETURN 'treinamento';
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_treinamento_confirmar_recebimento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_treinamento_confirmar_recebimento(uuid, text) TO authenticated;

-- ── 4. "Treinamentos Sistemas" — os meus ─────────────────────────────────
-- Lê o chamado sem abrir a RLS dele: o participante pode não ser nem
-- solicitante nem responsável (entrou pelo setor).
CREATE OR REPLACE FUNCTION public.treinamentos_sistemas_meus()
RETURNS TABLE (
  chamado_id uuid, numero text, assunto text, descricao text, modulo_sistema text, modulo_sistema_outro text,
  solicitante_nome text, desenvolvedor_nome text, enviado_por_nome text, enviado_em timestamptz, enviado_obs text,
  origem text, setor text, confirmado_em timestamptz, confirmado_obs text,
  participantes integer, confirmados integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.numero, c.assunto, c.descricao, c.modulo_sistema, c.modulo_sistema_outro,
         c.solicitante_nome, pd.display_name, pe.display_name, v.treinamento_dev_em, v.treinamento_dev_obs,
         d.origem, d.setor, d.confirmado_em, d.confirmado_obs,
         (SELECT count(*)::int FROM public."CHAMADO_TREINAMENTO_DESTINATARIO" x WHERE x.chamado_id = d.chamado_id),
         (SELECT count(*)::int FROM public."CHAMADO_TREINAMENTO_DESTINATARIO" x WHERE x.chamado_id = d.chamado_id AND x.confirmado_em IS NOT NULL)
    FROM public."CHAMADO_TREINAMENTO_DESTINATARIO" d
    JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = d.chamado_id
    JOIN public."CHAMADO_SISTEMA" c ON c.id = d.chamado_id
    LEFT JOIN public.profiles pd ON pd.id = COALESCE(v.desenvolvedor_id, c.responsavel_id)
    LEFT JOIN public.profiles pe ON pe.id = v.treinamento_dev_por
   WHERE d.user_id = auth.uid()
   ORDER BY (d.confirmado_em IS NOT NULL), v.treinamento_dev_em DESC;
$$;
REVOKE ALL ON FUNCTION public.treinamentos_sistemas_meus() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.treinamentos_sistemas_meus() TO authenticated;

-- ── 5. Lista da Presidência com o andamento do treinamento ───────────────
-- Retorno muda (participantes/confirmados) → DROP + CREATE. Corpo igual ao
-- da mig 266 fora as duas colunas novas.
DROP FUNCTION IF EXISTS public.chamado_presidencia_listar();
CREATE OR REPLACE FUNCTION public.chamado_presidencia_listar()
RETURNS TABLE (
  chamado_id uuid, numero text, assunto text, descricao text, prioridade text,
  modulo_sistema text, modulo_sistema_outro text, status text,
  solicitante_id uuid, solicitante_nome text, setor text,
  responsavel_id uuid, responsavel_nome text, chamado_criado_em timestamptz,
  etapa text, enviado_por_nome text, enviado_em timestamptz, observacao_envio text,
  desenvolvedor_id uuid, desenvolvedor_nome text, desenvolvimento_concluido_em timestamptz,
  devolucoes integer, presidencia_por uuid, presidencia_nome text, presidencia_em timestamptz,
  presidencia_aprovado boolean, presidencia_parecer text,
  treinamento_dev_em timestamptz, treinamento_dev_obs text,
  treinamento_solic_em timestamptz, treinamento_solic_obs text,
  finalizado_em timestamptz,
  treinamento_participantes integer, treinamento_confirmados integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.tem_acesso_menu('presidencia_chamados_dev')
          OR public.tem_acesso_menu('presidencia_chamados_dev_validar')) THEN
    RAISE EXCEPTION 'Sem acesso a Desenvolvimento Chamados.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.numero, c.assunto, c.descricao, c.prioridade,
         c.modulo_sistema, c.modulo_sistema_outro, c.status,
         c.solicitante_id, c.solicitante_nome, c.setor,
         c.responsavel_id, pr.display_name, c.created_at,
         v.etapa, pe.display_name, v.enviado_em, v.observacao_envio,
         v.desenvolvedor_id, pd.display_name, v.desenvolvimento_concluido_em,
         v.devolucoes, v.presidencia_por, pp.display_name, v.presidencia_em,
         v.presidencia_aprovado, v.presidencia_parecer,
         v.treinamento_dev_em, v.treinamento_dev_obs,
         v.treinamento_solic_em, v.treinamento_solic_obs,
         v.finalizado_em,
         (SELECT count(*)::int FROM public."CHAMADO_TREINAMENTO_DESTINATARIO" d WHERE d.chamado_id = v.chamado_id),
         (SELECT count(*)::int FROM public."CHAMADO_TREINAMENTO_DESTINATARIO" d WHERE d.chamado_id = v.chamado_id AND d.confirmado_em IS NOT NULL)
    FROM public."CHAMADO_SISTEMA_VALIDACAO" v
    JOIN public."CHAMADO_SISTEMA" c ON c.id = v.chamado_id
    LEFT JOIN public.profiles pr ON pr.id = c.responsavel_id
    LEFT JOIN public.profiles pe ON pe.id = v.enviado_por
    LEFT JOIN public.profiles pd ON pd.id = COALESCE(v.desenvolvedor_id, c.responsavel_id)
    LEFT JOIN public.profiles pp ON pp.id = v.presidencia_por
   ORDER BY COALESCE(v.desenvolvimento_concluido_em, v.enviado_em) DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_presidencia_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_presidencia_listar() TO authenticated;

-- ── 6. Pendências do solicitante: só a avaliação ─────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_pendencias_solicitante(p_uid uuid)
RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamptz, pendencia text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.numero, c.assunto, c.concluido_em, 'avaliacao'::text
    FROM public."CHAMADO_SISTEMA" c
    LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
   WHERE c.solicitante_id = p_uid
     AND c.status = 'concluido'
     AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
     -- Presidência ainda validando (ou devolvido ao dev): nada a fazer pelo solicitante.
     AND (v.chamado_id IS NULL OR v.etapa IN ('treinamento', 'finalizado'))
   ORDER BY c.concluido_em NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.chamado_pendencias_solicitante(uuid) FROM PUBLIC, anon;

-- A RPC da tela ganha a coluna `pendencia` — mudar o retorno exige DROP.
DROP FUNCTION IF EXISTS public.chamados_meus_avaliacoes_pendentes();
CREATE OR REPLACE FUNCTION public.chamados_meus_avaliacoes_pendentes()
RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamptz, pendencia text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.chamado_pendencias_solicitante(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.chamados_meus_avaliacoes_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamados_meus_avaliacoes_pendentes() TO authenticated;

-- Trava ao abrir novo chamado (mesma regra da tela). O trigger
-- trg_chamado_bloqueia_avaliacao (mig 20260810000001) já aponta para ela.
CREATE OR REPLACE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.chamado_pendencias_solicitante(NEW.solicitante_id)) THEN
    RAISE EXCEPTION 'Você tem chamados concluídos aguardando avaliação. Avalie-os antes de abrir um novo.';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 7. Avaliar só depois da Presidência ──────────────────────────────────
-- A trava da 269 ("confirme o treinamento antes de avaliar") sai: o
-- solicitante não confirma mais treinamento no chamado.
DROP TRIGGER IF EXISTS trg_chamado_avaliacao_exige_treinamento ON public."CHAMADO_SISTEMA_AVALIACAO";
DROP FUNCTION IF EXISTS public.chamado_avaliacao_exige_treinamento();

CREATE OR REPLACE FUNCTION public.chamado_avaliacao_exige_presidencia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_VALIDACAO"
              WHERE chamado_id = NEW.chamado_id AND etapa IN ('desenvolvimento', 'validacao_presidencia')) THEN
    RAISE EXCEPTION 'Este chamado ainda está na validação da Presidência. A avaliação abre depois que ela aprovar.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_avaliacao_exige_presidencia() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_chamado_avaliacao_exige_presidencia ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE TRIGGER trg_chamado_avaliacao_exige_presidencia
  BEFORE INSERT ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_avaliacao_exige_presidencia();

-- ── 8. Chamados que já estavam no treinamento pelo fluxo antigo ──────────
-- Dev já tinha "confirmado" no chamado (mig 266/269, sem participantes): volta a ficar
-- pendente de ENVIO, para ele escolher quem recebe. O que foi confirmado no
-- fluxo antigo fica no histórico do chamado (eventos).
UPDATE public."CHAMADO_SISTEMA_VALIDACAO" v
   SET treinamento_dev_por = NULL, treinamento_dev_em = NULL, treinamento_dev_obs = NULL
 WHERE v.etapa = 'treinamento'
   AND v.treinamento_dev_em IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_TREINAMENTO_DESTINATARIO" d WHERE d.chamado_id = v.chamado_id);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_chamado_avaliacao_exige_presidencia ON public."CHAMADO_SISTEMA_AVALIACAO";
-- DROP FUNCTION IF EXISTS public.chamado_avaliacao_exige_presidencia();
-- DROP FUNCTION IF EXISTS public.treinamentos_sistemas_meus();
-- DROP FUNCTION IF EXISTS public.chamado_treinamento_confirmar_recebimento(uuid, text);
-- DROP FUNCTION IF EXISTS public.chamado_treinamento_enviar(uuid, uuid[], text[], text);
-- DROP FUNCTION IF EXISTS public.trn_slugify_sem_hifen(text);
-- DROP TRIGGER IF EXISTS trg_chamado_treinamento_limpa_dest ON public."CHAMADO_SISTEMA_VALIDACAO";
-- DROP FUNCTION IF EXISTS public.chamado_treinamento_limpa_destinatarios();
-- DROP TABLE IF EXISTS public."CHAMADO_TREINAMENTO_DESTINATARIO";
-- -- chamado_treinamento_confirmar(uuid, text), chamado_presidencia_listar(),
-- -- chamados_meus_avaliacoes_pendentes() e o corpo da trava: recriar pela
-- -- mig 20260930000266 / 20260810000001.
-- NOTIFY pgrst, 'reload schema';
