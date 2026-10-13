import { describe, it, expect } from "vitest";
import {
  prepararColaborador, avaliarDia, avaliarTodos, resumir, motivoDaSituacao, turnoDaJornada,
  estadoCobertura, statusContrato, agrupar, descoberto, serieDiaria, fmtMin, fmtDuracao,
  tempoSemCobertura, linkWhatsapp, difDias,
  type ColaboradorEfet, type Ocorrencia,
} from "@/lib/efetividade";

// =====================================================================
// Efetividade e Coberturas (branch local efetividade, mig 20261008000030).
// Escalas são textos reais da Senior; datas de outubro/2026
// (05/10 = segunda; 12/10 = feriado de N. Sra. Aparecida).
// =====================================================================

const col = (over: Partial<ColaboradorEfet> = {}): ColaboradorEfet => ({
  id: 1, empresa: 1, filial: 1037, contrato: "1037 - BENTO GONÇALVES", cadastro: 10, nome: "Fulano",
  cargo: "Servente", situacao: "Trabalhando", admissao: "2025-01-01", data_afastamento: null,
  posto_codigo: "PO-1", posto_nome: "Portaria Principal", telefone: "(54) 99999-1234",
  escala: { codigo: 1, descricao: "08:00-17:00 (1h)(8h)", h_semana: "44:00", h_mes: null, h_dsr: null },
  dias: [], ...over,
});

/** Batidas comerciais (08–12, 13–17) nos dias dados. */
const comercial = (...dias: string[]): [string, number[]][] => dias.map((d) => [d, [480, 720, 780, 1020]]);

const SINC = "2026-10-09";

describe("motivoDaSituacao / turno", () => {
  it("mapeia a situação da Senior", () => {
    expect(motivoDaSituacao("Trabalhando")).toBeNull();
    expect(motivoDaSituacao("Férias")).toBe("ferias");
    expect(motivoDaSituacao("Atestado (dias)")).toBe("atestado");
    expect(motivoDaSituacao("Atestado Filho")).toBe("atestado");
    expect(motivoDaSituacao("Auxílio Doença")).toBe("afastamento");
    expect(motivoDaSituacao("Licença Maternidade")).toBe("afastamento");
    expect(motivoDaSituacao("Demitido")).toBeNull();
  });
  it("turno pela entrada da escala", () => {
    expect(turnoDaJornada({ inicio: 7 * 60, flexivel: false })).toBe("manha");
    expect(turnoDaJornada({ inicio: 13 * 60 + 40, flexivel: false })).toBe("tarde");
    expect(turnoDaJornada({ inicio: 19 * 60, flexivel: false })).toBe("noite");
    expect(turnoDaJornada({ inicio: null, flexivel: false })).toBe("flexivel");
  });
});

describe("avaliarDia — escala fixa", () => {
  const p = prepararColaborador(col({ dias: comercial("2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-08") }));

  it("bateu ponto = presente, com a entrada", () => {
    const d = avaliarDia(p, "2026-10-06", SINC);
    expect(d.situacao).toBe("presente");
    expect(d.entrada).toBe(480);
    expect(d.atraso).toBe(0);
  });
  it("dia útil sem batida = falta", () => {
    expect(avaliarDia(p, "2026-10-07", SINC).situacao).toBe("falta");
    expect(avaliarDia(p, "2026-10-07", SINC).previsto).toBe(true);
  });
  it("fim de semana sem batida = folga (fora do previsto)", () => {
    const d = avaliarDia(p, "2026-10-04", SINC);
    expect(d.situacao).toBe("folga");
    expect(d.previsto).toBe(false);
  });
  it("feriado nacional não é falta", () => {
    const q = prepararColaborador(col({ dias: comercial("2026-10-08", "2026-10-09") }));
    expect(avaliarDia(q, "2026-10-12", "2026-10-13").situacao).toBe("feriado");
  });
  it("depois do último dia sincronizado = aguardando ponto", () => {
    const d = avaliarDia(p, "2026-10-13", SINC);
    expect(d.situacao).toBe("aguardando");
    expect(d.previsto).toBe(true);
  });
  it("atraso além da tolerância", () => {
    const q = prepararColaborador(col({ dias: [["2026-10-06", [520, 720, 780, 1020]]] }));
    expect(avaliarDia(q, "2026-10-06", SINC).atraso).toBe(30);   // 08:40 − 08:00 − 10
  });
  it("sem batida nenhuma em 14 dias = sem registro (não usa relógio), não falta", () => {
    const q = prepararColaborador(col({ dias: [] }));
    const d = avaliarDia(q, "2026-10-07", SINC);
    expect(d.situacao).toBe("sem_registro");
    expect(d.previsto).toBe(false);
  });
  it("fora do contrato antes da admissão e depois do desligamento", () => {
    const novo = prepararColaborador(col({ admissao: "2026-10-08", dias: comercial("2026-10-08") }));
    expect(avaliarDia(novo, "2026-10-07", SINC).situacao).toBe("fora_contrato");
    const saiu = prepararColaborador(col({ situacao: "Demitido", data_afastamento: "2026-10-05", dias: comercial("2026-10-02") }));
    expect(avaliarDia(saiu, "2026-10-07", SINC).situacao).toBe("fora_contrato");
  });
});

describe("avaliarDia — afastados", () => {
  it("férias desde a data de afastamento: ausência planejada, fora do previsto", () => {
    const p = prepararColaborador(col({ situacao: "Férias", data_afastamento: "2026-10-05", dias: comercial("2026-10-01", "2026-10-02") }));
    expect(avaliarDia(p, "2026-10-02", SINC).situacao).toBe("presente");
    const d = avaliarDia(p, "2026-10-06", SINC);
    expect(d.situacao).toBe("ferias");
    expect(d.previsto).toBe(false);
  });
  it("atestado entra no previsto (ausência a cobrir)", () => {
    const p = prepararColaborador(col({ situacao: "Atestado (dias)", data_afastamento: "2026-10-06", dias: comercial("2026-10-05") }));
    const d = avaliarDia(p, "2026-10-06", SINC);
    expect(d.situacao).toBe("atestado");
    expect(d.previsto).toBe(true);
  });
  it("antes da data de afastamento vale a regra normal", () => {
    const p = prepararColaborador(col({ situacao: "Auxílio Doença", data_afastamento: "2026-10-08", dias: comercial("2026-10-05") }));
    expect(avaliarDia(p, "2026-10-06", SINC).situacao).toBe("falta");
    expect(avaliarDia(p, "2026-10-08", SINC).situacao).toBe("afastamento");
  });
  it("afastado que bateu ponto conta como presente", () => {
    const p = prepararColaborador(col({ situacao: "Férias", data_afastamento: "2026-10-01", dias: comercial("2026-10-06") }));
    expect(avaliarDia(p, "2026-10-06", SINC).situacao).toBe("presente");
  });
});

describe("avaliarDia — 12x36", () => {
  const esc = { codigo: 2, descricao: "07:00-19:00(1hIND)12X36 - 220h", h_semana: "36:00", h_mes: null, h_dsr: null };
  // Trabalha em dias alternados: 01, 03, 05, 07 ...
  const p = prepararColaborador(col({ escala: esc, dias: [["2026-10-01", [420, 1140]], ["2026-10-03", [420, 1140]], ["2026-10-05", [420, 1140]]] }));

  it("dia par do ciclo sem batida = falta; dia ímpar = folga", () => {
    expect(avaliarDia(p, "2026-10-07", SINC).situacao).toBe("falta");
    expect(avaliarDia(p, "2026-10-06", SINC).situacao).toBe("folga");
    expect(avaliarDia(p, "2026-10-08", SINC).situacao).toBe("folga");
  });
  it("12x36 trabalha em feriado", () => {
    const q = prepararColaborador(col({ escala: esc, dias: [["2026-10-08", [420, 1140]], ["2026-10-10", [420, 1140]]] }));
    expect(avaliarDia(q, "2026-10-12", "2026-10-13").situacao).toBe("falta");
  });
  it("noturno: a saída da manhã seguinte não vira presença no dia de folga", () => {
    const not = { codigo: 3, descricao: "19:00-07:00(1hIND)12X36 - 220h", h_semana: "36:00", h_mes: null, h_dsr: null };
    const q = prepararColaborador(col({ escala: not, dias: [["2026-10-05", [1140]], ["2026-10-06", [420]], ["2026-10-07", [1140]], ["2026-10-08", [420]]] }));
    expect(avaliarDia(q, "2026-10-05", SINC).situacao).toBe("presente");
    expect(avaliarDia(q, "2026-10-06", SINC).situacao).toBe("folga");
    expect(avaliarDia(q, "2026-10-07", SINC).situacao).toBe("presente");
    expect(avaliarDia(q, "2026-10-09", SINC).situacao).toBe("falta");
  });
});

describe("avaliarDia — revezamento 6x1", () => {
  const esc = { codigo: 4, descricao: "07:00-13:20 6X1", h_semana: "36:00", h_mes: null, h_dsr: null };
  it("primeiro dia sem batida é folga; o segundo seguido é falta", () => {
    const p = prepararColaborador(col({ escala: esc, dias: [["2026-10-01", [420, 800]], ["2026-10-02", [420, 800]], ["2026-10-03", [420, 800]]] }));
    expect(avaliarDia(p, "2026-10-04", SINC).situacao).toBe("folga");
    expect(avaliarDia(p, "2026-10-05", SINC).situacao).toBe("falta");
  });
});

const oc = (over: Partial<Ocorrencia>): Ocorrencia => ({
  id: 1, data: "2026-10-07", empresa: 1, filial: 1037, contrato: null, posto_codigo: null, posto_nome: null, turno: null,
  horario_previsto: 480, empregado_id: 1, empregado_nome: "Fulano", motivo: "falta", origem: "ponto",
  substituto_tipo: null, substituto_empregado_id: null, substituto_diarista_id: null, substituto_nome: null, substituto_telefone: null,
  status: "sem_cobertura", acionado_em: null, aceito_em: null, deslocamento_em: null, chegada_em: null, ponto_em: null,
  encerrado_em: null, acionado_por_nome: null, observacao: null, created_by_nome: null,
  created_at: "2026-10-07T10:00:00Z", updated_at: "2026-10-07T10:00:00Z", ...over,
});

describe("coberturas e agregação", () => {
  it("estado da cobertura", () => {
    expect(estadoCobertura(null)).toBe("descoberto");
    expect(estadoCobertura({ status: "sem_cobertura" })).toBe("descoberto");
    expect(estadoCobertura({ status: "em_deslocamento" })).toBe("em_andamento");
    expect(estadoCobertura({ status: "ponto_confirmado" })).toBe("coberto");
    expect(estadoCobertura({ status: "nao_se_aplica" })).toBe("dispensado");
    expect(estadoCobertura({ status: "nao_realizada" })).toBe("descoberto");
  });

  it("resumo do contrato: previsto, presentes, efetividade, descobertos", () => {
    const presentes = [2, 3, 4, 5].map((id) => prepararColaborador(col({ id, dias: comercial("2026-10-06", "2026-10-07") })));
    const faltou = prepararColaborador(col({ id: 1, dias: comercial("2026-10-06") }));
    const ferias = prepararColaborador(col({ id: 6, situacao: "Férias", data_afastamento: "2026-10-01", dias: [] }));
    const semRelogio = prepararColaborador(col({ id: 7, dias: [] }));
    const linhas = avaliarTodos([...presentes, faltou, ferias, semRelogio], "2026-10-07", SINC, []);
    const r = resumir(linhas.map((l) => l.dia));
    expect(r).toMatchObject({ previsto: 5, presentes: 4, faltas: 1, ferias: 1, semRegistro: 1 });
    expect(r.efetividade).toBeCloseTo(0.8);
    expect(linhas.filter(descoberto)).toHaveLength(1);

    // A falta coberta (ponto confirmado) deixa de ser descoberta.
    const coberto = avaliarTodos([...presentes, faltou], "2026-10-07", SINC, [oc({ status: "ponto_confirmado", substituto_nome: "Beltrano" })]);
    const g = agrupar(coberto, () => "x").get("x")!;
    expect(g.descobertos).toBe(0);
    expect(g.coberturas).toBe(1);
  });

  it("falta avisada à mão para hoje (ponto não chegou) entra como ausência", () => {
    const p = prepararColaborador(col({ dias: comercial("2026-10-08", "2026-10-09") }));
    const [l] = avaliarTodos([p], "2026-10-13", SINC, [oc({ data: "2026-10-13", origem: "manual" })]);
    expect(l.dia.situacao).toBe("falta");
    expect(l.cobertura).toBe("descoberto");
  });

  it("status do contrato", () => {
    expect(statusContrato({ efetividade: 0.98, descobertos: 0 })).toBe("normal");
    expect(statusContrato({ efetividade: 0.98, descobertos: 1 })).toBe("atencao");
    expect(statusContrato({ efetividade: 0.93, descobertos: 0 })).toBe("atencao");
    expect(statusContrato({ efetividade: 0.9, descobertos: 0 })).toBe("critico");
    expect(statusContrato({ efetividade: 0.99, descobertos: 6 })).toBe("critico");
  });

  it("série diária para no último dia sincronizado", () => {
    const p = prepararColaborador(col({ dias: comercial("2026-10-05", "2026-10-06", "2026-10-07") }));
    const s = serieDiaria([p], "2026-10-05", "2026-10-31", "2026-10-08");
    expect(s.map((x) => x.data)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(s[3].faltas).toBe(1);
  });
});

describe("formatação", () => {
  it("minuto do dia", () => {
    expect(fmtMin(420)).toBe("07:00");
    expect(fmtMin(1500)).toBe("01:00 (+1)");
    expect(fmtMin(-5)).toBe("23:55 (−1)");
    expect(fmtMin(null)).toBe("—");
  });
  it("duração", () => {
    expect(fmtDuracao(45)).toBe("45 min");
    expect(fmtDuracao(135)).toBe("2h 15min");
    expect(fmtDuracao(120)).toBe("2h");
    expect(fmtDuracao(60 * 50)).toBe("2d 2h");
  });
  it("tempo sem cobertura só no dia corrente", () => {
    const agora = new Date("2026-10-07T10:15:00");
    expect(tempoSemCobertura("2026-10-07", 480, null, agora)).toBe(135);
    expect(tempoSemCobertura("2026-10-06", 480, null, agora)).toBeNull();
    expect(tempoSemCobertura("2026-10-07", 480, { status: "aguardando_ponto", chegada_em: new Date("2026-10-07T08:40:00").toISOString(), ponto_em: null, created_at: "" }, agora)).toBe(40);
  });
  it("whatsapp e diferença de dias", () => {
    expect(linkWhatsapp("(54) 99999-1234")).toBe("https://wa.me/5554999991234");
    expect(linkWhatsapp("5554999991234")).toBe("https://wa.me/5554999991234");
    expect(linkWhatsapp("123")).toBeNull();
    expect(difDias("2026-10-07", "2026-10-01")).toBe(6);
  });
});
