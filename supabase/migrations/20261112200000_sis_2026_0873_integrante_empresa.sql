-- SIS-2026-0873 — Integrante "Empresa" no rateio do Malote e no Fluxo de Caixa
-- ============================================================================
-- Pedido: "Preciso que crie o integrante empresa, não precisa criar para todas as empresas, somente 'Empresa' mesmo."
-- O filtro Integrante do Fluxo de Caixa (e o rateio do Malote) só oferecia colaboradores.
--
-- O integrante é sempre um colaborador de EMPREGADOS (malote_despesa_rateio_linha.integrante_empregado_id e
-- fluxo_caixa_importado.integrante_empregado_id, ambos SEM FK). "Empresa" NÃO vira linha em EMPREGADOS: o INSERT dispararia
-- organograma_empregado_gatilho (nó novo no Organograma) e trn_aluno_do_empregado_trg (aluno novo em Treinamentos), e ele
-- passaria a aparecer como colaborador no RH. Em vez disso, o ID fixo -1 quer dizer "Empresa" (os IDs de EMPREGADOS são
-- positivos; o bloco 0 confere). -1 e não 0: o front testa `!integrante_empregado_id` (rateioValidacao.ts) e 0 contaria como vazio.
-- No front, o mesmo número mora em src/lib/integranteEmpresa.ts (useIntegrantes põe "Empresa" no topo da lista do Malote).
--
--   1. fluxo_integrante_nome(-1)          = 'Empresa'. As views do Fluxo (Malote e importado) já chamam esta função, então a
--                                           coluna/filtro Integrante mostram "Empresa" sem recriar view nenhuma.
--   2. fluxo_caixa_integrantes_listar      : "Empresa" no topo da lista do lápis e da alteração em massa do Fluxo.
--   3. fluxo_caixa_trocar_integrante       : mesma definição de 20261111150000, com os nomes via fluxo_integrante_nome
--                                           (antes buscava em EMPREGADOS e recusava -1 com "Integrante não encontrado").
--   4. malote_despesa_relatorio_exportar   : mesma definição de 20260930000186; a coluna rateio_integrante mostra "Empresa".
--
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   (antes, tirar o -1 das linhas para não ficarem com integrante sem nome:)
--   UPDATE public.malote_despesa_rateio_linha SET integrante_empregado_id = NULL WHERE integrante_empregado_id = -1;
--   UPDATE public.fluxo_caixa_importado       SET integrante_empregado_id = NULL WHERE integrante_empregado_id = -1;
--   Reaplicar fluxo_integrante_nome e fluxo_caixa_integrantes_listar de 20261110000200_sis_2026_0823_fluxo_caixa_integrante.sql,
--   fluxo_caixa_trocar_integrante de 20261111150000_sis_2026_0859_fluxo_caixa_integrante_importado.sql e
--   malote_despesa_relatorio_exportar de 20260930000186_malote_relatorio_despesas_exportar.sql.

SET lock_timeout = '5s';

-- 0. -1 tem que estar livre em EMPREGADOS (senão o "Empresa" esconderia um colaborador de verdade).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."EMPREGADOS" WHERE "ID" = -1) THEN
    RAISE EXCEPTION 'SIS-2026-0873: já existe EMPREGADOS."ID" = -1; o integrante "Empresa" precisa de outro número.';
  END IF;
END $$;

-- 1. nome do integrante (usado pelas views do Fluxo)
CREATE OR REPLACE FUNCTION public.fluxo_integrante_nome(_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN _id = -1 THEN 'Empresa'
              ELSE (SELECT e."Nome" FROM public."EMPREGADOS" e WHERE e."ID" = _id) END;
$$;
REVOKE ALL ON FUNCTION public.fluxo_integrante_nome(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fluxo_integrante_nome(bigint) TO authenticated, service_role;

-- 2. lista do seletor do Fluxo: "Empresa" primeiro, depois os colaboradores trabalhando
CREATE OR REPLACE FUNCTION public.fluxo_caixa_integrantes_listar()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Fluxo de Caixa.';
  END IF;
  RETURN (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'nome', x.nome) ORDER BY x.ordem, x.nome), '[]'::json)
            FROM (SELECT 0 AS ordem, -1::bigint AS id, 'Empresa'::text AS nome
                  UNION ALL
                  SELECT 1, e."ID"::bigint, e."Nome"::text
                    FROM public."EMPREGADOS" e WHERE e."Situação" = 'Trabalhando' AND e."Nome" IS NOT NULL) x);
END;
$$;
REVOKE ALL ON FUNCTION public.fluxo_caixa_integrantes_listar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_integrantes_listar() TO authenticated, service_role;

-- 3. troca de integrante pelo Fluxo (definição de 20261111150000; só os nomes passam por fluxo_integrante_nome)
CREATE OR REPLACE FUNCTION public.fluxo_caixa_trocar_integrante(_origem text, _despesa_id uuid, _empregado_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n_rateio int;
  v_rateio_id uuid;
  v_antigo bigint;
  v_antigo_nome text;
  v_novo_nome text;
  v_n_cotas int;
  v_n_diferentes int;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Fluxo de Caixa.';
  END IF;
  IF _empregado_id IS NULL THEN
    RAISE EXCEPTION 'Informe o integrante.';
  END IF;
  IF _origem IS DISTINCT FROM 'malote' AND _origem IS DISTINCT FROM 'importacao_historica' THEN
    RAISE EXCEPTION 'Esta origem não permite trocar o integrante pelo Fluxo de Caixa (só Malote e importação da planilha).';
  END IF;

  v_novo_nome := public.fluxo_integrante_nome(_empregado_id);  -- SIS-2026-0873: -1 = "Empresa"
  IF v_novo_nome IS NULL THEN
    RAISE EXCEPTION 'Integrante não encontrado.';
  END IF;

  -- SIS-2026-0859: lançamento importado da planilha. _despesa_id é o id da linha ou do grupo de rateio (o despesa_id da view);
  -- o integrante vale para o lançamento inteiro, então todas as cotas recebem o mesmo.
  IF _origem = 'importacao_historica' THEN
    SELECT count(*), count(*) FILTER (WHERE fi.integrante_empregado_id IS DISTINCT FROM _empregado_id), min(fi.integrante_empregado_id)
      INTO v_n_cotas, v_n_diferentes, v_antigo
      FROM public.fluxo_caixa_importado fi
     WHERE COALESCE(fi.rateio_grupo_id, fi.id) = _despesa_id
       AND fi.deleted_at IS NULL
       AND fi.conferencia <> 'ja_existe_no_erp';
    IF v_n_cotas = 0 THEN
      RAISE EXCEPTION 'Lançamento importado não encontrado.';
    END IF;
    IF v_n_diferentes = 0 THEN
      RAISE EXCEPTION 'O lançamento já está com este integrante.';
    END IF;
    IF v_antigo IS NOT NULL THEN
      v_antigo_nome := public.fluxo_integrante_nome(v_antigo);  -- SIS-2026-0873: -1 = "Empresa"
    END IF;

    UPDATE public.fluxo_caixa_importado fi
       SET integrante_empregado_id = _empregado_id
     WHERE COALESCE(fi.rateio_grupo_id, fi.id) = _despesa_id
       AND fi.deleted_at IS NULL
       AND fi.conferencia <> 'ja_existe_no_erp';

    PERFORM public.fluxo_caixa_registrar_evento(
      'importacao_historica', _despesa_id, 'integrante_alterado',
      format('Integrante alterado pelo Fluxo de Caixa: "%s" → "%s".', COALESCE(v_antigo_nome, '(sem integrante)'), v_novo_nome),
      jsonb_build_object('antes', v_antigo, 'depois', _empregado_id)
    );
    RETURN;
  END IF;

  -- Malote (SIS-2026-0823, sem mudança): grava na linha de rateio de origem; uma só linha de rateio.
  IF NOT EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = _despesa_id AND d.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Despesa do Malote não encontrada.';
  END IF;

  SELECT count(*) INTO v_n_rateio FROM public.malote_despesa_rateio_linha WHERE despesa_id = _despesa_id;
  IF v_n_rateio > 1 THEN
    RAISE EXCEPTION 'Esta despesa é rateada em várias linhas: ajuste o integrante de cada linha direto na grade de rateio do Malote.';
  END IF;
  IF v_n_rateio = 0 THEN
    RAISE EXCEPTION 'Esta despesa não tem linha de rateio para receber o integrante: ajuste direto no Malote.';
  END IF;

  SELECT rl.id, rl.integrante_empregado_id INTO v_rateio_id, v_antigo
    FROM public.malote_despesa_rateio_linha rl WHERE rl.despesa_id = _despesa_id;
  IF v_antigo IS NOT DISTINCT FROM _empregado_id THEN
    RAISE EXCEPTION 'O lançamento já está com este integrante.';
  END IF;

  IF v_antigo IS NOT NULL THEN
    v_antigo_nome := public.fluxo_integrante_nome(v_antigo);  -- SIS-2026-0873: -1 = "Empresa"
  END IF;

  UPDATE public.malote_despesa_rateio_linha SET integrante_empregado_id = _empregado_id WHERE id = v_rateio_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_despesa_id, 'edicao',
          format('Integrante alterado pelo Fluxo de Caixa: "%s" → "%s".', COALESCE(v_antigo_nome, '(sem integrante)'), v_novo_nome),
          NULL, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.fluxo_caixa_trocar_integrante(text, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_trocar_integrante(text, uuid, bigint) TO authenticated, service_role;

-- 4. relatório de despesas do Malote (definição de 20260930000186; só a coluna do integrante muda)
CREATE OR REPLACE FUNCTION public.malote_despesa_relatorio_exportar()
RETURNS TABLE (
  id uuid,
  numero text,
  origem text,
  status text,
  nome text,
  empresa text,
  classificacao text,
  contrato text,
  rateio_ordem integer,
  rateio_fornecedor text,
  rateio_integrante text,
  rateio_valor numeric,
  valor_total numeric,
  valor_aprovado numeric,
  forma_pagamento text,
  banco text,
  data_pagamento date,
  competencia date,
  parcelado boolean,
  numero_parcelas integer,
  nivel_aprovacao_atual smallint,
  excecao boolean,
  justificativa_excecao text,
  motivo_ajuste text,
  pago_em timestamptz,
  pago_por text,
  conferido_em timestamptz,
  conferido_por text,
  created_at timestamptz,
  criado_por text,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'malote_relatorio_despesas', 'exportar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para exportar o relatório de despesas do Malote.';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.numero,
    d.origem::text,
    d.status::text,
    d.nome,
    COALESCE(e.nome_fantasia, e.razao_social),
    COALESCE(rcl.nome, c.nome),
    COALESCE(rct.nome, ct.nome),
    rl.ordem,
    COALESCE(rf.nome_fantasia, rf.razao_social),
    CASE WHEN rl.integrante_empregado_id = -1 THEN 'Empresa' ELSE remp."Nome" END,  -- SIS-2026-0873
    rl.valor,
    d.valor_total,
    d.valor_aprovado,
    d.forma_pagamento,
    b.nome,
    d.data_pagamento,
    d.competencia,
    d.parcelado,
    d.numero_parcelas,
    d.nivel_aprovacao_atual,
    d.excecao,
    d.justificativa_excecao,
    d.motivo_ajuste,
    d.pago_em,
    COALESCE(pp.display_name, pp.email),
    d.conferido_em,
    COALESCE(cf.display_name, cf.email),
    d.created_at,
    COALESCE(cr.display_name, cr.email),
    d.updated_at
  FROM public.malote_despesa d
  LEFT JOIN public.empresas e ON e.id = d.empresa_id
  LEFT JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
  LEFT JOIN public.contratos ct ON ct.id = d.contrato_id
  LEFT JOIN public.malote_cartao_banco b ON b.id = d.banco_id
  LEFT JOIN public.profiles pp ON pp.id = d.pago_por
  LEFT JOIN public.profiles cf ON cf.id = d.conferido_por
  LEFT JOIN public.profiles cr ON cr.id = d.created_by
  LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
  LEFT JOIN public.planejamento_orcamentario_classificacao rcl ON rcl.id = rl.classificacao_id
  LEFT JOIN public.contratos rct ON rct.id = rl.contrato_id
  LEFT JOIN public.fornecedor rf ON rf.id = rl.fornecedor_id
  LEFT JOIN public."EMPREGADOS" remp ON remp."ID" = rl.integrante_empregado_id
  WHERE d.deleted_at IS NULL
  ORDER BY d.created_at DESC, rl.ordem;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_despesa_relatorio_exportar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.malote_despesa_relatorio_exportar() TO authenticated;

NOTIFY pgrst, 'reload schema';
