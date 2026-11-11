import { describe, expect, it } from "vitest";
import { cardsSup, paginasSup, type DadosSupPainelTv } from "@/lib/tv/supPainelTv";
import { paginasDoRelatorio } from "@/lib/tv/relatorioTv";

// TV › Compras — Suprimentos (11/11/2026). Dados fictícios.

const base = (): DadosSupPainelTv => ({
  estoque: {
    itens: 100, com_minimo: 20,
    abaixo_minimo: { qtd: 2, zerados: 1, reposicao: 450, itens: [
      { nome: "LUVA NITRILICA", tamanho: "M", disp: 0, minimo: 50, falta: 50, pct: 0 },
      { nome: "SACO DE LIXO 100L", tamanho: null, disp: 30, minimo: 40, falta: 10, pct: 75 },
    ] },
    valor: { total: 12345.6, itens_com_saldo: 80, por_tipo: [{ tipo: "EPI", valor: 10000 }], maiores: [{ nome: "BOTINA", tamanho: "40", qtd: 10, valor: 900 }] },
    sem_mov: { dias: 90, qtd: 0, valor: 0, itens: [] },
  },
  pedidos: {
    compras_vencidas: { dias: 15, qtd: 0, contratos: 0, mais_antigo: null, por_contrato: [] },
    sem_entrega: { dias: 10, contratos: 3, pedidos: 5, por_status: [{ status: "AGUARDANDO ENVIO", qtd: 5 }], por_contrato: [{ contrato: "CONTRATO A", qtd: 3, dias: 20 }] },
  },
  fornecedor: { registrados: 3, enviados: 0, em_atraso: 0, por_fornecedor: [] },
});

describe("TV Compras — Suprimentos", () => {
  it("os 6 indicadores da tabela, nessa ordem", () => {
    expect(cardsSup(base()).map((c) => c.titulo)).toEqual([
      "Compras vencidas e não entregues", "Itens abaixo do estoque mínimo", "Valor total do estoque",
      "Itens sem movimentação", "Pedidos em atraso por fornecedor", "Contratos sem entrega de material prevista",
    ]);
  });

  it("ruim só quando é verdadeiro: zero atraso é bom, fonte sem registro é neutra", () => {
    const c = Object.fromEntries(cardsSup(base()).map((x) => [x.chave, x]));
    expect(c.compras.tom).toBe("bom");
    expect(c.minimo.tom).toBe("critico"); // há item zerado
    expect(c.parados.tom).toBe("bom");
    expect(c.fornecedor.tom).toBe("neutro");
    expect(c.fornecedor.valor).toBe("—");
    expect(c.valor.tom).toBe("neutro");
  });

  it("sem item com mínimo cadastrado, o card não acusa nada", () => {
    const d = base();
    d.estoque.com_minimo = 0;
    d.estoque.abaixo_minimo = { qtd: 0, zerados: 0, reposicao: 0, itens: [] };
    expect(cardsSup(d).find((x) => x.chave === "minimo")!.tom).toBe("neutro");
  });

  it("páginas: visão geral sempre; detalhe só com o que mostrar", () => {
    expect(paginasSup(base()).map((p) => p.chave)).toEqual(["geral", "minimo", "atrasos", "estoque"]);
    const vazio = base();
    vazio.estoque.abaixo_minimo.itens = [];
    vazio.pedidos.sem_entrega.por_contrato = [];
    vazio.estoque.valor.maiores = [];
    expect(paginasSup(vazio).map((p) => p.chave)).toEqual(["geral"]);
  });

  it("o item da playlist é uma página só (as páginas giram na tela)", () => {
    expect(paginasDoRelatorio({ ...base(), tipo: "sup-painel", contrato: null })).toHaveLength(1);
  });
});
