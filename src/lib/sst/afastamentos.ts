// =====================================================================
// SST › AFASTAMENTOS E TELEMEDICINA (mig 20261029001750, 28/10/2026)
//
// Chamado: automatizar a análise dos afastamentos por atestado e medir o
// impacto operacional e financeiro — hoje uma planilha manual (PLANILHA
// TELEMEDICINA.xlsx + RELATÓRIO MENSAL ATESTADOS.xlsx) com a lotação de
// cada colaborador pesquisada à mão.
//
// O banco grava o afastamento, resolve a lotação na data (contrato, posto,
// escala, valor do posto) e junta as coberturas (Efetividade, diárias e as
// registradas no afastamento). Aqui ficam as CONTAS — testadas em
// src/test/sst-afastamentos.test.ts:
//   · dias do afastamento e divisão por competência (mês);
//   · impacto financeiro (perda de receita, custo de cobertura, margem);
//   · economia da telemedicina (dias evitados);
//   · consolidação por colaborador / posto / contrato / competência;
//   · o relatório mensal por contrato no formato da planilha de hoje;
//   · a leitura da planilha de telemedicina para a importação.
// =====================================================================

export type TipoAfastamento = "atestado" | "atestado_acompanhante" | "acidente_trabalho" | "auxilio_doenca" | "outros";
export type TeleStatus = "nao_avaliado" | "agendada" | "realizada" | "nao_compareceu" | "nao_avaliado_prazo" | "nao_se_aplica";
export type TeleResultado = "mantido" | "reduzido" | "zerado" | "ampliado";
export type Assinatura = "encaminhado" | "assinado" | "sem_assinatura";
export type RetornoStatus = "aguardando" | "retornou" | "nao_retornou" | "prorrogado" | "desligado";
export type TipoDespesa = "hora_extra" | "substituicao" | "remanejamento" | "rt" | "diaria" | "transporte" | "beneficio" | "outros";

export const TIPOS: { v: TipoAfastamento; r: string }[] = [
  { v: "atestado", r: "Atestado médico" },
  { v: "atestado_acompanhante", r: "Atestado de acompanhante (filho/familiar)" },
  { v: "acidente_trabalho", r: "Acidente de trabalho" },
  { v: "auxilio_doenca", r: "Auxílio-doença (INSS)" },
  { v: "outros", r: "Outros" },
];

export const TELE_STATUS: Record<TeleStatus, { r: string; cor: string }> = {
  nao_avaliado: { r: "Não avaliado", cor: "bg-slate-100 text-slate-700 border-slate-200" },
  agendada: { r: "Telemedicina agendada", cor: "bg-sky-100 text-sky-800 border-sky-200" },
  realizada: { r: "Avaliado na telemedicina", cor: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  nao_compareceu: { r: "Não compareceu", cor: "bg-red-100 text-red-800 border-red-200" },
  nao_avaliado_prazo: { r: "Não avaliado (prazo)", cor: "bg-amber-100 text-amber-800 border-amber-200" },
  nao_se_aplica: { r: "Não se aplica", cor: "bg-slate-100 text-slate-500 border-slate-200" },
};

export const RESULTADOS: { v: TeleResultado; r: string }[] = [
  { v: "mantido", r: "Atestado mantido" },
  { v: "reduzido", r: "Dias reduzidos" },
  { v: "zerado", r: "Reduzido a zero (só comparecimento)" },
  { v: "ampliado", r: "Dias ampliados" },
];

export const ASSINATURAS: { v: Assinatura; r: string }[] = [
  { v: "encaminhado", r: "Encaminhado para assinatura" },
  { v: "assinado", r: "Assinado" },
  { v: "sem_assinatura", r: "Sem assinatura" },
];

export const RETORNOS: Record<RetornoStatus, { r: string; cor: string }> = {
  aguardando: { r: "Aguardando retorno", cor: "bg-amber-100 text-amber-800 border-amber-200" },
  retornou: { r: "Retornou", cor: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  nao_retornou: { r: "Não retornou", cor: "bg-red-100 text-red-800 border-red-200" },
  prorrogado: { r: "Prorrogado", cor: "bg-violet-100 text-violet-800 border-violet-200" },
  desligado: { r: "Desligado", cor: "bg-slate-200 text-slate-700 border-slate-300" },
};

export const DESPESAS: { v: TipoDespesa; r: string }[] = [
  { v: "hora_extra", r: "Hora extra de cobertura" },
  { v: "substituicao", r: "Substituição (outro colaborador)" },
  { v: "remanejamento", r: "Remanejamento de posto" },
  { v: "rt", r: "Reserva Técnica (RT)" },
  { v: "diaria", r: "Diarista (fora do módulo de Diárias)" },
  { v: "transporte", r: "Transporte / deslocamento" },
  { v: "beneficio", r: "Benefício extra (VA/VT do substituto)" },
  { v: "outros", r: "Outra despesa" },
];

/** O que vem de sst_afa_lista (valores só para quem tem o financeiro). */
export interface AfastamentoItem {
  id: number;
  protocolo: string;
  empregado_id: number | null;
  nome: string;
  cpf: string | null;
  tipo: TipoAfastamento;
  data_inicio: string;
  dias_atestado: number | null;
  dias_apos_tele: number | null;
  dias_considerados: number | null;
  origem: "manual" | "senior" | "planilha";
  tele_status: TeleStatus;
  tele_data: string | null;
  tele_resultado: TeleResultado | null;
  assinatura: Assinatura | null;
  ponto: "cumpriu" | "nao_cumpriu" | null;
  retorno_status: RetornoStatus;
  retornou_em: string | null;
  encarregado_nome: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  contrato_planilha: string | null;
  posto_senior: string | null;
  posto_planilha: string | null;
  cargo: string | null;
  escala: string | null;
  rt_no_contrato: number | null;
  cancelado: boolean;
  dias_cobertos: number;
  dias_rt: number;
  custo_cobertura: number;
  valor_mensal_posto?: number | null;
  salario?: number | null;
  custo_mensal_posto?: number | null;
  lucro_mensal?: number | null;
  glosa_valor?: number | null;
}

// ── Datas ────────────────────────────────────────────────────────────
const p2 = (n: number) => String(n).padStart(2, "0");
const paraData = (iso: string): Date => {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
};
const isoDe = (d: Date) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
export const hojeIso = (h: Date = new Date()) => `${h.getFullYear()}-${p2(h.getMonth() + 1)}-${p2(h.getDate())}`;
export const fmtData = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
export const competenciaDe = (iso: string) => iso.slice(0, 7);
export const rotuloCompetencia = (c: string) => {
  const [a, m] = c.split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m) - 1]}/${a}`;
};

/**
 * Dias do afastamento: os da telemedicina, senão os do atestado. Em aberto
 * (sem dias) conta até hoje. Reduzido a zero = 0 dia de ausência.
 */
export function diasDoAfastamento(a: Pick<AfastamentoItem, "data_inicio" | "dias_considerados">, hoje: string = hojeIso()): number {
  if (a.dias_considerados != null) return Math.max(0, a.dias_considerados);
  const diff = Math.round((paraData(hoje).getTime() - paraData(a.data_inicio).getTime()) / 86_400_000) + 1;
  return Math.max(1, diff);
}

/** Último dia do afastamento (inclusive). */
export function fimDoAfastamento(a: Pick<AfastamentoItem, "data_inicio" | "dias_considerados">, hoje: string = hojeIso()): string {
  const dias = diasDoAfastamento(a, hoje);
  const d = paraData(a.data_inicio);
  d.setUTCDate(d.getUTCDate() + Math.max(dias, 1) - 1);
  return isoDe(d);
}

/** Dias por competência: um atestado de 28/06 a 03/07 é 3 em junho e 3 em julho. */
export function diasPorCompetencia(a: Pick<AfastamentoItem, "data_inicio" | "dias_considerados">, hoje: string = hojeIso()): Record<string, number> {
  const dias = diasDoAfastamento(a, hoje);
  const out: Record<string, number> = {};
  if (dias === 0) { out[competenciaDe(a.data_inicio)] = 0; return out; }
  const d = paraData(a.data_inicio);
  for (let i = 0; i < dias; i++) {
    const c = competenciaDe(isoDe(d));
    out[c] = (out[c] ?? 0) + 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ── Impacto financeiro ───────────────────────────────────────────────
export interface Impacto {
  dias: number;
  diasCobertos: number;
  diasDescobertos: number;
  diasEvitados: number;
  valorDiaPosto: number | null;
  receitaPrevista: number | null;
  perdaReceita: number | null;
  perdaEstimada: boolean;
  custoCobertura: number;
  custoTitularEmpresa: number | null;
  impactoTotal: number | null;
  margemPrevista: number | null;
  margemApurada: number | null;
  economiaTelemedicina: number | null;
}

/**
 * Regras (todas por posto, mês comercial de 30 dias, como na Planilha de Custo):
 *  · valor/dia do posto = valor mensal do posto (total por empregado) ÷ 30;
 *  · receita prevista do período = valor/dia × dias do afastamento;
 *  · perda de receita = a glosa INFORMADA; sem ela, a ESTIMADA: dias sem
 *    cobertura × valor/dia (posto vago é o que o contratante desconta);
 *  · custo de cobertura = diárias + horas extras + substituições + demais
 *    despesas registradas;
 *  · custo do titular para a empresa = salário ÷ 30 × até 15 dias (a partir
 *    do 16º dia quem paga é o INSS) — informativo, já previsto na planilha
 *    na reposição de profissional ausente; não entra no impacto;
 *  · impacto = perda de receita + custo de cobertura;
 *  · margem prevista = (valor mensal − custo mensal) ÷ 30 × dias; margem
 *    apurada = prevista − impacto;
 *  · economia da telemedicina = dias evitados (atestado − dias após a
 *    avaliação) × valor/dia do posto (o que deixaria de ser coberto ou
 *    glosado).
 */
export function calcularImpacto(a: AfastamentoItem, hoje: string = hojeIso()): Impacto {
  const dias = diasDoAfastamento(a, hoje);
  const diasCobertos = Math.min(dias, Math.max(0, a.dias_cobertos ?? 0));
  const diasDescobertos = Math.max(0, dias - diasCobertos);
  const diasEvitados = a.dias_atestado != null && a.dias_apos_tele != null ? Math.max(0, a.dias_atestado - a.dias_apos_tele) : 0;
  const custoCobertura = Number(a.custo_cobertura ?? 0);
  const vm = a.valor_mensal_posto != null ? Number(a.valor_mensal_posto) : null;
  const valorDiaPosto = vm != null && vm > 0 ? vm / 30 : null;
  const glosa = a.glosa_valor != null ? Number(a.glosa_valor) : null;
  const perdaReceita = glosa != null ? glosa : valorDiaPosto != null ? valorDiaPosto * diasDescobertos : null;
  const sal = a.salario != null ? Number(a.salario) : null;
  const cm = a.custo_mensal_posto != null ? Number(a.custo_mensal_posto) : null;
  const margemPrevista = vm != null && cm != null ? ((vm - cm) / 30) * dias : null;
  const impactoTotal = perdaReceita != null ? perdaReceita + custoCobertura : null;
  return {
    dias, diasCobertos, diasDescobertos, diasEvitados,
    valorDiaPosto,
    receitaPrevista: valorDiaPosto != null ? valorDiaPosto * dias : null,
    perdaReceita, perdaEstimada: glosa == null && perdaReceita != null,
    custoCobertura,
    custoTitularEmpresa: sal != null && sal > 0 ? (sal / 30) * Math.min(dias, 15) : null,
    impactoTotal,
    margemPrevista,
    margemApurada: margemPrevista != null && impactoTotal != null ? margemPrevista - impactoTotal : null,
    economiaTelemedicina: valorDiaPosto != null ? valorDiaPosto * diasEvitados : null,
  };
}

// ── Consolidação ─────────────────────────────────────────────────────
export type Agrupamento = "contrato" | "posto" | "colaborador" | "competencia";

export interface LinhaConsolidada {
  chave: string;
  rotulo: string;
  sub?: string;
  afastamentos: number;
  dias: number;
  diasCobertos: number;
  diasRt: number;
  diasEvitados: number;
  avaliadosTele: number;
  custoCobertura: number;
  perdaReceita: number;
  impacto: number;
  margemPrevista: number;
  margemApurada: number;
  economiaTele: number;
  /** Quantos afastamentos não têm valor do posto (impacto subestimado). */
  semValor: number;
}

const SEM_CONTRATO = "(sem contrato identificado)";
const contratoDe = (a: AfastamentoItem) => a.contrato_nome || (a.contrato_planilha ? `${a.contrato_planilha} (planilha)` : SEM_CONTRATO);

/**
 * Agrupa os afastamentos. Por competência, um afastamento que atravessa o
 * mês entra nos dois meses, com os dias e os valores proporcionais.
 */
export function consolidar(itens: AfastamentoItem[], por: Agrupamento, hoje: string = hojeIso()): LinhaConsolidada[] {
  const mapa = new Map<string, LinhaConsolidada>();
  const linha = (chave: string, rotulo: string, sub?: string) => {
    let l = mapa.get(chave);
    if (!l) {
      l = { chave, rotulo, sub, afastamentos: 0, dias: 0, diasCobertos: 0, diasRt: 0, diasEvitados: 0, avaliadosTele: 0,
        custoCobertura: 0, perdaReceita: 0, impacto: 0, margemPrevista: 0, margemApurada: 0, economiaTele: 0, semValor: 0 };
      mapa.set(chave, l);
    }
    return l;
  };
  for (const a of itens) {
    if (a.cancelado) continue;
    const imp = calcularImpacto(a, hoje);
    const partes: { chave: string; rotulo: string; sub?: string; frac: number }[] = [];
    if (por === "competencia") {
      const pc = diasPorCompetencia(a, hoje);
      const tot = Object.values(pc).reduce((s, n) => s + n, 0);
      for (const [c, n] of Object.entries(pc)) partes.push({ chave: c, rotulo: rotuloCompetencia(c), frac: tot > 0 ? n / tot : 1 });
    } else if (por === "contrato") {
      partes.push({ chave: a.contrato_id ?? contratoDe(a), rotulo: contratoDe(a), frac: 1 });
    } else if (por === "posto") {
      const posto = a.posto_planilha || a.posto_senior || "(sem posto)";
      partes.push({ chave: `${a.contrato_id ?? contratoDe(a)}|${posto}`, rotulo: posto, sub: contratoDe(a), frac: 1 });
    } else {
      partes.push({ chave: a.empregado_id ? `e${a.empregado_id}` : `n${a.nome}`, rotulo: a.nome, sub: [a.cargo, contratoDe(a)].filter(Boolean).join(" · "), frac: 1 });
    }
    partes.forEach((p, i) => {
      const l = linha(p.chave, p.rotulo, p.sub);
      // O afastamento conta uma vez (no primeiro mês em que aparece).
      if (i === 0) { l.afastamentos += 1; if (a.tele_status === "realizada") l.avaliadosTele += 1; if (imp.valorDiaPosto == null) l.semValor += 1; }
      l.dias += imp.dias * p.frac;
      l.diasCobertos += imp.diasCobertos * p.frac;
      l.diasRt += Math.min(a.dias_rt ?? 0, imp.dias) * p.frac;
      l.diasEvitados += imp.diasEvitados * p.frac;
      l.custoCobertura += imp.custoCobertura * p.frac;
      l.perdaReceita += (imp.perdaReceita ?? 0) * p.frac;
      l.impacto += (imp.impactoTotal ?? imp.custoCobertura) * p.frac;
      l.margemPrevista += (imp.margemPrevista ?? 0) * p.frac;
      l.margemApurada += (imp.margemApurada ?? 0) * p.frac;
      l.economiaTele += (imp.economiaTelemedicina ?? 0) * p.frac;
    });
  }
  const linhas = [...mapa.values()];
  return por === "competencia"
    ? linhas.sort((x, y) => x.chave.localeCompare(y.chave))
    : linhas.sort((x, y) => y.impacto - x.impacto || y.dias - x.dias || x.rotulo.localeCompare(y.rotulo, "pt-BR"));
}

/**
 * O RELATÓRIO MENSAL ATESTADOS de hoje, gerado: por mês do atestado e
 * contrato — quantidade, soma de dias, avaliados por telemedicina, não
 * avaliados por conta do prazo e os dias desses.
 */
export interface LinhaMensal {
  competencia: string;
  contrato: string;
  quantidade: number;
  somaDias: number;
  avaliadosTele: number;
  naoAvaliadosPrazo: number;
  diasNaoAvaliados: number;
  diasEvitados: number;
}
export function relatorioMensal(itens: AfastamentoItem[], hoje: string = hojeIso()): LinhaMensal[] {
  const m = new Map<string, LinhaMensal>();
  for (const a of itens) {
    if (a.cancelado) continue;
    const comp = competenciaDe(a.data_inicio);
    const ct = contratoDe(a);
    const k = `${comp}|${ct}`;
    const l = m.get(k) ?? { competencia: comp, contrato: ct, quantidade: 0, somaDias: 0, avaliadosTele: 0, naoAvaliadosPrazo: 0, diasNaoAvaliados: 0, diasEvitados: 0 };
    const dias = a.dias_atestado ?? diasDoAfastamento(a, hoje);
    l.quantidade += 1;
    l.somaDias += dias;
    if (a.tele_status === "realizada") l.avaliadosTele += 1;
    if (a.tele_status === "nao_avaliado_prazo") { l.naoAvaliadosPrazo += 1; l.diasNaoAvaliados += dias; }
    l.diasEvitados += calcularImpacto(a, hoje).diasEvitados;
    m.set(k, l);
  }
  return [...m.values()].sort((x, y) => x.competencia.localeCompare(y.competencia) || x.contrato.localeCompare(y.contrato, "pt-BR"));
}

// ── Importação da PLANILHA TELEMEDICINA ──────────────────────────────
export interface LinhaImportacao {
  aba: string;
  nome: string;
  data_inicio: string;
  dias_atestado: number | null;
  tele_data: string | null;
  tele_horario: string | null;
  encarregado: string | null;
  contrato: string | null;
  situacao: string | null;
  observacao: string | null;
  tele_status: TeleStatus;
  tele_resultado: TeleResultado | null;
  dias_apos_tele: number | null;
  assinatura: Assinatura | null;
  ponto: "cumpriu" | "nao_cumpriu" | null;
  retorno_status: RetornoStatus;
}

/** Data do Excel (número de série, Date ou "3/9/26" m/d/aa) → yyyy-mm-dd. */
export function dataPlanilha(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return isoDe(d);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // A planilha usa m/d/aa (exportação americana): 3/9/26 = 09/03/2026.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${ano}-${p2(Number(m[1]))}-${p2(Number(m[2]))}`;
  }
  return null;
}

/** Horário do Excel (fração do dia ou "10:00") → "10:00". */
export function horaPlanilha(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v >= 0 && v < 1) {
    const min = Math.round(v * 1440);
    return `${p2(Math.floor(min / 60))}:${p2(min % 60)}`;
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  return m ? `${p2(Number(m[1]))}:${m[2]}` : null;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/**
 * A observação livre da planilha virou campos: "REDUZIU PARA 4 DIAS",
 * "DIMINUI DE 5 PARA 3 DIAS", "REDUZIDO A ZERO", "NÃO COMPARECEU",
 * "ENCAMINHADO PARA ASSINATURA", "SEM ASSINATURA", "NÃO RETORNOU",
 * "DEMITIDO"/"RESCISÃO".
 */
export function interpretarObservacao(obs: string | null, diasAtestado: number | null, evitados: number | null) {
  const o = semAcento(obs ?? "");
  let tele_status: TeleStatus = "realizada";
  let tele_resultado: TeleResultado | null = null;
  let dias_apos_tele: number | null = null;
  if (/NAO COMPARECEU/.test(o)) tele_status = "nao_compareceu";
  if (/PRAZO/.test(o) && /NAO AVALIAD/.test(o)) tele_status = "nao_avaliado_prazo";
  // "DE 5 PARA 3" diz o original e o final — vale mais que a coluna (a
  // BIANCA tinha 3 na coluna e "diminui de 5 para 3").
  let original = diasAtestado;
  const dePara = /\bDE\s+(\d+)(?:\s*DIAS?)?\s+PARA\s+(\d+)/.exec(o);
  const para = /(?:REDUZ\w*|DIMINU\w*)(?:\s+\w+){0,3}?\s+PARA\s+(\d+)/.exec(o);
  if (/A ZERO|PARA ZERO|PARA 0\b|APENAS COMPARECIMENTO/.test(o)) { tele_resultado = "zerado"; dias_apos_tele = 0; }
  else if (dePara) { original = Number(dePara[1]); dias_apos_tele = Number(dePara[2]); tele_resultado = "reduzido"; }
  else if (para) { dias_apos_tele = Number(para[1]); tele_resultado = "reduzido"; }
  // Não compareceu: a ausência aconteceu; os "evitados" dessas linhas são
  // dias não abonados, não dias de posto preservados.
  else if (tele_status !== "nao_compareceu" && evitados != null && evitados > 0 && diasAtestado != null) {
    dias_apos_tele = Math.max(0, diasAtestado - evitados); tele_resultado = "reduzido";
  }
  else if (tele_status === "realizada") tele_resultado = "mantido";
  if (tele_resultado === "reduzido" && dias_apos_tele === 0) tele_resultado = "zerado";
  if (tele_resultado === "reduzido" && original != null && dias_apos_tele != null && dias_apos_tele > original) tele_resultado = "ampliado";
  const assinatura: Assinatura | null = /SEM ASSINATURA|FALTA ASSINATURA|NAO ASSIN/.test(o) ? "sem_assinatura"
    : /ENCAMINHAD[OA] PARA ASSINATURA/.test(o) ? "encaminhado" : /ASSINAD/.test(o) ? "assinado" : null;
  const retorno_status: RetornoStatus = /DEMITID|RESCISAO|DESLIGAD/.test(o) ? "desligado"
    : /NAO RETORNOU/.test(o) ? "nao_retornou" : "aguardando";
  return { tele_status, tele_resultado, dias_apos_tele, dias_atestado: original, assinatura, retorno_status };
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Lê as abas da planilha (linhas já em matriz, como o xlsx devolve com
 * header: 1 e raw: true). Agendamentos: A nome, B data atestado, C dias,
 * D data tele, F horário, G encarregado, H contrato, K situação, L dias
 * evitados, M observações. NÃO COMPARECIMENTO / REDUÇÃO: A nome, B data,
 * C ponto, D dias, E data tele, G horário, H encarregado, I contrato,
 * K situação, L observações. Linhas de título de mês ("JUNHO") e sem nome
 * ficam de fora; linhas da mesma pessoa e data se juntam (a aba mais
 * específica completa a de agendamentos).
 */
export function lerPlanilhaTelemedicina(abas: { nome: string; linhas: unknown[][] }[]): LinhaImportacao[] {
  const porChave = new Map<string, LinhaImportacao>();
  for (const aba of abas) {
    const n = semAcento(aba.nome);
    const agend = n.includes("AGENDAMENTO");
    const comPonto = n.includes("COMPARECIMENTO") || n.includes("REDUCAO");
    if (!agend && !comPonto) continue;
    for (const r of aba.linhas) {
      const nome = String(r[0] ?? "").trim().replace(/\s+/g, " ");
      if (!nome || /^NOME DO COLABORADOR/i.test(nome)) continue;
      const c = agend
        ? { data: r[1], dias: r[2], tele: r[3], hora: r[5], enc: r[6], ct: r[7], sit: r[10], evit: r[11], obs: r[12], ponto: null as unknown }
        : { data: r[1], dias: r[3], tele: r[4], hora: r[6], enc: r[7], ct: r[8], sit: r[10], evit: null as unknown, obs: r[11], ponto: r[2] };
      let tele = dataPlanilha(c.tele);
      const inicio = dataPlanilha(c.data) ?? tele;
      if (!inicio) continue;
      // Digitação com o ano errado (3/9/25 num atestado de 3/9/26).
      if (tele && tele < inicio && Number(inicio.slice(0, 4)) - Number(tele.slice(0, 4)) === 1) tele = `${inicio.slice(0, 4)}${tele.slice(4)}`;
      const dias = num(c.dias);
      const obs = String(c.obs ?? "").trim() || null;
      const interp = interpretarObservacao(obs, dias, num(c.evit));
      const pontoTxt = semAcento(String(c.ponto ?? ""));
      const linha: LinhaImportacao = {
        aba: aba.nome, nome: nome.toUpperCase(), data_inicio: inicio,
        dias_atestado: interp.dias_atestado != null ? Math.round(interp.dias_atestado) : null,
        tele_data: tele, tele_horario: horaPlanilha(c.hora),
        encarregado: String(c.enc ?? "").trim() || null, contrato: String(c.ct ?? "").trim() || null,
        situacao: String(c.sit ?? "").trim() || null, observacao: obs,
        tele_status: tele ? interp.tele_status : "nao_avaliado",
        tele_resultado: tele ? interp.tele_resultado : null, dias_apos_tele: interp.dias_apos_tele,
        assinatura: interp.assinatura,
        ponto: pontoTxt.includes("NAO CUMPRIU") ? "nao_cumpriu" : pontoTxt === "OK" ? "cumpriu" : null,
        retorno_status: interp.retorno_status,
      };
      const k = `${semAcento(linha.nome)}|${inicio}`;
      const ant = porChave.get(k);
      if (!ant) { porChave.set(k, linha); continue; }
      // Junta: o que a linha nova traz preenchido completa/substitui.
      porChave.set(k, {
        ...ant,
        dias_atestado: ant.dias_atestado ?? linha.dias_atestado,
        tele_data: linha.tele_data ?? ant.tele_data, tele_horario: linha.tele_horario ?? ant.tele_horario,
        encarregado: ant.encarregado ?? linha.encarregado, contrato: ant.contrato ?? linha.contrato,
        situacao: linha.situacao ?? ant.situacao,
        observacao: [ant.observacao, linha.observacao].filter((x, i, arr) => x && arr.indexOf(x) === i).join(" / ") || null,
        tele_status: linha.tele_status !== "realizada" && linha.tele_status !== "nao_avaliado" ? linha.tele_status : ant.tele_status,
        tele_resultado: linha.tele_resultado && linha.tele_resultado !== "mantido" ? linha.tele_resultado : ant.tele_resultado ?? linha.tele_resultado,
        dias_apos_tele: linha.dias_apos_tele ?? ant.dias_apos_tele,
        assinatura: linha.assinatura ?? ant.assinatura, ponto: linha.ponto ?? ant.ponto,
        retorno_status: linha.retorno_status !== "aguardando" ? linha.retorno_status : ant.retorno_status,
      });
    }
  }
  return [...porChave.values()];
}

export const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtNum = (v: number, casas = 0) => v.toLocaleString("pt-BR", { maximumFractionDigits: casas });
