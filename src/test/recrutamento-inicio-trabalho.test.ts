import { describe, expect, it } from "vitest";
import { erroDataInicio, inicioTrabalho, linhaInicioPedido, sugestaoDataInicio } from "@/lib/recrutamento/inicioTrabalho";

// Envio para SST + Compras com a data em que o colaborador começa a trabalhar
// (mig 20261028002050). "Hoje" fixo: quarta, 28/10/2026.
const HOJE = new Date(2026, 9, 28, 9, 30);

describe("data de início no envio para SST + Compras", () => {
  it("é obrigatória e não pode estar no passado", () => {
    expect(erroDataInicio("", HOJE)).toContain("Informe");
    expect(erroDataInicio(null, HOJE)).toContain("Informe");
    expect(erroDataInicio("2026-10-27", HOJE)).toContain("passado");
    expect(erroDataInicio("2026-10-28", HOJE)).toBeNull();
    expect(erroDataInicio("2026-11-03", HOJE)).toBeNull();
  });

  it("sugere a prevista da vaga só se ainda não passou", () => {
    expect(sugestaoDataInicio("2026-11-03", HOJE)).toBe("2026-11-03");
    expect(sugestaoDataInicio("2026-10-01", HOJE)).toBe("");
    expect(sugestaoDataInicio(null, HOJE)).toBe("");
  });
});

describe("como aparece para o Compras e o SST", () => {
  it("data, dia da semana e quanto falta", () => {
    expect(inicioTrabalho("2026-11-03", HOJE)).toMatchObject({ data: "03/11/2026 (ter)", curta: "03/11 (ter)", prazo: "faltam 6 dias", tom: "normal" });
  });
  it("hoje, amanhã e até 3 dias ficam em destaque", () => {
    expect(inicioTrabalho("2026-10-28", HOJE)).toMatchObject({ prazo: "hoje", tom: "proximo" });
    expect(inicioTrabalho("2026-10-29", HOJE)).toMatchObject({ prazo: "amanhã", tom: "proximo" });
    expect(inicioTrabalho("2026-10-31", HOJE)?.tom).toBe("proximo");
  });
  it("data que já passou fica vermelha", () => {
    expect(inicioTrabalho("2026-10-27", HOJE)).toMatchObject({ prazo: "começou ontem", tom: "passou" });
    expect(inicioTrabalho("2026-10-25", HOJE)?.prazo).toBe("começou há 3 dias");
  });
  it("sem data → nada", () => {
    expect(inicioTrabalho(null, HOJE)).toBeNull();
    expect(inicioTrabalho("", HOJE)).toBeNull();
  });
  it("vai na observação do pedido de materiais", () => {
    expect(linhaInicioPedido("2026-11-03")).toBe("Início no posto: 03/11/2026 (ter)");
  });
});
