// =====================================================================
// GESTÃO DE PONTO — o espelho do mês de um colaborador, montado a partir
// das batidas da Senior (espelho."BiMarcacoes", RPC gp_mes, mig
// 20261007000001). Lógica pura, testada em src/test/gestao-ponto.test.ts.
//
// AS BATIDAS: cada uma é [data, minuto do dia] — 420 = 07:00 (ver
// src/lib/ponto.ts). Um dia comum tem 4 (entrada, saída almoço, volta,
// saída), mas há quem tenha 8 (telefonista com pausas) e há dia com número
// ÍMPAR (esqueceu de bater) — o par que fica sem fechar não entra na conta e
// o dia é marcado.
//
// A JORNADA vem do texto da escala da Senior, que não tem formato fixo:
//   "08:00-17:00 (1h)(8h)"          → 08–17, intervalo 1h, 8h por dia
//   "07:30-17:18 (1H)(08:48)"       → 8h48
//   "07:00-13:15 (15m) SEG-SEX"     → 6h
//   "19:00-07:00(1hIND)12X36 - 220h"→ 12x36 noturna, intervalo INDENIZADO
//                                     (trabalhado, não desconta)
//   "6h Tuno 00:00 - 06:00 - 40min" → 6h
//   "6h flexiveis - 40min interval" → 6h, sem horário fixo
// + as horas da tabela ESCALAS (H.Semana) como último recurso.
//
// LIMITES CONHECIDOS (mostrados na tela, não escondidos):
//   · Feriado: só os nacionais (fixos + Sexta-feira Santa, pela Páscoa). O
//     municipal aparece como falta.
//   · 12x36: o ERP não sabe em que dia do ciclo a pessoa está, então dia sem
//     batida não vira falta — só se compara o que foi trabalhado nos dias com
//     batida.
//   · Atestado, férias e folga combinada não vêm do espelho: dia sem batida
//     em dia útil aparece como "Sem batida" para o RH conferir.
// =====================================================================

import { MINUTOS_POR_DIA, parseMinutos } from "@/lib/ponto";

export type Batida = [string, number];   // ["2026-09-01", 420]

export interface EscalaSenior {
  codigo: number | null;
  descricao: string | null;
  h_semana: string | null;   // "44:00"
  h_mes: string | null;      // "220:00"
  h_dsr: string | null;
}

export interface ColaboradorPonto {
  id: number;
  empresa: number | string | null;
  cadastro: number | string | null;
  nome: string;
  cargo: string | null;
  situacao: string | null;
  admissao: string | null;      // AAAA-MM-DD
  afastamento: string | null;   // AAAA-MM-DD (só de quem saiu)
  filial: string | null;
  posto: string | null;
  escala: EscalaSenior;
  batidas: Batida[];
}

export interface RespostaMes {
  disponivel: boolean;
  motivo?: string;
  mes: string;
  inicio: string;
  fim: string;
  gerado_em: string;
  colaboradores: ColaboradorPonto[];
}

// ---- Escala ------------------------------------------------------------------

export interface Jornada {
  /** Minuto do dia da entrada prevista (null = sem horário fixo). */
  inicio: number | null;
  /** Minuto do dia da saída prevista (pode ser < inicio: vira o dia). */
  fim: number | null;
  /** Intervalo descontado (0 quando indenizado). */
  intervalo: number;
  /** Minutos previstos por dia trabalhado. */
  minutosDia: number;
  /** 12x36 (só para mostrar; a regra de dia é `revezamento`). */
  escala12x36: boolean;
  /**
   * Revezamento: 12x36, 6x1, ou horas da semana que dão 6+ dias (telefonista
   * do SAMU: 36h/sem com 5h20/dia). O ERP não sabe em que dia do ciclo a
   * pessoa está, então o previsto vale só nos dias com batida, fim de semana
   * é dia normal e dia sem batida não vira falta.
   */
  revezamento: boolean;
  /** Jornada atravessa a meia-noite (19:00–07:00). */
  noturna: boolean;
  /** Trabalha sábado (SEG A SAB, 6x1, +SAB). */
  sabado: boolean;
  /** Minutos previstos no sábado, quando trabalha (ex.: "+ SAB 07-11"). */
  minutosSabado: number;
  /** Sem horário fixo ("flexíveis"): atraso não se aplica. */
  flexivel: boolean;
  /** De onde saiu a jornada — a tela mostra, para o RH confiar ou não. */
  origem: "texto" | "horario" | "tabela" | "padrao";
}

/** "08:48" → 528 · "8:48h" → 528 · "8h" → 480 · "15m" → 15 · "1:30H" → 90 · "30min" → 30. */
export function duracaoEmMinutos(txt: string): number | null {
  // "IND"/"IN" no fim = intervalo indenizado ("1hIND", "1hIN"); "15min" vira "15m".
  const s = txt.trim().toLowerCase().replace(/\s+/g, "").replace(/ind?$/, "");
  let m = s.match(/^(\d{1,2}):(\d{2})h?$/);
  if (m) return +m[1] * 60 + +m[2];
  m = s.match(/^(\d{1,2})h(\d{1,2})?(min|m)?$/);
  if (m) return +m[1] * 60 + (m[2] ? +m[2] : 0);
  m = s.match(/^(\d{1,3})(min|m)$/);
  if (m) return +m[1];
  return null;
}

const horaParaMin = (h: string, m: string) => (+h % 24) * 60 + +m;

/** "44:00" → 2640 */
const horasTabela = (v: string | null) => {
  const m = (v ?? "").match(/^(\d{1,3}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : null;
};

/** Lê a jornada do texto da escala da Senior (+ H.Semana como reserva). */
export function interpretarEscala(e: Pick<EscalaSenior, "descricao" | "h_semana">): Jornada {
  const txt = (e.descricao ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const up = txt.toUpperCase();
  const escala12x36 = /12\s*X\s*36|FLEX\s*12/.test(up);
  const sabado = /SAB|6\s*X\s*1|SEG\s*A\s*SAB/.test(up);
  const flexivel = /FLEX/.test(up) && !escala12x36 ? true : /FLEXIVE/.test(up);

  // Horário: "08:00-17:00", "07:00 - 19:00", "12:00 18:00", "19:00:00-07:00",
  // "00:00/06:00", "06:00 - 18-00" (hífen no lugar dos dois-pontos).
  let inicio: number | null = null;
  let fim: number | null = null;
  const h = up.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:-|\/|A|\s)\s*(\d{1,2})[:-](\d{2})/);
  if (h) { inicio = horaParaMin(h[1], h[2]); fim = horaParaMin(h[3], h[4]); }

  // Durações entre parênteses ou soltas ("- 40min", "6h").
  const parenteses = [...up.matchAll(/\(([^)]*)\)/g)].map((x) => x[1]);
  const duracoes: { min: number; ind: boolean }[] = [];
  for (const p of parenteses) {
    const d = duracaoEmMinutos(p.replace(/\s/g, ""));
    if (d != null) duracoes.push({ min: d, ind: /IND$/.test(p) || /H\s*IN$/.test(p) });
  }
  const intervaloSolto = up.match(/-\s*(\d{1,3})\s*MIN/);
  // Intervalo: a primeira duração curta (< 3h).
  const curto = duracoes.find((d) => d.min < 180);
  let intervalo = curto ? (curto.ind ? 0 : curto.min) : intervaloSolto ? +intervaloSolto[1] : 0;
  // Jornada explícita: a última duração longa (≥ 3h) entre parênteses, ou "6h" no começo.
  const longa = [...duracoes].reverse().find((d) => d.min >= 180 && d.min <= 13 * 60);
  const inicial = up.match(/^\s*(\d{1,2})\s*H\b/);

  let minutosDia: number;
  let origem: Jornada["origem"];
  const span = inicio != null && fim != null ? ((fim - inicio + MINUTOS_POR_DIA) % MINUTOS_POR_DIA) || MINUTOS_POR_DIA : null;
  if (longa) { minutosDia = longa.min; origem = "texto"; }
  // "6h … - 40min": as pausas são batidas (telefonista do SAMU bate 8 vezes),
  // então ficam fora dos pares — o previsto é 6h − 40min = 5h20, que é
  // exatamente o que a soma dos pares dá nos dias certos (medido em set/2026).
  else if (inicial) { minutosDia = +inicial[1] * 60 - (!curto && intervaloSolto ? intervalo : 0); origem = "texto"; }
  else if (span != null) { minutosDia = span - intervalo; origem = "horario"; }
  else {
    const sem = horasTabela(e.h_semana);
    minutosDia = sem ? Math.round(sem / (sabado ? 6 : 5)) : 8 * 60;
    origem = sem ? "tabela" : "padrao";
  }
  if (minutosDia <= 0 || minutosDia > 16 * 60) { minutosDia = 8 * 60; origem = "padrao"; }
  if (intervalo >= minutosDia) intervalo = 0;

  // Sábado curto: "+ SAB 07-11" / "+SAB 06:30-10:30".
  let minutosSabado = 0;
  if (sabado) {
    const s = up.match(/SAB\.?\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?/);
    minutosSabado = s ? Math.max(0, horaParaMin(s[3], s[4] ?? "0") - horaParaMin(s[1], s[2] ?? "0")) : minutosDia;
  }

  // Revezamento: dias por semana pela tabela ESCALAS (H.Semana ÷ jornada).
  // "SEG" no texto (SEG-SEX, SEG A SAB) é dia fixo — não é revezamento.
  const semanal = horasTabela(e.h_semana);
  const revezamento = escala12x36 || /6\s*X\s*1|REVEZ/.test(up)
    || (!/SEG/.test(up) && semanal != null && semanal / minutosDia >= 5.75);

  return {
    inicio, fim, intervalo, minutosDia, escala12x36, revezamento,
    noturna: inicio != null && fim != null && fim < inicio,
    sabado: sabado && !revezamento, minutosSabado, flexivel, origem,
  };
}

// ---- Feriados nacionais ---------------------------------------------------------

/** Domingo de Páscoa (algoritmo de Meeus/Butcher). */
function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function feriadosNacionais(ano: number): Map<string, string> {
  const m = new Map<string, string>([
    [`${ano}-01-01`, "Confraternização Universal"], [`${ano}-04-21`, "Tiradentes"],
    [`${ano}-05-01`, "Dia do Trabalho"], [`${ano}-09-07`, "Independência"],
    [`${ano}-10-12`, "N. Sra. Aparecida"], [`${ano}-11-02`, "Finados"],
    [`${ano}-11-15`, "Proclamação da República"], [`${ano}-11-20`, "Consciência Negra"],
    [`${ano}-12-25`, "Natal"],
  ]);
  const sexta = pascoa(ano); sexta.setUTCDate(sexta.getUTCDate() - 2);
  m.set(iso(sexta), "Sexta-feira Santa");
  return m;
}

// ---- O espelho do mês ----------------------------------------------------------

export type SituacaoDia =
  | "ok" | "impar" | "sem_batida" | "atraso" | "extra" | "devendo"
  | "folga" | "folga_trabalhada" | "feriado" | "futuro" | "fora_contrato" | "afastado";

export interface DiaPonto {
  data: string;
  diaSemana: number;          // 0 = domingo
  /** Minutos já ajustados à jornada (saída depois da meia-noite = +1440). */
  batidas: number[];
  pares: [number, number][];
  trabalhado: number;
  previsto: number;
  saldo: number;
  atrasoMin: number;
  situacao: SituacaoDia;
  feriado: string | null;
}

export interface EspelhoMes {
  dias: DiaPonto[];
  jornada: Jornada;
  totais: {
    trabalhado: number; previsto: number; saldo: number;
    diasTrabalhados: number; semBatida: number; impares: number; atrasos: number;
    minutosAtraso: number; extras: number; minutosExtra: number; minutosDevendo: number;
  };
  /** Pendências que o RH tem que olhar (ímpar + sem batida + atraso). */
  inconsistencias: number;
}

export const TOLERANCIA_MIN = 10;

function diasDoMes(mes: string): string[] {
  const [a, m] = mes.split("-").map(Number);
  const n = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`);
}
const somaDias = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return iso(x); };

/**
 * Agrupa as batidas por dia de JORNADA. Na escala noturna (19:00–07:00) a
 * saída da manhã cai na data seguinte no relógio; ela volta para o dia em que
 * a jornada começou, somada de 1440 — senão cada noite vira dois dias com
 * batida ímpar.
 */
export function agruparPorJornada(batidas: Batida[], j: Jornada): Map<string, number[]> {
  const porDia = new Map<string, number[]>();
  const add = (d: string, v: number) => { if (!porDia.has(d)) porDia.set(d, []); porDia.get(d)!.push(v); };
  const corte = j.noturna && j.fim != null && j.inicio != null ? Math.min(j.fim + 300, j.inicio - 60) : null;
  for (const [dia, cru] of batidas) {
    const v = parseMinutos(cru);
    if (v == null) continue;
    if (corte != null && v < corte) add(somaDias(dia, -1), v + MINUTOS_POR_DIA);
    else add(dia, v);
  }
  porDia.forEach((l) => l.sort((a, b) => a - b));

  // Entrada ANTECIPADA de quem começa à meia-noite: a telefonista do turno
  // 00:00–06:00 bate a entrada às 23:55 do dia anterior (minuto 1435). Sem
  // isto, o dia começa pela saída da pausa e os pares saem trocados ("18h
  // trabalhadas" — medido no SAMU, set/2026). Batida depois das 23:00, num
  // dia seguido de outro que começa de madrugada, vai para o dia seguinte
  // como minuto negativo (23:55 → −5).
  if (!j.noturna) {
    for (const d of [...porDia.keys()].sort()) {
      const l = porDia.get(d)!;
      const prox = porDia.get(somaDias(d, 1));
      if (l.length && l[l.length - 1] >= 23 * 60 && l[l.length - 1] < MINUTOS_POR_DIA && prox?.length && prox[0] <= 7 * 60) {
        prox.unshift(l.pop()! - MINUTOS_POR_DIA);
        if (!l.length) porDia.delete(d);
      }
    }
  }
  return porDia;
}

export function montarEspelho(
  c: Pick<ColaboradorPonto, "batidas" | "escala" | "admissao" | "afastamento"> & { situacao?: string | null },
  mes: string,
  hoje: string = iso(new Date()),
): EspelhoMes {
  const j = interpretarEscala(c.escala);
  const porDia = agruparPorJornada(c.batidas ?? [], j);
  const feriados = feriadosNacionais(+mes.slice(0, 4));
  // Afastado hoje (auxílio-doença, licença, férias…) e sem nenhuma batida no
  // mês: os dias são "Afastado", não falta. A EMPREGADOS só tem a situação
  // ATUAL, então quem voltou no meio do mês aparece normal.
  const afastadoNoMes = !!c.situacao && c.situacao !== "Trabalhando"
    && !/DEMIT|DESLIG|RESCIS/i.test(c.situacao) && !(c.batidas ?? []).length;

  const dias: DiaPonto[] = diasDoMes(mes).map((data) => {
    const dow = new Date(data + "T12:00:00Z").getUTCDay();
    const batidas = porDia.get(data) ?? [];
    const pares: [number, number][] = [];
    for (let i = 0; i + 1 < batidas.length; i += 2) pares.push([batidas[i], batidas[i + 1]]);
    const trabalhado = pares.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
    const feriado = feriados.get(data) ?? null;
    const foraContrato = (!!c.admissao && data < c.admissao) || (!!c.afastamento && data > c.afastamento);

    // Previsto: revezamento só nos dias trabalhados; o resto, dia útil da escala.
    let previsto = 0;
    if (!foraContrato && !feriado && !afastadoNoMes) {
      if (j.revezamento) previsto = batidas.length ? j.minutosDia : 0;
      else if (dow >= 1 && dow <= 5) previsto = j.minutosDia;
      else if (dow === 6 && j.sabado) previsto = j.minutosSabado;
    }
    const atrasoMin = !j.flexivel && j.inicio != null && batidas.length && previsto
      ? Math.max(0, batidas[0] - j.inicio - TOLERANCIA_MIN) : 0;
    const saldo = batidas.length % 2 === 0 ? trabalhado - previsto : 0;

    let situacao: SituacaoDia;
    if (foraContrato) situacao = "fora_contrato";
    else if (data > hoje) situacao = "futuro";
    else if (afastadoNoMes) situacao = "afastado";
    else if (batidas.length % 2 === 1) situacao = "impar";
    else if (!batidas.length) situacao = feriado ? "feriado" : previsto ? "sem_batida" : "folga";
    else if (!previsto) situacao = feriado ? "feriado" : "folga_trabalhada";
    else if (atrasoMin > 0) situacao = "atraso";
    else if (saldo > TOLERANCIA_MIN) situacao = "extra";
    else if (saldo < -TOLERANCIA_MIN) situacao = "devendo";
    else situacao = "ok";

    return { data, diaSemana: dow, batidas, pares, trabalhado, previsto, saldo, atrasoMin, situacao, feriado };
  });

  const conta = (s: SituacaoDia) => dias.filter((d) => d.situacao === s).length;
  const passados = dias.filter((d) => d.situacao !== "futuro" && d.situacao !== "fora_contrato");
  const totais = {
    trabalhado: passados.reduce((s, d) => s + d.trabalhado, 0),
    previsto: passados.reduce((s, d) => s + d.previsto, 0),
    saldo: 0,
    diasTrabalhados: passados.filter((d) => d.batidas.length > 0).length,
    semBatida: conta("sem_batida"),
    impares: conta("impar"),
    atrasos: dias.filter((d) => d.atrasoMin > 0).length,
    minutosAtraso: dias.reduce((s, d) => s + d.atrasoMin, 0),
    extras: dias.filter((d) => d.saldo > TOLERANCIA_MIN || d.situacao === "folga_trabalhada").length,
    minutosExtra: passados.reduce((s, d) => s + (d.previsto ? Math.max(0, d.saldo) : d.trabalhado), 0),
    minutosDevendo: passados.reduce((s, d) => s + (d.previsto ? Math.max(0, -d.saldo) : 0), 0),
  };
  totais.saldo = totais.trabalhado - totais.previsto;

  return { dias, jornada: j, totais, inconsistencias: totais.impares + totais.semBatida + totais.atrasos };
}

// ---- Formatação --------------------------------------------------------------

/** 510 → "8:30" · -45 → "−0:45" · 0 → "0:00". */
export function fmtHoras(min: number): string {
  const s = min < 0 ? "−" : "";
  const a = Math.abs(Math.round(min));
  return `${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

export const ROTULO_SITUACAO: Record<SituacaoDia, { label: string; cls: string }> = {
  ok:               { label: "OK",                cls: "text-success" },
  impar:            { label: "Batida ímpar",      cls: "text-destructive" },
  sem_batida:       { label: "Sem batida",        cls: "text-destructive" },
  atraso:           { label: "Atraso",            cls: "text-warning" },
  extra:            { label: "Hora extra",        cls: "text-info" },
  devendo:          { label: "Devendo horas",     cls: "text-warning" },
  folga:            { label: "Folga",             cls: "text-muted-foreground" },
  folga_trabalhada: { label: "Trabalhou na folga", cls: "text-info" },
  feriado:          { label: "Feriado",           cls: "text-muted-foreground" },
  futuro:           { label: "—",                 cls: "text-muted-foreground" },
  fora_contrato:    { label: "Fora do contrato",  cls: "text-muted-foreground" },
  afastado:         { label: "Afastado",          cls: "text-muted-foreground" },
};

export const NOME_DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
