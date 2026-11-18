-- SIS-2026-0926 — Reserva Empresa no Fechamento da Empresa (única origem: Fechamento dos Sócios)
-- ============================================================================
-- O Fechamento da Empresa (Resumo Mensal com Sócios) passa a mostrar a coluna "Reserva Empresa (R$)" LENDO o que o Fechamento dos Sócios decide:
--   · competência aberta : o percentual de fechamento_socio_reserva (a conta é a mesma, calcularReserva, na tela);
--   · competência fechada: o valor gravado em fechamento_socio_competencia.reserva_valor.
-- Nada é digitado nem gravado de novo no Fechamento da Empresa: não há tabela nova.
--
-- O que muda aqui é só a LEITURA. Essas duas tabelas só deixavam ler quem tem 'fechamento-socios' (visualizar); quem vê só o Fechamento da Empresa
-- receberia a tabela vazia e a coluna sairia 0,00 em silêncio. A leitura passa a aceitar também 'fechamento-empresa' (visualizar). A ESCRITA não muda
-- (continua em fechamento-socios-percentual / fechamento-socios-fechar). As linhas por sócio (fechamento_socio_competencia_socio) continuam restritas.
-- (SELECT ...) em volta de auth.uid()/has_screen_access (guardião de desempenho). Idempotente. NOTIFY ao final.
--
-- ROLLBACK (volta a leitura só para 'fechamento-socios'):
--   DROP POLICY IF EXISTS fechamento_socio_reserva_select ON public.fechamento_socio_reserva;
--   CREATE POLICY fechamento_socio_reserva_select ON public.fechamento_socio_reserva FOR SELECT TO authenticated
--     USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'visualizar'::public.app_acao)));
--   DROP POLICY IF EXISTS fechamento_socio_competencia_select ON public.fechamento_socio_competencia;
--   CREATE POLICY fechamento_socio_competencia_select ON public.fechamento_socio_competencia FOR SELECT TO authenticated
--     USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'visualizar'::public.app_acao)));
--   NOTIFY pgrst, 'reload schema';
SET lock_timeout = '5s';

DROP POLICY IF EXISTS fechamento_socio_reserva_select ON public.fechamento_socio_reserva;
CREATE POLICY fechamento_socio_reserva_select ON public.fechamento_socio_reserva FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'visualizar'::public.app_acao))
      OR (SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-empresa', 'visualizar'::public.app_acao)));

DROP POLICY IF EXISTS fechamento_socio_competencia_select ON public.fechamento_socio_competencia;
CREATE POLICY fechamento_socio_competencia_select ON public.fechamento_socio_competencia FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'visualizar'::public.app_acao))
      OR (SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-empresa', 'visualizar'::public.app_acao)));

NOTIFY pgrst, 'reload schema';
