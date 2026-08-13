-- =====================================================================
-- SIS-2026-0112 — Suprimentos cota uma solicitação do Malote
--
-- O malote é o tronco: a solicitação nasce lá e avança por etapas, cada uma
-- dependendo de um setor. Uma delas depende de Suprimentos cotar, e enquanto
-- isso não acontece a solicitação fica parada. Esta migration entrega essa
-- perna: da chegada em `aguardando_cotacao` até `cotacao_aprovada` (ou
-- `solicitacao_reprovada`), quando o item volta para o Malote virar Despesa.
--
-- ⚠️ ESTA MIGRATION MEXE NA TABELA DE OUTRO DEV (malote_despesa).
-- Foram acrescentadas ~20 colunas e NENHUMA policy dele foi alterada. Avise o
-- responsável pelo Malote antes de aplicar. Duas consequências ficam
-- registradas aqui:
--   1. guardar as cotações em colunas (decisão de produto) FIXA o teto de 3
--      no schema — passar para tabela filha depois é migration nova;
--   2. Suprimentos passa a escrever os status cotacao_realizada,
--      cotacao_aprovada e solicitacao_reprovada.
--
-- POR QUE TUDO É RPC E NÃO UPDATE DIRETO
-- A policy de UPDATE de malote_despesa é:
--   (created_by = auth.uid() AND status NOT IN (...finais...))
--   OR has_role(admin) OR malote_supervisor_por_cargo(auth.uid())
-- Ou seja: quem é de Suprimentos NÃO consegue alterar a solicitação de outra
-- pessoa, e nem o criador consegue levá-la a solicitacao_reprovada. E
-- malote_supervisor_por_cargo só cobre Controladoria/Diretor/Sistemas/
-- Presidente. Em vez de afrouxar a RLS dele, toda escrita passa por função
-- SECURITY DEFINER com a porta em can_access(..., 'sup_cotacoes_malote', ...).
-- A RLS do Malote fica intacta e a permissão vive no Acesso por Usuário.
--
-- LEITURA já funciona: o SELECT dele libera empresa_id = get_user_empresa().
-- =====================================================================

-- ── 1. As colunas das cotações ───────────────────────────────────────
ALTER TABLE public.malote_despesa
  ADD COLUMN IF NOT EXISTS cot1_fornecedor  text,
  ADD COLUMN IF NOT EXISTS cot1_valor       numeric(14,2),
  ADD COLUMN IF NOT EXISTS cot1_prazo       date,
  ADD COLUMN IF NOT EXISTS cot1_link        text,
  ADD COLUMN IF NOT EXISTS cot1_anexo_path  text,
  ADD COLUMN IF NOT EXISTS cot1_anexo_nome  text,
  ADD COLUMN IF NOT EXISTS cot2_fornecedor  text,
  ADD COLUMN IF NOT EXISTS cot2_valor       numeric(14,2),
  ADD COLUMN IF NOT EXISTS cot2_prazo       date,
  ADD COLUMN IF NOT EXISTS cot2_link        text,
  ADD COLUMN IF NOT EXISTS cot2_anexo_path  text,
  ADD COLUMN IF NOT EXISTS cot2_anexo_nome  text,
  ADD COLUMN IF NOT EXISTS cot3_fornecedor  text,
  ADD COLUMN IF NOT EXISTS cot3_valor       numeric(14,2),
  ADD COLUMN IF NOT EXISTS cot3_prazo       date,
  ADD COLUMN IF NOT EXISTS cot3_link        text,
  ADD COLUMN IF NOT EXISTS cot3_anexo_path  text,
  ADD COLUMN IF NOT EXISTS cot3_anexo_nome  text,
  ADD COLUMN IF NOT EXISTS cotacao_enviada_em        timestamptz,
  ADD COLUMN IF NOT EXISTS cotacao_enviada_por       uuid,
  ADD COLUMN IF NOT EXISTS cotacao_enviada_por_nome  text,
  ADD COLUMN IF NOT EXISTS cotacao_decidida_em       timestamptz,
  ADD COLUMN IF NOT EXISTS cotacao_decidida_por      uuid,
  ADD COLUMN IF NOT EXISTS cotacao_decidida_por_nome text,
  ADD COLUMN IF NOT EXISTS cotacao_reprovada_motivo  text,
  ADD COLUMN IF NOT EXISTS cotacao_observacoes       text,
  ADD COLUMN IF NOT EXISTS cotacao_vencedor_num      smallint;

DO $$ BEGIN
  ALTER TABLE public.malote_despesa
    ADD CONSTRAINT malote_despesa_cotacao_vencedor_check
    CHECK (cotacao_vencedor_num IS NULL OR cotacao_vencedor_num IN (1, 2, 3));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.malote_despesa.cotacao_vencedor_num IS
  'Qual das 3 cotações venceu (1|2|3). valor_aprovado_cotacao recebe o valor dela.';
COMMENT ON COLUMN public.malote_despesa.cotacao_reprovada_motivo IS
  'Obrigatório quando Suprimentos reprova (SIS-2026-0112, regra 4).';

-- ── 2. Quem é do Suprimentos, e o nome de quem agiu ──────────────────

-- 1234.5 → "1.234,50". `to_char` com G/D segue o lc_numeric do servidor, que
-- aqui não é pt-BR: sem isto o log de auditoria sai "R$ 1,100.00".
CREATE OR REPLACE FUNCTION public.sup_malote_brl(_v numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT translate(to_char(coalesce(_v, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;
CREATE OR REPLACE FUNCTION public.sup_malote_pode(_acao public.app_acao)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access(auth.uid(), 'sup_cotacoes_malote', _acao);
$$;

-- Nome sempre do cadastro, nunca do payload — mesma regra de
-- sup_cot_nome_usuario (20260827000001), para o log de auditoria valer algo.
CREATE OR REPLACE FUNCTION public.sup_malote_nome_ator()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.email), ''), 'Usuário sem nome')
    FROM public.profiles p WHERE p.id = auth.uid();
$$;

-- Guarda comum das cinco ações de escrita: existe, é da minha empresa, tenho
-- permissão e o status ainda permite mexer.
CREATE OR REPLACE FUNCTION public.sup_malote_carregar(_id uuid, _acao public.app_acao)
RETURNS public.malote_despesa LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.malote_despesa;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sup_malote_pode(_acao) THEN
    RAISE EXCEPTION 'Sem permissão em Suprimentos > Cotações do Malote' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v FROM public.malote_despesa d WHERE d.id = _id;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v.empresa_id <> public.get_user_empresa(auth.uid()) THEN
    RAISE EXCEPTION 'Solicitação de outra empresa' USING ERRCODE = '42501';
  END IF;

  -- "Para os status finais não é permitido retornar para etapas anteriores"
  -- (SIS-2026-0112, regra 4).
  IF v.status IN ('cotacao_aprovada','solicitacao_reprovada','cancelada',
                  'despesa_paga','despesa_reprovada','aguardando_pagamento',
                  'pendente_aprovacao','necessidade_de_ajuste') THEN
    RAISE EXCEPTION 'Esta solicitação está em "%" e não aceita mais alteração de cotação', v.status
      USING ERRCODE = '22023';
  END IF;

  RETURN v;
END $$;

-- Grava as 3 cotações a partir do jsonb. Sempre as três posições, para
-- limpar quem foi apagado na tela.
CREATE OR REPLACE FUNCTION public.sup_malote_aplicar_cotacoes(_id uuid, _cot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c1 jsonb := _cot->0; c2 jsonb := _cot->1; c3 jsonb := _cot->2;
BEGIN
  UPDATE public.malote_despesa SET
    cot1_fornecedor = nullif(btrim(c1->>'fornecedor'), ''),
    cot1_valor      = nullif(c1->>'valor', '')::numeric,
    cot1_prazo      = nullif(c1->>'prazo', '')::date,
    cot1_link       = nullif(btrim(c1->>'link'), ''),
    cot1_anexo_path = nullif(btrim(c1->>'anexo_path'), ''),
    cot1_anexo_nome = nullif(btrim(c1->>'anexo_nome'), ''),
    cot2_fornecedor = nullif(btrim(c2->>'fornecedor'), ''),
    cot2_valor      = nullif(c2->>'valor', '')::numeric,
    cot2_prazo      = nullif(c2->>'prazo', '')::date,
    cot2_link       = nullif(btrim(c2->>'link'), ''),
    cot2_anexo_path = nullif(btrim(c2->>'anexo_path'), ''),
    cot2_anexo_nome = nullif(btrim(c2->>'anexo_nome'), ''),
    cot3_fornecedor = nullif(btrim(c3->>'fornecedor'), ''),
    cot3_valor      = nullif(c3->>'valor', '')::numeric,
    cot3_prazo      = nullif(c3->>'prazo', '')::date,
    cot3_link       = nullif(btrim(c3->>'link'), ''),
    cot3_anexo_path = nullif(btrim(c3->>'anexo_path'), ''),
    cot3_anexo_nome = nullif(btrim(c3->>'anexo_nome'), ''),
    updated_at = now(), updated_by = auth.uid()
  WHERE id = _id;
END $$;

-- ── 3. Salvar rascunho ───────────────────────────────────────────────
-- Não mexe no status: serve para o comprador ir juntando orçamento ao longo
-- do dia sem mandar para aprovação.
CREATE OR REPLACE FUNCTION public.sup_malote_salvar_rascunho(p_id uuid, p_cotacoes jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.malote_despesa;
BEGIN
  v := public.sup_malote_carregar(p_id, 'alterar');
  PERFORM public.sup_malote_aplicar_cotacoes(p_id, coalesce(p_cotacoes, '[]'::jsonb));

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'edicao', auth.uid(),
          format('Cotações salvas como rascunho por %s.', public.sup_malote_nome_ator()));
END $$;

-- ── 4. Enviar cotação ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_malote_enviar_cotacao(p_id uuid, p_cotacoes jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v      public.malote_despesa;
  v_nome text := public.sup_malote_nome_ator();
  v_min  int;
  v_qtd  int;
  i      int;
  c      jsonb;
BEGIN
  v := public.sup_malote_carregar(p_id, 'alterar');

  -- "Somente será possível enviar cotações para aprovação quando a
  -- solicitação estiver no status Cotação Pendente" (regra 4 do chamado).
  IF v.status <> 'aguardando_cotacao' THEN
    RAISE EXCEPTION 'Só é possível enviar cotação a partir de "Cotação Pendente" (atual: %)', v.status
      USING ERRCODE = '22023';
  END IF;

  -- Dispensa de cotação já vem com o orçamento definido: uma basta.
  v_min := CASE WHEN v.tipo = 'dispensa_cotacao' THEN 1 ELSE 3 END;

  v_qtd := 0;
  FOR i IN 0..2 LOOP
    c := coalesce(p_cotacoes, '[]'::jsonb) -> i;
    IF coalesce(btrim(c->>'fornecedor'), '') <> '' THEN
      v_qtd := v_qtd + 1;
      IF coalesce(btrim(c->>'valor'), '') = '' OR (c->>'valor')::numeric <= 0 THEN
        RAISE EXCEPTION 'Informe o valor da cotação %', i + 1 USING ERRCODE = '22023';
      END IF;
      IF coalesce(btrim(c->>'prazo'), '') = '' THEN
        RAISE EXCEPTION 'Informe o prazo da cotação %', i + 1 USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  IF v_qtd < v_min THEN
    RAISE EXCEPTION 'São necessárias % cotação(ões) preenchidas; há %.', v_min, v_qtd
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.sup_malote_aplicar_cotacoes(p_id, p_cotacoes);

  UPDATE public.malote_despesa SET
    status = 'cotacao_realizada',
    cotacao_enviada_em = now(), cotacao_enviada_por = auth.uid(),
    cotacao_enviada_por_nome = v_nome,
    -- Reenvio depois de reprovada limpa a reprovação anterior.
    cotacao_reprovada_motivo = NULL,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'cotacao_realizada', auth.uid(),
          format('%s cotação(ões) enviada(s) por %s.', v_qtd, v_nome));
END $$;

-- ── 5. Aprovar ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_malote_aprovar_cotacao(
  p_id uuid, p_vencedor smallint, p_observacoes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v      public.malote_despesa;
  v_nome text := public.sup_malote_nome_ator();
  v_forn text;
  v_val  numeric;
BEGIN
  v := public.sup_malote_carregar(p_id, 'aprovar');

  IF v.status NOT IN ('aguardando_cotacao', 'cotacao_realizada') THEN
    RAISE EXCEPTION 'Só dá para aprovar cotação de solicitação em cotação (atual: %)', v.status
      USING ERRCODE = '22023';
  END IF;
  IF p_vencedor IS NULL OR p_vencedor NOT IN (1,2,3) THEN
    RAISE EXCEPTION 'Escolha qual cotação venceu (1, 2 ou 3)' USING ERRCODE = '22023';
  END IF;

  SELECT CASE p_vencedor WHEN 1 THEN v.cot1_fornecedor WHEN 2 THEN v.cot2_fornecedor ELSE v.cot3_fornecedor END,
         CASE p_vencedor WHEN 1 THEN v.cot1_valor      WHEN 2 THEN v.cot2_valor      ELSE v.cot3_valor      END
    INTO v_forn, v_val;

  -- "Não é permitido avançar sem que haja pelo menos 1 cotação aprovada."
  IF coalesce(btrim(v_forn), '') = '' OR v_val IS NULL THEN
    RAISE EXCEPTION 'A cotação % não está preenchida', p_vencedor USING ERRCODE = '22023';
  END IF;

  UPDATE public.malote_despesa SET
    status = 'cotacao_aprovada',
    cotacao_vencedor_num = p_vencedor,
    valor_aprovado_cotacao = v_val,        -- coluna que o Malote já lia
    cotacao_observacoes = nullif(btrim(p_observacoes), ''),
    cotacao_decidida_em = now(), cotacao_decidida_por = auth.uid(),
    cotacao_decidida_por_nome = v_nome,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'cotacao_aprovada', auth.uid(),
          format('Cotação aprovada por %s — %s, R$ %s.', v_nome, v_forn, public.sup_malote_brl(v_val)));
END $$;

-- ── 6. Reprovar ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_malote_reprovar_cotacao(p_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v      public.malote_despesa;
  v_nome text := public.sup_malote_nome_ator();
BEGIN
  v := public.sup_malote_carregar(p_id, 'aprovar');

  IF v.status NOT IN ('aguardando_cotacao', 'cotacao_realizada') THEN
    RAISE EXCEPTION 'Só dá para reprovar cotação de solicitação em cotação (atual: %)', v.status
      USING ERRCODE = '22023';
  END IF;
  -- "Motivo da reprovação é obrigatório" (regra 4 do chamado).
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'O motivo da reprovação é obrigatório' USING ERRCODE = '22023';
  END IF;

  UPDATE public.malote_despesa SET
    status = 'solicitacao_reprovada',
    cotacao_reprovada_motivo = btrim(p_motivo),
    cotacao_decidida_em = now(), cotacao_decidida_por = auth.uid(),
    cotacao_decidida_por_nome = v_nome,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'solicitacao_reprovada', auth.uid(),
          format('Cotação reprovada por %s: %s', v_nome, btrim(p_motivo)));
END $$;

-- ── 7. Cancelar ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_malote_cancelar_cotacao(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v      public.malote_despesa;
  v_nome text := public.sup_malote_nome_ator();
BEGIN
  v := public.sup_malote_carregar(p_id, 'excluir');

  UPDATE public.malote_despesa SET
    status = 'cancelada',
    cotacao_observacoes = nullif(btrim(p_motivo), ''),
    cotacao_decidida_em = now(), cotacao_decidida_por = auth.uid(),
    cotacao_decidida_por_nome = v_nome,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'cancelamento', auth.uid(),
          format('Cancelada por %s%s', v_nome,
                 CASE WHEN coalesce(btrim(p_motivo),'') = '' THEN '.' ELSE ': ' || btrim(p_motivo) END));
END $$;

-- ── 8. "Compras passadas" ────────────────────────────────────────────
--
-- Não existe base de compras consolidada no ERP. O painel nasce do próprio
-- módulo: cada cotação aprovada vira histórico daquela classificação. Começa
-- vazio — é o que o mock 3.1.1 já desenha ("Nenhum histórico encontrado").
CREATE OR REPLACE FUNCTION public.sup_malote_compras_passadas(
  p_classificacao_id uuid, p_ignorar_id uuid DEFAULT NULL)
RETURNS TABLE (
  compras             int,
  valor_medio         numeric,
  fornecedor_frequente text,
  fornecedor_pct      int,
  ultima_valor        numeric,
  ultima_data         timestamptz,
  ultima_fornecedor   text,
  menor_valor         numeric,
  menor_data          timestamptz,
  menor_fornecedor    text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT d.valor_aprovado_cotacao AS valor,
           d.cotacao_decidida_em    AS quando,
           CASE d.cotacao_vencedor_num WHEN 1 THEN d.cot1_fornecedor
                                       WHEN 2 THEN d.cot2_fornecedor
                                       ELSE d.cot3_fornecedor END AS fornecedor
      FROM public.malote_despesa d
     WHERE d.status = 'cotacao_aprovada'
       AND d.classificacao_id = p_classificacao_id
       AND d.empresa_id = public.get_user_empresa(auth.uid())
       AND d.valor_aprovado_cotacao IS NOT NULL
       AND (p_ignorar_id IS NULL OR d.id <> p_ignorar_id)
     ORDER BY d.cotacao_decidida_em DESC NULLS LAST
     LIMIT 10                       -- "baseado nas últimas 10 compras"
  ),
  freq AS (
    SELECT fornecedor, count(*) n FROM base
     WHERE coalesce(btrim(fornecedor), '') <> ''
     GROUP BY 1 ORDER BY n DESC, fornecedor LIMIT 1
  )
  SELECT (SELECT count(*)::int FROM base),
         (SELECT round(avg(valor), 2) FROM base),
         (SELECT fornecedor FROM freq),
         (SELECT round(100.0 * n / nullif((SELECT count(*) FROM base), 0))::int FROM freq),
         (SELECT valor FROM base ORDER BY quando DESC NULLS LAST LIMIT 1),
         (SELECT quando FROM base ORDER BY quando DESC NULLS LAST LIMIT 1),
         (SELECT fornecedor FROM base ORDER BY quando DESC NULLS LAST LIMIT 1),
         (SELECT valor FROM base ORDER BY valor ASC LIMIT 1),
         (SELECT quando FROM base ORDER BY valor ASC LIMIT 1),
         (SELECT fornecedor FROM base ORDER BY valor ASC LIMIT 1);
$$;

-- ── 9. Permissões de execução ────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'sup_malote_salvar_rascunho(uuid, jsonb)',
    'sup_malote_enviar_cotacao(uuid, jsonb)',
    'sup_malote_aprovar_cotacao(uuid, smallint, text)',
    'sup_malote_reprovar_cotacao(uuid, text)',
    'sup_malote_cancelar_cotacao(uuid, text)',
    'sup_malote_compras_passadas(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Auxiliares: não são porta de entrada, mas são chamadas de dentro das RPCs.
REVOKE ALL ON FUNCTION public.sup_malote_carregar(uuid, public.app_acao) FROM public, anon;
REVOKE ALL ON FUNCTION public.sup_malote_aplicar_cotacoes(uuid, jsonb)   FROM public, anon;

-- ── 10. Conferência ──────────────────────────────────────────────────
SELECT count(*) AS colunas_de_cotacao
  FROM information_schema.columns
 WHERE table_name = 'malote_despesa' AND column_name LIKE 'cot%';

SELECT status, count(*) AS n FROM public.malote_despesa GROUP BY 1 ORDER BY 1;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.sup_malote_salvar_rascunho(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.sup_malote_enviar_cotacao(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.sup_malote_aprovar_cotacao(uuid, smallint, text);
--   DROP FUNCTION IF EXISTS public.sup_malote_reprovar_cotacao(uuid, text);
--   DROP FUNCTION IF EXISTS public.sup_malote_cancelar_cotacao(uuid, text);
--   DROP FUNCTION IF EXISTS public.sup_malote_compras_passadas(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.sup_malote_carregar(uuid, public.app_acao);
--   DROP FUNCTION IF EXISTS public.sup_malote_aplicar_cotacoes(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.sup_malote_nome_ator();
--   DROP FUNCTION IF EXISTS public.sup_malote_pode(public.app_acao);
--   ALTER TABLE public.malote_despesa
--     DROP COLUMN cot1_fornecedor, ... (as 27 colunas acima);
-- =====================================================================
