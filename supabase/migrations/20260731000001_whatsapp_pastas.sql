-- WhatsApp — pastas (filas) de atendimento.
--
-- A Caixa de Entrada deixa de ser uma lista única: cada conversa pode ficar numa
-- pasta (RH, Recrutamento, SST, Compras, Jurídico) e cada pessoa só enxerga as
-- pastas que lhe foram liberadas. Quem tem "Todas as conversas" vê tudo,
-- inclusive o que ainda não foi direcionado.
--
-- PERMISSÃO: não existe modelo novo. Cada pasta é uma linha em `app_menu` sob o
-- módulo 'whatsapp', com rota NULL (não vira item de menu lateral — a Sidebar é
-- montada a partir de rotas). Com isso ela aparece sozinha na cascata de
-- Administração › Acesso por Usuário, embaixo do WhatsApp, e `tem_acesso_menu`
-- passa a valer para a RLS sem nenhuma tabela de permissão adicional.

-- 1) Pastas --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."WA_PASTA" (
  codigo       text PRIMARY KEY,              -- rh, recrutamento, ... (sem acento/espaço)
  nome         text NOT NULL,                 -- rótulo exibido
  menu_codigo  text NOT NULL UNIQUE,          -- app_menu.codigo que governa quem vê a pasta
  ordem        integer NOT NULL DEFAULT 0,
  ativo        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public."WA_PASTA" (codigo, nome, menu_codigo, ordem) VALUES
  ('rh',           'RH',           'whatsapp_pasta_rh',           1),
  ('recrutamento', 'Recrutamento', 'whatsapp_pasta_recrutamento', 2),
  ('sst',          'SST',          'whatsapp_pasta_sst',          3),
  ('compras',      'Compras',      'whatsapp_pasta_compras',      4),
  ('juridico',     'Jurídico',     'whatsapp_pasta_juridico',     5)
ON CONFLICT (codigo) DO NOTHING;

-- 2) A conversa mora numa pasta (NULL = ainda não direcionada) -----------
ALTER TABLE public."WA_CONVERSA"
  ADD COLUMN IF NOT EXISTS pasta_codigo text REFERENCES public."WA_PASTA"(codigo) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wa_conversa_pasta
  ON public."WA_CONVERSA"(pasta_codigo, ultima_mensagem_em DESC NULLS LAST);

-- 3) Menus de permissão (rota NULL de propósito) --------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, v.codigo, v.nome, NULL, v.ordem
  FROM public.app_modulo m
  CROSS JOIN (VALUES
    ('whatsapp_todas',             'WhatsApp — Todas as conversas', 10),
    ('whatsapp_pasta_rh',          'WhatsApp — Pasta RH',           11),
    ('whatsapp_pasta_recrutamento','WhatsApp — Pasta Recrutamento', 12),
    ('whatsapp_pasta_sst',         'WhatsApp — Pasta SST',          13),
    ('whatsapp_pasta_compras',     'WhatsApp — Pasta Compras',      14),
    ('whatsapp_pasta_juridico',    'WhatsApp — Pasta Jurídico',     15)
  ) AS v(codigo, nome, ordem)
 WHERE m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 4) Não tirar acesso de quem já tinha -----------------------------------
-- Antes desta migration, quem enxergava o menu 'whatsapp' via TODAS as conversas.
-- Sem este passo, ligar o recorte por pasta deixaria todo mundo com a caixa
-- vazia até alguém reconfigurar na mão. Então quem já tinha o módulo ganha
-- 'whatsapp_todas' — o recorte por pasta passa a ser opt-in (basta retirar
-- 'Todas as conversas' de quem deve ver só a sua fila).
-- `empresa_id IS NULL` não colide no UNIQUE (NULL <> NULL no Postgres), por isso
-- NOT EXISTS em vez de ON CONFLICT.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, 'whatsapp_todas', 'visualizar'::public.app_acao, true, NULL,
       'Migração das pastas do WhatsApp: preserva o acesso que já existia'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'whatsapp' AND s.acao = 'visualizar'
   AND s.allow = true AND s.empresa_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.screen_permission_user t
      WHERE t.user_id = s.user_id AND t.menu_codigo = 'whatsapp_todas'
        AND t.acao = 'visualizar' AND t.empresa_id IS NULL
   );

-- 5) Quem enxerga qual pasta ---------------------------------------------
-- 'Todas as conversas' cobre tudo, inclusive pasta NULL (a fila de triagem, que
-- precisa de alguém olhando). Sem ela, só as pastas liberadas uma a uma.
CREATE OR REPLACE FUNCTION public.wa_pode_ver_pasta(_pasta text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('whatsapp_todas')
      OR EXISTS (
           SELECT 1 FROM public."WA_PASTA" p
            WHERE p.codigo = _pasta
              AND public.tem_acesso_menu(p.menu_codigo)
         );
$$;
REVOKE ALL ON FUNCTION public.wa_pode_ver_pasta(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_pode_ver_pasta(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_pode_ver_pasta(text) TO authenticated;

-- 6) RLS: conversa e mensagem passam a respeitar a pasta ------------------
DROP POLICY IF EXISTS wa_conversa_rw ON public."WA_CONVERSA";
CREATE POLICY wa_conversa_rw ON public."WA_CONVERSA" FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp') AND public.wa_pode_ver_pasta(pasta_codigo))
  WITH CHECK (public.tem_acesso_menu('whatsapp') AND public.wa_pode_ver_pasta(pasta_codigo));

DROP POLICY IF EXISTS wa_mensagem_rw ON public."WA_MENSAGEM";
CREATE POLICY wa_mensagem_rw ON public."WA_MENSAGEM" FOR ALL TO authenticated
  USING (
    public.tem_acesso_menu('whatsapp')
    AND EXISTS (SELECT 1 FROM public."WA_CONVERSA" c
                 WHERE c.id = conversa_id AND public.wa_pode_ver_pasta(c.pasta_codigo))
  )
  WITH CHECK (
    public.tem_acesso_menu('whatsapp')
    AND EXISTS (SELECT 1 FROM public."WA_CONVERSA" c
                 WHERE c.id = conversa_id AND public.wa_pode_ver_pasta(c.pasta_codigo))
  );

-- O contato é dado de apoio (nome/telefone) e continua valendo o módulo: sem ele
-- a lista de conversas não teria como mostrar de quem é cada conversa.

-- 7) Catálogo de pastas: todo mundo do módulo lê; só admin escreve --------
ALTER TABLE public."WA_PASTA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."WA_PASTA" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."WA_PASTA" TO authenticated;

DROP POLICY IF EXISTS wa_pasta_select ON public."WA_PASTA";
CREATE POLICY wa_pasta_select ON public."WA_PASTA" FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('whatsapp') OR public.tem_acesso_menu('whatsapp_chatbot'));

-- Escrita só pela RPC (SECURITY DEFINER), que também cria/remove o app_menu.
DROP POLICY IF EXISTS wa_pasta_admin ON public."WA_PASTA";
CREATE POLICY wa_pasta_admin ON public."WA_PASTA" FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 8) Criar/remover pasta -------------------------------------------------
-- Cria a pasta E o app_menu que a governa, numa transação só: pasta sem menu
-- seria invisível para todo mundo (ninguém teria como receber a permissão).
CREATE OR REPLACE FUNCTION public.wa_pasta_criar(_nome text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text;
  v_menu   text;
  v_modulo uuid;
  v_ordem  integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Somente administradores podem criar pastas.';
  END IF;

  v_codigo := regexp_replace(
                lower(translate(btrim(coalesce(_nome, '')),
                      'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç',
                      'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuucc')),
                '[^a-z0-9]+', '_', 'g');
  v_codigo := btrim(v_codigo, '_');
  IF v_codigo = '' THEN
    RAISE EXCEPTION 'Informe um nome válido para a pasta.';
  END IF;
  IF EXISTS (SELECT 1 FROM public."WA_PASTA" WHERE codigo = v_codigo) THEN
    RAISE EXCEPTION 'Já existe uma pasta com esse nome.';
  END IF;

  v_menu := 'whatsapp_pasta_' || v_codigo;
  SELECT id INTO v_modulo FROM public.app_modulo WHERE codigo = 'whatsapp';
  IF v_modulo IS NULL THEN
    RAISE EXCEPTION 'Módulo whatsapp não encontrado.';
  END IF;
  SELECT coalesce(max(ordem), 15) + 1 INTO v_ordem FROM public."WA_PASTA";

  INSERT INTO public."WA_PASTA" (codigo, nome, menu_codigo, ordem)
  VALUES (v_codigo, btrim(_nome), v_menu, v_ordem);

  INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
  VALUES (v_modulo, v_menu, 'WhatsApp — Pasta ' || btrim(_nome), NULL, v_ordem)
  ON CONFLICT (modulo_id, codigo) DO NOTHING;

  RETURN v_codigo;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_pasta_criar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_pasta_criar(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_pasta_criar(text) TO authenticated;

-- Remover a pasta solta as conversas dela (voltam para a triagem) e apaga o
-- menu junto — senão sobraria uma permissão órfã na tela de acesso.
CREATE OR REPLACE FUNCTION public.wa_pasta_remover(_codigo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_menu text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Somente administradores podem remover pastas.';
  END IF;
  SELECT menu_codigo INTO v_menu FROM public."WA_PASTA" WHERE codigo = _codigo;
  IF v_menu IS NULL THEN RETURN; END IF;

  UPDATE public."WA_CONVERSA" SET pasta_codigo = NULL WHERE pasta_codigo = _codigo;
  DELETE FROM public."WA_PASTA" WHERE codigo = _codigo;
  DELETE FROM public.screen_permission_user WHERE menu_codigo = v_menu;
  DELETE FROM public.app_menu a
   USING public.app_modulo m
   WHERE a.modulo_id = m.id AND m.codigo = 'whatsapp' AND a.codigo = v_menu;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_pasta_remover(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_pasta_remover(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_pasta_remover(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
