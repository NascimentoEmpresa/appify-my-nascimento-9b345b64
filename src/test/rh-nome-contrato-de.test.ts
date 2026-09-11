import { describe, expect, it } from "vitest";
import { nomeContratoDe, semCodigoFilial } from "@/lib/rh/colaboradoresUtils";

describe("nomeContratoDe — contrato é a filial, com o código na frente", () => {
  it("devolve o Nome Filial como está quando já vem com código do banco", () => {
    expect(nomeContratoDe({ Filial: 1109, "Nome Filial": "1109 - POLICIA CIVIL RS LIMPEZA 066.2026" }))
      .toBe("1109 - POLICIA CIVIL RS LIMPEZA 066.2026");
  });

  it("prefixa quando a linha ainda não passou pelo trigger", () => {
    expect(nomeContratoDe({ Filial: 1109, "Nome Filial": "POLICIA CIVIL RS LIMPEZA 066.2026" }))
      .toBe("1109 - POLICIA CIVIL RS LIMPEZA 066.2026");
  });

  it("ignora a Descrição do Local, que é o posto", () => {
    expect(nomeContratoDe({
      Filial: 1109, "Nome Filial": "1109 - POLICIA CIVIL RS LIMPEZA 066.2026",
      "Descrição do Local": "1109 - PALÁCIO DA POLÍCIA",
    })).toBe("1109 - POLICIA CIVIL RS LIMPEZA 066.2026");
  });

  it("degrada para o que existir quando falta código ou nome", () => {
    expect(nomeContratoDe({ Filial: 1109, "Nome Filial": " " })).toBe("1109");
    expect(nomeContratoDe({ "Nome Filial": "TJRS - 023/2025" })).toBe("TJRS - 023/2025");
    expect(nomeContratoDe({})).toBe("");
    expect(nomeContratoDe(null)).toBe("");
  });
});

describe("semCodigoFilial — para casar com CONTRATOS.NOME CONTRATO", () => {
  it("tira só o código da frente", () => {
    expect(semCodigoFilial("1109 - POLICIA CIVIL RS LIMPEZA 066.2026")).toBe("POLICIA CIVIL RS LIMPEZA 066.2026");
    expect(semCodigoFilial("1043 - VERANOPOLIS - 001/2021")).toBe("VERANOPOLIS - 001/2021");
  });
  it("não mexe em nome que não tem código", () => {
    expect(semCodigoFilial("TJRS - 023/2025")).toBe("TJRS - 023/2025");
    expect(semCodigoFilial(null)).toBe("");
  });
});
