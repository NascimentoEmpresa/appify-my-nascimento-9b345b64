import { describe, it, expect } from "vitest";
import { matchMenuCodes, rotaLiberada } from "@/hooks/useAccessibleMenus";

// Sete rotas do ERP têm DOIS menus ativos apontando para elas — um código
// legado e o atual. Como as rotas são idênticas, o desempate "mais longa
// vence" caía no primeiro que o banco devolvesse, em ordem arbitrária.
//
// Caso real: usuária com `recrutamento_gestao` liberado na tela de Acesso por
// Usuário não via o módulo, porque a sidebar resolvia a rota para o legado
// `recrutamento`, que ela não tinha. Nada na tela de permissão indicava isso.
const ROTAS = [
  { codigo: "recrutamento", rota: "/app/rh/recrutamento" },
  { codigo: "recrutamento_gestao", rota: "/app/rh/recrutamento" },
  { codigo: "colaboradores", rota: "/app/rh/colaboradores" },
  { codigo: "processos", rota: "/app/juridico/processos" },
  { codigo: "juridico_processos", rota: "/app/juridico/processos" },
];
const SEMPRE_RESTRITOS = new Set(["administracao"]);
const acesso = (codes: string[], configured: string[]) => ({
  routes: ROTAS,
  codes: new Set(codes),
  configuredCodes: new Set(configured),
});

describe("matchMenuCodes", () => {
  it("devolve os DOIS codigos quando a rota e duplicada", () => {
    expect(matchMenuCodes("/app/rh/recrutamento", ROTAS).sort())
      .toEqual(["recrutamento", "recrutamento_gestao"]);
  });

  it("rota sem duplicata devolve um codigo so", () => {
    expect(matchMenuCodes("/app/rh/colaboradores", ROTAS)).toEqual(["colaboradores"]);
  });

  it("rota que nao existe em app_menu nao casa com nada", () => {
    expect(matchMenuCodes("/app/inexistente", ROTAS)).toEqual([]);
  });
});

describe("rotaLiberada — rotas com codigo legado", () => {
  // O caso que motivou a correção.
  it("liberar SO o codigo atual ja mostra a tela", () => {
    const a = acesso(["recrutamento_gestao"], ["recrutamento", "recrutamento_gestao"]);
    expect(rotaLiberada("/app/rh/recrutamento", a, SEMPRE_RESTRITOS)).toBe(true);
  });

  it("liberar SO o codigo legado tambem mostra a tela", () => {
    const a = acesso(["recrutamento"], ["recrutamento", "recrutamento_gestao"]);
    expect(rotaLiberada("/app/rh/recrutamento", a, SEMPRE_RESTRITOS)).toBe(true);
  });

  it("sem nenhum dos dois liberado, continua escondida", () => {
    const a = acesso([], ["recrutamento", "recrutamento_gestao"]);
    expect(rotaLiberada("/app/rh/recrutamento", a, SEMPRE_RESTRITOS)).toBe(false);
  });
});

describe("rotaLiberada — regras que nao podiam mudar", () => {
  it("rota fora do app_menu segue aberta", () => {
    expect(rotaLiberada("/app/inexistente", acesso([], []), SEMPRE_RESTRITOS)).toBe(true);
  });

  it("menu que ninguem nunca configurou segue aberto", () => {
    expect(rotaLiberada("/app/rh/colaboradores", acesso([], []), SEMPRE_RESTRITOS)).toBe(true);
  });

  it("menu configurado e nao liberado continua escondido", () => {
    const a = acesso([], ["colaboradores"]);
    expect(rotaLiberada("/app/rh/colaboradores", a, SEMPRE_RESTRITOS)).toBe(false);
  });

  // Sem isto, "nunca configurado = aberto" viraria uma porta para administração.
  it("menu sempre restrito nao se beneficia do 'nunca configurado'", () => {
    const a = { routes: [{ codigo: "administracao", rota: "/app/admin" }], codes: new Set<string>(), configuredCodes: new Set<string>() };
    expect(rotaLiberada("/app/admin", a, SEMPRE_RESTRITOS)).toBe(false);
  });
});
