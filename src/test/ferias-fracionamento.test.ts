import { describe, it, expect } from "vitest";
import { validarPeriodoFerias, sobraDias, descreverPeriodo, ultimoDiaFerias } from "@/lib/solicitacoes/feriasFracionamento";

const motivo = (r: ReturnType<typeof validarPeriodoFerias>) => r.motivo;

describe("férias fracionadas (30/10/2026)", () => {
  const janeiro20 = { id: 145, status: "Aprovada", saida: "2027-01-04", dias: 20, abono: 0 };

  it("caso do Pablo: 20 dias em janeiro + 10 em fevereiro passa", () => {
    expect(validarPeriodoFerias({ saida: "2027-02-01", dias: 10 }, [janeiro20]).ok).toBe(true);
  });

  it("primeiro pedido sozinho continua passando (30, ou 20 + abono 10)", () => {
    expect(validarPeriodoFerias({ saida: "2027-01-04", dias: 30 }, []).ok).toBe(true);
    expect(validarPeriodoFerias({ saida: "2027-01-04", dias: 20, abono: 10 }, []).ok).toBe(true);
  });

  it("último dia e descrição do período", () => {
    expect(ultimoDiaFerias("2027-01-04", 20)).toBe("2027-01-23");
    expect(descreverPeriodo(janeiro20)).toBe("04/01/2027 a 23/01/2027");
  });

  it("sobreposição barra e diz com quais férias conflita", () => {
    const r = validarPeriodoFerias({ saida: "2027-01-20", dias: 10 }, [janeiro20]);
    expect(r.ok).toBe(false);
    expect(motivo(r)).toBe("Conflita com as férias de 04/01/2027 a 23/01/2027 (#145).");
    // Começar no dia do retorno (24/01) não conflita.
    expect(validarPeriodoFerias({ saida: "2027-01-24", dias: 10 }, [janeiro20]).ok).toBe(true);
    // Terminar na véspera da saída também não.
    expect(validarPeriodoFerias({ saida: "2026-12-25", dias: 10 }, [janeiro20]).ok).toBe(true);
    expect(validarPeriodoFerias({ saida: "2026-12-26", dias: 10 }, [janeiro20]).ok).toBe(false);
  });

  it("mais de 30 dias barra e diz quanto sobra", () => {
    const r = validarPeriodoFerias({ saida: "2027-02-01", dias: 15 }, [janeiro20]);
    expect(motivo(r)).toMatch(/Sobram 10 dia\(s\)/);
    // Abono conta nos 30.
    const comAbono = { ...janeiro20, abono: 10 };
    expect(motivo(validarPeriodoFerias({ saida: "2027-02-01", dias: 10 }, [comAbono]))).toMatch(/já tem os 30 dias/);
    // Venda avulsa dos últimos 12 meses também.
    expect(motivo(validarPeriodoFerias({ saida: "2027-02-01", dias: 10 }, [janeiro20], 5))).toMatch(/Sobram 5 dia/);
    expect(sobraDias([janeiro20], 5)).toBe(5);
  });

  it("período com menos de 5 dias barra", () => {
    expect(motivo(validarPeriodoFerias({ saida: "2027-02-01", dias: 4 }, [janeiro20]))).toMatch(/pelo menos 5 dias/);
  });

  it("no máximo 3 períodos", () => {
    const tres = [
      { id: 1, saida: "2027-01-04", dias: 14 },
      { id: 2, saida: "2027-02-01", dias: 5 },
      { id: 3, saida: "2027-03-01", dias: 5 },
    ];
    expect(motivo(validarPeriodoFerias({ saida: "2027-04-01", dias: 5 }, tres))).toMatch(/3 períodos/);
    // Com dois pedidos (14 + 10), o terceiro de 6 fecha os 30 e passa.
    expect(validarPeriodoFerias({ saida: "2027-04-01", dias: 6 }, tres.slice(0, 1).concat({ id: 2, saida: "2027-02-01", dias: 10 })).ok).toBe(true);
  });

  it("um dos períodos tem que ter 14 dias — se ainda não tem, precisa sobrar espaço", () => {
    // 10 sozinho: sobram 20, dá para um de 14 depois.
    expect(validarPeriodoFerias({ saida: "2027-01-04", dias: 10 }, []).ok).toBe(true);
    // 10 + 10: sobram 10, não cabe mais um de 14.
    const r = validarPeriodoFerias({ saida: "2027-02-01", dias: 10 }, [{ id: 7, saida: "2027-01-04", dias: 10 }]);
    expect(motivo(r)).toMatch(/pelo menos 14 dias/);
    // 10 + 14 passa.
    expect(validarPeriodoFerias({ saida: "2027-02-01", dias: 14 }, [{ id: 7, saida: "2027-01-04", dias: 10 }]).ok).toBe(true);
    // 5 + 5 seria o segundo; o terceiro precisaria ser o de 14 e sobram 20: passa.
    expect(validarPeriodoFerias({ saida: "2027-02-01", dias: 5 }, [{ id: 7, saida: "2027-01-04", dias: 5 }]).ok).toBe(true);
  });
});
