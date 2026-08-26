import { describe, it, expect } from "vitest";
import {
  STATUS_TODOS, corDoStatus, explicaStatus, linkDoLocalASO, resumoDoASO,
} from "@/lib/demissao/solicitacao";

// O ASO demissional é a última etapa da demissão (25/08/2026): o RH conclui a
// parte dele e manda para o SST, que marca data/hora/local do exame — os
// MESMOS campos do ASO de admissão. O que este arquivo trava é o que o
// encarregado lê do outro lado: o status certo e o local do exame.

describe("status do fluxo de demissão", () => {
  it("tem a etapa do SST entre o RH e o fim", () => {
    expect(STATUS_TODOS).toContain("Pendente SST");
    expect(STATUS_TODOS.indexOf("Pendente SST"))
      .toBeGreaterThan(STATUS_TODOS.indexOf("Pendente RH"));
    expect(STATUS_TODOS.indexOf("Pendente SST"))
      .toBeLessThan(STATUS_TODOS.indexOf("Concluída"));
  });

  it("cada status se explica sozinho para quem só acompanha", () => {
    for (const s of STATUS_TODOS) {
      expect(explicaStatus(s)).not.toBe("");
      // Sem cor própria, "Pendente SST" sairia igual a um status desconhecido.
      expect(corDoStatus(s)).not.toBe(corDoStatus("status que não existe"));
    }
  });

  it("'Concluída' agora fala do ASO, não do RH", () => {
    expect(explicaStatus("Pendente SST")).toMatch(/SST/);
    expect(explicaStatus("Concluída")).toMatch(/ASO/);
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
