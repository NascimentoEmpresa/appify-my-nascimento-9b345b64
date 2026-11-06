-- =====================================================================
-- SUPRIMENTOS — Caixa de e-mail dentro de Fornecedores (06/11/2026)
--
-- Pedido do Pablo: "um painel completo dentro de fornecedores pra ENVIAR
-- EMAIL, igual o gmail mesmo, De / Para". Compras escrevia no Outlook/webmail
-- e o histórico com o fornecedor ficava espalhado na caixa de cada um. Agora o
-- e-mail sai do ERP e fica registrado aqui, compartilhado por quem tem a tela.
--
-- O QUE TEM
--   • "SUP_FORNECEDOR_EMAIL": cada mensagem (rascunho, enviada ou com falha),
--     com De/Para/Cc/Cco, assunto, corpo HTML e anexos.
--   • Menu FANTASMA `fornecedores_email` (rota NULL) em Suprimentos:
--       visualizar = ver a caixa (Enviados/Falhas)
--       incluir    = escrever, salvar rascunho e enviar
--     Tela nova nasce sem ninguém (desde 08/10/2026 o concede_tudo não
--     alcança) — liberar em Administração › Acesso por Usuário.
--   • Bucket privado `sup-fornecedor-email` para os anexos (25 MB/arquivo).
--
-- QUEM ESCREVE O QUÊ
--   Rascunho: o próprio autor, pela RLS (status = 'rascunho').
--   Enviada/falha: SÓ a Edge Function `fornecedor-email-enviar` (service
--   role). A tela não consegue marcar uma mensagem como "enviada" sem ela ter
--   saído de verdade — o histórico é prova, não anotação.
--
-- O remetente (De) não é livre: vem do secret SUPRIMENTOS_EMAIL_FROM (ou
-- SMTP_FROM) da Edge, porque o Resend só entrega pelo domínio verificado. O
-- nome de quem escreveu vai no nome de exibição e o e-mail do login vai em
-- Reply-To — a resposta do fornecedor cai na caixa de quem mandou.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS "sup forn email anexo select" ON storage.objects;
--   DROP POLICY IF EXISTS "sup forn email anexo insert" ON storage.objects;
--   DROP POLICY IF EXISTS "sup forn email anexo delete" ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'sup-fornecedor-email';  -- só vazio
--   DROP TABLE IF EXISTS public."SUP_FORNECEDOR_EMAIL";
--   DROP FUNCTION IF EXISTS public.sup_forn_email_acesso(text);
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'fornecedores_email';
--   DELETE FROM public.app_menu WHERE codigo = 'fornecedores_email';
-- =====================================================================

-- ── 1) Menu fantasma ─────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'fornecedores_email', 'Fornecedores — E-mails (enviar e histórico)', NULL, 6, true
  FROM public.app_modulo m WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'fornecedores_email', a::public.app_acao
  FROM unnest(ARRAY['visualizar','incluir','excluir']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sup_forn_email_acesso(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), 'fornecedores_email', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.sup_forn_email_acesso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_forn_email_acesso(text) TO authenticated;

-- ── 2) Mensagens ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SUP_FORNECEDOR_EMAIL" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status          text NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho','enviando','enviado','falhou')),
  -- Fornecedores ligados à mensagem (os que foram escolhidos no "Para").
  -- Array, não FK: um e-mail pode ir para vários, e apagar o fornecedor não
  -- pode apagar o histórico do que foi mandado para ele.
  fornecedor_ids  uuid[] NOT NULL DEFAULT '{}',
  de_nome         text,
  de_email        text,
  responder_para  text,
  para            text[] NOT NULL DEFAULT '{}',
  cc              text[] NOT NULL DEFAULT '{}',
  cco             text[] NOT NULL DEFAULT '{}',
  assunto         text NOT NULL DEFAULT '' CHECK (length(assunto) <= 300),
  corpo_html      text NOT NULL DEFAULT '' CHECK (length(corpo_html) <= 500000),
  -- [{ path, nome, tipo, tamanho }] — arquivos no bucket sup-fornecedor-email
  anexos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  erro            text,
  autor_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  autor_nome      text,
  enviado_em      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_forn_email_status_data
  ON public."SUP_FORNECEDOR_EMAIL" (status, COALESCE(enviado_em, updated_at) DESC);
CREATE INDEX IF NOT EXISTS idx_sup_forn_email_fornecedores
  ON public."SUP_FORNECEDOR_EMAIL" USING gin (fornecedor_ids);
CREATE INDEX IF NOT EXISTS idx_sup_forn_email_autor
  ON public."SUP_FORNECEDOR_EMAIL" (autor_id);

CREATE OR REPLACE FUNCTION public.sup_forn_email_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sup_forn_email_touch ON public."SUP_FORNECEDOR_EMAIL";
CREATE TRIGGER trg_sup_forn_email_touch BEFORE UPDATE ON public."SUP_FORNECEDOR_EMAIL"
  FOR EACH ROW EXECUTE FUNCTION public.sup_forn_email_touch();

ALTER TABLE public."SUP_FORNECEDOR_EMAIL" ENABLE ROW LEVEL SECURITY;

-- Caixa compartilhada: quem vê a tela vê o que saiu (enviado/falhou/enviando).
-- Rascunho é só do autor — rascunho alheio é papel na mesa de outra pessoa.
DROP POLICY IF EXISTS sup_forn_email_select ON public."SUP_FORNECEDOR_EMAIL";
CREATE POLICY sup_forn_email_select ON public."SUP_FORNECEDOR_EMAIL" FOR SELECT TO authenticated
  USING (
    (select public.sup_forn_email_acesso('visualizar'))
    AND (status <> 'rascunho' OR autor_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS sup_forn_email_insert ON public."SUP_FORNECEDOR_EMAIL";
CREATE POLICY sup_forn_email_insert ON public."SUP_FORNECEDOR_EMAIL" FOR INSERT TO authenticated
  WITH CHECK (
    status = 'rascunho' AND autor_id = (select auth.uid())
    AND (select public.sup_forn_email_acesso('incluir'))
  );

DROP POLICY IF EXISTS sup_forn_email_update ON public."SUP_FORNECEDOR_EMAIL";
CREATE POLICY sup_forn_email_update ON public."SUP_FORNECEDOR_EMAIL" FOR UPDATE TO authenticated
  USING (status = 'rascunho' AND autor_id = (select auth.uid()) AND (select public.sup_forn_email_acesso('incluir')))
  WITH CHECK (status = 'rascunho' AND autor_id = (select auth.uid()));

-- Apagar: o próprio rascunho; mensagem que já saiu só com a ação 'excluir'.
DROP POLICY IF EXISTS sup_forn_email_delete ON public."SUP_FORNECEDOR_EMAIL";
CREATE POLICY sup_forn_email_delete ON public."SUP_FORNECEDOR_EMAIL" FOR DELETE TO authenticated
  USING (
    (status = 'rascunho' AND autor_id = (select auth.uid()))
    OR (status IN ('enviado','falhou') AND (select public.sup_forn_email_acesso('excluir')))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public."SUP_FORNECEDOR_EMAIL" TO authenticated;

-- ── 3) Anexos ────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sup-fornecedor-email', 'sup-fornecedor-email', false, 26214400) -- 25 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "sup forn email anexo select" ON storage.objects;
CREATE POLICY "sup forn email anexo select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sup-fornecedor-email' AND (select public.sup_forn_email_acesso('visualizar')));
-- Cada um sobe na própria pasta (<uid>/...): a Edge confere o prefixo antes de
-- anexar, para ninguém mandar o arquivo que outra pessoa subiu.
DROP POLICY IF EXISTS "sup forn email anexo insert" ON storage.objects;
CREATE POLICY "sup forn email anexo insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'sup-fornecedor-email'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND (select public.sup_forn_email_acesso('incluir'))
  );
DROP POLICY IF EXISTS "sup forn email anexo delete" ON storage.objects;
CREATE POLICY "sup forn email anexo delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'sup-fornecedor-email'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT codigo, rota FROM public.app_menu WHERE codigo = 'fornecedores_email';
-- SELECT * FROM public.app_menu_acao WHERE menu_codigo = 'fornecedores_email';
-- SELECT id, public FROM storage.buckets WHERE id = 'sup-fornecedor-email';
