import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { erroDoAnexo, nomeSeguro } from "@/lib/solicitacoes/anexos";
import type { Acidente, LinhaAcidente } from "@/lib/sst/acidentes";

// =====================================================================
// SST › Acidentes de Trabalho (SIS-2026-0889, mig 20261117220000). Tudo
// pelas RPCs sst_acidente*: as tabelas guardam CPF e não têm leitura direta.
// A CAT fica no bucket privado e abre por link assinado.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "sst-acidentes";
export const BUCKET_ACIDENTES = "sst-acidentes";
export const MENU_ACIDENTES = "sst_acidentes_trabalho";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

export interface HistoricoAcidente {
  id: number; tipo: "criacao" | "alteracao" | "conclusao" | "reabertura" | "documento" | "vinculo" | "importacao";
  descricao: string | null; autor_nome: string | null; created_at: string;
}
export interface DocAcidente {
  id: number; categoria: "cat" | "outro"; nome: string; storage_path: string; tamanho: number | null; enviado_por: string | null; created_at: string;
}
export interface AfastamentoSugerido {
  origem: "atestado" | "controle"; id: number; data_inicio: string; descricao: string; dias: number | null; ligado: boolean;
}
export interface FichaAcidente { pendencias: string[]; historico: HistoricoAcidente[]; documentos: DocAcidente[]; afastamentos: AfastamentoSugerido[] }
export interface ColaboradorAcidente { id: number; nome: string; situacao: string | null; filial: string | null; cargo: string | null; desligado: boolean }
export interface SugestaoAcidente { empresa: string | null; contrato_id: string | null; contrato_nome: string | null; encarregados: string[] }
export interface ContratoOpcao { id: string; nome: string; encerrado: boolean }
export interface AcidenteDoColaborador {
  id: number; data_acidente: string; tipo: Acidente["tipo"]; descricao: string | null; contrato_nome: string | null;
  houve_afastamento: boolean; dias_afastamento: number | null; encaminhado_inss: boolean; cat_emitida: boolean | null;
  numero_cat: string | null; concluido: boolean;
  documentos: Pick<DocAcidente, "id" | "nome" | "categoria" | "storage_path">[];
}
export interface ResultadoImportacaoAcidentes {
  simulado: boolean; criados: number; ja_existiam: number; ligados: number; em_aberto: number;
  sem_vinculo: { linha: string; nome: string; motivo: "homonimo" | "nao_encontrado" }[];
  contratos_sem_casar: string[];
  erros: { linha: string; nome: string; erro: string }[];
}

export const useListaAcidentes = () => useQuery({
  queryKey: [K, "lista"],
  queryFn: async (): Promise<Acidente[]> => {
    const { data, error } = await sb.rpc("sst_acidentes_lista");
    erro(error);
    return (data ?? []) as Acidente[];
  },
});

export const useFichaAcidente = (id: number | null) => useQuery({
  queryKey: [K, "ficha", id], enabled: id != null,
  queryFn: async (): Promise<FichaAcidente> => {
    const { data, error } = await sb.rpc("sst_acidente_ficha", { p_id: id });
    erro(error);
    return data as FichaAcidente;
  },
});

export const useContratosAcidente = () => useQuery({
  queryKey: [K, "contratos"], staleTime: 10 * 60_000,
  queryFn: async (): Promise<ContratoOpcao[]> => {
    const { data, error } = await sb.rpc("sst_acidente_contratos");
    erro(error);
    return (data ?? []) as ContratoOpcao[];
  },
});

export const useAcidentesDoColaborador = (empregadoId: number | null, habilitado: boolean) => useQuery({
  queryKey: [K, "colaborador", empregadoId], enabled: habilitado && empregadoId != null,
  queryFn: async (): Promise<AcidenteDoColaborador[]> => {
    const { data, error } = await sb.rpc("sst_acidentes_do_colaborador", { p_empregado_id: empregadoId });
    erro(error);
    return (data ?? []) as AcidenteDoColaborador[];
  },
});

export async function buscarColaboradoresAcidente(busca: string): Promise<ColaboradorAcidente[]> {
  const { data, error } = await sb.rpc("sst_acidente_colaboradores", { p_busca: busca });
  erro(error);
  return (data ?? []) as ColaboradorAcidente[];
}

export async function sugestaoAcidente(empregadoId: number): Promise<SugestaoAcidente> {
  const { data, error } = await sb.rpc("sst_acidente_sugestao", { p_empregado_id: empregadoId });
  erro(error);
  return data as SugestaoAcidente;
}

export async function abrirAnexoAcidente(doc: Pick<DocAcidente, "storage_path">) {
  const { data, error } = await supabase.storage.from(BUCKET_ACIDENTES).createSignedUrl(doc.storage_path, 300);
  erro(error);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

function useMutacao<T, R>(fn: (p: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [K] }) });
}

/** Sem id cria (com empregado_id); com id altera só as chaves enviadas. */
export const useSalvarAcidente = () => useMutacao(async (p: Record<string, unknown>): Promise<number> => {
  const { data, error } = await sb.rpc("sst_acidente_salvar", { p });
  erro(error);
  return Number(data);
});

export const useConcluirAcidente = () => useMutacao(async (p: { id: number; concluir: boolean }) => {
  const { error } = await sb.rpc("sst_acidente_concluir", { p_id: p.id, p_concluir: p.concluir });
  erro(error);
});

export const useLigarAfastamento = () => useMutacao(async (p: { id: number; origem: AfastamentoSugerido["origem"]; afastamentoId: number | null }) => {
  const { error } = await sb.rpc("sst_acidente_ligar_afastamento", { p_id: p.id, p_origem: p.origem, p_afastamento_id: p.afastamentoId });
  erro(error);
});

export const useExcluirAcidente = () => useMutacao(async (id: number) => {
  const { data, error } = await sb.rpc("sst_acidente_excluir", { p_id: id });
  erro(error);
  const caminhos = (data ?? []) as string[];
  if (caminhos.length > 0) await supabase.storage.from(BUCKET_ACIDENTES).remove(caminhos);
});

export const useAnexarAcidente = () => useMutacao(async (p: { id: number; arquivo: File; categoria: DocAcidente["categoria"] }) => {
  const invalido = erroDoAnexo(p.arquivo);
  if (invalido) throw new Error(invalido);
  const caminho = `${p.id}/${Date.now()}_${nomeSeguro(p.arquivo.name)}`;
  const { error: erroUpload } = await supabase.storage.from(BUCKET_ACIDENTES).upload(caminho, p.arquivo);
  erro(erroUpload);
  const { error } = await sb.rpc("sst_acidente_doc_registrar", {
    p_id: p.id, p_categoria: p.categoria, p_nome: p.arquivo.name, p_path: caminho, p_tamanho: p.arquivo.size, p_tipo: p.arquivo.type || null,
  });
  if (error) {
    await supabase.storage.from(BUCKET_ACIDENTES).remove([caminho]);
    erro(error);
  }
});

export const useRemoverAnexoAcidente = () => useMutacao(async (id: number) => {
  const { data, error } = await sb.rpc("sst_acidente_doc_remover", { p_id: id });
  erro(error);
  if (data) await supabase.storage.from(BUCKET_ACIDENTES).remove([data as string]);
});

/** simular = true faz as contas sem gravar nada. */
export const useImportarAcidentes = () => useMutacao(async (p: { linhas: Omit<LinhaAcidente, "avisos">[]; simular: boolean }) => {
  const { data, error } = await sb.rpc("sst_acidente_importar", { p_linhas: p.linhas, p_simular: p.simular });
  erro(error);
  return data as ResultadoImportacaoAcidentes;
});
