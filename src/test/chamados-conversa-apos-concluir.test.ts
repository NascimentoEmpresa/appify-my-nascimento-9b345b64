import { describe, expect, it } from "vitest";
import { chamadoEncerrado, conversaChamadoFechada } from "@/pages/chamados/types";

describe("Chamados — conversa depois de encerrar", () => {
  it("concluído sai da fila mas a conversa segue aberta", () => {
    expect(chamadoEncerrado("concluido")).toBe(true);
    expect(conversaChamadoFechada("concluido")).toBe(false);
  });

  it("reprovado e cancelado fecham a conversa (mesma lista do chamado_enviar_mensagem)", () => {
    expect(conversaChamadoFechada("reprovado")).toBe(true);
    expect(conversaChamadoFechada("cancelado")).toBe(true);
  });

  it("chamado em andamento conversa normalmente", () => {
    for (const s of ["aberto", "em_andamento", "aguardando_retorno"]) expect(conversaChamadoFechada(s)).toBe(false);
  });
});
