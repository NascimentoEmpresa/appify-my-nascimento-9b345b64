import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Fluxo de Caixa — linhas importadas da planilha: excluir (lixeira + restaurar) e ratear.
// As regras moram nas RPCs (migrations 20261015000010 e 20261030002000); permissão em financeiro-fluxo-caixa-gestao:
// ratear = incluir; excluir/restaurar = excluir (SIS-2026-0712 separou das de editar, que é alterar).
const LIXEIRA_KEY = "fluxo_caixa_importado_lixeira";

function invalidarFluxo(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
  qc.invalidateQueries({ queryKey: ["fluxo_caixa_malote"] });
  qc.invalidateQueries({ queryKey: [LIXEIRA_KEY] });
}

export function useExcluirLinhaImportada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (despesaId: string) => {
      const { error } = await (supabase as any).rpc("fluxo_caixa_importado_excluir", { _despesa_id: despesaId });
      if (error) throw error;
    },
    onSuccess: () => invalidarFluxo(qc),
  });
}

export function useRestaurarLinhaImportada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (despesaId: string) => {
      const { error } = await (supabase as any).rpc("fluxo_caixa_importado_restaurar", { _despesa_id: despesaId });
      if (error) throw error;
    },
    onSuccess: () => invalidarFluxo(qc),
  });
}

export function useRatearLinhaImportada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { despesaId: string; cotas: { contrato_id: string | null; valor: number }[] }) => {
      const { error } = await (supabase as any).rpc("fluxo_caixa_importado_ratear", { _despesa_id: i.despesaId, _cotas: i.cotas });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidarFluxo(qc);
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_ajuste"] });
    },
  });
}

export interface ImportadaNaLixeira {
  /** despesa_id da tela: id da linha, ou id do grupo de rateio. */
  despesaId: string;
  codigo: string;
  descricao: string;
  valor: number;
  tipo: "entrada" | "saida";
  dataPagamento: string;
  cotas: number;
  excluidaEm: string;
}

// Só o que um USUÁRIO excluiu pela tela (deleted_by preenchido): o que a carga/conferência já tinha excluído fica de fora.
export function useImportadaLixeira(ativo = true) {
  return useQuery({
    queryKey: [LIXEIRA_KEY],
    staleTime: 30_000,
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("fluxo_caixa_importado")
        .select("id, rateio_grupo_id, rateio_codigo, planilha_id_original, planilha_linha, descricao, valor, tipo, data_pagamento, deleted_at")
        .not("deleted_at", "is", null)
        .not("deleted_by", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) {
        // Migration ainda não aplicada (coluna deleted_by ausente): lixeira vazia, sem derrubar a tela.
        if (error.code === "42703") return [] as ImportadaNaLixeira[];
        throw error;
      }
      const grupos = new Map<string, ImportadaNaLixeira>();
      for (const r of (data ?? []) as any[]) {
        const chave = (r.rateio_grupo_id ?? r.id) as string;
        const atual = grupos.get(chave);
        if (atual) {
          atual.valor += Number(r.valor) || 0;
          atual.cotas += 1;
          continue;
        }
        grupos.set(chave, {
          despesaId: chave,
          codigo: r.rateio_codigo ?? r.planilha_id_original ?? `IMP-${String(r.planilha_linha).padStart(5, "0")}`,
          descricao: r.descricao ?? "",
          valor: Number(r.valor) || 0,
          tipo: r.tipo,
          dataPagamento: r.data_pagamento,
          cotas: 1,
          excluidaEm: r.deleted_at,
        });
      }
      return Array.from(grupos.values());
    },
  });
}
