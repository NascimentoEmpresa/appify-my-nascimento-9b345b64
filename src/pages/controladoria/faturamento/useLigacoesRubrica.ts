import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LigacoesRubrica, RubricaLigacao } from "./regras";

// Ligações manuais Classificação → Rubrica de custo (painel da Lucratividade).
// Ver supabase/migrations/20261007000007_lucratividade_rubrica_classificacao.sql.
const CHAVE = ["lucratividade_rubrica_classificacao"];

export function useLigacoesRubrica() {
  return useQuery({
    queryKey: CHAVE,
    staleTime: 60_000,
    queryFn: async (): Promise<LigacoesRubrica> => {
      const { data, error } = await (supabase as any)
        .from("lucratividade_rubrica_classificacao")
        .select("classificacao_id, rubrica");
      if (error) {
        // Migration ainda não aplicada: a tela segue só com o automático por nome.
        if (error.code === "PGRST205" || error.code === "42P01") return new Map();
        throw error;
      }
      return new Map((data ?? []).map((r: { classificacao_id: string; rubrica: RubricaLigacao }) => [r.classificacao_id, r.rubrica]));
    },
  });
}

// rubrica = null volta a classificação ao automático (apaga a ligação).
export function useSalvarLigacaoRubrica() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ classificacaoId, rubrica }: { classificacaoId: string; rubrica: RubricaLigacao | null }) => {
      const t = (supabase as any).from("lucratividade_rubrica_classificacao");
      const { error } = rubrica
        ? await t.upsert({ classificacao_id: classificacaoId, rubrica }, { onConflict: "classificacao_id" })
        : await t.delete().eq("classificacao_id", classificacaoId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}
