-- =========================================================================
-- Solicitações do encarregado: um colaborador não entra duas vezes na fila
--
-- Pedido do Pablo em 14/09/2026: "em solicitar demissão consigo fazer a
-- solicitação do mesmo colaborador diversas vezes — se eu fiz uma vez tem
-- que bloquear 'esse colaborador já tem solicitação de demissão'. O mesmo
-- pra todas as outras solicitações, não pode duplicar. Pra férias 'esse
-- colaborador já tem solicitação de férias nesses últimos 150 dias'."
--
-- UMA função decide (solicitacao_em_aberto) e é chamada dos dois lados:
--   • pelo trigger BEFORE INSERT de cada tabela — é o que garante, mesmo
--     numa tela antiga ainda no ar em produção;
--   • pela tela, via RPC, na hora em que o colaborador é escolhido — pra
--     avisar antes de a pessoa preencher o formulário inteiro.
--
-- O que conta como "já tem":
--   demissao      status fora de Reprovada/Cancelada (viva ou já concluída —
--                 quem saiu não pede demissão de novo; reprovada libera).
--   ferias        status fora de Reprovada/Cancelada, aberta nos últimos
--                 150 dias.
--   troca_funcao  status fora de Reprovada/Concluída (uma mudança por vez).
--   advertencia   ainda aguardando decisão (Aguardando Aprovação/Jurídico).
--                 Advertência REPETE de propósito — verbal, escrita,
--                 suspensão —, então só a que ainda não foi decidida trava.
--
-- SECURITY DEFINER porque a advertência tem RLS por tela (adv_select): o
-- encarregado não enxerga a de outro encarregado, mas a duplicidade tem que
-- ser vista por cima disso. A função só devolve id/status/data — nada do
-- conteúdo.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.solicitacao_em_aberto(p_tipo text, p_colaborador_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
BEGIN
  IF p_colaborador_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_tipo = 'demissao' THEN
    SELECT id, status, criado_em INTO r
      FROM public."SISTEMA_SOLICITACOES_DEMISSAO"
     WHERE colaborador_id = p_colaborador_id
       AND status NOT IN ('Reprovada', 'Cancelada')
     ORDER BY criado_em DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'tipo', 'demissao', 'id', r.id, 'status', r.status, 'criado_em', r.criado_em,
        'mensagem', format('Este colaborador já tem solicitação de demissão (#%s, %s, aberta em %s).',
                           r.id, r.status, to_char(r.criado_em, 'DD/MM/YYYY')));
    END IF;

  ELSIF p_tipo = 'ferias' THEN
    SELECT id, status, criado_em, data_saida INTO r
      FROM public."SISTEMA_SOLICITACOES_FERIAS"
     WHERE colaborador_id = p_colaborador_id
       AND status NOT IN ('Reprovada', 'Cancelada')
       AND criado_em >= now() - interval '150 days'
     ORDER BY criado_em DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'tipo', 'ferias', 'id', r.id, 'status', r.status, 'criado_em', r.criado_em,
        'mensagem', format('Este colaborador já tem solicitação de férias nos últimos 150 dias (#%s, %s, saída em %s).',
                           r.id, r.status, to_char(r.data_saida, 'DD/MM/YYYY')));
    END IF;

  ELSIF p_tipo = 'troca_funcao' THEN
    SELECT id, status, criado_em INTO r
      FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
     WHERE colaborador_id = p_colaborador_id
       AND status NOT IN ('Reprovada', 'Concluída')
     ORDER BY criado_em DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'tipo', 'troca_funcao', 'id', r.id, 'status', r.status, 'criado_em', r.criado_em,
        'mensagem', format('Este colaborador já tem solicitação de mudança de função em andamento (#%s, %s, aberta em %s).',
                           r.id, r.status, to_char(r.criado_em, 'DD/MM/YYYY')));
    END IF;

  ELSIF p_tipo = 'advertencia' THEN
    SELECT id, status, created_at AS criado_em INTO r
      FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA"
     WHERE colaborador_id = p_colaborador_id
       AND status IN ('Aguardando Aprovação', 'Aguardando Jurídico')
     ORDER BY created_at DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'tipo', 'advertencia', 'id', r.id, 'status', r.status, 'criado_em', r.criado_em,
        'mensagem', format('Este colaborador já tem advertência aguardando decisão (#%s, %s, aberta em %s). Espere ela ser decidida antes de abrir outra.',
                           r.id, r.status, to_char(r.criado_em, 'DD/MM/YYYY')));
    END IF;
  END IF;

  RETURN NULL;
END $fn$;

REVOKE ALL ON FUNCTION public.solicitacao_em_aberto(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solicitacao_em_aberto(text, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.solicitacao_em_aberto(text, bigint) TO authenticated;

-- ── Triggers: a mesma regra, no INSERT de cada tabela ────────────────────
-- BEFORE INSERT: a linha nova ainda não está na tabela, então a busca não
-- encontra ela mesma. TG_ARGV[0] diz o tipo.
CREATE OR REPLACE FUNCTION public.solicitacao_bloqueia_duplicada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  dup jsonb;
BEGIN
  dup := public.solicitacao_em_aberto(TG_ARGV[0], NEW.colaborador_id);
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION '%', dup->>'mensagem';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_demissao_sem_duplicidade ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_sem_duplicidade
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_duplicada('demissao');

DROP TRIGGER IF EXISTS trg_ferias_sem_duplicidade ON public."SISTEMA_SOLICITACOES_FERIAS";
CREATE TRIGGER trg_ferias_sem_duplicidade
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_FERIAS"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_duplicada('ferias');

DROP TRIGGER IF EXISTS trg_troca_funcao_sem_duplicidade ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
CREATE TRIGGER trg_troca_funcao_sem_duplicidade
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_duplicada('troca_funcao');

DROP TRIGGER IF EXISTS trg_advertencia_sem_duplicidade ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE TRIGGER trg_advertencia_sem_duplicidade
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_duplicada('advertencia');

NOTIFY pgrst, 'reload schema';

-- ── Conferência: duplicadas que JÁ existem (o trigger não mexe no passado) ──
-- SELECT colaborador_id, colaborador_nome, count(*), array_agg(id ORDER BY id)
--   FROM public."SISTEMA_SOLICITACOES_DEMISSAO"
--  WHERE status NOT IN ('Reprovada','Cancelada')
--  GROUP BY 1, 2 HAVING count(*) > 1;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_demissao_sem_duplicidade     ON public."SISTEMA_SOLICITACOES_DEMISSAO";
-- DROP TRIGGER IF EXISTS trg_ferias_sem_duplicidade       ON public."SISTEMA_SOLICITACOES_FERIAS";
-- DROP TRIGGER IF EXISTS trg_troca_funcao_sem_duplicidade ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
-- DROP TRIGGER IF EXISTS trg_advertencia_sem_duplicidade  ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
-- DROP FUNCTION IF EXISTS public.solicitacao_bloqueia_duplicada();
-- DROP FUNCTION IF EXISTS public.solicitacao_em_aberto(text, bigint);
-- NOTIFY pgrst, 'reload schema';
