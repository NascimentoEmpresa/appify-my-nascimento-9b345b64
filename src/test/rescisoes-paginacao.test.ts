import { describe, expect, it } from "vitest";
import { paginasVisiveis } from "@/components/rescisoes/PlanilhaRescisoes";

describe("paginação da planilha de rescisões", () => {
  it("poucas páginas: todas", () => {
    expect(paginasVisiveis(1, 1)).toEqual([1]);
    expect(paginasVisiveis(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("muitas páginas: primeira, última e vizinhas da atual, com reticências", () => {
    expect(paginasVisiveis(1, 21)).toEqual([1, 2, null, 21]);
    expect(paginasVisiveis(10, 21)).toEqual([1, null, 9, 10, 11, null, 21]);
    expect(paginasVisiveis(21, 21)).toEqual([1, null, 20, 21]);
    expect(paginasVisiveis(3, 21)).toEqual([1, 2, 3, 4, null, 21]);
  });
});
