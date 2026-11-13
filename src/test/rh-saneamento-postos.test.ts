import { describe, expect, it } from "vitest";
import {
  classificarSaneamento, mesmoNome, resumirSaneamento, statusDoPostoSenior, linhasParaExcel,
  type PostoSeniorSan, type PostoErpSan,
} from "@/lib/rh/saneamentoPostos";

const senior = (p: Partial<PostoSeniorSan>): PostoSeniorSan => ({
  contrato_id: "c1", contrato: "HOSPITAL X", codigo: "PO-00001", posto_senior: "01-1099-0071-0061-06-RECEPCIONISTA 40H",
  pessoas: 3, sem_posto: 0, fora: 0, rt: 0, postos_erp: [], ...p,
});

describe("saneamento de postos — Senior × ERP", () => {
  it("mesmoNome ignora acento, pontuação e o prefixo de endereço da Senior", () => {
    expect(mesmoNome("01-1099-0071-0061-06-RECEPCIONISTA 40H", "Recepcionista 40h")).toBe(true);
    expect(mesmoNome("TÉC. SECRETARIADO - POA", "TEC SECRETARIADO POA")).toBe(true);
    expect(mesmoNome("01-1099-0071-0061-06-RECEPCIONISTA-B1 40H 5X2", "POSTO B1 - RECEPCIONISTA 40H 5X2")).toBe(false);
    expect(mesmoNome("QUALQUER", "")).toBe(false);
  });

  it("classifica cada posto da Senior", () => {
    expect(statusDoPostoSenior(senior({ postos_erp: ["RECEPCIONISTA 40H"] }))).toBe("padronizado");
    expect(statusDoPostoSenior(senior({ postos_erp: ["POSTO A - RECEPÇÃO"] }))).toBe("nome_diferente");
    expect(statusDoPostoSenior(senior({ postos_erp: ["COPEIRO IMBÉ", "COPEIRO POA"] }))).toBe("varios_erp");
    expect(statusDoPostoSenior(senior({ sem_posto: 1, postos_erp: ["RECEPCIONISTA 40H"] }))).toBe("parcial");
    expect(statusDoPostoSenior(senior({ sem_posto: 3 }))).toBe("sem_equivalente");
    expect(statusDoPostoSenior(senior({ posto_senior: "", codigo: "", sem_posto: 3 }))).toBe("sem_posto_senior");
    // Movido à mão no ERP, mas a Senior segue sem posto: continua pendente de saneamento.
    expect(statusDoPostoSenior(senior({ posto_senior: "", codigo: "", postos_erp: ["RECEPCIONISTA 40H"] }))).toBe("sem_posto_senior");
    expect(statusDoPostoSenior(senior({ pessoas: 2, fora: 1, rt: 1 }))).toBe("fora_da_conta");
  });

  it("quem está fora da conta não transforma o posto em 'sem vínculo'", () => {
    // 3 pessoas: 1 fora, 2 ligadas ao mesmo posto do ERP.
    expect(statusDoPostoSenior(senior({ fora: 1, postos_erp: ["RECEPCIONISTA 40H"] }))).toBe("padronizado");
  });

  it("ordena pelo que mais atrapalha e resume", () => {
    const erp: PostoErpSan[] = [
      { contrato_id: "c1", contrato: "HOSPITAL X", posto: "RECEPCIONISTA 40H", previsto: 3, implantado: 3, pessoas: 3, codigos_senior: ["PO-00001"] },
      { contrato_id: "c1", contrato: "HOSPITAL X", posto: "VIGIA 12X36", previsto: 2, implantado: 2, pessoas: 0, codigos_senior: [] },
      { contrato_id: "c1", contrato: "HOSPITAL X", posto: "POSTO NÃO IMPLANTADO", previsto: 1, implantado: 0, pessoas: 0, codigos_senior: [] },
    ];
    const linhas = classificarSaneamento({
      gerado_em: "2026-11-13T12:00:00Z",
      erp,
      senior: [
        senior({ postos_erp: ["RECEPCIONISTA 40H"] }),
        senior({ codigo: "PO-00002", posto_senior: "02-1064-0008-0012-06-VIGIA-44H", pessoas: 2, sem_posto: 2 }),
        senior({ codigo: "", posto_senior: "", pessoas: 1, sem_posto: 1 }),
        senior({ codigo: "PO-00003", posto_senior: "X", pessoas: 4, postos_erp: ["POSTO A"] }),
      ],
    });
    expect(linhas.map((l) => l.status)).toEqual(["sem_posto_senior", "sem_equivalente", "nome_diferente", "padronizado"]);
    expect(linhas[2].nome_padrao).toBe("POSTO A");

    const r = resumirSaneamento(linhas, erp);
    expect(r.pessoasSemVinculo).toBe(3);
    expect(r.postosSenior).toBe(4);
    expect(r.pctPadronizado).toBe(25);
    expect(r.porStatus.nome_diferente).toEqual({ postos: 1, pessoas: 4 });
    // Posto com implantado 0 não é "sem ninguém" — o tomador pediu para não implantar.
    expect(r.erpSemNinguem).toBe(1);

    expect(linhasParaExcel(linhas)[0]["Posto na Senior"]).toBe("(sem posto no cadastro)");
  });
});
