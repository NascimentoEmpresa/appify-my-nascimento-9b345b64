-- Agenda Corporativa: diretório de contatos (nome, e-mail, telefone, cargo,
-- setor) pesquisável por qualquer usuário autenticado, aberto por um ícone
-- na Topbar.
--
-- profiles só é legível pra si mesmo (profiles_self_select: id = auth.uid()
-- ou admin) — e-mail/telefone de terceiros não passam pelo PostgREST direto.
-- Igual já é feito em listar_usuarios_ativos(), expomos via função
-- SECURITY DEFINER que devolve só as colunas necessárias, sem tocar na
-- policy existente nem abrir a tabela inteira.
--
-- Cargo: EMPREGADOS(auth_user_id) tem índice único parcial
-- (empregados_auth_user_id_uidx), então o LEFT JOIN abaixo nunca duplica
-- linha de profiles. NULLIF em cascata trata NULL e o literal
-- "AMBÍGUO - REVISAR MANUALMENTE" da mesma forma (cargo some pro frontend
-- nos dois casos, mostrando só o setor).
--
-- Setor vem de user_setor (rótulo 100% descritivo, já público por RLS),
-- não de EMPREGADOS."Setor_ERP" (mais sujo e não é a fonte usada em outras
-- telas de setor do usuário).
--
-- Exclui contas de teste (display_name ILIKE '%teste%').
CREATE OR REPLACE FUNCTION public.listar_agenda_corporativa()
RETURNS TABLE(
  id uuid,
  display_name text,
  email text,
  telefone text,
  avatar_url text,
  cargo text,
  setores text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.display_name,
    p.email,
    p.telefone,
    p.avatar_url,
    NULLIF(NULLIF(btrim(e."Nome do Cargo"), ''), 'AMBÍGUO - REVISAR MANUALMENTE') AS cargo,
    COALESCE(s.setores, ARRAY[]::text[]) AS setores
  FROM public.profiles p
  LEFT JOIN public."EMPREGADOS" e ON e.auth_user_id = p.id
  LEFT JOIN (
    SELECT user_id, array_agg(setor ORDER BY setor) AS setores
    FROM public.user_setor
    GROUP BY user_id
  ) s ON s.user_id = p.id
  WHERE p.ativo = true
    AND p.display_name NOT ILIKE '%teste%'
  ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.listar_agenda_corporativa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_agenda_corporativa() TO authenticated;

-- Favoritos da Agenda Corporativa: por usuário. Não existe padrão
-- equivalente hoje (o único "favorito" existente, em WA_CURRICULOS, é uma
-- coluna booleana global/compartilhada, não por usuário) — tabela nova,
-- mesmo formato de user_setor (RLS restrita ao próprio dono).
CREATE TABLE public.agenda_favoritos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contato_id)
);

CREATE INDEX idx_agenda_favoritos_user ON public.agenda_favoritos(user_id);

ALTER TABLE public.agenda_favoritos ENABLE ROW LEVEL SECURITY;

CREATE POLICY agenda_favoritos_select ON public.agenda_favoritos FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY agenda_favoritos_write ON public.agenda_favoritos FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
