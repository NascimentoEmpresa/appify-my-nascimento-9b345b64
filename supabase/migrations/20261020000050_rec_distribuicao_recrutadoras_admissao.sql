-- =========================================================================
-- RECRUTAMENTO — DISTRIBUIÇÃO DAS VAGAS ENTRE AS RECRUTADORAS, ENCAMINHAMENTO
-- PARA A ADMISSÃO E DADOS DO ACOMPANHAMENTO GERENCIAL (19/10/2026)
--
-- CHAMADO (resumo):
--   1. Na solicitação da vaga, "Responsável pelo recrutamento" (Giovana,
--      Thaimiani, Pamela), escolhido pela Alessandra ou pela Maiara. Cada
--      recrutadora trabalha SÓ nas vagas dela; as da colega ficam em cinza,
--      só consulta — "não basta alterar a cor: o sistema precisa
--      efetivamente bloquear as ações". A gestão vê e define tudo.
--   2. No kanban, etapa Admissão: "Finalizar recrutamento e enviar para
--      Admissão" → fila da Giovana (Novas Admissões), "Aguardando admissão",
--      com a recrutadora que conduziu registrada. Não conclui a admissão.
--   3. "Responsável atual" na listagem e dashboard (contrato, tempo em
--      aberto desde a SOLICITAÇÃO, etapa atual e desde quando, tempo em
--      cada etapa, responsáveis, desistências com etapa e motivo).
--
-- O QUE JÁ EXISTIA E FOI REAPROVEITADO
--   · Responsável por vaga (SISTEMA_RECRUTAMENTO_RESPONSAVEL, migs
--     20261013000003 / 20261014000003 / 20261014000047): automático, manual,
--     assumido, com aviso de "nova demanda" ao transferir.
--   · Histórico com data e usuário de cada troca de status da vaga
--     (rec_historico_automatico) e de cada movimento do candidato.
--   · Desistência com motivo, data e etapa (WA_CURRICULOS.desistiu...,
--     mig 20260906000012), separada da reprovação.
--   · A fila da Admissão: RH › Novas Admissões lista quem tem
--     enviado_admissao_em e ainda não foi admitido (admitido_em).
--
-- O QUE ESTA MIGRATION ACRESCENTA
--   a) origem 'distribuida' no responsável: a vaga foi ATRIBUÍDA pela gestão.
--      Só a gestão troca (trigger de guarda); "Tornar-me responsável", o
--      automático e o "definir" antigo não mexem mais nela.
--   b) TRAVA NO BANCO: recrutadora (alterar na Gestão Recrutamento, sem ser
--      gestão) não altera vaga distribuída a outra pessoa nem os candidatos
--      dela (triggers em SISTEMA_RECRUTAMENTO e WA_CURRICULOS). Exceção: a
--      responsável pela Admissão, nas vagas com candidato encaminhado a ela.
--      Vaga sem distribuição segue como antes.
--   c) Admissão: responsável da Admissão no candidato (preenchido sozinho
--      quando só uma pessoa tem a fila) + notificação para ela.
--   d) rec_acompanhamento_vagas: o que o dashboard precisa além do
--      dir_vagas_painel (recrutadora, responsável atual, desistências com
--      motivo e etapa, reprovações).
--
-- PERMISSÕES — nenhuma concedida. Menus fantasmas novos:
--   recrutamento_distribuir  → gestão (Alessandra, Maiara): define a
--                              recrutadora e mexe em todas as vagas.
--   recrutamento_admissao    → quem recebe a fila da Admissão (Giovana).
-- Liberar em Administração › Acesso por Usuário.
--
-- Idempotente.
-- =========================================================================

-- ── 1) Menus fantasmas ───────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'recrutamento_distribuir', U&'Recrutamento \2014 distribuir vagas entre as recrutadoras (gest\00E3o)', NULL, 91, true
  FROM public.app_modulo m WHERE m.codigo = 'recrutamento'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'recrutamento_admissao', U&'Recrutamento \2014 respons\00E1vel pela fila da Admiss\00E3o', NULL, 92, true
  FROM public.app_modulo m WHERE m.codigo = 'recrutamento'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2) Quem é quem ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_eh_gestor(p_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_uid IS NOT NULL AND public.has_screen_access(p_uid, 'recrutamento_distribuir', 'visualizar'::public.app_acao)
$$;
CREATE OR REPLACE FUNCTION public.rec_eh_admissao(p_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_uid IS NOT NULL AND public.has_screen_access(p_uid, 'recrutamento_admissao', 'visualizar'::public.app_acao)
$$;
-- Recrutadora = conduz o Recrutamento (alterar na Gestão) e não é gestão.
CREATE OR REPLACE FUNCTION public.rec_eh_recrutadora(p_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_uid IS NOT NULL
     AND public.has_screen_access(p_uid, 'recrutamento_gestao', 'alterar'::public.app_acao)
     AND NOT public.rec_eh_gestor(p_uid)
$$;
REVOKE ALL ON FUNCTION public.rec_eh_gestor(uuid), public.rec_eh_admissao(uuid), public.rec_eh_recrutadora(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_eh_gestor(uuid), public.rec_eh_admissao(uuid), public.rec_eh_recrutadora(uuid) TO authenticated;

-- O papel de quem está logado, para a tela decidir o que mostrar.
CREATE OR REPLACE FUNCTION public.rec_meu_papel()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('gestor', public.rec_eh_gestor(), 'recrutadora', public.rec_eh_recrutadora(),
                            'admissao', public.rec_eh_admissao())
$$;
REVOKE ALL ON FUNCTION public.rec_meu_papel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_meu_papel() TO authenticated;

-- ── 3) Origem 'distribuida' ──────────────────────────────────────────────
ALTER TABLE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" DROP CONSTRAINT IF EXISTS "SISTEMA_RECRUTAMENTO_RESPONSAVEL_origem_check";
ALTER TABLE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" ADD CONSTRAINT "SISTEMA_RECRUTAMENTO_RESPONSAVEL_origem_check"
  CHECK (origem IN ('automatico', 'manual', 'assumido', 'distribuida'));

-- Guarda: vaga distribuída só muda de dona pela gestão (rec_recrutadora_definir
-- liga a flag rec.distribuindo na transação). "Ciente" não troca pessoa nem
-- origem e passa. O gatilho automático só preenche vaga SEM responsável
-- (mig 20261014000003), então nunca chega aqui.
CREATE OR REPLACE FUNCTION public.rec_responsavel_guarda_distribuida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF OLD.origem = 'distribuida'
     AND coalesce(current_setting('rec.distribuindo', true), '') <> '1'
     AND (TG_OP = 'DELETE' OR NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id OR NEW.origem <> 'distribuida') THEN
    RAISE EXCEPTION 'A vaga #% foi distribuída para % pela gestão do Recrutamento — só a gestão troca a responsável.',
      OLD.vaga_id, OLD.responsavel_nome USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_responsavel_guarda_distribuida() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rec_responsavel_guarda_distribuida ON public."SISTEMA_RECRUTAMENTO_RESPONSAVEL";
CREATE TRIGGER trg_rec_responsavel_guarda_distribuida
  BEFORE UPDATE OR DELETE ON public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"
  FOR EACH ROW EXECUTE FUNCTION public.rec_responsavel_guarda_distribuida();

-- ── 4) As recrutadoras e a distribuição ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_recrutadoras()
RETURNS TABLE(id uuid, nome text, vagas_abertas bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso à Gestão Recrutamento.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, coalesce(nullif(btrim(p.display_name), ''), p.email)::text,
           (SELECT count(*) FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r
              JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = r.vaga_id
             WHERE r.responsavel_id = p.id AND r.origem = 'distribuida' AND public.rec_vaga_tem_responsavel(s.status))
      FROM public.profiles p
     WHERE public.rec_eh_recrutadora(p.id)
     ORDER BY 2;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_recrutadoras() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_recrutadoras() TO authenticated;

-- Gestão define (ou tira, com p_usuario NULL) a recrutadora da vaga.
CREATE OR REPLACE FUNCTION public.rec_recrutadora_definir(p_vaga bigint, p_usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_eu    text;
  v_email text;
  v_nome  text;
  v_antes public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"%ROWTYPE;
BEGIN
  IF NOT public.rec_eh_gestor(v_uid) THEN
    RAISE EXCEPTION 'Só a gestão do Recrutamento define a responsável pela vaga.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" WHERE id = p_vaga) THEN
    RAISE EXCEPTION 'Vaga #% não encontrada.', p_vaga;
  END IF;
  SELECT * INTO v_antes FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" WHERE vaga_id = p_vaga FOR UPDATE;
  v_eu := public.rec_nome_usuario(v_uid);
  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;
  PERFORM set_config('rec.distribuindo', '1', true);

  IF p_usuario IS NULL THEN
    IF v_antes.origem = 'distribuida' THEN
      UPDATE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"
         SET origem = 'manual', atualizado_em = now(), atualizado_por = v_uid
       WHERE vaga_id = p_vaga;
      INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, papel, usuario_nome, usuario_email, detalhe)
      VALUES (p_vaga, 'Distribuição retirada — a vaga fica livre para as recrutadoras', 'Gestão', v_eu, v_email,
              'Antes: ' || coalesce(v_antes.responsavel_nome, '—'));
    END IF;
  ELSE
    IF NOT public.rec_eh_recrutadora(p_usuario) THEN
      RAISE EXCEPTION 'Essa pessoa não é recrutadora (precisa de "alterar" na Gestão Recrutamento e não ser gestão).' USING ERRCODE = '22023';
    END IF;
    IF v_antes.responsavel_id = p_usuario AND v_antes.origem = 'distribuida' THEN
      RETURN to_jsonb(v_antes);
    END IF;
    v_nome := public.rec_nome_usuario(p_usuario);
    INSERT INTO public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"(vaga_id, responsavel_id, responsavel_nome, origem, atualizado_em, atualizado_por)
    VALUES (p_vaga, p_usuario, v_nome, 'distribuida', now(), v_uid)
    ON CONFLICT (vaga_id) DO UPDATE
       SET responsavel_id = EXCLUDED.responsavel_id, responsavel_nome = EXCLUDED.responsavel_nome,
           origem = 'distribuida', atualizado_em = now(), atualizado_por = v_uid;
    -- O aviso de "nova demanda" (e a notificação) sai do gatilho da mig 20261014000047.
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, papel, usuario_nome, usuario_email, detalhe)
    VALUES (p_vaga, 'Responsável pelo recrutamento: ' || v_nome, 'Gestão', v_eu, v_email,
            CASE WHEN v_antes.responsavel_nome IS NOT NULL AND v_antes.responsavel_id IS DISTINCT FROM p_usuario
                 THEN 'Antes: ' || v_antes.responsavel_nome END);
  END IF;
  PERFORM set_config('rec.distribuindo', '', true);
  RETURN (SELECT to_jsonb(r) FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r WHERE r.vaga_id = p_vaga);
END $fn$;
REVOKE ALL ON FUNCTION public.rec_recrutadora_definir(bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_recrutadora_definir(bigint, uuid) TO authenticated;

-- ── 5) Trava: vaga de outra recrutadora é só consulta ────────────────────
-- Devolve o nome da dona quando quem está logado NÃO pode mexer na vaga;
-- NULL quando pode. Sem login (webhook, cron) e vaga não distribuída: pode.
CREATE OR REPLACE FUNCTION public.rec_vaga_bloqueio(p_vaga bigint)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  r     public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR p_vaga IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" WHERE vaga_id = p_vaga;
  IF r.vaga_id IS NULL OR r.origem <> 'distribuida' OR r.responsavel_id = v_uid THEN RETURN NULL; END IF;
  IF NOT public.rec_eh_recrutadora(v_uid) THEN RETURN NULL; END IF;   -- gestão, SST, Jurídico, Compras...
  -- A Admissão trabalha os candidatos que o recrutamento encaminhou a ela.
  IF public.rec_eh_admissao(v_uid) AND EXISTS (
       SELECT 1 FROM public."WA_CURRICULOS" c WHERE c.vaga_id = p_vaga AND c.enviado_admissao_em IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN r.responsavel_nome;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_vaga_bloqueio(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_vaga_bloqueio(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.rec_trava_vaga_distribuida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_dona text;
  v_vaga bigint;
BEGIN
  FOREACH v_vaga IN ARRAY (CASE
      WHEN TG_TABLE_NAME = 'SISTEMA_RECRUTAMENTO' THEN ARRAY[NEW.id]
      WHEN TG_OP = 'INSERT' THEN ARRAY[(to_jsonb(NEW) ->> 'vaga_id')::bigint]
      WHEN TG_OP = 'DELETE' THEN ARRAY[(to_jsonb(OLD) ->> 'vaga_id')::bigint]
      ELSE ARRAY[(to_jsonb(NEW) ->> 'vaga_id')::bigint, (to_jsonb(OLD) ->> 'vaga_id')::bigint] END) LOOP
    CONTINUE WHEN v_vaga IS NULL;
    v_dona := public.rec_vaga_bloqueio(v_vaga);
    IF v_dona IS NOT NULL THEN
      RAISE EXCEPTION 'A vaga #% é de % — você pode só consultar. Peça à gestão do Recrutamento para redistribuir.', v_vaga, v_dona
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_trava_vaga_distribuida() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rec_trava_vaga_distribuida ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_trava_vaga_distribuida
  BEFORE UPDATE ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_trava_vaga_distribuida();

DROP TRIGGER IF EXISTS trg_rec_trava_candidato_vaga_distribuida ON public."WA_CURRICULOS";
CREATE TRIGGER trg_rec_trava_candidato_vaga_distribuida
  BEFORE INSERT OR UPDATE OR DELETE ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.rec_trava_vaga_distribuida();

-- ── 6) Encaminhamento para a Admissão ────────────────────────────────────
ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS admissao_responsavel_id   uuid,
  ADD COLUMN IF NOT EXISTS admissao_responsavel_nome text,
  ADD COLUMN IF NOT EXISTS recrutadora_nome          text;   -- quem conduziu o recrutamento até o envio

CREATE OR REPLACE FUNCTION public.rec_responsaveis_admissao()
RETURNS TABLE(id uuid, nome text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso à Gestão Recrutamento.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, coalesce(nullif(btrim(p.display_name), ''), p.email)::text
      FROM public.profiles p WHERE public.rec_eh_admissao(p.id) ORDER BY 2;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_responsaveis_admissao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_responsaveis_admissao() TO authenticated;

-- Ao encaminhar (enviado_admissao_em passa a ter valor): completa a
-- responsável da Admissão (a única com a fila, se a tela não mandou), grava
-- quem conduziu o recrutamento e avisa a Admissão. Desfazer o envio
-- (cancelar admissão) limpa a responsável.
CREATE OR REPLACE FUNCTION public.rec_encaminhar_admissao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_unica uuid;
  v_qtd   int;
  v_vaga  record;
BEGIN
  IF NEW.enviado_admissao_em IS NULL THEN
    NEW.admissao_responsavel_id := NULL;
    NEW.admissao_responsavel_nome := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.enviado_admissao_em IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.admissao_responsavel_id IS NULL THEN
    SELECT count(*), min(p.id::text)::uuid INTO v_qtd, v_unica
      FROM public.profiles p WHERE public.rec_eh_admissao(p.id);
    IF v_qtd = 1 THEN NEW.admissao_responsavel_id := v_unica; END IF;
  END IF;
  IF NEW.admissao_responsavel_id IS NOT NULL THEN
    NEW.admissao_responsavel_nome := public.rec_nome_usuario(NEW.admissao_responsavel_id);
  END IF;
  NEW.recrutadora_nome := coalesce(
    (SELECT r.responsavel_nome FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r WHERE r.vaga_id = NEW.vaga_id),
    public.rec_nome_usuario(auth.uid()), NEW.enviado_admissao_por);

  IF NEW.admissao_responsavel_id IS NOT NULL THEN
    BEGIN
      SELECT id, cargo, contrato INTO v_vaga FROM public."SISTEMA_RECRUTAMENTO" WHERE id = NEW.vaga_id;
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (NEW.admissao_responsavel_id, 'Candidato aguardando admissão',
              coalesce(NEW.nome, 'Candidato') || coalesce(' · vaga #' || v_vaga.id, '') || coalesce(' — ' || v_vaga.cargo, '')
                || coalesce(' (' || v_vaga.contrato || ')', '') || '. Recrutamento: ' || coalesce(NEW.recrutadora_nome, '—') || '.',
              'recrutamento_aguardando_admissao', '/app/rh/novas-admissoes');
    EXCEPTION WHEN others THEN
      RAISE WARNING 'rec_encaminhar_admissao (aviso): %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_encaminhar_admissao() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rec_encaminhar_admissao ON public."WA_CURRICULOS";
CREATE TRIGGER trg_rec_encaminhar_admissao
  BEFORE INSERT OR UPDATE OF enviado_admissao_em ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.rec_encaminhar_admissao();

-- ── 7) Dados do acompanhamento (complemento do dir_vagas_painel) ─────────
-- Por vaga: recrutadora distribuída, quem está com a etapa atual (Admissão
-- quando há candidato encaminhado e não admitido), desistências com etapa e
-- motivo ("Não informado" quando vazio) e reprovações — contadas à parte,
-- embora fiquem na mesma coluna do kanban. Só vagas que existem em ids.
CREATE OR REPLACE FUNCTION public.rec_acompanhamento_vagas(p_ids bigint[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao)
          OR public.can_access(auth.uid(), 'diretoria_rel_vagas', 'visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem acesso ao acompanhamento das vagas.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'recrutadora', CASE WHEN r.origem = 'distribuida' THEN r.responsavel_nome END,
      'responsavel', r.responsavel_nome, 'responsavel_origem', r.origem,
      'admissao', (SELECT jsonb_build_object('responsavel', max(c.admissao_responsavel_nome), 'enviado_em', min(c.enviado_admissao_em),
                                             'aguardando', count(*) FILTER (WHERE c.admitido_em IS NULL),
                                             'recrutadora', max(c.recrutadora_nome))
                     FROM public."WA_CURRICULOS" c
                    WHERE c.vaga_id = s.id AND c.enviado_admissao_em IS NOT NULL AND NOT coalesce(c.desistiu, false)
                   HAVING count(*) > 0),
      'desistencias', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'candidato_id', c.id, 'nome', c.nome,
                         'etapa', coalesce(nullif(btrim(c.desistencia_etapa), ''), 'Não informada'),
                         'motivo', coalesce(nullif(btrim(c.desistencia_motivo), ''), 'Não informado'),
                         'em', c.desistencia_em) ORDER BY c.desistencia_em)
                    FROM public."WA_CURRICULOS" c WHERE c.vaga_id = s.id AND c.desistiu), '[]'::jsonb),
      'reprovados', (SELECT count(*) FROM public."WA_CURRICULOS" c
                      WHERE c.vaga_id = s.id AND c.etapa_processo = 'Reprovado' AND NOT coalesce(c.desistiu, false))))
      FROM public."SISTEMA_RECRUTAMENTO" s
      LEFT JOIN public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r ON r.vaga_id = s.id
     WHERE s.id = ANY (p_ids)), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.rec_acompanhamento_vagas(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_acompanhamento_vagas(bigint[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_rec_encaminhar_admissao ON public."WA_CURRICULOS";
-- DROP TRIGGER IF EXISTS trg_rec_trava_candidato_vaga_distribuida ON public."WA_CURRICULOS";
-- DROP TRIGGER IF EXISTS trg_rec_trava_vaga_distribuida ON public."SISTEMA_RECRUTAMENTO";
-- DROP TRIGGER IF EXISTS trg_rec_responsavel_guarda_distribuida ON public."SISTEMA_RECRUTAMENTO_RESPONSAVEL";
-- DROP FUNCTION IF EXISTS public.rec_acompanhamento_vagas(bigint[]), public.rec_encaminhar_admissao(),
--   public.rec_responsaveis_admissao(), public.rec_trava_vaga_distribuida(), public.rec_vaga_bloqueio(bigint),
--   public.rec_recrutadora_definir(bigint, uuid), public.rec_recrutadoras(), public.rec_responsavel_guarda_distribuida(),
--   public.rec_meu_papel(), public.rec_eh_recrutadora(uuid), public.rec_eh_admissao(uuid), public.rec_eh_gestor(uuid);
-- UPDATE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" SET origem = 'manual' WHERE origem = 'distribuida';
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" DROP CONSTRAINT IF EXISTS "SISTEMA_RECRUTAMENTO_RESPONSAVEL_origem_check";
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" ADD CONSTRAINT "SISTEMA_RECRUTAMENTO_RESPONSAVEL_origem_check"
--   CHECK (origem IN ('automatico', 'manual', 'assumido'));
-- DELETE FROM public.app_menu WHERE codigo IN ('recrutamento_distribuir', 'recrutamento_admissao');
