import { describe, expect, it } from "vitest";
import {
  LINHAS_MINIMAS, dataBR, gerarHtmlFichaEpi, montarFichaEpi,
  type PedidoFicha, type RespostaFichaEpi,
} from "@/lib/suprimentos/fichaEpi";

/**
 * A ficha de EPI é documento trabalhista: o que se testa aqui é que o
 * cabeçalho sai com a empresa DO CONTRATO, que o RH tem precedência sobre o
 * que o encarregado digitou, e que nada é inventado quando falta dado.
 *
 * A colaboradora e o contrato abaixo existem (SN / Hospital São Camilo),
 * conferidos no banco em 11/09/2026.
 */

const pedido: PedidoFicha = {
  id: "p1",
  pedido_id: "PED-TESTE-001",
  status: "DESPACHADO",
  nome_colaborador: "MICHELE MORAES CARDOSO",
  matricula_colaborador: "2131",
  admissao: false,
  data_admissao: null,
  contrato_nome: "HOSPITAL SÃO CAMILO - 50163.2025",
  posto_nome: "PORTARIA",
  funcao_nome: "PORTEIRO(A)",
  // 20h30 em Brasília, já dia 11 em UTC.
  data_despachado: "2026-09-10T23:30:00+00:00",
  sup_pedido_item: [
    { nome_item: "LUVA NITRILICA", tamanho: "M", quantidade: 2, litros: null, ordem: 2 },
    { nome_item: "BOTINA", tamanho: "38", quantidade: 1, litros: null, ordem: 1 },
  ],
};

const resposta: RespostaFichaEpi = {
  empresa: { razao_social: "SN SERVICOS DE LIMPEZA E ZELADORIA PREDIAL LTDA", cnpj: "17.290.783/0001-98", codigo: "SN" },
  contrato: { nome: "HOSPITAL SÃO CAMILO - 50163.2025", cliente: null },
  colaborador: {
    matricula: "2131", admissao: "2024-12-21", cargo: "PORTEIRO",
    local: "PORTEIROS HOSPITAL SAO CAMILO DE ESTEIO", situacao: "Trabalhando", demissao: null,
  },
  itens: [
    { nome_item: "BOTINA", tamanho: "38", quantidade: 1, litros: null, ordem: 1, ca: "40377" },
    { nome_item: "LUVA NITRILICA", tamanho: "M", quantidade: 2, litros: null, ordem: 2, ca: null },
  ],
};

describe("dataBR", () => {
  it("converte date e timestamp, no fuso de Brasília", () => {
    expect(dataBR("2024-12-21")).toBe("21/12/2024");
    expect(dataBR("2026-09-10T23:30:00+00:00")).toBe("10/09/2026");
    expect(dataBR("17/10/2011")).toBe("17/10/2011");
    expect(dataBR(null)).toBe("");
  });
});

describe("ficha de EPI — montagem", () => {
  it("cabeçalho vem da empresa do contrato e o RH vence o pedido", () => {
    const f = montarFichaEpi(pedido, resposta);
    expect(f.empresa).toEqual({ razao_social: "SN SERVICOS DE LIMPEZA E ZELADORIA PREDIAL LTDA", cnpj: "17.290.783/0001-98" });
    expect(f.campos.funcao).toBe("PORTEIRO");
    expect(f.campos.admissao).toBe("21/12/2024");
    expect(f.campos.registro).toBe("2131");
    // Seção é o posto do pedido, mais específico que o local do RH.
    expect(f.campos.secao).toBe("PORTARIA");
    expect(f.itens.map((i) => [i.descricao, i.tamanho, i.quantidade, i.ca, i.retirada])).toEqual([
      ["BOTINA", "38", "1", "40377", "10/09/2026"],
      ["LUVA NITRILICA", "M", "2", "", "10/09/2026"],
    ]);
  });

  it("sem a RPC não presume que os itens solicitados foram enviados", () => {
    const f = montarFichaEpi(pedido, null);
    expect(f.empresa).toBeNull();
    expect(f.contrato).toBe("HOSPITAL SÃO CAMILO - 50163.2025");
    expect(f.campos.funcao).toBe("PORTEIRO(A)");
    expect(f.campos.admissao).toBe("");
    expect(f.itens).toEqual([]);
  });

  it("imprime somente os itens enviados e usa a quantidade efetivamente enviada", () => {
    const f = montarFichaEpi(pedido, {
      ...resposta,
      itens: [
        { nome_item: "LUVA NITRILICA", tamanho: "M", quantidade: 1, litros: null, ordem: 2, ca: null },
      ],
    });

    expect(f.itens.map((i) => [i.descricao, i.quantidade])).toEqual([
      ["LUVA NITRILICA", "1"],
    ]);
    expect(f.itens.some((i) => i.descricao === "BOTINA")).toBe(false);
  });

  it("admissão: pessoa fora do RH usa a data de admissão do pedido", () => {
    const f = montarFichaEpi(
      { ...pedido, admissao: true, matricula_colaborador: null, data_admissao: "2026-09-15" },
      { ...resposta, colaborador: null },
    );
    expect(f.campos.admissao).toBe("15/09/2026");
    expect(f.campos.registro).toBe("");
  });

  it("pedido que não foi despachado não ganha data de retirada", () => {
    for (const status of ["EM PREPARACAO", "AGUARDANDO ENVIO", "RETIRADO PARA ENTREGA"]) {
      const f = montarFichaEpi({ ...pedido, status }, resposta);
      expect(f.itens.every((i) => i.retirada === "")).toBe(true);
      expect(f.campos.data).toBe("");
    }
  });
});

describe("ficha de EPI — HTML", () => {
  it("completa a grade até o mínimo da folha e escapa o texto", () => {
    const f = montarFichaEpi({ ...pedido, nome_colaborador: "<b>X</b>" }, resposta);
    const html = gerarHtmlFichaEpi(f);
    expect(html.match(/<tr><td class="c">/g)).toHaveLength(LINHAS_MINIMAS);
    expect(html).toContain("SN SERVICOS DE LIMPEZA E ZELADORIA PREDIAL LTDA");
    expect(html).toContain("CNPJ: 17.290.783/0001-98");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).not.toContain("window.print");
    expect(gerarHtmlFichaEpi(f, { imprimir: true })).toContain("window.print");
  });
});
