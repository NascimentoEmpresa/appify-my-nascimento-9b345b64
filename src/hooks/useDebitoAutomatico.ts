import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0256: submódulo Débito Automático (Financeiro > Gestão Financeira),
// abaixo de Fluxo de Caixa — lança no Fluxo de Caixa itens que NÃO passam
// pelo Malote. 3 tipos de lançamento numa listagem única (tipo_origem):
//   1. debito_automatico       — entrada/saída avulsa.
//   2. movimentacao_financeira — transferência entre empresas do grupo,
//      gera 2 linhas com o MESMO "numero" (1 saída + 1 entrada), ligadas
//      por movimentacao_par_id.
//   3. nota_recebida           — sempre Entrada, classificação sempre fixa
//      "Recebimento de Nota".
//
// Recorrência é manual (decisão do Iury): cada competência é um lançamento
// novo, não existe geração automática.
//
// Edição pós-pagamento fica liberada (decisão do Iury, diferente do que os
// mockups descrevem) — toda edição vira um evento em
// "DEBITO_AUTOMATICO_EVENTO" (mesmo padrão de malote_despesa_evento). Só a
// EXCLUSÃO continua bloqueada pra item "pago".

export type TipoOrigemDebito = "debito_automatico" | "movimentacao_financeira" | "nota_recebida";
export type TipoDebito = "entrada" | "saida";
export type StatusDebito = "pendente" | "pago";
export type TipoEventoDebito = "criacao" | "edicao" | "pagamento" | "exclusao";

export interface DebitoAutomaticoLinha {
  id: string;
  numero: string;
  tipo_origem: TipoOrigemDebito;
  tipo: TipoDebito;
  data_pagamento: string;
  competencia: string;
  empresa_id: string;
  empresa_nome: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  classificacao_id: string;
  classificacao_nome: string | null;
  descricao: string;
  forma_pagamento: string;
  valor: number;
  status: StatusDebito;
  movimentacao_par_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  // SIS-2026-0256 (achado depois do usuário testar): Fluxo de Caixa tem
  // coluna Banco desde o SIS-2026-0307 — sem isso aqui, Débito Automático
  // sempre aparecia "—" ali. Obrigatório (decisão do usuário), catálogo
  // reaproveitado do Cartão de Crédito/Malote (malote_cartao_banco).
  banco_id: string;
  banco_nome: string | null;
  banco_logo_path: string | null;
}

export interface DebitoAutomaticoEvento {
  id: string;
  debito_id: string;
  tipo_evento: TipoEventoDebito;
  ator_user_id: string | null;
  descricao: string | null;
  created_at: string;
}

const LISTA_KEY = "debito_automatico_lista";
const EVENTO_KEY = "debito_automatico_evento";

export function useDebitoAutomaticoLista() {
  return useQuery({
    queryKey: [LISTA_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_debito_automatico_lista")
        .select("*")
        .order("data_pagamento", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DebitoAutomaticoLinha[];
    },
  });
}

export function useHistoricoDebitoAutomatico(debitoId: string | null) {
  return useQuery({
    queryKey: [EVENTO_KEY, debitoId],
    enabled: !!debitoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("DEBITO_AUTOMATICO_EVENTO")
        .select("*")
        .eq("debito_id", debitoId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DebitoAutomaticoEvento[];
    },
  });
}

export interface CriarDebitoInput {
  data_pagamento: string;
  competencia: string;
  tipo: TipoDebito;
  empresa_id: string;
  contrato_id: string | null;
  classificacao_id: string;
  descricao: string;
  forma_pagamento: string;
  valor: number;
  banco_id: string;
}

export function useCriarDebito() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CriarDebitoInput) => {
      const { data, error } = await (supabase as any).rpc("debito_automatico_criar_debito", {
        _data_pagamento: input.data_pagamento,
        _competencia: input.competencia,
        _tipo: input.tipo,
        _empresa_id: input.empresa_id,
        _contrato_id: input.contrato_id,
        _classificacao_id: input.classificacao_id,
        _descricao: input.descricao,
        _forma_pagamento: input.forma_pagamento,
        _valor: input.valor,
        _banco_id: input.banco_id,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LISTA_KEY] }),
  });
}

export interface CriarMovimentacaoInput {
  data_pagamento: string;
  competencia: string;
  empresa_saida_id: string;
  empresa_entrada_id: string;
  classificacao_id: string;
  descricao: string;
  valor: number;
  status?: StatusDebito;
  banco_saida_id: string;
  banco_entrada_id: string;
}

export function useCriarMovimentacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CriarMovimentacaoInput) => {
      const { data, error } = await (supabase as any).rpc("debito_automatico_criar_movimentacao", {
        _data_pagamento: input.data_pagamento,
        _competencia: input.competencia,
        _empresa_saida_id: input.empresa_saida_id,
        _empresa_entrada_id: input.empresa_entrada_id,
        _classificacao_id: input.classificacao_id,
        _descricao: input.descricao,
        _valor: input.valor,
        _status: input.status ?? "pendente",
        _banco_saida_id: input.banco_saida_id,
        _banco_entrada_id: input.banco_entrada_id,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LISTA_KEY] }),
  });
}

export interface CriarNotaInput {
  data_pagamento: string;
  competencia: string;
  empresa_id: string;
  contrato_id: string | null;
  descricao: string;
  forma_pagamento: string;
  valor: number;
  status?: StatusDebito;
  banco_id: string;
}

export function useCriarNota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CriarNotaInput) => {
      const { data, error } = await (supabase as any).rpc("debito_automatico_criar_nota", {
        _data_pagamento: input.data_pagamento,
        _competencia: input.competencia,
        _empresa_id: input.empresa_id,
        _contrato_id: input.contrato_id,
        _descricao: input.descricao,
        _forma_pagamento: input.forma_pagamento,
        _valor: input.valor,
        _status: input.status ?? "pendente",
        _banco_id: input.banco_id,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LISTA_KEY] }),
  });
}

// _campos: só os campos que mudaram — vira um UPDATE parcial na RPC, que
// grava o diff como evento 'edicao' (e 'pagamento' extra se o status virar
// 'pago' nessa chamada).
export function useEditarDebito() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Record<string, unknown> }) => {
      const { error } = await (supabase as any).rpc("debito_automatico_editar", { _id: id, _campos: campos });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [LISTA_KEY] });
      qc.invalidateQueries({ queryKey: [EVENTO_KEY, vars.id] });
    },
  });
}

// Bloqueado no banco pra item "pago" — Movimentação Financeira exclui o par
// junto (as 2 linhas nascem e morrem juntas).
export function useExcluirDebito() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("debito_automatico_excluir", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LISTA_KEY] }),
  });
}
