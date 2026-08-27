-- SIS-2026-0250 (pedido do Iury): "quando uma despesa não se enquadra no
-- item 1.1 das Configurações do Malote ela deve ser obrigatoriamente uma
-- exceção, hoje ela não está sendo e está passando livre." Conversando
-- com o usuário, a regra completa (confirmada com exemplo 27/08, 1.1=13h,
-- 2.1=15h) envolve 4 configurações diferentes:
--
--  1.1 (inclusao_setor_horario + modo/dias/unidade): define a "data
--      normal de pagamento" — hoje conta como base do cálculo só se
--      lançado ANTES desse horário; depois, desloca +1 dia útil. Pedir
--      data mais cedo que essa data normal sem marcar exceção passa a
--      ser bloqueado aqui (antes não existia checagem nenhuma).
--  1.2 (conferencia_aprovacao_horario): prazo da aprovação N1 — fica só
--      no client (DespesaVisualizar.tsx), não mexe em RLS/RPC.
--  2.1 (excecao_limite_inclusao_horario): corte final de inclusão de
--      exceção pedindo pagamento HOJE — Iury decidiu deixar em 23:59 por
--      enquanto, então isso não bloqueia ninguém na prática agora, mas a
--      regra já fica implementada de forma genérica.
--  2.2 (excecao_limite_aprovacao_horario): só vira aviso informativo no
--      client, não é gate de banco.
--
-- E também MUDA quem aprova uma exceção: nunca o Aprovador Nível 1 — pula
-- direto pro Aprovador Nível 2 já configurado na Classificação, e a Carol
-- (cargo GERENTE FINANCEIRO) sempre pode aprovar/reprovar qualquer
-- exceção como reforço, mesmo sem estar configurada como aprovadora 2
-- daquela Classificação específica.

-- ── a) Prazo normal de inclusão (regra 1.1), exposta como RPC pro client
--       não duplicar o cálculo de dia útil em TS ──────────────────────────
CREATE OR REPLACE FUNCTION public.malote_prazo_normal_inclusao(_agora timestamptz DEFAULT now())
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_horario time;
  v_modo text;
  v_dias integer;
  v_unidade text;
  v_local timestamp;
  v_base date;
  v_resultado date;
  v_contados integer := 0;
BEGIN
  SELECT inclusao_setor_horario, inclusao_setor_pagamento_modo,
         inclusao_setor_pagamento_dias, inclusao_setor_pagamento_unidade
    INTO v_horario, v_modo, v_dias, v_unidade
  FROM public.malote_config WHERE id = true;

  v_local := _agora AT TIME ZONE 'America/Sao_Paulo';
  v_base := v_local::date;
  -- Já passou do horário 1.1: hoje deixa de contar como base do prazo.
  IF v_local::time > v_horario THEN
    v_base := v_base + 1;
  END IF;

  IF v_modo = 'hoje' THEN
    RETURN v_base;
  END IF;

  IF v_unidade = 'corrido' THEN
    RETURN v_base + v_dias;
  END IF;

  v_resultado := v_base;
  WHILE v_contados < v_dias LOOP
    v_resultado := v_resultado + 1;
    IF NOT public.malote_dia_esta_bloqueado(v_resultado) THEN
      v_contados := v_contados + 1;
    END IF;
  END LOOP;
  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_prazo_normal_inclusao(timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_prazo_normal_inclusao(timestamptz) TO authenticated;

-- ── b) Estende o trigger já existente de data_pagamento (regras 1.1 e 2.1) ──
CREATE OR REPLACE FUNCTION public.malote_bloqueia_dia_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_impedir boolean;
  v_prazo_normal date;
  v_limite_excecao time;
  v_agora_local timestamp;
BEGIN
  IF NEW.data_pagamento IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.data_pagamento IS NOT DISTINCT FROM NEW.data_pagamento THEN RETURN NEW; END IF;

  -- data_pagamento tem dois sentidos na mesma coluna: data PLANEJADA de
  -- vencimento (lançamento/aprovação) e data REAL de pagamento confirmado
  -- (malote_pagar_despesa, status despesa_paga) — fica de fora das duas
  -- checagens abaixo.
  IF NEW.status = 'despesa_paga' THEN RETURN NEW; END IF;

  v_agora_local := now() AT TIME ZONE 'America/Sao_Paulo';

  IF NEW.excecao THEN
    -- Regra 2.1: mesmo como exceção, pedir pagamento pra HOJE depois do
    -- horário-limite de inclusão de exceções bloqueia — não libera nem
    -- como exceção. Valor operacional (23:59) faz isso não disparar hoje.
    IF NEW.data_pagamento = v_agora_local::date THEN
      SELECT excecao_limite_inclusao_horario INTO v_limite_excecao FROM public.malote_config WHERE id = true;
      IF v_agora_local::time > v_limite_excecao THEN
        RAISE EXCEPTION 'Já passou do horário limite (%) para incluir exceção com pagamento hoje.', v_limite_excecao;
      END IF;
    END IF;
    -- Exceção continua passando por cima do bloqueio de dia bloqueado,
    -- só pra ela (comportamento já existente desde 20260915000001).
    RETURN NEW;
  END IF;

  -- Regra 1.1: pedir uma data mais cedo que o prazo normal calculado sem
  -- marcar exceção não é permitido.
  v_prazo_normal := public.malote_prazo_normal_inclusao();
  IF NEW.data_pagamento < v_prazo_normal THEN
    RAISE EXCEPTION 'Data de pagamento % está fora do prazo normal de inclusão (regra 1.1 das Configurações do Malote; hoje o prazo normal é %) — marque como Exceção.', NEW.data_pagamento, v_prazo_normal;
  END IF;

  SELECT bloqueio_impedir_lancamento INTO v_impedir FROM public.malote_config WHERE id = true;

  IF v_impedir AND public.malote_dia_esta_bloqueado(NEW.data_pagamento) THEN
    RAISE EXCEPTION 'Data de pagamento % está bloqueada no Malote (dia bloqueado, feriado ou fim de semana).', NEW.data_pagamento;
  END IF;

  RETURN NEW;
END;
$$;

-- ── c) Cargo "Gerente Financeiro" — poder estreito (só aprovar/reprovar/
--       enxergar exceção), separado de propósito de malote_supervisor_
--       por_cargo (essa já é ampla, usada em vários lugares) ────────────
CREATE OR REPLACE FUNCTION public.malote_gerente_financeiro(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id AND p.cargo ILIKE '%GERENTE FINANCEIRO%'
  );
$$;

REVOKE ALL ON FUNCTION public.malote_gerente_financeiro(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_gerente_financeiro(uuid) TO authenticated;

-- ── d) Exceção pula direto pro Aprovador Nível 2 (nunca N1) ─────────────
CREATE OR REPLACE FUNCTION public.malote_forcar_nivel_para_excecao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pendente_aprovacao' AND NEW.excecao AND COALESCE(NEW.nivel_aprovacao_atual, 1) = 1 THEN
    NEW.nivel_aprovacao_atual := 2;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS malote_despesa_forcar_nivel_excecao ON public.malote_despesa;
CREATE TRIGGER malote_despesa_forcar_nivel_excecao
  BEFORE INSERT OR UPDATE ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.malote_forcar_nivel_para_excecao();

-- ── e) RPCs de aprovação/ajuste/reprovação: Gerente Financeiro aprova/
--       reprova qualquer exceção como reforço, além do Aprovador Nível 2
--       configurado na Classificação ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.malote_aprovar_despesa(
  _id uuid,
  _proximo_nivel_configurado boolean,
  _valor_aprovado numeric,
  _justificativa text,
  _forma_pagamento text,
  _informacoes_pagamento text,
  _data_pagamento date,
  _competencia date,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
  v_excecao boolean;
  v_linha jsonb;
BEGIN
  SELECT status, nivel_aprovacao_atual, excecao INTO v_status, v_nivel, v_excecao FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_e_aprovador_do_nivel(_id, v_nivel, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR (v_excecao AND public.malote_gerente_financeiro(auth.uid()))
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET
    valor_aprovado = _valor_aprovado,
    justificativa_aprovacao = _justificativa,
    forma_pagamento = _forma_pagamento,
    informacoes_pagamento = _informacoes_pagamento,
    data_pagamento = _data_pagamento,
    competencia = _competencia,
    nivel_aprovacao_atual = CASE WHEN v_nivel < 3 AND _proximo_nivel_configurado THEN v_nivel + 1 ELSE nivel_aprovacao_atual END,
    status = CASE WHEN v_nivel < 3 AND _proximo_nivel_configurado THEN status ELSE 'aguardando_pagamento' END
  WHERE id = _id;

  IF NOT (v_nivel < 3 AND _proximo_nivel_configurado) THEN
    FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
    LOOP
      UPDATE public.malote_despesa_rateio_linha
      SET orcado_snapshot = (v_linha->>'orcado')::numeric,
          utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
          congelado_em = now()
      WHERE id = (v_linha->>'linha_id')::uuid
        AND despesa_id = _id;
    END LOOP;
  END IF;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'aprovacao_nivel', _justificativa, v_nivel, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_solicitar_ajuste_despesa(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
  v_excecao boolean;
BEGIN
  SELECT status, nivel_aprovacao_atual, excecao INTO v_status, v_nivel, v_excecao FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_e_aprovador_do_nivel(_id, v_nivel, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR (v_excecao AND public.malote_gerente_financeiro(auth.uid()))
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para solicitar ajuste nesta despesa.';
  END IF;

  UPDATE public.malote_despesa SET status = 'necessidade_de_ajuste', motivo_ajuste = _motivo WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'necessidade_de_ajuste', _motivo, v_nivel, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_reprovar_despesa(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_excecao boolean;
BEGIN
  SELECT status, excecao INTO v_status, v_excecao FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status NOT IN ('pendente_aprovacao', 'aguardando_pagamento', 'pronto_para_pagar', 'ajuste_pagamento') THEN
    RAISE EXCEPTION 'Despesa não pode ser reprovada neste status.';
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    (public.malote_pode('aprovar') AND public.malote_sou_aprovador_configurado(_id, auth.uid()))
    OR public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR (v_excecao AND public.malote_gerente_financeiro(auth.uid()))
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para reprovar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET status = 'despesa_reprovada' WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'despesa_reprovada', _motivo, auth.uid());
END;
$$;

-- ── f) SELECT de malote_despesa: carve-out estreito pra Gerente
--       Financeiro enxergar só exceções pendentes de aprovação — não é o
--       mesmo bypass amplo que malote_supervisor_por_cargo dava (e que
--       foi tirado do SELECT em 20260925000001 depois do achado real com
--       o Yuri Rosa vendo despesas de todos os setores) ────────────────
DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
CREATE POLICY malote_despesa_select ON public.malote_despesa FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (
      empresa_id = get_user_empresa(auth.uid())
      AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id)
    )
    OR can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
    OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
    OR (excecao AND status = 'pendente_aprovacao' AND malote_gerente_financeiro(auth.uid()))
  );

-- ── g) Backfill: exceções já pendentes hoje no Nível 1 pulam pro Nível 2
--       (a trigger nova de agora em diante já cobre pra sempre) ─────────
UPDATE public.malote_despesa
SET nivel_aprovacao_atual = 2
WHERE status = 'pendente_aprovacao' AND excecao AND nivel_aprovacao_atual = 1;

-- ── h) 2.1 em produção estava em 15:00 (default da tabela) — decisão do
--       Iury foi deixar em 23:59 por enquanto, pra regra nova acima (item
--       b) não bloquear ninguém hoje sem o caminho de "último caso" via
--       N2 ter sido construído ainda. Só o valor, a regra genérica já fica
--       pronta pra quando decidirem apertar de verdade.
UPDATE public.malote_config SET excecao_limite_inclusao_horario = '23:59' WHERE id = true;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   -- (e) volta pro CREATE OR REPLACE anterior das 3 RPCs, igual estavam
--   -- em 20260930000004_classificacao_multiplos_aprovadores.sql (aprovar
--   -- e ajuste) e 20260907000001_malote_pagamento.sql (reprovar) — tirar
--   -- só a cláusula "OR (v_excecao AND malote_gerente_financeiro(...))"
--   -- e a variável v_excecao de cada uma.
--
--   DROP TRIGGER IF EXISTS malote_despesa_forcar_nivel_excecao ON public.malote_despesa;
--   DROP FUNCTION IF EXISTS public.malote_forcar_nivel_para_excecao();
--   DROP FUNCTION IF EXISTS public.malote_gerente_financeiro(uuid);
--
--   -- (b) volta pro CREATE OR REPLACE de 20260915000001_malote_excecao_dia_bloqueado.sql
--   -- (tira as checagens de regra 1.1 e 2.1, mantém só dia bloqueado).
--
--   DROP FUNCTION IF EXISTS public.malote_prazo_normal_inclusao(timestamptz);
--
--   -- (f) reverter malote_despesa_select pro CREATE POLICY de
--   -- 20260925000001_malote_setor_prevalece_sobre_cargo.sql (tira a
--   -- cláusula "OR (excecao AND ...)").
--
--   -- (h) UPDATE public.malote_config SET excecao_limite_inclusao_horario = '15:00' WHERE id = true;
