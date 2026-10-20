import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  caminhoDocumento, type AnexoDocumento, type EventoDocumento, type SolicitacaoDocumento,
} from "@/lib/rh/documentosSolicitados";

// =====================================================================
// RH › Documentos  ×  Encarregados › Documentos (mig 20261019000040).
// Leitura direta (RLS: o RH vê todas; o destinatário, as dele); toda
// escrita passa pelas RPCs rh_doc_*.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "rh-documentos";
export const BUCKET_RH_DOCUMENTOS = "rh-documentos";

export interface ResponsavelContrato { empregado_id: number; auth_user_id: string | null; nome: string | null; posto: string | null; tem_acesso: boolean }
export interface ContratoDocumento { empresa: number; filial: number; nome: string | null; empresa_nome: string | null; responsaveis: ResponsavelContrato[] }
export interface UsuarioDocumento { id: string; nome: string | null; email: string | null; tem_acesso: boolean }
export interface OpcoesDocumento { contratos: ContratoDocumento[]; usuarios: UsuarioDocumento[] }

const erroRpc = (error: { message?: string } | null) => { if (error) throw new Error(error.message ?? "Erro"); };

export const useOpcoesDocumento = (ativo = true) => useQuery({
  queryKey: [K, "opcoes"], enabled: ativo, staleTime: 10 * 60_000,
  queryFn: async (): Promise<OpcoesDocumento> => {
    const { data, error } = await sb.rpc("rh_doc_opcoes");
    erroRpc(error);
    return { contratos: data?.contratos ?? [], usuarios: data?.usuarios ?? [] };
  },
});

/** `minhas`: só as em que o usuário logado é o destinatário (tela dos encarregados). */
export const useSolicitacoesDocumento = (f: { minhas?: boolean } = {}) => useQuery({
  queryKey: [K, "lista", f.minhas ?? false],
  queryFn: async (): Promise<SolicitacaoDocumento[]> => {
    let q = sb.from("RH_DOCUMENTO_SOLICITACAO").select("*").order("created_at", { ascending: false });
    if (f.minhas) { const { data: u } = await supabase.auth.getUser(); q = q.eq("destinatario_id", u.user?.id ?? ""); }
    const { data, error } = await q.limit(1000);
    erroRpc(error);
    return data ?? [];
  },
});

export const useDetalheDocumento = (id: number | null) => useQuery({
  queryKey: [K, "detalhe", id], enabled: id != null,
  queryFn: async (): Promise<{ anexos: AnexoDocumento[]; eventos: EventoDocumento[] }> => {
    const [a, e] = await Promise.all([
      sb.from("RH_DOCUMENTO_ANEXO").select("*").eq("solicitacao_id", id).order("created_at"),
      sb.from("RH_DOCUMENTO_EVENTO").select("*").eq("solicitacao_id", id).order("created_at"),
    ]);
    erroRpc(a.error); erroRpc(e.error);
    return { anexos: a.data ?? [], eventos: e.data ?? [] };
  },
});

const invalidar = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: [K] });

async function anexar(solicitacaoId: number, arquivos: File[]) {
  for (const f of arquivos) {
    const caminho = caminhoDocumento(solicitacaoId, f.name);
    const up = await supabase.storage.from(BUCKET_RH_DOCUMENTOS).upload(caminho, f, { upsert: false, contentType: f.type || undefined });
    if (up.error) throw new Error(`${f.name}: ${up.error.message}`);
    const { error } = await sb.rpc("rh_doc_anexo_registrar", {
      p_solicitacao: solicitacaoId, p_path: caminho, p_nome: f.name, p_mime: f.type || null, p_tamanho: f.size,
    });
    if (error) { await supabase.storage.from(BUCKET_RH_DOCUMENTOS).remove([caminho]); throw new Error(error.message); }
  }
}

export function useSolicitarDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      titulo: string; descricao: string; contrato_empresa: number | null; contrato_filial: number | null;
      destinatario_id: string; prazo: string | null; arquivos: File[];
    }) => {
      const { arquivos, ...dados } = p;
      const { data, error } = await sb.rpc("rh_doc_solicitar", { p: dados });
      erroRpc(error);
      const id = Number(data);
      // A solicitação já existe; se um arquivo falhar, ela fica sem ele (avisado na tela).
      if (arquivos.length) await anexar(id, arquivos);
      return id;
    },
    onSettled: () => invalidar(qc),
  });
}

export function useAnexarDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { solicitacaoId: number; arquivos: File[] }) => anexar(p.solicitacaoId, p.arquivos),
    onSettled: () => invalidar(qc),
  });
}

export function useRemoverAnexoDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await sb.rpc("rh_doc_anexo_remover", { p_id: id });
      erroRpc(error);
      if (data) await supabase.storage.from(BUCKET_RH_DOCUMENTOS).remove([String(data)]);
    },
    onSuccess: () => invalidar(qc),
  });
}

export function useMensagemDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: number; texto: string }) => {
      const { error } = await sb.rpc("rh_doc_mensagem", { p_id: p.id, p_texto: p.texto });
      erroRpc(error);
    },
    onSuccess: () => invalidar(qc),
  });
}

export function useConcluirDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: number; observacao: string }) => {
      const { error } = await sb.rpc("rh_doc_concluir", { p_id: p.id, p_observacao: p.observacao || null });
      erroRpc(error);
    },
    onSuccess: () => invalidar(qc),
  });
}

/** Ações do RH sobre uma solicitação. */
export function useAcaoRhDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: number; acao: "devolver" | "cancelar" | "reencaminhar"; motivo: string; destinatario?: string }) => {
      const { error } = p.acao === "devolver"
        ? await sb.rpc("rh_doc_devolver", { p_id: p.id, p_motivo: p.motivo })
        : p.acao === "cancelar"
          ? await sb.rpc("rh_doc_cancelar", { p_id: p.id, p_motivo: p.motivo })
          : await sb.rpc("rh_doc_reencaminhar", { p_id: p.id, p_destinatario: p.destinatario, p_motivo: p.motivo || null });
      erroRpc(error);
    },
    onSuccess: () => invalidar(qc),
  });
}

/** Link temporário para abrir o arquivo (o bucket é privado). */
export async function urlDocumento(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET_RH_DOCUMENTOS).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}
