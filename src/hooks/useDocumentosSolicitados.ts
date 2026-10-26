import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  caminhoDocumento, type AnexoDocumento, type AssinaturaDocumento, type AssinaturaPessoal, type EventoDocumento,
  type SolicitacaoDocumento, type TipoNovoDocumento,
} from "@/lib/rh/documentosSolicitados";

// =====================================================================
// RH › Documentos  ×  Encarregados › Documentos (mig 20261019000040).
// Leitura direta (RLS: o RH vê todas; o destinatário, as dele); toda
// escrita passa pelas RPCs rh_doc_*.
// Tipo, assinatura e termo de ciência: mig 20261022000500.
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

// Os anexos vêm embutidos (sem tamanho e autor) para o card mostrar as imagens.
const SELECT_LISTA = "*, anexos:RH_DOCUMENTO_ANEXO(id, origem, storage_path, nome_arquivo, mime_type)";

/** `minhas`: só as em que o usuário logado é o destinatário (tela dos encarregados). */
export const useSolicitacoesDocumento = (f: { minhas?: boolean } = {}) => useQuery({
  queryKey: [K, "lista", f.minhas ?? false],
  queryFn: async (): Promise<SolicitacaoDocumento[]> => {
    let q = sb.from("RH_DOCUMENTO_SOLICITACAO").select(SELECT_LISTA).order("created_at", { ascending: false });
    if (f.minhas) { const { data: u } = await supabase.auth.getUser(); q = q.eq("destinatario_id", u.user?.id ?? ""); }
    const { data, error } = await q.limit(1000);
    erroRpc(error);
    return data ?? [];
  },
});

export const useDetalheDocumento = (id: number | null) => useQuery({
  queryKey: [K, "detalhe", id], enabled: id != null,
  queryFn: async (): Promise<{ anexos: AnexoDocumento[]; eventos: EventoDocumento[]; assinaturas: AssinaturaDocumento[] }> => {
    const [a, e, s] = await Promise.all([
      sb.from("RH_DOCUMENTO_ANEXO").select("*").eq("solicitacao_id", id).order("created_at"),
      sb.from("RH_DOCUMENTO_EVENTO").select("*").eq("solicitacao_id", id).order("created_at"),
      sb.from("RH_DOCUMENTO_ASSINATURA").select("*").eq("solicitacao_id", id).order("created_at", { ascending: false }),
    ]);
    erroRpc(a.error); erroRpc(e.error); erroRpc(s.error);
    return { anexos: a.data ?? [], eventos: e.data ?? [], assinaturas: s.data ?? [] };
  },
});

/** Uma solicitação pelo id — o link da notificação de quem não tem a tela dos Encarregados (/app?documento=<id>). */
export const useSolicitacaoDocumento = (id: number | null) => useQuery({
  queryKey: [K, "uma", id], enabled: id != null,
  queryFn: async (): Promise<SolicitacaoDocumento | null> => {
    const { data, error } = await sb.from("RH_DOCUMENTO_SOLICITACAO").select(SELECT_LISTA).eq("id", id).maybeSingle();
    erroRpc(error);
    return data ?? null;
  },
});

/**
 * Termos de ciência pendentes de quem está logado — a janela que aparece a
 * cada entrada no sistema (GateTermoCiencia). O índice parcial
 * idx_rds_ciencia_pendente deixa a consulta barata para quem não tem nenhum.
 */
export const useTermosCienciaPendentes = (userId: string | null | undefined) => useQuery({
  queryKey: [K, "ciencia", userId], enabled: !!userId, staleTime: 60_000,
  queryFn: async (): Promise<SolicitacaoDocumento[]> => {
    const { data, error } = await sb.from("RH_DOCUMENTO_SOLICITACAO").select(SELECT_LISTA)
      // + "Termo assinado e anexado" (mig 20261025000030): também aparece a cada entrada.
      .eq("destinatario_id", userId).in("tipo", ["ciencia", "ciencia_anexo"]).eq("status", "pendente").order("created_at");
    erroRpc(error);
    return data ?? [];
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
      tipo: TipoNovoDocumento; titulo: string; descricao: string; contrato_empresa: number | null; contrato_filial: number | null;
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

/** Os encarregados (Hierarquia de Postos + cargo de encarregado, com login) — envio para todos (mig 20261025000030). */
export interface EncarregadoDocumento { id: string; nome: string | null; cargo: string | null; contratos: string | null; por_hierarquia: boolean; por_cargo: boolean }
export const useEncarregadosDocumento = (ativo: boolean) => useQuery({
  queryKey: [K, "encarregados"], enabled: ativo, staleTime: 10 * 60_000,
  queryFn: async (): Promise<EncarregadoDocumento[]> => {
    const { data, error } = await sb.rpc("rh_doc_encarregados");
    erroRpc(error);
    return data ?? [];
  },
});

/** Uma solicitação para cada encarregado marcado, todas no mesmo lote; o arquivo sobe uma vez e vale para todas. */
export function useSolicitarLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { tipo: TipoNovoDocumento; titulo: string; descricao: string; prazo: string | null; destinatarios: string[]; arquivos: File[] }) => {
      const { arquivos, ...dados } = p;
      const { data, error } = await sb.rpc("rh_doc_solicitar_lote", { p: dados });
      erroRpc(error);
      const lote = String(data?.lote_id ?? "");
      const ids = ((data?.ids ?? []) as (number | string)[]).map(Number);
      if (arquivos.length && ids.length) {
        await anexar(ids[0], arquivos);
        const r = await sb.rpc("rh_doc_anexo_replicar", { p_lote: lote, p_de: ids[0] });
        erroRpc(r.error);
      }
      return { lote, ids };
    },
    onSettled: () => invalidar(qc),
  });
}

/** O destinatário abriu o documento do RH (a "leitura" do chamado). Silencioso: não atrapalha quem só quer ver. */
export async function marcarDocumentoLido(id: number) {
  try { await sb.rpc("rh_doc_marcar_lido", { p_id: id }); } catch { /* sem efeito na tela */ }
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

/** Destinatário assina (tipos assinatura e ciência). `salvarPadrao` grava a assinatura como a padrão da conta. */
export function useAssinarDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: number; assinatura: AssinaturaPessoal; salvarPadrao: boolean; observacao?: string }) => {
      const { tipo, imagem, texto, fonte, tamanho } = p.assinatura;
      const { error } = await sb.rpc("rh_doc_assinar", {
        p_id: p.id,
        p: { tipo, imagem, texto, fonte, tamanho, salvar_padrao: p.salvarPadrao, observacao: p.observacao || null },
      });
      erroRpc(error);
    },
    onSuccess: (_d, p) => {
      invalidar(qc);
      if (p.salvarPadrao) qc.invalidateQueries({ queryKey: [K_ASSINATURA] });
    },
  });
}

// ── Assinatura padrão da conta (USUARIO_ASSINATURA) ──────────────────────
const K_ASSINATURA = "assinatura-pessoal";

/** A padrão de quem está logado: a da conta ou, se não salvou, a de treinador em Treinamentos. null = nenhuma. */
export const useAssinaturaPadrao = (ativo = true) => useQuery({
  queryKey: [K_ASSINATURA], enabled: ativo, staleTime: 10 * 60_000,
  queryFn: async (): Promise<AssinaturaPessoal | null> => {
    const { data, error } = await sb.rpc("usuario_assinatura_padrao");
    erroRpc(error);
    return data ?? null;
  },
});

/** Salva (ou, com null, apaga) a assinatura padrão da conta. */
export function useSalvarAssinaturaPadrao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: AssinaturaPessoal | null) => {
      const { error } = a
        ? await sb.rpc("usuario_assinatura_salvar", { p: { tipo: a.tipo, imagem: a.imagem, texto: a.texto, fonte: a.fonte, tamanho: a.tamanho } })
        : await sb.rpc("usuario_assinatura_remover");
      erroRpc(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K_ASSINATURA] }),
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

/** Links temporários das miniaturas, num pedido só — caminho → URL. Valem 1 h; a query renova antes. */
export const useUrlsImagens = (paths: string[]) => {
  const chave = [...paths].sort();
  return useQuery({
    queryKey: [K, "imagens", chave], enabled: chave.length > 0, staleTime: 45 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from(BUCKET_RH_DOCUMENTOS).createSignedUrls(chave, 3600);
      if (error) throw new Error(error.message);
      const r: Record<string, string> = {};
      for (const d of data ?? []) if (d.path && d.signedUrl) r[d.path] = d.signedUrl;
      return r;
    },
  });
};
