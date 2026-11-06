-- =========================================================================
-- SIS-2026-0772 (fase 2) — MENU LATERAL ORGANIZÁVEL (05/11/2026)
--
-- PEDIDO (Iury, gerente de sistemas): uma tela onde se organiza o menu
-- lateral — arrastar um submódulo para outro módulo (mover ou copiar), criar
-- módulo, categoria e submódulo, reordenar — com log de quem alterou, e
-- acesso só para pessoas específicas.
--
-- O QUE ESTA MIGRATION GUARDA: só o LUGAR de cada tela no menu. A permissão
-- de cada tela continua sendo a do endereço dela (list_accessible_menus /
-- RouteGuard / Sidebar.canSee) — mover ou copiar não dá acesso a ninguém.
--
-- CERCA PRINCIPAL: nada aqui toca app_menu.modulo_id. O perfil de módulo
-- (perfil_acesso.modulo_codigo) libera TUDO o que pertence ao módulo no
-- banco; em 05/11/2026 eram 83 encarregados no de Encarregados. Se mover uma
-- tela no menu trocasse o modulo_id, eles ganhariam a tela sem ninguém ver.
-- A organização mora numa tabela própria e o front lê dela.
--
-- POR QUE UM app_modulo PRÓPRIO para a tela do editor: no módulo "admin"
-- seis pessoas ganhariam a tela pelo perfil de módulo (e não só as duas
-- pedidas); no "sistemas", mais uma. Módulo novo nasce com o perfil vazio
-- (trigger trg_criar_perfil_acesso_do_modulo), e app_menu.concede_tudo_alcanca
-- nasce false — o Administrador Geral também não alcança.
--
-- LOG = a própria tabela: cada gravação é uma linha nova com o menu inteiro e
-- a lista de alterações. Ninguém edita nem apaga (sem policy de escrita; só a
-- RPC grava). Restaurar uma versão é gravá-la de novo como versão nova.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Módulo e menu da tela "Organizar Menu Lateral" ───────────────────
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem, ativo)
VALUES ('menu_lateral', 'Organização do Menu', 'Organização do menu lateral do ERP (só o lugar das telas, não a permissão)', 'PanelLeft', 990, true)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'menu_lateral', 'Organizar Menu Lateral', '/app/sistemas/menu-lateral', 10, true
  FROM public.app_modulo m WHERE m.codigo = 'menu_lateral'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- visualizar = ver a organização e o histórico; alterar = salvar e restaurar.
INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'menu_lateral', a::public.app_acao
  FROM unnest(ARRAY['visualizar','alterar']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- Acesso inicial: Eduardo e Iury, por UUID (há contas "– Testes" com nomes
-- que colidem com os oficiais; casar por nome já liberou a conta errada).
-- Os demais são liberados em Administração › Acesso por Usuário.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT p.id, 'menu_lateral', a.acao::public.app_acao, true, NULL, 'SIS-2026-0772: acesso inicial ao editor do menu lateral'
  FROM public.profiles p
 CROSS JOIN (VALUES ('visualizar'), ('alterar')) AS a(acao)
 WHERE p.id IN ('97260632-2f1a-44e3-9f93-58b2b1f3702c'::uuid, 'd1dbc8d4-bf9b-4125-a6b1-11b6195155a4'::uuid)
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO NOTHING;

-- ── 2) Versões do menu (a organização e o log) ──────────────────────────
CREATE TABLE IF NOT EXISTS public."MENU_LATERAL_VERSAO" (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  versao      integer NOT NULL UNIQUE,
  estrutura   jsonb   NOT NULL,
  resumo      text,
  alteracoes  jsonb   NOT NULL DEFAULT '[]'::jsonb,
  autor_id    uuid    NOT NULL,
  autor_nome  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."MENU_LATERAL_VERSAO" IS
  'SIS-2026-0772: organização do menu lateral, uma linha por gravação (a última vale). Só lugar das telas — permissão é por endereço. Escrita só via menu_lateral_salvar.';

ALTER TABLE public."MENU_LATERAL_VERSAO" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public."MENU_LATERAL_VERSAO" FROM anon, authenticated;
GRANT SELECT ON public."MENU_LATERAL_VERSAO" TO authenticated;

-- Histórico: só quem enxerga a tela do editor. O menu em si (a última
-- versão) todo mundo lê, mas pela RPC menu_lateral_atual, sem o log.
DROP POLICY IF EXISTS "menu_lateral_versao_select" ON public."MENU_LATERAL_VERSAO";
CREATE POLICY "menu_lateral_versao_select" ON public."MENU_LATERAL_VERSAO"
  FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access(auth.uid(), 'menu_lateral', 'visualizar'::public.app_acao)));

-- ── 3) Leitura do menu atual (todo usuário logado desenha o menu) ───────
CREATE OR REPLACE FUNCTION public.menu_lateral_atual()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('versao', v.versao, 'estrutura', v.estrutura)
    FROM public."MENU_LATERAL_VERSAO" v
   WHERE auth.uid() IS NOT NULL
   ORDER BY v.versao DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.menu_lateral_atual() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_lateral_atual() TO authenticated;

-- ── 4) Gravação (única porta de escrita) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.menu_lateral_salvar(
  p_estrutura   jsonb,
  p_versao_base integer,
  p_resumo      text DEFAULT NULL,
  p_alteracoes  jsonb DEFAULT '[]'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ultima integer;
  v_nova   integer;
  m jsonb; c jsonb; i jsonb;
  v_ids    text[] := '{}';
  v_id     text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'menu_lateral', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para alterar a organização do menu.' USING ERRCODE = '42501';
  END IF;

  -- Uma gravação por vez; e quem editou em cima de uma versão velha é
  -- avisado em vez de apagar o trabalho de quem salvou antes.
  PERFORM pg_advisory_xact_lock(hashtext('menu_lateral_salvar'));
  SELECT max(versao) INTO v_ultima FROM public."MENU_LATERAL_VERSAO";
  IF v_ultima IS DISTINCT FROM p_versao_base THEN
    RAISE EXCEPTION 'O menu foi alterado por outra pessoa enquanto você editava. Recarregue a tela e refaça as alterações.'
      USING ERRCODE = '40001';
  END IF;

  -- Formato e limites — as mesmas regras de validarEstrutura no front.
  IF p_estrutura IS NULL OR jsonb_typeof(p_estrutura) <> 'object'
     OR jsonb_typeof(p_estrutura->'modulos') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_estrutura->'rotasConhecidas') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Estrutura do menu inválida.' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_estrutura::text) > 524288 THEN
    RAISE EXCEPTION 'Estrutura do menu grande demais.' USING ERRCODE = '22023';
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(p_estrutura->'modulos') LOOP
    v_id := m->>'id';
    IF coalesce(btrim(m->>'rotulo'), '') = '' OR length(m->>'rotulo') > 120 OR v_id IS NULL OR v_id = ANY (v_ids)
       OR jsonb_typeof(m->'categorias') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Módulo inválido no menu: %', coalesce(m->>'rotulo', v_id) USING ERRCODE = '22023';
    END IF;
    v_ids := v_ids || v_id;
    FOR c IN SELECT * FROM jsonb_array_elements(m->'categorias') LOOP
      v_id := c->>'id';
      IF coalesce(btrim(c->>'rotulo'), '') = '' OR length(c->>'rotulo') > 120 OR v_id IS NULL OR v_id = ANY (v_ids)
         OR jsonb_typeof(c->'itens') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Categoria inválida no menu: %', coalesce(c->>'rotulo', v_id) USING ERRCODE = '22023';
      END IF;
      v_ids := v_ids || v_id;
      FOR i IN SELECT * FROM jsonb_array_elements(c->'itens') LOOP
        v_id := i->>'id';
        IF v_id IS NULL OR v_id = ANY (v_ids) THEN
          RAISE EXCEPTION 'Entrada repetida ou sem id no menu.' USING ERRCODE = '22023';
        END IF;
        v_ids := v_ids || v_id;
        -- Só endereço interno do ERP: nada de link externo nem javascript:.
        IF coalesce(i->>'rota', '') !~ '^/app(/|\?|$)' THEN
          RAISE EXCEPTION 'Endereço não permitido no menu: %', i->>'rota' USING ERRCODE = '22023';
        END IF;
        IF i ? 'rotulo' AND (coalesce(btrim(i->>'rotulo'), '') = '' OR length(i->>'rotulo') > 120) THEN
          RAISE EXCEPTION 'Nome inválido para a entrada %', i->>'rota' USING ERRCODE = '22023';
        END IF;
        IF NOT (i ? 'rotulo') AND NOT (i ? 'ref') THEN
          RAISE EXCEPTION 'Entrada criada sem nome: %', i->>'rota' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  v_nova := coalesce(v_ultima, 0) + 1;
  INSERT INTO public."MENU_LATERAL_VERSAO" (versao, estrutura, resumo, alteracoes, autor_id, autor_nome)
  VALUES (
    v_nova, p_estrutura, left(nullif(btrim(p_resumo), ''), 500),
    CASE WHEN jsonb_typeof(p_alteracoes) = 'array' THEN p_alteracoes ELSE '[]'::jsonb END,
    auth.uid(),
    (SELECT display_name FROM public.profiles WHERE id = auth.uid())
  );
  RETURN v_nova;
END;
$$;
REVOKE ALL ON FUNCTION public.menu_lateral_salvar(jsonb, integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_lateral_salvar(jsonb, integer, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
-- SELECT codigo, rota, concede_tudo_alcanca FROM public.app_menu WHERE codigo = 'menu_lateral';
-- SELECT user_id, acao, allow FROM public.screen_permission_user WHERE menu_codigo = 'menu_lateral';
-- SELECT pa.nome, count(upa.user_id) FROM public.perfil_acesso pa
--   LEFT JOIN public.usuario_perfil_acesso upa ON upa.perfil_id = pa.id
--  WHERE pa.modulo_codigo = 'menu_lateral' GROUP BY pa.nome;   -- esperado: 0 pessoas

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.menu_lateral_salvar(jsonb, integer, text, jsonb);
-- DROP FUNCTION IF EXISTS public.menu_lateral_atual();
-- DROP TABLE IF EXISTS public."MENU_LATERAL_VERSAO";
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'menu_lateral';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'menu_lateral';
-- DELETE FROM public.app_menu WHERE codigo = 'menu_lateral';
-- DELETE FROM public.perfil_acesso WHERE modulo_codigo = 'menu_lateral';
-- DELETE FROM public.app_modulo WHERE codigo = 'menu_lateral';
-- NOTIFY pgrst, 'reload schema';
