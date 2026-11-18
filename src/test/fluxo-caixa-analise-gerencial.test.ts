import { describe, expect, it } from "vitest";
import { analiseMensal, periodosDeInsuficiencia, resumoGerencial } from "@/pages/financeiro/fluxo-caixa-gerencial/analiseGerencial";
import type { PontoNatureza } from "@/pages/financeiro/fluxo-caixa-gerencial/emprestimosAplicacoes";
import { montarPlanilhasGerencial, type DadosExportacaoGerencial } from "@/pages/financeiro/fluxo-caixa-gerencial/exportarGerencial";
import { ANALISE_VAZIA } from "@/pages/financeiro/fluxo-caixa-gerencial/analiseDespesas";

// SIS-2026-XXXX (etapa 4): análises gerenciais mês a mês e exportação completa.
const nat = (mes: string, p: Partial<PontoNatureza>): PontoNatureza => ({
  mes, recebimentosOperacionais: 0, despesasOperacionais: 0, resultadoOperacional: 0, emprestimoUtilizado: 0, emprestimoAmortizado: 0, jurosPagos: 0, saldoDevedorFim: 0, aplicado: 0, resgatadoAplicacoes: 0, rendimentos: 0, ...p,
});
const serie: PontoNatureza[] = [
  nat("2026-08", { recebimentosOperacionais: 1000, despesasOperacionais: 800, resultadoOperacional: 200, saldoDevedorFim: 500 }),
  nat("2026-09", { recebimentosOperacionais: 600, despesasOperacionais: 1000, resultadoOperacional: -400, emprestimoUtilizado: 400, saldoDevedorFim: 900 }),
  nat("2026-10", { recebimentosOperacionais: 500, despesasOperacionais: 1500, resultadoOperacional: -1000, emprestimoUtilizado: 600, emprestimoAmortizado: 100, saldoDevedorFim: 1400 }),
  nat("2026-11", { recebimentosOperacionais: 1200, despesasOperacionais: 1000, resultadoOperacional: 200, emprestimoAmortizado: 300, saldoDevedorFim: 1100 }),
];
const fat = new Map([["2026-08", 1100], ["2026-09", 900], ["2026-10", 700], ["2026-11", 1300]]);
const a = analiseMensal(serie, fat);

describe("análise mensal", () => {
  it("necessidade de capital de giro = déficit operacional do mês (nunca negativa)", () => {
    expect(a.map((p) => p.necessidadeCapitalGiro)).toEqual([0, 400, 1000, 0]);
  });
  it("utilização de capital de giro = utilização líquida (utilizado − amortizado, mínimo zero)", () => {
    expect(a.map((p) => p.utilizacaoCapitalGiro)).toEqual([0, 400, 500, 0]);
  });
  it("cobertura = recebimentos ÷ despesas; dependência bancária = crédito líquido ÷ despesas", () => {
    expect(a[1].cobertura).toBeCloseTo(0.6, 6);
    expect(a[2].dependenciaBancaria).toBeCloseTo(500 / 1500, 6);
    expect(a[0].dependenciaBancaria).toBe(0);
  });
  it("mês sem despesa: cobertura e dependência ficam nulas (não existe razão sobre zero)", () => {
    const x = analiseMensal([nat("2026-11", { recebimentosOperacionais: 100 })], new Map())[0];
    expect(x.cobertura).toBeNull();
    expect(x.dependenciaBancaria).toBeNull();
  });
  it("variação sobre o mês anterior; o primeiro mês não tem base", () => {
    expect(a[0].variacaoRecebimentosPct).toBeNull();
    expect(a[1].variacaoRecebimentosPct).toBeCloseTo(-0.4, 6);
    expect(a[1].variacaoDespesasPct).toBeCloseTo(0.25, 6);
    expect(a[3].variacaoFaturamentoPct).toBeCloseTo((1300 - 700) / 700, 6);
  });
  it("o resultado e o saldo devedor vêm da série por natureza", () => {
    expect(a[2].resultado).toBe(-1000);
    expect(a[2].saldoDevedorFim).toBe(1400);
  });
});

describe("períodos de maior insuficiência e resumo", () => {
  it("ordena do pior déficit para o menor e informa quanto foi financiado por crédito", () => {
    const p = periodosDeInsuficiencia(a, 3);
    expect(p.map((x) => x.mes)).toEqual(["2026-10", "2026-09"]);
    expect(p[0].deficit).toBe(1000);
    expect(p[0].financiadoPorCredito).toBeCloseTo(0.5, 6);
    expect(p[1].financiadoPorCredito).toBeCloseTo(1, 6);
  });
  it("limite de itens", () => {
    expect(periodosDeInsuficiencia(a, 1)).toHaveLength(1);
  });
  it("resumo do período: Σ recebimentos ÷ Σ despesas, Σ crédito líquido ÷ Σ despesas, meses com déficit e variação do saldo devedor", () => {
    const r = resumoGerencial(a);
    expect(r.coberturaPeriodo).toBeCloseTo(3300 / 4300, 6);
    expect(r.dependenciaPeriodo).toBeCloseTo(900 / 4300, 6);
    expect(r.mesesComDeficit).toBe(2);
    expect(r.maiorDeficit).toBe(1000);
    expect(r.mesDoMaiorDeficit).toBe("2026-10");
    expect(r.saldoDevedorFim).toBe(1100);
    expect(r.variacaoSaldoDevedor).toBe(600);
  });
  it("série vazia não quebra", () => {
    expect(resumoGerencial([])).toMatchObject({ coberturaPeriodo: null, mesesComDeficit: 0, maiorDeficit: 0, mesDoMaiorDeficit: null, saldoDevedorFim: 0, variacaoSaldoDevedor: 0 });
  });
});

describe("exportação completa", () => {
  const dados: DadosExportacaoGerencial = {
    geradoEm: new Date("2026-11-18T12:00:00"), filtro: { ini: "2026-11-01", fim: "2026-11-30", empresaId: "", contratoId: "", tipoData: "emissao" }, rotuloEmpresa: "Todas",
    kpis: { qtd: 2, bruto: 2000, liquido: 1800, recebido: 900, pendente: 700, pctRecebidoDoLiquido: 0.5, pctPendenteDoLiquido: 0.39 },
    despesasPagas: 1000, malotePago: 600, analiseMensal: a, resumo: resumoGerencial(a),
    notasDoRecorte: [{ id: "n1", numero: "100", empresaId: "e1", contratoId: "c1", competencia: "2026-11-01", emissao: "2026-11-05", pagamento: null, bruto: 1000, liquido: 900, pago: 0, pendente: 900 }],
    notasRecebidas: [], pendentes: [], despesas: { ...ANALISE_VAZIA, por_contrato: [{ nome: "Contrato A", valor: 600, valor_anterior: 500 }] }, emprestimos: [], aplicacoes: [], natureza: serie,
    empresaNome: () => "NH", contratoNome: () => "Contrato A",
  };
  const planilhas = montarPlanilhasGerencial(dados);

  it("um arquivo com os demonstrativos e os detalhamentos (11 planilhas)", () => {
    expect(planilhas.map((p) => p.nome)).toEqual([
      "Resumo", "Análise mensal", "Notas do recorte", "Notas recebidas no período", "Pendentes (aging)", "Despesas por classificação", "Despesas por contrato", "Despesas por origem",
      "Empréstimos", "Aplicações", "Fluxo por natureza",
    ]);
  });
  it("o resumo traz os KPIs e a base de data usada", () => {
    const linhas = planilhas[0].linhas;
    expect(linhas.find((l) => l[0] === "Valor efetivamente recebido (pela data de pagamento)")![1]).toBe(900);
    expect(linhas.find((l) => l[0] === "Faturamento por")![1]).toBe("Data de emissão");
  });
  it("a planilha mensal tem uma linha por mês da série e o detalhe da nota carrega o contrato", () => {
    expect(planilhas[1].linhas).toHaveLength(1 + a.length);
    expect(planilhas[2].linhas[1][2]).toBe("Contrato A");
  });
  it("despesas por contrato calculam a variação em R$ contra o período anterior", () => {
    expect(planilhas[6].linhas[1]).toEqual(["Contrato A", 600, 500, 100]);
  });
  it("nome de planilha cabe no limite de 31 caracteres do Excel", () => {
    for (const p of planilhas) expect(p.nome.length).toBeLessThanOrEqual(31);
  });
});
