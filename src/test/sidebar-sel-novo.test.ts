import { describe, it, expect } from "vitest";
import { selNovoVigente, NOVO_DIAS } from "@/lib/selNovo";

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe("selo Novo da Sidebar", () => {
  it("sem data, nunca aparece", () => {
    expect(selNovoVigente(undefined, d("2026-10-14"))).toBe(false);
  });
  it("aparece no dia da liberação e durante a janela", () => {
    expect(selNovoVigente("2026-10-14", d("2026-10-14"))).toBe(true);
    expect(selNovoVigente("2026-10-14", d("2026-10-28"))).toBe(true);
  });
  it("expira depois de NOVO_DIAS", () => {
    expect(NOVO_DIAS).toBe(15);
    expect(selNovoVigente("2026-10-14", d("2026-10-29"))).toBe(false);
    expect(selNovoVigente("2026-10-14", d("2027-01-01"))).toBe(false);
  });
  it("data futura ou inválida não aparece", () => {
    expect(selNovoVigente("2026-12-01", d("2026-10-14"))).toBe(false);
    expect(selNovoVigente("lixo", d("2026-10-14"))).toBe(false);
  });
});
