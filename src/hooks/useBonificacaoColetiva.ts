// Bonificação Coletiva da equipe de Sistemas (mig 20261105004700).
// Leitura: RPC bonificacao_dev_entregas (o mês) + BONIFICACAO_DEV_PERIODO
// (todos os meses, poucas linhas). Escrita: upsert direto nas tabelas — a RLS
// e os gatilhos (período fechado) decidem. Regras de conta em
// src/lib/sistemas/bonificacaoColetiva.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  entregaDaLinha,
  intervaloDaCompetencia,
  intervaloDaEquipe,
  type Dificuldade,
  type EntregaDetalhada,
  type LinhaEntregaRpc,
  type LinhaPeriodo,
  type Qualidade,
} from "@/lib/sistemas/bonificacaoColetiva";

// As tabelas/RPC novas ainda não estão no types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const CHAVE = "bonificacao-coletiva";

export function useEntregasBonificacao(mes: string) {
  return useQuery({
    queryKey: [CHAVE, "entregas", mes],
    staleTime: 60 * 1000,
    queryFn: async (): Promise<EntregaDetalhada[]> => {
      const { inicio, fim } = intervaloDaCompetencia(mes);
      const { data, error } = await db.rpc("bonificacao_dev_entregas", { p_inicio: inicio, p_fim: fim });
      if (error) throw new Error(error.message);
      return ((data ?? []) as LinhaEntregaRpc[]).map(entregaDaLinha);
    },
  });
}

/**
 * Quem é da equipe: responsáveis por chamado concluído nos últimos meses
 * (intervaloDaEquipe). Mesma RPC das entregas, só que num intervalo maior —
 * sem migration nova. Serve para mostrar com 0 quem não entregou no mês.
 */
export function useEquipeBonificacao(mes: string) {
  return useQuery({
    queryKey: [CHAVE, "equipe", mes],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ devId: string; devNome: string }[]> => {
      const { inicio, fim } = intervaloDaEquipe(mes);
      const { data, error } = await db.rpc("bonificacao_dev_entregas", { p_inicio: inicio, p_fim: fim });
      if (error) throw new Error(error.message);
      const porId = new Map<string, string>();
      for (const e of ((data ?? []) as LinhaEntregaRpc[]).map(entregaDaLinha)) porId.set(e.devId, e.devNome);
      return [...porId].map(([devId, devNome]) => ({ devId, devNome })).sort((a, b) => a.devNome.localeCompare(b.devNome, "pt-BR"));
    },
  });
}

export function usePeriodosBonificacao() {
  return useQuery({
    queryKey: [CHAVE, "periodos"],
    staleTime: 60 * 1000,
    queryFn: async (): Promise<LinhaPeriodo[]> => {
      const { data, error } = await db
        .from("BONIFICACAO_DEV_PERIODO")
        .select("*")
        .order("competencia", { ascending: false })
        .limit(240);
      if (error) throw new Error(error.message);
      return (data ?? []) as LinhaPeriodo[];
    },
  });
}

/** Grava (cria ou atualiza) a linha do mês — verba, pesos, dificuldade, referência, fechamento. */
export function useSalvarPeriodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linha: Partial<LinhaPeriodo> & { competencia: string }) => {
      const { error } = await db.from("BONIFICACAO_DEV_PERIODO").upsert(linha, { onConflict: "competencia" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE, "periodos"] }),
  });
}

export interface AvaliacaoEntrega {
  chamado_id: string;
  qualidade: Qualidade | null;
  dificuldade: Dificuldade | null;
  valor_mercado: number | null;
  valor_freelancer: number | null;
  valor_clt: number | null;
  fora_da_bonificacao: boolean;
  motivo_exclusao: string | null;
  observacao: string | null;
}

export function useSalvarAvaliacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: AvaliacaoEntrega) => {
      const { error } = await db.from("BONIFICACAO_DEV_ENTREGA").upsert(a, { onConflict: "chamado_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE, "entregas"] }),
  });
}

/** Volta a entrega para as sugestões (apaga a avaliação do gestor). */
export function useLimparAvaliacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chamadoId: string) => {
      const { error } = await db.from("BONIFICACAO_DEV_ENTREGA").delete().eq("chamado_id", chamadoId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE, "entregas"] }),
  });
}

/**
 * Pede o parecer da IA (dificuldade + valores) pela MESMA Edge da tela do
 * chamado — chamado-parecer-ia. O portão é dela: gestão de chamados ou o
 * responsável, e só com o chamado concluído com horas informadas.
 */
export function useGerarParecerIa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chamadoId: string) => {
      const { data, error } = await supabase.functions.invoke("chamado-parecer-ia", { body: { chamado_id: chamadoId } });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const corpo = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
        throw new Error(corpo?.error ?? error.message);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CHAVE, "entregas"] });
      qc.invalidateQueries({ queryKey: ["chamado-parecer-ia"] });
    },
  });
}
