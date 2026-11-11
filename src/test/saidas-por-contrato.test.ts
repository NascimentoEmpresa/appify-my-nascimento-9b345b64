/**
 * SIS-2026-0769 — regras de leitura do relatório de Saídas por Contrato.
 *
 * O que estes testes protegem: que a procedência de cada saída continue
 * RASTREÁVEL. Em 10/11/2026 a CEO decidiu que o quadro por contrato soma as
 * duas origens num valor único — essa parte é intencional e tem teste próprio
 * mais abaixo. O que não pode se perder é o caminho de volta: o aviso de
 * cobertura do mês e a exportação detalhada por item, que dizem de onde veio
 * cada número. Sem eles, dado reconstruído de planilha viraria registro do ERP
 * sem ninguém notar.
 */
import { describe, expect, it } from "vitest";
import {
  LIMIAR_COBERTURA_CONFIAVEL,
  arquivoDaOrigem,
  categoriaDoItem,
  categoriaOrigem,
  coberturaPreocupante,
  filtrarPorNome,
  gerarCsvPorCategoria,
  gerarCsvSaidas,
  numero,
  percentualCobertura,
  resumirPorCategoria,
  resumirPorContrato,
  totalizar,
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
    valor: 0,
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
    const total = linhas.reduce((s, l) => s + numero(l.quantidade), 0);
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

/* ------------------------------------------------------------------------- *
 * Quadro por categoria, em quantidade e em reais (decisão da CEO, 10/11/2026)
 * ------------------------------------------------------------------------- */

describe("categoriaDoItem", () => {
  it("reconhece as cinco categorias do cadastro de item", () => {
    expect(categoriaDoItem("uniforme")).toBe("uniforme");
    expect(categoriaDoItem("epi")).toBe("epi");
    expect(categoriaDoItem("limpeza")).toBe("limpeza");
    expect(categoriaDoItem("insumo")).toBe("insumo");
    expect(categoriaDoItem("equipamento")).toBe("equipamento");
  });

  it("tipo desconhecido e item sem tipo caem em Outros, não desaparecem", () => {
    // O item vira '(material removido)' com tipo nulo quando o cadastro é
    // excluído depois da saída. Se isso fosse ignorado, as colunas de
    // categoria somariam MENOS que a coluna Total e ninguém saberia por quê.
    expect(categoriaDoItem(null)).toBe("outros");
    expect(categoriaDoItem("")).toBe("outros");
    expect(categoriaDoItem("categoria_que_alguem_criar_no_banco")).toBe("outros");
  });
});

describe("resumirPorCategoria", () => {
  it("cruza contrato x categoria somando quantidade e valor", () => {
    const r = resumirPorCategoria([
      linha({ item_tipo: "uniforme", quantidade: 10, valor: 650 }),
      linha({ item_tipo: "epi", quantidade: 4, valor: 74 }),
      linha({ item_tipo: "uniforme", quantidade: 5, valor: 325 }),
    ]);
    expect(r.contratos).toHaveLength(1);
    expect(r.contratos[0].porCategoria.uniforme).toEqual({ quantidade: 15, valor: 975 });
    expect(r.contratos[0].porCategoria.epi).toEqual({ quantidade: 4, valor: 74 });
    expect(r.contratos[0].quantidade).toBe(19);
    expect(r.contratos[0].valor).toBe(1049);
  });

  it("as colunas de categoria fecham com o Total da linha", () => {
    const r = resumirPorCategoria([
      linha({ item_tipo: "uniforme", quantidade: 3, valor: 100 }),
      linha({ item_tipo: "limpeza", quantidade: 7, valor: 50 }),
      linha({ item_tipo: null, item_nome: "(material removido)", quantidade: 2, valor: 30 }),
    ]);
    const c = r.contratos[0];
    const somaCategorias = r.categoriasPresentes.reduce(
      (acc, cat) => acc + c.porCategoria[cat].valor,
      0,
    );
    expect(somaCategorias).toBe(c.valor);
    expect(c.valor).toBe(180);
  });

  it("numeric do PostgREST chega como texto — tem que somar, não concatenar", () => {
    const r = resumirPorCategoria([
      linha({ item_tipo: "uniforme", quantidade: "10", valor: "650.50" }),
      linha({ item_tipo: "uniforme", quantidade: "5", valor: "324.50" }),
    ]);
    expect(r.contratos[0].valor).toBe(975);
    expect(r.contratos[0].quantidade).toBe(15);
  });

  it("separa contratos e ordena pelo que mais consumiu em reais", () => {
    const r = resumirPorCategoria([
      linha({ contrato_id: "c2", contrato_nome: "B", quantidade: 100, valor: 10 }),
      linha({ contrato_id: "c1", contrato_nome: "A", quantidade: 1, valor: 9000 }),
    ]);
    expect(r.contratos.map((c) => c.contrato_nome)).toEqual(["A", "B"]);
  });

  it("só lista as categorias com movimento, na ordem do cadastro", () => {
    const r = resumirPorCategoria([
      linha({ item_tipo: "equipamento", valor: 1 }),
      linha({ item_tipo: "uniforme", valor: 1 }),
    ]);
    expect(r.categoriasPresentes).toEqual(["uniforme", "equipamento"]);
  });

  it("o filtro de categoria recorta antes de somar, para o rodapé seguir a tabela", () => {
    const linhas = [
      linha({ item_tipo: "uniforme", quantidade: 10, valor: 650 }),
      linha({ item_tipo: "epi", quantidade: 4, valor: 74 }),
    ];
    const so = resumirPorCategoria(linhas, "uniforme");
    expect(so.valor).toBe(650);
    expect(so.quantidade).toBe(10);
    expect(so.categoriasPresentes).toEqual(["uniforme"]);
    expect(so.contratos[0].valor).toBe(650);
  });

  it("saída sem contrato continua visível como linha própria", () => {
    const r = resumirPorCategoria([
      linha({ contrato_id: null, contrato_nome: "(sem contrato identificado)", valor: 500 }),
    ]);
    expect(r.contratos[0].contrato_id).toBeNull();
    expect(r.valor).toBe(500);
  });

  it("período sem saída não vira NaN", () => {
    const r = resumirPorCategoria([]);
    expect(r.valor).toBe(0);
    expect(r.quantidade).toBe(0);
    expect(r.contratos).toEqual([]);
    expect(r.categoriasPresentes).toEqual([]);
  });

  it("item sem preço cadastrado conta unidade e vale zero", () => {
    // Mesmo comportamento da coluna Consumo de Estoque na Lucratividade: as
    // duas ficam subestimadas juntas, e é por isso que os números batem.
    const r = resumirPorCategoria([linha({ item_tipo: "insumo", quantidade: 8, valor: 0 })]);
    expect(r.quantidade).toBe(8);
    expect(r.valor).toBe(0);
  });
});

describe("filtrarPorNome", () => {
  const contratos = resumirPorCategoria([
    linha({ contrato_id: "c1", contrato_nome: "CONTRATO JARDINAGEM - 062/2025", valor: 1 }),
    linha({ contrato_id: "c2", contrato_nome: "MUNICÍPIO EXEMPLO - 001/2021", valor: 1 }),
  ]).contratos;

  it("acha sem depender de acento nem de caixa", () => {
    expect(filtrarPorNome(contratos, "municipio exemplo")).toHaveLength(1);
    expect(filtrarPorNome(contratos, "MUNICÍPIO")).toHaveLength(1);
  });

  it("busca vazia devolve tudo", () => {
    expect(filtrarPorNome(contratos, "   ")).toHaveLength(2);
  });

  it("acha pelo número do contrato", () => {
    expect(filtrarPorNome(contratos, "062/2025")[0].contrato_nome).toContain("JARDINAGEM");
  });
});

describe("gerarCsvPorCategoria", () => {
  const resumo = resumirPorCategoria([
    linha({ item_tipo: "uniforme", quantidade: 10, valor: 650.5 }),
    linha({ item_tipo: "epi", quantidade: 4, valor: 74 }),
  ]);

  it("tem duas colunas por categoria presente, mais o total", () => {
    const [cabecalho] = gerarCsvPorCategoria(resumo.contratos, resumo.categoriasPresentes).split("\n");
    expect(cabecalho).toBe(
      "Contrato;Uniforme - Quantidade;Uniforme - Valor;EPI - Quantidade;EPI - Valor;Quantidade total;Valor total",
    );
  });

  it("valor com vírgula decimal, para o Excel em pt-BR somar a coluna", () => {
    const linhasCsv = gerarCsvPorCategoria(resumo.contratos, resumo.categoriasPresentes).split("\n");
    expect(linhasCsv[1]).toContain("650,50");
    expect(linhasCsv[1]).toContain("724,50");
  });

  it("fecha com a linha Total geral", () => {
    const linhasCsv = gerarCsvPorCategoria(resumo.contratos, resumo.categoriasPresentes).split("\n");
    expect(linhasCsv[linhasCsv.length - 1]).toContain("Total geral");
    expect(linhasCsv[linhasCsv.length - 1]).toContain("724,50");
  });
});

describe("totalizar", () => {
  const resumo = resumirPorCategoria([
    linha({ contrato_id: "c1", contrato_nome: "A", item_tipo: "uniforme", quantidade: 10, valor: 650 }),
    linha({ contrato_id: "c2", contrato_nome: "B", item_tipo: "epi", quantidade: 4, valor: 74 }),
  ]);

  it("soma só os contratos que recebe, para o rodapé seguir a busca", () => {
    const so = filtrarPorNome(resumo.contratos, "A");
    expect(totalizar(so).valor).toBe(650);
    expect(totalizar(resumo.contratos).valor).toBe(724);
  });

  it("o Total geral do CSV fecha com as linhas do próprio arquivo", () => {
    const visiveis = filtrarPorNome(resumo.contratos, "A");
    const csv = gerarCsvPorCategoria(visiveis, resumo.categoriasPresentes).split("\n");
    expect(csv).toHaveLength(3); // cabeçalho + 1 contrato + Total geral
    expect(csv[2]).toContain("Total geral");
    expect(csv[2]).toContain("650,00");
    expect(csv[2]).not.toContain("724,00");
  });

  it("lista vazia é zero, não NaN", () => {
    expect(totalizar([])).toEqual({
      totalPorCategoria: expect.any(Object),
      quantidade: 0,
      valor: 0,
    });
  });
});
