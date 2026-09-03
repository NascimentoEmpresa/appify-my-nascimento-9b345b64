-- =====================================================================
-- TREINAMENTOS: cada módulo tem a sua grade.
--
-- Decisão de 04/09/2026, corrigindo o que a 20260930000054 deixou: lá as
-- duas portas (Encarregados e Central de Serviços) mostravam A MESMA lista.
-- O que se quer é o mesmo SISTEMA com CONTEÚDOS diferentes — treinamento de
-- encarregado não é treinamento de escritório — mas com a opção de colocar
-- um treinamento já existente também no outro módulo.
--
-- POR QUE `text[]` E NÃO UMA COLUNA `modulo` ÚNICA: porque "adicionar no
-- módulo Encarregados um treinamento da Central de Serviços, e vice-versa"
-- é, por definição, um treinamento em DOIS lugares ao mesmo tempo. Uma
-- coluna só obrigaria a duplicar a linha — e duas linhas para o mesmo vídeo
-- significam duas provas, dois históricos de conclusão e a certeza de que
-- uma das duas vai ficar desatualizada.
--
-- POR QUE ARRAY E NÃO TABELA DE LIGAÇÃO: são dois valores possíveis, sem
-- atributo nenhum na relação (não existe "está neste módulo DESDE tal
-- data"). Uma tabela de ligação aqui custaria join, RLS própria e duas
-- escritas onde cabe um UPDATE — o mesmo raciocínio que já levou os
-- formulários de 6 tabelas para 3.
--
-- O BACKFILL É O PONTO DELICADO: tudo que existe hoje nasceu na única porta
-- que havia, a dos Encarregados, e é lá que tem que continuar. Por isso o
-- DEFAULT e o UPDATE são `{encarregados}` — a Central de Serviços começa
-- VAZIA, de propósito, esperando os treinamentos próprios dela.
--
-- Idempotente.
-- =====================================================================

-- 1) A coluna ------------------------------------------------------------
ALTER TABLE public."TREINAMENTOS"
  ADD COLUMN IF NOT EXISTS escopos text[] NOT NULL DEFAULT ARRAY['encarregados']::text[];

-- Linhas anteriores à coluna (e qualquer uma que tenha ficado vazia) são dos
-- Encarregados: era a única porta que existia quando foram criadas.
UPDATE public."TREINAMENTOS"
   SET escopos = ARRAY['encarregados']::text[]
 WHERE escopos IS NULL OR cardinality(escopos) = 0;

-- Pelo menos um módulo, e só os que existem. Sem isto, um escopo digitado
-- errado ('central-servicos', com hífen) sumiria o treinamento das duas
-- grades sem erro nenhum.
ALTER TABLE public."TREINAMENTOS" DROP CONSTRAINT IF EXISTS trn_escopos_validos;
ALTER TABLE public."TREINAMENTOS" ADD CONSTRAINT trn_escopos_validos CHECK (
  cardinality(escopos) > 0
  AND escopos <@ ARRAY['encarregados', 'central_servicos']::text[]
);

-- 2) Quem vê o quê -------------------------------------------------------
/**
 * Verdadeiro se a pessoa alcança PELO MENOS UM dos módulos do treinamento.
 *
 * É o par exato: `encarregados` responde ao menu `treinamentos_erp`,
 * `central_servicos` ao `central_servicos_treinamentos`. Quem tem os dois vê
 * os dois; quem tem um vê só a grade dele — e um treinamento marcado nos
 * dois módulos aparece para os dois, que é o compartilhamento pedido.
 */
CREATE OR REPLACE FUNCTION public.trn_pode_ver_escopos(_escopos text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT ('encarregados' = ANY(_escopos)
          AND public.can_access(auth.uid(), 'treinamentos_erp', 'visualizar'::public.app_acao))
      OR ('central_servicos' = ANY(_escopos)
          AND public.can_access(auth.uid(), 'central_servicos_treinamentos', 'visualizar'::public.app_acao));
$$;
REVOKE ALL ON FUNCTION public.trn_pode_ver_escopos(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_pode_ver_escopos(text[]) TO authenticated;

-- A leitura da tabela passa a respeitar o módulo. O resto da regra fica como
-- estava: não publicado só aparece para quem gerencia.
DROP POLICY IF EXISTS trn_select ON public."TREINAMENTOS";
CREATE POLICY trn_select ON public."TREINAMENTOS" FOR SELECT TO authenticated
  USING (public.trn_pode_ver_escopos(escopos) AND (publicado OR public.trn_pode_gerenciar()));

-- `trn_pode_ver()` FICA como está e continua sendo o gate do bucket
-- `treinamentos` (policy `trn_stg_read`): ela responde "esta pessoa alcança
-- treinamento em ALGUM módulo?". O recorte fino é o da tabela, acima —
-- objeto no storage não sabe de qual treinamento é sem refazer o caminho
-- inteiro dentro da policy, e o que protege a lista é não conseguir LISTAR
-- o que é do outro módulo. Quem não vê a linha não descobre o caminho.

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP POLICY IF EXISTS trn_select ON public."TREINAMENTOS";
-- CREATE POLICY trn_select ON public."TREINAMENTOS" FOR SELECT TO authenticated
--   USING (public.trn_pode_ver() AND (publicado OR public.trn_pode_gerenciar()));
-- DROP FUNCTION IF EXISTS public.trn_pode_ver_escopos(text[]);
-- ALTER TABLE public."TREINAMENTOS" DROP CONSTRAINT IF EXISTS trn_escopos_validos;
-- ALTER TABLE public."TREINAMENTOS" DROP COLUMN IF EXISTS escopos;
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
