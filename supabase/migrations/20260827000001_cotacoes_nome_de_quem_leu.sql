-- =====================================================================
-- COTAÇÕES — carimbar PESSOA, nunca setor
--
-- POR QUE
-- As telas diziam "Visualizado por Compras", "Licitação leu em…" e
-- "Visualizado por você". Nome de setor não serve para auditoria: o pedido do
-- usuário é justamente conseguir ver quem abriu a cotação, inclusive quando
-- for alguém que não deveria estar olhando.
--
-- O BURACO DE DADOS
-- A leitura da resposta pela Licitação só guardava resposta_visualizada_por_id
-- — não havia coluna de nome. Era por isso que a tela só conseguia dizer "por
-- você": ela não tinha o nome de mais ninguém para mostrar.
--
-- O QUE MUDA
--   1. coluna resposta_visualizada_por_nome, com backfill do que já existe;
--   2. RPC sup_cot_marcar_resposta_lida — nome vindo de profiles, como já é
--      do lado de Compras, para ninguém carimbar leitura com nome alheio;
--   3. o trigger de colunas passa a cobrir a coluna nova;
--   4. some o fallback 'Compras': sem display_name usa o e-mail, e só então
--      um rótulo genérico. Setor nunca mais aparece como se fosse gente.
-- =====================================================================

-- ── 1. A coluna que faltava ──────────────────────────────────────────
ALTER TABLE public.cotacoes_licitacao
  ADD COLUMN IF NOT EXISTS resposta_visualizada_por_nome text;

-- Quem já leu ganhou nome retroativo a partir do cadastro.
UPDATE public.cotacoes_licitacao c
   SET resposta_visualizada_por_nome = COALESCE(p.display_name, p.email)
  FROM public.profiles p
 WHERE p.id = c.resposta_visualizada_por_id
   AND c.resposta_visualizada_por_nome IS NULL;

-- ── 2. Nome sempre do cadastro, nunca do cliente ─────────────────────
CREATE OR REPLACE FUNCTION public.sup_cot_nome_usuario(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- display_name → e-mail → rótulo genérico. Nunca um nome de setor: a tela
  -- precisa distinguir PESSOAS para a auditoria fazer sentido.
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.email), ''), 'Usuário sem nome')
    FROM public.profiles p WHERE p.id = _uid;
$$;

-- ── 3. Licitação marcando que leu a resposta ─────────────────────────
-- Antes era um UPDATE cru do cliente, que podia mandar qualquer id. Vira RPC
-- pelo mesmo motivo do lado de Compras: o nome sai do banco.
CREATE OR REPLACE FUNCTION public.sup_cot_marcar_resposta_lida(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.can_access(v_uid, 'cotacoes-licitacao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver as cotações da Licitação.' USING ERRCODE = '42501';
  END IF;

  -- Só a PRIMEIRA leitura conta: quem abriu antes é quem fica registrado.
  UPDATE public.cotacoes_licitacao
     SET resposta_visualizada_por_id   = v_uid,
         resposta_visualizada_por_nome = public.sup_cot_nome_usuario(v_uid),
         resposta_visualizada_em       = now()
   WHERE id = p_id
     AND status = 'respondido'
     AND resposta_visualizada_por_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sup_cot_marcar_resposta_lida(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sup_cot_marcar_resposta_lida(uuid) TO authenticated;

-- ── 4. As RPCs de Compras param de cair em 'Compras' ─────────────────
CREATE OR REPLACE FUNCTION public.sup_cot_marcar_visualizada(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.can_access(v_uid, 'sup_cotacoes', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver as cotações de Compras.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.cotacoes_licitacao
     SET status               = 'visualizado',
         visualizado_por_id   = v_uid,
         visualizado_por_nome = public.sup_cot_nome_usuario(v_uid),
         visualizado_em       = now()
   WHERE id = p_id
     AND status = 'pendente';
END;
$$;

CREATE OR REPLACE FUNCTION public.sup_cot_responder(
  p_id uuid, p_comentario text, p_arquivos jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_n    int;
BEGIN
  IF NOT public.can_access(v_uid, 'sup_cotacoes', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para responder cotação.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_comentario), '') = '' THEN
    RAISE EXCEPTION 'O comentário da resposta é obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF p_arquivos IS NULL OR jsonb_array_length(p_arquivos) = 0 THEN
    RAISE EXCEPTION 'A resposta exige ao menos um arquivo anexado.' USING ERRCODE = '22023';
  END IF;

  v_nome := public.sup_cot_nome_usuario(v_uid);

  UPDATE public.cotacoes_licitacao
     SET resposta_comentario = p_comentario,
         respondente_id      = v_uid,
         respondente_nome    = v_nome,
         data_resposta       = now(),
         status              = 'respondido',
         -- Resposta nova é resposta não lida: reacende o aviso na Licitação.
         resposta_visualizada_por_id   = NULL,
         resposta_visualizada_por_nome = NULL,
         resposta_visualizada_em       = NULL
   WHERE id = p_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Cotação não encontrada ou fora do seu acesso.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.cotacoes_licitacao_arquivo
         (cotacao_id, lado, caminho, nome, tamanho, enviado_por, enviado_por_nome)
  SELECT p_id, 'resposta',
         a->>'caminho', a->>'nome', NULLIF(a->>'tamanho', '')::bigint, v_uid, v_nome
    FROM jsonb_array_elements(p_arquivos) AS a
   WHERE COALESCE(btrim(a->>'caminho'), '') <> ''
  ON CONFLICT (cotacao_id, lado, caminho) DO NOTHING;
END;
$$;

-- ── 5. O trigger passa a cobrir a coluna nova ────────────────────────
-- Sem isto, resposta_visualizada_por_nome ficaria fora da guarda e qualquer
-- um dos dois lados poderia reescrever o nome de quem leu.
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

  -- a) o pedido em si — só Licitação mexe
  IF (NEW.comentario, NEW.tipo, NEW.arquivo_url, NEW.arquivo_nome)
     IS DISTINCT FROM (OLD.comentario, OLD.tipo, OLD.arquivo_url, OLD.arquivo_nome)
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

  -- d) leitura da resposta pela Licitação (agora com o nome junto)
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

-- ── 6. Conferência ───────────────────────────────────────────────────
SELECT visualizado_por_nome        AS leu_o_pedido,
       respondente_nome            AS respondeu,
       resposta_visualizada_por_nome AS leu_a_resposta
  FROM public.cotacoes_licitacao
 ORDER BY created_at DESC;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.cotacoes_licitacao DROP COLUMN resposta_visualizada_por_nome;
--   DROP FUNCTION IF EXISTS public.sup_cot_marcar_resposta_lida(uuid);
--   DROP FUNCTION IF EXISTS public.sup_cot_nome_usuario(uuid);
--   -- e recriar cotacoes_guarda_colunas da 20260825000001
-- =====================================================================
