import { describe, expect, it } from "vitest";
import {
  ERRO_RELATORIO_SEM_CHAMADO,
  normalizarNumeroPr,
  removerLinhaRelatorioPr,
  totalizarLinhasRelatorioPr,
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

  it("soma as metricas carregadas nos campos de PR da linha", () => {
    expect(
      totalizarLinhasRelatorioPr([
        { pr_linhas_adicionadas: 969, pr_commits: 3, pr_arquivos_adicionados: 4 },
        { pr_linhas_adicionadas: 12, pr_commits: 1, pr_arquivos_adicionados: 2 },
      ]),
    ).toEqual({ linhas_adicionadas: 981, commits: 4, arquivos_adicionados: 6 });
  });
});

describe("remoção de linhas do relatório da hora extra", () => {
  const linha = (chave: string) => ({ chave });

  it("remove o chamado original que não foi realizado na HE", () => {
    const r = removerLinhaRelatorioPr([linha("a"), linha("b")], [linha("c")], "a");
    expect(r.erro).toBeUndefined();
    expect(r.originais.map((l) => l.chave)).toEqual(["b"]);
    expect(r.adicionais.map((l) => l.chave)).toEqual(["c"]);
  });

  it("remove o chamado adicional sem mexer nos originais", () => {
    const r = removerLinhaRelatorioPr([linha("a")], [linha("b"), linha("c")], "c");
    expect(r.originais.map((l) => l.chave)).toEqual(["a"]);
    expect(r.adicionais.map((l) => l.chave)).toEqual(["b"]);
  });

  it("recusa esvaziar o relatório: a última linha não sai", () => {
    const r = removerLinhaRelatorioPr([linha("a")], [], "a");
    expect(r.erro).toBe(ERRO_RELATORIO_SEM_CHAMADO);
    expect(r.originais).toHaveLength(1);
  });

  it("ignora chave que não está no relatório", () => {
    const originais = [linha("a")];
    const adicionais = [linha("b")];
    const r = removerLinhaRelatorioPr(originais, adicionais, "z");
    expect(r.erro).toBeUndefined();
    expect(r.originais).toBe(originais);
    expect(r.adicionais).toBe(adicionais);
  });
});
