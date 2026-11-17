/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  enriquecerCatalogoPedidoCompra,
  type FichaEstoqueCatalogoCompra,
  type ItemCatalogoCompra,
  type ItemCatalogoCompraBase,
  type SaldoEstoqueCatalogoCompra,
} from "@/lib/suprimentos/catalogoPedidoCompra";
import { toast } from "sonner";

export type { ItemCatalogoCompra } from "@/lib/suprimentos/catalogoPedidoCompra";

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
  despesa_id: string | null;
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
  origem?: "cotacao_malote" | "estoque_saudavel" | "manual";
  comprador_nome?: string | null;
  cotacao_em?: string | null;
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

export interface NovoPedidoCompra {
  empresaId: string;
  fornecedorId: string;
  origem: "estoque_saudavel" | "manual";
  itens: Array<{
    sup_item_id: string;
    quantidade: number;
    unidade: string;
    valor_unitario: number;
    observacao?: string | null;
    ordem: number;
  }>;
  dados: Record<string, unknown>;
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

/**
 * Catálogo aprovado enriquecido com a identidade usada na consulta de
 * estoque. As consultas de ficha e saldo são leves: não trazem as etiquetas.
 */
export function useCatalogoPedidoCompra(empresaId?: string | null) {
  return useQuery<ItemCatalogoCompra[]>({
    queryKey: [CHAVE, "catalogo", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data: itens, error } = await sb.from("sup_item")
        .select("id,nome,tipo,codigo,tamanho,item_pai_id")
        .eq("empresa_id", empresaId)
        .eq("ativo", true)
        .eq("aprovado", true)
        .order("nome")
        .limit(5000);
      if (error) throw error;

      const [{ data: fichas, error: erroFichas }, { data: saldos, error: erroSaldos }] = await Promise.all([
        sb.from("sup_estoque_item")
          .select("id,sup_item_id,arquivado_em,almoxarifado:almoxarifado_id(nome)")
          .eq("empresa_id", empresaId),
        sb.from("sup_estoque_saldo")
          .select("item_estoque_id,disponivel,fisico")
          .eq("empresa_id", empresaId),
      ]);
      if (erroFichas) throw erroFichas;
      if (erroSaldos) throw erroSaldos;

      return enriquecerCatalogoPedidoCompra(
        (itens ?? []) as ItemCatalogoCompraBase[],
        (fichas ?? []) as FichaEstoqueCatalogoCompra[],
        (saldos ?? []) as SaldoEstoqueCatalogoCompra[],
      );
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

export function useCriarPedidoCompraDireto() {
  const invalidar = useInvalidarPedidos();
  return useMutation<CompraPedido, Error, NovoPedidoCompra>({
    mutationFn: async ({ empresaId, fornecedorId, origem, itens, dados }) => {
      const { data, error } = await sb.rpc("sup_compra_criar_pedido_direto", {
        p_empresa_id: empresaId,
        p_fornecedor_id: fornecedorId,
        p_itens: itens,
        p_dados: { ...dados, origem },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidar(); toast.success("Pedido de compra criado em rascunho."); },
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
