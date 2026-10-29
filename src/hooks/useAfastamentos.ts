import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AfastamentoItem, LinhaImportacao } from "@/lib/sst/afastamentos";

// =====================================================================
// SST › Afastamentos e Telemedicina (mig 20261029001750). Leitura e escrita
// só pelas RPCs sst_afa_* — a lotação, as coberturas e os valores do posto
// são resolvidos no banco; os valores só voltam para quem tem
// sst_afastamentos_financeiro.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "sst-afastamentos";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

export interface ColaboradorBusca { id: number; nome: string; cpf: string | null; situacao: string | null; filial: string | null; cargo: string | null; cadastro: number | null }

export interface Lotacao {
  situacao: string | null; contrato_id: string | null; contrato_nome: string | null; filial_nome: string | null;
  posto_senior: string | null; posto_planilha: string | null; eh_rt: boolean; cargo: string | null; escala: string | null;
  rt_no_contrato: number; valor_mensal_posto?: number | null; salario?: number | null; custo_mensal_posto?: number | null;
  lucro_mensal?: number | null; planilha_vigencia?: string | null;
}

export interface Cobertura { dia: string; fonte: "efetividade" | "diaria" | "registro"; substituto: string | null; eh_rt: boolean; valor: number | null }
export interface Despesa { id: number; tipo: string; data: string; dias: number; substituto_nome: string | null; horas: number | null; valor: number; descricao: string | null; created_by_nome: string | null }
export interface EventoAfa { id: number; tipo: string; descricao: string | null; autor_nome: string | null; created_at: string }
export interface NotaContrato { competencia: string; numero_nf: string | null; status: string; bruto: number; liquido: number; faltas: number; glosas: number; outros_descontos: number }

export interface FichaAfastamento {
  afastamento: AfastamentoItem & Record<string, unknown>;
  data_fim: string;
  ve_financeiro: boolean;
  empregado: { situacao: string | null; data_afastamento: string | null; admissao: string | null; telefone: string | null } | null;
  coberturas: Cobertura[];
  despesas: Despesa[];
  eventos: EventoAfa[];
  rt: { quantidade: number; colaboradores: string[] };
  historico_colaborador: { id: number; protocolo: string; data_inicio: string; dias: number | null; tele_status: string }[];
  financeiro?: { valor_mensal_posto: number | null; salario: number | null; custo_mensal_posto: number | null; lucro_mensal: number | null; planilha_vigencia: string | null; glosa_valor: number | null; glosa_obs: string | null } | null;
  notas?: NotaContrato[];
}

export const useListaAfastamentos = (ini: string, fim: string) => useQuery({
  queryKey: [K, "lista", ini, fim],
  queryFn: async (): Promise<{ ve_financeiro: boolean; itens: AfastamentoItem[] }> => {
    const { data, error } = await sb.rpc("sst_afa_lista", { p_ini: ini, p_fim: fim });
    erro(error);
    return { ve_financeiro: !!data?.ve_financeiro, itens: (data?.itens ?? []) as AfastamentoItem[] };
  },
});

export const useFichaAfastamento = (id: number | null) => useQuery({
  queryKey: [K, "ficha", id], enabled: id != null,
  queryFn: async (): Promise<FichaAfastamento | null> => {
    const { data, error } = await sb.rpc("sst_afa_ficha", { p_id: id });
    erro(error);
    return data as FichaAfastamento | null;
  },
});

export async function buscarColaboradores(busca: string): Promise<ColaboradorBusca[]> {
  const { data, error } = await sb.rpc("sst_afa_colaboradores", { p_busca: busca });
  erro(error);
  return (data ?? []) as ColaboradorBusca[];
}

export async function previaLotacao(empregadoId: number, data: string): Promise<Lotacao | null> {
  const { data: l, error } = await sb.rpc("sst_afa_lotacao", { p_empregado_id: empregadoId, p_data: data || null });
  erro(error);
  return l as Lotacao | null;
}

function useMutacao<T, R>(fn: (p: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [K] }) });
}

export const useSalvarAfastamento = () => useMutacao(async (p: Record<string, unknown>) => {
  const { data, error } = await sb.rpc("sst_afa_salvar", { p });
  erro(error);
  return Number(data);
});

export const useRecalcularLotacao = () => useMutacao(async (id: number) => {
  const { error } = await sb.rpc("sst_afa_recalcular_lotacao", { p_id: id });
  erro(error);
});

export const useSalvarDespesa = () => useMutacao(async (p: Record<string, unknown>) => {
  const { error } = await sb.rpc("sst_afa_despesa_salvar", { p });
  erro(error);
});

export const useRemoverDespesa = () => useMutacao(async (id: number) => {
  const { error } = await sb.rpc("sst_afa_despesa_remover", { p_id: id });
  erro(error);
});

export const useSalvarGlosa = () => useMutacao(async (p: { id: number; valor: number | null; obs: string }) => {
  const { error } = await sb.rpc("sst_afa_glosa_salvar", { p_id: p.id, p_valor: p.valor, p_obs: p.obs });
  erro(error);
});

export const useImportarPlanilha = () => useMutacao(async (linhas: LinhaImportacao[]) => {
  // Em lotes: cada linha resolve a lotação no banco.
  const total = { inseridos: 0, atualizados: 0, sem_cadastro: [] as string[] };
  for (let i = 0; i < linhas.length; i += 150) {
    const { data, error } = await sb.rpc("sst_afa_importar", { p_linhas: linhas.slice(i, i + 150) });
    erro(error);
    total.inseridos += data?.inseridos ?? 0;
    total.atualizados += data?.atualizados ?? 0;
    total.sem_cadastro.push(...((data?.sem_cadastro ?? []) as string[]));
  }
  total.sem_cadastro = [...new Set(total.sem_cadastro)].sort();
  return total;
});

export const useCapturarSenior = () => useMutacao<void, { novos: number; retornos: number; desligados: number }>(async () => {
  const { data, error } = await sb.rpc("sst_afa_capturar_senior");
  erro(error);
  return data as { novos: number; retornos: number; desligados: number };
});
