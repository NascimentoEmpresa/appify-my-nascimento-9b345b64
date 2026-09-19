// Fluxo da solicitação de vaga em PASSOS (18/09/2026) — o que o botão
// "Status" de cada solicitação desenha: onde a vaga está, o que já passou e
// o que falta. Os status do banco (SISTEMA_RECRUTAMENTO.status) são muitos e
// alguns são legado; aqui eles viram 8 passos + os finais (contratada /
// reprovada / cancelada).

export interface PassoFluxo {
  chave: string;
  titulo: string;
  icone: string;
  /** Quem cuida desse passo — vai embaixo do título. */
  quem: string;
  /** Status do banco que caem neste passo. */
  status: string[];
}

export const PASSOS_FLUXO: PassoFluxo[] = [
  { chave: "aprovacao", titulo: "Aprovação", icone: "🕒", quem: "Operacional · Analista · Diretoria", status: ["Pendente Operacional", "Pendente Analista", "Pendente Diretoria"] },
  { chave: "recrutamento", titulo: "Conferência", icone: "🎯", quem: "Recrutamento confere e abre", status: ["Pendente Recrutamento"] },
  { chave: "selecao", titulo: "Seleção de currículos", icone: "📥", quem: "Recrutamento", status: ["Vaga aberta - Seleção de Currículos"] },
  { chave: "juridico", titulo: "Análise jurídica", icone: "⚖️", quem: "Jurídico verifica o candidato", status: ["Em análise jurídica"] },
  { chave: "entrevistas", titulo: "Entrevistas", icone: "🗣️", quem: "Recrutamento e gestor", status: ["Entrevista e Avaliação", "Entrevista com Gestor"] },
  { chave: "aprovado", titulo: "Aprovado · Documentação", icone: "📄", quem: "Candidato escolhido, documentos", status: ["Aprovado - Aguardando SST", "Compras Confirmou - Aguardando Documentação"] },
  { chave: "sst_compras", titulo: "SST + Compras", icone: "🩺", quem: "Exame admissional e EPIs, em paralelo", status: ["Aguardando SST e Compras", "Encaminhado para SST (ASO)", "ASO Aprovado - Aguardando Informe de EPIs", "Aguardando Confirmação Compras"] },
  { chave: "contratado", titulo: "Contratado", icone: "✅", quem: "Admissão no RH", status: ["Contratado"] },
];

export type Desfecho = "andamento" | "contratada" | "reprovada" | "cancelada";

/** Índice do passo em que o status está (Concluído… conta como contratado). */
export function passoDoStatus(status: string | null | undefined): number {
  const s = String(status ?? "").trim();
  if (!s) return 0;
  if (s.startsWith("Concluído")) return PASSOS_FLUXO.length - 1;
  const i = PASSOS_FLUXO.findIndex(p => p.status.includes(s));
  return i >= 0 ? i : 0;
}

export function desfechoDoStatus(status: string | null | undefined): Desfecho {
  const s = String(status ?? "").trim();
  if (s === "Reprovada") return "reprovada";
  if (s === "Cancelada") return "cancelada";
  if (s === "Contratado" || s.startsWith("Concluído")) return "contratada";
  return "andamento";
}

export type EstadoPasso = "feito" | "atual" | "futuro" | "parado";

/**
 * Estado de cada passo pra desenhar a régua. Reprovada/cancelada: os passos
 * até onde chegou ficam "feito", o passo em que parou vira "parado" e o
 * resto "futuro" — a régua mostra onde o pedido morreu.
 */
export function estadosDosPassos(status: string | null | undefined, statusAntesDoFim?: string | null): EstadoPasso[] {
  const d = desfechoDoStatus(status);
  const base = d === "reprovada" || d === "cancelada" ? passoDoStatus(statusAntesDoFim ?? "") : passoDoStatus(status);
  return PASSOS_FLUXO.map((_, i) => {
    if (d === "contratada") return i <= base ? "feito" : "futuro";
    if (d === "reprovada" || d === "cancelada") return i < base ? "feito" : i === base ? "parado" : "futuro";
    return i < base ? "feito" : i === base ? "atual" : "futuro";
  });
}

/** Percentual concluído (0–100), pra barra do cabeçalho. */
export function progressoDoStatus(status: string | null | undefined): number {
  const d = desfechoDoStatus(status);
  if (d === "contratada") return 100;
  const i = passoDoStatus(status);
  return Math.round((i / (PASSOS_FLUXO.length - 1)) * 100);
}

export interface EventoHistorico {
  id: number;
  created_at: string;
  evento: string | null;
  de_status: string | null;
  para_status: string | null;
  papel: string | null;
  usuario_nome: string | null;
  usuario_email: string | null;
  detalhe: string | null;
  candidato_nome: string | null;
}

/** Dias inteiros entre duas datas (não negativo). */
export const diasEntre = (a: string | Date | null | undefined, b: string | Date = new Date()): number => {
  if (!a) return 0;
  const da = new Date(a), db = new Date(b);
  if (isNaN(+da) || isNaN(+db)) return 0;
  return Math.max(0, Math.floor((db.getTime() - da.getTime()) / 86_400_000));
};

/**
 * O último status ANTES de reprovar/cancelar — pra régua mostrar onde o
 * pedido parou. Sai do histórico (de_status do evento que levou ao fim).
 */
export function statusAntesDoFim(eventos: EventoHistorico[]): string | null {
  const fim = [...eventos].reverse().find(e => e.para_status === "Reprovada" || e.para_status === "Cancelada");
  return fim?.de_status ?? null;
}

/** Quantas mudanças de status da vaga (não de candidato) e a última. */
export function resumoHistorico(eventos: EventoHistorico[], criadoEm?: string | null, status?: string | null) {
  const mudancas = eventos.filter(e => e.para_status && e.para_status !== e.de_status && !e.candidato_nome);
  const ultima = [...eventos].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] ?? null;
  const ultimaMudanca = [...mudancas].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] ?? null;
  return {
    eventos: eventos.length,
    mudancas: mudancas.length,
    diasAberta: diasEntre(criadoEm),
    diasNoStatus: diasEntre(ultimaMudanca?.created_at ?? criadoEm),
    ultimaEm: ultima?.created_at ?? null,
    desfecho: desfechoDoStatus(status),
  };
}
