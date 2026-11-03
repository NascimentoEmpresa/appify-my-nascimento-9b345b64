import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TratamentoContrato, TratamentosContrato } from "./tratamentoContrato";

export const CHAVE_TRATAMENTOS = ["controladoria_contrato_tratamento"];

// Exceções de tratamento por contrato. Tabela ainda não criada no banco (migration 20261028000010): devolve vazio e tudo segue pela regra do nome.
export function useTratamentosContrato() {
  return useQuery({
    queryKey: CHAVE_TRATAMENTOS,
    staleTime: 60_000,
    queryFn: async (): Promise<TratamentosContrato> => {
      const { data, error } = await (supabase as any).from("controladoria_contrato_tratamento").select("contrato_id, tratamento");
      if (error) {
        if (error.code === "PGRST205" || error.code === "42P01") return new Map();
        throw error;
      }
      return new Map((data ?? []).map((r: { contrato_id: string; tratamento: TratamentoContrato }) => [r.contrato_id, r.tratamento]));
    },
  });
}

// tratamento = null volta o contrato ao padrão pelo nome (apaga a exceção).
export function useSalvarTratamentoContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, tratamento }: { contratoId: string; tratamento: TratamentoContrato | null }) => {
      const t = (supabase as any).from("controladoria_contrato_tratamento");
      const { error } = tratamento
        ? await t.upsert({ contrato_id: contratoId, tratamento }, { onConflict: "contrato_id" })
        : await t.delete().eq("contrato_id", contratoId);
      if (error) {
        if (error.code === "PGRST205" || error.code === "42P01") throw new Error("Falta a migration 20261028000010 (tratamento dos contratos) no banco.");
        throw error;
      }
    },
    onSuccess: () => {
      for (const k of [CHAVE_TRATAMENTOS, ["lucratividade_custos_ano"], ["lucratividade_custos_mes"]]) qc.invalidateQueries({ queryKey: k });
    },
  });
}
