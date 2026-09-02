import { describe, it, expect } from "vitest";
import {
  STATUS_TODOS, corDoStatus, explicaStatus, linkDoLocalASO, resumoDoASO,
} from "@/lib/demissao/solicitacao";

// O ASO demissional marca data/hora/local do exame — os MESMOS campos do ASO
// de admissão. O que este arquivo trava é o que o encarregado lê do outro
// lado: o status certo e o local do exame.
//
// A ORDEM MUDOU EM 02/09/2026. Era analista(operacional) → RH → SST, com o
// SST fechando; virou analista → SST → RH, com o RH fechando. O teste antigo
// travava exatamente o contrário do que se pede hoje, e é essa a razão de ele
// ter sido reescrito em vez de removido.

describe("status do fluxo de demissão", () => {
  it("tem a etapa do SST entre o analista e o RH", () => {
    expect(STATUS_TODOS).toContain("Pendente SST");
    expect(STATUS_TODOS.indexOf("Pendente SST"))
      .toBeGreaterThan(STATUS_TODOS.indexOf("Pendente Analista"));
    expect(STATUS_TODOS.indexOf("Pendente SST"))
      .toBeLessThan(STATUS_TODOS.indexOf("Pendente RH"));
    expect(STATUS_TODOS.indexOf("Pendente RH"))
      .toBeLessThan(STATUS_TODOS.indexOf("Concluída"));
  });

  it("a primeira etapa é do analista, não do Operacional", () => {
    expect(STATUS_TODOS).toContain("Pendente Analista");
    expect(STATUS_TODOS).not.toContain("Pendente Operacional");
    expect(explicaStatus("Pendente Analista")).toMatch(/analista/i);
  });

  it("cada status se explica sozinho para quem só acompanha", () => {
    for (const s of STATUS_TODOS) {
      expect(explicaStatus(s)).not.toBe("");
      // Sem cor própria, "Pendente SST" sairia igual a um status desconhecido.
      expect(corDoStatus(s)).not.toBe(corDoStatus("status que não existe"));
    }
  });

  it("quem fecha a demissão é o RH, e o status diz isso", () => {
    // O SST deixou de ser o fim da linha: ele marca o ASO e passa adiante.
    expect(explicaStatus("Pendente SST")).toMatch(/ASO/);
    expect(explicaStatus("Pendente RH")).toMatch(/RH/);
    expect(explicaStatus("Concluída")).toMatch(/RH/);
  });
});

describe("linkDoLocalASO", () => {
  it("prefere o link exato que o SST colou", () => {
    expect(linkDoLocalASO({
      sst_maps_url: "https://www.google.com/maps?q=-29.123456,-51.654321",
      sst_local_exame: "Clínica Ocupacional",
    })).toBe("https://www.google.com/maps?q=-29.123456,-51.654321");
  });

  it("sem link, cai na busca pelo texto do local", () => {
    expect(linkDoLocalASO({ sst_maps_url: null, sst_local_exame: "Clínica São Lucas, Triunfo" }))
      .toBe("https://www.google.com/maps/search/?api=1&query=Cl%C3%ADnica%20S%C3%A3o%20Lucas%2C%20Triunfo");
  });

  it("sem nada, não inventa link", () => {
    expect(linkDoLocalASO({ sst_maps_url: "   ", sst_local_exame: "  " })).toBeNull();
    expect(linkDoLocalASO({})).toBeNull();
  });
});

describe("resumoDoASO", () => {
  it("junta data, hora e local em uma linha", () => {
    expect(resumoDoASO({
      sst_data_exame: "2026-09-03", sst_hora_exame: "09:00", sst_local_exame: "Clínica X",
    })).toBe("03/09/2026 às 09:00 · Clínica X");
  });

  it("hora e local são opcionais — a data é que manda", () => {
    expect(resumoDoASO({ sst_data_exame: "2026-09-03" })).toBe("03/09/2026");
    expect(resumoDoASO({ sst_data_exame: "2026-09-03", sst_local_exame: "Clínica X" }))
      .toBe("03/09/2026 · Clínica X");
  });

  it("sem ASO marcado, não finge que tem", () => {
    expect(resumoDoASO({ sst_hora_exame: "09:00", sst_local_exame: "Clínica X" })).toBe("—");
  });
});
