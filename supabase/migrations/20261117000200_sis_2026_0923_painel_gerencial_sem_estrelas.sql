-- =====================================================================
-- SIS-2026-0923 — Acompanhamento de Chamados: tira a coluna "estrelas"
--
-- 16/11/2026: a tela abriu em produção com "Não foi possível carregar:
-- column a.estrelas does not exist". A chamado_gerencial_listar() (mig
-- 20261116230000) caía para a.estrelas quando faltavam os critérios, mas essa
-- coluna só existiu na primeira versão da avaliação (20260809000001): a
-- 20260810000001 recriou a tabela sem ela. O plpgsql só confere coluna na
-- execução, então a migration entrou sem erro e a função quebrou na leitura.
--
-- Os seis critérios são NOT NULL desde 20260814000003, então a média
-- ponderada (mesmos pesos de CRITERIOS_AVALIACAO em types.tsx) basta.
-- Assinatura igual: CREATE OR REPLACE sem DROP.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chamado_gerencial_listar()
RETURNS TABLE(
  id uuid, numero text, assunto text, descricao text, prioridade text, status text,
  setor text, solicitante_id uuid, solicitante_nome text,
  responsavel_id uuid, responsavel_nome text, posicao_dev integer,
  modulo_sistema text, modulo_sistema_outro text,
  created_at timestamptz, concluido_em timestamptz, cancelado_em timestamptz,
  conclusao_confirmada_em timestamptz, concluido_sem_retorno boolean, gestao_finalizada_em timestamptz,
  desenvolvimento_iniciado_em timestamptz, prazo_conclusao_em timestamptz, prazo_solicitante date,
  concluido_no_prazo boolean, horas_gastas numeric,
  etapa_validacao text, avaliacao_nota numeric, avaliacao_comentario text,
  acoes_pendentes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.chamado_gerencial_pode_ver() THEN
    RAISE EXCEPTION 'Sem acesso ao Acompanhamento de Chamados.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.numero::text, c.assunto::text, c.descricao::text, c.prioridade::text, c.status::text,
         c.setor::text, c.solicitante_id, COALESCE(ps.display_name, c.solicitante_nome)::text,
         c.responsavel_id, pr.display_name::text, c.posicao_dev::integer,
         c.modulo_sistema::text, c.modulo_sistema_outro::text,
         c.created_at, c.concluido_em, c.cancelado_em,
         c.conclusao_confirmada_em, COALESCE(c.concluido_sem_retorno, false), c.gestao_finalizada_em,
         c.desenvolvimento_iniciado_em, c.prazo_conclusao_em, c.prazo_solicitante::date,
         c.concluido_no_prazo, c.horas_gastas::numeric,
         v.etapa::text,
         CASE WHEN a.id IS NULL THEN NULL
              ELSE round((a.qualidade * 0.30 + a.prazo * 0.20 + a.comunicacao * 0.15
                          + a.clareza * 0.10 + a.facilidade * 0.10 + a.satisfacao * 0.15)::numeric, 2) END,
         a.comentario::text,
         (SELECT count(*)::integer FROM public."CHAMADO_SISTEMA_ACAO_GESTAO" g
           WHERE g.chamado_id = c.id AND g.status = 'pendente')
    FROM public."CHAMADO_SISTEMA" c
    LEFT JOIN public.profiles ps ON ps.id = c.solicitante_id
    LEFT JOIN public.profiles pr ON pr.id = c.responsavel_id
    LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
    LEFT JOIN public."CHAMADO_SISTEMA_AVALIACAO" a ON a.chamado_id = c.id
   ORDER BY c.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_gerencial_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gerencial_listar() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: não há o que voltar — a versão anterior (20261116230000) falha
-- em toda chamada. Para desfazer, reaplique a função daquela migration.
