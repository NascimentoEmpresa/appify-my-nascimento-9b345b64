import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { desempacotar, type DadosDashboard } from "@/lib/recrutamento/dashboardRecrutamento";

const sb = supabase as unknown as SupabaseClient;

/**
 * Dados do Dashboard Recrutamento (mig 20260930000288): uma RPC só, colunar,
 * desempacotada em src/lib/recrutamento/dashboardRecrutamento.ts.
 *
 * Revalida sozinho a cada 5 minutos — o painel fica aberto em TV/tela cheia
 * no RH, e a consulta é barata (~70 ms no banco). Entre telas, o cache do
 * React Query mostra o último resultado na hora e atualiza por trás.
 */
export function useDashboardRecrutamento() {
  return useQuery({
    queryKey: ["recrut_dashboard_dados"],
    queryFn: async (): Promise<DadosDashboard> => {
      const { data, error } = await sb.rpc("recrut_dashboard_dados");
      if (error) throw error;
      return desempacotar(data);
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
