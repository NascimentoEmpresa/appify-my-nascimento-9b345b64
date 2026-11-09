import { minutosParaHora } from "@/lib/ponto";

// SIS-2026-0800: a presença no dia não prova sobreposição com a cobertura.
// As batidas são pareadas por matrícula/empresa e jornada, nunca entre vínculos.
// `hora` é minuto da jornada; 1560 significa 02:00 do dia seguinte.
export interface VinculoPonto { id: number; nome: string | null; cadastro: string; empresa: string; situacao: string | null }
export interface JornadaPonto { data: string; minutos: number[]; vinculo: string }
export interface EvidenciaPonto { disponivel: boolean; jornadas: JornadaPonto[] }
export interface CoberturaDiaria { data: string; inicioCobertura?: string | null; fimCobertura?: string | null }
export interface PontoFaltante {
  disponivel: boolean;
  motivo?: string;
  sincronizado_ate?: string | null;
  vinculos?: VinculoPonto[];
  dias?: { data: string; minutos: number[] | null; ponto?: EvidenciaPonto }[];
}
export interface LinhaPontoBanco {
  linha_id?: string;
  data: string;
  minutos: number[] | null;
  inicio_cobertura?: string | null;
  fim_cobertura?: string | null;
  ponto?: EvidenciaPonto;
}
export interface ConflitosPonto {
  sincronizado_ate: string | null;
  conflitos: (LinhaPontoBanco & { solicitacao_id: string; tem_vinculo?: boolean })[];
}
export type EstadoPonto = "conflito" | "sem_conflito" | "conferir" | "sem_marcacao" | "parcial" | "nao_sincronizado" | "sem_vinculo" | "indisponivel";
export interface IntervaloPonto { inicio: number; fim: number }
export interface ResultadoPontoDia {
  data: string;
  estado: EstadoPonto;
  minutos: number[];
  horarios: string[];
  cobertura?: IntervaloPonto;
  intervalos: IntervaloPonto[];
  sobreposicoes: IntervaloPonto[];
  pendencias: string[];
}

export const fmtDataCurta = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

export function horariosDoPonto(minutos: number[] | null | undefined): string[] {
  return [...(minutos ?? [])].sort((a, b) => a - b).map((m) => {
    // Intervalos da jornada anterior podem começar antes da data da diária.
    const dias = Math.floor(m / 1440);
    const h = minutosParaHora(((m % 1440) + 1440) % 1440);
    return `${h?.hora24 ?? "—"}${dias ? ` (${dias > 0 ? "+" : ""}${dias}d)` : ""}`;
  });
}
export const fmtIntervalo = (i: IntervaloPonto) => `${horariosDoPonto([i.inicio])[0]}–${horariosDoPonto([i.fim])[0]}`;
const minutoHora = (h: string | null | undefined): number | null => {
  if (!h || !/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(h)) return null;
  return Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
};
export function periodoCobertura(c: CoberturaDiaria): IntervaloPonto | null {
  const inicio = minutoHora(c.inicioCobertura), fim = minutoHora(c.fimCobertura);
  if (inicio === null || fim === null || inicio === fim) return null;
  return { inicio, fim: fim < inicio ? fim + 1440 : fim };
}
export const coberturaValida = (c: CoberturaDiaria) => !!periodoCobertura(c);

/** Todos os consumidores (cadastro, lista e Malote) usam a mesma comparação.
 * Intervalos são semiabertos: saída às 13h e cobertura a partir das 13h não
 * se sobrepõem. Uma cobertura contida entre entrada e saída também conflita.
 */
export function avaliarCobertura(c: CoberturaDiaria, ponto: EvidenciaPonto | undefined, sincronizadoAte: string | null | undefined, temVinculo: boolean): ResultadoPontoDia {
  const cobertura = periodoCobertura(c) ?? undefined;
  const r: ResultadoPontoDia = { data: c.data, estado: "conferir", minutos: [], horarios: [], cobertura, intervalos: [], sobreposicoes: [], pendencias: [] };
  if (!cobertura) r.pendencias.push("Informe início e fim da cobertura; não é possível comparar apenas pelo turno.");
  if (!ponto?.disponivel || !Array.isArray(ponto.jornadas)) {
    r.estado = "indisponivel";
    r.pendencias.push("Não foi possível consultar os intervalos do relógio de ponto.");
    return r;
  }
  if (!temVinculo) {
    r.estado = "sem_vinculo";
    r.pendencias.push("Colaborador sem matrícula no relógio — confira manualmente.");
    return r;
  }
  for (const jornada of ponto.jornadas) {
    const deslocamento = (Date.parse(`${jornada.data}T00:00:00Z`) - Date.parse(`${c.data}T00:00:00Z`)) / 60_000;
    // Só a jornada seguinte pode alcançar uma cobertura noturna. A anterior
    // também importa, pois o relógio guarda sua saída como minuto > 1440.
    if (deslocamento > 0 && (!cobertura || cobertura.fim <= deslocamento)) continue;
    const minutos = [...jornada.minutos].sort((a, b) => a - b);
    if (!Number.isFinite(deslocamento) || minutos.some((m) => !Number.isInteger(m) || m < 0 || m >= 2880)) {
      r.pendencias.push("Marcações inválidas: confira as entradas e saídas.");
      continue;
    }
    r.minutos.push(...minutos.map((m) => m + deslocamento));
    if (minutos.length % 2 || minutos.some((m, i) => i > 0 && m === minutos[i - 1])) {
      // Sem saber qual entrada/saída falta, até os pares anteriores podem
      // estar deslocados. Não inventar intervalo confirmado nesta jornada.
      r.pendencias.push(`Marcações incompletas ou ambíguas em ${fmtDataCurta(jornada.data)} (${jornada.vinculo}): ${horariosDoPonto(minutos).join(", ")}.`);
      continue;
    }
    for (let i = 0; i + 1 < minutos.length; i += 2) {
      if (minutos[i] === minutos[i + 1]) continue;
      const intervalo = { inicio: minutos[i] + deslocamento, fim: minutos[i + 1] + deslocamento };
      r.intervalos.push(intervalo);
      if (cobertura && intervalo.inicio < cobertura.fim && cobertura.inicio < intervalo.fim) r.sobreposicoes.push(intervalo);
    }
  }
  r.horarios = horariosDoPonto(r.minutos);
  const dataFim = cobertura && cobertura.fim > 1440
    ? new Date(Date.parse(`${c.data}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : c.data;
  const parcial = !!sincronizadoAte && dataFim === sincronizadoAte;
  const naoSincronizado = !sincronizadoAte || dataFim > sincronizadoAte;
  if (parcial || naoSincronizado) r.pendencias.push("O relógio ainda não cobre todo o período; podem faltar marcações.");
  if (r.sobreposicoes.length) r.estado = "conflito";
  else if (parcial) r.estado = "parcial";
  else if (naoSincronizado) r.estado = "nao_sincronizado";
  else if (r.pendencias.length) r.estado = "conferir";
  else r.estado = r.intervalos.length ? "sem_conflito" : "sem_marcacao";
  return r;
}

export function avaliarPontoFaltante(p: PontoFaltante | null | undefined, linhas: (CoberturaDiaria & { id: string })[]): Map<string, ResultadoPontoDia> {
  return new Map(linhas.filter((l) => l.data).map((l) => [l.id, avaliarCobertura(l,
    p?.disponivel ? p.dias?.find((d) => d.data === l.data)?.ponto : undefined,
    p?.sincronizado_ate, !!p?.vinculos?.length)]));
}
export const ROTULO_ESTADO: Record<EstadoPonto, string> = {
  conflito: "Conflito de horários",
  sem_conflito: "Sem sobreposição",
  conferir: "Ponto a conferir",
  sem_marcacao: "Sem marcação no período",
  parcial: "Ponto a conferir (dia parcial)",
  nao_sincronizado: "Ponto ainda não sincronizado",
  sem_vinculo: "Colaborador sem matrícula no relógio",
  indisponivel: "Relógio de ponto indisponível",
};
export const exigeConferencia = (r: ResultadoPontoDia) => !["sem_conflito", "sem_marcacao"].includes(r.estado);
export function detalheEstado(r: ResultadoPontoDia, _sincronizadoAte?: string | null): string {
  const periodo = r.cobertura ? `Diária: ${fmtIntervalo(r.cobertura)}.` : "Horário da diária não informado.";
  const detalhe = r.estado === "conflito"
    ? `Sobreposição com trabalho em ${r.sobreposicoes.map(fmtIntervalo).join(", ")}.`
    : r.estado === "sem_conflito" ? "Os intervalos trabalhados não coincidem com a cobertura."
    : r.estado === "sem_marcacao" ? "Sem marcações no período sincronizado." : "Necessária conferência.";
  return [periodo, detalhe, ...r.pendencias].join(" ");
}

export type AlertaPontoLinha = ResultadoPontoDia & { linhaId: string };
export function conflitosPorSolicitacao(c: ConflitosPonto | null | undefined): Map<string, AlertaPontoLinha[]> {
  const mapa = new Map<string, AlertaPontoLinha[]>();
  for (const l of c?.conflitos ?? []) {
    const r = avaliarCobertura({ data: l.data, inicioCobertura: l.inicio_cobertura, fimCobertura: l.fim_cobertura }, l.ponto, c?.sincronizado_ate, !!l.tem_vinculo);
    if (!exigeConferencia(r)) continue;
    mapa.set(l.solicitacao_id, [...(mapa.get(l.solicitacao_id) ?? []), { ...r, linhaId: l.linha_id ?? l.data }].sort((a, b) => a.data.localeCompare(b.data)));
  }
  return mapa;
}
export const datasSemPonto = (datas: string[], sincronizadoAte: string | null | undefined) =>
  [...new Set(datas.filter((d) => d && (!sincronizadoAte || d >= sincronizadoAte)))].sort();
export function horasTrabalhadas(minutos: number[] | null | undefined): { minutos: number; incompleto: boolean } {
  const m = [...(minutos ?? [])].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i + 1 < m.length; i += 2) total += m[i + 1] - m[i];
  return { minutos: total, incompleto: m.length % 2 === 1 };
}
export const fmtDuracao = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

export interface PontoDiariaMalote {
  despesa_id: string; solicitacao_id: string; numero: string | null;
  faltante_nome: string | null; contrato_nome: string | null; posto_nome: string | null;
  tem_vinculo: boolean;
  dias: (LinhaPontoBanco & { turno: string })[];
}
export interface RespostaPontoMalote { sincronizado_ate: string | null; itens: PontoDiariaMalote[] }
export function resumoPontoDiaria(item: PontoDiariaMalote, sincronizadoAte: string | null | undefined) {
  const dias = item.dias.map((d) => ({ ...avaliarCobertura({ data: d.data, inicioCobertura: d.inicio_cobertura, fimCobertura: d.fim_cobertura }, d.ponto, sincronizadoAte, item.tem_vinculo), turno: d.turno }));
  return {
    dias,
    conflitos: dias.filter((d) => d.estado === "conflito").length,
    aConferir: dias.filter((d) => exigeConferencia(d) && d.estado !== "conflito").length,
    semVinculo: !item.tem_vinculo,
  };
}
