import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Controle de estoque por etiqueta física (TAGs).
 *
 * Toda escrita passa pelas RPCs sup_est_* — nenhuma tela grava direto nas
 * tabelas. É lá que moram a reciclagem de etiqueta, o controle por delta e a
 * transação única de baixa + status.
 *
 * Ver supabase/migrations/20260820000001_supply_estoque.sql e ..._rpcs.sql.
 */

const sb = supabase as any;

export type TipoTag = "unico" | "massa";

export interface Almoxarifado { id: string; codigo: string; nome: string; empresa_id: string }

export interface LinhaEstoque {
  item_estoque_id: string;
  sup_item_id: string;
  material: string;
  tipo_material: string;
  almoxarifado: string;
  valor_unitario: number;
  estoque_minimo: number;
  disponivel: number;
  consumido: number;
  etiquetas: number;
  tamanhos: string[];
}

export interface TagEstoque {
  id: string; codigo: string; tamanho: string | null; sequencia: number;
  tipo: TipoTag; quantidade_massa: number | null; quantidade_original_massa: number | null;
  valor_unitario: number | null; estado: string; usado: boolean;
  pedido_id: string | null; pedido_item_id: string | null; usado_por_nome: string | null;
}

export interface TagDoPedido {
  codigo: string; pedido_item_id: string; tipo: TipoTag;
  quantidade: number; tamanho: string | null; material: string; valor_unitario: number | null;
}

export interface ResultadoValidacao {
  codigo: string; valido: boolean; motivo: string | null; material: string | null;
  tamanho: string | null; tipo: TipoTag | null; disponivel: number; valor_unitario: number | null;
}

// ── Consultas ────────────────────────────────────────────────────────

export interface FornecedorOpcao { id: string; razao_social: string; nome_fantasia: string | null; cnpj_cpf: string | null }

/**
 * Fornecedores cadastrados, para o select da entrada de estoque.
 * Reusa public.fornecedor — o mesmo cadastro que o Financeiro consome em
 * títulos a pagar, para não existirem duas listas de fornecedor no ERP.
 */
export function useFornecedores(empresaId: string | null) {
  return useQuery({
    queryKey: ["sup_fornecedores", empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<FornecedorOpcao[]> => {
      const { data, error } = await sb
        .from("fornecedor")
        .select("id, razao_social, nome_fantasia, cnpj_cpf")
        .eq("ativo", true)
        .order("razao_social");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Materiais que um fornecedor fornece (sup_fornecedor_item). */
export function useMateriaisDoFornecedor(fornecedorId: string | null) {
  return useQuery({
    queryKey: ["sup_fornecedor_item", fornecedorId],
    enabled: !!fornecedorId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("sup_fornecedor_item")
        .select("id, sup_item_id, codigo_fornecedor, sup_item:sup_item_id(id, nome, tipo)")
        .eq("fornecedor_id", fornecedorId);
      if (error) throw error;
      return (data ?? []) as {
        id: string; sup_item_id: string; codigo_fornecedor: string | null;
        sup_item: { id: string; nome: string; tipo: string } | null;
      }[];
    },
  });
}

export function useVincularMaterialFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { fornecedor_id: string; sup_item_id: string; codigo_fornecedor?: string | null }) => {
      const { error } = await sb.from("sup_fornecedor_item").insert(v);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sup_fornecedor_item"] }); toast.success("Material vinculado."); },
    onError: (e: any) =>
      toast.error(/duplicate|unique/i.test(e?.message ?? "")
        ? "Esse material já está vinculado a este fornecedor."
        : e?.message ?? "Não foi possível vincular."),
  });
}

export function useDesvincularMaterialFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("sup_fornecedor_item").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sup_fornecedor_item"] }); toast.success("Material desvinculado."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível desvincular."),
  });
}

export function useAlmoxarifados(empresaId: string | null) {
  return useQuery({
    queryKey: ["almoxarifado", empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<Almoxarifado[]> => {
      const { data, error } = await sb
        .from("almoxarifado")
        .select("id, codigo, nome, empresa_id")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Saldo consolidado por material — alimenta o dashboard de estoque. */
export function useEstoqueLista(empresaId: string | null) {
  return useQuery({
    queryKey: ["sup_estoque_lista", empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<LinhaEstoque[]> => {
      const { data, error } = await sb
        .from("sup_estoque_item")
        .select(`id, valor_unitario, estoque_minimo,
                 sup_item:sup_item_id (id, nome, tipo),
                 almoxarifado:almoxarifado_id (nome),
                 sup_estoque_tag (tamanho, tipo, usado, quantidade_massa, quantidade_original_massa)`);
      if (error) throw error;

      // Mesma fórmula da view sup_estoque_saldo — aqui só para evitar um
      // segundo round-trip. A view continua sendo a autoridade no banco.
      return (data ?? []).map((r: any) => {
        const tags = r.sup_estoque_tag ?? [];
        const disponivel = tags.reduce((s: number, t: any) =>
          s + (t.usado ? 0 : t.tipo === "massa" ? (t.quantidade_massa ?? 0) : 1), 0);
        const consumido = tags.reduce((s: number, t: any) =>
          s + (t.tipo === "massa"
            ? (t.quantidade_original_massa ?? 0) - (t.quantidade_massa ?? 0)
            : (t.usado ? 1 : 0)), 0);
        return {
          item_estoque_id: r.id,
          sup_item_id: r.sup_item?.id,
          material: r.sup_item?.nome ?? "—",
          tipo_material: r.sup_item?.tipo ?? "",
          almoxarifado: r.almoxarifado?.nome ?? "—",
          valor_unitario: Number(r.valor_unitario ?? 0),
          estoque_minimo: Number(r.estoque_minimo ?? 0),
          disponivel, consumido,
          etiquetas: tags.length,
          tamanhos: [...new Set(tags.filter((t: any) => !t.usado && t.tamanho).map((t: any) => t.tamanho))] as string[],
        };
      }).sort((a, b) => a.material.localeCompare(b.material, "pt-BR"));
    },
  });
}

export function useTagsDoItem(itemEstoqueId: string | null) {
  return useQuery({
    queryKey: ["sup_estoque_tag", itemEstoqueId],
    enabled: !!itemEstoqueId,
    queryFn: async (): Promise<TagEstoque[]> => {
      const { data, error } = await sb
        .from("sup_estoque_tag").select("*")
        .eq("item_estoque_id", itemEstoqueId)
        .order("sequencia");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Etiquetas livres de um material (e opcionalmente de um tamanho).
 * É o que alimenta o botão "escolher da lista" no modal de baixa — para o
 * operador que está sem a pistola em mãos.
 */
export function useTagsDisponiveis(supItemId: string | null, tamanho?: string | null) {
  return useQuery({
    queryKey: ["sup_tags_disponiveis", supItemId, tamanho ?? null],
    enabled: !!supItemId,
    queryFn: async (): Promise<TagEstoque[]> => {
      let q = sb
        .from("sup_estoque_tag")
        .select("*, sup_estoque_item!inner(sup_item_id)")
        .eq("sup_estoque_item.sup_item_id", supItemId)
        .eq("usado", false)
        .order("sequencia");
      if (tamanho) q = q.eq("tamanho", tamanho);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Saldo disponível de um material/tamanho — mostrado ao lado de cada item do pedido. */
export function useSaldoMaterial(supItemId: string | null, tamanho?: string | null) {
  return useQuery({
    queryKey: ["sup_saldo_material", supItemId, tamanho ?? null],
    enabled: !!supItemId,
    queryFn: async (): Promise<number> => {
      let q = sb.from("sup_estoque_saldo").select("disponivel").eq("sup_item_id", supItemId);
      if (tamanho) q = q.eq("tamanho", tamanho);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).reduce((s: number, r: any) => s + Number(r.disponivel ?? 0), 0);
    },
  });
}

/** Etiquetas já vinculadas a um pedido (§6.7 — une tag única + ledger de massa). */
export function useTagsDoPedido(pedidoId: string | null) {
  return useQuery({
    queryKey: ["sup_est_tags_do_pedido", pedidoId],
    enabled: !!pedidoId,
    queryFn: async (): Promise<TagDoPedido[]> => {
      const { data, error } = await sb.rpc("sup_est_tags_do_pedido", { p_pedido_id: pedidoId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Escrita ──────────────────────────────────────────────────────────

function useInvalidarEstoque() {
  const qc = useQueryClient();
  return () => {
    ["sup_estoque_lista", "sup_estoque_tag", "sup_tags_disponiveis", "sup_saldo_material",
     "sup_est_tags_do_pedido", "sup_pedido", "sup_pedido_historico"]
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
}

export interface UnidadeEntrada {
  tamanho: string;
  tipo: TipoTag;
  codigos?: string[];    // modo único
  codigo?: string;       // modo massa
  quantidade?: number;   // modo massa
  valor_unitario?: number | null;
}

export function useEntradaEstoque() {
  const invalidar = useInvalidarEstoque();
  return useMutation({
    mutationFn: async (p: {
      almoxarifado_id: string; sup_item_id: string;
      valor_unitario?: number; estoque_minimo?: number;
      /** Id do cadastro em public.fornecedor. O campo texto é legado. */
      fornecedor_id?: string | null;
      validade?: string | null; observacao?: string | null;
      unidades: UnidadeEntrada[];
    }) => {
      const { data, error } = await sb.rpc("sup_est_entrada", { p_payload: p });
      if (error) throw error;
      return data as { item_estoque_id: string; criadas: number; rejeitadas: { codigo: string; motivo: string }[] };
    },
    onSuccess: (r) => {
      invalidar();
      // Sucesso parcial é o normal aqui (§6.5): grava o que dá e avisa do resto.
      if (r.rejeitadas?.length) {
        toast.warning(`${r.criadas} etiqueta(s) gravada(s), ${r.rejeitadas.length} recusada(s).`, {
          description: r.rejeitadas.map((x) => `${x.codigo}: ${x.motivo}`).join(" · "),
          duration: 10000,
        });
      } else {
        toast.success(`${r.criadas} etiqueta(s) gravada(s) no estoque.`);
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível dar entrada."),
  });
}

export function useValidarTags() {
  return useMutation({
    mutationFn: async (p: { codigos: string[]; pedido_id?: string | null; pedido_item_id?: string | null }) => {
      const { data, error } = await sb.rpc("sup_est_validar", {
        p_codigos: p.codigos,
        p_pedido_id: p.pedido_id ?? null,
        p_pedido_item_id: p.pedido_item_id ?? null,
      });
      if (error) throw error;
      return (data ?? []) as ResultadoValidacao[];
    },
  });
}

export interface Baixa {
  pedido_item_id: string;
  codigo: string;
  tipo: TipoTag;
  quantidade?: number;
}

/**
 * Status + consumo das etiquetas NUMA CHAMADA SÓ.
 * No legado eram duas requisições: se a segunda falhasse, as peças já tinham
 * saído do estoque e o pedido ficava com o status antigo (§12.6).
 */
export function useBaixarPedido() {
  const invalidar = useInvalidarEstoque();
  return useMutation({
    mutationFn: async (p: {
      pedido_id: string; status: string; observacao: string | null; baixas: Baixa[];
    }) => {
      const { data, error } = await sb.rpc("sup_est_baixar", {
        p_pedido_id: p.pedido_id,
        p_status: p.status,
        p_observacao: p.observacao,
        p_baixas: p.baixas,
      });
      if (error) throw error;
      return data as { baixadas: number; rejeitadas: { codigo: string; motivo: string }[] };
    },
    onSuccess: (r) => {
      invalidar();
      if (r.rejeitadas?.length) {
        toast.warning(`Pedido atualizado, mas ${r.rejeitadas.length} etiqueta(s) foram recusadas.`, {
          description: r.rejeitadas.map((x) => `${x.codigo}: ${x.motivo}`).join(" · "),
          duration: 10000,
        });
      } else {
        toast.success(r.baixadas > 0
          ? `Pedido atualizado e ${r.baixadas} etiqueta(s) baixada(s).`
          : "Pedido atualizado.");
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível atualizar o pedido."),
  });
}

export function useDevolverTags() {
  const invalidar = useInvalidarEstoque();
  return useMutation({
    mutationFn: async (p: { codigos: string[]; estado: string; observacao?: string | null }) => {
      const { data, error } = await sb.rpc("sup_est_devolver", {
        p_codigos: p.codigos, p_estado: p.estado, p_observacao: p.observacao ?? null,
      });
      if (error) throw error;
      return data as { devolvidas: number; rejeitadas: { codigo: string; motivo: string }[] };
    },
    onSuccess: (r) => {
      invalidar();
      if (r.rejeitadas?.length) {
        toast.warning(`${r.devolvidas} devolvida(s), ${r.rejeitadas.length} recusada(s).`, {
          description: r.rejeitadas.map((x) => `${x.codigo}: ${x.motivo}`).join(" · "),
          duration: 10000,
        });
      } else {
        toast.success(`${r.devolvidas} etiqueta(s) devolvida(s) ao estoque.`);
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível devolver."),
  });
}

export function useRemoverTag() {
  const invalidar = useInvalidarEstoque();
  return useMutation({
    mutationFn: async (codigo: string) => {
      const { data, error } = await sb.rpc("sup_est_remover_tag", { p_codigo: codigo });
      if (error) throw error;
      return data as { acao: string; saldo?: number; restantes?: number };
    },
    onSuccess: (r) => {
      invalidar();
      toast.success(
        r.acao === "decrementou" ? `Uma unidade removida (saldo: ${r.saldo}).`
        : r.acao === "removeu_item" ? "Última etiqueta removida — o item saiu do estoque."
        : "Etiqueta removida.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível remover."),
  });
}
