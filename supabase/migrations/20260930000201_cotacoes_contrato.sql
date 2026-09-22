-- =====================================================================
-- SIS-2026-0487 — COTAÇÕES: o contrato que está sendo cotado
--
-- O PEDIDO (Compras, CASSIO RAPHAELLI CAMARGO DUARTE)
-- O relatório das solicitações de cotação já mostra mês, quem pediu e
-- quando. Falta o que mais importa para quem precisa buscar depois: QUAL
-- CONTRATO está sendo cotado. Hoje isso só existe solto dentro do texto do
-- comentário, então para montar um relatório por contrato é preciso abrir
-- cotação por cotação — foi exatamente assim que o chamado descreveu a dor
-- ("precisa ser aberto um a um para ter essa informação").
--
-- O QUE ESTA MIGRATION FAZ
--   1. coluna `contrato` em cotacoes_licitacao;
--   2. trigger que a torna OBRIGATÓRIA em solicitação nova (e normaliza o
--      espaçamento), sem quebrar as 151+ linhas históricas que nasceram
--      sem ela;
--   3. o guard de colunas passa a cobrir `contrato` — é dado do PEDIDO,
--      então só a Licitação escreve, igual a `comentario`/`tipo`;
--   4. índice para o agrupamento "Contratos cotados" da tela de Compras.
--
-- POR QUE NÃO `NOT NULL`
-- As cotações que já existem não têm como adivinhar o contrato retroativo —
-- um NOT NULL exigiria inventar valor ou apagar histórico. A obrigatoriedade
-- entra pela porta por onde o dado nasce (INSERT), e o histórico continua
-- legível, aparecendo como "Sem contrato informado" nas duas telas.
--
-- ROLLBACK: ver o bloco no fim do arquivo.
-- =====================================================================

-- ── 1. A coluna ──────────────────────────────────────────────────────
ALTER TABLE public.cotacoes_licitacao
  ADD COLUMN IF NOT EXISTS contrato text;

COMMENT ON COLUMN public.cotacoes_licitacao.contrato IS
  'Nome/identificação do contrato que está sendo cotado (SIS-2026-0487). '
  'Obrigatório em solicitação nova; NULL apenas no histórico anterior à coluna.';

-- Texto livre digitado por gente: sem teto, um copy/paste de processo
-- inteiro entraria como "contrato" e estouraria o dropdown da tela de
-- Compras, que lista exatamente o que foi digitado.
ALTER TABLE public.cotacoes_licitacao
  DROP CONSTRAINT IF EXISTS cotacoes_contrato_tamanho;
ALTER TABLE public.cotacoes_licitacao
  ADD CONSTRAINT cotacoes_contrato_tamanho
  CHECK (contrato IS NULL OR char_length(contrato) <= 200) NOT VALID;

-- ── 2. Obrigatório de verdade, no banco ──────────────────────────────
--
-- A tela já bloqueia o botão sem contrato, mas a tela não é a autoridade:
-- a mesma linha é alcançável pela API REST do PostgREST com qualquer
-- payload. Trigger próprio em vez de NOT NULL pelo motivo no cabeçalho, e
-- BEFORE INSERT OR UPDATE para que editar uma solicitação também não possa
-- esvaziar o campo.
CREATE OR REPLACE FUNCTION public.cotacoes_contrato_obrigatorio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Normaliza antes de julgar: "  Contrato 42  " e "Contrato 42" são o MESMO
  -- contrato para o agrupamento da tela de Compras, e espaço invisível de
  -- copy/paste criaria duas entradas no dropdown que parecem idênticas.
  NEW.contrato := NULLIF(btrim(NEW.contrato), '');

  IF TG_OP = 'INSERT' THEN
    IF NEW.contrato IS NULL THEN
      RAISE EXCEPTION 'Informe o contrato que está sendo cotado.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: só barra quem TENTOU mexer no campo e o deixou vazio. Linha
  -- histórica (contrato NULL) continua podendo ser lida, respondida e
  -- marcada como vista normalmente — senão a coluna nova travaria o fluxo
  -- de 151 cotações antigas.
  IF NEW.contrato IS NULL
     AND OLD.contrato IS NOT NULL THEN
    RAISE EXCEPTION 'O contrato não pode ser apagado de uma cotação que já o tem.'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cotacoes_contrato_obrigatorio ON public.cotacoes_licitacao;
CREATE TRIGGER trg_cotacoes_contrato_obrigatorio
  BEFORE INSERT OR UPDATE ON public.cotacoes_licitacao
  FOR EACH ROW EXECUTE FUNCTION public.cotacoes_contrato_obrigatorio();

-- ── 3. `contrato` é dado do PEDIDO, não da resposta ──────────────────
--
-- Recriação integral de cotacoes_guarda_colunas (última versão na
-- 20260827000001) com `contrato` acrescentado ao bloco (a). Sem isto,
-- Compras — que legitimamente dá UPDATE na mesma linha para responder —
-- poderia reescrever o contrato informado pela Licitação, e a policy de
-- UPDATE não distingue coluna.
CREATE OR REPLACE FUNCTION public.cotacoes_guarda_colunas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_lic_ver boolean;
  v_lic_alt boolean;
  v_com_ver boolean;
  v_com_alt boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  v_lic_ver := public.can_access(v_uid, 'cotacoes-licitacao', 'visualizar');
  v_lic_alt := public.can_access(v_uid, 'cotacoes-licitacao', 'alterar');
  v_com_ver := public.can_access(v_uid, 'sup_cotacoes', 'visualizar');
  v_com_alt := public.can_access(v_uid, 'sup_cotacoes', 'alterar');

  -- a) o pedido em si — só Licitação mexe (agora com o contrato junto)
  IF (NEW.comentario, NEW.tipo, NEW.contrato, NEW.arquivo_url, NEW.arquivo_nome)
     IS DISTINCT FROM (OLD.comentario, OLD.tipo, OLD.contrato, OLD.arquivo_url, OLD.arquivo_nome)
     AND NOT v_lic_alt THEN
    RAISE EXCEPTION 'Sem permissão para alterar a solicitação de cotação (exige alterar em Licitações > Cotações).'
      USING ERRCODE = '42501';
  END IF;

  -- b) a resposta — só Compras escreve
  IF (NEW.resposta_comentario, NEW.resposta_arquivo_url, NEW.resposta_arquivo_nome,
      NEW.respondente_id, NEW.respondente_nome, NEW.data_resposta)
     IS DISTINCT FROM (OLD.resposta_comentario, OLD.resposta_arquivo_url, OLD.resposta_arquivo_nome,
      OLD.respondente_id, OLD.respondente_nome, OLD.data_resposta)
     AND NOT v_com_alt THEN
    RAISE EXCEPTION 'Sem permissão para responder cotação (exige alterar em Suprimentos > Cotações).'
      USING ERRCODE = '42501';
  END IF;

  -- c) leitura por Compras. Limpar é da edição da Licitação (§7.2); carimbar é de Compras.
  IF (NEW.visualizado_por_id, NEW.visualizado_por_nome, NEW.visualizado_em)
     IS DISTINCT FROM (OLD.visualizado_por_id, OLD.visualizado_por_nome, OLD.visualizado_em) THEN
    IF NEW.visualizado_por_id IS NULL AND NEW.visualizado_em IS NULL THEN
      IF NOT v_lic_alt THEN
        RAISE EXCEPTION 'Sem permissão para reabrir a cotação como não lida.' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT v_com_ver THEN
      RAISE EXCEPTION 'Sem permissão para marcar a cotação como visualizada por Compras.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- d) leitura da resposta pela Licitação (com o nome junto)
  IF (NEW.resposta_visualizada_por_id, NEW.resposta_visualizada_por_nome, NEW.resposta_visualizada_em)
     IS DISTINCT FROM (OLD.resposta_visualizada_por_id, OLD.resposta_visualizada_por_nome, OLD.resposta_visualizada_em)
     AND NOT v_lic_ver THEN
    RAISE EXCEPTION 'Sem permissão para marcar a resposta como lida.' USING ERRCODE = '42501';
  END IF;

  -- e) status: cada destino exige o lado que legitimamente leva o item até lá
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF    NEW.status = 'pendente'    AND NOT v_lic_alt THEN
      RAISE EXCEPTION 'Sem permissão para devolver a cotação a pendente.' USING ERRCODE = '42501';
    ELSIF NEW.status = 'visualizado' AND NOT v_com_ver THEN
      RAISE EXCEPTION 'Sem permissão para marcar a cotação como visualizada.' USING ERRCODE = '42501';
    ELSIF NEW.status = 'respondido'  AND NOT v_com_alt THEN
      RAISE EXCEPTION 'Sem permissão para responder cotação.' USING ERRCODE = '42501';
    ELSIF NEW.status NOT IN ('pendente', 'visualizado', 'respondido') THEN
      RAISE EXCEPTION 'Status de cotação inválido: %', NEW.status USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- O trigger de guarda continua BEFORE UPDATE (é ele que compara OLD/NEW);
-- recriado aqui só para garantir que aponta para a função nova em banco
-- onde a 20260825000001 tenha sido reaplicada fora de ordem.
DROP TRIGGER IF EXISTS trg_cotacoes_guarda_colunas ON public.cotacoes_licitacao;
CREATE TRIGGER trg_cotacoes_guarda_colunas
  BEFORE UPDATE ON public.cotacoes_licitacao
  FOR EACH ROW EXECUTE FUNCTION public.cotacoes_guarda_colunas();

-- ── 4. Índice do agrupamento por contrato ────────────────────────────
-- O dropdown "Contratos cotados" da tela de Compras agrupa por este campo.
-- Parcial: linha sem contrato nunca entra no agrupamento, então não ocupa
-- espaço no índice.
CREATE INDEX IF NOT EXISTS idx_cotacoes_contrato
  ON public.cotacoes_licitacao (contrato)
  WHERE contrato IS NOT NULL;

-- ── 5. Conferência ───────────────────────────────────────────────────
SELECT COALESCE(contrato, '(sem contrato — anterior a SIS-2026-0487)') AS contrato,
       count(*) AS cotacoes,
       max(created_at)                                                 AS mais_recente
  FROM public.cotacoes_licitacao
 GROUP BY 1
 ORDER BY 3 DESC;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_cotacoes_contrato_obrigatorio ON public.cotacoes_licitacao;
--   DROP FUNCTION IF EXISTS public.cotacoes_contrato_obrigatorio();
--   DROP INDEX IF EXISTS public.idx_cotacoes_contrato;
--   ALTER TABLE public.cotacoes_licitacao DROP CONSTRAINT IF EXISTS cotacoes_contrato_tamanho;
--   ALTER TABLE public.cotacoes_licitacao DROP COLUMN IF EXISTS contrato;
--   -- e recriar cotacoes_guarda_colunas como está na 20260827000001
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
