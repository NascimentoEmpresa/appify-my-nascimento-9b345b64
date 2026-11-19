import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LinhaCronograma, LinhaPlano, Obrigatorio, OnlineResumo, ResultadoImportacaoTrn, Turma } from "@/lib/sst/treinamentosNr";

// =====================================================================
// SST › Treinamentos Obrigatórios (NR) (SIS-2026-0816, mig 20261121100000).
// Matriz (SST_TRN_OBRIGATORIO), turmas (SST_TRN_TURMA) e o resumo dos
// cursos online liberados por contrato — tudo por RPC sst_trn_*.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "sst-trn-nr";
export const MENU_TREINAMENTOS_NR = "sst_treinamentos_nr";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

export const useObrigatorios = () => useQuery({
  queryKey: [K, "obrigatorios"],
  queryFn: async (): Promise<Obrigatorio[]> => {
    const { data, error } = await sb.rpc("sst_trn_obrig_lista");
    erro(error);
    return (data ?? []) as Obrigatorio[];
  },
});

export const useTurmas = (ano: number | null) => useQuery({
  queryKey: [K, "turmas", ano],
  queryFn: async (): Promise<Turma[]> => {
    const { data, error } = await sb.rpc("sst_trn_turma_lista", { p_ano: ano });
    erro(error);
    return (data ?? []) as Turma[];
  },
});

export const useOnlineResumo = () => useQuery({
  queryKey: [K, "online"],
  staleTime: 5 * 60_000,
  queryFn: async (): Promise<OnlineResumo> => {
    const { data, error } = await sb.rpc("sst_trn_online_resumo");
    erro(error);
    return data as OnlineResumo;
  },
});

export const useContratosTrn = () => useQuery({
  queryKey: [K, "contratos"],
  staleTime: 10 * 60_000,
  queryFn: async (): Promise<{ id: string; nome: string }[]> => {
    const { data, error } = await sb.rpc("sst_trn_contratos");
    erro(error);
    return (data ?? []) as { id: string; nome: string }[];
  },
});

function useEscrita<T, R>(fn: (v: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [K] }) });
}

export type SalvarObrigatorio = Partial<Omit<Obrigatorio, "status" | "validade" | "contrato_nome" | "origem" | "updated_at">> &
  Pick<Obrigatorio, "contrato_texto" | "treinamento">;
export const useSalvarObrigatorio = () => useEscrita(async (p: SalvarObrigatorio) => {
  const { data, error } = await sb.rpc("sst_trn_obrig_salvar", { p });
  erro(error);
  return data as number;
});
export const useExcluirObrigatorio = () => useEscrita(async (id: number) => {
  const { error } = await sb.rpc("sst_trn_obrig_excluir", { p_id: id });
  erro(error);
});

export type SalvarTurma = Partial<Omit<Turma, "contrato_nome" | "origem">> & Pick<Turma, "contrato_texto">;
export const useSalvarTurma = () => useEscrita(async ({ turma, obrigatorios }: { turma: SalvarTurma; obrigatorios: number[] }) => {
  const { data, error } = await sb.rpc("sst_trn_turma_salvar", { p: turma, p_obrigatorios: obrigatorios.length ? obrigatorios : null });
  erro(error);
  return data as { id: number; obrigatorios_atualizados: number };
});
export const useExcluirTurma = () => useEscrita(async (id: number) => {
  const { error } = await sb.rpc("sst_trn_turma_excluir", { p_id: id });
  erro(error);
});

export function useImportarTrn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tipo, linhas, simular }: { tipo: "plano" | "cronograma"; linhas: (LinhaPlano | LinhaCronograma)[]; simular: boolean }) => {
      const { data, error } = await sb.rpc("sst_trn_importar", { p_tipo: tipo, p_linhas: linhas, p_simular: simular });
      erro(error);
      return data as ResultadoImportacaoTrn;
    },
    onSuccess: (_d, v) => { if (!v.simular) qc.invalidateQueries({ queryKey: [K] }); },
  });
}
