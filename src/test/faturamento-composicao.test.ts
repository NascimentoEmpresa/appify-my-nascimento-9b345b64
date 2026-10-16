// SIS-2026-0641: "como esse número é formado" — a conta do modal tem que fechar com a célula clicada.
import { describe, expect, it } from "vitest";
import {
  despesasDoEscopo, montarComposicao, type ContextoDetalhe, type EscopoDetalhe, type NfDetalhe,
} from "@/pages/controladoria/faturamento/composicao";
import type { LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";

const nf = (o: Partial<NfDetalhe> = {}): NfDetalhe => ({
  id: Math.random().toString(36).slice(2),
  numero_nf: "1",
  contrato_id: "c1",
  competencia: "2026-01-01",
  tipo_nota: "N",
  status: "concluida",
  valor_contrato_exec_total: 1000,
  vlr_bruto_total: 1000,
  vlr_liquido_total: 900,
  valor_pago: null,
  desconto_conta_vinculada: 0,
  contrato: { nome: "Contrato 1", cliente: "Cliente A" },
  ...o,
});

const custo = (o: Partial<LinhaFluxoCusto> = {}): LinhaFluxoCusto => ({
  tipo: "saida", data_pagamento: "2026-01-10", contrato_id: "c1", classificacao_id: null, classificacao_nome: "SALARIOS", valor: 100, ...o,
});

const ctx = (custos: LinhaFluxoCusto[] = [], execPorContrato: Record<string, { valor: number; fonte: any }> = {}): ContextoDetalhe => ({
  contratoNome: (id) => `Contrato ${id}`,
  execDe: (id) => execPorContrato[id] ?? { valor: 0, fonte: "sem_valor" },
  custos,
});

const escopo = (o: Partial<EscopoDetalhe> = {}): EscopoDetalhe => ({ titulo: "jan/26", nfs: [nf()], meses: ["2026-01"], contratoIds: ["c1"], ...o });
const valorDe = (c: ReturnType<typeof montarComposicao>, rotulo: string) => c.conta.find((l) => l.rotulo === rotulo)?.valor;

describe("notas: a escada do bruto ao saldo", () => {
  it("destaca a linha clicada e fecha no A Receber", () => {
    const e = escopo({ nfs: [nf({ desconto_conta_vinculada: 100 }), nf({ valor_pago: 900, data_pagamento: "2026-02-01" })] });
    const c = montarComposicao("contaVinculada", e, ctx());
    expect(c.conta.find((l) => l.destaque)?.rotulo).toBe("Conta vinculada");
    expect(valorDe(c, "Valor Bruto")).toBe(2000);
    expect(valorDe(c, "Valor Líquido")).toBe(1800);
    expect(valorDe(c, "A Receber")).toBe(800);
  });

  it("A Receber lista só as notas com saldo; Recebido só as pagas", () => {
    const e = escopo({ nfs: [nf({ vlr_liquido_total: 500 }), nf({ valor_pago: 900, data_pagamento: "2026-02-01" })] });
    expect(montarComposicao("aReceber", e, ctx()).tabela?.linhas).toHaveLength(1);
    expect(montarComposicao("recebido", e, ctx()).tabela?.linhas).toHaveLength(1);
    expect(montarComposicao("bruto", e, ctx()).tabela?.linhas).toHaveLength(2);
  });
});

describe("executável", () => {
  it("mostra a origem de cada contrato e a diferença para o bruto faturado", () => {
    const c = montarComposicao("exec", escopo({ contratoIds: ["c1", "c2"] }), ctx([], { c1: { valor: 1500, fonte: "planilha" }, c2: { valor: 700, fonte: "cadastro" } }));
    expect(valorDe(c, "Valor Exec.")).toBe(2200);
    expect(valorDe(c, "Diferença Exec. × Fat.")).toBe(1200); // 2200 − 1000 bruto
    expect(c.tabela?.linhas.map((l) => l[1])).toEqual(["Planilha de custo", "Valor Executado Mensal do cadastro"]);
    expect(c.aviso).toBeUndefined();
  });

  it("contrato que faturou sem executável gera aviso explicando o que preencher", () => {
    const c = montarComposicao("diferenca", escopo(), ctx());
    expect(valorDe(c, "Valor Exec.")).toBe(0);
    expect(c.aviso).toMatch(/faturaram sem executável/);
    expect(c.tabela?.linhas[0][1]).toBe("Sem planilha e sem valor no cadastro");
  });
});

describe("despesas", () => {
  const custos = [
    custo({ valor: 300 }),
    custo({ valor: 50, classificacao_nome: "FERIAS" }),
    custo({ valor: 70, data_pagamento: "2026-02-10" }), // outro mês
    custo({ valor: 90, contrato_id: "c9" }), // outro contrato
    custo({ valor: 40, classificacao_nome: "TRANSFERENCIA ENTRE CONTAS" }), // não é custo
    custo({ valor: 25, tipo: "entrada" }),
  ];

  it("soma só saída com contrato, do mês e dos contratos do recorte, que vira custo", () => {
    const d = despesasDoEscopo(custos, escopo());
    expect(d.total).toBe(350);
    expect(d.porRubrica).toEqual([{ rotulo: "Salários", valor: 300 }, { rotulo: "Férias", valor: 50 }]);
    expect(d.linhas.map((l) => l.valor)).toEqual([300, 50]);
  });

  it("a conta do modal soma as rubricas e fecha em Despesas", () => {
    const c = montarComposicao("despesas", escopo(), ctx(custos));
    expect(c.conta.map((l) => l.rotulo)).toEqual(["Salários", "Férias", "Despesas"]);
    expect(valorDe(c, "Despesas")).toBe(350);
  });
});

describe("lucro e margem", () => {
  it("Lucro = Líquido − Despesas; Recebido − Despesas; margem sobre o líquido", () => {
    const e = escopo({ nfs: [nf({ vlr_liquido_total: 1000, valor_pago: 800, data_pagamento: "2026-02-01" })] });
    const c = montarComposicao("lucroFat", e, ctx([custo({ valor: 200 })]));
    expect(valorDe(c, "Lucro Faturamento")).toBe(800);
    expect(valorDe(c, "Lucro Recebido")).toBe(600);
    expect(valorDe(c, "Margem Bruta (Lucro Faturamento ÷ Líquido)")).toBe("80,00%");
    expect(c.tabela?.linhas[0]).toEqual(["Contrato c1", 1000, 200, 800, "80,00%"]);
  });
});
