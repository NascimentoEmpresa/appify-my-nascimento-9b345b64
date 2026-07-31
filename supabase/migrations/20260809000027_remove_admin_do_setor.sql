-- "Admin" não é um departamento — é resquício do backfill inicial de
-- user_setor (Lote 8h-4), que migrou o cargo 'admin' (rótulo "Admin" via
-- perfil_metadata) pra dentro de user_setor junto com os demais. Pedido do
-- usuário: remover "Admin" da lista de setores. Setor não tem nenhum efeito
-- em permissão, então isso é só limpeza de dado/exibição — não muda o
-- acesso de ninguém.
--
-- ROLLBACK: recriar as linhas removidas a partir de user_roles, ex.:
-- INSERT INTO public.user_setor (user_id, setor)
--   SELECT user_id, 'Admin' FROM public.user_roles WHERE role = 'admin'
--   ON CONFLICT (user_id, setor) DO NOTHING;

DELETE FROM public.user_setor WHERE setor = 'Admin';
