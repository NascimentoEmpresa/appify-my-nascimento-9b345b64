-- =========================================================================
-- Formulários › pergunta "Contrato" — a lista não aparecia para quem
-- responde SEM LOGIN.
--
-- A tela lia `contratos` direto, e a política de SELECT daquela tabela é
-- concedida só a `authenticated`:
--
--   contratos_select | roles {authenticated} | USING (true)
--
-- Não existe política para `anon`. Então o formulário público não recebia
-- erro nenhum — recebia ZERO LINHA, que a tela mostrava como "Nenhum
-- contrato disponível para o seu acesso.". A mensagem ainda por cima sugeria
-- falta de permissão do respondente, quando o respondente nem tem conta.
--
-- Conserto no mesmo desenho das outras perguntas do formulário público
-- (`cs_form_setores`, `cs_form_colegas`): uma RPC SECURITY DEFINER que
-- devolve só o que a pergunta usa.
--
-- O QUE ISSO EXPÕE: nome e cliente dos contratos ATIVOS, para quem tiver o
-- link de um formulário. É a mesma decisão já tomada em `cs_form_colegas`,
-- que dá nome, setor e cargo dos colaboradores ao mesmo público. Valor,
-- vigência, empresa e o resto das colunas continuam fora — a função lista
-- três campos, não `SELECT *`.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cs_form_contratos()
RETURNS TABLE(id text, nome text, cliente text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id::text, btrim(c.nome), nullif(btrim(coalesce(c.cliente, '')), '')
    FROM public.contratos c
   WHERE c.status = 'ativo'
     AND btrim(coalesce(c.nome, '')) <> ''
   ORDER BY 2;
$$;

-- REVOKE de PUBLIC não basta: `anon` e `authenticated` herdam EXECUTE por
-- outro caminho, e é por isso que os dois papéis são citados explicitamente
-- em vez de "quem sobrar".
REVOKE EXECUTE ON FUNCTION public.cs_form_contratos() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cs_form_contratos() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) AS contratos_ativos FROM public.cs_form_contratos();

-- =========================================================================
-- ROLLBACK
--   DROP FUNCTION public.cs_form_contratos();
--   NOTIFY pgrst, 'reload schema';
--   (a tela volta ao SELECT direto — e ao bug: sem login, lista vazia)
-- =========================================================================
