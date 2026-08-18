import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusDespesa } from "@/hooks/useMaloteDespesa";

// SIS-2026-0168: "Utilizado" do Orçamento Geral / Detalhe Orçamento vem dos
// lançamentos reais do Malote com status Aguardando Pagamento ou Despesa
// Paga (regra do Anexo 1) — não mais do valor Executado da Planilha de
// Custo. Lê direto de v_malote_utilizado_orcamento (20260908000001), que já
// resolve os nomes de empresa/contrato/classificação — sem join no client.
export interface UtilizadoOrcamentoLinha {
  despesa_id: string;
  id_malote: string;
  descricao: string;
  status: StatusDespesa;
  competencia: string | null;
  data_pagamento: string | null;
  forma_pagamento: string | null;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  valor: number;
}

export function useUtilizadoOrcamento() {
  return useQuery({
    queryKey: ["utilizado_orcamento"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_malote_utilizado_orcamento")
        .select("*")
        .order("data_pagamento", { ascending: false });
      if (error) throw error;
      return (data ?? []) as UtilizadoOrcamentoLinha[];
    },
  });
}
