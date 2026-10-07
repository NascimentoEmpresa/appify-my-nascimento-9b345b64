import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PainelAtivos } from "@/pages/rh/conferenciaAtivos";

// =====================================================================
// RH › Ativos/Contratos — acesso a dados (RPCs rh_ac_*, migs 20260930000279 e 20261005000001).
// Tudo por RPC, nunca .from("EMPREGADOS"): a linha da EMPREGADOS carrega CPF,
// salário e conta bancária, e as RPCs devolvem só nome, cargo, posto e
// situação (mesmo motivo do useEspacoColaborador).
// =====================================================================

type ChamadaRpc = <T>(
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: T | null; error: { message: string } | null }>;
const sb = supabase as unknown as { rpc: ChamadaRpc };

export interface PessoaAtiva {
  empregado_id: number;
  cadastro: string | null;
  nome: string;
  cargo: string | null;
  posto_senior: string;
  situacao: string | null;
  admissao: string | null;
  local: string | null;
}

export function usePainelAtivosContratos() {
  return useQuery({
    queryKey: ["rh-ativos-contratos"],
    staleTime: 2 * 60_000,
    // Volta pelo menu com a tela já pintada (revalida em segundo plano).
    gcTime: 30 * 60_000,
    queryFn: async (): Promise<PainelAtivos> => {
      const { data, error } = await sb.rpc<PainelAtivos>("rh_ac_painel");
      if (error) throw error;
      return {
        gerado_em: data?.gerado_em ?? new Date().toISOString(),
        total_ativos: data?.total_ativos ?? 0,
        com_contrato: data?.com_contrato ?? 0,
        contratos: data?.contratos ?? [],
        todos_contratos: data?.todos_contratos ?? [],
        filiais_sem_contrato: data?.filiais_sem_contrato ?? [],
      };
    },
  });
}

/** Pessoas de um contrato — ou, com contratoId null, de uma filial sem contrato. */
export function usePessoasAtivas(contratoId: string | null, filial: string | null, ativo: boolean) {
  return useQuery({
    queryKey: ["rh-ativos-contratos", "pessoas", contratoId, filial],
    enabled: ativo && (!!contratoId || !!filial),
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<PessoaAtiva[]> => {
      const { data, error } = await sb.rpc<PessoaAtiva[]>("rh_ac_pessoas", {
        p_contrato_id: contratoId, p_filial: filial,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface ItemVinculo {
  posto_senior: string;
  planilha_postos: string[];
  ignorar: boolean;
}

export function useVincularPostos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, itens }: { contratoId: string; itens: ItemVinculo[] }) => {
      const { data, error } = await sb.rpc<number>("rh_ac_vincular_postos", {
        p_contrato_id: contratoId, p_itens: itens,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-ativos-contratos"] }),
  });
}

export function useVincularFilial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ filial, contratoId }: { filial: string; contratoId: string | null }) => {
      const { error } = await sb.rpc<null>("rh_ac_vincular_filial", {
        p_filial: filial, p_contrato_id: contratoId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-ativos-contratos"] }),
  });
}

/**
 * Move UM colaborador para um posto da planilha (mig 20261005000001).
 * posto: nome do posto → fica nele; "" → fora da conta; null → volta a valer
 * o posto da Senior.
 */
export function useMoverColaborador() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ empregadoId, posto }: { empregadoId: number; posto: string | null }) => {
      const { error } = await sb.rpc<null>("rh_ac_mover_colaborador", {
        p_empregado_id: empregadoId, p_planilha_posto: posto,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-ativos-contratos"] }),
  });
}
