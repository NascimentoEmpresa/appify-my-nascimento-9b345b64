import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BasePonte, SituacaoPlanilha, SituacaoPlanilhaMes } from "@/pages/financeiro/conciliacao-origem/regras";

// SIS-2026-0658: resumo da planilha do Fluxo de Caixa (em uso / ocultas / excluídas). Função da migration
// 20261015000020; sem ela (ainda não aplicada) a tela segue sem esse bloco.
export function useConciliacaoPlanilhaFluxo() {
  return useQuery({
    queryKey: ["conciliacao_fluxo_planilha_resumo"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conciliacao_fluxo_planilha_resumo");
      if (error) {
        if (error.code === "42883" || error.code === "PGRST202") return null;
        throw error;
      }
      return ((data ?? []) as any[]).map((r) => ({
        situacao: r.situacao as string,
        qtd: Number(r.qtd) || 0,
        entradas: Number(r.entradas) || 0,
        saidas: Number(r.saidas) || 0,
      })) as SituacaoPlanilha[];
    },
  });
}

// SIS-2026-0701: a planilha do Fluxo mês a mês (migration 20261021000045). Sem ela aplicada, a tela segue sem a ponte.
export function useConciliacaoPlanilhaPorMes(base: BasePonte) {
  return useQuery({
    queryKey: ["conciliacao_fluxo_planilha_por_mes", base],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conciliacao_fluxo_planilha_por_mes", { _base: base });
      if (error) {
        if (error.code === "42883" || error.code === "PGRST202") return null;
        throw error;
      }
      return ((data ?? []) as any[]).map((r) => ({
        mes: String(r.mes),
        situacao: r.situacao as string,
        qtd: Number(r.qtd) || 0,
        entradas: Number(r.entradas) || 0,
        saidas: Number(r.saidas) || 0,
      })) as SituacaoPlanilhaMes[];
    },
  });
}

export interface LinhaPlanilhaDoMes {
  planilha_linha: number;
  planilha_id_original: string | null;
  situacao: string;
  tipo: "entrada" | "saida";
  data_pagamento: string;
  competencia: string;
  classificacao_texto: string | null;
  contrato_texto: string | null;
  descricao: string | null;
  banco_texto: string | null;
  valor: number;
  observacao: string | null;
}

export async function lerLinhasPlanilhaDoMes(mes: string, base: BasePonte): Promise<LinhaPlanilhaDoMes[]> {
  // PostgREST devolve no máximo 1.000 linhas por chamada e um mês da planilha passa disso (jan/26 tem mais de 2.000).
  const linhas: LinhaPlanilhaDoMes[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await (supabase as any)
      .rpc("conciliacao_fluxo_planilha_linhas", { _mes: `${mes}-01`, _situacao: null, _base: base })
      .range(de, de + 999);
    if (error) throw error;
    linhas.push(...((data ?? []) as any[]).map((r) => ({ ...r, valor: Number(r.valor) || 0 }) as LinhaPlanilhaDoMes));
    if (!data || data.length < 1000) break;
  }
  return linhas;
}

// SIS-2026-0701: linhas da planilha em uso que o Fluxo lê diferente (valor, entrada/saída ou mês ajustados depois da carga).
export interface DiferencaPlanilhaFluxo {
  planilha_linha: number;
  planilha_id_original: string | null;
  despesa_id: string;
  id_malote: string | null;
  descricao: string | null;
  tipo_planilha: "entrada" | "saida";
  valor_planilha: number;
  data_planilha: string;
  competencia_planilha: string;
  tipo_erp: "entrada" | "saida";
  valor_erp: number;
  data_erp: string;
  competencia_erp: string;
  motivo: string;
}

export function useDiferencasPlanilhaFluxo(mes: string | null, base: BasePonte) {
  return useQuery({
    queryKey: ["conciliacao_fluxo_planilha_diferencas", mes, base],
    enabled: !!mes,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conciliacao_fluxo_planilha_diferencas", { _mes: `${mes}-01`, _base: base });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({ ...r, valor_planilha: Number(r.valor_planilha) || 0, valor_erp: Number(r.valor_erp) || 0 })) as DiferencaPlanilhaFluxo[];
    },
  });
}

// Todas as linhas ajustadas de todos os meses (uma chamada), para a ponte mostrar quanto da diferença de cada mês elas explicam.
export function useDiferencasPlanilhaTodas(base: BasePonte) {
  return useQuery({
    queryKey: ["conciliacao_fluxo_planilha_diferencas_todas", base],
    staleTime: 30_000,
    queryFn: async () => {
      const linhas: DiferencaPlanilhaFluxo[] = [];
      for (let de = 0; ; de += 1000) {
        const { data, error } = await (supabase as any).rpc("conciliacao_fluxo_planilha_diferencas", { _mes: null, _base: base }).range(de, de + 999);
        if (error) {
          if (error.code === "42883" || error.code === "PGRST202") return null;
          throw error;
        }
        linhas.push(...((data ?? []) as any[]).map((r) => ({ ...r, valor_planilha: Number(r.valor_planilha) || 0, valor_erp: Number(r.valor_erp) || 0 }) as DiferencaPlanilhaFluxo));
        if (!data || data.length < 1000) break;
      }
      return linhas;
    },
  });
}
