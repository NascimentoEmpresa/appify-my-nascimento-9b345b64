-- =========================================================================
-- Catálogo de Suprimentos: leitura de posto/função para quem abre vaga
--
-- Pedido do Pablo em 15/09/2026: o vínculo com o catálogo (contrato →
-- posto → função) passa a aparecer em TODO formulário de vaga, opcional,
-- com o contrato travado. O do encarregado (Minhas Solicitações) e o da
-- Central › Solicitações não tinham o bloco — e as policies de leitura de
-- sup_posto/sup_funcao só deixavam ver quem tinha sup_catalogo,
-- central_servicos_solicitar_vaga ou recrutamento_gestao. Sem este OR, os
-- selects chegam vazios pra eles.
--
-- Só LEITURA. A escrita do catálogo (sup_*_write) continua exigindo
-- 'sup_catalogo' + 'alterar'. ⚠️ Tabelas de outro módulo (Suprimentos).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

DROP POLICY IF EXISTS sup_posto_select ON public.sup_posto;
CREATE POLICY sup_posto_select ON public.sup_posto FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
    OR public.can_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar')
    OR public.can_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar')
    OR public.can_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar')
    OR public.can_access(auth.uid(), 'encarregados_solicitar_demissao', 'visualizar')
    OR public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
  );

DROP POLICY IF EXISTS sup_funcao_select ON public.sup_funcao;
CREATE POLICY sup_funcao_select ON public.sup_funcao FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
    OR public.can_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar')
    OR public.can_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar')
    OR public.can_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar')
    OR public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
  );

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Recriar as duas policies sem os OR de central_servicos_solicitacoes /
-- encarregados_* (texto na 20260930000049) e NOTIFY pgrst, 'reload schema';
