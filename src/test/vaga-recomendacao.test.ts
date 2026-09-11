import { describe, expect, it } from "vitest";
import {
  erroDaRecomendacao, recomendacaoParaBanco, cpfValido, maskCpf, soDigitos,
  type RecomendacaoForm,
} from "@/lib/recrutamento/vagaRegras";

// Pedido do Pablo (10/09/2026): "Você já tem recomendação para essa vaga?
// Não - Acontece nada. Sim - Abre um card de nome completo, CPF e número de
// Whatsapp."
//
// A regra mora aqui, e não nas telas, porque são DUAS telas de vaga
// (MinhasSolicitacoes e ModalNovaVaga) — foi a duplicação delas que fez a
// mudança anterior parecer que não tinha funcionado.

const base = (over: Partial<RecomendacaoForm> = {}): RecomendacaoForm => ({
  tem_recomendacao: "Sim",
  recomendacao_nome: "Maria Aparecida da Silva",
  recomendacao_cpf: "012.059.280-06",
  recomendacao_whatsapp: "(51) 99999-8888",
  ...over,
});

describe("erroDaRecomendacao", () => {
  it("respondendo Não, não cobra nada — é o \"acontece nada\" do pedido", () => {
    expect(erroDaRecomendacao(base({
      tem_recomendacao: "Não", recomendacao_nome: "", recomendacao_cpf: "", recomendacao_whatsapp: "",
    }))).toBeNull();
  });

  it("respondendo Sim com tudo certo, deixa passar", () => {
    expect(erroDaRecomendacao(base())).toBeNull();
  });

  it("cobra os três campos, um a um", () => {
    expect(erroDaRecomendacao(base({ recomendacao_nome: "" }))).toMatch(/nome completo/i);
    expect(erroDaRecomendacao(base({ recomendacao_cpf: "" }))).toMatch(/CPF/);
    expect(erroDaRecomendacao(base({ recomendacao_whatsapp: "" }))).toMatch(/WhatsApp/i);
  });

  it("recusa CPF que passa no tamanho mas não no dígito verificador", () => {
    expect(erroDaRecomendacao(base({ recomendacao_cpf: "111.111.111-11" }))).toMatch(/não confere/i);
    expect(erroDaRecomendacao(base({ recomendacao_cpf: "012.059.280-07" }))).toMatch(/não confere/i);
  });

  it("recusa telefone sem DDD — indicação sem como ligar não é indicação", () => {
    expect(erroDaRecomendacao(base({ recomendacao_whatsapp: "99999-8888" }))).toMatch(/incompleto/i);
  });

  it("um primeiro nome solto não passa: o pedido diz nome COMPLETO", () => {
    expect(erroDaRecomendacao(base({ recomendacao_nome: "Ana" }))).toMatch(/COMPLETO/);
  });
});

describe("recomendacaoParaBanco", () => {
  it("grava CPF e telefone só com dígitos — é como o banco casa com EMPREGADOS", () => {
    const r = recomendacaoParaBanco(base());
    expect(r.tem_recomendacao).toBe(true);
    expect(r.recomendacao_cpf).toBe("01205928006");
    expect(r.recomendacao_whatsapp).toBe("51999998888");
  });

  it("trocar Sim para Não APAGA o que já tinha sido digitado", () => {
    // Guardar o nome com a flag falsa deixaria uma linha que ninguém entende
    // depois — e o CHECK do banco também não aceitaria a metade contrária.
    const r = recomendacaoParaBanco(base({ tem_recomendacao: "Não" }));
    expect(r).toEqual({
      tem_recomendacao: false, recomendacao_nome: null,
      recomendacao_cpf: null, recomendacao_whatsapp: null,
    });
  });
});

describe("maskCpf / cpfValido", () => {
  it("mascara enquanto digita e não passa de 11 dígitos", () => {
    expect(maskCpf("012")).toBe("012");
    expect(maskCpf("012059")).toBe("012.059");
    expect(maskCpf("01205928006")).toBe("012.059.280-06");
    expect(soDigitos(maskCpf("0120592800699999"))).toHaveLength(11);
  });

  it("CPF de dígitos repetidos é recusado, mesmo com o tamanho certo", () => {
    expect(cpfValido("00000000000")).toBe(false);
    expect(cpfValido("012.059.280-06")).toBe(true);
  });
});
