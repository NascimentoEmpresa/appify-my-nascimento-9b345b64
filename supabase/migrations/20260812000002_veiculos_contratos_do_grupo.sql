-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — os contratos também são do grupo, não de um CNPJ
--
-- POR QUE
-- A 20260828000007 já tinha decidido isto para a FROTA: quem tem o menu
-- enxerga a frota inteira do grupo, porque o carro é do grupo e o módulo vive
-- na Central de Serviços, aberta a todo colaborador. O passo 3 do agendamento
-- ("contratos atendidos pela viagem") ficou de fora daquela migration e
-- continuou preso à RLS de `contratos`, que recorta por `user_empresa`.
--
-- Na prática: quem está na SN só via os 10 contratos da SN, e não conseguia
-- marcar a viagem que atende os 38 da HAGG — sendo que é o mesmo carro, na
-- mesma viagem. O passo exige pelo menos um contrato, então a reserva
-- simplesmente não fechava.
--
-- O QUE NÃO MUDA (de propósito)
-- A RLS de `contratos` fica exatamente como está. Afrouxá-la abriria a
-- carteira de contratos do grupo para Licitações, Financeiro, Controladoria e
-- todo o resto que lê essa tabela — muito além do que este ajuste pede. Em vez
-- disso, uma RPC SECURITY DEFINER devolve só o necessário (id, nome, cliente e
-- o código do CNPJ), e só para quem já tem o menu do agendamento.
--
-- Idempotente.
-- =====================================================================

DROP FUNCTION IF EXISTS public.cs_veiculos_contratos();

CREATE OR REPLACE FUNCTION public.cs_veiculos_contratos()
RETURNS TABLE (
  id             uuid,
  nome           text,
  cliente        text,
  empresa_codigo text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.nome, c.cliente, e.codigo
    FROM public.contratos c
    LEFT JOIN public.empresas e ON e.id = c.empresa_id
   WHERE c.status = 'ativo'
     -- O menu é o gate, igual à cs_veiculos_frota(). Sem ele, nada volta.
     AND public.tem_acesso_menu('central_servicos_veiculos')
   ORDER BY c.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_contratos() TO authenticated;

COMMENT ON FUNCTION public.cs_veiculos_contratos() IS
  'Contratos ativos do grupo inteiro para o passo 3 do agendamento de veiculos. Gate = menu central_servicos_veiculos; nao afrouxa a RLS de contratos.';

-- ── Conferência ──────────────────────────────────────────────────────
-- Quantos contratos ativos existem por CNPJ (o passo 3 passa a ver todos).
SELECT COALESCE(e.codigo, '(sem empresa)') AS empresa,
       count(*)                            AS contratos_ativos
  FROM public.contratos c
  LEFT JOIN public.empresas e ON e.id = c.empresa_id
 WHERE c.status = 'ativo'
 GROUP BY 1
 ORDER BY 2 DESC;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.cs_veiculos_contratos();
--   -- e reverter useContratosParaAgendamento para o .from("contratos")
-- =====================================================================
