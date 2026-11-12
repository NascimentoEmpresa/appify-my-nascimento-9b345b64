-- =========================================================================
-- RH › GESTÃO DE FÉRIAS — Programar no Malote, situação no Malote e o
-- status final "ENVIADO PRA MENTORE" (chamado #0865, Alessandra, 11/11/2026)
--
-- PEDIDO
--   · mostrar a matrícula do colaborador;
--   · ao lado de "Anexar recibo da Senior e enviar ao Malote", um botão
--     "Programar no malote": as férias entram no malote SEM o documento e
--     ficam "PENDENTE DE ANEXO DE DOCUMENTO" — para finalizar o pagamento e
--     estar de fato no Malote, o recibo ainda é anexado e enviado;
--   · filtro do malote na Gestão de Férias (os já enviados etc.);
--   · depois de enviadas ao Malote e com a documentação ok, um check final
--     "ENVIADO PRA MENTORE" (pago) que conclui 100% as férias.
--
-- DESENHO
--   A situação no Malote é derivada das colunas (a tela e o filtro usam a
--   mesma regra, src/lib/rh/situacaoMaloteFerias.ts):
--     · Pendente de anexo de documento — programada, sem despesa ativa;
--     · No Malote — despesa ativa (o fluxo de sempre: recibo → valor →
--       despesa), aguardando o check final;
--     · Enviado pra Mentore — check final dado (estado final).
--   O `status` da solicitação (Pendente/Aprovada/...) NÃO muda: é dele que
--   dependem a aprovação, o cancelamento e as telas do encarregado.
--
--   Colunas novas, protegidas como as do fluxo do Malote (só mudam pelas
--   RPCs, que ligam app.ferias_fluxo_malote):
--     malote_programado_em/por, mentore_enviado_em/por.
--   RPCs (permissão: Gestão de Férias › Enviar ao Malote, a mesma do envio):
--     ferias_programar_malote(id, programar)  — programa ou desfaz;
--     ferias_enviado_mentore(id, enviado)     — check final ou desfaz; exige
--       despesa ativa no Malote.
--   ferias_matriculas(ids): matrícula (EMPREGADOS."Cadastro") por
--     solicitação — pelo id do colaborador, senão pelo CPF (a carga da
--     Senior recria o "ID").
--   Histórico: "Programada no Malote (pendente de anexo)", "Programação no
--   Malote desfeita", "Enviado pra Mentore", "Envio pra Mentore desfeito".
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS"
  ADD COLUMN IF NOT EXISTS malote_programado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS malote_programado_por text,
  ADD COLUMN IF NOT EXISTS mentore_enviado_em    timestamptz,
  ADD COLUMN IF NOT EXISTS mentore_enviado_por   text;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".malote_programado_em IS
  '#0865: programada no Malote sem o recibo — "Pendente de anexo de documento" até a despesa ser enviada (ferias_programar_malote).';
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".mentore_enviado_em IS
  '#0865: check final — pagamento enviado à Mentore; conclui as férias (ferias_enviado_mentore).';

-- ── 1) As colunas novas só mudam pelas RPCs ──────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_programacao_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- carga/manutenção
  IF coalesce(current_setting('app.ferias_fluxo_malote', true), '') = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.malote_programado_em := NULL; NEW.malote_programado_por := NULL;
    NEW.mentore_enviado_em := NULL;   NEW.mentore_enviado_por := NULL;
    RETURN NEW;
  END IF;
  IF NEW.malote_programado_em IS DISTINCT FROM OLD.malote_programado_em
     OR NEW.malote_programado_por IS DISTINCT FROM OLD.malote_programado_por
     OR NEW.mentore_enviado_em IS DISTINCT FROM OLD.mentore_enviado_em
     OR NEW.mentore_enviado_por IS DISTINCT FROM OLD.mentore_enviado_por THEN
    RAISE EXCEPTION 'A programação no Malote e o "Enviado pra Mentore" só mudam pelos botões da Gestão de Férias.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.ferias_programacao_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ferias_programacao_guard ON public."SISTEMA_SOLICITACOES_FERIAS";
CREATE TRIGGER trg_ferias_programacao_guard
  BEFORE INSERT OR UPDATE OF malote_programado_em, malote_programado_por, mentore_enviado_em, mentore_enviado_por
  ON public."SISTEMA_SOLICITACOES_FERIAS"
  FOR EACH ROW EXECUTE FUNCTION public.ferias_programacao_guard();

-- ── 2) Programar no Malote (sem documento) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_programar_malote(p_id bigint, p_programar boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f public."SISTEMA_SOLICITACOES_FERIAS"%ROWTYPE;
  v_nome text := public.ferias_nome_usuario();
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'enviar_malote'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para programar férias no Malote (Gestão de Férias › Enviar ao Malote).' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF public.ferias_malote_ativo(f.malote_despesa_id) THEN
    RAISE EXCEPTION 'Estas férias já estão no Malote.';
  END IF;
  IF p_programar THEN
    IF f.status <> 'Aprovada' THEN RAISE EXCEPTION 'Só férias aprovadas vão para o Malote.'; END IF;
    IF f.malote_programado_em IS NOT NULL THEN RAISE EXCEPTION 'Estas férias já estão programadas no Malote.'; END IF;
  ELSIF f.malote_programado_em IS NULL THEN
    RAISE EXCEPTION 'Estas férias não estão programadas no Malote.';
  END IF;

  PERFORM set_config('app.ferias_fluxo_malote', '1', true);
  UPDATE public."SISTEMA_SOLICITACOES_FERIAS" SET
    malote_programado_em  = CASE WHEN p_programar THEN now() END,
    malote_programado_por = CASE WHEN p_programar THEN v_nome END,
    atualizado_em = now()
   WHERE id = p_id;
  PERFORM set_config('app.ferias_fluxo_malote', '', true);

  INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
  VALUES (p_id, CASE WHEN p_programar THEN 'Programada no Malote (pendente de anexo)' ELSE 'Programação no Malote desfeita' END,
          f.status, f.status, v_nome, auth.uid(), NULL);
END $$;
REVOKE ALL ON FUNCTION public.ferias_programar_malote(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_programar_malote(bigint, boolean) TO authenticated;

-- ── 3) Check final: Enviado pra Mentore ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_enviado_mentore(p_id bigint, p_enviado boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f public."SISTEMA_SOLICITACOES_FERIAS"%ROWTYPE;
  v_nome text := public.ferias_nome_usuario();
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'enviar_malote'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão (Gestão de Férias › Enviar ao Malote).' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF p_enviado THEN
    IF f.mentore_enviado_em IS NOT NULL THEN RAISE EXCEPTION 'Estas férias já estão como Enviado pra Mentore.'; END IF;
    IF NOT public.ferias_malote_ativo(f.malote_despesa_id) THEN
      RAISE EXCEPTION 'Só depois de enviadas ao Malote (com o recibo) as férias podem ir pra Mentore.';
    END IF;
  ELSIF f.mentore_enviado_em IS NULL THEN
    RAISE EXCEPTION 'Estas férias não estão como Enviado pra Mentore.';
  END IF;

  PERFORM set_config('app.ferias_fluxo_malote', '1', true);
  UPDATE public."SISTEMA_SOLICITACOES_FERIAS" SET
    mentore_enviado_em  = CASE WHEN p_enviado THEN now() END,
    mentore_enviado_por = CASE WHEN p_enviado THEN v_nome END,
    atualizado_em = now()
   WHERE id = p_id;
  PERFORM set_config('app.ferias_fluxo_malote', '', true);

  INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
  VALUES (p_id, CASE WHEN p_enviado THEN 'Enviado pra Mentore' ELSE 'Envio pra Mentore desfeito' END,
          f.status, f.status, v_nome, auth.uid(), NULL);
END $$;
REVOKE ALL ON FUNCTION public.ferias_enviado_mentore(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_enviado_mentore(bigint, boolean) TO authenticated;

-- ── 4) Matrícula por solicitação ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_matriculas(p_ids bigint[])
RETURNS TABLE(solicitacao_id bigint, matricula text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso à Gestão de Férias' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT f.id,
         coalesce(
           (SELECT e."Cadastro"::text FROM public."EMPREGADOS" e WHERE e."ID" = f.colaborador_id LIMIT 1),
           (SELECT e."Cadastro"::text FROM public."EMPREGADOS" e
             WHERE nullif(regexp_replace(coalesce(f.colaborador_cpf, ''), '\D', '', 'g'), '') IS NOT NULL
               AND regexp_replace(coalesce(e."CPF"::text, ''), '\D', '', 'g') = regexp_replace(f.colaborador_cpf, '\D', '', 'g')
             ORDER BY public.esp_col_esta_ativo(e."Situação") DESC
             LIMIT 1))
    FROM public."SISTEMA_SOLICITACOES_FERIAS" f
   WHERE f.id = ANY (p_ids[1:5000]);
END $$;
REVOKE ALL ON FUNCTION public.ferias_matriculas(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_matriculas(bigint[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.ferias_matriculas(bigint[]);
--   DROP FUNCTION IF EXISTS public.ferias_enviado_mentore(bigint, boolean);
--   DROP FUNCTION IF EXISTS public.ferias_programar_malote(bigint, boolean);
--   DROP TRIGGER IF EXISTS trg_ferias_programacao_guard ON public."SISTEMA_SOLICITACOES_FERIAS";
--   DROP FUNCTION IF EXISTS public.ferias_programacao_guard();
--   ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS" DROP COLUMN IF EXISTS malote_programado_em,
--     DROP COLUMN IF EXISTS malote_programado_por, DROP COLUMN IF EXISTS mentore_enviado_em,
--     DROP COLUMN IF EXISTS mentore_enviado_por;
