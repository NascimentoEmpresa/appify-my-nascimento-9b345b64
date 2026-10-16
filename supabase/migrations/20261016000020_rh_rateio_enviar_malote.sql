-- =========================================================================
-- RH › RATEIO DE DESPESAS → MALOTE (16/10/2026) — chamado SIS-2026-0673
--
-- O chamado pede "aba de rateio automático para ir para o malote". A mig
-- 20261016000010 deixou o envio de fora de propósito (o Malote é do
-- Financeiro). Pablo aprovou em 16/10/2026 o desenho:
--   · o rateio CONFERIDO vira uma DESPESA NOVA no Malote (pendente de
--     aprovação, nível 1 — o fluxo normal da classificação), com uma linha
--     de rateio por contrato (empresa do contrato + contrato + valor + %);
--   · a classificação é escolhida no envio (a tela sugere pelo tipo);
--   · o RH preenche data/forma/dados de pagamento e a empresa pagadora;
--     linha "sem contrato" vai para a empresa pagadora, sem contrato.
-- Mesmo molde da Diária (diaria_ufrgs_enviar_malote, mig 20260930000237):
-- a tela usa o MESMO PainelDespesaMalote da criação normal e a RPC grava
-- despesa + rateio + parcelas numa transação. Os triggers do Malote
-- (prazo normal 1.1, dia bloqueado, senha de exceção, número, evento,
-- notificação) rodam como em qualquer despesa — nada é pulado aqui.
--
-- ANEXOS: o id da despesa nasce no navegador (p_despesa_id) para os
-- arquivos (o PDF/planilha do rateio + o que o RH somar) subirem ANTES em
-- malote-anexos/<id>/ e entrarem no mesmo INSERT. Evita a 2ª UPDATE da
-- Diária, que depende da RLS de malote_despesa (SIS-2026-0511).
--
-- TRAVA: depois de enviado, o rateio não muda nem é excluído
-- (rh_rateio_salvar/excluir recusam) enquanto a despesa do Malote existir.
-- Se o Malote excluir (deleted_at), reprovar ou cancelar, o rateio volta a
-- poder ser editado e reenviado.
--
-- PERMISSÃO: ação nova 'enviar_malote' no menu rh_rateio_despesas
-- (app_menu_acao). Fica FORA do toggle da tela (ACOES_FORA_DO_TOGGLE em
-- src/lib/acoesDoToggleAcesso.ts): ligar a tela para alguém conferir o
-- rateio não dá junto o poder de lançar despesa no Malote.
-- malote_fornecedores_para_rateio ganha rh_rateio_despesas na lista (o
-- Fornecedor é obrigatório no rateio do painel — sem isso o combobox vinha
-- vazio para quem só tem a tela do RH, ver SIS-2026-0480).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1) Ação ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('rh_rateio_despesas', 'enviar_malote'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── 2) Vínculo rateio → despesa do Malote ────────────────────────────────
ALTER TABLE public."RH_RATEIO_DESPESA"
  ADD COLUMN IF NOT EXISTS malote_despesa_id uuid REFERENCES public.malote_despesa(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enviado_malote_em timestamptz,
  ADD COLUMN IF NOT EXISTS enviado_malote_por uuid,
  ADD COLUMN IF NOT EXISTS enviado_malote_por_nome text;
CREATE INDEX IF NOT EXISTS idx_rh_rateio_despesa_malote ON public."RH_RATEIO_DESPESA"(malote_despesa_id);

-- A despesa do Malote ligada ao rateio ainda "segura" o rateio?
CREATE OR REPLACE FUNCTION public.rh_rateio_malote_ativo(p_malote_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_malote_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.malote_despesa m
     WHERE m.id = p_malote_id AND m.deleted_at IS NULL
       AND m.status NOT IN ('despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
$$;
REVOKE ALL ON FUNCTION public.rh_rateio_malote_ativo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_malote_ativo(uuid) TO authenticated;

-- Número e status da despesa do Malote, para a tela do RH (quem só tem o
-- RH não lê malote_despesa pela RLS).
CREATE OR REPLACE FUNCTION public.rh_rateio_malote_info(p_ids uuid[])
RETURNS TABLE(rateio_id uuid, malote_despesa_id uuid, numero text, status text, ativo boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.rh_rateio_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Rateio de Despesas' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, m.id, m.numero, CASE WHEN m.deleted_at IS NOT NULL THEN 'excluida' ELSE m.status END,
         public.rh_rateio_malote_ativo(m.id)
    FROM public."RH_RATEIO_DESPESA" r
    JOIN public.malote_despesa m ON m.id = r.malote_despesa_id
   WHERE r.id = ANY (p_ids[1:500]);
END $$;
REVOKE ALL ON FUNCTION public.rh_rateio_malote_info(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_malote_info(uuid[]) TO authenticated;

-- ── 3) Trava em salvar/excluir ───────────────────────────────────────────
-- Mesma rh_rateio_salvar da 20261016000010, com a trava no começo.
CREATE OR REPLACE FUNCTION public.rh_rateio_salvar(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id   uuid := NULLIF(p->>'id', '')::uuid;
  v_nome text;
  v_soma numeric;
  v_mal  uuid;
BEGIN
  IF v_id IS NULL AND NOT public.rh_rateio_pode('incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir rateio' USING ERRCODE = '42501';
  END IF;
  IF v_id IS NOT NULL AND NOT public.rh_rateio_pode('alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar rateio' USING ERRCODE = '42501';
  END IF;
  IF v_id IS NOT NULL THEN
    SELECT malote_despesa_id INTO v_mal FROM public."RH_RATEIO_DESPESA" WHERE id = v_id;
    IF public.rh_rateio_malote_ativo(v_mal) THEN
      RAISE EXCEPTION 'Este rateio já foi enviado ao Malote — para mudar, a despesa do Malote precisa ser excluída ou reprovada lá.';
    END IF;
  END IF;
  IF jsonb_typeof(p->'itens') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Rateio sem itens';
  END IF;
  SELECT COALESCE(round(sum((i->>'valor')::numeric), 2), 0) INTO v_soma FROM jsonb_array_elements(p->'itens') i;
  IF (p->>'status') = 'conferido' AND v_soma <> round((p->>'valor')::numeric, 2) THEN
    RAISE EXCEPTION 'A soma do rateio (%) não bate com o valor da despesa (%)', v_soma, (p->>'valor')::numeric;
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), pr.email) INTO v_nome
    FROM public.profiles pr WHERE pr.id = auth.uid();

  IF v_id IS NULL THEN
    INSERT INTO public."RH_RATEIO_DESPESA"
      (tipo, competencia, valor, descricao, criterio, status, anexo_path, anexo_nome, detalhe, criado_por, criado_por_nome)
    VALUES (p->>'tipo', (p->>'competencia')::date, (p->>'valor')::numeric, NULLIF(btrim(p->>'descricao'), ''),
            p->>'criterio', COALESCE(p->>'status', 'rascunho'), NULLIF(p->>'anexo_path', ''), NULLIF(p->>'anexo_nome', ''),
            CASE WHEN jsonb_typeof(p->'detalhe') = 'array' THEN p->'detalhe' END, auth.uid(), v_nome)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."RH_RATEIO_DESPESA" SET
      tipo = p->>'tipo', competencia = (p->>'competencia')::date, valor = (p->>'valor')::numeric,
      descricao = NULLIF(btrim(p->>'descricao'), ''), criterio = p->>'criterio',
      status = COALESCE(p->>'status', 'rascunho'),
      anexo_path = NULLIF(p->>'anexo_path', ''), anexo_nome = NULLIF(p->>'anexo_nome', ''),
      detalhe = CASE WHEN jsonb_typeof(p->'detalhe') = 'array' THEN p->'detalhe' END,
      alterado_por = auth.uid(), alterado_por_nome = v_nome
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rateio não encontrado'; END IF;
    DELETE FROM public."RH_RATEIO_ITEM" WHERE despesa_id = v_id;
  END IF;

  INSERT INTO public."RH_RATEIO_ITEM"
    (despesa_id, contrato_id, contrato_nome, base, qtd, percentual, valor, ajustado, observacao, ordem)
  SELECT v_id, NULLIF(i->>'contrato_id', '')::uuid, COALESCE(NULLIF(btrim(i->>'contrato_nome'), ''), 'Sem contrato'),
         COALESCE((i->>'base')::numeric, 0), NULLIF(i->>'qtd', '')::int, COALESCE((i->>'percentual')::numeric, 0),
         COALESCE((i->>'valor')::numeric, 0), COALESCE((i->>'ajustado')::boolean, false), NULLIF(btrim(i->>'observacao'), ''),
         o::int
    FROM jsonb_array_elements(p->'itens') WITH ORDINALITY AS t(i, o);

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.rh_rateio_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rh_rateio_excluir(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_mal uuid;
BEGIN
  IF NOT public.rh_rateio_pode('excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir rateio' USING ERRCODE = '42501';
  END IF;
  SELECT malote_despesa_id INTO v_mal FROM public."RH_RATEIO_DESPESA" WHERE id = p_id;
  IF public.rh_rateio_malote_ativo(v_mal) THEN
    RAISE EXCEPTION 'Este rateio já foi enviado ao Malote — exclua ou reprove a despesa lá antes.';
  END IF;
  DELETE FROM public."RH_RATEIO_DESPESA" WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.rh_rateio_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_excluir(uuid) TO authenticated;

-- ── 4) Enviar ao Malote ──────────────────────────────────────────────────
-- p_despesa (o payload do PainelDespesaMalote): { empresa_id,
--   classificacao_id, nome, valor_total, data_pagamento, competencia,
--   forma_pagamento, informacoes_pagamento, excecao_solicitacao_id,
--   justificativa_excecao, parcelado, numero_parcelas, dia_desconto,
--   rateio: [...], parcelas: [...], arquivos: ["<p_despesa_id>/..."] }
CREATE OR REPLACE FUNCTION public.rh_rateio_enviar_malote(p_rateio_id uuid, p_despesa_id uuid, p_despesa jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r            public."RH_RATEIO_DESPESA"%ROWTYPE;
  v_class      public.planejamento_orcamentario_classificacao%ROWTYPE;
  v_valor      numeric;
  v_soma       numeric;
  v_parcelado  boolean := COALESCE((p_despesa->>'parcelado')::boolean, false);
  v_nparc      integer := NULLIF(p_despesa->>'numero_parcelas', '')::integer;
  v_arquivos   text[];
  v_nome       text;
  v_rotulo     text;
BEGIN
  IF NOT public.rh_rateio_pode('enviar_malote') THEN
    RAISE EXCEPTION 'Sem permissão para enviar rateio ao Malote' USING ERRCODE = '42501';
  END IF;
  IF p_despesa_id IS NULL THEN RAISE EXCEPTION 'Id da despesa não informado.'; END IF;

  SELECT * INTO r FROM public."RH_RATEIO_DESPESA" WHERE id = p_rateio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rateio não encontrado.'; END IF;
  IF r.status <> 'conferido' THEN
    RAISE EXCEPTION 'Só rateio conferido vai para o Malote — salve como conferido antes.';
  END IF;
  IF public.rh_rateio_malote_ativo(r.malote_despesa_id) THEN
    RAISE EXCEPTION 'Este rateio já está no Malote.';
  END IF;

  SELECT * INTO v_class FROM public.planejamento_orcamentario_classificacao
   WHERE id = NULLIF(p_despesa->>'classificacao_id', '')::uuid AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha uma classificação ativa do Malote.'; END IF;
  IF NULLIF(p_despesa->>'empresa_id', '') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = (p_despesa->>'empresa_id')::uuid) THEN
    RAISE EXCEPTION 'Escolha a empresa pagadora.';
  END IF;
  IF btrim(coalesce(p_despesa->>'nome', '')) = '' THEN RAISE EXCEPTION 'Informe o nome da despesa.'; END IF;

  v_valor := round(NULLIF(p_despesa->>'valor_total', '')::numeric, 2);
  IF v_valor IS NULL OR v_valor <> round(r.valor, 2) THEN
    RAISE EXCEPTION 'O valor da despesa deve ser o valor do rateio (R$ %).', to_char(r.valor, 'FM999G999G990D00');
  END IF;
  IF NULLIF(p_despesa->>'data_pagamento', '') IS NULL OR NULLIF(p_despesa->>'competencia', '') IS NULL
     OR btrim(coalesce(p_despesa->>'forma_pagamento', '')) = '' THEN
    RAISE EXCEPTION 'Data de pagamento, competência e forma de pagamento são obrigatórias.';
  END IF;
  IF jsonb_typeof(p_despesa->'rateio') IS DISTINCT FROM 'array' OR jsonb_array_length(p_despesa->'rateio') = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos uma linha de rateio.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_despesa->'rateio') l WHERE NULLIF(l->>'empresa_id', '') IS NULL) THEN
    RAISE EXCEPTION 'Toda linha do rateio precisa da empresa.';
  END IF;
  SELECT round(COALESCE(sum((l->>'valor')::numeric), 0), 2) INTO v_soma FROM jsonb_array_elements(p_despesa->'rateio') l;
  IF abs(v_soma - v_valor) > 0.01 THEN
    RAISE EXCEPTION 'O total do rateio (R$ %) deve ser igual ao valor da despesa (R$ %).', v_soma, v_valor;
  END IF;
  IF v_parcelado AND (v_nparc IS NULL OR v_nparc < 2 OR v_nparc > 420
                      OR jsonb_array_length(COALESCE(p_despesa->'parcelas', '[]'::jsonb)) <> v_nparc) THEN
    RAISE EXCEPTION 'Parcelas inválidas (entre 2 e 420, e a lista tem de bater com a quantidade).';
  END IF;

  -- Só arquivos que o navegador subiu na pasta desta despesa.
  SELECT COALESCE(array_agg(a), '{}') INTO v_arquivos
    FROM jsonb_array_elements_text(COALESCE(p_despesa->'arquivos', '[]'::jsonb)) a;
  IF EXISTS (SELECT 1 FROM unnest(v_arquivos) a WHERE a NOT LIKE p_despesa_id::text || '/%') THEN
    RAISE EXCEPTION 'Anexo fora da pasta da despesa.';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), pr.email) INTO v_nome
    FROM public.profiles pr WHERE pr.id = auth.uid();
  v_rotulo := CASE r.tipo
    WHEN 'jusbrasil' THEN 'Jus Brasil' WHEN 'senior' THEN 'Senior' WHEN 'fgts' THEN 'FGTS'
    WHEN 'bullla' THEN 'Bullla' WHEN 'seguro' THEN 'Seguro' WHEN 'bsf' THEN 'BSF'
    WHEN 'gratificacao_pcd' THEN 'Gratificação PCD' WHEN 'mensalidade_seeac' THEN 'Mensalidade SEEAC'
    ELSE r.tipo END;

  INSERT INTO public.malote_despesa (
    id, empresa_id, classificacao_id, origem, status, nivel_aprovacao_atual,
    nome, valor_total, motivo, descricao, tipo_movimento, tipo, contrato_id,
    data_pagamento, competencia, forma_pagamento, informacoes_pagamento,
    excecao_solicitacao_id, justificativa_excecao, parcelado, numero_parcelas, dia_desconto,
    arquivos, solicitacao_dispensada_manualmente, created_by
  ) VALUES (
    p_despesa_id, (p_despesa->>'empresa_id')::uuid, v_class.id, 'despesa_unica', 'pendente_aprovacao', 1,
    btrim(p_despesa->>'nome'), v_valor,
    'Rateio ' || v_rotulo || ' ' || to_char(r.competencia, 'MM/YYYY'),
    'Gerado pelo RH › Rateio de Despesas (' || v_rotulo || ', competência ' || to_char(r.competencia, 'MM/YYYY') ||
      ', critério ' || r.criterio || ').' || COALESCE(' ' || r.descricao, ''),
    'saida', CASE WHEN v_class.tipo IN ('administrativo', 'contrato') THEN v_class.tipo ELSE 'contrato' END, NULL,
    (p_despesa->>'data_pagamento')::date, (p_despesa->>'competencia')::date,
    btrim(p_despesa->>'forma_pagamento'),
    NULLIF(btrim(coalesce(p_despesa->>'informacoes_pagamento', '')), ''),
    NULLIF(p_despesa->>'excecao_solicitacao_id', '')::uuid,
    NULLIF(btrim(coalesce(p_despesa->>'justificativa_excecao', '')), ''),
    v_parcelado, CASE WHEN v_parcelado THEN v_nparc END,
    CASE WHEN v_parcelado THEN NULLIF(p_despesa->>'dia_desconto', '')::integer END,
    v_arquivos,
    -- Vem do RH sem solicitação: se a classificação pedia uma, fica o rastro.
    COALESCE(v_class.requer_solicitacao, false),
    auth.uid()
  );

  INSERT INTO public.malote_despesa_rateio_linha (
    despesa_id, classificacao_id, empresa_id, contrato_id, fornecedor_id,
    integrante_empregado_id, percentual, valor, ordem, justificativa_texto
  )
  SELECT p_despesa_id,
         NULLIF(l->>'classificacao_id', '')::uuid,
         NULLIF(l->>'empresa_id', '')::uuid,
         NULLIF(l->>'contrato_id', '')::uuid,
         NULLIF(l->>'fornecedor_id', '')::uuid,
         NULLIF(l->>'integrante_empregado_id', '')::bigint,
         NULLIF(l->>'percentual', '')::numeric,
         (l->>'valor')::numeric,
         (o - 1)::integer,
         NULLIF(btrim(coalesce(l->>'justificativa_texto', '')), '')
    FROM jsonb_array_elements(p_despesa->'rateio') WITH ORDINALITY AS t(l, o);

  IF v_parcelado THEN
    INSERT INTO public.malote_despesa_parcela (despesa_id, numero_parcela, valor, data_vencimento)
    SELECT p_despesa_id, (x->>'numero_parcela')::integer, (x->>'valor')::numeric, (x->>'data_vencimento')::date
      FROM jsonb_array_elements(p_despesa->'parcelas') x;
  END IF;

  UPDATE public."RH_RATEIO_DESPESA"
     SET malote_despesa_id = p_despesa_id, enviado_malote_em = now(),
         enviado_malote_por = auth.uid(), enviado_malote_por_nome = v_nome
   WHERE id = r.id;

  RETURN p_despesa_id;
END $$;
REVOKE ALL ON FUNCTION public.rh_rateio_enviar_malote(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_enviar_malote(uuid, uuid, jsonb) TO authenticated;

-- ── 5) Fornecedores do rateio para quem envia pelo RH ────────────────────
-- Mesma função da 20260930000201, com rh_rateio_despesas na lista.
CREATE OR REPLACE FUNCTION public.malote_fornecedores_para_rateio()
 RETURNS TABLE(id uuid, razao_social text, nome_fantasia text, cnpj_cpf text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT f.id, f.razao_social, f.nome_fantasia, f.cnpj_cpf
    FROM public.fornecedor f
   WHERE EXISTS (
           -- Qualquer tela que renderiza o RateioGrid. Lista explícita e não
           -- um LIKE 'malote_%' de propósito: menu novo do Malote não deve
           -- ganhar acesso à lista de fornecedores sem alguém decidir isso.
           SELECT 1
             FROM unnest(ARRAY[
               'fornecedores',                 -- quem já vê o cadastro
               'malote_criar_despesa',
               'malote_ratear_classificacao',
               'malote_despesa_visualizar',
               'malote_solicitacao_visualizar',
               'malote_aprovacoes',
               'malote_meus_itens',
               'malote_pagamento',
               'diretoria_malote_aprovacoes',
               'diretoria_malote_despesa',
               'diretoria_malote_solicitacao',
               'operacional_diarias',          -- SIS-2026-0480
               'financeiro_diarias',
               'encarregados_diarias'
             ]) AS m(codigo)
            WHERE public.can_access(auth.uid(), m.codigo, 'visualizar'::public.app_acao)
         )
      -- SIS-2026-0673 (16/10/2026): o RH envia rateio ao Malote pelo mesmo
      -- painel. Só quem tem a AÇÃO de enviar, não quem só confere.
      OR public.can_access(auth.uid(), 'rh_rateio_despesas', 'enviar_malote'::public.app_acao)
   ORDER BY f.razao_social;
$function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar a seção 5 da 20260930000201 (malote_fornecedores_para_rateio sem
-- o OR) e a seção 7 da 20261016000010 (rh_rateio_salvar/excluir sem trava), e:
-- DROP FUNCTION IF EXISTS public.rh_rateio_enviar_malote(uuid, uuid, jsonb),
--   public.rh_rateio_malote_info(uuid[]), public.rh_rateio_malote_ativo(uuid);
-- ALTER TABLE public."RH_RATEIO_DESPESA" DROP COLUMN IF EXISTS malote_despesa_id,
--   DROP COLUMN IF EXISTS enviado_malote_em, DROP COLUMN IF EXISTS enviado_malote_por,
--   DROP COLUMN IF EXISTS enviado_malote_por_nome;
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'rh_rateio_despesas' AND acao = 'enviar_malote';
-- NOTIFY pgrst, 'reload schema';
