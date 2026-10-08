import { minutosParaHora } from "@/lib/ponto";

// =====================================================================
// DIÁRIAS × RELÓGIO DE PONTO (mig 20261007000021, 07/10/2026)
//
// Pedido do Pablo: "como eu vou pagar uma diarista pra trabalhar no lugar do
// joãozinho se o joãozinho tem marcação de ponto hoje?". Cada linha da
// solicitação é conferida no espelho do relógio (espelho."BiMarcacoes"):
//
//   trabalhou        — o faltante bateu ponto no dia → a diária NÃO pode
//                      (o banco recusa a linha e a aprovação);
//   sem_marcacao     — o dia já está no espelho e não há batida → ok;
//   parcial          — é o último dia sincronizado: pode faltar batida da
//                      tarde/noite. Passa, mas a aprovação confere de novo;
//   nao_sincronizado — o espelho ainda não chegou nesse dia (hoje, futuro).
//                      Passa; a aprovação confere quando o ponto chegar;
//   sem_vinculo      — CPF sem cadastro/matrícula no relógio: não dá para
//                      afirmar nada (não bloqueia).
//
// `hora` no espelho é o MINUTO DO DIA (420 = 07:00; 1560 = 02:00 do dia
// seguinte, turno que virou a noite) — a conversão é a de src/lib/ponto.ts.
// =====================================================================

export interface VinculoPonto { id: number; nome: string | null; cadastro: string; empresa: string; situacao: string | null }
export interface PontoFaltante {
  disponivel: boolean;
  motivo?: string;
  sincronizado_ate?: string | null;
  vinculos?: VinculoPonto[];
  dias?: { data: string; minutos: number[] | null }[];
}
export interface ConflitosPonto {
  sincronizado_ate: string | null;
  conflitos: { solicitacao_id: string; data: string; minutos: number[] }[];
}

export type EstadoPonto = "trabalhou" | "sem_marcacao" | "parcial" | "nao_sincronizado" | "sem_vinculo" | "indisponivel";
export interface ResultadoPontoDia { data: string; estado: EstadoPonto; minutos: number[]; horarios: string[] }

/** Bloqueia a diária? Só quando há batida — nas demais o banco não tem como afirmar que trabalhou. */
export const bloqueia = (e: EstadoPonto) => e === "trabalhou";

/** 420 → "07:00"; 1560 → "02:00 (+1d)". */
export function horariosDoPonto(minutos: number[] | null | undefined): string[] {
  return [...(minutos ?? [])].sort((a, b) => a - b).map((m) => {
    const h = minutosParaHora(m);
    if (!h) return "—";
    return h.diasAdiante > 0 ? `${h.hora24} (+${h.diasAdiante}d)` : h.hora24;
  });
}

export function estadoDoDia(data: string, minutos: number[] | null | undefined, sincronizadoAte: string | null | undefined, temVinculo: boolean): EstadoPonto {
  if (minutos && minutos.length) return "trabalhou";
  if (!temVinculo) return "sem_vinculo";
  if (!sincronizadoAte || data > sincronizadoAte) return "nao_sincronizado";
  if (data === sincronizadoAte) return "parcial";
  return "sem_marcacao";
}

/** O resultado da RPC, na ordem das datas pedidas (datas vazias ficam de fora). */
export function avaliarPontoFaltante(p: PontoFaltante | null | undefined, datas: string[]): Map<string, ResultadoPontoDia> {
  const out = new Map<string, ResultadoPontoDia>();
  for (const data of datas) {
    if (!data || out.has(data)) continue;
    if (!p || !p.disponivel) { out.set(data, { data, estado: "indisponivel", minutos: [], horarios: [] }); continue; }
    const mins = p.dias?.find((d) => d.data === data)?.minutos ?? [];
    out.set(data, {
      data, minutos: mins, horarios: horariosDoPonto(mins),
      estado: estadoDoDia(data, mins, p.sincronizado_ate, (p.vinculos?.length ?? 0) > 0),
    });
  }
  return out;
}

export const ROTULO_ESTADO: Record<EstadoPonto, string> = {
  trabalhou: "Faltante bateu ponto",
  sem_marcacao: "Sem marcação no dia",
  parcial: "Sem marcação (dia ainda parcial)",
  nao_sincronizado: "Ponto ainda não sincronizado",
  sem_vinculo: "Faltante sem matrícula no relógio",
  indisponivel: "Relógio de ponto indisponível",
};

export function detalheEstado(r: ResultadoPontoDia, sincronizadoAte?: string | null): string {
  const ate = sincronizadoAte ? fmtDataCurta(sincronizadoAte) : null;
  switch (r.estado) {
    case "trabalhou": return `Batidas: ${r.horarios.join(", ")}. Ele(a) trabalhou nesse dia — não cabe diária.`;
    case "sem_marcacao": return "Confirmado no relógio: não trabalhou.";
    case "parcial": return `O relógio vai até ${ate}; batidas do fim do dia podem não ter chegado. A aprovação confere de novo.`;
    case "nao_sincronizado": return `O relógio vai até ${ate ?? "—"}. A aprovação confere quando o ponto do dia chegar.`;
    case "sem_vinculo": return "CPF sem cadastro com matrícula no relógio — não dá para conferir.";
    default: return "Não foi possível consultar o relógio agora.";
  }
}

export const fmtDataCurta = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

/** Para a lista: solicitações com alguma linha em que o faltante bateu ponto. */
export function conflitosPorSolicitacao(c: ConflitosPonto | null | undefined): Map<string, { data: string; horarios: string[] }[]> {
  const m = new Map<string, { data: string; horarios: string[] }[]>();
  for (const x of c?.conflitos ?? []) {
    const l = m.get(x.solicitacao_id) ?? [];
    l.push({ data: x.data, horarios: horariosDoPonto(x.minutos) });
    m.set(x.solicitacao_id, l.sort((a, b) => a.data.localeCompare(b.data)));
  }
  return m;
}

/** Datas da solicitação que o relógio ainda não cobre (aprovar agora seria às cegas para elas). */
export const datasSemPonto = (datas: string[], sincronizadoAte: string | null | undefined) =>
  [...new Set(datas.filter((d) => d && (!sincronizadoAte || d >= sincronizadoAte)))].sort();
