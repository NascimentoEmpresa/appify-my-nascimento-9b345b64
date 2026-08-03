-- Catálogo próprio de setores — pedido do usuário: gerenciamento dedicado
-- (criar/editar/excluir) numa aba nova "Setores" em /app/administracao,
-- separado do modal de editar usuário (evita apagar um setor usado por
-- outras pessoas sem querer, a partir da tela de uma pessoa só).
--
-- user_setor.setor passa a referenciar setor_catalogo.nome com CASCADE:
-- renomear no catálogo já atualiza todo mundo que tinha aquele setor;
-- excluir do catálogo já remove a atribuição de todo mundo que tinha.
-- Setor continua 100% descritivo — nada aqui concede permissão.
--
-- ROLLBACK: ALTER TABLE public.user_setor DROP CONSTRAINT user_setor_setor_fkey;
--           DROP TABLE public.setor_catalogo;

CREATE TABLE public.setor_catalogo (
  nome text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

INSERT INTO public.setor_catalogo (nome)
SELECT DISTINCT setor FROM public.user_setor
ON CONFLICT (nome) DO NOTHING;

ALTER TABLE public.user_setor
  ADD CONSTRAINT user_setor_setor_fkey
  FOREIGN KEY (setor) REFERENCES public.setor_catalogo(nome)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.setor_catalogo ENABLE ROW LEVEL SECURITY;

CREATE POLICY setor_catalogo_select ON public.setor_catalogo FOR SELECT TO authenticated
  USING (true);

CREATE POLICY setor_catalogo_write ON public.setor_catalogo FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

NOTIFY pgrst, 'reload schema';
