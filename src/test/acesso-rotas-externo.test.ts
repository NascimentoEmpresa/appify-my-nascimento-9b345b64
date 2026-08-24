import { describe, it, expect } from "vitest";
import { rotaPermitidaExterno } from "@/hooks/useModoExterno";

/**
 * A allowlist do encarregado externo (sessão anônima) é a ÚNICA regra de front
 * que decide a navegação dele: RouteGuard e Sidebar não consultam
 * list_accessible_menus nesse caso, porque ele não tem perfil de acesso nenhum.
 *
 * Ela cresceu para incluir Início, Novidades e Meu perfil — os três itens que o
 * menu dele mostra fora do módulo Encarregados. O risco de sempre mora em
 * "/app": a lista casa por PREFIXO, então "/app" ali dentro liberaria o ERP
 * inteiro de uma vez. Daí a lista separada de casamento exato, e daí estes
 * testes: eles fixam as duas metades — a home abre, e nada abaixo dela vaza.
 */
describe("rotaPermitidaExterno", () => {
  it("libera a tela inicial, e só ela, em casamento exato", () => {
    expect(rotaPermitidaExterno("/app")).toBe(true);
    expect(rotaPermitidaExterno("/app/")).toBe(true);
  });

  it("NÃO libera telas de negócio por baixo de /app", () => {
    // O ponto central: "/app" liberado por prefixo teria deixado tudo passar.
    expect(rotaPermitidaExterno("/app/financeiro/contas-pagar")).toBe(false);
    expect(rotaPermitidaExterno("/app/administracao")).toBe(false);
    expect(rotaPermitidaExterno("/app/rh/colaboradores")).toBe(false);
    expect(rotaPermitidaExterno("/app/suprimentos/produtos")).toBe(false);
    expect(rotaPermitidaExterno("/app/sistemas/chamados/painel")).toBe(false);
    expect(rotaPermitidaExterno("/app/presidencia")).toBe(false);
  });

  it("libera o módulo Encarregados inteiro", () => {
    expect(rotaPermitidaExterno("/app/encarregados")).toBe(true);
    expect(rotaPermitidaExterno("/app/encarregados/solicitar-materiais")).toBe(true);
    expect(rotaPermitidaExterno("/app/encarregados/meus-pedidos")).toBe(true);
    expect(rotaPermitidaExterno("/app/encarregados/solicitar-vaga")).toBe(true);
    expect(rotaPermitidaExterno("/app/encarregados/solicitar-ferias")).toBe(true);
    expect(rotaPermitidaExterno("/app/encarregados/solicitar-demissao")).toBe(true);
    expect(rotaPermitidaExterno("/app/encarregados/advertencia")).toBe(true);
    expect(rotaPermitidaExterno("/app/encarregados/chamados/12/acompanhar")).toBe(true);
  });

  it("libera os dois itens fixos do menu dele: avisos e a própria ficha", () => {
    expect(rotaPermitidaExterno("/app/novidades")).toBe(true);
    expect(rotaPermitidaExterno("/app/meu-perfil")).toBe(true);
  });

  it("não confunde rota que apenas começa com o mesmo texto", () => {
    expect(rotaPermitidaExterno("/app/encarregados-gestao")).toBe(false);
    expect(rotaPermitidaExterno("/app/meu-perfilado")).toBe(false);
    expect(rotaPermitidaExterno("/application")).toBe(false);
  });
});
