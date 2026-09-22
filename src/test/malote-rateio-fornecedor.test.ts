import { describe, it, expect } from "vitest";
import { erroFornecedorNoRateio } from "@/pages/malote/rateioValidacao";

const COM = [{ fornecedor_id: "f1" }, { fornecedor_id: "f2" }];
const SEM = [{ fornecedor_id: "f1" }, { fornecedor_id: null }];

describe("Fornecedor no Rateio (SIS-2026-0467)", () => {
  it("exige a dimensão Fornecedor marcada", () => {
    expect(erroFornecedorNoRateio({ fornecedor: false }, COM)).toBe(
      'Marque "Fornecedor" no Rateio e informe-o em cada linha.',
    );
  });

  it("exige Fornecedor preenchido em TODAS as linhas, não só na primeira", () => {
    expect(erroFornecedorNoRateio({ fornecedor: true }, SEM)).toBe(
      "Informe o Fornecedor em todas as linhas do rateio.",
    );
  });

  it("aceita quando toda linha tem Fornecedor", () => {
    expect(erroFornecedorNoRateio({ fornecedor: true }, COM)).toBeNull();
  });

  it("rateio vazio não vira erro de fornecedor (quem cobra isso é a regra do total)", () => {
    expect(erroFornecedorNoRateio({ fornecedor: true }, [])).toBeNull();
  });
});

describe("A mesma regra vale na aprovação de diária (SIS-2026-0480)", () => {
  // As duas telas de diária embutem PainelDespesaMalote sem abrir exceção:
  // o que travava o Operacional não era a regra, era o combobox de Fornecedor
  // vindo vazio por RLS (ver rateioValidacao.ts e a migration ...0201).
  // Este teste existe para que uma futura "exceção para diária" tenha de
  // passar por aqui antes de voltar.
  it("diária não tem regra própria — linha sem fornecedor segue barrada", () => {
    expect(erroFornecedorNoRateio({ fornecedor: true }, SEM)).toBe(
      "Informe o Fornecedor em todas as linhas do rateio.",
    );
  });
});
