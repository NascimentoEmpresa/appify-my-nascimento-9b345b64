import { describe, expect, it } from "vitest";
import { abreNaExecucao, pendenteDoGestorSistemas, podeConcluirTarefa, podeDevolverAoDev } from "@/pages/chamados/validacaoPresidencia";

// Aba "Pendente de conclusão" do Painel de Distribuição (18/11/2026, Pablo:
// "todos que estiverem como pendente do gestor devem aparecer aqui, se não,
// onde o gestor vai concluir?"). Entra tudo que espera o Gestor de Sistemas.

const base = {
  status: "em_andamento",
  desenvolvimento_entregue_em: null as string | null,
  conclusao_confirmada_em: null as string | null,
  gestao_finalizada_em: null as string | null,
};

describe("fila do Gestor de Sistemas", () => {
  it("entregue pelo merge da PR ou pelo dev (falta concluir) entra", () => {
    expect(pendenteDoGestorSistemas({ ...base, desenvolvimento_entregue_em: "2026-11-17T18:00:00Z" })).toBe(true);
  });
  it("concluído e confirmado pelo solicitante (falta finalizar) entra", () => {
    expect(pendenteDoGestorSistemas({ ...base, status: "concluido", conclusao_confirmada_em: "2026-11-18T09:00:00Z" })).toBe(true);
  });
  it("concluído esperando o solicitante confirmar não entra", () => {
    expect(pendenteDoGestorSistemas({ ...base, status: "concluido" })).toBe(false);
  });
  it("em desenvolvimento, sem entrega, não entra", () => {
    expect(pendenteDoGestorSistemas(base)).toBe(false);
  });
  it("finalizado ou cancelado sai da fila", () => {
    expect(pendenteDoGestorSistemas({ ...base, status: "concluido", conclusao_confirmada_em: "2026-11-18T09:00:00Z", gestao_finalizada_em: "2026-11-18T10:00:00Z" })).toBe(false);
    expect(pendenteDoGestorSistemas({ ...base, status: "cancelado", desenvolvimento_entregue_em: "2026-11-17T18:00:00Z" })).toBe(false);
  });
});

describe("aba Pendente de conclusão abre a execução e o gestor decide (18/11/2026)", () => {
  const entregue = { ...base, desenvolvimento_entregue_em: "2026-11-17T18:00:00Z" };
  it("pendente do gestor abre a tela do chamado, não a distribuição", () => {
    expect(abreNaExecucao(entregue)).toBe(true);
    expect(abreNaExecucao({ ...base, status: "concluido" })).toBe(true);
    expect(abreNaExecucao(base)).toBe(false);
  });
  it("Concluir tarefa: só Gerente/Gestor de Sistemas e só depois da entrega", () => {
    expect(podeConcluirTarefa(entregue, true)).toBe(true);
    expect(podeConcluirTarefa(entregue, false)).toBe(false);
    expect(podeConcluirTarefa(base, true)).toBe(false);
    expect(podeConcluirTarefa({ ...entregue, status: "concluido" }, true)).toBe(false);
  });
  it("só o Gestor de Sistemas devolve, e só o que foi entregue", () => {
    expect(podeDevolverAoDev(entregue, true)).toBe(true);
    expect(podeDevolverAoDev(entregue, false)).toBe(false);
    expect(podeDevolverAoDev(base, true)).toBe(false);
    expect(podeDevolverAoDev({ ...entregue, status: "concluido" }, true)).toBe(false);
  });
});
