// =====================================================================
// RH › Documentos  ×  Encarregados › Documentos (mig 20261019000040).
// Regras puras da solicitação de documentos — testadas em
// src/test/rh-documentos-solicitados.test.ts.
// =====================================================================

export type StatusDocumento = "pendente" | "concluida" | "cancelada";
export type OrigemAnexo = "rh" | "destinatario";

export interface SolicitacaoDocumento {
  id: number;
  titulo: string;
  descricao: string | null;
  contrato_empresa: number | null;
  contrato_filial: number | null;
  contrato_nome: string | null;
  destinatario_id: string;
  destinatario_nome: string | null;
  destinatario_empregado_id: number | null;
  solicitante_id: string;
  solicitante_nome: string | null;
  prazo: string | null;
  status: StatusDocumento;
  observacao_envio: string | null;
  concluida_em: string | null;
  concluida_por: string | null;
  cancelada_em: string | null;
  cancelada_por: string | null;
  cancelamento_motivo: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnexoDocumento {
  id: number; solicitacao_id: number; origem: OrigemAnexo; storage_path: string; nome_arquivo: string | null;
  mime_type: string | null; tamanho_bytes: number | null; enviado_por_id: string | null; enviado_por: string | null; created_at: string;
}

export interface EventoDocumento {
  id: number; solicitacao_id: number; acao: string; texto: string | null; autor_nome: string | null;
  lado: OrigemAnexo | null; created_at: string;
}

export const STATUS_DOCUMENTO: Record<StatusDocumento, { rotulo: string; cor: string }> = {
  pendente:  { rotulo: "Pendente",  cor: "bg-amber-100 text-amber-800 border-amber-200" },
  concluida: { rotulo: "Concluída", cor: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  cancelada: { rotulo: "Cancelada", cor: "bg-slate-100 text-slate-600 border-slate-200" },
};

export const ACAO_EVENTO: Record<string, string> = {
  criada: "Solicitação criada",
  mensagem: "Mensagem",
  concluida: "Documento enviado",
  devolvida: "Devolvida pelo RH",
  reencaminhada: "Reencaminhada",
  cancelada: "Cancelada",
};

/** "FULANO" → "Fulano"; "JOÃO DA SILVA" → "João da Silva". */
export function nomeLegivel(nome: string | null | undefined): string {
  const s = String(nome ?? "").trim();
  if (!s) return "";
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(/\s+/)
    .map((p) => (["da", "de", "do", "das", "dos", "e"].includes(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

/** O que a lista mostra: "Pendente (Fulano — CONTRATO X)". */
export function rotuloSituacao(s: Pick<SolicitacaoDocumento, "status" | "destinatario_nome" | "contrato_nome">): string {
  const base = STATUS_DOCUMENTO[s.status]?.rotulo ?? s.status;
  if (s.status !== "pendente") return base;
  const quem = nomeLegivel(s.destinatario_nome) || "destinatário";
  return `${base} (${quem}${s.contrato_nome ? ` — ${s.contrato_nome}` : ""})`;
}

/** Dias até o prazo (negativo = atrasado). Sem prazo → null. `hoje` em YYYY-MM-DD. */
export function diasParaPrazo(prazo: string | null | undefined, hoje: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(prazo ?? ""));
  const h = /^(\d{4})-(\d{2})-(\d{2})/.exec(hoje);
  if (!m || !h) return null;
  const a = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const b = Date.UTC(+h[1], +h[2] - 1, +h[3]);
  return Math.round((a - b) / 86_400_000);
}

export function atrasada(s: Pick<SolicitacaoDocumento, "status" | "prazo">, hoje: string): boolean {
  const d = diasParaPrazo(s.prazo, hoje);
  return s.status === "pendente" && d != null && d < 0;
}

export function textoPrazo(s: Pick<SolicitacaoDocumento, "status" | "prazo">, hoje: string): string | null {
  const d = diasParaPrazo(s.prazo, hoje);
  if (d == null || s.status !== "pendente") return null;
  if (d < 0) return `atrasada ${-d} dia${d === -1 ? "" : "s"}`;
  if (d === 0) return "vence hoje";
  return `vence em ${d} dia${d === 1 ? "" : "s"}`;
}

/** Pendentes primeiro (atrasadas e prazo mais curto na frente), depois as mais recentes. */
export function ordenarSolicitacoes<T extends Pick<SolicitacaoDocumento, "status" | "prazo" | "created_at">>(lista: T[], hoje: string): T[] {
  const peso = (s: T) => (s.status === "pendente" ? 0 : s.status === "concluida" ? 1 : 2);
  return [...lista].sort((a, b) => {
    const p = peso(a) - peso(b);
    if (p) return p;
    if (a.status === "pendente") {
      const da = diasParaPrazo(a.prazo, hoje) ?? Number.POSITIVE_INFINITY;
      const db = diasParaPrazo(b.prazo, hoje) ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
    }
    return b.created_at.localeCompare(a.created_at);
  });
}

/** O que falta para o destinatário conseguir enviar. Vazio = pode enviar. */
export function pendenciasEnvio(s: Pick<SolicitacaoDocumento, "status">, anexos: Pick<AnexoDocumento, "origem">[]): string[] {
  const p: string[] = [];
  if (s.status !== "pendente") p.push("A solicitação não está pendente.");
  if (!anexos.some((a) => a.origem === "destinatario")) p.push("Anexe o documento assinado.");
  return p;
}

export interface FormSolicitacao {
  titulo: string; descricao: string; modo: "contrato" | "usuario";
  contrato: string; destinatario_id: string; prazo: string;
}

/** Validação do formulário de criação — o banco confere de novo. */
export function errosSolicitacao(f: FormSolicitacao): string[] {
  const e: string[] = [];
  if (!f.titulo.trim()) e.push("Informe o título.");
  if (!f.descricao.trim()) e.push("Descreva o que está sendo solicitado.");
  if (f.modo === "contrato" && !f.contrato) e.push("Escolha o contrato.");
  if (!f.destinatario_id) e.push(f.modo === "contrato" ? "Escolha o responsável pelo contrato." : "Escolha o usuário.");
  return e;
}

/** "12__3" → { empresa: 12, filial: 3 }. */
export function partirContrato(chave: string): { empresa: number; filial: number } | null {
  const [e, f] = String(chave ?? "").split("__");
  const empresa = Number(e), filial = Number(f);
  return e && f && Number.isFinite(empresa) && Number.isFinite(filial) ? { empresa, filial } : null;
}

export function caminhoDocumento(solicitacaoId: number, nomeArquivo: string, agora = Date.now()): string {
  const limpo = nomeArquivo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  return `${solicitacaoId}/${agora}-${limpo || "arquivo"}`;
}

export function fmtTamanho(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0);
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
