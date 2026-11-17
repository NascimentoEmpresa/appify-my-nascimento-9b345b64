import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { erroDoAnexo, nomeSeguro } from "@/lib/solicitacoes/anexos";
import type { Incidente } from "@/lib/sst/incidentes";

// As tabelas com CPF não têm acesso direto. A tela usa apenas RPCs com gate próprio.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "sst-incidentes";
const BUCKET = "sst-incidentes";
export const MENU_INCIDENTES = "sst_incidentes";
const verificar = (error: { message?: string } | null) => { if (error) throw new Error(error.message ?? "Erro no SST"); };

export interface ColaboradorIncidente { id: number; nome: string; filial: string | null; desligado: boolean }
export interface ContratoIncidente { id: string; nome: string }
export interface HistoricoIncidente { id: number; descricao: string; autor_nome: string | null; created_at: string }

export const useIncidentes = (empregadoId?: number) => useQuery({
  queryKey: [K, "lista", empregadoId ?? null],
  queryFn: async (): Promise<Incidente[]> => {
    const { data, error } = await sb.rpc("sst_incidentes_lista", { p_empregado_id: empregadoId ?? null });
    verificar(error); return data ?? [];
  },
});
export const useContratosIncidente = () => useQuery({
  queryKey: [K, "contratos"], staleTime: 600_000,
  queryFn: async (): Promise<ContratoIncidente[]> => {
    const { data, error } = await sb.rpc("sst_incidente_contratos"); verificar(error); return data ?? [];
  },
});
export const useHistoricoIncidente = (id: number | null) => useQuery({
  queryKey: [K, "historico", id], enabled: id != null,
  queryFn: async (): Promise<HistoricoIncidente[]> => {
    const { data, error } = await sb.rpc("sst_incidente_historico", { p_id: id }); verificar(error); return data ?? [];
  },
});
export async function buscarColaboradoresIncidente(busca: string): Promise<ColaboradorIncidente[]> {
  const { data, error } = await sb.rpc("sst_incidente_colaboradores", { p_busca: busca });
  verificar(error); return data ?? [];
}
export async function sugestaoIncidente(empregadoId: number): Promise<{ contrato_id: string | null; encarregado: string | null }> {
  const { data, error } = await sb.rpc("sst_incidente_sugestao", { p_empregado_id: empregadoId });
  verificar(error); return data;
}
export async function abrirRelatorio(i: Pick<Incidente, "arquivo_path">) {
  if (!i.arquivo_path) return;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(i.arquivo_path, 300);
  verificar(error);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}
function useMutacao<T, R>(fn: (p: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [K] }) });
}
export const useSalvarIncidente = () => useMutacao(async (p: Record<string, unknown>): Promise<number> => {
  const { data, error } = await sb.rpc("sst_incidente_salvar", { p }); verificar(error); return Number(data);
});
export const useAnexarRelatorio = () => useMutacao(async ({ id, arquivo }: { id: number; arquivo: File }) => {
  const invalido = erroDoAnexo(arquivo);
  if (invalido) throw new Error(invalido);
  if (!(["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(arquivo.type)))
    throw new Error("Use PDF, JPG, PNG ou WebP para o relatório assinado.");
  const caminho = `${id}/${Date.now()}_${nomeSeguro(arquivo.name)}`;
  const storage = supabase.storage.from(BUCKET);
  const { error: uploadError } = await storage.upload(caminho, arquivo);
  verificar(uploadError);
  const { data: antigo, error } = await sb.rpc("sst_incidente_anexar", {
    p_id: id, p_nome: arquivo.name, p_path: caminho, p_tamanho: arquivo.size,
  });
  if (error) { await storage.remove([caminho]); verificar(error); }
  if (antigo) await storage.remove([antigo as string]);
});
