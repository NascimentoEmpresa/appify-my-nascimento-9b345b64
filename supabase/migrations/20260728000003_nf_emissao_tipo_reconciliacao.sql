-- Colunas identificadas comparando com o Relatório de Serviços oficial
-- (S:\Gestão Financeira\Faturamento contratos\Relatório de Serviços 2026):
--
-- tipo_nota: classificação da nota, definida pelo analista na emissão.
-- Confirmado com o Ruan: "N" normal, "R" repactuação, "M" materiais,
-- "DH" diárias e horas extras.
--
-- As outras 6 são preenchidas DEPOIS, pelo Financeiro, na reconciliação de
-- pagamento (mesma tela onde já registra valor_pago/data_pagamento) —
-- confirmado pela taxa de preenchimento real no relatório (Falta receber e
-- Pago a mais aparecem em >3000 das ~5460 linhas, claramente um controle
-- ativo; Situação site P.M.T./Situa Domínio em ~1067 linhas).
ALTER TABLE public.nf_emissao
  ADD COLUMN tipo_nota text NOT NULL DEFAULT 'N' CHECK (tipo_nota IN ('N', 'R', 'M', 'DH')),
  ADD COLUMN situacao_site_pmt text,
  ADD COLUMN situacao_dominio text,
  ADD COLUMN desconto_conta_vinculada numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN recebimento_extra numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN falta_receber numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN pago_a_mais numeric(14,2) NOT NULL DEFAULT 0;

-- A trava de imutabilidade de NF concluída já tinha uma exceção pra
-- data_pagamento/valor_pago (mesma tela do Ruan) — estende a mesma exceção
-- pros 6 campos novos de reconciliação, senão ele não consegue mais salvar
-- nada nessa tela depois que a nota é concluída.
CREATE OR REPLACE FUNCTION public.nf_emissao_guard_enviada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status public.nf_emissao_status;
  v_only_pagamento boolean := false;
  v_campos_livres text[] := ARRAY[
    'data_pagamento', 'valor_pago',
    'situacao_site_pmt', 'situacao_dominio',
    'desconto_conta_vinculada', 'recebimento_extra', 'falta_receber', 'pago_a_mais',
    'updated_at'
  ];
BEGIN
  v_old_status := OLD.status;

  IF TG_OP = 'UPDATE' AND v_old_status = 'concluida' THEN
    v_only_pagamento := (to_jsonb(OLD) - v_campos_livres) = (to_jsonb(NEW) - v_campos_livres);
  END IF;

  IF v_old_status IN ('concluida', 'cancelada') AND NOT v_only_pagamento AND NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Esta NF já foi % pelo Financeiro e não pode mais ser alterada.', v_old_status;
  END IF;

  IF v_old_status = 'enviada' AND NOT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria')) THEN
    RAISE EXCEPTION 'Esta NF já foi enviada para o Financeiro e não pode mais ser alterada. Qualquer correção deve ser feita diretamente com o setor.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
