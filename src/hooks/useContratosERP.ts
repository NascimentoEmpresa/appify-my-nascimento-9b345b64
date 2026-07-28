import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { toast } from "@/hooks/use-toast";

export interface ContratoERP {
  id: string;
  empresa_id: string;
  nome: string;
  cliente: string;
  cnpj_cliente: string | null;
  vigencia_meses: number | null;
  data_inicio: string | null;
  status: "ativo" | "encerrado" | "suspenso";
  grade_id: string | null;
  capa_id: string | null;
  issqn_pct: number;
  ir_pct: number;
  cofins_pct: number;
  pis_pct: number;
  csll_pct: number;
  prazo_pagamento: string | null;
  codigo_servico_lc116: string | null;
  codigo_servico_municipal_cnae: string | null;
  conta_pagamento: string | null;
  email_envio_nf: string | null;
  instrucoes_envio: string | null;
  created_at: string;
  updated_at: string;
}

export type ContratoERPInput = Omit<ContratoERP, "id" | "empresa_id" | "created_at" | "updated_at">;

export function useContratosERP() {
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? null;

  return useQuery({
    queryKey: ["contratos_erp", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contratos")
        .select("*")
        .eq("empresa_id", empresaId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContratoERP[];
    },
  });
}

export function useContratoERPUpsert() {
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? "";
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: ContratoERPInput & { id?: string }) => {
      if (id) {
        const { error } = await supabase
          .from("contratos")
          .update({ ...input, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("contratos")
          .insert({ ...input, empresa_id: empresaId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contratos_erp", empresaId] });
      toast({ title: "Contrato salvo." });
    },
    onError: (e: Error) =>
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });
}

export function useContratoERPDelete() {
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? "";
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contratos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contratos_erp", empresaId] });
      toast({ title: "Contrato excluído." });
    },
    onError: (e: Error) =>
      toast({ title: "Erro ao excluir", description: e.message, variant: "destructive" }),
  });
}
