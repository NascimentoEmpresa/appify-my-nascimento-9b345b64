import { describe, it, expect } from "vitest";
import { novaDemanda, type ResponsavelVaga } from "@/hooks/useResponsaveisDasVagas";

const r = (p: Partial<ResponsavelVaga>): ResponsavelVaga => ({
  vaga_id: 1, responsavel_id: "giovana", responsavel_nome: "GIOVANA", origem: "manual", atualizado_em: "2026-10-14T10:00:00Z", ...p,
});

describe("novaDemanda (vaga transferida, mig 20261014000047)", () => {
  it("transferida e sem ciente: é nova (a linha vermelha)", () => {
    expect(novaDemanda(r({ transferida_em: "2026-10-14T10:00:00Z", transferida_por_nome: "PAMELA" }))).toBe(true);
  });
  it("depois do ciente deixa de ser nova", () => {
    expect(novaDemanda(r({ transferida_em: "2026-10-14T10:00:00Z", ciente_em: "2026-10-14T11:00:00Z" }))).toBe(false);
  });
  it("transferida de novo depois do ciente volta a ser nova", () => {
    expect(novaDemanda(r({ transferida_em: "2026-10-15T09:00:00Z", ciente_em: "2026-10-14T11:00:00Z" }))).toBe(true);
  });
  it("assumida pela própria pessoa (sem transferência) ou sem responsável não é nova", () => {
    expect(novaDemanda(r({ transferida_em: null }))).toBe(false);
    expect(novaDemanda(undefined)).toBe(false);
  });
});
