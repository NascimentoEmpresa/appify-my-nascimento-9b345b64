// SIS-2026-0556: regras do painel de Faturamento da Empresa e da Lucratividade
// de Contratos (Controladoria). Funções puras — as telas só juntam as fontes.
//
// Fontes (decisão fechada com o usuário):
//   • Faturamento = NFs do Relatório de Serviços (nf_emissao), só Código N,
//     fora de rascunho/enviada e de cancelada/substituída — mesmo recorte do
//     Controle de Faturamento (SIS-0562). Mês = competência da nota.
//   • Executável = planilha_custo (por contrato/mês), calculado na tela.
//   • Custo realizado = saídas do Fluxo de Caixa (regime de CAIXA: mês da
//     data de pagamento), com contrato e classificação. Transferência entre
//     contas, aplicação financeira, empréstimo etc. NÃO são custo.
import { foraDoRelatorio, naoContabilizaKpi, statusDaNota } from "@/pages/financeiro/nf-emissao/shared";

export type RubricaCusto = "salarios" | "ferias" | "rescisoes" | "fgts" | "inss" | "va" | "vt" | "outras";

export const RUBRICAS: { id: RubricaCusto; label: string }[] = [
  { id: "salarios", label: "Salários" },
  { id: "ferias", label: "Férias" },
  { id: "rescisoes", label: "Rescisões" },
  { id: "fgts", label: "FGTS" },
  { id: "inss", label: "INSS" },
  { id: "va", label: "VA" },
  { id: "vt", label: "VT" },
  { id: "outras", label: "Outras Despesas" },
];

function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

// Movimentações que saem do caixa mas não são custo de contrato.
const NAO_CUSTO = [
  "TRANSFERENCIA",
  "APLICACAO FINANCEIRA",
  "RESGATE",
  "RECEBIMENTO DE NOTA",
  "EMPRESTIMO",
  "FINANCIAMENTO",
  "DISTRIBUICAO",
];

// Devolve a rubrica do custo, ou null quando a classificação não é custo.
export function rubricaDeCusto(classificacaoNome: string | null | undefined): RubricaCusto | null {
  const n = normalizar(classificacaoNome);
  if (NAO_CUSTO.some((t) => n.includes(t))) return null;
  // FGTS de rescisão vai junto com Rescisões (é o encargo daquela rescisão).
  if (n.includes("FGTS") && n.includes("RESCISAO")) return "rescisoes";
  if (n.includes("RESCISAO")) return "rescisoes";
  if (n.includes("FGTS")) return "fgts";
  if (n.includes("INSS")) return "inss";
  if (n.includes("FERIAS")) return "ferias";
  // Salário-educação é encargo, não salário.
  if (n.includes("SALARIO EDUC")) return "outras";
  if (n.startsWith("SALARIO") || n.includes("13 INTEGRAL") || n.includes("13O") || n.includes("13º") || n.includes("ADIANTAMENTO DE 13")) return "salarios";
  if (n === "VA" || n.startsWith("VA ") || n.includes("VALE ALIMENTACAO")) return "va";
  if (n === "VT" || n.startsWith("VT ") || n.includes("VALE TRANSPORTE")) return "vt";
  return "outras";
}

export interface LinhaFluxoCusto {
  tipo: "entrada" | "saida";
  data_pagamento: string | null;
  contrato_id: string | null;
  classificacao_nome: string | null;
  valor: number;
}

export type CustosPorRubrica = Record<RubricaCusto, number>;

export function custosVazios(): CustosPorRubrica {
  return { salarios: 0, ferias: 0, rescisoes: 0, fgts: 0, inss: 0, va: 0, vt: 0, outras: 0 };
}

export function totalCustos(c: CustosPorRubrica): number {
  return RUBRICAS.reduce((s, r) => s + c[r.id], 0);
}

// Custos por contrato e mês ("YYYY-MM"). Só saídas com contrato e que sejam custo.
export function custosPorContratoMes(linhas: LinhaFluxoCusto[]): Map<string, CustosPorRubrica> {
  const mapa = new Map<string, CustosPorRubrica>();
  for (const l of linhas) {
    if (l.tipo !== "saida" || !l.contrato_id || !l.data_pagamento) continue;
    const rubrica = rubricaDeCusto(l.classificacao_nome);
    if (!rubrica) continue;
    const chave = `${l.contrato_id}|${l.data_pagamento.slice(0, 7)}`;
    const atual = mapa.get(chave) ?? custosVazios();
    atual[rubrica] += l.valor || 0;
    mapa.set(chave, atual);
  }
  return mapa;
}

export interface NfFaturamento {
  contrato_id: string;
  competencia: string;
  tipo_nota: string;
  status?: string;
  situacao_site_pmt?: string | null;
  situacao_dominio?: string | null;
  data_pagamento?: string | null;
  valor_contrato_exec_total: number;
  vlr_bruto_total: number;
  vlr_liquido_total: number;
  valor_pago: number | null;
  desconto_conta_vinculada: number;
}

// Nota que conta no faturamento: Código N, já validada, nem cancelada nem substituída.
export function contaNoFaturamento(n: Pick<NfFaturamento, "tipo_nota" | "status" | "situacao_site_pmt" | "situacao_dominio">): boolean {
  return n.tipo_nota === "N" && !foraDoRelatorio(n) && !naoContabilizaKpi(n);
}

export interface TotaisFaturamento {
  bruto: number;
  liquido: number;
  descontos: number;
  recebido: number;
  aReceber: number;
  notas: number;
}

export function totaisVazios(): TotaisFaturamento {
  return { bruto: 0, liquido: 0, descontos: 0, recebido: 0, aReceber: 0, notas: 0 };
}

// "A receber": o que falta entrar da nota. O líquido já embute os descontos
// pós-emissão (SIS-2026-0592 ajusta direto sobre o líquido), por isso não se
// abate de novo aqui. Nota paga (com data de pagamento) não tem saldo.
export function aReceberDaNf(n: NfFaturamento): number {
  if (statusDaNota(n) === "pago") return 0;
  return Math.max(0, n.vlr_liquido_total - (n.valor_pago ?? 0) - (n.desconto_conta_vinculada || 0));
}

export function somarNf(t: TotaisFaturamento, n: NfFaturamento): TotaisFaturamento {
  t.bruto += n.vlr_bruto_total || 0;
  t.liquido += n.vlr_liquido_total || 0;
  t.descontos += (n.vlr_bruto_total || 0) - (n.vlr_liquido_total || 0);
  t.recebido += n.valor_pago ?? 0;
  t.aReceber += aReceberDaNf(n);
  t.notas += 1;
  return t;
}

// Agrupa as NFs que contam por uma chave qualquer (mês, contrato, cliente...).
export function agruparFaturamento<T extends NfFaturamento>(nfs: T[], chaveDe: (n: T) => string | null): Map<string, TotaisFaturamento> {
  const mapa = new Map<string, TotaisFaturamento>();
  for (const n of nfs) {
    if (!contaNoFaturamento(n)) continue;
    const chave = chaveDe(n);
    if (chave === null) continue;
    mapa.set(chave, somarNf(mapa.get(chave) ?? totaisVazios(), n));
  }
  return mapa;
}

export interface ResultadoLucro {
  lucro: number;
  // null quando não há faturamento (evita dividir por zero e "−100%" enganoso).
  margem: number | null;
}

// Lucro bruto = valor líquido faturado − custos; margem sobre o líquido.
export function lucroBruto(liquido: number, custos: number): ResultadoLucro {
  const lucro = liquido - custos;
  return { lucro, margem: liquido > 0 ? lucro / liquido : null };
}
