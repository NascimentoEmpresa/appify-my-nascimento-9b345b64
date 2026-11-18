import { describe, expect, it } from "vitest";
import { calcularReserva, reservaDoMesParaEmpresa } from "@/pages/controladoria/fechamento-socios/regras";

// SIS-2026-0926: a Reserva Empresa do Fechamento da Empresa tem UMA origem — o Fechamento dos Sócios.
describe("reservaDoMesParaEmpresa (SIS-2026-0926)", () => {
  const jan = { resultadoAposOutrasReceitas: 378471.27, tributos: 0 };

  it("reserva de 0% → R$ 0,00 (jan/26 do chamado)", () => {
    expect(reservaDoMesParaEmpresa({ ...jan, percentualAberto: 0 })).toEqual({ valor: 0, percentual: 0, fechada: false });
  });

  it("alterando o percentual para 20% → R$ 75.694,25, igual ao cálculo do Fechamento dos Sócios", () => {
    const r = reservaDoMesParaEmpresa({ ...jan, percentualAberto: 20 });
    expect(r.valor).toBeCloseTo(75694.25, 2);
    expect(r.valor).toBe(calcularReserva(378471.27, 20));
  });

  it("a base é o Resultado do Período: resultado após outras receitas MENOS tributos", () => {
    expect(reservaDoMesParaEmpresa({ resultadoAposOutrasReceitas: 100000, tributos: 20000, percentualAberto: 10 }).valor).toBe(8000);
  });

  it("competência fechada vale o que ficou gravado, mesmo que o percentual aberto ou o resultado tenham mudado depois", () => {
    const r = reservaDoMesParaEmpresa({ resultadoAposOutrasReceitas: 999999, tributos: 0, percentualAberto: 50, fechada: { reserva: 75694.25, reservaPercentual: 20 } });
    expect(r).toEqual({ valor: 75694.25, percentual: 20, fechada: true });
  });

  it("mês sem resultado positivo não reserva nada (prejuízo não vira reserva negativa)", () => {
    expect(reservaDoMesParaEmpresa({ resultadoAposOutrasReceitas: -185846.36, tributos: 0, percentualAberto: 20 }).valor).toBe(0);
  });
});
