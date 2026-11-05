/**
 * Saídas por Contrato (SIS-2026-0769) — leitura do relatório de conferência.
 *
 * Duas RPCs, as duas SECURITY DEFINER. O portão aceita DOIS códigos de menu
 * desde 20261105012000 — 'sup_rel_saidas_contrato' (a tela própria) ou
 * 'sup_dashboard_compras_estoque' (a aba dentro do Dashboard de Compras).
 * Quem chega pelo Dashboard sem o menu do relatório veria tabela vazia, porque
 * permissão negada aqui devolve zero linha, não erro:
 *   • sup_rel_saidas_por_contrato — a linha mês × contrato × item × origem
 *   • sup_rel_saidas_cobertura    — quanto de cada mês tem destino conhecido
 *
 * A fonte é sup_estoque_consumo, NÃO sup_estoque_movimento: a trilha de
 * movimento só existe a partir de setembro/2026 e devolve zero para o período
 * que o chamado pede — foi esse zero numa tela que gerou o chamado.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  FiltroSaidas,
  LinhaCobertura,
  LinhaSaida,
} from "@/lib/suprimentos/saidasPorContrato";

// types.ts é gerado fora do CI e não conhece estas duas RPCs. Mesmo padrão dos
// outros hooks de RPC nova do projeto — ver useAgendaCorporativa e
// useAplicacaoFinanceira.
const sb = supabase as any;

export function useSaidasPorContrato(filtro: FiltroSaidas) {
  return useQuery({
    queryKey: [
      "sup-saidas-por-contrato",
      filtro.inicio,
      filtro.fim,
      filtro.contratoId,
      // Sem a empresa na chave, trocar de empresa no Dashboard devolveria o
      // cache da anterior — número de outra empresa sob o nome da escolhida.
      filtro.empresaId ?? null,
    ],
    queryFn: async (): Promise<LinhaSaida[]> => {
      const { data, error } = await sb.rpc("sup_rel_saidas_por_contrato", {
        p_inicio: filtro.inicio,
        p_fim: filtro.fim,
        p_contrato_id: filtro.contratoId,
        p_empresa_id: filtro.empresaId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as LinhaSaida[];
    },
    enabled: Boolean(filtro.inicio && filtro.fim),
  });
}

export function useCoberturaSaidas(filtro: Pick<FiltroSaidas, "inicio" | "fim">) {
  return useQuery({
    queryKey: ["sup-saidas-cobertura", filtro.inicio, filtro.fim],
    queryFn: async (): Promise<LinhaCobertura[]> => {
      const { data, error } = await sb.rpc("sup_rel_saidas_cobertura", {
        p_inicio: filtro.inicio,
        p_fim: filtro.fim,
      });
      if (error) throw error;
      return (data ?? []) as LinhaCobertura[];
    },
    enabled: Boolean(filtro.inicio && filtro.fim),
  });
}
