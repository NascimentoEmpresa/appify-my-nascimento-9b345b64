import { describe, it, expect } from "vitest";
import {
  mesNoIntervalo,
  mesesNoIntervalo,
  ordenarMeses,
  rotuloPeriodo,
  sufixoArquivo,
} from "@/pages/controladoria/faturamento/periodoMeses";

// Rótulo curto igual ao da tela, sem importar o hook (que puxaria o Supabase).
const ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotulo = (m: string) => `${ABREV[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

describe("período em meses da Lucratividade (SIS-2026-0769)", () => {
  it("um mês só devolve ele mesmo — é o comportamento de antes do intervalo", () => {
    expect(mesesNoIntervalo("2026-10", "2026-10")).toEqual(["2026-10"]);
  });

  it("devolve todos os meses do intervalo, inclusive as duas pontas", () => {
    expect(mesesNoIntervalo("2026-08", "2026-11")).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
  });

  it("atravessa a virada de ano", () => {
    expect(mesesNoIntervalo("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("ano inteiro dá doze meses", () => {
    expect(mesesNoIntervalo("2026-01", "2026-12")).toHaveLength(12);
  });

  it("intervalo invertido não devolve lista vazia: corrige a ordem", () => {
    expect(mesesNoIntervalo("2026-11", "2026-08")).toEqual(mesesNoIntervalo("2026-08", "2026-11"));
  });

  it("ordenarMeses devolve [menor, maior]", () => {
    expect(ordenarMeses("2026-11", "2026-08")).toEqual(["2026-08", "2026-11"]);
    expect(ordenarMeses("2026-08", "2026-11")).toEqual(["2026-08", "2026-11"]);
  });

  it("mesNoIntervalo inclui as pontas e exclui o que está fora", () => {
    expect(mesNoIntervalo("2026-08", "2026-08", "2026-11")).toBe(true);
    expect(mesNoIntervalo("2026-11", "2026-08", "2026-11")).toBe(true);
    expect(mesNoIntervalo("2026-09", "2026-08", "2026-11")).toBe(true);
    expect(mesNoIntervalo("2026-07", "2026-08", "2026-11")).toBe(false);
    expect(mesNoIntervalo("2026-12", "2026-08", "2026-11")).toBe(false);
  });

  it("o rótulo não vira intervalo quando é um mês só", () => {
    expect(rotuloPeriodo("2026-10", "2026-10", rotulo)).toBe("out/26");
  });

  it("o rótulo do intervalo sai na ordem certa mesmo invertido", () => {
    expect(rotuloPeriodo("2026-08", "2026-10", rotulo)).toBe("ago/26 a out/26");
    expect(rotuloPeriodo("2026-10", "2026-08", rotulo)).toBe("ago/26 a out/26");
  });

  it("o nome do arquivo exportado identifica o período", () => {
    expect(sufixoArquivo("2026-10", "2026-10")).toBe("2026-10");
    expect(sufixoArquivo("2026-10", "2026-08")).toBe("2026-08_2026-10");
  });

  // A busca de custos vai de [inicio-01, mês seguinte ao fim): o número de meses
  // do intervalo é o que a tela soma mês a mês (exec e rubricas).
  it("a contagem de meses é a quantidade de parcelas somadas pela tela", () => {
    expect(mesesNoIntervalo("2026-01", "2026-03")).toHaveLength(3);
  });
});
