-- =========================================================================
-- PATRIMONIO — por que o bem esta indisponivel (manutencao OU em contrato)
--
-- Pedido do Pablo (17/08/2026): alguns veiculos ficam alocados a um
-- contrato e o escritorio nao pode agenda-los. Isso nao e manutencao, mas
-- o efeito e o mesmo — o carro nao esta disponivel.
--
-- ESCOLHA DE MODELO: `em_manutencao` continua sendo a chave que diz
-- "indisponivel", e a coluna nova diz o MOTIVO. Nao inventei um segundo
-- booleano nem troquei o campo por um enum, e a razao e pratica: o
-- Agendamento de Veiculos ja bloqueia por `em_manutencao`
-- (disponibilidadeDoVeiculo + cs_veiculos_frota). Pendurando o motivo
-- nele, "Em contrato" passa a bloquear o agendamento POR CONSTRUCAO —
-- nao depende de alguem lembrar de somar a nova condicao em cada tela.
--
-- O preco disso e o nome do campo ficar mais estreito do que o
-- significado; por isso o COMMENT abaixo, e por isso as telas de
-- Patrimonio/Manutencoes passam a filtrar por `motivo_indisponivel` em
-- vez de por `em_manutencao` (senao o Painel de Manutencoes listaria
-- carro que so esta em contrato).
--
-- As datas continuam valendo para os dois motivos: contrato tambem tem
-- prazo, e a constraint sup_patrimonio_datas_coerentes (data so existe
-- com em_manutencao) segue de pe sem alteracao.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public.sup_patrimonio DROP CONSTRAINT IF EXISTS sup_patrimonio_motivo_coerente;
--   ALTER TABLE public.sup_patrimonio DROP COLUMN IF EXISTS motivo_indisponivel;
--   (e recriar cs_veiculos_frota sem a coluna — versao anterior na 20260819)
-- =========================================================================

ALTER TABLE public.sup_patrimonio
  ADD COLUMN IF NOT EXISTS motivo_indisponivel text;

COMMENT ON COLUMN public.sup_patrimonio.em_manutencao IS
  'Bem INDISPONIVEL (nao apenas manutencao). O motivo esta em motivo_indisponivel.';
COMMENT ON COLUMN public.sup_patrimonio.motivo_indisponivel IS
  'manutencao | contrato. NULL quando disponivel. "contrato" = alocado a um contrato, o escritorio nao agenda.';

-- Backfill: tudo que ja estava indisponivel era, por definicao, manutencao
-- — ate agora nao havia outro motivo possivel.
UPDATE public.sup_patrimonio
   SET motivo_indisponivel = 'manutencao'
 WHERE em_manutencao AND motivo_indisponivel IS NULL;

-- E o inverso, para o caso de reaplicacao depois de alguem desmarcar.
UPDATE public.sup_patrimonio
   SET motivo_indisponivel = NULL
 WHERE NOT em_manutencao AND motivo_indisponivel IS NOT NULL;

ALTER TABLE public.sup_patrimonio DROP CONSTRAINT IF EXISTS sup_patrimonio_motivo_coerente;
ALTER TABLE public.sup_patrimonio ADD  CONSTRAINT sup_patrimonio_motivo_coerente
  CHECK (
    (em_manutencao AND motivo_indisponivel IN ('manutencao', 'contrato'))
    OR ((NOT em_manutencao) AND motivo_indisponivel IS NULL)
  );

-- A frota que o Agendamento de Veiculos le precisa devolver o motivo, para
-- a tela poder dizer "em contrato" em vez de "em manutencao".
--
-- DROP antes do CREATE: acrescentar coluna ao RETURNS TABLE muda o tipo de
-- retorno, e o CREATE OR REPLACE recusa isso ("cannot change return type of
-- existing function"). Nao ha view/policy dependendo dela, entao o DROP e
-- seguro; o CREATE logo abaixo, na mesma transacao, repoe.
DROP FUNCTION IF EXISTS public.cs_veiculos_frota();
CREATE OR REPLACE FUNCTION public.cs_veiculos_frota()
RETURNS TABLE(
  id uuid, empresa_id uuid, nome text, identificador text, lotacao text,
  contrato_nome text, foto_path text, em_manutencao boolean,
  data_inicio_manutencao date, data_previsao_fim date,
  motivo_indisponivel text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p.id, p.empresa_id, p.nome, p.identificador, p.lotacao, c.nome,
         p.foto_path,
         p.em_manutencao, p.data_inicio_manutencao, p.data_previsao_fim,
         p.motivo_indisponivel
    FROM public.sup_patrimonio p
    LEFT JOIN public.contratos c ON c.id = p.contrato_id
   WHERE p.categoria = 'veiculo'
     AND p.ativo
     -- Único gate. `empresa_id` continua vindo no retorno porque a reserva é
     -- arquivada na empresa dona do carro — só não filtra mais por ela.
     AND public.tem_acesso_menu('central_servicos_veiculos')
   ORDER BY p.nome;
$$;

REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_frota() TO authenticated;

NOTIFY pgrst, 'reload schema';
