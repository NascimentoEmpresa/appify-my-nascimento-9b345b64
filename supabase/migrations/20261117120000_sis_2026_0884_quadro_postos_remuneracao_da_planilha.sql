-- =========================================================================
-- SIS-2026-0884 — Quadro de Postos do contrato preenchido pelo POSTO
-- (16/11/2026)
--
-- PEDIDO: em Licitações › Contratos › Editar contrato, seção 7 "Quadro de
-- Postos e Vagas", escolhido o posto, os campos têm de vir sozinhos:
--   • Salário            ← "Salário base" do bloco "2 — Composição da
--                          remuneração" da Planilha de Custo do posto;
--   • Insalubridade/Periculosidade ← os campos de mesmo nome desse bloco;
--   • Benefícios         ← a Convenção Coletiva vinculada (contrato ou posto);
--   • "Outros"           ← campo NOVO, proventos fora do convencional,
--                          vários por vaga, que vão para a solicitação de vaga.
-- Contexto: contrato de 750 postos — cada informação preenchida uma vez só.
--
-- O QUE HAVIA: o botão "Puxar da Planilha" chamava rec_custo_do_posto, UM
-- posto por clique, e essa RPC só libera os menus do Recrutamento/Central.
-- Quem edita o quadro pela Licitação (menu fantasma contrato_quadro_postos)
-- recebia "Sem permissão", que a tela mostrava como "posto não encontrado".
-- E a periculosidade do quadro morria na geração: a vaga não tinha coluna.
--
-- O QUE MUDA AQUI
--   1. "CONTRATO_QUADRO_POSTO".outros_proventos jsonb — [{descricao, valor}].
--   2. "SISTEMA_RECRUTAMENTO".outros_proventos jsonb e periculosidade_quanto
--      text ("30%"), para a vaga receber o que o quadro declara.
--   3. lic_quadro_remuneracao_do_contrato(contrato) — a remuneração de TODOS
--      os postos vigentes da Planilha de Custo do contrato numa chamada só,
--      mais a referência de convenção de cada posto (o mesmo resolvedor
--      lic_referencia_do_posto_interno que a vaga usa no retrato). Gate:
--      quem vê o quadro do contrato OU quem já podia chamar rec_custo_do_posto.
--   4. contrato_quadro_listar / contrato_quadro_salvar / contrato_quadro_
--      gerar_vagas recriadas: corpo IGUAL ao das migs 20260930000241 e
--      20261115000700, só com outros_proventos e a periculosidade a mais.
--
-- As regras de cada campo (base da insalubridade, o que é automático e o que
-- não sobrescreve) ficam no front, em src/lib/licitacoes/quadroPostos.ts —
-- aqui só o dado cru, como a Planilha guarda.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1/2. Colunas ─────────────────────────────────────────────────────────
ALTER TABLE public."CONTRATO_QUADRO_POSTO"
  ADD COLUMN IF NOT EXISTS outros_proventos jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public."CONTRATO_QUADRO_POSTO"
  DROP CONSTRAINT IF EXISTS contrato_quadro_posto_outros_array;
ALTER TABLE public."CONTRATO_QUADRO_POSTO"
  ADD CONSTRAINT contrato_quadro_posto_outros_array CHECK (jsonb_typeof(outros_proventos) = 'array');

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS outros_proventos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS periculosidade_quanto text;

COMMENT ON COLUMN public."CONTRATO_QUADRO_POSTO".outros_proventos IS
  'SIS-2026-0884: proventos fora do convencional, digitados à mão — [{"descricao": text, "valor": numeric (R$/mês)}]. Vão para SISTEMA_RECRUTAMENTO.outros_proventos na geração.';
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".outros_proventos IS
  'SIS-2026-0884: [{"descricao", "valor"}] vindos do Quadro de Postos do contrato.';
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".periculosidade_quanto IS
  'SIS-2026-0884: percentual de periculosidade ("30%"), vindo do Quadro de Postos do contrato. Vazio = não recebe/não informado.';

-- Lista de proventos limpa: só item com descrição e valor > 0, no máximo 30.
-- Recusa em vez de descartar calado — quem digitou precisa saber.
CREATE OR REPLACE FUNCTION public.contrato_quadro_outros_limpos(p_outros jsonb, p_rotulo text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  v_item jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_desc text;
  v_val  numeric;
BEGIN
  IF p_outros IS NULL OR jsonb_typeof(p_outros) = 'null' THEN
    RETURN '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_outros) <> 'array' THEN
    RAISE EXCEPTION '%: "Outros" precisa ser uma lista.', p_rotulo;
  END IF;
  IF jsonb_array_length(p_outros) > 30 THEN
    RAISE EXCEPTION '%: no máximo 30 itens em "Outros".', p_rotulo;
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_outros) LOOP
    v_desc := btrim(coalesce(v_item->>'descricao', ''));
    v_val  := NULLIF(btrim(coalesce(v_item->>'valor', '')), '')::numeric;
    IF v_desc = '' AND coalesce(v_val, 0) = 0 THEN
      CONTINUE; -- linha em branco
    END IF;
    IF v_desc = '' THEN
      RAISE EXCEPTION '%: item de "Outros" sem descrição.', p_rotulo;
    END IF;
    IF coalesce(v_val, 0) <= 0 THEN
      RAISE EXCEPTION '%: o item "%" de "Outros" precisa de valor maior que zero.', p_rotulo, v_desc;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object('descricao', v_desc, 'valor', round(v_val, 2)));
  END LOOP;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.contrato_quadro_outros_limpos(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_quadro_outros_limpos(jsonb, text) TO authenticated;

-- ── 3. Remuneração de todos os postos do contrato ────────────────────────
-- Mesmo casamento de contrato e de posto de rec_postos_planilha_do_contrato
-- (mig 20261115000500): contrato_id OU nome do contrato na mesma empresa,
-- planilha não encerrada, um posto por nome normalizado, vigência mais nova.
CREATE OR REPLACE FUNCTION public.lic_quadro_remuneracao_do_contrato(p_contrato_id uuid)
RETURNS TABLE(
  posto text, planilha_custo_id uuid, vigencia date,
  salario numeric, insalubridade numeric, periculosidade numeric,
  lideranca numeric, adicional_noturno_reduzido numeric, adicional_noturno numeric,
  adicional_extra numeric, dsr numeric,
  vt numeric, va numeric, vr numeric, lanche numeric, cesta_basica numeric, assistencia_medica numeric,
  referencia jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  v_empresa  uuid;
  v_contrato text;
BEGIN
  IF NOT (public.can_access(auth.uid(), 'contrato_quadro_postos', 'visualizar')
          OR public.can_access(auth.uid(), 'contrato_quadro_postos', 'incluir')
          OR public.can_access(auth.uid(), 'contrato_quadro_postos', 'alterar')
          OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT c.empresa_id, c.nome INTO v_empresa, v_contrato
    FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_empresa IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH linhas AS (
    SELECT DISTINCT ON (public.sup_norm_nome(pc.posto)) pc.*
      FROM public.planilha_custo pc
     WHERE btrim(coalesce(pc.posto, '')) <> ''
       AND coalesce(pc.encerrado, false) = false
       AND (pc.contrato_id = p_contrato_id
            OR (pc.contrato_id IS NULL
                AND pc.empresa_id = v_empresa
                AND public.sup_norm_nome(pc.contrato) = public.sup_norm_nome(v_contrato)))
     ORDER BY public.sup_norm_nome(pc.posto), pc.data_vigencia DESC NULLS LAST, pc.created_at DESC NULLS LAST
  )
  SELECT btrim(l.posto), l.id, l.data_vigencia,
         l.salario, l.insalubridade, l.periculosidade,
         l.lideranca, l.adicional_noturno_reduzido, l.adicional_noturno,
         l.adicional_extra, l.dsr,
         l.transporte, l.aux_alimentacao, l.aux_refeicao, l.aux_lanche, l.cesta_basica, l.assistencia_medica,
         public.lic_referencia_do_posto_interno(p_contrato_id, btrim(l.posto))
    FROM linhas l
   ORDER BY btrim(l.posto);
END $fn$;
REVOKE ALL ON FUNCTION public.lic_quadro_remuneracao_do_contrato(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lic_quadro_remuneracao_do_contrato(uuid) TO authenticated;

-- ── 4a. Ler o quadro (+ outros_proventos) ────────────────────────────────
-- O tipo de retorno muda: CREATE OR REPLACE não aceita, então DROP antes.
DROP FUNCTION IF EXISTS public.contrato_quadro_listar(uuid);
CREATE FUNCTION public.contrato_quadro_listar(p_contrato_id uuid)
RETURNS TABLE (
  id uuid, contrato_id uuid, posto_nome text, sup_posto_id uuid,
  funcao_nome text, sup_funcao_id uuid,
  cargo text, quantidade int, escala text, horario text, salario numeric,
  insalubridade_pct numeric, periculosidade_pct numeric, beneficios text,
  estado text, cidade text, local_exato text, data_inicio_prevista date,
  motivo_vaga text, req_obrigatorios text, req_desejaveis text,
  exp_minima text, exp_minima_qual text, observacao text,
  gerar_vagas boolean, ordem int,
  vagas_geradas int, vagas_vivas int, na_planilha boolean,
  outros_proventos jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.can_access(auth.uid(), 'contrato_quadro_postos', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver o quadro de postos do contrato.';
  END IF;

  RETURN QUERY
  SELECT q.id, q.contrato_id, q.posto_nome, q.sup_posto_id,
         q.funcao_nome, q.sup_funcao_id,
         q.cargo, q.quantidade, q.escala, q.horario, q.salario,
         q.insalubridade_pct, q.periculosidade_pct, q.beneficios,
         q.estado, q.cidade, q.local_exato, q.data_inicio_prevista,
         q.motivo_vaga, q.req_obrigatorios, q.req_desejaveis,
         q.exp_minima, q.exp_minima_qual, q.observacao,
         q.gerar_vagas, q.ordem,
         (SELECT count(*)::int FROM public."SISTEMA_RECRUTAMENTO" v
           WHERE v.quadro_posto_id = q.id),
         (SELECT count(*)::int FROM public."SISTEMA_RECRUTAMENTO" v
           WHERE v.quadro_posto_id = q.id
             AND btrim(coalesce(v.status, '')) NOT IN ('Reprovada', 'Cancelada')),
         EXISTS (
           SELECT 1 FROM public.planilha_custo pc
            WHERE btrim(coalesce(pc.posto, '')) <> ''
              AND public.sup_norm_nome(pc.posto) = public.sup_norm_nome(q.posto_nome)
              AND (pc.contrato_id = q.contrato_id
                   OR (pc.contrato_id IS NULL AND pc.empresa_id = q.empresa_id))),
         q.outros_proventos
    FROM public."CONTRATO_QUADRO_POSTO" q
   WHERE q.contrato_id = p_contrato_id AND q.ativo
   ORDER BY q.ordem, q.posto_nome, q.funcao_nome;
END $fn$;

REVOKE ALL ON FUNCTION public.contrato_quadro_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_quadro_listar(uuid) TO authenticated;

-- ── 4b. Salvar o quadro (+ outros_proventos) ─────────────────────────────
-- Corpo igual ao da 20260930000241; a única diferença é a coluna nova
-- (gravada já limpa por contrato_quadro_outros_limpos).
CREATE OR REPLACE FUNCTION public.contrato_quadro_salvar(
  p_contrato_id uuid,
  p_linhas      jsonb
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_empresa  uuid;
  v_linha    jsonb;
  v_ids      uuid[] := ARRAY[]::uuid[];
  v_id       uuid;
  v_nome     text;
  v_sup      uuid;
  v_fnome    text;
  v_fun      uuid;
  v_contrato text;
  v_autor    text;
  v_chaves   text[] := ARRAY[]::text[];
  v_n        int := 0;
  v_outros   jsonb;
BEGIN
  IF NOT public.can_access(auth.uid(), 'contrato_quadro_postos', 'alterar')
     AND NOT public.can_access(auth.uid(), 'contrato_quadro_postos', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o quadro de postos do contrato.';
  END IF;

  SELECT c.empresa_id, c.nome INTO v_empresa, v_contrato
    FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  SELECT pr.display_name INTO v_autor FROM public.profiles pr WHERE pr.id = auth.uid();

  IF jsonb_typeof(coalesce(p_linhas, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'O quadro precisa ser uma lista de postos.';
  END IF;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_n := v_n + 1;
    v_nome := btrim(coalesce(v_linha->>'posto_nome', ''));

    IF v_nome = '' THEN
      RAISE EXCEPTION 'Posto nº %: informe o nome do posto.', v_n;
    END IF;
    v_fnome := btrim(coalesce(v_linha->>'funcao_nome', ''));
    IF v_fnome = '' THEN
      RAISE EXCEPTION 'Posto "%": escolha a função. É dela que sai o enxoval de uniforme e EPI, e é por função que se conta quantas pessoas o posto precisa.', v_nome;
    END IF;
    IF btrim(coalesce(v_linha->>'cargo', '')) = '' THEN
      RAISE EXCEPTION 'Posto "%" · função "%": informe o cargo.', v_nome, v_fnome;
    END IF;
    IF coalesce((v_linha->>'quantidade')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'Posto "%": a quantidade de colaboradores precisa ser 1 ou mais.', v_nome;
    END IF;
    IF btrim(coalesce(v_linha->>'escala', '')) = '' THEN
      RAISE EXCEPTION 'Posto "%": informe a escala.', v_nome;
    END IF;
    IF coalesce((v_linha->>'salario')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Posto "%": informe o salário.', v_nome;
    END IF;
    IF btrim(coalesce(v_linha->>'local_exato', '')) = '' THEN
      RAISE EXCEPTION 'Posto "%": informe o local exato de trabalho.', v_nome;
    END IF;
    IF btrim(coalesce(v_linha->>'cidade', '')) = '' OR btrim(coalesce(v_linha->>'estado', '')) = '' THEN
      RAISE EXCEPTION 'Posto "%": informe estado e cidade.', v_nome;
    END IF;
    IF (v_linha->>'data_inicio_prevista') IS NULL THEN
      RAISE EXCEPTION 'Posto "%": informe a data prevista de início.', v_nome;
    END IF;

    v_outros := public.contrato_quadro_outros_limpos(v_linha->'outros_proventos',
                  format('Posto "%s" · função "%s"', v_nome, v_fnome));

    IF (public.sup_norm_nome(v_nome) || '|' || public.sup_norm_nome(v_fnome)) = ANY (v_chaves) THEN
      RAISE EXCEPTION 'A função "%" aparece duas vezes no posto "%". Some as quantidades numa linha só — duas linhas iguais deixariam sem resposta de qual delas é cada vaga.', v_fnome, v_nome;
    END IF;
    v_chaves := v_chaves || (public.sup_norm_nome(v_nome) || '|' || public.sup_norm_nome(v_fnome));

    SELECT sp.id INTO v_sup FROM public.sup_posto sp
     WHERE sp.contrato_id = p_contrato_id
       AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(v_nome)
     LIMIT 1;

    IF v_sup IS NULL THEN
      INSERT INTO public.sup_posto (empresa_id, contrato_id, nome, ativo, aprovado, created_by)
      VALUES (v_empresa, p_contrato_id, v_nome, true, true, auth.uid())
      ON CONFLICT (contrato_id, nome) DO UPDATE SET ativo = true, aprovado = true
      RETURNING id INTO v_sup;
    ELSE
      UPDATE public.sup_posto SET ativo = true, aprovado = true, updated_at = now()
       WHERE id = v_sup;
    END IF;

    SELECT f.id INTO v_fun FROM public.sup_funcao f
     WHERE f.posto_id = v_sup
       AND public.sup_norm_nome(f.nome) = public.sup_norm_nome(v_fnome)
     LIMIT 1;

    IF v_fun IS NULL THEN
      INSERT INTO public.sup_funcao (posto_id, nome, ativo, aprovado, created_by)
      VALUES (v_sup, v_fnome, true, false, auth.uid())
      ON CONFLICT (posto_id, nome) DO UPDATE SET ativo = true
      RETURNING id INTO v_fun;

      INSERT INTO public.sup_cat_alteracao (
        empresa_id, tipo_entidade, tipo_acao, alvo_id, dados, contexto,
        descricao, status, criado_por, criado_por_nome)
      VALUES (
        v_empresa, 'funcao', 'criar', v_fun,
        jsonb_build_object('nome', v_fnome, 'posto_id', v_sup),
        jsonb_build_object('contrato', v_contrato, 'posto', v_nome, 'funcao', v_fnome),
        format('Criar função "%s" (pelo quadro de postos do contrato)', v_fnome),
        'RASCUNHO', auth.uid(), v_autor);
    ELSE
      UPDATE public.sup_funcao SET ativo = true, updated_at = now() WHERE id = v_fun;
    END IF;

    v_id := NULLIF(btrim(coalesce(v_linha->>'id', '')), '')::uuid;

    IF v_id IS NULL THEN
      INSERT INTO public."CONTRATO_QUADRO_POSTO" (
        contrato_id, empresa_id, posto_nome, sup_posto_id,
        funcao_nome, sup_funcao_id, cargo, quantidade,
        escala, horario, salario, insalubridade_pct, periculosidade_pct,
        beneficios, estado, cidade, local_exato, data_inicio_prevista,
        motivo_vaga, req_obrigatorios, req_desejaveis, exp_minima,
        exp_minima_qual, observacao, gerar_vagas, ordem, created_by,
        outros_proventos)
      VALUES (
        p_contrato_id, v_empresa, v_nome, v_sup,
        v_fnome, v_fun,
        btrim(v_linha->>'cargo'), (v_linha->>'quantidade')::int,
        btrim(v_linha->>'escala'), NULLIF(btrim(coalesce(v_linha->>'horario', '')), ''),
        (v_linha->>'salario')::numeric,
        coalesce((v_linha->>'insalubridade_pct')::numeric, 0),
        coalesce((v_linha->>'periculosidade_pct')::numeric, 0),
        NULLIF(btrim(coalesce(v_linha->>'beneficios', '')), ''),
        upper(btrim(v_linha->>'estado')), btrim(v_linha->>'cidade'),
        btrim(v_linha->>'local_exato'), (v_linha->>'data_inicio_prevista')::date,
        coalesce(NULLIF(btrim(coalesce(v_linha->>'motivo_vaga', '')), ''), 'Admissão'),
        NULLIF(btrim(coalesce(v_linha->>'req_obrigatorios', '')), ''),
        NULLIF(btrim(coalesce(v_linha->>'req_desejaveis', '')), ''),
        coalesce(NULLIF(btrim(coalesce(v_linha->>'exp_minima', '')), ''), 'Não'),
        NULLIF(btrim(coalesce(v_linha->>'exp_minima_qual', '')), ''),
        NULLIF(btrim(coalesce(v_linha->>'observacao', '')), ''),
        coalesce((v_linha->>'gerar_vagas')::boolean, true),
        v_n, auth.uid(),
        v_outros)
      ON CONFLICT (contrato_id, posto_nome, funcao_nome) DO UPDATE SET
        ativo = true, sup_posto_id = EXCLUDED.sup_posto_id,
        sup_funcao_id = EXCLUDED.sup_funcao_id, cargo = EXCLUDED.cargo,
        quantidade = EXCLUDED.quantidade, escala = EXCLUDED.escala,
        horario = EXCLUDED.horario, salario = EXCLUDED.salario,
        insalubridade_pct = EXCLUDED.insalubridade_pct,
        periculosidade_pct = EXCLUDED.periculosidade_pct,
        beneficios = EXCLUDED.beneficios, estado = EXCLUDED.estado,
        cidade = EXCLUDED.cidade, local_exato = EXCLUDED.local_exato,
        data_inicio_prevista = EXCLUDED.data_inicio_prevista,
        motivo_vaga = EXCLUDED.motivo_vaga,
        req_obrigatorios = EXCLUDED.req_obrigatorios,
        req_desejaveis = EXCLUDED.req_desejaveis,
        exp_minima = EXCLUDED.exp_minima, exp_minima_qual = EXCLUDED.exp_minima_qual,
        observacao = EXCLUDED.observacao, gerar_vagas = EXCLUDED.gerar_vagas,
        ordem = EXCLUDED.ordem, outros_proventos = EXCLUDED.outros_proventos,
        updated_at = now()
      RETURNING id INTO v_id;
    ELSE
      UPDATE public."CONTRATO_QUADRO_POSTO" SET
        posto_nome = v_nome, sup_posto_id = v_sup,
        funcao_nome = v_fnome, sup_funcao_id = v_fun,
        cargo = btrim(v_linha->>'cargo'), quantidade = (v_linha->>'quantidade')::int,
        escala = btrim(v_linha->>'escala'),
        horario = NULLIF(btrim(coalesce(v_linha->>'horario', '')), ''),
        salario = (v_linha->>'salario')::numeric,
        insalubridade_pct = coalesce((v_linha->>'insalubridade_pct')::numeric, 0),
        periculosidade_pct = coalesce((v_linha->>'periculosidade_pct')::numeric, 0),
        beneficios = NULLIF(btrim(coalesce(v_linha->>'beneficios', '')), ''),
        estado = upper(btrim(v_linha->>'estado')), cidade = btrim(v_linha->>'cidade'),
        local_exato = btrim(v_linha->>'local_exato'),
        data_inicio_prevista = (v_linha->>'data_inicio_prevista')::date,
        motivo_vaga = coalesce(NULLIF(btrim(coalesce(v_linha->>'motivo_vaga', '')), ''), 'Admissão'),
        req_obrigatorios = NULLIF(btrim(coalesce(v_linha->>'req_obrigatorios', '')), ''),
        req_desejaveis = NULLIF(btrim(coalesce(v_linha->>'req_desejaveis', '')), ''),
        exp_minima = coalesce(NULLIF(btrim(coalesce(v_linha->>'exp_minima', '')), ''), 'Não'),
        exp_minima_qual = NULLIF(btrim(coalesce(v_linha->>'exp_minima_qual', '')), ''),
        observacao = NULLIF(btrim(coalesce(v_linha->>'observacao', '')), ''),
        gerar_vagas = coalesce((v_linha->>'gerar_vagas')::boolean, true),
        outros_proventos = v_outros,
        ordem = v_n, ativo = true, updated_at = now()
      WHERE id = v_id AND contrato_id = p_contrato_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A linha do posto "%" não pertence a este contrato.', v_nome;
      END IF;
    END IF;

    v_ids := v_ids || v_id;
  END LOOP;

  UPDATE public."CONTRATO_QUADRO_POSTO"
     SET ativo = false, updated_at = now()
   WHERE contrato_id = p_contrato_id AND ativo AND NOT (id = ANY (v_ids));

  RETURN v_n;
END $fn$;

REVOKE ALL ON FUNCTION public.contrato_quadro_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_quadro_salvar(uuid, jsonb) TO authenticated;

-- ── 4c. Gerar as vagas (+ periculosidade e outros_proventos) ─────────────
-- Corpo igual ao da 20261115000700 (prazo de 3 dias corridos).
CREATE OR REPLACE FUNCTION public.contrato_quadro_gerar_vagas(
  p_contrato_id uuid,
  p_simular     boolean DEFAULT false
)
RETURNS TABLE (posto_nome text, funcao_nome text, criadas int, ja_existiam int, primeira_vaga bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_q          record;
  v_contrato   text;
  v_nome_user  text;
  v_email      text;
  v_i          int;
  v_ja         int;
  v_criadas    int;
  v_primeira   bigint;
  v_id         bigint;
  v_dias       int;
  v_insal_txt  text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'contrato_quadro_postos', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para abrir as vagas do quadro de postos.';
  END IF;

  SELECT c.nome INTO v_contrato FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_contrato IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  SELECT coalesce(u.raw_user_meta_data->>'nome', u.email), u.email
    INTO v_nome_user, v_email
    FROM auth.users u WHERE u.id = auth.uid();

  FOR v_q IN
    SELECT q.posto_nome, q.funcao_nome, q.data_inicio_prevista
      FROM public."CONTRATO_QUADRO_POSTO" q
     WHERE q.contrato_id = p_contrato_id AND q.ativo AND q.gerar_vagas
  LOOP
    v_dias := v_q.data_inicio_prevista - current_date;
    IF v_dias IS NULL OR v_dias < public.rec_antecedencia_minima_vaga() THEN
      RAISE EXCEPTION 'Posto "%" · função "%": a data prevista de início (%) tem % dia(s) de antecedência. A vaga precisa de no mínimo % dias. A primeira data possível é %.',
        v_q.posto_nome, v_q.funcao_nome, coalesce(to_char(v_q.data_inicio_prevista, 'DD/MM/YYYY'), '—'), GREATEST(coalesce(v_dias, 0), 0),
        public.rec_antecedencia_minima_vaga(), to_char(current_date + public.rec_antecedencia_minima_vaga(), 'DD/MM/YYYY');
    END IF;
  END LOOP;

  FOR v_q IN
    SELECT q.* FROM public."CONTRATO_QUADRO_POSTO" q
     WHERE q.contrato_id = p_contrato_id AND q.ativo AND q.gerar_vagas
     ORDER BY q.ordem, q.posto_nome, q.funcao_nome
  LOOP
    SELECT count(*)::int INTO v_ja
      FROM public."SISTEMA_RECRUTAMENTO" v WHERE v.quadro_posto_id = v_q.id;

    v_criadas := 0;
    v_primeira := NULL;

    v_insal_txt := public.rec_pct_txt(v_q.insalubridade_pct);

    IF NOT p_simular THEN
      FOR v_i IN 1..v_q.quantidade LOOP
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" v
           WHERE v.quadro_posto_id = v_q.id AND v.quadro_indice = v_i);

        INSERT INTO public."SISTEMA_RECRUTAMENTO" (
          motivo_vaga, contrato, cargo, estado, cidade,
          quantidade_vagas, data_inicio_prevista, escala, horario, salario,
          insalubridade_recebe, insalubridade_quanto, beneficios, local_exato,
          alta_rotatividade, req_obrigatorios, req_desejaveis,
          exp_minima, exp_minima_qual, observacao_importante,
          status, solicitante_nome, solicitante_cpf,
          contrato_id, posto_id, funcao_id, quadro_posto_id, quadro_indice, administrativa,
          periculosidade_quanto, outros_proventos)
        VALUES (
          v_q.motivo_vaga, v_contrato, v_q.cargo, v_q.estado, v_q.cidade,
          1, to_char(v_q.data_inicio_prevista, 'YYYY-MM-DD'),
          v_q.escala, v_q.horario, public.rec_brl_txt(v_q.salario),
          CASE WHEN v_q.insalubridade_pct > 0 THEN 'Sim' ELSE 'Não' END,
          v_insal_txt, v_q.beneficios, v_q.local_exato,
          'Não', v_q.req_obrigatorios, v_q.req_desejaveis,
          v_q.exp_minima, v_q.exp_minima_qual,
          btrim(concat_ws(E'\n',
            format('Vaga %s de %s — posto "%s", função "%s" — quadro do contrato %s.',
                   v_i, v_q.quantidade, v_q.posto_nome, v_q.funcao_nome, v_contrato),
            v_q.observacao)),
          'Pendente Analista', v_nome_user, v_email,
          p_contrato_id, v_q.sup_posto_id, v_q.sup_funcao_id, v_q.id, v_i, false,
          NULLIF(public.rec_pct_txt(v_q.periculosidade_pct), ''),
          coalesce(v_q.outros_proventos, '[]'::jsonb))
        RETURNING id INTO v_id;

        v_criadas := v_criadas + 1;
        IF v_primeira IS NULL THEN v_primeira := v_id; END IF;
      END LOOP;
    ELSE
      v_criadas := GREATEST(v_q.quantidade - v_ja, 0);
    END IF;

    posto_nome    := v_q.posto_nome;
    funcao_nome   := v_q.funcao_nome;
    criadas       := v_criadas;
    ja_existiam   := v_ja;
    primeira_vaga := v_primeira;
    RETURN NEXT;
  END LOOP;
END $fn$;

REVOKE ALL ON FUNCTION public.contrato_quadro_gerar_vagas(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_quadro_gerar_vagas(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Reaplicar contrato_quadro_listar e contrato_quadro_salvar da
--   20260930000241 (listar precisa de DROP FUNCTION antes: o retorno muda) e
--   contrato_quadro_gerar_vagas da 20261115000700. Depois:
--   DROP FUNCTION IF EXISTS public.lic_quadro_remuneracao_do_contrato(uuid);
--   DROP FUNCTION IF EXISTS public.contrato_quadro_outros_limpos(jsonb, text);
--   ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN IF EXISTS outros_proventos,
--     DROP COLUMN IF EXISTS periculosidade_quanto;
--   ALTER TABLE public."CONTRATO_QUADRO_POSTO" DROP CONSTRAINT IF EXISTS contrato_quadro_posto_outros_array,
--     DROP COLUMN IF EXISTS outros_proventos;
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
