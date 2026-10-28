import { describe, expect, it } from "vitest";
import {
  prazoSolicitanteValido, statusPainel, sugestaoPrazoSolicitante, variacaoPercentual,
} from "@/lib/chamados/prazoDesenvolvimento";

// =====================================================================
// Painel do Desenvolvedor no layout do mockup + prazo do solicitante
// (SIS-2026-0763, mig 20261028001420). "o solicitante manda já com o prazo
// esperado, e o desenvolvedor manda com o prazo real de desenvolvimento ao
// iniciar o chamado." — Pablo.
// =====================================================================

// Quarta-feira, 28/10/2026 (hora local).
const QUARTA = new Date(2026, 9, 28, 10, 0);

describe("prazo esperado do solicitante", () => {
  it("a urgência sugere a data em dias úteis (02/11 é Finados)", () => {
    expect(sugestaoPrazoSolicitante("ate_1h", QUARTA)).toBe("2026-10-28");
    expect(sugestaoPrazoSolicitante("ate_1d", QUARTA)).toBe("2026-10-29");
    expect(sugestaoPrazoSolicitante("ate_3d", QUARTA)).toBe("2026-11-03");
    expect(sugestaoPrazoSolicitante("mais_5d", QUARTA)).toBe("2026-11-12");
    expect(sugestaoPrazoSolicitante("", QUARTA)).toBeNull();
  });

  it("é obrigatório e não aceita data no passado (o gatilho do banco também barra)", () => {
    expect(prazoSolicitanteValido("", QUARTA)).toBe(false);
    expect(prazoSolicitanteValido("2026-10-27", QUARTA)).toBe(false);
    expect(prazoSolicitanteValido("2026-10-28", QUARTA)).toBe(true);
    expect(prazoSolicitanteValido("2026-12-01", QUARTA)).toBe(true);
  });
});

describe("status como o Painel do Desenvolvedor mostra", () => {
  it("em andamento com início = Em desenvolvimento; aberto ou na fila sem início = Em análise", () => {
    expect(statusPainel({ status: "em_andamento", desenvolvimento_iniciado_em: "2026-10-28T13:00:00Z" })).toBe("em_desenvolvimento");
    expect(statusPainel({ status: "em_andamento" })).toBe("em_analise");
    expect(statusPainel({ status: "aberto" })).toBe("em_analise");
    expect(statusPainel({ status: "aguardando_retorno" })).toBe("aguardando_retorno");
    expect(statusPainel({ status: "concluido" })).toBe("concluido");
  });
});

describe("variação do prazo médio de entrega", () => {
  it("de 4,9 para 3,5 dias = -29%; sem base não mostra", () => {
    expect(variacaoPercentual(3.5, 4.9)).toBe(-29);
    expect(variacaoPercentual(5, 4)).toBe(25);
    expect(variacaoPercentual(3, null)).toBeNull();
    expect(variacaoPercentual(null, 3)).toBeNull();
    expect(variacaoPercentual(3, 0)).toBeNull();
  });
});

describe("definição da prioridade (Reunião / Extra)", () => {
  it("as opções da tela são exatamente as do CHECK do banco (mig 20261028001700)", async () => {
    const { DEFINICOES } = await import("@/pages/chamados/types");
    expect(Object.keys(DEFINICOES).sort()).toEqual(["extra", "reuniao"]);
    expect(DEFINICOES.reuniao.label).toBe("Reunião");
    expect(DEFINICOES.extra.label).toBe("Extra");
  });
});
