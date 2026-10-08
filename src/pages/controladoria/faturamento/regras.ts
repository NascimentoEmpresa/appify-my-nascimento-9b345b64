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

// Ligação manual feita no painel "Rubricas de custo" da Lucratividade: além das
// 8 colunas, "nao_custo" tira a classificação do cálculo.
export type RubricaLigacao = RubricaCusto | "nao_custo";
export const ROTULO_NAO_CUSTO = "Não é custo";
export type LigacoesRubrica = Map<string, RubricaLigacao>;

// Devolve a rubrica do custo, ou null quando a classificação não é custo.
// Sem classificação (nome vazio) também não é custo de rubrica nenhuma: antes
// caía em "Outras" e levava ~R$ 23 mi de linhas importadas sem classificação.
export function rubricaDeCusto(classificacaoNome: string | null | undefined): RubricaCusto | null {
  const n = normalizar(classificacaoNome);
  if (!n) return null;
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
  classificacao_id?: string | null;
  classificacao_nome: string | null;
  valor: number;
}

// Rubrica final da linha: a ligação manual da classificação vale primeiro; sem
// ligação, vale o automático por nome (e o que não casa é "Outras").
export function rubricaDaLinha(l: Pick<LinhaFluxoCusto, "classificacao_id" | "classificacao_nome">, ligacoes?: LigacoesRubrica): RubricaCusto | null {
  const manual = l.classificacao_id ? ligacoes?.get(l.classificacao_id) : undefined;
  if (manual) return manual === "nao_custo" ? null : manual;
  return rubricaDeCusto(l.classificacao_nome);
}

// Saídas de contrato sem classificação: ficam fora de qualquer coluna, mas
// aparecem num aviso na tela para ninguém perder o valor de vista.
export function semClassificacao(linhas: LinhaFluxoCusto[]): { linhas: number; valor: number } {
  let n = 0, valor = 0;
  for (const l of linhas) {
    if (l.tipo !== "saida" || !l.contrato_id || (l.classificacao_nome ?? "").trim()) continue;
    n += 1;
    valor += l.valor || 0;
  }
  return { linhas: n, valor };
}

export type CustosPorRubrica = Record<RubricaCusto, number>;

export function custosVazios(): CustosPorRubrica {
  return { salarios: 0, ferias: 0, rescisoes: 0, fgts: 0, inss: 0, va: 0, vt: 0, outras: 0 };
}

export function totalCustos(c: CustosPorRubrica): number {
  return RUBRICAS.reduce((s, r) => s + c[r.id], 0);
}

// Custos por contrato e mês ("YYYY-MM"). Só saídas com contrato e que sejam custo.
export function custosPorContratoMes(linhas: LinhaFluxoCusto[], ligacoes?: LigacoesRubrica): Map<string, CustosPorRubrica> {
  const mapa = new Map<string, CustosPorRubrica>();
  for (const l of linhas) {
    if (l.tipo !== "saida" || !l.contrato_id || !l.data_pagamento) continue;
    const rubrica = rubricaDaLinha(l, ligacoes);
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
  // SIS-2026-0609: descontos pós-emissão (fora do líquido); reduzem o que falta receber.
  descontos_pos_emissao_total?: number | null;
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

// "A receber": o que falta entrar da nota. SIS-2026-0609: o líquido NÃO embute os
// descontos pós-emissão (não mexem na NF, só no pagamento) — abate-se aqui, igual
// ao valorPendenteNf do Relatório de Serviços. Nota paga (com data de pagamento)
// não tem saldo.
export function aReceberDaNf(n: NfFaturamento): number {
  if (statusDaNota(n) === "pago") return 0;
  return Math.max(0, n.vlr_liquido_total - (n.valor_pago ?? 0) - (n.desconto_conta_vinculada || 0) - (n.descontos_pos_emissao_total || 0));
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

// Lucro Recebido = o que efetivamente entrou (notas pagas) − os mesmos custos.
// A diferença para o Lucro Faturamento é só o que ainda falta receber.
export function lucroRecebido(recebido: number, custos: number): number {
  return recebido - custos;
}

// Faixas de rentabilidade pela Margem Bruta (definição da Controladoria).
export type FaixaRentabilidade = "excelente" | "bom" | "atencao" | "critico" | "prejuizo";

export const FAIXAS_RENTABILIDADE: { id: FaixaRentabilidade; label: string; intervalo: string }[] = [
  { id: "excelente", label: "Excelente", intervalo: "20% ou mais" },
  { id: "bom", label: "Bom", intervalo: "15% a 19,99%" },
  { id: "atencao", label: "Atenção", intervalo: "10% a 14,99%" },
  { id: "critico", label: "Crítico", intervalo: "0% a 9,99%" },
  { id: "prejuizo", label: "Prejuízo", intervalo: "abaixo de 0%" },
];

// Compara com a margem como aparece na tela (duas casas), para 19,996% não
// aparecer "20,00%" e ficar em "Bom".
export function faixaDaMargem(margem: number | null): FaixaRentabilidade | null {
  if (margem === null) return null;
  const m = Math.round(margem * 10000) / 10000;
  if (m >= 0.2) return "excelente";
  if (m >= 0.15) return "bom";
  if (m >= 0.1) return "atencao";
  if (m >= 0) return "critico";
  return "prejuizo";
}
