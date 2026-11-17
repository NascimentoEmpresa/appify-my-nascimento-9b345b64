-- =========================================================================
-- SIS-2026-0934 — "QUAIS PESSOAS DEVEM TER ACESSO AO MÓDULO?" NA ABERTURA
-- DO CHAMADO (17/11/2026)
--
-- PEDIDO: no formulário de abertura (Chamados de Sistemas › Abrir Novo
-- Chamado), um campo com as pessoas que vão usar o módulo. Obrigatório quando
-- o chamado é de MÓDULO NOVO ou de ACESSO a um módulo existente; opcional nos
-- outros. O desenvolvedor vê a lista no chamado (Executar / Acompanhar).
--
-- COMO O CHAMADO DIZ "MÓDULO NOVO" / "ACESSO": pelas CATEGORIAS (text[], de
-- várias escolhas). "acesso_permissao" (Acesso / Permissão) já existia;
-- "novo_modulo" (Novo módulo / tela) entra agora, só no front (a coluna não
-- tem CHECK de valores). A mesma lista está em
-- src/lib/chamados/acessoModulo.ts (CATEGORIAS_EXIGEM_ACESSO) — mudar lá
-- exige mudar aqui.
--
-- FORMATO: jsonb [{id, nome}], id = profiles.id. O gatilho:
--   · descarta o que não é login de verdade (id fora de profiles) e repetidos;
--   · reescreve o nome a partir de profiles.display_name — o que o front
--     mandou não vale como nome;
--   · na abertura (INSERT), exige 1+ pessoa quando a categoria pede.
-- Chamado antigo não é tocado: a obrigação vale só para o que nasce agora
-- (UPDATE só normaliza a lista, se alguém a trocar).
-- SECURITY DEFINER porque quem abre o chamado não necessariamente lê o
-- profile dos outros pela RLS.
-- =========================================================================

-- 1) Coluna ---------------------------------------------------------------
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS acesso_modulo_usuarios jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS chamado_sistema_acesso_modulo_usuarios_array_check;
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD CONSTRAINT chamado_sistema_acesso_modulo_usuarios_array_check
  CHECK (jsonb_typeof(acesso_modulo_usuarios) = 'array');

COMMENT ON COLUMN public."CHAMADO_SISTEMA".acesso_modulo_usuarios IS
  'SIS-2026-0934: pessoas que devem ter acesso ao módulo, [{id, nome}] (id = profiles.id). Obrigatório na abertura com categoria novo_modulo ou acesso_permissao.';

-- 2) Gatilho: normaliza e exige -------------------------------------------
CREATE OR REPLACE FUNCTION public.chamado_acesso_modulo_validar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lista jsonb;
BEGIN
  -- Só objetos com id em formato uuid; o resto é ignorado (não derruba o insert).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'nome', COALESCE(NULLIF(trim(p.display_name), ''), 'Sem nome')) ORDER BY x.ord), '[]'::jsonb)
    INTO v_lista
    FROM (
      SELECT DISTINCT ON ((e.item->>'id')::uuid) (e.item->>'id')::uuid AS id, e.ord
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(NEW.acesso_modulo_usuarios) = 'array' THEN NEW.acesso_modulo_usuarios ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS e(item, ord)
       WHERE jsonb_typeof(e.item) = 'object'
         AND (e.item->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ORDER BY (e.item->>'id')::uuid, e.ord
    ) x
    JOIN public.profiles p ON p.id = x.id;

  NEW.acesso_modulo_usuarios := v_lista;

  IF TG_OP = 'INSERT'
     AND COALESCE(NEW.categorias, '{}'::text[]) && ARRAY['novo_modulo', 'acesso_permissao']::text[]
     AND jsonb_array_length(v_lista) = 0 THEN
    RAISE EXCEPTION 'Informe quais pessoas devem ter acesso ao módulo (obrigatório para "Novo módulo / tela" e "Acesso / Permissão").'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.chamado_acesso_modulo_validar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_acesso_modulo_validar() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_acesso_modulo_validar ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_acesso_modulo_validar
  BEFORE INSERT OR UPDATE OF acesso_modulo_usuarios ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_acesso_modulo_validar();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_chamado_acesso_modulo_validar ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_acesso_modulo_validar();
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS chamado_sistema_acesso_modulo_usuarios_array_check;
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS acesso_modulo_usuarios;
-- NOTIFY pgrst, 'reload schema';
