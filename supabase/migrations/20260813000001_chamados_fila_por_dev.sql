-- =====================================================================
-- CHAMADOS DE SISTEMAS — fila POR DESENVOLVEDOR (posição de execução).
--
-- A fila global (ordem de chegada) continua existindo, mas cada dev passa a
-- ter a SUA própria ordem: o chamado que é o nº 3 da fila global pode ser o
-- nº 1 do Pablo, se for a única tarefa pendente dele. Essa ordem fica em
-- "CHAMADO_SISTEMA".posicao_dev e é definida na tela de coordenação
-- ("Definir posição da nova tarefa na fila" + arrastar a fila do responsável).
--
-- Regras garantidas por trigger/RPC:
--   * chamado concluído/reprovado NÃO tem posição (posicao_dev = NULL);
--   * chamado ativo COM responsável sempre tem posição (entra no fim da fila
--     quando ninguém escolheu uma — ex.: atribuição rápida do painel);
--   * a fila de cada dev é normalizada para 1..n a cada direcionamento,
--     reordenação ou troca de responsável.
--
-- Idempotente. Aplicar DEPOIS de 20260811000001_chamados_fila_satisfacao.sql.
-- =====================================================================

-- 1) Coluna + índice ----------------------------------------------------
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS posicao_dev integer;

CREATE INDEX IF NOT EXISTS idx_chamado_sistema_posicao_dev
  ON public."CHAMADO_SISTEMA"(responsavel_id, posicao_dev);

-- 2) Normalizador da fila de um dev (1..n, só ativos) -------------------
-- Interno: chamado pelas RPCs abaixo. Não recebe GRANT para authenticated.
CREATE OR REPLACE FUNCTION public.chamado_normalizar_fila_dev(p_responsavel_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE public."CHAMADO_SISTEMA" c
     SET posicao_dev = f.rn
    FROM (
      SELECT id, row_number() OVER (ORDER BY posicao_dev NULLS LAST, created_at, id) AS rn
        FROM public."CHAMADO_SISTEMA"
       WHERE responsavel_id = p_responsavel_id
         AND status NOT IN ('concluido', 'reprovado')
    ) f
   WHERE c.id = f.id
     AND c.posicao_dev IS DISTINCT FROM f.rn::int;
$$;
REVOKE ALL ON FUNCTION public.chamado_normalizar_fila_dev(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_normalizar_fila_dev(uuid) FROM anon;

-- 3) Coerência da posição (trigger) -------------------------------------
-- Concluiu/reprovou ou ficou sem responsável → some da fila.
-- Ativo com responsável e sem posição (ou trocou de dev sem posição nova)
-- → entra no fim da fila do responsável.
CREATE OR REPLACE FUNCTION public.chamado_sistema_fila_dev()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('concluido', 'reprovado') OR NEW.responsavel_id IS NULL THEN
    NEW.posicao_dev := NULL;
  ELSIF NEW.posicao_dev IS NULL
     OR (TG_OP = 'UPDATE'
         AND NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
         AND NEW.posicao_dev IS NOT DISTINCT FROM OLD.posicao_dev) THEN
    SELECT COALESCE(max(posicao_dev), 0) + 1 INTO NEW.posicao_dev
      FROM public."CHAMADO_SISTEMA"
     WHERE responsavel_id = NEW.responsavel_id
       AND status NOT IN ('concluido', 'reprovado')
       AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_fila_dev ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_fila_dev
  BEFORE INSERT OR UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_fila_dev();

-- 4) Backfill dos chamados já atribuídos --------------------------------
UPDATE public."CHAMADO_SISTEMA" c
   SET posicao_dev = f.rn
  FROM (
    SELECT id, row_number() OVER (PARTITION BY responsavel_id ORDER BY created_at, id) AS rn
      FROM public."CHAMADO_SISTEMA"
     WHERE responsavel_id IS NOT NULL
       AND status NOT IN ('concluido', 'reprovado')
  ) f
 WHERE c.id = f.id AND c.posicao_dev IS NULL;

UPDATE public."CHAMADO_SISTEMA"
   SET posicao_dev = NULL
 WHERE posicao_dev IS NOT NULL
   AND (status IN ('concluido', 'reprovado') OR responsavel_id IS NULL);

-- 5) Direcionar o chamado (tela de coordenação) -------------------------
-- Atribui o responsável, define em que posição da fila DELE a solicitação
-- entra (empurrando as demais para baixo) e registra o evento no histórico.
CREATE OR REPLACE FUNCTION public.chamado_direcionar(
  p_chamado_id     uuid,
  p_responsavel_id uuid,
  p_posicao        int  DEFAULT NULL,
  p_observacao     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_numero    text;
  v_status    text;
  v_anterior  uuid;
  v_total     int;
  v_pos       int;
  v_nome      text;
BEGIN
  IF NOT public.tem_acesso_menu('chamados_sistemas_coordenar') THEN
    RAISE EXCEPTION 'Sem permissão para direcionar chamados.';
  END IF;
  IF p_responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Escolha o responsável pela execução.';
  END IF;

  SELECT numero, status, responsavel_id
    INTO v_numero, v_status, v_anterior
    FROM public."CHAMADO_SISTEMA"
   WHERE id = p_chamado_id
     FOR UPDATE;

  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF v_status IN ('concluido', 'reprovado') THEN
    RAISE EXCEPTION 'Chamado encerrado — não é possível direcionar.';
  END IF;

  -- Tamanho da fila de destino (sem contar o próprio chamado).
  SELECT count(*)::int INTO v_total
    FROM public."CHAMADO_SISTEMA"
   WHERE responsavel_id = p_responsavel_id
     AND status NOT IN ('concluido', 'reprovado')
     AND id <> p_chamado_id;

  v_pos := LEAST(GREATEST(COALESCE(p_posicao, v_total + 1), 1), v_total + 1);

  -- Abre espaço na posição escolhida.
  UPDATE public."CHAMADO_SISTEMA"
     SET posicao_dev = posicao_dev + 1
   WHERE responsavel_id = p_responsavel_id
     AND status NOT IN ('concluido', 'reprovado')
     AND id <> p_chamado_id
     AND posicao_dev >= v_pos;

  -- Responsável + status + observação (a posição vem no UPDATE seguinte,
  -- senão o trigger de coerência jogaria o chamado para o fim da fila).
  UPDATE public."CHAMADO_SISTEMA"
     SET responsavel_id     = p_responsavel_id,
         status             = CASE WHEN status = 'aberto' THEN 'em_andamento' ELSE status END,
         observacao_gerente = COALESCE(NULLIF(btrim(COALESCE(p_observacao, '')), ''), observacao_gerente)
   WHERE id = p_chamado_id;

  UPDATE public."CHAMADO_SISTEMA" SET posicao_dev = v_pos WHERE id = p_chamado_id;

  PERFORM public.chamado_normalizar_fila_dev(p_responsavel_id);
  IF v_anterior IS NOT NULL AND v_anterior <> p_responsavel_id THEN
    PERFORM public.chamado_normalizar_fila_dev(v_anterior);
  END IF;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = p_responsavel_id;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          format('Chamado direcionado a %s — %sº lugar na fila do responsável',
                 COALESCE(v_nome, 'responsável'), v_pos));
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_direcionar(uuid, uuid, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_direcionar(uuid, uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_direcionar(uuid, uuid, int, text) TO authenticated;

-- 6) Reordenar a fila de um dev (arrastar as tarefas) -------------------
-- Quem coordena reordena a fila de qualquer dev; o dev reordena a própria.
CREATE OR REPLACE FUNCTION public.chamado_reordenar_fila_dev(
  p_responsavel_id uuid,
  p_ordem          uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.tem_acesso_menu('chamados_sistemas_coordenar')
          OR p_responsavel_id = auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para reordenar a fila deste responsável.';
  END IF;

  UPDATE public."CHAMADO_SISTEMA" c
     SET posicao_dev = x.ord
    FROM (SELECT unnest(p_ordem) AS id, generate_subscripts(p_ordem, 1) AS ord) x
   WHERE c.id = x.id
     AND c.responsavel_id = p_responsavel_id
     AND c.status NOT IN ('concluido', 'reprovado')
     AND c.posicao_dev IS DISTINCT FROM x.ord;

  PERFORM public.chamado_normalizar_fila_dev(p_responsavel_id);
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_reordenar_fila_dev(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_reordenar_fila_dev(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_reordenar_fila_dev(uuid, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
