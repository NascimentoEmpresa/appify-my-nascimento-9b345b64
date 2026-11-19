import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  paramsDaLista, type AsoHistorico, type FiltrosAsoHistorico, type LinhaAsoPlanilha, type ResultadoImportacaoAsos,
  type ResumoAsoHistorico, type SituacaoAso, type TipoAso,
} from "@/lib/sst/asoHistorico";

// =====================================================================
// SST › ASOs Realizados (SIS-2026-0816, mig 20261121100000). Tudo pelas
// RPCs sst_aso_hist_*: a tabela guarda CPF e não tem leitura direta.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "sst-aso-historico";
export const MENU_ASOS_REALIZADOS = "sst_asos_realizados";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

export interface ListaAsoHistorico { total: number; itens: AsoHistorico[]; resumo: ResumoAsoHistorico }
export interface ColaboradorAso { empregado_id: number; nome: string; empresa_codigo: string | null; desligado: boolean }

/** Lista com os filtros aplicados no banco (a planilha tem ~9.500 linhas): no máximo `limite`. */
export const useListaAsoHistorico = (f: FiltrosAsoHistorico, limite = 300) => useQuery({
  queryKey: [K, "lista", f, limite],
  placeholderData: (anterior) => anterior,
  queryFn: async (): Promise<ListaAsoHistorico> => {
    const { data, error } = await sb.rpc("sst_aso_hist_lista", paramsDaLista(f, limite));
    erro(error);
    return data as ListaAsoHistorico;
  },
});

export async function buscarColaboradoresAso(busca: string): Promise<ColaboradorAso[]> {
  const { data, error } = await sb.rpc("sst_aso_hist_colaboradores", { p_busca: busca });
  erro(error);
  return (data ?? []) as ColaboradorAso[];
}

export interface SalvarAso {
  id?: number;
  empregado_id?: number | null;
  tipo: TipoAso;
  situacao: SituacaoAso;
  data_solicitacao: string | null;
  data_realizacao: string | null;
  empresa: string | null;
  filial_texto: string | null;
  solicitado_por: string | null;
  clinica: string | null;
  observacoes: string | null;
}

export function useSalvarAso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: SalvarAso) => {
      const { data, error } = await sb.rpc("sst_aso_hist_salvar", { p });
      erro(error);
      return data as number;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K] }),
  });
}

export function useExcluirAso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.rpc("sst_aso_hist_excluir", { p_id: id });
      erro(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K] }),
  });
}

export function useImportarAsos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ linhas, simular }: { linhas: LinhaAsoPlanilha[]; simular: boolean }) => {
      const { data, error } = await sb.rpc("sst_aso_hist_importar", { p_linhas: linhas, p_simular: simular });
      erro(error);
      return data as ResultadoImportacaoAsos;
    },
    onSuccess: (_d, v) => { if (!v.simular) qc.invalidateQueries({ queryKey: [K] }); },
  });
}
