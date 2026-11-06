-- =====================================================================
-- MÓDULO E-MAIL — cada um envia do próprio endereço pelo ERP (06/11/2026)
--
-- Pedido do Pablo: "um módulo de Email dentro do nosso ERP, cada um com seu
-- Email, enviando emails por aqui". Fase 1 = SÓ ENVIO. Receber continua na
-- caixa de cada um (UOL): a resposta cai lá porque a mensagem sai do
-- endereço real da pessoa.
--
-- POR QUE NÃO O SMTP DA CAIXA DE CADA UM: a UOL recusa mensagem vinda dos
-- IPs do cluster (ver supabase/functions/_shared/enviar-email.ts, 22/10).
-- O envio sai pelo Resend, que manda como qualquer endereço do domínio
-- verificado SEM a senha de ninguém. Por isso o endereço é AMARRADO ao login
-- — se cada um escolhesse o "De", qualquer usuário mandaria como a diretoria.
--
-- DE ONDE VEM O ENDEREÇO DE CADA UM (resolvido na Edge `email-enviar`):
--   1. "EMAIL_REMETENTE" ativo do usuário (configurado pelo admin); senão
--   2. o e-mail do login, se for @haggltda.com.br (o domínio da empresa;
--      o secret EMAIL_DOMINIOS substitui a lista se um dia mudar); senão
--   3. não envia — a tela diz para pedir o endereço ao admin.
--
-- PERMISSÕES (tela nova nasce sem ninguém — liberar em Acesso por Usuário):
--   email        visualizar = abrir a caixa (só as próprias mensagens)
--                incluir    = escrever, rascunho e enviar
--                excluir    = apagar mensagem já enviada do próprio histórico
--   email_admin  visualizar = ver os remetentes e TODAS as mensagens enviadas
--                alterar    = definir/desativar o endereço de cada usuário
--
-- Módulo próprio (app_modulo 'email'): nasce com o perfil de módulo vazio
-- (trg_criar_perfil_acesso_do_modulo), ninguém ganha por tabela.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS "email anexo select" ON storage.objects;
--   DROP POLICY IF EXISTS "email anexo insert" ON storage.objects;
--   DROP POLICY IF EXISTS "email anexo delete" ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'email-anexos';   -- só vazio
--   DROP FUNCTION IF EXISTS public.email_contatos();
--   DROP TABLE IF EXISTS public."EMAIL_MENSAGEM", public."EMAIL_REMETENTE";
--   DROP FUNCTION IF EXISTS public.email_acesso(text, text);
--   DELETE FROM public.app_menu_acao WHERE menu_codigo IN ('email','email_admin');
--   DELETE FROM public.app_menu WHERE codigo IN ('email','email_admin');
--   DELETE FROM public.app_modulo WHERE codigo = 'email';
-- =====================================================================

-- ── 1) Módulo e menus ────────────────────────────────────────────────
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem, ativo)
VALUES ('email', 'E-mail', 'Envio de e-mail pelo ERP, do endereço de cada um', 'Mail', 960, true)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'email', 'Meu E-mail', '/app/email', 10, true
  FROM public.app_modulo m WHERE m.codigo = 'email'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'email_admin', 'Remetentes e histórico geral', '/app/email/remetentes', 20, true
  FROM public.app_modulo m WHERE m.codigo = 'email'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'email', a::public.app_acao FROM unnest(ARRAY['visualizar','incluir','excluir']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'email_admin', a::public.app_acao FROM unnest(ARRAY['visualizar','alterar']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.email_acesso(_menu text, _acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND _menu IN ('email', 'email_admin')
     AND public.has_screen_access(auth.uid(), _menu, _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.email_acesso(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_acesso(text, text) TO authenticated;

-- ── 2) Endereço de cada usuário ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."EMAIL_REMETENTE" (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$'),
  nome_exibicao  text CHECK (nome_exibicao IS NULL OR length(nome_exibicao) <= 80),
  ativo          boolean NOT NULL DEFAULT true,
  atualizado_por uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- Um endereço ativo pertence a UMA pessoa: duas pessoas no mesmo "De" e o
-- histórico deixa de dizer quem mandou.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_remetente_email_ativo
  ON public."EMAIL_REMETENTE" (email) WHERE ativo;

ALTER TABLE public."EMAIL_REMETENTE" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_remetente_select ON public."EMAIL_REMETENTE";
CREATE POLICY email_remetente_select ON public."EMAIL_REMETENTE" FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR (select public.email_acesso('email_admin', 'visualizar')));

DROP POLICY IF EXISTS email_remetente_write ON public."EMAIL_REMETENTE";
CREATE POLICY email_remetente_write ON public."EMAIL_REMETENTE" FOR ALL TO authenticated
  USING ((select public.email_acesso('email_admin', 'alterar')))
  WITH CHECK ((select public.email_acesso('email_admin', 'alterar')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public."EMAIL_REMETENTE" TO authenticated;

-- ── 3) Mensagens ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."EMAIL_MENSAGEM" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status          text NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho','enviando','enviado','falhou')),
  de_nome         text,
  de_email        text,
  responder_para  text,
  para            text[] NOT NULL DEFAULT '{}',
  cc              text[] NOT NULL DEFAULT '{}',
  cco             text[] NOT NULL DEFAULT '{}',
  assunto         text NOT NULL DEFAULT '' CHECK (length(assunto) <= 300),
  corpo_html      text NOT NULL DEFAULT '' CHECK (length(corpo_html) <= 500000),
  anexos          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ path, nome, tipo, tamanho }]
  erro            text,
  autor_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  autor_nome      text,
  enviado_em      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_msg_autor_status
  ON public."EMAIL_MENSAGEM" (autor_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_msg_status_data
  ON public."EMAIL_MENSAGEM" (status, updated_at DESC);

CREATE OR REPLACE FUNCTION public.email_msg_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_email_msg_touch ON public."EMAIL_MENSAGEM";
CREATE TRIGGER trg_email_msg_touch BEFORE UPDATE ON public."EMAIL_MENSAGEM"
  FOR EACH ROW EXECUTE FUNCTION public.email_msg_touch();

DROP TRIGGER IF EXISTS trg_email_remetente_touch ON public."EMAIL_REMETENTE";
CREATE TRIGGER trg_email_remetente_touch BEFORE UPDATE ON public."EMAIL_REMETENTE"
  FOR EACH ROW EXECUTE FUNCTION public.email_msg_touch();

ALTER TABLE public."EMAIL_MENSAGEM" ENABLE ROW LEVEL SECURITY;

-- Caixa PESSOAL (diferente da de Fornecedores, que é compartilhada): cada um
-- vê as próprias. O admin vê o que SAIU de todos; rascunho alheio, nunca.
DROP POLICY IF EXISTS email_msg_select ON public."EMAIL_MENSAGEM";
CREATE POLICY email_msg_select ON public."EMAIL_MENSAGEM" FOR SELECT TO authenticated
  USING (
    (autor_id = (select auth.uid()) AND (select public.email_acesso('email', 'visualizar')))
    OR (status <> 'rascunho' AND (select public.email_acesso('email_admin', 'visualizar')))
  );

DROP POLICY IF EXISTS email_msg_insert ON public."EMAIL_MENSAGEM";
CREATE POLICY email_msg_insert ON public."EMAIL_MENSAGEM" FOR INSERT TO authenticated
  WITH CHECK (status = 'rascunho' AND autor_id = (select auth.uid()) AND (select public.email_acesso('email', 'incluir')));

DROP POLICY IF EXISTS email_msg_update ON public."EMAIL_MENSAGEM";
CREATE POLICY email_msg_update ON public."EMAIL_MENSAGEM" FOR UPDATE TO authenticated
  USING (status = 'rascunho' AND autor_id = (select auth.uid()) AND (select public.email_acesso('email', 'incluir')))
  WITH CHECK (status = 'rascunho' AND autor_id = (select auth.uid()));

DROP POLICY IF EXISTS email_msg_delete ON public."EMAIL_MENSAGEM";
CREATE POLICY email_msg_delete ON public."EMAIL_MENSAGEM" FOR DELETE TO authenticated
  USING (
    autor_id = (select auth.uid())
    AND (status = 'rascunho' OR (status IN ('enviado','falhou') AND (select public.email_acesso('email', 'excluir'))))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public."EMAIL_MENSAGEM" TO authenticated;

-- ── 4) Anexos ────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('email-anexos', 'email-anexos', false, 26214400) -- 25 MB
ON CONFLICT (id) DO NOTHING;

-- Pasta = <uid>/...: cada um lê e sobe só na sua; o admin lê todas (para
-- abrir o anexo de uma mensagem do histórico geral).
DROP POLICY IF EXISTS "email anexo select" ON storage.objects;
CREATE POLICY "email anexo select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'email-anexos'
    AND (((storage.foldername(name))[1] = (select auth.uid())::text AND (select public.email_acesso('email', 'visualizar')))
         OR (select public.email_acesso('email_admin', 'visualizar')))
  );
DROP POLICY IF EXISTS "email anexo insert" ON storage.objects;
CREATE POLICY "email anexo insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'email-anexos'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND (select public.email_acesso('email', 'incluir'))
  );
DROP POLICY IF EXISTS "email anexo delete" ON storage.objects;
CREATE POLICY "email anexo delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'email-anexos' AND (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 5) Contatos para o "Para" ────────────────────────────────────────
-- Uma lista só, carregada uma vez pela tela: colegas do ERP (o endereço de
-- remetente quando houver, senão o do login), fornecedores (SÓ para quem vê
-- Fornecedores — o cadastro tem RLS própria e isto aqui é SECURITY DEFINER)
-- e quem a própria pessoa já recebeu mensagem dela.
-- Candidatos do Recrutamento ficam de fora de propósito: e-mail pessoal de
-- candidato não pode virar sugestão para o ERP inteiro.
CREATE OR REPLACE FUNCTION public.email_contatos()
RETURNS TABLE (email text, nome text, origem text, ref_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT (public.email_acesso('email', 'incluir') OR public.email_acesso('email', 'visualizar')) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH colegas AS (
    SELECT lower(COALESCE(r.email, p.email)) AS email,
           COALESCE(NULLIF(r.nome_exibicao, ''), p.display_name, split_part(p.email, '@', 1)) AS nome,
           'Colega'::text AS origem, p.id::text AS ref_id
      FROM public.profiles p
      LEFT JOIN public."EMAIL_REMETENTE" r ON r.user_id = p.id AND r.ativo
     WHERE p.ativo AND COALESCE(r.email, p.email) IS NOT NULL
  ),
  fornecedores AS (
    SELECT lower(btrim(e.email)) AS email,
           COALESCE(NULLIF(f.nome_fantasia, ''), f.razao_social) AS nome,
           ('Fornecedor · ' || v.rotulo)::text AS origem, f.id::text AS ref_id
      FROM public.fornecedor f
     CROSS JOIN LATERAL (VALUES (f.email, 'principal'), (f.email_financeiro, 'financeiro'), (f.email_nota_fiscal, 'nota fiscal')) AS v(lista, rotulo)
     CROSS JOIN LATERAL regexp_split_to_table(COALESCE(v.lista, ''), '[,;[:space:]]+') AS e(email)
     WHERE f.ativo AND public.can_access(_uid, 'fornecedores', 'visualizar'::public.app_acao)
       AND e.email ~ '^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$'
  ),
  recentes AS (
    SELECT DISTINCT lower(x) AS email, NULL::text AS nome, 'Enviado antes'::text AS origem, NULL::text AS ref_id
      FROM public."EMAIL_MENSAGEM" m, unnest(m.para || m.cc || m.cco) AS x
     WHERE m.autor_id = _uid AND m.status = 'enviado'
  )
  SELECT DISTINCT ON (t.email, t.origem) t.email, t.nome, t.origem, t.ref_id
    FROM (SELECT * FROM colegas UNION ALL SELECT * FROM fornecedores UNION ALL SELECT * FROM recentes) t
   WHERE t.email IS NOT NULL AND t.email <> ''
   ORDER BY t.email, t.origem;
END $$;
REVOKE ALL ON FUNCTION public.email_contatos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_contatos() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT codigo, rota FROM public.app_menu WHERE codigo IN ('email','email_admin');
-- SELECT * FROM public.app_menu_acao WHERE menu_codigo IN ('email','email_admin');
-- SELECT id, public FROM storage.buckets WHERE id = 'email-anexos';
