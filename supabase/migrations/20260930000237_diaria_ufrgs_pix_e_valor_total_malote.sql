-- =====================================================================
-- DIÁRIAS UFRGS — chave Pix na diária e Malote pelo Valor Total
--
-- O PEDIDO (24/09/2026, /app/encarregados/diarias?tipo=UFRGS e
-- /app/operacional/diarias?tipo=UFRGS):
--
-- 1) O modal de criar a diária ganha a chave Pix, com o TIPO escolhido num
--    dropdown (e-mail, CPF, celular, CNPJ) — o mesmo desenho que a diária de
--    diarista já usa (pix + pix_tipo em "SOLICITACAO_DIARIA"). A chave é o
--    que o Malote precisa para pagar, e até aqui quem enviava a diária para
--    o Malote digitava "Informações de pagamento" de memória: a DU-2026-000004
--    foi para o Malote com "Diária UFRGS DU-2026-000004 — ofício 902/2026,
--    MAIKON..." no lugar da chave, e voltou reprovada.
--
-- 2) O "Total do mês" da despesa do Malote passa a ser o VALOR TOTAL da
--    diária, não o Valor à Faturar. Até aqui a RPC RECUSAVA qualquer valor
--    diferente do Valor à Faturar, então só mudar a tela não bastava.
--
-- DECISÕES:
--
-- * O banco confere o PAR (tipo e chave juntos, tipo dentro dos quatro), mas
--   NÃO obriga a chave. Quem obriga é o modal. Motivo: esta migration roda
--   no SQL Editor ANTES do merge, e entre uma coisa e outra o front no ar é
--   o antigo, que não manda pix nenhum — obrigar aqui travaria o lançamento
--   de diária para todo mundo nessa janela. Diária antiga fica sem chave e
--   continua abrindo, editando e indo para o Malote como antes.
--
-- * A trava de "valor <= 0 não vai para o Malote" acompanha o valor novo:
--   passa a olhar o Valor Total. O Valor Líquido negativo (VA descontado
--   maior que a viagem) deixa de impedir o envio, porque o que sai de caixa
--   agora é o Valor Total — e ele nunca é negativo.
--
-- As três funções abaixo são CÓPIA da 20260930000155 com só estas mudanças;
-- o resto (permissões, estados, motorista pelo servidor) está igual.
--
-- PRÉ-REQUISITO: 20260930000155. Idempotente: pode reexecutar.
-- =====================================================================

-- ── 1) Colunas ───────────────────────────────────────────────────────
ALTER TABLE public."DIARIA_UFRGS" ADD COLUMN IF NOT EXISTS pix      text;
ALTER TABLE public."DIARIA_UFRGS" ADD COLUMN IF NOT EXISTS pix_tipo text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'diaria_ufrgs_pix_tipo_valido'
  ) THEN
    ALTER TABLE public."DIARIA_UFRGS"
      ADD CONSTRAINT diaria_ufrgs_pix_tipo_valido
      CHECK (pix_tipo IS NULL OR pix_tipo IN ('celular', 'email', 'cpf', 'cnpj'));
  END IF;
  -- Tipo sem chave (ou chave sem tipo) é o formulário pela metade: o Malote
  -- receberia "PIX (CPF):" e mais nada.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'diaria_ufrgs_pix_par'
  ) THEN
    ALTER TABLE public."DIARIA_UFRGS"
      ADD CONSTRAINT diaria_ufrgs_pix_par
      CHECK ((pix IS NULL) = (pix_tipo IS NULL));
  END IF;
END $$;

-- ── 2) Criar — grava a chave ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_criar(p_dados jsonb)
RETURNS TABLE (id uuid, numero text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id       uuid := COALESCE(NULLIF(p_dados->>'id', '')::uuid, gen_random_uuid());
  v_numero   text;
  v_nome     text;
  v_contrato public.contratos%ROWTYPE;
  v_empresa  text;
  v_mat      text := NULLIF(btrim(coalesce(p_dados->>'matricula', '')), '');
  v_mot_nome text := btrim(coalesce(p_dados->>'motorista_nome', ''));
  v_mot_id   bigint := NULLIF(p_dados->>'motorista_empregado_id', '')::bigint;
  -- Um sem o outro vira NULL nos dois: a constraint diaria_ufrgs_pix_par
  -- recusaria o par pela metade com uma mensagem que ninguém entende.
  v_pix      text := NULLIF(btrim(coalesce(p_dados->>'pix', '')), '');
  v_pix_tipo text := NULLIF(btrim(coalesce(p_dados->>'pix_tipo', '')), '');
BEGIN
  IF NOT public.diaria_pode('incluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para lançar diárias.';
  END IF;

  SELECT * INTO v_contrato
    FROM public.contratos c
   WHERE c.id = NULLIF(p_dados->>'contrato_id', '')::uuid
     AND c.status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato ativo não encontrado.';
  END IF;
  SELECT COALESCE(e.nome_fantasia, e.razao_social) INTO v_empresa
    FROM public.empresas e WHERE e.id = v_contrato.empresa_id;

  PERFORM public.diaria_ufrgs_validar(p_dados);
  PERFORM public.diaria_ufrgs_validar_anexos(v_id, p_dados->'anexos');

  IF (v_pix IS NULL) <> (v_pix_tipo IS NULL) THEN
    RAISE EXCEPTION 'Informe o tipo e a chave Pix juntos.';
  END IF;
  IF v_pix_tipo IS NOT NULL AND v_pix_tipo NOT IN ('celular', 'email', 'cpf', 'cnpj') THEN
    RAISE EXCEPTION 'Tipo de chave Pix inválido.';
  END IF;

  -- Quando o motorista veio do dropdown, nome e matrícula saem de EMPREGADOS
  -- no SERVIDOR: o cliente não consegue trocar a matrícula mantendo o id.
  IF v_mot_id IS NOT NULL THEN
    SELECT e."Nome", nullif(btrim(e."Cadastro"::text), '')
      INTO v_mot_nome, v_mat
      FROM public."EMPREGADOS" e WHERE e."ID" = v_mot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Motorista não encontrado em EMPREGADOS.';
    END IF;
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  INSERT INTO public."DIARIA_UFRGS" (
    id, contrato_id, contrato_nome, contrato_cliente, contrato_empresa, competencia,
    cod_fornecedor, matricula, motorista_empregado_id, motorista_nome,
    sindicato, lotacao, numero_oficio, saida, retorno, destino, posto,
    valor_posto_variavel_centavos,
    qt_hospedagem, qt_cafe, qt_almoco, qt_janta, qt_va,
    pix, pix_tipo,
    observacoes, solicitante_id, solicitante_nome
  ) VALUES (
    v_id, v_contrato.id, v_contrato.nome, v_contrato.cliente, v_empresa,
    date_trunc('month', (p_dados->>'saida')::date)::date,
    NULLIF(btrim(coalesce(p_dados->>'cod_fornecedor', '')), ''),
    v_mat, v_mot_id, v_mot_nome,
    p_dados->>'sindicato', p_dados->>'lotacao',
    btrim(p_dados->>'numero_oficio'),
    (p_dados->>'saida')::date, (p_dados->>'retorno')::date,
    btrim(p_dados->>'destino'), NULLIF(p_dados->>'posto', ''),
    COALESCE((p_dados->>'valor_posto_variavel_centavos')::bigint, 0),
    COALESCE((p_dados->>'qt_hospedagem')::int, 0),
    COALESCE((p_dados->>'qt_cafe')::int, 0),
    COALESCE((p_dados->>'qt_almoco')::int, 0),
    COALESCE((p_dados->>'qt_janta')::int, 0),
    COALESCE((p_dados->>'qt_va')::int, 0),
    v_pix, v_pix_tipo,
    NULLIF(btrim(coalesce(p_dados->>'observacoes', '')), ''),
    auth.uid(), v_nome
  )
  RETURNING "DIARIA_UFRGS".numero INTO v_numero;

  INSERT INTO public."DIARIA_UFRGS_ANEXO" (
    diaria_id, storage_path, nome_arquivo, mime_type, tamanho_bytes
  )
  SELECT v_id, a->>'storage_path', a->>'nome_arquivo',
         NULLIF(a->>'mime_type', ''), NULLIF(a->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(COALESCE(p_dados->'anexos', '[]'::jsonb)) a;
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);

  RETURN QUERY SELECT v_id, v_numero;
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_criar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_criar(jsonb) TO authenticated;

-- ── 3) Editar — grava a chave ────────────────────────────────────────
--
-- Front antigo (sem a chave no payload) editando diária que JÁ tem chave:
-- a chave fica como estava, em vez de ser apagada por um formulário que nem
-- sabia que ela existia. Por isso o `p_dados ? 'pix'`.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_editar(p_dados jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d        public."DIARIA_UFRGS"%ROWTYPE;
  v_id       uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_mat      text := NULLIF(btrim(coalesce(p_dados->>'matricula', '')), '');
  v_mot_nome text := btrim(coalesce(p_dados->>'motorista_nome', ''));
  v_mot_id   bigint := NULLIF(p_dados->>'motorista_empregado_id', '')::bigint;
  v_pix      text := NULLIF(btrim(coalesce(p_dados->>'pix', '')), '');
  v_pix_tipo text := NULLIF(btrim(coalesce(p_dados->>'pix_tipo', '')), '');
  v_removidos text[] := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(p_dados->'anexos_removidos', '[]'::jsonb))
  );
BEGIN
  IF NOT public.diaria_pode('incluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para editar diárias.';
  END IF;

  SELECT * INTO v_d FROM public."DIARIA_UFRGS" WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diária UFRGS não encontrada.';
  END IF;
  IF v_d.status NOT IN ('solicitada', 'em_ajuste') THEN
    RAISE EXCEPTION 'Uma diária % não pode mais ser editada.', v_d.status;
  END IF;
  IF v_d.status = 'em_ajuste' AND v_d.solicitante_id <> auth.uid()
     AND NOT public.diaria_decide('aprovar') THEN
    RAISE EXCEPTION 'A diária devolvida para ajuste é corrigida por quem a lançou.';
  END IF;

  PERFORM public.diaria_ufrgs_validar(p_dados);
  PERFORM public.diaria_ufrgs_validar_anexos(v_id, p_dados->'anexos_novos');

  IF NOT (p_dados ? 'pix') THEN
    v_pix := v_d.pix;
    v_pix_tipo := v_d.pix_tipo;
  END IF;
  IF (v_pix IS NULL) <> (v_pix_tipo IS NULL) THEN
    RAISE EXCEPTION 'Informe o tipo e a chave Pix juntos.';
  END IF;
  IF v_pix_tipo IS NOT NULL AND v_pix_tipo NOT IN ('celular', 'email', 'cpf', 'cnpj') THEN
    RAISE EXCEPTION 'Tipo de chave Pix inválido.';
  END IF;

  IF v_mot_id IS NOT NULL THEN
    SELECT e."Nome", nullif(btrim(e."Cadastro"::text), '')
      INTO v_mot_nome, v_mat
      FROM public."EMPREGADOS" e WHERE e."ID" = v_mot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Motorista não encontrado em EMPREGADOS.';
    END IF;
  END IF;

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  UPDATE public."DIARIA_UFRGS" SET
    cod_fornecedor         = NULLIF(btrim(coalesce(p_dados->>'cod_fornecedor', '')), ''),
    matricula              = v_mat,
    motorista_empregado_id = v_mot_id,
    motorista_nome         = v_mot_nome,
    sindicato              = p_dados->>'sindicato',
    lotacao                = p_dados->>'lotacao',
    numero_oficio          = btrim(p_dados->>'numero_oficio'),
    saida                  = (p_dados->>'saida')::date,
    retorno                = (p_dados->>'retorno')::date,
    destino                = btrim(p_dados->>'destino'),
    posto                  = NULLIF(p_dados->>'posto', ''),
    valor_posto_variavel_centavos = COALESCE((p_dados->>'valor_posto_variavel_centavos')::bigint, 0),
    qt_hospedagem          = COALESCE((p_dados->>'qt_hospedagem')::int, 0),
    qt_cafe                = COALESCE((p_dados->>'qt_cafe')::int, 0),
    qt_almoco              = COALESCE((p_dados->>'qt_almoco')::int, 0),
    qt_janta               = COALESCE((p_dados->>'qt_janta')::int, 0),
    qt_va                  = COALESCE((p_dados->>'qt_va')::int, 0),
    pix                    = v_pix,
    pix_tipo               = v_pix_tipo,
    observacoes            = NULLIF(btrim(coalesce(p_dados->>'observacoes', '')), ''),
    -- Reenviar depois do ajuste devolve a diária para a fila. A decisão
    -- anterior sai de cena; quem devolveu e por quê continua na trilha.
    status                 = CASE WHEN v_d.status = 'em_ajuste' THEN 'solicitada' ELSE v_d.status END,
    ajuste_motivo          = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_motivo END,
    ajuste_pedido_por      = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_pedido_por END,
    ajuste_pedido_por_nome = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_pedido_por_nome END,
    ajuste_pedido_em       = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_pedido_em END
  WHERE id = v_id;

  DELETE FROM public."DIARIA_UFRGS_ANEXO"
   WHERE diaria_id = v_id AND storage_path = ANY (v_removidos);

  INSERT INTO public."DIARIA_UFRGS_ANEXO" (
    diaria_id, storage_path, nome_arquivo, mime_type, tamanho_bytes
  )
  SELECT v_id, a->>'storage_path', a->>'nome_arquivo',
         NULLIF(a->>'mime_type', ''), NULLIF(a->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(COALESCE(p_dados->'anexos_novos', '[]'::jsonb)) a;
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_editar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_editar(jsonb) TO authenticated;

-- ── 4) Enviar para o Malote — pelo Valor Total ───────────────────────
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_enviar_malote(
  p_diaria_id uuid,
  p_despesa   jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d                public."DIARIA_UFRGS"%ROWTYPE;
  v_empresa_id       uuid;
  v_classificacao_id uuid;
  v_malote_id        uuid;
  v_valor_total      numeric;
  v_total_rateio     numeric;
  v_numero_parcelas  integer;
  v_nome             text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada.';
  END IF;
  IF NOT public.diaria_decide('enviar_malote') THEN
    RAISE EXCEPTION 'Você não tem permissão para enviar esta diária para o malote.';
  END IF;

  SELECT * INTO v_d FROM public."DIARIA_UFRGS" WHERE id = p_diaria_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diária UFRGS não encontrada.';
  END IF;
  IF v_d.status NOT IN ('solicitada', 'aprovada') THEN
    RAISE EXCEPTION 'Uma diária % não vai para o malote.', v_d.status;
  END IF;
  IF v_d.malote_despesa_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta diária já tem despesa no Malote.';
  END IF;
  IF v_d.status = 'solicitada' THEN
    IF NOT public.diaria_decide('aprovar') THEN
      RAISE EXCEPTION 'Aprovar e enviar para o malote exige também a permissão de aprovar.';
    END IF;
    IF v_d.solicitante_id = auth.uid() THEN
      RAISE EXCEPTION 'Quem lançou a diária não pode aprovar a própria.';
    END IF;
  END IF;
  -- 24/09/2026: o valor da despesa é o VALOR TOTAL da diária (pedido do
  -- Operacional). Era o Valor à Faturar desde a 20260930000155. O Malote é
  -- saída de caixa, então R$ 0,00 continua não virando despesa.
  IF v_d.valor_total_centavos <= 0 THEN
    RAISE EXCEPTION 'O valor total desta diária é R$ %; corrija as quantidades antes de enviar para o malote.',
      to_char(v_d.valor_total_centavos / 100.0, 'FM999999990.00');
  END IF;

  SELECT c.empresa_id INTO v_empresa_id
    FROM public.contratos c WHERE c.id = v_d.contrato_id;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'O contrato da diária não possui empresa para gerar a despesa do Malote.';
  END IF;

  SELECT c.id INTO v_classificacao_id
    FROM public.planejamento_orcamentario_classificacao c
   WHERE c.ativo = true
     AND lower(public.unaccent_safe(btrim(c.nome))) = 'diaria'
   ORDER BY c.created_at
   LIMIT 1;
  IF v_classificacao_id IS NULL THEN
    RAISE EXCEPTION 'A classificação ativa "Diária" não foi encontrada no Malote.';
  END IF;

  IF btrim(coalesce(p_despesa->>'nome', '')) = '' THEN
    RAISE EXCEPTION 'Informe o nome da despesa.';
  END IF;
  v_valor_total := NULLIF(p_despesa->>'valor_total', '')::numeric;
  IF v_valor_total IS NULL OR v_valor_total <= 0 THEN
    RAISE EXCEPTION 'Informe um valor total válido para a despesa.';
  END IF;
  IF round(v_valor_total, 2) <> round(v_d.valor_total_centavos / 100.0, 2) THEN
    RAISE EXCEPTION 'O valor da despesa deve ser igual ao valor total da diária (R$ %).',
      to_char(v_d.valor_total_centavos / 100.0, 'FM999999990.00');
  END IF;
  IF NULLIF(p_despesa->>'data_pagamento', '') IS NULL
     OR NULLIF(p_despesa->>'competencia', '') IS NULL
     OR btrim(coalesce(p_despesa->>'forma_pagamento', '')) = '' THEN
    RAISE EXCEPTION 'Data de pagamento, competência e forma de pagamento são obrigatórias.';
  END IF;
  IF jsonb_array_length(COALESCE(p_despesa->'rateio', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos uma linha de rateio.';
  END IF;
  SELECT round(COALESCE(sum((r->>'valor')::numeric), 0), 2)
    INTO v_total_rateio
    FROM jsonb_array_elements(COALESCE(p_despesa->'rateio', '[]'::jsonb)) r;
  IF abs(v_total_rateio - round(v_valor_total, 2)) > 0.01 THEN
    RAISE EXCEPTION 'O total do rateio deve ser igual ao valor da despesa.';
  END IF;

  v_numero_parcelas := NULLIF(p_despesa->>'numero_parcelas', '')::integer;
  IF COALESCE((p_despesa->>'parcelado')::boolean, false)
     AND (v_numero_parcelas IS NULL OR v_numero_parcelas < 2 OR v_numero_parcelas > 420) THEN
    RAISE EXCEPTION 'Quantidade de parcelas deve ser entre 2 e 420.';
  END IF;
  IF COALESCE((p_despesa->>'parcelado')::boolean, false)
     AND jsonb_array_length(COALESCE(p_despesa->'parcelas', '[]'::jsonb)) <> v_numero_parcelas THEN
    RAISE EXCEPTION 'As parcelas informadas não correspondem à quantidade da despesa.';
  END IF;

  INSERT INTO public.malote_despesa (
    empresa_id, classificacao_id, origem, status, nivel_aprovacao_atual,
    nome, valor_total, motivo, descricao, tipo_movimento, tipo, contrato_id,
    data_pagamento, competencia, forma_pagamento, informacoes_pagamento,
    excecao, justificativa_excecao, parcelado, numero_parcelas, dia_desconto,
    created_by
  ) VALUES (
    v_empresa_id, v_classificacao_id, 'despesa_unica', 'pendente_aprovacao', 1,
    btrim(p_despesa->>'nome'), v_valor_total,
    'Pagamento de diária UFRGS ' || coalesce(v_d.numero, v_d.id::text),
    'Gerado automaticamente pelo Controle de Diárias (UFRGS). Motorista: ' ||
      v_d.motorista_nome || '; ofício: ' || v_d.numero_oficio ||
      '; destino: ' || v_d.destino || '; lotação: ' || v_d.lotacao || '.',
    'saida', 'contrato', v_d.contrato_id,
    (p_despesa->>'data_pagamento')::date,
    (p_despesa->>'competencia')::date,
    btrim(p_despesa->>'forma_pagamento'),
    NULLIF(btrim(coalesce(p_despesa->>'informacoes_pagamento', '')), ''),
    COALESCE((p_despesa->>'excecao')::boolean, false),
    NULLIF(btrim(coalesce(p_despesa->>'justificativa_excecao', '')), ''),
    COALESCE((p_despesa->>'parcelado')::boolean, false),
    CASE WHEN COALESCE((p_despesa->>'parcelado')::boolean, false) THEN v_numero_parcelas ELSE NULL END,
    CASE WHEN COALESCE((p_despesa->>'parcelado')::boolean, false) THEN NULLIF(p_despesa->>'dia_desconto', '')::integer ELSE NULL END,
    auth.uid()
  ) RETURNING id INTO v_malote_id;

  INSERT INTO public.malote_despesa_rateio_linha (
    despesa_id, classificacao_id, empresa_id, contrato_id, fornecedor_id,
    integrante_empregado_id, percentual, valor, ordem, justificativa_texto
  )
  SELECT
    v_malote_id,
    NULLIF(r.linha->>'classificacao_id', '')::uuid,
    NULLIF(r.linha->>'empresa_id', '')::uuid,
    NULLIF(r.linha->>'contrato_id', '')::uuid,
    NULLIF(r.linha->>'fornecedor_id', '')::uuid,
    NULLIF(r.linha->>'integrante_empregado_id', '')::bigint,
    NULLIF(r.linha->>'percentual', '')::numeric,
    (r.linha->>'valor')::numeric,
    (r.ordem - 1)::integer,
    NULLIF(btrim(coalesce(r.linha->>'justificativa_texto', '')), '')
  FROM jsonb_array_elements(COALESCE(p_despesa->'rateio', '[]'::jsonb))
       WITH ORDINALITY AS r(linha, ordem);

  IF COALESCE((p_despesa->>'parcelado')::boolean, false) THEN
    INSERT INTO public.malote_despesa_parcela (
      despesa_id, numero_parcela, valor, data_vencimento
    )
    SELECT
      v_malote_id,
      (p.parcela->>'numero_parcela')::integer,
      (p.parcela->>'valor')::numeric,
      (p.parcela->>'data_vencimento')::date
    FROM jsonb_array_elements(COALESCE(p_despesa->'parcelas', '[]'::jsonb)) p(parcela);
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  UPDATE public."DIARIA_UFRGS"
     SET status                = 'aprovada',
         malote_motivo         = btrim(p_despesa->>'nome'),
         malote_data_pagamento = (p_despesa->>'data_pagamento')::date,
         malote_despesa_id     = v_malote_id,
         enviado_malote_em     = now(),
         decidido_por          = COALESCE(v_d.decidido_por, auth.uid()),
         decidido_por_nome     = COALESCE(v_d.decidido_por_nome, v_nome),
         decidido_em           = COALESCE(v_d.decidido_em, now())
   WHERE id = p_diaria_id;
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);

  RETURN v_malote_id;
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_enviar_malote(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_enviar_malote(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Reaplique as seções 11 e 12.2 da 20260930000155 (diaria_ufrgs_criar,
-- diaria_ufrgs_editar e diaria_ufrgs_enviar_malote voltam a ignorar a chave
-- e a exigir o Valor à Faturar) e depois:
-- ALTER TABLE public."DIARIA_UFRGS" DROP CONSTRAINT IF EXISTS diaria_ufrgs_pix_par;
-- ALTER TABLE public."DIARIA_UFRGS" DROP CONSTRAINT IF EXISTS diaria_ufrgs_pix_tipo_valido;
-- ALTER TABLE public."DIARIA_UFRGS" DROP COLUMN IF EXISTS pix_tipo;
-- ALTER TABLE public."DIARIA_UFRGS" DROP COLUMN IF EXISTS pix;
-- NOTIFY pgrst, 'reload schema';
