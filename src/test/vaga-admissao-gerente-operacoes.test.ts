import { describe, expect, it } from "vitest";
import {
  MOTIVO_ADMISSAO, MOTIVO_SUBSTITUICAO, STATUS_VAGA_GERENTE_OPERACOES, STATUS_AGUARDANDO_APROVACAO,
  bloqueioSubstituicao, ehAdmissao, rotuloStatusVaga, vagaConcluiDireto,
} from "@/lib/recrutamento/vagaRegras";
import { STATUS_VAGA_PENDENTE_APROVACAO } from "@/lib/recrutamento/vagaEmAndamento";
import { STATUS_FILA_APROVACAO } from "@/lib/recrutamento/responsavelVaga";
import { PASSOS_FLUXO } from "@/lib/recrutamento/fluxoStatus";

// Chamado #0848 (Fernanda, 11/11/2026) — Admissão pelo contrato e aprovação
// obrigatória do Gerente de Operações.

describe("Admissão", () => {
  it("reconhece o motivo", () => {
    expect(ehAdmissao(MOTIVO_ADMISSAO)).toBe(true);
    expect(ehAdmissao(" Admissão ")).toBe(true);
    expect(ehAdmissao(MOTIVO_SUBSTITUICAO)).toBe(false);
  });

  it("quantitativo: sem colaborador, só o contrato decide (acima pede Sim + justificativa)", () => {
    const acima = { contrato_id: "c", ativos: 122, cotado: 120 };
    expect(bloqueioSubstituicao({ situacao: null, quantitativo: acima, decisao: "", justificativa: "" })).toMatch(/responda/);
    expect(bloqueioSubstituicao({ situacao: null, quantitativo: acima, decisao: "sim", justificativa: "Posto novo — autorizou Gustavo" })).toBeNull();
    expect(bloqueioSubstituicao({ situacao: null, quantitativo: { contrato_id: "c", ativos: 118, cotado: 120 }, decisao: "", justificativa: "" })).toBeNull();
  });
});

describe("status do Gerente de Operações", () => {
  it("aparece como 'Aguardando aprovação do Gerente de Operações'", () => {
    expect(rotuloStatusVaga(STATUS_VAGA_GERENTE_OPERACOES)).toBe("Aguardando aprovação do Gerente de Operações");
  });

  it("é fila de aprovação em todas as réguas (não conclui direto, não é 'em andamento')", () => {
    expect(STATUS_AGUARDANDO_APROVACAO).toContain(STATUS_VAGA_GERENTE_OPERACOES);
    expect(vagaConcluiDireto(STATUS_VAGA_GERENTE_OPERACOES)).toBe(false);
    expect(STATUS_VAGA_PENDENTE_APROVACAO).toContain(STATUS_VAGA_GERENTE_OPERACOES);
    expect(STATUS_FILA_APROVACAO).toContain(STATUS_VAGA_GERENTE_OPERACOES);
    expect(PASSOS_FLUXO.find(p => p.chave === "aprovacao")?.status).toContain(STATUS_VAGA_GERENTE_OPERACOES);
  });
});
