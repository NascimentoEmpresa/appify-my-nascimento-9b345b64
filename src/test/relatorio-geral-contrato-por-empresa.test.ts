import { describe, expect, it } from "vitest";
import { contratoCombinaComEmpresa, contratosDaEmpresa } from "@/pages/financeiro/relatorio-servicos/totais";

// SIS-2026-0694: Relatório de Serviços › Relatório Geral — o filtro Contrato só mostra os contratos da empresa escolhida.
const contratos = [
  { id: "c1", nome: "UFRGS - LIMPEZA - 020/2022", empresa_id: "HAGG" },
  { id: "c2", nome: "FURG HU - 006/2023", empresa_id: "HAGG" },
  { id: "c3", nome: "CAPÃO DA CANOA- 044/2020", empresa_id: "NH" },
  { id: "c4", nome: "IPASEM - 13/2022", empresa_id: "SN" },
];

describe("contratosDaEmpresa", () => {
  it("com a HAGG escolhida, só os contratos da HAGG (o Capão da Canoa, da NH, não aparece)", () => {
    const r = contratosDaEmpresa(contratos, "HAGG");
    expect(r.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(r.some((c) => c.nome.includes("CAPÃO"))).toBe(false);
  });
  it("vale para todas as empresas", () => {
    expect(contratosDaEmpresa(contratos, "NH").map((c) => c.id)).toEqual(["c3"]);
    expect(contratosDaEmpresa(contratos, "SN").map((c) => c.id)).toEqual(["c4"]);
  });
  it("sem empresa escolhida, todos os contratos", () => {
    expect(contratosDaEmpresa(contratos, "")).toHaveLength(4);
  });
  it("empresa sem contratos devolve lista vazia", () => {
    expect(contratosDaEmpresa(contratos, "AGPS")).toEqual([]);
  });
});

describe("contratoCombinaComEmpresa — seleção que sobra ao trocar de empresa", () => {
  it("contrato de outra empresa não combina (a seleção é limpa)", () => {
    expect(contratoCombinaComEmpresa(contratos[2], "HAGG")).toBe(false);
  });
  it("contrato da mesma empresa, sem empresa escolhida ou contrato desconhecido: nada a limpar", () => {
    expect(contratoCombinaComEmpresa(contratos[0], "HAGG")).toBe(true);
    expect(contratoCombinaComEmpresa(contratos[2], "")).toBe(true);
    expect(contratoCombinaComEmpresa(undefined, "HAGG")).toBe(true);
  });
});
