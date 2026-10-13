import { describe, expect, it } from "vitest";
import { etapaDaNf, impactoDoContratoPct, resumirPendencias } from "@/pages/controladoria/pendentesNf";

describe("etapa atual do contrato na competência (SIS-2026-0650)", () => {
  it("sem nota iniciada", () => {
    expect(etapaDaNf([])).toBe("NAO_INICIADA");
  });
  it("rascunho", () => {
    expect(etapaDaNf([{ status: "rascunho" }])).toBe("RASCUNHO");
  });
  it("enviada ao Financeiro vence rascunho", () => {
    expect(etapaDaNf([{ status: "rascunho" }, { status: "enviada" }])).toBe("ENVIADA");
  });
  it("nota cancelada não conta", () => {
    expect(etapaDaNf([{ status: "cancelada" }])).toBe("NAO_INICIADA");
    expect(etapaDaNf([{ status: "cancelada" }, { status: "rascunho" }])).toBe("RASCUNHO");
  });
});

describe("resumo do impacto financeiro (números do mockup)", () => {
  const exec = 11744238.21;
  const linhas = [
    { empresaNome: "HAGG", contratoNome: "UFRGS - LIMPEZA GERAL - 047/2022", naoEmitido: 1396544.83 },
    { empresaNome: "HAGG", contratoNome: "PREF POA SMS RECEPÇÃO - 98672/2025", naoEmitido: 1065027.17 },
    { empresaNome: "HAGG", contratoNome: "POLÍCIA CIVIL RS LIMPEZA - 066/2026", naoEmitido: 848424.56 },
    { empresaNome: "SN", contratoNome: "TRIUNFO VIGIAS - 33/2024", naoEmitido: 577516.1 },
    { empresaNome: "HAGG", contratoNome: "OUTROS HAGG", naoEmitido: 2981934.39 },
  ];

  it("impacto do contrato = não emitido ÷ executável total", () => {
    expect(impactoDoContratoPct(1396544.83, exec).toFixed(2)).toBe("11.89");
    expect(impactoDoContratoPct(10, 0)).toBe(0);
  });

  it("totais, maior pendência, top 3 e sobra do executável", () => {
    const r = resumirPendencias(linhas, exec);
    expect(r.qtd).toBe(5);
    expect(r.valorNaoFaturado).toBe(6869447.05);
    expect(r.impactoPct.toFixed(2)).toBe("58.49");
    expect(r.executavelForaDasPendencias).toBe(4874791.16);
    expect(r.maior?.valor).toBe(2981934.39);
    // top 3 = 2.981.934,39 + 1.396.544,83 + 1.065.027,17
    expect(r.concentracaoTop3Pct.toFixed(1)).toBe("79.2");
  });

  it("pendências por empresa em ordem decrescente", () => {
    const r = resumirPendencias(linhas, exec);
    expect(r.porEmpresa.map((e) => e.empresa)).toEqual(["HAGG", "SN"]);
    expect(r.porEmpresa[1].valor).toBe(577516.1);
  });

  it("sem pendências", () => {
    const r = resumirPendencias([], exec);
    expect(r.qtd).toBe(0);
    expect(r.maior).toBeNull();
    expect(r.concentracaoTop3Pct).toBe(0);
    expect(r.executavelForaDasPendencias).toBe(exec);
  });
});
