import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  DashboardComprasEstoqueDados,
  FiltroDashboardCompras,
} from "@/lib/suprimentos/dashboardComprasEstoque";
import { consolidarDashboardsCompras } from "@/lib/suprimentos/dashboardComprasEstoque";

export function useDashboardComprasEstoque(
  empresaIdOuIds: string | string[] | null | undefined,
  filtros: FiltroDashboardCompras,
) {
  const empresaIds = Array.isArray(empresaIdOuIds)
    ? empresaIdOuIds.filter(Boolean)
    : empresaIdOuIds ? [empresaIdOuIds] : [];
  return useQuery({
    queryKey: ["sup_dashboard_compras_estoque", empresaIds, filtros],
    enabled: empresaIds.length > 0 && !!filtros.inicio && !!filtros.fim,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<DashboardComprasEstoqueDados> => {
      const cliente = supabase as unknown as {
        rpc: (nome: string, parametros: Record<string, unknown>) => Promise<{
          data: unknown;
          error: { message: string } | null;
        }>;
      };
      const paineis = await Promise.all(empresaIds.map(async (empresaId) => {
        const { data, error } = await cliente.rpc("sup_dashboard_compras_estoque", {
          p_empresa_id: empresaId,
          p_inicio: filtros.inicio,
          p_fim: filtros.fim,
          p_contrato_id: filtros.contratoId,
          p_categoria: filtros.categoria,
          p_comprador: filtros.comprador,
        });
        if (error) throw error;
        return data as DashboardComprasEstoqueDados;
      }));
      return consolidarDashboardsCompras(paineis);
    },
  });
}
