import { describe, expect, it } from "vitest";
import { diaDaSemana, linkMapaAso, situacaoSst, textoAgendamentoAso } from "@/lib/recrutamento/agendamentoAso";

// Recrutamento › SST + COMPRAS — agendamento do ASO para passar ao candidato (16/10/2026).
describe("agendamento do ASO no Recrutamento", () => {
  const agendado = {
    nome: "CLAUDIA SOUZA", sst_data_exame: "2026-10-20", sst_hora_exame: "08:30",
    sst_local_exame: "Clínica Exemplo, Rua A, 100", sst_maps_url: "https://maps.app.goo.gl/abc",
    sst_agendado_em: "2026-10-16T15:00:00Z", sst_ok: true,
  };

  it("situação segue a régua do SST", () => {
    expect(situacaoSst({})).toBe("A receber");
    expect(situacaoSst({ sst_visto_em: "2026-10-16T10:00:00Z" })).toBe("Recebido — a agendar");
    expect(situacaoSst(agendado)).toBe("Agendado");
    expect(situacaoSst({ sst_ok: false })).toBe("Reprovado pelo SST");
  });

  it("mapa: o link colado pelo SST; sem ele, busca pelo endereço", () => {
    expect(linkMapaAso(agendado)).toBe("https://maps.app.goo.gl/abc");
    expect(linkMapaAso({ sst_local_exame: "Rua A, 100" })).toBe("https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%20100");
    expect(linkMapaAso({})).toBeNull();
  });

  it("dia da semana sem deslocar por fuso", () => {
    expect(diaDaSemana("2026-10-20")).toBe("terça-feira");
  });

  it("texto para o candidato tem tudo do agendamento", () => {
    const t = textoAgendamentoAso(agendado)!;
    expect(t).toMatch(/^Olá, Claudia!/);
    expect(t).toContain("20/10/2026 (terça-feira)");
    expect(t).toContain("08:30");
    expect(t).toContain("Clínica Exemplo, Rua A, 100");
    expect(t).toContain("https://maps.app.goo.gl/abc");
    expect(textoAgendamentoAso({ nome: "X" })).toBeNull();
  });
});
