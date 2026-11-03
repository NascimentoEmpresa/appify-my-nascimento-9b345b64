-- SIS-2026-0712 (fase 1): Fluxo de Caixa — permissões separadas (Editar / Ratear / Excluir) e histórico por linha.
--
-- PERMISSÕES. Até aqui `alterar` em financeiro-fluxo-caixa-gestao liberava tudo de uma vez: editar a linha, ratear e excluir. O pedido é
-- liberar a Calita para ratear e excluir e o RH só para ratear. Sem criar ação nova no enum (excluir e incluir já existem):
--   incluir  → "Ratear"   (dividir a linha entre contratos; vem no pacote do toggle da tela)
--   alterar  → "Editar"   (ajustes só no Fluxo: data, banco, classificação, valor...; sai do pacote do toggle, ver acoesDoToggleAcesso.ts)
--   excluir  → "Excluir"  (manda a linha para a lixeira e a restaura; nunca vem no pacote do toggle)
-- Para ninguém perder o botão de excluir que já tinha, quem hoje tem `alterar` (por usuário ou por perfil) recebe `excluir` aqui.
-- Depois disso a Administração decide caso a caso.
--
-- HISTÓRICO. O ajuste do Fluxo já tem histórico (SIS-2026-0733), mas ratear e excluir/restaurar uma linha não deixavam rastro. A tabela
-- financeiro_fluxo_caixa_evento guarda esses eventos (quem, quando, o quê), escritos pelas funções de rateio/exclusão, e
-- fluxo_caixa_historico_linha() junta numa linha do tempo só: o que veio da origem (eventos do Malote / Débito Automático / carga da
-- planilha), os ajustes e esses eventos.
--
-- Migration média (tabela, 5 funções, seed de permissão): pode rodar inteira.
SET lock_timeout = '5s';

-- ── 1. Ações do menu ────────────────────────────────────────────────────
INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-fluxo-caixa-gestao', 'incluir'),
  ('financeiro-fluxo-caixa-gestao', 'excluir')
ON CONFLICT DO NOTHING;

-- Quem já editava continua podendo excluir (era o mesmo botão).
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, s.menu_codigo, 'excluir'::public.app_acao, true, s.empresa_id, 'SIS-2026-0712: excluir deixou de vir junto com alterar'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'financeiro-fluxo-caixa-gestao' AND s.acao = 'alterar' AND s.allow
   -- empresa_id nulo nunca conflita no UNIQUE: o NOT EXISTS é que garante que reexecutar não duplica
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = s.menu_codigo AND x.acao = 'excluir'
                      AND x.empresa_id IS NOT DISTINCT FROM s.empresa_id);

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, p.menu_codigo, 'excluir'::public.app_acao, true
  FROM public.perfil_acesso_permissao p
 WHERE p.menu_codigo = 'financeiro-fluxo-caixa-gestao' AND p.acao = 'alterar' AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 2. Eventos do Fluxo (rateio, exclusão, restauração) ──────────────────
CREATE TABLE IF NOT EXISTS public.financeiro_fluxo_caixa_evento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem         text NOT NULL,
  despesa_id     uuid NOT NULL,
  numero_parcela int,
  tipo           text NOT NULL CHECK (tipo IN ('rateio_criado', 'rateio_alterado', 'rateio_desfeito', 'excluido', 'restaurado')),
  descricao      text,
  detalhe        jsonb,
  usuario_id     uuid,
  usuario_nome   text,
  usuario_banco  text NOT NULL DEFAULT current_user,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ffc_evento_linha ON public.financeiro_fluxo_caixa_evento (origem, despesa_id, created_at DESC);

ALTER TABLE public.financeiro_fluxo_caixa_evento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financeiro_fluxo_caixa_evento_select ON public.financeiro_fluxo_caixa_evento;
CREATE POLICY financeiro_fluxo_caixa_evento_select ON public.financeiro_fluxo_caixa_evento
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar'));
-- Sem policy de escrita: só as funções SECURITY DEFINER abaixo gravam. Ninguém edita nem apaga o histórico.

CREATE OR REPLACE FUNCTION public.fluxo_caixa_registrar_evento(
  _origem text, _despesa_id uuid, _tipo text, _descricao text, _detalhe jsonb DEFAULT NULL, _numero_parcela int DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.financeiro_fluxo_caixa_evento (origem, despesa_id, numero_parcela, tipo, descricao, detalhe, usuario_id, usuario_nome)
  VALUES (_origem, _despesa_id, _numero_parcela, _tipo, _descricao, _detalhe, auth.uid(),
          (SELECT p.display_name FROM public.profiles p WHERE p.id = auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.fluxo_caixa_registrar_evento(text, uuid, text, text, jsonb, int) FROM PUBLIC, anon, authenticated;

-- ── 3. Excluir / restaurar linha importada: agora com ação própria e com rastro ─────────
CREATE OR REPLACE FUNCTION public.fluxo_caixa_importado_excluir(_despesa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir lançamentos do Fluxo de Caixa.';
  END IF;

  UPDATE public.fluxo_caixa_importado
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE COALESCE(rateio_grupo_id, id) = _despesa_id
     AND deleted_at IS NULL
     AND conferencia <> 'ja_existe_no_erp';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Lançamento importado não encontrado (ou já excluído).';
  END IF;
  PERFORM public.fluxo_caixa_registrar_evento('importacao_historica', _despesa_id, 'excluido',
    'Lançamento enviado para a lixeira' || CASE WHEN v_n > 1 THEN ' (rateio com ' || v_n || ' cotas)' ELSE '' END, jsonb_build_object('linhas', v_n));
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.fluxo_caixa_importado_restaurar(_despesa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para restaurar lançamentos do Fluxo de Caixa.';
  END IF;

  UPDATE public.fluxo_caixa_importado
     SET deleted_at = NULL, deleted_by = NULL
   WHERE COALESCE(rateio_grupo_id, id) = _despesa_id
     AND deleted_at IS NOT NULL
     AND deleted_by IS NOT NULL;           -- só o que um usuário excluiu pela tela
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Nada para restaurar.';
  END IF;
  PERFORM public.fluxo_caixa_registrar_evento('importacao_historica', _despesa_id, 'restaurado', 'Lançamento restaurado da lixeira', jsonb_build_object('linhas', v_n));
  RETURN v_n;
END;
$$;

-- ── 4. Ratear linha importada: ação "incluir" (Ratear) e registro do evento ─────────────
-- O corpo é o de 20261021000110; mudam só o gate (alterar → incluir) e os PERFORM fluxo_caixa_registrar_evento.
CREATE OR REPLACE FUNCTION public.fluxo_caixa_importado_ratear(_despesa_id uuid, _cotas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_linhas public.fluxo_caixa_importado[];
  v_ancora public.fluxo_caixa_importado;
  v_extras uuid[];
  v_agrupada boolean;
  v_total numeric(14,2);
  v_soma numeric(14,2) := 0;
  v_grupo uuid;
  v_codigo text;
  v_cota jsonb;
  v_i integer := 0;
  v_n integer;
  v_contrato uuid;
  v_valor numeric(14,2);
  v_texto text;
  v_detalhe jsonb;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para ratear lançamentos do Fluxo de Caixa.';
  END IF;
  IF _cotas IS NULL OR jsonb_typeof(_cotas) <> 'array' OR jsonb_array_length(_cotas) = 0 THEN
    RAISE EXCEPTION 'Informe as cotas do rateio.';
  END IF;
  v_n := jsonb_array_length(_cotas);

  PERFORM 1 FROM public.fluxo_caixa_importado fi
   WHERE COALESCE(fi.rateio_grupo_id, fi.id) = _despesa_id
     AND fi.deleted_at IS NULL
     AND fi.conferencia <> 'ja_existe_no_erp'
     FOR UPDATE;

  SELECT array_agg(fi ORDER BY fi.planilha_linha) INTO v_linhas
    FROM public.fluxo_caixa_importado fi
   WHERE COALESCE(fi.rateio_grupo_id, fi.id) = _despesa_id
     AND fi.deleted_at IS NULL
     AND fi.conferencia <> 'ja_existe_no_erp';
  IF v_linhas IS NULL THEN
    RAISE EXCEPTION 'Lançamento importado não encontrado.';
  END IF;

  v_agrupada := (v_linhas[1]).rateio_grupo_id IS NOT NULL;
  IF v_agrupada AND EXISTS (SELECT 1 FROM unnest(v_linhas) l WHERE NOT l.rateio_erp) THEN
    RAISE EXCEPTION 'Este rateio veio da planilha e não é alterado por aqui. Só rateios criados no ERP podem ser refeitos.';
  END IF;
  IF NOT v_agrupada AND v_n < 2 THEN
    RAISE EXCEPTION 'Para ratear, informe ao menos 2 cotas.';
  END IF;

  SELECT l.* INTO v_ancora FROM unnest(v_linhas) AS l WHERE l.planilha_linha < 800000001 ORDER BY l.planilha_linha LIMIT 1;
  IF v_ancora.id IS NULL THEN
    RAISE EXCEPTION 'Linha original do rateio não encontrada.';
  END IF;
  SELECT array_agg(l.id) INTO v_extras FROM unnest(v_linhas) l WHERE l.id <> v_ancora.id;

  IF v_agrupada THEN
    SELECT COALESCE(sum(l.valor), 0) INTO v_total FROM unnest(v_linhas) l;
  ELSE
    SELECT COALESCE(aj.valor, v_ancora.valor) INTO v_total
      FROM (SELECT 1) x
      LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
        ON aj.origem = 'importacao_historica' AND aj.despesa_id = _despesa_id AND aj.numero_parcela IS NULL;
  END IF;

  FOR v_cota IN SELECT * FROM jsonb_array_elements(_cotas) LOOP
    v_valor := round(COALESCE((v_cota->>'valor')::numeric, 0), 2);
    IF v_valor = 0 THEN RAISE EXCEPTION 'Toda cota precisa ter valor diferente de zero.'; END IF;
    IF sign(v_valor) <> sign(v_total) THEN RAISE EXCEPTION 'Todas as cotas precisam ter o mesmo sinal do valor do lançamento.'; END IF;
    v_contrato := NULLIF(v_cota->>'contrato_id', '')::uuid;
    IF v_contrato IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = v_contrato) THEN
      RAISE EXCEPTION 'Contrato da cota não encontrado.';
    END IF;
    v_soma := v_soma + v_valor;
  END LOOP;
  IF abs(v_soma - v_total) > 0.005 THEN
    RAISE EXCEPTION 'A soma das cotas (R$ %) precisa ser igual ao valor do lançamento (R$ %).', v_soma, v_total;
  END IF;

  -- Para o histórico: contrato (nome) e valor de cada cota, mais o rateio de antes.
  SELECT jsonb_build_object(
           'valor_total', v_total,
           'antes', CASE WHEN v_agrupada THEN (SELECT jsonb_agg(jsonb_build_object('contrato', COALESCE(c.nome, l.contrato_texto), 'valor', l.valor))
                                                 FROM unnest(v_linhas) l LEFT JOIN public.contratos c ON c.id = l.contrato_id) END,
           'depois', (SELECT jsonb_agg(jsonb_build_object('contrato', COALESCE((SELECT nome FROM public.contratos WHERE id = NULLIF(e->>'contrato_id', '')::uuid), 'Sem contrato (administrativo)'),
                                                          'valor', (e->>'valor')::numeric))
                        FROM jsonb_array_elements(_cotas) e))
    INTO v_detalhe;

  IF v_extras IS NOT NULL THEN
    DELETE FROM public.fluxo_caixa_importado WHERE id = ANY(v_extras) AND rateio_erp;
  END IF;

  IF v_n = 1 THEN
    v_contrato := NULLIF((_cotas->0)->>'contrato_id', '')::uuid;
    UPDATE public.fluxo_caixa_importado
       SET rateio_grupo_id = NULL, rateio_codigo = NULL, rateio_erp = false,
           valor = COALESCE(rateio_valor_original, v_total), rateio_valor_original = NULL,
           contrato_id = v_contrato,
           contrato_texto = CASE WHEN v_contrato IS NULL THEN 'Sem contrato (administrativo)' ELSE contrato_texto END,
           sem_contrato_confirmado = (v_contrato IS NULL)
     WHERE id = v_ancora.id;
    UPDATE public.financeiro_fluxo_caixa_ajuste SET despesa_id = v_ancora.id
     WHERE origem = 'importacao_historica' AND despesa_id = _despesa_id AND numero_parcela IS NULL AND _despesa_id <> v_ancora.id;
    PERFORM public.fluxo_caixa_registrar_evento('importacao_historica', v_ancora.id, 'rateio_desfeito', 'Rateio desfeito: a linha voltou a ser única', v_detalhe);
    RETURN;
  END IF;

  v_grupo := COALESCE(v_ancora.rateio_grupo_id, gen_random_uuid());
  v_codigo := COALESCE(v_ancora.rateio_codigo, v_ancora.planilha_id_original, 'IMP-' || lpad(v_ancora.planilha_linha::text, 5, '0'));

  FOR v_cota IN SELECT * FROM jsonb_array_elements(_cotas) LOOP
    v_i := v_i + 1;
    v_contrato := NULLIF(v_cota->>'contrato_id', '')::uuid;
    v_valor := round((v_cota->>'valor')::numeric, 2);
    v_texto := CASE WHEN v_contrato IS NULL THEN 'Sem contrato (administrativo)'
                    ELSE (SELECT nome FROM public.contratos WHERE id = v_contrato) END;
    IF v_i = 1 THEN
      UPDATE public.fluxo_caixa_importado
         SET rateio_grupo_id = v_grupo, rateio_codigo = v_codigo, rateio_erp = true,
             rateio_valor_original = COALESCE(v_ancora.rateio_valor_original, v_ancora.valor),
             contrato_id = v_contrato, contrato_texto = v_texto, valor = v_valor,
             sem_contrato_confirmado = (v_contrato IS NULL)
       WHERE id = v_ancora.id;
    ELSE
      INSERT INTO public.fluxo_caixa_importado (
        planilha_linha, planilha_id_original, tipo, data_pagamento, competencia, empresa_id,
        contrato_id, contrato_texto, classificacao_id, classificacao_texto, descricao, forma_pagamento,
        banco_id, banco_texto, valor, conferencia, conferencia_ref, observacao_importacao,
        rateio_codigo, rateio_grupo_id, rateio_valor_original, rateio_erp, sem_contrato_confirmado, created_by
      ) VALUES (
        nextval('public.fluxo_caixa_importado_linha_erp_seq'), v_ancora.planilha_id_original, v_ancora.tipo, v_ancora.data_pagamento, v_ancora.competencia, v_ancora.empresa_id,
        v_contrato, v_texto, v_ancora.classificacao_id, v_ancora.classificacao_texto, v_ancora.descricao, v_ancora.forma_pagamento,
        v_ancora.banco_id, v_ancora.banco_texto, v_valor, v_ancora.conferencia, v_ancora.conferencia_ref, v_ancora.observacao_importacao,
        v_codigo, v_grupo, COALESCE(v_ancora.rateio_valor_original, v_ancora.valor), true, (v_contrato IS NULL), auth.uid()
      );
    END IF;
  END LOOP;

  IF v_grupo <> _despesa_id THEN
    UPDATE public.financeiro_fluxo_caixa_ajuste SET despesa_id = v_grupo
     WHERE origem = 'importacao_historica' AND despesa_id = _despesa_id AND numero_parcela IS NULL;
  END IF;

  -- O evento fica sob o id do grupo (é o despesa_id que a tela passa a mostrar depois do rateio).
  PERFORM public.fluxo_caixa_registrar_evento('importacao_historica', v_grupo,
    CASE WHEN v_agrupada THEN 'rateio_alterado' ELSE 'rateio_criado' END,
    CASE WHEN v_agrupada THEN 'Rateio refeito em ' || v_n || ' cotas' ELSE 'Linha rateada em ' || v_n || ' cotas' END, v_detalhe);
  -- Quem olhava o histórico pelo id antigo (a linha avulsa) continua achando o evento.
  IF v_grupo <> _despesa_id THEN
    PERFORM public.fluxo_caixa_registrar_evento('importacao_historica', _despesa_id,
      CASE WHEN v_agrupada THEN 'rateio_alterado' ELSE 'rateio_criado' END,
      'Linha rateada em ' || v_n || ' cotas', v_detalhe);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fluxo_caixa_importado_ratear(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_importado_ratear(uuid, jsonb) TO authenticated;

-- ── 5. Histórico unificado da linha ─────────────────────────────────────
-- Origem (Malote, Débito Automático, carga da planilha) + ajustes + rateio/exclusão do Fluxo, do mais novo para o mais antigo.
-- SECURITY DEFINER porque as tabelas de evento da origem têm RLS própria; o gate é a visualização do Fluxo (mesma regra de quem vê a linha).
-- Cartão e Aplicação ainda não têm eventos próprios: o histórico deles mostra só o que aconteceu no Fluxo.
CREATE OR REPLACE FUNCTION public.fluxo_caixa_historico_linha(_origem text, _despesa_id uuid, _numero_parcela int DEFAULT NULL)
RETURNS TABLE (quando timestamptz, fonte text, tipo text, descricao text, usuario text, detalhe jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver o Fluxo de Caixa.';
  END IF;

  RETURN QUERY
  SELECT x.quando, x.fonte, x.tipo, x.descricao, x.usuario, x.detalhe FROM (
    -- 1. Origem
    SELECT ev.created_at AS quando, 'Malote'::text AS fonte, ev.tipo_evento::text AS tipo, ev.descricao::text AS descricao,
           (SELECT p.display_name FROM public.profiles p WHERE p.id = ev.ator_user_id)::text AS usuario, NULL::jsonb AS detalhe
      FROM public.malote_despesa_evento ev
     WHERE _origem = 'malote' AND ev.despesa_id = _despesa_id
    UNION ALL
    SELECT ev.created_at, 'Débito Automático', ev.tipo_evento, ev.descricao,
           (SELECT p.display_name FROM public.profiles p WHERE p.id = ev.ator_user_id), NULL::jsonb
      FROM public."DEBITO_AUTOMATICO_EVENTO" ev
     WHERE _origem = 'debito_automatico' AND ev.debito_id = _despesa_id
    UNION ALL
    SELECT min(fi.created_at), 'Planilha', 'importado',
           'Importado da planilha (linha ' || min(fi.planilha_linha) FILTER (WHERE fi.planilha_linha < 800000001) || ')'
             || COALESCE(' — ' || min(fi.observacao_importacao) FILTER (WHERE fi.planilha_linha < 800000001), ''),
           NULL::text, NULL::jsonb
      FROM public.fluxo_caixa_importado fi
     WHERE _origem = 'importacao_historica' AND COALESCE(fi.rateio_grupo_id, fi.id) = _despesa_id
    HAVING count(*) > 0
    UNION ALL
    -- 2. Ajustes feitos no Fluxo (SIS-2026-0733)
    SELECT h.created_at, 'Fluxo de Caixa', 'ajuste_' || h.operacao,
           CASE h.operacao WHEN 'criado' THEN 'Ajuste criado' WHEN 'alterado' THEN 'Ajuste alterado' ELSE 'Ajuste desfeito' END,
           COALESCE(h.usuario_nome, 'banco de dados (' || h.usuario_banco || ')'),
           jsonb_build_object('campos', h.campos, 'antes', h.antes, 'depois', h.depois)
      FROM public.financeiro_fluxo_caixa_ajuste_historico h
     WHERE h.origem = _origem AND h.despesa_id = _despesa_id AND h.numero_parcela IS NOT DISTINCT FROM _numero_parcela
    UNION ALL
    -- 3. Rateio, exclusão e restauração
    SELECT e.created_at, 'Fluxo de Caixa', e.tipo, e.descricao,
           COALESCE(e.usuario_nome, 'banco de dados (' || e.usuario_banco || ')'), e.detalhe
      FROM public.financeiro_fluxo_caixa_evento e
     WHERE e.origem = _origem AND e.despesa_id = _despesa_id AND e.numero_parcela IS NOT DISTINCT FROM _numero_parcela
  ) x
  ORDER BY x.quando DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.fluxo_caixa_historico_linha(text, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_historico_linha(text, uuid, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reaplicar fluxo_caixa_importado_excluir / _restaurar de 20261015000010 e fluxo_caixa_importado_ratear de 20261021000110 (gate 'alterar'), e:
--     DROP FUNCTION IF EXISTS public.fluxo_caixa_historico_linha(text, uuid, int);
--     DROP FUNCTION IF EXISTS public.fluxo_caixa_registrar_evento(text, uuid, text, text, jsonb, int);
--     DROP TABLE IF EXISTS public.financeiro_fluxo_caixa_evento;
--     DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-fluxo-caixa-gestao' AND acao IN ('incluir', 'excluir');
--   O 'excluir' semeado fica em screen_permission_user / perfil_acesso_permissao (motivo 'SIS-2026-0712...'); remover por esse motivo se necessário:
--     DELETE FROM public.screen_permission_user WHERE menu_codigo = 'financeiro-fluxo-caixa-gestao' AND acao = 'excluir' AND motivo LIKE 'SIS-2026-0712%';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
