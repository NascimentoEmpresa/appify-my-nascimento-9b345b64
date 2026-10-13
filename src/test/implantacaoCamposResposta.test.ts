import { describe, expect, it } from "vitest";
import {
  lerLista,
  lerListaComOutro,
  lerSimNaoDetalhe,
  resumoResposta,
  salvarLista,
  salvarListaComOutro,
  salvarSimNaoDetalhe,
} from "@/lib/implantacao/camposResposta";

describe("listas do checklist de implantação", () => {
  it("serializa sem duplicar e ainda lê resposta legada", () => {
    expect(salvarLista(["NR 10", "NR 10", "NR 35"])).toBe('["NR 10","NR 35"]');
    expect(lerLista('["NR 10","NR 35"]')).toEqual(["NR 10", "NR 35"]);
    expect(lerLista("Curso antigo")).toEqual(["Curso antigo"]);
  });

  it("preserva a opção Outro da emissão de nota", () => {
    expect(salvarListaComOutro("Outro", "")).toBe("Outro:");
    expect(salvarListaComOutro("Outro", "Por unidade gestora")).toBe("Outro: Por unidade gestora");
    expect(lerListaComOutro("Outro: Por unidade gestora", ["Cidade", "Secretaria", "Posto"]))
      .toEqual({ opcao: "Outro", outro: "Por unidade gestora" });
  });
});

describe("Sim/Não/N/A com detalhe", () => {
  it("só mantém detalhe quando a resposta é Sim", () => {
    expect(lerSimNaoDetalhe(salvarSimNaoDetalhe("Sim", "Ruído e produtos químicos")))
      .toEqual({ opcao: "Sim", detalhe: "Ruído e produtos químicos" });
    expect(lerSimNaoDetalhe(salvarSimNaoDetalhe("Não", "não deve ficar")))
      .toEqual({ opcao: "Não", detalhe: "" });
  });

  it("continua entendendo respostas antigas em texto", () => {
    expect(lerSimNaoDetalhe("Sim — Hepatite B")).toEqual({ opcao: "Sim", detalhe: "Hepatite B" });
    expect(resumoResposta(23, "Sim — Hepatite B")).toBe("Sim — Hepatite B");
  });
});
