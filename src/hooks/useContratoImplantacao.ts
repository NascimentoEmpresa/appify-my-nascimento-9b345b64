import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { ContratoImplantacao, RegistroImplantacao } from "@/lib/licitacoes/implantacao";

// As RPCs novas ainda não estão no types.ts gerado.
const sb = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: Error | null }>;
};

/** Contratos com previsto × implantado por posto (aba Implantação). */
export function useContratoImplantacao(ativo: boolean) {
  return useQuery({
    queryKey: ["contrato_implantacao"],
    enabled: ativo,
    queryFn: async (): Promise<ContratoImplantacao[]> => {
      const { data, error } = await sb.rpc("contrato_implantacao_painel");
      if (error) throw error;
      return (data ?? []) as ContratoImplantacao[];
    },
  });
}

export function useContratoImplantacaoHistorico(contratoId: string | null) {
  return useQuery({
    queryKey: ["contrato_implantacao", "historico", contratoId],
    enabled: !!contratoId,
    queryFn: async (): Promise<RegistroImplantacao[]> => {
      const { data, error } = await sb.rpc("contrato_implantacao_historico", { p_contrato_id: contratoId });
      if (error) throw error;
      return (data ?? []) as RegistroImplantacao[];
    },
  });
}

export function useContratoImplantacaoSalvar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { contratoId: string; valeAPartirDe: string; postos: unknown[] }) => {
      const { data, error } = await sb.rpc("contrato_implantacao_salvar", {
        p_contrato_id: v.contratoId,
        p_vale_a_partir_de: v.valeAPartirDe,
        p_postos: v.postos,
      });
      if (error) throw error;
      return (data ?? 0) as number;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contrato_implantacao"] });
      // O implantado é a base do saldo no Ativos/Contratos e da Efetividade.
      qc.invalidateQueries({ queryKey: ["rh-ativos-contratos"] });
      qc.invalidateQueries({ queryKey: ["efetividade", "previsto-planilha"] });
      toast({ title: "Implantação registrada" });
    },
    onError: (e: Error) =>
      toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" }),
  });
}
