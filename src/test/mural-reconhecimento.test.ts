import { describe, expect, it } from "vitest";
import {
  ehComentarioPositivo, filtrarMural, lerNota, mesAnterior, mesDeBrasilia,
  notaMinimaPositiva, somarMes, type LinhaMural,
} from "@/lib/formularios/muralReconhecimento";

// Espelho da regra do banco (mig 20261030003200). Se um destes números mudar,
// cs_form_mural_positivo / cs_form_mural_inicio têm que mudar junto.

describe("nota positiva", () => {
  it("80% do topo da escala, arredondado para cima", () => {
    expect(notaMinimaPositiva(5)).toBe(4);
    expect(notaMinimaPositiva(10)).toBe(8);
    expect(notaMinimaPositiva(3)).toBe(3);
    expect(notaMinimaPositiva(null)).toBe(4);   // sem escala = 5
    expect(notaMinimaPositiva(1)).toBe(2);      // escala mínima é 2
  });

  it("lê nota em número ou texto, com vírgula", () => {
    expect(lerNota(4)).toBe(4);
    expect(lerNota(" 5 ")).toBe(5);
    expect(lerNota("4,5")).toBe(4.5);
    expect(lerNota("")).toBeNull();
    expect(lerNota("ótimo")).toBeNull();
    expect(lerNota(null)).toBeNull();
  });

  it("positivo = nota alta E comentário com texto", () => {
    expect(ehComentarioPositivo({ nota: 5, comentario: "Sempre ajuda a equipe", escala: 5 })).toBe(true);
    expect(ehComentarioPositivo({ nota: "4", comentario: "Muito prestativa", escala: 5 })).toBe(true);
    expect(ehComentarioPositivo({ nota: 3, comentario: "Poderia ajudar mais", escala: 5 })).toBe(false);
    expect(ehComentarioPositivo({ nota: 5, comentario: "", escala: 5 })).toBe(false);
    expect(ehComentarioPositivo({ nota: 5, comentario: " ok ", escala: 5 })).toBe(false);
    expect(ehComentarioPositivo({ nota: null, comentario: "Excelente colega", escala: 5 })).toBe(false);
    expect(ehComentarioPositivo({ nota: 7, comentario: "Bom colega", escala: 10 })).toBe(false);
    expect(ehComentarioPositivo({ nota: 8, comentario: "Bom colega", escala: 10 })).toBe(true);
  });
});

describe("mês anterior (Brasília)", () => {
  it("vira o ano", () => {
    expect(somarMes("2026-01", -1)).toBe("2025-12");
    expect(somarMes("2026-12", 1)).toBe("2027-01");
    expect(mesAnterior(new Date("2027-01-15T12:00:00-03:00"))).toBe("2026-12");
  });

  it("usa o relógio de Brasília, não o UTC", () => {
    // 01/11 00:30 em UTC ainda é 31/10 21:30 em Brasília.
    expect(mesDeBrasilia("2026-11-01T00:30:00Z")).toBe("2026-10");
    expect(mesAnterior(new Date("2026-11-01T00:30:00Z"))).toBe("2026-09");
    // 01/11 03:30 UTC = 01/11 00:30 em Brasília: já é novembro.
    expect(mesAnterior(new Date("2026-11-01T03:30:00Z"))).toBe("2026-10");
  });
});

describe("filtrarMural", () => {
  const hoje = new Date("2026-11-10T12:00:00-03:00");
  const base: LinhaMural = { colaborador: "FULANA", nota: 5, escala: 5, comentario: "Sempre disposta a ajudar", enviado_em: "2026-10-20T14:00:00-03:00", status: "liberado" };

  it("fica só liberado + positivo + mês anterior", () => {
    const linhas: LinhaMural[] = [
      base,
      { ...base, colaborador: "PENDENTE", status: "pendente" },
      { ...base, colaborador: "RECUSADO", status: "recusado" },
      { ...base, colaborador: "NOTA BAIXA", nota: 2 },
      { ...base, colaborador: "SEM TEXTO", comentario: "" },
      { ...base, colaborador: "MES ATUAL", enviado_em: "2026-11-02T10:00:00-03:00" },
      { ...base, colaborador: "DOIS MESES", enviado_em: "2026-09-28T10:00:00-03:00" },
    ];
    expect(filtrarMural(linhas, hoje).map((l) => l.colaborador)).toEqual(["FULANA"]);
  });

  it("voto da noite de 31/10 em Brasília conta em outubro", () => {
    const noite = { ...base, enviado_em: "2026-11-01T02:30:00Z" };   // 31/10 23:30 BRT
    expect(filtrarMural([noite], hoje)).toHaveLength(1);
  });
});
