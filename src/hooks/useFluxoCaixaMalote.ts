import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0160: início do Fluxo de Caixa (Financeiro > Gestão Financeira).
// Lê direto de v_malote_pagamento_fluxo_caixa (20260907000002), que já
// resolve os nomes de empresa/contrato/classificação — sem join no
// client. Só despesas do Malote com status despesa_paga aparecem aqui
// (a view garante isso); se a despesa for estornada/cancelada depois de
// paga, a linha some sozinha, sem precisar de lógica extra aqui.
export interface FluxoCaixaMaloteLinha {
  despesa_id: string;
  id_malote: string;
  data_pagamento: string | null;
  competencia: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  descricao: string;
  forma_pagamento: string | null;
  valor: number;
  tipo: "saida";
}

export function useFluxoCaixaMalote() {
  return useQuery({
    queryKey: ["fluxo_caixa_malote"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_malote_pagamento_fluxo_caixa")
        .select("*")
        .order("data_pagamento", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FluxoCaixaMaloteLinha[];
    },
  });
}
