-- =====================================================================
-- SIS-2026-0309 — list_usuarios_comercial_empresa aceita "todas as empresas"
-- + passa a filtrar por Setor "Licitações", não pela role 'comercial'
--
-- O ERP está deixando de escopar leitura pela "empresa ativa" do seletor
-- (o grupo administra várias empresas como uma unidade só, e todo usuário
-- já tem acesso a todas — o filtro só limitava a visão, sem proteger nada).
--
-- Esta RPC fazia JOIN direto em `ue.empresa_id = _empresa_id`: passar NULL
-- (semântica de "todas") sempre dava zero linhas, nunca "todas" — NULL não
-- é igual a nada em SQL. Redefinida pra tratar `_empresa_id IS NULL` como
-- "sem filtro" (usa DISTINCT porque, sem empresa fixando 1 linha por
-- usuário em user_empresa, um mesmo usuário vinculado a mais de uma
-- empresa apareceria duplicado).
--
-- Duas tentativas anteriores desta mesma migration erraram o critério de
-- "quem é da licitação":
--   1) has_screen_access(..., 'pipeline', ...) — também libera quem tem
--      perfil "concede_tudo" (Sistemas/Admin), trazendo devs e outros
--      setores pro seletor de Responsável.
--   2) role = 'comercial' (o comportamento antigo, pré-chamado) — nem
--      inclui todo mundo do setor Licitações (faltava a jovem aprendiz)
--      nem exclui quem tem a role mas não é do setor (confirmado com o
--      usuário comparando contra Administração → Gestão de Usuários,
--      que já resolve "quem é da licitação" certinho pelo campo Setor).
--
-- Setor (tabela `user_setor`, catálogo em `setor_catalogo`) é o rótulo
-- descritivo de departamento já usado em produção pra isso — não é gate de
-- acesso (mesmo espírito do uso de role em PermissoesContext.tsx: "só pra
-- exibição/descrição"). Filtra por `user_setor.setor = 'Licitações'`, que é
-- exatamente o que a tela de Gestão de Usuários mostra como setor da
-- pessoa.
--
-- `user_empresa` deixa de ser um JOIN (interno) e vira EXISTS opcional: com
-- `_empresa_id IS NULL` (o caso normal, "todas as empresas") a checagem de
-- vínculo é pulada por completo. Um usuário recém-criado sem nenhuma linha
-- em `user_empresa` (comum quando marca "acessa todas as empresas", já que
-- o cadastro de usuário nesse caso não grava vínculo nenhum — ver
-- UsuariosReal.tsx) sumia da lista mesmo pedindo "todas", porque o INNER
-- JOIN descartava a linha inteira antes do filtro de setor rodar.
--
-- Idempotente.
--
-- ROLLBACK (versão anterior a este chamado, sem suporte a "todas",
-- filtrando por role):
--   CREATE OR REPLACE FUNCTION public.list_usuarios_comercial_empresa(_empresa_id uuid)
--   RETURNS TABLE (id uuid, display_name text, email text)
--   LANGUAGE sql SECURITY DEFINER SET search_path = public
--   AS $$
--     SELECT p.id, p.display_name, p.email
--     FROM user_roles ur
--     JOIN user_empresa ue ON ue.user_id = ur.user_id AND ue.empresa_id = _empresa_id
--     JOIN profiles p ON p.id = ur.user_id
--     WHERE ur.role = 'comercial'
--     ORDER BY p.display_name;
--   $$;
-- =====================================================================

CREATE OR REPLACE FUNCTION public.list_usuarios_comercial_empresa(_empresa_id uuid)
RETURNS TABLE (id uuid, display_name text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.id, p.display_name, p.email
  FROM user_setor us
  JOIN profiles p ON p.id = us.user_id
  WHERE us.setor = 'Licitações'
    AND (
          _empresa_id IS NULL
          OR EXISTS (
            SELECT 1 FROM user_empresa ue
            WHERE ue.user_id = us.user_id AND ue.empresa_id = _empresa_id
          )
        )
  ORDER BY p.display_name;
$$;

NOTIFY pgrst, 'reload schema';
