-- SIS-2026-0825 — Conciliação da Ticket (Financeiro › Ferramentas)
-- ============================================================================
-- A Ticket (plataforma de benefícios, ticketrh.loyalme.io) tem um extrato próprio: "Pagamento de Boleto" (debitado) e "Tickets" (adicionado, um
-- crédito por colaborador). O Financeiro quer conferir esse extrato contra o que o ERP registra, em valores reais (R$).
--
--   • ticket_extrato_importacao / ticket_extrato_linha: o CSV baixado da plataforma ("Baixar extrato em CSV"), gravado no ERP. Importar de novo
--     um arquivo que cubra o mesmo período SUBSTITUI as linhas daquelas datas (o extrato não tem id por linha, então é assim que não duplica).
--   • ticket_extrato_importar(arquivo, linhas jsonb): grava a importação e as linhas numa transação só. Permissão: ação "incluir" da tela.
--   • ticket_extrato_excluir_importacao(id): remove uma importação e suas linhas. Permissão: ação "alterar" da tela.
--   • ticket_conciliacao_erp(ini, fim): o que o ERP pagou com "TICKET" na descrição (Malote, linhas importadas da planilha e Débito Automático),
--     UMA linha por lançamento (o rateio entre contratos é somado), para o comparativo mês a mês da tela.
--
-- Menu novo 'conciliacao-ticket' (Financeiro), só para os perfis que concedem tudo; o resto é liberado por usuário em Administração.
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.ticket_conciliacao_erp(date, date);
--   DROP FUNCTION IF EXISTS public.ticket_extrato_excluir_importacao(uuid);
--   DROP FUNCTION IF EXISTS public.ticket_extrato_importar(text, jsonb);
--   DROP TABLE IF EXISTS public.ticket_extrato_linha;
--   DROP TABLE IF EXISTS public.ticket_extrato_importacao;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'conciliacao-ticket';
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'conciliacao-ticket';
--   DELETE FROM public.app_menu WHERE codigo = 'conciliacao-ticket';
--   NOTIFY pgrst, 'reload schema';

-- 1) menu e permissão
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'conciliacao-ticket', 'Conciliação da Ticket', '/app/financeiro/conciliacao-ticket', 42, true
  FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'conciliacao-ticket', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao), ('alterar'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- 2) o extrato importado
CREATE TABLE IF NOT EXISTS public.ticket_extrato_importacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_nome text NOT NULL,
  periodo_ini date NOT NULL,
  periodo_fim date NOT NULL,
  qtd_linhas integer NOT NULL,
  total_creditos numeric(14,2) NOT NULL DEFAULT 0,
  total_boletos numeric(14,2) NOT NULL DEFAULT 0,   -- em módulo (o extrato traz negativo)
  importado_por uuid,   -- sem FK em auth.users: só auditoria
  importado_por_nome text,
  importado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ticket_extrato_linha (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id uuid NOT NULL REFERENCES public.ticket_extrato_importacao(id) ON DELETE CASCADE,
  data date NOT NULL,
  transacao text NOT NULL,   -- como veio: "Pagamento de Boleto", "Tickets", "CREDIT"
  status text NOT NULL,      -- "debitado" | "adicionado"
  valor numeric(14,2) NOT NULL,   -- com sinal, como no extrato
  ordem integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ticket_extrato_linha_importacao_id_idx ON public.ticket_extrato_linha (importacao_id);
CREATE INDEX IF NOT EXISTS ticket_extrato_linha_data_idx ON public.ticket_extrato_linha (data);

ALTER TABLE public.ticket_extrato_importacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_extrato_linha ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_extrato_importacao_select ON public.ticket_extrato_importacao;
CREATE POLICY ticket_extrato_importacao_select ON public.ticket_extrato_importacao FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'conciliacao-ticket', 'visualizar'::public.app_acao)));
DROP POLICY IF EXISTS ticket_extrato_linha_select ON public.ticket_extrato_linha;
CREATE POLICY ticket_extrato_linha_select ON public.ticket_extrato_linha FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'conciliacao-ticket', 'visualizar'::public.app_acao)));
-- Escrita só pelas RPCs abaixo (SECURITY DEFINER): sem policy de insert/update/delete.

-- 3) importar o CSV. _linhas = [{"data": "2026-10-15", "transacao": "Tickets", "status": "adicionado", "valor": 23.06}, ...]
CREATE OR REPLACE FUNCTION public.ticket_extrato_importar(_arquivo text, _linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nome text;
  v_ini date;
  v_fim date;
  v_n integer;
  v_id uuid;
  v_removidas integer;
  v_creditos numeric(14,2);
  v_boletos numeric(14,2);
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(v_uid, 'conciliacao-ticket', 'incluir'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para importar o extrato da Ticket.' USING ERRCODE = '42501';
  END IF;
  IF _linhas IS NULL OR jsonb_typeof(_linhas) <> 'array' OR jsonb_array_length(_linhas) = 0 THEN
    RAISE EXCEPTION 'O arquivo não tem nenhuma linha.';
  END IF;
  v_n := jsonb_array_length(_linhas);
  IF v_n > 50000 THEN RAISE EXCEPTION 'Arquivo grande demais (% linhas). Importe por períodos menores.', v_n; END IF;

  DROP TABLE IF EXISTS pg_temp._ticket_linhas;
  CREATE TEMP TABLE _ticket_linhas ON COMMIT DROP AS
  SELECT (e->>'data')::date AS data, btrim(e->>'transacao') AS transacao, lower(btrim(e->>'status')) AS status,
         round((e->>'valor')::numeric, 2) AS valor, (row_number() OVER ())::integer AS ordem
    FROM jsonb_array_elements(_linhas) e;
  IF EXISTS (SELECT 1 FROM _ticket_linhas WHERE data IS NULL OR valor IS NULL OR COALESCE(transacao, '') = '' OR COALESCE(status, '') = '') THEN
    RAISE EXCEPTION 'Há linha sem data, transação, status ou valor.';
  END IF;

  SELECT min(data), max(data) INTO v_ini, v_fim FROM _ticket_linhas;
  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;

  -- O arquivo é a verdade do período que cobre: troca as linhas dessas datas (e apaga a importação que ficar sem linha nenhuma).
  DELETE FROM public.ticket_extrato_linha WHERE data BETWEEN v_ini AND v_fim;
  GET DIAGNOSTICS v_removidas = ROW_COUNT;
  DELETE FROM public.ticket_extrato_importacao i WHERE NOT EXISTS (SELECT 1 FROM public.ticket_extrato_linha l WHERE l.importacao_id = i.id);

  SELECT COALESCE(sum(valor) FILTER (WHERE lower(transacao) = 'tickets' AND status = 'adicionado'), 0),
         COALESCE(abs(sum(valor) FILTER (WHERE lower(transacao) LIKE '%boleto%')), 0)
    INTO v_creditos, v_boletos FROM _ticket_linhas;

  INSERT INTO public.ticket_extrato_importacao (arquivo_nome, periodo_ini, periodo_fim, qtd_linhas, total_creditos, total_boletos, importado_por, importado_por_nome)
  VALUES (COALESCE(NULLIF(btrim(_arquivo), ''), 'extrato.csv'), v_ini, v_fim, v_n, v_creditos, v_boletos, v_uid, v_nome)
  RETURNING id INTO v_id;

  INSERT INTO public.ticket_extrato_linha (importacao_id, data, transacao, status, valor, ordem)
  SELECT v_id, data, transacao, status, valor, ordem FROM _ticket_linhas;

  RETURN jsonb_build_object('importacao_id', v_id, 'inseridas', v_n, 'substituidas', v_removidas, 'periodo_ini', v_ini, 'periodo_fim', v_fim);
END;
$$;
REVOKE ALL ON FUNCTION public.ticket_extrato_importar(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_extrato_importar(text, jsonb) TO authenticated;

-- 4) excluir uma importação
CREATE OR REPLACE FUNCTION public.ticket_extrato_excluir_importacao(_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access(auth.uid(), 'conciliacao-ticket', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para excluir importação do extrato da Ticket.' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_n FROM public.ticket_extrato_linha WHERE importacao_id = _id;
  DELETE FROM public.ticket_extrato_importacao WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada.'; END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.ticket_extrato_excluir_importacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_extrato_excluir_importacao(uuid) TO authenticated;

-- 5) o lado do ERP: saídas com "TICKET" na descrição, uma linha por lançamento (parcela inclusa)
CREATE OR REPLACE FUNCTION public.ticket_conciliacao_erp(_ini date, _fim date)
RETURNS TABLE (despesa_id uuid, origem text, id_malote text, numero_parcela integer, data_pagamento date, descricao text,
               empresa_id uuid, empresa_nome text, classificacao_nome text, valor numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'conciliacao-ticket', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso à Conciliação da Ticket.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT x.despesa_id, x.origem, min(x.id_malote)::text, x.numero_parcela, min(x.data_pagamento)::date, min(x.descricao)::text,
         min(x.empresa_id::text)::uuid, min(x.empresa_nome)::text, min(x.classificacao_nome)::text, round(sum(x.valor)::numeric, 2)
    FROM (
      SELECT m.despesa_id, m.origem, m.id_malote, m.numero_parcela, m.data_pagamento, m.descricao, m.empresa_id, m.empresa_nome, m.classificacao_nome, m.valor, m.tipo
        FROM public.v_malote_pagamento_fluxo_caixa m
      UNION ALL
      SELECT i.despesa_id, i.origem, i.id_malote, i.numero_parcela, i.data_pagamento, i.descricao, i.empresa_id, i.empresa_nome, i.classificacao_nome, i.valor, i.tipo
        FROM public.v_fluxo_caixa_importado_fluxo_caixa i
      UNION ALL
      SELECT d.despesa_id, d.origem, d.id_malote, d.numero_parcela, d.data_pagamento, d.descricao, d.empresa_id, d.empresa_nome, d.classificacao_nome, d.valor, d.tipo
        FROM public.v_debito_automatico_fluxo_caixa d
    ) x
   WHERE x.tipo = 'saida'
     AND x.descricao ILIKE '%ticket%'
     AND x.data_pagamento BETWEEN _ini AND _fim
   GROUP BY x.despesa_id, x.origem, x.numero_parcela
   ORDER BY min(x.data_pagamento), min(x.id_malote);
END;
$$;
REVOKE ALL ON FUNCTION public.ticket_conciliacao_erp(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_conciliacao_erp(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
