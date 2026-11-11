import { mesDoCusto, rubricaDaLinha, RUBRICAS, type LigacoesRubrica, type LinhaFluxoCusto } from "../faturamento/regras";

// SIS-2026-0807: regras puras das Justificativas de Valor (sem tela, sem banco). A Controladoria cobra de um responsável a explicação de um valor da
// Lucratividade de Contratos (contrato + mês + coluna); o responsável responde; a Controladoria encerra, devolve (reabre) ou cancela.

export type StatusJustificativa = "aberta" | "respondida" | "encerrada" | "cancelada";
export type TipoEventoJustificativa = "solicitada" | "respondida" | "encerrada" | "reaberta" | "cancelada";

export interface Justificativa {
  id: string;
  numero: string;
  contrato_id: string;
  mes: string; // YYYY-MM-01
  coluna: string;
  coluna_rotulo: string;
  valor_referencia: number | null;
  base_leitura: "competencia" | "pagamento" | null;
  pergunta: string;
  responsavel_id: string;
  prazo: string | null; // YYYY-MM-DD
  status: StatusJustificativa;
  resposta: string | null;
  respondida_em: string | null;
  encerrada_em: string | null;
  created_by: string;
  created_at: string;
}

export interface LancamentoJustificativa {
  id: string;
  justificativa_id: string;
  id_lancamento: string | null;
  descricao: string | null;
  classificacao: string | null;
  data_pagamento: string | null;
  valor: number;
}

export interface EventoJustificativa {
  id: string;
  justificativa_id: string;
  tipo: TipoEventoJustificativa;
  ator_id: string | null;
  texto: string | null;
  created_at: string;
}

export const ROTULO_STATUS: Record<StatusJustificativa, string> = {
  aberta: "Aguardando resposta",
  respondida: "Respondida",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
};

export const ROTULO_EVENTO: Record<TipoEventoJustificativa, string> = {
  solicitada: "Cobrança criada",
  respondida: "Respondida",
  encerrada: "Encerrada",
  reaberta: "Devolvida para nova resposta",
  cancelada: "Cancelada",
};

// ── Colunas que dá para cobrar ──────────────────────────────────────────────
export interface ColunaJustificavel {
  codigo: string;
  rotulo: string;
  /** Colunas de custo têm lançamentos do Fluxo por trás; as de NF/planilha/resultado só aceitam justificativa em texto. */
  comLancamentos: boolean;
}

export const COLUNAS_JUSTIFICAVEIS: ColunaJustificavel[] = [
  { codigo: "valor_exec", rotulo: "Valor Exec. Planilha", comLancamentos: false },
  { codigo: "valor_bruto", rotulo: "Valor Bruto", comLancamentos: false },
  { codigo: "valor_liquido", rotulo: "Valor Líquido", comLancamentos: false },
  { codigo: "desc_contrato", rotulo: "Desc. Contrato", comLancamentos: false },
  ...RUBRICAS.map((r) => ({ codigo: `rubrica:${r.id}`, rotulo: r.label, comLancamentos: true })),
  { codigo: "total_custos", rotulo: "Total de Custos", comLancamentos: true },
  { codigo: "lucro_bruto", rotulo: "Lucro Bruto", comLancamentos: false },
  { codigo: "margem", rotulo: "Margem (%)", comLancamentos: false },
];

export const colunaPorCodigo = (codigo: string) => COLUNAS_JUSTIFICAVEIS.find((c) => c.codigo === codigo);

// Os números da linha da Lucratividade que a cobrança pode apontar.
export interface ValoresLinha {
  exec: number;
  bruto: number;
  liquido: number;
  descontos: number;
  custos: Record<string, number>;
  totalCusto: number;
  lucro: number;
  margem: number | null;
}

/** O valor que a Controladoria está vendo naquela célula (a margem vem em %, ex.: 12,5). */
export function valorDaColuna(l: ValoresLinha, codigo: string): number | null {
  if (codigo === "valor_exec") return l.exec;
  if (codigo === "valor_bruto") return l.bruto;
  if (codigo === "valor_liquido") return l.liquido;
  if (codigo === "desc_contrato") return l.descontos;
  if (codigo === "total_custos") return l.totalCusto;
  if (codigo === "lucro_bruto") return l.lucro;
  if (codigo === "margem") return l.margem === null ? null : Math.round(l.margem * 10000) / 100;
  if (codigo.startsWith("rubrica:")) return l.custos[codigo.slice("rubrica:".length)] ?? 0;
  return null;
}

/** Lançamentos do Fluxo que formam a coluna de custo daquele contrato e mês (mesma regra que monta a coluna na tela). */
export function lancamentosDaColuna(fluxo: LinhaFluxoCusto[], contratoId: string, mes: string, codigo: string, ligacoes?: LigacoesRubrica): LinhaFluxoCusto[] {
  const rubricaPedida = codigo.startsWith("rubrica:") ? codigo.slice("rubrica:".length) : null;
  if (!rubricaPedida && codigo !== "total_custos") return [];
  return fluxo
    .filter((l) => {
      if (l.tipo !== "saida" || l.contrato_id !== contratoId || mesDoCusto(l) !== mes) return false;
      const rubrica = rubricaDaLinha(l, ligacoes);
      if (!rubrica) return false;
      return rubricaPedida ? rubrica === rubricaPedida : true;
    })
    .sort((a, b) => (b.valor || 0) - (a.valor || 0));
}

// ── Prazo e resumo ──────────────────────────────────────────────────────────
const hojeISO = (hoje: Date) => `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

/** Só vence o que ainda espera resposta: respondida, encerrada e cancelada não ficam "atrasadas". */
export function prazoVencido(j: Pick<Justificativa, "prazo" | "status">, hoje = new Date()): boolean {
  return j.status === "aberta" && !!j.prazo && j.prazo < hojeISO(hoje);
}

export interface ResumoJustificativas {
  abertas: number;
  respondidas: number;
  encerradas: number;
  vencidas: number;
}

export const resumoVazio = (): ResumoJustificativas => ({ abertas: 0, respondidas: 0, encerradas: 0, vencidas: 0 });

/** Contadores por contrato, só do mês pedido (canceladas não contam). */
export function resumoPorContrato(justificativas: Justificativa[], mes: string, hoje = new Date()): Map<string, ResumoJustificativas> {
  return resumoPorContratoPeriodo(justificativas, [mes], hoje);
}

// SIS-2026-0769 (11/11/2026): a Lucratividade filtra por intervalo de meses. A
// cobranca continua sendo de UM mes (a justificativa nasce com o mes dela); o
// que muda aqui e so a contagem, que passa a juntar os meses visiveis na tela.
export function resumoPorContratoPeriodo(justificativas: Justificativa[], meses: string[], hoje = new Date()): Map<string, ResumoJustificativas> {
  const doPeriodo = new Set(meses);
  const mapa = new Map<string, ResumoJustificativas>();
  for (const j of justificativas) {
    if (!doPeriodo.has(j.mes.slice(0, 7)) || j.status === "cancelada") continue;
    const r = mapa.get(j.contrato_id) ?? resumoVazio();
    if (j.status === "aberta") r.abertas += 1;
    else if (j.status === "respondida") r.respondidas += 1;
    else r.encerradas += 1;
    if (prazoVencido(j, hoje)) r.vencidas += 1;
    mapa.set(j.contrato_id, r);
  }
  return mapa;
}
