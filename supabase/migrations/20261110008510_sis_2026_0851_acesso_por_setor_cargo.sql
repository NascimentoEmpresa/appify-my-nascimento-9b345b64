-- =========================================================================
-- SIS-2026-0851 — LIBERAÇÃO DE ACESSO EM MASSA POR SETOR E CARGO (10/11/2026)
--
-- PEDIDO (Iury, Gerente de Sistemas): "fazer liberações de acesso por setor
-- ou por cargo, pois hoje ela está individual (...) pessoas do mesmo setor
-- com o mesmo cargo possam ter acesso às mesmas telas fazendo essa liberação
-- em massa". Protótipo anexado ao chamado: "Mapa do ERP › Permissões de
-- acesso" (matriz por setor e por cargo).
--
-- PARTE 1 — CARGO VIRA LISTA ("CARGO_CATALOGO")
--   profiles.cargo era texto livre: 47 grafias para 161 pessoas, com erro de
--   digitação ("encaregado", "CONTABIIDADE") e a mesma função escrita de dois
--   jeitos ("Supervisor" / "SUPERVISOR"). Agrupar gente por ele não dava.
--   Agora o cargo sai de um catálogo, e cada cargo tem um NÍVEL (presidente,
--   diretor, gerente, supervisor, adm, aprendiz) — é o nível que agrupa as
--   pessoas na liberação em massa. Mantido em Configurações do ERP › Cargos.
--
--   ACHADO DE SEGURANÇA, fechado aqui: profiles_block_self_escalation
--   (mig 20260809000018) não protege `cargo` — a coluna só nasceu depois, na
--   20260818000001 — e a policy profiles_self_update deixa a pessoa editar o
--   próprio perfil. Só que malote_supervisor_por_cargo (ainda chamada pelas
--   policies do Malote, mig 20261103004200) dá poder de supervisor a quem tem
--   cargo 'PRESIDENTE' ou com DIRETOR/CONTROLADORIA/SISTEMAS no nome: qualquer
--   usuário podia se promover pela API. Agora só a administração troca cargo
--   (trg_profiles_cargo_so_admin).
--
-- PARTE 2 — MODELOS POR SETOR/NÍVEL E APLICAÇÃO EM MASSA
--   Setor e nível só ESCOLHEM AS PESSOAS. A permissão continua gravada por
--   pessoa em screen_permission_user, igual ao switch de "Acesso por Usuário"
--   — has_screen_access, can_access, list_accessible_menus,
--   list_users_with_menu_access e tem_acesso_menu NÃO mudam. Por quê:
--     1. cargo não pode decidir acesso (REGRAS-PR J1.F, README);
--     2. as 8.283 linhas allow=false individuais (10/11/2026) venceriam
--        qualquer regra por setor (J1.B): o admin marcaria o setor e a
--        pessoa continuaria sem ver a tela, sem nada que explicasse.
--   O "pacote" de ações que cada tela concede continua num lugar só
--   (src/lib/acoesDoToggleAcesso.ts): o front monta as linhas e a RPC só
--   valida e grava, tudo ou nada.
--
-- Idempotente. Aplica sozinha no merge (cluster_pos_merge.yml).
-- =========================================================================

-- ── 1) Catálogo de cargos ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CARGO_CATALOGO" (
  nome       text PRIMARY KEY CHECK (nome = btrim(nome) AND nome <> ''),
  nivel      text NOT NULL DEFAULT 'adm'
             CHECK (nivel IN ('presidente', 'diretor', 'gerente', 'supervisor', 'adm', 'aprendiz')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
COMMENT ON TABLE public."CARGO_CATALOGO" IS
  'SIS-2026-0851: cargos que podem ir em profiles.cargo (FK, ON UPDATE CASCADE). O nível agrupa pessoas na liberação em massa por Setor/Cargo; é descritivo — nenhuma função de acesso lê esta tabela.';

-- ── 2) Carga inicial: os cargos de hoje, limpos ──────────────────────────
-- Limpeza mecânica só: espaço, maiúscula e os dois erros de digitação
-- óbvios. Variações de verdade (ENCARREGADA × ENCARREGADO, JOVEM APRENDIZ ×
-- APRENDIZ) ficam para o Iury juntar na aba Cargos, se quiser — não é
-- decisão de migration. A mesma regra mora em limparNomeCargo() e
-- sugerirNivelPorCargo() (src/lib/acessoPorSetorCargo.ts), que é o que a tela
-- usa daqui em diante.
CREATE TEMP TABLE _cargo_mapa ON COMMIT DROP AS
SELECT original,
       CASE limpo
         WHEN 'ENCAREGADO'   THEN 'ENCARREGADO'
         WHEN 'CONTABIIDADE' THEN 'CONTABILIDADE'
         ELSE limpo
       END AS nome
  FROM (
    SELECT DISTINCT p.cargo AS original,
           NULLIF(upper(btrim(regexp_replace(p.cargo, '\s+', ' ', 'g'))), '') AS limpo
      FROM public.profiles p
     WHERE p.cargo IS NOT NULL
  ) s;

INSERT INTO public."CARGO_CATALOGO" (nome, nivel)
SELECT DISTINCT m.nome,
       CASE
         WHEN m.nome LIKE '%PRESIDENTE%' THEN 'presidente'
         WHEN m.nome LIKE '%DIRETOR%'    THEN 'diretor'
         WHEN m.nome LIKE '%GERENTE%'    THEN 'gerente'
         WHEN m.nome LIKE '%SUPERVISOR%' THEN 'supervisor'
         WHEN m.nome LIKE '%APRENDIZ%'   THEN 'aprendiz'
         ELSE 'adm'
       END
  FROM _cargo_mapa m
 WHERE m.nome IS NOT NULL
ON CONFLICT (nome) DO NOTHING;

-- O Malote decide supervisor pelo TEXTO do cargo (malote_supervisor_por_cargo,
-- malote_gerente_financeiro). A limpeza não pode mudar quem casa: maiúscula
-- não muda ILIKE, 'PRESIDENTE' já estava assim e as duas correções não tocam
-- essas palavras. Fica registrado no log da aplicação (NOTICE, não trava).
DO $$
DECLARE
  v_antes  integer;
  v_depois integer;
BEGIN
  SELECT count(*) FILTER (WHERE p.cargo ILIKE '%CONTROLADORIA%' OR p.cargo ILIKE '%DIRETOR%'
                             OR p.cargo ILIKE '%SISTEMAS%' OR p.cargo = 'PRESIDENTE'
                             OR p.cargo ILIKE '%GERENTE FINANCEIRO%'),
         count(*) FILTER (WHERE m.nome ILIKE '%CONTROLADORIA%' OR m.nome ILIKE '%DIRETOR%'
                             OR m.nome ILIKE '%SISTEMAS%' OR m.nome = 'PRESIDENTE'
                             OR m.nome ILIKE '%GERENTE FINANCEIRO%')
    INTO v_antes, v_depois
    FROM public.profiles p
    JOIN _cargo_mapa m ON m.original = p.cargo;
  RAISE NOTICE 'SIS-2026-0851: pessoas que o Malote reconhece pelo cargo — antes %, depois %', v_antes, v_depois;
END $$;

-- ── 3) Pessoas passam a apontar para o nome limpo ────────────────────────
-- a_trg_profiles_block_self_escalation recusa UPDATE sem sessão ("sessão
-- ausente") e só deixa passar quando o papel efetivo é service_role. Em vez
-- do DISABLE TRIGGER da 20260818000001 (que trava profiles, a tabela mais
-- lida do ERP), a migration se identifica como service_role — set_config com
-- is_local = true, vale só dentro desta transação.
SELECT set_config('request.jwt.claim.role', 'service_role', true);

UPDATE public.profiles p
   SET cargo = m.nome
  FROM _cargo_mapa m
 WHERE p.cargo = m.original
   AND p.cargo IS DISTINCT FROM m.nome;

SELECT set_config('request.jwt.claim.role', '', true);

-- ── 4) profiles.cargo só aceita cargo do catálogo ────────────────────────
-- ON UPDATE CASCADE: renomear o cargo na aba Cargos atualiza as pessoas.
-- ON DELETE RESTRICT: cargo em uso não some — junta-se a outro primeiro.
CREATE INDEX IF NOT EXISTS idx_profiles_cargo ON public.profiles (cargo);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'profiles_cargo_fkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_cargo_fkey FOREIGN KEY (cargo)
      REFERENCES public."CARGO_CATALOGO" (nome) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 5) Só a administração troca cargo ────────────────────────────────────
-- Gatilho próprio em vez de mexer no profiles_block_self_escalation: a
-- versão viva daquela função pode não ser a do repositório, e reescrevê-la
-- inteira para acrescentar uma linha arriscaria desfazer o que mudou lá.
-- Sem sessão (migration, service_role, Edge Function admin-create-user)
-- passa — quem chega sem sessão não passa pela RLS de profiles mesmo.
CREATE OR REPLACE FUNCTION public.profiles_cargo_so_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.cargo IS DISTINCT FROM OLD.cargo
     AND auth.uid() IS NOT NULL
     AND NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Só a administração troca o cargo (Configurações do ERP › Usuários).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.profiles_cargo_so_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_cargo_so_admin ON public.profiles;
CREATE TRIGGER trg_profiles_cargo_so_admin
  BEFORE UPDATE OF cargo ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_cargo_so_admin();

-- ── 6) RLS do catálogo + juntar dois cargos ──────────────────────────────
ALTER TABLE public."CARGO_CATALOGO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cargo_catalogo_select ON public."CARGO_CATALOGO";
CREATE POLICY cargo_catalogo_select ON public."CARGO_CATALOGO" FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'administracao', 'visualizar')));

DROP POLICY IF EXISTS cargo_catalogo_insert ON public."CARGO_CATALOGO";
CREATE POLICY cargo_catalogo_insert ON public."CARGO_CATALOGO" FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'administracao', 'alterar')));

DROP POLICY IF EXISTS cargo_catalogo_update ON public."CARGO_CATALOGO";
CREATE POLICY cargo_catalogo_update ON public."CARGO_CATALOGO" FOR UPDATE TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'administracao', 'alterar')))
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'administracao', 'alterar')));

DROP POLICY IF EXISTS cargo_catalogo_delete ON public."CARGO_CATALOGO";
CREATE POLICY cargo_catalogo_delete ON public."CARGO_CATALOGO" FOR DELETE TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'administracao', 'alterar')));

REVOKE ALL ON public."CARGO_CATALOGO" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CARGO_CATALOGO" TO authenticated;

-- Juntar = mover as pessoas de um cargo para outro e apagar o de origem,
-- numa transação só (pela tela seriam dois passos, e o primeiro sem o
-- segundo deixaria um cargo vazio pendurado).
CREATE OR REPLACE FUNCTION public.cargo_juntar(_origem text, _destino text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_qtd integer;
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar cargos.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _origem IS NULL OR _destino IS NULL OR _origem = _destino THEN
    RAISE EXCEPTION 'Escolha dois cargos diferentes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."CARGO_CATALOGO" WHERE nome = _origem)
     OR NOT EXISTS (SELECT 1 FROM public."CARGO_CATALOGO" WHERE nome = _destino) THEN
    RAISE EXCEPTION 'Cargo não encontrado.';
  END IF;

  UPDATE public.profiles SET cargo = _destino WHERE cargo = _origem;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  DELETE FROM public."CARGO_CATALOGO" WHERE nome = _origem;
  RETURN v_qtd;
END;
$$;
REVOKE ALL ON FUNCTION public.cargo_juntar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cargo_juntar(text, text) TO authenticated;

-- ── 7) Modelo de acesso de um grupo (setor + nível) ──────────────────────
-- nivel NULL = todos os níveis do setor. A pessoa recebe a SOMA do modelo
-- "setor · todos" com o do nível dela (protótipo usava interseção; somar
-- evita o "marquei no cargo e não apareceu porque faltou no setor").
CREATE TABLE IF NOT EXISTS public."ACESSO_MODELO" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setor      text NOT NULL REFERENCES public.setor_catalogo (nome) ON UPDATE CASCADE ON DELETE CASCADE,
  nivel      text CHECK (nivel IS NULL OR nivel IN ('presidente', 'diretor', 'gerente', 'supervisor', 'adm', 'aprendiz')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS acesso_modelo_setor_nivel_uidx
  ON public."ACESSO_MODELO" (setor, nivel) NULLS NOT DISTINCT;
COMMENT ON TABLE public."ACESSO_MODELO" IS
  'SIS-2026-0851: telas-padrão de um grupo (setor + nível; nível NULL = o setor inteiro). Não concede nada sozinho: só vira acesso quando aplicado (acesso_aplicar_em_massa), que grava por pessoa em screen_permission_user.';

-- 8) As telas do modelo. Sem FK para app_menu: codigo só é único por módulo
-- (J1.D). A existência é conferida ao salvar e, ativa, ao aplicar.
CREATE TABLE IF NOT EXISTS public."ACESSO_MODELO_TELA" (
  modelo_id   uuid NOT NULL REFERENCES public."ACESSO_MODELO" (id) ON DELETE CASCADE,
  menu_codigo text NOT NULL,
  PRIMARY KEY (modelo_id, menu_codigo)
);

-- 9) Histórico de cada aplicação. `antes` guarda as linhas de
-- screen_permission_user que existiam nas (pessoa, tela, ação) tocadas —
-- é o que permite desfazer depois.
CREATE TABLE IF NOT EXISTS public."ACESSO_APLICACAO_MASSA" (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  modelo_id    uuid REFERENCES public."ACESSO_MODELO" (id) ON DELETE SET NULL,
  setor        text,
  nivel        text,
  usuarios     uuid[] NOT NULL,
  liberadas    text[] NOT NULL DEFAULT '{}',
  removidas    text[] NOT NULL DEFAULT '{}',
  linhas       integer NOT NULL DEFAULT 0,
  antes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  aplicado_por uuid DEFAULT auth.uid(),
  aplicado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acesso_aplicacao_massa_modelo ON public."ACESSO_APLICACAO_MASSA" (modelo_id);

-- ── 10) RLS: lê quem vê a Administração; escreve só pelas RPCs ───────────
ALTER TABLE public."ACESSO_MODELO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ACESSO_MODELO_TELA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ACESSO_APLICACAO_MASSA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acesso_modelo_select ON public."ACESSO_MODELO";
CREATE POLICY acesso_modelo_select ON public."ACESSO_MODELO" FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'administracao', 'visualizar')));

DROP POLICY IF EXISTS acesso_modelo_delete ON public."ACESSO_MODELO";
CREATE POLICY acesso_modelo_delete ON public."ACESSO_MODELO" FOR DELETE TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'administracao', 'alterar')));

DROP POLICY IF EXISTS acesso_modelo_tela_select ON public."ACESSO_MODELO_TELA";
CREATE POLICY acesso_modelo_tela_select ON public."ACESSO_MODELO_TELA" FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'administracao', 'visualizar')));

DROP POLICY IF EXISTS acesso_aplicacao_massa_select ON public."ACESSO_APLICACAO_MASSA";
CREATE POLICY acesso_aplicacao_massa_select ON public."ACESSO_APLICACAO_MASSA" FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'administracao', 'visualizar')));

REVOKE ALL ON public."ACESSO_MODELO", public."ACESSO_MODELO_TELA", public."ACESSO_APLICACAO_MASSA" FROM anon;
GRANT SELECT, DELETE ON public."ACESSO_MODELO" TO authenticated;
GRANT SELECT ON public."ACESSO_MODELO_TELA", public."ACESSO_APLICACAO_MASSA" TO authenticated;

-- ── 11) Acesso efetivo de várias pessoas numa chamada ────────────────────
-- É a mesma list_accessible_menus da "Acesso por Usuário", só que para o
-- grupo inteiro de uma vez — sem uma requisição por pessoa (guardião D7;
-- Encarregados são ~94).
CREATE OR REPLACE FUNCTION public.acesso_efetivo_usuarios(_usuarios uuid[], _acao text DEFAULT 'visualizar')
RETURNS TABLE (user_id uuid, menu_codigo text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(cardinality(_usuarios), 0) > 300 THEN
    RAISE EXCEPTION 'No máximo 300 pessoas por consulta.';
  END IF;

  RETURN QUERY
    SELECT u.id, m.menu_codigo
      FROM unnest(_usuarios) AS u(id)
     CROSS JOIN LATERAL public.list_accessible_menus(u.id, _acao, NULL) AS m;
END;
$$;
REVOKE ALL ON FUNCTION public.acesso_efetivo_usuarios(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acesso_efetivo_usuarios(uuid[], text) TO authenticated;

-- ── 12) Salvar o modelo de um grupo (cria ou substitui as telas) ─────────
CREATE OR REPLACE FUNCTION public.acesso_modelo_salvar(_setor text, _nivel text, _telas text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar modelos de acesso.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public."ACESSO_MODELO" (setor, nivel)
  VALUES (_setor, NULLIF(_nivel, ''))
  ON CONFLICT (setor, nivel) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  DELETE FROM public."ACESSO_MODELO_TELA" WHERE modelo_id = v_id;
  INSERT INTO public."ACESSO_MODELO_TELA" (modelo_id, menu_codigo)
  SELECT DISTINCT v_id, t.codigo
    FROM unnest(coalesce(_telas, '{}'::text[])) AS t(codigo)
   WHERE EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = t.codigo);

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.acesso_modelo_salvar(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acesso_modelo_salvar(text, text, text[]) TO authenticated;

-- ── 13) Aplicar em massa ─────────────────────────────────────────────────
-- _linhas = [{user_id, menu_codigo, acao, allow}], montadas no front por
-- acoesGravadasPeloToggle — liberar grava o pacote da tela, remover grava o
-- pacote inteiro com false, exatamente o que o switch faz pessoa a pessoa.
-- Aqui só valida e grava: guarda o estado anterior, apaga e insere, registra.
-- Tudo ou nada (o laço do painel, no cliente, não é).
--
-- Administrador Geral nunca recebe allow=false por aqui: a exceção individual
-- vence o concede_tudo (J1.B) e o deixaria trancado para sempre naquela tela.
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
REVOKE ALL ON FUNCTION public.acesso_aplicar_em_massa(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acesso_aplicar_em_massa(uuid, text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.acesso_aplicar_em_massa(uuid, text, text, jsonb);
-- DROP FUNCTION IF EXISTS public.acesso_modelo_salvar(text, text, text[]);
-- DROP FUNCTION IF EXISTS public.acesso_efetivo_usuarios(uuid[], text);
-- DROP TABLE IF EXISTS public."ACESSO_APLICACAO_MASSA", public."ACESSO_MODELO_TELA", public."ACESSO_MODELO";
-- DROP FUNCTION IF EXISTS public.cargo_juntar(text, text);
-- DROP TRIGGER IF EXISTS trg_profiles_cargo_so_admin ON public.profiles;
-- DROP FUNCTION IF EXISTS public.profiles_cargo_so_admin();
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_cargo_fkey;
-- DROP INDEX IF EXISTS public.idx_profiles_cargo;
-- DROP TABLE IF EXISTS public."CARGO_CATALOGO";
-- (os nomes de cargo limpos na seção 3 ficam — eram só maiúscula/espaço e dois erros de digitação)
