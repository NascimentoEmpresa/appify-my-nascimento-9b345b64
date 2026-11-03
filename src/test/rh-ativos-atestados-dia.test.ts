import { describe, it, expect } from "vitest";
import {
  conferirContrato, ehAtestado, diasEntre, montarSerieAtestados,
  type ContratoAtivos, type PessoaContrato,
} from "@/pages/rh/conferenciaAtivos";
import { rotaMovida } from "@/lib/acesso";

// =====================================================================
// Ativos/Contratos › atestados por dia (03/11/2026, mig 20261103005100) e a
// mudança das telas do RH para o Operacional (ROTAS_MOVIDAS).
// =====================================================================

let seq = 0;
const p = (over: Partial<PessoaContrato>): PessoaContrato => ({
  id: ++seq, cadastro: String(seq), nome: `Pessoa ${seq}`, cargo: null, situacao: "Trabalhando",
  conta: true, posto_senior: "X", posto: null, fora: false, origem: null, ...over,
});
const base = (over: Partial<ContratoAtivos>): ContratoAtivos => ({
  id: "c1", nome: "Contrato", cliente: null, encerrado: false, postos: [], pessoas: [], ...over,
});

describe("ehAtestado", () => {
  it("casa as situações de atestado da Senior, como o SST (~* 'ATEST')", () => {
    expect(ehAtestado("Atestado (dias)")).toBe(true);
    expect(ehAtestado("Atestado Filho")).toBe(true);
    expect(ehAtestado("ATESTADO")).toBe(true);
    expect(ehAtestado("Auxílio Doença")).toBe(false);
    expect(ehAtestado("Férias")).toBe(false);
    expect(ehAtestado("Trabalhando")).toBe(false);
    expect(ehAtestado(null)).toBe(false);
  });
});

describe("conferirContrato › atestados", () => {
  it("conta quem está de atestado hoje, inclusive RT; quem está fora da conta, não", () => {
    const r = conferirContrato(base({
      postos: [{ nome: "VIGIA", vagas: 3 }],
      pessoas: [
        p({ posto: "VIGIA", nome: "Ana" }),
        p({ posto: "VIGIA", nome: "Bia", situacao: "Atestado (dias)", conta: false }),
        p({ posto: "VIGIA", nome: "Caio", situacao: "Auxílio Doença", conta: false }),
        p({ posto: "RENDA TÉCNICA", nome: "Duda", situacao: "Atestado Filho", conta: false }),
        p({ posto: null, nome: "Edu", situacao: "Atestado (dias)", conta: false, fora: true }),
      ],
    }));
    expect(r.atestados.map((x) => x.nome)).toEqual(["Bia", "Duda"]);
    // Atestado continua sendo afastado (06/10/2026): a coluna nova não muda o Tem.
    expect(r.afastados.map((x) => x.nome)).toEqual(["Bia", "Caio"]);
    expect(r.tem).toBe(1);
  });
});

describe("diasEntre", () => {
  it("inclui as duas pontas e atravessa o mês", () => {
    expect(diasEntre("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(diasEntre("2026-11-03", "2026-11-03")).toEqual(["2026-11-03"]);
    expect(diasEntre("2026-11-04", "2026-11-03")).toEqual([]);
  });
});

describe("montarSerieAtestados", () => {
  it("passado vem do histórico do SST; hoje vem do painel (a mesma fonte de Afastados)", () => {
    const serie = montarSerieAtestados(
      [
        { contrato_id: "c1", dia: "2026-11-01", nomes: ["Ana"] },
        { contrato_id: "c1", dia: "2026-11-03", nomes: ["Ana", "Bia", "Caio"] }, // hoje no SST: ignorado
        { contrato_id: "c2", dia: "2026-11-02", nomes: ["Duda"] },
      ],
      "2026-11-03",
      new Map([["c1", ["Bia"]], ["c3", []]]),
    );
    expect(serie.get("c1")?.get("2026-11-01")).toEqual(["Ana"]);
    expect(serie.get("c1")?.get("2026-11-03")).toEqual(["Bia"]);
    expect(serie.get("c2")?.get("2026-11-02")).toEqual(["Duda"]);
    expect(serie.has("c3")).toBe(false);
  });
});

describe("rotaMovida", () => {
  it("leva as rotas antigas do RH para o Operacional, com subrota", () => {
    expect(rotaMovida("/app/rh/colaboradores")).toBe("/app/operacional/colaboradores");
    expect(rotaMovida("/app/rh/ativos-contratos")).toBe("/app/operacional/ativos-contratos");
    expect(rotaMovida("/app/rh/colaboradores/123")).toBe("/app/operacional/colaboradores/123");
  });
  it("não mexe em rota parecida nem na nova", () => {
    expect(rotaMovida("/app/rh/colaboradores-extra")).toBeNull();
    expect(rotaMovida("/app/operacional/colaboradores")).toBeNull();
    expect(rotaMovida("/app/rh/hierarquia-postos")).toBeNull();
  });
});
