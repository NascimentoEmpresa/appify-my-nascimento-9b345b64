-- =========================================================================
-- RECRUTAMENTO × JURÍDICO — CADASTRO RESTRITIVO (25/10/2026)
--
-- PEDIDO: "criar uma lista chamada Cadastro Restritivo onde o recrutamento
-- e/ou o jurídico consiga colocar um cadastro de pessoas que tenham
-- restrição para ser contratadas; caso uma dessas pessoas se candidate, ao
-- chegar no recrutamento vai chegar a candidatura com o aviso de que ela
-- está nessa lista. Na lista: nome, CPF e motivo da restrição. No
-- Recrutamento e Seleção, integrado ao Jurídico, vão ser os CPFs com
-- restrições."
--
-- A LISTA JÁ EXISTIA: RECRUTAMENTO_CPF_BLACKLIST (cpf_digits, motivo) — o
-- Jurídico grava nela ao reprovar/restringir (Verificação de Candidatos) e
-- o Recrutamento já pinta "POSSUI RESTRIÇÕES" nos currículos. Esta migration
-- faz dela o Cadastro Restritivo, sem trocar de tabela (as telas antigas
-- seguem funcionando):
--   · colunas nome, origem ('recrutamento' | 'juridico'), atualizado_*;
--     nome preenchido para as linhas antigas pelo currículo/cadastro do CPF;
--   · histórico (RECRUTAMENTO_CPF_RESTRICAO_HIST): quem incluiu, alterou ou
--     tirou, com o motivo de cada momento;
--   · permissão de escrita para o Recrutamento E o Jurídico (antes só o
--     menu 'candidatos' do Jurídico);
--   · candidatura com CPF restrito: vira evento no histórico da vaga e
--     notifica a responsável pela vaga — o aviso chega junto.
--
-- MENUS (sem permissão para ninguém):
--   recrutamento_cadastro_restritivo  /app/rh/recrutamento/cadastro-restritivo
--   juridico_cadastro_restritivo      /app/juridico/cadastro-restritivo
-- visualizar = ver a lista; incluir / alterar / excluir = editar.
-- Quem já gravava pelo Jurídico ('candidatos' alterar) continua gravando.
-- Idempotente.
-- =========================================================================

-- ── 1) Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'recrutamento_cadastro_restritivo', 'Cadastro Restritivo', '/app/rh/recrutamento/cadastro-restritivo', 30, true
  FROM public.app_modulo m WHERE m.codigo = 'recrutamento'
ON CONFLICT (modulo_id, codigo) DO NOTHING;
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'juridico_cadastro_restritivo', 'Cadastro Restritivo', '/app/juridico/cadastro-restritivo', 30, true
  FROM public.app_modulo m WHERE m.codigo = 'juridico'
ON CONFLICT (modulo_id, codigo) DO NOTHING;
INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('recrutamento_cadastro_restritivo', 'excluir'::app_acao),
  ('juridico_cadastro_restritivo', 'excluir'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.rec_restritivo_pode(_acao text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
       public.has_screen_access(auth.uid(), 'recrutamento_cadastro_restritivo', _acao::public.app_acao)
    OR public.has_screen_access(auth.uid(), 'juridico_cadastro_restritivo', _acao::public.app_acao)
    -- Jurídico pela Verificação de Candidatos (regra de 17/07/2026).
    OR (_acao <> 'visualizar' AND public.has_screen_access(auth.uid(), 'candidatos', 'alterar'::public.app_acao)))
$$;
REVOKE ALL ON FUNCTION public.rec_restritivo_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_restritivo_pode(text) TO authenticated;

-- ── 2) Colunas novas ─────────────────────────────────────────────────────
ALTER TABLE public."RECRUTAMENTO_CPF_BLACKLIST"
  ADD COLUMN IF NOT EXISTS nome           text,
  ADD COLUMN IF NOT EXISTS origem         text,
  ADD COLUMN IF NOT EXISTS atualizado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS atualizado_por text;
ALTER TABLE public."RECRUTAMENTO_CPF_BLACKLIST" DROP CONSTRAINT IF EXISTS rec_cpf_bl_origem_check;
ALTER TABLE public."RECRUTAMENTO_CPF_BLACKLIST" ADD CONSTRAINT rec_cpf_bl_origem_check
  CHECK (origem IS NULL OR origem IN ('recrutamento', 'juridico'));

-- As linhas antigas vieram do Jurídico; o nome sai do currículo mais recente
-- do CPF, senão do cadastro de colaboradores.
UPDATE public."RECRUTAMENTO_CPF_BLACKLIST" b SET origem = 'juridico' WHERE b.origem IS NULL;
UPDATE public."RECRUTAMENTO_CPF_BLACKLIST" b
   SET nome = COALESCE(
     (SELECT NULLIF(btrim(c.nome), '') FROM public."WA_CURRICULOS" c
       WHERE regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g') = b.cpf_digits AND NULLIF(btrim(c.nome), '') IS NOT NULL
       ORDER BY c.created_at DESC LIMIT 1),
     (SELECT NULLIF(btrim(e."Nome"), '') FROM public."EMPREGADOS" e
       WHERE regexp_replace(COALESCE(e."CPF"::text, ''), '\D', '', 'g') = b.cpf_digits
       ORDER BY e."ID" DESC LIMIT 1))
 WHERE b.nome IS NULL;

-- Normaliza o CPF e carimba quem mexeu (vale para todas as telas que gravam).
CREATE OR REPLACE FUNCTION public.rec_restritivo_normaliza()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_d text := regexp_replace(COALESCE(NEW.cpf_digits, NEW.cpf_fmt, ''), '\D', '', 'g');
BEGIN
  IF length(v_d) <> 11 THEN RAISE EXCEPTION 'CPF inválido: informe os 11 dígitos.'; END IF;
  IF NULLIF(btrim(COALESCE(NEW.motivo, '')), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da restrição.'; END IF;
  NEW.cpf_digits := v_d;
  NEW.cpf_fmt := substr(v_d, 1, 3) || '.' || substr(v_d, 4, 3) || '.' || substr(v_d, 7, 3) || '-' || substr(v_d, 10, 2);
  NEW.nome := NULLIF(upper(btrim(COALESCE(NEW.nome, ''))), '');
  NEW.motivo := btrim(NEW.motivo);
  IF TG_OP = 'UPDATE' THEN
    NEW.atualizado_em := now();
    NEW.atualizado_por := COALESCE((SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = auth.uid()), NEW.atualizado_por);
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_restritivo_normaliza() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rec_restritivo_normaliza ON public."RECRUTAMENTO_CPF_BLACKLIST";
CREATE TRIGGER trg_rec_restritivo_normaliza BEFORE INSERT OR UPDATE ON public."RECRUTAMENTO_CPF_BLACKLIST"
  FOR EACH ROW EXECUTE FUNCTION public.rec_restritivo_normaliza();

-- ── 3) Histórico ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_CPF_RESTRICAO_HIST" (
  id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  cpf_digits  text NOT NULL,
  nome        text,
  motivo      text,
  origem      text,
  acao        text NOT NULL CHECK (acao IN ('incluido', 'alterado', 'removido')),
  observacao  text,                 -- por que saiu da lista (rec_restritivo_remover)
  por         text,
  em          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rec_cpf_restr_hist ON public."RECRUTAMENTO_CPF_RESTRICAO_HIST"(cpf_digits, em DESC);
ALTER TABLE public."RECRUTAMENTO_CPF_RESTRICAO_HIST" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."RECRUTAMENTO_CPF_RESTRICAO_HIST" FROM PUBLIC, anon;
GRANT SELECT ON public."RECRUTAMENTO_CPF_RESTRICAO_HIST" TO authenticated;
DROP POLICY IF EXISTS rec_cpf_restr_hist_sel ON public."RECRUTAMENTO_CPF_RESTRICAO_HIST";
CREATE POLICY rec_cpf_restr_hist_sel ON public."RECRUTAMENTO_CPF_RESTRICAO_HIST" FOR SELECT TO authenticated
  USING (public.rec_restritivo_pode('visualizar') OR public.has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao));

CREATE OR REPLACE FUNCTION public.rec_restritivo_historico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_por text := COALESCE((SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = auth.uid()), 'Sistema');
  r public."RECRUTAMENTO_CPF_BLACKLIST";
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_OP = 'UPDATE' AND NEW.motivo IS NOT DISTINCT FROM OLD.motivo AND NEW.nome IS NOT DISTINCT FROM OLD.nome
     AND NEW.origem IS NOT DISTINCT FROM OLD.origem THEN
    RETURN NULL;
  END IF;
  INSERT INTO public."RECRUTAMENTO_CPF_RESTRICAO_HIST" (cpf_digits, nome, motivo, origem, acao, observacao, por)
  VALUES (r.cpf_digits, r.nome, r.motivo, r.origem,
          CASE TG_OP WHEN 'INSERT' THEN 'incluido' WHEN 'UPDATE' THEN 'alterado' ELSE 'removido' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULLIF(current_setting('rec.motivo_remocao', true), '') END, v_por);
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_restritivo_historico() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rec_restritivo_historico ON public."RECRUTAMENTO_CPF_BLACKLIST";
CREATE TRIGGER trg_rec_restritivo_historico AFTER INSERT OR UPDATE OR DELETE ON public."RECRUTAMENTO_CPF_BLACKLIST"
  FOR EACH ROW EXECUTE FUNCTION public.rec_restritivo_historico();

-- ── 4) RLS: Recrutamento e Jurídico leem e gravam ────────────────────────
DROP POLICY IF EXISTS recrutamento_cpf_blacklist_select ON public."RECRUTAMENTO_CPF_BLACKLIST";
CREATE POLICY recrutamento_cpf_blacklist_select ON public."RECRUTAMENTO_CPF_BLACKLIST" FOR SELECT TO authenticated
  USING (
    public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
    OR public.has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
    OR public.has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
    OR public.rec_restritivo_pode('visualizar')
  );
DROP POLICY IF EXISTS recrutamento_cpf_blacklist_write ON public."RECRUTAMENTO_CPF_BLACKLIST";
DROP POLICY IF EXISTS recrutamento_cpf_blacklist_ins ON public."RECRUTAMENTO_CPF_BLACKLIST";
CREATE POLICY recrutamento_cpf_blacklist_ins ON public."RECRUTAMENTO_CPF_BLACKLIST" FOR INSERT TO authenticated
  WITH CHECK (public.rec_restritivo_pode('incluir') OR public.rec_restritivo_pode('alterar'));
DROP POLICY IF EXISTS recrutamento_cpf_blacklist_upd ON public."RECRUTAMENTO_CPF_BLACKLIST";
CREATE POLICY recrutamento_cpf_blacklist_upd ON public."RECRUTAMENTO_CPF_BLACKLIST" FOR UPDATE TO authenticated
  USING (public.rec_restritivo_pode('alterar') OR public.rec_restritivo_pode('incluir'))
  WITH CHECK (public.rec_restritivo_pode('alterar') OR public.rec_restritivo_pode('incluir'));
DROP POLICY IF EXISTS recrutamento_cpf_blacklist_del ON public."RECRUTAMENTO_CPF_BLACKLIST";
CREATE POLICY recrutamento_cpf_blacklist_del ON public."RECRUTAMENTO_CPF_BLACKLIST" FOR DELETE TO authenticated
  USING (public.rec_restritivo_pode('excluir'));

-- Nome sugerido para um CPF digitado (currículo mais recente, senão cadastro).
CREATE OR REPLACE FUNCTION public.rec_restritivo_nome_do_cpf(p_cpf text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_d text := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
BEGIN
  IF NOT (public.rec_restritivo_pode('incluir') OR public.rec_restritivo_pode('alterar')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF length(v_d) <> 11 THEN RETURN NULL; END IF;
  RETURN COALESCE(
    (SELECT NULLIF(btrim(c.nome), '') FROM public."WA_CURRICULOS" c
      WHERE regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g') = v_d AND NULLIF(btrim(c.nome), '') IS NOT NULL
      ORDER BY c.created_at DESC LIMIT 1),
    (SELECT NULLIF(btrim(e."Nome"), '') FROM public."EMPREGADOS" e
      WHERE regexp_replace(COALESCE(e."CPF"::text, ''), '\D', '', 'g') = v_d ORDER BY e."ID" DESC LIMIT 1));
END $fn$;
REVOKE ALL ON FUNCTION public.rec_restritivo_nome_do_cpf(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_restritivo_nome_do_cpf(text) TO authenticated;

-- Tirar da lista com o motivo (fica no histórico).
CREATE OR REPLACE FUNCTION public.rec_restritivo_remover(p_cpf text, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_d text := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
BEGIN
  IF NOT public.rec_restritivo_pode('excluir') THEN RAISE EXCEPTION 'Sem permissão para tirar CPF do Cadastro Restritivo.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(COALESCE(p_motivo, '')), '') IS NULL THEN RAISE EXCEPTION 'Informe por que a restrição está sendo retirada.'; END IF;
  PERFORM set_config('rec.motivo_remocao', btrim(p_motivo), true);
  DELETE FROM public."RECRUTAMENTO_CPF_BLACKLIST" WHERE cpf_digits = v_d;
  IF NOT FOUND THEN RAISE EXCEPTION 'CPF não está no Cadastro Restritivo.'; END IF;
  PERFORM set_config('rec.motivo_remocao', '', true);
END $fn$;
REVOKE ALL ON FUNCTION public.rec_restritivo_remover(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_restritivo_remover(text, text) TO authenticated;

-- ── 5) Candidatura de CPF restrito: o aviso chega junto ──────────────────
-- Vale para o portal, o WhatsApp e a inclusão manual: evento no histórico da
-- vaga e notificação para a responsável pela vaga (quando houver).
CREATE OR REPLACE FUNCTION public.rec_restritivo_avisa_candidatura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_d    text := regexp_replace(COALESCE(NEW.cpf, NEW.cpf_cand, ''), '\D', '', 'g');
  b      public."RECRUTAMENTO_CPF_BLACKLIST";
  v_resp uuid;
  v_vaga record;
BEGIN
  IF NEW.vaga_id IS NULL OR length(v_d) <> 11 THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND regexp_replace(COALESCE(OLD.cpf, OLD.cpf_cand, ''), '\D', '', 'g') = v_d
     AND OLD.vaga_id IS NOT DISTINCT FROM NEW.vaga_id THEN RETURN NULL; END IF;
  SELECT * INTO b FROM public."RECRUTAMENTO_CPF_BLACKLIST" WHERE cpf_digits = v_d;
  IF b.cpf_digits IS NULL THEN RETURN NULL; END IF;
  BEGIN
    SELECT id, cargo, contrato INTO v_vaga FROM public."SISTEMA_RECRUTAMENTO" WHERE id = NEW.vaga_id;
    INSERT INTO public."RECRUTAMENTO_HISTORICO" (solicitacao_id, candidato_id, candidato_nome, evento, papel, usuario_nome, detalhe)
    VALUES (NEW.vaga_id, NEW.id, NEW.nome, 'Candidatura de CPF no Cadastro Restritivo', 'Jurídico', 'Sistema',
            'Motivo: ' || b.motivo || ' (' || COALESCE(b.origem, 'jurídico') || ')');
    SELECT r.responsavel_id INTO v_resp FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r WHERE r.vaga_id = NEW.vaga_id;
    IF v_resp IS NOT NULL THEN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (v_resp, 'Candidato no Cadastro Restritivo',
              COALESCE(NEW.nome, 'Candidato') || ' (CPF ' || b.cpf_fmt || ') se candidatou à vaga #' || NEW.vaga_id
                || COALESCE(' — ' || v_vaga.cargo, '') || '. Motivo da restrição: ' || left(b.motivo, 200),
              'recrutamento_cpf_restrito', '/app/rh/recrutamento?vaga=' || NEW.vaga_id);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'rec_restritivo_avisa_candidatura: %', SQLERRM;
  END;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_restritivo_avisa_candidatura() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rec_restritivo_avisa_candidatura ON public."WA_CURRICULOS";
CREATE TRIGGER trg_rec_restritivo_avisa_candidatura AFTER INSERT OR UPDATE OF cpf, cpf_cand, vaga_id ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.rec_restritivo_avisa_candidatura();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_rec_restritivo_avisa_candidatura ON public."WA_CURRICULOS";
-- DROP TRIGGER IF EXISTS trg_rec_restritivo_historico ON public."RECRUTAMENTO_CPF_BLACKLIST";
-- DROP TRIGGER IF EXISTS trg_rec_restritivo_normaliza ON public."RECRUTAMENTO_CPF_BLACKLIST";
-- DROP FUNCTION IF EXISTS public.rec_restritivo_remover(text, text), public.rec_restritivo_avisa_candidatura(), public.rec_restritivo_nome_do_cpf(text),
--   public.rec_restritivo_historico(), public.rec_restritivo_normaliza();
-- DROP POLICY IF EXISTS recrutamento_cpf_blacklist_ins ON public."RECRUTAMENTO_CPF_BLACKLIST";
-- DROP POLICY IF EXISTS recrutamento_cpf_blacklist_upd ON public."RECRUTAMENTO_CPF_BLACKLIST";
-- DROP POLICY IF EXISTS recrutamento_cpf_blacklist_del ON public."RECRUTAMENTO_CPF_BLACKLIST";
-- (recriar recrutamento_cpf_blacklist_select/_write da mig 20260717190008)
-- DROP FUNCTION IF EXISTS public.rec_restritivo_pode(text);
-- DROP TABLE IF EXISTS public."RECRUTAMENTO_CPF_RESTRICAO_HIST";
-- ALTER TABLE public."RECRUTAMENTO_CPF_BLACKLIST" DROP CONSTRAINT IF EXISTS rec_cpf_bl_origem_check,
--   DROP COLUMN IF EXISTS nome, DROP COLUMN IF EXISTS origem, DROP COLUMN IF EXISTS atualizado_em, DROP COLUMN IF EXISTS atualizado_por;
-- DELETE FROM public.app_menu WHERE codigo IN ('recrutamento_cadastro_restritivo', 'juridico_cadastro_restritivo');
