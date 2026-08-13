import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { MaloteDespesaRow, StatusDespesa } from "@/hooks/useMaloteDespesa";

/**
 * SIS-2026-0112 — a perna de Suprimentos no fluxo do Malote.
 *
 * O item chega em `aguardando_cotacao` ("Cotação Pendente"), Suprimentos
 * preenche até 3 cotações, envia (`cotacao_realizada`) e decide: aprova
 * escolhendo o vencedor (`cotacao_aprovada`, que preenche
 * `valor_aprovado_cotacao`) ou reprova (`solicitacao_reprovada`).
 *
 * TODA escrita passa por RPC. A RLS de `malote_despesa` só deixa o CRIADOR
 * (ou admin/supervisor por cargo) alterar, então um comprador não conseguiria
 * cotar a solicitação de outra pessoa por UPDATE direto. As RPCs são
 * SECURITY DEFINER e checam `can_access(..., 'sup_cotacoes_malote', ...)` —
 * assim a RLS do Malote fica intacta e a permissão vive no Acesso por Usuário.
 *
 * Leitura é direta: o SELECT do Malote já libera por empresa.
 */

const sb = supabase as any;
const CHAVE = "malote_cotacao";

/** O que Suprimentos enxerga: a fase Solicitação. `rascunho` fica de fora
 *  (ainda não foi enviado) e a fase Despesa é do Malote. */
export const STATUS_SUPRIMENTOS: StatusDespesa[] = [
  "aguardando_cotacao", "cotacao_realizada", "cotacao_aprovada",
  "solicitacao_reprovada", "cancelada",
];

/** Rótulos do chamado, que não são os do banco. */
export const ROTULO_COTACAO: Partial<Record<StatusDespesa, string>> = {
  aguardando_cotacao: "Cotação Pendente",
  cotacao_realizada: "Aguardando Aprovação Cotação",
  cotacao_aprovada: "Cotação Aprovada e Finalizada",
  solicitacao_reprovada: "Cotação Reprovada",
  cancelada: "Cotação Cancelada",
};

export interface Cotacao {
  fornecedor: string;
  valor: string;
  prazo: string;
  link: string;
  anexo_path: string;
  anexo_nome: string;
}

export const COTACAO_VAZIA: Cotacao = {
  fornecedor: "", valor: "", prazo: "", link: "", anexo_path: "", anexo_nome: "",
};

/** Espalha as colunas cotN_* de volta em uma lista de 3, para a tela. */
export function lerCotacoes(d: MaloteDespesaRow | undefined | null): Cotacao[] {
  const um = (n: 1 | 2 | 3): Cotacao => ({
    fornecedor: (d as any)?.[`cot${n}_fornecedor`] ?? "",
    valor: (d as any)?.[`cot${n}_valor`] != null ? String((d as any)[`cot${n}_valor`]) : "",
    prazo: (d as any)?.[`cot${n}_prazo`] ?? "",
    link: (d as any)?.[`cot${n}_link`] ?? "",
    anexo_path: (d as any)?.[`cot${n}_anexo_path`] ?? "",
    anexo_nome: (d as any)?.[`cot${n}_anexo_nome`] ?? "",
  });
  return [um(1), um(2), um(3)];
}

export const cotacaoPreenchida = (c: Cotacao) => !!c.fornecedor.trim();

// ── Lista ────────────────────────────────────────────────────────────

export function useSolicitacoesParaCotar(empresaId: string | null) {
  return useQuery({
    queryKey: [CHAVE, "lista", empresaId],
    enabled: !!empresaId,
    staleTime: 30_000,
    queryFn: async (): Promise<MaloteDespesaRow[]> => {
      const { data, error } = await sb
        .from("malote_despesa")
        .select("*, classificacao:classificacao_id(id, nome)")
        .eq("empresa_id", empresaId)
        .in("status", STATUS_SUPRIMENTOS)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSolicitacaoParaCotar(id: string | undefined) {
  return useQuery({
    queryKey: [CHAVE, "item", id],
    enabled: !!id,
    queryFn: async (): Promise<MaloteDespesaRow> => {
      const { data, error } = await sb
        .from("malote_despesa")
        .select("*, classificacao:classificacao_id(id, nome)")
        .eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Painel "Compras passadas". Não existe base de compras consolidada no ERP:
 * o histórico nasce das próprias cotações aprovadas deste módulo, por
 * classificação. Começa vazio — é o que o mock 3.1.1 já desenha.
 */
export interface ComprasPassadas {
  compras: number;
  valor_medio: number | null;
  fornecedor_frequente: string | null;
  fornecedor_pct: number | null;
  ultima_valor: number | null; ultima_data: string | null; ultima_fornecedor: string | null;
  menor_valor: number | null; menor_data: string | null; menor_fornecedor: string | null;
}

export function useComprasPassadas(classificacaoId: string | null, ignorarId?: string) {
  return useQuery({
    queryKey: [CHAVE, "historico", classificacaoId, ignorarId],
    enabled: !!classificacaoId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ComprasPassadas | null> => {
      const { data, error } = await sb.rpc("sup_malote_compras_passadas", {
        p_classificacao_id: classificacaoId,
        p_ignorar_id: ignorarId ?? null,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

// ── Escrita ──────────────────────────────────────────────────────────

function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [CHAVE] });
    // A tela do Malote lê pela chave dele; sem isto o outro lado fica velho.
    qc.invalidateQueries({ queryKey: ["malote_despesa"] });
  };
}

/** Só as posições preenchidas viram payload; as vazias limpam a coluna. */
const paraPayload = (cots: Cotacao[]) =>
  cots.map((c) => (cotacaoPreenchida(c)
    ? { fornecedor: c.fornecedor.trim(), valor: c.valor, prazo: c.prazo,
        link: c.link.trim(), anexo_path: c.anexo_path, anexo_nome: c.anexo_nome }
    : {}));

export function useSalvarRascunhoCotacao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { id: string; cotacoes: Cotacao[] }) => {
      const { error } = await sb.rpc("sup_malote_salvar_rascunho", {
        p_id: v.id, p_cotacoes: paraPayload(v.cotacoes),
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Rascunho salvo."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível salvar."),
  });
}

export function useEnviarCotacao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { id: string; cotacoes: Cotacao[] }) => {
      const { error } = await sb.rpc("sup_malote_enviar_cotacao", {
        p_id: v.id, p_cotacoes: paraPayload(v.cotacoes),
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Cotação enviada para aprovação."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível enviar."),
  });
}

export function useAprovarCotacao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { id: string; vencedor: 1 | 2 | 3; observacoes?: string }) => {
      const { error } = await sb.rpc("sup_malote_aprovar_cotacao", {
        p_id: v.id, p_vencedor: v.vencedor, p_observacoes: v.observacoes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Cotação aprovada. A solicitação volta para o Malote."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível aprovar."),
  });
}

export function useReprovarCotacao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { id: string; motivo: string }) => {
      const { error } = await sb.rpc("sup_malote_reprovar_cotacao", { p_id: v.id, p_motivo: v.motivo });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Cotação reprovada."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível reprovar."),
  });
}

export function useCancelarCotacao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { id: string; motivo?: string }) => {
      const { error } = await sb.rpc("sup_malote_cancelar_cotacao", { p_id: v.id, p_motivo: v.motivo ?? null });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Solicitação cancelada."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível cancelar."),
  });
}

// ── Utilitários de tela ──────────────────────────────────────────────

export const fmtBRL = (v: number | string | null | undefined) =>
  v == null || v === "" ? "—"
    : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const fmtData = (iso: string | null) =>
  !iso ? "—" : new Date(iso).toLocaleDateString("pt-BR");

export const fmtDataHora = (iso: string | null) =>
  !iso ? "—" : new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Abre anexo do bucket privado do Malote. */
export async function abrirAnexoMalote(path: string) {
  const { data, error } = await supabase.storage.from("malote-anexos").createSignedUrl(path, 300);
  if (error || !data) { toast.error("Não foi possível abrir o anexo."); return; }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}
