import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizarTarefas, separarTarefas, type LinhaPop, type Periodicidade, type StatusTarefa, type TarefaItem } from "@/lib/organograma/tarefas";

// =====================================================================
// Organograma › Tarefas por Função (SIS-2026-0771, mig 20261106001000).
// Tudo pelas RPCs tarefa_*. tarefa_minhas é lida ao entrar no sistema (lembrete
// e contador do topo): sem intervalo, só ao montar e a cada 5 min de cache.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "tarefas-funcao";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

export interface CargoOrganograma { cargo: string; pessoas: number; com_login: number }
export interface ModeloTarefa {
  id: string; titulo: string; descricao: string | null; area: string | null; setor: string | null;
  processo: string | null; processo_id: string | null; periodicidade: Periodicidade; dia_semana: number | null; dia_mes: number | null;
  criticidade: string | null; link: string | null; origem: "manual" | "planilha" | "estrutura"; ativo: boolean;
  cargos: string[]; pessoas: string[]; com_login: number; sem_login: number;
}
export interface MinhasTarefas { hoje: string; itens: TarefaItem[] }
export interface Acompanhamento extends MinhasTarefas { ve_todos: boolean }

export const useMinhasTarefas = (ligado = true) => useQuery({
  queryKey: [K, "minhas"], enabled: ligado, staleTime: 5 * 60_000, retry: false,
  queryFn: async (): Promise<MinhasTarefas> => {
    const { data, error } = await sb.rpc("tarefa_minhas");
    erro(error);
    return normalizarTarefas(data);
  },
});

/** Contador do topo: o que vence hoje mais o vencido, à vista depois que o lembrete é fechado. */
export function useContagemTarefas(ligado = true): number {
  const { data } = useMinhasTarefas(ligado);
  return useMemo(() => {
    if (!data) return 0;
    const s = separarTarefas(data.itens, data.hoje);
    return s.vencida.length + s.hoje.length;
  }, [data]);
}

export const useAcompanhamentoTarefas = (ini: string, fim: string) => useQuery({
  queryKey: [K, "acompanhamento", ini, fim], retry: false,
  queryFn: async (): Promise<Acompanhamento> => {
    const { data, error } = await sb.rpc("tarefa_acompanhamento", { p_ini: ini, p_fim: fim });
    erro(error);
    return normalizarTarefas<{ ve_todos?: boolean }>(data) as Acompanhamento;
  },
});

export const useModelosTarefa = (ligado: boolean) => useQuery({
  queryKey: [K, "modelos"], enabled: ligado,
  queryFn: async (): Promise<ModeloTarefa[]> => {
    const { data, error } = await sb.rpc("tarefa_modelos");
    erro(error);
    return (Array.isArray(data) ? data : []) as ModeloTarefa[];
  },
});

export const useCargosOrganograma = (ligado: boolean) => useQuery({
  queryKey: [K, "cargos"], enabled: ligado, staleTime: 5 * 60_000,
  queryFn: async (): Promise<CargoOrganograma[]> => {
    const { data, error } = await sb.rpc("tarefa_cargos");
    erro(error);
    return (Array.isArray(data) ? data : []) as CargoOrganograma[];
  },
});

function useMutacao<T, R>(fn: (p: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [K] }) });
}

export const useResolverTarefa = () => useMutacao(async (p: { id: string; status: StatusTarefa; obs?: string }) => {
  const { error } = await sb.rpc("tarefa_resolver", { p_id: p.id, p_status: p.status, p_obs: p.obs ?? null });
  erro(error);
});

export const useSalvarModelo = () => useMutacao(async (p: Record<string, unknown>) => {
  const { data, error } = await sb.rpc("tarefa_modelo_salvar", { p });
  erro(error);
  return data as string;
});

export const useImportarPops = () => useMutacao<LinhaPop[], { novos: number; atualizados: number }>(async (linhas) => {
  const { data, error } = await sb.rpc("tarefa_importar_planilha", { p_linhas: linhas });
  erro(error);
  return data as { novos: number; atualizados: number };
});

export const useImportarEstrutura = () => useMutacao<void, { novos: number; atualizados: number; ignorados: number }>(async () => {
  const { data, error } = await sb.rpc("tarefa_importar_estrutura");
  erro(error);
  return data as { novos: number; atualizados: number; ignorados: number };
});
