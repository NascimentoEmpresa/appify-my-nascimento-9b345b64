-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — contrato encerrado continua agendável
--
-- POR QUE
-- A 20260812000002 trouxe os contratos do grupo inteiro, mas manteve o filtro
-- `status = 'ativo'` que já existia. Na prática a frota continua rodando para
-- contrato encerrado: viagem de encerramento, retirada de material, acerto de
-- pendência, visita pós-contrato. Sem ele na lista, a pessoa marcava a viagem
-- em um contrato errado só para conseguir fechar a reserva — e o dado de
-- "quanto a frota rodou para cada contrato" saía torto.
--
-- O QUE MUDA
-- A RPC passa a devolver TODOS os contratos e a informar o `status`, para a
-- tela poder marcar quem está encerrado. Ativos primeiro; encerrados no fim,
-- porque a viagem do dia a dia é de contrato ativo — mas escolher um encerrado
-- deixa de ser impossível.
--
-- Idempotente. Substitui a função da 20260812000002.
-- =====================================================================

DROP FUNCTION IF EXISTS public.cs_veiculos_contratos();

CREATE OR REPLACE FUNCTION public.cs_veiculos_contratos()
RETURNS TABLE (
  id             uuid,
  nome           text,
  cliente        text,
  empresa_codigo text,
  status         text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.nome, c.cliente, e.codigo, c.status
    FROM public.contratos c
    LEFT JOIN public.empresas e ON e.id = c.empresa_id
   -- O menu é o gate, igual à cs_veiculos_frota(). Sem ele, nada volta.
   WHERE public.tem_acesso_menu('central_servicos_veiculos')
   ORDER BY (c.status = 'ativo') DESC, c.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_contratos() TO authenticated;

COMMENT ON FUNCTION public.cs_veiculos_contratos() IS
  'Contratos do grupo (ativos e encerrados) para o passo 3 do agendamento de veiculos. Gate = menu central_servicos_veiculos; nao afrouxa a RLS de contratos.';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT COALESCE(status, '(sem status)') AS status, count(*) AS contratos
  FROM public.contratos
 GROUP BY 1
 ORDER BY 2 DESC;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK: reaplicar a função da 20260812000002 (só contratos ativos).
-- =====================================================================
