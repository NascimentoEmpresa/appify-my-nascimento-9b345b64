import { describe, expect, it } from "vitest";
import planilha from "./fixtures/osc-canaa-planilha-2026.json";
import {
  CENARIO_DESPESA_EXTRA, EntradaOsc, SEM_RUBRICA, calcularOsc, lerLinhasImportacao,
  type CriterioPrevisao, type OscCompetenciaCalc,
} from "@/lib/oscFinanceiro";

// SIS-2026-0922 — a fixture é a mesma carga inicial da migration
// 20261117092200 (gerada da planilha Canaa_Previsao_Investimentos.xlsx). O
// primeiro bloco prova que o módulo reproduz a planilha do solicitante.

function entradaDaPlanilha(hoje = "2026-08-15", extra: Partial<EntradaOsc> = {}): EntradaOsc {
  const competencias: OscCompetenciaCalc[] = Array.from({ length: 7 }, (_, i) => ({
    competencia: `2026-${String(i + 1).padStart(2, "0")}-01`,
    repasse_previsto: null,
    repasse_recebido: planilha.repasseMensal,
    situacao: "fechada",
    fonte_realizado: "historico",
  }));
  return {
    ano: 2026,
    hoje,
    repasseMensal: planilha.repasseMensal,
    saldoInicial: 0,
    reservaExtra: 0,
    rubricas: planilha.rubricas.map((r) => ({ id: r.nome, nome: r.nome, grupo: r.grupo, tipo: r.tipo as "despesa" | "reserva" })),
    previsoes: planilha.previsoes.map((p) => ({ rubrica_id: p.nome, criterio: p.criterio as CriterioPrevisao, base_mensal: p.base, ajuste_pct: 0 })),
    previsoesMes: planilha.previsoesMes.map((p) => ({ rubrica_id: p.nome, competencia: `2026-${String(p.mes).padStart(2, "0")}-01`, valor: p.valor })),
    competencias,
    lancamentos: planilha.historico.map((h) => ({ competencia: `2026-${String(h.mes).padStart(2, "0")}-01`, rubrica_id: h.nome, tipo: "historico" as const, valor: h.valor })),
    pagamentos: [],
    projetos: [],
    ...extra,
  };
}

// Colunas "Sobra do mês" e "Acumulado" da aba Resumo da planilha
const SOBRA_PLANILHA = [54358.85, 5880.77, -17918.76, 8429.45, -459.55, 5174.74, -4868.77, 2679.17, -20348.25, -2191.84, -6720.61, -24695.62];
const ACUMULADO_PLANILHA = [54358.85, 60239.62, 42320.86, 50750.31, 50290.76, 55465.5, 50596.73, 53275.9, 32927.65, 30735.81, 24015.2, -680.42];

describe("OSC Canaã — reproduz a planilha manual", () => {
  const r = calcularOsc(entradaDaPlanilha());

  it("saldo do mês e acumulado de janeiro a dezembro batem com a planilha", () => {
    expect(r.meses.map((m) => m.saldoMes)).toEqual(SOBRA_PLANILHA);
    expect(r.meses.map((m) => m.saldoAcumulado)).toEqual(ACUMULADO_PLANILHA);
  });

  it("cards: saldo até julho, custo de referência e dezembro", () => {
    expect(r.ultimoFechado).toBe(7);
    expect(r.saldoAteUltimoFechado).toBe(50596.73);
    expect(r.mesReferencia).toBe(8);
    expect(r.custoReferencia).toBe(89204.79);
    expect(r.saldoProjetadoDezembro).toBe(-680.42);
  });

  it("decomposição de dezembro igual ao quadro 'Como se forma a previsão'", () => {
    const agoDez = r.meses.slice(7);
    const repasses = agoDez.reduce((s, m) => s + m.repasse, 0);
    const aplicacoes = agoDez.reduce((s, m) => s + m.aplicacoes, 0);
    expect(Math.round(repasses * 100) / 100).toBe(459419.8);
    expect(aplicacoes).toBe(71500);
  });

  it("aplicação para férias e 13º acumula como reserva, separada das despesas", () => {
    expect(r.meses[6].reservaAcumulada).toBe(15941.2 + 28600 + 14300 * 4);
    expect(r.meses[1].aplicacoes).toBe(15941.2);
    expect(r.meses[1].despesas).toBe(Math.round((86003.19 - 15941.2) * 100) / 100);
  });

  it("déficit projetado vira alerta de erro", () => {
    expect(r.alertas.some((a) => a.tipo === "deficit" && a.nivel === "erro")).toBe(true);
  });

  it("composição de custos soma 100%", () => {
    const pct = r.composicao.reduce((s, c) => s + c.pct, 0);
    expect(pct).toBeCloseTo(1, 6);
    expect(r.composicao[0].nome).toBe("Salários");
  });
});

describe("OSC — regra por situação do mês", () => {
  it("mês em aberto usa o maior entre realizado e previsto por rubrica", () => {
    const base = entradaDaPlanilha("2026-08-20");
    // agosto: Salários previsto 33.686,19 — pago 40.000 (estouro); Água prevista 475,32 — paga 100
    const r = calcularOsc({
      ...base,
      pagamentos: [
        { competencia: "2026-08-01", rubrica_id: "Salários", valor: 40000, ignorado: false },
        { competencia: "2026-08-01", rubrica_id: "Água", valor: 100, ignorado: false },
      ],
    });
    const ago = r.meses[7];
    expect(ago.situacao).toBe("em_aberto");
    expect(ago.porRubrica["Salários"]).toEqual({ previsto: 33686.19, realizado: 40000, considerado: 40000 });
    expect(ago.porRubrica["Água"].considerado).toBe(475.32);
    const semPag = calcularOsc(base).meses[7];
    expect(ago.saldoMes).toBe(Math.round((semPag.saldoMes - (40000 - 33686.19)) * 100) / 100);
    expect(r.alertas.some((a) => a.tipo === "acima_previsto" && a.rubrica_id === "Salários")).toBe(true);
  });

  it("mês fechado usa só o realizado (Malote), mesmo abaixo do previsto", () => {
    const base = entradaDaPlanilha("2026-09-10");
    const r = calcularOsc({
      ...base,
      competencias: [...base.competencias, { competencia: "2026-08-01", repasse_previsto: null, repasse_recebido: 91883.96, situacao: "fechada", fonte_realizado: "malote" }],
      pagamentos: [{ competencia: "2026-08-01", rubrica_id: "Salários", valor: 30000, ignorado: false }],
    });
    const ago = r.meses[7];
    expect(ago.situacao).toBe("fechada");
    expect(ago.despesas).toBe(30000);
    expect(ago.aplicacoes).toBe(0);
    expect(ago.saldoMes).toBe(61883.96);
  });

  it("mês com fonte 'histórico' ignora o Malote no cálculo mas mostra para conciliar", () => {
    const base = entradaDaPlanilha();
    const r = calcularOsc({
      ...base,
      pagamentos: [{ competencia: "2026-03-01", rubrica_id: "Água", valor: 999, ignorado: false }],
    });
    expect(r.meses[2].saldoMes).toBe(-17918.76);
    expect(r.meses[2].pagoMalote).toBe(999);
    expect(r.meses[2].historicoImportado).toBe(109802.72);
  });

  it("pagamento sem rubrica conta como despesa e gera alerta; ignorado não conta", () => {
    const base = entradaDaPlanilha("2026-08-20");
    const r = calcularOsc({
      ...base,
      pagamentos: [
        { competencia: "2026-08-01", rubrica_id: null, valor: 500, ignorado: false },
        { competencia: "2026-08-01", rubrica_id: null, valor: 7000, ignorado: true },
      ],
    });
    expect(r.meses[7].porRubrica[SEM_RUBRICA].considerado).toBe(500);
    expect(r.saldoProjetadoDezembro).toBe(-1180.42);
    const alerta = r.alertas.find((a) => a.tipo === "sem_rubrica");
    expect(alerta?.valor).toBe(500);
  });

  it("resgate da reserva entra como receita e reduz a reserva acumulada", () => {
    const base = entradaDaPlanilha("2026-08-20");
    const r = calcularOsc({
      ...base,
      lancamentos: [...base.lancamentos, { competencia: "2026-08-01", rubrica_id: "Aplicação para férias e 13º", tipo: "resgate", valor: 21761.38 }],
    });
    expect(r.meses[7].resgates).toBe(21761.38);
    expect(r.meses[7].saldoMes).toBe(24440.55);
    expect(r.meses[7].reservaAcumulada).toBe(Math.round((15941.2 + 28600 + 14300 * 5 - 21761.38) * 100) / 100);
  });

  it("ajuste manual (pago fora do Malote) soma ao realizado do mês", () => {
    const base = entradaDaPlanilha("2026-09-10");
    const r = calcularOsc({
      ...base,
      competencias: [...base.competencias, { competencia: "2026-08-01", repasse_previsto: null, repasse_recebido: null, situacao: "fechada", fonte_realizado: "malote" }],
      lancamentos: [...base.lancamentos, { competencia: "2026-08-01", rubrica_id: "Tarifas bancárias", tipo: "ajuste", valor: 50 }],
    });
    expect(r.meses[7].despesas).toBe(50);
    expect(r.meses[7].ajustesManuais).toBe(50);
    expect(r.alertas.some((a) => a.tipo === "repasse_nao_confirmado" && a.competencia === "2026-08-01")).toBe(true);
  });
});

describe("OSC — custo de referência por critério", () => {
  it("'último realizado' e 'média' acompanham o último mês fechado", () => {
    const base = entradaDaPlanilha("2026-09-10");
    const comAgosto = calcularOsc({
      ...base,
      competencias: [...base.competencias, { competencia: "2026-08-01", repasse_previsto: null, repasse_recebido: 91883.96, situacao: "fechada", fonte_realizado: "malote" }],
      pagamentos: [
        { competencia: "2026-08-01", rubrica_id: "Internet", valor: 199.9, ignorado: false },
        { competencia: "2026-08-01", rubrica_id: "Água", valor: 800, ignorado: false },
      ],
      previsoesMes: [],
    });
    // Internet: critério "Julho" (último realizado) → agosto fechado = 199,90
    expect(comAgosto.meses[8].porRubrica["Internet"].previsto).toBe(199.9);
    // Água: média dos 8 meses fechados (jan–jul da planilha + 800)
    const somaAgua = 303.66 + 394.98 + 323.34 + 456.41 + 476.82 + 496.14 + 425.09 + 800;
    expect(comAgosto.meses[8].porRubrica["Água"].previsto).toBe(Math.round((somaAgua / 8) * 100) / 100);
  });

  it("ajuste % aplica sobre a base e o valor do mês prevalece", () => {
    const base = entradaDaPlanilha();
    const r = calcularOsc({
      ...base,
      previsoes: base.previsoes.map((p) => (p.rubrica_id === "Internet" ? { ...p, criterio: "manual", base_mensal: 100, ajuste_pct: 0.1 } : p)),
      previsoesMes: [{ rubrica_id: "Internet", competencia: "2026-12-01", valor: 300 }],
    });
    expect(r.meses[8].porRubrica["Internet"].previsto).toBe(110);
    expect(r.meses[11].porRubrica["Internet"].previsto).toBe(300);
  });
});

describe("OSC — projetos e cenários", () => {
  it("projetos pendentes/aprovados abatem do saldo após projetos; executado e cancelado não", () => {
    const base = entradaDaPlanilha();
    const r = calcularOsc({
      ...base,
      reservaExtra: 1000,
      projetos: [
        { valor_estimado: 8000, competencia_prevista: "2026-10-01", status: "aprovado" },
        { valor_estimado: 6500, competencia_prevista: null, status: "pendente" },
        { valor_estimado: 4000, competencia_prevista: "2026-09-01", status: "executado" },
        { valor_estimado: 9999, competencia_prevista: "2026-09-01", status: "cancelado" },
        { valor_estimado: 5000, competencia_prevista: "2027-02-01", status: "aprovado" },
      ],
    });
    expect(r.meses[9].projetos).toBe(8000);
    expect(r.meses[11].projetos).toBe(6500);
    expect(r.meses[9].saldoAposProjetos).toBe(30735.81 - 8000);
    expect(r.saldoAposProjetosDezembro).toBe(-680.42 - 14500);
    expect(r.saldoProjetadoDezembro).toBe(-680.42);
    expect(r.projetosAprovados).toBe(8000);
    expect(r.projetosPendentes).toBe(6500);
    expect(r.saldoLivre).toBe(-680.42 - 14500 - 1000);
    const semPendentes = calcularOsc({ ...base, incluirProjetosPendentes: false, projetos: [{ valor_estimado: 6500, competencia_prevista: null, status: "pendente" }] });
    expect(semPendentes.saldoAposProjetosDezembro).toBe(-680.42);
    expect(semPendentes.projetosPendentes).toBe(6500);
  });

  it("cenário não toca meses fechados e muda só a projeção", () => {
    const base = entradaDaPlanilha();
    const oficial = calcularOsc(base);
    const sim = calcularOsc({ ...base, cenario: { despesaExtraMensal: 1000, ajusteRepassePct: 0.1, projetosExtras: [{ valor: 2000, competencia: "2026-11-01" }] } });
    expect(sim.meses[6].saldoAcumulado).toBe(oficial.meses[6].saldoAcumulado);
    // 5 meses: +10% de repasse (9.188,40 × 5) − 1.000 × 5
    expect(sim.saldoProjetadoDezembro).toBe(Math.round((-680.42 + 9188.4 * 5 - 5000) * 100) / 100);
    expect(sim.saldoAposProjetosDezembro).toBe(Math.round((sim.saldoProjetadoDezembro - 2000) * 100) / 100);
    expect(sim.meses[7].porRubrica[CENARIO_DESPESA_EXTRA].considerado).toBe(1000);
  });

  it("economia % reduz o previsto das despesas, não a aplicação", () => {
    const base = entradaDaPlanilha();
    const sim = calcularOsc({ ...base, cenario: { economiaPct: 0.1 } });
    expect(sim.meses[7].aplicacoes).toBe(14300);
    // arredondado rubrica a rubrica — difere centavos do total × 0,9
    expect(sim.meses[7].despesas).toBeCloseTo((89204.79 - 14300) * 0.9, 0);
  });
});

describe("OSC — importação da planilha", () => {
  it("lê a aba 'Base janeiro a julho' (Mês | Descrição | Categoria | Valor | Origem)", () => {
    const { linhas, erros } = lerLinhasImportacao([
      [],
      [null, "Histórico utilizado na projeção"],
      [null, "Mês", "Descrição original", "Categoria", "Valor (R$)", "Origem"],
      [null, 1, "ÁGUA", "Água", 303.66, "MES 01!B26"],
      [null, 2, "APLICAÇÃO (conta vinculada)", "Aplicação para férias e 13º", "15.941,20", "MES 02!B29"],
      [null, 3, "ALIMENTAÇÃO", "ALIMENTACAO", "", "MES 03!B32"],
      [null, 13, "X", "Água", 1, ""],
    ], 2026);
    expect(linhas).toEqual([
      { competencia: "2026-01-01", rubrica: "Água", descricao: "ÁGUA", valor: 303.66, origem: "MES 01!B26" },
      { competencia: "2026-02-01", rubrica: "Aplicação para férias e 13º", descricao: "APLICAÇÃO (conta vinculada)", valor: 15941.2, origem: "MES 02!B29" },
    ]);
    expect(erros).toHaveLength(1);
  });

  it("aceita modelo simples com competência mm/aaaa", () => {
    const { linhas } = lerLinhasImportacao([["Competência", "Rubrica", "Valor"], ["08/2026", "Luz", 849.27]], 2026);
    expect(linhas[0]).toMatchObject({ competencia: "2026-08-01", rubrica: "Luz", valor: 849.27 });
  });
});
