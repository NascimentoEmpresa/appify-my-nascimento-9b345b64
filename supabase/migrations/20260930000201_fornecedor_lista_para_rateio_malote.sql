-- SIS-2026-0480 — Fornecedor no Rateio: dropdown vazio para quem lança
-- ---------------------------------------------------------------------------
-- Achado a partir do chamado do Dickson (Operacional): ele não conseguia
-- concluir a aprovação de diária porque o combobox de Fornecedor no Rateio
-- vinha SEM NENHUMA OPÇÃO, e desde o SIS-2026-0467 o campo é obrigatório.
--
-- Causa: a RLS de public.fornecedor (forn_select, definida em
-- 20260718100004_fase3_suprimentos.sql) exige
--   can_access(auth.uid(), 'fornecedores', 'visualizar')
-- que é o menu do CADASTRO de fornecedores, em /app/suprimentos/fornecedores.
-- Quem só lança despesa no Malote (ou aprova diária) não tem esse menu — e RLS
-- negada devolve ZERO LINHAS, não erro. O combobox fica vazio, sem sintoma
-- nenhum na tela além de não haver o que escolher.
--
-- Tamanho do problema, medido em produção em 22/09/2026:
--   * 404 fornecedores cadastrados;
--   * 24 usuários enxergam o menu 'fornecedores';
--   * 27 dos 44 usuários com 'malote_criar_despesa' NÃO enxergam;
--   * dos que de fato lançaram despesa nos últimos 30 dias, 13 de 23 não
--     enxergam — e esses 13 já lançaram 227 despesas;
--   * 10 dos 15 usuários com 'operacional_diarias' não enxergam.
--
-- Correção: a lista usada pelo combobox do Rateio deixa de ser um SELECT
-- direto na tabela (barrado pela RLS do cadastro) e passa por esta função
-- SECURITY DEFINER, que devolve apenas o que o combobox precisa — id, nome e
-- CNPJ/CPF — para quem usa alguma tela que de fato renderiza o Rateio.
-- O cadastro em si (endereço, contas bancárias, e-mails, PIX, sócios) segue
-- protegido pela RLS de sempre: esta função não é uma porta para a tabela.
--
-- Ela NÃO é a correção do bloqueio da diária em si — esse é o
-- exigirFornecedorNoRateio={false} no frontend, já que diária não tem
-- fornecedor. Esta migration conserta o dropdown vazio, que é o problema
-- maior por trás e atinge o Malote inteiro.

CREATE OR REPLACE FUNCTION public.malote_fornecedores_para_rateio()
RETURNS TABLE (
  id            uuid,
  razao_social  text,
  nome_fantasia text,
  cnpj_cpf      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.id, f.razao_social, f.nome_fantasia, f.cnpj_cpf
    FROM public.fornecedor f
   WHERE EXISTS (
           -- Qualquer tela que renderiza o RateioGrid. Lista explícita e não
           -- um LIKE 'malote_%' de propósito: menu novo do Malote não deve
           -- ganhar acesso à lista de fornecedores sem alguém decidir isso.
           SELECT 1
             FROM unnest(ARRAY[
               'fornecedores',                 -- quem já vê o cadastro
               'malote_criar_despesa',
               'malote_ratear_classificacao',
               'malote_despesa_visualizar',
               'malote_solicitacao_visualizar',
               'malote_aprovacoes',
               'malote_meus_itens',
               'malote_pagamento',
               'diretoria_malote_aprovacoes',
               'diretoria_malote_despesa',
               'diretoria_malote_solicitacao',
               'operacional_diarias',          -- SIS-2026-0480
               'financeiro_diarias',
               'encarregados_diarias'
             ]) AS m(codigo)
            WHERE public.can_access(auth.uid(), m.codigo, 'visualizar'::public.app_acao)
         )
   ORDER BY f.razao_social;
$$;

-- Sem filtro por `ativo`: é exatamente o conjunto que o combobox já mostrava
-- para quem tinha acesso (useFornecedoresAtivos nunca filtrou). Filtrar aqui
-- faria sumir do Rateio o fornecedor de uma despesa antiga que foi desativada
-- depois — a linha ficaria com um id sem rótulo.

REVOKE ALL ON FUNCTION public.malote_fornecedores_para_rateio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_fornecedores_para_rateio() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.malote_fornecedores_para_rateio();
-- NOTIFY pgrst, 'reload schema';
