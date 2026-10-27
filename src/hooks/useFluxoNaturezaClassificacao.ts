import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MapaNatureza, NaturezaFluxo } from "@/pages/financeiro/fluxo-caixa/naturezaFluxo";

const KEY = "fluxo_classificacao_natureza";

// SIS-2026-0726: natureza (conta movimento / conta vinculada / CDB) de cada classificação, usada pelos cards do Fluxo de Caixa.
// Tabela ainda não criada no banco (migration 20261027000050): devolve mapa vazio em vez de derrubar o Fluxo — os cards então
// mostram tudo como "sem natureza" e o aviso explica.
export function useNaturezaClassificacoes() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<MapaNatureza> => {
      const { data, error } = await (supabase as any).from("financeiro_fluxo_classificacao_natureza").select("classificacao_id, natureza");
      if (error) {
        if (error.code === "PGRST205" || error.code === "42P01") return new Map();
        throw error;
      }
      return new Map((data ?? []).map((r: { classificacao_id: string; natureza: NaturezaFluxo }) => [r.classificacao_id, r.natureza]));
    },
  });
}

// natureza null = tira o mapeamento (volta a "sem natureza").
export function useSalvarNaturezaClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ classificacaoId, natureza }: { classificacaoId: string; natureza: NaturezaFluxo | null }) => {
      if (natureza === null) {
        const { error } = await (supabase as any).from("financeiro_fluxo_classificacao_natureza").delete().eq("classificacao_id", classificacaoId);
        if (error) throw error;
        return;
      }
      const { data: u } = await supabase.auth.getUser();
      const { error } = await (supabase as any)
        .from("financeiro_fluxo_classificacao_natureza")
        .upsert({ classificacao_id: classificacaoId, natureza, updated_by: u.user?.id ?? null }, { onConflict: "classificacao_id" });
      if (error) {
        if (error.code === "PGRST205" || error.code === "42P01") throw new Error("Falta a migration 20261027000050 (natureza das classificações) no banco.");
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
