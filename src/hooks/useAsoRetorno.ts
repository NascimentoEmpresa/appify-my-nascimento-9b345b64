import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { erroDoAnexo, nomeSeguro } from "@/lib/solicitacoes/anexos";
import type { DocAsoRetorno, ItemAsoRetorno } from "@/lib/sst/asoRetorno";

// =====================================================================
// SST › ASO de Retorno ao Trabalho (SIS-2026-0852, mig 20261115210000).
// Tudo pelas RPCs sst_aso_ret_*. O dado é o do Controle de Afastamentos
// (SST_CTRL_AFASTAMENTO.aso_*), por isso salvar aqui invalida também o cache
// daquela tela e o do ASO Periódico, que lê o último ASO de retorno.
// =====================================================================

// As RPCs novas ainda não estão no types.ts gerado.
const sb = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};
const K = "sst-aso-retorno";
// O mesmo bucket privado do Controle de Afastamentos, na subpasta
// <id>/aso_retorno/ — é a única que a policy deste menu libera.
const BUCKET = "sst-controle-afastamentos";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

export const useListaAsoRetorno = () => useQuery({
  queryKey: [K, "lista"],
  queryFn: async (): Promise<ItemAsoRetorno[]> => {
    const { data, error } = await sb.rpc("sst_aso_ret_lista");
    erro(error);
    return (data ?? []) as ItemAsoRetorno[];
  },
});

export interface DadosAsoRetorno {
  id: number;
  aso_solicitado_em: string | null;
  aso_agendado_em: string | null;
  aso_clinica: string | null;
  aso_realizado: boolean;
  aso_recebido_em: string | null;
  aso_resultado: "apto" | "inapto" | null;
}

export async function abrirAsoRetorno(doc: Pick<DocAsoRetorno, "storage_path">) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300);
  erro(error);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

function useMutacao<T, R>(fn: (p: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [K] });
      qc.invalidateQueries({ queryKey: ["sst-controle-afastamentos"] });
      qc.invalidateQueries({ queryKey: ["sst-aso-periodico"] });
    },
  });
}

export const useSalvarAsoRetorno = () => useMutacao(async (p: DadosAsoRetorno) => {
  const { data, error } = await sb.rpc("sst_aso_ret_salvar", { p });
  erro(error);
  return Number(data);
});

export const useAnexarAsoRetorno = () => useMutacao(async (p: { id: number; arquivo: File }) => {
  const invalido = erroDoAnexo(p.arquivo);
  if (invalido) throw new Error(invalido);
  const caminho = `${p.id}/aso_retorno/${Date.now()}_${nomeSeguro(p.arquivo.name)}`;
  const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, p.arquivo);
  erro(erroUpload);
  const { error } = await sb.rpc("sst_aso_ret_anexo_registrar", {
    p_id: p.id, p_nome: p.arquivo.name, p_path: caminho, p_tamanho: p.arquivo.size, p_tipo: p.arquivo.type || null,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([caminho]);
    erro(error);
  }
});

// O arquivo sai do bucket ANTES do registro: a policy de delete deste menu
// só alcança arquivo que ainda está registrado como ASO de retorno.
export const useRemoverAsoRetorno = () => useMutacao(async (doc: Pick<DocAsoRetorno, "id" | "storage_path">) => {
  const { error: erroArquivo } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  erro(erroArquivo);
  const { error } = await sb.rpc("sst_aso_ret_anexo_remover", { p_doc_id: doc.id });
  erro(error);
});
