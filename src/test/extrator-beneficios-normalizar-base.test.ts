import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { regravarComoXlsx } from "@/lib/extratorBeneficios/normalizarBase";

function planilha(bookType: XLSX.BookType, abas: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [nome, aoa] of Object.entries(abas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nome);
  return XLSX.write(wb, { bookType, type: "array" }) as ArrayBuffer;
}

function ler(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: "array" });
  return { abas: wb.SheetNames, linhas: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }) };
}

describe("Extrator de Benefícios — base regravada como .xlsx limpo", () => {
  it("abre .xls (que o worker não lê) e devolve .xlsx com os mesmos valores", () => {
    const xls = planilha("biff8", { Plan1: [["NOME", "ADMISSAO", "CARGO"], ["ANA SILVA", "01/02/2024", "AUX 12X36"]] });
    const r = ler(regravarComoXlsx(xls));
    expect(r.linhas).toEqual([["NOME", "ADMISSAO", "CARGO"], ["ANA SILVA", "01/02/2024", "AUX 12X36"]]);
  });

  it("fica só a primeira aba — é a única que o worker usa", () => {
    const r = ler(regravarComoXlsx(planilha("xlsx", { Base: [["NOME"], ["ANA"]], Outra: [["X"]] })));
    expect(r.abas).toEqual(["Base"]);
  });

  it("fórmula vira o valor calculado", () => {
    const wb = XLSX.utils.book_new();
    const aba = XLSX.utils.aoa_to_sheet([["NOME", "DIAS"], ["ANA", 10]]);
    aba["C2"] = { t: "n", v: 20, f: "B2*2" };
    aba["!ref"] = "A1:C2";
    XLSX.utils.book_append_sheet(wb, aba, "Base");
    const saida = XLSX.read(regravarComoXlsx(XLSX.write(wb, { bookType: "xlsx", type: "array" })), { type: "array", cellFormula: true });
    expect(saida.Sheets.Base["C2"].v).toBe(20);
    expect(saida.Sheets.Base["C2"].f).toBeUndefined();
  });

  it("primeira aba vazia dá mensagem clara, antes de criar o job", () => {
    expect(() => regravarComoXlsx(planilha("xlsx", { Vazia: [[]] }))).toThrow(/vazia|nenhuma aba/);
  });
});

describe("Extrator de Benefícios — datas da base", () => {
  it("data do Excel vira DD/MM/AAAA, sem andar um dia por causa do fuso", () => {
    const wb = XLSX.utils.book_new();
    const aba = XLSX.utils.aoa_to_sheet([["NOME", "ADMISSAO"], ["ANA", null]]);
    aba["B2"] = { t: "n", v: 45323, z: "dd/mm/yyyy" }; // 01/02/2024
    XLSX.utils.book_append_sheet(wb, aba, "Base");
    const r = ler(regravarComoXlsx(XLSX.write(wb, { bookType: "xlsx", type: "array" })));
    expect(r.linhas[1]).toEqual(["ANA", "01/02/2024"]);
  });

  it("número comum (sem formato de data) continua número", () => {
    const r = ler(regravarComoXlsx(planilha("xlsx", { Base: [["NOME", "CARGA"], ["ANA", 12]] })));
    expect(r.linhas[1]).toEqual(["ANA", 12]);
  });
});
