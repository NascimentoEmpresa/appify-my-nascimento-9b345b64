import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0170: catálogo nomeado de formas de pagamento (ex.: "Banco do
// Brasil - Ag. 1234-5" / Transferência Bancária). Não substitui o Select
// fixo de forma_pagamento já usado em Criar Despesa e outras telas — só o
// cadastro por enquanto.
//
// "Tipo" é, por sua vez, outro catálogo editável (malote_tipo_forma_
// pagamento, mesmo padrão de malote_tipo_bloqueio) — a pedido do Iury,
// pra poder criar tipos novos sem precisar de migration.
export interface MaloteFormaPagamento {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
}

const KEY = "malote_forma_pagamento";
const TIPOS_KEY = "malote_tipo_forma_pagamento";

export interface MaloteTipoFormaPagamento {
  nome: string;
  ativo: boolean;
}

export function useTiposFormaPagamento() {
  return useQuery({
    queryKey: [TIPOS_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("malote_tipo_forma_pagamento").select("nome, ativo").order("nome");
      if (error) throw error;
      return (data ?? []) as MaloteTipoFormaPagamento[];
    },
  });
}

export function useCriarTipoFormaPagamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await (supabase as any).from("malote_tipo_forma_pagamento").insert({ nome: nome.trim() });
      if (error) throw error;
      return nome.trim();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [TIPOS_KEY] }),
  });
}

export function useAtualizarStatusTipoFormaPagamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ nome, ativo }: { nome: string; ativo: boolean }) => {
      const { error } = await (supabase as any).from("malote_tipo_forma_pagamento").update({ ativo }).eq("nome", nome);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [TIPOS_KEY] }),
  });
}

// DELETE falha com 23503 (foreign_key_violation) se o tipo estiver em uso
// por alguma Forma de Pagamento — deixa o banco garantir a integridade em
// vez de checar no client.
export function useExcluirTipoFormaPagamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await (supabase as any).from("malote_tipo_forma_pagamento").delete().eq("nome", nome);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [TIPOS_KEY] }),
  });
}

export function useFormasPagamento() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("malote_forma_pagamento").select("id, nome, tipo, ativo").order("nome");
      if (error) throw error;
      return (data ?? []) as MaloteFormaPagamento[];
    },
  });
}

interface SalvarFormaPagamentoInput {
  id?: string;
  nome: string;
  tipo: string;
  ativo: boolean;
}

export function useSalvarFormaPagamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarFormaPagamentoInput) => {
      const payload = { ...input, nome: input.nome.trim() };
      const { error } = await (supabase as any).from("malote_forma_pagamento").upsert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useExcluirFormaPagamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("malote_forma_pagamento").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
