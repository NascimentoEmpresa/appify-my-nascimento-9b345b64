import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0927: unificar lançamentos do Fluxo de Caixa (migration 20261117240000). As tabelas e RPCs ainda não estão nos tipos gerados do
// Supabase; o cast fica só aqui. Erro do Supabase é objeto simples (não Error): quem chama lê `.message`.
const cliente = supabase as unknown as SupabaseClient;

function invalidarFluxo(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
  qc.invalidateQueries({ queryKey: ["fluxo_caixa_malote"] });
  qc.invalidateQueries({ queryKey: ["fluxo_unificacao"] });
}

export function useUnificarLancamentos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itens: { origem: string; despesa_id: string }[]): Promise<string> => {
      const { data, error } = await cliente.rpc("fluxo_caixa_unificar", { _itens: itens });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidarFluxo(qc),
  });
}

export function useRatearUnificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { unificacaoId: string; cotas: { classificacao_id: string; contrato_id: string | null; integrante_empregado_id: number | null; valor: number }[] }) => {
      const { error } = await cliente.rpc("fluxo_caixa_unificacao_ratear", { _unificacao_id: i.unificacaoId, _cotas: i.cotas });
      if (error) throw error;
    },
    onSuccess: () => invalidarFluxo(qc),
  });
}

export function useDesfazerUnificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { unificacaoId: string; motivo: string }) => {
      const { error } = await cliente.rpc("fluxo_caixa_unificacao_desfazer", { _unificacao_id: i.unificacaoId, _motivo: i.motivo });
      if (error) throw error;
    },
    onSuccess: () => invalidarFluxo(qc),
  });
}

export interface UnificacaoDetalhe {
  cabecalho: { id: string; numero: string; empresa_id: string; valor_total: number; data_pagamento: string; ativa: boolean; created_at: string; motivo_desfeita: string | null };
  originais: { id: string; origem: string; despesa_id: string; id_malote: string | null; descricao: string | null; valor: number; detalhe: { classificacao: string | null; contrato: string; valor: number }[] | null }[];
  cotas: { id: string; classificacao_id: string | null; contrato_id: string | null; integrante_empregado_id: number | null; valor: number; ordem: number; classificacao_nome: string | null; contrato_nome: string | null }[];
  eventos: { id: string; tipo: string; descricao: string | null; detalhe: unknown; usuario_nome: string | null; created_at: string }[];
}

/** Cabeçalho, lançamentos originais, rateio atual e histórico de uma unificação. */
export function useUnificacaoDetalhe(unificacaoId: string | null | undefined) {
  return useQuery({
    queryKey: ["fluxo_unificacao", unificacaoId],
    enabled: !!unificacaoId,
    queryFn: async (): Promise<UnificacaoDetalhe> => {
      const id = String(unificacaoId);
      const [cab, ori, cot, evt] = await Promise.all([
        cliente.from("FLUXO_UNIFICACAO").select("id, numero, empresa_id, valor_total, data_pagamento, ativa, created_at, motivo_desfeita").eq("id", id).single(),
        cliente.from("FLUXO_UNIFICACAO_ORIGEM").select("id, origem, despesa_id, id_malote, descricao, valor, detalhe").eq("unificacao_id", id).order("id_malote"),
        cliente
          .from("FLUXO_UNIFICACAO_COTA")
          .select("id, classificacao_id, contrato_id, integrante_empregado_id, valor, ordem, planejamento_orcamentario_classificacao(nome), contratos(nome)")
          .eq("unificacao_id", id)
          .order("ordem"),
        cliente.from("FLUXO_UNIFICACAO_EVENTO").select("id, tipo, descricao, detalhe, usuario_nome, created_at").eq("unificacao_id", id).order("created_at", { ascending: false }),
      ]);
      for (const r of [cab, ori, cot, evt]) if (r.error) throw r.error;
      type CotaBruta = Omit<UnificacaoDetalhe["cotas"][number], "classificacao_nome" | "contrato_nome"> & {
        planejamento_orcamentario_classificacao: { nome: string } | null;
        contratos: { nome: string } | null;
      };
      return {
        cabecalho: cab.data as UnificacaoDetalhe["cabecalho"],
        originais: (ori.data ?? []) as UnificacaoDetalhe["originais"],
        cotas: ((cot.data ?? []) as unknown as CotaBruta[]).map((c) => ({
          id: c.id, classificacao_id: c.classificacao_id, contrato_id: c.contrato_id, integrante_empregado_id: c.integrante_empregado_id,
          valor: Number(c.valor), ordem: c.ordem,
          classificacao_nome: c.planejamento_orcamentario_classificacao?.nome ?? null, contrato_nome: c.contratos?.nome ?? null,
        })),
        eventos: (evt.data ?? []) as UnificacaoDetalhe["eventos"],
      };
    },
  });
}
