import { describe, expect, it } from "vitest";
import { precisaRecarregar } from "@/lib/recargaGeral";

// Recarga geral (12/11/2026, incidente do Mural do Início): a aba recarrega
// quando o último pedido é MAIS NOVO que ela — compara "há quantos segundos
// foi o pedido" (banco) com "há quanto tempo a aba está aberta" (navegador).
describe("recarga geral", () => {
  it("pedido depois que a aba abriu → recarrega", () => {
    // aba aberta há 10 min, pedido há 2 min
    expect(precisaRecarregar(120, 10 * 60_000)).toBe(true);
  });
  it("pedido antes de a aba abrir → não recarrega (é a aba que acabou de recarregar)", () => {
    // aba aberta há 1 min, pedido há 5 min
    expect(precisaRecarregar(300, 60_000)).toBe(false);
  });
  it("na fronteira, a folga de 5 s evita recarregar em loop", () => {
    expect(precisaRecarregar(58, 60_000)).toBe(false);
  });
  it("nunca pediram, ou resposta estranha → não faz nada", () => {
    expect(precisaRecarregar(null, 10 * 60_000)).toBe(false);
    expect(precisaRecarregar(Number.NaN, 10 * 60_000)).toBe(false);
    expect(precisaRecarregar(-3, 10 * 60_000)).toBe(false);
  });
});
