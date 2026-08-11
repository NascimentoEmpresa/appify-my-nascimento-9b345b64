-- Descrição livre do perfil ("sobre mim"), em Meu Perfil.
--
-- Opcional de propósito: perfil vazio não é problema a resolver. Serve para a
-- pessoa dizer o que o cadastro da Senior não diz — no que está trabalhando,
-- como preferem ser chamados, em que horário respondem.
--
-- 500 caracteres: cabe um parágrafo honesto e não vira campo de texto livre
-- que ninguém lê. O limite é do banco, não só da tela: a tela pode ser
-- contornada, o CHECK não.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_bio_tamanho;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_bio_tamanho CHECK (bio IS NULL OR length(bio) <= 500);

COMMENT ON COLUMN public.profiles.bio IS
  'Descrição livre escrita pelo próprio usuário em Meu Perfil. Opcional.';

-- Quem pode escrever já está resolvido: a policy profiles_self_update permite
-- o próprio usuário (id = auth.uid()) e quem administra. Nada a acrescentar.

NOTIFY pgrst, 'reload schema';
