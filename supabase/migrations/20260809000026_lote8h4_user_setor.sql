-- Lote 8h-4: tabela nova `user_setor` — o "Setor" do usuário vira 100%
-- descritivo/frontend, sem NENHUM significado de permissão (decisão do
-- usuário, confirmada no início do redesenho de acesso: tabela nova e
-- separada de user_roles, não uma reinterpretação das mesmas linhas).
--
-- user_roles/app_role/has_role() NÃO são removidos aqui — continuam
-- existindo só como histórico (nenhuma RLS/função os lê mais pra decidir
-- acesso, confirmado pela auditoria ao vivo desta sessão). Esta migration
-- só cria a estrutura nova e faz o backfill inicial a partir do que existe
-- hoje em user_roles, usando o nome de exibição já customizado em
-- perfil_metadata (ex: 'comercial' -> 'Licitações', 'comprador' ->
-- 'Suprimentos') como rótulo inicial do setor — sem isso, o usuário teria
-- que recadastrar o setor de todo mundo do zero depois do corte de UI
-- (Lote 8h-5).
--
-- ROLLBACK: DROP TABLE public.user_setor;

CREATE TABLE public.user_setor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (user_id, setor)
);

CREATE INDEX idx_user_setor_user ON public.user_setor(user_id);

ALTER TABLE public.user_setor ENABLE ROW LEVEL SECURITY;

-- Leitura ampla (mesmo nível de sensibilidade de profiles.display_name —
-- é só um rótulo de departamento, não controla nada).
CREATE POLICY user_setor_select ON public.user_setor FOR SELECT TO authenticated
  USING (true);

-- Escrita só por quem já edita usuários hoje (mesma tela, UsuariosReal.tsx).
CREATE POLICY user_setor_write ON public.user_setor FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- Backfill: 1 linha de user_setor pra cada (user_id, role) hoje em
-- user_roles, usando o nome de exibição já customizado em perfil_metadata
-- (fallback: role em título, sublinhado -> espaço, se nunca foi customizado).
INSERT INTO public.user_setor (user_id, setor)
SELECT DISTINCT
  ur.user_id,
  COALESCE(
    NULLIF(btrim(pm.nome), ''),
    initcap(replace(ur.role::text, '_', ' '))
  ) AS setor
FROM public.user_roles ur
LEFT JOIN public.perfil_metadata pm ON pm.role = ur.role
ON CONFLICT (user_id, setor) DO NOTHING;

NOTIFY pgrst, 'reload schema';
