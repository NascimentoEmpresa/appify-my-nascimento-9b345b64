import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PontoDiariaMalote, RespostaPontoMalote } from "@/lib/diariaPonto";

// Malote › Aprovações e a despesa: o ponto do faltante nas despesas que vieram
// de diária (mig 20261014000001, SIS-2026-0626). RPC nova, fora dos tipos gerados.
const sb = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

/** despesa_id → diárias ligadas a ela (normalmente uma). Falhou (sem acesso/sem a migration) = vazio: a tela segue igual. */
export function useDiariaPontoMalote(despesaIds: string[]) {
  const ids = [...new Set(despesaIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["diaria_ponto_malote", ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ sincronizadoAte: string | null; porDespesa: Map<string, PontoDiariaMalote[]> }> => {
      const { data, error } = await sb.rpc("diaria_ponto_malote", { p_despesas: ids });
      const porDespesa = new Map<string, PontoDiariaMalote[]>();
      if (error || !data) return { sincronizadoAte: null, porDespesa };
      const r = data as RespostaPontoMalote;
      for (const it of r.itens ?? []) porDespesa.set(it.despesa_id, [...(porDespesa.get(it.despesa_id) ?? []), it]);
      return { sincronizadoAte: r.sincronizado_ate, porDespesa };
    },
  });
}
