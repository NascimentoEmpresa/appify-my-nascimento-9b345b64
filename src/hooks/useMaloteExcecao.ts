import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ExcecaoSolicitacao, ExcecaoValidada } from "@/pages/malote/excecao/regras";

// SIS-2026-0668: Solicitação de Exceção do Malote. Escrita só pelas funções do banco (SECURITY DEFINER);
// a leitura é filtrada por RLS (quem pediu + quem pode decidir aquela classificação).
const KEY = "malote_excecao_solicitacao";

export function useMinhasExcecoes(userId: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, "minhas", userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_excecao_solicitacao")
        .select("*")
        .eq("solicitante_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ExcecaoSolicitacao[];
    },
  });
}

export interface SolicitarExcecaoInput {
  arquivos?: string[];
  tipo: string;
  classificacao_id: string;
  contrato_id: string | null;
  empresa_id: string;
  valor: number;
  data_pagamento: string;
  descricao: string;
  justificativa: string;
}

export function useSolicitarExcecao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: SolicitarExcecaoInput) => {
      const { data, error } = await (supabase as any).rpc("malote_excecao_solicitar", {
        _tipo: i.tipo,
        _classificacao_id: i.classificacao_id,
        _contrato_id: i.contrato_id,
        _empresa_id: i.empresa_id,
        _valor: i.valor,
        _data_pagamento: i.data_pagamento,
        _descricao: i.descricao,
        _justificativa: i.justificativa,
        _arquivos: i.arquivos ?? [],
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDecidirExcecao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { id: string; aprovar: boolean; motivo?: string }) => {
      const { data, error } = await (supabase as any).rpc("malote_excecao_decidir", {
        _id: i.id,
        _aprovar: i.aprovar,
        _motivo: i.motivo ?? null,
      });
      if (error) throw error;
      return (data ?? null) as string | null; // a senha gerada, quando aprovada
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useCancelarExcecao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("malote_excecao_cancelar", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useExcluirExcecao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("malote_excecao_excluir", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Confere a senha digitada na criação da despesa. Lança Error com a mensagem do banco (já em português). */
export async function validarSenhaExcecao(senha: string): Promise<ExcecaoValidada> {
  const { data, error } = await (supabase as any).rpc("malote_excecao_validar_senha", { _senha: senha });
  if (error) throw new Error(error.message);
  return data as ExcecaoValidada;
}

// Quem aprova as exceções (malote_config.excecao_aprovador_user_id). Lido à parte do useMaloteConfig de propósito:
// se a coluna ainda não existir no banco, só esta leitura falha — a config inteira do Malote não pode cair junto.
export function useExcecaoAprovador() {
  return useQuery({
    queryKey: [KEY, "aprovador"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("malote_config").select("excecao_aprovador_user_id").eq("id", true).maybeSingle();
      if (error) throw error;
      return (data?.excecao_aprovador_user_id ?? null) as string | null;
    },
  });
}

export function useSalvarExcecaoAprovador() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string | null) => {
      const { error } = await (supabase as any).from("malote_config").update({ excecao_aprovador_user_id: userId }).eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export interface EventoExcecao {
  id: string;
  solicitacao_id: string;
  tipo_evento: string;
  ator_user_id: string | null;
  descricao: string | null;
  created_at: string;
}

export function useExcecaoEventos(solicitacaoId: string | undefined) {
  return useQuery({
    queryKey: [KEY, "eventos", solicitacaoId],
    enabled: !!solicitacaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_excecao_solicitacao_evento")
        .select("*")
        .eq("solicitacao_id", solicitacaoId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EventoExcecao[];
    },
  });
}

// Tudo que a RLS deixa o usuário ler (quem tem a tela Autorizações vê todas; os demais, as próprias e as que decidem).
export function useTodasExcecoes() {
  return useQuery({
    queryKey: [KEY, "todas"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_excecao_solicitacao")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ExcecaoSolicitacao[];
    },
  });
}

// Classificações em que o usuário decide (N2 / gerente financeiro com a chave ligada / admin).
export function useClassificacoesQueDecido() {
  return useQuery({
    queryKey: [KEY, "classificacoes_que_decido"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("malote_excecao_classificacoes_que_decido");
      if (error) throw error;
      return new Set<string>(((data ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : String(Object.values(x as object)[0]))));
    },
  });
}

export async function abrirAnexoExcecao(path: string): Promise<boolean> {
  const { data, error } = await supabase.storage.from("malote-anexos").createSignedUrl(path, 60);
  if (error || !data) return false;
  window.open(data.signedUrl, "_blank");
  return true;
}
