import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { erroDoAnexo, nomeSeguro } from "@/lib/solicitacoes/anexos";
import type { CategoriaDoc, ControleItem } from "@/lib/sst/controleAfastamentos";

// =====================================================================
// SST › Controle de Afastamentos (mig 20261105030000). Tudo pelas RPCs
// sst_ctrl_afa_*; os arquivos ficam no bucket privado e abrem por link assinado.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "sst-controle-afastamentos";
export const BUCKET_CONTROLE = "sst-controle-afastamentos";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

export interface ColaboradorControle { id: number; nome: string; situacao: string | null; filial: string | null; cargo: string | null }
export interface ContatoControle { id: number; data_contato: string; observacao: string; retorno_informado_em: string | null; autor_nome: string | null }
export interface RecursoControle { id: number; instancia: "inss" | "judicial"; tipo: string; situacao: string; protocolo: string | null; data_recurso: string | null; observacao: string | null }
export interface DocControle { id: number; categoria: CategoriaDoc; nome: string; storage_path: string; tamanho: number | null; enviado_por: string | null; created_at: string }
export interface EventoControle { id: number; tipo: string; descricao: string | null; autor_nome: string | null; created_at: string }
export interface FichaControle extends Omit<ControleItem, "recursos"> {
  recursos: RecursoControle[];
  documentos: DocControle[];
  contatos: ContatoControle[];
  eventos: EventoControle[];
}

export const useListaControle = () => useQuery({
  queryKey: [K, "lista"],
  queryFn: async (): Promise<ControleItem[]> => {
    const { data, error } = await sb.rpc("sst_ctrl_afa_lista");
    erro(error);
    return (data ?? []) as ControleItem[];
  },
});

export const useFichaControle = (id: number | null) => useQuery({
  queryKey: [K, "ficha", id], enabled: id != null,
  queryFn: async (): Promise<FichaControle | null> => {
    const { data, error } = await sb.rpc("sst_ctrl_afa_ficha", { p_id: id });
    erro(error);
    return data as FichaControle | null;
  },
});

export async function buscarColaboradoresControle(busca: string): Promise<ColaboradorControle[]> {
  const { data, error } = await sb.rpc("sst_ctrl_afa_colaboradores", { p_busca: busca });
  erro(error);
  return (data ?? []) as ColaboradorControle[];
}

export async function abrirDocumentoControle(doc: Pick<DocControle, "storage_path">) {
  const { data, error } = await supabase.storage.from(BUCKET_CONTROLE).createSignedUrl(doc.storage_path, 300);
  erro(error);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

function useMutacao<T, R>(fn: (p: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [K] }) });
}

export const useSalvarControle = () => useMutacao(async (p: Record<string, unknown>) => {
  const { data, error } = await sb.rpc("sst_ctrl_afa_salvar", { p });
  erro(error);
  return Number(data);
});

export const useSalvarContato = () => useMutacao(async (p: { id: number; data: string; obs: string; retorno: string | null }) => {
  const { error } = await sb.rpc("sst_ctrl_afa_contato_salvar", { p_id: p.id, p_data: p.data || null, p_obs: p.obs, p_retorno: p.retorno });
  erro(error);
});

export const useSalvarRecurso = () => useMutacao(async (p: Record<string, unknown>) => {
  const { error } = await sb.rpc("sst_ctrl_afa_recurso_salvar", { p });
  erro(error);
});

export const useRemoverRecurso = () => useMutacao(async (id: number) => {
  const { error } = await sb.rpc("sst_ctrl_afa_recurso_remover", { p_id: id });
  erro(error);
});

export const useAnexarDocumento = () => useMutacao(async (p: { id: number; categoria: CategoriaDoc; arquivo: File }) => {
  const invalido = erroDoAnexo(p.arquivo);
  if (invalido) throw new Error(invalido);
  const caminho = `${p.id}/${Date.now()}_${nomeSeguro(p.arquivo.name)}`;
  const { error: erroUpload } = await supabase.storage.from(BUCKET_CONTROLE).upload(caminho, p.arquivo);
  erro(erroUpload);
  const { error } = await sb.rpc("sst_ctrl_afa_doc_registrar", {
    p_id: p.id, p_categoria: p.categoria, p_nome: p.arquivo.name, p_path: caminho, p_tamanho: p.arquivo.size, p_tipo: p.arquivo.type || null,
  });
  if (error) {
    await supabase.storage.from(BUCKET_CONTROLE).remove([caminho]);
    erro(error);
  }
});

export const useRemoverDocumento = () => useMutacao(async (id: number) => {
  const { data, error } = await sb.rpc("sst_ctrl_afa_doc_remover", { p_id: id });
  erro(error);
  if (data) await supabase.storage.from(BUCKET_CONTROLE).remove([data as string]);
});

export const useCapturarControle = () => useMutacao<void, { novos: number; encerrados: number }>(async () => {
  const { data, error } = await sb.rpc("sst_ctrl_afa_capturar_senior");
  erro(error);
  return data as { novos: number; encerrados: number };
});
