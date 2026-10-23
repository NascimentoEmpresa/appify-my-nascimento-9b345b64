// =====================================================================
// RH › Documentos  ×  Encarregados › Documentos (mig 20261019000040).
// Regras puras da solicitação de documentos — testadas em
// src/test/rh-documentos-solicitados.test.ts.
// Tipo (registro / assinatura / termo de ciência), assinatura e imagens:
// mig 20261022000500 — testes em src/test/rh-documentos-assinatura.test.ts.
// =====================================================================

export type StatusDocumento = "pendente" | "concluida" | "cancelada";
export type OrigemAnexo = "rh" | "destinatario";
/** 'anexo' = o fluxo de antes da mig 20261022000500 (anexar o assinado e enviar); não se cria mais. */
export type TipoDocumento = "registro" | "assinatura" | "ciencia" | "anexo";
export type TipoNovoDocumento = Exclude<TipoDocumento, "anexo">;

export interface SolicitacaoDocumento {
  id: number;
  tipo: TipoDocumento;
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
  /** A lista traz os anexos embutidos (só o necessário para as miniaturas). */
  anexos?: Pick<AnexoDocumento, "id" | "origem" | "storage_path" | "nome_arquivo" | "mime_type">[];
}

export interface AnexoDocumento {
  id: number; solicitacao_id: number; origem: OrigemAnexo; storage_path: string; nome_arquivo: string | null;
  mime_type: string | null; tamanho_bytes: number | null; enviado_por_id: string | null; enviado_por: string | null; created_at: string;
}

export interface EventoDocumento {
  id: number; solicitacao_id: number; acao: string; texto: string | null; autor_nome: string | null;
  lado: OrigemAnexo | null; created_at: string;
}

/** "RH_DOCUMENTO_ASSINATURA": a assinatura como foi feita, com quem e quando. */
export interface AssinaturaDocumento {
  id: number; solicitacao_id: number; user_id: string; nome: string | null;
  tipo: "desenho" | "texto"; imagem: string | null; texto: string | null; fonte: string | null; tamanho: number | null;
  declaracao: string | null; created_at: string;
}

/** Assinatura padrão da conta (ou a de treinador, se a pessoa ainda não salvou uma). */
export interface AssinaturaPessoal {
  origem?: "conta" | "treinamentos";
  tipo: "desenho" | "texto"; imagem: string | null; texto: string | null; fonte: string | null; tamanho: number | null;
  atualizada_em?: string;
}

/** Os três tipos oferecidos na criação, na ordem do seletor. */
export const TIPOS_NOVO_DOCUMENTO: TipoNovoDocumento[] = ["registro", "assinatura", "ciencia"];

export const TIPO_DOCUMENTO: Record<TipoDocumento, { rotulo: string; explicacao: string; cor: string }> = {
  registro: {
    rotulo: "Registro",
    explicacao: "Só registra e guarda o documento. Não pede nada do destinatário e já nasce concluído.",
    cor: "bg-slate-100 text-slate-700 border-slate-200",
  },
  assinatura: {
    rotulo: "Assinatura",
    explicacao: "O destinatário é notificado e precisa assinar no sistema. Fica pendente até ele assinar.",
    cor: "bg-sky-100 text-sky-800 border-sky-200",
  },
  ciencia: {
    rotulo: "Termo de ciência",
    explicacao: "Toda vez que o destinatário entrar no sistema aparece o termo pedindo a assinatura, até ele assinar.",
    cor: "bg-violet-100 text-violet-800 border-violet-200",
  },
  anexo: {
    rotulo: "Devolver anexado",
    explicacao: "Fluxo antigo: o destinatário anexa o documento assinado e envia.",
    cor: "bg-amber-50 text-amber-800 border-amber-200",
  },
};

/** Se o destinatário conclui assinando no sistema (e não anexando). */
export const pedeAssinatura = (s: Pick<SolicitacaoDocumento, "tipo">) => s.tipo === "assinatura" || s.tipo === "ciencia";

/** Pode assinar agora: é o destinatário, o tipo pede assinatura e está pendente. */
export function podeAssinar(s: Pick<SolicitacaoDocumento, "tipo" | "status" | "destinatario_id">, userId: string | null | undefined): boolean {
  return !!userId && s.destinatario_id === userId && s.status === "pendente" && pedeAssinatura(s);
}

/** Termos de ciência que a pessoa ainda precisa assinar (a janela do login), mais antigos primeiro; `adiados` = "depois" nesta sessão. */
export function termosCienciaPendentes<T extends Pick<SolicitacaoDocumento, "id" | "tipo" | "status" | "destinatario_id" | "created_at">>(
  lista: T[], userId: string | null | undefined, adiados: number[] = [],
): T[] {
  return lista
    .filter((s) => s.tipo === "ciencia" && s.status === "pendente" && !!userId && s.destinatario_id === userId && !adiados.includes(s.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Anexo que é imagem (pelo tipo; sem tipo, pela extensão) — vira miniatura no card e na janela de assinatura. */
export function ehImagem(a: { mime_type?: string | null; nome_arquivo?: string | null; storage_path?: string | null }): boolean {
  if (a.mime_type) return a.mime_type.toLowerCase().startsWith("image/");
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.nome_arquivo ?? a.storage_path ?? "");
}

/**
 * O que falta para a assinatura (padrão ou desenhada) valer — a mesma regra
 * de usuario_assinatura_problema no banco (que é a do CHECK da
 * TRN_ASSINATURA). null = ok. Mudar nos dois lugares.
 */
export function problemaAssinaturaPessoal(a: Partial<AssinaturaPessoal> | null | undefined): string | null {
  if (a?.tipo === "desenho") {
    if (!a.imagem?.startsWith("data:image/png;base64,")) return "Desenhe a assinatura no quadro.";
    if (a.imagem.length > 400_000) return "A assinatura ficou grande demais — limpe e desenhe de novo.";
    return null;
  }
  if (a?.tipo === "texto") {
    if ((a.texto ?? "").trim().length < 2) return "Escreva a assinatura.";
    if (!a.fonte) return "Escolha a letra da assinatura.";
    const t = a.tamanho == null ? 1 : Number(a.tamanho);
    if (!(t >= 0.6 && t <= 1.4)) return "Tamanho da letra fora do permitido.";
    return null;
  }
  return "Desenhe a assinatura no quadro.";
}

export const STATUS_DOCUMENTO:Record<StatusDocumento, { rotulo: string; cor: string }> = {
  pendente:  { rotulo: "Pendente",  cor: "bg-amber-100 text-amber-800 border-amber-200" },
  concluida: { rotulo: "Concluída", cor: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  cancelada: { rotulo: "Cancelada", cor: "bg-slate-100 text-slate-600 border-slate-200" },
};

export const ACAO_EVENTO: Record<string, string> = {
  criada: "Solicitação criada",
  mensagem: "Mensagem",
  concluida: "Documento enviado",
  assinada: "Assinado",
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

/**
 * O que a lista mostra: "Pendente (Fulano — CONTRATO X)". Com o tipo (mig
 * 20261022000500): assinatura/ciência pendente = "Aguardando assinatura
 * (Fulano…)"; concluída = "Assinado" / "Registrado".
 */
export function rotuloSituacao(s: Pick<SolicitacaoDocumento, "status" | "destinatario_nome" | "contrato_nome"> & { tipo?: TipoDocumento }): string {
  const assina = s.tipo === "assinatura" || s.tipo === "ciencia";
  if (s.status === "concluida" && assina) return "Assinado";
  if (s.status === "concluida" && s.tipo === "registro") return "Registrado";
  const base = s.status === "pendente" && assina ? "Aguardando assinatura" : STATUS_DOCUMENTO[s.status]?.rotulo ?? s.status;
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
  /** "" = ainda não escolhido — o tipo é obrigatório. */
  tipo: TipoNovoDocumento | "";
  titulo: string; descricao: string; modo: "contrato" | "usuario";
  contrato: string; destinatario_id: string; prazo: string;
}

/**
 * Validação do formulário de criação — o banco confere de novo, menos o
 * arquivo do registro (os anexos sobem depois que a solicitação existe).
 * `qtdArquivos` = documentos + imagens escolhidos no modal.
 */
export function errosSolicitacao(f: FormSolicitacao, qtdArquivos = 0): string[] {
  const e: string[] = [];
  if (!f.tipo) e.push("Escolha o tipo: Registro, Assinatura ou Termo de ciência.");
  if (f.tipo === "registro" && qtdArquivos === 0) e.push("Registro guarda um documento: anexe o arquivo ou a imagem.");
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
