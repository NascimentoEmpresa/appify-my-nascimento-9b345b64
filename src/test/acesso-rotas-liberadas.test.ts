import { describe, it, expect } from "vitest";
import { rotaSempreLiberada } from "@/lib/acesso";

/**
 * Regressão real: quando o ERP passou a negar por padrão, "/app" ficou de fora
 * da allowlist. Resultado em produção — o usuário logava e tomava "Acesso
 * negado" na própria tela inicial, e não havia como liberar pelo painel de
 * administração, porque "/app" é o shell e não tem entrada em app_menu.
 *
 * A correção não pode ser ingênua: a allowlist casa por PREFIXO, então colocar
 * "/app" nela liberaria "/app/qualquer-coisa" e anularia o controle de acesso
 * inteiro. Daí a lista separada de casamento exato. Estes testes fixam as duas
 * metades — a home abre, e nada abaixo dela vaza junto.
 */
describe("rotaSempreLiberada", () => {
  it("libera a tela inicial /app", () => {
    expect(rotaSempreLiberada("/app")).toBe(true);
  });

  it("libera /app mesmo com barra no fim", () => {
    expect(rotaSempreLiberada("/app/")).toBe(true);
  });

  it("NÃO libera telas de negócio por baixo de /app", () => {
    // O ponto central: "/app" liberado por prefixo teria deixado tudo passar.
    expect(rotaSempreLiberada("/app/financeiro/contas-pagar")).toBe(false);
    expect(rotaSempreLiberada("/app/suprimentos/estoque-etiquetas")).toBe(false);
    expect(rotaSempreLiberada("/app/administracao")).toBe(false);
    expect(rotaSempreLiberada("/app/juridico")).toBe(false);
  });

  it("libera o próprio perfil e as subrotas dele", () => {
    expect(rotaSempreLiberada("/app/meu-perfil")).toBe(true);
    expect(rotaSempreLiberada("/app/meu-perfil/discord")).toBe(true);
  });

  it("NÃO libera /app/sistemas — é a área dos desenvolvedores do ERP", () => {
    // Esteve liberada por engano, como "canal pra pedir acesso". Só enxerga
    // quem receber a permissão no painel.
    expect(rotaSempreLiberada("/app/sistemas")).toBe(false);
    expect(rotaSempreLiberada("/app/sistemas/chamados")).toBe(false);
    expect(rotaSempreLiberada("/app/sistemas/chamados/novo")).toBe(false);
    expect(rotaSempreLiberada("/app/sistemas/desenvolvedores")).toBe(false);
  });

  it("libera os avisos do sistema, que a sidebar mostra para todos", () => {
    expect(rotaSempreLiberada("/app/novidades")).toBe(true);
  });

  it("não confunde rota que apenas começa com o mesmo texto", () => {
    // "/app/meu-perfilado" não é subrota de "/app/meu-perfil".
    expect(rotaSempreLiberada("/app/meu-perfilado")).toBe(false);
    expect(rotaSempreLiberada("/application")).toBe(false);
  });
});
