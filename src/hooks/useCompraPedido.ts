/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const sb = supabase as any;
const CHAVE = "sup_compra_pedido";

export interface CompraPedidoItem {
  id: string;
  pedido_id: string;
  sup_item_id: string | null;
  nome_item: string;
  quantidade: number;
  unidade: string | null;
  tamanho: string | null;
  valor_unitario: number | null;
  codigo_fornecedor: string | null;
  preco_referencia_valor: number | null;
  preco_referencia_em: string | null;
  preco_referencia_fornecedor_nome: string | null;
  preco_referencia_valido_ate: string | null;
  observacao: string | null;
  ordem: number;
}

export interface PedidoCompraResumido {
  id: string;
  numero: string;
  status: CompraPedido["status"];
}

export interface CompraPedido {
  id: string;
  numero: string;
  despesa_id: string;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  contrato_id: string | null;
  empresa_id: string;
  valor_total: number;
  prazo_entrega_dias: number | null;
  data_limite_entrega: string | null;
  local_entrega: string | null;
  forma_pagamento: string | null;
  condicoes_negociadas: string | null;
  frete_incluso: boolean;
  observacoes: string | null;
  status: "rascunho" | "enviado" | "aguardando_entrega" | "entrega_parcial" | "recebido" | "cancelado";
  enviado_em: string | null;
  enviado_por_nome: string | null;
  created_at: string;
  itens?: CompraPedidoItem[];
  empresa?: { razao_social: string; nome_fantasia: string | null; cnpj: string } | null;
  fornecedor?: {
    razao_social: string; nome_fantasia: string | null; cnpj_cpf: string;
    logradouro: string | null; numero: string | null; bairro: string | null;
    cidade: string | null; uf: string | null; cep: string | null;
    telefone: string | null; email: string | null;
  } | null;
}

export function usePedidosCompra() {
  return useQuery<CompraPedido[]>({
    queryKey: [CHAVE, "lista"],
    queryFn: async () => {
      const { data, error } = await sb.from("sup_compra_pedido")
        .select("*").order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePedidoCompra(id?: string | null) {
  return useQuery<CompraPedido | null>({
    queryKey: [CHAVE, "detalhe", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await sb.from("sup_compra_pedido").select(`
        *,
        empresa:empresa_id(razao_social,nome_fantasia,cnpj),
        fornecedor:fornecedor_id(
          razao_social,nome_fantasia,cnpj_cpf,logradouro,numero,bairro,cidade,uf,cep,telefone,email
        ),
        itens:sup_compra_pedido_item(*)
      `).eq("id", id).order("ordem", { referencedTable: "itens" }).single();
      if (error) throw error;
      return data;
    },
  });
}

export function usePedidoAtivoDaDespesa(despesaId?: string | null) {
  return useQuery<PedidoCompraResumido | null>({
    queryKey: [CHAVE, "despesa", despesaId],
    enabled: !!despesaId,
    queryFn: async () => {
      const { data, error } = await sb.from("sup_compra_pedido")
        .select("id,numero,status")
        .eq("despesa_id", despesaId)
        .neq("status", "cancelado")
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

function useInvalidarPedidos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [CHAVE] });
}

export function useGerarPedidoCompra() {
  const invalidar = useInvalidarPedidos();
  return useMutation<CompraPedido, Error, string>({
    mutationFn: async (despesaId) => {
      const { data, error } = await sb.rpc("sup_compra_gerar_pedido", { p_despesa_id: despesaId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidar(); toast.success("Pedido de compra gerado."); },
    onError: (erro) => toast.error(erro.message),
  });
}

export function useAtualizarPedidoCompra() {
  const invalidar = useInvalidarPedidos();
  return useMutation<CompraPedido, Error, { id: string; dados: Record<string, unknown> }>({
    mutationFn: async ({ id, dados }) => {
      const { data, error } = await sb.rpc("sup_compra_atualizar_pedido", { p_id: id, p_dados: dados });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidar(); toast.success("Pedido atualizado."); },
    onError: (erro) => toast.error(erro.message),
  });
}

export function useAtualizarValorItemPedido() {
  const invalidar = useInvalidarPedidos();
  return useMutation<CompraPedidoItem, Error, { itemId: string; valor: number | null }>({
    mutationFn: async ({ itemId, valor }) => {
      const { data, error } = await sb.rpc("sup_compra_atualizar_valor_item", {
        p_item_id: itemId,
        p_valor: valor,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidar(); toast.success("Valor do item atualizado."); },
    onError: (erro) => toast.error(erro.message),
  });
}

export function useEnviarPedidoCompra() {
  const invalidar = useInvalidarPedidos();
  return useMutation<CompraPedido, Error, string>({
    mutationFn: async (id) => {
      const { data, error } = await sb.rpc("sup_compra_enviar_pedido", { p_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidar(); toast.success("Pedido marcado como enviado."); },
    onError: (erro) => toast.error(erro.message),
  });
}

export function useCancelarPedidoCompra() {
  const invalidar = useInvalidarPedidos();
  return useMutation<CompraPedido, Error, { id: string; motivo: string }>({
    mutationFn: async ({ id, motivo }) => {
      const { data, error } = await sb.rpc("sup_compra_cancelar_pedido", { p_id: id, p_motivo: motivo });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidar(); toast.success("Pedido cancelado."); },
    onError: (erro) => toast.error(erro.message),
  });
}
