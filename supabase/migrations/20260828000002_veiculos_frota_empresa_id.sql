-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — a reserva pertence à empresa DO VEÍCULO
--
-- A 20260828000001 deixou duas escopagens diferentes no mesmo módulo: a
-- frota vinha por `user_empresa` (todas as empresas do usuário) e os
-- contratos vinham pela empresa ATIVA da tela. Na prática a frota do grupo
-- está concentrada num CNPJ só e é dirigida por gente dos outros — então
-- quem está na AGPS via os 15 carros e nenhum contrato.
--
-- Aqui o critério passa a ser um só: `user_empresa` para ler, e a reserva
-- é arquivada na empresa DONA DO VEÍCULO (não na empresa ativa da tela) —
-- senão o carro seria de um CNPJ e a reserva dele de outro.
--
-- Só acrescenta uma coluna ao retorno da RPC; nada em sup_patrimonio muda.
-- =====================================================================

DROP FUNCTION IF EXISTS public.cs_veiculos_frota();

CREATE OR REPLACE FUNCTION public.cs_veiculos_frota()
RETURNS TABLE (
  id                     uuid,
  empresa_id             uuid,
  nome                   text,
  identificador          text,
  lotacao                text,
  contrato_nome          text,
  em_manutencao          boolean,
  data_inicio_manutencao date,
  data_previsao_fim      date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.empresa_id, p.nome, p.identificador, p.lotacao, c.nome,
         p.em_manutencao, p.data_inicio_manutencao, p.data_previsao_fim
    FROM public.sup_patrimonio p
    LEFT JOIN public.contratos c ON c.id = p.contrato_id
   WHERE p.categoria = 'veiculo'
     AND p.ativo
     AND public.tem_acesso_menu('central_servicos_veiculos')
     AND p.empresa_id IN (
       SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
     )
   ORDER BY p.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_frota() TO authenticated;

NOTIFY pgrst, 'reload schema';
