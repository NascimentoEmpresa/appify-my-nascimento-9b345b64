import { describe, expect, it } from "vitest";
import {
  agruparFaturamento,
  aReceberDaNf,
  contaNoFaturamento,
  custosPorContratoMes,
  faixaDaMargem,
  lucroBruto,
  lucroRecebido,
  rubricaDaLinha,
  rubricaDeCusto,
  semClassificacao,
  totalCustos,
  type LigacoesRubrica,
  type NfFaturamento,
} from "@/pages/controladoria/faturamento/regras";

const nf = (o: Partial<NfFaturamento> = {}): NfFaturamento => ({
  contrato_id: "c1",
  competencia: "2026-01-01",
  tipo_nota: "N",
  status: "concluida",
  valor_contrato_exec_total: 1000,
  vlr_bruto_total: 1000,
  vlr_liquido_total: 900,
  valor_pago: null,
  desconto_conta_vinculada: 0,
  ...o,
});

describe("rubricaDeCusto", () => {
  it("classifica as rubricas da folha", () => {
    expect(rubricaDeCusto("SALÁRIO")).toBe("salarios");
    expect(rubricaDeCusto("13 INTEGRAL")).toBe("salarios");
    expect(rubricaDeCusto("FÉRIAS")).toBe("ferias");
    expect(rubricaDeCusto("RESCISÃO")).toBe("rescisoes");
    expect(rubricaDeCusto("FGTS RESCISÃO")).toBe("rescisoes");
    expect(rubricaDeCusto("FGTS MENSAL")).toBe("fgts");
    expect(rubricaDeCusto("INSS MENSAL")).toBe("inss");
    expect(rubricaDeCusto("VA")).toBe("va");
    expect(rubricaDeCusto("VT")).toBe("vt");
  });
  it("salário-educação é encargo (Outras), não salário", () => {
    expect(rubricaDeCusto("SALÁRIO EDUC")).toBe("outras");
  });
  it("o que não é custo fica de fora", () => {
    for (const n of ["TRANSFERÊNCIA ENTRE CONTAS", "Aplicação Financeira", "RECEBIMENTO DE NOTA", "EMPRESTIMOS", "FINANCIAMENTOS", "DISTRIBUIÇÃO"]) {
      expect(rubricaDeCusto(n)).toBeNull();
    }
  });
  it("demais classificações caem em Outras; sem classificação não é custo de rubrica nenhuma", () => {
    expect(rubricaDeCusto("MATERIAL DE LIMPEZA")).toBe("outras");
    expect(rubricaDeCusto(null)).toBeNull();
    expect(rubricaDeCusto("  ")).toBeNull();
  });
});

describe("rentabilidade pela margem bruta", () => {
  it("faixas da Controladoria: 20 / 15 / 10 / 0", () => {
    expect(faixaDaMargem(0.2)).toBe("excelente");
    expect(faixaDaMargem(0.3361)).toBe("excelente");
    expect(faixaDaMargem(0.1999)).toBe("bom");
    expect(faixaDaMargem(0.15)).toBe("bom");
    expect(faixaDaMargem(0.1499)).toBe("atencao");
    expect(faixaDaMargem(0.1)).toBe("atencao");
    expect(faixaDaMargem(0.0999)).toBe("critico");
    expect(faixaDaMargem(0)).toBe("critico");
    expect(faixaDaMargem(-0.0001)).toBe("prejuizo");
    expect(faixaDaMargem(-0.5)).toBe("prejuizo");
  });
  it("compara a margem como aparece na tela (duas casas), sem 19,996% virar Excelente nem ficar em Bom com 20,00%", () => {
    expect(faixaDaMargem(0.19996)).toBe("excelente");
    expect(faixaDaMargem(0.19994)).toBe("bom");
  });
  it("sem faturamento não há faixa", () => {
    expect(faixaDaMargem(null)).toBeNull();
  });
  it("lucro faturamento usa o líquido; lucro recebido usa o recebido; mesmos custos", () => {
    expect(lucroBruto(1000, 400)).toEqual({ lucro: 600, margem: 0.6 });
    expect(lucroRecebido(700, 400)).toBe(300);
    expect(lucroRecebido(0, 400)).toBe(-400);
  });
});

describe("ligação manual Classificação × rubrica", () => {
  const l = (classificacao_id: string | null, classificacao_nome: string | null) => ({ classificacao_id, classificacao_nome });
  it("sem ligação vale o automático por nome", () => {
    expect(rubricaDaLinha(l("a", "SALÁRIO"))).toBe("salarios");
    expect(rubricaDaLinha(l("b", "FOLHA ADMINISTRATIVO"), new Map())).toBe("outras");
  });
  it("a ligação manual vence o nome, inclusive para tirar do cálculo", () => {
    const lig: LigacoesRubrica = new Map([["b", "salarios"], ["c", "nao_custo"], ["d", "outras"]]);
    expect(rubricaDaLinha(l("b", "FOLHA ADMINISTRATIVO"), lig)).toBe("salarios");
    expect(rubricaDaLinha(l("c", "JUROS"), lig)).toBeNull();
    expect(rubricaDaLinha(l("d", "SALÁRIO"), lig)).toBe("outras");
  });
  it("ligar uma classificação que o automático excluiria a traz para o custo", () => {
    expect(rubricaDaLinha(l("e", "CONSIGNADO"), new Map([["e", "outras"]]))).toBe("outras");
    expect(rubricaDaLinha(l("f", "TRANSFERÊNCIA ENTRE CONTAS"), new Map([["f", "vt"]]))).toBe("vt");
  });
  it("custosPorContratoMes usa as ligações e semClassificacao conta o que ficou de fora", () => {
    const linhas = [
      { tipo: "saida" as const, data_pagamento: "2026-01-10", contrato_id: "c1", classificacao_id: "b", classificacao_nome: "FOLHA ADMINISTRATIVO", valor: 100 },
      { tipo: "saida" as const, data_pagamento: "2026-01-10", contrato_id: "c1", classificacao_id: null, classificacao_nome: null, valor: 40 },
      { tipo: "saida" as const, data_pagamento: "2026-01-10", contrato_id: null, classificacao_id: null, classificacao_nome: null, valor: 9 },
    ];
    expect(custosPorContratoMes(linhas).get("c1|2026-01")!.outras).toBe(100);
    expect(custosPorContratoMes(linhas, new Map([["b", "salarios"]])).get("c1|2026-01")!.salarios).toBe(100);
    expect(semClassificacao(linhas)).toEqual({ linhas: 1, valor: 40 });
  });
});

describe("custosPorContratoMes", () => {
  it("só conta saída com contrato e que seja custo, pelo mês do pagamento", () => {
    const m = custosPorContratoMes([
      { tipo: "saida", data_pagamento: "2026-01-10", contrato_id: "c1", classificacao_nome: "SALÁRIO", valor: 100 },
      { tipo: "saida", data_pagamento: "2026-01-20", contrato_id: "c1", classificacao_nome: "VA", valor: 50 },
      { tipo: "saida", data_pagamento: "2026-01-20", contrato_id: "c1", classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS", valor: 9999 },
      { tipo: "saida", data_pagamento: "2026-01-20", contrato_id: null, classificacao_nome: "SALÁRIO", valor: 7 },
      { tipo: "entrada", data_pagamento: "2026-01-20", contrato_id: "c1", classificacao_nome: "SALÁRIO", valor: 5 },
      { tipo: "saida", data_pagamento: "2026-02-01", contrato_id: "c1", classificacao_nome: "SALÁRIO", valor: 30 },
    ]);
    const jan = m.get("c1|2026-01")!;
    expect(jan.salarios).toBe(100);
    expect(jan.va).toBe(50);
    expect(totalCustos(jan)).toBe(150);
    expect(m.get("c1|2026-02")!.salarios).toBe(30);
    expect(m.size).toBe(2);
  });
});

describe("faturamento", () => {
  it("só nota N validada, nem cancelada nem substituída", () => {
    expect(contaNoFaturamento(nf())).toBe(true);
    expect(contaNoFaturamento(nf({ tipo_nota: "A" }))).toBe(false);
    expect(contaNoFaturamento(nf({ status: "enviada" }))).toBe(false);
    expect(contaNoFaturamento(nf({ status: "cancelada" }))).toBe(false);
    expect(contaNoFaturamento(nf({ situacao_dominio: "SUBSTITUIDA" }))).toBe(false);
  });

  it("agrupa por mês somando bruto, líquido, descontos e recebido", () => {
    const m = agruparFaturamento(
      [nf({ valor_pago: 900, data_pagamento: "2026-02-05" }), nf({ vlr_bruto_total: 500, vlr_liquido_total: 450 }), nf({ status: "cancelada" })],
      (n) => n.competencia.slice(0, 7)
    );
    const t = m.get("2026-01")!;
    expect(t.bruto).toBe(1500);
    expect(t.liquido).toBe(1350);
    expect(t.descontos).toBe(150);
    expect(t.recebido).toBe(900);
    expect(t.aReceber).toBe(450);
    expect(t.notas).toBe(2);
  });

  it("a receber: nota paga zera; parcial abate pago e conta vinculada", () => {
    expect(aReceberDaNf(nf({ data_pagamento: "2026-02-01", valor_pago: 900 }))).toBe(0);
    expect(aReceberDaNf(nf({ valor_pago: 300, desconto_conta_vinculada: 100 }))).toBe(500);
    expect(aReceberDaNf(nf({ valor_pago: 2000 }))).toBe(0);
  });

  it("SIS-2026-0609: descontos pós-emissão não estão no líquido — abatem o que falta receber", () => {
    expect(aReceberDaNf(nf({ descontos_pos_emissao_total: 150 }))).toBe(750);
    expect(aReceberDaNf(nf({ valor_pago: 300, descontos_pos_emissao_total: 100 }))).toBe(500);
    expect(aReceberDaNf(nf({ descontos_pos_emissao_total: null }))).toBe(900);
  });
});

describe("lucroBruto", () => {
  it("margem sobre o líquido; sem faturamento não há margem", () => {
    expect(lucroBruto(1000, 600)).toEqual({ lucro: 400, margem: 0.4 });
    expect(lucroBruto(0, 600)).toEqual({ lucro: -600, margem: null });
  });
});
