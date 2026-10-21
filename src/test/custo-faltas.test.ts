import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  diasDeFalta, filtrarNotas, fimDoMes, montarPlanilhaCustoFaltas, notaConta, porContrato, porMes, rotuloComp, somaMeses,
  totalCustoFaltas, type FiltrosCustoFaltas, type NotaFaltas,
} from "@/lib/relatorios/custoFaltas";

// =====================================================================
// Relatórios › Custo das Faltas por Contrato (mig 20261021000060).
// O valor é o campo Faltas dos itens da NF; contam as notas do Relatório
// de Serviços (concluídas, sem cancelada/substituída).
// =====================================================================

const nota = (over: Partial<NotaFaltas> = {}): NotaFaltas => ({
  id: "n1", numero_nf: "1370", competencia: "2026-09", data_emissao: "2026-10-05", tipo_nota: "N", variacao: "ITEM 4",
  status: "concluida", situacao_site_pmt: null, situacao_dominio: null, data_pagamento: null, valor_pago: null,
  contrato_id: "c-bento", contrato_nome: "BENTO GONÇALVES - AUX ADM - 002/2021", contrato_cliente: "Prefeitura de Bento",
  empresa_id: "e1", empresa_nome: "NASCIMENTO", valor_contrato_exec_total: 4683.37, vlr_bruto_total: 4683.37,
  faltas: 0, itens_falta: [], faltas_calculo: null, ...over,
});

const F: FiltrosCustoFaltas = { de: "2026-08", ate: "2026-09", contratos: [], empresa: null, tipoNota: null, status: null, soComFalta: false };

const NOTAS: NotaFaltas[] = [
  nota({ id: "a", faltas: 312.22, itens_falta: [{ identificacao: "ITEM 4", faltas: 312.22 }] }),
  nota({ id: "b", competencia: "2026-08", faltas: 100, itens_falta: [{ identificacao: "ITEM 1", faltas: 60 }, { identificacao: "ITEM 2", faltas: 40 }],
    faltas_calculo: [{ item: 0, posto: "Recepção", valor_posto: 3000, dias: 1 }, { item: 1, posto: "Limpeza", valor_posto: 2000, dias: 0.5 }] }),
  nota({ id: "c", contrato_id: "c-ufrgs", contrato_nome: "UFRGS - LIMPEZA GERAL - 047/2022", empresa_id: "e2", empresa_nome: "GRUPO", valor_contrato_exec_total: 100000, faltas: 0 }),
  nota({ id: "d", contrato_id: "c-ufrgs", contrato_nome: "UFRGS - LIMPEZA GERAL - 047/2022", empresa_id: "e2", empresa_nome: "GRUPO", valor_contrato_exec_total: 100000, faltas: 2000,
    tipo_nota: "R", data_pagamento: "2026-10-10", valor_pago: 98000 }),
  // Fora: cancelada, substituída (legada) e nota de fora do período.
  nota({ id: "x1", status: "cancelada", faltas: 999, data_pagamento: "2026-10-01" }),
  nota({ id: "x2", situacao_dominio: "SUBSTITUIDA", faltas: 999 }),
  nota({ id: "x3", competencia: "2026-07", faltas: 999 }),
];

describe("quais notas contam", () => {
  it("a regra do Relatório de Serviços", () => {
    expect(notaConta(nota())).toBe(true);
    expect(notaConta(nota({ status: "rascunho" }))).toBe(false);
    expect(notaConta(nota({ status: "enviada" }))).toBe(false);
    expect(notaConta(nota({ status: "cancelada" }))).toBe(false);
    expect(notaConta(nota({ situacao_site_pmt: "Cancelada" }))).toBe(false);
    expect(notaConta(nota({ situacao_dominio: "SUBSTITUIDA" }))).toBe(false);
  });

  it("filtra período, contratos, empresa, tipo e situação", () => {
    const ids = (f: Partial<FiltrosCustoFaltas>) => filtrarNotas(NOTAS, { ...F, ...f }).map((n) => n.id);
    expect(ids({})).toEqual(["a", "b", "c", "d"]);
    expect(ids({ de: "2026-09" })).toEqual(["a", "c", "d"]);
    expect(ids({ contratos: ["UFRGS - LIMPEZA GERAL - 047/2022"] })).toEqual(["c", "d"]);
    expect(ids({ empresa: "e1" })).toEqual(["a", "b"]);
    expect(ids({ tipoNota: "R" })).toEqual(["d"]);
    expect(ids({ status: "pago" })).toEqual(["d"]);
    expect(ids({ status: "pendente" })).toEqual(["a", "b", "c"]);
  });
});

describe("agrupamentos", () => {
  const ns = filtrarNotas(NOTAS, F);

  it("por contrato: soma faltas, executado e o peso da falta", () => {
    const cs = porContrato(ns);
    const bento = cs.find((c) => c.contrato_id === "c-bento")!;
    expect(bento.faltas).toBe(412.22);
    expect(bento.executado).toBe(9366.74);
    expect(bento.pctExecutado).toBeCloseTo(412.22 / 9366.74);
    expect(bento.notas).toBe(2);
    expect(bento.notasComFalta).toBe(2);
    expect(bento.mesesComFalta).toBe(2);
    expect(bento.diasFalta).toBe(1.5);
    expect(bento.porMes.get("2026-08")).toBe(100);
    const ufrgs = cs.find((c) => c.contrato_id === "c-ufrgs")!;
    expect([ufrgs.faltas, ufrgs.notas, ufrgs.notasComFalta, ufrgs.mesesComFalta]).toEqual([2000, 2, 1, 1]);
  });

  it("por mês inclui o mês sem nota, com zero", () => {
    expect(porMes(ns, "2026-07", "2026-09").map((m) => [m.competencia, m.faltas, m.contratosComFalta])).toEqual([
      ["2026-07", 0, 0], ["2026-08", 100, 1], ["2026-09", 2312.22, 2],
    ]);
  });

  it("total", () => {
    const t = totalCustoFaltas(ns);
    expect(t.faltas).toBe(2412.22);
    expect([t.contratos, t.contratosComFalta, t.notas, t.notasComFalta, t.diasFalta]).toEqual([2, 2, 4, 3, 1.5]);
    expect(totalCustoFaltas([]).pctExecutado).toBeNull();
  });

  it("centavos não acumulam erro de ponto flutuante", () => {
    const muitas = Array.from({ length: 10 }, (_, i) => nota({ id: String(i), faltas: 0.1 }));
    expect(totalCustoFaltas(muitas).faltas).toBe(1);
    expect(porContrato(muitas)[0].faltas).toBe(1);
  });

  it("dias do cálculo por dias", () => {
    expect(diasDeFalta(nota())).toBe(0);
    expect(diasDeFalta(nota({ faltas_calculo: [{ item: 0, posto: null, valor_posto: null, dias: 2 }, { item: 1, posto: null, valor_posto: null, dias: 3 }] }))).toBe(5);
  });
});

describe("meses", () => {
  it("rótulos e contas", () => {
    expect(rotuloComp("2026-09")).toBe("set/2026");
    expect(somaMeses("2026-01", -1)).toBe("2025-12");
    expect(somaMeses("2026-10", -11)).toBe("2025-11");
    expect(fimDoMes("2026-02")).toBe("2026-02-28");
    expect(fimDoMes("2026-12")).toBe("2026-12-31");
  });
});

describe("Excel", () => {
  it("abas, valores em número com formato e o detalhe por item", () => {
    const ns = filtrarNotas(NOTAS, F);
    const wb = montarPlanilhaCustoFaltas({ de: F.de, ate: F.ate, filtrosTexto: [], notas: ns, soComFalta: false, geradoEm: new Date("2026-10-21T12:00:00Z") });
    expect(wb.SheetNames).toEqual(["Resumo", "Por contrato", "Contrato x mês", "Por mês", "Notas com falta"]);
    const json = (aba: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[aba]);

    const contr = json("Por contrato");
    expect(contr.map((c) => c.Contrato)).toEqual(["UFRGS - LIMPEZA GERAL - 047/2022", "BENTO GONÇALVES - AUX ADM - 002/2021"]); // maior falta primeiro
    expect(contr[1]["Faltas (R$)"]).toBe(412.22);
    expect(wb.Sheets["Por contrato"].D2.z).toBe('"R$" #,##0.00');
    expect(wb.Sheets["Por contrato"].F2.z).toBe("0.00%");

    const cm = json("Contrato x mês");
    expect(cm.at(-1)).toMatchObject({ Contrato: "TOTAL", "ago/2026": 100, "set/2026": 2312.22, Total: 2412.22 });

    const det = json("Notas com falta");
    expect(det).toHaveLength(4); // b tem 2 itens, a e d um cada
    expect(det.filter((l) => l.NF === "1370" && l["Item / posto"] === "ITEM 2")[0]["Faltas do item (R$)"]).toBe(40);
    expect(det.find((l) => l["Situação"] === "Pago")!.Contrato).toBe("UFRGS - LIMPEZA GERAL - 047/2022");

    const resumo = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Resumo, { header: 1 });
    expect(resumo.find((l) => l[0] === "Total descontado por faltas")![1]).toBe(2412.22);
    expect(resumo.find((l) => l[0] === "Período (competência)")![1]).toBe("ago/2026 a set/2026");
  });

  it("só com falta tira da aba Por contrato quem não teve", () => {
    const ns = filtrarNotas(NOTAS, { ...F, de: "2026-09", ate: "2026-09" }).filter((n) => n.id !== "d");
    const wb = montarPlanilhaCustoFaltas({ de: "2026-09", ate: "2026-09", filtrosTexto: [], notas: ns, soComFalta: true });
    expect(XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Por contrato"]).map((c) => c.Contrato)).toEqual(["BENTO GONÇALVES - AUX ADM - 002/2021"]);
  });
});
