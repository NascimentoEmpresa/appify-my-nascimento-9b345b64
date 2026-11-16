import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { erroDoAnexo, nomeSeguro } from "@/lib/solicitacoes/anexos";
import type { ItemToxico } from "@/lib/sst/exameToxicologico";

// =====================================================================
// SST › Exames Toxicológicos (SIS-2026-0887, mig 20261117140000). Tudo pelas
// RPCs sst_toxico_*: as tabelas guardam CPF e não têm leitura direta. O laudo
// fica no bucket privado e abre por link assinado.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "sst-exames-toxicologicos";
export const BUCKET_TOXICO = "sst-exames-toxicologicos";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

/** Onde a escrita cai: o registro (id) ou, se ainda não existe, o colaborador. */
export type AlvoToxico = { id: number } | { empregado_id: number };
export const alvoDe = (i: Pick<ItemToxico, "toxicologico_id" | "empregado_id">): AlvoToxico =>
  i.toxicologico_id != null ? { id: i.toxicologico_id } : { empregado_id: i.empregado_id as number };

export interface HistoricoToxico {
  id: number; tipo: "exame" | "cobranca" | "contato" | "alteracao" | "importacao" | "documento";
  data_evento: string | null; descricao: string | null; autor_nome: string | null; created_at: string;
}
export interface DocToxico { id: number; nome: string; storage_path: string; tamanho: number | null; enviado_por: string | null; created_at: string }
export interface FichaToxico { historico: HistoricoToxico[]; documentos: DocToxico[] }
export interface ColaboradorToxico { id: number; nome: string; situacao: string | null; filial: string | null; cargo: string | null; no_controle: boolean }
export interface ResultadoImportacao {
  criados: number; atualizados: number; sem_mudanca: number;
  nao_encontrados: { aba: string; linha: string; nome: string }[];
  erros: { aba: string; linha: string; nome: string; erro: string }[];
}

export const useListaToxico = () => useQuery({
  queryKey: [K, "lista"],
  queryFn: async (): Promise<ItemToxico[]> => {
    const { data, error } = await sb.rpc("sst_toxico_lista");
    erro(error);
    return (data ?? []) as ItemToxico[];
  },
});

export const useFichaToxico = (id: number | null) => useQuery({
  queryKey: [K, "ficha", id], enabled: id != null,
  queryFn: async (): Promise<FichaToxico> => {
    const { data, error } = await sb.rpc("sst_toxico_ficha", { p_id: id });
    erro(error);
    return data as FichaToxico;
  },
});

export async function buscarColaboradoresToxico(busca: string): Promise<ColaboradorToxico[]> {
  const { data, error } = await sb.rpc("sst_toxico_colaboradores", { p_busca: busca });
  erro(error);
  return (data ?? []) as ColaboradorToxico[];
}

export async function abrirLaudo(doc: Pick<DocToxico, "storage_path">) {
  const { data, error } = await supabase.storage.from(BUCKET_TOXICO).createSignedUrl(doc.storage_path, 300);
  erro(error);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

function useMutacao<T, R>(fn: (p: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [K] }) });
}

const rpcId = async (nome: string, p: Record<string, unknown>): Promise<number> => {
  const { data, error } = await sb.rpc(nome, { p });
  erro(error);
  return Number(data);
};

/** Só as chaves enviadas são gravadas: incluir alguém não apaga as datas. */
export const useSalvarToxico = () => useMutacao((p: AlvoToxico & Record<string, unknown>) => rpcId("sst_toxico_salvar", p));

export const useRegistrarExame = () => useMutacao((p: AlvoToxico & { data_exame: string; data_validade: string; clinica?: string }) =>
  rpcId("sst_toxico_registrar_exame", p));

export const useRegistrarAcompanhamento = () => useMutacao((p: AlvoToxico & { data_cobranca?: string; data_contato?: string; observacao?: string }) =>
  rpcId("sst_toxico_registrar_acompanhamento", p));

export const useAnexarLaudo = () => useMutacao(async (p: { id: number; arquivo: File }) => {
  const invalido = erroDoAnexo(p.arquivo);
  if (invalido) throw new Error(invalido);
  const caminho = `${p.id}/${Date.now()}_${nomeSeguro(p.arquivo.name)}`;
  const { error: erroUpload } = await supabase.storage.from(BUCKET_TOXICO).upload(caminho, p.arquivo);
  erro(erroUpload);
  const { error } = await sb.rpc("sst_toxico_doc_registrar", {
    p_id: p.id, p_nome: p.arquivo.name, p_path: caminho, p_tamanho: p.arquivo.size, p_tipo: p.arquivo.type || null,
  });
  if (error) {
    await supabase.storage.from(BUCKET_TOXICO).remove([caminho]);
    erro(error);
  }
});

export const useRemoverLaudo = () => useMutacao(async (id: number) => {
  const { data, error } = await sb.rpc("sst_toxico_doc_remover", { p_id: id });
  erro(error);
  if (data) await supabase.storage.from(BUCKET_TOXICO).remove([data as string]);
});

export const useImportarToxico = () => useMutacao(async (linhas: Record<string, unknown>[]) => {
  const { data, error } = await sb.rpc("sst_toxico_importar", { p_linhas: linhas });
  erro(error);
  return data as ResultadoImportacao;
});
