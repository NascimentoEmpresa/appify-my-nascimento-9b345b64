import { describe, expect, it } from "vitest";
import {
  anexarFaturamento, calcularImpacto, consolidar, dataPlanilha, diasDoAfastamento, diasPorCompetencia, fimDoAfastamento, horaPlanilha,
  interpretarObservacao, lerPlanilhaTelemedicina, recortarAoPeriodo, relatorioMensal, type AfastamentoItem,
} from "@/lib/sst/afastamentos";

// SST › Afastamentos e Telemedicina (mig 20261029001750). Casos tirados da
// PLANILHA TELEMEDICINA.xlsx e do RELATÓRIO MENSAL ATESTADOS.xlsx.
const HOJE = "2026-10-28";
const base = (x: Partial<AfastamentoItem>): AfastamentoItem => ({
  id: 1, protocolo: "AFA-2026-00001", empregado_id: 10, nome: "MARIA TESTE", cpf: null, tipo: "atestado",
  data_inicio: "2026-06-10", dias_atestado: 5, dias_apos_tele: null, dias_considerados: 5, origem: "manual",
  tele_status: "nao_avaliado", tele_data: null, tele_resultado: null, assinatura: null, ponto: null,
  retorno_status: "aguardando", retornou_em: null, encarregado_nome: null,
  contrato_id: "c1", contrato_nome: "UFRGS LIMPEZA 020.2022", contrato_planilha: null,
  posto_senior: null, posto_planilha: "SERVENTE 44H", cargo: "SERVENTE DE LIMPEZA", escala: null,
  rt_no_contrato: 2, cancelado: false, dias_cobertos: 0, dias_rt: 0, custo_cobertura: 0, ...x,
});

describe("dias do afastamento", () => {
  it("usa os dias da telemedicina quando houver", () => {
    expect(diasDoAfastamento(base({ dias_considerados: 4 }), HOJE)).toBe(4);
    expect(diasDoAfastamento(base({ dias_considerados: 0 }), HOJE)).toBe(0);
  });
  it("em aberto conta até hoje", () => {
    expect(diasDoAfastamento(base({ data_inicio: "2026-10-26", dias_considerados: null }), HOJE)).toBe(3);
  });
  it("fim e divisão por competência", () => {
    const a = base({ data_inicio: "2026-06-28", dias_considerados: 6 });
    expect(fimDoAfastamento(a, HOJE)).toBe("2026-07-03");
    expect(diasPorCompetencia(a, HOJE)).toEqual({ "2026-06": 3, "2026-07": 3 });
  });
});

describe("impacto financeiro", () => {
  // Posto de R$ 6.000/mês (R$ 200/dia), custo R$ 5.400 (margem R$ 20/dia), salário R$ 1.800.
  const fin = { valor_mensal_posto: 6000, custo_mensal_posto: 5400, salario: 1800 };

  it("sem cobertura: perda estimada = dias × valor/dia", () => {
    const i = calcularImpacto(base({ ...fin }), HOJE);
    expect(i.valorDiaPosto).toBe(200);
    expect(i.diasDescobertos).toBe(5);
    expect(i.perdaReceita).toBe(1000);
    expect(i.perdaEstimada).toBe(true);
    expect(i.impactoTotal).toBe(1000);
    expect(i.margemPrevista).toBeCloseTo(100);
    expect(i.margemApurada).toBeCloseTo(-900);
    expect(i.custoTitularEmpresa).toBe(300);
  });

  it("coberto 3 de 5 dias com R$ 450 de diárias", () => {
    const i = calcularImpacto(base({ ...fin, dias_cobertos: 3, custo_cobertura: 450 }), HOJE);
    expect(i.diasDescobertos).toBe(2);
    expect(i.perdaReceita).toBe(400);
    expect(i.impactoTotal).toBe(850);
  });

  it("glosa informada substitui a estimada", () => {
    const i = calcularImpacto(base({ ...fin, glosa_valor: 120 }), HOJE);
    expect(i.perdaReceita).toBe(120);
    expect(i.perdaEstimada).toBe(false);
  });

  it("titular: a empresa paga só até 15 dias", () => {
    expect(calcularImpacto(base({ ...fin, dias_atestado: 60, dias_considerados: 60 }), HOJE).custoTitularEmpresa).toBe(900);
  });

  it("telemedicina: 60 → 24 dias evita 36 dias de posto", () => {
    const i = calcularImpacto(base({ ...fin, dias_atestado: 60, dias_apos_tele: 24, dias_considerados: 24, tele_status: "realizada" }), HOJE);
    expect(i.diasEvitados).toBe(36);
    expect(i.economiaTelemedicina).toBe(7200);
  });

  it("sem valor do posto (sem financeiro ou sem planilha): só o custo de cobertura", () => {
    const i = calcularImpacto(base({ custo_cobertura: 300, dias_cobertos: 2 }), HOJE);
    expect(i.valorDiaPosto).toBeNull();
    expect(i.perdaReceita).toBeNull();
    expect(i.impactoTotal).toBeNull();
    expect(i.custoCobertura).toBe(300);
  });
});

describe("consolidação", () => {
  const itens = [
    base({ id: 1, empregado_id: 1, nome: "ANA", valor_mensal_posto: 6000, custo_mensal_posto: 5400, dias_cobertos: 5 }),
    base({ id: 2, empregado_id: 2, nome: "BIA", valor_mensal_posto: 3000, custo_mensal_posto: 2700, data_inicio: "2026-06-29", dias_considerados: 4, dias_atestado: 4 }),
    base({ id: 3, empregado_id: 1, nome: "ANA", contrato_id: "c2", contrato_nome: "DMAE", posto_planilha: "PORTEIRO", cancelado: true }),
  ];

  it("por contrato soma e ignora cancelado", () => {
    const l = consolidar(itens, "contrato", HOJE);
    expect(l).toHaveLength(1);
    expect(l[0].afastamentos).toBe(2);
    expect(l[0].dias).toBe(9);
    expect(l[0].perdaReceita).toBe(400); // BIA: 4 dias × R$ 100
  });

  it("por competência divide quem atravessa o mês", () => {
    const l = consolidar(itens, "competencia", HOJE);
    expect(l.map((x) => [x.chave, x.dias])).toEqual([["2026-06", 7], ["2026-07", 2]]);
    expect(l.find((x) => x.chave === "2026-07")?.afastamentos).toBe(0);
  });

  it("por colaborador", () => {
    expect(consolidar(itens, "colaborador", HOJE).map((x) => x.rotulo).sort()).toEqual(["ANA", "BIA"]);
  });
});

describe("relatório mensal (formato da planilha de hoje)", () => {
  it("quantidade, soma de dias, avaliados e não avaliados por prazo", () => {
    const r = relatorioMensal([
      base({ id: 1, dias_atestado: 3, tele_status: "realizada" }),
      base({ id: 2, dias_atestado: 4, tele_status: "nao_avaliado_prazo" }),
      base({ id: 3, dias_atestado: 2, tele_status: "nao_avaliado" }),
    ], HOJE);
    expect(r).toEqual([{ competencia: "2026-06", contrato: "UFRGS LIMPEZA 020.2022", quantidade: 3, somaDias: 9,
      avaliadosTele: 1, naoAvaliadosPrazo: 1, diasNaoAvaliados: 4, diasEvitados: 0 }]);
  });
});

describe("leitura da PLANILHA TELEMEDICINA", () => {
  it("datas e horários do Excel", () => {
    expect(dataPlanilha(46090)).toBe("2026-03-09");
    expect(dataPlanilha("3/9/26")).toBe("2026-03-09");
    expect(dataPlanilha("-")).toBeNull();
    expect(horaPlanilha(0.4166666666666667)).toBe("10:00");
    expect(horaPlanilha("9:30")).toBe("09:30");
  });

  it("observação vira campos", () => {
    expect(interpretarObservacao("REDUZIU PARA 4 DIAS/ ENCAMINHADO PARA ASSINATURA", 7, null))
      .toMatchObject({ tele_resultado: "reduzido", dias_apos_tele: 4, assinatura: "encaminhado" });
    expect(interpretarObservacao("DIMINUI DE 5 PARA 3 DIAS ", 5, null)).toMatchObject({ dias_apos_tele: 3, tele_resultado: "reduzido" });
    expect(interpretarObservacao("ENCAMINHADO PARA ASSINATURA / REDUZIDO A ZERO (APENAS COMPARECIMENTO)", 2, null))
      .toMatchObject({ tele_resultado: "zerado", dias_apos_tele: 0 });
    expect(interpretarObservacao("NÃO COMPARECEU AOS AGENDAMENTOS", 3, null)).toMatchObject({ tele_status: "nao_compareceu" });
    expect(interpretarObservacao("COLABORADOR NÃO RETORNOU AO TRABALHO/ATESTADO SEM ASSINATURA/DEMITIDO", 3, null))
      .toMatchObject({ assinatura: "sem_assinatura", retorno_status: "desligado" });
    expect(interpretarObservacao(null, 3, 2)).toMatchObject({ dias_apos_tele: 1, tele_resultado: "reduzido" });
    // BIANCA: a coluna já tinha o final (3); a observação diz o original.
    expect(interpretarObservacao("DIMINUI DE 5 PARA 3 DIAS ", 3, 2)).toMatchObject({ dias_atestado: 5, dias_apos_tele: 3 });
    expect(interpretarObservacao("ATESTADO DE 4 DIAS DIMINUIU PARA 3", 4, 1)).toMatchObject({ dias_atestado: 4, dias_apos_tele: 3 });
    expect(interpretarObservacao("ATESTADO FALSO/ PRESENCIAL", 14, 14)).toMatchObject({ dias_apos_tele: 0, tele_resultado: "zerado" });
    // Não compareceu: a ausência conta inteira.
    expect(interpretarObservacao("NÃO COMPARECEU AOS AGENDAMENTOS", 3, 3)).toMatchObject({ dias_apos_tele: null });
    expect(interpretarObservacao("", 3, null)).toMatchObject({ tele_resultado: "mantido", tele_status: "realizada" });
  });

  it("junta as abas e corrige o ano digitado errado", () => {
    const linhas = lerPlanilhaTelemedicina([
      { nome: "Agendamentos", linhas: [
        ["Nome do Colaborador", "Data Atestado", "Dias Atestado", "Data Telemedicina"],
        ["ANATIELI ROSA DA SILVA", 46090, 3, 45725, "março", 0.4166666666666667, "INACI", "047-2022 UFRGS", null, null, "OK", null, null],
        ["JAQUELINE CERVEIRA ", "6/18/26", 90, "6/18/26", "junho", "15:15", "CARLA RIBAS", "SEMAE", null, null, "Não OK", null, "ENCAMINHADO PARA ASSINATURA"],
        ["", "", "", "", "", "", "", "", "", "", "", "", ""],
      ] },
      { nome: "REDUÇÃO DE ATESTADOS", linhas: [
        ["", "", "PONTO", "", "", "JUNHO"],
        ["JAQUELINE CERVEIRA ", "6/18/26", "OK", 90, "6/18/26", "junho", "15:15", "CARLA RIBAS", "SEMAE", "COPEIRO", "Não OK", "REDUZIU PARA 60 DIAS/ AGUARDANDO ATESTADO"],
      ] },
    ]);
    expect(linhas).toHaveLength(2);
    const ana = linhas.find((l) => l.nome.startsWith("ANATIELI"))!;
    expect(ana).toMatchObject({ data_inicio: "2026-03-09", tele_data: "2026-03-09", tele_horario: "10:00", dias_atestado: 3 });
    const jaq = linhas.find((l) => l.nome.startsWith("JAQUELINE"))!;
    expect(jaq).toMatchObject({ dias_atestado: 90, dias_apos_tele: 60, tele_resultado: "reduzido", ponto: "cumpriu", assinatura: "encaminhado" });
  });
});

// Mig 20261029003100: afastamentos de todas as fontes (férias, licença,
// desligamento, auxílio-doença antigo) — o recorte ao período e o
// faturamento realizado no relatório gerencial.
describe("afastamentos reais no período", () => {
  it("encerrado sem dias conta até a véspera do retorno, não até hoje", () => {
    expect(diasDoAfastamento(base({ data_inicio: "2026-08-01", dias_considerados: null, retornou_em: "2026-08-11" }), HOJE)).toBe(10);
  });

  it("auxílio-doença aberto desde 2024 só conta os dias dentro do período", () => {
    const a = base({ tipo: "auxilio_doenca", data_inicio: "2024-03-10", dias_atestado: null, dias_considerados: null, dias_cobertos: 100,
      valor_mensal_posto: 3000, custo_mensal_posto: 2700 });
    const r = recortarAoPeriodo(a, "2026-08-01", "2026-10-31", HOJE)!;
    expect(r.data_inicio).toBe("2026-08-01");
    expect(r.dias_considerados).toBe(89); // 01/08 a 28/10 (hoje)
    expect(r.inicio_real).toBe("2024-03-10");
    expect(r.dias_cobertos).toBeLessThanOrEqual(89);
    expect(calcularImpacto(r, HOJE).dias).toBe(89);
    expect(consolidar([r], "competencia", HOJE).map((l) => [l.chave, l.dias])).toEqual([["2026-08", 31], ["2026-09", 30], ["2026-10", 28]]);
  });

  it("fora do período some; dentro fica igual", () => {
    expect(recortarAoPeriodo(base({ data_inicio: "2026-06-10", dias_considerados: 5 }), "2026-08-01", "2026-10-31", HOJE)).toBeNull();
    const d = recortarAoPeriodo(base({ data_inicio: "2026-09-10", dias_considerados: 5 }), "2026-08-01", "2026-10-31", HOJE)!;
    expect(d.dias_considerados).toBe(5);
    expect(d.data_inicio).toBe("2026-09-10");
  });

  it("desligamento é evento de 0 dia e fica no período", () => {
    const d = recortarAoPeriodo(base({ tipo: "desligamento", data_inicio: "2026-09-15", dias_atestado: 0, dias_considerados: 0 }), "2026-08-01", "2026-10-31", HOJE)!;
    expect(calcularImpacto(d, HOJE).dias).toBe(0);
  });

  it("relatório mensal de atestados não conta férias nem desligamento", () => {
    const r = relatorioMensal([
      base({ id: 1, dias_atestado: 3 }),
      base({ id: 2, tipo: "ferias", dias_atestado: 30, dias_considerados: 30 }),
      base({ id: 3, tipo: "desligamento", dias_atestado: 0, dias_considerados: 0 }),
    ], HOJE);
    expect(r).toHaveLength(1);
    expect(r[0].quantidade).toBe(1);
  });

  it("faturamento realizado por contrato e por competência", () => {
    const itens = [base({ id: 1, contrato_id: "c1" }), base({ id: 2, contrato_id: "c2", contrato_nome: "DMAE", data_inicio: "2026-07-02" })];
    const fat = [
      { contrato_id: "c1", competencia: "2026-06", bruto: 110000, liquido: 100000, faltas: 500, glosas: 200 },
      { contrato_id: "c2", competencia: "2026-07", bruto: 55000, liquido: 50000, faltas: 0, glosas: 0 },
      { contrato_id: "c9", competencia: "2026-06", bruto: 1, liquido: 1, faltas: 0, glosas: 0 },
    ];
    const pc = anexarFaturamento(consolidar(itens, "contrato", HOJE), "contrato", itens, fat);
    expect(pc.find((l) => l.chave === "c1")?.faturamento).toBe(100000);
    expect(pc.find((l) => l.chave === "c1")?.descontosNf).toBe(700);
    const pm = anexarFaturamento(consolidar(itens, "competencia", HOJE), "competencia", itens, fat);
    expect(pm.find((l) => l.chave === "2026-06")?.faturamento).toBe(100000); // c9 não teve afastamento
    expect(anexarFaturamento(consolidar(itens, "colaborador", HOJE), "colaborador", itens, fat)[0].faturamento).toBeUndefined();
  });
});
