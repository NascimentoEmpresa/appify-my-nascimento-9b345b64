import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ClassificacaoAdministrativo {
  id: string;
  nome: string;
  ativo: boolean;
}

const KEY = "malote_classificacao_administrativo";

export function useClassificacoesAdministrativo() {
  return useQuery({
    queryKey: [KEY, "ativas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_classificacao_administrativo")
        .select("id, nome, ativo")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ClassificacaoAdministrativo[];
    },
  });
}

export function useClassificacoesAdministrativoAdmin() {
  return useQuery({
    queryKey: [KEY, "todas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_classificacao_administrativo")
        .select("id, nome, ativo")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ClassificacaoAdministrativo[];
    },
  });
}

interface SalvarClassificacaoAdministrativoInput {
  id?: string;
  nome: string;
  ativo: boolean;
}

export function useSalvarClassificacaoAdministrativo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarClassificacaoAdministrativoInput) => {
      const payload = { ...input, nome: input.nome.trim() };
      const { data, error } = await (supabase as any)
        .from("malote_classificacao_administrativo")
        .upsert(payload)
        .select("id, nome, ativo")
        .single();
      if (error) throw error;
      return data as ClassificacaoAdministrativo;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
