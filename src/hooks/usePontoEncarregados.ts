import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { caminhoAnexo, type ColaboradorRelogio, type ItemEnvio, type StatusEnvio } from "@/lib/conferenciaPonto/envioEncarregado";

// =====================================================================
// Encarregados › Conferência de Ponto (mig 20261007000023).
// Leitura direta (RLS: o encarregado vê os dele; o Operacional vê os
// enviados); toda escrita passa pelas RPCs ponto_enc_*.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "ponto-encarregados";
export const BUCKET_PONTO_ENC = "ponto-encarregados";

export interface ContratoPonto { empresa: number; filial: number; nome: string | null; empresa_nome: string | null }
export interface ContextoPonto {
  eu: { nome: string; empresa: number; filial: number; posto: string | null } | null;
  contratos: ContratoPonto[];
  relogio_ate: string | null;
}
export interface EnvioPonto {
  id: number; mes_referencia: string; contrato_empresa: number; contrato_filial: number; contrato_nome: string | null;
  posto: string; encarregado_id: string; encarregado_nome: string | null; status: StatusEnvio; observacao: string | null;
  enviado_em: string | null; recebido_por: string | null; recebido_em: string | null;
  devolvido_por: string | null; devolvido_em: string | null; devolucao_motivo: string | null; created_at: string; updated_at: string;
}
export interface AnexoEnvio { id: number; envio_id: number; storage_path: string; nome_arquivo: string | null; mime_type: string | null; tamanho_bytes: number | null; created_at: string }
export interface EventoEnvio { id: number; acao: string; de_status: string | null; para_status: string | null; observacao: string | null; autor_nome: string | null; created_at: string }

const erroRpc = (error: { message?: string } | null) => { if (error) throw new Error(error.message ?? "Erro"); };

export const useContextoPonto = () => useQuery({
  queryKey: [K, "contexto"], staleTime: 10 * 60_000,
  queryFn: async (): Promise<ContextoPonto> => {
    const { data, error } = await sb.rpc("ponto_enc_contexto");
    erroRpc(error);
    return data as ContextoPonto;
  },
});

export const useColaboradoresPonto = (empresa: number | null, filial: number | null, mes: string) => useQuery({
  queryKey: [K, "colaboradores", empresa, filial, mes],
  enabled: empresa != null && filial != null,
  staleTime: 5 * 60_000,
  queryFn: async (): Promise<{ de: string; ate: string; relogio_ate: string | null; colaboradores: ColaboradorRelogio[] }> => {
    const { data, error } = await sb.rpc("ponto_enc_colaboradores", { p_empresa: empresa, p_filial: filial, p_mes: mes });
    erroRpc(error);
    return data;
  },
});

/** Envios visíveis: os meus (encarregado) ou os enviados de um contrato/mês (Operacional). */
export const useEnviosPonto = (f: { meus?: boolean; mes?: string; empresa?: number; filial?: number }) => useQuery({
  queryKey: [K, "envios", f.meus ?? false, f.mes ?? null, f.empresa ?? null, f.filial ?? null],
  queryFn: async (): Promise<EnvioPonto[]> => {
    let q = sb.from("PONTO_ENVIO_ENCARREGADO").select("*").order("mes_referencia", { ascending: false }).order("updated_at", { ascending: false });
    if (f.meus) { const { data: u } = await supabase.auth.getUser(); q = q.eq("encarregado_id", u.user?.id ?? ""); }
    if (f.mes) q = q.eq("mes_referencia", f.mes);
    if (f.empresa != null) q = q.eq("contrato_empresa", f.empresa);
    if (f.filial != null) q = q.eq("contrato_filial", f.filial);
    const { data, error } = await q.limit(500);
    erroRpc(error);
    return data ?? [];
  },
});

export const useDetalheEnvio = (id: number | null) => useQuery({
  queryKey: [K, "detalhe", id], enabled: id != null,
  queryFn: async (): Promise<{ itens: ItemEnvio[]; anexos: AnexoEnvio[]; eventos: EventoEnvio[] }> => {
    const [i, a, e] = await Promise.all([
      sb.from("PONTO_ENVIO_ITEM").select("*").eq("envio_id", id).order("nome"),
      sb.from("PONTO_ENVIO_ANEXO").select("*").eq("envio_id", id).order("created_at"),
      sb.from("PONTO_ENVIO_EVENTO").select("*").eq("envio_id", id).order("created_at"),
    ]);
    erroRpc(i.error); erroRpc(a.error); erroRpc(e.error);
    return {
      itens: (i.data ?? []).map((x: ItemEnvio) => ({ ...x, horas_extras: x.horas_extras ?? "", observacao: x.observacao ?? "" })),
      anexos: a.data ?? [], eventos: e.data ?? [],
    };
  },
});

const invalidar = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: [K] });

export function useSalvarEnvio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id?: number | null; mes_referencia: string; contrato_empresa: number; contrato_filial: number; posto?: string; observacao?: string; itens?: ItemEnvio[] }) => {
      const { data, error } = await sb.rpc("ponto_enc_salvar", { p });
      erroRpc(error);
      return Number(data);
    },
    onSuccess: () => invalidar(qc),
  });
}

export function useAnexarEnvio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { envioId: number; arquivos: File[] }) => {
      for (const f of p.arquivos) {
        const caminho = caminhoAnexo(p.envioId, f.name);
        const up = await supabase.storage.from(BUCKET_PONTO_ENC).upload(caminho, f, { upsert: false, contentType: f.type || undefined });
        if (up.error) throw new Error(`${f.name}: ${up.error.message}`);
        const { error } = await sb.rpc("ponto_enc_anexo_registrar", { p_envio: p.envioId, p_path: caminho, p_nome: f.name, p_mime: f.type || null, p_tamanho: f.size });
        if (error) { await supabase.storage.from(BUCKET_PONTO_ENC).remove([caminho]); throw new Error(error.message); }
      }
    },
    onSuccess: () => invalidar(qc),
  });
}

export function useRemoverAnexoEnvio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await sb.rpc("ponto_enc_anexo_remover", { p_id: id });
      erroRpc(error);
      if (data) await supabase.storage.from(BUCKET_PONTO_ENC).remove([String(data)]);
    },
    onSuccess: () => invalidar(qc),
  });
}

export function useEnviarPonto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => { const { error } = await sb.rpc("ponto_enc_enviar", { p_id: id }); erroRpc(error); },
    onSuccess: () => invalidar(qc),
  });
}

export function useDecidirEnvio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: number; acao: "receber" | "devolver"; motivo?: string }) => {
      const { error } = await sb.rpc("ponto_enc_decidir", { p_id: p.id, p_acao: p.acao, p_motivo: p.motivo ?? null });
      erroRpc(error);
    },
    onSuccess: () => invalidar(qc),
  });
}

/** Link temporário para abrir o arquivo (o bucket é privado). */
export async function urlAnexoEnvio(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET_PONTO_ENC).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}
