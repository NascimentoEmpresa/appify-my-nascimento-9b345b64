-- SIS-2026-0821: espelho da Entrega de EPIs no módulo Operacional.
-- As duas telas usam os mesmos registros; o menu novo concede acesso independente.
-- A tela nasce pendente e requer liberação em Módulos & Menus > Novos Módulos.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'ope_epi_entregas', 'Entrega de EPIs', '/app/operacional/entrega-epi',
       coalesce((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m WHERE m.codigo = 'operacional'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('ope_epi_entregas', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- Prepara os perfis de Operacional e Administrador Geral; a liberação continua pendente.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.id, 'ope_epi_entregas', a.acao, true
  FROM public.perfil_acesso p
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('alterar'::public.app_acao)) a(acao)
 WHERE p.ativo AND (p.modulo_codigo = 'operacional' OR p.concede_tudo)
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.epi_entrega_pode(p_acao public.app_acao)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_screen_access(auth.uid(), 'sup_epi_entregas', p_acao)
    OR public.has_screen_access(auth.uid(), 'ope_epi_entregas', p_acao)
  )
$fn$;
REVOKE ALL ON FUNCTION public.epi_entrega_pode(public.app_acao) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.epi_entrega_pode(public.app_acao) TO authenticated;

DROP POLICY IF EXISTS epi_entrega_select ON public."EPI_ENTREGA";
CREATE POLICY epi_entrega_select ON public."EPI_ENTREGA" FOR SELECT TO authenticated
  USING ((SELECT public.epi_entrega_pode('visualizar'::public.app_acao)));

DROP POLICY IF EXISTS epi_entrega_documento_select ON public."EPI_ENTREGA_DOCUMENTO";
CREATE POLICY epi_entrega_documento_select ON public."EPI_ENTREGA_DOCUMENTO" FOR SELECT TO authenticated
  USING ((SELECT public.epi_entrega_pode('visualizar'::public.app_acao)));

DROP POLICY IF EXISTS "epi entregas ler" ON storage.objects;
CREATE POLICY "epi entregas ler" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'epi-entregas'
    AND (SELECT public.epi_entrega_pode('visualizar'::public.app_acao)));

DROP POLICY IF EXISTS "epi entregas anexar" ON storage.objects;
CREATE POLICY "epi entregas anexar" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'epi-entregas'
    AND (SELECT public.epi_entrega_pode('alterar'::public.app_acao))
    AND EXISTS (SELECT 1 FROM public."EPI_ENTREGA" e
      WHERE e.id::text = split_part(name, '/', 1) AND e.modo = 'fisico'));

-- As quatro RPCs mantém a lógica original e passam a aceitar qualquer um dos menus.
CREATE OR REPLACE FUNCTION public.sup_epi_entrega_abrir(p_pedido uuid, p_entregador text, p_modo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE
  v_pedido public.sup_pedido%ROWTYPE;
  v_emp public."EMPREGADOS"%ROWTYPE;
  v_id uuid;
  v_itens jsonb;
  v_empresa text;
  v_separado timestamptz;
BEGIN
  IF NOT public.epi_entrega_pode('alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissao para registrar entrega de EPI' USING ERRCODE = '42501';
  END IF;
  IF p_modo NOT IN ('eletronico', 'fisico') OR length(btrim(coalesce(p_entregador, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o modo e o responsavel pela entrega';
  END IF;
  SELECT * INTO v_pedido FROM public.sup_pedido WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND OR v_pedido.status NOT IN ('RETIRADO PARA ENTREGA', 'DESPACHADO') THEN
    RAISE EXCEPTION 'O pedido precisa estar retirado para entrega ou despachado';
  END IF;
  SELECT * INTO v_emp FROM public."EMPREGADOS" e
   WHERE e."ID" = v_pedido.colaborador_empregado_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vincule o colaborador do RH ao pedido antes de registrar a entrega';
  END IF;
  IF public.col_desligado(v_emp."Situação") OR length(public.col_digitos(v_emp."CPF")) <> 11 THEN
    RAISE EXCEPTION 'O colaborador precisa estar ativo e com CPF valido no RH';
  END IF;
  IF public.sup_norm_nome(v_emp."Nome") IS DISTINCT FROM public.sup_norm_nome(v_pedido.nome_colaborador)
     OR (nullif(btrim(v_pedido.matricula_colaborador), '') IS NOT NULL
         AND btrim(v_emp."Cadastro"::text) IS DISTINCT FROM btrim(v_pedido.matricula_colaborador)) THEN
    RAISE EXCEPTION 'Nome ou matricula do pedido nao conferem com o colaborador vinculado no RH';
  END IF;

  WITH movimentos AS (
    SELECT t.pedido_item_id, t.codigo, nullif(btrim(t.ca_numero), '') AS ca,
           t.ca_validade, 1::integer AS quantidade
      FROM public.sup_estoque_tag t
     WHERE t.pedido_id = p_pedido AND t.tipo = 'unico'
       AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_consumo c
                        WHERE c.codigo = t.codigo AND c.pedido_id = p_pedido)
    UNION ALL
    SELECT c.pedido_item_id, c.codigo, nullif(btrim(t.ca_numero), ''), t.ca_validade, c.quantidade
      FROM public.sup_estoque_consumo c
      JOIN public.sup_estoque_tag t ON t.codigo = c.codigo
     WHERE c.pedido_id = p_pedido
  ), anteriores AS (
    SELECT (x.item->>'pedido_item_id')::uuid AS pedido_item_id,
           x.item->>'codigo' AS codigo, sum((x.item->>'quantidade')::integer) AS quantidade
      FROM public."EPI_ENTREGA" e
      CROSS JOIN LATERAL jsonb_array_elements(e.itens) AS x(item)
     WHERE e.pedido_id = p_pedido
     GROUP BY 1, 2
  ), disponiveis AS (
    SELECT pi.id, pi.nome_item, pi.tamanho, m.codigo, m.ca, m.ca_validade,
           sum(m.quantidade) - coalesce(max(a.quantidade), 0) AS quantidade
      FROM movimentos m
      JOIN public.sup_pedido_item pi ON pi.id = m.pedido_item_id AND pi.pedido_id = p_pedido
      LEFT JOIN public.sup_item item ON item.id = pi.item_id
      LEFT JOIN anteriores a ON a.pedido_item_id = pi.id AND a.codigo = m.codigo
     WHERE coalesce(item.tipo, pi.tipo_item) = 'epi'
     GROUP BY pi.id, pi.nome_item, pi.tamanho, m.codigo, m.ca, m.ca_validade
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'pedido_item_id', id, 'descricao', nome_item, 'tamanho', tamanho,
    'codigo', codigo, 'ca', ca, 'ca_validade', ca_validade, 'quantidade', quantidade)
    ORDER BY nome_item, codigo), '[]'::jsonb)
    INTO v_itens FROM disponiveis WHERE quantidade > 0;
  IF jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'Nao ha EPI baixado no estoque ainda sem registro de entrega';
  END IF;

  SELECT e.razao_social INTO v_empresa FROM public.empresas e WHERE e.id = v_pedido.empresa_id;
  SELECT min(h.data_alteracao) INTO v_separado FROM public.sup_pedido_historico h
   WHERE h.pedido_id = p_pedido AND h.status_novo IN ('EM SEPARACAO', 'AGUARDANDO ENVIO');
  INSERT INTO public."EPI_ENTREGA" (
    pedido_id, empregado_id, cpf, colaborador_nome, matricula, empresa_nome,
    contrato_nome, posto_nome, funcao_nome, protocolo, solicitado_em, separado_em,
    enviado_em, entregador_nome, registrado_por, modo, itens)
  VALUES (p_pedido, v_emp."ID", public.col_digitos(v_emp."CPF"), v_emp."Nome",
    v_emp."Cadastro"::text, v_empresa, v_pedido.contrato_nome, v_pedido.posto_nome,
    v_pedido.funcao_nome, v_pedido.pedido_id, v_pedido.data_solicitacao, v_separado,
    coalesce(v_pedido.retirado_em, v_pedido.data_despachado), btrim(p_entregador), auth.uid(), p_modo, v_itens)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.sup_epi_entrega_documento(p_entrega uuid, p_path text, p_legivel boolean, p_obs text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage, pg_temp AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT public.epi_entrega_pode('alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."EPI_ENTREGA" e WHERE e.id = p_entrega AND e.modo = 'fisico') THEN
    RAISE EXCEPTION 'Entrega fisica nao encontrada';
  END IF;
  IF p_path !~ ('^' || p_entrega::text || '/[0-9a-f-]{36}\.(pdf|png|jpg|jpeg)$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'epi-entregas' AND o.name = p_path) THEN
    RAISE EXCEPTION 'Arquivo da ficha nao encontrado';
  END IF;
  INSERT INTO public."EPI_ENTREGA_DOCUMENTO" (entrega_id, storage_path, legivel, observacao, anexado_por)
  VALUES (p_entrega, p_path, p_legivel, left(p_obs, 500), auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.sup_epi_pedidos_para_entrega(p_termo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_resultado jsonb;
BEGIN
  IF NOT public.epi_entrega_pode('alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.data_solicitacao DESC), '[]'::jsonb)
    INTO v_resultado FROM (
    SELECT p.id, p.pedido_id, p.nome_colaborador, p.matricula_colaborador,
           p.contrato_nome, p.posto_nome, p.status, p.data_solicitacao,
           p.colaborador_empregado_id
      FROM public.sup_pedido p
     WHERE p.status IN ('RETIRADO PARA ENTREGA', 'DESPACHADO')
       AND EXISTS (SELECT 1 FROM public.sup_pedido_item pi
                   LEFT JOIN public.sup_item i ON i.id = pi.item_id
                  WHERE pi.pedido_id = p.id AND coalesce(i.tipo, pi.tipo_item) = 'epi')
       AND (nullif(btrim(p_termo), '') IS NULL OR p.pedido_id ILIKE '%' || btrim(p_termo) || '%'
            OR p.nome_colaborador ILIKE '%' || btrim(p_termo) || '%')
     ORDER BY p.data_solicitacao DESC LIMIT 50
  ) x;
  RETURN v_resultado;
END $fn$;

CREATE OR REPLACE FUNCTION public.sup_epi_entregas_buscar(
  p_termo text DEFAULT NULL, p_status text DEFAULT NULL,
  p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL, p_pagina integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_resultado jsonb; v_termo text := left(btrim(coalesce(p_termo, '')), 100);
BEGIN
  IF NOT public.epi_entrega_pode('visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  IF p_pagina < 0 OR p_pagina > 100 THEN RAISE EXCEPTION 'Pagina invalida'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.registrado_em DESC), '[]'::jsonb)
    INTO v_resultado FROM (
    SELECT e.id, e.pedido_id, e.protocolo, e.cpf, e.colaborador_nome, e.matricula,
           e.empresa_nome, e.contrato_nome, e.posto_nome, e.funcao_nome,
           e.solicitado_em, e.separado_em, e.enviado_em, e.registrado_em,
           e.entregador_nome, e.modo, e.itens, e.confirmado_em,
           e.confirmacao_hash, e.declaracao_versao,
           CASE WHEN e.confirmado_em IS NOT NULL THEN 'confirmado'
                WHEN d.legivel IS TRUE THEN 'ficha_recebida'
                WHEN d.legivel IS FALSE THEN 'ficha_ilegivel'
                WHEN e.modo = 'fisico' THEN 'aguardando_ficha'
                ELSE 'aguardando_confirmacao' END AS situacao,
           coalesce((SELECT jsonb_agg(jsonb_build_object('id', doc.id, 'path', doc.storage_path,
             'legivel', doc.legivel, 'observacao', doc.observacao, 'anexado_em', doc.anexado_em)
             ORDER BY doc.anexado_em DESC)
             FROM public."EPI_ENTREGA_DOCUMENTO" doc WHERE doc.entrega_id = e.id), '[]'::jsonb) AS documentos
      FROM public."EPI_ENTREGA" e
      LEFT JOIN LATERAL (SELECT doc.legivel FROM public."EPI_ENTREGA_DOCUMENTO" doc
        WHERE doc.entrega_id = e.id ORDER BY doc.anexado_em DESC LIMIT 1) d ON true
     WHERE (v_termo = '' OR e.colaborador_nome ILIKE '%' || v_termo || '%'
       OR e.cpf = regexp_replace(v_termo, '[^0-9]', '', 'g')
       OR e.contrato_nome ILIKE '%' || v_termo || '%'
       OR e.protocolo ILIKE '%' || v_termo || '%'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.itens) item
                   WHERE item->>'descricao' ILIKE '%' || v_termo || '%'))
       AND (p_inicio IS NULL OR e.registrado_em >= (p_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo'))
       AND (p_fim IS NULL OR e.registrado_em < ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
       AND (p_status IS NULL OR p_status = CASE WHEN e.confirmado_em IS NOT NULL THEN 'confirmado'
                WHEN d.legivel IS TRUE THEN 'ficha_recebida'
                WHEN d.legivel IS FALSE THEN 'ficha_ilegivel'
                WHEN e.modo = 'fisico' THEN 'aguardando_ficha'
                ELSE 'aguardando_confirmacao' END)
     ORDER BY e.registrado_em DESC LIMIT 50 OFFSET p_pagina * 50
  ) x;
  RETURN v_resultado;
END $fn$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: restaurar as policies e as quatro RPCs da migration original antes
-- de retirar o menu operacional e epi_entrega_pode, preservando os registros.
