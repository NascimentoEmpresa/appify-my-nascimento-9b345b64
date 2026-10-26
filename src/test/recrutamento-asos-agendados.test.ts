import { describe, expect, it } from "vitest";
import {
  agruparAsosPorSolicitacao, asoCasaBusca, asoEstaAgendado, textoTodosAsos, type AsoAgendadoLinha,
} from "@/lib/recrutamento/agendamentoAso";

// Gestão Recrutamento › card "ASOs Agendados" (19/10/2026).
describe("card ASOs Agendados", () => {
  const hoje = "2026-10-19";
  const base = (o: Partial<AsoAgendadoLinha>): AsoAgendadoLinha => ({
    candidato_id: 1, vaga_id: 10, nome: "ANA LIMA", telefone: "51999990000", cpf: "123.456.789-00",
    cargo: "JARDINEIRO", contrato: "1040 - UFRGS", cidade: "Porto Alegre", etapa_processo: "SST + COMPRAS",
    sst_data_exame: "2026-10-20", sst_hora_exame: "08:30", sst_local_exame: "Clínica X, Rua A, 100", sst_ok: true,
    ...o,
  });

  it("entra só quem tem exame marcado e ainda vai fazer", () => {
    expect(asoEstaAgendado(base({}), hoje)).toBe(true);
    expect(asoEstaAgendado(base({ sst_data_exame: hoje }), hoje)).toBe(true);
    expect(asoEstaAgendado(base({ sst_data_exame: null }), hoje)).toBe(false);
    expect(asoEstaAgendado(base({ desistiu: true }), hoje)).toBe(false);
    expect(asoEstaAgendado(base({ sst_ok: false }), hoje)).toBe(false);
    expect(asoEstaAgendado(base({ admitido_em: "2026-10-18T10:00:00Z" }), hoje)).toBe(false);
    expect(asoEstaAgendado(base({ etapa_processo: "Reprovado" }), hoje)).toBe(false);
  });

  it("exame que já passou só entra fora de 'próximos'", () => {
    const passado = base({ sst_data_exame: "2026-10-15" });
    expect(asoEstaAgendado(passado, hoje)).toBe(false);
    expect(asoEstaAgendado(passado, hoje, false)).toBe(true);
  });

  it("agrupa por solicitação na ordem do exame mais próximo", () => {
    const g = agruparAsosPorSolicitacao([
      base({ candidato_id: 1, vaga_id: 10, sst_data_exame: "2026-10-22", sst_hora_exame: "09:00" }),
      base({ candidato_id: 2, vaga_id: 20, sst_data_exame: "2026-10-21", sst_hora_exame: null }),
      base({ candidato_id: 3, vaga_id: 10, sst_data_exame: "2026-10-22", sst_hora_exame: "07:30" }),
      base({ candidato_id: 4, vaga_id: 20, sst_data_exame: "2026-10-21", sst_hora_exame: "14:00" }),
    ]);
    expect(g.map((x) => x.vaga_id)).toEqual([20, 10]);
    expect(g[0].asos.map((c) => c.candidato_id)).toEqual([4, 2]); // sem hora vai para o fim do dia
    expect(g[1].asos.map((c) => c.candidato_id)).toEqual([3, 1]);
  });

  it("busca por nome, contrato, nº da vaga, CPF ou telefone", () => {
    const c = base({});
    expect(asoCasaBusca(c, "")).toBe(true);
    expect(asoCasaBusca(c, "ana")).toBe(true);
    expect(asoCasaBusca(c, "ufrgs")).toBe(true);
    expect(asoCasaBusca(c, "10")).toBe(true);
    expect(asoCasaBusca(c, "123456")).toBe(true);
    expect(asoCasaBusca(c, "99999")).toBe(true);
    expect(asoCasaBusca(c, "pedreiro")).toBe(false);
  });

  it("copiar todos: um bloco por solicitação, com nome, telefone e o texto de cada um", () => {
    const t = textoTodosAsos(agruparAsosPorSolicitacao([
      base({ candidato_id: 1, vaga_id: 10 }),
      base({ candidato_id: 2, vaga_id: 20, nome: "BRUNO DIAS", telefone: null, cargo: "PORTEIRO" }),
    ]));
    expect(t).toContain("*#10 · JARDINEIRO · 1040 - UFRGS · Porto Alegre*");
    expect(t).toContain("👤 ANA LIMA · 51999990000");
    expect(t).toContain("Olá, Ana! Seu exame admissional (ASO) está agendado:");
    expect(t).toContain("👤 BRUNO DIAS\n");
    expect(t).toContain("20/10/2026 (terça-feira)");
    expect(t.split("──────────")).toHaveLength(2);
    expect(textoTodosAsos([])).toBe("");
  });
});

// 20/10/2026 — "Marcar como visto": a chave do agendamento decide quando o
// ASO volta a ser novo (o SST reagendou).
import { chaveAgendamentoAso } from "@/lib/recrutamento/agendamentoAso";

describe("chaveAgendamentoAso", () => {
  const ag = { sst_data_exame: "2026-10-20T00:00:00", sst_hora_exame: "08:30", sst_local_exame: "Clínica X, Rua A, 100" };

  it("mesmo agendamento = mesma chave, mesmo com espaço/maiúscula redigitados", () => {
    expect(chaveAgendamentoAso(ag)).toBe(chaveAgendamentoAso({ ...ag, sst_local_exame: "  CLÍNICA X,  Rua A, 100 " }));
    expect(chaveAgendamentoAso(ag)).toBe("2026-10-20|08:30|clínica x, rua a, 100");
  });

  it("reagendou (data, hora ou local) = chave nova → volta a ser novo", () => {
    expect(chaveAgendamentoAso({ ...ag, sst_data_exame: "2026-10-21" })).not.toBe(chaveAgendamentoAso(ag));
    expect(chaveAgendamentoAso({ ...ag, sst_hora_exame: "09:00" })).not.toBe(chaveAgendamentoAso(ag));
    expect(chaveAgendamentoAso({ ...ag, sst_local_exame: "Clínica Y" })).not.toBe(chaveAgendamentoAso(ag));
  });
});
