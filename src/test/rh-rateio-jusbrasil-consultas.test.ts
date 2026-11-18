// RH › Rateio de Despesas — Jus Brasil por CONSULTAS (18/11/2026).
//
// Prova com a fatura de outubro/2026 ("Rateio JUSBRASIL.xlsx" + PDF da
// fatura, R$ 959,20, 120 consultas): o valor de cada contrato tem que ser o
// da coluna da direita destacada em amarelo pelo RH (G = 959,20 ÷ 120 ×
// consultas). Antes o ERP rateava pelo faturamento (coluna E) e cada linha
// saía diferente.
import { describe, expect, it } from "vitest";
import {
  calcularRateio, criterioPadrao, distribuirPorUnidade, lerPlanilhaJusBrasil, resumirRateio, type ItemRateio,
} from "@/lib/rh/rateioDespesas";

// [contrato, faturamento (C), consultas (F), valor amarelo (G)] — linhas 3 a 96, na ordem da planilha.
const OUTUBRO_2026: [string, number, number, number][] = [
  ["CANAA", 91883.96, 0, 0.00],
  ["BENTO GONÇALVES  - LIMPEZA - 029/2025", 243057.16, 0, 0.00],
  ["BENTO GONÇALVES  - LIMPEZA - 067/2019", 0, 0, 0.00],
  ["BENTO GONÇALVES - AUX ADM - 002/2021", 143124.2, 5, 39.97],
  ["BENTO GONÇALVES LIMPEZA - 048/2026", 0, 8, 63.95],
  ["CARLOS BARBOSA - 161/2022", 0, 0, 0.00],
  ["CAXIAS DO SUL  -2020/1003", 0, 0, 0.00],
  ["CAXIAS DO SUL  -2025/162", 72207.72, 0, 0.00],
  ["CAXIAS DO SUL - 2026/95", 0, 1, 7.99],
  ["CHARQUEADAS - 005/2021", 35794.78, 0, 0.00],
  ["CHARQUEADAS - 168/2021", 0, 0, 0.00],
  ["CHARQUEADAS - 249 /2020", 314635.37, 0, 0.00],
  ["EMBRAPA - 2021/93", 197683.11, 0, 0.00],
  ["EMBRAPA - CANOINHA - 47/2024", 43992.2, 1, 7.99],
  ["EMBRAPA CLIMA TEMPERADO - 2026/02", 0, 0, 0.00],
  ["FUNARBE HAGG", 0, 0, 0.00],
  ["FURG HU - 006/2023", 150269.2, 1, 7.99],
  ["FURG JARDINAGEM  - 049/2022", 74926.31, 0, 0.00],
  ["HCPA - 753739", 0, 0, 0.00],
  ["HCPA - 993057", 0, 0, 0.00],
  ["HCPA - MENSAGEIROS - 1249781/2024", 10196.02, 0, 0.00],
  ["HCPA - MENSAGEIROS - 1346659/2024", 5098.01, 0, 0.00],
  ["HCPA - MENSAGEIROS - 1610628.2025", 4750, 1, 7.99],
  ["HUSM SANTA MARIA - LAVANDERIA   -  020/2021", 273073.02, 0, 0.00],
  ["MARAU - 127/2022", 0, 0, 0.00],
  ["PENHA LIMPEZA - 039/2025", 76148.01, 0, 0.00],
  ["PM TRIUNFO MOTORISTAS", 0, 0, 0.00],
  ["POLÍCIA CIVIL RS LIMPEZA - 066/2026", 0, 16, 127.89],
  ["PREF POA SMS RECEPÇÃO - 98672/2025", 837238.77, 9, 71.94],
  ["ROSÁRIO DO SUL - 188.2024", 0, 0, 0.00],
  ["SAMU PE - 62.2024", 0, 0, 0.00],
  ["SAMU TELEFONISTAS - 96397/2025", 178516.7, 0, 0.00],
  ["SÃO SEPE - 91/2023", 0, 0, 0.00],
  ["SEMAE - 3038/2020", 111897.67, 0, 0.00],
  ["TJRS - 023/2025", 518403.45, 0, 0.00],
  ["TJRS - 262/2022", 0, 0, 0.00],
  ["TRIUNFO COLETA DE LIXO - 089.2026", 0, 0, 0.00],
  ["TRIUNFO LIMPEZA - 172/2018", 0, 0, 0.00],
  ["TRIUNFO MOTORISTA 59.2026", 0, 0, 0.00],
  ["TRIUNFO MOTORISTAS - 213.2025", 8592, 0, 0.00],
  ["TRIUNFO OP. MÁQUINA - 211.2025", 0, 0, 0.00],
  ["TRIUNFO OP. MÁQUINA - 68/2026", 0, 0, 0.00],
  ["UFFS - 041/2021", 0, 0, 0.00],
  ["UFFS CERRO LARGO - 041/2021", 96794.55, 1, 7.99],
  ["UFFS CHAPECÓ - 041/2021", 299182.89, 1, 7.99],
  ["UFFS ERECHIM - 041/2021", 134104.47, 1, 7.99],
  ["UFFS LARANJEIRAS - 041/2021", 138358.28, 0, 0.00],
  ["UFFS PASSO FUNDO - 041/2021", 57443.29, 0, 0.00],
  ["UFFS REALEZA - 041/2021", 195971.7, 0, 0.00],
  ["UFRGS - ALMOXARIFE - 031/2019", 0, 0, 0.00],
  ["UFRGS - AUXILIAR DE SAÚDE BUCAL - 033/2021", 65699.41, 0, 0.00],
  ["UFRGS - CARREGADORES - 045/2019", 0, 0, 0.00],
  ["UFRGS - CARREGADORES - 095/2024", 94137.95, 1, 7.99],
  ["UFRGS - COPA E COZINHA - 025/2025", 41039.92, 0, 0.00],
  ["UFRGS DIGITADORES - 014/2026", 0, 5, 39.97],
  ["UFRGS - JARDINAGEM - 010/2020", 0, 0, 0.00],
  ["UFRGS - JARDINAGEM - 062/2025", 320944.37, 6, 47.96],
  ["UFRGS - LIMPEZA - 020/2022", 195223.92, 2, 15.99],
  ["UFRGS - LIMPEZA GERAL - 047/2022", 1288596.04, 23, 183.85],
  ["UFRGS - MOTORISTAS - 034/2022", 612407.58, 0, 0.00],
  ["UFRGS INTERPRETE DE LIBRAS C. 009.2026", 0, 0, 0.00],
  ["VERANOPOLIS   -  001/2021", 157406.76, 3, 23.98],
  ["CAPAO DA CANOA-  194/2020", 0, 0, 0.00],
  ["CAPAO DA CANOA-  044/2020", 8693.94, 0, 0.00],
  ["TRIUNFO LIMPEZA RUA", 0, 0, 0.00],
  ["FUNARBE - AGRO - 2617567/2024", 0, 0, 0.00],
  ["ROSÁRIO DO SUL - 237.2024", 0, 0, 0.00],
  ["FUNARBE PELOTAS - 58164/2025", 21250.77, 0, 0.00],
  ["GUAPORÉ LIMPEZA SMED EMERGENCIAL - 063/2026", 0, 2, 15.99],
  ["CAMARA DE RIO GRANDE - PORTARIA 002/2023", 40029.63, 0, 0.00],
  ["CAMARA DE RIO GRANDE - LIMPEZA 001/2023", 74035.45, 0, 0.00],
  ["DMAE - 895/0", 146097.25, 0, 0.00],
  ["FARROUPILHA VIGIA E RECEPÇÃO - 143/2022", 0, 0, 0.00],
  ["FARROUPILHA - 327/2021", 0, 0, 0.00],
  ["FARROUPILHA MOT", 0, 0, 0.00],
  ["IPAM - 012/2022", 14784.81, 0, 0.00],
  ["IPASEM - 13/2022", 22848.66, 0, 0.00],
  ["SALTO DO JACUI - 722/2021", 152528.2, 0, 0.00],
  ["HOSPITAL SÃO CAMILO - 001/2019", 0, 0, 0.00],
  ["HOSPITAL SÃO CAMILO - 50163.2025", 49926.92, 0, 0.00],
  ["TRIUNFO VIGIAS - 33/2024", 515802.35, 2, 15.99],
  ["FLORES DA CUNHA - 237/2020", 0, 0, 0.00],
  ["FURG - PORTARIA - 55/2023", 393555.68, 0, 0.00],
  ["SECRETARIA DA CULTURA POA - PORTARIA - 88123/2024", 23218.34, 1, 7.99],
  ["FABRICIO PETROQUIMICA", 0, 0, 0.00],
  ["TRIUNFO VIGIAS - 247/2018", 0, 0, 0.00],
  ["ROSARIO DO SUL - 048.2025", 0, 0, 0.00],
  ["ADM E ESTAGIARIOS - SN", 0, 0, 0.00],
  ["ADM E ESTAGIARIOS - NH", 0, 2, 15.99],
  ["ADM E ESTAGIARIOS - HAGG", 0, 1, 7.99],
  ["VERANÓPOLIS RECEP EMERGENCIAL - 151.2026", 73900.22, 0, 0.00],
  ["UFRGS AUXILIAR DE SAUDE BUCAL - 030.2026", 70621.08, 0, 0.00],
  ["CEITEC LIMPEZA - 025.2026 ", 58423.67, 1, 7.99],
  ["IRGA APOIO ADMINISTRATIVO - 049.2026", 444999.32, 26, 207.83],
];

const VALOR_FATURA = 959.2;

// Matriz como o XLSX.utils.sheet_to_json(header:1) devolve a planilha.
const matriz = (): unknown[][] => [
  [],
  [null, "CONTRATOS", "FATURAMENTO", null, "Rateio", "Consultas"],
  ...OUTUBRO_2026.map(([nome, fat, cons]) => [null, nome, fat, null, null, cons]),
  [null, 87, 9199515.08, 1, 959.2, 120, 959.2],
];

const ratear = () => {
  const linhas = lerPlanilhaJusBrasil(matriz());
  const itens: ItemRateio[] = linhas.map((l, i) => ({
    contrato_id: String(i), contrato_nome: l.nome, base: l.consultas, percentual: 0, valor: 0, ajustado: false,
  }));
  return calcularRateio(VALOR_FATURA, itens, criterioPadrao("jusbrasil"));
};

describe("Jus Brasil — outubro/2026 bate com a coluna amarela", () => {
  it("critério padrão do Jus Brasil é consultas", () => {
    expect(criterioPadrao("jusbrasil")).toBe("consultas");
  });

  it("a planilha tem as 94 linhas e 120 consultas", () => {
    expect(OUTUBRO_2026).toHaveLength(94);
    expect(OUTUBRO_2026.reduce((a, l) => a + l[2], 0)).toBe(120);
    expect(OUTUBRO_2026.filter((l) => l[3] > 0)).toHaveLength(24);
  });

  it("cada linha recebe o valor da coluna amarela (só o centavo da sobra vai para o IRGA)", () => {
    const r = ratear();
    expect(r).toHaveLength(94);
    const diferentes = r
      .map((it, i) => ({ nome: it.contrato_nome, obtido: it.valor, amarelo: OUTUBRO_2026[i][3] }))
      .filter((x) => Math.abs(x.obtido - x.amarelo) > 0.001);
    // A coluna amarela soma 959,19 (cada linha arredondada sozinha) e a
    // fatura é 959,20: o centavo que falta vai para quem tem mais consultas.
    expect(diferentes).toEqual([
      { nome: "IRGA APOIO ADMINISTRATIVO - 049.2026", obtido: 207.84, amarelo: 207.83 },
    ]);
  });

  it("fecha com o valor da fatura (dá para conferir e mandar ao Malote)", () => {
    const r = ratear();
    expect(resumirRateio(VALOR_FATURA, r).fecha).toBe(true);
    expect(Math.round(OUTUBRO_2026.reduce((a, l) => a + l[3], 0) * 100) / 100).toBe(959.19);
  });

  it("pelo faturamento (critério antigo) os valores NÃO batiam", () => {
    const linhas = lerPlanilhaJusBrasil(matriz());
    const itens: ItemRateio[] = linhas.map((l, i) => ({
      contrato_id: String(i), contrato_nome: l.nome, base: l.faturamento, percentual: 0, valor: 0, ajustado: false,
    }));
    const r = calcularRateio(VALOR_FATURA, itens, "faturamento");
    const irga = r.find((x) => x.contrato_nome.startsWith("IRGA"));
    expect(irga?.valor).toBe(46.4);
    const policia = r.find((x) => x.contrato_nome.startsWith("POLÍCIA CIVIL"));
    expect(policia?.valor).toBe(0);
  });
});

describe("distribuirPorUnidade", () => {
  it("arredonda cada linha sozinha, como a planilha", () => {
    // 10 ÷ 3 = 3,333…: 1 unidade = 3,33; 2 unidades = 6,67.
    expect(distribuirPorUnidade(10, [1, 2])).toEqual([3.33, 6.67]);
  });
  it("sobra de centavo vai para quem tem mais unidades", () => {
    expect(distribuirPorUnidade(10, [1, 1, 1])).toEqual([3.34, 3.33, 3.33]);
    expect(distribuirPorUnidade(10, [1, 5, 1, 2]).reduce((a, x) => a + x, 0)).toBeCloseTo(10, 10);
  });
  it("excesso de centavo sai de quem tem mais unidades", () => {
    // 0,01 ÷ 2 = 0,005 → arredonda para 0,01 cada = 0,02: tira 1 centavo
    // (empate de unidades: sai do primeiro da lista).
    expect(distribuirPorUnidade(0.01, [1, 1])).toEqual([0, 0.01]);
  });
  it("base zero não recebe nada; tudo zero dá zero", () => {
    expect(distribuirPorUnidade(10, [0, 4, -1])).toEqual([0, 10, 0]);
    expect(distribuirPorUnidade(10, [0, 0])).toEqual([0, 0]);
  });
});
