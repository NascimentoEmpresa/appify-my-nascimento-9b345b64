-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — passo 3 passa a ler a tabela "CONTRATOS"
--
-- POR QUE
-- O passo lia `public.contratos` (minúscula), que é o cadastro do módulo de
-- Licitações/Financeiro. A lista que a operação usa para dizer "esta viagem
-- atendeu tal contrato" é a "CONTRATOS" (maiúscula) — a base oficial, com o
-- campo ATIVO (SIM/NÃO) que o pessoal já conhece.
--
-- O QUE MUDA
--   1. A RPC lê "CONTRATOS" e recebe `p_incluir_inativos`. Por padrão volta
--      só ATIVO='SIM' (58); marcando a flag na tela, vêm também os 141
--      inativos — contrato encerrado ainda recebe visita.
--   2. `contrato_codigo` no vínculo, porque o id de "CONTRATOS" é bigint e a
--      coluna antiga (`contrato_id`) é uuid apontando para a outra tabela.
--      Os 233 vínculos já gravados continuam como estão: o `contrato_nome`,
--      que é NOT NULL, preserva o histórico legível de todos eles.
--
-- POR QUE NÃO TEM FOREIGN KEY
-- "CONTRATOS" é tabela de carga (colunas "NOME EMPRESA", "Razão Social") e o
-- id nem chave única tem. Criar FK aqui faria a próxima reimportação falhar
-- por causa das reservas de veículo — o custo cai justamente em quem não tem
-- nada a ver com o problema. Guardamos código + nome; a RPC é a fonte da
-- lista, e o nome é o que sobrevive a qualquer recarga.
--
-- Idempotente.
-- =====================================================================

-- ── 1. O vínculo guarda o código da "CONTRATOS" ──────────────────────
ALTER TABLE public.cs_veiculo_agendamento_contrato
  ADD COLUMN IF NOT EXISTS contrato_codigo bigint;

COMMENT ON COLUMN public.cs_veiculo_agendamento_contrato.contrato_codigo IS
  'id da tabela "CONTRATOS" (maiuscula). NULL = vinculo antigo (ver contrato_id) ou viagem ADMINISTRATIVA.';
COMMENT ON COLUMN public.cs_veiculo_agendamento_contrato.contrato_id IS
  'LEGADO: uuid de public.contratos, usado ate 08/2026. Vinculos novos gravam contrato_codigo.';

-- Marca a viagem que não atende contrato nenhum (tarefa administrativa).
-- Sem esta coluna, "administrativo" e "vínculo antigo" seriam os dois um
-- código nulo, e não daria para separar um do outro no relatório.
ALTER TABLE public.cs_veiculo_agendamento_contrato
  ADD COLUMN IF NOT EXISTS administrativo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cs_veiculo_agendamento_contrato.administrativo IS
  'true = viagem administrativa, sem contrato especifico. contrato_codigo fica NULL.';

-- Mesmo contrato duas vezes na mesma reserva não faz sentido.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cs_veic_agend_contrato_codigo
  ON public.cs_veiculo_agendamento_contrato(agendamento_id, contrato_codigo)
  WHERE contrato_codigo IS NOT NULL;

-- ── 2. A RPC lê "CONTRATOS" ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.cs_veiculos_contratos();
DROP FUNCTION IF EXISTS public.cs_veiculos_contratos(boolean);

CREATE OR REPLACE FUNCTION public.cs_veiculos_contratos(p_incluir_inativos boolean DEFAULT false)
RETURNS TABLE (
  codigo  bigint,
  nome    text,
  empresa text,
  ativo   boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id,
         btrim(c."NOME CONTRATO"),
         NULLIF(btrim(c."NOME EMPRESA"), ''),
         (upper(btrim(COALESCE(c."ATIVO", ''))) = 'SIM')
    FROM public."CONTRATOS" c
   -- O menu é o gate, igual à cs_veiculos_frota(). Sem ele, nada volta.
   WHERE public.tem_acesso_menu('central_servicos_veiculos')
     AND COALESCE(btrim(c."NOME CONTRATO"), '') <> ''
     AND (p_incluir_inativos OR upper(btrim(COALESCE(c."ATIVO", ''))) = 'SIM')
   ORDER BY (upper(btrim(COALESCE(c."ATIVO", ''))) = 'SIM') DESC, btrim(c."NOME CONTRATO");
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_contratos(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_contratos(boolean) TO authenticated;

COMMENT ON FUNCTION public.cs_veiculos_contratos(boolean) IS
  'Contratos da tabela "CONTRATOS" para o passo 3 do agendamento. Padrao = so ATIVO=SIM; p_incluir_inativos traz os demais. Gate = menu central_servicos_veiculos.';

-- ── 3. Conferência ───────────────────────────────────────────────────
SELECT upper(btrim(COALESCE("ATIVO", '(nulo)'))) AS ativo, count(*) AS contratos
  FROM public."CONTRATOS"
 WHERE COALESCE(btrim("NOME CONTRATO"), '') <> ''
 GROUP BY 1 ORDER BY 2 DESC;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.cs_veiculos_contratos(boolean);
--   DROP INDEX IF EXISTS public.uq_cs_veic_agend_contrato_codigo;
--   ALTER TABLE public.cs_veiculo_agendamento_contrato
--     DROP COLUMN IF EXISTS contrato_codigo, DROP COLUMN IF EXISTS administrativo;
--   -- e recriar a cs_veiculos_contratos() da 20260812000003
-- =====================================================================
