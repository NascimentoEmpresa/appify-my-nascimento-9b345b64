import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RespostaMes } from "@/lib/gestaoPonto";

// =====================================================================
// RH › Gestão de Ponto — acesso a dados (RPCs gp_*, mig 20261007000001).
// O espelho da Senior (schema espelho) não é exposto à API: só as RPCs
// SECURITY DEFINER leem, e devolvem nome, cargo, matrícula, escala e batidas.
// =====================================================================

type ChamadaRpc = <T>(fn: string, args?: Record<string, unknown>) =>
  Promise<{ data: T | null; error: { message: string } | null }>;
const sb = supabase as unknown as { rpc: ChamadaRpc };

export const usePontoFiliais = () => useQuery({
  queryKey: ["gestao-ponto", "filiais"],
  staleTime: 30 * 60_000,
  queryFn: async () => {
    const { data, error } = await sb.rpc<{ filial: string; ativos: number }[]>("gp_filiais");
    if (error) throw error;
    return data ?? [];
  },
});

/** O mês de uma filial inteira, ou de um colaborador (empregadoId). */
export const usePontoMes = (mes: string, filial: string | null, empregadoId: number | null = null) => useQuery({
  queryKey: ["gestao-ponto", "mes", mes, filial, empregadoId],
  enabled: /^\d{4}-\d{2}$/.test(mes) && (!!filial || !!empregadoId),
  staleTime: 10 * 60_000,
  queryFn: async (): Promise<RespostaMes> => {
    const { data, error } = await sb.rpc<RespostaMes>("gp_mes", {
      p_mes: mes, p_filial: empregadoId ? null : filial, p_empregado_id: empregadoId,
    });
    if (error) throw error;
    return data ?? { disponivel: false, mes, inicio: "", fim: "", gerado_em: "", colaboradores: [] };
  },
});
