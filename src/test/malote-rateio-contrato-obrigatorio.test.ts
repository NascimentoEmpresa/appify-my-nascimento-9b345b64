import { describe, expect, it } from "vitest";
import { erroContratoNoRateio } from "@/pages/malote/rateioValidacao";

// SIS-2026-0905: classificação do tipo "contrato" exige o Contrato na linha do rateio (é dele que vem o Centro de Custo no Fluxo de Caixa).
// Caso de origem: DM-2026-3791 foi enviada com a Empresa HAGG e o Contrato vazio e chegou ao Fluxo com o Centro de Custo em branco.
const L = (contrato_id: string | null) => ({ contrato_id });

describe("contrato obrigatório no rateio", () => {
  it("linha de classificação do tipo contrato sem contrato é barrada, dizendo qual linha", () => {
    const erro = erroContratoNoRateio([L("c1"), L(null)], () => "contrato");
    expect(erro).toMatch(/linha 2 do rateio/);
    expect(erro).toMatch(/Centro de Custo/);
  });

  it("várias linhas faltando: lista todas", () => {
    expect(erroContratoNoRateio([L(null), L("c1"), L(null)], () => "contrato")).toMatch(/linhas 1, 3 do rateio/);
  });

  it("com contrato em todas as linhas de contrato, passa", () => {
    expect(erroContratoNoRateio([L("c1"), L("c2")], () => "contrato")).toBeNull();
  });

  it("classificação administrativa não exige (o contrato é opcional e o banco preenche o ADMINISTRATIVO da empresa)", () => {
    expect(erroContratoNoRateio([L(null)], () => "administrativo")).toBeNull();
    expect(erroContratoNoRateio([L(null)], () => null)).toBeNull();
    expect(erroContratoNoRateio([L(null)], () => undefined)).toBeNull();
  });

  it("o tipo é resolvido linha a linha (rateio com classificações diferentes)", () => {
    const tipos = ["administrativo", "contrato"];
    expect(erroContratoNoRateio([L(null), L("c1")], (i) => tipos[i])).toBeNull();
    expect(erroContratoNoRateio([L(null), L(null)], (i) => tipos[i])).toMatch(/linha 2 do rateio/);
  });

  it("rateio vazio não gera erro (quem confere isso é a regra de 'ao menos uma linha')", () => {
    expect(erroContratoNoRateio([], () => "contrato")).toBeNull();
  });
});
