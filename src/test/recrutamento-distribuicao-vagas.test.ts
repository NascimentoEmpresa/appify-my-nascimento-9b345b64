import { describe, expect, it } from "vitest";
import {
  PAPEL_NENHUM, bloqueioDaVaga, motivoDesistencia, primeiroNome, responsavelAtual, resumirAdmissao,
} from "@/lib/recrutamento/distribuicaoVagas";

const THAI = { responsavel_id: "thai", responsavel_nome: "Thaimiani", origem: "distribuida" };
const RECRUTADORA = { ...PAPEL_NENHUM, recrutadora: true };

describe("bloqueioDaVaga (espelho de rec_vaga_bloqueio)", () => {
  it("recrutadora não mexe na vaga distribuída para a colega", () => {
    expect(bloqueioDaVaga(THAI, RECRUTADORA, "pamela", null)).toBe("Thaimiani");
  });
  it("a dona mexe", () => expect(bloqueioDaVaga(THAI, RECRUTADORA, "thai", null)).toBeNull());
  it("gestão mexe em todas", () => expect(bloqueioDaVaga(THAI, { ...RECRUTADORA, gestor: true }, "ale", null)).toBeNull());
  it("quem não é recrutadora (SST, Jurídico…) não é travado", () => expect(bloqueioDaVaga(THAI, PAPEL_NENHUM, "sst", null)).toBeNull());
  it("vaga não distribuída segue livre", () => {
    expect(bloqueioDaVaga({ ...THAI, origem: "automatico" }, RECRUTADORA, "pamela", null)).toBeNull();
    expect(bloqueioDaVaga(null, RECRUTADORA, "pamela", null)).toBeNull();
  });
  it("Admissão mexe quando há candidato encaminhado a ela", () => {
    const giovana = { ...RECRUTADORA, admissao: true };
    expect(bloqueioDaVaga(THAI, giovana, "gio", { encaminhados: 0 })).toBe("Thaimiani");
    expect(bloqueioDaVaga(THAI, giovana, "gio", { encaminhados: 1 })).toBeNull();
  });
});

describe("responsavelAtual", () => {
  it("durante o recrutamento é a recrutadora", () => {
    expect(responsavelAtual(THAI, null)).toEqual({ nome: "Thaimiani", etapa: "recrutamento", recrutadora: "Thaimiani" });
  });
  it("com candidato aguardando admissão passa à Admissão, mantendo quem recrutou", () => {
    const adm = { aguardando: 1, encaminhados: 1, responsavel: "Giovana", recrutadora: "Thaimiani", enviado_em: "2026-10-19" };
    expect(responsavelAtual(THAI, adm)).toEqual({ nome: "Giovana", etapa: "admissao", recrutadora: "Thaimiani" });
  });
  it("todos admitidos: volta a mostrar a recrutadora", () => {
    const adm = { aguardando: 0, encaminhados: 1, responsavel: "Giovana", recrutadora: "Thaimiani", enviado_em: "2026-10-19" };
    expect(responsavelAtual(THAI, adm).etapa).toBe("recrutamento");
  });
  it("sem ninguém", () => expect(responsavelAtual(null, null)).toEqual({ nome: null, etapa: null, recrutadora: null }));
});

describe("resumirAdmissao", () => {
  it("conta encaminhados e aguardando por vaga, sem desistentes", () => {
    const r = resumirAdmissao([
      { vaga_id: 1, enviado_admissao_em: "2026-10-18T10:00:00Z", admitido_em: null, admissao_responsavel_nome: "Giovana", recrutadora_nome: "Pamela" },
      { vaga_id: 1, enviado_admissao_em: "2026-10-17T10:00:00Z", admitido_em: "2026-10-19T10:00:00Z" },
      { vaga_id: 1, enviado_admissao_em: "2026-10-16T10:00:00Z", admitido_em: null, desistiu: true },
      { vaga_id: 2, enviado_admissao_em: null, admitido_em: null },
    ]);
    expect(r[1]).toEqual({ aguardando: 1, encaminhados: 2, responsavel: "Giovana", recrutadora: "Pamela", enviado_em: "2026-10-17T10:00:00Z" });
    expect(r[2]).toBeUndefined();
  });
});

describe("textos", () => {
  it("motivo vazio vira Não informado", () => {
    expect(motivoDesistencia("  ")).toBe("Não informado");
    expect(motivoDesistencia(null)).toBe("Não informado");
    expect(motivoDesistencia("Outra proposta")).toBe("Outra proposta");
  });
  it("primeiroNome", () => {
    expect(primeiroNome("THAIMIANI SILVA")).toBe("Thaimiani");
    expect(primeiroNome("giovana@empresa.com")).toBe("giovana");
    expect(primeiroNome(null)).toBe("");
  });
});
