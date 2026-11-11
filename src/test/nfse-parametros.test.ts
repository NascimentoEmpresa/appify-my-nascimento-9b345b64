import { describe, expect, it } from "vitest";
import { validarParametrosNfse } from "@/pages/financeiro/controle-notas/validarParametrosNfse";
import { parametrosNfse } from "./fixtures/parametrosNfse";

describe("NFS-e: revisão antes de entrar na fila", () => {
  it("aceita CEP completo com máscara e normaliza os códigos sem alterar o formulário", () => {
    const original = parametrosNfse(); const normalizado = validarParametrosNfse(original);
    expect(normalizado.tomador.cep).toBe("95840000");
    expect(normalizado.codigo_tributacao).toBe("170501");
    expect(normalizado.codigo_nbs).toBe("118012100");
    expect(original.tomador.cep).toBe("95840-000");
    expect(original.codigo_tributacao).toBe("17.05.01");
    expect(normalizado.confirmacao_producao).toBe(false);
  });
  it("identifica CEP com sete dígitos e exige o código IBGE em vez do nome do município", () => {
    const p = parametrosNfse(); p.tomador.cep = "95.840-00";
    expect(() => validarParametrosNfse(p)).toThrow("CEP do tomador: informe 8 números.");
    p.tomador.cep = "95840-000"; p.local_prestacao = "Triunfo";
    expect(() => validarParametrosNfse(p)).toThrow("Local da prestação — código IBGE: informe 7 números.");
    p.local_prestacao = "4322004"; p.tomador.municipio = "Triunfo";
    expect(() => validarParametrosNfse(p)).toThrow("Município do tomador — código IBGE: informe 7 números.");
  });
  it("não aceita códigos fiscais incompletos", () => {
    for (const campo of ["codigo_tributacao", "codigo_nbs", "ibs_cst", "ibs_classificacao", "ibs_indicador_operacao"] as const) {
      const p = parametrosNfse(); p[campo] = "1";
      expect(() => validarParametrosNfse(p)).toThrow(/informe \d números/);
    }
  });
});
