-- =====================================================================
-- [SEM-CHAMADO] 05/10/2026 — "Iniciar cotação": quem pegou a solicitação
--
-- PROBLEMA QUE ISSO RESOLVE
-- A fila de Cotações do Malote é compartilhada: todo mundo de Suprimentos vê
-- as mesmas solicitações em "Cotação Pendente". Não havia como saber se
-- alguém já estava atrás dos orçamentos de uma delas — dois compradores
-- ligavam para os mesmos fornecedores, e o segundo a salvar sobrescrevia as
-- cotações do primeiro (sup_malote_aplicar_cotacoes grava as três posições
-- sempre, inclusive as vazias).
--
-- O comprador abre o detalhe e clica em "Iniciar cotação". A partir daí o
-- card dele na fila mostra "Sendo cotado por <nome>", e só ele (ou alguém com
-- a ação `aprovar` da tela) consegue liberar.
--
-- NÃO é tranca de escrita. Quem tem permissão continua conseguindo salvar e
-- enviar a cotação de qualquer solicitação — é sinalização de fila, não
-- lock pessimista. Travar a escrita por aqui deixaria item preso quando o
-- comprador entra de férias, e o ganho real está em avisar antes do trabalho
-- duplicado, não em bloquear depois.
-- =====================================================================

-- ── 1. Colunas ───────────────────────────────────────────────────────
ALTER TABLE public.malote_despesa
  ADD COLUMN IF NOT EXISTS cotacao_iniciada_em        timestamptz,
  ADD COLUMN IF NOT EXISTS cotacao_iniciada_por       uuid,
  ADD COLUMN IF NOT EXISTS cotacao_iniciada_por_nome  text;

COMMENT ON COLUMN public.malote_despesa.cotacao_iniciada_por IS
  'Comprador que assumiu a cotação (botão "Iniciar cotação"). Sinalização de fila, não trava escrita.';
COMMENT ON COLUMN public.malote_despesa.cotacao_iniciada_por_nome IS
  'Snapshot do nome em profiles no momento do clique — o card da fila mostra este texto.';

-- ── 2. Tipos de evento novos ─────────────────────────────────────────
-- A lista vem de 20260930000246; só entram 'cotacao_iniciada' e
-- 'cotacao_liberada' no fim.
ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
  'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
  'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
  'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
  'conferido_pagamento', 'ajuste_pagamento_solicitado',
  'despesa_paga', 'despesa_reprovada', 'cancelamento', 'exclusao', 'restauracao',
  'ajuste_administrativo', 'aprovacao_automatica_cotacao', 'ajuste_cotacao_solicitado',
  'cotacao_iniciada', 'cotacao_liberada'
));

-- ── 3. Assumir a cotação ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_malote_iniciar_cotacao(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v      public.malote_despesa;
  v_nome text := public.sup_malote_nome_ator();
BEGIN
  -- Mesma guarda das outras escritas do módulo: empresa, permissão e status
  -- que ainda aceita mexer na cotação.
  v := public.sup_malote_carregar(p_id, 'alterar');

  IF v.status <> 'aguardando_cotacao' THEN
    RAISE EXCEPTION 'Só dá para iniciar a cotação em "Cotação Pendente" (atual: %)', v.status
      USING ERRCODE = '22023';
  END IF;

  -- Já é meu: clique repetido (dois toques no celular, F5) não deve virar
  -- erro na tela nem segundo evento no histórico.
  IF v.cotacao_iniciada_por = auth.uid() THEN
    RETURN;
  END IF;

  IF v.cotacao_iniciada_por IS NOT NULL THEN
    RAISE EXCEPTION 'Esta solicitação já está sendo cotada por %. Peça para liberar antes de assumir.',
      coalesce(nullif(btrim(v.cotacao_iniciada_por_nome), ''), 'outro usuário')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.malote_despesa SET
    cotacao_iniciada_em = now(),
    cotacao_iniciada_por = auth.uid(),
    cotacao_iniciada_por_nome = v_nome,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'cotacao_iniciada', auth.uid(),
          format('%s assumiu a cotação.', v_nome));
END $$;

-- ── 4. Liberar ───────────────────────────────────────────────────────
-- Quem assumiu libera. Quem tem a ação `aprovar` da tela também — senão
-- comprador de férias deixa o item marcado para sempre, e a fila volta a
-- mentir sobre quem está trabalhando nela. Sem has_role aqui: a porta é a
-- mesma permissão por usuário do resto do módulo.
CREATE OR REPLACE FUNCTION public.sup_malote_liberar_cotacao(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v      public.malote_despesa;
  v_nome text := public.sup_malote_nome_ator();
  v_quem text;
BEGIN
  v := public.sup_malote_carregar(p_id, 'alterar');

  IF v.cotacao_iniciada_por IS NULL THEN
    RETURN;  -- ninguém assumiu: nada a liberar, e não é erro.
  END IF;

  IF v.cotacao_iniciada_por <> auth.uid() AND NOT public.sup_malote_pode('aprovar') THEN
    RAISE EXCEPTION 'Só % ou um aprovador de Cotações do Malote pode liberar esta cotação.',
      coalesce(nullif(btrim(v.cotacao_iniciada_por_nome), ''), 'quem assumiu')
      USING ERRCODE = '42501';
  END IF;

  v_quem := coalesce(nullif(btrim(v.cotacao_iniciada_por_nome), ''), 'o comprador anterior');

  UPDATE public.malote_despesa SET
    cotacao_iniciada_em = NULL,
    cotacao_iniciada_por = NULL,
    cotacao_iniciada_por_nome = NULL,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'cotacao_liberada', auth.uid(),
          CASE WHEN v.cotacao_iniciada_por = auth.uid()
               THEN format('%s liberou a cotação.', v_nome)
               ELSE format('%s liberou a cotação que estava com %s.', v_nome, v_quem) END);
END $$;

-- ── 5. A marca morre junto com a etapa ───────────────────────────────
-- Em vez de recriar sup_malote_enviar_cotacao e
-- sup_malote_solicitar_ajuste_cotacao (que já foram reescritas em
-- 246/251 e voltariam a divergir), um trigger limpa as três colunas em
-- QUALQUER troca de status. Pega os dois casos de uma vez:
--   enviar  → sai de aguardando_cotacao, a etapa de cotar acabou;
--   ajuste  → VOLTA para aguardando_cotacao, e aí é rodada nova: a fila
--             fica livre de novo, sem herdar o nome de quem cotou antes.
-- sup_malote_iniciar_cotacao não mexe no status, então não se atropela.
CREATE OR REPLACE FUNCTION public.malote_despesa_limpar_cotacao_iniciada()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.cotacao_iniciada_em := NULL;
    NEW.cotacao_iniciada_por := NULL;
    NEW.cotacao_iniciada_por_nome := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS malote_despesa_limpar_cotacao_iniciada_trg ON public.malote_despesa;
CREATE TRIGGER malote_despesa_limpar_cotacao_iniciada_trg
  BEFORE UPDATE OF status ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.malote_despesa_limpar_cotacao_iniciada();

-- ── 6. Índice ────────────────────────────────────────────────────────
-- "O que está comigo na fila" é a leitura que a tela faz na prática.
CREATE INDEX IF NOT EXISTS idx_malote_despesa_cotacao_iniciada_por
  ON public.malote_despesa (cotacao_iniciada_por)
  WHERE cotacao_iniciada_por IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS malote_despesa_limpar_cotacao_iniciada_trg ON public.malote_despesa;
-- DROP FUNCTION IF EXISTS public.malote_despesa_limpar_cotacao_iniciada();
-- DROP FUNCTION IF EXISTS public.sup_malote_iniciar_cotacao(uuid);
-- DROP FUNCTION IF EXISTS public.sup_malote_liberar_cotacao(uuid);
-- DROP INDEX IF EXISTS public.idx_malote_despesa_cotacao_iniciada_por;
-- ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS cotacao_iniciada_em;
-- ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS cotacao_iniciada_por;
-- ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS cotacao_iniciada_por_nome;
-- ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
-- ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
--   'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
--   'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
--   'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
--   'conferido_pagamento', 'ajuste_pagamento_solicitado',
--   'despesa_paga', 'despesa_reprovada', 'cancelamento', 'exclusao', 'restauracao',
--   'ajuste_administrativo', 'aprovacao_automatica_cotacao', 'ajuste_cotacao_solicitado'
-- ));
-- NOTIFY pgrst, 'reload schema';
