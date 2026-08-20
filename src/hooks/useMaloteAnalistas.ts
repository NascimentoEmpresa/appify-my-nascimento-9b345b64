import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0170: vínculo analista<->contrato — o "analista" é um usuário
// real do sistema (auth.users/profiles), não um catálogo à parte (ver
// 20260909000002_malote_analista_usuario_real.sql: sem filtro de cargo no
// picker, porque já existe exceção conhecida — profiles.cargo é só
// informação auxiliar, resolvida no componente via useAprovadoresDisponiveis()
// sem slot). Só as telas de cadastro por enquanto, sem enforcement do
// fluxo de justificativa.
export interface MaloteAnalistaContrato {
  id: string;
  ativo: boolean;
  analista_user_id: string;
  contrato: {
    id: string;
    nome: string;
    empresa_id: string;
    empresa: { razao_social: string; nome_fantasia: string | null } | null;
  } | null;
}

const VINCULOS_KEY = "malote_analista_contrato";

export function useAnalistasContrato() {
  return useQuery({
    queryKey: [VINCULOS_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_analista_contrato")
        .select(
          "id, ativo, analista_user_id, contrato:contrato_id(id, nome, empresa_id, empresa:empresa_id(razao_social, nome_fantasia))"
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MaloteAnalistaContrato[];
    },
  });
}

interface SalvarAnalistaContratoInput {
  id?: string;
  analista_user_id: string;
  contrato_id: string;
  ativo: boolean;
}

export function useSalvarAnalistaContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarAnalistaContratoInput) => {
      const { error } = await (supabase as any).from("malote_analista_contrato").upsert(input);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [VINCULOS_KEY] }),
  });
}

// SIS-2026-0192: contratos em que o usuário logado é Analista ativo — via
// RPC SECURITY DEFINER porque malote_analista_contrato tem SELECT
// restrito a admin/controladoria/diretor_adm (um Analista comum não lê a
// própria linha de vínculo direto).
export function useMeusContratosAnalista() {
  return useQuery({
    queryKey: [VINCULOS_KEY, "meus_contratos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("malote_meus_contratos_analista");
      if (error) throw error;
      return new Set<string>((data ?? []) as string[]);
    },
  });
}

export function useExcluirAnalistaContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("malote_analista_contrato").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [VINCULOS_KEY] }),
  });
}
