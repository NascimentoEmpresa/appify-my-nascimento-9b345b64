import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0473: submódulo Aplicações Financeiras (Financeiro > Gestão
// Financeira), parecido com Débito Automático — registra aplicações
// (CDB/Fundo DI/Conta remunerada/etc.) e resgates (totais ou parciais), e
// alimenta o Fluxo de Caixa: aplicar é SAÍDA, cada resgate é ENTRADA
// própria. Rendimento é manual (sem cálculo automático de indexador/CDI).

export type ProdutoAplicacao = "CDB" | "Fundo DI" | "Conta remunerada" | "Poupança" | "Outro";
export type TipoAplicacao = "aplicacao_inicial" | "reaplicacao" | "aporte_adicional";
export type StatusAplicacao = "ativa" | "resgatada";
export type StatusAplicacaoExibicao = StatusAplicacao | "vencida";
export type TipoResgate = "parcial" | "total";
export type TipoEventoAplicacao = "criacao" | "edicao" | "rendimento_atualizado" | "resgate_parcial" | "resgate_total" | "exclusao";

export interface AplicacaoFinanceiraLinha {
  id: string;
  numero: string;
  data_aplicacao: string;
  competencia: string;
  empresa_id: string;
  empresa_nome: string | null;
  banco_id: string;
  banco_nome: string | null;
  banco_logo_path: string | null;
  produto: ProdutoAplicacao;
  tipo_aplicacao: TipoAplicacao;
  classificacao_id: string;
  classificacao_nome: string | null;
  forma_pagamento: string;
  descricao: string;
  valor_aplicado: number;
  indexador: string | null;
  taxa: string | null;
  data_vencimento: string | null;
  liquidez: string | null;
  rendimento_acumulado: number;
  total_principal_resgatado: number;
  total_rendimento_resgatado: number;
  saldo_principal: number;
  saldo_atual: number;
  status: StatusAplicacao;
  status_exibicao: StatusAplicacaoExibicao;
  created_by: string | null;
  created_at: string;
}

export interface AplicacaoFinanceiraResgate {
  id: string;
  aplicacao_id: string;
  data_resgate: string;
  valor_principal: number;
  valor_rendimento: number;
  tipo: TipoResgate;
  observacao: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AplicacaoFinanceiraEvento {
  id: string;
  aplicacao_id: string;
  tipo_evento: TipoEventoAplicacao;
  ator_user_id: string | null;
  descricao: string | null;
  created_at: string;
}

const LISTA_KEY = "aplicacao_financeira_lista";
const RESGATES_KEY = "aplicacao_financeira_resgates";
const EVENTO_KEY = "aplicacao_financeira_evento";

export function useAplicacoesFinanceiras() {
  return useQuery({
    queryKey: [LISTA_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_aplicacao_financeira_lista")
        .select("*")
        .order("data_aplicacao", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AplicacaoFinanceiraLinha[];
    },
  });
}

export function useResgatesAplicacao(aplicacaoId: string | null) {
  return useQuery({
    queryKey: [RESGATES_KEY, aplicacaoId],
    enabled: !!aplicacaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("APLICACAO_FINANCEIRA_RESGATE")
        .select("*")
        .eq("aplicacao_id", aplicacaoId)
        .order("data_resgate", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AplicacaoFinanceiraResgate[];
    },
  });
}

export function useHistoricoAplicacao(aplicacaoId: string | null) {
  return useQuery({
    queryKey: [EVENTO_KEY, aplicacaoId],
    enabled: !!aplicacaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("APLICACAO_FINANCEIRA_EVENTO")
        .select("*")
        .eq("aplicacao_id", aplicacaoId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AplicacaoFinanceiraEvento[];
    },
  });
}

export interface CriarAplicacaoInput {
  data_aplicacao: string;
  competencia: string;
  empresa_id: string;
  banco_id: string;
  produto: ProdutoAplicacao;
  tipo_aplicacao: TipoAplicacao;
  forma_pagamento: string;
  descricao: string;
  valor_aplicado: number;
  indexador?: string | null;
  taxa?: string | null;
  data_vencimento?: string | null;
  liquidez?: string | null;
}

export function useCriarAplicacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CriarAplicacaoInput) => {
      const { data, error } = await (supabase as any).rpc("aplicacao_financeira_criar", {
        _data_aplicacao: input.data_aplicacao,
        _competencia: input.competencia,
        _empresa_id: input.empresa_id,
        _banco_id: input.banco_id,
        _produto: input.produto,
        _tipo_aplicacao: input.tipo_aplicacao,
        _forma_pagamento: input.forma_pagamento,
        _descricao: input.descricao,
        _valor_aplicado: input.valor_aplicado,
        _indexador: input.indexador ?? null,
        _taxa: input.taxa ?? null,
        _data_vencimento: input.data_vencimento ?? null,
        _liquidez: input.liquidez ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [LISTA_KEY] });
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
    },
  });
}

export function useEditarAplicacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Record<string, unknown> }) => {
      const { error } = await (supabase as any).rpc("aplicacao_financeira_editar", { _id: id, _campos: campos });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [LISTA_KEY] });
      qc.invalidateQueries({ queryKey: [EVENTO_KEY, vars.id] });
    },
  });
}

export function useAtualizarRendimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: number }) => {
      const { error } = await (supabase as any).rpc("aplicacao_financeira_atualizar_rendimento", { _id: id, _valor: valor });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [LISTA_KEY] });
      qc.invalidateQueries({ queryKey: [EVENTO_KEY, vars.id] });
    },
  });
}

export interface ResgatarAplicacaoInput {
  id: string;
  dataResgate: string;
  valorPrincipal: number;
  valorRendimento: number;
  tipo: TipoResgate;
  observacao?: string | null;
}

export function useResgatarAplicacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ResgatarAplicacaoInput) => {
      const { data, error } = await (supabase as any).rpc("aplicacao_financeira_resgatar", {
        _id: input.id,
        _data_resgate: input.dataResgate,
        _valor_principal: input.valorPrincipal,
        _valor_rendimento: input.valorRendimento,
        _tipo: input.tipo,
        _observacao: input.observacao ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [LISTA_KEY] });
      qc.invalidateQueries({ queryKey: [RESGATES_KEY, vars.id] });
      qc.invalidateQueries({ queryKey: [EVENTO_KEY, vars.id] });
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
    },
  });
}

export function useExcluirAplicacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("aplicacao_financeira_excluir", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [LISTA_KEY] });
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
    },
  });
}
