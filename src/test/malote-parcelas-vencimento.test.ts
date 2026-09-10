import { describe, expect, it } from "vitest";
import { gerarParcelas, mesclarDatasParcelas, validarOrdemParcelas } from "@/hooks/useMaloteDespesa";

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

  // SIS-2026-0361 (Iury): parcela não dilui — replica o valor cheio.
  it("numera as parcelas sequencialmente e replica o valor total em todas (não dilui)", () => {
    const parcelas = gerarParcelas(100, 3, "2026-01-31", 15);
    expect(parcelas.map((p) => p.numero_parcela)).toEqual([1, 2, 3]);
    expect(parcelas.map((p) => p.valor)).toEqual([100, 100, 100]);
  });

  it("valor com centavos é replicado igual em todas as parcelas", () => {
    const parcelas = gerarParcelas(39.95, 4, "2026-02-10", 10);
    expect(parcelas.map((p) => p.valor)).toEqual([39.95, 39.95, 39.95, 39.95]);
  });

  it("retorna lista vazia quando o número de parcelas é zero ou negativo", () => {
    expect(gerarParcelas(100, 0, "2026-08-28", 8)).toEqual([]);
    expect(gerarParcelas(100, -1, "2026-08-28", 8)).toEqual([]);
  });

  // SIS-2026-0263 (Iury): dia do desconto liberado até 30 — fevereiro só
  // tem 28/29 dias, então precisa clampar pro último dia do mês em vez de
  // "rolar" pro mês seguinte (new Date(ano, 1, 30) viraria 2 de março).
  // 28/02/2026 cai num sábado — com o ajuste de fim de semana ([SEM-CHAMADO]
  // 09/09), puxa pra sexta 27/02 (antes deste ajuste, o resultado era 28/02).
  it("dia do desconto 30 cai no último dia de fevereiro (não-bissexto), não rola pra março", () => {
    const parcelas = gerarParcelas(200, 2, "2026-01-31", 30);
    expect(parcelas[1].data_vencimento).toBe("2026-02-27");
  });

  it("dia do desconto 30 cai no último dia de fevereiro (bissexto, 2028)", () => {
    const parcelas = gerarParcelas(200, 2, "2028-01-31", 30);
    expect(parcelas[1].data_vencimento).toBe("2028-02-29");
  });

  it("dia do desconto 30 funciona normalmente em mês com 30 dias (abril)", () => {
    const parcelas = gerarParcelas(200, 2, "2026-03-31", 30);
    expect(parcelas[1].data_vencimento).toBe("2026-04-30");
  });

  // [SEM-CHAMADO] (achado real, discutido com o usuário em 09/09): parcela
  // seguinte caindo em fim de semana tem que puxar pro dia útil anterior
  // (sexta), nunca pra frente.
  it("parcela seguinte caindo num sábado puxa pra sexta anterior", () => {
    // dia do desconto 8, agosto/2026 → 08/08 é sábado. Puxa pra 07/08 (sexta).
    const parcelas = gerarParcelas(200, 2, "2026-07-01", 8);
    expect(parcelas[1].data_vencimento).toBe("2026-08-07");
  });

  it("parcela seguinte caindo num domingo puxa pra sexta anterior (2 dias)", () => {
    // dia do desconto 8, novembro/2026 → 08/11 é domingo. Puxa pra 06/11 (sexta).
    const parcelas = gerarParcelas(300, 3, "2026-09-01", 8);
    expect(parcelas[2].data_vencimento).toBe("2026-11-06");
  });

  it("parcela seguinte em dia de semana normal não é afetada pelo ajuste de fim de semana", () => {
    const parcelas = gerarParcelas(200, 2, "2026-08-28", 8);
    expect(parcelas[1].data_vencimento).toBe("2026-09-08"); // terça — sem ajuste
  });

  it("parcela 1 nunca é ajustada por fim de semana (é a data escolhida pelo solicitante)", () => {
    // 2026-08-08 é sábado — parcela 1 mantém a data exata escolhida.
    const parcelas = gerarParcelas(200, 2, "2026-08-08", 8);
    expect(parcelas[0].data_vencimento).toBe("2026-08-08");
  });

  it("suporta até 420 parcelas (limite do SIS-2026-0263)", () => {
    const parcelas = gerarParcelas(4200, 420, "2026-01-15", 15);
    expect(parcelas).toHaveLength(420);
    expect(parcelas[0].numero_parcela).toBe(1);
    expect(parcelas[419].numero_parcela).toBe(420);
    // 420 parcelas a partir de jan/2026, parcela 420 = 419 meses depois →
    // dez/2060; só confere que a data continua íntegra (YYYY-MM-DD) e não
    // estoura/quebra com um número alto de parcelas.
    expect(parcelas[419].data_vencimento).toBe("2060-12-15");
  });
});

// SIS-2026-0361 (Iury): "tem boletos que a data não é a mesma todo mês" — o
// cronograma linear vira sugestão; o usuário pode fixar datas de parcelas
// específicas na mão.
describe("mesclarDatasParcelas", () => {
  const base = gerarParcelas(300, 3, "2026-08-28", 8); // 28/08, 08/09, 08/10

  it("sem datas manuais, devolve o cronograma intacto", () => {
    expect(mesclarDatasParcelas(base, {})).toEqual(base);
  });

  it("substitui só a data das parcelas informadas, sem tocar valor nem número", () => {
    const out = mesclarDatasParcelas(base, { 2: "2026-09-15" });
    expect(out[1].data_vencimento).toBe("2026-09-15");
    expect(out[1].valor).toBe(base[1].valor);
    expect(out[1].numero_parcela).toBe(2);
    expect(out[0].data_vencimento).toBe("2026-08-28");
    expect(out[2].data_vencimento).toBe("2026-10-08");
  });

  it("data manual entra exata, sem passar pelo ajuste de fim de semana", () => {
    // 2026-09-12 é sábado — fica como está, é a data que a pessoa digitou.
    const out = mesclarDatasParcelas(base, { 2: "2026-09-12" });
    expect(out[1].data_vencimento).toBe("2026-09-12");
  });
});

describe("validarOrdemParcelas", () => {
  it("aceita parcelas em ordem crescente, mesmo com dia do mês variando", () => {
    const ps = [
      { numero_parcela: 1, valor: 100, data_vencimento: "2026-08-28" },
      { numero_parcela: 2, valor: 100, data_vencimento: "2026-09-05" },
      { numero_parcela: 3, valor: 100, data_vencimento: "2026-10-03" },
    ];
    expect(validarOrdemParcelas(ps)).toBeNull();
  });

  it("rejeita parcela que vence antes da anterior", () => {
    const ps = [
      { numero_parcela: 1, valor: 100, data_vencimento: "2026-08-28" },
      { numero_parcela: 2, valor: 100, data_vencimento: "2026-08-20" },
    ];
    expect(validarOrdemParcelas(ps)).toMatch(/parcela 2/);
  });

  it("rejeita datas iguais em parcelas consecutivas", () => {
    const ps = [
      { numero_parcela: 1, valor: 100, data_vencimento: "2026-08-28" },
      { numero_parcela: 2, valor: 100, data_vencimento: "2026-08-28" },
    ];
    expect(validarOrdemParcelas(ps)).not.toBeNull();
  });

  it("rejeita data vazia", () => {
    const ps = [
      { numero_parcela: 1, valor: 100, data_vencimento: "2026-08-28" },
      { numero_parcela: 2, valor: 100, data_vencimento: "" },
    ];
    expect(validarOrdemParcelas(ps)).toMatch(/Informe a data da parcela 2/);
  });
});
