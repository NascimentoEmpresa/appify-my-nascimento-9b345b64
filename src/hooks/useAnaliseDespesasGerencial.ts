import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizarAnalise, type AnaliseDespesasRpc, type TipoDataDespesa } from "@/pages/financeiro/fluxo-caixa-gerencial/analiseDespesas";

// Fluxo de Caixa Gerencial (etapa 3): despesas por classificação, contrato/centro de custo e origem, com o período anterior, calculadas no servidor
// (financeiro_fluxo_gerencial_despesas, migration 20261119120000): o Fluxo tem ~25 mil linhas e somar no navegador é o que já derrubou a API.
export function useAnaliseDespesasGerencial(f: { ini: string; fim: string; empresaId: string; contratoId: string }, tipoData: TipoDataDespesa) {
  return useQuery({
    queryKey: ["fluxo_caixa_gerencial_despesas", f.ini, f.fim, f.empresaId, f.contratoId, tipoData],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<AnaliseDespesasRpc> => {
      const cliente = supabase as unknown as { rpc: (nome: string, args: object) => Promise<{ data: unknown; error: { message: string } | null }> };
      const { data, error } = await cliente.rpc("financeiro_fluxo_gerencial_despesas", {
        p_ini: f.ini, p_fim: f.fim, p_empresa: f.empresaId || null, p_contrato: f.contratoId || null, p_tipo_data: tipoData,
      });
      if (error) throw error;
      return normalizarAnalise(data);
    },
  });
}
