-- =========================================================================
-- CHAMADOS: HORAS GASTAS INFORMADAS AO CONCLUIR
--
-- PEDIDO (29/10/2026, Pablo): "quando o desenvolvedor for CONCLUIR O CHAMADO
-- ele informe quantas horas levou pra finalizar."
--
-- 1. Colunas novas em CHAMADO_SISTEMA: horas_gastas (aceita meia hora, ex.
--    12,5), quem informou e quando. Horas só existem em chamado concluído:
--    reabriu, zera — a próxima conclusão pede de novo (o histórico guarda o
--    número anterior no evento "Chamado concluído em X h").
-- 2. O BANCO exige, não só a tela: passar para 'concluido' com login de gente
--    (auth.uid() não nulo) sem horas_gastas > 0 é recusado. Um caminho novo
--    que esqueça o campo não conclui.
--    Exceção: a conclusão AUTOMÁTICA pelo merge da PR (Edge
--    chamado-concluir-pr, service_role, sem usuário) não tem quem digite.
--    Ela conclui com as horas PENDENTES, e o dev informa depois pela tela
--    (chamado_informar_horas_gastas) — o card "Ações rápidas" pede.
-- 3. Evento no histórico quando as horas são gravadas: "Chamado concluído em
--    X h" (na conclusão) ou "Horas gastas informadas: X h" (depois do merge).
-- 4. Chamados concluídos ANTES desta migration ficam com horas NULL ("—"):
--    nada é inventado para eles.
--
-- Parecer da I.A (seção 4): SÓ nasce depois das horas. A Edge
-- chamado-parecer-ia manda as horas informadas como parte da ENTREGA REAL
-- (a "Equipe interna" usa exatamente essas horas), e o card mostra
-- "estimado X h × real Y h" com o valor real pelas taxas fixas de sênior
-- (mig 20261029001600).
-- =========================================================================

ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS horas_gastas     numeric(7,2),
  ADD COLUMN IF NOT EXISTS horas_gastas_por uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS horas_gastas_em  timestamptz;

ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS chamado_horas_gastas_validas;
ALTER TABLE public."CHAMADO_SISTEMA" ADD CONSTRAINT chamado_horas_gastas_validas
  CHECK (horas_gastas IS NULL OR (horas_gastas > 0 AND horas_gastas <= 5000));

COMMENT ON COLUMN public."CHAMADO_SISTEMA".horas_gastas IS
  'Horas que o desenvolvedor levou para concluir, informadas ao concluir (mig 20261029002400). NULL = concluído antes da regra, pela PR (pendente) ou não concluído.';

-- "12.50" → "12,5"; "12.00" → "12".
CREATE OR REPLACE FUNCTION public.chamado_horas_fmt(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT replace(rtrim(rtrim(round(p, 2)::text, '0'), '.'), '.', ',')
$$;

-- ── 1) Exigir e carimbar (BEFORE UPDATE) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_horas_gastas_exige()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fora de 'concluido' não há horas (reabrir zera).
  IF NEW.status IS DISTINCT FROM 'concluido' THEN
    NEW.horas_gastas := NULL;
    NEW.horas_gastas_por := NULL;
    NEW.horas_gastas_em := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'concluido' AND NEW.horas_gastas IS NULL AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Informe as horas gastas para concluir o chamado.'
      USING ERRCODE = '23514', HINT = 'Campo "Horas gastas", maior que zero (aceita meia hora, ex.: 12,5).';
  END IF;

  IF NEW.horas_gastas IS NOT NULL AND NEW.horas_gastas IS DISTINCT FROM OLD.horas_gastas THEN
    NEW.horas_gastas_por := auth.uid();
    NEW.horas_gastas_em := now();
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.chamado_horas_gastas_exige() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_horas_gastas_exige ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_horas_gastas_exige
  BEFORE UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status
        OR NEW.horas_gastas IS DISTINCT FROM OLD.horas_gastas)
  EXECUTE FUNCTION public.chamado_horas_gastas_exige();

-- ── 2) Evento no histórico (AFTER UPDATE) ────────────────────────────────
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
         ELSE 'Horas gastas informadas: ' || public.chamado_horas_fmt(NEW.horas_gastas) || ' h' END,
    jsonb_build_object('horas_gastas', NEW.horas_gastas)
  );
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chamado_horas_gastas_evento() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_horas_gastas_evento ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_horas_gastas_evento
  AFTER UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND NEW.horas_gastas IS NOT NULL
        AND NEW.horas_gastas IS DISTINCT FROM OLD.horas_gastas)
  EXECUTE FUNCTION public.chamado_horas_gastas_evento();

-- ── 3) Informar depois (concluído pelo merge da PR) ──────────────────────
-- Só o responsável ou a gestão de chamados, só em chamado concluído e só
-- enquanto estiver pendente: horas informadas não se trocam por aqui.
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

  SELECT id, status, responsavel_id, horas_gastas INTO v
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
  IF v.horas_gastas IS NOT NULL THEN
    RAISE EXCEPTION 'As horas deste chamado já foram informadas.' USING ERRCODE = '22023';
  END IF;

  UPDATE public."CHAMADO_SISTEMA" SET horas_gastas = round(p_horas, 2) WHERE id = p_chamado_id;
END $$;

REVOKE ALL ON FUNCTION public.chamado_informar_horas_gastas(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_informar_horas_gastas(uuid, numeric) TO authenticated;

-- ── 4) Parecer da I.A SÓ depois das horas ────────────────────────────────
-- PEDIDO (29/10/2026, Pablo): "a i.a só pode dar parecer quando o
-- desenvolvedor concluir e informar as horas de desenvolvimento."
--   * sai a geração na ABERTURA (trg_chamado_aberto_parecer_ia, mig
--     20261029000900) e a da conclusão sem horas (mig 20261029001200);
--   * o parecer é enfileirado quando as horas são gravadas — na conclusão
--     pela tela (mesmo UPDATE) ou depois, para o concluído pela PR;
--   * a Edge recusa gerar sem chamado concluído com horas;
--   * pareceres de chamados ainda NÃO concluídos somem (eram estimativa do
--     pedido). Os de chamados já concluídos ficam: foram feitos pela entrega
--     real (mig 20261029001200) e os valores são fixos (mig 20261029001600).
DROP TRIGGER IF EXISTS trg_chamado_aberto_parecer_ia ON public."CHAMADO_SISTEMA";
DROP TRIGGER IF EXISTS trg_chamado_concluido_parecer_ia ON public."CHAMADO_SISTEMA";

CREATE OR REPLACE FUNCTION public.chamado_horas_gastas_gera_parecer_ia()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.chamado_parecer_ia_enfileirar(NEW.id, true);
  EXCEPTION WHEN OTHERS THEN
    -- Concluir / gravar as horas nunca pode falhar por causa do parecer.
    RAISE WARNING 'chamado-parecer-ia não foi enfileirada para %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chamado_horas_gastas_gera_parecer_ia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_horas_gastas_parecer_ia ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_horas_gastas_parecer_ia
  AFTER UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND NEW.horas_gastas IS NOT NULL
        AND NEW.horas_gastas IS DISTINCT FROM OLD.horas_gastas)
  EXECUTE FUNCTION public.chamado_horas_gastas_gera_parecer_ia();

DELETE FROM public."CHAMADO_SISTEMA_PARECER_IA" p
 USING public."CHAMADO_SISTEMA" c
 WHERE c.id = p.chamado_id
   AND c.status IS DISTINCT FROM 'concluido';

-- ── 5) Complexidade pesa no preço ────────────────────────────────────────
-- PEDIDO (29/10/2026, Pablo): "a I.A não vai medir só pelo valor, mas pela
-- complexidade, porque tem coisa que o desenvolvedor faz que leva 1h mas é
-- de extrema importância e complexidade, e tem coisa que leva 1h mas é bem
-- tranquilo." Preço = horas × valor/hora × fator do nível. A tabela abaixo
-- REPETE FATOR_COMPLEXIDADE de supabase/functions/_shared/chamado-parecer-ia.ts
-- (o banco não lê o .ts). Recalcula os pareceres que ficaram (concluídos),
-- sem chamar a I.A: horas, valor/hora e nível continuam os gravados.
WITH fator(nivel, f) AS (
  VALUES (1, 1::numeric), (2, 1.2), (3, 1.5), (4, 2), (5, 2.5)
), novos AS (
  SELECT p.chamado_id,
         jsonb_agg(
           x.item || jsonb_build_object(
             'fator_complexidade', fa.f,
             'valor', round((x.item->>'horas')::numeric * (x.item->>'valor_hora')::numeric * fa.f, 2))
           ORDER BY x.ord) AS precos
    FROM public."CHAMADO_SISTEMA_PARECER_IA" p
    JOIN fator fa ON fa.nivel = p.complexidade_nivel
    CROSS JOIN LATERAL jsonb_array_elements(p.precos) WITH ORDINALITY AS x(item, ord)
   WHERE p.status = 'pronto'
     AND jsonb_typeof(p.precos) = 'array'
     AND (x.item->>'horas') ~ '^[0-9]+(\.[0-9]+)?$'
     AND (x.item->>'valor_hora') ~ '^[0-9]+(\.[0-9]+)?$'
   GROUP BY p.chamado_id
  HAVING count(*) = 3
)
UPDATE public."CHAMADO_SISTEMA_PARECER_IA" p
   SET precos = n.precos,
       valor_medio = (SELECT round(avg((e->>'valor')::numeric), 2) FROM jsonb_array_elements(n.precos) e),
       updated_at = now()
  FROM novos n
 WHERE n.chamado_id = p.chamado_id;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_chamado_horas_gastas_parecer_ia ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_horas_gastas_gera_parecer_ia();
--   (os gatilhos de abertura/conclusão do parecer voltam reaplicando as
--    migs 20261029000900 e 20261029001200; os pareceres apagados não voltam)
--   DROP FUNCTION IF EXISTS public.chamado_informar_horas_gastas(uuid, numeric);
--   DROP TRIGGER IF EXISTS trg_chamado_horas_gastas_evento ON public."CHAMADO_SISTEMA";
--   DROP TRIGGER IF EXISTS trg_chamado_horas_gastas_exige ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_horas_gastas_evento();
--   DROP FUNCTION IF EXISTS public.chamado_horas_gastas_exige();
--   DROP FUNCTION IF EXISTS public.chamado_horas_fmt(numeric);
--   ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS chamado_horas_gastas_validas;
--   ALTER TABLE public."CHAMADO_SISTEMA"
--     DROP COLUMN IF EXISTS horas_gastas_em, DROP COLUMN IF EXISTS horas_gastas_por,
--     DROP COLUMN IF EXISTS horas_gastas;
-- =========================================================================
