-- =========================================================================
-- CHAMADOS: EDITAR AS HORAS GASTAS (e o parecer da I.A acompanha)
--
-- PEDIDO (10/11/2026, Pablo): "deixa o joão inserir quantas horas gastou pra
-- esse desenvolvimento de novo. e deixa opção de nós desenvolvedores
-- editarmos as horas gastas desenvolvidas, assim atualizando também os
-- valores." (SIS-2026-0681: 8 h informadas, o João quer corrigir.)
--
-- Até aqui chamado_informar_horas_gastas (mig 20261029002400) só gravava
-- enquanto estava PENDENTE ("horas informadas não se trocam por aqui").
-- Agora troca também, com o MESMO portão: o responsável pelo chamado ou a
-- gestão de chamados (chamado_sistema_gestor()), só em chamado concluído.
--
-- Os valores atualizam sozinhos, sem mexer em mais nada:
--   * trg_chamado_horas_gastas_exige grava horas_gastas_em = now() (e tira
--     o horas_gastas_estimadas) quando as horas mudam;
--   * trg_chamado_horas_gastas_parecer_ia enfileira o parecer com `forcar`;
--   * a Edge chamado-parecer-ia, com `forcar`, REFAZ o parecer pronto que
--     foi gerado antes de horas_gastas_em — que é exatamente o caso agora.
--   Os "valores fixos" (29/10) continuam valendo para o botão "Gerar de
--   novo": o número só muda quando as HORAS mudam, não a cada clique.
--
-- Histórico: a troca vira "Horas gastas alteradas: 8 h → 12,5 h" (antes
-- dizia "informadas" mesmo quando já havia número).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.chamado_informar_horas_gastas(p_chamado_id uuid, p_horas numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  IF p_horas IS NULL OR p_horas <= 0 OR p_horas > 5000 THEN
    RAISE EXCEPTION 'Informe as horas gastas (maior que zero).' USING ERRCODE = '23514';
  END IF;

  SELECT id, status, responsavel_id, horas_gastas, horas_gastas_estimadas INTO v
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v.responsavel_id = auth.uid() OR public.chamado_sistema_gestor()) THEN
    RAISE EXCEPTION 'Só o responsável ou a gestão de chamados informa as horas.' USING ERRCODE = '42501';
  END IF;
  IF v.status IS DISTINCT FROM 'concluido' THEN
    RAISE EXCEPTION 'O chamado não está concluído.' USING ERRCODE = '22023';
  END IF;
  -- Mesmo número (e já informado por gente): nada muda, nem o parecer.
  IF v.horas_gastas = round(p_horas, 2) AND NOT v.horas_gastas_estimadas THEN
    RETURN;
  END IF;

  UPDATE public."CHAMADO_SISTEMA" SET horas_gastas = round(p_horas, 2) WHERE id = p_chamado_id;
END $$;

REVOKE ALL ON FUNCTION public.chamado_informar_horas_gastas(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_informar_horas_gastas(uuid, numeric) TO authenticated;

-- Histórico: diferencia informar (antes não havia número) de alterar.
CREATE OR REPLACE FUNCTION public.chamado_horas_gastas_evento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- autor_id é NOT NULL: sem usuário (automação) não há o que registrar.
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (
    NEW.id, auth.uid(), 'evento',
    CASE WHEN OLD.status IS DISTINCT FROM 'concluido'
           THEN 'Chamado concluído em ' || public.chamado_horas_fmt(NEW.horas_gastas) || ' h'
         WHEN OLD.horas_gastas IS NOT NULL
           THEN 'Horas gastas alteradas: ' || public.chamado_horas_fmt(OLD.horas_gastas) || ' h → '
                || public.chamado_horas_fmt(NEW.horas_gastas) || ' h'
         ELSE 'Horas gastas informadas: ' || public.chamado_horas_fmt(NEW.horas_gastas) || ' h' END,
    jsonb_build_object('horas_gastas', NEW.horas_gastas, 'horas_gastas_antes', OLD.horas_gastas)
  );
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chamado_horas_gastas_evento() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- -------------------------------------------------------------------------
-- ROLLBACK (volta a só gravar horas pendentes):
--   recriar public.chamado_informar_horas_gastas e
--   public.chamado_horas_gastas_evento com o corpo da mig 20261029002400
--   (o IF v.horas_gastas IS NOT NULL THEN RAISE 'já foram informadas').
--   NOTIFY pgrst, 'reload schema';
-- -------------------------------------------------------------------------
