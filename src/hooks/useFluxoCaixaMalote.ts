import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0160: início do Fluxo de Caixa (Financeiro > Gestão Financeira).
// Lê direto de v_malote_pagamento_fluxo_caixa (20260907000002), que já
// resolve os nomes de empresa/contrato/classificação — sem join no
// client.
//
// SIS-2026-0254 (achado ao implementar "qual parcela está sendo paga"):
// despesa NÃO parcelada continua 1 linha só, quando fica despesa_paga; se
// for estornada/cancelada depois, a linha some sozinha. Despesa PARCELADA
// virou 1 linha por PARCELA PAGA (malote_despesa_parcela.status = 'paga'),
// cada uma com a data/valor reais daquela parcela — antes só aparecia 1x,
// no fim, com o valor cheio da despesa na data da última parcela (distorção
// real de Fluxo de Caixa/Fatura do Mês do cartão, não só falta de coluna).
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
  // SIS-2026-0307: banco usado no pagamento (catálogo malote_cartao_banco,
  // reaproveitado do Cartão de Crédito) — a view já resolve o nome, sem
  // join no client.
  banco_id: string | null;
  banco_nome: string | null;
  banco_logo_path: string | null;
  // SIS-2026-0254: despesa parcelada agora entra 1 linha por PARCELA PAGA
  // (não mais 1 linha só no fim) — os dois vêm null pra despesa não
  // parcelada.
  numero_parcela: number | null;
  numero_parcelas: number | null;
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
