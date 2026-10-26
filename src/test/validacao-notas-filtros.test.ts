import { describe, expect, it } from "vitest";
import {
  contratoCombinaComEmpresa,
  contratosDasNotasDaEmpresa,
  notaCombinaComStatus,
  statusExibidoNaValidacao,
} from "@/pages/financeiro/controle-notas/filtros";

const nota = (o: Partial<Parameters<typeof statusExibidoNaValidacao>[0]> & { id?: string } = {}) => ({
  status: "concluida",
  empresa_id: "e1",
  contrato_id: "c1",
  situacao_site_pmt: null,
  situacao_dominio: null,
  contrato: { id: "c1", nome: "GUAPORÉ LIMPEZA SMED EMERGENCIAL - 063/2026" },
  ...o,
});

describe("SIS-2026-0697 — filtro de status da Validação de Notas", () => {
  const nf36 = nota();
  const nf35 = nota({ situacao_dominio: "CANCELADA" });
  const nfCanceladaApp = nota({ status: "cancelada" });
  const nfSubstituida = nota({ situacao_site_pmt: "SUBSTITUIDA" });

  it("Concluída não traz a NF concluída no banco mas cancelada na origem (NF 35)", () => {
    expect(notaCombinaComStatus(nf36, "concluida")).toBe(true);
    expect(notaCombinaComStatus(nf35, "concluida")).toBe(false);
  });

  it("Cancelada traz as canceladas das duas origens", () => {
    expect(notaCombinaComStatus(nf35, "cancelada")).toBe(true);
    expect(notaCombinaComStatus(nfCanceladaApp, "cancelada")).toBe(true);
    expect(notaCombinaComStatus(nf36, "cancelada")).toBe(false);
  });

  it("Todos traz tudo, inclusive a substituída, que não aparece em Concluída", () => {
    for (const n of [nf36, nf35, nfCanceladaApp, nfSubstituida]) expect(notaCombinaComStatus(n, "todos")).toBe(true);
    expect(notaCombinaComStatus(nfSubstituida, "concluida")).toBe(false);
  });
});

describe("SIS-2026-0697 — empresa e contrato", () => {
  const notas = [
    nota({ empresa_id: "e1", contrato_id: "c1", contrato: { id: "c1", nome: "B" } }),
    nota({ empresa_id: "e1", contrato_id: "c1", contrato: { id: "c1", nome: "B" } }),
    nota({ empresa_id: "e1", contrato_id: "c2", contrato: { id: "c2", nome: "A" } }),
    nota({ empresa_id: "e2", contrato_id: "c3", contrato: { id: "c3", nome: "C" } }),
  ];

  it("lista só os contratos da empresa, sem repetir e em ordem alfabética", () => {
    expect(contratosDasNotasDaEmpresa(notas, "e1").map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(contratosDasNotasDaEmpresa(notas, "e2").map((c) => c.id)).toEqual(["c3"]);
  });

  it("sem empresa selecionada lista todos", () => {
    expect(contratosDasNotasDaEmpresa(notas, "todas")).toHaveLength(3);
  });

  it("contrato que não pertence à nova empresa deve ser limpo", () => {
    const deE2 = contratosDasNotasDaEmpresa(notas, "e2");
    expect(contratoCombinaComEmpresa(deE2, "c1")).toBe(false);
    expect(contratoCombinaComEmpresa(deE2, "c3")).toBe(true);
    expect(contratoCombinaComEmpresa(deE2, "todos")).toBe(true);
  });
});
