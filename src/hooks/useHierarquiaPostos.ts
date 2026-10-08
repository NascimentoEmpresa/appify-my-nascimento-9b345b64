import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { montarHierarquia, type Hierarquia, type PainelHierarquiaBruto } from "@/lib/rh/hierarquiaPostos";

// RH › Hierarquia de Postos (mig 20261007000024): leitura pela RPC
// rh_hier_painel (cobra o menu rh_hierarquia_postos); mover/remover pelas
// RPCs, que exigem 'alterar' e gravam o histórico.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = ["rh-hierarquia-postos"];

export const useHierarquiaPostos = () => useQuery({
  queryKey: K, staleTime: 5 * 60_000,
  queryFn: async (): Promise<Hierarquia> => {
    const { data, error } = await sb.rpc("rh_hier_painel");
    if (error) throw error;
    return montarHierarquia(data as PainelHierarquiaBruto);
  },
});

export function useMoverPosto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { posto: string; novoPai: string | null; motivo: string; remover?: boolean }) => {
      const { error } = p.remover
        ? await sb.rpc("rh_hier_remover", { p_posto: p.posto, p_motivo: p.motivo })
        : await sb.rpc("rh_hier_mover", { p_posto: p.posto, p_novo_pai: p.novoPai, p_motivo: p.motivo });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: K }),
  });
}

export function useSincronizarPostos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await sb.rpc("rh_hier_sincronizar_postos");
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: K }),
  });
}
