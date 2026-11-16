-- =========================================================================
-- SIS-2026-0837 -- PERMISSAO INDEPENDENTE PARA COPIAS DO MENU LATERAL
--
-- PROBLEMA: o Organizar Menu Lateral guardava copias como duas entradas com
-- a mesma rota. A Sidebar filtrava somente pela rota; liberar Fluxo de Caixa
-- fazia Financeiro, Contabil e Diretoria aparecerem ao mesmo tempo.
--
-- DECISAO: alternativa 2 do chamado. Cada copia recebe um app_menu proprio,
-- identificado dentro do JSON da estrutura por `menuCodigo`. O grant da copia
-- controla somente aquela posicao. A tela original continua sendo a autoridade
-- para acoes de negocio (alterar/excluir/aprovar etc.).
--
-- COMPATIBILIDADE: ao criar o registro de uma copia, quem hoje abre a rota
-- original recebe `visualizar` na copia. Assim o deploy nao tira nem acrescenta
-- modulos para usuarios existentes; dali em diante as chaves sao independentes.
-- Copia retirada da estrutura fica inativa, nao e apagada: restaurar uma versao
-- recupera tambem os grants que ela ja tinha.
-- =========================================================================

INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem, ativo)
VALUES (
  'menu_lateral_copias',
  'Copias do Menu Lateral',
  'Permissoes independentes das telas copiadas pelo Organizar Menu Lateral.',
  'Copy',
  991,
  true
)
ON CONFLICT (codigo) DO UPDATE
SET nome = EXCLUDED.nome,
    descricao = EXCLUDED.descricao,
    ativo = true;

-- Uma copia concede a leitura da tela original sem conceder suas acoes. Isso
-- permite desligar Financeiro e ligar apenas a copia de Contabilidade: a RLS
-- que pergunta pelo menu original ainda autoriza SELECT, mas a Sidebar original
-- continua desligada porque list_accessible_menus devolve somente o codigo da
-- copia. A chamada recursiva termina na copia, excluida pelo prefixo da origem.
CREATE OR REPLACE FUNCTION public.menu_lateral_copia_libera(
  _user uuid,
  _menu_original text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.app_menu origem
      JOIN public.app_menu copia
        ON copia.rota = origem.rota
       AND copia.ativo = true
       AND copia.codigo LIKE 'menu_lateral_copia_%'
     WHERE origem.codigo = _menu_original
       AND origem.ativo = true
       AND origem.codigo NOT LIKE 'menu_lateral_copia_%'
       AND origem.rota IS NOT NULL
       AND public.has_screen_access(
             _user,
             copia.codigo,
             'visualizar'::public.app_acao
           )
  )
$$;
REVOKE ALL ON FUNCTION public.menu_lateral_copia_libera(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.menu_lateral_copia_libera(uuid, text) FROM authenticated;

-- Definicao viva de 20261008000006, com uma unica extensao: quando o acesso
-- normal ao menu original resulta falso, `visualizar` pode vir de uma copia.
-- Override individual continua vencendo perfis NAQUELA posicao: negar o
-- original nao nega uma copia explicitamente liberada, e vice-versa.
CREATE OR REPLACE FUNCTION public.has_screen_access(
  _user uuid,
  _menu text,
  _acao public.app_acao,
  _empresa uuid DEFAULT NULL::uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow boolean;
BEGIN
  IF _user IS NULL THEN
    RETURN false;
  END IF;

  IF public.erp_login_bloqueado(_user) THEN
    RETURN false;
  END IF;

  SELECT allow INTO v_allow
    FROM public.screen_permission_user
   WHERE user_id = _user
     AND menu_codigo = _menu
     AND acao = _acao
   ORDER BY updated_at DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_allow THEN RETURN true; END IF;
    RETURN _acao = 'visualizar'::public.app_acao
       AND _menu NOT LIKE 'menu_lateral_copia_%'
       AND public.menu_lateral_copia_libera(_user, _menu);
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa
        ON pa.id = upa.perfil_id
       AND pa.ativo = true
       AND pa.concede_tudo = true
     WHERE upa.user_id = _user
  ) AND public.concede_tudo_alcanca(_menu) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true
      JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id
     WHERE upa.user_id = _user
       AND pap.menu_codigo = _menu
       AND pap.acao = _acao
       AND pap.allow = true
  ) THEN
    RETURN true;
  END IF;

  RETURN _acao = 'visualizar'::public.app_acao
     AND _menu NOT LIKE 'menu_lateral_copia_%'
     AND public.menu_lateral_copia_libera(_user, _menu);
END;
$$;

-- Sincroniza app_menu com as copias da estrutura e devolve o JSON enriquecido.
-- Nao e executavel diretamente por usuario: somente menu_lateral_salvar chama.
CREATE OR REPLACE FUNCTION public.menu_lateral_sincronizar_copias(p_estrutura jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estrutura jsonb := p_estrutura;
  v_modulo_id uuid;
  v_codigos text[] := '{}';
  v_codigo text;
  v_id text;
  v_rota text;
  v_nome_base text;
  v_nome text;
  v_novo boolean;
  v_mi integer;
  v_ci integer;
  v_ii integer;
  v_m jsonb;
  v_c jsonb;
  v_i jsonb;
  v_path text[];
BEGIN
  IF p_estrutura IS NULL
     OR jsonb_typeof(p_estrutura->'modulos') IS DISTINCT FROM 'array' THEN
    RETURN p_estrutura;
  END IF;

  SELECT id INTO v_modulo_id
    FROM public.app_modulo
   WHERE codigo = 'menu_lateral_copias';
  IF v_modulo_id IS NULL THEN
    RAISE EXCEPTION 'Modulo de permissoes das copias nao encontrado.' USING ERRCODE = '55000';
  END IF;

  IF jsonb_array_length(v_estrutura->'modulos') > 0 THEN
    FOR v_mi IN 0..jsonb_array_length(v_estrutura->'modulos') - 1 LOOP
      v_m := v_estrutura #> ARRAY['modulos', v_mi::text];
      IF jsonb_typeof(v_m->'categorias') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_m->'categorias') = 0 THEN
        CONTINUE;
      END IF;

      FOR v_ci IN 0..jsonb_array_length(v_m->'categorias') - 1 LOOP
        v_c := v_m #> ARRAY['categorias', v_ci::text];
        IF jsonb_typeof(v_c->'itens') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_c->'itens') = 0 THEN
          CONTINUE;
        END IF;

        FOR v_ii IN 0..jsonb_array_length(v_c->'itens') - 1 LOOP
          v_i := v_c #> ARRAY['itens', v_ii::text];
          IF coalesce(v_i->>'copiaDe', '') = '' THEN
            CONTINUE;
          END IF;

          v_id := v_i->>'id';
          v_rota := v_i->>'rota';
          v_codigo := nullif(v_i->>'menuCodigo', '');
          v_path := ARRAY[
            'modulos', v_mi::text, 'categorias', v_ci::text,
            'itens', v_ii::text, 'menuCodigo'
          ];

          -- Versoes anteriores ao chamado nao tinham menuCodigo. O hash evita
          -- colisao mesmo se o id antigo contiver pontuacao ou for muito longo.
          IF v_codigo IS NULL THEN
            v_codigo := 'menu_lateral_copia_' || substr(md5(v_id), 1, 24);
            v_estrutura := jsonb_set(v_estrutura, v_path, to_jsonb(v_codigo), true);
          END IF;

          IF length(v_codigo) > 100
             OR v_codigo !~ '^menu_lateral_copia_[a-z0-9_:-]+$'
             OR v_codigo = ANY (v_codigos) THEN
            RAISE EXCEPTION 'Codigo de permissao invalido ou repetido na copia %.', v_id
              USING ERRCODE = '22023';
          END IF;
          IF EXISTS (
            SELECT 1 FROM public.app_menu
             WHERE codigo = v_codigo AND modulo_id <> v_modulo_id
          ) THEN
            RAISE EXCEPTION 'Codigo da copia ja pertence a outro modulo: %.', v_codigo
              USING ERRCODE = '23505';
          END IF;
          v_codigos := array_append(v_codigos, v_codigo);

          SELECT am.nome INTO v_nome_base
            FROM public.app_menu am
           WHERE am.rota = v_rota
             AND am.codigo NOT LIKE 'menu_lateral_copia_%'
           ORDER BY am.ativo DESC, am.ordem, am.id
           LIMIT 1;
          v_nome_base := coalesce(nullif(v_i->>'rotulo', ''), v_nome_base, v_rota);
          v_nome := left(
            concat_ws(' > ', nullif(v_m->>'rotulo', ''), nullif(v_c->>'rotulo', ''), v_nome_base)
            || ' (copia)',
            300
          );

          SELECT NOT EXISTS (
            SELECT 1 FROM public.app_menu
             WHERE modulo_id = v_modulo_id AND codigo = v_codigo
          ) INTO v_novo;

          INSERT INTO public.app_menu (
            modulo_id, codigo, nome, rota, ordem, ativo, concede_tudo_alcanca
          )
          VALUES (
            v_modulo_id, v_codigo, v_nome, v_rota,
            (v_mi + 1) * 10000 + (v_ci + 1) * 100 + v_ii,
            true, false
          )
          ON CONFLICT (modulo_id, codigo) DO UPDATE
          SET nome = EXCLUDED.nome,
              rota = EXCLUDED.rota,
              ordem = EXCLUDED.ordem,
              ativo = true,
              concede_tudo_alcanca = false;

          INSERT INTO public.app_menu_acao (menu_codigo, acao)
          VALUES (v_codigo, 'visualizar'::public.app_acao)
          ON CONFLICT (menu_codigo, acao) DO NOTHING;

          -- Somente na primeira materializacao. Depois disso, a copia e
          -- independente e salvar/reordenar o menu nao reescreve decisoes do
          -- administrador de acesso.
          IF v_novo THEN
            INSERT INTO public.screen_permission_user (
              user_id, menu_codigo, acao, allow, empresa_id, motivo
            )
            SELECT p.id, v_codigo, 'visualizar'::public.app_acao, true, NULL,
                   'SIS-2026-0837: heranca inicial da tela original'
              FROM public.profiles p
             WHERE NOT public.erp_login_bloqueado(p.id)
               AND EXISTS (
               SELECT 1
                 FROM public.app_menu origem
                WHERE origem.rota = v_rota
                  AND origem.ativo = true
                  AND origem.codigo NOT LIKE 'menu_lateral_copia_%'
                  -- Calcula o acesso BASE sem usar has_screen_access: depois
                  -- deste chamado a funcao tambem reconhece outras copias, e
                  -- uma copia existente nao pode liberar automaticamente uma
                  -- nova copia da mesma rota.
                  AND COALESCE(
                    (
                      SELECT spu.allow
                        FROM public.screen_permission_user spu
                       WHERE spu.user_id = p.id
                         AND spu.menu_codigo = origem.codigo
                         AND spu.acao = 'visualizar'::public.app_acao
                       ORDER BY spu.updated_at DESC
                       LIMIT 1
                    ),
                    (
                      EXISTS (
                        SELECT 1
                          FROM public.usuario_perfil_acesso upa
                          JOIN public.perfil_acesso pa
                            ON pa.id = upa.perfil_id
                           AND pa.ativo = true
                           AND pa.concede_tudo = true
                         WHERE upa.user_id = p.id
                      )
                      AND public.concede_tudo_alcanca(origem.codigo)
                    )
                    OR EXISTS (
                      SELECT 1
                        FROM public.usuario_perfil_acesso upa
                        JOIN public.perfil_acesso pa
                          ON pa.id = upa.perfil_id AND pa.ativo = true
                        JOIN public.perfil_acesso_permissao pap
                          ON pap.perfil_id = pa.id
                         AND pap.allow = true
                       WHERE upa.user_id = p.id
                         AND pap.menu_codigo = origem.codigo
                         AND pap.acao = 'visualizar'::public.app_acao
                    ),
                    false
                  )
             )
            ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO NOTHING;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END IF;

  -- Preserva registro e grants para o historico conseguir restaurar a copia.
  UPDATE public.app_menu
     SET ativo = false
   WHERE modulo_id = v_modulo_id
     AND codigo LIKE 'menu_lateral_copia_%'
     AND NOT (codigo = ANY (v_codigos))
     AND ativo = true;

  RETURN v_estrutura;
END;
$$;
REVOKE ALL ON FUNCTION public.menu_lateral_sincronizar_copias(jsonb) FROM PUBLIC, anon, authenticated;

-- Mesma porta atomica de escrita do SIS-2026-0772. A unica mudanca funcional
-- e sincronizar as copias antes de gravar a versao; toda validacao original e
-- o bloqueio otimista por versao continuam aqui.
CREATE OR REPLACE FUNCTION public.menu_lateral_salvar(
  p_estrutura jsonb,
  p_versao_base integer,
  p_resumo text DEFAULT NULL,
  p_alteracoes jsonb DEFAULT '[]'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ultima integer;
  v_nova integer;
  v_estrutura jsonb := p_estrutura;
  m jsonb;
  c jsonb;
  i jsonb;
  v_ids text[] := '{}';
  v_id text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_screen_access(
       auth.uid(), 'menu_lateral', 'alterar'::public.app_acao
     ) THEN
    RAISE EXCEPTION 'Sem permissao para alterar a organizacao do menu.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('menu_lateral_salvar'));
  SELECT max(versao) INTO v_ultima FROM public."MENU_LATERAL_VERSAO";
  IF v_ultima IS DISTINCT FROM p_versao_base THEN
    RAISE EXCEPTION 'O menu foi alterado por outra pessoa enquanto voce editava. Recarregue a tela e refaca as alteracoes.'
      USING ERRCODE = '40001';
  END IF;

  IF v_estrutura IS NULL OR jsonb_typeof(v_estrutura) <> 'object'
     OR jsonb_typeof(v_estrutura->'modulos') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_estrutura->'rotasConhecidas') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Estrutura do menu invalida.' USING ERRCODE = '22023';
  END IF;
  IF octet_length(v_estrutura::text) > 524288 THEN
    RAISE EXCEPTION 'Estrutura do menu grande demais.' USING ERRCODE = '22023';
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(v_estrutura->'modulos') LOOP
    v_id := m->>'id';
    IF coalesce(btrim(m->>'rotulo'), '') = ''
       OR length(m->>'rotulo') > 120
       OR v_id IS NULL OR v_id = ANY (v_ids)
       OR jsonb_typeof(m->'categorias') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Modulo invalido no menu: %', coalesce(m->>'rotulo', v_id)
        USING ERRCODE = '22023';
    END IF;
    v_ids := v_ids || v_id;

    FOR c IN SELECT * FROM jsonb_array_elements(m->'categorias') LOOP
      v_id := c->>'id';
      IF coalesce(btrim(c->>'rotulo'), '') = ''
         OR length(c->>'rotulo') > 120
         OR v_id IS NULL OR v_id = ANY (v_ids)
         OR jsonb_typeof(c->'itens') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Categoria invalida no menu: %', coalesce(c->>'rotulo', v_id)
          USING ERRCODE = '22023';
      END IF;
      v_ids := v_ids || v_id;

      FOR i IN SELECT * FROM jsonb_array_elements(c->'itens') LOOP
        v_id := i->>'id';
        IF v_id IS NULL OR v_id = ANY (v_ids) THEN
          RAISE EXCEPTION 'Entrada repetida ou sem id no menu.' USING ERRCODE = '22023';
        END IF;
        v_ids := v_ids || v_id;
        IF coalesce(i->>'rota', '') !~ '^/app(/|\?|$)' THEN
          RAISE EXCEPTION 'Endereco nao permitido no menu: %', i->>'rota' USING ERRCODE = '22023';
        END IF;
        IF i ? 'rotulo'
           AND (coalesce(btrim(i->>'rotulo'), '') = '' OR length(i->>'rotulo') > 120) THEN
          RAISE EXCEPTION 'Nome invalido para a entrada %', i->>'rota' USING ERRCODE = '22023';
        END IF;
        IF NOT (i ? 'rotulo') AND NOT (i ? 'ref') THEN
          RAISE EXCEPTION 'Entrada criada sem nome: %', i->>'rota' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  v_estrutura := public.menu_lateral_sincronizar_copias(v_estrutura);

  v_nova := coalesce(v_ultima, 0) + 1;
  INSERT INTO public."MENU_LATERAL_VERSAO" (
    versao, estrutura, resumo, alteracoes, autor_id, autor_nome
  )
  VALUES (
    v_nova,
    v_estrutura,
    left(nullif(btrim(p_resumo), ''), 500),
    CASE WHEN jsonb_typeof(p_alteracoes) = 'array' THEN p_alteracoes ELSE '[]'::jsonb END,
    auth.uid(),
    (SELECT display_name FROM public.profiles WHERE id = auth.uid())
  );
  RETURN v_nova;
END;
$$;
REVOKE ALL ON FUNCTION public.menu_lateral_salvar(jsonb, integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_lateral_salvar(jsonb, integer, text, jsonb) TO authenticated;

-- Materializa as copias que ja estao na versao em uso. O UPDATE acrescenta
-- apenas o metadado menuCodigo; nao muda lugar, nome, ordem ou historico
-- funcional do menu.
DO $$
DECLARE
  v_id bigint;
  v_estrutura jsonb;
BEGIN
  SELECT id, estrutura INTO v_id, v_estrutura
    FROM public."MENU_LATERAL_VERSAO"
   ORDER BY versao DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public."MENU_LATERAL_VERSAO"
       SET estrutura = public.menu_lateral_sincronizar_copias(v_estrutura)
     WHERE id = v_id;
  END IF;
END;
$$;

COMMENT ON TABLE public."MENU_LATERAL_VERSAO" IS
  'SIS-2026-0772/0837: organizacao do menu. Copias carregam menuCodigo independente; a ultima versao vale. Escrita somente via menu_lateral_salvar.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (sensivel: antes confira os grants criados para nao ocultar copias)
-- Reaplicar has_screen_access de 20261008000006_concede_tudo_nao_alcanca_telas_novas.sql.
-- Reaplicar menu_lateral_salvar de 20261105040000_sis_2026_0772_menu_lateral_editavel.sql.
-- DROP FUNCTION IF EXISTS public.menu_lateral_sincronizar_copias(jsonb);
-- DROP FUNCTION IF EXISTS public.menu_lateral_copia_libera(uuid, text);
-- DELETE FROM public.app_menu_acao WHERE menu_codigo LIKE 'menu_lateral_copia_%';
-- DELETE FROM public.screen_permission_user WHERE menu_codigo LIKE 'menu_lateral_copia_%';
-- DELETE FROM public.app_menu WHERE codigo LIKE 'menu_lateral_copia_%';
-- DELETE FROM public.perfil_acesso WHERE modulo_codigo = 'menu_lateral_copias';
-- DELETE FROM public.app_modulo WHERE codigo = 'menu_lateral_copias';
-- NOTIFY pgrst, 'reload schema';
