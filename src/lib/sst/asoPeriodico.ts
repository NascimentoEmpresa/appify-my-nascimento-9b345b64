// =====================================================================
// SST › ASO Periódico — a régua dos vencimentos (src/pages/sst/AsoPeriodico.tsx).
// Com teste em src/test/sst-aso-periodico.test.ts.
//
// 14/11/2026 (mig 20261114100000): o SST deixa de depender da listagem da
// PROTEGE. O vencimento conta do ÚLTIMO ASO (admissional, periódico, retorno
// ou troca de função): 1 ano na UFFS, 2 anos nos demais contratos. A mesma
// régua roda no banco (sst_aso_per_status) — esta cópia serve ao painel, aos
// filtros e à prévia do próximo vencimento no formulário.
// =====================================================================

export const DIAS_AVISO = 60;

export type StatusAsoPeriodico =
  | "Vencido"
  | "Próximo do vencimento"
  | "Aguardando agendamento"
  | "Agendado"
  | "Realizado/recebido"
  | "Em dia"
  | "Sem ASO";

/** Ordem da tela: o que pede ação primeiro. */
export const STATUS_PERIODICO: StatusAsoPeriodico[] = [
  "Vencido", "Próximo do vencimento", "Aguardando agendamento", "Agendado", "Realizado/recebido", "Em dia", "Sem ASO",
];

export type TipoUltimoAso = "admissional" | "periodico" | "retorno" | "troca_funcao" | "admissao_estimada";

export const ROTULO_TIPO: Record<TipoUltimoAso, string> = {
  admissional: "Admissional",
  periodico: "Periódico",
  retorno: "Retorno ao trabalho",
  troca_funcao: "Troca de função",
  admissao_estimada: "Estimado pela admissão",
};

export interface CicloPeriodico {
  id: number;
  cpf: string;
  periodicidade_meses: number;
  vencimento_previsto: string | null;
  solicitado_em: string | null;
  agendado_para: string | null;
  clinica: string | null;
  realizado: boolean;
  realizado_em: string | null;
  resultado: "apto" | "inapto" | null;
  aso_path: string | null;
  aso_nome: string | null;
  observacao: string | null;
  created_por_nome: string | null;
  atualizado_por_nome: string | null;
  updated_at: string;
}

export interface ItemPeriodico {
  cpf: string;
  empregado_id: number | null;
  nome: string;
  situacao: string | null;
  filial_nome: string | null;
  contrato_nome: string | null;
  cargo: string | null;
  admissao: string | null;
  ultimo_aso: string | null;
  ultimo_tipo: TipoUltimoAso | null;
  periodicidade_meses: number;
  vencimento: string | null;
  status: StatusAsoPeriodico;
  ciclo: CicloPeriodico | null;
  ultimo_periodico: CicloPeriodico | null;
}

export const hojeIso = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fmtData = (iso?: string | null): string => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${de.slice(0, 10)}T00:00:00Z`)) / 86400000);

const somaDias = (iso: string, dias: number): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** Periodicidade do contrato: UFFS 12 meses, demais 24. */
export function periodicidadeMeses(contrato?: string | null, filial?: string | null): 12 | 24 {
  return /\bUFFS\b/i.test(`${contrato ?? ""} ${filial ?? ""}`) ? 12 : 24;
}

/** Soma meses como o Postgres (date + interval): 29/02 + 12 meses = 28/02. */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

export const calcularVencimento = (ultimoAso: string | null | undefined, meses: number): string | null =>
  ultimoAso ? somarMeses(ultimoAso, meses) : null;

export function statusPeriodico(p: {
  vencimento: string | null;
  ultimo_tipo: TipoUltimoAso | null;
  ciclo: Pick<CicloPeriodico, "agendado_para"> | null;
}, hoje: string, diasAviso = DIAS_AVISO): StatusAsoPeriodico {
  if (p.ciclo) return p.ciclo.agendado_para ? "Agendado" : "Aguardando agendamento";
  if (!p.vencimento) return "Sem ASO";
  if (p.vencimento < hoje) return "Vencido";
  if (p.vencimento <= somaDias(hoje, diasAviso)) return "Próximo do vencimento";
  if (p.ultimo_tipo === "periodico") return "Realizado/recebido";
  return "Em dia";
}

/** Dias até o vencimento (negativo = vencido há tantos dias). */
export const diasParaVencer = (p: Pick<ItemPeriodico, "vencimento">, hoje: string): number | null =>
  p.vencimento ? diasEntre(hoje, p.vencimento) : null;

export type ChavePainel = "previstos" | "proximos" | "vencidos" | "aguardando" | "agendados" | "realizados";

export const PAINEL: { chave: ChavePainel; titulo: string; status: StatusAsoPeriodico[] }[] = [
  { chave: "previstos", titulo: "Periódicos previstos", status: ["Vencido", "Próximo do vencimento", "Aguardando agendamento", "Agendado", "Realizado/recebido"] },
  { chave: "proximos", titulo: "Próximos do vencimento", status: ["Próximo do vencimento"] },
  { chave: "vencidos", titulo: "Vencidos", status: ["Vencido"] },
  { chave: "aguardando", titulo: "Aguardando agendamento", status: ["Aguardando agendamento"] },
  { chave: "agendados", titulo: "Agendados", status: ["Agendado"] },
  { chave: "realizados", titulo: "Realizados/recebidos", status: ["Realizado/recebido"] },
];

export function contarPainel(itens: Pick<ItemPeriodico, "status">[]): Record<ChavePainel, number> {
  const r = { previstos: 0, proximos: 0, vencidos: 0, aguardando: 0, agendados: 0, realizados: 0 } as Record<ChavePainel, number>;
  for (const i of itens) for (const p of PAINEL) if (p.status.includes(i.status)) r[p.chave]++;
  return r;
}

/** Contrato para filtro e exibição: o do depara, senão a filial da Senior. */
export const nomeContrato = (i: Pick<ItemPeriodico, "contrato_nome" | "filial_nome">): string =>
  i.contrato_nome || i.filial_nome || "Sem contrato";

/** Ordem da lista: status (ação primeiro) e, dentro dele, o vencimento mais próximo. */
export function ordenar(a: ItemPeriodico, b: ItemPeriodico): number {
  return STATUS_PERIODICO.indexOf(a.status) - STATUS_PERIODICO.indexOf(b.status)
    || String(a.vencimento ?? "").localeCompare(String(b.vencimento ?? ""))
    || a.nome.localeCompare(b.nome);
}

/** O que falta para fechar um ciclo, na ordem do fluxo (vazio = pode marcar realizado). */
export function pendenciasParaRealizar(c: { realizado_em?: string | null; resultado?: string | null }, hoje: string): string[] {
  const f: string[] = [];
  if (!c.realizado_em) f.push("data da realização");
  else if (c.realizado_em > hoje) f.push("data da realização não pode ser futura");
  if (!c.resultado) f.push("resultado (apto ou inapto)");
  return f;
}
