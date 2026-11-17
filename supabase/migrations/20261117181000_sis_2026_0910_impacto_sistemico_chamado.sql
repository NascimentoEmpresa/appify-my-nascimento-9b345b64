-- =====================================================================
-- SIS-2026-0910 — Formulário moderno de impacto sistêmico em chamados
-- (17/11/2026, solicitante YURI ROSA, Controladoria)
--
-- POR QUE
-- O campo único "Módulo / Sistema" da abertura não dizia se era o módulo
-- onde a mudança é feita, o módulo alterado ou todos os afetados. Virou três
-- campos (ver src/lib/chamados/impactoSistemico.ts):
--   · Posição do novo módulo ou módulo diretamente ajustado → modulo_sistema
--     (a coluna de sempre; só o significado ficou explícito);
--   · Módulos do sistema impactados → modulos_impactados (mig 20261115001000);
--   · Setores impactados → setores_impactados (mig 20261115001000).
-- Os dois últimos ficaram obrigatórios NA TELA. No banco não há NOT NULL /
-- CHECK de "1 ou mais" de propósito: chamado antigo não tem esses dados, e
-- uma aba aberta com o formulário anterior (campos opcionais) deixaria de
-- conseguir abrir chamado até recarregar.
--
-- O QUE MUDA AQUI
--   1. Trigger BEFORE INSERT/UPDATE que normaliza as listas (sem espaços nas
--      pontas, sem vazios, sem repetidos, na ordem escolhida) e garante a
--      posição entre os módulos impactados — no exemplo do pedido, ajuste
--      em Fluxo de Caixa também impacta Fluxo de Caixa. Vale para o
--      coordenador que reclassifica o módulo depois (UPDATE OF modulo_sistema).
--      "outro" (texto livre) não é módulo do catálogo e não entra na lista.
--   2. COMMENT das colunas com o significado novo.
-- Nada de dado antigo é reescrito: chamado aberto antes fica "sem impacto
-- informado" no Monitoramento em vez de ganhar abrangência 1 inventada.
--
-- Módulos são texto (hoje o value de MODULOS_ERP). O SIS-2026-0921 vai
-- gravar códigos de app_menu na mesma coluna — o trigger não supõe catálogo.
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- ── 1. Normalização + posição entre os impactados ────────────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_normalizar_impacto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_posicao text := NULLIF(btrim(NEW.modulo_sistema), '');
BEGIN
  -- Trim, sem vazios e sem repetidos, mantendo a ordem da primeira ocorrência.
  NEW.setores_impactados := COALESCE((
    SELECT array_agg(x.v ORDER BY x.primeira)
      FROM (SELECT btrim(s) AS v, min(o) AS primeira
              FROM unnest(NEW.setores_impactados) WITH ORDINALITY AS u(s, o)
             WHERE NULLIF(btrim(s), '') IS NOT NULL
             GROUP BY btrim(s)) x
  ), '{}'::text[]);

  NEW.modulos_impactados := COALESCE((
    SELECT array_agg(x.v ORDER BY x.primeira)
      FROM (SELECT btrim(m) AS v, min(o) AS primeira
              FROM unnest(NEW.modulos_impactados) WITH ORDINALITY AS u(m, o)
             WHERE NULLIF(btrim(m), '') IS NOT NULL
             GROUP BY btrim(m)) x
  ), '{}'::text[]);

  -- A posição (módulo diretamente ajustado) é sempre impactada. Só quando o
  -- chamado TEM impacto informado: chamado antigo sem lista segue sem lista.
  IF v_posicao IS NOT NULL AND v_posicao <> 'outro'
     AND cardinality(NEW.modulos_impactados) > 0
     AND NOT (v_posicao = ANY (NEW.modulos_impactados)) THEN
    NEW.modulos_impactados := array_prepend(v_posicao, NEW.modulos_impactados);
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_normalizar_impacto ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_normalizar_impacto
  BEFORE INSERT OR UPDATE OF modulo_sistema, modulos_impactados, setores_impactados
  ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_normalizar_impacto();

-- ── 2. Significado das colunas ───────────────────────────────────────
COMMENT ON COLUMN public."CHAMADO_SISTEMA".modulo_sistema IS
  'Posição do novo módulo ou módulo DIRETAMENTE AJUSTADO (onde a alteração é feita). value de MODULOS_ERP; "outro" usa modulo_sistema_outro. SIS-2026-0910.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".modulos_impactados IS
  'Módulos do sistema IMPACTADOS (desenvolvimento, integração, teste, homologação); inclui sempre o modulo_sistema. Obrigatório na abertura desde o SIS-2026-0910.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".setores_impactados IS
  'Setores da empresa cujos processos/informações mudam (texto do catálogo de setores). Obrigatório na abertura desde o SIS-2026-0910.';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_chamado_sistema_normalizar_impacto ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_sistema_normalizar_impacto();
--   -- COMMENTs: voltar aos da mig 20261115001000 (modulo_sistema não tinha).
-- =====================================================================
