import { describe, it, expect } from "vitest";
import {
  interpretarEscala, duracaoEmMinutos, agruparPorJornada, montarEspelho, feriadosNacionais, fmtHoras,
  type Batida, type EscalaSenior,
} from "@/lib/gestaoPonto";

// =====================================================================
// Gestão de Ponto (branch gestaoponto, mig 20261007000001).
// Textos de escala e batidas são reais (espelho da Senior, set/2026).
// =====================================================================

const esc = (descricao: string, h_semana: string | null = "44:00"): EscalaSenior =>
  ({ codigo: 1, descricao, h_semana, h_mes: null, h_dsr: null });

describe("duracaoEmMinutos", () => {
  it("lê os formatos da Senior", () => {
    expect(duracaoEmMinutos("8h")).toBe(480);
    expect(duracaoEmMinutos("08:48")).toBe(528);
    expect(duracaoEmMinutos("8:48h")).toBe(528);
    expect(duracaoEmMinutos("15m")).toBe(15);
    expect(duracaoEmMinutos("1:30H")).toBe(90);
    expect(duracaoEmMinutos("1H30")).toBe(90);
    expect(duracaoEmMinutos("30minIND")).toBe(30);
    expect(duracaoEmMinutos("12x36")).toBeNull();
    expect(duracaoEmMinutos("200h")).toBeNull();
  });
});

describe("interpretarEscala", () => {
  it("horário comercial com jornada explícita", () => {
    const j = interpretarEscala(esc("08:00-17:00 (1h)(8h)"));
    expect(j).toMatchObject({ inicio: 480, fim: 1020, intervalo: 60, minutosDia: 480, escala12x36: false, noturna: false, origem: "texto" });
  });
  it("8h48", () => {
    expect(interpretarEscala(esc("07:30-17:18 (1H)(08:48)")).minutosDia).toBe(528);
    expect(interpretarEscala(esc("07:00-16:48(1h)(8:48h)")).minutosDia).toBe(528);
  });
  it("6h com intervalo de 15 min, sem jornada escrita: calcula pelo horário", () => {
    expect(interpretarEscala(esc("07:00-13:15 (15m) SEG-SEX"))).toMatchObject({ minutosDia: 360, intervalo: 15, origem: "horario" });
  });
  it("12x36 noturna com intervalo indenizado: 12h, vira o dia", () => {
    const j = interpretarEscala(esc("19:00-07:00(1hIND)12X36 - 220h", "36:00"));
    expect(j).toMatchObject({ escala12x36: true, noturna: true, intervalo: 0, minutosDia: 720 });
  });
  it("12x36 diurna com intervalo descontado", () => {
    expect(interpretarEscala(esc("06:00-18:00(12x36)(1h)"))).toMatchObject({ escala12x36: true, noturna: false, minutosDia: 660 });
  });
  it("'6h … - 40min': as pausas são batidas, então o previsto é 6h − 40min", () => {
    expect(interpretarEscala(esc("6h Tuno 00:00 - 06:00 - 40min", "34:00")).minutosDia).toBe(320);
    expect(interpretarEscala(esc("6h - 12:00 18:00 - 40min", "34:00")).minutosDia).toBe(320);
    expect(interpretarEscala(esc("6h flexiveis - 40min interval", "36:00"))).toMatchObject({ minutosDia: 320, flexivel: true, inicio: null });
    expect(interpretarEscala(esc("6h dia| 6x1 | DSR domingo", "36:00"))).toMatchObject({ minutosDia: 360, revezamento: true });
  });
  it("revezamento pela tabela: 36h/sem com 5h20/dia dá 6+ dias; 44h com 8h/dia não", () => {
    expect(interpretarEscala(esc("6h flexiveis - 40min interval", "36:00")).revezamento).toBe(true);
    expect(interpretarEscala(esc("08:00-17:00 (1h)(8h)", "44:00")).revezamento).toBe(false);
    expect(interpretarEscala(esc("06:00-12:15 (00:15)SEG A SAB", "44:00"))).toMatchObject({ revezamento: false, sabado: true });
  });
  it("revezamento: fim de semana trabalhado é dia normal, e dia sem batida não é falta", () => {
    const e = montarEspelho({
      escala: esc("6h - 12:00 18:00 - 40min", "34:00"), admissao: null, afastamento: null,
      batidas: [["2026-09-06", 720], ["2026-09-06", 1040]],     // domingo, 5h20
    }, "2026-09", "2026-09-30");
    expect(e.dias.find((d) => d.data === "2026-09-06")).toMatchObject({ situacao: "ok", previsto: 320 });
    expect(e.totais.semBatida).toBe(0);
  });
  it("afastado sem batida no mês: dias como Afastado, não falta", () => {
    const e = montarEspelho({ escala: esc("08:00-17:00 (1h)(8h)"), admissao: null, afastamento: null, batidas: [], situacao: "Auxílio Doença" }, "2026-09", "2026-09-30");
    expect(e.totais.semBatida).toBe(0);
    expect(e.dias.find((d) => d.data === "2026-09-08")!.situacao).toBe("afastado");
    expect(e.totais.previsto).toBe(0);
  });
  it("telefonista do SAMU (8 batidas reais, set/2026) fecha 5h20 = previsto", () => {
    const e = montarEspelho({
      escala: esc("6h Tuno 00:00 - 06:00 - 40min", "34:00"), admissao: null, afastamento: null,
      batidas: [0, 93, 104, 137, 157, 274, 286, 363].map((m) => ["2026-09-01", m] as Batida),
    }, "2026-09", "2026-09-30");
    expect(e.dias[0]).toMatchObject({ trabalhado: 320, previsto: 320, saldo: 0, situacao: "ok" });
  });
  it("separadores fora do padrão que existem na Senior", () => {
    expect(interpretarEscala(esc("00:00/06:00 - 40min intervalo", "36:00"))).toMatchObject({ inicio: 0, fim: 360, intervalo: 40, minutosDia: 320 });
    expect(interpretarEscala(esc("06:00 - 18-00 (1hIND) 12X36", "36:00"))).toMatchObject({ inicio: 360, fim: 1080, intervalo: 0, minutosDia: 720, escala12x36: true });
    expect(interpretarEscala(esc("19:00-07:00(12x36)(1hIN)(220H)", "36:00"))).toMatchObject({ intervalo: 0, minutosDia: 720, noturna: true });
  });
  it("sábado curto", () => {
    expect(interpretarEscala(esc("07:00-16:30 (1H30)+ SAB 07-11"))).toMatchObject({ sabado: true, minutosSabado: 240, minutosDia: 480 });
  });
  it("sem nada legível: usa H.Semana da tabela ESCALAS", () => {
    expect(interpretarEscala(esc("Escala Erro", "40:00"))).toMatchObject({ minutosDia: 480, origem: "tabela" });
  });
});

describe("agruparPorJornada", () => {
  it("noturna: a saída da manhã volta para o dia em que a jornada começou", () => {
    const j = interpretarEscala(esc("19:00-07:00 (1hIND) 12X36", "36:00"));
    const g = agruparPorJornada([["2026-09-01", 1141], ["2026-09-02", 418], ["2026-09-03", 1135]], j);
    expect(g.get("2026-09-01")).toEqual([1141, 1858]);   // 07:00 do dia seguinte = 1440 + 418
    expect(g.get("2026-09-02")).toBeUndefined();
    expect(g.get("2026-09-03")).toEqual([1135]);
  });
  it("turno da meia-noite: a entrada das 23:55 vai para o dia seguinte (SAMU, set/2026)", () => {
    const j = interpretarEscala(esc("00:00/06:00 - 40min intervalo", "34:00"));
    const g = agruparPorJornada([
      ["2026-09-03", 142], ["2026-09-03", 152], ["2026-09-03", 256], ["2026-09-03", 277],
      ["2026-09-03", 320], ["2026-09-03", 330], ["2026-09-03", 367], ["2026-09-03", 1435],
      ["2026-09-04", 98], ["2026-09-04", 108], ["2026-09-04", 211], ["2026-09-04", 231],
      ["2026-09-04", 313], ["2026-09-04", 323], ["2026-09-04", 358],
    ], j);
    expect(g.get("2026-09-03")).toEqual([142, 152, 256, 277, 320, 330, 367]);
    expect(g.get("2026-09-04")).toEqual([-5, 98, 108, 211, 231, 313, 323, 358]);
    const e = montarEspelho({ escala: esc("00:00/06:00 - 40min intervalo", "34:00"), admissao: null, afastamento: null,
      batidas: [["2026-09-03", 1435], ...[98, 108, 211, 231, 313, 323, 358].map((m) => ["2026-09-04", m] as Batida)] }, "2026-09", "2026-09-30");
    expect(e.dias.find((d) => d.data === "2026-09-04")).toMatchObject({ trabalhado: 103 + 103 + 82 + 35, situacao: "ok" });
  });
  it("diurna não mexe", () => {
    const j = interpretarEscala(esc("08:00-17:00 (1h)(8h)"));
    expect(agruparPorJornada([["2026-09-01", 478], ["2026-09-01", 1022]], j).get("2026-09-01")).toEqual([478, 1022]);
  });
});

describe("montarEspelho", () => {
  const comercial = (batidas: Batida[], extra: Partial<{ admissao: string; afastamento: string }> = {}) =>
    montarEspelho({ escala: esc("08:00-17:00 (1h)(8h)"), batidas, admissao: extra.admissao ?? null, afastamento: extra.afastamento ?? null }, "2026-09", "2026-09-30");

  it("dia certo, atraso, hora extra, ímpar e sem batida", () => {
    const e = comercial([
      ["2026-09-01", 478], ["2026-09-01", 720], ["2026-09-01", 780], ["2026-09-01", 1018],   // 8:00 certo
      ["2026-09-02", 510], ["2026-09-02", 720], ["2026-09-02", 780], ["2026-09-02", 1020],   // chegou 8:30
      ["2026-09-03", 480], ["2026-09-03", 720], ["2026-09-03", 780], ["2026-09-03", 1140],   // saiu 19:00
      ["2026-09-04", 480], ["2026-09-04", 720], ["2026-09-04", 780],                         // ímpar
    ]);
    const d = (n: string) => e.dias.find((x) => x.data === `2026-09-${n}`)!;
    expect(d("01")).toMatchObject({ situacao: "ok", trabalhado: 480 });
    expect(d("02")).toMatchObject({ situacao: "atraso", atrasoMin: 20 });
    expect(d("03")).toMatchObject({ situacao: "extra", saldo: 120 });
    expect(d("04")).toMatchObject({ situacao: "impar", trabalhado: 240 });
    expect(d("08").situacao).toBe("sem_batida");     // terça útil sem nada
    expect(d("06").situacao).toBe("folga");          // domingo
    expect(d("07").situacao).toBe("feriado");        // 7 de setembro
    expect(e.totais.impares).toBe(1);
    expect(e.inconsistencias).toBeGreaterThan(2);
  });

  it("antes da admissão e depois do desligamento não é falta", () => {
    const e = comercial([], { admissao: "2026-09-15", afastamento: "2026-09-20" });
    expect(e.dias.find((x) => x.data === "2026-09-08")!.situacao).toBe("fora_contrato");
    expect(e.dias.find((x) => x.data === "2026-09-16")!.situacao).toBe("sem_batida");
    expect(e.dias.find((x) => x.data === "2026-09-22")!.situacao).toBe("fora_contrato");
  });

  it("dias do futuro ficam neutros", () => {
    const e = montarEspelho({ escala: esc("08:00-17:00 (1h)(8h)"), batidas: [], admissao: null, afastamento: null }, "2026-09", "2026-09-10");
    expect(e.dias.find((x) => x.data === "2026-09-15")!.situacao).toBe("futuro");
    // 01/09/2026 é terça: úteis até o dia 10 = 1,2,3,4,8,9,10 (o 7, segunda, é feriado).
    expect(e.totais.previsto).toBe(7 * 480);
  });

  it("12x36: dia sem batida não é falta; telefonista com 8 batidas soma os pares", () => {
    const e = montarEspelho({
      escala: esc("06:00-18:00(12x36)(1h)"), admissao: null, afastamento: null,
      batidas: [["2026-09-01", 365], ["2026-09-01", 752], ["2026-09-01", 812], ["2026-09-01", 1109]],
    }, "2026-09", "2026-09-30");
    expect(e.dias.find((x) => x.data === "2026-09-01")!.trabalhado).toBe(387 + 297);
    expect(e.dias.find((x) => x.data === "2026-09-02")!.situacao).toBe("folga");
    expect(e.totais.semBatida).toBe(0);
  });
});

describe("feriados e formato", () => {
  it("Sexta-feira Santa pela Páscoa", () => {
    expect(feriadosNacionais(2026).get("2026-04-03")).toBe("Sexta-feira Santa");
    expect(feriadosNacionais(2027).get("2027-03-26")).toBe("Sexta-feira Santa");
  });
  it("fmtHoras", () => {
    expect(fmtHoras(510)).toBe("8:30");
    expect(fmtHoras(-45)).toBe("−0:45");
    expect(fmtHoras(0)).toBe("0:00");
  });
});
