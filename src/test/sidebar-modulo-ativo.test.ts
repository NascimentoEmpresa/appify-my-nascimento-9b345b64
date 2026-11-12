import { describe, it, expect } from "vitest";
import {
  resolverModuloAtivo, lembradoAindaVale, type ModuloParaModuloAtivo,
} from "@/lib/menuLateral/moduloAtivo";

// Recorte da barra: a mesma tela em mais de um módulo, em ordem alfabética
// (Contábil antes de Financeiro, como no padrão).
const modulos: ModuloParaModuloAtivo[] = [
  {
    id: "contabil", status: "active",
    groups: [{ items: [{ to: "/app/contabil/cobrancas" }, { to: "/app/financeiro/relatorio-servicos" }] }],
  },
  {
    id: "financeiro", status: "active",
    groups: [{ items: [{ to: "/app/financeiro/fluxo-caixa" }, { to: "/app/financeiro/relatorio-servicos" }, { to: "/app/rh/conferencia-ponto" }] }],
  },
  {
    id: "operacional", status: "active",
    groups: [{ items: [{ to: "/app/rh/conferencia-ponto" }] }],
  },
  {
    id: "rh", status: "active", headerLink: "/app/rh",
    groups: [{ items: [{ to: "/app/rh/colaboradores" }, { to: "/app/rh/conferencia-ponto" }] }],
  },
  {
    id: "recrutamento", status: "active",
    groups: [{ items: [{ to: "/app/rh/recrutamento/vagas" }] }],
  },
  {
    id: "licitacoes", status: "active", headerLink: "/app",
    groups: [{ items: [{ to: "/app" }, { to: "/app/licitacoes" }] }],
  },
  { id: "breve", status: "soon", groups: [{ items: [{ to: "/app/financeiro/relatorio-servicos" }] }] },
];

describe("resolverModuloAtivo — tela em mais de um módulo", () => {
  it("sem memória, empate fica com o primeiro módulo (comportamento antigo)", () => {
    expect(resolverModuloAtivo(modulos, "/app/financeiro/relatorio-servicos", null)).toBe("contabil");
    expect(resolverModuloAtivo(modulos, "/app/rh/conferencia-ponto", null)).toBe("financeiro");
  });

  it("entrou pelo Financeiro: Financeiro fica aceso no Relatório de Serviços", () => {
    expect(resolverModuloAtivo(modulos, "/app/financeiro/relatorio-servicos", "financeiro")).toBe("financeiro");
  });

  it("vale para qualquer tela compartilhada (Conferência de Ponto em três módulos)", () => {
    expect(resolverModuloAtivo(modulos, "/app/rh/conferencia-ponto", "operacional")).toBe("operacional");
    expect(resolverModuloAtivo(modulos, "/app/rh/conferencia-ponto", "rh")).toBe("rh");
  });

  it("sub-rota da tela compartilhada continua no módulo lembrado", () => {
    expect(resolverModuloAtivo(modulos, "/app/financeiro/relatorio-servicos/123", "financeiro")).toBe("financeiro");
  });

  it("rota que não existe no módulo lembrado volta a resolver pela rota", () => {
    expect(resolverModuloAtivo(modulos, "/app/contabil/cobrancas", "financeiro")).toBe("contabil");
    expect(lembradoAindaVale(modulos, "/app/contabil/cobrancas", "financeiro")).toBe(false);
  });

  it("lembrado que casa só por prefixo frouxo não rouba a tela de outro módulo", () => {
    // /app/rh (hub do RH) casa com /app/rh/recrutamento/vagas, mas o item exato é do Recrutamento.
    expect(resolverModuloAtivo(modulos, "/app/rh/recrutamento/vagas", "rh")).toBe("recrutamento");
  });

  it("lembrado inexistente ou fora do ar é ignorado", () => {
    expect(resolverModuloAtivo(modulos, "/app/financeiro/relatorio-servicos", "sumiu")).toBe("contabil");
    expect(resolverModuloAtivo(modulos, "/app/financeiro/relatorio-servicos", "breve")).toBe("contabil");
  });

  it("Início não acende módulo nenhum, nem com memória", () => {
    expect(resolverModuloAtivo(modulos, "/app", null)).toBeNull();
    expect(resolverModuloAtivo(modulos, "/app", "licitacoes")).toBeNull();
    expect(resolverModuloAtivo(modulos, "/app", "financeiro")).toBeNull();
  });

  it("hub do módulo ativa o módulo; item mais longo ganha do hub", () => {
    expect(resolverModuloAtivo(modulos, "/app/rh", null)).toBe("rh");
    expect(resolverModuloAtivo(modulos, "/app/rh/colaboradores", null)).toBe("rh");
  });

  it("query no item não impede o casamento", () => {
    const comQuery: ModuloParaModuloAtivo[] = [
      { id: "a", status: "active", groups: [{ items: [{ to: "/app/x?tab=y" }] }] },
    ];
    expect(resolverModuloAtivo(comQuery, "/app/x", null)).toBe("a");
  });
});
