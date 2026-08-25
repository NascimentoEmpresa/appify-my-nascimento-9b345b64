import { describe, it, expect } from "vitest";
import {
  decidirDestino, soDigitos, fmtDoc, type FornecedorExistente,
} from "@/hooks/useFornecedorCadastro";

/**
 * SIS-2026-0209 — cadastro de fornecedor preenchido pelo próprio fornecedor.
 *
 * A decisão mais delicada da fila é: aprovar isso cria um fornecedor novo ou
 * atualiza um que já existe? Errar para o lado do "novo" faz o INSERT bater no
 * UNIQUE (empresa_id, cnpj_cpf) e a aprovação falhar na cara do usuário; errar
 * para o lado do "atualiza" sobrescreve o cadastro de outra empresa do grupo.
 *
 * O ponto que engana: o MESMO CNPJ existir no banco não quer dizer nada
 * sozinho. O grupo tem várias empresas e o mesmo fornecedor costuma atender
 * mais de uma. Só a empresa escolhida na aprovação responde a pergunta.
 */

const NASCIMENTO = "empresa-1";
const HAGG = "empresa-2";

const roverim: FornecedorExistente = {
  id: "f1", empresa_id: NASCIMENTO, razao_social: "Roverim Uniformes", ativo: true,
};
const roverimNaHagg: FornecedorExistente = {
  id: "f2", empresa_id: HAGG, razao_social: "Roverim Uniformes", ativo: true,
};

describe("decidirDestino — novo cadastro ou atualização", () => {
  it("CNPJ inédito é cadastro novo", () => {
    const d = decidirDestino([], NASCIMENTO);
    expect(d.tipo).toBe("novo");
    expect(d.existeEmOutras).toEqual([]);
  });

  it("CNPJ que já existe NA empresa escolhida vira atualização", () => {
    const d = decidirDestino([roverim], NASCIMENTO);
    expect(d.tipo).toBe("atualizacao");
    if (d.tipo === "atualizacao") expect(d.alvo.id).toBe("f1");
  });

  it("CNPJ que existe só em OUTRA empresa continua sendo cadastro novo", () => {
    // É o caso que quebraria o cadastro se olhássemos só "o CNPJ existe?":
    // o fornecedor atende a Hagg e agora vai atender a Nascimento também.
    const d = decidirDestino([roverimNaHagg], NASCIMENTO);
    expect(d.tipo).toBe("novo");
    expect(d.existeEmOutras).toHaveLength(1);
  });

  it("existindo nas duas, atualiza a escolhida e apenas sinaliza a outra", () => {
    const d = decidirDestino([roverim, roverimNaHagg], NASCIMENTO);
    expect(d.tipo).toBe("atualizacao");
    if (d.tipo === "atualizacao") {
      expect(d.alvo.empresa_id).toBe(NASCIMENTO);
      expect(d.existeEmOutras.map((f) => f.empresa_id)).toEqual([HAGG]);
    }
  });

  it("sem empresa escolhida ainda não dá para decidir — trata como novo", () => {
    // A tela não deixa aprovar sem empresa; aqui só garantimos que não
    // escolhe um alvo por conta própria.
    const d = decidirDestino([roverim, roverimNaHagg], null);
    expect(d.tipo).toBe("novo");
    expect(d.existeEmOutras).toHaveLength(2);
  });
});

describe("soDigitos — o fornecedor digita com máscara, o cadastro antigo nem sempre tem", () => {
  it("tira pontuação de CNPJ", () => {
    expect(soDigitos("03.644.009/0001-23")).toBe("03644009000123");
  });

  it("compara igual com e sem máscara", () => {
    expect(soDigitos("03.644.009/0001-23")).toBe(soDigitos("03644009000123"));
  });

  it("nulo e vazio não quebram", () => {
    expect(soDigitos(null)).toBe("");
    expect(soDigitos(undefined)).toBe("");
    expect(soDigitos("")).toBe("");
  });
});

describe("fmtDoc — como o documento aparece na fila", () => {
  it("formata CNPJ de 14 dígitos", () => {
    expect(fmtDoc("03644009000123")).toBe("03.644.009/0001-23");
  });

  it("formata CPF de 11 dígitos", () => {
    expect(fmtDoc("12345678901")).toBe("123.456.789-01");
  });

  it("documento incompleto sai como veio, sem inventar máscara", () => {
    expect(fmtDoc("123")).toBe("123");
  });

  it("vazio vira travessão", () => {
    expect(fmtDoc(null)).toBe("—");
  });
});
