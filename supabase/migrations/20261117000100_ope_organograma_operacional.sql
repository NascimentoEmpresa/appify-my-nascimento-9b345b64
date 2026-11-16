-- =========================================================================
-- ORGANOGRAMA › OPERACIONAL (17/11/2026)
--
-- PEDIDO (Pablo): "criar Organograma › Operacional dentro do módulo
-- Operacional. Réplica do organograma, mas só a área operacional:
-- GERENTE OPERACIONAL › SUPERVISORES › ENCARREGADOS › CONTRATO › todos os
-- colaboradores do contrato. O gerente (ou quem tiver permissão na tela)
-- define o encarregado de cada contrato e o supervisor de cada um. Botão
-- direito em pessoa ou contrato abre o menu (mover contrato, definir
-- encarregado, trocar supervisor, remover encarregado). Pessoas vêm da
-- EMPREGADOS (nada digitado) e tudo fica no histórico. Essa passa a ser a
-- FONTE do encarregado do contrato para o Ponto, os Documentos do RH e o
-- Solicitar Treinamento. Login novo de ENCARREGADO tem que dizer de qual
-- contrato ele é responsável."
--
-- O QUE ENTRA
--   1. Menu ope_organograma (Operacional › Organograma › Operacional,
--      /app/operacional/organograma). Tela nova nasce sem ninguém (desde
--      08/10/2026): liberar em Administração › Acesso por Usuário.
--      visualizar = ver a árvore; alterar = mexer nela (pacote do toggle).
--   2. OPE_ORG_CONTRATO: uma linha por contrato da LICITAÇÃO
--      (public.contratos.id) com o encarregado e o supervisor (ambos
--      EMPREGADOS."ID"). OPE_ORG_PESSOA: gerente (um só) e supervisores
--      cadastrados mesmo sem contrato ainda. OPE_ORG_HIST: toda mudança.
--      Sem FK para contratos/EMPREGADOS de propósito: FK em contratos
--      pegaria lock na tabela da Licitação (lock_timeout 5 s do aplicador)
--      e a limpeza de duplicados de EMPREGADOS apaga linhas — vínculo órfão
--      só deixa de casar. As RPCs conferem a existência na hora de gravar.
--   3. Contratos = os da Licitação que não estão encerrados (a régua do 13º,
--      mig 20261113001000) + os que já têm linha aqui. Colaboradores do
--      contrato = a ligação pessoa → contrato do Ativos/Contratos
--      (rh_ac_ativos().contrato_id).
--   4. A FONTE DO ENCARREGADO. rh_hier_responsaveis() (mig 20261008000005)
--      é o que Ponto do encarregado (ponto_enc_responsavel/_contexto),
--      Documentos do RH (rh_doc_opcoes/_encarregados/_validar_destino),
--      Treinamento (trn_sol_opcoes), Efetividade e o organograma dinâmico
--      leem. Ela passa a devolver, por filial da Senior (empresa, filial):
--        - o encarregado definido AQUI para o contrato da Licitação que
--          casa com a filial (mesma régua do trn_sol_opcoes: nome
--          normalizado por rh_norm_contrato ou de-para de Suprimentos);
--        - se nenhum contrato daquela filial tem encarregado definido aqui
--          (ou o definido foi demitido), a regra antiga da Hierarquia de
--          Postos — o corpo original, agora em rh_hier_responsaveis_postos().
--      Assinatura igual: nenhuma das funções que leem precisa mudar. A
--      única reescrita é trn_sol_opcoes, porque contrato NOVO (sem filial na
--      Senior ainda) só se acha pelo id da Licitação — "meu" agora vem de
--      ope_org_meus_contratos().
--   5. ope_org_encarregado_login: o cadastro de login (Administração ›
--      Usuários) grava os contratos do encarregado aqui. Pode quem cria
--      login (login_pode_criar, mig 20261111260000) ou quem altera a tela.
--
-- Espelho das regras na tela: src/lib/operacional/organogramaOperacional.ts
-- (testes em src/test/ope-organograma-operacional.test.ts).
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'ope_organograma', 'Organograma Operacional', '/app/operacional/organograma', 8, true
  FROM public.app_modulo m
 WHERE m.codigo = 'operacional'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ope_org_pode(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), 'ope_organograma', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.ope_org_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_pode(text) TO authenticated;

-- ── 2) Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."OPE_ORG_CONTRATO" (
  contrato_id     uuid PRIMARY KEY,          -- public.contratos.id (Licitação)
  encarregado_id  bigint,                    -- EMPREGADOS."ID"
  supervisor_id   bigint,                    -- EMPREGADOS."ID"
  alterado_por    uuid,
  alterado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ope_org_contrato_enc ON public."OPE_ORG_CONTRATO"(encarregado_id);
CREATE INDEX IF NOT EXISTS idx_ope_org_contrato_sup ON public."OPE_ORG_CONTRATO"(supervisor_id);

CREATE TABLE IF NOT EXISTS public."OPE_ORG_PESSOA" (
  empregado_id  bigint PRIMARY KEY,          -- EMPREGADOS."ID"
  papel         text NOT NULL CHECK (papel IN ('gerente', 'supervisor')),
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
-- Um gerente operacional só.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ope_org_pessoa_gerente ON public."OPE_ORG_PESSOA"(papel) WHERE papel = 'gerente';

CREATE TABLE IF NOT EXISTS public."OPE_ORG_HIST" (
  id              bigserial PRIMARY KEY,
  acao            text NOT NULL,             -- encarregado | supervisor | gerente | supervisor_incluido | supervisor_removido
  contrato_id     uuid,
  contrato_nome   text,
  antes_id        bigint,
  antes_nome      text,
  depois_id       bigint,
  depois_nome     text,
  motivo          text,
  autor_id        uuid,
  autor_nome      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ope_org_hist_data ON public."OPE_ORG_HIST"(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ope_org_hist_contrato ON public."OPE_ORG_HIST"(contrato_id);

ALTER TABLE public."OPE_ORG_CONTRATO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OPE_ORG_PESSOA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OPE_ORG_HIST" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."OPE_ORG_CONTRATO" FROM PUBLIC, anon;
REVOKE ALL ON public."OPE_ORG_PESSOA" FROM PUBLIC, anon;
REVOKE ALL ON public."OPE_ORG_HIST" FROM PUBLIC, anon;
-- Leitura direta só para quem vê a tela; gravar, só pelas RPCs abaixo.
GRANT SELECT ON public."OPE_ORG_CONTRATO" TO authenticated;
GRANT SELECT ON public."OPE_ORG_PESSOA" TO authenticated;
GRANT SELECT ON public."OPE_ORG_HIST" TO authenticated;
DROP POLICY IF EXISTS ope_org_contrato_sel ON public."OPE_ORG_CONTRATO";
CREATE POLICY ope_org_contrato_sel ON public."OPE_ORG_CONTRATO" FOR SELECT TO authenticated USING (public.ope_org_pode('visualizar'));
DROP POLICY IF EXISTS ope_org_pessoa_sel ON public."OPE_ORG_PESSOA";
CREATE POLICY ope_org_pessoa_sel ON public."OPE_ORG_PESSOA" FOR SELECT TO authenticated USING (public.ope_org_pode('visualizar'));
DROP POLICY IF EXISTS ope_org_hist_sel ON public."OPE_ORG_HIST";
CREATE POLICY ope_org_hist_sel ON public."OPE_ORG_HIST" FOR SELECT TO authenticated USING (public.ope_org_pode('visualizar'));

-- ── 3) Contrato da Licitação → filial(is) da Senior ──────────────────────
-- Mesma régua do trn_sol_opcoes (mig 20261116200000): nome normalizado ou
-- de-para de Suprimentos. Interna.
CREATE OR REPLACE FUNCTION public.ope_org_contrato_senior()
RETURNS TABLE (contrato_id uuid, empresa bigint, filial bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, s."Empresa"::bigint, s."Filial"::bigint
    FROM public.contratos c
    JOIN public."CONTRATOS" s ON public.rh_norm_contrato(s."NOME CONTRATO") = public.rh_norm_contrato(c.nome)
   WHERE public.rh_norm_contrato(c.nome) IS NOT NULL
     AND s."Empresa" IS NOT NULL AND s."Filial" IS NOT NULL
  UNION
  SELECT d.contrato_id, s."Empresa"::bigint, s."Filial"::bigint
    FROM public.sup_empregado_contrato_depara d
    JOIN public."CONTRATOS" s ON s."NOME CONTRATO" = d.filial_nome
   WHERE d.contrato_id IS NOT NULL
     AND s."Empresa" IS NOT NULL AND s."Filial" IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.ope_org_contrato_senior() FROM PUBLIC, anon, authenticated;

-- ── 4) A fonte do encarregado ────────────────────────────────────────────
-- 4a) A regra antiga, intacta (corpo da mig 20261008000005), com outro nome.
CREATE OR REPLACE FUNCTION public.rh_hier_responsaveis_postos()
RETURNS TABLE (empresa bigint, filial bigint, posto_lider text, empregado_id bigint, auth_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE
  oc AS (SELECT o.empregado_id, o.posto, o.auth_user_id FROM public.rh_hier_ocupacao() o WHERE o.posto IS NOT NULL),
  lider AS (SELECT DISTINCT h.pai_codigo AS codigo FROM public."RH_POSTO_HIERARQUIA" h WHERE h.pai_codigo IS NOT NULL),
  anc AS (
    SELECT h.posto_codigo AS posto, h.pai_codigo AS ancestral, 1 AS dist
      FROM public."RH_POSTO_HIERARQUIA" h WHERE h.pai_codigo IS NOT NULL
    UNION ALL
    SELECT a.posto, h.pai_codigo, a.dist + 1
      FROM anc a JOIN public."RH_POSTO_HIERARQUIA" h ON h.posto_codigo = a.ancestral
     WHERE h.pai_codigo IS NOT NULL AND a.dist < 20
  ),
  resp AS (
    SELECT DISTINCT ON (a.posto) a.posto, a.ancestral
      FROM anc a
     WHERE EXISTS (SELECT 1 FROM oc WHERE oc.posto = a.ancestral)
     ORDER BY a.posto, a.dist
  ),
  pc AS (
    SELECT p.codigo, p.empresa::bigint AS empresa, p.filial::bigint AS filial,
           CASE WHEN EXISTS (SELECT 1 FROM oc WHERE oc.posto = p.codigo)
                THEN CASE WHEN p.codigo IN (SELECT codigo FROM lider) THEN 2 ELSE 1 END
                ELSE 3 END AS camada
      FROM public."RH_POSTO_TRABALHO" p
      JOIN public."RH_POSTO_HIERARQUIA" h ON h.posto_codigo = p.codigo
     WHERE p.ativo AND p.empresa IS NOT NULL AND p.filial IS NOT NULL
  ),
  cand AS (
    SELECT pc.empresa, pc.filial, r.ancestral AS posto_lider, pc.camada,
           min(pc.camada) OVER (PARTITION BY pc.empresa, pc.filial) AS melhor
      FROM pc JOIN resp r ON r.posto = pc.codigo
  )
  SELECT DISTINCT c.empresa, c.filial, c.posto_lider, oc.empregado_id, oc.auth_user_id
    FROM cand c JOIN oc ON oc.posto = c.posto_lider
   WHERE c.camada = c.melhor
$$;
REVOKE ALL ON FUNCTION public.rh_hier_responsaveis_postos() FROM PUBLIC, anon, authenticated;

-- 4b) Encarregados definidos no Organograma Operacional, por filial da
-- Senior. Demitido não conta (o contrato volta para a reserva).
CREATE OR REPLACE FUNCTION public.ope_org_encarregados_senior()
RETURNS TABLE (empresa bigint, filial bigint, posto text, empregado_id bigint, auth_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT m.empresa, m.filial, NULLIF(btrim(COALESCE(e."Posto", '')), ''), e."ID"::bigint, e.auth_user_id
    FROM public."OPE_ORG_CONTRATO" o
    JOIN public.ope_org_contrato_senior() m ON m.contrato_id = o.contrato_id
    JOIN public."EMPREGADOS" e ON e."ID" = o.encarregado_id
   WHERE o.encarregado_id IS NOT NULL
     AND COALESCE(e."Situação", '') <> 'Demitido'
$$;
REVOKE ALL ON FUNCTION public.ope_org_encarregados_senior() FROM PUBLIC, anon, authenticated;

-- 4c) A que todo mundo lê: organograma primeiro, Hierarquia de Postos de
-- reserva (só para a filial que o organograma não cobre).
CREATE OR REPLACE FUNCTION public.rh_hier_responsaveis()
RETURNS TABLE (empresa bigint, filial bigint, posto_lider text, empregado_id bigint, auth_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH org AS MATERIALIZED (SELECT * FROM public.ope_org_encarregados_senior())
  SELECT o.empresa, o.filial, o.posto, o.empregado_id, o.auth_user_id FROM org o
  UNION ALL
  SELECT p.empresa, p.filial, p.posto_lider, p.empregado_id, p.auth_user_id
    FROM public.rh_hier_responsaveis_postos() p
   WHERE NOT EXISTS (SELECT 1 FROM org o WHERE o.empresa = p.empresa AND o.filial = p.filial)
$$;
REVOKE ALL ON FUNCTION public.rh_hier_responsaveis() FROM PUBLIC, anon, authenticated;

-- 4d) Os contratos da Licitação de quem está logado: os definidos aqui +,
-- pela reserva, os da filial de que ele é responsável na Hierarquia.
CREATE OR REPLACE FUNCTION public.ope_org_meus_contratos()
RETURNS TABLE (contrato_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.contrato_id
    FROM public."OPE_ORG_CONTRATO" o
    JOIN public."EMPREGADOS" e ON e."ID" = o.encarregado_id
   WHERE auth.uid() IS NOT NULL AND e.auth_user_id = auth.uid()
     AND COALESCE(e."Situação", '') <> 'Demitido'
  UNION
  SELECT m.contrato_id
    FROM public.rh_hier_responsaveis() r
    JOIN public.ope_org_contrato_senior() m ON m.empresa = r.empresa AND m.filial = r.filial
   WHERE auth.uid() IS NOT NULL AND r.auth_user_id = auth.uid()
     -- Contrato com encarregado definido aqui é só dele (a filial pode casar com mais de um contrato).
     AND NOT EXISTS (SELECT 1 FROM public."OPE_ORG_CONTRATO" x
                       JOIN public."EMPREGADOS" ex ON ex."ID" = x.encarregado_id
                      WHERE x.contrato_id = m.contrato_id AND COALESCE(ex."Situação", '') <> 'Demitido'
                        AND ex.auth_user_id IS DISTINCT FROM auth.uid())
$$;
REVOKE ALL ON FUNCTION public.ope_org_meus_contratos() FROM PUBLIC, anon, authenticated;

-- ── 5) Gravar (núcleo interno, com histórico) ────────────────────────────
CREATE OR REPLACE FUNCTION public.ope_org_nome(_id bigint)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e."Nome" FROM public."EMPREGADOS" e WHERE e."ID" = _id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.ope_org_nome(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ope_org_autor()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.ope_org_autor() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ope_org_conferir_pessoa(_id bigint)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF _id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" e WHERE e."ID" = _id AND COALESCE(e."Situação", '') <> 'Demitido') THEN
    RAISE EXCEPTION 'Colaborador não encontrado no cadastro (ou demitido).';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_conferir_pessoa(bigint) FROM PUBLIC, anon, authenticated;

-- p_campo: 'encarregado' | 'supervisor'. p_empregado NULL = tirar.
CREATE OR REPLACE FUNCTION public.ope_org_aplicar(p_contratos uuid[], p_campo text, p_empregado bigint, p_motivo text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_c      record;
  v_antes  bigint;
  v_n      integer := 0;
  v_autor  text := public.ope_org_autor();
  v_novo   text := public.ope_org_nome(p_empregado);
BEGIN
  IF p_campo NOT IN ('encarregado', 'supervisor') THEN RAISE EXCEPTION 'Campo inválido: %', p_campo; END IF;
  IF p_contratos IS NULL OR cardinality(p_contratos) = 0 THEN RAISE EXCEPTION 'Escolha ao menos um contrato.'; END IF;
  PERFORM public.ope_org_conferir_pessoa(p_empregado);

  FOR v_c IN SELECT c.id, c.nome FROM public.contratos c WHERE c.id = ANY (p_contratos) LOOP
    SELECT CASE WHEN p_campo = 'encarregado' THEN o.encarregado_id ELSE o.supervisor_id END
      INTO v_antes FROM public."OPE_ORG_CONTRATO" o WHERE o.contrato_id = v_c.id;
    CONTINUE WHEN v_antes IS NOT DISTINCT FROM p_empregado;

    INSERT INTO public."OPE_ORG_CONTRATO" AS o (contrato_id, encarregado_id, supervisor_id, alterado_por, alterado_em)
    VALUES (v_c.id,
            CASE WHEN p_campo = 'encarregado' THEN p_empregado END,
            CASE WHEN p_campo = 'supervisor' THEN p_empregado END,
            auth.uid(), now())
    ON CONFLICT (contrato_id) DO UPDATE SET
      encarregado_id = CASE WHEN p_campo = 'encarregado' THEN p_empregado ELSE o.encarregado_id END,
      supervisor_id  = CASE WHEN p_campo = 'supervisor'  THEN p_empregado ELSE o.supervisor_id END,
      alterado_por = auth.uid(), alterado_em = now();
    -- Linha vazia não fica (o contrato volta todo para a reserva).
    DELETE FROM public."OPE_ORG_CONTRATO" o
     WHERE o.contrato_id = v_c.id AND o.encarregado_id IS NULL AND o.supervisor_id IS NULL;

    INSERT INTO public."OPE_ORG_HIST" (acao, contrato_id, contrato_nome, antes_id, antes_nome, depois_id, depois_nome, motivo, autor_id, autor_nome)
    VALUES (p_campo, v_c.id, v_c.nome, v_antes, public.ope_org_nome(v_antes), p_empregado, v_novo,
            NULLIF(btrim(COALESCE(p_motivo, '')), ''), auth.uid(), v_autor);
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 AND NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.id = ANY (p_contratos)) THEN
    RAISE EXCEPTION 'Contrato não encontrado na Licitação.';
  END IF;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_aplicar(uuid[], text, bigint, text) FROM PUBLIC, anon, authenticated;

-- ── 6) RPCs da tela ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ope_org_definir(p_contratos uuid[], p_campo text, p_empregado bigint, p_motivo text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.ope_org_pode('alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Organograma Operacional.' USING ERRCODE = '42501';
  END IF;
  RETURN public.ope_org_aplicar(p_contratos, p_campo, p_empregado, p_motivo);
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_definir(uuid[], text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_definir(uuid[], text, bigint, text) TO authenticated;

-- Gerente (troca o anterior) e supervisores (incluir/remover). Remover o
-- supervisor deixa os contratos dele "sem supervisor", com histórico.
CREATE OR REPLACE FUNCTION public.ope_org_papel(p_empregado bigint, p_papel text, p_ativo boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_antes bigint;
  v_ids   uuid[];
  v_autor text := public.ope_org_autor();
BEGIN
  IF NOT public.ope_org_pode('alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Organograma Operacional.' USING ERRCODE = '42501';
  END IF;
  IF p_papel NOT IN ('gerente', 'supervisor') THEN RAISE EXCEPTION 'Papel inválido: %', p_papel; END IF;
  IF p_empregado IS NULL THEN RAISE EXCEPTION 'Escolha a pessoa.'; END IF;
  IF p_ativo THEN PERFORM public.ope_org_conferir_pessoa(p_empregado); END IF;

  IF p_papel = 'gerente' THEN
    SELECT empregado_id INTO v_antes FROM public."OPE_ORG_PESSOA" WHERE papel = 'gerente';
    IF p_ativo AND v_antes IS NOT DISTINCT FROM p_empregado THEN RETURN; END IF;
    IF NOT p_ativo AND v_antes IS DISTINCT FROM p_empregado THEN RETURN; END IF;
    DELETE FROM public."OPE_ORG_PESSOA" WHERE papel = 'gerente' OR empregado_id = p_empregado;
    IF p_ativo THEN
      INSERT INTO public."OPE_ORG_PESSOA" (empregado_id, papel, criado_por) VALUES (p_empregado, 'gerente', auth.uid());
    END IF;
    INSERT INTO public."OPE_ORG_HIST" (acao, antes_id, antes_nome, depois_id, depois_nome, autor_id, autor_nome)
    VALUES ('gerente', v_antes, public.ope_org_nome(v_antes),
            CASE WHEN p_ativo THEN p_empregado END, CASE WHEN p_ativo THEN public.ope_org_nome(p_empregado) END,
            auth.uid(), v_autor);
    RETURN;
  END IF;

  IF p_ativo THEN
    IF EXISTS (SELECT 1 FROM public."OPE_ORG_PESSOA" WHERE empregado_id = p_empregado) THEN RETURN; END IF;
    INSERT INTO public."OPE_ORG_PESSOA" (empregado_id, papel, criado_por) VALUES (p_empregado, 'supervisor', auth.uid());
    INSERT INTO public."OPE_ORG_HIST" (acao, depois_id, depois_nome, autor_id, autor_nome)
    VALUES ('supervisor_incluido', p_empregado, public.ope_org_nome(p_empregado), auth.uid(), v_autor);
  ELSE
    SELECT array_agg(contrato_id) INTO v_ids FROM public."OPE_ORG_CONTRATO" WHERE supervisor_id = p_empregado;
    IF v_ids IS NOT NULL THEN PERFORM public.ope_org_aplicar(v_ids, 'supervisor', NULL, 'Supervisor removido do organograma'); END IF;
    DELETE FROM public."OPE_ORG_PESSOA" WHERE empregado_id = p_empregado AND papel = 'supervisor';
    INSERT INTO public."OPE_ORG_HIST" (acao, antes_id, antes_nome, autor_id, autor_nome)
    VALUES ('supervisor_removido', p_empregado, public.ope_org_nome(p_empregado), auth.uid(), v_autor);
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_papel(bigint, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_papel(bigint, text, boolean) TO authenticated;

-- Tudo que a tela precisa numa ida só (sem as pessoas de cada contrato,
-- que vêm ao abrir o contrato: ope_org_colaboradores).
CREATE OR REPLACE FUNCTION public.ope_org_painel()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.ope_org_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Organograma Operacional.' USING ERRCODE = '42501';
  END IF;

  WITH
  lic AS MATERIALIZED (
    SELECT c.id, c.nome, COALESCE(c.status, 'ativo') AS status, o.encarregado_id, o.supervisor_id
      FROM public.contratos c
      LEFT JOIN public."OPE_ORG_CONTRATO" o ON o.contrato_id = c.id
     WHERE NULLIF(btrim(c.nome), '') IS NOT NULL
       AND (COALESCE(c.status, 'ativo') <> 'encerrado' OR o.contrato_id IS NOT NULL)
  ),
  -- rh_ac_ativos lê EMPREGADOS inteira: UMA vez.
  qtd AS MATERIALIZED (
    SELECT a.contrato_id, count(*)::int AS n FROM public.rh_ac_ativos() a
     WHERE a.contrato_id IS NOT NULL GROUP BY a.contrato_id
  ),
  -- O que a Hierarquia de Postos diz (a reserva), para a tela mostrar.
  postos AS MATERIALIZED (
    SELECT m.contrato_id, array_agg(DISTINCT r.empregado_id) AS ids
      FROM public.rh_hier_responsaveis_postos() r
      JOIN public.ope_org_contrato_senior() m ON m.empresa = r.empresa AND m.filial = r.filial
     GROUP BY m.contrato_id
  ),
  ids AS (
    SELECT encarregado_id AS id FROM lic WHERE encarregado_id IS NOT NULL
    UNION SELECT supervisor_id FROM lic WHERE supervisor_id IS NOT NULL
    UNION SELECT empregado_id FROM public."OPE_ORG_PESSOA"
    UNION SELECT unnest(p.ids) FROM postos p JOIN lic l ON l.id = p.contrato_id
  )
  SELECT jsonb_build_object(
    'contratos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'nome', l.nome, 'status', l.status,
               'encarregado_id', l.encarregado_id, 'supervisor_id', l.supervisor_id,
               'colaboradores', COALESCE(q.n, 0),
               'encarregados_postos', COALESCE(to_jsonb(p.ids), '[]'::jsonb)) ORDER BY l.nome)
        FROM lic l LEFT JOIN qtd q ON q.contrato_id = l.id LEFT JOIN postos p ON p.contrato_id = l.id), '[]'::jsonb),
    'pessoas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e."ID", 'nome', e."Nome", 'cargo', e."Título do Cargo", 'situacao', e."Situação",
               'avatar_url', pr.avatar_url, 'tem_login', e.auth_user_id IS NOT NULL))
        FROM public."EMPREGADOS" e
        LEFT JOIN public.profiles pr ON pr.id = e.auth_user_id
       WHERE e."ID" IN (SELECT id FROM ids)), '[]'::jsonb),
    'papeis', COALESCE((SELECT jsonb_agg(jsonb_build_object('empregado_id', x.empregado_id, 'papel', x.papel))
                          FROM public."OPE_ORG_PESSOA" x), '[]'::jsonb),
    'historico', COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC)
                             FROM (SELECT * FROM public."OPE_ORG_HIST" ORDER BY created_at DESC LIMIT 200) h), '[]'::jsonb),
    'pode_alterar', public.ope_org_pode('alterar'))
  INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_painel() TO authenticated;

-- Os colaboradores de um contrato (a ligação do Ativos/Contratos).
CREATE OR REPLACE FUNCTION public.ope_org_colaboradores(p_contrato uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.ope_org_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Organograma Operacional.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', a.empregado_id, 'nome', a.nome, 'cargo', a.cargo,
                                        'situacao', a.situacao, 'posto', NULLIF(a.posto_senior, '')) ORDER BY a.nome)
      FROM public.rh_ac_ativos() a WHERE a.contrato_id = p_contrato), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_colaboradores(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_colaboradores(uuid) TO authenticated;

-- Escolher pessoa: sempre da EMPREGADOS (ativos). Também usada no cadastro de login.
CREATE OR REPLACE FUNCTION public.ope_org_buscar(p_termo text, p_limite integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_t text := btrim(COALESCE(p_termo, ''));
BEGIN
  IF NOT (public.ope_org_pode('visualizar') OR public.login_pode_criar(auth.uid()) IS NOT NULL) THEN
    RAISE EXCEPTION 'Sem acesso.' USING ERRCODE = '42501';
  END IF;
  IF length(v_t) < 2 THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'nome')
      FROM (SELECT jsonb_build_object('id', e."ID", 'nome', e."Nome", 'cargo', e."Título do Cargo",
                                      'contrato', e."Nome Filial", 'situacao', e."Situação") x
              FROM public."EMPREGADOS" e
             WHERE public.esp_col_esta_ativo(e."Situação")
               AND e."Nome" ILIKE '%' || replace(replace(v_t, '%', ''), '_', '') || '%'
             ORDER BY e."Nome"
             LIMIT LEAST(GREATEST(COALESCE(p_limite, 20), 1), 50)) s), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_buscar(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_buscar(text, integer) TO authenticated;

-- Contratos (Licitação, não encerrados) para o cadastro de login.
CREATE OR REPLACE FUNCTION public.ope_org_contratos_opcoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.ope_org_pode('visualizar') OR public.login_pode_criar(auth.uid()) IS NOT NULL) THEN
    RAISE EXCEPTION 'Sem acesso.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome,
                                        'encarregado_id', o.encarregado_id, 'encarregado_nome', public.ope_org_nome(o.encarregado_id))
                     ORDER BY c.nome)
      FROM public.contratos c
      LEFT JOIN public."OPE_ORG_CONTRATO" o ON o.contrato_id = c.id
     WHERE COALESCE(c.status, 'ativo') <> 'encerrado' AND NULLIF(btrim(c.nome), '') IS NOT NULL), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_contratos_opcoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_contratos_opcoes() TO authenticated;

-- Login novo de encarregado: grava os contratos dele. Quem cria login
-- (login_pode_criar) ou quem altera o organograma.
CREATE OR REPLACE FUNCTION public.ope_org_encarregado_login(p_empregado bigint, p_contratos uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.login_pode_criar(auth.uid()) IS NOT NULL OR public.ope_org_pode('alterar')) THEN
    RAISE EXCEPTION 'Sem permissão para definir o encarregado do contrato.' USING ERRCODE = '42501';
  END IF;
  IF p_empregado IS NULL THEN
    RAISE EXCEPTION 'Encarregado precisa estar no cadastro de colaboradores: escolha o colaborador.';
  END IF;
  IF p_contratos IS NULL OR cardinality(p_contratos) = 0 THEN
    RAISE EXCEPTION 'Encarregado: escolha de qual(is) contrato(s) ele é responsável.';
  END IF;
  RETURN public.ope_org_aplicar(p_contratos, 'encarregado', p_empregado, 'Cadastro de login do encarregado');
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_encarregado_login(bigint, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_encarregado_login(bigint, uuid[]) TO authenticated;

-- ── 7) Solicitar Treinamento: "meu" contrato pela fonte nova ─────────────
-- Igual à 20261116200000, trocando o CTE `meus` por ope_org_meus_contratos().
CREATE OR REPLACE FUNCTION public.trn_sol_opcoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre no sistema.' USING ERRCODE = '42501'; END IF;

  WITH
  senior AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(s."NOME CONTRATO"))
           public.rh_norm_contrato(s."NOME CONTRATO") AS nn, s."Empresa"::bigint AS empresa, s."Filial"::bigint AS filial
      FROM public."CONTRATOS" s
     WHERE public.rh_norm_contrato(s."NOME CONTRATO") IS NOT NULL
     ORDER BY public.rh_norm_contrato(s."NOME CONTRATO"), (s."ATIVO" = 'SIM') DESC, s."Filial"
  ),
  meus AS MATERIALIZED (SELECT m.contrato_id AS id FROM public.ope_org_meus_contratos() m),
  lic AS (
    SELECT c.id, c.nome, public.rh_norm_contrato(c.nome) AS nn
      FROM public.contratos c
     WHERE COALESCE(c.status, 'ativo') NOT IN ('encerrado', 'suspenso')
       AND NULLIF(btrim(c.nome), '') IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'contrato_id', l.id,
           'empresa', s.empresa,
           'filial', s.filial,
           'nome', l.nome,
           'meu', l.id IN (SELECT id FROM meus))
         ORDER BY (l.id IN (SELECT id FROM meus)) DESC, l.nome), '[]'::jsonb)
    INTO v_out
    FROM lic l
    LEFT JOIN senior s ON s.nn = l.nn;

  RETURN jsonb_build_object('eu', public.trn_sol_eu(), 'contratos', v_out);
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sol_opcoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_sol_opcoes() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar rh_hier_responsaveis da 20261008000005 (o corpo é o de
-- rh_hier_responsaveis_postos) e trn_sol_opcoes da 20261116200000. Depois:
-- DROP FUNCTION IF EXISTS public.ope_org_encarregado_login(bigint, uuid[]);
-- DROP FUNCTION IF EXISTS public.ope_org_contratos_opcoes();
-- DROP FUNCTION IF EXISTS public.ope_org_buscar(text, integer);
-- DROP FUNCTION IF EXISTS public.ope_org_colaboradores(uuid);
-- DROP FUNCTION IF EXISTS public.ope_org_painel();
-- DROP FUNCTION IF EXISTS public.ope_org_papel(bigint, text, boolean);
-- DROP FUNCTION IF EXISTS public.ope_org_definir(uuid[], text, bigint, text);
-- DROP FUNCTION IF EXISTS public.ope_org_aplicar(uuid[], text, bigint, text);
-- DROP FUNCTION IF EXISTS public.ope_org_conferir_pessoa(bigint);
-- DROP FUNCTION IF EXISTS public.ope_org_autor();
-- DROP FUNCTION IF EXISTS public.ope_org_nome(bigint);
-- DROP FUNCTION IF EXISTS public.ope_org_meus_contratos();
-- DROP FUNCTION IF EXISTS public.ope_org_encarregados_senior();
-- DROP FUNCTION IF EXISTS public.rh_hier_responsaveis_postos();
-- DROP FUNCTION IF EXISTS public.ope_org_contrato_senior();
-- DROP TABLE IF EXISTS public."OPE_ORG_HIST", public."OPE_ORG_PESSOA", public."OPE_ORG_CONTRATO";
-- DROP FUNCTION IF EXISTS public.ope_org_pode(text);
-- DELETE FROM public.app_menu WHERE codigo = 'ope_organograma';
-- NOTIFY pgrst, 'reload schema';
