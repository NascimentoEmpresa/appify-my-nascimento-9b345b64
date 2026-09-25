import { describe, it, expect } from "vitest";
import { podeRefazerFerias, diasRestantesParaRefazer, PRAZO_REFAZER_DIAS } from "@/lib/solicitacoes/feriasRefazer";

const DIA = 86400000;
const agora = +new Date("2026-09-16T12:00:00Z");
const ha = (dias: number) => new Date(agora - dias * DIA).toISOString();

describe("refazer solicitação de férias (16/09/2026)", () => {
  it("deixa refazer dentro de uma semana, em qualquer status que não seja Cancelada", () => {
    for (const status of ["Pendente", "Aprovada", "Reprovada"]) {
      expect(podeRefazerFerias({ criado_em: ha(2), status }, agora).ok).toBe(true);
    }
    expect(podeRefazerFerias({ criado_em: ha(PRAZO_REFAZER_DIAS), status: "Pendente" }, agora).ok).toBe(true);
  });

  it("depois de uma semana não deixa mais", () => {
    const r = podeRefazerFerias({ criado_em: ha(PRAZO_REFAZER_DIAS + 0.01), status: "Pendente" }, agora);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/uma semana/);
  });

  it("cancelada não se refaz; sem data também não", () => {
    expect(podeRefazerFerias({ criado_em: ha(1), status: "Cancelada" }, agora).ok).toBe(false);
    expect(podeRefazerFerias({ criado_em: null, status: "Pendente" }, agora).ok).toBe(false);
    expect(podeRefazerFerias({ criado_em: "abc", status: "Pendente" }, agora).ok).toBe(false);
  });

  it("cancelada PELO RH se refaz, mesmo depois de uma semana", () => {
    expect(podeRefazerFerias({ criado_em: ha(40), status: "Cancelada", cancelada_pelo_rh: true }, agora).ok).toBe(true);
    expect(podeRefazerFerias({ criado_em: ha(40), status: "Cancelada", cancelada_pelo_rh: false }, agora).ok).toBe(false);
  });

  it("conta os dias que restam", () => {
    expect(diasRestantesParaRefazer(ha(0), agora)).toBe(7);
    expect(diasRestantesParaRefazer(ha(6.5), agora)).toBe(1);
    expect(diasRestantesParaRefazer(ha(9), agora)).toBe(0);
    expect(diasRestantesParaRefazer(null, agora)).toBe(0);
  });
});
