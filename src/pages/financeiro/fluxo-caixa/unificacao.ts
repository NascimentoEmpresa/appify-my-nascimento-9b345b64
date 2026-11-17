// SIS-2026-0927: unificar lançamentos do Fluxo de Caixa que são UM pagamento bancário só. Funções puras: dizem se as linhas marcadas podem ser
// unificadas e, se não, por quê. A regra de verdade é a RPC fluxo_caixa_unificar (migration 20261117240000), que repete estas conferências.

export interface LinhaUnificavel {
  origem: string;
  despesa_id: string;
  numero_parcela: number | null;
  id_malote: string | null;
  descricao?: string | null;
  empresa_id: string | null;
  data_pagamento: string | null;
  competencia: string | null;
  banco_id: string | null;
  tipo: string;
  valor: number;
  /** preenchido na fatura consolidada de cartão */
  fatura_cartao_id?: string | null;
  situacao_base?: string | null;
}

export interface PlanoUnificacao {
  /** pode confirmar */
  ok: boolean;
  /** motivos que impedem (vazio quando ok) */
  erros: string[];
  itens: { origem: "malote" | "debito_automatico"; despesa_id: string }[];
  total: number;
  /** "R$ 14.844,27 + R$ 6.196,32 = R$ 21.040,59" */
  somaTexto: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const distintos = (xs: (string | null | undefined)[]) => new Set(xs.map((x) => x ?? "")).size;

export const ORIGENS_UNIFICAVEIS = ["malote", "debito_automatico"] as const;

export function planejarUnificacao(linhas: LinhaUnificavel[]): PlanoUnificacao {
  const erros: string[] = [];
  const total = r2(linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0));
  const somaTexto = `${linhas.map((l) => brl(Number(l.valor) || 0)).join(" + ")} = ${brl(total)}`;
  const itens = linhas
    .filter((l) => (ORIGENS_UNIFICAVEIS as readonly string[]).includes(l.origem))
    .map((l) => ({ origem: l.origem as "malote" | "debito_automatico", despesa_id: l.despesa_id }));

  if (linhas.length < 2) erros.push("Marque ao menos 2 lançamentos para unificar.");
  if (linhas.some((l) => !(ORIGENS_UNIFICAVEIS as readonly string[]).includes(l.origem))) {
    erros.push("Só dá para unificar lançamentos do Malote e do Débito Automático (cartão, aplicação, conta garantida e planilha importada ficam de fora).");
  }
  if (linhas.some((l) => l.fatura_cartao_id)) erros.push("Fatura consolidada de cartão não pode ser unificada.");
  if (linhas.some((l) => l.situacao_base)) erros.push("Lançamento previsto (ainda não pago) não pode ser unificado.");
  if (linhas.some((l) => l.numero_parcela != null)) erros.push("Lançamento parcelado não pode ser unificado.");
  if (linhas.some((l) => l.tipo !== "saida")) erros.push("Só saídas podem ser unificadas (um pagamento bancário).");
  if (distintos(linhas.map((l) => l.empresa_id)) > 1) erros.push("Os lançamentos são de empresas diferentes.");
  if (distintos(linhas.map((l) => l.data_pagamento)) > 1) erros.push("Datas de pagamento diferentes: um pagamento bancário tem uma data só. Ajuste a data antes.");
  if (distintos(linhas.map((l) => l.competencia)) > 1) erros.push("Competências diferentes. Ajuste a competência antes.");
  if (distintos(linhas.map((l) => l.banco_id)) > 1) erros.push("Bancos diferentes: não são o mesmo pagamento bancário.");
  if (linhas.length >= 2 && total <= 0) erros.push("O total precisa ser maior que zero.");

  return { ok: erros.length === 0, erros, itens, total, somaTexto };
}

// ── rateio da linha unificada ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CotaUnificacao {
  /** id do contrato; "" = não escolhido; SEM_CONTRATO_UNIF = administrativo */
  contratoId: string;
  classificacaoId: string;
  /** texto digitado (aceita vírgula) */
  valor: string;
  /** vem das linhas originais; o editor só repassa */
  integranteEmpregadoId?: number | null;
}

export const SEM_CONTRATO_UNIF = "__sem_contrato__";

export function lerValorUnif(txt: string): number {
  const limpo = txt.trim().replace(/\s/g, "");
  if (!limpo) return 0;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? r2(n) : 0;
}

export const somaCotasUnif = (cotas: CotaUnificacao[]) => r2(cotas.reduce((s, c) => s + lerValorUnif(c.valor), 0));
export const diferencaCotasUnif = (total: number, cotas: CotaUnificacao[]) => r2(total - somaCotasUnif(cotas));

/** Mensagem do primeiro problema, ou null se dá para salvar. A soma tem que fechar EXATAMENTE o total do pagamento. */
export function erroCotasUnif(total: number, cotas: CotaUnificacao[]): string | null {
  if (cotas.length === 0) return "Informe as cotas do rateio.";
  if (cotas.some((c) => !c.classificacaoId)) return "Escolha a classificação de todas as cotas.";
  if (cotas.some((c) => !c.contratoId)) return "Escolha o centro de custo de todas as cotas (ou 'Sem contrato').";
  if (cotas.some((c) => lerValorUnif(c.valor) <= 0)) return "Toda cota precisa ter valor maior que zero.";
  const dif = diferencaCotasUnif(total, cotas);
  if (Math.abs(dif) > 0.005) return `A soma das cotas precisa ser igual ao total do pagamento (${dif > 0 ? "faltam" : "sobram"} ${brl(Math.abs(dif))}).`;
  return null;
}

export function cotasParaRpcUnif(cotas: CotaUnificacao[]) {
  return cotas.map((c) => ({
    classificacao_id: c.classificacaoId,
    contrato_id: c.contratoId === SEM_CONTRATO_UNIF ? null : c.contratoId,
    integrante_empregado_id: c.integranteEmpregadoId ?? null,
    valor: lerValorUnif(c.valor),
  }));
}

export interface CotaSalva {
  classificacao_id: string | null;
  contrato_id: string | null;
  integrante_empregado_id: number | null;
  valor: number;
}

export function cotasDasSalvas(salvas: CotaSalva[]): CotaUnificacao[] {
  return salvas.map((c) => ({
    contratoId: c.contrato_id ?? SEM_CONTRATO_UNIF,
    classificacaoId: c.classificacao_id ?? "",
    valor: String(c.valor).replace(".", ","),
    integranteEmpregadoId: c.integrante_empregado_id,
  }));
}
