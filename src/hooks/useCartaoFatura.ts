import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ItemExistente } from "@/lib/cartaoFatura/reconciliar";

// SIS-2026-0255: Importar fatura do Cartão de Crédito. Mesma tela/mesma
// ação de malote_cartao_credito ('financeiro-cartao-credito') — sem menu
// nem ação novos (decisão do usuário).

const BUCKET_FATURAS = "cartao-faturas";
const FATURA_KEY = "malote_cartao_fatura";

export interface FaturaCartao {
  id: string;
  cartao_id: string;
  competencia: string; // yyyy-mm-01
  arquivo_original_path: string | null;
  valor_total: number;
  status: "projetada" | "importada";
  importado_em: string | null;
}

export function useFaturaExistente(cartaoId: string | null, competenciaISO: string | null) {
  return useQuery({
    queryKey: [FATURA_KEY, cartaoId, competenciaISO],
    enabled: !!cartaoId && !!competenciaISO,
    queryFn: async () => {
      const { data: fatura, error: erroFatura } = await (supabase as any)
        .from("malote_cartao_fatura")
        .select("*")
        .eq("cartao_id", cartaoId)
        .eq("competencia", competenciaISO)
        .maybeSingle();
      if (erroFatura) throw erroFatura;
      if (!fatura) return { fatura: null as FaturaCartao | null, itens: [] as ItemExistente[] };

      const { data: itens, error: erroItens } = await (supabase as any)
        .from("malote_cartao_fatura_item")
        .select("id, compra_id, descricao, data_compra, valor, parcela_atual, parcela_total, origem, status")
        .eq("fatura_id", fatura.id)
        .is("deleted_at", null);
      if (erroItens) throw erroItens;

      return { fatura: fatura as FaturaCartao, itens: (itens ?? []) as ItemExistente[] };
    },
  });
}

// Resumo por cartão pra badge "Fatura" na tabela "Cartões de Crédito
// Cadastrados" — última competência com status='importada'.
export function useFaturasResumoPorCartao() {
  return useQuery({
    queryKey: [FATURA_KEY, "resumo"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_cartao_fatura")
        .select("cartao_id, competencia, status")
        .eq("status", "importada")
        .order("competencia", { ascending: false });
      if (error) throw error;
      const porCartao = new Map<string, { competencia: string }>();
      for (const row of (data ?? []) as { cartao_id: string; competencia: string }[]) {
        if (!porCartao.has(row.cartao_id)) porCartao.set(row.cartao_id, { competencia: row.competencia });
      }
      return porCartao;
    },
  });
}

// SIS-2026-0413: itens na lixeira (soft-deleted) — usado pelo modal de
// Lixeira do Fluxo de Caixa. Junta com a fatura/cartão pra dar contexto
// (nome do cartão, competência) igual v_cartao_fatura_fluxo_caixa resolve.
export interface ItemFaturaLixeira {
  id: string;
  fatura_id: string;
  compra_id: string;
  descricao: string;
  data_compra: string | null;
  valor: number;
  deleted_at: string;
  nome_cartao: string;
  competencia: string;
}

export function useCartaoFaturaLixeira() {
  return useQuery({
    queryKey: [FATURA_KEY, "lixeira"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_cartao_fatura_item")
        .select("id, fatura_id, compra_id, descricao, data_compra, valor, deleted_at, malote_cartao_fatura(competencia, malote_cartao_credito(nome_cartao))")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        fatura_id: r.fatura_id,
        compra_id: r.compra_id,
        descricao: r.descricao,
        data_compra: r.data_compra,
        valor: r.valor,
        deleted_at: r.deleted_at,
        nome_cartao: r.malote_cartao_fatura?.malote_cartao_credito?.nome_cartao ?? "—",
        competencia: r.malote_cartao_fatura?.competencia ?? "",
      })) as ItemFaturaLixeira[];
    },
  });
}

// Excluir (soft) 1 item direto do Fluxo de Caixa, sem passar pela tela de
// revisão de importação.
export function useExcluirItemFatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("cartao_fatura_item_excluir", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [FATURA_KEY] });
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
    },
  });
}

// SIS-2026-0413 (complemento): forma_pagamento/banco são do CARTÃO
// (malote_cartao_credito), não existem em malote_cartao_fatura_item — só
// a Data da Compra é campo de verdade por item.
export function useEditarDataItemFatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dataCompra }: { id: string; dataCompra: string | null }) => {
      const { error } = await (supabase as any).rpc("cartao_fatura_item_editar_data", { _id: id, _data_compra: dataCompra });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [FATURA_KEY] });
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
    },
  });
}

export function useRestaurarItemFatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("cartao_fatura_item_restaurar", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [FATURA_KEY] });
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
    },
  });
}

export function urlArquivoFaturaAssinada(path: string | null | undefined) {
  return async () => {
    if (!path) return null;
    const { data, error } = await supabase.storage.from(BUCKET_FATURAS).createSignedUrl(path, 60 * 5);
    if (error) throw error;
    return data.signedUrl;
  };
}

export function useUploadArquivoFatura() {
  return useMutation({
    mutationFn: async ({ cartaoId, competenciaISO, arquivo }: { cartaoId: string; competenciaISO: string; arquivo: File }) => {
      const ext = arquivo.name.split(".").pop() ?? "dat";
      const path = `${cartaoId}/${competenciaISO}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET_FATURAS).upload(path, arquivo, { upsert: true });
      if (error) throw error;
      return path;
    },
  });
}

export interface ItemConfirmar {
  id: string | null;
  compra_id: string;
  descricao: string;
  data_compra: string | null;
  valor: number;
  parcela_atual: number | null;
  parcela_total: number | null;
  origem: "importado" | "manual";
}

export function useConfirmarImportacaoFatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      cartaoId: string;
      competenciaISO: string;
      arquivoPath: string | null;
      itens: ItemConfirmar[];
      itensExcluirIds: string[];
    }) => {
      const { data, error } = await (supabase as any).rpc("cartao_fatura_confirmar_importacao", {
        _cartao_id: input.cartaoId,
        _competencia: input.competenciaISO,
        _arquivo_path: input.arquivoPath,
        _itens: input.itens,
        _itens_excluir_ids: input.itensExcluirIds,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [FATURA_KEY] });
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
    },
  });
}
