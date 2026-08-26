import { describe, it, expect } from "vitest";
import { matchMenuCode, type MenuRoute } from "@/hooks/useAccessibleMenus";

/**
 * Incidente real em produção. A MESMA rota aparece cadastrada duas vezes em
 * vários pontos do ERP: uma entrada viva e uma sobra desativada de quando a
 * tela mudou de módulo. Exemplo que quebrou:
 *
 *   /app/rh/recrutamento  ->  `recrutamento`        (RH, INATIVO)
 *                             `recrutamento_gestao` (Recrutamento, ATIVO)
 *
 * matchMenuCode desempatava pela ordem que o banco devolveu. Se viesse a
 * inativa primeiro, o RouteGuard bloqueava a tela — e o painel de acesso não
 * resolvia, porque lá só aparece a ativa, e conceder nela não mudava o
 * casamento. Sintoma relatado: "Gestão e Recrutamento sumiu do gerenciamento
 * de acesso" e "sumiu da sidebar do usuário".
 */
describe("matchMenuCode — desempate por menu ativo", () => {
  const rotasDuplicadas: MenuRoute[] = [
    // Inativa PRIMEIRO de propósito: é a ordem que reproduzia o bug.
    { codigo: "recrutamento", rota: "/app/rh/recrutamento", ativo: false },
    { codigo: "recrutamento_gestao", rota: "/app/rh/recrutamento", ativo: true },
  ];

  it("prefere o menu ATIVO quando a mesma rota tem duas entradas", () => {
    expect(matchMenuCode("/app/rh/recrutamento", rotasDuplicadas)).toBe("recrutamento_gestao");
  });

  it("prefere o ativo mesmo se ele vier depois na lista", () => {
    const invertido = [...rotasDuplicadas].reverse();
    expect(matchMenuCode("/app/rh/recrutamento", invertido)).toBe("recrutamento_gestao");
  });

  it("rota mais específica ainda ganha, mesmo que a genérica esteja ativa", () => {
    // Foi o que manteve /painel funcionando enquanto a tela raiz caía.
    const rotas: MenuRoute[] = [
      { codigo: "chamados_sistemas", rota: "/app/sistemas/chamados", ativo: true },
      { codigo: "chamados_sistemas_painel", rota: "/app/sistemas/chamados/painel", ativo: true },
    ];
    expect(matchMenuCode("/app/sistemas/chamados/painel", rotas)).toBe("chamados_sistemas_painel");
    expect(matchMenuCode("/app/sistemas/chamados", rotas)).toBe("chamados_sistemas");
  });

  it("devolve o inativo quando não existe alternativa ativa", () => {
    // Aqui o bloqueio é o comportamento certo: tela realmente aposentada.
    const rotas: MenuRoute[] = [
      { codigo: "pregao", rota: "/app/pregao", ativo: false },
    ];
    expect(matchMenuCode("/app/pregao", rotas)).toBe("pregao");
  });

  it("devolve null para rota sem cadastro", () => {
    expect(matchMenuCode("/app/inexistente", rotasDuplicadas)).toBeNull();
  });

  it("casa subrota dinâmica pelo trecho antes do /:id", () => {
    const rotas: MenuRoute[] = [
      { codigo: "chamado_detalhe", rota: "/app/sistemas/chamados/:id", ativo: true },
    ];
    expect(matchMenuCode("/app/sistemas/chamados/abc-123", rotas)).toBe("chamado_detalhe");
  });

  it("a Conferência de Ponto: três portas para a mesma tela, e o painel não rouba o pai", () => {
    // A mesma tela abre em três módulos, cada um com o SEU menu — quem entra
    // pela porta do Financeiro não pode ser gateado pelo menu do RH. E o
    // /painel é subrota de /conferencia-ponto: sem o longest-match, ele cairia
    // no menu do pai e quem só tem o painel abriria a tela de operação (ou o
    // contrário, dependendo da ordem em que o banco devolvesse as linhas).
    const rotas: MenuRoute[] = [
      { codigo: "rh_conferencia_ponto",          rota: "/app/rh/conferencia-ponto",          ativo: true },
      { codigo: "rh_conferencia_ponto_painel",   rota: "/app/rh/conferencia-ponto/painel",   ativo: true },
      { codigo: "operacional_conferencia_ponto", rota: "/app/operacional/conferencia-ponto", ativo: true },
      { codigo: "financeiro_conferencia_ponto",  rota: "/app/financeiro/conferencia-ponto",  ativo: true },
    ];
    expect(matchMenuCode("/app/rh/conferencia-ponto", rotas)).toBe("rh_conferencia_ponto");
    expect(matchMenuCode("/app/rh/conferencia-ponto/painel", rotas)).toBe("rh_conferencia_ponto_painel");
    expect(matchMenuCode("/app/operacional/conferencia-ponto", rotas)).toBe("operacional_conferencia_ponto");
    expect(matchMenuCode("/app/financeiro/conferencia-ponto", rotas)).toBe("financeiro_conferencia_ponto");
  });
});
