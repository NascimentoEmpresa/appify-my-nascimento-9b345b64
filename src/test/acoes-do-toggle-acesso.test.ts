import { describe, expect, it } from "vitest";
import {
  ACOES_DO_TOGGLE_PADRAO,
  ACOES_FORA_DO_TOGGLE,
  acoesGravadasPeloToggle,
} from "@/lib/acoesDoToggleAcesso";

/**
 * O que ligar/desligar uma TELA no Gerenciamento de Acesso grava de verdade.
 *
 * Relato de 16/09/2026: "não encontrei nada no gerenciamento de acesso que faça
 * essa separação entre somente ver, poder criar e poder aprovar". Não havia
 * mesmo — o toggle da tela gravava o pacote inteiro, 'aprovar' junto, e não
 * existia switch de 'aprovar' em Diárias para desfazer isso. Ou seja: dar o
 * Operacional de Diárias a alguém para CONFERIR dava, no mesmo clique, o poder
 * de liberar pagamento a pessoa física.
 *
 * Estes testes travam a regra dos dois lados — o que ligar concede e o que
 * desligar revoga —, que é onde um descuido vira furo de permissão.
 */

describe("pacote padrão do toggle", () => {
  it("continua concedendo o pacote de trabalho nas telas sem exceção", () => {
    expect(acoesGravadasPeloToggle("contas-pagar", true)).toEqual([
      ...ACOES_DO_TOGGLE_PADRAO,
    ]);
  });

  it("desligar uma tela sem exceção revoga o mesmo pacote", () => {
    expect(acoesGravadasPeloToggle("contas-pagar", false)).toEqual([
      ...ACOES_DO_TOGGLE_PADRAO,
    ]);
  });
});

describe("Diárias — 'aprovar' não pega carona no toggle", () => {
  it("ligar a tela do Operacional NÃO concede aprovar", () => {
    const concedidas = acoesGravadasPeloToggle("operacional_diarias", true);
    expect(concedidas).not.toContain("aprovar");
    // E continua concedendo o resto: a pessoa tem que conseguir trabalhar.
    expect(concedidas).toContain("visualizar");
    expect(concedidas).toContain("incluir");
  });

  it("ligar a tela de Encarregados NÃO concede aprovar", () => {
    // Ali 'aprovar' nunca significou nada (diaria_pode() o recusa por aquele
    // menu); gravá-lo só produzia permissão morta em screen_permission_user.
    expect(acoesGravadasPeloToggle("encarregados_diarias", true)).not.toContain("aprovar");
  });

  it("DESLIGAR a tela revoga aprovar junto — a assimetria é de propósito", () => {
    // has_screen_access() responde pela ação pedida e não exige 'visualizar'
    // junto: um 'aprovar' allow=true esquecido continuaria valendo numa tela
    // que a pessoa não enxerga mais.
    const revogadas = acoesGravadasPeloToggle("operacional_diarias", false);
    expect(revogadas).toContain("aprovar");
    expect(revogadas).toContain("visualizar");
  });

  it("não revoga a mesma ação duas vezes", () => {
    const revogadas = acoesGravadasPeloToggle("operacional_diarias", false);
    expect(new Set(revogadas).size).toBe(revogadas.length);
  });
});

describe("catálogo de exceções", () => {
  it("Diárias (as duas portas) e o Parecer Jurídico são as exceções hoje", () => {
    expect(Object.keys(ACOES_FORA_DO_TOGGLE).sort()).toEqual([
      "duvidas",
      "encarregados_diarias",
      "operacional_diarias",
    ]);
  });

  it("ação fora do pacote (responder) pode estar na exceção: ligar não a concede, DESLIGAR revoga", () => {
    expect(acoesGravadasPeloToggle("duvidas", true)).not.toContain("responder");
    expect(acoesGravadasPeloToggle("duvidas", true)).toEqual([...ACOES_DO_TOGGLE_PADRAO]);
    expect(acoesGravadasPeloToggle("duvidas", false)).toContain("responder");
  });
});
