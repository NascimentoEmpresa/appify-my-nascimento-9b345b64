import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { desempacotar, desempacotarPassagens, type DadosDashboard, type PassagemResponsavel } from "@/lib/recrutamento/dashboardRecrutamento";

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

/**
 * Tempo em cada status por responsável (mig 20261027000920): as passagens
 * de status no período, com quem segurava a vaga. Banco ainda sem a RPC →
 * lista vazia (a seção mostra só o "parado agora").
 */
export function useTempoStatusResponsavel(faixa: [string | null, string | null]) {
  return useQuery({
    queryKey: ["recrut_tempo_status_responsavel", faixa[0], faixa[1]],
    queryFn: async (): Promise<PassagemResponsavel[]> => {
      const { data, error } = await sb.rpc("recrut_tempo_status_responsavel", { _de: faixa[0], _ate: faixa[1] });
      if (error) return [];
      return desempacotarPassagens(data);
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
