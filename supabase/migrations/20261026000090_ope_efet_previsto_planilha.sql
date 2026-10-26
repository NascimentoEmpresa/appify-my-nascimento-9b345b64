-- =========================================================================
-- OPERACIONAL › EFETIVIDADE — o PREVISTO da Planilha de Custo, igual ao
-- RH › Ativos/Contratos (26/10/2026)
--
-- PEDIDO (Pablo, com prints): "o previsto do UFRGS - LIMPEZA GERAL aqui tá
-- 312, mas no Ativos/Contratos tá 303, TODOS VALORES TÊM QUE BATER".
--
-- Não era o mesmo número com conta errada — eram duas coisas com o mesmo
-- nome: o "Previstos" da Situação Geral dos Contratos é quem a ESCALA
-- esperava no dia (presentes + faltas + atestados; 312 numa segunda é o
-- "Tem" do Ativos/Contratos), e o previsto do Ativos/Contratos é a soma das
-- VAGAS da Planilha de Custo (303). A tela passa a mostrar os dois, com
-- nomes próprios: "Previsto" (este, da planilha) e "Escalados hoje".
--
-- ope_efet_previsto_planilha(): o previsto da planilha por contrato, na
-- chave da efetividade (Empresa + Filial da Senior). A conta é a do
-- rh_ac_painel (mig 20261020000090) + a da tela (conferenciaAtivos.ts):
-- planilha EXECUTADA, não encerrada, vigente hoje, um posto por nome, sem
-- RENDA TÉCNICA. A filial vai para o contrato do ERP de quem trabalha nela
-- (rh_ac_ativos: depara da filial → nome → local) — o mais comum; e cada
-- contrato entra numa filial só (a de mais gente), para não somar duas vezes.
-- Só leitura; mesmo acesso da Efetividade (ope_efet_exige).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.ope_efet_previsto_planilha()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.ope_efet_exige('visualizar');

  WITH pessoas AS MATERIALIZED (
    SELECT e."Empresa" AS empresa, e."Filial" AS filial, a.contrato_id
      FROM public.rh_ac_ativos() a
      JOIN public."EMPREGADOS" e ON e."ID" = a.empregado_id
     WHERE a.contrato_id IS NOT NULL AND e."Empresa" IS NOT NULL AND e."Filial" IS NOT NULL
  ),
  liga AS (   -- quantos de cada filial caem em cada contrato
    SELECT empresa, filial, contrato_id, count(*) AS n FROM pessoas GROUP BY 1, 2, 3
  ),
  por_filial AS (   -- o contrato da filial: o de mais gente
    SELECT DISTINCT ON (empresa, filial) empresa, filial, contrato_id, n
      FROM liga ORDER BY empresa, filial, n DESC, contrato_id
  ),
  uma_vez AS (   -- o contrato fica só na filial em que tem mais gente
    SELECT DISTINCT ON (contrato_id) empresa, filial, contrato_id
      FROM por_filial ORDER BY contrato_id, n DESC, empresa, filial
  ),
  pv AS (
    SELECT x.contrato_id, sum(x.vagas) AS previsto
      FROM (
        SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto))
               pc.contrato_id, COALESCE(pc.qt_postos, 0) AS vagas,
               public.sup_norm_nome(pc.posto) = 'RENDATECNICA' AS rt
          FROM public.planilha_custo pc
         WHERE pc.contrato_id IS NOT NULL
           AND pc.orexec = 'EXECUTADO'
           AND NOT COALESCE(pc.encerrado, false)
           AND pc.data_vigencia IS NOT NULL
           AND pc.data_vigencia <= current_date
           AND COALESCE(btrim(pc.posto), '') <> ''
         ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), pc.data_vigencia DESC
      ) x
     WHERE NOT x.rt
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'empresa', u.empresa, 'filial', u.filial, 'contrato_id', u.contrato_id,
           'contrato', c.nome, 'previsto', pv.previsto)), '[]'::jsonb)
    INTO v_out
    FROM uma_vez u
    JOIN pv ON pv.contrato_id = u.contrato_id
    JOIN public.contratos c ON c.id = u.contrato_id;

  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_efet_previsto_planilha() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_previsto_planilha() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.ope_efet_previsto_planilha();
