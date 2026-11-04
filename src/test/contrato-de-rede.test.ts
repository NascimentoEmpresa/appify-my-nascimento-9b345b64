// Contrato de rede do QA (04/11/2026): a regra que julga a REQUISIÇÃO, e não o
// texto do código, para pegar o que as regras D5/D6 do guardião não alcançam
// (nome de tabela em variável, chamada dentro de hook, consulta de biblioteca).
// Se esta regra afrouxar, estes testes dizem.
import { describe, expect, it } from "vitest";
import { violacaoDeContrato } from "../../infra/qa/contrato-de-rede.mjs";

const GET = (url: string, cabecalhos: Record<string, string> = {}) =>
  violacaoDeContrato({ url, metodo: "GET", cabecalhos }) as string | null;

describe("contrato de rede — tabela grande", () => {
  it("reprova lista sem limit nem Range", () => {
    expect(GET("/rest/v1/EMPREGADOS?select=id,nome")).toMatch(/sem limit\/Range/);
  });

  it("aceita com limit, com offset ou com cabeçalho Range", () => {
    expect(GET("/rest/v1/EMPREGADOS?select=id&limit=50")).toBeNull();
    expect(GET("/rest/v1/EMPREGADOS?select=id&offset=0&limit=20")).toBeNull();
    expect(GET("/rest/v1/EMPREGADOS?select=id", { Range: "0-49" })).toBeNull();
  });

  it("reprova select=* mesmo paginado", () => {
    expect(GET("/rest/v1/EMPREGADOS?select=*&limit=50")).toMatch(/select=\*/);
  });

  it("aceita leitura de uma linha só (.single ou filtro por id)", () => {
    expect(GET("/rest/v1/EMPREGADOS?select=*&id=eq.7")).toBeNull();
    expect(GET("/rest/v1/EMPREGADOS?select=*", { Accept: "application/vnd.pgrst.object+json" })).toBeNull();
  });

  it("não reprova escrita nem contagem (HEAD)", () => {
    expect(violacaoDeContrato({ url: "/rest/v1/EMPREGADOS", metodo: "POST" })).toBeNull();
    expect(violacaoDeContrato({ url: "/rest/v1/EMPREGADOS?select=*", metodo: "HEAD" })).toBeNull();
  });
});

describe("contrato de rede — o que está fora dele", () => {
  it("tabela pequena passa sem janela", () => {
    expect(GET("/rest/v1/app_menu?select=*")).toBeNull();
  });

  it("RPC, auth e storage não são julgados por esta regra", () => {
    expect(GET("/rest/v1/rpc/listar_empregados")).toBeNull();
    expect(GET("/auth/v1/user")).toBeNull();
    expect(GET("/storage/v1/object/anexos/x.pdf")).toBeNull();
  });

  it("URL absoluta é tratada igual à relativa", () => {
    expect(GET("https://api.grpnascimento.com.br/rest/v1/EMPREGADOS?select=id")).toMatch(/sem limit\/Range/);
  });
});
