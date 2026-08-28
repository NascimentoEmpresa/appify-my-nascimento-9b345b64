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
  /** Código interno do produto, imutável — o que se bipa (ajuste 7 do Cassio). */
  codigo_item: string | null;
  /**
   * Códigos dos lotes/etiquetas ainda disponíveis deste item.
   *
   * Existe só para a BUSCA. Há 9.248 etiquetas antigas com rótulo físico ainda
   * colado na peça (e lotes herdados do legado, tipo "INS-0065"): quem bipa uma
   * delas precisa cair no item, senão a transição para o código do produto
   * quebra a consulta no chão de almoxarifado.
   */
  codigos_lote: string[];
  material: string;
  tipo_material: string;
  almoxarifado: string;
  /** Último valor pago, do cadastro do item de estoque. */
  valor_unitario: number;
  /** Custo que a tela mostra — ver `custoDoItem` (SIS-2026-0199). */
  custo_unitario: number;
  /** `custo_unitario` × disponível. */
  valor_total: number;
  /** Até quando o fornecedor segura este preço. */
  preco_valido_ate: string | null;
  preco_vencido: boolean;
  estoque_minimo: number;
  disponivel: number;
  consumido: number;
  etiquetas: number;
  tamanhos: string[];
}

/**
 * Qual custo mostrar quando as etiquetas do mesmo material têm valores
 * diferentes (SIS-2026-0199).
 *
 * Acontece de verdade: a peça devolvida e higienizada vale menos que a nova.
 * Nas palavras do gerente de Suprimentos:
 *
 *   "Comprei do Roverim, comprei da Invest, e eu tenho o higienizado que cai
 *    pela metade. Não tem como nós fazer uma média. Tem que manter o mais
 *    alto, pra nós não perder dinheiro."
 *
 * Então prevalece o MAIOR valor entre as etiquetas disponíveis, com o valor do
 * cadastro como piso — é ele que responde quando não há etiqueta com preço
 * próprio, que é o caso comum.
 */
export function custoDoItem(valorCadastro: number, valoresDasTags: (number | null)[]): number {
  const validos = valoresDasTags.map((v) => Number(v ?? 0)).filter((v) => v > 0);
  return Math.max(Number(valorCadastro ?? 0), ...(validos.length ? validos : [0]));
}

export function fmtBRL(v?: number | null): string {
  return Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Preço com validade no passado não serve para cotar — só para consultar. */
export function precoVencido(validoAte?: string | null): boolean {
  if (!validoAte) return false;
  // Compara por data local, sem passar por UTC (o clássico "andou um dia").
  const hoje = new Date();
  const h = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  return validoAte < h;
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
        .select(`id, valor_unitario, estoque_minimo, preco_valido_ate,
                 sup_item:sup_item_id (id, nome, tipo, codigo),
                 almoxarifado:almoxarifado_id (nome),
                 sup_estoque_tag (codigo, tamanho, tipo, usado, quantidade_massa, quantidade_original_massa, valor_unitario)`);
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
        // Custo pelas etiquetas AINDA DISPONÍVEIS: peça já consumida não deve
        // puxar o custo do que está em estoque hoje.
        const custo = custoDoItem(
          Number(r.valor_unitario ?? 0),
          tags.filter((t: any) => !t.usado).map((t: any) => t.valor_unitario),
        );

        return {
          item_estoque_id: r.id,
          sup_item_id: r.sup_item?.id,
          codigo_item: r.sup_item?.codigo ?? null,
          codigos_lote: tags.filter((t: any) => !t.usado && t.codigo).map((t: any) => String(t.codigo)),
          material: r.sup_item?.nome ?? "—",
          tipo_material: r.sup_item?.tipo ?? "",
          almoxarifado: r.almoxarifado?.nome ?? "—",
          valor_unitario: Number(r.valor_unitario ?? 0),
          custo_unitario: custo,
          valor_total: custo * disponivel,
          preco_valido_ate: r.preco_valido_ate ?? null,
          preco_vencido: precoVencido(r.preco_valido_ate),
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

// ── Preços (SIS-2026-0199) ───────────────────────────────────────────

export interface PrecoHistorico {
  valor_unitario: number; valor_anterior: number | null; valido_ate: string | null;
  origem: "entrada" | "nf" | "ajuste"; fornecedor_nome: string | null;
  documento: string | null; registrado_em: string;
  registrado_por_nome: string | null; almoxarifado: string | null;
}

export interface PrecoConsulta {
  sup_item_id: string; material: string; tipo: string;
  valor_unitario: number; valido_ate: string | null; vencido: boolean;
  fornecedor_nome: string | null; atualizado_em: string; almoxarifado: string | null;
}

/** Quanto já se pagou por este material, do mais recente para trás. */
export function useHistoricoPreco(supItemId: string | null) {
  return useQuery({
    queryKey: ["sup_item_precos", supItemId],
    enabled: !!supItemId,
    queryFn: async (): Promise<PrecoHistorico[]> => {
      const { data, error } = await sb.rpc("sup_item_precos", { p_sup_item_id: supItemId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Preço vigente por material — a consulta que a Licitação usa para não
 * depender do comprador estar disponível para cotar.
 */
export function usePrecosConsulta(busca: string) {
  return useQuery({
    queryKey: ["sup_precos_consulta", busca],
    queryFn: async (): Promise<PrecoConsulta[]> => {
      const { data, error } = await sb.rpc("sup_precos_consulta", { p_busca: busca || null });
      if (error) throw error;
      return data ?? [];
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

/** Etiqueta de um item de pedido, na versão em lote. */
export interface TagEmLote {
  pedido_id: string;
  pedido_item_id: string;
  codigo: string;
  tipo: TipoTag;
  quantidade: number;
  valor_unitario: number | null;
}

/** Quantos ids cabem por requisição sem estourar o tamanho da URL do PostgREST. */
const LOTE_IDS = 150;

async function emLotes<T>(ids: string[], fn: (fatia: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    out.push(...(await fn(ids.slice(i, i + LOTE_IDS))));
  }
  return out;
}

/**
 * Mesma resposta de `useTagsDoPedido`, só que para MUITOS pedidos de uma vez
 * (SIS-2026-0201).
 *
 * Por que não chamar a RPC num laço: o Excel do Suprimentos sai com ~1.450
 * pedidos. Seriam 1.450 chamadas para montar uma planilha.
 *
 * Esta é uma RÉPLICA EM LOTE da `sup_est_tags_do_pedido`, e a RPC continua
 * sendo a autoridade — a regra dela está em
 * supabase/migrations/20260820000002_supply_estoque_rpcs.sql:403. São dois
 * casos somados, e é preciso manter os dois em sincronia se a RPC mudar:
 *
 *   • etiqueta ÚNICA — a própria linha de sup_estoque_tag, quantidade 1,
 *     exceto quando aquele código já aparece no ledger do mesmo pedido
 *     (senão a peça seria contada duas vezes);
 *   • etiqueta em MASSA — vem do ledger sup_estoque_consumo, que é quem sabe
 *     quanto daquele lote foi para cada pedido. A tag em massa serve vários
 *     pedidos, então `sup_estoque_tag.pedido_item_id` não responde sozinho.
 *
 * Leitura direta em tabela é permitida: a regra do módulo — toda escrita passa
 * por RPC — vale para ESCRITA. A RLS de sup_estoque_tag já filtra por
 * `sup_estoque` / visualizar.
 */
export async function buscarTagsDePedidos(pedidoIds: string[]): Promise<TagEmLote[]> {
  if (pedidoIds.length === 0) return [];
  const [unicas, consumos] = await Promise.all([
    emLotes(pedidoIds, async (fatia) => {
      const { data, error } = await sb
        .from("sup_estoque_tag")
        .select("codigo, pedido_id, pedido_item_id, tipo, valor_unitario, sup_estoque_item:item_estoque_id (valor_unitario)")
        .in("pedido_id", fatia)
        .eq("tipo", "unico");
      if (error) throw error;
      return data ?? [];
    }),
    emLotes(pedidoIds, async (fatia) => {
      const { data, error } = await sb
        .from("sup_estoque_consumo")
        .select("codigo, pedido_id, pedido_item_id, quantidade, sup_estoque_item:item_estoque_id (valor_unitario)")
        .in("pedido_id", fatia);
      if (error) throw error;
      return data ?? [];
    }),
  ]);

  // `codigo|pedido_id` que o ledger já cobre — a linha única correspondente
  // é descartada, igual ao NOT EXISTS da RPC.
  const noLedger = new Set(consumos.map((c: any) => `${c.codigo}|${c.pedido_id}`));

  const linhas: TagEmLote[] = [];
  for (const t of unicas as any[]) {
    if (!t.pedido_item_id || noLedger.has(`${t.codigo}|${t.pedido_id}`)) continue;
    linhas.push({
      pedido_id: t.pedido_id, pedido_item_id: t.pedido_item_id,
      codigo: t.codigo, tipo: "unico", quantidade: 1,
      valor_unitario: t.valor_unitario ?? t.sup_estoque_item?.valor_unitario ?? null,
    });
  }
  for (const c of consumos as any[]) {
    linhas.push({
      pedido_id: c.pedido_id, pedido_item_id: c.pedido_item_id,
      codigo: c.codigo, tipo: "massa", quantidade: Number(c.quantidade ?? 0),
      // O ledger não guarda valor: o preço vem do item de estoque.
      valor_unitario: c.sup_estoque_item?.valor_unitario ?? null,
    });
  }
  return linhas;
}

/** Versão reativa de `buscarTagsDePedidos`, para a tela filtrar por status de item. */
export function useTagsDePedidos(pedidoIds: string[], enabled = true) {
  return useQuery({
    queryKey: ["sup_tags_de_pedidos", pedidoIds.join(",")],
    enabled: enabled && pedidoIds.length > 0,
    queryFn: () => buscarTagsDePedidos(pedidoIds),
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
  /** Certificado pertence à remessa física, não ao cadastro do material. */
  ca_numero?: string | null;
  ca_validade?: string | null;
}

/** Uma remessa: um tamanho, uma quantidade, um CA. */
export interface RemessaEntrada {
  tamanho: string;
  quantidade: number;
  ca_numero?: string | null;
  ca_validade?: string | null;
}

/**
 * Entrada por QUANTIDADE — ajuste 7 do Cassio.
 *
 * "Cada item, ao invés de ter uma tag, ter um código interno do produto, onde
 * somente é adicionado quantidades dele."
 *
 * O que ele estava resolvendo: duas peças idênticas com etiquetas diferentes
 * obrigam quem separa a escolher qual é qual, e não há resposta certa. Bipando
 * o produto e informando quantidade, a pergunta deixa de existir.
 *
 * Uma chamada por remessa, de propósito. Cada remessa vira um lote com o seu
 * próprio custo e CA — juntar tornaria o custo uma média, e o Cassio já disse
 * no 0199 que média não serve ("o último valor pago").
 *
 * Sucesso parcial é possível e é o comportamento certo: se a terceira remessa
 * falhar, as duas primeiras JÁ entraram no estoque e desfazê-las seria mentir
 * sobre o que está na prateleira. O aviso diz exatamente quais faltaram.
 */
export function useEntradaPorQuantidade() {
  const invalidar = useInvalidarEstoque();
  return useMutation({
    mutationFn: async (p: {
      almoxarifado_id: string; sup_item_id: string;
      valor_unitario?: number; estoque_minimo?: number;
      fornecedor_id?: string | null;
      validade?: string | null; observacao?: string | null;
      preco_valido_ate?: string | null;
      remessas: RemessaEntrada[];
    }) => {
      let gravadas = 0;
      const falhas: string[] = [];

      for (const r of p.remessas) {
        const { error } = await sb.rpc("sup_est_entrada_quantidade", {
          p_payload: {
            almoxarifado_id: p.almoxarifado_id,
            sup_item_id: p.sup_item_id,
            quantidade: r.quantidade,
            tamanho: r.tamanho || null,
            valor_unitario: p.valor_unitario ?? null,
            estoque_minimo: p.estoque_minimo ?? 0,
            fornecedor: p.fornecedor_id ?? null,
            validade: p.validade ?? null,
            observacao: p.observacao ?? null,
            ca_numero: r.ca_numero ?? null,
            ca_validade: r.ca_validade ?? null,
          },
        });
        if (error) falhas.push(`${r.tamanho || "sem tamanho"}: ${error.message}`);
        else gravadas += r.quantidade;
      }

      // Mesma decisão de useEntradaEstoque: a validade do preço é uma chamada à
      // parte, e falhar nela não desfaz a entrada — o material já está lá.
      if (gravadas > 0 && p.preco_valido_ate) {
        const { error: e2 } = await sb.rpc("sup_est_validade_preco", {
          p_almoxarifado_id: p.almoxarifado_id,
          p_sup_item_id: p.sup_item_id,
          p_valido_ate: p.preco_valido_ate,
        });
        if (e2) toast.warning("Entrada gravada, mas a validade do preço não foi salva.");
      }

      if (gravadas === 0 && falhas.length) throw new Error(falhas.join(" · "));
      return { gravadas, falhas };
    },
    onSuccess: (r) => {
      invalidar();
      if (r.falhas.length) {
        toast.warning(`${r.gravadas} unidade(s) no estoque, ${r.falhas.length} remessa(s) recusada(s).`, {
          description: r.falhas.join(" · "),
          duration: 10000,
        });
      } else {
        toast.success(`${r.gravadas} unidade(s) adicionada(s) ao estoque.`);
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível dar entrada."),
  });
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
      /** Até quando o fornecedor segura o preço (SIS-2026-0199). */
      preco_valido_ate?: string | null;
      unidades: UnidadeEntrada[];
    }) => {
      const { data, error } = await sb.rpc("sup_est_entrada", { p_payload: p });
      if (error) throw error;

      // Chamada à parte, e não um campo em sup_est_entrada: aquela RPC é o
      // caminho crítico do almoxarifado e não vale reescrevê-la inteira por um
      // campo opcional. Falhar aqui não desfaz a entrada — as etiquetas já
      // entraram, e é isso que importa para o operador.
      if (p.preco_valido_ate) {
        const { error: e2 } = await sb.rpc("sup_est_validade_preco", {
          p_almoxarifado_id: p.almoxarifado_id,
          p_sup_item_id: p.sup_item_id,
          p_valido_ate: p.preco_valido_ate,
        });
        if (e2) toast.warning("Entrada gravada, mas a validade do preço não foi salva.");
      }

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
    mutationFn: async (v: { codigo: string; motivo?: string | null }) => {
      const { data, error } = await sb.rpc("sup_est_remover_tag", {
        p_codigo: v.codigo, p_motivo: v.motivo?.trim() || null,
      });
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

// ── Histórico do material ────────────────────────────────────────────

export type TipoMovimento = "entrada" | "saida" | "devolucao" | "ajuste" | "remocao";

export interface Movimento {
  id: string;
  tipo: TipoMovimento;
  quantidade: number;
  codigo: string | null;
  tamanho: string | null;
  observacao: string | null;
  usuario_nome: string | null;
  created_at: string;
  /** Protocolo legível do pedido (PED-0142), quando a saída foi para um. */
  pedido_protocolo: string | null;
}

/**
 * A vida inteira de um material: entrada, saída (com o pedido), devolução,
 * remoção e inventário, em ordem cronológica inversa.
 *
 * Lê por `sup_item_id`, NÃO por `item_estoque_id`, e a diferença importa:
 * `sup_est_remover_tag` apaga o `sup_estoque_item` quando tira a última
 * etiqueta, e o movimento tem ON DELETE SET NULL — ancorar na linha de estoque
 * perderia o histórico exatamente do caso que mais interessa auditar. Ver a
 * migration 20260907000003.
 */
export function useHistoricoDoMaterial(supItemId: string | null) {
  return useQuery({
    queryKey: ["sup_estoque_movimento", supItemId],
    enabled: !!supItemId,
    queryFn: async (): Promise<Movimento[]> => {
      const { data, error } = await sb
        .from("sup_estoque_movimento")
        .select("id, tipo, quantidade, codigo, tamanho, observacao, usuario_nome, created_at, pedido:pedido_id (pedido_id)")
        .eq("sup_item_id", supItemId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((m: any) => ({
        ...m, pedido_protocolo: m.pedido?.pedido_id ?? null,
      }));
    },
  });
}

export interface ResultadoInventario {
  inventario_id: string;
  esperadas: number;
  encontradas: number;
  divergencia: number;
  /** Etiquetas que o sistema tem como livres e não foram achadas na prateleira. */
  faltantes: string[];
  /** Bipadas que não pertencem a este material, ou que já estavam baixadas. */
  estranhas: string[];
}

/**
 * Registra um inventário. NÃO corrige o estoque de propósito: confronta o
 * físico com o sistema, grava a divergência e para por aí — apurar o que
 * aconteceu (câmera, relatório, quem deu baixa) é trabalho humano depois, e
 * baixar etiqueta sozinho destruiria a prova.
 */
export function useInventario() {
  const invalidar = useInvalidarEstoque();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { itemEstoqueId: string; codigos: string[]; observacao?: string | null }) => {
      const { data, error } = await sb.rpc("sup_est_inventario", {
        p_item_estoque_id: v.itemEstoqueId,
        p_codigos: v.codigos,
        p_observacao: v.observacao?.trim() || null,
      });
      if (error) throw error;
      return data as ResultadoInventario;
    },
    onSuccess: (r) => {
      invalidar();
      qc.invalidateQueries({ queryKey: ["sup_estoque_movimento"] });
      toast.success(
        r.divergencia === 0
          ? `Inventário fechado: ${r.encontradas} de ${r.esperadas} conferidas.`
          : `Inventário com divergência de ${r.divergencia}: ${r.encontradas} de ${r.esperadas} conferidas.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível registrar o inventário."),
  });
}
