import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SituacaoPlanilha } from "@/pages/financeiro/conciliacao-origem/regras";

// SIS-2026-0658: resumo da planilha do Fluxo de Caixa (em uso / ocultas / excluídas). Função da migration
// 20261015000020; sem ela (ainda não aplicada) a tela segue sem esse bloco.
export function useConciliacaoPlanilhaFluxo() {
  return useQuery({
    queryKey: ["conciliacao_fluxo_planilha_resumo"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conciliacao_fluxo_planilha_resumo");
      if (error) {
        if (error.code === "42883" || error.code === "PGRST202") return null;
        throw error;
      }
      return ((data ?? []) as any[]).map((r) => ({
        situacao: r.situacao as string,
        qtd: Number(r.qtd) || 0,
        entradas: Number(r.entradas) || 0,
        saidas: Number(r.saidas) || 0,
      })) as SituacaoPlanilha[];
    },
  });
}
