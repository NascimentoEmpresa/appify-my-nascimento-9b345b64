import { describe, expect, it } from "vitest";
import { chaveGrupoContrato, gruposDeContratos, trechoCliente } from "@/lib/treinamentos/gruposContrato";

describe("grupos de contrato (Dashboard de Treinamentos)", () => {
  it("pega o trecho do cliente depois do número", () => {
    expect(trechoCliente("1050 - UFRGS - LIMPEZA GERAL")).toBe("UFRGS");
    expect(trechoCliente("1049 - TJRS - 023/2025")).toBe("TJRS");
    expect(trechoCliente("1099 - PREF POA SMS RECEPÇÃO")).toBe("PREF POA SMS RECEPÇÃO");
  });

  it("toda PREF* vira Prefeitura; o resto vai pela 1ª palavra", () => {
    expect(chaveGrupoContrato("1099 - PREF POA SMS RECEPÇÃO")).toBe("PREFEITURA");
    expect(chaveGrupoContrato("1200 - PREFEITURA DE CANOAS - 01/2026")).toBe("PREFEITURA");
    expect(chaveGrupoContrato("1201 - Pref. Gravataí")).toBe("PREFEITURA");
    expect(chaveGrupoContrato("1030 - UFFS CHAPECO - 041/2025")).toBe("UFFS");
    expect(chaveGrupoContrato("")).toBeNull();
  });

  it("agrupa, rotula pelo começo comum e esconde grupo de um só", () => {
    const g = gruposDeContratos([
      "1050 - UFRGS - LIMPEZA GERAL",
      "1048 - UFRGS - MOTORISTAS",
      "1040 - UFRGS - JARDINAGEM",
      "1030 - UFFS CHAPECO - 041/2025",
      "1031 - UFFS ERECHIM - 042/2025",
      "1099 - PREF POA SMS RECEPÇÃO",
      "1200 - PREFEITURA DE CANOAS",
      "1109 - POLICIA CIVIL RS LIMPEZA",
      "1110 - POLÍCIA CIVIL RS PORTARIA",
      "1049 - TJRS - 023/2025",
    ]);
    expect(g.map((x) => [x.rotulo, x.nomes.length])).toEqual([
      ["POLICIA CIVIL RS", 2],
      ["Prefeituras", 2],
      ["UFFS", 2],
      ["UFRGS", 3],
    ]);
  });
});
