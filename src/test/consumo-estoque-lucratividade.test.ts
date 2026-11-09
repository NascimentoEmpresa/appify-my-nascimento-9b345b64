import { describe, expect, it } from "vitest";
import {
  SOMA_NO_CUSTO,
  consumoPorContrato,
  intervaloDoMes,
  totalConsumo,
  unidadesSemPreco,
  type LinhaConsumoEstoque,
} from "@/pages/controladoria/faturamento/consumoEstoque";

// SIS-2026-0769: coluna "Consumo de Estoque" na Lucratividade de Contratos.

const linha = (p: Partial<LinhaConsumoEstoque>): LinhaConsumoEstoque => ({
  competencia: "2026-09",
  contrato_id: "c1",
  valor: 0,
  unidades: 0,
  unidades_sem_valor: 0,
  ...p,
});

describe("intervalo do mês", () => {
  it("mês de 30 e de 31 dias", () => {
    expect(intervaloDoMes("2026-09")).toEqual({ inicio: "2026-09-01", fim: "2026-09-30" });
    expect(intervaloDoMes("2026-10")).toEqual({ inicio: "2026-10-01", fim: "2026-10-31" });
  });

  it("fevereiro comum e bissexto", () => {
    expect(intervaloDoMes("2026-02").fim).toBe("2026-02-28");
    expect(intervaloDoMes("2024-02").fim).toBe("2024-02-29");
  });

  it("dezembro não vaza para o ano seguinte", () => {
    expect(intervaloDoMes("2026-12")).toEqual({ inicio: "2026-12-01", fim: "2026-12-31" });
  });
});

describe("consumo por contrato", () => {
  it("soma as linhas do mesmo contrato e separa os outros", () => {
    const mapa = consumoPorContrato([
      linha({ contrato_id: "a", valor: 100.5, unidades: 10 }),
      linha({ contrato_id: "a", valor: 49.5, unidades: 5 }),
      linha({ contrato_id: "b", valor: 20, unidades: 2 }),
    ]);
    expect(mapa.get("a")).toEqual({ valor: 150, unidades: 15, unidadesSemValor: 0 });
    expect(mapa.get("b")!.valor).toBe(20);
  });

  it("o PostgREST devolve numeric como texto — tem que virar número, não concatenar", () => {
    const mapa = consumoPorContrato([
      linha({ contrato_id: "a", valor: "100.50", unidades: "10" }),
      linha({ contrato_id: "a", valor: "49.50", unidades: "5" }),
    ]);
    expect(mapa.get("a")!.valor).toBe(150);
    expect(mapa.get("a")!.unidades).toBe(15);
  });

  it("linha sem contrato não entra — a coluna é por contrato", () => {
    const mapa = consumoPorContrato([linha({ contrato_id: "", valor: 99 })]);
    expect(mapa.size).toBe(0);
  });

  it("contrato sem consumo no mês simplesmente não aparece no mapa", () => {
    const mapa = consumoPorContrato([linha({ contrato_id: "a", valor: 10 })]);
    expect(mapa.get("b")).toBeUndefined();
  });
});

describe("unidades sem preço", () => {
  it("soma o que saiu sem valor de custo, de todas as linhas", () => {
    expect(
      unidadesSemPreco([
        linha({ unidades: 10, unidades_sem_valor: 3 }),
        linha({ unidades: 5, unidades_sem_valor: 5 }),
      ]),
    ).toBe(8);
  });

  it("zero quando tudo tem preço — a tela só avisa acima de zero", () => {
    expect(unidadesSemPreco([linha({ unidades: 10, unidades_sem_valor: 0 })])).toBe(0);
  });
});

describe("total do mês", () => {
  it("soma o valor de todos os contratos do mapa", () => {
    const mapa = consumoPorContrato([
      linha({ contrato_id: "a", valor: 100 }),
      linha({ contrato_id: "b", valor: 23.45 }),
    ]);
    expect(totalConsumo(mapa)).toBeCloseTo(123.45, 2);
  });

  it("mapa vazio é zero, não NaN", () => {
    expect(totalConsumo(new Map())).toBe(0);
  });
});

describe("a coluna não soma no custo", () => {
  // Trava proposital: hoje a compra do material já é lançada direto no
  // contrato (a grande maioria das compras de material/uniforme/EPI do malote
  // desde setembro/2026). Somar a saída por cima cobraria duas vezes. Este
  // teste falha de propósito no dia em que alguém ligar a soma sem rever a regra.
  it("SOMA_NO_CUSTO é false enquanto a compra for lançada no contrato", () => {
    expect(SOMA_NO_CUSTO).toBe(false);
  });
});
