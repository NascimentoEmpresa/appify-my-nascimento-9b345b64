/**
 * Aba Cancelamentos do Dashboard de Compras (SIS-2026-0945).
 *
 * UMA requisição com o array de empresas, inclusive no "Todas": o portão da
 * RPC confere cada empresa. Chamar uma vez por empresa num Promise.all
 * reprovaria no guardião de desempenho (D7).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizarPainelCancelamentos,
  type PainelCancelamentos,
} from "@/lib/suprimentos/dashboardCancelamentos";

// types.ts é gerado fora do CI e não conhece esta RPC — mesmo cliente tipado
// de useDashboardComprasEstoque.
const sb = supabase as unknown as {
  rpc: (nome: string, parametros: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export interface FiltroCancelamentos {
  empresaIds: string[];
  inicio: string;
  fim: string;
  contratoId: string | null;
  categoria: string | null;
}

export function useDashboardCancelamentos(filtro: FiltroCancelamentos) {
  return useQuery({
    // Sem as empresas na chave, trocar de empresa devolveria o cache da anterior.
    queryKey: [
      "sup-dashboard-cancelamentos",
      filtro.empresaIds,
      filtro.inicio,
      filtro.fim,
      filtro.contratoId,
      filtro.categoria,
    ],
    enabled: filtro.empresaIds.length > 0 && Boolean(filtro.inicio && filtro.fim),
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<PainelCancelamentos> => {
      const { data, error } = await sb.rpc("sup_dashboard_cancelamentos_painel", {
        p_empresa_ids: filtro.empresaIds,
        p_inicio: filtro.inicio,
        p_fim: filtro.fim,
        p_contrato_id: filtro.contratoId,
        p_categoria: filtro.categoria,
      });
      if (error) throw error;
      return normalizarPainelCancelamentos(data);
    },
  });
}
