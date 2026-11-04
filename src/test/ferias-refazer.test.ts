import { describe, it, expect } from "vitest";
import { podeRefazerFerias, podeCancelarFerias, diasRestantesParaRefazer, PRAZO_REFAZER_DIAS } from "@/lib/solicitacoes/feriasRefazer";

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
    // 04/11/2026: a mensagem diz o caminho — cancelar e fazer outra.
    expect(r.motivo).toMatch(/NÃO É MAIS POSSÍVEL REFAZER/);
    expect(r.motivo).toMatch(/CANCELE esta solicitação/);
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

describe("cancelar a própria solicitação de férias (04/11/2026)", () => {
  const hoje = "2026-11-04";
  it("pendente ou aprovada, com saída no futuro: pode", () => {
    expect(podeCancelarFerias({ status: "Pendente", data_saida: "2026-12-01" }, hoje).ok).toBe(true);
    expect(podeCancelarFerias({ status: "Aprovada", data_saida: "2026-11-05" }, hoje).ok).toBe(true);
  });
  it("férias já começadas (ou começando hoje): não pode", () => {
    expect(podeCancelarFerias({ status: "Aprovada", data_saida: "2026-11-04" }, hoje).ok).toBe(false);
    expect(podeCancelarFerias({ status: "Aprovada", data_saida: "2026-10-01T03:00:00Z" }, hoje).ok).toBe(false);
  });
  it("reprovada ou já cancelada: não pode", () => {
    expect(podeCancelarFerias({ status: "Reprovada", data_saida: "2026-12-01" }, hoje).ok).toBe(false);
    expect(podeCancelarFerias({ status: "Cancelada", data_saida: "2026-12-01" }, hoje).ok).toBe(false);
  });
  it("venda sem data: só pendente", () => {
    expect(podeCancelarFerias({ status: "Pendente", data_saida: null, tipo: "venda" }, hoje).ok).toBe(true);
    expect(podeCancelarFerias({ status: "Aprovada", data_saida: null, tipo: "venda" }, hoje).ok).toBe(false);
  });
});
