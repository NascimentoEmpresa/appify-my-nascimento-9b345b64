-- =========================================================================
-- TVs gerenciais — RPCs de entrada VOLATILE (14/10/2026)
--
-- Pablo, com o print da TV Presidência em Indicadores gerenciais:
-- "cannot execute CREATE TABLE in a read-only transaction".
--
-- O espelho do Relatório Geral (tvg_espelho_geral, mig 20261014000036) lê
-- os relatórios de solicitações via dir_rel_dados → dir_rel_montar, que
-- monta CREATE TEMP TABLE _dir_base2. O PostgREST abre a transação como
-- READ ONLY quando a função chamada é STABLE — e tvg_painel / tvg_indicador /
-- tvg_ia_detalhe / tvg_fonte eram STABLE. Rodando a mão (SQL Editor) passa;
-- pelo app quebra. Afeta toda TV que espelha relatório de solicitação
-- (Presidência; Jurídico via rel:orientacoes).
--
-- Só as portas de entrada mudam: com elas VOLATILE a transação é de escrita,
-- e as internas STABLE podem continuar chamando dir_rel_dados (VOLATILE).
-- Nada é gravado em tabela real — o temp table é da sessão.
-- =========================================================================

ALTER FUNCTION public.tvg_painel(text) VOLATILE;
ALTER FUNCTION public.tvg_indicador(text) VOLATILE;
ALTER FUNCTION public.tvg_ia_detalhe(text) VOLATILE;
ALTER FUNCTION public.tvg_fonte(text) VOLATILE;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER FUNCTION public.tvg_painel(text) STABLE;
-- ALTER FUNCTION public.tvg_indicador(text) STABLE;
-- ALTER FUNCTION public.tvg_ia_detalhe(text) STABLE;
-- ALTER FUNCTION public.tvg_fonte(text) STABLE;
-- NOTIFY pgrst, 'reload schema';
