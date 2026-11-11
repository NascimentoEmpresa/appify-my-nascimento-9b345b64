-- =========================================================================
-- RECRUTAMENTO › SOLICITAR NOVA VAGA — ADMISSÃO pelo contrato e aprovação
-- obrigatória do GERENTE DE OPERAÇÕES (chamado #0848, Fernanda, 11/11/2026)
--
-- PEDIDO (resumo do documento do chamado):
--   1-3. Admissão não usa mais "colaborador de exemplo": escolhe o CONTRATO e
--        depois um dos CARGOS vinculados a ele (tela; ver ModalNovaVaga).
--   4-5. Escolhido o cargo, ativos × cotado do contrato (a mesma conta do
--        #0845, rec_vaga_substituicao_checar com p_empregado_id NULL); acima
--        do cotado, Sim/Não + JUSTIFICATIVA E QUEM AUTORIZOU (o gatilho
--        rec_vaga_exige_justificativa_quantitativo, mig 20261111235000, já
--        cobra no banco).
--   6-7. TODA Admissão nova — dentro ou acima do cotado — nasce
--        "Pendente Gerente Operações" (na tela: "Aguardando aprovação do
--        Gerente de Operações", Gustavo Barcelos). Só depois da aprovação
--        dele a vaga segue o fluxo normal.
--
-- DESENHO
--   · Status novo 'Pendente Gerente Operações', posto por gatilho no INSERT
--     de vaga com motivo Admissão (vale para todo formulário que grava vaga,
--     não só o modal). Gatilho com nome que ordena DEPOIS de
--     trg_rec_status_inicial_pela_flag (o Postgres dispara BEFORE em ordem
--     alfabética).
--   · Aprovou → a vaga vai para onde nasceria sem a regra: Pendente
--     Diretoria (administrativa) ou Pendente Analista (Operacional). A
--     aprovação gerencial é uma etapa A MAIS; não pula nenhuma que existia.
--     Reprovou → Reprovada, com motivo.
--   · Quem decide: capacidade própria, menu fantasma no Operacional
--     'operacional_gerente_aprova_admissao' (ação aprovar), concedida em
--     Administração › Acesso por Usuário. Semeada para o perfil de nome
--     Gustavo Barcelos, se existir.
--   · A decisão é por RPC SECURITY DEFINER (rec_gerente_operacoes_decidir):
--     não depende da RLS de UPDATE nem do recorte de vaga administrativa —
--     o gerente aprova também a admissão do escritório. Os gatilhos de
--     coluna (sistema_recrutamento_guard) deixam passar só dentro dela, por
--     um marcador de transação.
--   · Fila: rec_gerente_operacoes_pendentes(), também SECURITY DEFINER.
--   · Histórico: "Aprovada pelo Gerente de Operações" / reprovada com papel
--     "Gerente de Operações".
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. A capacidade ──────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'operacional_gerente_aprova_admissao', 'GERENTE DE OPERAÇÕES — APROVA ADMISSÕES', NULL, 22, true
  FROM public.app_modulo m WHERE m.codigo = 'operacional'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('operacional_gerente_aprova_admissao', 'aprovar'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- Semente: o Gerente de Operações citado no chamado (se o perfil existir).
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT p.id, 'operacional_gerente_aprova_admissao', 'aprovar'::app_acao, true,
       'Migração 20261111235500 (#0848): Gerente de Operações aprova toda Admissão'
  FROM public.profiles p
 WHERE lower(coalesce(p.display_name, '')) LIKE '%gustavo%barcelos%'
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = p.id AND x.menu_codigo = 'operacional_gerente_aprova_admissao'
                      AND x.acao = 'aprovar'::app_acao);

CREATE OR REPLACE FUNCTION public.rec_gerente_operacoes(_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT _uid IS NOT NULL
     AND public.has_screen_access(_uid, 'operacional_gerente_aprova_admissao', 'aprovar'::app_acao);
$fn$;
REVOKE ALL ON FUNCTION public.rec_gerente_operacoes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_gerente_operacoes(uuid) TO authenticated;

-- Quem é o Gerente de Operações (para a tela dizer o nome na hora de pedir).
-- Só nomes: quem abre a vaga precisa saber para quem ela vai.
CREATE OR REPLACE FUNCTION public.rec_gerente_operacoes_nomes()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce(array_agg(DISTINCT coalesce(nullif(btrim(p.display_name), ''), p.email) ORDER BY coalesce(nullif(btrim(p.display_name), ''), p.email)), '{}')
    FROM public.screen_permission_user s
    JOIN public.profiles p ON p.id = s.user_id
   WHERE s.menu_codigo = 'operacional_gerente_aprova_admissao'
     AND s.acao = 'aprovar'::app_acao AND s.allow
     AND auth.uid() IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.rec_gerente_operacoes_nomes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_gerente_operacoes_nomes() TO authenticated;

-- ── 2. Admissão nasce na fila do Gerente de Operações ────────────────────
CREATE OR REPLACE FUNCTION public.rec_vaga_admissao_gerente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Carga do sistema antigo traz o próprio status.
  IF NEW.legado_chave IS NOT NULL THEN RETURN NEW; END IF;
  IF btrim(coalesce(NEW.motivo_vaga, '')) = 'Admissão'
     AND coalesce(NEW.status, 'Pendente Analista') IN ('Pendente Analista', 'Pendente Diretoria') THEN
    NEW.status := 'Pendente Gerente Operações';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_rec_vaga_admissao_gerente ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_vaga_admissao_gerente
  BEFORE INSERT ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_vaga_admissao_gerente();

-- ── 3. O gatilho de colunas deixa a decisão do gerente passar ────────────
-- Só dentro de rec_gerente_operacoes_decidir (marcador local da transação):
-- ali já foi conferida a capacidade e o que muda é status/carimbo/motivo.
DO $do$
DECLARE
  v_def  text;
  ancora constant text := $a$    NEW.data_inicio_alteracoes := COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb);
    RETURN NEW;
  END IF;
$a$;
  novo   constant text := $a$    NEW.data_inicio_alteracoes := COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb);
    RETURN NEW;
  END IF;

  -- #0848 (mig 20261111235500): decisão do Gerente de Operações, já conferida
  -- na RPC rec_gerente_operacoes_decidir.
  IF current_setting('rec.decisao_gerente_operacoes', true) = 'on'
     AND OLD.status = 'Pendente Gerente Operações' THEN
    RETURN NEW;
  END IF;
$a$;
BEGIN
  v_def := pg_get_functiondef('public.sistema_recrutamento_guard()'::regprocedure);
  IF position('rec.decisao_gerente_operacoes' IN v_def) > 0 THEN RETURN; END IF;  -- já aplicado
  IF position(ancora IN v_def) = 0 THEN
    RAISE EXCEPTION 'sistema_recrutamento_guard mudou: não achei o fim do bloco do INSERT.';
  END IF;
  EXECUTE replace(v_def, ancora, novo);
END $do$;

-- ── 4. Histórico: o papel do Gerente de Operações ────────────────────────
DO $do$
DECLARE
  v_def text;
  rep_velho constant text := $a$WHEN 'Pendente Operacional' THEN 'Operacional' ELSE 'Recrutamento' END;$a$;
  rep_novo  constant text := $a$WHEN 'Pendente Operacional' THEN 'Operacional'
                                  WHEN 'Pendente Gerente Operações' THEN 'Gerente de Operações' ELSE 'Recrutamento' END;$a$;
  apr_velho constant text := $a$    ELSIF OLD.status = 'Pendente Operacional' THEN$a$;
  apr_novo  constant text := $a$    ELSIF OLD.status = 'Pendente Gerente Operações' THEN
      v_evento := 'Aprovada pelo Gerente de Operações'; v_papel := 'Gerente de Operações';
    ELSIF OLD.status = 'Pendente Operacional' THEN$a$;
BEGIN
  v_def := pg_get_functiondef('public.rec_historico_automatico()'::regprocedure);
  IF position('Gerente de Operações' IN v_def) > 0 THEN RETURN; END IF;  -- já aplicado
  IF position(rep_velho IN v_def) = 0 OR position(apr_velho IN v_def) = 0 THEN
    RAISE EXCEPTION 'rec_historico_automatico mudou: não achei os trechos de papel/aprovação.';
  END IF;
  EXECUTE replace(replace(v_def, rep_velho, rep_novo), apr_velho, apr_novo);
END $do$;

-- ── 5. A fila e a decisão do gerente ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_gerente_operacoes_pendentes()
RETURNS TABLE (
  id bigint, created_at timestamptz, solicitante_nome text, contrato text, cargo text,
  cidade text, estado text, quantidade_vagas text, data_inicio_prevista text,
  reserva_tecnica boolean, administrativa boolean,
  quantitativo_ativos integer, quantitativo_cotado integer, quantitativo_justificativa text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.rec_gerente_operacoes(auth.uid()) THEN
    RAISE EXCEPTION 'Só o Gerente de Operações aprova as admissões.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.created_at, r.solicitante_nome, r.contrato, r.cargo,
           r.cidade, r.estado, r.quantidade_vagas::text, r.data_inicio_prevista::text,
           coalesce(r.reserva_tecnica, false), coalesce(r.administrativa, false),
           r.quantitativo_ativos, r.quantitativo_cotado, r.quantitativo_justificativa
      FROM public."SISTEMA_RECRUTAMENTO" r
     WHERE r.status = 'Pendente Gerente Operações'
     ORDER BY r.created_at;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_gerente_operacoes_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_gerente_operacoes_pendentes() TO authenticated;

CREATE OR REPLACE FUNCTION public.rec_gerente_operacoes_decidir(p_id bigint, p_aprovar boolean, p_motivo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v      record;
  v_nome text;
  v_mail text;
  v_para text;
BEGIN
  IF NOT public.rec_gerente_operacoes(auth.uid()) THEN
    RAISE EXCEPTION 'Só o Gerente de Operações aprova as admissões.' USING ERRCODE = '42501';
  END IF;
  SELECT r.id, r.status, r.administrativa INTO v
    FROM public."SISTEMA_RECRUTAMENTO" r WHERE r.id = p_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vaga #% não existe.', p_id; END IF;
  IF v.status IS DISTINCT FROM 'Pendente Gerente Operações' THEN
    RAISE EXCEPTION 'A vaga #% não está aguardando o Gerente de Operações (está em "%").', p_id, v.status;
  END IF;
  IF NOT p_aprovar AND length(btrim(coalesce(p_motivo, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.';
  END IF;

  SELECT coalesce(nullif(btrim(display_name), ''), email), email INTO v_nome, v_mail
    FROM public.profiles WHERE id = auth.uid();
  -- Aprovada: segue para onde nasceria sem a regra (o fluxo normal).
  v_para := CASE WHEN NOT p_aprovar THEN 'Reprovada'
                 WHEN coalesce(v.administrativa, false) THEN 'Pendente Diretoria'
                 ELSE 'Pendente Analista' END;

  PERFORM set_config('rec.decisao_gerente_operacoes', 'on', true);
  UPDATE public."SISTEMA_RECRUTAMENTO"
     SET status = v_para,
         motivo_reprovacao = CASE WHEN p_aprovar THEN motivo_reprovacao ELSE btrim(p_motivo) END
   WHERE id = p_id;
  PERFORM set_config('rec.decisao_gerente_operacoes', 'off', true);
  RETURN v_para;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_gerente_operacoes_decidir(bigint, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_gerente_operacoes_decidir(bigint, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   Vagas paradas na fila voltam para o fluxo normal antes de desfazer:
--     ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sistema_recrutamento_guard;
--     UPDATE public."SISTEMA_RECRUTAMENTO" SET status = CASE WHEN administrativa THEN 'Pendente Diretoria' ELSE 'Pendente Analista' END
--      WHERE status = 'Pendente Gerente Operações';
--     ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sistema_recrutamento_guard;
--   DROP TRIGGER IF EXISTS trg_rec_vaga_admissao_gerente ON public."SISTEMA_RECRUTAMENTO";
--   DROP FUNCTION IF EXISTS public.rec_vaga_admissao_gerente();
--   DROP FUNCTION IF EXISTS public.rec_gerente_operacoes_decidir(bigint, boolean, text);
--   DROP FUNCTION IF EXISTS public.rec_gerente_operacoes_pendentes();
--   DROP FUNCTION IF EXISTS public.rec_gerente_operacoes_nomes();
--   DROP FUNCTION IF EXISTS public.rec_gerente_operacoes(uuid);
--   sistema_recrutamento_guard / rec_historico_automatico: replace inverso dos trechos acima.
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'operacional_gerente_aprova_admissao';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'operacional_gerente_aprova_admissao';
--   DELETE FROM public.app_menu WHERE codigo = 'operacional_gerente_aprova_admissao';
