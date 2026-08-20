/**
 * PARCELAS DE CONTRATO (Patrimônio › Contas / Obrigações).
 *
 * Financiamento e Consórcio não são conta de mês: são um contrato com N
 * parcelas. A tela deixa cadastrar de duas formas —
 *   • "igual"      → informa o total e a quantidade, e as parcelas saem iguais;
 *   • "uma_a_uma"  → mesma geração como ponto de partida, mas valor e
 *                    vencimento de cada parcela ficam editáveis.
 *
 * Cada parcela vira UMA linha em JUR_PATRIMONIO_OBRIGACOES (é assim que ela
 * aparece na lista de contas, vai pro Malote e recebe comprovante). O que
 * amarra as parcelas de um mesmo contrato é `contrato_uid`.
 *
 * Sem React e sem Supabase de propósito: é o que os testes carregam.
 */

/** Categorias que representam contrato parcelado (as demais são conta de mês). */
export const CATEGORIAS_CONTRATO = ["Financiamento", "Consórcio"];

export const ehContratoParcelado = (categoria?: string | null): boolean =>
  CATEGORIAS_CONTRATO.includes(String(categoria ?? "").trim());

export type ModoParcelas = "igual" | "uma_a_uma";

/** As duas formas de cadastrar, com o texto que a tela mostra em cada cartão. */
export const MODOS_PARCELA: { v: ModoParcelas; t: string; d: string }[] = [
  { v: "igual", t: "Gerar parcelas com valor igual",
    d: "As parcelas serão geradas com valores iguais automaticamente." },
  { v: "uma_a_uma", t: "Criar parcelas uma a uma",
    d: "Permite informar o valor e o vencimento de cada parcela individualmente." },
];

/** Linha da tabela de parcelas. Valores em texto: são inputs controlados. */
export interface LinhaParcela {
  numero: number;
  vencimento: string;   // yyyy-mm-dd
  valor: string;        // "1250.00"
}

const MESES_POR_PERIODO: Record<string, number> = {
  Mensal: 1, Bimestral: 2, Trimestral: 3, Semestral: 6, Anual: 12,
};

/** Passo em meses da periodicidade. "Único" e desconhecido → 1. */
export const passoDaPeriodicidade = (p?: string | null): number =>
  MESES_POR_PERIODO[String(p ?? "").trim()] ?? 1;

export const somaMeses = (iso: string, n: number): string => {
  const d = new Date(iso + "T12:00:00");
  if (isNaN(+d)) return iso;
  const diaOriginal = d.getDate();
  d.setMonth(d.getMonth() + n);
  // 31/01 + 1 mês vira 03/03 no JS (fevereiro não tem 31). Puxa de volta para
  // o último dia do mês pretendido — parcela não pula de mês sozinha.
  if (d.getDate() < diaOriginal) d.setDate(0);
  return d.toISOString().slice(0, 10);
};

export const numero = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
};

/**
 * Reparte um total em N parcelas SEM perder centavo.
 *
 * Dividir e arredondar cada parcela deixa sobra: 1000/3 daria 333,33 três
 * vezes = 999,99. Aqui a conta é em centavos e o que sobra é distribuído de
 * um em um nas PRIMEIRAS parcelas — a soma bate com o total, sempre.
 */
export function dividirEmParcelas(total: number, quantidade: number): number[] {
  const n = Math.trunc(quantidade);
  if (n <= 0) return [];
  const centavos = Math.round(numero(total) * 100);
  const base = Math.trunc(centavos / n);
  const resto = centavos - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}

export interface GerarParcelasArgs {
  total: number | string;
  entrada?: number | string;
  quantidade: number | string;
  primeiroVencimento: string;
  periodicidade?: string;
}

/**
 * Monta as N linhas: a entrada sai do total (ela não é parcela) e o resto é
 * repartido. O vencimento anda pelo passo da periodicidade.
 */
export function gerarParcelas(a: GerarParcelasArgs): LinhaParcela[] {
  const qtd = Math.trunc(numero(a.quantidade));
  if (qtd <= 0 || !a.primeiroVencimento) return [];
  const aParcelar = Math.max(0, numero(a.total) - numero(a.entrada));
  const valores = dividirEmParcelas(aParcelar, qtd);
  const passo = passoDaPeriodicidade(a.periodicidade);
  return valores.map((v, i) => ({
    numero: i + 1,
    vencimento: somaMeses(a.primeiroVencimento, i * passo),
    valor: v.toFixed(2),
  }));
}

/** Renumera 1..N — usar depois de excluir ou adicionar linha. */
export const renumerar = (linhas: LinhaParcela[]): LinhaParcela[] =>
  linhas.map((l, i) => ({ ...l, numero: i + 1 }));

export const somaParcelas = (linhas: LinhaParcela[]): number =>
  Math.round(linhas.reduce((s, l) => s + numero(l.valor), 0) * 100) / 100;

/** Total geral do contrato: entrada + parcelas. */
export const totalGeral = (linhas: LinhaParcela[], entrada?: number | string): number =>
  Math.round((somaParcelas(linhas) + numero(entrada)) * 100) / 100;

/**
 * Erro do bloco de parcelas, ou null.
 *
 * A diferença entre o total digitado e a soma das parcelas é tolerada em 1
 * centavo: no modo "uma a uma" o usuário arredonda na mão, e brigar por um
 * centavo só trava o cadastro à toa.
 */
export function validarParcelas(
  linhas: LinhaParcela[], total: number | string, entrada?: number | string,
): string | null {
  if (!linhas.length) return "Gere as parcelas do contrato antes de salvar.";
  const semData = linhas.find(l => !l.vencimento);
  if (semData) return `Informe o vencimento da parcela ${semData.numero}.`;
  const semValor = linhas.find(l => numero(l.valor) <= 0);
  if (semValor) return `Informe um valor maior que zero na parcela ${semValor.numero}.`;
  const alvo = numero(total);
  if (alvo > 0) {
    const diferenca = Math.abs(totalGeral(linhas, entrada) - alvo);
    if (diferenca > 0.01) {
      return `A soma das parcelas mais a entrada dá ${brl(totalGeral(linhas, entrada))}, e o valor total do contrato é ${brl(alvo)}. Ajuste um dos dois.`;
    }
  }
  return null;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ── Valor que falta ─────────────────────────────────────────────────────
/** Obrigação, no recorte que este cálculo precisa. */
export interface ObrigacaoMin {
  patrimonio_id: number;
  categoria?: string | null;
  valor?: number | null;
  status?: string | null;
}

export const parcelaEmAberto = (o: ObrigacaoMin): boolean =>
  ehContratoParcelado(o.categoria) && String(o.status ?? "").trim() !== "Pago";

/**
 * Quanto ainda falta pagar de um patrimônio: soma das parcelas NÃO PAGAS de
 * Financiamento e Consórcio lançadas nas Contas / Obrigações.
 *
 * Não usa o campo `valor_falta` da JUR_PATRIMONIOS: aquilo é um número
 * digitado uma vez na importação e que ninguém atualiza quando uma parcela é
 * paga. Somando as parcelas em aberto, o valor se corrige sozinho a cada baixa.
 */
export function valorQueFalta(obrigacoes: ObrigacaoMin[], patrimonioId: number): number {
  const total = obrigacoes
    .filter(o => Number(o.patrimonio_id) === Number(patrimonioId) && parcelaEmAberto(o))
    .reduce((s, o) => s + numero(o.valor), 0);
  return Math.round(total * 100) / 100;
}

/** Mapa patrimônio → falta, para a tabela não recalcular linha a linha. */
export function mapaValorQueFalta(obrigacoes: ObrigacaoMin[]): Map<number, number> {
  const m = new Map<number, number>();
  obrigacoes.forEach(o => {
    if (!parcelaEmAberto(o)) return;
    const k = Number(o.patrimonio_id);
    m.set(k, Math.round(((m.get(k) ?? 0) + numero(o.valor)) * 100) / 100);
  });
  return m;
}
