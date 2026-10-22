// SIS-2026-0556: regras do painel de Faturamento da Empresa e da Lucratividade
// de Contratos (Controladoria). Funções puras — as telas só juntam as fontes.
//
// Fontes (decisão fechada com o usuário):
//   • Faturamento = NFs do Relatório de Serviços (nf_emissao), só Código N,
//     fora de rascunho/enviada e de cancelada/substituída — mesmo recorte do
//     Controle de Faturamento (SIS-0562). Mês = competência da nota.
//   • Executável = planilha_custo (por contrato/mês), calculado na tela.
//   • Custo realizado = saídas do Fluxo de Caixa (mês da COMPETÊNCIA do
//     lançamento; SIS-2026-0708), com contrato e classificação. Transferência entre
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

// SIS-2026-0709: despesa de sócio. O que o sócio retirou ou gastou conta, inclusive "Distribuição de lucros" (que fora do sócio não é
// custo); continuam de fora as movimentações que só mudam o dinheiro de lugar.
// "TRANSF" também pega a abreviação usada nas planilhas ("TRANSF. ENTRE CONTAS").
const NAO_DESPESA_DE_SOCIO = [...NAO_CUSTO.filter((t) => t !== "DISTRIBUICAO"), "TRANSF"];

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
  // SIS-2026-0708: as despesas entram no mês da COMPETÊNCIA (dia 01), não no do pagamento. Sem competência na linha, vale o pagamento.
  competencia?: string | null;
  contrato_id: string | null;
  classificacao_id?: string | null;
  classificacao_nome: string | null;
  valor: number;
  // SIS-2026-0642: o Fechamento filtra as despesas administrativas por empresa.
  empresa_id?: string | null;
  // SIS-2026-0641: só para o modal "como é formado" listar o lançamento (ID e descrição do Fluxo).
  id_malote?: string | null;
  descricao?: string | null;
}

// SIS-2026-0708: mês ("YYYY-MM") em que a despesa conta nos relatórios de Faturamento, Lucratividade e Fechamento: a competência;
// sem ela (linha antiga ou sem competência informada), o mês do pagamento.
export function mesDoCusto(l: Pick<LinhaFluxoCusto, "competencia" | "data_pagamento">): string | null {
  const data = l.competencia || l.data_pagamento;
  return data ? data.slice(0, 7) : null;
}

// Rubrica final da linha: a ligação manual da classificação vale primeiro; sem
// ligação, vale o automático por nome (e o que não casa é "Outras").
export function rubricaDaLinha(l: Pick<LinhaFluxoCusto, "classificacao_id" | "classificacao_nome">, ligacoes?: LigacoesRubrica): RubricaCusto | null {
  const manual = l.classificacao_id ? ligacoes?.get(l.classificacao_id) : undefined;
  if (manual) return manual === "nao_custo" ? null : manual;
  return rubricaDeCusto(l.classificacao_nome);
}

// Contrato administrativo ("ADMINISTRATIVO - HAGG", "ADMINISTRATIVO - CANAA"...): é centro de custo da empresa, não contrato de cliente.
// A Lucratividade de Contratos não o mostra nem o soma (o custo administrativo é visto no Fechamento da Empresa). Casa pelo INÍCIO do
// nome, sem acento e sem caixa, para não pegar contrato de cliente que só cita "administrativo" no meio do nome.
export function ehContratoAdministrativo(nome: string | null | undefined): boolean {
  const n = (nome ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  return n.startsWith("ADMINISTRATIVO");
}

export function ehDespesaDeSocio(l: Pick<LinhaFluxoCusto, "tipo" | "classificacao_id" | "classificacao_nome">, ligacoes?: LigacoesRubrica): boolean {
  if (l.tipo !== "saida") return false;
  const manual = l.classificacao_id ? ligacoes?.get(l.classificacao_id) : undefined;
  if (manual === "nao_custo") return false;
  const n = normalizar(l.classificacao_nome);
  if (!n) return false;
  return !NAO_DESPESA_DE_SOCIO.some((t) => n.includes(t));
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
    const mes = mesDoCusto(l);
    if (l.tipo !== "saida" || !l.contrato_id || !mes) continue;
    const rubrica = rubricaDaLinha(l, ligacoes);
    if (!rubrica) continue;
    const chave = `${l.contrato_id}|${mes}`;
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
  // SIS-2026-0641: desconto de conta vinculada retido na nota (não entra em dinheiro) e descontos depois da NF
  // (multas/glosas/outros pós-emissão); são o que separa Líquido − Recebido do A Receber.
  contaVinculada: number;
  posEmissao: number;
  notas: number;
}

export function totaisVazios(): TotaisFaturamento {
  return { bruto: 0, liquido: 0, descontos: 0, recebido: 0, aReceber: 0, contaVinculada: 0, posEmissao: 0, notas: 0 };
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
  t.contaVinculada += n.desconto_conta_vinculada || 0;
  t.posEmissao += n.descontos_pos_emissao_total || 0;
  t.notas += 1;
  return t;
}

// SIS-2026-0641: a conta do A Receber, para quem confere "Líquido − Recebido" e não chega no saldo.
//   Líquido − Recebido − Conta vinculada − Descontos depois da NF − Diferença em notas já baixadas = A Receber
// A "diferença em notas já baixadas" é o resto: nota paga (com data de pagamento) não tem saldo mesmo que o valor
// pago não feche com o devido (pago a menos = positivo; pago a mais = negativo).
export interface PonteAReceber {
  liquido: number;
  recebido: number;
  contaVinculada: number;
  posEmissao: number;
  diferencaBaixadas: number;
  aReceber: number;
}

export function ponteAReceber(t: TotaisFaturamento): PonteAReceber {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    liquido: r2(t.liquido),
    recebido: r2(t.recebido),
    contaVinculada: r2(t.contaVinculada),
    posEmissao: r2(t.posEmissao),
    diferencaBaixadas: r2(t.liquido - t.recebido - t.contaVinculada - t.posEmissao - t.aReceber),
    aReceber: r2(t.aReceber),
  };
}

// SIS-2026-0641: contrato SEM planilha de custo (ex.: contrato novo vindo da licitação, ainda sem planilha) ficava com
// executável zero e a diferença para o faturado não aparecia. Nesse caso vale o "Valor Executado Mensal" digitado
// no cadastro do contrato, a partir do mês de início da vigência. Quem tem planilha continua pela planilha.
export function executavelSemPlanilha(
  c: { valor_executado_mensal?: number | null; vigencia_inicial?: string | null; data_inicio?: string | null },
  anoMes: string,
): number {
  const valor = Number(c.valor_executado_mensal) || 0;
  if (valor <= 0) return 0;
  const inicio = (c.vigencia_inicial || c.data_inicio || "").slice(0, 7);
  if (inicio && anoMes < inicio) return 0;
  return valor;
}

// Notas que ainda têm saldo a receber, do maior para o menor.
export function notasComSaldo<T extends NfFaturamento>(nfs: T[]): { nf: T; saldo: number }[] {
  return nfs
    .filter(contaNoFaturamento)
    .map((nf) => ({ nf, saldo: aReceberDaNf(nf) }))
    .filter((x) => x.saldo > 0.005)
    .sort((a, b) => b.saldo - a.saldo);
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
