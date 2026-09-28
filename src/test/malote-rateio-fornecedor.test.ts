import { describe, it, expect } from "vitest";
import { erroFornecedorNoRateio, erroEmpresaNoRateio } from "@/pages/malote/rateioValidacao";

const COM_FORNECEDOR = [
  { fornecedor_id: "f1", integrante_empregado_id: null },
  { fornecedor_id: "f2", integrante_empregado_id: null },
];
const COM_INTEGRANTE = [
  { fornecedor_id: null, integrante_empregado_id: 1 },
  { fornecedor_id: null, integrante_empregado_id: 2 },
];
const MISTO = [
  { fornecedor_id: "f1", integrante_empregado_id: null },
  { fornecedor_id: null, integrante_empregado_id: 2 },
];
const SEM_NENHUM = [
  { fornecedor_id: "f1", integrante_empregado_id: null },
  { fornecedor_id: null, integrante_empregado_id: null },
];

describe("Fornecedor OU Integrante no Rateio ([SEM-CHAMADO] 25/09, volta pro SIS-2026-0457)", () => {
  it("exige pelo menos uma das duas dimensões marcada", () => {
    expect(erroFornecedorNoRateio({ fornecedor: false, integrante: false }, COM_FORNECEDOR)).toBe(
      'Marque "Fornecedor" ou "Integrante" no Rateio e informe um dos dois em cada linha.',
    );
  });

  it("exige Fornecedor OU Integrante preenchido em TODAS as linhas, não só na primeira", () => {
    expect(erroFornecedorNoRateio({ fornecedor: true, integrante: true }, SEM_NENHUM)).toBe(
      "Informe o Fornecedor ou o Integrante em todas as linhas do rateio.",
    );
  });

  it("aceita quando toda linha tem Fornecedor", () => {
    expect(erroFornecedorNoRateio({ fornecedor: true, integrante: false }, COM_FORNECEDOR)).toBeNull();
  });

  it("aceita quando toda linha tem Integrante", () => {
    expect(erroFornecedorNoRateio({ fornecedor: false, integrante: true }, COM_INTEGRANTE)).toBeNull();
  });

  it("aceita linhas misturando Fornecedor numa e Integrante noutra", () => {
    expect(erroFornecedorNoRateio({ fornecedor: true, integrante: true }, MISTO)).toBeNull();
  });

  it("rateio vazio não vira erro (quem cobra isso é a regra do total)", () => {
    expect(erroFornecedorNoRateio({ fornecedor: true, integrante: false }, [])).toBeNull();
  });
});

describe("Empresa obrigatória no Rateio ([SEM-CHAMADO] 25/09, achado DM-2026-1364)", () => {
  it("exige Empresa só nas linhas que realmente exibem a coluna", () => {
    expect(
      erroEmpresaNoRateio([
        { empresa_id: "e1", exigeEmpresa: true },
        { empresa_id: null, exigeEmpresa: true },
      ]),
    ).toBe("Informe a Empresa em todas as linhas do rateio.");
  });

  it("não reprova linha sem Empresa quando a coluna nem se aplica a ela", () => {
    expect(
      erroEmpresaNoRateio([
        { empresa_id: "e1", exigeEmpresa: true },
        { empresa_id: null, exigeEmpresa: false },
      ]),
    ).toBeNull();
  });

  it("aceita quando toda linha exigida já tem Empresa", () => {
    expect(
      erroEmpresaNoRateio([
        { empresa_id: "e1", exigeEmpresa: true },
        { empresa_id: "e2", exigeEmpresa: true },
      ]),
    ).toBeNull();
  });
});
