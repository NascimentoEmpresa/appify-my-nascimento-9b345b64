// Fluxo de Caixa: ratear linhas importadas da planilha (regras puras; a regra de verdade é a RPC
// fluxo_caixa_importado_ratear, migration 20261015000010).

/** Valor do seletor para a cota "sem contrato (administrativo)". */
export const SEM_CONTRATO = "__sem_contrato__";

export interface CotaRateio {
  /** id do contrato, ou SEM_CONTRATO. "" = ainda não escolhido. */
  contratoId: string;
  /** texto digitado (aceita vírgula). */
  valor: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "1.234,56" / "1234,56" / "1234.56" → 1234.56 ; vazio ou inválido → 0. */
export function lerValor(txt: string): number {
  const limpo = txt.trim().replace(/\s/g, "");
  if (!limpo) return 0;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? r2(n) : 0;
}

export function somaCotas(cotas: CotaRateio[]): number {
  return r2(cotas.reduce((s, c) => s + lerValor(c.valor), 0));
}

/** Quanto falta (positivo) ou sobra (negativo) para fechar o valor da linha. */
export function diferencaCotas(total: number, cotas: CotaRateio[]): number {
  return r2(total - somaCotas(cotas));
}

/** Divide o total em n partes, sem perder centavos (a última absorve a sobra). */
export function distribuirIgualmente(total: number, n: number): number[] {
  if (n <= 0) return [];
  const centavos = Math.round(total * 100);
  const base = Math.trunc(centavos / n);
  const partes = Array.from({ length: n }, () => base);
  partes[n - 1] += centavos - base * n;
  return partes.map((c) => c / 100);
}

/**
 * Mensagem do primeiro problema, ou null se dá para enviar.
 * `refazendo`: rateio criado no ERP — com 1 cota só ele é DESFEITO (a linha volta a ser avulsa).
 */
export function erroCotas(total: number, cotas: CotaRateio[], refazendo: boolean): string | null {
  if (cotas.length === 0) return "Informe as cotas do rateio.";
  if (cotas.length === 1 && !refazendo) return "Para ratear, informe ao menos 2 cotas.";
  if (cotas.some((c) => !c.contratoId)) return "Escolha o contrato de todas as cotas (ou 'Sem contrato').";
  const sinal = Math.sign(total);
  for (const c of cotas) {
    const v = lerValor(c.valor);
    if (v === 0) return "Toda cota precisa ter valor diferente de zero.";
    if (Math.sign(v) !== sinal) return "Todas as cotas precisam ter o mesmo sinal do valor do lançamento.";
  }
  const dif = diferencaCotas(total, cotas);
  if (Math.abs(dif) > 0.005) {
    return `A soma das cotas precisa ser igual ao valor do lançamento (${dif > 0 ? "faltam" : "sobram"} ${Math.abs(dif).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`;
  }
  return null;
}

/** Corpo da RPC. */
export function cotasParaRpc(cotas: CotaRateio[]): { contrato_id: string | null; valor: number }[] {
  return cotas.map((c) => ({ contrato_id: c.contratoId === SEM_CONTRATO ? null : c.contratoId, valor: lerValor(c.valor) }));
}

export interface LinhaParaRateio {
  origem: string;
  contrato_nome?: string | null;
  rateio_erp?: boolean;
}

/**
 * O que a tela oferece numa linha: "ratear" (avulsa), "refazer" (rateio criado no ERP) ou nada
 * (outras origens, ou rateio que veio da planilha — esse não se altera aqui).
 */
export function acaoDeRateio(l: LinhaParaRateio): "ratear" | "refazer" | null {
  if (l.origem !== "importacao_historica") return null;
  if (l.rateio_erp) return "refazer";
  if (l.contrato_nome === "Rateio") return null;
  return "ratear";
}

/** Cotas iniciais do diálogo a partir do detalhe da linha agregada (id "nome:..." = contrato sem cadastro). */
export function cotasIniciais(
  total: number,
  contratoIdAtual: string | null,
  detalhe: { id: string; valor: number }[] | undefined,
  refazendo: boolean,
): CotaRateio[] {
  if (refazendo && detalhe && detalhe.length > 0) {
    return detalhe.map((d) => ({ contratoId: d.id.startsWith("nome:") ? SEM_CONTRATO : d.id, valor: String(d.valor).replace(".", ",") }));
  }
  const [a, b] = distribuirIgualmente(total, 2);
  return [
    { contratoId: contratoIdAtual ?? "", valor: String(a).replace(".", ",") },
    { contratoId: "", valor: String(b).replace(".", ",") },
  ];
}
