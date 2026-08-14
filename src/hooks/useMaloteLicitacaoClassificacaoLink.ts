import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LigacaoLicitacaoClassificacao {
  id: string;
  campo_planilha_custo: string;
  classificacao_malote_id: string;
  classificacao_malote: { id: string; nome: string } | null;
}

const LIGACOES_KEY = "malote_licitacao_classificacao_link";

export function useLigacoesLicitacaoClassificacao() {
  return useQuery({
    queryKey: [LIGACOES_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_licitacao_classificacao_link")
        .select("id, campo_planilha_custo, classificacao_malote_id, classificacao_malote:classificacao_malote_id(id, nome)")
        .order("campo_planilha_custo");
      if (error) throw error;
      return (data ?? []) as LigacaoLicitacaoClassificacao[];
    },
  });
}

interface SalvarLigacaoInput {
  id?: string;
  campo_planilha_custo: string;
  classificacao_malote_id: string;
}

export function useSalvarLigacaoLicitacaoClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarLigacaoInput) => {
      const { error } = await (supabase as any)
        .from("malote_licitacao_classificacao_link")
        .upsert(input, { onConflict: input.id ? "id" : "campo_planilha_custo" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIGACOES_KEY] }),
  });
}

// Cria várias ligações de uma vez (um campo_planilha_custo por linha) pra
// UMA classificação do malote — evita o usuário ter que adicionar rubrica
// por rubrica quando várias vão pro mesmo lugar (pedido do Iury).
export function useSalvarLigacoesLicitacaoClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { campos_planilha_custo: string[]; classificacao_malote_id: string }) => {
      const payload = input.campos_planilha_custo.map((campo) => ({
        campo_planilha_custo: campo,
        classificacao_malote_id: input.classificacao_malote_id,
      }));
      const { error } = await (supabase as any).from("malote_licitacao_classificacao_link").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIGACOES_KEY] }),
  });
}

export function useExcluirLigacaoLicitacaoClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("malote_licitacao_classificacao_link").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIGACOES_KEY] }),
  });
}
