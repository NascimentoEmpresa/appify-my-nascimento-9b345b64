import { describe, expect, it } from "vitest";
import { faixaDoAtraso, montarFaturamento, type NfComDatas } from "@/lib/operacional/indicadoresFaturamento";
import { montarLucratividade } from "@/lib/operacional/indicadoresLucratividade";
import { montarFaltas, motivosAfastamento } from "@/lib/operacional/indicadoresPessoas";
import { resumirKaizen, type Iniciativa } from "@/lib/operacional/indicadoresKaizen";
import { custosVazios } from "@/pages/controladoria/faturamento/regras";
import type { NotaFaltas } from "@/lib/relatorios/custoFaltas";

// Operacional › Indicadores, telas 2 a 5 (09/11/2026). Valores fictícios.

const nf = (contrato_id: string, competencia: string, liquido: number, x: Partial<NfComDatas> = {}): NfComDatas => ({
  contrato_id, competencia, tipo_nota: "N", status: "concluida", valor_contrato_exec_total: 0,
  vlr_bruto_total: liquido * 1.2, vlr_liquido_total: liquido, valor_pago: null, desconto_conta_vinculada: 0, ...x,
});
const contratos = new Map([["a", { nome: "CONTRATO A", cliente: "CLIENTE 1" }], ["b", { nome: "CONTRATO B", cliente: "CLIENTE 2" }]]);

describe("2. Faturamento e Recebimentos", () => {
  const nfs = [
    nf("a", "2026-01-01", 1000, { data_emissao: "2026-01-10", data_pagamento: "2026-02-09", valor_pago: 1000 }),
    nf("b", "2026-01-01", 500, { data_emissao: "2026-01-10" }),
    nf("a", "2025-12-01", 800, { data_emissao: "2025-12-05", data_pagamento: "2026-01-04", valor_pago: 800 }),
    nf("b", "2025-08-01", 300, { data_emissao: "2025-08-01" }),
    nf("a", "2026-01-01", 999, { status: "cancelada" }),
    nf("z", "2026-01-01", 5000), // contrato fora do recorte
  ];
  const d = montarFaturamento(nfs, contratos, "2026-01", "2026-03-01");

  it("totais da competência como na tela de Faturamento", () => {
    expect(d.atual).toMatchObject({ notas: 2, liquido: 1500, recebido: 1000, aReceber: 500 });
    expect(d.anterior.liquido).toBe(800);
  });

  it("PMR: dias da emissão ao pagamento das notas pagas", () => {
    expect(d.pmr).toBe(30);
    expect(d.pmrAnterior).toBe(30);
  });

  it("aging de hoje pela emissão + 30 dias", () => {
    // jan/26: 2026-01-10 + 30 = 2026-02-09 → 20 dias em 01/03; ago/25: muito acima de 90.
    expect(d.aging.find((f) => f.nome === "1 a 30 dias")?.valor).toBe(500);
    expect(d.vencido90).toBe(300);
    expect(faixaDoAtraso(0)).toBe("A vencer");
    expect(faixaDoAtraso(91)).toBe("> 90 dias");
  });

  it("por cliente e a última competência com nota", () => {
    expect(d.porCliente.map((c) => c.nome)).toEqual(["CLIENTE 1", "CLIENTE 2"]);
    expect(d.ultimaComNota).toBe("2026-01");
  });
});

describe("3. Lucratividade e Orçamento", () => {
  const custos = new Map([["a|2026-01", { ...custosVazios(), salarios: 600, fgts: 50 }], ["b|2026-01", { ...custosVazios(), salarios: 40_000 }]]);
  const d = montarLucratividade({
    nfs: [nf("a", "2026-01-01", 20_000), nf("b", "2026-01-01", 30_000)],
    contratos: new Map([["a", "A"], ["b", "B"]]),
    custos, admPorMes: new Map([["2026-01", 4_000]]),
  }, "2026-01");

  it("lucro bruto = líquido − custos; margem líquida desconta o rateio", () => {
    expect(d.atual).toMatchObject({ receita: 50_000, custo: 40_650, lucro: 9_350, margem: 18.7, rateio: 4_000, margemLiquida: 10.7 });
  });

  it("composição por rubrica e contratos abaixo de 10%", () => {
    expect(d.composicao.map((c) => [c.id, c.valor])).toEqual([["salarios", 40_600], ["fgts", 50]]);
    expect([d.abaixoDe10, d.classificados]).toEqual([1, 2]);
  });

  it("mês sem nota nem custo fica sem número", () => {
    expect(montarLucratividade({ nfs: [], contratos: new Map(), custos: new Map(), admPorMes: new Map() }, "2026-03").atual).toBeNull();
  });
});

describe("4. Pessoas e Capacidade", () => {
  const nota = (contrato_nome: string, faltas: number, competencia = "2026-01-01"): NotaFaltas => ({
    id: contrato_nome + faltas, numero_nf: null, competencia, data_emissao: null, tipo_nota: "N", variacao: null, status: "concluida",
    situacao_site_pmt: null, situacao_dominio: null, data_pagamento: null, valor_pago: null, contrato_id: contrato_nome, contrato_nome,
    contrato_cliente: null, empresa_id: null, empresa_nome: null, valor_contrato_exec_total: 0, vlr_bruto_total: 0, faltas, itens_falta: [], faltas_calculo: null,
  });

  it("curva ABC das faltas por contrato e o peso dos 10 maiores", () => {
    const f = montarFaltas([nota("X", 70), nota("Y", 20), nota("Z", 6), nota("W", 4), nota("X", 99, "2026-02-01")], "2026-01");
    expect(f.total).toBe(100);
    expect(f.porContrato.map((c) => `${c.nome}${c.classe}`)).toEqual(["XA", "YA", "ZB", "WC"]);
    expect(f.top10).toBe(100);
  });

  it("motivos de afastamento: só em aberto, 3 maiores e Outros", () => {
    const m = motivosAfastamento([
      ...Array(3).fill({ motivo: "Doença", aberto: true }), { motivo: "Acidente", aberto: true }, { motivo: "Acidente", aberto: true },
      { motivo: "Licença", aberto: true }, { motivo: "Outro A", aberto: true }, { motivo: "Doença", aberto: false },
    ]);
    expect(m).toEqual([{ nome: "Doença", valor: 3 }, { nome: "Acidente", valor: 2 }, { nome: "Licença", valor: 1 }, { nome: "Outros", valor: 1 }]);
  });
});

describe("5. Kaizen e Efetividade", () => {
  const ini = (x: Partial<Iniciativa>): Iniciativa => ({
    id: 1, titulo: "t", area: "Controladoria", descricao: null, data_inicio: "2026-05-01", prazo: null,
    status: "Em andamento", resultado: null, economia: null, concluida_em: null, ...x,
  });

  it("conta concluídas, mensurados, economia e entrega no prazo; cancelada não entra", () => {
    const r = resumirKaizen([
      ini({ status: "Concluída", prazo: "2026-06-30", concluida_em: "2026-06-20", resultado: "40% mais rápido", economia: 18_450 }),
      ini({ status: "Concluída", prazo: "2026-06-30", concluida_em: "2026-07-10", economia: 1_000, area: "RH" }),
      ini({ prazo: "2026-01-01" }),
      ini({ status: "Cancelada", economia: 99_999 }),
    ], "2026-11-09");
    expect(r).toMatchObject({ total: 3, concluidas: 2, andamento: 1, mensurados: 1, economia: 19_450, noPrazo: 50, atrasadas: 1 });
    expect(r.porArea[0]).toMatchObject({ area: "Controladoria", total: 2 });
  });
});
