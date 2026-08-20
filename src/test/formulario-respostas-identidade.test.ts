import { describe, it, expect } from "vitest";
import { nomeCabeEm, mapaIdentidades } from "@/pages/central-servicos/FormularioRespostas";
import { normNome } from "@/pages/central-servicos/EmpregadoDetalheModal";

// O bug: no "FEEDBACK GUIADO | LIDERANÇA" a pergunta "IDENTIFICAÇÃO DO
// COLABORADOR" é o LIDERADO, não quem responde (o líder). A tela tratava o
// valor dela como apelido de quem respondeu e passava a exibir CASSIO no lugar
// de TALIS em toda a tela. `nomeCabeEm` é o que separa "escrevi meu nome
// encurtado" de "citei outra pessoa".
describe("nomeCabeEm", () => {
  it("aceita o próprio nome escrito encurtado", () => {
    expect(nomeCabeEm(normNome("Cassio Raphaelli"), "CASSIO RAPHAELLI CAMARGO DUARTE")).toBe(true);
    expect(nomeCabeEm(normNome("CÁSSIO RAPHAELLI"), "CASSIO RAPHAELLI CAMARGO DUARTE")).toBe(true);
    expect(nomeCabeEm(normNome("Cassio Duarte"), "CASSIO RAPHAELLI CAMARGO DUARTE")).toBe(true);
    expect(nomeCabeEm(normNome("Cassio"), "CASSIO RAPHAELLI CAMARGO DUARTE")).toBe(true);
  });

  it("recusa o nome de outra pessoa — o caso TALIS/CASSIO", () => {
    expect(nomeCabeEm(normNome("Talis Castro de Souza"), "CASSIO RAPHAELLI CAMARGO DUARTE")).toBe(false);
    expect(nomeCabeEm(normNome("TALIS CASTRO DE SOUZA"), "CASSIO RAPHAELLI CAMARGO DUARTE")).toBe(false);
    expect(nomeCabeEm(normNome("Isadora Prisco Silveira"), "CASSIO RAPHAELLI CAMARGO DUARTE")).toBe(false);
  });

  it("exige o mesmo primeiro nome — sobrenome solto não identifica ninguém", () => {
    // "SOUZA" sozinho casaria com meia empresa se bastasse "estar contido".
    expect(nomeCabeEm(normNome("Souza"), "TALIS CASTRO DE SOUZA")).toBe(false);
    expect(nomeCabeEm(normNome("Castro"), "TALIS CASTRO DE SOUZA")).toBe(false);
    expect(nomeCabeEm(normNome("Talis"), "TALIS CASTRO DE SOUZA")).toBe(true);
  });

  it("não inventa nada com texto vazio", () => {
    expect(nomeCabeEm("", "CASSIO RAPHAELLI CAMARGO DUARTE")).toBe(false);
    expect(nomeCabeEm(normNome("Cassio"), "")).toBe(false);
  });

  it("nome com pedaço a mais não cabe", () => {
    // Homônimo parcial: mesmo primeiro nome, mas tem sobrenome que o oficial não tem.
    expect(nomeCabeEm(normNome("Cassio Raphaelli Pereira"), "CASSIO RAPHAELLI CAMARGO DUARTE")).toBe(false);
  });
});

// Dados reais do FEEDBACK GUIADO | LIDERANÇA (formulário 4be13025…, pergunta de
// identificação 0d3e0c83…, pergunta_nome_id NULL no cadastro do formulário).
const P_IDENT = "0d3e0c83-0257-41a8-8733-1e65cf060cf6";
const RESPOSTAS = [
  // Líder logado avaliando o liderado: quem respondeu é CASSIO, o citado é TALIS.
  { respondente_nome: "CASSIO RAPHAELLI CAMARGO DUARTE",
    respondente_cadastro: { nome: "CASSIO RAPHAELLI CAMARGO DUARTE" },
    itens: { [P_IDENT]: "TALIS CASTRO DE SOUZA" } },
  { respondente_nome: "LUCAS DE JESUS SILVA",
    respondente_cadastro: { nome: "LUCAS DE JESUS SILVA" },
    itens: { [P_IDENT]: "ISADORA VELHO RAMOS" } },
  // Resposta antiga, importada: não tem quem respondeu, só o nome citado.
  { respondente_nome: null, respondente_cadastro: null,
    itens: { [P_IDENT]: "Talis Castro de Souza" } },
];

describe("mapa de identidades do Feedback Guiado", () => {
  it("não transforma o liderado em quem respondeu (o bug do print)", () => {
    const m = mapaIdentidades(RESPOSTAS, P_IDENT, false);   // pergunta_nome_id NULL
    expect(m.get("TALIS CASTRO DE SOUZA")).toBeUndefined();
    expect(m.get("ISADORA VELHO RAMOS")).toBeUndefined();
    // quem respondeu continua se reconhecendo
    expect(m.get("CASSIO RAPHAELLI CAMARGO DUARTE")).toBe("CASSIO RAPHAELLI CAMARGO DUARTE");
    expect(m.get("LUCAS DE JESUS SILVA")).toBe("LUCAS DE JESUS SILVA");
  });

  it("mantém o apelido quando a pessoa escreveu o próprio nome encurtado", () => {
    const m = mapaIdentidades([
      { respondente_nome: "CASSIO RAPHAELLI CAMARGO DUARTE",
        respondente_cadastro: { nome: "CASSIO RAPHAELLI CAMARGO DUARTE" },
        itens: { [P_IDENT]: "Cassio Raphaelli" } },
    ], P_IDENT, false);
    expect(m.get("CASSIO RAPHAELLI")).toBe("CASSIO RAPHAELLI CAMARGO DUARTE");
  });

  it("com pergunta_nome_id configurado, o formulário manda", () => {
    const m = mapaIdentidades(RESPOSTAS, P_IDENT, true);
    expect(m.get("TALIS CASTRO DE SOUZA")).toBe("CASSIO RAPHAELLI CAMARGO DUARTE");
  });
});
