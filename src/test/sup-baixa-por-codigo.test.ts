import { describe, it, expect } from "vitest";
import {
  conferirLinhas,
  codigosDasLinhas,
  montarBaixasDasLinhas,
  expandirCodigosDeProduto,
  type ItemComLinhas,
  type LinhaCodigo,
  type LoteResolvido,
  type ResolucaoCodigo,
} from "@/hooks/useSupEstoque";

/**
 * Modal de baixa por código + quantidade (15/09/2026).
 *
 * O pedido: tirar o seletor "única / em massa", ter um campo de código com a
 * quantidade ao lado, e um "+" para quando as unidades de um mesmo item saem
 * de códigos diferentes ("duas jaquetas com dois códigos no mesmo pedido").
 * Depois: aceitar o código do PRODUTO (7 dígitos), com o sistema escolhendo o
 * lote e o CA vindo junto. Quem descobre o tipo de cada código é o banco —
 * estes testes travam o que a tela faz com a resposta dele antes de chamar
 * sup_est_baixar.
 */

let n = 0;
const linha = (codigo: string, quantidade: string | number): LinhaCodigo =>
  ({ id: `t${++n}`, codigo, quantidade: String(quantidade) });

const jaqueta = (p: Partial<ItemComLinhas> = {}): ItemComLinhas => ({
  pedido_item_id: "pi-jaqueta", nome: "JAQUETA", pedida: 2, designados: [], linhas: [], ...p,
});

const codigosEQuantidades = (it: ItemComLinhas) => it.linhas.map((l) => [l.codigo, l.quantidade]);

describe("conferirLinhas — o que dá para barrar sem ir ao banco", () => {
  it("linha sem código é ignorada, mesmo com quantidade", () => {
    expect(conferirLinhas([jaqueta({ linhas: [linha("", 2)] })])).toEqual([]);
  });

  it("mesmo código em duas linhas do item é recusado, mesmo com espaço e minúscula", () => {
    const erros = conferirLinhas([jaqueta({ linhas: [linha("L1", 1), linha(" l1 ", 1)] })]);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toMatch(/repetido/);
  });

  it("quantidade vazia, zero, fracionada ou negativa é recusada", () => {
    for (const q of ["", "0", "1.5", "-1"]) {
      expect(conferirLinhas([jaqueta({ linhas: [linha("L1", q)] })])).toHaveLength(1);
    }
  });

  it("conta o que já foi baixado: 1 designada + 2 novas passa das 2 pedidas", () => {
    const erros = conferirLinhas([jaqueta({
      designados: [{ codigo: "L0", quantidade: 1 }],
      linhas: [linha("L1", 2)],
    })]);
    expect(erros).toEqual(["JAQUETA: 3 un. para 2 pedida(s)."]);
  });

  it("duas jaquetas em dois códigos, uma de cada — o caso do '+' — passa", () => {
    expect(conferirLinhas([jaqueta({ linhas: [linha("L1", 1), linha("L2", 1)] })])).toEqual([]);
  });

  it("depois de desvincular o código errado, bipar o certo cabe no pedido", () => {
    // Designado: nada (o errado saiu). Pedida: 1. Linha nova com o certo.
    expect(conferirLinhas([jaqueta({ pedida: 1, linhas: [linha("L2", 1)] })])).toEqual([]);
  });
});

describe("codigosDasLinhas", () => {
  it("normaliza e não repete código entre itens — uma validação só", () => {
    const itens = [
      jaqueta({ linhas: [linha(" l1 ", 1), linha("", 1)] }),
      jaqueta({ pedido_item_id: "pi-2", linhas: [linha("L1", 1), linha("0000123", 1)] }),
    ];
    expect(codigosDasLinhas(itens)).toEqual(["L1", "0000123"]);
  });
});

describe("expandirCodigosDeProduto — o código do produto vira os lotes que o banco escolheu", () => {
  const lote = (codigo: string, quantidade: number, ca: string | null = null): LoteResolvido =>
    ({ codigo, quantidade, ca_numero: ca, ca_validade: null });
  const produto = (lotes: LoteResolvido[], faltam = 0, bloqueadas = 0): ResolucaoCodigo => ({
    codigo: "0000123", tipo: "produto", produto: { codigo: "0000123", nome: "JAQUETA" },
    lotes, faltam, bloqueadas,
  });

  it("troca a linha do produto pelos lotes, com a quantidade de cada um", () => {
    const r = expandirCodigosDeProduto(
      [jaqueta({ linhas: [linha("0000123", 2)] })],
      { "pi-jaqueta|0000123": produto([lote("L1", 1, "12345"), lote("L2", 1, "67890")]) },
    );
    expect(r.erros).toEqual([]);
    expect(codigosEQuantidades(r.itens[0])).toEqual([["L1", "1"], ["L2", "1"]]);
  });

  it("lote bipado direto soma com o mesmo lote que veio do produto", () => {
    const r = expandirCodigosDeProduto(
      [jaqueta({ linhas: [linha("L1", 1), linha("0000123", 1)] })],
      { "pi-jaqueta|0000123": produto([lote("L1", 1)]) },
    );
    expect(codigosEQuantidades(r.itens[0])).toEqual([["L1", "2"]]);
  });

  it("produto sem saldo é recusado inteiro, dizendo quanto ficou de fora por CA bloqueado", () => {
    const r = expandirCodigosDeProduto(
      [jaqueta({ linhas: [linha("0000123", 2)] })],
      { "pi-jaqueta|0000123": produto([lote("L1", 1)], 1, 3) },
    );
    expect(r.itens[0].linhas).toEqual([]);
    expect(r.erros[0]).toMatch(/só tem 1 un\. livre\(s\) para 2/);
    expect(r.erros[0]).toMatch(/3 un\. estão em lote com CA bloqueado/);
  });

  it("código de produto de outro material é recusado", () => {
    const r = expandirCodigosDeProduto(
      [jaqueta({ linhas: [linha("0000999", 1)] })],
      { "pi-jaqueta|0000999": { codigo: "0000999", tipo: "outro_produto", produto: { codigo: "0000999", nome: "BOTA" } } },
    );
    expect(r.erros).toEqual(['0000999 é o código de "BOTA", não de JAQUETA.']);
  });

  it("código de lote, e código sem resposta, passam como estão — quem julga é a validação", () => {
    const r = expandirCodigosDeProduto(
      [jaqueta({ linhas: [linha("L9", 1), linha("xyz", 1)] })],
      { "pi-jaqueta|L9": { codigo: "L9", tipo: "lote" } },
    );
    expect(r.erros).toEqual([]);
    expect(codigosEQuantidades(r.itens[0])).toEqual([["L9", "1"], ["XYZ", "1"]]);
  });
});

describe("montarBaixasDasLinhas — o tipo vem da validação, não do operador", () => {
  const massa = { tipo: "massa" as const, disponivel: 5 };

  it("dois códigos no mesmo item viram duas baixas", () => {
    const { baixas, erros } = montarBaixasDasLinhas(
      [jaqueta({ linhas: [linha("L1", 1), linha("l2", 1)] })],
      { L1: massa, L2: massa },
    );
    expect(erros).toEqual([]);
    expect(baixas).toEqual([
      { pedido_item_id: "pi-jaqueta", codigo: "L1", tipo: "massa", quantidade: 1 },
      { pedido_item_id: "pi-jaqueta", codigo: "L2", tipo: "massa", quantidade: 1 },
    ]);
  });

  it("lote que já tinha unidade no item vai com o TOTAL — sup_est_baixar trabalha por delta", () => {
    const { baixas } = montarBaixasDasLinhas(
      [jaqueta({ designados: [{ codigo: "L1", quantidade: 1 }], linhas: [linha("L1", 1)] })],
      { L1: massa },
    );
    expect(baixas).toEqual([{ pedido_item_id: "pi-jaqueta", codigo: "L1", tipo: "massa", quantidade: 2 }]);
  });

  it("lote sem saldo para a quantidade é recusado antes de ir ao banco", () => {
    const { baixas, erros } = montarBaixasDasLinhas(
      [jaqueta({ linhas: [linha("L1", 2)] })],
      { L1: { tipo: "massa", disponivel: 1 } },
    );
    expect(baixas).toEqual([]);
    expect(erros[0]).toMatch(/só 1 disponível/);
  });

  describe("etiqueta antiga de peça única", () => {
    const unica = { tipo: "unico" as const, disponivel: 1 };

    it("vai sem quantidade — vale uma peça", () => {
      const { baixas } = montarBaixasDasLinhas([jaqueta({ linhas: [linha("E1", 1)] })], { E1: unica });
      expect(baixas).toEqual([{ pedido_item_id: "pi-jaqueta", codigo: "E1", tipo: "unico" }]);
    });

    it("com quantidade maior que 1 é recusada", () => {
      const { erros } = montarBaixasDasLinhas([jaqueta({ linhas: [linha("E1", 2)] })], { E1: unica });
      expect(erros[0]).toMatch(/vale 1 unidade/);
    });

    it("bipada de novo no item em que já está é recusada — gravaria uma segunda saída", () => {
      const { baixas, erros } = montarBaixasDasLinhas(
        [jaqueta({ designados: [{ codigo: "E1", quantidade: 1 }], linhas: [linha("E1", 1)] })],
        { E1: unica },
      );
      expect(baixas).toEqual([]);
      expect(erros[0]).toMatch(/já está designado/);
    });
  });
});
