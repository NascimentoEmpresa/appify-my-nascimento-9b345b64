import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { nomeArquivoSeguro } from "@/lib/email/caixa";

/**
 * Caixas de e-mail do ERP — dados.
 *
 * Duas caixas usam o mesmo desenho (tela estilo Gmail, rascunho pela RLS,
 * envio só pela Edge), cada uma com tabela, bucket e Edge próprios:
 *   CAIXA_FORNECEDORES  "SUP_FORNECEDOR_EMAIL" · sup-fornecedor-email · fornecedor-email-enviar
 *                       (mig 20261106009500 — caixa compartilhada de Compras)
 *   CAIXA_PESSOAL       "EMAIL_MENSAGEM" · email-anexos · email-enviar
 *                       (mig 20261106010000 — módulo E-mail, cada um a sua)
 *
 * Os hooks recebem a caixa (`cfg`) em vez de existirem duas cópias: a
 * correção de um vale para as duas. A queryKey começa pela `chave` da caixa,
 * para o cache de uma nunca servir a outra.
 */

const sb = supabase as any;

export type StatusEmail = "rascunho" | "enviando" | "enviado" | "falhou";
export type PastaEmail = "enviados" | "rascunhos" | "falhas" | "todos";

export interface AnexoEmail { path: string; nome: string; tipo: string | null; tamanho: number | null }

export interface MensagemEmail {
  id: string;
  status: StatusEmail;
  /** Só na caixa de Fornecedores. */
  fornecedor_ids?: string[];
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
/** Nome antigo, de quando só existia a caixa de Fornecedores. */
export type EmailFornecedor = MensagemEmail;

export interface ConfigEnvio {
  de_nome: string;
  de_email: string | null;
  responder_para: string | null;
  autor_nome: string;
  configurado: boolean;
  /** Por que não dá para enviar (sem endereço, servidor sem envio…). */
  motivo?: string | null;
}

export interface CaixaEmailCfg {
  chave: string;
  tabela: string;
  bucket: string;
  edge: string;
  /** Coluna uuid[] para filtrar por "dono" (ex.: fornecedor_ids). */
  colunaDonos?: string;
}

export const CAIXA_FORNECEDORES: CaixaEmailCfg = {
  chave: "sup_forn_email",
  tabela: "SUP_FORNECEDOR_EMAIL",
  bucket: "sup-fornecedor-email",
  edge: "fornecedor-email-enviar",
  colunaDonos: "fornecedor_ids",
};

export const CAIXA_PESSOAL: CaixaEmailCfg = {
  chave: "email_msg",
  tabela: "EMAIL_MENSAGEM",
  bucket: "email-anexos",
  edge: "email-enviar",
};

/** Recorte da lista: por dono (fornecedor) e/ou por autor (caixa pessoal). */
export interface FiltroCaixa { donoId?: string | null; autorId?: string | null }

const STATUS_DA_PASTA: Record<PastaEmail, StatusEmail[]> = {
  enviados: ["enviado", "enviando"],
  rascunhos: ["rascunho"],
  falhas: ["falhou"],
  todos: ["enviado", "enviando", "falhou", "rascunho"],
};

const TAMANHO_PAGINA = 100;

function aplicarFiltro(q: any, cfg: CaixaEmailCfg, f: FiltroCaixa) {
  if (f.donoId && cfg.colunaDonos) q = q.contains(cfg.colunaDonos, [f.donoId]);
  if (f.autorId) q = q.eq("autor_id", f.autorId);
  return q;
}

export function useMensagens(cfg: CaixaEmailCfg, pasta: PastaEmail, filtro: FiltroCaixa, limite = TAMANHO_PAGINA, ativo = true) {
  return useQuery({
    queryKey: [cfg.chave, "lista", pasta, filtro.donoId ?? null, filtro.autorId ?? null, limite],
    enabled: ativo,
    queryFn: async (): Promise<{ itens: MensagemEmail[]; temMais: boolean }> => {
      let q = sb.from(cfg.tabela)
        .select("*")
        .in("status", STATUS_DA_PASTA[pasta])
        .order("updated_at", { ascending: false })
        .order("id")
        .range(0, limite);
      q = aplicarFiltro(q, cfg, filtro);
      const { data, error } = await q;
      if (error) throw error;
      const linhas = (data ?? []) as MensagemEmail[];
      return { itens: linhas.slice(0, limite), temMais: linhas.length > limite };
    },
    staleTime: 15_000,
  });
}

/** Contadores das pastas (barra lateral). */
export function useContagemPastas(cfg: CaixaEmailCfg, filtro: FiltroCaixa, ativo = true) {
  return useQuery({
    queryKey: [cfg.chave, "contagem", filtro.donoId ?? null, filtro.autorId ?? null],
    enabled: ativo,
    queryFn: async () => {
      const contar = async (status: StatusEmail[]) => {
        let q = sb.from(cfg.tabela).select("id", { count: "exact", head: true }).in("status", status);
        q = aplicarFiltro(q, cfg, filtro);
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

export function useConfigEnvio(cfg: CaixaEmailCfg, ativo: boolean) {
  return useQuery({
    queryKey: [cfg.chave, "config"],
    enabled: ativo,
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: async (): Promise<ConfigEnvio> => {
      const { data, error } = await supabase.functions.invoke(cfg.edge, { body: { acao: "config" } });
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
  responder_para: boolean;
  /** Colunas a mais da caixa (ex.: fornecedor_ids). */
  extras?: Record<string, unknown>;
}

function invalidar(qc: ReturnType<typeof useQueryClient>, cfg: CaixaEmailCfg) {
  qc.invalidateQueries({ queryKey: [cfg.chave, "lista"] });
  qc.invalidateQueries({ queryKey: [cfg.chave, "contagem"] });
}

export function useEnviarEmail(cfg: CaixaEmailCfg) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: MensagemParaEnviar) => {
      const { extras, ...resto } = m;
      const { data, error } = await supabase.functions.invoke(cfg.edge, {
        body: { acao: "enviar", ...resto, ...(extras ?? {}) },
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
    onSettled: () => invalidar(qc, cfg),
  });
}

export function useSalvarRascunho(cfg: CaixaEmailCfg) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: MensagemParaEnviar & { autor_nome?: string | null }): Promise<string> => {
      const payload = {
        para: m.para, cc: m.cc, cco: m.cco,
        assunto: m.assunto.slice(0, 300),
        corpo_html: m.html,
        anexos: m.anexos,
        autor_nome: m.autor_nome ?? null,
        ...(m.extras ?? {}),
      };
      if (m.id) {
        const { data, error } = await sb.from(cfg.tabela)
          .update(payload).eq("id", m.id).eq("status", "rascunho").select("id");
        if (error) throw error;
        if (data?.length) return m.id;
        // Zero linhas = o rascunho já foi enviado (a Edge tirou do status
        // 'rascunho') ou apagado. NÃO recriar: um salvamento automático
        // atrasado faria nascer um rascunho fantasma da mensagem já enviada.
        throw new Error("Este rascunho não existe mais (já foi enviado ou apagado).");
      }
      const { data, error } = await sb.from(cfg.tabela)
        .insert({ ...payload, status: "rascunho" }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => invalidar(qc, cfg),
  });
}

export function useExcluirEmail(cfg: CaixaEmailCfg) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: Pick<MensagemEmail, "id" | "status" | "anexos">) => {
      const { data, error } = await sb.from(cfg.tabela).delete().eq("id", e.id).select("id");
      if (error) throw error;
      // DELETE barrado pela RLS não devolve erro, devolve zero linhas.
      if (!data?.length) throw new Error("Nada foi apagado — mensagem enviada só sai com a ação 'excluir' desta caixa.");
      // Anexo de rascunho é lixo; de mensagem enviada fica (pode ter sido
      // reaproveitado num encaminhamento).
      if (e.status === "rascunho" && e.anexos?.length) {
        await supabase.storage.from(cfg.bucket).remove(e.anexos.map((a) => a.path)).catch(() => undefined);
      }
    },
    onSuccess: () => invalidar(qc, cfg),
  });
}

export async function subirAnexo(cfg: CaixaEmailCfg, uid: string, arquivo: File): Promise<AnexoEmail> {
  const path = `${uid}/${crypto.randomUUID()}/${nomeArquivoSeguro(arquivo.name)}`;
  const { error } = await supabase.storage.from(cfg.bucket).upload(path, arquivo, {
    contentType: arquivo.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return { path, nome: arquivo.name, tipo: arquivo.type || null, tamanho: arquivo.size };
}

export async function baixarAnexo(cfg: CaixaEmailCfg, a: AnexoEmail) {
  const { data, error } = await supabase.storage.from(cfg.bucket).createSignedUrl(a.path, 120, { download: a.nome });
  if (error || !data?.signedUrl) throw error ?? new Error("Não foi possível abrir o anexo.");
  window.open(data.signedUrl, "_blank", "noopener");
}

// ── Módulo E-mail: contatos e remetentes ─────────────────────────────────

export function useContatosEmail(ativo: boolean) {
  return useQuery({
    queryKey: ["email_msg", "contatos"],
    enabled: ativo,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("email_contatos");
      if (error) throw error;
      return (data ?? []) as { email: string; nome: string | null; origem: string; ref_id: string | null }[];
    },
  });
}

export interface RemetenteEmail {
  user_id: string;
  email: string;
  nome_exibicao: string | null;
  ativo: boolean;
  updated_at: string;
}

export function useRemetentes(ativo: boolean) {
  return useQuery({
    queryKey: ["email_msg", "remetentes"],
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await sb.from("EMAIL_REMETENTE").select("user_id, email, nome_exibicao, ativo, updated_at");
      if (error) throw error;
      return (data ?? []) as RemetenteEmail[];
    },
  });
}

export function useSalvarRemetente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: { user_id: string; email: string; nome_exibicao: string | null; ativo: boolean }) => {
      const { error } = await sb.from("EMAIL_REMETENTE").upsert({
        user_id: r.user_id,
        email: r.email.trim().toLowerCase(),
        nome_exibicao: r.nome_exibicao?.trim() || null,
        ativo: r.ativo,
      }, { onConflict: "user_id" });
      if (error) {
        if (/uq_email_remetente_email_ativo|duplicate/i.test(error.message)) {
          throw new Error("Esse endereço já está ativo para outra pessoa.");
        }
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email_msg", "remetentes"] });
      qc.invalidateQueries({ queryKey: ["email_msg", "config"] });
    },
  });
}
