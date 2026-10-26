import { describe, expect, it } from "vitest";
import { lerEmails, previaDoModelo, semDuplicados, validarModelo, variaveisDesconhecidas } from "@/pages/cobrancas/regrasModelosEmails";

describe("SIS-2026-0653 — modelos de e-mail", () => {
  it("modelo válido não tem problema", () => {
    expect(validarModelo("Pendência - {{cliente}}", "Prezado, {{lista_html}} Total {{valor_total}}")).toEqual([]);
  });
  it("bloqueia corpo sem a lista de notas, assunto vazio, variável desconhecida e chave com espaço", () => {
    const p = validarModelo("", "Olá {{ cliente }} {{inventada}}");
    const textos = p.map((x) => x.texto).join(" | ");
    expect(p.every((x) => x.bloqueia)).toBe(true);
    expect(textos).toMatch(/assunto/i);
    expect(textos).toMatch(/lista_html/);
    expect(textos).toMatch(/\{\{ cliente \}\}/);
    expect(textos).toMatch(/\{\{inventada\}\}/);
  });
  it("acha variáveis desconhecidas", () => {
    expect(variaveisDesconhecidas("{{cliente}} {{x}} {{x}}")).toEqual(["x"]);
  });
  it("prévia troca as variáveis e acrescenta as NFs ao assunto", () => {
    const r = previaDoModelo("verde", "Pendência - {{cliente}}", "Total {{valor_total}} {{lista_html}}", "", 2);
    expect(r.assunto).toBe("Pendência - ÓRGÃO EXEMPLO - 000/2026 (NFs: 1234, 1301)");
    expect(r.corpo).toContain("1234");
    expect(r.corpo).not.toContain("{{");
  });
});

describe("SIS-2026-0653 — destinatários", () => {
  it("lê vários e-mails colados, sem repetir e separando os inválidos", () => {
    const r = lerEmails("dcc-scv@pc.rs.gov.br; A@x.com, a@x.com\nsem-arroba, b@y.org");
    expect(r.validos).toEqual(["dcc-scv@pc.rs.gov.br", "A@x.com", "b@y.org"]);
    expect(r.invalidos).toEqual(["sem-arroba"]);
  });
  it("não adiciona e-mail que o contrato já tem (sem diferenciar maiúscula)", () => {
    expect(semDuplicados(["A@x.com", "c@z.com"], ["a@X.com"])).toEqual({ adicionar: ["c@z.com"], jaExistiam: ["A@x.com"] });
  });
});
