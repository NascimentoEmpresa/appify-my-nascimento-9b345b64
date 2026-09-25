// Recrutamento e Seleção › Acompanhar Colaboradores / Acompanhar Experiência
// (25/09/2026, mig 20260930000245) — as regras que as duas telas e o Excel
// compartilham.
//
// É o check-in da planilha CONTRATOS_VIGENTES.xlsx que o RH usava: um bloco
// por contrato e, por pessoa, os marcos de 7, 30, 60 e 90 dias da admissão,
// "permaneceu após a experiência?", data de saída, demitido/demissionário,
// motivo e observação. A base é a Senior (EMPREGADOS); a origem
// "recrutamento" é quem casou pelo CPF com um candidato que chegou à ADMISSÃO.

export const MARCOS = [7, 30, 60, 90] as const;
export type Marco = (typeof MARCOS)[number];
/** Experiência = até 90 dias da admissão. */
export const DIAS_EXPERIENCIA = 90;
/** Quantos dias antes do vencimento o marco passa a "vencer em breve". */
export const JANELA_AVISO = 3;

export type Resultado = "positivo" | "ressalvas" | "negativo" | "sem_contato";
export const RESULTADOS: { valor: Resultado; rotulo: string; curto: string; emoji: string; cls: string }[] = [
  { valor: "positivo",    rotulo: "Positivo — bem adaptado", curto: "Positivo",    emoji: "✓", cls: "bg-green-100 text-green-800 border-green-300" },
  { valor: "ressalvas",   rotulo: "Com ressalvas",           curto: "Ressalvas",   emoji: "!", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  { valor: "negativo",    rotulo: "Negativo",                curto: "Negativo",    emoji: "✗", cls: "bg-red-100 text-red-800 border-red-300" },
  { valor: "sem_contato", rotulo: "Sem contato",             curto: "Sem contato", emoji: "–", cls: "bg-slate-100 text-slate-700 border-slate-300" },
];
export const infoResultado = (r?: string | null) => RESULTADOS.find((x) => x.valor === r) ?? null;
/** Ressalva ou negativo precisam dizer o que foi visto (o banco repete). */
export const resultadoPedeObservacao = (r: Resultado) => r === "ressalvas" || r === "negativo";

export interface CheckAcomp {
  id: number; empregado_id: number; marco: Marco; resultado: Resultado;
  realizado_em: string; observacao: string | null; registrado_por: string | null; registrado_em: string;
}
export interface Acomp {
  empregado_id: number; permaneceu: "Sim" | "Não" | null; data_saida: string | null;
  tipo_saida: "Demitido" | "Demissionário" | null; motivo_saida: string | null;
  observacao: string | null; cidade: string | null; atualizado_por: string | null; atualizado_em: string | null;
}
export interface LinhaAcomp {
  empregado_id: number; nome: string; cpf: string; cargo: string; contrato: string; local: string | null;
  situacao: string; admissao: string; afastamento: string | null; causa: string | null; saiu: boolean;
  dias: number; origem: "recrutamento" | "senior"; candidato_id: number | null; vaga_id: number | null;
  vaga_status: string | null; cidade: string | null; acomp: Acomp | null; checks: CheckAcomp[];
}

// ── Datas (sem fuso: tudo é data de calendário) ─────────────────────────
const paraData = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(a, m - 1, d); };
const paraIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const hojeIso = () => paraIso(new Date());
export const somarDias = (iso: string, n: number) => { const d = paraData(iso); d.setDate(d.getDate() + n); return paraIso(d); };
export const diasEntre = (de: string, ate: string) => Math.round((paraData(ate).getTime() - paraData(de).getTime()) / 86_400_000);
export const fmtData = (iso?: string | null) => { if (!iso) return "—"; const [a, m, d] = iso.slice(0, 10).split("-"); return d && m && a ? `${d}/${m}/${a}` : "—"; };

// ── Estado de cada marco ────────────────────────────────────────────────
export type EstadoMarco =
  | { tipo: "feito"; check: CheckAcomp }
  | { tipo: "atrasado"; vence: string; dias: number }   // dias de atraso
  | { tipo: "hoje"; vence: string }
  | { tipo: "breve"; vence: string; dias: number }      // faltam N dias (≤ JANELA_AVISO)
  | { tipo: "futuro"; vence: string; dias: number }
  | { tipo: "nao_se_aplica"; vence: string };           // saiu antes do marco

export function estadoDoMarco(l: Pick<LinhaAcomp, "admissao" | "checks" | "saiu" | "afastamento" | "acomp">, marco: Marco, hoje = hojeIso()): EstadoMarco {
  const check = l.checks.find((c) => c.marco === marco);
  if (check) return { tipo: "feito", check };
  const vence = somarDias(l.admissao, marco);
  const saida = l.acomp?.data_saida ?? (l.saiu ? l.afastamento : null);
  if (saida && saida < vence) return { tipo: "nao_se_aplica", vence };
  const falta = diasEntre(hoje, vence);
  if (falta < 0) return { tipo: "atrasado", vence, dias: -falta };
  if (falta === 0) return { tipo: "hoje", vence };
  if (falta <= JANELA_AVISO) return { tipo: "breve", vence, dias: falta };
  return { tipo: "futuro", vence, dias: falta };
}

/** O próximo marco que pede ação (atrasado, hoje ou em breve), para ordenar a fila. */
export function proximaPendencia(l: LinhaAcomp, hoje = hojeIso()): { marco: Marco; estado: EstadoMarco } | null {
  for (const m of MARCOS) {
    const e = estadoDoMarco(l, m, hoje);
    if (e.tipo === "atrasado" || e.tipo === "hoje" || e.tipo === "breve") return { marco: m, estado: e };
  }
  return null;
}

// ── Permanência e saída ─────────────────────────────────────────────────
/**
 * "Permaneceu após a experiência?" — o que foi marcado; sem marcação, o que
 * a Senior diz: saiu (antes ou depois) = Não; passou dos 90 dias no
 * contrato = Sim; ainda na experiência = em aberto (null).
 */
export function permaneceuEfetivo(l: Pick<LinhaAcomp, "acomp" | "saiu" | "dias" | "afastamento" | "admissao">): { valor: "Sim" | "Não" | null; automatico: boolean } {
  if (l.acomp?.permaneceu) return { valor: l.acomp.permaneceu, automatico: false };
  if (l.saiu) {
    const diasAteSair = l.afastamento ? diasEntre(l.admissao, l.afastamento) : 0;
    return { valor: diasAteSair <= DIAS_EXPERIENCIA ? "Não" : "Sim", automatico: true };
  }
  if (l.dias > DIAS_EXPERIENCIA) return { valor: "Sim", automatico: true };
  return { valor: null, automatico: true };
}

/**
 * Demitido (a empresa encerrou) ou Demissionário (o colaborador pediu),
 * sugerido pela causa da Senior quando ninguém marcou.
 */
export function sugerirTipoSaida(causa?: string | null): "Demitido" | "Demissionário" | null {
  const c = String(causa ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!c) return null;
  if (/pedido|inic\.?\s*empregado|iniciativa do empregado|demission/.test(c)) return "Demissionário";
  if (/inic\.?\s*empresa|justa causa|termino|término|dispensa|demitid/.test(c)) return "Demitido";
  return null;
}

export const dataSaidaEfetiva = (l: Pick<LinhaAcomp, "acomp" | "saiu" | "afastamento">): string | null =>
  l.acomp?.data_saida ?? (l.saiu ? l.afastamento : null);

export const tipoSaidaEfetivo = (l: Pick<LinhaAcomp, "acomp" | "saiu" | "causa">): string | null =>
  l.acomp?.tipo_saida ?? (l.saiu ? sugerirTipoSaida(l.causa) : null);

// ── Resumo (cartões do topo) ────────────────────────────────────────────
export function resumoAcomp(linhas: LinhaAcomp[], hoje = hojeIso()) {
  let atrasados = 0, hojeN = 0, breve = 0, feitos = 0, negativos = 0;
  for (const l of linhas) {
    for (const m of MARCOS) {
      const e = estadoDoMarco(l, m, hoje);
      if (e.tipo === "atrasado") atrasados++;
      else if (e.tipo === "hoje") hojeN++;
      else if (e.tipo === "breve") breve++;
      else if (e.tipo === "feito") { feitos++; if (e.check.resultado === "negativo") negativos++; }
    }
  }
  const perm = linhas.map((l) => permaneceuEfetivo(l).valor);
  return {
    pessoas: linhas.length,
    doRecrutamento: linhas.filter((l) => l.origem === "recrutamento").length,
    atrasados, hoje: hojeN, breve, feitos, negativos,
    permaneceram: perm.filter((p) => p === "Sim").length,
    sairam: perm.filter((p) => p === "Não").length,
  };
}

/** Agrupa por contrato (a planilha tem um bloco por contrato), em ordem alfabética. */
export function agruparPorContrato<T extends { contrato: string }>(linhas: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const l of linhas) { const k = l.contrato || "—"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(l); }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
}
