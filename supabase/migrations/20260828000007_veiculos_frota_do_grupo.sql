-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — a frota é do grupo, não de um CNPJ
--
-- POR QUE MUDA
--   O módulo nasceu com escopo por empresa (`user_empresa`), por consistência
--   com o resto do ERP. Só que os 15 veículos estão TODOS na HAGG, e as demais
--   empresas do grupo têm zero. Na prática esse filtro dizia "só quem é da
--   HAGG agenda carro" — o que contradiz o módulo viver na Central de
--   Serviços, aberta a todo colaborador. Quem está na SN dirige o mesmo carro.
--
--   Passa a valer: quem tem o menu vê a frota inteira do grupo. O menu é o
--   gate; a empresa deixa de ser.
--
-- OS QUATRO LUGARES, E POR QUE TÊM DE MUDAR JUNTOS
--   1. RPC da frota   → senão o carro nem aparece.
--   2. SELECT da agenda → senão ele veria o carro mas não as reservas em cima
--      dele, e marcaria por cima de alguém achando que estava livre.
--   3. INSERT da agenda → a reserva é arquivada na empresa DONA do veículo
--      (20260828000002). Para quem é da SN reservando um carro da HAGG, o
--      WITH CHECK antigo recusaria a própria reserva que a tela mandou.
--   4. (nada muda em sup_patrimonio — segue somente lido.)
--
-- O que continua trancado: só o dono cancela a própria reserva, e mexer em
-- reserva alheia segue sendo de quem administra Suprimentos › Patrimônio.
--
-- ROLLBACK: reaplicar as policies da 20260828000003 e a RPC da 20260828000004.
-- =====================================================================

-- ── 1. A RPC devolve a frota do grupo ────────────────────────────────
DROP FUNCTION IF EXISTS public.cs_veiculos_frota();

CREATE OR REPLACE FUNCTION public.cs_veiculos_frota()
RETURNS TABLE (
  id                     uuid,
  empresa_id             uuid,
  nome                   text,
  identificador          text,
  lotacao                text,
  contrato_nome          text,
  foto_path              text,
  em_manutencao          boolean,
  data_inicio_manutencao date,
  data_previsao_fim      date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.empresa_id, p.nome, p.identificador, p.lotacao, c.nome,
         p.foto_path,
         p.em_manutencao, p.data_inicio_manutencao, p.data_previsao_fim
    FROM public.sup_patrimonio p
    LEFT JOIN public.contratos c ON c.id = p.contrato_id
   WHERE p.categoria = 'veiculo'
     AND p.ativo
     -- Único gate. `empresa_id` continua vindo no retorno porque a reserva é
     -- arquivada na empresa dona do carro — só não filtra mais por ela.
     AND public.tem_acesso_menu('central_servicos_veiculos')
   ORDER BY p.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_frota() TO authenticated;

-- ── 2. A agenda acompanha a frota ────────────────────────────────────
DROP POLICY IF EXISTS cs_veic_agend_select ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_select ON public.cs_veiculo_agendamento
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_veiculos'));

-- ── 3. Reservar carro de outro CNPJ do grupo é permitido ─────────────
DROP POLICY IF EXISTS cs_veic_agend_insert ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_insert ON public.cs_veiculo_agendamento
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_menu('central_servicos_veiculos', 'incluir')
    AND solicitante_id = auth.uid()   -- ninguém reserva em nome de outro
    AND status = 'confirmado'
  );

-- ── 4. Conferência ───────────────────────────────────────────────────
SELECT count(*) AS veiculos_visiveis_sem_filtro_de_empresa
  FROM public.sup_patrimonio
 WHERE categoria = 'veiculo' AND ativo;

NOTIFY pgrst, 'reload schema';
