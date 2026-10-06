import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// =====================================================================
// SIS-2026-0598 — Sistemas › Logins (Admissão e Demissão), mig 20261006000009.
//   · Admissão: vaga de encarregado com "precisa de login" concluída no
//     kanban vira um pedido com e-mail sugerido e senha aleatória; Sistemas
//     cria a conta e marca "criado"; quem pediu a vaga vê em Minhas
//     Solicitações e confirma que repassou (a senha some do banco).
//   · Demissão: demitido com login ainda ativo, para excluir.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "sis-logins";

export type StatusPedido = "pendente" | "criado" | "entregue" | "cancelado";
export interface PedidoLogin {
  id: string; vaga_id: number | null; candidato_id: number | null; nome: string; cpf: string | null;
  contrato: string | null; cargo: string | null; email_sugerido: string; senha: string | null;
  solicitante_email: string | null; solicitante_nome: string | null; status: StatusPedido;
  login_email: string | null; criado_por_nome: string | null; criado_em: string | null; entregue_em: string | null;
  obs: string | null; created_at: string;
}
export interface DemitidoComLogin {
  empregado_id: number; auth_user_id: string; nome: string; cargo: string | null; contrato: string | null; empresa: string | null;
  desligamento: string | null; login_email: string; ultimo_acesso: string | null;
  tratado: "excluido" | "mantido" | null; tratado_em: string | null; tratado_por: string | null;
}
export interface MinhaCredencial {
  id: string; vaga_id: number | null; nome: string; cargo: string | null; contrato: string | null;
  login_email: string; senha: string | null; criado_em: string;
}

const invalidar = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: [K] });
  qc.invalidateQueries({ queryKey: ["aprovacoes-notif"] });
};

export const usePedidosLogin = () => useQuery({
  queryKey: [K, "pedidos"], staleTime: 30_000,
  queryFn: async (): Promise<PedidoLogin[]> => {
    const { data, error } = await sb.from("SIS_LOGIN_PEDIDO").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    return data ?? [];
  },
});

export const useDemitidosComLogin = () => useQuery({
  queryKey: [K, "demitidos"], staleTime: 30_000,
  queryFn: async (): Promise<DemitidoComLogin[]> => {
    const { data, error } = await sb.rpc("sis_logins_demitidos");
    if (error) throw error;
    return data ?? [];
  },
});

export function useMarcarLoginCriado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; login: string; senha: string }) => {
      const { error } = await sb.rpc("sis_login_marcar_criado", { p_id: p.id, p_login: p.login, p_senha: p.senha });
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc),
  });
}

export function useCancelarPedidoLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; obs: string }) => {
      const { error } = await sb.rpc("sis_login_cancelar", { p_id: p.id, p_obs: p.obs });
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc),
  });
}

export function useTratarDesligamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { auth_user_id: string; empregado_id: number; acao: "excluido" | "mantido"; obs: string }) => {
      const { error } = await sb.rpc("sis_login_desligamento_tratar", {
        p_auth_user_id: p.auth_user_id, p_empregado_id: p.empregado_id, p_acao: p.acao, p_obs: p.obs,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc),
  });
}

/** Quem pediu a vaga: os logins prontos das vagas dele (RPC filtra pelo e-mail do login). */
export const useMinhasCredenciais = () => useQuery({
  queryKey: [K, "minhas"], staleTime: 60_000,
  queryFn: async (): Promise<MinhaCredencial[]> => {
    const { data, error } = await sb.rpc("minhas_credenciais_login");
    if (error) return []; // banco sem a migration: o cartão só não aparece
    return data ?? [];
  },
});

export function useConfirmarEntregaLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc("sis_login_confirmar_entrega", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc),
  });
}

/** Copia e avisa; o clipboard falha fora de https/contexto seguro. */
export async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
}
