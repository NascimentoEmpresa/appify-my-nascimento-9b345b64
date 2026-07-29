import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { InssCategoria } from "@/pages/financeiro/nf-emissao/calculos";

const MODELO_KEY = "nf_emissao_modelo";
const MODELO_ITEM_KEY = "nf_emissao_modelo_item";

export interface NfEmissaoModeloRow {
  id: string;
  empresa_id: string;
  contrato_id: string;
  variacao: string | null;
  ordem: number;
  ativo: boolean;
}

export interface NfEmissaoModeloItemRow {
  id: string;
  nf_emissao_modelo_id: string;
  ordem: number;
  posto: string | null;
  percentual: number;
  identificacao_padrao: string | null;
  inss_categoria: InssCategoria;
  ultimo_valor_unitario: number | null;
  ultimo_visto_em: string | null;
}

export function useModelosNf(contratoId: string | null | undefined) {
  return useQuery({
    queryKey: [MODELO_KEY, contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_emissao_modelo")
        .select("*")
        .eq("contrato_id", contratoId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as NfEmissaoModeloRow[];
    },
  });
}

export async function buscarItensModeloNf(modeloId: string): Promise<NfEmissaoModeloItemRow[]> {
  const { data, error } = await (supabase as any)
    .from("nf_emissao_modelo_item")
    .select("*")
    .eq("nf_emissao_modelo_id", modeloId)
    .order("ordem");
  if (error) throw error;
  return (data ?? []) as NfEmissaoModeloItemRow[];
}

export function useItensModeloNf(modeloId: string | null | undefined) {
  return useQuery({
    queryKey: [MODELO_ITEM_KEY, modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_emissao_modelo_item")
        .select("*")
        .eq("nf_emissao_modelo_id", modeloId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as NfEmissaoModeloItemRow[];
    },
  });
}

interface SalvarModeloNfInput {
  id?: string;
  empresa_id: string;
  contrato_id: string;
  variacao: string | null;
  ordem: number;
  ativo: boolean;
}

export function useSalvarModeloNf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarModeloNfInput) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      if (input.id) {
        const { error } = await (supabase as any)
          .from("nf_emissao_modelo")
          .update({
            variacao: input.variacao,
            ordem: input.ordem,
            ativo: input.ativo,
            updated_by: userId,
          })
          .eq("id", input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await (supabase as any)
        .from("nf_emissao_modelo")
        .insert({
          empresa_id: input.empresa_id,
          contrato_id: input.contrato_id,
          variacao: input.variacao,
          ordem: input.ordem,
          ativo: input.ativo,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [MODELO_KEY] }),
  });
}

interface ModeloItemInput {
  posto: string | null;
  percentual: number;
  identificacao_padrao: string | null;
  inss_categoria: InssCategoria;
  ultimo_valor_unitario: number | null;
}

export function useSalvarModeloItens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { modeloId: string; itens: ModeloItemInput[] }) => {
      const { error: eDel } = await (supabase as any)
        .from("nf_emissao_modelo_item")
        .delete()
        .eq("nf_emissao_modelo_id", input.modeloId);
      if (eDel) throw eDel;

      if (input.itens.length > 0) {
        const payload = input.itens.map((it, idx) => ({
          nf_emissao_modelo_id: input.modeloId,
          ordem: idx + 1,
          ...it,
          ultimo_visto_em: it.ultimo_valor_unitario != null ? new Date().toISOString() : null,
        }));
        const { error: eIns } = await (supabase as any).from("nf_emissao_modelo_item").insert(payload);
        if (eIns) throw eIns;
      }
      return input.modeloId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [MODELO_ITEM_KEY] }),
  });
}

interface CriarVariacoesEmLoteInput {
  empresa_id: string;
  contrato_id: string;
  nomes: string[];
  ordemInicial: number;
}

export function useCriarVariacoesEmLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CriarVariacoesEmLoteInput) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;

      const payloadModelos = input.nomes.map((nome, idx) => ({
        empresa_id: input.empresa_id,
        contrato_id: input.contrato_id,
        variacao: nome,
        ordem: input.ordemInicial + idx,
        ativo: true,
        created_by: userId,
        updated_by: userId,
      }));
      const { data: modelosCriados, error } = await (supabase as any)
        .from("nf_emissao_modelo")
        .insert(payloadModelos)
        .select("id");
      if (error) throw error;

      const payloadItens = (modelosCriados ?? []).map((m: { id: string }) => ({
        nf_emissao_modelo_id: m.id,
        ordem: 1,
        posto: null,
        percentual: 100,
        identificacao_padrao: null,
        inss_categoria: "normais",
      }));
      if (payloadItens.length > 0) {
        const { error: eItens } = await (supabase as any).from("nf_emissao_modelo_item").insert(payloadItens);
        if (eItens) throw eItens;
      }
      return (modelosCriados ?? []).length as number;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [MODELO_KEY] });
      qc.invalidateQueries({ queryKey: [MODELO_ITEM_KEY] });
    },
  });
}

interface LinhaImportada {
  variacao: string;
  posto: string | null;
  percentual: number;
  valorReferencia: number | null;
}

interface ImportarVariacoesInput {
  empresa_id: string;
  contrato_id: string;
  ordemInicial: number;
  linhas: LinhaImportada[];
}

export function useImportarVariacoesDoExcel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ImportarVariacoesInput) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;

      const payloadModelos = input.linhas.map((l, idx) => ({
        empresa_id: input.empresa_id,
        contrato_id: input.contrato_id,
        variacao: l.variacao,
        ordem: input.ordemInicial + idx,
        ativo: true,
        created_by: userId,
        updated_by: userId,
      }));
      const { data: modelosCriados, error } = await (supabase as any)
        .from("nf_emissao_modelo")
        .insert(payloadModelos)
        .select("id");
      if (error) throw error;

      const payloadItens = (modelosCriados ?? []).map((m: { id: string }, idx: number) => {
        const l = input.linhas[idx];
        return {
          nf_emissao_modelo_id: m.id,
          ordem: 1,
          posto: l.posto,
          percentual: l.percentual,
          identificacao_padrao: null,
          inss_categoria: "normais",
          ultimo_valor_unitario: l.valorReferencia,
          ultimo_visto_em: l.valorReferencia != null ? new Date().toISOString() : null,
        };
      });
      if (payloadItens.length > 0) {
        const { error: eItens } = await (supabase as any).from("nf_emissao_modelo_item").insert(payloadItens);
        if (eItens) throw eItens;
      }
      return (modelosCriados ?? []).length as number;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [MODELO_KEY] });
      qc.invalidateQueries({ queryKey: [MODELO_ITEM_KEY] });
    },
  });
}

export function useExcluirModeloNf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("nf_emissao_modelo").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [MODELO_KEY] }),
  });
}

export function useAtualizarUltimoValorVisto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { itemId: string; valorUnitario: number }) => {
      const { error } = await (supabase as any)
        .from("nf_emissao_modelo_item")
        .update({ ultimo_valor_unitario: input.valorUnitario, ultimo_visto_em: new Date().toISOString() })
        .eq("id", input.itemId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [MODELO_ITEM_KEY] }),
  });
}
