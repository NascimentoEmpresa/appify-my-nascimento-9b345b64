import { describe, expect, it } from "vitest";
import {
  atrasada, caminhoDocumento, diasParaPrazo, errosSolicitacao, nomeLegivel, ordenarSolicitacoes, partirContrato,
  pendenciasEnvio, rotuloSituacao, textoPrazo,
} from "@/lib/rh/documentosSolicitados";

const HOJE = "2026-10-19";

describe("rotuloSituacao", () => {
  it("pendente mostra quem e qual contrato", () => {
    expect(rotuloSituacao({ status: "pendente", destinatario_nome: "IDALECIO CARDOSO COSTA", contrato_nome: "UFFS CHAPECÓ" }))
      .toBe("Pendente (Idalecio Cardoso Costa — UFFS CHAPECÓ)");
  });
  it("pendente sem contrato (usuário do sistema)", () => {
    expect(rotuloSituacao({ status: "pendente", destinatario_nome: "Maria Souza", contrato_nome: null })).toBe("Pendente (Maria Souza)");
  });
  it("concluída e cancelada não repetem o destinatário", () => {
    expect(rotuloSituacao({ status: "concluida", destinatario_nome: "X", contrato_nome: "Y" })).toBe("Concluída");
    expect(rotuloSituacao({ status: "cancelada", destinatario_nome: "X", contrato_nome: "Y" })).toBe("Cancelada");
  });
});

describe("nomeLegivel", () => {
  it("só mexe em nome todo em maiúsculas", () => {
    expect(nomeLegivel("JOÃO DA SILVA")).toBe("João da Silva");
    expect(nomeLegivel("Ana McDonald")).toBe("Ana McDonald");
    expect(nomeLegivel(null)).toBe("");
  });
});

describe("prazo", () => {
  it("conta dias até o prazo", () => {
    expect(diasParaPrazo("2026-10-22", HOJE)).toBe(3);
    expect(diasParaPrazo("2026-10-17", HOJE)).toBe(-2);
    expect(diasParaPrazo(null, HOJE)).toBeNull();
  });
  it("atrasada só quando pendente", () => {
    expect(atrasada({ status: "pendente", prazo: "2026-10-18" }, HOJE)).toBe(true);
    expect(atrasada({ status: "concluida", prazo: "2026-10-18" }, HOJE)).toBe(false);
    expect(atrasada({ status: "pendente", prazo: null }, HOJE)).toBe(false);
  });
  it("texto do prazo", () => {
    expect(textoPrazo({ status: "pendente", prazo: "2026-10-18" }, HOJE)).toBe("atrasada 1 dia");
    expect(textoPrazo({ status: "pendente", prazo: HOJE }, HOJE)).toBe("vence hoje");
    expect(textoPrazo({ status: "pendente", prazo: "2026-10-21" }, HOJE)).toBe("vence em 2 dias");
    expect(textoPrazo({ status: "concluida", prazo: "2026-10-21" }, HOJE)).toBeNull();
  });
});

describe("ordenarSolicitacoes", () => {
  it("pendentes primeiro, atrasadas na frente; depois as mais recentes", () => {
    const l = [
      { id: 1, status: "concluida" as const, prazo: null, created_at: "2026-10-18T10:00:00Z" },
      { id: 2, status: "pendente" as const, prazo: null, created_at: "2026-10-19T10:00:00Z" },
      { id: 3, status: "pendente" as const, prazo: "2026-10-15", created_at: "2026-10-10T10:00:00Z" },
      { id: 4, status: "cancelada" as const, prazo: null, created_at: "2026-10-19T11:00:00Z" },
      { id: 5, status: "pendente" as const, prazo: "2026-10-25", created_at: "2026-10-11T10:00:00Z" },
    ];
    expect(ordenarSolicitacoes(l, HOJE).map((s) => s.id)).toEqual([3, 5, 2, 1, 4]);
  });
});

describe("pendenciasEnvio", () => {
  it("exige anexo do destinatário — o original do RH não conta", () => {
    expect(pendenciasEnvio({ status: "pendente" }, [{ origem: "rh" }])).toEqual(["Anexe o documento assinado."]);
    expect(pendenciasEnvio({ status: "pendente" }, [{ origem: "rh" }, { origem: "destinatario" }])).toEqual([]);
    expect(pendenciasEnvio({ status: "concluida" }, [{ origem: "destinatario" }])).toEqual(["A solicitação não está pendente."]);
  });
});

describe("errosSolicitacao", () => {
  const base = { tipo: "assinatura" as const, titulo: "Termo de EPI", descricao: "Assinar e devolver", modo: "contrato" as const, contrato: "1__2", destinatario_id: "u1", prazo: "" };
  it("formulário completo passa", () => expect(errosSolicitacao(base)).toEqual([]));
  it("contrato exige contrato e responsável", () => {
    expect(errosSolicitacao({ ...base, contrato: "", destinatario_id: "" }))
      .toEqual(["Escolha o contrato.", "Escolha o responsável pelo contrato."]);
  });
  it("usuário não exige contrato", () => {
    expect(errosSolicitacao({ ...base, modo: "usuario", contrato: "", destinatario_id: "" })).toEqual(["Escolha o usuário."]);
  });
  it("título e descrição obrigatórios", () => {
    expect(errosSolicitacao({ ...base, titulo: " ", descricao: "" })).toEqual(["Informe o título.", "Descreva o que está sendo solicitado."]);
  });
});

describe("utilitários", () => {
  it("partirContrato", () => {
    expect(partirContrato("12__3")).toEqual({ empresa: 12, filial: 3 });
    expect(partirContrato("")).toBeNull();
  });
  it("caminhoDocumento começa pelo id e limpa o nome", () => {
    expect(caminhoDocumento(42, "Termo de Ciência – João.pdf", 1)).toBe("42/1-Termo_de_Ciencia_Joao.pdf");
  });
});
