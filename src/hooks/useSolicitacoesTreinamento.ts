import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AcaoTreinamentos, EventoSolTreinamento, SolicitacaoTreinamento } from "@/lib/treinamentos/solicitacaoTreinamento";

// =====================================================================
// Solicitação de Treinamento (mig 20261026000910) — o encarregado pede
// (Encarregados › Solicitar Treinamento), Treinamentos decide
// (Treinamentos › Solicitações de Treinamentos). Leitura direta (RLS: quem
// pediu vê as dele; Treinamentos vê todas); escrita só pelas RPCs trn_sol_*.
// A conversa é o SISTEMA_COMENTARIOS (modulo 'treinamento'), pelo
// ConversaSolicitacao.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "trn-solicitacoes";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

export interface ContratoTreinamento { empresa: number; filial: number; nome: string; meu: boolean }
export interface OpcoesTreinamento { eu: { nome: string | null; email: string | null }; contratos: ContratoTreinamento[] }

export const useOpcoesTreinamento = () => useQuery({
  queryKey: [K, "opcoes"], staleTime: 10 * 60_000,
  queryFn: async (): Promise<OpcoesTreinamento> => {
    const { data, error } = await sb.rpc("trn_sol_opcoes");
    erro(error);
    return { eu: data?.eu ?? { nome: null, email: null }, contratos: data?.contratos ?? [] };
  },
});

/** `minhas`: só as de quem está logado (tela do encarregado). */
export const useSolicitacoesTreinamento = (f: { minhas?: boolean } = {}) => useQuery({
  queryKey: [K, "lista", f.minhas ?? false],
  queryFn: async (): Promise<SolicitacaoTreinamento[]> => {
    let q = sb.from("TRN_SOLICITACAO").select("*").order("created_at", { ascending: false });
    if (f.minhas) { const { data: u } = await supabase.auth.getUser(); q = q.eq("solicitante_id", u.user?.id ?? ""); }
    const { data, error } = await q.limit(1000);
    erro(error);
    return data ?? [];
  },
});

export const useEventosTreinamento = (id: number | null) => useQuery({
  queryKey: [K, "eventos", id], enabled: id != null,
  queryFn: async (): Promise<EventoSolTreinamento[]> => {
    const { data, error } = await sb.from("TRN_SOLICITACAO_EVENTO").select("*").eq("solicitacao_id", id).order("created_at");
    erro(error);
    return data ?? [];
  },
});

export function useEnviarTreinamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { dados: Record<string, unknown>; reenviarId?: number | null }) => {
      if (p.reenviarId) {
        const { error } = await sb.rpc("trn_sol_reenviar", { p_id: p.reenviarId, p: p.dados });
        erro(error);
        return { id: p.reenviarId, protocolo: null as string | null };
      }
      const { data, error } = await sb.rpc("trn_sol_criar", { p: p.dados });
      erro(error);
      return { id: Number(data?.id), protocolo: (data?.protocolo as string) ?? null };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K] }),
  });
}

export type AcaoTreinamento = AcaoTreinamentos;

export function useDecidirTreinamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: number; acao: AcaoTreinamento; motivo?: string; data_confirmada?: string; horario_confirmado?: string; instrutor?: string; obs?: string }) => {
      const { id, acao, ...resto } = p;
      const { error } = await sb.rpc("trn_sol_decidir", { p_id: id, p_acao: acao, p: resto });
      erro(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K] }),
  });
}

/** Quem pediu aprova a data que Treinamentos informou, ou pede outra (motivo
 *  obrigatório — volta para Treinamentos informar de novo). Mig 20261027000120. */
export function useResponderDataTreinamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: number; aprovar: boolean; motivo?: string }) => {
      const { error } = await sb.rpc("trn_sol_responder_data", { p_id: p.id, p_aprovar: p.aprovar, p_motivo: p.motivo ?? null });
      erro(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K] }),
  });
}
