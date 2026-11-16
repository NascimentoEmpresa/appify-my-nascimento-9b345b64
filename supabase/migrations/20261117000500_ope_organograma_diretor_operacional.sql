-- =========================================================================
-- ORGANOGRAMA OPERACIONAL: Diretor Operacional no topo (17/11/2026)
--
-- PEDIDO (Pablo): "Primeiro tem que ter DIRETOR OPERACIONAL › GERENTE
-- OPERACIONAL › SUPERVISORES › ENCARREGADOS. Cada encarregado é responsável
-- por um contrato; supervisores respondem pelos encarregados e por alguns
-- contratos. Ao clicar no supervisor abrem os contratos, e ao abrir o
-- contrato aparece no topo o ENCARREGADO DESSE CONTRATO."
--
-- No banco só falta o cargo do topo: OPE_ORG_PESSOA ganha o papel
-- 'diretor' (um só, como o gerente) e ope_org_papel passa a aceitá-lo.
-- A árvore supervisor › contrato › encarregado é montagem da tela
-- (src/lib/operacional/organogramaOperacional.ts) — o dado já é por contrato.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."OPE_ORG_PESSOA" DROP CONSTRAINT IF EXISTS "OPE_ORG_PESSOA_papel_check";
ALTER TABLE public."OPE_ORG_PESSOA" DROP CONSTRAINT IF EXISTS ope_org_pessoa_papel_check;
ALTER TABLE public."OPE_ORG_PESSOA" ADD CONSTRAINT ope_org_pessoa_papel_check CHECK (papel IN ('diretor', 'gerente', 'supervisor'));
-- Um diretor operacional só.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ope_org_pessoa_diretor ON public."OPE_ORG_PESSOA"(papel) WHERE papel = 'diretor';

-- Igual à 20261117000100, com 'diretor' tratado como o gerente (um só; troca
-- o anterior) e espelhando no organograma geral no fim (ver bloco abaixo).
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
  IF p_papel NOT IN ('diretor', 'gerente', 'supervisor') THEN RAISE EXCEPTION 'Papel inválido: %', p_papel; END IF;
  IF p_empregado IS NULL THEN RAISE EXCEPTION 'Escolha a pessoa.'; END IF;
  IF p_ativo THEN PERFORM public.ope_org_conferir_pessoa(p_empregado); END IF;

  IF p_papel IN ('diretor', 'gerente') THEN
    SELECT empregado_id INTO v_antes FROM public."OPE_ORG_PESSOA" WHERE papel = p_papel;
    IF p_ativo AND v_antes IS NOT DISTINCT FROM p_empregado THEN RETURN; END IF;
    IF NOT p_ativo AND v_antes IS DISTINCT FROM p_empregado THEN RETURN; END IF;
    -- A pessoa ocupa um papel só: virar diretor tira de gerente/supervisor.
    DELETE FROM public."OPE_ORG_PESSOA" WHERE papel = p_papel OR empregado_id = p_empregado;
    IF p_ativo THEN
      INSERT INTO public."OPE_ORG_PESSOA" (empregado_id, papel, criado_por) VALUES (p_empregado, p_papel, auth.uid());
    END IF;
    INSERT INTO public."OPE_ORG_HIST" (acao, antes_id, antes_nome, depois_id, depois_nome, autor_id, autor_nome)
    VALUES (p_papel, v_antes, public.ope_org_nome(v_antes),
            CASE WHEN p_ativo THEN p_empregado END, CASE WHEN p_ativo THEN public.ope_org_nome(p_empregado) END,
            auth.uid(), v_autor);
    PERFORM public.ope_org_espelhar_papeis();  -- definida mais abaixo (resolve na hora de rodar)
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
  PERFORM public.ope_org_espelhar_papeis();
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_papel(bigint, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_org_papel(bigint, text, boolean) TO authenticated;

-- =========================================================================
-- ESPELHO NO ORGANOGRAMA GERAL (Presidência › Organograma)
--
-- PEDIDO (Pablo): "lembrando que as alterações aqui alteram também no
-- organograma geral lá da presidência".
--
-- O geral guarda a mesma coisa em dois lugares:
--   · ORGANOGRAMA_CONTRATO_SUPERVISOR (mig 20261106021000): em qual
--     supervisor o contrato (filial da Senior) fica pendurado;
--   · ORGANOGRAMA_NO.parent_id: o "reporta a" de cada pessoa.
-- Toda mudança aqui regrava os dois:
--   gerente → diretor; supervisor → gerente; encarregado → supervisor do
--   contrato; colaboradores do contrato → encarregado (ou o supervisor, se o
--   contrato ficou sem encarregado); contrato → supervisor.
-- Colaborador cujo superior foi escolhido À MÃO no geral (superior_origem
-- 'manual') não é mexido — só os deduzidos ('posto', 'contrato', 'sem') ou
-- pendentes. Pessoa sem nó no geral ganha um (como a carga do organograma
-- dinâmico faz). Troca que fecharia ciclo é ignorada em vez de travar.
-- O histórico do geral (ORGANOGRAMA_MOVIMENTACAO) registra sozinho pelo
-- gatilho do nó, com o motivo "Organograma Operacional".
-- =========================================================================

-- O nó da pessoa no geral (cria se não houver).
CREATE OR REPLACE FUNCTION public.ope_org_no_de(p_empregado bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_no  uuid;
  v_uid uuid;
BEGIN
  IF p_empregado IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_no FROM public."ORGANOGRAMA_NO" WHERE empregado_id = p_empregado;
  IF v_no IS NOT NULL THEN RETURN v_no; END IF;
  SELECT e.auth_user_id INTO v_uid FROM public."EMPREGADOS" e WHERE e."ID" = p_empregado;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Nó criado só pelo login (sem cadastro ligado): passa a ser desta pessoa.
  IF v_uid IS NOT NULL THEN
    UPDATE public."ORGANOGRAMA_NO" SET empregado_id = p_empregado
     WHERE user_id = v_uid AND empregado_id IS NULL
    RETURNING id INTO v_no;
    IF v_no IS NOT NULL THEN RETURN v_no; END IF;
    IF EXISTS (SELECT 1 FROM public."ORGANOGRAMA_NO" WHERE user_id = v_uid) THEN v_uid := NULL; END IF;
  END IF;
  INSERT INTO public."ORGANOGRAMA_NO" (user_id, empregado_id) VALUES (v_uid, p_empregado) RETURNING id INTO v_no;
  RETURN v_no;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_no_de(bigint) FROM PUBLIC, anon, authenticated;

-- "Reporta a" de um nó; ciclo é ignorado (não derruba a mudança de cá).
CREATE OR REPLACE FUNCTION public.ope_org_no_reporta(p_no uuid, p_sup uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_no IS NULL OR p_sup IS NULL OR p_no = p_sup THEN RETURN; END IF;
  BEGIN
    UPDATE public."ORGANOGRAMA_NO" SET parent_id = p_sup, do_grupo = false
     WHERE id = p_no AND parent_id IS DISTINCT FROM p_sup;
  EXCEPTION WHEN raise_exception OR check_violation THEN
    NULL;
  END;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_no_reporta(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Diretor ← gerente ← supervisores.
CREATE OR REPLACE FUNCTION public.ope_org_espelhar_papeis()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_dir bigint;
  v_ger bigint;
  v_ger_no uuid;
  v_s bigint;
BEGIN
  PERFORM set_config('organograma.motivo', 'Organograma Operacional', true);
  SELECT empregado_id INTO v_dir FROM public."OPE_ORG_PESSOA" WHERE papel = 'diretor';
  SELECT empregado_id INTO v_ger FROM public."OPE_ORG_PESSOA" WHERE papel = 'gerente';
  v_ger_no := public.ope_org_no_de(v_ger);
  IF v_dir IS NOT NULL AND v_ger_no IS NOT NULL THEN
    PERFORM public.ope_org_no_reporta(v_ger_no, public.ope_org_no_de(v_dir));
  END IF;
  IF v_ger_no IS NULL THEN RETURN; END IF;
  FOR v_s IN
    SELECT empregado_id FROM public."OPE_ORG_PESSOA" WHERE papel = 'supervisor'
    UNION
    SELECT supervisor_id FROM public."OPE_ORG_CONTRATO" WHERE supervisor_id IS NOT NULL
  LOOP
    CONTINUE WHEN v_s IS NOT DISTINCT FROM v_ger OR v_s IS NOT DISTINCT FROM v_dir;
    PERFORM public.ope_org_no_reporta(public.ope_org_no_de(v_s), v_ger_no);
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_espelhar_papeis() FROM PUBLIC, anon, authenticated;

-- Contrato → supervisor; encarregado → supervisor; colaboradores → encarregado.
CREATE OR REPLACE FUNCTION public.ope_org_espelhar_contratos(p_contratos uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_c      uuid;
  v_enc    bigint;
  v_sup    bigint;
  v_enc_no uuid;
  v_sup_no uuid;
  v_alvo   uuid;
BEGIN
  IF p_contratos IS NULL OR cardinality(p_contratos) = 0 THEN RETURN; END IF;
  PERFORM set_config('organograma.motivo', 'Organograma Operacional', true);

  -- rh_ac_ativos lê EMPREGADOS inteira: uma vez para todos os contratos.
  CREATE TEMP TABLE IF NOT EXISTS tmp_ope_org_colab (empregado_id bigint, contrato_id uuid) ON COMMIT DROP;
  TRUNCATE tmp_ope_org_colab;
  INSERT INTO tmp_ope_org_colab
  SELECT a.empregado_id, a.contrato_id FROM public.rh_ac_ativos() a WHERE a.contrato_id = ANY (p_contratos);

  FOREACH v_c IN ARRAY p_contratos LOOP
    v_enc := NULL; v_sup := NULL;
    SELECT o.encarregado_id, o.supervisor_id INTO v_enc, v_sup FROM public."OPE_ORG_CONTRATO" o WHERE o.contrato_id = v_c;
    v_enc_no := public.ope_org_no_de(v_enc);
    v_sup_no := public.ope_org_no_de(v_sup);

    -- 1) Em qual supervisor o contrato fica (por filial da Senior).
    IF v_sup_no IS NOT NULL THEN
      INSERT INTO public."ORGANOGRAMA_CONTRATO_SUPERVISOR" (empresa, filial, no_id, definido_por, atualizado_em)
      SELECT DISTINCT m.empresa, m.filial, v_sup_no, auth.uid(), now()
        FROM public.ope_org_contrato_senior() m WHERE m.contrato_id = v_c
      ON CONFLICT (empresa, filial) DO UPDATE SET no_id = EXCLUDED.no_id, definido_por = EXCLUDED.definido_por, atualizado_em = now();
    ELSE
      DELETE FROM public."ORGANOGRAMA_CONTRATO_SUPERVISOR" s
       USING public.ope_org_contrato_senior() m
       WHERE m.contrato_id = v_c AND s.empresa = m.empresa AND s.filial = m.filial;
    END IF;

    -- 2) Encarregado reporta ao supervisor do contrato.
    IF v_enc_no IS NOT NULL AND v_sup_no IS NOT NULL THEN
      PERFORM public.ope_org_no_reporta(v_enc_no, v_sup_no);
    END IF;

    -- 3) A turma: reporta ao encarregado (sem ele, ao supervisor). Só quem
    --    não teve o superior escolhido à mão, e nunca quem tem papel aqui.
    v_alvo := COALESCE(v_enc_no, v_sup_no);
    CONTINUE WHEN v_alvo IS NULL;
    PERFORM set_config('organograma.auto', '1', true);
    BEGIN
      UPDATE public."ORGANOGRAMA_NO" n
         SET parent_id = v_alvo, superior_origem = 'contrato', superior_pendente = false, do_grupo = false
        FROM tmp_ope_org_colab t
       WHERE t.contrato_id = v_c AND n.empregado_id = t.empregado_id
         AND n.id <> v_alvo AND n.parent_id IS DISTINCT FROM v_alvo
         AND (n.superior_pendente OR n.parent_id IS NULL OR n.superior_origem IN ('posto', 'contrato', 'sem'))
         AND t.empregado_id NOT IN (SELECT x.empregado_id FROM public."OPE_ORG_PESSOA" x)
         AND t.empregado_id NOT IN (SELECT y.encarregado_id FROM public."OPE_ORG_CONTRATO" y WHERE y.encarregado_id IS NOT NULL)
         AND t.empregado_id NOT IN (SELECT y.supervisor_id FROM public."OPE_ORG_CONTRATO" y WHERE y.supervisor_id IS NOT NULL);
    EXCEPTION WHEN raise_exception OR check_violation THEN
      NULL;
    END;
    PERFORM set_config('organograma.auto', '', true);
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_espelhar_contratos(uuid[]) FROM PUBLIC, anon, authenticated;

-- Igual à 20261117000100, espelhando no geral no fim.
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
  IF v_n > 0 THEN
    PERFORM public.ope_org_espelhar_contratos(p_contratos);
    IF p_campo = 'supervisor' THEN PERFORM public.ope_org_espelhar_papeis(); END IF;
  END IF;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_org_aplicar(uuid[], text, bigint, text) FROM PUBLIC, anon, authenticated;

-- Carga: o que já está no Organograma Operacional passa para o geral agora.
SELECT public.ope_org_espelhar_papeis();
SELECT public.ope_org_espelhar_contratos(ARRAY(SELECT contrato_id FROM public."OPE_ORG_CONTRATO"));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DELETE FROM public."OPE_ORG_PESSOA" WHERE papel = 'diretor';
-- DROP INDEX IF EXISTS public.uq_ope_org_pessoa_diretor;
-- ALTER TABLE public."OPE_ORG_PESSOA" DROP CONSTRAINT IF EXISTS ope_org_pessoa_papel_check;
-- ALTER TABLE public."OPE_ORG_PESSOA" ADD CONSTRAINT ope_org_pessoa_papel_check CHECK (papel IN ('gerente', 'supervisor'));
-- Reaplicar ope_org_papel e ope_org_aplicar da 20261117000100.
-- DROP FUNCTION IF EXISTS public.ope_org_espelhar_contratos(uuid[]);
-- DROP FUNCTION IF EXISTS public.ope_org_espelhar_papeis();
-- DROP FUNCTION IF EXISTS public.ope_org_no_reporta(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.ope_org_no_de(bigint);
-- O que já foi espelhado no geral fica (é o "reporta a" e o supervisor do
-- contrato de lá, editáveis na própria tela do Organograma).
-- NOTIFY pgrst, 'reload schema';
