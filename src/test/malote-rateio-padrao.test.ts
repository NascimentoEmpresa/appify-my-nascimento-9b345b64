import { describe, it, expect } from "vitest";
import {
  NOME_FORNECEDOR_DISPENSA,
  acharFornecedorPorNome,
  linhaComPadrao,
  rateioInicialComPadrao,
} from "@/pages/malote/rateioPadrao";
import { informacoesPagamentoUfrgs } from "@/pages/operacional/diariasUfrgs";

// Os dois registros-coringa como estão no cadastro de produção.
const FORNECEDORES = [
  { id: "f-acme", nome: "ACME LTDA" },
  { id: "f-disp1", nome: "0 - Dispensa 1" },
  { id: "f-disp2", nome: "0 - Dispensa 2" },
];

const PADRAO = {
  empresa_id: "emp-hagg",
  contrato_id: "ct-ufrgs",
  fornecedor_id: "f-disp1",
  integrante_empregado_id: 5755,
};

describe("Rateio pré-preenchido da Diária UFRGS", () => {
  it("acha o fornecedor de dispensa pelo nome, sem confundir com o 2", () => {
    expect(acharFornecedorPorNome(FORNECEDORES, NOME_FORNECEDOR_DISPENSA)?.id).toBe("f-disp1");
  });

  it("ignora caixa, acento e espaço sobrando no nome", () => {
    expect(acharFornecedorPorNome([{ id: "x", nome: "  0 -  DISPENSA 1 " }], "0 - Dispensa 1")?.id).toBe("x");
  });

  it("devolve null quando o cadastro não tem o fornecedor (a linha fica em branco, não quebra)", () => {
    expect(acharFornecedorPorNome([{ id: "f-acme", nome: "ACME LTDA" }], NOME_FORNECEDOR_DISPENSA)).toBeNull();
  });

  it("a linha inicial cobre 100% do Valor Total, com contrato, fornecedor e integrante", () => {
    expect(rateioInicialComPadrao(PADRAO, 326.03)).toEqual([
      {
        classificacao_id: undefined,
        empresa_id: "emp-hagg",
        contrato_id: "ct-ufrgs",
        fornecedor_id: "f-disp1",
        integrante_empregado_id: 5755,
        percentual: 100,
        valor: 326.03,
        ordem: 0,
      },
    ]);
  });

  it("linha acrescentada depois já vem com o fornecedor, mas com valor zerado", () => {
    const linha = linhaComPadrao(PADRAO, { valor: 0, percentual: null, ordem: 1 });
    expect(linha.fornecedor_id).toBe("f-disp1");
    expect(linha.contrato_id).toBe("ct-ufrgs");
    expect(linha.valor).toBe(0);
    expect(linha.percentual).toBeNull();
  });

  it("sem padrão, a linha nasce em branco como sempre nasceu (outras telas do Malote)", () => {
    expect(linhaComPadrao(null, { valor: 0, percentual: null, ordem: 0 })).toMatchObject({
      empresa_id: null,
      contrato_id: null,
      fornecedor_id: null,
      integrante_empregado_id: null,
    });
  });
});

describe("Informações de pagamento da Diária UFRGS", () => {
  const base = { id: "DU-2026-000004", numeroOficio: "902/2026", motoristaNome: "MAIKON MOREIRA KAIPPER" };

  it("com chave, a chave vem primeiro — é o que quem paga copia", () => {
    expect(informacoesPagamentoUfrgs({ ...base, pix: "(51) 99827-0854", pixTipo: "celular" })).toBe(
      "PIX (Celular): (51) 99827-0854 — MAIKON MOREIRA KAIPPER",
    );
  });

  it("diária antiga, sem chave, mantém o texto de antes", () => {
    expect(informacoesPagamentoUfrgs({ ...base, pix: "", pixTipo: null })).toBe(
      "Diária UFRGS DU-2026-000004 — ofício 902/2026, MAIKON MOREIRA KAIPPER",
    );
  });
});
