-- =========================================================================
-- SIS-2026-0931 — TELA NOVA NASCE BLOQUEADA ATÉ LIBERAÇÃO MANUAL (17/11/2026)
--
-- PEDIDO (Iury, Gerente de Sistemas): "todo módulo ou submódulo recém-criado
-- deverá aparecer automaticamente [na aba Novos Módulos], iniciando sem acesso
-- liberado para nenhum usuário, independentemente das permissões já
-- existentes (...) nenhum módulo ou submódulo novo poderá ser acessado até que
-- sua permissão seja liberada manualmente por um administrador, inclusive por
-- acesso direto via URL".
--
-- O QUE JÁ EXISTIA E NÃO BASTAVA
--   · RouteGuard nega por padrão (rota sem app_menu ou sem grant = negada);
--   · "Administrador Geral" não alcança tela criada depois de 08/10/2026
--     (app_menu.concede_tudo_alcanca, mig 20261008000006).
--   O que sobrava era o SEED DO DEV: a migration que cria a tela libera,
--   ela mesma, pessoas e perfis. Das 103 telas criadas de 08/10 a 17/11,
--   42 nasceram dentro de algum perfil (sup_epi_entregas, sst_aso_retorno
--   com 5 perfis...) e quase todas com pessoas individuais. A tela entrava no
--   ar já liberada, sem nenhum administrador ter decidido nada.
--
-- O MODELO
--   Cada tela tem uma situação: PENDENTE (app_menu.liberado_em IS NULL) ou
--   LIBERADA. Pendente = has_screen_access responde false ANTES de qualquer
--   outra regra (exceção individual, Administrador Geral, perfil, cópia do
--   menu lateral). Como can_access, tem_acesso_menu, as RLS e o AcessoGate
--   passam por ela, e o menu lateral/RouteGuard passam por
--   list_accessible_menus, a URL direta também fica fechada.
--   O que o dev semeou continua gravado e vira "acesso preparado": aparece
--   pré-marcado em Configurações do ERP › Módulos & Menus › Novos Módulos e
--   só passa a valer quando quem tem a permissão de liberar telas novas
--   (hoje: Iury e Eduardo — seção 4b) salva ali.
--
-- DECISÕES DO EDUARDO (17/11/2026)
--   1. Só tela criada DEPOIS desta migration nasce pendente. Todas as que
--      existem ficam liberadas (liberado_por NULL = "antes do controle");
--      ninguém perde acesso. As nascidas desde 08/10 aparecem na aba para
--      revisão.
--   2. Seed do dev = preparado, pré-marcado, desmarcável.
--   3. Setor e cargo só ESCOLHEM pessoas (como SIS-2026-0851): grava por
--      pessoa em screen_permission_user; quem entra no setor depois não
--      ganha sozinho.
--   4. (revista no mesmo dia, pedido do Iury ao ver o protótipo) Liberar
--      ou bloquear tela nova é permissão PRÓPRIA — `administracao_novos_modulos`
--      — e nasce só com o Iury e o Eduardo. Não vem de "administracao", nem
--      do Administrador Geral, nem de perfil; e só quem já a tem consegue
--      concedê-la a outra pessoa (gatilho na seção 4b). Ver a aba continua
--      com quem vê a Administração. O histórico registra quem fez o quê.
--
-- POR CÓDIGO, NÃO POR LINHA: app_menu.codigo só é único por módulo (J1.D).
-- O código fica pendente só se TODAS as linhas dele estão pendentes — a mesma
-- conta de concede_tudo_alcanca(). Assim uma tela reinserida ou trocada de
-- módulo não fecha a tela que já está no ar.
--
-- NUNCA DÁ EXCEPTION POR DADO NA HORA DO SEED: os gatilhos de app_menu só
-- ajustam e avisam (WARNING). Uma migration de outro dev que tente nascer
-- liberada não para a fila do aplicador — só não consegue liberar.
--
-- Funções do gate reescritas a partir da definição de 20261115130000
-- (has_screen_access) e 20261008000006 (list_accessible_menus,
-- list_users_with_menu_access) e 20261110008510 (acesso_aplicar_em_massa),
-- com UMA mudança em cada uma, marcada "SIS-2026-0931".
--
-- Idempotente. Aplica sozinha no merge (cluster_pos_merge.yml).
-- =========================================================================

-- ── 1) A situação na tela ────────────────────────────────────────────────
-- Colunas sem default (ALTER só de metadado). A carga "toda tela que existe
-- está liberada" fica DENTRO do IF: reaplicar a migration não pode liberar
-- uma tela que nasceu pendente depois.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'app_menu' AND column_name = 'liberado_em') THEN
    ALTER TABLE public.app_menu ADD COLUMN liberado_em timestamptz;
    ALTER TABLE public.app_menu ADD COLUMN liberado_por uuid;
    UPDATE public.app_menu SET liberado_em = coalesce(created_at, now());
  END IF;
END $$;

COMMENT ON COLUMN public.app_menu.liberado_em IS
  'SIS-2026-0931: NULL = tela PENDENTE (ninguém acessa, nem com grant). Preenchida só por novo_modulo_salvar em Novos Módulos; as telas de antes de 17/11/2026 vieram liberadas na carga.';
COMMENT ON COLUMN public.app_menu.liberado_por IS
  'SIS-2026-0931: quem liberou em Novos Módulos. NULL com liberado_em preenchido = liberada antes do controle (carga de 17/11/2026), cópia do menu lateral ou herança de código já liberado.';

-- Quase sempre vazio: é o que deixa a checagem barata por linha de RLS.
CREATE INDEX IF NOT EXISTS app_menu_pendente_codigo_idx
  ON public.app_menu (codigo) WHERE liberado_em IS NULL;

-- ── 2) A regra num lugar só ──────────────────────────────────────────────
-- Cópia do menu lateral (SIS-2026-0837) nunca é pendente em si, mas fica
-- pendente junto com a tela original: senão o atalho abriria a tela nova.
CREATE OR REPLACE FUNCTION public.menu_pendente(_menu text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN _menu LIKE 'menu_lateral_copia_%' THEN EXISTS (
      SELECT 1
        FROM public.app_menu copia
        JOIN public.app_menu origem
          ON origem.rota = copia.rota
         AND origem.codigo NOT LIKE 'menu_lateral_copia_%'
         AND origem.liberado_em IS NULL
       WHERE copia.codigo = _menu
         AND NOT EXISTS (
           SELECT 1 FROM public.app_menu liberada
            WHERE liberada.rota = copia.rota
              AND liberada.codigo NOT LIKE 'menu_lateral_copia_%'
              AND liberada.liberado_em IS NOT NULL
         )
    )
    ELSE EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = _menu AND liberado_em IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = _menu AND liberado_em IS NOT NULL)
  END
$$;
REVOKE ALL ON FUNCTION public.menu_pendente(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_pendente(text) TO authenticated;

-- ── 3) Tela nova nasce pendente ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_menu_nasce_pendente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_liberada timestamptz;
BEGIN
  -- Cópia do menu lateral: é uma POSIÇÃO de uma tela que já existe, herda o
  -- acesso da original (menu_lateral_sincronizar_copias). A original
  -- pendente continua fechando a cópia em menu_pendente().
  IF NEW.codigo LIKE 'menu_lateral_copia_%' THEN
    NEW.liberado_em := coalesce(NEW.liberado_em, now());
    RETURN NEW;
  END IF;

  -- Mesmo código de uma tela que já está no ar (tela trocada de módulo,
  -- removida e reinserida): continua no ar. Fechar aqui tiraria o acesso de
  -- quem já usa.
  SELECT min(am.liberado_em) INTO v_liberada
    FROM public.app_menu am
   WHERE am.codigo = NEW.codigo AND am.liberado_em IS NOT NULL;
  IF v_liberada IS NOT NULL THEN
    NEW.liberado_em := v_liberada;
    NEW.liberado_por := NULL;
    RETURN NEW;
  END IF;

  IF NEW.liberado_em IS NOT NULL OR NEW.liberado_por IS NOT NULL OR NEW.concede_tudo_alcanca THEN
    RAISE WARNING 'SIS-2026-0931: a tela "%" nasce pendente — liberação só em Configurações do ERP › Módulos & Menus › Novos Módulos.', NEW.codigo;
  END IF;
  NEW.liberado_em := NULL;
  NEW.liberado_por := NULL;
  -- Regra de 08/10/2026 (mig 20261008000006), agora sem brecha: nem a
  -- migration consegue pôr o Administrador Geral numa tela nova.
  NEW.concede_tudo_alcanca := false;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_menu_nasce_pendente ON public.app_menu;
CREATE TRIGGER trg_app_menu_nasce_pendente
  BEFORE INSERT ON public.app_menu
  FOR EACH ROW EXECUTE FUNCTION public.app_menu_nasce_pendente();

-- ── 4) Só Novos Módulos muda a situação ──────────────────────────────────
-- Fora de novo_modulo_salvar/novo_modulo_bloquear (que ligam a variável da
-- transação), mudar liberado_em/liberado_por é ignorado com aviso — sem
-- EXCEPTION, para não parar a fila de migrations.
CREATE OR REPLACE FUNCTION public.app_menu_liberacao_so_pela_tela()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.liberado_em IS DISTINCT FROM OLD.liberado_em OR NEW.liberado_por IS DISTINCT FROM OLD.liberado_por)
     AND current_setting('erp.liberacao_novos_modulos', true) IS DISTINCT FROM 'on' THEN
    RAISE WARNING 'SIS-2026-0931: liberação da tela "%" ignorada — só em Configurações do ERP › Módulos & Menus › Novos Módulos.', OLD.codigo;
    NEW.liberado_em := OLD.liberado_em;
    NEW.liberado_por := OLD.liberado_por;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_menu_liberacao_so_pela_tela ON public.app_menu;
CREATE TRIGGER trg_app_menu_liberacao_so_pela_tela
  BEFORE UPDATE ON public.app_menu
  FOR EACH ROW EXECUTE FUNCTION public.app_menu_liberacao_so_pela_tela();

-- ── 4b) Quem libera: permissão própria, só Iury e Eduardo ────────────────
-- Menu fantasma (rota NULL) no módulo Administração. Nasce fora do
-- Administrador Geral (concede_tudo_alcanca = false) e já liberado — a
-- própria chave de liberar não pode nascer pendente, senão ninguém a abriria.
-- Fica fora da aba Novos Módulos (novo_modulo_gerido), para não ser
-- bloqueada por engano e trancar todo mundo do lado de fora.
DO $$
BEGIN
  INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo, concede_tudo_alcanca)
  SELECT mo.id, 'administracao_novos_modulos',
         'Novos Módulos — liberar ou bloquear telas novas', NULL, 990, true, false
    FROM public.app_modulo mo
   WHERE mo.codigo = 'admin'
  ON CONFLICT (modulo_id, codigo) DO NOTHING;

  PERFORM set_config('erp.liberacao_novos_modulos', 'on', true);
  UPDATE public.app_menu
     SET liberado_em = coalesce(liberado_em, now())
   WHERE codigo = 'administracao_novos_modulos';
  PERFORM set_config('erp.liberacao_novos_modulos', 'off', true);

  IF NOT EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = 'administracao_novos_modulos' AND liberado_em IS NOT NULL) THEN
    RAISE WARNING 'SIS-2026-0931: módulo "admin" não encontrado — a permissão administracao_novos_modulos não foi criada; ninguém conseguirá liberar telas novas até ela existir.';
  END IF;
END $$;

-- As duas pessoas, pelo id (conferido em 17/11/2026: um perfil ativo cada,
-- sem homônimo nem conta de teste). Mesmo pacote do toggle de "Acesso por
-- Usuário", para o painel mostrar a chave ligada. Quem não for achado sai em
-- WARNING — nunca EXCEPTION por dado (não para a fila de migrations).
--   d1dbc8d4-bf9b-4125-a6b1-11b6195155a4  IURY DE JESUS SILVA (Gerente de Sistemas)
--   97260632-2f1a-44e3-9f93-58b2b1f3702c  Eduardo Jeiel Padilha Monteiro
DO $$
DECLARE
  v_achados integer;
BEGIN
  SELECT count(*) INTO v_achados
    FROM public.profiles
   WHERE id IN ('d1dbc8d4-bf9b-4125-a6b1-11b6195155a4', '97260632-2f1a-44e3-9f93-58b2b1f3702c');
  IF v_achados < 2 THEN
    RAISE WARNING 'SIS-2026-0931: só % de 2 pessoas encontradas para liberar telas novas — conceder a permissão administracao_novos_modulos pelo painel.', v_achados;
  END IF;

  INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
  SELECT p.id, 'administracao_novos_modulos', a.acao, true, NULL,
         'SIS-2026-0931: liberar telas novas — só Iury e Eduardo (pedido do gerente, 17/11/2026)'
    FROM public.profiles p
   CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao), ('alterar'::public.app_acao),
                      ('aprovar'::public.app_acao), ('exportar'::public.app_acao)) AS a(acao)
   WHERE p.id IN ('d1dbc8d4-bf9b-4125-a6b1-11b6195155a4', '97260632-2f1a-44e3-9f93-58b2b1f3702c')
     AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user s
                      WHERE s.user_id = p.id AND s.menu_codigo = 'administracao_novos_modulos'
                        AND s.acao = a.acao AND s.empresa_id IS NULL);
END $$;

-- Só quem JÁ libera telas novas concede ou retira essa permissão de alguém —
-- pelo painel, em massa ou por perfil. Sem isto, qualquer administrador de
-- acessos ligaria a chave para si mesmo em "Acesso por Usuário". Vale só para
-- chamadas com usuário (auth.uid()); migration e serviço passam, para não
-- parar a fila.
CREATE OR REPLACE FUNCTION public.novos_modulos_permissao_so_de_quem_libera()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ((TG_OP <> 'INSERT' AND OLD.menu_codigo = 'administracao_novos_modulos')
      OR (TG_OP <> 'DELETE' AND NEW.menu_codigo = 'administracao_novos_modulos'))
     AND auth.uid() IS NOT NULL
     AND NOT public.has_screen_access(auth.uid(), 'administracao_novos_modulos', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Somente quem já libera telas novas (permissão "Novos Módulos — liberar ou bloquear telas novas") pode conceder ou retirar essa permissão.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_spu_novos_modulos_so_de_quem_libera ON public.screen_permission_user;
CREATE TRIGGER trg_spu_novos_modulos_so_de_quem_libera
  BEFORE INSERT OR UPDATE OR DELETE ON public.screen_permission_user
  FOR EACH ROW EXECUTE FUNCTION public.novos_modulos_permissao_so_de_quem_libera();

DROP TRIGGER IF EXISTS trg_pap_novos_modulos_so_de_quem_libera ON public.perfil_acesso_permissao;
CREATE TRIGGER trg_pap_novos_modulos_so_de_quem_libera
  BEFORE INSERT OR UPDATE OR DELETE ON public.perfil_acesso_permissao
  FOR EACH ROW EXECUTE FUNCTION public.novos_modulos_permissao_so_de_quem_libera();

-- ── 5) O gate ────────────────────────────────────────────────────────────
-- has_screen_access: definição viva de 20261115130000, com a checagem de
-- pendente logo depois do login bloqueado — antes da exceção individual, que
-- é exatamente o seed que não pode valer.
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

  -- SIS-2026-0931: tela nova pendente não abre para ninguém.
  IF public.menu_pendente(_menu) THEN
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

-- list_accessible_menus (menu lateral e RouteGuard): definição de
-- 20261008000006 + as duas CTEs de pendente. Conta por conjunto, usando o
-- índice parcial — nada de chamar menu_pendente() por tela.
CREATE OR REPLACE FUNCTION public.list_accessible_menus(_user uuid, _acao text DEFAULT 'visualizar'::text, _empresa uuid DEFAULT NULL::uuid)
 RETURNS TABLE(menu_codigo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH
  params AS (
    SELECT
      _user                  AS user_id,
      _acao::public.app_acao AS acao
    WHERE _user = auth.uid()
       OR public.can_access(auth.uid(), 'administracao', 'visualizar')
  ),
  -- SIS-2026-0931: códigos pendentes (nenhuma linha liberada) e as rotas
  -- cujas telas originais estão todas pendentes (fecham as cópias).
  pendentes AS (
    SELECT DISTINCT p.codigo
      FROM public.app_menu p
     WHERE p.liberado_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.app_menu l WHERE l.codigo = p.codigo AND l.liberado_em IS NOT NULL)
  ),
  rotas_pendentes AS (
    SELECT DISTINCT p.rota
      FROM public.app_menu p
     WHERE p.liberado_em IS NULL
       AND p.rota IS NOT NULL
       AND p.codigo NOT LIKE 'menu_lateral_copia_%'
       AND NOT EXISTS (SELECT 1 FROM public.app_menu l
                        WHERE l.rota = p.rota AND l.codigo NOT LIKE 'menu_lateral_copia_%' AND l.liberado_em IS NOT NULL)
  ),
  active_menus AS (
    SELECT am.codigo AS menu_codigo, am.concede_tudo_alcanca AS alcanca
      FROM public.app_menu   am
      JOIN public.app_modulo mo ON mo.id = am.modulo_id
     WHERE am.ativo = true
       AND am.codigo NOT IN (SELECT codigo FROM pendentes)
       AND NOT (am.codigo LIKE 'menu_lateral_copia_%' AND am.rota IN (SELECT rota FROM rotas_pendentes))
  ),
  override_resolved AS (
    SELECT DISTINCT ON (spu.menu_codigo)
           spu.menu_codigo, spu.allow
      FROM public.screen_permission_user spu
      CROSS JOIN params p
     WHERE spu.user_id = p.user_id
       AND spu.acao    = p.acao
     ORDER BY spu.menu_codigo, spu.updated_at DESC
  ),
  concede_tudo AS (
    SELECT EXISTS (
      SELECT 1
        FROM public.usuario_perfil_acesso upa
        JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true AND pa.concede_tudo = true
        CROSS JOIN params p
       WHERE upa.user_id = p.user_id
    ) AS ok
  ),
  profile_resolved AS (
    SELECT DISTINCT pap.menu_codigo
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true
      JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id AND pap.allow = true
      CROSS JOIN params p
     WHERE upa.user_id = p.user_id
       AND pap.acao    = p.acao
  )
  SELECT DISTINCT am.menu_codigo
    FROM active_menus am
    LEFT JOIN override_resolved o  ON o.menu_codigo = am.menu_codigo
    LEFT JOIN profile_resolved  pr ON pr.menu_codigo = am.menu_codigo
    CROSS JOIN concede_tudo ct
   WHERE COALESCE(o.allow, (ct.ok AND am.alcanca) OR pr.menu_codigo IS NOT NULL) IS TRUE;
$function$;

-- list_users_with_menu_access (lista "Com acesso" da Administração): é o
-- acesso EFETIVO, então tela pendente = ninguém. O que está preparado é
-- mostrado por novo_modulo_acessos().
CREATE OR REPLACE FUNCTION public.list_users_with_menu_access(_menu text, _acao text DEFAULT 'visualizar'::text)
 RETURNS TABLE(user_id uuid, allowed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH params AS (
    SELECT _acao::public.app_acao AS acao,
           public.menu_pendente(_menu) AS pendente  -- SIS-2026-0931
     WHERE public.can_access(auth.uid(), 'administracao', 'visualizar')
  ),
  override AS (
    SELECT DISTINCT ON (spu.user_id) spu.user_id, spu.allow
      FROM public.screen_permission_user spu, params p
     WHERE spu.menu_codigo = _menu AND spu.acao = p.acao
     ORDER BY spu.user_id, spu.updated_at DESC
  ),
  concede_tudo AS (
    SELECT DISTINCT upa.user_id
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true AND pa.concede_tudo = true
     WHERE public.concede_tudo_alcanca(_menu)
  ),
  profile_grant AS (
    SELECT DISTINCT upa.user_id
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true
      JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id AND pap.allow = true
      CROSS JOIN params p
     WHERE pap.menu_codigo = _menu AND pap.acao = p.acao
  )
  SELECT pr.id,
         NOT params.pendente
         AND COALESCE(o.allow, pr.id IN (SELECT user_id FROM concede_tudo) OR pr.id IN (SELECT user_id FROM profile_grant))
    FROM public.profiles pr
    CROSS JOIN params
    LEFT JOIN override o ON o.user_id = pr.id;
$function$;

-- acesso_aplicar_em_massa (Por Setor / Cargo): definição de 20261110008510
-- + recusa de tela pendente. Tela nova se configura num lugar só.
CREATE OR REPLACE FUNCTION public.acesso_aplicar_em_massa(_modelo_id uuid, _setor text, _nivel text, _linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_id        bigint;
  v_antes     jsonb;
  v_qtd       integer;
  v_usuarios  uuid[];
  v_liberadas text[];
  v_removidas text[];
  v_invalida  text;
BEGIN
  IF NOT public.can_access(v_uid, 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar acessos.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(_linhas) IS DISTINCT FROM 'array' OR jsonb_array_length(_linhas) = 0 THEN
    RAISE EXCEPTION 'Nada para aplicar.';
  END IF;
  IF jsonb_array_length(_linhas) > 20000 THEN
    RAISE EXCEPTION 'Aplicação grande demais (% linhas). Divida o grupo.', jsonb_array_length(_linhas);
  END IF;

  IF EXISTS (SELECT 1
               FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, menu_codigo text, acao public.app_acao, allow boolean)
              WHERE l.user_id IS NULL OR l.menu_codigo IS NULL OR l.acao IS NULL OR l.allow IS NULL) THEN
    RAISE EXCEPTION 'Linha incompleta na aplicação.';
  END IF;

  SELECT l.menu_codigo INTO v_invalida
    FROM jsonb_to_recordset(_linhas) AS l(menu_codigo text)
   WHERE NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = l.menu_codigo AND am.ativo)
   LIMIT 1;
  IF v_invalida IS NOT NULL THEN
    RAISE EXCEPTION 'Tela inexistente ou desligada: %', v_invalida;
  END IF;

  -- SIS-2026-0931: tela pendente só se libera em Novos Módulos.
  SELECT l.menu_codigo INTO v_invalida
    FROM (SELECT DISTINCT l.menu_codigo FROM jsonb_to_recordset(_linhas) AS l(menu_codigo text)) l
   WHERE public.menu_pendente(l.menu_codigo)
   LIMIT 1;
  IF v_invalida IS NOT NULL THEN
    RAISE EXCEPTION 'Tela aguardando liberação: % — libere em Novos Módulos.', v_invalida;
  END IF;

  IF EXISTS (SELECT 1
               FROM jsonb_to_recordset(_linhas) AS l(user_id uuid)
              WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = l.user_id)) THEN
    RAISE EXCEPTION 'Pessoa não encontrada na aplicação.';
  END IF;

  IF EXISTS (SELECT 1
               FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, allow boolean)
               JOIN public.usuario_perfil_acesso upa ON upa.user_id = l.user_id
               JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo AND pa.concede_tudo
              WHERE NOT l.allow) THEN
    RAISE EXCEPTION 'Administrador Geral não recebe remoção em massa — se for mesmo o caso, use Acesso por Usuário.';
  END IF;

  SELECT array_agg(DISTINCT l.user_id),
         coalesce(array_agg(DISTINCT l.menu_codigo) FILTER (WHERE l.allow), '{}'),
         coalesce(array_agg(DISTINCT l.menu_codigo) FILTER (WHERE NOT l.allow), '{}')
    INTO v_usuarios, v_liberadas, v_removidas
    FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, menu_codigo text, allow boolean);

  SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_antes
    FROM public.screen_permission_user s
    JOIN (SELECT DISTINCT l.user_id, l.menu_codigo, l.acao
            FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, menu_codigo text, acao public.app_acao)) l
      ON l.user_id = s.user_id AND l.menu_codigo = s.menu_codigo AND l.acao = s.acao
   WHERE s.empresa_id IS NULL;

  INSERT INTO public."ACESSO_APLICACAO_MASSA" (modelo_id, setor, nivel, usuarios, liberadas, removidas, antes, aplicado_por)
  VALUES (_modelo_id, _setor, NULLIF(_nivel, ''), v_usuarios, v_liberadas, v_removidas, v_antes, v_uid)
  RETURNING id INTO v_id;

  DELETE FROM public.screen_permission_user s
   USING (SELECT DISTINCT l.user_id, l.menu_codigo, l.acao
            FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, menu_codigo text, acao public.app_acao)) l
   WHERE s.user_id = l.user_id AND s.menu_codigo = l.menu_codigo AND s.acao = l.acao
     AND s.empresa_id IS NULL;

  INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo, created_by)
  SELECT DISTINCT ON (l.user_id, l.menu_codigo, l.acao)
         l.user_id, l.menu_codigo, l.acao, l.allow, NULL,
         format('Em massa #%s: %s · %s', v_id, coalesce(_setor, '—'), coalesce(NULLIF(_nivel, ''), 'todos os níveis')),
         v_uid
    FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, menu_codigo text, acao public.app_acao, allow boolean)
   ORDER BY l.user_id, l.menu_codigo, l.acao;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;

  UPDATE public."ACESSO_APLICACAO_MASSA" SET linhas = v_qtd WHERE id = v_id;

  RETURN jsonb_build_object('id', v_id, 'linhas', v_qtd, 'pessoas', coalesce(cardinality(v_usuarios), 0));
END;
$$;

-- ── 6) Histórico ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."MENU_LIBERACAO_HISTORICO" (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  menu_codigo        text NOT NULL,
  menu_nome          text,
  evento             text NOT NULL CHECK (evento IN ('liberado', 'acessos_alterados', 'bloqueado')),
  adicionados        uuid[] NOT NULL DEFAULT '{}',
  removidos          uuid[] NOT NULL DEFAULT '{}',
  perfis_removidos   jsonb NOT NULL DEFAULT '[]'::jsonb,
  setores            text[] NOT NULL DEFAULT '{}',
  cargos             text[] NOT NULL DEFAULT '{}',
  -- Linhas de screen_permission_user/perfil_acesso_permissao e a situação
  -- de antes: é o que permite desfazer à mão.
  antes              jsonb NOT NULL DEFAULT '{}'::jsonb,
  pessoas_com_acesso integer NOT NULL DEFAULT 0,
  feito_por          uuid DEFAULT auth.uid(),
  feito_em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_liberacao_historico_menu
  ON public."MENU_LIBERACAO_HISTORICO" (menu_codigo, feito_em DESC);
COMMENT ON TABLE public."MENU_LIBERACAO_HISTORICO" IS
  'SIS-2026-0931: quem liberou, alterou ou bloqueou cada tela em Novos Módulos, e quando. Gravada só por novo_modulo_salvar/novo_modulo_bloquear.';

ALTER TABLE public."MENU_LIBERACAO_HISTORICO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS menu_liberacao_historico_select ON public."MENU_LIBERACAO_HISTORICO";
CREATE POLICY menu_liberacao_historico_select ON public."MENU_LIBERACAO_HISTORICO" FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'administracao', 'visualizar')));
REVOKE ALL ON public."MENU_LIBERACAO_HISTORICO" FROM anon;
GRANT SELECT ON public."MENU_LIBERACAO_HISTORICO" TO authenticated;

-- ── 7) RPCs da aba Novos Módulos ─────────────────────────────────────────
-- Quais telas a aba mostra: as pendentes + as nascidas desde 08/10/2026
-- (concede_tudo_alcanca = false). Cópias do menu lateral nunca; a própria
-- chave de liberar (seção 4b) também nunca.
CREATE OR REPLACE FUNCTION public.novo_modulo_gerido(_menu text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _menu NOT LIKE 'menu_lateral_copia_%'
     AND _menu <> 'administracao_novos_modulos'
     AND EXISTS (SELECT 1 FROM public.app_menu am
                  WHERE am.codigo = _menu
                    AND (am.liberado_em IS NULL OR am.concede_tudo_alcanca = false))
$$;
REVOKE ALL ON FUNCTION public.novo_modulo_gerido(text) FROM PUBLIC, anon;

-- Uma chamada só para a tabela inteira (guardião D7: nada de RPC por linha).
-- "pessoas_com_acesso" é quem passa a ver quando a tela estiver liberada:
-- exceção individual allow=true + membros de perfis com a tela, menos quem
-- tem allow=false próprio. Com a tela pendente, isso é o "preparado".
CREATE OR REPLACE FUNCTION public.novos_modulos_listar()
RETURNS TABLE (
  codigo text, nome text, rota text, modulo_codigo text, modulo_nome text,
  modulo_novo boolean, tipo text, ativo boolean, criado_em timestamptz,
  situacao text, liberado_em timestamptz, liberado_por_nome text,
  pessoas_individuais integer, perfis integer, pessoas_com_acesso integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH telas AS (
    SELECT DISTINCT ON (am.codigo)
           am.codigo, am.nome, am.rota, am.ativo, am.created_at, am.modulo_id
      FROM public.app_menu am
     WHERE am.codigo NOT LIKE 'menu_lateral_copia_%'
       AND am.codigo <> 'administracao_novos_modulos'
       AND (am.liberado_em IS NULL OR am.concede_tudo_alcanca = false)
     ORDER BY am.codigo, am.ativo DESC, am.created_at DESC
  ),
  sit AS (
    SELECT t.codigo,
           public.menu_pendente(t.codigo) AS pendente,
           max(am.liberado_em) AS lib_em,
           (array_agg(am.liberado_por ORDER BY am.liberado_em DESC NULLS LAST))[1] AS lib_por
      FROM telas t
      JOIN public.app_menu am ON am.codigo = t.codigo
     GROUP BY t.codigo
  ),
  ind AS (
    SELECT DISTINCT ON (spu.menu_codigo, spu.user_id) spu.menu_codigo, spu.user_id, spu.allow
      FROM public.screen_permission_user spu
     WHERE spu.acao = 'visualizar'::public.app_acao
       AND spu.menu_codigo IN (SELECT t.codigo FROM telas t)
     ORDER BY spu.menu_codigo, spu.user_id, spu.updated_at DESC
  ),
  per AS (
    SELECT DISTINCT pap.menu_codigo, pap.perfil_id
      FROM public.perfil_acesso_permissao pap
      JOIN public.perfil_acesso pa ON pa.id = pap.perfil_id AND pa.ativo
     WHERE pap.acao = 'visualizar'::public.app_acao AND pap.allow
       AND pap.menu_codigo IN (SELECT t.codigo FROM telas t)
  ),
  efetivo AS (
    SELECT i.menu_codigo, i.user_id FROM ind i WHERE i.allow
    UNION
    SELECT per.menu_codigo, upa.user_id
      FROM per
      JOIN public.usuario_perfil_acesso upa ON upa.perfil_id = per.perfil_id
     WHERE NOT EXISTS (SELECT 1 FROM ind i
                        WHERE i.menu_codigo = per.menu_codigo AND i.user_id = upa.user_id AND NOT i.allow)
  ),
  -- Login de demitido não conta (has_screen_access também o recusa). Uma
  -- chamada por pessoa, não por par pessoa × tela.
  logins_ativos AS (
    SELECT p.id FROM public.profiles p WHERE NOT public.erp_login_bloqueado(p.id)
  ),
  contagem AS (
    SELECT e.menu_codigo, count(*)::integer AS qtd
      FROM efetivo e
      JOIN logins_ativos la ON la.id = e.user_id
     GROUP BY e.menu_codigo
  ),
  mod_novo AS (
    SELECT mo.id,
           NOT EXISTS (SELECT 1 FROM public.app_menu velho
                        WHERE velho.modulo_id = mo.id
                          AND velho.concede_tudo_alcanca
                          AND velho.liberado_em IS NOT NULL
                          AND velho.codigo NOT LIKE 'menu_lateral_copia_%') AS novo
      FROM public.app_modulo mo
  )
  SELECT t.codigo, t.nome, t.rota, mo.codigo, mo.nome,
         coalesce(mn.novo, false),
         CASE WHEN t.rota IS NULL THEN 'acao'
              WHEN coalesce(mn.novo, false) THEN 'modulo'
              ELSE 'submodulo' END,
         t.ativo, t.created_at,
         CASE WHEN s.pendente THEN 'pendente'
              WHEN s.lib_por IS NULL THEN 'liberado_antes'
              ELSE 'liberado' END,
         CASE WHEN s.pendente THEN NULL ELSE s.lib_em END,
         CASE WHEN s.pendente THEN NULL ELSE lp.display_name END,
         (SELECT count(*)::integer FROM ind i WHERE i.menu_codigo = t.codigo AND i.allow),
         (SELECT count(*)::integer FROM per WHERE per.menu_codigo = t.codigo),
         coalesce(c.qtd, 0)
    FROM telas t
    JOIN sit s ON s.codigo = t.codigo
    LEFT JOIN public.app_modulo mo ON mo.id = t.modulo_id
    LEFT JOIN mod_novo mn ON mn.id = t.modulo_id
    LEFT JOIN public.profiles lp ON lp.id = s.lib_por
    LEFT JOIN contagem c ON c.menu_codigo = t.codigo
   ORDER BY s.pendente DESC, t.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.novos_modulos_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.novos_modulos_listar() TO authenticated;

-- O que está gravado para a tela, valendo ou não: base do pré-marcado.
CREATE OR REPLACE FUNCTION public.novo_modulo_acessos(_menu text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_individuais jsonb;
  v_perfis jsonb;
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', i.user_id, 'allow', i.allow)), '[]'::jsonb)
    INTO v_individuais
    FROM (SELECT DISTINCT ON (spu.user_id) spu.user_id, spu.allow
            FROM public.screen_permission_user spu
           WHERE spu.menu_codigo = _menu AND spu.acao = 'visualizar'::public.app_acao
           ORDER BY spu.user_id, spu.updated_at DESC) i;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', pa.id,
           'nome', pa.nome,
           'pessoas', coalesce((SELECT jsonb_agg(upa.user_id) FROM public.usuario_perfil_acesso upa WHERE upa.perfil_id = pa.id), '[]'::jsonb)
         ) ORDER BY pa.nome), '[]'::jsonb)
    INTO v_perfis
    FROM public.perfil_acesso pa
   WHERE pa.ativo
     AND EXISTS (SELECT 1 FROM public.perfil_acesso_permissao pap
                  WHERE pap.perfil_id = pa.id AND pap.menu_codigo = _menu
                    AND pap.acao = 'visualizar'::public.app_acao AND pap.allow);

  RETURN jsonb_build_object(
    'pendente', public.menu_pendente(_menu),
    'individuais', v_individuais,
    'perfis', v_perfis
  );
END;
$$;
REVOKE ALL ON FUNCTION public.novo_modulo_acessos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.novo_modulo_acessos(text) TO authenticated;

-- Quem passa a ver a tela, contado do que está gravado agora (mesma conta
-- de novos_modulos_listar, para uma tela só).
CREATE OR REPLACE FUNCTION public.novo_modulo_contar_acesso(_menu text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ind AS (
    SELECT DISTINCT ON (spu.user_id) spu.user_id, spu.allow
      FROM public.screen_permission_user spu
     WHERE spu.menu_codigo = _menu AND spu.acao = 'visualizar'::public.app_acao
     ORDER BY spu.user_id, spu.updated_at DESC
  ),
  efetivo AS (
    SELECT i.user_id FROM ind i WHERE i.allow
    UNION
    SELECT upa.user_id
      FROM public.perfil_acesso_permissao pap
      JOIN public.perfil_acesso pa ON pa.id = pap.perfil_id AND pa.ativo
      JOIN public.usuario_perfil_acesso upa ON upa.perfil_id = pa.id
     WHERE pap.menu_codigo = _menu AND pap.acao = 'visualizar'::public.app_acao AND pap.allow
       AND NOT EXISTS (SELECT 1 FROM ind i WHERE i.user_id = upa.user_id AND NOT i.allow)
  )
  SELECT count(*)::integer
    FROM efetivo e
    JOIN public.profiles p ON p.id = e.user_id
   WHERE NOT public.erp_login_bloqueado(e.user_id)
$$;
REVOKE ALL ON FUNCTION public.novo_modulo_contar_acesso(text) FROM PUBLIC, anon;

-- Salvar no modal. _linhas = [{user_id, menu_codigo, acao, allow}], montadas
-- no front por acoesGravadasPeloToggle (mesmo pacote do switch). Tudo ou
-- nada. Com ≥1 pessoa vendo a tela no fim, ela é LIBERADA; com 0, fica (ou
-- volta a ficar) pendente.
CREATE OR REPLACE FUNCTION public.novo_modulo_salvar(
  _menu text,
  _linhas jsonb,
  _perfis_remover uuid[] DEFAULT '{}',
  _setores text[] DEFAULT '{}',
  _cargos text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_id        bigint;
  v_nome      text;
  v_pendente  boolean;
  v_lib_por   uuid;
  v_antes     jsonb;
  v_add       uuid[];
  v_rem       uuid[];
  v_perfis    jsonb;
  v_qtd       integer;
  v_evento    text;
  v_situacao  text;
BEGIN
  -- Permissão própria (seção 4b), não "administracao": só quem libera telas novas.
  IF NOT public.can_access(v_uid, 'administracao_novos_modulos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para liberar telas novas.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.novo_modulo_gerido(_menu) THEN
    RAISE EXCEPTION 'A tela % não é gerida em Novos Módulos.', _menu;
  END IF;

  _linhas := coalesce(_linhas, '[]'::jsonb);
  IF jsonb_typeof(_linhas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Formato inválido das permissões.';
  END IF;
  IF jsonb_array_length(_linhas) > 20000 THEN
    RAISE EXCEPTION 'Liberação grande demais (% linhas).', jsonb_array_length(_linhas);
  END IF;
  IF EXISTS (SELECT 1
               FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, menu_codigo text, acao public.app_acao, allow boolean)
              WHERE l.user_id IS NULL OR l.menu_codigo IS NULL OR l.acao IS NULL OR l.allow IS NULL) THEN
    RAISE EXCEPTION 'Linha incompleta na liberação.';
  END IF;
  -- Liberar um submódulo não libera outro: só passa linha DESTA tela.
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(_linhas) AS l(menu_codigo text) WHERE l.menu_codigo <> _menu) THEN
    RAISE EXCEPTION 'Esta liberação só grava a tela %; linhas de outra tela foram recusadas.', _menu;
  END IF;
  IF EXISTS (SELECT 1
               FROM jsonb_to_recordset(_linhas) AS l(user_id uuid)
              WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = l.user_id)) THEN
    RAISE EXCEPTION 'Pessoa não encontrada na liberação.';
  END IF;

  SELECT am.nome INTO v_nome
    FROM public.app_menu am
   WHERE am.codigo = _menu
   ORDER BY am.ativo DESC, am.created_at DESC
   LIMIT 1;
  v_pendente := public.menu_pendente(_menu);
  SELECT (array_agg(am.liberado_por ORDER BY am.liberado_em DESC NULLS LAST))[1] INTO v_lib_por
    FROM public.app_menu am WHERE am.codigo = _menu;

  SELECT coalesce(array_agg(DISTINCT l.user_id) FILTER (WHERE l.allow), '{}'),
         coalesce(array_agg(DISTINCT l.user_id) FILTER (WHERE NOT l.allow), '{}')
    INTO v_add, v_rem
    FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, allow boolean);

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', pa.id, 'nome', pa.nome)), '[]'::jsonb)
    INTO v_perfis
    FROM public.perfil_acesso pa
   WHERE pa.id = ANY (coalesce(_perfis_remover, '{}'))
     AND EXISTS (SELECT 1 FROM public.perfil_acesso_permissao pap WHERE pap.perfil_id = pa.id AND pap.menu_codigo = _menu);

  SELECT jsonb_build_object(
           'pendente', v_pendente,
           'liberado_em', (SELECT max(am.liberado_em) FROM public.app_menu am WHERE am.codigo = _menu),
           'liberado_por', v_lib_por,
           'screen_permission_user', coalesce((
             SELECT jsonb_agg(to_jsonb(s))
               FROM public.screen_permission_user s
               JOIN (SELECT DISTINCT l.user_id, l.acao
                       FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, acao public.app_acao)) l
                 ON l.user_id = s.user_id AND l.acao = s.acao
              WHERE s.menu_codigo = _menu AND s.empresa_id IS NULL), '[]'::jsonb),
           'perfil_acesso_permissao', coalesce((
             SELECT jsonb_agg(to_jsonb(p))
               FROM public.perfil_acesso_permissao p
              WHERE p.menu_codigo = _menu AND p.perfil_id = ANY (coalesce(_perfis_remover, '{}'))), '[]'::jsonb),
           'copias', coalesce((
             SELECT jsonb_agg(to_jsonb(s))
               FROM public.screen_permission_user s
               JOIN public.app_menu copia ON copia.codigo = s.menu_codigo AND copia.codigo LIKE 'menu_lateral_copia_%'
               JOIN public.app_menu origem ON origem.rota = copia.rota AND origem.codigo = _menu
              WHERE s.user_id = ANY (v_rem)), '[]'::jsonb)
         ) INTO v_antes;

  INSERT INTO public."MENU_LIBERACAO_HISTORICO"
         (menu_codigo, menu_nome, evento, adicionados, removidos, perfis_removidos, setores, cargos, antes, feito_por)
  VALUES (_menu, v_nome, 'acessos_alterados', v_add, v_rem, v_perfis,
          coalesce(_setores, '{}'), coalesce(_cargos, '{}'), v_antes, v_uid)
  RETURNING id INTO v_id;

  DELETE FROM public.screen_permission_user s
   USING (SELECT DISTINCT l.user_id, l.acao
            FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, acao public.app_acao)) l
   WHERE s.user_id = l.user_id AND s.menu_codigo = _menu AND s.acao = l.acao
     AND s.empresa_id IS NULL;

  INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo, created_by)
  SELECT DISTINCT ON (l.user_id, l.acao)
         l.user_id, _menu, l.acao, l.allow, NULL, format('Novos Módulos #%s', v_id), v_uid
    FROM jsonb_to_recordset(_linhas) AS l(user_id uuid, acao public.app_acao, allow boolean)
   ORDER BY l.user_id, l.acao;

  DELETE FROM public.perfil_acesso_permissao pap
   WHERE pap.menu_codigo = _menu
     AND pap.perfil_id = ANY (coalesce(_perfis_remover, '{}'));

  -- Quem saiu perde também as cópias desta tela no menu lateral. A cópia
  -- criada enquanto a tela estava pendente herdou o acesso preparado
  -- (menu_lateral_sincronizar_copias, SIS-2026-0837) e, sem isto, viraria
  -- porta lateral depois da liberação: o admin desmarca a pessoa e ela
  -- continua entrando pela cópia. Provado no PostgreSQL 18 local, 17/11/2026.
  DELETE FROM public.screen_permission_user s
   USING public.app_menu copia, public.app_menu origem
   WHERE origem.codigo = _menu
     AND origem.rota IS NOT NULL
     AND copia.rota = origem.rota
     AND copia.codigo LIKE 'menu_lateral_copia_%'
     AND s.menu_codigo = copia.codigo
     AND s.user_id = ANY (v_rem);

  v_qtd := public.novo_modulo_contar_acesso(_menu);

  PERFORM set_config('erp.liberacao_novos_modulos', 'on', true);
  IF v_qtd > 0 THEN
    -- Primeira liberação (ou revisão de uma liberada "antes do controle"):
    -- registra quem e quando. Edição de uma já liberada mantém a data.
    IF v_pendente OR v_lib_por IS NULL THEN
      UPDATE public.app_menu SET liberado_em = now(), liberado_por = v_uid WHERE codigo = _menu;
    END IF;
    v_evento := CASE WHEN v_pendente THEN 'liberado' ELSE 'acessos_alterados' END;
    v_situacao := 'liberado';
  ELSE
    UPDATE public.app_menu SET liberado_em = NULL, liberado_por = NULL WHERE codigo = _menu;
    v_evento := CASE WHEN v_pendente THEN 'acessos_alterados' ELSE 'bloqueado' END;
    v_situacao := 'pendente';
  END IF;
  PERFORM set_config('erp.liberacao_novos_modulos', 'off', true);

  UPDATE public."MENU_LIBERACAO_HISTORICO" SET evento = v_evento, pessoas_com_acesso = v_qtd WHERE id = v_id;

  RETURN jsonb_build_object('id', v_id, 'situacao', v_situacao, 'pessoas', v_qtd, 'evento', v_evento);
END;
$$;
REVOKE ALL ON FUNCTION public.novo_modulo_salvar(text, jsonb, uuid[], text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.novo_modulo_salvar(text, jsonb, uuid[], text[], text[]) TO authenticated;

-- "Revogar todos os acessos": fecha a tela para todo mundo. As linhas ficam
-- (voltam a ser "preparadas" e aparecem pré-marcadas se reabrir) — nada de
-- allow=false em massa (J1.B).
CREATE OR REPLACE FUNCTION public.novo_modulo_bloquear(_menu text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_id   bigint;
  v_nome text;
BEGIN
  IF NOT public.can_access(v_uid, 'administracao_novos_modulos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para bloquear telas novas.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.novo_modulo_gerido(_menu) THEN
    RAISE EXCEPTION 'A tela % não é gerida em Novos Módulos.', _menu;
  END IF;
  IF public.menu_pendente(_menu) THEN
    RETURN jsonb_build_object('situacao', 'pendente', 'id', NULL);
  END IF;

  SELECT am.nome INTO v_nome
    FROM public.app_menu am WHERE am.codigo = _menu
   ORDER BY am.ativo DESC, am.created_at DESC LIMIT 1;

  INSERT INTO public."MENU_LIBERACAO_HISTORICO" (menu_codigo, menu_nome, evento, antes, feito_por)
  SELECT _menu, v_nome, 'bloqueado',
         jsonb_build_object('liberado_em', max(am.liberado_em),
                            'liberado_por', (array_agg(am.liberado_por ORDER BY am.liberado_em DESC NULLS LAST))[1],
                            'pessoas_com_acesso', public.novo_modulo_contar_acesso(_menu)),
         v_uid
    FROM public.app_menu am WHERE am.codigo = _menu
  RETURNING id INTO v_id;

  PERFORM set_config('erp.liberacao_novos_modulos', 'on', true);
  UPDATE public.app_menu SET liberado_em = NULL, liberado_por = NULL WHERE codigo = _menu;
  PERFORM set_config('erp.liberacao_novos_modulos', 'off', true);

  RETURN jsonb_build_object('situacao', 'pendente', 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.novo_modulo_bloquear(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.novo_modulo_bloquear(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar has_screen_access de 20261115130000, list_accessible_menus e
--   list_users_with_menu_access de 20261008000006 e acesso_aplicar_em_massa de
--   20261110008510 (são estas mesmas sem os trechos marcados "SIS-2026-0931");
-- DROP FUNCTION IF EXISTS public.novo_modulo_bloquear(text);
-- DROP FUNCTION IF EXISTS public.novo_modulo_salvar(text, jsonb, uuid[], text[], text[]);
-- DROP FUNCTION IF EXISTS public.novo_modulo_contar_acesso(text);
-- DROP FUNCTION IF EXISTS public.novo_modulo_acessos(text);
-- DROP FUNCTION IF EXISTS public.novos_modulos_listar();
-- DROP FUNCTION IF EXISTS public.novo_modulo_gerido(text);
-- DROP TABLE IF EXISTS public."MENU_LIBERACAO_HISTORICO";
-- DROP TRIGGER IF EXISTS trg_pap_novos_modulos_so_de_quem_libera ON public.perfil_acesso_permissao;
-- DROP TRIGGER IF EXISTS trg_spu_novos_modulos_so_de_quem_libera ON public.screen_permission_user;
-- DROP FUNCTION IF EXISTS public.novos_modulos_permissao_so_de_quem_libera();
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'administracao_novos_modulos';
-- DELETE FROM public.app_menu WHERE codigo = 'administracao_novos_modulos';
-- DROP TRIGGER IF EXISTS trg_app_menu_liberacao_so_pela_tela ON public.app_menu;
-- DROP FUNCTION IF EXISTS public.app_menu_liberacao_so_pela_tela();
-- DROP TRIGGER IF EXISTS trg_app_menu_nasce_pendente ON public.app_menu;
-- DROP FUNCTION IF EXISTS public.app_menu_nasce_pendente();
-- DROP FUNCTION IF EXISTS public.menu_pendente(text);
-- DROP INDEX IF EXISTS public.app_menu_pendente_codigo_idx;
-- ALTER TABLE public.app_menu DROP COLUMN IF EXISTS liberado_por, DROP COLUMN IF EXISTS liberado_em;
