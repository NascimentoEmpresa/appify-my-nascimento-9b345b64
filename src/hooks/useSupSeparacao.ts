import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useInvalidarEstoque } from "@/hooks/useSupEstoque";
import type { SituacaoPedido } from "@/hooks/useSupPedidos";

/**
 * Pré-pedido, reserva e separação física.
 *
 * O problema que isto resolve, na voz do gerente de Suprimentos: Compras abre
 * solicitação de compra de um item que "tem 10 no estoque", e o Estoque
 * responde que aqueles 10 já estão dentro de uma sacola esperando despacho.
 * Ninguém está errado — faltava o estado do meio.
 *
 * Toda a escrita passa por RPC (20260930000079). Nenhuma tela escreve em
 * sup_estoque_reserva direto: a tabela não tem policy de INSERT/UPDATE, de
 * propósito, igual a sup_estoque_consumo.
 */

const sb = supabase as any;

// ── Sugestão (a tela da supervisora) ─────────────────────────────────

export interface LoteSugerido {
  tag_id: string;
  codigo: string;
  tipo: "unico" | "massa";
  tamanho: string | null;
  /** Quanto o sistema propõe tirar deste lote. */
  quantidade: number;
  /** Quanto este lote tem livre (físico menos reservas de outros pedidos). */
  livre: number;
  localizacao: string | null;
  valor_unitario: number | null;
  ca_numero: string | null;
  ca_validade: string | null;
  /** Avisa sem impedir — CA vencido, por exemplo. */
  alerta: string | null;
}

export interface ItemSugerido {
  pedido_item_id: string;
  item_id: string | null;
  nome_item: string;
  tamanho: string | null;
  quantidade_pedida: number;
  /** O que já saiu ou já está reservado para este item. */
  ja_resolvido: number;
  /** O que o estoque NÃO consegue cobrir — vira necessidade de compra. */
  faltante: number;
  lotes: LoteSugerido[];
}

/**
 * Calculada quando a supervisora ABRE o pedido, e não guardada em lugar
 * nenhum. É o que impede sugestão obsoleta: entre abrir e confirmar, outro
 * operador pode ter levado o lote.
 */
export function useSugestaoSeparacao(pedidoId: string | null) {
  return useQuery({
    queryKey: ["sup_sep_sugerir", pedidoId],
    enabled: !!pedidoId,
    staleTime: 0,
    queryFn: async (): Promise<{ pedido_id: string; itens: ItemSugerido[] }> => {
      const { data, error } = await sb.rpc("sup_sep_sugerir", { p_pedido_id: pedidoId });
      if (error) throw error;
      return data ?? { pedido_id: pedidoId, itens: [] };
    },
  });
}

export interface ReservaPedida {
  pedido_item_id: string;
  lotes: { tag_id: string; quantidade: number }[];
}

export interface ResultadoReserva {
  reservadas: number;
  faltantes: { pedido_item_id: string; nome_item: string; tamanho: string | null; faltam: number }[];
  rejeitadas: { codigo?: string; tag_id?: string; pedido_item_id?: string; motivo: string }[];
}

export function useReservarSeparacao() {
  const invalidar = useInvalidarEstoque();
  return useMutation({
    mutationFn: async (p: { pedido_id: string; reservas: ReservaPedida[]; observacao?: string | null }) => {
      const { data, error } = await sb.rpc("sup_sep_reservar", {
        p_pedido_id: p.pedido_id,
        p_reservas: p.reservas,
        p_observacao: p.observacao ?? null,
      });
      if (error) throw error;
      return data as ResultadoReserva;
    },
    onSuccess: (r) => {
      invalidar();
      if (r.reservadas === 0) {
        toast.warning("Nada foi reservado.", {
          description: r.rejeitadas.map((x) => x.motivo).join(" · ") || undefined,
          duration: 9000,
        });
        return;
      }
      // Faltar item é rotina, não erro: é assim que nasce a necessidade de
      // compra. O aviso existe para a supervisora ver o que sobrou de fora.
      if (r.faltantes.length) {
        toast.warning(`Pré-pedido criado com ${r.reservadas} unidade(s) reservada(s).`, {
          description: `Sem saldo para: ${r.faltantes.map((f) => `${f.nome_item}${f.tamanho ? ` (${f.tamanho})` : ""} × ${f.faltam}`).join(" · ")}`,
          duration: 12000,
        });
      } else {
        toast.success(`Pré-pedido criado: ${r.reservadas} unidade(s) reservada(s) para separação.`);
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível reservar."),
  });
}

// ── Fila do estoquista ───────────────────────────────────────────────

export interface LinhaFilaSeparacao {
  pedido_id: string;
  protocolo: string;
  contrato_nome: string | null;
  posto_nome: string | null;
  funcao_nome: string | null;
  nome_colaborador: string | null;
  data_solicitacao: string | null;
  reserva_id: string;
  pedido_item_id: string;
  nome_item: string;
  item_tamanho: string | null;
  codigo: string;
  localizacao: string | null;
  quantidade: number;
  reservado_em: string;
  reservado_por_nome: string | null;
}

/**
 * Lê por RPC e não por SELECT: o separador fica com UM menu e nenhum acesso
 * a sup_pedido nem a sup_estoque_tag. É o mesmo motivo pelo qual as RPCs
 * sup_ext_* existem — dar a tela de separação não pode implicar dar a fila
 * comercial inteira, com contrato e valor.
 */
export function useFilaSeparacao(limite = 200) {
  return useQuery({
    queryKey: ["sup_sep_fila", limite],
    queryFn: async (): Promise<LinhaFilaSeparacao[]> => {
      const { data, error } = await sb.rpc("sup_sep_fila", { p_limite: limite, p_offset: 0 });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useConfirmarSeparacao() {
  const invalidar = useInvalidarEstoque();
  return useMutation({
    mutationFn: async (p: {
      pedido_id: string;
      itens: { reserva_id: string; quantidade?: number; observacao?: string | null }[];
    }) => {
      const { data, error } = await sb.rpc("sup_sep_confirmar", {
        p_pedido_id: p.pedido_id,
        p_itens: p.itens,
      });
      if (error) throw error;
      return data as { separadas: number; rejeitadas: { codigo?: string; motivo: string }[]; status: string };
    },
    onSuccess: (r) => {
      invalidar();
      if (r.rejeitadas?.length) {
        toast.warning(`${r.separadas} unidade(s) separada(s), ${r.rejeitadas.length} recusada(s).`, {
          description: r.rejeitadas.map((x) => x.motivo).join(" · "),
          duration: 10000,
        });
      } else {
        toast.success(`${r.separadas} unidade(s) separada(s). Pedido em ${r.status}.`);
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível confirmar a separação."),
  });
}

/**
 * O material não estava na doca.
 *
 * Não corrige o saldo — registra. Quem decide quanto existe de verdade é a
 * contagem, não a palavra de quem estava separando com pressa. É a mesma
 * regra do inventário, e é o que preserva a prova de que a peça sumiu sem
 * baixa: exatamente a investigação (câmera, relatório, quem deu baixa) que o
 * gerente descreveu.
 */
export function useDivergenciaSeparacao() {
  const invalidar = useInvalidarEstoque();
  return useMutation({
    mutationFn: async (p: { reserva_id: string; faltante: number; motivo: string }) => {
      const { data, error } = await sb.rpc("sup_sep_divergencia", {
        p_reserva_id: p.reserva_id,
        p_faltante: p.faltante,
        p_motivo: p.motivo,
      });
      if (error) throw error;
      return data as { faltante: number; status: string };
    },
    onSuccess: (r) => {
      invalidar();
      toast.success(`Divergência registrada: ${r.faltante} unidade(s).`, {
        description: "O material entrou na lista de contagem rotativa e o item volta para o Suprimentos.",
        duration: 8000,
      });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível registrar a divergência."),
  });
}

export function useLiberarReserva() {
  const invalidar = useInvalidarEstoque();
  return useMutation({
    mutationFn: async (p: { pedido_id: string; reserva_id?: string | null; motivo?: string | null }) => {
      const { data, error } = await sb.rpc("sup_sep_liberar", {
        p_pedido_id: p.pedido_id,
        p_reserva_id: p.reserva_id ?? null,
        p_motivo: p.motivo ?? null,
      });
      if (error) throw error;
      return data as { liberadas: number; unidades: number };
    },
    onSuccess: (r) => {
      invalidar();
      toast.success(`${r.unidades} unidade(s) devolvida(s) ao estoque disponível.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível liberar a reserva."),
  });
}

// ── Situação dos pedidos (KPI e badge) ───────────────────────────────

/**
 * Quantos itens de cada pedido já saíram, estão em separação ou ficaram
 * pendentes de compra. Vem da view sup_pedido_situacao, que resolve no banco
 * o que antes exigiria carregar as etiquetas de todos os pedidos da tela.
 *
 * NOTA sobre o acervo migrado: as 1.084 etiquetas e as 3.575 linhas de
 * consumo que vieram do sistema antigo não trouxeram vínculo item-a-item
 * (`pedido_item_id` nulo), então elas contam como "não atendido" aqui. Não é
 * regressão — `buscarTagsDePedidos` já descarta essas mesmas linhas hoje. Na
 * prática significa que "parcialmente despachado" só passa a valer para os
 * pedidos que rodarem pelo fluxo novo.
 */
export function useSituacaoPedidos(pedidoIds: string[], enabled = true) {
  const chave = pedidoIds.join(",");
  return useQuery({
    queryKey: ["sup_pedido_situacao", chave],
    enabled: enabled && pedidoIds.length > 0,
    queryFn: async (): Promise<Map<string, SituacaoPedido>> => {
      const mapa = new Map<string, SituacaoPedido>();
      // O PostgREST corta em 1.000 linhas sem avisar (SIS-2026-0201), e aqui
      // é uma linha por pedido — com ~1.300 pedidos o corte já acontece.
      for (let i = 0; i < pedidoIds.length; i += 500) {
        const fatia = pedidoIds.slice(i, i + 500);
        const { data, error } = await sb
          .from("sup_pedido_situacao")
          .select("pedido_id, itens, itens_atendidos, itens_em_separacao, itens_pendentes_compra")
          .in("pedido_id", fatia);
        if (error) throw error;
        for (const r of data ?? []) mapa.set(r.pedido_id, r as SituacaoPedido);
      }
      return mapa;
    },
  });
}

// ── Contagem rotativa ────────────────────────────────────────────────

export interface LinhaContagem {
  id: string;
  item_estoque_id: string;
  codigo: string | null;
  tamanho: string | null;
  origem: string;
  quantidade_faltante: number | null;
  motivo: string;
  situacao: string;
  aberta_em: string;
  aberta_por_nome: string | null;
  fechada_em: string | null;
  fechada_por_nome: string | null;
  pedido: { pedido_id: string } | null;
  material: { nome: string } | null;
}

/**
 * A lista que o gerente pediu: "esse produto necessita uma contagem
 * rotativa", com o motivo anotado, para virar o relatório mensal de quantos
 * itens deram inconsistência.
 *
 * Uma linha por OCORRÊNCIA, não por material: três divergências no mesmo
 * produto são três motivos e três provas.
 */
export function useContagemRotativa(apenasAbertas = true) {
  return useQuery({
    queryKey: ["sup_contagem_fila", apenasAbertas],
    queryFn: async (): Promise<LinhaContagem[]> => {
      let q = sb
        .from("sup_estoque_contagem_fila")
        .select(`id, item_estoque_id, codigo, tamanho, origem, quantidade_faltante, motivo,
                 situacao, aberta_em, aberta_por_nome, fechada_em, fechada_por_nome,
                 pedido:pedido_id (pedido_id), material:sup_item_id (nome)`)
        .order("aberta_em", { ascending: false })
        .limit(500);
      if (apenasAbertas) q = q.eq("situacao", "ABERTA");
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
