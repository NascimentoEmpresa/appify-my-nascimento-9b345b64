-- =========================================================================
-- BI & Analytics › Links dos BIs
--
-- Um catálogo de painéis de Business Intelligence: card com foto, título,
-- descrição e o link que abre o painel. Quem cadastra escolhe QUEM vê cada
-- um — por setor, por pessoa, ou os dois.
--
-- DUAS CAMADAS DE ACESSO, QUE NÃO SE CONFUNDEM
--   1. A TELA. Como toda tela do ERP: `app_menu` + has_screen_access. Quem
--      não tem o menu não abre a página, ponto. É o padrão do README, e não
--      muda aqui.
--   2. O CARD. Dentro da tela, cada link tem sua própria lista de setores e
--      pessoas. Isto NÃO é permissão de tela — é recorte de conteúdo, como o
--      Painel de Formulários já faz por setor (CS_FORM_ACESSOS). Um BI de
--      folha não interessa (nem deve aparecer) para Suprimentos.
--
-- LINK SEM NENHUMA REGRA É PARA TODOS
--   Deliberado, e é o oposto do deny-by-default das telas. Aqui a tela já
--   filtrou quem entra; obrigar a listar setor a setor para cada link novo
--   faria o cadastro nascer invisível e todo mundo achar que "não salvou".
--   Restringir é o ato explícito: sem linha em BI_LINK_ACESSO, o card é do
--   time inteiro que tem a tela.
--
-- A FONTE DO SETOR É `setor_catalogo` + `user_setor`
--   ⚠ NÃO é a tabela "SETORES". Ela existe e parece a certa, mas guarda os
--   nomes em CAIXA ALTA ("LICITACAO", "FINANCEIRO") enquanto `user_setor`
--   grava "Licitações", "Financeiro" — das 17 linhas de lá, só "RH" casa com
--   alguém. Usar "SETORES" faria a liberação por setor não pegar ninguém e
--   parecer um bug de permissão.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."BI_LINK" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  descricao   text,
  url         text NOT NULL,
  /** Capa do card. URL pública do bucket bi-capas, ou um link de fora. */
  imagem_url  text,
  /** O "Todos os grupos" do filtro — Financeiro, Operacional, RH... */
  grupo       text,
  ordem       integer NOT NULL DEFAULT 0,
  ativo       boolean NOT NULL DEFAULT true,
  criado_por  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."BI_LINK" IS
  'Catálogo de painéis de BI. Quem vê cada card sai de BI_LINK_ACESSO; sem linha lá, é de todos que têm a tela.';

CREATE INDEX IF NOT EXISTS bi_link_ordem_idx ON public."BI_LINK" (ordem, titulo) WHERE ativo;

-- ── Quem vê cada card ────────────────────────────────────────────────────
-- Uma linha por regra. `setor` OU `user_id`, nunca os dois: são duas formas
-- de dizer a mesma coisa ("este card é seu"), e uma linha com os dois
-- preenchidos não teria leitura óbvia — é E ou é OU?
CREATE TABLE IF NOT EXISTS public."BI_LINK_ACESSO" (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id    uuid NOT NULL REFERENCES public."BI_LINK"(id) ON DELETE CASCADE,
  setor      text,
  user_id    uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_link_acesso_um_alvo CHECK (
    (setor IS NOT NULL AND user_id IS NULL) OR (setor IS NULL AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS bi_link_acesso_setor_uk
  ON public."BI_LINK_ACESSO" (link_id, setor) WHERE setor IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bi_link_acesso_user_uk
  ON public."BI_LINK_ACESSO" (link_id, user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE public."BI_LINK_ACESSO" IS
  'Recorte de conteúdo do card (setor ou pessoa). Não é permissão de tela — essa continua em app_menu.';

-- ── updated_at ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bi_link_touch()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bi_link_touch ON public."BI_LINK";
CREATE TRIGGER trg_bi_link_touch
  BEFORE UPDATE ON public."BI_LINK"
  FOR EACH ROW EXECUTE FUNCTION public.bi_link_touch();

-- ── Quem gere o catálogo ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pode_gerir_bi_links(_user uuid, _acao app_acao)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_screen_access(_user, 'bi_links', _acao);
$$;

-- Este card é para mim? Sem regra nenhuma, é de todos — ver o cabeçalho.
CREATE OR REPLACE FUNCTION public.bi_link_liberado(_link uuid, _user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public."BI_LINK_ACESSO" a WHERE a.link_id = _link)
      OR EXISTS (
        SELECT 1
          FROM public."BI_LINK_ACESSO" a
         WHERE a.link_id = _link
           AND (
             a.user_id = _user
             OR a.setor IN (SELECT u.setor FROM public.user_setor u WHERE u.user_id = _user)
           )
      );
$$;

REVOKE ALL ON FUNCTION public.pode_gerir_bi_links(uuid, app_acao) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pode_gerir_bi_links(uuid, app_acao) FROM anon;
GRANT EXECUTE ON FUNCTION public.pode_gerir_bi_links(uuid, app_acao) TO authenticated;

REVOKE ALL ON FUNCTION public.bi_link_liberado(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bi_link_liberado(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.bi_link_liberado(uuid, uuid) TO authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public."BI_LINK"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BI_LINK_ACESSO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bi_link_ler ON public."BI_LINK";
CREATE POLICY bi_link_ler ON public."BI_LINK" FOR SELECT TO authenticated
  USING (
    public.pode_gerir_bi_links(auth.uid(), 'alterar'::app_acao)
    OR (
      ativo
      AND public.has_screen_access(auth.uid(), 'bi_links', 'visualizar'::app_acao)
      AND public.bi_link_liberado(id, auth.uid())
    )
  );

DROP POLICY IF EXISTS bi_link_incluir ON public."BI_LINK";
CREATE POLICY bi_link_incluir ON public."BI_LINK" FOR INSERT TO authenticated
  WITH CHECK (public.pode_gerir_bi_links(auth.uid(), 'incluir'::app_acao));

DROP POLICY IF EXISTS bi_link_alterar ON public."BI_LINK";
CREATE POLICY bi_link_alterar ON public."BI_LINK" FOR UPDATE TO authenticated
  USING (public.pode_gerir_bi_links(auth.uid(), 'alterar'::app_acao))
  WITH CHECK (public.pode_gerir_bi_links(auth.uid(), 'alterar'::app_acao));

DROP POLICY IF EXISTS bi_link_excluir ON public."BI_LINK";
CREATE POLICY bi_link_excluir ON public."BI_LINK" FOR DELETE TO authenticated
  USING (public.pode_gerir_bi_links(auth.uid(), 'excluir'::app_acao));

-- As regras de acesso: quem gere edita; todo mundo lê as SUAS (é o que
-- permite a tela explicar "você vê este card porque é do setor X").
DROP POLICY IF EXISTS bi_link_acesso_ler ON public."BI_LINK_ACESSO";
CREATE POLICY bi_link_acesso_ler ON public."BI_LINK_ACESSO" FOR SELECT TO authenticated
  USING (
    public.pode_gerir_bi_links(auth.uid(), 'visualizar'::app_acao)
    OR user_id = auth.uid()
    OR setor IN (SELECT u.setor FROM public.user_setor u WHERE u.user_id = auth.uid())
  );

DROP POLICY IF EXISTS bi_link_acesso_incluir ON public."BI_LINK_ACESSO";
CREATE POLICY bi_link_acesso_incluir ON public."BI_LINK_ACESSO" FOR INSERT TO authenticated
  WITH CHECK (public.pode_gerir_bi_links(auth.uid(), 'alterar'::app_acao));

DROP POLICY IF EXISTS bi_link_acesso_excluir ON public."BI_LINK_ACESSO";
CREATE POLICY bi_link_acesso_excluir ON public."BI_LINK_ACESSO" FOR DELETE TO authenticated
  USING (public.pode_gerir_bi_links(auth.uid(), 'alterar'::app_acao));

-- ── A tela ───────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'bi_links', 'Links dos BIs', '/app/bi/links', 30, true
  FROM public.app_modulo m
 WHERE m.codigo = 'bi'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES
  ('bi_links', 'visualizar'::app_acao),
  ('bi_links', 'incluir'::app_acao),
  ('bi_links', 'alterar'::app_acao),
  ('bi_links', 'excluir'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── A capa do card ───────────────────────────────────────────────────────
-- Bucket público: é ilustração de card, aparece antes de qualquer clique, e
-- URL assinada em imagem de lista significa uma assinatura por card por
-- carregamento. Nada sensível entra aqui — o dado do BI está no destino, que
-- tem o próprio login.
INSERT INTO storage.buckets (id, name, public)
VALUES ('bi-capas', 'bi-capas', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS bi_capas_ler ON storage.objects;
CREATE POLICY bi_capas_ler ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'bi-capas');

DROP POLICY IF EXISTS bi_capas_subir ON storage.objects;
CREATE POLICY bi_capas_subir ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bi-capas' AND public.pode_gerir_bi_links(auth.uid(), 'incluir'::app_acao));

DROP POLICY IF EXISTS bi_capas_trocar ON storage.objects;
CREATE POLICY bi_capas_trocar ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'bi-capas' AND public.pode_gerir_bi_links(auth.uid(), 'alterar'::app_acao));

DROP POLICY IF EXISTS bi_capas_apagar ON storage.objects;
CREATE POLICY bi_capas_apagar ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'bi-capas' AND public.pode_gerir_bi_links(auth.uid(), 'alterar'::app_acao));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP POLICY IF EXISTS bi_capas_apagar ON storage.objects;
-- DROP POLICY IF EXISTS bi_capas_trocar ON storage.objects;
-- DROP POLICY IF EXISTS bi_capas_subir  ON storage.objects;
-- DROP POLICY IF EXISTS bi_capas_ler    ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'bi-capas';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'bi_links';
-- DELETE FROM public.app_menu      WHERE codigo      = 'bi_links';
-- DROP TABLE IF EXISTS public."BI_LINK_ACESSO";
-- DROP TABLE IF EXISTS public."BI_LINK";
-- DROP FUNCTION IF EXISTS public.bi_link_liberado(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.pode_gerir_bi_links(uuid, app_acao);
-- DROP FUNCTION IF EXISTS public.bi_link_touch();
-- NOTIFY pgrst, 'reload schema';
