/**
 * SIS-2026-0769 — regras de leitura do relatório de Saídas por Contrato.
 *
 * O que estes testes protegem: a separação entre o que é registro do ERP e o
 * que foi reconstruído de planilha. Se um refactor juntar as duas origens num
 * total único, a análise de lucratividade passa a tratar dado reconstruído
 * como registro — e é exatamente a distinção que o chamado pediu para manter.
 */
import { describe, expect, it } from "vitest";
import {
  LIMIAR_COBERTURA_CONFIAVEL,
  arquivoDaOrigem,
  categoriaOrigem,
  coberturaPreocupante,
  gerarCsvSaidas,
  percentualCobertura,
  resumirPorContrato,
  type LinhaCobertura,
  type LinhaSaida,
} from "@/lib/suprimentos/saidasPorContrato";

function linha(p: Partial<LinhaSaida>): LinhaSaida {
  return {
    competencia: "2026-04",
    contrato_id: "c1",
    contrato_nome: "UFRGS - LIMPEZA GERAL - 047/2022",
    sup_item_id: "i1",
    item_nome: "CAMISA POLO PRETA",
    item_codigo: "0001723",
    item_tipo: "uniforme",
    quantidade: 1,
    origem: "sistema",
    ...p,
  };
}

describe("categoriaOrigem", () => {
  it("separa as três procedências", () => {
    expect(categoriaOrigem("sistema")).toBe("sistema");
    expect(categoriaOrigem("planilha:ATÉ 23-04-2026.xlsx")).toBe("planilha");
    expect(categoriaOrigem("sem_destino")).toBe("sem_destino");
  });

  it("devolve o arquivo só quando veio de planilha", () => {
    expect(arquivoDaOrigem("planilha:ATÉ 23-04-2026.xlsx")).toBe("ATÉ 23-04-2026.xlsx");
    expect(arquivoDaOrigem("sistema")).toBeNull();
  });
});

describe("resumirPorContrato", () => {
  it("soma por contrato sem misturar as origens", () => {
    const r = resumirPorContrato([
      linha({ quantidade: 10, origem: "sistema" }),
      linha({ quantidade: 4, origem: "planilha:ATÉ 23-04-2026.xlsx" }),
      linha({ quantidade: 1, origem: "sem_destino", contrato_id: null, contrato_nome: "(sem contrato identificado)" }),
    ]);
    expect(r).toHaveLength(2);
    const ufrgs = r.find((x) => x.contrato_id === "c1")!;
    expect(ufrgs.quantidade).toBe(14);
    expect(ufrgs.sistema).toBe(10);
    expect(ufrgs.planilha).toBe(4);
    expect(ufrgs.sem_destino).toBe(0);
  });

  it("nenhuma unidade some no agrupamento", () => {
    const linhas = [
      linha({ quantidade: 7 }),
      linha({ quantidade: 3, contrato_id: "c2", contrato_nome: "FURG HU - 006/2023" }),
      linha({ quantidade: 5, contrato_id: null, origem: "sem_destino" }),
    ];
    const total = linhas.reduce((s, l) => s + l.quantidade, 0);
    const somado = resumirPorContrato(linhas).reduce((s, c) => s + c.quantidade, 0);
    expect(somado).toBe(total);
  });

  it("ordena do contrato que mais consumiu para o que menos consumiu", () => {
    const r = resumirPorContrato([
      linha({ quantidade: 2, contrato_id: "c2", contrato_nome: "B" }),
      linha({ quantidade: 9, contrato_id: "c1", contrato_nome: "A" }),
    ]);
    expect(r.map((x) => x.contrato_id)).toEqual(["c1", "c2"]);
  });
});

describe("percentualCobertura", () => {
  const cob = (p: Partial<LinhaCobertura>): LinhaCobertura => ({
    competencia: "2026-04",
    unidades_total: 0,
    unidades_sistema: 0,
    unidades_planilha: 0,
    unidades_sem_destino: 0,
    ...p,
  });

  it("conta sistema + planilha como destino conhecido", () => {
    // abril/2026 real: 1.342 unidades, 45 no sistema e 1.205 de planilha.
    expect(
      percentualCobertura(
        cob({ unidades_total: 1342, unidades_sistema: 45, unidades_planilha: 1205, unidades_sem_destino: 92 }),
      ),
    ).toBe(93);
  });

  it("devolve null em mês sem movimento, para a tela não mostrar 0%", () => {
    expect(percentualCobertura(cob({ unidades_total: 0 }))).toBeNull();
  });

  it("maio/2026 continua abaixo do limiar e é sinalizado", () => {
    // 1.223 unidades, 132 no sistema e 524 de planilha — a lacuna definitiva.
    const maio = cob({
      competencia: "2026-05",
      unidades_total: 1223,
      unidades_sistema: 132,
      unidades_planilha: 524,
      unidades_sem_destino: 567,
    });
    expect(percentualCobertura(maio)).toBe(54);
    expect(coberturaPreocupante(maio)).toBe(true);
  });

  it("mês íntegro não é sinalizado", () => {
    const setembro = cob({
      competencia: "2026-09",
      unidades_total: 1878,
      unidades_sistema: 1878,
    });
    expect(percentualCobertura(setembro)).toBe(100);
    expect(coberturaPreocupante(setembro)).toBe(false);
  });

  it("mês sem movimento não é sinalizado como problema", () => {
    expect(coberturaPreocupante(cob({ unidades_total: 0 }))).toBe(false);
  });

  it("o limiar separa 89 de 90", () => {
    expect(LIMIAR_COBERTURA_CONFIAVEL).toBe(90);
    expect(coberturaPreocupante(cob({ unidades_total: 100, unidades_sistema: 89 }))).toBe(true);
    expect(coberturaPreocupante(cob({ unidades_total: 100, unidades_sistema: 90 }))).toBe(false);
  });
});

describe("gerarCsvSaidas", () => {
  it("leva a origem e o arquivo em cada linha", () => {
    const csv = gerarCsvSaidas([
      linha({ quantidade: 3, origem: "planilha:ATÉ 23-04-2026.xlsx" }),
    ]);
    const [cabecalho, primeira] = csv.split("\n");
    expect(cabecalho).toContain("origem;arquivo_origem");
    expect(primeira).toContain("Reconstruído de planilha");
    expect(primeira).toContain("ATÉ 23-04-2026.xlsx");
  });

  it("protege o separador quando o nome do contrato tem ponto-e-vírgula", () => {
    const csv = gerarCsvSaidas([linha({ contrato_nome: "ABC; LTDA" })]);
    expect(csv.split("\n")[1]).toContain('"ABC; LTDA"');
  });

  it("emite só o cabeçalho quando não há linhas", () => {
    expect(gerarCsvSaidas([]).split("\n")).toHaveLength(1);
  });
});
