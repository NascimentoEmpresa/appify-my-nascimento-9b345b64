import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { erroDoAnexo, nomeSeguro } from "@/lib/solicitacoes/anexos";
import type { ConfigAsoPeriodico, ItemPeriodico } from "@/lib/sst/asoPeriodico";

// =====================================================================
// SST › ASO Periódico (mig 20261114100000). Tudo pelas RPCs sst_aso_per_*;
// o ASO fica no bucket privado e abre por link assinado.
// =====================================================================

// As RPCs novas ainda não estão no types.ts gerado.
const sb = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};
const K = "sst-aso-periodico";
export const BUCKET_ASO_PERIODICO = "sst-aso-periodico";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

export const useListaAsoPeriodico = () => useQuery({
  queryKey: [K, "lista"],
  queryFn: async (): Promise<ItemPeriodico[]> => {
    const { data, error } = await sb.rpc("sst_aso_per_lista");
    erro(error);
    return (data ?? []) as ItemPeriodico[];
  },
});

// SIS-2026-0918 (mig 20261117020000): dias de aviso, periodicidade padrão e
// a periodicidade de cada contrato.
export const useConfigAsoPeriodico = () => useQuery({
  queryKey: [K, "config"],
  queryFn: async (): Promise<ConfigAsoPeriodico> => {
    const { data, error } = await sb.rpc("sst_aso_per_config_ler");
    erro(error);
    return data as ConfigAsoPeriodico;
  },
});

export interface DadosCiclo {
  id?: number | null;
  cpf?: string;
  solicitado_em: string | null;
  agendado_para: string | null;
  clinica: string | null;
  realizado: boolean;
  realizado_em: string | null;
  resultado: "apto" | "inapto" | null;
  observacao: string | null;
}

export async function abrirAsoPeriodico(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET_ASO_PERIODICO).createSignedUrl(path, 300);
  erro(error);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

function useMutacao<T, R>(fn: (p: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [K] }) });
}

export const useSalvarCiclo = () => useMutacao(async (p: DadosCiclo) => {
  const { data, error } = await sb.rpc("sst_aso_per_salvar", { p });
  erro(error);
  return Number(data);
});

// Mudar a configuração muda vencimentos e status: invalida a lista junto (prefixo K).
export const useSalvarConfigPeriodico = () => useMutacao(async (p: { dias_aviso: number; periodicidade_padrao_meses: number }) => {
  const { error } = await sb.rpc("sst_aso_per_config_salvar", {
    p_dias_aviso: p.dias_aviso, p_periodicidade_padrao_meses: p.periodicidade_padrao_meses,
  });
  erro(error);
});

/** meses null = o contrato volta para o padrão. */
export const useSalvarPeriodicidadeContrato = () => useMutacao(async (p: { contrato_id: string; meses: number | null; motivo?: string | null }) => {
  const { error } = await sb.rpc("sst_aso_per_contrato_salvar", {
    p_contrato_id: p.contrato_id, p_meses: p.meses, p_motivo: p.motivo ?? null,
  });
  erro(error);
});

export const useAnexarAso = () => useMutacao(async (p: { id: number; arquivo: File }) => {
  const invalido = erroDoAnexo(p.arquivo);
  if (invalido) throw new Error(invalido);
  const caminho = `${p.id}/${Date.now()}_${nomeSeguro(p.arquivo.name)}`;
  const { error: erroUpload } = await supabase.storage.from(BUCKET_ASO_PERIODICO).upload(caminho, p.arquivo);
  erro(erroUpload);
  const { data, error } = await sb.rpc("sst_aso_per_anexo_registrar", { p_id: p.id, p_nome: p.arquivo.name, p_path: caminho });
  if (error) {
    await supabase.storage.from(BUCKET_ASO_PERIODICO).remove([caminho]);
    erro(error);
  }
  // O ASO substituído sai do bucket.
  if (typeof data === "string" && data) await supabase.storage.from(BUCKET_ASO_PERIODICO).remove([data]);
});

export const useRemoverAso = () => useMutacao(async (id: number) => {
  const { data, error } = await sb.rpc("sst_aso_per_anexo_remover", { p_id: id });
  erro(error);
  if (typeof data === "string" && data) await supabase.storage.from(BUCKET_ASO_PERIODICO).remove([data]);
});
