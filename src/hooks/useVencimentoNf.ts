import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Fluxo de Caixa Gerencial (etapa 3): o Financeiro ajusta o vencimento de uma nota (nf_emissao.data_vencimento, migration 20261119110000).
// `null` remove o ajuste e a nota volta ao vencimento calculado pelo prazo do contrato. Quem pode gravar é decidido pela RLS da nf_emissao;
// o erro do Supabase é um objeto simples (não Error): quem chama lê `.message`.
export function useDefinirVencimentoNf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ notaId, vencimento }: { notaId: string; vencimento: string | null }) => {
      const { error } = await (supabase as unknown as { from: (t: string) => { update: (v: object) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } } })
        .from("nf_emissao")
        .update({ data_vencimento: vencimento, vencimento_origem: vencimento ? "manual" : null })
        .eq("id", notaId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nf_emissao"] }),
  });
}
