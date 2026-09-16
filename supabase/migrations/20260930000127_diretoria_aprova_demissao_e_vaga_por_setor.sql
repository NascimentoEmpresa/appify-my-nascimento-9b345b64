-- =========================================================================
-- Diretoria aprova o que é do escritório / tem setor — em TRÊS fluxos
--
-- Pedido do Pablo em 16/09/2026: "essa regra precisa ser a mesma pra
-- demissão (solicitação de demissão na Diretoria: escritório/administrativo/
-- setor só aparece lá) e pra vaga (substituição de alguém do escritório com
-- setor vai pra Direção, ela aprova e só aí aparece pro Recrutamento)".
--
-- A Mudança de Função já tinha isso (migs 125/126). O que este arquivo faz:
--
--   1. A tabela de "quem aprova qual setor" deixa de ser da troca de função
--      e passa a valer pra Diretoria inteira: SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR
--      → SISTEMA_APROVADOR_SETOR. Uma configuração por pessoa, em
--      Administração › Acesso por Usuário, vale pros três fluxos.
--      aprova_setor(_setor) é a função genérica; stf_aprova_setor() vira
--      um apelido dela (o trigger da troca continua chamando).
--
--   2. DEMISSÃO ganha e_escritorio + setor (o encarregado marca no pedido,
--      como na troca) e o status "Pendente Diretoria": administrativa nasce
--      nele e a Diretoria aprova (→ Pendente RH) ou reprova. Trigger barra
--      decisão fora do setor; demissao_exige_vaga passa a conhecer a etapa.
--
--   3. VAGA ganha setor e o status "Pendente Diretoria": vaga administrativa
--      (flag) ou com setor nasce nele; a Diretoria aprova (→ Pendente
--      Recrutamento) ou reprova. RLS e o guard da tabela reconhecem o menu
--      novo; trigger barra decisão fora do setor.
--
--   4. Dois menus novos no módulo Diretoria (tela nova = linha em app_menu):
--      diretoria_solicitacoes_demissao e diretoria_recrutamento (com ação
--      aprovar). Sem tela de permissão nova — é o Acesso por Usuário.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Setores por aprovador: genérico ───────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR"') IS NOT NULL
     AND to_regclass('public."SISTEMA_APROVADOR_SETOR"') IS NULL THEN
    ALTER TABLE public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR" RENAME TO "SISTEMA_APROVADOR_SETOR";
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public."SISTEMA_APROVADOR_SETOR" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setor      text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, setor)
);
COMMENT ON TABLE public."SISTEMA_APROVADOR_SETOR" IS
  'Setores que cada usuário aprova na Diretoria (mudança de função, demissão e vaga administrativas). Opt-out: sem linha, não aprova nada com setor. Migrations 125/127.';

ALTER TABLE public."SISTEMA_APROVADOR_SETOR" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SISTEMA_APROVADOR_SETOR" FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public."SISTEMA_APROVADOR_SETOR" TO authenticated;

-- portaria-ok: R3 — a tabela foi renomeada (era SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR); as duas policies voltam logo abaixo com o nome genérico aprovador_setor_select / aprovador_setor_write, mesmo USING/WITH CHECK
DROP POLICY IF EXISTS stf_aprovador_setor_select ON public."SISTEMA_APROVADOR_SETOR";
-- portaria-ok: R3 — recriada abaixo como aprovador_setor_write (mesma regra: can_access administracao/alterar)
DROP POLICY IF EXISTS stf_aprovador_setor_write ON public."SISTEMA_APROVADOR_SETOR";
DROP POLICY IF EXISTS aprovador_setor_select ON public."SISTEMA_APROVADOR_SETOR";
CREATE POLICY aprovador_setor_select ON public."SISTEMA_APROVADOR_SETOR"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS aprovador_setor_write ON public."SISTEMA_APROVADOR_SETOR";
CREATE POLICY aprovador_setor_write ON public."SISTEMA_APROVADOR_SETOR"
  FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- Esta pessoa aprova este setor? Setor vazio → nada a casar → true.
CREATE OR REPLACE FUNCTION public.aprova_setor(_setor text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.cs_reembolso_norm_setor(_setor) IS NULL
      OR EXISTS (
        SELECT 1 FROM public."SISTEMA_APROVADOR_SETOR" a
         WHERE a.user_id = auth.uid()
           AND public.cs_reembolso_norm_setor(a.setor) = public.cs_reembolso_norm_setor(_setor)
      );
$fn$;
REVOKE ALL ON FUNCTION public.aprova_setor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprova_setor(text) TO authenticated;

-- Apelido: o trigger da troca de função (mig 125) chama este nome.
CREATE OR REPLACE FUNCTION public.stf_aprova_setor(_setor text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$ SELECT public.aprova_setor(_setor); $fn$;

-- ── 2) DEMISSÃO ──────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS e_escritorio boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS setor        text;
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".e_escritorio IS
  'Marcado pelo encarregado: colaborador do escritório administrativo. Com setor ou escritório → "Pendente Diretoria" (mig 127).';
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".setor IS
  'Setor do colaborador (setor_catalogo). Obrigatório quando escritório. Define quem aprova na Diretoria (SISTEMA_APROVADOR_SETOR).';

-- A vaga de reposição continua obrigatória pra sair da etapa 1 — agora a
-- etapa 1 também pode ser a Diretoria.
CREATE OR REPLACE FUNCTION public.demissao_exige_vaga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.vaga_obrigatoria
     AND NEW.vaga_id IS NULL
     AND OLD.status IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria')
     AND NEW.status NOT IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria', 'Reprovada') THEN
    RAISE EXCEPTION 'Esta demissão ainda não tem a vaga de reposição. Quem solicitou precisa abrir a vaga de Substituição de % antes de o pedido seguir.', NEW.colaborador_nome;
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.ssd_guard_aprovador_setor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'Pendente Diretoria'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.aprova_setor(OLD.setor) THEN
    RAISE EXCEPTION 'Você não aprova demissões do setor "%". Peça ao administrador para marcar o setor em Acesso por Usuário.', coalesce(OLD.setor, '—')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_ssd_guard_aprovador_setor ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_ssd_guard_aprovador_setor
  BEFORE UPDATE ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.ssd_guard_aprovador_setor();

-- ── 3) VAGA ──────────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS setor text;
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".setor IS
  'Setor da vaga (setor_catalogo). Vaga administrativa ou com setor nasce em "Pendente Diretoria" e é aprovada por quem tem o setor em SISTEMA_APROVADOR_SETOR (mig 127).';

CREATE OR REPLACE FUNCTION public.rec_guard_aprovador_setor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'Pendente Diretoria'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.aprova_setor(OLD.setor) THEN
    RAISE EXCEPTION 'Você não aprova vagas do setor "%". Peça ao administrador para marcar o setor em Acesso por Usuário.', coalesce(OLD.setor, '—')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_rec_guard_aprovador_setor ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_guard_aprovador_setor
  BEFORE UPDATE ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_guard_aprovador_setor();

-- RLS: a Diretoria lê e decide (inclusive a administrativa).
DROP POLICY IF EXISTS sistema_recrutamento_select ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_select ON public."SISTEMA_RECRUTAMENTO"
  FOR SELECT TO authenticated
  USING (((has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao))
   AND ((NOT administrativa)
        OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao)
        -- Diretoria (16/09/2026): quem aprova a vaga administrativa precisa vê-la.
        OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao))));

DROP POLICY IF EXISTS sistema_recrutamento_update ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_update ON public."SISTEMA_RECRUTAMENTO"
  FOR UPDATE TO authenticated
  USING (((has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao))
   AND ((NOT administrativa)
        OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao)
        -- Diretoria (16/09/2026): quem aprova a vaga administrativa precisa vê-la.
        OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao))))
  WITH CHECK (((has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir'::app_acao)
    OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'incluir'::app_acao)
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'incluir'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'incluir'::app_acao)
    OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'aprovar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'recrutamento_solicitacao_editar', 'alterar'::app_acao))
   AND ((NOT administrativa)
        OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao))));

-- Guard da tabela: a Diretoria é "gestora" (pode mudar status). Corpo = o
-- que estava no banco em 16/09/2026 + as duas linhas do diretoria_recrutamento.
CREATE OR REPLACE FUNCTION public.sistema_recrutamento_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gestor  boolean;
  v_dias    integer;
  v_livre   jsonb;
  v_ult     jsonb;
  v_msg     text := 'A vaga precisa de no mínimo 7 dias úteis entre hoje e a data de início prevista.';
BEGIN
  IF btrim(coalesce(NEW.motivo_vaga, '')) = 'Expansão' THEN
    NEW.motivo_vaga := 'Expansão (Aumento de Quadro)';
  END IF;

  IF public.rec_cargo_exige_cnh(NEW.cargo) THEN
    NEW.cnh_obrigatoria := true;
    IF upper(translate(coalesce(NEW.req_obrigatorios, ''),
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       !~ '(CNH|CARTEIRA DE (MOTORISTA|HABILITA))' THEN
      NEW.req_obrigatorios := btrim(concat(
        'CNH obrigatória (categoria compatível com a função).',
        CASE WHEN btrim(coalesce(NEW.req_obrigatorios, '')) = '' THEN '' ELSE E'\n' || NEW.req_obrigatorios END));
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cnh_obrigatoria := COALESCE(NEW.cnh_obrigatoria, false);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NOT NULL THEN
      v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
      IF v_dias < 7 THEN
        RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
      END IF;
      NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);
    END IF;
    NEW.data_inicio_alteracoes := COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb);
    RETURN NEW;
  END IF;

  -- Quem decide sobre a vaga. São as MESMAS portas que a RLS reconhece
  -- (sistema_recrutamento_gate e sistema_recrutamento_operacional) — manter
  -- as duas listas iguais é o que impede a RLS liberar e o gatilho recusar,
  -- que foi exatamente o defeito corrigido quando esta função nasceu.
  --
  -- 02/09/2026: entrou `licitacoes_analistas_recrutamento` e SAIU
  -- `operacional_recrutamento`. A etapa 1 mudou de dono; o Operacional
  -- acompanha, e acompanhar não escreve.
  v_gestor := has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
           OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
           OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar')
           OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar')
           -- Diretoria (16/09/2026): aprova a vaga administrativa / com setor.
           OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'aprovar')
           OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'alterar');

  IF NOT v_gestor THEN
    v_livre := to_jsonb(OLD) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes';
    IF v_livre IS DISTINCT FROM (to_jsonb(NEW) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes') THEN
      RAISE EXCEPTION 'Depois de criada, você só pode alterar a Data de Início Prevista da vaga. Para mudar qualquer outra informação, fale com o Recrutamento.';
    END IF;
  END IF;

  IF NEW.data_inicio_prevista IS DISTINCT FROM OLD.data_inicio_prevista THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NULL THEN
      RAISE EXCEPTION 'Informe a nova data de início prevista.';
    END IF;
    v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
    IF v_dias < 7 THEN
      RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
    END IF;
    NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);

    IF jsonb_array_length(COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb))
       <> jsonb_array_length(COALESCE(OLD.data_inicio_alteracoes, '[]'::jsonb)) + 1 THEN
      RAISE EXCEPTION 'Toda troca de data precisa de uma justificativa.';
    END IF;
    v_ult := NEW.data_inicio_alteracoes -> (jsonb_array_length(NEW.data_inicio_alteracoes) - 1);
    IF length(btrim(coalesce(v_ult->>'justificativa', ''))) < 10 THEN
      RAISE EXCEPTION 'Escreva a justificativa da troca de data (mínimo 10 caracteres).';
    END IF;
    IF btrim(coalesce(v_ult->>'para', '')) <> btrim(coalesce(NEW.data_inicio_prevista, '')) THEN
      RAISE EXCEPTION 'O histórico da troca de data não bate com a data enviada.';
    END IF;
    NEW.data_inicio_alteracoes := jsonb_set(
      NEW.data_inicio_alteracoes,
      ARRAY[(jsonb_array_length(NEW.data_inicio_alteracoes) - 1)::text],
      v_ult || jsonb_build_object('por', auth.uid(), 'em', now()));
  ELSIF NEW.data_inicio_alteracoes IS DISTINCT FROM OLD.data_inicio_alteracoes AND NOT v_gestor THEN
    RAISE EXCEPTION 'O histórico de datas não pode ser alterado.';
  END IF;

  RETURN NEW;
END $function$;

-- ── 4) Menus da Diretoria ────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota,
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + x.n,
       true
  FROM public.app_modulo m
  CROSS JOIN (VALUES
    ('diretoria_solicitacoes_demissao', 'Diretoria — Solicitações de Demissão (aprovar)', '/app/diretoria/solicitacoes-demissao', 1),
    ('diretoria_recrutamento',          'Diretoria — Gestão Recrutamento (aprovar)',      '/app/diretoria/recrutamento',          2)
  ) AS x(codigo, nome, rota, n)
 WHERE m.id = (SELECT modulo_id FROM public.app_menu WHERE codigo = 'diretoria_troca_funcao' LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = x.codigo);

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('diretoria_recrutamento', 'aprovar'::app_acao),
       ('diretoria_solicitacoes_demissao', 'aprovar'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_rec_guard_aprovador_setor ON public."SISTEMA_RECRUTAMENTO";
--   DROP TRIGGER IF EXISTS trg_ssd_guard_aprovador_setor ON public."SISTEMA_SOLICITACOES_DEMISSAO";
--   DROP FUNCTION IF EXISTS public.rec_guard_aprovador_setor(), public.ssd_guard_aprovador_setor();
--   Recriar sistema_recrutamento_select/update e sistema_recrutamento_guard sem 'diretoria_recrutamento' (mig 043);
--   demissao_exige_vaga sem 'Pendente Diretoria' (mig 103);
--   ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN IF EXISTS setor;
--   ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" DROP COLUMN IF EXISTS e_escritorio, DROP COLUMN IF EXISTS setor;
--   DELETE FROM public.app_menu_acao WHERE menu_codigo IN ('diretoria_recrutamento','diretoria_solicitacoes_demissao');
--   DELETE FROM public.app_menu WHERE codigo IN ('diretoria_recrutamento','diretoria_solicitacoes_demissao');
--   ALTER TABLE public."SISTEMA_APROVADOR_SETOR" RENAME TO "SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR";
-- =========================================================================
