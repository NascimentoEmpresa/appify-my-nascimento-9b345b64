import { describe, expect, it } from "vitest";
import {
  conferirAntesDeEnviar, corpoEncaminhado, emailValido, enderecosDosFornecedores, esqueceuAnexo,
  filtrarSugestoes, formatarTamanho, fornecedoresDosEnderecos, nomeArquivoSeguro, separarEnderecos,
} from "@/lib/suprimentos/fornecedorEmail";

const fornecedores = [
  { id: "a", razao_social: "ACME LTDA", nome_fantasia: "Acme", email: "vendas@acme.com.br",
    email_financeiro: "fin@acme.com.br; cobranca@acme.com.br", email_nota_fiscal: "vendas@acme.com.br" },
  { id: "b", razao_social: "João Peças ME", nome_fantasia: null, email: "joao@pecas.com", email_financeiro: null, email_nota_fiscal: "nao-e-email" },
];

describe("separarEnderecos", () => {
  it("aceita vírgula, ponto e vírgula, quebra de linha e formato do Outlook", () => {
    expect(separarEnderecos("A@x.com, b@y.com;\nFulano de Tal <c@z.com>")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });
  it("não repete", () => {
    expect(separarEnderecos("a@x.com a@x.com")).toEqual(["a@x.com"]);
  });
});

describe("enderecosDosFornecedores", () => {
  it("junta principal, financeiro e nota sem repetir e ignora o que não é e-mail", () => {
    const s = enderecosDosFornecedores(fornecedores);
    expect(s.map((x) => x.email)).toEqual(["vendas@acme.com.br", "fin@acme.com.br", "cobranca@acme.com.br", "joao@pecas.com"]);
    expect(s[1].rotulo).toBe("Financeiro");
  });
});

describe("filtrarSugestoes", () => {
  const s = enderecosDosFornecedores(fornecedores);
  it("acha pelo nome sem acento e tira o que já está escolhido", () => {
    expect(filtrarSugestoes(s, "joao", []).map((x) => x.email)).toEqual(["joao@pecas.com"]);
    expect(filtrarSugestoes(s, "acme", ["fin@acme.com.br"]).map((x) => x.email)).toEqual(["vendas@acme.com.br", "cobranca@acme.com.br"]);
  });
  it("termo vazio não sugere nada", () => {
    expect(filtrarSugestoes(s, "  ", [])).toEqual([]);
  });
  it("liga os endereços aos fornecedores", () => {
    expect(fornecedoresDosEnderecos(s, ["COBRANCA@acme.com.br", "x@y.com"])).toEqual(["a"]);
  });
});

describe("conferirAntesDeEnviar", () => {
  const base = { para: ["a@x.com"], cc: [], cco: [], assunto: "Cotação", corpoTexto: "oi", anexosBytes: 0 };
  it("mensagem certa passa", () => expect(conferirAntesDeEnviar(base)).toEqual([]));
  it("sem Para, sem assunto e endereço ruim", () => {
    const p = conferirAntesDeEnviar({ ...base, para: [], cc: ["ruim"], assunto: " " });
    expect(p.map((x) => x.campo)).toEqual(["para", "cc", "assunto"]);
  });
  it("anexos acima de 20 MB", () => {
    expect(conferirAntesDeEnviar({ ...base, anexosBytes: 21 * 1024 * 1024 })[0].campo).toBe("anexos");
  });
});

describe("esqueceuAnexo", () => {
  it("avisa quando fala em anexo e não tem", () => {
    expect(esqueceuAnexo("Pedido", "Segue em anexo a planilha", 0)).toBe(true);
    expect(esqueceuAnexo("Pedido", "Segue em anexo a planilha", 1)).toBe(false);
    expect(esqueceuAnexo("Bom dia", "Tudo certo?", 0)).toBe(false);
  });
});

describe("utilidades", () => {
  it("valida e-mail", () => {
    expect(emailValido("a@b.com")).toBe(true);
    expect(emailValido("a@b")).toBe(false);
  });
  it("formata tamanho", () => {
    expect(formatarTamanho(500)).toBe("500 B");
    expect(formatarTamanho(1536 * 1024)).toBe("1,5 MB");
  });
  it("nome de arquivo seguro para o Storage", () => {
    expect(nomeArquivoSeguro("Cotação nº 1/2026.pdf")).toBe("Cotacao_n_1_2026.pdf");
  });
  it("encaminhado escapa o cabeçalho", () => {
    const h = corpoEncaminhado({ de_nome: "<b>x</b>", de_email: "a@b.com", enviado_em: null, assunto: "A&B", para: ["c@d.com"], cc: [], corpo_html: "<p>oi</p>" });
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(h).toContain("A&amp;B");
    expect(h.endsWith("<p>oi</p>")).toBe(true);
  });
});
