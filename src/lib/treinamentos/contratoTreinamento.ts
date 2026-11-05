// =====================================================================
// Treinamentos por Contrato (mig 20261104006000, 04/11/2026).
//
// Regras puras da área de treinamentos presenciais por empresa/contrato:
// leitura das planilhas de provinha e de pesquisa de satisfação (hoje elas
// chegam do Google Forms / Excel), normalização de nota e CPF, e os
// indicadores dos relatórios. Fica fora da tela para ter teste
// (src/test/treinamentos-contrato.test.ts).
//
// Escala única: toda nota é guardada de 0 a 10. A provinha do Google Forms
// exporta "Pontuação" como "8 / 10" (vira 8,0); satisfação de 1 a 5 vira ×2.
// =====================================================================

export interface EmpresaTreinamento { codigo: number; sigla: string; nome: string }

/** As empresas do chamado, na ordem pedida. Códigos da Senior (colaboradoresUtils.EMPRESA_MAP). */
export const EMPRESAS_TREINAMENTO: EmpresaTreinamento[] = [
  { codigo: 1, sigla: "HAGG", nome: "HAGG" },
  { codigo: 5, sigla: "NH", nome: "NH" },
  { codigo: 2, sigla: "SN", nome: "SN" },
];
const OUTRAS_EMPRESAS: Record<number, string> = { 3: "CANAÃ" };

export function siglaEmpresa(codigo: number | null | undefined): string {
  if (codigo == null) return "—";
  return EMPRESAS_TREINAMENTO.find((e) => e.codigo === codigo)?.sigla ?? OUTRAS_EMPRESAS[codigo] ?? `Empresa ${codigo}`;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const normalizarTexto = (s: unknown) => semAcento(String(s ?? "")).toLowerCase().replace(/\s+/g, " ").trim();

/** Só os dígitos; 9–11 dígitos completa com zero à esquerda (Excel come o zero). Fora disso, null. */
export function normalizarCpf(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 9 || d.length > 11) return null;
  return d.padStart(11, "0");
}

export function formatarCpf(v: unknown): string {
  const d = normalizarCpf(v);
  return d ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(v ?? "");
}

const num = (s: string) => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const arred = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;

export interface NotaLida { nota: number | null; acertos: number | null; total: number | null }

/**
 * Nota de 0 a 10 a partir do que vier na célula:
 * "8 / 10" (Google Forms) → 8 (acertos 8, total 10); "15/20" → 7,5;
 * "80%" → 8; "8,5" → 8,5; 85 (número > 10, sem total) → 8,5 (tratado como %).
 */
export function lerNota(v: unknown): NotaLida {
  const vazio = { nota: null, acertos: null, total: null };
  if (v == null || v === "") return vazio;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return vazio;
    return { nota: arred(v <= 10 ? v : Math.min(v, 100) / 10), acertos: null, total: null };
  }
  const s = String(v).trim();
  const fracao = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:\/|de)\s*(\d+(?:[.,]\d+)?)$/i);
  if (fracao) {
    const a = num(fracao[1]); const t = num(fracao[2]);
    if (a == null || t == null || t <= 0 || a > t) return vazio;
    const inteiro = (x: number) => (Number.isInteger(x) ? x : null);
    return { nota: arred((a / t) * 10), acertos: inteiro(a), total: inteiro(t) };
  }
  const pct = s.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  if (pct) {
    const p = num(pct[1]);
    return p == null || p > 100 ? vazio : { nota: arred(p / 10), acertos: null, total: null };
  }
  const n = num(s);
  if (n == null || n < 0) return vazio;
  return lerNota(n);
}

/** Data de uma célula: Date, serial do Excel, "dd/mm/aaaa [hh:mm[:ss]]" ou ISO. Devolve ISO ou null. */
export function lerDataPlanilha(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Serial do Excel (dias desde 30/12/1899), lido como horário local.
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).toISOString();
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const ano = br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
    const d = new Date(ano, Number(br[2]) - 1, Number(br[1]), Number(br[4] ?? 12), Number(br[5] ?? 0), Number(br[6] ?? 0));
    return Number.isNaN(d.getTime()) || d.getDate() !== Number(br[1]) ? null : d.toISOString();
  }
  const iso = new Date(s);
  return /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(iso.getTime()) ? iso.toISOString() : null;
}

// ── Colunas da planilha ──────────────────────────────────────────────────
export interface ColunasPlanilha {
  nome: string | null;
  cpf: string | null;
  nota: string | null;
  data: string | null;
  comentario: string | null;
  /** As colunas que não são identificação (viram as respostas). */
  perguntas: string[];
}

const casa = (cab: string, padroes: RegExp[]) => padroes.some((p) => p.test(normalizarTexto(cab)));
const P_NOME = [/^nome\b/, /nome completo/, /^colaborador$/, /^participante$/, /^funcionario$/];
const P_CPF = [/\bcpf\b/, /^documento$/];
const P_NOTA = [/^pontuacao/, /^nota\b/, /^resultado$/, /^score$/, /^total de pontos/];
const P_DATA = [/carimbo de data/, /^data\b/, /^timestamp$/, /^data\/hora/];
const P_COMENT = [/coment/, /sugest/, /observa/, /critica/, /elogio/];
const P_IGNORAR = [/^e-?mail\b/, /endereco de e-?mail/];

export function detectarColunas(cabecalhos: string[]): ColunasPlanilha {
  const achar = (p: RegExp[]) => cabecalhos.find((c) => casa(c, p)) ?? null;
  const nome = achar(P_NOME);
  const cpf = achar(P_CPF);
  const nota = achar(P_NOTA);
  const data = achar(P_DATA);
  const comentario = cabecalhos.find((c) => c !== nome && casa(c, P_COMENT)) ?? null;
  const usadas = new Set([nome, cpf, nota, data, comentario].filter(Boolean) as string[]);
  const perguntas = cabecalhos.filter((c) => c && !usadas.has(c) && !casa(c, P_IGNORAR) && !/^__empty/i.test(c));
  return { nome, cpf, nota, data, comentario, perguntas };
}

const texto = (v: unknown) => (v == null ? "" : String(v).trim());

// ── Avaliações (provinhas) ───────────────────────────────────────────────
export const NOTA_MINIMA_PADRAO = 7;

export interface AvaliacaoLida {
  linha: number;
  nome: string;
  cpf: string | null;
  nota: number | null;
  acertos: number | null;
  total: number | null;
  aprovado: boolean | null;
  respondido_em: string | null;
  respostas: Record<string, string>;
}
export interface ResultadoLeitura<T> { itens: T[]; erros: string[]; colunas: ColunasPlanilha }

/** Linhas da planilha de provinha → avaliações. Linha sem nome é pulada com aviso. */
export function lerAvaliacoes(linhas: Record<string, unknown>[], notaMinima = NOTA_MINIMA_PADRAO): ResultadoLeitura<AvaliacaoLida> {
  const cab = Array.from(new Set(linhas.flatMap((l) => Object.keys(l))));
  const col = detectarColunas(cab);
  const erros: string[] = [];
  if (!col.nome) erros.push('Não achei a coluna do nome (ex.: "Nome", "Nome completo").');
  if (!col.nota) erros.push('Não achei a coluna da nota (ex.: "Pontuação", "Nota").');
  const itens: AvaliacaoLida[] = [];
  if (!col.nome) return { itens, erros, colunas: col };
  linhas.forEach((l, i) => {
    const nome = texto(l[col.nome!]);
    const n = i + 2; // linha 1 é o cabeçalho
    if (!nome) { if (Object.values(l).some((v) => texto(v))) erros.push(`Linha ${n}: sem nome, ignorada.`); return; }
    const lida = col.nota ? lerNota(l[col.nota]) : { nota: null, acertos: null, total: null };
    if (col.nota && texto(l[col.nota]) && lida.nota == null) erros.push(`Linha ${n} (${nome}): nota "${texto(l[col.nota])}" não reconhecida.`);
    const respostas: Record<string, string> = {};
    for (const p of col.perguntas) { const r = texto(l[p]); if (r) respostas[p] = r; }
    itens.push({
      linha: n, nome, cpf: col.cpf ? normalizarCpf(l[col.cpf]) : null,
      nota: lida.nota, acertos: lida.acertos, total: lida.total,
      aprovado: lida.nota == null ? null : lida.nota >= notaMinima,
      respondido_em: col.data ? lerDataPlanilha(l[col.data]) : null,
      respostas,
    });
  });
  return { itens, erros, colunas: col };
}

// ── Satisfação ───────────────────────────────────────────────────────────
/** Respostas em texto de escala, já na escala 1–5. */
const ESCALA_TEXTO: [RegExp, number][] = [
  [/^(otimo|excelente|muito satisfeito|concordo totalmente|sim, muito)$/, 5],
  [/^(muito bom|satisfeito|concordo)$/, 4],
  [/^bom$/, 4],
  [/^(regular|neutro|indiferente|razoavel|nem concordo nem discordo)$/, 3],
  [/^(ruim|insatisfeito|discordo)$/, 2],
  [/^(pessimo|muito ruim|muito insatisfeito|discordo totalmente)$/, 1],
];

/** Valor de uma resposta na escala 0–10, ou null se não for de escala. */
export function valorEscala(v: unknown, escalaMax: 5 | 10): number | null {
  const s = normalizarTexto(v);
  if (!s) return null;
  for (const [re, n] of ESCALA_TEXTO) if (re.test(s)) return n * 2;
  const n = num(s);
  if (n == null || n < 0 || n > escalaMax) return null;
  return arred(escalaMax === 5 ? n * 2 : n);
}

/** Escala de uma pergunta: 1–5 se nenhum número passa de 5; 0–10 se passa; null se a coluna não é numérica. */
export function escalaDaColuna(valores: unknown[]): 5 | 10 | null {
  const nums = valores.map((v) => (typeof v === "number" ? v : num(String(v ?? "").trim()))).filter((n): n is number => n != null);
  if (!nums.length) return null;
  return Math.max(...nums) > 5 ? 10 : 5;
}

export interface SatisfacaoLida {
  linha: number;
  nome: string | null;
  nota: number | null;
  comentario: string | null;
  respondido_em: string | null;
  respostas: Record<string, string>;
}

/** Linhas da pesquisa → respostas. A nota é a média (0–10) das perguntas de escala da linha. */
export function lerSatisfacao(linhas: Record<string, unknown>[]): ResultadoLeitura<SatisfacaoLida> {
  const cab = Array.from(new Set(linhas.flatMap((l) => Object.keys(l))));
  const col = detectarColunas(cab);
  // Na pesquisa, "nota" é só mais uma pergunta de escala.
  const perguntas = col.nota ? [col.nota, ...col.perguntas] : col.perguntas;
  const escalas = new Map<string, 5 | 10>();
  for (const p of perguntas) {
    const vals = linhas.map((l) => l[p]);
    const temTexto = vals.some((v) => ESCALA_TEXTO.some(([re]) => re.test(normalizarTexto(v))));
    const e = escalaDaColuna(vals) ?? (temTexto ? 5 : null);
    if (e) escalas.set(p, e);
  }
  const erros: string[] = [];
  if (!perguntas.length) erros.push("A planilha não tem colunas de pergunta.");
  const itens: SatisfacaoLida[] = [];
  linhas.forEach((l, i) => {
    if (!Object.values(l).some((v) => texto(v))) return;
    const respostas: Record<string, string> = {};
    const valores: number[] = [];
    for (const p of perguntas) {
      const r = texto(l[p]);
      if (!r) continue;
      respostas[p] = r;
      const e = escalas.get(p);
      const v = e ? valorEscala(l[p], e) : null;
      if (v != null) valores.push(v);
    }
    itens.push({
      linha: i + 2,
      nome: col.nome ? texto(l[col.nome]) || null : null,
      nota: valores.length ? arred(valores.reduce((a, b) => a + b, 0) / valores.length) : null,
      comentario: col.comentario ? texto(l[col.comentario]) || null : null,
      respondido_em: col.data ? lerDataPlanilha(l[col.data]) : null,
      respostas,
    });
  });
  return { itens, erros, colunas: { ...col, perguntas } };
}

// ── Participantes e indicadores ──────────────────────────────────────────
export interface ParticipanteBase { id?: number; nome: string; cpf: string | null; presente: boolean; empregado_id?: number | null }

/** Acha o participante da resposta: primeiro pelo CPF, depois pelo nome sem acento. */
export function casarParticipante<P extends ParticipanteBase>(resp: { nome: string | null; cpf: string | null }, participantes: P[]): P | null {
  const cpf = normalizarCpf(resp.cpf);
  if (cpf) {
    const p = participantes.find((x) => normalizarCpf(x.cpf) === cpf);
    if (p) return p;
  }
  const nome = normalizarTexto(resp.nome);
  if (!nome) return null;
  const mesmos = participantes.filter((x) => normalizarTexto(x.nome) === nome);
  return mesmos.length === 1 ? mesmos[0] : null;
}

/** Carga horária em horas a partir de "08:00" e "12:30" (4,5). Null se faltar ou não fizer sentido. */
export function horasEntre(inicio: string | null | undefined, fim: string | null | undefined): number | null {
  const m = (s: string | null | undefined) => {
    const r = String(s ?? "").match(/^(\d{1,2}):(\d{2})/);
    return r ? Number(r[1]) * 60 + Number(r[2]) : null;
  };
  const a = m(inicio); const b = m(fim);
  if (a == null || b == null || b <= a) return null;
  return arred((b - a) / 60);
}

export interface Indicadores {
  participantes: number;
  presentes: number;
  taxaPresenca: number | null;   // 0–100
  avaliacoes: number;
  notaMedia: number | null;      // 0–10
  aprovados: number;
  taxaAprovacao: number | null;  // 0–100, sobre quem tem nota
  respostasSatisfacao: number;
  satisfacaoMedia: number | null; // 0–10
}

const media = (xs: number[]) => (xs.length ? arred(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const pct = (a: number, b: number) => (b ? arred((a / b) * 100, 1) : null);

export function calcularIndicadores(d: {
  participantes: { presente: boolean }[];
  avaliacoes: { nota: number | null; aprovado: boolean | null }[];
  satisfacao: { nota: number | null }[];
}): Indicadores {
  const presentes = d.participantes.filter((p) => p.presente).length;
  const comNota = d.avaliacoes.filter((a) => a.nota != null);
  const aprovados = d.avaliacoes.filter((a) => a.aprovado === true).length;
  const comAprov = d.avaliacoes.filter((a) => a.aprovado != null).length;
  return {
    participantes: d.participantes.length,
    presentes,
    taxaPresenca: pct(presentes, d.participantes.length),
    avaliacoes: d.avaliacoes.length,
    notaMedia: media(comNota.map((a) => Number(a.nota))),
    aprovados,
    taxaAprovacao: pct(aprovados, comAprov),
    respostasSatisfacao: d.satisfacao.length,
    satisfacaoMedia: media(d.satisfacao.filter((s) => s.nota != null).map((s) => Number(s.nota))),
  };
}

/** Média por pergunta da pesquisa (só as de escala), para o relatório. */
export function mediasPorPergunta(respostas: Record<string, string>[]): { pergunta: string; media: number; n: number }[] {
  const perguntas = Array.from(new Set(respostas.flatMap((r) => Object.keys(r))));
  const out: { pergunta: string; media: number; n: number }[] = [];
  for (const p of perguntas) {
    const vals = respostas.map((r) => r[p]).filter((v) => v != null && v !== "");
    const e = escalaDaColuna(vals) ?? (vals.some((v) => ESCALA_TEXTO.some(([re]) => re.test(normalizarTexto(v)))) ? 5 : null);
    if (!e) continue;
    const ns = vals.map((v) => valorEscala(v, e)).filter((n): n is number => n != null);
    if (ns.length) out.push({ pergunta: p, media: media(ns)!, n: ns.length });
  }
  return out;
}

export const fmtNota = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
export const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
export const fmtDataBr = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");
export const fmtHora = (s: string | null | undefined) => (s ? s.slice(0, 5) : "");

/** Nome de arquivo seguro para o Storage (sem acento/espaço), preservando a extensão. */
export function nomeArquivoSeguro(nome: string): string {
  const base = semAcento(nome).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return base.slice(-80) || "arquivo";
}
