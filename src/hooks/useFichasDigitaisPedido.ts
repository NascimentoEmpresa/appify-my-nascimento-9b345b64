import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FichaDigitalPedido } from "@/lib/suprimentos/fichasDigitaisPedido";

export function useFichasDigitaisPedido(pedidoId: string | null) {
  return useQuery({
    queryKey: ["sup_epi_fichas_do_pedido", pedidoId],
    enabled: !!pedidoId,
    queryFn: async (): Promise<FichaDigitalPedido[]> => {
      // A RPC ainda nao consta no types.ts gerado.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("sup_epi_fichas_do_pedido", { p_pedido: pedidoId });
      if (error) throw error;
      return data ?? [];
    },
  });
}
