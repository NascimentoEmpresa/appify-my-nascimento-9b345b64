import { describe, expect, it } from "vitest";
import { donosDosEnderecos, filtrarSugestoes, sugestoesDosContatos } from "@/lib/email/caixa";

// Módulo E-mail (06/11/2026): os contatos vêm de email_contatos() — colegas,
// fornecedores (para quem vê Fornecedores) e quem a pessoa já mandou.
describe("sugestoesDosContatos", () => {
  const contatos = [
    { email: "Maria@Grp.com.br", nome: "Maria Souza", origem: "Colega", ref_id: "u1" },
    { email: "vendas@acme.com.br", nome: "Acme", origem: "Fornecedor · principal", ref_id: "f1" },
    { email: "vendas@acme.com.br", nome: null, origem: "Enviado antes", ref_id: null },
    { email: "alguem@fora.com", nome: null, origem: "Enviado antes", ref_id: null },
    { email: "nao-e-email", nome: "Lixo", origem: "Colega", ref_id: "u9" },
  ];

  it("normaliza, descarta o que não é e-mail e não repete 'Enviado antes' de quem já tem nome", () => {
    const s = sugestoesDosContatos(contatos);
    expect(s.map((x) => `${x.email}|${x.rotulo}`)).toEqual([
      "maria@grp.com.br|Colega",
      "vendas@acme.com.br|Fornecedor · principal",
      "alguem@fora.com|Enviado antes",
    ]);
  });

  it("sem nome, o dono é o próprio endereço", () => {
    const s = sugestoesDosContatos(contatos);
    expect(s.find((x) => x.email === "alguem@fora.com")).toMatchObject({ donoId: "alguem@fora.com", donoNome: "alguem@fora.com" });
  });

  it("busca por nome do colega e liga endereço ao dono", () => {
    const s = sugestoesDosContatos(contatos);
    expect(filtrarSugestoes(s, "maria", []).map((x) => x.email)).toEqual(["maria@grp.com.br"]);
    expect(donosDosEnderecos(s, ["MARIA@grp.com.br"])).toEqual(["u1"]);
  });
});
