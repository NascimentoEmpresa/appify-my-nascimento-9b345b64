import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LigacaoAdministrativoClassificacao {
  id: string;
  classificacao_administrativa_id: string;
  classificacao_malote_id: string;
  classificacao_administrativa: { id: string; nome: string } | null;
  classificacao_malote: { id: string; nome: string } | null;
}

const LIGACOES_KEY = "malote_administrativo_classificacao_link";

export function useLigacoesAdministrativoClassificacao() {
  return useQuery({
    queryKey: [LIGACOES_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_administrativo_classificacao_link")
        .select(
          "id, classificacao_administrativa_id, classificacao_malote_id, " +
            "classificacao_administrativa:classificacao_administrativa_id(id, nome), " +
            "classificacao_malote:classificacao_malote_id(id, nome)"
        )
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as LigacaoAdministrativoClassificacao[];
    },
  });
}

interface SalvarLigacaoAdministrativoInput {
  id?: string;
  classificacao_administrativa_id: string;
  classificacao_malote_id: string;
}

export function useSalvarLigacaoAdministrativoClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarLigacaoAdministrativoInput) => {
      const { error } = await (supabase as any)
        .from("malote_administrativo_classificacao_link")
        .upsert(input, { onConflict: input.id ? "id" : "classificacao_administrativa_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIGACOES_KEY] }),
  });
}

// Cria várias ligações de uma vez (uma classificação administrativa por
// linha) pra UMA classificação do malote — mesmo motivo do equivalente em
// useMaloteLicitacaoClassificacaoLink.ts.
export function useSalvarLigacoesAdministrativoClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { classificacoes_administrativas_ids: string[]; classificacao_malote_id: string }) => {
      const payload = input.classificacoes_administrativas_ids.map((classificacao_administrativa_id) => ({
        classificacao_administrativa_id,
        classificacao_malote_id: input.classificacao_malote_id,
      }));
      const { error } = await (supabase as any).from("malote_administrativo_classificacao_link").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIGACOES_KEY] }),
  });
}

export function useExcluirLigacaoAdministrativoClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("malote_administrativo_classificacao_link").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIGACOES_KEY] }),
  });
}
