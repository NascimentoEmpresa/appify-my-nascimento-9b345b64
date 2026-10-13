import { describe, expect, it } from "vitest";
import { STATUS_COM_RESPONSAVEL, alvoDoFiltro, devePerguntarAssumir, passaNoFiltro, textoConfirmarAssumir, vagaTemResponsavel } from "@/lib/recrutamento/responsavelVaga";

// Gestão Recrutamento — filtro "Responsável da vaga" e "Tornar-me responsável" (mig 20261014000003).

describe("só vagas no Recrutamento ou na Seleção têm responsável", () => {
  it("Pendente Recrutamento e as etapas do candidato, sim; Operacional e encerradas, não", () => {
    expect(vagaTemResponsavel("Pendente Recrutamento")).toBe(true);
    expect(vagaTemResponsavel("Vaga aberta - Seleção de Currículos")).toBe(true);
    expect(vagaTemResponsavel("Aguardando SST e Compras")).toBe(true);
    for (const s of ["Pendente Analista", "Pendente Operacional", "Pendente Diretoria", "Concluído", "Contratado", "Reprovada", null, ""]) {
      expect(vagaTemResponsavel(s)).toBe(false);
    }
    expect(STATUS_COM_RESPONSAVEL).toHaveLength(11);
  });
});

describe("filtro", () => {
  const eu = "u-eu";
  it("vazio = todos; 'eu' vira o meu id; 'sem'; uma pessoa", () => {
    expect(alvoDoFiltro("", eu)).toEqual({ tipo: "todos" });
    expect(alvoDoFiltro("eu", eu)).toEqual({ tipo: "pessoa", id: eu });
    expect(alvoDoFiltro("eu", null)).toEqual({ tipo: "todos" });
    expect(alvoDoFiltro("sem", eu)).toEqual({ tipo: "sem" });
    expect(alvoDoFiltro("u-ana", eu)).toEqual({ tipo: "pessoa", id: "u-ana" });
  });
  it("com filtro, vaga do Operacional não aparece", () => {
    const op = { status: "Pendente Analista" };
    const rec = { status: "Entrevista e Avaliação" };
    expect(passaNoFiltro(op, null, "", eu)).toBe(true);
    expect(passaNoFiltro(op, null, "sem", eu)).toBe(false);
    expect(passaNoFiltro(rec, null, "sem", eu)).toBe(true);
    expect(passaNoFiltro(rec, eu, "eu", eu)).toBe(true);
    expect(passaNoFiltro(rec, "u-ana", "eu", eu)).toBe(false);
    expect(passaNoFiltro(rec, "u-ana", "u-ana", eu)).toBe(true);
  });
});

describe("ao passar uma etapa", () => {
  const vaga = { status: "Vaga aberta - Seleção de Currículos" };
  it("pergunta só quando já tem OUTRA pessoa responsável", () => {
    expect(devePerguntarAssumir(vaga, { responsavel_id: "u-ana" }, "u-eu")).toBe(true);
    expect(devePerguntarAssumir(vaga, { responsavel_id: "u-eu" }, "u-eu")).toBe(false);
    expect(devePerguntarAssumir(vaga, null, "u-eu")).toBe(false);              // sem ninguém: o banco marca sozinho
    expect(devePerguntarAssumir(vaga, { responsavel_id: null }, "u-eu")).toBe(false);
    expect(devePerguntarAssumir({ status: "Pendente Analista" }, { responsavel_id: "u-ana" }, "u-eu")).toBe(false);
  });
  it("o texto da pergunta", () => {
    expect(textoConfirmarAssumir(1339, "THAIMIANI")).toMatch(/THAIMIANI já é o responsável pela vaga #1339[\s\S]*Tem certeza que deseja assumir a vaga\?/);
  });
});
