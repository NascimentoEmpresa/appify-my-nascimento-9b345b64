import { describe, expect, it } from "vitest";
import {
  normalizarNumeroPr,
  totalizarMetricasPr,
  urlPrHoraExtra,
} from "@/pages/sistemas/hora-extra/prHoraExtraUtils";

describe("relatório de PRs da hora extra", () => {
  it.each([
    ["#624", 624],
    [" 624 ", 624],
    ["#0007", 7],
    ["", null],
    ["PR 624", null],
    ["#624abc", null],
    ["#0", null],
  ])("normaliza %s", (valor, esperado) => {
    expect(normalizarNumeroPr(valor)).toBe(esperado);
  });

  it("monta o link canônico da PR", () => {
    expect(urlPrHoraExtra(624)).toBe(
      "https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64/pull/624",
    );
  });

  it("soma apenas as métricas que aparecem no relatório", () => {
    expect(
      totalizarMetricasPr([
        { linhas_adicionadas: 9, commits: 3, arquivos_adicionados: 1 },
        { linhas_adicionadas: 767, commits: 14, arquivos_adicionados: 14 },
      ]),
    ).toEqual({ linhas_adicionadas: 776, commits: 17, arquivos_adicionados: 15 });
  });
});
