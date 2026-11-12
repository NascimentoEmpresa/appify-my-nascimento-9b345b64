import { describe, expect, it } from "vitest";
import { validarParametrosNfse } from "@/pages/financeiro/controle-notas/validarParametrosNfse";
import { parametrosNfse } from "./fixtures/parametrosNfse";

describe("NFS-e: revisão antes de entrar na fila", () => {
  it("preserva a inscrição municipal do tomador e exige preenchimento somente após P4016", () => {
    const p = parametrosNfse();
    expect(validarParametrosNfse(p).tomador.inscricao_municipal).toBe("");
    expect(() => validarParametrosNfse(p, "homologacao", true)).toThrow(/inscrição municipal do tomador.*P4016/);
    p.tomador.inscricao_municipal = " 00123-A ";
    expect(validarParametrosNfse(p, "homologacao", true).tomador.inscricao_municipal).toBe("00123-A");
    expect(p.tomador.inscricao_municipal).toBe(" 00123-A ");
    for (const invalida of ["1".repeat(16), "123\u0001", "12\n34", "12\t34"]) {
      p.tomador.inscricao_municipal = invalida;
      expect(() => validarParametrosNfse(p)).toThrow(/Inscrição municipal do tomador: informe até 15 caracteres/);
    }
  });
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
  it("exige código do serviço da prefeitura para 170501 em produção de Triunfo e o mantém separado do desdobramento", () => {
    const p = parametrosNfse(); p.municipio_emissor = "4322004";
    expect(() => validarParametrosNfse(p, "producao")).toThrow(/Código do serviço na prefeitura/);
    expect(() => validarParametrosNfse(p, "homologacao")).not.toThrow();
    p.codigo_integracao_municipal = " 8111700 "; p.codigo_municipal = "123";
    const normalizado = validarParametrosNfse(p, "producao");
    expect(normalizado.codigo_integracao_municipal).toBe("8111700");
    expect(normalizado.codigo_municipal).toBe("123");
    expect(p.codigo_integracao_municipal).toBe(" 8111700 ");
    for (const invalido of ["x".repeat(21), "81.11-7/00", "<codigo>"]) {
      p.codigo_integracao_municipal = invalido;
      expect(() => validarParametrosNfse(p)).toThrow(/até 20 letras ou números/);
    }
  });
});
