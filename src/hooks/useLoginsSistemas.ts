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
  /** Vínculo gravado ao marcar criado (mig 20261006160000). */
  empregado_id: number | null; auth_user_id: string | null;
  /**
   * A admissão Trabalhando na Senior com o CPF do pedido (null = ainda não
   * admitido). O login só pode ser liberado — e vinculado — com ela.
   */
  senior_id: number | null; senior_cadastro: string | null; senior_nome: string | null; senior_cargo: string | null;
  senior_filial: string | null; senior_admissao: string | null; senior_login: string | null;
}

/** Pedido em aberto que já pode virar login: admitido na Senior (Trabalhando). */
export const pedidoPronto = (p: Pick<PedidoLogin, "status" | "senior_id">) => p.status === "pendente" && p.senior_id != null;
/**
 * Login da ERP bloqueado pela situação na Senior (mig 20261007000007): demitido,
 * férias, auxílio-doença, licença… — só Trabalhando, Atestado e Aviso Prévio
 * Trabalhado entram (pelo CPF, qualquer vínculo). "ciente" = Sistemas deu OK
 * para esta situação; se ela mudar, volta a aparecer.
 */
export interface LoginBloqueado {
  empregado_id: number; auth_user_id: string; nome: string; cargo: string | null; contrato: string | null; empresa: string | null;
  situacao: string | null; desde: string | null; login_email: string; ultimo_acesso: string | null;
  ciente: boolean; ciente_em: string | null; ciente_por: string | null;
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
    // RPC (mig 20261006160000): os pedidos + a admissão encontrada na Senior.
    const { data, error } = await sb.rpc("sis_login_pedidos_lista");
    if (error) throw error;
    return data ?? [];
  },
});

export function useDefinirCpfPedido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; cpf: string }) => {
      const { error } = await sb.rpc("sis_login_definir_cpf", { p_id: p.id, p_cpf: p.cpf });
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc),
  });
}

export const useLoginsBloqueados = () => useQuery({
  queryKey: [K, "bloqueados"], staleTime: 30_000,
  queryFn: async (): Promise<LoginBloqueado[]> => {
    const { data, error } = await sb.rpc("sis_logins_bloqueados");
    if (error) throw error;
    return data ?? [];
  },
});

export function useMarcarLoginCriado() {
  const qc = useQueryClient();
  return useMutation({
    // Marcar criado = VINCULAR: o banco grava EMPREGADOS.auth_user_id do
    // colaborador Trabalhando com o usuário daquele e-mail.
    mutationFn: async (p: { id: string; login: string; senha: string; empregadoId: number }) => {
      const { error } = await sb.rpc("sis_login_marcar_criado", {
        p_id: p.id, p_login: p.login, p_senha: p.senha, p_empregado_id: p.empregadoId,
      });
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

/** OK = ciência do bloqueio. Não libera nada: o bloqueio é automático pela situação. */
export function useCienteBloqueio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (authUserId: string) => {
      const { error } = await sb.rpc("sis_login_bloqueio_ciente", { p_auth_user_id: authUserId });
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
