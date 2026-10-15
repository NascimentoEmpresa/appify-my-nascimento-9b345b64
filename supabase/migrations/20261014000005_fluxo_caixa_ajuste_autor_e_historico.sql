-- SIS-2026-0657 (complemento): quem editou um lançamento no Fluxo de Caixa passa a ficar registrado.
--
-- ACHADO: financeiro_fluxo_caixa_ajuste (SIS-2026-0489) já tem a coluna updated_by desde o início, mas o
-- código do Fluxo nunca a preenche — por isso a Controladoria não sabia quem alterou, por exemplo, o
-- valor da DM-2026-0253 (R$ 4.615,94 no Malote, R$ 4.605,94 no Fluxo). E o ajuste é sobrescrito a cada
-- edição: o valor anterior se perdia.
--
-- ESTA MIGRATION grava isso NO BANCO (gatilho), para que nenhuma tela possa esquecer:
--   1. created_by novo; created_by/updated_by preenchidos com auth.uid() em todo INSERT/UPDATE.
--   2. Tabela de histórico append-only (financeiro_fluxo_caixa_ajuste_log): cada criação, alteração e
--      reversão do ajuste, com quem fez, quando e o conteúdo antes/depois (valor, data, etc.).
--   3. Os ajustes que já existem entram no histórico como "anterior ao registro": o autor deles NÃO
--      é conhecido e não é inventado.
--
-- Leitura do histórico: quem vê o Fluxo de Caixa ou a Auditoria da Controladoria. Ninguém grava direto
-- no histórico (só o gatilho, que é SECURITY DEFINER).
--
-- Migrations não se auto-aplicam: rodar no SQL Editor, um bloco por vez (BLOCO 1 a 3). Leves.

-- BLOCO 1 ─ colunas e gatilho do autor
ALTER TABLE public.financeiro_fluxo_caixa_ajuste
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

CREATE OR REPLACE FUNCTION public.financeiro_fluxo_caixa_ajuste_autor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  END IF;
  -- Sem sessão (SQL Editor, job) mantém o que já estava; com sessão, é sempre quem está editando.
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS financeiro_fluxo_caixa_ajuste_autor_trg ON public.financeiro_fluxo_caixa_ajuste;
CREATE TRIGGER financeiro_fluxo_caixa_ajuste_autor_trg
  BEFORE INSERT OR UPDATE ON public.financeiro_fluxo_caixa_ajuste
  FOR EACH ROW EXECUTE FUNCTION public.financeiro_fluxo_caixa_ajuste_autor();

-- BLOCO 2 ─ histórico
CREATE TABLE IF NOT EXISTS public.financeiro_fluxo_caixa_ajuste_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ajuste_id uuid NOT NULL,
  origem text NOT NULL,
  despesa_id uuid NOT NULL,
  numero_parcela int,
  -- criado | alterado | revertido | anterior_ao_registro
  acao text NOT NULL CHECK (acao IN ('criado', 'alterado', 'revertido', 'anterior_ao_registro')),
  antes jsonb,
  depois jsonb,
  user_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fcaixa_ajuste_log_despesa ON public.financeiro_fluxo_caixa_ajuste_log (origem, despesa_id, created_at DESC);

ALTER TABLE public.financeiro_fluxo_caixa_ajuste_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financeiro_fluxo_caixa_ajuste_log_select ON public.financeiro_fluxo_caixa_ajuste_log;
CREATE POLICY financeiro_fluxo_caixa_ajuste_log_select ON public.financeiro_fluxo_caixa_ajuste_log
  FOR SELECT TO authenticated
  USING (
    (SELECT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar'))
    OR (SELECT public.can_access(auth.uid(), 'auditoria-controladoria', 'visualizar'))
  );
-- Sem policy de INSERT/UPDATE/DELETE: só o gatilho escreve.

CREATE OR REPLACE FUNCTION public.financeiro_fluxo_caixa_ajuste_registrar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.financeiro_fluxo_caixa_ajuste_log (ajuste_id, origem, despesa_id, numero_parcela, acao, antes, depois, user_id)
    VALUES (NEW.id, NEW.origem, NEW.despesa_id, NEW.numero_parcela, 'criado', NULL, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.financeiro_fluxo_caixa_ajuste_log (ajuste_id, origem, despesa_id, numero_parcela, acao, antes, depois, user_id)
    VALUES (NEW.id, NEW.origem, NEW.despesa_id, NEW.numero_parcela, 'alterado', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSE
    INSERT INTO public.financeiro_fluxo_caixa_ajuste_log (ajuste_id, origem, despesa_id, numero_parcela, acao, antes, depois, user_id)
    VALUES (OLD.id, OLD.origem, OLD.despesa_id, OLD.numero_parcela, 'revertido', to_jsonb(OLD), NULL, auth.uid());
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS financeiro_fluxo_caixa_ajuste_registrar_trg ON public.financeiro_fluxo_caixa_ajuste;
CREATE TRIGGER financeiro_fluxo_caixa_ajuste_registrar_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.financeiro_fluxo_caixa_ajuste
  FOR EACH ROW EXECUTE FUNCTION public.financeiro_fluxo_caixa_ajuste_registrar();

-- BLOCO 3 ─ ajustes que já existiam: entram no histórico sem autor (não é conhecido)
INSERT INTO public.financeiro_fluxo_caixa_ajuste_log (ajuste_id, origem, despesa_id, numero_parcela, acao, antes, depois, user_id, created_at)
SELECT a.id, a.origem, a.despesa_id, a.numero_parcela, 'anterior_ao_registro', NULL, to_jsonb(a), NULL, a.updated_at
  FROM public.financeiro_fluxo_caixa_ajuste a
 WHERE NOT EXISTS (SELECT 1 FROM public.financeiro_fluxo_caixa_ajuste_log l WHERE l.ajuste_id = a.id);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP TRIGGER IF EXISTS financeiro_fluxo_caixa_ajuste_registrar_trg ON public.financeiro_fluxo_caixa_ajuste;
--   DROP TRIGGER IF EXISTS financeiro_fluxo_caixa_ajuste_autor_trg ON public.financeiro_fluxo_caixa_ajuste;
--   DROP FUNCTION IF EXISTS public.financeiro_fluxo_caixa_ajuste_registrar();
--   DROP FUNCTION IF EXISTS public.financeiro_fluxo_caixa_ajuste_autor();
--   DROP TABLE IF EXISTS public.financeiro_fluxo_caixa_ajuste_log;
--   ALTER TABLE public.financeiro_fluxo_caixa_ajuste DROP COLUMN IF EXISTS created_by;
--   NOTIFY pgrst, 'reload schema';
