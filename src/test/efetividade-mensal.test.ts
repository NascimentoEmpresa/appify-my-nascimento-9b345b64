import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { agoraBrasilia, prepararColaborador, resumir, type ColaboradorEfet, type ContratoEfet, type Ocorrencia } from "@/lib/efetividade";
import {
  apurarMes, assinaturaOcorrencias, faixaEfetividade, taxaFaltas, filtrarApuracao, mesesAte, mesPadrao, montarPlanilhaEfetividade, porContrato, recorteDoMes,
  rotuloMes, serieDoMes, somaMeses, somarResumos, totalDoMes, ultimoDiaDoMes, FILTROS_VAZIOS, faltososDe, horaDaBatida,
} from "@/lib/efetividadeMensal";

// =====================================================================
// Efetividade Mensal (6ª aba da Efetividade e Coberturas, 21/10/2026).
// Datas de setembro/outubro de 2026 (01/10 = quinta; 05/10 = segunda;
// 12/10 = feriado de N. Sra. Aparecida).
// =====================================================================

describe("recorteDoMes", () => {
  it("mês fechado = o mês inteiro", () => {
    expect(recorteDoMes("2026-09", "2026-10-21")).toEqual({ mes: "2026-09", ini: "2026-09-01", fim: "2026-09-30", fechado: true, dias: 30 });
    expect(recorteDoMes("2026-02", "2026-10-21")?.fim).toBe("2026-02-28");
    expect(recorteDoMes("2028-02", "2028-03-05")?.fim).toBe("2028-02-29");
    expect(recorteDoMes("2025-12", "2026-01-15")).toMatchObject({ ini: "2025-12-01", fim: "2025-12-31", fechado: true });
  });

  it("mês corrente vai do dia 1 até ONTEM", () => {
    expect(recorteDoMes("2026-10", "2026-10-21")).toEqual({ mes: "2026-10", ini: "2026-10-01", fim: "2026-10-20", fechado: false, dias: 20 });
    expect(recorteDoMes("2026-10", "2026-10-02")).toMatchObject({ ini: "2026-10-01", fim: "2026-10-01", dias: 1 });
    // No último dia do mês, ainda não é fechado: vai até a véspera.
    expect(recorteDoMes("2026-10", "2026-10-31")).toMatchObject({ fim: "2026-10-30", fechado: false });
  });

  it("no dia 1º o mês corrente não tem nada; futuro e lixo também não", () => {
    expect(recorteDoMes("2026-10", "2026-10-01")).toBeNull();
    expect(recorteDoMes("2026-11", "2026-10-21")).toBeNull();
    expect(recorteDoMes("2026-13", "2026-10-21")).toBeNull();
    expect(recorteDoMes("out", "2026-10-21")).toBeNull();
  });

  it("o painel abre no mês corrente, ou no anterior no dia 1º", () => {
    expect(mesPadrao("2026-10-21")).toBe("2026-10");
    expect(mesPadrao("2026-10-01")).toBe("2026-09");
    expect(mesPadrao("2027-01-01")).toBe("2026-12");
  });

  it("meses e rótulos", () => {
    expect(ultimoDiaDoMes("2026-04")).toBe("2026-04-30");
    expect(somaMeses("2026-01", -1)).toBe("2025-12");
    expect(somaMeses("2026-11", 3)).toBe("2027-02");
    expect(mesesAte("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(rotuloMes("2026-10")).toBe("out/2026");
  });
});

describe("faixaEfetividade", () => {
  it("usa os cortes do status do contrato (95 / 91)", () => {
    expect(faixaEfetividade(0.95)).toBe("normal");
    expect(faixaEfetividade(0.93)).toBe("atencao");
    expect(faixaEfetividade(0.91)).toBe("atencao");
    expect(faixaEfetividade(0.9)).toBe("critico");
    expect(faixaEfetividade(null)).toBe("sem_dados");
  });
});

// ---- Apuração --------------------------------------------------------------

const col = (over: Partial<ColaboradorEfet> = {}): ColaboradorEfet => ({
  id: 1, empresa: 1, filial: 1037, contrato: "1037 - BENTO GONÇALVES", cadastro: 10, nome: "Fulano",
  cargo: "Servente", situacao: "Trabalhando", admissao: "2025-01-01", data_afastamento: null,
  posto_codigo: "PO-1", posto_nome: "Portaria Principal", telefone: null,
  escala: { codigo: 1, descricao: "08:00-17:00 (1h)(8h)", h_semana: "44:00", h_mes: null, h_dsr: null },
  dias: [], ...over,
});
const comercial = (...dias: string[]): [string, number[]][] => dias.map((d) => [d, [480, 720, 780, 1020]]);
// Semana de 28/09 a 09/10 (dias úteis); 01/10 e 02/10 = qui/sex.
const UTEIS = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const SINC = "2026-10-09";

const contrato = (over: Partial<ContratoEfet> = {}): ContratoEfet => ({
  empresa: 1, filial: 1037, nome: "1037 - BENTO GONÇALVES", empresa_nome: "NASCIMENTO", ativos: 2, endereco: null, cep: null,
  encarregados: [{ id: 900, nome: "Encarregado A", telefone: null }], ...over,
});

const ana = prepararColaborador(col({ id: 1, nome: "Ana", dias: comercial(...UTEIS) }));
// Beto faltou na segunda 05/10 e na quarta 07/10.
const beto = prepararColaborador(col({ id: 2, nome: "Beto", cadastro: 20, cargo: "Porteiro", dias: comercial(...UTEIS.filter((d) => d !== "2026-10-05" && d !== "2026-10-07")) }));
// Outro contrato, outra empresa.
const caio = prepararColaborador(col({ id: 3, nome: "Caio", empresa: 2, filial: 5, contrato: "5 - UFRGS", posto_codigo: "PO-9", posto_nome: "Guarita", dias: comercial(...UTEIS) }));

const oc = (over: Partial<Ocorrencia>): Ocorrencia => ({
  id: 1, data: "2026-10-05", empresa: 1, filial: 1037, contrato: null, posto_codigo: null, posto_nome: null, turno: null,
  horario_previsto: null, empregado_id: 2, empregado_nome: "Beto", motivo: "falta", origem: "ponto", substituto_tipo: null,
  substituto_empregado_id: null, substituto_diarista_id: null, substituto_nome: null, substituto_telefone: null,
  status: "ponto_confirmado", acionado_em: null, aceito_em: null, deslocamento_em: null, chegada_em: null, ponto_em: null,
  encerrado_em: null, acionado_por_nome: null, observacao: null, created_by_nome: null, created_at: "2026-10-05T10:00:00Z",
  updated_at: "2026-10-05T10:00:00Z", ...over,
});

describe("apurarMes", () => {
  const ap = apurarMes([ana, beto, caio], "2026-10-01", "2026-10-09", SINC, [oc({})]);

  it("conta os dias pela regra do dia (avaliarTodos) e soma por colaborador", () => {
    const b = ap.find((a) => a.p.c.id === 2)!;
    expect(b.resumo.faltas).toBe(2);
    expect(b.resumo.presentes).toBe(5);
    expect(b.faltasEm).toEqual(["2026-10-05", "2026-10-07"]);
    expect(b.coberturas).toBe(1);   // 05/10 coberta
    expect(b.descobertos).toBe(1);  // 07/10 sem ninguém
    expect(b.resumo.efetividade).toBeCloseTo(5 / 7);
    expect(ap.find((a) => a.p.c.id === 1)!.resumo.efetividade).toBe(1);
  });

  it("a soma dos colaboradores é igual ao resumir() de todos os dias juntos", () => {
    const t = totalDoMes(ap);
    const direto = resumir(ap.flatMap((a) => a.dias));
    expect({ ...t, coberturas: undefined, descobertos: undefined, colaboradores: undefined }).toEqual({ ...direto, coberturas: undefined, descobertos: undefined, colaboradores: undefined });
    expect(t.efetividade).toBeCloseTo(19 / 21);
    expect(t.colaboradores).toBe(3);
  });

  it("quem faltou (clique em Faltas): só quem tem falta, mais faltas primeiro, com a última marcação", () => {
    // Davi bateu até 01/10 e sumiu: faltas de 02/10 em diante (dias úteis).
    const davi = prepararColaborador(col({ id: 5, nome: "Davi", dias: comercial(...UTEIS.filter((d) => d <= "2026-10-01")) }));
    const ap2 = apurarMes([ana, beto, davi], "2026-10-01", "2026-10-09", SINC, []);
    const f = faltososDe(ap2, "2026-10-09");
    expect(f.map((x) => x.a.p.c.nome)).toEqual(["Davi", "Beto"]);
    expect(f[0].a.faltasEm).toEqual(["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(f[0].ultimaMarcacao).toBe("2026-10-01");
    expect(f[1].ultimaMarcacao).toBe("2026-10-09");
    // Uma marcação só no dia já não é falta (regra 7): Beto com uma batida em 07/10.
    const beto1 = prepararColaborador(col({ id: 2, nome: "Beto", dias: [...comercial(...UTEIS.filter((d) => d !== "2026-10-05" && d !== "2026-10-07")), ["2026-10-07", [600]]] }));
    expect(apurarMes([beto1], "2026-10-01", "2026-10-09", SINC, [])[0].faltasEm).toEqual(["2026-10-05"]);
  });

  it("hora da batida (noturno passa de 1440)", () => {
    expect(horaDaBatida(478)).toBe("07:58");
    expect(horaDaBatida(1440 + 330)).toBe("05:30");
  });

  it("quem não estava no contrato no mês some", () => {
    const novo = prepararColaborador(col({ id: 4, admissao: "2026-11-01" }));
    expect(apurarMes([novo], "2026-10-01", "2026-10-09", SINC, [])).toEqual([]);
  });

  it("dia depois do sincronizado fica aguardando e não derruba a efetividade", () => {
    const r = apurarMes([ana], "2026-10-01", "2026-10-13", SINC, [])[0].resumo;
    expect(r.aguardando).toBe(1); // 13/10 (12/10 é feriado)
    expect(r.efetividade).toBe(1);
  });

  it("série diária", () => {
    const s = serieDoMes(ap, "2026-10-01", "2026-10-09");
    expect(s).toHaveLength(9);
    expect(s.find((x) => x.data === "2026-10-05")!.faltas).toBe(1);
    expect(s.find((x) => x.data === "2026-10-03")!.previsto).toBe(0); // sábado
  });

  it("somarResumos sem previsto → efetividade null", () => {
    expect(somarResumos([]).efetividade).toBeNull();
  });
});

describe("filtrarApuracao", () => {
  const ap = apurarMes([ana, beto, caio], "2026-10-01", "2026-10-09", SINC, []);
  const contratos = new Map([["1-1037", contrato()], ["2-5", contrato({ empresa: 2, filial: 5, nome: "5 - UFRGS", encarregados: [] })]]);
  const ids = (f: Partial<typeof FILTROS_VAZIOS>) => filtrarApuracao(ap, { ...FILTROS_VAZIOS, ...f }, contratos).map((a) => a.p.c.id);

  it("contratos (multi), empresa, posto, cargo, encarregado e busca", () => {
    expect(ids({})).toEqual([1, 2, 3]);
    expect(ids({ contratos: ["5 - UFRGS"] })).toEqual([3]);
    expect(ids({ contratos: ["5 - UFRGS", "1037 - BENTO GONÇALVES"] })).toEqual([1, 2, 3]);
    expect(ids({ empresa: "1" })).toEqual([1, 2]);
    expect(ids({ posto: "2-5-PO-9" })).toEqual([3]);
    expect(ids({ cargo: "Porteiro" })).toEqual([2]);
    expect(ids({ encarregado: "900" })).toEqual([1, 2]);
    expect(ids({ busca: "beto" })).toEqual([2]);
    expect(ids({ busca: "20" })).toEqual([2]);
  });

  it("faixa é do contrato: Bento (12/14 = 85,7%) é crítico, UFRGS (100%) normal", () => {
    expect(ids({ faixa: "critico" })).toEqual([1, 2]);
    expect(ids({ faixa: "normal" })).toEqual([3]);
    expect(ids({ faixa: "atencao" })).toEqual([]);
  });

  it("agrupa por contrato", () => {
    const c = porContrato(ap);
    expect(c.map((x) => [x.rotulo, x.colaboradores, x.faixa])).toEqual([["1037 - BENTO GONÇALVES", 2, "critico"], ["5 - UFRGS", 1, "normal"]]);
  });
});

describe("montarPlanilhaEfetividade", () => {
  it("monta as abas do relatório com o recorte filtrado", () => {
    const ap = apurarMes([ana, beto, caio], "2026-10-01", "2026-10-09", SINC, []);
    const contratos = new Map([["1-1037", contrato()], ["2-5", contrato({ empresa: 2, filial: 5, nome: "5 - UFRGS", encarregados: [] })]]);
    const recorte = recorteDoMes("2026-10", "2026-10-10")!;
    const so = filtrarApuracao(ap, { ...FILTROS_VAZIOS, empresa: "1" }, contratos);
    const wb = montarPlanilhaEfetividade({
      recorte, sincronizadoAte: SINC, filtrosTexto: ["Empresa: 1"], apuracao: so, contratos,
      evolucao: [{ recorte, total: totalDoMes(so) }],
    });
    expect(wb.SheetNames).toEqual(["Resumo", "Contratos", "Postos", "Colaboradores", "Por dia", "Evolução mensal"]);
    const linhas = (aba: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[aba]);
    expect(linhas("Contratos")).toHaveLength(1);
    expect(linhas("Contratos")[0]["Encarregado(s)"]).toBe("Encarregado A");
    const colabs = linhas("Colaboradores");
    expect(colabs.map((c) => c.Nome)).toEqual(["Ana", "Beto"]);
    expect(colabs[1]["Dias de falta"]).toBe("05/10, 07/10");
    expect(colabs[1].Efetividade).toBeCloseTo(5 / 7);
    expect(linhas("Por dia")).toHaveLength(9);
    const resumo = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Resumo, { header: 1 });
    expect(resumo[2][1]).toBe("01/10/2026 a 09/10/2026 (mês corrente, até ontem)");
  });
});

describe("peças de desempenho e do Excel", () => {
  it("agoraBrasilia em cache por minuto continua certo quando o minuto muda", () => {
    expect(agoraBrasilia(new Date("2026-10-21T14:59:30Z"))).toEqual({ data: "2026-10-21", minuto: 11 * 60 + 59 });
    expect(agoraBrasilia(new Date("2026-10-21T14:59:50Z"))).toEqual({ data: "2026-10-21", minuto: 11 * 60 + 59 });
    expect(agoraBrasilia(new Date("2026-10-21T15:00:00Z"))).toEqual({ data: "2026-10-21", minuto: 12 * 60 });
    expect(agoraBrasilia(new Date("2026-10-22T02:30:00Z"))).toEqual({ data: "2026-10-21", minuto: 23 * 60 + 30 });
    // O retorno é cópia: mexer nele não estraga o cache.
    const a = agoraBrasilia(new Date("2026-10-22T02:30:00Z")); a.data = "x";
    expect(agoraBrasilia(new Date("2026-10-22T02:30:10Z")).data).toBe("2026-10-21");
  });

  it("assinatura das ocorrências: só as do mês, e muda com o status", () => {
    const r = { ini: "2026-10-01", fim: "2026-10-31" };
    const base = [oc({ id: 1 }), oc({ id: 2, data: "2026-09-30" })];
    expect(assinaturaOcorrencias(base, r)).toBe(assinaturaOcorrencias([oc({ id: 1 })], r));
    expect(assinaturaOcorrencias([oc({ id: 1, status: "acionado" })], r)).not.toBe(assinaturaOcorrencias([oc({ id: 1 })], r));
    // Ordem da lista não importa.
    expect(assinaturaOcorrencias([oc({ id: 3, data: "2026-10-07" }), oc({ id: 1 })], r)).toBe(assinaturaOcorrencias([oc({ id: 1 }), oc({ id: 3, data: "2026-10-07" })], r));
  });

  it("taxa de faltas usa o mesmo denominador da efetividade", () => {
    const ap = apurarMes([beto], "2026-10-01", "2026-10-13", SINC, []);
    const t = totalDoMes(ap);
    expect(t.aguardando).toBe(1);
    expect(taxaFaltas(t)).toBeCloseTo(2 / 7);
    expect(taxaFaltas(totalDoMes([]))).toBeNull();
  });

  it("Excel traz encarregado por colaborador, taxa de faltas e contratos por faixa", () => {
    const ap = apurarMes([ana, beto, caio], "2026-10-01", "2026-10-09", SINC, []);
    const contratos = new Map([["1-1037", contrato()], ["2-5", contrato({ empresa: 2, filial: 5, nome: "5 - UFRGS", encarregados: [] })]]);
    const recorte = recorteDoMes("2026-10", "2026-10-10")!;
    const wb = montarPlanilhaEfetividade({ recorte, sincronizadoAte: SINC, filtrosTexto: [], apuracao: ap, contratos, evolucao: [] });
    expect(wb.SheetNames).not.toContain("Evolução mensal");
    const contr = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Contratos);
    const bento = contr.find((c) => c.Contrato === "1037 - BENTO GONÇALVES")!;
    expect(bento["Taxa de faltas"]).toBeCloseTo(2 / 14);
    expect(bento.Faixa).toBe("< 91%");
    const colabs = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Colaboradores);
    expect(colabs.find((c) => c.Nome === "Ana")!["Encarregado(s)"]).toBe("Encarregado A");
    const resumo = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Resumo, { header: 1 });
    const linha = (rot: string) => resumo.find((l) => String(l[0]).trim() === rot)?.[1];
    expect(linha("Contratos")).toBe(2);
    expect(linha("< 91%")).toBe(1);
    expect(linha("≥ 95% (meta)")).toBe(1);
    expect(linha("Filtros")).toBe("Nenhum (todos os contratos)");
    // Efetividade sai como número com formato de %, não como texto.
    const celEf = Object.entries(wb.Sheets.Resumo).find(([, v]) => (v as XLSX.CellObject).v === resumo.find((l) => l[0] === "Efetividade")![1]);
    expect((celEf![1] as XLSX.CellObject).z).toBe("0.0%");
  });
});
