import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { nomeArquivoSeguro } from "@/lib/suprimentos/fornecedorEmail";

/**
 * Caixa de e-mail de Fornecedores — dados.
 * Tabela "SUP_FORNECEDOR_EMAIL" + bucket sup-fornecedor-email
 * (migration 20261106009500) e Edge `fornecedor-email-enviar`.
 */

const sb = supabase as any;
export const BUCKET_EMAIL = "sup-fornecedor-email";

export type StatusEmail = "rascunho" | "enviando" | "enviado" | "falhou";
export type PastaEmail = "enviados" | "rascunhos" | "falhas" | "todos";

export interface AnexoEmail { path: string; nome: string; tipo: string | null; tamanho: number | null }

export interface EmailFornecedor {
  id: string;
  status: StatusEmail;
  fornecedor_ids: string[];
  de_nome: string | null;
  de_email: string | null;
  responder_para: string | null;
  para: string[];
  cc: string[];
  cco: string[];
  assunto: string;
  corpo_html: string;
  anexos: AnexoEmail[];
  erro: string | null;
  autor_id: string;
  autor_nome: string | null;
  enviado_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigEnvio {
  de_nome: string;
  de_email: string | null;
  responder_para: string | null;
  autor_nome: string;
  configurado: boolean;
}

const STATUS_DA_PASTA: Record<PastaEmail, StatusEmail[]> = {
  enviados: ["enviado", "enviando"],
  rascunhos: ["rascunho"],
  falhas: ["falhou"],
  todos: ["enviado", "enviando", "falhou", "rascunho"],
};

const TAMANHO_PAGINA = 100;

export function useEmailsFornecedor(pasta: PastaEmail, fornecedorId: string | null, limite = TAMANHO_PAGINA, ativo = true) {
  return useQuery({
    queryKey: ["sup_forn_email", "lista", pasta, fornecedorId, limite],
    enabled: ativo,
    queryFn: async (): Promise<{ itens: EmailFornecedor[]; temMais: boolean }> => {
      let q = sb.from("SUP_FORNECEDOR_EMAIL")
        .select("*")
        .in("status", STATUS_DA_PASTA[pasta])
        .order("updated_at", { ascending: false })
        .order("id")
        .range(0, limite);
      if (fornecedorId) q = q.contains("fornecedor_ids", [fornecedorId]);
      const { data, error } = await q;
      if (error) throw error;
      const linhas = (data ?? []) as EmailFornecedor[];
      return { itens: linhas.slice(0, limite), temMais: linhas.length > limite };
    },
    staleTime: 15_000,
  });
}

/** Contadores das pastas (barra lateral). */
export function useContagemPastas(fornecedorId: string | null, ativo = true) {
  return useQuery({
    queryKey: ["sup_forn_email", "contagem", fornecedorId],
    enabled: ativo,
    queryFn: async () => {
      const contar = async (status: StatusEmail[]) => {
        let q = sb.from("SUP_FORNECEDOR_EMAIL").select("id", { count: "exact", head: true }).in("status", status);
        if (fornecedorId) q = q.contains("fornecedor_ids", [fornecedorId]);
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      };
      const [rascunhos, falhas] = await Promise.all([contar(["rascunho"]), contar(["falhou"])]);
      return { rascunhos, falhas };
    },
    staleTime: 15_000,
  });
}

export function useConfigEnvio(ativo: boolean) {
  return useQuery({
    queryKey: ["sup_forn_email", "config"],
    enabled: ativo,
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: async (): Promise<ConfigEnvio> => {
      const { data, error } = await supabase.functions.invoke("fornecedor-email-enviar", { body: { acao: "config" } });
      if (error) throw new Error(await mensagemDaEdge(error));
      return data as ConfigEnvio;
    },
  });
}

/** O supabase-js esconde o corpo do erro da Edge dentro do `context`. */
async function mensagemDaEdge(error: any): Promise<string> {
  try {
    const corpo = await error?.context?.json?.();
    if (corpo?.error) return String(corpo.error);
  } catch { /* sem corpo JSON */ }
  return error?.message ?? "Falha ao falar com o servidor de e-mail.";
}

export interface MensagemParaEnviar {
  id?: string | null;          // rascunho de origem
  para: string[]; cc: string[]; cco: string[];
  assunto: string;
  html: string;
  anexos: AnexoEmail[];
  fornecedor_ids: string[];
  responder_para: boolean;
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["sup_forn_email", "lista"] });
  qc.invalidateQueries({ queryKey: ["sup_forn_email", "contagem"] });
}

export function useEnviarEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: MensagemParaEnviar) => {
      const { data, error } = await supabase.functions.invoke("fornecedor-email-enviar", {
        body: { acao: "enviar", ...m },
      });
      if (error) {
        // Com `id` no corpo, a Edge já gravou a tentativa (status 'falhou'):
        // o rascunho de origem deixou de ser rascunho. Sem `id`, foi recusa
        // de validação e o rascunho continua intacto.
        let corpo: any = null;
        try { corpo = await (error as any)?.context?.clone?.().json?.(); } catch { /* sem corpo */ }
        const erro = new Error(corpo?.error ? String(corpo.error) : await mensagemDaEdge(error)) as Error & { gravadoId?: string };
        if (corpo?.id) erro.gravadoId = String(corpo.id);
        throw erro;
      }
      if (data?.error) throw new Error(String(data.error));
      return data as { ok: true; id: string };
    },
    onSettled: () => invalidar(qc),
  });
}

export function useSalvarRascunho() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: MensagemParaEnviar & { autor_nome?: string | null }): Promise<string> => {
      const payload = {
        para: m.para, cc: m.cc, cco: m.cco,
        assunto: m.assunto.slice(0, 300),
        corpo_html: m.html,
        anexos: m.anexos,
        fornecedor_ids: m.fornecedor_ids,
        autor_nome: m.autor_nome ?? null,
      };
      if (m.id) {
        const { data, error } = await sb.from("SUP_FORNECEDOR_EMAIL")
          .update(payload).eq("id", m.id).eq("status", "rascunho").select("id");
        if (error) throw error;
        if (data?.length) return m.id;
        // Zero linhas = o rascunho já foi enviado (a Edge tirou do status
        // 'rascunho') ou apagado. NÃO recriar: um salvamento automático
        // atrasado faria nascer um rascunho fantasma da mensagem já enviada.
        throw new Error("Este rascunho não existe mais (já foi enviado ou apagado).");
      }
      const { data, error } = await sb.from("SUP_FORNECEDOR_EMAIL")
        .insert({ ...payload, status: "rascunho" }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => invalidar(qc),
  });
}

export function useExcluirEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: Pick<EmailFornecedor, "id" | "status" | "anexos">) => {
      const { data, error } = await sb.from("SUP_FORNECEDOR_EMAIL").delete().eq("id", e.id).select("id");
      if (error) throw error;
      // DELETE barrado pela RLS não devolve erro, devolve zero linhas.
      if (!data?.length) throw new Error("Nada foi apagado — mensagem enviada só sai com a ação 'excluir' em Fornecedores — E-mails.");
      // Anexo de rascunho é lixo; de mensagem enviada fica (pode ter sido
      // reaproveitado num encaminhamento).
      if (e.status === "rascunho" && e.anexos?.length) {
        await supabase.storage.from(BUCKET_EMAIL).remove(e.anexos.map((a) => a.path)).catch(() => undefined);
      }
    },
    onSuccess: () => invalidar(qc),
  });
}

export async function subirAnexo(uid: string, arquivo: File): Promise<AnexoEmail> {
  const path = `${uid}/${crypto.randomUUID()}/${nomeArquivoSeguro(arquivo.name)}`;
  const { error } = await supabase.storage.from(BUCKET_EMAIL).upload(path, arquivo, {
    contentType: arquivo.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return { path, nome: arquivo.name, tipo: arquivo.type || null, tamanho: arquivo.size };
}

export async function baixarAnexo(a: AnexoEmail) {
  const { data, error } = await supabase.storage.from(BUCKET_EMAIL).createSignedUrl(a.path, 120, { download: a.nome });
  if (error || !data?.signedUrl) throw error ?? new Error("Não foi possível abrir o anexo.");
  window.open(data.signedUrl, "_blank", "noopener");
}
