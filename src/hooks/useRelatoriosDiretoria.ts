import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RelatorioDados, RelatorioGeralDados } from "@/pages/relatorios/sistemas";
import type { PainelTurnover, RescisoesTurnover } from "@/lib/diretoria/turnover";

// =====================================================================
// Diretoria › Relatórios — acesso a dados (mig 20261005000006).
// Tudo por RPC (dir_rel_*), que cobra o acesso no banco; a I.A pela Edge
// diretoria-ia, que relê o relatório com o JWT de quem pediu.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const CHAVE = "diretoria-relatorios";

/** Filtros comuns dos relatórios (mig 20261007000013): período, contrato (contratos.id) e meses (1–12). */
export interface FiltroRelatorio { de: string; ate: string; contrato: string | null; meses: number[] | null }
const argsFiltro = (f: FiltroRelatorio) => ({ _de: f.de, _ate: f.ate, _contrato: f.contrato, _meses: f.meses?.length ? f.meses : null });
const chaveFiltro = (f: FiltroRelatorio) => [f.de, f.ate, f.contrato, f.meses?.slice().sort((a, b) => a - b).join(",") ?? null];

export function useRelatorio(rpc: string, f: FiltroRelatorio, ativo = true) {
  return useQuery({
    queryKey: [CHAVE, rpc, ...chaveFiltro(f)],
    enabled: ativo,
    staleTime: 5 * 60_000,
    placeholderData: (anterior) => anterior,
    queryFn: async (): Promise<RelatorioDados> => {
      const { data, error } = await sb.rpc(rpc, argsFiltro(f));
      if (error) throw error;
      return data as RelatorioDados;
    },
  });
}

export function useRelatorioGeral(f: FiltroRelatorio) {
  return useQuery({
    queryKey: [CHAVE, "geral", ...chaveFiltro(f)],
    staleTime: 5 * 60_000,
    placeholderData: (anterior) => anterior,
    queryFn: async (): Promise<RelatorioGeralDados> => {
      const { data, error } = await sb.rpc("dir_rel_geral", argsFiltro(f));
      if (error) throw error;
      return data as RelatorioGeralDados;
    },
  });
}

/** Contratos para o filtro (ativos primeiro). */
export function useContratosRelatorio() {
  return useQuery({
    queryKey: [CHAVE, "contratos"],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<{ id: string; nome: string; encerrado: boolean }[]> => {
      const { data, error } = await sb.rpc("dir_rel_contratos");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Turn-over no formato do Power BI (mig 20261006000003). Filtros vão todos para a RPC. */
/** meses: null = ano inteiro; senão os meses escolhidos (1–12), em qualquer combinação (mig 20261007000003). */
export function useTurnoverPainel(f: { ano: number; meses: number[] | null; contrato: string | null; causas: string[] | null }) {
  return useQuery({
    queryKey: [CHAVE, "turnover-painel", f.ano, f.meses?.slice().sort((a, b) => a - b).join(",") ?? null, f.contrato, f.causas?.slice().sort().join("|") ?? null],
    staleTime: 5 * 60_000,
    placeholderData: (anterior) => anterior,
    queryFn: async (): Promise<PainelTurnover> => {
      const { data, error } = await sb.rpc("dir_turnover_painel", { _ano: f.ano, _meses: f.meses, _contrato: f.contrato, _causas: f.causas });
      if (error) throw error;
      return data as PainelTurnover;
    },
  });
}

/** Aba "Turnover em Valores" — por enquanto quantidades e perfil das rescisões (mig 20261007000006). */
export function useTurnoverRescisoes(f: { ano: number; meses: number[] | null; contrato: string | null }, ativo: boolean) {
  return useQuery({
    queryKey: [CHAVE, "turnover-rescisoes", f.ano, f.meses?.slice().sort((a, b) => a - b).join(",") ?? null, f.contrato],
    enabled: ativo,
    staleTime: 5 * 60_000,
    placeholderData: (anterior) => anterior,
    queryFn: async (): Promise<RescisoesTurnover> => {
      const { data, error } = await sb.rpc("dir_turnover_rescisoes", { _ano: f.ano, _meses: f.meses, _contrato: f.contrato });
      if (error) throw error;
      return data as RescisoesTurnover;
    },
  });
}

export type MsgIA ={ role: "user" | "assistant"; content: string };

/** Análise ("analise") ou pergunta livre ("pergunta") sobre o relatório. */
export function useAnaliseIA() {
  return useMutation({
    mutationFn: async (p: { sistema: string; de: string; ate: string; contrato?: string | null; meses?: number[] | null; modo: "analise" | "pergunta"; pergunta?: string; historico?: MsgIA[] }) => {
      const { data, error } = await supabase.functions.invoke("diretoria-ia", { body: p });
      if (error) {
        // A Edge devolve { error } com status != 2xx — tira a mensagem dela.
        let msg = error.message;
        try { const corpo = await (error as { context?: Response }).context?.json(); if (corpo?.error) msg = corpo.error; } catch { /* sem corpo */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return String(data?.texto ?? "");
    },
  });
}
