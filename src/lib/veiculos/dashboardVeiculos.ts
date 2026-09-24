// =====================================================================
// Dashboard de Agendamento de Veículos — os cálculos (24/09/2026)
//
// Pedido do Pablo: uma aba "Dashboard" ao lado do Calendário Geral com
// todas as informações de todos os agendamentos, gráficos, e um botão de
// exportar relatório. Aqui só a conta — sem React, sem banco — para a tela
// e o relatório exportado usarem a MESMA regra (e o teste travar a regra).
//
// SITUAÇÃO: o banco guarda status confirmado/cancelado/concluido; quem já
// passou da data de fim continua "confirmado". Para o painel, o que importa
// é onde a viagem está no tempo:
//   cancelado                   → Cancelado
//   começa depois de hoje       → Agendado
//   terminou antes de hoje      → Realizado
//   o resto (hoje dentro dela)  → Em andamento
// =====================================================================

export type Situacao = "Realizado" | "Em andamento" | "Agendado" | "Cancelado";
export const SITUACOES: Situacao[] = ["Realizado", "Em andamento", "Agendado", "Cancelado"];

/** Paleta categórica validada (dataviz, 4 checagens + contraste) — ordem fixa. */
export const COR_SITUACAO: Record<Situacao, string> = {
  Realizado: "#2d62d6", "Em andamento": "#ea6a1e", Agendado: "#16a085", Cancelado: "#8b5cf6",
};
export const COR_SERIE_UNICA = "#2d62d6";

export interface ContratoDash { contrato_codigo: number | null; contrato_nome: string; administrativo: boolean | null }
export interface AbastecimentoDash {
  id: string; agendamento_id: string; data: string; valor: number | null; litros: number | null; km: number | null;
  descricao: string | null; nome_arquivo: string | null; criado_por_nome: string | null; created_at: string;
  contratos: ContratoDash[];
}
export interface AgendamentoDash {
  id: string; numero: number; patrimonio_id: string; veiculo_nome: string; veiculo_identificador: string | null;
  data_inicio: string; data_fim: string; turno: "manha" | "tarde" | "dia_todo";
  destino: string | null; motivo: string | null; observacoes: string | null;
  status: "confirmado" | "cancelado" | "concluido"; motivo_cancelamento: string | null;
  solicitante_id: string; solicitante_nome: string | null; created_at: string;
  km_inicial: number | null; km_inicial_em: string | null; km_final: number | null; km_final_em: string | null;
  controle_km?: boolean | null;
  contratos: ContratoDash[];
}

export const LABEL_TURNO_DASH: Record<AgendamentoDash["turno"], string> = { manha: "Manhã", tarde: "Tarde", dia_todo: "Dia todo" };
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** "YYYY-MM-DD" de hoje no horário de Brasília. */
export const hojeBR = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export function situacaoDe(a: Pick<AgendamentoDash, "status" | "data_inicio" | "data_fim">, hoje = hojeBR()): Situacao {
  if (a.status === "cancelado") return "Cancelado";
  if (a.data_inicio > hoje) return "Agendado";
  if (a.data_fim < hoje) return "Realizado";
  return "Em andamento";
}

/** Dias corridos da reserva, contando início e fim. */
export function diasDaReserva(a: Pick<AgendamentoDash, "data_inicio" | "data_fim">): number {
  const i = Date.parse(`${a.data_inicio}T12:00:00Z`), f = Date.parse(`${a.data_fim}T12:00:00Z`);
  return Number.isFinite(i) && Number.isFinite(f) && f >= i ? Math.round((f - i) / 86_400_000) + 1 : 1;
}

export const kmRodados = (a: Pick<AgendamentoDash, "km_inicial" | "km_final">) =>
  a.km_inicial != null && a.km_final != null && a.km_final >= a.km_inicial ? a.km_final - a.km_inicial : null;

// ── Filtros ────────────────────────────────────────────────────────────
export type Periodo = "mes" | "mes_passado" | "90d" | "ano" | "tudo" | "personalizado";
export const ROTULO_PERIODO: Record<Periodo, string> = {
  mes: "Este mês", mes_passado: "Mês passado", "90d": "Últimos 90 dias", ano: "Este ano", tudo: "Tudo", personalizado: "Personalizado",
};

/** [início, fim] (YYYY-MM-DD, inclusivos) do período; null = sem limite. */
export function intervaloDo(p: Periodo, hoje = hojeBR(), de = "", ate = ""): [string | null, string | null] {
  const [a, m] = hoje.split("-").map(Number);
  const ymd = (y: number, mm: number, d: number) => new Date(Date.UTC(y, mm - 1, d)).toISOString().slice(0, 10);
  switch (p) {
    case "mes": return [ymd(a, m, 1), ymd(a, m + 1, 0)];
    case "mes_passado": return [ymd(a, m - 1, 1), ymd(a, m, 0)];
    case "90d": { const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 89); return [d.toISOString().slice(0, 10), hoje]; }
    case "ano": return [ymd(a, 1, 1), ymd(a, 12, 31)];
    case "personalizado": return [de || null, ate || null];
    default: return [null, null];
  }
}

export interface Filtros { periodo: Periodo; de?: string; ate?: string; veiculo?: string; situacao?: Situacao | "" }

/** A reserva conta no período se ENCOSTA nele (uma viagem de 30/08 a 02/09 aparece em agosto e em setembro). */
export function filtrar(lista: AgendamentoDash[], f: Filtros, hoje = hojeBR()): AgendamentoDash[] {
  const [ini, fim] = intervaloDo(f.periodo, hoje, f.de, f.ate);
  return lista.filter((a) =>
    (!ini || a.data_fim >= ini) && (!fim || a.data_inicio <= fim)
    && (!f.veiculo || a.patrimonio_id === f.veiculo)
    && (!f.situacao || situacaoDe(a, hoje) === f.situacao));
}

// ── Indicadores e agrupamentos ────────────────────────────────────────
export interface Indicadores {
  total: number; porSituacao: Record<Situacao, number>; taxaCancelamento: number;
  diasReservados: number; veiculosUsados: number; solicitantes: number; contratosAtendidos: number;
  kmRodados: number; viagensComKm: number; valorAbastecido: number; litros: number; notas: number;
  custoPorKm: number | null;
}

export function indicadores(lista: AgendamentoDash[], abast: AbastecimentoDash[], hoje = hojeBR()): Indicadores {
  const porSituacao = Object.fromEntries(SITUACOES.map((s) => [s, 0])) as Record<Situacao, number>;
  lista.forEach((a) => porSituacao[situacaoDe(a, hoje)]++);
  const vivos = lista.filter((a) => a.status !== "cancelado");
  const ids = new Set(lista.map((a) => a.id));
  const notas = abast.filter((b) => ids.has(b.agendamento_id));
  const km = vivos.map(kmRodados).filter((x): x is number => x != null);
  const valor = notas.reduce((s, b) => s + (Number(b.valor) || 0), 0);
  const kmTotal = km.reduce((s, x) => s + x, 0);
  return {
    total: lista.length, porSituacao,
    taxaCancelamento: lista.length ? porSituacao.Cancelado / lista.length : 0,
    diasReservados: vivos.reduce((s, a) => s + diasDaReserva(a), 0),
    veiculosUsados: new Set(vivos.map((a) => a.patrimonio_id)).size,
    solicitantes: new Set(lista.map((a) => a.solicitante_id)).size,
    contratosAtendidos: new Set(vivos.flatMap((a) => a.contratos.map((c) => c.contrato_nome))).size,
    kmRodados: kmTotal, viagensComKm: km.length,
    valorAbastecido: valor, litros: notas.reduce((s, b) => s + (Number(b.litros) || 0), 0), notas: notas.length,
    custoPorKm: kmTotal > 0 && valor > 0 ? valor / kmTotal : null,
  };
}

/** Uma linha por mês de INÍCIO da reserva, com as quatro situações empilhadas. */
export function porMes(lista: AgendamentoDash[], hoje = hojeBR()) {
  const m = new Map<string, Record<Situacao, number>>();
  for (const a of lista) {
    const k = a.data_inicio.slice(0, 7);
    const linha = m.get(k) ?? (Object.fromEntries(SITUACOES.map((s) => [s, 0])) as Record<Situacao, number>);
    linha[situacaoDe(a, hoje)]++;
    m.set(k, linha);
  }
  // Mês sem agendamento entra com zero: pular de "set" para "dez" deixava o
  // eixo do tempo mentindo sobre o intervalo.
  const chaves = [...m.keys()].sort();
  if (chaves.length > 1) {
    const vazio = () => Object.fromEntries(SITUACOES.map((s) => [s, 0])) as Record<Situacao, number>;
    for (let k = chaves[0]; k < chaves[chaves.length - 1]; ) {
      const [y, mm] = k.split("-").map(Number);
      k = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7);
      if (!m.has(k)) m.set(k, vazio());
    }
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, v]) => {
    const [y, mm] = mes.split("-").map(Number);
    const rotulo = new Date(Date.UTC(y, mm - 1, 15)).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(".", "");
    return { mes, rotulo, ...v, total: SITUACOES.reduce((s, x) => s + v[x], 0) };
  });
}

/** Reservas e dias por veículo (sem as canceladas), do mais usado pro menos. */
export function porVeiculo(lista: AgendamentoDash[], abast: AbastecimentoDash[]) {
  const m = new Map<string, { veiculo: string; placa: string; reservas: number; dias: number; km: number; valor: number }>();
  const porAg = new Map(lista.map((a) => [a.id, a]));
  for (const a of lista) {
    if (a.status === "cancelado") continue;
    const v = m.get(a.patrimonio_id) ?? { veiculo: a.veiculo_nome, placa: a.veiculo_identificador ?? "", reservas: 0, dias: 0, km: 0, valor: 0 };
    v.reservas++; v.dias += diasDaReserva(a); v.km += kmRodados(a) ?? 0;
    m.set(a.patrimonio_id, v);
  }
  for (const b of abast) {
    const a = porAg.get(b.agendamento_id); if (!a || a.status === "cancelado") continue;
    const v = m.get(a.patrimonio_id); if (v) v.valor += Number(b.valor) || 0;
  }
  return [...m.values()].sort((a, b) => b.dias - a.dias || b.reservas - a.reservas);
}

/** Contagem por um campo, top N + "Outros". */
function topN(pares: string[], n: number) {
  const m = new Map<string, number>();
  pares.forEach((k) => m.set(k, (m.get(k) ?? 0) + 1));
  const ord = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topo = ord.slice(0, n).map(([nome, qtd]) => ({ nome, qtd }));
  const resto = ord.slice(n).reduce((s, [, q]) => s + q, 0);
  return resto ? [...topo, { nome: `Outros (${ord.length - n})`, qtd: resto }] : topo;
}
export const porContrato = (lista: AgendamentoDash[], n = 10) =>
  topN(lista.filter((a) => a.status !== "cancelado").flatMap((a) => a.contratos.map((c) => c.contrato_nome)), n);
export const porSolicitante = (lista: AgendamentoDash[], n = 10) =>
  topN(lista.map((a) => a.solicitante_nome?.trim() || "Sem nome"), n);

export function porTurno(lista: AgendamentoDash[]) {
  const vivos = lista.filter((a) => a.status !== "cancelado");
  return (["dia_todo", "manha", "tarde"] as const).map((t) => ({ nome: LABEL_TURNO_DASH[t], qtd: vivos.filter((a) => a.turno === t).length }));
}

export function porDiaSemana(lista: AgendamentoDash[]) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  lista.filter((a) => a.status !== "cancelado").forEach((a) => c[new Date(`${a.data_inicio}T12:00:00Z`).getUTCDay()]++);
  return DIAS_SEMANA.map((dia, i) => ({ dia, qtd: c[i] }));
}
