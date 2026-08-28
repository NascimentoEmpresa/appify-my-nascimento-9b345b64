import { describe, expect, it } from "vitest";
import { gerarParcelas } from "@/hooks/useMaloteDespesa";

// SIS-2026-0259 (Iury): a parcela 1 vence na data de pagamento escolhida no
// lançamento, não no dia do desconto — só as parcelas seguintes caem no dia
// do desconto dos meses seguintes.
describe("gerarParcelas", () => {
  it("parcela 1 vence na data de pagamento escolhida, mesmo quando ela não coincide com o dia do desconto", () => {
    const parcelas = gerarParcelas(300, 3, "2026-08-28", 8);
    expect(parcelas[0].data_vencimento).toBe("2026-08-28");
    expect(parcelas[1].data_vencimento).toBe("2026-09-08");
    expect(parcelas[2].data_vencimento).toBe("2026-10-08");
  });

  it("quando a data de pagamento já cai no dia do desconto, o resultado não muda", () => {
    const parcelas = gerarParcelas(200, 2, "2026-08-08", 8);
    expect(parcelas[0].data_vencimento).toBe("2026-08-08");
    expect(parcelas[1].data_vencimento).toBe("2026-09-08");
  });

  it("sem dia do desconto informado, parcelas seguintes usam o dia da data de pagamento", () => {
    const parcelas = gerarParcelas(200, 2, "2026-08-28", null);
    expect(parcelas[0].data_vencimento).toBe("2026-08-28");
    expect(parcelas[1].data_vencimento).toBe("2026-09-28");
  });

  it("numera as parcelas sequencialmente e faz a última absorver o resto de arredondamento", () => {
    const parcelas = gerarParcelas(100, 3, "2026-01-31", 15);
    expect(parcelas.map((p) => p.numero_parcela)).toEqual([1, 2, 3]);
    expect(parcelas[0].valor).toBe(33.33);
    expect(parcelas[1].valor).toBe(33.33);
    expect(parcelas[2].valor).toBe(33.34);
  });

  it("retorna lista vazia quando o número de parcelas é zero ou negativo", () => {
    expect(gerarParcelas(100, 0, "2026-08-28", 8)).toEqual([]);
    expect(gerarParcelas(100, -1, "2026-08-28", 8)).toEqual([]);
  });
});
