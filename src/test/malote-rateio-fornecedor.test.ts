import { describe, it, expect } from "vitest";
import { erroFornecedorNoRateio } from "@/pages/malote/rateioValidacao";

const COM = [{ fornecedor_id: "f1" }, { fornecedor_id: "f2" }];
const SEM = [{ fornecedor_id: "f1" }, { fornecedor_id: null }];

describe("Fornecedor no Rateio — Malote (SIS-2026-0467)", () => {
  it("exige a dimensão Fornecedor marcada", () => {
    expect(erroFornecedorNoRateio(true, { fornecedor: false }, COM)).toBe(
      'Marque "Fornecedor" no Rateio e informe-o em cada linha.',
    );
  });

  it("exige Fornecedor preenchido em TODAS as linhas", () => {
    expect(erroFornecedorNoRateio(true, { fornecedor: true }, SEM)).toBe(
      "Informe o Fornecedor em todas as linhas do rateio.",
    );
  });

  it("aceita quando toda linha tem Fornecedor", () => {
    expect(erroFornecedorNoRateio(true, { fornecedor: true }, COM)).toBeNull();
  });
});

describe("Fornecedor no Rateio — aprovação de diária (SIS-2026-0480)", () => {
  // Diária não tem fornecedor: o PIX sai para o próprio colaborador. Todas as
  // despesas de diária já pagas em produção têm fornecedor_id nulo. Com o
  // SIS-2026-0467 valendo aqui, a aprovação de diária era impossível de
  // concluir — era o bloqueio do chamado.
  it("não exige nada quando quem embute o painel não trabalha com fornecedor", () => {
    expect(erroFornecedorNoRateio(false, { fornecedor: false }, SEM)).toBeNull();
  });

  it("segue liberando mesmo com linha sem fornecedor e dimensão marcada", () => {
    expect(erroFornecedorNoRateio(false, { fornecedor: true }, SEM)).toBeNull();
  });

  it("não atrapalha quem quiser informar fornecedor mesmo assim", () => {
    expect(erroFornecedorNoRateio(false, { fornecedor: true }, COM)).toBeNull();
  });

  it("rateio vazio não vira erro de fornecedor (quem cobra isso é a regra do total)", () => {
    expect(erroFornecedorNoRateio(false, { fornecedor: false }, [])).toBeNull();
    expect(erroFornecedorNoRateio(true, { fornecedor: true }, [])).toBeNull();
  });
});
