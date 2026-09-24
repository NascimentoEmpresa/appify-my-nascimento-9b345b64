import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0524: submódulo "Controle de Juros" (Financeiro) — lista toda
// despesa/parcela do Malote paga com juros por atraso (informado no modal
// de Confirmar Pagamento, ver useMaloteDespesa.ts) e permite marcar como
// cobrado do responsável. Não gera lançamento no Fluxo de Caixa (decisão
// confirmada) — é só controle interno de cobrança.

export type StatusCobrancaJuros = "pendente_cobrar" | "cobrado";

export interface ControleJurosLinha {
  despesa_id: string;
  parcela_id: string | null;
  numero: string;
  data_pagamento: string | null;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  nome_despesa: string;
  valor_juros: number;
  solicitante_id: string | null;
  solicitante_nome: string | null;
  juros_status: StatusCobrancaJuros;
  juros_cobrado_em: string | null;
  numero_parcela: number | null;
  numero_parcelas: number | null;
}

const LISTA_KEY = "controle_juros_malote";

export function useControleJurosLista() {
  return useQuery({
    queryKey: [LISTA_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_controle_juros_malote")
        .select("*")
        .order("data_pagamento", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ControleJurosLinha[];
    },
  });
}

export function useMarcarJurosCobrado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ origem, id }: { origem: "despesa" | "parcela"; id: string }) => {
      const { error } = await (supabase as any).rpc("malote_juros_marcar_cobrado", { _origem: origem, _id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LISTA_KEY] }),
  });
}
