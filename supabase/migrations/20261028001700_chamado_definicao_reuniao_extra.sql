-- =========================================================================
-- Chamados de Sistemas: DEFINIÇÃO da prioridade — Reunião ou Extra (28/10/2026)
--
-- Pedido do Pablo: "No painel de distribuição, preciso de uma coluna nova
-- chamada definição onde ao distribuir era definido se foi em reuniao ou
-- extra que foi definido essa prioridade."
--
--   · definicao: 'reuniao' (prioridade combinada na reunião de priorização) ou
--     'extra' (entrou fora da reunião). A coordenação escolhe em Coordenar
--     chamado, junto com a prioridade, e é obrigatória para direcionar (a tela
--     cobra). O Painel de Distribuição mostra a coluna "Definição".
--   · Só quem coordena muda (mesma régua dos campos de coordenação no
--     chamado_sistema_guard). Chamados antigos ficam sem definição ("—").
--   · definicao_em / definicao_por: quando e quem definiu — para o histórico.
-- =========================================================================

ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS definicao     text CHECK (definicao IS NULL OR definicao IN ('reuniao', 'extra')),
  ADD COLUMN IF NOT EXISTS definicao_em  timestamptz,
  ADD COLUMN IF NOT EXISTS definicao_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public."CHAMADO_SISTEMA".definicao IS
  'Onde a prioridade foi definida: reuniao ou extra (mig 20261028001700). Definida pela coordenação ao direcionar.';

CREATE OR REPLACE FUNCTION public.chamado_sistema_definicao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Quem abre não define: é decisão da coordenação.
    IF NOT COALESCE(auth.role() = 'service_role', false) THEN
      NEW.definicao := NULL;
    END IF;
    NEW.definicao_em := CASE WHEN NEW.definicao IS NULL THEN NULL ELSE now() END;
    NEW.definicao_por := CASE WHEN NEW.definicao IS NULL THEN NULL ELSE auth.uid() END;
    RETURN NEW;
  END IF;

  IF NEW.definicao IS DISTINCT FROM OLD.definicao THEN
    IF NOT (COALESCE(auth.role() = 'service_role', false)
            OR public.tem_acesso_menu('chamados_sistemas_coordenar')) THEN
      RAISE EXCEPTION 'A definição (Reunião / Extra) só pode ser alterada pela coordenação.';
    END IF;
    NEW.definicao_em := CASE WHEN NEW.definicao IS NULL THEN NULL ELSE now() END;
    NEW.definicao_por := CASE WHEN NEW.definicao IS NULL THEN NULL ELSE auth.uid() END;
  ELSE
    -- Quando/quem acompanham a definição; não se mexem sozinhos (a FK ON
    -- DELETE SET NULL da exclusão de usuário pode limpar o _por).
    NEW.definicao_em := OLD.definicao_em;
    IF NEW.definicao_por IS NOT NULL THEN NEW.definicao_por := OLD.definicao_por; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_definicao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_sistema_definicao ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_definicao
  BEFORE INSERT OR UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_definicao();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_chamado_sistema_definicao ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_sistema_definicao();
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS definicao_por,
--   DROP COLUMN IF EXISTS definicao_em, DROP COLUMN IF EXISTS definicao;
-- NOTIFY pgrst, 'reload schema';
