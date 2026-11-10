import { describe, expect, it } from "vitest";
import { destinoAposAprovar, estadoDeRetornoDaLista } from "@/pages/malote/retornoAprovacao";

// SIS-2026-0840: voltar à lista de aprovações depois de aprovar.
describe("retorno às Aprovações do Malote", () => {
  it("a lista guarda a própria rota (com a query) e a despesa volta para ela", () => {
    const estado = estadoDeRetornoDaLista("/app/malote/aprovacoes", "?status=pendente_aprovacao");
    expect(destinoAposAprovar(estado)).toBe("/app/malote/aprovacoes?status=pendente_aprovacao");
  });
  it("despesa aberta por outro caminho (sem state) fica onde está", () => {
    expect(destinoAposAprovar(null)).toBeNull();
    expect(destinoAposAprovar(undefined)).toBeNull();
    expect(destinoAposAprovar({})).toBeNull();
  });
  it("só aceita caminho interno do app", () => {
    expect(destinoAposAprovar({ voltarPara: "https://exemplo.com/x" })).toBeNull();
    expect(destinoAposAprovar({ voltarPara: "//exemplo.com/x" })).toBeNull();
    expect(destinoAposAprovar({ voltarPara: 42 })).toBeNull();
    expect(destinoAposAprovar({ voltarPara: "/app/malote/aprovacoes" })).toBe("/app/malote/aprovacoes");
  });
});
