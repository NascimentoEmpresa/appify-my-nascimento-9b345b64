-- SIS-2026-0693 — impede que uma solicitação idêntica passe despercebida.
--
-- O cancelamento não entra na comparação: é justamente o desfecho correto de
-- um pedido repetido. Para manter uma nova solicitação semelhante, o
-- solicitante precisa justificar a exceção; a justificativa fica no pedido e
-- no histórico, para que o Supply não perca o motivo da decisão.
--
-- ROLLBACK:
--   ALTER TABLE public.sup_pedido DROP COLUMN IF EXISTS justificativa_duplicidade;
--   -- recriar sup_ext_criar_pedido da migration 20260830000001_supply_colaboradores.sql

ALTER TABLE public.sup_pedido
  ADD COLUMN IF NOT EXISTS justificativa_duplicidade text;

COMMENT ON COLUMN public.sup_pedido.justificativa_duplicidade IS
  'Motivo informado para manter uma nova solicitação com o mesmo colaborador, contexto e itens de pedido aberto.';

CREATE OR REPLACE FUNCTION public.sup_ext_criar_pedido(p_payload jsonb)
RETURNS sup_pedido LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_contrato  uuid := (p_payload->>'contrato_id')::uuid;
  v_posto     uuid := (p_payload->>'posto_id')::uuid;
  v_funcao    uuid := (p_payload->>'funcao_id')::uuid;
  v_tipo      text := coalesce(p_payload->>'tipo_pedido', 'uniforme');
  v_admissao  boolean := coalesce((p_payload->>'admissao')::boolean, false);
  v_colab_id  bigint := nullif(p_payload->>'colaborador_empregado_id', '')::bigint;
  v_ses       record;
  v_login     text;
  v_nome      text;
  v_origem    text;
  v_emp_id    bigint;
  v_emp_cpf   text;
  v_empresa   uuid;
  v_cnome     text;
  v_pnome     text;
  v_fnome     text;
  v_col_nome  text;
  v_col_matr  text;
  v_digitado  boolean := false;
  v_itens     jsonb := coalesce(p_payload->'itens', '[]'::jsonb);
  v_justificativa text := nullif(btrim(p_payload->>'justificativa_duplicidade'), '');
  v_ped       public.sup_pedido;
  it          jsonb;
  v_idx       int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.sup_ext_pode_ver_contrato(v_contrato) THEN RAISE EXCEPTION 'Sem acesso a este contrato'; END IF;
  IF jsonb_array_length(v_itens) = 0 THEN RAISE EXCEPTION 'Selecione ao menos um item'; END IF;

  SELECT c.empresa_id, c.nome, p.nome, f.nome INTO v_empresa, v_cnome, v_pnome, v_fnome
    FROM public.contratos c JOIN public.sup_posto p ON p.id = v_posto AND p.contrato_id = c.id
    JOIN public.sup_funcao f ON f.id = v_funcao AND f.posto_id = p.id
   WHERE c.id = v_contrato AND p.aprovado AND p.ativo AND f.aprovado AND f.ativo;
  IF v_empresa IS NULL THEN RAISE EXCEPTION 'Posto ou função não pertence a este contrato (ou não está aprovado)'; END IF;

  SELECT * INTO v_ses FROM public.sup_ext_sessao s WHERE s.user_id = v_uid;
  IF v_ses.user_id IS NOT NULL THEN
    v_origem := 'externo'; v_emp_id := v_ses.empregado_id; v_emp_cpf := v_ses.empregado_cpf;
    v_nome := coalesce(v_ses.empregado_nome, v_ses.login_informado); v_login := upper(coalesce(v_ses.empregado_nome, v_ses.login_informado));
  ELSE
    v_origem := 'interno'; SELECT pr.display_name INTO v_nome FROM public.profiles pr WHERE pr.id = v_uid;
    v_login := upper(coalesce(v_nome, 'INTERNO'));
  END IF;

  IF v_colab_id IS NOT NULL THEN
    SELECT e."Nome", nullif(btrim(e."Cadastro"::text), '') INTO v_col_nome, v_col_matr
      FROM public."EMPREGADOS" e WHERE e."ID" = v_colab_id AND e."Situação" <> 'Demitido';
    IF v_col_nome IS NULL THEN RAISE EXCEPTION 'Colaborador não encontrado ou desligado'; END IF;
  ELSIF v_admissao THEN
    v_col_nome := nullif(btrim(p_payload->>'nome_colaborador'), ''); v_col_matr := NULL; v_digitado := true;
    IF v_col_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do novo colaborador'; END IF;
  ELSIF v_tipo <> 'insumos' THEN RAISE EXCEPTION 'Escolha o colaborador na lista, ou marque "É admissão"'; END IF;

  -- A igualdade é do conjunto completo (item, tamanho, quantidade e litros),
  -- não só de um item em comum. Assim, uma reposição parcial não vira alerta.
  IF v_tipo <> 'insumos' AND EXISTS (
    SELECT 1 FROM public.sup_pedido p
     WHERE p.empresa_id = v_empresa AND p.contrato_id = v_contrato AND p.posto_id = v_posto AND p.funcao_id = v_funcao
       AND p.status <> 'CANCELADO'
       AND ((v_colab_id IS NOT NULL AND p.colaborador_empregado_id = v_colab_id)
            OR (v_colab_id IS NULL AND p.colaborador_digitado AND p.nome_colaborador = v_col_nome))
       AND (SELECT count(*) FROM public.sup_pedido_item pi WHERE pi.pedido_id = p.id) = jsonb_array_length(v_itens)
       AND NOT EXISTS (
         (SELECT (x->>'item_id')::uuid, coalesce(nullif(x->>'tamanho', ''), ''), greatest(coalesce((x->>'quantidade')::int, 1), 1), coalesce(nullif(x->>'litros', ''), '')
            FROM jsonb_array_elements(v_itens) x)
         EXCEPT
         (SELECT pi.item_id, coalesce(pi.tamanho, ''), pi.quantidade, coalesce(pi.litros, '') FROM public.sup_pedido_item pi WHERE pi.pedido_id = p.id)
       )
       AND NOT EXISTS (
         (SELECT pi.item_id, coalesce(pi.tamanho, ''), pi.quantidade, coalesce(pi.litros, '') FROM public.sup_pedido_item pi WHERE pi.pedido_id = p.id)
         EXCEPT
         (SELECT (x->>'item_id')::uuid, coalesce(nullif(x->>'tamanho', ''), ''), greatest(coalesce((x->>'quantidade')::int, 1), 1), coalesce(nullif(x->>'litros', ''), '')
            FROM jsonb_array_elements(v_itens) x)
       )
  ) AND v_justificativa IS NULL THEN
    RAISE EXCEPTION 'PEDIDO_DUPLICADO_JUSTIFICATIVA: existe pedido aberto com os mesmos dados; informe a justificativa para enviar.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.sup_pedido (
    empresa_id, contrato_id, posto_id, funcao_id, contrato_nome, posto_nome, funcao_nome,
    criado_por, solicitante_login, solicitante_nome, origem, solicitante_empregado_id, solicitante_cpf,
    nome_colaborador, matricula_colaborador, colaborador_empregado_id, colaborador_digitado,
    admissao, tipo_admissao, data_admissao, imagem_cracha_path, tipo_pedido, observacoes_solicitante, justificativa_duplicidade
  ) VALUES (
    v_empresa, v_contrato, v_posto, v_funcao, v_cnome, v_pnome, v_fnome,
    v_uid, v_login, v_nome, v_origem, v_emp_id, v_emp_cpf,
    coalesce(v_col_nome, ''), v_col_matr, v_colab_id, v_digitado,
    v_admissao, nullif(p_payload->>'tipo_admissao', ''), nullif(p_payload->>'data_admissao', '')::date,
    nullif(p_payload->>'imagem_cracha_path', ''), v_tipo, nullif(p_payload->>'observacoes_solicitante', ''), v_justificativa
  ) RETURNING * INTO v_ped;

  FOR it IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    v_idx := v_idx + 1;
    IF NOT EXISTS (SELECT 1 FROM public.sup_funcao_item fi WHERE fi.funcao_id = v_funcao AND fi.item_id = (it->>'item_id')::uuid AND fi.aprovado AND fi.ativo) THEN
      RAISE EXCEPTION 'Item % não pertence a esta função', coalesce(it->>'nome_item', it->>'item_id');
    END IF;
    INSERT INTO public.sup_pedido_item (pedido_id, item_id, nome_item, tipo_item, tamanho, quantidade, litros, ordem)
    SELECT v_ped.id, i.id, i.nome, i.tipo, nullif(it->>'tamanho', ''), greatest(coalesce((it->>'quantidade')::int, 1), 1), nullif(it->>'litros', ''), v_idx
      FROM public.sup_item i WHERE i.id = (it->>'item_id')::uuid;
  END LOOP;

  INSERT INTO public.sup_pedido_historico (pedido_id, acao, status_novo, observacao, alterado_por, alterado_por_nome)
  VALUES (v_ped.id, 'CRIADO', v_ped.status,
          CASE WHEN v_justificativa IS NULL THEN 'Pedido criado' ELSE 'Pedido duplicado aceito: ' || v_justificativa END,
          v_uid, v_nome);
  RETURN v_ped;
END $$;

NOTIFY pgrst, 'reload schema';
