import { describe, expect, it } from "vitest";
import {
  ajustarParaDiaUtil, calcularResgatavel, deduplicarMovimentos, ehDiaUtil, projetarCaixa, somarDias, somarDiasUteis,
  type AplicacaoResgatavel, type MovimentoProjetado,
} from "@/pages/financeiro/fluxo-caixa-gerencial/projecaoDiaria";

// SIS-2026-0893 (etapa 2, commit 1): motor da projeção diária. Dia 1 = data-base. Dezembro/2026 começa numa terça-feira.
const BASE = "2026-12-01";
const dia = (n: number) => somarDias(BASE, n - 1); // dia 1 = BASE
const saida = (n: number, valor: number, p: Partial<MovimentoProjetado> = {}): MovimentoProjetado => ({ data: dia(n), valor, tipo: "saida", rotulo: `saída dia ${n}`, ...p });
const entrada = (n: number, valor: number, p: Partial<MovimentoProjetado> = {}): MovimentoProjetado => ({ data: dia(n), valor, tipo: "entrada", rotulo: `entrada dia ${n}`, ...p });
const app = (p: Partial<AplicacaoResgatavel> = {}): AplicacaoResgatavel => ({ id: "a1", rotulo: "CDB", dataDisponivel: BASE, valorLiquido: 400_000, parcial: true, valorMinimo: 0, ...p });

describe("Teste A — déficit no meio do período (saldo final positivo, caixa negativo no dia 5)", () => {
  const r = projetarCaixa({ dataBase: BASE, saldoInicial: 1000, movimentos: [saida(5, 5000), entrada(20, 6000)], reservaMinima: 0 });
  const h30 = r.horizontes.find((h) => h.dias === 30)!;

  it("saldo final R$ 2.000, menor saldo −R$ 4.000 no dia 5 e necessidade máxima R$ 4.000", () => {
    expect(h30.semResgates!.saldoFinal).toBe(2000);
    expect(h30.semResgates!.menorSaldo).toBe(-4000);
    expect(h30.semResgates!.dataMenorSaldo).toBe(dia(5));
    expect(h30.semResgates!.necessidadeMaxima).toBe(4000);
    expect(h30.semResgates!.necessidadeFinal).toBe(0);
    expect(h30.semResgates!.sobraFinal).toBe(2000);
  });

  it("o saldo inicial do dia seguinte é o saldo final do dia anterior", () => {
    for (let i = 1; i < r.dias.length; i++) expect(r.dias[i].saldoInicial).toBe(r.dias[i - 1].saldoFinal);
  });

  it("a tabela de dias críticos traz o dia 5 com a folha que provoca o déficit", () => {
    expect(r.diasCriticos.map((d) => d.data)).toContain(dia(5));
    const d5 = r.diasCriticos.find((d) => d.data === dia(5))!;
    expect(d5.deficit).toBe(4000);
    expect(d5.pagamentos[0].valor).toBe(5000);
    expect(d5.entradasAcumuladas).toBe(0);
    // dia 20 recebe os 6.000: deixa de ser crítico
    expect(r.diasCriticos.map((d) => d.data)).not.toContain(dia(20));
  });

  it("alerta vermelho: o caixa fica negativo em algum dia", () => {
    expect(h30.alerta).toBe("vermelho");
  });
});

describe("Teste B — necessidade final com resgates", () => {
  const movimentos = [entrada(10, 3_500_000), saida(12, 5_000_000)];
  const r = projetarCaixa({ dataBase: BASE, saldoInicial: 500_000, movimentos, aplicacoes: [app({ valorLiquido: 400_000 })] });
  const h = r.horizontes.find((x) => x.dias === 30)!;

  it("500.000 + 3.500.000 + 400.000 − 5.000.000 = −600.000: necessidade final R$ 600.000", () => {
    expect(h.semResgates!.saldoFinal).toBe(-1_000_000);
    expect(h.comResgates!.saldoFinal).toBe(-600_000);
    expect(h.comResgates!.necessidadeFinal).toBe(600_000);
    expect(h.usoResgates).toBe(400_000);
  });

  it("é uma necessidade projetada: sem crédito, o que falta é capital externo", () => {
    expect(h.capitalExterno).toBe(600_000);
  });
});

describe("Teste C — aplicação em carência não cobre obrigação anterior à disponibilidade", () => {
  const critica = saida(5, 10_000);
  it("disponível só no dia 10: o déficit do dia 5 fica sem cobertura", () => {
    const r = projetarCaixa({ dataBase: BASE, saldoInicial: 2000, movimentos: [critica], aplicacoes: [app({ dataDisponivel: dia(10), valorLiquido: 50_000 })] });
    const d5 = r.dias[4];
    expect(d5.resgatesDoDia).toHaveLength(0);
    // o dia 10 resgata o necessário para zerar o déficit acumulado
    expect(r.dias[9].resgatesDoDia[0].valor).toBe(8000);
    const crit = r.diasCriticos.find((d) => d.data === dia(5))!;
    expect(crit.resgatavelAteAData).toBe(0);
    expect(crit.deficitAposResgates).toBe(8000);
  });

  it("aplicação já disponível cobre o dia 5", () => {
    const r = projetarCaixa({ dataBase: BASE, saldoInicial: 2000, movimentos: [critica], aplicacoes: [app({ dataDisponivel: dia(1), valorLiquido: 50_000 })] });
    expect(r.dias[4].resgatesDoDia[0].valor).toBe(8000);
    expect(r.diasCriticos.find((d) => d.data === dia(5))!.deficitAposResgates).toBe(0);
  });
});

describe("Teste D — pagamento registrado em duas fontes conta uma vez", () => {
  it("mesma chave: uma única saída", () => {
    const malote = saida(5, 1000, { chave: "NF-123", origem: "malote" });
    const fluxo = saida(5, 1000, { chave: "NF-123", origem: "fluxo" });
    expect(deduplicarMovimentos([malote, fluxo])).toHaveLength(1);
    const r = projetarCaixa({ dataBase: BASE, saldoInicial: 5000, movimentos: [malote, fluxo] });
    expect(r.dias[4].saidas).toBe(1000);
    expect(r.horizontes[0].saidas).toBe(1000);
  });

  it("sem chave nada é descartado (nunca se perde um pagamento por engano)", () => {
    expect(deduplicarMovimentos([saida(5, 1000), saida(5, 1000)])).toHaveLength(2);
  });
});

describe("Teste E — saldo não validado (conta sem extrato)", () => {
  const r = projetarCaixa({ dataBase: BASE, saldoInicial: null, movimentos: [saida(5, 5000), entrada(20, 6000)] });
  it("não assume saldo zero: sem saldo, sem necessidade e sem cenários", () => {
    expect(r.validado).toBe(false);
    expect(r.dias[0].saldoInicial).toBeNull();
    expect(r.dias[0].saldoFinal).toBeNull();
    for (const h of r.horizontes) {
      expect(h.semResgates).toBeNull();
      expect(h.comResgates).toBeNull();
      expect(h.comCredito).toBeNull();
      expect(h.alerta).toBe("nao_validado");
    }
    expect(r.diasCriticos).toHaveLength(0);
  });
  it("o fluxo líquido continua calculado (informativo)", () => {
    expect(r.dias[4].fluxoAcumulado).toBe(-5000);
    expect(r.dias[19].fluxoAcumulado).toBe(1000);
  });
});

describe("compromissos vencidos", () => {
  it("entram na primeira data com o vencimento original e não contam no dia antigo", () => {
    const vencida = { data: "2026-11-20", valor: 7000, tipo: "saida" as const, rotulo: "boleto vencido" };
    const r = projetarCaixa({ dataBase: BASE, saldoInicial: 10_000, movimentos: [vencida] });
    expect(r.dias[0].saidas).toBe(7000);
    expect(r.dias[0].movimentos[0].vencimentoOriginal).toBe("2026-11-20");
    expect(r.vencidos).toHaveLength(1);
    expect(r.totalVencidos).toBe(7000);
    expect(r.horizontes[0].saidas).toBe(7000);
  });
});

describe("horizontes 30/60/90 saem da mesma série diária (CA-20)", () => {
  const movimentos = [saida(5, 1000), saida(40, 2000), saida(70, 3000), entrada(45, 500), entrada(80, 800)];
  const r = projetarCaixa({ dataBase: BASE, saldoInicial: 10_000, movimentos });
  it("saldo do horizonte = saldo do último dia dele; totais = soma dos dias", () => {
    for (const h of r.horizontes) {
      const ate = r.dias.slice(0, h.dias);
      expect(h.semResgates!.saldoFinal).toBe(ate[ate.length - 1].saldoFinal);
      expect(h.entradas).toBe(Math.round(ate.reduce((s, d) => s + d.entradas, 0) * 100) / 100);
      expect(h.saidas).toBe(Math.round(ate.reduce((s, d) => s + d.saidas, 0) * 100) / 100);
    }
  });
  it("não soma horizontes entre si: 60 dias inclui os 30 uma vez só", () => {
    const [h30, h60, h90] = r.horizontes;
    expect(h30.saidas).toBe(1000);
    expect(h60.saidas).toBe(3000);
    expect(h90.saidas).toBe(6000);
  });
  it("movimento depois do horizonte máximo é ignorado", () => {
    const longe = projetarCaixa({ dataBase: BASE, saldoInicial: 0, movimentos: [saida(120, 999)] });
    expect(longe.horizontes[2].saidas).toBe(0);
  });
});

describe("cobertura em ordem: caixa → aplicações → Conta Garantida → capital externo", () => {
  const movimentos = [saida(3, 100_000)];
  it("usa o limite só depois de esgotar as aplicações", () => {
    const r = projetarCaixa({
      dataBase: BASE, saldoInicial: 20_000, movimentos, aplicacoes: [app({ valorLiquido: 30_000 })], limiteCreditoDisponivel: 25_000,
    });
    const h = r.horizontes[0];
    expect(h.usoResgates).toBe(30_000);
    expect(h.usoCredito).toBe(25_000);
    expect(h.capitalExterno).toBe(25_000);
    expect(h.comCredito!.saldoFinal).toBe(-25_000);
    expect(r.dias[2].creditoDoDia).toBe(25_000);
  });
  it("sem limite informado não há crédito simulado", () => {
    const r = projetarCaixa({ dataBase: BASE, saldoInicial: 0, movimentos: [saida(3, 100)], limiteCreditoDisponivel: null });
    expect(r.horizontes[0].usoCredito).toBe(0);
    expect(r.horizontes[0].capitalExterno).toBe(100);
  });
  it("não resgata nem usa crédito se o caixa próprio basta", () => {
    const r = projetarCaixa({ dataBase: BASE, saldoInicial: 500_000, movimentos, aplicacoes: [app()], limiteCreditoDisponivel: 1_000_000 });
    expect(r.horizontes[0].usoResgates).toBe(0);
    expect(r.horizontes[0].usoCredito).toBe(0);
  });
  it("resgate respeita valor mínimo e resgate parcial", () => {
    const parcial = projetarCaixa({ dataBase: BASE, saldoInicial: 0, movimentos: [saida(2, 1000)], aplicacoes: [app({ valorLiquido: 100_000, valorMinimo: 5000 })] });
    expect(parcial.dias[1].resgatesDoDia[0].valor).toBe(5000); // o mínimo operacional, mesmo precisando de 1.000
    const total = projetarCaixa({ dataBase: BASE, saldoInicial: 0, movimentos: [saida(2, 1000)], aplicacoes: [app({ valorLiquido: 100_000, parcial: false })] });
    expect(total.dias[1].resgatesDoDia[0].valor).toBe(100_000); // sem resgate parcial: resgata tudo
    const pequena = projetarCaixa({ dataBase: BASE, saldoInicial: 0, movimentos: [saida(2, 1000)], aplicacoes: [app({ valorLiquido: 3000, valorMinimo: 5000 })] });
    expect(pequena.dias[1].resgatesDoDia).toHaveLength(0); // saldo abaixo do mínimo: não dá para resgatar
  });
});

describe("alertas e reserva mínima", () => {
  const base = { dataBase: BASE, saldoInicial: 10_000, movimentos: [saida(2, 1000)] };
  it("reserva mínima não cadastrada: parâmetro pendente (não presume zero)", () => {
    const r = projetarCaixa(base);
    expect(r.reservaPendente).toBe(true);
    expect(r.horizontes[0].alerta).toBe("reserva_pendente");
  });
  it("verde, amarelo e vermelho", () => {
    expect(projetarCaixa({ ...base, reservaMinima: 5000 }).horizontes[0].alerta).toBe("verde");
    expect(projetarCaixa({ ...base, reservaMinima: 20_000 }).horizontes[0].alerta).toBe("amarelo");
    expect(projetarCaixa({ ...base, movimentos: [saida(2, 50_000)], reservaMinima: 5000 }).horizontes[0].alerta).toBe("vermelho");
  });
  it("conta já negativa na abertura: o menor saldo é o de abertura", () => {
    const r = projetarCaixa({ dataBase: BASE, saldoInicial: -300, movimentos: [entrada(2, 1000)], reservaMinima: 0 });
    expect(r.horizontes[0].semResgates!.menorSaldo).toBe(-300);
    expect(r.horizontes[0].semResgates!.necessidadeMaxima).toBe(300);
  });
  it("sem erro de ponto flutuante (centavos)", () => {
    const r = projetarCaixa({ dataBase: BASE, saldoInicial: 0.1, movimentos: [entrada(1, 0.2), saida(2, 0.3)] });
    expect(r.horizontes[0].semResgates!.saldoFinal).toBe(0);
  });
});

describe("calendário bancário e liquidez das aplicações", () => {
  const feriados = new Set(["2026-12-25"]);
  it("dia útil: fim de semana e feriado não são", () => {
    expect(ehDiaUtil("2026-12-04", feriados)).toBe(true); // sexta
    expect(ehDiaUtil("2026-12-05", feriados)).toBe(false); // sábado
    expect(ehDiaUtil("2026-12-25", feriados)).toBe(false); // feriado
  });
  it("antecipar volta ao dia útil anterior; postergar avança; manter não mexe", () => {
    expect(ajustarParaDiaUtil("2026-12-05", "antecipar", feriados)).toBe("2026-12-04");
    expect(ajustarParaDiaUtil("2026-12-05", "postergar", feriados)).toBe("2026-12-07");
    expect(ajustarParaDiaUtil("2026-12-05", "manter", feriados)).toBe("2026-12-05");
    expect(ajustarParaDiaUtil("2026-12-25", "postergar", feriados)).toBe("2026-12-28");
  });
  it("soma de dias úteis pula fim de semana e feriado", () => {
    expect(somarDiasUteis("2026-12-24", 1, feriados)).toBe("2026-12-28"); // 25 é feriado, 26/27 fim de semana
  });

  const cdb = {
    id: "c1", rotulo: "CDB Sicredi", saldoBruto: 200_000, tipoLiquidez: "D1" as const, calendarioLiquidacao: "uteis" as const, fimCarencia: "2026-12-10",
    resgateParcial: true, deducaoFixa: 5000,
  };
  it("exemplo da especificação: carência até o dia 10, D+1 útil, líquido R$ 195.000 — disponível no dia 11", () => {
    const r = calcularResgatavel(cdb, BASE, feriados)!;
    expect(r.dataDisponivel).toBe("2026-12-11");
    expect(r.valorLiquido).toBe(195_000);
  });
  it("necessidade no dia 5 NÃO é coberta por essa aplicação", () => {
    const r = calcularResgatavel(cdb, BASE, feriados)!;
    const proj = projetarCaixa({ dataBase: BASE, saldoInicial: 0, movimentos: [saida(5, 50_000)], aplicacoes: [r] });
    expect(proj.dias[4].resgatesDoDia).toHaveLength(0);
    expect(proj.dias[10].resgatesDoDia[0].valor).toBe(50_000); // dia 11 (índice 10)
  });
  it("saldo mínimo obrigatório e deduções por percentual reduzem o valor líquido", () => {
    const r = calcularResgatavel({ ...cdb, saldoMinimoObrigatorio: 50_000, deducaoFixa: 0, deducaoPct: 10 }, BASE, feriados)!;
    expect(r.valorLiquido).toBe(135_000); // (200.000 − 50.000) − 10%
  });
  it("liquidez no vencimento sem data de vencimento não é elegível; D+0 e corridos", () => {
    expect(calcularResgatavel({ ...cdb, tipoLiquidez: "vencimento", vencimento: null }, BASE, feriados)).toBeNull();
    expect(calcularResgatavel({ ...cdb, tipoLiquidez: "D0", fimCarencia: null, deducaoFixa: 0 }, "2026-12-02", feriados)!.dataDisponivel).toBe("2026-12-02");
    expect(calcularResgatavel({ ...cdb, tipoLiquidez: "DN", prazoN: 3, calendarioLiquidacao: "corridos", fimCarencia: null }, "2026-12-02", feriados)!.dataDisponivel).toBe("2026-12-05");
  });
  it("saldo todo preso no mínimo obrigatório: nada resgatável", () => {
    expect(calcularResgatavel({ ...cdb, saldoMinimoObrigatorio: 200_000 }, BASE, feriados)).toBeNull();
  });
});
