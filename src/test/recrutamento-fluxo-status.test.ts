import { describe, it, expect } from "vitest";
import { PASSOS_FLUXO, desfechoDoStatus, diasEntre, estadosDosPassos, passoDoStatus, progressoDoStatus, resumoHistorico, statusAntesDoFim, type EventoHistorico } from "@/lib/recrutamento/fluxoStatus";

// O botão "Status" de cada solicitação (18/09/2026) desenha a régua do fluxo:
// todo status do banco tem que cair em algum passo, e o fim (reprovada /
// cancelada) mostra onde o pedido parou.
const ev = (x: Partial<EventoHistorico>): EventoHistorico => ({ id: 1, created_at: "2026-09-10T10:00:00Z", evento: "x", de_status: null, para_status: null, papel: null, usuario_nome: null, usuario_email: null, detalhe: null, candidato_nome: null, ...x });

describe("fluxo de status da vaga", () => {
  it("todo status conhecido cai num passo, na ordem do fluxo", () => {
    expect(passoDoStatus("Pendente Analista")).toBe(0);
    expect(passoDoStatus("Pendente Recrutamento")).toBe(1);
    expect(passoDoStatus("Vaga aberta - Seleção de Currículos")).toBe(2);
    expect(passoDoStatus("Em análise jurídica")).toBe(3);
    expect(passoDoStatus("Entrevista com Gestor")).toBe(4);
    expect(passoDoStatus("Compras Confirmou - Aguardando Documentação")).toBe(5);
    expect(passoDoStatus("Aguardando SST e Compras")).toBe(6);
    expect(passoDoStatus("Encaminhado para SST (ASO)")).toBe(6);   // legado
    expect(passoDoStatus("Contratado")).toBe(7);
    expect(passoDoStatus("Concluído - Admissão")).toBe(7);
    expect(passoDoStatus("status inventado")).toBe(0);
    expect(PASSOS_FLUXO).toHaveLength(8);
  });
  it("desfecho", () => {
    expect(desfechoDoStatus("Contratado")).toBe("contratada");
    expect(desfechoDoStatus("Reprovada")).toBe("reprovada");
    expect(desfechoDoStatus("Cancelada")).toBe("cancelada");
    expect(desfechoDoStatus("Em análise jurídica")).toBe("andamento");
  });
  it("régua em andamento: feitos, atual e futuros", () => {
    expect(estadosDosPassos("Em análise jurídica")).toEqual(["feito", "feito", "feito", "atual", "futuro", "futuro", "futuro", "futuro"]);
    expect(estadosDosPassos("Contratado").every(e => e === "feito")).toBe(true);
  });
  it("reprovada: mostra onde parou, pelo status anterior do histórico", () => {
    const evs = [ev({ de_status: "Entrevista com Gestor", para_status: "Reprovada", created_at: "2026-09-12T10:00:00Z" }), ev({ id: 2, de_status: "Pendente Analista", para_status: "Vaga aberta - Seleção de Currículos" })];
    expect(statusAntesDoFim(evs)).toBe("Entrevista com Gestor");
    expect(estadosDosPassos("Reprovada", "Entrevista com Gestor")).toEqual(["feito", "feito", "feito", "feito", "parado", "futuro", "futuro", "futuro"]);
  });
  it("progresso: 0% na aprovação, 100% contratada", () => {
    expect(progressoDoStatus("Pendente Analista")).toBe(0);
    expect(progressoDoStatus("Contratado")).toBe(100);
    expect(progressoDoStatus("Em análise jurídica")).toBe(43);
  });
  it("resumo: só mudanças da vaga contam (não de candidato) e dias no status vêm da última", () => {
    const hoje = new Date();
    const d3 = new Date(hoje.getTime() - 3 * 86_400_000).toISOString();
    const d10 = new Date(hoje.getTime() - 10 * 86_400_000).toISOString();
    const evs = [
      ev({ id: 1, created_at: d3, de_status: "Pendente Recrutamento", para_status: "Vaga aberta - Seleção de Currículos" }),
      ev({ id: 2, created_at: d10, de_status: "Pendente Analista", para_status: "Pendente Recrutamento" }),
      ev({ id: 3, created_at: d3, de_status: "ENTRADA", para_status: "TRIAGEM", candidato_nome: "Fulano" }),
    ];
    const r = resumoHistorico(evs, d10, "Vaga aberta - Seleção de Currículos");
    expect(r).toMatchObject({ eventos: 3, mudancas: 2, diasAberta: 10, diasNoStatus: 3, desfecho: "andamento" });
    expect(diasEntre(null)).toBe(0);
  });
});
