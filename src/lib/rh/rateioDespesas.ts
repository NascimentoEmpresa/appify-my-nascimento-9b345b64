// =====================================================================
// RH › Rateio de Despesas — regras de cálculo (mig 20261016000010)
//
// Chamado SIS-2026-0673 ("incluir aba de rateio automático para ir para o
// malote"). Três jeitos de dividir uma despesa entre os contratos:
//
//   · JUS BRASIL — pela planilha "Rateio_Atualizada.xlsx" do RH: cada
//     contrato paga  valor × faturamento do contrato / faturamento total
//     (colunas C/D/E da planilha). A coluna "Consultas" da planilha
//     (G = valor/120 × consultas) estava zerada em todos os contratos; fica
//     como critério alternativo (proporcional às consultas).
//     ⚠ A planilha somava o faturamento só de C3:C89 e deixava de fora as
//     linhas 90–96 (Veranópolis Recep., UFRGS ASB 030/2026, CEITEC, IRGA):
//     esses quatro contratos recebiam rateio POR CIMA do total (107,6%).
//     Aqui o total é a soma de todos os contratos — sempre fecha 100%.
//   · SENIOR — pela quantidade de colaboradores TRABALHANDO por contrato
//     (EMPREGADOS, o mesmo contrato de RH › Ativos/Contratos).
//   · FGTS, Bullla, seguro, BSF, gratificação PCD, mensalidade SEEAC — pelo
//     PDF anexado à despesa: cada linha do PDF com CPF (ou com o nome de um
//     contrato) vira um valor, somado por contrato.
//
// Centavos: a divisão usa o método do maior resto — a soma dos itens é
// SEMPRE igual ao valor da despesa (a planilha arredondava cada linha e a
// soma podia não bater).
// =====================================================================

export type TipoRateio =
  | "jusbrasil"
  | "senior"
  | "fgts"
  | "bullla"
  | "seguro"
  | "bsf"
  | "gratificacao_pcd"
  | "mensalidade_seeac";

export type CriterioRateio = "faturamento" | "consultas" | "colaboradores" | "pdf";

export const TIPOS_RATEIO: { tipo: TipoRateio; rotulo: string; criterio: CriterioRateio }[] = [
  { tipo: "jusbrasil", rotulo: "Jus Brasil", criterio: "faturamento" },
  { tipo: "senior", rotulo: "Senior", criterio: "colaboradores" },
  { tipo: "fgts", rotulo: "FGTS", criterio: "pdf" },
  { tipo: "bullla", rotulo: "Bullla", criterio: "pdf" },
  { tipo: "seguro", rotulo: "Seguro", criterio: "pdf" },
  { tipo: "bsf", rotulo: "BSF", criterio: "pdf" },
  { tipo: "gratificacao_pcd", rotulo: "Gratificação PCD", criterio: "pdf" },
  { tipo: "mensalidade_seeac", rotulo: "Mensalidade SEEAC", criterio: "pdf" },
];

export const rotuloTipo = (t: string) => TIPOS_RATEIO.find((x) => x.tipo === t)?.rotulo ?? t;
export const criterioPadrao = (t: TipoRateio): CriterioRateio =>
  TIPOS_RATEIO.find((x) => x.tipo === t)?.criterio ?? "pdf";
export const tipoUsaPdf = (t: TipoRateio) => criterioPadrao(t) === "pdf";

export const ROTULO_CRITERIO: Record<CriterioRateio, string> = {
  faturamento: "Faturamento do contrato",
  consultas: "Consultas por contrato",
  colaboradores: "Colaboradores trabalhando",
  pdf: "Valores lidos do PDF",
};

// ── Normalização ────────────────────────────────────────────────────────
/** Igual a sup_norm_nome no banco: sem acento, sem pontuação, maiúsculo. */
export function normNome(t: unknown): string {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

/** Igual a rh_norm_contrato: tira "1050 - " da frente e zeros à esquerda. */
export function normContrato(t: unknown): string {
  const s = String(t ?? "")
    .replace(/^\s*\d+\s*-\s*/, "")
    .replace(/(^|[^0-9])0+([0-9])/g, "$1$2");
  return normNome(s);
}

/** Números do contrato ("047/2022", "1610628.2025") → ["47-2022"]. */
export function numerosContrato(t: unknown): string[] {
  const out: string[] = [];
  const re = /(\d+)\s*[./]\s*(\d{2,4})/g;
  let m: RegExpExecArray | null;
  const s = String(t ?? "");
  while ((m = re.exec(s))) out.push(`${Number(m[1])}-${Number(m[2])}`);
  return out;
}

const somenteDigitos = (s: string) => s.replace(/\D/g, "");

// ── Dinheiro ────────────────────────────────────────────────────────────
/** "1.234,56" / "R$ 1.234,56" / "1234.56" / número → 1234.56 (null se não for). */
export function lerMoeda(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").replace(/R\$|\s/g, "");
  if (!s) return null;
  const neg = /^-|^\(.*\)$/.test(s);
  s = s.replace(/[()-]/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export const fmtMoeda = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const fmtPct = (n: number | null | undefined) =>
  `${((n ?? 0) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

// ── Divisão em centavos ─────────────────────────────────────────────────
/**
 * Divide `total` proporcionalmente a `bases`, em centavos, pelo maior resto:
 * a soma do resultado é exatamente `total`. Bases ≤ 0 recebem 0. Se todas
 * forem 0, devolve tudo 0 (não há como ratear).
 */
export function distribuirCentavos(total: number, bases: number[]): number[] {
  const totalCent = Math.round(total * 100);
  const b = bases.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const soma = b.reduce((a, x) => a + x, 0);
  if (soma <= 0 || totalCent === 0) return b.map(() => 0);
  const exatos = b.map((x) => (totalCent * x) / soma);
  const piso = exatos.map((x) => Math.floor(x));
  let sobra = totalCent - piso.reduce((a, x) => a + x, 0);
  const ordem = exatos
    .map((x, i) => ({ i, resto: x - Math.floor(x) }))
    .filter((o) => b[o.i] > 0)
    .sort((p, q) => q.resto - p.resto || b[q.i] - b[p.i] || p.i - q.i);
  for (let k = 0; sobra > 0 && ordem.length > 0; k = (k + 1) % ordem.length, sobra--) piso[ordem[k].i] += 1;
  return piso.map((c) => c / 100);
}

export interface ItemRateio {
  /** contrato_id (uuid) ou null = "Sem contrato / não identificado". */
  contrato_id: string | null;
  contrato_nome: string;
  /** Base do critério: faturamento, consultas, nº de colaboradores ou valor lido do PDF. */
  base: number;
  percentual: number;
  valor: number;
  /** true quando o valor foi digitado à mão (não sai mais da base). */
  ajustado: boolean;
  observacao?: string | null;
}

/**
 * Calcula percentual e valor de cada item a partir da base. Itens marcados
 * como `ajustado` mantêm o valor digitado; o restante da despesa é dividido
 * entre os demais pela base.
 */
export function calcularRateio(valorDespesa: number, itens: ItemRateio[]): ItemRateio[] {
  const fixos = itens.filter((i) => i.ajustado);
  const somaFixos = Math.round(fixos.reduce((a, i) => a + (i.valor || 0), 0) * 100) / 100;
  const livres = itens.map((it, idx) => ({ it, idx })).filter((x) => !x.it.ajustado);
  const valores = distribuirCentavos(
    Math.max(0, Math.round((valorDespesa - somaFixos) * 100) / 100),
    livres.map((x) => x.it.base),
  );
  const out = itens.map((it) => ({ ...it }));
  livres.forEach((x, k) => (out[x.idx].valor = valores[k]));
  out.forEach((it) => (it.percentual = valorDespesa > 0 ? it.valor / valorDespesa : 0));
  return out;
}

export interface ResumoRateio {
  totalItens: number;
  diferenca: number;
  fecha: boolean;
}
export function resumirRateio(valorDespesa: number, itens: ItemRateio[]): ResumoRateio {
  const totalItens = Math.round(itens.reduce((a, i) => a + (i.valor || 0), 0) * 100) / 100;
  const diferenca = Math.round((valorDespesa - totalItens) * 100) / 100;
  return { totalItens, diferenca, fecha: Math.abs(diferenca) < 0.005 };
}

// ── Casar nome de contrato (planilha/PDF) com a tabela contratos ────────
export interface ContratoRef {
  id: string;
  nome: string;
  status?: string | null;
}

/**
 * Acha o contrato pelo nome: exato (normalizado como rh_norm_contrato);
 * senão pelo número ("047/2022") — se o número for de um só contrato, ou de
 * vários e só um deles também casar a primeira palavra (UFFS CHAPECÓ ×
 * UFFS ERECHIM têm o mesmo 041/2021). Ativo ganha de encerrado. Na dúvida,
 * null (fica para escolher na tela).
 */
export function acharContrato(nome: string, contratos: ContratoRef[]): ContratoRef | null {
  const alvo = normContrato(nome);
  if (!alvo) return null;
  const pref = (lista: ContratoRef[]) =>
    lista.length === 1
      ? lista[0]
      : lista.filter((c) => (c.status ?? "ativo") !== "encerrado").length === 1
        ? lista.find((c) => (c.status ?? "ativo") !== "encerrado")!
        : null;
  const exatos = contratos.filter((c) => normContrato(c.nome) === alvo);
  if (exatos.length) return pref(exatos) ?? exatos[0];

  const nums = numerosContrato(nome);
  if (!nums.length) return null;
  const mesmoNumero = contratos.filter((c) => numerosContrato(c.nome).some((n) => nums.includes(n)));
  if (mesmoNumero.length === 1) return mesmoNumero[0];
  if (mesmoNumero.length > 1) {
    // Palavras do nome (sem o número) contidas no nome do contrato.
    const palavras = String(nome)
      .replace(/\d+\s*[./]\s*\d{2,4}/g, " ")
      .split(/[^A-Za-zÀ-ÿ0-9]+/)
      .map(normNome)
      .filter((p) => p.length >= 3);
    const pontua = (c: ContratoRef) => {
      const n = normContrato(c.nome);
      return palavras.filter((p) => n.includes(p)).length;
    };
    const max = Math.max(...mesmoNumero.map(pontua));
    if (max > 0) {
      const melhores = mesmoNumero.filter((c) => pontua(c) === max);
      return pref(melhores);
    }
  }
  return null;
}

// ── Planilha do Jus Brasil (importar faturamento/consultas) ─────────────
export interface LinhaPlanilhaJus {
  nome: string;
  faturamento: number;
  consultas: number;
}

/**
 * Lê as linhas da planilha no formato do RH (cabeçalho "CONTRATOS" /
 * "FATURAMENTO" / … / "Consultas"). Recebe a matriz de células
 * (XLSX.utils.sheet_to_json com header:1). Acha as colunas pelo cabeçalho;
 * linhas sem nome de contrato ou de total (número puro) são ignoradas.
 */
export function lerPlanilhaJusBrasil(linhas: unknown[][]): LinhaPlanilhaJus[] {
  let iCab = -1;
  let cNome = -1;
  let cFat = -1;
  let cCons = -1;
  for (let r = 0; r < Math.min(linhas.length, 30) && iCab < 0; r++) {
    const row = linhas[r] ?? [];
    row.forEach((v, c) => {
      const n = normNome(v);
      if (n === "CONTRATOS" || n === "CONTRATO") cNome = c;
      else if (n.startsWith("FATURAMENTO")) cFat = c;
      else if (n.startsWith("CONSULTA")) cCons = c;
    });
    if (cNome >= 0 && cFat >= 0) iCab = r;
    else { cNome = -1; cFat = -1; cCons = -1; }
  }
  if (iCab < 0) throw new Error('Não achei o cabeçalho "CONTRATOS" / "FATURAMENTO" na planilha.');
  const out: LinhaPlanilhaJus[] = [];
  for (const row of linhas.slice(iCab + 1)) {
    const nome = String(row?.[cNome] ?? "").trim();
    if (!nome || /^\d+([.,]\d+)?$/.test(nome)) continue;
    out.push({
      nome,
      faturamento: lerMoeda(row?.[cFat]) ?? 0,
      consultas: cCons >= 0 ? lerMoeda(row?.[cCons]) ?? 0 : 0,
    });
  }
  return out;
}

// ── Leitura do PDF (texto já extraído, uma string por linha) ────────────
export interface LinhaPdf {
  /** Índice da linha no PDF (para mostrar na conferência). */
  n: number;
  texto: string;
  cpf: string | null;
  valor: number;
}

const RE_CPF = /(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/;
const RE_MOEDA = /(?<![\d,.])-?\d{1,3}(?:\.\d{3})*,\d{2}(?![\d,])/g;

/** CPF válido (dígitos verificadores) — evita pegar PIS/código de barras. */
export function cpfValido(cpf: string): boolean {
  const d = somenteDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** Valores em reais de uma linha ("1.234,56"). */
export function valoresDaLinha(texto: string): number[] {
  return (texto.match(RE_MOEDA) ?? []).map((s) => lerMoeda(s) ?? 0);
}

/**
 * Extrai do texto do PDF as linhas que têm um CPF e um valor. O valor é o
 * ÚLTIMO valor em reais da linha (a coluna de total costuma ser a última);
 * se a linha do CPF não tiver valor, olha as duas linhas seguintes (layout
 * em que o valor quebra a linha), desde que elas não tenham outro CPF.
 */
export function extrairLinhasComCpf(linhas: string[]): LinhaPdf[] {
  const out: LinhaPdf[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(RE_CPF);
    if (!m || !cpfValido(m[1])) continue;
    const cpf = somenteDigitos(m[1]);
    const semCpf = linhas[i].replace(m[1], " ");
    let vals = valoresDaLinha(semCpf);
    let texto = linhas[i];
    for (let k = 1; !vals.length && k <= 2 && i + k < linhas.length; k++) {
      if (RE_CPF.test(linhas[i + k])) break;
      vals = valoresDaLinha(linhas[i + k]);
      texto += " " + linhas[i + k];
    }
    if (!vals.length) continue;
    out.push({ n: i + 1, texto: texto.trim(), cpf, valor: vals[vals.length - 1] });
  }
  return out;
}

export interface LinhaPdfContrato extends LinhaPdf {
  contrato: ContratoRef | null;
}

/**
 * PDF sem CPF (fatura agrupada por contrato/centro de custo): linhas com
 * valor cujo texto casa com o nome ou o número de um contrato.
 */
export function extrairLinhasPorContrato(linhas: string[], contratos: ContratoRef[]): LinhaPdfContrato[] {
  const out: LinhaPdfContrato[] = [];
  linhas.forEach((l, i) => {
    const vals = valoresDaLinha(l);
    if (!vals.length) return;
    const nomeParte = l.replace(RE_MOEDA, " ").trim();
    const c = acharContrato(nomeParte, contratos) ?? acharContratoContido(nomeParte, contratos);
    if (c) out.push({ n: i + 1, texto: l.trim(), cpf: null, valor: vals[vals.length - 1], contrato: c });
  });
  return out;
}

/** O nome normalizado de UM só contrato aparece dentro da linha. */
function acharContratoContido(texto: string, contratos: ContratoRef[]): ContratoRef | null {
  const t = normContrato(texto);
  if (t.length < 6) return null;
  const achados = contratos.filter((c) => {
    const n = normContrato(c.nome);
    return n.length >= 6 && t.includes(n);
  });
  if (!achados.length) return null;
  // O mais longo é o mais específico ("UFRGS LIMPEZA GERAL" × "UFRGS LIMPEZA").
  achados.sort((a, b) => normContrato(b.nome).length - normContrato(a.nome).length);
  const top = normContrato(achados[0].nome).length;
  const empatados = achados.filter((c) => normContrato(c.nome).length === top);
  return empatados.length === 1 ? empatados[0] : null;
}

/** Soma valores por chave de contrato (null = sem contrato). */
export function somarPorContrato<T extends { contrato_id: string | null; contrato_nome: string; valor: number }>(
  linhas: T[],
): { contrato_id: string | null; contrato_nome: string; base: number; qtd: number }[] {
  const m = new Map<string, { contrato_id: string | null; contrato_nome: string; base: number; qtd: number }>();
  for (const l of linhas) {
    const k = l.contrato_id ?? "__sem__";
    const cur = m.get(k) ?? { contrato_id: l.contrato_id, contrato_nome: l.contrato_nome, base: 0, qtd: 0 };
    cur.base = Math.round((cur.base + l.valor) * 100) / 100;
    cur.qtd += 1;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.base - a.base);
}

export const SEM_CONTRATO = "Sem contrato / não identificado";

/** "2026-10" → "2026-10-01" (competência gravada como 1º dia do mês). */
export const competenciaParaData = (mes: string) => (/^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : mes);
export const competenciaRotulo = (d: string | null | undefined) => {
  const m = String(d ?? "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : "";
};
