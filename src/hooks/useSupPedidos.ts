import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Pedidos de materiais — cascata do encarregado e fila operacional do Supply.
 *
 * A cascata e a criação passam pelas RPCs sup_ext_* (SECURITY DEFINER): elas
 * devolvem só o mínimo de cada nível e conferem, a cada chamada, que o
 * contrato/posto/função pedido pertence de fato a quem está chamando. Isso
 * evita abrir SELECT em public.contratos para o usuário externo, que traria
 * junto valor_mensal, valor_global e cnpj_cliente.
 *
 * Ver supabase/migrations/20260819000003_supply_rpcs_externo.sql.
 */

const sb = supabase as any;

export const STATUS_PEDIDO = [
  "EM PREPARACAO",
  "AGUARDANDO ENVIO",
  "AGUARDANDO COMPRA",
  "DESPACHADO",
  "CANCELADO",
] as const;
export type StatusPedido = (typeof STATUS_PEDIDO)[number];

/** Paleta e ícone por status — mesma semântica do legado (REPLICAR §5.5). */
export const ESTILO_STATUS: Record<string, { classe: string; rotulo: string }> = {
  "EM PREPARACAO": { classe: "border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", rotulo: "Em preparação" },
  "AGUARDANDO ENVIO": { classe: "border-blue-400/50 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300", rotulo: "Aguardando envio" },
  "AGUARDANDO COMPRA": { classe: "border-orange-400/50 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300", rotulo: "Aguardando compra" },
  "DESPACHADO": { classe: "border-emerald-400/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", rotulo: "Despachado" },
  "CANCELADO": { classe: "border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", rotulo: "Cancelado" },
};

/**
 * Status por ITEM — derivado, nunca guardado (SIS-2026-0201).
 *
 * O gerente de Suprimentos precisa exportar "só o que ficou pendente" para
 * abrir a solicitação de compra: o encarregado pede camiseta, jaqueta, calça e
 * butina, três saem e a butina falta. Com o status só no pedido, as quatro
 * linhas saem como "AGUARDANDO COMPRA" e ele apaga na mão.
 *
 * A informação já existia: quem responde "esta peça saiu?" é a ETIQUETA, não
 * uma coluna. CardPedido já usa isso para esconder o que está separado quando
 * o pedido está em AGUARDANDO COMPRA. Aqui a mesma regra vira status nomeado,
 * reaproveitável no filtro e no Excel.
 *
 * Deliberadamente NÃO existe `sup_pedido_item.status`: seria uma segunda
 * verdade sobre o mesmo fato, e o módulo já pagou esse preço uma vez — o
 * legado tinha trigger e query calculando saldo de formas diferentes e ninguém
 * sabia qual valia (REPLICAR-MODULO-COMPRAS.md §12.8).
 */
export const STATUS_ITEM = [
  "PENDENTE",
  "SEPARADO",
  "AGUARDANDO COMPRA",
  "DESPACHADO",
  "CANCELADO",
] as const;
export type StatusItem = (typeof STATUS_ITEM)[number];

export const ESTILO_STATUS_ITEM: Record<StatusItem, { classe: string; rotulo: string }> = {
  "PENDENTE": { classe: "border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", rotulo: "Pendente" },
  "SEPARADO": { classe: "border-blue-400/50 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300", rotulo: "Separado" },
  "AGUARDANDO COMPRA": { classe: "border-orange-400/50 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300", rotulo: "Aguardando compra" },
  "DESPACHADO": { classe: "border-emerald-400/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", rotulo: "Despachado" },
  "CANCELADO": { classe: "border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", rotulo: "Cancelado" },
};

/**
 * Resolve o status de UM item a partir do status do pedido e de a peça ter ou
 * não etiqueta vinculada.
 *
 * O pedido cancelado cancela tudo — não interessa se chegou a separar. Fora
 * isso, ter etiqueta significa que a peça saiu do estoque para este item; o
 * status do pedido só decide se ela já foi despachada ou está separada
 * esperando logística.
 */
export function derivarStatusItem(statusPedido: string, temTag: boolean): StatusItem {
  if (statusPedido === "CANCELADO") return "CANCELADO";
  if (temTag) return statusPedido === "DESPACHADO" ? "DESPACHADO" : "SEPARADO";
  return statusPedido === "AGUARDANDO COMPRA" ? "AGUARDANDO COMPRA" : "PENDENTE";
}

export interface OpcaoCascata { id: string; nome: string }
export interface ItemEnxoval {
  id: string; nome: string; tipo: string;
  opcao_tamanho: string[] | null;
  opcao_quantidade: string[] | null;
  opcao_litros: string[] | null;
}
export interface SessaoExterna {
  user_id: string;
  login_informado: string;
  contrato_id: string;
  /** Identidade vinda do cadastro de EMPREGADOS (CPF + nascimento no login). */
  empregado_id: number | null;
  empregado_nome: string | null;
}
export interface PedidoItem {
  nome: string; tipo: string; tamanho: string | null; quantidade: number; litros: string | null;
}
export interface MeuPedido {
  id: string; pedido_id: string; status: string; data_solicitacao: string;
  contrato_nome: string; posto_nome: string; funcao_nome: string;
  nome_colaborador: string; matricula_colaborador: string | null;
  tipo_pedido: string; observacoes_solicitante: string | null; observacao: string | null;
  data_despachado: string | null; created_at: string;
  itens: PedidoItem[];
}

/** Data de hoje montada por componentes locais. `toISOString()` no fuso do
 *  Brasil devolve o dia anterior depois das 21h — os dois documentos do
 *  legado descrevem exatamente esse bug. */
export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Formata 'YYYY-MM-DD' sem passar por Date quando já está no formato certo. */
export function fmtDataBR(v?: string | null): string {
  if (!v) return "—";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  return isNaN(+d) ? "—" : d.toLocaleDateString("pt-BR");
}

// ── Sessão externa ───────────────────────────────────────────────────

export function useSessaoExterna(enabled = true) {
  return useQuery({
    queryKey: ["sup_ext_sessao"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SessaoExterna | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await sb
        .from("sup_ext_sessao")
        .select("user_id, login_informado, contrato_id, empregado_id, empregado_nome")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (error) return null;
      return data ?? null;
    },
  });
}

// ── Cascata ──────────────────────────────────────────────────────────

/** Contratos disponíveis para o select — usado na aba Externo do login. */
export function useContratosExternos(enabled = true) {
  return useQuery({
    queryKey: ["sup_ext_contratos"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<OpcaoCascata[]> => {
      const { data, error } = await sb.rpc("sup_ext_contratos");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePostosPedido(contratoId: string | null) {
  return useQuery({
    queryKey: ["sup_ext_postos", contratoId],
    enabled: !!contratoId,
    queryFn: async (): Promise<OpcaoCascata[]> => {
      const { data, error } = await sb.rpc("sup_ext_postos", { p_contrato_id: contratoId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useFuncoesPedido(postoId: string | null) {
  return useQuery({
    queryKey: ["sup_ext_funcoes", postoId],
    enabled: !!postoId,
    queryFn: async (): Promise<OpcaoCascata[]> => {
      const { data, error } = await sb.rpc("sup_ext_funcoes", { p_posto_id: postoId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useItensEnxoval(funcaoId: string | null) {
  return useQuery({
    queryKey: ["sup_ext_itens", funcaoId],
    enabled: !!funcaoId,
    queryFn: async (): Promise<ItemEnxoval[]> => {
      const { data, error } = await sb.rpc("sup_ext_itens", { p_funcao_id: funcaoId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Criação ──────────────────────────────────────────────────────────

export interface NovoPedido {
  contrato_id: string;
  posto_id: string;
  funcao_id: string;
  /**
   * EMPREGADOS."ID" do colaborador escolhido na lista. A RPC resolve nome e
   * matrícula a partir dele NO SERVIDOR e ignora o que vier nos campos de
   * texto — é o que impede inventar colaborador.
   */
  colaborador_empregado_id?: number | null;
  /** Só vale quando `admissao` é true: a pessoa ainda não está na folha. */
  nome_colaborador?: string | null;
  admissao?: boolean;
  tipo_admissao?: string | null;
  data_admissao?: string | null;
  imagem_cracha_path?: string | null;
  tipo_pedido: "uniforme" | "insumos" | "ambos";
  observacoes_solicitante?: string | null;
  solicitante_nome?: string | null;
  itens: { item_id: string; nome_item: string; tamanho?: string | null; quantidade: number; litros?: string | null }[];
}

export function useCriarPedido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: NovoPedido) => {
      const { data, error } = await sb.rpc("sup_ext_criar_pedido", { p_payload: p });
      if (error) throw error;
      return data as { id: string; pedido_id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sup_ext_meus_pedidos"] });
      qc.invalidateQueries({ queryKey: ["sup_pedido"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível enviar o pedido."),
  });
}

/**
 * Envia a foto do crachá. Uma falha aqui NÃO derruba o pedido, mas o chamador
 * é avisado — no legado o erro só ia para o console e o usuário achava que
 * tinha anexado (REPLICAR-MODULO-COMPRAS.md §12.11).
 */
export async function enviarFotoCracha(arquivo: File): Promise<string | null> {
  const ext = (arquivo.name.split(".").pop() || "jpg").toLowerCase();
  const caminho = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("sup-crachas").upload(caminho, arquivo, { upsert: false });
  if (error) throw error;
  return caminho;
}

// ── Acompanhamento (solicitante) ─────────────────────────────────────

export function useMeusPedidos() {
  return useQuery({
    queryKey: ["sup_ext_meus_pedidos"],
    queryFn: async (): Promise<MeuPedido[]> => {
      const { data, error } = await sb.rpc("sup_ext_meus_pedidos");
      if (error) throw error;
      return data ?? [];
    },
  });
}
