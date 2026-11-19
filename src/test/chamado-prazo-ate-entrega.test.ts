import { describe, expect, it } from "vitest";
import { entregueNoPrazo, fimDoPrazoDev, prazoVencido, situacaoPrazo } from "@/lib/chamados/prazoDesenvolvimento";

// Pablo, 19/11/2026: "o tempo da conclusão do chamado tem que ser quando o dev
// mergea a pr, não quando o gestor dá o concluido" — o prazo do dev conta até
// a entrega (desenvolvimento_entregue_em), não até o Gestor de Sistemas
// concluir. Mesma régua do gatilho da mig 20261120170000.

const previsaoDia = new Date(2026, 10, 18, 23, 59, 59); // 18/11, prazo em dias
const base = {
  id: "c1", status: "em_andamento", responsavel_id: "dev",
  desenvolvimento_iniciado_em: "2026-11-16T12:00:00Z",
  prazo_conclusao_em: previsaoDia.toISOString(),
  prazo_dias: 2, prazo_unidade: "dias",
  desenvolvimento_entregue_em: null as string | null,
};
const previsao = { data: previsaoDia, projetada: false };
const tresDiasDepois = new Date(2026, 10, 21, 10, 0, 0);

describe("prazo do dev conta até a entrega ao gestor", () => {
  it("entregue no prazo e o gestor demorando: continua no prazo", () => {
    const c = { ...base, desenvolvimento_entregue_em: new Date(2026, 10, 18, 15, 0).toISOString() };
    expect(situacaoPrazo(c, previsao, tresDiasDepois)).toBe("concluido_no_prazo");
    expect(prazoVencido(c, tresDiasDepois)).toBe(false);
  });

  it("entregue depois da previsão: com atraso", () => {
    const c = { ...base, desenvolvimento_entregue_em: new Date(2026, 10, 19, 9, 0).toISOString() };
    expect(situacaoPrazo(c, previsao, tresDiasDepois)).toBe("concluido_atraso");
    expect(prazoVencido(c, tresDiasDepois)).toBe(true);
  });

  it("ainda não entregue: usa a hora atual", () => {
    expect(situacaoPrazo(base, previsao, tresDiasDepois)).toBe("atrasado");
    expect(prazoVencido(base, tresDiasDepois)).toBe(true);
    expect(fimDoPrazoDev(base, tresDiasDepois)).toBe(tresDiasDepois);
  });

  it("concluído sem entrega marcada (antigo): cai na data de conclusão", () => {
    const c = { status: "concluido", desenvolvimento_entregue_em: null, concluido_em: "2026-11-10T12:00:00Z" };
    expect(fimDoPrazoDev(c, tresDiasDepois).toISOString()).toBe("2026-11-10T12:00:00.000Z");
  });

  it("prazo em horas compara a hora exata", () => {
    const prev = new Date(2026, 10, 18, 14, 0);
    expect(entregueNoPrazo(prev, new Date(2026, 10, 18, 13, 59), "horas")).toBe(true);
    expect(entregueNoPrazo(prev, new Date(2026, 10, 18, 14, 1), "horas")).toBe(false);
    // em dias vale o dia inteiro
    expect(entregueNoPrazo(prev, new Date(2026, 10, 18, 22, 0), "dias")).toBe(true);
  });
});
