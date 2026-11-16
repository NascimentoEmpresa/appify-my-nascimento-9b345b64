import { describe, expect, it } from "vitest";
import { prazoRetornoTexto } from "@/lib/chamados/prazoRetorno";

// Prazo do "aguardando retorno" (mig 20261114130000): o banco grava o fim do
// 3º dia útil às 23:59 de Brasília; a tela mostra o dia da semana e a data.
describe("prazo de retorno do chamado", () => {
  it("23:59 de Brasília continua no mesmo dia (já é o dia seguinte em UTC)", () => {
    // 20/11/2026 23:59:59 -03 = 21/11 02:59:59 UTC
    expect(prazoRetornoTexto("2026-11-21T02:59:59Z")).toBe("sexta, 20/11");
  });
  it("sem data (migration ainda não no banco) ou data estranha → null", () => {
    expect(prazoRetornoTexto(null)).toBeNull();
    expect(prazoRetornoTexto(undefined)).toBeNull();
    expect(prazoRetornoTexto("xx")).toBeNull();
  });
});
