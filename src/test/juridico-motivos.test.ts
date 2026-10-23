import { describe, it, expect } from "vitest";
import { agruparMotivos, chaveMotivo, processoTemMotivo } from "@/lib/juridico/motivos";

// Motivos dos processos (23/10/2026): grafias do mesmo motivo juntam, e o
// filtro acha o processo por qualquer motivo, não só o 1º.
describe("chaveMotivo", () => {
  it("junta singular/plural, maiúscula e acento", () => {
    expect(chaveMotivo("Indenização por Dano Material")).toBe(chaveMotivo("Indenização por danos materiais"));
    expect(chaveMotivo("Indenização por Dano Moral")).toBe(chaveMotivo("indenizacao  por danos morais "));
    expect(chaveMotivo("Horas Extras")).toBe(chaveMotivo("hora extra"));
    expect(chaveMotivo("Ações trabalhistas")).toBe(chaveMotivo("ação trabalhista"));
  });

  it("não junta motivos diferentes", () => {
    expect(chaveMotivo("Indenização por Dano Moral")).not.toBe(chaveMotivo("Indenização por Dano Material"));
    expect(chaveMotivo("FGTS")).not.toBe(chaveMotivo("Férias"));
  });

  // A mig 20261023000200 (jur_motivo_chave) repete a regra: estes valores
  // foram conferidos contra o Postgres.
  it("valores fixos (os mesmos da função SQL)", () => {
    expect(chaveMotivo("Indenização por danos materiais")).toBe("indenizacao por dano material");
    expect(chaveMotivo("Horas Extras")).toBe("hora extra");
    expect(chaveMotivo("Ações trabalhistas")).toBe("acao trabalhista");
    expect(chaveMotivo("FGTS")).toBe("fgt");
  });
});

describe("agruparMotivos", () => {
  it("usa o nome mais usado e conta todos os usos", () => {
    const g = agruparMotivos(["Indenização por Dano Material", "Indenização por danos materiais", "Indenização por Dano Material", "FGTS", "", null]);
    const dano = g.find((x) => x.chave === chaveMotivo("Indenização por Dano Material"));
    expect(g).toHaveLength(2);
    expect(dano?.nome).toBe("Indenização por Dano Material");
    expect(dano?.usos).toBe(3);
    expect(dano?.grafias).toEqual(["Indenização por Dano Material", "Indenização por danos materiais"]);
  });
});

describe("processoTemMotivo", () => {
  const mara = [{ motivo: "Indenização por Dano Moral" }, { motivo: "Indenização por Dano Material" }];
  it("acha pelo 2º motivo, em qualquer grafia", () => {
    expect(processoTemMotivo(mara, chaveMotivo("Indenização por danos materiais"))).toBe(true);
    expect(processoTemMotivo(mara, chaveMotivo("Indenização por Dano Moral"))).toBe(true);
    expect(processoTemMotivo(mara, chaveMotivo("FGTS"))).toBe(false);
  });
});
