// Jurídico / Patrimônio — aba "Parcelas": composição do financiamento
// (SIS-2026-0909, 16/11/2026).
//
// PEDIDO (Fernanda Maldaner, Diretoria Administrativa): a aba mostrava só
// parcela, vencimento, valor e situação. Financeiro, Contabilidade e
// Presidência precisam enxergar, sem planilha à parte, a COMPOSIÇÃO de cada
// pagamento (amortização, juros, MIP/DFI, taxas, FCVS/FGTS, impontualidade,
// diferença), quanto foi para o principal, a correção monetária (INCC/TR) e o
// efeito no saldo devedor — com um resumo do período no topo.
//
// Toda a conta mora aqui, sem React, para ser testada
// (src/test/patrimonio-financiamento.test.ts). Regras que o chamado deixou
// explícitas e que esta camada garante:
//   • NULL é "não informado" e é diferente de zero. Soma de um componente que
//     NENHUMA parcela do período informou volta null (a tela escreve "A
//     apurar"), nunca 0.
//   • "Seguros / FGHAB" pode ser o SUBTOTAL de MIP + DFI (padrão do
//     demonstrativo CAIXA): nesse caso não se soma de novo.
//   • A correção monetária atualiza o SALDO; ela não entra no pagamento da
//     parcela. A evolução do saldo é: anterior + atualização − amortização ±
//     outros movimentos = saldo após.
//   • A "Diferença de valor" mantém o sinal e deixa a parcela "A CONFERIR".
//   • Mais de um pagamento por parcela: o pago é a soma; menos que o devido é
//     PARCIAL.
//   • Índice de correção é percentual OU fator — e é mostrado como tal.
//
// As parcelas importadas da planilha ATIVO IMOBILIZADO (09/2026) trazem as
// colunas extras soltas em `detalhes` ("JURO", "INCC DO MÊS"…). Enquanto
// ninguém preenche a composição estruturada, ela é lida de lá
// (`componentesDaParcela`) — e o "INCC DO MÊS", que é célula de porcentagem
// do Excel (0,0058 = 0,58%), deixa de aparecer como "R$ 0,01".

// ── Tipos ────────────────────────────────────────────────────────────────

export type TipoIndice = "percentual" | "fator";

/** Linha de JUR_PATRIMONIO_PARCELAS no recorte que a composição usa. */
export interface ParcelaFinanciamento {
  id: number | string;
  ordem?: number | null;
  numero?: number | null;
  rotulo?: string | null;
  vencimento?: string | null;
  data_pagamento?: string | null;
  valor?: number | string | null;            // valor devido (prestação)
  valor_pago?: number | string | null;
  situacao?: string | null;
  detalhes?: Record<string, unknown> | null;
  financiamento_id?: number | string | null;
  amortizacao?: number | string | null;
  juros?: number | string | null;
  seguro_mip?: number | string | null;
  seguro_dfi?: number | string | null;
  seguros_fghab?: number | string | null;
  seguros_fghab_subtotal?: boolean | null;
  taxas?: number | string | null;
  valor_fcvs?: number | string | null;
  fgts_utilizado?: number | string | null;
  encargo_liquido?: number | string | null;
  valor_impontualidade?: number | string | null;
  multa_atraso?: number | string | null;
  juros_atraso?: number | string | null;
  diferenca_valor?: number | string | null;
  atualizacao_monetaria?: number | string | null;
  outros_movimentos?: number | string | null;
  saldo_anterior?: number | string | null;
  saldo_devedor?: number | string | null;
  indice_correcao?: number | string | null;
  indice_tipo?: TipoIndice | string | null;
  encargos_inclusos?: boolean | null;
  projetado?: boolean | null;
  /** Vem de aplicarBaixaDasContas: "planilha" | "malote" | "conta" | null. */
  baixa?: string | null;
}

export interface PagamentoParcela {
  id?: number | string;
  parcela_id: number | string;
  data_pagamento?: string | null;
  valor?: number | string | null;
}

/** Os campos numéricos da composição, já resolvidos (estruturado ou detalhes). */
export interface Componentes {
  amortizacao: number | null;
  juros: number | null;
  seguro_mip: number | null;
  seguro_dfi: number | null;
  seguros_fghab: number | null;
  taxas: number | null;
  valor_fcvs: number | null;
  fgts_utilizado: number | null;
  encargo_liquido: number | null;
  valor_impontualidade: number | null;
  multa_atraso: number | null;
  juros_atraso: number | null;
  diferenca_valor: number | null;
  atualizacao_monetaria: number | null;
  outros_movimentos: number | null;
  saldo_anterior: number | null;
  saldo_devedor: number | null;
  indice_correcao: number | null;
  indice_tipo: TipoIndice | null;
  /** Soma dos seguros SEM contar o subtotal duas vezes. */
  seguros: number | null;
  /** true quando algum valor veio de `detalhes` (planilha), não do cadastro. */
  daPlanilha: boolean;
}

export const CAMPOS_COMPONENTES = [
  "amortizacao", "juros", "seguro_mip", "seguro_dfi", "seguros_fghab", "taxas", "valor_fcvs",
  "fgts_utilizado", "encargo_liquido", "valor_impontualidade", "multa_atraso", "juros_atraso",
  "diferenca_valor", "atualizacao_monetaria", "outros_movimentos", "saldo_anterior", "saldo_devedor",
  "indice_correcao",
] as const;
export type CampoComponente = typeof CAMPOS_COMPONENTES[number];

// ── Números ──────────────────────────────────────────────────────────────

/**
 * Número de banco, de planilha ou digitado em pt-BR. "" / null / lixo = null
 * (não informado) — nunca 0.
 *   "2.370,11" → 2370.11 · "R$ -347,72" → -347.72 · "1,00122401" → 1.00122401
 *   "2370.11" → 2370.11 · "1.234.567" → 1234567
 */
export function numeroOuNulo(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s|R\$|%/gi, "");
  if (!s || s === "-" || s === "—") return null;
  // (123,45) de contabilidade = negativo
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Soma que respeita o "não informado": nenhum valor → null. */
export function somaOuNulo(valores: Array<number | null | undefined>): number | null {
  const ok = valores.filter((v): v is number => v != null && Number.isFinite(v));
  return ok.length ? arred(ok.reduce((s, v) => s + v, 0)) : null;
}

// ── Leitura dos detalhes da planilha ─────────────────────────────────────

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

/**
 * Qual componente uma coluna solta da planilha representa. Ordem importa:
 * "JUROS DE MORA" é impontualidade, não juros contratuais; "SALDO ANTERIOR"
 * antes de "SALDO".
 */
export function campoDoDetalhe(chave: string): CampoComponente | null {
  const k = normal(chave);
  if (/AMORTIZ/.test(k)) return "amortizacao";
  if (/MORA|IMPONTUAL|ATRASO|MULTA/.test(k)) return "valor_impontualidade";
  if (/^JURO|JUROS/.test(k)) return "juros";
  if (/\bMIP\b|\bMPI\b/.test(k)) return "seguro_mip";
  if (/\bDFI\b/.test(k)) return "seguro_dfi";
  if (/SEGURO|FGHAB/.test(k)) return "seguros_fghab";
  if (/FCVS/.test(k)) return "valor_fcvs";
  if (/FGTS/.test(k)) return "fgts_utilizado";
  if (/^TX\b|TAXA|TARIFA/.test(k)) return "taxas";
  if (/ENCARGO/.test(k)) return "encargo_liquido";
  if (/DIFEREN/.test(k)) return "diferenca_valor";
  if (/ATUALIZ|CORRECAO MONET|CORRECAO DO SALDO/.test(k)) return "atualizacao_monetaria";
  if (/SALDO ANTERIOR/.test(k)) return "saldo_anterior";
  if (/SALDO/.test(k)) return "saldo_devedor";
  if (/INCC|INDICE|\bIPCA\b|\bIGP|\bTR\b/.test(k)) return "indice_correcao";
  return null;
}

/** Colunas da planilha que já viraram componente — a tabela não as repete. */
export const detalheReconhecido = (chave: string) => campoDoDetalhe(chave) != null;

// ── Composição da parcela ────────────────────────────────────────────────

export function componentesDaParcela(p: ParcelaFinanciamento): Componentes {
  const out = {} as Record<CampoComponente, number | null>;
  let daPlanilha = false;
  for (const c of CAMPOS_COMPONENTES) out[c] = numeroOuNulo(p[c]);
  let indiceTipo: TipoIndice | null = p.indice_tipo === "fator" || p.indice_tipo === "percentual" ? p.indice_tipo : null;

  for (const [chave, bruto] of Object.entries(p.detalhes ?? {})) {
    const campo = campoDoDetalhe(chave);
    if (!campo || out[campo] != null) continue;
    const v = numeroOuNulo(bruto);
    if (v == null) continue;
    if (campo === "indice_correcao") {
      // Célula de % do Excel chega como fração (0,0058 = 0,58%). Fator
      // (1,0012…) fica fator.
      if (v > 0.5 && v < 2) { out.indice_correcao = v; indiceTipo = "fator"; }
      else { out.indice_correcao = Math.abs(v) < 0.5 ? Math.round(v * 100 * 1e8) / 1e8 : v; indiceTipo = "percentual"; }
    } else out[campo] = v;
    daPlanilha = true;
  }

  return { ...out, indice_tipo: out.indice_correcao == null ? null : indiceTipo, seguros: segurosDe(out, p.seguros_fghab_subtotal), daPlanilha };
}

/**
 * Seguros da parcela sem dupla contagem. Quando "Seguros / FGHAB" é subtotal
 * (padrão), ele manda; MIP/DFI só entram sozinhos se o subtotal não veio.
 */
export function segurosDe(c: Pick<Componentes, "seguro_mip" | "seguro_dfi" | "seguros_fghab">, ehSubtotal?: boolean | null): number | null {
  const subtotal = ehSubtotal !== false;
  if (subtotal) return c.seguros_fghab != null ? c.seguros_fghab : somaOuNulo([c.seguro_mip, c.seguro_dfi]);
  return somaOuNulo([c.seguro_mip, c.seguro_dfi, c.seguros_fghab]);
}

// ── Pagamento e situação ─────────────────────────────────────────────────

/** Pagamentos agrupados por parcela. */
export function pagamentosPorParcela(pags: PagamentoParcela[]): Map<string, PagamentoParcela[]> {
  const m = new Map<string, PagamentoParcela[]>();
  for (const pg of pags) {
    const k = String(pg.parcela_id);
    (m.get(k) ?? m.set(k, []).get(k)!).push(pg);
  }
  for (const ls of m.values()) ls.sort((a, b) => String(a.data_pagamento ?? "").localeCompare(String(b.data_pagamento ?? "")));
  return m;
}

/**
 * Quanto foi pago na parcela. Com pagamentos detalhados, é a soma deles;
 * senão o `valor_pago` da linha; senão, se a parcela está quitada (planilha ou
 * baixa nas contas), o valor devido; senão null.
 */
export function valorPagoDa(p: ParcelaFinanciamento, pags?: PagamentoParcela[]): number | null {
  if (pags && pags.length) return somaOuNulo(pags.map(x => numeroOuNulo(x.valor)));
  const vp = numeroOuNulo(p.valor_pago);
  if (vp != null) return vp;
  if (p.baixa) return numeroOuNulo(p.valor);
  return null;
}

/** Data do (último) pagamento. */
export function dataPagamentoDa(p: ParcelaFinanciamento, pags?: PagamentoParcela[]): string | null {
  if (pags && pags.length) return String(pags[pags.length - 1].data_pagamento ?? "") || null;
  return p.data_pagamento ? String(p.data_pagamento).slice(0, 10) : null;
}

export type Situacao = "PAGA" | "PARCIAL" | "A CONFERIR" | "VENCIDA" | "EM ABERTO" | "PROJETADA";

export const SITUACOES: { valor: "" | Situacao; rotulo: string }[] = [
  { valor: "", rotulo: "Todas" },
  { valor: "PAGA", rotulo: "Pagas" },
  { valor: "EM ABERTO", rotulo: "Em aberto" },
  { valor: "VENCIDA", rotulo: "Vencidas" },
  { valor: "PARCIAL", rotulo: "Pagas em parte" },
  { valor: "A CONFERIR", rotulo: "A conferir" },
  { valor: "PROJETADA", rotulo: "Projetadas" },
];

const TOL = 0.01;

/**
 * Situação de uma parcela. Ordem das regras:
 *   1) diferença de valor informada ≠ 0 → A CONFERIR (vai para conciliação);
 *   2) pago ≥ devido, ou baixa sem pagamento detalhado → PAGA;
 *      pago > devido em mais de 1 centavo → A CONFERIR;
 *   3) 0 < pago < devido → PARCIAL;
 *   4) sem pagamento: projetada (valores simulados) → PROJETADA;
 *      vencida (antes de hoje) → VENCIDA; senão EM ABERTO.
 */
export function situacaoDa(p: ParcelaFinanciamento, pags: PagamentoParcela[] | undefined, hoje: string): Situacao {
  const comp = componentesDaParcela(p);
  const devido = numeroOuNulo(p.valor);
  const pago = valorPagoDa(p, pags);
  const temPagamentoDetalhado = !!(pags && pags.length);
  if (comp.diferenca_valor != null && Math.abs(comp.diferenca_valor) >= TOL) return "A CONFERIR";
  if (pago != null && pago > 0) {
    if (devido == null) return "PAGA";
    if (pago - devido > TOL) return "A CONFERIR";
    if (devido - pago <= TOL) return "PAGA";
    // Parcela quitada pela planilha/contas sem pagamento detalhado: o valor
    // pago da planilha às vezes é a prestação sem encargos — não é parcial.
    if (p.baixa && !temPagamentoDetalhado) return "PAGA";
    return "PARCIAL";
  }
  if (p.baixa) return "PAGA";
  if (p.projetado) return "PROJETADA";
  const v = String(p.vencimento ?? "").slice(0, 10);
  if (v && v < hoje) return "VENCIDA";
  return "EM ABERTO";
}

export const corDaSituacao = (s: Situacao): { fundo: string; texto: string } => ({
  "PAGA": { fundo: "#dcfce7", texto: "#15803d" },
  "PARCIAL": { fundo: "#fef9c3", texto: "#a16207" },
  "A CONFERIR": { fundo: "#ede9fe", texto: "#6d28d9" },
  "VENCIDA": { fundo: "#fee2e2", texto: "#b91c1c" },
  "EM ABERTO": { fundo: "#fff7ed", texto: "#c2410c" },
  "PROJETADA": { fundo: "#f1f5f9", texto: "#475569" },
}[s]);

// ── Período ──────────────────────────────────────────────────────────────

/**
 * Período do filtro: "" = contrato todo, "2026" = ano, "2026-03" = mês. A
 * parcela entra pela competência do vencimento.
 */
export const noPeriodo = (vencimento: string | null | undefined, periodo: string) =>
  !periodo || String(vencimento ?? "").startsWith(periodo);

/** Último dia do período ("2026-02" → "2026-02-28"; "" → null). */
export function fimDoPeriodo(periodo: string): string | null {
  if (!periodo) return null;
  if (/^\d{4}$/.test(periodo)) return `${periodo}-12-31`;
  const [a, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 0));
  return d.toISOString().slice(0, 10);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function rotuloPeriodo(periodo: string): string {
  if (!periodo) return "Contrato inteiro";
  if (/^\d{4}$/.test(periodo)) return `Ano de ${periodo}`;
  const [a, m] = periodo.split("-");
  const nome = MESES[Number(m) - 1] ?? m;
  return `${nome[0].toUpperCase()}${nome.slice(1)}/${a}`;
}

/** Opções do filtro de competência a partir das parcelas: anos e meses. */
export function opcoesDePeriodo(parcelas: Pick<ParcelaFinanciamento, "vencimento">[]): string[] {
  const meses = [...new Set(parcelas.map(p => String(p.vencimento ?? "").slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort();
  const anos = [...new Set(meses.map(m => m.slice(0, 4)))];
  const out: string[] = [];
  for (const a of anos) { out.push(a); out.push(...meses.filter(m => m.startsWith(a))); }
  return out;
}

// ── Resumo do período (cartões do topo) ──────────────────────────────────

export interface ResumoPeriodo {
  quantidade: number;
  pago: number | null;
  amortizacao: number | null;
  juros: number | null;
  segurosETaxas: number | null;
  correcao: number | null;
  devido: number | null;
  /** Devido − pago das parcelas vencidas e não quitadas (até `hoje`). */
  vencidoEmAberto: number;
  /** Devido das parcelas futuras ainda não pagas (projeção). */
  futuro: number;
  /** Quantas linhas usam valor projetado. */
  projetadas: number;
}

export interface LinhaResolvida {
  p: ParcelaFinanciamento;
  comp: Componentes;
  pago: number | null;
  dataPagamento: string | null;
  situacao: Situacao;
  pagamentos: PagamentoParcela[];
}

/** Junta tudo que a tela desenha de uma parcela. */
export function resolverParcelas(
  parcelas: ParcelaFinanciamento[], pagamentos: PagamentoParcela[], hoje: string,
): LinhaResolvida[] {
  const porParc = pagamentosPorParcela(pagamentos);
  return parcelas.map(p => {
    const pags = porParc.get(String(p.id)) ?? [];
    return {
      p, comp: componentesDaParcela(p), pagamentos: pags,
      pago: valorPagoDa(p, pags), dataPagamento: dataPagamentoDa(p, pags),
      situacao: situacaoDa(p, pags, hoje),
    };
  });
}

export function resumoDoPeriodo(linhas: LinhaResolvida[], hoje: string): ResumoPeriodo {
  const pagas = linhas.filter(l => l.pago != null && l.pago > 0);
  const abertas = linhas.filter(l => l.situacao !== "PAGA");
  const restante = (l: LinhaResolvida) => Math.max(0, (numeroOuNulo(l.p.valor) ?? 0) - (l.pago ?? 0));
  return {
    quantidade: linhas.length,
    pago: somaOuNulo(pagas.map(l => l.pago)),
    // Componentes do que FOI pago: amortização, juros, seguros e taxas de
    // parcela em aberto ainda não aconteceram.
    amortizacao: somaOuNulo(pagas.map(l => l.comp.amortizacao)),
    juros: somaOuNulo(pagas.map(l => l.comp.juros)),
    segurosETaxas: somaOuNulo(pagas.flatMap(l => [l.comp.seguros, l.comp.taxas])),
    // A correção do saldo acontece mesmo sem pagamento: soma do período todo.
    correcao: somaOuNulo(linhas.map(l => l.comp.atualizacao_monetaria)),
    devido: somaOuNulo(linhas.map(l => numeroOuNulo(l.p.valor))),
    vencidoEmAberto: arred(abertas.filter(l => String(l.p.vencimento ?? "") < hoje).reduce((s, l) => s + restante(l), 0)),
    futuro: arred(abertas.filter(l => String(l.p.vencimento ?? "") >= hoje).reduce((s, l) => s + restante(l), 0)),
    projetadas: linhas.filter(l => l.p.projetado).length,
  };
}

// ── Saldo devedor ────────────────────────────────────────────────────────

export interface SaldoReferencia {
  valor: number;
  data: string | null;
  /** "Após a parcela 83" | "Informado no contrato". */
  origem: string;
  projetado: boolean;
}

const ordemVenc = (a: ParcelaFinanciamento, b: ParcelaFinanciamento) =>
  String(a.vencimento ?? "9999").localeCompare(String(b.vencimento ?? "9999")) || (Number(a.ordem ?? 0) - Number(b.ordem ?? 0));

export const rotuloParcela = (p: Pick<ParcelaFinanciamento, "rotulo" | "numero">) =>
  p.rotulo || (p.numero != null ? `${p.numero}ª` : "—");

/**
 * Saldo devedor com a SUA data de referência: o da última parcela (até o fim
 * do período) que traz saldo; senão o informado no contrato.
 */
export function saldoDeReferencia(
  todas: ParcelaFinanciamento[], periodo: string,
  contrato?: { saldo_devedor_informado?: number | string | null; saldo_devedor_data?: string | null } | null,
): SaldoReferencia | null {
  const fim = fimDoPeriodo(periodo);
  const comSaldo = todas
    .filter(p => (!fim || String(p.vencimento ?? "") <= fim))
    .map(p => ({ p, s: componentesDaParcela(p).saldo_devedor }))
    .filter(x => x.s != null)
    .sort((a, b) => ordemVenc(a.p, b.p));
  const ult = comSaldo[comSaldo.length - 1];
  const informado = numeroOuNulo(contrato?.saldo_devedor_informado);
  const dataInf = contrato?.saldo_devedor_data ? String(contrato.saldo_devedor_data).slice(0, 10) : null;
  // O informado no contrato só ganha se for mais novo que a última parcela
  // com saldo (e couber no período).
  if (informado != null && (!fim || !dataInf || dataInf <= fim)) {
    const dataParc = ult ? String(ult.p.data_pagamento ?? ult.p.vencimento ?? "").slice(0, 10) : "";
    if (!ult || (dataInf && dataInf > dataParc)) return { valor: informado, data: dataInf, origem: "Informado no contrato", projetado: false };
  }
  if (!ult) return null;
  return {
    valor: ult.s!,
    data: String(ult.p.data_pagamento ?? ult.p.vencimento ?? "").slice(0, 10) || null,
    origem: `Após a parcela ${rotuloParcela(ult.p).replace(/ª$/, "")}`,
    projetado: !!ult.p.projetado,
  };
}

export interface EvolucaoSaldo {
  saldoAnterior: number | null;
  atualizacao: number | null;
  amortizacao: number | null;
  outros: number | null;
  saldoApos: number | null;
  /** saldoApos − saldoAnterior: negativo = a dívida diminuiu. */
  variacao: number | null;
  /** Quanto o saldo informado difere da conta anterior + atualização − amortização ± outros. */
  divergencia: number | null;
}

/**
 * Evolução do saldo no recorte (uma parcela ou um período): de onde partiu,
 * quanto a correção somou, quanto a amortização tirou e onde parou.
 * `todas` dá o saldo anterior quando a 1ª parcela do recorte não o informa
 * (é o saldo após a parcela de antes).
 */
export function evolucaoDoSaldo(recorte: ParcelaFinanciamento[], todas: ParcelaFinanciamento[] = recorte): EvolucaoSaldo | null {
  if (!recorte.length) return null;
  const ord = [...recorte].sort(ordemVenc);
  const comps = ord.map(componentesDaParcela);
  const primeira = ord[0];
  let saldoAnterior = comps[0].saldo_anterior;
  if (saldoAnterior == null) {
    const antes = [...todas].sort(ordemVenc).filter(p => ordemVenc(p, primeira) < 0 && String(p.id) !== String(primeira.id));
    for (let i = antes.length - 1; i >= 0; i--) {
      const s = componentesDaParcela(antes[i]).saldo_devedor;
      if (s != null) { saldoAnterior = s; break; }
    }
  }
  const atualizacao = somaOuNulo(comps.map(c => c.atualizacao_monetaria));
  const amortizacao = somaOuNulo(comps.map(c => c.amortizacao));
  const outros = somaOuNulo(comps.map(c => c.outros_movimentos));
  let saldoApos: number | null = null;
  for (let i = comps.length - 1; i >= 0; i--) if (comps[i].saldo_devedor != null) { saldoApos = comps[i].saldo_devedor; break; }
  const calculado = saldoAnterior != null
    ? arred(saldoAnterior + (atualizacao ?? 0) - (amortizacao ?? 0) + (outros ?? 0))
    : null;
  if (saldoApos == null && calculado != null && (atualizacao != null || amortizacao != null)) saldoApos = calculado;
  if (saldoAnterior == null && saldoApos == null && atualizacao == null && amortizacao == null) return null;
  return {
    saldoAnterior, atualizacao, amortizacao, outros, saldoApos,
    variacao: saldoAnterior != null && saldoApos != null ? arred(saldoApos - saldoAnterior) : null,
    divergencia: calculado != null && saldoApos != null && Math.abs(saldoApos - calculado) >= TOL ? arred(saldoApos - calculado) : null,
  };
}

// ── Índice e INCC ────────────────────────────────────────────────────────

/** Fator multiplicador de um índice (0,58% → 1,0058; fator fica fator). */
export function fatorDoIndice(valor: number | null, tipo: TipoIndice | null): number | null {
  if (valor == null) return null;
  return tipo === "fator" ? valor : 1 + valor / 100;
}

const fmtNum = (v: number, casas: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** "0,5800%" para percentual, "1,00122401" para fator; null → null. */
export function rotuloIndice(valor: number | null, tipo: TipoIndice | null): string | null {
  if (valor == null) return null;
  if (tipo === "fator") return fmtNum(valor, 8);
  return fmtNum(valor, 4) + "%";
}

export interface CalculoIncc { fator: number; correcao: number; corrigido: number }

/**
 * Correção do INCC sobre uma base: pelo % aplicado ou pelo fator. Quem tem os
 * dois, o fator manda (é o que o contrato aplicou de fato).
 */
export function calcularIncc(base: number | null, opts: { percentual?: number | null; fator?: number | null }): CalculoIncc | null {
  if (base == null) return null;
  const fator = opts.fator != null ? opts.fator : opts.percentual != null ? 1 + opts.percentual / 100 : null;
  if (fator == null) return null;
  const correcao = arred(base * (fator - 1));
  return { fator, correcao, corrigido: arred(base + correcao) };
}

export interface AplicacaoIncc {
  id?: number | string;
  competencia: string;
  correcao?: number | string | null;
  valor_anterior?: number | string | null;
  valor_corrigido?: number | string | null;
  base_calculo?: number | string | null;
  taxa_indice_pct?: number | string | null;
  percentual_aplicado?: number | string | null;
  fator_aplicado?: number | string | null;
}

/** Histórico em ordem de competência, com a correção acumulada em R$. */
export function historicoIncc<A extends AplicacaoIncc>(aplicacoes: A[]): Array<A & { correcaoValor: number | null; acumulado: number }> {
  let acc = 0;
  return [...aplicacoes]
    .sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)))
    .map(a => {
      let c = numeroOuNulo(a.correcao);
      if (c == null) {
        const ant = numeroOuNulo(a.valor_anterior), dep = numeroOuNulo(a.valor_corrigido);
        if (ant != null && dep != null) c = arred(dep - ant);
        else {
          const calc = calcularIncc(numeroOuNulo(a.base_calculo) ?? ant, { fator: numeroOuNulo(a.fator_aplicado), percentual: numeroOuNulo(a.percentual_aplicado) ?? numeroOuNulo(a.taxa_indice_pct) });
          c = calc?.correcao ?? null;
        }
      }
      acc = arred(acc + (c ?? 0));
      return { ...a, correcaoValor: c, acumulado: acc };
    });
}

export const APLICACOES_INCC = [
  { valor: "aplicavel", rotulo: "Aplicável" },
  { valor: "nao_previsto", rotulo: "Não previsto" },
  { valor: "a_confirmar", rotulo: "A confirmar" },
] as const;
export const MODALIDADES_INCC = ["INCC-M", "INCC-DI", "INCC-10"] as const;
export const BASES_INCC = [
  { valor: "saldo", rotulo: "Saldo devedor" },
  { valor: "parcela", rotulo: "Parcela" },
  { valor: "outra", rotulo: "Outra obrigação" },
] as const;

export const rotuloAplicacaoIncc = (v?: string | null) =>
  APLICACOES_INCC.find(x => x.valor === v)?.rotulo ?? "A confirmar";

// ── Importação (colar do Excel / CSV do demonstrativo) ───────────────────

/** Campos que a importação sabe preencher, além dos componentes. */
export type CampoImportacao = CampoComponente | "numero" | "rotulo" | "vencimento" | "valor" | "valor_pago" | "data_pagamento";

/** Cabeçalho da planilha → campo. Mesma régua tolerante do importador antigo. */
export function campoDoCabecalho(cab: string): CampoImportacao | null {
  const k = normal(cab).replace(/\s+/g, " ");
  if (!k) return null;
  if (/^(N|NO|N\.|Nº|NUMERO|PARCELA|PARC|PARC\.|PRESTACAO N|N PARCELA|Nº PARCELA)$/.test(k)) return "numero";
  if (/^(ROTULO|TIPO|DESCRICAO)$/.test(k)) return "rotulo";
  if (/^(DATA DE )?PAGAMENTO$|^DATA PAGAMENTO$|^DT\.? PAGAMENTO$|^PAGO EM$/.test(k)) return "data_pagamento";
  if (/VENC/.test(k) || /^DATA$/.test(k)) return "vencimento";
  if (/^VALOR PAGO$|^PAGO$|^VL\.? PAGO$/.test(k)) return "valor_pago";
  if (/^(VALOR DEVIDO|PRESTACAO|VALOR DA PRESTACAO|VALOR PARCELA|VALOR DA PARCELA|VALOR|TOTAL|ENCARGO TOTAL)$/.test(k)) return "valor";
  if (/SALDO ANTERIOR/.test(k)) return "saldo_anterior";
  if (/OUTROS/.test(k)) return "outros_movimentos";
  return campoDoDetalhe(k);
}

export interface ResultadoImportacao {
  linhas: Array<Partial<Record<CampoImportacao, string | number | null>>>;
  reconhecidas: string[];
  ignoradas: string[];
  erros: string[];
}

/** Data dd/mm/aaaa, aaaa-mm-dd ou mm/aaaa (vira o dia 1º). */
export function dataOuNulo(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const a = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}-01`;
  return null;
}

/** Quebra uma linha de CSV respeitando aspas. */
function partir(linha: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", dentro = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') { if (dentro && linha[i + 1] === '"') { cur += '"'; i++; } else dentro = !dentro; }
    else if (ch === sep && !dentro) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(c => c.trim());
}

/**
 * Lê o texto colado do Excel (tabulação) ou um CSV (; ou ,). A 1ª linha com
 * pelo menos 2 colunas reconhecidas é o cabeçalho. Coluna não reconhecida é
 * listada em `ignoradas`, nunca gravada às cegas.
 */
export function lerImportacao(texto: string): ResultadoImportacao {
  const linhasBrutas = texto.replace(/\r/g, "").split("\n").filter(l => l.trim());
  const res: ResultadoImportacao = { linhas: [], reconhecidas: [], ignoradas: [], erros: [] };
  if (!linhasBrutas.length) { res.erros.push("Nada para importar."); return res; }
  // Colado do Excel vem com tabulação; CSV, com ; (pt-BR) ou ,. Olha o texto
  // todo — a 1ª linha costuma ser um título sem separador nenhum.
  const conta = (c: string) => linhasBrutas.reduce((s, l) => s + l.split(c).length - 1, 0);
  const sep = conta("\t") > 0 ? "\t" : conta(";") >= conta(",") ? ";" : ",";
  let iCab = -1; let mapa: (CampoImportacao | null)[] = [];
  for (let i = 0; i < Math.min(15, linhasBrutas.length); i++) {
    const cols = partir(linhasBrutas[i], sep);
    const m = cols.map(campoDoCabecalho);
    if (m.filter(Boolean).length >= 2) { iCab = i; mapa = m; break; }
  }
  if (iCab < 0) { res.erros.push("Não achei a linha de cabeçalho (ex.: Parcela; Vencimento; Valor devido; Amortização; Juros…)."); return res; }
  const cab = partir(linhasBrutas[iCab], sep);
  // Coluna repetida: vale a primeira.
  const usados = new Set<CampoImportacao>();
  mapa = mapa.map(c => { if (!c || usados.has(c)) return null; usados.add(c); return c; });
  cab.forEach((c, i) => { if (!c) return; (mapa[i] ? res.reconhecidas : res.ignoradas).push(c); });

  for (let i = iCab + 1; i < linhasBrutas.length; i++) {
    const cols = partir(linhasBrutas[i], sep);
    const l: Partial<Record<CampoImportacao, string | number | null>> = {};
    let algum = false;
    mapa.forEach((campo, j) => {
      if (!campo) return;
      const bruto = cols[j] ?? "";
      if (bruto === "") return;
      if (campo === "vencimento" || campo === "data_pagamento") {
        const d = dataOuNulo(bruto);
        if (d) { l[campo] = d; algum = true; } else res.erros.push(`Linha ${i + 1}: data inválida "${bruto}" em ${cab[j]}.`);
      } else if (campo === "numero") {
        const n = numeroOuNulo(bruto);
        if (n != null && Number.isInteger(n)) l.numero = n; else l.rotulo = bruto;
        algum = true;
      } else if (campo === "rotulo") { l.rotulo = bruto; algum = true; }
      else {
        const n = numeroOuNulo(bruto);
        if (n != null) { l[campo] = n; algum = true; } else res.erros.push(`Linha ${i + 1}: número inválido "${bruto}" em ${cab[j]}.`);
      }
    });
    if (algum && (l.numero != null || l.vencimento || l.rotulo)) res.linhas.push(l);
  }
  if (!res.linhas.length) res.erros.push("Nenhuma linha de parcela reconhecida abaixo do cabeçalho.");
  return res;
}

export interface PlanoImportacao {
  atualizar: Array<{ id: number | string; dados: Record<string, string | number | null> }>;
  inserir: Array<Record<string, string | number | null>>;
}

/**
 * Casa as linhas importadas com as parcelas que já existem: pelo NÚMERO da
 * parcela; sem número, pelo mês do vencimento (só se houver uma única naquele
 * mês). O que não casa vira parcela nova. Só os campos que vieram são
 * gravados — coluna ausente não apaga nada.
 */
export function planejarImportacao(
  linhas: ResultadoImportacao["linhas"], existentes: ParcelaFinanciamento[],
): PlanoImportacao {
  const plano: PlanoImportacao = { atualizar: [], inserir: [] };
  const usados = new Set<string>();
  const porNumero = new Map<number, ParcelaFinanciamento>();
  for (const p of existentes) if (p.numero != null && !porNumero.has(Number(p.numero))) porNumero.set(Number(p.numero), p);
  for (const l of linhas) {
    let alvo: ParcelaFinanciamento | undefined;
    if (l.numero != null) alvo = porNumero.get(Number(l.numero));
    else if (l.vencimento) {
      const mes = String(l.vencimento).slice(0, 7);
      const doMes = existentes.filter(p => String(p.vencimento ?? "").slice(0, 7) === mes && !usados.has(String(p.id)));
      if (doMes.length === 1) alvo = doMes[0];
    }
    const dados = { ...l } as Record<string, string | number | null>;
    if (alvo && !usados.has(String(alvo.id))) {
      usados.add(String(alvo.id));
      plano.atualizar.push({ id: alvo.id, dados });
    } else plano.inserir.push(dados);
  }
  return plano;
}

// ── Exportação (CSV da aba, com o detalhamento) ──────────────────────────

const COLS_EXPORT: Array<[string, (l: LinhaResolvida) => string | number | null]> = [
  ["Parcela", l => rotuloParcela(l.p)],
  ["Vencimento", l => l.p.vencimento ?? null],
  ["Valor devido", l => numeroOuNulo(l.p.valor)],
  ["Amortização", l => l.comp.amortizacao],
  ["Juros", l => l.comp.juros],
  ["MIP", l => l.comp.seguro_mip],
  ["DFI", l => l.comp.seguro_dfi],
  ["Seguros / FGHAB", l => l.comp.seguros_fghab],
  ["Seguros (total)", l => l.comp.seguros],
  ["Taxas", l => l.comp.taxas],
  ["Valor FCVS", l => l.comp.valor_fcvs],
  ["FGTS utilizado", l => l.comp.fgts_utilizado],
  ["Encargo líquido", l => l.comp.encargo_liquido],
  ["Impontualidade", l => l.comp.valor_impontualidade],
  ["Valor pago", l => l.pago],
  ["Data do pagamento", l => l.dataPagamento],
  ["Diferença de valor", l => l.comp.diferenca_valor],
  ["Atualização monetária", l => l.comp.atualizacao_monetaria],
  ["Saldo anterior", l => l.comp.saldo_anterior],
  ["Saldo devedor", l => l.comp.saldo_devedor],
  ["Índice de correção", l => rotuloIndice(l.comp.indice_correcao, l.comp.indice_tipo)],
  ["Situação", l => l.situacao],
  ["Valores", l => (l.p.projetado ? "Projetado" : "Confirmado")],
];

/** CSV com ; e vírgula decimal — abre direto no Excel em pt-BR. */
export function csvDasParcelas(linhas: LinhaResolvida[]): string {
  const cel = (v: string | number | null) => {
    if (v == null) return "";
    if (typeof v === "number") return String(v).replace(".", ",");
    return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [COLS_EXPORT.map(c => c[0]).join(";"), ...linhas.map(l => COLS_EXPORT.map(c => cel(c[1](l))).join(";"))].join("\n");
}
