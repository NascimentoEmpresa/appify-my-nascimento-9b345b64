import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { toast } from "@/hooks/use-toast";

// A tabela `contratos` NÃO está no types.ts gerado pelo Lovable, então o client
// tipado a trata como inexistente e reclama de toda coluna ("id" não é
// atribuível a never). Mesmo escape que useSupCatalogo e useSupPedidos usam.
const sb = supabase as any;

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
      const { data, error } = await sb
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
        const { error } = await sb
          .from("contratos")
          .update({ ...input, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await sb
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
      const { error } = await sb.from("contratos").delete().eq("id", id);
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

export interface ContratoSelecao {
  id: string;
  nome: string;
}

/**
 * Lista enxuta de contratos para preencher um <Select>.
 *
 * Separada de useContratosERP porque aquela traz a linha inteira — as dezenas
 * de colunas de imposto, faturamento e envio de NF — só para desenhar um
 * dropdown de duas palavras.
 *
 * Sem filtro de empresa_id de propósito, e isso NÃO é descuido: a leitura de
 * `contratos` é aberta a authenticated desde a migration 20260901000002, que
 * tirou de vez o user_empresa do caminho. É assim que a cascata do Supply
 * (useContratosCatalogo) monta a mesma lista; filtrar aqui faria estas telas
 * mostrarem menos contrato que o Catálogo de Materiais.
 */
export function useContratosSelecao() {
  return useQuery({
    queryKey: ["contratos_selecao"],
    queryFn: async (): Promise<ContratoSelecao[]> => {
      const { data, error } = await sb
        .from("contratos")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ContratoSelecao[];
    },
  });
}

