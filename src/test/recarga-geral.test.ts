import { describe, expect, it } from "vitest";
import { decidirRecarga } from "@/lib/recargaGeral";

// Recarga geral (12/11/2026, incidente do Mural do Início): a aba guarda a
// versão que viu ao abrir e recarrega quando o servidor mostra uma maior.
describe("recarga geral", () => {
  it("primeira leitura só guarda — abrir a página não recarrega", () => {
    expect(decidirRecarga(null, 3)).toBe("guardar");
  });
  it("número maior que o visto recarrega", () => {
    expect(decidirRecarga(3, 4)).toBe("recarregar");
  });
  it("mesmo número (ou menor) não faz nada", () => {
    expect(decidirRecarga(4, 4)).toBe("nada");
    expect(decidirRecarga(4, 2)).toBe("nada");
  });
  it("sem resposta do servidor não decide nada", () => {
    expect(decidirRecarga(null, null)).toBe("nada");
    expect(decidirRecarga(3, Number.NaN)).toBe("nada");
  });
});
