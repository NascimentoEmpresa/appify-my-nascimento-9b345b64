import { describe, expect, it } from "vitest";
import { contratosDoFiltro, processoNoContrato, SEM_CONTRATO, semContratoCount } from "@/pages/juridico/processos/filtroContrato";

// SIS-2026-0936: filtrar os processos por contrato.
const processos = [
  { contrato: "BENTO GONÇALVES - LIMPEZA - 029/2025" },
  { contrato: "bento gonçalves - limpeza - 029/2025 " },
  { contrato: "BENTO GONÇALVES - LIMPEZA - 029/2025" },
  { contrato: "CANAA" },
  { contrato: "" },
  { contrato: null },
];

describe("filtro de processos por contrato", () => {
  it("lista cada contrato uma vez, com a grafia mais usada e a contagem, em ordem alfabética", () => {
    expect(contratosDoFiltro(processos).map((c) => [c.nome, c.n])).toEqual([["BENTO GONÇALVES - LIMPEZA - 029/2025", 3], ["CANAA", 1]]);
  });
  it("filtra pelo contrato ignorando espaço e maiúsculas", () => {
    const [bento] = contratosDoFiltro(processos);
    expect(processos.filter((p) => processoNoContrato(p, bento.chave))).toHaveLength(3);
  });
  it("sem filtro passa tudo; 'sem contrato' traz só os vazios", () => {
    expect(processos.filter((p) => processoNoContrato(p, ""))).toHaveLength(6);
    expect(processos.filter((p) => processoNoContrato(p, SEM_CONTRATO))).toHaveLength(2);
    expect(semContratoCount(processos)).toBe(2);
  });
});
