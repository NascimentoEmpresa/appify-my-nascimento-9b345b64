// =====================================================================
// Status DETALHADO da vaga (08/10/2026, mig 20261008000008)
//
// Pedido do Pablo: "tá Pendente Recrutamento, mas quando o recrutamento
// move o kanban deve ficar Recrutamento: TRIAGEM, e por assim vai, de acordo
// com os status do kanban, e vai mudando de cor, e deve aparecer pra todos
// que estão envolvidos na vaga".
//
// O status gravado na vaga é grosso de propósito (sr_sync_status_solicitacao
// junta ENTRADA e TRIAGEM em "Vaga aberta - Seleção de Currículos" e nem
// mexe na vaga em Pendente Recrutamento). A etapa fina vem de
// SISTEMA_RECRUTAMENTO_ETAPA — o candidato MAIS ADIANTADO de cada vaga, que
// quem vê a vaga também vê (o solicitante não lê os candidatos).
//
// Regra do selo:
//   · vaga encerrada (contratada, reprovada, cancelada) e as filas de
//     aprovação (Pendente Operacional/Diretoria): o status de sempre;
//   · com candidato no kanban: "<Área>: <ETAPA>", na cor da coluna do kanban;
//   · vaga aberta sem candidato ainda: "Recrutamento: SELEÇÃO DE CURRÍCULOS";
//   · Pendente Recrutamento sem candidato: fica como está.
// O filtro e as contagens seguem pelo status gravado — só o selo detalha.
// =====================================================================

import { desfechoDoStatus } from "@/lib/recrutamento/fluxoStatus";
import { rotuloStatusVaga } from "@/lib/recrutamento/vagaRegras";

/** Uma linha de SISTEMA_RECRUTAMENTO_ETAPA. */
export interface EtapaVaga {
  vaga_id: number;
  /** Etapa do candidato mais adiantado (nomes antigos já convertidos no banco). */
  etapa: string;
  /** Candidatos no processo (sem reprovado/desistente). */
  candidatos: number;
  /** Quantos candidatos em cada etapa. */
  por_etapa: Record<string, number>;
  /** Desde quando a vaga está nesta etapa. */
  atualizado_em: string;
}

interface Aparencia { area: string; texto: string; cor: string; tinta: string }

/**
 * Cada coluna do kanban de candidatos: quem cuida, o nome no selo e a cor —
 * as MESMAS cores das colunas (CAND_COL_COLORS em pages/rh/Recrutamento.tsx),
 * para o selo da vaga e o quadro falarem a mesma língua.
 */
export const ETAPA_KANBAN: Record<string, Aparencia> = {
  ENTRADA:             { area: "Recrutamento",  texto: "ENTRADA",           cor: "#64748b", tinta: "#475569" },
  TRIAGEM:             { area: "Recrutamento",  texto: "TRIAGEM",           cor: "#3b82f6", tinta: "#2563eb" },
  "JURÍDICO":          { area: "Jurídico",      texto: "ANÁLISE JURÍDICA",  cor: "#8b5cf6", tinta: "#7c3aed" },
  ENTREVISTA:          { area: "Recrutamento",  texto: "ENTREVISTA",        cor: "#0ea5e9", tinta: "#0369a1" },
  "ENTREVISTA GESTOR": { area: "Recrutamento",  texto: "ENTREVISTA GESTOR", cor: "#6366f1", tinta: "#4f46e5" },
  APROVADO:            { area: "Recrutamento",  texto: "APROVADO",          cor: "#14b8a6", tinta: "#0f766e" },
  "DOCUMENTAÇÃO":      { area: "Recrutamento",  texto: "DOCUMENTAÇÃO",      cor: "#0891b2", tinta: "#0e7490" },
  "SST + COMPRAS":     { area: "SST + Compras", texto: "EXAME E EPIs",      cor: "#f59e0b", tinta: "#b45309" },
  "ADMISSÃO":          { area: "Recrutamento",  texto: "ADMISSÃO",          cor: "#16a34a", tinta: "#15803d" },
};

/** A ordem das colunas (para a dica listar da primeira à última). */
const ORDEM = Object.keys(ETAPA_KANBAN);

/** Vaga aberta, ainda sem candidato no kanban. */
const SELECAO_CURRICULOS: Aparencia = { area: "Recrutamento", texto: "SELEÇÃO DE CURRÍCULOS", cor: "#a855f7", tinta: "#7e22ce" };

/** Filas de aprovação: a vaga ainda não chegou ao Recrutamento — sem detalhe. */
const FILAS_DE_APROVACAO = ["Pendente Operacional", "Pendente Analista", "Pendente Diretoria"];

export interface StatusDetalhado {
  /** O que vai escrito no selo. */
  texto: string;
  /** true = selo com a cor da etapa; false = o selo de sempre da tela. */
  detalhado: boolean;
  /** Cor da etapa (fundo/borda) e da letra — só quando detalhado. */
  cor?: string;
  tinta?: string;
  /** Texto do title: quantos candidatos, em que etapa, desde quando. */
  dica?: string;
}

const fmtData = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

/** "Candidato mais adiantado: TRIAGEM desde 06/10 · 6 no processo (ENTRADA 5, TRIAGEM 1)". */
export function dicaDaEtapa(e: EtapaVaga): string {
  const partes = ORDEM.filter((k) => (e.por_etapa?.[k] ?? 0) > 0).map((k) => `${k} ${e.por_etapa[k]}`);
  const desde = e.atualizado_em ? fmtData(e.atualizado_em) : "";
  return [
    `Candidato mais adiantado: ${e.etapa}${desde ? ` desde ${desde}` : ""}`,
    `${e.candidatos} no processo${partes.length ? ` (${partes.join(", ")})` : ""}`,
  ].join(" · ");
}

/** Precisa buscar a etapa? Só vaga em andamento e fora das filas de aprovação. */
export function vagaTemEtapa(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim();
  return !!s && desfechoDoStatus(s) === "andamento" && s !== "Concluída" && !FILAS_DE_APROVACAO.includes(s);
}

export function statusDetalhadoVaga(status: string | null | undefined, etapa?: EtapaVaga | null): StatusDetalhado {
  const s = String(status ?? "").trim();
  const simples: StatusDetalhado = { texto: rotuloStatusVaga(s), detalhado: false };
  if (!vagaTemEtapa(s)) return simples;

  const ap = etapa ? ETAPA_KANBAN[etapa.etapa] : undefined;
  if (etapa && ap) {
    return { texto: `${ap.area}: ${ap.texto}`, detalhado: true, cor: ap.cor, tinta: ap.tinta, dica: dicaDaEtapa(etapa) };
  }
  if (s === "Vaga aberta - Seleção de Currículos") {
    const a = SELECAO_CURRICULOS;
    return { texto: `${a.area}: ${a.texto}`, detalhado: true, cor: a.cor, tinta: a.tinta, dica: "Vaga aberta — nenhum candidato no kanban ainda" };
  }
  return simples;
}
