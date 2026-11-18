import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { nomeSeguro } from "@/lib/solicitacoes/anexos";
import type { CalcadoOrtopedico, StatusCalcado } from "@/lib/sst/calcadosOrtopedicos";

// SIS-2026-0888. As tabelas não têm acesso direto: tudo passa por RPC com gate
// próprio (sst_calcado_exige). O laudo mora no bucket privado abaixo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "sst-calcados";
export const BUCKET_LAUDO_CALCADO = "sst-calcados-laudos";
export const MENU_CALCADOS = "sst_calcados_ortopedicos";
export const ACCEPT_LAUDO = ".pdf,.jpg,.jpeg,.png,.webp";
const TIPOS_LAUDO = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const LAUDO_MAX_BYTES = 10 * 1024 * 1024;
const verificar = (error: { message?: string } | null) => { if (error) throw new Error(error.message ?? "Erro no SST"); };

export interface HistoricoCalcado { id: number; descricao: string; autor_nome: string | null; created_at: string }
export interface CalcadoDoPedido {
  id: number; pedido_id: string; pedido_item_id: string | null; status: StatusCalcado;
  laudo_nome: string | null; laudo_path: string | null; updated_at: string;
}

/** Recusa antes de subir: o bucket recusaria depois, com mensagem pior. */
export function erroDoLaudo(arquivo: File): string | null {
  if (!TIPOS_LAUDO.includes(arquivo.type)) return "Use PDF, JPG, PNG ou WebP para o laudo.";
  if (arquivo.size > LAUDO_MAX_BYTES) return `"${arquivo.name}" passa de 10 MB, o limite do laudo.`;
  return null;
}

export const useCalcadosOrtopedicos = () => useQuery({
  queryKey: [K, "lista"],
  queryFn: async (): Promise<CalcadoOrtopedico[]> => {
    const { data, error } = await sb.rpc("sst_calcados_lista"); verificar(error); return data ?? [];
  },
});
export const useHistoricoCalcado = (id: number | null) => useQuery({
  queryKey: [K, "historico", id], enabled: id != null,
  queryFn: async (): Promise<HistoricoCalcado[]> => {
    const { data, error } = await sb.rpc("sst_calcado_historico", { p_id: id }); verificar(error); return data ?? [];
  },
});
/** Card do Compras: só os pedidos da página. Sem acesso, a RPC devolve vazio. */
export const useCalcadosDosPedidos = (pedidoIds: string[]) => useQuery({
  queryKey: [K, "pedidos", [...pedidoIds].sort().join(",")], enabled: pedidoIds.length > 0, staleTime: 60_000,
  queryFn: async (): Promise<CalcadoDoPedido[]> => {
    const { data, error } = await sb.rpc("sup_pedido_calcados", { p_pedido_ids: pedidoIds }); verificar(error); return data ?? [];
  },
});

export async function abrirLaudo(c: { laudo_path: string | null }) {
  if (!c.laudo_path) return;
  const { data, error } = await supabase.storage.from(BUCKET_LAUDO_CALCADO).createSignedUrl(c.laudo_path, 300);
  verificar(error);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

function useMutacao<T, R>(fn: (p: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [K] }) });
}
export const useSalvarCalcado = () => useMutacao(async (p: { id: number; status: StatusCalcado; observacoes: string }) => {
  const { error } = await sb.rpc("sst_calcado_salvar", { p_id: p.id, p_status: p.status, p_observacoes: p.observacoes });
  verificar(error);
});

/** Sobe o arquivo e registra; se o registro falhar, o arquivo enviado sai. */
async function subirLaudo(caminho: string, arquivo: File, registrar: () => Promise<{ data: unknown; error: { message?: string } | null }>) {
  const invalido = erroDoLaudo(arquivo);
  if (invalido) throw new Error(invalido);
  const storage = supabase.storage.from(BUCKET_LAUDO_CALCADO);
  const { error: uploadError } = await storage.upload(caminho, arquivo);
  verificar(uploadError);
  const { data, error } = await registrar();
  if (error) { await storage.remove([caminho]); verificar(error); }
  return data;
}

export const useAnexarLaudoCalcado = () => useMutacao(async ({ id, arquivo }: { id: number; arquivo: File }) => {
  const caminho = `controle/${id}/${Date.now()}_${nomeSeguro(arquivo.name)}`;
  const antigo = await subirLaudo(caminho, arquivo, () => sb.rpc("sst_calcado_anexar_laudo", {
    p_id: id, p_nome: arquivo.name, p_path: caminho, p_tamanho: arquivo.size,
  }));
  if (antigo) await supabase.storage.from(BUCKET_LAUDO_CALCADO).remove([antigo as string]);
});

/**
 * Encarregado, logo depois de criar o pedido (Solicitar Materiais). Quem
 * libera é ser o autor do pedido — o encarregado externo não tem tela do SST.
 */
export async function anexarLaudoNoPedido(pedidoUuid: string, arquivo: File): Promise<void> {
  const caminho = `pedido/${pedidoUuid}/${Date.now()}_${nomeSeguro(arquivo.name)}`;
  await subirLaudo(caminho, arquivo, () => sb.rpc("sup_pedido_anexar_laudo", {
    p_pedido_id: pedidoUuid, p_nome: arquivo.name, p_path: caminho, p_tamanho: arquivo.size,
  }));
}
